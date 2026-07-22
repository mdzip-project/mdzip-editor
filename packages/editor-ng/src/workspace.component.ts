import {
  AfterContentInit,
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ContentChildren,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  QueryList,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { MdzipEntryRendererDirective } from './entry-renderer.directive';
import { PACKAGE_INFO } from './package-info.js';
import { MdzipWorkspaceView } from '@mdzip/editor';
import type {
  MdzipControlPolicy,
  MdzipControlPreset,
  MdzipContentDensity,
  MdzipColorScheme,
  MdzipConversionAction,
  MdzipConversionContext,
  MdzipEditorCommand,
  MdzipPackFilesContext,
  MdzipPackFilesInput,
  MdzipPackFilesRequest,
  MdzipPackFilesResult,
  MdzipDocumentChangeEvent,
  MdzipEditorSnapshot,
  MdzipEntryRenderer,
  MdzipMarkdownRenderExtension,
  MdzipMarkdownRenderer,
  MdzipImageHydrationAnimation,
  MdzipImageInsertHandler,
  MdzipImageInsertMode,
  MdzipNavigationMode,
  MdzipRemoveAssetOptions,
  MdzipSourceFormat,
  MdzipToolbarDensity,
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
export class MdzipWorkspaceComponent implements AfterContentInit, AfterViewInit, OnChanges, OnDestroy {
  @Input() bytes: Uint8Array | null = null;
  @Input() workspace: MdzWorkspace | null = null;
  @Input() fileName = 'document.mdz';
  @Input() mode: MdzipWorkspaceMode = 'read-only';
  @Input() sourceFormat?: MdzipSourceFormat;
  @Input() controls: MdzipControlPreset | MdzipControlPolicy = 'viewer';
  @Input() toolbarDensity?: MdzipToolbarDensity;
  @Input() contentDensity?: MdzipContentDensity;
  @Input() imageHydrationAnimation?: MdzipImageHydrationAnimation;
  @Input() imageInsertMode?: MdzipImageInsertMode;
  @Input() imageInsertHandler?: MdzipImageInsertHandler;
  @Input() initialLayout?: MdzipWorkspaceLayout;
  @Input() initialColorScheme?: MdzipColorScheme;
  @Input() navigationMode: MdzipNavigationMode = 'editor';
  @Input() navigationButtonActive = true;
  /**
   * Host hook for the markdown→MDZ conversion flow. An input function (not an
   * output) because it must return/resolve `true` to suppress the built-in
   * conversion dialog.
   */
  @Input() onConversionRequested?: (
    action: MdzipConversionAction,
    context: MdzipConversionContext
  ) => boolean | Promise<boolean>;
  /**
   * Host hook for the folder→.mdz packing decision surfaced by
   * `packFilesAsWorkspace()`. Same input-not-output reasoning as
   * `onConversionRequested`.
   */
  @Input() onPackRequested?: (
    request: MdzipPackFilesRequest,
    context: MdzipPackFilesContext
  ) => boolean | Promise<boolean>;
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
  /** Emits when the preview HTML for the current selection is mounted. */
  @Output() readonly previewRendered = new EventEmitter<MdzipWorkspaceSnapshot>();
  /** Emits once the mounted preview's images have finished loading. */
  @Output() readonly assetsHydrated = new EventEmitter<MdzipWorkspaceSnapshot>();
  @Output() readonly failed = new EventEmitter<unknown>();

  @ViewChild('host') private readonly hostRef!: ElementRef<HTMLDivElement>;
  /**
   * `<ng-template mdzipEntryRenderer>` declarations projected into the
   * component. Each becomes an entry renderer appended after the
   * `entryRenderers` input (stable sort keeps the input ahead at equal
   * priority).
   */
  @ContentChildren(MdzipEntryRendererDirective)
  private readonly entryTemplates!: QueryList<MdzipEntryRendererDirective>;
  private view: MdzipWorkspaceView | null = null;
  private renderingKey = '';
  private entryTemplatesSub: { unsubscribe(): void } | null = null;

  ngAfterContentInit(): void {
    this.entryTemplatesSub = this.entryTemplates.changes.subscribe(() => {
      this.applyRenderingOptions(false);
    });
  }

  ngAfterViewInit(): void {
    this.createView();
    this.syncView();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.view && (changes['initialLayout'] || changes['initialColorScheme'] || changes['navigationMode']
      || changes['navigationButtonActive'])) {
      this.createView();
      this.syncView();
      return;
    }
    if (this.view && changes['controls']) {
      this.view.setControls(this.controls);
    }
    if (this.view && (changes['toolbarDensity'] || changes['contentDensity'])) {
      this.view.setDensityOptions({
        toolbarDensity: this.toolbarDensity,
        contentDensity: this.contentDensity,
      });
    }
    if (this.view && changes['imageHydrationAnimation']) {
      this.view.setImageHydrationAnimation(this.imageHydrationAnimation);
    }
    if (this.view && (changes['imageInsertMode'] || changes['imageInsertHandler'])) {
      this.view.setImageInsertOptions({
        imageInsertMode: this.imageInsertMode,
        imageInsertHandler: (request) => this.imageInsertHandler?.(request),
      });
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
    this.entryTemplatesSub?.unsubscribe();
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

  setColorScheme(scheme: MdzipColorScheme): void {
    this.view?.setColorScheme(scheme);
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

  whenRendered(): Promise<void> {
    return this.view?.whenRendered() ?? Promise.resolve();
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

  packFilesAsWorkspace(
    files: readonly MdzipPackFilesInput[],
    options?: { title?: string; fileName?: string }
  ): Promise<MdzipPackFilesResult | null> {
    return this.view?.packFilesAsWorkspace(files, options) ?? Promise.resolve(null);
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
      libraries: [PACKAGE_INFO],
      controls: this.controls,
      toolbarDensity: this.toolbarDensity,
      contentDensity: this.contentDensity,
      imageHydrationAnimation: this.imageHydrationAnimation,
      imageInsertMode: this.imageInsertMode,
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
      onPreviewRendered: (snapshot: MdzipWorkspaceSnapshot) => this.previewRendered.emit(snapshot),
      onAssetsHydrated: (snapshot: MdzipWorkspaceSnapshot) => this.assetsHydrated.emit(snapshot),
      onFailed: (e: unknown) => this.failed.emit(e),
      onConversionRequested: this.onConversionRequested
        ? (action, context) => this.onConversionRequested!(action, context)
        : undefined,
      onPackRequested: this.onPackRequested
        ? (request, context) => this.onPackRequested!(request, context)
        : undefined,
      imageInsertHandler: (request) => this.imageInsertHandler?.(request),
      markdownRenderer: this.markdownRenderer,
      markdownExtensions: this.markdownExtensions,
      entryRenderers: this.composedEntryRenderers(),
    });
    this.renderingKey = renderingConfigKey(this.markdownExtensions, this.composedEntryRenderers());
  }

  private composedEntryRenderers(): readonly MdzipEntryRenderer[] {
    const templates = this.entryTemplates
      ? this.entryTemplates.map((directive, index) => directive.toEntryRenderer(index))
      : [];
    return [...this.entryRenderers, ...templates];
  }

  // Applies rendering input changes in place — never a view rebuild. Arrays
  // re-apply only when their name/id key changes, so template expressions
  // that produce new array identities each cycle are safe.
  private applyRenderingOptions(rendererChanged: boolean): void {
    const composed = this.composedEntryRenderers();
    const key = renderingConfigKey(this.markdownExtensions, composed);
    if (!rendererChanged && key === this.renderingKey) {
      return;
    }
    this.renderingKey = key;
    this.view?.setRenderingOptions({
      markdownRenderer: this.markdownRenderer ?? null,
      markdownExtensions: this.markdownExtensions,
      entryRenderers: composed,
    });
  }
}
