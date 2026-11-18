import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// #68: JSON entries are editable, and manifest.json is validated against the
// spec as you type; an invalid manifest blocks saving.
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
  MdzipManifestInvalidError,
  MdzipWorkspaceService,
  MdzipWorkspaceView,
  buildNewArchiveBytesWithTitle,
  readBinaryFileFromArchive,
  readTextFileFromArchive,
  validateMdzipJsonText,
  validateMdzipManifestText
} = await import('../dist/index.js');

const fixture = (name) => new URL(`./fixtures/spec/${name}`, import.meta.url);
const ROUND_TRIP = new Uint8Array(readFileSync(fixture('round-trip.mdz')));
const EXPECTATIONS = JSON.parse(readFileSync(fixture('round-trip-expectations.json'), 'utf8'));

const PATHS = ['index.md', 'docs/guide.md', 'images/cover.png'];
const VALID = {
  spec: { version: '1.2.0' },
  title: 'Guide',
  entryPoint: 'index.md',
  cover: 'images/cover.png',
  'x-team': 'docs'
};
const manifestText = (value) => JSON.stringify(value, null, 2);
const validate = (value, options = {}) =>
  validateMdzipManifestText(typeof value === 'string' ? value : manifestText(value), { archivePaths: PATHS, ...options });
const errorsOf = (validity) => validity.problems.filter((p) => p.severity === 'error');

// --- JSON ------------------------------------------------------------------------

test('JSON: a syntax error says what and where', () => {
  const text = '{\n  "a": 1,\n}';
  const validity = validateMdzipJsonText(text);
  assert.equal(validity.status, 'invalid');
  assert.equal(validity.canSave, true, 'other JSON files are saved as typed');
  const [problem] = validity.problems;
  assert.match(problem.message, /trailing comma/);
  assert.equal(text.slice(problem.from, problem.to), '}');
});

test('JSON: single quotes, unclosed strings and trailing text are explained', () => {
  assert.match(validateMdzipJsonText("{'a': 1}").problems[0].message, /property name/);
  assert.match(validateMdzipJsonText('["a]').problems[0].message, /never closed/);
  assert.match(validateMdzipJsonText('{} x').problems[0].message, /after the end/);
  assert.match(validateMdzipJsonText('').problems[0].message, /text ends/);
});

test('JSON: a repeated property name is a warning; valid JSON is valid', () => {
  const repeated = validateMdzipJsonText('{"a": 1, "b": {"c": 1, "c": 2}}');
  assert.equal(repeated.status, 'warnings');
  assert.match(repeated.problems[0].message, /"c" appears more than once/);
  const valid = validateMdzipJsonText('{"a": [1, 2.5e3, -0, true, null, "\\u00e9"]}');
  assert.equal(valid.status, 'valid');
  assert.deepEqual(valid.value, { a: [1, 2500, -0, true, null, 'é'] });
});

// --- Manifest --------------------------------------------------------------------

test('manifest: a valid one, with custom fields listed but not flagged', () => {
  const validity = validate(VALID);
  assert.equal(validity.kind, 'manifest');
  assert.equal(validity.status, 'valid');
  assert.equal(validity.canSave, true);
  assert.deepEqual(validity.customFields, ['x-team']);
});

test('manifest: invalid critical fields are errors at the field', () => {
  const text = manifestText({ ...VALID, mode: 'slides', spec: { version: '1.2' } });
  const validity = validate(text);
  assert.equal(validity.canSave, false);
  const fields = errorsOf(validity).map((p) => p.field).sort();
  assert.deepEqual(fields, ['mode', 'spec.version']);
  const mode = errorsOf(validity).find((p) => p.field === 'mode');
  assert.equal(text.slice(mode.from, mode.to), '"mode": "slides"');
  assert.match(mode.message, /unrecognized mode 'slides'/i);
});

test('manifest: a newer major spec version is an error', () => {
  const validity = validate({ ...VALID, spec: { version: '2.0.0' } });
  assert.equal(validity.canSave, false);
  assert.match(errorsOf(validity)[0].message, /supports 1\.x/);
});

