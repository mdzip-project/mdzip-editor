import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { browserClipboardHasImage, readBrowserClipboardImage } from './browser.js';
import type { MdzipWorkspaceOpenOptions } from './workspace.js';
import { MdzipWorkspaceService } from './workspace.js';
import {
  buildMdzipNavTree,
  canEditMdzipPath,
  escapeHtml,
  isOrphanedMdzipAsset,
  mdzipEntryIconKind,
  isMdzipManifestPath,
  mdzipEntryIconLabel,
  renderMdzipPreviewHtml,
  type MdzipNavNode
} from './workspace-view.js';
import { WORKSPACE_CSS } from './view-css.js';
import type { MdzipWorkspaceSnapshot } from './workspace.js';

const STYLE_ATTR = 'data-mdzip-ws-styles';

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff?)$/i;
const isImageFile = (path: string) => IMAGE_EXTENSIONS.test(path);

const MANIFEST_ICON_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"
  style="display:block">
  <rect fill="#ffffff" stroke="#000000" stroke-width="1" x="4" y="2" width="12" height="16" rx="1"/>
  <circle fill="#000000" cx="6.5" cy="7" r="0.5"/>
  <line stroke="#000000" stroke-width="0.8" x1="7.5" y1="7" x2="14" y2="7"/>
  <circle fill="#000000" cx="6.5" cy="10" r="0.5"/>
  <line stroke="#000000" stroke-width="0.8" x1="7.5" y1="10" x2="14" y2="10"/>
  <circle fill="#000000" cx="6.5" cy="13" r="0.5"/>
  <line stroke="#000000" stroke-width="0.8" x1="7.5" y1="13" x2="14" y2="13"/>
</svg>`;

const MARKDOWN_ICON_SVG = `<svg viewBox="0 0 208 128" xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true" focusable="false" style="display:block">
  <path fill="#ffffff" stroke="#000000" stroke-width="10" d="m15 5h178c5.523 0 10 4.477 10 10v98c0 5.523-4.477 10-10 10h-178c-5.52285 0-10-4.477-10-10v-98c0-5.523 4.47715-10 10-10z"/>
  <path fill="#000000" d="m30 98v-68h20l20 25 20-25h20v68h-20v-39l-20 25-20-25v39zm125 0-30-33h20v-35h20v35h20z"/>
</svg>`;

const FOLDER_CLOSED_ICON_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
  <path d="M2.5 5.75c0-.69.56-1.25 1.25-1.25h4.1c.36 0 .7.16.94.43l.86.97h6.6c.69 0 1.25.56 1.25 1.25v6.6c0 .69-.56 1.25-1.25 1.25H3.75c-.69 0-1.25-.56-1.25-1.25v-8Z" fill="var(--mdzip-toolbar-icon-fill-color)" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

const FOLDER_OPEN_ICON_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
  <path d="M2.5 6.25c0-.69.56-1.25 1.25-1.25h4.08c.37 0 .72.16.96.44l.8.91h6.66c.69 0 1.25.56 1.25 1.25v1.15H5.33c-.56 0-1.06.36-1.24.89L2.5 14.3V6.25Z" fill="var(--mdzip-toolbar-icon-fill-color)"/>
  <path d="M2.5 14.3V6.25c0-.69.56-1.25 1.25-1.25h4.08c.37 0 .72.16.96.44l.8.91h6.66c.69 0 1.25.56 1.25 1.25v1.15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M4.8 9.75h13l-1.35 4.3c-.16.52-.65.9-1.2.9H2.55l1.45-4.3c.17-.54.67-.9 1.23-.9Z" fill="var(--mdzip-toolbar-icon-fill-color)" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

const IMAGE_ICON_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"
  style="display:block" fill="#ffffff" stroke="#000000" stroke-width="0.8">
  <path d="M6 3a3 3 0 0 0-3 3v8c0 .65.2 1.25.56 1.74l5.39-5.3a1.5 1.5 0 0 1 2.1 0l5.4 5.3c.34-.49.55-1.1.55-1.74V6a3 3 0 0 0-3-3H6Zm0 14c-.65 0-1.24-.2-1.73-.55l5.38-5.3c.2-.2.5-.2.7 0l5.38 5.3c-.49.35-1.08.55-1.73.55H6Zm6.5-8.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z"/>
</svg>`;

type Layout = 'preview' | 'source' | 'split';

export interface MdzipWorkspaceViewOptions {
  onChanged?: (bytes: Uint8Array, snapshot: MdzipWorkspaceSnapshot) => void;
  onSaved?: (bytes: Uint8Array, snapshot: MdzipWorkspaceSnapshot) => void;
  onFailed?: (error: unknown) => void;
}

const mdzipEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'calc(20px * var(--mdz-zoom, 1))',
    fontFamily: '"Cascadia Code", Consolas, monospace',
    background: 'var(--mdzip-editor-background-color)',
  },
  '.cm-scroller': {
    lineHeight: '1.7',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '36px 48px',
    caretColor: 'var(--mdzip-editor-cursor-color)',
    overflowWrap: 'anywhere',
    wordBreak: 'normal',
  },
  '.cm-gutters': {
    background: 'var(--mdzip-widget-background-color)',
    borderRight: '1px solid var(--mdzip-border-color)',
    color: 'var(--mdzip-line-number-foreground-color)',
    fontFamily: '"Cascadia Code", Consolas, monospace',
    minWidth: '52px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 4px',
    minWidth: '44px',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--mdzip-editor-cursor-color)',
  },
  '&.cm-focused .cm-selectionBackground': {
    background: 'var(--mdzip-hover-background-color)',
  },
  '.cm-selectionBackground': {
    background: 'var(--mdzip-selection-background-color)',
  },
  '.cm-activeLine': {
    background: 'transparent',
  },
  '.cm-activeLineGutter': {
    background: 'transparent',
  },
});

const mdzipMarkdownHighlight = HighlightStyle.define([
  { tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    color: '#c36f00', fontWeight: 'bold' },
  { tag: tags.processingInstruction, color: '#7a5c00', fontWeight: 'bold' },
  { tag: tags.strong, color: '#008b8b', fontWeight: 'bold' },
  { tag: tags.emphasis, color: '#008b8b', fontStyle: 'italic' },
  { tag: tags.strikethrough, color: '#57606a', textDecoration: 'line-through' },
  { tag: tags.link, color: '#0969da' },
  { tag: tags.url, color: '#0969da' },
  { tag: tags.monospace, color: '#8a8f00' },
  { tag: tags.quote, color: '#7a5c00' },
  { tag: tags.contentSeparator, color: '#6a9955' },
  { tag: tags.atom, color: '#d100d1' },
]);

function injectStyles(doc: Document): void {
  const existing = doc.querySelector<HTMLStyleElement>(`style[${STYLE_ATTR}]`);
  if (existing) {
    existing.textContent = WORKSPACE_CSS;
    return;
  }
  const style = doc.createElement('style');
  style.setAttribute(STYLE_ATTR, '');
  style.textContent = WORKSPACE_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}

function renderNavNode(node: MdzipNavNode, state: MdzipWorkspaceSnapshot): string {
  if (node.entry) {
    const isCurrent = node.entry.path === state.currentPath;
    const isOrphaned = isOrphanedMdzipAsset(node.entry, state);
    const iconKind = mdzipEntryIconKind(node.entry);
    const label = mdzipEntryIconLabel(node.entry);
    const safePath = escapeHtml(node.entry.path);
    const safeName = escapeHtml(node.name);
    const title = isOrphaned
      ? `${safePath} - not referenced by the entry markdown`
      : safePath;
    const classes = ['nav-file', isCurrent ? 'current-entry' : '', isOrphaned ? 'orphaned-asset' : '']
      .filter(Boolean).join(' ');
    const iconHtml = node.entry.isMarkdown
      ? MARKDOWN_ICON_SVG
      : isMdzipManifestPath(node.entry.path)
      ? MANIFEST_ICON_SVG
      : isImageFile(node.entry.path)
      ? IMAGE_ICON_SVG
      : escapeHtml(label);
    const orphanBtnHtml = isOrphaned ? `
      <span class="nav-orphan-button" role="button" tabindex="0"
        title="Orphaned asset" aria-label="Orphaned asset actions"
        data-orphan-path="${safePath}">
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M5.2 4.1 3.9 5.4a2.5 2.5 0 0 0 3.5 3.5l.8-.8-.9-.9-.8.8a1.2 1.2 0 0 1-1.7-1.7l1.3-1.3a1.2 1.2 0 0 1 1.7 0l.4.4.9-.9-.4-.4a2.5 2.5 0 0 0-3.5 0z"/>
          <path d="m8.2 10.6.4.4a2.5 2.5 0 0 0 3.5 0l1.3-1.3a2.5 2.5 0 0 0-3.5-3.5l-.8.8.9.9.8-.8a1.2 1.2 0 1 1 1.7 1.7l-1.3 1.3a1.2 1.2 0 0 1-1.7 0l-.4-.4-.9.9z"/>
          <path d="m5 12.8 7.8-7.8-.8-.8-7.8 7.8.8.8z"/>
        </svg>
      </span>` : '';
    return `<button type="button" class="${classes}" title="${title}"
      data-nav-path="${safePath}" data-orphan="${isOrphaned ? 'true' : ''}">
      <span class="nav-caret"></span>
      <span class="nav-file-icon ${iconKind}">${iconHtml}</span>
      ${orphanBtnHtml}
      <span class="nav-label">${safeName}</span>
    </button>`;
  }
  const children = node.children.map(c => renderNavNode(c, state)).join('');
  return `<details class="nav-directory" open>
    <summary>
      <span class="nav-caret" aria-hidden="true"></span>
      <span class="nav-folder-icon closed">${FOLDER_CLOSED_ICON_SVG}</span>
      <span class="nav-folder-icon open">${FOLDER_OPEN_ICON_SVG}</span>
      <span class="nav-label">${escapeHtml(node.name)}</span>
    </summary>
    <div class="nav-directory-children">${children}</div>
  </details>`;
}

