# MDZip Library Plan: Core And Editor

This plan turns the MDZip Studio integration notes into package-level follow-up work.
The main split is:

- `mdzip-core-js` owns archive, spec, manifest, path, validation, and byte-level workspace behavior.
- `mdzip-editor` owns editor state, rendering integration, host lifecycle, and embedded-editor events.

## Goals

- Reduce duplicated archive parsing, manifest serialization, asset classification, and save behavior across MDZip apps.
- Give desktop and web app shells a stable workspace model instead of forcing them to traverse ZIP entries directly.
- Let embedded editor hosts open, flush, save, and observe editor state without routing through browser download behavior.
- Keep core UI-agnostic and keep editor host-aware but framework-neutral where possible.

## Non-Goals

- Do not move UI prompts, confirmation flows, sidebars, or app-specific navigation into `mdzip-core-js`.
- Do not require `mdzip-core-js` to eagerly generate thumbnails or data URLs for every asset during open.
- Do not make `mdzip-editor` the single source of truth for the MDZip archive format.
- Do not make Angular a hard requirement unless the editor package is intentionally Angular-first.

## `mdzip-core-js`

### Current Useful Surface

`mdzip-core-js` already exposes lower-level archive primitives that Studio and other apps should build on:

- `MdzArchiveCore.open()`
- `listPaths()` / `listEntries()`
- `readText()` / `readBytes()` / `readBase64()` / `readDataUri()`
- `readManifest()`
- `resolveEntryPoint()` / `resolveMode()`
- `validate()`
- `addFile()` / `removeFile()` / `removeFiles()`
- `findOrphanedAssets()`
- path normalization, path validation, entry-point resolution, MIME image maps, and packaging helpers

The remaining gap is a higher-level workspace model that composes these primitives into one app-friendly contract.

### Proposed Workspace Types

Add normalized workspace types that avoid leaking ZIP-library internals:

```ts
export interface MdzWorkspace {
  title: string | null;
  mode: MdzManifestMode;
  manifest: MdzManifest | null;
  entryPoint: string | null;
  documents: MdzWorkspaceDocument[];
  assets: MdzWorkspaceAsset[];
  validation: MdzValidationResult;
  orphanedAssets?: MdzOrphanedAssetsResult;
}

export interface MdzWorkspaceDocument {
  path: string;
  title: string;
  text: string;
  isEntryPoint: boolean;
}

export interface MdzWorkspaceAsset {
  path: string;
  fileName: string;
  byteSize: number;
  mimeType: string;
  kind: 'image' | 'audio' | 'video' | 'font' | 'data' | 'other';
  isPreviewable: boolean;
  readBytes?: () => Promise<Uint8Array>;
  readDataUri?: () => Promise<string>;
}
```

`readBytes` and `readDataUri` should be lazy when possible. Apps need fast open, and media libraries can request previews only for visible items.

### API: Open Workspace

Add:

```ts
MdzArchiveCore.openWorkspace(input, options?): Promise<MdzWorkspace>
```

Recommended options:

```ts
interface MdzOpenWorkspaceOptions {
  includeOrphanedAssetAnalysis?: boolean;
  orphanedAssetScanMode?: 'entrypoint' | 'all-markdown';
  includeLazyAssetReaders?: boolean;
}
```

Behavior:

- Open and validate the archive.
- Resolve manifest, mode, and entry point.
- Read all Markdown documents as UTF-8 text.
- List all non-Markdown assets with byte sizes, MIME types, classification, and previewability.
- Optionally include orphaned asset analysis.
- Preserve archive paths in normalized archive-relative form.

### API: Build Workspace

Add:

```ts
MdzPackagerCore.buildWorkspace(workspace, options?): Promise<MdzPackBuildResult>
```

Recommended behavior:

- Write all workspace documents.
- Write all asset bytes, including unchanged assets from an opened archive and newly imported assets.
- Generate or update `manifest.json` through canonical manifest helpers.
- Preserve `spec`, `producer.core`, `created`, and `modified` semantics consistently.
- Validate entry-point integrity before returning bytes.

