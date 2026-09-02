import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { closeSearchPanel, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  dropCursor,
  keymap,
  lineNumbers,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  ClipboardType,
  Code,
  Columns2,
  Copy,
  Eraser,
  Eye,
  File,
  FileBraces,
  FileImage,
  Folder,
  FolderOpen,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Highlighter,
  ImagePlus,
  Info,
  Italic,
  Link2Off,
  Link,
  List,
  ListOrdered,
  CornerDownLeft,
  Moon,
  PackagePlus,
  PanelLeft,
  Pilcrow,
  Quote,
  Save,
  Scissors,
  Search,
  SpellCheck,
  SquareCode,
  SquarePen,
  Strikethrough,
  Sun,
  TextSelect,
  ZoomIn
} from 'lucide';
import type { MdzWorkspace, MdzWorkspaceAsset } from '@mdzip/core-js';
import { browserClipboardHasImage, readBrowserClipboardImage } from './browser.js';
import {
  buildPackedArchiveBytes,
  isMarkdownArchivePath,
  resolveMarkdownEntryPoint
} from './archive-utils.js';
import {
  MdzipAssetSession,
  mdzipArchiveSourceId,
  sniffImageSize,
  type MdzipAssetCache
} from './asset-cache.js';
import { MD_MARKDOWN_ICON, type LucideIconNode } from './icons/md-markdown.js';
import { MDZIP_RUNTIME_LIBRARIES } from './library-info.js';
import type {
  MdzipDocumentChangeEvent,
  MdzipEditorSnapshot,
  MdzipPathType,
  MdzipRemoveAssetOptions,
  MdzipWorkspaceOpenOptions
} from './workspace.js';
import {
  MdzipWorkspaceService,
  extensionForMime,
  normalizeArchivePath,
  relativeArchivePath
} from './workspace.js';
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
import { escapeMarkdownImageAlt, findImageReferenceAtOffset, formatImageEditMarkdown } from './image-edit.js';
import {
  MdzipRenderingService,
  defaultSafeMarkdownRenderer,
  groupTokensIntoChunks,
  type MdzipEntryRenderContext,
  type MdzipEntryRenderHandle,
  type MdzipEntryRenderer,
  type MdzipMarkdownRenderContext,
  type MdzipMarkdownRenderer,
  type MdzipMarkdownRenderExtension,
  type MdzipRenderHandle,
  type Token
} from './rendering.js';
import { WORKSPACE_CSS } from './view-css.js';
import type { MdzipWorkspaceSnapshot } from './workspace.js';

const STYLE_ATTR = 'data-mdzip-ws-styles';

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff?)$/i;
const isImageFile = (path: string) => IMAGE_EXTENSIONS.test(path);

function isThenable<T>(value: T | Promise<T> | void): value is Promise<T> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}

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
const IMAGE_EDIT_AFFORDANCE_ICON_HTML = lucideIcon(SquarePen, 'mdzip-image-edit-affordance-icon');
const SOURCE_MARKDOWN_ICON_HTML = lucideIcon(Hash, TOOLBAR_ICON_CLASS);
const NAV_TOGGLE_ICON_HTML = lucideIcon(PanelLeft, `${TOOLBAR_ICON_CLASS} nav-toggle-icon`);
const CONVERT_TO_MDZ_ICON_HTML = lucideIcon(PackagePlus, `${TOOLBAR_ICON_CLASS} convert-mdz-icon`);
const PREVIEW_ICON_HTML = lucideIcon(Eye, TOOLBAR_ICON_CLASS);
const SPLIT_ICON_HTML = lucideIcon(Columns2, TOOLBAR_ICON_CLASS);
const SAVE_ICON_HTML = lucideIcon(Save, TOOLBAR_ICON_CLASS);
const SEARCH_ICON_HTML = lucideIcon(Search, TOOLBAR_ICON_CLASS);
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
const LINE_BREAK_ICON_HTML = lucideIcon(CornerDownLeft, FORMAT_ICON_CLASS);
const LINK_ICON_HTML = lucideIcon(Link, FORMAT_ICON_CLASS);
const IMAGE_FORMAT_ICON_HTML = lucideIcon(ImagePlus, FORMAT_ICON_CLASS);
const CHEVRON_ICON_HTML = lucideIcon(ChevronDown, 'format-chevron');
const INFO_ICON_HTML = lucideIcon(Info, 'document-info-icon');
const CODE_BLOCK_ICON_CLASS = 'mdzip-code-block-icon';
const CODE_BLOCK_COPY_ICON_HTML = lucideIcon(Copy, CODE_BLOCK_ICON_CLASS);
const CODE_BLOCK_COPIED_ICON_HTML = lucideIcon(Check, CODE_BLOCK_ICON_CLASS);
const CODE_BLOCK_COLLAPSE_ICON_HTML = lucideIcon(ChevronDown, CODE_BLOCK_ICON_CLASS);
// Below this, collapsing (240px / ~12 visible lines) would have no visible
// effect, so the collapse button isn't shown at all rather than appearing to
// do nothing when clicked.
const CODE_BLOCK_COLLAPSIBLE_MIN_LINES = 15;
// Blocks taller than this start collapsed; still manually expandable either way.
const CODE_BLOCK_AUTO_COLLAPSE_LINES = 25;

// Leading icons for context-menu items (Obsidian-style icon column).
const MENU_ICON_CLASS = 'nav-menu-icon';
const MENU_CUT_ICON_HTML = lucideIcon(Scissors, MENU_ICON_CLASS);
const MENU_COPY_ICON_HTML = lucideIcon(Copy, MENU_ICON_CLASS);
const MENU_PASTE_ICON_HTML = lucideIcon(ClipboardPaste, MENU_ICON_CLASS);
const MENU_PASTE_PLAIN_ICON_HTML = lucideIcon(ClipboardType, MENU_ICON_CLASS);
const MENU_SELECT_ALL_ICON_HTML = lucideIcon(TextSelect, MENU_ICON_CLASS);
const MENU_SPELLCHECK_ICON_HTML = lucideIcon(SpellCheck, MENU_ICON_CLASS);
const MENU_BOLD_ICON_HTML = lucideIcon(Bold, MENU_ICON_CLASS);
const MENU_ITALIC_ICON_HTML = lucideIcon(Italic, MENU_ICON_CLASS);
const MENU_STRIKE_ICON_HTML = lucideIcon(Strikethrough, MENU_ICON_CLASS);
const MENU_CODE_ICON_HTML = lucideIcon(Code, MENU_ICON_CLASS);
const MENU_CODE_BLOCK_ICON_HTML = lucideIcon(SquareCode, MENU_ICON_CLASS);
const MENU_HIGHLIGHT_ICON_HTML = lucideIcon(Highlighter, MENU_ICON_CLASS);
const MENU_BULLET_LIST_ICON_HTML = lucideIcon(List, MENU_ICON_CLASS);
const MENU_ORDERED_LIST_ICON_HTML = lucideIcon(ListOrdered, MENU_ICON_CLASS);
const MENU_QUOTE_ICON_HTML = lucideIcon(Quote, MENU_ICON_CLASS);
const MENU_LINE_BREAK_ICON_HTML = lucideIcon(CornerDownLeft, MENU_ICON_CLASS);
const MENU_IMAGE_ICON_HTML = lucideIcon(ImagePlus, MENU_ICON_CLASS);
const MENU_LINK_ICON_HTML = lucideIcon(Link, MENU_ICON_CLASS);
const MENU_CLEAR_FORMAT_ICON_HTML = lucideIcon(Eraser, MENU_ICON_CLASS);
const MENU_HEADING_PARENT_ICON_HTML = lucideIcon(Heading1, MENU_ICON_CLASS);
const MENU_PARAGRAPH_ICON_HTML = lucideIcon(Pilcrow, MENU_ICON_CLASS);
const MENU_CHEVRON_ICON_HTML = lucideIcon(ChevronRight, 'nav-menu-chevron');
const MENU_HEADING_ICON_HTML: Record<MdzipHeadingLevel, string> = {
  1: lucideIcon(Heading1, MENU_ICON_CLASS),
  2: lucideIcon(Heading2, MENU_ICON_CLASS),
  3: lucideIcon(Heading3, MENU_ICON_CLASS),
  4: lucideIcon(Heading4, MENU_ICON_CLASS),
  5: lucideIcon(Heading5, MENU_ICON_CLASS),
  6: lucideIcon(Heading6, MENU_ICON_CLASS)
};
const MENU_SEPARATOR_HTML = '<div class="nav-menu-separator" role="separator"></div>';
// Matches the submenu `min-width` in the CSS; used to decide left/right flyout.
const SUBMENU_ESTIMATED_WIDTH = 190;

// Curated default for the Code Block submenu — a usable subset rather than the
// full highlight.js language set. Hosts override via `codeBlockLanguages`.
export const DEFAULT_CODE_BLOCK_LANGUAGES: readonly MdzipCodeBlockLanguage[] = [
  { id: '', label: 'Plain Text' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'tsx', label: 'TSX / JSX' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'json', label: 'JSON' },
  { id: 'python', label: 'Python' },
  { id: 'csharp', label: 'C#' },
  { id: 'java', label: 'Java' },
  { id: 'cpp', label: 'C++' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'sql', label: 'SQL' },
  { id: 'bash', label: 'Shell' },
  { id: 'yaml', label: 'YAML' },
  { id: 'markdown', label: 'Markdown' }
];

// Recursively renders a context-menu item. An item carrying `submenu` becomes a
// hover/focus flyout parent (no action of its own); everything else is an
// actionable `[data-menu-action]` button handled by the shared click delegate.
function renderContextMenuItem(item: MdzipNavMenuItem): string {
  const icon = item.icon ?? '';
  const label = `<span class="nav-menu-label">${escapeHtml(item.label)}</span>`;
  if (item.submenu) {
    const children = item.submenu
      .map((child) => (child === null ? MENU_SEPARATOR_HTML : renderContextMenuItem(child)))
      .join('');
    return '<div class="nav-menu-submenu-wrap">'
      + '<button type="button" role="menuitem" aria-haspopup="true" class="nav-menu-parent">'
      + `${icon}${label}${MENU_CHEVRON_ICON_HTML}</button>`
      + `<div class="nav-context-submenu" role="menu">${children}</div></div>`;
  }
  const shortcut = item.shortcut
    ? `<span class="nav-menu-shortcut">${escapeHtml(item.shortcut)}</span>`
    : '';
  const disabledAttrs = item.disabled ? ' disabled aria-disabled="true"' : '';
  return `<button type="button" role="menuitem" data-menu-action="${escapeHtml(item.action)}"${disabledAttrs}>${icon}${label}${shortcut}</button>`;
}

function renderContextMenuItems(items: Array<MdzipNavMenuItem | null>): string {
  return items
    .map((item) => (item === null ? MENU_SEPARATOR_HTML : renderContextMenuItem(item)))
    .join('');
}

export type MdzipWorkspaceLayout = 'preview' | 'source' | 'split';
export type MdzipNavigationMode = 'editor' | 'host' | 'none';
export type MdzipColorScheme = 'light' | 'dark';
export type MdzipHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type MdzipImageHydrationAnimation = 'auto' | 'initial' | 'off';
export type MdzipImageInsertMode = 'markdown' | 'ask' | 'html';
export type MdzipImageInsertOutputMode = 'markdown' | 'html';
export type MdzipImageInsertSource = 'paste' | 'drop' | 'picker';
export type MdzipImagePosition = 'inline' | 'left' | 'center' | 'right' | 'wrap-left' | 'wrap-right';
export type MdzipToolbarDensity = 'comfortable' | 'compact' | 'dense';
export type MdzipContentDensity = 'comfortable' | 'compact';
/**
 * Preview reading-column width. A `number` is an exact pixel value; `'narrow'`
 * / `'default'` / `'wide'` are convenience aliases for common values. Unset
 * (the default) leaves the built-in CSS default in effect, which scales with
 * zoom — see {@link MdzipWorkspaceView.setPreviewMaxWidth}.
 */
export type MdzipPreviewMaxWidth = number | 'narrow' | 'default' | 'wide';

const PREVIEW_MAX_WIDTH_ALIASES: Record<'narrow' | 'default' | 'wide', number> = {
  narrow: 650,
  default: 900,
  wide: 1200,
};

function resolvePreviewMaxWidthPx(value: MdzipPreviewMaxWidth | undefined): number | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? value : PREVIEW_MAX_WIDTH_ALIASES[value];
}

export interface MdzipImageInsertRequest {
  fileName: string;
  mimeType: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  defaultAltText: string;
  source: MdzipImageInsertSource;
}

export interface MdzipImageInsertDecision {
  mode: MdzipImageInsertOutputMode;
  altText: string;
  width?: number;
  height?: number;
  position?: MdzipImagePosition;
}

export type MdzipImageInsertHandler =
  (request: MdzipImageInsertRequest) =>
    MdzipImageInsertDecision | null | undefined | Promise<MdzipImageInsertDecision | null | undefined>;

/**
 * Parsed from the image reference (Markdown or raw HTML) currently under an
 * edit-affordance click.
 */
export interface MdzipImageEditRequest {
  src: string;
  altText: string;
  width?: number;
  height?: number;
  position?: MdzipImagePosition;
  /** Which form the image is currently written in. */
  mode: MdzipImageInsertOutputMode;
}

/**
 * Host-owned async UI for editing an existing image's alt/size/position.
 * Invoked when the user clicks an existing image's edit affordance in the
 * source editor; returning `null`/`undefined` cancels, leaving the image
 * untouched. Reuses `MdzipImageInsertDecision` as its resolution shape.
 * Fully opt-in: with no `imageEditHandler` set, no affordance ever appears
 * and clicking an image does nothing — there is no built-in fallback dialog.
 */
export type MdzipImageEditHandler =
  (request: MdzipImageEditRequest) =>
    MdzipImageInsertDecision | null | undefined | Promise<MdzipImageInsertDecision | null | undefined>;

export type MdzipEditorCommand =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'highlight'
  | 'paragraph'
  | `heading-${MdzipHeadingLevel}`
  | 'bullet-list'
  | 'ordered-list'
  | 'inline-code'
  | 'code-block'
  | 'blockquote'
  | 'insert-line-break'
  | 'link'
  | 'insert-image';

export type MdzipConversionAction =
  | { kind: 'navigation' }
  | { kind: 'image-picker' }
  | { kind: 'image-file'; file: File; source?: MdzipImageInsertSource };

export interface MdzipConversionContext {
  insertMarkdown(text: string): Promise<boolean>;
  convertToMdz(): Promise<boolean>;
}

/** One file the host already collected (e.g. from a folder picker). */
export interface MdzipPackFilesInput {
  path: string;
  bytes: Uint8Array;
}

export interface MdzipPackFilesRequest {
  files: readonly MdzipPackFilesInput[];
  /** Archive-relative paths of the .md/.markdown files among `files` (length > 1 whenever this fires). */
  markdownFiles: readonly string[];
  /** Default entry point the built-in dialog preselects. */
  suggestedEntryPoint: string;
}

export interface MdzipPackFilesDecision {
  mode: 'document' | 'project';
  entryPoint: string;
}

export interface MdzipPackFilesResult {
  mode: 'document' | 'project';
  entryPoint: string;
  archiveBytes: Uint8Array;
  /** True when the view already opened the archive in memory (document mode). */
  opened: boolean;
}

export interface MdzipPackFilesContext {
  applyDecision(decision: MdzipPackFilesDecision): Promise<MdzipPackFilesResult>;
}

export interface MdzipLibraryInfo {
  name: string;
  version: string;
  repositoryUrl?: string;
  description?: string;
}

type MdzipNavMenuTarget =
  | {
      kind: 'file';
      path: string;
      orphaned: boolean;
      isMarkdown: boolean;
      isEntryPoint: boolean;
      isImage: boolean;
      isManifest: boolean;
    }
  | { kind: 'directory'; path: string };

interface MdzipNavMenuItem {
  action: string;
  label: string;
  /** Pre-rendered leading icon SVG (see `MENU_*_ICON_HTML`). */
  icon?: string;
  /**
   * Right-aligned hint text (e.g. `Ctrl+X`). Usually a bound keyboard
   * shortcut, but also used on `disabled` rows to point at browser-native
   * behavior we deliberately don't intercept (e.g. `Shift+Right-Click`).
   */
  shortcut?: string;
  /** Renders as a non-interactive row — informational, no click action. */
  disabled?: boolean;
  /** When present, the item is a flyout parent rather than an action; null entries are separators. */
  submenu?: Array<MdzipNavMenuItem | null>;
}

type MdzipNameDialogMode = 'new-file' | 'new-folder' | 'rename';

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

export interface MdzipContextMenuControlPolicy {
  enabled?: boolean;
  editor?: boolean;
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
  lineBreak?: boolean;
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
  /** Right-click context menus for the source editor and rendered preview. */
  contextMenu?: boolean | MdzipContextMenuControlPolicy;
  lineNumbers?: boolean;
  save?: boolean;
  zoom?: boolean;
  colorScheme?: boolean;
  orphanActions?: boolean;
  /** Enables nav-pane file management (create, rename, delete, move, …). */
  fileActions?: boolean;
  /** Enables the find/replace toolbar button and Mod-f shortcut. */
  search?: boolean;
  /**
   * Enables the preview's per-block code chrome: a language-name header, a
   * copy-to-clipboard button, and (on long enough blocks) a collapse/expand
   * toggle. Distinct from `formatting.codeBlock`, which gates the *editor*
   * toolbar's insert-code-block control — this gates rendering affordances
   * on already-rendered preview code blocks.
   */
  codeBlockTools?: boolean;
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

export interface MdzipResolvedContextMenuControlPolicy {
  editor: boolean;
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
  lineBreak: boolean;
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
  contextMenu: MdzipResolvedContextMenuControlPolicy;
  lineNumbers: boolean;
  save: boolean;
  zoom: boolean;
  colorScheme: boolean;
  orphanActions: boolean;
  fileActions: boolean;
  search: boolean;
  codeBlockTools: boolean;
}

export interface MdzipWorkspaceChange {
  bytes: Uint8Array;
  snapshot: MdzipWorkspaceSnapshot;
}

export interface MdzipWorkspaceSave {
  bytes: Uint8Array;
  snapshot: MdzipWorkspaceSnapshot;
}

/** One entry in the Code Block submenu. */
export interface MdzipCodeBlockLanguage {
  /** Fence info string, e.g. `'typescript'`. Empty inserts a plain block. */
  id: string;
  /** Menu label, e.g. `'TypeScript'`. */
  label: string;
}

export interface MdzipWorkspaceViewOptions {
  /**
   * Additional host or framework libraries to show in Document Information.
   * Framework wrappers populate this automatically.
   */
  libraries?: readonly MdzipLibraryInfo[];
  /** Optional persistent cache for lazily resolved archive assets. */
  assetCache?: MdzipAssetCache;
  controls?: MdzipControlPreset | MdzipControlPolicy;
  /**
   * Semantic toolbar sizing preset. Defaults to `'comfortable'`. Hosts can
   * still fine-tune with stable `--mdzip-toolbar-*` CSS custom properties.
   */
  toolbarDensity?: MdzipToolbarDensity;
  /**
   * Semantic editor/preview padding preset. Defaults to `'comfortable'`. Hosts
   * can still fine-tune with stable `--mdzip-*-content-padding` CSS variables.
   */
  contentDensity?: MdzipContentDensity;
  /**
   * Developer-facing preview reading-column width — not exposed as toolbar
   * UI. A number is an exact pixel value; `'narrow'`/`'default'`/`'wide'`
   * are convenience aliases (650/900/1200px). Unset leaves the built-in
   * default in effect, which scales with zoom; an explicit value here does
   * not (see {@link MdzipWorkspaceView.setPreviewMaxWidth}).
   */
  previewMaxWidth?: MdzipPreviewMaxWidth;
  /**
   * Opt-in: render+mount the preview in chunks near the viewport instead of
   * the whole document at once. For very large documents (e.g. a chat
   * export with thousands of message rows) this keeps first-paint cost
   * proportional to what's visible instead of the whole document's size —
   * `marked`/DOMPurify otherwise run once, synchronously, over the entire
   * rendered HTML before anything is mounted, which can block the main
   * thread for seconds on real-world large files. Defaults to `false`.
   * Only takes effect with the default marked-based renderer — a
   * host-supplied custom {@link MdzipMarkdownRenderer} has no token
   * structure to chunk by, so this option is silently ignored for it.
   */
  progressiveTextRendering?: boolean;
  /**
   * Controls the progressive preview image reveal animation. Use `'off'` in
   * live-editing hosts to prevent images from pulsing/sliding. Use `'initial'`
   * to animate the first render for a document path but snap open subsequent
   * same-document text edits. Defaults to `'auto'`.
   */
  imageHydrationAnimation?: MdzipImageHydrationAnimation;
  /**
   * Controls how inserted images become Markdown text when no host
   * `imageInsertHandler` is provided. Defaults to `'markdown'`, preserving the
   * existing no-dialog `![Pasted image](...)` behavior. Use `'ask'` for the
   * built-in Markdown/HTML sizing dialog, or `'html'` to insert a default
   * `<img>` element without prompting.
   */
  imageInsertMode?: MdzipImageInsertMode;
  /**
   * Optional host-owned async UI for image insertion. Return `null` to cancel
   * the insertion cleanly.
   */
  imageInsertHandler?: MdzipImageInsertHandler;
  /**
   * Optional host-owned async UI for editing an existing image (alt/size/
   * position), opened by clicking that image's edit affordance in the
   * source editor. Unset by default — with no handler, no affordance
   * appears at all; there is no built-in fallback dialog like
   * `imageInsertMode: 'ask'` provides for insertion.
   */
  imageEditHandler?: MdzipImageEditHandler;
  /**
   * Languages offered in the context menu's Code Block submenu. Each entry's
   * `id` becomes the fence info string (e.g. ```` ```ts ````); an empty `id`
   * inserts a plain block. Defaults to {@link DEFAULT_CODE_BLOCK_LANGUAGES}.
   */
  codeBlockLanguages?: readonly MdzipCodeBlockLanguage[];
  initialLayout?: MdzipWorkspaceLayout;
  initialColorScheme?: MdzipColorScheme;
  navigationMode?: MdzipNavigationMode;
  navigationButtonActive?: boolean;
  onChanged?: (bytes: Uint8Array, snapshot: MdzipWorkspaceSnapshot) => void;
  onSaved?: (bytes: Uint8Array, snapshot: MdzipWorkspaceSnapshot) => void;
  onWorkspaceChanged?: (event: MdzipDocumentChangeEvent) => void;
  onDocumentChanged?: (event: MdzipDocumentChangeEvent) => void;
  onAssetChanged?: (event: MdzipDocumentChangeEvent) => void;
  /**
   * Fires when a change event includes the manifest.
   *
   * Registering this callback also opts in to host-delegated manifest
   * persistence: for manifest-only events (`changes` is exactly
   * `['manifest']`), the view skips the `exportBytes()`/`onChanged` path —
   * which on a workspace opened without `archiveBytes` would rebuild the
   * whole archive and resolve every lazy document — and expects the host to
   * apply the manifest change where the real archive bytes live (e.g. via
   * `MdzArchiveCore.updateFiles(bytes, [], [], { manifest })` or
   * `updateManifestTitleInArchive`). Read the new manifest from
   * `event.snapshot.workspace.manifest`. Hosts that do not register this
   * callback keep the full `onChanged` behavior for manifest edits.
   */
  onManifestChanged?: (event: MdzipDocumentChangeEvent) => void;
  onSnapshotChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onSelectionChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onDirtyChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onValidationChanged?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onColorSchemeChanged?: (colorScheme: MdzipColorScheme) => void;
  /**
   * Fires when the preview HTML for the current selection has been mounted
   * into the DOM (image `src`s already resolved to their session URLs).
   * Lets hosts reveal or animate preview content without observing private
   * editor DOM or guessing at timing. Not fired when an entry renderer
   * claims the pane or when the active path has no preview.
   */
  onPreviewRendered?: (snapshot: MdzipWorkspaceSnapshot) => void;
  /**
   * Fires after {@link onPreviewRendered} once every `<img>` in the mounted
   * preview has finished loading (or errored) — i.e. the preview and its
   * images are visually ready. Fires immediately after render when the
   * preview contains no images. See also {@link MdzipWorkspaceView.whenRendered}.
   */
  onAssetsHydrated?: (snapshot: MdzipWorkspaceSnapshot) => void;
  onFailed?: (error: unknown) => void;
  /**
   * Lets the host take over the markdown→MDZ conversion flow (triggered by the
   * nav button, the Insert Image control, or an image paste on a plain `.md`
   * source). Return or resolve `true` to suppress the built-in conversion
   * dialog — the host owns the flow from there. Return `false` (or omit the
   * callback) to keep the built-in dialog. If the callback throws or rejects,
   * the error is reported via `onFailed` and the built-in dialog is shown.
   */
  onConversionRequested?: (
    action: MdzipConversionAction,
    context: MdzipConversionContext
  ) => boolean | Promise<boolean>;
  /**
   * Lets the host take over the folder→.mdz packing decision (Document vs.
   * Project mode and entry-point choice) surfaced by
   * {@link MdzipWorkspaceView.packFilesAsWorkspace} when the collected files
   * contain more than one Markdown file. Resolve `true` to suppress the
   * built-in dialog — the host owns the flow and performs the pack itself via
   * `context.applyDecision(...)`. Resolve `false` (or omit) to keep the
   * built-in dialog. If the callback throws or rejects, the error is reported
   * via `onFailed` and the built-in dialog is shown. Not consulted for the
   * zero/one-Markdown fast path, which always packs Document mode immediately.
   */
  onPackRequested?: (
    request: MdzipPackFilesRequest,
    context: MdzipPackFilesContext
  ) => boolean | Promise<boolean>;
  /**
   * Replaces the default markdown renderer. Output is sanitized by the
   * pipeline unless the renderer declares `sanitizesOutput`. May render
   * asynchronously; stale results are dropped when the selection moves on.
   */
  markdownRenderer?: MdzipMarkdownRenderer;
  /**
   * Composable extensions over the markdown pipeline (transformMarkdown,
   * transformHtml, mount). Sanitization stays in the pipeline.
   */
  markdownExtensions?: readonly MdzipMarkdownRenderExtension[];
  /**
   * Entry renderers that can claim the full pane stack for selected archive
   * entries. First match by descending priority wins; built-in rendering is
   * the fallback. Handles are destroyed on selection change and destroy().
   */
  entryRenderers?: readonly MdzipEntryRenderer[];
}

/** Options accepted by {@link MdzipWorkspaceView.setRenderingOptions}. */
export interface MdzipRenderingOptions {
  /** Pass `null` to restore the default renderer. */
  markdownRenderer?: MdzipMarkdownRenderer | null;
  markdownExtensions?: readonly MdzipMarkdownRenderExtension[];
  entryRenderers?: readonly MdzipEntryRenderer[];
}

const ALL_HEADINGS: MdzipHeadingLevel[] = [1, 2, 3, 4, 5, 6];
const ALL_LAYOUT_CONTROLS: MdzipResolvedLayoutControlPolicy = {
  source: true,
  split: true,
  preview: true
};
const ALL_CONTEXT_MENU_CONTROLS: MdzipResolvedContextMenuControlPolicy = {
  editor: true,
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
  lineBreak: true,
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
  lineBreak: false,
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
    contextMenu: { ...ALL_CONTEXT_MENU_CONTROLS },
    lineNumbers: false,
    save: false,
    zoom: false,
    colorScheme: false,
    orphanActions: false,
    fileActions: false,
    search: false,
    codeBlockTools: true
  },
  viewer: {
    preset: 'viewer',
    toolbar: true,
    navigation: true,
    title: { visible: true, editable: false },
    layout: { ...ALL_LAYOUT_CONTROLS },
    formatting: { ...NO_FORMATTING_CONTROLS },
    contextMenu: { ...ALL_CONTEXT_MENU_CONTROLS },
    lineNumbers: true,
    save: false,
    zoom: true,
    colorScheme: true,
    orphanActions: false,
    fileActions: false,
    search: true,
    codeBlockTools: true
  },
  'standalone-editor': {
    preset: 'standalone-editor',
    toolbar: true,
    navigation: true,
    title: { visible: true, editable: true },
    layout: { ...ALL_LAYOUT_CONTROLS },
    formatting: { ...ALL_FORMATTING_CONTROLS },
    contextMenu: { ...ALL_CONTEXT_MENU_CONTROLS },
    lineNumbers: true,
    save: true,
    zoom: true,
    colorScheme: true,
    orphanActions: true,
    fileActions: true,
    search: true,
    codeBlockTools: true
  },
  'hosted-editor': {
    preset: 'hosted-editor',
    toolbar: true,
    navigation: true,
    title: { visible: true, editable: true },
    layout: { ...ALL_LAYOUT_CONTROLS },
    formatting: { ...ALL_FORMATTING_CONTROLS },
    contextMenu: { ...ALL_CONTEXT_MENU_CONTROLS },
    lineNumbers: true,
    save: false,
    zoom: true,
    colorScheme: true,
    orphanActions: true,
    fileActions: true,
    search: true,
    codeBlockTools: true
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
    formatting: resolveFormattingControls(base.formatting, controls.formatting),
    contextMenu: resolveContextMenuControls(base.contextMenu, controls.contextMenu)
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
    },
    contextMenu: { ...policy.contextMenu }
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

function resolveContextMenuControls(
  base: MdzipResolvedContextMenuControlPolicy,
  override: boolean | MdzipContextMenuControlPolicy | undefined
): MdzipResolvedContextMenuControlPolicy {
  if (typeof override === 'boolean') {
    return { editor: override, preview: override };
  }
  if (!override) {
    return { ...base };
  }
  const { enabled, ...controls } = override;
  const resolvedBase = enabled === false
    ? { editor: false, preview: false }
    : enabled === true
      ? { ...ALL_CONTEXT_MENU_CONTROLS }
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

function normalizeToolbarDensity(value: MdzipToolbarDensity | undefined): MdzipToolbarDensity {
  return value === 'compact' || value === 'dense' ? value : 'comfortable';
}

function normalizeContentDensity(value: MdzipContentDensity | undefined): MdzipContentDensity {
  return value === 'compact' ? value : 'comfortable';
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
    padding: 'var(--mdzip-editor-content-padding, var(--mdzip-density-editor-content-padding, 36px 48px 36px 16px))',
    caretColor: 'var(--mdzip-editor-cursor-color)',
    overflowWrap: 'anywhere',
    wordBreak: 'normal',
  },
  '.cm-gutters': {
    background: 'transparent',
    border: 'none',
    color: 'var(--mdzip-line-number-foreground-color)',
    fontFamily: '"Cascadia Code", Consolas, monospace',
    fontSize: '0.85em',
    // CodeMirror force-sets each gutter element's height to match its
    // content line's rendered height, but a unitless/inherited line-height
    // resolves against the gutter's own (smaller) font-size — leaving the
    // number shorter than its box and rendering top-aligned instead of
    // matching the content line's baseline. Pin it to the same absolute
    // line-height as the content (fontSize '&' * the '.cm-scroller' 1.5
    // multiplier) so both sit centered in equal-height boxes.
    lineHeight: 'calc(16px * var(--mdz-zoom, 1) * 1.5)',
    opacity: '0.65',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 4px',
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
  '.mdzip-hard-break-marker': {
    color: 'var(--mdzip-muted-foreground-color)',
    opacity: '0.65',
  },
  '.mdzip-image-edit-affordance': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    marginLeft: '2px',
    padding: '0',
    verticalAlign: 'middle',
    border: 'none',
    borderRadius: '4px',
    background: 'var(--mdzip-widget-background-color)',
    color: 'var(--mdzip-muted-foreground-color)',
    cursor: 'pointer',
  },
  '.mdzip-image-edit-affordance:hover': {
    background: 'var(--mdzip-control-hover-background-color)',
    color: 'var(--mdzip-control-foreground-color)',
  },
  '.mdzip-image-edit-affordance-icon': {
    width: '13px',
    height: '13px',
  },
  '.cm-panels': {
    background: 'var(--mdzip-widget-background-color)',
    color: 'var(--mdzip-editor-foreground-color)',
    zIndex: '2',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--mdzip-border-color)',
  },
  '.cm-search': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    fontSize: '13px',
  },
  // CodeMirror separates the find and replace rows with a bare <br>; in a
  // flex container that collapses to zero width instead of breaking the
  // line, so force it to take the full row.
  '.cm-search br': {
    flexBasis: '100%',
    height: '0',
  },
  '.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    color: 'var(--mdzip-muted-foreground-color)',
  },
  '.cm-search input[type="checkbox"]': {
    width: '14px',
    height: '14px',
    accentColor: 'var(--mdzip-accent-color)',
  },
  '.cm-textfield': {
    background: 'var(--mdzip-editor-background-color)',
    color: 'var(--mdzip-editor-foreground-color)',
    border: '1px solid var(--mdzip-border-color)',
    borderRadius: '5px',
    padding: '5px 9px',
    fontSize: 'inherit',
    width: '220px',
  },
  '.cm-textfield:focus-visible': {
    outline: '1px solid var(--mdzip-focus-outline-color)',
    outlineOffset: '-1px',
  },
  '.cm-button': {
    background: 'var(--mdzip-widget-background-color)',
    backgroundImage: 'none',
    color: 'var(--mdzip-control-foreground-color)',
    border: '1px solid var(--mdzip-border-color)',
    borderRadius: '5px',
    padding: '5px 12px',
    fontSize: 'inherit',
    cursor: 'pointer',
  },
  '.cm-button:hover': {
    background: 'var(--mdzip-control-hover-background-color)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(255, 214, 0, 0.35)',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'var(--mdzip-accent-color)',
    color: 'var(--mdzip-accent-foreground-color)',
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
  { tag: tags.url, color: '#6e7781' },
  { tag: tags.monospace, color: '#8a8f00' },
  { tag: tags.quote, color: '#7a5c00' },
  { tag: tags.contentSeparator, color: '#6a9955' },
  { tag: tags.atom, color: '#d100d1' },
]);

