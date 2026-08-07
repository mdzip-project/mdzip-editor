import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Same jsdom bootstrap as editor-context-menu.test.mjs: 'split' layout mounts
// CodeMirror alongside the preview, which needs a full DOM window.
// `pretendToBeVisual: true` also gives us a real requestAnimationFrame,
// which Copy All's chunk-draining loop yields on between batches.
if (typeof globalThis.window === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
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

// jsdom has no IntersectionObserver at all — install a controllable fake so
// the large-document tests can exercise the real viewport-gated sentinel
// path (and confirm Copy All tears it down rather than racing it) instead
// of only the eager no-IntersectionObserver fallback.
class FakeIntersectionObserver {
  static instances = [];
  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    FakeIntersectionObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  trigger(target) {
    this.callback([{ target, isIntersecting: true }], this);
  }
}
globalThis.window.IntersectionObserver = FakeIntersectionObserver;

import { MdzipWorkspaceView } from '../dist/index.js';
import { mdzipMermaidExtension } from '../dist/mermaid.js';

const MERMAID_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
  + '<g class="node"><rect style="fill:#fff" width="10" height="10"></rect></g>'
  + '</svg>';

// Minimal fake mermaid API — same shape as mermaid.test.mjs's fakeMermaid().
function fakeMermaid() {
  return {
    initialize() {},
    async render(id) {
      return { svg: MERMAID_SVG.replace('viewBox', `id="${id}" viewBox`) };
    }
  };
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A single flushMicrotasks() tick isn't reliable for the Copy All with
// Images flow: renderFullDocumentHtml/rewriteHtmlEmbeddingImages yield via
// requestAnimationFrame (~16ms) between batches, which can outlast a
// zero-delay setTimeout depending on scheduling. Poll instead.
async function waitFor(assertion, attempts = 50) {
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

async function mountView({
  source = '# Notes\n\nplain body text\n',
  mode = 'editable',
  controls = 'standalone-editor',
  ...viewOptions
} = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls,
    initialLayout: 'split',
    initialColorScheme: 'light',
    ...viewOptions
  });
  await view.open(new TextEncoder().encode(source), { mode, fileName: 'notes.md' });
  await view.whenRendered();
  return {
    view,
    container,
    previewPane: container.querySelector('[data-ref="preview-pane"]'),
    previewContent: container.querySelector('[data-ref="preview-content"]'),
    editorHost: container.querySelector('[data-ref="editor-host"]'),
    menu: container.querySelector('[data-ref="nav-menu"]'),
    cleanup() {
      FakeIntersectionObserver.instances.length = 0;
      view.destroy();
      container.remove();
    }
  };
}

function manyParagraphMarkdown(count) {
  let markdown = '# Large document\n\n';
  for (let i = 0; i < count; i += 1) {
    markdown += `Paragraph number ${i} with a little padding text so each block has real weight.\n\n`;
  }
  return markdown;
}

function openContextMenu(target, { x = 40, y = 40 } = {}) {
  target.dispatchEvent(new window.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y
  }));
}

function clickMenuAction(menu, action) {
  const button = menu.querySelector(`[data-menu-action="${action}"]`);
  assert.ok(button, `menu has an item for action "${action}"`);
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function selectionText() {
  return window.getSelection()?.toString() ?? '';
}

// Selects the first occurrence of `matchText` inside a text node under
// `root`, mimicking a user click-drag selection within the rendered preview.
function selectPreviewText(root, matchText) {
  const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const idx = node.textContent.indexOf(matchText);
    if (idx !== -1) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + matchText.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
  }
  throw new Error(`text not found in preview: ${matchText}`);
}

// Stubs the window clipboard for the duration of one test (mirrors
// tests/editor-context-menu.test.mjs's helper of the same name).
function stubClipboard(impl) {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { value: impl, configurable: true });
  return () => {
    if (original) {
      Object.defineProperty(window.navigator, 'clipboard', original);
    } else {
      delete window.navigator.clipboard;
    }
  };
}

function pressCtrlA(target) {
  target.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  document.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'a',
    ctrlKey: true,
    bubbles: true,
    cancelable: true
  }));
}

test('right-click over the rendered preview offers Copy All', async () => {
  const { previewPane, menu, cleanup } = await mountView();
  try {
    openContextMenu(previewPane);

    assert.equal(menu.hidden, false, 'menu is shown');
    assert.deepEqual(
      [...menu.querySelectorAll('[data-menu-action]')].map((el) => el.dataset.menuAction),
      ['preview-copy-all', 'preview-copy-all-images']
    );
  } finally {
    cleanup();
  }
});

test('Copy All writes the full rendered document to the clipboard, not a DOM selection', async () => {
  const { view, previewPane, menu, cleanup } = await mountView();
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    openContextMenu(previewPane);
    clickMenuAction(menu, 'preview-copy-all');
    await flushMicrotasks();

    assert.equal(written.length, 1);
    assert.ok(written[0].includes('Notes'), 'clipboard text covers the heading');
    assert.ok(written[0].includes('plain body text'), 'clipboard text covers the paragraph');
    assert.equal(selectionText(), '', 'Copy All no longer selects DOM text, it writes directly to the clipboard');
    assert.equal(view.elCopyToast.hidden, false, 'a confirmation toast is shown');
    assert.equal(view.elCopyToast.textContent, 'Plain text copied to clipboard');
  } finally {
    restore();
    cleanup();
  }
});

