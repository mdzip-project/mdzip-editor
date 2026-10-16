// Test bench page: the editor built from this repo, with the Mermaid extension
// and buttons for the API-only features. Bundled by build.mjs.
import { MdzipWorkspaceView } from '@mdzip/editor';
import { mdzipMermaidExtension } from '@mdzip/editor/mermaid';

const $ = (id) => document.getElementById(id);
const log = (text) => {
  $('log').textContent = `${new Date().toLocaleTimeString()}  ${text}\n${$('log').textContent}`.slice(0, 4000);
};

$('secure').textContent = window.isSecureContext
  ? 'secure context (crypto.subtle available)'
  : 'NOT a secure context: crypto.subtle is undefined';
$('secure').className = window.isSecureContext ? 'ok' : 'warn';

const view = new MdzipWorkspaceView($('app'), {
  controls: 'standalone-editor',
  initialLayout: 'split',
  markdownExtensions: [mdzipMermaidExtension()],
  onColorSchemePreferenceChanged: (preference) => log(`onColorSchemePreferenceChanged('${preference}')`),
  onPreviewWidthChanged: (width) => log(`onPreviewWidthChanged('${width}')`),
  onFailed: (error) => log(`onFailed: ${error instanceof Error ? error.message : error}`)
});

let lastBytes = null;
let lastName = 'sample.mdz';

async function openBytes(bytes, fileName, options = {}) {
  lastBytes = bytes;
  lastName = fileName;
  await view.open(bytes, { mode: 'editable', fileName, ...options });
  log(`opened ${fileName}${options.initialPath ? ` at ${options.initialPath}` : ''}; showing ${view.getCurrentPath()}`);
}

$('file').addEventListener('change', async () => {
  const file = $('file').files?.[0];
  if (file) await openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
});

// Open another file at a heading through the API.
$('open-path').addEventListener('click', async () => {
  const [path, anchor] = $('path').value.split('#');
  const result = await view.openPath(path, anchor ? { anchor } : {});
  log(`openPath('${path}'${anchor ? `, { anchor: '${anchor}' }` : ''}) -> ${result}; showing ${view.getCurrentPath()}`);
});

// Reload the same bytes, keeping the current file (initialPath) or not.
$('reload-keep').addEventListener('click', async () => {
  if (!lastBytes) return;
  await openBytes(lastBytes, lastName, { initialPath: view.getCurrentPath() ?? undefined });
});
$('reload-reset').addEventListener('click', async () => {
  if (!lastBytes) return;
  await openBytes(lastBytes, lastName);
});

// Save As style rename, in place.
$('rename').addEventListener('click', () => {
  const name = prompt('New file name (try renamed.mdz, or notes.md to see it refused)', 'renamed.mdz');
  if (!name) return;
  const renamed = view.setFileName(name);
  log(`setFileName('${name}') -> ${renamed}; still showing ${view.getCurrentPath()}`);
});

$('current').addEventListener('click', () => log(`getCurrentPath() -> ${view.getCurrentPath()}`));

const response = await fetch('dist/sample.mdz');
await openBytes(new Uint8Array(await response.arrayBuffer()), 'sample.mdz');
