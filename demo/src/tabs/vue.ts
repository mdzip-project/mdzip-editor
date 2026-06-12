import { createApp, h, ref, shallowRef } from 'vue';
import { MdzipWorkspace, type MdzipWorkspaceExposed } from '@mdzip/editor-vue';
import type { MdzipControlPreset, MdzipWorkspaceSave } from 'mdzip-editor';
import { modeFromControls } from '../tab-controls.js';
import type { TabController } from '../tab-controller.js';

interface TabState {
  bytes: Uint8Array | null;
  fileName: string;
  controls: MdzipControlPreset;
}

export function initVue(
  container: HTMLElement,
  onSaved: (b: Uint8Array, fileName?: string) => void,
  onFailed: (e: unknown) => void
): TabController {
  container.replaceChildren();
  const state = shallowRef<TabState>({
    bytes: null,
    fileName: 'document.mdz',
    controls: 'standalone-editor',
  });
  const workspaceRef = ref<MdzipWorkspaceExposed | null>(null);

  const app = createApp({
    render: () => h(MdzipWorkspace, {
      ref: workspaceRef,
      bytes: state.value.bytes,
      mode: modeFromControls(state.value.controls),
      fileName: state.value.fileName,
      controls: state.value.controls,
      onSaved: (event: MdzipWorkspaceSave) => { onSaved(event.bytes, event.snapshot.fileName); workspaceRef.value?.markPersisted(); },
      onFailed,
    }),
  });

  app.mount(container);

  return {
    update: (bytes, fileName, controls) => {
      state.value = { bytes, fileName, controls };
    },
    markPersisted: () => workspaceRef.value?.markPersisted(),
    destroy: () => app.unmount(),
  };
}