test('manifest: entryPoint must name a Markdown file in the archive', () => {
  const missing = validate({ ...VALID, entryPoint: 'Index.md' });
  assert.equal(missing.canSave, false);
  assert.match(errorsOf(missing)[0].message, /isn't in the archive/);
  const notMarkdown = validate({ ...VALID, entryPoint: 'images/cover.png' });
  assert.equal(notMarkdown.canSave, false);
  assert.equal(validate({ ...VALID, entryPoint: './docs/guide.md' }).canSave, true);
});

test('manifest: an invalid descriptive field blocks saving too', () => {
  for (const change of [{ title: 42 }, { title: '' }, { keywords: 'a, b' }, { created: 'yesterday' }, { author: 'Kim' }]) {
    const validity = validate({ ...VALID, ...change });
    const [field] = Object.keys(change);
    assert.equal(validity.canSave, false, field);
    assert.deepEqual(errorsOf(validity).map((p) => p.field), [field]);
  }
});

test('manifest: a missing cover file is a warning, not an error', () => {
  const validity = validate({ ...VALID, cover: 'images/gone.png' });
  assert.equal(validity.status, 'warnings');
  assert.equal(validity.canSave, true);
});

test('manifest: a repeated property name, not JSON, or not an object, blocks saving', () => {
  const repeated = validate('{"spec": {"version": "1.2.0"}, "title": "A", "title": "B"}');
  assert.equal(repeated.canSave, false);
  assert.match(errorsOf(repeated)[0].message, /"title" appears more than once/);
  assert.equal(validate('{"title": "A",}').canSave, false);
  assert.equal(validate('[1, 2]').canSave, false);
});

test('manifest: editing producer or spec.version is allowed with a warning', () => {
  const stored = { ...VALID, producer: { application: { name: 'Tool' } } };
  const validity = validate({ ...stored, producer: { application: { name: 'Me' } }, spec: { version: '1.1.0' } }, { stored });
  assert.equal(validity.canSave, true);
  assert.deepEqual(validity.problems.map((p) => [p.severity, p.field]), [['warning', 'spec.version'], ['warning', 'producer']]);
});

// --- Workspace -------------------------------------------------------------------

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function pointer(value, path) {
  return path.split('/').slice(1).reduce((node, key) => (node == null ? undefined : node[key.replace(/~1/g, '/').replace(/~0/g, '~')]), value);
}

async function assertPreserved(bytes, flow) {
  const manifest = JSON.parse(await readTextFileFromArchive(bytes, 'manifest.json'));
  for (const { pointer: path, value } of EXPECTATIONS.preservedManifestValues) {
    assert.deepEqual(pointer(manifest, path), value, `${flow}: ${path}`);
  }
  for (const entry of EXPECTATIONS.preservedEntries) {
    if (flow === 'index' && entry.path === 'index.md') continue;
    const data = await readBinaryFileFromArchive(bytes, entry.path);
    assert.ok(data, `${flow}: ${entry.path} is kept`);
    assert.equal(data.byteLength, entry.bytes, `${flow}: ${entry.path} length`);
    assert.equal(sha256(data), entry.sha256, `${flow}: ${entry.path} content`);
  }
  return manifest;
}

test('P-004: editing manifest.json in the editor keeps unknown values and every other entry, save after save', async () => {
  let bytes = ROUND_TRIP;
  const original = JSON.parse(await readTextFileFromArchive(ROUND_TRIP, 'manifest.json'));
  for (let round = 1; round <= 3; round += 1) {
    const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });
    assert.equal(await workspace.openPath('manifest.json'), true);
    assert.equal(workspace.snapshot().currentPathType, 'text');
    assert.equal(workspace.dirty, false, 'opening the manifest is not an edit');
    const value = JSON.parse(workspace.snapshot().currentText);
    value.title = `Edited title ${round}`;
    workspace.editText(JSON.stringify(value, null, 2));
    assert.equal(workspace.manifestValidity(), null);
    bytes = await workspace.saveToBytes();
    const manifest = await assertPreserved(bytes, 'manifest');
    assert.equal(manifest.title, `Edited title ${round}`);
    assert.notDeepEqual(manifest.modified, original.modified, 'modified is refreshed');
  }
});

test('P-004: open, open the manifest, and save without an edit', async () => {
  const workspace = await MdzipWorkspaceService.open(ROUND_TRIP, { mode: 'editable' });
  await workspace.openPath('manifest.json');
  await workspace.openPath('index.md');
  assert.equal(workspace.dirty, false);
  await assertPreserved(await workspace.saveToBytes(), 'none');
});

test('an invalid manifest blocks saving until it is fixed, and survives switching files', async () => {
  const workspace = await MdzipWorkspaceService.open(ROUND_TRIP, { mode: 'editable' });
  await workspace.openPath('manifest.json');
  const original = workspace.snapshot().currentText;
  const broken = original.replace(/"entryPoint": "[^"]*"/, '"entryPoint": "missing.md"');
  assert.notEqual(broken, original);
  workspace.editText(broken);
  assert.equal(workspace.manifestValidity()?.canSave, false);
  await assert.rejects(workspace.saveToBytes(), (error) => {
    assert.ok(error instanceof MdzipManifestInvalidError);
    assert.equal(error.code, 'ERR_MANIFEST_INVALID');
    assert.match(error.message, /missing\.md/);
    return true;
  });
  await assert.rejects(workspace.flush(), MdzipManifestInvalidError);
  await assert.rejects(workspace.exportBytes(), MdzipManifestInvalidError);

  // Switching files keeps the broken text as a draft, still blocking saving.
  await workspace.openPath('index.md');
  assert.equal(workspace.manifestValidity()?.canSave, false);
  await assert.rejects(workspace.saveToBytes(), MdzipManifestInvalidError);
  await workspace.openPath('manifest.json');
  assert.equal(workspace.snapshot().currentText, broken);

  // Fixing it saves the fix.
  workspace.editText(broken.replace('"missing.md"', '"docs/guide.md"'));
  const bytes = await workspace.saveToBytes();
  assert.equal(JSON.parse(await readTextFileFromArchive(bytes, 'manifest.json')).entryPoint, 'docs/guide.md');
  assert.equal(workspace.snapshot().content.entryPoint, 'docs/guide.md');
});

