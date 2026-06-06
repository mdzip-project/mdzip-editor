import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  Columns2,
  Eye,
  File,
  FileBraces,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Link2Off,
  PanelLeft,
  Save,
  SquarePen,
  ZoomIn
} from 'lucide';
import type { MdzWorkspace } from 'mdzip-core-js';
import { browserClipboardHasImage, readBrowserClipboardImage } from './browser.js';
import { MD_MARKDOWN_ICON, type LucideIconNode } from './icons/md-markdown.js';
import type { MdzipEditorSnapshot, MdzipWorkspaceOpenOptions } from './workspace.js';
import { MdzipWorkspaceService } from './workspace.js';
import {
  buildMdzipNavTree,
  canEditMdzipPath,
  escapeHtml,
  isOrphanedMdzipAsset,
  mdzipEntryIconKind,
  isMdzipManifestPath,
  resolveMdzipArchiveLinkTarget,
  renderMdzipPreviewHtml,
  type MdzipNavNode
} from './workspace-view.js';
import { WORKSPACE_CSS } from './view-css.js';
import type { MdzipWorkspaceSnapshot } from './workspace.js';

const STYLE_ATTR = 'data-mdzip-ws-styles';

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff?)$/i;
const isImageFile = (path: string) => IMAGE_EXTENSIONS.test(path);

const NAV_ICON_CLASS = 'nav-lucide-icon';
const TOOLBAR_ICON_CLASS = 'toggle-icon';
const MANIFEST_ICON_HTML = lucideIcon(FileBraces, NAV_ICON_CLASS);
const MARKDOWN_ICON_HTML = lucideIcon(MD_MARKDOWN_ICON, NAV_ICON_CLASS);
const FOLDER_CLOSED_ICON_HTML = lucideIcon(Folder, NAV_ICON_CLASS);
const FOLDER_OPEN_ICON_HTML = lucideIcon(FolderOpen, NAV_ICON_CLASS);
const IMAGE_ICON_HTML = lucideIcon(FileImage, NAV_ICON_CLASS);
const FILE_ICON_HTML = lucideIcon(File, NAV_ICON_CLASS);
const ORPHAN_ICON_HTML = lucideIcon(Link2Off, '');
const SOURCE_EDIT_ICON_HTML = lucideIcon(SquarePen, TOOLBAR_ICON_CLASS);
const SOURCE_MARKDOWN_ICON_HTML = lucideIcon(MD_MARKDOWN_ICON, TOOLBAR_ICON_CLASS);
const NAV_TOGGLE_ICON_HTML = lucideIcon(PanelLeft, `${TOOLBAR_ICON_CLASS} nav-toggle-icon`);
const PREVIEW_ICON_HTML = lucideIcon(Eye, TOOLBAR_ICON_CLASS);
const SPLIT_ICON_HTML = lucideIcon(Columns2, TOOLBAR_ICON_CLASS);
const SAVE_ICON_HTML = lucideIcon(Save, TOOLBAR_ICON_CLASS);
const ZOOM_ICON_HTML = lucideIcon(ZoomIn, TOOLBAR_ICON_CLASS);

export type MdzipWorkspaceLayout = 'preview' | 'source' | 'split';
export type MdzipNavigationMode = 'editor' | 'host' | 'none';

export type MdzipControlPreset =
  | 'preview'
  | 'viewer'
  | 'standalone-editor'
  | 'hosted-editor'
  | 'custom';

export interface MdzipControlPolicy {
  preset?: MdzipControlPreset;
  toolbar?: boolean;
  navigation?: boolean;
  title?: boolean;
  layout?: boolean;
  save?: boolean;
  zoom?: boolean;
  orphanActions?: boolean;
}

export interface MdzipResolvedControlPolicy {
  preset: MdzipControlPreset;
  toolbar: boolean;
  navigation: boolean;
  title: boolean;
  layout: boolean;
  save: boolean;
  zoom: boolean;
  orphanActions: boolean;
}

export interface MdzipWorkspaceChange {
  bytes: Uint8Array;
  snapshot: MdzipWorkspaceSnapshot;
}

export interface MdzipWorkspaceSave {
  bytes: Uint8Array;
  snapshot: MdzipWorkspaceSnapshot;
}

