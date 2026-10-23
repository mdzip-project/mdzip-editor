import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// An image of a raw .drawio diagram can't be drawn by the preview yet (#59):
// it shows a placeholder card saying why and how to get around it, with the
// host's file actions as buttons, and copies as the image it stands for.
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
// No IntersectionObserver: images hydrate eagerly.
delete globalThis.window.IntersectionObserver;

const { MdzPackagerCore } = await import('@mdzip/core-js');
const { MdzipWorkspaceView } = await import('../dist/index.js');

const DRAWIO = '<mxfile><diagram id="a" name="Page-1"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>';
const PLAIN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>';

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

async function openPreview(markdown, options = {}) {
  const { blob } = await MdzPackagerCore.buildArchive([
    { path: 'index.md', text: markdown },
    { path: 'diagrams/flow.drawio', text: DRAWIO },
    { path: 'diagrams/old.dio', text: DRAWIO },
    { path: 'diagrams/exported.drawio.svg', text: PLAIN_SVG }
  ], 'Diagrams', { title: 'Diagrams', entryPoint: 'index.md', createIndex: false, mapFiles: false, filters: ['**/*'] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'viewer',
    initialLayout: 'preview',
    initialColorScheme: 'light',
    ...options
  });
  await view.open(new Uint8Array(await blob.arrayBuffer()), { mode: 'read-only', fileName: 'diagrams.mdz' });
  const preview = container.querySelector('[data-ref="preview-content"]');
  await waitFor(() => assert.ok(preview.querySelector('h1')));
  return { view, container, preview, cleanup: () => { view.destroy(); container.remove(); } };
}

