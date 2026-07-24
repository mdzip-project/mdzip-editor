# MDZip Editor Developer Guide

`@mdzip/editor` can run as a complete standalone editor or as an embedded
workspace inside a larger web or desktop application. The same workspace view
is available through the raw browser API and the Angular, React, and Vue
wrappers.

## Packages

```sh
npm install @mdzip/editor
```

Install the wrapper for your framework when needed:

```sh
npm install @mdzip/editor-ng
npm install @mdzip/editor-react
npm install @mdzip/editor-vue
```

Your host element must have a definite height. The editor fills that height:

```css
.editor-host {
  height: 100vh;
  min-height: 0;
}
```

## Mode And Controls

Mode and controls have different responsibilities:

- `mode: 'read-only' | 'editable'` determines which operations are permitted.
- `controls` determines which built-in UI the host exposes.
- Hiding a control does not weaken mode enforcement. A read-only workspace
  remains read-only.

### Presets

- `preview`: document preview without toolbar or navigation.
- `viewer`: read-only-oriented navigation, title, layout, zoom, and theme UI.
- `standalone-editor`: complete editing UI, including Save.
- `hosted-editor`: complete editing UI without Save, for hosts that own
  persistence.
- `custom`: standalone defaults with explicit host overrides.

### Granular Controls

Start from a preset and override only what the host owns:

```ts
const controls = {
  preset: 'hosted-editor',
  navigation: false,
  title: {
    visible: true,
    editable: false
  },
  lineNumbers: false,
  layout: {
    source: true,
    split: false,
    preview: true
  },
  formatting: {
    enabled: false,
    bold: true,
    italic: true,
    headings: [2, 3, 4],
    bulletList: true,
    orderedList: true,
    inlineCode: true,
    blockquote: true,
    lineBreak: true,
    link: true
  },
  save: false,
  zoom: true,
  colorScheme: true,
  orphanActions: false,
  fileActions: false,
  codeBlockTools: true,
  contextMenu: {
    editor: true,
    preview: false
  }
} as const;
```

`fileActions` (default `true` in the editor presets, `false` in `preview`/
`viewer`) gates the navigation pane's file-management surface: the right-click
context menu (new `.md` file, new folder, rename/move, duplicate, replace,
download, copy markdown link/image embed, set entry point, set/remove cover
image, delete) and drag-and-drop (move files between folders, drop OS files
onto the pane). Copy and Download are non-mutating and stay available whenever
the menu is shown, including read-only mode. Dragging a tree file onto the
editor surface inserts a markdown link/embed at the pointer and only requires
an editable workspace, not `fileActions`.

`codeBlockTools` (default `true` in every preset, including `preview`) adds
chrome to rendered code blocks in the preview: a language-name header and a
copy-to-clipboard button on every block, plus a collapse/expand toggle on
blocks long enough for collapsing to have a visible effect (more than 15
lines; blocks past 25 lines start collapsed). This is built into the core
rendering path, not a `markdownExtensions` entry — every consumer gets it
automatically with no extra wiring. Distinct from `formatting.codeBlock`,
which gates the *editor* toolbar's insert-code-block control.

