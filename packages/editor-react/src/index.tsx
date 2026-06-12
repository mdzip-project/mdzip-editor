import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MdzipWorkspaceView } from '@mdzip/editor';
import type {
  MdzipControlPolicy,
  MdzipControlPreset,
  MdzipColorScheme,
  MdzipConversionAction,
  MdzipDocumentChangeEvent,
  MdzipEditorCommand,
  MdzipEditorSnapshot,
  MdzipEntryRenderContext,
  MdzipEntryRenderer,
  MdzipMarkdownRenderExtension,
  MdzipMarkdownRenderer,
  MdzipNavigationMode,
  MdzipRemoveAssetOptions,
  MdzipSourceFormat,
  MdzipWorkspaceChange,
  MdzipWorkspaceLayout,
  MdzipWorkspaceMode,
  MdzipWorkspaceSave,
  MdzipWorkspaceSnapshot,
  MdzWorkspace,
  MdzWorkspaceAsset,
} from '@mdzip/editor';

/**
 * Catch-all entry render function. Returning a React node claims the entry's
 * content area; returning `undefined` delegates to the next registered entry
 * renderer or the built-in rendering.
 */
export type MdzipRenderEntry = (context: MdzipEntryRenderContext) => ReactNode | undefined;

// Identity-insensitive key for the rendering props: extensions and entry
// renderers are diffed by their stable name/id (and priority), so inline
// array literals with equivalent contents never trigger an update.
function renderingConfigKey(
  extensions: readonly MdzipMarkdownRenderExtension[] | undefined,
  entryRenderers: readonly MdzipEntryRenderer[] | undefined
): string {
  return JSON.stringify([
    (extensions ?? []).map((extension) => extension.name),
    (entryRenderers ?? []).map((renderer) => [renderer.id, renderer.priority ?? 0]),
  ]);
}

/**
 * Adapts the `renderEntry` render prop onto the framework-independent
 * `MdzipEntryRenderer` contract. The wrapper owns the React root: it is
 * created on mount, re-rendered on context updates and on every parent
 * commit (so entry content stays live with parent state), and unmounted on
 * destroy. The latest `renderEntry` closure is always read through this
 * adapter, so new function identities never re-mount anything.
 */
class ReactEntryAdapter implements MdzipEntryRenderer {
  public readonly id = 'mdzip-react-render-entry';
  public priority = 0;

  private renderEntry: MdzipRenderEntry | undefined;
  private root: Root | null = null;
  private context: MdzipEntryRenderContext | null = null;

  public matches(context: MdzipEntryRenderContext): boolean {
    return this.renderEntry ? this.renderEntry(context) !== undefined : false;
  }

  public mount(container: HTMLElement, context: MdzipEntryRenderContext) {
    this.context = context;
    this.root = createRoot(container);
    this.renderIntoRoot();
    return {
      update: (next: MdzipEntryRenderContext) => {
        this.context = next;
        this.renderIntoRoot();
      },
      destroy: () => {
        const root = this.root;
        this.root = null;
        this.context = null;
        // React warns when a root unmounts synchronously while another tree
        // renders; the core may destroy during a render-triggered teardown.
        queueMicrotask(() => root?.unmount());
      }
    };
  }

  public setRenderEntry(renderEntry: MdzipRenderEntry | undefined): void {
    this.renderEntry = renderEntry;
    this.renderIntoRoot();
  }

  private renderIntoRoot(): void {
    if (this.root && this.context) {
      this.root.render(this.renderEntry?.(this.context) ?? null);
    }
  }
}

function composeEntryRenderers(
  entryRenderers: readonly MdzipEntryRenderer[] | undefined,
  adapter: ReactEntryAdapter,
  renderEntry: MdzipRenderEntry | undefined
): readonly MdzipEntryRenderer[] {
  const explicit = entryRenderers ?? [];
  // Stable sort in the core keeps explicit renderers ahead of the catch-all
  // at equal priority.
  return renderEntry ? [...explicit, adapter] : explicit;
}

