[![MDZip logo][mdzip-logo]][mdzip-url]

[mdzip-logo]: https://raw.githubusercontent.com/mdzip-project/mdzip-editor/main/resources/mdzip-mark.svg
[mdzip-url]: https://mdzip.org

# @mdzip/editor-react

React component wrapper for the MDZip workspace editor.

`@mdzip/editor-react` provides a `MdzipWorkspace` component that embeds the full MDZip workspace UI — document preview, editor, package navigator, and asset manager — as a native React component.

## Install

```sh
npm install @mdzip/editor-react
```

Peer dependencies: `react` and `react-dom` >=18.

## Basic Usage

```tsx
import { MdzipWorkspace } from '@mdzip/editor-react';

export function Viewer({ bytes }: { bytes: Uint8Array }) {
  return (
    <div style={{ height: 600 }}>
      <MdzipWorkspace
        bytes={bytes}
        fileName="document.mdz"
        mode="read-only"
        controls="viewer"
        onFailed={console.error}
      />
    </div>
  );
}
```

The parent element must have an explicit height. The component expands to fill it.

## Archive Diff

```tsx
import { MdzipDiff } from '@mdzip/editor-react/diff-view';

<div style={{ height: 600 }}>
  <MdzipDiff
    before={{ bytes: baseBytes, label: 'Git base' }}
    after={{ bytes: workingBytes, label: 'Working tree' }}
    initialPath="index.md"
  />
</div>
```

`MdzipDiff` is read-only and updates the existing comparison view when its
props change. A ref exposes `openPath`, `setShowUnchanged`, and
`setNavigationVisible`.

## Editor Mode

```tsx
<MdzipWorkspace
  bytes={bytes}
  fileName="document.mdz"
  mode="editable"
  controls="standalone-editor"
  onSaved={({ bytes }) => persist(bytes)}
  onChanged={({ bytes }) => setDirty(true)}
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `bytes` | `Uint8Array \| null` | — | Raw archive bytes to open |
| `workspace` | `MdzWorkspace \| null` | — | Pre-built workspace object |
| `fileName` | `string` | `'document.mdz'` | Filename used for format detection and Save dialogs |
| `mode` | `MdzipWorkspaceMode` | `'read-only'` | `'read-only'` or `'editable'` |
| `sourceFormat` | `MdzipSourceFormat` | — | Override format detection: `'mdz'` or `'markdown'` |
| `controls` | `MdzipControlPreset \| MdzipControlPolicy` | `'viewer'` | `'preview'`, `'viewer'`, `'standalone-editor'`, `'hosted-editor'`, or a policy object |
| `initialLayout` | `MdzipWorkspaceLayout` | — | Starting layout: `'preview'`, `'editor'`, `'split'` |
| `initialColorScheme` | `MdzipColorScheme` | — | `'light'` or `'dark'` |
| `navigationMode` | `MdzipNavigationMode` | — | Package navigation mode |
| `navigationButtonActive` | `boolean` | — | Whether the navigation button is shown |
| `markdownRenderer` | `MdzipMarkdownRenderer` | — | Custom markdown renderer (keep the reference stable, e.g. `useMemo`) |
| `markdownExtensions` | `readonly MdzipMarkdownRenderExtension[]` | `[]` | Markdown pipeline extensions, diffed by `name` — inline arrays are safe |
| `entryRenderers` | `readonly MdzipEntryRenderer[]` | `[]` | Entry renderers claiming the content area for matching entries, diffed by `id` — inline arrays are safe |
| `renderEntry` | `(context) => ReactNode \| undefined` | — | Catch-all entry renderer: return a node to claim the selected entry, `undefined` to delegate |
| `renderEntryPriority` | `number` | `0` | Matching priority of `renderEntry` relative to `entryRenderers` |

Rendering prop changes apply in place — they never recreate the workspace
view. See the `@mdzip/editor` Rendering Extensibility docs for the contracts
and lifecycle rules.

### Native entry rendering

```tsx
<MdzipWorkspace
  bytes={bytes}
  renderEntry={(context) =>
    context.path.toLowerCase() === 'manifest.json'
      ? <ManifestEditor
          manifest={context.manifest}
          editable={context.mode === 'editable'}
          onManifestChange={context.updateManifest}
        />
      : undefined}
/>
```

The wrapper owns the React root: it mounts when the entry is claimed,
re-renders on context updates and on every parent commit (entry content
stays live with parent state — inline closures are safe and never
re-mount), and unmounts on selection change.

## Callbacks

| Prop | Signature | Description |
|------|-----------|-------------|
| `onChanged` | `(event: MdzipWorkspaceChange) => void` | Called when archive bytes change |
| `onSaved` | `(event: MdzipWorkspaceSave) => void` | Called on Save |
| `onSnapshotChanged` | `(snapshot: MdzipWorkspaceSnapshot) => void` | Called on any state change |
| `onSelectionChanged` | `(snapshot: MdzipWorkspaceSnapshot) => void` | Called when the editor selection changes |
| `onDirtyChanged` | `(snapshot: MdzipWorkspaceSnapshot) => void` | Called when the dirty flag changes |
| `onValidationChanged` | `(snapshot: MdzipWorkspaceSnapshot) => void` | Called when validation state changes |
| `onColorSchemeChanged` | `(colorScheme: MdzipColorScheme) => void` | Called when the color scheme changes |
| `onFailed` | `(error: unknown) => void` | Called on unrecoverable errors |
| `onConversionRequested` | `(action: MdzipConversionAction) => boolean \| Promise<boolean>` | Host hook for the markdown→MDZ conversion flow (nav button, Insert Image, or image paste on a plain `.md`). Return/resolve `true` to take over and suppress the built-in conversion dialog |

## File management (nav pane)

With `controls="standalone-editor"` or `"hosted-editor"` (or `fileActions: true` in a custom
policy), the navigation pane offers a right-click context menu: new `.md` file, new folder,
rename/move, duplicate, replace, download, copy markdown link, set entry point, set cover
image, and delete. Files can also be dragged between folders, and OS files can be dropped
onto the pane to add them as assets. Copy and Download remain available in read-only mode.
The same operations are exposed imperatively: `removeFile`, `renameFile`, `setEntryPoint`,
and `setCoverImage` on the handle.

## Imperative API

Use a `ref` to access the imperative handle:

```tsx
import { useRef } from 'react';
import { MdzipWorkspace, type MdzipWorkspaceHandle } from '@mdzip/editor-react';

const ref = useRef<MdzipWorkspaceHandle>(null);

// Flush pending edits and persist
const snapshot = await ref.current?.flush();
if (snapshot) {
  await save(snapshot.bytes);
  ref.current?.markPersisted();
}

// Execute editor commands
await ref.current?.executeCommand('bold');

return <MdzipWorkspace ref={ref} ... />;
```

See the [`@mdzip/editor`](https://www.npmjs.com/package/@mdzip/editor) package for the full API reference, theming guide, and framework-agnostic usage.
