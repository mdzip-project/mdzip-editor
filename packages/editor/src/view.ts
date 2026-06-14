import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, dropCursor, keymap, lineNumbers } from '@codemirror/view';
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
import type { MdzWorkspace, MdzWorkspaceAsset } from '@mdzip/core-js';
import { browserClipboardHasImage, readBrowserClipboardImage } from './browser.js';
import {
  MdzipAssetSession,
  mdzipArchiveSourceId,
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
import {
  MdzipRenderingService,
  defaultSafeMarkdownRenderer,
  type MdzipEntryRenderContext,
  type MdzipEntryRenderHandle,
  type MdzipEntryRenderer,
  type MdzipMarkdownRenderContext,
  type MdzipMarkdownRenderer,
  type MdzipMarkdownRenderExtension,
  type MdzipRenderHandle
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

export type MdzipConversionAction =
  | { kind: 'navigation' }
  | { kind: 'image-picker' }
  | { kind: 'image-file'; file: File };

export interface MdzipConversionContext {
  insertMarkdown(text: string): Promise<boolean>;
  convertToMdz(): Promise<boolean>;
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
  /** Enables nav-pane file management (create, rename, delete, move, …). */
  fileActions?: boolean;
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
  fileActions: boolean;
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
  /**
   * Additional host or framework libraries to show in Document Information.
   * Framework wrappers populate this automatically.
   */
  libraries?: readonly MdzipLibraryInfo[];
  /** Optional persistent cache for lazily resolved archive assets. */
  assetCache?: MdzipAssetCache;
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
    orphanActions: false,
    fileActions: false
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
    orphanActions: false,
    fileActions: false
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
    orphanActions: true,
    fileActions: true
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
    orphanActions: true,
    fileActions: true
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

function renderNavNode(
  node: MdzipNavNode,
  state: MdzipWorkspaceSnapshot,
  options: NavRenderOptions
): string {
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
      <span class="nav-caret"></span>
      <span class="nav-file-icon ${iconKind}">${iconHtml}</span>
      ${orphanBtnHtml}
      <span class="nav-label">${safeName}</span>
    </button>`;
  }
  const children = node.children.map(c => renderNavNode(c, state, options)).join('');
  const pending = options.pendingFolders.has(node.path.toLowerCase());
  return `<details class="nav-directory${pending ? ' pending-folder' : ''}" open data-nav-dir="${escapeHtml(node.path)}">
    <summary${pending ? ` title="${escapeHtml(node.path)} — not saved until it contains a file"` : ''}>
      <span class="nav-caret" aria-hidden="true"></span>
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

export class MdzipWorkspaceView {
  private workspace: MdzipWorkspaceService | null = null;
  private assetSession: MdzipAssetSession | null = null;
  private unsub: (() => void) | null = null;
  private readonly options: MdzipWorkspaceViewOptions;
  private readonly controlPolicy: MdzipResolvedControlPolicy;
  private readonly navigationMode: MdzipNavigationMode;

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
  private navMenuState: { target: MdzipNavMenuTarget; x: number; y: number } | null = null;
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
  private dragSourcePath: string | null = null;
  private dragOverElement: HTMLElement | null = null;
  private tooltipState: { text: string; x: number; y: number } | null = null;
  private tooltipShowTimer: ReturnType<typeof setTimeout> | null = null;
  private tooltipHideTimer: ReturnType<typeof setTimeout> | null = null;

  private cmEditor: EditorView | null = null;
  private readonly readOnlyCompartment = new Compartment();
  private updatingCm = false;
  private syncing = false;

  private markdownRenderer?: MdzipMarkdownRenderer;
  private markdownExtensions: readonly MdzipMarkdownRenderExtension[] = [];
  private entryRenderers: readonly MdzipEntryRenderer[] = [];
  private renderingService = new MdzipRenderingService();
  // Preview render memo: the preview pipeline only re-runs when one of these
  // inputs actually changed, so unrelated snapshot renders (dialogs, nav,
  // layout toggles) never reset preview DOM or re-run extension mounts.
  private previewMemo: {
    path: string;
    pathType: MdzipPathType;
    text: string;
    colorScheme: MdzipColorScheme;
  } | null = null;
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
    this.resetRenderingState();
    this.cmEditor?.destroy();
    this.cmEditor = null;
    this.workspace = null;
    this.replaceAssetSession(null);
    this.conversionDocumentGeneration += 1;

    try {
      const ws = await MdzipWorkspaceService.open(bytes, options);
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
    this.unsub?.();
    this.resetRenderingState();
    this.cmEditor?.destroy();
    this.cmEditor = null;
    this.workspace = null;
    this.replaceAssetSession(null);
    this.conversionDocumentGeneration += 1;

    try {
      const ws = await MdzipWorkspaceService.openWorkspace(workspace, options);
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
    this.conversionDocumentGeneration += 1;
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
    if (memo
      && memo.path === snapshot.currentPath
      && memo.pathType === snapshot.currentPathType
      && memo.text === snapshot.currentText
      && memo.colorScheme === this.colorScheme) {
      // Nothing that feeds the preview changed; keep the existing DOM and any
      // mounted extension handles.
      return;
    }

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
      this.applyPreviewHtml(result, snapshot, context, generation);
      return;
    }

    void result.then((html) => {
      if (generation !== this.previewGeneration || abort.signal.aborted) {
        return; // Stale: the selection or content moved on while rendering.
      }
      this.applyPreviewHtml(html, snapshot, context, generation);
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
    generation: number
  ): void {
    // When the preview references archive images, mount the text immediately
    // and hydrate each image progressively (reserving layout space from its
    // sniffed intrinsic size), rather than blocking the whole preview on image
    // resolution. Other markdown mounts synchronously.
    if (this.assetSession && /<img\b/i.test(html)) {
      this.mountProgressivePreview(html, snapshot, context, generation);
      return;
    }
    this.mountPreviewHtml(html, snapshot, context, generation);
  }

  private mountPreviewHtml(
    html: string,
    snapshot: MdzipWorkspaceSnapshot,
    context: MdzipMarkdownRenderContext,
    generation: number
  ): void {
    this.elPreviewContent.innerHTML = html;
    this.mountPreviewExtensions(context, generation);
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
    generation: number
  ): void {
    this.elPreviewContent.innerHTML = html;
    const session = this.assetSession;
    const pending: { image: HTMLImageElement; source: string }[] = [];
    for (const image of Array.from(this.elPreviewContent.querySelectorAll('img'))) {
      const source = image.getAttribute('src');
      // Leave external, protocol-relative, data, and fragment URLs untouched.
      if (!source || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)) {
        continue;
      }
      // Drop the archive-relative src so the browser does not fetch the bad
      // path; reserve the slot until the resolved bytes arrive.
      image.removeAttribute('src');
      image.classList.add('mdzip-image-loading');
      pending.push({ image, source });
    }

    this.mountPreviewExtensions(context, generation);
    this.firePreviewRendered(snapshot, generation);

    if (!session || pending.length === 0) {
      this.fireAssetsHydrated(snapshot, generation);
      return;
    }

    let remaining = pending.length;
    const settle = (): void => {
      remaining -= 1;
      if (remaining === 0) {
        this.fireAssetsHydrated(snapshot, generation);
      }
    };
    for (const { image, source } of pending) {
      void session.resolveImage(source, context.currentPath).then((resolved) => {
        if (generation !== this.previewGeneration || context.signal.aborted) {
          settle();
          return;
        }
        if (!resolved) {
          image.classList.remove('mdzip-image-loading');
          settle();
          return;
        }
        // Reserve correctly-proportioned space before the pixels decode so the
        // surrounding text does not reflow when the image appears.
        if (resolved.width && resolved.height) {
          image.setAttribute('width', String(resolved.width));
          image.setAttribute('height', String(resolved.height));
        }
        const clear = (): void => image.classList.remove('mdzip-image-loading');
        image.addEventListener('load', clear, { once: true });
        image.addEventListener('error', clear, { once: true });
        image.setAttribute('src', resolved.url);
        settle();
      }).catch((error) => {
        if ((error as { name?: string } | null)?.name !== 'AbortError') {
          this.options.onFailed?.(error);
        }
        image.classList.remove('mdzip-image-loading');
        settle();
      });
    }
  }

  private mountPreviewExtensions(context: MdzipMarkdownRenderContext, generation: number): void {
    for (const extension of this.markdownExtensions) {
      if (!extension.mount) {
        continue;
      }
      try {
        const mounted = extension.mount(this.elPreviewContent, context);
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
        ...(this.controlPolicy.lineNumbers ? [lineNumbers()] : []),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown(),
        syntaxHighlighting(mdzipMarkdownHighlight),
        EditorView.lineWrapping,
        dropCursor(),
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

    this.prunePendingFolders(snapshot);
    const navTree = snapshot.sourceFormat === 'mdz'
      ? mergePendingFolders(buildMdzipNavTree(snapshot.content.paths), this.pendingNewFolders)
      : [];
    const allowOrphanActions = this.controlPolicy.orphanActions && snapshot.mode !== 'read-only';
    const allowFileActions = this.allowFileActions(snapshot);
    const navRenderOptions: NavRenderOptions = {
      allowOrphanActions,
      allowFileActions,
      allowDrag: snapshot.mode !== 'read-only' && snapshot.sourceFormat === 'mdz',
      pendingFolders: new Set([...this.pendingNewFolders].map((path) => path.toLowerCase()))
    };
    this.elNavTree.innerHTML = navTree.map(n => renderNavNode(n, snapshot, navRenderOptions)).join('');
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
    this.elMetadataDialog.hidden = !this.metadataDialogOpen;

    if (this.navMenuState) {
      const items = this.navMenuItems(this.navMenuState.target, snapshot);
      if (items.length === 0) {
        this.navMenuState = null;
      } else {
        this.elNavMenu.innerHTML = items
          .map((item) => item === null
            ? '<div class="nav-menu-separator" role="separator"></div>'
            : `<button type="button" role="menuitem" data-menu-action="${escapeHtml(item.action)}">${escapeHtml(item.label)}</button>`)
          .join('');
        this.elNavMenu.hidden = false;
        const rect = this.elNavMenu.getBoundingClientRect();
        const win = this.elRoot.ownerDocument.defaultView ?? window;
        const x = Math.max(4, Math.min(this.navMenuState.x, win.innerWidth - rect.width - 8));
        const y = Math.max(4, Math.min(this.navMenuState.y, win.innerHeight - rect.height - 8));
        this.elNavMenu.style.left = `${x}px`;
        this.elNavMenu.style.top = `${y}px`;
      }
    }
    if (!this.navMenuState) {
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
      if (this.zoomOpen || this.navMenuState) {
        this.zoomOpen = false;
        this.navMenuState = null;
        this.render();
      }
    });

    doc.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') {
        return;
      }
      if (this.navMenuState || this.deleteDialogState || this.nameDialogState) {
        this.navMenuState = null;
        this.deleteDialogState = null;
        this.nameDialogState = null;
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

    this.elNavMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-menu-action]');
      if (item) {
        void this.handleNavMenuAction(item.dataset['menuAction'] ?? '');
      }
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
          await this.insertImageFile(action.file);
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
          [new Blob([image.bytes as unknown as BlobPart], { type: image.mimeType })],
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
    this.navMenuState = { target, x: clientX, y: clientY };
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
    const state = this.navMenuState;
    this.navMenuState = null;
    this.render();
    if (!state) {
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
        this.requestMdzConversion({ kind: 'image-file', file });
        return;
      }
      const editor = this.cmEditor;
      if (editor) {
        const pos = editor.posAtCoords({ x, y });
        if (pos !== null) {
          editor.dispatch({ selection: { anchor: pos } });
        }
      }
      await this.insertImageFile(file);
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

  <p class="mdzip-empty" data-ref="empty-state">No MDZip workspace loaded.</p>
</section>
`;
