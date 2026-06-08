import {
  MdzArchiveCore,
  MdzPackagerCore,
  type MdzManifest,
  type MdzValidationResult,
  type MdzValidationStatus,
  type MdzWorkspace,
  type MdzWorkspaceAsset
} from 'mdzip-core-js';
import {
  buildNewArchiveBytesWithTitle,
  blobToBytes,
  openedArchiveFromWorkspace,
  readBinaryFileFromArchive,
  type ArchiveEntry,
  type OpenedArchive
} from './archive-utils.js';
import {
  displayTitleFromManifest,
  fileBaseNameFromPath,
  firstMarkdownHeading,
  suggestedTitleFromMarkdown
} from './metadata.js';

export type MdzipWorkspaceMode = 'read-only' | 'editable';
export type MdzipSourceFormat = 'mdz' | 'markdown';
export type MdzipPathType = 'markdown' | 'text' | 'image' | 'binary';
export type MdzipChangeReason = 'edit' | 'reload';
export type MdzipWorkspaceChangeKind =
  | 'workspace'
  | 'document'
  | 'asset'
  | 'manifest'
  | 'selection'
  | 'persistence';

export interface MdzipWorkspaceOpenOptions {
  mode?: MdzipWorkspaceMode;
  sourceFormat?: MdzipSourceFormat;
  fileName?: string;
}

export interface MdzipWorkspaceSnapshot {
  mode: MdzipWorkspaceMode;
  sourceFormat: MdzipSourceFormat;
  fileName: string;
  archiveBytes: Uint8Array;
  /**
   * The underlying `MdzWorkspace` object.
   *
   * The runtime object carries additional fields beyond what the TypeScript type
   * declares: `validation` (required by `getValidationStatus`),
   * `orphanedAssets` (used for orphan detection), and `asset.kind` on each
   * asset entry. If you serialise and re-hydrate this object, spread the full
   * runtime value rather than reconstructing it from declared fields only, or
   * these operations will fail with runtime errors.
   */
  workspace: MdzWorkspace;
  content: OpenedArchive;
  currentText: string;
  currentPath: string;
  currentPathType: MdzipPathType;
  dirty: boolean;
  displayTitle: string;
  headingFallback?: string;
  suggestedTitle: string;
  validation: MdzValidationResult;
  validationStatus: MdzValidationStatus;
}

export interface MdzipEditorHostState {
  dirty: boolean;
  validation: MdzValidationResult;
  validationStatus: MdzValidationStatus;
  title: string | null;
  displayTitle: string;
  fileName: string;
  currentPath: string | null;
  sourceFormat: MdzipSourceFormat;
  mode: MdzWorkspace['mode'];
}

export interface MdzipEditorSnapshot {
  workspace: MdzWorkspace;
  bytes: Blob;
  state: MdzipEditorHostState;
}

export interface MdzipDocumentChangeEvent {
  reason: MdzipChangeReason;
  changes: MdzipWorkspaceChangeKind[];
  path?: string;
  snapshot: MdzipWorkspaceSnapshot;
}

export interface MdzipPasteImageOptions {
  bytes: Uint8Array;
  mimeType: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface MdzipPasteImageResult {
  archivePath: string;
  markdownPath: string;
  markdownImage: string;
  text: string;
  cursor: number;
}

export interface MdzipRemoveAssetOptions {
  requireOrphaned?: boolean;
}

export type MdzipDocumentChangeListener = (event: MdzipDocumentChangeEvent) => void;

export class MdzipReadOnlyError extends Error {
  public constructor(operation: string) {
    super(`Cannot ${operation}: workspace is read-only.`);
    this.name = 'MdzipReadOnlyError';
  }
}

export class MdzipWorkspaceService {
  private readonly listeners = new Set<MdzipDocumentChangeListener>();
  private archiveBytes: Uint8Array;
  private workspaceValue: MdzWorkspace;
  private contentValue: OpenedArchive;
  private currentTextValue = '';
  private currentPathValue = 'index.md';
  private currentPathTypeValue: MdzipPathType = 'markdown';
  private dirtyValue = false;
  private pendingTextDirty = false;
  private sourceFormatValue: MdzipSourceFormat;
  private readonly modeValue: MdzipWorkspaceMode;
  private fileName: string;
  // Orphaned paths derived from the current in-memory text; null means use contentValue.
  private liveOrphanedPaths: string[] | null = null;

