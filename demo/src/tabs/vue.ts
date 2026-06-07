import { createApp, h, ref } from 'vue';
import { MdzipWorkspace, type MdzipWorkspaceExposed } from '@mdzip/editor-vue';
import type {
  MdzipControlPreset,
  MdzipWorkspaceMode,
  MdzipWorkspaceSave,
} from 'mdzip-editor';
import type { TabController } from '../tab-controller.js';
import { createDemoTabControls } from '../tab-controls.js';

export function initVue(
  container: HTMLElement,
  onSaved: (b: Uint8Array, fileName?: string) => void,
  onFailed: (e: unknown) => void
): TabController {
  container.replaceChildren();
  let currentBytes: Uint8Array | null = null;
  let currentMode: MdzipWorkspaceMode = 'editable';
  let currentControls: MdzipControlPreset = 'standalone-editor';
  let currentFileName = 'document.mdz';
  const workspaceRef = ref<MdzipWorkspaceExposed | null>(null);

  const handleSaved = (event: MdzipWorkspaceSave): void => {
    onSaved(event.bytes, event.snapshot.fileName);
    workspaceRef.value?.markPersisted();
  };

  const handleFailed = (e: unknown): void => {
    onFailed(e);
  };

  const app = createApp({
    render: () => h(MdzipWorkspace, {
      ref: workspaceRef,
      bytes: currentBytes,
      mode: currentMode,
      fileName: currentFileName,
      controls: currentControls,
      onSaved: handleSaved,
      onFailed: handleFailed,
    }),
  });

  const tabControls = createDemoTabControls(
    container,
    currentMode,
    currentControls,
    (mode, controls) => {
      currentMode = mode;
      currentControls = controls;
      app._instance?.proxy?.$forceUpdate();
    }
  );
  app.mount(tabControls.content);

  return {
    update: (bytes, mode, fileName) => {
      currentBytes = bytes;
      currentMode = mode as MdzipWorkspaceMode;
      currentControls = tabControls.setMode(currentMode);
      currentFileName = fileName;
      app._instance?.proxy?.$forceUpdate();
    },
    markPersisted: () => workspaceRef.value?.markPersisted(),
    destroy: () => {
      app.unmount();
      tabControls.destroy();
    },
  };
}
