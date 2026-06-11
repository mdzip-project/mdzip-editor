import { MdzipWorkspaceView, type MdzipControlPreset } from 'mdzip-editor';
import { modeFromControls } from '../tab-controls.js';
import type { TabController } from '../tab-controller.js';

export function initRaw(
  container: HTMLElement,
  onSaved: (b: Uint8Array, fileName?: string) => void,
  onFailed: (e: unknown) => void
): TabController {
  let currentBytes = new Uint8Array();
  let currentControls: MdzipControlPreset = 'standalone-editor';
  let currentFileName = 'document.mdz';

  const makeView = () => new MdzipWorkspaceView(container, {
    controls: currentControls,
    onSaved: (bytes, snapshot) => { onSaved(bytes, snapshot.fileName); view.markPersisted(); },
    onFailed,
  });

  let view = makeView();
  let lastControls = currentControls;

  function updateView() {
    if (lastControls !== currentControls) {
      view.destroy();
      view = makeView();
      lastControls = currentControls;
    }
    view.open(currentBytes, { mode: modeFromControls(currentControls), fileName: currentFileName });
  }

  return {
    update: (bytes, fileName, controls) => {
      currentBytes = bytes;
      currentFileName = fileName;
      currentControls = controls;
      updateView();
    },
    markPersisted: () => view.markPersisted(),
    destroy: () => view.destroy(),
  };
}
