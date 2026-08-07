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
  groupTokensIntoChunks,
  mdzipExtensionMatcher,
  mdzipPathMatcher
} from '../dist/index.js';

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(assertion, attempts = 20) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flushMicrotasks();
    }
  }
  throw lastError;
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

test('default policy strips inline SVG; a sanitize contribution keeps it (minus scripts)', async () => {
  const injectSvg = (html) =>
    `${html}<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle>`
    + '<script>alert(1)</script></svg>';

  // Without a contribution the HTML-only profile removes the whole SVG.
  const stripped = await new MdzipRenderingService(defaultSafeMarkdownRenderer, [
    { name: 'diagram', transformHtml: injectSvg }
  ]).renderMarkdown('hi', renderContext());
  assert.doesNotMatch(stripped, /<svg/, 'SVG is stripped by the default html-only policy');

  // allowSvg widens the single pass so the SVG survives — but DOMPurify still
  // strips scripts/event handlers nested inside it.
  const kept = await new MdzipRenderingService(defaultSafeMarkdownRenderer, [
    { name: 'diagram', sanitize: { allowSvg: true }, transformHtml: injectSvg }
  ]).renderMarkdown('hi', renderContext());
  assert.match(kept, /<svg/, 'allowSvg keeps the SVG');
  assert.match(kept, /<circle/, 'shape elements survive');
  assert.doesNotMatch(kept, /<script/, 'scripts inside the SVG are still removed');
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

// --- chunked rendering (tokenizeMarkdown / groupTokensIntoChunks / renderChunk) ---

const CHUNK_FIXTURE = [
  '# Title',
  '',
  'First paragraph with **bold** text.',
  '',
  'Second paragraph referencing a [link][ref] by reference.',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  'Third paragraph after the table.',
  '',
  '[ref]: https://example.com "Example"',
  ''
].join('\n');

async function renderChunkedConcat(service, markdown, context, chunkOptions) {
  const tokens = await service.tokenizeMarkdown(markdown, context);
  const chunks = groupTokensIntoChunks(tokens, chunkOptions);
  const rendered = [];
  for (const chunk of chunks) {
    rendered.push(await service.renderChunk(chunk, context));
  }
  return rendered.join('');
}

test('chunked rendering (one token per chunk) byte-matches whole-document renderMarkdown()', async () => {
  const service = new MdzipRenderingService(defaultSafeMarkdownRenderer, []);
  const context = renderContext();

  const whole = await service.renderMarkdown(CHUNK_FIXTURE, context);
  const chunked = await renderChunkedConcat(service, CHUNK_FIXTURE, context, { tokenCap: 1 });

  assert.equal(chunked, whole);
  assert.match(chunked, /<h1>Title<\/h1>/);
  assert.match(chunked, /href="https:\/\/example.com"/, 'reference-style link resolves even split into its own chunk');
  assert.match(chunked, /class="hljs language-js"/, 'code fence is still syntax-highlighted');
  assert.match(chunked, /<table>/);
});

test('chunked rendering with a per-block transformHtml extension matches whole-document output', async () => {
  // Mirrors the shape of the mermaid extension: scans whatever HTML string
  // it's given for a specific marker and only touches matches, independent
  // of anything else in the document — the property chunking depends on.
  const markMermaid = (html) => html.replace(/<pre><code class="hljs language-js">/g, '<pre class="mdzip-marked"><code class="hljs language-js">');
  const extensions = [{ name: 'mark', transformHtml: markMermaid }];
  const context = renderContext();

  const whole = await new MdzipRenderingService(defaultSafeMarkdownRenderer, extensions)
    .renderMarkdown(CHUNK_FIXTURE, context);
  const chunkedService = new MdzipRenderingService(defaultSafeMarkdownRenderer, extensions);
  const chunked = await renderChunkedConcat(chunkedService, CHUNK_FIXTURE, context, { tokenCap: 1 });

  assert.equal(chunked, whole);
  assert.match(chunked, /class="mdzip-marked"/);
});

test('tokenizeMarkdown/renderChunk reject a custom (non-default) renderer', async () => {
  const service = new MdzipRenderingService({ render: () => '<p>custom</p>' });
  const context = renderContext();
  assert.throws(() => service.tokenizeMarkdown('x', context), /only supports the default marked-based renderer/);
  assert.throws(() => service.renderChunk([], context), /only supports the default marked-based renderer/);
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

test('preview-only views do not initialize CodeMirror', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'preview',
    initialLayout: 'preview',
    initialColorScheme: 'light',
    libraries: [{
      name: '@mdzip/editor-react',
      version: '1.3.5',
      repositoryUrl: 'https://github.com/mdzip-project/mdzip-editor/tree/main/packages/editor-react',
      description: 'React wrapper for the MDZip workspace editor.'
    }]
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Preview only\n', 'Preview');
    await view.open(bytes, { mode: 'read-only', fileName: 'preview.mdz' });

    assert.equal(container.querySelector('.cm-editor'), null);
    assert.equal(container.querySelector('[data-ref="editor-host"]').childNodes.length, 0);
    assert.match(container.querySelector('[data-ref="preview-content"]').textContent, /Preview only/);
    const libraryText = container.querySelector('[data-ref="library-list"]').textContent;
    assert.match(libraryText, /@mdzip\/editor-react\s*1\.3\.5/);
    assert.match(libraryText, /@mdzip\/editor\s*\d+\.\d+\.\d+/);
    assert.match(libraryText, /@mdzip\/core-js\s*\d+\.\d+\.\d+/);
    assert.match(libraryText, /CodeMirror\s*\d+\.\d+\.\d+/);
    assert.match(libraryText, /Marked\s*\d+\.\d+\.\d+/);
    assert.match(libraryText, /DOMPurify\s*\d+\.\d+\.\d+/);
    assert.match(libraryText, /React wrapper for the MDZip workspace editor/);
    const reactLink = container.querySelector(
      '[data-ref="library-list"] a[href*="/packages/editor-react"]'
    );
    assert.equal(reactLink?.textContent, '@mdzip/editor-react');
    assert.equal(reactLink?.getAttribute('target'), '_blank');
    assert.equal(reactLink?.getAttribute('rel'), 'noopener noreferrer');
  } finally {
    view.destroy();
    container.remove();
  }
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

test('fires onPreviewRendered then onAssetsHydrated and resolves whenRendered', async () => {
  const events = [];
  const { view, dispose } = await createOpenView({
    onPreviewRendered: (snapshot) => events.push(['rendered', snapshot.currentPath]),
    onAssetsHydrated: (snapshot) => events.push(['hydrated', snapshot.currentPath])
  });

  try {
    // The image-free preview hydrates synchronously during the initial render.
    assert.deepEqual(events, [
      ['rendered', 'index.md'],
      ['hydrated', 'index.md']
    ]);
    // whenRendered resolves immediately once the latest preview is hydrated.
    await view.whenRendered();
  } finally {
    dispose();
  }
});

test('whenRendered resolves on view destruction without hanging', async () => {
  const { view, dispose } = await createOpenView();
  const pending = view.whenRendered();
  dispose();
  // Should resolve (not reject or hang) even though the view was destroyed.
  await pending;
});

const PNG_1X1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
));

test('progressively hydrates archive images: text first, then sized swap-in', async () => {
  const events = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'viewer',
    initialColorScheme: 'light',
    onPreviewRendered: () => events.push('rendered'),
    onAssetsHydrated: () => events.push('hydrated')
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle(
      '# Title\n\n![logo](images/logo.png)\n',
      'Demo',
      [{ archivePath: 'images/logo.png', fileBytes: PNG_1X1 }]
    );
    await view.open(bytes, { mode: 'read-only', fileName: 'demo.mdz' });

    // Text mounts immediately: rendered has fired, but the image is still a
    // placeholder (no src yet) inside a collapsed slot, so hydration has not
    // completed and following content stays compact.
    assert.deepEqual(events, ['rendered']);
    const image = container.querySelector('[data-ref="preview-content"] img');
    assert.ok(image, 'image element is in the mounted preview');
    assert.equal(image.getAttribute('src'), null, 'archive src is withheld until resolved');
    assert.equal(image.classList.contains('mdzip-image-loading'), true);
    const slot = image.parentElement;
    assert.equal(slot.classList.contains('mdzip-image-slot'), true, 'image is wrapped in a slot');
    assert.equal(slot.classList.contains('mdzip-image-open'), false, 'slot starts collapsed');

    // Once the image resolves it is sized from its sniffed dimensions, the
    // resolved URL is swapped in, and the slot eases open; hydration completes.
    await view.whenRendered();
    assert.deepEqual(events, ['rendered', 'hydrated']);
    assert.match(image.getAttribute('src') ?? '', /^(data:image|blob:)/);
    assert.equal(image.getAttribute('width'), '1');
    assert.equal(image.getAttribute('height'), '1');
    assert.equal(slot.classList.contains('mdzip-image-open'), true, 'slot opens after resolve');
  } finally {
    view.destroy();
    container.remove();
  }
});

test('progressive image hydration preserves legacy wrap alignment', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'viewer',
    initialColorScheme: 'light'
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle(
      '# Title\n\n<img src="images/logo.png" alt="Logo" align="left">Wrapped text.\n',
      'Demo',
      [{ archivePath: 'images/logo.png', fileBytes: PNG_1X1 }]
    );
    await view.open(bytes, { mode: 'read-only', fileName: 'demo.mdz' });

    const image = container.querySelector('[data-ref="preview-content"] img');
    assert.ok(image, 'image element is in the mounted preview');
    const slot = image.parentElement;
    assert.equal(slot.classList.contains('mdzip-image-slot'), true);
    assert.equal(slot.classList.contains('mdzip-image-align-left'), true);

    await view.whenRendered();
    assert.match(image.getAttribute('src') ?? '', /^(data:image|blob:)/);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('progressive image hydration honors raw HTML width/height attributes', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'viewer',
    initialColorScheme: 'light'
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle(
      '# Title\n\n<img src="images/logo.png" alt="Logo" height="300" align="right">\n',
      'Demo',
      [{ archivePath: 'images/logo.png', fileBytes: PNG_1X1 }]
    );
    await view.open(bytes, { mode: 'read-only', fileName: 'demo.mdz' });

    const image = container.querySelector('[data-ref="preview-content"] img');
    assert.ok(image, 'image element is in the mounted preview');
    assert.equal(image.style.height, 'calc(300px * var(--mdz-zoom, 1))', 'explicit height attribute survives the preview\'s height:auto rule, scaled with zoom');
    assert.equal(image.style.width, '', 'width is left to scale from the aspect ratio when only height is given');
    const slot = image.parentElement;
    assert.equal(slot.classList.contains('mdzip-image-align-right'), true);

    await view.whenRendered();
  } finally {
    view.destroy();
    container.remove();
  }
});

