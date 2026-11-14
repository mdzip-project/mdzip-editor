import { markdown } from '@codemirror/lang-markdown';
import { MergeView, getChunks } from '@codemirror/merge';
import { Annotation, EditorState, type Extension } from '@codemirror/state';
import { search, searchKeymap } from '@codemirror/search';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { MdzArchiveCore } from '@mdzip/core-js';
import { ChevronDown, ChevronUp, Eye, Hash, ListFilter, PanelLeft, RefreshCw, Save, SquarePen, type IconNode } from 'lucide';
import {
  createArchiveInventoryFromArchive,
  diffArchiveInventories,
  type ArchiveInventory,
  type ArchiveInventoryDiff,
  type ArchiveInventoryDiffEntry
} from './diff.js';
import { markBlockChanges, renderSideFragment, syncScroll, type RenderedSideSource } from './diff-rendered.js';
import { injectDiffViewStyles, injectPreviewStyles } from './diff-view-css.js';
import { sha256Hex } from './sha256.js';

export interface MdzipDiffSideInput {
  /** The `.mdz` archive for this side. */
  bytes?: Uint8Array;
  /**
   * A plain Markdown document (an `.md` file) for this side instead of an
   * archive. Takes precedence over `bytes`. The comparison then has one
   * entry: the document, named after the other side's entry point when that
   * side is an archive, otherwise after `fileName` (or `document.md`).
   */
  markdown?: string;
  /**
   * For a `markdown` side: reads a file the document links to, so the
   * rendered view can show its images. Receives the image source normalized
   * relative to the document's folder (`images/a.png`, `../shared/a.png`;
   * root-relative sources keep their leading `/`). Resolve null when the
   * file doesn't exist. Without it, images show as missing.
   */
  readResource?: (path: string) => Promise<Uint8Array | null>;
  /**
   * For a `markdown` side: let the user edit it in the source view (the
   * rendered view stays read-only). Each edit calls `onMarkdownChange` with
   * the full text; the comparison updates as they type.
   */
  editable?: boolean;
  /** Called with the side's full text after each edit of an `editable` side. */
  onMarkdownChange?: (markdown: string) => void;
  label?: string;
  fileName?: string;
  missingMessage?: string;
}

export interface MdzipDiffSelectionEvent {
  path: string;
  entry: ArchiveInventoryDiffEntry;
}

export type MdzipDiffToolbarIcon = 'refresh' | 'save';

export interface MdzipDiffToolbarAction {
  id: string;
  label: string;
  icon?: MdzipDiffToolbarIcon;
  disabled?: boolean;
  pressed?: boolean;
  run: () => void | Promise<void>;
}

/**
 * Toggles for the library-owned toolbar controls. All default to `true`
 * except `showUnchanged`.
 * Host-specific actions are supplied separately via `toolbarActions`.
 */
export interface MdzipDiffControlsOptions {
  /**
   * Navigation pane visibility toggle. Default on, except for a plain
   * Markdown comparison, which has one document.
   */
  navigation?: boolean;
  /**
   * Previous/next change buttons: they step through the changes in the
   * selected entry, then on to the next or previous changed entry.
   */
  changeTraversal?: boolean;
  /**
   * Show-unchanged pressed toggle. Off by default: the navigation list
   * already shows unchanged entries, dimmed.
   */
  showUnchanged?: boolean;
  /** Rendered/source toggle for Markdown entries. */
  rendered?: boolean;
}

