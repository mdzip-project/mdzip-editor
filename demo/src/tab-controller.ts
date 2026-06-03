export interface TabController {
  update(bytes: Uint8Array, mode: string, fileName: string): void;
  destroy(): void;
}
