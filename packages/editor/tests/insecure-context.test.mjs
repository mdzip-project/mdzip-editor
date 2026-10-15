import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { JSDOM } from 'jsdom';

// #55: crypto.subtle only exists in secure contexts (HTTPS or localhost). Over plain
// HTTP on a LAN host it's undefined, and opening an archive used to throw.

if (typeof globalThis.window === 'undefined') {
  globalThis.window = new JSDOM('<!doctype html><html><body></body></html>').window;
}

const { sha256Fallback, sha256Hex } = await import('../dist/sha256.js');
const {
  MdzipAssetSession,
  buildNewArchiveBytesWithTitle,
  createArchiveInventory,
  mdzipArchiveSourceId
} = await import('../dist/index.js');

const PNG_1X1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
));

const nodeHex = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Runs `fn` with `globalThis.crypto` replaced by one that has no `subtle`, as in an insecure context. */
async function withoutSubtle(fn) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: (array) => randomBytes(array.length).copy(Buffer.from(array.buffer)) && array }
  });
  try {
    assert.equal(globalThis.crypto.subtle, undefined);
    return await fn();
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor);
  }
}

test('the fallback SHA-256 matches Node for padding edge cases and random input', () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70_000]) {
    const bytes = randomBytes(length);
    assert.equal(Buffer.from(sha256Fallback(bytes)).toString('hex'), nodeHex(bytes), `length ${length}`);
  }
  assert.equal(
    Buffer.from(sha256Fallback(new TextEncoder().encode('abc'))).toString('hex'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

test('hashes are the same with and without crypto.subtle', async () => {
  const bytes = randomBytes(5000);
  const secure = await sha256Hex(bytes);
  const insecure = await withoutSubtle(() => sha256Hex(bytes));
  assert.equal(insecure, secure);
  assert.equal(secure, nodeHex(bytes));
});

test('an archive with images opens and resolves assets without crypto.subtle', async () => {
  const archive = await buildNewArchiveBytesWithTitle('# Hi\n\n![Logo](images/logo.png)\n', 'Demo', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);
  const secureId = await mdzipArchiveSourceId(archive);

  await withoutSubtle(async () => {
    assert.equal(await mdzipArchiveSourceId(archive), secureId);

    // The persistent cache path hashes asset bytes (contentAddress); it must work too.
    const store = new Map();
    const cache = {
      get: async (key) => store.get(key),
      set: async (key, value) => { store.set(key, value); },
      getReference: async (key) => store.get(`ref:${key}`),
      setReference: async (key, value) => { store.set(`ref:${key}`, value); }
    };
    const assets = [{
      path: 'images/logo.png', fileName: 'logo.png', byteSize: PNG_1X1.length,
      mimeType: 'image/png', kind: 'image', isPreviewable: true, readBytes: async () => PNG_1X1
    }];
    const workspace = { readPathBytes: async () => PNG_1X1 };
    const session = new MdzipAssetSession(workspace, assets, new JSDOM('').window.document, {
      cache,
      sourceId: secureId
    });
    assert.ok(await session.resolve('images/logo.png', 'index.md'));
    assert.ok([...store.keys()].some((key) => key.startsWith('sha256:')), 'content was cached by hash');
  });
});

test('the diff inventory works without crypto.subtle', async () => {
  const archive = await buildNewArchiveBytesWithTitle('# Hi\n', 'Demo');
  const secure = await createArchiveInventory(archive);
  const insecure = await withoutSubtle(() => createArchiveInventory(archive));
  assert.deepEqual(insecure.entries.map((e) => e.hash), secure.entries.map((e) => e.hash));
});
