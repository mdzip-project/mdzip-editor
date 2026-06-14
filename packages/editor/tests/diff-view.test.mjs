import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { buildNewArchiveBytesWithTitle, updateBinaryInArchive } from '../dist/index.js';
import { MdzipDiffView } from '../dist/diff-view.js';

const PNG_1X1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
));

const window = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  pretendToBeVisual: true
}).window;
globalThis.window = window;
globalThis.Window = window.Window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.MutationObserver = window.MutationObserver;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
const createdUrls = [];
const revokedUrls = [];
globalThis.URL.createObjectURL = (blob) => {
  const url = `blob:test-${createdUrls.length}`;
  createdUrls.push({ url, blob });
  return url;
};
globalThis.URL.revokeObjectURL = (url) => revokedUrls.push(url);

async function comparisonBytes() {
  let before = await buildNewArchiveBytesWithTitle('# Before\n', 'Diff');
  before = await updateBinaryInArchive(
    before,
    'removed.txt',
    new TextEncoder().encode('removed')
  );
  let after = await buildNewArchiveBytesWithTitle('# After\n', 'Diff');
  after = await updateBinaryInArchive(
    after,
    'added.txt',
    new TextEncoder().encode('added')
  );
  return { before, after };
}

async function withEntries(markdown, entries) {
  let bytes = await buildNewArchiveBytesWithTitle(markdown, 'Diff');
  for (const [path, value] of entries) {
    bytes = await updateBinaryInArchive(
      bytes,
      path,
      typeof value === 'string' ? new TextEncoder().encode(value) : value
    );
  }
  return bytes;
}

test('diff view renders union statuses and a read-only text merge', async () => {
  const { before, after } = await comparisonBytes();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const selections = [];
  const options = {
    before: { bytes: before, label: 'Base' },
    after: { bytes: after, label: 'Working' },
    initialPath: 'index.md',
    onSelectionChanged: (event) => selections.push(event.path)
  };
  const view = new MdzipDiffView(container, options);

  try {
    await view.open(options);
    const labels = [...container.querySelectorAll('.mdzip-diff-entry')]
      .map((element) => element.getAttribute('aria-label'));
    assert.ok(labels.includes('added.txt, added'));
    assert.ok(labels.includes('removed.txt, removed'));
    assert.ok(labels.includes('index.md, changed'));
    assert.equal(container.querySelectorAll('.cm-editor').length, 2);
    assert.equal(container.querySelectorAll('[contenteditable="true"]').length, 0);
    assert.equal(selections.at(-1), 'index.md');

    view.setShowUnchanged(false);
    assert.equal(
      [...container.querySelectorAll('.mdzip-diff-entry')]
        .some((element) => element.classList.contains('unchanged')),
      false
    );
  } finally {
    view.destroy();
    container.remove();
  }
  assert.equal(container.childNodes.length, 0);
});

test('diff view classifies every usable entry when the other side is missing', async () => {
  const { after } = await comparisonBytes();
  const container = document.createElement('div');
  const options = {
    before: { label: 'Missing base' },
    after: { bytes: after, label: 'Working' },
    initialPath: 'added.txt'
  };
  const view = new MdzipDiffView(container, options);

  try {
    await view.open(options);
    const labels = [...container.querySelectorAll('.mdzip-diff-entry')]
      .map((element) => element.getAttribute('aria-label') ?? '');
    assert.ok(labels.length > 0);
    assert.ok(labels.every((label) => label.endsWith(', added')));
    assert.match(container.querySelector('.mdzip-diff-heading').textContent, /Missing base/);
  } finally {
    view.destroy();
  }
});

test('constructor auto-opens and an immediate open call is deduplicated', async () => {
  const { before, after } = await comparisonBytes();
  const container = document.createElement('div');
  const selections = [];
  const options = {
    before: { bytes: before },
    after: { bytes: after },
    onSelectionChanged: (event) => selections.push(event.path)
  };
  const view = new MdzipDiffView(container, options);
  await view.open(options);
  assert.equal(selections.length, 1);
  assert.doesNotMatch(container.textContent, /Loading comparison/);
  view.destroy();
});

test('one-sided text shows an explicit missing pane', async () => {
  const before = await withEntries('# Same\n', []);
  const after = await withEntries('# Same\n', [['docs/added.txt', 'new text']]);
  const container = document.createElement('div');
  const options = {
    before: { bytes: before, label: 'Base' },
    after: { bytes: after, label: 'Working' },
    initialPath: 'docs/added.txt'
  };
  const view = new MdzipDiffView(container, options);
  try {
    await view.open(options);
    assert.equal(container.querySelectorAll('.mdzip-diff-side').length, 2);
    assert.match(container.querySelector('.mdzip-diff-missing').textContent, /does not exist/);
    assert.equal(container.querySelectorAll('.cm-editor').length, 1);
    assert.ok(container.querySelector('.mdzip-diff-directory'));
    assert.equal(
      container.querySelector('[aria-label="docs/added.txt, added"]').getAttribute('aria-level'),
      '2'
    );
  } finally {
    view.destroy();
  }
});

