import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Same DOM bootstrap pattern as rendering-extensibility.test.mjs.
// `pretendToBeVisual: true` also gives us a real requestAnimationFrame,
// which the non-progressive (eager) chunk-mounting path yields on between
// batches — see preview-copy-all.test.mjs's identical reasoning.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true
  }).window;
}
globalThis.document = globalThis.window.document;
globalThis.HTMLElement = globalThis.window.HTMLElement;
globalThis.Node = globalThis.window.Node;
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame.bind(globalThis.window);
globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame.bind(globalThis.window);

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

test('progressiveTextRendering off (default) mounts every chunk up front with no lazy-load sentinel', async () => {
  const { view, dispose } = await createOpenView({ progressiveTextRendering: false }, manyParagraphMarkdown(150));

  try {
    await waitFor(() => assert.equal(view.elPreviewContent.querySelectorAll('p').length, 150));
    // Chunk+diff reconciliation is the default for the built-in renderer
    // regardless of progressiveTextRendering — that flag only controls
    // lazy-load-on-scroll vs. mount-everything-up-front, so `.mdzip-chunk`
    // wrappers exist either way; only the sentinel (lazy continuation) is
    // gone, and everything is already mounted (no pending tail).
    assert.notEqual(view.elPreviewContent.querySelector('.mdzip-chunk'), null);
    assert.equal(view.elPreviewContent.querySelector('.mdzip-chunk-sentinel'), null);
    assert.equal(view.chunkedRenderState.cursor, view.chunkedRenderState.records.length);
  } finally {
    dispose();
  }
});

// --- Chunk reconciliation on same-document edits ---

async function drainAllChunks(view) {
  for (let guard = 0; guard < 200; guard += 1) {
    const sentinel = view.elPreviewContent.querySelector('.mdzip-chunk-sentinel');
    if (!sentinel) break;
    latestSentinelObserver().trigger(sentinel);
    await flushMicrotasks();
  }
  await waitFor(() => assert.equal(view.elPreviewContent.querySelector('.mdzip-chunk-sentinel'), null));
}

test('reconciliation: editing text in a later chunk leaves an earlier chunk\'s DOM node referentially identical', async () => {
  const { view, dispose } = await createOpenView({ progressiveTextRendering: false }, manyParagraphMarkdown(150));
  try {
    await waitFor(() => assert.equal(view.elPreviewContent.querySelectorAll('p').length, 150));
    const firstChunkBefore = view.elPreviewContent.querySelector('.mdzip-chunk');
    assert.ok(firstChunkBefore);

    const text = view.workspace.snapshot().currentText;
    view.workspace.editText(text.replace('Paragraph number 149 ', 'Paragraph number 149 EDITED '));
    await waitFor(() => assert.match(view.elPreviewContent.textContent, /149 EDITED/));

    assert.strictEqual(
      view.elPreviewContent.querySelector('.mdzip-chunk'),
      firstChunkBefore,
      'the first chunk element is untouched by an edit far away from it'
    );
  } finally {
    dispose();
  }
});

test('reconciliation: editing text in an early chunk leaves a later, unaffected chunk\'s DOM node referentially identical', async () => {
  const { view, dispose } = await createOpenView({ progressiveTextRendering: false }, manyParagraphMarkdown(150));
  try {
    await waitFor(() => assert.equal(view.elPreviewContent.querySelectorAll('p').length, 150));
    const chunksBefore = [...view.elPreviewContent.querySelectorAll('.mdzip-chunk')];
    const lastChunkBefore = chunksBefore.at(-1);
    assert.ok(lastChunkBefore);

    const text = view.workspace.snapshot().currentText;
    view.workspace.editText(text.replace('Paragraph number 0 ', 'Paragraph number 0 EDITED '));
    await waitFor(() => assert.match(view.elPreviewContent.textContent, /0 EDITED/));

    const chunksAfter = [...view.elPreviewContent.querySelectorAll('.mdzip-chunk')];
    assert.strictEqual(chunksAfter.at(-1), lastChunkBefore, 'the last chunk element is untouched by an edit at the very start');
  } finally {
    dispose();
  }
});

