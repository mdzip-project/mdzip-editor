import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { MdzipAssetSession } from '../dist/index.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

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
