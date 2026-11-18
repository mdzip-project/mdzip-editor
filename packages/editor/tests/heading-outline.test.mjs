import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Outline panel (#64): the module on its own, then inside the workspace view.
if (typeof globalThis.window === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    pretendToBeVisual: true,
    url: 'https://example.test/doc.html'
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

class FakeIntersectionObserver {
  constructor(callback) { this.callback = callback; }
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.window.IntersectionObserver = FakeIntersectionObserver;

const {
  MdzipWorkspaceView,
  collectMdzipOutlineHeadings,
  createMdzipHeadingOutline
} = await import('../dist/index.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
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

// jsdom has no layout: each element reports a top from a table the test controls.
function fakeLayout() {
  const tops = new Map();
  const original = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function rect() {
    const value = tops.has(this) ? tops.get(this) : tops.has(this.id) ? tops.get(this.id) : 0;
    // A function gives a position that follows the scroll, as real layout does.
    const top = typeof value === 'function' ? value() : value;
    return { top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20 };
  };
  return {
    set: (key, top) => tops.set(key, top),
    restore: () => { window.HTMLElement.prototype.getBoundingClientRect = original; }
  };
}

function setup(html) {
  const content = document.createElement('article');
  content.innerHTML = html;
  const container = document.createElement('aside');
  document.body.append(content, container);
  return { content, container, cleanup: () => { content.remove(); container.remove(); } };
}

const itemTree = (list) => [...list.querySelectorAll(':scope > li')].map((item) => {
  const text = item.querySelector(':scope > a').textContent;
  const sub = item.querySelector(':scope > ol');
  return sub ? [text, itemTree(sub)] : text;
});

// --- The module ---------------------------------------------------------------

test('collect lists the chosen levels in order and gives headings without an id one', () => {
  const { content, cleanup } = setup('<h1>Title</h1><h2 id="kept">Kept</h2><h2>Café  Menu</h2><h3>Café Menu</h3><h2>   </h2><h4>Deep</h4><p id="cafe-menu"></p>');
  try {
    const headings = collectMdzipOutlineHeadings(content);
    assert.deepEqual(headings.map(({ id, text, level }) => ({ id, text, level })), [
      { id: 'kept', text: 'Kept', level: 2 },
      { id: 'café-menu', text: 'Café Menu', level: 2 },
      { id: 'café-menu-1', text: 'Café Menu', level: 3 }
    ]);
    assert.equal(content.querySelector('h3').id, 'café-menu-1');
    assert.equal(collectMdzipOutlineHeadings(content, { levels: [1, 4] }).map((h) => h.text).join(','), 'Title,Deep');
  } finally {
    cleanup();
  }
});

test('create nests headings by level, labels the nav and links to each heading', () => {
  const { content, container, cleanup } = setup('<h2>A</h2><h3>A1</h3><h3>A2</h3><h2>B</h2><h3>B1</h3><h2>C</h2>');
  const outline = createMdzipHeadingOutline({ content, container, label: 'Contents' });
  try {
    const nav = container.querySelector('nav.mdz-outline');
    assert.equal(nav.getAttribute('aria-label'), 'Contents');
    assert.equal(nav.querySelector('.mdz-outline-title').textContent, 'Contents');
    assert.ok(nav.classList.contains('is-collapsible'));
    assert.deepEqual(itemTree(nav.querySelector(':scope > ol')), [['A', ['A1', 'A2']], ['B', ['B1']], 'C']);
    assert.equal(nav.querySelector('a').getAttribute('href'), 'https://example.test/doc.html#a');
    assert.equal(nav.querySelector('li li').dataset.level, '3');
    assert.equal(outline.headings.length, 6);
  } finally {
    outline.destroy();
    cleanup();
  }
});

test('the current section is the last heading above the reading line, in a scrolling pane', async () => {
  const layout = fakeLayout();
  const { content, container, cleanup } = setup('<h2>A</h2><h3>A1</h3><h2>B</h2><h3>B1</h3>');
  const pane = document.createElement('div');
  document.body.append(pane);
  layout.set(pane, 100);
  const [a, a1, b, b1] = content.querySelectorAll('h2,h3');
  const place = (tops) => [a, a1, b, b1].forEach((element, i) => layout.set(element, tops[i]));
  place([110, 400, 900, 1300]);
  const outline = createMdzipHeadingOutline({ content, container, scrollContainer: pane, offset: 50 });
  try {
    assert.equal(outline.current.text, 'A');
    const currentLink = () => container.querySelector('[aria-current="location"]');
    assert.equal(currentLink().textContent, 'A');

    place([-800, -400, 120, 600]);
    pane.dispatchEvent(new window.Event('scroll'));
    await frame();
    assert.equal(currentLink().textContent, 'B');
    assert.ok(currentLink().classList.contains('is-current'));
    const open = [...container.querySelectorAll('.is-open > a')].map((link) => link.textContent);
    assert.deepEqual(open, ['B'], 'only the current section is open');

    place([-900, -500, -100, 140]);
    outline.update();
    assert.equal(currentLink().textContent, 'B1');
    assert.deepEqual([...container.querySelectorAll('.is-open > a')].map((link) => link.textContent), ['B', 'B1']);
  } finally {
    outline.destroy();
    layout.restore();
    pane.remove();
    cleanup();
  }
});

test('a click in a scrolling pane scrolls the heading into view; onNavigate can take over', () => {
  const { content, container, cleanup } = setup('<h2>A</h2><h2>B</h2>');
  const pane = document.createElement('div');
  const scrolled = [];
  content.querySelectorAll('h2').forEach((h) => { h.scrollIntoView = () => scrolled.push(h.textContent); });
  let outline = createMdzipHeadingOutline({ content, container, scrollContainer: pane });
  try {
    const click = () => container.querySelectorAll('a')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(click(), false, 'the page does not jump');
    assert.deepEqual(scrolled, ['B']);
    assert.equal(outline.current.text, 'B');

    outline.destroy();
    const navigated = [];
    outline = createMdzipHeadingOutline({
      content, container, scrollContainer: pane,
      onNavigate: (heading, event) => { navigated.push(heading.id); event.preventDefault(); }
    });
    click();
    assert.deepEqual(navigated, ['b']);
    assert.deepEqual(scrolled, ['B'], 'onNavigate scrolled instead');
  } finally {
    outline.destroy();
    cleanup();
  }
});

test('refresh picks up new headings; an outline without headings hides; destroy clears it', () => {
  const { content, container, cleanup } = setup('<p>No headings</p>');
  const outline = createMdzipHeadingOutline({ content, container });
  try {
    assert.equal(container.hidden, true);
    content.innerHTML = '<h2>Now</h2>';
    outline.refresh();
    assert.equal(container.hidden, false);
    assert.equal(container.querySelector('a').textContent, 'Now');
    outline.destroy();
    assert.equal(container.textContent, '');
    assert.equal(container.hidden, true);
  } finally {
    cleanup();
  }
});

test('supplied headings may lack elements; the current section stops at the first one', () => {
  const layout = fakeLayout();
  const { content, container, cleanup } = setup('<h2 id="a">A</h2>');
  layout.set('a', -50);
  const outline = createMdzipHeadingOutline({
    content, container,
    headings: () => [
      { id: 'a', text: 'A', level: 2, element: null },
      { id: 'z', text: 'Z', level: 2, element: null }
    ],
    findElement: (heading) => content.querySelector(`#${heading.id}`)
  });
  try {
    assert.equal(outline.current.id, 'a');
    const link = container.querySelectorAll('a')[1];
    const notPrevented = link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(notPrevented, false, 'no element to scroll to, so no page jump either');
  } finally {
    outline.destroy();
    layout.restore();
    cleanup();
  }
});

// --- In the workspace view ------------------------------------------------------

async function mountView(source, options = {}) {
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
  const q = (ref) => container.querySelector(`[data-ref="${ref}"]`);
  return {
    view,
    container,
    pane: q('outline-pane'),
    button: q('outline-btn'),
    previewPane: q('preview-pane'),
    previewContent: q('preview-content'),
    texts: () => [...q('outline-pane').querySelectorAll('.mdz-outline-link')].map((link) => link.textContent),
    cleanup() {
      view.destroy();
      container.remove();
    }
  };
}

test('outline: true opens the panel with the document\'s headings (levels 1-3 by default)', async () => {
  const { container, pane, button, texts, cleanup } = await mountView(
    '# Guide\n\n## Install `mdz`\n\n### Windows\n\n#### Too deep\n\n## Use\n\nText[^1]\n\n[^1]: Note.\n',
    { outline: true }
  );
  try {
    assert.equal(pane.hidden, false);
    assert.ok(container.querySelector('.mdzip-root').classList.contains('outline-pane-visible'));
    assert.deepEqual(texts(), ['Guide', 'Install mdz', 'Windows', 'Use'], 'no h4, and not the footnotes label');
    assert.equal(pane.querySelector('nav').getAttribute('aria-label'), 'Outline');
    assert.equal(button.hidden, false);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
  } finally {
    cleanup();
  }
});

test('the toolbar button toggles the panel and reports it; source layout hides both', async () => {
  const changes = [];
  const { view, pane, button, texts, cleanup } = await mountView('## A\n\n## B\n', {
    onOutlineVisibilityChanged: (visible) => changes.push(visible)
  });
  try {
    assert.equal(pane.hidden, true, 'closed by default');
    assert.equal(view.isOutlineVisible, false);
    button.click();
    assert.equal(pane.hidden, false);
    assert.deepEqual(texts(), ['A', 'B']);
    button.click();
    assert.equal(pane.hidden, true);
    assert.deepEqual(changes, [true, false]);

    view.setOutlineVisible(true);
    assert.equal(pane.hidden, false);
    assert.deepEqual(changes, [true, false], 'setOutlineVisible does not report');
    const root = pane.closest('.mdzip-root');
    root.querySelector('[data-ref="source-btn"]').click();
    await waitFor(() => {
      assert.equal(pane.hidden, true);
      assert.equal(button.hidden, true);
    });
    root.querySelector('[data-ref="split-btn"]').click();
    await waitFor(() => assert.equal(pane.hidden, false));
  } finally {
    cleanup();
  }
});

test('controls.outline: false hides the button but the host can still open the panel', async () => {
  const { pane, button, cleanup } = await mountView('## A\n', {
    controls: { preset: 'standalone-editor', outline: false },
    outline: { visible: true, levels: [2], label: 'On this page', collapse: false }
  });
  try {
    assert.equal(button.hidden, true);
    assert.equal(pane.hidden, false);
    assert.equal(pane.querySelector('nav').getAttribute('aria-label'), 'On this page');
    assert.equal(pane.querySelector('nav').classList.contains('is-collapsible'), false);
  } finally {
    cleanup();
  }
});

test('the outline follows edits to the document', async () => {
  const { view, texts, cleanup } = await mountView('## A\n', { outline: true });
  try {
    view.workspace.editText('## A\n\n## Added\n');
    await waitFor(() => assert.deepEqual(texts(), ['A', 'Added']));
  } finally {
    cleanup();
  }
});

test('with progressive rendering the outline lists unmounted headings, and a click mounts and glides to one', async () => {
  let source = '# Top\n\n';
  for (let i = 0; i < 800; i += 1) {
    source += `Paragraph number ${i} with a little padding text so each block has real weight.\n\n`;
  }
  source += '## Last Section\n\nThe end.\n';
  const { view, pane, previewPane, previewContent, texts, cleanup } = await mountView(source, {
    outline: true,
    progressiveTextRendering: true
  });
  const layout = fakeLayout();
  let scrollTop = 0;
  const visited = [];
  Object.defineProperty(previewPane, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v) => { scrollTop = v; visited.push(v); } });
  try {
    const state = view.chunkedRenderState;
    assert.ok(state && state.cursor < state.records.length, 'sanity: the tail is unmounted');
    assert.deepEqual(texts(), ['Top', 'Last Section']);

    layout.set('user-content-last-section', () => 9000 - scrollTop);
    const link = [...pane.querySelectorAll('a')].find((a) => a.textContent === 'Last Section');
    link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await waitFor(() => {
      assert.ok(previewContent.querySelector('#user-content-last-section'), 'target chunk got mounted');
      assert.equal(Math.round(scrollTop), 9000);
    });
    assert.ok(visited.some((top) => top > 100 && top < 8900), 'it scrolls through the way there, not in one jump');
    assert.ok(link.classList.contains('is-current'));
  } finally {
    layout.restore();
    cleanup();
  }
});
