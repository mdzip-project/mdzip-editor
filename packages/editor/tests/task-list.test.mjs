import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// GFM task lists (#54). The default renderer sanitizes through DOMPurify, which needs a DOM.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = new JSDOM('<!doctype html><html><body></body></html>').window;
}
globalThis.document = globalThis.window.document;
globalThis.HTMLElement = globalThis.window.HTMLElement;
globalThis.Node = globalThis.window.Node;

const { defaultSafeMarkdownRenderer } = await import('../dist/index.js');

function render(markdown) {
  const html = defaultSafeMarkdownRenderer.render(markdown);
  const container = globalThis.document.createElement('div');
  container.innerHTML = html;
  return { html, container };
}

test('task items render disabled checkboxes, checked and unchecked, nested too', () => {
  const { container } = render('- [x] Task\n  - [ ] Subtask\n- Plain item\n');
  const boxes = [...container.querySelectorAll('input')];
  assert.equal(boxes.length, 2);
  assert.ok(boxes.every((box) => box.type === 'checkbox' && box.disabled));
  assert.deepEqual(boxes.map((box) => box.checked), [true, false]);

  const items = [...container.querySelectorAll('li')];
  assert.deepEqual(items.map((item) => item.classList.contains('task-list-item')), [true, true, false]);
  assert.ok(container.querySelector('ul').classList.contains('contains-task-list'));
  assert.equal(items[0].firstChild.nodeName, 'INPUT');
  assert.match(items[0].textContent, /^ Task/);
});

test('loose task lists keep the checkbox inside the paragraph', () => {
  const { container } = render('- [x] First\n\n- [ ] Second\n');
  const paragraphs = [...container.querySelectorAll('li > p')];
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0].firstChild.nodeName, 'INPUT');
  assert.equal(paragraphs[0].firstChild.checked, true);
  assert.equal(paragraphs[1].firstChild.checked, false);
});

test('raw HTML inputs are still stripped', () => {
  const { container } = render(
    'Text <input type="text" value="x"> and <input type="checkbox" checked> and <input type="hidden" name="a">\n'
  );
  assert.equal(container.querySelectorAll('input').length, 0);
});

test('a list without task items gets no task classes', () => {
  const { html } = render('1. one\n2. two\n');
  assert.doesNotMatch(html, /task-list/);
  assert.match(html, /<ol>/);
  assert.match(render('3. three\n4. four\n').html, /<ol start="3">/);
});