test('image and binary selections render metadata and release object URLs', async () => {
  createdUrls.length = 0;
  revokedUrls.length = 0;
  const before = await withEntries('# Same\n', [
    ['images/logo.png', PNG_1X1],
    ['assets/data.bin', Uint8Array.from([0, 255, 1])]
  ]);
  const after = await withEntries('# Same\n', [
    ['images/logo.png', Uint8Array.from(PNG_1X1, (value, index) => index === 40 ? value ^ 1 : value)],
    ['assets/data.bin', Uint8Array.from([0, 254, 2])]
  ]);
  const container = document.createElement('div');
  const options = { before: { bytes: before }, after: { bytes: after } };
  const view = new MdzipDiffView(container, options);
  try {
    await view.open(options);
    await view.openPath('images/logo.png');
    assert.equal(createdUrls.length, 2);
    assert.match(container.textContent, /image\/png/);
    assert.match(container.textContent, /SHA-256/);

    await view.openPath('assets/data.bin');
    assert.deepEqual(revokedUrls, ['blob:test-0', 'blob:test-1']);
    assert.match(container.textContent, /application\/octet-stream/);
    assert.match(container.textContent, /3 bytes/);
  } finally {
    view.destroy();
  }
});

test('invalid side does not prevent navigation of the usable side', async () => {
  const after = await withEntries('# Usable\n', [['docs/file.txt', 'usable']]);
  const container = document.createElement('div');
  const options = {
    before: { bytes: Uint8Array.from([1, 2, 3]), label: 'Broken' },
    after: { bytes: after, label: 'Working' },
    initialPath: 'docs/file.txt'
  };
  const view = new MdzipDiffView(container, options);
  try {
    await view.open(options);
    assert.ok(container.querySelector('[aria-label="docs/file.txt, added"]'));
    assert.match(container.querySelector('.mdzip-diff-heading').textContent, /Broken/);
    assert.equal(container.querySelectorAll('.cm-editor').length, 1);
  } finally {
    view.destroy();
  }
});

test('rapid selection keeps the latest content and event', async () => {
  const before = await withEntries('# Same\n', [
    ['slow.txt', 'before slow'],
    ['fast.txt', 'before fast']
  ]);
  const after = await withEntries('# Same\n', [
    ['slow.txt', 'after slow'],
    ['fast.txt', 'after fast']
  ]);
  const selections = [];
  const container = document.createElement('div');
  const options = {
    before: { bytes: before },
    after: { bytes: after },
    onSelectionChanged: (event) => selections.push(event.path)
  };
  const view = new MdzipDiffView(container, options);
  try {
    await view.open(options);
    const originalBeforeRead = view.before.archive.readBytes.bind(view.before.archive);
    const originalAfterRead = view.after.archive.readBytes.bind(view.after.archive);
    view.before.archive.readBytes = async (path) => {
      if (path === 'slow.txt') await new Promise((resolve) => setTimeout(resolve, 30));
      return originalBeforeRead(path);
    };
    view.after.archive.readBytes = async (path) => {
      if (path === 'slow.txt') await new Promise((resolve) => setTimeout(resolve, 30));
      return originalAfterRead(path);
    };

    const slow = view.openPath('slow.txt');
    const fast = view.openPath('fast.txt');
    await Promise.all([slow, fast]);
    assert.match(container.querySelector('.mdzip-diff-heading').textContent, /fast\.txt/);
    assert.equal(selections.at(-1), 'fast.txt');
  } finally {
    view.destroy();
  }
});

test('keyboard navigation moves focus through visible entries', async () => {
  const { before, after } = await comparisonBytes();
  const container = document.createElement('div');
  document.body.append(container);
  const options = { before: { bytes: before }, after: { bytes: after } };
  const view = new MdzipDiffView(container, options);
  try {
    await view.open(options);
    const entries = [...container.querySelectorAll('.mdzip-diff-entry')];
    entries[0].focus();
    entries[0].dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true
    }));
    assert.equal(document.activeElement, entries[1]);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('diff toolbar toggles navigation and runs typed host actions', async () => {
  const { before, after } = await comparisonBytes();
  const container = document.createElement('div');
  let finishRefresh;
  let refreshes = 0;
  const options = {
    before: { bytes: before },
    after: { bytes: after },
    toolbarActions: [{
      id: 'refresh',
      label: 'Refresh comparison',
      icon: 'refresh',
      run: () => {
        refreshes += 1;
        return new Promise((resolve) => { finishRefresh = resolve; });
      }
    }]
  };
  const view = new MdzipDiffView(container, options);
  try {
    await view.open(options);
    const navButton = container.querySelector('[data-ref="navigation"]');
    assert.equal(navButton.getAttribute('aria-pressed'), 'true');
    navButton.click();
    assert.equal(navButton.getAttribute('aria-pressed'), 'false');
    assert.equal(container.querySelector('.mdzip-diff-nav').hidden, true);

    const refreshButton = container.querySelector('[aria-label="Refresh comparison"]');
    refreshButton.click();
    await Promise.resolve();
    assert.equal(refreshes, 1);
    assert.equal(container.querySelector('[aria-label="Refresh comparison"]').disabled, true);
    finishRefresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(container.querySelector('[aria-label="Refresh comparison"]').disabled, false);
  } finally {
    view.destroy();
  }
});

test('many entries open and filter without decoding selected content eagerly', async () => {
  const entries = Array.from({ length: 150 }, (_, index) => [
    `docs/file-${String(index).padStart(3, '0')}.txt`,
    `entry ${index}`
  ]);
  const before = await withEntries('# Before\n', entries);
  const after = await withEntries('# After\n', entries);
  const container = document.createElement('div');
  const options = { before: { bytes: before }, after: { bytes: after }, showUnchanged: false };
  const view = new MdzipDiffView(container, options);
  const started = performance.now();
  try {
    await view.open(options);
    assert.ok(performance.now() - started < 3000);
    assert.ok(container.querySelectorAll('.mdzip-diff-entry').length >= 1);
  } finally {
    view.destroy();
  }
});