test('Ctrl+A scoped to the preview pane copies the rendered content to the clipboard, not the editor', async () => {
  const { view, previewPane, cleanup } = await mountView();
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    pressCtrlA(previewPane);
    assert.equal(document.activeElement, previewPane, 'clicking the preview focuses it');
    await flushMicrotasks();

    assert.equal(written.length, 1);
    assert.ok(written[0].includes('Notes'));
    assert.ok(written[0].includes('plain body text'));
    // The source editor's own selection must be untouched.
    assert.equal(view.cmEditor.state.selection.main.empty, true);
  } finally {
    restore();
    cleanup();
  }
});

test('Ctrl+A while the source editor has focus is left to CodeMirror', async () => {
  const { view, cleanup } = await mountView();
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    view.cmEditor.focus();
    view.cmEditor.dispatch({ selection: { anchor: 2, head: 2 } });

    document.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    }));
    await flushMicrotasks();

    // Our handler must not have intercepted this — Copy All only fires when
    // focus is inside the preview pane.
    assert.deepEqual(written, []);
  } finally {
    restore();
    cleanup();
  }
});

test('right-click over an existing preview selection offers Copy ahead of Copy All', async () => {
  const { previewPane, previewContent, menu, cleanup } = await mountView();
  try {
    selectPreviewText(previewContent, 'body');
    openContextMenu(previewPane);

    assert.deepEqual(
      [...menu.querySelectorAll('[data-menu-action]')].map((el) => el.dataset.menuAction),
      ['preview-copy', 'preview-copy-all', 'preview-copy-all-images']
    );
  } finally {
    cleanup();
  }
});

test('Copy writes the preview selection captured at right-click time to the clipboard', async () => {
  const { view, previewPane, previewContent, menu, cleanup } = await mountView();
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    selectPreviewText(previewContent, 'body');
    openContextMenu(previewPane);
    // Clicking the button collapses the live browser selection first, as it
    // would for a real click — Copy must still use the text captured at
    // right-click time, not whatever's selected by the time the handler runs.
    window.getSelection().removeAllRanges();
    clickMenuAction(menu, 'preview-copy');
    await flushMicrotasks();

    assert.deepEqual(written, ['body']);
    assert.equal(view.elCopyToast.hidden, false, 'a confirmation toast is shown');
    assert.equal(view.elCopyToast.textContent, 'Plain text copied to clipboard');
  } finally {
    restore();
    cleanup();
  }
});

test('a failed Copy shows the error in a toast instead of silently doing nothing', async () => {
  const { view, previewPane, previewContent, menu, cleanup } = await mountView();
  const failures = [];
  view.options.onFailed = (error) => failures.push(error);
  const restore = stubClipboard({ writeText: async () => { throw new Error('permission denied'); } });
  try {
    selectPreviewText(previewContent, 'body');
    openContextMenu(previewPane);
    window.getSelection().removeAllRanges();
    clickMenuAction(menu, 'preview-copy');
    await flushMicrotasks();

    assert.equal(view.elCopyToast.hidden, false, 'a failure toast is shown, not silence');
    assert.equal(view.elCopyToast.textContent, 'Copy failed: permission denied');
    assert.equal(failures.length, 1, 'still reported via onFailed too');
  } finally {
    restore();
    cleanup();
  }
});

test('contextMenu.preview: false falls through to the native menu', async () => {
  const { previewPane, menu, cleanup } = await mountView({
    controls: { preset: 'standalone-editor', contextMenu: { preview: false } }
  });
  try {
    const event = new window.MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 40, clientY: 40
    });
    previewPane.dispatchEvent(event);

    assert.equal(menu.hidden, true, 'our menu stays closed');
    assert.equal(event.defaultPrevented, false, 'the native menu is left alone');
  } finally {
    cleanup();
  }
});

test('contextMenu.preview: false does not affect the editor menu or preview Ctrl+A', async () => {
  const { previewPane, editorHost, menu, cleanup } = await mountView({
    controls: { preset: 'standalone-editor', contextMenu: { preview: false } }
  });
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    openContextMenu(editorHost);
    assert.equal(menu.hidden, false, 'editor menu is unaffected');
    menu.querySelector('[data-menu-action]')?.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    pressCtrlA(previewPane);
    await flushMicrotasks();
    assert.ok(written[0]?.includes('Notes'), 'keyboard Copy All is untouched by the menu flag');
  } finally {
    restore();
    cleanup();
  }
});

test('empty preview offers no context menu', async () => {
  const { previewPane, menu, cleanup } = await mountView({ source: '' });
  try {
    openContextMenu(previewPane);
    assert.equal(menu.hidden, true);
  } finally {
    cleanup();
  }
});

// --- Progressive rendering: dialog debounce, drain, and cancel ---

test('Copy All on a small progressively-rendered document copies instantly with no dialog', async () => {
  const { view, previewPane, cleanup } = await mountView({ progressiveTextRendering: true });
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    // A doc this small fits entirely in the initial synchronous batch, so
    // chunkedRenderState is already null by the time Copy All runs.
    assert.equal(view.chunkedRenderState, null, 'sanity: nothing left pending after the initial mount');

    pressCtrlA(previewPane);
    assert.equal(view.elCopyRenderDialog.hidden, true, 'dialog never shown for an instant copy');
    await flushMicrotasks();

    assert.equal(view.elCopyRenderDialog.hidden, true);
    assert.ok(written[0]?.includes('Notes'));
  } finally {
    restore();
    cleanup();
  }
});

