# MDZip Editor Developer Guide

`mdzip-editor` can run as a complete standalone editor or as an embedded
workspace inside a larger web or desktop application. The same workspace view
is available through the raw browser API and the Angular, React, and Vue
wrappers.

## Packages

```sh
npm install mdzip-editor
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
    link: true
  },
  save: false,
  zoom: true,
  colorScheme: true,
  orphanActions: false
} as const;
```

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

## Raw Browser API

```ts
import { MdzipWorkspaceView } from 'mdzip-editor';

const container = document.querySelector<HTMLElement>('#editor')!;
const view = new MdzipWorkspaceView(container, {
  controls,
  initialLayout: 'source',
  initialColorScheme: 'dark',
  navigationMode: 'host',
  onChanged(bytes, snapshot) {
    console.log(snapshot.currentPath, bytes.byteLength);
  },
  onSaved(bytes) {
    persist(bytes);
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
await view.executeCommand('bold');
view.focus();
view.destroy();
```

Use `navigationMode: 'host'` when the application supplies its own document and
asset navigation. Use `navigationMode: 'none'` when neither the editor nor host
should display package navigation.

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
`code-block`, `blockquote`, `link`, and `insert-image`. Calling
`insert-image` without a `File` opens the built-in image file picker.

## Angular

```ts
import { Component, ViewChild } from '@angular/core';
import { MdzipWorkspaceComponent } from '@mdzip/editor-ng';
import type {
  MdzipControlPolicy,
  MdzipWorkspaceChange
} from 'mdzip-editor';

const editorControls: MdzipControlPolicy = {
  preset: 'hosted-editor',
  navigation: false,
  formatting: { image: false }
};

@Component({
  standalone: true,
  imports: [MdzipWorkspaceComponent],
  template: `
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
  @ViewChild('workspace') workspace?: MdzipWorkspaceComponent;
  bytes: Uint8Array | null = null;
  controls = editorControls;

  bold(): void {
    void this.workspace?.executeCommand('bold');
  }

  onChanged(event: MdzipWorkspaceChange): void {
    this.bytes = event.bytes;
  }

  onFailed(error: unknown): void {
    console.error(error);
  }
}
```

Angular outputs include `changed`, `saved`, `snapshotChanged`,
`selectionChanged`, `dirtyChanged`, `validationChanged`,
`colorSchemeChanged`, and `failed`.

## React

```tsx
import { useRef } from 'react';
import {
  MdzipWorkspace,
  type MdzipWorkspaceHandle
} from '@mdzip/editor-react';
import type { MdzipControlPolicy } from 'mdzip-editor';

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
import type { MdzipControlPolicy } from 'mdzip-editor';

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

Vue emits the same event set exposed by the Angular and React wrappers.

## Host Persistence

Use `standalone-editor` when the built-in Save button should call `onSaved`.
Use `hosted-editor` when the containing application owns Save, Save As, and
keyboard shortcuts. The raw view exposes `flush()`, `serialize()`, and
`getCurrentSnapshot()` for that workflow.

## Theme Integration

The built-in light and dark controls apply complete editor token sets. A host
can set `initialColorScheme`, listen to `onColorSchemeChanged`, or hide those
buttons with `colorScheme: false`.

Custom themes can override `--theme-*` variables on the editor container or an
ancestor. See the exports in `theme.ts` for the complete token list.
