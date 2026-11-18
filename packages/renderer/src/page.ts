// .mdz to a static page: the entry-point document as HTML, plus the pictures
// it uses, ready to save beside the page. Runs in Node and in the browser.
import { MdzArchiveCore, type MdzManifest } from '@mdzip/core-js';
import {
  hasMdzipDom,
  renderMdzipMarkdown,
  useMdzipDomWindow,
  type MdzipMarkdownOptions
} from './markdown.js';
import { sha256Hex } from './sha256.js';

export interface MdzipPageAsset {
  /** Where the picture is in the archive, e.g. `images/logo.png`. */
  archivePath: string;
  /** Content-hashed file name, e.g. `a1b2c3d4e5f6.png`. The same bytes always get the same name. */
  fileName: string;
  /** Where to save it, relative to the page: `<assetDir>/<fileName>`. */
  path: string;
  /** The address the page's HTML uses for it: `path`, unless `assetUrl` or `withAssetUrls()` changed it. */
  url: string;
  bytes: Uint8Array;
}

export interface MdzipPage {
  /** The manifest's `title`, or `null`. */
  title: string | null;
  /** The manifest's `description`, or `null`. */
  description: string | null;
  manifest: MdzManifest | null;
  /** The archive path of the rendered document. */
  entryPoint: string;
  /** The document's HTML: the page body, without `<html>`, `<head>` or a style sheet. */
  html: string;
  /** The pictures the HTML uses. Save each one's `bytes` at its `path` beside the page. Empty with `inlineImages`. */
  assets: MdzipPageAsset[];
  /**
   * The same page with other addresses for its pictures, for hosts that only
   * know a picture's address after uploading it (CMS media libraries, some
   * CDNs). `urls` maps an asset's `archivePath` or `fileName` to its address,
   * or is a function of the asset. Pictures it has no address for keep theirs.
   */
  withAssetUrls(urls: Record<string, string> | ((asset: MdzipPageAsset) => string | undefined)): MdzipPage;
}

export interface MdzipPageOptions extends Omit<MdzipMarkdownOptions, 'sanitizeContributions'> {
  /** Folder the pictures go in, relative to the page. Default `assets/page-images`. */
  assetDir?: string;
  /**
   * The address the HTML uses for a picture stored somewhere other than its
   * `path`. Gets the content-hashed file name and the asset.
   */
  assetUrl?: (fileName: string, asset: Omit<MdzipPageAsset, 'url'>) => string;
  /**
   * Put the pictures in the HTML as `data:` URIs, for a single self-contained
   * page; `assets` is then empty. Binary pictures are base64-encoded; SVGs
   * are percent-encoded (`data:image/svg+xml,…`), which is usually smaller.
   */
  inlineImages?: boolean;
  /**
   * Put SVG pictures that contain links into the page itself, so the links
   * can be clicked (an SVG shown with `<img>` is a flat picture). Default `true`.
   * See the README for how they're isolated and when one isn't inlined.
   */
  inlineLinkedSvg?: boolean;
  /** Reports problems that don't stop the render, such as an SVG with links that couldn't be inlined. */
  onWarning?: (message: string) => void;
}

const EXTERNAL_REF = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
// A <source> with a srcset of one image (no commas or size descriptors).
const SOURCE_SRCSET = /<source[^>]*\ssrcset="([^"\s,]+)"/gi;

// Fenced blocks, inline code spans, and raw <code> elements — image
// "references" inside these are documentation examples, not references.
// Both ref collection and ref rewriting must leave them untouched.
const CODE_SEGMENT = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|<code[\s>][\s\S]*?<\/code>)/g;

/** Applies `transform` to the markdown outside code fences / inline code. */
function transformOutsideCode(markdown: string, transform: (segment: string) => string): string {
  return markdown
    .split(CODE_SEGMENT)
    .map((segment, index) => (index % 2 === 0 ? transform(segment) : segment))
    .join('');
}

/**
 * The local (relative) pictures a Markdown document refers to: Markdown
 * images, raw-HTML `<img>` tags and the `<source>` tags of a `<picture>`
 * (a srcset of one image, no size list). References inside code are ignored.
 * Sorted, without duplicates.
 */
