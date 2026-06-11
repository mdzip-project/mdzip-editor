import type { MdzipControlPreset } from 'mdzip-editor';

export interface TabController {
  update(bytes: Uint8Array, fileName: string, controls: MdzipControlPreset): void;
  markPersisted(): void;
  destroy(): void;
}
