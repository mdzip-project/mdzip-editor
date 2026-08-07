import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Same DOM bootstrap pattern as rendering-extensibility.test.mjs.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = new JSDOM('<!doctype html><html><body></body></html>').window;
}
globalThis.document = globalThis.window.document;
globalThis.HTMLElement = globalThis.window.HTMLElement;
globalThis.Node = globalThis.window.Node;

// jsdom has no IntersectionObserver at all (matches real old-browser/non-browser
// hosts, which both the image- and chunk-loading paths already have an eager
// fallback for) — install a controllable fake so these tests can exercise the
// real viewport-gated path instead of only the fallback.
class FakeIntersectionObserver {
  static instances = [];
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.observed = new Set();
    this.disconnected = false;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target) {
    this.observed.add(target);
  }
  unobserve(target) {
    this.observed.delete(target);
  }
  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }
  trigger(target) {
    this.callback([{ target, isIntersecting: true }], this);
  }
}
globalThis.window.IntersectionObserver = FakeIntersectionObserver;

import {
  MdzipWorkspaceService,
  MdzipWorkspaceView,
  buildNewArchiveBytesWithTitle
} from '../dist/index.js';

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(assertion, attempts = 30) {
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

async function createOpenView(viewOptions = {}, markdown = '# Hello\n', openOptions = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'viewer',
    initialColorScheme: 'light',
    progressiveTextRendering: true,
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
      FakeIntersectionObserver.instances.length = 0;
      view.destroy();
      container.remove();
    }
  };
}

function manyParagraphMarkdown(count) {
  let markdown = '# Large document\n\n';
  for (let i = 0; i < count; i += 1) {
    markdown += `Paragraph number ${i} with a little padding text so each block has real weight.\n\n`;
  }
  return markdown;
}

// Latest sentinel-observing FakeIntersectionObserver instance in the preview pane.
function latestSentinelObserver() {
  return FakeIntersectionObserver.instances.at(-1);
}

test('chunked rendering mounts an initial batch, defers the rest behind a sentinel, and eventually mounts everything', async () => {
  const { view, dispose } = await createOpenView({}, manyParagraphMarkdown(150));

  try {
    await waitFor(() => {
      assert.ok(view.elPreviewContent.querySelector('.mdzip-chunk'), 'initial batch mounted, wrapped in chunk boundaries');
    });

    const initialParagraphCount = view.elPreviewContent.querySelectorAll('p').length;
    assert.ok(initialParagraphCount > 0 && initialParagraphCount < 150, 'only part of the document is mounted up front');
    assert.ok(view.elPreviewContent.querySelector('.mdzip-chunk-sentinel'), 'a sentinel is present for the remaining chunks');

    // Drive the fake observer until every chunk has mounted.
    for (let guard = 0; guard < 200; guard += 1) {
      const sentinel = view.elPreviewContent.querySelector('.mdzip-chunk-sentinel');
      if (!sentinel) break;
      const observer = latestSentinelObserver();
      observer.trigger(sentinel);
      await flushMicrotasks();
    }

    await waitFor(() => {
      assert.equal(view.elPreviewContent.querySelector('.mdzip-chunk-sentinel'), null, 'sentinel is gone once everything is mounted');
    });
    assert.equal(view.elPreviewContent.querySelectorAll('p').length, 150, 'every paragraph eventually mounts');
  } finally {
    dispose();
  }
});

test('onAssetsHydrated fires once for the initial batch, not re-fired as later chunks mount', async () => {
  const hydratedEvents = [];
  const { view, dispose } = await createOpenView(
    { onAssetsHydrated: () => hydratedEvents.push(Date.now()) },
    manyParagraphMarkdown(150)
  );

  try {
    await waitFor(() => assert.equal(hydratedEvents.length, 1, 'fires once for the initial batch (no images, so immediately)'));

    for (let guard = 0; guard < 200; guard += 1) {
      const sentinel = view.elPreviewContent.querySelector('.mdzip-chunk-sentinel');
      if (!sentinel) break;
      latestSentinelObserver().trigger(sentinel);
      await flushMicrotasks();
    }
    await waitFor(() => assert.equal(view.elPreviewContent.querySelector('.mdzip-chunk-sentinel'), null));

    assert.equal(hydratedEvents.length, 1, 'still exactly one hydrated event after every later chunk has mounted');
  } finally {
    dispose();
  }
});