export interface MdzipWorkspaceProps {
  bytes?: Uint8Array | null;
  workspace?: MdzWorkspace | null;
  fileName?: string;
  mode?: MdzipWorkspaceMode;
  sourceFormat?: MdzipSourceFormat;
  controls?: MdzipControlPreset | MdzipControlPolicy;
  initialLayout?: MdzipWorkspaceLayout;
  initialColorScheme?: MdzipColorScheme;
  navigationMode?: MdzipNavigationMode;
  navigationButtonActive?: boolean;
  onChanged?: (event: MdzipWorkspaceChange) => void;
  onSaved?: (event: MdzipWorkspaceSave) => void;
  onWorkspaceChanged?: (event: MdzipDocumentChangeEvent) => void;
  onDocumentChanged?: (event: MdzipDocumentChangeEvent) => void;
  onAssetChanged?: (event: MdzipDocumentChangeEvent) => void;
  onManifestChanged?: (event: MdzipDocumentChangeEvent) => void;
  onSnapshotChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onSelectionChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onDirtyChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onValidationChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onColorSchemeChanged?: (colorScheme: MdzipColorScheme) => void;
  onFailed?: (error: unknown) => void;
  /**
   * Host hook for the markdown→MDZ conversion flow. Return/resolve `true`
   * to take over (the built-in conversion dialog is suppressed).
   */
  onConversionRequested?: (action: MdzipConversionAction) => boolean | Promise<boolean>;
  /**
   * Custom markdown renderer. Keep the reference stable (module scope or
   * useMemo): identity changes apply via a cheap preview re-render, never a
   * workspace rebuild.
   */
  markdownRenderer?: MdzipMarkdownRenderer;
  /** Markdown pipeline extensions, diffed by `name` — inline arrays are safe. */
  markdownExtensions?: readonly MdzipMarkdownRenderExtension[];
  /** Entry renderers, diffed by `id`/`priority` — inline arrays are safe. */
  entryRenderers?: readonly MdzipEntryRenderer[];
  /**
   * Catch-all entry render function. Return a React node to claim the
   * selected entry's content area, or `undefined` to delegate to
   * `entryRenderers` and the built-in rendering. The wrapper owns the React
   * root lifecycle, and the content stays live with parent state — inline
   * closures are safe and never re-mount.
   */
  renderEntry?: MdzipRenderEntry;
  /** Matching priority of `renderEntry` relative to `entryRenderers`. Default 0. */
  renderEntryPriority?: number;
}

export interface MdzipWorkspaceHandle {
  canExecuteCommand(command: MdzipEditorCommand): boolean;
  executeCommand(command: MdzipEditorCommand, file?: File): Promise<boolean>;
  convertToMdz(): Promise<boolean>;
  flush(): Promise<MdzipEditorSnapshot | null>;
  serialize(): Promise<Blob | null>;
  getCurrentSnapshot(): Promise<MdzipEditorSnapshot | null>;
  markPersisted(): void;
  addAsset(archivePath: string, fileBytes: Uint8Array): Promise<void>;
  replaceAsset(archivePath: string, fileBytes: Uint8Array): Promise<boolean>;
  removeAsset(archivePath: string, options?: MdzipRemoveAssetOptions): Promise<boolean>;
  removeFile(archivePath: string): Promise<boolean>;
  renameFile(oldPath: string, newPath: string): Promise<boolean>;
  setEntryPoint(archivePath: string): Promise<boolean>;
  setCoverImage(archivePath: string | null): Promise<boolean>;
  listAssets(): MdzWorkspaceAsset[];
  focus(): void;
}

