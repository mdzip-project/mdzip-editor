import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Same jsdom bootstrap as preview-copy-all.test.mjs / link-navigation.test.mjs.
if (typeof globalThis.window === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; }
  });
  globalThis.window = window;
  globalThis.Window = window.Window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.URL.createObjectURL = () => 'blob:test';
  globalThis.URL.revokeObjectURL = () => {};
}

// jsdom has no IntersectionObserver — install an inert one so progressive
// rendering arms its lazy-continuation sentinel but never fires it on its own;
// anything past the first batch stays unmounted until something drains it.
class FakeIntersectionObserver {
  constructor(callback) { this.callback = callback; }
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.window.IntersectionObserver = FakeIntersectionObserver;

import {
  MdzipRenderingService,
  MdzipWorkspaceView,
  assignMdzipHeadingIds,
  chunkSourceKey,
  defaultSafeMarkdownRenderer,
  groupTokensIntoChunks,
  slugifyMdzipHeading
} from '../dist/index.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(assertion, attempts = 100) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await wait(10);
    }
  }
  throw lastError;
}

function idsIn(html) {
  return [...html.matchAll(/<h[1-6] id="([^"]+)"/g)].map((match) => match[1]);
}

// --- Slugs and rendered ids -------------------------------------------------

test('slugifyMdzipHeading follows GitHub-style slugs', () => {
  assert.equal(slugifyMdzipHeading('Skywalker Family Tree'), 'skywalker-family-tree');
  assert.equal(slugifyMdzipHeading("What's new? (v2.0)"), 'whats-new-v20');
  assert.equal(slugifyMdzipHeading('snake_case & kebab-case'), 'snake_case--kebab-case');
  assert.equal(slugifyMdzipHeading('Über Café 日本語'), 'über-café-日本語');
  assert.equal(slugifyMdzipHeading('!!!'), '');
});

test('headings render with prefixed slug ids, disambiguating repeats', () => {
  const html = defaultSafeMarkdownRenderer.render('## Intro\n\n## Intro\n\n## Intro\n\n## Intro 1\n');
  assert.deepEqual(idsIn(html), [
    'user-content-intro',
    'user-content-intro-1',
    'user-content-intro-2',
    'user-content-intro-1-1'
  ]);
});

test('heading ids come from the rendered text, not the markdown syntax or entities', () => {
  const html = defaultSafeMarkdownRenderer.render('## Q&A *about* `code` [links](https://example.com)\n');
  assert.deepEqual(idsIn(html), ['user-content-qa-about-code-links']);
});

test('headings nested in blockquotes and lists get ids too; punctuation-only headings get none', () => {
  const html = defaultSafeMarkdownRenderer.render('> ### Quoted\n\n- ## Listed\n\n## ???\n');
  assert.deepEqual(idsIn(html), ['user-content-quoted', 'user-content-listed']);
  assert.match(html, /<h2>\?\?\?<\/h2>/);
});

test('headings named like document properties keep their anchor instead of being stripped', () => {
  // DOMPurify drops an id equal to a document/form property (images, links,
  // title, location...) — the user-content- prefix is what keeps these alive.
  const html = defaultSafeMarkdownRenderer.render('## Images\n\n## Links\n\n## Title\n\n## Location\n');
  assert.deepEqual(idsIn(html), [
    'user-content-images',
    'user-content-links',
    'user-content-title',
    'user-content-location'
  ]);
});

// --- Chunked rendering ------------------------------------------------------

function renderContext() {
  return {
    currentPath: 'index.md',
    sourceFormat: 'markdown',
    colorScheme: 'light',
    mode: 'editable',
    manifest: null,
    signal: new AbortController().signal
  };
}

test('ids are unique across chunks, matching whole-document rendering', async () => {
  const service = new MdzipRenderingService(defaultSafeMarkdownRenderer, []);
  const context = renderContext();
  const markdown = '## Intro\n\ntext\n\n## Intro\n\ntext\n\n## Intro\n\ntext\n';

  const whole = await service.renderMarkdown(markdown, context);
  const tokens = await service.tokenizeMarkdown(markdown, context);
  const chunks = groupTokensIntoChunks(tokens, { tokenCap: 2 });
  assert.ok(chunks.length >= 3, 'sanity: the repeated headings landed in separate chunks');
  let chunked = '';
  for (const chunk of chunks) {
    chunked += await service.renderChunk(chunk, context);
  }

  assert.deepEqual(idsIn(chunked), idsIn(whole));
  assert.deepEqual(idsIn(chunked), ['user-content-intro', 'user-content-intro-1', 'user-content-intro-2']);
});

test('a chunk whose text is unchanged but whose heading id shifted is not reused', async () => {
  const service = new MdzipRenderingService(defaultSafeMarkdownRenderer, []);
  const context = renderContext();
  const keyFor = async (markdown) => {
    const tokens = await service.tokenizeMarkdown(markdown, context);
    const chunks = groupTokensIntoChunks(tokens, { shouldStartChunk: (t) => t.type === 'heading' });
    return chunkSourceKey(chunks.at(-1));
  };

  const before = await keyFor('## Intro\n\n## Intro\n');
  const after = await keyFor('## Intro\n\n## Intro\n\n## Intro\n');
  assert.notEqual(before, after, 'last "## Intro" is now intro-2, not intro-1');

  // Sanity: with nothing shifted the key is stable.
  assert.equal(await keyFor('## Intro\n\n## Intro\n'), before);
});

