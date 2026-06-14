import { markdown } from '@codemirror/lang-markdown';
import { MergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { MdzArchiveCore } from '@mdzip/core-js';
import { ChevronDown, ChevronUp, Eye, PanelLeft, RefreshCw, type IconNode } from 'lucide';
import {
  createArchiveInventoryFromArchive,
  diffArchiveInventories,
  type ArchiveInventory,
  type ArchiveInventoryDiff,
  type ArchiveInventoryDiffEntry
} from './diff.js';
import { injectDiffViewStyles } from './diff-view-css.js';

export interface MdzipDiffSideInput {
  bytes?: Uint8Array;
  label?: string;
  fileName?: string;
  missingMessage?: string;
}

export interface MdzipDiffSelectionEvent {
  path: string;
  entry: ArchiveInventoryDiffEntry;
}

export type MdzipDiffToolbarIcon = 'refresh';

export interface MdzipDiffToolbarAction {
  id: string;
  label: string;
  icon?: MdzipDiffToolbarIcon;
  disabled?: boolean;
  pressed?: boolean;
  run: () => void | Promise<void>;
}

/**
 * Toggles for the library-owned toolbar controls. All default to `true`.
 * Host-specific actions are supplied separately via `toolbarActions`.
 */
export interface MdzipDiffControlsOptions {
  /** Navigation pane visibility toggle. */
  navigation?: boolean;
  /** Previous/next change traversal buttons. */
  changeTraversal?: boolean;
  /** Show-unchanged pressed toggle. */
  showUnchanged?: boolean;
}

export interface MdzipDiffViewOptions {
  before: MdzipDiffSideInput;
  after: MdzipDiffSideInput;
  initialPath?: string;
  showUnchanged?: boolean;
  navigationVisible?: boolean;
  controls?: MdzipDiffControlsOptions;
  toolbarActions?: readonly MdzipDiffToolbarAction[];
  onSelectionChanged?: (event: MdzipDiffSelectionEvent) => void;
  onFailed?: (error: Error) => void;
}

interface DiffSide {
  input: MdzipDiffSideInput;
  archive: MdzArchiveCore | null;
  inventory: ArchiveInventory;
  state: 'ready' | 'missing' | 'empty' | 'invalid' | 'unsupported-version';
  error?: Error;
}

const EMPTY_INVENTORY: ArchiveInventory = { entries: [], entryPoint: '', manifest: null };

export class MdzipDiffView {
  private options: MdzipDiffViewOptions;
  private generation = 0;
  private selectionGeneration = 0;
  private before: DiffSide | null = null;
  private after: DiffSide | null = null;
  private diff: ArchiveInventoryDiff | null = null;
  private selectedPath: string | null = null;
  private showUnchanged: boolean;
  private navigationVisible: boolean;
  private controls: Required<MdzipDiffControlsOptions>;
  private mergeView: MergeView | null = null;
  private editorViews: EditorView[] = [];
  private objectUrls: string[] = [];
  private openingOptions: MdzipDiffViewOptions | null = null;
  private openingPromise: Promise<void> | null = null;
  private toolbarActions: readonly MdzipDiffToolbarAction[];
  private pendingToolbarAction: string | null = null;

  private readonly root: HTMLElement;
  private readonly workspace: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly navButton: HTMLButtonElement;
  private readonly prevChangeButton: HTMLButtonElement;
  private readonly nextChangeButton: HTMLButtonElement;
  private readonly showUnchangedButton: HTMLButtonElement;
  private readonly actionHost: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly list: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly body: HTMLElement;

  public constructor(container: HTMLElement, options: MdzipDiffViewOptions) {
    this.options = options;
    this.showUnchanged = options.showUnchanged ?? true;
    this.navigationVisible = options.navigationVisible ?? true;
    this.controls = resolveControls(options.controls);
    this.toolbarActions = options.toolbarActions ?? [];
    injectDiffViewStyles(container.ownerDocument);
    container.replaceChildren();
    this.root = container.ownerDocument.createElement('div');
    this.root.className = 'mdzip-diff-root';
    this.root.innerHTML = `
      <div class="mdzip-diff-toolbar" role="toolbar" aria-label="Comparison controls">
        <button class="mdzip-diff-toolbar-button" type="button" data-ref="navigation" title="Toggle navigation" aria-label="Toggle navigation"></button>
        <button class="mdzip-diff-toolbar-button" type="button" data-ref="prev-change" title="Previous change" aria-label="Previous change"></button>
        <button class="mdzip-diff-toolbar-button" type="button" data-ref="next-change" title="Next change" aria-label="Next change"></button>
        <button class="mdzip-diff-toolbar-button" type="button" data-ref="show-unchanged" title="Show unchanged" aria-label="Show unchanged"></button>
        <div class="mdzip-diff-toolbar-actions" data-ref="actions"></div>
      </div>
      <div class="mdzip-diff-workspace">
        <aside class="mdzip-diff-nav">
          <div class="mdzip-diff-summary"></div>
          <div class="mdzip-diff-list" role="tree" aria-label="Archive comparison files"></div>
        </aside>
        <main class="mdzip-diff-content">
          <div class="mdzip-diff-heading"></div>
          <div class="mdzip-diff-body"><div class="mdzip-diff-message">Loading comparison...</div></div>
        </main>
      </div>`;
    container.appendChild(this.root);
    this.workspace = this.root.querySelector('.mdzip-diff-workspace') as HTMLElement;
    this.toolbar = this.root.querySelector('.mdzip-diff-toolbar') as HTMLElement;
    this.navButton = this.root.querySelector('[data-ref="navigation"]') as HTMLButtonElement;
    this.prevChangeButton = this.root.querySelector('[data-ref="prev-change"]') as HTMLButtonElement;
    this.nextChangeButton = this.root.querySelector('[data-ref="next-change"]') as HTMLButtonElement;
    this.showUnchangedButton = this.root.querySelector('[data-ref="show-unchanged"]') as HTMLButtonElement;
    this.actionHost = this.root.querySelector('[data-ref="actions"]') as HTMLElement;
    this.nav = this.root.querySelector('.mdzip-diff-nav') as HTMLElement;
    this.summary = this.root.querySelector('.mdzip-diff-summary') as HTMLElement;
    this.list = this.root.querySelector('.mdzip-diff-list') as HTMLElement;
    this.heading = this.root.querySelector('.mdzip-diff-heading') as HTMLElement;
    this.body = this.root.querySelector('.mdzip-diff-body') as HTMLElement;
    this.navButton.innerHTML = iconHtml(PanelLeft);
    this.navButton.addEventListener('click', () => this.setNavigationVisible(!this.navigationVisible));
    this.prevChangeButton.innerHTML = iconHtml(ChevronUp);
    this.prevChangeButton.addEventListener('click', () => { void this.openPreviousChange(); });
    this.nextChangeButton.innerHTML = iconHtml(ChevronDown);
    this.nextChangeButton.addEventListener('click', () => { void this.openNextChange(); });
    this.showUnchangedButton.innerHTML = iconHtml(Eye);
    this.showUnchangedButton.addEventListener('click', () => this.setShowUnchanged(!this.showUnchanged));
    this.renderToolbar();
    void this.open(options);
  }

  public open(options: MdzipDiffViewOptions): Promise<void> {
    if (this.openingPromise && this.openingOptions === options) {
      return this.openingPromise;
    }
    const promise = this.openComparison(options);
    this.openingOptions = options;
    this.openingPromise = promise;
    const clear = (): void => {
      if (this.openingPromise === promise) {
        this.openingOptions = null;
        this.openingPromise = null;
      }
    };
    void promise.then(clear, clear);
    return promise;
  }

  private async openComparison(options: MdzipDiffViewOptions): Promise<void> {
    const generation = ++this.generation;
    this.options = options;
    this.showUnchanged = options.showUnchanged ?? this.showUnchanged;
    this.navigationVisible = options.navigationVisible ?? this.navigationVisible;
    if (options.controls) this.controls = resolveControls(options.controls);
    this.toolbarActions = options.toolbarActions ?? this.toolbarActions;
    this.renderToolbar();
    this.selectedPath = null;
    this.selectionGeneration += 1;
    this.disposeSelection();
    this.body.innerHTML = '<div class="mdzip-diff-message">Loading comparison...</div>';

    const [before, after] = await Promise.all([
      this.openSide(options.before),
      this.openSide(options.after)
    ]);
    if (generation !== this.generation) return;
    this.before = before;
    this.after = after;
    this.diff = diffArchiveInventories(before.inventory, after.inventory);
    this.selectedPath = chooseInitialPath(this.diff.entries, options.initialPath, after.inventory.entryPoint);
    this.renderNavigation();
    if (this.selectedPath) {
      await this.renderSelection(this.selectedPath);
    } else {
      this.renderEmptyState();
    }
  }

  public async openPath(path: string): Promise<boolean> {
    const entry = this.diff?.entries.find((item) => item.path === path);
    if (!entry) return false;
    this.selectedPath = entry.path;
    this.renderNavigation();
    await this.renderSelection(entry.path);
    return true;
  }

  public setShowUnchanged(show: boolean): void {
    if (this.showUnchanged === show) return;
    this.showUnchanged = show;
    this.renderNavigation();
  }

  /**
   * Selects the previous entry whose status is not `unchanged`. Resolves
   * `false` (without changing selection) when already at the first change.
   */
  public async openPreviousChange(): Promise<boolean> {
    const target = this.adjacentChange(-1);
    return target ? this.openPath(target.path) : false;
  }

  /**
   * Selects the next entry whose status is not `unchanged`. Resolves `false`
   * (without changing selection) when already at the last change.
   */
  public async openNextChange(): Promise<boolean> {
    const target = this.adjacentChange(1);
    return target ? this.openPath(target.path) : false;
  }

  private adjacentChange(direction: 1 | -1): ArchiveInventoryDiffEntry | null {
    const entries = this.diff?.entries ?? [];
    const changed = entries.filter((entry) => entry.status !== 'unchanged');
    if (changed.length === 0) return null;
    const currentInChanged = changed.findIndex((entry) => entry.path === this.selectedPath);
    if (currentInChanged >= 0) {
      return changed[currentInChanged + direction] ?? null;
    }
    // The current selection is unchanged (or none): pick the nearest change in
    // the requested direction by overall entry order.
    const currentIndex = entries.findIndex((entry) => entry.path === this.selectedPath);
    if (direction > 0) {
      return changed.find((entry) => entries.indexOf(entry) > currentIndex) ?? null;
    }
    return [...changed].reverse().find((entry) => entries.indexOf(entry) < currentIndex) ?? null;
  }

  public setNavigationVisible(visible: boolean): void {
    this.navigationVisible = visible;
    // Collapse via a class (animated width/opacity) rather than the `hidden`
    // attribute so the pane slides in and out like the workspace nav pane.
    this.nav.classList.toggle('hidden', !visible);
    this.navButton.setAttribute('aria-pressed', String(visible));
    this.navButton.classList.toggle('active', visible);
  }

  public setToolbarActions(actions: readonly MdzipDiffToolbarAction[]): void {
    this.toolbarActions = actions;
    this.renderToolbar();
  }

  public destroy(): void {
    this.generation += 1;
    this.selectionGeneration += 1;
    this.disposeSelection();
    this.root.remove();
  }

  private renderToolbar(): void {
    this.navButton.hidden = !this.controls.navigation;
    this.prevChangeButton.hidden = !this.controls.changeTraversal;
    this.nextChangeButton.hidden = !this.controls.changeTraversal;
    this.showUnchangedButton.hidden = !this.controls.showUnchanged;
    this.setNavigationVisible(this.navigationVisible);
    this.updateBuiltInControls();
    this.actionHost.replaceChildren();
    for (const action of this.toolbarActions) {
      const button = this.root.ownerDocument.createElement('button');
      button.type = 'button';
      button.className = 'mdzip-diff-toolbar-button';
      button.title = action.label;
      button.setAttribute('aria-label', action.label);
      if (action.pressed !== undefined) {
        button.setAttribute('aria-pressed', String(action.pressed));
        button.classList.toggle('active', action.pressed);
      }
      button.disabled = action.disabled === true || this.pendingToolbarAction === action.id;
      if (action.icon === 'refresh') button.innerHTML = iconHtml(RefreshCw);
      else button.textContent = action.label;
      button.addEventListener('click', () => void this.runToolbarAction(action));
      this.actionHost.append(button);
    }
    this.toolbar.hidden = false;
  }

  /** Syncs the pressed/disabled state of the built-in change + filter controls. */
  private updateBuiltInControls(): void {
    this.prevChangeButton.disabled = !this.adjacentChange(-1);
    this.nextChangeButton.disabled = !this.adjacentChange(1);
    this.showUnchangedButton.setAttribute('aria-pressed', String(this.showUnchanged));
    this.showUnchangedButton.classList.toggle('active', this.showUnchanged);
  }

  private async runToolbarAction(action: MdzipDiffToolbarAction): Promise<void> {
    if (action.disabled || this.pendingToolbarAction) return;
    this.pendingToolbarAction = action.id;
    this.renderToolbar();
    try {
      await action.run();
    } catch (cause) {
      this.options.onFailed?.(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      this.pendingToolbarAction = null;
      this.renderToolbar();
    }
  }

  private async openSide(input: MdzipDiffSideInput): Promise<DiffSide> {
    if (!input.bytes) return { input, archive: null, inventory: EMPTY_INVENTORY, state: 'missing' };
    if (input.bytes.length === 0) return { input, archive: null, inventory: EMPTY_INVENTORY, state: 'empty' };
    try {
      const archive = await MdzArchiveCore.open(input.bytes);
      const inventory = await createArchiveInventoryFromArchive(archive);
      return { input, archive, inventory, state: 'ready' };
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.options.onFailed?.(error);
      return {
        input,
        archive: null,
        inventory: EMPTY_INVENTORY,
        state: isUnsupportedVersionError(error) ? 'unsupported-version' : 'invalid',
        error
      };
    }
  }

  private renderNavigation(): void {
    const diff = this.diff;
    if (!diff || !this.before || !this.after) return;
    this.setNavigationVisible(this.navigationVisible);
    const beforeLabel = sideLabel(this.before, 'Before');
    const afterLabel = sideLabel(this.after, 'After');
    this.summary.replaceChildren();
    const labels = this.root.ownerDocument.createElement('div');
    labels.className = 'mdzip-diff-labels';
    labels.textContent = `${beforeLabel} vs ${afterLabel}`;
    const counts = this.root.ownerDocument.createElement('div');
    counts.className = 'mdzip-diff-counts';
    counts.textContent = `${diff.changedCount} changed, ${diff.addedCount} added, ${diff.removedCount} removed`;
    // The Show-unchanged control lives in the toolbar (see updateBuiltInControls);
    // a separate summary checkbox would duplicate the same state.
    this.summary.append(labels, counts);

    this.list.replaceChildren();
    const visibleEntries = diff.entries.filter(
      (entry) => this.showUnchanged || entry.status !== 'unchanged'
    );
    let previousDirectories: string[] = [];
    for (const entry of visibleEntries) {
      const directories = entry.path.split('/').slice(0, -1);
      let shared = 0;
      while (shared < directories.length
        && directories[shared] === previousDirectories[shared]) {
        shared += 1;
      }
      for (let index = shared; index < directories.length; index += 1) {
        const directory = this.root.ownerDocument.createElement('div');
        directory.className = 'mdzip-diff-directory';
        directory.setAttribute('role', 'presentation');
        directory.style.setProperty('--mdzip-diff-depth', String(index));
        directory.textContent = directories[index];
        this.list.append(directory);
      }
      previousDirectories = directories;

      const button = this.root.ownerDocument.createElement('button');
      button.type = 'button';
      button.className = `mdzip-diff-entry ${entry.status}${entry.path === this.selectedPath ? ' active' : ''}`;
      button.setAttribute('role', 'treeitem');
      button.setAttribute('aria-level', String(directories.length + 1));
      button.setAttribute('aria-label', `${entry.path}, ${entry.status}`);
      button.style.setProperty('--mdzip-diff-depth', String(directories.length));
      const status = this.root.ownerDocument.createElement('span');
      status.className = 'mdzip-diff-status';
      status.textContent = statusSymbol(entry.status);
      const path = this.root.ownerDocument.createElement('span');
      path.className = 'mdzip-diff-path';
      path.textContent = entry.path;
      button.append(status, path);
      button.addEventListener('click', () => { void this.openPath(entry.path); });
      button.addEventListener('keydown', (event) => this.handleNavigationKey(event));
      this.list.append(button);
    }
    this.updateBuiltInControls();
  }

  private async renderSelection(path: string): Promise<void> {
    const entry = this.diff?.entries.find((item) => item.path === path);
    if (!entry || !this.before || !this.after) return;
    const generation = ++this.selectionGeneration;
    this.disposeSelection();
    this.heading.innerHTML = `<div>${escapeHtml(sideLabel(this.before, 'Before'))}: ${escapeHtml(path)}</div><div>${escapeHtml(sideLabel(this.after, 'After'))}: ${escapeHtml(path)}</div>`;
    this.body.innerHTML = '<div class="mdzip-diff-message">Loading entry...</div>';
    try {
      const [beforeBytes, afterBytes] = await Promise.all([
        readEntry(this.before, entry.before?.path),
        readEntry(this.after, entry.after?.path)
      ]);
      if (generation !== this.selectionGeneration) return;
      if (entry.kind === 'image') {
        this.renderImages(beforeBytes, afterBytes, entry);
      } else {
        const beforeText = decodeText(beforeBytes);
        const afterText = decodeText(afterBytes);
        if ((beforeBytes === null || beforeText !== null)
          && (afterBytes === null || afterText !== null)) {
          this.renderText(beforeText, afterText, entry);
        } else {
          this.renderBinary(beforeBytes, afterBytes, entry);
        }
      }
      this.options.onSelectionChanged?.({ path, entry });
    } catch (cause) {
      if (generation !== this.selectionGeneration) return;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.options.onFailed?.(error);
      this.body.innerHTML = `<div class="mdzip-diff-message mdzip-diff-error">${escapeHtml(error.message)}</div>`;
    }
  }

  private renderText(before: string | null, after: string | null, entry: ArchiveInventoryDiffEntry): void {
    this.body.replaceChildren();
    const extensions: Extension[] = [
      lineNumbers(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping
    ];
    if (entry.kind === 'markdown') extensions.push(markdown());
    if (before === null || after === null) {
      this.body.append(this.createPair(
        this.textSide(before, extensions),
        this.textSide(after, extensions)
      ));
      return;
    }
    this.mergeView = new MergeView({
      a: { doc: before, extensions },
      b: { doc: after, extensions },
      parent: this.body,
      root: this.root.ownerDocument,
      highlightChanges: true,
      gutter: true,
      diffConfig: { scanLimit: 2000, timeout: 100 }
    });
  }

  private textSide(text: string | null, extensions: readonly Extension[]): HTMLElement {
    const side = this.root.ownerDocument.createElement('div');
    side.className = 'mdzip-diff-side mdzip-diff-text-side';
    if (text === null) {
      side.classList.add('mdzip-diff-missing');
      side.textContent = 'File does not exist';
      return side;
    }
    const editor = new EditorView({
      state: EditorState.create({ doc: text, extensions }),
      parent: side,
      root: this.root.ownerDocument
    });
    this.editorViews.push(editor);
    return side;
  }

  private renderImages(
    before: Uint8Array | null,
    after: Uint8Array | null,
    entry: ArchiveInventoryDiffEntry
  ): void {
    const mime = imageMime(entry.path);
    this.body.replaceChildren(this.createPair(
      this.imageSide(before, mime, entry.before?.hash),
      this.imageSide(after, mime, entry.after?.hash)
    ));
  }

  private imageSide(bytes: Uint8Array | null, mime: string, hash?: string): HTMLElement {
    const side = this.root.ownerDocument.createElement('div');
    side.className = 'mdzip-diff-side';
    if (!bytes) {
      side.textContent = 'File does not exist';
      return side;
    }
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    this.objectUrls.push(url);
    const image = this.root.ownerDocument.createElement('img');
    image.className = 'mdzip-diff-image';
    image.src = url;
    image.alt = '';
    const meta = this.root.ownerDocument.createElement('div');
    meta.className = 'mdzip-diff-meta';
    const updateMetadata = (): void => {
      const dimensions = image.naturalWidth && image.naturalHeight
        ? `${image.naturalWidth} x ${image.naturalHeight}\n`
        : '';
      meta.textContent = `${mime}\n${dimensions}${bytes.length} bytes\nSHA-256 ${hash ?? 'unknown'}`;
    };
    image.addEventListener('load', updateMetadata, { once: true });
    updateMetadata();
    side.append(image, meta);
    return side;
  }

  private renderBinary(
    before: Uint8Array | null,
    after: Uint8Array | null,
    entry: ArchiveInventoryDiffEntry
  ): void {
    this.body.replaceChildren(this.createPair(
      this.binarySide(before, entry.path, entry.kind, entry.before?.hash),
      this.binarySide(after, entry.path, entry.kind, entry.after?.hash)
    ));
  }

  private binarySide(
    bytes: Uint8Array | null,
    path: string,
    kind: ArchiveInventoryDiffEntry['kind'],
    hash?: string
  ): HTMLElement {
    const side = this.root.ownerDocument.createElement('div');
    side.className = 'mdzip-diff-side mdzip-diff-meta';
    side.textContent = bytes
      ? `${kind}\n${mimeFromPath(path)}\n${bytes.length} bytes\nSHA-256 ${hash ?? 'unknown'}`
      : 'File does not exist';
    return side;
  }

  private createPair(before: HTMLElement, after: HTMLElement): HTMLElement {
    const pair = this.root.ownerDocument.createElement('div');
    pair.className = 'mdzip-diff-pair';
    pair.append(before, after);
    return pair;
  }

  private renderEmptyState(): void {
    const errors = [this.before, this.after]
      .filter((side): side is DiffSide => Boolean(side?.error))
      .map((side) => side.error?.message)
      .filter(Boolean);
    this.heading.replaceChildren();
    this.body.innerHTML = `<div class="mdzip-diff-message${errors.length ? ' mdzip-diff-error' : ''}">${
      escapeHtml(errors.join('\n') || 'No archive entries to compare.')
    }</div>`;
  }

  private disposeSelection(): void {
    this.mergeView?.destroy();
    this.mergeView = null;
    for (const editor of this.editorViews) editor.destroy();
    this.editorViews = [];
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }

  private handleNavigationKey(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const entries = Array.from(
      this.list.querySelectorAll<HTMLButtonElement>('.mdzip-diff-entry')
    );
    const current = entries.indexOf(event.currentTarget as HTMLButtonElement);
    if (current < 0) return;
    const target = event.key === 'Home'
      ? entries[0]
      : event.key === 'End'
        ? entries.at(-1)
        : entries[current + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!target) return;
    event.preventDefault();
    target.focus();
  }
}

function resolveControls(controls: MdzipDiffControlsOptions | undefined): Required<MdzipDiffControlsOptions> {
  return {
    navigation: controls?.navigation ?? true,
    changeTraversal: controls?.changeTraversal ?? true,
    showUnchanged: controls?.showUnchanged ?? true
  };
}

function chooseInitialPath(
  entries: readonly ArchiveInventoryDiffEntry[],
  initialPath: string | undefined,
  entryPoint: string
): string | null {
  if (initialPath && entries.some((entry) => entry.path === initialPath)) return initialPath;
  return entries.find((entry) => entry.path === entryPoint && entry.status !== 'unchanged')?.path
    ?? entries.find((entry) => entry.status === 'changed' && entry.kind === 'markdown')?.path
    ?? entries.find((entry) => entry.status !== 'unchanged')?.path
    ?? entries.find((entry) => entry.path === entryPoint)?.path
    ?? entries[0]?.path
    ?? null;
}

async function readEntry(side: DiffSide, path: string | undefined): Promise<Uint8Array | null> {
  return path && side.archive ? side.archive.readBytes(path) : null;
}

function decodeText(bytes: Uint8Array | null): string | null {
  if (!bytes) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}

function sideLabel(side: DiffSide, fallback: string): string {
  if (side.input.label) return side.input.label;
  if (side.input.fileName) return side.input.fileName;
  if (side.state === 'missing') return side.input.missingMessage ?? `${fallback} missing`;
  if (side.state === 'empty') return `${fallback} empty`;
  if (side.state === 'invalid') return `${fallback} invalid`;
  if (side.state === 'unsupported-version') return `${fallback} unsupported version`;
  return fallback;
}

function statusSymbol(status: ArchiveInventoryDiffEntry['status']): string {
  if (status === 'added') return '+';
  if (status === 'removed') return '-';
  if (status === 'changed') return '~';
  return ' ';
}

function imageMime(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'svg') return 'image/svg+xml';
  return 'image/png';
}

function mimeFromPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'json') return 'application/json';
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'zip' || extension === 'mdz') return 'application/zip';
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'txt' || extension === 'log') return 'text/plain';
  return 'application/octet-stream';
}

function isUnsupportedVersionError(error: Error): boolean {
  return /unsupported.*version|version.*unsupported/i.test(error.message);
}

function iconHtml(icon: IconNode): string {
  return `<svg class="mdzip-diff-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon.map(([tag, attributes]) => {
    const attrs = Object.entries(attributes).map(([name, value]) => `${name}="${String(value)}"`).join(' ');
    return `<${tag} ${attrs}></${tag}>`;
  }).join('')}</svg>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
