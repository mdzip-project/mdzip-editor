import { describe, it, expect } from 'vitest';
import {
  resolveMdzipControlPolicy,
  type MdzipControlPolicy,
  type MdzipControlPreset,
} from './view.js';

describe('Control Policy', () => {
  describe('resolveMdzipControlPolicy', () => {
    it('resolves preview preset (completely clean)', () => {
      const policy = resolveMdzipControlPolicy('preview');
      expect(policy.toolbar).toBe(false);
      expect(policy.navigation).toBe(false);
      expect(policy.title).toBe(false);
      expect(policy.layout).toBe(false);
      expect(policy.save).toBe(false);
      expect(policy.zoom).toBe(false);
      expect(policy.orphanActions).toBe(false);
      expect(policy.fileActions).toBe(false);
    });

    it('resolves viewer preset', () => {
      const policy = resolveMdzipControlPolicy('viewer');
      expect(policy.toolbar).toBe(true);
      expect(policy.navigation).toBe(true);
      expect(policy.title).toBe(false);
      expect(policy.layout).toBe(true);
      expect(policy.save).toBe(false);
      expect(policy.zoom).toBe(true);
      expect(policy.orphanActions).toBe(false);
      expect(policy.fileActions).toBe(false);
    });

    it('resolves standalone-editor preset', () => {
      const policy = resolveMdzipControlPolicy('standalone-editor');
      expect(policy.toolbar).toBe(true);
      expect(policy.navigation).toBe(true);
      expect(policy.title).toBe(true);
      expect(policy.layout).toBe(true);
      expect(policy.save).toBe(true);
      expect(policy.zoom).toBe(true);
      expect(policy.orphanActions).toBe(true);
      expect(policy.fileActions).toBe(true);
    });

    it('resolves hosted-editor preset', () => {
      const policy = resolveMdzipControlPolicy('hosted-editor');
      expect(policy.toolbar).toBe(true);
      expect(policy.navigation).toBe(true);
      expect(policy.title).toBe(true);
      expect(policy.layout).toBe(true);
      expect(policy.save).toBe(false);
      expect(policy.zoom).toBe(true);
      expect(policy.orphanActions).toBe(true);
      expect(policy.fileActions).toBe(true);
    });

    it('resolves custom preset with explicit overrides', () => {
      const custom: MdzipControlPolicy = {
        preset: 'custom',
        toolbar: false,
        navigation: true,
        title: true,
        layout: false,
        save: false,
        zoom: false,
        orphanActions: false,
      };
      const policy = resolveMdzipControlPolicy(custom);
      expect(policy.toolbar).toBe(false);
      expect(policy.navigation).toBe(true);
      expect(policy.title).toBe(true);
      expect(policy.layout).toBe(false);
    });

    it('merges partial override with preset base', () => {
      const policy = resolveMdzipControlPolicy({
        preset: 'standalone-editor',
        save: false, // Override save to false
        zoom: false, // Override zoom to false
      });
      // Should use standalone-editor defaults for everything except the overrides
      expect(policy.toolbar).toBe(true);
      expect(policy.navigation).toBe(true);
      expect(policy.save).toBe(false); // Overridden
      expect(policy.zoom).toBe(false); // Overridden
    });

    it('defaults to standalone-editor when no control option provided', () => {
      const policy = resolveMdzipControlPolicy(undefined);
      // Should match standalone-editor preset
      expect(policy.toolbar).toBe(true);
      expect(policy.save).toBe(true);
    });

    it('handles bare policy object without preset', () => {
      const policy = resolveMdzipControlPolicy({
        toolbar: false,
        navigation: false,
        title: true,
        layout: true,
        save: true,
        zoom: false,
        orphanActions: true,
      });
      expect(policy.toolbar).toBe(false);
      expect(policy.navigation).toBe(false);
      expect(policy.title).toBe(true);
      expect(policy.layout).toBe(true);
    });

    it('viewer preset allows layout switching', () => {
      const policy = resolveMdzipControlPolicy('viewer');
      // Viewer allows switching between raw, rendered, and split
      expect(policy.layout).toBe(true);
    });

    it('hosted-editor does not show save button', () => {
      const policy = resolveMdzipControlPolicy('hosted-editor');
      expect(policy.save).toBe(false);
    });

    it('standalone-editor shows all controls', () => {
      const policy = resolveMdzipControlPolicy('standalone-editor');
      expect(policy.toolbar).toBe(true);
      expect(policy.navigation).toBe(true);
      expect(policy.title).toBe(true);
      expect(policy.layout).toBe(true);
      expect(policy.save).toBe(true);
      expect(policy.zoom).toBe(true);
      expect(policy.orphanActions).toBe(true);
    });

    it('preview has no controls (completely clean for explorer preview)', () => {
      const policy = resolveMdzipControlPolicy('preview');
      const visibleControls = Object.entries(policy).filter(([, v]) => v).length;
      expect(visibleControls).toBe(0);
      expect(policy.toolbar).toBe(false);
      expect(policy.navigation).toBe(false);
      expect(policy.zoom).toBe(false);
    });

    it('viewer has layout and navigation controls', () => {
      const policy = resolveMdzipControlPolicy('viewer');
      expect(policy.toolbar).toBe(true);
      expect(policy.navigation).toBe(true);
      expect(policy.layout).toBe(true);
      expect(policy.title).toBe(false);
      expect(policy.save).toBe(false);
      expect(policy.zoom).toBe(true);
    });

    it('custom preset without explicit values uses standalone-editor as fallback', () => {
      const policy = resolveMdzipControlPolicy({ preset: 'custom' });
      // Should fall back to standalone-editor defaults
      expect(policy.toolbar).toBe(true);
      expect(policy.save).toBe(true);
    });
  });

  describe('Control policy combinations', () => {
    it('can hide individual controls from a preset', () => {
      const policy = resolveMdzipControlPolicy({
        preset: 'hosted-editor',
        navigation: false,
        zoom: false,
      });
      // hosted-editor base
      expect(policy.save).toBe(false); // Preset default
      expect(policy.toolbar).toBe(true); // Preset default
      // Overrides
      expect(policy.navigation).toBe(false);
      expect(policy.zoom).toBe(false);
    });

    it('can show save in hosted-editor if explicitly enabled', () => {
      const policy = resolveMdzipControlPolicy({
        preset: 'hosted-editor',
        save: true,
      });
      expect(policy.save).toBe(true);
    });
  });
});