export const MdzipWorkspace = forwardRef<MdzipWorkspaceHandle, MdzipWorkspaceProps>(
function MdzipWorkspace({
  bytes,
  workspace,
  fileName = 'document.mdz',
  mode = 'read-only',
  sourceFormat,
  controls = 'viewer',
  initialLayout,
  initialColorScheme,
  navigationMode,
  navigationButtonActive,
  onChanged,
  onSaved,
  onWorkspaceChanged,
  onDocumentChanged,
  onAssetChanged,
  onManifestChanged,
  onSnapshotChanged,
  onSelectionChanged,
  onDirtyChanged,
  onValidationChanged,
  onColorSchemeChanged,
  onFailed,
  onConversionRequested,
  markdownRenderer,
  markdownExtensions,
  entryRenderers,
  renderEntry,
  renderEntryPriority,
}, forwardedRef) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MdzipWorkspaceView | null>(null);
  const adapterRef = useRef<ReactEntryAdapter | null>(null);
  if (!adapterRef.current) {
    adapterRef.current = new ReactEntryAdapter();
  }
  adapterRef.current.priority = renderEntryPriority ?? 0;

  // Callbacks and content are read through refs at event/recreate time so
  // that new prop identities (e.g. inline handlers) never force a view
  // rebuild — only the view-config props below do.
  const callbacksRef = useRef({
    onChanged,
    onSaved,
    onWorkspaceChanged,
    onDocumentChanged,
    onAssetChanged,
    onManifestChanged,
    onSnapshotChanged,
    onSelectionChanged,
    onDirtyChanged,
    onValidationChanged,
    onColorSchemeChanged,
    onFailed,
    onConversionRequested,
  });
  callbacksRef.current = {
    onChanged,
    onSaved,
    onWorkspaceChanged,
    onDocumentChanged,
    onAssetChanged,
    onManifestChanged,
    onSnapshotChanged,
    onSelectionChanged,
    onDirtyChanged,
    onValidationChanged,
    onColorSchemeChanged,
    onFailed,
    onConversionRequested,
  };

  const contentRef = useRef({ bytes, workspace, mode, sourceFormat, fileName });
  contentRef.current = { bytes, workspace, mode, sourceFormat, fileName };

  // Latest rendering props, read at view-create and apply time so prop
  // identity changes alone never rebuild the workspace view.
  const renderingRef = useRef({ markdownRenderer, markdownExtensions, entryRenderers, renderEntry });
  renderingRef.current = { markdownRenderer, markdownExtensions, entryRenderers, renderEntry };
  const renderingKey = renderingConfigKey(
    markdownExtensions,
    composeEntryRenderers(entryRenderers, adapterRef.current, renderEntry)
  );

  // Keep the mounted entry content live with parent state: every commit
  // re-renders the adapter's root with the latest renderEntry closure.
  useEffect(() => {
    adapterRef.current?.setRenderEntry(renderEntry);
  });

  useImperativeHandle(forwardedRef, () => ({
    canExecuteCommand: (command) => viewRef.current?.canExecuteCommand(command) ?? false,
    executeCommand: (command, file) =>
      viewRef.current?.executeCommand(command, file) ?? Promise.resolve(false),
    convertToMdz: () => viewRef.current?.convertToMdz() ?? Promise.resolve(false),
    flush: () => viewRef.current?.flush() ?? Promise.resolve(null),
    serialize: () => viewRef.current?.serialize() ?? Promise.resolve(null),
    getCurrentSnapshot: () => viewRef.current?.getCurrentSnapshot() ?? Promise.resolve(null),
    markPersisted: () => viewRef.current?.markPersisted(),
    addAsset: (archivePath, fileBytes) =>
      viewRef.current?.addAsset(archivePath, fileBytes) ?? Promise.resolve(),
    replaceAsset: (archivePath, fileBytes) =>
      viewRef.current?.replaceAsset(archivePath, fileBytes) ?? Promise.resolve(false),
    removeAsset: (archivePath, options) =>
      viewRef.current?.removeAsset(archivePath, options) ?? Promise.resolve(false),
    removeFile: (archivePath) =>
      viewRef.current?.removeFile(archivePath) ?? Promise.resolve(false),
    renameFile: (oldPath, newPath) =>
      viewRef.current?.renameFile(oldPath, newPath) ?? Promise.resolve(false),
    setEntryPoint: (archivePath) =>
      viewRef.current?.setEntryPoint(archivePath) ?? Promise.resolve(false),
    setCoverImage: (archivePath) =>
      viewRef.current?.setCoverImage(archivePath) ?? Promise.resolve(false),
    listAssets: () => viewRef.current?.listAssets() ?? [],
    focus: () => viewRef.current?.focus()
  }), []);

  const firstCreateRef = useRef(true);

  useEffect(() => {
    if (!ref.current) return;
    const view = new MdzipWorkspaceView(ref.current, {
      controls,
      initialLayout,
      initialColorScheme,
      navigationMode,
      navigationButtonActive,
      onChanged: (bytes, snapshot) => callbacksRef.current.onChanged?.({ bytes, snapshot }),
      onSaved: (bytes, snapshot) => callbacksRef.current.onSaved?.({ bytes, snapshot }),
      onWorkspaceChanged: (event) => callbacksRef.current.onWorkspaceChanged?.(event),
      onDocumentChanged: (event) => callbacksRef.current.onDocumentChanged?.(event),
      onAssetChanged: (event) => callbacksRef.current.onAssetChanged?.(event),
      onManifestChanged: (event) => callbacksRef.current.onManifestChanged?.(event),
      onSnapshotChanged: (snapshot) => callbacksRef.current.onSnapshotChanged?.(snapshot),
      onSelectionChanged: (snapshot) => callbacksRef.current.onSelectionChanged?.(snapshot),
      onDirtyChanged: (snapshot) => callbacksRef.current.onDirtyChanged?.(snapshot),
      onValidationChanged: (snapshot) => callbacksRef.current.onValidationChanged?.(snapshot),
      onColorSchemeChanged: (colorScheme) => callbacksRef.current.onColorSchemeChanged?.(colorScheme),
      onFailed: (e) => callbacksRef.current.onFailed?.(e),
      // A hook returning false falls back to the built-in dialog, same as no
      // hook at all, so the always-present delegate is behavior-preserving.
      onConversionRequested: (action) => callbacksRef.current.onConversionRequested?.(action) ?? false,
      markdownRenderer: renderingRef.current.markdownRenderer,
      markdownExtensions: renderingRef.current.markdownExtensions,
      entryRenderers: composeEntryRenderers(
        renderingRef.current.entryRenderers,
        adapterRef.current!,
        renderingRef.current.renderEntry
      ),
    });
    viewRef.current = view;
    if (firstCreateRef.current) {
      // Initial open is handled by the content effect below.
      firstCreateRef.current = false;
    } else {
      const content = contentRef.current;
      const openOptions = {
        mode: content.mode,
        sourceFormat: content.sourceFormat,
        fileName: content.fileName,
      };
      if (content.workspace) {
        void view.openWorkspace(content.workspace, openOptions);
      } else if (content.bytes) {
        void view.open(content.bytes, openOptions);
      }
    }
    return () => { view.destroy(); viewRef.current = null; };
  }, [
    controls,
    initialLayout,
    initialColorScheme,
    navigationMode,
    navigationButtonActive
  ]);

  useEffect(() => {
    if (viewRef.current && workspace) {
      void viewRef.current.openWorkspace(workspace, { mode, sourceFormat, fileName });
    } else if (viewRef.current && bytes) {
      void viewRef.current.open(bytes, { mode, sourceFormat, fileName });
    }
  }, [bytes, workspace, mode, sourceFormat, fileName]);

  // Rendering config updates apply in place — never a view rebuild. Arrays
  // re-apply only when their name/id key changes; the renderer re-applies on
  // identity change (a cheap preview re-render). The first run is skipped:
  // view creation already received the current values.
  const renderingAppliedRef = useRef(false);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!renderingAppliedRef.current) {
      renderingAppliedRef.current = true;
      return;
    }
    view.setRenderingOptions({
      markdownRenderer: renderingRef.current.markdownRenderer ?? null,
      markdownExtensions: renderingRef.current.markdownExtensions ?? [],
      entryRenderers: composeEntryRenderers(
        renderingRef.current.entryRenderers,
        adapterRef.current!,
        renderingRef.current.renderEntry
      ),
    });
  }, [markdownRenderer, renderingKey]);

  return <div ref={ref} style={{ height: '100%', overflow: 'hidden' }} />;
});
