import { MdzArchiveCore, type MdzManifest } from '@mdzip/core-js';
import { markdown as markdownLanguage } from '@codemirror/lang-markdown';
import { Chunk } from '@codemirror/merge';
import { search, searchKeymap } from '@codemirror/search';
import { EditorState, RangeSet, StateEffect, StateField, Text, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, WidgetType, gutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { ChevronDown, ChevronUp, Eye, SquarePen, type IconNode } from 'lucide';
import { MergeModel, type MergeRegion, type MergeSide, type RegionChoice } from './merge-regions.js';
import { mapScrollPosition, matchSequences, type ScrollAnchor } from './scroll-anchors.js';

export type { MergeSide } from './merge-regions.js';
import { removeFilesFromArchive, updateBinaryInArchive } from './archive-utils.js';
import { markBlockChanges, renderSideFragment, type RenderedSideSource } from './diff-rendered.js';
import { injectDiffViewStyles, injectPreviewStyles } from './diff-view-css.js';
import {
  findMergeConflicts,
  mergeConflictReplacement,
  type MergeConflict,
  type MergeConflictResolution
} from './merge-conflicts.js';

/**
 * Resolves a merge: an `.mdz` archive as `mdz merge` left it, or a plain
 * Markdown file with conflict markers.
 *
 * A tree lists the archive's files with a marker for each: text conflicts to
 * resolve (●), a file-level decision (◐, an image both sides replaced), a
 * choice the merge made that's worth reviewing (↺, a file one side deleted and
 * the other changed, manifest fields both changed), or merged (✓). Selecting a
 * text file shows incoming (theirs) and current (ours) side by side over the
 * result, which you can edit, as the Visual Studio and VS Code merge editors
 * do: a checkbox beside each change takes it into the result (ticking both
 * sides of a conflict keeps both, in the order ticked), and each conflict in
 * the result has Accept Incoming / Accept Current / Accept Both.
 *
 * Pass the three versions Git holds during a merge (`versions`) to see every
 * change, renames and the merge's own choices; without them the view works
 * from the conflict markers alone.
 */
export interface MdzipMergeViewOptions {
  /** The merge result to resolve: an `.mdz` archive... */
  bytes?: Uint8Array;
  /** ...or a plain Markdown document's text. */
  markdown?: string;
  /** The common ancestor, current (ours) and incoming (theirs): Git's index stages 1, 2 and 3. Null when that side has no such file. */
  versions?: MdzipMergeVersions;
  /** The file's name; for a plain document, also its path. */
  fileName?: string;
  /** Names shown under "Current" (ours) and "Incoming" (theirs), e.g. branch names. */
  oursLabel?: string;
  theirsLabel?: string;
  /** For a plain Markdown document: reads an image it links to, for the rendered view. */
  readResource?: (path: string) => Promise<Uint8Array | null | undefined>;
  /** Start rendered (true) or as source. Default false: source, where the result can be edited. */
  rendered?: boolean;
  colorScheme?: 'light' | 'dark';
  /** Toolbar button size, as the diff view's. Default `'comfortable'`. */
  toolbarDensity?: 'comfortable' | 'compact' | 'dense';
  /** After each change to the result: the changed entry's new text, and for an archive the archive's new bytes. */
  onChange?: (event: MdzipMergeChangeEvent) => void;
  /** When the last conflict is resolved. */
  onResolved?: () => void;
  /**
   * Shows a Complete Merge button; called when it's clicked, after every
   * change has been reported through `onChange`. `remaining` is what's still
   * unresolved, so the host can ask before completing anyway.
   */
  onComplete?: (event: MdzipMergeCompleteEvent) => void | Promise<void>;
  onFailed?: (error: Error) => void;
}

export interface MdzipMergeCompleteEvent {
  /** Conflicts and decisions still unresolved. */
  remaining: number;
}

/** One version of the document: archive bytes or Markdown text. */
export interface MdzipMergeSource {
  bytes?: Uint8Array;
  markdown?: string;
}

export interface MdzipMergeVersions {
  base?: MdzipMergeSource | null;
  ours?: MdzipMergeSource | null;
  theirs?: MdzipMergeSource | null;
}

export interface MdzipMergeChangeEvent {
  /** The entry (or plain document) that changed. */
  path: string;
  /** Its new text, for a text entry or a plain document; absent when it was removed or isn't text. */
  text?: string;
  /** The whole archive after the change, for an archive. */
  bytes?: Uint8Array;
  /** Conflicts still to resolve. */
  remaining: number;
}

/** What's left to resolve: a conflict block in a text, or an image both sides replaced. */
export type MdzipMergeItem =
  | { kind: 'text'; path: string; conflict: MergeConflict }
  | {
    /** An entry both sides replaced: `mdz merge` kept ours at `path` and theirs at `copyPath`. */
    kind: 'binary';
    path: string;
    copyPath: string;
  };

/** Resolution of a binary item: keep current (ours), or replace it with incoming (theirs). */
export type MdzipBinaryResolution = 'ours' | 'theirs';

/** ● text conflicts, ◐ a decision, ↺ the merge's choice to review, ✓ merged, or unchanged. */
export type MdzipMergeEntryState = 'conflict' | 'decision' | 'review' | 'merged' | 'unchanged';

export interface MdzipMergeEntry {
  /** Its path in the result (or where it was, if it's gone). */
  path: string;
  state: MdzipMergeEntryState;
  /** What happened to it, e.g. "Changed in both", "Renamed from notes.md in current". */
  summary: string;
  /** Conflict blocks in its text. */
  conflicts: number;
  /** Whether the result has it. */
  inResult: boolean;
}

interface ManifestField {
  key: string;
  ours: unknown;
  theirs: unknown;
  /** Which side the result has now. */
  chosen: 'ours' | 'theirs';
}

interface EntryRecord {
  path: string;
  text: boolean;
  base: Uint8Array | null;
  ours: Uint8Array | null;
  theirs: Uint8Array | null;
  /** Where each side had it, when that differs (a rename). */
  basePath: string | null;
  oursPath: string | null;
  theirsPath: string | null;
  inResult: boolean;
  /** `mdz merge` kept theirs here (`name.theirs.ext`). */
  copyPath?: string;
  /** The merge chose for one side that deleted it: worth a look. */
  deleteVsChange?: 'ours-deleted' | 'theirs-deleted';
  manifestFields?: ManifestField[];
  reviewed: boolean;
  summary: string;
  /** Its marker in the tree, from the current result. */
  state(): MdzipMergeEntryState;
  summaryText(): string;
}

type EntryInit = Partial<Omit<EntryRecord, 'state' | 'summaryText'>> & { path: string; text: boolean; inResult: boolean };

interface VersionFiles {
  files: Map<string, Uint8Array>;
  manifest: Record<string, unknown> | null;
}

type Side = 'ours' | 'theirs';

const MERGE_STYLE_ID = 'mdzip-merge-view-styles';
const MANIFEST_PATH = 'manifest.json';
const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'json', 'txt', 'svg', 'drawio', 'css', 'csv', 'tsv',
  'html', 'htm', 'xml', 'yml', 'yaml', 'js', 'mjs', 'ts', 'toml', 'ini', 'mmd'
]);
/** `images/chart.theirs.png` or `images/chart.theirs-2.png` → `images/chart.png`. */
const THEIRS_COPY_RE = /^(.*)\.theirs(?:-\d+)?(\.[^./]+)?$/;
/** Text files sharing at least this much (Dice coefficient of their lines) count as renamed, as `mdz merge` does. */
const RENAME_SIMILARITY = 0.6;
/** Manifest fields the merge always settles itself. */
const MANIFEST_SETTLED = new Set(['created', 'modified', 'files']);
const COMMIT_DELAY_MS = 300;
const MARKERS: Record<MdzipMergeEntryState, string> = {
  conflict: '●', decision: '◐', review: '↺', merged: '✓', unchanged: ''
};

const setCurrentConflict = StateEffect.define<number>();

export class MdzipMergeView {
  private readonly root: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly navList: HTMLElement;
  private readonly navSummary: HTMLElement;
  private readonly content: HTMLElement;
  private readonly prevButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly countLabel: HTMLElement;
  private readonly sourceButton: HTMLButtonElement;
  private readonly renderedButton: HTMLButtonElement;
  private readonly completeButton: HTMLButtonElement;
  private options: MdzipMergeViewOptions;
  private rendered: boolean;
  private colorScheme: 'light' | 'dark';
  private density: 'comfortable' | 'compact' | 'dense';
  private showUnchanged = false;

  private plain = false;
  private resultBytes: Uint8Array | null = null;
  private resultFiles = new Map<string, Uint8Array>();
  private resultManifest: MdzManifest | null = null;
  private versionFiles: { base: VersionFiles | null; ours: VersionFiles | null; theirs: VersionFiles | null } | null = null;
  private readonly texts = new Map<string, string>();
  private entries: EntryRecord[] = [];
  private items: MdzipMergeItem[] = [];
  private cursor = 0;
  private selectedPath: string | null = null;
  /** The current conflict within the selected text entry. */
  private currentInEntry = 0;
  private resultEditor: EditorView | null = null;
  private sideEditors: Partial<Record<Side, EditorView>> = {};
  /** Each text entry's merge regions, kept in step with its text. */
  private readonly models = new Map<string, MergeModel>();
  /** The region of the current conflict in the shown file, or -1. */
  private currentRegion = -1;
  private takeAllBoxes: Partial<Record<Side, HTMLInputElement>> = {};
  private resultStatus: HTMLElement | null = null;
  private stopScrollSync: (() => void) | null = null;
  private readonly pendingCommits = new Set<string>();
  private commitTimer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private renderGeneration = 0;
  private busy: Promise<void> = Promise.resolve();
  private objectUrls: string[] = [];
  private lastRemaining = -1;
  private destroyed = false;

  constructor(container: HTMLElement, options: MdzipMergeViewOptions) {
    this.options = options;
    this.rendered = options.rendered ?? false;
    this.colorScheme = options.colorScheme ?? 'light';
    this.density = options.toolbarDensity ?? 'comfortable';
    const doc = container.ownerDocument;
    injectDiffViewStyles(doc);
    injectMergeStyles(doc);
    container.replaceChildren();
    this.root = doc.createElement('div');
    this.applyRootClass();
    this.root.innerHTML = `
      <div class="mdzip-diff-toolbar" role="toolbar" aria-label="Conflict controls">
        <button class="mdzip-diff-toolbar-button" type="button" data-ref="prev-conflict" title="Previous conflict" aria-label="Previous conflict"></button>
        <button class="mdzip-diff-toolbar-button" type="button" data-ref="next-conflict" title="Next conflict" aria-label="Next conflict"></button>
        <span class="mdzip-diff-change-count" data-ref="conflict-count" aria-live="polite"></span>
        <div class="mdzip-diff-toolbar-group" role="group" aria-label="Markdown view">
          <button class="mdzip-diff-toolbar-button" type="button" data-ref="source" title="Edit Markdown source" aria-label="Edit Markdown source"></button>
          <button class="mdzip-diff-toolbar-button" type="button" data-ref="rendered" title="Show rendered Markdown" aria-label="Show rendered Markdown"></button>
        </div>
        <button class="mdzip-merge-complete" type="button" data-ref="complete" hidden>Complete Merge</button>
      </div>
      <div class="mdzip-merge-workspace">
        <nav class="mdzip-diff-nav mdzip-merge-nav" aria-label="Files">
          <div class="mdzip-diff-summary mdzip-merge-nav-summary" data-ref="nav-summary"></div>
          <div class="mdzip-diff-list" role="listbox" aria-label="Files" data-ref="nav-list"></div>
        </nav>
        <section class="mdzip-merge-content" data-ref="content"><div class="mdzip-diff-message">Loading the merge...</div></section>
      </div>`;
    container.append(this.root);
    const ref = <T extends HTMLElement>(name: string) => this.root.querySelector(`[data-ref="${name}"]`) as T;
    this.nav = this.root.querySelector('.mdzip-merge-nav') as HTMLElement;
    this.navList = ref('nav-list');
    this.navSummary = ref('nav-summary');
    this.content = ref('content');
    this.prevButton = ref<HTMLButtonElement>('prev-conflict');
    this.nextButton = ref<HTMLButtonElement>('next-conflict');
    this.countLabel = ref('conflict-count');
    this.sourceButton = ref<HTMLButtonElement>('source');
    this.renderedButton = ref<HTMLButtonElement>('rendered');
    this.completeButton = ref<HTMLButtonElement>('complete');
    this.completeButton.addEventListener('click', () => {
      this.completeButton.disabled = true;
      this.complete().catch((cause) => this.fail(cause)).finally(() => { this.completeButton.disabled = false; });
    });
    this.prevButton.innerHTML = iconHtml(ChevronUp);
    this.nextButton.innerHTML = iconHtml(ChevronDown);
    this.sourceButton.innerHTML = iconHtml(SquarePen);
    this.renderedButton.innerHTML = iconHtml(Eye);
    this.prevButton.addEventListener('click', () => this.openPreviousConflict());
    this.nextButton.addEventListener('click', () => this.openNextConflict());
    this.sourceButton.addEventListener('click', () => { void this.setRendered(false); });
    this.renderedButton.addEventListener('click', () => { void this.setRendered(true); });
    void this.open(options);
  }

