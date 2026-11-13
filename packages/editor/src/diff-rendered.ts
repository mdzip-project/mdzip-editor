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
  const html = await renderingService.renderMarkdown(source.markdown, {
    currentPath: source.path ?? '',
    sourceFormat: 'mdz',
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
    const archivePath = resolveArchivePath(source.path ?? '', raw);
    const bytes = archivePath ? await source.readBytes(archivePath).catch(() => null) : null;
    image.setAttribute(DIFF_ASSET_ATTRIBUTE, `${archivePath ?? raw}@${archivePath ? source.hashOf(archivePath) ?? '' : ''}`);
    if (bytes) {
      image.src = source.createUrl(bytes, imageMimeType(archivePath ?? raw));
    } else {
      image.classList.add('mdzip-diff-image-missing');
      image.title = `Not in this version of the archive: ${raw}`;
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
  return pairs;
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
