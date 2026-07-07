import type { DemoControls, DemoImageInsertOptions } from './tab-controls.js';

export interface TabController {
  update(bytes: Uint8Array, fileName: string, controls: DemoControls, imageInsert: DemoImageInsertOptions): void;
  setControls(controls: DemoControls): void;
  setImageInsertOptions(imageInsert: DemoImageInsertOptions): void;
  /** Switches between the normal workspace view and this framework's own Diff component. */
  setDiffMode(enabled: boolean): void;
  markPersisted(): void;
  destroy(): void;
}
