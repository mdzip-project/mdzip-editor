import { describe, it, expect } from 'vitest';
import { parseFrontMatter } from './front-matter.js';

describe('parseFrontMatter', () => {
  it('parses a leading YAML block into data/body/raw', () => {
    const markdown = '---\ntitle: Hello World\ndraft: true\n---\n# Body\n\nText.\n';
    const result = parseFrontMatter(markdown);
    expect(result).not.toBeNull();
    expect(result?.data).toEqual({ title: 'Hello World', draft: true });
    expect(result?.body).toBe('# Body\n\nText.\n');
    expect(result?.raw).toBe('title: Hello World\ndraft: true');
  });

  it('parses nested maps, lists, and typed scalars', () => {
    const markdown = [
      '---',
      'title: Doc',
      'tags:',
      '  - alpha',
      '  - beta',
      'meta:',
      '  author: Kyle',
      '  count: 3',
      '---',
      'Body text'
    ].join('\n');
    const result = parseFrontMatter(markdown);
    expect(result?.data).toEqual({
      title: 'Doc',
      tags: ['alpha', 'beta'],
      meta: { author: 'Kyle', count: 3 }
    });
    expect(result?.body).toBe('Body text');
  });

  it('returns null when there is no leading front matter block', () => {
    expect(parseFrontMatter('# Heading\n\nText.\n')).toBeNull();
  });

  it('returns null when the block is preceded by a blank line', () => {
    expect(parseFrontMatter('\n---\ntitle: Hi\n---\nBody')).toBeNull();
  });

  it('returns null when the block is preceded by a BOM', () => {
    expect(parseFrontMatter('﻿---\ntitle: Hi\n---\nBody')).toBeNull();
  });

  it('returns null when there is no closing delimiter', () => {
    expect(parseFrontMatter('---\ntitle: Hi\nBody with no closing fence')).toBeNull();
  });

  it('returns null when the block parses to a scalar instead of a map', () => {
    expect(parseFrontMatter('---\njust a string\n---\nBody')).toBeNull();
  });

  it('returns null when the block parses to a list instead of a map', () => {
    expect(parseFrontMatter('---\n- one\n- two\n---\nBody')).toBeNull();
  });

  it('returns null when the YAML is malformed', () => {
    expect(parseFrontMatter('---\ntitle: "unterminated\n---\nBody')).toBeNull();
  });

  it('treats an empty block as an empty data object', () => {
    const result = parseFrontMatter('---\n---\nBody');
    expect(result?.data).toEqual({});
    expect(result?.body).toBe('Body');
  });

  it('handles a document that is only front matter with no trailing body', () => {
    const result = parseFrontMatter('---\ntitle: Solo\n---');
    expect(result?.data).toEqual({ title: 'Solo' });
    expect(result?.body).toBe('');
  });

  it('handles CRLF line endings', () => {
    const result = parseFrontMatter('---\r\ntitle: CRLF\r\n---\r\nBody\r\n');
    expect(result?.data).toEqual({ title: 'CRLF' });
    expect(result?.body).toBe('Body\r\n');
  });
});
