import { readdir, readFile } from 'node:fs/promises';

const checks = [
  {
    file: new URL('../packages/editor/package.json', import.meta.url),
    forbidden: ['@angular/core', 'vscode', 'electron', 'mdzip-viewer']
  },
  {
    file: new URL('../packages/editor-ng/package.json', import.meta.url),
    forbidden: ['vscode']
  }
];

let failed = false;

for (const check of checks) {
  const text = await readFile(check.file, 'utf8');
  const pkg = JSON.parse(text);
  const deps = {
    ...pkg.dependencies,
    ...pkg.peerDependencies,
    ...pkg.devDependencies
  };

  for (const name of check.forbidden) {
    if (Object.prototype.hasOwnProperty.call(deps, name)) {
      console.error(`${pkg.name} must not depend on ${name}`);
      failed = true;
    }
  }
}

const generatedArtifactDir = new URL('../packages/editor/src/', import.meta.url);
const generatedArtifactExtensions = ['.js', '.d.ts', '.map'];
const generatedArtifacts = (await readdir(generatedArtifactDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => generatedArtifactExtensions.some((ext) => name.endsWith(ext)));

if (generatedArtifacts.length > 0) {
  console.error('@mdzip/editor source directory must not contain generated JS, DTS, or map artifacts:');
  for (const name of generatedArtifacts) {
    console.error(`- packages/editor/src/${name}`);
  }
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('Dependency boundary checks passed.');
}