This should become the preferred save path for app shells that already maintain a workspace object.

### Asset Import And Export

Add browser-safe helpers for converting user-provided files into workspace assets:

```ts
MdzWorkspaceAsset.fromFile(file, targetPath?, options?)
MdzWorkspaceAsset.toFile(asset)
```

Or, if static methods on interfaces are undesirable, expose package-level helpers:

```ts
createWorkspaceAssetFromFile(file, options?)
exportWorkspaceAsset(asset)
```

Important behavior:

- Normalize and validate target archive paths.
- Infer MIME type and asset kind.
- Preserve raw bytes.
- Avoid forcing callers to keep `File` objects around after import.

### Manifest And Metadata Helpers

Add canonical helpers for app-safe manifest editing:

```ts
MdzPackagerCore.createManifest(options): MdzManifest
MdzPackagerCore.updateManifest(manifest, updates, options?): MdzManifest
MdzPackagerCore.splitManifestMetadata(manifest): {
  reserved: MdzManifestReservedFields;
  editable: MdzManifestEditableMetadata;
}
```

Editable metadata should cover app-safe fields such as:

- `title`
- `author`
- `description`
- `keywords`
- `language`
- `license`
- document version
- cover path

Reserved/spec-managed fields should include:

- `spec`
- `producer`
- `created`
- `modified`
- `entryPoint`
- `mode`
- `files`

Apps may still expose advanced manifest editing, but normal metadata forms should not require hand-assembling spec fields.

### Validation Shape

The current validation result already separates `errors` and `warnings`.
Add a small status helper suitable for save indicators:

```ts
type MdzValidationStatus = 'valid' | 'warning' | 'error';

getValidationStatus(result: MdzValidationResult): MdzValidationStatus
```

This keeps UI wording out of core while giving hosts a stable state machine.

### Path And Tree Utilities

Consider adding low-risk path utilities:

```ts
MdzArchiveCore.sortArchivePaths(paths)
MdzArchiveCore.dirname(path)
MdzArchiveCore.basename(path)
MdzArchiveCore.buildPathTree(paths, options?)
```

This is useful, but lower priority than workspace open/build. Keep the tree shape generic and presentation-free.

### Priority

1. `openWorkspace()`
2. `buildWorkspace()`
3. binary asset round-tripping and asset import helpers
4. manifest creation/update/editable metadata helpers
5. validation status helper
6. path-tree utilities

## `mdzip-editor`

### Current Useful Surface

`mdzip-editor` already exposes editor/archive helpers and `MdzipRenderingService`, and Studio can embed `MdzipWorkspaceView`.
The main gaps are host lifecycle, direct workspace input, structured state events, and save/flush APIs.

### Host-Friendly Editor Contract

Add an explicit editor host interface:

```ts
export interface MdzipEditorHostState {
  dirty: boolean;
  validation: MdzValidationResult;
  validationStatus: 'valid' | 'warning' | 'error';
  title: string | null;
  currentPath: string | null;
  mode: MdzManifestMode;
}

export interface MdzipEditorSnapshot {
  workspace: MdzWorkspace;
  bytes: Blob;
  state: MdzipEditorHostState;
}
```

Add public methods on the embedded editor/view:

```ts
openArchive(bytes): Promise<void>
openWorkspace(workspace): Promise<void>
flush(): Promise<MdzipEditorSnapshot>
serialize(): Promise<Blob>
getCurrentSnapshot(): Promise<MdzipEditorSnapshot>
```

`flush()` should ensure pending edits are committed before the host performs native Save or Save As.

### Structured Events

Expose structured events instead of requiring hosts to infer state from callback payloads:

```ts
onWorkspaceChanged(event)
onDocumentChanged(event)
onAssetChanged(event)
onManifestChanged(event)
onSelectionChanged(event)
onValidationChanged(event)
onDirtyChanged(event)
onSnapshotChanged(event)
```

