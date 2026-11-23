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

test('the toolbar button cycles the panel off, left, right and reports it; source layout hides both', async () => {
  const changes = [];
  const sides = [];
  const { view, pane, button, texts, cleanup } = await mountView('## A\n\n## B\n', {
    onOutlineVisibilityChanged: (visible) => changes.push(visible),
    onOutlinePositionChanged: (position) => sides.push(position)
  });
  const root = pane.closest('.mdzip-root');
  try {
    assert.equal(pane.hidden, true, 'closed by default');
    assert.equal(view.isOutlineVisible, false);
    assert.equal(button.dataset.tooltip, 'Outline: show on the left');
    assert.equal(button.dataset.outlineState, 'off');
    const offIcon = button.innerHTML;
    button.click();
    assert.equal(pane.hidden, false);
    assert.equal(view.outlineSide, 'left');
    assert.equal(button.dataset.outlineState, 'left', 'the icon shows the side');
    const leftIcon = button.innerHTML;
    assert.notEqual(leftIcon, offIcon);
    assert.equal(root.classList.contains('outline-left'), true);
    assert.deepEqual(texts(), ['A', 'B']);
    assert.equal(button.dataset.tooltip, 'Outline: move to the right');
    button.click();
    assert.equal(pane.hidden, false);
    assert.equal(view.outlineSide, 'right');
    assert.equal(root.classList.contains('outline-left'), false);
    assert.equal(button.dataset.tooltip, 'Outline: hide');
    assert.equal(button.dataset.outlineState, 'right');
    assert.notEqual(button.innerHTML, leftIcon);
    assert.ok(button.querySelector('svg'));
    button.click();
    assert.equal(pane.hidden, true);
    assert.equal(button.innerHTML, offIcon);
    assert.equal(view.outlineSide, 'right', 'hiding keeps the side');
    assert.deepEqual(changes, [true, false]);
    assert.deepEqual(sides, ['left', 'right']);

    view.setOutlinePosition('left');
    assert.equal(button.dataset.tooltip, 'Outline: show on the left');
    button.click();
    assert.deepEqual(sides, ['left', 'right'], 'already on the left: no side change to report');
    view.setOutlinePosition('right');
    assert.equal(button.dataset.tooltip, 'Outline: hide', 'setOutlinePosition updates the tooltip');
    button.click();
    assert.deepEqual(changes, [true, false, true, false]);
    assert.deepEqual(sides, ['left', 'right'], 'setOutlinePosition does not report');

    view.setOutlineVisible(true);
    assert.equal(pane.hidden, false);
    assert.deepEqual(changes, [true, false, true, false], 'setOutlineVisible does not report');
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

test('the outline button animates the panel out and in, and quick clicks each take their turn', async () => {
  const proto = window.HTMLElement.prototype;
  const had = Object.prototype.hasOwnProperty.call(proto, 'animate');
  const original = proto.animate;
  const calls = [];
  proto.animate = function (keyframes) {
    calls.push({ ref: this.dataset.ref, from: keyframes[0], to: keyframes[keyframes.length - 1] });
    return { finished: new Promise((resolve) => setTimeout(resolve, 5)), cancel() {} };
  };
  const { view, pane, button, cleanup } = await mountView('## A\n\n## B\n');
  try {
    button.click();
    assert.equal(pane.hidden, false, 'nothing to slide out first: shown at once');
    assert.deepEqual(calls.map((c) => [c.ref, c.from.opacity, c.to.opacity]), [['outline-pane', 0, 1]]);
    assert.match(calls[0].from.transform, /translateX\(-16px\)/, 'comes in from the left');
    await waitFor(() => assert.equal(button.dataset.outlineState, 'left'));

    calls.length = 0;
    button.click(); // to the right
    button.click(); // then hidden, after it
    assert.equal(view.outlineSide, 'left', 'the panel slides out before it moves');
    await waitFor(() => assert.equal(pane.hidden, true));
    assert.equal(view.outlineSide, 'right');
    assert.deepEqual(calls.map((c) => [c.ref, c.from.opacity, c.to.opacity]), [
      ['outline-pane', 1, 0], // out on the left
      ['outline-pane', 0, 1], // in on the right
      ['outline-pane', 1, 0]  // out on the right, and hidden
    ]);
    assert.match(calls[1].from.transform, /translateX\(16px\)/, 'comes in from the right');
  } finally {
    if (had) proto.animate = original; else delete proto.animate;
    cleanup();
  }
});

test('setLayout() switches the layout as the toolbar does; layoutMode says which', async () => {
  const { view, container, cleanup } = await mountView('## A\n', { initialLayout: 'split' });
  const pressed = (ref) => container.querySelector(`[data-ref="${ref}"]`).getAttribute('aria-pressed');
  try {
    assert.equal(view.layoutMode, 'split');
    await view.setLayout('preview');
    assert.equal(view.layoutMode, 'preview');
    assert.equal(pressed('preview-btn'), 'true');
    assert.equal(pressed('split-btn'), 'false');
    await view.setLayout('source');
    assert.equal(view.layoutMode, 'source');
    assert.equal(pressed('source-btn'), 'true');
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

test('the outline goes on the right by default, or on the left; setOutlinePosition moves it', async () => {
  const { view, container, pane, cleanup } = await mountView('## A\n', { outline: { visible: true, position: 'left' } });
  try {
    const root = container.querySelector('.mdzip-root');
    assert.equal(view.outlineSide, 'left');
    assert.ok(root.classList.contains('outline-left'));
    view.setOutlinePosition('right');
    assert.equal(view.outlineSide, 'right');
    assert.equal(root.classList.contains('outline-left'), false);
    assert.equal(pane.hidden, false);
    assert.ok(pane.nextElementSibling.matches('[data-ref="outline-resizer"]'), 'the edge follows the panel (hidden with it)');
  } finally {
    cleanup();
  }
});

test('dragging the outline edge resizes it, on either side, and reports the width once', async () => {
  const widths = [];
  const { view, container, pane, cleanup } = await mountView('## A\n', {
    outline: { visible: true, width: 300 },
    onOutlineWidthChanged: (width) => widths.push(width)
  });
  try {
    const root = container.querySelector('.mdzip-root');
    const shell = container.querySelector('[data-ref="workspace-shell"]');
    const edge = container.querySelector('[data-ref="outline-resizer"]');
    assert.equal(root.style.getPropertyValue('--mdzip-outline-pane-width'), '300px', 'the width option');
    assert.equal(view.outlinePaneWidth, 300);
    shell.getBoundingClientRect = () => ({ left: 0, right: 1200, width: 1200, top: 0, bottom: 800 });
    pane.getBoundingClientRect = () => ({ left: 900, right: 1200, width: 300, top: 0, bottom: 800 });
    const drag = (fromX, toX) => {
      edge.dispatchEvent(new window.MouseEvent('pointerdown', { button: 0, clientX: fromX, bubbles: true, cancelable: true }));
      window.dispatchEvent(new window.MouseEvent('pointermove', { clientX: toX }));
      window.dispatchEvent(new window.MouseEvent('pointerup', { clientX: toX }));
    };
    drag(900, 850);
    assert.equal(view.outlinePaneWidth, 350, 'on the right, dragging left widens it');
    drag(850, 100);
    assert.equal(view.outlinePaneWidth, 600, 'at most half the editor');
    view.setOutlinePosition('left');
    pane.getBoundingClientRect = () => ({ left: 280, right: 880, width: 600, top: 0, bottom: 800 });
    drag(880, 400);
    assert.equal(view.outlinePaneWidth, 160, 'on the left, dragging left narrows it, to at least 160');
    assert.equal(root.style.getPropertyValue('--mdzip-outline-pane-width'), '160px');
    assert.deepEqual(widths, [350, 600, 160], 'reported when each drag ends');
  } finally {
    cleanup();
  }
});

test('in Split, going to a heading from the outline scrolls the source too', async () => {
  const { view, pane, previewPane, cleanup } = await mountView('# Top\n\nText.\n\n## Far Down\n\nMore.\n', {
    outline: true, initialLayout: 'split'
  });
  const layout = fakeLayout();
  try {
    await waitFor(() => assert.ok(view.cmEditor));
    const scroller = view.cmEditor.dom.querySelector('.cm-scroller');
    // No real layout in jsdom: a preview 2000px tall over a source 1000px
    // tall, both 500px high, so the sync falls back to the scroll ratio.
    let previewTop = 0;
    let sourceTop = 0;
    const sized = (el, height, get, set) => {
      Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => height });
      Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 500 });
      Object.defineProperty(el, 'scrollTop', { configurable: true, get, set });
    };
    sized(previewPane, 2000, () => previewTop, (v) => { previewTop = v; });
    sized(scroller, 1000, () => sourceTop, (v) => { sourceTop = v; });
    layout.set('user-content-far-down', () => 1500 - previewTop);
    // Flush with the top, to keep the sums simple.
    previewPane.querySelector('#user-content-far-down').style.scrollMarginTop = '0px';
    const link = [...pane.querySelectorAll('a')].find((a) => a.textContent === 'Far Down');
    link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await waitFor(() => assert.equal(Math.round(previewTop), 1500), 500);
    assert.equal(Math.round(sourceTop), 500, 'the source followed (1500 of 1500 in the preview is 500 of 500 in the source)');
  } finally {
    layout.restore();
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
      assert.equal(Math.round(scrollTop), 8984);
    }, 500); // the glide takes up to 0.7 s, after the chunk is drawn
    assert.ok(visited.some((top) => top > 100 && top < 8900), 'it scrolls through the way there, not in one jump');
    assert.ok(link.classList.contains('is-current'));
  } finally {
    layout.restore();
    cleanup();
  }
});
