import type { MdzOpenWorkspaceOptions, MdzWorkspace } from '@mdzip/core-js';
import type { MdzArchiveWorkerRequest, MdzArchiveWorkerResponse } from './mdz-archive-worker-protocol.js';

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Main-thread bridge to a dedicated Worker running `mdz-archive.worker.ts`.
 * One client owns one worker for the lifetime of the archive it opens —
 * callers construct the `Worker` themselves (URL resolution varies too much
 * across host bundlers to own here) and pass it in.
 */
export class MdzArchiveWorkerClient {
  private readonly pending = new Map<number, PendingEntry>();
  private nextId = 1;
  private disposed = false;

  public constructor(private readonly worker: Worker) {
    this.worker.onmessage = (event: MessageEvent<MdzArchiveWorkerResponse>) => this.handleMessage(event.data);
  }

  /**
   * Opens `bytes` in the worker and returns a workspace shape-identical to
   * `MdzArchiveCore.openWorkspace()`'s direct (non-worker) result: lazy
   * `readText`/`readBytes`/`readDataUri` closures are reattached here so
   * consumers (editor-react/vue/ng) see no difference in the public shape —
   * the closures just call back into the worker instead of a local instance.
   */
  public async open(bytes: Uint8Array, options: MdzOpenWorkspaceOptions): Promise<MdzWorkspace> {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const id = this.nextId++;
    const workspace = await this.send<MdzWorkspace>(
      { id, type: 'open', bytes: buffer, options },
      [buffer]
    );
    return this.attachLazyReaders(workspace);
  }

  public readText(path: string): Promise<string> {
    const id = this.nextId++;
    return this.send<string>({ id, type: 'readText', path });
  }

  public async readBytes(path: string): Promise<Uint8Array> {
    const id = this.nextId++;
    const buffer = await this.send<ArrayBuffer>({ id, type: 'readBytes', path });
    return new Uint8Array(buffer);
  }

  /** Terminates the worker and rejects any in-flight requests. Safe to call more than once. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.worker.postMessage({ id: this.nextId++, type: 'dispose' } satisfies MdzArchiveWorkerRequest);
    } catch {
      // Worker may already be unusable — termination below still runs.
    }
    this.worker.terminate();
    const error = new Error('ERR_ARCHIVE_WORKER_DISPOSED: the archive worker was disposed.');
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  private attachLazyReaders(workspace: MdzWorkspace): MdzWorkspace {
    return {
      ...workspace,
      documents: workspace.documents.map((document) => (
        document.isLazy ? { ...document, readText: () => this.readText(document.path) } : document
      )),
      assets: workspace.assets.map((asset) => (
        asset.bytes === undefined
          ? {
              ...asset,
              readBytes: () => this.readBytes(asset.path),
              readDataUri: async () => dataUriFromBytes(await this.readBytes(asset.path), asset.mimeType)
            }
          : asset
      ))
    };
  }

  private send<T>(request: MdzArchiveWorkerRequest, transfer: Transferable[] = []): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error('ERR_ARCHIVE_WORKER_DISPOSED: the archive worker was disposed.'));
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(request.id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage(request, transfer);
    });
  }

  private handleMessage(response: MdzArchiveWorkerResponse): void {
    const entry = this.pending.get(response.id);
    if (!entry) return;
    this.pending.delete(response.id);
    if (response.ok) {
      entry.resolve(response.result);
      return;
    }
    const error = new Error(response.error.message);
    error.name = response.error.name;
    entry.reject(error);
  }
}

function dataUriFromBytes(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}
