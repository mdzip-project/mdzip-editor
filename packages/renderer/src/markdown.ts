import DOMPurify from 'dompurify';
import { Marked, type Token, type Tokens, type TokensList } from 'marked';
import markedFootnote from 'marked-footnote';
import hljs from './highlight-core.js';

export type { Token, Tokens, TokensList };

// --- Sanitizing ---------------------------------------------------------------

// In browsers the dompurify default export is already bound to the global
// window. In Node it is an unbound factory: bind it to a DOM window passed to
// useMdzipDomWindow(), or to one assigned to globalThis.window (jsdom, say).
let purifier: ReturnType<typeof DOMPurify> | null = null;

function findPurifier(): ReturnType<typeof DOMPurify> | null {
  if (purifier) {
    return purifier;
  }
  if (typeof DOMPurify.sanitize === 'function' && DOMPurify.isSupported) {
    purifier = DOMPurify;
    return purifier;
  }
  const globalWindow = (globalThis as { window?: unknown }).window;
  if (!globalWindow) {
    return null;
  }
  purifier = DOMPurify(globalWindow as Window & typeof globalThis);
  return purifier;
}

function resolvePurifier(): ReturnType<typeof DOMPurify> {
  const found = findPurifier();
  if (!found) {
    throw new Error(
      'Sanitizing needs a DOM. In Node, call useMdzipDomWindow(new JSDOM().window) first, '
      + 'use renderMdzPage() from @mdzip/renderer/page (it loads jsdom itself), or pass sanitize: false for trusted input.'
    );
  }
  return found;
}

/**
 * Gives the sanitizer a DOM window to work in, for environments without a
 * global one (Node). The window isn't assigned to any global.
 *
 * ```js
 * import { JSDOM } from 'jsdom';
 * useMdzipDomWindow(new JSDOM('').window);
 * ```
 */
export function useMdzipDomWindow(window: unknown): void {
  purifier = DOMPurify(window as Window & typeof globalThis);
}

/** Whether sanitizing can run here: a browser, or a window from {@link useMdzipDomWindow} or `globalThis.window`. */
export function hasMdzipDom(): boolean {
  return findPurifier() !== null;
}

const BASE_FORBID_TAGS = ['base', 'embed', 'form', 'iframe', 'input', 'link', 'meta', 'object', 'script', 'style'];
const BASE_FORBID_ATTR = ['style'];

/**
 * Narrow, opt-in relaxations a render extension contributes to the single
 * DOMPurify pass so its output survives sanitization.
 *
 * The default policy is HTML-only and strips SVG, inline styles, `<style>`,
 * and data attributes. An extension that injects richer markup — inline SVG
 * for a diagram, say — declares exactly what it needs here. Keep contributions
 * as narrow as possible: they widen the policy for the **whole** render pass
 * (the extension output and the surrounding markdown HTML are sanitized
 * together), so anything allowed here is allowed everywhere in that render.
 */
export interface MdzipSanitizeContribution {
  /**
   * Enable DOMPurify's `svg` + `svgFilters` profiles so inline SVG survives.
   * Even with this on, DOMPurify still strips scripts and event handlers from
   * the SVG — extensions should additionally sanitize and lock down their own
   * SVG before injecting it.
   */
  allowSvg?: boolean;
  /** Extra element names to allow beyond the default policy. */
  addTags?: readonly string[];
  /** Extra attribute names to allow beyond the default policy. */
  addAttr?: readonly string[];
  /** Tags to drop from the default forbid-list (e.g. re-allow `style`). */
  unforbidTags?: readonly string[];
  /** Attributes to drop from the default forbid-list (e.g. re-allow inline `style`). */
  unforbidAttr?: readonly string[];
}

function lower(value: string): string {
  return value.toLowerCase();
}

