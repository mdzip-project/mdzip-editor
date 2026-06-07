import { defineComponent, h, onMounted, onUnmounted, ref, watch, type PropType } from 'vue';
import { MdzipWorkspaceView } from 'mdzip-editor';
import type {
  MdzipControlPolicy,
  MdzipControlPreset,
  MdzipColorScheme,
  MdzipEditorSnapshot,
  MdzipEditorCommand,
  MdzipWorkspaceLayout,
  MdzipWorkspaceMode,
  MdzipNavigationMode,
  MdzipRemoveAssetOptions,
  MdzipSourceFormat,
  MdzWorkspace,
  MdzWorkspaceAsset,
} from 'mdzip-editor';

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
        onSnapshotChanged: (snapshot) => emit('snapshotChanged', snapshot),
        onSelectionChanged: (snapshot) => emit('selectionChanged', snapshot),
        onDirtyChanged: (snapshot) => emit('dirtyChanged', snapshot),
        onValidationChanged: (snapshot) => emit('validationChanged', snapshot),
        onColorSchemeChanged: (colorScheme) => emit('colorSchemeChanged', colorScheme),
        onFailed: (e) => emit('failed', e),
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

    onUnmounted(() => { view?.destroy(); view = null; });

    return () => h('div', { ref: hostRef, style: 'height:100%;overflow:hidden' });
  },
});
