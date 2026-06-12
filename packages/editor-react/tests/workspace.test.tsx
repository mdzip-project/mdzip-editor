import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { MdzipEntryRenderContext, MdzipEntryRenderer } from '@mdzip/editor';

const { MockView, viewInstances } = vi.hoisted(() => {
  const viewInstances: MockView[] = [];
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
  return { MockView, viewInstances };
});

vi.mock('@mdzip/editor', () => ({ MdzipWorkspaceView: MockView }));

import { MdzipWorkspace } from '../src/index';

afterEach(() => {
  cleanup();
  viewInstances.length = 0;
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
