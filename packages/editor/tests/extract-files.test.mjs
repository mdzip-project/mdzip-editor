import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8 } from 'fflate';

// Selecting rows of the file tree and taking files out of the archive (#69):
// Extract… through the host's onExtractFiles, else Download / Download as ZIP.
if (typeof globalThis.window === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
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
  globalThis.URL.revokeObjectURL = () => {};
}
// Capture what Download / Download as ZIP saves.
const saved = [];
window.URL.createObjectURL = (blob) => { saved.push(blob); return 'blob:test'; };
window.URL.revokeObjectURL = () => {};

const { MdzPackagerCore } = await import('@mdzip/core-js');
const { MdzipWorkspaceView } = await import('../dist/index.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 250]);

async function mount({ mode = 'editable', onExtractFiles, picker } = {}) {
  const { blob } = await MdzPackagerCore.buildArchive([
    { path: 'index.md', text: '# Notes\n\n![a](images/a.png)\n' },
    { path: 'images/a.png', data: PNG },
    { path: 'images/icons/b.svg', text: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
    { path: 'notes/more.md', text: '# More\n' }
  ], 'Notes', { title: 'Notes', entryPoint: 'index.md', createIndex: false, mapFiles: false, filters: ['**/*'] });
  if (picker) {
    window.showDirectoryPicker = picker;
  } else {
    delete window.showDirectoryPicker;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor', initialLayout: 'preview', initialColorScheme: 'light', onExtractFiles
  });
  await view.open(new Uint8Array(await blob.arrayBuffer()), { mode, fileName: 'notes.mdz' });
  await wait(50);
  const row = (key) => key.startsWith('d:')
    ? container.querySelector(`details[data-nav-dir="${key.slice(2)}"] > summary`)
    : container.querySelector(`[data-nav-path="${key.slice(2)}"]`);
  const click = (key, init = {}) => row(key).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  const menu = (key) => {
    const target = key === '' ? container.querySelector('[data-ref="nav-tree"]') : row(key);
    target.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    return container.querySelector('[data-ref="nav-menu"]');
  };
  const selected = () => [...container.querySelectorAll('.nav-selected')]
    .map((el) => el.matches('summary') ? `d:${el.parentElement.getAttribute('data-nav-dir')}` : `f:${el.getAttribute('data-nav-path')}`);
  return { view, container, row, click, menu, selected, cleanup: () => { view.destroy(); container.remove(); } };
}

const labels = (menu) => [...menu.querySelectorAll('[data-menu-action]')].map((button) => button.textContent.trim());
const text = (bytes) => new TextDecoder().decode(bytes);

test('extractFiles(): files by path, folders by their files, manifest.json only when named', async () => {
  const { view, cleanup } = await mount();
  try {
    let files = await view.extractFiles(['images/']);
    assert.deepEqual(files.map((f) => f.path), ['images/a.png', 'images/icons/b.svg']);
    assert.deepEqual([...files[0].bytes], [...PNG], 'bytes as stored');
    files = await view.extractFiles(['']);
    assert.ok(!files.some((f) => f.path === 'manifest.json'), 'the whole archive leaves out the manifest');
    assert.equal(files.length, 4);
    files = await view.extractFiles(['manifest.json', 'notes/more.md', 'nothing-here']);
    assert.deepEqual(files.map((f) => f.path), ['manifest.json', 'notes/more.md']);
    assert.deepEqual(await view.extractFiles(['images'], { includeFolders: false }), []);
  } finally {
    cleanup();
  }
});

test('Ctrl/Cmd+click toggles rows, Shift+click selects a range, Ctrl+A selects all', async () => {
  const { container, click, selected, cleanup } = await mount();
  try {
    click('f:index.md');
    assert.deepEqual(selected(), ['f:index.md']);
    click('f:notes/more.md', { ctrlKey: true });
    assert.deepEqual(selected().sort(), ['f:index.md', 'f:notes/more.md']);
    click('f:index.md', { metaKey: true });
    assert.deepEqual(selected(), ['f:notes/more.md'], 'toggled off');
    click('d:images');
    assert.deepEqual(selected(), ['d:images'], 'a plain click selects the folder');
    container.querySelector('details[data-nav-dir="images"]').open = true;
    click('f:images/a.png', { shiftKey: true });
    assert.deepEqual(selected(), ['d:images', 'f:images/a.png']);
    click('d:images', { ctrlKey: true });
    assert.equal(container.querySelector('details[data-nav-dir="images"]').open, true, 'Ctrl+click does not close a folder');
    const tree = container.querySelector('[data-ref="nav-tree"]');
    tree.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    assert.ok(selected().length >= 7, selected().join(' '));
    tree.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.deepEqual(selected(), []);
  } finally {
    cleanup();
  }
});

test('a closed folder stays closed when the tree is drawn again', async () => {
  const { view, container, cleanup } = await mount();
  try {
    const details = container.querySelector('details[data-nav-dir="images"]');
    details.open = false;
    details.dispatchEvent(new window.Event('toggle'));
    await view.openPath('notes/more.md');
    await wait(20);
    assert.equal(container.querySelector('details[data-nav-dir="images"]').open, false);
  } finally {
    cleanup();
  }
});

test('with onExtractFiles, the menu says Extract… and the host gets the files; the archive is unchanged', async () => {
  const requests = [];
  const { view, click, menu, selected, cleanup } = await mount({
    mode: 'read-only', onExtractFiles: (request) => { requests.push(request); }
  });
  try {
    assert.deepEqual(labels(menu('f:images/a.png')).filter((l) => /Extract|Download/.test(l)), ['Extract…']);
    assert.deepEqual(labels(menu('d:images')), ['Extract…'], 'read-only folders still extract');
    assert.deepEqual(labels(menu('')), ['Extract All…']);

    click('d:images');
    click('f:notes/more.md', { ctrlKey: true });
    const m = menu('f:notes/more.md');
    assert.deepEqual(selected().sort(), ['d:images', 'f:notes/more.md'], 'right-click inside the selection keeps it');
    assert.deepEqual(labels(m), ['Extract…'], 'several rows: only Extract…');
    m.querySelector('[data-menu-action="extract"]').click();
    await wait(30);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].selection, { files: ['notes/more.md'], folders: ['images'] });
    assert.deepEqual(requests[0].files.map((f) => f.path), ['images/a.png', 'images/icons/b.svg', 'notes/more.md']);
    assert.equal(text(requests[0].files[2].bytes), '# More\n');

    menu('f:index.md');
    assert.deepEqual(selected(), ['f:index.md'], 'right-click outside the selection selects just that row');
    assert.equal(view.workspace.dirty, false);
  } finally {
    cleanup();
  }
});

