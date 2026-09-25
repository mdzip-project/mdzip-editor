import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Same jsdom bootstrap as editor-context-menu.test.mjs / preview-copy-all.test.mjs.
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
import { MdzArchiveCore } from '@mdzip/core-js';
import { MdzipWorkspaceView, buildNewArchiveBytesWithTitle } from '../dist/index.js';

const SOURCE = [
  '# Notes',
  '',
  '[workspace file](../README.md)',
  '',
  '[external site](https://example.com/guide.md)',
  ''
].join('\n');

async function mountPreview(options = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'preview',
    initialColorScheme: 'light',
    ...options
  });
  await view.open(new TextEncoder().encode(SOURCE), { mode: 'editable', fileName: 'notes.md' });
  const previewContent = container.querySelector('[data-ref="preview-content"]');
  return {
    view,
    container,
    previewContent,
    cleanup() {
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

test('onUnresolvedLinkClick fires for a workspace-relative link the archive can\'t resolve, and suppresses default navigation', async () => {
  const calls = [];
  const { previewContent, cleanup } = await mountPreview({
    onUnresolvedLinkClick: (href, snapshot) => calls.push({ href, currentPath: snapshot.currentPath })
  });
  try {
    const notPrevented = clickLink(previewContent, 'workspace file');

    assert.equal(notPrevented, false, 'default navigation was prevented — the host owns this click now');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].href, '../README.md');
    assert.equal(typeof calls[0].currentPath, 'string');
    assert.ok(calls[0].currentPath.length > 0, 'snapshot carries the archive-relative current path');
  } finally {
    cleanup();
  }
});

test('onUnresolvedLinkClick does not fire for a plain external URL', async () => {
  const calls = [];
  const { previewContent, cleanup } = await mountPreview({
    onUnresolvedLinkClick: (href) => calls.push(href)
  });
  try {
    const notPrevented = clickLink(previewContent, 'external site');

    assert.equal(notPrevented, true, 'external links are left to whatever already handles them');
    assert.deepEqual(calls, []);
  } finally {
    cleanup();
  }
});

test('without a registered handler, an unresolved link click is left exactly as before (no-op, not prevented)', async () => {
  const { previewContent, cleanup } = await mountPreview();
  try {
    const notPrevented = clickLink(previewContent, 'workspace file');
    assert.equal(notPrevented, true);
  } finally {
    cleanup();
  }
});

test('navigating a lazy workspace opened without archiveBytes does not export or read other documents', async () => {
  // Regression guard: every workspace event, navigation included, went through
  // exportBytes()/onChanged. Without archiveBytes (mdzip-vscode sends none over
  // its 32MB transfer limit) that rebuilt the whole archive, resolving every
  // lazy document first — on a 752-book archive the one read the user asked
  // for timed out behind the other 751.
  const core = await MdzArchiveCore.openWorkspace(await buildNewArchiveBytesWithTitle('# Entry\n', 'Books'));
  const lazyReads = [];
  for (const name of ['chapter1.md', 'chapter2.md', 'chapter3.md']) {
    core.documents.push({
      path: name,
      title: name,
      text: '',
      isEntryPoint: false,
      isLazy: true,
      readText: async () => {
        lazyReads.push(name);
        return `# ${name}\n`;
      }
    });
  }

  const changed = [];
  const selections = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'preview',
    initialColorScheme: 'light',
    onChanged: (_bytes, snapshot) => changed.push(snapshot.currentPath),
    onSelectionChanged: (snapshot) => selections.push(snapshot.currentPath)
  });
  try {
    await view.openWorkspace(core, { mode: 'editable', fileName: 'books.mdz' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Opening doesn't rebuild the archive either: the host already has its bytes.
    assert.deepEqual(lazyReads, [], 'opening reads no lazy documents');
    assert.deepEqual(changed, [], 'opening reports no bytes that would need a rebuild');

    assert.equal(await view.workspace.openPath('chapter2.md'), true);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(lazyReads, ['chapter2.md'], 'only the opened document is read');
    assert.deepEqual(changed, [], 'navigation reports no archive change');
    assert.equal(selections.at(-1), 'chapter2.md', 'hosts still learn the new path');
  } finally {
    view.destroy();
    container.remove();
  }
});
