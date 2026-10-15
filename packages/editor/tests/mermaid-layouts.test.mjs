import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Per-diagram-type default layouts for mermaid, e.g. ELK for ER diagrams (#52).
if (typeof globalThis.window === 'undefined') {
  globalThis.window = new JSDOM('<!doctype html><html><body></body></html>').window;
  globalThis.document = globalThis.window.document;
  globalThis.HTMLElement = globalThis.window.HTMLElement;
  globalThis.Node = globalThis.window.Node;
}

const { MdzipRenderingService, defaultSafeMarkdownRenderer } = await import('../dist/index.js');
const { mdzipMermaidExtension, mermaidDeclaresLayout, mermaidDiagramType } = await import('../dist/mermaid.js');

/** Records the config each render ran with and every layout registration. */
function fakeMermaid() {
  const state = { renders: [], registered: [] };
  let config = {};
  const api = {
    initialize(next) {
      config = next;
    },
    async render(id, text) {
      state.renders.push({ text, layout: config.layout });
      return { svg: `<svg xmlns="http://www.w3.org/2000/svg" id="${id}"><g></g></svg>` };
    },
    registerLayoutLoaders(loaders) {
      state.registered.push(loaders);
    }
  };
  return { api, state };
}

const context = () => ({
  currentPath: 'index.md',
  sourceFormat: 'mdz',
  colorScheme: 'light',
  mode: 'editable',
  manifest: null,
  signal: new AbortController().signal
});

const ER = 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n';
const ER_DAGRE = '---\nconfig:\n  layout: dagre\n---\nerDiagram\n  CUSTOMER ||--o{ ORDER : places\n';
const ER_INIT = '%%{init: {"layout": "dagre"}}%%\nerDiagram\n  A ||--o{ B : has\n';
const FLOW = 'flowchart LR\n  A --> B\n';
const fence = (source) => '```mermaid\n' + source + '```\n';

async function renderAll(extensionOptions, ...diagrams) {
  const { api, state } = fakeMermaid();
  const service = new MdzipRenderingService(defaultSafeMarkdownRenderer, [
    mdzipMermaidExtension({ loadMermaid: async () => api, ...extensionOptions })
  ]);
  await service.renderMarkdown(diagrams.map(fence).join('\n'), context());
  return state;
}

test('diagram type and declared-layout detection', () => {
  assert.equal(mermaidDiagramType(ER), 'erDiagram');
  assert.equal(mermaidDiagramType(ER_DAGRE), 'erDiagram');
  assert.equal(mermaidDiagramType(ER_INIT), 'erDiagram');
  assert.equal(mermaidDiagramType('%% a comment\n\nflowchart TD\n  A-->B'), 'flowchart');
  assert.equal(mermaidDeclaresLayout(ER), false);
  assert.equal(mermaidDeclaresLayout(ER_DAGRE), true);
  assert.equal(mermaidDeclaresLayout(ER_INIT), true);
  assert.equal(mermaidDeclaresLayout('---\ntitle: Orders\n---\nerDiagram\n  A ||--o{ B : has\n'), false);
});

test('an ER diagram without a layout uses the ER default, registering the layout engine once', async () => {
  const loaders = [{ name: 'elk' }];
  let loads = 0;
  const state = await renderAll(
    { defaultLayouts: { er: 'elk' }, loadLayouts: async () => { loads += 1; return loaders; } },
    ER,
    ER
  );
  assert.deepEqual(state.renders.map((r) => r.layout), ['elk', 'elk']);
  assert.equal(loads, 1);
  assert.deepEqual(state.registered, [loaders]);
});

test('a layout declared in the diagram wins over the default', async () => {
  const state = await renderAll({ defaultLayouts: { er: 'elk' }, loadLayouts: async () => [] }, ER_DAGRE, ER_INIT);
  assert.deepEqual(state.renders.map((r) => r.layout), [undefined, undefined]);
  assert.equal(state.renders[0].text, ER_DAGRE.trimEnd(), 'the source is passed through unchanged');
});

test('other diagram types are unaffected and never load the layout engine', async () => {
  let loads = 0;
  const state = await renderAll({ defaultLayouts: { er: 'elk' }, loadLayouts: async () => { loads += 1; return []; } }, FLOW);
  assert.deepEqual(state.renders.map((r) => r.layout), [undefined]);
  assert.equal(loads, 0);
});

test('without defaultLayouts nothing changes', async () => {
  const state = await renderAll({}, ER, FLOW);
  assert.deepEqual(state.renders.map((r) => r.layout), [undefined, undefined]);
  assert.deepEqual(state.registered, []);
});

test('a layout engine that fails to load leaves the diagram on mermaid\'s default', async () => {
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const state = await renderAll({ defaultLayouts: { er: 'elk' }, loadLayouts: async () => { throw new Error('offline'); } }, ER);
    assert.deepEqual(state.renders.map((r) => r.layout), [undefined]);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = warn;
  }
});
