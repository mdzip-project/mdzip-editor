import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MDZIP_DARK_THEME_CSS,
  MDZIP_LIGHT_THEME_CSS,
  MDZIP_VARIABLES_CSS
} from '../dist/index.js';

const THEME_TOKENS = [
  'editor-background-color',
  'editor-foreground-color',
  'editor-cursor-color',
  'toolbar-background-color',
  'toolbar-icon-fill-color',
  'sidebar-background-color',
  'sidebar-foreground-color',
  'border-color',
  'widget-background-color',
  'widget-border-color',
  'accent-color',
  'accent-foreground-color',
  'control-foreground-color',
  'control-hover-background-color',
  'link-color',
  'hover-background-color',
  'selection-background-color',
  'focus-outline-color',
  'tree-guide-color',
  'muted-foreground-color',
  'code-background-color',
  'line-number-foreground-color'
];

test('maps consumer theme tokens before built-in defaults', () => {
  for (const token of THEME_TOKENS) {
    const declaration = MDZIP_VARIABLES_CSS
      .split('\n')
      .find((line) => line.includes(`--mdzip-${token}:`));

    assert.ok(declaration, `missing --mdzip-${token} mapping`);
    assert.ok(
      declaration.indexOf(`var(--theme-${token}`) < declaration.indexOf(`var(--mdzip-default-${token}`),
      `--theme-${token} must precede its built-in default`
    );
  }
});

test('keeps exported light and dark theme constants consumer-facing', () => {
  assert.match(MDZIP_LIGHT_THEME_CSS, /--theme-editor-background-color:\s*#ffffff/);
  assert.match(MDZIP_DARK_THEME_CSS, /--theme-editor-background-color:\s*#1e1e1e/);
  assert.doesNotMatch(MDZIP_LIGHT_THEME_CSS, /--mdzip-default-/);
  assert.doesNotMatch(MDZIP_DARK_THEME_CSS, /--mdzip-default-/);
});
