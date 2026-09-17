import hljs from 'highlight.js';
import type { MdzipFrontMatter } from './front-matter.js';
import { parseFrontMatter } from './front-matter.js';
import type { MdzipMarkdownRenderContext, MdzipMarkdownRenderExtension } from './rendering.js';

/** `'table'` — a key/value table. `'raw'` — the YAML source as a syntax-highlighted fenced code block. */
export type MdzipFrontMatterDisplay = 'table' | 'raw';

export interface MdzipFrontMatterOptions {
  /**
   * Whether front matter renders in the preview at all. The block is always
   * stripped from the markdown either way (so it never falls through to
   * `marked` as a stray `<hr>` plus paragraph/setext heading) — this only
   * controls whether anything renders in its place. Defaults to `true`.
   */
  enabled?: boolean;
  /** Defaults to `'table'`. */
  display?: MdzipFrontMatterDisplay;
  /**
   * Wraps the panel in a collapsible `<details>` (default `true`). `false`
   * renders a static, always-visible block with the same header and body,
   * but no expand/collapse toggle.
   */
  collapsible?: boolean;
  /**
   * Label shown in the panel header. A fixed string (e.g. `'Front Matter'`,
   * `'Metadata'`), or the sentinel `'first-line'` to use the front matter
   * block's own first raw YAML line instead (e.g. `title: My Document`) —
   * falls back to the default label if the block is empty. Defaults to
   * `'Front matter'`.
   */
  label?: string;
}

const DEFAULT_LABEL = 'Front matter';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatFrontMatterValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) {
    return value.join(', ');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function renderTableBody(frontMatter: MdzipFrontMatter): string {
  const entries = Object.entries(frontMatter.data);
  if (entries.length === 0) {
    return '';
  }
  const rows = entries
    .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(formatFrontMatterValue(value))}</td></tr>`)
    .join('');
  return `<table class="mdzip-frontmatter-table"><tbody>${rows}</tbody></table>`;
}

function renderRawBody(frontMatter: MdzipFrontMatter): string {
  if (frontMatter.raw.trim() === '') {
    return '';
  }
  let highlighted: string;
  try {
    highlighted = hljs.highlight(frontMatter.raw, { language: 'yaml', ignoreIllegals: true }).value;
  } catch {
    highlighted = escapeHtml(frontMatter.raw);
  }
  return `<pre><code class="hljs language-yaml">${highlighted}</code></pre>`;
}

function firstRawLine(raw: string): string | undefined {
  return raw.split('\n', 1)[0]?.trim() || undefined;
}

function resolveLabel(options: MdzipFrontMatterOptions, frontMatter: MdzipFrontMatter): string {
  if (options.label === 'first-line') {
    return firstRawLine(frontMatter.raw) ?? DEFAULT_LABEL;
  }
  return options.label?.trim() || DEFAULT_LABEL;
}

function renderPanel(options: MdzipFrontMatterOptions, frontMatter: MdzipFrontMatter): string {
  const body = options.display === 'raw' ? renderRawBody(frontMatter) : renderTableBody(frontMatter);
  if (!body) {
    return '';
  }
  const label = escapeHtml(resolveLabel(options, frontMatter));
  if (options.collapsible === false) {
    return `<div class="mdzip-frontmatter mdzip-frontmatter-static"><div class="mdzip-frontmatter-summary">${label}</div>${body}</div>`;
  }
  return `<details class="mdzip-frontmatter" open><summary class="mdzip-frontmatter-summary">${label}</summary>${body}</details>`;
}

/**
 * A markdown render extension that recognizes a leading `---`-delimited YAML
 * front matter block, strips it from the markdown before the renderer sees
 * it, and renders it in the preview per {@link MdzipFrontMatterOptions}.
 *
 * Unlike the Mermaid extension, this one is DOM-free and lightweight enough
 * that it does not need an opt-in `markdownExtensions` entry — hosts get it
 * registered by default (see {@link MdzipWorkspaceViewOptions.frontMatter}).
 *
 * `transformMarkdown` and `transformHtml` run against the same render
 * context object within one render generation (including once per chunk in
 * the chunked preview path), so the parsed front matter is stashed keyed by
 * that context and consumed by whichever `transformHtml` call comes first —
 * always chunk 0, since chunks render in strict order.
 */
export function mdzipFrontMatterExtension(options: MdzipFrontMatterOptions = {}): MdzipMarkdownRenderExtension {
  const enabled = options.enabled ?? true;
  const pending = new WeakMap<MdzipMarkdownRenderContext, MdzipFrontMatter>();

  return {
    name: 'front-matter',
    transformMarkdown(markdown, context) {
      const parsed = parseFrontMatter(markdown);
      if (!parsed) {
        return markdown;
      }
      pending.set(context, parsed);
      return parsed.body;
    },
    transformHtml(html, context) {
      const parsed = pending.get(context);
      if (!parsed) {
        return html;
      }
      pending.delete(context);
      if (!enabled) {
        return html;
      }
      const panel = renderPanel(options, parsed);
      return panel ? panel + html : html;
    }
  };
}
