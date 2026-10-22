import DOMPurify from 'dompurify';

// Inline SVG for the preview: an archive SVG that contains links is shown as
// its own markup (in a shadow root) instead of an <img>, because an SVG loaded
// as an image is a flat picture whose links can't be clicked. Everything here
// keeps that markup as safe as the <img> it replaces:
//
// - no scripts, event handlers or javascript: links (DOMPurify);
// - nothing loaded from outside the archive: on every element but <a>, an
//   href may only point inside the SVG (#id) or be a data: image, and CSS
//   url() and @import are removed — an <img> SVG can't fetch anything either,
//   and spec §9.6 keeps embeds inside the archive by default;
// - links are plain `href` (xlink:href is rewritten), so the preview's link
//   handling and external-link policy see them like any other link.
//
// Styles and ids stay inside the shadow root, so they can't restyle the page
// or collide with another SVG.
//
// draw.io draws its labels as HTML inside <foreignObject>, which DOMPurify 3.4
// removes by default to prevent mutation XSS (markup that changes meaning when
// serialized and parsed again). It's allowed here because the result is never
// re-parsed: the sanitizer returns DOM nodes, which go straight into the
// shadow root.

const XLINK_NS = 'http://www.w3.org/1999/xlink';
const SAFE_EMBED_HREF = /^(?:#|data:image\/)/i;
const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const CSS_IMPORT = /@import\b[^;]*;?/gi;

let purifier: ReturnType<typeof DOMPurify> | null = null;

function svgPurifier(): ReturnType<typeof DOMPurify> {
  if (purifier) return purifier;
  const globalWindow = (globalThis as { window?: Window & typeof globalThis }).window;
  if (!globalWindow) {
    throw new Error('Inline SVG needs a DOM window.');
  }
  // A separate instance: hooks registered here never touch the preview's main sanitizer.
  purifier = DOMPurify(globalWindow);
  purifier.addHook('afterSanitizeAttributes', (node) => {
    const element = node as Element;
    if (typeof element.getAttribute !== 'function') return;
    const isLink = element.localName === 'a';
    const xlinkHref = element.getAttributeNS(XLINK_NS, 'href') ?? element.getAttribute('xlink:href');
    if (xlinkHref !== null) {
      element.removeAttributeNS(XLINK_NS, 'href');
      element.removeAttribute('xlink:href');
      if (!element.hasAttribute('href')) element.setAttribute('href', xlinkHref);
    }
    const href = element.getAttribute('href');
    if (href !== null && !isLink && !SAFE_EMBED_HREF.test(href.trim())) {
      element.removeAttribute('href');
    }
    // HTML inside <foreignObject> can load things too (<img src>, srcset, …).
    for (const name of ['src', 'srcset', 'poster', 'background', 'data']) {
      const value = element.getAttribute(name);
      if (value !== null && !(name === 'src' && /^data:image\//i.test(value.trim()))) {
        element.removeAttribute(name);
      }
    }
    const style = element.getAttribute('style');
    if (style !== null) element.setAttribute('style', cleanCss(style));
    // draw.io keeps the whole editable diagram in the root's `content`: not needed in the page.
    if (element.localName === 'svg') element.removeAttribute('content');
  });
  purifier.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'style' && node.textContent) {
      node.textContent = cleanCss(node.textContent);
    }
  });
  return purifier;
}

function cleanCss(css: string): string {
  return css
    .replace(CSS_IMPORT, '')
    .replace(CSS_URL, (match, _quote: string, url: string) => (SAFE_EMBED_HREF.test(url.trim()) ? match : 'none'));
}

/** True when SVG text contains a hyperlink, the only case the preview inlines. */
export function svgHasLinks(svgText: string): boolean {
  return /<a[\s>]/i.test(svgText);
}

/**
 * The cleaned `<svg>` element, owned by the page's document and ready to
 * append to a shadow root (clone it for each use), or null when the text
 * isn't a usable SVG. Never serialize it and parse it again (see above).
 */
export function sanitizeInlineSvg(svgText: string): SVGSVGElement | null {
  const fragment = svgPurifier().sanitize(svgText, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject', 'switch'],
    ADD_ATTR: ['target', 'requiredFeatures', 'pointer-events'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'base', 'link', 'meta', 'audio', 'video', 'source', 'track'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    RETURN_DOM_FRAGMENT: true
  });
  const root = Array.from(fragment.childNodes).find((node): node is Element => node.nodeType === 1);
  return root && root.localName === 'svg' && root.namespaceURI === 'http://www.w3.org/2000/svg'
    ? root as unknown as SVGSVGElement
    : null;
}

/** Styles inside each inline SVG's shadow root. */
export const INLINE_SVG_SHADOW_CSS = ':host{display:inline-block;max-width:100%;line-height:0;vertical-align:middle}'
  + 'svg{display:block;max-width:100%;height:auto}a{cursor:pointer}';
