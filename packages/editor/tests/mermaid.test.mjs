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
        // Real mermaid can leave its own error SVG attached to document.body
        // when a diagram fails to parse; simulate that leak here.
        const stray = globalThis.document.createElement('div');
        stray.className = 'mermaid-stray-error';
        globalThis.document.body.appendChild(stray);
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

test('initializes mermaid with suppressErrorRendering to contain failures', async () => {
  const { api, state } = fakeMermaid();
  await new MdzipRenderingService(defaultSafeMarkdownRenderer, [
    mdzipMermaidExtension({ loadMermaid: async () => api })
  ]).renderMarkdown('```mermaid\ngraph TD; A-->B;\n```\n', renderContext());

  assert.equal(state.config.suppressErrorRendering, true);
});

test('sweeps stray body DOM a failed diagram render leaves behind', async () => {
  const { api } = fakeMermaid();
  const bodyChildrenBefore = globalThis.document.body.children.length;

  const html = await new MdzipRenderingService(defaultSafeMarkdownRenderer, [
    mdzipMermaidExtension({ loadMermaid: async () => api })
  ]).renderMarkdown('```mermaid\nBAD SYNTAX\n```\n', renderContext());

  assert.match(html, /class="mdzip-mermaid-error"/);
  assert.equal(
    globalThis.document.body.children.length,
    bodyChildrenBefore,
    'no stray mermaid error DOM should persist on document.body'
  );
  assert.equal(globalThis.document.querySelector('.mermaid-stray-error'), null);
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

test('transformHtml returns synchronously (not a Promise) when a chunk has no mermaid block', () => {
  // Regression for a real, visible per-keystroke flash in mdzip-studio: an
  // earlier version declared transformHtml `async`, so calling it always
  // returned a Promise even on this no-op path. Since every markdown render
  // extension's transformHtml runs on every chunk regardless of content, that
  // forced the *entire* chunk-render pipeline onto a microtask chain for
  // every chunk in every document once mermaid was registered — mermaid or
  // not — widening the window between a reconciled chunk's old DOM coming
  // out and its replacement going back in.
  const extension = mdzipMermaidExtension({ loadMermaid: async () => { throw new Error('must not load'); } });
  const result = extension.transformHtml('<h1>Title</h1><p>No diagrams here.</p>', renderContext());
  assert.equal(typeof result, 'string', 'no-op path returns the html string directly, not a Promise');
  assert.equal(result, '<h1>Title</h1><p>No diagrams here.</p>');
});

test('overlapping renders do not sweep away each other\'s in-progress diagram DOM', async () => {
  // Real mermaid attaches its temp element to document.body a tick *after*
  // render() starts and fails ("Cannot read properties of null (reading
  // 'firstChild')") if that element vanishes mid-render. Two preview renders
  // in flight at once (e.g. adding an image reloads, then edits, the
  // workspace) must not let one's body-cleanup sweep delete the other's.
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const api = {
    initialize() {},
    async render(id, text) {
      await Promise.resolve();
      const element = globalThis.document.createElement('div');
      element.id = `d${id}`;
      globalThis.document.body.appendChild(element);
      await delay(text.includes('SLOW') ? 40 : 5);
      if (!element.isConnected) {
        throw new TypeError("Cannot read properties of null (reading 'firstChild')");
      }
      element.remove();
      return { svg: MERMAID_SVG.replace('viewBox', `id="${id}" viewBox`) };
    }
  };
  const extension = mdzipMermaidExtension({ loadMermaid: async () => api });
  const service = new MdzipRenderingService(defaultSafeMarkdownRenderer, [extension]);

  const [slow, fast] = await Promise.all([
    service.renderMarkdown('```mermaid\ngraph TD; SLOW-->B;\n```\n', renderContext()),
    service.renderMarkdown('```mermaid\ngraph TD; FAST-->B;\n```\n', renderContext())
  ]);

  assert.match(fast, /class="mdzip-mermaid"/);
  assert.match(slow, /class="mdzip-mermaid"/, 'the slower render must survive the faster one finishing first');
  assert.doesNotMatch(slow, /mdzip-mermaid-error/);
});
