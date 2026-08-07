import assert from 'node:assert/strict';
import test from 'node:test';

import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';

import { findImageReferenceAtOffset, formatImageEditMarkdown } from '../dist/image-edit.js';

function stateFor(doc) {
  return EditorState.create({ doc, extensions: [markdown()] });
}

test('markdown image: offset inside alt text and inside the path resolve to the same node range', () => {
  const doc = 'Look ![alt text](path/to/img.png "title") and more.';
  const state = stateFor(doc);
  const inAlt = findImageReferenceAtOffset(state, 10); // inside "alt text"
  const inPath = findImageReferenceAtOffset(state, 20); // inside "path/to/img.png"
  assert.ok(inAlt);
  assert.ok(inPath);
  assert.deepEqual(inAlt, inPath);
  assert.equal(inAlt.kind, 'markdown');
  assert.equal(inAlt.src, 'path/to/img.png');
  assert.equal(inAlt.altText, 'alt text');
  assert.equal(inAlt.position, 'inline');
  assert.equal(doc.slice(inAlt.from, inAlt.to), '![alt text](path/to/img.png "title")');
});

test('markdown image: escaped `]` and `\\` in alt text are unescaped', () => {
  const doc = String.raw`![a \] b \\ c](img.png)`;
  const state = stateFor(doc);
  const parsed = findImageReferenceAtOffset(state, 5);
  assert.ok(parsed);
  assert.equal(parsed.altText, 'a ] b \\ c');
});

test('markdown image: offset just outside the Image node returns null', () => {
  const doc = 'x ![alt](img.png) y';
  const state = stateFor(doc);
  assert.equal(findImageReferenceAtOffset(state, 1), null); // the space before "!["
  assert.equal(findImageReferenceAtOffset(state, doc.length - 1), null); // the space after ")"
});

test('reference-style images (no URL child) are out of scope and return null', () => {
  const doc = '![alt][label]\n\n[label]: img.png';
  const state = stateFor(doc);
  assert.equal(findImageReferenceAtOffset(state, 3), null);
});

test('raw HTML <img> with no wrapper: parses src/alt/width/height, position inline', () => {
  const doc = '<img src="a.png" alt="x" width="100" height="50">';
  const state = stateFor(doc);
  const parsed = findImageReferenceAtOffset(state, 5);
  assert.ok(parsed);
  assert.equal(parsed.kind, 'html');
  assert.equal(parsed.src, 'a.png');
  assert.equal(parsed.altText, 'x');
  assert.equal(parsed.width, 100);
  assert.equal(parsed.height, 50);
  assert.equal(parsed.position, 'inline');
  assert.equal(parsed.from, 0);
  assert.equal(parsed.to, doc.length);
});

test('raw HTML <img align="left"> with no <p> wrapper maps to wrap-left', () => {
  const doc = '<img src="a.png" align="left">';
  const state = stateFor(doc);
  const parsed = findImageReferenceAtOffset(state, 5);
  assert.ok(parsed);
  assert.equal(parsed.position, 'wrap-left');
});

test('raw HTML <img align="right"> with no <p> wrapper maps to wrap-right', () => {
  const doc = '<img src="a.png" align="right">';
  const state = stateFor(doc);
  const parsed = findImageReferenceAtOffset(state, 5);
  assert.ok(parsed);
  assert.equal(parsed.position, 'wrap-right');
});

test('<p align="center"><img></p> as a whole block: range is the entire block, position center', () => {
  const doc = '<p align="center"><img src="a.png" alt="x"></p>\n\nSome text.';
  const state = stateFor(doc);
  const parsed = findImageReferenceAtOffset(state, 25);
  assert.ok(parsed);
  assert.equal(parsed.kind, 'html');
  assert.equal(parsed.position, 'center');
  assert.equal(parsed.from, 0);
  assert.equal(parsed.to, '<p align="center"><img src="a.png" alt="x"></p>'.length);
  assert.equal(doc.slice(parsed.from, parsed.to), '<p align="center"><img src="a.png" alt="x"></p>');
});

test('inline <img> mid-paragraph: range is just the tag, position inline', () => {
  const doc = 'Some text <img src="a.png"> more text here.';
  const state = stateFor(doc);
  const parsed = findImageReferenceAtOffset(state, 15);
  assert.ok(parsed);
  assert.equal(parsed.position, 'inline');
  assert.equal(doc.slice(parsed.from, parsed.to), '<img src="a.png">');
});

test('formatImageEditMarkdown round-trips a markdown decision', () => {
  const text = formatImageEditMarkdown('img.png', {
    mode: 'markdown',
    altText: 'a ] b \\ c',
    position: 'inline'
  });
  assert.equal(text, String.raw`![a \] b \\ c](img.png)`);
  const state = stateFor(text);
  const parsed = findImageReferenceAtOffset(state, 2);
  assert.equal(parsed.altText, 'a ] b \\ c');
  assert.equal(parsed.src, 'img.png');
});

test('formatImageEditMarkdown round-trips an html decision with sizing and wrap position', () => {
  const text = formatImageEditMarkdown('a.png', {
    mode: 'html',
    altText: 'x',
    width: 100,
    height: 50,
    position: 'wrap-left'
  });
  assert.equal(text, '<img src="a.png" alt="x" width="100" height="50" align="left">');
  const state = stateFor(text);
  const parsed = findImageReferenceAtOffset(state, 2);
  assert.equal(parsed.width, 100);
  assert.equal(parsed.height, 50);
  assert.equal(parsed.position, 'wrap-left');
});

test('formatImageEditMarkdown round-trips an html decision with a center position (p align wrapper)', () => {
  const text = formatImageEditMarkdown('a.png', {
    mode: 'html',
    altText: 'x',
    position: 'center'
  });
  assert.equal(text, '<p align="center"><img src="a.png" alt="x"></p>');
  const state = stateFor(text);
  const parsed = findImageReferenceAtOffset(state, 2);
  assert.equal(parsed.position, 'center');
  assert.equal(parsed.from, 0);
  assert.equal(parsed.to, text.length);
});
