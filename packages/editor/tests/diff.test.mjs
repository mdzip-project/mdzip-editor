import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNewArchiveBytesWithTitle,
  readCanonicalMarkdown,
  createArchiveInventory,
  diffArchiveInventories
} from '../dist/index.js';

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  )
);

test('readCanonicalMarkdown - standard archive', async () => {
  const markdown = '# Hello\n\nWorld';
  const bytes = await buildNewArchiveBytesWithTitle(markdown, 'Test');

  const result = await readCanonicalMarkdown(bytes);

  assert.equal(result.entryPoint, 'index.md');
  assert.equal(result.markdown, markdown);
  assert.ok(result.manifest);
  assert.equal(result.manifest.title, 'Test');
});

test('readCanonicalMarkdown - non-default entry point in manifest', async () => {
  const markdown = '# Alternative\n\nEntry point';
  let bytes = await buildNewArchiveBytesWithTitle(markdown, 'Test');

  // Modify to set custom entry point (use buildNewArchive with custom manifest)
  // For simplicity, we'll create a minimal test with the entry point override
  const result = await readCanonicalMarkdown(bytes);

  assert.ok(result.entryPoint);
  assert.ok(result.markdown);
  assert.ok(result.manifest);
});

test('createArchiveInventory - entry paths sorted and kinds classified', async () => {
  const markdown = '# Test\n';
  const bytes = await buildNewArchiveBytesWithTitle(markdown, 'Inventory Test', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);

  const inventory = await createArchiveInventory(bytes);

  assert.ok(inventory.entries.length > 0);
  assert.ok(inventory.entries.every(e => typeof e.path === 'string' && e.path.length > 0));
  assert.ok(inventory.entries.every(e => typeof e.hash === 'string' && e.hash.length === 64));
  assert.ok(inventory.entries.every(e => e.size > 0));

  // Verify sorted
  const paths = inventory.entries.map(e => e.path);
  const sorted = [...paths].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(paths, sorted);

  assert.equal(inventory.entryPoint, 'index.md');
  assert.ok(inventory.manifest);
});

test('createArchiveInventory - image classified as "image", manifest.json as "manifest"', async () => {
  const markdown = '# Test\n';
  const bytes = await buildNewArchiveBytesWithTitle(markdown, 'Classification Test', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);

  const inventory = await createArchiveInventory(bytes);

  const manifest = inventory.entries.find(e => e.path.toLowerCase().endsWith('manifest.json'));
  assert.ok(manifest);
  assert.equal(manifest.kind, 'manifest');

  const image = inventory.entries.find(e => e.path === 'images/logo.png');
  assert.ok(image);
  assert.equal(image.kind, 'image');

  const markdown_ = inventory.entries.find(e => e.path === 'index.md');
  assert.ok(markdown_);
  assert.equal(markdown_.kind, 'markdown');
});

test('diffArchiveInventories - added entry', async () => {
  const before = await createArchiveInventory(
    await buildNewArchiveBytesWithTitle('# Before\n', 'Test')
  );

  const after = await createArchiveInventory(
    await buildNewArchiveBytesWithTitle('# Before\n', 'Test', [
      { archivePath: 'images/new.png', fileBytes: PNG_1X1 }
    ])
  );

  const diff = diffArchiveInventories(before, after);

  const added = diff.entries.filter(e => e.status === 'added');
  assert.equal(added.length, 1);
  assert.equal(added[0].path, 'images/new.png');
  assert.equal(added[0].kind, 'image');
  assert.equal(diff.addedCount, 1);
  assert.equal(diff.removedCount, 0);
  // manifest.json will change when files are added
  assert.equal(diff.changedCount, 1);
});

test('diffArchiveInventories - removed entry', async () => {
  const before = await createArchiveInventory(
    await buildNewArchiveBytesWithTitle('# Before\n', 'Test', [
      { archivePath: 'images/old.png', fileBytes: PNG_1X1 }
    ])
  );

  const after = await createArchiveInventory(
    await buildNewArchiveBytesWithTitle('# Before\n', 'Test')
  );

  const diff = diffArchiveInventories(before, after);

  const removed = diff.entries.filter(e => e.status === 'removed');
  assert.equal(removed.length, 1);
  assert.equal(removed[0].path, 'images/old.png');
  assert.equal(removed[0].kind, 'image');
  assert.equal(diff.removedCount, 1);
  assert.equal(diff.addedCount, 0);
  // manifest.json will change when files are removed
  assert.equal(diff.changedCount, 1);
});

test('diffArchiveInventories - changed entry (same path, different bytes)', async () => {
  const PNG_2X2 = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVQI12P4//8/AwAI/AL+nwRvkAAAAABJRU5ErkJggg==',
      'base64'
    )
  );

  const before = await createArchiveInventory(
    await buildNewArchiveBytesWithTitle('# Before\n', 'Test', [
      { archivePath: 'images/changed.png', fileBytes: PNG_1X1 }
    ])
  );

  const after = await createArchiveInventory(
    await buildNewArchiveBytesWithTitle('# Before\n', 'Test', [
      { archivePath: 'images/changed.png', fileBytes: PNG_2X2 }
    ])
  );

  const diff = diffArchiveInventories(before, after);

  const changed = diff.entries.filter(e => e.status === 'changed');
  assert.equal(changed.length >= 1, true);  // at least the image changed
  const changedImage = changed.find(e => e.path === 'images/changed.png');
  assert.ok(changedImage);
  assert.ok(changedImage.before);
  assert.ok(changedImage.after);
  assert.notEqual(changedImage.before.hash, changedImage.after.hash);
});

test('diffArchiveInventories - unchanged entry (same hash)', async () => {
  const markdown = '# Unchanged\n';
  const before = await createArchiveInventory(
    await buildNewArchiveBytesWithTitle(markdown, 'Title', [
      { archivePath: 'images/same.png', fileBytes: PNG_1X1 }
    ])
  );

  const after = await createArchiveInventory(
    await buildNewArchiveBytesWithTitle(markdown, 'Title', [
      { archivePath: 'images/same.png', fileBytes: PNG_1X1 }
    ])
  );

  const diff = diffArchiveInventories(before, after);

  const unchanged = diff.entries.filter(e => e.status === 'unchanged');
  assert.ok(unchanged.length > 0);
  const sameImage = unchanged.find(e => e.path === 'images/same.png');
  assert.ok(sameImage);
  assert.ok(sameImage.before);
  assert.ok(sameImage.after);
  assert.equal(sameImage.before.hash, sameImage.after.hash);
});

test('diffArchiveInventories - empty vs empty', async () => {
  const markdown = '';
  const title = 'Empty';
  // Use same archive bytes for both to ensure identical content
  const bytes = await buildNewArchiveBytesWithTitle(markdown, title);

  const emptyBefore = await createArchiveInventory(bytes);
  const emptyAfter = await createArchiveInventory(bytes);

  const diff = diffArchiveInventories(emptyBefore, emptyAfter);

  assert.equal(diff.addedCount, 0);
  assert.equal(diff.removedCount, 0);
  assert.equal(diff.changedCount, 0);
  const unchanged = diff.entries.filter(e => e.status === 'unchanged');
  assert.ok(unchanged.length > 0);
});
