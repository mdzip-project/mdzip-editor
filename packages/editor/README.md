# @mdzip/editor

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

The filename normally selects the source format. Pass `sourceFormat:
'markdown'` or `sourceFormat: 'mdz'` to override detection.

Normalized `mdzip-core-js` workspaces can be opened without an initial archive
rebuild:

```ts
await view.openWorkspace(workspace, {
  mode: 'editable',
  fileName: 'document.mdz'
});
```

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

`MdzipRenderingService` uses `defaultSafeMarkdownRenderer` when no renderer is
injected. The default renderer sanitizes generated HTML and unsafe URL schemes.

## Developer Guide

See the [Developer Guide](https://github.com/mdzip-project/@mdzip/editor/blob/main/docs/developer-guide.md)
for granular host controls, height requirements, lifecycle events, persistence,
theming, and Raw, Angular, React, and Vue examples.

See the [Theming Guide](https://github.com/mdzip-project/@mdzip/editor/blob/main/docs/theming.md)
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

These helpers are built on `mdzip-core-js` and are suitable for framework wrappers, desktop hosts, browser apps, and extension integrations.