export class MdzipWorkspaceView {
  private workspace: MdzipWorkspaceService | null = null;
  private unsub: (() => void) | null = null;
  private readonly options: MdzipWorkspaceViewOptions;
  private pendingOrphanPath: string | null = null;

  private layout: Layout = 'split';
  private navVisible = true;
  private zoom = 1;
  private zoomOpen = false;
  private titleDialogOpen = false;
  private titleDraft = '';
  private navPaneWidth = 280;
  private splitRatio = 0.5;
  private resizing = false;
  private orphanMenuState: { path: string; x: number; y: number } | null = null;

  private cmEditor: EditorView | null = null;
  private readonly readOnlyCompartment = new Compartment();
  private updatingCm = false;
  private syncing = false;

  private readonly elRoot: HTMLElement;
  private readonly elToolbar: HTMLElement;
  private readonly elNavBtn: HTMLButtonElement;
  private readonly elTitleBtn: HTMLButtonElement;
  private readonly elPreviewBtn: HTMLButtonElement;
  private readonly elSplitBtn: HTMLButtonElement;
  private readonly elSourceBtn: HTMLButtonElement;
  private readonly elSaveBtn: HTMLButtonElement;
  private readonly elZoomBtn: HTMLButtonElement;
  private readonly elZoomPopover: HTMLElement;
  private readonly elZoomLevel: HTMLElement;
  private readonly elWorkspaceShell: HTMLElement;
  private readonly elNavPane: HTMLElement;
  private readonly elNavResizer: HTMLElement;
  private readonly elNavTree: HTMLElement;
  private readonly elPaneStack: HTMLElement;
  private readonly elEditPane: HTMLElement;
  private readonly elSplitResizer: HTMLElement;
  private readonly elPreviewPane: HTMLElement;
  private readonly elPreviewContent: HTMLElement;
  private readonly elTitleDialog: HTMLElement;
  private readonly elTitleInput: HTMLInputElement;
  private readonly elTitleValidation: HTMLElement;
  private readonly elTitleSaveBtn: HTMLButtonElement;
  private readonly elTitleResetBtn: HTMLButtonElement;
  private readonly elOrphanMenu: HTMLElement;
  private readonly elEmptyState: HTMLElement;

  public constructor(container: HTMLElement, options: MdzipWorkspaceViewOptions = {}) {
    this.options = options;
    injectStyles(container.ownerDocument);
    container.innerHTML = SHELL_HTML;

    const q = <T extends HTMLElement>(sel: string): T =>
      container.querySelector<T>(sel) as T;

    this.elRoot = q('.mdzip-root');
    this.elToolbar = q('[data-ref="toolbar"]');
    this.elNavBtn = q('[data-ref="nav-btn"]');
    this.elTitleBtn = q('[data-ref="title-btn"]');
    this.elPreviewBtn = q('[data-ref="preview-btn"]');
    this.elSplitBtn = q('[data-ref="split-btn"]');
    this.elSourceBtn = q('[data-ref="source-btn"]');
    this.elSaveBtn = q('[data-ref="save-btn"]');
    this.elZoomBtn = q('[data-ref="zoom-btn"]');
    this.elZoomPopover = q('[data-ref="zoom-popover"]');
    this.elZoomLevel = q('[data-ref="zoom-level"]');
    this.elWorkspaceShell = q('[data-ref="workspace-shell"]');
    this.elNavPane = q('[data-ref="nav-pane"]');
    this.elNavResizer = q('[data-ref="nav-resizer"]');
    this.elNavTree = q('[data-ref="nav-tree"]');
    this.elPaneStack = q('[data-ref="pane-stack"]');
    this.elEditPane = q('[data-ref="edit-pane"]');
    this.elSplitResizer = q('[data-ref="split-resizer"]');
    this.elPreviewPane = q('[data-ref="preview-pane"]');
    this.elPreviewContent = q('[data-ref="preview-content"]');
    this.elTitleDialog = q('[data-ref="title-dialog"]');
    this.elTitleInput = q('[data-ref="title-input"]');
    this.elTitleValidation = q('[data-ref="title-validation"]');
    this.elTitleSaveBtn = q('[data-ref="title-save-btn"]');
    this.elTitleResetBtn = q('[data-ref="title-reset-btn"]');
    this.elOrphanMenu = q('[data-ref="orphan-menu"]');
    this.elEmptyState = q('[data-ref="empty-state"]');

    this.attachEvents();
    this.render();
  }