function buildSanitizeOptions(contributions: readonly MdzipSanitizeContribution[]) {
  const allowSvg = contributions.some((contribution) => contribution.allowSvg);
  const addTags = [...new Set(contributions.flatMap((contribution) => contribution.addTags ?? []))];
  const addAttr = ['class', ...new Set(contributions.flatMap((contribution) => contribution.addAttr ?? []))];
  const unforbidTags = new Set(contributions.flatMap((contribution) => contribution.unforbidTags ?? []).map(lower));
  const unforbidAttr = new Set(contributions.flatMap((contribution) => contribution.unforbidAttr ?? []).map(lower));
  return {
    USE_PROFILES: allowSvg ? { html: true, svg: true, svgFilters: true } : { html: true },
    ADD_TAGS: addTags,
    ADD_ATTR: addAttr,
    FORBID_TAGS: BASE_FORBID_TAGS.filter((tag) => !unforbidTags.has(tag)),
    FORBID_ATTR: BASE_FORBID_ATTR.filter((attr) => !unforbidAttr.has(attr)),
    ALLOW_DATA_ATTR: false
  };
}

/** Options for the last step of a render, after sanitizing (or instead of it). */
export interface MdzipFinishOptions {
  /**
   * Put in front of every heading id. Default none (`<h2 id="intro">`). The
   * MDZip editor's preview uses `user-content-`, as GitHub does.
   */
  headingIdPrefix?: string;
  /**
   * `'new-tab'` adds `target="_blank" rel="noopener"` to links to other sites
   * (`http:`, `https:` and `//`). Default `'same-tab'`: links are left as they are.
   */
  externalLinks?: 'same-tab' | 'new-tab';
}

/**
 * Sanitizes rendered HTML with the MDZip DOMPurify policy, then finishes it
 * (see {@link finishMdzipHtml}).
 *
 * The policy strips data attributes and inline styles. Markdown render
 * extensions that need to find placeholders again later should use class or
 * id markers and carry payloads out-of-band (a side map keyed by marker id),
 * not element attributes.
 *
 * Pass `contributions` (an extension's {@link MdzipSanitizeContribution}s) to
 * widen the policy just enough for richer output such as inline SVG.
 */
export function sanitizeMdzipHtml(
  html: string,
  contributions: readonly MdzipSanitizeContribution[] = [],
  options: MdzipFinishOptions = {}
): string {
  return finishMdzipHtml(resolvePurifier().sanitize(html, buildSanitizeOptions(contributions)), options);
}

/**
 * Turns the renderer's markers into their final markup: task-list checkboxes
 * and heading ids. {@link sanitizeMdzipHtml} calls this; call it yourself only
 * for HTML from {@link parseMdzipTokens} that isn't sanitized.
 *
 * The markers exist because the sanitizer would otherwise remove what they
 * stand for: `<input>` is forbidden (so raw-HTML inputs are always stripped,
 * and only task items get checkboxes), and DOMPurify drops an id that names a
 * `document` property, such as a heading called "Images" or "Links".
 */
export function finishMdzipHtml(html: string, options: MdzipFinishOptions = {}): string {
  let result = restoreTaskCheckboxes(html);
  if (result.includes(HEADING_ID_MARK)) {
    result = result.split(`id="${HEADING_ID_MARK}`).join(`id="${options.headingIdPrefix ?? ''}`);
  }
  if (options.externalLinks === 'new-tab') {
    result = result.replace(EXTERNAL_ANCHOR, (match, attrs: string) =>
      (/\starget\s*=/i.test(attrs) ? match : `<a${attrs} target="_blank" rel="noopener">`));
  }
  return result;
}

const EXTERNAL_ANCHOR = /<a\b([^>]*\shref="(?:https?:)?\/\/[^"]*"[^>]*)>/gi;

const TASK_CHECKBOX_PLACEHOLDER = /<span class="mdzip-task-checkbox( mdzip-task-checked)?"><\/span>/g;

function taskCheckboxPlaceholder(checked: boolean): string {
  return `<span class="mdzip-task-checkbox${checked ? ' mdzip-task-checked' : ''}"></span>`;
}

function restoreTaskCheckboxes(html: string): string {
  if (!html.includes('mdzip-task-checkbox')) {
    return html;
  }
  return html.replace(TASK_CHECKBOX_PLACEHOLDER, (_match, checked: string | undefined) =>
    `<input type="checkbox" class="task-list-item-checkbox" disabled=""${checked ? ' checked=""' : ''}>`);
}

