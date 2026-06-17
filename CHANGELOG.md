# Changelog

## [1.3.11] - 2026-06-15

### Fixed
- Mermaid diagrams now initialize with `htmlLabels: false` (and
  `flowchart.htmlLabels: false`), so labels render as SVG `<text>` instead of
  HTML inside `<foreignObject>`. The bundled SVG sanitize policy strips
  foreignObject HTML, so html labels would otherwise vanish from the rendered
  diagram. This keeps the emitted SVG self-consistent with the sanitizer for
  every consumer without re-allowing HTML in labels.

## [1.3.10] - 2026-06-15

### Added
- Mermaid diagram support via a new optional extension at the
  `@mdzip/editor/mermaid` entrypoint (`mdzipMermaidExtension`). Renders fenced
  ` ```mermaid ` blocks to inline SVG in the preview, with theme following the
  color scheme (`'auto'` by default), mermaid `strict` security level, per-SVG
  re-sanitization, and inline error blocks for invalid diagrams. Mermaid is an
  optional peer dependency, dynamically imported only when a document contains a
  mermaid block, so the ~1MB library stays out of the core bundle (issue #14).
- `MdzipSanitizeContribution`: render extensions can declare narrow, opt-in
  relaxations to the pipeline's DOMPurify pass (e.g. `allowSvg`) via a new
  `sanitize` field, so `transformHtml` output such as inline SVG survives
  sanitization. Exposed `sanitizeMdzipHtml(html, contributions)`.

### Changed
- The default markdown renderer now preserves the requested language as a
  `language-*` class on fenced code blocks even when the language is not
  highlightable (e.g. `mermaid`), so extensions and client-side highlighters
  can find them.
- Archive image load failures are no longer silent (issue #11). When a `blob:`
  object URL fails to load (typically a host CSP whose `img-src` omits `blob:`),
  the view retries once with a `data:` URL and, if that also fails, reports it
  via `onFailed` instead of leaving a blank box. Documented the `blob:`/`data:`
  CSP requirement for restricted hosts in the README. Added
  `MdzipAssetSession.resolveDataUrl()`.

## [1.3.9] - 2026-06-15

### Fixed
- Out-of-order async parses no longer leave the editor on stale content when
  `[bytes]` changes twice in quick succession (issue #10). `openArchive` and
  `openWorkspace` now carry a generation token and discard any parse that a
  newer open has superseded, so the most recent input always wins regardless
  of resolution order. Covers the Angular `MdzipWorkspaceComponent`, which
  routes `[bytes]`/`[workspace]` changes through these methods.
- Orphaned-asset indicators in the nav pane no longer disappear from the
  remaining orphans after removing one orphaned asset (issue #12). Reloads that
  preserve the current text now re-run orphaned-asset analysis when it was
  already active, so remaining orphans stay flagged without reopening the nav
  pane. Applies to every mutation that reloads (remove/rename/etc.).

## [1.3.8] - 2026-06-14

### Changed
- Progressive preview images now **animate** their slot open instead of
  snapping to the reserved height (issue #9 follow-up, Option B). Each archive
  image mounts inside a collapsed slot so the text stays compact and
  immediately readable; when the image resolves, the slot eases open
  (`0fr -> 1fr`) to the height reserved from its sniffed dimensions in a
  single deterministic slide, and the pixels drop into the exact box with no
  further reflow. Honors `prefers-reduced-motion` (snaps open instead).

## [1.3.7] - 2026-06-14

### Added
- Progressive preview image hydration (completes #9). The read-only preview
  now mounts its text immediately and swaps each archive image in as its bytes
  resolve, reserving correctly-proportioned layout space ahead of the visual
  load from dimensions sniffed out of the image header (PNG, JPEG, GIF, WebP,
  BMP, SVG). This avoids the text-blocked-on-images delay and the layout shift
  of late-arriving images. Exposed `MdzipAssetSession.resolveImage()` (URL +
  intrinsic size) and the `sniffImageSize()` helper.

### Changed
- `onAssetsHydrated` / `whenRendered()` now resolve once every referenced
  preview image has resolved and had its final `src` assigned, rather than
  waiting on individual `<img>` load events.

## [1.3.6] - 2026-06-14

### Added
- `MdzipDiffView` change-navigation: built-in Previous/Next change toolbar
  buttons and `openPreviousChange()` / `openNextChange()` methods that walk
  the non-unchanged entries (disabled at the ends). Exposed on the Angular,
  React, and Vue diff wrappers.
- `MdzipDiffView` `controls` option (`navigation`, `changeTraversal`,
  `showUnchanged`; all default on) to opt individual built-in toolbar
  controls out. Also surfaced on the diff wrappers.
- Preview lifecycle signals on `MdzipWorkspaceView`: `onPreviewRendered` and
  `onAssetsHydrated` callbacks plus a `whenRendered()` promise that resolves
  once the current preview (including its images) is mounted and hydrated.
  Hosts can reveal or animate preview content without observing private DOM.
  Exposed on all three workspace wrappers (Angular/Vue as
  `previewRendered`/`assetsHydrated` outputs/events; `whenRendered()` on each
  imperative handle).

### Changed
- The diff navigation pane now collapses with the same animated transition as
  the workspace navigation pane (class-based width/opacity) instead of an
  instant `hidden` toggle, and the diff toolbar buttons share the editor
  nav-toggle sizing and link-colored active state.
- "Show unchanged" moved from a nav-pane checkbox to a pressed toolbar toggle
  to avoid duplicate controls; `setShowUnchanged()` is unchanged.

## [1.3.5] - 2026-06-14

### Added
- Lazy, session-scoped image resolution that reads only images referenced by
  the active document or explicitly selected by the user.
- Optional content-addressed asset caching through `MdzipAssetCache`, including
  the bounded `MdzipIndexedDbAssetCache` browser adapter and stable
  `assetSourceId` support for pre-parsed workspaces.
- A built-in diff toolbar with navigation visibility control and typed,
  asynchronous host actions. Angular, React, and Vue wrappers expose the same
  action API without reopening the compared archives.

### Performance
- Opening a workspace no longer decodes every image. Resolved URLs are reused
  within the session and released when the workspace is replaced or destroyed.
- Persistent cache failures fall back to lazy archive reads without breaking
  rendering.

## [1.3.4] - 2026-06-13

### Added
- Completed `MdzipDiffView` with hierarchical union navigation, keyboard
  support, explicit missing-side states, image dimensions and metadata,
  binary MIME metadata, and corrupt-side isolation.
- Added React and Vue diff-view entry points, an Angular diff component, and
  a browser demo comparison tab.
- Expanded diff coverage for one-sided text, images, binaries, object URL
  cleanup, stale async selection, invalid archives, keyboard navigation, and
  large entry sets.

### Performance
- Immediate duplicate `open()` calls are deduplicated.
- Diff dependencies remain outside normal editor wrapper bundles. React and
  Vue use dedicated `/diff-view` exports; Angular loads the core diff view
  dynamically when its diff component mounts.

## [1.3.3] - 2026-06-13

### Added
- `MdzipConversionContext` for host-resolved plain-Markdown image workflows.
  Hosts can insert Markdown at the captured selection or continue with the
  built-in MDZ conversion without depending on CodeMirror internals.
- `@mdzip/editor/diff-view`, an optional read-only archive comparison view
  with hierarchical union navigation, entry status filtering, side-by-side
  text diffs, explicit missing-side states, image comparison, binary metadata,
  corrupt-side isolation, stale-load protection, and cleanup.
- Native `MdzipDiff` wrappers for React and Vue, an Angular
  `MdzipDiffComponent`, and a browser demo comparison tab.
- `@mdzip/editor/preview`, a preview-focused entry point that excludes the
  CodeMirror-backed workspace view from its module graph.
- The Document Information dialog now includes the editor and major runtime
  libraries with their generated installed versions. Angular, React, and Vue
  wrappers automatically identify their active framework package there.
  Library names link to their repositories and include short descriptions.

### Changed
- `MdzipWorkspaceView` initializes CodeMirror only when source editing,
  split layout, or an imperative editor command first requires it.
- Angular, React, and Vue conversion hooks now receive the additive
  selection-aware conversion context.

### Performance
- Preview-only views no longer construct a CodeMirror editor.
- Diff entry content and image object URLs are created only for the selected
  archive path; text diff work uses bounded scan and timeout settings.

## [1.3.2] - 2026-06-12

### Added
- Rendering extensibility (full implementation of the accepted design in
  `design/editor-renderer-extensibility-request.md`):
  - `markdownRenderer` view option (and wrapper input/prop) replaces the
    markdown renderer. Renderers receive a documented
    `MdzipMarkdownRenderContext` (path, source format, color scheme, mode,
    manifest, asset resolver, `AbortSignal`) and may render asynchronously;
    stale results are dropped when the selection or content moves on.
  - `markdownExtensions`: composable pipeline hooks
    (`transformMarkdown` → renderer → `transformHtml` → sanitize → `mount`).
    Transform output always passes through DOMPurify; `mount()` handles are
    destroyed before the preview re-renders and on view destruction.
  - `entryRenderers`: claim the full pane stack for selected archive
    entries (first match by descending priority; built-in rendering is the
    fallback). The entry context exposes `readBytes()` and
    `updateManifest()` instead of view internals. Includes
    `mdzipPathMatcher`/`mdzipExtensionMatcher` predicate helpers and
    `setRenderingOptions()` for in-place reconfiguration.
  - Native framework entry rendering with identical matching, priority,
    fallback, and lifecycle semantics: Angular
    `<ng-template mdzipEntryRenderer="…">` / `[mdzipEntryRendererMatch]`
    directives, React `renderEntry` render prop (content stays live with
    parent state), and the Vue `#entry` scoped slot (empty render
    delegates). Explicit `entryRenderers` win over the native catch-all at
    equal priority.
