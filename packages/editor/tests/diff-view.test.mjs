import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { buildNewArchiveBytesWithTitle, updateBinaryInArchive } from '../dist/index.js';
import { MdzipDiffView } from '../dist/diff-view.js';
import { markBlockChanges, resolveArchivePath } from '../dist/diff-rendered.js';

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
    // The nav pane collapses via an animatable class, not the hidden attribute.
    assert.equal(container.querySelector('.mdzip-diff-nav').classList.contains('hidden'), true);

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

test('change traversal walks non-unchanged entries and disables at the ends', async () => {
  // Identical entry point so index.md stays unchanged; a.md changed, b.md
  // unchanged, c.md added. (index.md sorts after these; a.md is the first
  // change overall.)
  const before = await withEntries('# Same\n', [
    ['a.md', 'one'],
    ['b.md', 'same']
  ]);
  const after = await withEntries('# Same\n', [
    ['a.md', 'one changed'],
    ['b.md', 'same'],
    ['c.md', 'new file']
  ]);
  const container = document.createElement('div');
  const options = { before: { bytes: before }, after: { bytes: after }, initialPath: 'a.md' };
  const view = new MdzipDiffView(container, options);
  const activePath = () =>
    container.querySelector('.mdzip-diff-entry.active .mdzip-diff-path')?.textContent;
  try {
    await view.open(options);
    const prev = container.querySelector('[data-ref="prev-change"]');
    const next = container.querySelector('[data-ref="next-change"]');

    // a.md is the first change: prev disabled, next enabled.
    assert.equal(activePath(), 'a.md');
    assert.equal(prev.disabled, true);
    assert.equal(next.disabled, false);

    // Next skips the unchanged b.md and lands on c.md.
    assert.equal(await view.openNextChange(), true);
    assert.equal(activePath(), 'c.md');
    assert.equal(prev.disabled, false);

    // Previous walks back to a.md, skipping b.md again.
    assert.equal(await view.openPreviousChange(), true);
    assert.equal(activePath(), 'a.md');

    // Walking forward to the final change disables next and refuses to advance.
    while (await view.openNextChange()) { /* advance to the last change */ }
    assert.equal(next.disabled, true);
    assert.equal(await view.openNextChange(), false);
  } finally {
    view.destroy();
  }
});

test('show-unchanged toolbar toggle reflects and drives filtering', async () => {
  const before = await withEntries('# Before\n', [['a.md', 'one'], ['b.md', 'same']]);
  const after = await withEntries('# After\n', [['a.md', 'one changed'], ['b.md', 'same']]);
  const container = document.createElement('div');
  const options = { before: { bytes: before }, after: { bytes: after }, showUnchanged: true, controls: { showUnchanged: true } };
  const view = new MdzipDiffView(container, options);
  try {
    await view.open(options);
    const toggle = container.querySelector('[data-ref="show-unchanged"]');
    assert.equal(toggle.hidden, false);
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    const pathsWhenShown = [...container.querySelectorAll('.mdzip-diff-entry .mdzip-diff-path')]
      .map((node) => node.textContent);
    assert.ok(pathsWhenShown.includes('b.md'), 'unchanged entry visible when shown');

    toggle.click();
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');
    const pathsWhenHidden = [...container.querySelectorAll('.mdzip-diff-entry .mdzip-diff-path')]
      .map((node) => node.textContent);
    assert.equal(pathsWhenHidden.includes('b.md'), false, 'unchanged entry hidden after toggle');
  } finally {
    view.destroy();
  }
});

