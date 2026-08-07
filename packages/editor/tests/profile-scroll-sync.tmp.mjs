import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

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

class FakeIntersectionObserver {
  static instances = [];
  constructor(callback) { this.callback = callback; this.disconnected = false; FakeIntersectionObserver.instances.push(this); }
  observe() {}
  unobserve() {}
  disconnect() { this.disconnected = true; }
  trigger(target) { this.callback([{ target, isIntersecting: true }], this); }
}
globalThis.window.IntersectionObserver = FakeIntersectionObserver;

const { MdzipWorkspaceView } = await import('../dist/index.js');

function manyParagraphMarkdown(count) {
  let markdown = '# Large document\n\n';
  for (let i = 0; i < count; i += 1) {
    markdown += `Paragraph number ${i} with a little padding text so each block has real weight.\n\n`;
  }
  return markdown;
}

const container = document.createElement('div');
document.body.appendChild(container);
const view = new MdzipWorkspaceView(container, {
  controls: 'standalone-editor',
  initialLayout: 'split',
  initialColorScheme: 'light',
  progressiveTextRendering: true
});
await view.open(new TextEncoder().encode(manyParagraphMarkdown(800)), { mode: 'editable', fileName: 'notes.md' });
await view.whenRendered();

assert.ok(view.chunkedRenderState, 'sanity: unmounted chunks remain');

const cmScroller = view.cmEditor.dom.querySelector('.cm-scroller');
Object.defineProperty(cmScroller, 'scrollHeight', { value: 3000, configurable: true });
Object.defineProperty(cmScroller, 'clientHeight', { value: 500, configurable: true });
Object.defineProperty(cmScroller, 'scrollTop', { value: 2500, configurable: true });

let getterCalls = 0;
Object.defineProperty(view.elPreviewPane, 'scrollHeight', {
  configurable: true,
  get: () => { getterCalls += 1; return 100 + view.elPreviewContent.querySelectorAll('p').length * 20; }
});
Object.defineProperty(view.elPreviewPane, 'clientHeight', { value: 500, configurable: true });
let previewScrollTop = 0;
let setterCalls = 0;
Object.defineProperty(view.elPreviewPane, 'scrollTop', {
  configurable: true,
  get: () => previewScrollTop,
  set: (value) => { setterCalls += 1; previewScrollTop = value; }
});

const start = Date.now();
view.syncScrollToPreview();

let lastLog = Date.now();
while (view.chunkedRenderState !== null) {
  await new Promise((r) => setTimeout(r, 0));
  if (Date.now() - lastLog > 2000) {
    lastLog = Date.now();
    console.log(`still draining... t=${Date.now() - start}ms getterCalls=${getterCalls} setterCalls=${setterCalls} cursor=${view.chunkedRenderState?.cursor}`);
  }
  if (Date.now() - start > 40000) {
    console.log('giving up after 40s');
    break;
  }
}
console.log(`done draining at t=${Date.now() - start}ms getterCalls=${getterCalls} setterCalls=${setterCalls}`);