test('Copy All on a large progressively-rendered document shows a progress dialog past the debounce, then completes the copy', async () => {
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    // Large enough that draining every remaining chunk takes noticeably
    // longer than the dialog's 200ms debounce (confirmed empirically —
    // smaller counts occasionally finished the whole drain before the first
    // check below ever ran).
    source: manyParagraphMarkdown(800)
  });
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    assert.ok(view.chunkedRenderState, 'sanity: more of the document is still unmounted');
    assert.ok(view.elPreviewContent.querySelector('.mdzip-chunk-sentinel'), 'sanity: scroll-driven sentinel is armed');

    const copyPromise = view.copyAllPreviewContent();
    assert.equal(view.elCopyRenderDialog.hidden, true, 'debounce has not elapsed yet');

    await wait(260);
    assert.equal(view.elCopyRenderDialog.hidden, false, 'dialog appears once the wait clears the debounce');
    assert.ok(view.copyRenderDialogState.total > 0);

    await copyPromise;

    // The write doesn't fire automatically once rendering finishes — the
    // async Clipboard API needs a *recent* user gesture, and a render this
    // long has already burned through the one that started Copy All. The
    // dialog switches to a "ready to copy" state with its own Copy button
    // instead, so the write gets a fresh gesture to run inside.
    assert.equal(view.elCopyRenderDialog.hidden, false, 'dialog stays visible, now asking to confirm the copy');
    assert.equal(view.copyRenderDialogState, null, 'progress state is cleared');
    assert.ok(view.copyReadyState, 'armed, waiting for the Copy button');
    assert.equal(view.chunkedRenderState, null, 'every chunk is now mounted');
    assert.equal(view.elPreviewContent.querySelector('.mdzip-chunk-sentinel'), null, 'no sentinel left — nothing more to mount');
    assert.equal(written.length, 0, 'nothing copied yet — waiting on the Copy button click');

    view.elCopyRenderDialog.querySelector('[data-action="confirm-copy-ready"]').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    // Wait for the *done* state specifically, not just written.length — the
    // clipboard stub resolving is not the same instant as
    // finishCopyNotification actually running afterward.
    await waitFor(() => assert.equal(view.copyRenderDoneState?.message, 'Plain text copied to clipboard'));

    assert.equal(written.length, 1);
    assert.ok(written[0].includes('Paragraph number 799'), 'the full document, including the last paragraph, was copied');

    view.elCopyRenderDialog.querySelector('[data-action="dismiss-copy-render"]').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    assert.equal(view.elCopyRenderDialog.hidden, true, 'dismiss button hides the dialog');
  } finally {
    restore();
    cleanup();
  }
});

test('cancelling the Copy All dialog aborts the drain without writing to the clipboard', async () => {
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    source: manyParagraphMarkdown(1200)
  });
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    const copyPromise = view.copyAllPreviewContent();
    await wait(260);
    assert.equal(view.elCopyRenderDialog.hidden, false, 'dialog is up before we cancel');

    const cursorBeforeCancel = view.chunkedRenderState?.cursor;
    view.elCopyRenderDialog.querySelector('[data-action="cancel-copy-render"]').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    await copyPromise;

    assert.deepEqual(written, [], 'cancelling must not write anything to the clipboard');
    assert.equal(view.elCopyRenderDialog.hidden, true, 'dialog is dismissed on cancel');
    assert.ok(view.chunkedRenderState, 'the document is still only partially mounted');
    assert.ok(
      view.chunkedRenderState.cursor < view.chunkedRenderState.chunks.length,
      'sanity: the cancel actually landed mid-drain, not after it finished on its own'
    );
    assert.ok(
      cursorBeforeCancel === undefined || view.chunkedRenderState.cursor >= cursorBeforeCancel,
      'progress made before cancelling is preserved, not thrown away'
    );
    assert.ok(
      view.elPreviewContent.querySelector('.mdzip-chunk-sentinel'),
      'scroll-driven continuation is re-armed for whatever is left'
    );
  } finally {
    restore();
    cleanup();
  }
});

// --- Copy All with Images ---

test('the context menu offers "Copy All with Images" alongside "Copy All"', async () => {
  const { previewPane, menu, cleanup } = await mountView();
  try {
    openContextMenu(previewPane);
    const labels = [...menu.querySelectorAll('[data-menu-action]')].map((el) => el.textContent);
    assert.ok(labels.some((label) => label.includes('Copy All with Images')));
  } finally {
    cleanup();
  }
});

test('Copy All with Images falls back to a plain-text write when the browser has no ClipboardItem', async () => {
  // jsdom (this test's environment) doesn't implement ClipboardItem at all,
  // so this exercises the real fallback, not a simulated one.
  assert.equal(typeof window.ClipboardItem, 'undefined', 'sanity: jsdom has no ClipboardItem');
  const { previewPane, menu, cleanup } = await mountView();
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    openContextMenu(previewPane);
    clickMenuAction(menu, 'preview-copy-all-images');
    await waitFor(() => assert.equal(written.length, 1));

    assert.ok(written[0].includes('Notes'));
    assert.ok(written[0].includes('plain body text'));
  } finally {
    restore();
    cleanup();
  }
});