- `MdzipWorkspaceService.updateManifest()`: replaces the manifest wholesale
  (canonicalized), routes through the `'manifest'` edit event so
  `onManifestChanged` host-delegated persistence keeps working.

### Changed
- Preview rendering is memoized on (path, content, color scheme, images):
  unrelated snapshot renders (dialogs, navigation, layout toggles) no longer
  re-run marked/DOMPurify or reset preview DOM. With no extensions
  registered the render path is fully synchronous, as before.
- Wrapper rendering props apply in place via `setRenderingOptions()` —
  never by recreating the workspace view. Extension/renderer arrays are
  diffed by stable `name`/`id`, so inline array literals are safe.

### Internal
- New vitest + jsdom test suites for the React, Vue, and Angular wrappers
  (adapter lifecycle, identity-safe updates, delegation), plus core
  contract tests for the rendering pipeline and entry renderer lifecycle.
- ESLint flat config across all packages; `npm run verify` now runs
  build + lint + test.

## [1.3.1] - 2026-06-12

### Fixed
- React wrapper: the workspace view is no longer destroyed and recreated when
  callback props (e.g. inline `onSaved` handlers) change identity between
  renders — previously this blanked the editor on any re-render that did not
  also change `bytes`/`mode`/`fileName`. When a config prop (`controls`,
  layouts, navigation) does legitimately rebuild the view, the current
  document is now reopened automatically.
