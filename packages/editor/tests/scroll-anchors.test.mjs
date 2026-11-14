import assert from 'node:assert/strict';
import test from 'node:test';
import { mapScrollPosition, matchSequences } from '../dist/scroll-anchors.js';

const pane = (scrollHeight, clientHeight = 100) => ({ scrollHeight, clientHeight });

test('matchSequences pairs equal items in order, skipping what one side added or removed', () => {
  assert.deepEqual(matchSequences(['H1:Intro', 'H2:Setup', 'H2:Use'], ['H1:Intro', 'H2:New', 'H2:Setup', 'H2:Use']),
    [[0, 0], [1, 2], [2, 3]]);
  assert.deepEqual(matchSequences(['a', 'b'], ['c']), []);
  assert.deepEqual(matchSequences([], ['a']), []);
});

test('mapScrollPosition interpolates between anchors, so content after a taller stretch stays aligned', () => {
  // The target has an extra 300px section between 200 and 400 in the source.
  const anchors = [[200, 200], [400, 700]];
  const source = pane(1000);
  const target = pane(1300);
  assert.equal(mapScrollPosition(100, anchors, source, target), 100, 'before the change: one to one');
  assert.equal(mapScrollPosition(300, anchors, source, target), 450, 'inside it: halfway through the taller stretch');
  assert.equal(mapScrollPosition(500, anchors, source, target), 800, 'after it: the same content, 300px further down');
  assert.equal(mapScrollPosition(900, anchors, source, target), 1200, 'the end goes to the end');
});

test('mapScrollPosition without anchors spreads evenly, ignores anchors that run backwards, and clamps', () => {
  assert.equal(mapScrollPosition(250, [], pane(1000), pane(2000)), 500);
  assert.equal(mapScrollPosition(300, [[200, 600], [250, 100]], pane(1000), pane(1000)), 650);
  assert.equal(mapScrollPosition(50, [], pane(1000), pane(80)), 0, 'a target that fits has nowhere to scroll');
});
