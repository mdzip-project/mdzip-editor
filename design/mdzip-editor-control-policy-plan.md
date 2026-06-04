# MDZip Editor Control Policy Plan

## Goal

Provide a host-facing API for enabling, disabling, and hiding controls in the reusable MDZip editor.

The editor should support distinct embedding scenarios:

- Viewer-only surfaces where there should be no toolbar at all.
- Standalone web or desktop editors where the component may expose its own save/export action.
- Hosted editors, such as VS Code custom editors, where the host owns save semantics and the embedded UI should not show a save button.

This should be a UI policy layer, not the security layer. `MdzipWorkspaceService` must continue to enforce read-only behavior and mutation rules internally.

## Current State

`MdzipWorkspaceService` already has:

```ts
type MdzipWorkspaceMode = 'read-only' | 'editable';
```

That mode controls core permissions:

- read-only workspaces reject edits,
- CodeMirror is configured read-only,
- save, title edit, paste image, remove asset, and other mutations are blocked.

`MdzipWorkspaceView` currently renders a fixed shell:

- toolbar,
- navigation toggle,
- title button,
- preview/split/source layout controls,
- save button,
- zoom controls,
- orphaned asset action menu.

This means read-only/viewer usage still looks like an editor shell, even when the host wants a clean document viewer.

## Design Direction

Split host customization into two concepts:

1. **Capabilities**
   Hard rules about what operations are allowed. These are enforced by `MdzipWorkspaceService` and existing read-only checks.

2. **Control policy**
   UI rules about which controls are rendered, hidden, or enabled. These belong to `MdzipWorkspaceView` and framework wrappers.

Hidden controls are not security. They only shape the user experience.

## Proposed API

Add control policy options to `MdzipWorkspaceViewOptions`.

```ts
export type MdzipControlPreset =
  | 'viewer'
  | 'standalone-editor'
  | 'hosted-editor'
  | 'custom';

export interface MdzipControlPolicy {
  preset?: MdzipControlPreset;
  toolbar?: boolean;
  navigation?: boolean;
  title?: boolean;
  layout?: boolean;
  save?: boolean;
  zoom?: boolean;
  orphanActions?: boolean;
}

export interface MdzipWorkspaceViewOptions {
  controls?: MdzipControlPreset | MdzipControlPolicy;
  initialLayout?: 'preview' | 'source' | 'split';
  onChanged?: (bytes: Uint8Array, snapshot: MdzipWorkspaceSnapshot) => void;
  onSaved?: (bytes: Uint8Array, snapshot: MdzipWorkspaceSnapshot) => void;
  onFailed?: (error: unknown) => void;
}
```

The `controls` option can be either a preset name or an explicit policy.

Examples:

```ts
new MdzipWorkspaceView(container, {
  controls: 'viewer',
  initialLayout: 'preview'
});
```

```ts
new MdzipWorkspaceView(container, {
  controls: 'hosted-editor',
  initialLayout: 'split',
  onChanged(bytes) {
    // Host marks its own document dirty and manages persistence.
  }
});
```

```ts
new MdzipWorkspaceView(container, {
  controls: {
    preset: 'custom',
    toolbar: true,
    navigation: true,
    title: false,
    layout: true,
    save: false,
    zoom: true,
    orphanActions: false
  }
});
```

## Developer-Facing API

The framework packages should expose the same API in the style native to each framework:

- Angular uses inputs and outputs.
- React uses props and callback props.
- Vue uses props and emitted events.

The goal is that host applications do not need to know about `MdzipWorkspaceView` unless they are using the framework-independent package directly.

### Angular

Angular developers should configure the editor through inputs:

```html
<mdzip-workspace
  [bytes]="bytes"
  fileName="document.mdz"
  mode="read-only"
  controls="viewer"
  initialLayout="preview"
  (changed)="onChanged($event)"
  (saved)="onSaved($event)"
  (failed)="onFailed($event)">
</mdzip-workspace>
```

Recommended component API:

