import type { MdzipMarkdownRenderExtension } from './rendering.js';
import { sanitizeMdzipHtml } from './rendering.js';

export type MdzipMermaidTheme = 'auto' | 'default' | 'dark' | 'neutral' | 'forest' | 'base';

/**
 * Minimal surface of the `mermaid` module the extension relies on. Exposed so
 * the loader can be supplied directly (tests, or hosts that already own a
 * mermaid instance) instead of going through the lazy dynamic import.
 */
export interface MdzipMermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

export interface MdzipMermaidOptions {
  /**
   * Mermaid theme. `'auto'` (the default) follows the preview color scheme —
   * the `dark` theme under a dark scheme, `default` under light.
   */
  theme?: MdzipMermaidTheme;
  /**
   * Supplies the mermaid API instead of the built-in lazy `import('mermaid')`.
   * Use for tests or to share a preconfigured instance. When omitted, mermaid
   * is dynamically imported the first time a `mermaid` block is rendered.
   */
  loadMermaid?: () => Promise<MdzipMermaidApi>;
}

let defaultMermaidPromise: Promise<MdzipMermaidApi> | null = null;

function loadDefaultMermaid(): Promise<MdzipMermaidApi> {
  // Literal specifier so bundlers can split mermaid into its own lazily-loaded
  // chunk. Memoized so the module is fetched and parsed at most once.
  defaultMermaidPromise ??= import('mermaid').then(
    (module) => ((module as { default?: MdzipMermaidApi }).default ?? module) as MdzipMermaidApi
  );
  return defaultMermaidPromise;
}

function resolveTheme(theme: MdzipMermaidTheme, colorScheme: 'light' | 'dark'): string {
  if (theme === 'auto') {
    return colorScheme === 'dark' ? 'dark' : 'default';
  }
  return theme;
}

function requireDocument(): Document {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) {
    throw new Error('The mermaid extension requires a DOM document to render diagrams.');
  }
  return doc;
}

// Mermaid SVG carries a nested <style> element and inline style attributes for
// theming, so the diagram needs SVG plus those two relaxations to survive the
// sanitizer. Reused both for the extension's contribution to the pipeline pass
// and for defensively re-sanitizing each SVG before it is injected.
const MERMAID_SANITIZE = {
  allowSvg: true,
  unforbidTags: ['style'],
  unforbidAttr: ['style']
} as const;

function mermaidErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Mermaid diagram error: ${detail}`;
}

/**
 * A markdown render extension that renders fenced ` ```mermaid ` code blocks to
 * inline SVG in the preview.
 *
 * Ships as a separate entrypoint (`@mdzip/editor/mermaid`) so the ~1MB mermaid
 * library stays out of the core bundle: it is dynamically imported the first
 * time a document actually contains a mermaid block. Pass the returned
 * extension via the view's `markdownExtensions` option.
 *
 * Diagrams render with mermaid's `strict` security level, each SVG is
 * re-sanitized before injection, and invalid diagrams render as an inline
 * error block instead of breaking the whole preview. The theme follows the
 * preview color scheme by default ({@link MdzipMermaidOptions.theme}).
 *
 * Note: enabling this widens the preview's sanitize policy to allow SVG and
 * inline styles for the whole render (not just the diagram), since the markdown
 * HTML and diagram SVG are sanitized together.
 */
export function mdzipMermaidExtension(options: MdzipMermaidOptions = {}): MdzipMarkdownRenderExtension {
  const load = options.loadMermaid ?? loadDefaultMermaid;
  let counter = 0;

  return {
    name: 'mermaid',
    sanitize: MERMAID_SANITIZE,
    async transformHtml(html, context) {
      const doc = requireDocument();
      const template = doc.createElement('template');
      template.innerHTML = html;
      const blocks = Array.from(
        template.content.querySelectorAll<HTMLElement>('pre > code.language-mermaid')
      );
      if (blocks.length === 0) {
        return html;
      }

      const mermaid = await load();
      if (context.signal.aborted) {
        return html;
      }
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        // Render labels as SVG <text> rather than HTML inside <foreignObject>.
        // The bundled sanitizer keeps the SVG but strips foreignObject HTML, so
        // html labels would otherwise vanish — this keeps the emitted SVG
        // self-consistent with the policy without re-allowing HTML in labels.
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        theme: resolveTheme(options.theme ?? 'auto', context.colorScheme)
      });

      for (const code of blocks) {
        const pre = code.parentElement;
        if (!pre) {
          continue;
        }
        const source = code.textContent ?? '';
        const container = doc.createElement('div');
        try {
          const { svg } = await mermaid.render(`mdzip-mermaid-${(counter += 1)}`, source);
          container.className = 'mdzip-mermaid';
          container.innerHTML = sanitizeMdzipHtml(svg, [MERMAID_SANITIZE]);
        } catch (error) {
          container.className = 'mdzip-mermaid-error';
          container.textContent = mermaidErrorMessage(error);
        }
        pre.replaceWith(container);
        if (context.signal.aborted) {
          return html;
        }
      }

      return template.innerHTML;
    }
  };
}
