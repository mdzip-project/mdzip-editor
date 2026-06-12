import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { MdzipWorkspaceView } from '@mdzip/editor';
import type {
  MdzipControlPolicy,
  MdzipControlPreset,
  MdzipColorScheme,
  MdzipConversionAction,
  MdzipEditorCommand,
  MdzipDocumentChangeEvent,
  MdzipEditorSnapshot,
  MdzipEntryRenderer,
  MdzipMarkdownRenderExtension,
  MdzipMarkdownRenderer,
  MdzipNavigationMode,
  MdzipRemoveAssetOptions,
  MdzipSourceFormat,
  MdzWorkspace,
  MdzWorkspaceAsset,
  MdzipWorkspaceChange,
  MdzipWorkspaceLayout,
  MdzipWorkspaceMode,
  MdzipWorkspaceSave,
  MdzipWorkspaceSnapshot,
} from '@mdzip/editor';

// Identity-insensitive key for the rendering inputs: extensions and entry
// renderers are diffed by their stable name/id (and priority), so template
// expressions that build new arrays each change-detection cycle never
// trigger an update.
function renderingConfigKey(
  extensions: readonly MdzipMarkdownRenderExtension[],
  entryRenderers: readonly MdzipEntryRenderer[]
): string {
  return JSON.stringify([
    extensions.map((extension) => extension.name),
    entryRenderers.map((renderer) => [renderer.id, renderer.priority ?? 0]),
  ]);
}

