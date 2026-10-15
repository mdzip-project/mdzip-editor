import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';

// Spec 1.2.0 §5.4.1: archive paths match case-sensitively after NFC normalization, on
// @mdzip/core-js 2.0.0. New names still may not differ from an existing one only in case.

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (typeof globalThis.window === 'undefined') {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
}

const {
  MdzipAssetSession,
  MdzipWorkspaceService,
  buildNewArchiveBytesWithTitle,
  readTextFileFromArchive,
  resolveMdzipArchiveLinkTarget
} = await import('../dist/index.js');

const PNG_1X1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
));

function asset(path, bytes) {
  return {
    path,
    fileName: path.split('/').at(-1),
    byteSize: bytes.length,
    mimeType: 'image/png',
    kind: 'image',
    isPreviewable: true,
    readBytes: async () => bytes
  };
}

test('images resolve case-sensitively; NFD and NFC spellings match', async () => {
  const dom = new JSDOM('');
  const assets = [
    asset('images/Logo.png', new Uint8Array([1])),
    asset('images/logo.png', new Uint8Array([2])),
    asset('images/café.png', new Uint8Array([3]))
  ];
  const workspace = { readPathBytes: async (path) => assets.find((item) => item.path === path)?.readBytes() };
  const session = new MdzipAssetSession(workspace, assets, dom.window.document);

  const upper = await session.resolve('images/Logo.png', 'index.md');
  const lower = await session.resolve('images/logo.png', 'index.md');
  assert.ok(upper && lower);
  // Two different files, so two different URLs (the cache doesn't fold case).
  assert.notEqual(upper, lower);
  assert.equal(await session.resolve('images/LOGO.png', 'index.md'), undefined);
  assert.ok(await session.resolve('images/café.png', 'index.md'), 'NFD link finds the NFC entry');
});

test('Markdown link targets resolve case-sensitively', () => {
  const entries = [
    { path: 'index.md', isMarkdown: true },
    { path: 'docs/Guide.md', isMarkdown: true }
  ];
  assert.equal(resolveMdzipArchiveLinkTarget('docs/Guide.md', 'index.md', entries), 'docs/Guide.md');
  assert.equal(resolveMdzipArchiveLinkTarget('docs/guide.md', 'index.md', entries), null);
});

test('a case-only rename saves as a rename, not a copy', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Hello\n\n![Logo](images/Logo.png)\n', 'Demo', [
    { archivePath: 'images/Logo.png', fileBytes: PNG_1X1 }
  ]);
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  assert.equal(await workspace.renameFile('images/Logo.png', 'images/logo.png'), true);
  assert.equal(workspace.currentText, '# Hello\n\n![Logo](images/logo.png)\n');

  const saved = await workspace.saveToBytes();
  const workspaceAfter = await MdzipWorkspaceService.open(saved, { mode: 'editable' });
  const names = workspaceAfter.snapshot().content.paths.map((entry) => entry.path);
  assert.ok(names.includes('images/logo.png'));
  assert.ok(!names.includes('images/Logo.png'), 'the old name is removed');
  assert.equal(await readTextFileFromArchive(saved, 'index.md'), '# Hello\n\n![Logo](images/logo.png)\n');
});

test('a new name may not differ from another file only in case', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Hello\n', 'Demo', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 },
    { archivePath: 'images/other.png', fileBytes: PNG_1X1 }
  ]);
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  assert.equal(await workspace.renameFile('images/other.png', 'images/LOGO.png'), false);
  assert.equal(await workspace.renameFile('images/other.png', 'images/brand.png'), true);
});

test('lookups by the wrong case find nothing', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Hello\n', 'Demo', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  assert.equal(await workspace.removeFile('images/LOGO.png'), false);
  assert.equal(await workspace.renameFile('Images/logo.png', 'images/x.png'), false);
  assert.equal(await workspace.setEntryPoint('INDEX.md'), false);
  assert.ok(workspace.snapshot().content.paths.some((entry) => entry.path === 'images/logo.png'));
});

// notes.md + manifest.json {"title": "t"}: a manifest that doesn't name its entry point.
const NO_ENTRY_POINT_MDZ = Uint8Array.from(Buffer.from(
  'UEsDBBQAAAAIAAe1Tl3r9dC9CgAAAAgAAAAIAAAAbm90ZXMubWRTVvDLL0kt5gIAUEsDBBQAAAAIAAe1Tl2IKyKaEAAAAA4AAAANAAAAbWFuaWZlc3QuanNvbqtWKsksyUlVslJQKlGqBQBQSwECFAAUAAAACAAHtU5d6/XQvQoAAAAIAAAACAAAAAAAAAAAAAAAgAEAAAAAbm90ZXMubWRQSwECFAAUAAAACAAHtU5diCsimhAAAAAOAAAADQAAAAAAAAAAAAAAgAEwAAAAbWFuaWZlc3QuanNvblBLBQYAAAAAAgACAHEAAABrAAAAAAA=',
  'base64'
));

test('adding a second root document keeps the entry point when the manifest names none', async () => {
  const workspace = await MdzipWorkspaceService.open(NO_ENTRY_POINT_MDZ, { mode: 'editable' });
  await workspace.addAsset('other.md', new TextEncoder().encode('# Other\n'));

  const saved = await workspace.saveToBytes();
  const reopened = await MdzipWorkspaceService.open(saved, { mode: 'editable' });
  assert.equal(reopened.snapshot().content.entryPoint, 'notes.md');
  assert.equal(reopened.snapshot().content.manifest?.entryPoint, 'notes.md');
});
