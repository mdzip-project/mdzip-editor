import { useEffect, useRef } from 'react';
import { MdzipWorkspaceView } from 'mdzip-editor';
import type {
  MdzipControlPolicy,
  MdzipControlPreset,
  MdzipWorkspaceChange,
  MdzipWorkspaceLayout,
  MdzipWorkspaceMode,
  MdzipWorkspaceSave,
} from 'mdzip-editor';

export interface MdzipWorkspaceProps {
  bytes?: Uint8Array | null;
  fileName?: string;
  mode?: MdzipWorkspaceMode;
  controls?: MdzipControlPreset | MdzipControlPolicy;
  initialLayout?: MdzipWorkspaceLayout;
  onChanged?: (event: MdzipWorkspaceChange) => void;
  onSaved?: (event: MdzipWorkspaceSave) => void;
  onFailed?: (error: unknown) => void;
}

export function MdzipWorkspace({
  bytes,
  fileName = 'document.mdz',
  mode = 'read-only',
  controls = 'viewer',
  initialLayout,
  onChanged,
  onSaved,
  onFailed,
}: MdzipWorkspaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MdzipWorkspaceView | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const view = new MdzipWorkspaceView(ref.current, {
      controls,
      initialLayout,
      onChanged: (bytes, snapshot) => onChanged?.({ bytes, snapshot }),
      onSaved: (bytes, snapshot) => onSaved?.({ bytes, snapshot }),
      onFailed: (e) => onFailed?.(e),
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [controls, initialLayout, onChanged, onSaved, onFailed]);

  useEffect(() => {
    if (viewRef.current && bytes) {
      void viewRef.current.open(bytes, { mode, fileName });
    }
  }, [bytes, mode, fileName]);

  return <div ref={ref} style={{ height: '100%', overflow: 'hidden' }} />;
}