`contextMenu` (both `editor` and `preview` default `true` in every preset)
gates the right-click menus on the source editor (Cut/Copy/Paste, formatting,
Select All) and the rendered preview (Copy when there's a selection, Select
All). Set either to `false` to fall back to the browser's native context menu
for that pane instead — useful for hosts that want their own right-click
behavior (e.g. a native OS menu in an Electron/Tauri shell). This only gates
the menus themselves: Ctrl/Cmd+A keyboard scoping (source editor via
CodeMirror's own binding, preview via a scoped selection) keeps working
either way.

The same operations are exposed programmatically on the view and the framework
wrappers: `removeFile()`, `renameFile()` (also moves; rewrites markdown
references), `setEntryPoint()`, and `setCoverImage()`.

For plain-markdown sources, the `onConversionRequested(action)` option lets a
host take over the markdown→MDZ conversion flow (nav button, Insert Image, or
image paste/drop): return or resolve `true` to suppress the built-in dialog.

Image insertion can also be customized directly. `imageInsertMode` controls the
built-in markup flow (`'markdown'`, `'html'`, or `'ask'`), while
`imageInsertHandler(request)` lets a host return Markdown, sized/aligned HTML,
`null` to cancel, or `undefined` to fall back to the built-in mode. The demo
page includes an Image insert selector so the default, ask dialog, and host
hook paths can be tested without writing a separate host app.
The built-in dialog asks for width, height, or percent scaling and preserves
aspect ratio instead of asking for width and height independently.
The built-in HTML path uses portable `align` attributes for positioning because
the default preview sanitizer strips inline `style` attributes.

Hosts that let a user pick a folder (Electron dialog, VS Code workspace API,
...) can hand the collected files to `view.packFilesAsWorkspace(files, options)`
instead of packing the `.mdz` themselves. With zero or one Markdown file it
packs Document mode immediately, no prompt; with more than one, it needs a
Document-vs-Project mode and entry-point decision, which `onPackRequested(request, context)`
lets a host take over the same way `onConversionRequested` does (return/resolve
`true` to suppress the built-in decision dialog, after calling
`context.applyDecision({ mode, entryPoint })` to perform the actual pack).
Document mode opens the result in the view; Project mode returns the archive
bytes without opening them, since only the host knows where a project archive
should be saved.

Broad boolean forms remain supported:

```ts
const controls = {
  preset: 'standalone-editor',
  title: false,
  layout: false,
  formatting: false
} as const;
```

Within `formatting` or `layout`, use `enabled: false` to build an allowlist.
Without `enabled`, omitted nested values inherit from the selected preset.

The title is displayed in a compact document strip above the command toolbar.
Its information button shows the source filename, format, displayed title,
first Markdown heading, package timestamps, and entry point. The existing
`title.visible` and `title.editable` settings control this strip and its
click-to-edit title behavior.

Controls can also be changed after construction with `view.setControls()`.
The view updates its toolbar and layout policy in place; `lineNumbers` changes
reconfigure the existing CodeMirror editor, preserving the current document and
selection. Angular, React, and Vue wrapper `controls` changes use the same
in-place path.

Hosts that need a denser embedded surface can use semantic density options
instead of private class overrides:

```ts
const view = new MdzipWorkspaceView(container, {
  controls,
  toolbarDensity: 'compact', // 'comfortable' | 'compact' | 'dense'
  contentDensity: 'compact'  // 'comfortable' | 'compact'
});

view.setDensityOptions({ toolbarDensity: 'dense', contentDensity: 'compact' });
```

The same settings are available as Angular inputs and React/Vue props. For
exact sizing, set stable CSS variables on an ancestor of the workspace:

```css
.hosted-editor {
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

`previewMaxWidth` is the typed, developer-facing counterpart to that last CSS
variable — not toolbar UI. A number is an exact pixel value;
`'narrow'`/`'default'`/`'wide'` are aliases for 650/900/1200px:

```ts
const view = new MdzipWorkspaceView(container, {
  controls,
  previewMaxWidth: 'wide' // or an exact pixel number
});

view.setPreviewMaxWidth(720);
```

Leaving it unset keeps the built-in default, which scales with zoom; setting
it (via this option or the CSS variable directly) does not scale with zoom.

## Raw Browser API

```ts
import { MdzipWorkspaceView } from '@mdzip/editor';

const container = document.querySelector<HTMLElement>('#editor')!;
const view = new MdzipWorkspaceView(container, {
  controls,
  initialLayout: 'source',
  initialColorScheme: 'dark',
  navigationMode: 'host',
  onChanged(bytes, snapshot) {
    console.log(snapshot.currentPath, bytes.byteLength);
  },
  async onSaved(bytes) {
    await persist(bytes);
    view.markPersisted();
  },
  onColorSchemeChanged(colorScheme) {
    console.log(colorScheme);
  },
  onFailed(error) {
    console.error(error);
  }
});

await view.open(archiveBytes, {
  mode: 'editable',
  fileName: 'document.mdz'
});
```

With `standalone-editor`, omitting `onSaved` makes the built-in Save button
download the current `.mdz` or Markdown file. Supplying `onSaved` transfers
persistence ownership to the host. The editor keeps dirty state set until the
host calls `markPersisted()` after a successful write.

The same API opens regular Markdown files. The source format is inferred from
the filename:

```ts
await view.open(markdownBytes, {
  mode: 'editable',
  fileName: 'notes.md'
});
```

Use `sourceFormat: 'markdown'` or `sourceFormat: 'mdz'` when the filename is
missing or ambiguous. Markdown sources are saved, serialized, and emitted by
`onChanged` as UTF-8 Markdown bytes. MDZ sources remain archive bytes.

Standalone Markdown has no manifest or packaged assets. Its navigation pane
starts closed and the internal workspace used to edit it is not exposed as
document contents. Opening package navigation or inserting an image prompts the
user to convert the document to MDZ. After conversion, save callbacks and
serialization return MDZ archive bytes, so hosts should change the output
filename extension to `.mdz`. The workspace snapshot does this automatically:
for example, `notes.md` becomes `notes.mdz` immediately after conversion.

Hosts can also initiate conversion directly:

```ts
const converted = await view.convertToMdz();
```

The Angular component, React imperative handle, and Vue exposed instance provide
the same `convertToMdz()` method.

Useful host methods:

```ts
const snapshot = await view.getCurrentSnapshot();
const blob = await view.serialize();
const flushed = await view.flush();
view.markPersisted();
await view.executeCommand('bold');
view.focus();
view.destroy();
```

`flush()` commits pending editor text and returns current bytes and validation,
but it does not clear dirty state. Call `markPersisted()` only after the host
successfully writes those bytes. A failed native save therefore leaves the
editor dirty.

The raw view also accepts a normalized core workspace directly:

```ts
await view.openWorkspace(workspace, {
  mode: 'editable',
  fileName: 'document.mdz'
});
```

This path does not rebuild an MDZ archive during open. Serialization happens
when the host requests bytes.

Use `navigationMode: 'host'` when the application supplies its own document and
asset navigation. Use `navigationMode: 'none'` when neither the editor nor host
should display package navigation.

## Preview Lifecycle

Use `onPreviewRendered`, `onAssetsHydrated`, or `whenRendered()` when a host
needs to reveal a preview only after the current render is ready:

```ts
const view = new MdzipWorkspaceView(container, {
  controls: 'preview',
  onPreviewRendered: (snapshot) => { /* preview HTML is mounted */ },
  onAssetsHydrated: (snapshot) => { /* images are resolved */ }
});

await view.whenRendered();
```

Archive images hydrate progressively: preview text mounts first, image slots
reserve space from sniffed dimensions, and resolved images are swapped in as
their bytes arrive. In live-editing hosts where repeating that reveal on every
keystroke is noisy, pass `imageHydrationAnimation: 'initial'` or update it
later with `view.setImageHydrationAnimation('initial')`. The first render for a
document path still animates, while same-document text edits snap image slots
open immediately. Use `'off'` to disable the loading pulse and slide animation
entirely. Angular, React, and Vue expose the same setting as
`imageHydrationAnimation`.

## Custom Host Toolbars

Control visibility and command availability are intentionally separate. A host
can hide the built-in formatting toolbar and invoke the same editor operations
from its own UI:

```ts
const view = new MdzipWorkspaceView(container, {
  controls: {
    preset: 'hosted-editor',
    formatting: false
  }
});

boldButton.addEventListener('click', () => {
  void view.executeCommand('bold');
});

headingButton.addEventListener('click', () => {
  void view.executeCommand('heading-2');
});

imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  if (file) {
    void view.executeCommand('insert-image', file);
  }
});
```

`executeCommand()` returns `true` when the command can run. It returns `false`
when no document is open, the workspace is read-only, or the selected entry is
not editable Markdown. Use `canExecuteCommand()` to set host button states:

```ts
boldButton.disabled = !view.canExecuteCommand('bold');
```

Supported commands are `bold`, `italic`, `strikethrough`, `paragraph`,
`heading-1` through `heading-6`, `bullet-list`, `ordered-list`, `inline-code`,
`code-block`, `blockquote`, `insert-line-break`, `link`, and `insert-image`.
Calling `insert-image` without a `File` opens the built-in image file picker.

## Angular

```ts
import { Component } from '@angular/core';
import { MdzipWorkspaceComponent } from '@mdzip/editor-ng';
import type {
  MdzipControlPolicy,
  MdzipWorkspaceChange
} from '@mdzip/editor';

