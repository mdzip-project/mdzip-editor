import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Same jsdom bootstrap as workspace.test.mjs: the view needs document /
// HTMLElement / animation-frame helpers / matchMedia, and DOMPurify resolves
// its window lazily from globalThis.
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
import { DEFAULT_CODE_BLOCK_LANGUAGES, MdzipWorkspaceView } from '../dist/index.js';

// Mounts a workspace view over a plain Markdown document and returns the bits
// every test needs. Callers must run `cleanup()` in a finally block.
async function mountMarkdownEditor({ source = '# Notes\n\nplain body text\n', mode = 'editable', options = {} } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'source',
    initialColorScheme: 'light',
    ...options
  });
  await view.open(new TextEncoder().encode(source), { mode, fileName: 'notes.md' });
  const editorHost = container.querySelector('[data-ref="editor-host"]');
  const menu = container.querySelector('[data-ref="nav-menu"]');
  return {
    view,
    container,
    editorHost,
    menu,
    cleanup() {
      view.destroy();
      container.remove();
    }
  };
}

function openContextMenu(editorHost, { x = 40, y = 40 } = {}) {
  editorHost.dispatchEvent(new window.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y
  }));
}

function selectRange(view, anchor, head) {
  view.cmEditor.dispatch({ selection: { anchor, head } });
}

function clickMenuAction(menu, action) {
  const button = menu.querySelector(`[data-menu-action="${action}"]`);
  assert.ok(button, `menu has an item for action "${action}"`);
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function menuActions(menu) {
  return [...menu.querySelectorAll('[data-menu-action]')].map((el) => el.dataset.menuAction);
}

function docText(view) {
  return view.cmEditor.state.doc.toString();
}

// Stubs the window clipboard for the duration of one test.
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

test('right-click over the editor opens the selection context menu', async () => {
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor();
  try {
    selectRange(view, 0, 7); // "# Notes"
    openContextMenu(editorHost);

    assert.equal(menu.hidden, false, 'menu is shown');
    const actions = menuActions(menu);
    for (const expected of ['editor-cut', 'editor-copy', 'editor-paste', 'editor-paste-plain',
      'bold', 'italic', 'strikethrough', 'highlight', 'inline-code',
      'bullet-list', 'ordered-list', 'blockquote', 'insert-line-break',
      'link', 'insert-image', 'editor-clear-format', 'editor-select-all']) {
      assert.ok(actions.includes(expected), `menu offers "${expected}"`);
    }

    // Heading flyout: paragraph plus one item per permitted level.
    for (const level of [1, 2, 3, 4, 5, 6]) {
      assert.ok(actions.includes(`heading-${level}`), `heading submenu offers level ${level}`);
    }
    assert.ok(actions.includes('paragraph'), 'heading submenu offers Paragraph');

    // Code Block flyout mirrors the default language list.
    for (const lang of DEFAULT_CODE_BLOCK_LANGUAGES) {
      assert.ok(actions.includes(`code-block:${lang.id}`), `code submenu offers ${lang.label}`);
    }
  } finally {
    cleanup();
  }
});

test('collapsed selection omits Cut/Copy and Clear Formatting', async () => {
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor();
  try {
    selectRange(view, 3, 3);
    openContextMenu(editorHost);

    const actions = menuActions(menu);
    assert.equal(actions.includes('editor-cut'), false);
    assert.equal(actions.includes('editor-copy'), false);
    assert.equal(actions.includes('editor-clear-format'), false);
    // Paste and formatting still apply at the caret / current line.
    assert.ok(actions.includes('editor-paste'));
    assert.ok(actions.includes('bold'));
    assert.ok(actions.includes('editor-select-all'));
  } finally {
    cleanup();
  }
});

test('read-only documents only offer Copy and Select All', async () => {
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor({ mode: 'read-only' });
  try {
    selectRange(view, 0, 7);
    openContextMenu(editorHost);

    const actions = menuActions(menu);
    assert.deepEqual(actions, ['editor-copy', 'editor-select-all']);
  } finally {
    cleanup();
  }
});

test('formatting actions apply to the selection captured at open time', async () => {
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor({ source: 'plain body text\n' });
  try {
    selectRange(view, 6, 10); // "body"
    openContextMenu(editorHost);
    // Simulate the focus shift a real click causes: collapse the live selection
    // before the action runs. The handler must restore the captured range.
    selectRange(view, 0, 0);
    clickMenuAction(menu, 'bold');

    assert.equal(docText(view), 'plain **body** text\n');
    assert.equal(menu.hidden, true, 'menu closes after the action');
  } finally {
    cleanup();
  }
});

test('highlight wraps the selection in <mark> tags', async () => {
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor({ source: 'plain body text\n' });
  try {
    selectRange(view, 6, 10);
    openContextMenu(editorHost);
    clickMenuAction(menu, 'highlight');

    assert.equal(docText(view), 'plain <mark>body</mark> text\n');
  } finally {
    cleanup();
  }
});

test('code block submenu inserts a fence with the chosen language', async () => {
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor({ source: 'const x = 1;\n' });
  try {
    selectRange(view, 0, 12); // "const x = 1;"
    openContextMenu(editorHost);
    clickMenuAction(menu, 'code-block:typescript');

    assert.equal(docText(view), '```typescript\nconst x = 1;\n```\n');
  } finally {
    cleanup();
  }
});

test('codeBlockLanguages option replaces the default language list', async () => {
  const { editorHost, menu, view, cleanup } = await mountMarkdownEditor({
    options: { codeBlockLanguages: [{ id: 'foo', label: 'FooLang' }] }
  });
  try {
    selectRange(view, 0, 4);
    openContextMenu(editorHost);

    const actions = menuActions(menu);
    assert.ok(actions.includes('code-block:foo'));
    assert.equal(actions.includes('code-block:typescript'), false);
  } finally {
    cleanup();
  }
});

test('clear formatting strips inline and block markers from the selection', async () => {
  const source = '## Heading\n> quoted **bold** and _lean_ and `code` and ==hi== text\n';
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor({ source });
  try {
    selectRange(view, 0, source.length - 1);
    openContextMenu(editorHost);
    clickMenuAction(menu, 'editor-clear-format');

    assert.equal(docText(view), 'Heading\nquoted bold and lean and code and hi text\n');
  } finally {
    cleanup();
  }
});

test('cut writes the selection to the clipboard and removes it', async () => {
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor({ source: 'plain body text\n' });
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    selectRange(view, 6, 11); // "body "
    openContextMenu(editorHost);
    clickMenuAction(menu, 'editor-cut');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(written, ['body ']);
    assert.equal(docText(view), 'plain text\n');
  } finally {
    restore();
    cleanup();
  }
});

