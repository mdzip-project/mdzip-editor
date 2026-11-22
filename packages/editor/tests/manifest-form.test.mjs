import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// The manifest form (View layout of manifest.json): a friendly view of the
// same JSON text the JSON editor shows, changing one value at a time.
if (typeof globalThis.window === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; }
  });
  globalThis.window = window;
  globalThis.Window = window.Window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.URL.createObjectURL = () => 'blob:test';
  globalThis.URL.revokeObjectURL = () => {};
}

const {
  MdzipWorkspaceView,
  readTextFileFromArchive,
  setMdzipJsonMember
} = await import('../dist/index.js');

const ROUND_TRIP = new Uint8Array(readFileSync(new URL('./fixtures/spec/round-trip.mdz', import.meta.url)));

// --- setMdzipJsonMember ----------------------------------------------------------

const MANIFEST = '{\n  "title": "A",\n  "n": 1.0,\n  "author": {\n    "name": "Kim"\n  }\n}\n';

test('setMdzipJsonMember replaces a value in place, leaving the rest of the text alone', () => {
  assert.equal(setMdzipJsonMember(MANIFEST, ['title'], 'B'), MANIFEST.replace('"A"', '"B"'));
  assert.equal(setMdzipJsonMember(MANIFEST, ['author', 'name'], 'Sam'), MANIFEST.replace('"Kim"', '"Sam"'));
  assert.equal(setMdzipJsonMember(MANIFEST, ['title'], 'A'), MANIFEST, 'same value, same text');
});

test('setMdzipJsonMember adds members indented like their siblings, with objects on the way', () => {
  assert.equal(setMdzipJsonMember(MANIFEST, ['author', 'email'], 'k@example.com'),
    '{\n  "title": "A",\n  "n": 1.0,\n  "author": {\n    "name": "Kim",\n    "email": "k@example.com"\n  }\n}\n');
  assert.equal(setMdzipJsonMember(MANIFEST, ['keywords'], ['a', 'b']),
    '{\n  "title": "A",\n  "n": 1.0,\n  "author": {\n    "name": "Kim"\n  },\n  "keywords": [\n    "a",\n    "b"\n  ]\n}\n');
  assert.equal(setMdzipJsonMember('{}', ['author', 'name'], 'Kim'), '{\n  "author": {\n    "name": "Kim"\n  }\n}');
  assert.equal(setMdzipJsonMember('{"a": 1}', ['b'], 2), '{"a": 1, "b": 2}', 'a one-line object stays on one line');
});

test('setMdzipJsonMember removes a member and its comma', () => {
  const text = '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}';
  assert.equal(setMdzipJsonMember(text, ['a'], undefined), '{\n  "b": 2,\n  "c": 3\n}');
  assert.equal(setMdzipJsonMember(text, ['b'], undefined), '{\n  "a": 1,\n  "c": 3\n}');
  assert.equal(setMdzipJsonMember(text, ['c'], undefined), '{\n  "a": 1,\n  "b": 2\n}');
  assert.equal(setMdzipJsonMember('{ "a": 1 }', ['a'], undefined), '{}');
  assert.equal(setMdzipJsonMember(text, ['missing'], undefined), text);
});

test('setMdzipJsonMember replaces a non-object on the way, changes the last repeated key, refuses invalid JSON', () => {
  assert.equal(setMdzipJsonMember('{\n  "author": "Kim"\n}', ['author', 'name'], 'Kim'), '{\n  "author": {\n    "name": "Kim"\n  }\n}');
  assert.equal(setMdzipJsonMember('{"a": 1, "a": 2}', ['a'], 3), '{"a": 1, "a": 3}');
  assert.equal(setMdzipJsonMember('{"a": 1,}', ['a'], 2), null);
  assert.equal(setMdzipJsonMember('[1]', ['a'], 2), null);
});

// --- The form in the view --------------------------------------------------------

async function openView(options = {}, mode = 'editable') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, { initialLayout: 'split', initialColorScheme: 'light', ...options });
  await view.open(ROUND_TRIP, { mode, fileName: 'round-trip.mdz' });
  const pressed = () => ['source', 'split', 'preview']
    .find((ref) => container.querySelector(`[data-ref="${ref}-btn"]`).getAttribute('aria-pressed') === 'true');
  const form = () => container.querySelector('.mdzip-manifest-form');
  const field = (name) => form().querySelector(`[name="${name}"]`);
  const type = (name, value) => {
    const input = field(name);
    input.value = value;
    input.dispatchEvent(new window.Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };
  const text = () => view['workspace'].snapshot().currentText;
  return { view, container, pressed, form, field, type, text, cleanup: () => { view.destroy(); container.remove(); } };
}

