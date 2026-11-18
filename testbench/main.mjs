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

// ?progressive=1 renders the preview in chunks near the viewport, as VS Code and
// Studio do for large documents (e.g. a Google Voice export).
const progressive = new URLSearchParams(location.search).get('progressive') === '1';

const view = new MdzipWorkspaceView($('app'), {
  controls: 'standalone-editor',
  initialLayout: 'split',
  progressiveTextRendering: progressive,
  markdownExtensions: [mdzipMermaidExtension()],
  onColorSchemePreferenceChanged: (preference) => log(`onColorSchemePreferenceChanged('${preference}')`),
  onPreviewWidthChanged: (width) => log(`onPreviewWidthChanged('${width}')`),
  // Logged only: the built-in behavior (open the file, scroll, open the website) still runs.
  onLinkActivated: (event) => log(`onLinkActivated: ${event.kind} '${event.href}'${event.targetPath ? ` -> ${event.targetPath}` : ''}`),
  externalLinks: { target: '_blank' },
  // A host action in the file tree's right-click menu: it only logs the file.
  hostFileActions: [{ id: 'log-file', label: 'Log This File (bench)', run: (file) => log(`hostFileActions: ${JSON.stringify(file)}`) }],
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

// System following a host theme (as in VS Code), with its own label and icon.
const HOST_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
  + 'stroke-linejoin="round"><path d="M12 22a10 10 0 1 1 10-10c0 2-1.5 3-3.5 3H16a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 22Z"/>'
  + '<circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/></svg>';
const applyHostTheme = () => {
  const source = $('host-theme').checked
    ? { colorScheme: $('host-scheme').value, label: 'Host theme', icon: HOST_ICON }
    : null;
  view.setSystemColorScheme(source);
  log(`setSystemColorScheme(${source ? `{ colorScheme: '${source.colorScheme}', label: 'Host theme' }` : 'null'})`);
};
$('host-theme').addEventListener('change', applyHostTheme);
$('host-scheme').addEventListener('change', () => { if ($('host-theme').checked) applyHostTheme(); });

const response = await fetch('dist/sample.mdz');
await openBytes(new Uint8Array(await response.arrayBuffer()), 'sample.mdz');