const editorControls: MdzipControlPolicy = {
  preset: 'hosted-editor',
  navigation: false,
  formatting: { image: false }
};

@Component({
  standalone: true,
  imports: [MdzipWorkspaceComponent],
  template: `
    <button (click)="bold(workspace)">Bold</button>
    <mdzip-workspace
      #workspace
      class="editor-host"
      [bytes]="bytes"
      mode="editable"
      fileName="document.mdz"
      [controls]="controls"
      initialLayout="source"
      navigationMode="host"
      (changed)="onChanged($event)"
      (failed)="onFailed($event)"
    />
  `,
  styles: [`.editor-host { display: block; height: 100vh; }`]
})
export class EditorPage {
  bytes: Uint8Array | null = null;
  controls = editorControls;

  bold(workspace: MdzipWorkspaceComponent): void {
    void workspace.executeCommand('bold');
  }

  onChanged(event: MdzipWorkspaceChange): void {
    this.bytes = event.bytes;
  }

  onFailed(error: unknown): void {
    console.error(error);
  }
}
```

Angular accepts either `[bytes]` or `[workspace]`. Its public component methods
include `flush()`, `serialize()`, `getCurrentSnapshot()`, `markPersisted()`,
and the asset operations, all callable through a template reference variable as
above or through a view query (`viewChild.required(MdzipWorkspaceComponent)` or
the classic `@ViewChild` decorator) when no template event is involved. Outputs
include `changed`, `saved`, `workspaceChanged`, `documentChanged`,
`assetChanged`, `manifestChanged`, `snapshotChanged`, `selectionChanged`,
`dirtyChanged`, `validationChanged`, `colorSchemeChanged`, and `failed`.

## React

```tsx
import { useRef } from 'react';
import {
  MdzipWorkspace,
  type MdzipWorkspaceHandle
} from '@mdzip/editor-react';
import type { MdzipControlPolicy } from '@mdzip/editor';