  // ------------------------------------------------------------ public API

  /** Loads a merge (again), replacing what the view had. */
  public async open(options: MdzipMergeViewOptions): Promise<void> {
    this.flushCommits();
    this.options = options;
    this.rendered = options.rendered ?? this.rendered;
    this.colorScheme = options.colorScheme ?? this.colorScheme;
    this.density = options.toolbarDensity ?? this.density;
    this.applyRootClass();
    const generation = ++this.generation;
    this.texts.clear();
    this.models.clear();
    this.resultBytes = null;
    this.resultFiles = new Map();
    this.resultManifest = null;
    this.versionFiles = null;
    this.lastRemaining = -1;
    try {
      if (options.markdown !== undefined) {
        this.plain = true;
        this.entries = [this.plainEntry(options.markdown)];
      } else if (options.bytes) {
        this.plain = false;
        const entries = await this.loadArchive(options.bytes, options.versions);
        if (generation !== this.generation) return;
        this.entries = entries;
      } else {
        throw new Error('Pass an archive (bytes) or a Markdown document (markdown) to resolve.');
      }
      this.refreshItems();
      this.lastRemaining = this.items.length;
      this.cursor = 0;
      const first = this.items[0];
      const start = first?.path
        ?? this.entries.find((entry) => entry.state() !== 'unchanged' && entry.state() !== 'merged')?.path
        ?? this.visibleEntries()[0]?.path
        ?? null;
      this.selectedPath = start;
      this.currentInEntry = 0;
      this.renderNav();
      await this.renderEntry();
    } catch (cause) {
      if (generation !== this.generation) return;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.options.onFailed?.(error);
      this.content.innerHTML = `<div class="mdzip-diff-message mdzip-diff-error">${escapeHtml(error.message)}</div>`;
    }
  }

  /** What's left to resolve, in the tree's order. */
  public get conflicts(): readonly MdzipMergeItem[] {
    return this.items;
  }

  public get conflictCount(): number {
    return this.items.length;
  }

  /** Every file the merge touched (and, with `versions`, the unchanged ones), in the tree's order. */
  public get files(): readonly MdzipMergeEntry[] {
    return this.entries.map((entry) => ({
      path: entry.path,
      state: entry.state(),
      summary: entry.summaryText(),
      conflicts: entry.text && entry.inResult ? findMergeConflicts(this.texts.get(entry.path) ?? '').length : 0,
      inResult: entry.inResult
    }));
  }

  public get isRendered(): boolean {
    return this.rendered;
  }

  /** The file the view shows. */
  public get selectedFile(): string | null {
    return this.selectedPath;
  }

  /** A text entry's current text (the plain document's when `path` is omitted). */
  public getText(path?: string): string | undefined {
    return this.texts.get(path ?? (this.plain ? this.entries[0]?.path : this.selectedPath) ?? '');
  }

  /** The archive as resolved so far (pending edits included), or null for a plain document. */
  public getArchiveBytes(): Uint8Array | null {
    return this.resultBytes;
  }

  public async setRendered(rendered: boolean): Promise<void> {
    if (this.rendered === rendered) return;
    this.flushCommits();
    this.rendered = rendered;
    this.updateToolbar();
    await this.renderEntry();
  }

  /** Shows a file. */
  public async selectFile(path: string): Promise<void> {
    if (!this.entries.some((entry) => entry.path === path)) return;
    this.flushCommits();
    this.selectedPath = path;
    this.currentInEntry = 0;
    const index = this.items.findIndex((item) => item.path === path);
    if (index >= 0) this.cursor = index;
    this.renderNav();
    await this.renderEntry();
  }

  public openNextConflict(): boolean {
    if (this.cursor >= this.items.length - 1) return false;
    void this.goTo(this.cursor + 1);
    return true;
  }

  public openPreviousConflict(): boolean {
    if (this.cursor <= 0) return false;
    void this.goTo(this.cursor - 1);
    return true;
  }

  /**
   * Resolves item `index` (in {@link conflicts}). A text conflict takes a
   * {@link MergeConflictResolution}; a binary one `'ours'` or `'theirs'`.
   */
  public resolve(index: number, resolution: MergeConflictResolution | MdzipBinaryResolution): Promise<void> {
    return this.queue(async () => {
      const item = this.items[index];
      if (!item) throw new RangeError(`There is no conflict ${index + 1} to resolve.`);
      if (item.kind === 'text') {
        const conflicts = findMergeConflicts(this.texts.get(item.path) ?? '');
        const within = conflicts.findIndex((conflict) => conflict.start === item.conflict.start);
        await this.resolveTextConflict(item.path, within < 0 ? item.conflict.index : within, resolution as MergeConflictResolution);
      } else {
        await this.resolveBinary(item, resolution as MdzipBinaryResolution);
      }
    });
  }

  /**
   * Settles a file the merge kept although one side deleted it: keep it, or
   * delete it.
   */
  public resolveFile(path: string, action: 'keep' | 'delete'): Promise<void> {
    return this.queue(async () => {
      const entry = this.entries.find((candidate) => candidate.path === path);
      if (!entry) throw new RangeError(`${path} isn't part of this merge.`);
      if (action === 'delete' && entry.inResult) {
        this.flushCommits();
        if (this.resultBytes) this.resultBytes = await removeFilesFromArchive(this.resultBytes, [path]);
        this.resultFiles.delete(path);
        this.texts.delete(path);
        entry.inResult = false;
      }
      entry.reviewed = true;
      await this.afterChange({ path });
    });
  }

  /** Sets a manifest field both sides changed to current (ours) or incoming (theirs). */
  public chooseManifestField(key: string, side: Side): Promise<void> {
    return this.queue(async () => {
      const entry = this.entries.find((candidate) => candidate.manifestFields);
      const field = entry?.manifestFields?.find((candidate) => candidate.key === key);
      if (!entry || !field || !this.resultBytes) throw new RangeError(`The manifest has no conflicting field "${key}".`);
      const manifest = parseJson(this.resultFiles.get(MANIFEST_PATH)) ?? {};
      const value = side === 'ours' ? field.ours : field.theirs;
      if (value === undefined) delete manifest[key];
      else manifest[key] = value;
      const bytes = encode(`${JSON.stringify(manifest, null, 2)}\n`);
      this.resultBytes = await updateBinaryInArchive(this.resultBytes, MANIFEST_PATH, bytes);
      this.resultFiles.set(MANIFEST_PATH, bytes);
      field.chosen = side;
      entry.reviewed = true;
      await this.afterChange({ path: MANIFEST_PATH });
    });
  }

  /**
   * Sets which sides a text file's change takes, as its checkboxes do: `index`
   * counts the file's changes (conflicts and one-sided changes alike) from the
   * top, `sides` in the order they go in. No sides takes the original text, or
   * for a conflict brings its markers back.
   */
  public chooseChange(path: string, index: number, sides: readonly MergeSide[]): Promise<void> {
    return this.queue(async () => {
      const entry = this.entry(path);
      const model = entry ? this.modelFor(entry) : null;
      const region = model?.regions[index];
      if (!model || !region) throw new RangeError(`${path} has no change ${index + 1}.`);
      const choice: RegionChoice = sides.length ? [...sides] : region.kind === 'conflict' ? 'unresolved' : [];
      await this.setChoices(path, [[index, choice]]);
    });
  }

  /** Reports every change, then calls `onComplete` (the Complete Merge button). */
  public async complete(): Promise<void> {
    this.flushCommits();
    await this.busyCommit;
    await this.busy;
    await this.options.onComplete?.({ remaining: this.items.length });
  }

  public destroy(): void {
    this.flushCommits();
    this.destroyed = true;
    this.generation += 1;
    this.renderGeneration += 1;
    this.destroyEditors();
    this.revokeUrls();
    this.root.remove();
  }

  // ------------------------------------------------------------ loading

  private documentPath(): string {
    return this.options.fileName?.split(/[\\/]/).pop() || 'document.md';
  }

  private plainEntry(text: string): EntryRecord {
    const path = this.documentPath();
    this.texts.set(path, text);
    const versions = this.options.versions;
    const side = (source: MdzipMergeSource | null | undefined) =>
      source?.markdown !== undefined ? encode(source.markdown) : null;
    const base = versions ? side(versions.base) : null;
    const ours = versions ? side(versions.ours) : null;
    const theirs = versions ? side(versions.theirs) : null;
    const entry = this.makeEntry({
      path, text: true, base, ours, theirs, basePath: base ? path : null, oursPath: ours ? path : null,
      theirsPath: theirs ? path : null, inResult: true
    });
    entry.summary = versions ? describeChange(entry) : '';
    return entry;
  }

  private async loadArchive(bytes: Uint8Array, versions: MdzipMergeVersions | undefined): Promise<EntryRecord[]> {
    const result = await readVersion(bytes);
    this.resultBytes = bytes;
    this.resultFiles = result.files;
    const archive = await MdzArchiveCore.open(bytes);
    this.resultManifest = await archive.readManifest().catch(() => null);

    if (versions) {
      const read = async (source: MdzipMergeSource | null | undefined) =>
        (source?.bytes ? readVersion(source.bytes).catch(() => null) : null);
      const [base, ours, theirs] = await Promise.all([read(versions.base), read(versions.ours), read(versions.theirs)]);
      this.versionFiles = { base, ours, theirs };
    }
    const entries = this.versionFiles ? this.classify(this.versionFiles) : this.classifyFromResult();
    for (const entry of entries) {
      if (entry.text && entry.inResult) {
        const bytesNow = this.resultFiles.get(entry.path);
        if (bytesNow) this.texts.set(entry.path, decode(bytesNow));
      }
    }
    return this.sortEntries(entries);
  }

  /** Without the versions: the texts with conflict markers, and the images kept from both sides. */
  private classifyFromResult(): EntryRecord[] {
    const entries: EntryRecord[] = [];
    for (const [path, bytes] of this.resultFiles) {
      if (isTextPath(path) && findMergeConflicts(decode(bytes)).length > 0) {
        entries.push(this.makeEntry({ path, text: true, inResult: true }));
      }
    }
    for (const [copyPath] of this.resultFiles) {
      const original = theirsCopyOriginal(copyPath);
      if (original && this.resultFiles.has(original) && !isTextPath(original)) {
        entries.push(this.makeEntry({ path: original, text: false, inResult: true, copyPath }));
      }
    }
    return entries;
  }

