import DOMPurify from 'isomorphic-dompurify';
import hljs from 'highlight.js';
import { Marked, type Tokens } from 'marked';

export interface MdzipMarkdownRenderer {
  render(markdown: string, options?: Record<string, unknown>): string;
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
      return `<pre><code>${escapeHtml(token.text)}</code></pre>`;
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

export const defaultSafeMarkdownRenderer: MdzipMarkdownRenderer = {
  render(markdown: string): string {
    const rendered = marked.parse(markdown, { async: false });
    const html = typeof rendered === 'string' ? rendered : escapeHtml(markdown);
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['class'],
      FORBID_TAGS: ['base', 'embed', 'form', 'iframe', 'input', 'link', 'meta', 'object', 'script', 'style'],
      FORBID_ATTR: ['style'],
      ALLOW_DATA_ATTR: false
    });
  }
};

export class MdzipRenderingService {
  public constructor(private readonly renderer: MdzipMarkdownRenderer = defaultSafeMarkdownRenderer) {}

  public render(request: MdzipRenderRequest): MdzipRenderResult {
    const markdown = request.assetResolver
      ? rewriteAssetSources(request.markdown, request.assetResolver)
      : request.markdown;
    return {
      html: this.renderer.render(markdown)
    };
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