const controls: MdzipControlPolicy = {
  preset: 'hosted-editor',
  navigation: false,
  formatting: { image: false }
};

export function EditorPage({ bytes }: { bytes: Uint8Array }) {
  const workspace = useRef<MdzipWorkspaceHandle>(null);

  return (
    <div style={{ height: '100vh' }}>
      <button onClick={() => void workspace.current?.executeCommand('bold')}>
        Bold
      </button>
      <MdzipWorkspace
        ref={workspace}
        bytes={bytes}
        mode="editable"
        fileName="document.mdz"
        controls={controls}
        initialLayout="source"
        navigationMode="host"
        onChanged={({ bytes: nextBytes }) => persist(nextBytes)}
        onFailed={console.error}
      />
    </div>
  );
}
```

Keep callback and object props stable with `useCallback` and `useMemo` in
frequently rendering parents to avoid unnecessary wrapper recreation.

## Vue

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { MdzipWorkspace } from '@mdzip/editor-vue';
import type { MdzipWorkspaceExposed } from '@mdzip/editor-vue';
import type { MdzipControlPolicy } from '@mdzip/editor';

defineProps<{ bytes: Uint8Array }>();
const workspace = ref<MdzipWorkspaceExposed | null>(null);

const controls: MdzipControlPolicy = {
  preset: 'hosted-editor',
  navigation: false,
  formatting: { image: false }
};

function onChanged(event: { bytes: Uint8Array }) {
  persist(event.bytes);
}

function onFailed(error: unknown) {
  console.error(error);
}
</script>

<template>
  <div class="editor-host">
    <button @click="workspace?.executeCommand('bold')">Bold</button>
    <MdzipWorkspace
      ref="workspace"
      :bytes="bytes"
      mode="editable"
      file-name="document.mdz"
      :controls="controls"
      initial-layout="source"
      navigation-mode="host"
      @changed="onChanged"
      @failed="onFailed"
    />
  </div>
</template>

<style scoped>
.editor-host {
  height: 100vh;
}
</style>
```