Events should include enough information for Studio to update sidebars, media tabs, validation chips, and window title without reparsing the archive.

### Workspace Input

Support opening an already-normalized `MdzWorkspace` directly.

This avoids the current pattern where Studio edits documents/assets in memory, repackages the workspace into bytes, and then hands those bytes back to the editor just so the editor can parse the archive again.

### Save And Desktop Lifecycle

Provide a minimal desktop-host contract:

- dirty state
- validation state
- display title
- current document path
- current archive bytes
- flush before native save
- lifecycle hooks for open, save, save as, close, and reload

The editor should not decide whether Save downloads a file, writes to disk, or calls a native bridge. It should provide the current snapshot and let the host choose.

### Navigation Host Mode

Document and implement host navigation modes:

```ts
type MdzipNavigationMode = 'editor' | 'host' | 'none';
```

- `editor`: built-in navigation pane is visible and editor-owned.
- `host`: editor emits selection/navigation events, but host owns the sidebar/tree.
- `none`: no navigation UI or host sidebar integration.

Studio should use `host` mode.

### Asset And Media Primitives

Expose editor-level asset actions/events that delegate archive semantics to `mdzip-core-js`:

```ts
addAsset(file, options?)
replaceAsset(path, file)
removeAsset(path)
listAssets()
insertAssetReference(path, options?)
```

These should update the workspace, emit structured events, and keep dirty/validation state current.

### Rendering

`MdzipRenderingService` can continue accepting an injected renderer.
Also consider exporting a default safe Markdown renderer:

```ts
createSafeMarkdownRenderer(options?)
```

Requirements:

- Sanitize rendered HTML by default.
- Avoid executing scripts.
- Treat local archive assets and external URLs explicitly.
- Make link/image policy configurable.

This is useful as a fallback for host apps, but it must have a clear safety contract.

### Framework Adapters

If `mdzip-editor` is framework-neutral, do not make Angular the core integration surface.
Instead, add a thin optional Angular wrapper package or adapter:

```txt
mdzip-editor-angular
```

If `mdzip-editor` is already Angular-first, then a documented Angular component is reasonable:

```html
<mdzip-workspace-view
  [workspace]="workspace"
  [navigationMode]="'host'"
  (snapshotChanged)="..."
/>
```

### Priority

1. `flush()`, `serialize()`, and `getCurrentSnapshot()`
2. direct `openWorkspace(workspace)`
3. structured dirty/validation/document/asset/manifest events
4. navigation host mode
5. asset/media primitives
6. default safe Markdown renderer
7. optional Angular adapter/component documentation

## Cross-Package Coordination

`mdzip-editor` should depend on `mdzip-core-js` for:

- workspace types
- manifest creation/update helpers
- archive serialization
- asset classification
- validation
- path normalization

`mdzip-core-js` should not depend on `mdzip-editor`.

Shared types should live in `mdzip-core-js` when they describe archive data, and in `mdzip-editor` when they describe editor state or UI lifecycle.

## Suggested Release Sequence

1. Ship `mdzip-core-js` workspace model types and `openWorkspace()`.
2. Add `buildWorkspace()` with asset byte preservation and canonical manifest updates.
3. Update `mdzip-editor` to accept `MdzWorkspace` directly.
4. Add editor `flush()`, `serialize()`, and snapshot APIs.
5. Add structured editor events and host navigation mode.
6. Migrate MDZip Studio to the new workspace/save contract.
7. Add optional media helpers, renderer fallback, and framework adapters.

## Acceptance Criteria

- Studio no longer hand-parses flat ZIP entries into documents/assets.
- Studio no longer hand-assembles normal `manifest.json` save output.
- Studio can preserve untouched binary assets across open/edit/save.
- Studio can import new assets without keeping binary handling in app-specific state code.
- Studio can call one editor method before native Save and receive current bytes, validation, and dirty state.
- The editor can open a normalized workspace without repackaging it first.
- Core remains browser-safe and UI-agnostic.
- Editor remains host-friendly and does not assume a specific desktop save implementation.
