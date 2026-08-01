/** Word, character, line, and reading-time stats for a document's raw text. */
export interface MdzipDocumentStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  lines: number;
  readingTimeMinutes: number;
}

/** Default reading speed used for `readingTimeMinutes`, in words per minute. */
export const MDZIP_DEFAULT_READING_WORDS_PER_MINUTE = 200;

/** Count words in text, splitting on runs of whitespace. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Count lines in text, matching how the editor's own gutter numbers lines
 * (an empty document is one empty line, not zero). */
export function countLines(text: string): number {
  return text === '' ? 1 : text.split('\n').length;
}

/** Count non-whitespace characters in text. */
export function countCharactersExcludingWhitespace(text: string): number {
  return text.replace(/\s/g, '').length;
}

/**
 * Compute live document stats from raw text (e.g. `MdzipWorkspaceSnapshot.currentText`).
 * Operates on the raw markdown source, not rendered/plain text.
 */
export function computeDocumentStats(
  text: string,
  wordsPerMinute: number = MDZIP_DEFAULT_READING_WORDS_PER_MINUTE
): MdzipDocumentStats {
  const words = countWords(text);
  return {
    words,
    characters: text.length,
    charactersNoSpaces: countCharactersExcludingWhitespace(text),
    lines: countLines(text),
    readingTimeMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / wordsPerMinute))
  };
}
