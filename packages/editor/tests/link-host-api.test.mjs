import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Same jsdom bootstrap as heading-anchors.test.mjs / link-navigation.test.mjs.
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

// Inert IntersectionObserver: progressive rendering arms its sentinel but
// never fires it, so anything past the first batch stays unmounted.
class FakeIntersectionObserver {
  constructor(callback) { this.callback = callback; }
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.window.IntersectionObserver = FakeIntersectionObserver;

import { MdzArchiveCore } from '@mdzip/core-js';
import {
  MdzipWorkspaceView,
  buildNewArchiveBytesWithTitle,
  isMdzipDefaultPolicyExternalLink,
  isMdzipExternalLink,
  parseMdzipLink
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

// jsdom has no layout: a settable scrollTop on the pane, and element top
// offsets from a table the test controls.
function fakeLayout(container) {
  const previewPane = container.querySelector('[data-ref="preview-pane"]');
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
    previewPane,
    setOffset: (id, top) => offsets.set(id, top),
    restore: () => { window.HTMLElement.prototype.getBoundingClientRect = originalRect; }
  };
}

function createView(options = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'preview',
    initialColorScheme: 'light',
    ...options
  });
  const layout = fakeLayout(container);
  const previewContent = container.querySelector('[data-ref="preview-content"]');
  return {
    view,
    container,
    previewContent,
    ...layout,
    cleanup() {
      layout.restore();
      view.destroy();
      container.remove();
    }
  };
}

async function mountMarkdown(source, options = {}) {
  const mounted = createView(options);
  await mounted.view.open(new TextEncoder().encode(source), { mode: 'editable', fileName: 'notes.md' });
  await mounted.view.whenRendered();
  return mounted;
}

async function mountBook(options = {}) {
  const core = await MdzArchiveCore.openWorkspace(
    await buildNewArchiveBytesWithTitle('# Entry\n\n[Chapter](chapter1.md#part-two)\n', 'Book')
  );
  core.documents.push({ path: 'chapter1.md', title: 'chapter1.md', text: '# Chapter\n\n## Part Two\n', isEntryPoint: false });
  const mounted = createView(options);
  await mounted.view.openWorkspace(core, { mode: 'editable', fileName: 'book.mdz' });
  await mounted.view.whenRendered();
  return mounted;
}

function linkByText(previewContent, linkText) {
  const link = [...previewContent.querySelectorAll('a[href]')].find((a) => a.textContent === linkText);
  assert.ok(link, `preview has a link with text "${linkText}"`);
  return link;
}

function clickLink(previewContent, linkText, init = {}) {
  return linkByText(previewContent, linkText)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
}

// --- Link classification -----------------------------------------------------

const ENTRIES = [
  { path: 'docs/guide.md', isMarkdown: true },
  { path: 'docs/intro.md', isMarkdown: true },
  { path: 'images/logo.png', isMarkdown: false }
];

test('parseMdzipLink classifies anchors, archive documents, relative and external links', () => {
  assert.deepEqual(parseMdzipLink('#Caf%C3%A9', 'docs/guide.md', ENTRIES),
    { kind: 'anchor', path: '', anchor: 'Café', targetPath: null });
  assert.deepEqual(parseMdzipLink('intro.md#setup', 'docs/guide.md', ENTRIES),
    { kind: 'document', path: 'intro.md', anchor: 'setup', targetPath: 'docs/intro.md' });
  assert.deepEqual(parseMdzipLink('../design/foo.md', 'docs/guide.md', ENTRIES),
    { kind: 'relative', path: '../design/foo.md', anchor: null, targetPath: null });
  assert.equal(parseMdzipLink('../images/logo.png', 'docs/guide.md', ENTRIES).kind, 'relative',
    'a non-Markdown archive entry is not a document link');
  assert.deepEqual(parseMdzipLink('https://example.com/a#b', 'docs/guide.md', ENTRIES),
    { kind: 'external', path: 'https://example.com/a', anchor: 'b', targetPath: null });
  assert.equal(parseMdzipLink('mailto:a@example.com', 'docs/guide.md', ENTRIES).kind, 'external');
  assert.equal(parseMdzipLink('//cdn.example.com/x', 'docs/guide.md', ENTRIES).kind, 'external');
  assert.equal(parseMdzipLink('bad%E0%A4%A.md', 'docs/guide.md', ENTRIES).kind, 'relative',
    'malformed percent-encoding does not throw');
});

