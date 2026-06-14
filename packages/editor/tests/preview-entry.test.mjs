import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('preview entry point excludes the CodeMirror-backed workspace view', () => {
  const source = fs.readFileSync(new URL('../dist/preview.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /from ['"]\.\/view\.js['"]/);
  assert.doesNotMatch(source, /codemirror/);
});