React and Vue accept either archive bytes or a normalized workspace and expose
the same persistence and asset methods through their imperative handles. Vue
emits the same structured event set exposed by the Angular and React wrappers.

## Host Persistence

Use `standalone-editor` when the built-in Save button should download the file
or call `onSaved`. A host-provided `onSaved` handler must call
`markPersisted()` after persistence succeeds.
Use `hosted-editor` when the containing application owns Save, Save As, and
keyboard shortcuts. The raw view exposes `flush()`, `serialize()`, and
`getCurrentSnapshot()` for that workflow. After a successful native write, call
`markPersisted()`.

## Safe Rendering

`MdzipRenderingService` converts Markdown into an HTML string. When no renderer
is supplied, it uses the exported `defaultSafeMarkdownRenderer`:

```ts
import { MdzipRenderingService } from '@mdzip/editor';

const rendering = new MdzipRenderingService();
const result = rendering.render({
  markdown: '# Hello\n\n```ts\nconst answer = 42;\n```'
});

previewElement.innerHTML = result.html;
```

The default renderer uses `marked`, applies `highlight.js` syntax highlighting,
and sanitizes the resulting HTML with DOMPurify. Its policy removes scripts,
inline event handlers, unsafe URL schemes, frames and embedded objects, forms,
style elements, and inline `style` attributes. Use it for ordinary Markdown
preview surfaces when the source may not be trusted.

The renderer is also exported for direct use:

```ts
import { defaultSafeMarkdownRenderer } from '@mdzip/editor';

const html = defaultSafeMarkdownRenderer.render(markdown);
```

### Custom Renderers

Supply an object implementing `MdzipMarkdownRenderer` to the service
constructor:

```ts
import {
  MdzipRenderingService,
  type MdzipMarkdownRenderer
} from '@mdzip/editor';
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

const customRenderer: MdzipMarkdownRenderer = {
  render(markdown) {
    const rendered = marked.parse(markdown, { async: false });
    const html = typeof rendered === 'string' ? rendered : '';

    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['script', 'iframe', 'object']
    });
  }
};

const rendering = new MdzipRenderingService(customRenderer);
const { html } = rendering.render({ markdown: '# Custom preview' });
```

A custom renderer replaces the default renderer completely. Renderers may
return a `Promise<string>`; the pipeline keeps a fully synchronous fast path
when they do not.

Sanitization depends on the entry point:

- The workspace view pipeline (`markdownRenderer` in
  `MdzipWorkspaceViewOptions`, or `MdzipRenderingService.renderMarkdown()`)
  sanitizes the renderer's string output with the default DOMPurify policy
  before insertion. A renderer that sanitizes internally can declare
  `sanitizesOutput: true` to skip the duplicate pass — this is the explicit
  bypass and should only be set when the renderer really does sanitize.
