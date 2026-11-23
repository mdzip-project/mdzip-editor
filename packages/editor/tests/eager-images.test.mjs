import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// eagerImages: an off-screen preview nobody scrolls (Studio's print copy)
// must still load every image, so onAssetsHydrated fires. Here the
// IntersectionObserver never reports anything, as for such a pane.
if (typeof globalThis.window === 'undefined') {
  const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true });
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; }
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
globalThis.window.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { MdzPackagerCore } = await import('@mdzip/core-js');
const { MdzipWorkspaceView } = await import('../dist/index.js');

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function archive(count) {
  const files = [{ path: 'index.md', text: Array.from({ length: count }, (_, i) => `![Picture ${i}](images/p${i}.png)\n\nText ${i}.\n`).join('\n') }];
  for (let i = 0; i < count; i += 1) files.push({ path: `images/p${i}.png`, data: PNG });
  const { blob } = await MdzPackagerCore.buildArchive(files, 'Pictures',
    { title: 'Pictures', entryPoint: 'index.md', createIndex: false, mapFiles: false, filters: ['**/*'] });
  return new Uint8Array(await blob.arrayBuffer());
}

async function render(options, count = 5) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const events = { hydrated: 0, progress: [] };
  const view = new MdzipWorkspaceView(container, {
    controls: 'viewer', initialLayout: 'preview', initialColorScheme: 'light', progressiveTextRendering: false,
    onAssetsHydrated: () => { events.hydrated += 1; },
    onAssetsProgress: (progress) => events.progress.push(progress),
    ...options
  });
  await view.open(await archive(count), { mode: 'read-only', fileName: 'pictures.mdz' });
  return { container, events, cleanup: () => { view.destroy(); container.remove(); } };
}

async function until(check, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await wait(10);
  return check();
}

test('without eagerImages, images nobody scrolls to never load (the print copy timed out)', async () => {
  const { events, cleanup } = await render({});
  try {
    await wait(300);
    assert.equal(events.hydrated, 0);
    assert.deepEqual(events.progress, [{ loaded: 0, total: 5 }]);
  } finally {
    cleanup();
  }
});

test('eagerImages loads every image, reporting progress, then onAssetsHydrated', async () => {
  const { container, events, cleanup } = await render({ eagerImages: true });
  try {
    assert.ok(await until(() => events.hydrated === 1), 'onAssetsHydrated fired');
    assert.deepEqual(events.progress[0], { loaded: 0, total: 5 });
    assert.deepEqual(events.progress.at(-1), { loaded: 5, total: 5 });
    assert.deepEqual(events.progress.map((p) => p.loaded), [0, 1, 2, 3, 4, 5]);
    const images = [...container.querySelectorAll('[data-ref="preview-content"] img')];
    assert.equal(images.length, 5);
    assert.ok(images.every((image) => /^(blob|data):/.test(image.getAttribute('src') ?? '')), 'every image has its archive copy: ' + images.map((i) => (i.getAttribute('src') ?? 'none').slice(0, 30)).join(', '));
  } finally {
    cleanup();
  }
});

test('no progress reports for a preview without archive images', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const progress = [];
  let hydrated = 0;
  const view = new MdzipWorkspaceView(container, {
    controls: 'viewer', initialLayout: 'preview', eagerImages: true, progressiveTextRendering: false,
    onAssetsHydrated: () => { hydrated += 1; },
    onAssetsProgress: (p) => progress.push(p)
  });
  try {
    const { blob } = await MdzPackagerCore.buildArchive([{ path: 'index.md', text: '# Text only\n' }], 'Text',
      { title: 'Text', entryPoint: 'index.md', createIndex: false, mapFiles: false, filters: ['**/*'] });
    await view.open(new Uint8Array(await blob.arrayBuffer()), { mode: 'read-only', fileName: 'text.mdz' });
    assert.ok(await until(() => hydrated === 1));
    assert.deepEqual(progress, []);
  } finally {
    view.destroy();
    container.remove();
  }
});
