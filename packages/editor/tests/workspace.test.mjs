import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { MdzArchiveCore } from '@mdzip/core-js';

// The default renderer sanitizes through DOMPurify, which needs a DOM window
// in Node. The library resolves it lazily from globalThis.window. Constructing
// a full MdzipWorkspaceView additionally needs document/HTMLElement, animation
// frame helpers, matchMedia (color-scheme detection) and object-URL stubs.
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
import {
  MdzipReadOnlyError,
  MdzipRenderingService,
  MdzipWorkspaceView,
  MdzipWorkspaceService,
  buildNewArchiveBytesWithTitle,
  buildMdzipNavTree,
  canEditMdzipPath,
  inferMdzipSourceFormat,
  normalizeArchivePath,
  openMdzArchive,
  readTextFileFromArchive,
  relativeArchivePath,
  resolveMdzipArchiveLinkTarget,
  resolveMdzipControlPolicy,
  defaultSafeMarkdownRenderer
} from '../dist/index.js';

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  )
);
const PNG_200X100_HEADER = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0xc8, 0x00, 0x00, 0x00, 0x64
]);

test('opens archives for view-only inspection', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Hello\n\n![Logo](images/logo.png)\n', 'Demo', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);

  const workspace = await MdzipWorkspaceService.open(bytes, {
    mode: 'read-only',
    fileName: 'hello.mdz'
  });
  const snapshot = workspace.snapshot();

  assert.equal(snapshot.mode, 'read-only');
  assert.equal(snapshot.fileName, 'hello.mdz');
  assert.equal(snapshot.content.entryPoint, 'index.md');
  assert.equal(snapshot.displayTitle, 'Demo');
  assert.equal(snapshot.content.images.size, 0);
  assert.throws(() => workspace.editText('# Blocked\n'), MdzipReadOnlyError);
  await assert.rejects(() => workspace.saveToBytes(), MdzipReadOnlyError);
});

test('edits markdown and saves updated archive bytes', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Original\n', 'Original');
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  workspace.editText('# Updated\n');
  assert.equal(workspace.dirty, true);

  const saved = await workspace.saveToBytes();
  assert.equal(workspace.dirty, false);
  assert.equal(await readTextFileFromArchive(saved, 'index.md'), '# Updated\n');
});

test('opens and saves a plain Markdown file without treating it as a ZIP archive', async () => {
  const source = '# Plain Markdown\n\nHello.\n';
  const workspace = await MdzipWorkspaceService.open(
    new TextEncoder().encode(source),
    { mode: 'editable', fileName: 'notes.md' }
  );

  assert.equal(workspace.sourceFormat, 'markdown');
  assert.equal(workspace.currentText, source);
  assert.equal(workspace.manifest(), null);
  assert.deepEqual(
    workspace.snapshot().content.paths.map((entry) => entry.path),
    ['notes.md']
  );

  workspace.editText('# Updated Markdown\n');
  const saved = await workspace.saveToBytes();
  assert.equal(new TextDecoder().decode(saved), '# Updated Markdown\n');

  const snapshot = await workspace.getCurrentSnapshot();
  assert.equal(snapshot.bytes.type, 'text/markdown;charset=utf-8');
  assert.equal(await snapshot.bytes.text(), '# Updated Markdown\n');
});

test('converts a plain Markdown workspace to a real MDZ archive', async () => {
  const workspace = await MdzipWorkspaceService.open(
    new TextEncoder().encode('# Convert me\n'),
    { mode: 'editable', fileName: 'notes.md' }
  );

  assert.equal(await workspace.convertToMdz(), true);
  assert.equal(workspace.sourceFormat, 'mdz');
  assert.equal(workspace.snapshot().fileName, 'notes.mdz');
  assert.ok(workspace.manifest());
  assert.deepEqual(
    workspace.snapshot().content.paths.map((entry) => entry.path),
    ['index.md', 'manifest.json']
  );

  const saved = await workspace.saveToBytes();
  assert.equal(await readTextFileFromArchive(saved, 'index.md'), '# Convert me\n');
  assert.equal(await workspace.convertToMdz(), false);
});

test('nav toolbar button presents conversion when a plain Markdown file is open', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'source',
    initialColorScheme: 'light'
  });

  try {
    await view.open(
      new TextEncoder().encode('# Notes\n'),
      { mode: 'editable', fileName: 'notes.md' }
    );
    const navButton = container.querySelector('[data-ref="nav-btn"]');
    assert.equal(navButton?.getAttribute('aria-label'), 'Convert to MDZ');
    assert.equal(navButton?.dataset['tooltip'], 'Convert to MDZ');
    assert.equal(navButton?.hasAttribute('aria-pressed'), false);
    assert.ok(navButton?.classList.contains('convert-mdz-toggle'));

    const bytes = await buildNewArchiveBytesWithTitle('# Archive\n', 'Archive');
    await view.open(bytes, { mode: 'editable', fileName: 'archive.mdz' });
    assert.equal(navButton?.getAttribute('aria-label'), 'Toggle contents');
    assert.equal(navButton?.dataset['tooltip'], 'Toggle contents');
    assert.equal(navButton?.getAttribute('aria-pressed'), 'false');
    assert.equal(navButton?.classList.contains('convert-mdz-toggle'), false);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('density options apply semantic sizing classes without reopening the view', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    toolbarDensity: 'compact',
    contentDensity: 'compact',
    initialLayout: 'source',
    initialColorScheme: 'light'
  });

  try {
    const root = container.querySelector('.mdzip-root');
    assert.ok(root?.classList.contains('toolbar-density-compact'));
    assert.ok(root?.classList.contains('content-density-compact'));

    const bytes = await buildNewArchiveBytesWithTitle('# Density\n', 'Density');
    await view.open(bytes, { mode: 'editable', fileName: 'density.mdz' });
    const editor = view.cmEditor;
    assert.ok(editor, 'CodeMirror editor was created');

    view.setDensityOptions({ toolbarDensity: 'dense', contentDensity: 'comfortable' });
    assert.equal(view.cmEditor, editor, 'density update does not recreate the editor');
    assert.ok(root?.classList.contains('toolbar-density-dense'));
    assert.ok(root?.classList.contains('content-density-comfortable'));
    assert.equal(root?.classList.contains('toolbar-density-compact'), false);
    assert.equal(root?.classList.contains('content-density-compact'), false);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('infers source format from file name and ZIP signature', async () => {
  const markdown = new TextEncoder().encode('# Notes\n');
  const archive = await buildNewArchiveBytesWithTitle('# Archive\n', 'Archive');

  assert.equal(inferMdzipSourceFormat(markdown, 'notes.md'), 'markdown');
  assert.equal(inferMdzipSourceFormat(markdown, 'notes.markdown'), 'markdown');
  assert.equal(inferMdzipSourceFormat(archive, 'document.mdz'), 'mdz');
  assert.equal(inferMdzipSourceFormat(markdown), 'markdown');
  assert.equal(inferMdzipSourceFormat(archive), 'mdz');
});

test('opens a normalized core workspace directly and flushes a host snapshot', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Original\n', 'Original', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);
  const coreWorkspace = await MdzArchiveCore.openWorkspace(bytes, {
    includeOrphanedAssetAnalysis: true
  });
  const workspace = await MdzipWorkspaceService.openWorkspace(coreWorkspace, { mode: 'editable' });

  workspace.editText('# Updated\n');
  const snapshot = await workspace.flush();
  const savedBytes = new Uint8Array(await snapshot.bytes.arrayBuffer());

  assert.equal(snapshot.state.dirty, true);
  assert.equal(snapshot.state.validationStatus, 'valid');
  assert.equal(snapshot.state.title, 'Original');
  assert.equal(snapshot.state.displayTitle, 'Original');
  assert.equal(snapshot.state.fileName, 'document.mdz');
  assert.equal(snapshot.state.sourceFormat, 'mdz');
  assert.equal(await readTextFileFromArchive(savedBytes, 'index.md'), '# Updated\n');
  assert.equal(snapshot.workspace.assets.some((asset) => asset.path === 'images/logo.png'), true);

  workspace.markPersisted();
  assert.equal(workspace.dirty, false);
});

