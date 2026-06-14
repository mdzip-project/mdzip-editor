import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { buildNewArchiveBytesWithTitle, updateBinaryInArchive } from '../dist/index.js';
import { MdzipDiffView } from '../dist/diff-view.js';

const window = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  pretendToBeVisual: true
}).window;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.MutationObserver = window.MutationObserver;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

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
