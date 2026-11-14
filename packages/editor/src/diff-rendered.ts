// Rendered mode for the archive diff view: both sides of a Markdown entry
// rendered the way the workspace preview renders them, with the top-level
// blocks that differ marked and the two sides scrolling together.
import type { MdzManifest } from '@mdzip/core-js';
import { mdzipFrontMatterExtension } from './front-matter-extension.js';
import { MdzipRenderingService, defaultSafeMarkdownRenderer } from './rendering.js';

/** Sources that don't point into the archive (any URL scheme, `//host`, `#fragment`). */
const NON_ARCHIVE_SOURCE_RE = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i;

/** Attribute recording an image's archive path and content hash, used to match blocks. */
export const DIFF_ASSET_ATTRIBUTE = 'data-mdzip-diff-asset';

/** Above this many cells, the block match falls back to marking the whole differing middle. */
const MAX_MATCH_CELLS = 2_000_000;

const renderingService = new MdzipRenderingService(defaultSafeMarkdownRenderer, [mdzipFrontMatterExtension()]);

export interface RenderedSideSource {
  /** The document's Markdown, or null when the entry doesn't exist on this side. */
  markdown: string | null;
  /** Archive path of the document, for resolving relative image paths. */
  path: string | undefined;
  manifest: MdzManifest | null;
  colorScheme: 'light' | 'dark';
  /** Reads an archive entry; resolves null when it doesn't exist. */
  readBytes(path: string): Promise<Uint8Array | null>;
  /** The content hash of an archive entry, when known. */
  hashOf(path: string): string | undefined;
  /** Turns image bytes into a URL the page can load (an object URL). */
  createUrl(bytes: Uint8Array, mime: string): string;
  /**
   * `'markdown'` for a plain `.md` document: images are files next to it
   * (resolved with {@link resolveLinkedPath}), not archive entries.
   * Default `'mdz'`.
   */
  sourceFormat?: 'mdz' | 'markdown';
}

/**
 * Renders one side to an inert fragment: archive images are loaded from the
 * archive and tagged with their path and hash; nothing is fetched from the
 * host page's location.
 */
export async function renderSideFragment(
  doc: Document,
  source: RenderedSideSource,
  signal: AbortSignal
): Promise<DocumentFragment | null> {
  if (source.markdown === null) return null;
  const plainMarkdown = source.sourceFormat === 'markdown';
  const html = await renderingService.renderMarkdown(source.markdown, {
    currentPath: source.path ?? '',
    sourceFormat: plainMarkdown ? 'markdown' : 'mdz',
    colorScheme: source.colorScheme,
    mode: 'read-only',
    manifest: source.manifest,
    signal
  });
  const template = doc.createElement('template');
  // Move every archive source aside before the markup is parsed into a live
  // context, so the browser never requests it relative to the host page.
  template.innerHTML = html;
  const images = Array.from(template.content.querySelectorAll<HTMLImageElement>('img[src]'));
  await Promise.all(images.map(async (image) => {
    const raw = image.getAttribute('src') ?? '';
    applyImageLayout(image);
    if (!raw || NON_ARCHIVE_SOURCE_RE.test(raw)) {
      image.setAttribute(DIFF_ASSET_ATTRIBUTE, raw);
      return;
    }
    image.removeAttribute('src');
    const archivePath = plainMarkdown
      ? resolveLinkedPath(raw)
      : resolveArchivePath(source.path ?? '', raw);
    const bytes = archivePath ? await source.readBytes(archivePath).catch(() => null) : null;
    image.setAttribute(DIFF_ASSET_ATTRIBUTE, `${archivePath ?? raw}@${archivePath ? source.hashOf(archivePath) ?? '' : ''}`);
    if (bytes) {
      image.src = source.createUrl(bytes, imageMimeType(archivePath ?? raw));
    } else {
      image.classList.add('mdzip-diff-image-missing');
      image.title = plainMarkdown
        ? `Image not available: ${raw}`
        : `Not in this version of the archive: ${raw}`;
    }
  }));
  return template.content;
}

/**
 * Marks the top-level blocks that only one side has: `mdzip-diff-block-removed`
 * on the before side, `mdzip-diff-block-added` on the after side. A changed
 * paragraph shows as both. Returns the pairs of blocks that match, in order,
 * for {@link syncScroll}.
 */