test('openWorkspace accepts original archive bytes to enable fast mutation patching', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Entry\n', 'Patched');
  const coreWorkspace = await MdzArchiveCore.openWorkspace(bytes, { includeLazyDocumentReaders: true });
  const workspace = await MdzipWorkspaceService.openWorkspace(coreWorkspace, {
    mode: 'editable',
    archiveBytes: bytes
  });

  assert.equal(workspace.snapshot().archiveBytes, bytes);

  await workspace.addAsset('images/new.png', PNG_1X1);
  const saved = await workspace.saveToBytes();
  assert.equal(await readTextFileFromArchive(saved, 'index.md'), '# Entry\n');
  assert.equal((await openMdzArchive(saved)).paths.some((entry) => entry.path === 'images/new.png'), true);
});

test('opens a normalized workspace without eagerly rebuilding archive bytes', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Direct\n', 'Direct');
  const coreWorkspace = await MdzArchiveCore.openWorkspace(bytes);
  const workspace = await MdzipWorkspaceService.openWorkspace(coreWorkspace, { mode: 'editable' });

  assert.equal(workspace.snapshot().archiveBytes.byteLength, 0);
  assert.equal(workspace.currentText, '# Direct\n');
  assert.equal(await workspace.openPath('manifest.json'), true);
  assert.match(workspace.currentText, /"title": "Direct"/);
});

test('keeps dirty state while navigating and emits structured changes', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# First\n', 'Events');
  const coreWorkspace = await MdzArchiveCore.openWorkspace(bytes);
  coreWorkspace.documents.push({
    path: 'second.md',
    title: 'Second',
    text: '# Second\n',
    isEntryPoint: false
  });
  const workspace = await MdzipWorkspaceService.openWorkspace(coreWorkspace, { mode: 'editable' });
  const events = [];
  workspace.subscribe((event) => events.push(event));

  workspace.editText('# Changed\n');
  assert.equal(await workspace.openPath('second.md'), true);
  await workspace.addAsset('images/new.png', PNG_1X1);
  await workspace.setManifestTitle('Renamed');

  assert.equal(workspace.dirty, true);
  assert.deepEqual(events.map((event) => event.changes), [
    ['document'],
    ['selection'],
    ['asset'],
    ['manifest']
  ]);
});

test('default renderer strips executable HTML and unsafe URLs', () => {
  const service = new MdzipRenderingService();
  const html = service.render({
    markdown: [
      '<script>alert(1)</script>',
      '[unsafe](javascript:alert(1))',
      '<img src="x" onerror="alert(1)">'
    ].join('\n\n')
  }).html;

  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('javascript:'), false);
  assert.equal(html.includes('onerror'), false);
  assert.match(defaultSafeMarkdownRenderer.render('# Safe'), /<h1>Safe<\/h1>/);
});

test('default renderer preserves portable image alignment attributes', () => {
  const html = defaultSafeMarkdownRenderer.render(
    '<p align="center"><img src="images/logo.png" alt="Logo" width="320"></p>'
  );

  assert.match(html, /<p align="center"><img src="images\/logo\.png" alt="Logo" width="320"><\/p>/);
  assert.doesNotMatch(html, /style=/);
});

test('default renderer wraps Markdown tables for horizontal scrolling', () => {
  const rendering = new MdzipRenderingService();
  const rendered = rendering.render({
    markdown: `| Token | Value |
| --- | --- |
| \`--theme-color\` | \`#fff\` |`
  });

  assert.match(rendered.html, /<div class="mdzip-table-scroll"><table>/);
  assert.match(rendered.html, /<code>--theme-color<\/code>/);
});

test('manages manifest title and orphaned assets', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Original\n', 'Original');
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  await workspace.addAsset('images/unused.png', PNG_1X1);
  await workspace.ensureOrphanedAssetsAnalyzed();
  assert.deepEqual(workspace.snapshot().content.orphanedAssetPaths, ['images/unused.png']);

  const removed = await workspace.removeAsset('images/unused.png');
  assert.equal(removed, true);

  await workspace.setManifestTitle('Renamed');
  const saved = await workspace.saveToBytes();
  assert.equal((await openMdzArchive(saved)).manifest.title, 'Renamed');
});

test('keeps remaining orphaned indicators after removing one orphaned asset', async () => {
  // Two images referenced by no markdown — both orphaned.
  const bytes = await buildNewArchiveBytesWithTitle('# Doc\n', 'Doc', [
    { archivePath: 'images/a.png', fileBytes: PNG_1X1 },
    { archivePath: 'images/b.png', fileBytes: PNG_1X1 }
  ]);
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  // Opening the nav pane triggers this analysis; reproduce that here.
  await workspace.ensureOrphanedAssetsAnalyzed();
  assert.deepEqual(
    workspace.snapshot().content.orphanedAssetPaths.slice().sort(),
    ['images/a.png', 'images/b.png']
  );

  // Removing one orphan reloads the workspace. Without re-analysis the snapshot
  // would report no orphans until the nav pane was reopened (issue #12).
  const removed = await workspace.removeAsset('images/a.png', { requireOrphaned: true });
  assert.equal(removed, true);
  assert.deepEqual(
    workspace.snapshot().content.orphanedAssetPaths,
    ['images/b.png'],
    'remaining orphan should still be flagged without reopening the nav pane'
  );
});

