// The static-page layer, ported from mdzip.org's scripts/lib/page-renderer.mjs
// with its tests. Runs without a global window: renderMdzPage loads jsdom.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MdzPackagerCore } from '@mdzip/core-js';
import { renderMdzPage, collectLocalImageRefs } from '../dist/page.js';

const PNG_1X1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

async function archive(files, manifest = {}) {
  const { blob } = await MdzPackagerCore.buildArchive(files, 'T', {
    title: 'T', entryPoint: 'index.md', createIndex: false, mapFiles: false, filters: ['**/*'], ...manifest
  });
  return new Uint8Array(await blob.arrayBuffer());
}

const basic = await archive([
  { path: 'index.md', text: '# Hello\n\n![Logo](images/logo.png)\n\n<img src="images/logo.png" alt="Again">\n\n[Other](other.md)\n\n`![x](images/missing.png)`\n' },
  { path: 'images/logo.png', data: PNG_1X1 },
  { path: 'other.md', text: '# Other\n' }
], { title: 'Basic page', description: 'A test page.' });

test('collectLocalImageRefs skips external refs and code', () => {
  assert.deepEqual(collectLocalImageRefs('![a](a.png) ![b](https://x/b.png) `![c](c.png)` <img src="d.svg"> <source srcset="e.webp">'),
    ['a.png', 'd.svg', 'e.webp']);
});

test('renders the entry point with title, description and sanitized HTML', async () => {
  const page = await renderMdzPage(basic);
  assert.equal(page.entryPoint, 'index.md');
  assert.equal(page.title, 'Basic page');
  assert.equal(page.description, 'A test page.');
  assert.match(page.html, /<h1 id="hello">Hello<\/h1>/);
  assert.equal(globalThis.window, undefined, 'jsdom is loaded without becoming a global');
});

test('pictures work with no options: one asset per file, saved at its path, which the HTML uses', async () => {
  const page = await renderMdzPage(basic);
  assert.equal(page.assets.length, 1);
  const [asset] = page.assets;
  assert.equal(asset.archivePath, 'images/logo.png');
  assert.match(asset.fileName, /^[0-9a-f]{12}\.png$/);
  assert.equal(asset.path, `assets/page-images/${asset.fileName}`);
  assert.equal(asset.url, asset.path);
  assert.deepEqual(asset.bytes, PNG_1X1);
  assert.equal(page.html.split(`src="${asset.path}"`).length - 1, 2, 'Markdown image and raw <img>');
  assert.match(page.html, /<code>!\[x\]\(images\/missing\.png\)<\/code>/, 'code examples are untouched');
});

test('content-hash names are deterministic', async () => {
  const [a, b] = await Promise.all([renderMdzPage(basic), renderMdzPage(basic)]);
  assert.equal(a.assets[0].fileName, b.assets[0].fileName);
});