function randomMarker(): string {
  const bytes = new Uint8Array(6);
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// A heading id is rendered as this marker plus the slug, and the marker is
// replaced by the prefix after sanitizing. Random per load, so a document
// can't write an id that turns into something else.
const HEADING_ID_MARK = `mdzip-h${randomMarker()}-`;

// --- Heading ids ------------------------------------------------------------

type AnchoredHeadingToken = Tokens.Heading & { mdzipAnchorId?: string };

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    // Any other named entity (&copy; etc.) decodes to a symbol the slug
    // pass would strip anyway.
    .replace(/&[a-z][a-z0-9]*;/gi, '');
}

function inlineTokensPlainText(tokens: readonly Token[] | undefined): string {
  let text = '';
  for (const token of tokens ?? []) {
    const inline = token as { type: string; text?: string; tokens?: Token[] };
    if (inline.type === 'br') {
      text += ' ';
    } else if (inline.type === 'html') {
      // Tag markers only — their inner text arrives as sibling text tokens.
    } else if (inline.tokens) {
      text += inlineTokensPlainText(inline.tokens);
    } else if (typeof inline.text === 'string') {
      text += inline.text;
    }
  }
  return decodeBasicEntities(text);
}

/**
 * The heading slug shared by the MDZip editor, mdzip.org and the MDZip Pandoc
 * filter: lowercased; everything but letters, marks, numbers, `_`, `-` and
 * whitespace removed (so punctuation and emoji go); each run of whitespace and
 * hyphens turned into one `-`; and no `-` at either end.
 *
 * `Why isn't it "here"?` → `why-isnt-it-here`, `mdz — the CLI` → `mdz-the-cli`,
 * `🪟 Windows` → `windows`, `Über Café` → `über-café`.
 */
export function slugifyMdzipHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\s-]/gu, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function forEachHeadingToken(tokens: readonly Token[], visit: (token: AnchoredHeadingToken) => void): void {
  for (const token of tokens) {
    if (token.type === 'heading') {
      visit(token as AnchoredHeadingToken);
    } else if (token.type === 'blockquote' || token.type === 'list' || token.type === 'list_item') {
      const container = token as { tokens?: Token[]; items?: Token[] };
      forEachHeadingToken(container.tokens ?? container.items ?? [], visit);
    }
  }
}

/**
 * Gives every heading token (including ones nested in blockquotes and lists)
 * the id its rendered `<hN>` will carry, in document order, numbering repeats
 * as GitHub does (`intro`, `intro-1`, `intro-2`). Has to run over the whole
 * document's tokens before they are split into chunks — a chunk rendered on
 * its own can't know how many earlier chunks already used a slug. A heading
 * whose text slugifies to nothing (e.g. only punctuation) gets no id.
 */
export function assignMdzipHeadingIds(tokens: readonly Token[]): void {
  const used = new Map<string, number>();
  forEachHeadingToken(tokens, (token) => {
    const base = slugifyMdzipHeading(inlineTokensPlainText(token.tokens));
    if (!base) {
      delete token.mdzipAnchorId;
      return;
    }
    let candidate = base;
    while (used.has(candidate)) {
      const next = (used.get(base) ?? 0) + 1;
      used.set(base, next);
      candidate = `${base}-${next}`;
    }
    used.set(candidate, 0);
    token.mdzipAnchorId = candidate;
  });
}

/** The ids {@link assignMdzipHeadingIds} gave the headings in `tokens`, in order (without any prefix). */
export function collectMdzipHeadingIds(tokens: readonly Token[]): string[] {
  const ids: string[] = [];
  forEachHeadingToken(tokens, (token) => {
    if (token.mdzipAnchorId) {
      ids.push(token.mdzipAnchorId);
    }
  });
  return ids;
}

/** A heading as {@link collectMdzipHeadings} lists it. */
export interface MdzipHeadingInfo {
  /** The id its `<hN>` carries (without any prefix). */
  id: string;
  /** Its text, without Markdown syntax or extra whitespace. */
  text: string;
  /** 1 to 6. */
  level: number;
}

