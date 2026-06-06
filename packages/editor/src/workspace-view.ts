import { marked } from 'marked';
import hljs from 'highlight.js';
import type { ArchiveEntry } from './archive-utils.js';
import type { MdzipPathType, MdzipWorkspaceMode, MdzipWorkspaceSnapshot } from './workspace.js';

marked.use({
  renderer: {
    code(token: { lang?: string; text: string }) {
      const lang = token.lang || '';
      const code = token.text;

      if (lang && hljs.getLanguage(lang)) {
        try {
          const highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
          return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
        } catch {
          return `<pre><code>${code}</code></pre>`;
        }
      }
      return `<pre><code>${code}</code></pre>`;
    }
  }
});

export interface MdzipNavNode {
  name: string;
  path: string;
  children: MdzipNavNode[];
  entry?: ArchiveEntry;
}

export function buildMdzipNavTree(entries: ArchiveEntry[]): MdzipNavNode[] {
  const root: MdzipNavNode = { name: '', path: '', children: [] };

  for (const entry of entries.slice().sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = entry.path.split('/').filter(Boolean);
    let current = root;
    let path = '';

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? '';
      path = path ? `${path}/${part}` : part;
      const isFile = index === parts.length - 1;

      if (isFile) {
        current.children.push({ name: part, path, children: [], entry });
      } else {
        let child = current.children.find((node) => !node.entry && node.name === part);
        if (!child) {
          child = { name: part, path, children: [] };
          current.children.push(child);
        }
        current = child;
      }
    }
  }

  return root.children.sort(sortNavNodes);
}

export function canEditMdzipPath(
  pathType: MdzipPathType,
  archivePath: string,
  mode: MdzipWorkspaceMode = 'editable'
): boolean {
  return mode !== 'read-only'
    && (pathType === 'markdown' || pathType === 'text')
    && !isMdzipManifestPath(archivePath);
}

export function isMdzipManifestPath(path: string): boolean {
  return path.toLowerCase().split('/').pop() === 'manifest.json';
}

export function isOrphanedMdzipAsset(entry: ArchiveEntry, state: MdzipWorkspaceSnapshot): boolean {
  if (!entry.isImage) {
    return false;
  }
  const orphaned = new Set(state.content.orphanedAssetPaths.map((path) => path.toLowerCase()));
  return orphaned.has(entry.path.toLowerCase());
}

export function mdzipEntryIconLabel(entry: ArchiveEntry): string {
  if (entry.isMarkdown) return '';
  if (isMdzipManifestPath(entry.path)) return '{}';
  if (entry.isImage) return 'IMG';
  return 'TXT';
}

export function mdzipEntryIconKind(entry: ArchiveEntry): 'markdown' | 'manifest' | 'image' | 'file' {
  if (entry.isMarkdown) return 'markdown';
  if (isMdzipManifestPath(entry.path)) return 'manifest';
  if (entry.isImage) return 'image';
  return 'file';
}

export function renderMdzipPreviewHtml(state: MdzipWorkspaceSnapshot): string {
  if (state.currentPathType === 'image') {
    const src = state.content.images.get(state.currentPath) ?? '';
    return src
      ? `<div class="asset-preview-wrap"><img class="asset-preview-image" src="${src}" alt="${escapeHtml(state.currentPath)}"></div>`
      : `<div class="asset-preview-empty">Image preview unavailable for ${escapeHtml(state.currentPath)}.</div>`;
  }

  if (state.currentPathType === 'binary') {
    return `<div class="asset-preview-empty">Binary file preview unavailable for ${escapeHtml(state.currentPath)}.</div>`;
  }

  if (state.currentPathType === 'text') {
    return `<pre class="plain-text-preview"><code>${escapeHtml(state.currentText)}</code></pre>`;
  }

  const rewritten = rewriteMdzipImageSources(state.currentText, state.content.images);
  const rendered = marked.parse(rewritten, { async: false });
  return typeof rendered === 'string' ? rendered : escapeHtml(state.currentText);
}

