import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  Bold,
  ChevronDown,
  Code,
  Columns2,
  Eye,
  File,
  FileBraces,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Hash,
  Heading1,
  ImagePlus,
  Info,
  Italic,
  Link2Off,
  Link,
  List,
  ListOrdered,
  Moon,
  PanelLeft,
  Quote,
  Save,
  SquarePen,
  Strikethrough,
  Sun,
  ZoomIn
} from 'lucide';
import type { MdzWorkspace, MdzWorkspaceAsset } from 'mdzip-core-js';
import { browserClipboardHasImage, readBrowserClipboardImage } from './browser.js';
import { MD_MARKDOWN_ICON, type LucideIconNode } from './icons/md-markdown.js';
import type {
  MdzipDocumentChangeEvent,
  MdzipEditorSnapshot,
  MdzipRemoveAssetOptions,
  MdzipWorkspaceOpenOptions
} from './workspace.js';
import { MdzipWorkspaceService, extensionForMime } from './workspace.js';
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
const SOURCE_MARKDOWN_ICON_HTML = lucideIcon(Hash, TOOLBAR_ICON_CLASS);
const NAV_TOGGLE_ICON_HTML = lucideIcon(PanelLeft, `${TOOLBAR_ICON_CLASS} nav-toggle-icon`);
const PREVIEW_ICON_HTML = lucideIcon(Eye, TOOLBAR_ICON_CLASS);
const SPLIT_ICON_HTML = lucideIcon(Columns2, TOOLBAR_ICON_CLASS);
const SAVE_ICON_HTML = lucideIcon(Save, TOOLBAR_ICON_CLASS);
const ZOOM_ICON_HTML = lucideIcon(ZoomIn, TOOLBAR_ICON_CLASS);
const DARK_THEME_ICON_HTML = lucideIcon(Moon, TOOLBAR_ICON_CLASS);
const LIGHT_THEME_ICON_HTML = lucideIcon(Sun, TOOLBAR_ICON_CLASS);
const FORMAT_ICON_CLASS = 'format-icon';
const BOLD_ICON_HTML = lucideIcon(Bold, FORMAT_ICON_CLASS);
const ITALIC_ICON_HTML = lucideIcon(Italic, FORMAT_ICON_CLASS);
const STRIKE_ICON_HTML = lucideIcon(Strikethrough, FORMAT_ICON_CLASS);
const HEADING_ICON_HTML = lucideIcon(Heading1, FORMAT_ICON_CLASS);
const BULLET_LIST_ICON_HTML = lucideIcon(List, FORMAT_ICON_CLASS);
const ORDERED_LIST_ICON_HTML = lucideIcon(ListOrdered, FORMAT_ICON_CLASS);
const CODE_ICON_HTML = lucideIcon(Code, FORMAT_ICON_CLASS);
const QUOTE_ICON_HTML = lucideIcon(Quote, FORMAT_ICON_CLASS);
const LINK_ICON_HTML = lucideIcon(Link, FORMAT_ICON_CLASS);
const IMAGE_FORMAT_ICON_HTML = lucideIcon(ImagePlus, FORMAT_ICON_CLASS);
const CHEVRON_ICON_HTML = lucideIcon(ChevronDown, 'format-chevron');
const INFO_ICON_HTML = lucideIcon(Info, 'document-info-icon');

export type MdzipWorkspaceLayout = 'preview' | 'source' | 'split';
export type MdzipNavigationMode = 'editor' | 'host' | 'none';
export type MdzipColorScheme = 'light' | 'dark';
export type MdzipHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type MdzipEditorCommand =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'paragraph'
  | `heading-${MdzipHeadingLevel}`
  | 'bullet-list'
  | 'ordered-list'
  | 'inline-code'
  | 'code-block'
  | 'blockquote'
  | 'link'
  | 'insert-image';

type MdzipConversionAction =
  | { kind: 'navigation' }
  | { kind: 'image-picker' }
  | { kind: 'image-file'; file: File };

export type MdzipControlPreset =
  | 'preview'
  | 'viewer'
  | 'standalone-editor'
  | 'hosted-editor'
  | 'custom';

export interface MdzipTitleControlPolicy {
  visible?: boolean;
  editable?: boolean;
}

export interface MdzipLayoutControlPolicy {
  enabled?: boolean;
  source?: boolean;
  split?: boolean;
  preview?: boolean;
}

export interface MdzipFormattingControlPolicy {
  enabled?: boolean;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  headings?: boolean | MdzipHeadingLevel[];
  bulletList?: boolean;
  orderedList?: boolean;
  inlineCode?: boolean;
  codeBlock?: boolean;
  blockquote?: boolean;
  link?: boolean;
  image?: boolean;
}

export interface MdzipControlPolicy {
  preset?: MdzipControlPreset;
  toolbar?: boolean;
  navigation?: boolean;
  title?: boolean | MdzipTitleControlPolicy;
  layout?: boolean | MdzipLayoutControlPolicy;
  formatting?: boolean | MdzipFormattingControlPolicy;
  lineNumbers?: boolean;
  save?: boolean;
  zoom?: boolean;
  colorScheme?: boolean;
  orphanActions?: boolean;
}

export interface MdzipResolvedTitleControlPolicy {
  visible: boolean;
  editable: boolean;
}

export interface MdzipResolvedLayoutControlPolicy {
  source: boolean;
  split: boolean;
  preview: boolean;
}

export interface MdzipResolvedFormattingControlPolicy {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  headings: MdzipHeadingLevel[];
  bulletList: boolean;
  orderedList: boolean;
  inlineCode: boolean;
  codeBlock: boolean;
  blockquote: boolean;
  link: boolean;
  image: boolean;
}

export interface MdzipResolvedControlPolicy {
  preset: MdzipControlPreset;
  toolbar: boolean;
  navigation: boolean;
  title: MdzipResolvedTitleControlPolicy;
  layout: MdzipResolvedLayoutControlPolicy;
  formatting: MdzipResolvedFormattingControlPolicy;
  lineNumbers: boolean;
  save: boolean;
  zoom: boolean;
  colorScheme: boolean;
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
  initialColorScheme?: MdzipColorScheme;
  navigationMode?: MdzipNavigationMode;
  navigationButtonActive?: boolean;
  onChanged?: (bytes: Uint8Array, snapshot: MdzipWorkspaceSnapshot) => void;
  onSaved?: (bytes: Uint8Array, snapshot: MdzipWorkspaceSnapshot) => void;
  onWorkspaceChanged?: (event: MdzipDocumentChangeEvent) => void;
  onDocumentChanged?: (event: MdzipDocumentChangeEvent) => void;
  onAssetChanged?: (event: MdzipDocumentChangeEvent) => void;
  onManifestChanged?: (event: MdzipDocumentChangeEvent) => void;
  onSnapshotChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onSelectionChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onDirtyChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onValidationChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onColorSchemeChanged?: (colorScheme: MdzipColorScheme) => void;
  onFailed?: (error: unknown) => void;
}