export interface MdzipDiffViewOptions {
  before: MdzipDiffSideInput;
  after: MdzipDiffSideInput;
  initialPath?: string;
  showUnchanged?: boolean;
  navigationVisible?: boolean;
  /**
   * Show Markdown entries rendered, as the workspace preview shows them,
   * instead of as source. Default `false`. The toolbar toggle changes it.
   */
  rendered?: boolean;
  /** Color scheme for rendered Markdown (code blocks, front matter). Default `'light'`. */
  colorScheme?: 'light' | 'dark';
  /**
   * Toolbar button size, matching the workspace editor's `toolbarDensity`
   * (`'dense'` is VS Code's). Default `'comfortable'`.
   */
  toolbarDensity?: 'comfortable' | 'compact' | 'dense';
  controls?: MdzipDiffControlsOptions;
  toolbarActions?: readonly MdzipDiffToolbarAction[];
  onSelectionChanged?: (event: MdzipDiffSelectionEvent) => void;
  /** Called when the rendered/source toggle changes, so a host can remember it. */
  onRenderedChanged?: (rendered: boolean) => void;
  onFailed?: (error: Error) => void;
}

interface DiffSide {
  input: MdzipDiffSideInput;
  archive: MdzArchiveCore | null;
  inventory: ArchiveInventory;
  state: 'ready' | 'missing' | 'empty' | 'invalid' | 'unsupported-version';
  error?: Error;
  /** Set for a plain Markdown side (`input.markdown`). */
  markdown?: { text: string; bytes: Uint8Array; hash: string };
}

/** Marks a change the host pushed in with updateMarkdown(), so it isn't reported back as an edit. */
const hostUpdate = Annotation.define<boolean>();