export function markBlockChanges(before: Element, after: Element): Array<[HTMLElement, HTMLElement]> {
  const a = Array.from(before.children) as HTMLElement[];
  const b = Array.from(after.children) as HTMLElement[];
  const keysA = a.map(blockKey);
  const keysB = b.map(blockKey);
  const pairs: Array<[HTMLElement, HTMLElement]> = [];

  let start = 0;
  while (start < a.length && start < b.length && keysA[start] === keysB[start]) {
    pairs.push([a[start], b[start]]);
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  const tail: Array<[HTMLElement, HTMLElement]> = [];
  while (endA > start && endB > start && keysA[endA - 1] === keysB[endB - 1]) {
    endA -= 1;
    endB -= 1;
    tail.unshift([a[endA], b[endB]]);
  }

  const matchedA = new Set<number>();
  const matchedB = new Set<number>();
  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0 && n * m <= MAX_MATCH_CELLS) {
    // Longest common subsequence over the differing middle.
    const lengths: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        lengths[i][j] = keysA[start + i] === keysB[start + j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (keysA[start + i] === keysB[start + j]) {
        matchedA.add(start + i);
        matchedB.add(start + j);
        pairs.push([a[start + i], b[start + j]]);
        i += 1;
        j += 1;
      } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
        i += 1;
      } else {
        j += 1;
      }
    }
  }
  for (let index = start; index < endA; index += 1) {
    if (!matchedA.has(index)) a[index].classList.add('mdzip-diff-block-removed');
  }
  for (let index = start; index < endB; index += 1) {
    if (!matchedB.has(index)) b[index].classList.add('mdzip-diff-block-added');
  }
  pairs.push(...tail);
  markModifiedBlocks(a, b, pairs);
  return pairs;
}

/** Below this share of common words, two changed blocks count as a removal and an addition. */
const MIN_BLOCK_SIMILARITY = 0.3;
/** Above this many token pairs, a block keeps its whole-block marking. */
const MAX_WORD_MATCH_CELLS = 400_000;

/**
 * Between each pair of matched blocks, pairs the removed and added blocks
 * that are edits of each other (same element, similar words), in order, and
 * marks just the words that changed. The pair gets `mdzip-diff-block-modified`
 * so its whole-block tint can stay light.
 */
function markModifiedBlocks(
  a: HTMLElement[],
  b: HTMLElement[],
  pairs: ReadonlyArray<readonly [HTMLElement, HTMLElement]>
): void {
  const indexA = new Map(a.map((element, index) => [element, index]));
  const indexB = new Map(b.map((element, index) => [element, index]));
  const anchors = pairs
    .map(([left, right]) => [indexA.get(left) ?? -1, indexB.get(right) ?? -1] as const)
    .sort((x, y) => x[0] - y[0]);
  let previousA = -1;
  let previousB = -1;
  for (const [nextA, nextB] of [...anchors, [a.length, b.length] as const]) {
    const removed = a.slice(previousA + 1, nextA).filter((el) => el.classList.contains('mdzip-diff-block-removed'));
    const added = b.slice(previousB + 1, nextB).filter((el) => el.classList.contains('mdzip-diff-block-added'));
    let j = 0;
    for (const left of removed) {
      for (let k = j; k < added.length; k += 1) {
        const right = added[k];
        if (left.tagName === right.tagName && blockSimilarity(left, right) >= MIN_BLOCK_SIMILARITY) {
          if (CONTAINER_TAGS.has(left.tagName) && markContainerChanges(left, right)) {
            // Its items carry the marks; the list or quote itself is just their container.
          } else if (markWordChanges(left, right)) {
            left.classList.add('mdzip-diff-block-modified');
            right.classList.add('mdzip-diff-block-modified');
          }
          j = k + 1;
          break;
        }
      }
    }
    previousA = nextA;
    previousB = nextB;
  }
}

/** Blocks whose children are compared one by one when they're edited: list items, quoted paragraphs. */
const CONTAINER_TAGS = new Set(['UL', 'OL', 'BLOCKQUOTE']);

/**
 * An edited list or quote: matches its items the way the top-level blocks
 * are matched, so only the items that changed are marked, not the whole
 * list. The pair gets `mdzip-diff-block-container` in place of its own
 * added/removed marks. False (nothing changed) when the items all match,
 * e.g. only the list's numbering changed; the caller then marks it whole.
 */
function markContainerChanges(left: HTMLElement, right: HTMLElement): boolean {
  if (left.children.length === 0 || right.children.length === 0) return false;
  markBlockChanges(left, right);
  const marked = (element: HTMLElement) =>
    element.querySelector(':scope > .mdzip-diff-block-added, :scope > .mdzip-diff-block-removed') !== null;
  if (!marked(left) && !marked(right)) return false;
  left.classList.replace('mdzip-diff-block-removed', 'mdzip-diff-block-container');
  right.classList.replace('mdzip-diff-block-added', 'mdzip-diff-block-container');
  return true;
}

