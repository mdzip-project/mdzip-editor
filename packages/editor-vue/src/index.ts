import { defineComponent, h, onMounted, onUnmounted, ref, watch, type PropType } from 'vue';
import { MdzipWorkspaceView } from '@mdzip/editor';
import type {
  MdzipControlPolicy,
  MdzipControlPreset,
  MdzipColorScheme,
  MdzipConversionAction,
  MdzipEditorSnapshot,
  MdzipEditorCommand,
  MdzipEntryRenderer,
  MdzipMarkdownRenderExtension,
  MdzipMarkdownRenderer,
  MdzipWorkspaceLayout,
  MdzipWorkspaceMode,
  MdzipNavigationMode,
  MdzipRemoveAssetOptions,
  MdzipSourceFormat,
  MdzWorkspace,
  MdzWorkspaceAsset,
  MdzipWorkspaceSnapshot,
} from '@mdzip/editor';

// Identity-insensitive key for the rendering props: extensions and entry
// renderers are diffed by their stable name/id (and priority), so inline
// array bindings with equivalent contents never trigger an update.
function renderingConfigKey(
  extensions: readonly MdzipMarkdownRenderExtension[],
  entryRenderers: readonly MdzipEntryRenderer[]
): string {
  return JSON.stringify([
    extensions.map((extension) => extension.name),
    entryRenderers.map((renderer) => [renderer.id, renderer.priority ?? 0]),
  ]);
}