export function collectLocalImageRefs(markdown: string): string[] {
  const refs = new Set<string>();
  transformOutsideCode(markdown, (segment) => {
    for (const match of segment.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
      refs.add(match[1]!);
    }
    for (const match of segment.matchAll(/<img[^>]*\ssrc="([^"]+)"/gi)) {
      refs.add(match[1]!);
    }
    for (const match of segment.matchAll(SOURCE_SRCSET)) {
      refs.add(match[1]!);
    }
    return segment;
  });
  return [...refs].filter((ref) => !EXTERNAL_REF.test(ref)).sort();
}

// --- SVG diagrams with links ------------------------------------------------
// An SVG shown with <img> is a flat picture: its links can't be clicked. An
// archive SVG that contains links (a draw.io diagram saved as .drawio.svg, for
// example) is put into the page instead, inside a declarative shadow root
// (<template shadowrootmode="open">) so its styles and ids can't affect the
// page or another SVG. Browsers attach it from the HTML alone, no script
// needed. The original <img> stays next to it as the fallback that browsers
// without declarative shadow DOM, and crawlers, see.
//
// It goes in after the page is sanitized, so it is checked here instead: an
// SVG with anything script-like, or that loads from outside itself, isn't
// inlined. It stays an <img>, which can't run or load anything, and the
// caller gets a warning.

