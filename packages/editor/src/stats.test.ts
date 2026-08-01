import { describe, it, expect } from 'vitest';
import {
  computeDocumentStats,
  countCharactersExcludingWhitespace,
  countLines,
  countWords
} from './stats.js';

describe('countWords', () => {
  it('counts words separated by whitespace', () => {
    expect(countWords('hello world')).toBe(2);
  });

  it('collapses runs of whitespace and ignores leading/trailing', () => {
    expect(countWords('  hello   world  \n\tfoo ')).toBe(3);
  });

  it('returns 0 for empty or whitespace-only text', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
  });
});

describe('countLines', () => {
  it('treats an empty document as one line, matching the editor gutter', () => {
    expect(countLines('')).toBe(1);
  });

  it('counts newline-separated lines', () => {
    expect(countLines('a\nb\nc')).toBe(3);
  });

  it('counts a trailing newline as starting an additional empty line', () => {
    expect(countLines('a\nb\n')).toBe(3);
  });
});

describe('countCharactersExcludingWhitespace', () => {
  it('strips all whitespace, including newlines', () => {
    expect(countCharactersExcludingWhitespace('a b\nc\td')).toBe(4);
  });

  it('returns 0 for whitespace-only text', () => {
    expect(countCharactersExcludingWhitespace('   \n\t')).toBe(0);
  });
});

describe('computeDocumentStats', () => {
  it('computes all stats for a simple document', () => {
    const stats = computeDocumentStats('hello world\nsecond line');
    expect(stats).toEqual({
      words: 4,
      characters: 23,
      charactersNoSpaces: 20,
      lines: 2,
      readingTimeMinutes: 1
    });
  });

  it('returns all zeros (except a 1-line empty document) for empty text', () => {
    expect(computeDocumentStats('')).toEqual({
      words: 0,
      characters: 0,
      charactersNoSpaces: 0,
      lines: 1,
      readingTimeMinutes: 0
    });
  });

  it('rounds reading time to the nearest minute at the default 200wpm, minimum 1', () => {
    const oneWord = computeDocumentStats('hello');
    expect(oneWord.readingTimeMinutes).toBe(1);

    const words300 = 'word '.repeat(300).trim();
    expect(computeDocumentStats(words300).readingTimeMinutes).toBe(2);
  });

  it('respects a custom words-per-minute rate', () => {
    const words100 = 'word '.repeat(100).trim();
    expect(computeDocumentStats(words100, 50).readingTimeMinutes).toBe(2);
  });
});
