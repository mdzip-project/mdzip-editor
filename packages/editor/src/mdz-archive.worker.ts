import { MdzArchiveCore, type MdzWorkspace, type MdzWorkspaceAsset, type MdzWorkspaceDocument } from '@mdzip/core-js';
import type { MdzArchiveWorkerRequest, MdzArchiveWorkerResponse } from './mdz-archive-worker-protocol.js';

/**
 * Runs inside a dedicated Worker. Cast instead of relying on `lib.webworker.d.ts`
 * globals (`self`, `postMessage`) — this file is typechecked by the same
 * `tsc` pass as the rest of the package under `lib: ["ES2022", "DOM"]`, which
 * cannot be combined with the `WebWorker` lib in one program.
 */
interface DedicatedWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}
const ctx = self as unknown as DedicatedWorkerLike;

let core: MdzArchiveCore | undefined;

/** Strips lazy reader functions (they cannot cross postMessage) before a workspace is sent to the main thread. */
function stripLazyReaders(workspace: MdzWorkspace): MdzWorkspace {
  return {
    ...workspace,
    documents: workspace.documents.map((doc): MdzWorkspaceDocument => {
      if (!doc.readText) return doc;
      const { readText: _readText, ...rest } = doc;
      return rest;
    }),
    assets: workspace.assets.map((asset): MdzWorkspaceAsset => {
      if (!asset.readBytes && !asset.readDataUri) return asset;
      const { readBytes: _readBytes, readDataUri: _readDataUri, ...rest } = asset;
      return rest;
    })
  };
}

function respond(id: number, result: unknown): void {
  ctx.postMessage({ id, ok: true, result } satisfies MdzArchiveWorkerResponse);
}

function respondBytes(id: number, bytes: Uint8Array): void {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  ctx.postMessage({ id, ok: true, result: buffer } satisfies MdzArchiveWorkerResponse, [buffer]);
}

function respondError(id: number, error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  ctx.postMessage({ id, ok: false, error: { name: err.name, message: err.message } } satisfies MdzArchiveWorkerResponse);
}

ctx.onmessage = (event: MessageEvent<MdzArchiveWorkerRequest>) => {
  const request = event.data;
  void handle(request).catch((error) => respondError(request.id, error));
};

async function handle(request: MdzArchiveWorkerRequest): Promise<void> {
  switch (request.type) {
    case 'open': {
      // Open once and keep the instance for subsequent readText/readBytes
      // calls — mirrors what MdzArchiveCore.openWorkspace()'s lazy closures
      // do internally on the non-worker path, just retained here instead of
      // discarded, so a second call doesn't re-parse the archive.
      core = await MdzArchiveCore.open(new Uint8Array(request.bytes));
      const workspace = await core.openWorkspace(request.options);
      respond(request.id, stripLazyReaders(workspace));
      return;
    }
    case 'readText': {
      if (!core) throw new Error('ERR_ARCHIVE_WORKER_NOT_OPEN: no archive has been opened in this worker.');
      respond(request.id, await core.readText(request.path));
      return;
    }
    case 'readBytes': {
      if (!core) throw new Error('ERR_ARCHIVE_WORKER_NOT_OPEN: no archive has been opened in this worker.');
      respondBytes(request.id, await core.readBytes(request.path));
      return;
    }
    case 'dispose': {
      core = undefined;
      respond(request.id, undefined);
      return;
    }
  }
}
