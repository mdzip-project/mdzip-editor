import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Same DOM bootstrap pattern as rendering-extensibility.test.mjs / preview-chunking.test.mjs.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = new JSDOM('<!doctype html><html><body></body></html>').window;
}
globalThis.document = globalThis.window.document;
globalThis.HTMLElement = globalThis.window.HTMLElement;
globalThis.Node = globalThis.window.Node;

class FakeIntersectionObserver {
  static instances = [];
  constructor(callback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  trigger(target) {
    this.callback([{ target, isIntersecting: true }], this);
  }
}
globalThis.window.IntersectionObserver = FakeIntersectionObserver;

import {
  MdzipWorkspaceService,
  MdzipWorkspaceView,
  buildNewArchiveBytesWithTitle,
  parseFrontMatter
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

function drainAllSentinels(view) {
  return (async () => {
    for (let guard = 0; guard < 400; guard += 1) {
      const sentinel = view.elPreviewContent.querySelector('.mdzip-chunk-sentinel');
      if (!sentinel) break;
      const observer = FakeIntersectionObserver.instances.at(-1);
      observer.trigger(sentinel);
      await flushMicrotasks();
    }
    await waitFor(() => assert.equal(view.elPreviewContent.querySelector('.mdzip-chunk-sentinel'), null));
  })();
}

function manyParagraphMarkdownWithFrontMatter(count) {
  let markdown = '---\ntitle: Big Doc\ntags:\n  - alpha\n  - beta\n---\n# Large document\n\n';
  for (let i = 0; i < count; i += 1) {
    markdown += `Paragraph number ${i} with a little padding text so each block has real weight.\n\n`;
  }
  return markdown;
}

test('table display (default) renders a collapsible front matter panel and strips the raw block', async () => {
  const markdown = '---\ntitle: My Doc\ndraft: true\n---\n# Heading\n\nBody text.\n';
  const { view, dispose } = await createOpenView({}, markdown);
  try {
    await waitFor(() => assert.match(view.elPreviewContent.innerHTML, /Body text/));
    const html = view.elPreviewContent.innerHTML;
    assert.match(html, /<details class="mdzip-frontmatter"/);
    assert.match(html, /Front matter/, 'default label');
    assert.match(html, /My Doc/);
    assert.match(html, /draft/);
    assert.match(html, /true/);
    assert.doesNotMatch(html, /^\s*<hr/, 'no stray <hr> from an unparsed --- block');
    assert.equal(html.indexOf('mdzip-frontmatter') < html.indexOf('<h1'), true, 'panel renders above the body');
  } finally {
    dispose();
  }
});

test('enabled: false strips front matter without rendering a panel', async () => {
  const markdown = '---\ntitle: My Doc\n---\n# Heading\n\nBody text.\n';
  const { view, dispose } = await createOpenView({ frontMatter: { enabled: false } }, markdown);
  try {
    await waitFor(() => assert.match(view.elPreviewContent.innerHTML, /Body text/));
    const html = view.elPreviewContent.innerHTML;
    assert.doesNotMatch(html, /mdzip-frontmatter/);
    assert.doesNotMatch(html, /title: My Doc/);
  } finally {
    dispose();
  }
});

test("display: 'raw' renders the block as a fenced yaml code block", async () => {
  const markdown = '---\ntitle: My Doc\n---\n# Heading\n\nBody text.\n';
  const { view, dispose } = await createOpenView({ frontMatter: { display: 'raw' } }, markdown);
  try {
    await waitFor(() => assert.match(view.elPreviewContent.innerHTML, /Body text/));
    const html = view.elPreviewContent.innerHTML;
    assert.match(html, /class="mdzip-frontmatter"/, 'still wrapped in the panel/expander');
    assert.match(html, /language-yaml/);
    assert.match(html, /title/);
    assert.doesNotMatch(html, /mdzip-frontmatter-table/);
  } finally {
    dispose();
  }
});

test('collapsible: false renders a static block instead of a <details>', async () => {
  const markdown = '---\ntitle: My Doc\n---\nBody text.\n';
  const { view, dispose } = await createOpenView({ frontMatter: { collapsible: false } }, markdown);
  try {
    await waitFor(() => assert.match(view.elPreviewContent.innerHTML, /Body text/));
    assert.equal(view.elPreviewContent.querySelector('details.mdzip-frontmatter'), null, 'no <details> element');
    const block = view.elPreviewContent.querySelector('div.mdzip-frontmatter.mdzip-frontmatter-static');
    assert.ok(block, 'static <div> wrapper is present');
    assert.match(block.innerHTML, /My Doc/);
  } finally {
    dispose();
  }
});

test('label: a custom string overrides the default header text', async () => {
  const markdown = '---\ntitle: My Doc\n---\nBody text.\n';
  const { view, dispose } = await createOpenView({ frontMatter: { label: 'Metadata' } }, markdown);
  try {
    await waitFor(() => assert.match(view.elPreviewContent.innerHTML, /Body text/));
    const summary = view.elPreviewContent.querySelector('.mdzip-frontmatter-summary');
    assert.equal(summary.textContent, 'Metadata');
  } finally {
    dispose();
  }
});

test("label: 'first-line' uses the front matter block's own first raw line", async () => {
  const markdown = '---\ntitle: My Doc\ndraft: true\n---\nBody text.\n';
  const { view, dispose } = await createOpenView({ frontMatter: { label: 'first-line' } }, markdown);
  try {
    await waitFor(() => assert.match(view.elPreviewContent.innerHTML, /Body text/));
    const summary = view.elPreviewContent.querySelector('.mdzip-frontmatter-summary');
    assert.equal(summary.textContent, 'title: My Doc');
  } finally {
    dispose();
  }
});

test("label: 'first-line' falls back to the default label when the block's first line is blank", async () => {
  // A blank line before the first real key means the raw block's first
  // *line* is empty even though its parsed data is not.
  const markdown = '---\n\ntitle: My Doc\n---\nBody text.\n';
  const { view, dispose } = await createOpenView({ frontMatter: { label: 'first-line' } }, markdown);
  try {
    await waitFor(() => assert.match(view.elPreviewContent.innerHTML, /Body text/));
    const summary = view.elPreviewContent.querySelector('.mdzip-frontmatter-summary');
    assert.equal(summary.textContent, 'Front matter');
  } finally {
    dispose();
  }
});

test('a first-line label is HTML-escaped', async () => {
  const markdown = '---\ntitle: "<script>alert(1)</script>"\n---\nBody text.\n';
  const { view, dispose } = await createOpenView({ frontMatter: { label: 'first-line' } }, markdown);
  try {
    await waitFor(() => assert.match(view.elPreviewContent.innerHTML, /Body text/));
    const summary = view.elPreviewContent.querySelector('.mdzip-frontmatter-summary');
    assert.equal(view.elPreviewContent.querySelector('.mdzip-frontmatter-summary script'), null);
    assert.match(summary.textContent, /<script>/, 'renders as literal text, not markup');
  } finally {
    dispose();
  }
});

test('a document with no front matter renders unaffected', async () => {
  const markdown = '# Heading\n\nBody text.\n';
  const { view, dispose } = await createOpenView({}, markdown);
  try {
    await waitFor(() => assert.match(view.elPreviewContent.innerHTML, /Body text/));
    assert.doesNotMatch(view.elPreviewContent.innerHTML, /mdzip-frontmatter/);
  } finally {
    dispose();
  }
});

test('front matter values are escaped, not injected as markup', async () => {
  const markdown = '---\ntitle: "<img src=x onerror=alert(1)>"\n---\nBody.\n';
  const { view, dispose } = await createOpenView({}, markdown);
  try {
    await waitFor(() => assert.match(view.elPreviewContent.innerHTML, /Body\./));
    const html = view.elPreviewContent.innerHTML;
    assert.equal(view.elPreviewContent.querySelector('img[src="x"]'), null, 'no live <img> tag from the front matter value');
    assert.match(html, /&lt;img/, 'the value is escaped text, not markup');
  } finally {
    dispose();
  }
});

test('chunked rendering: the panel appears exactly once, in the first chunk', async () => {
  const { view, dispose } = await createOpenView(
    { progressiveTextRendering: true },
    manyParagraphMarkdownWithFrontMatter(150)
  );
  try {
    await waitFor(() => assert.ok(view.elPreviewContent.querySelector('.mdzip-chunk')));
    // Panel is already in the first-mounted batch.
    const firstChunk = view.elPreviewContent.querySelector('.mdzip-chunk');
    assert.ok(firstChunk.querySelector('.mdzip-frontmatter'), 'panel is in the first chunk');
    assert.equal(view.elPreviewContent.querySelectorAll('.mdzip-frontmatter').length, 1);

    await drainAllSentinels(view);

    assert.equal(
      view.elPreviewContent.querySelectorAll('.mdzip-frontmatter').length,
      1,
      'still exactly one panel after every later chunk has mounted'
    );
    assert.equal(view.elPreviewContent.querySelectorAll('p').length, 150, 'every paragraph still mounts');
  } finally {
    dispose();
  }
});

test('chunked and whole-document rendering agree: one panel, same paragraph count, same key/value content', async () => {
  const markdown = manyParagraphMarkdownWithFrontMatter(150);

  const chunked = await createOpenView({ progressiveTextRendering: true }, markdown);
  await waitFor(() => assert.ok(chunked.view.elPreviewContent.querySelector('.mdzip-chunk')));
  await drainAllSentinels(chunked.view);

  const whole = await createOpenView({ progressiveTextRendering: false }, markdown);
  try {
    await waitFor(() => assert.equal(whole.view.elPreviewContent.querySelectorAll('p').length, 150));

    assert.equal(chunked.view.elPreviewContent.querySelectorAll('.mdzip-frontmatter').length, 1);
    assert.equal(whole.view.elPreviewContent.querySelectorAll('.mdzip-frontmatter').length, 1);
    assert.equal(
      chunked.view.elPreviewContent.querySelectorAll('p').length,
      whole.view.elPreviewContent.querySelectorAll('p').length
    );
    assert.equal(
      chunked.view.elPreviewContent.querySelector('.mdzip-frontmatter-table').textContent,
      whole.view.elPreviewContent.querySelector('.mdzip-frontmatter-table').textContent
    );
  } finally {
    chunked.dispose();
    whole.dispose();
  }
});

test('setRenderingOptions can switch front matter options at runtime', async () => {
  const markdown = '---\ntitle: My Doc\n---\nBody.\n';
  const { view, dispose } = await createOpenView({}, markdown);
  try {
    await waitFor(() => assert.match(view.elPreviewContent.innerHTML, /mdzip-frontmatter/));

    view.setRenderingOptions({ frontMatter: { enabled: false } });
    await waitFor(() => assert.doesNotMatch(view.elPreviewContent.innerHTML, /mdzip-frontmatter/));

    view.setRenderingOptions({ frontMatter: { collapsible: false, label: 'Metadata' } });
    await waitFor(() => assert.ok(view.elPreviewContent.querySelector('div.mdzip-frontmatter-static')));
    assert.equal(view.elPreviewContent.querySelector('.mdzip-frontmatter-summary').textContent, 'Metadata');
  } finally {
    dispose();
  }
});

test('suggestedTitle picks up a manifest-less markdown doc\'s front matter title', async () => {
  const markdown = '---\ntitle: From Front Matter\n---\n# Different Heading\n\nBody.\n';
  const workspace = await MdzipWorkspaceService.open(
    new TextEncoder().encode(markdown),
    { mode: 'editable', sourceFormat: 'markdown', fileName: 'note.md' }
  );
  try {
    const snapshot = workspace.snapshot();
    assert.equal(snapshot.suggestedTitle, 'From Front Matter');
  } finally {
    workspace.dispose();
  }
});

test('parseFrontMatter is exported from the package root', () => {
  const result = parseFrontMatter('---\ntitle: Hi\n---\nBody');
  assert.deepEqual(result.data, { title: 'Hi' });
});
