import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MdzipWorkspace } from '@mdzip/editor-react';
import type { MdzipWorkspaceSave } from 'mdzip-editor';
import type { TabController } from '../tab-controller.js';

export function initReact(
  container: HTMLElement,
  onSaved: (b: Uint8Array) => void,
  onFailed: (e: unknown) => void
): TabController {
  let currentBytes: Uint8Array | null = null;
  let currentMode = 'editable';
  let currentFileName = 'document.mdz';

  function render() {
    root.render(createElement(MdzipWorkspace, {
      bytes: currentBytes,
      mode: currentMode as 'editable' | 'read-only',
      fileName: currentFileName,
      controls: 'standalone-editor',
      onSaved: (event: MdzipWorkspaceSave) => onSaved(event.bytes),
      onFailed,
    }));
  }

  const root = createRoot(container);
  render();

  return {
    update: (bytes, mode, fileName) => {
      currentBytes = bytes;
      currentMode = mode;
      currentFileName = fileName;
      render();
    },
    destroy: () => root.unmount(),
  };
}
