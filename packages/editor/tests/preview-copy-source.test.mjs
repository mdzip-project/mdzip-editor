import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Copy HTML / Copy Markdown in the preview menu (#56). Same bootstrap as
// preview-copy-all.test.mjs.
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

// Inert IntersectionObserver: progressive rendering leaves the tail unmounted.
globalThis.window.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { MdzipWorkspaceView } = await import('../dist/index.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(assertion, attempts = 300) {
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

async function mountView({ bytes, fileName = 'notes.md', mode = 'editable', ...viewOptions }) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'split',
    initialColorScheme: 'light',
    ...viewOptions
  });
  await view.open(bytes, { mode, fileName });
  // Not whenRendered(): it waits for image hydration, which never completes in jsdom.
  const previewContent = container.querySelector('[data-ref="preview-content"]');
  await waitFor(() => assert.ok(previewContent.querySelector('h1')));
  return {
    view,
    previewPane: container.querySelector('[data-ref="preview-pane"]'),
    menu: container.querySelector('[data-ref="nav-menu"]'),
    cleanup() {
      view.destroy();
      container.remove();
    }
  };
}

function openContextMenu(target) {
  target.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
}

function clickMenuAction(menu, action) {
  const button = menu.querySelector(`[data-menu-action="${action}"]`);
  assert.ok(button, `menu has an item for action "${action}"`);
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function stubClipboard() {
  const written = [];
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: async (text) => { written.push(text); } },
    configurable: true
  });
  return {
    written,
    restore() {
      if (original) Object.defineProperty(window.navigator, 'clipboard', original);
      else delete window.navigator.clipboard;
    }
  };
}

test('Copy HTML writes the rendered markup as plain text, with archive-relative image paths', async () => {
  // A .md source: jsdom never fires image load events, so an archive whose image
  // actually hydrates would keep whenRendered() waiting.
  const bytes = new TextEncoder().encode('# Notes\n\nSome **bold** text.\n\n![Logo](images/logo.png)\n');
  const { view, previewPane, menu, cleanup } = await mountView({ bytes });
  const clipboard = stubClipboard();
  try {
    openContextMenu(previewPane);
    clickMenuAction(menu, 'preview-copy-html');
    await waitFor(() => assert.equal(clipboard.written.length, 1));

    const html = clipboard.written[0];
    assert.match(html, /<h1 id="user-content-notes">Notes<\/h1>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<img[^>]+src="images\/logo\.png"/, 'image keeps its archive path, not a blob: URL');
    assert.doesNotMatch(html, /blob:|mdzip-chunk-sentinel/);
    await waitFor(() => assert.equal(view.elCopyToast.textContent, 'HTML copied to clipboard as text'));
  } finally {
    clipboard.restore();
    cleanup();
  }
});

test('Copy Markdown writes the document source exactly, also from a read-only preview', async () => {
  const source = '# Notes\n\n- [x] done\n\nSome *text* with [a link](https://mdzip.org).\n';
  const { view, previewPane, menu, cleanup } = await mountView({
    bytes: new TextEncoder().encode(source),
    mode: 'read-only',
    initialLayout: 'preview'
  });
  const clipboard = stubClipboard();
  try {
    openContextMenu(previewPane);
    clickMenuAction(menu, 'preview-copy-markdown');
    await waitFor(() => assert.equal(clipboard.written.length, 1));
    assert.equal(clipboard.written[0], source);
    await waitFor(() => assert.equal(view.elCopyToast.textContent, 'Markdown copied to clipboard'));
  } finally {
    clipboard.restore();
    cleanup();
  }
});

test('Copy HTML on a large progressive document copies all of it', async () => {
  let source = '# Large document\n\n';
  for (let i = 0; i < 800; i += 1) {
    source += `Paragraph number ${i} with a little padding text so each block has real weight.\n\n`;
  }
  const { view, cleanup } = await mountView({
    bytes: new TextEncoder().encode(source),
    progressiveTextRendering: true
  });
  const clipboard = stubClipboard();
  try {
    assert.ok(view.chunkedRenderState.cursor < view.chunkedRenderState.records.length, 'sanity: tail unmounted');
    await view.copyHtmlPreviewContent();
    if (view.copyReadyState) {
      // Past the progress dialog's debounce, the write waits for the dialog's Copy button.
      view.elCopyRenderDialog.querySelector('[data-action="confirm-copy-ready"]').dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true })
      );
    }
    await waitFor(() => assert.equal(clipboard.written.length, 1));
    assert.match(clipboard.written[0], /<p>Paragraph number 799 /);
    assert.equal(clipboard.written[0].match(/<p>/g).length, 800);
  } finally {
    clipboard.restore();
    cleanup();
  }
});
