import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { MdzipAssetSession, sniffImageSize } from '../dist/index.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const PNG_1X1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
));

test('sniffImageSize reads intrinsic dimensions from common headers', () => {
  assert.deepEqual(sniffImageSize(PNG_1X1, 'image/png'), { width: 1, height: 1 });

  // Minimal GIF87a header: 4x3 logical screen (little-endian).
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 4, 0, 3, 0]);
  assert.deepEqual(sniffImageSize(gif, 'image/gif'), { width: 4, height: 3 });

  const svg = new TextEncoder().encode('<svg width="120" height="40" xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.deepEqual(sniffImageSize(svg, 'image/svg+xml'), { width: 120, height: 40 });

  assert.equal(sniffImageSize(new Uint8Array([1, 2, 3, 4]), 'application/octet-stream'), undefined);
});

function asset(path, bytes, reads) {
  return {
    path,
    fileName: path.split('/').at(-1),
    byteSize: bytes.length,
    mimeType: 'image/png',
    kind: 'image',
    isPreviewable: true,
    readBytes: async () => {
      reads.push(path);
      return bytes;
    }
  };
}

test('asset sessions resolve only referenced images and cache revisits', async () => {
  const dom = new JSDOM('');
  const reads = [];
  const assets = [
    asset('images/first.png', new Uint8Array([1]), reads),
    asset('images/second.png', new Uint8Array([2]), reads),
    asset('images/orphan.png', new Uint8Array([3]), reads)
  ];
  const workspace = {
    readPathBytes: async (path) => assets.find((item) => item.path === path)?.readBytes()
  };
  const session = new MdzipAssetSession(workspace, assets, dom.window.document);
  const signal = new AbortController().signal;

  const first = await session.rewriteHtml(
    '<img src="images/first.png"><img src="./images/first.png">',
    'index.md',
    signal
  );
  assert.match(first, /data:image\/png;base64,AQ==/);
  assert.deepEqual(reads, ['images/first.png']);

  await session.rewriteHtml('<img src="images/second.png">', 'index.md', signal);
  await session.rewriteHtml('<img src="images/first.png">', 'index.md', signal);
  assert.deepEqual(reads, ['images/first.png', 'images/second.png']);
  session.destroy();
});

test('persistent cache aliases avoid rereading the same archive asset', async () => {
  const dom = new JSDOM('');
  const content = new Map();
  const references = new Map();
  const cache = {
    get: async (key) => content.get(key),
    set: async (key, value) => content.set(key, value),
    getReference: async (key) => references.get(key),
    setReference: async (key, value) => references.set(key, value)
  };
  const reads = [];
  const assets = [asset('images/logo.png', new Uint8Array([7, 8, 9]), reads)];
  const workspace = {
    readPathBytes: async (path) => assets.find((item) => item.path === path)?.readBytes()
  };

  const first = new MdzipAssetSession(workspace, assets, dom.window.document, {
    cache,
    sourceId: 'archive-a'
  });
  await first.resolve('images/logo.png', 'index.md');
  first.destroy();

  const second = new MdzipAssetSession(workspace, assets, dom.window.document, {
    cache,
    sourceId: 'archive-a'
  });
  await second.resolve('images/logo.png', 'index.md');
  second.destroy();

  assert.deepEqual(reads, ['images/logo.png']);
  assert.equal(content.size, 1);
});

test('resolveImage returns the URL plus sniffed intrinsic dimensions', async () => {
  const dom = new JSDOM('');
  const reads = [];
  const assets = [asset('images/logo.png', PNG_1X1, reads)];
  const workspace = {
    readPathBytes: async (path) => assets.find((item) => item.path === path)?.readBytes()
  };
  const session = new MdzipAssetSession(workspace, assets, dom.window.document);

  const resolved = await session.resolveImage('images/logo.png', 'index.md');
  assert.ok(resolved);
  assert.match(resolved.url, /^data:image\/png;base64,/);
  assert.equal(resolved.width, 1);
  assert.equal(resolved.height, 1);

  assert.equal(await session.resolveImage('images/missing.png', 'index.md'), undefined);
  session.destroy();
});

test('resolveDataUrl returns a data: URL fallback regardless of object-URL support', async () => {
  // Stub createObjectURL so resolve() returns blob:, proving resolveDataUrl is
  // an independent data: path (the CSP-blocked-blob recovery in the view).
  const dom = new JSDOM('');
  dom.window.URL.createObjectURL = () => 'blob:test';
  dom.window.URL.revokeObjectURL = () => {};
  const reads = [];
  const assets = [asset('images/logo.png', PNG_1X1, reads)];
  const workspace = {
    readPathBytes: async (path) => assets.find((item) => item.path === path)?.readBytes()
  };
  const session = new MdzipAssetSession(workspace, assets, dom.window.document);

  assert.equal(await session.resolve('images/logo.png', 'index.md'), 'blob:test');
  const dataUrl = await session.resolveDataUrl('images/logo.png', 'index.md');
  assert.ok(dataUrl?.startsWith('data:image/png;base64,'), 'expected a data: URL');

  assert.equal(await session.resolveDataUrl('images/missing.png', 'index.md'), undefined);
  session.destroy();
  assert.equal(await session.resolveDataUrl('images/logo.png', 'index.md'), undefined);
});
