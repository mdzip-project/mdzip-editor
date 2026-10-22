import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Host-defined items in the file tree's right-click menu (hostFileActions).
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
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.URL.createObjectURL = () => 'blob:test';
  globalThis.URL.revokeObjectURL = () => {};
}

const { MdzPackagerCore } = await import('@mdzip/core-js');
const { MdzipWorkspaceView } = await import('../dist/index.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount({ mode = 'editable', hostFileActions, resolveDroppedUris } = {}) {
  const { blob } = await MdzPackagerCore.buildArchive([
    { path: 'index.md', text: '# Notes\n' },
    { path: 'diagrams/system.drawio.svg', text: '<svg xmlns="http://www.w3.org/2000/svg"/>' }
  ], 'Notes', { title: 'Notes', entryPoint: 'index.md', createIndex: false, mapFiles: false, filters: ['**/*'] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'preview',
    initialColorScheme: 'light',
    hostFileActions,
    resolveDroppedUris
  });
  await view.open(new Uint8Array(await blob.arrayBuffer()), { mode, fileName: 'notes.mdz' });
  await wait(50);
  return { view, container, cleanup: () => { view.destroy(); container.remove(); } };
}

function openFileMenu(container, path) {
  const item = container.querySelector(`[data-nav-path="${path}"]`);
  assert.ok(item, `no file tree item for ${path}`);
  item.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  return container.querySelector('[data-ref="nav-menu"]');
}

const menuLabels = (menu) => [...menu.querySelectorAll('[data-menu-action]')].map((button) => button.textContent.trim());

test('a host file action shows on the files it applies to and runs with the file', async () => {
  const runs = [];
  const { container, cleanup } = await mount({
    hostFileActions: [{
      id: 'open-in-host',
      label: 'Open in Host Editor',
      appliesTo: (file) => !file.isMarkdown,
      run: (file) => { runs.push(file); }
    }]
  });
  try {
    let menu = openFileMenu(container, 'diagrams/system.drawio.svg');
    const labels = menuLabels(menu);
    assert.ok(labels.includes('Open in Host Editor'), labels.join(' | '));
    assert.ok(labels.indexOf('Open in Host Editor') < labels.indexOf('Download'), 'sits above Download');
    menu.querySelector('[data-menu-action="host:open-in-host"]').click();
    await wait(10);
    assert.deepEqual(runs, [{
      path: 'diagrams/system.drawio.svg', isMarkdown: false, isImage: true, isManifest: false, isEntryPoint: false
    }]);

    menu = openFileMenu(container, 'index.md');
    assert.ok(!menuLabels(menu).includes('Open in Host Editor'), 'appliesTo leaves it off Markdown files');
  } finally {
    cleanup();
  }
});

test('host file actions show in read-only workspaces and on manifest.json', async () => {
  const { container, cleanup } = await mount({
    mode: 'read-only',
    hostFileActions: [{ id: 'open', label: 'Open Elsewhere', run: () => {} }]
  });
  try {
    assert.ok(menuLabels(openFileMenu(container, 'diagrams/system.drawio.svg')).includes('Open Elsewhere'));
    assert.deepEqual(menuLabels(openFileMenu(container, 'manifest.json')), ['Open Elsewhere', 'Download']);
  } finally {
    cleanup();
  }
});

test('no hostFileActions leaves the menu as it was', async () => {
  const { container, cleanup } = await mount();
  try {
    assert.ok(!menuLabels(openFileMenu(container, 'diagrams/system.drawio.svg')).some((label) => /Host|Elsewhere/.test(label)));
  } finally {
    cleanup();
  }
});

function openFolderMenu(container, dir) {
  const target = dir ? container.querySelector(`details[data-nav-dir="${dir}"] > summary`) : container.querySelector('[data-ref="nav-tree"]');
  assert.ok(target, `no folder ${dir || '(root)'}`);
  target.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  return container.querySelector('[data-ref="nav-menu"]');
}

async function waitForPath(container, path) {
  for (let i = 0; i < 100 && !container.querySelector(`[data-nav-path="${path}"]`); i += 1) await wait(10);
  return container.querySelector(`[data-nav-path="${path}"]`);
}

test('Add Files… on a folder adds the picked files to that folder', async () => {
  const { container, cleanup } = await mount();
  try {
    const menu = openFolderMenu(container, 'diagrams');
    assert.ok(menuLabels(menu).includes('Add Files…'), menuLabels(menu).join(' | '));
    const input = container.querySelector('[data-ref="add-files-input"]');
    assert.equal(input.multiple, true);
    let opened = false;
    input.click = () => { opened = true; };
    menu.querySelector('[data-menu-action="add-files"]').click();
    await wait(10);
    assert.ok(opened, 'the file picker opened');
    Object.defineProperty(input, 'files', { configurable: true, value: [
      new window.File(['a'], 'notes.pdf'), new window.File(['b'], 'data.json')
    ] });
    input.dispatchEvent(new window.Event('change'));
    assert.ok(await waitForPath(container, 'diagrams/notes.pdf'), 'notes.pdf added to diagrams/');
    assert.ok(await waitForPath(container, 'diagrams/data.json'), 'data.json added to diagrams/');
  } finally {
    cleanup();
  }
});

test('Add Files… is not offered in a read-only workspace', async () => {
  const { container, cleanup } = await mount({ mode: 'read-only' });
  try {
    const menu = openFolderMenu(container, 'diagrams');
    assert.ok(!menuLabels(menu).includes('Add Files…'));
  } finally {
    cleanup();
  }
});

function dropUris(target, uris) {
  const event = new window.Event('drop', { bubbles: true, cancelable: true });
  const types = ['text/uri-list'];
  Object.defineProperty(event, 'dataTransfer', { value: {
    types, files: [], getData: (type) => (types.includes(type) ? `# from a test\r\n${uris.join('\r\n')}\r\n` : '')
  } });
  target.dispatchEvent(event);
  return event;
}

test('a drop that carries only file URIs is read through resolveDroppedUris and added', async () => {
  const asked = [];
  const { container, cleanup } = await mount({
    resolveDroppedUris: async (uris) => {
      asked.push(...uris);
      return [{ name: 'dropped.txt', bytes: new TextEncoder().encode('hello') }];
    }
  });
  try {
    const folder = container.querySelector('details[data-nav-dir="diagrams"]');
    const event = dropUris(folder, ['file:///c%3A/work/dropped.txt']);
    assert.equal(event.defaultPrevented, true);
    assert.ok(await waitForPath(container, 'diagrams/dropped.txt'), 'dropped.txt added to diagrams/');
    assert.deepEqual(asked, ['file:///c%3A/work/dropped.txt']);
  } finally {
    cleanup();
  }
});

test('without resolveDroppedUris, a URI-only drop is left to the host', async () => {
  const { container, cleanup } = await mount();
  try {
    const event = dropUris(container.querySelector('details[data-nav-dir="diagrams"]'), ['file:///c%3A/work/x.txt']);
    assert.equal(event.defaultPrevented, false);
  } finally {
    cleanup();
  }
});