test('a transformHtml extension (mermaid-shaped: scans whatever HTML it is given) applies correctly to a later, not-yet-mounted chunk', async () => {
  const mark = (html) => html.replace(/<p>Paragraph number (\d+)/g, '<p class="mdzip-marked mdzip-marked-$1">Paragraph number $1');
  const extension = { name: 'mark', transformHtml: mark };
  const { view, dispose } = await createOpenView({ markdownExtensions: [extension] }, manyParagraphMarkdown(150));

  try {
    await waitFor(() => assert.ok(view.elPreviewContent.querySelector('.mdzip-chunk')));
    // The last paragraph is guaranteed to be in a later chunk (150 paragraphs
    // is far more than the ~4000-char initial batch fits).
    assert.equal(view.elPreviewContent.querySelector('p.mdzip-marked-149'), null, 'not mounted yet');

    for (let guard = 0; guard < 200; guard += 1) {
      const sentinel = view.elPreviewContent.querySelector('.mdzip-chunk-sentinel');
      if (!sentinel) break;
      latestSentinelObserver().trigger(sentinel);
      await flushMicrotasks();
    }
    await waitFor(() => assert.equal(view.elPreviewContent.querySelector('.mdzip-chunk-sentinel'), null));

    assert.ok(view.elPreviewContent.querySelector('p.mdzip-marked-149'), 'the extension ran on the chunk once it mounted');
    assert.ok(view.elPreviewContent.querySelector('p.mdzip-marked-0'), 'and on the initial batch too');
  } finally {
    dispose();
  }
});

test('extension mount() is called once per chunk, not duplicated, and covers every mounted chunk', async () => {
  const calls = { mount: 0, containers: [] };
  const extension = {
    name: 'mount-tracker',
    mount: (container) => {
      calls.mount += 1;
      calls.containers.push(container);
      return { destroy: () => {} };
    }
  };
  const { view, dispose } = await createOpenView({ markdownExtensions: [extension] }, manyParagraphMarkdown(150));

  try {
    await waitFor(() => assert.ok(view.elPreviewContent.querySelector('.mdzip-chunk')));
    const initialChunkCount = view.elPreviewContent.querySelectorAll('.mdzip-chunk').length;
    assert.equal(calls.mount, initialChunkCount, 'mount() called once per chunk mounted so far');

    for (let guard = 0; guard < 200; guard += 1) {
      const sentinel = view.elPreviewContent.querySelector('.mdzip-chunk-sentinel');
      if (!sentinel) break;
      latestSentinelObserver().trigger(sentinel);
      await flushMicrotasks();
    }
    await waitFor(() => assert.equal(view.elPreviewContent.querySelector('.mdzip-chunk-sentinel'), null));

    const finalChunkCount = view.elPreviewContent.querySelectorAll('.mdzip-chunk').length;
    assert.equal(calls.mount, finalChunkCount, 'still exactly one mount() call per chunk after every chunk has mounted');
    assert.ok(finalChunkCount > initialChunkCount, 'sanity: more than one chunk existed across the whole document');
    // Every recorded container is a distinct chunk element, never re-used.
    assert.equal(new Set(calls.containers).size, calls.containers.length);
  } finally {
    dispose();
  }
});

test('progressiveTextRendering is silently ignored for a custom (non-default) markdown renderer', async () => {
  const customRenderer = { render: (markdown) => `<p>custom:${markdown.length}</p>` };
  const failures = [];
  const { view, dispose } = await createOpenView(
    { markdownRenderer: customRenderer, onFailed: (error) => failures.push(error) },
    manyParagraphMarkdown(150)
  );

  try {
    await waitFor(() => assert.match(view.elPreviewContent.innerHTML, /custom:/));
    assert.equal(view.elPreviewContent.querySelector('.mdzip-chunk'), null, 'falls back to the whole-document path, no chunk wrappers');
    assert.deepEqual(failures, [], 'no error surfaced for the unsupported combination');
  } finally {
    dispose();
  }
});

test('progressiveTextRendering off (default) never produces chunk wrappers', async () => {
  const { view, dispose } = await createOpenView({ progressiveTextRendering: false }, manyParagraphMarkdown(150));

  try {
    await waitFor(() => assert.equal(view.elPreviewContent.querySelectorAll('p').length, 150));
    assert.equal(view.elPreviewContent.querySelector('.mdzip-chunk'), null);
    assert.equal(view.elPreviewContent.querySelector('.mdzip-chunk-sentinel'), null);
  } finally {
    dispose();
  }
});