test('reconciliation: an unchanged chunk\'s extension mount/destroy is not re-invoked after an edit elsewhere', async () => {
  const calls = { mount: 0, destroy: 0 };
  const extension = {
    name: 'mount-tracker',
    mount: () => {
      calls.mount += 1;
      return { destroy: () => { calls.destroy += 1; } };
    }
  };
  const { view, dispose } = await createOpenView({ progressiveTextRendering: false, markdownExtensions: [extension] }, manyParagraphMarkdown(150));
  try {
    await waitFor(() => assert.equal(view.elPreviewContent.querySelectorAll('p').length, 150));
    const mountCountBefore = calls.mount;
    assert.ok(mountCountBefore > 1, 'sanity: more than one chunk was mounted');

    const text = view.workspace.snapshot().currentText;
    view.workspace.editText(text.replace('Paragraph number 149 ', 'Paragraph number 149 EDITED '));
    await waitFor(() => assert.match(view.elPreviewContent.textContent, /149 EDITED/));

    // The edited chunk (the last one, containing paragraph 149) is destroyed
    // and remounted — exactly one extra mount/destroy pair — but every other,
    // unaffected chunk is untouched.
    assert.equal(calls.destroy, 1, 'exactly one chunk (the edited one) was torn down');
    assert.equal(calls.mount, mountCountBefore + 1, 'exactly one replacement chunk was mounted');
  } finally {
    dispose();
  }
});

test('reconciliation: a manually-mutated DOM attribute on an unchanged chunk survives an edit elsewhere', async () => {
  const { view, dispose } = await createOpenView({ progressiveTextRendering: false }, manyParagraphMarkdown(150));
  try {
    await waitFor(() => assert.equal(view.elPreviewContent.querySelectorAll('p').length, 150));
    const firstChunk = view.elPreviewContent.querySelector('.mdzip-chunk');
    // Simulates a user-driven DOM mutation this render pipeline never touches
    // itself, e.g. a manually-collapsed <details> front-matter panel.
    firstChunk.setAttribute('data-user-collapsed', 'true');

    const text = view.workspace.snapshot().currentText;
    view.workspace.editText(text.replace('Paragraph number 149 ', 'Paragraph number 149 EDITED '));
    await waitFor(() => assert.match(view.elPreviewContent.textContent, /149 EDITED/));

    assert.equal(
      view.elPreviewContent.querySelector('.mdzip-chunk').getAttribute('data-user-collapsed'),
      'true',
      'the manual mutation on the untouched chunk survives'
    );
  } finally {
    dispose();
  }
});

test('reconciliation: an edit that changes total chunk count reconciles without throwing and preserves unaffected chunks', async () => {
  const { view, dispose } = await createOpenView({ progressiveTextRendering: false }, manyParagraphMarkdown(150));
  try {
    await waitFor(() => assert.equal(view.elPreviewContent.querySelectorAll('p').length, 150));
    const chunkCountBefore = view.elPreviewContent.querySelectorAll('.mdzip-chunk').length;
    const firstChunkBefore = view.elPreviewContent.querySelector('.mdzip-chunk');

    // Append enough distinctly-worded new content at the very end (text that
    // can't coincidentally collide with the existing "Paragraph number N"
    // template) to push the total chunk count up — the entire original
    // document is now the matched prefix, and everything appended is new.
    const text = view.workspace.snapshot().currentText;
    let appended = '';
    for (let i = 0; i < 60; i += 1) {
      appended += `Appended note ${i} with unrelated filler content of its own.\n\n`;
    }
    view.workspace.editText(text + appended);

    // More chunks than the initial-mount tests above (210 paragraphs across
    // several eager batches, each yielding a real animation frame) — needs
    // more retries than the default to give those frames time to fire.
    await waitFor(() => assert.equal(view.elPreviewContent.querySelectorAll('p').length, 210), 200);
    const chunkCountAfter = view.elPreviewContent.querySelectorAll('.mdzip-chunk').length;
    assert.ok(chunkCountAfter > chunkCountBefore, 'sanity: the document now has more chunks');
    assert.strictEqual(
      view.elPreviewContent.querySelector('.mdzip-chunk'),
      firstChunkBefore,
      'the untouched leading chunk survives even though the chunk count changed'
    );
    assert.match(view.elPreviewContent.textContent, /Appended note 59/, 'the newly appended tail is present');
  } finally {
    dispose();
  }
});

