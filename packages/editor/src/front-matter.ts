import { load as loadYaml } from 'js-yaml';

/** Parsed leading `---`-delimited YAML front matter block. */
export interface MdzipFrontMatter {
  /** Parsed key/value pairs from the block. */
  data: Record<string, unknown>;
  /** Markdown text following the closing `---` (front matter stripped). */
  body: string;
  /** The block's YAML source, without the `---` delimiters. */
  raw: string;
}

// The opening fence only counts at the very start of the document — no
// leading blank lines or BOM — matching Jekyll/Hugo/Pandoc convention. `^`
// without the `m` flag anchors to true string start, so a BOM or leading
// blank line already disqualifies the match.
const OPEN_FENCE_PATTERN = /^---\r?\n/;
// Searched against the text *after* the opening fence, so `^` here means
// "the closing fence is the very next line" (the empty-front-matter case) —
// the `\r?\n` branch covers a closing fence after one or more content lines.
const CLOSE_FENCE_PATTERN = /(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/;

/**
 * Parses a leading YAML front matter block from markdown text. Returns
 * `null` when there is no block at position 0, or when the block's YAML
 * fails to parse or does not resolve to a plain key/value map (e.g. a bare
 * scalar or list) — either way the markdown is left untouched for the
 * caller to render as-is.
 */
export function parseFrontMatter(markdown: string): MdzipFrontMatter | null {
  const openMatch = OPEN_FENCE_PATTERN.exec(markdown);
  if (!openMatch) {
    return null;
  }
  const rest = markdown.slice(openMatch[0].length);
  const closeMatch = CLOSE_FENCE_PATTERN.exec(rest);
  if (!closeMatch) {
    return null;
  }
  const raw = rest.slice(0, closeMatch.index);
  let data: unknown;
  try {
    data = loadYaml(raw);
  } catch {
    return null;
  }
  if (data === null || data === undefined) {
    data = {};
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  return {
    data: data as Record<string, unknown>,
    body: rest.slice(closeMatch.index + closeMatch[0].length),
    raw
  };
}
