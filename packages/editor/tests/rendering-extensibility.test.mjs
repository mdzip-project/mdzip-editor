import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// The default renderer sanitizes through DOMPurify, which needs a DOM window
// in Node. The library resolves it lazily from globalThis.window.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = new JSDOM('<!doctype html><html><body></body></html>').window;
}
globalThis.document = globalThis.window.document;
globalThis.HTMLElement = globalThis.window.HTMLElement;
globalThis.Node = globalThis.window.Node;
import {
  MdzipRenderingService,
  MdzipWorkspaceService,
  MdzipWorkspaceView,
  buildNewArchiveBytesWithTitle,
  defaultSafeMarkdownRenderer,
  mdzipExtensionMatcher,
  mdzipPathMatcher
} from '../dist/index.js';

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

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

// --- rendering pipeline ---

test('renderMarkdown keeps a synchronous fast path and chains transforms in order', () => {
  const service = new MdzipRenderingService(defaultSafeMarkdownRenderer, [
    { name: 'one', transformMarkdown: (md) => md.replace('alpha', 'beta') },
    { name: 'two', transformMarkdown: (md) => md.replace('beta', 'gamma') }
  ]);

  const result = service.renderMarkdown('# alpha\n', renderContext());
  assert.equal(typeof result, 'string', 'fully synchronous pipelines return a plain string');
  assert.match(result, /gamma/);
  assert.doesNotMatch(result, /alpha|beta/);
});

test('async transformHtml output passes through sanitization', async () => {
  const service = new MdzipRenderingService(defaultSafeMarkdownRenderer, [
    {
      name: 'inject',
      transformHtml: async (html) =>
        `${html}<script>alert(1)</script><div class="mermaid-placeholder">diagram</div>`
    }
  ]);

  const result = service.renderMarkdown('hello', renderContext());
  assert.equal(typeof result.then, 'function', 'async stages promote the pipeline to a promise');
  const html = await result;
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /class="mermaid-placeholder"/, 'class markers survive the sanitizer');
  assert.match(html, /hello/);
});

test('custom renderer output is sanitized by the pipeline', () => {
  const service = new MdzipRenderingService({
    render: () => '<p>ok</p><img src="x" onerror="alert(1)">'
  });

  const html = service.renderMarkdown('ignored', renderContext());
  assert.match(html, /<p>ok<\/p>/);
  assert.doesNotMatch(html, /onerror/);
});

test('sanitizesOutput bypass applies only while no transformHtml extension is registered', async () => {
  const trustedRenderer = {
    sanitizesOutput: true,
    render: () => '<p>trusted</p><script>kept()</script>'
  };

  const bypassed = new MdzipRenderingService(trustedRenderer).renderMarkdown('x', renderContext());
  assert.match(bypassed, /<script>kept\(\)<\/script>/, 'explicit bypass is honored');

  const withHook = new MdzipRenderingService(trustedRenderer, [
    { name: 'html-hook', transformHtml: (html) => html }
  ]).renderMarkdown('x', renderContext());
  assert.doesNotMatch(await withHook, /<script/, 'transformHtml re-enables the pipeline pass');
});

test('aborted async renders reject with AbortError', async () => {
  const controller = new AbortController();
  const service = new MdzipRenderingService(defaultSafeMarkdownRenderer, [
    { name: 'slow', transformMarkdown: async (md) => md }
  ]);

  const pending = service.renderMarkdown('# slow', renderContext({ signal: controller.signal }));
  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
});

test('legacy render() keeps its synchronous contract', () => {
  const service = new MdzipRenderingService();
  assert.match(service.render({ markdown: '# Hi' }).html, /<h1>Hi<\/h1>/);

  const asyncService = new MdzipRenderingService({ render: async () => 'late' });
  assert.throws(() => asyncService.render({ markdown: 'x' }), /renderMarkdown/);
});

test('matcher helpers match paths and extensions case-insensitively', () => {
  const byPath = mdzipPathMatcher('manifest.json');
  assert.equal(byPath({ path: 'Manifest.JSON' }), true);
  assert.equal(byPath({ path: 'docs/manifest.json' }), false);

  const byExt = mdzipExtensionMatcher('drawio', '.pdf');
  assert.equal(byExt({ path: 'diagrams/Flow.DRAWIO' }), true);
  assert.equal(byExt({ path: 'manual.pdf' }), true);
  assert.equal(byExt({ path: 'index.md' }), false);
});

// --- workspace.updateManifest ---