test('manifest.json opens as a form (View), and each file keeps its own layout', async () => {
  const { view, pressed, form, field, cleanup } = await openView();
  try {
    assert.equal(pressed(), 'split', 'the document opens split');
    await view.openPath('manifest.json');
    assert.equal(pressed(), 'preview', 'the manifest opens in View');
    assert.ok(form(), 'as a form');
    assert.equal(field('title').value, 'Round-trip preservation fixture');
    await view.openPath('index.md');
    assert.equal(pressed(), 'split', 'back to the document: Split again');
    await view.openPath('manifest.json');
    assert.equal(pressed(), 'preview');
  } finally {
    cleanup();
  }
});

test('typing in the form changes only that value in the JSON, and saves; unknown fields are kept', async () => {
  const { view, type, form, cleanup } = await openView();
  try {
    await view.openPath('manifest.json');
    type('title', 'Edited in the form');
    type('author.email', 'sam@example.com');
    type('keywords', 'birds,  field notes ,');
    const bytes = new Uint8Array(await (await view.serialize()).arrayBuffer());
    const saved = JSON.parse(await readTextFileFromArchive(bytes, 'manifest.json'));
    assert.equal(saved.title, 'Edited in the form');
    assert.equal(saved.author.email, 'sam@example.com');
    assert.deepEqual(saved.keywords, ['birds', 'field notes']);
    assert.equal(saved['x-unknown-string'], 'keep me', 'custom fields are kept');
    assert.deepEqual(saved.spec['x-negotiated'], ['1.1.0', '1.2.0']);
    assert.match(form().textContent, /x-unknown-string/, 'custom fields are listed');
  } finally {
    cleanup();
  }
});

test('clearing a field removes it; a field error shows under the field and blocks saving', async () => {
  const { view, type, field, form, text, cleanup } = await openView();
  try {
    await view.openPath('manifest.json');
    type('description', '');
    assert.ok(!/"description"/.test(text()), 'an empty field removes the property');
    type('entryPoint', 'docs/guide.md');
    assert.match(text(), /"entryPoint": "docs\/guide\.md"/);

    // A wrong value typed in the JSON shows as written, with its message.
    assert.match(text(), /"language": "[^"]*"/);
    view['workspace'].editText(text().replace(/"language": "[^"]*"/, '"language": 5'));
    assert.equal(field('language').value, '5');
    const error = field('language').parentElement.querySelector('.mmf-error');
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /language must be text/);
    assert.equal(field('language').getAttribute('aria-invalid'), 'true');
    assert.equal(view.getManifestValidity()?.canSave, false);
    assert.match(form().querySelector('.mmf-summary').textContent, /Saving is blocked/);
  } finally {
    cleanup();
  }
});

test('broken JSON replaces the form with a notice and a way to the JSON', async () => {
  const { view, form, pressed, cleanup } = await openView();
  try {
    await view.openPath('manifest.json');
    view['workspace'].editText('{"title": "A",');
    const notice = form().querySelector('.mmf-notice');
    assert.equal(notice.hidden, false);
    assert.equal(form().querySelector('.mmf-body').hidden, true);
    [...notice.querySelectorAll('button')].find((b) => b.textContent === 'Fix in JSON').click();
    for (let i = 0; i < 50 && pressed() !== 'source'; i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.equal(pressed(), 'source');
  } finally {
    cleanup();
  }
});

test('manifestView: "json" opens the manifest in the JSON editor; read-only shows a read-only form', async () => {
  const json = await openView({ manifestView: 'json' });
  try {
    await json.view.openPath('manifest.json');
    assert.equal(json.pressed(), 'source');
  } finally {
    json.cleanup();
  }
  const readOnly = await openView({ initialLayout: 'preview' }, 'read-only');
  try {
    await readOnly.view.openPath('manifest.json');
    assert.equal(readOnly.field('title').disabled, true);
  } finally {
    readOnly.cleanup();
  }
});

test('Edit as JSON says View as JSON when read-only, and is left out with no View button to come back by', async () => {
  const link = (form) => form().querySelector('.mmf-link');
  const readOnly = await openView({ initialLayout: 'preview' }, 'read-only');
  try {
    await readOnly.view.openPath('manifest.json');
    assert.equal(link(readOnly.form).textContent, 'View as JSON');
    assert.equal(link(readOnly.form).hidden, false);
  } finally {
    readOnly.cleanup();
  }
  // A reading host: preview only, no layout buttons.
  const reading = await openView({ initialLayout: 'preview', controls: 'preview' }, 'read-only');
  try {
    await reading.view.openPath('manifest.json');
    assert.ok(reading.form(), 'still a form');
    assert.equal(link(reading.form).hidden, true, 'no way back from the JSON, so no way in');
  } finally {
    reading.cleanup();
  }
});
