[![MDZip logo][mdzip-logo]][mdzip-url]

[mdzip-logo]: https://raw.githubusercontent.com/mdzip-project/mdzip-editor/main/resources/mdzip-mark.svg
[mdzip-url]: https://mdzip.org

# @mdzip/editor-vue

Vue 3 component wrapper for the MDZip workspace editor.

`@mdzip/editor-vue` provides a `MdzipWorkspace` component that embeds the full MDZip workspace UI — document preview, editor, package navigator, and asset manager — as a native Vue 3 component.

## Install

```sh
npm install @mdzip/editor-vue
```

Peer dependency: `vue` >=3.

## Basic Usage

```vue
<script setup lang="ts">
import { MdzipWorkspace } from '@mdzip/editor-vue';

const props = defineProps<{ bytes: Uint8Array }>();
</script>

<template>
  <div style="height: 600px">
    <MdzipWorkspace
      :bytes="props.bytes"
      file-name="document.mdz"
      mode="read-only"
      controls="viewer"
      @failed="console.error"
    />
  </div>
</template>
```

The parent element must have an explicit height. The component expands to fill it.

## Editor Mode

```vue
<MdzipWorkspace
  :bytes="bytes"
  file-name="document.mdz"
  mode="editable"
  controls="standalone-editor"
  @saved="onSaved"
  @changed="onChanged"
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `bytes` | `Uint8Array \| null` | `null` | Raw archive bytes to open |
| `workspace` | `MdzWorkspace \| null` | `null` | Pre-built workspace object |
| `fileName` | `string` | `'document.mdz'` | Filename used for format detection and Save dialogs |
| `mode` | `MdzipWorkspaceMode` | `'read-only'` | `'read-only'` or `'editable'` |
| `sourceFormat` | `MdzipSourceFormat` | — | Override format detection: `'mdz'` or `'markdown'` |
| `controls` | `MdzipControlPreset \| MdzipControlPolicy` | `'viewer'` | `'preview'`, `'viewer'`, `'standalone-editor'`, `'hosted-editor'`, or a policy object |
| `initialLayout` | `MdzipWorkspaceLayout` | — | Starting layout: `'preview'`, `'editor'`, `'split'` |
| `initialColorScheme` | `MdzipColorScheme` | — | `'light'` or `'dark'` |
| `navigationMode` | `MdzipNavigationMode` | `'editor'` | Package navigation mode |
| `navigationButtonActive` | `boolean` | `true` | Whether the navigation button is shown |
| `markdownRenderer` | `MdzipMarkdownRenderer \| null` | `null` | Custom markdown renderer (keep the reference stable) |
| `markdownExtensions` | `readonly MdzipMarkdownRenderExtension[]` | `[]` | Markdown pipeline extensions, diffed by `name` — inline arrays are safe |
| `entryRenderers` | `readonly MdzipEntryRenderer[]` | `[]` | Entry renderers claiming the content area for matching entries, diffed by `id` — inline arrays are safe |

Rendering prop changes apply in place — they never recreate the workspace
view. See the `@mdzip/editor` Rendering Extensibility docs for the contracts
and lifecycle rules.

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `changed` | `MdzipWorkspaceChange` | Emitted when archive bytes change |
| `saved` | `MdzipWorkspaceSave` | Emitted on Save |
| `snapshotChanged` | `MdzipWorkspaceSnapshot` | Emitted on any state change |
| `selectionChanged` | `MdzipWorkspaceSnapshot` | Emitted when the editor selection changes |
| `dirtyChanged` | `MdzipWorkspaceSnapshot` | Emitted when the dirty flag changes |
| `validationChanged` | `MdzipWorkspaceSnapshot` | Emitted when validation state changes |
| `colorSchemeChanged` | `MdzipColorScheme` | Emitted when the color scheme changes |
| `failed` | `unknown` | Emitted on unrecoverable errors |

## Conversion hook

`onConversionRequested` is a **function prop** (not an emit, because it must return a value):
pass `(action: MdzipConversionAction) => boolean | Promise<boolean>`. It fires when the user
triggers the markdown→MDZ conversion flow (nav button, Insert Image, or image paste on a
plain `.md`). Return/resolve `true` to take over and suppress the built-in conversion dialog.

## File management (nav pane)

With `controls="standalone-editor"` or `"hosted-editor"` (or `fileActions: true` in a custom
policy), the navigation pane offers a right-click context menu: new `.md` file, new folder,
rename/move, duplicate, replace, download, copy markdown link, set entry point, set cover
image, and delete. Files can also be dragged between folders, and OS files can be dropped
onto the pane. Copy and Download remain available in read-only mode. The same operations are
exposed on the handle: `removeFile`, `renameFile`, `setEntryPoint`, and `setCoverImage`.

## Imperative API

Use a template ref to access the exposed handle:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { MdzipWorkspace, type MdzipWorkspaceExposed } from '@mdzip/editor-vue';

const workspace = ref<MdzipWorkspaceExposed>();

async function save() {
  const snapshot = await workspace.value?.flush();
  if (snapshot) {
    await persist(snapshot.bytes);
    workspace.value?.markPersisted();
  }
}
</script>

<template>
  <MdzipWorkspace ref="workspace" ... />
</template>
```

See the [`@mdzip/editor`](https://www.npmjs.com/package/@mdzip/editor) package for the full API reference, theming guide, and framework-agnostic usage.