- The legacy `MdzipRenderingService.render()` method keeps its original
  contract: the renderer's return value is trusted as-is, so renderers used
  that way must sanitize before returning.

The renderer receives an `MdzipMarkdownRenderContext` with the current path,
source format, color scheme, mode, manifest, an optional asset resolver, and
an `AbortSignal` that fires when the render becomes stale:

```ts
import { defaultSafeMarkdownRenderer } from '@mdzip/editor';

const customRenderer: MdzipMarkdownRenderer = {
  render(markdown, context) {
    const source = context?.colorScheme === 'dark'
      ? markdown
      : markdown.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    return defaultSafeMarkdownRenderer.render(source);
  }
};
```

### Archive Asset URLs

Pass an `assetResolver` when Markdown image paths need to be converted to
browser URLs or data URIs before rendering:

```ts
const { html } = rendering.render({
  markdown: '![Logo](images/logo.png)',
  assetResolver: {
    resolveAssetUrl(path) {
      return assetUrls.get(path);
    }
  }
});
```

When the resolver returns `undefined`, the original Markdown image path is left
unchanged. Hosts should only return URL schemes permitted by their rendering
policy.

## Rendering Extensibility

`MdzipWorkspaceView` (and every framework wrapper) accepts three rendering
options. All are additive — with none supplied, behavior is identical to
previous releases, and the no-extensions render path performs no extra work.

```ts
const view = new MdzipWorkspaceView(host, {
  markdownRenderer,     // replace the markdown renderer
  markdownExtensions,   // compose over the default pipeline
  entryRenderers        // replace the content area for selected entries
});
```

The view memoizes preview rendering on `(path, content, colorScheme, images)`:
unrelated state changes (dialogs, navigation, layout toggles) never re-run the
pipeline or reset preview DOM. Each render generation carries an
`AbortSignal`; stale asynchronous results are dropped when the user switches
entries or keeps typing.

### Markdown Extensions

Extensions compose over the default pipeline instead of replacing it:

```text
markdown -> transformMarkdown* -> renderer -> transformHtml*
         -> sanitize -> DOM insertion -> mount*
```

```ts
const mermaidExtension: MdzipMarkdownRenderExtension = {
  name: 'mermaid',
  transformHtml: (html) =>
    html.replace(/<pre><code class="hljs language-mermaid">/g,
      '<div class="mermaid-placeholder"><code hidden>'),
  mount(container, context) {
    hydrateMermaid(container.querySelectorAll('.mermaid-placeholder'), context);
    return { destroy: () => disposeMermaid(container) };
  }
};
```

`transformMarkdown` and `transformHtml` output always passes through
sanitization, so extensions cannot inject unsafe markup. The sanitizer strips
data attributes and inline styles — use class or id markers to find
placeholders again in `mount()`, and carry payloads out-of-band (for example
a module-level map keyed by marker id). `mount()` runs against the live
preview DOM and is privileged host code; handles returned from it are
destroyed before the preview re-renders and when the view is destroyed.

### Entry Renderers

Entry renderers claim the full pane stack (edit and preview panes included)
for selected archive entries. The first match by descending `priority` wins;
without a match, built-in rendering is unchanged.

```ts
import { mdzipPathMatcher, type MdzipEntryRenderer } from '@mdzip/editor';

const manifestRenderer: MdzipEntryRenderer = {
  id: 'studio-manifest',
  priority: 100,
  matches: mdzipPathMatcher('manifest.json'),
  mount(container, context) {
    const editor = mountManifestEditor(container, {
      manifest: context.manifest,
      editable: context.mode === 'editable',
      onChange: (manifest) => context.updateManifest(manifest)
    });
    return {
      update: (next) => editor.setManifest(next.manifest),
      destroy: () => editor.dispose()
    };
  }
};
```

