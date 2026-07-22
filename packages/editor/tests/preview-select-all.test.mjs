import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Same jsdom bootstrap as editor-context-menu.test.mjs: 'split' layout mounts
// CodeMirror alongside the preview, which needs a full DOM window.
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
import { MdzipWorkspaceView } from '../dist/index.js';

async function mountSplitView({
  source = '# Notes\n\nplain body text\n',
  mode = 'editable',
  controls = 'standalone-editor'
} = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls,
    initialLayout: 'split',
    initialColorScheme: 'light'
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
      view.destroy();
      container.remove();
    }
  };
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

test('right-click over the rendered preview offers Select All', async () => {
  const { previewPane, menu, cleanup } = await mountSplitView();
  try {
    openContextMenu(previewPane);

    assert.equal(menu.hidden, false, 'menu is shown');
    assert.deepEqual(
      [...menu.querySelectorAll('[data-menu-action]')].map((el) => el.dataset.menuAction),
      ['preview-select-all']
    );
  } finally {
    cleanup();
  }
});

test('Select All selects the rendered content, not the whole page', async () => {
  const { previewPane, menu, cleanup } = await mountSplitView();
  try {
    openContextMenu(previewPane);
    clickMenuAction(menu, 'preview-select-all');

    const selection = window.getSelection();
    assert.equal(selection.rangeCount, 1);
    const text = selectionText();
    assert.ok(text.includes('Notes'), 'selection covers the heading');
    assert.ok(text.includes('plain body text'), 'selection covers the paragraph');
  } finally {
    cleanup();
  }
});

test('Ctrl+A scoped to the preview pane selects rendered content, not the editor', async () => {
  const { view, previewPane, editorHost, cleanup } = await mountSplitView();
  try {
    previewPane.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    assert.equal(document.activeElement, previewPane, 'clicking the preview focuses it');

    document.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    }));

    assert.equal(selectionText().includes('Notes'), true);
    // The source editor's own selection must be untouched.
    assert.equal(view.cmEditor.state.selection.main.empty, true);
    void editorHost;
  } finally {
    cleanup();
  }
});

test('Ctrl+A while the source editor has focus is left to CodeMirror', async () => {
  const { view, cleanup } = await mountSplitView();
  try {
    view.cmEditor.focus();
    view.cmEditor.dispatch({ selection: { anchor: 2, head: 2 } });

    document.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    }));

    // Our handler must not have intercepted/prevented this; it's CodeMirror's
    // own defaultKeymap binding that would normally act on a real DOM dispatch
    // (jsdom's keymap wiring isn't exercised here), so we just assert our
    // guard didn't fire and steal the preview selection.
    assert.equal(selectionText(), '');
  } finally {
    cleanup();
  }
});

test('right-click over an existing preview selection offers Copy ahead of Select All', async () => {
  const { previewPane, previewContent, menu, cleanup } = await mountSplitView();
  try {
    selectPreviewText(previewContent, 'body');
    openContextMenu(previewPane);

    assert.deepEqual(
      [...menu.querySelectorAll('[data-menu-action]')].map((el) => el.dataset.menuAction),
      ['preview-copy', 'preview-select-all']
    );
  } finally {
    cleanup();
  }
});

test('Copy writes the preview selection captured at right-click time to the clipboard', async () => {
  const { previewPane, previewContent, menu, cleanup } = await mountSplitView();
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
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(written, ['body']);
  } finally {
    restore();
    cleanup();
  }
});

test('contextMenu.preview: false falls through to the native menu', async () => {
  const { previewPane, menu, cleanup } = await mountSplitView({
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
  const { previewPane, editorHost, menu, cleanup } = await mountSplitView({
    controls: { preset: 'standalone-editor', contextMenu: { preview: false } }
  });
  try {
    openContextMenu(editorHost);
    assert.equal(menu.hidden, false, 'editor menu is unaffected');
    menu.querySelector('[data-menu-action]')?.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    previewPane.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    document.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'a', ctrlKey: true, bubbles: true, cancelable: true
    }));
    assert.equal(selectionText().includes('Notes'), true, 'keyboard select-all is untouched by the menu flag');
  } finally {
    cleanup();
  }
});

test('empty preview offers no context menu', async () => {
  const { previewPane, menu, cleanup } = await mountSplitView({ source: '' });
  try {
    openContextMenu(previewPane);
    assert.equal(menu.hidden, true);
  } finally {
    cleanup();
  }
});
