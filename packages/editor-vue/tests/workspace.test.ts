import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';
import { afterEach, expect, test, vi } from 'vitest';
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

import { MdzipWorkspace } from '../src/index';
import { MdzipDiff } from '../src/diff-view';

afterEach(() => {
  viewInstances.length = 0;
  diffViewInstances.length = 0;
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

const manifestSlot = (params: { context: MdzipEntryRenderContext }) =>
  params.context.path === 'manifest.json'
    ? h('div', { class: 'entry' }, `slot:${params.context.path}:${params.context.colorScheme}`)
    : null;

test('composes explicit entry renderers with the #entry slot catch-all', () => {
  mount(MdzipWorkspace, {
    props: { entryRenderers: [explicitRenderer] },
    slots: { entry: manifestSlot }
  });

  const composed = latestView().options['entryRenderers'] as MdzipEntryRenderer[];
  expect(composed.map((renderer) => renderer.id)).toEqual(['explicit', 'mdzip-vue-entry-slot']);
  expect(latestView().options['libraries']).toEqual([
    expect.objectContaining({
      name: '@mdzip/editor-vue',
      version: '1.3.5',
      repositoryUrl: expect.stringContaining('/packages/editor-vue'),
      description: expect.stringContaining('Vue wrapper')
    })
  ]);
});

test('slot content decides matching: empty render delegates to built-ins', () => {
  mount(MdzipWorkspace, { slots: { entry: manifestSlot } });
  const adapter = (latestView().options['entryRenderers'] as MdzipEntryRenderer[])[0];

  expect(adapter.matches(entryContext('index.md'))).toBe(false);
  expect(adapter.matches(entryContext('manifest.json'))).toBe(true);
});

test('slot adapter mounts, updates reactively, and unmounts', async () => {
  mount(MdzipWorkspace, { slots: { entry: manifestSlot } });
  const adapter = (latestView().options['entryRenderers'] as MdzipEntryRenderer[])[0];

  const container = document.createElement('div');
  const handle = adapter.mount(container, entryContext('manifest.json')) as {
    update?: (context: MdzipEntryRenderContext) => void;
    destroy: () => void;
  };
  await nextTick();
  expect(container.textContent).toBe('slot:manifest.json:light');

  handle.update?.(entryContext('manifest.json', { colorScheme: 'dark' }));
  await nextTick();
  expect(container.textContent).toBe('slot:manifest.json:dark');

  handle.destroy();
  await nextTick();
  expect(container.textContent).toBe('');
});

test('inline prop identities with stable ids never recreate or re-apply', async () => {
  const wrapper = mount(MdzipWorkspace, {
    props: { entryRenderers: [{ ...explicitRenderer }] }
  });
  const view = latestView();

  await wrapper.setProps({ entryRenderers: [{ ...explicitRenderer }] });
  expect(viewInstances).toHaveLength(1);
  expect(view.setRenderingOptions).not.toHaveBeenCalled();

  await wrapper.setProps({ entryRenderers: [{ ...explicitRenderer, id: 'changed' }] });
  expect(viewInstances).toHaveLength(1);
  expect(view.setRenderingOptions).toHaveBeenCalledTimes(1);
  const applied = view.setRenderingOptions.mock.calls[0][0] as {
    entryRenderers: MdzipEntryRenderer[];
  };
  expect(applied.entryRenderers.map((renderer) => renderer.id)).toEqual(['changed']);
});

test('diff wrapper updates one view and exposes navigation methods', async () => {
  const before = { bytes: Uint8Array.from([1]), label: 'Base' };
  const after = { bytes: Uint8Array.from([2]), label: 'Working' };
  const wrapper = mount(MdzipDiff, { props: { before, after } });
  await nextTick();
  const view = diffViewInstances[0];
  expect(view.open).toHaveBeenCalledTimes(1);

  await wrapper.setProps({ showUnchanged: false });
  expect(diffViewInstances).toHaveLength(1);
  expect(view.open).toHaveBeenCalledTimes(1);
  expect(view.setShowUnchanged).toHaveBeenLastCalledWith(false);
  await wrapper.vm.openPath('index.md');
  expect(view.openPath).toHaveBeenCalledWith('index.md');
});