test('copy writes the selection without changing the document', async () => {
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor({ source: 'plain body text\n' });
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    selectRange(view, 0, 5);
    openContextMenu(editorHost);
    clickMenuAction(menu, 'editor-copy');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(written, ['plain']);
    assert.equal(docText(view), 'plain body text\n');
  } finally {
    restore();
    cleanup();
  }
});

test('paste replaces the captured selection with clipboard text', async () => {
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor({ source: 'plain body text\n' });
  const restore = stubClipboard({ readText: async () => 'PASTED' });
  try {
    selectRange(view, 6, 10); // "body"
    openContextMenu(editorHost);
    clickMenuAction(menu, 'editor-paste');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(docText(view), 'plain PASTED text\n');
  } finally {
    restore();
    cleanup();
  }
});

test('a failing clipboard read reports through onFailed and leaves the document intact', async () => {
  const failures = [];
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor({
    source: 'plain body text\n',
    options: { onFailed: (error) => failures.push(error) }
  });
  const restore = stubClipboard({ readText: async () => { throw new Error('denied'); } });
  try {
    selectRange(view, 0, 0);
    openContextMenu(editorHost);
    clickMenuAction(menu, 'editor-paste');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(failures.length, 1);
    assert.equal(docText(view), 'plain body text\n');
  } finally {
    restore();
    cleanup();
  }
});

test('select all covers the whole document', async () => {
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor({ source: 'plain body text\n' });
  try {
    selectRange(view, 2, 2);
    openContextMenu(editorHost);
    clickMenuAction(menu, 'editor-select-all');

    const selection = view.cmEditor.state.selection.main;
    assert.equal(selection.from, 0);
    assert.equal(selection.to, view.cmEditor.state.doc.length);
  } finally {
    cleanup();
  }
});