test('a manifest edit committed by opening another file is saved', async () => {
  const workspace = await MdzipWorkspaceService.open(ROUND_TRIP, { mode: 'editable' });
  await workspace.openPath('manifest.json');
  const value = JSON.parse(workspace.snapshot().currentText);
  value.description = 'Set in the JSON editor';
  workspace.editText(JSON.stringify(value, null, 2));
  await workspace.openPath('index.md');
  const bytes = await workspace.saveToBytes();
  assert.equal(JSON.parse(await readTextFileFromArchive(bytes, 'manifest.json')).description, 'Set in the JSON editor');
});

test('other .json files are saved byte for byte, even when they are not valid JSON', async () => {
  const config = new TextEncoder().encode('{\n    "b": 1, "a": 2\n}\n');
  const bytes = await buildNewArchiveBytesWithTitle('# Doc\n', 'Doc', [{ archivePath: 'data/config.json', fileBytes: config }]);
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });
  await workspace.openPath('data/config.json');
  const edited = '{\n    "b": 1, "a": 2, // a comment\n}\n';
  workspace.editText(edited);
  assert.equal(workspace.validateJsonText('data/config.json', edited).status, 'invalid');
  assert.equal(workspace.manifestValidity(), null, 'only the manifest blocks saving');
  const saved = await workspace.saveToBytes();
  assert.equal(await readTextFileFromArchive(saved, 'data/config.json'), edited);
});

test('the manifest stays read-only in a read-only workspace', async () => {
  const workspace = await MdzipWorkspaceService.open(ROUND_TRIP, { mode: 'read-only' });
  await workspace.openPath('manifest.json');
  assert.throws(() => workspace.editText('{}'));
});

// --- View ------------------------------------------------------------------------

test('view: the JSON status line follows the open file, and a blocked save opens the manifest', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const validities = [];
  const failures = [];
  const view = new MdzipWorkspaceView(container, {
    initialLayout: 'split',
    initialColorScheme: 'light',
    onJsonValidityChanged: (validity, path) => validities.push([validity?.status ?? null, path]),
    onFailed: (error) => failures.push(error),
    onSaved: () => {}
  });
  try {
    await view.open(ROUND_TRIP, { mode: 'editable', fileName: 'round-trip.mdz' });
    const status = container.querySelector('[data-ref="json-status"]');
    assert.equal(status.hidden, true, 'no status line for Markdown');

    await view.openPath('manifest.json');
    assert.equal(status.hidden, false);
    assert.equal(status.textContent, 'Valid manifest');
    assert.deepEqual(validities.at(-1), ['valid', 'manifest.json']);
    assert.ok(container.querySelector('.edit-pane .cm-content'), 'the manifest opens in the editor');

    // Break it by typing (a change to the editor's text), go elsewhere, and save.
    const { EditorView } = await import('@codemirror/view');
    const cm = EditorView.findFromDOM(container.querySelector('.edit-pane .cm-editor'));
    const text = cm.state.doc.toString();
    cm.dispatch({ changes: { from: 0, to: text.length, insert: text.replace(/^\{/, '{\n  "mode": "slides",') } });
    assert.equal(view.getManifestValidity()?.canSave, false);
    await view.openPath('index.md');
    assert.equal(status.hidden, true);
    assert.deepEqual(validities.at(-1), [null, null]);

    container.querySelector('[data-ref="save-btn"]').click();
    for (let i = 0; i < 200 && !failures.length; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(failures[0] instanceof MdzipManifestInvalidError, String(failures[0]));
    for (let i = 0; i < 200 && view.getCurrentPath() !== 'manifest.json'; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(view.getCurrentPath(), 'manifest.json', 'the manifest is shown');
    assert.equal(status.hidden, false);
    assert.equal(status.dataset.status, 'invalid');
    assert.match(status.textContent, /Saving is blocked/);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('a text file in the preview is colored by its extension', async () => {
  const { renderPlainTextPreview } = await import('../dist/index.js');
  const json = renderPlainTextPreview('data/config.json', '{"a": "<b>", "n": 1}');
  assert.match(json, /^<pre class="plain-text-preview language-json"><code class="hljs">/);
  assert.match(json, /<span class="hljs-attr">&quot;a&quot;<\/span>/);
  assert.ok(!json.includes('<b>'), 'text is escaped');
  assert.match(renderPlainTextPreview('styles/site.css', 'a { color: red }'), /language-css/);
  const plain = renderPlainTextPreview('notes.txt', 'x < y');
  assert.equal(plain, '<pre class="plain-text-preview"><code>x &lt; y</code></pre>');
});
