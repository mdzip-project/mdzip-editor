import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// The card shown in place of a file the preview can't show (a Word document):
// what it is, the host's file actions (primary first), Extract… and Replace….
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
// Not text: a ZIP header and some bytes that aren't UTF-8.
const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0xff, 0xfe, 0x00, 0x81, 0x90]);

async function mount({ mode = 'editable', hostFileActions, fileNote, onExtractFiles, fileCardHelp } = {}) {
  const { blob } = await MdzPackagerCore.buildArchive([
    { path: 'index.md', text: '# Notes\n' },
    { path: 'styles/reference.docx', data: DOCX }
  ], 'Notes', { title: 'Notes', entryPoint: 'index.md', createIndex: false, mapFiles: false, filters: ['**/*'] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls: 'standalone-editor',
    initialLayout: 'preview',
    initialColorScheme: 'light',
    hostFileActions,
    fileNote,
    onExtractFiles,
    fileCardHelp
  });
  await view.open(new Uint8Array(await blob.arrayBuffer()), { mode, fileName: 'notes.mdz' });
  await view.openPath('styles/reference.docx');
  await wait(50);
  return { view, container, cleanup: () => { view.destroy(); container.remove(); } };
}

const card = (container) => container.querySelector('.mdzip-file-card');
const buttons = (container) => [...card(container).querySelectorAll('.mdzip-file-card-action')];
const labels = (container) => buttons(container).map((button) => button.textContent.trim());

test("a file the preview can't show gets a card saying what it is, with Extract… and Replace…", async () => {
  const { container, cleanup } = await mount({ onExtractFiles: () => {} });
  try {
    assert.ok(card(container), 'no file card');
    assert.equal(container.querySelector('.asset-preview-empty'), null);
    assert.equal(card(container).querySelector('.mdzip-file-card-title').textContent, 'reference.docx');
    assert.equal(card(container).querySelector('.mdzip-file-card-file').textContent, 'Word document · styles/reference.docx');
    assert.deepEqual(labels(container), ['Extract…', 'Replace…']);
  } finally {
    cleanup();
  }
});

test('the primary host action comes first, named for the file, and runs with it', async () => {
  const runs = [];
  const { container, cleanup } = await mount({
    onExtractFiles: () => {},
    hostFileActions: [
      { id: 'open-with', label: 'Open With…', run: () => {} },
      {
        id: 'open',
        primary: true,
        label: (file) => (file.path.endsWith('.docx') ? 'Open in Word' : 'Open in Default App'),
        appliesTo: (file) => !file.isMarkdown,
        run: (file) => { runs.push(file.path); }
      }
    ]
  });
  try {
    assert.deepEqual(labels(container), ['Open in Word', 'Open With…', 'Extract…', 'Replace…']);
    assert.ok(buttons(container)[0].classList.contains('mdzip-file-card-primary'));
    assert.ok(!buttons(container)[1].classList.contains('mdzip-file-card-primary'));
    buttons(container)[0].click();
    await wait(10);
    assert.deepEqual(runs, ['styles/reference.docx']);

    // The contents pane's menu names it for the file too.
    const item = container.querySelector('[data-nav-path="styles/reference.docx"]');
    item.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    const menu = container.querySelector('[data-ref="nav-menu"]');
    const menuLabels = [...menu.querySelectorAll('[data-menu-action]')].map((button) => button.textContent.trim());
    assert.ok(menuLabels.includes('Open in Word'), menuLabels.join(' | '));
  } finally {
    cleanup();
  }
});

test('under the buttons, what each one does; then the host\'s help link', async () => {
  const helped = [];
  const { container, cleanup } = await mount({
    onExtractFiles: () => {},
    hostFileActions: [{ id: 'open', primary: true, label: 'Open in Word', description: 'Opens it in Word.', run: () => {} }],
    fileCardHelp: { label: 'More about files in a document', run: (file) => { helped.push(file.path); } }
  });
  try {
    const explained = [...card(container).querySelectorAll('.mdzip-file-card-explain li')].map((item) => item.textContent);
    assert.equal(explained.length, 3);
    assert.equal(explained[0], 'Open in Word Opens it in Word.');
    assert.match(explained[1], /^Extract… Saves a copy of the file outside the document/);
    assert.match(explained[2], /^Replace… Puts a file you choose in its place, still named reference\.docx\./);
    const link = card(container).querySelector('.mdzip-file-card-help');
    assert.equal(link.textContent, 'More about files in a document');
    link.click();
    await wait(10);
    assert.deepEqual(helped, ['styles/reference.docx']);
  } finally {
    cleanup();
  }
});

test("Extract… gives the host the file's bytes", async () => {
  const requests = [];
  const { container, cleanup } = await mount({ onExtractFiles: (request) => { requests.push(request); } });
  try {
    buttons(container).find((button) => button.textContent.trim() === 'Extract…').click();
    await wait(50);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].selection, { files: ['styles/reference.docx'], folders: [] });
    assert.deepEqual([...requests[0].files[0].bytes], [...DOCX]);
  } finally {
    cleanup();
  }
});

test("the host's note shows, and refreshFileActions() asks for it and the labels again", async () => {
  let editing = false;
  const { view, container, cleanup } = await mount({
    hostFileActions: [{ id: 'open', primary: true, label: () => (editing ? 'Show in Word' : 'Open in Word'), run: () => {} }],
    fileNote: () => (editing ? 'Open in Word: changes come back each time you save there.' : null)
  });
  try {
    assert.equal(card(container).querySelector('.mdzip-file-card-note'), null);
    assert.equal(labels(container)[0], 'Open in Word');
    editing = true;
    view.refreshFileActions();
    assert.equal(card(container).querySelector('.mdzip-file-card-note').textContent,
      'Open in Word: changes come back each time you save there.');
    assert.equal(labels(container)[0], 'Show in Word');
  } finally {
    cleanup();
  }
});

test('a read-only document has no Replace…, and without onExtractFiles it offers Download', async () => {
  const { container, cleanup } = await mount({ mode: 'read-only' });
  try {
    assert.deepEqual(labels(container), ['Download']);
  } finally {
    cleanup();
  }
});
