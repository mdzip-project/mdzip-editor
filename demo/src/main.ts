import { initRaw } from './tabs/raw.js';
import { imageInsertOptionsFromChoice, PRESETS, type DemoImageInsertChoice } from './tab-controls.js';
import type { MdzipControlPreset } from 'mdzip-editor';
import type { DemoControls } from './tab-controls.js';
import type { TabController } from './tab-controller.js';
import { SAMPLE_FILES } from './sample-files.js';

const CHOOSE_FILE = '__choose_file__';
const CUSTOM_FILE = '__custom_file__';

type TabId = 'raw' | 'angular' | 'react' | 'vue';

let activeTab: TabId = 'raw';
let currentBytes: Uint8Array | null = null;
let currentFileName = 'sample.mdz';
let currentControls: MdzipControlPreset = 'standalone-editor';
let currentLineNumbers = true;
let currentImageInsertChoice: DemoImageInsertChoice = 'markdown';
let diffMode = false;

const controllers = new Map<TabId, TabController>();
const pendingControllers = new Map<TabId, Promise<TabController>>();

function setStatus(msg: string): void {
  document.getElementById('status')!.textContent = msg;
}

function updateModeUI(): void {
  document.querySelectorAll<HTMLElement>('#mode-group .tab-btn').forEach(btn => {
    const preset = btn.dataset['preset'];
    btn.classList.toggle('active', diffMode ? preset === 'diff' : preset === currentControls);
  });
  document.getElementById('mode-desc')!.textContent = diffMode
    ? "Compare against a fixed sample using this framework's own Diff component"
    : (PRESETS.find(p => p.value === currentControls)?.description ?? '');
  const lineNumbersToggle = document.getElementById('line-numbers-toggle') as HTMLInputElement | null;
  if (lineNumbersToggle) {
    lineNumbersToggle.checked = currentLineNumbers;
  }
  const imageInsertSelect = document.getElementById('image-insert-mode') as HTMLSelectElement | null;
  if (imageInsertSelect) {
    imageInsertSelect.value = currentImageInsertChoice;
  }
}

function currentControlPolicy(): DemoControls {
  return {
    preset: currentControls,
    lineNumbers: currentLineNumbers,
  };
}

function currentImageInsertOptions() {
  return imageInsertOptionsFromChoice(currentImageInsertChoice);
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
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${newTab}`);
  });
  activeTab = newTab;
  try {
    const ctrl = await getOrInitTab(newTab);
    ctrl.setDiffMode(diffMode);
    if (currentBytes) {
      ctrl.update(currentBytes, currentFileName, currentControlPolicy(), currentImageInsertOptions());
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
    controllers.get(activeTab)!.update(bytes, fileName, currentControlPolicy(), currentImageInsertOptions());
  }
}

// Framework radio buttons
document.querySelectorAll<HTMLInputElement>('input[name="framework"]').forEach(radio => {
  radio.addEventListener('change', () => {
    if (radio.checked) void switchTab(radio.value as TabId);
  });
});

// Mode buttons — Diff is just another mode, mutually exclusive with the
// workspace presets; it applies to whichever framework tab is active, and to
// each newly-created tab (see switchTab), so it composes with any of them.
document.querySelectorAll<HTMLElement>('#mode-group .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = btn.dataset['preset']!;
    if (preset === 'diff') {
      diffMode = true;
    } else {
      diffMode = false;
      currentControls = preset as MdzipControlPreset;
    }
    updateModeUI();
    controllers.get(activeTab)?.setDiffMode(diffMode);
    if (currentBytes && controllers.has(activeTab)) {
      controllers.get(activeTab)!.update(currentBytes, currentFileName, currentControlPolicy(), currentImageInsertOptions());
    }
  });
});

document.getElementById('line-numbers-toggle')!.addEventListener('change', (event) => {
  currentLineNumbers = (event.currentTarget as HTMLInputElement).checked;
  updateModeUI();
  controllers.get(activeTab)?.setControls(currentControlPolicy());
});

document.getElementById('image-insert-mode')!.addEventListener('change', (event) => {
  currentImageInsertChoice = (event.currentTarget as HTMLSelectElement).value as DemoImageInsertChoice;
  updateModeUI();
  controllers.get(activeTab)?.setImageInsertOptions(currentImageInsertOptions());
  const label = currentImageInsertChoice === 'host-html' ? 'host HTML hook' : currentImageInsertChoice;
  setStatus(`Image insert: ${label}.`);
});

// Sample-file dropdown, populated from the designated ./assets samples
// folder at build time (see sample-files.ts), plus a final "Choose file..."
// option that falls back to the hidden native file input.
const sampleSelect = document.getElementById('sample-select') as HTMLSelectElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
let lastRealSelectValue = '';
let customOption: HTMLOptionElement | null = null;

function populateSampleSelect(): void {
  for (const sample of SAMPLE_FILES) {
    const option = document.createElement('option');
    option.value = sample.url;
    option.textContent = sample.label;
    sampleSelect.appendChild(option);
  }
  const chooseFileOption = document.createElement('option');
  chooseFileOption.value = CHOOSE_FILE;
  chooseFileOption.textContent = 'Choose file...';
  sampleSelect.appendChild(chooseFileOption);
}

function markCustomFileLoaded(fileName: string): void {
  if (!customOption) {
    customOption = document.createElement('option');
    customOption.value = CUSTOM_FILE;
    sampleSelect.insertBefore(customOption, sampleSelect.querySelector(`option[value="${CHOOSE_FILE}"]`));
  }
  customOption.textContent = fileName;
  sampleSelect.value = CUSTOM_FILE;
  lastRealSelectValue = CUSTOM_FILE;
}

async function loadSampleUrl(url: string, label: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${label}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await loadBytes(bytes, label);
  setStatus(`Loaded ${label}.`);
}

populateSampleSelect();

sampleSelect.addEventListener('change', () => {
  const { value } = sampleSelect;
  if (value === CHOOSE_FILE) {
    fileInput.click();
    return;
  }
  lastRealSelectValue = value;
  const sample = SAMPLE_FILES.find((f) => f.url === value);
  void loadSampleUrl(value, sample?.label ?? value).catch(onFailed);
});

// Most browsers fire 'cancel' (not 'change') when the native file dialog is
// dismissed without a selection — revert to whatever was actually loaded.
fileInput.addEventListener('cancel', () => {
  sampleSelect.value = lastRealSelectValue;
});

fileInput.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) {
    sampleSelect.value = lastRealSelectValue;
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  await loadBytes(bytes, file.name);
  setStatus(`Opened ${file.name}.`);
  markCustomFileLoaded(file.name);
  fileInput.value = '';
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
  const initial = SAMPLE_FILES.find((f) => f.label === 'developer-guide.mdz') ?? SAMPLE_FILES[0];
  if (initial) {
    try {
      await loadSampleUrl(initial.url, initial.label);
      sampleSelect.value = initial.url;
      lastRealSelectValue = initial.url;
      setStatus(`Loaded ${initial.label} - try the JS, Angular, React and Vue tabs, or the Diff mode.`);
    } catch (err) {
      onFailed(err);
    }
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
      markCustomFileLoaded(fileName);
    } catch (err) {
      onFailed(err);
    }
  })();
});

void init();