const EMPTY_INVENTORY: ArchiveInventory = { entries: [], entryPoint: '', manifest: null };
const DEFAULT_MARKDOWN_PATH = 'document.md';

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
  private rendered: boolean;
  private colorScheme: 'light' | 'dark';
  private controls: Required<MdzipDiffControlsOptions>;
  private mergeView: MergeView | null = null;
  private editorViews: EditorView[] = [];
  private objectUrls: string[] = [];
  private renderAbort: AbortController | null = null;
  /** The change in the selected entry that previous/next last moved to; -1 before the first. */
  private changeCursor = -1;
  /** Rendered view: the changed blocks, in reading order, with the pane each scrolls. */
  private renderedChanges: Array<{ side: HTMLElement; block: HTMLElement }> = [];
  private stopScrollSync: (() => void) | null = null;
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
  private readonly changeCountLabel: HTMLElement;
  private density: 'comfortable' | 'compact' | 'dense';
  private readonly showUnchangedButton: HTMLButtonElement;
  private readonly viewModeGroup: HTMLElement;
  private readonly sourceButton: HTMLButtonElement;
  private readonly renderedButton: HTMLButtonElement;
  private readonly actionHost: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly list: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly body: HTMLElement;

  public constructor(container: HTMLElement, options: MdzipDiffViewOptions) {
    this.options = options;
    this.showUnchanged = options.showUnchanged ?? true;
    // A plain-Markdown comparison has a single entry, so the list adds nothing.
    this.navigationVisible = options.navigationVisible ?? !isMarkdownOnly(options);
    this.rendered = options.rendered ?? false;
    this.colorScheme = options.colorScheme ?? 'light';
    this.controls = resolveControls(options.controls, isMarkdownOnly(options));
    this.toolbarActions = options.toolbarActions ?? [];
    injectDiffViewStyles(container.ownerDocument);
    container.replaceChildren();
    this.root = container.ownerDocument.createElement('div');
    this.density = options.toolbarDensity ?? 'comfortable';
    this.applyRootClass();
    this.root.innerHTML = `
      <div class="mdzip-diff-toolbar" role="toolbar" aria-label="Comparison controls">
        <button class="mdzip-diff-toolbar-button" type="button" data-ref="navigation" title="Toggle navigation" aria-label="Toggle navigation"></button>
        <button class="mdzip-diff-toolbar-button" type="button" data-ref="prev-change" title="Previous change" aria-label="Previous change"></button>
        <button class="mdzip-diff-toolbar-button" type="button" data-ref="next-change" title="Next change" aria-label="Next change"></button>
        <span class="mdzip-diff-change-count" data-ref="change-count" aria-live="polite" hidden></span>
        <button class="mdzip-diff-toolbar-button" type="button" data-ref="show-unchanged" title="Show unchanged files" aria-label="Show unchanged files"></button>
        <div class="mdzip-diff-toolbar-group" data-ref="view-mode" role="group" aria-label="Markdown view">
          <button class="mdzip-diff-toolbar-button" type="button" data-ref="source" title="Show Markdown source" aria-label="Show Markdown source"></button>
          <button class="mdzip-diff-toolbar-button" type="button" data-ref="rendered" title="Show rendered Markdown" aria-label="Show rendered Markdown"></button>
        </div>
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
    this.changeCountLabel = this.root.querySelector('[data-ref="change-count"]') as HTMLElement;
    this.showUnchangedButton = this.root.querySelector('[data-ref="show-unchanged"]') as HTMLButtonElement;
    this.viewModeGroup = this.root.querySelector('[data-ref="view-mode"]') as HTMLElement;
    this.sourceButton = this.root.querySelector('[data-ref="source"]') as HTMLButtonElement;
    this.renderedButton = this.root.querySelector('[data-ref="rendered"]') as HTMLButtonElement;
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
    this.showUnchangedButton.innerHTML = iconHtml(ListFilter);
    this.showUnchangedButton.addEventListener('click', () => this.setShowUnchanged(!this.showUnchanged));
    // Same icons as the editor's view modes: the pen for editable source (# when
    // it's read-only), the eye for rendered. Set in renderToolbar.
    this.sourceButton.addEventListener('click', () => { void this.setRendered(false); });
    this.renderedButton.innerHTML = iconHtml(Eye);
    this.renderedButton.addEventListener('click', () => { void this.setRendered(true); });
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
    this.rendered = options.rendered ?? this.rendered;
    this.colorScheme = options.colorScheme ?? this.colorScheme;
    this.density = options.toolbarDensity ?? this.density;
    this.applyRootClass();
    if (options.controls) this.controls = resolveControls(options.controls, isMarkdownOnly(options));
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
    assignMarkdownEntries(before, after);
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
   * Shows Markdown entries rendered (both sides as the preview shows them,
   * with differing blocks marked) or as source. Re-renders the selected
   * entry when it's Markdown.
   */
  public async setRendered(rendered: boolean): Promise<void> {
    if (this.rendered === rendered) return;
    this.rendered = rendered;
    this.updateBuiltInControls();
    this.options.onRenderedChanged?.(rendered);
    if (this.selectedPath && this.selectedEntry()?.kind === 'markdown') {
      await this.renderSelection(this.selectedPath);
    }
  }

  /**
   * Replaces a plain-Markdown side's text, for a change made somewhere else
   * (another editor, undo, revert). The source view updates in place, keeping
   * the cursor and scroll position, and doesn't call `onMarkdownChange`; the
   * rendered view re-renders. A side that had no text (missing) needs
   * `open()` instead.
   */
  public async updateMarkdown(which: 'before' | 'after', text: string): Promise<void> {
    const side = which === 'before' ? this.before : this.after;
    if (!side?.markdown || side.markdown.text === text) return;
    side.markdown = { ...side.markdown, text, bytes: new TextEncoder().encode(text) };
    const entry = this.selectedEntry();
    if (!entry || !this.selectedPath || entry.path !== side.inventory.entryPoint) return;
    if (this.mergeView) {
      const editor = which === 'before' ? this.mergeView.a : this.mergeView.b;
      const current = editor.state.doc.toString();
      let start = 0;
      while (start < current.length && start < text.length && current[start] === text[start]) start += 1;
      let endCurrent = current.length;
      let endText = text.length;
      while (endCurrent > start && endText > start && current[endCurrent - 1] === text[endText - 1]) {
        endCurrent -= 1;
        endText -= 1;
      }
      editor.dispatch({
        changes: { from: start, to: endCurrent, insert: text.slice(start, endText) },
        annotations: hostUpdate.of(true)
      });
      return;
    }
    await this.renderSelection(this.selectedPath);
  }

  public get isRendered(): boolean {
    return this.rendered;
  }

  private selectedEntry(): ArchiveInventoryDiffEntry | undefined {
    return this.diff?.entries.find((entry) => entry.path === this.selectedPath);
  }

  /**
   * Moves to the previous change: within the selected entry first (a changed
   * chunk of text, or a changed block in the rendered view), then to the
   * last change of the previous changed entry. Resolves `false` when already
   * at the first change.
   */
  public async openPreviousChange(): Promise<boolean> {
    if (this.moveWithinEntry(-1)) return true;
    const target = this.adjacentChange(-1);
    if (!target) return false;
    await this.openPath(target.path);
    const count = this.entryChangeCount();
    if (count > 0) this.goToEntryChange(count - 1);
    return true;
  }

  /**
   * Moves to the next change: within the selected entry first, then to the
   * next changed entry (which opens at its first change). Resolves `false`
   * when already at the last change.
   */
  public async openNextChange(): Promise<boolean> {
    if (this.moveWithinEntry(1)) return true;
    const target = this.adjacentChange(1);
    return target ? this.openPath(target.path) : false;
  }

  /** How many changes the selected entry shows (text chunks, or changed rendered blocks). */
  private entryChangeCount(): number {
    if (this.mergeView) return getChunks(this.mergeView.b.state)?.chunks.length ?? 0;
    return this.renderedChanges.length;
  }

  private moveWithinEntry(direction: 1 | -1): boolean {
    const next = this.changeCursor + direction;
    if (next < 0 || next >= this.entryChangeCount()) return false;
    this.goToEntryChange(next);
    return true;
  }

  /** Scrolls the selected entry to one of its changes, leaving a little context above it. */
  private goToEntryChange(index: number): void {
    if (this.mergeView) {
      const chunk = getChunks(this.mergeView.b.state)?.chunks[index];
      if (!chunk) return;
      this.mergeView.b.dispatch({
        selection: { anchor: chunk.fromB },
        effects: EditorView.scrollIntoView(chunk.fromB, { y: 'start', yMargin: 48 })
      });
    } else {
      const target = this.renderedChanges[index];
      if (!target) return;
      target.side.scrollTop = Math.max(0, offsetWithin(target.side, target.block) - 48);
    }
    this.changeCursor = index;
    this.updateBuiltInControls();
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
    this.viewModeGroup.hidden = !this.controls.rendered;
    const editable = [this.options.before, this.options.after]
      .some((side) => side?.markdown !== undefined && side.editable === true);
    const sourceLabel = editable ? 'Edit Markdown source' : 'Show Markdown source';
    if (this.sourceButton.dataset.icon !== (editable ? 'edit' : 'source')) {
      this.sourceButton.dataset.icon = editable ? 'edit' : 'source';
      this.sourceButton.innerHTML = iconHtml(editable ? SquarePen : Hash);
    }
    this.sourceButton.title = sourceLabel;
    this.sourceButton.setAttribute('aria-label', sourceLabel);
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
      else if (action.icon === 'save') button.innerHTML = iconHtml(Save);
      else button.textContent = action.label;
      button.addEventListener('click', () => void this.runToolbarAction(action));
      this.actionHost.append(button);
    }
    this.toolbar.hidden = false;
  }

  /** Syncs the pressed/disabled state of the built-in change + filter controls. */
  private applyRootClass(): void {
    this.root.className = `mdzip-diff-root mdzip-diff-density-${this.density} mdzip-diff-scheme-${this.colorScheme}`;
  }

  private updateBuiltInControls(): void {
    const count = this.entryChangeCount();
    this.prevChangeButton.disabled = this.changeCursor <= 0 && !this.adjacentChange(-1);
    this.nextChangeButton.disabled = this.changeCursor >= count - 1 && !this.adjacentChange(1);
    // Where you are among the selected entry's changes, so disabled arrows read as
    // "nothing further" rather than broken.
    const selected = this.selectedEntry();
    this.changeCountLabel.hidden = !this.controls.changeTraversal || !selected;
    this.changeCountLabel.textContent = count === 0
      ? 'No changes'
      : `${Math.max(1, this.changeCursor + 1)} of ${count}`;
    this.showUnchangedButton.setAttribute('aria-pressed', String(this.showUnchanged));
    this.showUnchangedButton.classList.toggle('active', this.showUnchanged);
    this.sourceButton.setAttribute('aria-pressed', String(!this.rendered));
    this.sourceButton.classList.toggle('active', !this.rendered);
    this.renderedButton.setAttribute('aria-pressed', String(this.rendered));
    this.renderedButton.classList.toggle('active', this.rendered);
    // Only Markdown has a rendered form; the choice is kept for the next Markdown entry.
    const entry = this.selectedEntry();
    const notMarkdown = Boolean(entry) && entry?.kind !== 'markdown';
    this.sourceButton.disabled = notMarkdown;
    this.renderedButton.disabled = notMarkdown;
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
    if (input.markdown !== undefined) {
      const bytes = new TextEncoder().encode(input.markdown);
      return {
        input,
        archive: null,
        // The entry is added by assignMarkdownEntries once both sides are open.
        inventory: EMPTY_INVENTORY,
        state: 'ready',
        markdown: { text: input.markdown, bytes, hash: await sha256Hex(bytes) }
      };
    }
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
          if (this.rendered && entry.kind === 'markdown') {
            await this.renderRendered(beforeText, afterText, entry, generation);
            if (generation !== this.selectionGeneration) return;
          } else {
            this.renderText(beforeText, afterText, entry);
          }
        } else {
          this.renderBinary(beforeBytes, afterBytes, entry);
        }
      }
      this.updateBuiltInControls();
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
    // Ctrl+F / Cmd+F searches the side that has focus, as in the editor's source view.
    // Only the lines near the scroll position are in the page, so the browser's own
    // find can't see the rest; CodeMirror's search covers the whole text.
    const base: Extension[] = [lineNumbers(), EditorView.lineWrapping, search({ top: true }), keymap.of(searchKeymap)];
    if (entry.kind === 'markdown') base.push(markdown());
    const extensionsFor = (side: DiffSide | null): Extension[] => {
      if (side && this.isEditable(side, entry)) {
        return [...base, EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const fromHost = update.transactions.some((transaction) => transaction.annotation(hostUpdate));
          if (!fromHost) this.markdownEdited(side, update.state.doc.toString());
        })];
      }
      return [...base, EditorState.readOnly.of(true), EditorView.editable.of(false)];
    };
    const beforeExtensions = extensionsFor(this.before);
    const afterExtensions = extensionsFor(this.after);
    if (before === null || after === null) {
      this.body.append(this.createPair(
        this.textSide(before, beforeExtensions),
        this.textSide(after, afterExtensions)
      ));
      return;
    }
    this.mergeView = new MergeView({
      a: { doc: before, extensions: beforeExtensions },
      b: { doc: after, extensions: afterExtensions },
      parent: this.body,
      root: this.root.ownerDocument,
      highlightChanges: true,
      gutter: true,
      diffConfig: { scanLimit: 2000, timeout: 100 }
    });
    // Open at the first change, as the rendered view does.
    if (this.entryChangeCount() > 0) this.goToEntryChange(0);
  }

  /** An editable plain-Markdown side, showing its one document. */
  private isEditable(side: DiffSide, entry: ArchiveInventoryDiffEntry): boolean {
    return Boolean(side.markdown && side.input.editable && entry.path === side.inventory.entryPoint);
  }

  /**
   * Keeps the side's text current, so the rendered view and a re-selection
   * show the edits, and tells the host.
   */
  private markdownEdited(side: DiffSide, text: string): void {
    if (!side.markdown) return;
    side.markdown = { ...side.markdown, text, bytes: new TextEncoder().encode(text) };
    side.input.onMarkdownChange?.(text);
  }

  private async renderRendered(
    before: string | null,
    after: string | null,
    entry: ArchiveInventoryDiffEntry,
    generation: number
  ): Promise<void> {
    if (!this.before || !this.after) return;
    const doc = this.root.ownerDocument;
    injectPreviewStyles(doc);
    const abort = new AbortController();
    this.renderAbort = abort;
    const [beforeFragment, afterFragment] = await Promise.all([
      renderSideFragment(doc, this.renderedSource(this.before, before, entry.before?.path), abort.signal),
      renderSideFragment(doc, this.renderedSource(this.after, after, entry.after?.path), abort.signal)
    ]);
    if (generation !== this.selectionGeneration) return;

    const beforePane = this.renderedPane(beforeFragment);
    const afterPane = this.renderedPane(afterFragment);
    const pair = this.createPair(beforePane.side, afterPane.side);
    pair.classList.add('mdzip-diff-rendered-pair');
    this.body.replaceChildren(pair);
    if (beforePane.content && afterPane.content) {
      const matched = markBlockChanges(beforePane.content, afterPane.content);
      this.stopScrollSync = syncScroll(beforePane.side, afterPane.side, matched);
      // The changes in reading order: what the new version added or edited,
      // plus what the old one lost outright (an edit already shows on the new side).
      // Changed blocks are top-level blocks, or items inside an edited list or quote.
      const blocks = (pane: { side: HTMLElement; content: HTMLElement | null }, selector: string) =>
        Array.from(pane.content?.querySelectorAll<HTMLElement>(selector) ?? [])
          .map((block) => ({ side: pane.side, block, offset: offsetWithin(pane.side, block) }));
      this.renderedChanges = [
        ...blocks(afterPane, '.mdzip-diff-block-added'),
        ...blocks(beforePane, '.mdzip-diff-block-removed:not(.mdzip-diff-block-modified)')
      ].sort((a, b) => a.offset - b.offset).map(({ side, block }) => ({ side, block }));
      // Open at the first change, not the top; the other side follows.
      if (this.renderedChanges.length > 0) this.goToEntryChange(0);
    }
  }

  private renderedSource(side: DiffSide, markdown: string | null, path: string | undefined): RenderedSideSource {
    const createUrl = (bytes: Uint8Array, mime: string): string => {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      this.objectUrls.push(url);
      return url;
    };
    if (side.markdown) {
      // Images live next to the .md file, so the host reads them. Hashes are
      // taken as they're read, so a changed image marks its block.
      const hashes = new Map<string, string>();
      const readResource = side.input.readResource;
      return {
        markdown,
        path,
        manifest: null,
        colorScheme: this.colorScheme,
        sourceFormat: 'markdown',
        readBytes: async (linkedPath) => {
          const bytes = readResource ? await readResource(linkedPath) : null;
          if (bytes) hashes.set(linkedPath, await sha256Hex(bytes));
          return bytes;
        },
        hashOf: (linkedPath) => hashes.get(linkedPath),
        createUrl
      };
    }
    return {
      markdown,
      path,
      manifest: side.inventory.manifest,
      colorScheme: this.colorScheme,
      readBytes: async (entryPath) => {
        if (!side.archive || !side.inventory.entries.some((item) => item.path === entryPath)) return null;
        return side.archive.readBytes(entryPath);
      },
      hashOf: (entryPath) => side.inventory.entries.find((item) => item.path === entryPath)?.hash,
      createUrl
    };
  }

  /**
   * One side of the rendered comparison, inside the workspace preview's own
   * `.mdzip-root .preview-content` scope so it's styled like the preview.
   */
  private renderedPane(fragment: DocumentFragment | null): { side: HTMLElement; content: HTMLElement | null } {
    const doc = this.root.ownerDocument;
    const side = doc.createElement('div');
    side.className = 'mdzip-diff-side mdzip-diff-rendered-side';
    if (!fragment) {
      side.classList.add('mdzip-diff-missing');
      side.textContent = 'File does not exist';
      return { side, content: null };
    }
    const scope = doc.createElement('div');
    scope.className = `mdzip-root mdzip-diff-preview-scope${this.colorScheme === 'dark' ? ' mdzip-theme-dark' : ''}`;
    const content = doc.createElement('article');
    content.className = 'preview-content mdzip-diff-preview';
    content.append(fragment);
    scope.append(content);
    side.append(scope);
    side.addEventListener('click', (event) => this.handleRenderedClick(event, side));
    return { side, content };
  }

  // Links in the rendered comparison don't navigate: the page is a
  // comparison, not a browser. A `#fragment` link scrolls its own side.
  private handleRenderedClick(event: MouseEvent, side: HTMLElement): void {
    const link = (event.target as Element | null)?.closest?.('a[href]');
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href') ?? '';
    if (!href.startsWith('#')) return;
    let id = href.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // Use the raw fragment.
    }
    const target = Array.from(side.querySelectorAll<HTMLElement>('[id]'))
      .find((element) => element.id === id || element.id === `user-content-${id}`);
    target?.scrollIntoView({ block: 'start' });
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
    this.changeCursor = -1;
    this.renderedChanges = [];
    this.renderAbort?.abort();
    this.renderAbort = null;
    this.stopScrollSync?.();
    this.stopScrollSync = null;
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

function resolveControls(
  controls: MdzipDiffControlsOptions | undefined,
  markdownOnly: boolean
): Required<MdzipDiffControlsOptions> {
  return {
    navigation: controls?.navigation ?? !markdownOnly,
    changeTraversal: controls?.changeTraversal ?? true,
    showUnchanged: controls?.showUnchanged ?? false,
    rendered: controls?.rendered ?? true
  };
}

/** An element's offset from the top of a scrolling pane's content. */
function offsetWithin(pane: HTMLElement, element: HTMLElement): number {
  return element.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
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
  if (!path) return null;
  if (side.markdown) return path === side.inventory.entryPoint ? side.markdown.bytes : null;
  return side.archive ? side.archive.readBytes(path) : null;
}

/** True when every side given is plain Markdown (a missing side counts too), and at least one is. */
function isMarkdownOnly(options: MdzipDiffViewOptions): boolean {
  const sides = [options.before, options.after];
  return sides.some((side) => side.markdown !== undefined)
    && sides.every((side) => side.markdown !== undefined || !side.bytes);
}

/**
 * Gives each plain-Markdown side its single entry. The name is shared so the
 * two sides compare as one document: the archive's entry point when the other
 * side is an archive (comparing `notes.md` with `notes.mdz` lines it up with
 * the main document), otherwise the `.md` file name.
 */
function assignMarkdownEntries(before: DiffSide, after: DiffSide): void {
  if (!before.markdown && !after.markdown) return;
  const archiveSide = [after, before].find((side) => side.archive && side.inventory.entryPoint);
  const path = archiveSide?.inventory.entryPoint
    ?? markdownFileName(after.input.fileName)
    ?? markdownFileName(before.input.fileName)
    ?? DEFAULT_MARKDOWN_PATH;
  for (const side of [before, after]) {
    if (!side.markdown) continue;
    side.inventory = {
      entries: [{ path, kind: 'markdown', size: side.markdown.bytes.length, hash: side.markdown.hash }],
      entryPoint: path,
      manifest: null
    };
  }
}

function markdownFileName(fileName: string | undefined): string | undefined {
  const base = fileName?.split(/[\\/]/).pop();
  return base && /\.(md|markdown)$/i.test(base) ? base : undefined;
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
