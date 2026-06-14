import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(dirname(packageRoot));
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

const libraries = [
  library('@mdzip/editor', packageJson.version,
    'https://github.com/mdzip-project/mdzip-editor',
    'MDZip workspace engine and browser UI.'),
  library('@mdzip/core-js', installedVersion('@mdzip/core-js'),
    'https://github.com/mdzip-project/mdzip-core-js',
    'MDZip archive reading, writing, and validation.'),
  library('CodeMirror', installedVersion('@codemirror/view'),
    'https://github.com/codemirror/dev',
    'Extensible code editor and diff UI.'),
  library('Marked', installedVersion('marked'),
    'https://github.com/markedjs/marked',
    'Markdown parser and renderer.'),
  library('DOMPurify', installedVersion('dompurify'),
    'https://github.com/cure53/DOMPurify',
    'HTML sanitization.'),
  library('highlight.js', installedVersion('highlight.js'),
    'https://github.com/highlightjs/highlight.js',
    'Code-block syntax highlighting.'),
  library('Lucide', installedVersion('lucide'),
    'https://github.com/lucide-icons/lucide',
    'Interface icons.')
];

const content = `// Generated from package metadata. Do not edit by hand.
export const MDZIP_RUNTIME_LIBRARIES = ${JSON.stringify(libraries, null, 2)} as const;
`;

writeFileSync(join(packageRoot, 'src', 'library-info.ts'), content, 'utf8');

function installedVersion(packageName) {
  const packagePath = join(workspaceRoot, 'node_modules', ...packageName.split('/'), 'package.json');
  return JSON.parse(readFileSync(packagePath, 'utf8')).version;
}

function library(name, version, repositoryUrl, description) {
  return { name, version, repositoryUrl, description };
}
