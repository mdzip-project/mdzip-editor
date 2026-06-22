import { createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MdzipWorkspace, type MdzipWorkspaceHandle } from '@mdzip/editor-react';
import type { MdzipWorkspaceSave } from 'mdzip-editor';
import { modeFromControls, type DemoControls, type DemoImageInsertOptions } from '../tab-controls.js';
import type { TabController } from '../tab-controller.js';

export function initReact(
  container: HTMLElement,
  onSaved: (b: Uint8Array, fileName?: string) => void,
  onFailed: (e: unknown) => void
): TabController {
  container.replaceChildren();
  let currentBytes: Uint8Array | null = null;
  let currentControls: DemoControls = 'standalone-editor';
  let currentImageInsert: DemoImageInsertOptions = { mode: 'markdown' };
  let currentFileName = 'document.mdz';
  const workspaceRef = createRef<MdzipWorkspaceHandle>();

  function render() {
    root.render(createElement(MdzipWorkspace, {
      ref: workspaceRef,
      bytes: currentBytes,
      mode: modeFromControls(currentControls),
      fileName: currentFileName,
      controls: currentControls,
      imageHydrationAnimation: 'initial',
      imageInsertMode: currentImageInsert.mode,
      imageInsertHandler: currentImageInsert.handler,
      onSaved: (event: MdzipWorkspaceSave) => { onSaved(event.bytes, event.snapshot.fileName); workspaceRef.current?.markPersisted(); },
      onFailed,
    }));
  }

  const root = createRoot(container);
  render();

  return {
    update: (bytes, fileName, controls, imageInsert) => {
      currentBytes = bytes;
      currentFileName = fileName;
      currentControls = controls;
      currentImageInsert = imageInsert;
      render();
    },
    setControls: (controls) => {
      currentControls = controls;
      render();
    },
    setImageInsertOptions: (imageInsert) => {
      currentImageInsert = imageInsert;
      render();
    },
    markPersisted: () => workspaceRef.current?.markPersisted(),
    destroy: () => root.unmount(),
  };
}
