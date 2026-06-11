import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { MdzipWorkspaceView } from '@mdzip/editor';
import type {
  MdzipControlPolicy,
  MdzipControlPreset,
  MdzipColorScheme,
  MdzipConversionAction,
  MdzipDocumentChangeEvent,
  MdzipEditorCommand,
  MdzipEditorSnapshot,
  MdzipNavigationMode,
  MdzipRemoveAssetOptions,
  MdzipSourceFormat,
  MdzipWorkspaceChange,
  MdzipWorkspaceLayout,
  MdzipWorkspaceMode,
  MdzipWorkspaceSave,
  MdzipWorkspaceSnapshot,
  MdzWorkspace,
  MdzWorkspaceAsset,
} from '@mdzip/editor';

export interface MdzipWorkspaceProps {
  bytes?: Uint8Array | null;
  workspace?: MdzWorkspace | null;
  fileName?: string;
  mode?: MdzipWorkspaceMode;
  sourceFormat?: MdzipSourceFormat;
  controls?: MdzipControlPreset | MdzipControlPolicy;
  initialLayout?: MdzipWorkspaceLayout;
  initialColorScheme?: MdzipColorScheme;
  navigationMode?: MdzipNavigationMode;
  navigationButtonActive?: boolean;
  onChanged?: (event: MdzipWorkspaceChange) => void;
  onSaved?: (event: MdzipWorkspaceSave) => void;
  onWorkspaceChanged?: (event: MdzipDocumentChangeEvent) => void;
  onDocumentChanged?: (event: MdzipDocumentChangeEvent) => void;
  onAssetChanged?: (event: MdzipDocumentChangeEvent) => void;
  onManifestChanged?: (event: MdzipDocumentChangeEvent) => void;
  onSnapshotChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onSelectionChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onDirtyChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onValidationChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onColorSchemeChanged?: (colorScheme: MdzipColorScheme) => void;
  onFailed?: (error: unknown) => void;
  /**
   * Host hook for the markdown→MDZ conversion flow. Return/resolve `true`
   * to take over (the built-in conversion dialog is suppressed).
   */
  onConversionRequested?: (action: MdzipConversionAction) => boolean | Promise<boolean>;
}

export interface MdzipWorkspaceHandle {
  canExecuteCommand(command: MdzipEditorCommand): boolean;
  executeCommand(command: MdzipEditorCommand, file?: File): Promise<boolean>;
  convertToMdz(): Promise<boolean>;
  flush(): Promise<MdzipEditorSnapshot | null>;
  serialize(): Promise<Blob | null>;
  getCurrentSnapshot(): Promise<MdzipEditorSnapshot | null>;
  markPersisted(): void;
  addAsset(archivePath: string, fileBytes: Uint8Array): Promise<void>;
  replaceAsset(archivePath: string, fileBytes: Uint8Array): Promise<boolean>;
  removeAsset(archivePath: string, options?: MdzipRemoveAssetOptions): Promise<boolean>;
  removeFile(archivePath: string): Promise<boolean>;
  renameFile(oldPath: string, newPath: string): Promise<boolean>;
  setEntryPoint(archivePath: string): Promise<boolean>;
  setCoverImage(archivePath: string | null): Promise<boolean>;
  listAssets(): MdzWorkspaceAsset[];
  focus(): void;
}

export const MdzipWorkspace = forwardRef<MdzipWorkspaceHandle, MdzipWorkspaceProps>(
function MdzipWorkspace({
  bytes,
  workspace,
  fileName = 'document.mdz',
  mode = 'read-only',
  sourceFormat,
  controls = 'viewer',
  initialLayout,
  initialColorScheme,
  navigationMode,
  navigationButtonActive,
  onChanged,
  onSaved,
  onWorkspaceChanged,
  onDocumentChanged,
  onAssetChanged,
  onManifestChanged,
  onSnapshotChanged,
  onSelectionChanged,
  onDirtyChanged,
  onValidationChanged,
  onColorSchemeChanged,
  onFailed,
  onConversionRequested,
}, forwardedRef) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MdzipWorkspaceView | null>(null);

  useImperativeHandle(forwardedRef, () => ({
    canExecuteCommand: (command) => viewRef.current?.canExecuteCommand(command) ?? false,
    executeCommand: (command, file) =>
      viewRef.current?.executeCommand(command, file) ?? Promise.resolve(false),
    convertToMdz: () => viewRef.current?.convertToMdz() ?? Promise.resolve(false),
    flush: () => viewRef.current?.flush() ?? Promise.resolve(null),
    serialize: () => viewRef.current?.serialize() ?? Promise.resolve(null),
    getCurrentSnapshot: () => viewRef.current?.getCurrentSnapshot() ?? Promise.resolve(null),
    markPersisted: () => viewRef.current?.markPersisted(),
    addAsset: (archivePath, fileBytes) =>
      viewRef.current?.addAsset(archivePath, fileBytes) ?? Promise.resolve(),
    replaceAsset: (archivePath, fileBytes) =>
      viewRef.current?.replaceAsset(archivePath, fileBytes) ?? Promise.resolve(false),
    removeAsset: (archivePath, options) =>
      viewRef.current?.removeAsset(archivePath, options) ?? Promise.resolve(false),
    removeFile: (archivePath) =>
      viewRef.current?.removeFile(archivePath) ?? Promise.resolve(false),
    renameFile: (oldPath, newPath) =>
      viewRef.current?.renameFile(oldPath, newPath) ?? Promise.resolve(false),
    setEntryPoint: (archivePath) =>
      viewRef.current?.setEntryPoint(archivePath) ?? Promise.resolve(false),
    setCoverImage: (archivePath) =>
      viewRef.current?.setCoverImage(archivePath) ?? Promise.resolve(false),
    listAssets: () => viewRef.current?.listAssets() ?? [],
    focus: () => viewRef.current?.focus()
  }), []);

  useEffect(() => {
    if (!ref.current) return;
    const view = new MdzipWorkspaceView(ref.current, {
      controls,
      initialLayout,
      initialColorScheme,
      navigationMode,
      navigationButtonActive,
      onChanged: (bytes, snapshot) => onChanged?.({ bytes, snapshot }),
      onSaved: (bytes, snapshot) => onSaved?.({ bytes, snapshot }),
      onWorkspaceChanged,
      onDocumentChanged,
      onAssetChanged,
      onManifestChanged,
      onSnapshotChanged,
      onSelectionChanged,
      onDirtyChanged,
      onValidationChanged,
      onColorSchemeChanged,
      onFailed: (e) => onFailed?.(e),
      onConversionRequested,
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [
    controls,
    initialLayout,
    initialColorScheme,
    navigationMode,
    navigationButtonActive,
    onChanged,
    onSaved,
    onWorkspaceChanged,
    onDocumentChanged,
    onAssetChanged,
    onManifestChanged,
    onSnapshotChanged,
    onSelectionChanged,
    onDirtyChanged,
    onValidationChanged,
    onColorSchemeChanged,
    onFailed,
    onConversionRequested
  ]);

  useEffect(() => {
    if (viewRef.current && workspace) {
      void viewRef.current.openWorkspace(workspace, { mode, sourceFormat, fileName });
    } else if (viewRef.current && bytes) {
      void viewRef.current.open(bytes, { mode, sourceFormat, fileName });
    }
  }, [bytes, workspace, mode, sourceFormat, fileName]);

  return <div ref={ref} style={{ height: '100%', overflow: 'hidden' }} />;
});
