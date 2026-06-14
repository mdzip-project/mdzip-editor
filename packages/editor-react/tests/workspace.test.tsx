import { act, cleanup, render } from '@testing-library/react';
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
  cleanup();
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

test('composes explicit entry renderers with the renderEntry catch-all', () => {
  render(
    <MdzipWorkspace
      entryRenderers={[explicitRenderer]}
      renderEntry={(context) =>
        context.path === 'manifest.json' ? <div>manifest</div> : undefined}
    />
  );

  const composed = latestView().options['entryRenderers'] as MdzipEntryRenderer[];
  expect(composed.map((renderer) => renderer.id)).toEqual(['explicit', 'mdzip-react-render-entry']);
  expect(latestView().options['libraries']).toEqual([
    expect.objectContaining({
      name: '@mdzip/editor-react',
      version: '1.3.5',
      repositoryUrl: expect.stringContaining('/packages/editor-react'),
      description: expect.stringContaining('React wrapper')
    })
  ]);
});

test('inline prop identities with stable ids never recreate or re-apply', () => {
  const { rerender } = render(
    <MdzipWorkspace
      entryRenderers={[{ ...explicitRenderer }]}
      renderEntry={(context) => (context.path === 'manifest.json' ? <div /> : undefined)}
    />
  );
  const view = latestView();

  rerender(
    <MdzipWorkspace
      entryRenderers={[{ ...explicitRenderer }]}
      renderEntry={(context) => (context.path === 'manifest.json' ? <div /> : undefined)}
    />
  );

  expect(viewInstances).toHaveLength(1);
  expect(view.setRenderingOptions).not.toHaveBeenCalled();

  rerender(
    <MdzipWorkspace
      entryRenderers={[{ ...explicitRenderer, id: 'changed' }]}
      renderEntry={(context) => (context.path === 'manifest.json' ? <div /> : undefined)}
    />
  );

  expect(viewInstances).toHaveLength(1);
  expect(view.setRenderingOptions).toHaveBeenCalledTimes(1);
  const applied = view.setRenderingOptions.mock.calls[0][0] as {
    entryRenderers: MdzipEntryRenderer[];
  };
  expect(applied.entryRenderers.map((renderer) => renderer.id))
    .toEqual(['changed', 'mdzip-react-render-entry']);
});

test('renderEntry adapter matches, mounts, updates, stays live with parent state, and unmounts', async () => {
  function Host({ label }: { label: string }) {
    return (
      <MdzipWorkspace
        renderEntry={(context) =>
          context.path === 'manifest.json'
            ? <div data-testid="entry">{label}:{context.path}:{context.colorScheme}</div>
            : undefined}
      />
    );
  }

  const { rerender } = render(<Host label="first" />);
  const adapter = (latestView().options['entryRenderers'] as MdzipEntryRenderer[])[0];
  expect(adapter.id).toBe('mdzip-react-render-entry');

  // Returning undefined delegates to the next renderer / built-in rendering.
  expect(adapter.matches(entryContext('index.md'))).toBe(false);
  expect(adapter.matches(entryContext('manifest.json'))).toBe(true);

  const container = document.createElement('div');
  let handle!: { update?: (context: MdzipEntryRenderContext) => void; destroy: () => void };
  act(() => {
    handle = adapter.mount(container, entryContext('manifest.json')) as typeof handle;
  });
  expect(container.textContent).toBe('first:manifest.json:light');

  // Core-driven context updates re-render the mounted React tree.
  act(() => handle.update?.(entryContext('manifest.json', { colorScheme: 'dark' })));
  expect(container.textContent).toBe('first:manifest.json:dark');

  // Parent re-renders keep entry content live without re-mounting.
  rerender(<Host label="second" />);
  expect(container.textContent).toBe('second:manifest.json:dark');

  act(() => handle.destroy());
  await act(async () => {}); // unmount is deferred to a microtask
  expect(container.childNodes).toHaveLength(0);
});

test('diff wrapper opens in place and exposes the imperative API', async () => {
  const before = { bytes: Uint8Array.from([1]), label: 'Base' };
  const after = { bytes: Uint8Array.from([2]), label: 'Working' };
  const ref = { current: null as import('../src/diff-view').MdzipDiffHandle | null };
  const { rerender } = render(
    <MdzipDiff ref={ref} before={before} after={after} showUnchanged />
  );
  await act(async () => {});

  const view = diffViewInstances[0];
  expect(view.open).toHaveBeenCalledTimes(1);
  rerender(<MdzipDiff ref={ref} before={before} after={after} showUnchanged={false} />);
  await act(async () => {});
  expect(diffViewInstances).toHaveLength(1);
  expect(view.open).toHaveBeenCalledTimes(1);
  expect(view.setShowUnchanged).toHaveBeenLastCalledWith(false);

  await ref.current?.openPath('index.md');
  expect(view.openPath).toHaveBeenCalledWith('index.md');
});
