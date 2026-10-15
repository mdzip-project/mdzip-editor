import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// GFM footnotes (#58).
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
// Inert IntersectionObserver: progressive rendering never mounts past the first batch on its own.
globalThis.window.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { MdzipWorkspaceView, defaultSafeMarkdownRenderer } = await import('../dist/index.js');

const SOURCE = [
  'Here is a statement with a footnote.[^1] And another one.[^note] Again.[^1]',
  '',
  'Not defined: [^missing].',
  '',
  '[^1]: The first footnote.',
  '[^note]: A named footnote with **formatting** and a [link](https://mdzip.org).',
  ''
].join('\n');

function render(markdown) {
  const container = globalThis.document.createElement('div');
  container.innerHTML = defaultSafeMarkdownRenderer.render(markdown);
  return container;
}

test('references render as superscript links to a footnotes section at the end, with back-links', () => {
  const container = render(SOURCE);
  const refs = [...container.querySelectorAll('sup > a')];
  assert.deepEqual(refs.map((a) => a.getAttribute('href')), ['#footnote-1', '#footnote-note', '#footnote-1']);
  assert.deepEqual(refs.map((a) => a.textContent), ['1', '2', '1']);

  const section = container.querySelector('section.footnotes');
  assert.ok(section, 'footnotes section');
  assert.equal(container.lastElementChild, section, 'section comes last');
  const items = [...section.querySelectorAll('li')];
  assert.deepEqual(items.map((li) => li.id), ['footnote-1', 'footnote-note']);
  assert.ok(items[0].querySelector('a[href="#footnote-ref-1"]'), 'back-link to the first reference');
  assert.ok(items[0].querySelector('a[href="#footnote-ref-1-2"]'), 'back-link to the second reference');
  assert.ok(container.querySelector('#footnote-ref-1'), 'reference ids survive sanitizing');
});

test('definitions keep inline formatting and links; undefined references stay literal', () => {
  const container = render(SOURCE);
  const named = container.querySelector('#footnote-note');
  assert.ok(named.querySelector('strong'));
  assert.equal(named.querySelector('a[href="https://mdzip.org"]')?.textContent, 'link');
  assert.match(container.textContent, /Not defined: \[\^missing\]\./);
});

test('rendering twice gives the same result (the extension keeps per-document state)', () => {
  const first = render(SOURCE).innerHTML;
  assert.equal(render('No footnotes here.').querySelector('section.footnotes'), null);
  assert.equal(render(SOURCE).innerHTML, first);
});

test('a footnote target in an unmounted progressive chunk is reachable', async () => {
  let source = 'Start.[^end]\n\n';
  for (let i = 0; i < 800; i += 1) {
    source += `Paragraph number ${i} with a little padding text so each block has real weight.\n\n`;
  }
  source += '[^end]: The very last note.\n';

  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'preview',
    initialColorScheme: 'light',
    progressiveTextRendering: true
  });
  try {
    await view.open(new TextEncoder().encode(source), { mode: 'read-only', fileName: 'notes.md' });
    await view.whenRendered();
    const preview = container.querySelector('[data-ref="preview-content"]');
    assert.equal(preview.querySelector('#footnote-end'), null, 'sanity: section not mounted yet');
    assert.equal(await view.scrollToAnchor('footnote-end'), true);
    assert.ok(preview.querySelector('#footnote-end'));
  } finally {
    view.destroy();
    container.remove();
  }
});