/**
 * Every heading that has an id, in document order, for a table of contents.
 * Run {@link assignMdzipHeadingIds} (or {@link tokenizeMdzipMarkdown}) on the
 * tokens first.
 */
export function collectMdzipHeadings(tokens: readonly Token[]): MdzipHeadingInfo[] {
  const headings: MdzipHeadingInfo[] = [];
  forEachHeadingToken(tokens, (token) => {
    if (token.mdzipAnchorId) {
      const text = inlineTokensPlainText(token.tokens).replace(/\s+/g, ' ').trim();
      headings.push({ id: token.mdzipAnchorId, text, level: token.depth });
    }
  });
  return headings;
}

// --- Code highlighting --------------------------------------------------------

/**
 * Highlights `code` with highlight.js when `language` is one of the bundled
 * grammars (`vue` counts as `html`); returns `null` otherwise. The output is
 * highlight.js's span markup, for a `<code class="hljs">`.
 */
export function highlightMdzipCode(code: string, language: string): string | null {
  const grammar = language === 'vue' ? 'html' : language;
  if (!grammar || !hljs.getLanguage(grammar)) {
    return null;
  }
  try {
    return hljs.highlight(code, { language: grammar, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}

// --- Marked -----------------------------------------------------------------

const marked = new Marked({
  renderer: {
    heading(token: AnchoredHeadingToken) {
      const id = token.mdzipAnchorId ? ` id="${HEADING_ID_MARK}${escapeHtml(token.mdzipAnchorId)}"` : '';
      return `<h${token.depth}${id}>${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
    },
    code(token: { lang?: string; text: string }) {
      const requestedLanguage = token.lang || '';
      const highlighted = highlightMdzipCode(token.text, requestedLanguage);
      if (highlighted !== null) {
        return `<pre><code class="hljs language-${escapeHtml(requestedLanguage)}">${highlighted}</code></pre>`;
      }
      // Preserve the requested language as a class even when it is not a
      // highlightable language (e.g. `mermaid`), so render extensions and
      // client-side highlighters can still find and claim the block.
      const className = requestedLanguage ? ` class="language-${escapeHtml(requestedLanguage)}"` : '';
      return `<pre><code${className}>${escapeHtml(token.text)}</code></pre>`;
    },
    list(token: Tokens.List) {
      const type = token.ordered ? 'ol' : 'ul';
      const start = token.ordered && token.start !== 1 && token.start !== '' ? ` start="${token.start}"` : '';
      const className = token.items.some((item) => item.task) ? ' class="contains-task-list"' : '';
      const body = token.items.map((item) => this.listitem(item)).join('');
      return `<${type}${start}${className}>\n${body}</${type}>\n`;
    },
    // Same as marked's listitem, plus GitHub's `task-list-item` class. The
    // checkbox is a token inside the item (inside its first paragraph when
    // the list is loose), rendered by `checkbox` below.
    listitem(item: Tokens.ListItem) {
      return `<li${item.task ? ' class="task-list-item"' : ''}>${this.parser.parse(item.tokens)}</li>\n`;
    },
    checkbox({ checked }: Tokens.Checkbox) {
      return `${taskCheckboxPlaceholder(checked)} `;
    },
    table(token: Tokens.Table) {
      const renderCell = (cell: Tokens.TableCell): string => {
        const tag = cell.header ? 'th' : 'td';
        const align = cell.align ? ` align="${cell.align}"` : '';
        return `<${tag}${align}>${this.parser.parseInline(cell.tokens)}</${tag}>\n`;
      };
      const renderRow = (cells: Tokens.TableCell[]): string =>
        `<tr>\n${cells.map(renderCell).join('')}</tr>\n`;
      const header = renderRow(token.header);
      const body = token.rows.length
        ? `<tbody>\n${token.rows.map(renderRow).join('')}</tbody>\n`
        : '';
      return `<div class="mdzip-table-scroll"><table>\n<thead>\n${header}</thead>\n${body}</table></div>\n`;
    }
  }
});

// GFM footnotes: `[^1]` references and `[^1]: ...` definitions, rendered as
// superscript links to a footnotes section at the end, with back-links.
marked.use(markedFootnote());

/**
 * Calls `callback` on every token, depth first, in the same order as marked's
 * own `walkTokens` (table cells, list items, extension child tokens, then
 * `tokens`). Marked's version also collects every callback's return value by
 * concatenating arrays as it goes, which is quadratic in the token count: on
 * a large chat export it took 13 seconds plus 6 of garbage collection. Those
 * values only matter to marked's async mode, which isn't used here.
 */
export function walkMdzipTokens(tokens: Token[], callback: (token: Token) => unknown): void {
  const childTokens = marked.defaults.extensions?.childTokens ?? {};
  const visit = (list: Token[]): void => {
    for (const token of list) {
      callback.call(marked, token);
      switch (token.type) {
        case 'table': {
          const table = token as Tokens.Table;
          for (const cell of table.header) {
            visit(cell.tokens);
          }
          for (const row of table.rows) {
            for (const cell of row) {
              visit(cell.tokens);
            }
          }
          break;
        }
        case 'list':
          visit((token as Tokens.List).items);
          break;
        default: {
          const names = childTokens[token.type];
          if (names) {
            for (const name of names) {
              visit(((token as unknown as Record<string, unknown[]>)[name] ?? []).flat(Infinity) as Token[]);
            }
          } else if ('tokens' in token && token.tokens) {
            visit(token.tokens);
          }
        }
      }
    }
  };
  visit(tokens);
}

/**
 * `marked.lexer()` plus the extensions' `walkTokens` hooks, which marked only
 * runs inside `parse()`. The footnote extension needs its hook to move the
 * footnotes section to the end and reset its per-document state.
 */
function lexMarkdown(markdown: string): TokensList {
  const tokens = marked.lexer(markdown);
  const walkTokens = marked.defaults.walkTokens;
  if (walkTokens) {
    walkMdzipTokens(tokens, walkTokens);
  }
  // The extension adds its section token to every document, first; the hook
  // moves a non-empty one to the end and leaves an empty `space` token behind.
  // Drop both leftovers so token positions (and chunking) are as before.
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i] as Token & { items?: unknown[] };
    const emptySection = token.type === 'footnotes' && !token.items?.length;
    const placeholder = i === 0 && token.type === 'space' && token.raw === '';
    if (emptySection || placeholder) {
      tokens.splice(i, 1);
    }
  }
  return tokens;
}

/**
 * Lexes Markdown into top-level block tokens with heading ids assigned, for
 * callers that render it in parts (see {@link parseMdzipTokens}). The tokens
 * tile the source: their `raw` strings joined give back the whole input.
 */
export function tokenizeMdzipMarkdown(markdown: string): TokensList {
  const tokens = lexMarkdown(markdown);
  assignMdzipHeadingIds(tokens);
  return tokens;
}

/**
 * Renders tokens from {@link tokenizeMdzipMarkdown} to HTML that is neither
 * sanitized nor finished: pass it through {@link sanitizeMdzipHtml} (or,
 * for trusted input, {@link finishMdzipHtml}) before use.
 */
export function parseMdzipTokens(tokens: readonly Token[], options: MdzipParseOptions = {}): string {
  if (!options.markBlocks) {
    return marked.parser(tokens as Token[]);
  }
  // A comment before each top-level token's output. One parse, as without marks.
  const withMarks: Token[] = [];
  tokens.forEach((token, index) => {
    withMarks.push({ type: 'html', block: true, pre: false, raw: '', text: `<!--${BLOCK_MARK}${index}-->` } as Token, token);
  });
  return marked.parser(withMarks);
}

/**
 * The attribute {@link applyMdzipBlockMarks} puts on the first element each
 * top-level token rendered to: the token's index in the list given to
 * {@link parseMdzipTokens}. Allow it when sanitizing (`addAttr`) to keep it.
 */
export const MDZIP_BLOCK_ATTRIBUTE = 'data-mdzip-block';
const BLOCK_MARK = 'mdzip-block:';
const BLOCK_MARK_BEFORE_TAG = /<!--mdzip-block:(\d+)-->(\s*)<([a-zA-Z][a-zA-Z0-9-]*)/g;
const BLOCK_MARK_LEFT = /<!--mdzip-block:\d+-->/g;
const BLOCK_ATTRIBUTE = /\sdata-mdzip-block="\d+"/g;

export interface MdzipParseOptions {
  /**
   * Put a `<!--mdzip-block:<index>-->` comment before each top-level token's
   * output, so the rendered blocks can be matched back to their tokens, and
   * through the tokens' `raw` text to source lines (the editor's split-view
   * scroll sync). The marks are comments so that code transforming the HTML
   * next sees the elements as they'd be without them; then
   * {@link applyMdzipBlockMarks} turns each into a `data-mdzip-block`
   * attribute on the element after it.
   */
  markBlocks?: boolean;
}

/**
 * Turns the comments {@link parseMdzipTokens} `markBlocks` leaves into
 * `data-mdzip-block="<index>"` on the element that follows each, and drops
 * those with no element after them (a blank line, a raw HTML comment).
 */
export function applyMdzipBlockMarks(html: string): string {
  return html
    .replace(BLOCK_MARK_BEFORE_TAG, (_match, index: string, space: string, tag: string) => `${space}<${tag} ${MDZIP_BLOCK_ATTRIBUTE}="${index}"`)
    .replace(BLOCK_MARK_LEFT, '');
}

/** Removes block marks, comments or attributes, from HTML that leaves the page (a copy, an export). */
export function stripMdzipBlockMarks(html: string): string {
  return html.replace(BLOCK_ATTRIBUTE, '').replace(BLOCK_MARK_LEFT, '');
}

const EXTERNAL_OR_ANCHOR = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/**
 * Rewrites the `href` of every Markdown link in `tokens` through `resolve`.
 * Links that are absolute (`https:`, `mailto:`, any scheme), protocol-relative
 * or in-page (`#…`) are left alone. Raw HTML `<a>` tags aren't touched.
 */
export function rewriteMdzipLinks(tokens: Token[], resolve: (href: string) => string): void {
  walkMdzipTokens(tokens, (token) => {
    if (token.type === 'link') {
      const link = token as Tokens.Link;
      if (typeof link.href === 'string' && !EXTERNAL_OR_ANCHOR.test(link.href)) {
        link.href = resolve(link.href);
      }
    }
  });
}

export interface MdzipMarkdownOptions extends MdzipFinishOptions {
  /**
   * Sanitize with the MDZip DOMPurify policy. Default `true`. Turn it off only
   * for Markdown you trust: raw HTML in it reaches the output unchanged.
   * In Node, sanitizing needs a DOM window; see {@link useMdzipDomWindow}.
   */
  sanitize?: boolean;
  /** Policy relaxations for sanitizing; see {@link MdzipSanitizeContribution}. */
  sanitizeContributions?: readonly MdzipSanitizeContribution[];
  /** Rewrites relative Markdown link targets; see {@link rewriteMdzipLinks}. */
  resolveLink?: (href: string) => string;
}

/**
 * MDZip Markdown to HTML: GitHub Flavored Markdown with footnotes, task
 * lists, highlighted code, heading ids, and tables in a scrolling wrapper;
 * ` ```mermaid ` blocks stay as `<pre><code class="language-mermaid">` for a
 * client-side renderer; sanitized unless `sanitize: false`.
 */
export function renderMdzipMarkdown(markdown: string, options: MdzipMarkdownOptions = {}): string {
  const tokens = tokenizeMdzipMarkdown(markdown);
  if (options.resolveLink) {
    rewriteMdzipLinks(tokens, options.resolveLink);
  }
  const html = parseMdzipTokens(tokens);
  return options.sanitize === false
    ? finishMdzipHtml(html, options)
    : sanitizeMdzipHtml(html, options.sanitizeContributions ?? [], options);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