test('latest [bytes] wins when two openArchive calls resolve out of order', async () => {
  // Force the FIRST (superseded) parse to resolve AFTER the second so the stale
  // result, if not guarded by a generation token, would overwrite the latest
  // input (issue #10).
  const originalOpenWorkspace = MdzArchiveCore.openWorkspace.bind(MdzArchiveCore);
  let parseCount = 0;
  MdzArchiveCore.openWorkspace = async (...args) => {
    parseCount += 1;
    if (parseCount === 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return originalOpenWorkspace(...args);
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {});
  try {
    const stale = await buildNewArchiveBytesWithTitle('# Stale\n', 'Stale');
    const latest = await buildNewArchiveBytesWithTitle('# Latest\n\nReal content\n', 'Latest');
    parseCount = 0; // count only the two openArchive parses below

    const first = view.openArchive(stale, { fileName: 'stale.mdz' });
    const second = view.openArchive(latest, { fileName: 'latest.mdz' });
    await Promise.all([first, second]);
    // Let the delayed stale continuation run; it must be discarded.
    await new Promise((resolve) => setTimeout(resolve, 80));

    const snapshot = await view.getCurrentSnapshot();
    assert.equal(snapshot?.state.fileName, 'latest.mdz');
  } finally {
    view.destroy();
    container.remove();
    MdzArchiveCore.openWorkspace = originalOpenWorkspace;
  }
});

test('nav tree draws per-row indent guides that do not overshoot the last child', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Root\n', 'Demo', [
    // Deep single-child chain: a clean staircase of elbows, no continuation.
    { archivePath: 'images/new-folder/new-folder/pasted.png', fileBytes: PNG_1X1 },
    // A non-last folder (f1, sorted before f2) whose spine must continue past
    // its child as a rail to reach the sibling below.
    { archivePath: 'parent/f1/x.md', fileBytes: new TextEncoder().encode('# x\n') },
    { archivePath: 'parent/f2/y.md', fileBytes: new TextEncoder().encode('# y\n') }
  ]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {});
  try {
    await view.openArchive(bytes, { fileName: 'demo.mdz' });
    const tree = container.querySelector('[data-ref="nav-tree"]');

    const signatureFor = (label) => {
      const row = [...tree.querySelectorAll('.nav-file, .nav-directory > summary')]
        .find((el) => el.querySelector('.nav-label')?.textContent === label);
      return [...row.querySelectorAll(':scope > .nav-indent')].map((cell) => {
        if (cell.classList.contains('nav-indent-connector')) {
          return cell.classList.contains('nav-indent-continues') ? 'tee' : 'elbow';
        }
        return cell.classList.contains('nav-indent-rail') ? 'rail' : 'blank';
      });
    };

    // Root entries carry no guides.
    assert.deepEqual(signatureFor('index.md'), []);
    assert.deepEqual(signatureFor('images'), []);
    // Deep single-child chain stays a staircase — the last child's rail stops
    // at its own elbow, so ancestor columns are blank (no overshoot).
    assert.deepEqual(signatureFor('pasted.png'), ['blank', 'blank', 'elbow']);
    // f1 is not the last child of parent, so its connector is a tee; the rail
    // then continues through f1's child to reach f2 below.
    assert.deepEqual(signatureFor('f1'), ['tee']);
    assert.deepEqual(signatureFor('x.md'), ['rail', 'elbow']);
    assert.deepEqual(signatureFor('f2'), ['elbow']);
    assert.deepEqual(signatureFor('y.md'), ['blank', 'elbow']);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('addAsset preserves the content of lazily-opened documents the user never visited', async () => {
  const seedBytes = await buildNewArchiveBytesWithTitle('# Entry\n', 'Lazy');
  const seedWorkspace = await MdzArchiveCore.openWorkspace(seedBytes);
  seedWorkspace.documents.push({
    path: 'chapter2.md',
    title: 'Chapter 2',
    text: '# Chapter 2\n',
    isEntryPoint: false
  });
  const seed = await MdzipWorkspaceService.openWorkspace(seedWorkspace, { mode: 'editable' });
  const twoDocBytes = await seed.saveToBytes();

  // MdzipWorkspaceService.open uses includeLazyDocumentReaders, so chapter2.md
  // has text '' plus a readText() reader until it is opened.
  const workspace = await MdzipWorkspaceService.open(twoDocBytes, { mode: 'editable' });
  await workspace.addAsset('images/new.png', PNG_1X1);

  assert.equal(
    await readTextFileFromArchive(workspace.snapshot().archiveBytes, 'chapter2.md'),
    '# Chapter 2\n'
  );
  const saved = await workspace.saveToBytes();
  assert.equal(await readTextFileFromArchive(saved, 'chapter2.md'), '# Chapter 2\n');
});

test('opening a lazy document whose readText reader was lost throws instead of rendering empty', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Entry\n', 'Lazy');
  const coreWorkspace = await MdzArchiveCore.openWorkspace(bytes);
  // Simulate a workspace that crossed a serialization boundary (postMessage):
  // the isLazy flag survives but the readText closure is dropped.
  coreWorkspace.documents.push({
    path: 'chapter2.md',
    title: 'Chapter 2',
    text: '',
    isEntryPoint: false,
    isLazy: true
  });
  const workspace = await MdzipWorkspaceService.openWorkspace(coreWorkspace, { mode: 'editable' });

  await assert.rejects(() => workspace.openPath('chapter2.md'), /ERR_LAZY_TEXT_UNAVAILABLE/);
});

test('setManifestTitle patches archive bytes without reading lazy documents', async () => {
  const seedWorkspace = await MdzArchiveCore.openWorkspace(await buildNewArchiveBytesWithTitle('# Entry\n', 'Before'));
  seedWorkspace.documents.push({
    path: 'chapter2.md',
    title: 'Chapter 2',
    text: '# Chapter 2\n',
    isEntryPoint: false
  });
  const seed = await MdzipWorkspaceService.openWorkspace(seedWorkspace, { mode: 'editable' });
  const twoDocBytes = await seed.saveToBytes();

  const workspace = await MdzipWorkspaceService.open(twoDocBytes, { mode: 'editable' });
  let lazyReads = 0;
  for (const doc of workspace.workspace.documents) {
    if (doc.readText) {
      const original = doc.readText;
      doc.readText = async () => {
        lazyReads++;
        return original();
      };
    }
  }

  await workspace.setManifestTitle('After');
  assert.equal(lazyReads, 0, 'manifest-only change must not resolve lazy documents');

  const saved = await workspace.saveToBytes();
  assert.equal((await openMdzArchive(saved)).manifest.title, 'After');
  assert.equal(await readTextFileFromArchive(saved, 'chapter2.md'), '# Chapter 2\n');
});

