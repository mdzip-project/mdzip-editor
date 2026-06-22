import { MdzipWorkspaceView } from 'mdzip-editor';
import { modeFromControls, type DemoControls, type DemoImageInsertOptions } from '../tab-controls.js';
import type { TabController } from '../tab-controller.js';

export function initRaw(
  container: HTMLElement,
  onSaved: (b: Uint8Array, fileName?: string) => void,
  onFailed: (e: unknown) => void
): TabController {
  let currentBytes = new Uint8Array();
  let currentControls: DemoControls = 'standalone-editor';
  let currentImageInsert: DemoImageInsertOptions = { mode: 'markdown' };
  let currentFileName = 'document.mdz';

  const makeView = () => new MdzipWorkspaceView(container, {
    controls: currentControls,
    imageHydrationAnimation: 'initial',
    imageInsertMode: currentImageInsert.mode,
    imageInsertHandler: currentImageInsert.handler,
    onSaved: (bytes, snapshot) => { onSaved(bytes, snapshot.fileName); view.markPersisted(); },
    onFailed,
  });

  let view = makeView();

  function updateView() {
    view.setControls(currentControls);
    view.open(currentBytes, { mode: modeFromControls(currentControls), fileName: currentFileName });
  }

  return {
    update: (bytes, fileName, controls, imageInsert) => {
      currentBytes = bytes;
      currentFileName = fileName;
      currentControls = controls;
      currentImageInsert = imageInsert;
      view.destroy();
      view = makeView();
      updateView();
    },
    setControls: (controls) => {
      currentControls = controls;
      view.setControls(controls);
    },
    setImageInsertOptions: (imageInsert) => {
      currentImageInsert = imageInsert;
      view.setImageInsertOptions({
        imageInsertMode: imageInsert.mode,
        imageInsertHandler: imageInsert.handler,
      });
    },
    markPersisted: () => view.markPersisted(),
    destroy: () => view.destroy(),
  };
}
