import {
  Comment,
  Fragment,
  Text,
  defineComponent,
  getCurrentInstance,
  h,
  onMounted,
  onUnmounted,
  ref,
  render,
  shallowRef,
  watch,
  type PropType,
  type Slot,
  type VNode,
  type VNodeArrayChildren,
} from 'vue';
import { MdzipWorkspaceView } from '@mdzip/editor';
import { PACKAGE_INFO } from './package-info.js';
import type {
  MdzipControlPolicy,
  MdzipControlPreset,
  MdzipContentDensity,
  MdzipColorScheme,
  MdzipConversionAction,
  MdzipConversionContext,
  MdzipEditorSnapshot,
  MdzipEditorCommand,
  MdzipEntryRenderContext,
  MdzipEntryRenderer,
  MdzipMarkdownRenderExtension,
  MdzipMarkdownRenderer,
  MdzipImageHydrationAnimation,
  MdzipImageInsertHandler,
  MdzipImageInsertMode,
  MdzipWorkspaceLayout,
  MdzipWorkspaceMode,
  MdzipNavigationMode,
  MdzipRemoveAssetOptions,
  MdzipSourceFormat,
  MdzipToolbarDensity,
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

// A slot whose `v-if` evaluated false renders only comments/empty text; that
// counts as "no content" and delegates to the next renderer or the built-in.
function hasRenderableContent(nodes: unknown): boolean {
  if (nodes === null || nodes === undefined || typeof nodes === 'boolean') {
    return false;
  }
  if (Array.isArray(nodes)) {
    return (nodes as VNodeArrayChildren).some((node) => hasRenderableContent(node));
  }
  if (typeof nodes === 'string') {
    return nodes.trim().length > 0;
  }
  if (typeof nodes === 'number') {
    return true;
  }
  const vnode = nodes as VNode;
  if (vnode.type === Comment) {
    return false;
  }
  if (vnode.type === Text) {
    return typeof vnode.children === 'string' ? vnode.children.trim().length > 0 : true;
  }
  if (vnode.type === Fragment) {
    return hasRenderableContent(vnode.children);
  }
  return true;
}

export interface MdzipWorkspaceExposed {
  canExecuteCommand(command: MdzipEditorCommand): boolean;
  executeCommand(command: MdzipEditorCommand, file?: File): Promise<boolean>;
  convertToMdz(): Promise<boolean>;
  flush(): Promise<MdzipEditorSnapshot | null>;
  serialize(): Promise<Blob | null>;
  getCurrentSnapshot(): Promise<MdzipEditorSnapshot | null>;
  whenRendered(): Promise<void>;
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
    toolbarDensity: String as PropType<MdzipToolbarDensity>,
    contentDensity: String as PropType<MdzipContentDensity>,
    imageHydrationAnimation: String as PropType<MdzipImageHydrationAnimation>,
    imageInsertMode: String as PropType<MdzipImageInsertMode>,
    imageInsertHandler: Function as PropType<MdzipImageInsertHandler>,
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
      type: Function as PropType<(
        action: MdzipConversionAction,
        context: MdzipConversionContext
      ) => boolean | Promise<boolean>>,
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
    /** Matching priority of the `#entry` slot relative to `entryRenderers`. */
    entrySlotPriority: { type: Number, default: 0 },
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
    'previewRendered',
    'assetsHydrated',
    'failed'
  ],
  setup(props, { emit, expose, slots }) {
    const hostRef = ref<HTMLElement | null>(null);
    let view: MdzipWorkspaceView | null = null;
    const appContext = getCurrentInstance()?.appContext ?? null;

    // Adapts the #entry scoped slot onto the framework-independent
    // MdzipEntryRenderer contract. The slot renders inside a detached inner
    // component whose render effect tracks the slot's reactive dependencies,
    // so reactive parent state stays live; the context itself is a
    // shallowRef updated by the core's update() calls. A slot that renders
    // no content (e.g. its v-if is false) delegates to the next renderer.
    const slotContext = shallowRef<MdzipEntryRenderContext | null>(null);
    const EntrySlotHost = defineComponent({
      name: 'MdzipEntrySlotHost',
      setup: () => () => {
        const slot = slots['entry'] as Slot | undefined;
        const context = slotContext.value;
        return slot && context ? slot({ context }) : null;
      }
    });
    const entrySlotAdapter: MdzipEntryRenderer = {
      id: 'mdzip-vue-entry-slot',
      get priority() {
        return props.entrySlotPriority;
      },
      matches: (context) => {
        const slot = slots['entry'] as Slot | undefined;
        return slot ? hasRenderableContent(slot({ context })) : false;
      },
      mount: (container, context) => {
        slotContext.value = context;
        const vnode = h(EntrySlotHost);
        if (appContext) {
          vnode.appContext = appContext;
        }
        render(vnode, container);
        return {
          update: (next) => {
            slotContext.value = next;
          },
          destroy: () => {
            render(null, container);
            slotContext.value = null;
          }
        };
      }
    };

    // Stable sort in the core keeps explicit renderers ahead of the slot
    // catch-all at equal priority.
    const composedEntryRenderers = (): readonly MdzipEntryRenderer[] =>
      slots['entry'] ? [...props.entryRenderers, entrySlotAdapter] : props.entryRenderers;

    expose({
      canExecuteCommand: (command: MdzipEditorCommand) =>
        view?.canExecuteCommand(command) ?? false,
      executeCommand: (command: MdzipEditorCommand, file?: File) =>
        view?.executeCommand(command, file) ?? Promise.resolve(false),
      convertToMdz: () => view?.convertToMdz() ?? Promise.resolve(false),
      flush: () => view?.flush() ?? Promise.resolve(null),
      serialize: () => view?.serialize() ?? Promise.resolve(null),
      getCurrentSnapshot: () => view?.getCurrentSnapshot() ?? Promise.resolve(null),
      whenRendered: () => view?.whenRendered() ?? Promise.resolve(),
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
        libraries: [PACKAGE_INFO],
        controls: props.controls,
        toolbarDensity: props.toolbarDensity,
        contentDensity: props.contentDensity,
        imageHydrationAnimation: props.imageHydrationAnimation,
        imageInsertMode: props.imageInsertMode,
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
        onPreviewRendered: (snapshot: MdzipWorkspaceSnapshot) => emit('previewRendered', snapshot),
        onAssetsHydrated: (snapshot: MdzipWorkspaceSnapshot) => emit('assetsHydrated', snapshot),
        onFailed: (e: unknown) => emit('failed', e),
        onConversionRequested: props.onConversionRequested,
        imageInsertHandler: (request) => props.imageInsertHandler?.(request),
        markdownRenderer: props.markdownRenderer ?? undefined,
        markdownExtensions: props.markdownExtensions,
        entryRenderers: composedEntryRenderers(),
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
      () => props.initialLayout,
      () => props.initialColorScheme,
      () => props.navigationMode,
      () => props.navigationButtonActive
    ], () => {
      createView();
    }, { immediate: false });

    watch(() => props.controls, (controls) => {
      view?.setControls(controls);
    });

    watch([() => props.toolbarDensity, () => props.contentDensity], ([toolbarDensity, contentDensity]) => {
      view?.setDensityOptions({ toolbarDensity, contentDensity });
    });

    watch(() => props.imageHydrationAnimation, (animation) => {
      view?.setImageHydrationAnimation(animation);
    });

    watch([() => props.imageInsertMode, () => props.imageInsertHandler], ([mode]) => {
      view?.setImageInsertOptions({
        imageInsertMode: mode,
        imageInsertHandler: (request) => props.imageInsertHandler?.(request),
      });
    });

    // Rendering config updates apply in place — never a view rebuild. Arrays
    // re-apply only when their name/id key changes; the renderer re-applies
    // on identity change (a cheap preview re-render).
    watch(
      () => [
        props.markdownRenderer,
        renderingConfigKey(props.markdownExtensions, composedEntryRenderers())
      ] as const,
      ([renderer, key], previous) => {
        if (previous && renderer === previous[0] && key === previous[1]) {
          return;
        }
        view?.setRenderingOptions({
          markdownRenderer: renderer ?? null,
          markdownExtensions: props.markdownExtensions,
          entryRenderers: composedEntryRenderers(),
        });
      }
    );

    onUnmounted(() => { view?.destroy(); view = null; });

    return () => h('div', { ref: hostRef, style: 'height:100%;overflow:hidden' });
  },
});
