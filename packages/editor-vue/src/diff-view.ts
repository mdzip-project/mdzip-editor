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
  type MdzipDiffSideInput
} from '@mdzip/editor/diff-view';

export interface MdzipDiffExposed {
  openPath(path: string): Promise<boolean>;
  setShowUnchanged(show: boolean): void;
  setNavigationVisible(visible: boolean): void;
}

export const MdzipDiff = defineComponent({
  name: 'MdzipDiff',
  props: {
    before: { type: Object as PropType<MdzipDiffSideInput>, required: true },
    after: { type: Object as PropType<MdzipDiffSideInput>, required: true },
    initialPath: String,
    showUnchanged: { type: Boolean, default: true },
    navigationVisible: { type: Boolean, default: true }
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
      onSelectionChanged: (event: MdzipDiffSelectionEvent) => emit('selectionChanged', event),
      onFailed: (error: Error) => emit('failed', error)
    });

    expose({
      openPath: (path: string) => view?.openPath(path) ?? Promise.resolve(false),
      setShowUnchanged: (show: boolean) => view?.setShowUnchanged(show),
      setNavigationVisible: (visible: boolean) => view?.setNavigationVisible(visible)
    } satisfies MdzipDiffExposed);

    onMounted(() => {
      if (!hostRef.value) return;
      view = new MdzipDiffView(hostRef.value, options());
    });

    watch(
      [
        () => props.before,
        () => props.after,
        () => props.initialPath,
        () => props.showUnchanged,
        () => props.navigationVisible
      ],
      () => { if (view) void view.open(options()); }
    );

    onUnmounted(() => {
      view?.destroy();
      view = null;
    });

    return () => h('div', { ref: hostRef, style: 'height:100%;overflow:hidden' });
  }
});
