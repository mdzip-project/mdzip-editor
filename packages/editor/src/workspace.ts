import {
  MdzArchiveCore,
  MdzPackagerCore,
  type MdzManifest,
  type MdzOpenWorkspaceOptions,
  type MdzValidationResult,
  type MdzValidationStatus,
  type MdzWorkspace,
  type MdzWorkspaceAsset
} from '@mdzip/core-js';
import {
  buildNewArchiveBytesWithTitle,
  blobToBytes,
  findOrphanedAssetPathsInArchive,
  openedArchiveFromWorkspace,
  readBinaryFileFromArchive,
  type ArchiveEntry,
  type OpenedArchive
} from './archive-utils.js';
import { MdzArchiveWorkerClient } from './mdz-archive.worker-client.js';
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
  /**
   * Original archive bytes backing a workspace opened via `openWorkspace`.
   * When provided, mutations (paste image, add/remove asset, save) patch these
   * bytes at the entry level instead of rebuilding the whole archive from the
   * workspace model — on large archives this is the difference between
   * milliseconds and tens of seconds, and it avoids resolving every lazy
   * document. Ignored by `open`, which already has the bytes.
   */
  archiveBytes?: Uint8Array;
  /**
   * Stable identity for a pre-parsed workspace's backing archive. Asset caches
   * use it to find content without invoking lazy ZIP readers on a later open.
   */
  assetSourceId?: string;
  /**
   * Dedicated Worker running `@mdzip/editor`'s `mdz-archive.worker.js`. When
   * provided, archive parsing and byte/text reads (initial open, and any
   * later reload after an edit) happen off the main thread instead of
   * blocking it — recommended for large archives with many embedded assets.
   * The caller constructs the `Worker` (URL resolution varies by host
   * bundler); this service owns its lifecycle from there and terminates it
   * in `dispose()`. Omitted entirely, the previous synchronous main-thread
   * path runs unchanged.
   */
  worker?: Worker;
}

