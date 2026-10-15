import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// #57: consecutive rules collapsed into one thick band because the preview had no hr style.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = new JSDOM('<!doctype html><html><body></body></html>').window;
}

const { WORKSPACE_CSS } = await import('../dist/view-css.js');
const { defaultSafeMarkdownRenderer } = await import('../dist/index.js');

test('three rule styles render three hr elements', () => {
  const html = defaultSafeMarkdownRenderer.render('Rules:\n\n***\n\n---\n\n___\n');
  assert.equal(html.match(/<hr>/g)?.length, 3);
});

test('the preview gives hr vertical margin and a single themed top border', () => {
  const rule = WORKSPACE_CSS.match(/\.preview-content hr\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /margin:\s*1\.5em 0/);
  assert.match(rule, /border:\s*0/);
  assert.match(rule, /border-top:\s*1px solid var\(--mdzip-border-color\)/);
});
