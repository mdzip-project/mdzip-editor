import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { EditorView } from '@codemirror/view';
import {
  buildNewArchiveBytesWithTitle,
  findMergeConflicts,
  readBinaryFileFromArchive,
  readTextFileFromArchive,
  resolveMergeConflict,
  updateBinaryInArchive
} from '../dist/index.js';
import { MdzipMergeView } from '../dist/merge-view.js';

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
let urlCount = 0;
globalThis.URL.createObjectURL = () => `blob:merge-test-${urlCount++}`;
globalThis.URL.revokeObjectURL = () => {};

async function waitFor(predicate) {
  for (let i = 0; i < 200 && !predicate(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const CONFLICTED = [
  '# Notes',
  '',
  '<<<<<<< ours:index.md',
  'Ships in **March**.',
  '||||||| base:index.md',
  'Ships in spring.',
  '=======',
  'Ships on 1 April.',
  '>>>>>>> theirs:index.md',
  '',
  'Middle.',
  '',
  '<<<<<<< ours:index.md',
  'Owner: Kim.',
  '=======',
  'Owner: Lee.',
  '>>>>>>> theirs:index.md',
  ''
].join('\n');

test('findMergeConflicts reads conflict blocks, with and without the base', () => {
  const conflicts = findMergeConflicts(CONFLICTED);
  assert.equal(conflicts.length, 2);
  const [first, second] = conflicts;
  assert.equal(first.line, 3);
  assert.equal(first.ours, 'Ships in **March**.\n');
  assert.equal(first.base, 'Ships in spring.\n');
  assert.equal(first.theirs, 'Ships on 1 April.\n');
  assert.equal(first.oursLabel, 'ours:index.md');
  assert.equal(first.baseLabel, 'base:index.md');
  assert.equal(first.theirsLabel, 'theirs:index.md');
  assert.equal(second.base, null);
  assert.equal(second.ours, 'Owner: Kim.\n');
  assert.equal(CONFLICTED.slice(second.start, second.end).split('\n')[0], '<<<<<<< ours:index.md');
});

test('findMergeConflicts handles longer markers and CRLF, and skips unfinished blocks', () => {
  const crlf = '<<<<<<<<<< HEAD\r\na\r\n==========\r\nb\r\n>>>>>>>>>> topic\r\n';
  const [conflict] = findMergeConflicts(crlf);
  assert.equal(conflict.ours, 'a\r\n');
  assert.equal(conflict.theirs, 'b\r\n');
  assert.equal(conflict.oursLabel, 'HEAD');
  // A seven-character "=======" inside a ten-character block is content, not the separator.
  assert.equal(findMergeConflicts('<<<<<<<<<<\na\n=======\n==========\nb\n>>>>>>>>>>\n')[0].ours, 'a\n=======\n');
  assert.deepEqual(findMergeConflicts('<<<<<<< HEAD\nunfinished\n=======\n'), []);
  assert.deepEqual(findMergeConflicts('Setext heading\n=======\n'), []);
});

test('resolveMergeConflict keeps one side, both, the base or new text', () => {
  const pick = (resolution) => resolveMergeConflict(CONFLICTED, 0, resolution).split('\n').slice(2, 4).join('\n');
  assert.equal(pick('ours'), 'Ships in **March**.\n');
  assert.equal(pick('theirs'), 'Ships on 1 April.\n');
  assert.equal(pick('base'), 'Ships in spring.\n');
  assert.equal(pick('both'), 'Ships in **March**.\nShips on 1 April.');
  assert.equal(pick({ text: 'Ships in late March.\n' }), 'Ships in late March.\n');
  // The other conflict is untouched.
  assert.equal(findMergeConflicts(resolveMergeConflict(CONFLICTED, 0, 'ours')).length, 1);
  assert.throws(() => resolveMergeConflict(CONFLICTED, 5, 'ours'), RangeError);
});

const buttonIn = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent === label);
const editors = (container) => [...container.querySelectorAll('.cm-editor')].map((element) => EditorView.findFromDOM(element));
const boxes = (container, side) => [...container.querySelectorAll(`.mdzip-merge-pane-${side} .mdzip-merge-check`)]
  .filter((box) => box.style.visibility !== 'hidden');
const remainingText = (container) => container.querySelector('.mdzip-merge-remaining').textContent;
// Each pane's height in lines: its lines, the filler and the accept links (20px each).
const paneHeights = (container) => ['theirs', 'ours', 'result'].map((side) => {
  const pane = container.querySelector(`.mdzip-merge-pane-${side}`);
  const lines = pane.querySelectorAll('.cm-content .cm-line').length;
  const filler = [...pane.querySelectorAll('.mdzip-merge-spacer')].reduce((sum, el) => sum + parseFloat(el.style.height) / 20, 0);
  return lines + filler + pane.querySelectorAll('.mdzip-merge-inline-actions').length;
});
const level = (container) => {
  const [incoming, current, result] = paneHeights(container);
  return incoming === current && current === result;
};
const assertLevel = (container, label) => {
  assert.ok(level(container), `${label}: panes ${paneHeights(container).join(', ')} lines high`);
};

test('a plain Markdown document: incoming and current over an editable result, with checkboxes and accept links', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const changes = [];
  let resolved = 0;
  const view = new MdzipMergeView(container, {
    markdown: CONFLICTED,
    fileName: 'C:\\docs\\index.md',
    oursLabel: 'main',
    theirsLabel: 'topic',
    onChange: (event) => changes.push(event),
    onResolved: () => { resolved += 1; }
  });
  try {
    await waitFor(() => container.querySelectorAll('.cm-editor').length === 3 && boxes(container, 'theirs').length === 2);
    assert.equal(container.querySelector('.mdzip-merge-nav').hidden, true, 'one document: no tree');
    assert.equal(container.querySelector('[data-ref="conflict-count"]').textContent, '1 of 2 conflicts');
    assert.equal(container.querySelector('[data-ref="conflict-bar"]'), null, 'source view: the links and boxes do the work');
    // Incoming on the left, current on the right, each with its branch.
    const titles = [...container.querySelectorAll('.mdzip-merge-top .mdzip-merge-pane-names')].map((names) => names.textContent);
    assert.deepEqual(titles, ['Incomingtopic', 'Currentmain']);
    assert.equal(remainingText(container), '2 conflicts remaining');
    const [incoming, current, result] = editors(container);
    // Without the versions, each side comes from the markers.
    assert.equal(current.state.doc.toString(), '# Notes\n\nShips in **March**.\n\nMiddle.\n\nOwner: Kim.\n');
    assert.equal(incoming.state.doc.toString(), '# Notes\n\nShips on 1 April.\n\nMiddle.\n\nOwner: Lee.\n');
    assert.equal(result.state.doc.toString(), CONFLICTED);
    assert.equal(container.querySelectorAll('.mdzip-merge-inline-actions').length, 2);
    assert.deepEqual([...container.querySelector('.mdzip-merge-inline-actions').querySelectorAll('button')].map((b) => b.textContent),
      ['Accept Incoming', 'Accept Current', 'Accept Both', 'Use Original']);
    assert.ok(boxes(container, 'ours').every((box) => !box.checked), 'conflicts start unticked');
    assertLevel(container, 'loaded');
    assert.ok(container.querySelector('.mdzip-merge-aligned'), 'source view lines the panes up');
    assert.equal(result.lineWrapping, false);

    // Accept Incoming on the first conflict, from its inline link.
    buttonIn(container.querySelector('.mdzip-merge-inline-actions'), 'Accept Incoming').click();
    await waitFor(() => changes.length === 1);
    assert.equal(changes[0].path, 'index.md');
    assert.equal(changes[0].remaining, 1);
    assert.ok(changes[0].text.includes('Ships on 1 April.\n\nMiddle.'));
    assert.equal(container.querySelector('[data-ref="conflict-count"]').textContent, '1 of 1 conflict');
    assert.equal(remainingText(container), '1 conflict remaining');
    assert.deepEqual(boxes(container, 'theirs').map((box) => box.checked), [true, false]);

    // Tick both sides of the second: they go in the order ticked.
    boxes(container, 'theirs')[1].click();
    await waitFor(() => changes.length === 2);
    boxes(container, 'ours')[1].click();
    await waitFor(() => changes.length === 3);
    assert.ok(view.getText().endsWith('Owner: Lee.\nOwner: Kim.\n'));
    assert.equal(resolved, 1);
    await waitFor(() => level(container));
    assertLevel(container, 'both ticked');
    // Untick both: the conflict comes back.
    boxes(container, 'theirs')[1].click();
    await waitFor(() => changes.length === 4);
    boxes(container, 'ours')[1].click();
    await waitFor(() => changes.length === 5);
    assert.equal(view.conflictCount, 1);

    // Resolve it by editing the result.
    const doc = result.state.doc.toString();
    const start = doc.indexOf('<<<<<<<');
    const end = doc.indexOf('>>>>>>> theirs:index.md\n') + '>>>>>>> theirs:index.md\n'.length;
    result.dispatch({ changes: { from: start, to: end, insert: 'Owners: Kim and Lee.\n' } });
    await waitFor(() => resolved === 2);
    assert.equal(view.conflictCount, 0);
    assert.equal(view.getText(), '# Notes\n\nShips on 1 April.\n\nMiddle.\n\nOwners: Kim and Lee.\n');
    assert.equal(container.querySelector('[data-ref="conflict-count"]').textContent, 'No conflicts');
    assert.equal(remainingText(container), 'No conflicts remaining');
    assert.ok(boxes(container, 'ours')[1].indeterminate, 'text written by hand');
  } finally {
    view.destroy();
    container.remove();
  }
});

test('Take All per side, next marks the current conflict, and Complete Merge reports what remains', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const changes = [];
  const completed = [];
  const view = new MdzipMergeView(container, {
    markdown: CONFLICTED,
    fileName: 'index.md',
    onChange: (event) => changes.push(event),
    onComplete: (event) => { completed.push(event); }
  });
  try {
    await waitFor(() => container.querySelectorAll('.cm-editor').length === 3 && boxes(container, 'ours').length === 2);
    const complete = container.querySelector('[data-ref="complete"]');
    assert.equal(complete.hidden, false);
    assert.equal(complete.classList.contains('ready'), false);
    assert.equal(view.openNextConflict(), true);
    await waitFor(() => container.querySelector('[data-ref="conflict-count"]').textContent === '2 of 2 conflicts');
    // The current conflict is marked in current.
    await waitFor(() => [...container.querySelectorAll('.mdzip-merge-pane-ours .cm-line.mdzip-merge-line-current')].some((line) => line.textContent === 'Owner: Kim.'));

    const takeAll = (side) => container.querySelector(`.mdzip-merge-pane-${side} .mdzip-merge-take-all input`);
    assert.match(container.querySelector('.mdzip-merge-pane-ours .mdzip-merge-take-all').textContent, /Take All Current/);
    takeAll('ours').click();
    await waitFor(() => changes.length === 1);
    assert.equal(changes[0].remaining, 0);
    assert.ok(changes[0].text.includes('Ships in **March**.') && changes[0].text.includes('Owner: Kim.'));
    assert.equal(takeAll('ours').checked, true);
    assert.equal(complete.classList.contains('ready'), true);
    takeAll('ours').click();
    await waitFor(() => changes.length === 2);
    assert.equal(changes[1].text, CONFLICTED, 'unticked: the markers are back');
    assert.equal(takeAll('ours').checked, false);

    complete.click();
    await waitFor(() => completed.length === 1);
    assert.deepEqual(completed[0], { remaining: 2 });
  } finally {
    view.destroy();
    container.remove();
  }
});

