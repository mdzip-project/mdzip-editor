import { describe, it, expect } from 'vitest';
import { suggestedTitleFromMarkdown, firstMarkdownHeading } from './metadata.js';

describe('suggestedTitleFromMarkdown', () => {
  it('prefers a front matter title over a heading', () => {
    const markdown = '---\ntitle: Front Matter Title\n---\n# Heading Title\n';
    expect(suggestedTitleFromMarkdown(markdown, 'file')).toBe('Front Matter Title');
  });

  it('falls back to the first heading when front matter has no title', () => {
    const markdown = '---\ndraft: true\n---\n# Heading Title\n';
    expect(suggestedTitleFromMarkdown(markdown, 'file')).toBe('Heading Title');
  });

  it('falls back to the first heading when there is no front matter', () => {
    expect(suggestedTitleFromMarkdown('# Heading Title\n', 'file')).toBe('Heading Title');
  });

  it('falls back to the filename when neither front matter nor a heading is present', () => {
    expect(suggestedTitleFromMarkdown('Just some text.\n', 'file')).toBe('file');
  });

  it('ignores a non-string front matter title', () => {
    const markdown = '---\ntitle: 42\n---\n# Heading Title\n';
    expect(suggestedTitleFromMarkdown(markdown, 'file')).toBe('Heading Title');
  });

  it('ignores a blank front matter title', () => {
    const markdown = '---\ntitle: "   "\n---\n# Heading Title\n';
    expect(suggestedTitleFromMarkdown(markdown, 'file')).toBe('Heading Title');
  });

  it('trims a front matter title', () => {
    const markdown = '---\ntitle: "  Padded  "\n---\nBody\n';
    expect(suggestedTitleFromMarkdown(markdown, 'file')).toBe('Padded');
  });
});

describe('firstMarkdownHeading with leading front matter', () => {
  it('finds the heading in the body, skipping the front matter block', () => {
    const markdown = '---\ntitle: Not This\n---\n# Real Heading\n';
    expect(firstMarkdownHeading(markdown)).toBe('Real Heading');
  });
});