export interface MdzipWorkspaceViewOptions {
  controls?: MdzipControlPreset | MdzipControlPolicy;
  initialLayout?: MdzipWorkspaceLayout;
  navigationMode?: MdzipNavigationMode;
  navigationButtonActive?: boolean;
  onChanged?: (bytes: Uint8Array, snapshot: MdzipWorkspaceSnapshot) => void;
  onSaved?: (bytes: Uint8Array, snapshot: MdzipWorkspaceSnapshot) => void;
  onSnapshotChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onSelectionChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onDirtyChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onValidationChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onFailed?: (error: unknown) => void;
}

const CONTROL_PRESETS: Record<Exclude<MdzipControlPreset, 'custom'>, MdzipResolvedControlPolicy> = {
  preview: {
    preset: 'preview',
    toolbar: false,
    navigation: false,
    title: false,
    layout: false,
    save: false,
    zoom: false,
    orphanActions: false
  },
  viewer: {
    preset: 'viewer',
    toolbar: true,
    navigation: true,
    title: false,
    layout: true,
    save: false,
    zoom: true,
    orphanActions: false
  },
  'standalone-editor': {
    preset: 'standalone-editor',
    toolbar: true,
    navigation: true,
    title: true,
    layout: true,
    save: true,
    zoom: true,
    orphanActions: true
  },
  'hosted-editor': {
    preset: 'hosted-editor',
    toolbar: true,
    navigation: true,
    title: true,
    layout: true,
    save: false,
    zoom: true,
    orphanActions: true
  }
};

export function resolveMdzipControlPolicy(
  controls: MdzipControlPreset | MdzipControlPolicy | undefined
): MdzipResolvedControlPolicy {
  if (!controls) {
    return { ...CONTROL_PRESETS['standalone-editor'] };
  }

  if (typeof controls === 'string') {
    if (controls === 'custom') {
      return { ...CONTROL_PRESETS['standalone-editor'], preset: 'custom' };
    }
    return { ...CONTROL_PRESETS[controls] };
  }

  const preset = controls.preset ?? 'custom';
  const base = preset === 'custom'
    ? CONTROL_PRESETS['standalone-editor']
    : CONTROL_PRESETS[preset];

  return {
    ...base,
    ...controls,
    preset
  };
}

function defaultLayoutForPolicy(policy: MdzipResolvedControlPolicy): MdzipWorkspaceLayout {
  return policy.preset === 'viewer' ? 'preview' : 'split';
}

const mdzipEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'calc(16px * var(--mdz-zoom, 1))',
    fontFamily: '"Cascadia Code", Consolas, monospace',
    background: 'var(--mdzip-editor-background-color)',
  },
  '.cm-scroller': {
    lineHeight: '1.5',
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

function lucideIcon(icon: LucideIconNode, className: string): string {
  const classAttr = className ? ` class="${escapeHtml(className)}"` : '';
  const children = icon
    .map(([tag, attrs]) => `<${tag}${attributesToHtml(attrs)} />`)
    .join('');
  return `<svg${classAttr} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
}

function attributesToHtml(attrs: Record<string, string | number | undefined>): string {
  return Object.entries(attrs)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => ` ${key}="${escapeHtml(String(value))}"`)
    .join('');
}

function renderNavNode(
  node: MdzipNavNode,
  state: MdzipWorkspaceSnapshot,
  allowOrphanActions: boolean
): string {
  if (node.entry) {
    const isCurrent = node.entry.path === state.currentPath;
    const isOrphaned = isOrphanedMdzipAsset(node.entry, state);
    const iconKind = mdzipEntryIconKind(node.entry);
    const safePath = escapeHtml(node.entry.path);
    const safeName = escapeHtml(node.name);
    const title = isOrphaned
      ? `${safePath} - not referenced by the entry markdown`
      : safePath;
    const classes = ['nav-file', isCurrent ? 'current-entry' : '', isOrphaned ? 'orphaned-asset' : '']
      .filter(Boolean).join(' ');
    const iconHtml = node.entry.isMarkdown
      ? MARKDOWN_ICON_HTML
      : isMdzipManifestPath(node.entry.path)
      ? MANIFEST_ICON_HTML
      : isImageFile(node.entry.path)
      ? IMAGE_ICON_HTML
      : FILE_ICON_HTML;
    const orphanBtnHtml = isOrphaned && allowOrphanActions ? `
      <span class="nav-orphan-button" role="button" tabindex="0"
        title="Orphaned asset" aria-label="Orphaned asset actions"
        data-orphan-path="${safePath}">
        ${ORPHAN_ICON_HTML}
      </span>` : '';
    return `<button type="button" class="${classes}" title="${title}"
      data-nav-path="${safePath}" data-orphan="${isOrphaned ? 'true' : ''}">
      <span class="nav-caret"></span>
      <span class="nav-file-icon ${iconKind}">${iconHtml}</span>
      ${orphanBtnHtml}
      <span class="nav-label">${safeName}</span>
    </button>`;
  }
  const children = node.children.map(c => renderNavNode(c, state, allowOrphanActions)).join('');
  return `<details class="nav-directory" open>
    <summary>
      <span class="nav-caret" aria-hidden="true"></span>
      <span class="nav-folder-icon closed">${FOLDER_CLOSED_ICON_HTML}</span>
      <span class="nav-folder-icon open">${FOLDER_OPEN_ICON_HTML}</span>
      <span class="nav-label">${escapeHtml(node.name)}</span>
    </summary>
    <div class="nav-directory-children">${children}</div>
  </details>`;
}

export class MdzipWorkspaceView {
  private workspace: MdzipWorkspaceService | null = null;
  private unsub: (() => void) | null = null;
  private readonly options: MdzipWorkspaceViewOptions;
  private readonly controlPolicy: MdzipResolvedControlPolicy;
  private readonly navigationMode: MdzipNavigationMode;
  private pendingOrphanPath: string | null = null;

  private layout: MdzipWorkspaceLayout = 'split';
  private navVisible = true;
  private zoom = 1;
  private zoomOpen = false;
  private titleDialogOpen = false;
  private titleDraft = '';
  private navPaneWidth = 280;
  private splitRatio = 0.5;
  private resizing = false;
  private orphanMenuState: { path: string; x: number; y: number } | null = null;
  private tooltipState: { text: string; x: number; y: number } | null = null;
  private tooltipShowTimer: ReturnType<typeof setTimeout> | null = null;
  private tooltipHideTimer: ReturnType<typeof setTimeout> | null = null;

  private cmEditor: EditorView | null = null;
  private readonly readOnlyCompartment = new Compartment();
  private updatingCm = false;
  private syncing = false;

  private readonly elRoot: HTMLElement;
  private readonly elToolbar: HTMLElement;
  private readonly elToolbarLeft: HTMLElement;
  private readonly elLayoutControls: HTMLElement;
  private readonly elToolbarControls: HTMLElement;
  private readonly elNavBtn: HTMLButtonElement;
  private readonly elTitleBtn: HTMLButtonElement;
  private readonly elPreviewBtn: HTMLButtonElement;
  private readonly elSplitBtn: HTMLButtonElement;
  private readonly elSourceBtn: HTMLButtonElement;
  private readonly elSourceIcon: HTMLElement;
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
  private readonly elTooltip: HTMLElement;
  private readonly elEmptyState: HTMLElement;

  public constructor(container: HTMLElement, options: MdzipWorkspaceViewOptions = {}) {
    this.options = options;
    this.controlPolicy = resolveMdzipControlPolicy(options.controls);
    this.navigationMode = options.navigationMode ?? 'editor';
    this.layout = options.initialLayout ?? defaultLayoutForPolicy(this.controlPolicy);
    this.navVisible = options.navigationButtonActive ?? this.navVisible;
    injectStyles(container.ownerDocument);
    container.innerHTML = SHELL_HTML;

    const q = <T extends HTMLElement>(sel: string): T =>
      container.querySelector<T>(sel) as T;

    this.elRoot = q('.mdzip-root');
    this.elToolbar = q('[data-ref="toolbar"]');
    this.elToolbarLeft = q('.toolbar-left');
    this.elLayoutControls = q('[data-ref="layout-controls"]');
    this.elToolbarControls = q('[data-ref="toolbar-controls"]');
    this.elNavBtn = q('[data-ref="nav-btn"]');
    this.elTitleBtn = q('[data-ref="title-btn"]');
    this.elPreviewBtn = q('[data-ref="preview-btn"]');
    this.elSplitBtn = q('[data-ref="split-btn"]');
    this.elSourceBtn = q('[data-ref="source-btn"]');
    this.elSourceIcon = q('[data-ref="source-icon"]');
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
    this.elTooltip = q('[data-ref="tooltip"]');
    this.elEmptyState = q('[data-ref="empty-state"]');

    this.prepareTooltips();
    this.attachEvents();
    this.render();
  }

  public async open(bytes: Uint8Array, options: MdzipWorkspaceOpenOptions = {}): Promise<void> {
    await this.openArchive(bytes, options);
  }

  public async openArchive(bytes: Uint8Array, options: MdzipWorkspaceOpenOptions = {}): Promise<void> {
    this.unsub?.();
    this.cmEditor?.destroy();
    this.cmEditor = null;
    this.workspace = null;

    try {
      const ws = await MdzipWorkspaceService.open(bytes, options);
      this.workspace = ws;
      const snap = ws.snapshot();
      this.layout = this.validLayoutForSnapshot(
        this.options.initialLayout ?? defaultLayoutForPolicy(this.controlPolicy),
        snap
      );
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

  public async openWorkspace(workspace: MdzWorkspace, options: MdzipWorkspaceOpenOptions = {}): Promise<void> {
    this.unsub?.();
    this.cmEditor?.destroy();
    this.cmEditor = null;
    this.workspace = null;

    try {
      const ws = await MdzipWorkspaceService.openWorkspace(workspace, options);
      this.workspace = ws;
      const snap = ws.snapshot();
      this.layout = this.validLayoutForSnapshot(
        this.options.initialLayout ?? defaultLayoutForPolicy(this.controlPolicy),
        snap
      );
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

  public async flush(): Promise<MdzipEditorSnapshot | null> {
    return this.workspace?.flush() ?? null;
  }

  public async serialize(): Promise<Blob | null> {
    return this.workspace?.serialize() ?? null;
  }

  public async getCurrentSnapshot(): Promise<MdzipEditorSnapshot | null> {
    return this.workspace?.getCurrentSnapshot() ?? null;
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
    this.elWorkspaceShell.hidden = snapshot === null;

    if (!snapshot) {
      this.elToolbar.hidden = true;
      return;
    }

    this.layout = this.validLayoutForSnapshot(this.layout, snapshot);
    const canEdit = canEditMdzipPath(snapshot.currentPathType, snapshot.currentPath, snapshot.mode);
    const canShowSource = canShowSourceLayout(snapshot);
    const showNavigationControl = this.controlPolicy.navigation;
    const showTitleControl = this.controlPolicy.title && snapshot.mode !== 'read-only';
    const showLayoutControls = this.controlPolicy.layout;
    const showSaveControl = this.controlPolicy.save && snapshot.mode !== 'read-only';
    const showZoomControl = this.controlPolicy.zoom;
    const showToolbar = this.controlPolicy.toolbar
      && (showNavigationControl || showTitleControl || showLayoutControls || showSaveControl || showZoomControl);

    this.elToolbar.hidden = !showToolbar;
    this.elToolbarLeft.hidden = !showNavigationControl && !showTitleControl;
    this.elLayoutControls.hidden = !showLayoutControls;
    this.elToolbarControls.hidden = !showSaveControl && !showZoomControl;
    this.elNavBtn.hidden = !showNavigationControl;
    this.elTitleBtn.hidden = !showTitleControl;
    this.elPreviewBtn.hidden = !showLayoutControls;
    this.elSplitBtn.hidden = !showLayoutControls;
    this.elSourceBtn.hidden = !showLayoutControls;
    this.elSaveBtn.hidden = !showSaveControl;
    this.elZoomBtn.hidden = !showZoomControl;

    this.elRoot.style.setProperty('--mdz-zoom', String(this.zoom));
    this.elRoot.style.setProperty('--nav-pane-width', `${this.navPaneWidth}px`);
    this.elRoot.style.setProperty('--split-edit-ratio', String(this.splitRatio));
    this.elRoot.classList.toggle('resizing', this.resizing);

    this.elTitleBtn.textContent = snapshot.displayTitle;
    this.elTitleBtn.disabled = snapshot.mode === 'read-only';

    this.elSaveBtn.disabled = snapshot.mode === 'read-only' || !snapshot.dirty;
    this.elSplitBtn.disabled = !showLayoutControls || !canShowSource;
    this.elSourceBtn.disabled = !showLayoutControls || !canShowSource;

    // Update button labels based on mode
    if (snapshot.mode === 'read-only') {
      this.elSourceBtn.setAttribute('aria-label', 'Raw markdown');
      this.elSourceBtn.dataset['tooltip'] = 'Raw markdown';
      this.elSourceIcon.innerHTML = SOURCE_MARKDOWN_ICON_HTML;
    } else {
      this.elSourceBtn.setAttribute('aria-label', 'Edit');
      this.elSourceBtn.dataset['tooltip'] = 'Edit';
      this.elSourceIcon.innerHTML = SOURCE_EDIT_ICON_HTML;
    }

    this.elPreviewBtn.classList.toggle('active', this.layout === 'preview');
    this.elSplitBtn.classList.toggle('active', this.layout === 'split');
    this.elSourceBtn.classList.toggle('active', this.layout === 'source');
    this.elPreviewBtn.setAttribute('aria-pressed', String(this.layout === 'preview'));
    this.elSplitBtn.setAttribute('aria-pressed', String(this.layout === 'split'));
    this.elSourceBtn.setAttribute('aria-pressed', String(this.layout === 'source'));
    this.elNavBtn.classList.toggle('active', this.navVisible);
    this.elNavBtn.setAttribute('aria-pressed', String(this.navVisible));
    this.elZoomBtn.classList.toggle('active', this.zoomOpen);

    this.elZoomPopover.hidden = !this.zoomOpen;
    this.elZoomLevel.textContent = `${Math.round(this.zoom * 100)}%`;

    const showNavigationPane = this.controlPolicy.navigation && this.navVisible && this.navigationMode === 'editor';
    this.elNavPane.classList.toggle('hidden', !showNavigationPane);
    this.elNavResizer.classList.toggle('hidden', !showNavigationPane);

    const navTree = buildMdzipNavTree(snapshot.content.paths);
    const allowOrphanActions = this.controlPolicy.orphanActions && snapshot.mode !== 'read-only';
    this.elNavTree.innerHTML = navTree.map(n => renderNavNode(n, snapshot, allowOrphanActions)).join('');
    this.prepareTooltips();

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

    if (!showTitleControl) {
      this.titleDialogOpen = false;
    }
    this.elTitleDialog.hidden = !this.titleDialogOpen;
    if (this.titleDialogOpen) {
      this.elTitleInput.value = this.titleDraft;
      const valid = this.titleDraft.trim().length > 0;
      this.elTitleValidation.hidden = valid;
      this.elTitleSaveBtn.disabled = !valid;
    }

    if (!allowOrphanActions) {
      this.orphanMenuState = null;
      this.pendingOrphanPath = null;
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
      if (!this.controlPolicy.navigation) {
        return;
      }
      this.navVisible = !this.navVisible;
      this.render();
    });

    this.elTitleBtn.addEventListener('click', () => {
      const snapshot = this.workspace?.snapshot();
      if (!this.controlPolicy.title || !snapshot || snapshot.mode === 'read-only') {
        return;
      }
      this.titleDraft = snapshot.displayTitle;
      this.titleDialogOpen = true;
      this.render();
      requestAnimationFrame(() => this.elTitleInput.select());
    });

    this.elPreviewBtn.addEventListener('click', () => {
      if (this.controlPolicy.layout) { this.setLayout('preview'); }
    });
    this.elSplitBtn.addEventListener('click', () => {
      if (this.controlPolicy.layout) { this.setLayout('split'); }
    });
    this.elSourceBtn.addEventListener('click', () => {
      if (this.controlPolicy.layout) { this.setLayout('source'); }
    });

    this.elSaveBtn.addEventListener('click', () => {
      if (this.controlPolicy.save) { void this.save(); }
    });

    this.elZoomBtn.addEventListener('click', (e) => {
      if (!this.controlPolicy.zoom) {
        return;
      }
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
        if (!this.controlPolicy.orphanActions) {
          return;
        }
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
      if (this.controlPolicy.orphanActions && navFile?.getAttribute('data-orphan') === 'true') {
        e.preventDefault();
        this.showOrphanMenu(navFile.getAttribute('data-nav-path')!, e);
      }
    });

    this.elNavTree.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const orphanBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-orphan-path]');
        if (this.controlPolicy.orphanActions && orphanBtn) {
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
      .addEventListener('click', () => {
        if (this.controlPolicy.orphanActions) { void this.removeOrphan(); }
      });

    this.elPreviewPane.addEventListener('scroll', () => this.syncScrollFromPreview());
    this.elPreviewPane.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
      const snapshot = this.workspace?.snapshot();
      if (!link || !snapshot) {
        return;
      }
      const targetPath = resolveMdzipArchiveLinkTarget(
        link.getAttribute('href') ?? '',
        snapshot.currentPath,
        snapshot.content.paths
      );
      if (!targetPath) {
        return;
      }
      event.preventDefault();
      void this.openPath(targetPath);
    });

    this.elRoot.addEventListener('pointerover', (event) => this.handleTooltipPointer(event));
    this.elRoot.addEventListener('pointerout', (event) => {
      const from = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tooltip]');
      const to = (event.relatedTarget as HTMLElement | null)?.closest<HTMLElement>('[data-tooltip]');
      if (from && from !== to) {
        this.hideTooltip();
      }
    });
    this.elRoot.addEventListener('pointerleave', () => this.hideTooltip());
    this.elRoot.addEventListener('focusin', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tooltip]');
      if (target) {
        this.showTooltipForElement(target);
      }
    });
    this.elRoot.addEventListener('focusout', () => this.hideTooltip());
    this.elRoot.addEventListener('pointerdown', () => this.hideTooltip());
    this.elRoot.addEventListener('scroll', () => this.hideTooltip(), true);
    window.addEventListener('blur', () => this.hideTooltip());
  }

  private prepareTooltips(): void {
    this.elRoot.querySelectorAll<HTMLElement>('[title]').forEach((element) => {
      const title = element.getAttribute('title');
      if (!title) {
        return;
      }
      if (!element.dataset['tooltip']) {
        element.dataset['tooltip'] = title;
      }
      element.removeAttribute('title');
    });
  }

  private async openPath(path: string): Promise<void> {
    if (!this.workspace) {
      return;
    }
    try {
      const opened = await this.workspace.openPath(path);
      if (opened) {
        this.options.onSelectionChanged?.(this.workspace.snapshot());
        this.layout = this.validLayoutForSnapshot(this.layout, this.workspace.snapshot());
        this.render();
      }
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private handleTooltipPointer(event: PointerEvent): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tooltip]');
    if (!target || target.closest('[hidden]')) {
      this.hideTooltip();
      return;
    }
    this.scheduleTooltipForElement(target);
  }

  private showTooltipForElement(element: HTMLElement): void {
    this.scheduleTooltipForElement(element, 0);
  }

  private scheduleTooltipForElement(element: HTMLElement, delay = 350): void {
    if (this.tooltipShowTimer) {
      clearTimeout(this.tooltipShowTimer);
    }
    if (this.tooltipHideTimer) {
      clearTimeout(this.tooltipHideTimer);
      this.tooltipHideTimer = null;
    }
    this.tooltipShowTimer = setTimeout(() => {
      this.tooltipShowTimer = null;
      if (!element.isConnected || element.closest('[hidden]')) {
        return;
      }
      this.showTooltipForElementNow(element);
    }, delay);
  }

  private showTooltipForElementNow(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    this.showTooltip(element.dataset['tooltip'] ?? '', rect.left + rect.width / 2, rect.top);
  }

  private showTooltip(text: string, anchorX: number, anchorY: number): void {
    if (!text) {
      this.hideTooltip();
      return;
    }
    if (this.tooltipHideTimer) {
      clearTimeout(this.tooltipHideTimer);
      this.tooltipHideTimer = null;
    }
    const viewportPadding = 8;
    const offset = 8;
    this.elTooltip.textContent = text;
    this.elTooltip.hidden = false;

    const rect = this.elTooltip.getBoundingClientRect();
    const x = Math.max(viewportPadding, Math.min(anchorX - rect.width / 2, window.innerWidth - rect.width - viewportPadding));
    const y = Math.max(viewportPadding, anchorY - rect.height - offset);

    this.tooltipState = { text, x, y };
    this.elTooltip.style.left = `${Math.round(x)}px`;
    this.elTooltip.style.top = `${Math.round(y)}px`;
  }

  private hideTooltip(): void {
    if (this.tooltipShowTimer) {
      clearTimeout(this.tooltipShowTimer);
      this.tooltipShowTimer = null;
    }
    if (this.tooltipHideTimer) {
      clearTimeout(this.tooltipHideTimer);
    }
    this.tooltipHideTimer = setTimeout(() => {
      this.tooltipState = null;
      this.elTooltip.hidden = true;
      this.elTooltip.textContent = '';
      this.tooltipHideTimer = null;
    }, 40);
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
      const bytes = await this.workspace.exportBytes();
      const snapshot = this.workspace.snapshot();
      this.options.onChanged(bytes, snapshot);
      this.options.onSnapshotChanged?.(snapshot);
      this.options.onDirtyChanged?.(snapshot);
      this.options.onValidationChanged?.(snapshot);
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private setZoom(value: number): void {
    this.zoom = Math.max(0.5, Math.min(2.5, Math.round(value * 100) / 100));
    this.render();
  }

  private setLayout(requested: MdzipWorkspaceLayout): void {
    const snapshot = this.workspace?.snapshot();
    this.layout = snapshot ? this.validLayoutForSnapshot(requested, snapshot) : requested;
    this.render();
  }

  private showOrphanMenu(path: string, event: Event): void {
    if (!this.controlPolicy.orphanActions) {
      return;
    }
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

  private validLayoutForSnapshot(
    requested: MdzipWorkspaceLayout,
    snapshot: MdzipWorkspaceSnapshot
  ): MdzipWorkspaceLayout {
    if (requested === 'source' || requested === 'split') {
      return canShowSourceLayout(snapshot) ? requested : 'preview';
    }
    return requested;
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

function canShowSourceLayout(snapshot: MdzipWorkspaceSnapshot): boolean {
  return canEditMdzipPath(snapshot.currentPathType, snapshot.currentPath, 'editable');
}

const SHELL_HTML = `
<section class="mdzip-root">
  <header class="toolbar" data-ref="toolbar" hidden>
    <div class="toolbar-left">
      <button type="button" class="icon-toggle nav-toggle" data-ref="nav-btn" title="Toggle contents" aria-label="Toggle contents">
        ${NAV_TOGGLE_ICON_HTML}
      </button>
      <button type="button" class="title-button" data-ref="title-btn"></button>
    </div>

    <div class="toolbar-buttons view-mode-toggle-group" data-ref="layout-controls" role="group" aria-label="Editor layout">
      <button type="button" class="icon-toggle view-mode-toggle" data-ref="source-btn" title="Edit" aria-label="Edit" aria-pressed="false">
        <span class="commandbar-flex-container" data-ref="source-icon">${SOURCE_EDIT_ICON_HTML}</span>
      </button>
      <button type="button" class="icon-toggle view-mode-toggle" data-ref="split-btn" title="Split" aria-label="Split" aria-pressed="false">
        <span class="commandbar-flex-container">
          ${SPLIT_ICON_HTML}
        </span>
      </button>
      <button type="button" class="icon-toggle view-mode-toggle" data-ref="preview-btn" title="View" aria-label="View" aria-pressed="false">
        <span class="commandbar-flex-container">
          ${PREVIEW_ICON_HTML}
        </span>
      </button>
    </div>

    <div class="toolbar-controls" data-ref="toolbar-controls">
      <button type="button" class="icon-toggle" data-ref="save-btn" title="Save" aria-label="Save">
        ${SAVE_ICON_HTML}
      </button>
      <button type="button" class="icon-toggle zoom-toggle" data-ref="zoom-btn" title="Zoom controls" aria-label="Zoom controls">
        ${ZOOM_ICON_HTML}
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

  <div class="mdzip-tooltip" data-ref="tooltip" role="tooltip" hidden></div>

  <p class="mdzip-empty" data-ref="empty-state">No MDZip workspace loaded.</p>
</section>
`;
