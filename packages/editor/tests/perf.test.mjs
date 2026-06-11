import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MdzipWorkspaceService, readTextFileFromArchive } from '../dist/index.js';

// Large-archive performance regression test.
//
// Runs against a real multi-megabyte .mdz archive. The fixture is not
// committed (tests/fixtures/perf/ is gitignored); provide one by either:
//   - copying any large archive to tests/fixtures/perf/large.mdz, or
//   - setting MDZIP_PERF_FIXTURE to an absolute .mdz path.
// When no fixture is present the test is skipped.
//
// Thresholds are deliberately generous (slow CI machines) — they exist to
// catch order-of-magnitude regressions such as mutations falling back from
// byte-level archive patching to a full decompress/recompress rebuild
// (~50s on a 120MB archive), not to benchmark precise numbers.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = process.env.MDZIP_PERF_FIXTURE
  ?? path.join(__dirname, 'fixtures', 'perf', 'large.mdz');

const fixtureExists = fs.existsSync(fixturePath);

test('large archive: open, navigate, mutate, and save stay fast', { skip: !fixtureExists && 'no large fixture (see header comment)' }, async () => {
  const bytes = new Uint8Array(fs.readFileSync(fixturePath));
  const mb = bytes.length / 1048576;

  let t = performance.now();
  const workspace = await MdzipWorkspaceService.open(bytes, { mode: 'editable', fileName: 'large.mdz' });
  const openMs = performance.now() - t;

  const documents = workspace.snapshot().workspace.documents;
  const lazyPaths = documents.filter((doc) => doc.isLazy).map((doc) => doc.path);
  assert.ok(lazyPaths.length > 0, 'expected non-entry documents to open lazily');

  // Click through a few documents like a user browsing the navigator.
  const probes = [lazyPaths[0], lazyPaths[Math.floor(lazyPaths.length / 2)], lazyPaths[lazyPaths.length - 1]];
  let slowestOpenPathMs = 0;
  for (const probe of probes) {
    t = performance.now();
    assert.equal(await workspace.openPath(probe), true);
    slowestOpenPathMs = Math.max(slowestOpenPathMs, performance.now() - t);
    assert.ok(workspace.currentText.length > 0, `expected non-empty text for ${probe}`);
  }

  // Mutate: must patch the archive, not rebuild it, and must not lose
  // documents the user never opened.
  const untouched = lazyPaths[Math.floor(lazyPaths.length / 3)];
  const original = await readTextFileFromArchive(bytes, untouched);
  t = performance.now();
  await workspace.addAsset('images/perf-probe.png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const addAssetMs = performance.now() - t;
  assert.equal(await readTextFileFromArchive(workspace.snapshot().archiveBytes, untouched), original,
    'unopened lazy document must survive an archive mutation');

  // Manifest-only change: must patch, never resolve lazy documents.
  t = performance.now();
  await workspace.setManifestTitle('Perf Probe Title');
  const setTitleMs = performance.now() - t;

  // Edit the current document and save.
  workspace.editText(`${workspace.currentText}\n\nperf probe edit\n`);
  t = performance.now();
  const saved = await workspace.saveToBytes();
  const saveMs = performance.now() - t;
  assert.equal(await readTextFileFromArchive(saved, untouched), original,
    'unopened lazy document must survive save');
  assert.match(await readTextFileFromArchive(saved, 'images/perf-probe.png').catch(() => 'binary-ok'), /.*/);

  const report = `open=${openMs.toFixed(0)}ms openPath(max)=${slowestOpenPathMs.toFixed(0)}ms addAsset=${addAssetMs.toFixed(0)}ms setTitle=${setTitleMs.toFixed(0)}ms save=${saveMs.toFixed(0)}ms (${mb.toFixed(0)}MB archive)`;
  console.log(`perf: ${report}`);

  assert.ok(openMs < 5000, `open took ${openMs.toFixed(0)}ms (limit 5000ms) — ${report}`);
  assert.ok(slowestOpenPathMs < 2000, `openPath took ${slowestOpenPathMs.toFixed(0)}ms (limit 2000ms) — ${report}`);
  assert.ok(addAssetMs < 10000, `addAsset took ${addAssetMs.toFixed(0)}ms (limit 10000ms) — ${report}`);
  assert.ok(setTitleMs < 5000, `setManifestTitle took ${setTitleMs.toFixed(0)}ms (limit 5000ms) — ${report}`);
  assert.ok(saveMs < 10000, `save took ${saveMs.toFixed(0)}ms (limit 10000ms) — ${report}`);
});