/** A word: letters and digits, kept whole across inner `.`, `-` and `'` (`2.4.2`, `awaiting-test`, `don't`). */
const WORD_RE = /[\p{L}\p{N}_]+(?:[.\-'’][\p{L}\p{N}_]+)*/gu;
/** Whitespace runs, words, and single other characters. */
const TOKEN_RE = /\s+|[\p{L}\p{N}_]+(?:[.\-'’][\p{L}\p{N}_]+)*|[^\s\p{L}\p{N}_]/gu;

function wordsOf(element: Element): string[] {
  return (element.textContent ?? '').match(WORD_RE) ?? [];
}

/** Dice coefficient over the two blocks' words. */
function blockSimilarity(left: Element, right: Element): number {
  const wordsA = wordsOf(left);
  const wordsB = wordsOf(right);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const word of wordsA) counts.set(word, (counts.get(word) ?? 0) + 1);
  let common = 0;
  for (const word of wordsB) {
    const count = counts.get(word) ?? 0;
    if (count > 0) {
      common += 1;
      counts.set(word, count - 1);
    }
  }
  return (2 * common) / (wordsA.length + wordsB.length);
}

interface WordToken {
  text: string;
  node: Text;
  start: number;
  end: number;
  space: boolean;
}

/** Words, single punctuation marks and whitespace runs, with the text node each sits in. */
function tokenize(element: Element): WordToken[] {
  const tokens: WordToken[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    for (const match of node.data.matchAll(TOKEN_RE)) {
      const start = match.index ?? 0;
      tokens.push({ text: match[0], node, start, end: start + match[0].length, space: /^\s+$/.test(match[0]) });
    }
  }
  return tokens;
}

/**
 * Wraps the words only one block has in `mdzip-diff-word-removed` /
 * `mdzip-diff-word-added`. Returns false (and changes nothing) when there's
 * nothing word-level to show, such as a changed image or link target, or
 * when the blocks are too large to compare.
 */
function markWordChanges(left: Element, right: Element): boolean {
  const tokensA = tokenize(left);
  const tokensB = tokenize(right);
  const wordsA = tokensA.filter((token) => !token.space);
  const wordsB = tokensB.filter((token) => !token.space);
  const n = wordsA.length;
  const m = wordsB.length;
  if (n === 0 || m === 0 || n * m > MAX_WORD_MATCH_CELLS) return false;

  const lengths: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lengths[i][j] = wordsA[i].text === wordsB[j].text
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const keptA = new Set<WordToken>();
  const keptB = new Set<WordToken>();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (wordsA[i].text === wordsB[j].text) {
      keptA.add(wordsA[i]);
      keptB.add(wordsB[j]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  if (keptA.size === n && keptB.size === m) return false;
  wrapChangedTokens(tokensA, keptA, 'mdzip-diff-word-removed');
  wrapChangedTokens(tokensB, keptB, 'mdzip-diff-word-added');
  return true;
}

function wrapChangedTokens(tokens: WordToken[], kept: Set<WordToken>, className: string): void {
  // A changed word is marked; so is the space between two changed words, so a
  // changed phrase reads as one run.
  const marked = tokens.map((token) => !token.space && !kept.has(token));
  for (let index = 0; index < tokens.length; index += 1) {
    if (!tokens[index].space) continue;
    let before = index - 1;
    while (before >= 0 && tokens[before].space) before -= 1;
    let after = index + 1;
    while (after < tokens.length && tokens[after].space) after += 1;
    marked[index] = before >= 0 && after < tokens.length && marked[before] && marked[after];
  }

  // Runs of marked tokens within one text node, wrapped from the end of the
  // node back so earlier offsets stay valid.
  const runs: Array<{ node: Text; start: number; end: number }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!marked[index]) continue;
    const token = tokens[index];
    const last = runs[runs.length - 1];
    if (last && last.node === token.node && last.end === token.start && marked[index - 1]) {
      last.end = token.end;
    } else {
      runs.push({ node: token.node, start: token.start, end: token.end });
    }
  }
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const { node, start, end } = runs[index];
    const doc = node.ownerDocument;
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const span = doc.createElement('span');
    span.className = className;
    range.surroundContents(span);
  }
}

/**
 * Keeps two scrolling panes in step: the matched block at the top of the
 * pane being scrolled is lined up with its partner in the other pane, so
 * blocks added on one side don't push the two out of line. Returns a function
 * that removes the listeners.
 */
export function syncScroll(
  left: HTMLElement,
  right: HTMLElement,
  pairs: ReadonlyArray<readonly [HTMLElement, HTMLElement]>
): () => void {
  let driving: HTMLElement | null = null;
  let release = 0;
  const view = left.ownerDocument.defaultView;
  const offsetIn = (pane: HTMLElement, element: HTMLElement): number =>
    element.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;

  const follow = (source: HTMLElement, target: HTMLElement, sourceIndex: 0 | 1): void => {
    if (driving && driving !== source) return;
    driving = source;
    if (release) view?.clearTimeout(release);
    release = view?.setTimeout(() => { driving = null; }, 80) ?? 0;

    const targetIndex = sourceIndex === 0 ? 1 : 0;
    let anchor: readonly [HTMLElement, HTMLElement] | undefined;
    for (const pair of pairs) {
      if (offsetIn(source, pair[sourceIndex]) <= source.scrollTop + 1) anchor = pair;
      else break;
    }
    const maxTarget = target.scrollHeight - target.clientHeight;
    let next: number;
    if (anchor) {
      next = offsetIn(target, anchor[targetIndex]) + (source.scrollTop - offsetIn(source, anchor[sourceIndex]));
    } else {
      const maxSource = source.scrollHeight - source.clientHeight;
      next = maxSource > 0 ? (source.scrollTop / maxSource) * maxTarget : 0;
    }
    if (source.scrollTop >= source.scrollHeight - source.clientHeight - 1) next = maxTarget;
    target.scrollTop = Math.max(0, Math.min(maxTarget, next));
  };

  const onLeft = (): void => follow(left, right, 0);
  const onRight = (): void => follow(right, left, 1);
  left.addEventListener('scroll', onLeft, { passive: true });
  right.addEventListener('scroll', onRight, { passive: true });
  return () => {
    left.removeEventListener('scroll', onLeft);
    right.removeEventListener('scroll', onRight);
    if (release) view?.clearTimeout(release);
  };
}

/** Resolves an image source against the document's folder; null if it leaves the archive. */
export function resolveArchivePath(documentPath: string, source: string): string | null {
  let clean = source.replace(/^<|>$/g, '').split(/[?#]/)[0] ?? '';
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // Keep the raw text when the escapes are malformed.
  }
  const base = clean.startsWith('/') ? [] : documentPath.split('/').slice(0, -1);
  const parts = [...base];
  for (const part of clean.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length ? parts.join('/') : null;
}

/**
 * Normalizes an image source in a plain `.md` document, relative to the
 * document's own folder. Unlike {@link resolveArchivePath} it may leave that
 * folder: leading `../` segments are kept, and a root-relative source keeps
 * its leading `/`, so the host can resolve it against its own root.
 * Returns null for an empty source.
 */
export function resolveLinkedPath(source: string): string | null {
  let clean = source.replace(/^<|>$/g, '').split(/[?#]/)[0] ?? '';
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // Keep the raw text when the escapes are malformed.
  }
  const rooted = clean.startsWith('/');
  const parts: string[] = [];
  for (const part of clean.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') {
      parts.pop();
    } else if (part === '..' && rooted) {
      continue;
    } else {
      parts.push(part);
    }
  }
  if (parts.length === 0) return null;
  return `${rooted ? '/' : ''}${parts.join('/')}`;
}

function blockKey(element: Element): string {
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  const assets = Array.from(element.querySelectorAll(`[${DIFF_ASSET_ATTRIBUTE}]`))
    .map((image) => image.getAttribute(DIFF_ASSET_ATTRIBUTE));
  if (element.hasAttribute(DIFF_ASSET_ATTRIBUTE)) assets.unshift(element.getAttribute(DIFF_ASSET_ATTRIBUTE));
  const links = Array.from(element.querySelectorAll('a[href]')).map((link) => link.getAttribute('href'));
  return `${element.tagName}\u0000${text}\u0000${assets.join('\u0001')}\u0000${links.join('\u0001')}`;
}

// The preview's handling of raw HTML image attributes: `align` wraps the
// image (the editor writes `<img align="right">`), and numeric width/height
// win over the preview's responsive `height: auto`.
function applyImageLayout(image: HTMLImageElement): void {
  const align = image.getAttribute('align')?.toLowerCase();
  if (align === 'left' || image.classList.contains('mdzip-image-wrap-left')) image.classList.add('mdzip-image-left');
  if (align === 'right' || image.classList.contains('mdzip-image-wrap-right')) image.classList.add('mdzip-image-right');
  const width = image.getAttribute('width');
  if (width && /^\d+$/.test(width) && !image.style.width) image.style.width = `${width}px`;
  const height = image.getAttribute('height');
  if (height && /^\d+$/.test(height) && !image.style.height) image.style.height = `${height}px`;
}

function imageMimeType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'avif') return 'image/avif';
  if (extension === 'bmp') return 'image/bmp';
  return 'image/png';
}