test('Copy All with Images writes a rich text/html + text/plain ClipboardItem when the browser supports it', async () => {
  const { view, previewPane, menu, cleanup } = await mountView();
  const originalClipboardItem = window.ClipboardItem;
  window.ClipboardItem = class FakeClipboardItem {
    constructor(parts) { this.parts = parts; }
  };
  const written = [];
  const restore = stubClipboard({
    writeText: async () => { throw new Error('should not use the plain-text path when write() succeeds'); },
    write: async (items) => { written.push(...items); }
  });
  try {
    openContextMenu(previewPane);
    clickMenuAction(menu, 'preview-copy-all-images');
    await waitFor(() => assert.equal(written.length, 1));
    const [item] = written;
    // The view's own module scope resolves the bare `Blob` global (Node's,
    // not jsdom's window.Blob, which is a distinct constructor in this
    // process) — assert shape instead of identity.
    assert.equal(typeof item.parts['text/html'].text, 'function');
    assert.equal(typeof item.parts['text/plain'].text, 'function');
    const html = await item.parts['text/html'].text();
    assert.ok(html.includes('Notes'));
    const text = await item.parts['text/plain'].text();
    assert.ok(text.includes('plain body text'));
    assert.equal(view.elCopyToast.hidden, false, 'a confirmation toast is shown');
    assert.equal(
      view.elCopyToast.textContent,
      'HTML copied to clipboard',
      'this fixture has no images, so the toast omits the count — but it is still an HTML (rich) write, not plain text'
    );
  } finally {
    window.ClipboardItem = originalClipboardItem;
    restore();
    cleanup();
  }
});

test('writeRichClipboard\'s confirmation message names the type (HTML) and image count', async () => {
  const { view, cleanup } = await mountView();
  const originalClipboardItem = window.ClipboardItem;
  window.ClipboardItem = class FakeClipboardItem {
    constructor(parts) { this.parts = parts; }
  };
  const written = [];
  const restore = stubClipboard({
    writeText: async (text) => { written.push(text); },
    write: async (items) => { written.push(...items); }
  });
  try {
    // Exercise the message wording directly — building a real archive with
    // embedded images just to drive this through the menu is more machinery
    // than the wording itself needs; the embedding logic is already covered
    // end-to-end in asset-cache.test.mjs and via live browser verification.
    // writeRichClipboard only returns the outcome now — showing it (toast vs
    // the persistent dialog) is finishCopyNotification's job, exercised by
    // the other Copy All with Images tests.
    const outcome2 = await view.writeRichClipboard('<p>hi</p><img src="a"><img src="b">', 'hi', 2);
    assert.deepEqual(outcome2, { message: 'HTML with 2 images copied to clipboard' });

    const outcome1 = await view.writeRichClipboard('<p>hi</p><img src="a">', 'hi', 1);
    assert.deepEqual(outcome1, { message: 'HTML with 1 image copied to clipboard' }, 'singular, not "1 images"');

    const outcome0 = await view.writeRichClipboard('<p>hi</p>', 'hi', 0);
    assert.deepEqual(outcome0, { message: 'HTML copied to clipboard' }, 'still HTML even with no images, not "plain text"');
  } finally {
    window.ClipboardItem = originalClipboardItem;
    restore();
    cleanup();
  }
});

test('Copy All with Images falls back to plain text if the rich clipboard write itself throws', async () => {
  const failures = [];
  const { previewPane, menu, cleanup } = await mountView({ onFailed: (error) => failures.push(error) });
  const originalClipboardItem = window.ClipboardItem;
  window.ClipboardItem = class FakeClipboardItem {
    constructor(parts) { this.parts = parts; }
  };
  const written = [];
  const restore = stubClipboard({
    writeText: async (text) => { written.push(text); },
    write: async () => { throw new Error('clipboard rejected the payload'); }
  });
  try {
    openContextMenu(previewPane);
    clickMenuAction(menu, 'preview-copy-all-images');
    await waitFor(() => assert.equal(written.length, 1, 'falls back to a plain-text write'));

    assert.ok(written[0].includes('Notes'));
    assert.equal(failures.length, 1, 'the rich-write failure is still surfaced via onFailed');
  } finally {
    window.ClipboardItem = originalClipboardItem;
    restore();
    cleanup();
  }
});

test('Copy All with Images falls back to Copy All\'s plain-text behavior for a custom (non-chunking) renderer', async () => {
  const customRenderer = { render: (markdown) => `<p>custom:${markdown.length}</p>` };
  const failures = [];
  const { previewPane, menu, cleanup } = await mountView({
    markdownRenderer: customRenderer,
    onFailed: (error) => failures.push(error)
  });
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    openContextMenu(previewPane);
    clickMenuAction(menu, 'preview-copy-all-images');
    await waitFor(() => assert.equal(written.length, 1));

    assert.ok(written[0].includes('custom:'));
    assert.deepEqual(failures, [], 'no error surfaced for the unsupported combination');
  } finally {
    restore();
    cleanup();
  }
});

