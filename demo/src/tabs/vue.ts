import { createApp, h } from 'vue';
import { MdzipWorkspace } from '@mdzip/editor-vue';
import type { TabController } from '../tab-controller.js';

export function initVue(
  container: HTMLElement,
  onSaved: (b: Uint8Array) => void,
  onFailed: (e: unknown) => void
): TabController {
  let currentBytes: Uint8Array | null = null;
  let currentMode = 'editable';
  let currentFileName = 'document.mdz';

  const app = createApp({
    render: () => h(MdzipWorkspace, {
      bytes: currentBytes,
      mode: currentMode,
      fileName: currentFileName,
      onSaved,
      onFailed,
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
