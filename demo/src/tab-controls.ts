import type { MdzipControlPreset, MdzipWorkspaceMode } from 'mdzip-editor';

export const PRESETS: { value: MdzipControlPreset; label: string; description: string }[] = [
  { value: 'preview',           label: 'Preview',    description: 'Read-only · clean output, no chrome'         },
  { value: 'viewer',            label: 'Viewer',     description: 'Read-only · navigation sidebar and toolbar'  },
  { value: 'standalone-editor', label: 'Standalone', description: 'Editable · full editor with save button'     },
  { value: 'hosted-editor',     label: 'Hosted',     description: 'Editable · host app manages saving'          },
];

export function modeFromControls(controls: MdzipControlPreset): MdzipWorkspaceMode {
  return controls === 'standalone-editor' || controls === 'hosted-editor' ? 'editable' : 'read-only';
}