test('setManifestTitle on a pre-parsed workspace defers serialization until save', async () => {
  const core = await MdzArchiveCore.openWorkspace(await buildNewArchiveBytesWithTitle('# Entry\n', 'Before'));
  let lazyReads = 0;
  core.documents.push({
    path: 'chapter2.md',
    title: 'Chapter 2',
    text: '',
    isEntryPoint: false,
    isLazy: true,
    readText: async () => {
      lazyReads++;
      return '# Chapter 2\n';
    }
  });
  const workspace = await MdzipWorkspaceService.openWorkspace(core, { mode: 'editable' });

  await workspace.setManifestTitle('After');
  assert.equal(lazyReads, 0, 'no archive rebuild may happen for a manifest-only change');
  assert.equal(workspace.dirty, true);
  assert.equal(workspace.snapshot().displayTitle, 'After');
  assert.equal(workspace.manifest().title, 'After');

  const saved = await workspace.saveToBytes();
  assert.equal(lazyReads, 1, 'lazy text is read once, at serialization time');
  assert.equal((await openMdzArchive(saved)).manifest.title, 'After');
  assert.equal(await readTextFileFromArchive(saved, 'chapter2.md'), '# Chapter 2\n');
});

test('pastes an image through the framework-independent workspace service', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Original\n\n', 'Original');
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  const result = await workspace.pasteImage({
    bytes: PNG_1X1,
    mimeType: 'image/png',
    selectionStart: '# Original\n\n'.length,
    selectionEnd: '# Original\n\n'.length
  });

  assert.ok(result);
  assert.match(result.archivePath, /^images\/pasted-\d+\.png$/);
  assert.equal(result.markdownImage, `![Pasted image](${result.markdownPath})`);
  assert.equal(workspace.currentText, `# Original\n\n${result.markdownImage}`);
  assert.equal(workspace.snapshot().content.paths.some((entry) => entry.path === result.archivePath), true);

  const saved = await workspace.saveToBytes();
  assert.equal(await readTextFileFromArchive(saved, 'index.md'), `# Original\n\n${result.markdownImage}`);
});

test('pastes an image with caller-provided markup through the workspace service', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Original\n\n', 'Original');
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  const result = await workspace.pasteImage({
    bytes: PNG_1X1,
    mimeType: 'image/png',
    selectionStart: '# Original\n\n'.length,
    selectionEnd: '# Original\n\n'.length,
    markdownImage: (markdownPath) => `<img src="${markdownPath}" alt="Logo" width="320">`
  });

  assert.ok(result);
  assert.equal(result.markdownImage, `<img src="${result.markdownPath}" alt="Logo" width="320">`);
  assert.equal(workspace.currentText, `# Original\n\n${result.markdownImage}`);
});

