// Builds the test bench into testbench/dist: bundles main.mjs against this
// repo's @mdzip/editor (run `npm run build -w @mdzip/editor` first; the
// `testbench` script does), and packs sample/ into sample.mdz.
import { build } from 'esbuild';
import { MdzPackagerCore } from '@mdzip/core-js';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [join(here, 'main.mjs')],
  bundle: true,
  splitting: true,
  format: 'esm',
  outdir: dist,
  entryNames: 'main',
  logLevel: 'warning'
});

const sample = join(here, 'sample');
const files = [];
for (const entry of await readdir(sample, { recursive: true, withFileTypes: true })) {
  if (entry.isFile()) {
    const full = join(entry.parentPath, entry.name);
    files.push({ path: relative(sample, full).split(sep).join('/'), data: await readFile(full) });
  }
}
const archive = await MdzPackagerCore.buildArchive(files, 'Editor test bench', {
  createIndex: false, mapFiles: false, filters: ['**/*', '*'], mode: 'document', entryPoint: 'index.md'
});
await writeFile(join(dist, 'sample.mdz'), Buffer.from(await archive.blob.arrayBuffer()));
console.log(`Built testbench/dist (sample.mdz: ${files.map((file) => file.path).join(', ')})`);