test('external-link predicates: any scheme is external; the default policy covers web and mail only', () => {
  assert.equal(isMdzipExternalLink('vscode:extension/x'), true);
  assert.equal(isMdzipExternalLink('./a.md'), false);
  assert.equal(isMdzipDefaultPolicyExternalLink('HTTPS://example.com'), true);
  assert.equal(isMdzipDefaultPolicyExternalLink('mailto:a@example.com'), true);
  assert.equal(isMdzipDefaultPolicyExternalLink('//example.com'), true);
  assert.equal(isMdzipDefaultPolicyExternalLink('vscode:extension/x'), false);
});

// --- onLinkActivated (#48) -----------------------------------------------------

const LINKS_SOURCE = [
  '# Notes',
  '',
  '[Jump](#section-two)',
  '',
  '[Design](../design/foo.md#overview)',
  '',
  '[Site](https://example.com/guide)',
  '',
  '## Section Two',
  ''
].join('\n');

test('onLinkActivated receives the parsed link, and unprevented clicks keep the built-in behavior', async () => {
  const events = [];
  const unresolved = [];
  const { container, previewContent, previewPane, setOffset, cleanup } = await mountMarkdown(LINKS_SOURCE, {
    onLinkActivated: (event) => events.push(event),
    onUnresolvedLinkClick: (href) => unresolved.push(href)
  });
  try {
    setOffset('user-content-section-two', 480);
    assert.equal(clickLink(previewContent, 'Jump'), false, 'anchor click still owned by the preview');
    await wait(0);
    assert.equal(previewPane.scrollTop, 480, 'built-in anchor scroll still runs');

    clickLink(previewContent, 'Design', { ctrlKey: true });
    assert.deepEqual(unresolved, ['../design/foo.md#overview'], 'onUnresolvedLinkClick still runs');

    // Check the view left the default alone, then stop jsdom's (unimplemented) navigation.
    let externalPreventedByView = null;
    container.addEventListener('click', (event) => {
      externalPreventedByView = event.defaultPrevented;
      event.preventDefault();
    }, { once: true });
    clickLink(previewContent, 'Site');
    assert.equal(externalPreventedByView, false, 'external link left to the browser');

    assert.equal(events.length, 3);
    const [anchor, relative, external] = events;
    assert.equal(anchor.kind, 'anchor');
    assert.equal(anchor.isAnchor, true);
    assert.equal(anchor.anchor, 'section-two');
    assert.equal(anchor.text, 'Jump');
    assert.equal(anchor.sourcePath, anchor.snapshot.currentPath);
    assert.ok(anchor.sourcePath.endsWith('.md'));

    assert.equal(relative.kind, 'relative');
    assert.equal(relative.href, '../design/foo.md#overview');
    assert.equal(relative.path, '../design/foo.md');
    assert.equal(relative.anchor, 'overview');
    assert.equal(relative.ctrlKey, true);
    assert.ok(relative.domEvent instanceof window.MouseEvent);
    assert.equal(relative.defaultPrevented, false);

    assert.equal(external.kind, 'external');
    assert.equal(external.isExternal, true);
  } finally {
    cleanup();
  }
});

test('preventDefault in onLinkActivated stops the view and the browser from navigating', async () => {
  const unresolved = [];
  const { previewContent, previewPane, setOffset, cleanup } = await mountMarkdown(LINKS_SOURCE, {
    onLinkActivated: (event) => {
      event.preventDefault();
      assert.equal(event.defaultPrevented, true);
    },
    onUnresolvedLinkClick: (href) => unresolved.push(href)
  });
  try {
    setOffset('user-content-section-two', 480);
    assert.equal(clickLink(previewContent, 'Jump'), false);
    await wait(0);
    assert.equal(previewPane.scrollTop, 0, 'no built-in anchor scroll');

    assert.equal(clickLink(previewContent, 'Design'), false);
    assert.deepEqual(unresolved, [], 'onUnresolvedLinkClick is skipped');

    assert.equal(clickLink(previewContent, 'Site'), false, 'external navigation suppressed too');
  } finally {
    cleanup();
  }
});

test('archive document links report their resolved target, and a prevented one is not opened', async () => {
  const events = [];
  const { view, previewContent, cleanup } = await mountBook({
    onLinkActivated: (event) => {
      events.push(event);
      event.preventDefault();
    }
  });
  try {
    clickLink(previewContent, 'Chapter');
    await wait(20);
    assert.equal(events[0].kind, 'document');
    assert.equal(events[0].targetPath, 'chapter1.md');
    assert.equal(events[0].anchor, 'part-two');
    assert.notEqual(view.workspace.snapshot().currentPath, 'chapter1.md', 'host owned the navigation');
  } finally {
    cleanup();
  }
});

