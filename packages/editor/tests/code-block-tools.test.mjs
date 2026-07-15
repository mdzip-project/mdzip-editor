import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// The default renderer sanitizes through DOMPurify, which needs a DOM window
// in Node. The library resolves it lazily from globalThis.window.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = new JSDOM('<!doctype html><html><body></body></html>').window;
}
globalThis.document = globalThis.window.document;
globalThis.HTMLElement = globalThis.window.HTMLElement;
globalThis.Node = globalThis.window.Node;

import { MdzipWorkspaceView, buildNewArchiveBytesWithTitle } from '../dist/index.js';

// Stubs the window clipboard for the duration of one test (mirrors
// tests/editor-context-menu.test.mjs's helper of the same name).
function stubClipboard(impl) {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { value: impl, configurable: true });
  return () => {
    if (original) {
      Object.defineProperty(window.navigator, 'clipboard', original);
    } else {
      delete window.navigator.clipboard;
    }
  };
}

async function mountPreview(markdown, { controls = 'viewer' } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new MdzipWorkspaceView(container, {
    controls,
    initialLayout: 'preview',
    initialColorScheme: 'light'
  });
  const bytes = await buildNewArchiveBytesWithTitle(markdown, 'Doc');
  await view.open(bytes, { mode: 'read-only', fileName: 'doc.mdz' });
  await view.whenRendered();
  const previewContent = container.querySelector('[data-ref="preview-content"]');
  return {
    view,
    container,
    previewContent,
    cleanup: () => {
      view.destroy();
      container.remove();
    }
  };
}

function fencedDoc(lang, lineCount) {
  const body = Array.from({ length: lineCount }, (_, i) => `line ${i}`).join('\n');
  return `# Doc\n\n\`\`\`${lang}\n${body}\n\`\`\`\n`;
}

const SHORT_TS_DOC = '# Doc\n\n```typescript\nconst x: number = 1;\n```\n';
// Between the two thresholds: collapse button shows (something to hide) but
// doesn't start collapsed (see CODE_BLOCK_COLLAPSIBLE_MIN_LINES/
// CODE_BLOCK_AUTO_COLLAPSE_LINES in view.ts).
const MEDIUM_DOC = fencedDoc('text', 18);
const LONG_DOC = fencedDoc('text', 30);

test('wraps a rendered code block with a language header and a copy button', async () => {
  const { previewContent, cleanup } = await mountPreview(SHORT_TS_DOC);
  try {
    const wrapper = previewContent.querySelector('.mdzip-code-block');
    assert.ok(wrapper, 'code block is wrapped');
    assert.equal(previewContent.querySelector('.mdzip-code-block-lang').textContent, 'typescript');
    assert.ok(wrapper.querySelector('.mdzip-code-block-body pre code'), 'original pre/code is preserved inside the body');
  } finally {
    cleanup();
  }
});

test('a block short enough that collapsing would be invisible has no collapse button', async () => {
  const { previewContent, cleanup } = await mountPreview(SHORT_TS_DOC);
  try {
    const wrapper = previewContent.querySelector('.mdzip-code-block');
    assert.equal(wrapper.querySelectorAll('.mdzip-code-block-btn').length, 1, 'only the copy button shows');
    assert.equal(wrapper.querySelector('.mdzip-code-block-btn').getAttribute('aria-label'), 'Copy code');
  } finally {
    cleanup();
  }
});

test('plain fences with no language show a neutral label', async () => {
  const { previewContent, cleanup } = await mountPreview('```\nplain text\n```\n');
  try {
    assert.equal(previewContent.querySelector('.mdzip-code-block-lang').textContent, 'text');
  } finally {
    cleanup();
  }
});

test('copy button writes the code text to the clipboard and shows a confirmation state', async () => {
  const { previewContent, cleanup } = await mountPreview(SHORT_TS_DOC);
  const written = [];
  const restore = stubClipboard({ writeText: async (text) => { written.push(text); } });
  try {
    const copyBtn = previewContent.querySelector('.mdzip-code-block-btn');
    copyBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(written, ['const x: number = 1;']);
    assert.ok(copyBtn.classList.contains('mdzip-code-block-btn-copied'), 'shows the copied confirmation state');
  } finally {
    restore();
    cleanup();
  }
});

test('a block past the collapsible threshold gets a collapse button, starting expanded', async () => {
  const { previewContent, cleanup } = await mountPreview(MEDIUM_DOC);
  try {
    const wrapper = previewContent.querySelector('.mdzip-code-block');
    const buttons = wrapper.querySelectorAll('.mdzip-code-block-btn');
    assert.equal(buttons.length, 2, 'collapse and copy buttons are both present');
    assert.equal(wrapper.classList.contains('mdzip-code-block-collapsed'), false, 'starts expanded below the auto-collapse threshold');

    const collapseBtn = buttons[0];
    assert.equal(collapseBtn.getAttribute('aria-expanded'), 'true');

    collapseBtn.click();
    assert.equal(wrapper.classList.contains('mdzip-code-block-collapsed'), true);
    assert.equal(collapseBtn.getAttribute('aria-expanded'), 'false');

    collapseBtn.click();
    assert.equal(wrapper.classList.contains('mdzip-code-block-collapsed'), false);
    assert.equal(collapseBtn.getAttribute('aria-expanded'), 'true');
  } finally {
    cleanup();
  }
});

test('blocks past the auto-collapse line threshold start collapsed', async () => {
  const { previewContent, cleanup } = await mountPreview(LONG_DOC);
  try {
    assert.ok(
      previewContent.querySelector('.mdzip-code-block').classList.contains('mdzip-code-block-collapsed'),
      'a block past the auto-collapse line threshold starts collapsed'
    );
  } finally {
    cleanup();
  }
});

test('codeBlockTools: false leaves plain pre/code untouched', async () => {
  const { previewContent, cleanup } = await mountPreview(SHORT_TS_DOC, {
    controls: { preset: 'viewer', codeBlockTools: false }
  });
  try {
    assert.equal(previewContent.querySelector('.mdzip-code-block'), null);
    assert.ok(previewContent.querySelector('pre > code.language-typescript'), 'the plain code block is still rendered');
  } finally {
    cleanup();
  }
});