const hardBreakMarkerMatcher = new MatchDecorator({
  regexp: /<br\s*\/?>/gi,
  decoration: Decoration.mark({ class: 'mdzip-hard-break-marker' })
});

const hardBreakMarkerHighlight = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = hardBreakMarkerMatcher.createDeco(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = hardBreakMarkerMatcher.updateDeco(update, this.decorations);
    }
  }
}, {
  decorations: value => value.decorations
});

// Matches raw HTML tags other than <br> (which hardBreakMarkerMatcher already
// covers) so authors can visually distinguish raw HTML from Markdown prose.
// Excludes autolinks like <https://example.com> — those have no space before
// '>' and no closing '/', so the tag-name-only branch requires the char after
// the name to be '>' directly, which a URL's ':' never satisfies.
const htmlTagMarkerMatcher = new MatchDecorator({
  regexp: /<\/?(?!br\b)[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/gi,
  // spellcheck="false" on the wrapping span opts this range out of the
  // container-wide spellcheck attribute — tag/attribute names (img, src,
  // align, citation, ...) aren't prose and shouldn't get underlined.
  decoration: Decoration.mark({ class: 'mdzip-hard-break-marker', attributes: { spellcheck: 'false' } })
});

const htmlTagMarkerHighlight = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = htmlTagMarkerMatcher.createDeco(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = htmlTagMarkerMatcher.updateDeco(update, this.decorations);
    }
  }
}, {
  decorations: value => value.decorations
});

// Fenced/indented code blocks, inline code spans, and link/image URLs aren't
// prose — the browser's spellchecker has no dictionary for shell syntax or
// filenames, so it just underlines everything. Syntax-tree node ranges (not
// a MatchDecorator regexp) are required here because MatchDecorator only
// matches within a single line, and fenced code blocks span many.
const NO_SPELLCHECK_NODE_NAMES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'URL']);
const noSpellcheckMark = Decoration.mark({ attributes: { spellcheck: 'false' } });

function buildNoSpellcheckDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (NO_SPELLCHECK_NODE_NAMES.has(node.name)) {
          builder.add(node.from, node.to, noSpellcheckMark);
          return false;
        }
        return true;
      }
    });
  }
  return builder.finish();
}

const noSpellcheckHighlight = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildNoSpellcheckDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
      this.decorations = buildNoSpellcheckDecorations(update.view);
    }
  }
}, {
  decorations: value => value.decorations
});

// Click-to-edit affordance for existing image references. Populated
// on-click (not continuously, since the trigger is click not hover) via a
// StateEffect dispatched from the editor's `click` domEventHandler in
// createCmEditor. Fully inert unless a host imageEditHandler is set — see
// that click handler's own gate.
const IMAGE_EDIT_AFFORDANCE_CLICK_EVENT = 'mdzip-image-edit-affordance-click';

const imageEditAffordanceEffect = StateEffect.define<{ from: number; to: number } | null>();

class ImageEditAffordanceWidget extends WidgetType {
  constructor(readonly from: number, readonly to: number) {
    super();
  }

  eq(other: ImageEditAffordanceWidget): boolean {
    return other.from === this.from && other.to === this.to;
  }

  toDOM(): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mdzip-image-edit-affordance';
    btn.setAttribute('aria-label', 'Edit image');
    btn.setAttribute('data-mdzip-image-edit-affordance', '');
    btn.innerHTML = IMAGE_EDIT_AFFORDANCE_ICON_HTML;
    // Buttons are natively focusable; without this, clicking one moves DOM
    // focus onto it and blurs the CodeMirror content — which would clear
    // (and remove from the DOM) this very widget via the blur handler below
    // before its own click event has a chance to fire.
    btn.addEventListener('mousedown', (event) => event.preventDefault());
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      btn.dispatchEvent(new CustomEvent(IMAGE_EDIT_AFFORDANCE_CLICK_EVENT, {
        bubbles: true,
        detail: { from: this.from, to: this.to }
      }));
    });
    return btn;
  }
}

function imageEditAffordanceDeco(from: number, to: number): DecorationSet {
  return Decoration.set([Decoration.widget({ widget: new ImageEditAffordanceWidget(from, to), side: 1 }).range(to)]);
}

const imageEditAffordanceField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    if (tr.docChanged) {
      value = Decoration.none;
    }
    for (const effect of tr.effects) {
      if (effect.is(imageEditAffordanceEffect)) {
        value = effect.value ? imageEditAffordanceDeco(effect.value.from, effect.value.to) : Decoration.none;
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field)
});

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

interface NavRenderOptions {
  allowOrphanActions: boolean;
  allowFileActions: boolean;
  /**
   * Files are draggable whenever the workspace is editable — dropping on the
   * editor inserts a markdown link, which only needs edit access, not
   * `fileActions`. Tree-internal moves are still gated by `fileActions` at
   * drop time.
   */
  allowDrag: boolean;
  pendingFolders: ReadonlySet<string>;
}

// Renders the per-row indent/guide cells: one fixed-width cell per ancestor
// depth. An ancestor column draws a continuous vertical rail when that folder
// still has siblings below it (so the spine keeps going), otherwise it is
// blank. The final cell connects to this row with an elbow (└, last child) or a
// tee (├). Painting per row at the row's own height means the guides never
// overshoot an expanded last subfolder the way a single container rail did.
function renderNavGuides(trail: readonly boolean[], isLast: boolean): string {
  const cells = trail.map(
    (continues) => `<span class="nav-indent${continues ? ' nav-indent-rail' : ''}"></span>`
  );
  cells.push(
    `<span class="nav-indent nav-indent-connector${isLast ? '' : ' nav-indent-continues'}"></span>`
  );
  return cells.join('');
}

function renderNavNode(
  node: MdzipNavNode,
  state: MdzipWorkspaceSnapshot,
  options: NavRenderOptions,
  // Per-ancestor flags: whether each ancestor column still has a sibling below
  // it (so its rail continues through this row). One entry per guide column
  // above the immediate connector.
  trail: readonly boolean[] = [],
  // Whether this node is the last among its siblings (elbow vs tee connector).
  isLast = true,
  // Nesting depth; depth 0 (root entries) draws no guides.
  depth = 0
): string {
  const guides = depth === 0 ? '' : renderNavGuides(trail, isLast);
  if (node.entry) {
    const isCurrent = node.entry.path === state.currentPath;
    const isOrphaned = isOrphanedMdzipAsset(node.entry, state);
    const isEntryPoint = node.entry.path === state.content.entryPoint;
    const isManifest = isMdzipManifestPath(node.entry.path);
    const iconKind = mdzipEntryIconKind(node.entry);
    const safePath = escapeHtml(node.entry.path);
    const safeName = escapeHtml(node.name);
    const title = isOrphaned
      ? `${safePath} - not referenced by the entry markdown`
      : isEntryPoint
      ? `${safePath} — entry point`
      : safePath;
    const classes = [
      'nav-file',
      isCurrent ? 'current-entry' : '',
      isOrphaned ? 'orphaned-asset' : '',
      isEntryPoint ? 'entry-point' : ''
    ].filter(Boolean).join(' ');
    const iconHtml = node.entry.isMarkdown
      ? MARKDOWN_ICON_HTML
      : isManifest
      ? MANIFEST_ICON_HTML
      : isImageFile(node.entry.path)
      ? IMAGE_ICON_HTML
      : FILE_ICON_HTML;
    const orphanBtnHtml = isOrphaned && options.allowOrphanActions ? `
      <span class="nav-orphan-button" role="button" tabindex="0"
        title="Orphaned asset" aria-label="Orphaned asset actions"
        data-orphan-path="${safePath}">
        ${ORPHAN_ICON_HTML}
      </span>` : '';
    const draggable = options.allowDrag && !isManifest;
    return `<button type="button" class="${classes}" title="${title}"
      data-nav-path="${safePath}" data-orphan="${isOrphaned ? 'true' : ''}"${draggable ? ' draggable="true"' : ''}>
      ${guides}<span class="nav-caret"></span>
      <span class="nav-file-icon ${iconKind}">${iconHtml}</span>
      ${orphanBtnHtml}
      <span class="nav-label">${safeName}</span>
    </button>`;
  }
  const childTrail = depth === 0 ? [] : [...trail, !isLast];
  const children = node.children
    .map((child, index) =>
      renderNavNode(child, state, options, childTrail, index === node.children.length - 1, depth + 1))
    .join('');
  const pending = options.pendingFolders.has(node.path.toLowerCase());
  return `<details class="nav-directory${pending ? ' pending-folder' : ''}" open data-nav-dir="${escapeHtml(node.path)}">
    <summary${pending ? ` title="${escapeHtml(node.path)} — not saved until it contains a file"` : ''}>
      ${guides}<span class="nav-caret" aria-hidden="true"></span>
      <span class="nav-folder-icon closed">${FOLDER_CLOSED_ICON_HTML}</span>
      <span class="nav-folder-icon open">${FOLDER_OPEN_ICON_HTML}</span>
      <span class="nav-label">${escapeHtml(node.name)}</span>
    </summary>
    <div class="nav-directory-children">${children}</div>
  </details>`;
}

// Inserts view-local pending (not yet saved) folders into the nav tree so they
// can be browsed and targeted before any file exists inside them.
function mergePendingFolders(nodes: MdzipNavNode[], pendingPaths: ReadonlySet<string>): MdzipNavNode[] {
  if (pendingPaths.size === 0) {
    return nodes;
  }
  const result = nodes.map(cloneNavNode);
  for (const path of pendingPaths) {
    let children = result;
    let prefix = '';
    for (const segment of path.split('/').filter(Boolean)) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let dir = children.find((n) => !n.entry && n.path.toLowerCase() === prefix.toLowerCase());
      if (!dir) {
        dir = { name: segment, path: prefix, children: [] };
        children.push(dir);
        children.sort(navNodeOrder);
      }
      children = dir.children;
    }
  }
  return result;
}

function cloneNavNode(node: MdzipNavNode): MdzipNavNode {
  return { ...node, children: node.children.map(cloneNavNode) };
}

function navNodeOrder(a: MdzipNavNode, b: MdzipNavNode): number {
  if (a.entry && !b.entry) return -1;
  if (!a.entry && b.entry) return 1;
  return a.name.localeCompare(b.name);
}

interface MdzipPreviewMemo {
  path: string;
  pathType: MdzipPathType;
  text: string;
  colorScheme: MdzipColorScheme;
}

// Browsers apply raw HTML width/height attributes as presentational sizing
// hints, but the preview's `img { height: auto }` rule (for responsive
// scaling) overrides that hint via the normal CSS cascade — so an author's
// `<img height="300">` was silently ignored. Re-applying numeric, unitless
// width/height attributes as inline pixel styles restores that sizing
// without touching an author-supplied inline style.
function applyRawHtmlImageSizeAttributes(image: HTMLImageElement): void {
  const width = image.getAttribute('width');
  if (width && /^\d+$/.test(width) && !image.style.width) {
    image.style.width = `calc(${width}px * var(--mdz-zoom, 1))`;
  }
  const height = image.getAttribute('height');
  if (height && /^\d+$/.test(height) && !image.style.height) {
    image.style.height = `calc(${height}px * var(--mdz-zoom, 1))`;
  }
}

// Maps the legacy raw HTML `align="left"|"right"` attribute (or the editor's
// own wrap classes) to a layout direction, for images that skip archive
// hydration — external, data, and fragment sources — and so never get a slot.
function rawHtmlImageAlignClass(image: HTMLImageElement): 'mdzip-image-left' | 'mdzip-image-right' | null {
  const align = image.getAttribute('align')?.toLowerCase();
  if (align === 'left' || image.classList.contains('mdzip-image-wrap-left')) {
    return 'mdzip-image-left';
  }
  if (align === 'right' || image.classList.contains('mdzip-image-wrap-right')) {
    return 'mdzip-image-right';
  }
  return null;
}

export class MdzipWorkspaceView {
  private workspace: MdzipWorkspaceService | null = null;
  private assetSession: MdzipAssetSession | null = null;
  private unsub: (() => void) | null = null;
  private readonly options: MdzipWorkspaceViewOptions;
  private controlPolicy: MdzipResolvedControlPolicy;
  private readonly navigationMode: MdzipNavigationMode;
  private imageHydrationAnimation: MdzipImageHydrationAnimation;
  private readonly progressiveTextRendering: boolean;
  private toolbarDensity: MdzipToolbarDensity;
  private contentDensity: MdzipContentDensity;
  private previewMaxWidth: MdzipPreviewMaxWidth | undefined;

  private layout: MdzipWorkspaceLayout = 'split';
  private navVisible = true;
  private zoom = 1;
  private zoomOpen = false;
  private colorScheme: MdzipColorScheme;
  private titleDialogOpen = false;
  private metadataDialogOpen = false;
  private titleDraft = '';
  private conversionAction: MdzipConversionAction | null = null;
  private imageInsertDialogState: {
    request: MdzipImageInsertRequest;
    resolve: (decision: MdzipImageInsertDecision | null) => void;
  } | null = null;
  // Promise-based, like imageInsertDialogState — packFilesAsWorkspace is an
  // explicit awaited call building a brand-new archive from an
  // already-captured file list, so (unlike conversionAction's fire-and-forget
  // trigger) there's no "currently open document" to race against and no
  // de-dupe/staleness guard is needed.
  private packFilesDialogState: {
    request: MdzipPackFilesRequest;
    files: readonly MdzipPackFilesInput[];
    resolve: (decision: MdzipPackFilesDecision | null) => void;
  } | null = null;
  // Tracks an in-progress progressive (chunked) preview render so Copy All
  // can force-drain whatever's left unmounted. `cursor` is how many of
  // `chunks` are mounted so far; null once everything's mounted (or when
  // progressive rendering isn't active at all) — that's Copy All's signal
  // to skip the dialog and copy instantly. `sentinelHandle` is the
  // scroll-driven continuation's IntersectionObserver, if one is currently
  // armed; Copy All tears it down before manually draining so the two don't
  // race and double-mount the same chunk.
  private chunkedRenderState: {
    chunks: readonly Token[][];
    cursor: number;
    context: MdzipMarkdownRenderContext;
    generation: number;
    animateImageHydration: boolean;
    sentinelHandle: MdzipRenderHandle | null;
  } | null = null;
  // Per-generation memo of renderChunk's raw HTML output, keyed by chunk
  // index, shared between the DOM-mount path (renderAndMountChunkBatch) and
  // Copy All with Images (renderFullDocumentHtml) so whichever renders a
  // given chunk first is the only one that pays for it. A chunk's HTML is
  // written at most once per generation, never recomputed-and-compared: the
  // shipped mermaid extension mints each diagram's SVG id from a counter
  // that lives on the extension instance for the view's whole lifetime, so
  // re-rendering the same chunk twice yields different-but-valid output —
  // only a genuine write-once cache is safe to share across call sites.
  // Deliberately a separate field from chunkedRenderState (not nested in
  // it): that becomes null as soon as every chunk is mounted, but this
  // needs to stay alive for the whole generation, including after mounting
  // finishes — an idle, fully-mounted document is exactly when Copy All
  // should get full reuse.
  private chunkHtmlCache: { generation: number; html: Map<number, string> } | null = null;
  // Promise-based like packFilesDialogState, but there's no caller awaiting
  // a decision here — `abort` is Copy All's own cancellation switch, wired
  // to the dialog's Cancel button. `label` distinguishes Copy All's single
  // "Rendering the full document" phase from Copy All with Images' two
  // phases ("Rendering the document" then "Embedding images").
  private copyRenderDialogState: { done: number; total: number; label: string; abort: AbortController } | null = null;
  // Third state sharing the same dialog element as copyRenderDialogState
  // (all three are mutually exclusive) — set once rendering/embedding
  // finishes for a copy that showed the progress dialog. The clipboard
  // write itself is deliberately *not* fired automatically: the async
  // Clipboard API requires a recent user gesture, and by the time a
  // multi-second (sometimes multi-minute) prepare phase finishes, the
  // gesture that triggered Copy All has expired — Chrome rejects the write
  // with "blocked due to lack of user activation". Waiting for the user to
  // click the dialog's own Copy button gives the write a fresh gesture to
  // run inside. `perform` does the actual write when that happens.
  private copyReadyState: { perform: () => Promise<{ message: string } | { error: string } | null> } | null = null;
  // Set once a copy that showed the progress dialog finishes (a rejection
  // included — see `copyReadyState` above for why that write happens from
  // a button click, not automatically), so the completion message stays up
  // until the user dismisses it, rather than a fleeting toast easy to miss
  // after a long wait.
  private copyRenderDoneState: { message: string } | null = null;
  private navPaneWidth = 280;
  private splitRatio = 0.5;
  private resizing = false;
  // Shared overlay menu state. One menu is open at a time, so a single field
  // drives both the nav-pane file menu and the editor selection menu; `kind`
  // selects which item-builder and action-handler run. The editor variant
  // captures the selection range at open time because clicking a menu item can
  // move focus/selection before the action reads it.
  private contextMenuState:
    | { kind: 'nav'; target: MdzipNavMenuTarget; x: number; y: number }
    | { kind: 'editor'; from: number; to: number; x: number; y: number }
    | { kind: 'preview'; text: string; x: number; y: number }
    | null = null;
  private nameDialogState: {
    mode: MdzipNameDialogMode;
    dir: string;
    oldPath: string;
    value: string;
    error: string;
  } | null = null;
  private deleteDialogState: { path: string } | null = null;
  private readonly pendingNewFolders = new Set<string>();
  private pendingReplacePath: string | null = null;
  private conversionHookPending = false;
  private conversionDocumentGeneration = 0;
  // Monotonic token bumped on every openArchive/openWorkspace call. The async
  // parse for a superseded call must not win the race and overwrite the latest
  // input, so each call captures its token and discards its result once a newer
  // open has started.
  private openGeneration = 0;
  private dragSourcePath: string | null = null;
  private dragOverElement: HTMLElement | null = null;
  private tooltipState: { text: string; x: number; y: number } | null = null;
  private tooltipShowTimer: ReturnType<typeof setTimeout> | null = null;
  private tooltipHideTimer: ReturnType<typeof setTimeout> | null = null;
  private copyToastHideTimer: ReturnType<typeof setTimeout> | null = null;
  // Not readonly: tests override these to keep the "clipboard write hangs
  // forever" case fast rather than actually waiting out the real production
  // timeouts.
  private clipboardWriteTimeoutMs = 30000;
  private clipboardFallbackWriteTimeoutMs = 15000;

  private cmEditor: EditorView | null = null;
  private readonly readOnlyCompartment = new Compartment();
  private readonly lineNumbersCompartment = new Compartment();
  private readonly searchCompartment = new Compartment();
  private updatingCm = false;
  private syncing = false;
  // Last value this class itself wrote to each pane's scrollTop, used to
  // recognize and ignore the echoed 'scroll' event that write produces (see
  // syncScrollFromPreview/syncScrollToPreview).
  private lastSyncedEditorScrollTop: number | null = null;
  private lastSyncedPreviewScrollTop: number | null = null;
  // Guards syncScrollToPreviewBottom against overlapping drains: set to the
  // chunkedRenderState generation currently being force-drained, null when
  // none is in flight. A second bottom-edge sync that arrives mid-drain
  // (e.g. repeated wheel events once the editor is already pinned at max
  // scrollTop) just no-ops — the in-flight call already owns finishing the
  // job for that generation.
  private bottomDrainGeneration: number | null = null;
  // Non-null while the scroll-to-bottom catch-up toast is showing (past its
  // debounce) — see syncScrollToPreviewBottom.
  private scrollCatchUpState: { done: number; total: number } | null = null;

  private markdownRenderer?: MdzipMarkdownRenderer;
  private markdownExtensions: readonly MdzipMarkdownRenderExtension[] = [];
  private entryRenderers: readonly MdzipEntryRenderer[] = [];
  private renderingService = new MdzipRenderingService();
  // Preview render memo: the preview pipeline only re-runs when one of these
  // inputs actually changed, so unrelated snapshot renders (dialogs, nav,
  // layout toggles) never reset preview DOM or re-run extension mounts.
  private previewMemo: MdzipPreviewMemo | null = null;
  private previewGeneration = 0;
  private previewAbort: AbortController | null = null;
  private previewHandles: MdzipRenderHandle[] = [];
  // Whether the latest preview generation has finished mounting and hydrating
  // its images; drives `whenRendered()` and gates the hydration callback.
  private previewHydrated = false;
  private renderedWaiters: Array<() => void> = [];
  private entryState: {
    key: string;
    renderer: MdzipEntryRenderer;
    handle: MdzipEntryRenderHandle | null;
    abort: AbortController;
    lastColorScheme: MdzipColorScheme;
    lastManifest: unknown;
  } | null = null;
  // Negative match cache: with only non-matching renderers registered,
  // matches() does not re-run on every snapshot render of the same entry.
  private entryMatchMissKey: string | null = null;
  private entryGeneration = 0;

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
  private readonly elSearchBtn: HTMLButtonElement;
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
  private readonly elEntryPane: HTMLElement;
  private readonly elTitleDialog: HTMLElement;
  private readonly elTitleInput: HTMLInputElement;
  private readonly elTitleValidation: HTMLElement;
  private readonly elTitleSaveBtn: HTMLButtonElement;
  private readonly elTitleResetBtn: HTMLButtonElement;
  private readonly elMetadataDialog: HTMLElement;
  private readonly elMetadataList: HTMLElement;
  private readonly elLibraryList: HTMLElement;
  private readonly elConversionDialog: HTMLElement;
  private readonly elConversionConfirmBtn: HTMLButtonElement;
  private readonly elImageInsertDialog: HTMLElement;
  private readonly elImageInsertModeMarkdown: HTMLInputElement;
  private readonly elImageInsertModeHtml: HTMLInputElement;
  private readonly elImageInsertAltInput: HTMLInputElement;
  private readonly elImageInsertSizeModeSelect: HTMLSelectElement;
  private readonly elImageInsertSizeValueInput: HTMLInputElement;
  private readonly elImageInsertPositionSelect: HTMLSelectElement;
  private readonly elImageInsertConfirmBtn: HTMLButtonElement;
  private readonly elPackFilesDialog: HTMLElement;
  private readonly elPackFilesModeDocument: HTMLInputElement;
  private readonly elPackFilesModeProject: HTMLInputElement;
  private readonly elPackFilesEntrySelect: HTMLSelectElement;
  private readonly elPackFilesConfirmBtn: HTMLButtonElement;
  private readonly elCopyRenderDialog: HTMLElement;
  private readonly elCopyRenderHeading: HTMLElement;
  private readonly elCopyRenderProgressSection: HTMLElement;
  private readonly elCopyRenderProgressBar: HTMLElement;
  private readonly elCopyRenderProgressText: HTMLElement;
  private readonly elCopyRenderReadyText: HTMLElement;
  private readonly elCopyRenderDoneText: HTMLElement;
  private readonly elCopyRenderCancelBtn: HTMLButtonElement;
  private readonly elCopyRenderReadyCancelBtn: HTMLButtonElement;
  private readonly elCopyRenderConfirmBtn: HTMLButtonElement;
  private readonly elCopyRenderDismissBtn: HTMLButtonElement;
  private readonly elNavMenu: HTMLElement;
  private readonly elNameDialog: HTMLElement;
  private readonly elNameDialogHeading: HTMLElement;
  private readonly elNameInput: HTMLInputElement;
  private readonly elNameValidation: HTMLElement;
  private readonly elNameConfirmBtn: HTMLButtonElement;
  private readonly elDeleteDialog: HTMLElement;
  private readonly elDeleteDialogText: HTMLElement;
  private readonly elDeleteConfirmBtn: HTMLButtonElement;
  private readonly elReplaceInput: HTMLInputElement;
  private readonly elTooltip: HTMLElement;
  private readonly elCopyToast: HTMLElement;
  private readonly elEmptyState: HTMLElement;