test('a throwing onLinkActivated is reported and the built-in behavior continues', async () => {
  const failures = [];
  const { previewContent, previewPane, setOffset, cleanup } = await mountMarkdown(LINKS_SOURCE, {
    onLinkActivated: () => { throw new Error('host bug'); },
    onFailed: (error) => failures.push(error)
  });
  try {
    setOffset('user-content-section-two', 480);
    clickLink(previewContent, 'Jump');
    await wait(0);
    assert.equal(failures.length, 1);
    assert.equal(previewPane.scrollTop, 480);
  } finally {
    cleanup();
  }
});

// --- externalLinks policy (#49) -------------------------------------------------

const POLICY_SOURCE = [
  '[Site](https://example.com)',
  '',
  '[Mail](mailto:a@example.com)',
  '',
  '[App](tel:+15551234567)',
  '',
  '[Local](./other.md)',
  '',
  '[Jump](#top)',
  '',
  '<a href="https://raw.example.com" rel="author">Raw</a>',
  ''
].join('\n');

test('without externalLinks, links render exactly as before', async () => {
  const { previewContent, cleanup } = await mountMarkdown(POLICY_SOURCE);
  try {
    assert.equal(linkByText(previewContent, 'Site').getAttribute('target'), null);
    assert.equal(linkByText(previewContent, 'Site').getAttribute('rel'), null);
  } finally {
    cleanup();
  }
});

test('target "_blank" applies to web and mail links with a safe default rel; others are untouched', async () => {
  const { previewContent, cleanup } = await mountMarkdown(POLICY_SOURCE, {
    externalLinks: { target: '_blank' }
  });
  try {
    for (const text of ['Site', 'Mail', 'Raw']) {
      const link = linkByText(previewContent, text);
      assert.equal(link.getAttribute('target'), '_blank', `${text} opens in a new tab`);
      assert.equal(link.getAttribute('rel'), 'noopener noreferrer', `${text} gets the safe rel`);
    }
    for (const text of ['App', 'Local', 'Jump']) {
      assert.equal(linkByText(previewContent, text).getAttribute('target'), null, `${text} is untouched`);
    }
  } finally {
    cleanup();
  }
});

test('an explicit rel and predicate override the defaults', async () => {
  const seen = [];
  const { previewContent, cleanup } = await mountMarkdown(POLICY_SOURCE, {
    externalLinks: {
      target: '_blank',
      rel: 'noopener',
      predicate: (href) => {
        seen.push(href);
        return href.startsWith('tel:');
      }
    }
  });
  try {
    assert.equal(linkByText(previewContent, 'App').getAttribute('target'), '_blank');
    assert.equal(linkByText(previewContent, 'App').getAttribute('rel'), 'noopener');
    assert.equal(linkByText(previewContent, 'Site').getAttribute('target'), null);
    assert.ok(!seen.includes('./other.md') && !seen.includes('#top'),
      'relative links and fragments never reach the predicate');
  } finally {
    cleanup();
  }
});

test('setExternalLinks re-applies to the mounted preview and undefined restores the original attributes', async () => {
  const { view, previewContent, cleanup } = await mountMarkdown(POLICY_SOURCE, {
    externalLinks: { target: '_blank' }
  });
  try {
    view.setExternalLinks({ target: '_top' });
    assert.equal(linkByText(previewContent, 'Site').getAttribute('target'), '_top');
    assert.equal(linkByText(previewContent, 'Site').getAttribute('rel'), null, 'no default rel for _top');
    assert.equal(linkByText(previewContent, 'Raw').getAttribute('rel'), 'author', 'author rel restored');

    view.setExternalLinks(undefined);
    assert.equal(linkByText(previewContent, 'Site').getAttribute('target'), null);
    assert.equal(linkByText(previewContent, 'Raw').getAttribute('rel'), 'author');
  } finally {
    cleanup();
  }
});