test('reconciliation: a mid-lazy-load edit entirely within the unmounted tail causes zero DOM mutation in the mounted prefix', async () => {
  const { view, dispose } = await createOpenView({}, manyParagraphMarkdown(800));
  try {
    await waitFor(() => assert.ok(view.elPreviewContent.querySelector('.mdzip-chunk')));
    assert.ok(view.elPreviewContent.querySelector('.mdzip-chunk-sentinel'), 'sanity: still lazily loading');
    assert.ok(
      view.chunkedRenderState.cursor < view.chunkedRenderState.records.length,
      'sanity: most of the document is still unmounted'
    );

    const mountedChunksBefore = [...view.elPreviewContent.querySelectorAll('.mdzip-chunk')];
    assert.ok(mountedChunksBefore.length > 0);

    // Paragraph 799 is the very last one — guaranteed to be far beyond the
    // initial synchronous batch for an 800-paragraph document.
    const text = view.workspace.snapshot().currentText;
    view.workspace.editText(text.replace('Paragraph number 799 ', 'Paragraph number 799 EDITED '));
    await flushMicrotasks();
    await flushMicrotasks();

    const mountedChunksAfter = [...view.elPreviewContent.querySelectorAll('.mdzip-chunk')];
    assert.equal(mountedChunksAfter.length, mountedChunksBefore.length, 'no new chunk mounted synchronously for an edit beyond the cursor');
    for (let i = 0; i < mountedChunksBefore.length; i += 1) {
      assert.strictEqual(mountedChunksAfter[i], mountedChunksBefore[i], `mounted chunk ${i} is untouched`);
    }

    // The sentinel keeps working correctly afterward.
    await drainAllChunks(view);
    assert.match(view.elPreviewContent.textContent, /799 EDITED/);
    assert.equal(view.elPreviewContent.querySelectorAll('p').length, 800);
  } finally {
    dispose();
  }
});

test('reconciliation: a colorScheme change still fully remounts, not reconciles', async () => {
  const { view, dispose } = await createOpenView({ progressiveTextRendering: false, initialColorScheme: 'light' }, manyParagraphMarkdown(150));
  try {
    await waitFor(() => assert.equal(view.elPreviewContent.querySelectorAll('p').length, 150));
    const firstChunkBefore = view.elPreviewContent.querySelector('.mdzip-chunk');

    view.setColorScheme('dark');
    await waitFor(() => assert.equal(view.elPreviewContent.querySelectorAll('p').length, 150));

    assert.notStrictEqual(
      view.elPreviewContent.querySelector('.mdzip-chunk'),
      firstChunkBefore,
      'a colorScheme change is not a same-document text edit — everything is torn down and rebuilt, same as before this fix'
    );
  } finally {
    dispose();
  }
});

test('reconciliation: setImageHydrationAnimation still fully remounts, not reconciles', async () => {
  const { view, dispose } = await createOpenView({ progressiveTextRendering: false, imageHydrationAnimation: 'auto' }, manyParagraphMarkdown(150));
  try {
    await waitFor(() => assert.equal(view.elPreviewContent.querySelectorAll('p').length, 150));
    const firstChunkBefore = view.elPreviewContent.querySelector('.mdzip-chunk');

    view.setImageHydrationAnimation('off');
    await waitFor(() => assert.equal(view.elPreviewContent.querySelectorAll('p').length, 150));

    assert.notStrictEqual(
      view.elPreviewContent.querySelector('.mdzip-chunk'),
      firstChunkBefore,
      'an explicit rendering-option change still forces a full reset'
    );
  } finally {
    dispose();
  }
});