  private constructor(
    bytes: Uint8Array,
    workspace: MdzWorkspace,
    content: OpenedArchive,
    options: Required<MdzipWorkspaceOpenOptions>
  ) {
    this.archiveBytes = bytes;
    this.workspaceValue = workspace;
    this.contentValue = content;
    this.currentTextValue = content.markdownText;
    this.currentPathValue = content.entryPoint;
    this.sourceFormatValue = options.sourceFormat;
    this.modeValue = options.mode;
    this.fileName = options.fileName;
  }

  public static async open(
    bytes: Uint8Array,
    options: MdzipWorkspaceOpenOptions = {}
  ): Promise<MdzipWorkspaceService> {
    const fileName = options.fileName ?? 'document.mdz';
    const resolvedOptions: Required<MdzipWorkspaceOpenOptions> = {
      mode: options.mode ?? 'editable',
      sourceFormat: options.sourceFormat ?? inferMdzipSourceFormat(bytes, fileName),
      fileName
    };

    if (resolvedOptions.sourceFormat === 'markdown') {
      const markdown = new TextDecoder('utf-8').decode(bytes);
      const title = suggestedTitleFromMarkdown(markdown, fileBaseNameFromPath(resolvedOptions.fileName));
      const archiveBytes = await buildNewArchiveBytesWithTitle(markdown, title);
      const coreWorkspace = await MdzArchiveCore.openWorkspace(archiveBytes, {
        includeOrphanedAssetAnalysis: true
      });
      const workspace = new MdzipWorkspaceService(
        archiveBytes,
        coreWorkspace,
        await openedArchiveFromWorkspace(coreWorkspace),
        resolvedOptions
      );
      workspace.currentTextValue = markdown;
      return workspace;
    }

    const coreWorkspace = await MdzArchiveCore.openWorkspace(bytes, {
      includeOrphanedAssetAnalysis: true
    });
    return new MdzipWorkspaceService(bytes, coreWorkspace, await openedArchiveFromWorkspace(coreWorkspace), resolvedOptions);
  }

  public static async openWorkspace(
    workspace: MdzWorkspace,
    options: MdzipWorkspaceOpenOptions = {}
  ): Promise<MdzipWorkspaceService> {
    const resolvedOptions: Required<MdzipWorkspaceOpenOptions> = {
      mode: options.mode ?? 'editable',
      sourceFormat: options.sourceFormat ?? 'mdz',
      fileName: options.fileName ?? 'document.mdz'
    };
    return new MdzipWorkspaceService(
      new Uint8Array(),
      workspace,
      await openedArchiveFromWorkspace(workspace),
      resolvedOptions
    );
  }

