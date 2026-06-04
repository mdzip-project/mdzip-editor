import { defineComponent, h, onMounted, onUnmounted, ref, watch, type PropType } from 'vue';
import { MdzipWorkspaceView } from 'mdzip-editor';
import type {
  MdzipControlPolicy,
  MdzipControlPreset,
  MdzipWorkspaceLayout,
  MdzipWorkspaceMode,
} from 'mdzip-editor';

export const MdzipWorkspace = defineComponent({
  name: 'MdzipWorkspace',
  props: {
    bytes:    { type: Object as PropType<Uint8Array | null>, default: null },
    fileName: { type: String, default: 'document.mdz' },
    mode:     { type: String as PropType<MdzipWorkspaceMode>, default: 'read-only' },
    controls: {
      type: [String, Object] as PropType<MdzipControlPreset | MdzipControlPolicy>,
      default: 'viewer'
    },
    initialLayout: String as PropType<MdzipWorkspaceLayout>,
  },
  emits: ['changed', 'saved', 'failed'],
  setup(props, { emit }) {
    const hostRef = ref<HTMLElement | null>(null);
    let view: MdzipWorkspaceView | null = null;

    const createView = (): void => {
      if (!hostRef.value) return;
      view?.destroy();
      view = new MdzipWorkspaceView(hostRef.value, {
        controls: props.controls,
        initialLayout: props.initialLayout,
        onChanged: (bytes, snapshot) => emit('changed', { bytes, snapshot }),
        onSaved: (bytes, snapshot) => emit('saved', { bytes, snapshot }),
        onFailed: (e) => emit('failed', e),
      });
      if (props.bytes) {
        void view.open(props.bytes, { mode: props.mode, fileName: props.fileName });
      }
    };

    onMounted(() => {
      createView();
    });

    watch(
      [() => props.bytes, () => props.mode, () => props.fileName],
      ([bytes, mode, fileName]) => {
        if (view && bytes) {
          void view.open(bytes as Uint8Array, {
            mode: mode as MdzipWorkspaceMode,
            fileName: fileName as string,
          });
        }
      }
    );

    watch([() => props.controls, () => props.initialLayout], () => {
      createView();
    });

    onUnmounted(() => { view?.destroy(); view = null; });

    return () => h('div', { ref: hostRef, style: 'height:100%;overflow:hidden' });
  },
});
