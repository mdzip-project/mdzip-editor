import DOMPurify from 'dompurify';
import hljs from './highlight-core.js';
import { Marked, type Token, type Tokens, type TokensList } from 'marked';

export type { Token, TokensList };
import type { MdzManifest } from '@mdzip/core-js';
import type {
  MdzipPathType,
  MdzipSourceFormat,
  MdzipWorkspaceMode,
  MdzipWorkspaceSnapshot
} from './workspace.js';

// In browsers the dompurify default export is already bound to the global
// window. In Node it is an unbound factory, so bind it to a host-provided DOM
// (e.g. jsdom assigned to globalThis.window) on first use.
let purifier: typeof DOMPurify | null = null;

function resolvePurifier(): typeof DOMPurify {
  if (purifier) {
    return purifier;
  }
  if (typeof DOMPurify.sanitize === 'function') {
    purifier = DOMPurify;
    return purifier;
  }
  const globalWindow = (globalThis as { window?: unknown }).window;
  if (!globalWindow) {
    throw new Error(
      'DOMPurify requires a DOM. In non-browser environments, assign a DOM window (e.g. from jsdom) to globalThis.window before rendering.'
    );
  }
  purifier = DOMPurify(globalWindow as Window & typeof globalThis);
  return purifier;
}

const BASE_FORBID_TAGS = ['base', 'embed', 'form', 'iframe', 'input', 'link', 'meta', 'object', 'script', 'style'];
const BASE_FORBID_ATTR = ['style'];

/**
 * Narrow, opt-in relaxations a render extension contributes to the single
 * DOMPurify pass so its `transformHtml` output survives sanitization.
 *
 * The default policy is HTML-only and strips SVG, inline styles, `<style>`,
 * and data attributes. An extension that injects richer markup — inline SVG
 * for a diagram, say — declares exactly what it needs here. Keep contributions
 * as narrow as possible: they widen the policy for the **whole** render pass
 * (the extension output and the surrounding markdown HTML are sanitized
 * together), so anything allowed here is allowed everywhere in that preview.
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

/**
 * Sanitizes rendered HTML with the editor's default DOMPurify policy.
 *
 * Note the policy strips data attributes and inline styles. Markdown render
 * extensions that need to find placeholders again in `mount()` should use
 * class or id markers and carry payloads out-of-band (e.g. a side map keyed
 * by marker id), not element attributes.
 *
 * Pass `contributions` (an extension's {@link MdzipSanitizeContribution}s) to
 * widen the policy just enough for richer output such as inline SVG.
 */
export function sanitizeMdzipHtml(
  html: string,
  contributions: readonly MdzipSanitizeContribution[] = []
): string {
  return resolvePurifier().sanitize(html, buildSanitizeOptions(contributions));
}

/**
 * Context handed to markdown renderers and render extensions for one render
 * generation. `signal` aborts when the selection or content moves on before
 * an asynchronous stage finishes; stages should stop work when it fires.
 */
export interface MdzipMarkdownRenderContext {
  currentPath: string;
  sourceFormat: MdzipSourceFormat;
  colorScheme: 'light' | 'dark';
  mode: MdzipWorkspaceMode;
  manifest: MdzManifest | null;
  /**
   * Resolves archive asset paths (e.g. to data URIs) for stages that need to
   * reference assets directly. Markdown image sources are already rewritten
   * before the pipeline runs, so most extensions never need this.
   */
  assetResolver?: MdzipAssetUrlResolver;
  signal: AbortSignal;
}

export interface MdzipMarkdownRenderer {
  /**
   * Renders markdown to HTML. May return a promise; the pipeline keeps a
   * fully synchronous fast path when it does not.
   *
   * String output is sanitized by the pipeline before insertion unless
   * `sanitizesOutput` is `true` and no `transformHtml` extension is
   * registered.
   */
  render(markdown: string, context?: MdzipMarkdownRenderContext): string | Promise<string>;
  /**
   * Explicit sanitization bypass: declares that `render()` output is already
   * safe to insert. Only set this when the renderer sanitizes internally —
   * the default renderer does. When any `transformHtml` extension is
   * registered the pipeline still sanitizes the final HTML, because the
   * transformed output is no longer what this renderer produced.
   */
  readonly sanitizesOutput?: boolean;
}