test('an image of a .drawio file shows a placeholder card instead of a broken image', async () => {
  const { preview, cleanup } = await openPreview(
    '# Diagrams\n\n![System flow](diagrams/flow.drawio)\n\n![](diagrams/old.dio)\n\n![Exported](diagrams/exported.drawio.svg)\n'
  );
  try {
    await waitFor(() => assert.equal(preview.querySelectorAll('.mdzip-drawio-placeholder').length, 2));
    const [flow, old] = preview.querySelectorAll('.mdzip-drawio-placeholder');
    assert.equal(flow.getAttribute('role'), 'note');
    assert.equal(flow.querySelector('.mdzip-drawio-placeholder-title').textContent, 'System flow', 'alt text is the title');
    assert.equal(flow.querySelector('.mdzip-drawio-placeholder-file').textContent, 'draw.io diagram · diagrams/flow.drawio');
    assert.match(flow.textContent, /can't draw \.drawio files yet/);
    assert.match(flow.textContent, /\.drawio\.svg/);
    assert.equal(flow.getAttribute('data-mdzip-source'), 'diagrams/flow.drawio');
    assert.equal(old.querySelector('.mdzip-drawio-placeholder-title').textContent, 'old.dio', 'no alt text: the file name');
    assert.equal(flow.querySelector('button'), null, 'no host actions, no buttons');
    assert.equal(
      [...preview.querySelectorAll('img')].filter((img) => /\.(drawio|dio)$/.test(img.getAttribute('data-mdzip-source') ?? '')).length,
      0,
      'no <img> is left for the raw diagrams'
    );
    // The preview mounts in stages; wait for the last paragraph too.
    await waitFor(() => assert.ok(
      [...preview.querySelectorAll('img')].some((img) => img.getAttribute('data-mdzip-source') === 'diagrams/exported.drawio.svg'),
      'a .drawio.svg stays an image'
    ));
    assert.equal(flow.querySelector('code[class]'), null, 'no empty class attributes');
  } finally {
    cleanup();
  }
});

test('a missing .drawio file is left as a broken image, not a card', async () => {
  const { preview, cleanup } = await openPreview('# Diagrams\n\n![Gone](diagrams/missing.drawio)\n');
  try {
    await waitFor(() => assert.ok(preview.querySelector('img')));
    assert.equal(preview.querySelector('.mdzip-drawio-placeholder'), null);
  } finally {
    cleanup();
  }
});

test('the host\'s file actions that apply become buttons that run with the diagram\'s path', async () => {
  const runs = [];
  const { preview, cleanup } = await openPreview('# Diagrams\n\n<img src="diagrams/flow.drawio" alt="Flow">\n', {
    hostFileActions: [
      { id: 'open', label: 'Open in VS Code Editor', run: (file) => { runs.push(file); } },
      { id: 'images-only', label: 'Edit Image', appliesTo: (file) => file.isImage, run: () => { throw new Error('should not show'); } }
    ]
  });
  try {
    await waitFor(() => assert.ok(preview.querySelector('.mdzip-drawio-placeholder')));
    const buttons = [...preview.querySelectorAll('.mdzip-drawio-placeholder-action')];
    assert.deepEqual(buttons.map((b) => b.textContent), ['Open in VS Code Editor']);
    buttons[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await waitFor(() => assert.equal(runs.length, 1));
    assert.equal(runs[0].path, 'diagrams/flow.drawio');
    assert.equal(runs[0].isImage, false);
    assert.equal(
      preview.querySelector('.mdzip-drawio-placeholder-hint')?.textContent,
      'Or right-click flow.drawio in the contents pane.',
      'points at the same actions on the file\'s right-click menu'
    );
  } finally {
    cleanup();
  }
});

test('no contents pane, no right-click hint; no host actions, no hint either', async () => {
  const withoutPane = await openPreview('# Diagrams\n\n![Flow](diagrams/flow.drawio)\n', {
    controls: { preset: 'viewer', navigation: false },
    hostFileActions: [{ id: 'open', label: 'Open', run: () => {} }]
  });
  try {
    await waitFor(() => assert.ok(withoutPane.preview.querySelector('.mdzip-drawio-placeholder-action')));
    assert.equal(withoutPane.preview.querySelector('.mdzip-drawio-placeholder-hint'), null);
  } finally {
    withoutPane.cleanup();
  }
  const withoutActions = await openPreview('# Diagrams\n\n![Flow](diagrams/flow.drawio)\n');
  try {
    await waitFor(() => assert.ok(withoutActions.preview.querySelector('.mdzip-drawio-placeholder')));
    assert.equal(withoutActions.preview.querySelector('.mdzip-drawio-placeholder-hint'), null);
  } finally {
    withoutActions.cleanup();
  }
});

test('a failing host action is reported through onFailed', async () => {
  const failures = [];
  const { preview, cleanup } = await openPreview('# Diagrams\n\n![Flow](diagrams/flow.drawio)\n', {
    hostFileActions: [{ id: 'open', label: 'Open', run: () => { throw new Error('no editor'); } }],
    onFailed: (error) => failures.push(error)
  });
  try {
    await waitFor(() => assert.ok(preview.querySelector('.mdzip-drawio-placeholder-action')));
    preview.querySelector('.mdzip-drawio-placeholder-action').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() => assert.equal(failures.length, 1));
    assert.equal(failures[0].message, 'no editor');
  } finally {
    cleanup();
  }
});

test('copying a selection across the card copies the image it stands for, not the explanation', async () => {
  const written = [];
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: async (text) => { written.push(text); } },
    configurable: true
  });
  const { preview, container, cleanup } = await openPreview('# Diagrams\n\nBefore the diagram.\n\n![System flow](diagrams/flow.drawio)\n\nAfter the diagram.\n');
  try {
    await waitFor(() => assert.ok(preview.querySelector('.mdzip-drawio-placeholder')));
    const find = (text) => {
      const walker = document.createTreeWalker(preview, window.NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = node.textContent.indexOf(text);
        if (index !== -1) return { node, index };
      }
      throw new Error(`not found: ${text}`);
    };
    const start = find('Before');
    const end = find('After the diagram.');
    const range = document.createRange();
    range.setStart(start.node, start.index);
    range.setEnd(end.node, end.index + 'After the diagram.'.length);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);

    const pane = container.querySelector('[data-ref="preview-pane"]');
    pane.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    const button = container.querySelector('[data-ref="nav-menu"] [data-menu-action="preview-copy-selection-html"]');
    assert.ok(button, 'Copy as HTML is offered for the selection');
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await waitFor(() => assert.equal(written.length, 1));
    assert.match(written[0], /<img [^>]*src="diagrams\/flow\.drawio"/);
    assert.match(written[0], /alt="System flow"/);
    assert.doesNotMatch(written[0], /can't draw|mdzip-drawio-placeholder/);
  } finally {
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else delete window.navigator.clipboard;
    cleanup();
  }
});
