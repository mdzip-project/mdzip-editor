import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Find in the View layout (#62): a find bar over the preview that searches
// the rendered text of the whole document, chunks not drawn yet included,
// and highlights with the CSS Custom Highlight API.
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
// jsdom has no highlight registry: a stand-in that records what's set.
const highlights = new Map();
window.CSS = { highlights };
window.Highlight = class extends Set {
  constructor(...ranges) { super(ranges); }
};
// An IntersectionObserver that never fires: chunks past the first batch stay undrawn.
window.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { MdzipWorkspaceView } = await import('../dist/index.js');
const { collectFindText, findPattern, findMatches, findRange } = await import('../dist/preview-find.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(assertion, attempts = 1000) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await wait(10);
    }
  }
  throw lastError;
}

// --- The text and the matching ---------------------------------------------------

test('the searched text is what the reader sees: no chrome, no diagrams, blocks kept apart', () => {
  const root = document.createElement('div');
  root.innerHTML = '<h1>Notes</h1><p>Some <strong>bold</strong>\ntext.</p>'
    + '<div class="mdzip-code-block"><div class="mdzip-code-block-header"><button>Copy</button>js</div><pre><code>x = 1</code></pre></div>'
    + '<svg><style>.a{}</style><text>diagram</text></svg><p>End</p>';
  const found = collectFindText(root);
  assert.equal(found.text, 'Notes\u0000Some bold\ntext.\u0000x = 1\u0000End');
  const pattern = findPattern('  some   BOLD text ', false);
  const matches = findMatches(found.text, pattern);
  assert.deepEqual(matches.map(([a, b]) => found.text.slice(a, b)), ['Some bold\ntext'], 'spaces match any whitespace; case ignored');
  assert.equal(findRange(found, ...matches[0]).toString(), 'Some bold\ntext', 'a range across the bold text');
  assert.deepEqual(findMatches(found.text, findPattern('Notes Some', false)), [], 'no match across two blocks');
  assert.deepEqual(findMatches(found.text, findPattern('some', true)), [], 'match case');
  assert.equal(findPattern('   ', false), null);
  assert.deepEqual(findMatches(found.text, findPattern('copy', false)), [], 'editor chrome is left out');
  assert.deepEqual(findMatches(found.text, findPattern('a.b', false)), [], 'the query is literal text');
});

// --- The find bar ------------------------------------------------------------------

function longDocument() {
  let markdown = '# Long document\n\n';
  for (let i = 0; i < 400; i += 1) {
    markdown += `Paragraph ${i} with some ordinary text${i >= 380 && i % 5 === 0 ? ', and a zebra' : ''}.\n\n`;
  }
  return markdown;
}

async function openView(options = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    initialLayout: 'preview', initialColorScheme: 'light', progressiveTextRendering: true, ...options
  });
  await view.open(new TextEncoder().encode(longDocument()), { mode: 'read-only', fileName: 'long.md' });
  await view.whenRendered();
  const $ = (ref) => container.querySelector(`[data-ref="${ref}"]`);
  const pressed = () => ['source', 'split', 'preview'].find((ref) => $(`${ref}-btn`).getAttribute('aria-pressed') === 'true');
  const type = (text) => {
    $('preview-find-input').value = text;
    $('preview-find-input').dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const key = (name, init = {}) => $('preview-find-input').dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
  const current = () => [...(highlights.get('mdzip-find-current') ?? [])].map((range) => range.toString());
  const zebraParagraph = () => [...container.querySelectorAll('[data-ref="preview-content"] p')].find((p) => /zebra/.test(p.textContent));
  return { view, container, $, pressed, type, key, current, zebraParagraph, cleanup: () => { view.destroy(); container.remove(); } };
}

test('in View, find opens a bar over the preview and the layout stays View', async () => {
  const { view, $, pressed, cleanup } = await openView();
  try {
    assert.equal(pressed(), 'preview');
    assert.equal(await view.openSearch(), true);
    assert.equal(pressed(), 'preview', 'still View');
    assert.equal($('preview-find').hidden, false);
    assert.equal(document.activeElement, $('preview-find-input'));
    assert.equal(view.isFindOpen, true);
    assert.equal(view.cmEditor, null, 'no source editor was created');
  } finally {
    cleanup();
  }
});

test('the count includes matches in chunks not drawn yet, and going to one draws it', async () => {
  const { view, $, type, key, current, zebraParagraph, cleanup } = await openView();
  try {
    const state = view.chunkedRenderState;
    assert.ok(state.cursor < state.records.length, 'sanity: the end of the document is not drawn');
    assert.equal(zebraParagraph(), undefined);
    await view.openSearch();
    type('zebra');
    await waitFor(() => assert.equal($('preview-find-count').textContent, '1 of 4'));
    // Typing pauses: the first match is drawn and becomes current.
    await waitFor(() => assert.ok(zebraParagraph(), 'the chunk with the match got drawn'));
    await waitFor(() => assert.deepEqual(current(), ['zebra']));
    assert.match(highlights.get('mdzip-find-current').values().next().value.startContainer.parentElement.textContent, /Paragraph 380/);
    key('Enter');
    await waitFor(() => assert.equal($('preview-find-count').textContent, '2 of 4'));
    key('Enter', { shiftKey: true });
    await waitFor(() => assert.equal($('preview-find-count').textContent, '1 of 4'));
    key('Enter', { shiftKey: true });
    await waitFor(() => assert.equal($('preview-find-count').textContent, '4 of 4', 'wraps around'));
    assert.equal(highlights.get('mdzip-find').size, 3, 'the other matches are highlighted too');
  } finally {
    cleanup();
  }
});

test('Escape closes the bar and clears every highlight; no results says so', async () => {
  const { view, $, type, key, cleanup } = await openView();
  try {
    await view.openSearch();
    type('ordinary');
    await waitFor(() => assert.ok(highlights.has('mdzip-find-current')));
    type('nothing like this');
    await waitFor(() => assert.equal($('preview-find-count').textContent, 'No results'));
    assert.ok($('preview-find').classList.contains('no-results'));
    assert.equal(highlights.has('mdzip-find-current'), false);
    type('ordinary');
    await waitFor(() => assert.ok(highlights.has('mdzip-find')));
    key('Escape');
    assert.equal($('preview-find').hidden, true);
    assert.equal(highlights.has('mdzip-find'), false);
    assert.equal(highlights.has('mdzip-find-current'), false);
    assert.equal(view.isFindOpen, false);
  } finally {
    cleanup();
  }
});

test('Split keeps the editor\'s find panel; leaving View closes the bar', async () => {
  const { view, $, pressed, cleanup } = await openView({ initialLayout: 'split' });
  try {
    assert.equal(await view.openSearch(), true);
    assert.equal(pressed(), 'split');
    assert.equal($('preview-find').hidden, true, 'no find bar in Split');
    assert.ok(view.cmEditor.dom.querySelector('.cm-search'), 'CodeMirror\'s panel');
    view.closeSearch();
    await view.setLayout('preview');
    await view.openSearch();
    assert.equal($('preview-find').hidden, false);
    await view.setLayout('split');
    assert.equal($('preview-find').hidden, true, 'closed on leaving View');
  } finally {
    cleanup();
  }
});

test('controls.search: false leaves find closed', async () => {
  const { view, $, cleanup } = await openView({ controls: { preset: 'viewer', search: false } });
  try {
    assert.equal(await view.openSearch(), false);
    assert.equal($('preview-find').hidden, true);
  } finally {
    cleanup();
  }
});