@Component({
  selector: 'mdzip-workspace',
  standalone: true,
  template: '<div #host></div>',
  styles: [':host { display: block; height: 100%; } div { height: 100%; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MdzipWorkspaceComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() bytes: Uint8Array | null = null;
  @Input() workspace: MdzWorkspace | null = null;
  @Input() fileName = 'document.mdz';
  @Input() mode: MdzipWorkspaceMode = 'read-only';
  @Input() sourceFormat?: MdzipSourceFormat;
  @Input() controls: MdzipControlPreset | MdzipControlPolicy = 'viewer';
  @Input() initialLayout?: MdzipWorkspaceLayout;
  @Input() initialColorScheme?: MdzipColorScheme;
  @Input() navigationMode: MdzipNavigationMode = 'editor';
  @Input() navigationButtonActive = true;
  /**
   * Host hook for the markdown→MDZ conversion flow. An input function (not an
   * output) because it must return/resolve `true` to suppress the built-in
   * conversion dialog.
   */
  @Input() onConversionRequested?: (action: MdzipConversionAction) => boolean | Promise<boolean>;
  /**
   * Custom markdown renderer. Keep the reference stable: identity changes
   * apply via a cheap preview re-render, never a workspace rebuild.
   */
  @Input() markdownRenderer?: MdzipMarkdownRenderer;
  /** Markdown pipeline extensions, diffed by `name`. */
  @Input() markdownExtensions: readonly MdzipMarkdownRenderExtension[] = [];
  /** Entry renderers, diffed by `id`/`priority`. */
  @Input() entryRenderers: readonly MdzipEntryRenderer[] = [];
  @Output() readonly changed = new EventEmitter<MdzipWorkspaceChange>();
  @Output() readonly saved = new EventEmitter<MdzipWorkspaceSave>();
  @Output() readonly workspaceChanged = new EventEmitter<MdzipDocumentChangeEvent>();
  @Output() readonly documentChanged = new EventEmitter<MdzipDocumentChangeEvent>();
  @Output() readonly assetChanged = new EventEmitter<MdzipDocumentChangeEvent>();
  @Output() readonly manifestChanged = new EventEmitter<MdzipDocumentChangeEvent>();
  @Output() readonly snapshotChanged = new EventEmitter<MdzipWorkspaceSnapshot>();
  @Output() readonly selectionChanged = new EventEmitter<MdzipWorkspaceSnapshot>();
  @Output() readonly dirtyChanged = new EventEmitter<MdzipWorkspaceSnapshot>();
  @Output() readonly validationChanged = new EventEmitter<MdzipWorkspaceSnapshot>();
  @Output() readonly colorSchemeChanged = new EventEmitter<MdzipColorScheme>();
  @Output() readonly failed = new EventEmitter<unknown>();

  @ViewChild('host') private readonly hostRef!: ElementRef<HTMLDivElement>;
  private view: MdzipWorkspaceView | null = null;
  private renderingKey = '';

  ngAfterViewInit(): void {
    this.createView();
    this.syncView();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.view && (changes['controls'] || changes['initialLayout']
      || changes['initialColorScheme'] || changes['navigationMode']
      || changes['navigationButtonActive'])) {
      this.createView();
      this.syncView();
      return;
    }
    if (this.view && (changes['bytes'] || changes['workspace'] || changes['mode']
      || changes['sourceFormat'] || changes['fileName'])) {
      this.syncView();
    }
    if (this.view && (changes['markdownRenderer'] || changes['markdownExtensions']
      || changes['entryRenderers'])) {
      this.applyRenderingOptions(Boolean(changes['markdownRenderer']));
    }
  }

  ngOnDestroy(): void {
    this.view?.destroy();
  }

  canExecuteCommand(command: MdzipEditorCommand): boolean {
    return this.view?.canExecuteCommand(command) ?? false;
  }

  executeCommand(command: MdzipEditorCommand, file?: File): Promise<boolean> {
    return this.view?.executeCommand(command, file) ?? Promise.resolve(false);
  }

  convertToMdz(): Promise<boolean> {
    return this.view?.convertToMdz() ?? Promise.resolve(false);
  }

  focus(): void {
    this.view?.focus();
  }

  flush(): Promise<MdzipEditorSnapshot | null> {
    return this.view?.flush() ?? Promise.resolve(null);
  }

  serialize(): Promise<Blob | null> {
    return this.view?.serialize() ?? Promise.resolve(null);
  }

  getCurrentSnapshot(): Promise<MdzipEditorSnapshot | null> {
    return this.view?.getCurrentSnapshot() ?? Promise.resolve(null);
  }

  markPersisted(): void {
    this.view?.markPersisted();
  }

  addAsset(archivePath: string, fileBytes: Uint8Array): Promise<void> {
    return this.view?.addAsset(archivePath, fileBytes) ?? Promise.resolve();
  }

  replaceAsset(archivePath: string, fileBytes: Uint8Array): Promise<boolean> {
    return this.view?.replaceAsset(archivePath, fileBytes) ?? Promise.resolve(false);
  }

  removeAsset(archivePath: string, options?: MdzipRemoveAssetOptions): Promise<boolean> {
    return this.view?.removeAsset(archivePath, options) ?? Promise.resolve(false);
  }

  removeFile(archivePath: string): Promise<boolean> {
    return this.view?.removeFile(archivePath) ?? Promise.resolve(false);
  }

  renameFile(oldPath: string, newPath: string): Promise<boolean> {
    return this.view?.renameFile(oldPath, newPath) ?? Promise.resolve(false);
  }

  setEntryPoint(archivePath: string): Promise<boolean> {
    return this.view?.setEntryPoint(archivePath) ?? Promise.resolve(false);
  }

  setCoverImage(archivePath: string | null): Promise<boolean> {
    return this.view?.setCoverImage(archivePath) ?? Promise.resolve(false);
  }

  listAssets(): MdzWorkspaceAsset[] {
    return this.view?.listAssets() ?? [];
  }

  private syncView(): void {
    if (this.view && this.workspace) {
      void this.view.openWorkspace(this.workspace, {
        mode: this.mode,
        sourceFormat: this.sourceFormat,
        fileName: this.fileName
      });
    } else if (this.view && this.bytes) {
      void this.view.open(this.bytes, {
        mode: this.mode,
        sourceFormat: this.sourceFormat,
        fileName: this.fileName
      });
    }
  }

  private createView(): void {
    this.view?.destroy();
    this.view = new MdzipWorkspaceView(this.hostRef.nativeElement, {
      controls: this.controls,
      initialLayout: this.initialLayout,
      initialColorScheme: this.initialColorScheme,
      navigationMode: this.navigationMode,
      navigationButtonActive: this.navigationButtonActive,
      onChanged: (bytes, snapshot) => this.changed.emit({ bytes, snapshot }),
      onSaved: (bytes, snapshot) => this.saved.emit({ bytes, snapshot }),
      onWorkspaceChanged: (event) => this.workspaceChanged.emit(event),
      onDocumentChanged: (event) => this.documentChanged.emit(event),
      onAssetChanged: (event) => this.assetChanged.emit(event),
      onManifestChanged: (event) => this.manifestChanged.emit(event),
      onSnapshotChanged: (snapshot) => this.snapshotChanged.emit(snapshot),
      onSelectionChanged: (snapshot: MdzipWorkspaceSnapshot) => this.selectionChanged.emit(snapshot),
      onDirtyChanged: (snapshot: MdzipWorkspaceSnapshot) => this.dirtyChanged.emit(snapshot),
      onValidationChanged: (snapshot: MdzipWorkspaceSnapshot) => this.validationChanged.emit(snapshot),
      onColorSchemeChanged: (colorScheme: MdzipColorScheme) => this.colorSchemeChanged.emit(colorScheme),
      onFailed: (e: unknown) => this.failed.emit(e),
      onConversionRequested: this.onConversionRequested
        ? (action) => this.onConversionRequested!(action)
        : undefined,
      markdownRenderer: this.markdownRenderer,
      markdownExtensions: this.markdownExtensions,
      entryRenderers: this.entryRenderers,
    });
    this.renderingKey = renderingConfigKey(this.markdownExtensions, this.entryRenderers);
  }

  // Applies rendering input changes in place — never a view rebuild. Arrays
  // re-apply only when their name/id key changes, so template expressions
  // that produce new array identities each cycle are safe.
  private applyRenderingOptions(rendererChanged: boolean): void {
    const key = renderingConfigKey(this.markdownExtensions, this.entryRenderers);
    if (!rendererChanged && key === this.renderingKey) {
      return;
    }
    this.renderingKey = key;
    this.view?.setRenderingOptions({
      markdownRenderer: this.markdownRenderer ?? null,
      markdownExtensions: this.markdownExtensions,
      entryRenderers: this.entryRenderers,
    });
  }
}