  /** With the versions: every file, how each side changed it, renames, and the merge's own choices. */
  private classify(versions: { base: VersionFiles | null; ours: VersionFiles | null; theirs: VersionFiles | null }): EntryRecord[] {
    const base = versions.base?.files ?? new Map<string, Uint8Array>();
    const ours = versions.ours?.files ?? new Map<string, Uint8Array>();
    const theirs = versions.theirs?.files ?? new Map<string, Uint8Array>();
    const oursRenames = findRenames(base, ours);
    const theirsRenames = findRenames(base, theirs);

    // Each file under one path: where a side renamed it, under the new name (current first).
    const logical = new Map<string, { basePath: string | null; oursPath: string | null; theirsPath: string | null }>();
    const renamedFrom = new Set<string>();
    for (const basePath of base.keys()) {
      const oursPath = oursRenames.get(basePath) ?? (ours.has(basePath) ? basePath : null);
      const theirsPath = theirsRenames.get(basePath) ?? (theirs.has(basePath) ? basePath : null);
      const path = oursRenames.get(basePath) ?? theirsRenames.get(basePath) ?? basePath;
      if (path !== basePath) renamedFrom.add(basePath);
      logical.set(path, { basePath, oursPath, theirsPath });
    }
    const renameTargets = new Set([...oursRenames.values(), ...theirsRenames.values()]);
    for (const path of ours.keys()) {
      if (logical.has(path) || renameTargets.has(path) || base.has(path)) continue;
      logical.set(path, { basePath: null, oursPath: path, theirsPath: theirs.has(path) ? path : null });
    }
    for (const path of theirs.keys()) {
      if (logical.has(path) || renameTargets.has(path) || base.has(path) || ours.has(path)) continue;
      logical.set(path, { basePath: null, oursPath: null, theirsPath: path });
    }

    // Copies `mdz merge` made of theirs beside an image both replaced.
    const copies = new Map<string, string>();
    for (const path of this.resultFiles.keys()) {
      const original = theirsCopyOriginal(path);
      if (original && !logical.has(path) && this.resultFiles.has(original)) copies.set(original, path);
    }

    const entries: EntryRecord[] = [];
    for (const [path, where] of logical) {
      if (path === MANIFEST_PATH) continue;
      const entry = this.makeEntry({
        path,
        text: isTextPath(path),
        base: where.basePath ? base.get(where.basePath) ?? null : null,
        ours: where.oursPath ? ours.get(where.oursPath) ?? null : null,
        theirs: where.theirsPath ? theirs.get(where.theirsPath) ?? null : null,
        basePath: where.basePath,
        oursPath: where.oursPath,
        theirsPath: where.theirsPath,
        inResult: this.resultFiles.has(path),
        copyPath: copies.get(path)
      });
      if (entry.base && !entry.copyPath) {
        if (!entry.ours && entry.theirs && !bytesEqual(entry.theirs, entry.base) && entry.inResult) entry.deleteVsChange = 'ours-deleted';
        if (!entry.theirs && entry.ours && !bytesEqual(entry.ours, entry.base) && entry.inResult) entry.deleteVsChange = 'theirs-deleted';
      }
      entry.summary = describeChange(entry);
      entries.push(entry);
    }
    // Anything else in the result (added by hand, or by the merge).
    for (const path of this.resultFiles.keys()) {
      if (path === MANIFEST_PATH || logical.has(path) || [...copies.values()].includes(path) || renamedFrom.has(path)) continue;
      const entry = this.makeEntry({ path, text: isTextPath(path), inResult: true });
      entry.summary = 'In the result only';
      entries.push(entry);
    }

    const fields = manifestConflicts(versions.base?.manifest ?? null, versions.ours?.manifest ?? null, versions.theirs?.manifest ?? null,
      parseJson(this.resultFiles.get(MANIFEST_PATH)));
    if (fields.length) {
      const entry = this.makeEntry({ path: MANIFEST_PATH, text: false, inResult: true });
      entry.manifestFields = fields;
      entry.summary = `${fields.length === 1 ? 'A field' : `${fields.length} fields`} changed on both sides`;
      entries.push(entry);
    }
    return entries;
  }

  private makeEntry(init: EntryInit): EntryRecord {
    const entry: EntryRecord = {
      base: null, ours: null, theirs: null, basePath: null, oursPath: null, theirsPath: null,
      reviewed: false, summary: '',
      ...init,
      state: (): MdzipMergeEntryState => {
        if (entry.text && entry.inResult && findMergeConflicts(this.texts.get(entry.path) ?? '').length > 0) return 'conflict';
        if (entry.copyPath && this.resultFiles.has(entry.copyPath)) return 'decision';
        if ((entry.deleteVsChange || entry.manifestFields) && !entry.reviewed) return 'review';
        if (this.versionFiles && !entry.manifestFields && bytesEqual(entry.ours, entry.base) && bytesEqual(entry.theirs, entry.base)
          && entry.basePath === entry.path && entry.inResult === Boolean(entry.base)
          && (!entry.inResult || bytesEqual(this.currentBytes(entry.path), entry.base))) {
          return 'unchanged';
        }
        return 'merged';
      },
      summaryText: (): string => entry.summary
    };
    return entry;
  }

  /** Entry point first, then by folder and name. */
  private sortEntries(entries: EntryRecord[]): EntryRecord[] {
    const entryPoint = this.resultManifest?.entryPoint;
    return entries.sort((a, b) => {
      if (a.path === entryPoint) return -1;
      if (b.path === entryPoint) return 1;
      const da = dirname(a.path);
      const db = dirname(b.path);
      if (da !== db) return da.localeCompare(db);
      return a.path.localeCompare(b.path);
    });
  }

  private currentBytes(path: string): Uint8Array | null {
    const text = this.texts.get(path);
    if (text !== undefined) return encode(text);
    return this.resultFiles.get(path) ?? null;
  }

  // ------------------------------------------------------------ state

  private entry(path: string | null): EntryRecord | undefined {
    return this.entries.find((entry) => entry.path === path);
  }

  private visibleEntries(): EntryRecord[] {
    return this.entries
      .filter((entry) => this.showUnchanged || entry.state() !== 'unchanged' || entry.path === this.selectedPath);
  }

  private refreshItems(): void {
    const items: MdzipMergeItem[] = [];
    for (const entry of this.entries) {
      if (entry.text && entry.inResult) {
        for (const conflict of findMergeConflicts(this.texts.get(entry.path) ?? '')) {
          items.push({ kind: 'text', path: entry.path, conflict });
        }
      }
      if (entry.copyPath && this.resultFiles.has(entry.copyPath)) {
        items.push({ kind: 'binary', path: entry.path, copyPath: entry.copyPath });
      }
    }
    this.items = items;
    this.cursor = Math.min(this.cursor, Math.max(0, items.length - 1));
  }

  private queue(run: () => Promise<void>): Promise<void> {
    const next = this.busy.then(run);
    this.busy = next.catch(() => undefined);
    return next;
  }

  /** The merge regions of a text entry in the result: from the versions when they line up, else from its conflict markers. */
  private modelFor(entry: EntryRecord): MergeModel | null {
    if (!entry.text || !entry.inResult) return null;
    const text = normalize(this.texts.get(entry.path) ?? '');
    const cached = this.models.get(entry.path);
    if (cached && cached.text === text) return cached;
    let model: MergeModel | null = null;
    if (this.hasVersions() && entry.ours && entry.theirs) {
      model = MergeModel.fromVersions(text, entry.base ? normalize(decode(entry.base)) : '',
        normalize(decode(entry.ours)), normalize(decode(entry.theirs)));
    }
    model ??= MergeModel.fromMarkers(text);
    this.models.set(entry.path, model);
    return model;
  }

  private hasVersions(): boolean {
    return Boolean(this.versionFiles || (this.plain && this.options.versions));
  }

  /** Sets regions of a text entry to choices: through its editor when it's open (so undo works), else directly. */
  private async setChoices(path: string, choices: Array<[number, RegionChoice]>): Promise<void> {
    const entry = this.entry(path);
    const model = entry ? this.modelFor(entry) : null;
    if (!entry || !model) throw new Error(`${path} has no merge to resolve.`);
    const changes = choices
      .map(([index, choice]) => model.change(index, choice))
      .filter((change) => model.text.slice(change.from, change.to) !== change.insert)
      .sort((a, b) => b.from - a.from);
    if (!changes.length) return;
    const editor = this.resultEditor && this.selectedPath === path ? this.resultEditor : null;
    if (editor) {
      editor.dispatch({ changes, userEvent: 'input.merge' });
      this.flushCommits();
      await this.busyCommit;
      return;
    }
    // Last first, so the earlier changes' positions still hold.
    for (const change of changes) model.apply(change);
    const raw = this.texts.get(path) ?? '';
    this.texts.set(path, raw.includes('\r\n') ? model.text.replace(/\n/g, '\r\n') : model.text);
    await this.commitText(path);
    if (this.selectedPath === path) await this.renderEntry();
  }

  private async resolveTextConflict(path: string, index: number, resolution: MergeConflictResolution): Promise<void> {
    const entry = this.entry(path);
    const model = entry ? this.modelFor(entry) : null;
    const editor = this.resultEditor && this.selectedPath === path ? this.resultEditor : null;
    const conflict = findMergeConflicts(editor ? editor.state.doc.toString() : normalize(this.texts.get(path) ?? ''))[index];
    if (!conflict) throw new RangeError(`There is no conflict ${index + 1} in ${path}.`);
    const regionIndex = model ? model.regionAt(conflict.start) : -1;
    const choice = resolutionChoice(resolution);
    if (model && regionIndex >= 0 && choice && model.regions[regionIndex].from === conflict.start) {
      await this.setChoices(path, [[regionIndex, choice]]);
      return;
    }
    if (editor) {
      editor.dispatch({ changes: { from: conflict.start, to: conflict.end, insert: mergeConflictReplacement(conflict, resolution) } });
      this.flushCommits();
      await this.busyCommit;
      return;
    }
    const raw = this.texts.get(path) ?? '';
    const text = normalize(raw);
    const resolved = text.slice(0, conflict.start) + mergeConflictReplacement(conflict, resolution) + text.slice(conflict.end);
    this.texts.set(path, raw.includes('\r\n') ? resolved.replace(/\n/g, '\r\n') : resolved);
    await this.commitText(path);
    if (this.selectedPath === path) await this.renderEntry();
  }

  private async resolveBinary(item: Extract<MdzipMergeItem, { kind: 'binary' }>, resolution: MdzipBinaryResolution): Promise<void> {
    if (!this.resultBytes) throw new Error('Only an archive has image conflicts.');
    this.flushCommits();
    let bytes = this.resultBytes;
    if (resolution === 'theirs') {
      const theirs = this.resultFiles.get(item.copyPath);
      if (!theirs) throw new Error(`${item.copyPath} is missing.`);
      bytes = await updateBinaryInArchive(bytes, item.path, theirs);
      this.resultFiles.set(item.path, theirs);
    } else if (resolution !== 'ours') {
      throw new Error('Keep current ("ours") or take incoming ("theirs") for an image.');
    }
    this.resultBytes = await removeFilesFromArchive(bytes, [item.copyPath]);
    this.resultFiles.delete(item.copyPath);
    await this.afterChange({ path: item.path });
  }

