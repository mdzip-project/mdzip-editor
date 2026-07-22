import type { MdzipPackFilesInput, MdzipPackFilesResult } from 'mdzip-editor';
import type { DemoControls, DemoDensity, DemoImageInsertOptions } from './tab-controls.js';

export interface TabController {
  update(
    bytes: Uint8Array,
    fileName: string,
    controls: DemoControls,
    imageInsert: DemoImageInsertOptions,
    density: DemoDensity
  ): void;
  setControls(controls: DemoControls): void;
  setImageInsertOptions(imageInsert: DemoImageInsertOptions): void;
  setDensity(density: DemoDensity): void;
  /** Switches between the normal workspace view and this framework's own Diff component. */
  setDiffMode(enabled: boolean): void;
  markPersisted(): void;
  /** Delegates to this tab's live workspace instance; null in Diff mode (no workspace mounted). */
  packFilesAsWorkspace(
    files: readonly MdzipPackFilesInput[],
    options?: { title?: string; fileName?: string }
  ): Promise<MdzipPackFilesResult | null>;
  destroy(): void;
}
