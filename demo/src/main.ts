import { initRaw } from './tabs/raw.js';
import type { TabController } from './tab-controller.js';

type TabId = 'raw' | 'angular' | 'react' | 'vue';
type Mode = 'editable' | 'read-only';

let activeTab: TabId = 'raw';
let currentBytes: Uint8Array | null = null;
let currentFileName = 'sample.mdz';
let currentMode: Mode = 'editable';
let lastSavedBytes: Uint8Array | null = null;

const controllers = new Map<TabId, TabController>();

function setStatus(msg: string): void {
  document.getElementById('status')!.textContent = msg;
}

function onSaved(bytes: Uint8Array): void {
  lastSavedBytes = bytes;
  setStatus(`Saved - ${bytes.byteLength.toLocaleString()} bytes. Click Download to save file.`);
}

function onFailed(error: unknown): void {
  setStatus(error instanceof Error ? error.message : String(error));
}

async function getOrInitTab(tabId: TabId): Promise<TabController> {
  if (controllers.has(tabId)) {
    return controllers.get(tabId)!;
  }

  const container = document.getElementById(`tab-${tabId}`)!;

  let ctrl: TabController;
  switch (tabId) {
    case 'raw':
      ctrl = initRaw(container, onSaved, onFailed);
      break;
    case 'react': {
      const { initReact } = await import('./tabs/react.js');
      ctrl = initReact(container, onSaved, onFailed);
      break;
    }
    case 'vue': {
      const { initVue } = await import('./tabs/vue.js');
      ctrl = initVue(container, onSaved, onFailed);
      break;
    }
    case 'angular': {
      setStatus('Bootstrapping Angular...');
      const { initAngular } = await import('./tabs/angular.js');
      ctrl = await initAngular(container, onSaved, onFailed);
      break;
    }
  }

  controllers.set(tabId, ctrl);
  return ctrl;
}

async function switchTab(newTab: TabId): Promise<void> {
  document.querySelectorAll<HTMLElement>('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset['tab'] === newTab);
  });
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${newTab}`);
  });

  activeTab = newTab;

  try {
    const ctrl = await getOrInitTab(newTab);
    if (currentBytes) {
      ctrl.update(currentBytes, currentMode, currentFileName);
      setStatus(`${newTab} - ${currentFileName}`);
    }
  } catch (err) {
    setStatus(`${newTab} failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`[mdzip demo] ${newTab} tab init failed:`, err);
  }
}

async function loadBytes(bytes: Uint8Array, fileName: string): Promise<void> {
  currentBytes = bytes;
  currentFileName = fileName;
  lastSavedBytes = null;

  if (controllers.has(activeTab)) {
    controllers.get(activeTab)!.update(bytes, currentMode, fileName);
  }
}

// Tab buttons
document.querySelectorAll<HTMLElement>('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => void switchTab(btn.dataset['tab'] as TabId));
});

// Mode buttons
document.getElementById('btn-editable')!.addEventListener('click', () => {
  currentMode = 'editable';
  if (currentBytes && controllers.has(activeTab)) {
    controllers.get(activeTab)!.update(currentBytes, currentMode, currentFileName);
  }
});

document.getElementById('btn-readonly')!.addEventListener('click', () => {
  currentMode = 'read-only';
  if (currentBytes && controllers.has(activeTab)) {
    controllers.get(activeTab)!.update(currentBytes, currentMode, currentFileName);
  }
});

// File open
document.getElementById('file-input')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await loadBytes(bytes, file.name);
  setStatus(`Opened ${file.name}.`);
});

// Download
document.getElementById('btn-download')!.addEventListener('click', () => {
  const bytes = lastSavedBytes;
  if (!bytes) {
    setStatus('Nothing saved yet - use the Save button inside the editor first.');
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: currentFileName });
  a.click();
  URL.revokeObjectURL(url);
  setStatus(`Downloaded ${currentFileName}.`);
});

// Boot: init raw tab then load sample
async function init(): Promise<void> {
  await switchTab('raw');
  try {
    const res = await fetch('./src/assets/sample.mdz');
    if (!res.ok) throw new Error(`Failed to load sample: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await loadBytes(bytes, 'sample.mdz');
    setStatus('Loaded sample.mdz - try the Raw, Angular, React and Vue tabs.');
  } catch (err) {
    onFailed(err);
  }
}

void init();
