// Locates an existing image reference (Markdown `![]()` or raw HTML `<img>`,
// optionally wrapped in `<p align="...">`) around a document offset, and
// formats a decision back into replacement text for that exact range. Pure
// text/syntax-tree logic — no DOM, no MdzipWorkspaceView dependency — so it
// can be unit tested standalone and reused by the click-to-edit affordance
// in view.ts.
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { escapeHtml } from './workspace-view.js';
import type { MdzipImageInsertDecision, MdzipImageInsertOutputMode, MdzipImagePosition } from './view.js';

export interface MdzipParsedImageReference {
  kind: MdzipImageInsertOutputMode;
  /** Exact doc range to replace when applying an edit decision. Half-open. */
  from: number;
  to: number;
  /** Text currently at [from, to) — used as a race guard before applying an edit. */
  raw: string;
  src: string;
  altText: string;
  width?: number;
  height?: number;
  position: MdzipImagePosition;
}

const IMAGE_NODE_NAMES = new Set(['Image']);
const HTML_CONTAINER_NODE_NAMES = new Set(['HTMLBlock', 'HTMLTag']);

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const ATTR_RE = /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const WRAP_P_RE = /^<p\b[^>]*\salign\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))[^>]*>\s*<img\b[^>]*>\s*<\/p>\s*$/i;

/**
 * Finds the enclosing node of one of `names` at `offset`, trying both sides
 * of the offset (a click can land right at a node's opening or closing
 * boundary, and `resolveInner`'s `side` argument only favors one direction).
 */
function resolveAncestorNode(state: EditorState, offset: number, names: ReadonlySet<string>) {
  const tree = syntaxTree(state);
  for (const side of [-1, 1] as const) {
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(offset, side);
    while (node) {
      if (names.has(node.name)) {
        return node;
      }
      node = node.parent;
    }
  }
  return null;
}

function parseDim(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function escapeMarkdownImageAlt(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/]/g, '\\]');
}

function unescapeMarkdownImageAlt(value: string): string {
  return value.replace(/\\\\|\\]/g, (match) => (match === '\\\\' ? '\\' : ']'));
}

function parseHtmlAttributes(tagSource: string): Map<string, string> {
  const attrs = new Map<string, string>();
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(tagSource))) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function parseMarkdownImageAt(state: EditorState, offset: number): MdzipParsedImageReference | null {
  const found = resolveAncestorNode(state, offset, IMAGE_NODE_NAMES);
  if (!found) {
    return null;
  }
  const urlNode = found.getChild('URL');
  if (!urlNode) {
    // Reference-style `![alt][label]` has no URL child — out of scope.
    return null;
  }
  const marks = found.getChildren('LinkMark');
  if (marks.length < 2) {
    return null;
  }
  const doc = state.doc;
  const altText = unescapeMarkdownImageAlt(doc.sliceString(marks[0].to, marks[1].from));
  const src = doc.sliceString(urlNode.from, urlNode.to);
  return {
    kind: 'markdown',
    from: found.from,
    to: found.to,
    raw: doc.sliceString(found.from, found.to),
    src,
    altText,
    width: undefined,
    height: undefined,
    position: 'inline'
  };
}

function parseHtmlImageAt(state: EditorState, offset: number): MdzipParsedImageReference | null {
  const container = resolveAncestorNode(state, offset, HTML_CONTAINER_NODE_NAMES);
  if (!container) {
    return null;
  }
  const doc = state.doc;
  const containerText = doc.sliceString(container.from, container.to);

  // `<p align="...">` wrapping is checked against the whole block first,
  // independent of exactly where within it `offset` lands — the wrapper is
  // just position styling, so a click anywhere in the block (including on
  // the <p> tag itself, not only the nested <img>) should hit the image.
  if (container.name === 'HTMLBlock') {
    const wrapperMatch = WRAP_P_RE.exec(containerText.trim());
    if (wrapperMatch) {
      IMG_TAG_RE.lastIndex = 0;
      const imgMatch = IMG_TAG_RE.exec(containerText);
      const attrs = imgMatch ? parseHtmlAttributes(imgMatch[0]) : null;
      const src = attrs?.get('src');
      if (attrs && src) {
        const align = (wrapperMatch[1] ?? wrapperMatch[2] ?? wrapperMatch[3] ?? '').toLowerCase();
        const position: MdzipImagePosition = align === 'left' || align === 'center' || align === 'right' ? align : 'inline';
        return {
          kind: 'html',
          from: container.from,
          to: container.to,
          raw: containerText,
          src: unescapeHtml(src),
          altText: unescapeHtml(attrs.get('alt') ?? ''),
          width: parseDim(attrs.get('width')),
          height: parseDim(attrs.get('height')),
          position
        };
      }
    }
  }

  // Not (or not validly) a <p align> wrapper — fall back to locating the
  // specific <img> tag offset lands on (needed for inline HTMLTag, and for
  // an HTMLBlock containing more than one raw <img>).
  IMG_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let hit: { text: string; from: number; to: number } | null = null;
  while ((match = IMG_TAG_RE.exec(containerText))) {
    const absFrom = container.from + match.index;
    const absTo = absFrom + match[0].length;
    if (offset >= absFrom && offset <= absTo) {
      hit = { text: match[0], from: absFrom, to: absTo };
      break;
    }
  }
  if (!hit) {
    return null;
  }

  const attrs = parseHtmlAttributes(hit.text);
  const src = attrs.get('src');
  if (!src) {
    return null;
  }
  const width = parseDim(attrs.get('width'));
  const height = parseDim(attrs.get('height'));
  const altText = unescapeHtml(attrs.get('alt') ?? '');
  const imgAlign = attrs.get('align')?.toLowerCase();
  const position: MdzipImagePosition = imgAlign === 'left' ? 'wrap-left' : imgAlign === 'right' ? 'wrap-right' : 'inline';
  return {
    kind: 'html',
    from: hit.from,
    to: hit.to,
    raw: hit.text,
    src: unescapeHtml(src),
    altText,
    width,
    height,
    position
  };
}

/** Finds the image reference (Markdown or raw HTML) enclosing `offset`, if any. */
export function findImageReferenceAtOffset(state: EditorState, offset: number): MdzipParsedImageReference | null {
  return parseMarkdownImageAt(state, offset) ?? parseHtmlImageAt(state, offset);
}

/**
 * Formats a decision as replacement text for an existing image's exact
 * range. Unlike `formatImageInsertMarkdown`, this never pads with
 * surrounding blank lines — the caller replaces an already-delimited
 * `[from, to)` span, not inserting at an arbitrary cursor position.
 */
export function formatImageEditMarkdown(src: string, decision: MdzipImageInsertDecision): string {
  if (decision.mode === 'html') {
    const attrs = [`src="${escapeHtml(src)}"`, `alt="${escapeHtml(decision.altText)}"`];
    if (decision.width) {
      attrs.push(`width="${decision.width}"`);
    }
    if (decision.height) {
      attrs.push(`height="${decision.height}"`);
    }
    if (decision.position === 'wrap-left' || decision.position === 'wrap-right') {
      attrs.push(`align="${decision.position === 'wrap-left' ? 'left' : 'right'}"`);
    }
    const image = `<img ${attrs.join(' ')}>`;
    if (decision.position === 'left' || decision.position === 'center' || decision.position === 'right') {
      return `<p align="${decision.position}">${image}</p>`;
    }
    return image;
  }
  return `![${escapeMarkdownImageAlt(decision.altText)}](${src})`;
}