test('Escape closes the menu without acting', async () => {
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor({ source: 'plain body text\n' });
  try {
    selectRange(view, 0, 5);
    openContextMenu(editorHost);
    assert.equal(menu.hidden, false);

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(menu.hidden, true);
    assert.equal(docText(view), 'plain body text\n');
  } finally {
    cleanup();
  }
});

test('non-mac platforms render Ctrl-style shortcut hints', async () => {
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor({ source: 'plain body text\n' });
  try {
    selectRange(view, 0, 5);
    openContextMenu(editorHost);

    const cutItem = menu.querySelector('[data-menu-action="editor-cut"]');
    assert.equal(cutItem?.querySelector('.nav-menu-shortcut')?.textContent, 'Ctrl+X');
  } finally {
    cleanup();
  }
});

test('the CodeMirror content DOM opts into native spellcheck', async () => {
  const { editorHost, cleanup } = await mountMarkdownEditor();
  try {
    const content = editorHost.querySelector('.cm-content');
    assert.equal(content?.getAttribute('spellcheck'), 'true');
  } finally {
    cleanup();
  }
});

test('raw HTML tag markers opt out of spellcheck (tag/attribute names are not prose)', async () => {
  const { editorHost, cleanup } = await mountMarkdownEditor({
    source: 'plain body text <mark>highlighted</mark> and <citation src="1,2,4"></citation>\n'
  });
  try {
    const tagMarkers = editorHost.querySelectorAll('.mdzip-hard-break-marker');
    assert.ok(tagMarkers.length > 0, 'at least one tag marker is rendered');
    for (const marker of tagMarkers) {
      assert.equal(marker.getAttribute('spellcheck'), 'false');
    }
  } finally {
    cleanup();
  }
});

test('editable documents get a disabled Spelling Suggestions hint pointing at Shift+Right-Click', async () => {
  const { editorHost, menu, cleanup } = await mountMarkdownEditor();
  try {
    openContextMenu(editorHost);

    const hint = menu.querySelector('[data-menu-action="editor-spelling-suggestions-hint"]');
    assert.ok(hint, 'hint row is present');
    assert.equal(hint.disabled, true);
    assert.equal(hint.getAttribute('aria-disabled'), 'true');
    assert.equal(hint.querySelector('.nav-menu-shortcut')?.textContent, 'Shift+Right-Click');
  } finally {
    cleanup();
  }
});

test('read-only documents omit the Spelling Suggestions hint (native spellcheck never runs there)', async () => {
  const { editorHost, menu, cleanup } = await mountMarkdownEditor({ mode: 'read-only' });
  try {
    openContextMenu(editorHost);
    assert.equal(menu.querySelector('[data-menu-action="editor-spelling-suggestions-hint"]'), null);
  } finally {
    cleanup();
  }
});

test('the Spelling Suggestions hint is inert if somehow clicked', async () => {
  const { view, editorHost, menu, cleanup } = await mountMarkdownEditor({ source: 'plain body text\n' });
  try {
    selectRange(view, 0, 5);
    openContextMenu(editorHost);
    const hint = menu.querySelector('[data-menu-action="editor-spelling-suggestions-hint"]');
    hint.disabled = false; // bypass the native disabled guard to prove the handler itself is a no-op
    clickMenuAction(menu, 'editor-spelling-suggestions-hint');

    assert.equal(docText(view), 'plain body text\n');
    assert.equal(menu.hidden, true, 'menu still closes');
  } finally {
    cleanup();
  }
});

test('contextMenu.editor: false falls through to the native menu', async () => {
  const { editorHost, menu, cleanup } = await mountMarkdownEditor({
    options: { controls: { preset: 'standalone-editor', contextMenu: { editor: false } } }
  });
  try {
    const event = new window.MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 40, clientY: 40
    });
    editorHost.dispatchEvent(event);

    assert.equal(menu.hidden, true, 'our menu stays closed');
    assert.equal(event.defaultPrevented, false, 'the native menu is left alone');
  } finally {
    cleanup();
  }
});
