import { createApp, h, ref, shallowRef } from 'vue';
import { MdzipWorkspace, type MdzipWorkspaceExposed } from '@mdzip/editor-vue';
import type { MdzipWorkspaceSave } from 'mdzip-editor';
import { modeFromControls, type DemoControls, type DemoImageInsertOptions } from '../tab-controls.js';
import type { TabController } from '../tab-controller.js';

interface TabState {
  bytes: Uint8Array | null;
  fileName: string;
  controls: DemoControls;
  imageInsert: DemoImageInsertOptions;
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
    imageInsert: { mode: 'markdown' },
  });
  const workspaceRef = ref<MdzipWorkspaceExposed | null>(null);

  const app = createApp({
    render: () => h(MdzipWorkspace, {
      ref: workspaceRef,
      bytes: state.value.bytes,
      mode: modeFromControls(state.value.controls),
      fileName: state.value.fileName,
      controls: state.value.controls,
      imageHydrationAnimation: 'initial',
      imageInsertMode: state.value.imageInsert.mode,
      imageInsertHandler: state.value.imageInsert.handler,
      onSaved: (event: MdzipWorkspaceSave) => { onSaved(event.bytes, event.snapshot.fileName); workspaceRef.value?.markPersisted(); },
      onFailed,
    }),
  });

  app.mount(container);

  return {
    update: (bytes, fileName, controls, imageInsert) => {
      state.value = { bytes, fileName, controls, imageInsert };
    },
    setControls: (controls) => {
      state.value = { ...state.value, controls };
    },
    setImageInsertOptions: (imageInsert) => {
      state.value = { ...state.value, imageInsert };
    },
    markPersisted: () => workspaceRef.value?.markPersisted(),
    destroy: () => app.unmount(),
  };
}
