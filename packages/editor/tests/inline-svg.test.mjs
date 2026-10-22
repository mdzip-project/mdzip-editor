import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Archive SVGs with links are shown inline (in a shadow root) so the links
// can be clicked; everything else about them stays as safe as an <img>.
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
const { sanitizeInlineSvg, svgHasLinks } = await import('../dist/svg-inline.js');

const LINKED_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="300px" height="100px" viewBox="0 0 300 100" content="&lt;mxfile&gt;huge&lt;/mxfile&gt;">
  <defs><style>.box{fill:#dae8fc}</style><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
  <a xlink:href="https://github.com/mdzip-project/mdzip-spec" target="_blank"><rect class="box" width="100" height="40" fill="url(#g)"/></a>
  <a href="docs/guide.md"><rect x="110" width="80" height="40"/></a>
  <switch><foreignObject width="100" height="40" requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex"><div style="font-size:12px"><a href="https://www.npmjs.com/package/@mdzip/core-js">core-js</a></div></div></foreignObject><text>core-js</text></switch>
  <image width="10" height="10" xlink:href="data:image/png;base64,iVBORw0KGgo="/>
</svg>`;

const HOSTILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <script>window.__pwned = 1</script>
  <a href="https://ok.example/"><rect width="10" height="10" onclick="window.__pwned = 2"/></a>
  <a xlink:href="javascript:window.__pwned = 3"><rect width="10" height="10"/></a>
  <image href="https://tracker.example/p.png"/><image href="local.png"/><use href="other.svg#x"/><use href="#ok"/>
  <style>@import url(https://tracker.example/x.css); .a{background:url(https://tracker.example/z.png)} .b{fill:url(#grad)}</style>
  <rect style="fill:url(https://tracker.example/q.png)"/>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><iframe src="https://tracker.example/f"></iframe><img src="https://tracker.example/i.png" onerror="window.__pwned = 4"><img src="data:image/png;base64,iVBORw0KGgo="></div></foreignObject>
</svg>`;

const PLAIN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>';

test('a draw.io-style SVG keeps its links, labels and data images; xlink:href becomes href', () => {
  assert.equal(svgHasLinks(LINKED_SVG), true);
  assert.equal(svgHasLinks(PLAIN_SVG), false);
  const svg = sanitizeInlineSvg(LINKED_SVG);
  assert.ok(svg, 'returns an <svg> element');
  assert.equal(svg.localName, 'svg');
  assert.equal(svg.hasAttribute('content'), false, 'the embedded diagram source is dropped');
  const links = [...svg.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  assert.deepEqual(links, ['https://github.com/mdzip-project/mdzip-spec', 'docs/guide.md', 'https://www.npmjs.com/package/@mdzip/core-js']);
  assert.equal(svg.querySelector('a').getAttribute('target'), '_blank');
  assert.ok(!svg.outerHTML.includes('xlink:href'));
  assert.ok(svg.querySelector('foreignObject div[style] a'), 'HTML labels inside foreignObject survive');
  assert.match(svg.querySelector('image').getAttribute('href'), /^data:image\/png/);
  assert.equal(svg.querySelector('rect').getAttribute('fill'), 'url(#g)');
});

test('hostile SVG content is removed: scripts, handlers, javascript: links, outside loads', () => {
  const svg = sanitizeInlineSvg(HOSTILE_SVG);
  const html = svg.outerHTML;
  assert.equal(svg.querySelector('script'), null);
  assert.doesNotMatch(html, /onclick|onerror|javascript:|tracker\.example|@import|iframe/);
  assert.equal(svg.querySelectorAll('a[href]').length, 1, 'only the safe link keeps its href');
  assert.equal(svg.querySelector('a[href]').getAttribute('href'), 'https://ok.example/');
  assert.doesNotMatch(html, /href="local\.png"|other\.svg/, 'relative and outside references are dropped');
  assert.match(html, /fill:url\(#grad\)/, 'in-SVG references are kept');
  assert.equal(svg.querySelectorAll('foreignObject img[src^="data:image/"]').length, 1);
  assert.equal(svg.querySelectorAll('foreignObject img[src^="https:"]').length, 0);
});

test('text that is not an SVG gives null', () => {
  assert.equal(sanitizeInlineSvg('<div>not svg</div>'), null);
  assert.equal(sanitizeInlineSvg('garbage'), null);
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

async function openPreview(options = {}) {
  const { blob } = await MdzPackagerCore.buildArchive([
    { path: 'index.md', text: '# Diagram\n\n<img src="images/linked.svg" alt="Architecture" width="600" align="right">\n\n![Plain](images/plain.svg)\n' },
    { path: 'images/linked.svg', text: LINKED_SVG },
    { path: 'images/plain.svg', text: PLAIN_SVG },
    { path: 'docs/guide.md', text: '# Guide\n' }
  ], 'Diagram', { title: 'Diagram', entryPoint: 'index.md', createIndex: false, mapFiles: false, filters: ['**/*'] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const activated = [];
  const view = new MdzipWorkspaceView(container, {
    controls: 'viewer',
    initialLayout: 'preview',
    initialColorScheme: 'light',
    onLinkActivated: (event) => { activated.push(event); event.preventDefault(); },
    ...options
  });
  await view.open(new Uint8Array(await blob.arrayBuffer()), { mode: 'read-only', fileName: 'diagram.mdz' });
  const preview = container.querySelector('[data-ref="preview-content"]');
  await waitFor(() => assert.ok(preview.querySelector('h1')));
  return { view, container, preview, activated, cleanup: () => { view.destroy(); container.remove(); } };
}

test('the preview shows a linked SVG inline, keeps a plain SVG as an image, and routes its link clicks', async () => {
  const { preview, activated, cleanup } = await openPreview({ externalLinks: { target: '_blank' } });
  try {
    await waitFor(() => assert.ok(preview.querySelector('.mdzip-inline-svg')?.shadowRoot?.querySelector('svg')));
    const host = preview.querySelector('.mdzip-inline-svg');
    assert.equal(host.getAttribute('aria-label'), 'Architecture');
    assert.equal(host.getAttribute('role'), 'group');
    assert.equal(host.style.width, '600px');
    assert.equal(host.getAttribute('data-mdzip-source'), 'images/linked.svg');
    assert.ok(host.classList.contains('mdzip-image-right'), 'keeps the image alignment');
    assert.equal(preview.querySelectorAll('.mdzip-inline-svg').length, 1);
    assert.ok([...preview.querySelectorAll('img')].some((img) => img.getAttribute('data-mdzip-source') === 'images/plain.svg'), 'plain SVG stays an <img>');

    const links = [...host.shadowRoot.querySelectorAll('a[href]')];
    assert.equal(links.length, 3);
    assert.equal(links[2].getAttribute('target'), '_blank', 'the external-link policy reaches inline SVG links');

    links[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    assert.equal(activated.length, 1);
    assert.equal(activated[0].href, 'docs/guide.md');
    assert.equal(activated[0].targetPath, 'docs/guide.md');
  } finally {
    cleanup();
  }
});

test('inlineSvgLinks: false keeps every SVG as an image', async () => {
  const { preview, cleanup } = await openPreview({ inlineSvgLinks: false });
  try {
    await waitFor(() => assert.equal(preview.querySelectorAll('img[data-mdzip-source]').length, 2));
    assert.equal(preview.querySelector('.mdzip-inline-svg'), null);
  } finally {
    cleanup();
  }
});
