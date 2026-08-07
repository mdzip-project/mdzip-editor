// ng-packagr has no built-in static-asset copy step (unlike Angular CLI's
// `angular.json`), so `mdz-archive.worker.js` — a pre-bundled, self-contained
// script consumers load by URL, not by JS import — is copied into dist here
// rather than rolled into the FESM bundle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const from = path.resolve(packageDir, '..', 'editor', 'dist', 'mdz-archive.worker.js');
const to = path.resolve(packageDir, 'dist', 'mdz-archive.worker.js');

fs.mkdirSync(path.dirname(to), { recursive: true });
fs.copyFileSync(from, to);
console.log(`Copied ${path.relative(packageDir, to)}`);

// The source package.json's export for this asset is dist-relative
// ("./dist/mdz-archive.worker.js") because local/symlinked dev resolves
// @mdzip/editor-ng straight to this package's root, where dist/ is a real
// subfolder. ng-packagr writes a *different* package.json into dist/ itself
// (rewriting its own known fields to drop the "dist/" prefix, since that
// package.json's location IS dist/) but doesn't know about this custom
// export entry, so it's patched here to match — otherwise published/
// installed consumers (who only ever see dist/package.json) get a path
// pointing at a nonexistent nested dist/dist/.
const manifestPath = path.resolve(packageDir, 'dist', 'package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const key = './mdz-archive.worker.js';
if (manifest.exports?.[key] === `./dist/mdz-archive.worker.js`) {
  manifest.exports[key] = './mdz-archive.worker.js';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Patched ${path.relative(packageDir, manifestPath)} exports["${key}"]`);
}
