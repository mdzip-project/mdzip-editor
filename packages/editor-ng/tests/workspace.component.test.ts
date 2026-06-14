import '@angular/compiler';
import 'zone.js';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { MdzipEntryRenderContext, MdzipEntryRenderer } from '@mdzip/editor';

const { MockView, MockDiffView, viewInstances, diffViewInstances } = vi.hoisted(() => {
  const viewInstances: MockView[] = [];
  const diffViewInstances: MockDiffView[] = [];
  class MockView {
    public readonly container: HTMLElement;
    public readonly options: Record<string, unknown>;
    public readonly setRenderingOptions = vi.fn();
    public readonly open = vi.fn(async () => {});
    public readonly openWorkspace = vi.fn(async () => {});
    public readonly destroy = vi.fn();
    public constructor(container: HTMLElement, options: Record<string, unknown>) {
      this.container = container;
      this.options = options;
      viewInstances.push(this);
    }
  }
  class MockDiffView {
    public readonly open = vi.fn(async () => {});
    public readonly openPath = vi.fn(async () => true);
    public readonly setShowUnchanged = vi.fn();
    public readonly setNavigationVisible = vi.fn();
    public readonly setToolbarActions = vi.fn();
    public readonly destroy = vi.fn();
    public constructor(
      public readonly container: HTMLElement,
      public readonly options: Record<string, unknown>
    ) {
      diffViewInstances.push(this);
      void this.open(options);
    }
  }
  return { MockView, MockDiffView, viewInstances, diffViewInstances };
});

vi.mock('@mdzip/editor', () => ({ MdzipWorkspaceView: MockView }));
vi.mock('@mdzip/editor/diff-view', () => ({ MdzipDiffView: MockDiffView }));

import { MdzipWorkspaceComponent } from '../src/workspace.component';
import { MdzipEntryRendererDirective } from '../src/entry-renderer.directive';
import { MdzipDiffComponent } from '../src/diff.component';

beforeAll(() => {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
});

afterEach(() => {
  viewInstances.length = 0;
  diffViewInstances.length = 0;
  TestBed.resetTestingModule();
});

function entryContext(path: string, overrides: Partial<MdzipEntryRenderContext> = {}): MdzipEntryRenderContext {
  return {
    path,
    pathType: 'text',
    mode: 'editable',
    sourceFormat: 'mdz',
    colorScheme: 'light',
    manifest: null,
    snapshot: {} as MdzipEntryRenderContext['snapshot'],
    signal: new AbortController().signal,
    readBytes: async () => new Uint8Array(),
    updateManifest: async () => {},
    ...overrides
  };
}

const explicitRenderer: MdzipEntryRenderer = {
  id: 'explicit',
  matches: () => false,
  mount: () => {}
};

function latestView(): InstanceType<typeof MockView> {
  const view = viewInstances.at(-1);
  if (!view) throw new Error('no view created');
  return view;
}

@Component({
  standalone: true,
  imports: [MdzipWorkspaceComponent, MdzipEntryRendererDirective],
  template: `
    <mdzip-workspace [entryRenderers]="renderers">
      <ng-template mdzipEntryRenderer="manifest.json" let-context>
        <div class="entry">tpl:{{ context.path }}:{{ context.colorScheme }}</div>
      </ng-template>
      <ng-template [mdzipEntryRendererMatch]="isDrawio" let-context>
        <div class="drawio">drawio:{{ context.path }}</div>
      </ng-template>
    </mdzip-workspace>
  `
})
class HostComponent {
  renderers: readonly MdzipEntryRenderer[] = [explicitRenderer];
  isDrawio = (context: MdzipEntryRenderContext): boolean => context.path.endsWith('.drawio');
}

function createHost() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

test('composes explicit entry renderers with template directives', () => {
  createHost();

  const composed = latestView().options['entryRenderers'] as MdzipEntryRenderer[];
  expect(composed.map((renderer) => renderer.id)).toEqual([
    'explicit',
    'mdzip-ng-template:manifest.json',
    'mdzip-ng-template#1'
  ]);
  expect(latestView().options['libraries']).toEqual([
    expect.objectContaining({
      name: '@mdzip/editor-ng',
      version: '1.3.5',
      repositoryUrl: expect.stringContaining('/packages/editor-ng'),
      description: expect.stringContaining('Angular')
    })
  ]);
});

test('path and predicate templates match the right entries', () => {
  createHost();
  const [, byPath, byPredicate] = latestView().options['entryRenderers'] as MdzipEntryRenderer[];

  expect(byPath.matches(entryContext('manifest.json'))).toBe(true);
  expect(byPath.matches(entryContext('Manifest.JSON'))).toBe(true);
  expect(byPath.matches(entryContext('index.md'))).toBe(false);

  expect(byPredicate.matches(entryContext('diagrams/flow.drawio'))).toBe(true);
  expect(byPredicate.matches(entryContext('manifest.json'))).toBe(false);
});

test('template adapter mounts an embedded view, updates context, and destroys it', () => {
  createHost();
  const byPath = (latestView().options['entryRenderers'] as MdzipEntryRenderer[])[1];

  const container = document.createElement('div');
  const handle = byPath.mount(container, entryContext('manifest.json')) as {
    update?: (context: MdzipEntryRenderContext) => void;
    destroy: () => void;
  };
  expect(container.textContent?.trim()).toBe('tpl:manifest.json:light');

  handle.update?.(entryContext('manifest.json', { colorScheme: 'dark' }));
  expect(container.textContent?.trim()).toBe('tpl:manifest.json:dark');

  handle.destroy();
  expect(container.querySelector('.entry')).toBeNull();
});

test('identity changes with stable ids never recreate or re-apply', () => {
  const fixture = createHost();
  const view = latestView();

  fixture.componentInstance.renderers = [{ ...explicitRenderer }];
  fixture.detectChanges();
  expect(viewInstances).toHaveLength(1);
  expect(view.setRenderingOptions).not.toHaveBeenCalled();

  fixture.componentInstance.renderers = [{ ...explicitRenderer, id: 'changed' }];
  fixture.detectChanges();
  expect(viewInstances).toHaveLength(1);
  expect(view.setRenderingOptions).toHaveBeenCalledTimes(1);
});

test('diff component updates one view and exposes navigation methods', async () => {
  TestBed.configureTestingModule({ imports: [MdzipDiffComponent] });
  const fixture = TestBed.createComponent(MdzipDiffComponent);
  fixture.componentRef.setInput('before', { bytes: Uint8Array.from([1]), label: 'Base' });
  fixture.componentRef.setInput('after', { bytes: Uint8Array.from([2]), label: 'Working' });
  fixture.detectChanges();
  await vi.waitFor(() => expect(diffViewInstances).toHaveLength(1));

  const view = diffViewInstances[0];
  expect(view.open).toHaveBeenCalledTimes(1);
  fixture.componentRef.setInput('showUnchanged', false);
  fixture.detectChanges();
  expect(diffViewInstances).toHaveLength(1);
  expect(view.open).toHaveBeenCalledTimes(1);
  expect(view.setShowUnchanged).toHaveBeenLastCalledWith(false);

  await fixture.componentInstance.openPath('index.md');
  expect(view.openPath).toHaveBeenCalledWith('index.md');
});