type ResolvedMdzipWorkspaceOpenOptions = Required<Omit<MdzipWorkspaceOpenOptions, 'archiveBytes' | 'assetSourceId' | 'worker'>>;

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
  markdownImage?: string | ((markdownPath: string, archivePath: string) => string);
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
  // Ledger of entry-level changes not yet written to archiveBytes. Lets
  // serializeWorkspaceBytes() patch the existing archive in place instead of
  // rebuilding it from the workspace model (which would force every lazy
  // document to be decompressed and recompressed).
  private readonly pendingWrites = new Map<string, { path: string; content: string | Uint8Array }>();
  private readonly pendingRemovals = new Map<string, string>();
  private sourceFormatValue: MdzipSourceFormat;
  private readonly modeValue: MdzipWorkspaceMode;
  private fileName: string;
  // Orphaned paths derived from the current in-memory text; null means use contentValue.
  private liveOrphanedPaths: string[] | null = null;
  private workerClient?: MdzArchiveWorkerClient;

  private constructor(
    bytes: Uint8Array,
    workspace: MdzWorkspace,
    content: OpenedArchive,
    options: ResolvedMdzipWorkspaceOpenOptions,
    workerClient?: MdzArchiveWorkerClient
  ) {
    this.archiveBytes = bytes;
    this.workspaceValue = workspace;
    this.contentValue = content;
    this.currentTextValue = content.markdownText;
    this.currentPathValue = content.entryPoint;
    this.sourceFormatValue = options.sourceFormat;
    this.modeValue = options.mode;
    this.fileName = options.fileName;
    this.workerClient = workerClient;
  }

  public static async open(
    bytes: Uint8Array,
    options: MdzipWorkspaceOpenOptions = {}
  ): Promise<MdzipWorkspaceService> {
    const fileName = options.fileName ?? 'document.mdz';
    const resolvedOptions: ResolvedMdzipWorkspaceOpenOptions = {
      mode: options.mode ?? 'editable',
      sourceFormat: options.sourceFormat ?? inferMdzipSourceFormat(bytes, fileName),
      fileName
    };
    const workerClient = options.worker ? new MdzArchiveWorkerClient(options.worker) : undefined;

    try {
      if (resolvedOptions.sourceFormat === 'markdown') {
        const markdown = new TextDecoder('utf-8').decode(bytes);
        const title = suggestedTitleFromMarkdown(markdown, fileBaseNameFromPath(resolvedOptions.fileName));
        const archiveBytes = await buildNewArchiveBytesWithTitle(markdown, title);
        const coreWorkspace = await openCoreWorkspace(archiveBytes, workerClient);
        const workspace = new MdzipWorkspaceService(
          archiveBytes,
          coreWorkspace,
          await openedArchiveFromWorkspace(coreWorkspace),
          resolvedOptions,
          workerClient
        );
        workspace.currentTextValue = markdown;
        return workspace;
      }

      const coreWorkspace = await openCoreWorkspace(bytes, workerClient);
      return new MdzipWorkspaceService(
        bytes,
        coreWorkspace,
        await openedArchiveFromWorkspace(coreWorkspace),
        resolvedOptions,
        workerClient
      );
    } catch (error) {
      workerClient?.dispose();
      throw error;
    }
  }

  public static async openWorkspace(
    workspace: MdzWorkspace,
    options: MdzipWorkspaceOpenOptions = {}
  ): Promise<MdzipWorkspaceService> {
    const resolvedOptions: ResolvedMdzipWorkspaceOpenOptions = {
      mode: options.mode ?? 'editable',
      sourceFormat: options.sourceFormat ?? 'mdz',
      fileName: options.fileName ?? 'document.mdz'
    };
    return new MdzipWorkspaceService(
      options.archiveBytes ?? new Uint8Array(),
      workspace,
      await openedArchiveFromWorkspace(workspace),
      resolvedOptions,
      options.worker ? new MdzArchiveWorkerClient(options.worker) : undefined
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

  /** Terminates the backing archive worker, if one was configured. Safe to call even without one. */
  public dispose(): void {
    this.workerClient?.dispose();
  }

  public async addAsset(archivePath: string, fileBytes: Uint8Array): Promise<void> {
    this.assertEditable('add asset');
    this.commitPendingTextToWorkspace();
    const asset = await MdzPackagerCore.createWorkspaceAssetFromFile(fileBytes, archivePath);
    this.upsertWorkspaceAsset(asset);
    this.recordPendingWrite(archivePath, fileBytes);
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
      const orphaned = this.liveOrphanedPaths
        ?? this.workspaceValue.orphanedAssets?.orphanedAssetPaths
        ?? this.contentValue.orphanedAssetPaths;
      if (!new Set(orphaned.map((path) => path.toLowerCase())).has(target.path.toLowerCase())) {
        return false;
      }
    }

    this.workspaceValue.assets = this.workspaceValue.assets.filter((asset) => asset.path.toLowerCase() !== target.path.toLowerCase());
    this.recordPendingRemoval(target.path);
    await this.reloadPreservingCurrentText(await this.serializeWorkspaceBytes(), target.path);
    this.dirtyValue = true;
    this.emit('edit', ['asset'], target.path);
    return true;
  }

  /**
   * Removes any deletable file from the archive: assets (like `removeAsset`)
   * and non-entry markdown documents. The entry-point document and
   * `manifest.json` are never removable; returns `false` for those.
   */
  public async removeFile(archivePath: string): Promise<boolean> {
    this.assertEditable('remove file');
    const target = this.findPath(archivePath);
    if (!target) {
      return false;
    }
    const lower = target.path.toLowerCase();
    if (lower === 'manifest.json') {
      return false;
    }
    const document = this.workspaceValue.documents.find((doc) => doc.path.toLowerCase() === lower);
    if (!document) {
      return this.removeAsset(target.path);
    }
    if (lower === this.entryPointPath().toLowerCase()) {
      return false;
    }
    this.commitPendingTextToWorkspace();
    this.workspaceValue.documents = this.workspaceValue.documents.filter((doc) => doc !== document);
    this.recordPendingRemoval(target.path);
    await this.reloadPreservingCurrentText(await this.serializeWorkspaceBytes(), target.path);
    this.dirtyValue = true;
    this.emit('edit', ['document'], target.path);
    return true;
  }

  /**
   * Makes an existing markdown document the archive entry point. Updates the
   * manifest (`entryPoint`) and the in-memory workspace model, then reloads.
   * Returns `false` when the path is not a document or is already the entry.
   */
  public async setEntryPoint(archivePath: string): Promise<boolean> {
    this.assertEditable('set entry point');
    if (this.sourceFormatValue !== 'mdz') {
      return false;
    }
    const document = this.workspaceValue.documents.find(
      (doc) => doc.path.toLowerCase() === archivePath.toLowerCase()
    );
    if (!document || document.path.toLowerCase() === this.entryPointPath().toLowerCase()) {
      return false;
    }
    this.commitPendingTextToWorkspace();
    for (const doc of this.workspaceValue.documents) {
      doc.isEntryPoint = doc === document;
    }
    this.workspaceValue.entryPoint = document.path;
    this.workspaceValue.manifest = MdzPackagerCore.updateManifest(
      this.workspaceValue.manifest,
      { entryPoint: document.path }
    );
    if (this.archiveBytes.length > 0) {
      await this.reloadPreservingCurrentText(await this.serializeWorkspaceBytes());
    } else {
      // No bytes to patch (openWorkspace host) — keep the change in memory,
      // mirroring setManifestTitle, so lazy documents are not all resolved.
      const entryBytes = await this.readWorkspacePathBytes(document.path);
      this.contentValue = {
        ...this.contentValue,
        manifest: this.workspaceValue.manifest,
        entryPoint: document.path,
        markdownText: entryBytes ? new TextDecoder('utf-8').decode(entryBytes) : ''
      };
      this.liveOrphanedPaths = null;
    }
    this.dirtyValue = true;
    this.emit('edit', ['manifest'], 'manifest.json');
    return true;
  }

  /**
   * Renames (or moves, when the directory part changes) a file inside the
   * archive. Markdown references to the file — and the file's own relative
   * references when it is a moved document — are rewritten best-effort.
   * Returns `false` on unknown source, invalid target, or collision.
   */
  public async renameFile(oldPath: string, newPath: string): Promise<boolean> {
    this.assertEditable('rename file');
    if (this.sourceFormatValue !== 'mdz') {
      return false;
    }
    const target = this.findPath(oldPath);
    const normalized = normalizeArchivePath(newPath);
    if (!target || !normalized
      || target.path.toLowerCase() === 'manifest.json'
      || normalized.toLowerCase() === 'manifest.json') {
      return false;
    }
    if (normalized === target.path) {
      return false;
    }
    if (normalized.toLowerCase() !== target.path.toLowerCase() && this.findPath(normalized)) {
      return false;
    }
    this.commitPendingTextToWorkspace();
    const bytes = await this.readWorkspacePathBytes(target.path);
    if (!bytes) {
      return false;
    }
    this.recordPendingRemoval(target.path);
    this.recordPendingWrite(normalized, bytes);

    const document = this.workspaceValue.documents.find(
      (doc) => doc.path.toLowerCase() === target.path.toLowerCase()
    );
    const asset = this.workspaceValue.assets.find(
      (item) => item.path.toLowerCase() === target.path.toLowerCase()
    );
    if (document) {
      document.path = normalized;
    } else if (asset) {
      asset.path = normalized;
    }
    if (this.entryPointPath().toLowerCase() === target.path.toLowerCase()) {
      this.workspaceValue.entryPoint = normalized;
      this.workspaceValue.manifest = MdzPackagerCore.updateManifest(
        this.workspaceValue.manifest,
        { entryPoint: normalized }
      );
    }

    if (this.currentPathValue.toLowerCase() === target.path.toLowerCase()) {
      this.currentPathValue = normalized;
    }
    await this.rewriteReferencesForRename(target.path, normalized);
    await this.reloadPreservingCurrentText(await this.serializeWorkspaceBytes());
    this.dirtyValue = true;
    this.emit('edit', document ? ['document'] : ['asset'], normalized);
    return true;
  }

  /**
   * Sets (or clears, with `null`) the manifest `cover` field. The path must
   * resolve to an existing image asset.
   */
  public async setCoverImage(archivePath: string | null): Promise<boolean> {
    this.assertEditable('set cover image');
    if (this.sourceFormatValue !== 'mdz') {
      return false;
    }
    let coverPath: string | null = null;
    if (archivePath !== null) {
      const target = this.findPath(archivePath);
      if (!target || !target.isImage) {
        return false;
      }
      coverPath = target.path;
    }
    this.commitPendingTextToWorkspace();
    this.workspaceValue.manifest = MdzPackagerCore.updateManifest(
      this.workspaceValue.manifest,
      { cover: coverPath }
    );
    if (this.archiveBytes.length > 0) {
      await this.reloadPreservingCurrentText(await this.serializeWorkspaceBytes());
    } else {
      this.contentValue = { ...this.contentValue, manifest: this.workspaceValue.manifest };
    }
    this.dirtyValue = true;
    this.emit('edit', ['manifest'], 'manifest.json');
    return true;
  }

  public listAssets(): MdzWorkspaceAsset[] {
    return this.workspaceValue.assets.slice();
  }

  public async ensureOrphanedAssetsAnalyzed(): Promise<boolean> {
    if (this.liveOrphanedPaths !== null) {
      return false;
    }
    if (this.sourceFormatValue === 'markdown') {
      this.liveOrphanedPaths = [];
      return false;
    }
    const bytes = this.archiveBytes.length > 0
      ? this.archiveBytes
      : await this.serializeWorkspaceBytes();
    this.liveOrphanedPaths = await findOrphanedAssetPathsInArchive(bytes);
    return true;
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
    const markdownImage = typeof options.markdownImage === 'function'
      ? options.markdownImage(markdownPath, archivePath)
      : options.markdownImage ?? `![Pasted image](${markdownPath})`;
    const start = Math.max(0, Math.min(options.selectionStart, this.currentTextValue.length));
    const end = Math.max(start, Math.min(options.selectionEnd, this.currentTextValue.length));
    const text = `${this.currentTextValue.slice(0, start)}${markdownImage}${this.currentTextValue.slice(end)}`;
    const cursor = start + markdownImage.length;

    this.currentTextValue = text;
    this.commitPendingTextToWorkspace();
    this.upsertWorkspaceAsset(await MdzPackagerCore.createWorkspaceAssetFromFile(options.bytes, archivePath));
    this.recordPendingWrite(archivePath, options.bytes);
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

  /**
   * Sets the manifest title.
   *
   * When archive bytes are available the manifest entry is patched into them
   * incrementally (no document is read). When the workspace was opened via
   * `openWorkspace` without `archiveBytes`, no archive is built at all: the
   * manifest changes in memory only and is included whenever bytes are next
   * serialized (`saveToBytes`, `exportBytes`, `flush`). Hosts holding the real
   * archive bytes natively can instead apply the change themselves from the
   * `['manifest']` change event — see `onManifestChanged` in the view options.
   */
  public async setManifestTitle(newTitle: string): Promise<void> {
    this.assertEditable('set manifest title');
    this.commitPendingTextToWorkspace();
    this.workspaceValue.manifest = MdzPackagerCore.updateManifest(this.workspaceValue.manifest, { title: newTitle });
    this.workspaceValue.title = newTitle;
    if (this.archiveBytes.length > 0) {
      await this.reloadPreservingCurrentText(await this.serializeWorkspaceBytes());
    } else {
      // No bytes to patch. A full buildWorkspace() here would resolve every
      // lazy document (a webview round-trip per document in serialized-
      // workspace hosts). Keep the change in memory; it is picked up by the
      // next serialization.
      this.contentValue = { ...this.contentValue, manifest: this.workspaceValue.manifest };
    }
    this.dirtyValue = true;
    this.emit('edit', ['manifest'], 'manifest.json');
  }

  /**
   * Replaces the manifest wholesale. The provided manifest is canonicalized
   * (`modified` refreshed, legacy fields normalized) before it is applied.
   *
   * Persistence mirrors {@link setManifestTitle}: with archive bytes the
   * manifest entry is patched incrementally; without them the change stays in
   * memory until the next serialization, and hosts holding real bytes can
   * apply it from the `['manifest']` change event (`onManifestChanged`).
   */
  public async updateManifest(manifest: MdzManifest): Promise<void> {
    this.assertEditable('update manifest');
    if (this.sourceFormatValue !== 'mdz') {
      throw new Error('Cannot update manifest: workspace is not an MDZ archive.');
    }
    this.commitPendingTextToWorkspace();
    this.workspaceValue.manifest = MdzPackagerCore.updateManifest(manifest);
    this.workspaceValue.title = this.workspaceValue.manifest.title ?? null;
    if (this.archiveBytes.length > 0) {
      await this.reloadPreservingCurrentText(await this.serializeWorkspaceBytes());
    } else {
      // No bytes to patch — keep the change in memory, mirroring
      // setManifestTitle, so lazy documents are not all resolved.
      this.contentValue = { ...this.contentValue, manifest: this.workspaceValue.manifest };
    }
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
    this.workspaceValue = await openCoreWorkspace(bytes, this.workerClient);
    this.contentValue = await openedArchiveFromWorkspace(this.workspaceValue);
    this.currentTextValue = this.contentValue.markdownText;
    this.currentPathValue = this.contentValue.entryPoint;
    this.currentPathTypeValue = 'markdown';
    this.liveOrphanedPaths = null;
    this.clearPendingChanges();
  }

  private async reloadPreservingCurrentText(bytes: Uint8Array, removedPath?: string): Promise<void> {
    const currentText = this.currentTextValue;
    const currentPath = this.currentPathValue;
    const currentPathType = this.currentPathTypeValue;
    // Reopening drops orphaned analysis (includeOrphanedAssetAnalysis: false), so
    // contentValue.orphanedAssetPaths becomes []. If analysis was already active
    // (e.g. the nav pane computed it), recompute it before the caller emits, or
    // the re-render would show remaining orphans as normal files until the nav
    // pane is reopened.
    const hadOrphanedAnalysis = this.liveOrphanedPaths !== null;
    this.archiveBytes = bytes;
    this.workspaceValue = await openCoreWorkspace(bytes, this.workerClient);
    this.contentValue = await openedArchiveFromWorkspace(this.workspaceValue);
    this.liveOrphanedPaths = null;
    this.clearPendingChanges();

    if (removedPath && currentPath.toLowerCase() === removedPath.toLowerCase()) {
      this.currentTextValue = this.contentValue.markdownText;
      this.currentPathValue = this.contentValue.entryPoint;
      this.currentPathTypeValue = 'markdown';
    } else {
      this.currentTextValue = currentText;
      this.currentPathValue = currentPath;
      this.currentPathTypeValue = currentPathType;
    }

    if (hadOrphanedAnalysis) {
      await this.ensureOrphanedAssetsAnalyzed();
    }
  }

  private findPath(archivePath: string): ArchiveEntry | undefined {
    return this.contentValue.paths.find(
      (entry) => entry.path.toLowerCase() === archivePath.toLowerCase()
    );
  }

  private entryPointPath(): string {
    return this.workspaceValue.entryPoint ?? this.contentValue.entryPoint;
  }

  // Rewrites markdown links/images across all documents after a rename so they
  // still resolve: refs that pointed at oldPath now point at newPath, and the
  // moved document's own relative refs are re-based to its new directory.
  // Only refs that resolve to a known archive path are touched.
  private async rewriteReferencesForRename(oldPath: string, newPath: string): Promise<void> {
    const oldLower = oldPath.toLowerCase();
    const knownPaths = new Set(this.contentValue.paths.map((entry) => entry.path.toLowerCase()));
    for (const doc of this.workspaceValue.documents) {
      const wasRenamedDoc = doc.path.toLowerCase() === newPath.toLowerCase();
      // Refs were authored relative to the document's pre-rename location.
      const authoredDir = archiveDirName(wasRenamedDoc ? oldPath : doc.path);
      const currentDir = archiveDirName(doc.path);
      if (!wasRenamedDoc && doc.isLazy && !doc.text && !doc.readText) {
        continue; // unreadable lazy doc; leave as-is rather than throwing
      }
      let text = doc.text;
      if (doc.readText && !text) {
        text = await doc.readText();
      }
      if (!text) {
        continue;
      }
      const rewritten = rewriteArchiveRefs(text, (ref) => {
        const resolved = resolveArchiveRef(ref, authoredDir);
        const targetLower = resolved.toLowerCase();
        if (targetLower !== oldLower && !knownPaths.has(targetLower)) {
          return null;
        }
        const finalTarget = targetLower === oldLower ? newPath : resolved;
        const next = relativeArchivePath(currentDir, finalTarget);
        return next === ref ? null : next;
      });
      if (rewritten !== text) {
        doc.text = rewritten;
        delete doc.readText;
        delete doc.isLazy;
        this.recordPendingWrite(doc.path, rewritten);
        if (doc.path.toLowerCase() === this.currentPathValue.toLowerCase()) {
          this.currentTextValue = rewritten;
        }
      }
    }
  }

  private commitPendingTextToWorkspace(): void {
    if (!isEditableTextPath(this.currentPathTypeValue, this.currentPathValue)) {
      return;
    }
    const document = this.workspaceValue.documents.find((doc) => doc.path.toLowerCase() === this.currentPathValue.toLowerCase());
    if (document) {
      if (document.text !== this.currentTextValue) {
        document.text = this.currentTextValue;
        delete document.readText;
        delete document.isLazy;
        this.recordPendingWrite(document.path, this.currentTextValue);
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
        this.recordPendingWrite(asset.path, bytes);
        this.pendingTextDirty = true;
      }
    }
  }

  private recordPendingWrite(archivePath: string, content: string | Uint8Array): void {
    const lower = archivePath.toLowerCase();
    this.pendingRemovals.delete(lower);
    this.pendingWrites.set(lower, { path: archivePath, content });
  }

  private recordPendingRemoval(archivePath: string): void {
    const lower = archivePath.toLowerCase();
    this.pendingWrites.delete(lower);
    this.pendingRemovals.set(lower, archivePath);
  }

  private clearPendingChanges(): void {
    this.pendingWrites.clear();
    this.pendingRemovals.clear();
    this.pendingTextDirty = false;
  }

  private async serializeWorkspaceBytes(): Promise<Uint8Array> {
    // Patch the existing archive when we have its bytes: unchanged entries are
    // copied verbatim, so large archives serialize in milliseconds instead of
    // decompressing and recompressing every document.
    if (this.archiveBytes.length > 0) {
      const result = await MdzArchiveCore.updateFiles(
        this.archiveBytes,
        [...this.pendingWrites.values()].map((write) => ({ path: write.path, content: write.content })),
        [...this.pendingRemovals.values()],
        { manifest: this.workspaceValue.manifest }
      );
      return blobToBytes(result.blob);
    }
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
      if (document.readText && !document.text) {
        document.text = await document.readText();
        delete document.readText;
        delete document.isLazy;
      } else if (document.isLazy && !document.text) {
        throw new Error(`ERR_LAZY_TEXT_UNAVAILABLE: document "${document.path}" was opened lazily but its readText() reader is missing — likely dropped by a serialization boundary (e.g. postMessage). Materialize document text before serializing the workspace, or rehydrate readText on the receiving side.`);
      }
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
    return this.workerClient
      ? this.workerClient.readBytes(archivePath)
      : readBinaryFileFromArchive(this.archiveBytes, archivePath);
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

// Matches raw HTML <img src="..."> tags, which markdown's ![]() syntax doesn't
// cover but authors use for sizing/alignment control markdown can't express.
const HTML_IMG_SRC_RE = /<img\b[^>]*\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>/gi;

// Extract all image archive paths referenced in markdown text, from both
// markdown ![]() syntax and raw HTML <img src> tags.
// Handles relative paths by resolving against baseDir (the directory of the current file).
function referencedImagePaths(markdown: string, baseDir: string): Set<string> {
  const refs = new Set<string>();
  const addRawRef = (raw: string) => {
    const cleaned = raw.replace(/^<|>$/g, '').split(/[?#]/)[0] ?? '';
    const decoded = decodeURIComponent(cleaned);
    // Store both the raw form and the baseDir-resolved form so either lookup hits.
    refs.add(decoded);
    refs.add(decoded.replace(/^\.\//, ''));
    const resolved = decoded.startsWith('/') ? decoded.slice(1) : `${baseDir}${decoded.replace(/^\.\//, '')}`;
    refs.add(resolved);
  };

  const mdRegex = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdRegex.exec(markdown)) !== null) {
    addRawRef(match[1] ?? '');
  }

  const htmlRegex = new RegExp(HTML_IMG_SRC_RE.source, 'gi');
  while ((match = htmlRegex.exec(markdown)) !== null) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (raw) addRawRef(raw);
  }

  return refs;
}

function archiveDirName(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/**
 * Normalizes a user-supplied archive path: backslashes to slashes, collapsed
 * separators, no leading/trailing slash. Returns `null` when the result is
 * empty or contains `.`/`..` segments.
 */
export function normalizeArchivePath(path: string): string | null {
  const segments = path.trim().replace(/\\/g, '/').split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    return null;
  }
  return segments.join('/');
}

/**
 * Builds the relative markdown reference from a directory (`''` = archive
 * root) to an archive path, using `../` segments where needed.
 */
export function relativeArchivePath(fromDir: string, toPath: string): string {
  const fromParts = fromDir.split('/').filter(Boolean);
  const toParts = toPath.split('/').filter(Boolean);
  const toDir = toParts.slice(0, -1);
  let common = 0;
  while (common < fromParts.length && common < toDir.length && fromParts[common] === toDir[common]) {
    common += 1;
  }
  return '../'.repeat(fromParts.length - common) + toParts.slice(common).join('/');
}

// Resolves a markdown ref against a base directory, handling ./ and ../ and
// leading-slash (archive-root) refs.
function resolveArchiveRef(ref: string, baseDir: string): string {
  const combined = ref.startsWith('/') ? ref.slice(1) : `${baseDir ? `${baseDir}/` : ''}${ref}`;
  const out: string[] = [];
  for (const segment of combined.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return out.join('/');
}

// Applies mapRef to every markdown link/image target. mapRef receives the
// decoded path part (query/hash stripped) and returns the replacement path or
// null to leave the ref unchanged. External (scheme) and fragment-only refs
// are skipped.
function rewriteArchiveRefs(markdown: string, mapRef: (ref: string) => string | null): string {
  const regex = /(!?\[[^\]]*\]\()(<[^>]*>|[^)\s]+)((?:\s+"[^"]*")?\))/g;
  return markdown.replace(regex, (match, prefix: string, rawTarget: string, suffix: string) => {
    const angled = rawTarget.startsWith('<') && rawTarget.endsWith('>');
    const target = angled ? rawTarget.slice(1, -1) : rawTarget;
    if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
      return match;
    }
    const splitAt = target.search(/[?#]/);
    const pathPart = splitAt === -1 ? target : target.slice(0, splitAt);
    const rest = splitAt === -1 ? '' : target.slice(splitAt);
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch {
      return match;
    }
    const mapped = mapRef(decoded);
    if (mapped === null) {
      return match;
    }
    const encoded = mapped.split('/').map(encodeURIComponent).join('/');
    const next = `${encoded}${rest}`;
    return `${prefix}${angled ? `<${next}>` : next}${suffix}`;
  });
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

const WORKSPACE_OPEN_OPTIONS: MdzOpenWorkspaceOptions = {
  includeOrphanedAssetAnalysis: false,
  includeLazyDocumentReaders: true
};

/**
 * Opens `bytes` into an `MdzWorkspace`, routing through `workerClient` (off
 * the main thread) when one is present, otherwise calling `MdzArchiveCore`
 * directly. Shared by the initial `open()`/`openWorkspace()` factories and by
 * `reload()`/`reloadPreservingCurrentText()` after an edit, so a worker-backed
 * service keeps reading through the same worker for its whole lifetime.
 */
function openCoreWorkspace(bytes: Uint8Array, workerClient?: MdzArchiveWorkerClient): Promise<MdzWorkspace> {
  return workerClient
    ? workerClient.open(bytes, WORKSPACE_OPEN_OPTIONS)
    : MdzArchiveCore.openWorkspace(bytes, WORKSPACE_OPEN_OPTIONS);
}