test('Copy All with Images on a large document leaves the dialog up in a dismissable "done" state', async () => {
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    source: manyParagraphMarkdown(20000)
  });
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    const copyPromise = view.copyAllWithImagesPreviewContent();
    await wait(260);
    assert.equal(view.elCopyRenderDialog.hidden, false, 'dialog is up before completion');

    await copyPromise;

    assert.equal(view.elCopyRenderDialog.hidden, false, 'dialog stays visible, now asking to confirm the copy');
    assert.equal(view.copyRenderDialogState, null);
    assert.ok(view.copyReadyState, 'armed, waiting for the Copy button — the write needs a fresh user gesture');
    assert.equal(written.length, 0, 'nothing copied yet');

    view.elCopyRenderDialog.querySelector('[data-action="confirm-copy-ready"]').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    // jsdom has no ClipboardItem, so this falls back to the plain-text
    // write path — the HTML/rich wording is covered separately.
    await waitFor(() => assert.equal(view.copyRenderDoneState?.message, 'Plain text copied to clipboard'));
    assert.equal(written.length, 1);

    view.elCopyRenderDialog.querySelector('[data-action="dismiss-copy-render"]').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    assert.equal(view.elCopyRenderDialog.hidden, true, 'dismiss button hides the dialog');
  } finally {
    restore();
    cleanup();
  }
});

test('cancelling Copy All with Images aborts without writing to the clipboard', async () => {
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    // renderFullDocumentHtml has no DOM-insertion cost (pure string
    // concatenation, unlike Copy All's chunk-mounting drain), so it needs a
    // much larger document than plain Copy All's cancel test to still be
    // mid-render past the debounce.
    source: manyParagraphMarkdown(20000)
  });
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    const copyPromise = view.copyAllWithImagesPreviewContent();
    await wait(260);
    assert.equal(view.elCopyRenderDialog.hidden, false, 'dialog is up before we cancel');

    view.elCopyRenderDialog.querySelector('[data-action="cancel-copy-render"]').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    await copyPromise;

    assert.deepEqual(written, [], 'cancelling must not write anything to the clipboard');
    assert.equal(view.elCopyRenderDialog.hidden, true, 'dialog is dismissed on cancel');
  } finally {
    restore();
    cleanup();
  }
});

test('cancelling at the "ready to copy" stage discards without writing to the clipboard', async () => {
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    source: manyParagraphMarkdown(20000)
  });
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    const copyPromise = view.copyAllWithImagesPreviewContent();
    await wait(260);
    await copyPromise;
    assert.ok(view.copyReadyState, 'armed waiting for the Copy button click');

    view.elCopyRenderDialog.querySelector('[data-action="cancel-copy-ready"]').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );

    assert.equal(view.copyReadyState, null);
    assert.equal(view.elCopyRenderDialog.hidden, true, 'dialog closes, no done state shown');
    assert.deepEqual(written, [], 'declining to copy must not write anything');
  } finally {
    restore();
    cleanup();
  }
});

test('opening a different document while a "ready to copy" dialog is showing discards it (its captured content is now stale)', async () => {
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    source: manyParagraphMarkdown(20000)
  });
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    const copyPromise = view.copyAllWithImagesPreviewContent();
    await wait(260);
    await copyPromise;
    assert.ok(view.copyReadyState, 'armed waiting for the Copy button click');

    // Open a new, unrelated document while the stale one is still "ready".
    await view.open(new TextEncoder().encode('# Something else\n\nunrelated content\n'), { mode: 'editable', fileName: 'other.md' });

    assert.equal(view.copyReadyState, null, 'the stale ready-to-copy state must not survive a document swap');
    assert.equal(view.elCopyRenderDialog.hidden, true);

    // Sanity: even if something still tried to click Copy, there is nothing
    // armed to perform, so this is a no-op — proving the guard actually
    // prevents copying the old document's content, not just hiding the UI.
    view.elCopyRenderDialog.querySelector('[data-action="confirm-copy-ready"]').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    await flushMicrotasks();
    assert.deepEqual(written, [], 'nothing from the stale prepared copy is ever written');
  } finally {
    restore();
    cleanup();
  }
});

test('Copy All with Images on a large document shows a visible failure instead of silently vanishing when the write fails', async () => {
  // A document large enough to have shown the progress dialog has
  // non-empty text by construction — if both the rich write and its
  // plain-text fallback fail, the dialog must not just quietly disappear
  // with no explanation (a real bug this test guards against: it used to).
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    source: manyParagraphMarkdown(20000)
  });
  const failures = [];
  view.options.onFailed = (error) => failures.push(error);
  const originalClipboardItem = window.ClipboardItem;
  window.ClipboardItem = class FakeClipboardItem {
    constructor(parts) { this.parts = parts; }
  };
  const restore = stubClipboard({
    write: async () => { throw new Error('clipboard rejected the payload'); },
    writeText: async () => { throw new Error('clipboard rejected the fallback too'); }
  });
  try {
    const copyPromise = view.copyAllWithImagesPreviewContent();
    await wait(260);
    assert.equal(view.elCopyRenderDialog.hidden, false, 'dialog is up during the copy');

    await copyPromise;
    assert.ok(view.copyReadyState, 'rendering succeeded — armed waiting for the Copy button click');

    view.elCopyRenderDialog.querySelector('[data-action="confirm-copy-ready"]').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    // Wait for the done state itself, not just onFailed firing — two
    // failures happen in sequence here (rich write, then its plain-text
    // fallback) before finishCopyNotification runs.
    await waitFor(() => assert.match(view.copyRenderDoneState?.message ?? '', /failed/i));

    assert.equal(view.elCopyRenderDialog.hidden, false, 'dialog stays visible to show the failure, not silently hidden');
    assert.equal(view.copyRenderDialogState, null);
    // The actual error text is shown inline — onFailed is a host callback
    // with no guaranteed visible surface, so the dialog can't just say
    // "see the error" and assume there's somewhere for the user to look.
    assert.ok(failures.length >= 1, 'the underlying error(s) are still reported via onFailed');
    assert.ok(
      view.copyRenderDoneState?.message.includes('clipboard rejected the fallback too'),
      `expected the fallback's error text in the message, got: ${view.copyRenderDoneState?.message}`
    );

    view.elCopyRenderDialog.querySelector('[data-action="dismiss-copy-render"]').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    assert.equal(view.elCopyRenderDialog.hidden, true, 'dismiss button still works on the failure state');
  } finally {
    window.ClipboardItem = originalClipboardItem;
    restore();
    cleanup();
  }
});

