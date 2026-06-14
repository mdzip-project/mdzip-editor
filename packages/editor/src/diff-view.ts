import { markdown } from '@codemirror/lang-markdown';
import { MergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { MdzArchiveCore } from '@mdzip/core-js';
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

export interface MdzipDiffViewOptions {
  before: MdzipDiffSideInput;
  after: MdzipDiffSideInput;
  initialPath?: string;
  showUnchanged?: boolean;
  navigationVisible?: boolean;
  onSelectionChanged?: (event: MdzipDiffSelectionEvent) => void;
  onFailed?: (error: Error) => void;
}

interface DiffSide {
  input: MdzipDiffSideInput;
  archive: MdzArchiveCore | null;
  inventory: ArchiveInventory;
  state: 'ready' | 'missing' | 'empty' | 'invalid';
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
  private mergeView: MergeView | null = null;
  private objectUrls: string[] = [];

  private readonly root: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly list: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly body: HTMLElement;

  public constructor(container: HTMLElement, options: MdzipDiffViewOptions) {
    this.options = options;
    this.showUnchanged = options.showUnchanged ?? true;
    this.navigationVisible = options.navigationVisible ?? true;
    injectDiffViewStyles(container.ownerDocument);
    container.replaceChildren();
    this.root = container.ownerDocument.createElement('div');
    this.root.className = 'mdzip-diff-root';
    this.root.innerHTML = `
      <aside class="mdzip-diff-nav">
        <div class="mdzip-diff-summary"></div>
        <div class="mdzip-diff-list" role="tree" aria-label="Archive comparison files"></div>
      </aside>
      <main class="mdzip-diff-content">
        <div class="mdzip-diff-heading"></div>
        <div class="mdzip-diff-body"><div class="mdzip-diff-message">Loading comparison...</div></div>
      </main>`;
    container.appendChild(this.root);
    this.nav = this.root.querySelector('.mdzip-diff-nav') as HTMLElement;
    this.summary = this.root.querySelector('.mdzip-diff-summary') as HTMLElement;
    this.list = this.root.querySelector('.mdzip-diff-list') as HTMLElement;
    this.heading = this.root.querySelector('.mdzip-diff-heading') as HTMLElement;
    this.body = this.root.querySelector('.mdzip-diff-body') as HTMLElement;
    void this.open(options);
  }

  public async open(options: MdzipDiffViewOptions): Promise<void> {
    const generation = ++this.generation;
    this.options = options;
    this.showUnchanged = options.showUnchanged ?? this.showUnchanged;
    this.navigationVisible = options.navigationVisible ?? this.navigationVisible;
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

  public setNavigationVisible(visible: boolean): void {
    this.navigationVisible = visible;
    this.nav.hidden = !visible;
    this.root.style.gridTemplateColumns = visible ? '' : '1fr';
  }

  public destroy(): void {
    this.generation += 1;
    this.selectionGeneration += 1;
    this.disposeSelection();
    this.root.remove();
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
      return { input, archive: null, inventory: EMPTY_INVENTORY, state: 'invalid', error };
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
    const filter = this.root.ownerDocument.createElement('label');
    filter.className = 'mdzip-diff-filter';
    const checkbox = this.root.ownerDocument.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = this.showUnchanged;
    checkbox.addEventListener('change', () => this.setShowUnchanged(checkbox.checked));
    filter.append(checkbox, 'Show unchanged');
    this.summary.append(labels, counts, filter);

    this.list.replaceChildren();
    for (const entry of diff.entries) {
      if (!this.showUnchanged && entry.status === 'unchanged') continue;
      const button = this.root.ownerDocument.createElement('button');
      button.type = 'button';
      button.className = `mdzip-diff-entry ${entry.status}${entry.path === this.selectedPath ? ' active' : ''}`;
      button.setAttribute('role', 'treeitem');
      button.setAttribute('aria-label', `${entry.path}, ${entry.status}`);
      const status = this.root.ownerDocument.createElement('span');
      status.className = 'mdzip-diff-status';
      status.textContent = statusSymbol(entry.status);
      const path = this.root.ownerDocument.createElement('span');
      path.className = 'mdzip-diff-path';
      path.textContent = entry.path;
      button.append(status, path);
      button.addEventListener('click', () => { void this.openPath(entry.path); });
      this.list.append(button);
    }
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
    this.mergeView = new MergeView({
      a: { doc: before ?? '', extensions },
      b: { doc: after ?? '', extensions },
      parent: this.body,
      root: this.root.ownerDocument,
      highlightChanges: true,
      gutter: true,
      diffConfig: { scanLimit: 2000, timeout: 100 }
    });
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
    meta.textContent = `${mime}\n${bytes.length} bytes\nSHA-256 ${hash ?? 'unknown'}`;
    side.append(image, meta);
    return side;
  }

  private renderBinary(
    before: Uint8Array | null,
    after: Uint8Array | null,
    entry: ArchiveInventoryDiffEntry
  ): void {
    this.body.replaceChildren(this.createPair(
      this.binarySide(before, entry.before?.hash),
      this.binarySide(after, entry.after?.hash)
    ));
  }

  private binarySide(bytes: Uint8Array | null, hash?: string): HTMLElement {
    const side = this.root.ownerDocument.createElement('div');
    side.className = 'mdzip-diff-side mdzip-diff-meta';
    side.textContent = bytes
      ? `Binary file\n${bytes.length} bytes\nSHA-256 ${hash ?? 'unknown'}`
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
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }
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

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