  public subscribe(listener: MdzipDocumentChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public snapshot(): MdzipWorkspaceSnapshot {
    const fileBaseName = fileBaseNameFromPath(this.fileName);
    const manifestTitle = this.sourceFormatValue === 'mdz'
      ? this.contentValue.manifest?.title
      : undefined;
    const archiveContent = this.liveOrphanedPaths !== null
      ? { ...this.contentValue, orphanedAssetPaths: this.liveOrphanedPaths }
      : this.contentValue;
    const content = this.sourceFormatValue === 'markdown'
      ? {
          ...archiveContent,
          paths: [{
            path: fileNameFromPath(this.fileName),
            isMarkdown: true,
            isImage: false,
            isDirectory: false
          }],
          entryPoint: fileNameFromPath(this.fileName),
          manifest: null,
          images: new Map<string, string>(),
          orphanedAssetPaths: []
        }
      : archiveContent;
    return {
      mode: this.modeValue,
      sourceFormat: this.sourceFormatValue,
      fileName: this.fileName,
      archiveBytes: this.archiveBytes,
      workspace: this.workspaceValue,
      content,
      currentText: this.currentTextValue,
      currentPath: this.currentPathValue,
      currentPathType: this.currentPathTypeValue,
      dirty: this.dirtyValue,
      displayTitle: displayTitleFromManifest(manifestTitle, fileBaseName),
      headingFallback: firstMarkdownHeading(this.currentTextValue),
      suggestedTitle: suggestedTitleFromMarkdown(this.currentTextValue, fileBaseName),
      validation: this.contentValue.validation,
      validationStatus: MdzArchiveCore.getValidationStatus(this.contentValue.validation)
    };
  }

  public hostState(): MdzipEditorHostState {
    const snapshot = this.snapshot();
    return {
      dirty: snapshot.dirty,
      validation: snapshot.validation,
      validationStatus: snapshot.validationStatus,
      title: this.workspaceValue.title,
      displayTitle: snapshot.displayTitle,
      fileName: snapshot.fileName,
      currentPath: snapshot.currentPath || null,
      sourceFormat: snapshot.sourceFormat,
      mode: this.workspaceValue.mode
    };
  }

  public get mode(): MdzipWorkspaceMode {
    return this.modeValue;
  }

  public get sourceFormat(): MdzipSourceFormat {
    return this.sourceFormatValue;
  }

  public get content(): OpenedArchive {
    return this.contentValue;
  }

  public get workspace(): MdzWorkspace {
    return this.workspaceValue;
  }

  public get currentText(): string {
    return this.currentTextValue;
  }

  public get currentPath(): string {
    return this.currentPathValue;
  }

  public get currentPathType(): MdzipPathType {
    return this.currentPathTypeValue;
  }

  public get dirty(): boolean {
    return this.dirtyValue;
  }

  public async convertToMdz(): Promise<boolean> {
    this.assertEditable('convert to MDZ');
    if (this.sourceFormatValue === 'mdz') {
      return false;
    }
    const archiveBytes = await this.archiveBytesWithPendingText();
    await this.reloadPreservingCurrentText(archiveBytes);
    this.sourceFormatValue = 'mdz';
    this.fileName = mdzFileNameFromMarkdown(this.fileName);
    this.dirtyValue = true;
    this.emit('edit', ['workspace']);
    return true;
  }

  public editText(newText: string): void {
    this.assertEditable('edit text');
    if (!isEditableTextPath(this.currentPathTypeValue, this.currentPathValue)) {
      return;
    }
    this.currentTextValue = newText;
    this.dirtyValue = true;
    this.liveOrphanedPaths = this.computeLiveOrphanedPaths(newText);
    this.emit('edit', ['document'], this.currentPathValue);
  }

  public async openPath(archivePath: string): Promise<boolean> {
    const target = this.findPath(archivePath);
    if (!target) {
      return false;
    }

    const nextType = pathTypeForEntry(target);
    if (target.path === this.currentPathValue && nextType === this.currentPathTypeValue) {
      return true;
    }

    this.currentPathValue = target.path;
    this.currentPathTypeValue = nextType;

    if (target.isImage) {
      this.currentTextValue = '';
      this.emit('reload', ['selection'], target.path);
      return true;
    }

    const bytes = await this.readWorkspacePathBytes(target.path);
    if (!bytes) {
      return false;
    }
    this.currentTextValue = new TextDecoder('utf-8').decode(bytes);
    this.currentPathTypeValue = isLikelyBinary(bytes) ? 'binary' : nextType;
    this.emit('reload', ['selection'], target.path);
    return true;
  }

  public async readPathBytes(archivePath: string): Promise<Uint8Array | undefined> {
    const target = this.findPath(archivePath);
    if (!target) {
      return undefined;
    }
    return this.readWorkspacePathBytes(target.path);
  }

  public async addAsset(archivePath: string, fileBytes: Uint8Array): Promise<void> {
    this.assertEditable('add asset');
    this.commitPendingTextToWorkspace();
    const asset = await MdzPackagerCore.createWorkspaceAssetFromFile(fileBytes, archivePath);
    this.upsertWorkspaceAsset(asset);
    await this.reloadPreservingCurrentText(await this.serializeWorkspaceBytes());
    this.dirtyValue = true;
    this.emit('edit', ['asset'], archivePath);
  }

  public async replaceAsset(archivePath: string, fileBytes: Uint8Array): Promise<boolean> {
    this.assertEditable('replace asset');
    if (!this.findPath(archivePath)) {
      return false;
    }
    await this.addAsset(archivePath, fileBytes);
    return true;
  }

  public async removeAsset(
    archivePath: string,
    options: MdzipRemoveAssetOptions = {}
  ): Promise<boolean> {
    this.assertEditable('remove asset');
    const target = this.findPath(archivePath);
    if (!target || !this.workspaceValue.assets.some((asset) => asset.path.toLowerCase() === target.path.toLowerCase())) {
      return false;
    }
    this.commitPendingTextToWorkspace();
    if (options.requireOrphaned) {
      const orphaned = this.workspaceValue.orphanedAssets?.orphanedAssetPaths ?? this.contentValue.orphanedAssetPaths;
      if (!new Set(orphaned.map((path) => path.toLowerCase())).has(target.path.toLowerCase())) {
        return false;
      }
    }

    this.workspaceValue.assets = this.workspaceValue.assets.filter((asset) => asset.path.toLowerCase() !== target.path.toLowerCase());
    await this.reloadPreservingCurrentText(await this.serializeWorkspaceBytes(), target.path);
    this.dirtyValue = true;
    this.emit('edit', ['asset'], target.path);
    return true;
  }

  public listAssets(): MdzWorkspaceAsset[] {
    return this.workspaceValue.assets.slice();
  }

  /**
   * Embeds a pasted image into the current `.mdz` document and rebuilds the archive.
   *
   * Returns `null` — without throwing — when `sourceFormat` is `'markdown'`.
   * Markdown source files do not support embedded images; hosts should intercept
   * paste events and call `executeCommand('insert-image')` to show the MDZ
   * conversion dialog instead.
   *
   * Note: this method always calls `serializeWorkspaceBytes()` (full ZIP rebuild)
   * when text changes. For large documents this can take several hundred
   * milliseconds in the browser.
   */
  public async pasteImage(options: MdzipPasteImageOptions): Promise<MdzipPasteImageResult | null> {
    this.assertEditable('paste image');
    if (this.sourceFormatValue === 'markdown'
      || !isEditableTextPath(this.currentPathTypeValue, this.currentPathValue)
      || this.currentPathTypeValue !== 'markdown') {
      return null;
    }

    const extension = extensionForMime(options.mimeType);
    const archivePath = nextPastedImagePath(this.snapshot(), extension);
    const markdownPath = relativeMarkdownAssetPath(this.currentPathValue, archivePath);
    const markdownImage = `![Pasted image](${markdownPath})`;
    const start = Math.max(0, Math.min(options.selectionStart, this.currentTextValue.length));
    const end = Math.max(start, Math.min(options.selectionEnd, this.currentTextValue.length));
    const text = `${this.currentTextValue.slice(0, start)}${markdownImage}${this.currentTextValue.slice(end)}`;
    const cursor = start + markdownImage.length;

    this.currentTextValue = text;
    this.commitPendingTextToWorkspace();
    this.upsertWorkspaceAsset(await MdzPackagerCore.createWorkspaceAssetFromFile(options.bytes, archivePath));
    await this.reloadPreservingCurrentText(await this.serializeWorkspaceBytes());
    this.dirtyValue = true;
    this.emit('edit', ['document', 'asset'], archivePath);

    return {
      archivePath,
      markdownPath,
      markdownImage,
      text,
      cursor
    };
  }

  public async setManifestTitle(newTitle: string): Promise<void> {
    this.assertEditable('set manifest title');
    this.commitPendingTextToWorkspace();
    this.workspaceValue.manifest = MdzPackagerCore.updateManifest(this.workspaceValue.manifest, { title: newTitle });
    this.workspaceValue.title = newTitle;
    await this.reloadPreservingCurrentText(await this.serializeWorkspaceBytes());
    this.dirtyValue = true;
    this.emit('edit', ['manifest'], 'manifest.json');
  }

  public async saveToBytes(): Promise<Uint8Array> {
    this.assertEditable('save');
    const nextArchiveBytes = await this.archiveBytesWithPendingText();
    await this.reload(nextArchiveBytes);
    this.dirtyValue = false;
    return this.outputBytes();
  }

  public async exportBytes(): Promise<Uint8Array> {
    const archiveBytes = await this.archiveBytesWithPendingText();
    return this.outputBytes(archiveBytes);
  }

  public async serialize(): Promise<Blob> {
    return bytesToBlob(await this.exportBytes(), this.sourceFormatValue);
  }

  public async flush(): Promise<MdzipEditorSnapshot> {
    const archiveBytes = await this.archiveBytesWithPendingText();
    await this.reloadPreservingCurrentText(archiveBytes);
    return this.editorSnapshot(this.outputBytes());
  }

  public async getCurrentSnapshot(): Promise<MdzipEditorSnapshot> {
    const archiveBytes = await this.archiveBytesWithPendingText();
    return this.editorSnapshot(this.outputBytes(archiveBytes));
  }

  public markPersisted(): void {
    if (!this.dirtyValue) {
      return;
    }
    this.dirtyValue = false;
    this.emit('reload', ['persistence']);
  }

  public manifest(): MdzManifest | null {
    return this.sourceFormatValue === 'mdz' ? this.contentValue.manifest : null;
  }

  private async archiveBytesWithPendingText(): Promise<Uint8Array> {
    if (!isEditableTextPath(this.currentPathTypeValue, this.currentPathValue)) {
      return this.archiveBytes;
    }
    this.commitPendingTextToWorkspace();
    // If archiveBytes is empty, we're in the openWorkspace() path and must serialize.
    // Empty bytes is a signal that bytes were never populated, not a valid zero-byte archive.
    if (!this.pendingTextDirty && this.archiveBytes.length > 0) {
      return this.archiveBytes;
    }
    return this.serializeWorkspaceBytes();
  }

  private outputBytes(archiveBytes: Uint8Array = this.archiveBytes): Uint8Array {
    return this.sourceFormatValue === 'markdown'
      ? new TextEncoder().encode(this.currentTextValue)
      : archiveBytes;
  }

  private async reload(bytes: Uint8Array): Promise<void> {
    this.archiveBytes = bytes;
    this.workspaceValue = await MdzArchiveCore.openWorkspace(bytes, {
      includeOrphanedAssetAnalysis: true
    });
    this.contentValue = await openedArchiveFromWorkspace(this.workspaceValue);
    this.currentTextValue = this.contentValue.markdownText;
    this.currentPathValue = this.contentValue.entryPoint;
    this.currentPathTypeValue = 'markdown';
    this.liveOrphanedPaths = null;
  }

  private async reloadPreservingCurrentText(bytes: Uint8Array, removedPath?: string): Promise<void> {
    const currentText = this.currentTextValue;
    const currentPath = this.currentPathValue;
    const currentPathType = this.currentPathTypeValue;
    this.archiveBytes = bytes;
    this.workspaceValue = await MdzArchiveCore.openWorkspace(bytes, {
      includeOrphanedAssetAnalysis: true
    });
    this.contentValue = await openedArchiveFromWorkspace(this.workspaceValue);
    this.liveOrphanedPaths = null;
    this.pendingTextDirty = false;

    if (removedPath && currentPath.toLowerCase() === removedPath.toLowerCase()) {
      this.currentTextValue = this.contentValue.markdownText;
      this.currentPathValue = this.contentValue.entryPoint;
      this.currentPathTypeValue = 'markdown';
      return;
    }

    this.currentTextValue = currentText;
    this.currentPathValue = currentPath;
    this.currentPathTypeValue = currentPathType;
  }

  private findPath(archivePath: string): ArchiveEntry | undefined {
    return this.contentValue.paths.find(
      (entry) => entry.path.toLowerCase() === archivePath.toLowerCase()
    );
  }

  private commitPendingTextToWorkspace(): void {
    if (!isEditableTextPath(this.currentPathTypeValue, this.currentPathValue)) {
      return;
    }
    const document = this.workspaceValue.documents.find((doc) => doc.path.toLowerCase() === this.currentPathValue.toLowerCase());
    if (document) {
      if (document.text !== this.currentTextValue) {
        document.text = this.currentTextValue;
        this.pendingTextDirty = true;
      }
      return;
    }
    const asset = this.workspaceValue.assets.find((item) => item.path.toLowerCase() === this.currentPathValue.toLowerCase());
    if (asset) {
      const bytes = new TextEncoder().encode(this.currentTextValue);
      const newByteSize = bytes.byteLength;
      if (asset.byteSize !== newByteSize) {
        asset.bytes = bytes;
        asset.byteSize = newByteSize;
        delete asset.readBytes;
        delete asset.readDataUri;
        this.pendingTextDirty = true;
      }
    }
  }

  private async serializeWorkspaceBytes(): Promise<Uint8Array> {
    return blobToBytes((await MdzPackagerCore.buildWorkspace(this.workspaceValue)).blob);
  }

  private upsertWorkspaceAsset(asset: MdzWorkspaceAsset): void {
    const lower = asset.path.toLowerCase();
    this.workspaceValue.assets = [
      ...this.workspaceValue.assets.filter((existing) => existing.path.toLowerCase() !== lower),
      asset
    ].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
  }

  private async readWorkspacePathBytes(archivePath: string): Promise<Uint8Array | undefined> {
    if (archivePath.toLowerCase() === 'manifest.json' && this.workspaceValue.manifest) {
      return new TextEncoder().encode(JSON.stringify(this.workspaceValue.manifest, null, 2));
    }
    const document = this.workspaceValue.documents.find((doc) => doc.path.toLowerCase() === archivePath.toLowerCase());
    if (document) {
      return new TextEncoder().encode(document.text);
    }
    const asset = this.workspaceValue.assets.find((item) => item.path.toLowerCase() === archivePath.toLowerCase());
    if (asset?.bytes) {
      const bytes = asset.bytes instanceof Uint8Array
        ? asset.bytes
        : new Uint8Array(await new Blob([asset.bytes]).arrayBuffer());
      return bytes;
    }
    if (asset?.readBytes) {
      return asset.readBytes();
    }
    return readBinaryFileFromArchive(this.archiveBytes, archivePath);
  }

  private editorSnapshot(bytes: Uint8Array): MdzipEditorSnapshot {
    return {
      workspace: this.workspaceValue,
      bytes: bytesToBlob(bytes, this.sourceFormatValue),
      state: this.hostState()
    };
  }

  private assertEditable(operation: string): void {
    if (this.modeValue === 'read-only') {
      throw new MdzipReadOnlyError(operation);
    }
  }

  private computeLiveOrphanedPaths(markdownText: string): string[] {
    const baseDir = this.currentPathValue.includes('/')
      ? this.currentPathValue.slice(0, this.currentPathValue.lastIndexOf('/') + 1)
      : '';
    const referenced = referencedImagePaths(markdownText, baseDir);
    return this.contentValue.paths
      .filter((e) => e.isImage && !referenced.has(e.path))
      .map((e) => e.path);
  }

  private emit(
    reason: MdzipChangeReason,
    changes: MdzipWorkspaceChangeKind[],
    path?: string
  ): void {
    const event: MdzipDocumentChangeEvent = {
      reason,
      changes,
      ...(path ? { path } : {}),
      snapshot: this.snapshot()
    };
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

// Extract all image archive paths referenced in markdown text.
// Handles relative paths by resolving against baseDir (the directory of the current file).
function referencedImagePaths(markdown: string, baseDir: string): Set<string> {
  const refs = new Set<string>();
  const regex = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const raw = (match[1] ?? '').replace(/^<|>$/g, '').split(/[?#]/)[0] ?? '';
    const decoded = decodeURIComponent(raw);
    // Store both the raw form and the baseDir-resolved form so either lookup hits.
    refs.add(decoded);
    refs.add(decoded.replace(/^\.\//, ''));
    const resolved = decoded.startsWith('/') ? decoded.slice(1) : `${baseDir}${decoded.replace(/^\.\//, '')}`;
    refs.add(resolved);
  }
  return refs;
}

function pathTypeForEntry(entry: { isMarkdown: boolean; isImage: boolean }): MdzipPathType {
  if (entry.isImage) {
    return 'image';
  }
  if (entry.isMarkdown) {
    return 'markdown';
  }
  return 'text';
}

function isLikelyBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return false;
  }

  let suspicious = 0;
  const sampleSize = Math.min(bytes.length, 2048);
  for (let i = 0; i < sampleSize; i += 1) {
    const value = bytes[i];
    if (value === 0) {
      return true;
    }
    if (value < 9 || (value > 13 && value < 32)) {
      suspicious += 1;
    }
  }

  return suspicious / sampleSize > 0.15;
}

function isEditableTextPath(currentPathType: MdzipPathType, archivePath: string): boolean {
  if (currentPathType !== 'markdown' && currentPathType !== 'text') {
    return false;
  }
  const lower = archivePath.toLowerCase();
  const fileName = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower;
  return fileName !== 'manifest.json';
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || 'document.md';
}

function mdzFileNameFromMarkdown(fileName: string): string {
  if (/\.(?:md|markdown|mdown|mkd)$/i.test(fileName)) {
    return fileName.replace(/\.(?:md|markdown|mdown|mkd)$/i, '.mdz');
  }
  return fileName.toLowerCase().endsWith('.mdz') ? fileName : `${fileName}.mdz`;
}

export function extensionForMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    case 'image/png':
    default:
      return 'png';
  }
}

function nextPastedImagePath(state: MdzipWorkspaceSnapshot, extension: string): string {
  const baseDir = state.currentPath.includes('/')
    ? state.currentPath.slice(0, state.currentPath.lastIndexOf('/') + 1)
    : '';
  const folder = `${baseDir}images/`;
  const seed = `pasted-${Date.now()}`;
  const existing = new Set(state.content.paths.map((entry) => entry.path.toLowerCase()));

  let candidate = `${folder}${seed}.${extension}`;
  let counter = 1;
  while (existing.has(candidate.toLowerCase())) {
    candidate = `${folder}${seed}-${counter}.${extension}`;
    counter += 1;
  }
  return candidate;
}

function relativeMarkdownAssetPath(markdownPath: string, archivePath: string): string {
  const baseDir = markdownPath.includes('/')
    ? markdownPath.slice(0, markdownPath.lastIndexOf('/') + 1)
    : '';
  return archivePath.startsWith(baseDir) ? archivePath.slice(baseDir.length) : archivePath;
}

export function inferMdzipSourceFormat(
  bytes: Uint8Array,
  fileName?: string
): MdzipSourceFormat {
  const lowerName = fileName?.trim().toLowerCase() ?? '';
  if (/\.(?:md|markdown|mdown|mkd)$/.test(lowerName)) {
    return 'markdown';
  }
  if (lowerName.endsWith('.mdz')) {
    return 'mdz';
  }
  return hasZipSignature(bytes) ? 'mdz' : 'markdown';
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && (
      (bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08)
    );
}

function bytesToBlob(bytes: Uint8Array, sourceFormat: MdzipSourceFormat = 'mdz'): Blob {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], {
    type: sourceFormat === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/vnd.mdzip'
  });
}