/**
 * Handle returned by a `mount()` hook so the view can update or dispose
 * mounted content. `destroy()` is called before the container's HTML is
 * replaced and when the view is destroyed.
 */
export interface MdzipRenderHandle {
  update?(context: MdzipMarkdownRenderContext): void | Promise<void>;
  destroy(): void;
}

/**
 * Composable extension over the default markdown pipeline:
 *
 *   markdown -> transformMarkdown* -> renderer -> transformHtml*
 *            -> sanitize -> DOM insertion -> mount*
 *
 * `transformMarkdown`/`transformHtml` outputs pass through sanitization, so
 * they cannot inject unsafe markup. `mount()` runs against the live preview
 * DOM and is privileged host code.
 */
export interface MdzipMarkdownRenderExtension {
  name: string;

  /**
   * Narrow sanitizer relaxations this extension needs for its `transformHtml`
   * output to survive the pipeline's DOMPurify pass (e.g. inline SVG). Merged
   * across all registered extensions. See {@link MdzipSanitizeContribution}.
   */
  sanitize?: MdzipSanitizeContribution;

  transformMarkdown?(
    markdown: string,
    context: MdzipMarkdownRenderContext
  ): string | Promise<string>;

  transformHtml?(
    html: string,
    context: MdzipMarkdownRenderContext
  ): string | Promise<string>;

  mount?(
    container: HTMLElement,
    context: MdzipMarkdownRenderContext
  ): void | MdzipRenderHandle | Promise<void | MdzipRenderHandle>;

  /**
   * Marks a top-level block token as expensive enough to isolate into its own
   * chunk for {@link groupTokensIntoChunks}, regardless of the char/token
   * budget — e.g. a mermaid extension claiming its own ` ```mermaid ` fence.
   * Without this, a token this extension will re-render on every mount
   * (diagram layout, not just syntax highlighting) shares a chunk with
   * whatever nearby text the budget happened to group it with; editing any
   * of that unrelated text still invalidates the whole chunk's source key,
   * forcing an expensive re-render the edit had nothing to do with — most
   * visible on a short document that fits within one or two chunks anyway,
   * where *every* edit ends up re-rendering the diagram.
   */
  shouldIsolateChunk?(token: Token): boolean;
}

/**
 * Context handed to entry renderers for the currently selected archive entry.
 * Exposes supported operations instead of view internals.
 */
export interface MdzipEntryRenderContext {
  path: string;
  pathType: MdzipPathType;
  mode: MdzipWorkspaceMode;
  sourceFormat: MdzipSourceFormat;
  colorScheme: 'light' | 'dark';
  manifest: MdzManifest | null;
  snapshot: MdzipWorkspaceSnapshot;
  signal: AbortSignal;

  /** Reads the raw bytes of the selected entry. */
  readBytes(): Promise<Uint8Array>;
  /**
   * Replaces the manifest wholesale (canonicalized). Routes through the
   * workspace `'manifest'` edit event, so `onManifestChanged` host-delegated
   * persistence keeps working.
   */
  updateManifest(manifest: MdzManifest): Promise<void>;
}

export interface MdzipEntryRenderHandle {
  update?(context: MdzipEntryRenderContext): void | Promise<void>;
  destroy(): void;
}

/**
 * Claims the full pane stack (edit and preview panes included) for selected
 * archive entries it matches. The first matching renderer by descending
 * `priority` wins; when none match, built-in rendering is used.
 */
export interface MdzipEntryRenderer {
  id: string;
  priority?: number;

  /** Must be cheap and synchronous; called when the selection key changes. */
  matches(context: MdzipEntryRenderContext): boolean;

  mount(
    container: HTMLElement,
    context: MdzipEntryRenderContext
  ): void | MdzipEntryRenderHandle | Promise<void | MdzipEntryRenderHandle>;
}

/** Predicate matching one or more exact archive paths (case-insensitive). */
export function mdzipPathMatcher(...paths: string[]): (context: { path: string }) => boolean {
  const wanted = new Set(paths.map((path) => path.toLowerCase()));
  return ({ path }) => wanted.has(path.toLowerCase());
}

