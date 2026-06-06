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

export interface MdzipWorkspaceOpenOptions {
  mode?: MdzipWorkspaceMode;
  sourceFormat?: MdzipSourceFormat;
  fileName?: string;
}

export interface MdzipWorkspaceSnapshot {
  mode: MdzipWorkspaceMode;
  sourceFormat: MdzipSourceFormat;
  archiveBytes: Uint8Array;
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
  currentPath: string | null;
  mode: MdzWorkspace['mode'];
}

export interface MdzipEditorSnapshot {
  workspace: MdzWorkspace;
  bytes: Blob;
  state: MdzipEditorHostState;
}

export interface MdzipDocumentChangeEvent {
  reason: MdzipChangeReason;
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
  private readonly sourceFormatValue: MdzipSourceFormat;
  private readonly modeValue: MdzipWorkspaceMode;
  private readonly fileName: string;
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
    const resolvedOptions: Required<MdzipWorkspaceOpenOptions> = {
      mode: options.mode ?? 'editable',
      sourceFormat: options.sourceFormat ?? 'mdz',
      fileName: options.fileName ?? 'document.mdz'
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
    const bytes = await blobToBytes((await MdzPackagerCore.buildWorkspace(workspace)).blob);
    return new MdzipWorkspaceService(bytes, workspace, await openedArchiveFromWorkspace(workspace), resolvedOptions);
  }

  public subscribe(listener: MdzipDocumentChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public snapshot(): MdzipWorkspaceSnapshot {
    const fileBaseName = fileBaseNameFromPath(this.fileName);
    const manifestTitle = this.contentValue.manifest?.title;
    const content = this.liveOrphanedPaths !== null
      ? { ...this.contentValue, orphanedAssetPaths: this.liveOrphanedPaths }
      : this.contentValue;
    return {
      mode: this.modeValue,
      sourceFormat: this.sourceFormatValue,
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
      currentPath: snapshot.currentPath || null,
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

  public editText(newText: string): void {
    this.assertEditable('edit text');
    if (!isEditableTextPath(this.currentPathTypeValue, this.currentPathValue)) {
      return;
    }
    this.currentTextValue = newText;
    this.dirtyValue = true;
    this.liveOrphanedPaths = this.computeLiveOrphanedPaths(newText);
    this.emit('edit');
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
      this.dirtyValue = false;
      this.emit('reload');
      return true;
    }

    const bytes = await readBinaryFileFromArchive(this.archiveBytes, target.path);
    this.currentTextValue = new TextDecoder('utf-8').decode(bytes);
    this.currentPathTypeValue = isLikelyBinary(bytes) ? 'binary' : nextType;
    this.dirtyValue = false;
    this.emit('reload');
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
    this.emit('edit');
  }

  public async replaceAsset(archivePath: string, fileBytes: Uint8Array): Promise<boolean> {
    this.assertEditable('replace asset');
    if (!this.findPath(archivePath)) {
      return false;
    }
    await this.addAsset(archivePath, fileBytes);
    return true;
  }

  public async removeAsset(archivePath: string): Promise<boolean> {
    this.assertEditable('remove asset');
    const target = this.findPath(archivePath);
    if (!target || !this.workspaceValue.assets.some((asset) => asset.path.toLowerCase() === target.path.toLowerCase())) {
      return false;
    }
    this.commitPendingTextToWorkspace();
    const orphaned = this.workspaceValue.orphanedAssets?.orphanedAssetPaths ?? this.contentValue.orphanedAssetPaths;
    if (!new Set(orphaned.map((path) => path.toLowerCase())).has(target.path.toLowerCase())) {
      return false;
    }

    this.workspaceValue.assets = this.workspaceValue.assets.filter((asset) => asset.path.toLowerCase() !== target.path.toLowerCase());
    await this.reloadPreservingCurrentText(await this.serializeWorkspaceBytes(), target.path);
    this.dirtyValue = true;
    this.emit('edit');
    return true;
  }

  public listAssets(): MdzWorkspaceAsset[] {
    return this.workspaceValue.assets.slice();
  }

  public async pasteImage(options: MdzipPasteImageOptions): Promise<MdzipPasteImageResult | null> {
    this.assertEditable('paste image');
    if (!isEditableTextPath(this.currentPathTypeValue, this.currentPathValue) || this.currentPathTypeValue !== 'markdown') {
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
    this.emit('edit');

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
    this.emit('edit');
  }

  public async saveToBytes(): Promise<Uint8Array> {
    this.assertEditable('save');
    const nextBytes = await this.bytesWithPendingText();
    await this.reload(nextBytes);
    this.dirtyValue = false;
    return nextBytes;
  }

  public async exportBytes(): Promise<Uint8Array> {
    return this.bytesWithPendingText();
  }

  public async serialize(): Promise<Blob> {
    return bytesToBlob(await this.exportBytes());
  }

  public async flush(): Promise<MdzipEditorSnapshot> {
    const bytes = await this.bytesWithPendingText();
    await this.reloadPreservingCurrentText(bytes);
    this.dirtyValue = false;
    return this.editorSnapshot(bytes);
  }

  public async getCurrentSnapshot(): Promise<MdzipEditorSnapshot> {
    const bytes = await this.bytesWithPendingText();
    return this.editorSnapshot(bytes);
  }

  public manifest(): MdzManifest | null {
    return this.contentValue.manifest;
  }

  private async bytesWithPendingText(): Promise<Uint8Array> {
    if (!isEditableTextPath(this.currentPathTypeValue, this.currentPathValue)) {
      return this.archiveBytes;
    }
    this.commitPendingTextToWorkspace();
    return this.serializeWorkspaceBytes();
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
      document.text = this.currentTextValue;
      return;
    }
    const asset = this.workspaceValue.assets.find((item) => item.path.toLowerCase() === this.currentPathValue.toLowerCase());
    if (asset) {
      const bytes = new TextEncoder().encode(this.currentTextValue);
      asset.bytes = bytes;
      asset.byteSize = bytes.byteLength;
      delete asset.readBytes;
      delete asset.readDataUri;
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
      bytes: bytesToBlob(bytes),
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

  private emit(reason: MdzipChangeReason): void {
    const event = { reason, snapshot: this.snapshot() };
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

function extensionForMime(mimeType: string): string {
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

function bytesToBlob(bytes: Uint8Array): Blob {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/vnd.mdzip' });
}