test('image insert handler can choose HTML markup with sizing', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const requests = [];
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'source',
    initialColorScheme: 'light',
    imageInsertHandler: (request) => {
      requests.push(request);
      return {
        mode: 'html',
        altText: 'Custom logo',
        width: 320,
        position: 'center'
      };
    }
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Original\n\n', 'Original');
    await view.open(bytes, { mode: 'editable', fileName: 'demo.mdz' });
    const file = new window.File([PNG_1X1], 'logo.png', { type: 'image/png' });

    assert.equal(await view.executeCommand('insert-image', file), true);
    const snapshot = await view.getCurrentSnapshot();
    const markdown = await readTextFileFromArchive(
      new Uint8Array(await snapshot.bytes.arrayBuffer()),
      'index.md'
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].fileName, 'logo.png');
    assert.equal(requests[0].source, 'picker');
    assert.equal(requests[0].intrinsicWidth, 1);
    assert.match(markdown, /<p align="center"><img src="images\/pasted-\d+\.png" alt="Custom logo" width="320"><\/p>\n\n# Original/);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('image paste uses the image insert options path', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'source',
    initialColorScheme: 'light',
    imageInsertMode: 'html'
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Original\n\n', 'Original');
    await view.open(bytes, { mode: 'editable', fileName: 'demo.mdz' });
    const target = container.querySelector('.cm-content');
    assert.ok(target);
    const file = new window.File([PNG_1X1], 'pasted.png', { type: 'image/png' });
    const event = new window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: [file],
        items: [],
        getData: () => ''
      }
    });

    target.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const snapshot = await view.getCurrentSnapshot();
    const markdown = await readTextFileFromArchive(
      new Uint8Array(await snapshot.bytes.arrayBuffer()),
      'index.md'
    );
    assert.match(markdown, /<img src="images\/pasted-\d+\.png" alt="Pasted image" width="1" height="1">\n\n# Original/);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('image insert handler can cancel insertion cleanly', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'source',
    initialColorScheme: 'light',
    imageInsertHandler: () => null
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Original\n\n', 'Original');
    await view.open(bytes, { mode: 'editable', fileName: 'demo.mdz' });
    const file = new window.File([PNG_1X1], 'logo.png', { type: 'image/png' });

    assert.equal(await view.executeCommand('insert-image', file), true);
    const snapshot = await view.getCurrentSnapshot();
    const snapshotBytes = new Uint8Array(await snapshot.bytes.arrayBuffer());

    assert.equal(await readTextFileFromArchive(snapshotBytes, 'index.md'), '# Original\n\n');
    assert.equal((await openMdzArchive(snapshotBytes)).paths.some((entry) => entry.path.startsWith('images/pasted-')), false);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('built-in image insert dialog can insert sized HTML', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    imageInsertMode: 'ask',
    initialLayout: 'source',
    initialColorScheme: 'light'
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Original\n\n', 'Original');
    await view.open(bytes, { mode: 'editable', fileName: 'demo.mdz' });
    const file = new window.File([PNG_1X1], 'logo.png', { type: 'image/png' });

    const pending = view.executeCommand('insert-image', file);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dialog = container.querySelector('[data-ref="image-insert-dialog"]');
    const markdownMode = container.querySelector('[data-ref="image-insert-mode-markdown"]');
    const htmlMode = container.querySelector('[data-ref="image-insert-mode-html"]');
    const sizeModeSelect = container.querySelector('[data-ref="image-insert-size-mode"]');
    const sizeValueInput = container.querySelector('[data-ref="image-insert-size-value"]');
    const positionSelect = container.querySelector('[data-ref="image-insert-position"]');
    assert.equal(dialog.hidden, false);
    assert.equal(sizeModeSelect.disabled, true);
    assert.equal(sizeValueInput.disabled, true);
    assert.equal(positionSelect.disabled, true);
    htmlMode.checked = true;
    htmlMode.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(sizeModeSelect.disabled, false);
    assert.equal(sizeValueInput.disabled, false);
    assert.equal(positionSelect.disabled, false);
    sizeModeSelect.value = 'original';
    sizeModeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(sizeValueInput.disabled, true);
    markdownMode.checked = true;
    markdownMode.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(sizeModeSelect.disabled, true);
    htmlMode.checked = true;
    htmlMode.dispatchEvent(new window.Event('change', { bubbles: true }));
    container.querySelector('[data-ref="image-insert-alt"]').value = 'Dialog logo';
    sizeModeSelect.value = 'width';
    sizeModeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    sizeValueInput.value = '480';
    positionSelect.value = 'right';
    container.querySelector('[data-ref="image-insert-confirm-btn"]').click();

    await pending;
    const snapshot = await view.getCurrentSnapshot();
    const markdown = await readTextFileFromArchive(
      new Uint8Array(await snapshot.bytes.arrayBuffer()),
      'index.md'
    );
    assert.match(markdown, /<p align="right"><img src="images\/pasted-\d+\.png" alt="Dialog logo" width="480"><\/p>\n\n# Original/);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('built-in image insert dialog scales by percent without changing aspect ratio', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    imageInsertMode: 'ask',
    initialLayout: 'source',
    initialColorScheme: 'light'
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Original\n\n', 'Original');
    await view.open(bytes, { mode: 'editable', fileName: 'demo.mdz' });
    const file = new window.File([PNG_200X100_HEADER], 'wide.png', { type: 'image/png' });

    const pending = view.executeCommand('insert-image', file);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const htmlMode = container.querySelector('[data-ref="image-insert-mode-html"]');
    const sizeModeSelect = container.querySelector('[data-ref="image-insert-size-mode"]');
    const sizeValueInput = container.querySelector('[data-ref="image-insert-size-value"]');
    htmlMode.checked = true;
    htmlMode.dispatchEvent(new window.Event('change', { bubbles: true }));
    sizeModeSelect.value = 'percent';
    sizeModeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    sizeValueInput.value = '50';
    container.querySelector('[data-ref="image-insert-confirm-btn"]').click();

    await pending;
    const snapshot = await view.getCurrentSnapshot();
    const markdown = await readTextFileFromArchive(
      new Uint8Array(await snapshot.bytes.arrayBuffer()),
      'index.md'
    );
    assert.match(markdown, /<img src="images\/pasted-\d+\.png" alt="Pasted image" width="100" height="50">\n\n# Original/);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('built-in image insert dialog opens for every paste in ask mode', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    imageInsertMode: 'ask',
    initialLayout: 'source',
    initialColorScheme: 'light'
  });

  const pasteImage = async () => {
    const target = container.querySelector('.cm-content');
    assert.ok(target);
    const file = new window.File([PNG_1X1], 'pasted.png', { type: 'image/png' });
    const event = new window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: [file],
        items: [],
        getData: () => ''
      }
    });
    target.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Original\n\n', 'Original');
    await view.open(bytes, { mode: 'editable', fileName: 'demo.mdz' });
    const dialog = container.querySelector('[data-ref="image-insert-dialog"]');
    const confirm = container.querySelector('[data-ref="image-insert-confirm-btn"]');

    await pasteImage();
    assert.equal(dialog.hidden, false);
    confirm.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dialog.hidden, true);

    await pasteImage();
    assert.equal(dialog.hidden, false);
    confirm.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const snapshot = await view.getCurrentSnapshot();
    const markdown = await readTextFileFromArchive(
      new Uint8Array(await snapshot.bytes.arrayBuffer()),
      'index.md'
    );
    assert.equal((markdown.match(/!\[Pasted image\]\(images\/pasted-\d+\.png\)/g) ?? []).length, 2);
  } finally {
    view.destroy();
    container.remove();
  }
});

test('provides workspace view helpers outside framework wrappers', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Original\n', 'Original', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });
  const snapshot = workspace.snapshot();

  assert.equal(canEditMdzipPath(snapshot.currentPathType, snapshot.currentPath, snapshot.mode), true);
  assert.equal(canEditMdzipPath('text', 'manifest.json', 'editable'), false);

  const tree = buildMdzipNavTree(snapshot.content.paths);
  assert.equal(tree.some((node) => node.name === 'images'), true);
  assert.equal(tree.some((node) => node.name === 'index.md'), true);
});

test('nav tree pins the entry point and manifest before hash-named assets', () => {
  const entries = [
    { path: '42337a91.png', isMarkdown: false, isImage: true, isDirectory: false },
    { path: 'docs/start.md', isMarkdown: true, isImage: false, isDirectory: false },
    { path: '1f211f89.png', isMarkdown: false, isImage: true, isDirectory: false },
    { path: 'manifest.json', isMarkdown: false, isImage: false, isDirectory: false },
    { path: 'index.md', isMarkdown: true, isImage: false, isDirectory: false }
  ];

  assert.deepEqual(
    buildMdzipNavTree(entries, 'docs/start.md').map((node) => node.path),
    ['docs', 'manifest.json', '1f211f89.png', '42337a91.png', 'index.md']
  );
  assert.deepEqual(buildMdzipNavTree(entries, 'docs/start.md')[0].children.map((node) => node.path), ['docs/start.md']);
  assert.deepEqual(
    buildMdzipNavTree(entries, 'index.md').map((node) => node.path),
    ['index.md', 'manifest.json', '1f211f89.png', '42337a91.png', 'docs']
  );
});

test('resolves archive-local markdown preview links', () => {
  const entries = [
    { path: 'docs/index.md', isMarkdown: true, isImage: false, isDirectory: false },
    { path: 'docs/guide.md', isMarkdown: true, isImage: false, isDirectory: false },
    { path: 'appendix.md', isMarkdown: true, isImage: false, isDirectory: false },
    { path: 'docs/image.png', isMarkdown: false, isImage: true, isDirectory: false }
  ];

  assert.equal(resolveMdzipArchiveLinkTarget('guide.md', 'docs/index.md', entries), 'docs/guide.md');
  assert.equal(resolveMdzipArchiveLinkTarget('../appendix.md#notes', 'docs/index.md', entries), 'appendix.md');
  assert.equal(resolveMdzipArchiveLinkTarget('/docs/guide.md?x=1', 'docs/index.md', entries), 'docs/guide.md');
  assert.equal(resolveMdzipArchiveLinkTarget('image.png', 'docs/index.md', entries), null);
  assert.equal(resolveMdzipArchiveLinkTarget('https://example.com/guide.md', 'docs/index.md', entries), null);
});

