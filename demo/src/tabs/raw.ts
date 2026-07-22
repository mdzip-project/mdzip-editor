import { MdzipWorkspaceView } from 'mdzip-editor';
import { MdzipDiffView } from 'mdzip-editor/diff-view';
import { mdzipMermaidExtension } from 'mdzip-editor/mermaid';
import { modeFromControls, type DemoControls, type DemoDensity, type DemoImageInsertOptions } from '../tab-controls.js';
import type { TabController } from '../tab-controller.js';
import { loadDiffBaseBytes } from '../diff-sample.js';

const mermaidExtension = mdzipMermaidExtension();

export function initRaw(
  container: HTMLElement,
  onSaved: (b: Uint8Array, fileName?: string) => void,
  onFailed: (e: unknown) => void
): TabController {
  let currentBytes = new Uint8Array();
  let currentControls: DemoControls = 'standalone-editor';
  let currentImageInsert: DemoImageInsertOptions = { mode: 'markdown' };
  let currentDensity: DemoDensity = { toolbarDensity: 'comfortable', contentDensity: 'comfortable' };
  let currentFileName = 'document.mdz';
  let diffMode = false;

  let workspaceView: MdzipWorkspaceView | null = null;
  let diffView: MdzipDiffView | null = null;

  function renderWorkspace(): void {
    container.replaceChildren();
    workspaceView = new MdzipWorkspaceView(container, {
      controls: currentControls,
      imageHydrationAnimation: 'initial',
      imageInsertMode: currentImageInsert.mode,
      imageInsertHandler: currentImageInsert.handler,
      toolbarDensity: currentDensity.toolbarDensity,
      contentDensity: currentDensity.contentDensity,
      markdownExtensions: [mermaidExtension],
      onSaved: (bytes, snapshot) => { onSaved(bytes, snapshot.fileName); workspaceView?.markPersisted(); },
      onFailed,
    });
    workspaceView.open(currentBytes, { mode: modeFromControls(currentControls), fileName: currentFileName });
  }

  async function renderDiff(): Promise<void> {
    const baseBytes = await loadDiffBaseBytes();
    if (!diffMode) return;
    container.replaceChildren();
    diffView = new MdzipDiffView(container, {
      before: { bytes: baseBytes, label: 'sample.mdz' },
      after: { bytes: currentBytes, label: currentFileName },
      showUnchanged: true,
      onFailed,
    });
  }

  function destroyActive(): void {
    workspaceView?.destroy();
    workspaceView = null;
    diffView?.destroy();
    diffView = null;
  }

  function render(): void {
    destroyActive();
    if (diffMode) void renderDiff();
    else renderWorkspace();
  }

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
      if (!diffMode) workspaceView?.setControls(controls);
    },
    setImageInsertOptions: (imageInsert) => {
      currentImageInsert = imageInsert;
      if (!diffMode) {
        workspaceView?.setImageInsertOptions({
          imageInsertMode: imageInsert.mode,
          imageInsertHandler: imageInsert.handler,
        });
      }
    },
    setDensity: (density) => {
      currentDensity = density;
      if (!diffMode) workspaceView?.setDensityOptions(density);
    },
    setDiffMode: (enabled) => {
      if (diffMode === enabled) return;
      diffMode = enabled;
      render();
    },
    markPersisted: () => workspaceView?.markPersisted(),
    packFilesAsWorkspace: (files, options) =>
      workspaceView?.packFilesAsWorkspace(files, options) ?? Promise.resolve(null),
    destroy: () => destroyActive(),
  };
}
