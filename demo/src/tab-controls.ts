import type { MdzipControlPreset, MdzipWorkspaceMode } from 'mdzip-editor';

export interface DemoTabControls {
  readonly content: HTMLDivElement;
  setMode(mode: MdzipWorkspaceMode): MdzipControlPreset;
  destroy(): void;
}

export function createDemoTabControls(
  container: HTMLElement,
  initialMode: MdzipWorkspaceMode,
  initialControls: MdzipControlPreset,
  onChange: (mode: MdzipWorkspaceMode, controls: MdzipControlPreset) => void
): DemoTabControls {
  container.style.flexDirection = 'column';
  container.style.height = '100%';
  container.style.minHeight = '0';

  let currentMode = initialMode;
  let currentControls = initialControls;

  const panel = document.createElement('div');
  panel.style.cssText = `
    padding: 12px;
    background: #f5f5f5;
    border-bottom: 1px solid #ddd;
    display: flex;
    gap: 16px;
    align-items: center;
    flex-wrap: wrap;
    font-family: sans-serif;
  `;

  const modeSelect = document.createElement('select');
  modeSelect.innerHTML = `
    <option value="read-only">Read-only</option>
    <option value="editable">Editable</option>
  `;

  const controlsSelect = document.createElement('select');
  controlsSelect.innerHTML = `
    <option value="preview">Preview (Clean)</option>
    <option value="viewer">Viewer</option>
    <option value="standalone-editor">Standalone Editor</option>
    <option value="hosted-editor">Hosted Editor</option>
  `;

  const modeLabel = createSelectLabel('Mode:', modeSelect);
  const controlsLabel = createSelectLabel('Controls:', controlsSelect);
  const infoText = document.createElement('span');
  infoText.style.cssText = 'font-size: 12px; color: #666; flex-grow: 1;';

  const content = document.createElement('div');
  content.style.cssText = `
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `;

  const syncPanel = (): void => {
    modeSelect.value = currentMode;
    controlsSelect.value = currentControls;
    controlsSelect.querySelectorAll('option').forEach((option) => {
      option.disabled = !isValidModeControlsCombination(
        currentMode,
        option.value as MdzipControlPreset
      );
    });
    infoText.textContent = `${modeDescription(currentMode)} - ${controlsDescription(currentControls)}`;
  };

  const applyMode = (mode: MdzipWorkspaceMode): MdzipControlPreset => {
    currentMode = mode;
    if (!isValidModeControlsCombination(currentMode, currentControls)) {
      currentControls = defaultControlsForMode(currentMode);
    }
    syncPanel();
    return currentControls;
  };

  modeSelect.addEventListener('change', () => {
    applyMode(modeSelect.value as MdzipWorkspaceMode);
    onChange(currentMode, currentControls);
  });

  controlsSelect.addEventListener('change', () => {
    currentControls = controlsSelect.value as MdzipControlPreset;
    syncPanel();
    onChange(currentMode, currentControls);
  });

  panel.append(modeLabel, controlsLabel, infoText);
  container.append(panel, content);
  syncPanel();

  return {
    content,
    setMode: applyMode,
    destroy(): void {
      panel.remove();
      content.remove();
    },
  };
}

function createSelectLabel(text: string, select: HTMLSelectElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.style.cssText = 'display: flex; gap: 6px; align-items: center; font-size: 14px;';
  label.append(text, select);
  return label;
}

function isValidModeControlsCombination(
  mode: MdzipWorkspaceMode,
  preset: MdzipControlPreset
): boolean {
  return mode === 'read-only'
    ? preset === 'preview' || preset === 'viewer'
    : preset === 'standalone-editor' || preset === 'hosted-editor';
}

function defaultControlsForMode(mode: MdzipWorkspaceMode): MdzipControlPreset {
  return mode === 'read-only' ? 'viewer' : 'standalone-editor';
}

function modeDescription(mode: MdzipWorkspaceMode): string {
  return mode === 'read-only' ? 'Read-only document' : 'Editable document';
}

function controlsDescription(controls: MdzipControlPreset): string {
  return {
    preview: 'document only',
    viewer: 'minimal UI',
    'standalone-editor': 'full UI',
    'hosted-editor': 'host controls',
  }[controls];
}