// --- Concurrent renders (an edit landing while a previous batch mount is
// still in flight) must never leave orphaned/duplicate DOM behind. Uses a
// real setTimeout-based delay in transformHtml (not just a resolved-promise
// microtask) so the mount genuinely spans a macrotask boundary — the same
// condition needed for a real keystroke to land mid-mount in a browser.
function delayedExtension(ms) {
  return {
    name: 'delay',
    transformHtml: (html) => new Promise((resolve) => setTimeout(() => resolve(html), ms))
  };
}

test('reconciliation: an edit landing while the initial (cold-start) mount is still in flight does not duplicate content', async () => {
  const { view, dispose } = await createOpenView(
    { progressiveTextRendering: false, markdownExtensions: [delayedExtension(15)] },
    manyParagraphMarkdown(60)
  );
  try {
    // Fire the edit immediately — createOpenView's own render() already
    // kicked off the cold-start mount, which cannot have finished yet (each
    // chunk's transformHtml takes 15ms and there are several chunks).
    assert.ok(view.chunkedRenderState?.mounting, 'sanity: the cold-start mount is genuinely still in flight');
    const text = view.workspace.snapshot().currentText;
    view.workspace.editText(text.replace('Paragraph number 59 ', 'Paragraph number 59 EDITED '));

    // Generous, real-time-yielding wait budget: falling back to a full
    // reset (this scenario is by construction not reconcile-eligible) means
    // re-mounting every chunk from scratch, each paying the delayed
    // extension's cost again.
    await waitFor(() => assert.match(view.elPreviewContent.textContent, /59 EDITED/), 1000);
    await waitFor(() => assert.equal(view.chunkedRenderState?.mounting, false), 1000);

    const paragraphs = [...view.elPreviewContent.querySelectorAll('p')].map((p) => p.textContent);
    assert.equal(paragraphs.length, 60, 'no duplicated or missing paragraphs after the race');
    assert.equal(new Set(paragraphs).size, 60, 'every paragraph is unique — none duplicated');
  } finally {
    dispose();
  }
});

test('reconciliation: a second edit landing while the first reconciliation is still mounting its middle range does not duplicate content', async () => {
  const { view, dispose } = await createOpenView(
    { progressiveTextRendering: false, markdownExtensions: [delayedExtension(15)] },
    manyParagraphMarkdown(60)
  );
  try {
    await waitFor(() => assert.equal(view.chunkedRenderState?.mounting, false), 1000);
    await waitFor(() => assert.equal(view.elPreviewContent.querySelectorAll('p').length, 60));

    const text1 = view.workspace.snapshot().currentText;
    view.workspace.editText(text1.replace('Paragraph number 59 ', 'Paragraph number 59 FIRST '));
    // Land a second, different edit while the first edit's reconciliation
    // (its replacement middle chunk, delayed 15ms by transformHtml) is
    // still mounting.
    assert.ok(view.chunkedRenderState?.mounting, 'sanity: the first edit\'s reconciliation is genuinely still in flight');
    const text2 = view.workspace.snapshot().currentText;
    view.workspace.editText(text2.replace('Paragraph number 0 ', 'Paragraph number 0 SECOND '));

    await waitFor(() => assert.match(view.elPreviewContent.textContent, /0 SECOND/), 1000);
    await waitFor(() => assert.equal(view.chunkedRenderState?.mounting, false), 1000);

    const paragraphs = [...view.elPreviewContent.querySelectorAll('p')].map((p) => p.textContent);
    assert.equal(paragraphs.length, 60, 'no duplicated or missing paragraphs after the race');
    assert.equal(new Set(paragraphs).size, 60, 'every paragraph is unique — none duplicated');
    // Workspace text (the source of truth) already reflects both edits by
    // the time the second one fires, and the second edit's full reset (the
    // `mounting` guard makes it ineligible to reconcile) renders that
    // combined text fresh — both edits should show up correctly, not just
    // whichever one happened to "win" a race.
    assert.match(view.elPreviewContent.textContent, /59 FIRST/, 'the first edit is preserved');
    assert.match(view.elPreviewContent.textContent, /0 SECOND/, 'the second edit is applied');
  } finally {
    dispose();
  }
});