  public async open(bytes: Uint8Array, options: MdzipWorkspaceOpenOptions = {}): Promise<void> {
    this.unsub?.();
    this.cmEditor?.destroy();
    this.cmEditor = null;
    this.workspace = null;

    try {
      const ws = await MdzipWorkspaceService.open(bytes, options);
      this.workspace = ws;
      this.layout = 'split';
      const snap = ws.snapshot();
      this.cmEditor = this.createCmEditor(this.elEditPane, snap.currentText, snap.mode);
      this.unsub = ws.subscribe(() => {
        this.render();
        void this.notifyChanged();
      });
      this.render();
      void this.notifyChanged();
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  public destroy(): void {
    this.unsub?.();
    this.cmEditor?.destroy();
    this.elRoot.remove();
  }

  private createCmEditor(
    parent: HTMLElement,
    initialText: string,
    mode: 'read-only' | 'editable'
  ): EditorView {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    const state = EditorState.create({
      doc: initialText,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown(),
        syntaxHighlighting(mdzipMarkdownHighlight),
        EditorView.lineWrapping,
        mdzipEditorTheme,
        this.readOnlyCompartment.of(EditorState.readOnly.of(mode === 'read-only')),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !self.updatingCm) {
            try {
              self.workspace?.editText(update.state.doc.toString());
            } catch {
              // read-only rejection; workspace state unchanged
            }
          }
        }),
        EditorView.domEventHandlers({
          paste(event) {
            const clipEvent = event as ClipboardEvent;
            if (browserClipboardHasImage(clipEvent.clipboardData)) {
              event.preventDefault();
              void self.handlePaste(clipEvent);
              return true;
            }
          }
        }),
      ],
    });

    const editor = new EditorView({ state, parent });

    // Attach scroll listener to sync with preview
    const scroller = editor.dom.querySelector('.cm-scroller');
    if (scroller) {
      scroller.addEventListener('scroll', () => self.syncScrollToPreview());
    }

    return editor;
  }

  private render(): void {
    const snapshot = this.workspace?.snapshot() ?? null;

    this.elEmptyState.hidden = snapshot !== null;
    this.elToolbar.hidden = snapshot === null;
    this.elWorkspaceShell.hidden = snapshot === null;

    if (!snapshot) {
      return;
    }

    this.elRoot.style.setProperty('--mdz-zoom', String(this.zoom));
    this.elRoot.style.setProperty('--nav-pane-width', `${this.navPaneWidth}px`);
    this.elRoot.style.setProperty('--split-edit-ratio', String(this.splitRatio));
    this.elRoot.classList.toggle('resizing', this.resizing);

    this.elTitleBtn.textContent = snapshot.displayTitle;
    this.elTitleBtn.disabled = snapshot.mode === 'read-only';

    const canEdit = canEditMdzipPath(snapshot.currentPathType, snapshot.currentPath, snapshot.mode);
    this.elSaveBtn.disabled = snapshot.mode === 'read-only' || !snapshot.dirty;
    this.elSplitBtn.disabled = !canEdit;
    this.elSourceBtn.disabled = !canEdit;

    this.elPreviewBtn.classList.toggle('active', this.layout === 'preview');
    this.elSplitBtn.classList.toggle('active', this.layout === 'split');
    this.elSourceBtn.classList.toggle('active', this.layout === 'source');
    this.elPreviewBtn.setAttribute('aria-pressed', String(this.layout === 'preview'));
    this.elSplitBtn.setAttribute('aria-pressed', String(this.layout === 'split'));
    this.elSourceBtn.setAttribute('aria-pressed', String(this.layout === 'source'));
    this.elNavBtn.classList.toggle('active', this.navVisible);
    this.elZoomBtn.classList.toggle('active', this.zoomOpen);

    this.elZoomPopover.hidden = !this.zoomOpen;
    this.elZoomLevel.textContent = `${Math.round(this.zoom * 100)}%`;

    this.elNavPane.classList.toggle('hidden', !this.navVisible);
    this.elNavResizer.classList.toggle('hidden', !this.navVisible);

    const navTree = buildMdzipNavTree(snapshot.content.paths);
    this.elNavTree.innerHTML = navTree.map(n => renderNavNode(n, snapshot)).join('');

    if (this.cmEditor) {
      this.updatingCm = true;
      const current = this.cmEditor.state.doc.toString();
      if (current !== snapshot.currentText) {
        this.cmEditor.dispatch({
          changes: { from: 0, to: current.length, insert: snapshot.currentText }
        });
      }
      this.updatingCm = false;

      this.cmEditor.dispatch({
        effects: this.readOnlyCompartment.reconfigure(
          EditorState.readOnly.of(snapshot.mode === 'read-only')
        )
      });
    }

    this.elPreviewContent.innerHTML = renderMdzipPreviewHtml(snapshot);

    const pt = snapshot.currentPathType;
    const showEdit = (pt === 'markdown' || pt === 'text') && this.layout !== 'preview';
    const showPreview = pt === 'image' || pt === 'binary' || pt === 'text'
      || (pt === 'markdown' && this.layout !== 'source');
    this.elEditPane.classList.toggle('active', showEdit);
    this.elPreviewPane.classList.toggle('active', showPreview);
    this.elPaneStack.classList.toggle('split-mode', this.layout === 'split');

    this.elTitleDialog.hidden = !this.titleDialogOpen;
    if (this.titleDialogOpen) {
      this.elTitleInput.value = this.titleDraft;
      const valid = this.titleDraft.trim().length > 0;
      this.elTitleValidation.hidden = valid;
      this.elTitleSaveBtn.disabled = !valid;
    }

    if (this.orphanMenuState) {
      this.elOrphanMenu.hidden = false;
      this.elOrphanMenu.style.left = `${this.orphanMenuState.x}px`;
      this.elOrphanMenu.style.top = `${this.orphanMenuState.y}px`;
    } else {
      this.elOrphanMenu.hidden = true;
    }
  }

  private attachEvents(): void {
    const doc = this.elRoot.ownerDocument;

    doc.addEventListener('click', () => {
      if (this.zoomOpen || this.orphanMenuState) {
        this.zoomOpen = false;
        this.orphanMenuState = null;
        this.pendingOrphanPath = null;
        this.render();
      }
    });

    this.elNavBtn.addEventListener('click', () => {
      this.navVisible = !this.navVisible;
      this.render();
    });

    this.elTitleBtn.addEventListener('click', () => {
      const snapshot = this.workspace?.snapshot();
      if (!snapshot || snapshot.mode === 'read-only') {
        return;
      }
      this.titleDraft = snapshot.displayTitle;
      this.titleDialogOpen = true;
      this.render();
      requestAnimationFrame(() => this.elTitleInput.select());
    });

    this.elPreviewBtn.addEventListener('click', () => { this.layout = 'preview'; this.render(); });
    this.elSplitBtn.addEventListener('click', () => { this.layout = 'split'; this.render(); });
    this.elSourceBtn.addEventListener('click', () => { this.layout = 'source'; this.render(); });

    this.elSaveBtn.addEventListener('click', () => { void this.save(); });

    this.elZoomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.zoomOpen = !this.zoomOpen;
      this.render();
    });

    this.elZoomPopover.addEventListener('click', (e) => e.stopPropagation());
    this.elZoomPopover.querySelector('[data-action="zoom-out"]')!
      .addEventListener('click', () => this.setZoom(this.zoom - 0.1));
    this.elZoomPopover.querySelector('[data-action="zoom-in"]')!
      .addEventListener('click', () => this.setZoom(this.zoom + 0.1));
    this.elZoomPopover.querySelector('[data-action="zoom-reset"]')!
      .addEventListener('click', () => this.setZoom(1));

    this.elNavTree.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const orphanBtn = target.closest<HTMLElement>('[data-orphan-path]');
      if (orphanBtn) {
        e.preventDefault();
        e.stopPropagation();
        this.showOrphanMenu(orphanBtn.getAttribute('data-orphan-path')!, e);
        return;
      }
      const navFile = target.closest<HTMLElement>('[data-nav-path]');
      if (navFile) {
        void this.openPath(navFile.getAttribute('data-nav-path')!);
      }
    });

    this.elNavTree.addEventListener('contextmenu', (e) => {
      const navFile = (e.target as HTMLElement).closest<HTMLElement>('[data-nav-path]');
      if (navFile?.getAttribute('data-orphan') === 'true') {
        e.preventDefault();
        this.showOrphanMenu(navFile.getAttribute('data-nav-path')!, e);
      }
    });

    this.elNavTree.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const orphanBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-orphan-path]');
        if (orphanBtn) {
          this.showOrphanMenu(orphanBtn.getAttribute('data-orphan-path')!, e);
        }
      }
    });

    this.elNavResizer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      this.resizing = true;
      this.elRoot.classList.add('resizing');

      const onMove = (me: PointerEvent): void => {
        const bounds = this.elWorkspaceShell.getBoundingClientRect();
        const max = Math.max(300, Math.floor(bounds.width * 0.6));
        this.navPaneWidth = Math.max(180, Math.min(max, Math.round(me.clientX - bounds.left)));
        this.elRoot.style.setProperty('--nav-pane-width', `${this.navPaneWidth}px`);
      };

      const onUp = (): void => {
        this.resizing = false;
        this.elRoot.classList.remove('resizing');
        window.removeEventListener('pointermove', onMove);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    });

    this.elSplitResizer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.layout !== 'split') {
        return;
      }
      e.preventDefault();
      this.resizing = true;
      this.elRoot.classList.add('resizing');

      const onMove = (me: PointerEvent): void => {
        const bounds = this.elPaneStack.getBoundingClientRect();
        const ratio = (me.clientX - bounds.left) / Math.max(1, bounds.width);
        this.splitRatio = Math.max(0.2, Math.min(0.8, Math.round(ratio * 10000) / 10000));
        this.elRoot.style.setProperty('--split-edit-ratio', String(this.splitRatio));
      };

      const onUp = (): void => {
        this.resizing = false;
        this.elRoot.classList.remove('resizing');
        window.removeEventListener('pointermove', onMove);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    });

    this.elTitleInput.addEventListener('input', () => {
      this.titleDraft = this.elTitleInput.value;
      const valid = this.titleDraft.trim().length > 0;
      this.elTitleValidation.hidden = valid;
      this.elTitleSaveBtn.disabled = !valid;
    });

    this.elTitleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { void this.saveTitle(); }
      if (e.key === 'Escape') { this.titleDialogOpen = false; this.render(); }
    });

    this.elTitleResetBtn.addEventListener('click', () => {
      const snapshot = this.workspace?.snapshot();
      if (snapshot) {
        this.titleDraft = snapshot.suggestedTitle;
        this.elTitleInput.value = this.titleDraft;
        const valid = this.titleDraft.trim().length > 0;
        this.elTitleValidation.hidden = valid;
        this.elTitleSaveBtn.disabled = !valid;
      }
    });

    this.elTitleDialog.querySelector<HTMLButtonElement>('[data-action="cancel-title"]')!
      .addEventListener('click', () => { this.titleDialogOpen = false; this.render(); });

    this.elTitleSaveBtn.addEventListener('click', () => { void this.saveTitle(); });

    this.elOrphanMenu.addEventListener('click', (e) => e.stopPropagation());
    this.elOrphanMenu.querySelector('[data-action="remove-orphan"]')!
      .addEventListener('click', () => { void this.removeOrphan(); });

    this.elPreviewPane.addEventListener('scroll', () => this.syncScrollFromPreview());
  }

  private async openPath(path: string): Promise<void> {
    if (!this.workspace) {
      return;
    }
    try {
      const opened = await this.workspace.openPath(path);
      if (opened) {
        if (!canEditMdzipPath(this.workspace.currentPathType, this.workspace.currentPath, this.workspace.mode)) {
          this.layout = 'preview';
        }
        this.render();
      }
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private async save(): Promise<void> {
    try {
      const workspace = this.workspace;
      if (!workspace) {
        return;
      }
      const bytes = await workspace.saveToBytes();
      if (bytes) {
        this.render();
        this.options.onSaved?.(bytes, workspace.snapshot());
      }
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private async saveTitle(): Promise<void> {
    const title = this.titleDraft.trim();
    if (!title) {
      return;
    }
    try {
      await this.workspace?.setManifestTitle(title);
      this.titleDialogOpen = false;
      this.render();
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private async handlePaste(event: ClipboardEvent): Promise<void> {
    const snapshot = this.workspace?.snapshot();
    if (!snapshot || snapshot.mode === 'read-only' || snapshot.currentPathType !== 'markdown') {
      return;
    }
    try {
      const image = await readBrowserClipboardImage(event.clipboardData);
      if (!image || !this.cmEditor) {
        return;
      }
      const sel = this.cmEditor.state.selection.main;
      const result = await this.workspace?.pasteImage({
        bytes: image.bytes,
        mimeType: image.mimeType,
        selectionStart: sel.from,
        selectionEnd: sel.to
      });
      if (result && this.cmEditor) {
        this.render();
        this.cmEditor.dispatch({ selection: { anchor: result.cursor } });
        this.cmEditor.focus();
      }
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private async notifyChanged(): Promise<void> {
    if (!this.workspace || !this.options.onChanged) {
      return;
    }
    try {
      this.options.onChanged(await this.workspace.exportBytes(), this.workspace.snapshot());
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private setZoom(value: number): void {
    this.zoom = Math.max(0.5, Math.min(2.5, Math.round(value * 100) / 100));
    this.render();
  }

  private showOrphanMenu(path: string, event: Event): void {
    const bounds = (event.target as HTMLElement | null)?.getBoundingClientRect();
    const clientX = event instanceof MouseEvent ? event.clientX : (bounds?.left ?? 0);
    const clientY = event instanceof MouseEvent ? event.clientY : (bounds?.bottom ?? 0);
    this.pendingOrphanPath = path;
    this.orphanMenuState = {
      path,
      x: Math.max(4, Math.min(clientX, window.innerWidth - 210)),
      y: Math.max(4, Math.min(clientY, window.innerHeight - 44))
    };
    this.render();
  }

  private async removeOrphan(): Promise<void> {
    const path = this.pendingOrphanPath;
    this.orphanMenuState = null;
    this.pendingOrphanPath = null;
    this.render();
    if (!path) {
      return;
    }
    try {
      await this.workspace?.removeAsset(path);
      this.render();
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private syncScrollFromPreview(): void {
    if (this.syncing || !this.cmEditor || this.layout !== 'split') {
      return;
    }
    this.syncing = true;
    const previewHeight = this.elPreviewPane.scrollHeight - this.elPreviewPane.clientHeight;
    const scrollRatio = previewHeight > 0 ? this.elPreviewPane.scrollTop / previewHeight : 0;
    const cmScroller = this.cmEditor.dom.querySelector('.cm-scroller');
    if (cmScroller) {
      const editorHeight = cmScroller.scrollHeight - cmScroller.clientHeight;
      cmScroller.scrollTop = scrollRatio * editorHeight;
    }
    this.syncing = false;
  }

  private syncScrollToPreview(): void {
    if (this.syncing || !this.cmEditor || this.layout !== 'split') {
      return;
    }
    this.syncing = true;
    const cmScroller = this.cmEditor.dom.querySelector('.cm-scroller');
    if (cmScroller) {
      const editorHeight = cmScroller.scrollHeight - cmScroller.clientHeight;
      const scrollRatio = editorHeight > 0 ? cmScroller.scrollTop / editorHeight : 0;
      const previewHeight = this.elPreviewPane.scrollHeight - this.elPreviewPane.clientHeight;
      this.elPreviewPane.scrollTop = scrollRatio * previewHeight;
    }
    this.syncing = false;
  }
}

const SHELL_HTML = `
<section class="mdzip-root">
  <header class="toolbar" data-ref="toolbar" hidden>
    <div class="toolbar-left">
      <button type="button" class="icon-toggle nav-toggle" data-ref="nav-btn" title="Toggle contents" aria-label="Toggle contents">
        <svg class="toggle-icon nav-toggle-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M9 8.5v17.5M9 17.5h4M9 26h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="round"/>
          <path d="M5 4.5h5.4l1.3 1.7H18v5.3H5z" fill="var(--mdzip-toolbar-icon-fill-color)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          <path d="M13.5 15h5v5h-5zM13.5 23.5h5v5h-5z" fill="var(--mdzip-toolbar-icon-fill-color)" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M21.5 17.5h6M21.5 26h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/>
        </svg>
      </button>
      <button type="button" class="title-button" data-ref="title-btn"></button>
    </div>

    <div class="toolbar-buttons view-mode-toggle-group" role="group" aria-label="Editor layout">
      <button type="button" class="icon-toggle view-mode-toggle" data-ref="preview-btn" title="Preview only" aria-label="Preview only" aria-pressed="false">
        <span class="commandbar-flex-container">
          <svg class="toggle-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M3.26 11.6A6.97 6.97 0 0 1 10 6c3.2 0 6.06 2.33 6.74 5.6a.5.5 0 0 0 .98-.2A7.97 7.97 0 0 0 10 5a7.97 7.97 0 0 0-7.72 6.4.5.5 0 0 0 .98.2ZM10 8a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm-2.5 3.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0Z"/>
          </svg>
        </span>
      </button>
      <button type="button" class="icon-toggle view-mode-toggle" data-ref="split-btn" title="Split" aria-label="Split" aria-pressed="false">
        <span class="commandbar-flex-container">
          <svg class="toggle-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M10 2.5a.5.5 0 0 0-1 0v15a.5.5 0 0 0 1 0v-15ZM2 6c0-1.1.9-2 2-2h4v12H4a2 2 0 0 1-2-2V6Zm9 10h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4v12Z"/>
          </svg>
        </span>
      </button>
      <button type="button" class="icon-toggle view-mode-toggle" data-ref="source-btn" title="Edit only" aria-label="Edit only" aria-pressed="false">
        <span class="commandbar-flex-container">
          <svg class="toggle-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M17.18 2.93a2.97 2.97 0 0 0-4.26-.06l-9.37 9.38c-.33.33-.56.74-.66 1.2l-.88 3.94a.5.5 0 0 0 .6.6l3.93-.87c.46-.1.9-.34 1.23-.68l9.36-9.36a2.97 2.97 0 0 0 .05-4.15Zm-3.55.65a1.97 1.97 0 1 1 2.8 2.8l-.68.66-2.8-2.79.68-.67Zm-1.38 1.38 2.8 2.8-7.99 7.97c-.2.2-.46.35-.74.41l-3.16.7.7-3.18c.07-.27.2-.51.4-.7l8-8Z"/>
          </svg>
        </span>
      </button>
    </div>

    <div class="toolbar-controls">
      <button type="button" class="icon-toggle" data-ref="save-btn" title="Save" aria-label="Save">
        <svg class="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 2h9.2L14 4.3V14H2V2h.5zm1 1.5v9h9v-7L11 3.5H3.5zM5 4h5v3H5V4zm.5 5h5v2.5h-5V9z"/>
        </svg>
      </button>
      <button type="button" class="icon-toggle zoom-toggle" data-ref="zoom-btn" title="Zoom controls" aria-label="Zoom controls">
        <svg class="toggle-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M8.5 5.5c.28 0 .5.22.5.5v2h2a.5.5 0 0 1 0 1H9v2a.5.5 0 0 1-1 0V9H6a.5.5 0 0 1 0-1h2V6c0-.28.22-.5.5-.5Zm0-3.5a6.5 6.5 0 0 1 4.94 10.73l3.41 3.42a.5.5 0 0 1-.63.76l-.07-.06-3.42-3.41A6.5 6.5 0 1 1 8.5 2Zm0 1a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"/>
        </svg>
      </button>
      <div class="zoom-popover" data-ref="zoom-popover" hidden role="group" aria-label="Zoom">
        <span class="zoom-level" data-ref="zoom-level">100%</span>
        <span class="zoom-stepper">
          <button type="button" data-action="zoom-out" title="Zoom out" aria-label="Zoom out">-</button>
          <button type="button" data-action="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
        </span>
        <button type="button" class="zoom-reset" data-action="zoom-reset" title="Reset zoom">Reset</button>
      </div>
    </div>
  </header>

  <div class="workspace-shell" data-ref="workspace-shell" hidden>
    <aside class="nav-pane" data-ref="nav-pane" aria-label="Package contents">
      <div class="nav-tree" data-ref="nav-tree"></div>
    </aside>
    <div class="nav-resizer" data-ref="nav-resizer"
      role="separator" aria-orientation="vertical" aria-label="Resize contents pane"></div>

    <div class="pane-stack" data-ref="pane-stack">
      <section class="pane edit-pane" data-ref="edit-pane"></section>
      <div class="split-resizer" data-ref="split-resizer"
        role="separator" aria-orientation="vertical" aria-label="Resize split panes"></div>
      <section class="pane preview-pane" data-ref="preview-pane">
        <article class="preview-content" data-ref="preview-content"></article>
      </section>
    </div>
  </div>

  <div class="title-dialog-backdrop" data-ref="title-dialog" hidden
    role="dialog" aria-modal="true" aria-labelledby="mdzip-title-dialog-heading">
    <div class="title-dialog">
      <h3 id="mdzip-title-dialog-heading">Set Document Title</h3>
      <p>This is the package-level title stored in manifest.json.</p>
      <input type="text" maxlength="120" data-ref="title-input" aria-label="Document title" />
      <p class="title-dialog-validation" data-ref="title-validation" hidden>Title cannot be empty.</p>
      <p>If unset, consumers may fall back to entry point, filename, or first heading.</p>
      <div class="title-dialog-actions">
        <button type="button" class="reset-title" data-ref="title-reset-btn">Reset</button>
        <button type="button" data-action="cancel-title">Cancel</button>
        <button type="button" class="save-title" data-ref="title-save-btn">Save</button>
      </div>
    </div>
  </div>

  <div class="orphan-context-menu" data-ref="orphan-menu" hidden role="menu">
    <button type="button" role="menuitem" data-action="remove-orphan">Remove Orphaned Asset</button>
  </div>

  <p class="mdzip-empty" data-ref="empty-state">No MDZip workspace loaded.</p>
</section>
`;