test('assetDir and assetUrl override where pictures go', async () => {
  const dir = await renderMdzPage(basic, { assetDir: 'img/' });
  assert.match(dir.assets[0].path, /^img\/[0-9a-f]{12}\.png$/);
  assert.match(dir.html, /src="img\/[0-9a-f]{12}\.png"/);
  const cdn = await renderMdzPage(basic, { assetUrl: (fileName) => `https://cdn.example.com/${fileName}?a=1&b=2` });
  assert.match(cdn.html, /src="https:\/\/cdn\.example\.com\/[0-9a-f]{12}\.png\?a=1&amp;b=2"/);
  assert.match(cdn.assets[0].path, /^assets\/page-images\//, 'path stays the default');
});

test('withAssetUrls swaps in addresses after rendering', async () => {
  const page = await renderMdzPage(basic);
  const uploaded = page.withAssetUrls({ 'images/logo.png': 'https://media.example.com/42' });
  assert.equal(uploaded.assets[0].url, 'https://media.example.com/42');
  assert.equal(uploaded.html.split('src="https://media.example.com/42"').length - 1, 2);
  assert.equal(page.html.includes('media.example.com'), false, 'the original page is unchanged');
  const byFunction = uploaded.withAssetUrls((asset) => `/m/${asset.fileName}`);
  assert.match(byFunction.html, /src="\/m\/[0-9a-f]{12}\.png"/);
});

test('inlineImages puts pictures in the HTML and leaves assets empty', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#f00"/></svg>';
  const bytes = await archive([
    { path: 'index.md', text: '![Logo](images/logo.png)\n\n![Square](images/square.svg)\n' },
    { path: 'images/logo.png', data: PNG_1X1 },
    { path: 'images/square.svg', text: svg }
  ]);
  const page = await renderMdzPage(bytes, { inlineImages: true });
  assert.deepEqual(page.assets, []);
  assert.match(page.html, /src="data:image\/png;base64,iVBOR/);
  const svgSrc = /src="(data:image\/svg\+xml,[^"]*)"/.exec(page.html)?.[1];
  assert.ok(svgSrc, page.html);
  assert.equal(decodeURIComponent(svgSrc.slice('data:image/svg+xml,'.length)), svg);
  assert.doesNotMatch(svgSrc, /[<>"#]/);
});

test('page links go through resolveLink, and external links can open in a new tab', async () => {
  const bytes = await archive([{ path: 'index.md', text: '[Other](other.md) [Site](https://mdzip.org)\n' }, { path: 'other.md', text: '# O\n' }]);
  const page = await renderMdzPage(bytes, { resolveLink: (href) => href.replace(/\.md$/, '.html'), externalLinks: 'new-tab' });
  assert.match(page.html, /<a href="other\.html">Other<\/a>/);
  assert.match(page.html, /<a href="https:\/\/mdzip\.org" target="_blank" rel="noopener">Site<\/a>/);
});

test('the page is sanitized unless sanitize: false', async () => {
  const bytes = await archive([{ path: 'index.md', text: '<p style="color:red" onclick="x()">Hi</p><script>alert(1)</script>\n' }]);
  const safe = await renderMdzPage(bytes);
  assert.doesNotMatch(safe.html, /script|onclick|style=/);
  const trusted = await renderMdzPage(bytes, { sanitize: false });
  assert.match(trusted.html, /style="color:red"/);
});

// SVG diagrams with links are inlined so the links work; plain and unsafe SVGs stay <img>.
const LINKED = '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x"><!-- c --><svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" content="&lt;mxfile/&gt;"><a href="https://github.com/mdzip-project"><rect width="10" height="10"/></a></svg>';
const PLAIN = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
const UNSAFE = '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://x.example/"><rect onclick="alert(1)"/></a></svg>';
const OUTSIDE = '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://x.example/"><image href="https://x.example/p.png"/></a></svg>';
const svgBytes = await archive([
  { path: 'index.md', text: '# S\n\n<img src="d/linked.svg" alt="Linked diagram" width="600" align="right">\n\n![Plain](d/plain.svg)\n\n![Unsafe](d/unsafe.svg)\n\n![Outside](d/outside.svg)\n\n`<img src="d/linked.svg">`\n' },
  { path: 'd/linked.svg', text: LINKED }, { path: 'd/plain.svg', text: PLAIN },
  { path: 'd/unsafe.svg', text: UNSAFE }, { path: 'd/outside.svg', text: OUTSIDE }
]);

test('an SVG with links is inlined in a declarative shadow root, with the <img> as fallback', async () => {
  const page = await renderMdzPage(svgBytes);
  const host = page.html.match(/<span class="mdz-inline-svg mdz-inline-svg-right" role="group" aria-label="Linked diagram" style="width:600px"><template shadowrootmode="open"><style>[^<]*<\/style><svg[\s\S]*?<\/svg><\/template><img [^>]*><\/span>/);
  assert.ok(host, page.html);
  assert.match(host[0], /<a href="https:\/\/github\.com\/mdzip-project">/);
  assert.doesNotMatch(host[0], /<\?xml|<!DOCTYPE|<!--|content="/);
  assert.match(host[0], /<\/template><img [^>]*src="assets\/page-images\/[0-9a-f]{12}\.svg"/);
});

test('SVGs without links, unsafe ones and ones that load from outside stay images, with warnings', async () => {
  const warnings = [];
  const page = await renderMdzPage(svgBytes, { onWarning: (message) => warnings.push(message) });
  assert.equal((page.html.match(/class="mdz-inline-svg/g) ?? []).length, 1);
  for (const alt of ['Plain', 'Unsafe', 'Outside']) {
    assert.match(page.html, new RegExp(`<p><img src="assets/page-images/[0-9a-f]{12}\\.svg" alt="${alt}"></p>`));
  }
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some((w) => /^d\/unsafe\.svg: has links but isn't inlined.*a script/.test(w)), warnings.join(' | '));
  assert.ok(warnings.some((w) => /^d\/outside\.svg: .*loads an image or element from outside itself/.test(w)), warnings.join(' | '));
  assert.match(page.html, /<code>&lt;img src="d\/linked\.svg"&gt;<\/code>/, 'code examples are untouched');
});

test('inlineLinkedSvg: false keeps every SVG an image', async () => {
  const page = await renderMdzPage(svgBytes, { inlineLinkedSvg: false });
  assert.doesNotMatch(page.html, /shadowrootmode/);
});

test('a <picture> with linked SVGs becomes options, with CSS that picks the first matching source', async () => {
  const bytes = await archive([
    { path: 'index.md', text: '# P\n\n<p align="center"><picture><source media="(max-width: 480px)" srcset="d/phone.svg" width="300" height="400">' +
      '<source media="(min-width: 2000px)" srcset="d/huge.svg"><img src="d/wide.svg" alt="The hub" width="600" height="600"></picture></p>\n\n' +
      '<picture><source media="(max-width: 480px)" srcset="d/plain.svg"><img src="d/plain.svg" alt="Plain"></picture>\n' },
    { path: 'd/phone.svg', text: LINKED }, { path: 'd/wide.svg', text: LINKED.replace('mdzip-project', 'mdzip-project/mdzip-spec') },
    { path: 'd/huge.svg', text: PLAIN }, { path: 'd/plain.svg', text: PLAIN }
  ]);
  const page = await renderMdzPage(bytes);
  assert.deepEqual(page.assets.map((a) => a.archivePath).sort(), ['d/huge.svg', 'd/phone.svg', 'd/plain.svg', 'd/wide.svg']);
  assert.match(page.html, /<picture><source media="\(max-width: 480px\)" srcset="assets\/page-images\/[0-9a-f]{12}\.svg"><img src="assets\/page-images\/[0-9a-f]{12}\.svg" alt="Plain"><\/picture>/,
    'a <picture> without links stays a <picture>');

  const block = page.html.match(/<span class="mdz-picture" id="mdz-picture-1">[\s\S]*?<\/p>/)?.[0] ?? '';
  assert.ok(block, page.html);
  const options = [...block.matchAll(/<span class="mdz-picture-option" data-option="(\d)">/g)].map((m) => m[1]);
  assert.deepEqual(options, ['0', '1', '2'], 'each source, then the <img>');
  const css = /<style>([^<]*)<\/style>/.exec(block)[1];
  assert.equal(css, '#mdz-picture-1>[data-option]{display:none}#mdz-picture-1>[data-option="2"]{display:inline}' +
    '@media (min-width: 2000px){#mdz-picture-1>[data-option]{display:none}#mdz-picture-1>[data-option="1"]{display:inline}}' +
    '@media (max-width: 480px){#mdz-picture-1>[data-option]{display:none}#mdz-picture-1>[data-option="0"]{display:inline}}');
  assert.match(block, /data-option="0"><span class="mdz-inline-svg" role="group" aria-label="The hub" style="width:300px"><template shadowrootmode="open">/);
  assert.match(block, /data-option="1"><img src="assets\/page-images\/[0-9a-f]{12}\.svg" alt="The hub"><\/span>/);
  assert.match(block, /data-option="2"><span class="mdz-inline-svg" role="group" aria-label="The hub" style="width:600px">[\s\S]*mdzip-spec/);
});