/** Predicate matching file extensions (case-insensitive, dot optional). */
export function mdzipExtensionMatcher(...extensions: string[]): (context: { path: string }) => boolean {
  const wanted = extensions.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase());
  return ({ path }) => {
    const lower = path.toLowerCase();
    return wanted.some((ext) => lower.endsWith(ext));
  };
}

export interface MdzipAssetUrlResolver {
  resolveAssetUrl(path: string, fallbackDataUri?: string): string | undefined;
}

export interface MdzipRenderRequest {
  markdown: string;
  assetResolver?: MdzipAssetUrlResolver;
}

export interface MdzipRenderResult {
  html: string;
}

/**
 * Rendered heading ids carry this prefix (GitHub does the same) so a heading
 * like "## Images" or "## Title" can never collide with a document/form
 * property, which DOMPurify would otherwise strip the id for. Links written
 * against the bare slug (`#images`) still resolve — see the preview click handler.
 */
export const MDZIP_HEADING_ID_PREFIX = 'user-content-';

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
 * GitHub-style heading slug: lowercased, everything but letters, marks,
 * numbers, `_`, `-` and spaces removed, spaces turned into hyphens.
 */
export function slugifyMdzipHeading(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-');
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
 * the id its rendered `<hN>` will carry, in document order, disambiguating
 * repeats GitHub-style (`intro`, `intro-1`, `intro-2`). Has to run over the
 * whole document's tokens before they are split into chunks — a chunk rendered
 * on its own can't know how many earlier chunks already used a slug. A heading
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

/** The ids {@link assignMdzipHeadingIds} gave the headings in `tokens`, in order. */
export function collectMdzipHeadingIds(tokens: readonly Token[]): string[] {
  const ids: string[] = [];
  forEachHeadingToken(tokens, (token) => {
    if (token.mdzipAnchorId) {
      ids.push(token.mdzipAnchorId);
    }
  });
  return ids;
}

const marked = new Marked({
  renderer: {
    heading(token: AnchoredHeadingToken) {
      const id = token.mdzipAnchorId ? ` id="${MDZIP_HEADING_ID_PREFIX}${escapeHtml(token.mdzipAnchorId)}"` : '';
      return `<h${token.depth}${id}>${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
    },
    code(token: { lang?: string; text: string }) {
      const requestedLanguage = token.lang || '';
      const language = requestedLanguage === 'vue' ? 'html' : requestedLanguage;
      if (language && hljs.getLanguage(language)) {
        try {
          const highlighted = hljs.highlight(token.text, {
            language,
            ignoreIllegals: true
          }).value;
          return `<pre><code class="hljs language-${escapeHtml(requestedLanguage)}">${highlighted}</code></pre>`;
        } catch {
          // Fall through to escaped plain code.
        }
      }
      // Preserve the requested language as a class even when it is not a
      // highlightable language (e.g. `mermaid`), so render extensions and
      // client-side highlighters can still find and claim the block.
      const className = requestedLanguage ? ` class="language-${escapeHtml(requestedLanguage)}"` : '';
      return `<pre><code${className}>${escapeHtml(token.text)}</code></pre>`;
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

function renderDefaultMarkdownUnsanitized(markdown: string): string {
  const tokens = marked.lexer(markdown);
  assignMdzipHeadingIds(tokens);
  const rendered = marked.parser(tokens);
  return typeof rendered === 'string' ? rendered : escapeHtml(markdown);
}

export const defaultSafeMarkdownRenderer: MdzipMarkdownRenderer = {
  sanitizesOutput: true,
  render(markdown: string): string {
    return sanitizeMdzipHtml(renderDefaultMarkdownUnsanitized(markdown));
  }
};

function isThenable(value: unknown): value is Promise<unknown> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}

function createAbortError(): Error {
  return new DOMException('The markdown render was aborted.', 'AbortError');
}

/**
 * Applies one pipeline stage, staying synchronous when the incoming value is
 * synchronous. The async path checks the abort signal between stages so a
 * superseded render stops early.
 */
function chainRenderStage(
  value: string | Promise<string>,
  stage: (input: string) => string | Promise<string>,
  signal?: AbortSignal
): string | Promise<string> {
  if (isThenable(value)) {
    return Promise.resolve(value).then((resolved) => {
      if (signal?.aborted) {
        throw createAbortError();
      }
      return stage(resolved);
    });
  }
  return stage(value);
}

export class MdzipRenderingService {
  public constructor(
    private readonly renderer: MdzipMarkdownRenderer = defaultSafeMarkdownRenderer,
    private readonly extensions: readonly MdzipMarkdownRenderExtension[] = []
  ) {}

  /** Whether {@link tokenizeMarkdown}/{@link renderChunk} are usable — only with the default marked-based renderer. */
  public get supportsChunking(): boolean {
    return this.renderer === defaultSafeMarkdownRenderer;
  }

  /**
   * Legacy synchronous render. Behavior is unchanged: the configured
   * renderer's output is returned as-is (the default renderer sanitizes
   * internally). Extensions do not run here — use {@link renderMarkdown}.
   */
  public render(request: MdzipRenderRequest): MdzipRenderResult {
    const markdown = request.assetResolver
      ? rewriteAssetSources(request.markdown, request.assetResolver)
      : request.markdown;
    const html = this.renderer.render(markdown);
    if (isThenable(html)) {
      throw new Error(
        'render() requires a synchronous markdown renderer. Use renderMarkdown() for asynchronous pipelines.'
      );
    }
    return { html };
  }

  /**
   * Full extension pipeline:
   *
   *   transformMarkdown* -> renderer -> transformHtml* -> sanitize
   *
   * Returns a plain string when every stage is synchronous, so the common
   * no-extensions path costs no microtask hop. Exactly one DOMPurify pass
   * runs per render: the default renderer skips its internal pass when
   * `transformHtml` extensions are registered, and renderers declaring
   * `sanitizesOutput` skip the pipeline pass when no `transformHtml`
   * extension is registered.
   */
  public renderMarkdown(
    markdown: string,
    context: MdzipMarkdownRenderContext
  ): string | Promise<string> {
    const htmlTransforms = this.extensions.filter((ext) => ext.transformHtml);
    let value: string | Promise<string> = markdown;

    for (const ext of this.extensions) {
      if (ext.transformMarkdown) {
        value = chainRenderStage(value, (md) => ext.transformMarkdown!(md, context), context.signal);
      }
    }

    value = chainRenderStage(value, (md) => {
      if (this.renderer === defaultSafeMarkdownRenderer && htmlTransforms.length > 0) {
        // Render unsanitized so the single DOMPurify pass runs after the
        // transformHtml stage instead of twice.
        return renderDefaultMarkdownUnsanitized(md);
      }
      return this.renderer.render(md, context);
    }, context.signal);

    for (const ext of htmlTransforms) {
      value = chainRenderStage(value, (html) => ext.transformHtml!(html, context), context.signal);
    }

    const skipSanitize = htmlTransforms.length === 0 && this.renderer.sanitizesOutput === true;
    if (!skipSanitize) {
      const contributions = this.extensions
        .map((ext) => ext.sanitize)
        .filter((contribution): contribution is MdzipSanitizeContribution => contribution !== undefined);
      value = chainRenderStage(value, (html) => sanitizeMdzipHtml(html, contributions), context.signal);
    }
    return value;
  }

  /**
   * Lexes markdown into top-level block tokens without rendering or
   * sanitizing anything, for callers that want to render/mount the result
   * incrementally (see {@link renderChunk}) instead of all at once. Runs
   * `transformMarkdown` extensions first, same as {@link renderMarkdown} —
   * they still see the whole markdown string once; chunking is a
   * post-transform concern.
   *
   * Only supported with {@link defaultSafeMarkdownRenderer}: a host-supplied
   * custom renderer takes a markdown string and returns opaque HTML with no
   * token structure to chunk by.
   */
  public tokenizeMarkdown(
    markdown: string,
    context: MdzipMarkdownRenderContext
  ): TokensList | Promise<TokensList> {
    if (this.renderer !== defaultSafeMarkdownRenderer) {
      throw new Error(
        'tokenizeMarkdown() only supports the default marked-based renderer; a custom renderer has no token structure to chunk by.'
      );
    }
    let value: string | Promise<string> = markdown;
    for (const ext of this.extensions) {
      if (ext.transformMarkdown) {
        value = chainRenderStage(value, (md) => ext.transformMarkdown!(md, context), context.signal);
      }
    }
    if (isThenable(value)) {
      return Promise.resolve(value).then((resolved) => {
        if (context.signal.aborted) {
          throw createAbortError();
        }
        const tokens = marked.lexer(resolved);
        assignMdzipHeadingIds(tokens);
        return tokens;
      });
    }
    const tokens = marked.lexer(value);
    assignMdzipHeadingIds(tokens);
    return tokens;
  }

  /**
   * Renders a subset of tokens from {@link tokenizeMarkdown} through
   * `transformHtml*` and sanitize — the back half of the pipeline documented
   * on {@link MdzipMarkdownRenderExtension}, starting from tokens instead of
   * a markdown string. Always sanitizes (unlike {@link renderMarkdown}, which
   * can skip its pipeline pass when the renderer already sanitized
   * internally): this deliberately calls the underlying `marked` parser
   * directly rather than `defaultSafeMarkdownRenderer.render()`, so that
   * internal sanitize pass never runs and this is the only one that will.
   */
  public renderChunk(
    tokens: readonly Token[],
    context: MdzipMarkdownRenderContext
  ): string | Promise<string> {
    if (this.renderer !== defaultSafeMarkdownRenderer) {
      throw new Error(
        'renderChunk() only supports the default marked-based renderer; a custom renderer has no token structure to render from.'
      );
    }
    let value: string | Promise<string> = marked.parser(tokens as Token[]);
    for (const ext of this.extensions) {
      if (ext.transformHtml) {
        value = chainRenderStage(value, (html) => ext.transformHtml!(html, context), context.signal);
      }
    }
    const contributions = this.extensions
      .map((ext) => ext.sanitize)
      .filter((contribution): contribution is MdzipSanitizeContribution => contribution !== undefined);
    return chainRenderStage(value, (html) => sanitizeMdzipHtml(html, contributions), context.signal);
  }
}

const DEFAULT_CHUNK_TOKEN_CAP = 40;
const DEFAULT_CHUNK_CHAR_BUDGET = 2000;

export interface MdzipChunkOptions {
  /** Max tokens per chunk, whichever of this or `charBudget` is hit first. Default 40. */
  tokenCap?: number;
  /** Approximate max raw markdown chars per chunk (via each token's `.raw.length`). Default 2000. */
  charBudget?: number;
  /**
   * When a token matches, it's isolated into its own chunk regardless of the
   * budget: any chunk-in-progress is closed first, the matching token forms
   * a chunk by itself, and accumulation resumes fresh after it. Callers
   * combine every registered extension's {@link MdzipMarkdownRenderExtension.shouldIsolateChunk}
   * into one predicate — see that doc comment for why this matters.
   */
  shouldIsolate?: (token: Token) => boolean;
  /**
   * When a token matches, any chunk-in-progress is closed first and the
   * matching token starts a fresh one (unlike `shouldIsolate`, later tokens
   * keep accumulating into that new chunk under the normal budget — the
   * matching token doesn't get a chunk to itself). Used to keep unrelated
   * sections from sharing a chunk: without this, a document short enough to
   * fit several headings' worth of content under the budget lets an edit in
   * one section's prose invalidate a sibling section's untouched heading and
   * content too, tearing them out of the DOM and back in — a real, visible
   * flash for content that never changed.
   */
  shouldStartChunk?: (token: Token) => boolean;
}

const IMAGE_MARKDOWN_PATTERN = /!\[[^\]]*\]\([^)]*\)/;
const IMAGE_HTML_PATTERN = /<img\b/i;

/**
 * True when a token's raw source embeds an image (Markdown `![]()` syntax or
 * a raw `<img>` tag). Used to isolate the token into its own chunk: without
 * this, a short document can put an image in the same budget-sized chunk as
 * unrelated surrounding prose, so an edit anywhere in that prose tears the
 * image out of the DOM and reinserts it — a real, visible flash, since the
 * browser has to redo layout for a freshly-inserted `<img>` even when its
 * source is a cache hit.
 */
export function tokenEmbedsImage(token: Token): boolean {
  const raw = token.raw ?? '';
  return IMAGE_MARKDOWN_PATTERN.test(raw) || IMAGE_HTML_PATTERN.test(raw);
}

/**
 * True for a heading token — used as {@link MdzipChunkOptions.shouldStartChunk}
 * so a heading always begins a fresh chunk instead of merging with whatever
 * content (and sibling headings) happened to precede it under the size
 * budget. See that option's doc comment for why: it keeps an edit in one
 * section from also tearing down an untouched sibling section.
 */
export function tokenIsHeading(token: Token): boolean {
  return token.type === 'heading';
}

/**
 * Groups top-level block tokens from {@link MdzipRenderingService.tokenizeMarkdown}
 * into chunks suitable for incremental rendering — a token-count cap and a
 * char-budget estimate, whichever is hit first, so a document made of many
 * tiny tokens (e.g. a chat export's one-line-paragraph-per-message shape)
 * doesn't end up with one chunk per token. A single token larger than the
 * budget still gets its own chunk on its own (a chunk boundary can never
 * split a token). `shouldIsolate` overrides the budget in one direction —
 * forcing a matching token into its own chunk even when the budget would
 * have happily grouped it with neighbors; `shouldStartChunk` overrides it in
 * the other — forcing a boundary before a matching token even when the
 * budget would have merged it with what came before.
 */
export function groupTokensIntoChunks(
  tokens: readonly Token[],
  options: MdzipChunkOptions = {}
): Token[][] {
  const tokenCap = options.tokenCap ?? DEFAULT_CHUNK_TOKEN_CAP;
  const charBudget = options.charBudget ?? DEFAULT_CHUNK_CHAR_BUDGET;
  const chunks: Token[][] = [];
  let current: Token[] = [];
  let currentChars = 0;
  for (const token of tokens) {
    if (options.shouldIsolate?.(token)) {
      if (current.length > 0) {
        chunks.push(current);
        current = [];
        currentChars = 0;
      }
      chunks.push([token]);
      continue;
    }
    if (options.shouldStartChunk?.(token) && current.length > 0) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(token);
    currentChars += token.raw?.length ?? 0;
    if (current.length >= tokenCap || currentChars >= charBudget) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

/**
 * Stable identity key for a chunk: the exact source text `marked` consumed
 * for it (concatenation of each token's `.raw`). Two chunks with the same key
 * are guaranteed to have identical source text, since `.raw` slices tile the
 * whole input contiguously — safe to use as a plain string equality key (no
 * hashing needed; chunks are budget-capped ~2000 chars, and a render involves
 * at most a few dozen of them).
 *
 * Deliberately keys on SOURCE text only, never on rendered output: an
 * extension's `transformHtml` can be side-effecting per call (e.g. the
 * mermaid extension's per-call SVG id counter), so identical keys must never
 * be treated as license to re-run rendering — only as license to skip it and
 * reuse whatever is already mounted for that chunk.
 */
export function chunkSourceKey(chunk: readonly Token[]): string {
  const raw = chunk.map((token) => token.raw ?? '').join('');
  // A heading's id depends on the whole document (an earlier duplicate
  // shifts `intro` to `intro-1`), not just this chunk's own text — so a chunk
  // whose source is unchanged but whose ids moved must not be reused as-is.
  const ids = collectMdzipHeadingIds(chunk);
  return ids.length > 0 ? `${raw}\u0000${ids.join('\u0001')}` : raw;
}

function rewriteAssetSources(markdown: string, resolver: MdzipAssetUrlResolver): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (match, alt: string, rawPath: string, title?: string) => {
      const path = rawPath.replace(/^<|>$/g, '');
      const resolved = resolver.resolveAssetUrl(path);
      if (!resolved) {
        return match;
      }
      const suffix = title ? ` "${title.replace(/"/g, '&quot;')}"` : '';
      return `![${alt}](${resolved}${suffix})`;
    }
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
