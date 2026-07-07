import { createApp, h, ref, shallowRef } from 'vue';
import { MdzipWorkspace, type MdzipWorkspaceExposed } from '@mdzip/editor-vue';
import { MdzipDiff } from '@mdzip/editor-vue/diff-view';
import type { MdzipWorkspaceSave } from 'mdzip-editor';
import { mdzipMermaidExtension } from 'mdzip-editor/mermaid';
import { modeFromControls, type DemoControls, type DemoImageInsertOptions } from '../tab-controls.js';
import type { TabController } from '../tab-controller.js';
import { loadDiffBaseBytes } from '../diff-sample.js';

const mermaidExtension = mdzipMermaidExtension();

interface TabState {
  bytes: Uint8Array | null;
  fileName: string;
  controls: DemoControls;
  imageInsert: DemoImageInsertOptions;
  diffMode: boolean;
  diffBaseBytes: Uint8Array | null;
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
    diffMode: false,
    diffBaseBytes: null,
  });
  const workspaceRef = ref<MdzipWorkspaceExposed | null>(null);

  const app = createApp({
    render: () => {
      if (state.value.diffMode) {
        return h(MdzipDiff, {
          before: { bytes: state.value.diffBaseBytes ?? new Uint8Array(), label: 'sample.mdz' },
          after: { bytes: state.value.bytes ?? new Uint8Array(), label: state.value.fileName },
          showUnchanged: true,
          onFailed,
        });
      }
      return h(MdzipWorkspace, {
        ref: workspaceRef,
        bytes: state.value.bytes,
        mode: modeFromControls(state.value.controls),
        fileName: state.value.fileName,
        controls: state.value.controls,
        imageHydrationAnimation: 'initial',
        imageInsertMode: state.value.imageInsert.mode,
        imageInsertHandler: state.value.imageInsert.handler,
        markdownExtensions: [mermaidExtension],
        onSaved: (event: MdzipWorkspaceSave) => { onSaved(event.bytes, event.snapshot.fileName); workspaceRef.value?.markPersisted(); },
        onFailed,
      });
    },
  });

  app.mount(container);

  return {
    update: (bytes, fileName, controls, imageInsert) => {
      state.value = { ...state.value, bytes, fileName, controls, imageInsert };
    },
    setControls: (controls) => {
      state.value = { ...state.value, controls };
    },
    setImageInsertOptions: (imageInsert) => {
      state.value = { ...state.value, imageInsert };
    },
    setDiffMode: (enabled) => {
      if (state.value.diffMode === enabled) return;
      state.value = { ...state.value, diffMode: enabled };
      if (enabled && !state.value.diffBaseBytes) {
        void loadDiffBaseBytes().then((bytes) => {
          state.value = { ...state.value, diffBaseBytes: bytes };
        }).catch(onFailed);
      }
    },
    markPersisted: () => workspaceRef.value?.markPersisted(),
    destroy: () => app.unmount(),
  };
}
