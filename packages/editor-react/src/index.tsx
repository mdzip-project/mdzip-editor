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

  // Callbacks and content are read through refs at event/recreate time so
  // that new prop identities (e.g. inline handlers) never force a view
  // rebuild — only the view-config props below do.
  const callbacksRef = useRef({
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
  });
  callbacksRef.current = {
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
  };

  const contentRef = useRef({ bytes, workspace, mode, sourceFormat, fileName });
  contentRef.current = { bytes, workspace, mode, sourceFormat, fileName };

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

  const firstCreateRef = useRef(true);

  useEffect(() => {
    if (!ref.current) return;
    const view = new MdzipWorkspaceView(ref.current, {
      controls,
      initialLayout,
      initialColorScheme,
      navigationMode,
      navigationButtonActive,
      onChanged: (bytes, snapshot) => callbacksRef.current.onChanged?.({ bytes, snapshot }),
      onSaved: (bytes, snapshot) => callbacksRef.current.onSaved?.({ bytes, snapshot }),
      onWorkspaceChanged: (event) => callbacksRef.current.onWorkspaceChanged?.(event),
      onDocumentChanged: (event) => callbacksRef.current.onDocumentChanged?.(event),
      onAssetChanged: (event) => callbacksRef.current.onAssetChanged?.(event),
      onManifestChanged: (event) => callbacksRef.current.onManifestChanged?.(event),
      onSnapshotChanged: (snapshot) => callbacksRef.current.onSnapshotChanged?.(snapshot),
      onSelectionChanged: (snapshot) => callbacksRef.current.onSelectionChanged?.(snapshot),
      onDirtyChanged: (snapshot) => callbacksRef.current.onDirtyChanged?.(snapshot),
      onValidationChanged: (snapshot) => callbacksRef.current.onValidationChanged?.(snapshot),
      onColorSchemeChanged: (colorScheme) => callbacksRef.current.onColorSchemeChanged?.(colorScheme),
      onFailed: (e) => callbacksRef.current.onFailed?.(e),
      // A hook returning false falls back to the built-in dialog, same as no
      // hook at all, so the always-present delegate is behavior-preserving.
      onConversionRequested: (action) => callbacksRef.current.onConversionRequested?.(action) ?? false,
    });
    viewRef.current = view;
    if (firstCreateRef.current) {
      // Initial open is handled by the content effect below.
      firstCreateRef.current = false;
    } else {
      const content = contentRef.current;
      const openOptions = {
        mode: content.mode,
        sourceFormat: content.sourceFormat,
        fileName: content.fileName,
      };
      if (content.workspace) {
        void view.openWorkspace(content.workspace, openOptions);
      } else if (content.bytes) {
        void view.open(content.bytes, openOptions);
      }
    }
    return () => { view.destroy(); viewRef.current = null; };
  }, [
    controls,
    initialLayout,
    initialColorScheme,
    navigationMode,
    navigationButtonActive
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
