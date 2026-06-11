import { createApp, h, ref } from 'vue';
import { MdzipWorkspace, type MdzipWorkspaceExposed } from '@mdzip/editor-vue';
import type { MdzipControlPreset, MdzipWorkspaceSave } from 'mdzip-editor';
import { modeFromControls } from '../tab-controls.js';
import type { TabController } from '../tab-controller.js';

export function initVue(
  container: HTMLElement,
  onSaved: (b: Uint8Array, fileName?: string) => void,
  onFailed: (e: unknown) => void
): TabController {
  container.replaceChildren();
  let currentBytes: Uint8Array | null = null;
  let currentControls: MdzipControlPreset = 'standalone-editor';
  let currentFileName = 'document.mdz';
  const workspaceRef = ref<MdzipWorkspaceExposed | null>(null);

  const app = createApp({
    render: () => h(MdzipWorkspace, {
      ref: workspaceRef,
      bytes: currentBytes,
      mode: modeFromControls(currentControls),
      fileName: currentFileName,
      controls: currentControls,
      onSaved: (event: MdzipWorkspaceSave) => { onSaved(event.bytes, event.snapshot.fileName); workspaceRef.value?.markPersisted(); },
      onFailed,
    }),
  });

  app.mount(container);

  return {
    update: (bytes, fileName, controls) => {
      currentBytes = bytes;
      currentFileName = fileName;
      currentControls = controls;
      app._instance?.proxy?.$forceUpdate();
    },
    markPersisted: () => workspaceRef.value?.markPersisted(),
    destroy: () => app.unmount(),
  };
}
