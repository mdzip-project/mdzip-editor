[![MDZip logo][mdzip-logo]][mdzip-url]

[mdzip-logo]: https://raw.githubusercontent.com/mdzip-project/mdzip-editor/main/resources/mdzip-mark.svg
[mdzip-url]: https://mdzip.org

# @mdzip/editor-ng

Angular component wrapper for the MDZip workspace editor.

`@mdzip/editor-ng` provides a standalone `MdzipWorkspaceComponent` that embeds the full MDZip workspace UI — document preview, editor, package navigator, and asset manager — as a native Angular component.

## Install

```sh
npm install @mdzip/editor @mdzip/editor-ng
```

Peer dependencies: `@angular/common` and `@angular/core` >=20.

## Basic Usage

```ts
import { MdzipWorkspaceComponent } from '@mdzip/editor-ng';

@Component({
  imports: [MdzipWorkspaceComponent],
  template: `
    <mdzip-workspace
      [bytes]="fileBytes"
      fileName="document.mdz"
      mode="read-only"
      controls="viewer"
      (failed)="onError($event)"
    />
  `,
  styles: [':host { display: block; height: 600px; }']
})
export class AppComponent {
  fileBytes: Uint8Array | null = null;
}
```

The host element must have an explicit height. The component expands to fill it.

## Archive Diff

```ts
import { MdzipDiffComponent } from '@mdzip/editor-ng';

@Component({
  imports: [MdzipDiffComponent],
  template: `
    <mdzip-diff
      [before]="{ bytes: baseBytes, label: 'Git base' }"
      [after]="{ bytes: workingBytes, label: 'Working tree' }"
      [toolbarActions]="diffActions"
      initialPath="index.md"
    />
  `,
  styles: [':host { display:block; height:600px; }']
})
export class DiffComponent {}
```

`MdzipDiffComponent` is read-only. It emits `selectionChanged` and `failed`,
and exposes `openPath`, `setShowUnchanged`, and `setNavigationVisible`.
It also exposes `setToolbarActions`.

## Editor Mode

```ts
<mdzip-workspace
  [bytes]="fileBytes"
  fileName="document.mdz"
  mode="editable"
  controls="standalone-editor"
  (saved)="onSaved($event)"
  (changed)="onChanged($event)"
/>
```

## Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
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
| `markdownRenderer` | `MdzipMarkdownRenderer` | — | Custom markdown renderer (keep the reference stable) |
| `markdownExtensions` | `readonly MdzipMarkdownRenderExtension[]` | `[]` | Markdown pipeline extensions, diffed by `name` — new array identities with the same names are safe |
| `entryRenderers` | `readonly MdzipEntryRenderer[]` | `[]` | Entry renderers claiming the content area for matching entries, diffed by `id` — new array identities with the same ids are safe |

Rendering input changes apply in place — they never recreate the workspace
view. See the `@mdzip/editor` Rendering Extensibility docs for the contracts
and lifecycle rules.

### Native entry rendering (template directives)

```html
<mdzip-workspace [bytes]="bytes" mode="editable">
  <ng-template mdzipEntryRenderer="manifest.json" let-context>
    <app-internals
      [manifest]="context.manifest"
      [editable]="context.mode === 'editable'"
      (manifestChange)="context.updateManifest($event)"
    />
  </ng-template>

  <ng-template [mdzipEntryRendererMatch]="isDrawioEntry" let-context>
    <app-drawio-viewer [entry]="context" />
  </ng-template>
</mdzip-workspace>
```

Import `MdzipEntryRendererDirective` alongside the component.
`mdzipEntryRenderer` matches exact archive paths (string or array,
case-insensitive); `[mdzipEntryRendererMatch]` takes a predicate. Optional
`mdzipEntryRendererId` / `mdzipEntryRendererPriority` inputs control diffing
and ordering. Embedded views are created in the component's view container —
change detection and DI work normally — and are destroyed on selection
change.

## Outputs

| Output | Payload | Description |
|--------|---------|-------------|
| `changed` | `MdzipWorkspaceChange` | Emitted when archive bytes change |
| `saved` | `MdzipWorkspaceSave` | Emitted on Save |
| `snapshotChanged` | `MdzipWorkspaceSnapshot` | Emitted on any state change |
| `selectionChanged` | `MdzipWorkspaceSnapshot` | Emitted when the editor selection changes |
| `dirtyChanged` | `MdzipWorkspaceSnapshot` | Emitted when the dirty flag changes |
| `validationChanged` | `MdzipWorkspaceSnapshot` | Emitted when validation state changes |
| `colorSchemeChanged` | `MdzipColorScheme` | Emitted when the color scheme changes |
| `failed` | `unknown` | Emitted on unrecoverable errors |

## Conversion hook

`onConversionRequested` is an **input function** (not an output, because it must return a
value): bind `[onConversionRequested]="handler"` where `handler` is
`(action: MdzipConversionAction) => boolean | Promise<boolean>`. It fires when the user
triggers the markdown→MDZ conversion flow (nav button, Insert Image, or image paste on a
plain `.md`). Return/resolve `true` to take over and suppress the built-in conversion dialog.

## File management (nav pane)

With `controls="standalone-editor"` or `"hosted-editor"` (or `fileActions: true` in a custom
policy), the navigation pane offers a right-click context menu: new `.md` file, new folder,
rename/move, duplicate, replace, download, copy markdown link, set entry point, set cover
image, and delete. Files can also be dragged between folders, and OS files can be dropped
onto the pane. Copy and Download remain available in read-only mode. The same operations are
exposed as component methods: `removeFile`, `renameFile`, `setEntryPoint`, and `setCoverImage`.

## Imperative API

All imperative methods are public instance methods on `MdzipWorkspaceComponent`,
so any reference to the component instance works. No view query is required: a
template reference variable can hand the instance directly to an event handler.

```ts
@Component({
  imports: [MdzipWorkspaceComponent],
  template: `
    <mdzip-workspace #workspace [bytes]="bytes" mode="editable" controls="hosted-editor" />
    <button (click)="save(workspace)">Save</button>
  `,
})
export class AppComponent {
  async save(workspace: MdzipWorkspaceComponent): Promise<void> {
    // Flush pending edits and persist
    const snapshot = await workspace.flush();
    if (snapshot) {
      await persist(snapshot.bytes);
      workspace.markPersisted();
    }

    // Execute editor commands
    await workspace.executeCommand('bold');
  }
}
```

To call methods outside an event handler, use a view query — the signal-based
`viewChild` or the classic `@ViewChild` decorator:

```ts
private readonly workspace = viewChild.required(MdzipWorkspaceComponent);

async save(): Promise<void> {
  const snapshot = await this.workspace().flush();
  if (snapshot) {
    await persist(snapshot.bytes);
    this.workspace().markPersisted();
  }
}
```

Methods called before the view initializes are safe: they no-op and resolve to
`false`/`null`/empty rather than throwing.

See the [`@mdzip/editor`](https://www.npmjs.com/package/@mdzip/editor) package for the full API reference, theming guide, and framework-agnostic usage.