The context exposes supported operations instead of view internals:
`readBytes()` reads the selected entry's raw bytes, and `updateManifest()`
replaces the manifest wholesale (canonicalized) and routes through the
workspace `'manifest'` edit event — `onManifestChanged` host-delegated
persistence keeps working. `mdzipPathMatcher(...paths)` and
`mdzipExtensionMatcher(...exts)` build common predicates.

Lifecycle: renders are keyed by `(path, pathType, mode, sourceFormat)`. While
the key is stable the handle stays mounted, receiving `update()` when the
color scheme or manifest changes. A changed key — including rename, move, or
delete of the backing entry — destroys the handle and re-runs matching.
Asynchronous `mount()` results that arrive after the selection moved on are
destroyed immediately instead of applied.

### Framework Wrappers

All three wrappers accept `markdownRenderer`, `markdownExtensions`, and
`entryRenderers` as inputs/props with identical behavior. Renderer prop
changes apply in place via `setRenderingOptions()` — never by recreating the
workspace view. Extension and entry renderer arrays are diffed by their
stable `name`/`id` (and priority), so inline array literals with equivalent
contents are safe. Keep the `markdownRenderer` reference stable (module scope
or `useMemo`); its identity changes apply via a cheap preview re-render.

Each wrapper additionally offers an idiomatic way to mount native framework
content without bootstrapping the framework into an `HTMLElement` manually.
All three adapt onto the same `MdzipEntryRenderer` contract, so matching,
priority, fallback, lifecycle, and stale-result behavior are identical to
collection-registered renderers. At equal priority, explicit `entryRenderers`
win over the native catch-all.

#### Angular: template directives

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

`mdzipEntryRenderer` matches exact archive paths (string or array,
case-insensitive); `[mdzipEntryRendererMatch]` takes a predicate. Optional
`mdzipEntryRendererId` and `mdzipEntryRendererPriority` inputs control
diffing and ordering. The embedded view is created in the component's view
container — change detection and dependency injection work normally — its
DOM is moved into the entry pane, the template context is updated in place
on `update()`, and the view is destroyed on selection change.

#### React: `renderEntry`

```tsx
<MdzipWorkspace
  bytes={bytes}
  renderEntry={(context) =>
    context.path.toLowerCase() === 'manifest.json'
      ? <Internals
          manifest={context.manifest}
          editable={context.mode === 'editable'}
          onManifestChange={context.updateManifest}
        />
      : undefined}
/>
```

Returning `undefined` delegates to `entryRenderers` and the built-in
rendering. The wrapper owns the React root: it mounts on claim, re-renders
on context updates **and on every parent commit** (entry content stays live
with parent state — inline closures are safe and never re-mount), and
unmounts on selection change. `renderEntryPriority` orders it against
`entryRenderers`.

#### Vue: `#entry` scoped slot

```vue
<MdzipWorkspace :bytes="bytes">
  <template #entry="{ context }">
    <Internals
      v-if="context.path.toLowerCase() === 'manifest.json'"
      :manifest="context.manifest"
      :editable="context.mode === 'editable'"
      @manifest-change="context.updateManifest"
    />
  </template>
</MdzipWorkspace>
```

A slot render that produces no content (its `v-if` is false) delegates to
the next renderer or the built-in rendering. The slot mounts in a detached
tree that shares the host app context (plugins, provide/inject), the context
is reactive (updates flow through on `update()`), and the tree unmounts on
selection change. `entrySlotPriority` orders it against `entryRenderers`.

## Theme Integration

The built-in light and dark controls apply complete editor token sets. A host
can set `initialColorScheme`, listen to `onColorSchemeChanged`, or hide those
buttons with `colorScheme: false`.

Custom themes define `--theme-*` variables on `:root`, the editor container, or
an ancestor. See the [Theming Guide](theming.md) for complete theme examples,
token precedence, exported CSS constants, and the full variable reference.
