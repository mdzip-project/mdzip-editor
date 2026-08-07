import type { MdzOpenWorkspaceOptions } from '@mdzip/core-js';

/**
 * Message protocol between {@link MdzArchiveWorkerClient} (main thread) and
 * `mdz-archive.worker.ts` (worker). Kept deliberately small — one worker
 * handles exactly one archive's lifetime, so there is no session id.
 */
export type MdzArchiveWorkerRequest =
  | { id: number; type: 'open'; bytes: ArrayBuffer; options: MdzOpenWorkspaceOptions }
  | { id: number; type: 'readText'; path: string }
  | { id: number; type: 'readBytes'; path: string }
  | { id: number; type: 'dispose' };

export type MdzArchiveWorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { name: string; message: string } };
