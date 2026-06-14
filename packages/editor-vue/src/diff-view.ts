import {
  defineComponent,
  h,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type PropType
} from 'vue';
import {
  MdzipDiffView,
  type MdzipDiffSelectionEvent,
  type MdzipDiffSideInput,
  type MdzipDiffToolbarAction
} from '@mdzip/editor/diff-view';

export interface MdzipDiffExposed {
  openPath(path: string): Promise<boolean>;
  setShowUnchanged(show: boolean): void;
  setNavigationVisible(visible: boolean): void;
  setToolbarActions(actions: readonly MdzipDiffToolbarAction[]): void;
}

export const MdzipDiff = defineComponent({
  name: 'MdzipDiff',
  props: {
    before: { type: Object as PropType<MdzipDiffSideInput>, required: true },
    after: { type: Object as PropType<MdzipDiffSideInput>, required: true },
    initialPath: String,
    showUnchanged: { type: Boolean, default: true },
    navigationVisible: { type: Boolean, default: true },
    toolbarActions: { type: Array as PropType<readonly MdzipDiffToolbarAction[]>, default: () => [] }
  },
  emits: {
    selectionChanged: (_event: MdzipDiffSelectionEvent) => true,
    failed: (_error: Error) => true
  },
  setup(props, { emit, expose }) {
    const hostRef = ref<HTMLElement | null>(null);
    let view: MdzipDiffView | null = null;

    const options = () => ({
      before: props.before,
      after: props.after,
      initialPath: props.initialPath,
      showUnchanged: props.showUnchanged,
      navigationVisible: props.navigationVisible,
      toolbarActions: props.toolbarActions,
      onSelectionChanged: (event: MdzipDiffSelectionEvent) => emit('selectionChanged', event),
      onFailed: (error: Error) => emit('failed', error)
    });

    expose({
      openPath: (path: string) => view?.openPath(path) ?? Promise.resolve(false),
      setShowUnchanged: (show: boolean) => view?.setShowUnchanged(show),
      setNavigationVisible: (visible: boolean) => view?.setNavigationVisible(visible),
      setToolbarActions: (actions: readonly MdzipDiffToolbarAction[]) => view?.setToolbarActions(actions)
    } satisfies MdzipDiffExposed);

    onMounted(() => {
      if (!hostRef.value) return;
      view = new MdzipDiffView(hostRef.value, options());
    });

    watch(
      [
        () => props.before,
        () => props.after,
        () => props.initialPath
      ],
      () => { if (view) void view.open(options()); }
    );
    watch(() => props.showUnchanged, (show) => view?.setShowUnchanged(show));
    watch(() => props.navigationVisible, (visible) => view?.setNavigationVisible(visible));
    watch(() => props.toolbarActions, (actions) => view?.setToolbarActions(actions));

    onUnmounted(() => {
      view?.destroy();
      view = null;
    });

    return () => h('div', { ref: hostRef, style: 'height:100%;overflow:hidden' });
  }
});