test('updateManifest replaces the manifest, emits a manifest event, and persists', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Doc\n', 'Original');
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });
  const events = [];
  workspace.subscribe((event) => events.push(event.changes));

  await workspace.updateManifest({
    ...workspace.manifest(),
    title: 'Replaced',
    description: 'set by entry renderer'
  });

  assert.deepEqual(events.at(-1), ['manifest']);
  assert.equal(workspace.dirty, true);
  assert.equal(workspace.snapshot().displayTitle, 'Replaced');
  assert.equal(workspace.manifest().description, 'set by entry renderer');
  assert.ok(workspace.manifest().modified, 'canonicalization refreshed modified');

  const saved = await workspace.saveToBytes();
  const reopened = await MdzipWorkspaceService.open(saved, { mode: 'read-only' });
  assert.equal(reopened.manifest().title, 'Replaced');
  assert.equal(reopened.manifest().description, 'set by entry renderer');
});

// --- view integration (no CodeMirror: the workspace is wired in directly) ---

async function createOpenView(viewOptions = {}, markdown = '# Hello\n', openOptions = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'viewer',
    initialColorScheme: 'light',
    ...viewOptions
  });
  const bytes = await buildNewArchiveBytesWithTitle(markdown, 'Demo');
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable', ...openOptions });
  view.workspace = workspace;
  view.unsub = workspace.subscribe(() => view.render());
  view.render();
  return {
    view,
    workspace,
    container,
    dispose: () => {
      view.destroy();
      container.remove();
    }
  };
}

function trackedEntryRenderer(overrides = {}) {
  const calls = { matches: 0, mount: 0, update: 0, destroy: 0, containers: [] };
  const renderer = {
    id: 'tracked',
    matches: (context) => {
      calls.matches += 1;
      return mdzipPathMatcher('manifest.json')(context);
    },
    mount: (containerEl, context) => {
      calls.mount += 1;
      calls.containers.push(containerEl);
      containerEl.textContent = `mounted:${context.path}`;
      return {
        update: () => { calls.update += 1; },
        destroy: () => { calls.destroy += 1; }
      };
    },
    ...overrides
  };
  return { renderer, calls };
}

test('entry renderer claims and releases the full pane stack', async () => {
  const { renderer, calls } = trackedEntryRenderer();
  const { view, workspace, dispose } = await createOpenView({ entryRenderers: [renderer] });

  try {
    assert.equal(view.elEntryPane.classList.contains('active'), false, 'index.md is not claimed');

    await workspace.openPath('manifest.json');
    assert.equal(calls.mount, 1);
    assert.equal(view.elEntryPane.classList.contains('active'), true);
    assert.equal(view.elEditPane.classList.contains('active'), false);
    assert.equal(view.elPreviewPane.classList.contains('active'), false);
    assert.equal(view.elPaneStack.classList.contains('entry-claimed'), true);
    assert.match(view.elEntryPane.textContent, /mounted:manifest\.json/);

    await workspace.openPath('index.md');
    assert.equal(calls.destroy, 1, 'handle destroyed on selection change');
    assert.equal(view.elEntryPane.classList.contains('active'), false);
    assert.equal(view.elPaneStack.classList.contains('entry-claimed'), false);
    assert.equal(view.elEntryPane.childNodes.length, 0, 'container cleared');
  } finally {
    dispose();
  }
});

test('match results are cached per selection and update() fires on context changes', async () => {
  const { renderer, calls } = trackedEntryRenderer();
  const { view, workspace, dispose } = await createOpenView({ entryRenderers: [renderer] });

  try {
    const missMatches = calls.matches;
    view.render();
    view.render();
    assert.equal(calls.matches, missMatches, 'negative match is cached for the same selection');

    await workspace.openPath('manifest.json');
    const claimedMatches = calls.matches;
    view.render();
    view.render();
    view.render();
    assert.equal(calls.matches, claimedMatches, 'no re-match while the selection key is stable');
    assert.equal(calls.mount, 1, 'no re-mount on unrelated renders');
    assert.equal(calls.update, 0);

    view.colorScheme = 'dark';
    view.render();
    assert.equal(calls.update, 1, 'colorScheme change flows through update()');
    assert.equal(calls.mount, 1, 'still no re-mount');
  } finally {
    dispose();
  }
});

test('stale async entry mounts are destroyed instead of applied', async () => {
  let resolveMount;
  const destroyed = { count: 0 };
  const renderer = {
    id: 'slow-mount',
    matches: mdzipPathMatcher('manifest.json'),
    mount: () => new Promise((resolve) => {
      resolveMount = () => resolve({ destroy: () => { destroyed.count += 1; } });
    })
  };
  const { workspace, view, dispose } = await createOpenView({ entryRenderers: [renderer] });

  try {
    await workspace.openPath('manifest.json');
    assert.ok(resolveMount, 'mount started');

    await workspace.openPath('index.md');
    resolveMount();
    await flushMicrotasks();

    assert.equal(destroyed.count, 1, 'late handle destroyed because the selection moved on');
    assert.equal(view.elEntryPane.classList.contains('active'), false);
  } finally {
    dispose();
  }
});

