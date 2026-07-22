import type {
  MdzipContentDensity,
  MdzipControlPolicy,
  MdzipControlPreset,
  MdzipImageInsertHandler,
  MdzipImageInsertMode,
  MdzipToolbarDensity,
  MdzipWorkspaceMode,
} from 'mdzip-editor';

export type DemoControls = MdzipControlPreset | MdzipControlPolicy;
export type DemoImageInsertChoice = MdzipImageInsertMode | 'host-html';

export interface DemoImageInsertOptions {
  mode?: MdzipImageInsertMode;
  handler?: MdzipImageInsertHandler;
}

export type DemoDensityChoice = 'comfortable' | 'compact' | 'dense';

export interface DemoDensity {
  toolbarDensity: MdzipToolbarDensity;
  contentDensity: MdzipContentDensity;
}

// contentDensity has no 'dense' value, so the "Dense" preset pairs a dense
// toolbar with the densest content option available (compact).
export const DENSITY_PRESETS: Record<DemoDensityChoice, DemoDensity> = {
  comfortable: { toolbarDensity: 'comfortable', contentDensity: 'comfortable' },
  compact: { toolbarDensity: 'compact', contentDensity: 'compact' },
  dense: { toolbarDensity: 'dense', contentDensity: 'compact' },
};

export const PRESETS: { value: MdzipControlPreset; label: string; description: string }[] = [
  { value: 'preview',           label: 'Preview',    description: 'Read-only · clean output, no chrome'         },
  { value: 'viewer',            label: 'Viewer',     description: 'Read-only · navigation sidebar and toolbar'  },
  { value: 'standalone-editor', label: 'Standalone', description: 'Editable · full editor with save button'     },
  { value: 'hosted-editor',     label: 'Hosted',     description: 'Editable · host app manages saving'          },
];

export function modeFromControls(controls: DemoControls): MdzipWorkspaceMode {
  const preset = typeof controls === 'string' ? controls : controls.preset;
  return preset === 'standalone-editor' || preset === 'hosted-editor' ? 'editable' : 'read-only';
}

export function imageInsertOptionsFromChoice(choice: DemoImageInsertChoice): DemoImageInsertOptions {
  if (choice === 'host-html') {
    return {
      mode: 'markdown',
      handler: (request) => ({
        mode: 'html',
        altText: `Host ${request.defaultAltText}`,
        width: request.intrinsicWidth ? Math.max(240, request.intrinsicWidth) : 240,
        position: 'center',
      }),
    };
  }
  return { mode: choice };
}
