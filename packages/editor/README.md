# mdzip-editor

Framework-independent MDZip workspace engine and browser view.

`mdzip-editor` provides reusable helpers for opening `.mdz` archives, rendering Markdown previews, editing archive contents, comparing archive inventories, and embedding a configurable MDZip workspace UI.

## Install

```sh
npm install mdzip-editor
```

## Basic Usage

```ts
import { MdzipWorkspaceView } from 'mdzip-editor';

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

## Editor Mode

```ts
const view = new MdzipWorkspaceView(container, {
  controls: 'standalone-editor',
  onSaved(bytes) {
    // Persist or download the updated archive bytes.
  }
});

await view.open(bytes, {
  mode: 'editable',
  fileName: 'document.mdz'
});
```

## Control Presets

- `preview`: clean document preview with no toolbar or package navigation.
- `viewer`: read-only viewer controls, including navigation, layout switching, and zoom.
- `standalone-editor`: full editor controls, including save.
- `hosted-editor`: editor controls without an embedded save button, for hosts such as VS Code that own persistence.

## Archive Helpers

```ts
import {
  openMdzArchive,
  readCanonicalMarkdown,
  createArchiveInventory,
  diffArchiveInventories
} from 'mdzip-editor';
```

These helpers are built on `mdzip-core-js` and are suitable for framework wrappers, desktop hosts, browser apps, and extension integrations.