  public constructor(container: HTMLElement, options: MdzipWorkspaceViewOptions = {}) {
    this.options = options;
    this.controlPolicy = resolveMdzipControlPolicy(options.controls);
    this.navigationMode = options.navigationMode ?? 'editor';
    this.imageHydrationAnimation = options.imageHydrationAnimation ?? 'auto';
    this.progressiveTextRendering = options.progressiveTextRendering ?? false;
    this.toolbarDensity = options.toolbarDensity ?? 'comfortable';
    this.contentDensity = options.contentDensity ?? 'comfortable';
    this.previewMaxWidth = options.previewMaxWidth;
    this.layout = options.initialLayout ?? defaultLayoutForPolicy(this.controlPolicy);
    this.colorScheme = options.initialColorScheme
      ?? (container.ownerDocument.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light');
    this.navVisible = options.navigationButtonActive ?? this.navVisible;
    this.markdownRenderer = options.markdownRenderer;
    this.markdownExtensions = options.markdownExtensions ?? [];
    this.entryRenderers = options.entryRenderers ?? [];
    this.renderingService = new MdzipRenderingService(
      this.markdownRenderer ?? defaultSafeMarkdownRenderer,
      this.markdownExtensions
    );
    injectStyles(container.ownerDocument);
    container.replaceChildren();
    container.innerHTML = SHELL_HTML;

    const q = <T extends HTMLElement>(sel: string): T =>
      container.querySelector<T>(sel) as T;

    this.elRoot = q('.mdzip-root');
    this.applyDensityClasses();
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
    this.elSearchBtn = q('[data-ref="search-btn"]');
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
    this.elEntryPane = q('[data-ref="entry-pane"]');
    this.elTitleDialog = q('[data-ref="title-dialog"]');
    this.elTitleInput = q('[data-ref="title-input"]');
    this.elTitleValidation = q('[data-ref="title-validation"]');
    this.elTitleSaveBtn = q('[data-ref="title-save-btn"]');
    this.elTitleResetBtn = q('[data-ref="title-reset-btn"]');
    this.elMetadataDialog = q('[data-ref="metadata-dialog"]');
    this.elMetadataList = q('[data-ref="metadata-list"]');
    this.elLibraryList = q('[data-ref="library-list"]');
    this.elConversionDialog = q('[data-ref="conversion-dialog"]');
    this.elConversionConfirmBtn = q('[data-ref="conversion-confirm-btn"]');
    this.elImageInsertDialog = q('[data-ref="image-insert-dialog"]');
    this.elImageInsertModeMarkdown = q('[data-ref="image-insert-mode-markdown"]');
    this.elImageInsertModeHtml = q('[data-ref="image-insert-mode-html"]');
    this.elImageInsertAltInput = q('[data-ref="image-insert-alt"]');
    this.elImageInsertSizeModeSelect = q('[data-ref="image-insert-size-mode"]');
    this.elImageInsertSizeValueInput = q('[data-ref="image-insert-size-value"]');
    this.elImageInsertPositionSelect = q('[data-ref="image-insert-position"]');
    this.elImageInsertConfirmBtn = q('[data-ref="image-insert-confirm-btn"]');
    this.elPackFilesDialog = q('[data-ref="pack-files-dialog"]');
    this.elPackFilesModeDocument = q('[data-ref="pack-files-mode-document"]');
    this.elPackFilesModeProject = q('[data-ref="pack-files-mode-project"]');
    this.elPackFilesEntrySelect = q('[data-ref="pack-files-entry"]');
    this.elPackFilesConfirmBtn = q('[data-ref="pack-files-confirm-btn"]');
    this.elCopyRenderDialog = q('[data-ref="copy-render-dialog"]');
    this.elCopyRenderHeading = q('[data-ref="copy-render-heading"]');
    this.elCopyRenderProgressSection = q('[data-ref="copy-render-progress-section"]');
    this.elCopyRenderProgressBar = q('[data-ref="copy-render-progress-bar"]');
    this.elCopyRenderProgressText = q('[data-ref="copy-render-progress-text"]');
    this.elCopyRenderReadyText = q('[data-ref="copy-render-ready-text"]');
    this.elCopyRenderDoneText = q('[data-ref="copy-render-done-text"]');
    this.elCopyRenderCancelBtn = q('[data-ref="copy-render-cancel-btn"]');
    this.elCopyRenderReadyCancelBtn = q('[data-ref="copy-render-ready-cancel-btn"]');
    this.elCopyRenderConfirmBtn = q('[data-ref="copy-render-confirm-btn"]');
    this.elCopyRenderDismissBtn = q('[data-ref="copy-render-dismiss-btn"]');
    this.elNavMenu = q('[data-ref="nav-menu"]');
    this.elNameDialog = q('[data-ref="name-dialog"]');
    this.elNameDialogHeading = q('[data-ref="name-dialog-heading"]');
    this.elNameInput = q('[data-ref="name-input"]');
    this.elNameValidation = q('[data-ref="name-validation"]');
    this.elNameConfirmBtn = q('[data-ref="name-confirm-btn"]');
    this.elDeleteDialog = q('[data-ref="delete-dialog"]');
    this.elDeleteDialogText = q('[data-ref="delete-dialog-text"]');
    this.elDeleteConfirmBtn = q('[data-ref="delete-confirm-btn"]');
    this.elReplaceInput = q('[data-ref="replace-input"]');
    this.elTooltip = q('[data-ref="tooltip"]');
    this.elCopyToast = q('[data-ref="copy-toast"]');
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
    const generation = ++this.openGeneration;
    this.unsub?.();
    this.resetRenderingState();
    this.cmEditor?.destroy();
    this.cmEditor = null;
    this.workspace?.dispose();
    this.workspace = null;
    this.replaceAssetSession(null);
    this.conversionDocumentGeneration += 1;

    try {
      const ws = await MdzipWorkspaceService.open(bytes, options);
      if (generation !== this.openGeneration) {
        // A newer open() started while this parse was in flight; discard this
        // stale result so the latest input remains authoritative.
        return;
      }
      this.workspace = ws;
      this.replaceAssetSession(new MdzipAssetSession(
        ws,
        ws.snapshot().workspace.assets,
        this.elRoot.ownerDocument,
        {
          cache: this.options.assetCache,
          sourceId: () => mdzipArchiveSourceId(bytes),
          onFailed: this.options.onFailed
        }
      ));
      const snap = ws.snapshot();
      if (snap.sourceFormat === 'markdown') {
        this.navVisible = false;
      }
      this.layout = this.validLayoutForSnapshot(
        this.options.initialLayout ?? defaultLayoutForPolicy(this.controlPolicy),
        snap
      );
      await this.ensureCmEditor();
      if (generation !== this.openGeneration) {
        return;
      }
      this.unsub = ws.subscribe((event) => {
        if (event.changes.includes('asset')) {
          this.replaceAssetSession(new MdzipAssetSession(
            ws,
            event.snapshot.workspace.assets,
            this.elRoot.ownerDocument,
            {
              cache: this.options.assetCache,
              sourceId: () => mdzipArchiveSourceId(event.snapshot.archiveBytes),
              onFailed: this.options.onFailed
            }
          ));
        }
        if (event.changes.includes('workspace') || event.changes.includes('document')) {
          this.conversionDocumentGeneration += 1;
        }
        this.render();
        void this.notifyChanged(event);
      });
      this.render();
      void this.notifyChanged(this.initialWorkspaceEvent(ws.snapshot()));
    } catch (error) {
      if (generation !== this.openGeneration) {
        return;
      }
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
   * Since 1.2.7, non-entry-point documents are lazy when the workspace was
   * opened with `includeLazyDocumentReaders`: `text` is `''`, `isLazy` is
   * `true`, and the content is only reachable via the `readText()` closure.
   * Fields present at runtime but absent from the TypeScript interface —
   * `validation`, `orphanedAssets`, and `asset.kind` — must be preserved on the
   * workspace object or operations that depend on them will fail.
   *
   * WARNING: `readText`, `readBytes`, and `readDataUri` are closures and do
   * not survive serialization boundaries such as `postMessage` to a webview.
   * Hosts that serialize the workspace must materialize them first — resolve
   * `readText()` into `text` for each document and `readDataUri()` into a data
   * field for each asset — or rehydrate the reader functions on the far side.
   * A document that arrives with `isLazy: true`, empty `text`, and no
   * `readText` makes opening or archive rebuilds throw
   * `ERR_LAZY_TEXT_UNAVAILABLE` instead of silently producing an empty file.
   */
  public async openWorkspace(workspace: MdzWorkspace, options: MdzipWorkspaceOpenOptions = {}): Promise<void> {
    const generation = ++this.openGeneration;
    this.unsub?.();
    this.resetRenderingState();
    this.cmEditor?.destroy();
    this.cmEditor = null;
    this.workspace?.dispose();
    this.workspace = null;
    this.replaceAssetSession(null);
    this.conversionDocumentGeneration += 1;

    try {
      const ws = await MdzipWorkspaceService.openWorkspace(workspace, options);
      if (generation !== this.openGeneration) {
        // A newer open started while this parse was in flight; discard it.
        return;
      }
      this.workspace = ws;
      this.replaceAssetSession(new MdzipAssetSession(
        ws,
        ws.snapshot().workspace.assets,
        this.elRoot.ownerDocument,
        {
          cache: this.options.assetCache,
          sourceId: options.assetSourceId
            ?? (options.archiveBytes ? () => mdzipArchiveSourceId(options.archiveBytes as Uint8Array) : undefined),
          onFailed: this.options.onFailed
        }
      ));
      const snap = ws.snapshot();
      this.layout = this.validLayoutForSnapshot(
        this.options.initialLayout ?? defaultLayoutForPolicy(this.controlPolicy),
        snap
      );
      await this.ensureCmEditor();
      if (generation !== this.openGeneration) {
        return;
      }
      this.unsub = ws.subscribe((event) => {
        if (event.changes.includes('asset')) {
          this.replaceAssetSession(new MdzipAssetSession(
            ws,
            event.snapshot.workspace.assets,
            this.elRoot.ownerDocument,
            {
              cache: this.options.assetCache,
              sourceId: event.snapshot.archiveBytes.length
                ? () => mdzipArchiveSourceId(event.snapshot.archiveBytes)
                : undefined,
              onFailed: this.options.onFailed
            }
          ));
        }
        if (event.changes.includes('workspace') || event.changes.includes('document')) {
          this.conversionDocumentGeneration += 1;
        }
        this.render();
        void this.notifyChanged(event);
      });
      this.render();
      void this.notifyChanged(this.initialWorkspaceEvent(ws.snapshot()));
    } catch (error) {
      if (generation !== this.openGeneration) {
        return;
      }
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

  public async removeFile(archivePath: string): Promise<boolean> {
    return this.workspace?.removeFile(archivePath) ?? false;
  }

  public async renameFile(oldPath: string, newPath: string): Promise<boolean> {
    return this.workspace?.renameFile(oldPath, newPath) ?? false;
  }

  public async setEntryPoint(archivePath: string): Promise<boolean> {
    return this.workspace?.setEntryPoint(archivePath) ?? false;
  }

  public async setCoverImage(archivePath: string | null): Promise<boolean> {
    return this.workspace?.setCoverImage(archivePath) ?? false;
  }

  public listAssets(): MdzWorkspaceAsset[] {
    return this.workspace?.listAssets() ?? [];
  }

  public canExecuteCommand(command: MdzipEditorCommand): boolean {
    // Availability is currently uniform across commands; the parameter is
    // kept so per-command policies stay a non-breaking change.
    void command;
    const snapshot = this.workspace?.snapshot();
    if (!snapshot || snapshot.mode === 'read-only'
      || snapshot.currentPathType !== 'markdown') {
      return false;
    }
    return true;
  }

  public async executeCommand(command: MdzipEditorCommand, file?: File): Promise<boolean> {
    await this.ensureCmEditor(true);
    if (!this.canExecuteCommand(command)) {
      return false;
    }
    if (command === 'insert-image') {
      if (this.workspace?.sourceFormat === 'markdown') {
        this.requestMdzConversion(file
          ? { kind: 'image-file', file, source: 'picker' }
          : { kind: 'image-picker' });
        return true;
      }
      if (file) {
        await this.insertImageFile(file, 'picker');
      } else {
        this.elImageInput.click();
      }
      return true;
    }
    this.applyMarkdownFormat(command);
    return true;
  }

  // Backs the editor's formatting keybindings (Mod-b/i/k/e). Returns false when
  // the command can't run (read-only, non-markdown) so the key passes through.
  private runFormatShortcut(command: Exclude<MdzipEditorCommand, 'insert-image'>): boolean {
    if (!this.canExecuteCommand(command)) {
      return false;
    }
    this.applyMarkdownFormat(command);
    return true;
  }

  /**
   * Opens CodeMirror's find/replace panel for the current document. Unlike
   * {@link executeCommand}, this works in read-only (Viewer) hosts too —
   * searching doesn't require edit access, only a visible source pane. If
   * the current layout is preview-only, switches to split/source first so
   * the panel has somewhere to render.
   */
  public async openSearch(): Promise<boolean> {
    if (!this.controlPolicy.search) {
      return false;
    }
    const snapshot = this.workspace?.snapshot();
    if (!snapshot || snapshot.currentPathType !== 'markdown') {
      return false;
    }
    if (this.layout === 'preview') {
      const nextLayout = this.controlPolicy.layout.split
        ? 'split'
        : this.controlPolicy.layout.source ? 'source' : null;
      if (!nextLayout) {
        return false;
      }
      await this.setLayout(nextLayout);
    }
    const editor = await this.ensureCmEditor(true);
    if (!editor) {
      return false;
    }
    editor.focus();
    return openSearchPanel(editor);
  }

  public closeSearch(): boolean {
    return this.cmEditor ? closeSearchPanel(this.cmEditor) : false;
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
    this.conversionDocumentGeneration += 1;
    this.resolveImageInsertDialog(null);
    this.resolvePackFilesDialog(null);
    try {
      this.unsub?.();
    } catch {
      // Ignore subscription cleanup errors
    }
    this.resetPreviewState();
    this.replaceAssetSession(null);
    this.teardownEntryRenderer();
    // Release any whenRendered() waiters so their promises do not hang.
    this.flushRenderedWaiters();
    try {
      this.workspace?.dispose();
    } catch {
      // Ignore worker teardown errors
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

  /**
   * Replaces the rendering configuration without recreating the view (and
   * therefore without re-opening the workspace). Wrappers call this when
   * renderer props change; the cost is one preview re-render and entry
   * renderer re-match.
   */
  public setRenderingOptions(options: MdzipRenderingOptions): void {
    if ('markdownRenderer' in options) {
      this.markdownRenderer = options.markdownRenderer ?? undefined;
    }
    if (options.markdownExtensions) {
      this.markdownExtensions = options.markdownExtensions;
    }
    if (options.entryRenderers) {
      this.entryRenderers = options.entryRenderers;
    }
    this.renderingService = new MdzipRenderingService(
      this.markdownRenderer ?? defaultSafeMarkdownRenderer,
      this.markdownExtensions
    );
    this.resetPreviewState();
    this.teardownEntryRenderer();
    this.entryMatchMissKey = null;
    this.render();
  }

  /**
   * Replaces the view control policy without recreating the workspace or
   * CodeMirror editor. In particular, `lineNumbers` is reconfigured through a
   * CodeMirror compartment so text, selection, focus, scroll, and undo history
   * stay intact.
   */
  public setControls(controls: MdzipControlPreset | MdzipControlPolicy | undefined): void {
    const next = resolveMdzipControlPolicy(controls);
    const lineNumbersChanged = next.lineNumbers !== this.controlPolicy.lineNumbers;
    const searchChanged = next.search !== this.controlPolicy.search;
    // codeBlockTools chrome is only attached when the preview HTML actually
    // re-mounts (mountPreviewHtml/mountProgressivePreview), which updatePreview()
    // skips via its memo when nothing document-facing changed. Unlike
    // lineNumbers/search (live CodeMirror compartment reconfigures), there's
    // no live DOM toggle for already-rendered code blocks, so the memo has to
    // be busted to pick up the new policy — same reason
    // setImageHydrationAnimation calls resetPreviewState() below.
    const codeBlockToolsChanged = next.codeBlockTools !== this.controlPolicy.codeBlockTools;
    this.controlPolicy = next;
    if (lineNumbersChanged && this.cmEditor) {
      this.cmEditor.dispatch({
        effects: this.lineNumbersCompartment.reconfigure(
          next.lineNumbers ? lineNumbers() : []
        )
      });
    }
    if (searchChanged && this.cmEditor) {
      if (!next.search) {
        closeSearchPanel(this.cmEditor);
      }
      this.cmEditor.dispatch({
        effects: this.searchCompartment.reconfigure(
          next.search ? [search({ top: true }), keymap.of(searchKeymap)] : []
        )
      });
    }
    if (codeBlockToolsChanged) {
      this.resetPreviewState();
    }
    const snapshot = this.workspace?.snapshot();
    if (snapshot) {
      this.layout = this.validLayoutForSnapshot(this.layout, snapshot);
    }
    this.render();
  }

  public setImageHydrationAnimation(animation: MdzipImageHydrationAnimation | undefined): void {
    const next = animation ?? 'auto';
    if (next === this.imageHydrationAnimation) {
      return;
    }
    this.imageHydrationAnimation = next;
    this.resetPreviewState();
    this.render();
  }

  public setDensityOptions(options: Pick<MdzipWorkspaceViewOptions, 'toolbarDensity' | 'contentDensity'>): void {
    const nextToolbarDensity = normalizeToolbarDensity(options.toolbarDensity);
    const nextContentDensity = normalizeContentDensity(options.contentDensity);
    if (nextToolbarDensity === this.toolbarDensity && nextContentDensity === this.contentDensity) {
      return;
    }
    this.toolbarDensity = nextToolbarDensity;
    this.contentDensity = nextContentDensity;
    this.applyDensityClasses();
  }

  /**
   * Sets the preview reading-column width. Developer-facing only — there is
   * no toolbar UI for this. Pass `undefined` to return to the built-in
   * default (which scales with zoom); any other value is used exactly as
   * given and does not scale with zoom (see {@link MdzipPreviewMaxWidth}).
   */
  public setPreviewMaxWidth(value: MdzipPreviewMaxWidth | undefined): void {
    if (value === this.previewMaxWidth) {
      return;
    }
    this.previewMaxWidth = value;
    this.render();
  }

  public setImageInsertOptions(
    options: Pick<MdzipWorkspaceViewOptions, 'imageInsertMode' | 'imageInsertHandler'>
  ): void {
    this.options.imageInsertMode = options.imageInsertMode;
    this.options.imageInsertHandler = options.imageInsertHandler;
  }

  public setImageEditOptions(options: Pick<MdzipWorkspaceViewOptions, 'imageEditHandler'>): void {
    this.options.imageEditHandler = options.imageEditHandler;
  }

  private applyDensityClasses(): void {
    this.elRoot.classList.remove(
      'toolbar-density-comfortable',
      'toolbar-density-compact',
      'toolbar-density-dense',
      'content-density-comfortable',
      'content-density-compact'
    );
    this.elRoot.classList.add(`toolbar-density-${this.toolbarDensity}`);
    this.elRoot.classList.add(`content-density-${this.contentDensity}`);
  }

  /**
   * Tears down all custom rendering state: aborts in-flight renders, destroys
   * mounted extension and entry renderer handles, and clears memo caches.
   * Used when the workspace is replaced or the view is destroyed.
   */
  private resetRenderingState(): void {
    this.resetPreviewState();
    this.teardownEntryRenderer();
    this.entryMatchMissKey = null;
  }

  private replaceAssetSession(session: MdzipAssetSession | null): void {
    this.assetSession?.destroy();
    this.assetSession = session;
    this.resetPreviewState();
  }

  private resetPreviewState(): void {
    this.previewAbort?.abort();
    this.previewAbort = null;
    this.previewGeneration += 1;
    this.destroyPreviewHandles();
    this.previewMemo = null;
  }

  private destroyPreviewHandles(): void {
    const handles = this.previewHandles;
    this.previewHandles = [];
    for (const handle of handles) {
      try {
        handle.destroy();
      } catch (error) {
        this.options.onFailed?.(error);
      }
    }
    // A new render generation invalidates any in-progress chunk draining —
    // Copy All's own abort check unwinds it and hides the dialog. It also
    // invalidates a "ready to copy" or "done" dialog left over from a
    // previous document: `copyReadyState.perform` closes over that
    // document's already-built HTML/text, and clicking Copy against a
    // now-superseded document would silently copy the wrong content.
    this.chunkedRenderState = null;
    this.chunkHtmlCache = null;
    this.copyRenderDialogState?.abort.abort();
    this.copyReadyState = null;
    this.copyRenderDoneState = null;
  }

  /** True when `this.previewMemo` — and by extension `this.previewGeneration` — still represents `snapshot`: nothing that feeds the preview (path, pathType, text, colorScheme) has changed since it was last rendered. */
  private previewMemoMatchesSnapshot(snapshot: MdzipWorkspaceSnapshot): boolean {
    const memo = this.previewMemo;
    return !!memo
      && memo.path === snapshot.currentPath
      && memo.pathType === snapshot.currentPathType
      && memo.text === snapshot.currentText
      && memo.colorScheme === this.colorScheme;
  }

  private updatePreview(snapshot: MdzipWorkspaceSnapshot, entryClaimed: boolean): void {
    if (entryClaimed) {
      // The entry renderer owns the pane stack; release preview resources so
      // a later fallback re-renders from scratch.
      if (this.previewMemo || this.previewHandles.length > 0 || this.previewAbort) {
        this.resetPreviewState();
        this.elPreviewContent.replaceChildren();
      }
      // There is no built-in preview to wait for; release any waiters.
      this.previewHydrated = true;
      this.flushRenderedWaiters();
      return;
    }

    const memo = this.previewMemo;
    if (this.previewMemoMatchesSnapshot(snapshot)) {
      // Nothing that feeds the preview changed; keep the existing DOM and any
      // mounted extension handles.
      return;
    }

    const animateImageHydration = this.shouldAnimateImageHydration(memo, snapshot);
    this.previewAbort?.abort();
    this.previewAbort = null;
    this.destroyPreviewHandles();
    const generation = ++this.previewGeneration;
    this.previewHydrated = false;
    this.previewMemo = {
      path: snapshot.currentPath,
      pathType: snapshot.currentPathType,
      text: snapshot.currentText,
      colorScheme: this.colorScheme
    };

    if (snapshot.currentPathType !== 'markdown') {
      if (snapshot.currentPathType === 'image' && this.assetSession) {
        const abort = new AbortController();
        this.previewAbort = abort;
        void this.assetSession.resolve(snapshot.currentPath, snapshot.currentPath).then((src) => {
          if (generation !== this.previewGeneration || abort.signal.aborted) return;
          this.elPreviewContent.innerHTML = src
            ? `<div class="asset-preview-wrap"><img class="asset-preview-image" src="${escapeHtml(src)}" alt="${escapeHtml(snapshot.currentPath)}"></div>`
            : renderMdzipPreviewHtml(snapshot);
          this.firePreviewRendered(snapshot, generation);
          this.fireAssetsHydrated(snapshot, generation);
        }).catch((error) => this.options.onFailed?.(error));
      } else {
        this.elPreviewContent.innerHTML = renderMdzipPreviewHtml(snapshot);
        this.firePreviewRendered(snapshot, generation);
        this.fireAssetsHydrated(snapshot, generation);
      }
      return;
    }

    const abort = new AbortController();
    this.previewAbort = abort;
    const context = this.createMarkdownContext(snapshot, abort.signal);

    if (this.progressiveTextRendering && this.renderingService.supportsChunking) {
      this.renderChunkedPreview(snapshot, context, generation, animateImageHydration);
      return;
    }

    let result: string | Promise<string>;
    try {
      result = this.renderingService.renderMarkdown(snapshot.currentText, context);
    } catch (error) {
      this.options.onFailed?.(error);
      this.elPreviewContent.innerHTML = renderMdzipPreviewHtml(snapshot);
      this.firePreviewRendered(snapshot, generation);
      this.fireAssetsHydrated(snapshot, generation);
      return;
    }

    if (typeof result === 'string') {
      // Sync fast path: no microtask hop when every pipeline stage is sync.
      this.applyPreviewHtml(result, snapshot, context, generation, animateImageHydration);
      return;
    }

    void result.then((html) => {
      if (generation !== this.previewGeneration || abort.signal.aborted) {
        return; // Stale: the selection or content moved on while rendering.
      }
      this.applyPreviewHtml(html, snapshot, context, generation, animateImageHydration);
    }).catch((error) => {
      if (generation !== this.previewGeneration || abort.signal.aborted) {
        return;
      }
      if ((error as { name?: string } | null)?.name !== 'AbortError') {
        this.options.onFailed?.(error);
      }
    });
  }

  private applyPreviewHtml(
    html: string,
    snapshot: MdzipWorkspaceSnapshot,
    context: MdzipMarkdownRenderContext,
    generation: number,
    animateImageHydration: boolean
  ): void {
    // When the preview references archive images, mount the text immediately
    // and hydrate each image progressively (reserving layout space from its
    // sniffed intrinsic size), rather than blocking the whole preview on image
    // resolution. Other markdown mounts synchronously.
    if (this.assetSession && /<img\b/i.test(html)) {
      this.mountProgressivePreview(html, snapshot, context, generation, animateImageHydration);
      return;
    }
    this.mountPreviewHtml(html, snapshot, context, generation);
  }

  private shouldAnimateImageHydration(
    previousMemo: MdzipPreviewMemo | null,
    snapshot: MdzipWorkspaceSnapshot
  ): boolean {
    if (this.imageHydrationAnimation === 'off') {
      return false;
    }
    if (this.imageHydrationAnimation === 'auto') {
      return true;
    }
    return !previousMemo
      || previousMemo.path !== snapshot.currentPath
      || previousMemo.pathType !== snapshot.currentPathType;
  }

  private mountPreviewHtml(
    html: string,
    snapshot: MdzipWorkspaceSnapshot,
    context: MdzipMarkdownRenderContext,
    generation: number
  ): void {
    this.elPreviewContent.innerHTML = html;
    this.mountPreviewExtensions(context, generation);
    const codeBlockHandle = this.mountCodeBlockControls();
    if (codeBlockHandle) {
      this.previewHandles.push(codeBlockHandle);
    }
    // No archive images to resolve on this path: the preview is ready now.
    this.firePreviewRendered(snapshot, generation);
    this.fireAssetsHydrated(snapshot, generation);
  }

  /**
   * Mounts the rendered text immediately with image placeholders, then swaps
   * each archive image in as it resolves. `onPreviewRendered` fires once the
   * text is in the DOM; `onAssetsHydrated` fires once every referenced image
   * has resolved and had its final `src` assigned (or there are none).
   */
  private mountProgressivePreview(
    html: string,
    snapshot: MdzipWorkspaceSnapshot,
    context: MdzipMarkdownRenderContext,
    generation: number,
    animateImageHydration: boolean
  ): void {
    this.elPreviewContent.innerHTML = html;
    // Cheap pass over every <img> happens before extensions/code-block
    // controls mount, same relative order as always — see
    // collectPendingImages for why it's split from the (expensive) slot
    // creation that follows.
    const pending = this.collectPendingImages([this.elPreviewContent], animateImageHydration);
    this.mountPreviewExtensions(context, generation);
    const codeBlockHandle = this.mountCodeBlockControls();
    if (codeBlockHandle) {
      this.previewHandles.push(codeBlockHandle);
    }
    this.firePreviewRendered(snapshot, generation);
    this.hydrateImages(pending, context, generation, animateImageHydration, () => {
      this.fireAssetsHydrated(snapshot, generation);
    });
  }

  /**
   * Cheap, attribute-only pass over every `<img>` under `roots`: no DOM tree
   * mutation. Archive-relative sources have their `src` stripped here
   * (immediately, so the browser never fires a bad network request for the
   * archive-relative path) and are returned for {@link hydrateImages};
   * external/data/fragment sources are left untouched (just get their align
   * class, if any — they never get a slot). Returns `[]` without touching
   * anything when there's no asset session to resolve archive images
   * against, matching `mountPreviewHtml`'s no-op image handling.
   */
  private collectPendingImages(
    roots: readonly HTMLElement[],
    animateImageHydration: boolean
  ): { image: HTMLImageElement; source: string }[] {
    if (!this.assetSession) {
      return [];
    }
    const pending: { image: HTMLImageElement; source: string }[] = [];
    for (const root of roots) {
      for (const image of Array.from(root.querySelectorAll<HTMLImageElement>('img'))) {
        applyRawHtmlImageSizeAttributes(image);
        const source = image.getAttribute('src');
        // Leave external, protocol-relative, data, and fragment URLs untouched.
        if (!source || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)) {
          const alignClass = rawHtmlImageAlignClass(image);
          if (alignClass) {
            image.classList.add(alignClass);
          }
          continue;
        }
        image.removeAttribute('src');
        if (animateImageHydration) {
          image.classList.add('mdzip-image-loading');
        }
        pending.push({ image, source });
      }
    }
    return pending;
  }

  /**
   * Slot-wraps and resolves `pending` images (from {@link collectPendingImages}),
   * only decompressing/resolving ones near the viewport up front — a
   * document with a few hundred distinct embedded images would otherwise
   * decompress and blob-URL every one of them synchronously, freezing the UI
   * for as long as that takes. Falls back to eager resolution when
   * IntersectionObserver isn't available (e.g. non-browser hosts). Calls
   * `onSettled` once every image in `pending` has resolved (or immediately
   * if `pending` is empty) — callers that want a single "hydrated" signal
   * for a whole preview pass `pending` from every root at once; callers
   * mounting one chunk among several within the same generation (see
   * {@link mountChunkBatch}) pass a no-op instead, so the signal only fires
   * once, for the batch it's semantically tied to.
   */
  private hydrateImages(
    pending: readonly { image: HTMLImageElement; source: string }[],
    context: MdzipMarkdownRenderContext,
    generation: number,
    animateImageHydration: boolean,
    onSettled: () => void
  ): void {
    const session = this.assetSession;
    if (!session || pending.length === 0) {
      onSettled();
      return;
    }

    const document = this.elPreviewContent.ownerDocument;
    let remaining = pending.length;
    const settle = (): void => {
      remaining -= 1;
      if (remaining === 0) {
        onSettled();
      }
    };
    const createImageSlot = (image: HTMLImageElement): HTMLElement => {
      const slot = document.createElement('span');
      slot.className = animateImageHydration
        ? 'mdzip-image-slot'
        : 'mdzip-image-slot mdzip-image-open mdzip-image-animation-off';
      const alignClass = rawHtmlImageAlignClass(image);
      if (alignClass === 'mdzip-image-left') {
        slot.classList.add('mdzip-image-align-left');
      } else if (alignClass === 'mdzip-image-right') {
        slot.classList.add('mdzip-image-align-right');
      }
      image.parentNode?.insertBefore(slot, image);
      slot.appendChild(image);
      return slot;
    };

    const hydrate = (image: HTMLImageElement, slot: HTMLElement, source: string): void => {
      void session.resolveImage(source, context.currentPath).then((resolved) => {
        if (generation !== this.previewGeneration || context.signal.aborted) {
          settle();
          return;
        }
        if (!resolved) {
          image.classList.remove('mdzip-image-loading');
          this.openImageSlot(slot);
          settle();
          return;
        }
        // Size the reserved box from the sniffed dimensions so the slot eases
        // open to the image's exact height in a single slide — and the pixels
        // drop into an already-correct box with no further reflow.
        if (resolved.width && resolved.height
          && !image.hasAttribute('width') && !image.hasAttribute('height')) {
          image.setAttribute('width', String(resolved.width));
          image.setAttribute('height', String(resolved.height));
        }
        this.attachImageLoadHandlers(image, source, resolved.url, context, generation);
        image.setAttribute('src', resolved.url);
        this.openImageSlot(slot);
        settle();
      }).catch((error) => {
        if ((error as { name?: string } | null)?.name !== 'AbortError') {
          this.options.onFailed?.(error);
        }
        image.classList.remove('mdzip-image-loading');
        this.openImageSlot(slot);
        settle();
      });
    };

    const observerWindow = document.defaultView;
    if (!observerWindow?.IntersectionObserver) {
      for (const { image, source } of pending) {
        hydrate(image, createImageSlot(image), source);
      }
      return;
    }

    const bySlot = new Map<Element, { image: HTMLImageElement; source: string }>();
    const observer = new observerWindow.IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const item = bySlot.get(entry.target);
        if (item) hydrate(item.image, entry.target as HTMLElement, item.source);
      }
    }, { root: this.elPreviewPane, rootMargin: '600px 0px' });
    this.previewHandles.push({ destroy: () => observer.disconnect() });

    // Slot creation + observer registration is a real DOM tree mutation per
    // image (as opposed to the cheap attribute-only pass in
    // collectPendingImages), and at thousands of occurrences (e.g. a chat
    // export where a handful of distinct avatars repeat across every row)
    // doing it all synchronously blocks the main thread for seconds.
    // Time-budget it across animation frames instead — the first chunk
    // still runs synchronously as part of this call (no yield before it),
    // so small documents (every existing test) see their slots exist
    // immediately, same as before.
    const CHUNK_BUDGET_MS = 8;
    let cursor = 0;
    const processChunk = (): void => {
      if (generation !== this.previewGeneration || context.signal.aborted) return;
      const chunkStart = observerWindow.performance.now();
      while (cursor < pending.length && observerWindow.performance.now() - chunkStart < CHUNK_BUDGET_MS) {
        const item = pending[cursor];
        cursor += 1;
        const slot = createImageSlot(item.image);
        bySlot.set(slot, item);
        observer.observe(slot);
      }
      if (cursor < pending.length) {
        observerWindow.requestAnimationFrame(processChunk);
      }
    };
    processChunk();
  }

  /**
   * Opt-in (`progressiveTextRendering`) alternative to the whole-document
   * `renderMarkdown()` path above: tokenizes the markdown once, then renders
   * and mounts it in chunks near the viewport instead of all at once — see
   * {@link mountChunkedPreview}. Only reachable when
   * `renderingService.supportsChunking` is true (the default marked-based
   * renderer); the caller already checked that.
   */
  private renderChunkedPreview(
    snapshot: MdzipWorkspaceSnapshot,
    context: MdzipMarkdownRenderContext,
    generation: number,
    animateImageHydration: boolean
  ): void {
    let tokens: ReturnType<MdzipRenderingService['tokenizeMarkdown']>;
    try {
      tokens = this.renderingService.tokenizeMarkdown(snapshot.currentText, context);
    } catch (error) {
      this.options.onFailed?.(error);
      this.elPreviewContent.innerHTML = renderMdzipPreviewHtml(snapshot);
      this.firePreviewRendered(snapshot, generation);
      this.fireAssetsHydrated(snapshot, generation);
      return;
    }

    if (Array.isArray(tokens)) {
      this.mountChunkedPreview(tokens, snapshot, context, generation, animateImageHydration);
      return;
    }
    void tokens.then((resolved) => {
      if (generation !== this.previewGeneration || context.signal.aborted) return;
      this.mountChunkedPreview(resolved, snapshot, context, generation, animateImageHydration);
    }).catch((error) => {
      if (generation !== this.previewGeneration || context.signal.aborted) return;
      if ((error as { name?: string } | null)?.name !== 'AbortError') {
        this.options.onFailed?.(error);
      }
    });
  }

  /**
   * Groups tokens into chunks and mounts them: an initial batch synchronously
   * (enough for a small document to behave exactly like the non-chunked
   * path), then the rest as the user scrolls near a trailing sentinel
   * element, via the same `IntersectionObserver` + time-budgeted-rAF pattern
   * already used for image hydration — just for "need more text" instead of
   * "need this image". `onAssetsHydrated` fires once for the initial batch's
   * images only (not re-fired per later chunk) — `onPreviewRendered` still
   * means "the initial batch is in the DOM", same intent as the non-chunked
   * path, just proportional to the viewport instead of the whole document.
   */
  private mountChunkedPreview(
    tokens: readonly Token[],
    snapshot: MdzipWorkspaceSnapshot,
    context: MdzipMarkdownRenderContext,
    generation: number,
    animateImageHydration: boolean
  ): void {
    this.elPreviewContent.replaceChildren();
    // Also called with no options in renderFullDocumentHtml — see the
    // comment there; keep both call sites' chunking in sync.
    const chunks = groupTokensIntoChunks(tokens);
    if (chunks.length === 0) {
      this.chunkedRenderState = null;
      this.firePreviewRendered(snapshot, generation);
      this.fireAssetsHydrated(snapshot, generation);
      return;
    }
    this.chunkedRenderState = { chunks, cursor: 0, context, generation, animateImageHydration, sentinelHandle: null };

    void this.mountChunkBatch(chunks, 0, context, generation, animateImageHydration, () => {
      this.fireAssetsHydrated(snapshot, generation);
    }).then((cursor) => {
      if (generation !== this.previewGeneration || context.signal.aborted) return;
      this.recordChunkProgress(generation, chunks, cursor);
      this.firePreviewRendered(snapshot, generation);
      if (cursor < chunks.length) {
        this.armChunkSentinel(chunks, cursor, context, generation, animateImageHydration);
      }
    });
  }

  /**
   * Updates `chunkedRenderState.cursor` after a batch mounts, or clears the
   * whole state once every chunk is in the DOM — that `null` is Copy All's
   * signal that there's nothing left to force-render. A no-op if a newer
   * render generation has already superseded this one.
   */
  private recordChunkProgress(generation: number, chunks: readonly Token[][], cursor: number): void {
    if (this.chunkedRenderState?.generation !== generation) return;
    if (cursor >= chunks.length) {
      this.chunkedRenderState = null;
    } else {
      this.chunkedRenderState.cursor = cursor;
    }
  }

  /**
   * Renders+appends chunks starting at `startCursor` up to a char budget
   * (enough for one screenful, roughly) *or* a wall-clock time budget,
   * whichever comes first — char count alone is a poor proxy for cost on a
   * document where some chunks are plain text and others are dense with
   * `<img>` tags (parsing + sanitizing + inserting into an already-huge
   * `elPreviewContent` gets measurably more expensive per chunk as an
   * image-heavy document's accumulated DOM grows); the time budget catches
   * what the char budget alone misses. Mounts extensions/code-block controls
   * for exactly the chunks it appended (never re-scanning earlier ones), and
   * returns the cursor to resume from plus those chunks' roots (for the
   * caller to run `collectPendingImages` on). Shared by every caller that
   * mounts chunk batches — the initial batch, every later sentinel-triggered
   * continuation, and Copy All's drain — image hydration itself is *not*
   * included here; see {@link mountChunkBatch} and
   * {@link drainRemainingChunks} for the two different ways callers pace it.
   */
  private async renderAndMountChunkBatch(
    chunks: readonly Token[][],
    startCursor: number,
    context: MdzipMarkdownRenderContext,
    generation: number
  ): Promise<{ cursor: number; mountedRoots: HTMLElement[] }> {
    const BATCH_CHAR_BUDGET = 4000;
    const BATCH_TIME_BUDGET_MS = 10;
    const clock = this.elPreviewContent.ownerDocument.defaultView?.performance ?? performance;
    const batchStart = clock.now();
    let cursor = startCursor;
    let renderedChars = 0;
    const mountedRoots: HTMLElement[] = [];
    while (
      cursor < chunks.length
      && renderedChars < BATCH_CHAR_BUDGET
      && (mountedRoots.length === 0 || clock.now() - batchStart < BATCH_TIME_BUDGET_MS)
    ) {
      if (generation !== this.previewGeneration || context.signal.aborted) return { cursor, mountedRoots };
      const chunkTokens = chunks[cursor];
      const chunkIndex = cursor;
      cursor += 1;
      let html: string;
      let cacheHit: string | undefined;
      try {
        cacheHit = this.chunkHtmlCache?.generation === generation
          ? this.chunkHtmlCache.html.get(chunkIndex)
          : undefined;
        if (cacheHit !== undefined) {
          html = cacheHit;
        } else {
          const result = this.renderingService.renderChunk(chunkTokens, context);
          html = typeof result === 'string' ? result : await result;
        }
      } catch (error) {
        if ((error as { name?: string } | null)?.name !== 'AbortError') {
          this.options.onFailed?.(error);
        }
        continue;
      }
      if (generation !== this.previewGeneration || context.signal.aborted) return { cursor, mountedRoots };
      if (cacheHit === undefined) {
        // groupTokensIntoChunks is also called with no options in
        // renderFullDocumentHtml — keep both call sites' chunking in sync,
        // since chunk index is this cache's only key.
        if (this.chunkHtmlCache?.generation !== generation) {
          this.chunkHtmlCache = { generation, html: new Map() };
        }
        this.chunkHtmlCache.html.set(chunkIndex, html);
      }
      const root = this.appendChunkHtml(html);
      mountedRoots.push(root);
      renderedChars += html.length;
    }

    for (const root of mountedRoots) {
      this.mountPreviewExtensions(context, generation, root);
      const codeBlockHandle = this.mountCodeBlockControls(root);
      if (codeBlockHandle) {
        this.previewHandles.push(codeBlockHandle);
      }
    }
    return { cursor, mountedRoots };
  }

  /**
   * `renderAndMountChunkBatch` plus its own immediate, independent
   * `hydrateImages` pass — the shape every caller except Copy All's drain
   * wants: mount a batch, then hydrate whatever images it contained,
   * decoupled from mounting the next batch. Scroll-paced callers (the
   * initial batch, every sentinel continuation) are naturally rate-limited
   * by how fast the user scrolls, so one independent hydration loop per
   * batch never has a chance to pile up against another.
   */
  private async mountChunkBatch(
    chunks: readonly Token[][],
    startCursor: number,
    context: MdzipMarkdownRenderContext,
    generation: number,
    animateImageHydration: boolean,
    onImagesSettled: () => void
  ): Promise<number> {
    const { cursor, mountedRoots } = await this.renderAndMountChunkBatch(chunks, startCursor, context, generation);
    // Same relative order as the non-chunked path: cheap image pass, then
    // the (expensive) slot/observe pass.
    const pending = this.collectPendingImages(mountedRoots, animateImageHydration);
    this.hydrateImages(pending, context, generation, animateImageHydration, onImagesSettled);
    return cursor;
  }

  /** Wraps one chunk's rendered HTML in a mount boundary and appends it. See the `.mdzip-chunk` CSS rules for why. */
  private appendChunkHtml(html: string): HTMLElement {
    const doc = this.elPreviewContent.ownerDocument;
    const wrapper = doc.createElement('div');
    wrapper.className = 'mdzip-chunk';
    wrapper.innerHTML = html;
    this.elPreviewContent.appendChild(wrapper);
    return wrapper;
  }

  /**
   * Appends a trailing sentinel and mounts the next chunk batch once it's
   * within `rootMargin` of the viewport — a larger margin than images'
   * (`hydrateImages`' 600px) since keeping text ahead of scroll is cheap
   * relative to keeping images ahead. Re-arms itself after each batch until
   * every chunk is mounted. Falls back to mounting everything immediately
   * when IntersectionObserver isn't available, matching `hydrateImages`.
   */
  private armChunkSentinel(
    chunks: readonly Token[][],
    cursor: number,
    context: MdzipMarkdownRenderContext,
    generation: number,
    animateImageHydration: boolean
  ): void {
    const doc = this.elPreviewContent.ownerDocument;
    const observerWindow = doc.defaultView;

    const mountNext = (nextCursor: number): void => {
      void this.mountChunkBatch(chunks, nextCursor, context, generation, animateImageHydration, () => {})
        .then((newCursor) => {
          if (generation !== this.previewGeneration || context.signal.aborted) return;
          this.recordChunkProgress(generation, chunks, newCursor);
          if (newCursor < chunks.length) {
            this.armChunkSentinel(chunks, newCursor, context, generation, animateImageHydration);
          }
        });
    };

    if (!observerWindow?.IntersectionObserver) {
      mountNext(cursor);
      return;
    }

    const sentinel = doc.createElement('div');
    sentinel.className = 'mdzip-chunk-sentinel';
    this.elPreviewContent.appendChild(sentinel);
    const observer = new observerWindow.IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.disconnect();
        sentinel.remove();
        if (this.chunkedRenderState?.generation === generation) {
          this.chunkedRenderState.sentinelHandle = null;
        }
        mountNext(cursor);
      }
    }, { root: this.elPreviewPane, rootMargin: '1600px 0px' });
    observer.observe(sentinel);
    // Stored on both previewHandles (torn down on the next render generation,
    // like every other preview handle) and chunkedRenderState.sentinelHandle
    // (torn down early by Copy All so its own manual drain doesn't race this
    // observer and double-mount a chunk).
    const handle: MdzipRenderHandle = { destroy: () => { observer.disconnect(); sentinel.remove(); } };
    this.previewHandles.push(handle);
    if (this.chunkedRenderState?.generation === generation) {
      this.chunkedRenderState.sentinelHandle = handle;
    }
  }