test('a clipboard write that never settles is treated as a failure instead of hanging forever', async () => {
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    source: manyParagraphMarkdown(20000)
  });
  const failures = [];
  view.options.onFailed = (error) => failures.push(error);
  // Real production timeouts are 30s/15s — override to keep this test fast
  // while still genuinely exercising withTimeout firing, not just mocking
  // it away.
  view.clipboardWriteTimeoutMs = 50;
  view.clipboardFallbackWriteTimeoutMs = 50;
  const originalClipboardItem = window.ClipboardItem;
  window.ClipboardItem = class FakeClipboardItem {
    constructor(parts) { this.parts = parts; }
  };
  // Never resolves or rejects — simulates a real OS clipboard hanging on an
  // oversized payload, which withTimeout is specifically meant to recover
  // from.
  const restore = stubClipboard({
    write: () => new Promise(() => {}),
    writeText: () => new Promise(() => {})
  });
  try {
    const copyPromise = view.copyAllWithImagesPreviewContent();
    await wait(260);
    assert.equal(view.elCopyRenderDialog.hidden, false, 'dialog is up during the copy');

    await copyPromise;
    assert.ok(view.copyReadyState, 'armed waiting for the Copy button click');

    view.elCopyRenderDialog.querySelector('[data-action="confirm-copy-ready"]').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    // withTimeout uses real setTimeout, so this genuinely waits out the
    // (overridden, 50ms) timeouts rather than being mocked away.
    await waitFor(() => assert.match(view.copyRenderDoneState?.message ?? '', /failed/i));

    assert.equal(view.elCopyRenderDialog.hidden, false, 'dialog surfaces the timeout as a failure, not a silent hang');
    assert.match(
      view.copyRenderDoneState?.message ?? '',
      /timed out/i,
      'the timeout message itself is visible inline, not just reported to onFailed'
    );
    assert.ok(
      failures.some((e) => /timed out/i.test(e instanceof Error ? e.message : String(e))),
      'a timeout error specifically is reported, not left unexplained'
    );
  } finally {
    window.ClipboardItem = originalClipboardItem;
    restore();
    cleanup();
  }
});

// Fakes the editor being scrolled to (or away from) the document's true end.
// "At the bottom" is detected via CodeMirror's own viewport (viewport.to vs
// state.doc.length), not a scrollHeight/scrollTop pixel comparison — jsdom
// never computes real layout anyway (scrollHeight/clientHeight are always
// 0), and pixel comparison turned out to be the wrong tool even in a real
// browser: CodeMirror estimates the height of not-yet-measured (virtualized)
// lines, and on a huge real document that estimate can be tens of pixels off
// from where it actually clamps scrollTop (confirmed live against an
// 88,000-line file), so a fixed pixel epsilon never matched there either.
function setEditorAtDocEnd(view, atEnd) {
  Object.defineProperty(view.cmEditor, 'viewport', {
    configurable: true,
    get: () => ({ from: 0, to: atEnd ? view.cmEditor.state.doc.length : 10 })
  });
}

test('scrolling the editor to its true bottom routes to the force-drain path, not an ordinary ratio-based jump', async () => {
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    source: manyParagraphMarkdown(800)
  });
  try {
    assert.ok(view.chunkedRenderState, 'sanity: more of the document is still unmounted');
    setEditorAtDocEnd(view, true);

    let bottomDrainCalls = 0;
    view.syncScrollToPreviewBottom = () => { bottomDrainCalls += 1; return Promise.resolve(); };

    view.syncScrollToPreview();

    assert.equal(bottomDrainCalls, 1, 'editor at the document end routes through the force-drain path');
  } finally {
    cleanup();
  }
});