const ALL_HEADINGS: MdzipHeadingLevel[] = [1, 2, 3, 4, 5, 6];
const ALL_LAYOUT_CONTROLS: MdzipResolvedLayoutControlPolicy = {
  source: true,
  split: true,
  preview: true
};
const ALL_FORMATTING_CONTROLS: MdzipResolvedFormattingControlPolicy = {
  bold: true,
  italic: true,
  strikethrough: true,
  headings: ALL_HEADINGS,
  bulletList: true,
  orderedList: true,
  inlineCode: true,
  codeBlock: true,
  blockquote: true,
  link: true,
  image: true
};
const NO_FORMATTING_CONTROLS: MdzipResolvedFormattingControlPolicy = {
  bold: false,
  italic: false,
  strikethrough: false,
  headings: [],
  bulletList: false,
  orderedList: false,
  inlineCode: false,
  codeBlock: false,
  blockquote: false,
  link: false,
  image: false
};

const CONTROL_PRESETS: Record<Exclude<MdzipControlPreset, 'custom'>, MdzipResolvedControlPolicy> = {
  preview: {
    preset: 'preview',
    toolbar: false,
    navigation: false,
    title: { visible: false, editable: false },
    layout: { source: false, split: false, preview: false },
    formatting: { ...NO_FORMATTING_CONTROLS },
    lineNumbers: false,
    save: false,
    zoom: false,
    colorScheme: false,
    orphanActions: false
  },
  viewer: {
    preset: 'viewer',
    toolbar: true,
    navigation: true,
    title: { visible: true, editable: false },
    layout: { ...ALL_LAYOUT_CONTROLS },
    formatting: { ...NO_FORMATTING_CONTROLS },
    lineNumbers: true,
    save: false,
    zoom: true,
    colorScheme: true,
    orphanActions: false
  },
  'standalone-editor': {
    preset: 'standalone-editor',
    toolbar: true,
    navigation: true,
    title: { visible: true, editable: true },
    layout: { ...ALL_LAYOUT_CONTROLS },
    formatting: { ...ALL_FORMATTING_CONTROLS },
    lineNumbers: true,
    save: true,
    zoom: true,
    colorScheme: true,
    orphanActions: true
  },
  'hosted-editor': {
    preset: 'hosted-editor',
    toolbar: true,
    navigation: true,
    title: { visible: true, editable: true },
    layout: { ...ALL_LAYOUT_CONTROLS },
    formatting: { ...ALL_FORMATTING_CONTROLS },
    lineNumbers: true,
    save: false,
    zoom: true,
    colorScheme: true,
    orphanActions: true
  }
};

export function resolveMdzipControlPolicy(
  controls: MdzipControlPreset | MdzipControlPolicy | undefined
): MdzipResolvedControlPolicy {
  if (!controls) {
    return cloneResolvedControlPolicy(CONTROL_PRESETS['standalone-editor']);
  }

  if (typeof controls === 'string') {
    if (controls === 'custom') {
      return {
        ...cloneResolvedControlPolicy(CONTROL_PRESETS['standalone-editor']),
        preset: 'custom'
      };
    }
    return cloneResolvedControlPolicy(CONTROL_PRESETS[controls]);
  }

  const preset = controls.preset ?? 'custom';
  const base = preset === 'custom'
    ? CONTROL_PRESETS['standalone-editor']
    : CONTROL_PRESETS[preset];

  return {
    ...cloneResolvedControlPolicy(base),
    ...controls,
    preset,
    title: resolveTitleControls(base.title, controls.title),
    layout: resolveLayoutControls(base.layout, controls.layout),
    formatting: resolveFormattingControls(base.formatting, controls.formatting)
  };
}

function defaultLayoutForPolicy(policy: MdzipResolvedControlPolicy): MdzipWorkspaceLayout {
  const preferred = policy.preset === 'viewer'
    ? ['preview', 'split', 'source'] as const
    : ['split', 'source', 'preview'] as const;
  return preferred.find(layout => policy.layout[layout]) ?? 'preview';
}

function cloneResolvedControlPolicy(policy: MdzipResolvedControlPolicy): MdzipResolvedControlPolicy {
  return {
    ...policy,
    title: { ...policy.title },
    layout: { ...policy.layout },
    formatting: {
      ...policy.formatting,
      headings: [...policy.formatting.headings]
    }
  };
}

function resolveTitleControls(
  base: MdzipResolvedTitleControlPolicy,
  override: boolean | MdzipTitleControlPolicy | undefined
): MdzipResolvedTitleControlPolicy {
  if (typeof override === 'boolean') {
    return { visible: override, editable: override && base.editable };
  }
  return { ...base, ...override };
}

function resolveLayoutControls(
  base: MdzipResolvedLayoutControlPolicy,
  override: boolean | MdzipLayoutControlPolicy | undefined
): MdzipResolvedLayoutControlPolicy {
  if (typeof override === 'boolean') {
    return { source: override, split: override, preview: override };
  }
  if (!override) {
    return { ...base };
  }
  const { enabled, ...controls } = override;
  const resolvedBase = enabled === false
    ? { source: false, split: false, preview: false }
    : enabled === true
      ? { ...ALL_LAYOUT_CONTROLS }
      : base;
  return { ...resolvedBase, ...controls };
}

function resolveFormattingControls(
  base: MdzipResolvedFormattingControlPolicy,
  override: boolean | MdzipFormattingControlPolicy | undefined
): MdzipResolvedFormattingControlPolicy {
  if (typeof override === 'boolean') {
    return override
      ? { ...ALL_FORMATTING_CONTROLS, headings: [...ALL_HEADINGS] }
      : { ...NO_FORMATTING_CONTROLS, headings: [] };
  }
  const { enabled, headings, ...controls } = override ?? {};
  const resolvedBase = enabled === false
    ? NO_FORMATTING_CONTROLS
    : enabled === true
      ? ALL_FORMATTING_CONTROLS
      : base;
  return {
    ...resolvedBase,
    ...controls,
    headings: headings === undefined
      ? [...resolvedBase.headings]
      : headings === true
        ? [...ALL_HEADINGS]
        : headings === false
          ? []
          : [...new Set(headings)].filter(
            (level): level is MdzipHeadingLevel => ALL_HEADINGS.includes(level)
          ).sort()
  };
}

const mdzipEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'calc(16px * var(--mdz-zoom, 1))',
    fontFamily: '"Cascadia Code", Consolas, monospace',
    fontVariantLigatures: 'none',
    fontFeatureSettings: '"liga" 0, "calt" 0',
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
  private colorScheme: MdzipColorScheme;
  private titleDialogOpen = false;
  private metadataDialogOpen = false;
  private titleDraft = '';
  private conversionAction: MdzipConversionAction | null = null;
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
  private readonly elDocumentStrip: HTMLElement;
  private readonly elToolbar: HTMLElement;
  private readonly elToolbarLeft: HTMLElement;
  private readonly elLayoutControls: HTMLElement;
  private readonly elToolbarControls: HTMLElement;
  private readonly elNavBtn: HTMLButtonElement;
  private readonly elTitleBtn: HTMLButtonElement;
  private readonly elDocumentInfoBtn: HTMLButtonElement;
  private readonly elPreviewBtn: HTMLButtonElement;
  private readonly elSplitBtn: HTMLButtonElement;
  private readonly elSourceBtn: HTMLButtonElement;
  private readonly elSourceIcon: HTMLElement;
  private readonly elSaveBtn: HTMLButtonElement;
  private readonly elZoomBtn: HTMLButtonElement;
  private readonly elThemeControls: HTMLElement;
  private readonly elDarkThemeBtn: HTMLButtonElement;
  private readonly elLightThemeBtn: HTMLButtonElement;
  private readonly elZoomPopover: HTMLElement;
  private readonly elZoomLevel: HTMLElement;
  private readonly elWorkspaceShell: HTMLElement;
  private readonly elNavPane: HTMLElement;
  private readonly elNavResizer: HTMLElement;
  private readonly elNavTree: HTMLElement;
  private readonly elPaneStack: HTMLElement;
  private readonly elEditPane: HTMLElement;
  private readonly elEditToolbar: HTMLElement;
  private readonly elImageInput: HTMLInputElement;
  private readonly elEditorHost: HTMLElement;
  private readonly elSplitResizer: HTMLElement;
  private readonly elPreviewPane: HTMLElement;
  private readonly elPreviewContent: HTMLElement;
  private readonly elTitleDialog: HTMLElement;
  private readonly elTitleInput: HTMLInputElement;
  private readonly elTitleValidation: HTMLElement;
  private readonly elTitleSaveBtn: HTMLButtonElement;
  private readonly elTitleResetBtn: HTMLButtonElement;
  private readonly elMetadataDialog: HTMLElement;
  private readonly elMetadataList: HTMLElement;
  private readonly elConversionDialog: HTMLElement;
  private readonly elConversionConfirmBtn: HTMLButtonElement;
  private readonly elOrphanMenu: HTMLElement;
  private readonly elTooltip: HTMLElement;
  private readonly elEmptyState: HTMLElement;

  public constructor(container: HTMLElement, options: MdzipWorkspaceViewOptions = {}) {
    this.options = options;
    this.controlPolicy = resolveMdzipControlPolicy(options.controls);
    this.navigationMode = options.navigationMode ?? 'editor';
    this.layout = options.initialLayout ?? defaultLayoutForPolicy(this.controlPolicy);
    this.colorScheme = options.initialColorScheme
      ?? (container.ownerDocument.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light');
    this.navVisible = options.navigationButtonActive ?? this.navVisible;
    injectStyles(container.ownerDocument);
    container.replaceChildren();
    container.innerHTML = SHELL_HTML;

    const q = <T extends HTMLElement>(sel: string): T =>
      container.querySelector<T>(sel) as T;

    this.elRoot = q('.mdzip-root');
    this.elDocumentStrip = q('[data-ref="document-strip"]');
    this.elToolbar = q('[data-ref="toolbar"]');
    this.elToolbarLeft = q('.toolbar-left');
    this.elLayoutControls = q('[data-ref="layout-controls"]');
    this.elToolbarControls = q('[data-ref="toolbar-controls"]');
    this.elNavBtn = q('[data-ref="nav-btn"]');
    this.elTitleBtn = q('[data-ref="title-btn"]');
    this.elDocumentInfoBtn = q('[data-ref="document-info-btn"]');
    this.elPreviewBtn = q('[data-ref="preview-btn"]');
    this.elSplitBtn = q('[data-ref="split-btn"]');
    this.elSourceBtn = q('[data-ref="source-btn"]');
    this.elSourceIcon = q('[data-ref="source-icon"]');
    this.elSaveBtn = q('[data-ref="save-btn"]');
    this.elZoomBtn = q('[data-ref="zoom-btn"]');
    this.elThemeControls = q('[data-ref="theme-controls"]');
    this.elDarkThemeBtn = q('[data-ref="dark-theme-btn"]');
    this.elLightThemeBtn = q('[data-ref="light-theme-btn"]');
    this.elZoomPopover = q('[data-ref="zoom-popover"]');
    this.elZoomLevel = q('[data-ref="zoom-level"]');
    this.elWorkspaceShell = q('[data-ref="workspace-shell"]');
    this.elNavPane = q('[data-ref="nav-pane"]');
    this.elNavResizer = q('[data-ref="nav-resizer"]');
    this.elNavTree = q('[data-ref="nav-tree"]');
    this.elPaneStack = q('[data-ref="pane-stack"]');
    this.elEditPane = q('[data-ref="edit-pane"]');
    this.elEditToolbar = q('[data-ref="edit-toolbar"]');
    this.elImageInput = q('[data-ref="image-input"]');
    this.elEditorHost = q('[data-ref="editor-host"]');
    this.elSplitResizer = q('[data-ref="split-resizer"]');
    this.elPreviewPane = q('[data-ref="preview-pane"]');
    this.elPreviewContent = q('[data-ref="preview-content"]');
    this.elTitleDialog = q('[data-ref="title-dialog"]');
    this.elTitleInput = q('[data-ref="title-input"]');
    this.elTitleValidation = q('[data-ref="title-validation"]');
    this.elTitleSaveBtn = q('[data-ref="title-save-btn"]');
    this.elTitleResetBtn = q('[data-ref="title-reset-btn"]');
    this.elMetadataDialog = q('[data-ref="metadata-dialog"]');
    this.elMetadataList = q('[data-ref="metadata-list"]');
    this.elConversionDialog = q('[data-ref="conversion-dialog"]');
    this.elConversionConfirmBtn = q('[data-ref="conversion-confirm-btn"]');
    this.elOrphanMenu = q('[data-ref="orphan-menu"]');
    this.elTooltip = q('[data-ref="tooltip"]');
    this.elEmptyState = q('[data-ref="empty-state"]');

    this.prepareTooltips();
    this.attachEvents();
    this.render();
  }

  /**
   * Opens an `.mdz` archive or Markdown file from raw bytes.
   *
   * Parses the ZIP and resolves all assets in the browser. For large archives
   * this can take several seconds. Prefer {@link openWorkspace} when the host
   * has already parsed the archive on the native side.
   */
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
      if (snap.sourceFormat === 'markdown') {
        this.navVisible = false;
      }
      this.layout = this.validLayoutForSnapshot(
        this.options.initialLayout ?? defaultLayoutForPolicy(this.controlPolicy),
        snap
      );
      this.cmEditor = this.createCmEditor(this.elEditorHost, snap.currentText, snap.mode);
      this.unsub = ws.subscribe((event) => {
        this.render();
        void this.notifyChanged(event);
      });
      this.render();
      void this.notifyChanged(this.initialWorkspaceEvent(ws.snapshot()));
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  /**
   * Opens a pre-parsed `MdzWorkspace` without rebuilding the archive.
   *
   * Use this when the host (e.g. a VS Code extension) has already called
   * `MdzipWorkspaceService.open()` on the native side and can pass the workspace
   * object directly. Significantly faster than {@link open} for large archives
   * because no ZIP parsing or asset decompression occurs in the browser.
   *
   * Assets must expose either `readDataUri` or `readBytes` so that subsequent
   * ZIP rebuilds (e.g. on paste or asset removal) can read their bytes.
   * Fields present at runtime but absent from the TypeScript interface —
   * `validation`, `orphanedAssets`, and `asset.kind` — must be preserved on the
   * workspace object or operations that depend on them will fail.
   */
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
      this.cmEditor = this.createCmEditor(this.elEditorHost, snap.currentText, snap.mode);
      this.unsub = ws.subscribe((event) => {
        this.render();
        void this.notifyChanged(event);
      });
      this.render();
      void this.notifyChanged(this.initialWorkspaceEvent(ws.snapshot()));
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

  public markPersisted(): void {
    this.workspace?.markPersisted();
  }

  public async addAsset(archivePath: string, fileBytes: Uint8Array): Promise<void> {
    await this.workspace?.addAsset(archivePath, fileBytes);
  }

  public async replaceAsset(archivePath: string, fileBytes: Uint8Array): Promise<boolean> {
    return this.workspace?.replaceAsset(archivePath, fileBytes) ?? false;
  }

  public async removeAsset(
    archivePath: string,
    options?: MdzipRemoveAssetOptions
  ): Promise<boolean> {
    return this.workspace?.removeAsset(archivePath, options) ?? false;
  }

  public listAssets(): MdzWorkspaceAsset[] {
    return this.workspace?.listAssets() ?? [];
  }

  public canExecuteCommand(command: MdzipEditorCommand): boolean {
    const snapshot = this.workspace?.snapshot();
    if (!snapshot || !this.cmEditor || snapshot.mode === 'read-only'
      || snapshot.currentPathType !== 'markdown') {
      return false;
    }
    return true;
  }

  public async executeCommand(command: MdzipEditorCommand, file?: File): Promise<boolean> {
    if (!this.canExecuteCommand(command)) {
      return false;
    }
    if (command === 'insert-image') {
      if (this.workspace?.sourceFormat === 'markdown') {
        this.requestMdzConversion(file
          ? { kind: 'image-file', file }
          : { kind: 'image-picker' });
        return true;
      }
      if (file) {
        await this.insertImageFile(file);
      } else {
        this.elImageInput.click();
      }
      return true;
    }
    this.applyMarkdownFormat(command);
    return true;
  }

  public async convertToMdz(): Promise<boolean> {
    if (!this.workspace || this.workspace.mode === 'read-only') {
      return false;
    }
    try {
      const converted = await this.workspace.convertToMdz();
      this.render();
      return converted;
    } catch (error) {
      this.options.onFailed?.(error);
      return false;
    }
  }

  public focus(): void {
    this.cmEditor?.focus();
  }

  public destroy(): void {
    try {
      this.unsub?.();
    } catch {
      // Ignore subscription cleanup errors
    }
    try {
      this.cmEditor?.destroy();
    } catch {
      // Ignore CodeMirror cleanup errors
    }
    try {
      this.elRoot?.remove();
    } catch {
      // Ignore DOM cleanup errors
    }
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
        ...(this.controlPolicy.lineNumbers ? [lineNumbers()] : []),
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
      this.elDocumentStrip.hidden = true;
      this.elToolbar.hidden = true;
      return;
    }

    this.layout = this.validLayoutForSnapshot(this.layout, snapshot);
    const canEdit = canEditMdzipPath(snapshot.currentPathType, snapshot.currentPath, snapshot.mode);
    const canShowSource = canShowSourceLayout(snapshot);
    const showNavigationControl = this.controlPolicy.navigation;
    const showTitleControl = this.controlPolicy.title.visible;
    const showLayoutControls = Object.values(this.controlPolicy.layout).some(Boolean);
    const showSaveControl = this.controlPolicy.save && snapshot.mode !== 'read-only';
    const showZoomControl = this.controlPolicy.zoom;
    const showColorSchemeControl = this.controlPolicy.colorScheme;
    const showEditControls = canEdit
      && snapshot.currentPathType === 'markdown'
      && this.layout !== 'preview'
      && hasFormattingControls(this.controlPolicy.formatting);
    const showToolbar = this.controlPolicy.toolbar
      && (showNavigationControl || showLayoutControls
        || showSaveControl || showZoomControl || showColorSchemeControl || showEditControls);

    this.elDocumentStrip.hidden = !showTitleControl;
    this.elToolbar.hidden = !showToolbar;
    this.elToolbarLeft.hidden = !showNavigationControl;
    this.elEditToolbar.hidden = !showEditControls;
    this.elLayoutControls.hidden = !showLayoutControls;
    this.elToolbarControls.hidden = !showSaveControl && !showZoomControl && !showColorSchemeControl;
    this.elNavBtn.hidden = !showNavigationControl;
    this.elPreviewBtn.hidden = !this.controlPolicy.layout.preview;
    this.elSplitBtn.hidden = !this.controlPolicy.layout.split;
    this.elSourceBtn.hidden = !this.controlPolicy.layout.source;
    this.elSaveBtn.hidden = !showSaveControl;
    this.elZoomBtn.hidden = !showZoomControl;
    this.elThemeControls.hidden = !showColorSchemeControl;

    this.elRoot.style.setProperty('--mdz-zoom', String(this.zoom));
    this.elRoot.style.setProperty('--nav-pane-width', `${this.navPaneWidth}px`);
    this.elRoot.style.setProperty('--split-edit-ratio', String(this.splitRatio));
    this.elRoot.classList.toggle('resizing', this.resizing);
    this.elRoot.classList.toggle('mdzip-theme-dark', this.colorScheme === 'dark');
    this.elRoot.classList.toggle('mdzip-theme-light', this.colorScheme === 'light');

    let titleContent: string;
    if (snapshot.sourceFormat === 'markdown') {
      titleContent = escapeHtml(snapshot.fileName);
    } else if (snapshot.displayTitle === snapshot.fileName) {
      titleContent = escapeHtml(snapshot.fileName);
    } else {
      titleContent = `${escapeHtml(snapshot.displayTitle)}<span class="title-filename"> (${escapeHtml(snapshot.fileName)})</span>`;
    }
    this.elTitleBtn.innerHTML = titleContent;
    this.elTitleBtn.disabled = snapshot.mode === 'read-only'
      || snapshot.sourceFormat === 'markdown'
      || !this.controlPolicy.title.editable;
    this.renderMetadata(snapshot);

    this.elSaveBtn.disabled = snapshot.mode === 'read-only' || !snapshot.dirty;
    this.elSplitBtn.disabled = !this.controlPolicy.layout.split || !canShowSource;
    this.elSourceBtn.disabled = !this.controlPolicy.layout.source || !canShowSource;
    this.renderFormattingControls();

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
    this.elDarkThemeBtn.classList.toggle('active', this.colorScheme === 'dark');
    this.elLightThemeBtn.classList.toggle('active', this.colorScheme === 'light');
    this.elDarkThemeBtn.setAttribute('aria-pressed', String(this.colorScheme === 'dark'));
    this.elLightThemeBtn.setAttribute('aria-pressed', String(this.colorScheme === 'light'));

    this.elZoomPopover.hidden = !this.zoomOpen;
    this.elZoomLevel.textContent = `${Math.round(this.zoom * 100)}%`;

    const showNavigationPane = this.controlPolicy.navigation
      && snapshot.sourceFormat === 'mdz'
      && this.navVisible
      && this.navigationMode === 'editor';
    this.elRoot.classList.toggle('navigation-pane-visible', showNavigationPane);
    this.elNavPane.classList.toggle('hidden', !showNavigationPane);
    this.elNavResizer.classList.toggle('hidden', !showNavigationPane);

    const navTree = snapshot.sourceFormat === 'mdz'
      ? buildMdzipNavTree(snapshot.content.paths)
      : [];
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
      this.metadataDialogOpen = false;
    }
    this.elTitleDialog.hidden = !this.titleDialogOpen;
    if (this.titleDialogOpen) {
      this.elTitleInput.value = this.titleDraft;
      const valid = this.titleDraft.trim().length > 0;
      this.elTitleValidation.hidden = valid;
      this.elTitleSaveBtn.disabled = !valid;
    }
    this.elConversionDialog.hidden = this.conversionAction === null;
    this.elMetadataDialog.hidden = !this.metadataDialogOpen;

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
      this.closeFormatMenus();
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
      const snapshot = this.workspace?.snapshot();
      if (snapshot?.sourceFormat === 'markdown') {
        if (snapshot.mode !== 'read-only') {
          this.requestMdzConversion({ kind: 'navigation' });
        }
        return;
      }
      this.navVisible = !this.navVisible;
      this.render();
    });

    this.elTitleBtn.addEventListener('click', () => {
      const snapshot = this.workspace?.snapshot();
      if (!this.controlPolicy.title.visible || !this.controlPolicy.title.editable
        || !snapshot || snapshot.mode === 'read-only') {
        return;
      }
      this.titleDraft = snapshot.displayTitle;
      this.titleDialogOpen = true;
      this.render();
      requestAnimationFrame(() => this.elTitleInput.select());
    });
    this.elDocumentInfoBtn.addEventListener('click', () => {
      this.metadataDialogOpen = true;
      this.render();
    });

    this.elPreviewBtn.addEventListener('click', () => {
      if (this.controlPolicy.layout.preview) { this.setLayout('preview'); }
    });
    this.elSplitBtn.addEventListener('click', () => {
      if (this.controlPolicy.layout.split) { this.setLayout('split'); }
    });
    this.elSourceBtn.addEventListener('click', () => {
      if (this.controlPolicy.layout.source) { this.setLayout('source'); }
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
    this.elDarkThemeBtn.addEventListener('click', () => this.setColorScheme('dark'));
    this.elLightThemeBtn.addEventListener('click', () => this.setColorScheme('light'));

    this.elEditToolbar.addEventListener('click', (event) => {
      const menuToggle = (event.target as HTMLElement)
        .closest<HTMLButtonElement>('[data-format-menu-toggle]');
      if (menuToggle) {
        event.preventDefault();
        event.stopPropagation();
        this.toggleFormatMenu(menuToggle);
        return;
      }
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-format]');
      if (!button) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.closeFormatMenus();
      const format = button.dataset['format'] ?? '';
      if (format === 'image') {
        void this.executeCommand('insert-image');
        return;
      }
      const command = markdownCommandFromToolbarFormat(format);
      if (command) {
        void this.executeCommand(command);
      }
    });
    this.elImageInput.addEventListener('change', () => {
      const file = this.elImageInput.files?.[0];
      this.elImageInput.value = '';
      if (file) {
        void this.insertImageFile(file);
      }
    });
    this.elEditToolbar.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const openToggle = this.elEditToolbar
          .querySelector<HTMLButtonElement>('[data-format-menu-toggle][aria-expanded="true"]');
        if (!openToggle) {
          return;
        }
        event.preventDefault();
        this.closeFormatMenus();
        openToggle.focus();
        return;
      }
      const item = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="menuitem"]');
      if (!item || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
        return;
      }
      event.preventDefault();
      const items = Array.from(
        item.closest<HTMLElement>('[role="menu"]')!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      );
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      items[(items.indexOf(item) + direction + items.length) % items.length]?.focus();
    });

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
    this.elMetadataDialog.querySelector<HTMLButtonElement>('[data-action="close-metadata"]')!
      .addEventListener('click', () => {
        this.metadataDialogOpen = false;
        this.render();
      });
    this.elConversionDialog.querySelector<HTMLButtonElement>('[data-action="cancel-conversion"]')!
      .addEventListener('click', () => {
        this.conversionAction = null;
        this.render();
      });
    this.elConversionConfirmBtn.addEventListener('click', () => {
      void this.confirmMdzConversion();
    });

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
      const saved = await workspace.flush();
      const bytes = new Uint8Array(await saved.bytes.arrayBuffer());
      const snapshot = workspace.snapshot();

      if (this.options.onSaved) {
        this.options.onSaved(bytes, snapshot);
      } else {
        this.downloadSavedBlob(saved.bytes, snapshot.fileName);
        workspace.markPersisted();
      }
      this.render();
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private downloadSavedBlob(blob: Blob, fileName: string): void {
    const doc = this.elRoot.ownerDocument;
    const urlApi = doc.defaultView?.URL;
    if (!urlApi?.createObjectURL) {
      throw new Error('Browser download is unavailable. Provide an onSaved handler to persist the file.');
    }

    const url = urlApi.createObjectURL(blob);
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.hidden = true;
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    urlApi.revokeObjectURL(url);
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

  private renderMetadata(snapshot: MdzipWorkspaceSnapshot): void {
    const manifest = snapshot.content.manifest;
    const fields: Array<[string, string]> = [
      ['Filename', snapshot.fileName],
      ['Format', snapshot.sourceFormat === 'mdz' ? 'MDZ package' : 'Markdown'],
      ['Document title', snapshot.displayTitle],
      ['First heading', snapshot.headingFallback ?? 'Not found'],
      ['Created', formatMetadataValue(manifest?.created)],
      ['Modified', formatMetadataValue(manifest?.modified)],
      ['Entry point', snapshot.sourceFormat === 'mdz' ? snapshot.content.entryPoint : 'Not applicable']
    ];

    this.elMetadataList.replaceChildren(...fields.map(([label, value]) => {
      const row = this.elRoot.ownerDocument.createElement('div');
      row.className = 'metadata-row';
      const term = this.elRoot.ownerDocument.createElement('dt');
      term.textContent = label;
      const detail = this.elRoot.ownerDocument.createElement('dd');
      detail.textContent = value;
      row.append(term, detail);
      return row;
    }));
  }

  private requestMdzConversion(action: MdzipConversionAction): void {
    const snapshot = this.workspace?.snapshot();
    if (!snapshot || snapshot.mode === 'read-only' || snapshot.sourceFormat !== 'markdown') {
      return;
    }
    this.conversionAction = action;
    this.render();
    requestAnimationFrame(() => this.elConversionConfirmBtn.focus());
  }

  private async confirmMdzConversion(): Promise<void> {
    const action = this.conversionAction;
    this.conversionAction = null;
    if (!action || !await this.convertToMdz()) {
      this.render();
      return;
    }
    if (action.kind === 'navigation') {
      this.navVisible = true;
      this.render();
      return;
    }
    if (action.kind === 'image-file') {
      await this.insertImageFile(action.file);
      return;
    }
    this.elImageInput.click();
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

      // For markdown source, delegate to the conversion dialog instead of
      // silently discarding the paste.
      if (this.workspace?.sourceFormat === 'markdown') {
        const extension = extensionForMime(image.mimeType);
        const pastedFile = new window.File(
          [new Blob([image.bytes as any], { type: image.mimeType })],
          `pasted.${extension}`,
          { type: image.mimeType }
        );
        this.requestMdzConversion({ kind: 'image-file', file: pastedFile });
        return;
      }

      await this.insertImageBytes(image.bytes, image.mimeType);
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private async insertImageFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)) {
      return;
    }
    try {
      await this.insertImageBytes(
        new Uint8Array(await file.arrayBuffer()),
        file.type || imageMimeTypeFromFileName(file.name)
      );
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private async insertImageBytes(bytes: Uint8Array, mimeType: string): Promise<void> {
    const editor = this.cmEditor;
    if (!editor) {
      return;
    }
    const selection = editor.state.selection.main;
    const result = await this.workspace?.pasteImage({
      bytes,
      mimeType,
      selectionStart: selection.from,
      selectionEnd: selection.to
    });
    if (result && this.cmEditor) {
      this.render();
      this.cmEditor.dispatch({ selection: { anchor: result.cursor } });
      this.cmEditor.focus();
    }
  }

  private applyMarkdownFormat(format: Exclude<MdzipEditorCommand, 'insert-image'>): void {
    const editor = this.cmEditor;
    const snapshot = this.workspace?.snapshot();
    if (!editor || !snapshot || snapshot.mode === 'read-only' || snapshot.currentPathType !== 'markdown') {
      return;
    }

    switch (format) {
      case 'bold':
        this.wrapSelection('**', '**', 'bold text');
        break;
      case 'italic':
        this.wrapSelection('_', '_', 'italic text');
        break;
      case 'strikethrough':
        this.wrapSelection('~~', '~~', 'strikethrough text');
        break;
      case 'paragraph':
        this.setSelectedLinePrefix('', /^(#{1,6})\s+/);
        break;
      case 'heading-1':
      case 'heading-2':
      case 'heading-3':
      case 'heading-4':
      case 'heading-5':
      case 'heading-6':
        this.setSelectedLinePrefix(
          `${'#'.repeat(Number(format.at(-1)))} `,
          /^(#{1,6})\s+/
        );
        break;
      case 'bullet-list':
        this.prefixSelectedLines('- ', /^(\s*)[-*+]\s+/);
        break;
      case 'ordered-list':
        this.numberSelectedLines();
        break;
      case 'inline-code':
        this.wrapSelection('`', '`', 'code');
        break;
      case 'code-block':
        this.wrapSelection('```\n', '\n```', 'code');
        break;
      case 'blockquote':
        this.prefixSelectedLines('> ', /^(\s*)>\s?/);
        break;
      case 'link':
        this.wrapSelection('[', '](url)', 'link text');
        break;
      default:
        return;
    }
  }

  private renderFormattingControls(): void {
    const formatting = this.controlPolicy.formatting;
    const visibility: Record<string, boolean> = {
      bold: formatting.bold,
      italic: formatting.italic,
      strikethrough: formatting.strikethrough,
      headings: formatting.headings.length > 0,
      bulletList: formatting.bulletList,
      orderedList: formatting.orderedList,
      code: formatting.inlineCode || formatting.codeBlock,
      blockquote: formatting.blockquote,
      link: formatting.link,
      image: formatting.image
    };

    this.elEditToolbar.querySelectorAll<HTMLElement>('[data-format-control]').forEach((element) => {
      element.hidden = !visibility[element.dataset['formatControl'] ?? ''];
    });
    this.elEditToolbar.querySelectorAll<HTMLElement>('[data-heading-level]').forEach((element) => {
      const level = Number(element.dataset['headingLevel']) as MdzipHeadingLevel;
      element.hidden = !formatting.headings.includes(level);
    });
    this.elEditToolbar.querySelector<HTMLElement>('[data-code-kind="inline"]')!.hidden =
      !formatting.inlineCode;
    this.elEditToolbar.querySelector<HTMLElement>('[data-code-kind="block"]')!.hidden =
      !formatting.codeBlock;

    const groups = Array.from(this.elEditToolbar.querySelectorAll<HTMLElement>('.edit-toolbar-group'));
    groups.forEach((group) => {
      group.hidden = !Array.from(group.children).some(
        child => child instanceof HTMLElement && !child.hidden && child.matches('[data-format-control]')
      );
    });
    this.elEditToolbar.querySelectorAll<HTMLElement>('.edit-toolbar-divider').forEach((divider, index) => {
      const hasVisibleBefore = groups.slice(0, index + 1).some(group => !group.hidden);
      const hasVisibleAfter = groups.slice(index + 1).some(group => !group.hidden);
      divider.hidden = !hasVisibleBefore || !hasVisibleAfter;
    });
  }

  private toggleFormatMenu(toggle: HTMLButtonElement): void {
    const menu = toggle.nextElementSibling as HTMLElement | null;
    const willOpen = toggle.getAttribute('aria-expanded') !== 'true';
    this.closeFormatMenus();
    if (!menu || !willOpen) {
      return;
    }
    toggle.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }

  private closeFormatMenus(): void {
    this.elEditToolbar
      .querySelectorAll<HTMLButtonElement>('[data-format-menu-toggle][aria-expanded="true"]')
      .forEach(toggle => toggle.setAttribute('aria-expanded', 'false'));
    this.elEditToolbar
      .querySelectorAll<HTMLElement>('[data-format-menu]')
      .forEach(menu => { menu.hidden = true; });
  }

  private wrapSelection(prefix: string, suffix: string, placeholder: string): void {
    const editor = this.cmEditor;
    if (!editor) {
      return;
    }
    const selection = editor.state.selection.main;
    const selectedText = editor.state.sliceDoc(selection.from, selection.to);
    const content = selectedText || placeholder;
    const insert = `${prefix}${content}${suffix}`;
    const anchor = selection.from + prefix.length;
    editor.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: { anchor, head: anchor + content.length },
      scrollIntoView: true
    });
    editor.focus();
  }

  private prefixSelectedLines(prefix: string, existingPrefix: RegExp): void {
    const editor = this.cmEditor;
    if (!editor) {
      return;
    }
    const selection = editor.state.selection.main;
    const firstLine = editor.state.doc.lineAt(selection.from);
    const lastLine = editor.state.doc.lineAt(selection.to);
    const text = editor.state.sliceDoc(firstLine.from, lastLine.to);
    const lines = text.split('\n');
    const allPrefixed = lines.every(line => existingPrefix.test(line) && line.match(existingPrefix)?.[0]);
    const insert = lines.map((line) => {
      const withoutExisting = line.replace(existingPrefix, '$1');
      return allPrefixed ? withoutExisting : `${prefix}${withoutExisting}`;
    }).join('\n');

    editor.dispatch({
      changes: { from: firstLine.from, to: lastLine.to, insert },
      selection: { anchor: firstLine.from, head: firstLine.from + insert.length },
      scrollIntoView: true
    });
    editor.focus();
  }

  private numberSelectedLines(): void {
    const editor = this.cmEditor;
    if (!editor) {
      return;
    }
    const selection = editor.state.selection.main;
    const firstLine = editor.state.doc.lineAt(selection.from);
    const lastLine = editor.state.doc.lineAt(selection.to);
    const text = editor.state.sliceDoc(firstLine.from, lastLine.to);
    const lines = text.split('\n');
    const orderedPrefix = /^(\s*)\d+[.)]\s+/;
    const nonEmptyLines = lines.filter(line => line.trim().length > 0);
    const allNumbered = nonEmptyLines.length > 0 && nonEmptyLines.every(line => orderedPrefix.test(line));
    let number = 1;
    const insert = lines.map((line) => {
      if (!line.trim()) {
        return line;
      }
      const match = line.match(orderedPrefix);
      const indent = match?.[1] ?? line.match(/^\s*/)?.[0] ?? '';
      const content = match ? line.slice(match[0].length) : line.slice(indent.length);
      if (allNumbered) {
        return `${indent}${content}`;
      }
      return `${indent}${number++}. ${content}`;
    }).join('\n');

    editor.dispatch({
      changes: { from: firstLine.from, to: lastLine.to, insert },
      selection: { anchor: firstLine.from, head: firstLine.from + insert.length },
      scrollIntoView: true
    });
    editor.focus();
  }

  private setSelectedLinePrefix(prefix: string, existingPrefix: RegExp): void {
    const editor = this.cmEditor;
    if (!editor) {
      return;
    }
    const selection = editor.state.selection.main;
    const firstLine = editor.state.doc.lineAt(selection.from);
    const lastLine = editor.state.doc.lineAt(selection.to);
    const text = editor.state.sliceDoc(firstLine.from, lastLine.to);
    const insert = text.split('\n')
      .map(line => `${prefix}${line.replace(existingPrefix, '')}`)
      .join('\n');

    editor.dispatch({
      changes: { from: firstLine.from, to: lastLine.to, insert },
      selection: { anchor: firstLine.from, head: firstLine.from + insert.length },
      scrollIntoView: true
    });
    editor.focus();
  }

  private async notifyChanged(event: MdzipDocumentChangeEvent): Promise<void> {
    if (!this.workspace) {
      return;
    }
    try {
      const snapshot = event.snapshot;
      if (this.options.onChanged) {
        const bytes = await this.workspace.exportBytes();
        this.options.onChanged(bytes, snapshot);
      }
      this.options.onWorkspaceChanged?.(event);
      if (event.changes.includes('document')) {
        this.options.onDocumentChanged?.(event);
      }
      if (event.changes.includes('asset')) {
        this.options.onAssetChanged?.(event);
      }
      if (event.changes.includes('manifest')) {
        this.options.onManifestChanged?.(event);
      }
      this.options.onSnapshotChanged?.(snapshot);
      this.options.onDirtyChanged?.(snapshot);
      this.options.onValidationChanged?.(snapshot);
      if (event.changes.includes('selection')) {
        this.options.onSelectionChanged?.(snapshot);
      }
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private initialWorkspaceEvent(snapshot: MdzipWorkspaceSnapshot): MdzipDocumentChangeEvent {
    return {
      reason: 'reload',
      changes: ['workspace'],
      snapshot
    };
  }

  private setZoom(value: number): void {
    this.zoom = Math.max(0.5, Math.min(2.5, Math.round(value * 100) / 100));
    this.render();
  }

  private setColorScheme(colorScheme: MdzipColorScheme): void {
    if (this.colorScheme === colorScheme) {
      return;
    }
    this.colorScheme = colorScheme;
    this.render();
    this.options.onColorSchemeChanged?.(colorScheme);
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
      await this.workspace?.removeAsset(path, { requireOrphaned: true });
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

function hasFormattingControls(policy: MdzipResolvedFormattingControlPolicy): boolean {
  return policy.bold
    || policy.italic
    || policy.strikethrough
    || policy.headings.length > 0
    || policy.bulletList
    || policy.orderedList
    || policy.inlineCode
    || policy.codeBlock
    || policy.blockquote
    || policy.link
    || policy.image;
}

function markdownCommandFromToolbarFormat(format: string): MdzipEditorCommand | null {
  switch (format) {
    case 'bold':
    case 'italic':
    case 'paragraph':
    case 'heading-1':
    case 'heading-2':
    case 'heading-3':
    case 'heading-4':
    case 'heading-5':
    case 'heading-6':
    case 'bullet-list':
    case 'ordered-list':
    case 'code-block':
    case 'link':
      return format;
    case 'strike':
      return 'strikethrough';
    case 'code':
      return 'inline-code';
    case 'quote':
      return 'blockquote';
    default:
      return null;
  }
}

function imageMimeTypeFromFileName(fileName: string): string {
  const extension = fileName.toLowerCase().split('.').pop();
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'png':
    default:
      return 'image/png';
  }
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (value && typeof value === 'object' && 'when' in value) {
    const when = (value as { when?: unknown }).when;
    return typeof when === 'string' && when.trim() ? when : 'Not available';
  }
  return 'Not available';
}

const SHELL_HTML = `
<section class="mdzip-root">
  <div class="document-strip" data-ref="document-strip" hidden>
    <button type="button" class="title-button" data-ref="title-btn"></button>
    <button type="button" class="document-info-button" data-ref="document-info-btn"
      title="Document information" aria-label="Document information">
      ${INFO_ICON_HTML}
    </button>
  </div>

  <header class="toolbar" data-ref="toolbar" hidden>
    <div class="toolbar-start">
      <div class="toolbar-left">
        <button type="button" class="icon-toggle nav-toggle" data-ref="nav-btn" title="Toggle contents" aria-label="Toggle contents">
          ${NAV_TOGGLE_ICON_HTML}
        </button>
      </div>

      <div class="edit-toolbar" data-ref="edit-toolbar" role="toolbar" aria-label="Markdown formatting">
        <div class="edit-toolbar-group">
          <button type="button" data-format="bold" data-format-control="bold" title="Bold" aria-label="Bold">${BOLD_ICON_HTML}</button>
          <button type="button" data-format="italic" data-format-control="italic" title="Italic" aria-label="Italic">${ITALIC_ICON_HTML}</button>
          <button type="button" data-format="strike" data-format-control="strikethrough" title="Strikethrough" aria-label="Strikethrough">${STRIKE_ICON_HTML}</button>
          <div class="format-menu" data-format-control="headings">
            <button type="button" class="format-menu-toggle" data-format-menu-toggle
              aria-label="Heading" aria-haspopup="menu" aria-expanded="false">
              ${HEADING_ICON_HTML}${CHEVRON_ICON_HTML}
            </button>
            <div class="format-menu-popover" data-format-menu role="menu" aria-label="Heading level" hidden>
              <button type="button" role="menuitem" data-format="paragraph">Paragraph</button>
              <button type="button" role="menuitem" data-format="heading-1" data-heading-level="1"><strong>H1</strong> Heading 1</button>
              <button type="button" role="menuitem" data-format="heading-2" data-heading-level="2"><strong>H2</strong> Heading 2</button>
              <button type="button" role="menuitem" data-format="heading-3" data-heading-level="3"><strong>H3</strong> Heading 3</button>
              <button type="button" role="menuitem" data-format="heading-4" data-heading-level="4"><strong>H4</strong> Heading 4</button>
              <button type="button" role="menuitem" data-format="heading-5" data-heading-level="5"><strong>H5</strong> Heading 5</button>
              <button type="button" role="menuitem" data-format="heading-6" data-heading-level="6"><strong>H6</strong> Heading 6</button>
            </div>
          </div>
        </div>
        <span class="edit-toolbar-divider" aria-hidden="true"></span>
        <div class="edit-toolbar-group">
          <button type="button" data-format="bullet-list" data-format-control="bulletList" title="Bulleted list" aria-label="Bulleted list">${BULLET_LIST_ICON_HTML}</button>
          <button type="button" data-format="ordered-list" data-format-control="orderedList" title="Numbered list" aria-label="Numbered list">${ORDERED_LIST_ICON_HTML}</button>
          <div class="format-menu" data-format-control="code">
            <button type="button" class="format-menu-toggle" data-format-menu-toggle
              aria-label="Code" aria-haspopup="menu" aria-expanded="false">
              ${CODE_ICON_HTML}${CHEVRON_ICON_HTML}
            </button>
            <div class="format-menu-popover" data-format-menu role="menu" aria-label="Code format" hidden>
              <button type="button" role="menuitem" data-format="code" data-code-kind="inline">Inline code</button>
              <button type="button" role="menuitem" data-format="code-block" data-code-kind="block">Code block</button>
            </div>
          </div>
          <button type="button" data-format="quote" data-format-control="blockquote" title="Blockquote" aria-label="Blockquote">${QUOTE_ICON_HTML}</button>
        </div>
        <span class="edit-toolbar-divider" aria-hidden="true"></span>
        <div class="edit-toolbar-group">
          <button type="button" data-format="link" data-format-control="link" title="Link" aria-label="Link">${LINK_ICON_HTML}</button>
          <button type="button" data-format="image" data-format-control="image" title="Image" aria-label="Image">${IMAGE_FORMAT_ICON_HTML}</button>
          <input type="file" data-ref="image-input" accept="image/*" hidden />
        </div>
      </div>
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
      <div class="theme-toggle-group" data-ref="theme-controls" role="group" aria-label="Color scheme">
        <button type="button" class="icon-toggle theme-toggle" data-ref="dark-theme-btn"
          title="Dark mode" aria-label="Dark mode" aria-pressed="false">
          ${DARK_THEME_ICON_HTML}
        </button>
        <button type="button" class="icon-toggle theme-toggle" data-ref="light-theme-btn"
          title="Light mode" aria-label="Light mode" aria-pressed="false">
          ${LIGHT_THEME_ICON_HTML}
        </button>
      </div>
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
      <section class="pane edit-pane" data-ref="edit-pane">
        <div class="editor-host" data-ref="editor-host"></div>
      </section>
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

  <div class="title-dialog-backdrop" data-ref="conversion-dialog" hidden
    role="dialog" aria-modal="true" aria-labelledby="mdzip-conversion-dialog-heading">
    <div class="title-dialog">
      <h3 id="mdzip-conversion-dialog-heading">Convert to MDZ?</h3>
      <p>
        Regular Markdown files contain only text. Convert this document to an
        MDZ package to add images, package navigation, and document metadata.
      </p>
      <p>The next save will produce an .mdz file.</p>
      <div class="title-dialog-actions">
        <button type="button" data-action="cancel-conversion">Cancel</button>
        <button type="button" class="save-title" data-ref="conversion-confirm-btn">Convert</button>
      </div>
    </div>
  </div>

  <div class="title-dialog-backdrop" data-ref="metadata-dialog" hidden
    role="dialog" aria-modal="true" aria-labelledby="mdzip-metadata-dialog-heading">
    <div class="title-dialog metadata-dialog">
      <h3 id="mdzip-metadata-dialog-heading">Document Information</h3>
      <dl data-ref="metadata-list"></dl>
      <div class="title-dialog-actions">
        <button type="button" class="save-title" data-action="close-metadata">Close</button>
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