```ts
@Input() bytes?: Uint8Array;
@Input() fileName = 'document.mdz';
@Input() mode: MdzipWorkspaceMode = 'read-only';
@Input() controls: MdzipControlPreset | MdzipControlPolicy = 'viewer';
@Input() initialLayout?: MdzipWorkspaceLayout;

@Output() readonly changed = new EventEmitter<MdzipWorkspaceChange>();
@Output() readonly saved = new EventEmitter<MdzipWorkspaceSave>();
@Output() readonly failed = new EventEmitter<unknown>();
```

Example hosted editor usage:

```html
<mdzip-workspace
  [bytes]="documentBytes"
  [fileName]="documentName"
  mode="editable"
  controls="hosted-editor"
  initialLayout="split"
  (changed)="markDocumentDirty($event)"
  (failed)="showError($event)">
</mdzip-workspace>
```

In hosted-editor mode the component should not show its own save button, so the host normally does not need `(saved)`.

### React

React developers should configure the editor through props:

```tsx
<MdzipWorkspace
  bytes={bytes}
  fileName="document.mdz"
  mode="read-only"
  controls="viewer"
  initialLayout="preview"
  onChanged={handleChanged}
  onSaved={handleSaved}
  onFailed={handleFailed}
/>
```

Recommended prop API:

```ts
export interface MdzipWorkspaceProps {
  bytes?: Uint8Array;
  fileName?: string;
  mode?: MdzipWorkspaceMode;
  controls?: MdzipControlPreset | MdzipControlPolicy;
  initialLayout?: MdzipWorkspaceLayout;
  onChanged?: (event: MdzipWorkspaceChange) => void;
  onSaved?: (event: MdzipWorkspaceSave) => void;
  onFailed?: (error: unknown) => void;
}
```

Example hosted editor usage:

```tsx
<MdzipWorkspace
  bytes={documentBytes}
  fileName={documentName}
  mode="editable"
  controls="hosted-editor"
  initialLayout="split"
  onChanged={markDocumentDirty}
  onFailed={showError}
/>
```

### Vue

Vue developers should configure the editor through props and events:

```vue
<MdzipWorkspace
  :bytes="bytes"
  file-name="document.mdz"
  mode="read-only"
  controls="viewer"
  initial-layout="preview"
  @changed="handleChanged"
  @saved="handleSaved"
  @failed="handleFailed"
/>
```

Recommended prop and event API:

```ts
props: {
  bytes: Uint8Array,
  fileName: { type: String, default: 'document.mdz' },
  mode: { type: String as PropType<MdzipWorkspaceMode>, default: 'read-only' },
  controls: {
    type: [String, Object] as PropType<MdzipControlPreset | MdzipControlPolicy>,
    default: 'viewer'
  },
  initialLayout: String as PropType<MdzipWorkspaceLayout>
},
emits: ['changed', 'saved', 'failed']
```

Example hosted editor usage:

```vue
<MdzipWorkspace
  :bytes="documentBytes"
  :file-name="documentName"
  mode="editable"
  controls="hosted-editor"
  initial-layout="split"
  @changed="markDocumentDirty"
  @failed="showError"
/>
```

### Event Shapes

Use structured event payloads for framework wrappers rather than emitting bare bytes everywhere.

```ts
export interface MdzipWorkspaceChange {
  bytes: Uint8Array;
  snapshot: MdzipWorkspaceSnapshot;
}

export interface MdzipWorkspaceSave {
  bytes: Uint8Array;
  snapshot: MdzipWorkspaceSnapshot;
}
```

This keeps framework APIs consistent while preserving access to both the latest archive bytes and the workspace state.

## Presets

### `viewer`

For read-only document viewing.

Recommended defaults:

```ts
{
  toolbar: false,
  navigation: true,
  title: false,
  layout: false,
  save: false,
  zoom: true,
  orphanActions: false
}
```

Default layout: `preview`.

The viewer keeps zoom available because read-only documents still need inspection controls. The host can still opt out with a custom policy if desired.

### `standalone-editor`

For a browser app, desktop app, or demo where the component owns most of the editing UI.

Recommended defaults:

```ts
{
  toolbar: true,
  navigation: true,
  title: true,
  layout: true,
  save: true,
  zoom: true,
  orphanActions: true
}
```

Default layout: `split`.