test('syncScrollToPreviewBottom force-drains remaining chunks and jumps the preview to its real (fully-mounted) bottom', async () => {
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    source: manyParagraphMarkdown(800)
  });
  try {
    assert.ok(view.chunkedRenderState, 'sanity: more of the document is still unmounted');
    setEditorAtDocEnd(view, true);

    // jsdom never computes real layout, so the preview's scrollHeight is
    // faked here, tied to how many paragraphs are actually mounted — the
    // final assertion can then distinguish a jump computed before the drain
    // from one computed after it.
    Object.defineProperty(view.elPreviewPane, 'scrollHeight', {
      configurable: true,
      get: () => 100 + view.elPreviewContent.querySelectorAll('p').length * 20
    });
    Object.defineProperty(view.elPreviewPane, 'clientHeight', { value: 500, configurable: true });
    let previewScrollTop = 0;
    Object.defineProperty(view.elPreviewPane, 'scrollTop', {
      configurable: true,
      get: () => previewScrollTop,
      set: (value) => { previewScrollTop = value; }
    });

    // Called directly (not via a poll loop): the drain yields across many
    // real animation frames, and jsdom's requestAnimationFrame timer
    // pathologically slows down (measured ~80x) when interleaved with a
    // concurrent setTimeout-based polling loop on the same event loop —
    // a single direct await avoids that entirely.
    await view.syncScrollToPreviewBottom();

    assert.equal(view.chunkedRenderState, null, 'every chunk mounted by the forced drain');
    const paragraphCount = view.elPreviewContent.querySelectorAll('p').length;
    assert.equal(paragraphCount, 800, 'every paragraph mounted, not just the initial batch');
    const expectedTarget = (100 + paragraphCount * 20) - 500;
    assert.equal(
      previewScrollTop,
      expectedTarget,
      'lands at the real (fully-mounted) bottom, not wherever mounting had reached before the drain'
    );
  } finally {
    cleanup();
  }
});

test('syncScrollToPreviewBottom leaves the preview alone if the editor scrolls away from the bottom before the drain finishes', async () => {
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    source: manyParagraphMarkdown(800)
  });
  try {
    assert.ok(view.chunkedRenderState, 'sanity: more of the document is still unmounted');
    setEditorAtDocEnd(view, true);

    Object.defineProperty(view.elPreviewPane, 'scrollHeight', {
      configurable: true,
      get: () => 100 + view.elPreviewContent.querySelectorAll('p').length * 20
    });
    Object.defineProperty(view.elPreviewPane, 'clientHeight', { value: 500, configurable: true });
    let previewScrollTop = 0;
    Object.defineProperty(view.elPreviewPane, 'scrollTop', {
      configurable: true,
      get: () => previewScrollTop,
      set: (value) => { previewScrollTop = value; }
    });

    const drainPromise = view.syncScrollToPreviewBottom();
    // A single one-shot timer (not a poll loop — see the note in the test
    // above about why polling alongside this drain is pathologically slow),
    // fired well before the ~800-paragraph drain finishes, simulating the
    // user scrolling the editor away from the bottom mid-drain.
    setTimeout(() => setEditorAtDocEnd(view, false), 50);
    await drainPromise;

    assert.equal(view.chunkedRenderState, null, 'the drain still runs to completion');
    assert.equal(previewScrollTop, 0, 'no stale bottom-jump applied once the editor is no longer at its bottom');
  } finally {
    cleanup();
  }
});

test('syncScrollToPreviewBottom shows a progress toast past a debounce, then hides it once the drain finishes', async () => {
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    source: manyParagraphMarkdown(800)
  });
  try {
    assert.ok(view.chunkedRenderState, 'sanity: more of the document is still unmounted');
    setEditorAtDocEnd(view, true);

    Object.defineProperty(view.elPreviewPane, 'scrollHeight', {
      configurable: true,
      get: () => 100 + view.elPreviewContent.querySelectorAll('p').length * 20
    });
    Object.defineProperty(view.elPreviewPane, 'clientHeight', { value: 500, configurable: true });
    let previewScrollTop = 0;
    Object.defineProperty(view.elPreviewPane, 'scrollTop', {
      configurable: true,
      get: () => previewScrollTop,
      set: (value) => { previewScrollTop = value; }
    });

    const drainPromise = view.syncScrollToPreviewBottom();
    assert.equal(view.elCopyToast.hidden, true, 'debounce has not elapsed yet');

    await wait(260);
    assert.equal(view.elCopyToast.hidden, false, 'toast appears once the wait clears the debounce');
    assert.match(view.elCopyToast.textContent, /Catching up the preview/);

    await drainPromise;

    assert.equal(view.elCopyToast.hidden, true, 'toast is hidden again once the drain (and jump) finish');
    assert.ok(previewScrollTop > 0, 'sanity: the jump itself still happened');
  } finally {
    cleanup();
  }
});

test('a chunk drained by a concurrent scroll-to-bottom catch-up is not re-rendered by Copy All with Images', async () => {
  let renderCount = 0;
  const extension = {
    name: 'count-renders',
    transformHtml: (html) => { renderCount += 1; return html; }
  };
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    markdownExtensions: [extension],
    source: manyParagraphMarkdown(800)
  });
  const originalClipboardItem = window.ClipboardItem;
  window.ClipboardItem = class FakeClipboardItem {
    constructor(parts) { this.parts = parts; }
  };
  const written = [];
  const restore = stubClipboard({
    writeText: async () => {},
    write: async (items) => { written.push(...items); }
  });
  try {
    assert.ok(view.chunkedRenderState, 'sanity: still unmounted chunks');
    const totalChunks = view.chunkedRenderState.chunks.length;

    // Genuine overlap: neither call is awaited before the other starts, so
    // the scroll-driven catch-up drain and Copy All with Images's own
    // render race through the same chunk indices.
    await Promise.all([
      view.syncScrollToPreviewBottom(),
      view.copyAllWithImagesPreviewContent()
    ]);

    assert.equal(view.chunkedRenderState, null, 'sanity: the drain completed');
    assert.equal(written.length, 1, 'sanity: the copy completed');
    assert.equal(
      renderCount,
      totalChunks,
      'each chunk was rendered exactly once total across both call sites, not once per call site'
    );
  } finally {
    window.ClipboardItem = originalClipboardItem;
    restore();
    cleanup();
  }
});