export interface MdzipWorkspaceExposed {
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

export const MdzipWorkspace = defineComponent({
  name: 'MdzipWorkspace',
  props: {
    bytes:    { type: Object as PropType<Uint8Array | null>, default: null },
    workspace: { type: Object as PropType<MdzWorkspace | null>, default: null },
    fileName: { type: String, default: 'document.mdz' },
    mode:     { type: String as PropType<MdzipWorkspaceMode>, default: 'read-only' },
    sourceFormat: String as PropType<MdzipSourceFormat>,
    controls: {
      type: [String, Object] as PropType<MdzipControlPreset | MdzipControlPolicy>,
      default: 'viewer'
    },
    initialLayout: String as PropType<MdzipWorkspaceLayout>,
    initialColorScheme: String as PropType<MdzipColorScheme>,
    navigationMode: {
      type: String as PropType<MdzipNavigationMode>,
      default: 'editor'
    },
    navigationButtonActive: { type: Boolean, default: true },
    /**
     * Host hook for the markdown→MDZ conversion flow. A function prop (not an
     * emit) because it must return/resolve `true` to suppress the built-in
     * conversion dialog.
     */
    onConversionRequested: {
      type: Function as PropType<(action: MdzipConversionAction) => boolean | Promise<boolean>>,
      default: undefined
    },
    /**
     * Custom markdown renderer. Keep the reference stable: identity changes
     * apply via a cheap preview re-render, never a workspace rebuild.
     */
    markdownRenderer: {
      type: Object as PropType<MdzipMarkdownRenderer | null>,
      default: null
    },
    /** Markdown pipeline extensions, diffed by `name`. */
    markdownExtensions: {
      type: Array as PropType<readonly MdzipMarkdownRenderExtension[]>,
      default: () => []
    },
    /** Entry renderers, diffed by `id`/`priority`. */
    entryRenderers: {
      type: Array as PropType<readonly MdzipEntryRenderer[]>,
      default: () => []
    },
  },
  emits: [
    'changed',
    'saved',
    'workspaceChanged',
    'documentChanged',
    'assetChanged',
    'manifestChanged',
    'snapshotChanged',
    'selectionChanged',
    'dirtyChanged',
    'validationChanged',
    'colorSchemeChanged',
    'failed'
  ],
  setup(props, { emit, expose }) {
    const hostRef = ref<HTMLElement | null>(null);
    let view: MdzipWorkspaceView | null = null;

    expose({
      canExecuteCommand: (command: MdzipEditorCommand) =>
        view?.canExecuteCommand(command) ?? false,
      executeCommand: (command: MdzipEditorCommand, file?: File) =>
        view?.executeCommand(command, file) ?? Promise.resolve(false),
      convertToMdz: () => view?.convertToMdz() ?? Promise.resolve(false),
      flush: () => view?.flush() ?? Promise.resolve(null),
      serialize: () => view?.serialize() ?? Promise.resolve(null),
      getCurrentSnapshot: () => view?.getCurrentSnapshot() ?? Promise.resolve(null),
      markPersisted: () => view?.markPersisted(),
      addAsset: (archivePath: string, fileBytes: Uint8Array) =>
        view?.addAsset(archivePath, fileBytes) ?? Promise.resolve(),
      replaceAsset: (archivePath: string, fileBytes: Uint8Array) =>
        view?.replaceAsset(archivePath, fileBytes) ?? Promise.resolve(false),
      removeAsset: (archivePath: string, options?: MdzipRemoveAssetOptions) =>
        view?.removeAsset(archivePath, options) ?? Promise.resolve(false),
      removeFile: (archivePath: string) =>
        view?.removeFile(archivePath) ?? Promise.resolve(false),
      renameFile: (oldPath: string, newPath: string) =>
        view?.renameFile(oldPath, newPath) ?? Promise.resolve(false),
      setEntryPoint: (archivePath: string) =>
        view?.setEntryPoint(archivePath) ?? Promise.resolve(false),
      setCoverImage: (archivePath: string | null) =>
        view?.setCoverImage(archivePath) ?? Promise.resolve(false),
      listAssets: () => view?.listAssets() ?? [],
      focus: () => view?.focus()
    } satisfies MdzipWorkspaceExposed);

    const createView = (): void => {
      if (!hostRef.value) return;
      view?.destroy();
      view = new MdzipWorkspaceView(hostRef.value, {
        controls: props.controls,
        initialLayout: props.initialLayout,
        initialColorScheme: props.initialColorScheme,
        navigationMode: props.navigationMode,
        navigationButtonActive: props.navigationButtonActive,
        onChanged: (bytes, snapshot) => emit('changed', { bytes, snapshot }),
        onSaved: (bytes, snapshot) => emit('saved', { bytes, snapshot }),
        onWorkspaceChanged: (event) => emit('workspaceChanged', event),
        onDocumentChanged: (event) => emit('documentChanged', event),
        onAssetChanged: (event) => emit('assetChanged', event),
        onManifestChanged: (event) => emit('manifestChanged', event),
        onSnapshotChanged: (snapshot: MdzipWorkspaceSnapshot) => emit('snapshotChanged', snapshot),
        onSelectionChanged: (snapshot: MdzipWorkspaceSnapshot) => emit('selectionChanged', snapshot),
        onDirtyChanged: (snapshot: MdzipWorkspaceSnapshot) => emit('dirtyChanged', snapshot),
        onValidationChanged: (snapshot: MdzipWorkspaceSnapshot) => emit('validationChanged', snapshot),
        onColorSchemeChanged: (colorScheme: MdzipColorScheme) => emit('colorSchemeChanged', colorScheme),
        onFailed: (e: unknown) => emit('failed', e),
        onConversionRequested: props.onConversionRequested,
        markdownRenderer: props.markdownRenderer ?? undefined,
        markdownExtensions: props.markdownExtensions,
        entryRenderers: props.entryRenderers,
      });
      if (props.workspace) {
        void view.openWorkspace(props.workspace, {
          mode: props.mode,
          sourceFormat: props.sourceFormat,
          fileName: props.fileName
        });
      } else if (props.bytes) {
        void view.open(props.bytes, {
          mode: props.mode,
          sourceFormat: props.sourceFormat,
          fileName: props.fileName
        });
      }
    };

    onMounted(() => {
      createView();
    });

    watch(
      [() => props.bytes, () => props.workspace, () => props.mode, () => props.sourceFormat, () => props.fileName],
      ([bytes, workspace, mode, sourceFormat, fileName]) => {
        if (view && workspace) {
          void view.openWorkspace(workspace as MdzWorkspace, {
            mode: mode as MdzipWorkspaceMode,
            sourceFormat: sourceFormat as MdzipSourceFormat | undefined,
            fileName: fileName as string,
          });
        } else if (view && bytes) {
          void view.open(bytes as Uint8Array, {
            mode: mode as MdzipWorkspaceMode,
            sourceFormat: sourceFormat as MdzipSourceFormat | undefined,
            fileName: fileName as string,
          });
        }
      }
    );

    watch([
      () => props.controls,
      () => props.initialLayout,
      () => props.initialColorScheme,
      () => props.navigationMode,
      () => props.navigationButtonActive
    ], () => {
      createView();
    }, { immediate: false });

    // Rendering config updates apply in place — never a view rebuild. Arrays
    // re-apply only when their name/id key changes; the renderer re-applies
    // on identity change (a cheap preview re-render).
    watch(
      () => [
        props.markdownRenderer,
        renderingConfigKey(props.markdownExtensions, props.entryRenderers)
      ] as const,
      ([renderer, key], previous) => {
        if (previous && renderer === previous[0] && key === previous[1]) {
          return;
        }
        view?.setRenderingOptions({
          markdownRenderer: renderer ?? null,
          markdownExtensions: props.markdownExtensions,
          entryRenderers: props.entryRenderers,
        });
      }
    );

    onUnmounted(() => { view?.destroy(); view = null; });

    return () => h('div', { ref: hostRef, style: 'height:100%;overflow:hidden' });
  },
});
