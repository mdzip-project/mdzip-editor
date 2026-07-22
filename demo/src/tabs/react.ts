import { createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MdzipWorkspace, type MdzipWorkspaceHandle } from '@mdzip/editor-react';
import { MdzipDiff } from '@mdzip/editor-react/diff-view';
import type { MdzipWorkspaceSave } from 'mdzip-editor';
import { mdzipMermaidExtension } from 'mdzip-editor/mermaid';
import { modeFromControls, type DemoControls, type DemoDensity, type DemoImageInsertOptions } from '../tab-controls.js';
import type { TabController } from '../tab-controller.js';
import { loadDiffBaseBytes } from '../diff-sample.js';

const mermaidExtension = mdzipMermaidExtension();

export function initReact(
  container: HTMLElement,
  onSaved: (b: Uint8Array, fileName?: string) => void,
  onFailed: (e: unknown) => void
): TabController {
  container.replaceChildren();
  let currentBytes: Uint8Array | null = null;
  let currentControls: DemoControls = 'standalone-editor';
  let currentImageInsert: DemoImageInsertOptions = { mode: 'markdown' };
  let currentDensity: DemoDensity = { toolbarDensity: 'comfortable', contentDensity: 'comfortable' };
  let currentFileName = 'document.mdz';
  let diffMode = false;
  let diffBaseBytes: Uint8Array | null = null;
  const workspaceRef = createRef<MdzipWorkspaceHandle>();

  function render(): void {
    if (diffMode) {
      root.render(createElement(MdzipDiff, {
        before: { bytes: diffBaseBytes ?? new Uint8Array(), label: 'sample.mdz' },
        after: { bytes: currentBytes ?? new Uint8Array(), label: currentFileName },
        showUnchanged: true,
        onFailed,
      }));
      return;
    }
    root.render(createElement(MdzipWorkspace, {
      ref: workspaceRef,
      bytes: currentBytes,
      mode: modeFromControls(currentControls),
      fileName: currentFileName,
      controls: currentControls,
      imageHydrationAnimation: 'initial',
      imageInsertMode: currentImageInsert.mode,
      imageInsertHandler: currentImageInsert.handler,
      toolbarDensity: currentDensity.toolbarDensity,
      contentDensity: currentDensity.contentDensity,
      markdownExtensions: [mermaidExtension],
      onSaved: (event: MdzipWorkspaceSave) => { onSaved(event.bytes, event.snapshot.fileName); workspaceRef.current?.markPersisted(); },
      onFailed,
    }));
  }

  const root = createRoot(container);
  render();

  return {
    update: (bytes, fileName, controls, imageInsert, density) => {
      currentBytes = bytes;
      currentFileName = fileName;
      currentControls = controls;
      currentImageInsert = imageInsert;
      currentDensity = density;
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
    setDensity: (density) => {
      currentDensity = density;
      render();
    },
    setDiffMode: (enabled) => {
      if (diffMode === enabled) return;
      diffMode = enabled;
      if (enabled && !diffBaseBytes) {
        void loadDiffBaseBytes().then((bytes) => {
          diffBaseBytes = bytes;
          render();
        }).catch(onFailed);
      }
      render();
    },
    markPersisted: () => workspaceRef.current?.markPersisted(),
    packFilesAsWorkspace: (files, options) =>
      workspaceRef.current?.packFilesAsWorkspace(files, options) ?? Promise.resolve(null),
    destroy: () => root.unmount(),
  };
}