test('an edit that happens while Copy All with Images is still rendering does not corrupt the shared cache for later copies', async () => {
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    source: manyParagraphMarkdown(800)
  });
  const originalClipboardItem = window.ClipboardItem;
  window.ClipboardItem = class FakeClipboardItem {
    constructor(parts) { this.parts = parts; }
  };
  const written = [];
  const restore = stubClipboard({
    writeText: async () => {},
    write: async (items) => { written.push(...items); }
  });
  try {
    assert.ok(view.chunkedRenderState, 'sanity: still unmounted chunks (large doc)');

    const copyPromise = view.copyAllWithImagesPreviewContent();
    // Let some chunks render (and get cached under the pre-edit generation)
    // before editing mid-flight, without waiting for the whole copy to finish.
    await waitFor(() => assert.ok(view.chunkHtmlCache && view.chunkHtmlCache.html.size > 0), 200);
    view.workspace.editText(manyParagraphMarkdown(800).replace('Paragraph number 0 ', 'REPLACED PARAGRAPH ZERO '));
    await copyPromise;

    assert.equal(written.length, 1, 'the in-flight copy (against the pre-edit snapshot) still completes');
    const firstHtml = await written[0].parts['text/html'].text();
    assert.ok(firstHtml.includes('>Paragraph number 0 '), 'reflects the snapshot captured when Copy All started, not the edit');

    // The real correctness check: once the preview catches up to the edit
    // and a fresh copy is made, nothing stale from the in-flight (now
    // superseded) render should have leaked into the shared cache.
    await waitFor(() => assert.ok(view.elPreviewContent.textContent.includes('REPLACED PARAGRAPH ZERO')));
    await view.copyAllWithImagesPreviewContent();
    assert.equal(written.length, 2);
    const secondHtml = await written[1].parts['text/html'].text();
    assert.ok(secondHtml.includes('REPLACED PARAGRAPH ZERO'), 'reflects the edit');
    assert.ok(!secondHtml.includes('>Paragraph number 0 <'), 'no stale pre-edit content leaked in from the cache');
  } finally {
    window.ClipboardItem = originalClipboardItem;
    restore();
    cleanup();
  }
});

test('a chunk containing a mermaid diagram is reused verbatim (same id) by Copy All with Images instead of being re-rendered', async () => {
  const extension = mdzipMermaidExtension({ loadMermaid: async () => fakeMermaid() });
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    markdownExtensions: [extension],
    source: '# Doc\n\n```mermaid\ngraph TD; A-->B;\n```\n'
  });
  const originalClipboardItem = window.ClipboardItem;
  window.ClipboardItem = class FakeClipboardItem {
    constructor(parts) { this.parts = parts; }
  };
  const written = [];
  const restore = stubClipboard({
    writeText: async () => {},
    write: async (items) => { written.push(...items); }
  });
  try {
    await waitFor(() => assert.ok(view.elPreviewContent.querySelector('svg[id^="mdzip-mermaid-"]')));
    const mountedId = view.elPreviewContent.querySelector('svg[id^="mdzip-mermaid-"]').id;

    await view.copyAllWithImagesPreviewContent();
    assert.equal(written.length, 1);
    const html = await written[0].parts['text/html'].text();
    const match = html.match(/id="(mdzip-mermaid-\d+)"/);
    assert.ok(match, 'clipboard HTML contains the mermaid svg id');
    assert.equal(
      match[1],
      mountedId,
      'the cached chunk (including its mermaid id) was reused, not re-rendered with a new counter value'
    );
  } finally {
    window.ClipboardItem = originalClipboardItem;
    restore();
    cleanup();
  }
});

test('Copy All with Images still succeeds correctly for a mermaid chunk the live preview has not mounted yet (cache miss)', async () => {
  const extension = mdzipMermaidExtension({ loadMermaid: async () => fakeMermaid() });
  const { view, cleanup } = await mountView({
    progressiveTextRendering: true,
    markdownExtensions: [extension],
    source: '# Doc\n\n```mermaid\ngraph TD; A-->B;\n```\n'
  });
  const originalClipboardItem = window.ClipboardItem;
  window.ClipboardItem = class FakeClipboardItem {
    constructor(parts) { this.parts = parts; }
  };
  const written = [];
  const restore = stubClipboard({
    writeText: async () => {},
    write: async (items) => { written.push(...items); }
  });
  try {
    // Copy immediately, without waiting for the live preview to mount the
    // mermaid chunk first — exercises the cache-miss path on its own.
    await view.copyAllWithImagesPreviewContent();
    assert.equal(written.length, 1);
    const html = await written[0].parts['text/html'].text();
    assert.match(html, /id="mdzip-mermaid-\d+"/, 'a valid, independently-rendered mermaid svg id is still produced');
  } finally {
    window.ClipboardItem = originalClipboardItem;
    restore();
    cleanup();
  }
});
