import { describe, it, expect } from 'vitest';
import { resolveMdzipControlPolicy } from './view.js';

describe('resolveMdzipControlPolicy', () => {
  it('resolves the preview preset (completely clean)', () => {
    const policy = resolveMdzipControlPolicy('preview');
    expect(policy.toolbar).toBe(false);
    expect(policy.navigation).toBe(false);
    expect(policy.title).toEqual({ visible: false, editable: false });
    expect(policy.layout).toEqual({ source: false, split: false, preview: false });
    expect(policy.lineNumbers).toBe(false);
    expect(policy.save).toBe(false);
    expect(policy.zoom).toBe(false);
    expect(policy.colorScheme).toBe(false);
    expect(policy.orphanActions).toBe(false);
    expect(policy.fileActions).toBe(false);
    expect(policy.search).toBe(false);
    expect(policy.formatting.headings).toEqual([]);
  });

  it('resolves the viewer preset (read-only with layout and navigation)', () => {
    const policy = resolveMdzipControlPolicy('viewer');
    expect(policy.toolbar).toBe(true);
    expect(policy.navigation).toBe(true);
    expect(policy.title).toEqual({ visible: true, editable: false });
    expect(policy.layout).toEqual({ source: true, split: true, preview: true });
    expect(policy.save).toBe(false);
    expect(policy.zoom).toBe(true);
    expect(policy.colorScheme).toBe(true);
    expect(policy.orphanActions).toBe(false);
    expect(policy.fileActions).toBe(false);
    expect(policy.search).toBe(true);
    expect(policy.formatting.bold).toBe(false);
    expect(policy.formatting.lineBreak).toBe(false);
  });

  it('resolves the standalone-editor preset (all controls, including save)', () => {
    const policy = resolveMdzipControlPolicy('standalone-editor');
    expect(policy.toolbar).toBe(true);
    expect(policy.navigation).toBe(true);
    expect(policy.title).toEqual({ visible: true, editable: true });
    expect(policy.layout).toEqual({ source: true, split: true, preview: true });
    expect(policy.save).toBe(true);
    expect(policy.zoom).toBe(true);
    expect(policy.orphanActions).toBe(true);
    expect(policy.fileActions).toBe(true);
    expect(policy.search).toBe(true);
    expect(policy.formatting.bold).toBe(true);
    expect(policy.formatting.lineBreak).toBe(true);
    expect(policy.formatting.headings).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('resolves the hosted-editor preset (host owns persistence: no save button)', () => {
    const policy = resolveMdzipControlPolicy('hosted-editor');
    expect(policy.save).toBe(false);
    expect(policy.toolbar).toBe(true);
    expect(policy.title).toEqual({ visible: true, editable: true });
    expect(policy.fileActions).toBe(true);
    expect(policy.search).toBe(true);
  });

  it('can disable search independently of other controls', () => {
    const policy = resolveMdzipControlPolicy({ preset: 'standalone-editor', search: false });
    expect(policy.search).toBe(false);
    expect(policy.save).toBe(true);
  });

  it('defaults to standalone-editor when no controls are provided', () => {
    const policy = resolveMdzipControlPolicy(undefined);
    expect(policy.preset).toBe('standalone-editor');
    expect(policy.save).toBe(true);
  });

  it('treats the custom preset string as standalone-editor defaults', () => {
    const policy = resolveMdzipControlPolicy('custom');
    expect(policy.preset).toBe('custom');
    expect(policy.toolbar).toBe(true);
    expect(policy.save).toBe(true);
  });

  it('merges partial overrides onto the preset base', () => {
    const policy = resolveMdzipControlPolicy({
      preset: 'standalone-editor',
      save: false,
      zoom: false
    });
    expect(policy.toolbar).toBe(true);
    expect(policy.navigation).toBe(true);
    expect(policy.save).toBe(false);
    expect(policy.zoom).toBe(false);
  });

  it('expands boolean title and layout overrides to the structured form', () => {
    const policy = resolveMdzipControlPolicy({
      preset: 'viewer',
      title: true,
      layout: false
    });
    // Boolean title keeps the base editable flag (viewer titles stay read-only).
    expect(policy.title).toEqual({ visible: true, editable: false });
    expect(policy.layout).toEqual({ source: false, split: false, preview: false });
  });

  it('resolves granular layout overrides against the enabled flag', () => {
    const policy = resolveMdzipControlPolicy({
      preset: 'viewer',
      layout: { enabled: false, preview: true }
    });
    expect(policy.layout).toEqual({ source: false, split: false, preview: true });
  });

  it('can re-enable save on hosted-editor explicitly', () => {
    const policy = resolveMdzipControlPolicy({ preset: 'hosted-editor', save: true });
    expect(policy.save).toBe(true);
  });

  it('handles a bare policy object as custom over standalone-editor defaults', () => {
    const policy = resolveMdzipControlPolicy({ toolbar: false, navigation: false });
    expect(policy.preset).toBe('custom');
    expect(policy.toolbar).toBe(false);
    expect(policy.navigation).toBe(false);
    expect(policy.save).toBe(true);
  });
});