test('externalLinks applies to chunks progressive rendering mounts later', async () => {
  let source = '# Top\n\n[Jump](#last-section)\n\n';
  for (let i = 0; i < 800; i += 1) {
    source += `Paragraph number ${i} with a little padding text so each block has real weight.\n\n`;
  }
  source += '## Last Section\n\n[Late](https://late.example.com)\n';
  const { view, previewContent, cleanup } = await mountMarkdown(source, {
    progressiveTextRendering: true,
    externalLinks: { target: '_blank' }
  });
  try {
    assert.equal(previewContent.querySelector('a[href="https://late.example.com"]'), null, 'sanity: tail unmounted');
    assert.equal(await view.scrollToAnchor('last-section'), true);
    assert.equal(linkByText(previewContent, 'Late').getAttribute('target'), '_blank');
  } finally {
    cleanup();
  }
});

// --- scrollToAnchor / getAvailableAnchors (#50) ---------------------------------

test('scrollToAnchor called before the document opens waits for the preview, then scrolls', async () => {
  const { view, setOffset, previewPane, cleanup } = createView();
  try {
    setOffset('user-content-deep-link', 750);
    const result = view.scrollToAnchor('#Deep-Link');
    await view.open(new TextEncoder().encode('# Title\n\n## Deep Link\n'), { mode: 'read-only', fileName: 'a.md' });
    assert.equal(await result, true);
    assert.equal(previewPane.scrollTop, 750);
  } finally {
    cleanup();
  }
});

test('scrollToAnchor works when called from onPreviewRendered', async () => {
  let pending = null;
  const mounted = createView({
    onPreviewRendered: () => {
      pending ??= mounted.view.scrollToAnchor('section-two');
    }
  });
  try {
    mounted.setOffset('user-content-section-two', 320);
    await mounted.view.open(new TextEncoder().encode(LINKS_SOURCE), { mode: 'read-only', fileName: 'a.md' });
    await waitFor(() => assert.ok(pending));
    assert.equal(await pending, true);
    assert.equal(mounted.previewPane.scrollTop, 320);
  } finally {
    mounted.cleanup();
  }
});

test('scrollToAnchor resolves false for an unknown anchor, true for top, and false once destroyed', async () => {
  const { view, previewPane, cleanup } = await mountMarkdown(LINKS_SOURCE);
  try {
    previewPane.scrollTop = 200;
    assert.equal(await view.scrollToAnchor('missing'), false);
    assert.equal(previewPane.scrollTop, 200);
    assert.equal(await view.scrollToAnchor('#top'), true);
    assert.equal(previewPane.scrollTop, 0);
  } finally {
    cleanup();
  }

  const { view: waitingView, cleanup: cleanupWaiting } = createView();
  const waiting = waitingView.scrollToAnchor('anything');
  cleanupWaiting();
  assert.equal(await waiting, false, 'a waiting call is released on destroy');
});

test('scrollToAnchor mounts unmounted progressive chunks to reach the target', async () => {
  let source = '# Top\n\n';
  for (let i = 0; i < 800; i += 1) {
    source += `Paragraph number ${i} with a little padding text so each block has real weight.\n\n`;
  }
  source += '## Last Section\n\nThe end.\n';
  const { view, previewContent, previewPane, setOffset, cleanup } = await mountMarkdown(source, {
    progressiveTextRendering: true
  });
  try {
    assert.equal(previewContent.querySelector('#user-content-last-section'), null, 'sanity: target unmounted');
    setOffset('user-content-last-section', 9000);
    assert.equal(await view.scrollToAnchor('last-section'), true);
    assert.equal(previewPane.scrollTop, 9000);
  } finally {
    cleanup();
  }
});

test('getAvailableAnchors lists headings in order, including unmounted chunks, plus explicit anchors', async () => {
  let source = '# Top\n\n<a id="custom-spot"></a>\n\n## Repeat\n\n## Repeat\n\n';
  for (let i = 0; i < 800; i += 1) {
    source += `Paragraph number ${i} with a little padding text so each block has real weight.\n\n`;
  }
  source += '## Last Section\n';
  const { view, previewContent, cleanup } = await mountMarkdown(source, { progressiveTextRendering: true });
  try {
    assert.equal(previewContent.querySelector('#user-content-last-section'), null, 'sanity: tail unmounted');
    assert.deepEqual(view.getAvailableAnchors(), ['top', 'custom-spot', 'repeat', 'repeat-1', 'last-section']);
  } finally {
    cleanup();
  }

  const { view: plain, cleanup: cleanupPlain } = await mountMarkdown('# One\n\n## Two\n');
  try {
    assert.deepEqual(plain.getAvailableAnchors(), ['one', 'two']);
  } finally {
    cleanupPlain();
  }
});