test('resolves control policy presets for common host scenarios', () => {
  assert.deepEqual(resolveMdzipControlPolicy('viewer'), {
    preset: 'viewer',
    toolbar: true,
    navigation: true,
    title: { visible: true, editable: false },
    layout: { source: true, split: true, preview: true },
    formatting: {
      bold: false,
      italic: false,
      strikethrough: false,
      headings: [],
      bulletList: false,
      orderedList: false,
      inlineCode: false,
      codeBlock: false,
      blockquote: false,
      lineBreak: false,
      link: false,
      image: false
    },
    lineNumbers: true,
    save: false,
    zoom: true,
    colorScheme: true,
    orphanActions: false,
    fileActions: false
  });

  assert.equal(resolveMdzipControlPolicy('standalone-editor').save, true);
  assert.equal(resolveMdzipControlPolicy('hosted-editor').save, false);
  assert.equal(resolveMdzipControlPolicy(undefined).preset, 'standalone-editor');
});

test('resolves custom control policy overrides', () => {
  const policy = resolveMdzipControlPolicy({
    preset: 'hosted-editor',
    toolbar: false,
    title: { editable: false },
    layout: { split: false },
    formatting: {
      enabled: false,
      bold: true,
      italic: false,
      headings: [2, 3],
      image: false
    },
    lineNumbers: false,
    zoom: false,
    colorScheme: false
  });

  assert.equal(policy.preset, 'hosted-editor');
  assert.equal(policy.toolbar, false);
  assert.equal(policy.save, false);
  assert.equal(policy.navigation, true);
  assert.equal(policy.zoom, false);
  assert.equal(policy.colorScheme, false);
  assert.deepEqual(policy.title, { visible: true, editable: false });
  assert.deepEqual(policy.layout, { source: true, split: false, preview: true });
  assert.equal(policy.formatting.bold, true);
  assert.equal(policy.formatting.italic, false);
  assert.deepEqual(policy.formatting.headings, [2, 3]);
  assert.equal(policy.formatting.image, false);
  assert.equal(policy.formatting.lineBreak, false);
  assert.equal(policy.formatting.link, false);
  assert.equal(policy.lineNumbers, false);
});

test('keeps boolean control overrides backward compatible', () => {
  const policy = resolveMdzipControlPolicy({
    preset: 'standalone-editor',
    title: false,
    layout: false,
    formatting: false
  });

  assert.deepEqual(policy.title, { visible: false, editable: false });
  assert.deepEqual(policy.layout, { source: false, split: false, preview: false });
  assert.deepEqual(policy.formatting.headings, []);
  assert.equal(policy.formatting.bold, false);
});

test('routes public editor commands independently of toolbar visibility', async () => {
  const applied = [];
  const target = {
    ensureCmEditor: async () => ({}),
    canExecuteCommand: () => true,
    applyMarkdownFormat: (command) => applied.push(command)
  };

  assert.equal(
    await MdzipWorkspaceView.prototype.executeCommand.call(target, 'bold'),
    true
  );
  assert.deepEqual(applied, ['bold']);

  target.canExecuteCommand = () => false;
  assert.equal(
    await MdzipWorkspaceView.prototype.executeCommand.call(target, 'italic'),
    false
  );
  assert.deepEqual(applied, ['bold']);
});

test('link command selects the URL placeholder after insertion', () => {
  function runLinkCommand(doc, from, to) {
    let dispatched;
    let focused = false;
    const target = Object.assign(Object.create(MdzipWorkspaceView.prototype), {
      workspace: {
        snapshot: () => ({ mode: 'editable', currentPathType: 'markdown' })
      },
      cmEditor: {
        state: {
          selection: { main: { from, to } },
          sliceDoc: (start, end) => doc.slice(start, end)
        },
        dispatch: (transaction) => { dispatched = transaction; },
        focus: () => { focused = true; }
      }
    });
    MdzipWorkspaceView.prototype.applyMarkdownFormat.call(target, 'link');
    return { dispatched, focused };
  }

  const selected = runLinkCommand('OpenAI', 0, 6);
  assert.deepEqual(selected.dispatched.changes, {
    from: 0,
    to: 6,
    insert: '[OpenAI](url)'
  });
  assert.deepEqual(selected.dispatched.selection, { anchor: 9, head: 12 });
  assert.equal(selected.focused, true);

  const empty = runLinkCommand('', 0, 0);
  assert.deepEqual(empty.dispatched.changes, {
    from: 0,
    to: 0,
    insert: '[link text](url)'
  });
  assert.deepEqual(empty.dispatched.selection, { anchor: 12, head: 15 });
});

test('line break command inserts an explicit HTML hard break', () => {
  let dispatched;
  let focused = false;
  const target = Object.assign(Object.create(MdzipWorkspaceView.prototype), {
    workspace: {
      snapshot: () => ({ mode: 'editable', currentPathType: 'markdown' })
    },
    cmEditor: {
      state: {
        selection: { main: { from: 5, to: 5 } }
      },
      dispatch: (transaction) => { dispatched = transaction; },
      focus: () => { focused = true; }
    }
  });

  MdzipWorkspaceView.prototype.applyMarkdownFormat.call(target, 'insert-line-break');

  assert.deepEqual(dispatched.changes, {
    from: 5,
    to: 5,
    insert: '<br>\n'
  });
  assert.deepEqual(dispatched.selection, { anchor: 10 });
  assert.equal(focused, true);
});

test('line numbers toggle live without recreating the CodeMirror editor', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: { preset: 'standalone-editor', lineNumbers: true },
    initialLayout: 'source',
    initialColorScheme: 'light'
  });

  try {
    const bytes = await buildNewArchiveBytesWithTitle('# Lines\n\nbody\n', 'Lines');
    await view.open(bytes, { mode: 'editable', fileName: 'lines.mdz' });
    const editor = view.cmEditor;
    assert.ok(editor, 'CodeMirror editor was created');
    editor.dispatch({ selection: { anchor: 2 } });
    assert.ok(container.querySelector('.cm-lineNumbers'), 'line-number gutter starts visible');

    view.setControls({ preset: 'standalone-editor', lineNumbers: false });
    assert.equal(view.cmEditor, editor, 'editor instance is preserved');
    assert.equal(editor.state.doc.toString(), '# Lines\n\nbody\n');
    assert.equal(editor.state.selection.main.from, 2);
    assert.equal(container.querySelector('.cm-lineNumbers'), null, 'line-number gutter is removed');

    view.setControls({ preset: 'standalone-editor', lineNumbers: true });
    assert.equal(view.cmEditor, editor, 'editor instance is still preserved');
    assert.ok(container.querySelector('.cm-lineNumbers'), 'line-number gutter returns');
  } finally {
    view.destroy();
    container.remove();
  }
});

