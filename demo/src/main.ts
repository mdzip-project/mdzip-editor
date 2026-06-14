import { initRaw } from './tabs/raw.js';
import { PRESETS } from './tab-controls.js';
import type { MdzipControlPreset } from 'mdzip-editor';
import type { TabController } from './tab-controller.js';

type TabId = 'raw' | 'diff' | 'angular' | 'react' | 'vue';

let activeTab: TabId = 'raw';
let currentBytes: Uint8Array | null = null;
let currentFileName = 'sample.mdz';
let currentControls: MdzipControlPreset = 'standalone-editor';

const controllers = new Map<TabId, TabController>();
const pendingControllers = new Map<TabId, Promise<TabController>>();

function setStatus(msg: string): void {
  document.getElementById('status')!.textContent = msg;
}

function updateModeUI(): void {
  document.querySelectorAll<HTMLElement>('#mode-group .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset['preset'] === currentControls);
  });
  const preset = PRESETS.find(p => p.value === currentControls);
  document.getElementById('mode-desc')!.textContent = preset?.description ?? '';
}

function onSaved(bytes: Uint8Array, fileName?: string): void {
  if (fileName) currentFileName = fileName;
  downloadBytes(bytes, currentFileName);
  setStatus(`Saved ${currentFileName} - ${bytes.byteLength.toLocaleString()} bytes.`);
}

function onFailed(error: unknown): void {
  setStatus(error instanceof Error ? error.message : String(error));
}

async function getOrInitTab(tabId: TabId): Promise<TabController> {
  if (controllers.has(tabId)) return controllers.get(tabId)!;
  if (pendingControllers.has(tabId)) return pendingControllers.get(tabId)!;

  const pending = (async (): Promise<TabController> => {
    const container = document.getElementById(`tab-${tabId}`)!;
    container.replaceChildren();
    switch (tabId) {
      case 'raw':
        return initRaw(container, onSaved, onFailed);
      case 'diff': {
        const { initDiff } = await import('./tabs/diff.js');
        return initDiff(container, onFailed);
      }
      case 'react': {
        const { initReact } = await import('./tabs/react.js');
        return initReact(container, onSaved, onFailed);
      }
      case 'vue': {
        const { initVue } = await import('./tabs/vue.js');
        return initVue(container, onSaved, onFailed);
      }
      case 'angular': {
        setStatus('Bootstrapping Angular...');
        const { initAngular } = await import('./tabs/angular.js');
        return initAngular(container, onSaved, onFailed);
      }
    }
  })();

  pendingControllers.set(tabId, pending);
  try {
    const controller = await pending;
    controllers.set(tabId, controller);
    return controller;
  } finally {
    pendingControllers.delete(tabId);
  }
}

async function switchTab(newTab: TabId): Promise<void> {
  document.querySelectorAll<HTMLElement>('.tab-btn[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset['tab'] === newTab);
  });
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${newTab}`);
  });
  activeTab = newTab;
  try {
    const ctrl = await getOrInitTab(newTab);
    if (currentBytes) {
      ctrl.update(currentBytes, currentFileName, currentControls);
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
  if (controllers.has(activeTab)) {
    controllers.get(activeTab)!.update(bytes, fileName, currentControls);
  }
}

// Framework tab buttons
document.querySelectorAll<HTMLElement>('.tab-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => void switchTab(btn.dataset['tab'] as TabId));
});

// Mode buttons
document.querySelectorAll<HTMLElement>('#mode-group .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentControls = btn.dataset['preset'] as MdzipControlPreset;
    updateModeUI();
    if (currentBytes && controllers.has(activeTab)) {
      controllers.get(activeTab)!.update(currentBytes, currentFileName, currentControls);
    }
  });
});

// File open
document.getElementById('file-input')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await loadBytes(bytes, file.name);
  setStatus(`Opened ${file.name}.`);
});


function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }));
  const anchor = Object.assign(document.createElement('a'), { href: url, download: fileName });
  anchor.click();
  URL.revokeObjectURL(url);
}

async function init(): Promise<void> {
  updateModeUI();
  await switchTab('raw');
  try {
    const res = await fetch('./assets/developer-guide.mdz');
    if (!res.ok) throw new Error(`Failed to load developer guide: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await loadBytes(bytes, 'developer-guide.mdz');
    setStatus('Loaded developer-guide.mdz - try the JS, Angular, React and Vue tabs.');
  } catch (err) {
    onFailed(err);
  }
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'mdzip-demo-ready' }, '*');
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  void (async () => {
    const data = event.data as Record<string, unknown>;
    if (!data || data['type'] !== 'mdzip-demo-open') return;
    const rawBytes = data['bytes'];
    if (!(rawBytes instanceof Uint8Array)) return;
    const fileName = typeof data['fileName'] === 'string' && data['fileName'] ? data['fileName'] : 'archive.mdz';
    try {
      await loadBytes(rawBytes, fileName);
      setStatus(`Opened ${fileName}.`);
    } catch (err) {
      onFailed(err);
    }
  })();
});

void init();
