import assert from 'node:assert/strict';
import test from 'node:test';
import { MdzArchiveCore } from 'mdzip-core-js';
import {
  MdzipReadOnlyError,
  MdzipWorkspaceService,
  buildNewArchiveBytesWithTitle,
  buildMdzipNavTree,
  canEditMdzipPath,
  openMdzArchive,
  readTextFileFromArchive,
  resolveMdzipArchiveLinkTarget,
  resolveMdzipControlPolicy
} from '../dist/index.js';

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  )
);

test('opens archives for view-only inspection', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Hello\n\n![Logo](images/logo.png)\n', 'Demo', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);

  const workspace = await MdzipWorkspaceService.open(bytes, {
    mode: 'read-only',
    fileName: 'hello.mdz'
  });
  const snapshot = workspace.snapshot();

  assert.equal(snapshot.mode, 'read-only');
  assert.equal(snapshot.content.entryPoint, 'index.md');
  assert.equal(snapshot.displayTitle, 'Demo');
  assert.equal(snapshot.content.images.get('images/logo.png').startsWith('data:image/png;base64,'), true);
  assert.throws(() => workspace.editText('# Blocked\n'), MdzipReadOnlyError);
  await assert.rejects(() => workspace.saveToBytes(), MdzipReadOnlyError);
});

test('edits markdown and saves updated archive bytes', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Original\n', 'Original');
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  workspace.editText('# Updated\n');
  assert.equal(workspace.dirty, true);

  const saved = await workspace.saveToBytes();
  assert.equal(workspace.dirty, false);
  assert.equal(await readTextFileFromArchive(saved, 'index.md'), '# Updated\n');
});

test('opens a normalized core workspace directly and flushes a host snapshot', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Original\n', 'Original', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);
  const coreWorkspace = await MdzArchiveCore.openWorkspace(bytes, {
    includeOrphanedAssetAnalysis: true
  });
  const workspace = await MdzipWorkspaceService.openWorkspace(coreWorkspace, { mode: 'editable' });

  workspace.editText('# Updated\n');
  const snapshot = await workspace.flush();
  const savedBytes = new Uint8Array(await snapshot.bytes.arrayBuffer());

  assert.equal(snapshot.state.dirty, false);
  assert.equal(snapshot.state.validationStatus, 'valid');
  assert.equal(snapshot.state.title, 'Original');
  assert.equal(await readTextFileFromArchive(savedBytes, 'index.md'), '# Updated\n');
  assert.equal(snapshot.workspace.assets.some((asset) => asset.path === 'images/logo.png'), true);
});

test('manages manifest title and orphaned assets', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Original\n', 'Original');
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  await workspace.addAsset('images/unused.png', PNG_1X1);
  assert.deepEqual(workspace.snapshot().content.orphanedAssetPaths, ['images/unused.png']);

  const removed = await workspace.removeAsset('images/unused.png');
  assert.equal(removed, true);

  await workspace.setManifestTitle('Renamed');
  const saved = await workspace.saveToBytes();
  assert.equal((await openMdzArchive(saved)).manifest.title, 'Renamed');
});

test('pastes an image through the framework-independent workspace service', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Original\n\n', 'Original');
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  const result = await workspace.pasteImage({
    bytes: PNG_1X1,
    mimeType: 'image/png',
    selectionStart: '# Original\n\n'.length,
    selectionEnd: '# Original\n\n'.length
  });

  assert.ok(result);
  assert.match(result.archivePath, /^images\/pasted-\d+\.png$/);
  assert.equal(result.markdownImage, `![Pasted image](${result.markdownPath})`);
  assert.equal(workspace.currentText, `# Original\n\n${result.markdownImage}`);
  assert.equal(workspace.snapshot().content.paths.some((entry) => entry.path === result.archivePath), true);

  const saved = await workspace.saveToBytes();
  assert.equal(await readTextFileFromArchive(saved, 'index.md'), `# Original\n\n${result.markdownImage}`);
});

test('provides workspace view helpers outside framework wrappers', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Original\n', 'Original', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });
  const snapshot = workspace.snapshot();

  assert.equal(canEditMdzipPath(snapshot.currentPathType, snapshot.currentPath, snapshot.mode), true);
  assert.equal(canEditMdzipPath('text', 'manifest.json', 'editable'), false);

  const tree = buildMdzipNavTree(snapshot.content.paths);
  assert.equal(tree.some((node) => node.name === 'images'), true);
  assert.equal(tree.some((node) => node.name === 'index.md'), true);
});

test('resolves archive-local markdown preview links', () => {
  const entries = [
    { path: 'docs/index.md', isMarkdown: true, isImage: false, isDirectory: false },
    { path: 'docs/guide.md', isMarkdown: true, isImage: false, isDirectory: false },
    { path: 'appendix.md', isMarkdown: true, isImage: false, isDirectory: false },
    { path: 'docs/image.png', isMarkdown: false, isImage: true, isDirectory: false }
  ];

  assert.equal(resolveMdzipArchiveLinkTarget('guide.md', 'docs/index.md', entries), 'docs/guide.md');
  assert.equal(resolveMdzipArchiveLinkTarget('../appendix.md#notes', 'docs/index.md', entries), 'appendix.md');
  assert.equal(resolveMdzipArchiveLinkTarget('/docs/guide.md?x=1', 'docs/index.md', entries), 'docs/guide.md');
  assert.equal(resolveMdzipArchiveLinkTarget('image.png', 'docs/index.md', entries), null);
  assert.equal(resolveMdzipArchiveLinkTarget('https://example.com/guide.md', 'docs/index.md', entries), null);
});

test('resolves control policy presets for common host scenarios', () => {
  assert.deepEqual(resolveMdzipControlPolicy('viewer'), {
    preset: 'viewer',
    toolbar: true,
    navigation: true,
    title: false,
    layout: true,
    save: false,
    zoom: true,
    orphanActions: false
  });

  assert.equal(resolveMdzipControlPolicy('standalone-editor').save, true);
  assert.equal(resolveMdzipControlPolicy('hosted-editor').save, false);
  assert.equal(resolveMdzipControlPolicy(undefined).preset, 'standalone-editor');
});

test('resolves custom control policy overrides', () => {
  const policy = resolveMdzipControlPolicy({
    preset: 'hosted-editor',
    toolbar: false,
    zoom: false
  });

  assert.equal(policy.preset, 'hosted-editor');
  assert.equal(policy.toolbar, false);
  assert.equal(policy.save, false);
  assert.equal(policy.navigation, true);
  assert.equal(policy.zoom, false);
});