  /**
   * Reveals a collapsed image slot. Flushing layout before toggling the class
   * lets the `0fr -> 1fr` grid transition run from the collapsed state instead
   * of being coalesced into the initial mount; CSS snaps it open instantly
   * under `prefers-reduced-motion`.
   */
  private openImageSlot(slot: HTMLElement): void {
    if (this.imageHydrationAnimation === 'off' || slot.classList.contains('mdzip-image-animation-off')) {
      slot.classList.add('mdzip-image-open');
      return;
    }
    void slot.offsetHeight;
    slot.classList.add('mdzip-image-open');
  }

  /**
   * Wires `<img>` load/error handling for a resolved archive image.
   *
   * `resolveImage()` already succeeded, so an `error` here is environmental
   * rather than a missing asset — most often a host whose CSP `img-src` blocks
   * the `blob:` object URL. When that happens we retry once with a `data:` URL
   * (which many such hosts still permit), and only if that also fails do we
   * surface the failure via `onFailed` instead of leaving a silent blank box.
   */
  private attachImageLoadHandlers(
    image: HTMLImageElement,
    source: string,
    resolvedUrl: string,
    context: MdzipMarkdownRenderContext,
    generation: number
  ): void {
    const clear = (): void => image.classList.remove('mdzip-image-loading');
    image.addEventListener('load', clear, { once: true });
    image.addEventListener('error', () => {
      const session = this.assetSession;
      if (resolvedUrl.startsWith('blob:') && session) {
        void session.resolveDataUrl(source, context.currentPath).then((dataUrl) => {
          if (generation !== this.previewGeneration || context.signal.aborted) {
            clear();
            return;
          }
          if (dataUrl && dataUrl !== resolvedUrl) {
            image.addEventListener('load', clear, { once: true });
            image.addEventListener('error', () => {
              clear();
              this.reportImageLoadFailure(source);
            }, { once: true });
            image.setAttribute('src', dataUrl);
            return;
          }
          clear();
          this.reportImageLoadFailure(source);
        }).catch((error) => {
          clear();
          this.options.onFailed?.(error);
        });
        return;
      }
      clear();
      this.reportImageLoadFailure(source);
    }, { once: true });
  }

  private reportImageLoadFailure(source: string): void {
    this.options.onFailed?.(new Error(
      `Failed to load archive image "${source}". When embedding the editor in a `
      + 'CSP-restricted host (e.g. a VS Code webview), ensure img-src permits '
      + 'blob: and data:.'
    ));
  }

  /**
   * `root` scopes extension `mount()` calls to a specific chunk instead of
   * the whole preview — used by chunked rendering (see
   * {@link mountChunkedPreview}), where extensions run once per newly
   * appended chunk rather than once over the whole document. Defaults to
   * the whole preview content, matching the non-chunked path exactly.
   */
  private mountPreviewExtensions(
    context: MdzipMarkdownRenderContext,
    generation: number,
    root: HTMLElement = this.elPreviewContent
  ): void {
    for (const extension of this.markdownExtensions) {
      if (!extension.mount) {
        continue;
      }
      try {
        const mounted = extension.mount(root, context);
        if (isThenable(mounted)) {
          void Promise.resolve(mounted).then((handle) => {
            if (!handle) {
              return;
            }
            if (generation !== this.previewGeneration) {
              try {
                handle.destroy();
              } catch {
                // Stale handle cleanup failure is not actionable.
              }
              return;
            }
            this.previewHandles.push(handle);
          }).catch((error) => {
            if (generation === this.previewGeneration) {
              this.options.onFailed?.(error);
            }
          });
        } else if (mounted) {
          this.previewHandles.push(mounted);
        }
      } catch (error) {
        this.options.onFailed?.(error);
      }
    }
  }

  /**
   * Built-in preview affordances for rendered code blocks: a language-name
   * header, a copy-to-clipboard button, and (on long enough blocks) a
   * collapse/expand toggle. Gated by `controlPolicy.codeBlockTools`.
   *
   * Deliberately not a `markdownExtensions` entry (unlike the Mermaid
   * extension) — every consumer gets this automatically, gated by policy
   * rather than opt-in wiring. Runs after `mountPreviewExtensions` so any
   * extension-provided `pre > code` blocks already exist in the DOM. See #29.
   *
   * `root` scopes the scan to a specific chunk instead of the whole preview
   * — see {@link mountPreviewExtensions} for why.
   */
  private mountCodeBlockControls(root: HTMLElement = this.elPreviewContent): MdzipRenderHandle | null {
    if (!this.controlPolicy.codeBlockTools) {
      return null;
    }
    const codeEls = Array.from(root.querySelectorAll<HTMLElement>('pre > code'));
    if (codeEls.length === 0) {
      return null;
    }

    const doc = this.elPreviewContent.ownerDocument;
    // Resolve AbortController from the document's own realm, not the ambient
    // global: addEventListener's `signal` option is validated against the
    // listener target's realm, so a controller from a different realm (e.g.
    // Node's global AbortController against a jsdom-hosted element in a
    // server-side/test environment) fails that check even though both are
    // spec-compliant AbortControllers.
    const AbortControllerCtor = doc.defaultView?.AbortController ?? AbortController;
    const controller = new AbortControllerCtor();

    for (const code of codeEls) {
      const pre = code.parentElement;
      if (pre) {
        this.enhanceCodeBlock(pre, code, doc, controller.signal);
      }
    }

    return { destroy: () => controller.abort() };
  }

