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

function selectBetween(root, startText, endText) {
  const find = (text) => {
    const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent.indexOf(text);
      if (index !== -1) return { node, index };
    }
    throw new Error(`text not found in preview: ${text}`);
  };
  const start = find(startText);
  const end = find(endText);
  const range = document.createRange();
  range.setStart(start.node, start.index);
  range.setEnd(end.node, end.index + endText.length);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

test('Copy All is a submenu naming each format: Plain Text, Formatted Text, Markdown, HTML', async () => {
  const { previewPane, menu, cleanup } = await mountView({ bytes: new TextEncoder().encode('# Notes\n\nText.\n') });
  try {
    openContextMenu(previewPane);
    const parent = [...menu.querySelectorAll('.nav-menu-parent')].find((el) => el.textContent.trim() === 'Copy All');
    assert.ok(parent, 'Copy All submenu');
    const submenu = parent.parentElement.querySelector('.nav-context-submenu');
    assert.deepEqual(
      [...submenu.querySelectorAll('[data-menu-action]')].map((el) => el.querySelector('.nav-menu-label').textContent),
      ['Plain Text', 'Formatted Text', 'Markdown', 'HTML']
    );
    assert.ok(submenu.querySelector('[data-menu-action="preview-copy-all"] .nav-menu-shortcut'), 'Plain Text keeps the Copy All shortcut');
    assert.deepEqual(
      [...submenu.querySelectorAll('[data-menu-action]')].map((el) => el.dataset.tooltip),
      [
        'Text only, for Notepad or a code editor',
        'Headings, styles and images, for Word, Google Docs or email',
        "The document's Markdown source",
        "The document's HTML markup, as text"
      ],
      'each format has a hover tip'
    );
    assert.equal(menu.querySelector('[data-menu-action="preview-copy-selection-html"]'), null, 'no selection: no Copy as HTML');
  } finally {
    cleanup();
  }
});

test('Copy as HTML copies the selection inside its enclosing elements', async () => {
  const bytes = new TextEncoder().encode('# Notes\n\n- first item\n- second **bold** item\n\nAfter.\n');
  const { view, previewPane, menu, cleanup } = await mountView({ bytes });
  const clipboard = stubClipboard();
  try {
    const previewContent = previewPane.querySelector('[data-ref="preview-content"]');
    selectBetween(previewContent, 'second', 'bold');
    openContextMenu(previewPane);
    clickMenuAction(menu, 'preview-copy-selection-html');
    await waitFor(() => assert.equal(clipboard.written.length, 1));
    assert.equal(clipboard.written[0], '<ul><li>second <strong>bold</strong></li></ul>', 'part of a list item keeps its list');
    await waitFor(() => assert.equal(view.elCopyToast.textContent, 'HTML copied to clipboard as text'));
  } finally {
    clipboard.restore();
    cleanup();
  }
});

test('Copy as HTML leaves out the code block header and preview wrappers', async () => {
  const bytes = new TextEncoder().encode('# Notes\n\nBefore the code.\n\n```js\nconst answer = 42;\n```\n');
  const { previewPane, menu, cleanup } = await mountView({ bytes });
  const clipboard = stubClipboard();
  try {
    const previewContent = previewPane.querySelector('[data-ref="preview-content"]');
    await waitFor(() => assert.ok(previewContent.querySelector('.mdzip-code-block-header'), 'code block chrome is mounted'));
    selectBetween(previewContent, 'Before', '42');
    openContextMenu(previewPane);
    clickMenuAction(menu, 'preview-copy-selection-html');
    await waitFor(() => assert.equal(clipboard.written.length, 1));
    const html = clipboard.written[0];
    assert.match(html, /^<p>Before the code\.<\/p>/);
    assert.match(html, /<pre><code class="[^"]*language-js[^"]*">[\s\S]*42[\s\S]*<\/code><\/pre>$/);
    assert.doesNotMatch(html, /mdzip-code-block|mdzip-chunk|<button/, 'no editor chrome');
  } finally {
    clipboard.restore();
    cleanup();
  }
});

test('a selection of only an image offers Copy as HTML but not Copy', async () => {
  const bytes = new TextEncoder().encode('# Notes\n\n![Logo](images/logo.png)\n');
  const { previewPane, menu, cleanup } = await mountView({ bytes });
  const clipboard = stubClipboard();
  try {
    const image = previewPane.querySelector('[data-ref="preview-content"] img');
    const range = document.createRange();
    range.selectNode(image);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    openContextMenu(previewPane);
    assert.equal(menu.querySelector('[data-menu-action="preview-copy"]'), null, 'no text to copy');
    clickMenuAction(menu, 'preview-copy-selection-html');
    await waitFor(() => assert.equal(clipboard.written.length, 1));
    assert.match(clipboard.written[0], /^<p><img[^>]+src="images\/logo\.png"[^>]*><\/p>$/);
  } finally {
    clipboard.restore();
    cleanup();
  }
});

