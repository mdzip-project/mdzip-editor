import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Same jsdom bootstrap as link-navigation.test.mjs.
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
import { MdzipWorkspaceView } from '../dist/index.js';

const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

// Mounts a plain-.md view whose conversion hook hands the context back to the test.
async function mountWithContext(imageInsertHandler) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let resolveContext;
  const contextReady = new Promise((resolve) => { resolveContext = resolve; });
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'source',
    initialColorScheme: 'light',
    imageInsertHandler,
    onConversionRequested: (_action, context) => { resolveContext(context); return true; }
  });
  await view.open(new TextEncoder().encode('# Notes\n\nBefore text.\n'), { mode: 'editable', fileName: 'notes.md' });
  view.requestMdzConversion({ kind: 'image-picker' });
  return { view, context: await contextReady, cleanup() { view.destroy(); container.remove(); } };
}

test('promptImageInsert runs the insert handler with the image details and the supplied alt text', async () => {
  let request;
  const { context, cleanup } = await mountWithContext((req) => {
    request = req;
    return { mode: 'markdown', altText: req.defaultAltText };
  });
  try {
    const decision = await context.promptImageInsert({ bytes: PNG, fileName: 'my pic.png', altText: 'my pic' });
    assert.equal(request.fileName, 'my pic.png');
    assert.equal(request.mimeType, 'image/png');
    assert.equal(request.defaultAltText, 'my pic');
    assert.equal(request.intrinsicWidth, 1);
    assert.equal(decision.mode, 'markdown');
  } finally {
    cleanup();
  }
});

test('promptImageInsert resolves null when the user cancels', async () => {
  const { context, cleanup } = await mountWithContext(() => null);
  try {
    assert.equal(await context.promptImageInsert({ bytes: PNG, fileName: 'a.png' }), null);
  } finally {
    cleanup();
  }
});

test('formatImageInsert writes Markdown or an aligned <img> for the given src', async () => {
  const { context, cleanup } = await mountWithContext(() => null);
  try {
    assert.equal(
      context.formatImageInsert('images/my%20pic.png', { mode: 'markdown', altText: 'my pic' }),
      '![my pic](images/my%20pic.png)'
    );
    const html = context.formatImageInsert('images/a.png', {
      mode: 'html', altText: 'A', width: 100, height: 50, position: 'wrap-left'
    });
    assert.match(html, /<img src="images\/a\.png" alt="A" width="100" height="50" align="left">/);
    const centered = context.formatImageInsert('a.png', { mode: 'html', altText: '', position: 'center' });
    assert.match(centered, /<p align="center"><img src="a\.png" alt=""><\/p>/);
  } finally {
    cleanup();
  }
});

test('the formatted text can be inserted, and inserting consumes the context', async () => {
  const { view, context, cleanup } = await mountWithContext(() => null);
  try {
    const text = context.formatImageInsert('images/a.png', { mode: 'markdown', altText: 'a' });
    assert.equal(await context.insertMarkdown(text), true);
    assert.match(view.workspace.snapshot().currentText, /!\[a\]\(images\/a\.png\)/);
    assert.equal(await context.promptImageInsert({ bytes: PNG, fileName: 'a.png' }), null);
  } finally {
    cleanup();
  }
});
