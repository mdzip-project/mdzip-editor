import { createApp, h } from 'vue';
import { MdzipWorkspace } from '@mdzip/editor-vue';
import type { MdzipWorkspaceSave } from 'mdzip-editor';
import type { TabController } from '../tab-controller.js';

export function initVue(
  container: HTMLElement,
  onSaved: (b: Uint8Array, fileName?: string) => void,
  onFailed: (e: unknown) => void
): TabController {
  container.replaceChildren();
  let currentBytes: Uint8Array | null = null;
  let currentMode = 'editable';
  let currentFileName = 'document.mdz';

  const handleSaved = (event: MdzipWorkspaceSave): void => {
    onSaved(event.bytes, event.snapshot.fileName);
  };

  const handleFailed = (e: unknown): void => {
    onFailed(e);
  };

  const app = createApp({
    render: () => h(MdzipWorkspace, {
      bytes: currentBytes,
      mode: currentMode,
      fileName: currentFileName,
      controls: 'standalone-editor',
      onSaved: handleSaved,
      onFailed: handleFailed,
    }),
  });

  app.mount(container);

  return {
    update: (bytes, mode, fileName) => {
      currentBytes = bytes;
      currentMode = mode;
      currentFileName = fileName;
      app._instance?.proxy?.$forceUpdate();
    },
    destroy: () => app.unmount(),
  };
}
