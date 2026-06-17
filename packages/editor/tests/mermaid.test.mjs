import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// DOMPurify and the mermaid extension's template parsing both need a DOM.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = new JSDOM('<!doctype html><html><body></body></html>').window;
  globalThis.document = globalThis.window.document;
  globalThis.HTMLElement = globalThis.window.HTMLElement;
  globalThis.Node = globalThis.window.Node;
}

import { MdzipRenderingService, defaultSafeMarkdownRenderer } from '../dist/index.js';
import { mdzipMermaidExtension } from '../dist/mermaid.js';

const MERMAID_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
  + '<g class="node"><rect style="fill:#fff" width="10" height="10"></rect></g>'
  + '<style>.node{stroke:#000}</style>'
  + '<script>alert(1)</script>'
  + '</svg>';

function fakeMermaid() {
  const state = { theme: null, config: null, calls: 0, sources: [] };
  const api = {
    initialize(config) {
      state.config = config;
      state.theme = config.theme;
    },
    async render(id, text) {
      state.calls += 1;
      state.sources.push(text);
      if (text.includes('BAD')) {
        throw new Error('Parse error on line 1');
      }
      return { svg: MERMAID_SVG.replace('viewBox', `id="${id}" viewBox`) };
    }
  };
  return { api, state };
}

function renderContext(overrides = {}) {
  return {
    currentPath: 'index.md',
    sourceFormat: 'mdz',
    colorScheme: 'light',
    mode: 'editable',
    manifest: null,
    signal: new AbortController().signal,
    ...overrides
  };
}

test('renders a mermaid block to inline SVG that survives sanitization', async () => {
  const { api, state } = fakeMermaid();
  const service = new MdzipRenderingService(defaultSafeMarkdownRenderer, [
    mdzipMermaidExtension({ loadMermaid: async () => api })
  ]);

  const html = await service.renderMarkdown(
    'Intro\n\n```mermaid\ngraph TD; A-->B;\n```\n',
    renderContext({ colorScheme: 'dark' })
  );

  assert.equal(state.calls, 1);
  assert.equal(state.sources[0], 'graph TD; A-->B;', 'decoded diagram source is passed to mermaid');
  assert.equal(state.theme, 'dark', "theme 'auto' follows a dark color scheme");
  assert.equal(state.config.securityLevel, 'strict');
  assert.equal(state.config.htmlLabels, false, 'labels render as sanitizer-safe SVG <text>');
  assert.equal(state.config.flowchart.htmlLabels, false);
  assert.match(html, /class="mdzip-mermaid"/);
  assert.match(html, /<svg/);
  assert.match(html, /<rect[^>]*style="fill:#fff"/, 'inline SVG styles survive');
  assert.match(html, /<style>\.node\{stroke:#000\}<\/style>/, 'the diagram <style> survives');
  assert.doesNotMatch(html, /<script/, 'scripts inside the diagram SVG are stripped');
  assert.match(html, /Intro/, 'surrounding markdown is preserved');
});

test("theme 'auto' selects the default theme under a light scheme; explicit theme wins", async () => {
  const light = fakeMermaid();
  await new MdzipRenderingService(defaultSafeMarkdownRenderer, [
    mdzipMermaidExtension({ loadMermaid: async () => light.api })
  ]).renderMarkdown('```mermaid\ngraph TD; A-->B;\n```\n', renderContext({ colorScheme: 'light' }));
  assert.equal(light.state.theme, 'default');

  const forest = fakeMermaid();
  await new MdzipRenderingService(defaultSafeMarkdownRenderer, [
    mdzipMermaidExtension({ theme: 'forest', loadMermaid: async () => forest.api })
  ]).renderMarkdown('```mermaid\ngraph TD; A-->B;\n```\n', renderContext({ colorScheme: 'dark' }));
  assert.equal(forest.state.theme, 'forest', 'an explicit theme overrides auto');
});

test('an invalid diagram renders an inline error instead of breaking the preview', async () => {
  const { api } = fakeMermaid();
  const html = await new MdzipRenderingService(defaultSafeMarkdownRenderer, [
    mdzipMermaidExtension({ loadMermaid: async () => api })
  ]).renderMarkdown('```mermaid\nBAD SYNTAX\n```\n\nAfter\n', renderContext());

  assert.match(html, /class="mdzip-mermaid-error"/);
  assert.match(html, /Mermaid diagram error: Parse error on line 1/);
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /After/, 'content after a bad diagram still renders');
});

test('non-mermaid content is untouched and mermaid is never loaded', async () => {
  let loaded = false;
  const html = await new MdzipRenderingService(defaultSafeMarkdownRenderer, [
    mdzipMermaidExtension({ loadMermaid: async () => { loaded = true; return fakeMermaid().api; } })
  ]).renderMarkdown('# Title\n\n```js\nconst x = 1;\n```\n', renderContext());

  assert.equal(loaded, false, 'mermaid is not imported when no mermaid block is present');
  assert.match(html, /language-js/, 'regular code blocks keep their language class');
  assert.doesNotMatch(html, /mdzip-mermaid/);
});