  /** A text entry changed in the editor: refresh markers now, write the archive shortly. */
  private textEdited(path: string, text: string): void {
    this.texts.set(path, text);
    this.refreshItems();
    this.updateToolbar();
    this.renderNav();
    this.updateConflictBar();
    if (path === this.selectedPath) this.refreshMergeUi();
    this.pendingCommits.add(path);
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => this.flushCommits(), COMMIT_DELAY_MS);
  }

  private busyCommit: Promise<void> = Promise.resolve();

  /** Writes edited texts into the archive and reports them now. */
  private flushCommits(): void {
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = undefined;
    if (!this.pendingCommits.size) return;
    const paths = [...this.pendingCommits];
    this.pendingCommits.clear();
    this.busyCommit = this.busyCommit.then(async () => {
      for (const path of paths) await this.commitText(path);
    }).catch((cause) => this.fail(cause));
  }

  private async commitText(path: string): Promise<void> {
    const text = this.texts.get(path);
    if (text === undefined) return;
    if (this.resultBytes) {
      const bytes = encode(text);
      this.resultBytes = await updateBinaryInArchive(this.resultBytes, path, bytes);
      this.resultFiles.set(path, bytes);
    }
    await this.afterChange({ path, text }, false);
  }

  /** Refreshes the tree and counts, and reports the change. */
  private async afterChange(change: { path: string; text?: string }, rerender = true): Promise<void> {
    if (this.destroyed) return;
    this.refreshItems();
    this.updateToolbar();
    this.renderNav();
    if (rerender && change.path === this.selectedPath) await this.renderEntry();
    else this.updateConflictBar();
    const remaining = this.items.length;
    this.options.onChange?.({
      path: change.path,
      text: change.text ?? this.texts.get(change.path),
      bytes: this.resultBytes ?? undefined,
      remaining
    });
    if (remaining === 0 && this.lastRemaining !== 0) this.options.onResolved?.();
    this.lastRemaining = remaining;
  }

  private fail(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    this.options.onFailed?.(error);
  }

  private async goTo(index: number): Promise<void> {
    this.flushCommits();
    const item = this.items[index];
    if (!item) return;
    this.cursor = index;
    const within = item.kind === 'text'
      ? this.items.filter((candidate) => candidate.path === item.path && candidate.kind === 'text').indexOf(item)
      : 0;
    if (this.selectedPath !== item.path) {
      this.selectedPath = item.path;
      this.currentInEntry = within;
      this.renderNav();
      await this.renderEntry();
    } else {
      this.setCurrentInEntry(within, true);
    }
    this.updateToolbar();
  }

  // ------------------------------------------------------------ toolbar and tree

  private applyRootClass(): void {
    this.root.className = `mdzip-diff-root mdzip-merge-root mdzip-diff-density-${this.density} mdzip-diff-scheme-${this.colorScheme}`;
  }

  private updateToolbar(): void {
    const count = this.items.length;
    this.countLabel.textContent = count === 0
      ? 'No conflicts'
      : `${Math.min(this.cursor, count - 1) + 1} of ${count} conflict${count === 1 ? '' : 's'}`;
    this.prevButton.disabled = this.cursor <= 0 || count === 0;
    this.nextButton.disabled = this.cursor >= count - 1;
    this.sourceButton.classList.toggle('active', !this.rendered);
    this.sourceButton.setAttribute('aria-pressed', String(!this.rendered));
    this.renderedButton.classList.toggle('active', this.rendered);
    this.renderedButton.setAttribute('aria-pressed', String(this.rendered));
    this.completeButton.hidden = !this.options.onComplete;
    this.completeButton.classList.toggle('ready', count === 0);
    this.completeButton.title = count === 0
      ? 'Save the result and mark the conflict resolved'
      : `${count} still to resolve`;
  }

  private renderNav(): void {
    const doc = this.root.ownerDocument;
    this.nav.hidden = this.plain;
    this.root.classList.toggle('mdzip-merge-single', this.plain);
    if (this.plain) return;
    const states = this.entries.map((entry) => entry.state());
    const count = (state: MdzipMergeEntryState) => states.filter((candidate) => candidate === state).length;
    const unchanged = count('unchanged');
    const parts = [
      count('conflict') ? `${count('conflict')} with conflicts` : '',
      count('decision') ? `${count('decision')} to decide` : '',
      count('review') ? `${count('review')} to review` : '',
      count('merged') ? `${count('merged')} merged` : ''
    ].filter(Boolean);
    this.navSummary.innerHTML = `
      <div class="mdzip-diff-labels">${escapeHtml(this.documentPath())}</div>
      <div class="mdzip-diff-counts">${escapeHtml(parts.join(' · ') || 'Nothing to resolve')}</div>
      ${unchanged ? `<label class="mdzip-diff-filter"><input type="checkbox" data-ref="show-unchanged"${this.showUnchanged ? ' checked' : ''}> Show ${unchanged} unchanged</label>` : ''}`;
    this.navSummary.querySelector<HTMLInputElement>('[data-ref="show-unchanged"]')?.addEventListener('change', (event) => {
      this.showUnchanged = (event.target as HTMLInputElement).checked;
      this.renderNav();
    });

    const rows: HTMLElement[] = [];
    let lastDir: string | null = null;
    for (const entry of this.visibleEntries()) {
      const dir = dirname(entry.path);
      if (dir !== lastDir) {
        if (dir) {
          const segments = dir.split('/');
          const heading = doc.createElement('div');
          heading.className = 'mdzip-diff-directory';
          heading.style.setProperty('--mdzip-diff-depth', String(segments.length - 1));
          heading.textContent = segments[segments.length - 1];
          rows.push(heading);
        }
        lastDir = dir;
      }
      const state = entry.state();
      const conflicts = entry.text && entry.inResult ? findMergeConflicts(this.texts.get(entry.path) ?? '').length : 0;
      const row = doc.createElement('button');
      row.type = 'button';
      row.className = `mdzip-diff-entry mdzip-merge-entry mdzip-merge-state-${state}${entry.path === this.selectedPath ? ' active' : ''}${entry.inResult ? '' : ' mdzip-merge-gone'}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(entry.path === this.selectedPath));
      row.dataset.path = entry.path;
      row.style.setProperty('--mdzip-diff-depth', String(dir ? dir.split('/').length : 0));
      row.title = entry.summaryText() || entry.path;
      const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
      row.innerHTML = `<span class="mdzip-merge-marker" aria-hidden="true">${MARKERS[state]}</span>`
        + `<span class="mdzip-diff-path">${escapeHtml(name)}${conflicts ? ` <span class="mdzip-merge-entry-count">${conflicts}</span>` : ''}</span>`;
      row.setAttribute('aria-label', `${entry.path}: ${stateLabel(state)}${conflicts ? `, ${conflicts} conflict${conflicts === 1 ? '' : 's'}` : ''}`);
      row.addEventListener('click', () => { void this.selectFile(entry.path); });
      rows.push(row);
    }
    this.navList.replaceChildren(...rows);
  }

  // ------------------------------------------------------------ the selected file

  private destroyEditors(): void {
    this.resultEditor?.destroy();
    this.resultEditor = null;
    for (const editor of Object.values(this.sideEditors)) editor?.destroy();
    this.sideEditors = {};
    this.takeAllBoxes = {};
    this.resultStatus = null;
    this.stopScrollSync?.();
  }

  private async renderEntry(): Promise<void> {
    const generation = ++this.renderGeneration;
    this.destroyEditors();
    this.revokeUrls();
    this.updateToolbar();
    const doc = this.root.ownerDocument;
    const entry = this.entry(this.selectedPath);
    if (!entry) {
      this.content.innerHTML = `<div class="mdzip-diff-message">${this.entries.length ? 'Choose a file.' : 'Nothing to resolve.'}</div>`;
      return;
    }
    injectPreviewStyles(doc);
    const panel = doc.createElement('div');
    panel.className = 'mdzip-merge-panel';
    panel.append(this.renderHeader(entry));
    // In the page before any editor is made, so CodeMirror can measure.
    this.content.replaceChildren(panel);

    if (entry.manifestFields) {
      panel.append(this.renderManifestFields(entry));
    } else if (!entry.inResult) {
      panel.append(this.message(entry.summaryText() || 'Not in the result.'));
      if (entry.text || isImagePath(entry.path)) await this.renderSides(entry, false, panel, generation);
    } else if (entry.copyPath && this.resultFiles.has(entry.copyPath)) {
      panel.append(this.renderImageDecision(entry));
    } else if (entry.text || isImagePath(entry.path)) {
      await this.renderSides(entry, true, panel, generation);
    } else {
      panel.append(this.message('A binary file: nothing to show.'));
    }
    if (generation !== this.renderGeneration) return;
    this.updateConflictBar();
    this.setCurrentInEntry(this.currentInEntry, true);
  }

  private renderHeader(entry: EntryRecord): HTMLElement {
    const doc = this.root.ownerDocument;
    const header = doc.createElement('div');
    header.className = 'mdzip-merge-header';
    const state = entry.state();
    header.innerHTML = `<div class="mdzip-merge-title"><span class="mdzip-merge-marker mdzip-merge-state-${state}" aria-hidden="true">${MARKERS[state]}</span> ${escapeHtml(entry.path)}</div>`
      + (entry.summaryText() ? `<div class="mdzip-merge-summary">${escapeHtml(entry.summaryText())}</div>` : '');
    if (entry.deleteVsChange && entry.inResult) {
      const [deleter, changer] = entry.deleteVsChange === 'ours-deleted' ? ['Current', 'incoming'] : ['Incoming', 'current'];
      const note = doc.createElement('div');
      note.className = 'mdzip-merge-review';
      note.innerHTML = `<span>${deleter} deleted this file and ${changer} changed it. The merge kept the changed version.</span>`;
      note.append(
        this.actionButton(entry.reviewed ? 'Kept' : 'Keep it', () => this.resolveFile(entry.path, 'keep'), entry.reviewed),
        this.actionButton('Delete it', () => this.resolveFile(entry.path, 'delete'))
      );
      header.append(note);
    }
    return header;
  }

  private message(text: string): HTMLElement {
    const element = this.root.ownerDocument.createElement('div');
    element.className = 'mdzip-diff-message';
    element.textContent = text;
    return element;
  }

  /** Incoming and current on top (as VS Code and Visual Studio place them); the result below. */
  private async renderSides(entry: EntryRecord, withResult: boolean, parent: HTMLElement, generation: number): Promise<void> {
    const doc = this.root.ownerDocument;
    const layout = doc.createElement('div');
    layout.className = 'mdzip-merge-layout';
    const top = doc.createElement('div');
    top.className = 'mdzip-merge-top';
    layout.append(top);
    parent.append(layout);
    const model = this.modelFor(entry);
    const sides = model ? model.sides : this.sideTexts(entry);
    for (const side of ['theirs', 'ours'] as const) {
      const pane = this.paneShell(sideTitle(side), side === 'ours' ? this.options.oursLabel : this.options.theirsLabel, `mdzip-merge-pane-${side}`);
      if (model?.regions.some((region) => region.kind !== 'same' && (region.kind === side || region.kind === 'conflict'))) {
        pane.heading.append(this.takeAllBox(entry.path, side));
      }
      top.append(pane.pane);
      await this.fillSide(pane.body, entry, side, sides);
      if (generation !== this.renderGeneration) return;
    }
    if (withResult) {
      if (this.rendered) {
        const bar = doc.createElement('div');
        bar.className = 'mdzip-merge-bar';
        bar.dataset.ref = 'conflict-bar';
        layout.append(bar);
      }
      const result = this.paneShell('Result', entry.text && !this.rendered ? 'edit here' : '', 'mdzip-merge-pane-result');
      if (model) {
        this.resultStatus = doc.createElement('span');
        this.resultStatus.className = 'mdzip-merge-remaining';
        this.resultStatus.setAttribute('aria-live', 'polite');
        result.heading.append(this.resultStatus);
      }
      layout.append(result.pane);
      await this.fillResult(result.body, entry);
    }
    if (generation !== this.renderGeneration) return;
    layout.classList.toggle('mdzip-merge-aligned', Boolean(model));
    this.refreshMergeUi();
    this.syncScrolling(layout, Boolean(model) && Boolean(this.resultEditor));
  }

  /**
   * Scrolls the panes together, as the Visual Studio and VS Code merge
   * editors do. Lined up (source view), the same scroll position shows the
   * same lines in each; otherwise each pane scrolls to the same proportion.
   */
  private syncScrolling(layout: HTMLElement, aligned: boolean): void {
    this.stopScrollSync?.();
    const scrollers = [this.sideEditors.theirs, this.sideEditors.ours, this.resultEditor]
      .map((editor) => editor?.scrollDOM)
      .filter((element): element is HTMLElement => Boolean(element));
    // Rendered: the pane bodies scroll.
    if (!scrollers.length) {
      scrollers.push(...Array.from(layout.querySelectorAll<HTMLElement>('.mdzip-merge-pane-body')));
    }
    if (scrollers.length < 2) return;
    // Rendered panes: the same heading (level and text) in two panes is an anchor.
    const headings = new Map<HTMLElement, HTMLElement[]>();
    const matches = new Map<string, Array<[number, number]>>();
    const headingsIn = (scroller: HTMLElement) => {
      let list = headings.get(scroller);
      if (!list) {
        list = Array.from(scroller.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
        headings.set(scroller, list);
      }
      return list;
    };
    const offsetIn = (scroller: HTMLElement, element: HTMLElement) =>
      element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const headingAnchors = (source: HTMLElement, target: HTMLElement): ScrollAnchor[] => {
      const from = headingsIn(source);
      const to = headingsIn(target);
      const key = `${scrollers.indexOf(source)}:${scrollers.indexOf(target)}`;
      let pairs = matches.get(key);
      if (!pairs) {
        const label = (heading: HTMLElement) => `${heading.tagName}:${(heading.textContent ?? '').trim()}`;
        pairs = matchSequences(from.map(label), to.map(label));
        matches.set(key, pairs);
      }
      return pairs.map(([i, j]) => [offsetIn(source, from[i]), offsetIn(target, to[j])] as const);
    };
    const expected = new Map<HTMLElement, number>();
    const listeners = scrollers.map((source) => {
      const listener = () => {
        const wanted = expected.get(source);
        if (wanted !== undefined) {
          expected.delete(source);
          // A scroll this sync set off, not the user.
          if (Math.abs(source.scrollTop - wanted) < 2) return;
        }
        for (const target of scrollers) {
          if (target === source) continue;
          const max = target.scrollHeight - target.clientHeight;
          const top = aligned ? source.scrollTop : mapScrollPosition(source.scrollTop, headingAnchors(source, target), source, target);
          const clamped = Math.max(0, Math.min(top, max));
          if (Math.abs(target.scrollTop - clamped) < 1) continue;
          expected.set(target, clamped);
          target.scrollTop = clamped;
        }
      };
      source.addEventListener('scroll', listener, { passive: true });
      return () => source.removeEventListener('scroll', listener);
    });
    this.stopScrollSync = () => {
      for (const stop of listeners) stop();
      this.stopScrollSync = null;
    };
  }

  /** "Take All Incoming" / "Take All Current": every change on that side, every conflict that side's way. */
  private takeAllBox(path: string, side: Side): HTMLElement {
    const doc = this.root.ownerDocument;
    const label = doc.createElement('label');
    label.className = 'mdzip-merge-take-all';
    const box = doc.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      const take = box.checked;
      void this.queue(async () => {
        const entry = this.entry(path);
        const model = entry ? this.modelFor(entry) : null;
        if (!model) return;
        const choices: Array<[number, RegionChoice]> = [];
        model.regions.forEach((region, index) => {
          if (!regionOnSide(region, side)) return;
          const has = sideChecked(region, side);
          if (take && !has) choices.push([index, region.kind === 'same' ? ['ours', 'theirs'] : [side]]);
          if (!take && has) choices.push([index, model.toggled(index, side)]);
        });
        await this.setChoices(path, choices);
      }).catch((cause) => this.fail(cause));
    });
    this.takeAllBoxes[side] = box;
    label.append(box, ` Take All ${sideTitle(side)}`);
    return label;
  }

  /** Brings the checkboxes, Take All boxes and remaining count of the shown file up to date. */
  private refreshMergeUi(): void {
    const entry = this.entry(this.selectedPath);
    const model = entry ? this.models.get(entry.path) : undefined;
    if (!entry || !model) return;
    if (this.resultStatus) {
      const remaining = model.remaining;
      this.resultStatus.textContent = remaining === 0 ? 'No conflicts remaining' : `${remaining} conflict${remaining === 1 ? '' : 's'} remaining`;
      this.resultStatus.classList.toggle('done', remaining === 0);
    }
    const aligned = this.sideEditors.ours || this.sideEditors.theirs
      ? alignment(model, this.resultEditor?.state.doc ?? Text.of(model.text.split('\n')))
      : null;
    for (const side of ['ours', 'theirs'] as const) {
      const regions = model.regions.filter((region) => regionOnSide(region, side));
      const box = this.takeAllBoxes[side];
      if (box) {
        const checked = regions.filter((region) => sideChecked(region, side)).length;
        box.checked = regions.length > 0 && checked === regions.length;
        box.indeterminate = checked > 0 && checked < regions.length;
      }
      const editor = this.sideEditors[side];
      if (!editor) continue;
      const marks: SideMark[] = [];
      model.regions.forEach((region, index) => {
        if (!regionOnSide(region, side)) return;
        const [start, end] = side === 'ours' ? region.oursLines : region.theirsLines;
        marks.push({
          index, start, end,
          checked: sideChecked(region, side),
          conflict: region.kind === 'conflict',
          manual: region.choice === 'manual' || region.choice === 'base',
          current: index === this.currentRegion
        });
      });
      editor.dispatch({ effects: [setSideMarks.of(marks), setSideSpacers.of(aligned?.[side] ?? [])] });
    }
  }

  /** A checkbox beside a change was clicked. */
  private toggleRegion(side: Side, index: number): void {
    const path = this.selectedPath ?? '';
    void this.queue(async () => {
      const entry = this.entry(path);
      const model = entry ? this.modelFor(entry) : null;
      if (!model?.regions[index]) return;
      await this.setChoices(path, [[index, model.toggled(index, side)]]);
    }).catch((cause) => this.fail(cause));
  }

  private paneShell(title: string, label: string | undefined, className: string): { pane: HTMLElement; heading: HTMLElement; body: HTMLElement } {
    const doc = this.root.ownerDocument;
    const pane = doc.createElement('div');
    pane.className = `mdzip-merge-pane ${className}`;
    const heading = doc.createElement('div');
    heading.className = 'mdzip-merge-pane-heading';
    const names = doc.createElement('div');
    names.className = 'mdzip-merge-pane-names';
    const name = doc.createElement('span');
    name.className = 'mdzip-merge-pane-title';
    name.textContent = title;
    names.append(name);
    if (label) {
      const small = doc.createElement('span');
      small.className = 'mdzip-merge-pane-label';
      small.textContent = label;
      names.append(small);
    }
    heading.append(names);
    const body = doc.createElement('div');
    body.className = 'mdzip-merge-pane-body';
    pane.append(heading, body);
    return { pane, heading, body };
  }

  /** Each side's full text: from the versions, or from the result's conflict markers. */
  private sideTexts(entry: EntryRecord): { base: string | null; ours: string | null; theirs: string | null } {
    if (!entry.text) return { base: null, ours: null, theirs: null };
    if (this.versionFiles || (this.plain && this.options.versions)) {
      return {
        base: entry.base ? normalize(decode(entry.base)) : null,
        ours: entry.ours ? normalize(decode(entry.ours)) : null,
        theirs: entry.theirs ? normalize(decode(entry.theirs)) : null
      };
    }
    const text = normalize(this.texts.get(entry.path) ?? '');
    const all = (resolution: 'ours' | 'theirs' | 'base') => replaceAllConflicts(text, resolution);
    const hasBase = findMergeConflicts(text).every((conflict) => conflict.base !== null);
    return { base: hasBase ? all('base') : null, ours: all('ours'), theirs: all('theirs') };
  }

  private async fillSide(body: HTMLElement, entry: EntryRecord, side: Side, texts: { base: string | null; ours: string | null; theirs: string | null }): Promise<void> {
    const doc = this.root.ownerDocument;
    const bytes = this.versionFiles || (this.plain && this.options.versions) ? entry[side] : this.resultFiles.get(side === 'ours' ? entry.path : entry.copyPath ?? entry.path) ?? null;
    if (!entry.text) {
      if (!bytes) {
        body.append(this.placeholder(`Not in ${sideName(side)}`));
        return;
      }
      body.append(this.imageElement(bytes, entry.path));
      return;
    }
    const text = texts[side];
    if (text === null) {
      body.append(this.placeholder(`Deleted in ${sideName(side)}, or never added`));
      return;
    }
    if (this.rendered && isMarkdownPath(entry.path)) {
      const article = await this.renderMarkdown(text, entry.path, side);
      if (texts.base !== null && article) {
        const baseArticle = await this.renderMarkdown(texts.base, entry.path, 'base');
        if (baseArticle) markBlockChanges(baseArticle, article);
      }
      if (article) {
        body.append(this.previewScope(article));
        return;
      }
    }
    const view = new EditorView({
      parent: body,
      root: doc,
      state: EditorState.create({
        doc: text,
        extensions: [
          ...this.editorBase(entry.path, !this.models.has(entry.path)),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          this.models.has(entry.path)
            ? sideRegions(side, (index) => this.toggleRegion(side, index))
            : changedLines(texts.base, text, `mdzip-merge-line-${side}`)
        ]
      })
    });
    this.sideEditors[side] = view;
  }

  private async fillResult(body: HTMLElement, entry: EntryRecord): Promise<void> {
    if (!entry.text) {
      const bytes = this.resultFiles.get(entry.path);
      body.append(bytes ? this.imageElement(bytes, entry.path) : this.placeholder('Not in the result'));
      return;
    }
    const raw = this.texts.get(entry.path) ?? '';
    if (this.rendered && isMarkdownPath(entry.path)) {
      // Unresolved conflicts show the current version, marked where incoming differs.
      const current = await this.renderMarkdown(replaceAllConflicts(raw, 'ours'), entry.path, 'result');
      const incoming = await this.renderMarkdown(replaceAllConflicts(raw, 'theirs'), entry.path, 'result');
      if (current) {
        if (incoming) markBlockChanges(incoming, current);
        const scope = this.previewScope(current);
        scope.classList.add('mdzip-merge-result-preview');
        if (findMergeConflicts(raw).length) {
          body.append(this.placeholder('Unresolved conflicts show the current version, marked. Switch to the source view to edit the result.'));
        }
        body.append(scope);
        return;
      }
    }
    const crlf = raw.includes('\r\n');
    const path = entry.path;
    const model = this.modelFor(entry);
    const view = new EditorView({
      parent: body,
      root: this.root.ownerDocument,
      state: EditorState.create({
        doc: raw,
        extensions: [
          // Lines level with the panes above: no wrapping.
          ...this.editorBase(path, !model),
          crlf ? EditorState.lineSeparator.of('\r\n') : [],
          resultDecorations(model, (resolution, index) => {
            void this.queue(() => this.resolveTextConflict(path, index, resolution)).catch((cause) => this.fail(cause));
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.textEdited(path, update.state.sliceDoc(0));
            if (update.selectionSet && !update.docChanged) {
              const head = update.state.selection.main.head;
              const conflicts = findMergeConflicts(update.state.doc.toString());
              const at = conflicts.findIndex((conflict) => head >= conflict.start && head < conflict.end);
              if (at >= 0 && at !== this.currentInEntry) setTimeout(() => this.setCurrentInEntry(at, false), 0);
            }
          })
        ]
      })
    });
    this.resultEditor = view;
  }

  private editorBase(path: string, wrap = true): Extension[] {
    const extensions: Extension[] = [lineNumbers(), wrap ? EditorView.lineWrapping : [], search({ top: true }), keymap.of(searchKeymap)];
    if (isMarkdownPath(path)) extensions.push(markdownLanguage());
    return extensions;
  }

  private async renderMarkdown(text: string, path: string, version: Side | 'base' | 'result'): Promise<HTMLElement | null> {
    const doc = this.root.ownerDocument;
    const fragment = await renderSideFragment(doc, this.renderedSource(text, path, version), new AbortController().signal)
      .catch(() => null);
    if (!fragment) return null;
    const article = doc.createElement('article');
    article.className = 'preview-content mdzip-diff-preview mdzip-merge-preview';
    article.append(fragment);
    article.addEventListener('click', (event) => {
      if ((event.target as Element | null)?.closest?.('a')) event.preventDefault();
    });
    return article;
  }

  private previewScope(article: HTMLElement): HTMLElement {
    const scope = this.root.ownerDocument.createElement('div');
    scope.className = `mdzip-root mdzip-diff-preview-scope${this.colorScheme === 'dark' ? ' mdzip-theme-dark' : ''}`;
    scope.append(article);
    return scope;
  }

  private renderedSource(markdown: string, path: string, version: Side | 'base' | 'result'): RenderedSideSource {
    const createUrl = (bytes: Uint8Array, mime: string) => this.createUrl(bytes, mime);
    if (this.plain) {
      const readResource = this.options.readResource;
      return {
        markdown, path, manifest: null, colorScheme: this.colorScheme, sourceFormat: 'markdown',
        readBytes: async (linked) => (readResource ? (await readResource(linked)) ?? null : null),
        hashOf: () => undefined,
        createUrl
      };
    }
    const files = version === 'result' ? this.resultFiles : this.versionFiles?.[version]?.files ?? this.resultFiles;
    return {
      markdown, path, manifest: this.resultManifest, colorScheme: this.colorScheme,
      readBytes: async (entryPath) => files.get(entryPath) ?? this.resultFiles.get(entryPath) ?? null,
      hashOf: () => undefined,
      createUrl
    };
  }

  private renderImageDecision(entry: EntryRecord): HTMLElement {
    const doc = this.root.ownerDocument;
    const layout = doc.createElement('div');
    layout.className = 'mdzip-merge-layout';
    const note = this.placeholder('Both sides replaced this image. The merge kept the current one and saved the incoming one beside it; choose one.');
    const top = doc.createElement('div');
    top.className = 'mdzip-merge-top';
    const incoming = this.paneShell('Incoming', [this.options.theirsLabel, entry.copyPath].filter(Boolean).join(' · '), 'mdzip-merge-pane-theirs');
    const current = this.paneShell('Current', this.options.oursLabel, 'mdzip-merge-pane-ours');
    incoming.heading.append(this.actionButton('Take Incoming', () => this.resolveImage(entry, 'theirs')));
    current.heading.append(this.actionButton('Keep Current', () => this.resolveImage(entry, 'ours')));
    const oursBytes = this.resultFiles.get(entry.path);
    const theirsBytes = entry.copyPath ? this.resultFiles.get(entry.copyPath) : undefined;
    current.body.append(oursBytes ? this.imageElement(oursBytes, entry.path) : this.placeholder('Missing'));
    incoming.body.append(theirsBytes ? this.imageElement(theirsBytes, entry.copyPath ?? entry.path) : this.placeholder('Missing'));
    top.append(incoming.pane, current.pane);
    layout.append(note, top);
    if (entry.base) {
      const original = this.paneShell('Original', '', 'mdzip-merge-pane-base');
      original.body.append(this.imageElement(entry.base, entry.path));
      layout.append(original.pane);
    }
    return layout;
  }

  private resolveImage(entry: EntryRecord, resolution: MdzipBinaryResolution): Promise<void> {
    const index = this.items.findIndex((item) => item.kind === 'binary' && item.path === entry.path);
    return this.resolve(index, resolution);
  }

  private renderManifestFields(entry: EntryRecord): HTMLElement {
    const doc = this.root.ownerDocument;
    const wrap = doc.createElement('div');
    wrap.className = 'mdzip-merge-fields';
    wrap.append(this.placeholder('Both sides changed these document properties. The merge kept the current values; choose for each.'));
    const table = doc.createElement('table');
    table.className = 'mdzip-merge-field-table';
    table.innerHTML = '<thead><tr><th>Property</th><th>Incoming</th><th>Current</th><th></th></tr></thead>';
    const body = doc.createElement('tbody');
    for (const field of entry.manifestFields ?? []) {
      const row = doc.createElement('tr');
      const cell = (value: unknown, chosen: boolean) => {
        const td = doc.createElement('td');
        td.className = chosen ? 'mdzip-merge-field-chosen' : '';
        td.textContent = value === undefined ? '(not set)' : typeof value === 'string' ? value : JSON.stringify(value);
        return td;
      };
      const name = doc.createElement('td');
      name.textContent = field.key;
      const action = doc.createElement('td');
      action.append(field.chosen === 'ours'
        ? this.actionButton('Take Incoming', () => this.chooseManifestField(field.key, 'theirs'))
        : this.actionButton('Take Current', () => this.chooseManifestField(field.key, 'ours')));
      row.append(name, cell(field.theirs, field.chosen === 'theirs'), cell(field.ours, field.chosen === 'ours'), action);
      body.append(row);
    }
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  // ------------------------------------------------------------ the current conflict

  private currentConflicts(): MergeConflict[] {
    const entry = this.entry(this.selectedPath);
    if (!entry?.text || !entry.inResult) return [];
    return findMergeConflicts(this.resultEditor ? this.resultEditor.state.doc.toString() : normalize(this.texts.get(entry.path) ?? ''));
  }

  private updateConflictBar(): void {
    const bar = this.content.querySelector<HTMLElement>('[data-ref="conflict-bar"]');
    if (!bar) return;
    const conflicts = this.currentConflicts();
    const doc = this.root.ownerDocument;
    if (!conflicts.length) {
      bar.replaceChildren(Object.assign(doc.createElement('span'), {
        className: 'mdzip-merge-bar-text',
        textContent: 'No conflicts in this file.'
      }));
      return;
    }
    // Resolving the last conflict in the file leaves the current one past the end.
    const index = Math.min(this.currentInEntry, conflicts.length - 1);
    this.currentInEntry = index;
    const conflict = conflicts[index];
    const label = Object.assign(doc.createElement('span'), {
      className: 'mdzip-merge-bar-text',
      textContent: `Conflict ${index + 1} of ${conflicts.length} in this file · line ${conflict.line}`
    });
    const path = this.selectedPath ?? '';
    const run = (resolution: MergeConflictResolution) => () => this.queue(() => this.resolveTextConflict(path, this.currentInEntry, resolution));
    bar.replaceChildren(
      label,
      this.actionButton('Accept Incoming', run('theirs')),
      this.actionButton('Accept Current', run('ours')),
      this.actionButton('Accept Both', run('both')),
      ...(conflict.base !== null ? [this.actionButton('Use Original', run('base'))] : [])
    );
  }

  /** Marks conflict `index` of the shown file as current: the bar, both sides and the result follow. */
  private setCurrentInEntry(index: number, scroll: boolean): void {
    const conflicts = this.currentConflicts();
    this.currentInEntry = conflicts.length ? Math.max(0, Math.min(index, conflicts.length - 1)) : 0;
    const conflict = conflicts[this.currentInEntry];
    const globalIndex = conflict ? this.items.findIndex((item) => item.kind === 'text' && item.path === this.selectedPath && item.conflict.start === conflict.start) : -1;
    if (globalIndex >= 0) this.cursor = globalIndex;
    this.updateToolbar();
    this.updateConflictBar();
    if (this.resultEditor) {
      this.resultEditor.dispatch({
        effects: [
          setCurrentConflict.of(this.currentInEntry),
          ...(scroll && conflict ? [EditorView.scrollIntoView(conflict.start, { y: 'start', yMargin: 40 })] : [])
        ]
      });
    }
    const model = this.selectedPath ? this.models.get(this.selectedPath) : undefined;
    this.currentRegion = conflict && model ? model.regionAt(conflict.start) : -1;
    this.refreshMergeUi();
    const region = model?.regions[this.currentRegion];
    // Lined up, the side panes follow the result's scrolling.
    if (!scroll || !region || (this.resultEditor && this.stopScrollSync)) return;
    for (const side of ['ours', 'theirs'] as const) {
      const editor = this.sideEditors[side];
      if (!editor) continue;
      const doc = editor.state.doc;
      const line = Math.min(doc.lines, (side === 'ours' ? region.oursLines : region.theirsLines)[0] + 1);
      editor.dispatch({ effects: EditorView.scrollIntoView(doc.line(line).from, { y: 'start', yMargin: 40 }) });
    }
  }

  // ------------------------------------------------------------ helpers

  private placeholder(text: string): HTMLElement {
    const element = this.root.ownerDocument.createElement('div');
    element.className = 'mdzip-merge-note';
    element.textContent = text;
    return element;
  }

  private imageElement(bytes: Uint8Array, path: string): HTMLElement {
    const image = this.root.ownerDocument.createElement('img');
    image.className = 'mdzip-merge-image';
    image.alt = path;
    image.src = this.createUrl(bytes, mimeFromPath(path));
    return image;
  }

  private actionButton(label: string, run: () => Promise<void>, disabled = false): HTMLButtonElement {
    const button = this.root.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'mdzip-merge-action';
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', () => {
      button.disabled = true;
      run().catch((cause) => this.fail(cause)).finally(() => { button.disabled = disabled; });
    });
    return button;
  }

  private createUrl(bytes: Uint8Array, mime: string): string {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    this.objectUrls.push(url);
    return url;
  }

  private revokeUrls(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }
}

// ------------------------------------------------------------ CodeMirror pieces

/** A change shown in the incoming or current pane, with its checkbox. */
interface SideMark {
  /** The region, among the file's changes. */
  index: number;
  /** Its lines in this side, `[start, end)` from 0; empty where this side deleted lines. */
  start: number;
  end: number;
  checked: boolean;
  conflict: boolean;
  /** The result has other text there (written by hand, or the original). */
  manual: boolean;
  current: boolean;
}

const setSideMarks = StateEffect.define<SideMark[]>();

class CheckMarker extends GutterMarker {
  constructor(
    private readonly mark: SideMark | null,
    private readonly side: Side,
    private readonly onToggle: (index: number) => void
  ) {
    super();
  }

  override eq(other: CheckMarker): boolean {
    return other.mark?.index === this.mark?.index && other.mark?.checked === this.mark?.checked
      && other.mark?.manual === this.mark?.manual && other.side === this.side;
  }

  override toDOM(view: EditorView): Node {
    const box = view.dom.ownerDocument.createElement('input');
    box.type = 'checkbox';
    box.className = 'mdzip-merge-check';
    const mark = this.mark;
    if (!mark) {
      box.style.visibility = 'hidden';
      return box;
    }
    box.checked = mark.checked;
    box.indeterminate = mark.manual && !mark.checked;
    const what = mark.conflict ? 'this conflict' : 'this change';
    box.title = mark.manual ? `The result has other text here. Tick to use ${sideName(this.side)} for ${what}.`
      : `${mark.checked ? 'Leave out' : 'Take'} ${sideName(this.side)} for ${what}`;
    box.setAttribute('aria-label', `${sideTitle(this.side)}: ${what} (line ${mark.start + 1})`);
    box.addEventListener('mousedown', (event) => event.preventDefault());
    box.addEventListener('click', (event) => {
      event.preventDefault();
      this.onToggle(mark.index);
    });
    return box;
  }
}

/**
 * Filler that keeps the three panes level, as Visual Studio and VS Code pad
 * theirs: blank lines where a pane has fewer lines than the others for the
 * same stretch, room for the result's accept links, and a dashed line where
 * a pane has nothing for a change (lines removed).
 */
interface Spacer {
  /** The line (0-based) it goes above; the pane's line count puts it at the end. */
  line: number;
  /** Blank lines of filler. */
  lines: number;
  /** This pane has no lines for the change. */
  removed: boolean;
  /** Room for the accept links the result shows above a conflict. */
  links: boolean;
  /** Before (-3) a change's end filler, (-2) a gap's filler, then (-1) link room. */
  order: number;
}

type AlignedPane = 'ours' | 'theirs' | 'result';

/** Each pane's filler, from the model's regions and the result's current text. */
function alignment(model: MergeModel, result: Text): Record<AlignedPane, Spacer[]> {
  const spacers: Record<AlignedPane, Spacer[]> = { ours: [], theirs: [], result: [] };
  const panes: AlignedPane[] = ['ours', 'theirs', 'result'];
  const pad = (from: Record<AlignedPane, number>, to: Record<AlignedPane, number>, region: boolean) => {
    const counts = panes.map((pane) => to[pane] - from[pane]);
    const most = Math.max(...counts);
    panes.forEach((pane, index) => {
      const lines = most - counts[index];
      const removed = region && counts[index] === 0;
      if (lines > 0 || removed) spacers[pane].push({ line: to[pane], lines, removed, links: false, order: region ? -3 : -2 });
    });
  };
  const resultLine = (pos: number) => result.lineAt(Math.min(pos, result.length)).number - 1;
  let previous: Record<AlignedPane, number> = { ours: 0, theirs: 0, result: 0 };
  for (const region of model.regions) {
    const start = { ours: region.oursLines[0], theirs: region.theirsLines[0], result: resultLine(region.from) };
    const end = {
      ours: region.oursLines[1],
      theirs: region.theirsLines[1],
      result: region.to > region.from ? result.lineAt(Math.min(region.to, result.length + 1) - 1).number : start.result
    };
    pad(previous, start, false);
    if (region.choice === 'unresolved') {
      for (const pane of ['ours', 'theirs'] as const) spacers[pane].push({ line: start[pane], lines: 0, removed: false, links: true, order: -1 });
    }
    pad(start, end, true);
    previous = end;
  }
  pad(previous, {
    ours: model.sides.ours.split('\n').length,
    theirs: model.sides.theirs.split('\n').length,
    result: result.lines
  }, false);
  return spacers;
}

/** Height of a line in an aligned pane, and of the accept links above a conflict (CSS sets the same). */
const ALIGNED_LINE_PX = 20;

class SpacerWidget extends WidgetType {
  constructor(private readonly spacer: Spacer) {
    super();
  }

  override eq(other: SpacerWidget): boolean {
    return other.spacer.lines === this.spacer.lines && other.spacer.removed === this.spacer.removed && other.spacer.links === this.spacer.links;
  }

  override get estimatedHeight(): number {
    return (this.spacer.lines + (this.spacer.links ? 1 : 0)) * ALIGNED_LINE_PX;
  }

  override toDOM(view: EditorView): HTMLElement {
    const element = view.dom.ownerDocument.createElement('div');
    element.className = `mdzip-merge-spacer${this.spacer.removed ? ' removed' : ''}${this.spacer.links ? ' links' : ''}`;
    element.style.height = `${this.estimatedHeight}px`;
    if (this.spacer.removed) element.title = 'No lines here for this change';
    element.setAttribute('aria-hidden', 'true');
    return element;
  }
}

function spacerDecorations(doc: Text, spacers: Spacer[]): Range<Decoration>[] {
  return spacers.map((spacer) => {
    const atEnd = spacer.line >= doc.lines;
    return Decoration.widget({ widget: new SpacerWidget(spacer), block: true, side: atEnd ? 1 + spacer.order + 3 : spacer.order })
      .range(atEnd ? doc.length : doc.line(spacer.line + 1).from);
  });
}

const setSideSpacers = StateEffect.define<Spacer[]>();

/** The incoming or current pane's changes: tinted, each with a checkbox in the gutter. */
function sideRegions(side: Side, onToggle: (index: number) => void): Extension {
  interface Value { marks: SideMark[]; spacers: Spacer[]; decorations: DecorationSet; markers: RangeSet<GutterMarker> }
  const build = (state: EditorState, marks: SideMark[], spacers: Spacer[]): Value => {
    const doc = state.doc;
    const decorations: Range<Decoration>[] = spacerDecorations(doc, spacers);
    const markers: Range<GutterMarker>[] = [];
    for (const mark of marks) {
      const first = Math.min(mark.start + 1, doc.lines);
      markers.push(new CheckMarker(mark, side, onToggle).range(doc.line(first).from));
      const classes = `mdzip-merge-line-${side}${mark.conflict ? ' mdzip-merge-line-conflict' : ''}${mark.checked ? ' mdzip-merge-line-taken' : ''}${mark.current ? ' mdzip-merge-line-current' : ''}`;
      for (let line = mark.start + 1; line <= Math.min(mark.end, doc.lines); line++) {
        decorations.push(Decoration.line({ class: classes }).range(doc.line(line).from));
      }
    }
    return { marks, spacers, decorations: Decoration.set(decorations, true), markers: RangeSet.of(markers, true) };
  };
  const field = StateField.define<Value>({
    create: () => ({ marks: [], spacers: [], decorations: Decoration.none, markers: RangeSet.empty }),
    update(value, transaction) {
      let { marks, spacers } = value;
      let changed = false;
      for (const effect of transaction.effects) {
        if (effect.is(setSideMarks)) { marks = effect.value; changed = true; }
        if (effect.is(setSideSpacers)) { spacers = effect.value; changed = true; }
      }
      return changed ? build(transaction.state, marks, spacers) : value;
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.decorations)
  });
  return [
    field,
    gutter({
      class: 'mdzip-merge-check-gutter',
      markers: (view) => view.state.field(field).markers,
      initialSpacer: () => new CheckMarker(null, side, onToggle)
    })
  ];
}

/** Lines a side changed from the original. */
function changedLines(base: string | null, text: string, className: string): Extension {
  if (base === null) return [];
  const doc = Text.of(text.split('\n'));
  const chunks = Chunk.build(Text.of(base.split('\n')), doc);
  const ranges: Range<Decoration>[] = [];
  const decoration = Decoration.line({ class: className });
  for (const chunk of chunks) {
    if (chunk.toB <= chunk.fromB) continue;
    const first = doc.lineAt(chunk.fromB).number;
    const last = doc.lineAt(Math.max(chunk.fromB, Math.min(doc.length, chunk.toB - 1))).number;
    for (let line = first; line <= last; line++) ranges.push(decoration.range(doc.line(line).from));
  }
  return EditorView.decorations.of(Decoration.set(ranges, true));
}

class ConflictActionsWidget extends WidgetType {
  constructor(
    private readonly index: number,
    private readonly count: number,
    private readonly hasBase: boolean,
    private readonly current: boolean,
    private readonly onAction: (resolution: MergeConflictResolution, index: number) => void
  ) {
    super();
  }

  override eq(other: ConflictActionsWidget): boolean {
    return other.index === this.index && other.count === this.count && other.hasBase === this.hasBase && other.current === this.current;
  }

  override get estimatedHeight(): number {
    return ALIGNED_LINE_PX;
  }

  override toDOM(view: EditorView): HTMLElement {
    const doc = view.dom.ownerDocument;
    const bar = doc.createElement('div');
    bar.className = `mdzip-merge-inline-actions${this.current ? ' current' : ''}`;
    const label = doc.createElement('span');
    label.className = 'mdzip-merge-inline-label';
    label.textContent = `Conflict ${this.index + 1} of ${this.count}`;
    bar.append(label);
    const links: Array<[string, MergeConflictResolution]> = [
      ['Accept Incoming', 'theirs'], ['Accept Current', 'ours'], ['Accept Both', 'both']
    ];
    if (this.hasBase) links.push(['Use Original', 'base']);
    for (const [text, resolution] of links) {
      const link = doc.createElement('button');
      link.type = 'button';
      link.className = 'mdzip-merge-inline-link';
      link.textContent = text;
      link.addEventListener('mousedown', (event) => event.preventDefault());
      link.addEventListener('click', () => this.onAction(resolution, this.index));
      bar.append(link);
    }
    return bar;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * The result: tints each conflict block's sections and puts the accept links
 * above it, and tints each settled change by where its text came from. Keeps
 * `model` in step with every edit.
 */
function resultDecorations(model: MergeModel | null, onAction: (resolution: MergeConflictResolution, index: number) => void): Extension {
  const build = (state: EditorState, current: number): DecorationSet => {
    const doc = state.doc;
    const conflicts = findMergeConflicts(doc.toString());
    const ranges: Range<Decoration>[] = [];
    for (const region of model?.regions ?? []) {
      if (region.from >= region.to || region.to > doc.length + 1) continue;
      const className = settledClass(region);
      if (!className) continue;
      const first = doc.lineAt(region.from).number;
      const last = doc.lineAt(Math.max(region.from, Math.min(doc.length, region.to - 1))).number;
      for (let number = first; number <= last; number++) ranges.push(Decoration.line({ class: className }).range(doc.line(number).from));
    }
    conflicts.forEach((conflict, index) => {
      ranges.push(Decoration.widget({
        widget: new ConflictActionsWidget(index, conflicts.length, conflict.base !== null, index === current, onAction),
        block: true,
        side: -1
      }).range(conflict.start));
      const oursStart = doc.lineAt(conflict.start).to + 1;
      const oursEnd = oursStart + conflict.ours.length;
      let baseStart = -1;
      let baseEnd = -1;
      let separator = oursEnd;
      if (conflict.base !== null) {
        baseStart = doc.lineAt(oursEnd).to + 1;
        baseEnd = baseStart + conflict.base.length;
        separator = baseEnd;
      }
      const theirsStart = doc.lineAt(separator).to + 1;
      const theirsEnd = theirsStart + conflict.theirs.length;
      const first = doc.lineAt(conflict.start).number;
      const last = doc.lineAt(Math.max(conflict.start, conflict.end - 1)).number;
      for (let number = first; number <= last; number++) {
        const line = doc.line(number);
        let className = 'mdzip-merge-line-marker';
        if (line.from >= oursStart && line.from < oursEnd) className = 'mdzip-merge-line-ours';
        else if (baseStart >= 0 && line.from >= baseStart && line.from < baseEnd) className = 'mdzip-merge-line-base';
        else if (line.from >= theirsStart && line.from < theirsEnd) className = 'mdzip-merge-line-theirs';
        if (index === current) className += ' mdzip-merge-line-in-current';
        ranges.push(Decoration.line({ class: className }).range(line.from));
      }
    });
    if (model && model.text === doc.toString()) ranges.push(...spacerDecorations(doc, alignment(model, doc).result));
    return Decoration.set(ranges, true);
  };
  const field = StateField.define<{ current: number; decorations: DecorationSet }>({
    create: (state) => ({ current: 0, decorations: build(state, 0) }),
    update(value, transaction) {
      let current = value.current;
      for (const effect of transaction.effects) if (effect.is(setCurrentConflict)) current = effect.value;
      if (transaction.docChanged && model && model.text === transaction.startState.doc.toString()) {
        model.update(transaction.newDoc.toString(), (pos, assoc) => transaction.changes.mapPos(pos, assoc));
      }
      if (!transaction.docChanged && current === value.current) return value;
      return { current, decorations: build(transaction.state, current) };
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.decorations)
  });
  return field;
}

/** A settled change's tint in the result: from incoming, current, both, or other text. */
function settledClass(region: MergeRegion): string | null {
  const choice = region.choice;
  if (choice === 'unresolved' || choice === 'base') return null;
  if (choice === 'manual') return 'mdzip-merge-line-manual';
  if (!choice.length) return null;
  if (region.kind === 'same' || choice.length > 1) return 'mdzip-merge-line-both';
  return `mdzip-merge-line-${choice[0]}`;
}

/** Whether `side` has a checkbox for this region: the side changed it. */
function regionOnSide(region: MergeRegion, side: Side): boolean {
  return region.kind === side || region.kind === 'same' || region.kind === 'conflict';
}

function sideChecked(region: MergeRegion, side: Side): boolean {
  return Array.isArray(region.choice) && region.choice.includes(side);
}

function sideTitle(side: Side): string {
  return side === 'ours' ? 'Current' : 'Incoming';
}

function sideName(side: Side): string {
  return side === 'ours' ? 'current' : 'incoming';
}

function resolutionChoice(resolution: MergeConflictResolution): RegionChoice | null {
  switch (resolution) {
    case 'ours': return ['ours'];
    case 'theirs': return ['theirs'];
    case 'both': return ['ours', 'theirs'];
    case 'base': return 'base';
    default: return null;
  }
}

// ------------------------------------------------------------ versions

async function readVersion(bytes: Uint8Array): Promise<VersionFiles> {
  const archive = await MdzArchiveCore.open(bytes);
  const files = new Map<string, Uint8Array>();
  for (const entry of archive.listEntries()) {
    if (entry.isDirectory) continue;
    files.set(entry.path, await archive.readBytes(entry.path));
  }
  return { files, manifest: parseJson(files.get(MANIFEST_PATH)) };
}

/** Old path → new path for the files `side` renamed, as `mdz merge` finds them. */
function findRenames(base: Map<string, Uint8Array>, side: Map<string, Uint8Array>): Map<string, string> {
  const removed = [...base.keys()].filter((path) => path !== MANIFEST_PATH && !side.has(path));
  const added = [...side.keys()].filter((path) => path !== MANIFEST_PATH && !base.has(path) && !theirsCopyOriginal(path));
  const candidates: Array<{ score: number; from: string; to: string }> = [];
  for (const from of removed) {
    const original = base.get(from)!;
    for (const to of added) {
      const bytes = side.get(to)!;
      if (bytesEqual(original, bytes)) {
        candidates.push({ score: 2, from, to });
        continue;
      }
      if (extensionOf(from) !== extensionOf(to) || !isTextPath(from)) continue;
      const score = lineSimilarity(decode(original), decode(bytes));
      if (score >= RENAME_SIMILARITY) candidates.push({ score, from, to });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.from.localeCompare(b.from));
  const renames = new Map<string, string>();
  const taken = new Set<string>();
  for (const { from, to } of candidates) {
    if (renames.has(from) || taken.has(to)) continue;
    renames.set(from, to);
    taken.add(to);
  }
  return renames;
}

function lineSimilarity(a: string, b: string): number {
  const count = (text: string) => {
    const counts = new Map<string, number>();
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (!line.trim()) continue;
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    return counts;
  };
  const linesA = count(a);
  const linesB = count(b);
  let total = 0;
  for (const value of linesA.values()) total += value;
  for (const value of linesB.values()) total += value;
  if (!total) return 0;
  let shared = 0;
  for (const [line, value] of linesA) shared += Math.min(value, linesB.get(line) ?? 0);
  return (2 * shared) / total;
}

function describeChange(entry: EntryRecord): string {
  const parts: string[] = [];
  if (entry.basePath && entry.basePath !== entry.path) {
    const who = entry.oursPath === entry.path && entry.theirsPath !== entry.path ? 'current'
      : entry.theirsPath === entry.path && entry.oursPath !== entry.path ? 'incoming' : 'both';
    parts.push(`Renamed from ${entry.basePath} in ${who}`);
  }
  const oursChanged = !bytesEqual(entry.ours, entry.base);
  const theirsChanged = !bytesEqual(entry.theirs, entry.base);
  if (!entry.base) {
    if (entry.ours && entry.theirs) parts.push('Added in both');
    else if (entry.ours) parts.push('Added in current');
    else if (entry.theirs) parts.push('Added in incoming');
  } else if (!entry.ours && !entry.theirs) {
    parts.push('Deleted in both');
  } else if (!entry.ours) {
    parts.push(theirsChanged ? 'Deleted in current, changed in incoming' : 'Deleted in current');
  } else if (!entry.theirs) {
    parts.push(oursChanged ? 'Deleted in incoming, changed in current' : 'Deleted in incoming');
  } else if (oursChanged && theirsChanged) {
    parts.push(bytesEqual(entry.ours, entry.theirs) ? 'Changed the same way in both' : 'Changed in both');
  } else if (oursChanged) {
    parts.push('Changed in current');
  } else if (theirsChanged) {
    parts.push('Changed in incoming');
  }
  if (entry.copyPath) parts.push(`incoming saved as ${entry.copyPath}`);
  const text = parts.join('; ');
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

/** Top-level manifest fields both sides changed, differently. */
function manifestConflicts(
  base: Record<string, unknown> | null,
  ours: Record<string, unknown> | null,
  theirs: Record<string, unknown> | null,
  result: Record<string, unknown> | null
): ManifestField[] {
  if (!ours || !theirs) return [];
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(ours), ...Object.keys(theirs)]);
  const fields: ManifestField[] = [];
  for (const key of keys) {
    if (MANIFEST_SETTLED.has(key)) continue;
    const b = JSON.stringify(base?.[key]);
    const o = JSON.stringify(ours[key]);
    const t = JSON.stringify(theirs[key]);
    if (o === b || t === b || o === t) continue;
    const now = JSON.stringify(result?.[key]);
    fields.push({ key, ours: ours[key], theirs: theirs[key], chosen: now === t ? 'theirs' : 'ours' });
  }
  return fields;
}

// ------------------------------------------------------------ small helpers

function replaceAllConflicts(text: string, resolution: 'ours' | 'theirs' | 'base'): string {
  let output = '';
  let at = 0;
  for (const conflict of findMergeConflicts(text)) {
    output += text.slice(at, conflict.start) + mergeConflictReplacement(conflict, resolution);
    at = conflict.end;
  }
  return output + text.slice(at);
}

function theirsCopyOriginal(path: string): string | null {
  const match = THEIRS_COPY_RE.exec(path);
  return match ? match[1] + (match[2] ?? '') : null;
}

function parseJson(bytes: Uint8Array | undefined | null): Record<string, unknown> | null {
  if (!bytes) return null;
  try {
    const value = JSON.parse(decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function bytesEqual(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path));
}

function isMarkdownPath(path: string): boolean {
  const extension = extensionOf(path);
  return extension === 'md' || extension === 'markdown';
}

function isImagePath(path: string): boolean {
  return /^(png|jpe?g|gif|webp|svg|avif|bmp)$/.test(extensionOf(path));
}

function stateLabel(state: MdzipMergeEntryState): string {
  switch (state) {
    case 'conflict': return 'conflicts to resolve';
    case 'decision': return 'choose a version';
    case 'review': return 'the merge chose; review it';
    case 'merged': return 'merged';
    case 'unchanged': return 'unchanged';
  }
}

function mimeFromPath(path: string): string {
  switch (extensionOf(path)) {
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'svg': return 'image/svg+xml';
    case 'avif': return 'image/avif';
    case 'bmp': return 'image/bmp';
    default: return 'application/octet-stream';
  }
}

function iconHtml(icon: IconNode): string {
  return `<svg class="mdzip-diff-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon.map(([tag, attributes]) => {
    const attrs = Object.entries(attributes).map(([name, value]) => `${name}="${String(value)}"`).join(' ');
    return `<${tag} ${attrs}></${tag}>`;
  }).join('')}</svg>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function injectMergeStyles(doc: Document): void {
  if (doc.getElementById(MERGE_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = MERGE_STYLE_ID;
  style.textContent = `
.mdzip-merge-root{--mdzip-merge-ours:rgba(26,127,55,.13);--mdzip-merge-ours-strong:#1a7f37;--mdzip-merge-theirs:rgba(9,105,218,.13);--mdzip-merge-theirs-strong:#0969da;--mdzip-merge-base:rgba(110,119,129,.12);--mdzip-merge-attention:#bf8700}
.mdzip-merge-root.mdzip-diff-scheme-dark{--mdzip-merge-ours:rgba(63,185,80,.18);--mdzip-merge-ours-strong:#3fb950;--mdzip-merge-theirs:rgba(56,139,253,.2);--mdzip-merge-theirs-strong:#58a6ff;--mdzip-merge-base:rgba(139,148,158,.16);--mdzip-merge-attention:#d29922}
.mdzip-merge-workspace{flex:1;min-height:0;display:flex}
.mdzip-merge-nav[hidden]{display:none}
.mdzip-merge-content{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.mdzip-merge-entry{grid-template-columns:18px 1fr}
.mdzip-merge-marker{font-size:12px;text-align:center}
.mdzip-merge-state-conflict .mdzip-merge-marker,.mdzip-merge-marker.mdzip-merge-state-conflict,.mdzip-merge-state-decision .mdzip-merge-marker,.mdzip-merge-marker.mdzip-merge-state-decision{color:var(--mdzip-merge-attention)}
.mdzip-merge-state-review .mdzip-merge-marker,.mdzip-merge-marker.mdzip-merge-state-review{color:var(--mdzip-merge-theirs-strong)}
.mdzip-merge-state-merged .mdzip-merge-marker,.mdzip-merge-marker.mdzip-merge-state-merged,.mdzip-merge-state-unchanged{color:var(--mdzip-muted-foreground-color,#57606a)}
.mdzip-merge-state-unchanged{opacity:.65}
.mdzip-merge-gone .mdzip-diff-path{text-decoration:line-through}
.mdzip-merge-entry-count{display:inline-block;min-width:16px;padding:0 5px;border-radius:8px;font-size:11px;text-align:center;background:var(--mdzip-diff-active-background);color:var(--mdzip-merge-attention)}
.mdzip-merge-panel{flex:1;min-height:0;display:flex;flex-direction:column}
.mdzip-merge-header{padding:8px 14px;border-bottom:1px solid var(--mdzip-border-color,#d0d7de)}
.mdzip-merge-title{font-weight:600;overflow-wrap:anywhere}
.mdzip-merge-summary{margin-top:2px;font-size:12px;color:var(--mdzip-muted-foreground-color,#57606a)}
.mdzip-merge-review{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin-top:6px;font-size:13px}
.mdzip-merge-layout{flex:1;min-height:0;display:flex;flex-direction:column}
.mdzip-merge-top{flex:1 1 45%;min-height:80px;display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--mdzip-border-color,#d0d7de)}
.mdzip-merge-top>.mdzip-merge-pane+.mdzip-merge-pane{border-left:1px solid var(--mdzip-border-color,#d0d7de)}
.mdzip-merge-pane{min-width:0;min-height:0;display:flex;flex-direction:column}
.mdzip-merge-pane-result{flex:1 1 55%;min-height:100px}
.mdzip-merge-pane-base{flex:0 0 auto;border-top:1px solid var(--mdzip-border-color,#d0d7de)}
.mdzip-merge-pane-heading{display:flex;align-items:center;gap:8px;min-height:28px;padding:2px 10px;font-size:12px;background:var(--mdzip-diff-group-background);border-bottom:1px solid var(--mdzip-border-color,#d0d7de)}
.mdzip-merge-pane-title{font-weight:600}
.mdzip-merge-pane-ours .mdzip-merge-pane-title::before,.mdzip-merge-pane-theirs .mdzip-merge-pane-title::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.mdzip-merge-pane-ours .mdzip-merge-pane-title::before{background:var(--mdzip-merge-ours-strong)}
.mdzip-merge-pane-theirs .mdzip-merge-pane-title::before{background:var(--mdzip-merge-theirs-strong)}
.mdzip-merge-pane-names{display:flex;flex-direction:column;flex:1;min-width:0;line-height:1.3;padding:2px 0}
.mdzip-merge-pane-label{color:var(--mdzip-muted-foreground-color,#57606a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
.mdzip-merge-pane-heading .mdzip-merge-action{padding:1px 8px;font-size:12px}
.mdzip-merge-take-all{display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer}
.mdzip-merge-remaining{font-weight:600;color:var(--mdzip-merge-attention)}.mdzip-merge-remaining.done{font-weight:400;color:var(--mdzip-muted-foreground-color,#57606a)}
.mdzip-merge-complete{margin-left:auto;border:1px solid var(--mdzip-border-color,#d0d7de);border-radius:5px;padding:3px 12px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.mdzip-merge-complete[hidden]{display:none}
.mdzip-merge-complete.ready{background:var(--mdzip-accent-color,#0969da);border-color:var(--mdzip-accent-color,#0969da);color:#fff;font-weight:600}
.mdzip-merge-complete:hover:not(:disabled){filter:brightness(1.08)}.mdzip-merge-complete:disabled{opacity:.5;cursor:default}
.mdzip-merge-complete:focus-visible{outline:2px solid var(--mdzip-accent-color,#0969da);outline-offset:1px}
.mdzip-merge-root .mdzip-merge-check-gutter .cm-gutterElement{display:flex;align-items:flex-start;justify-content:center;padding:0 2px}
.mdzip-merge-check{margin:3px 0 0;cursor:pointer;accent-color:var(--mdzip-merge-attention)}
.mdzip-merge-aligned .cm-editor .cm-line{line-height:20px}
.mdzip-merge-aligned .cm-editor .cm-gutterElement{line-height:20px}
.mdzip-merge-spacer{position:relative;box-sizing:border-box;background:repeating-linear-gradient(135deg,transparent 0 6px,var(--mdzip-merge-base) 6px 7px)}
.mdzip-merge-spacer.links{background:none}
.mdzip-merge-spacer.removed::before{content:"";position:absolute;left:0;right:0;top:-1px;border-top:2px dashed var(--mdzip-muted-foreground-color,#8c959f)}
.mdzip-merge-root .cm-line.mdzip-merge-line-conflict:not(.mdzip-merge-line-taken){box-shadow:inset 2px 0 0 var(--mdzip-merge-attention)}
.mdzip-merge-root .cm-line.mdzip-merge-line-both{background:linear-gradient(90deg,var(--mdzip-merge-theirs),var(--mdzip-merge-ours))}
.mdzip-merge-root .cm-line.mdzip-merge-line-manual{background:var(--mdzip-merge-base)}
.mdzip-merge-pane-body{flex:1;min-height:0;overflow:auto}
.mdzip-merge-pane-body .cm-editor{height:100%;font-size:13px}.mdzip-merge-pane-body .cm-scroller{overflow:auto}
.mdzip-merge-root .mdzip-merge-pane-body .cm-editor .cm-content{caret-color:var(--mdzip-foreground-color,currentColor)}
.mdzip-merge-root .mdzip-merge-pane-body .cm-editor .cm-gutters{background:transparent;border-right:1px solid var(--mdzip-border-color,#d0d7de);color:var(--mdzip-muted-foreground-color,#57606a)}
.mdzip-merge-pane-body .mdzip-diff-preview-scope{--mdzip-preview-content-padding:10px 18px 20px}
.mdzip-merge-root .cm-line.mdzip-merge-line-ours{background:var(--mdzip-merge-ours)}
.mdzip-merge-root .cm-line.mdzip-merge-line-theirs{background:var(--mdzip-merge-theirs)}
.mdzip-merge-root .cm-line.mdzip-merge-line-base{background:var(--mdzip-merge-base)}
.mdzip-merge-root .cm-line.mdzip-merge-line-marker{color:var(--mdzip-muted-foreground-color,#57606a);background:var(--mdzip-merge-base)}
.mdzip-merge-root .cm-line.mdzip-merge-line-in-current,.mdzip-merge-root .cm-line.mdzip-merge-line-current,.mdzip-merge-root .cm-line.mdzip-merge-line-current.mdzip-merge-line-conflict{box-shadow:inset 3px 0 0 var(--mdzip-merge-attention)}
.mdzip-merge-inline-actions{display:flex;flex-wrap:nowrap;align-items:center;gap:0 10px;box-sizing:border-box;height:20px;overflow:hidden;white-space:nowrap;padding:0 6px;font:12px system-ui,sans-serif;color:var(--mdzip-muted-foreground-color,#57606a)}
.mdzip-merge-inline-actions.current .mdzip-merge-inline-label{color:var(--mdzip-merge-attention);font-weight:600}
.mdzip-merge-inline-link{border:0;padding:0;background:none;color:var(--mdzip-link-color,var(--mdzip-accent-color,#0969da));font:inherit;cursor:pointer}
.mdzip-merge-inline-link:hover{text-decoration:underline}
.mdzip-merge-inline-link:focus-visible{outline:2px solid var(--mdzip-accent-color,#0969da);outline-offset:1px}
.mdzip-merge-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:5px 10px;border-bottom:1px solid var(--mdzip-border-color,#d0d7de);font-size:12px}
.mdzip-merge-bar-text{margin-right:4px;color:var(--mdzip-muted-foreground-color,#57606a)}
.mdzip-merge-action{border:1px solid var(--mdzip-border-color,#d0d7de);border-radius:5px;padding:3px 10px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.mdzip-merge-action:hover:not(:disabled){background:var(--mdzip-diff-active-background)}
.mdzip-merge-action:focus-visible{outline:2px solid var(--mdzip-accent-color,#0969da);outline-offset:1px}
.mdzip-merge-action:disabled{opacity:.5;cursor:default}
.mdzip-merge-note{padding:8px 14px;font-size:12px;color:var(--mdzip-muted-foreground-color,#57606a)}
.mdzip-merge-image{display:block;max-width:calc(100% - 24px);height:auto;margin:12px auto}
.mdzip-merge-result-preview .mdzip-diff-preview .mdzip-diff-block-added{background:rgba(191,135,0,.16);box-shadow:0 0 0 6px rgba(191,135,0,.16)}
.mdzip-merge-result-preview .mdzip-diff-preview .mdzip-diff-block-added::before{background:var(--mdzip-merge-attention)}
.mdzip-merge-result-preview .mdzip-diff-preview .mdzip-diff-word-added{background:rgba(191,135,0,.38)}
.mdzip-merge-fields{flex:1;overflow:auto;padding-bottom:12px}
.mdzip-merge-field-table{border-collapse:collapse;margin:0 14px;font-size:13px}
.mdzip-merge-field-table th,.mdzip-merge-field-table td{padding:6px 10px;border-bottom:1px solid var(--mdzip-border-color,#d0d7de);text-align:left;vertical-align:top;overflow-wrap:anywhere}
.mdzip-merge-field-table th{font-size:12px;color:var(--mdzip-muted-foreground-color,#57606a);font-weight:600}
.mdzip-merge-field-chosen{font-weight:600}
@media (max-width:640px){.mdzip-merge-top{grid-template-columns:1fr}.mdzip-merge-top>.mdzip-merge-pane+.mdzip-merge-pane{border-left:0;border-top:1px solid var(--mdzip-border-color,#d0d7de)}}
`;
  doc.head.append(style);
}
