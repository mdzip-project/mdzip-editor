import { createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MdzipWorkspace, type MdzipWorkspaceHandle } from '@mdzip/editor-react';
import type { MdzipControlPreset, MdzipWorkspaceSave } from 'mdzip-editor';
import { modeFromControls } from '../tab-controls.js';
import type { TabController } from '../tab-controller.js';

export function initReact(
  container: HTMLElement,
  onSaved: (b: Uint8Array, fileName?: string) => void,
  onFailed: (e: unknown) => void
): TabController {
  container.replaceChildren();
  let currentBytes: Uint8Array | null = null;
  let currentControls: MdzipControlPreset = 'standalone-editor';
  let currentFileName = 'document.mdz';
  const workspaceRef = createRef<MdzipWorkspaceHandle>();

  function render() {
    root.render(createElement(MdzipWorkspace, {
      ref: workspaceRef,
      bytes: currentBytes,
      mode: modeFromControls(currentControls),
      fileName: currentFileName,
      controls: currentControls,
      onSaved: (event: MdzipWorkspaceSave) => { onSaved(event.bytes, event.snapshot.fileName); workspaceRef.current?.markPersisted(); },
      onFailed,
    }));
  }

  const root = createRoot(container);
  render();

  return {
    update: (bytes, fileName, controls) => {
      currentBytes = bytes;
      currentFileName = fileName;
      currentControls = controls;
      render();
    },
    markPersisted: () => workspaceRef.current?.markPersisted(),
    destroy: () => root.unmount(),
  };
}