test('without onExtractFiles: Download for one file, Download as ZIP for folders and selections', async () => {
  const { click, menu, cleanup } = await mount();
  try {
    assert.ok(labels(menu('f:images/a.png')).includes('Download'));
    assert.ok(!labels(menu('f:images/a.png')).some((l) => /Extract|ZIP/.test(l)));
    const m = menu('d:images');
    assert.ok(labels(m).includes('Download as ZIP'), labels(m).join(' | '));
    assert.ok(!labels(m).includes('Extract to Folder…'), 'no folder picker in this browser');
    saved.length = 0;
    m.querySelector('[data-menu-action="download-zip"]').click();
    for (let i = 0; i < 100 && !saved.length; i += 1) await wait(10);
    const zip = unzipSync(new Uint8Array(await saved[0].arrayBuffer()));
    assert.deepEqual(Object.keys(zip).sort(), ['images/a.png', 'images/icons/b.svg']);
    assert.deepEqual([...zip['images/a.png']], [...PNG]);

    click('f:index.md');
    click('f:manifest.json', { ctrlKey: true });
    const many = menu('f:index.md');
    assert.deepEqual(labels(many), ['Download as ZIP']);
    saved.length = 0;
    many.querySelector('[data-menu-action="download-zip"]').click();
    for (let i = 0; i < 100 && !saved.length; i += 1) await wait(10);
    const both = unzipSync(new Uint8Array(await saved[0].arrayBuffer()));
    assert.deepEqual(Object.keys(both).sort(), ['index.md', 'manifest.json'], 'a selected manifest is included');
    assert.match(strFromU8(both['manifest.json']), /"title"/);
  } finally {
    cleanup();
  }
});

test('Extract to Folder… writes into the picked folder, asking before replacing', async () => {
  // A minimal in-memory File System Access directory.
  const makeDir = (name) => {
    const dirs = new Map();
    const files = new Map();
    return {
      name, dirs, files,
      async getDirectoryHandle(part, { create } = {}) {
        if (!dirs.has(part)) {
          if (!create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
          dirs.set(part, makeDir(part));
        }
        return dirs.get(part);
      },
      async getFileHandle(part, { create } = {}) {
        if (!files.has(part) && !create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
        return {
          async createWritable() {
            return { async write(data) { files.set(part, data); }, async close() {} };
          }
        };
      }
    };
  };
  const root = makeDir('out');
  root.dirs.set('images', makeDir('images'));
  root.dirs.get('images').files.set('a.png', new Uint8Array([0]));
  const { container, menu, cleanup } = await mount({ picker: async () => root });
  try {
    const m = menu('d:images');
    assert.ok(labels(m).includes('Extract to Folder…'));
    m.querySelector('[data-menu-action="extract-folder"]').click();
    const dialog = container.querySelector('[data-ref="confirm-dialog"]');
    for (let i = 0; i < 100 && dialog.hidden; i += 1) await wait(10);
    assert.equal(dialog.hidden, false, 'asks before replacing');
    assert.match(dialog.textContent, /One file of the 2 already exists in "out"/);
    container.querySelector('[data-ref="confirm-dialog-ok"]').click();
    for (let i = 0; i < 100 && !root.dirs.get('images').dirs.get('icons'); i += 1) await wait(10);
    assert.deepEqual([...root.dirs.get('images').files.get('a.png')], [...PNG], 'replaced');
    assert.ok(root.dirs.get('images').dirs.get('icons').files.get('b.svg'));
  } finally {
    cleanup();
    delete window.showDirectoryPicker;
  }
});