const SVG_LINK = /<a[\s>]/i;
const SVG_UNSAFE = /<script[\s>]|\son[a-z]+\s*=|javascript:|<foreignObject[\s\S]*?<(?:iframe|object|embed|img)[\s>]|@import|url\(\s*['"]?(?:https?:)?\/\//i;
const SVG_OUTSIDE_EMBED = /<(?:image|use|feImage)\b[^>]*?\s(?:xlink:)?href\s*=\s*["'](?!#|data:image\/)/i;
const INLINE_SVG_CSS = ':host{display:inline-block;max-width:100%;line-height:0;vertical-align:middle}'
  + 'svg{display:block;max-width:100%;height:auto}a{cursor:pointer}';

/**
 * Why an SVG with links can't be put into a page, or `null` when it can.
 */
export function inlineSvgProblem(svgText: string): string | null {
  if (SVG_UNSAFE.test(svgText)) return 'it contains a script, an event handler, a javascript: link or an outside resource';
  if (SVG_OUTSIDE_EMBED.test(svgText)) return 'it loads an image or element from outside itself';
  return null;
}

/** The SVG markup to inline: no XML prolog, doctype or comments, and no draw.io `content` (its editable source). */
function inlineSvgMarkup(svgText: string): string {
  return svgText
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<svg\b[^>]*?)\scontent="[^"]*"/i, '$1')
    .trim();
}

const attr = (tag: string, name: string): string | null =>
  new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ?? null;

/** The inline SVG plus the `<img>` as fallback, or the `<img>` unchanged if its src isn't in `inlineByUrl`. */
function inlineImg(tag: string, inlineByUrl: Map<string, string>): string {
  const src = attr(tag, 'src');
  const markup = src ? inlineByUrl.get(src) : undefined;
  if (!markup) return tag;
  const alt = attr(tag, 'alt');
  const width = attr(tag, 'width');
  const align = attr(tag, 'align');
  const classes = ['mdz-inline-svg', ...(align && /^(left|right|center)$/i.test(align) ? [`mdz-inline-svg-${align.toLowerCase()}`] : [])];
  const style = width ? ` style="width:${/^\d+(\.\d+)?$/.test(width) ? `${width}px` : width}"` : '';
  const label = alt ? ` aria-label="${alt}"` : '';
  const css = INLINE_SVG_CSS + (width ? 'svg{width:100%}' : '');
  return `<span class="${classes.join(' ')}" role="group"${label}${style}>`
    + `<template shadowrootmode="open"><style>${css}</style>${markup}</template>${tag}</span>`;
}

// A <picture> with a linked SVG among its images can't stay a <picture>:
// the browser would only ever show its <img>. Each of its images becomes an
// option (inlined when it has links), and a small style sheet shows the one
// the <picture> would have picked: the first <source> whose media query
// matches, or else the <img>. Later rules win, so the sources' rules go in
// reverse order, and the first source's rule comes last.
function inlinePicture(block: string, inlineByUrl: Map<string, string>, id: string): string {
  const img = /<img\b[^>]*>/i.exec(block)?.[0];
  if (!img) return block;
  const sources = [...block.matchAll(/<source\b[^>]*>/gi)].map(([tag]) => ({
    src: attr(tag, 'srcset'), media: attr(tag, 'media'), width: attr(tag, 'width'), height: attr(tag, 'height')
  })).filter((s): s is typeof s & { src: string } => !!s.src && !/[\s,]/.test(s.src));
  if (![...sources.map((s) => s.src), attr(img, 'src')].some((src) => src !== null && inlineByUrl.has(src))) return block;
  const alt = attr(img, 'alt');
  const optional = (name: string, value: string | null) => (value === null ? '' : ` ${name}="${value}"`);
  const options = [
    ...sources.map((s) => `<img src="${s.src}"${optional('alt', alt)}${optional('width', s.width)}${optional('height', s.height)}>`),
    img
  ].map((tag, i) => `<span class="mdz-picture-option" data-option="${i}">${inlineImg(tag, inlineByUrl)}</span>`);
  const show = (i: number) => `#${id}>[data-option]{display:none}#${id}>[data-option="${i}"]{display:inline}`;
  const css = show(sources.length) + sources.map((s, i) => (s.media ? `@media ${s.media}{${show(i)}}` : show(i))).reverse().join('');
  return `<span class="mdz-picture" id="${id}"><style>${css}</style>${options.join('')}</span>`;
}

/**
 * Replaces each `<img>` whose src is in `inlineByUrl` with the inline SVG
 * plus the `<img>` as fallback, and each `<picture>` holding one with its
 * options (see inlinePicture).
 */
function inlineLinkedSvgs(html: string, inlineByUrl: Map<string, string>): string {
  if (!inlineByUrl.size) return html;
  let pictures = 0;
  return html.replace(/<picture\b[\s\S]*?<\/picture>|<img\b[^>]*>/gi, (match) => (/^<picture/i.test(match)
    ? inlinePicture(match, inlineByUrl, `mdz-picture-${++pictures}`)
    : inlineImg(match, inlineByUrl)));
}

// --- Page -------------------------------------------------------------------

/** Loads jsdom for the sanitizer when there's no DOM (Node). */
async function ensureDom(): Promise<void> {
  if (hasMdzipDom()) return;
  // A variable specifier, so bundlers building for the browser don't try to
  // resolve jsdom (browsers never get here).
  const specifier = 'jsdom';
  let jsdom: { JSDOM: new (html?: string) => { window: unknown } };
  try {
    jsdom = await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier);
  } catch {
    throw new Error(
      'renderMdzPage() sanitizes the page, which in Node needs jsdom: install it (npm install jsdom), '
      + 'call useMdzipDomWindow() with another DOM window, or pass sanitize: false for archives you trust.'
    );
  }
  useMdzipDomWindow(new jsdom.JSDOM('').window);
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/** An SVG as a `data:` URI, percent-encoding only what has to be. */
function svgDataUri(svgText: string): string {
  return `data:image/svg+xml,${svgText.replace(/[\r\n\t%#()<>?[\\\]^`{|}"]|[^\x20-\x7E]/gu, encodeURIComponent)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Renders an `.mdz` archive's entry-point document as a static page. See
 * {@link MdzipPage} for the result and {@link MdzipPageOptions} for the options.
 *
 * ```js
 * const page = await renderMdzPage(bytes);
 * await writeFile('index.html', `<!doctype html><title>${page.title}</title>${page.html}`);
 * for (const asset of page.assets) await writeFile(asset.path, asset.bytes);
 * ```
 *
 * The page is sanitized with the same policy as the MDZip editor's preview;
 * in Node that needs jsdom (an optional peer dependency), or pass
 * `sanitize: false` for archives you trust.
 */
export async function renderMdzPage(source: Uint8Array | ArrayBuffer, options: MdzipPageOptions = {}): Promise<MdzipPage> {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (options.sanitize !== false) {
    await ensureDom();
  }
  const assetDir = (options.assetDir ?? 'assets/page-images').replace(/\/+$/, '');

  const archive = await MdzArchiveCore.open(bytes);
  const manifest = await archive.readManifest().catch(() => null);
  const entryPoint = await archive.resolveEntryPoint();
  const markdown = await archive.readText(entryPoint);

  // Pictures are rendered with a placeholder address each, swapped for the
  // real one at the end, so withAssetUrls() can swap in others later.
  const marker = `mdzip-asset-${Math.random().toString(36).slice(2, 10)}-`;
  const placeholderByRef = new Map<string, string>();
  const placeholderByPath = new Map<string, string>();
  const inlineByPlaceholder = new Map<string, string>();
  const assets: Array<Omit<MdzipPageAsset, 'url'> & { placeholder: string; dataUri?: string }> = [];
  for (const ref of collectLocalImageRefs(markdown)) {
    const resolved = MdzArchiveCore.resolvePath(entryPoint, ref);
    if (!archive.hasEntry(resolved)) continue;
    const known = placeholderByPath.get(resolved);
    if (known) {
      placeholderByRef.set(ref, known);
      continue;
    }
    const data = await archive.readBytes(resolved);
    const ext = extensionOf(resolved);
    const fileName = `${(await sha256Hex(data)).slice(0, 12)}${ext}`;
    const placeholder = `${marker}${assets.length}${ext}`;
    placeholderByRef.set(ref, placeholder);
    placeholderByPath.set(resolved, placeholder);
    const isSvg = ext === '.svg';
    const svgText = isSvg ? new TextDecoder().decode(data) : null;
    let dataUri: string | undefined;
    if (options.inlineImages) {
      dataUri = svgText !== null ? svgDataUri(svgText) : await archive.readDataUri(resolved);
    }
    assets.push({ archivePath: resolved, fileName, path: `${assetDir}/${fileName}`, bytes: data, placeholder, dataUri });
    if (svgText !== null && options.inlineLinkedSvg !== false && SVG_LINK.test(svgText)) {
      const problem = inlineSvgProblem(svgText);
      if (problem) options.onWarning?.(`${resolved}: has links but isn't inlined, so they won't work: ${problem}`);
      else inlineByPlaceholder.set(placeholder, inlineSvgMarkup(svgText));
    }
  }

  const rewritten = transformOutsideCode(markdown, (segment) => segment
    .replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (match, open: string, ref: string) =>
      placeholderByRef.has(ref) ? `${open}${placeholderByRef.get(ref)}` : match)
    .replace(/(<img[^>]*\ssrc=")([^"]+)(")/gi, (match, open: string, ref: string, close: string) =>
      placeholderByRef.has(ref) ? `${open}${placeholderByRef.get(ref)}${close}` : match)
    .replace(/(<source[^>]*\ssrcset=")([^"\s,]+)(")/gi, (match, open: string, ref: string, close: string) =>
      placeholderByRef.has(ref) ? `${open}${placeholderByRef.get(ref)}${close}` : match));

  const template = inlineLinkedSvgs(renderMdzipMarkdown(rewritten, {
    sanitize: options.sanitize,
    headingIdPrefix: options.headingIdPrefix,
    externalLinks: options.externalLinks,
    resolveLink: options.resolveLink
  }), inlineByPlaceholder);
  const placeholderPattern = new RegExp(`${escapeRegExp(marker)}(\\d+)(?:\\.[a-z0-9]+)?`, 'gi');

  const build = (urlFor: (asset: Omit<MdzipPageAsset, 'url'>, index: number) => string): MdzipPage => {
    const pageAssets: MdzipPageAsset[] = assets.map(({ placeholder: _placeholder, dataUri: _dataUri, ...asset }, index) =>
      ({ ...asset, url: urlFor(asset, index) }));
    const html = template.replace(placeholderPattern, (match, index: string) =>
      escapeAttribute(pageAssets[Number(index)]?.url ?? match));
    return {
      title: manifest?.title ?? null,
      description: manifest?.description ?? null,
      manifest,
      entryPoint,
      html,
      assets: options.inlineImages ? [] : pageAssets,
      withAssetUrls(urls) {
        const lookup = typeof urls === 'function'
          ? urls
          : (asset: MdzipPageAsset) => urls[asset.archivePath] ?? urls[asset.fileName];
        return build((asset, index) => lookup(pageAssets[index]!) ?? pageAssets[index]!.url);
      }
    };
  };

  return build((asset, index) => assets[index]!.dataUri
    ?? (options.assetUrl ? options.assetUrl(asset.fileName, asset) : asset.path));
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
