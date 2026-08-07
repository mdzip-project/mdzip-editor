import assert from 'node:assert/strict';
import test from 'node:test';
import { MdzArchiveWorkerClient } from '../dist/index.js';

/** A `Worker`-shaped mock: no real Worker/DOM needed to exercise the RPC bridge. */
function createMockWorker() {
  const sent = [];
  const worker = {
    onmessage: null,
    terminated: false,
    postMessage(message, transfer) {
      sent.push({ message, transfer });
    },
    terminate() {
      worker.terminated = true;
    }
  };
  const respond = (response) => worker.onmessage({ data: response });
  return { worker, sent, respond };
}

test('readText/readBytes correlate responses by id, even out of order', async () => {
  const { worker, sent, respond } = createMockWorker();
  const client = new MdzArchiveWorkerClient(worker);

  const first = client.readText('a.md');
  const second = client.readText('b.md');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].message.type, 'readText');
  assert.equal(sent[0].message.path, 'a.md');
  assert.equal(sent[1].message.path, 'b.md');

  // Respond out of order — id correlation must still route correctly.
  respond({ id: sent[1].message.id, ok: true, result: 'B' });
  respond({ id: sent[0].message.id, ok: true, result: 'A' });

  assert.equal(await first, 'A');
  assert.equal(await second, 'B');
});

test('readBytes reconstructs a Uint8Array from the transferred ArrayBuffer', async () => {
  const { worker, sent, respond } = createMockWorker();
  const client = new MdzArchiveWorkerClient(worker);

  const pending = client.readBytes('images/a.png');
  const buffer = Uint8Array.from([1, 2, 3]).buffer;
  respond({ id: sent[0].message.id, ok: true, result: buffer });

  const bytes = await pending;
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual(Array.from(bytes), [1, 2, 3]);
});

test('a worker error response rejects with the propagated name and message', async () => {
  const { worker, sent, respond } = createMockWorker();
  const client = new MdzArchiveWorkerClient(worker);

  const pending = client.readText('missing.md');
  respond({ id: sent[0].message.id, ok: false, error: { name: 'RangeError', message: 'not found' } });

  await assert.rejects(pending, (error) => {
    assert.equal(error.name, 'RangeError');
    assert.equal(error.message, 'not found');
    return true;
  });
});

test('open() transfers the input bytes and reattaches lazy readers that call back into the worker', async () => {
  const { worker, sent, respond } = createMockWorker();
  const client = new MdzArchiveWorkerClient(worker);

  const inputBytes = Uint8Array.from([9, 9, 9]);
  const opening = client.open(inputBytes, {});
  assert.equal(sent[0].message.type, 'open');
  assert.equal(sent[0].transfer[0], sent[0].message.bytes, 'the bytes buffer is passed in the transfer list');

  respond({
    id: sent[0].message.id,
    ok: true,
    result: {
      title: null,
      mode: 'document',
      manifest: null,
      entryPoint: 'index.md',
      documents: [{ path: 'index.md', title: 'index', text: '', isEntryPoint: true, isLazy: true }],
      assets: [{ path: 'images/a.png', fileName: 'a.png', byteSize: 3, mimeType: 'image/png', kind: 'image', isPreviewable: true }],
      validation: { errors: [], warnings: [] }
    }
  });

  const workspace = await opening;
  assert.equal(typeof workspace.documents[0].readText, 'function', 'lazy document reader was reattached');
  assert.equal(typeof workspace.assets[0].readBytes, 'function', 'lazy asset reader was reattached');

  const readingDoc = workspace.documents[0].readText();
  const docRequest = sent.at(-1).message;
  assert.equal(docRequest.type, 'readText');
  assert.equal(docRequest.path, 'index.md');
  respond({ id: docRequest.id, ok: true, result: '# Hello' });
  assert.equal(await readingDoc, '# Hello');
});

test('dispose() terminates the worker and rejects in-flight requests', async () => {
  const { worker } = createMockWorker();
  const client = new MdzArchiveWorkerClient(worker);

  const pending = client.readText('a.md');
  client.dispose();

  assert.equal(worker.terminated, true);
  await assert.rejects(pending, /ERR_ARCHIVE_WORKER_DISPOSED/);
  await assert.rejects(client.readText('b.md'), /ERR_ARCHIVE_WORKER_DISPOSED/);
});