- Demo: the Vue tab now loads documents in production builds. The tab relied
  on Vue's dev-only `app._instance` internal to force re-renders; it now uses
  a `shallowRef` and normal reactivity.

### Documentation
- Replaced deprecated package names (`mdzip-core-js` → `@mdzip/core-js`,
  `mdzip-editor` → `@mdzip/editor`) across the READMEs and guides, and fixed
  broken GitHub doc links in the `@mdzip/editor` README.
- Root README now lists the React and Vue wrapper packages.
- Angular imperative-API examples now use template reference variables
  instead of `@ViewChild`.

## [1.3.0] - 2026-06-11

### Added
- Navigation-pane context menu for file management: New .md File, New Folder,
  Rename/Move (edit the full archive path), Duplicate, Replace…, Download,
  Copy Markdown Link / Copy Image Embed, Set as Entry Point, Set/Remove Cover
  Image, and Delete (confirmation prompt; orphaned assets delete immediately,
  matching the previous orphan menu). The entry point and `manifest.json` are
  protected from deletion; the manifest offers Download only.
- Drag and drop: move files between folders in the nav tree, drop OS files
  onto the pane to add them as assets (duplicate names auto-suffixed), drag
  tree files onto the editor to insert a markdown link or image embed at the
  pointer position, and drop OS image files onto the editor to embed them
  like a paste.
- The entry-point document is shown bold in the nav tree; folders created via
  New Folder render dimmed until they contain a file.
- New workspace/view APIs: `removeFile()` (deletes assets *and* non-entry
  markdown documents — previously `removeAsset` could not delete documents),
  `renameFile()` (rewrites markdown references across documents, including
  re-basing a moved document's own relative links), `setEntryPoint()`, and
  `setCoverImage()`. Exported path helpers `normalizeArchivePath` and
  `relativeArchivePath`.
- New `fileActions` control-policy flag gating the mutating file operations
  (enabled in the `standalone-editor` and `hosted-editor` presets). Copy and
  Download remain available in read-only/viewer contexts.
- `onConversionRequested` host hook on the view options (and all framework
  wrappers): return/resolve `true` to take over the markdown→MDZ conversion
  flow and suppress the built-in dialog. `MdzipConversionAction` is exported.
- Angular, React, and Vue wrappers expose the new file-management methods and
  the conversion hook.

### Changed
- The orphan-asset context menu was generalized into the nav context menu;
  orphan delete semantics are unchanged.

## [1.2.0] - 2026-06-07

### Added
- Comprehensive developer guide with API documentation for all frameworks
- Detailed theming guide with CSS variable reference and custom theme examples
- New theme test suite (`theme.test.mjs`)
- Theme system with built-in light and dark color schemes
- Exported theme constants: `MDZIP_VARIABLES_CSS`, `MDZIP_LIGHT_THEME_CSS`, `MDZIP_DARK_THEME_CSS`

### Changed
- Refactored workspace view architecture for better separation of concerns
- Redesigned rendering pipeline with improved Markdown-to-HTML conversion
- Updated all framework wrappers (Angular, React, Vue) with new API surface
- Migrated syntax highlighting to highlight.js with reliable language fallbacks
- Enhanced theme integration across all component layers

### Fixed
- Language fallback for unsupported code block languages
- Proper timing for dynamic language loading
- Archive utility functions for better MDZ handling

### Dependencies
- Updated to `mdzip-core-js` 1.2.0
