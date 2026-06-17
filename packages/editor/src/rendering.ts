import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import { Marked, type Tokens } from 'marked';
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

const marked = new Marked({
  renderer: {
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
  const rendered = marked.parse(markdown, { async: false });
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