test('an archive with the three versions: a tree with a marker for each file, every change with a checkbox, renames, and the merge\'s own choices', async () => {
  const doc = '# Notes\n\nFirst.\n\nSecond.\n\nThird.\n';
  const png = (fill) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, fill, fill]);
  const make = async (title, files) => {
    let bytes = await buildNewArchiveBytesWithTitle(files['index.md'], title);
    for (const [path, content] of Object.entries(files)) {
      if (path === 'index.md') continue;
      bytes = await updateBinaryInArchive(bytes, path, typeof content === 'string' ? new TextEncoder().encode(content) : content);
    }
    return bytes;
  };
  const oursDoc = doc.replace('First.', 'First, ours.').replace('Second.', 'Second, ours.');
  const theirsDoc = doc.replace('Second.', 'Second, theirs.').replace('Third.', 'Third, theirs.');
  const base = await make('Notes', {
    'index.md': doc, 'notes.md': 'A\nB\nC\nD\n', 'old.md': 'Old text.\n',
    'images/chart.png': png(1), 'images/logo.png': png(9)
  });
  const ours = await make('Our title', {
    'index.md': oursDoc, 'chapters/notes.md': 'A\nB\nC\nD\n', 'old.md': 'Old text, edited.\n',
    'images/chart.png': png(2), 'images/logo.png': png(9)
  });
  const theirs = await make('Their title', {
    'index.md': theirsDoc, 'notes.md': 'A\nB\nC\nD, theirs\n',
    'images/chart.png': png(3), 'images/logo.png': png(9)
  });
  // As `mdz merge` leaves it.
  const result = await make('Our title', {
    'index.md': doc.replace('First.', 'First, ours.').replace('Third.', 'Third, theirs.')
      .replace('Second.\n', '<<<<<<< ours:index.md\nSecond, ours.\n||||||| base:index.md\nSecond.\n=======\nSecond, theirs.\n>>>>>>> theirs:index.md\n'),
    'chapters/notes.md': 'A\nB\nC\nD, theirs\n', 'old.md': 'Old text, edited.\n',
    'images/chart.png': png(2), 'images/chart.theirs.png': png(3), 'images/logo.png': png(9)
  });

  const container = document.createElement('div');
  document.body.append(container);
  const changes = [];
  let resolved = 0;
  const view = new MdzipMergeView(container, {
    bytes: result,
    versions: { base: { bytes: base }, ours: { bytes: ours }, theirs: { bytes: theirs } },
    fileName: 'guide.mdz',
    onChange: (event) => changes.push(event),
    onResolved: () => { resolved += 1; }
  });
  try {
    await waitFor(() => container.querySelectorAll('.mdzip-merge-entry').length > 0 && boxes(container, 'ours').length === 2);
    const state = Object.fromEntries(view.files.map((file) => [file.path, file.state]));
    assert.deepEqual(state, {
      'index.md': 'conflict',
      'chapters/notes.md': 'merged',
      'images/chart.png': 'decision',
      'images/logo.png': 'unchanged',
      'old.md': 'review',
      'manifest.json': 'review'
    });
    const summary = (path) => view.files.find((file) => file.path === path).summary;
    assert.equal(summary('chapters/notes.md'), 'Renamed from notes.md in current; Changed in incoming');
    assert.equal(summary('old.md'), 'Deleted in incoming, changed in current');
    assert.equal(view.selectedFile, 'index.md');
    // The tree hides the unchanged file and marks the rest.
    const rows = [...container.querySelectorAll('.mdzip-merge-entry')];
    assert.deepEqual(rows.map((row) => row.dataset.path).sort(),
      ['chapters/notes.md', 'images/chart.png', 'index.md', 'manifest.json', 'old.md']);
    assert.equal(container.querySelector('[data-path="index.md"] .mdzip-merge-marker').textContent, '●');
    assert.equal(container.querySelector('[data-path="images/chart.png"] .mdzip-merge-marker').textContent, '◐');
    assert.equal(container.querySelector('[data-path="old.md"] .mdzip-merge-marker').textContent, '↺');
    assert.equal(container.querySelector('[data-path="chapters/notes.md"] .mdzip-merge-marker').textContent, '✓');
    assert.equal(view.conflictCount, 2, 'the text conflict and the image');
    // Current shows the whole file, each change marked; the one-sided changes are ticked, the conflict isn't.
    const [, current] = editors(container);
    assert.equal(current.state.doc.toString(), oursDoc);
    assert.deepEqual([...container.querySelectorAll('.mdzip-merge-pane-ours .cm-line.mdzip-merge-line-ours')].map((l) => l.textContent),
      ['First, ours.', 'Second, ours.']);
    assert.deepEqual(boxes(container, 'ours').map((box) => box.checked), [true, false]);
    assert.deepEqual(boxes(container, 'theirs').map((box) => box.checked), [false, true]);
    assertLevel(container, 'archive document');
    // Untick current's first change: the result goes back to the original there.
    boxes(container, 'ours')[0].click();
    await waitFor(() => changes.length === 1);
    assert.ok(changes[0].text.startsWith('# Notes\n\nFirst.\n'));
    await waitFor(() => level(container));
    assertLevel(container, 'a change unticked');
    await view.chooseChange('index.md', 0, ['ours']);
    assert.ok(view.getText('index.md').startsWith('# Notes\n\nFirst, ours.\n'));

    // The image: take incoming; the copy goes.
    await view.selectFile('images/chart.png');
    assert.equal(container.querySelectorAll('.mdzip-merge-image').length, 3, 'incoming, current and the original');
    const before = changes.length;
    buttonIn(container, 'Take Incoming').click();
    await waitFor(() => changes.length === before + 1);
    let bytes = view.getArchiveBytes();
    assert.deepEqual([...await readBinaryFileFromArchive(bytes, 'images/chart.png')], [...png(3)]);
    await assert.rejects(() => readBinaryFileFromArchive(bytes, 'images/chart.theirs.png'));
    assert.equal(changes.at(-1).remaining, 1);

    // The file incoming deleted: delete it after all.
    await view.selectFile('old.md');
    assert.match(container.querySelector('.mdzip-merge-review').textContent, /Incoming deleted this file and current changed it/);
    await view.resolveFile('old.md', 'delete');
    await assert.rejects(() => readTextFileFromArchive(view.getArchiveBytes(), 'old.md'));
    assert.equal(view.files.find((file) => file.path === 'old.md').inResult, false);

    // The manifest title both changed: take incoming.
    await view.selectFile('manifest.json');
    assert.match(container.querySelector('.mdzip-merge-field-table').textContent, /IncomingCurrent.*titleTheir titleOur title/);
    buttonIn(container, 'Take Incoming').click();
    await waitFor(() => changes.at(-1).path === 'manifest.json');
    const manifest = JSON.parse(await readTextFileFromArchive(view.getArchiveBytes(), 'manifest.json'));
    assert.equal(manifest.title, 'Their title');

    // The last text conflict, while another file is shown.
    await view.resolve(0, 'both');
    await waitFor(() => resolved === 1);
    bytes = view.getArchiveBytes();
    const text = await readTextFileFromArchive(bytes, 'index.md');
    assert.equal(findMergeConflicts(text).length, 0);
    assert.ok(text.includes('Second, ours.\nSecond, theirs.\n'));
    assert.ok(text.includes('Third, theirs.'));
    assert.equal(changes.at(-1).remaining, 0);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('rendered: both sides render as the preview, the bar accepts the current conflict, and the result marks where conflicts remain', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const changes = [];
  const view = new MdzipMergeView(container, { markdown: CONFLICTED, fileName: 'index.md', rendered: true, onChange: (event) => changes.push(event) });
  try {
    await waitFor(() => container.querySelectorAll('.mdzip-diff-preview').length === 3);
    assert.equal(container.querySelectorAll('.cm-editor').length, 0);
    assert.equal(container.querySelector('.mdzip-merge-pane-ours .mdzip-diff-preview strong')?.textContent, 'March');
    const result = container.querySelector('.mdzip-merge-result-preview');
    assert.ok(result.querySelector('.mdzip-diff-block-added'), 'unresolved blocks are marked');
    assert.match(container.querySelector('.mdzip-merge-pane-result').textContent, /Unresolved conflicts show the current version/);
    assert.match(container.querySelector('[data-ref="conflict-bar"]').textContent, /Conflict 1 of 2 in this file · line 3/);
    buttonIn(container.querySelector('[data-ref="conflict-bar"]'), 'Use Original').click();
    await waitFor(() => changes.length === 1);
    assert.ok(changes[0].text.includes('Ships in spring.'));
    await waitFor(() => /Conflict 1 of 1/.test(container.querySelector('[data-ref="conflict-bar"]')?.textContent ?? ''));
    await view.setRendered(false);
    assert.equal(container.querySelectorAll('.cm-editor').length, 3);
  } finally {
    view.destroy();
    container.remove();
  }
});
