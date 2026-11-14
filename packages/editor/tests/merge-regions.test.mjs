import assert from 'node:assert/strict';
import test from 'node:test';
import { MergeModel, diffLines, recognize } from '../dist/merge-regions.js';

const BASE = ['# Notes', '', 'One.', '', 'Two.', '', 'Three.', '', 'Four.', ''].join('\n');
// Current changes One and Three; incoming changes Three (differently) and Four.
const OURS = BASE.replace('One.', 'One, current.').replace('Three.', 'Three, current.');
const THEIRS = BASE.replace('Three.', 'Three, incoming.').replace('Four.', 'Four, incoming.');
const MARKED = BASE
  .replace('One.', 'One, current.')
  .replace('Four.', 'Four, incoming.')
  .replace('Three.\n', '<<<<<<< ours:index.md\nThree, current.\n||||||| base:index.md\nThree.\n=======\nThree, incoming.\n>>>>>>> theirs:index.md\n');

test('diffLines finds the replaced runs', () => {
  assert.deepEqual(diffLines(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']), [
    { aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 },
    { aStart: 4, aEnd: 4, bStart: 4, bEnd: 5 }
  ]);
  assert.deepEqual(diffLines(['a'], ['a']), []);
});

test('from the versions: a region per change, located in the merged result', () => {
  const model = MergeModel.fromVersions(MARKED, BASE, OURS, THEIRS);
  assert.ok(model);
  assert.deepEqual(model.regions.map((region) => [region.kind, region.choice]), [
    ['ours', ['ours']],
    ['conflict', 'unresolved'],
    ['theirs', ['theirs']]
  ]);
  const conflict = model.regions[1];
  assert.equal(MARKED.slice(conflict.from, conflict.to).split('\n')[0], '<<<<<<< ours:index.md');
  assert.deepEqual(conflict.oursLines, [6, 7]);
  assert.equal(model.remaining, 1);
  assert.equal(model.markers.ours, 'ours:index.md');
});

test('ticking boxes writes the region; the order ticked is the order kept; unticking all brings the markers back', () => {
  const model = MergeModel.fromVersions(MARKED, BASE, OURS, THEIRS);
  model.apply(model.change(1, model.toggled(1, 'theirs')));
  assert.deepEqual(model.regions[1].choice, ['theirs']);
  assert.ok(model.text.includes('\nThree, incoming.\n\nFour'));
  assert.equal(model.remaining, 0);
  model.apply(model.change(1, model.toggled(1, 'ours')));
  assert.deepEqual(model.regions[1].choice, ['theirs', 'ours']);
  assert.ok(model.text.includes('Three, incoming.\nThree, current.\n'));
  model.apply(model.change(1, model.toggled(1, 'theirs')));
  model.apply(model.change(1, model.toggled(1, 'ours')));
  assert.equal(model.regions[1].choice, 'unresolved');
  assert.equal(model.text, MARKED);
  // A one-sided change unticked goes back to the original.
  model.apply(model.change(0, model.toggled(0, 'ours')));
  assert.deepEqual(model.regions[0].choice, []);
  assert.ok(model.text.startsWith('# Notes\n\nOne.\n'));
  // The other regions moved with the text.
  assert.equal(model.text.slice(model.regions[2].from, model.regions[2].to), 'Four, incoming.\n');
});

test('a result already partly resolved, or edited by hand, reads back as choices', () => {
  const resolved = MARKED.replace(/<<<<<<<[\s\S]*>>>>>>> theirs:index.md\n/, 'Three, current.\n');
  const model = MergeModel.fromVersions(resolved, BASE, OURS, THEIRS);
  assert.deepEqual(model.regions[1].choice, ['ours']);
  model.apply({ from: model.regions[1].from, to: model.regions[1].to, insert: 'Three, both of us.\n' });
  assert.equal(model.regions[1].choice, 'manual');
  assert.equal(recognize(model.regions[1], 'Three.\n'), 'base');
  // Shared text edited: the versions no longer line up.
  assert.equal(MergeModel.fromVersions(MARKED.replace('# Notes', '# Changed'), BASE, OURS, THEIRS), null);
});

test('from markers alone: each block a conflict, the sides built around them', () => {
  const model = MergeModel.fromMarkers(MARKED);
  assert.equal(model.regions.length, 1);
  assert.equal(model.sides.ours, OURS.replace('One.', 'One, current.').replace('Four.', 'Four, incoming.'));
  assert.deepEqual(model.regions[0].theirsLines, [6, 7]);
  model.apply(model.change(0, ['ours', 'theirs']));
  assert.ok(model.text.includes('Three, current.\nThree, incoming.\n'));
  assert.deepEqual(model.regions[0].choice, ['ours', 'theirs']);
});
