import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  hasMdzipDom,
  renderMdzipMarkdown,
  slugifyMdzipHeading,
  tokenizeMdzipMarkdown,
  parseMdzipTokens,
  finishMdzipHtml,
  useMdzipDomWindow
} from '../dist/index.js';

const idsIn = (html) => [...html.matchAll(/<h[1-6] id="([^"]+)"/g)].map((match) => match[1]);

test('without a DOM, sanitizing explains what to do and sanitize: false still renders', () => {
  assert.equal(hasMdzipDom(), false);
  assert.throws(() => renderMdzipMarkdown('# Hi'), /useMdzipDomWindow/);
  assert.equal(renderMdzipMarkdown('# Hi', { sanitize: false }), '<h1 id="hi">Hi</h1>\n');
});

test('useMdzipDomWindow enables sanitizing without touching globals', () => {
  useMdzipDomWindow(new JSDOM('').window);
  assert.equal(hasMdzipDom(), true);
  assert.equal(globalThis.window, undefined);
  const html = renderMdzipMarkdown('Hi <script>alert(1)</script><img src="x" onerror="alert(1)">');
  assert.doesNotMatch(html, /script|onerror/);
});

test('heading slugs: punctuation and emoji removed, runs of spaces and hyphens collapsed, ends trimmed', () => {
  assert.equal(slugifyMdzipHeading('Skywalker Family Tree'), 'skywalker-family-tree');
  assert.equal(slugifyMdzipHeading("What's new? (v2.0)"), 'whats-new-v20');
  assert.equal(slugifyMdzipHeading('snake_case & kebab-case'), 'snake_case-kebab-case');
  assert.equal(slugifyMdzipHeading('`mdz` — the command line'), 'mdz-the-command-line');
  assert.equal(slugifyMdzipHeading('🪟 Windows'), 'windows');
  assert.equal(slugifyMdzipHeading('Chrome / Edge managed environments'), 'chrome-edge-managed-environments');
  assert.equal(slugifyMdzipHeading('a - b'), 'a-b');
  assert.equal(slugifyMdzipHeading('Über Café 日本語'), 'über-café-日本語');
  assert.equal(slugifyMdzipHeading('!!!'), '');
});

test('repeated headings are numbered as on GitHub, and escaped punctuation goes whole', () => {
  const html = renderMdzipMarkdown('# Hello World\n\n## Hello World\n\n### Hello World\n\n### Why isn\'t it "here" & there?\n');
  assert.deepEqual(idsIn(html), ['hello-world', 'hello-world-1', 'hello-world-2', 'why-isnt-it-here-there']);
});

test('ids that name document properties survive sanitizing, with or without a prefix', () => {
  const markdown = '## Images\n\n## Links\n\n## Title\n';
  assert.deepEqual(idsIn(renderMdzipMarkdown(markdown)), ['images', 'links', 'title']);
  assert.deepEqual(idsIn(renderMdzipMarkdown(markdown, { headingIdPrefix: 'user-content-' })),
    ['user-content-images', 'user-content-links', 'user-content-title']);
});

test('a document cannot forge the heading-id marker', () => {
  const html = renderMdzipMarkdown('<h2 id="mdzip-h0-x">Raw</h2>\n\n## Real\n');
  assert.match(html, /<h2 id="real">/);
  assert.doesNotMatch(html, /id="x"/);
});

test('footnotes, task lists, tables and code render as in the editor preview', () => {
  const html = renderMdzipMarkdown([
    'Text[^1]', '', '[^1]: Note.', '',
    '- [x] Done', '- [ ] Open', '',
    '| a | b |', '|---|:-:|', '| 1 | 2 |', '',
    '```js', 'const x = 1;', '```', '',
    '```mermaid', 'graph TD; A-->B', '```', ''
  ].join('\n'));
  assert.match(html, /<sup><a[^>]*href="#footnote-1"/);
  assert.match(html, /<section class="footnotes"/);
  assert.match(html, /<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled="" checked=""> Done<\/li>/);
  assert.match(html, /<ul class="contains-task-list">/);
  assert.match(html, /<div class="mdzip-table-scroll"><table>/);
  assert.match(html, /<td align="center">2<\/td>/);
  assert.match(html, /<code class="hljs language-js"><span class="hljs-keyword">const<\/span>/);
  assert.match(html, /<pre><code class="language-mermaid">graph TD; A--&gt;B<\/code><\/pre>/);
});

test('resolveLink rewrites relative Markdown links only; new-tab marks links to other sites', () => {
  const html = renderMdzipMarkdown('[a](other.md) [b](https://example.com) [c](#top) [d](mailto:x@example.com) [e](//cdn.example.com/x)', {
    resolveLink: (href) => `/docs/${href.replace(/\.md$/, '.html')}`,
    externalLinks: 'new-tab'
  });
  assert.match(html, /<a href="\/docs\/other\.html">a<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener">b<\/a>/);
  assert.match(html, /<a href="#top">c<\/a>/);
  assert.match(html, /<a href="mailto:x@example\.com">d<\/a>/);
  assert.match(html, /<a href="\/\/cdn\.example\.com\/x" target="_blank" rel="noopener">e<\/a>/);
});

test('tokens tile the source and render in parts like the whole', () => {
  const markdown = '# One\n\nText\n\n\n\n## Two\n\n- a\n- b\n';
  const tokens = tokenizeMdzipMarkdown(markdown);
  assert.equal(tokens.map((token) => token.raw).join(''), markdown);
  const parts = [tokens.slice(0, 2), tokens.slice(2)].map((part) => finishMdzipHtml(parseMdzipTokens(part))).join('');
  assert.equal(parts, finishMdzipHtml(parseMdzipTokens(tokens)));
});
