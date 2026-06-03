import { useEffect, useRef } from 'react';
import { MdzipWorkspaceView } from '@mdzip/editor';
import type { MdzipWorkspaceMode } from '@mdzip/editor';

export interface MdzipWorkspaceProps {
  bytes?: Uint8Array | null;
  fileName?: string;
  mode?: MdzipWorkspaceMode;
  onSaved?: (bytes: Uint8Array) => void;
  onFailed?: (error: unknown) => void;
}

export function MdzipWorkspace({
  bytes,
  fileName = 'document.mdz',
  mode = 'read-only',
  onSaved,
  onFailed,
}: MdzipWorkspaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MdzipWorkspaceView | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const view = new MdzipWorkspaceView(ref.current, {
      onSaved: (b) => onSaved?.(b),
      onFailed: (e) => onFailed?.(e),
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, []);

  useEffect(() => {
    if (viewRef.current && bytes) {
      void viewRef.current.open(bytes, { mode, fileName });
    }
  }, [bytes, mode, fileName]);

  return <div ref={ref} style={{ height: '100%', overflow: 'hidden' }} />;
}