test('reports editor command availability from workspace state', () => {
  const editableMarkdown = {
    workspace: {
      snapshot: () => ({ mode: 'editable', currentPathType: 'markdown' })
    },
    cmEditor: {}
  };
  const readOnlyMarkdown = {
    workspace: {
      snapshot: () => ({ mode: 'read-only', currentPathType: 'markdown' })
    },
    cmEditor: {}
  };

  assert.equal(
    MdzipWorkspaceView.prototype.canExecuteCommand.call(editableMarkdown, 'bold'),
    true
  );
  assert.equal(
    MdzipWorkspaceView.prototype.canExecuteCommand.call(readOnlyMarkdown, 'bold'),
    false
  );
});

test('built-in save waits for host persistence acknowledgement', async () => {
  const savedBytes = new Uint8Array([1, 2, 3]);
  let emittedBytes;
  let emittedSnapshot;
  let markPersistedCalls = 0;
  let renderCalls = 0;
  const snapshot = { fileName: 'document.mdz', dirty: true };
  const target = {
    workspace: {
      flush: async () => ({
        bytes: new Blob([savedBytes]),
      }),
      snapshot: () => snapshot,
      markPersisted: () => {
        markPersistedCalls += 1;
      },
    },
    options: {
      onSaved: (bytes, nextSnapshot) => {
        emittedBytes = bytes;
        emittedSnapshot = nextSnapshot;
      },
    },
    render: () => {
      renderCalls += 1;
    },
  };

  await MdzipWorkspaceView.prototype.save.call(target);

  assert.deepEqual(emittedBytes, savedBytes);
  assert.equal(emittedSnapshot, snapshot);
  assert.equal(markPersistedCalls, 0);
  assert.equal(renderCalls, 1);
});

test('built-in save downloads and acknowledges when no host handler is provided', async () => {
  const savedBlob = new Blob([new Uint8Array([4, 5, 6])]);
  let downloaded;
  let markPersistedCalls = 0;
  const target = {
    workspace: {
      flush: async () => ({ bytes: savedBlob }),
      snapshot: () => ({ fileName: 'notes.md', dirty: true }),
      markPersisted: () => {
        markPersistedCalls += 1;
      },
    },
    options: {},
    downloadSavedBlob: (blob, fileName) => {
      downloaded = { blob, fileName };
    },
    render: () => {},
  };

  await MdzipWorkspaceView.prototype.save.call(target);

  assert.deepEqual(downloaded, { blob: savedBlob, fileName: 'notes.md' });
  assert.equal(markPersistedCalls, 1);
});

// --- Nav-pane file management (context menu feature set) ---

test('a markdown file added via addAsset becomes a document after reload', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Hello\n', 'Demo');
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  await workspace.addAsset('docs/extra.md', new TextEncoder().encode('# Extra\n'));

  const entry = workspace.snapshot().content.paths.find((item) => item.path === 'docs/extra.md');
  assert.ok(entry, 'new path appears in the archive');
  assert.equal(entry.isMarkdown, true);
  assert.ok(
    workspace.workspace.documents.some((doc) => doc.path === 'docs/extra.md'),
    'classified as a document, not an asset'
  );
});

test('removeFile deletes assets and non-entry documents but protects entry and manifest', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Hello\n', 'Demo', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });
  await workspace.addAsset('docs/extra.md', new TextEncoder().encode('# Extra\n'));

  assert.equal(await workspace.removeFile('index.md'), false, 'entry point is protected');
  assert.equal(await workspace.removeFile('manifest.json'), false, 'manifest is protected');
  assert.equal(await workspace.removeFile('missing.txt'), false, 'unknown path rejected');

  assert.equal(await workspace.removeFile('images/logo.png'), true, 'asset removed');
  assert.equal(await workspace.removeFile('docs/extra.md'), true, 'document removed');

  const paths = workspace.snapshot().content.paths.map((entry) => entry.path);
  assert.deepEqual(paths.sort(), ['index.md', 'manifest.json']);

  const saved = await workspace.saveToBytes();
  const reopened = await MdzipWorkspaceService.open(saved, { mode: 'read-only' });
  assert.deepEqual(
    reopened.snapshot().content.paths.map((entry) => entry.path).sort(),
    ['index.md', 'manifest.json']
  );
});

test('setEntryPoint promotes a document and persists through save', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Main\n', 'Demo');
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });
  await workspace.addAsset('docs/extra.md', new TextEncoder().encode('# Extra\n'));

  assert.equal(await workspace.setEntryPoint('index.md'), false, 'already the entry');
  assert.equal(await workspace.setEntryPoint('nope.md'), false, 'unknown path');

  assert.equal(await workspace.setEntryPoint('docs/extra.md'), true);
  const snapshot = workspace.snapshot();
  assert.equal(snapshot.content.entryPoint, 'docs/extra.md');
  assert.equal(snapshot.content.manifest.entryPoint, 'docs/extra.md');
  assert.equal(snapshot.content.markdownText, '# Extra\n');

  assert.equal(await workspace.removeFile('index.md'), true, 'old entry is now deletable');

  const saved = await workspace.saveToBytes();
  const reopened = await MdzipWorkspaceService.open(saved, { mode: 'read-only' });
  assert.equal(reopened.snapshot().content.entryPoint, 'docs/extra.md');
});

test('renameFile moves an asset and rewrites markdown references', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Hello\n\n![Logo](images/logo.png)\n', 'Demo', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  assert.equal(await workspace.renameFile('images/logo.png', 'assets/brand.png'), true);

  const paths = workspace.snapshot().content.paths.map((entry) => entry.path);
  assert.ok(paths.includes('assets/brand.png'));
  assert.ok(!paths.includes('images/logo.png'));
  assert.equal(workspace.currentText, '# Hello\n\n![Logo](assets/brand.png)\n');

  const saved = await workspace.saveToBytes();
  assert.equal(
    await readTextFileFromArchive(saved, 'index.md'),
    '# Hello\n\n![Logo](assets/brand.png)\n'
  );
});

test('renameFile rejects collisions, manifest, and invalid paths', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Hello\n', 'Demo', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  assert.equal(await workspace.renameFile('images/logo.png', 'index.md'), false, 'collision');
  assert.equal(await workspace.renameFile('images/logo.png', 'manifest.json'), false, 'reserved');
  assert.equal(await workspace.renameFile('images/logo.png', '../escape.png'), false, 'dot-dot');
  assert.equal(await workspace.renameFile('manifest.json', 'other.json'), false, 'manifest source');
  assert.equal(await workspace.renameFile('images/logo.png', 'images/logo.png'), false, 'no-op');
});