test('Copy All as Plain Text leaves out diagram stylesheets and editor chrome', async () => {
  const bytes = new TextEncoder().encode('# Notes\n\nBefore.\n\n```js\nconst answer = 42;\n```\n\nAfter.\n');
  const { previewPane, menu, cleanup } = await mountView({ bytes });
  const clipboard = stubClipboard();
  try {
    const previewContent = previewPane.querySelector('[data-ref="preview-content"]');
    await waitFor(() => assert.ok(previewContent.querySelector('.mdzip-code-block-header'), 'code block chrome is mounted'));
    // Stands in for a drawn Mermaid diagram: an SVG carrying its own stylesheet.
    previewContent.querySelector('p').insertAdjacentHTML('afterend',
      '<div class="mdzip-mermaid"><svg><style>#d{font-family:sans-serif}</style><text>Label</text></svg></div>');
    openContextMenu(previewPane);
    clickMenuAction(menu, 'preview-copy-all');
    await waitFor(() => assert.equal(clipboard.written.length, 1));
    const text = clipboard.written[0];
    assert.match(text, /Before\.[\s\S]*const answer = 42;[\s\S]*After\./);
    assert.doesNotMatch(text, /font-family|Label/, 'no diagram stylesheet or drawn labels');
    assert.doesNotMatch(text, /\bjs\b|Copy/, 'no code block header');
  } finally {
    clipboard.restore();
    cleanup();
  }
});

test('with a selection, Copy is a submenu in the same formats as Copy All, with the same tips', async () => {
  const bytes = new TextEncoder().encode('# Notes\n\n- first item\n- second **bold** item\n');
  const { previewPane, menu, cleanup } = await mountView({ bytes });
  try {
    selectBetween(previewPane.querySelector('[data-ref="preview-content"]'), 'second', 'bold');
    openContextMenu(previewPane);
    const submenuOf = (label) => [...menu.querySelectorAll('.nav-menu-parent')]
      .find((el) => el.textContent.trim() === label).parentElement.querySelector('.nav-context-submenu');
    const items = (label) => [...submenuOf(label).querySelectorAll('[data-menu-action]')];
    assert.deepEqual(items('Copy').map((el) => el.querySelector('.nav-menu-label').textContent), ['Plain Text', 'Formatted Text', 'HTML']);
    const tip = (label, action) => submenuOf(label).querySelector(`[data-menu-action="${action}"]`).dataset.tooltip;
    assert.equal(tip('Copy', 'preview-copy'), tip('Copy All', 'preview-copy-all'), 'Plain Text tips match');
    assert.equal(tip('Copy', 'preview-copy-selection-formatted'), tip('Copy All', 'preview-copy-all-images'), 'Formatted Text tips match');
    assert.ok(submenuOf('Copy').querySelector('[data-menu-action="preview-copy-selection-formatted"] .nav-menu-shortcut'),
      'Formatted Text carries Ctrl+C, which does the same');
  } finally {
    cleanup();
  }
});

test('Copy > Formatted Text writes the selection as HTML plus plain text', async () => {
  const bytes = new TextEncoder().encode('# Notes\n\n- first item\n- second **bold** item\n');
  const { previewPane, menu, cleanup } = await mountView({ bytes });
  const items = [];
  const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  const originalClipboardItem = window.ClipboardItem;
  window.ClipboardItem = class { constructor(parts) { this.parts = parts; } };
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { write: async (written) => { items.push(...written); }, writeText: async () => {} },
    configurable: true
  });
  try {
    selectBetween(previewPane.querySelector('[data-ref="preview-content"]'), 'second', 'bold');
    openContextMenu(previewPane);
    clickMenuAction(menu, 'preview-copy-selection-formatted');
    await waitFor(() => assert.equal(items.length, 1));
    assert.equal(await items[0].parts['text/html'].text(), '<ul><li>second <strong>bold</strong></li></ul>');
    assert.equal((await items[0].parts['text/plain'].text()).trim(), 'second bold');
  } finally {
    if (originalClipboard) Object.defineProperty(window.navigator, 'clipboard', originalClipboard);
    else delete window.navigator.clipboard;
    window.ClipboardItem = originalClipboardItem;
    cleanup();
  }
});

test('Ctrl+C on a preview selection copies clean formatted text, not the raw preview', async () => {
  const bytes = new TextEncoder().encode('# Notes\n\nBefore the code.\n\n```js\nconst answer = 42;\n```\n');
  const { previewPane, cleanup } = await mountView({ bytes });
  try {
    const previewContent = previewPane.querySelector('[data-ref="preview-content"]');
    await waitFor(() => assert.ok(previewContent.querySelector('.mdzip-code-block-header'), 'code block chrome is mounted'));
    selectBetween(previewContent, 'Before', '42');
    const data = {};
    const event = new window.Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type, value) => { data[type] = value; } } });
    previewContent.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, 'the editor handles the copy');
    assert.match(data['text/html'], /^<p>Before the code\.<\/p>[\s\S]*<pre><code/);
    assert.doesNotMatch(data['text/html'], /mdzip-code-block|<button/, 'no editor chrome');
    assert.match(data['text/plain'], /Before the code\.[\s\S]*const answer = 42/);
    assert.doesNotMatch(data['text/plain'], /\bjs\b|Copy/, 'no code block header in the text either');
  } finally {
    cleanup();
  }
});
