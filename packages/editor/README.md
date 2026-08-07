[![MDZip logo][mdzip-logo]][mdzip-url]

[mdzip-logo]: https://raw.githubusercontent.com/mdzip-project/mdzip-editor/main/resources/mdzip-mark.svg
[mdzip-url]: https://mdzip.org

# @mdzip/editor

[![npm](https://img.shields.io/npm/v/@mdzip/editor?logo=npm)](https://www.npmjs.com/package/@mdzip/editor)
[![license](https://img.shields.io/npm/l/@mdzip/editor)](https://github.com/mdzip-project/mdzip-editor/blob/main/LICENSE)

Framework-independent MDZip workspace engine and browser view.

`@mdzip/editor` provides reusable helpers for opening `.mdz` archives, rendering Markdown previews, editing archive contents, comparing archive inventories, and embedding a configurable MDZip workspace UI.

## Install

```sh
npm install @mdzip/editor
```

## Basic Usage

```ts
import { MdzipWorkspaceView } from '@mdzip/editor';

const view = new MdzipWorkspaceView(container, {
  controls: 'viewer',
  initialLayout: 'preview',
  onFailed(error) {
    console.error(error);
  }
});

await view.open(bytes, {
  mode: 'read-only',
  fileName: 'document.mdz'
});
```

Regular Markdown is also supported:

```ts
await view.open(markdownBytes, {
  mode: 'editable',
  fileName: 'notes.md'
});
```

CodeMirror is not initialized until a source or split layout is used. Consumers
that only need archive, rendering, and preview helpers can import from
`@mdzip/editor/preview`; that entry point excludes `MdzipWorkspaceView` and its
CodeMirror dependencies from the module graph.

The filename normally selects the source format. Pass `sourceFormat:
'markdown'` or `sourceFormat: 'mdz'` to override detection.

Normalized `@mdzip/core-js` workspaces can be opened without an initial archive
rebuild:

```ts
await view.openWorkspace(workspace, {
  mode: 'editable',
  fileName: 'document.mdz',
  assetSourceId: 'document-etag-or-content-id'
});
```

Images are resolved only when referenced by the active document or selected in
the navigator. To reuse resolved bytes across sessions, inject the optional
bounded IndexedDB cache:

```ts
import { MdzipIndexedDbAssetCache, MdzipWorkspaceView } from '@mdzip/editor';

const view = new MdzipWorkspaceView(container, {
  assetCache: new MdzipIndexedDbAssetCache({ maxBytes: 64 * 1024 * 1024 })
});
```

For `openWorkspace()`, provide a stable `assetSourceId` (or `archiveBytes`) so
cache hits can bypass lazy ZIP readers. Cache and storage failures automatically
fall back to archive reads.

## Editor Mode

```ts
const view = new MdzipWorkspaceView(container, {
  controls: 'standalone-editor',
  async onSaved(bytes) {
    await persist(bytes);
    view.markPersisted();
  }
});

await view.open(bytes, {
  mode: 'editable',
  fileName: 'document.mdz'
});
```

When `onSaved` is omitted, the built-in Save button downloads the current file
in the browser. When `onSaved` is provided, the host owns persistence and must
call `markPersisted()` after a successful write. Failed writes should leave the
workspace dirty.

## Control Presets

- `preview`: clean document preview with no toolbar or package navigation.
- `viewer`: read-only viewer controls, including navigation, layout switching, and zoom.
- `standalone-editor`: full editor controls, including save.
- `hosted-editor`: editor controls without an embedded save button, for hosts such as VS Code that own persistence.

Call `setControls(nextControls)` to update the policy after construction
without rebuilding the workspace view. `lineNumbers` changes are applied to the
existing CodeMirror editor, preserving the current document and selection.

## Density and Spacing

Hosts can opt into smaller built-in UI without targeting private classes:

```ts
const view = new MdzipWorkspaceView(container, {
  controls: 'hosted-editor',
  toolbarDensity: 'compact', // 'comfortable' | 'compact' | 'dense'
  contentDensity: 'compact'  // 'comfortable' | 'compact'
});

view.setDensityOptions({
  toolbarDensity: 'dense',
  contentDensity: 'compact'
});
```

For exact sizing, set stable CSS custom properties on an ancestor of the
workspace:

```css
.studio-editor {
  --mdzip-toolbar-button-size: 28px;
  --mdzip-toolbar-compact-button-size: 26px;
  --mdzip-toolbar-icon-size: 14px;
  --mdzip-format-button-size: 26px;
  --mdzip-format-icon-size: 14px;
  --mdzip-toolbar-padding: 2px 8px;
  --mdzip-toolbar-gap: 4px;
  --mdzip-editor-content-padding: 16px 20px;
  --mdzip-preview-content-padding: 16px 20px 24px;
  --mdzip-preview-content-max-width: 720px;
}
```

## Preview Width

`previewMaxWidth` is a developer-facing option, not toolbar UI — it sets the
preview's reading-column width (`--mdzip-preview-content-max-width` under the
hood). A number is an exact pixel value; `'narrow'` / `'default'` / `'wide'`
are convenience aliases for 650 / 900 / 1200px:

```ts
const view = new MdzipWorkspaceView(container, {
  controls: 'hosted-editor',
  previewMaxWidth: 'wide' // or an exact pixel number, e.g. 760
});

view.setPreviewMaxWidth(720);
```

Leaving it unset (the default) keeps the built-in CSS default in effect,
which scales with the zoom control; an explicit value set here (or via the
`--mdzip-preview-content-max-width` CSS variable directly) does not scale
with zoom — it's used exactly as given.

## Host Persistence

Desktop hosts can flush pending editor content, persist the returned bytes, and
only then acknowledge a successful write:

```ts
const snapshot = await view.flush();
if (snapshot) {
  await nativeSave(snapshot.bytes);
  view.markPersisted();
}
```

`flush()` deliberately leaves `dirty` set until `markPersisted()` is called.
`serialize()` and `getCurrentSnapshot()` provide non-acknowledging alternatives.

Structured callbacks are available for workspace, document, asset, manifest,
selection, dirty, validation, and snapshot changes. Asset hosts can also call
`addAsset()`, `replaceAsset()`, `removeAsset()`, and `listAssets()`.

## File Management (navigation pane)

With `controls: 'standalone-editor'` or `'hosted-editor'` (or `fileActions: true`
in a custom policy), the navigation pane offers a right-click context menu: new
`.md` file, new folder, rename/move (edit the full archive path), duplicate,
replace, download, copy markdown link / image embed, set entry point (shown bold
in the tree), set/remove cover image, and delete with a confirmation prompt
(orphaned assets delete immediately). The entry-point document and
`manifest.json` cannot be deleted. Copy and Download remain available in
read-only contexts.

Drag and drop is supported in all directions: move files between folders, drop
OS files onto the pane to add them as assets, drag a tree file onto the editor
to insert a markdown link or image embed at the pointer, and drop an OS image
onto the editor to embed it like a paste.

The same operations are available programmatically: `removeFile()`,
`renameFile()` (rewrites markdown references, including a moved document's own
relative links), `setEntryPoint()`, and `setCoverImage()`.

## Conversion Hook

For plain-markdown sources, hosts can take over the markdown→MDZ conversion
flow (triggered by the nav button, Insert Image, or an image paste/drop):

```ts
const view = new MdzipWorkspaceView(container, {
  async onConversionRequested(action, context) {
    // action.kind: 'navigation' | 'image-picker' | 'image-file' (with action.file)
    const relativePath = await hostHandlesImage(action);
    return relativePath
      ? context.insertMarkdown(`![](${relativePath})`)
      : false;
  }
});
```

Returning or resolving `false` (or omitting the callback) keeps the built-in
conversion dialog. Errors thrown by the hook are reported via `onFailed` and
fall back to the built-in dialog. The context preserves the triggering
selection while a host dialog is open; it returns `false` if that document has
changed. `context.convertToMdz()` runs the built-in conversion and image action
against the same captured selection.

## Image Insert Hook

Set `imageInsertMode` to choose the built-in image markup flow:
`'markdown'` keeps the default `![alt](path)` insertion, `'html'` inserts a
default `<img>` element, and `'ask'` opens a small dialog for Markdown vs HTML,
alt text, proportional size, and alignment.

For host-owned UI, provide `imageInsertHandler`. It receives file metadata,
intrinsic image size when detected, and the source (`'paste'`, `'drop'`, or
`'picker'`). Return `{ mode: 'markdown', altText }` or
`{ mode: 'html', altText, width, height, position }`; return `null` to cancel.
The built-in dialog asks for width, height, or percent scaling and preserves
aspect ratio by emitting one dimension, or proportional dimensions for percent
scaling. Returning `undefined` falls back to `imageInsertMode`.
The built-in HTML path uses portable `align` attributes for positioning because
the default preview sanitizer strips inline `style` attributes.

`MdzipRenderingService` uses `defaultSafeMarkdownRenderer` when no renderer is
injected. The default renderer sanitizes generated HTML and unsafe URL schemes.

## Image Edit Hook

Editing an *existing* image (Markdown `![]()` or raw HTML `<img>`, including
one wrapped in `<p align="...">`) is fully opt-in — unlike image insertion,
there is no built-in fallback dialog and no `imageEditMode`. Set
`imageEditHandler` to enable it:

```ts
const view = new MdzipWorkspaceView(container, {
  async imageEditHandler(request) {
    // request: { src, altText, width?, height?, position?, mode: 'markdown' | 'html' }
    const decision = await hostEditDialog(request);
    if (!decision) return null; // cancel — leaves the image untouched
    return decision; // same shape as an image-insert decision
  }
});
```

With no `imageEditHandler` set, clicking an existing image does nothing —
no edit affordance ever appears. With one set, clicking an image reference
in the source editor shows a small edit icon next to it; clicking that icon
calls the handler with the image's current alt/width/height/position parsed
from its existing Markdown or HTML, and rewrites that exact reference in
place with whatever decision is returned (same `{ mode, altText, width,
height, position }` shape `imageInsertHandler` returns). Reference-style
Markdown images (`![alt][label]`) aren't supported.

## Pack Files Hook

Hosts that let a user pick a folder (Electron dialog, VS Code workspace API,
etc.) can hand the collected files straight to the view instead of building
the `.mdz` themselves:

```ts
const result = await view.packFilesAsWorkspace(
  files, // Array<{ path: string; bytes: Uint8Array }>
  { title: 'My Project', fileName: 'project.mdz' }
);
```

With zero or one Markdown file among `files`, it packs Document mode
immediately and opens the result in memory — no prompt. With more than one,
it needs a Document-vs-Project mode and entry-point decision. Provide
`onPackRequested` to own that decision:

```ts
const view = new MdzipWorkspaceView(container, {
  async onPackRequested(request, context) {
    // request.markdownFiles, request.suggestedEntryPoint
    const decision = await hostPicksModeAndEntryPoint(request);
    if (!decision) return false; // fall back to the built-in dialog
    await context.applyDecision(decision);
    return true;
  }
});
```

Returning or resolving `false` (or omitting the callback) keeps the built-in
dialog — a mode toggle plus an entry-point picker listing the discovered
Markdown files. Errors thrown by the hook are reported via `onFailed` and
fall back to the built-in dialog. `context.applyDecision({ mode, entryPoint })`
performs the actual pack either way.

Document mode opens the packed archive in the view (unsaved); Project mode
returns the archive bytes without opening them, since only the host knows
where a project archive should be saved — save it, then `view.open(bytes, ...)`.

## Rendering Extensibility

The view accepts a custom markdown renderer, composable markdown pipeline
extensions, and entry renderers that replace the content area for selected
archive entries — all optional, with built-in behavior as the fallback:

```ts
import { mdzipPathMatcher, type MdzipEntryRenderer } from '@mdzip/editor';

const manifestRenderer: MdzipEntryRenderer = {
  id: 'host-manifest-editor',
  priority: 100,
  matches: mdzipPathMatcher('manifest.json'),
  mount: (container, context) => mountManifestEditor(container, {
    manifest: context.manifest,
    editable: context.mode === 'editable',
    onChange: (manifest) => context.updateManifest(manifest)
  })
};

const view = new MdzipWorkspaceView(container, {
  markdownRenderer,                  // optional full renderer replacement
  markdownExtensions: [mermaidExt],  // transformMarkdown/transformHtml/mount
  entryRenderers: [manifestRenderer]
});
```

Renderers may be asynchronous; stale results are dropped when the selection
moves on. Sanitization stays in the pipeline: string output from custom
renderers and transform hooks passes through DOMPurify before insertion. Entry
renderer handles are destroyed on selection change and `destroy()`. The same
options are available as inputs/props on the Angular, React, and Vue wrappers.
See the Developer Guide's Rendering Extensibility section for the contracts
and lifecycle rules.

An extension whose `transformHtml` emits markup the default policy would strip
(inline SVG, for example) declares the narrow relaxations it needs via a
`sanitize` contribution (`MdzipSanitizeContribution`), merged into the single
DOMPurify pass. Keep contributions minimal — they widen the policy for the
whole preview, since the extension output and surrounding markdown HTML are
sanitized together.

### Mermaid diagrams

Render fenced ` ```mermaid ` blocks to inline SVG with the optional extension
from the `@mdzip/editor/mermaid` entrypoint. It is shipped separately so the
~1MB mermaid library stays out of the core bundle — it is dynamically imported
the first time a document actually contains a mermaid block. Install `mermaid`
(an optional peer dependency) alongside `@mdzip/editor`:

```ts
import { mdzipMermaidExtension } from '@mdzip/editor/mermaid';

const view = new MdzipWorkspaceView(container, {
  markdownExtensions: [mdzipMermaidExtension({ theme: 'auto' })]
});
```

Diagrams render with mermaid's `strict` security level, each SVG is
re-sanitized before insertion, and an invalid diagram renders as an inline
error block instead of breaking the preview. `theme` defaults to `'auto'`,
following the preview color scheme. Enabling the extension widens the preview's
sanitize policy to allow SVG and inline styles for the whole render. For a
CSP-restricted host, mermaid bundles into the consumer's webview script (no new
`img-src` needs); if you lazy-load its chunk, serve it under the existing
`script-src` nonce.

## Developer Guide

See the [Developer Guide](https://github.com/mdzip-project/mdzip-editor/blob/main/docs/developer-guide.md)
for granular host controls, height requirements, lifecycle events, persistence,
theming, and Raw, Angular, React, and Vue examples.

See the [Theming Guide](https://github.com/mdzip-project/mdzip-editor/blob/main/docs/theming.md)
for custom theme examples and the complete CSS variable reference.

## Archive Helpers

```ts
import {
  openMdzArchive,
  readCanonicalMarkdown,
  createArchiveInventory,
  diffArchiveInventories
} from '@mdzip/editor';
```

These helpers are built on `@mdzip/core-js` and are suitable for framework wrappers, desktop hosts, browser apps, and extension integrations.

## Archive Diff View

The optional diff entry point keeps merge dependencies out of normal editor
and preview bundles:

```ts
import { MdzipDiffView } from '@mdzip/editor/diff-view';

const diff = new MdzipDiffView(container, {
  before: { bytes: baseBytes, label: 'Git base' },
  after: { bytes: workingBytes, label: 'Working tree' },
  initialPath: 'index.md',
  toolbarActions: [{
    id: 'refresh',
    label: 'Refresh comparison',
    icon: 'refresh',
    run: refreshComparison
  }]
});
```

Construction opens the initial comparison. Use `await diff.open(options)` to
replace both sides, `openPath(path)` to select an entry, and
`setShowUnchanged(false)` to focus the tree on changes. Toolbar actions may be
updated with `setToolbarActions()` without reopening either archive.

The library-owned toolbar provides a navigation toggle, Previous/Next change
buttons, and a Show-unchanged toggle. Drive change traversal in code with
`openPreviousChange()` / `openNextChange()` (they walk non-unchanged entries
and resolve `false` at the ends). Opt individual built-in controls out with
the `controls` option (`navigation`, `changeTraversal`, `showUnchanged`; all
default on). The navigation pane animates open/closed like the workspace nav
pane.

The read-only view shows the union of archive paths in a directory tree,
added/removed/changed status, side-by-side text diffs, explicit missing-side
states, image previews with metadata, and binary metadata. Entry content is
loaded only when selected. Call `destroy()` to release editors, listeners, and
image object URLs.

## Preview Lifecycle Signals

To reveal or animate read-only preview content without scraping internal DOM,
use the preview lifecycle signals on `MdzipWorkspaceView`:

```ts
const view = new MdzipWorkspaceView(container, {
  controls: 'preview',
  onPreviewRendered: (snapshot) => { /* preview HTML is mounted */ },
  onAssetsHydrated: (snapshot) => { /* its images have finished loading */ }
});

// Or await the fullest "ready" point (mounted + images hydrated):
await view.whenRendered();
revealContent();
```

`whenRendered()` resolves immediately when the latest preview is already
hydrated, and resolves (rather than hanging) if the view is destroyed.

The preview hydrates images progressively: the text mounts right away with each
archive image in a collapsed slot, so the reader gets a compact, readable text
block first. As each image resolves, its slot eases open to the height reserved
from dimensions sniffed out of the image header — a single slide to the exact
box, so the pixels arrive with no further reflow (and it snaps open instead
under `prefers-reduced-motion`). `onPreviewRendered` fires when the text is
mounted; `onAssetsHydrated` fires once every referenced image has resolved and
its final `src` is assigned.

In live-editing hosts where the preview re-renders frequently, pass
`imageHydrationAnimation: 'initial'` to keep the first-load reveal but snap
images open on same-document edits. Use `'off'` to disable the loading pulse
and slide-open animation entirely.

## Content Security Policy (restricted hosts)

Archive images resolve to `URL.createObjectURL()` **`blob:` object URLs** (the
view falls back to `data:` URLs only where `createObjectURL` is unavailable,
such as Node). When embedding the editor in a host with a restrictive
Content-Security-Policy — a VS Code webview, a sandboxed iframe, etc. — the
policy's `img-src` **must include `blob:`**, or every archive image renders as a
broken placeholder:

```
img-src 'self' <cspSource> blob: data:;
```

Including `data:` as well lets the view's built-in recovery path work: if a
`blob:` URL fails to load (for example because `img-src` omits `blob:`), the
view retries that image once with a `data:` URL and, if it still fails, reports
the error through the `onFailed` option instead of failing silently. Listen on
`onFailed` to surface image-load problems during development:

```ts
const view = new MdzipWorkspaceView(container, {
  onFailed: (error) => console.warn('[mdzip]', error)
});
```

Call `destroy()` to revoke the object URLs the view created.