test('controls option hides the built-in toolbar controls it disables', async () => {
  const { before, after } = await comparisonBytes();
  const container = document.createElement('div');
  const options = {
    before: { bytes: before },
    after: { bytes: after },
    controls: { changeTraversal: false, showUnchanged: false }
  };
  const view = new MdzipDiffView(container, options);
  try {
    await view.open(options);
    assert.equal(container.querySelector('[data-ref="prev-change"]').hidden, true);
    assert.equal(container.querySelector('[data-ref="next-change"]').hidden, true);
    assert.equal(container.querySelector('[data-ref="show-unchanged"]').hidden, true);
    assert.equal(container.querySelector('[data-ref="navigation"]').hidden, false);
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

test('text diff gutters take the host colors, not CodeMirror\'s light default (#60)', async () => {
  const before = await buildNewArchiveBytesWithTitle('# Notes\n\nOne\nTwo\n', 'Diff');
  const after = await buildNewArchiveBytesWithTitle('# Notes\n\nOne\nTwo changed\n', 'Diff');
  const container = document.createElement('div');
  container.style.setProperty('--mdzip-border-color', 'rgb(60, 60, 60)');
  container.style.setProperty('--mdzip-muted-foreground-color', 'rgb(139, 139, 139)');
  document.body.appendChild(container);
  const options = { before: { bytes: before, label: 'Base' }, after: { bytes: after, label: 'Working' }, initialPath: 'index.md' };
  const view = new MdzipDiffView(container, options);
  try {
    await view.open(options);
    let gutters = [];
    for (let i = 0; i < 100 && gutters.length < 2; i += 1) {
      gutters = [...container.querySelectorAll('.mdzip-diff-body .cm-gutters')];
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(gutters.length, 2, 'both sides have a line-number gutter');
    for (const gutter of gutters) {
      const style = window.getComputedStyle(gutter);
      assert.notEqual(style.backgroundColor, 'rgb(245, 245, 245)', 'CodeMirror\'s light #f5f5f5 gutter background is overridden');
      assert.match(style.backgroundColor, /^(transparent|rgba\(0, 0, 0, 0\))$/);
    }
  } finally {
    view.destroy();
    container.remove();
  }
});

test('rendered toggle shows both sides as the preview, with differing blocks marked', async () => {
  createdUrls.length = 0;
  const changedPng = Uint8Array.from(PNG_1X1, (value, index) => index === 40 ? value ^ 1 : value);
  const before = await withEntries(
    '---\ntitle: Notes\n---\n\n# Notes\n\nSame paragraph.\n\nOld wording.\n\n<img src="images/logo.png" alt="Logo" width="40" align="right">\n\n![Chart](./images/chart.png)\n',
    [['images/logo.png', PNG_1X1], ['images/chart.png', PNG_1X1], ['data.txt', 'plain']]
  );
  const after = await withEntries(
    '---\ntitle: Notes\n---\n\n# Notes\n\nSame paragraph.\n\nNew wording.\n\n<img src="images/logo.png" alt="Logo" width="40" align="right">\n\n![Chart](./images/chart.png)\n\nAdded at the end.\n',
    [['images/logo.png', PNG_1X1], ['images/chart.png', changedPng], ['data.txt', 'plain changed']]
  );
  const container = document.createElement('div');
  document.body.append(container);
  const toggles = [];
  const options = {
    before: { bytes: before, label: 'HEAD' },
    after: { bytes: after, label: 'Working Tree' },
    initialPath: 'index.md',
    onRenderedChanged: (value) => toggles.push(value)
  };
  const view = new MdzipDiffView(container, options);
  try {
    await view.open(options);
    // Off by default; the navigation list shows unchanged entries, dimmed.
    assert.equal(container.querySelector('[data-ref="show-unchanged"]').hidden, true);
    const button = container.querySelector('[data-ref="rendered"]');
    const source = container.querySelector('[data-ref="source"]');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(source.getAttribute('aria-pressed'), 'true');
    assert.equal(container.querySelectorAll('.cm-editor').length, 2);

    button.click();
    for (let i = 0; i < 100 && !container.querySelector('.mdzip-diff-preview'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(toggles, [true]);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(source.getAttribute('aria-pressed'), 'false');
    button.click();
    assert.deepEqual(toggles, [true], 'pressing the pressed mode again changes nothing');
    assert.equal(container.querySelectorAll('.cm-editor').length, 0);
    const [left, right] = [...container.querySelectorAll('.mdzip-root .preview-content.mdzip-diff-preview')];
    assert.ok(left && right, 'both sides render inside the preview scope');
    assert.ok(document.querySelector('style[data-mdzip-ws-styles]'), 'preview styles injected');

    // Front matter doesn't show up as body text.
    assert.doesNotMatch(right.textContent, /title: Notes/);

    const marked = (root, cls) => [...root.children]
      .filter((child) => child.classList.contains(cls))
      .map((child) => child.textContent.trim() || child.querySelector('img')?.getAttribute('alt'));
    assert.deepEqual(marked(left, 'mdzip-diff-block-removed'), ['Old wording.', 'Chart']);
    assert.deepEqual(marked(right, 'mdzip-diff-block-added'), ['New wording.', 'Chart', 'Added at the end.']);
    assert.equal(left.querySelector('h1').classList.length, 0, 'unchanged heading is not marked');

    // Archive images load from the archive; raw HTML alignment matches the preview.
    const logo = right.querySelector('img[alt="Logo"]');
    assert.match(logo.getAttribute('src'), /^blob:test-/);
    assert.ok(logo.classList.contains('mdzip-image-right'));
    assert.equal(logo.style.width, '40px');
    assert.match(right.querySelector('img[alt="Chart"]').getAttribute('src'), /^blob:test-/);

    // Not Markdown: the toggle is disabled, and the entry shows as text.
    await view.openPath('data.txt');
    assert.equal(button.disabled, true);
    assert.equal(source.disabled, true);
    assert.equal(container.querySelectorAll('.cm-editor').length, 2);

    await view.openPath('index.md');
    assert.equal(button.disabled, false);
    assert.ok(container.querySelector('.mdzip-diff-preview'));

    source.click();
    for (let i = 0; i < 100 && container.querySelectorAll('.cm-editor').length < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(toggles, [true, false]);
    assert.equal(source.getAttribute('aria-pressed'), 'true');
    assert.equal(container.querySelectorAll('.cm-editor').length, 2);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('rendered option opens Markdown rendered, and a one-sided document shows a missing pane', async () => {
  const before = await withEntries('# Same\n', []);
  const after = await withEntries('# Same\n', [['docs/new.md', '# New page\n\n![Pic](../images/pic.png)\n'], ['images/pic.png', PNG_1X1]]);
  const container = document.createElement('div');
  const options = { before: { bytes: before }, after: { bytes: after }, initialPath: 'docs/new.md', rendered: true, colorScheme: 'dark' };
  const view = new MdzipDiffView(container, options);
  try {
    await view.open(options);
    assert.equal(view.isRendered, true);
    assert.match(container.querySelector('.mdzip-diff-missing').textContent, /does not exist/);
    const scope = container.querySelector('.mdzip-diff-preview-scope');
    assert.ok(scope.classList.contains('mdzip-theme-dark'));
    assert.match(scope.querySelector('img[alt="Pic"]').getAttribute('src'), /^blob:test-/, 'path resolves from the document folder');
  } finally {
    view.destroy();
  }
});

test('markBlockChanges matches blocks across insertions and returns matched pairs in order', () => {
  const make = (items) => {
    const root = document.createElement('article');
    for (const [tag, text] of items) {
      const element = document.createElement(tag);
      element.textContent = text;
      root.append(element);
    }
    return root;
  };
  const before = make([['h1', 'Title'], ['p', 'A'], ['p', 'B'], ['p', 'C'], ['p', 'End']]);
  const after = make([['h1', 'Title'], ['p', 'A'], ['p', 'Inserted'], ['p', 'C'], ['p', 'End']]);
  const pairs = markBlockChanges(before, after);
  assert.deepEqual(pairs.map(([left, right]) => [left.textContent, right.textContent]),
    [['Title', 'Title'], ['A', 'A'], ['C', 'C'], ['End', 'End']]);
  assert.deepEqual([...before.querySelectorAll('.mdzip-diff-block-removed')].map((e) => e.textContent), ['B']);
  assert.deepEqual([...after.querySelectorAll('.mdzip-diff-block-added')].map((e) => e.textContent), ['Inserted']);

  // Same text in a different element type counts as a change.
  const headingBefore = make([['p', 'Heading']]);
  const headingAfter = make([['h2', 'Heading']]);
  markBlockChanges(headingBefore, headingAfter);
  assert.equal(headingAfter.firstElementChild.classList.contains('mdzip-diff-block-added'), true);
});

test('resolveArchivePath resolves against the document folder and refuses to leave the archive', () => {
  assert.equal(resolveArchivePath('index.md', 'images/a.png'), 'images/a.png');
  assert.equal(resolveArchivePath('index.md', './images/a.png'), 'images/a.png');
  assert.equal(resolveArchivePath('docs/page.md', '../images/a%20b.png'), 'images/a b.png');
  assert.equal(resolveArchivePath('docs/page.md', '/images/a.png?x=1#y'), 'images/a.png');
  assert.equal(resolveArchivePath('index.md', '../outside.png'), null);
});