export function resolveMdzipArchiveLinkTarget(
  href: string,
  currentPath: string,
  entries: readonly ArchiveEntry[]
): string | null {
  const cleanHref = href.trim();
  if (!cleanHref || cleanHref.startsWith('#')) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(cleanHref) || cleanHref.startsWith('//')) {
    return null;
  }

  const withoutHash = cleanHref.split('#')[0] ?? '';
  const withoutQuery = withoutHash.split('?')[0] ?? '';
  const decoded = decodeURIComponent(withoutQuery).replace(/^<|>$/g, '').replace(/\\/g, '/');
  if (!decoded || decoded.endsWith('/')) {
    return null;
  }

  const baseDir = currentPath.includes('/')
    ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1)
    : '';
  const candidate = normalizeArchiveLinkPath(decoded.startsWith('/') ? decoded.slice(1) : `${baseDir}${decoded}`);
  if (!candidate) {
    return null;
  }

  const target = entries.find((entry) => entry.path.toLowerCase() === candidate.toLowerCase());
  return target?.isMarkdown ? target.path : null;
}

export function highlightMdzipMarkdownSource(source: string): string {
  const lines = source.split('\n');
  let inFence = false;

  return lines.map((line) => {
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      inFence = !inFence;
      return `${escapeHtml(fenceMatch[1] ?? '')}<span class="md-syntax-marker">${escapeHtml(fenceMatch[2] ?? '')}</span><span class="md-syntax-fence">${escapeHtml(fenceMatch[3] ?? '')}</span>`;
    }

    if (inFence) {
      return `<span class="md-syntax-code">${escapeHtml(line)}</span>`;
    }

    const headingMatch = line.match(/^(\s{0,3})(#{1,6})(\s+.*)?$/);
    if (headingMatch) {
      return `${escapeHtml(headingMatch[1] ?? '')}<span class="md-syntax-marker">${escapeHtml(headingMatch[2] ?? '')}</span><span class="md-syntax-heading">${highlightMarkdownInline(headingMatch[3] ?? '')}</span>`;
    }

    const quoteMatch = line.match(/^(\s{0,3}>+)(\s?.*)$/);
    if (quoteMatch) {
      return `<span class="md-syntax-quote">${escapeHtml(quoteMatch[1] ?? '')}</span>${highlightMarkdownInline(quoteMatch[2] ?? '')}`;
    }

    const ruleMatch = line.match(/^(\s{0,3})([-*_])(?:\s*\2){2,}\s*$/);
    if (ruleMatch) {
      return `${escapeHtml(ruleMatch[1] ?? '')}<span class="md-syntax-rule">${escapeHtml(line.slice((ruleMatch[1] ?? '').length))}</span>`;
    }

    const listMatch = line.match(/^(\s*)([-+*]|\d+[.)])(\s+)(.*)$/);
    if (listMatch) {
      return `${escapeHtml(listMatch[1] ?? '')}<span class="md-syntax-marker">${escapeHtml(listMatch[2] ?? '')}</span>${escapeHtml(listMatch[3] ?? '')}${highlightMarkdownInline(listMatch[4] ?? '')}`;
    }

    return highlightMarkdownInline(line);
  }).join('\n');
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function rewriteMdzipImageSources(markdown: string, images: Map<string, string>): string {
  return markdown.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, alt, rawPath) => {
    const clean = String(rawPath).replace(/^<|>$/g, '').split(/[?#]/)[0] ?? '';
    const decoded = decodeURIComponent(clean);
    const src = images.get(decoded) ?? images.get(decoded.replace(/^\.\//, ''));
    return src ? `![${alt}](${src})` : match;
  });
}

function sortNavNodes(a: MdzipNavNode, b: MdzipNavNode): number {
  if (a.entry && !b.entry) return -1;
  if (!a.entry && b.entry) return 1;
  return a.name.localeCompare(b.name);
}

function normalizeArchiveLinkPath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (!parts.length) {
        return null;
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function highlightMarkdownInline(line: string): string {
  const pattern = /(!?\[[^\]\n]+\]\([^) \n]+(?:\s+"[^"]*")?\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  let output = '';
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    output += escapeHtml(line.slice(index, match.index));
    const token = match[0];
    if (token.startsWith('![')) {
      output += tokenSpan('md-syntax-image', token);
    } else if (token.startsWith('[')) {
      output += tokenSpan('md-syntax-link', token);
    } else if (token.startsWith('`')) {
      output += tokenSpan('md-syntax-code', token);
    } else {
      output += tokenSpan('md-syntax-emphasis', token);
    }
    index = pattern.lastIndex;
  }

  output += escapeHtml(line.slice(index));
  return output;
}

function tokenSpan(className: string, token: string): string {
  return `<span class="${className}">${escapeHtml(token)}</span>`;
}
