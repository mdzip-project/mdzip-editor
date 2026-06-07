import { MdzipWorkspaceView, type MdzipControlPreset } from 'mdzip-editor';
import type { TabController } from '../tab-controller.js';

export function initRaw(
  container: HTMLElement,
  onSaved: (b: Uint8Array, fileName?: string) => void,
  onFailed: (e: unknown) => void
): TabController {
  container.style.flexDirection = 'column';
  container.style.height = '100%';
  container.style.minHeight = '0';

  let currentBytes = new Uint8Array();
  let currentMode: 'read-only' | 'editable' = 'read-only';
  let currentFileName = 'document.mdz';
  let currentControls: MdzipControlPreset = 'viewer';

  function isValidModeControlsCombination(mode: 'read-only' | 'editable', preset: MdzipControlPreset): boolean {
    if (mode === 'read-only') {
      return preset === 'preview' || preset === 'viewer';
    } else {
      return preset === 'standalone-editor' || preset === 'hosted-editor';
    }
  }

  const controlPanel = document.createElement('div');
  controlPanel.style.cssText = `
    padding: 12px;
    background: #f5f5f5;
    border-bottom: 1px solid #ddd;
    display: flex;
    gap: 16px;
    align-items: center;
    flex-wrap: wrap;
    font-family: sans-serif;
  `;

  // Controls preset selector (must be created before mode selector to be available in updateControlsAvailability)
  const controlsLabel = document.createElement('label');
  controlsLabel.style.cssText = 'display: flex; gap: 6px; align-items: center; font-size: 14px;';
  controlsLabel.innerHTML = 'Controls:';
  const controlsSelect = document.createElement('select');
  controlsSelect.innerHTML = `
    <option value="preview">Preview (Clean)</option>
    <option value="viewer">Viewer</option>
    <option value="standalone-editor">Standalone Editor</option>
    <option value="hosted-editor">Hosted Editor</option>
  `;
  controlsSelect.value = currentControls;

  function updateControlsAvailability() {
    const options = controlsSelect.querySelectorAll('option');
    options.forEach(option => {
      const preset = option.value as MdzipControlPreset;
      const isValid = isValidModeControlsCombination(currentMode, preset);
      option.disabled = !isValid;
    });
  }

  controlsSelect.onchange = () => {
    const newControls = controlsSelect.value as MdzipControlPreset;
    currentControls = newControls;
    updateView();
  };

  controlsLabel.appendChild(controlsSelect);

  // Mode selector
  const modeLabel = document.createElement('label');
  modeLabel.style.cssText = 'display: flex; gap: 6px; align-items: center; font-size: 14px;';
  modeLabel.innerHTML = 'Mode:';
  const modeSelect = document.createElement('select');
  modeSelect.innerHTML = '<option value="read-only">Read-only</option><option value="editable">Editable</option>';
  modeSelect.value = currentMode;
  modeSelect.onchange = () => {
    const newMode = modeSelect.value as 'read-only' | 'editable';
    const isValid = isValidModeControlsCombination(newMode, currentControls);

    if (!isValid) {
      // Auto-adjust controls to a valid preset for the new mode
      if (newMode === 'read-only') {
        currentControls = 'viewer';
      } else {
        currentControls = 'standalone-editor';
      }
      controlsSelect.value = currentControls;
    }

    currentMode = newMode;
    updateControlsAvailability();
    updateView();
  };
  modeLabel.appendChild(modeSelect);
  controlPanel.appendChild(modeLabel);
  controlPanel.appendChild(controlsLabel);
  updateControlsAvailability();

  // Info text
  const infoText = document.createElement('span');
  infoText.style.cssText = 'font-size: 12px; color: #666; flex-grow: 1;';
  updateInfoText();
  controlPanel.appendChild(infoText);

  function updateInfoText() {
    const modeDesc = currentMode === 'read-only' ? '📖' : '✏️';
    const controlDesc = {
      'preview': '👁️ Document Only',
      'viewer': '👁️ Minimal UI',
      'standalone-editor': '🖥️ Full UI',
      'hosted-editor': '🔧 Host Controls',
    }[currentControls];
    infoText.textContent = `${modeDesc} ${controlDesc}`;
  }

  const viewerContainer = document.createElement('div');
  viewerContainer.style.cssText = `
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `;

  container.appendChild(controlPanel);
  container.appendChild(viewerContainer);

  let view = new MdzipWorkspaceView(viewerContainer, {
    controls: currentControls,
    onSaved: (bytes, snapshot) => {
      onSaved(bytes, snapshot.fileName);
      view.markPersisted();
    },
    onFailed,
  });
  let lastControls = currentControls;

  function updateView() {
    updateInfoText();
    // If controls changed, recreate the view to apply new control policy
    if (lastControls !== currentControls) {
      view.destroy();
      view = new MdzipWorkspaceView(viewerContainer, {
        controls: currentControls,
        onSaved: (bytes, snapshot) => {
          onSaved(bytes, snapshot.fileName);
          view.markPersisted();
        },
        onFailed,
      });
      lastControls = currentControls;
    }
    view.open(currentBytes, {
      mode: currentMode,
      fileName: currentFileName,
    });
  }

  return {
    update: (bytes, mode, fileName) => {
      currentBytes = bytes;
      currentMode = mode;
      currentFileName = fileName;
      modeSelect.value = mode;
      updateControlsAvailability();
      updateView();
    },
    markPersisted: () => view.markPersisted(),
    destroy: () => view.destroy(),
  };
}
