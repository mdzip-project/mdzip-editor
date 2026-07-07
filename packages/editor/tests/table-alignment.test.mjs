import assert from 'node:assert/strict';
import test from 'node:test';

import { WORKSPACE_CSS } from '../dist/view-css.js';

test('honors markdown table alignment via the align attribute', () => {
  assert.match(WORKSPACE_CSS, /td\[align="left"\][^}]*\{[^}]*text-align:\s*left/);
  assert.match(WORKSPACE_CSS, /td\[align="center"\][^}]*\{[^}]*text-align:\s*center/);
  assert.match(WORKSPACE_CSS, /td\[align="right"\][^}]*\{[^}]*text-align:\s*right/);
});

test('right/center-aligned cells hold their line; the table is not forced to max-content width', () => {
  const rightRule = WORKSPACE_CSS.match(/\.preview-content td\[align="right"\]\s*\{([^}]*)\}/)?.[1] ?? '';
  const centerRule = WORKSPACE_CSS.match(/\.preview-content td\[align="center"\]\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(rightRule, /white-space:\s*nowrap/, 'right-aligned numeric cells should not wrap');
  assert.match(centerRule, /white-space:\s*nowrap/, 'center-aligned cells should not wrap');

  const tableRule = WORKSPACE_CSS.match(/\.preview-content table\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.doesNotMatch(
    tableRule,
    /max-content/,
    'the table should not be forced to its unwrapped content width — that is what forced horizontal scroll'
  );
});