test('renameFile moves the entry document, updating manifest and its own refs', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Main\n\n![Logo](images/logo.png)\n', 'Demo', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  assert.equal(await workspace.renameFile('index.md', 'docs/main.md'), true);

  const snapshot = workspace.snapshot();
  assert.equal(snapshot.content.entryPoint, 'docs/main.md');
  assert.equal(snapshot.content.manifest.entryPoint, 'docs/main.md');
  assert.equal(snapshot.currentPath, 'docs/main.md');
  assert.equal(snapshot.currentText, '# Main\n\n![Logo](../images/logo.png)\n');
});

test('setCoverImage sets and clears the manifest cover for image assets only', async () => {
  const bytes = await buildNewArchiveBytesWithTitle('# Hello\n', 'Demo', [
    { archivePath: 'images/logo.png', fileBytes: PNG_1X1 }
  ]);
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable' });

  assert.equal(await workspace.setCoverImage('index.md'), false, 'not an image');
  assert.equal(await workspace.setCoverImage('images/logo.png'), true);
  assert.equal(workspace.snapshot().content.manifest.cover, 'images/logo.png');

  assert.equal(await workspace.setCoverImage(null), true);
  assert.ok(!workspace.snapshot().content.manifest.cover, 'cover cleared');
});

test('resolves fileActions per control preset', () => {
  assert.equal(resolveMdzipControlPolicy('preview').fileActions, false);
  assert.equal(resolveMdzipControlPolicy('viewer').fileActions, false);
  assert.equal(resolveMdzipControlPolicy('standalone-editor').fileActions, true);
  assert.equal(resolveMdzipControlPolicy('hosted-editor').fileActions, true);
  assert.equal(
    resolveMdzipControlPolicy({ preset: 'viewer', fileActions: true }).fileActions,
    true
  );
});

test('normalizes and relativizes archive paths', () => {
  assert.equal(normalizeArchivePath('a\\b\\c.md'), 'a/b/c.md');
  assert.equal(normalizeArchivePath('/a//b/'), 'a/b');
  assert.equal(normalizeArchivePath('a/../b'), null);
  assert.equal(normalizeArchivePath('   '), null);
  assert.equal(relativeArchivePath('', 'images/x.png'), 'images/x.png');
  assert.equal(relativeArchivePath('docs', 'images/x.png'), '../images/x.png');
  assert.equal(relativeArchivePath('docs', 'docs/a.md'), 'a.md');
  assert.equal(relativeArchivePath('a/b', 'a/c/d.md'), '../c/d.md');
});

// --- onConversionRequested host hook ---

const conversionHookTarget = (hook, onFailed) => {
  const calls = { dialog: 0 };
  const state = {
    mode: 'editable',
    sourceFormat: 'markdown',
    currentPath: 'notes.md',
    currentText: 'before after'
  };
  const workspace = {
    snapshot: () => ({ ...state }),
    editText: (text) => { state.currentText = text; }
  };
  const editor = {
    state: { selection: { main: { from: 7, to: 7 } } },
    dispatch: () => {},
    focus: () => {}
  };
  const target = {
    workspace,
    cmEditor: editor,
    options: { onConversionRequested: hook, onFailed },
    conversionHookPending: false,
    openConversionDialog: () => { calls.dialog += 1; },
    createConversionContext: MdzipWorkspaceView.prototype.createConversionContext,
    ensureCmEditor: async () => editor,
    convertToMdz: async () => true,
    render: () => {}
  };
  return { target, calls, state };
};

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

test('onConversionRequested=true suppresses the built-in conversion dialog', async () => {
  const seen = [];
  const { target, calls } = conversionHookTarget((action) => { seen.push(action); return true; });

  MdzipWorkspaceView.prototype.requestMdzConversion.call(target, { kind: 'image-picker' });
  await flushMicrotasks();

  assert.deepEqual(seen, [{ kind: 'image-picker' }]);
  assert.equal(calls.dialog, 0);
});

test('onConversionRequested=false falls through to the built-in dialog', async () => {
  const { target, calls } = conversionHookTarget(async () => false);

  MdzipWorkspaceView.prototype.requestMdzConversion.call(target, { kind: 'navigation' });
  await flushMicrotasks();

  assert.equal(calls.dialog, 1);
});

test('a rejecting onConversionRequested reports onFailed and shows the dialog', async () => {
  const failures = [];
  const { target, calls } = conversionHookTarget(
    () => Promise.reject(new Error('host broke')),
    (error) => failures.push(error)
  );

  MdzipWorkspaceView.prototype.requestMdzConversion.call(target, { kind: 'navigation' });
  await flushMicrotasks();

  assert.equal(failures.length, 1);
  assert.equal(calls.dialog, 1);
});

test('a pending onConversionRequested blocks duplicate triggers', async () => {
  let resolveHook;
  let hookCalls = 0;
  const { target, calls } = conversionHookTarget(() => {
    hookCalls += 1;
    return new Promise((resolve) => { resolveHook = resolve; });
  });

  MdzipWorkspaceView.prototype.requestMdzConversion.call(target, { kind: 'image-picker' });
  await flushMicrotasks();
  MdzipWorkspaceView.prototype.requestMdzConversion.call(target, { kind: 'image-picker' });
  await flushMicrotasks();
  assert.equal(hookCalls, 1, 'second trigger ignored while pending');

  resolveHook(true);
  await flushMicrotasks();
  assert.equal(calls.dialog, 0);
});

test('conversion context inserts markdown at the captured selection', async () => {
  let context;
  const { target, state } = conversionHookTarget((_action, suppliedContext) => {
    context = suppliedContext;
    return true;
  });

  MdzipWorkspaceView.prototype.requestMdzConversion.call(target, { kind: 'image-picker' });
  await flushMicrotasks();

  assert.equal(await context.insertMarkdown('linked '), true);
  assert.equal(state.currentText, 'before linked after');
  assert.equal(await context.insertMarkdown('again'), false, 'context is one-shot');
});

test('conversion context rejects insertion after the document changes', async () => {
  let context;
  const { target, state } = conversionHookTarget((_action, suppliedContext) => {
    context = suppliedContext;
    return true;
  });

  MdzipWorkspaceView.prototype.requestMdzConversion.call(target, { kind: 'image-picker' });
  await flushMicrotasks();
  state.currentText = 'changed elsewhere';

  assert.equal(await context.insertMarkdown('unsafe'), false);
  assert.equal(state.currentText, 'changed elsewhere');
});