test('preview renders are memoized against unrelated snapshot renders', async () => {
  const rendered = [];
  const countingRenderer = {
    render: (markdown) => {
      rendered.push(markdown);
      return `<p>${markdown.length}</p>`;
    }
  };
  const { view, workspace, dispose } = await createOpenView({ markdownRenderer: countingRenderer });

  try {
    assert.equal(rendered.length, 1, 'initial render');

    view.render();
    view.render();
    view.render();
    assert.equal(rendered.length, 1, 'unrelated renders never re-run the pipeline');

    workspace.editText('# Changed\n');
    assert.equal(rendered.length, 2, 'content changes re-render');

    view.colorScheme = 'dark';
    view.render();
    assert.equal(rendered.length, 3, 'colorScheme is part of the memo key');
  } finally {
    dispose();
  }
});

test('stale async markdown renders are dropped', async () => {
  const pending = new Map();
  const asyncRenderer = {
    render: (markdown) => new Promise((resolve) => {
      pending.set(markdown.trim(), (html) => resolve(html));
    })
  };
  const { view, workspace, dispose } = await createOpenView({ markdownRenderer: asyncRenderer });

  try {
    workspace.editText('# one');
    workspace.editText('# two');

    pending.get('# two')('<p>two</p>');
    await flushMicrotasks();
    pending.get('# one')('<p>one</p>');
    pending.get('# Hello')('<p>initial</p>');
    await flushMicrotasks();

    assert.match(view.elPreviewContent.innerHTML, /two/);
    assert.doesNotMatch(view.elPreviewContent.innerHTML, /one|initial/);
  } finally {
    dispose();
  }
});

test('extension mount handles are destroyed before the preview re-renders', async () => {
  const calls = { mount: 0, destroy: 0 };
  const extension = {
    name: 'mount-tracker',
    transformHtml: (html) => `${html}<div class="ext-marker"></div>`,
    mount: (container) => {
      calls.mount += 1;
      assert.ok(container.querySelector('.ext-marker'), 'mount sees the transformed DOM');
      return { destroy: () => { calls.destroy += 1; } };
    }
  };
  const { view, workspace, dispose } = await createOpenView({ markdownExtensions: [extension] });

  try {
    assert.equal(calls.mount, 1);
    assert.equal(calls.destroy, 0);

    view.render();
    assert.equal(calls.mount, 1, 'memoized renders keep the mounted handle');

    workspace.editText('# new content');
    assert.equal(calls.destroy, 1, 'old handle destroyed before re-render');
    assert.equal(calls.mount, 2);
  } finally {
    dispose();
  }
});

test('setRenderingOptions applies new renderers without recreating the view', async () => {
  const { renderer, calls } = trackedEntryRenderer();
  const { view, workspace, dispose } = await createOpenView();

  try {
    await workspace.openPath('manifest.json');
    assert.equal(view.elEntryPane.classList.contains('active'), false, 'nothing registered yet');

    view.setRenderingOptions({ entryRenderers: [renderer] });
    assert.equal(calls.mount, 1, 'newly registered renderer claims the current selection');
    assert.equal(view.elEntryPane.classList.contains('active'), true);

    view.setRenderingOptions({ entryRenderers: [] });
    assert.equal(calls.destroy, 1, 'deregistering destroys the active handle');
    assert.equal(view.elEntryPane.classList.contains('active'), false);
  } finally {
    dispose();
  }
});

test('context.updateManifest flows through the manifest event and marks dirty', async () => {
  let mountContext = null;
  const renderer = {
    id: 'manifest-editor',
    matches: mdzipPathMatcher('manifest.json'),
    mount: (container, context) => {
      mountContext = context;
      return { destroy: () => {} };
    }
  };
  const { workspace, dispose } = await createOpenView({ entryRenderers: [renderer] });
  const manifestEvents = [];
  workspace.subscribe((event) => {
    if (event.changes.includes('manifest')) {
      manifestEvents.push(event);
    }
  });

  try {
    await workspace.openPath('manifest.json');
    assert.ok(mountContext, 'renderer mounted with a context');
    assert.equal(mountContext.pathType, 'text', 'manifest.json is classified as text');

    await mountContext.updateManifest({ ...mountContext.manifest, title: 'From Renderer' });

    assert.equal(manifestEvents.length, 1);
    assert.equal(workspace.dirty, true);
    assert.equal(workspace.snapshot().displayTitle, 'From Renderer');

    const bytes = await mountContext.readBytes();
    assert.ok(bytes.length > 0, 'readBytes returns the entry bytes');
  } finally {
    dispose();
  }
});
