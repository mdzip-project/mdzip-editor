/**
 * Find in the rendered preview (#62): the text a reader sees, matched
 * without the Markdown syntax, and highlighted with the CSS Custom
 * Highlight API so the preview's DOM isn't changed (copying, links and the
 * chunk cache are unaffected).
 */

/** Element subtrees whose text isn't document text: editor chrome, styles, drawn diagrams. */
export const FIND_SKIP_SELECTOR = [
  '.mdzip-code-block-header',
  '.mdzip-chunk-sentinel',
  '[data-mdzip-image-edit-affordance]',
  'style',
  'script',
  'template',
  'svg',
  'button',
  '.mdzip-drawio-placeholder',
  // A Mermaid diagram's source, before and instead of the drawing.
  'code.language-mermaid'
].join(',');

// Elements that start a new run of text: a match doesn't cross from one into another.
const BLOCK_SELECTOR = 'p,li,h1,h2,h3,h4,h5,h6,pre,td,th,dt,dd,blockquote,figcaption,caption,summary,div,section,article,table,tr,ul,ol,dl,details,hr,br';

// Between runs of text in different blocks. Not whitespace, so a query's
// spaces (matched as \s+) don't reach across it.
const BLOCK_BREAK = '\u0000';

/** A root's searchable text, and where each of its text nodes starts in it. */
export interface FindText {
  text: string;
  nodes: Text[];
  starts: number[];
}

/** The text of `root` as the find bar searches it. */
export function collectFindText(root: Node): FindText {
  const doc = root.ownerDocument ?? (root as Document);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  let lastBlock: Element | null | undefined;
  // NodeFilter: SHOW_ELEMENT | SHOW_TEXT; FILTER_ACCEPT 1, REJECT 2 (skips the subtree), SKIP 3.
  const walker = doc.createTreeWalker(root, 0x1 | 0x4, {
    acceptNode: (node) => node.nodeType === 1
      ? ((node as Element).matches(FIND_SKIP_SELECTOR) ? 2 : 3)
      : 1
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const data = (node as Text).data;
    if (!data) {
      continue;
    }
    const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
    if (lastBlock !== undefined && block !== lastBlock) {
      text += BLOCK_BREAK;
    }
    lastBlock = block;
    nodes.push(node as Text);
    starts.push(text.length);
    text += data;
  }
  return { text, nodes, starts };
}

/** A regular expression for `query`, or null for an empty one. Spaces match any run of whitespace. */
export function findPattern(query: string, matchCase: boolean): RegExp | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return null;
  }
  const source = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(source, matchCase ? 'gu' : 'giu');
}

/** Start and end offsets of each match of `pattern` in `text`. */
export function findMatches(text: string, pattern: RegExp): Array<[number, number]> {
  const matches: Array<[number, number]> = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (!match[0]) {
      pattern.lastIndex += 1;
      continue;
    }
    matches.push([match.index, match.index + match[0].length]);
  }
  return matches;
}

/** The DOM range of `[start, end)` in `found`'s text, or null when it's no longer there. */
export function findRange(found: FindText, start: number, end: number): Range | null {
  const from = locate(found, start, false);
  const to = locate(found, end, true);
  if (!from || !to) {
    return null;
  }
  const range = from.node.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

function locate(found: FindText, offset: number, isEnd: boolean): { node: Text; offset: number } | null {
  // The last node starting at or before the offset (at an end, before it).
  let low = 0;
  let high = found.starts.length - 1;
  let at = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (isEnd ? found.starts[mid] < offset : found.starts[mid] <= offset) {
      at = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (at < 0) {
    return null;
  }
  const node = found.nodes[at];
  const within = offset - found.starts[at];
  return within >= 0 && within <= node.data.length ? { node, offset: within } : null;
}

// --- Highlights ------------------------------------------------------------------

/** Names of the two highlights, styled by the view's CSS with `::highlight()`. */
export const FIND_HIGHLIGHT = 'mdzip-find';
export const FIND_HIGHLIGHT_CURRENT = 'mdzip-find-current';

interface HighlightRegistry {
  set(name: string, highlight: unknown): unknown;
  delete(name: string): unknown;
}

// Several views can share a document, and the registry is per document:
// each view's ranges are kept here and the highlights hold them all.
const ownerRanges = new Map<Document, Map<object, { all: Range[]; current: Range | null }>>();

function registryOf(doc: Document): { registry: HighlightRegistry; Highlight: new (...ranges: Range[]) => unknown } | null {
  const win = doc.defaultView as (Window & { CSS?: { highlights?: HighlightRegistry }; Highlight?: new (...ranges: Range[]) => unknown }) | null;
  const registry = win?.CSS?.highlights;
  const Highlight = win?.Highlight;
  return registry && Highlight ? { registry, Highlight } : null;
}

/** Whether matches can be highlighted (the CSS Custom Highlight API). */
export function canHighlightFindMatches(doc: Document): boolean {
  return registryOf(doc) !== null;
}

/** Shows `owner`'s matches, replacing what it showed before; an empty list with no current clears them. */
export function setFindHighlights(doc: Document, owner: object, all: Range[], current: Range | null): void {
  let owners = ownerRanges.get(doc);
  if (!owners) {
    owners = new Map();
    ownerRanges.set(doc, owners);
  }
  if (all.length || current) {
    owners.set(owner, { all, current });
  } else {
    owners.delete(owner);
  }
  const api = registryOf(doc);
  if (!api) {
    return;
  }
  const allRanges: Range[] = [];
  const currentRanges: Range[] = [];
  for (const entry of owners.values()) {
    allRanges.push(...entry.all);
    if (entry.current) {
      currentRanges.push(entry.current);
    }
  }
  if (allRanges.length) {
    api.registry.set(FIND_HIGHLIGHT, new api.Highlight(...allRanges));
  } else {
    api.registry.delete(FIND_HIGHLIGHT);
  }
  if (currentRanges.length) {
    const current = new api.Highlight(...currentRanges) as { priority?: number };
    // Painted over the other matches.
    current.priority = 1;
    api.registry.set(FIND_HIGHLIGHT_CURRENT, current);
  } else {
    api.registry.delete(FIND_HIGHLIGHT_CURRENT);
  }
  if (!owners.size) {
    ownerRanges.delete(doc);
  }
}