test('raw HTML image alignment applies even for images that skip archive hydration', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'viewer',
    initialColorScheme: 'light'
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle(
      '# Title\n\n<img src="https://example.com/logo.png" alt="Logo" align="left" width="180">\n',
      'Demo',
      []
    );
    await view.open(bytes, { mode: 'read-only', fileName: 'demo.mdz' });

    const image = container.querySelector('[data-ref="preview-content"] img');
    assert.ok(image, 'external image is in the mounted preview');
    assert.equal(image.classList.contains('mdzip-image-left'), true);
    assert.equal(image.style.width, 'calc(180px * var(--mdz-zoom, 1))');
    assert.equal(
      image.parentElement.classList.contains('mdzip-image-slot'),
      false,
      'external images are not wrapped in a hydration slot'
    );
  } finally {
    view.destroy();
    container.remove();
  }
});

test('image hydration animation can be disabled for live editing', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'viewer',
    imageHydrationAnimation: 'off',
    initialColorScheme: 'light'
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle(
      '# Title\n\n![logo](images/logo.png)\n',
      'Demo',
      [{ archivePath: 'images/logo.png', fileBytes: PNG_1X1 }]
    );
    await view.open(bytes, { mode: 'read-only', fileName: 'demo.mdz' });

    const image = container.querySelector('[data-ref="preview-content"] img');
    assert.ok(image, 'image element is mounted immediately');
    const slot = image.parentElement;
    assert.equal(slot.classList.contains('mdzip-image-slot'), true);
    assert.equal(slot.classList.contains('mdzip-image-open'), true, 'slot is opened immediately');
    assert.equal(slot.classList.contains('mdzip-image-animation-off'), true);
    assert.equal(image.classList.contains('mdzip-image-loading'), false, 'pulse class is not applied');

    await view.whenRendered();
    assert.match(image.getAttribute('src') ?? '', /^(data:image|blob:)/);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('image hydration animation can run only for initial document load', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'viewer',
    imageHydrationAnimation: 'initial',
    initialColorScheme: 'light'
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle(
      '# Title\n\n![logo](images/logo.png)\n',
      'Demo',
      [{ archivePath: 'images/logo.png', fileBytes: PNG_1X1 }]
    );
    await view.open(bytes, { mode: 'editable', fileName: 'demo.mdz' });

    await waitFor(() => {
      assert.ok(container.querySelector('[data-ref="preview-content"] img'), 'image element is mounted on initial load');
    });
    const firstImage = container.querySelector('[data-ref="preview-content"] img');
    const firstSlot = firstImage.parentElement;
    assert.equal(firstImage.classList.contains('mdzip-image-loading'), true);
    assert.equal(firstSlot.classList.contains('mdzip-image-open'), false, 'initial slot starts collapsed');
    await view.whenRendered();

    view.workspace.editText('# Title\n\n![logo](images/logo.png)\n\nTyping update');

    await waitFor(() => {
      const text = container.querySelector('[data-ref="preview-content"]')?.textContent ?? '';
      assert.match(text, /Typing update/);
    });

    const editedImage = container.querySelector('[data-ref="preview-content"] img');
    assert.ok(editedImage, 'image element remains in the edited preview');
    const editedSlot = editedImage.parentElement;
    assert.equal(editedSlot.classList.contains('mdzip-image-slot'), true);
    assert.equal(editedSlot.classList.contains('mdzip-image-open'), true, 'edited slot opens immediately');
    assert.equal(editedSlot.classList.contains('mdzip-image-animation-off'), true);
    assert.equal(editedImage.classList.contains('mdzip-image-loading'), false, 'edit render does not pulse');
  } finally {
    view.destroy();
    container.remove();
  }
});