test('assignMdzipHeadingIds is idempotent over the same tokens', async () => {
  const service = new MdzipRenderingService(defaultSafeMarkdownRenderer, []);
  const tokens = await service.tokenizeMarkdown('## A\n\n## A\n', renderContext());
  assignMdzipHeadingIds(tokens);
  assignMdzipHeadingIds(tokens);
  assert.deepEqual(tokens.filter((t) => t.type === 'heading').map((t) => t.mdzipAnchorId), ['a', 'a-1']);
});

// --- Clicking #fragment links -------------------------------------------------

async function mountPreview(source, options = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'preview',
    initialColorScheme: 'light',
    ...options
  });
  await view.open(new TextEncoder().encode(source), { mode: 'editable', fileName: 'notes.md' });
  await view.whenRendered();
  const previewPane = container.querySelector('[data-ref="preview-pane"]');
  const previewContent = container.querySelector('[data-ref="preview-content"]');

  // jsdom has no layout: give the pane a settable scrollTop and let each
  // element report a top offset from a table the test controls.
  let scrollTop = 0;
  Object.defineProperty(previewPane, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value) => { scrollTop = value; }
  });
  previewPane.getBoundingClientRect = () => ({ top: 0 });
  const offsets = new Map();
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function rect() {
    return offsets.has(this.id) ? { top: offsets.get(this.id) - scrollTop } : originalRect.call(this);
  };

  return {
    view,
    previewPane,
    previewContent,
    setOffset: (id, top) => offsets.set(id, top),
    cleanup() {
      window.HTMLElement.prototype.getBoundingClientRect = originalRect;
      view.destroy();
      container.remove();
    }
  };
}

function clickLink(previewContent, linkText) {
  const link = [...previewContent.querySelectorAll('a[href]')].find((a) => a.textContent === linkText);
  assert.ok(link, `preview has a link with text "${linkText}"`);
  return link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

test('clicking a #fragment link scrolls the preview to the matching heading', async () => {
  const { previewPane, previewContent, setOffset, cleanup } = await mountPreview(
    '# Top\n\n[Jump](#section-two)\n\n## Section One\n\n## Section Two\n'
  );
  try {
    setOffset('user-content-section-two', 640);
    const notPrevented = clickLink(previewContent, 'Jump');
    await wait(0);

    assert.equal(notPrevented, false, 'the preview owns the click — no browser hash navigation');
    assert.equal(previewPane.scrollTop, 640);
  } finally {
    cleanup();
  }
});

test('#fragment matching ignores case and percent-encoding', async () => {
  const { previewPane, previewContent, setOffset, cleanup } = await mountPreview(
    '[Jump](#Caf%C3%A9-Menu)\n\n## Café Menu\n'
  );
  try {
    setOffset('user-content-café-menu', 300);
    clickLink(previewContent, 'Jump');
    await wait(0);
    assert.equal(previewPane.scrollTop, 300);
  } finally {
    cleanup();
  }
});

test('explicit <a id> anchors written in the source are found too', async () => {
  const { previewPane, previewContent, setOffset, cleanup } = await mountPreview(
    '[Jump](#custom-spot)\n\n<a id="custom-spot"></a>\n\nSome text.\n'
  );
  try {
    setOffset('custom-spot', 220);
    clickLink(previewContent, 'Jump');
    await wait(0);
    assert.equal(previewPane.scrollTop, 220);
  } finally {
    cleanup();
  }
});

test('a #fragment nothing matches is a no-op, and "#" scrolls back to the top', async () => {
  const { previewPane, previewContent, cleanup } = await mountPreview('[Nowhere](#nope)\n\n[Top](#)\n');
  try {
    previewPane.scrollTop = 500;
    clickLink(previewContent, 'Nowhere');
    await wait(0);
    assert.equal(previewPane.scrollTop, 500, 'unmatched fragment leaves the scroll position alone');

    clickLink(previewContent, 'Top');
    await wait(0);
    assert.equal(previewPane.scrollTop, 0);
  } finally {
    cleanup();
  }
});

test('a #fragment pointing into a not-yet-mounted chunk mounts up to it, then scrolls', async () => {
  let source = '# Top\n\n[Jump](#last-section)\n\n';
  for (let i = 0; i < 800; i += 1) {
    source += `Paragraph number ${i} with a little padding text so each block has real weight.\n\n`;
  }
  source += '## Last Section\n\nThe end.\n';

  const { view, previewPane, previewContent, setOffset, cleanup } = await mountPreview(source, {
    progressiveTextRendering: true
  });
  try {
    const state = view.chunkedRenderState;
    assert.ok(state && state.cursor < state.records.length, 'sanity: the tail of the document is unmounted');
    assert.equal(previewContent.querySelector('#user-content-last-section'), null, 'sanity: target heading not in the DOM yet');

    setOffset('user-content-last-section', 9000);
    clickLink(previewContent, 'Jump');

    await waitFor(() => {
      assert.ok(previewContent.querySelector('#user-content-last-section'), 'target chunk got mounted');
      assert.equal(previewPane.scrollTop, 9000);
    });
  } finally {
    cleanup();
  }
});
