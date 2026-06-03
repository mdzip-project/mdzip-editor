import { MdzipWorkspaceView } from '@mdzip/editor';
import type { TabController } from '../tab-controller.js';

export function initRaw(
  container: HTMLElement,
  onSaved: (b: Uint8Array) => void,
  onFailed: (e: unknown) => void
): TabController {
  const view = new MdzipWorkspaceView(container, { onSaved, onFailed });
  return {
    update: (bytes, mode, fileName) => view.open(bytes, { mode, fileName }),
    destroy: () => view.destroy(),
  };
}
