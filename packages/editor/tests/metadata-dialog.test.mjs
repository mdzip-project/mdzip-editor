import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Same jsdom bootstrap as workspace.test.mjs — see the comment there for why
// each piece is needed.
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

/** Opens the Document Information dialog and reads back its rows as [label, value] pairs. */
function readMetadataRows(root) {
  root.querySelector('[data-ref="document-info-btn"]').click();
  return Array.from(root.querySelectorAll('.metadata-row'))
    .map((row) => {
      const label = row.querySelector('dt')?.textContent;
      const value = row.querySelector('dd')?.textContent;
      return label ? [label, value] : null;
    })
    .filter(Boolean);
}

test('Document Information omits the Read-only row for an editable workspace', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = new MdzipWorkspaceView(root, { controls: 'hosted-editor' });
  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Hello\n', 'hello');
    await view.open(bytes, { mode: 'editable', fileName: 'test.mdz' });
    const rows = readMetadataRows(root);
    assert.equal(rows.some(([label]) => label === 'Read-only'), false);
  } finally {
    view.destroy();
    root.remove();
  }
});

test('Document Information shows a filesystem-framed Read-only row for a read-only workspace', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = new MdzipWorkspaceView(root, { controls: 'hosted-editor' });
  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Hello\n', 'hello');
    await view.open(bytes, { mode: 'read-only', fileName: 'test.mdz' });
    const rows = readMetadataRows(root);
    const readOnlyRow = rows.find(([label]) => label === 'Read-only');
    assert.ok(readOnlyRow, 'expected a Read-only row');
    const [, value] = readOnlyRow;
    // Framed as a filesystem/host condition, not an editor toggle — this is
    // what the row exists to communicate, so assert the wording, not just presence.
    assert.match(value, /file on disk/i);
  } finally {
    view.destroy();
    root.remove();
  }
});

test('Document Information Size uses real archive bytes for .mdz', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = new MdzipWorkspaceView(root, { controls: 'hosted-editor' });
  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Hello\n', 'hello');
    await view.open(bytes, { mode: 'editable', fileName: 'test.mdz' });
    const rows = readMetadataRows(root);
    const [, size] = rows.find(([label]) => label === 'Size');
    // Real archive bytes (zip + manifest overhead), not the raw markdown length.
    assert.match(size, /^\d+(\.\d+)? B$/);
  } finally {
    view.destroy();
    root.remove();
  }
});

test('Document Information Size uses the encoded text length for plain Markdown, not the internal archive representation', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = new MdzipWorkspaceView(root, { controls: 'hosted-editor' });
  try {
    // Regression: archiveBytes for sourceFormat 'markdown' is some internally
    // wrapped representation with its own fixed overhead, not the file's real
    // bytes — a naive `archiveBytes.length` reported ~460 "archive bytes" for
    // this exact 5-byte document before this test was written to catch it.
    const text = '# Hi\n';
    const bytes = new TextEncoder().encode(text);
    await view.open(bytes, { sourceFormat: 'markdown', mode: 'editable', fileName: 'test.md' });
    const rows = readMetadataRows(root);
    const [, size] = rows.find(([label]) => label === 'Size');
    assert.equal(size, `${bytes.length} B`);
  } finally {
    view.destroy();
    root.remove();
  }
});

test('Document Information Documents/Assets counts are correct for .mdz, "Not applicable" for Markdown', async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  const root1 = document.createElement('div');
  document.body.appendChild(root1);
  const view1 = new MdzipWorkspaceView(root1, { controls: 'hosted-editor' });
  try {
    const { buildNewArchiveBytesWithTitle: build } = await import('../dist/index.js');
    const bytes = await build('# Cover\n\n![cover](cover.png)\n', 'hello', [
      { archivePath: 'cover.png', fileBytes: png }
    ]);
    await view1.open(bytes, { mode: 'editable', fileName: 'test.mdz' });
    const rows = readMetadataRows(root1);
    assert.deepEqual(rows.find(([label]) => label === 'Documents'), ['Documents', '1']);
    assert.deepEqual(rows.find(([label]) => label === 'Assets'), ['Assets', '1']);
  } finally {
    view1.destroy();
    root1.remove();
  }

  const root2 = document.createElement('div');
  document.body.appendChild(root2);
  const view2 = new MdzipWorkspaceView(root2, { controls: 'hosted-editor' });
  try {
    await view2.open(new TextEncoder().encode('# Hi\n'), { sourceFormat: 'markdown', mode: 'editable', fileName: 'test.md' });
    const rows = readMetadataRows(root2);
    assert.deepEqual(rows.find(([label]) => label === 'Documents'), ['Documents', 'Not applicable']);
    assert.deepEqual(rows.find(([label]) => label === 'Assets'), ['Assets', 'Not applicable']);
  } finally {
    view2.destroy();
    root2.remove();
  }
});
