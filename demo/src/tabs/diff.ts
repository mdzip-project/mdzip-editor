import { MdzipDiffView } from 'mdzip-editor/diff-view';
import type { MdzipControlPreset } from 'mdzip-editor';
import type { TabController } from '../tab-controller.js';

export async function initDiff(
  container: HTMLElement,
  onFailed: (error: unknown) => void
): Promise<TabController> {
  const response = await fetch('./assets/sample.mdz');
  if (!response.ok) throw new Error(`Failed to load diff base: ${response.status}`);
  const baseBytes = new Uint8Array(await response.arrayBuffer());
  let view: MdzipDiffView | null = null;

  return {
    update(bytes: Uint8Array, fileName: string, _controls: MdzipControlPreset): void {
      const options = {
        before: { bytes: baseBytes, label: 'sample.mdz' },
        after: { bytes, label: fileName },
        showUnchanged: true,
        onFailed
      };
      if (!view) {
        view = new MdzipDiffView(container, options);
      }
      void view.open(options);
    },
    markPersisted(): void {},
    destroy(): void {
      view?.destroy();
      view = null;
    }
  };
}
