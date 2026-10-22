import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// #61: the preview must never give an archive-relative path to an <img src>
// in the live page. A browser starts fetching an image as soon as HTML with
// <img src> is parsed into an element of a live document (attached or not),
// resolved against the host page's URL, so `images/x.png` was requested from
// the host's own server before the archive copy replaced it. jsdom doesn't
// load images, so this test watches the step that would: innerHTML set on an
// element of the live document (a <template> is inert, so it's allowed).
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
globalThis.window.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { MdzPackagerCore } = await import('@mdzip/core-js');
const { MdzipWorkspaceView } = await import('../dist/index.js');

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
const ARCHIVE_IMG = /<img\b[^>]*\bsrc\s*=\s*["'](?![a-z][a-z\d+.-]*:|\/\/|#)[^"']+["']/i;

// Records every innerHTML assignment on a live-document element (not a
// <template>) whose HTML gives an <img> an archive-relative src.
const leaks = [];
const descriptor = Object.getOwnPropertyDescriptor(window.Element.prototype, 'innerHTML');
Object.defineProperty(window.Element.prototype, 'innerHTML', {
  configurable: true,
  get: descriptor.get,
  set(value) {
    if (this.ownerDocument === window.document && this.localName !== 'template' && ARCHIVE_IMG.test(String(value))) {
      leaks.push(String(value).match(ARCHIVE_IMG)[0]);
    }
    descriptor.set.call(this, value);
  }
});

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

async function archive(markdown) {
  const { blob } = await MdzPackagerCore.buildArchive(
    [{ path: 'index.md', text: markdown }, { path: 'images/photo.png', data: PNG }],
    'Images',
    { title: 'Images', entryPoint: 'index.md', createIndex: false, mapFiles: false, filters: ['**/*'] }
  );
  return new Uint8Array(await blob.arrayBuffer());
}

async function render(markdown) {
  leaks.length = 0;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, { controls: 'viewer', initialLayout: 'preview', initialColorScheme: 'light' });
  await view.open(await archive(markdown), { mode: 'read-only', fileName: 'images.mdz' });
  const preview = container.querySelector('[data-ref="preview-content"]');
  await waitFor(() => assert.ok(preview.querySelector('img')));
  await wait(50);
  return { preview, cleanup: () => { view.destroy(); container.remove(); } };
}

test('archive images never reach the live page as a relative src (Markdown and HTML images)', async () => {
  const { preview, cleanup } = await render([
    '# Photos',
    '',
    '![Markdown image](images/photo.png)',
    '',
    '<img src="images/photo.png" alt="HTML image" width="10" align="right">',
    '',
    '![Web image](https://example.com/web.png)'
  ].join('\n'));
  try {
    assert.deepEqual(leaks, []);
    const images = [...preview.querySelectorAll('img')];
    const archiveImages = images.filter((img) => img.getAttribute('data-mdzip-source') === 'images/photo.png');
    assert.equal(archiveImages.length, 2, 'both archive images go through the image pass');
    for (const img of archiveImages) {
      assert.ok(!/^images\//.test(img.getAttribute('src') ?? ''), `relative src left on an image: ${img.outerHTML}`);
      assert.equal(img.hasAttribute('data-mdzip-pending-src'), false);
    }
    assert.ok(images.some((img) => img.getAttribute('src') === 'https://example.com/web.png'), 'web images keep their src');
  } finally {
    cleanup();
  }
});

test('the chunked (progressive) preview of a long document is covered too', async () => {
  let markdown = '# Long\n\n';
  for (let i = 0; i < 300; i += 1) {
    markdown += `## Section ${i}\n\nParagraph ${i}.\n\n${i % 25 === 0 ? `![p${i}](images/photo.png)\n\n` : ''}`;
  }
  const { preview, cleanup } = await render(markdown);
  try {
    assert.deepEqual(leaks, []);
    for (const img of preview.querySelectorAll('img')) {
      assert.ok(!/^images\//.test(img.getAttribute('src') ?? ''), `relative src left on an image: ${img.outerHTML}`);
    }
  } finally {
    cleanup();
  }
});
