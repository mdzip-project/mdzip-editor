import { defineComponent, h, onMounted, onUnmounted, ref, watch, type PropType } from 'vue';
import { MdzipWorkspaceView } from '@mdzip/editor';
import type { MdzipWorkspaceMode } from '@mdzip/editor';

export const MdzipWorkspace = defineComponent({
  name: 'MdzipWorkspace',
  props: {
    bytes:    { type: Object as PropType<Uint8Array | null>, default: null },
    fileName: { type: String, default: 'document.mdz' },
    mode:     { type: String as PropType<MdzipWorkspaceMode>, default: 'read-only' },
    onSaved:  { type: Function as PropType<(b: Uint8Array) => void> },
    onFailed: { type: Function as PropType<(e: unknown) => void> },
  },
  setup(props) {
    const hostRef = ref<HTMLElement | null>(null);
    let view: MdzipWorkspaceView | null = null;

    onMounted(() => {
      if (!hostRef.value) return;
      view = new MdzipWorkspaceView(hostRef.value, {
        onSaved: (b) => props.onSaved?.(b),
        onFailed: (e) => props.onFailed?.(e),
      });
      if (props.bytes) {
        void view.open(props.bytes, { mode: props.mode, fileName: props.fileName });
      }
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

    onUnmounted(() => { view?.destroy(); view = null; });

    return () => h('div', { ref: hostRef, style: 'height:100%;overflow:hidden' });
  },
});
