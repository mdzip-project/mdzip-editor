import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const packageRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const content = `// Generated from package.json. Do not edit by hand.
export const PACKAGE_INFO = ${JSON.stringify({
  name: packageJson.name,
  version: packageJson.version,
  repositoryUrl: repositoryUrl(packageJson),
  description: packageJson.description
}, null, 2)} as const;
`;

writeFileSync(join(packageRoot, 'src', 'package-info.ts'), content, 'utf8');

function repositoryUrl(packageJson) {
  const value = typeof packageJson.repository === 'string'
    ? packageJson.repository
    : packageJson.repository?.url;
  const base = String(value ?? '')
    .replace(/^git\+/, '')
    .replace(/\.git$/, '');
  const directory = packageJson.repository?.directory;
  return directory ? `${base}/tree/main/${directory}` : base;
}
