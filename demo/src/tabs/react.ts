import { createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MdzipWorkspace, type MdzipWorkspaceHandle } from '@mdzip/editor-react';
import type {
  MdzipControlPreset,
  MdzipWorkspaceMode,
  MdzipWorkspaceSave,
} from 'mdzip-editor';
import type { TabController } from '../tab-controller.js';
import { createDemoTabControls } from '../tab-controls.js';

export function initReact(
  container: HTMLElement,
  onSaved: (b: Uint8Array, fileName?: string) => void,
  onFailed: (e: unknown) => void
): TabController {
  container.replaceChildren();
  let currentBytes: Uint8Array | null = null;
  let currentMode: MdzipWorkspaceMode = 'editable';
  let currentControls: MdzipControlPreset = 'standalone-editor';
  let currentFileName = 'document.mdz';
  const workspaceRef = createRef<MdzipWorkspaceHandle>();

  const handleSaved = (event: MdzipWorkspaceSave): void => {
    onSaved(event.bytes, event.snapshot.fileName);
    workspaceRef.current?.markPersisted();
  };

  const handleFailed = (e: unknown): void => {
    onFailed(e);
  };

  function render() {
    root.render(createElement(MdzipWorkspace, {
      ref: workspaceRef,
      bytes: currentBytes,
      mode: currentMode,
      fileName: currentFileName,
      controls: currentControls,
      onSaved: handleSaved,
      onFailed: handleFailed,
    }));
  }

  const tabControls = createDemoTabControls(
    container,
    currentMode,
    currentControls,
    (mode, controls) => {
      currentMode = mode;
      currentControls = controls;
      render();
    }
  );
  const root = createRoot(tabControls.content);
  render();

  return {
    update: (bytes, mode, fileName) => {
      currentBytes = bytes;
      currentMode = mode as MdzipWorkspaceMode;
      currentControls = tabControls.setMode(currentMode);
      currentFileName = fileName;
      render();
    },
    markPersisted: () => workspaceRef.current?.markPersisted(),
    destroy: () => {
      root.unmount();
      tabControls.destroy();
    },
  };
}
