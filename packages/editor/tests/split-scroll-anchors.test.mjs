import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Split view scroll sync (#13): the preview's top-level blocks are marked
// with their token's index, and matched to source offsets in the editor's
// text, which the sync pairs up to keep the panes together. jsdom has no
// layout, so the pixel side is checked in a browser; this covers the
// matching.
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
// No IntersectionObserver: every chunk mounts.
delete globalThis.window.IntersectionObserver;

const { MdzipWorkspaceView } = await import('../dist/index.js');

async function openSplit(source) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, { initialLayout: 'split', initialColorScheme: 'light' });
  await view.open(new TextEncoder().encode(source), { mode: 'editable', fileName: 'notes.md' });
  await view.whenRendered();
  for (let i = 0; i < 100 && !view.cmEditor; i += 1) await new Promise((r) => setTimeout(r, 10));
  return { view, container, cleanup: () => { view.destroy(); container.remove(); } };
}

// Each marked block, as [tag, the source line at its offset].
function blockLines(view) {
  const blocks = view.splitScrollBlocks();
  const text = view.cmEditor.state.doc.toString();
  return blocks.elements.map((element, i) => {
    const offset = blocks.offsets[i];
    return [element.tagName.toLowerCase(), text.slice(offset, text.indexOf('\n', offset))];
  });
}

const SOURCE = '---\ntitle: Notes\ntags: [a, b]\n---\n# Notes\n\nFirst paragraph.\n\n- one\n- two\n\n```js\nconst x = 1;\n```\n\n## Second\n\nLast paragraph.\n';

test('each preview block is matched to its first source line, after front matter', async () => {
  const { view, cleanup } = await openSplit(SOURCE);
  try {
    assert.deepEqual(blockLines(view), [
      ['h1', '# Notes'],
      ['p', 'First paragraph.'],
      ['ul', '- one'],
      ['pre', '```js'],
      ['h2', '## Second'],
      ['p', 'Last paragraph.']
    ]);
  } finally {
    cleanup();
  }
});

test('with the preview a render behind the editor, unchanged blocks still match, at their new lines', async () => {
  const { view, cleanup } = await openSplit(SOURCE);
  try {
    const before = view.splitScrollBlocks();
    // Typed in the editor; the preview hasn't rendered it yet.
    view.updatingCm = true;
    view.cmEditor.dispatch({
      changes: [
        { from: SOURCE.indexOf('# Notes'), insert: 'New intro.\n\n' },
        { from: SOURCE.indexOf('First paragraph.'), to: SOURCE.indexOf('First paragraph.') + 5, insert: 'Edited' }
      ]
    });
    view.updatingCm = false;
    assert.notEqual(view.splitScrollBlocks(), before, 'a new text: matched again');
    assert.deepEqual(blockLines(view), [
      ['h1', '# Notes'],
      ['ul', '- one'],
      ['pre', '```js'],
      ['h2', '## Second'],
      ['p', 'Last paragraph.']
    ], 'the edited paragraph is left out; the rest moved with the text');
  } finally {
    cleanup();
  }
});

test('without layout, the sync falls back to one ratio', async () => {
  const { view, cleanup } = await openSplit(SOURCE);
  try {
    assert.equal(view.splitScrollAnchors('editor', 0), null);
  } finally {
    cleanup();
  }
});