The save button calls `onSaved` with archive bytes.

### `hosted-editor`

For VS Code and other hosts with their own save lifecycle.

Recommended defaults:

```ts
{
  toolbar: true,
  navigation: true,
  title: true,
  layout: true,
  save: false,
  zoom: true,
  orphanActions: true
}
```

Default layout: `split`.

The host uses `onChanged` to track document changes and owns persistence through its native save/backup/autosave APIs.

## Rendering Rules

- Hide controls that the host opts out of.
- Disable controls that are currently invalid because of workspace state.
- Do not render the toolbar if every toolbar control is hidden.
- Do not show title editing in read-only mode even if `title: true`.
- Do not show source or split layout controls when the workspace is read-only unless the host explicitly wants source viewing.
- Do not show mutation menus, such as orphan removal, unless both the policy and workspace mode allow mutation.

## Initial Layout

`MdzipWorkspaceView.open()` currently resets layout to `split`.

Replace that with policy-driven layout:

- Use `options.initialLayout` when provided.
- Otherwise use the preset default.
- If the selected layout is not valid for the current file or mode, fall back to `preview`.

For example:

- Viewer opens in `preview`.
- Hosted editor opens in `split`.
- Image, binary, and non-editable text paths open in `preview`.

## Framework Wrapper Updates

Expose the same control policy through Angular, React, and Vue wrappers.

Angular:

```ts
@Input() controls: MdzipControlPreset | MdzipControlPolicy = 'viewer';
@Input() initialLayout?: MdzipWorkspaceLayout;
```

React:

```ts
interface MdzipWorkspaceProps {
  controls?: MdzipControlPreset | MdzipControlPolicy;
  initialLayout?: MdzipWorkspaceLayout;
}
```

Vue:

```ts
controls: {
  type: [String, Object],
  default: 'viewer'
}
```

Keep wrapper defaults conservative. Current wrappers default to `read-only`, so `controls: 'viewer'` is the natural matching default.

## Save Button Guidance

The embedded save button should exist only when the component is acting as a standalone editor.

Do not show it in VS Code:

- VS Code already has save commands, dirty indicators, autosave, backups, Save All, and revert.
- A webview-local save button can confuse ownership of persistence.
- The extension should consume `onChanged` and implement the custom document save lifecycle.

Do show it in standalone hosts when the host wants a direct "commit/export bytes" action.

## Implementation Steps

1. Add exported control policy types in `packages/editor/src/view.ts` or a small dedicated module.
2. Add `controls` and `initialLayout` to `MdzipWorkspaceViewOptions`.
3. Implement a `resolveControlPolicy(...)` helper that merges preset defaults with explicit overrides.
4. Replace fixed toolbar visibility with policy-aware visibility.
5. Hide or disable each control according to policy plus workspace state.
6. Make `open()` choose layout from `initialLayout` or preset default instead of always using `split`.
7. Prevent hidden mutation controls from opening dialogs or menus.
8. Update Angular, React, and Vue wrappers to pass through the new options.
9. Add tests for policy resolution and key rendering states.
10. Update demo usage to show at least viewer, standalone editor, and hosted editor configurations.

## Test Coverage

Recommended tests:

- `viewer` preset renders no toolbar.
- `viewer` preset opens in preview layout.
- `hosted-editor` preset hides save but keeps layout and navigation controls.
- `standalone-editor` preset shows save when editable.
- Read-only mode still blocks mutation even if a custom policy requests mutation controls.
- Custom policy can hide individual controls.
- `initialLayout` is honored when valid and falls back to preview when invalid.

If DOM tests are too heavy for the first pass, cover `resolveControlPolicy(...)` with unit tests and add focused smoke coverage for rendered toolbar visibility.

## Compatibility

This is additive if defaults preserve current behavior for direct `MdzipWorkspaceView` usage.

Recommended defaults:

- `MdzipWorkspaceView` direct constructor default: `controls: 'standalone-editor'`.
- Framework wrapper default: `controls: 'viewer'`, matching their existing `mode: 'read-only'` default.

This preserves the current direct-view behavior while making wrapper usage feel like a viewer by default.
