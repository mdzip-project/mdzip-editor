import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Constructing a real CodeMirror editor (search's panel needs one) requires
// document/HTMLElement, MutationObserver, animation frame helpers, matchMedia
// (color-scheme detection), and object-URL stubs beyond a bare JSDOM window.
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

import { MdzipWorkspaceView, buildNewArchiveBytesWithTitle } from '../dist/index.js';

test('openSearch mounts the find/replace panel and closeSearch removes it', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'source',
    initialColorScheme: 'light'
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Doc\n\nfind me\n', 'Doc');
    await view.open(bytes, { mode: 'editable', fileName: 'doc.mdz' });

    const opened = await view.openSearch();
    assert.equal(opened, true);
    assert.ok(container.querySelector('.cm-search'), 'search panel is mounted');

    const closed = view.closeSearch();
    assert.equal(closed, true);
    assert.equal(container.querySelector('.cm-search'), null, 'search panel is removed');
  } finally {
    view.destroy();
    container.remove();
  }
});

test('openSearch switches out of preview-only layout so the panel has somewhere to render', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'preview',
    initialColorScheme: 'light'
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Doc\n\nfind me\n', 'Doc');
    await view.open(bytes, { mode: 'editable', fileName: 'doc.mdz' });
    assert.equal(view.cmEditor, null, 'no CodeMirror instance yet in preview-only layout');

    const opened = await view.openSearch();
    assert.equal(opened, true);
    assert.ok(view.cmEditor, 'CodeMirror editor was created to host the panel');
    assert.ok(container.querySelector('.cm-search'), 'search panel is mounted');
  } finally {
    view.destroy();
    container.remove();
  }
});

test('openSearch works in read-only (Viewer) documents', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'viewer',
    initialLayout: 'source',
    initialColorScheme: 'light'
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Doc\n\nfind me\n', 'Doc');
    await view.open(bytes, { mode: 'read-only', fileName: 'doc.mdz' });

    const opened = await view.openSearch();
    assert.equal(opened, true, 'read-only documents can still be searched');
    assert.ok(container.querySelector('.cm-search'), 'search panel is mounted');
  } finally {
    view.destroy();
    container.remove();
  }
});

test('openSearch is a no-op when the control policy disables search', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: { preset: 'standalone-editor', search: false },
    initialLayout: 'source',
    initialColorScheme: 'light'
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Doc\n\nfind me\n', 'Doc');
    await view.open(bytes, { mode: 'editable', fileName: 'doc.mdz' });

    const opened = await view.openSearch();
    assert.equal(opened, false);
    assert.equal(container.querySelector('.cm-search'), null);
  } finally {
    view.destroy();
    container.remove();
  }
});
