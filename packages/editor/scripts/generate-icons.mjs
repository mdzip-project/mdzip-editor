import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const svgPath = join(packageRoot, 'src', 'icons', 'md-markdown.svg');
const tsPath = join(packageRoot, 'src', 'icons', 'md-markdown.ts');

const svg = readFileSync(svgPath, 'utf8');
const nodes = [];
const elementPattern = /<(path|rect|circle|line|polyline|polygon)\s+([^/>]+?)\s*\/>/g;
let match;

while ((match = elementPattern.exec(svg)) !== null) {
  const [, tag, rawAttributes] = match;
  const attrs = {};
  const attrPattern = /([\w:-]+)="([^"]*)"/g;
  let attrMatch;
  while ((attrMatch = attrPattern.exec(rawAttributes)) !== null) {
    const [, key, value] = attrMatch;
    attrs[key] = value;
  }
  nodes.push([tag, attrs]);
}

if (!nodes.length) {
  throw new Error(`No supported icon nodes found in ${svgPath}`);
}

const content = `// Generated from md-markdown.svg. Do not edit by hand.
export type LucideIconNode = [tag: string, attrs: Record<string, string | number | undefined>][];

export const MD_MARKDOWN_ICON: LucideIconNode = ${JSON.stringify(nodes, null, 2)};
`;

writeFileSync(tsPath, content, 'utf8');