  /**
   * Wraps one `pre > code` block with a header (language label + action
   * buttons) and a collapsible body, in place. `pre` itself is relocated
   * (not cloned) into the new structure, so existing references to it and
   * its `code` child stay valid.
   */
  private enhanceCodeBlock(
    pre: HTMLElement,
    code: HTMLElement,
    doc: Document,
    signal: AbortSignal
  ): void {
    const language = /language-([\w-]+)/.exec(code.className)?.[1] ?? '';

    const wrapper = doc.createElement('div');
    wrapper.className = 'mdzip-code-block';

    const header = doc.createElement('div');
    header.className = 'mdzip-code-block-header';

    const label = doc.createElement('span');
    label.className = 'mdzip-code-block-lang';
    label.textContent = language || 'text';
    header.appendChild(label);

    const actions = doc.createElement('div');
    actions.className = 'mdzip-code-block-actions';
    header.appendChild(actions);

    const body = doc.createElement('div');
    body.className = 'mdzip-code-block-body';

    pre.replaceWith(wrapper);
    wrapper.append(header, body);
    body.appendChild(pre);

    // Collapse toggle: only shown when the block has enough lines that
    // collapsing is actually visible — the collapsed body still shows ~12
    // lines (240px, see .mdzip-code-block-collapsed in view-css.ts), so a
    // button that collapses a block shorter than that would visibly do
    // nothing, which is more confusing than not offering it at all. Blocks
    // past the longer auto-collapse threshold start pre-collapsed; anything
    // between the two thresholds is collapsible but starts open.
    const lineCount = (code.textContent ?? '').split('\n').length;
    if (lineCount > CODE_BLOCK_COLLAPSIBLE_MIN_LINES) {
      if (lineCount > CODE_BLOCK_AUTO_COLLAPSE_LINES) {
        wrapper.classList.add('mdzip-code-block-collapsed');
      }
      const collapseBtn = doc.createElement('button');
      collapseBtn.type = 'button';
      collapseBtn.className = 'mdzip-code-block-btn';
      collapseBtn.innerHTML = CODE_BLOCK_COLLAPSE_ICON_HTML;
      const syncCollapseLabel = (): void => {
        const collapsed = wrapper.classList.contains('mdzip-code-block-collapsed');
        collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        collapseBtn.setAttribute('aria-label', collapsed ? 'Expand code block' : 'Collapse code block');
      };
      syncCollapseLabel();
      collapseBtn.title = 'Collapse/expand';
      collapseBtn.addEventListener('click', () => {
        wrapper.classList.toggle('mdzip-code-block-collapsed');
        syncCollapseLabel();
      }, { signal });
      actions.appendChild(collapseBtn);
    }

    // Copy button: icon swaps to a confirmation state for a beat, then reverts.
    // The revert timer is cleared on unmount so it never touches a stale button
    // after the preview re-renders.
    const copyBtn = doc.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'mdzip-code-block-btn';
    copyBtn.innerHTML = CODE_BLOCK_COPY_ICON_HTML;
    copyBtn.setAttribute('aria-label', 'Copy code');
    copyBtn.title = 'Copy code';
    // Re-check clipboard availability at click time rather than capturing it
    // once at mount: a host can grant/attach clipboard access after the
    // preview first renders, and this way there is nothing to keep in sync.
    let copiedTimer: ReturnType<typeof setTimeout> | undefined;
    copyBtn.addEventListener('click', () => {
      const clip = doc.defaultView?.navigator.clipboard;
      if (!clip) {
        return;
      }
      void clip.writeText(code.textContent ?? '').then(() => {
        copyBtn.innerHTML = CODE_BLOCK_COPIED_ICON_HTML;
        copyBtn.classList.add('mdzip-code-block-btn-copied');
        copyBtn.setAttribute('aria-label', 'Copied');
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
          copyBtn.innerHTML = CODE_BLOCK_COPY_ICON_HTML;
          copyBtn.classList.remove('mdzip-code-block-btn-copied');
          copyBtn.setAttribute('aria-label', 'Copy code');
        }, 1500);
      }).catch(() => {
        // Write can fail (permissions, insecure context); leave the button
        // as-is rather than showing a false confirmation.
      });
    }, { signal });
    signal.addEventListener('abort', () => clearTimeout(copiedTimer), { once: true });
    actions.appendChild(copyBtn);
  }

  private firePreviewRendered(snapshot: MdzipWorkspaceSnapshot, generation: number): void {
    if (generation !== this.previewGeneration) {
      return;
    }
    try {
      this.options.onPreviewRendered?.(snapshot);
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private fireAssetsHydrated(snapshot: MdzipWorkspaceSnapshot, generation: number): void {
    if (generation !== this.previewGeneration) {
      return;
    }
    this.previewHydrated = true;
    try {
      this.options.onAssetsHydrated?.(snapshot);
    } catch (error) {
      this.options.onFailed?.(error);
    }
    this.flushRenderedWaiters();
  }

  private flushRenderedWaiters(): void {
    const waiters = this.renderedWaiters;
    this.renderedWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  /**
   * Resolves once the current preview (including any images) is mounted and
   * hydrated. Resolves immediately when the latest preview is already ready.
   * Useful for revealing or animating content without observing private DOM.
   */
  public whenRendered(): Promise<void> {
    if (this.previewHydrated) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.renderedWaiters.push(resolve));
  }

  private createMarkdownContext(
    snapshot: MdzipWorkspaceSnapshot,
    signal: AbortSignal
  ): MdzipMarkdownRenderContext {
    return {
      currentPath: snapshot.currentPath,
      sourceFormat: snapshot.sourceFormat,
      colorScheme: this.colorScheme,
      mode: snapshot.mode,
      manifest: snapshot.content.manifest,
      assetResolver: {
        resolveAssetUrl: (path: string) =>
          this.assetSession?.resolveKnown(path, snapshot.currentPath)
      },
      signal
    };
  }

  /**
   * Entry renderer lifecycle. Renders are keyed by
   * (path, pathType, mode, sourceFormat): same key keeps the mounted handle
   * (calling `update()` when colorScheme or manifest changed), a changed key
   * destroys it and re-runs matching. Rename/move/delete of the backing entry
   * changes the path and is therefore handled as a selection change.
   */
  private syncEntryRenderer(snapshot: MdzipWorkspaceSnapshot): boolean {
    if (this.entryRenderers.length === 0) {
      return false;
    }
    const matchKey = [
      snapshot.currentPath,
      snapshot.currentPathType,
      snapshot.mode,
      snapshot.sourceFormat
    ].join('\u0000');

    if (this.entryState?.key === matchKey) {
      this.maybeUpdateEntryRenderer(snapshot);
      return true;
    }
    if (this.entryState) {
      this.teardownEntryRenderer();
    }
    if (this.entryMatchMissKey === matchKey) {
      return false;
    }

    const abort = new AbortController();
    const context = this.createEntryContext(snapshot, abort.signal);
    const renderer = this.matchEntryRenderer(context);
    if (!renderer) {
      this.entryMatchMissKey = matchKey;
      return false;
    }
    this.entryMatchMissKey = null;

    const generation = ++this.entryGeneration;
    const state = {
      key: matchKey,
      renderer,
      handle: null as MdzipEntryRenderHandle | null,
      abort,
      lastColorScheme: this.colorScheme,
      lastManifest: snapshot.content.manifest as unknown
    };
    this.entryState = state;
    this.elEntryPane.replaceChildren();

    try {
      const mounted = renderer.mount(this.elEntryPane, context);
      if (isThenable(mounted)) {
        void Promise.resolve(mounted).then((handle) => {
          if (this.entryGeneration !== generation || this.entryState !== state) {
            // Stale mount: the selection moved on while mounting.
            try {
              handle?.destroy();
            } catch {
              // Stale handle cleanup failure is not actionable.
            }
            return;
          }
          state.handle = handle ?? null;
        }).catch((error) => {
          if (this.entryGeneration === generation) {
            this.options.onFailed?.(error);
          }
        });
      } else {
        state.handle = mounted ?? null;
      }
    } catch (error) {
      this.options.onFailed?.(error);
    }
    return true;
  }

  private maybeUpdateEntryRenderer(snapshot: MdzipWorkspaceSnapshot): void {
    const state = this.entryState;
    if (!state) {
      return;
    }
    const manifest = snapshot.content.manifest as unknown;
    if (state.lastColorScheme === this.colorScheme && state.lastManifest === manifest) {
      return;
    }
    state.lastColorScheme = this.colorScheme;
    state.lastManifest = manifest;
    if (!state.handle?.update) {
      return;
    }
    const context = this.createEntryContext(snapshot, state.abort.signal);
    try {
      const result = state.handle.update(context);
      if (isThenable(result)) {
        void Promise.resolve(result).catch((error) => this.options.onFailed?.(error));
      }
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private matchEntryRenderer(context: MdzipEntryRenderContext): MdzipEntryRenderer | null {
    const byPriority = [...this.entryRenderers]
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    for (const renderer of byPriority) {
      try {
        if (renderer.matches(context)) {
          return renderer;
        }
      } catch (error) {
        this.options.onFailed?.(error);
      }
    }
    return null;
  }

  private teardownEntryRenderer(): void {
    const active = this.entryState;
    if (!active) {
      return;
    }
    this.entryState = null;
    this.entryGeneration += 1;
    active.abort.abort();
    try {
      active.handle?.destroy();
    } catch (error) {
      this.options.onFailed?.(error);
    }
    this.elEntryPane.replaceChildren();
  }

  private createEntryContext(
    snapshot: MdzipWorkspaceSnapshot,
    signal: AbortSignal
  ): MdzipEntryRenderContext {
    const workspace = this.workspace;
    const path = snapshot.currentPath;
    return {
      path,
      pathType: snapshot.currentPathType,
      mode: snapshot.mode,
      sourceFormat: snapshot.sourceFormat,
      colorScheme: this.colorScheme,
      manifest: snapshot.content.manifest,
      snapshot,
      signal,
      readBytes: async () => {
        const bytes = await workspace?.readPathBytes(path);
        if (!bytes) {
          throw new Error(`Cannot read bytes for "${path}".`);
        }
        return bytes;
      },
      updateManifest: async (manifest) => {
        if (!workspace) {
          throw new Error('Workspace is not open.');
        }
        await workspace.updateManifest(manifest);
      }
    };
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
        this.lineNumbersCompartment.of(this.controlPolicy.lineNumbers ? lineNumbers() : []),
        this.searchCompartment.of(this.controlPolicy.search ? [search({ top: true }), keymap.of(searchKeymap)] : []),
        history(),
        keymap.of([
          { key: 'Mod-b', run: () => self.runFormatShortcut('bold') },
          { key: 'Mod-i', run: () => self.runFormatShortcut('italic') },
          { key: 'Mod-k', run: () => self.runFormatShortcut('link') }
        ]),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown(),
        syntaxHighlighting(mdzipMarkdownHighlight),
        hardBreakMarkerHighlight,
        htmlTagMarkerHighlight,
        noSpellcheckHighlight,
        imageEditAffordanceField,
        EditorView.lineWrapping,
        dropCursor(),
        // Content is contenteditable, but browsers don't agree on a default
        // for unconfigured spellcheck there — set it explicitly (#33).
        EditorView.contentAttributes.of({ spellcheck: 'true' }),
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
          },
          dragover(event) {
            if (!self.canAcceptEditorDrop()) {
              return;
            }
            const types = event.dataTransfer?.types;
            if (types?.includes('application/x-mdzip-path') || types?.includes('Files')) {
              event.preventDefault();
              if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'copy';
              }
              return true;
            }
          },
          drop(event) {
            if (!self.canAcceptEditorDrop()) {
              return;
            }
            const archivePath = event.dataTransfer?.getData('application/x-mdzip-path');
            if (archivePath) {
              event.preventDefault();
              self.insertArchiveLinkAtCoords(archivePath, event.clientX, event.clientY);
              return true;
            }
            const file = event.dataTransfer?.files?.[0];
            if (file && (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name))) {
              event.preventDefault();
              void self.handleEditorImageDrop(file, event.clientX, event.clientY);
              return true;
            }
          },
          click(event, view) {
            // Fully inert unless a host has opted in — no parse cost, no
            // widget, matching #39's "default editor behavior unchanged".
            if (!self.options.imageEditHandler) {
              return;
            }
            const target = event.target as HTMLElement;
            if (target.closest('[data-mdzip-image-edit-affordance]')) {
              return;
            }
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            const hit = pos === null ? null : findImageReferenceAtOffset(view.state, pos);
            view.dispatch({ effects: imageEditAffordanceEffect.of(hit ? { from: hit.from, to: hit.to } : null) });
          },
          blur(_event, view) {
            view.dispatch({ effects: imageEditAffordanceEffect.of(null) });
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

    editor.dom.addEventListener(IMAGE_EDIT_AFFORDANCE_CLICK_EVENT, (event) => {
      const { from, to } = (event as CustomEvent<{ from: number; to: number }>).detail;
      void self.openImageEditFlow(from, to);
    });

    return editor;
  }

  private async ensureCmEditor(force = false): Promise<EditorView | null> {
    const snapshot = this.workspace?.snapshot();
    if (this.cmEditor || !snapshot || (!force && this.layout === 'preview')
      || !canShowSourceLayout(snapshot)) {
      return this.cmEditor;
    }
    this.cmEditor = this.createCmEditor(
      this.elEditorHost,
      snapshot.currentText,
      snapshot.mode
    );
    return this.cmEditor;
  }

  private render(): void {
    const snapshot = this.workspace?.snapshot() ?? null;

    this.elEmptyState.hidden = snapshot !== null;
    this.elWorkspaceShell.hidden = snapshot === null;

    // Must run before the no-snapshot early return below: the pack-files dialog is
    // deciding how to create a workspace, so it opens (via openPackFilesDialog ->
    // render()) precisely when no workspace exists yet. Bug found 2026-08-19 —
    // this used to live after the return, making it dead code for this dialog's
    // entire lifetime; the dialog's state was set correctly but never reached the
    // DOM, leaving the empty-state placeholder showing and the caller's promise
    // hanging forever.
    this.elPackFilesDialog.hidden = this.packFilesDialogState === null;
    if (this.packFilesDialogState) {
      const { request } = this.packFilesDialogState;
      this.elPackFilesEntrySelect.innerHTML = request.markdownFiles
        .map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
        .join('');
      this.elPackFilesEntrySelect.value = request.suggestedEntryPoint;
      this.elPackFilesModeDocument.checked = true;
      this.elPackFilesModeProject.checked = false;
    }

    if (!snapshot) {
      this.elDocumentStrip.hidden = true;
      this.elToolbar.hidden = true;
      return;
    }

    this.layout = this.validLayoutForSnapshot(this.layout, snapshot);
    const entryClaimed = this.syncEntryRenderer(snapshot);
    const canEdit = !entryClaimed
      && canEditMdzipPath(snapshot.currentPathType, snapshot.currentPath, snapshot.mode);
    const canShowSource = canShowSourceLayout(snapshot);
    const showNavigationControl = this.controlPolicy.navigation;
    const showTitleControl = this.controlPolicy.title.visible;
    const showLayoutControls = Object.values(this.controlPolicy.layout).some(Boolean);
    const showSaveControl = this.controlPolicy.save && snapshot.mode !== 'read-only';
    const showZoomControl = this.controlPolicy.zoom;
    const showColorSchemeControl = this.controlPolicy.colorScheme;
    const showSearchControl = this.controlPolicy.search
      && canShowSource && snapshot.currentPathType === 'markdown';
    const showEditControls = canEdit
      && snapshot.currentPathType === 'markdown'
      && this.layout !== 'preview'
      && hasFormattingControls(this.controlPolicy.formatting);
    const showToolbar = this.controlPolicy.toolbar
      && (showNavigationControl || showLayoutControls || showSaveControl
        || showZoomControl || showColorSchemeControl || showSearchControl || showEditControls);

    this.elDocumentStrip.hidden = !showTitleControl;
    this.elToolbar.hidden = !showToolbar;
    this.elToolbarLeft.hidden = !showNavigationControl;
    this.elEditToolbar.hidden = !showEditControls;
    this.elLayoutControls.hidden = !showLayoutControls;
    this.elToolbarControls.hidden = !showSaveControl && !showZoomControl
      && !showColorSchemeControl && !showSearchControl;
    this.elNavBtn.hidden = !showNavigationControl;
    this.elPreviewBtn.hidden = !this.controlPolicy.layout.preview;
    this.elSplitBtn.hidden = !this.controlPolicy.layout.split;
    this.elSourceBtn.hidden = !this.controlPolicy.layout.source;
    this.elSaveBtn.hidden = !showSaveControl;
    this.elSearchBtn.hidden = !showSearchControl;
    this.elZoomBtn.hidden = !showZoomControl;
    this.elThemeControls.hidden = !showColorSchemeControl;

    this.elRoot.style.setProperty('--mdz-zoom', String(this.zoom));
    this.elRoot.style.setProperty('--nav-pane-width', `${this.navPaneWidth}px`);
    this.elRoot.style.setProperty('--split-edit-ratio', String(this.splitRatio));
    const previewMaxWidthPx = resolvePreviewMaxWidthPx(this.previewMaxWidth);
    if (previewMaxWidthPx === undefined) {
      this.elRoot.style.removeProperty('--mdzip-preview-content-max-width');
    } else {
      this.elRoot.style.setProperty('--mdzip-preview-content-max-width', `${previewMaxWidthPx}px`);
    }
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
    if (snapshot.sourceFormat === 'markdown') {
      this.elNavBtn.innerHTML = CONVERT_TO_MDZ_ICON_HTML;
      this.elNavBtn.classList.remove('active');
      this.elNavBtn.classList.add('convert-mdz-toggle');
      this.elNavBtn.setAttribute('title', 'Convert to MDZ');
      this.elNavBtn.setAttribute('aria-label', 'Convert to MDZ');
      this.elNavBtn.dataset['tooltip'] = 'Convert to MDZ';
      this.elNavBtn.removeAttribute('aria-pressed');
    } else {
      this.elNavBtn.innerHTML = NAV_TOGGLE_ICON_HTML;
      this.elNavBtn.classList.remove('convert-mdz-toggle');
      this.elNavBtn.classList.toggle('active', this.navVisible);
      this.elNavBtn.setAttribute('title', 'Toggle contents');
      this.elNavBtn.setAttribute('aria-label', 'Toggle contents');
      this.elNavBtn.dataset['tooltip'] = 'Toggle contents';
      this.elNavBtn.setAttribute('aria-pressed', String(this.navVisible));
    }
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

    this.prunePendingFolders(snapshot);
    const navTree = snapshot.sourceFormat === 'mdz'
      ? mergePendingFolders(buildMdzipNavTree(snapshot.content.paths, snapshot.content.entryPoint), this.pendingNewFolders)
      : [];
    const allowOrphanActions = this.controlPolicy.orphanActions && snapshot.mode !== 'read-only';
    const allowFileActions = this.allowFileActions(snapshot);
    const navRenderOptions: NavRenderOptions = {
      allowOrphanActions,
      allowFileActions,
      allowDrag: snapshot.mode !== 'read-only' && snapshot.sourceFormat === 'mdz',
      pendingFolders: new Set([...this.pendingNewFolders].map((path) => path.toLowerCase()))
    };
    this.elNavTree.innerHTML = navTree
      .map((n, i) => renderNavNode(n, snapshot, navRenderOptions, [], i === navTree.length - 1, 0))
      .join('');
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

    this.updatePreview(snapshot, entryClaimed);

    const pt = snapshot.currentPathType;
    const showEdit = !entryClaimed && (pt === 'markdown' || pt === 'text') && this.layout !== 'preview';
    const showPreview = !entryClaimed && (pt === 'image' || pt === 'binary' || pt === 'text'
      || (pt === 'markdown' && this.layout !== 'source'));
    this.elEditPane.classList.toggle('active', showEdit);
    this.elPreviewPane.classList.toggle('active', showPreview);
    this.elEntryPane.classList.toggle('active', entryClaimed);
    this.elPaneStack.classList.toggle('split-mode', this.layout === 'split' && !entryClaimed);
    this.elPaneStack.classList.toggle('entry-claimed', entryClaimed);

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
    this.elImageInsertDialog.hidden = this.imageInsertDialogState === null;
    if (this.imageInsertDialogState) {
      this.elImageInsertAltInput.value = this.imageInsertDialogState.request.defaultAltText;
      this.elImageInsertModeMarkdown.checked = true;
      this.elImageInsertModeHtml.checked = false;
      this.elImageInsertSizeModeSelect.value = 'width';
      this.elImageInsertSizeValueInput.value = this.imageInsertDialogState.request.intrinsicWidth
        ? String(this.imageInsertDialogState.request.intrinsicWidth)
        : '';
      this.elImageInsertPositionSelect.value = 'inline';
      this.updateImageInsertOptionControls();
    }
    this.elCopyRenderDialog.hidden = this.copyRenderDialogState === null
      && this.copyReadyState === null
      && this.copyRenderDoneState === null;
    this.elCopyRenderProgressSection.hidden = this.copyRenderDialogState === null;
    this.elCopyRenderReadyText.hidden = this.copyReadyState === null;
    this.elCopyRenderDoneText.hidden = this.copyRenderDoneState === null;
    this.elCopyRenderCancelBtn.hidden = this.copyRenderDialogState === null;
    this.elCopyRenderReadyCancelBtn.hidden = this.copyReadyState === null;
    this.elCopyRenderConfirmBtn.hidden = this.copyReadyState === null;
    this.elCopyRenderDismissBtn.hidden = this.copyRenderDoneState === null;
    if (this.copyRenderDialogState) {
      this.elCopyRenderHeading.textContent = 'Copying document...';
      this.updateCopyRenderDialogProgress();
    } else if (this.copyReadyState) {
      this.elCopyRenderHeading.textContent = 'Ready to copy';
    } else if (this.copyRenderDoneState) {
      this.elCopyRenderHeading.textContent = 'Done';
      this.elCopyRenderDoneText.textContent = this.copyRenderDoneState.message;
    }
    this.elMetadataDialog.hidden = !this.metadataDialogOpen;

    if (this.contextMenuState) {
      const items = this.contextMenuState.kind === 'nav'
        ? this.navMenuItems(this.contextMenuState.target, snapshot)
        : this.contextMenuState.kind === 'editor'
          ? this.editorMenuItems(snapshot)
          : this.previewMenuItems();
      if (items.length === 0) {
        this.contextMenuState = null;
      } else {
        this.elNavMenu.innerHTML = renderContextMenuItems(items);
        this.elNavMenu.hidden = false;
        const rect = this.elNavMenu.getBoundingClientRect();
        const win = this.elRoot.ownerDocument.defaultView ?? window;
        const x = Math.max(4, Math.min(this.contextMenuState.x, win.innerWidth - rect.width - 8));
        const y = Math.max(4, Math.min(this.contextMenuState.y, win.innerHeight - rect.height - 8));
        this.elNavMenu.style.left = `${x}px`;
        this.elNavMenu.style.top = `${y}px`;
      }
    }
    if (!this.contextMenuState) {
      this.elNavMenu.hidden = true;
    }

    this.elNameDialog.hidden = this.nameDialogState === null;
    if (this.nameDialogState) {
      const headings: Record<MdzipNameDialogMode, string> = {
        'new-file': 'New Markdown File',
        'new-folder': 'New Folder',
        'rename': 'Rename File'
      };
      const confirms: Record<MdzipNameDialogMode, string> = {
        'new-file': 'Create',
        'new-folder': 'Create',
        'rename': 'Rename'
      };
      this.elNameDialogHeading.textContent = headings[this.nameDialogState.mode];
      this.elNameConfirmBtn.textContent = confirms[this.nameDialogState.mode];
      if (this.elNameInput.value !== this.nameDialogState.value) {
        this.elNameInput.value = this.nameDialogState.value;
      }
      this.elNameValidation.hidden = !this.nameDialogState.error;
      this.elNameValidation.textContent = this.nameDialogState.error;
      this.elNameConfirmBtn.disabled = Boolean(this.nameDialogState.error);
    }

    this.elDeleteDialog.hidden = this.deleteDialogState === null;
    if (this.deleteDialogState) {
      this.elDeleteDialogText.textContent =
        `Delete "${this.deleteDialogState.path}" from the archive? This cannot be undone.`;
    }
  }

  private allowFileActions(snapshot: MdzipWorkspaceSnapshot): boolean {
    return this.controlPolicy.fileActions
      && snapshot.mode !== 'read-only'
      && snapshot.sourceFormat === 'mdz';
  }

  // Drops pending folders that now contain at least one archive file (the
  // path became real) so they render as normal directories.
  private prunePendingFolders(snapshot: MdzipWorkspaceSnapshot): void {
    if (this.pendingNewFolders.size === 0 || snapshot.sourceFormat !== 'mdz') {
      this.pendingNewFolders.clear();
      return;
    }
    const lowerPaths = snapshot.content.paths.map((entry) => entry.path.toLowerCase());
    for (const folder of [...this.pendingNewFolders]) {
      if (lowerPaths.some((path) => path.startsWith(`${folder.toLowerCase()}/`))) {
        this.pendingNewFolders.delete(folder);
      }
    }
  }

  private attachEvents(): void {
    const doc = this.elRoot.ownerDocument;

    doc.addEventListener('click', () => {
      this.closeFormatMenus();
      if (this.zoomOpen || this.contextMenuState) {
        this.zoomOpen = false;
        this.contextMenuState = null;
        this.render();
      }
    });

    doc.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') {
        return;
      }
      if (this.contextMenuState || this.deleteDialogState || this.nameDialogState) {
        this.contextMenuState = null;
        this.deleteDialogState = null;
        this.nameDialogState = null;
        this.render();
      }
    });

    // Ctrl/Cmd+A normally selects the whole page, which in split layout grabs
    // both panes' text at once. Scope it to a Copy All of the rendered
    // content instead when focus is inside the preview pane (see the
    // mousedown handler below for how it gets there); the source editor
    // keeps its own defaultKeymap binding since CodeMirror's content root
    // sits outside this element.
    doc.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() !== 'a' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) {
        return;
      }
      if (!doc.activeElement || !this.elPreviewPane.contains(doc.activeElement)) {
        return;
      }
      e.preventDefault();
      void this.copyAllPreviewContent();
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
      if (this.navVisible && this.workspace) {
        void this.workspace.ensureOrphanedAssetsAnalyzed().then((updated) => {
          if (updated) {
            this.render();
          }
        });
      }
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
      if (this.controlPolicy.layout.preview) { void this.setLayout('preview'); }
    });
    this.elSplitBtn.addEventListener('click', () => {
      if (this.controlPolicy.layout.split) { void this.setLayout('split'); }
    });
    this.elSourceBtn.addEventListener('click', () => {
      if (this.controlPolicy.layout.source) { void this.setLayout('source'); }
    });

    this.elSaveBtn.addEventListener('click', () => {
      if (this.controlPolicy.save) { void this.save(); }
    });

    this.elSearchBtn.addEventListener('click', () => {
      void this.openSearch();
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
    this.elDarkThemeBtn.addEventListener('click', () => this.setColorSchemeFromToolbar('dark'));
    this.elLightThemeBtn.addEventListener('click', () => this.setColorSchemeFromToolbar('light'));

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
        void this.insertImageFile(file, 'picker');
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
        this.showNavMenuForPath(orphanBtn.getAttribute('data-orphan-path')!, e);
        return;
      }
      const navFile = target.closest<HTMLElement>('[data-nav-path]');
      if (navFile) {
        void this.openPath(navFile.getAttribute('data-nav-path')!);
      }
    });

    this.elNavPane.addEventListener('contextmenu', (e) => {
      const target = this.navMenuTargetFromElement(e.target as HTMLElement);
      if (!target) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.showNavMenu(target, e);
    });

    this.elNavTree.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const orphanBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-orphan-path]');
        if (this.controlPolicy.orphanActions && orphanBtn) {
          e.preventDefault();
          this.showNavMenuForPath(orphanBtn.getAttribute('data-orphan-path')!, e);
        }
      }
    });

    this.attachNavDragAndDrop();

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
    this.elImageInsertDialog.querySelector<HTMLButtonElement>('[data-action="cancel-image-insert"]')!
      .addEventListener('click', () => {
        this.resolveImageInsertDialog(null);
      });
    this.elImageInsertConfirmBtn.addEventListener('click', () => {
      this.resolveImageInsertDialog(this.readImageInsertDialogDecision());
    });
    this.elImageInsertModeMarkdown.addEventListener('change', () => this.updateImageInsertOptionControls());
    this.elImageInsertModeHtml.addEventListener('change', () => this.updateImageInsertOptionControls());
    this.elImageInsertSizeModeSelect.addEventListener('change', () => {
      this.resetImageInsertSizeValue();
      this.updateImageInsertOptionControls();
    });
    this.elPackFilesDialog.querySelector<HTMLButtonElement>('[data-action="cancel-pack-files"]')!
      .addEventListener('click', () => {
        this.resolvePackFilesDialog(null);
      });
    this.elPackFilesConfirmBtn.addEventListener('click', () => {
      this.resolvePackFilesDialog(this.readPackFilesDialogDecision());
    });
    this.elCopyRenderDialog.querySelector<HTMLButtonElement>('[data-action="cancel-copy-render"]')!
      .addEventListener('click', () => {
        this.copyRenderDialogState?.abort.abort();
      });
    this.elCopyRenderDialog.querySelector<HTMLButtonElement>('[data-action="cancel-copy-ready"]')!
      .addEventListener('click', () => {
        this.copyReadyState = null;
        this.render();
      });
    this.elCopyRenderDialog.querySelector<HTMLButtonElement>('[data-action="confirm-copy-ready"]')!
      .addEventListener('click', () => {
        // Must call the actual write synchronously from this handler (no
        // awaits ahead of it) — this click is the fresh user gesture the
        // Clipboard API needs; losing it to another async hop before the
        // write starts would defeat the entire reason this button exists.
        void this.performReadyCopy();
      });
    this.elCopyRenderDialog.querySelector<HTMLButtonElement>('[data-action="dismiss-copy-render"]')!
      .addEventListener('click', () => {
        this.copyRenderDoneState = null;
        this.render();
      });

    this.elNavMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-menu-action]');
      if (!item) {
        return;
      }
      const action = item.dataset['menuAction'] ?? '';
      if (this.contextMenuState?.kind === 'editor') {
        void this.handleEditorMenuAction(action);
      } else if (this.contextMenuState?.kind === 'preview') {
        this.handlePreviewMenuAction(action);
      } else {
        void this.handleNavMenuAction(action);
      }
    });

    // Flyout submenus open to the right and aligned with their parent by
    // default; nudge them within the viewport. Runs on hover (when the submenu
    // is already displayed, so it can be measured): flips left when it would
    // overflow the right edge, and shifts up when a tall list (e.g. the code
    // languages) would run off the bottom.
    this.elNavMenu.addEventListener('pointerover', (e) => {
      const wrap = (e.target as HTMLElement).closest<HTMLElement>('.nav-menu-submenu-wrap');
      if (!wrap) {
        return;
      }
      const submenu = wrap.querySelector<HTMLElement>('.nav-context-submenu');
      if (!submenu) {
        return;
      }
      const win = this.elRoot.ownerDocument.defaultView ?? window;
      const margin = 8;
      const rect = wrap.getBoundingClientRect();
      const width = submenu.offsetWidth || SUBMENU_ESTIMATED_WIDTH;
      wrap.classList.toggle('open-left', rect.right + width > win.innerWidth - margin);

      // Vertical: clamp the flyout's top so its full height stays on-screen.
      // `top` is relative to the parent row (CSS default is -5px).
      const naturalTop = rect.top - 5;
      const clampedTop = Math.max(
        margin,
        Math.min(naturalTop, win.innerHeight - margin - submenu.offsetHeight)
      );
      submenu.style.top = `${clampedTop - rect.top}px`;
    });

    this.elEditorHost.addEventListener('contextmenu', (e) => {
      if (!this.controlPolicy.contextMenu.editor) {
        return;
      }
      const snapshot = this.workspace?.snapshot();
      if (!snapshot || !this.cmEditor) {
        return;
      }
      const selection = this.cmEditor.state.selection.main;
      this.contextMenuState = {
        kind: 'editor',
        from: selection.from,
        to: selection.to,
        x: e.clientX,
        y: e.clientY
      };
      if (this.editorMenuItems(snapshot).length === 0) {
        this.contextMenuState = null;
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.render();
    });

    this.elPreviewPane.addEventListener('contextmenu', (e) => {
      if (!this.controlPolicy.contextMenu.preview) {
        return;
      }
      // Captured now, not read live in the click handler: clicking the menu
      // button collapses the browser selection before the action runs (same
      // reason the editor menu captures its CodeMirror range up front).
      const domSelection = this.elPreviewPane.ownerDocument.defaultView?.getSelection();
      const text = domSelection && !domSelection.isCollapsed
        && this.elPreviewContent.contains(domSelection.anchorNode)
        ? domSelection.toString()
        : '';
      this.contextMenuState = { kind: 'preview', text, x: e.clientX, y: e.clientY };
      if (this.previewMenuItems().length === 0) {
        this.contextMenuState = null;
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.render();
    });

    this.elNameInput.addEventListener('input', () => {
      if (!this.nameDialogState) {
        return;
      }
      this.nameDialogState.value = this.elNameInput.value;
      this.nameDialogState.error = this.validateNameDialog(this.nameDialogState);
      this.elNameValidation.hidden = !this.nameDialogState.error;
      this.elNameValidation.textContent = this.nameDialogState.error;
      this.elNameConfirmBtn.disabled = Boolean(this.nameDialogState.error);
    });
    this.elNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        void this.confirmNameDialog();
      }
    });
    this.elNameDialog.querySelector<HTMLButtonElement>('[data-action="cancel-name"]')!
      .addEventListener('click', () => {
        this.nameDialogState = null;
        this.render();
      });
    this.elNameConfirmBtn.addEventListener('click', () => {
      void this.confirmNameDialog();
    });

    this.elDeleteDialog.querySelector<HTMLButtonElement>('[data-action="cancel-delete"]')!
      .addEventListener('click', () => {
        this.deleteDialogState = null;
        this.render();
      });
    this.elDeleteConfirmBtn.addEventListener('click', () => {
      const path = this.deleteDialogState?.path;
      this.deleteDialogState = null;
      this.render();
      if (path) {
        void this.deleteFile(path);
      }
    });

    this.elReplaceInput.addEventListener('change', () => {
      const file = this.elReplaceInput.files?.[0];
      const path = this.pendingReplacePath;
      this.elReplaceInput.value = '';
      this.pendingReplacePath = null;
      if (file && path) {
        void this.replaceFileFromPicker(path, file);
      }
    });

    this.elPreviewPane.addEventListener('scroll', () => this.syncScrollFromPreview());
    // Gives the pane logical focus on click so a subsequent Ctrl/Cmd+A (below)
    // can be scoped to it. tabindex="-1" keeps it out of Tab order; this is
    // the only way it becomes focused.
    this.elPreviewPane.addEventListener('mousedown', () => {
      this.elPreviewPane.focus({ preventScroll: true });
    });
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

  /** Briefly shows a status message (e.g. "Text copied to clipboard") near the bottom of the view, auto-hiding after a couple of seconds. */
  private showCopyToast(message: string): void {
    if (this.copyToastHideTimer) {
      clearTimeout(this.copyToastHideTimer);
    }
    this.elCopyToast.textContent = message;
    this.elCopyToast.hidden = false;
    this.copyToastHideTimer = setTimeout(() => {
      this.elCopyToast.hidden = true;
      this.copyToastHideTimer = null;
    }, 2000);
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
    const isMdz = snapshot.sourceFormat === 'mdz';
    const fields: Array<[string, string]> = [
      ['Filename', snapshot.fileName],
      ['Format', isMdz ? 'MDZ package' : 'Markdown'],
      // For .mdz, archiveBytes really is what a save right now would write —
      // current in-memory bytes, edits included, not a stale re-read of disk.
      // For plain Markdown, archiveBytes is *not* that: it's some internally
      // wrapped representation with its own fixed overhead (verified: a
      // 5-byte markdown document reported 462 "archive" bytes) — use the
      // actual text's encoded size instead, which is what a .md save writes.
      ['Size', formatByteSize(
        isMdz ? snapshot.archiveBytes.length : new TextEncoder().encode(snapshot.currentText).length
      )],
      ['Document title', snapshot.displayTitle],
      ['First heading', snapshot.headingFallback ?? 'Not found'],
      ['Created', formatMetadataValue(manifest?.created)],
      ['Modified', formatMetadataValue(manifest?.modified)],
      ['Entry point', isMdz ? snapshot.content.entryPoint : 'Not applicable'],
      ['Documents', isMdz ? String(snapshot.workspace.documents.length) : 'Not applicable'],
      ['Assets', isMdz ? String(snapshot.workspace.assets.length) : 'Not applicable']
    ];
    // Only shown when actually read-only — most documents are editable, and a
    // "Read-only: No" row for the common case would just be noise. Spelled
    // out as a filesystem condition rather than an editor state: this mode is
    // driven entirely by the host (see MdzipWorkspaceOpenOptions.mode) — most
    // often because a host checked the file's OS/disk permissions, as the
    // vscode extension does — not something toggled inside the editor itself,
    // so the wording should point users at their file, not at this UI.
    if (snapshot.mode === 'read-only') {
      fields.splice(1, 0, ['Read-only', 'Yes — the file on disk (or its host) is not writable']);
    }

    this.elMetadataList.replaceChildren(...fields.map(([label, value]) => {
      return this.createMetadataRow(label, value);
    }));
    const libraries = [
      ...(this.options.libraries ?? []),
      ...MDZIP_RUNTIME_LIBRARIES
    ].filter((library, index, all) =>
      all.findIndex((candidate) => candidate.name === library.name) === index
    );
    this.elLibraryList.replaceChildren(...libraries.map((library) => {
      return this.createLibraryRow(library);
    }));
  }

  private createMetadataRow(label: string, value: string): HTMLElement {
    const row = this.elRoot.ownerDocument.createElement('div');
    row.className = 'metadata-row';
    const term = this.elRoot.ownerDocument.createElement('dt');
    term.textContent = label;
    const detail = this.elRoot.ownerDocument.createElement('dd');
    detail.textContent = value;
    row.append(term, detail);
    return row;
  }

  private createLibraryRow(library: MdzipLibraryInfo): HTMLElement {
    const row = this.elRoot.ownerDocument.createElement('div');
    row.className = 'metadata-row library-row';
    const term = this.elRoot.ownerDocument.createElement('dt');
    const name = this.elRoot.ownerDocument.createElement('span');
    name.className = 'library-name';
    if (library.repositoryUrl) {
      const link = this.elRoot.ownerDocument.createElement('a');
      link.href = library.repositoryUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = library.name;
      link.setAttribute('aria-label', `${library.name} repository`);
      name.append(link);
    } else {
      name.textContent = library.name;
    }
    const version = this.elRoot.ownerDocument.createElement('span');
    version.className = 'library-version';
    version.textContent = library.version;
    term.append(name, version);
    const detail = this.elRoot.ownerDocument.createElement('dd');
    if (library.description) {
      const description = this.elRoot.ownerDocument.createElement('span');
      description.className = 'library-description';
      description.textContent = library.description;
      detail.append(description);
    }
    row.append(term, detail);
    return row;
  }

  private requestMdzConversion(action: MdzipConversionAction): void {
    const snapshot = this.workspace?.snapshot();
    if (!snapshot || snapshot.mode === 'read-only' || snapshot.sourceFormat !== 'markdown') {
      return;
    }
    const hook = this.options.onConversionRequested;
    if (!hook) {
      this.openConversionDialog(action);
      return;
    }
    if (this.conversionHookPending) {
      return;
    }
    this.conversionHookPending = true;
    const context = this.createConversionContext(action);
    void Promise.resolve()
      .then(() => hook(action, context))
      .then((handled) => {
        this.conversionHookPending = false;
        if (!handled) {
          this.openConversionDialog(action);
        }
      })
      .catch((error) => {
        this.conversionHookPending = false;
        this.options.onFailed?.(error);
        this.openConversionDialog(action);
      });
  }

  private createConversionContext(action: MdzipConversionAction): MdzipConversionContext {
    const workspace = this.workspace;
    const snapshot = workspace?.snapshot();
    const selection = this.cmEditor?.state.selection.main;
    const captured = workspace && snapshot ? {
      workspace,
      documentGeneration: this.conversionDocumentGeneration,
      path: snapshot.currentPath,
      text: snapshot.currentText,
      selectionStart: selection?.from,
      selectionEnd: selection?.to
    } : null;
    let consumed = false;

    const take = (): typeof captured => {
      if (consumed || !captured || this.workspace !== captured.workspace
        || this.conversionDocumentGeneration !== captured.documentGeneration) {
        return null;
      }
      const current = captured.workspace.snapshot();
      if (current.mode === 'read-only'
        || current.sourceFormat !== 'markdown'
        || current.currentPath !== captured.path
        || current.currentText !== captured.text) {
        return null;
      }
      consumed = true;
      return captured;
    };

    return {
      insertMarkdown: async (text) => {
        const target = take();
        if (!target || target.selectionStart === undefined || target.selectionEnd === undefined) {
          return false;
        }
        const nextText = target.text.slice(0, target.selectionStart)
          + text
          + target.text.slice(target.selectionEnd);
        target.workspace.editText(nextText);
        this.render();
        const editor = await this.ensureCmEditor();
        if (editor) {
          editor.dispatch({ selection: { anchor: target.selectionStart + text.length } });
          editor.focus();
        }
        return true;
      },
      convertToMdz: async () => {
        const target = take();
        if (!target || !await this.convertToMdz()) {
          return false;
        }
        if (action.kind === 'navigation') {
          this.navVisible = true;
          this.render();
          return true;
        }
        const editor = await this.ensureCmEditor();
        if (editor && target.selectionStart !== undefined) {
          editor.dispatch({ selection: { anchor: target.selectionStart } });
        }
        if (action.kind === 'image-file') {
          await this.insertImageFile(action.file, action.source ?? 'picker');
          return true;
        }
        this.elImageInput.click();
        return true;
      }
    };
  }

  private openConversionDialog(action: MdzipConversionAction): void {
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
      await this.insertImageFile(action.file, action.source ?? 'picker');
      return;
    }
    this.elImageInput.click();
  }

  /**
   * Packs an already-collected file list (e.g. from a host folder picker)
   * into a new .mdz workspace. With 0 or 1 Markdown files among `files`,
   * packs Document mode immediately with no prompt. With more than one,
   * asks `onPackRequested` (if set) to decide Document vs. Project mode and
   * the entry point; falls back to a built-in dialog if the hook is absent,
   * declines, or throws. Document mode opens the result in memory; Project
   * mode returns the archive bytes without opening them, since only the
   * host knows where a project archive should be saved.
   */
  public async packFilesAsWorkspace(
    files: readonly MdzipPackFilesInput[],
    options: { title?: string; fileName?: string } = {}
  ): Promise<MdzipPackFilesResult | null> {
    const markdownFiles = files.filter((f) => isMarkdownArchivePath(f.path)).map((f) => f.path);

    if (markdownFiles.length <= 1) {
      const entryPoint = markdownFiles[0] ?? 'index.md';
      return this.applyPackDecision(files, { mode: 'document', entryPoint }, options);
    }

    const suggestedEntryPoint = resolveMarkdownEntryPoint(markdownFiles);
    const request: MdzipPackFilesRequest = { files, markdownFiles, suggestedEntryPoint };
    const hook = this.options.onPackRequested;

    if (hook) {
      const context = this.createPackFilesContext(files, options);
      let applied: MdzipPackFilesResult | null = null;
      const wrappedContext: MdzipPackFilesContext = {
        applyDecision: async (decision) => {
          applied = await context.applyDecision(decision);
          return applied;
        }
      };
      let handled = false;
      try {
        handled = await hook(request, wrappedContext);
      } catch (error) {
        this.options.onFailed?.(error);
      }
      if (handled) {
        return applied;
      }
    }

    const decision = await this.openPackFilesDialog(request);
    return decision ? this.applyPackDecision(files, decision, options) : null;
  }

  private createPackFilesContext(
    files: readonly MdzipPackFilesInput[],
    options: { title?: string; fileName?: string }
  ): MdzipPackFilesContext {
    return { applyDecision: (decision) => this.applyPackDecision(files, decision, options) };
  }

  private async applyPackDecision(
    files: readonly MdzipPackFilesInput[],
    decision: MdzipPackFilesDecision,
    options: { title?: string; fileName?: string }
  ): Promise<MdzipPackFilesResult> {
    const archiveBytes = await buildPackedArchiveBytes(files, {
      mode: decision.mode,
      entryPoint: decision.entryPoint,
      title: options.title ?? 'document'
    });
    if (decision.mode === 'document') {
      await this.open(archiveBytes, { mode: 'editable', fileName: options.fileName ?? 'document.mdz' });
      return { mode: 'document', entryPoint: decision.entryPoint, archiveBytes, opened: true };
    }
    return { mode: 'project', entryPoint: decision.entryPoint, archiveBytes, opened: false };
  }

  private openPackFilesDialog(request: MdzipPackFilesRequest): Promise<MdzipPackFilesDecision | null> {
    return new Promise((resolve) => {
      this.resolvePackFilesDialog(null); // cancel any prior pending dialog, same as image-insert
      this.packFilesDialogState = { request, files: request.files, resolve };
      this.render();
      requestAnimationFrame(() => this.elPackFilesConfirmBtn.focus());
    });
  }

  private resolvePackFilesDialog(decision: MdzipPackFilesDecision | null): void {
    const state = this.packFilesDialogState;
    if (!state) {
      return;
    }
    this.packFilesDialogState = null;
    this.render();
    state.resolve(decision);
  }

  private readPackFilesDialogDecision(): MdzipPackFilesDecision {
    return {
      mode: this.elPackFilesModeProject.checked ? 'project' : 'document',
      entryPoint: this.elPackFilesEntrySelect.value
    };
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
          [new Blob([image.bytes as unknown as BlobPart], { type: image.mimeType })],
          `pasted.${extension}`,
          { type: image.mimeType }
        );
        this.requestMdzConversion({ kind: 'image-file', file: pastedFile, source: 'paste' });
        return;
      }

      await this.insertImageBytes(image.bytes, image.mimeType, {
        fileName: `pasted.${extensionForMime(image.mimeType)}`,
        source: 'paste'
      });
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private async insertImageFile(file: File, source: MdzipImageInsertSource = 'picker'): Promise<void> {
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)) {
      return;
    }
    try {
      await this.insertImageBytes(
        new Uint8Array(await file.arrayBuffer()),
        file.type || imageMimeTypeFromFileName(file.name),
        { fileName: file.name, source }
      );
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private async insertImageBytes(
    bytes: Uint8Array,
    mimeType: string,
    options: { fileName?: string; source: MdzipImageInsertSource }
  ): Promise<void> {
    const editor = this.cmEditor;
    if (!editor) {
      return;
    }
    const selection = editor.state.selection.main;
    const decision = await this.resolveImageInsertDecision(bytes, mimeType, options);
    if (!decision) {
      return;
    }
    const result = await this.workspace?.pasteImage({
      bytes,
      mimeType,
      selectionStart: selection.from,
      selectionEnd: selection.to,
      markdownImage: (markdownPath) => formatImageInsertMarkdown(
        markdownPath,
        decision,
        editor.state.doc.toString(),
        selection.from,
        selection.to
      )
    });
    if (result && this.cmEditor) {
      this.render();
      this.cmEditor.dispatch({ selection: { anchor: result.cursor } });
      this.cmEditor.focus();
    }
  }

  /**
   * Handles a click on an existing image's edit affordance (see
   * `imageEditAffordanceField`/the `click` domEventHandler in
   * createCmEditor). Only reachable when `imageEditHandler` is set — the
   * click handler that dispatches the affordance already gates on that.
   */
  private async openImageEditFlow(from: number, to: number): Promise<void> {
    const editor = this.cmEditor;
    const handler = this.options.imageEditHandler;
    if (!editor || !handler) {
      return;
    }
    const parsed = findImageReferenceAtOffset(editor.state, from);
    if (!parsed || parsed.from !== from || parsed.to !== to) {
      return;
    }
    const request: MdzipImageEditRequest = {
      src: parsed.src,
      altText: parsed.altText,
      width: parsed.width,
      height: parsed.height,
      position: parsed.position,
      mode: parsed.kind
    };
    let decision: MdzipImageInsertDecision | null;
    try {
      decision = normalizeImageInsertDecision(await handler(request));
    } catch (error) {
      this.options.onFailed?.(error);
      decision = null;
    }
    this.cmEditor?.dispatch({ effects: imageEditAffordanceEffect.of(null) });
    if (!decision) {
      return; // cancelled
    }
    const current = this.cmEditor;
    if (!current) {
      return;
    }
    // The handler may have awaited arbitrarily long — revalidate against the
    // live doc instead of trusting the captured range/text, in case it
    // changed underneath while the dialog was open.
    const revalidated = findImageReferenceAtOffset(current.state, from);
    if (!revalidated || revalidated.raw !== parsed.raw) {
      this.options.onFailed?.(new Error('Image reference changed before the edit could be applied.'));
      return;
    }
    const replacement = formatImageEditMarkdown(revalidated.src, decision);
    current.dispatch({
      changes: { from: revalidated.from, to: revalidated.to, insert: replacement },
      selection: { anchor: revalidated.from + replacement.length }
    });
    current.focus();
  }

  private async resolveImageInsertDecision(
    bytes: Uint8Array,
    mimeType: string,
    options: { fileName?: string; source: MdzipImageInsertSource }
  ): Promise<MdzipImageInsertDecision | null> {
    const size = sniffImageSize(bytes, mimeType);
    const request: MdzipImageInsertRequest = {
      fileName: options.fileName || `pasted.${extensionForMime(mimeType)}`,
      mimeType,
      intrinsicWidth: size?.width,
      intrinsicHeight: size?.height,
      defaultAltText: 'Pasted image',
      source: options.source
    };
    const handler = this.options.imageInsertHandler;
    if (handler) {
      try {
        const handled = await handler(request);
        if (handled !== undefined) {
          return normalizeImageInsertDecision(handled);
        }
      } catch (error) {
        this.options.onFailed?.(error);
        return null;
      }
    }
    const mode = this.options.imageInsertMode ?? 'markdown';
    if (mode === 'ask') {
      return this.openImageInsertDialog(request);
    }
    return normalizeImageInsertDecision({
      mode: mode === 'html' ? 'html' : 'markdown',
      altText: request.defaultAltText,
      width: mode === 'html' ? request.intrinsicWidth : undefined,
      height: mode === 'html' ? request.intrinsicHeight : undefined,
      position: 'inline'
    });
  }

  private openImageInsertDialog(request: MdzipImageInsertRequest): Promise<MdzipImageInsertDecision | null> {
    return new Promise((resolve) => {
      this.resolveImageInsertDialog(null);
      this.imageInsertDialogState = { request, resolve };
      this.render();
      requestAnimationFrame(() => this.elImageInsertAltInput.focus());
    });
  }

  private resolveImageInsertDialog(decision: MdzipImageInsertDecision | null): void {
    const state = this.imageInsertDialogState;
    if (!state) {
      return;
    }
    this.imageInsertDialogState = null;
    this.render();
    state.resolve(normalizeImageInsertDecision(decision));
  }

  private readImageInsertDialogDecision(): MdzipImageInsertDecision {
    const parseDimension = (value: string): number | undefined => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
    };
    const request = this.imageInsertDialogState?.request;
    const sizeMode = this.elImageInsertSizeModeSelect.value;
    const sizeValue = parseDimension(this.elImageInsertSizeValueInput.value);
    let width: number | undefined;
    let height: number | undefined;
    if (this.elImageInsertModeHtml.checked && sizeValue) {
      if (sizeMode === 'width') {
        width = sizeValue;
      } else if (sizeMode === 'height') {
        height = sizeValue;
      } else if (sizeMode === 'percent' && request?.intrinsicWidth && request.intrinsicHeight) {
        width = Math.max(1, Math.round(request.intrinsicWidth * sizeValue / 100));
        height = Math.max(1, Math.round(request.intrinsicHeight * sizeValue / 100));
      }
    }
    return {
      mode: this.elImageInsertModeHtml.checked ? 'html' : 'markdown',
      altText: this.elImageInsertAltInput.value,
      width,
      height,
      position: this.elImageInsertPositionSelect.value as MdzipImagePosition
    };
  }

  private updateImageInsertOptionControls(): void {
    const htmlMode = this.elImageInsertModeHtml.checked;
    const sizeDisabled = !htmlMode || this.elImageInsertSizeModeSelect.value === 'original';
    this.elImageInsertSizeModeSelect.disabled = !htmlMode;
    this.elImageInsertSizeValueInput.disabled = sizeDisabled;
    this.elImageInsertPositionSelect.disabled = !htmlMode;
    this.elImageInsertSizeModeSelect.closest('.image-insert-field')?.classList.toggle('field-disabled', !htmlMode);
    this.elImageInsertSizeValueInput.closest('.image-insert-field')?.classList.toggle('field-disabled', sizeDisabled);
    this.elImageInsertPositionSelect.closest('.image-insert-field')?.classList.toggle('field-disabled', !htmlMode);
  }

  private resetImageInsertSizeValue(): void {
    const request = this.imageInsertDialogState?.request;
    switch (this.elImageInsertSizeModeSelect.value) {
      case 'width':
        this.elImageInsertSizeValueInput.value = request?.intrinsicWidth ? String(request.intrinsicWidth) : '';
        break;
      case 'height':
        this.elImageInsertSizeValueInput.value = request?.intrinsicHeight ? String(request.intrinsicHeight) : '';
        break;
      case 'percent':
        this.elImageInsertSizeValueInput.value = '100';
        break;
      default:
        this.elImageInsertSizeValueInput.value = '';
        break;
    }
  }

  // Items for the editor selection menu; null entries render as separators.
  // Reads the selection range captured when the menu opened (not the live
  // selection) so the displayed actions match what the handlers will act on.
  private editorMenuItems(snapshot: MdzipWorkspaceSnapshot): Array<MdzipNavMenuItem | null> {
    const state = this.contextMenuState;
    if (!this.cmEditor || state?.kind !== 'editor') {
      return [];
    }
    const hasSelection = state.to > state.from;
    const editable = snapshot.mode !== 'read-only' && snapshot.currentPathType === 'markdown';
    const formatting = this.controlPolicy.formatting;

    const groups: Array<Array<MdzipNavMenuItem>> = [];

    const clipboard: MdzipNavMenuItem[] = [];
    if (hasSelection) {
      if (editable) {
        clipboard.push({ action: 'editor-cut', label: 'Cut', icon: MENU_CUT_ICON_HTML, shortcut: this.editorShortcut('X') });
      }
      clipboard.push({ action: 'editor-copy', label: 'Copy', icon: MENU_COPY_ICON_HTML, shortcut: this.editorShortcut('C') });
    }
    if (editable) {
      clipboard.push({ action: 'editor-paste', label: 'Paste', icon: MENU_PASTE_ICON_HTML, shortcut: this.editorShortcut('V') });
      clipboard.push({ action: 'editor-paste-plain', label: 'Paste as Plain Text', icon: MENU_PASTE_PLAIN_ICON_HTML });
    }
    if (clipboard.length > 0) {
      groups.push(clipboard);
    }

    // Formatting mirrors the toolbar's capabilities so the menu can stand in
    // for it. Inline marks and block commands apply to the current line when
    // there's no selection (same as the toolbar), so only Clear Formatting —
    // which acts on a range — is gated on a selection.
    const anyInline = formatting.bold || formatting.italic || formatting.strikethrough || formatting.inlineCode;
    const anyBlock = formatting.headings.length > 0 || formatting.bulletList
      || formatting.orderedList || formatting.blockquote || formatting.codeBlock || formatting.lineBreak;

    if (editable && anyInline) {
      const inline: MdzipNavMenuItem[] = [];
      if (formatting.bold) {
        inline.push({ action: 'bold', label: 'Bold', icon: MENU_BOLD_ICON_HTML, shortcut: this.editorShortcut('B') });
      }
      if (formatting.italic) {
        inline.push({ action: 'italic', label: 'Italic', icon: MENU_ITALIC_ICON_HTML, shortcut: this.editorShortcut('I') });
      }
      if (formatting.strikethrough) {
        inline.push({ action: 'strikethrough', label: 'Strikethrough', icon: MENU_STRIKE_ICON_HTML });
      }
      inline.push({ action: 'highlight', label: 'Highlight', icon: MENU_HIGHLIGHT_ICON_HTML });
      if (formatting.inlineCode) {
        inline.push({ action: 'inline-code', label: 'Inline Code', icon: MENU_CODE_ICON_HTML });
      }
      groups.push(inline);
    }

    if (editable && anyBlock) {
      const block: MdzipNavMenuItem[] = [];
      if (formatting.headings.length > 0) {
        block.push({
          action: '',
          label: 'Heading',
          icon: MENU_HEADING_PARENT_ICON_HTML,
          submenu: [
            { action: 'paragraph', label: 'Paragraph', icon: MENU_PARAGRAPH_ICON_HTML },
            null,
            ...formatting.headings.map((level) => ({
              action: `heading-${level}`,
              label: `Heading ${level}`,
              icon: MENU_HEADING_ICON_HTML[level]
            }))
          ]
        });
      }
      if (formatting.bulletList) {
        block.push({ action: 'bullet-list', label: 'Bullet List', icon: MENU_BULLET_LIST_ICON_HTML });
      }
      if (formatting.orderedList) {
        block.push({ action: 'ordered-list', label: 'Numbered List', icon: MENU_ORDERED_LIST_ICON_HTML });
      }
      if (formatting.blockquote) {
        block.push({ action: 'blockquote', label: 'Blockquote', icon: MENU_QUOTE_ICON_HTML });
      }
      if (formatting.codeBlock) {
        const languages = this.options.codeBlockLanguages ?? DEFAULT_CODE_BLOCK_LANGUAGES;
        block.push({
          action: '',
          label: 'Code Block',
          icon: MENU_CODE_BLOCK_ICON_HTML,
          submenu: languages.map((lang) => ({
            action: `code-block:${lang.id}`,
            label: lang.label
          }))
        });
      }
      if (formatting.lineBreak) {
        block.push({ action: 'insert-line-break', label: 'Line Break', icon: MENU_LINE_BREAK_ICON_HTML });
      }
      groups.push(block);
    }

    if (editable && (formatting.link || formatting.image)) {
      const insert: MdzipNavMenuItem[] = [];
      if (formatting.link) {
        insert.push({ action: 'link', label: 'Link…', icon: MENU_LINK_ICON_HTML, shortcut: this.editorShortcut('K') });
      }
      if (formatting.image) {
        insert.push({ action: 'insert-image', label: 'Insert Image…', icon: MENU_IMAGE_ICON_HTML });
      }
      groups.push(insert);
    }

    if (editable && hasSelection && (anyInline || anyBlock)) {
      groups.push([{ action: 'editor-clear-format', label: 'Clear Formatting', icon: MENU_CLEAR_FORMAT_ICON_HTML }]);
    }

    groups.push([{ action: 'editor-select-all', label: 'Select All', icon: MENU_SELECT_ALL_ICON_HTML, shortcut: this.editorShortcut('A') }]);

    // This menu replaces the browser's native one, which is the only place
    // spelling suggestions live — there's no API to read the browser's
    // dictionary suggestions into a custom menu. Point at the escape hatch
    // instead of silently dropping the feature.
    if (editable) {
      groups.push([{
        action: 'editor-spelling-suggestions-hint',
        label: 'Spelling Suggestions',
        icon: MENU_SPELLCHECK_ICON_HTML,
        shortcut: 'Shift+Right-Click',
        disabled: true
      }]);
    }

    return groups.flatMap((group, index) => (index === 0 ? group : [null, ...group]));
  }

  private async handleEditorMenuAction(action: string): Promise<void> {
    const state = this.contextMenuState;
    this.contextMenuState = null;
    this.render();
    const editor = this.cmEditor;
    if (!editor || state?.kind !== 'editor') {
      return;
    }
    // Clicking the menu may have moved focus and collapsed the selection, so
    // restore the range captured when the menu opened before acting on it.
    if (action !== 'editor-select-all') {
      editor.dispatch({ selection: { anchor: state.from, head: state.to } });
    }
    // Code Block submenu items carry the chosen language as a suffix.
    if (action.startsWith('code-block:')) {
      this.insertCodeBlock(action.slice('code-block:'.length));
      editor.focus();
      return;
    }
    switch (action) {
      case 'editor-cut':
        await this.cutEditorSelection();
        break;
      case 'editor-copy':
        await this.copyEditorSelection();
        break;
      case 'editor-paste':
      case 'editor-paste-plain':
        await this.pasteIntoEditor();
        break;
      case 'editor-clear-format':
        this.clearSelectionFormatting();
        editor.focus();
        break;
      case 'editor-select-all':
        editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } });
        editor.focus();
        break;
      case 'insert-image':
        await this.executeCommand('insert-image');
        break;
      case 'bold':
      case 'italic':
      case 'strikethrough':
      case 'highlight':
      case 'inline-code':
      case 'blockquote':
      case 'bullet-list':
      case 'ordered-list':
      case 'insert-line-break':
      case 'link':
      case 'paragraph':
      case 'heading-1':
      case 'heading-2':
      case 'heading-3':
      case 'heading-4':
      case 'heading-5':
      case 'heading-6':
        this.applyMarkdownFormat(action);
        editor.focus();
        break;
    }
  }

  // Items for the rendered-preview selection menu. Taking over `contextmenu`
  // to offer Copy All also suppresses the browser's native menu — which is
  // the only thing that was otherwise offering Copy on a right-click — so
  // Copy has to be reinstated explicitly whenever there's a selection.
  private previewMenuItems(): Array<MdzipNavMenuItem | null> {
    const state = this.contextMenuState;
    if (state?.kind !== 'preview' || !this.elPreviewContent.textContent?.trim()) {
      return [];
    }
    const items: Array<MdzipNavMenuItem | null> = [];
    if (state.text) {
      items.push({ action: 'preview-copy', label: 'Copy', icon: MENU_COPY_ICON_HTML, shortcut: this.editorShortcut('C') });
      items.push(null);
    }
    items.push({
      action: 'preview-copy-all',
      label: 'Copy All',
      icon: MENU_COPY_ICON_HTML,
      shortcut: this.editorShortcut('A')
    });
    items.push({
      action: 'preview-copy-all-images',
      label: 'Copy All with Images',
      icon: MENU_COPY_ICON_HTML
    });
    return items;
  }

  private handlePreviewMenuAction(action: string): void {
    const state = this.contextMenuState;
    this.contextMenuState = null;
    this.render();
    if (state?.kind !== 'preview') {
      return;
    }
    switch (action) {
      case 'preview-copy-all':
        void this.copyAllPreviewContent();
        break;
      case 'preview-copy-all-images':
        void this.copyAllWithImagesPreviewContent();
        break;
      case 'preview-copy':
        // Partial Copy never shows the render dialog (there's nothing to
        // drain), so its confirmation is always the brief toast.
        void this.copyPreviewSelection(state.text).then((outcome) => this.finishCopyNotification(false, outcome));
        break;
    }
  }

  /**
   * Shows the copy confirmation either as a brief auto-hiding toast (an
   * instant copy — nothing for the user to have looked away from) or, if
   * the render dialog was showing, by switching that same dialog into a
   * dismissable "done" state instead of hiding it — a copy that took long
   * enough to need a progress dialog shouldn't end in a 2-second toast the
   * user may not be looking at. `outcome` null means there was nothing to
   * copy (empty selection) — silently clean up the dialog if one was
   * showing, no confirmation needed. An `error` outcome carries the actual
   * failure text inline (`onFailed` is a host callback with no guaranteed
   * visible surface — this component has no other way to guarantee the
   * user ever sees why it failed).
   */
  private finishCopyNotification(dialogWasShown: boolean, outcome: { message: string } | { error: string } | null): void {
    if (!outcome) {
      if (dialogWasShown) {
        this.copyRenderDialogState = null;
        this.render();
      }
      return;
    }
    const text = 'error' in outcome ? `Copy failed: ${outcome.error}` : outcome.message;
    if (dialogWasShown) {
      this.copyRenderDialogState = null;
      this.copyRenderDoneState = { message: text };
      this.render();
    } else {
      this.showCopyToast(text);
    }
  }

  /** Switches the render dialog into its "ready to copy" state, holding `perform` until the user clicks Copy — see `copyReadyState` for why the write can't just happen automatically here. */
  private armCopyReady(perform: () => Promise<{ message: string } | { error: string } | null>): void {
    this.copyRenderDialogState = null;
    this.copyReadyState = { perform };
    this.render();
  }

  /** Runs the held write from `copyReadyState` — called directly from the dialog's Copy button click, which is what makes the write's own user-activation check pass. */
  private async performReadyCopy(): Promise<void> {
    const ready = this.copyReadyState;
    if (!ready) return;
    this.copyReadyState = null;
    const outcome = await ready.perform();
    // Always the dialog path: copyReadyState only ever gets armed for a
    // copy that already showed the progress dialog.
    this.finishCopyNotification(true, outcome);
  }

  /**
   * Races `promise` against a timer, rejecting with `timeoutMessage` if the
   * timer wins. The async Clipboard API has no built-in timeout, and a
   * write large enough to strain a real OS clipboard (a document with
   * thousands of embedded images can build a HTML payload well over
   * 100MB) can apparently hang indefinitely on some machines rather than
   * rejecting — without this, that leaves the operation permanently
   * pending, and the progress dialog never resolves into either a done or
   * a failure state.
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  /** Writes `text` to the clipboard. Returns null if there was nothing to copy (a true no-op, not a failure); otherwise a success message or the failure text (also reported via `onFailed`, but that's a host callback with no guaranteed visible surface — the caller needs the text itself to show the user). */
  private async copyPreviewSelection(text: string): Promise<{ message: string } | { error: string } | null> {
    if (!text) {
      return null;
    }
    try {
      await this.withTimeout(
        Promise.resolve(this.editorClipboard()?.writeText(text)),
        this.clipboardFallbackWriteTimeoutMs,
        'Clipboard write timed out.'
      );
      return { message: 'Plain text copied to clipboard' };
    } catch (error) {
      this.options.onFailed?.(error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Syncs just the copy-render dialog's progress bar/text from `copyRenderDialogState` — see `copyAllPreviewContent` for why this bypasses `render()`. No-op while the dialog isn't showing. */
  private updateCopyRenderDialogProgress(): void {
    if (!this.copyRenderDialogState) {
      return;
    }
    const { done, total, label } = this.copyRenderDialogState;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    this.elCopyRenderProgressBar.style.width = `${percent}%`;
    this.elCopyRenderProgressText.textContent = total > 0 ? `${label} (${done} / ${total})...` : `${label}...`;
  }

  /**
   * Copies the entire rendered document as plain text (same fidelity as
   * `copyPreviewSelection` — no HTML, no `ClipboardItem`), regardless of how
   * much of it is currently mounted under progressive rendering. If
   * everything's already mounted (small doc, non-chunked render, or the user
   * already scrolled through it) this is instant — `chunkedRenderState` is
   * null in exactly that case. Otherwise it force-drains the rest first,
   * showing a cancelable progress dialog once the wait clears a short
   * debounce so fast documents never flicker it into view.
   */
  private async copyAllPreviewContent(): Promise<void> {
    const pending = this.chunkedRenderState;
    if (!pending) {
      const outcome = await this.copyPreviewSelection(this.elPreviewContent.textContent ?? '');
      this.finishCopyNotification(false, outcome);
      return;
    }

    const total = pending.chunks.length;
    const abort = new AbortController();
    let dialogShown = false;
    const label = 'Rendering the full document';
    const showDialogTimer = setTimeout(() => {
      dialogShown = true;
      this.copyRenderDialogState = { done: pending.cursor, total, label, abort };
      this.render();
    }, 200);

    // Progress ticks update the dialog's progress bar/text directly instead
    // of going through the view's full `render()` — profiling a drain on a
    // 15,000-image document showed `render()` alone (it re-syncs the whole
    // shell, e.g. rebuilding the nav tree) costing ~870ms of self-time over
    // a 4s sample even throttled to 10/sec, dwarfing the actual chunk-mount
    // work it was meant to make room for.
    await this.drainRemainingChunks(pending, (done) => {
      if (!dialogShown) return;
      this.copyRenderDialogState = { done, total, label, abort };
      this.updateCopyRenderDialogProgress();
    }, abort.signal);

    clearTimeout(showDialogTimer);

    if (abort.signal.aborted) {
      if (dialogShown) {
        this.copyRenderDialogState = null;
        this.render();
      }
      // Cancelled partway through — whatever's left stays unmounted, so
      // re-arm the usual scroll-driven continuation for it.
      const remaining = this.chunkedRenderState;
      if (remaining && remaining.generation === pending.generation && !remaining.sentinelHandle) {
        this.armChunkSentinel(remaining.chunks, remaining.cursor, remaining.context, remaining.generation, remaining.animateImageHydration);
      }
      return;
    }

    if (dialogShown) {
      // The prepare phase above can take anywhere from seconds to minutes —
      // long enough that the click which started this has lost its user
      // activation by now, so the actual write waits for a fresh one
      // (the dialog's own Copy button) instead of firing automatically.
      // See copyReadyState's doc comment.
      this.armCopyReady(() => this.copyPreviewSelection(this.elPreviewContent.textContent ?? ''));
      return;
    }
    const outcome = await this.copyPreviewSelection(this.elPreviewContent.textContent ?? '');
    this.finishCopyNotification(false, outcome);
  }

  /**
   * Renders the *entire* current document to one HTML string, independent
   * of whatever's mounted in `elPreviewContent` — no DOM reads or writes.
   * Copy All with Images needs pristine `<img src="original/path">` markup
   * to hand to `MdzipAssetSession.rewriteHtmlEmbeddingImages`, and an
   * already-mounted, possibly-hydrated `<img>` in the live preview may have
   * had its `src` swapped for a `blob:` URL or stripped entirely pending lazy
   * load — either way the original archive path is gone. Time-budgeted and
   * yielded like `renderAndMountChunkBatch`, for the same reason: some
   * chunks cost far more to render+sanitize than others. Extension `mount()`
   * hooks are not run — they render into a live DOM (e.g. mermaid diagrams
   * turning marked-up code fences into SVG), which this never touches, so a
   * mermaid diagram will paste as its pre-render markup, not a rendered
   * diagram. Only reachable when `renderingService.supportsChunking` is
   * true; the caller checks that first.
   */
  private async renderFullDocumentHtml(
    snapshot: MdzipWorkspaceSnapshot,
    context: MdzipMarkdownRenderContext,
    signal: AbortSignal,
    cacheGeneration: number | null,
    onProgress?: (done: number, total: number) => void
  ): Promise<string> {
    const tokensResult = this.renderingService.tokenizeMarkdown(snapshot.currentText, context);
    const tokens = Array.isArray(tokensResult) ? tokensResult : await tokensResult;
    if (signal.aborted) {
      throw new DOMException('Rendering aborted.', 'AbortError');
    }
    // groupTokensIntoChunks is also called with no options in
    // renderAndMountChunkBatch's caller (mountChunkedPreview) — keep both
    // call sites' chunking in sync, since chunk index is chunkHtmlCache's
    // only key.
    const chunks = groupTokensIntoChunks(tokens);
    const view = this.elPreviewContent.ownerDocument.defaultView;
    const clock = view?.performance ?? performance;
    const BATCH_TIME_BUDGET_MS = 10;
    let html = '';
    let cursor = 0;
    while (cursor < chunks.length) {
      if (signal.aborted) {
        throw new DOMException('Rendering aborted.', 'AbortError');
      }
      const batchStart = clock.now();
      let processedInBatch = 0;
      while (cursor < chunks.length && (processedInBatch === 0 || clock.now() - batchStart < BATCH_TIME_BUDGET_MS)) {
        const chunkIndex = cursor;
        const cacheHit = cacheGeneration !== null && this.chunkHtmlCache?.generation === cacheGeneration
          ? this.chunkHtmlCache.html.get(chunkIndex)
          : undefined;
        let chunkHtml: string;
        if (cacheHit !== undefined) {
          chunkHtml = cacheHit;
        } else {
          const result = this.renderingService.renderChunk(chunks[chunkIndex], context);
          chunkHtml = typeof result === 'string' ? result : await result;
          // Only populate the shared cache if this generation is *still*
          // the live one at the moment this (possibly async) render
          // finished — checked per-chunk, not once up front, since the
          // outer loop yields via requestAnimationFrame and individual
          // chunk renders (mermaid) can themselves be async. If the
          // document was edited mid-copy, cacheGeneration is now stale
          // even though this render (for the snapshot Copy All captured)
          // legitimately continues to completion — never write it back
          // under a generation number that's no longer current.
          if (cacheGeneration !== null && cacheGeneration === this.previewGeneration) {
            if (this.chunkHtmlCache?.generation !== cacheGeneration) {
              this.chunkHtmlCache = { generation: cacheGeneration, html: new Map() };
            }
            this.chunkHtmlCache.html.set(chunkIndex, chunkHtml);
          }
        }
        html += chunkHtml;
        cursor += 1;
        processedInBatch += 1;
      }
      onProgress?.(cursor, chunks.length);
      if (cursor >= chunks.length) {
        break;
      }
      if (signal.aborted) {
        throw new DOMException('Rendering aborted.', 'AbortError');
      }
      await new Promise<void>((resolve) => {
        if (view?.requestAnimationFrame) view.requestAnimationFrame(() => resolve());
        else setTimeout(resolve, 0);
      });
    }
    return html;
  }

  /**
   * Like `copyAllPreviewContent`, but writes a rich `text/html` clipboard
   * representation (alongside the same `text/plain` fallback) with every
   * archive image re-embedded as a self-contained `data:` URL — the format
   * an external app like Word needs, since this document's own `blob:` URLs
   * only resolve inside this tab. Two phases share one debounced, cancelable
   * dialog: render the document fresh (`renderFullDocumentHtml`), then embed
   * its images (`rewriteHtmlEmbeddingImages`). Falls back to
   * `copyAllPreviewContent`'s plain-text-only behavior when there's no
   * default renderer to re-render from (a host-supplied custom renderer,
   * the same escape hatch `progressiveTextRendering` already has) — or, if
   * the clipboard rejects the rich write for any reason (unsupported
   * browser, payload too large), falls back to a plain-text write so the
   * user still gets *something* rather than nothing.
   */
  private async copyAllWithImagesPreviewContent(): Promise<void> {
    const snapshot = this.workspace?.snapshot();
    if (!snapshot || snapshot.currentPathType !== 'markdown' || !this.renderingService.supportsChunking) {
      await this.copyAllPreviewContent();
      return;
    }

    const abort = new AbortController();
    let dialogShown = false;
    const showDialogTimer = setTimeout(() => {
      dialogShown = true;
      this.copyRenderDialogState = { done: 0, total: 0, label: 'Rendering the document', abort };
      this.render();
    }, 200);
    const updateProgress = (done: number, total: number, label: string): void => {
      if (!dialogShown) return;
      this.copyRenderDialogState = { done, total, label, abort };
      this.updateCopyRenderDialogProgress();
    };

    let finalHtml: string;
    let imageCount = 0;
    try {
      const context = this.createMarkdownContext(snapshot, abort.signal);
      // Only trust chunkHtmlCache if the live preview generation still
      // represents this exact snapshot — if the preview hasn't caught up to
      // it yet, or the document has since changed, render fully fresh
      // rather than risk splicing in HTML for different content.
      const cacheGeneration = this.previewMemoMatchesSnapshot(snapshot) ? this.previewGeneration : null;
      let html = await this.renderFullDocumentHtml(
        snapshot,
        context,
        abort.signal,
        cacheGeneration,
        (done, total) => updateProgress(done, total, 'Rendering the document')
      );
      if (this.assetSession) {
        html = await this.assetSession.rewriteHtmlEmbeddingImages(
          html,
          snapshot.currentPath,
          abort.signal,
          (done, total) => {
            imageCount = total;
            updateProgress(done, total, 'Embedding images');
          }
        );
      }
      finalHtml = html;
    } catch (error) {
      clearTimeout(showDialogTimer);
      if ((error as { name?: string } | null)?.name === 'AbortError') {
        // Deliberate cancel — just close, no failure to report.
        if (dialogShown) {
          this.copyRenderDialogState = null;
          this.render();
        }
      } else {
        this.finishCopyNotification(dialogShown, { error: error instanceof Error ? error.message : String(error) });
        this.options.onFailed?.(error);
      }
      return;
    }

    clearTimeout(showDialogTimer);

    const scratch = this.elPreviewContent.ownerDocument.createElement('div');
    scratch.innerHTML = finalHtml;
    const plainText = scratch.textContent ?? '';
    if (dialogShown) {
      // Same reasoning as copyAllPreviewContent: the prepare phase (often
      // the slower of the two here, once image embedding is involved) has
      // long since burned through the click's user activation.
      this.armCopyReady(() => this.writeRichClipboard(finalHtml, plainText, imageCount));
      return;
    }
    const outcome = await this.writeRichClipboard(finalHtml, plainText, imageCount);
    this.finishCopyNotification(false, outcome);
  }

  /**
   * Writes an HTML+plain-text `ClipboardItem` when the browser supports it,
   * falling back to a plain-text-only `writeText` (same as
   * `copyPreviewSelection`, which reports itself as "Plain text") when it
   * doesn't, or if the rich write itself throws (e.g. a payload too large
   * for the OS clipboard) — either way the user ends up with *something* on
   * their clipboard rather than nothing. Returns the confirmation message
   * for the caller to show (see `finishCopyNotification`), naming the
   * actual MIME type that ended up on the clipboard ("HTML" for a
   * successful rich write, "Plain text" for the fallback) so the user knows
   * what they're about to paste — `imageCount` only adds to the "HTML"
   * wording, since even a rich write with zero images is still HTML, not
   * plain text.
   */
  private async writeRichClipboard(html: string, plainText: string, imageCount: number): Promise<{ message: string } | { error: string } | null> {
    const clipboard = this.editorClipboard();
    const view = this.elPreviewContent.ownerDocument.defaultView;
    const ClipboardItemCtor = (view as (Window & { ClipboardItem?: typeof ClipboardItem }) | undefined)?.ClipboardItem;
    if (clipboard && ClipboardItemCtor && 'write' in clipboard) {
      try {
        const item = new ClipboardItemCtor({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' })
        });
        // A document with thousands of repeated images (e.g. an avatar
        // reused across every row of a chat export) can build a payload
        // well over 100MB, since each occurrence embeds its own full copy
        // — the clipboard format has no way to reference a shared resource.
        // 30s is generous for a legitimate slow write; the real purpose is
        // making sure this can't hang forever with the dialog stuck mid-copy.
        await this.withTimeout(clipboard.write([item]), this.clipboardWriteTimeoutMs, 'Clipboard write timed out.');
        return {
          message: imageCount > 0
            ? `HTML with ${imageCount} image${imageCount === 1 ? '' : 's'} copied to clipboard`
            : 'HTML copied to clipboard'
        };
      } catch (error) {
        this.options.onFailed?.(error);
        // Fall through to the plain-text fallback rather than surfacing
        // this error directly — if that also fails, its error is more
        // relevant (it's the one actually blocking the user from getting
        // anything at all), and the plain-text path already reports this
        // one to onFailed for anyone watching that.
      }
    }
    return await this.copyPreviewSelection(plainText);
  }

  /**
   * Mounts every chunk from `state.cursor` onward, yielding to a fresh
   * animation frame between batches (unlike the sentinel path's rAF-time-
   * budgeted-per-batch loop, this has no viewport to wait on — it has to
   * plow through the whole rest of the document, so the explicit yield is
   * what keeps a huge draw from locking up the tab while it does). Stops
   * early if `signal` aborts, a newer render generation supersedes this one,
   * or the chunk state's own render context aborts.
   *
   * Deliberately uses `renderAndMountChunkBatch` instead of `mountChunkBatch`
   * and defers image hydration until the whole drain finishes, running it
   * once over every image the drain mounted, instead of once per batch:
   * Copy All only needs the mounted chunks' *text* (`elPreviewContent
   * .textContent`, which images never contribute to), so there's no reason
   * to wait on `hydrateImages`' async image resolution at all here — and
   * racing through batches as fast as this loop can while each one fires
   * its own independent, un-awaited `hydrateImages` background loop (as
   * `mountChunkBatch` does for the scroll-paced callers, where that's fine —
   * scrolling naturally rate-limits how many can ever be in flight at once)
   * lets dozens of those loops pile up concurrently on an image-heavy
   * document, each spending its own `CHUNK_BUDGET_MS` in the same frame —
   * measured 100-200ms frame gaps on a 15,000-image document. One combined
   * pass over every image at the end avoids the pile-up entirely, without
   * making Copy All wait on it.
   */
  private async drainRemainingChunks(
    state: NonNullable<MdzipWorkspaceView['chunkedRenderState']>,
    onProgress: (done: number, total: number) => void,
    signal: AbortSignal
  ): Promise<void> {
    const { chunks, context, generation, animateImageHydration } = state;
    // Draining is instead of the scroll-driven continuation, not alongside
    // it — tearing down any armed sentinel first stops the two from racing
    // and double-mounting the same chunk.
    state.sentinelHandle?.destroy();
    if (this.chunkedRenderState?.generation === generation) {
      this.chunkedRenderState.sentinelHandle = null;
    }

    const allPending: { image: HTMLImageElement; source: string }[] = [];
    try {
      while (this.chunkedRenderState?.generation === generation && this.chunkedRenderState.cursor < chunks.length) {
        if (signal.aborted || generation !== this.previewGeneration || context.signal.aborted) return;
        const cursor = this.chunkedRenderState.cursor;
        const { cursor: newCursor, mountedRoots } = await this.renderAndMountChunkBatch(chunks, cursor, context, generation);
        if (generation !== this.previewGeneration || context.signal.aborted) return;
        allPending.push(...this.collectPendingImages(mountedRoots, animateImageHydration));
        this.recordChunkProgress(generation, chunks, newCursor);
        onProgress(newCursor, chunks.length);
        if (signal.aborted) return;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    } finally {
      if (generation === this.previewGeneration && !context.signal.aborted) {
        this.hydrateImages(allPending, context, generation, animateImageHydration, () => {});
      }
    }
  }

  // Inserts a fenced code block, carrying the chosen language as the fence info
  // string. An empty language produces a plain ```` ``` ```` block.
  private insertCodeBlock(language: string): void {
    if (!this.canExecuteCommand('code-block')) {
      return;
    }
    this.wrapSelection(`\`\`\`${language}\n`, '\n```', 'code');
  }

  // Strips common Markdown formatting from the selection: leading block markers
  // (headings, blockquotes, list bullets) per line, then inline emphasis,
  // highlight, and code spans. Heuristic by nature — it targets the markers the
  // editor itself produces rather than parsing the full grammar.
  private clearSelectionFormatting(): void {
    const editor = this.cmEditor;
    const snapshot = this.workspace?.snapshot();
    if (!editor || !snapshot || snapshot.mode === 'read-only') {
      return;
    }
    const selection = editor.state.selection.main;
    if (selection.empty) {
      return;
    }
    const cleared = editor.state.sliceDoc(selection.from, selection.to)
      .split('\n')
      .map((line) => line
        .replace(/^(\s*)#{1,6}\s+/, '$1')
        .replace(/^(\s*)>\s?/, '$1')
        .replace(/^(\s*)(?:[-*+]|\d+\.)\s+/, '$1'))
      .join('\n')
      .replace(/<\/?mark>/gi, '')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/==(.*?)==/g, '$1')
      .replace(/`([^`]*)`/g, '$1');
    editor.dispatch({
      changes: { from: selection.from, to: selection.to, insert: cleared },
      selection: { anchor: selection.from, head: selection.from + cleared.length }
    });
  }

  private editorClipboard(): Clipboard | undefined {
    return this.elRoot.ownerDocument.defaultView?.navigator?.clipboard;
  }

  // Renders a single-letter shortcut for the host platform: ⌘X on macOS,
  // Ctrl+X elsewhere. Only used for bindings that genuinely fire (the native
  // clipboard keys and `defaultKeymap`'s select-all).
  private editorShortcut(key: string): string {
    const nav = this.elRoot.ownerDocument.defaultView?.navigator;
    const platform = (nav as { userAgentData?: { platform?: string } } | undefined)?.userAgentData?.platform
      ?? nav?.platform
      ?? '';
    return /mac|iphone|ipad|ipod/i.test(platform) ? `⌘${key}` : `Ctrl+${key}`;
  }

  private async copyEditorSelection(): Promise<void> {
    const editor = this.cmEditor;
    if (!editor) {
      return;
    }
    const selection = editor.state.selection.main;
    if (selection.empty) {
      return;
    }
    try {
      await this.editorClipboard()?.writeText(editor.state.sliceDoc(selection.from, selection.to));
    } catch (error) {
      this.options.onFailed?.(error);
    }
    editor.focus();
  }

  private async cutEditorSelection(): Promise<void> {
    const editor = this.cmEditor;
    const snapshot = this.workspace?.snapshot();
    if (!editor || !snapshot || snapshot.mode === 'read-only') {
      return;
    }
    const selection = editor.state.selection.main;
    if (selection.empty) {
      return;
    }
    try {
      await this.editorClipboard()?.writeText(editor.state.sliceDoc(selection.from, selection.to));
    } catch (error) {
      this.options.onFailed?.(error);
      return;
    }
    editor.dispatch({
      changes: { from: selection.from, to: selection.to, insert: '' },
      selection: { anchor: selection.from }
    });
    editor.focus();
  }

  private async pasteIntoEditor(): Promise<void> {
    const editor = this.cmEditor;
    const snapshot = this.workspace?.snapshot();
    if (!editor || !snapshot || snapshot.mode === 'read-only') {
      return;
    }
    let text: string | undefined;
    try {
      text = await this.editorClipboard()?.readText();
    } catch (error) {
      this.options.onFailed?.(error);
      return;
    }
    if (!text) {
      return;
    }
    const selection = editor.state.selection.main;
    editor.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length }
    });
    editor.focus();
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
      case 'highlight':
        this.wrapSelection('<mark>', '</mark>', 'highlighted text');
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
      case 'insert-line-break':
        this.insertLineBreak();
        break;
      case 'link':
        this.insertMarkdownLink();
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
      lineBreak: formatting.lineBreak,
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

  private insertMarkdownLink(): void {
    const editor = this.cmEditor;
    if (!editor) {
      return;
    }
    const selection = editor.state.selection.main;
    const selectedText = editor.state.sliceDoc(selection.from, selection.to);
    const linkText = selectedText || 'link text';
    const urlPlaceholder = 'url';
    const insert = `[${linkText}](${urlPlaceholder})`;
    const anchor = selection.from + linkText.length + 3;
    editor.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: { anchor, head: anchor + urlPlaceholder.length },
      scrollIntoView: true
    });
    editor.focus();
  }

  private insertLineBreak(): void {
    const editor = this.cmEditor;
    if (!editor) {
      return;
    }
    const selection = editor.state.selection.main;
    const insert = '<br>\n';
    editor.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: { anchor: selection.from + insert.length },
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
      // Manifest-only changes are delegated to onManifestChanged when the
      // host registered it: exporting bytes here would force a full archive
      // rebuild on workspaces opened without archiveBytes.
      const delegatedToManifestHandler = this.options.onManifestChanged
        && event.changes.length === 1
        && event.changes[0] === 'manifest';
      if (this.options.onChanged && !delegatedToManifestHandler) {
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
    // render() only updates the --mdz-zoom CSS variable; CodeMirror caches
    // gutter/line-block heights from its own measure pass and has no way to
    // observe a custom-property change (font-size grows but the scroller's
    // own outer box doesn't, so no ResizeObserver fires either). Without
    // this, gutter row heights stay pinned to their pre-zoom pixel values
    // while .cm-line rows reflow normally, drifting the two further apart
    // with every line.
    this.cmEditor?.requestMeasure();
  }

  /**
   * Sets the active color scheme after construction.
   *
   * Use for host-driven theme synchronization — e.g. a VS Code webview
   * reacting to `data-vscode-theme-kind` changes via MutationObserver — so the
   * editor follows the host theme without being recreated (recreation would
   * destroy the CodeMirror instance and lose unsaved edits). No-op when the
   * scheme is unchanged. Does not fire `onColorSchemeChanged`, which only
   * reports user-initiated toggles from the built-in toolbar buttons.
   */
  public setColorScheme(colorScheme: MdzipColorScheme): void {
    if (this.colorScheme === colorScheme) {
      return;
    }
    this.colorScheme = colorScheme;
    this.render();
  }

  private setColorSchemeFromToolbar(colorScheme: MdzipColorScheme): void {
    if (this.colorScheme === colorScheme) {
      return;
    }
    this.setColorScheme(colorScheme);
    this.options.onColorSchemeChanged?.(colorScheme);
  }

  private async setLayout(requested: MdzipWorkspaceLayout): Promise<void> {
    const snapshot = this.workspace?.snapshot();
    this.layout = snapshot ? this.validLayoutForSnapshot(requested, snapshot) : requested;
    await this.ensureCmEditor();
    this.render();
  }

  private navMenuTargetFromElement(element: HTMLElement | null): MdzipNavMenuTarget | null {
    const snapshot = this.workspace?.snapshot();
    if (!snapshot || snapshot.sourceFormat !== 'mdz' || !element) {
      return null;
    }
    const navFile = element.closest<HTMLElement>('[data-nav-path]');
    if (navFile) {
      return this.fileMenuTarget(navFile.getAttribute('data-nav-path')!, snapshot);
    }
    const directory = element.closest<HTMLElement>('details[data-nav-dir]');
    if (directory) {
      return { kind: 'directory', path: directory.getAttribute('data-nav-dir') ?? '' };
    }
    return { kind: 'directory', path: '' };
  }

  private fileMenuTarget(path: string, snapshot: MdzipWorkspaceSnapshot): MdzipNavMenuTarget | null {
    const entry = snapshot.content.paths.find(
      (item) => item.path.toLowerCase() === path.toLowerCase()
    );
    if (!entry) {
      return null;
    }
    return {
      kind: 'file',
      path: entry.path,
      orphaned: snapshot.content.orphanedAssetPaths
        .some((orphan) => orphan.toLowerCase() === entry.path.toLowerCase()),
      isMarkdown: entry.isMarkdown,
      isEntryPoint: entry.path.toLowerCase() === snapshot.content.entryPoint.toLowerCase(),
      isImage: entry.isImage,
      isManifest: isMdzipManifestPath(entry.path)
    };
  }

  private showNavMenuForPath(path: string, event: Event): void {
    const snapshot = this.workspace?.snapshot();
    const target = snapshot ? this.fileMenuTarget(path, snapshot) : null;
    if (target) {
      this.showNavMenu(target, event);
    }
  }

  private showNavMenu(target: MdzipNavMenuTarget, event: Event): void {
    const snapshot = this.workspace?.snapshot();
    if (!snapshot || this.navMenuItems(target, snapshot).length === 0) {
      return;
    }
    const bounds = (event.target as HTMLElement | null)?.getBoundingClientRect();
    const clientX = event instanceof MouseEvent ? event.clientX : (bounds?.left ?? 0);
    const clientY = event instanceof MouseEvent ? event.clientY : (bounds?.bottom ?? 0);
    this.contextMenuState = { kind: 'nav', target, x: clientX, y: clientY };
    this.render();
  }

  // Items for the nav context menu; null entries render as separators.
  private navMenuItems(
    target: MdzipNavMenuTarget,
    snapshot: MdzipWorkspaceSnapshot
  ): Array<MdzipNavMenuItem | null> {
    const canMutate = this.allowFileActions(snapshot);
    if (target.kind === 'directory') {
      if (!canMutate) {
        return [];
      }
      return [
        { action: 'new-file', label: 'New .md File' },
        { action: 'new-folder', label: 'New Folder' }
      ];
    }

    if (target.isManifest) {
      return [{ action: 'download', label: 'Download' }];
    }

    const groups: Array<Array<MdzipNavMenuItem>> = [];
    if (canMutate) {
      const stateGroup: MdzipNavMenuItem[] = [];
      if (target.isMarkdown && !target.isEntryPoint) {
        stateGroup.push({ action: 'set-entry-point', label: 'Set as Entry Point' });
      }
      if (target.isImage) {
        const cover = snapshot.content.manifest?.cover;
        stateGroup.push(cover && cover.toLowerCase() === target.path.toLowerCase()
          ? { action: 'remove-cover', label: 'Remove Cover Image' }
          : { action: 'set-cover', label: 'Set as Cover Image' });
      }
      if (stateGroup.length > 0) {
        groups.push(stateGroup);
      }
    }
    groups.push([{
      action: 'copy-link',
      label: target.isImage ? 'Copy Image Embed' : 'Copy Markdown Link'
    }]);
    if (canMutate) {
      const editGroup: MdzipNavMenuItem[] = [
        { action: 'rename', label: 'Rename…' },
        { action: 'duplicate', label: 'Duplicate' }
      ];
      if (!target.isMarkdown) {
        editGroup.push({ action: 'replace', label: 'Replace…' });
      }
      groups.push(editGroup);
    }
    groups.push([{ action: 'download', label: 'Download' }]);
    if (canMutate && !target.isEntryPoint) {
      groups.push([{
        action: 'delete',
        label: target.orphaned ? 'Delete Orphaned Asset' : 'Delete…'
      }]);
    }

    return groups.flatMap((group, index) => index === 0 ? group : [null, ...group]);
  }

  private async handleNavMenuAction(action: string): Promise<void> {
    const state = this.contextMenuState;
    this.contextMenuState = null;
    this.render();
    if (!state || state.kind !== 'nav') {
      return;
    }
    const target = state.target;
    try {
      switch (action) {
        case 'new-file':
          if (target.kind === 'directory') {
            this.openNameDialog({ mode: 'new-file', dir: target.path, value: 'untitled.md' });
          }
          break;
        case 'new-folder':
          if (target.kind === 'directory') {
            this.openNameDialog({ mode: 'new-folder', dir: target.path, value: 'new-folder' });
          }
          break;
        case 'rename':
          if (target.kind === 'file') {
            this.openNameDialog({ mode: 'rename', oldPath: target.path, value: target.path });
          }
          break;
        case 'delete':
          if (target.kind === 'file') {
            if (target.orphaned) {
              await this.deleteFile(target.path);
            } else {
              this.deleteDialogState = { path: target.path };
              this.render();
            }
          }
          break;
        case 'set-entry-point':
          if (target.kind === 'file') {
            await this.workspace?.setEntryPoint(target.path);
            this.render();
          }
          break;
        case 'set-cover':
          if (target.kind === 'file') {
            await this.workspace?.setCoverImage(target.path);
            this.render();
          }
          break;
        case 'remove-cover':
          await this.workspace?.setCoverImage(null);
          this.render();
          break;
        case 'copy-link':
          if (target.kind === 'file') {
            await this.copyMarkdownLink(target);
          }
          break;
        case 'download':
          if (target.kind === 'file') {
            await this.downloadArchiveFile(target.path);
          }
          break;
        case 'duplicate':
          if (target.kind === 'file') {
            await this.duplicateFile(target.path);
          }
          break;
        case 'replace':
          if (target.kind === 'file') {
            this.pendingReplacePath = target.path;
            this.elReplaceInput.click();
          }
          break;
        default:
          break;
      }
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private openNameDialog(state: { mode: MdzipNameDialogMode; dir?: string; oldPath?: string; value: string }): void {
    this.nameDialogState = {
      mode: state.mode,
      dir: state.dir ?? '',
      oldPath: state.oldPath ?? '',
      value: state.value,
      error: ''
    };
    this.render();
    requestAnimationFrame(() => {
      this.elNameInput.focus();
      const dot = state.mode === 'rename'
        ? -1
        : this.elNameInput.value.lastIndexOf('.');
      this.elNameInput.setSelectionRange(0, dot > 0 ? dot : this.elNameInput.value.length);
    });
  }

  // Returns '' when valid, otherwise the validation message to show.
  private validateNameDialog(state: { mode: MdzipNameDialogMode; dir: string; oldPath: string; value: string }): string {
    const snapshot = this.workspace?.snapshot();
    if (!snapshot) {
      return 'No workspace loaded.';
    }
    const value = state.value.trim();
    if (!value) {
      return 'Name cannot be empty.';
    }
    if (state.mode !== 'rename' && /[\\/]/.test(value)) {
      return 'Name cannot contain slashes.';
    }
    const fullPath = state.mode === 'rename'
      ? value
      : state.dir ? `${state.dir}/${value}` : value;
    const normalized = normalizeArchivePath(fullPath);
    if (!normalized) {
      return 'Not a valid archive path.';
    }
    if (normalized.toLowerCase() === 'manifest.json') {
      return 'That name is reserved for the package manifest.';
    }
    if (state.mode === 'new-folder') {
      return '';
    }
    const finalPath = state.mode === 'new-file' && !/\.[^/.]+$/.test(normalized)
      ? `${normalized}.md`
      : normalized;
    const collision = snapshot.content.paths.some((entry) =>
      entry.path.toLowerCase() === finalPath.toLowerCase()
      && entry.path.toLowerCase() !== state.oldPath.toLowerCase());
    if (collision) {
      return `"${finalPath}" already exists.`;
    }
    return '';
  }

  private async confirmNameDialog(): Promise<void> {
    const state = this.nameDialogState;
    if (!state) {
      return;
    }
    state.error = this.validateNameDialog(state);
    if (state.error) {
      this.render();
      return;
    }
    this.nameDialogState = null;
    const value = state.value.trim();
    try {
      if (state.mode === 'new-folder') {
        const folderPath = normalizeArchivePath(state.dir ? `${state.dir}/${value}` : value)!;
        this.pendingNewFolders.add(folderPath);
        this.render();
        return;
      }
      if (state.mode === 'new-file') {
        let path = normalizeArchivePath(state.dir ? `${state.dir}/${value}` : value)!;
        if (!/\.[^/.]+$/.test(path)) {
          path = `${path}.md`;
        }
        const baseName = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
        await this.workspace?.addAsset(path, new TextEncoder().encode(`# ${baseName}\n`));
        await this.openPath(path);
        return;
      }
      // rename
      const renamed = await this.workspace?.renameFile(state.oldPath, value);
      if (!renamed) {
        this.nameDialogState = { ...state, error: 'Could not rename the file.' };
      }
      this.render();
    } catch (error) {
      this.render();
      this.options.onFailed?.(error);
    }
  }

  private async deleteFile(path: string): Promise<void> {
    try {
      await this.workspace?.removeFile(path);
      this.render();
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  // Builds a `[name](relative/path)` (or `![…]` for images) reference from the
  // currently open document to an archive path.
  private markdownLinkSnippet(
    targetPath: string,
    isImage: boolean,
    snapshot: MdzipWorkspaceSnapshot
  ): string {
    const fromDir = snapshot.currentPath.includes('/')
      ? snapshot.currentPath.slice(0, snapshot.currentPath.lastIndexOf('/'))
      : '';
    const relative = relativeArchivePath(fromDir, targetPath);
    const encoded = relative.split('/').map(encodeURIComponent).join('/');
    const name = targetPath.slice(targetPath.lastIndexOf('/') + 1);
    return isImage ? `![${name}](${encoded})` : `[${name}](${encoded})`;
  }

  private async copyMarkdownLink(target: Extract<MdzipNavMenuTarget, { kind: 'file' }>): Promise<void> {
    const snapshot = this.workspace?.snapshot();
    if (!snapshot) {
      return;
    }
    const markdown = this.markdownLinkSnippet(target.path, target.isImage, snapshot);
    const clipboard = this.elRoot.ownerDocument.defaultView?.navigator.clipboard;
    if (!clipboard) {
      throw new Error('Clipboard access is unavailable in this context.');
    }
    await clipboard.writeText(markdown);
  }

  private canAcceptEditorDrop(): boolean {
    const snapshot = this.workspace?.snapshot();
    return Boolean(
      snapshot
      && this.cmEditor
      && snapshot.mode !== 'read-only'
      && snapshot.currentPathType === 'markdown'
    );
  }

  // Inserts a markdown link/image embed for a nav-tree file dropped onto the
  // editor, at the document position under the pointer.
  private insertArchiveLinkAtCoords(archivePath: string, x: number, y: number): void {
    const editor = this.cmEditor;
    const snapshot = this.workspace?.snapshot();
    if (!editor || !snapshot || snapshot.sourceFormat !== 'mdz') {
      return;
    }
    const entry = snapshot.content.paths.find(
      (item) => item.path.toLowerCase() === archivePath.toLowerCase()
    );
    if (!entry || isMdzipManifestPath(entry.path)) {
      return;
    }
    const snippet = this.markdownLinkSnippet(entry.path, entry.isImage, snapshot);
    const pos = editor.posAtCoords({ x, y }) ?? editor.state.selection.main.head;
    editor.dispatch({
      changes: { from: pos, insert: snippet },
      selection: { anchor: pos + snippet.length }
    });
    editor.focus();
  }

  // An OS image file dropped onto the editor embeds it like a paste would,
  // anchored at the pointer position (or via the conversion dialog for plain
  // markdown sources).
  private async handleEditorImageDrop(file: File, x: number, y: number): Promise<void> {
    try {
      if (this.workspace?.sourceFormat === 'markdown') {
        this.requestMdzConversion({ kind: 'image-file', file, source: 'drop' });
        return;
      }
      const editor = this.cmEditor;
      if (editor) {
        const pos = editor.posAtCoords({ x, y });
        if (pos !== null) {
          editor.dispatch({ selection: { anchor: pos } });
        }
      }
      await this.insertImageFile(file, 'drop');
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private async downloadArchiveFile(path: string): Promise<void> {
    const bytes = await this.workspace?.readPathBytes(path);
    if (!bytes) {
      return;
    }
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const fileName = path.slice(path.lastIndexOf('/') + 1);
    this.downloadSavedBlob(new Blob([buffer]), fileName);
  }

  private async duplicateFile(path: string): Promise<void> {
    const workspace = this.workspace;
    const snapshot = workspace?.snapshot();
    if (!workspace || !snapshot) {
      return;
    }
    const bytes = await workspace.readPathBytes(path);
    if (!bytes) {
      return;
    }
    const existing = new Set(snapshot.content.paths.map((entry) => entry.path.toLowerCase()));
    const dot = path.lastIndexOf('.');
    const slash = path.lastIndexOf('/');
    const stem = dot > slash ? path.slice(0, dot) : path;
    const extension = dot > slash ? path.slice(dot) : '';
    let counter = 2;
    let candidate = `${stem}-${counter}${extension}`;
    while (existing.has(candidate.toLowerCase())) {
      counter += 1;
      candidate = `${stem}-${counter}${extension}`;
    }
    await workspace.addAsset(candidate, bytes);
    await this.openPath(candidate);
  }

  private async replaceFileFromPicker(path: string, file: File): Promise<void> {
    try {
      await this.workspace?.replaceAsset(path, new Uint8Array(await file.arrayBuffer()));
      this.render();
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private attachNavDragAndDrop(): void {
    this.elNavTree.addEventListener('dragstart', (e) => {
      const navFile = (e.target as HTMLElement).closest<HTMLElement>('[data-nav-path][draggable="true"]');
      const snapshot = this.workspace?.snapshot();
      if (!navFile || !snapshot
        || snapshot.mode === 'read-only' || snapshot.sourceFormat !== 'mdz') {
        return;
      }
      this.dragSourcePath = navFile.getAttribute('data-nav-path');
      e.dataTransfer?.setData('application/x-mdzip-path', this.dragSourcePath ?? '');
      if (e.dataTransfer) {
        // Must permit both effects: tree drops are 'move', editor drops are
        // 'copy'. A dropEffect outside effectAllowed makes the browser cancel
        // the drop without firing the drop event at all.
        e.dataTransfer.effectAllowed = 'copyMove';
      }
    });
    this.elNavTree.addEventListener('dragend', () => {
      this.dragSourcePath = null;
      this.setDragOverElement(null);
    });

    this.elNavPane.addEventListener('dragover', (e) => {
      const snapshot = this.workspace?.snapshot();
      if (!snapshot || !this.allowFileActions(snapshot)) {
        return;
      }
      const internal = this.dragSourcePath !== null
        || (e.dataTransfer?.types.includes('application/x-mdzip-path') ?? false);
      const external = e.dataTransfer?.types.includes('Files') ?? false;
      if (!internal && !external) {
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = internal ? 'move' : 'copy';
      }
      const directory = (e.target as HTMLElement).closest<HTMLElement>('details[data-nav-dir]');
      this.setDragOverElement(directory ?? this.elNavTree);
    });
    this.elNavPane.addEventListener('dragleave', (e) => {
      if (!this.elNavPane.contains(e.relatedTarget as Node | null)) {
        this.setDragOverElement(null);
      }
    });
    this.elNavPane.addEventListener('drop', (e) => {
      const snapshot = this.workspace?.snapshot();
      this.setDragOverElement(null);
      if (!snapshot || !this.allowFileActions(snapshot)) {
        return;
      }
      const directory = (e.target as HTMLElement).closest<HTMLElement>('details[data-nav-dir]');
      const targetDir = directory?.getAttribute('data-nav-dir') ?? '';
      const internalPath = e.dataTransfer?.getData('application/x-mdzip-path') || this.dragSourcePath;
      this.dragSourcePath = null;
      if (internalPath) {
        e.preventDefault();
        void this.moveFileToDirectory(internalPath, targetDir);
        return;
      }
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        e.preventDefault();
        void this.addDroppedFiles(targetDir, Array.from(files));
      }
    });
  }

  private setDragOverElement(element: HTMLElement | null): void {
    if (this.dragOverElement === element) {
      return;
    }
    this.dragOverElement?.classList.remove('drag-over');
    this.dragOverElement = element;
    element?.classList.add('drag-over');
  }

  private async moveFileToDirectory(path: string, targetDir: string): Promise<void> {
    const baseName = path.slice(path.lastIndexOf('/') + 1);
    const newPath = targetDir ? `${targetDir}/${baseName}` : baseName;
    if (newPath.toLowerCase() === path.toLowerCase()) {
      return;
    }
    try {
      await this.workspace?.renameFile(path, newPath);
      this.render();
    } catch (error) {
      this.options.onFailed?.(error);
    }
  }

  private async addDroppedFiles(targetDir: string, files: File[]): Promise<void> {
    const workspace = this.workspace;
    if (!workspace) {
      return;
    }
    try {
      for (const file of files) {
        const normalized = normalizeArchivePath(targetDir ? `${targetDir}/${file.name}` : file.name);
        if (!normalized || normalized.toLowerCase() === 'manifest.json') {
          continue;
        }
        const existing = new Set(
          workspace.snapshot().content.paths.map((entry) => entry.path.toLowerCase())
        );
        const dot = normalized.lastIndexOf('.');
        const slash = normalized.lastIndexOf('/');
        const stem = dot > slash ? normalized.slice(0, dot) : normalized;
        const extension = dot > slash ? normalized.slice(dot) : '';
        let candidate = normalized;
        let counter = 2;
        while (existing.has(candidate.toLowerCase())) {
          candidate = `${stem}-${counter}${extension}`;
          counter += 1;
        }
        await workspace.addAsset(candidate, new Uint8Array(await file.arrayBuffer()));
      }
      this.render();
    } catch (error) {
      this.options.onFailed?.(error);
    }
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

  private syncScrollFromPreview(): void {
    if (this.syncing || !this.cmEditor || this.layout !== 'split') {
      return;
    }
    const currentTop = this.elPreviewPane.scrollTop;
    // Recognize this event as the echo of our own prior write (from
    // syncScrollToPreview) by comparing values instead of racing timing.
    // Setting scrollTop fires the target's own 'scroll' event
    // asynchronously, and how many frames later varies by platform — an
    // earlier version of this guard cleared a `syncing` flag on the next
    // requestAnimationFrame, which covered Chromium's timing but arrived too
    // early on Firefox/Linux, let the echo through, and re-triggered a sync
    // back in the other direction, compounding into visible drift. Comparing
    // against the exact value we last wrote to this exact property makes the
    // check independent of how long the echo takes to arrive.
    if (this.lastSyncedPreviewScrollTop !== null && Math.abs(currentTop - this.lastSyncedPreviewScrollTop) < 2) {
      return;
    }
    this.syncing = true;
    const previewHeight = this.elPreviewPane.scrollHeight - this.elPreviewPane.clientHeight;
    const scrollRatio = previewHeight > 0 ? currentTop / previewHeight : 0;
    const cmScroller = this.cmEditor.dom.querySelector('.cm-scroller');
    if (cmScroller) {
      const editorHeight = cmScroller.scrollHeight - cmScroller.clientHeight;
      const target = scrollRatio * editorHeight;
      this.lastSyncedEditorScrollTop = target;
      cmScroller.scrollTop = target;
    }
    this.syncing = false;
  }

  private syncScrollToPreview(): void {
    if (this.syncing || !this.cmEditor || this.layout !== 'split') {
      return;
    }
    const cmScroller = this.cmEditor.dom.querySelector('.cm-scroller');
    if (!cmScroller) {
      return;
    }
    const currentTop = cmScroller.scrollTop;
    // See syncScrollFromPreview: same echo-recognition approach, mirrored.
    if (this.lastSyncedEditorScrollTop !== null && Math.abs(currentTop - this.lastSyncedEditorScrollTop) < 2) {
      return;
    }
    const editorHeight = cmScroller.scrollHeight - cmScroller.clientHeight;
    // The editor is at its true bottom, but under progressive rendering the
    // preview's scrollHeight only accounts for chunks mounted so far — a
    // plain ratio jump would only reach the bottom of whatever happens to be
    // mounted right now, not the document's actual end. Force-drain the rest
    // first so this edge is reliable regardless of how much has been
    // scrolled-into-view on the preview side.
    //
    // "At the bottom" is detected via CodeMirror's own viewport, not a
    // scrollHeight/scrollTop pixel comparison: CodeMirror estimates the
    // height of not-yet-measured (virtualized) lines, and on a huge document
    // that estimate can be tens of pixels off from where it actually clamps
    // scrollTop — confirmed live against a real 88,000-line file, where a
    // small fixed pixel epsilon never matched. `viewport.to` is what
    // CodeMirror has actually decided to draw for the current scroll
    // position, so comparing it to the document length is exact regardless
    // of any height estimation drift.
    const atDocEnd = this.cmEditor.viewport.to >= this.cmEditor.state.doc.length;
    if (atDocEnd && this.chunkedRenderState) {
      void this.syncScrollToPreviewBottom();
      return;
    }
    this.syncing = true;
    const scrollRatio = editorHeight > 0 ? currentTop / editorHeight : 0;
    const previewHeight = this.elPreviewPane.scrollHeight - this.elPreviewPane.clientHeight;
    const target = scrollRatio * previewHeight;
    this.lastSyncedPreviewScrollTop = target;
    this.elPreviewPane.scrollTop = target;
    this.syncing = false;
  }

  /**
   * Handles syncScrollToPreview's bottom edge when the preview still has
   * unmounted chunks: force-mounts the rest (same drain Copy All uses) so
   * the preview's scrollHeight reflects the whole document, then jumps to
   * its real bottom — instead of the ordinary ratio-based jump, which would
   * only land at the bottom of whatever was mounted the instant the sync
   * fired. Re-checks that the editor is still at its bottom and the document
   * hasn't changed before applying the jump, since the drain can take long
   * enough on a huge document for either to no longer hold.
   *
   * On the most extreme real documents this drain has been measured at
   * ~106s (thousands of chunks, tens of thousands of images each needing a
   * real DOM slot + IntersectionObserver registration) — long enough that a
   * silent wait looks indistinguishable from a frozen preview pane. Past a
   * short debounce (so ordinary documents never see it), a small status
   * toast shows progress, reusing the same element Copy All's confirmation
   * messages use.
   */
  private async syncScrollToPreviewBottom(): Promise<void> {
    const state = this.chunkedRenderState;
    if (!state || this.bottomDrainGeneration === state.generation) {
      return;
    }
    const generation = state.generation;
    this.bottomDrainGeneration = generation;
    if (this.copyToastHideTimer) {
      clearTimeout(this.copyToastHideTimer);
      this.copyToastHideTimer = null;
    }
    let showToastTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      showToastTimer = null;
      this.scrollCatchUpState = { done: state.cursor, total: state.chunks.length };
      this.updateScrollCatchUpToast();
    }, 200);
    try {
      await this.drainRemainingChunks(state, (done, total) => {
        if (!this.scrollCatchUpState) return;
        this.scrollCatchUpState = { done, total };
        this.updateScrollCatchUpToast();
      }, new AbortController().signal);
    } finally {
      if (showToastTimer) {
        clearTimeout(showToastTimer);
      }
      if (this.scrollCatchUpState) {
        this.scrollCatchUpState = null;
        this.elCopyToast.hidden = true;
      }
      if (this.bottomDrainGeneration === generation) {
        this.bottomDrainGeneration = null;
      }
    }
    if (generation !== this.previewGeneration || this.layout !== 'split' || !this.cmEditor) {
      return;
    }
    // See the comment in syncScrollToPreview on why this is viewport-based
    // rather than a scrollHeight/scrollTop pixel comparison.
    if (this.cmEditor.viewport.to < this.cmEditor.state.doc.length) {
      return;
    }
    this.syncing = true;
    const target = this.elPreviewPane.scrollHeight - this.elPreviewPane.clientHeight;
    this.lastSyncedPreviewScrollTop = target;
    this.elPreviewPane.scrollTop = target;
    this.syncing = false;
  }

  /** Syncs the catch-up toast's text from `scrollCatchUpState`, bypassing `render()` — see `updateCopyRenderDialogProgress` for why. No-op while the toast isn't showing. */
  private updateScrollCatchUpToast(): void {
    if (!this.scrollCatchUpState) {
      return;
    }
    const { done, total } = this.scrollCatchUpState;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    this.elCopyToast.textContent = total > 0 ? `Catching up the preview... (${percent}%)` : 'Catching up the preview...';
    this.elCopyToast.hidden = false;
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
    || policy.lineBreak
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
    case 'line-break':
      return 'insert-line-break';
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

function normalizeImageInsertDecision(
  decision: MdzipImageInsertDecision | null | undefined
): MdzipImageInsertDecision | null {
  if (!decision) {
    return null;
  }
  const normalizeDimension = (value: number | undefined): number | undefined =>
    value !== undefined && Number.isFinite(value) && value > 0
      ? Math.round(value)
      : undefined;
  return {
    mode: decision.mode === 'html' ? 'html' : 'markdown',
    altText: decision.altText ?? '',
    width: normalizeDimension(decision.width),
    height: normalizeDimension(decision.height),
    position: normalizeImagePosition(decision.position)
  };
}

function normalizeImagePosition(position: MdzipImagePosition | undefined): MdzipImagePosition {
  switch (position) {
    case 'left':
    case 'center':
    case 'right':
    case 'wrap-left':
    case 'wrap-right':
      return position;
    default:
      return 'inline';
  }
}

function formatImageInsertMarkdown(
  markdownPath: string,
  decision: MdzipImageInsertDecision,
  currentText = '',
  selectionStart = 0,
  selectionEnd = selectionStart
): string {
  if (decision.mode === 'html') {
    const attrs = [
      `src="${escapeHtml(markdownPath)}"`,
      `alt="${escapeHtml(decision.altText)}"`
    ];
    if (decision.width) {
      attrs.push(`width="${decision.width}"`);
    }
    if (decision.height) {
      attrs.push(`height="${decision.height}"`);
    }
    if (decision.position === 'wrap-left' || decision.position === 'wrap-right') {
      attrs.push(`align="${decision.position === 'wrap-left' ? 'left' : 'right'}"`);
    }
    const image = `<img ${attrs.join(' ')}>`;
    if (decision.position === 'left' || decision.position === 'center' || decision.position === 'right') {
      return padHtmlImageBlock(`<p align="${decision.position}">${image}</p>`, currentText, selectionStart, selectionEnd);
    }
    return padHtmlImageBlock(image, currentText, selectionStart, selectionEnd);
  }
  return `![${escapeMarkdownImageAlt(decision.altText)}](${markdownPath})`;
}

function padHtmlImageBlock(
  html: string,
  currentText: string,
  selectionStart: number,
  selectionEnd: number
): string {
  const before = currentText.slice(0, Math.max(0, selectionStart));
  const after = currentText.slice(Math.max(selectionStart, selectionEnd));
  const prefix = before.length === 0 || before.endsWith('\n\n')
    ? ''
    : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = after.startsWith('\n\n')
    ? ''
    : after.startsWith('\n') ? '\n' : '\n\n';
  return `${prefix}${html}${suffix}`;
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'Not available';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  // One decimal below 10 of a unit (e.g. "1.4 MB"), none above (e.g. "23 MB") —
  // matches how OS file managers commonly round these.
  const formatted = value < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${formatted} ${units[unitIndex]}`;
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
          <button type="button" data-format="line-break" data-format-control="lineBreak" title="Line break" aria-label="Line break">${LINE_BREAK_ICON_HTML}</button>
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
      <button type="button" class="icon-toggle" data-ref="search-btn" title="Find/replace (Mod-F)" aria-label="Find/replace">
        ${SEARCH_ICON_HTML}
      </button>
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
      <section class="pane preview-pane" data-ref="preview-pane" tabindex="-1">
        <article class="preview-content" data-ref="preview-content"></article>
      </section>
      <section class="pane entry-pane" data-ref="entry-pane"></section>
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

  <div class="title-dialog-backdrop" data-ref="image-insert-dialog" hidden
    role="dialog" aria-modal="true" aria-labelledby="mdzip-image-insert-dialog-heading">
    <div class="title-dialog image-insert-dialog">
      <h3 id="mdzip-image-insert-dialog-heading">Insert Image</h3>
      <p>Choose the Markdown inserted for this image.</p>
      <fieldset class="image-insert-options">
        <legend>Output</legend>
        <label>
          <input type="radio" name="mdzip-image-insert-mode" value="markdown"
            data-ref="image-insert-mode-markdown" checked />
          Markdown image
        </label>
        <label>
          <input type="radio" name="mdzip-image-insert-mode" value="html"
            data-ref="image-insert-mode-html" />
          HTML &lt;img&gt; with sizing
        </label>
      </fieldset>
      <label class="image-insert-field">
        <span>Alt text</span>
        <input type="text" data-ref="image-insert-alt" />
      </label>
      <div class="image-insert-grid">
        <label class="image-insert-field">
          <span>Size by</span>
          <select data-ref="image-insert-size-mode">
            <option value="original">Original size</option>
            <option value="width" selected>Width</option>
            <option value="height">Height</option>
            <option value="percent">Percent</option>
          </select>
        </label>
        <label class="image-insert-field">
          <span>Value</span>
          <input type="number" min="1" step="1" data-ref="image-insert-size-value" />
        </label>
      </div>
      <label class="image-insert-field">
        <span>Position</span>
        <select data-ref="image-insert-position">
          <option value="inline">Inline/default</option>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
          <option value="wrap-left">Wrap left</option>
          <option value="wrap-right">Wrap right</option>
        </select>
      </label>
      <div class="title-dialog-actions">
        <button type="button" data-action="cancel-image-insert">Cancel</button>
        <button type="button" class="save-title" data-ref="image-insert-confirm-btn">Insert</button>
      </div>
    </div>
  </div>

  <div class="title-dialog-backdrop" data-ref="pack-files-dialog" hidden
    role="dialog" aria-modal="true" aria-labelledby="mdzip-pack-files-dialog-heading">
    <div class="title-dialog pack-files-dialog">
      <h3 id="mdzip-pack-files-dialog-heading">Package Markdown Files</h3>
      <p>These files contain more than one Markdown document. Choose how to package them.</p>
      <fieldset class="pack-files-options">
        <legend>Mode</legend>
        <label>
          <input type="radio" name="mdzip-pack-files-mode" value="document"
            data-ref="pack-files-mode-document" checked />
          Document — one primary page; the rest are attached
        </label>
        <label>
          <input type="radio" name="mdzip-pack-files-mode" value="project"
            data-ref="pack-files-mode-project" />
          Project — a set of related documents
        </label>
      </fieldset>
      <label class="pack-files-field">
        <span>Entry point</span>
        <select data-ref="pack-files-entry"></select>
      </label>
      <div class="title-dialog-actions">
        <button type="button" data-action="cancel-pack-files">Cancel</button>
        <button type="button" class="save-title" data-ref="pack-files-confirm-btn">Package</button>
      </div>
    </div>
  </div>

  <div class="title-dialog-backdrop" data-ref="copy-render-dialog" hidden
    role="dialog" aria-modal="true" aria-labelledby="mdzip-copy-render-dialog-heading">
    <div class="title-dialog copy-render-dialog">
      <h3 id="mdzip-copy-render-dialog-heading" data-ref="copy-render-heading">Copying document...</h3>
      <div data-ref="copy-render-progress-section">
        <p data-ref="copy-render-progress-text">Rendering the full document...</p>
        <div class="copy-render-progress-track">
          <div class="copy-render-progress-bar" data-ref="copy-render-progress-bar"></div>
        </div>
      </div>
      <p data-ref="copy-render-ready-text" hidden>
        The document is ready. Browsers only allow a clipboard write right after a click, so this needs one more —
        click Copy to finish.
      </p>
      <p data-ref="copy-render-done-text" hidden></p>
      <div class="title-dialog-actions">
        <button type="button" data-action="cancel-copy-render" data-ref="copy-render-cancel-btn">Cancel</button>
        <button type="button" data-action="cancel-copy-ready" data-ref="copy-render-ready-cancel-btn" hidden>Cancel</button>
        <button type="button" class="save-title" data-action="confirm-copy-ready" data-ref="copy-render-confirm-btn" hidden>Copy</button>
        <button type="button" class="save-title" data-action="dismiss-copy-render" data-ref="copy-render-dismiss-btn" hidden>Dismiss</button>
      </div>
    </div>
  </div>

  <div class="title-dialog-backdrop" data-ref="metadata-dialog" hidden
    role="dialog" aria-modal="true" aria-labelledby="mdzip-metadata-dialog-heading">
    <div class="title-dialog metadata-dialog">
      <h3 id="mdzip-metadata-dialog-heading">Document Information</h3>
      <dl data-ref="metadata-list"></dl>
      <h4>Libraries</h4>
      <dl data-ref="library-list"></dl>
      <div class="title-dialog-actions">
        <button type="button" class="save-title" data-action="close-metadata">Close</button>
      </div>
    </div>
  </div>

  <div class="title-dialog-backdrop" data-ref="name-dialog" hidden
    role="dialog" aria-modal="true" aria-labelledby="mdzip-name-dialog-heading">
    <div class="title-dialog">
      <h3 id="mdzip-name-dialog-heading" data-ref="name-dialog-heading">New Markdown File</h3>
      <input type="text" maxlength="260" data-ref="name-input" aria-label="File name" />
      <p class="title-dialog-validation" data-ref="name-validation" hidden></p>
      <div class="title-dialog-actions">
        <button type="button" data-action="cancel-name">Cancel</button>
        <button type="button" class="save-title" data-ref="name-confirm-btn">Create</button>
      </div>
    </div>
  </div>

  <div class="title-dialog-backdrop" data-ref="delete-dialog" hidden
    role="dialog" aria-modal="true" aria-labelledby="mdzip-delete-dialog-heading">
    <div class="title-dialog">
      <h3 id="mdzip-delete-dialog-heading">Delete File?</h3>
      <p data-ref="delete-dialog-text"></p>
      <div class="title-dialog-actions">
        <button type="button" data-action="cancel-delete">Cancel</button>
        <button type="button" class="danger-action" data-ref="delete-confirm-btn">Delete</button>
      </div>
    </div>
  </div>

  <input type="file" data-ref="replace-input" hidden />

  <div class="nav-context-menu" data-ref="nav-menu" hidden role="menu"></div>

  <div class="mdzip-tooltip" data-ref="tooltip" role="tooltip" hidden></div>

  <div class="mdzip-copy-toast" data-ref="copy-toast" role="status" aria-live="polite" hidden></div>

  <p class="mdzip-empty" data-ref="empty-state">No MDZip workspace loaded.</p>
</section>
`;
