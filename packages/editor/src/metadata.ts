/** Extract the first ATX heading, for example `# Title`, from markdown text. */
export function firstMarkdownHeading(markdown: string): string | undefined {
  const match = markdown.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
  return match?.[1]?.trim();
}

/** Derive the file base name, without extension, from a path string. */
export function fileBaseNameFromPath(path: string): string {
  const slashIndex = path.lastIndexOf('/');
  const fileName = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
  return fileName.replace(/\.[^.]+$/, '') || 'document';
}

/** Resolve a stable title fallback from markdown heading or filename. */
export function suggestedTitleFromMarkdown(markdown: string, fileBaseName: string): string {
  return firstMarkdownHeading(markdown) || fileBaseName;
}

/** Resolve display title from manifest title with filename fallback. */
export function displayTitleFromManifest(
  manifestTitle: string | undefined,
  fileBaseName: string
): string {
  const trimmed = manifestTitle?.trim();
  return trimmed || fileBaseName;
}

