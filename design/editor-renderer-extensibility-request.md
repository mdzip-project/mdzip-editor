# Extensible Rendering and Host-Owned Entry Views

Proposed for: `@mdzip/editor`, `@mdzip/editor-ng`, `@mdzip/editor-react`, and `@mdzip/editor-vue`  
Requested by: MDZip Studio  
Reviewed against: `@mdzip/editor@1.2.9`, `@mdzip/editor-ng@1.2.9`, `@mdzip/editor-react@1.2.7`, and `@mdzip/editor-vue@1.2.7`  
Date: 2026-06-11

## Summary

`@mdzip/editor` should remain functional out of the box with its current safe Markdown renderer, while allowing host applications to provide optional rendering extensions or replace the view for selected archive entries.

This would support integrations such as Mermaid, draw.io, custom Markdown syntax, richer media previews, and host-owned `manifest.json` editors without adding those dependencies to the base editor package.

The proposal has two related extension points:

1. A Markdown rendering API for parsing and enhancing Markdown previews.
2. A selected-entry rendering API for replacing the content area for specific archive entries.

`@mdzip/editor` should continue to provide the default implementations. Hosts only opt into additional dependencies and behavior when they explicitly register an extension.

The same capability must be available through every supported integration:

- Framework-independent JavaScript through `@mdzip/editor`.
- Angular through `@mdzip/editor-ng`.
- React through `@mdzip/editor-react`.
- Vue 3 through `@mdzip/editor-vue`.

Framework wrappers may provide idiomatic component, template, render-function, or slot APIs, but none should have a reduced feature set.

## Motivation

The current default renderer is a good baseline:

- Markdown renders through `marked`.
- Rendered HTML is sanitized with DOMPurify.
- Fenced code blocks use `highlight.js`.
- CommonMark and common GFM-style constructs work without host configuration.

Hosts may need additional behavior that should not become mandatory dependencies of the editor:

- Render fenced `mermaid` blocks as diagrams.
- Display draw.io documents or embedded diagrams.
- Support application-specific Markdown directives.
- Render PDFs or other specialized assets.
- Replace the plain `manifest.json` code preview with a structured manifest editor.

MDZip Studio already has an Internals interface for viewing and editing controlled manifest fields. When `manifest.json` is selected in the editor navigation pane, Studio would like to mount that existing Angular component in the editor content area instead of showing the default JSON code block.

Bundling Mermaid, draw.io, Angular-specific components, or every possible renderer in `@mdzip/editor` would increase package size and maintenance burden for hosts that do not need those features.

## Current Limitations

### Markdown rendering

`MdzipRenderingService` accepts an `MdzipMarkdownRenderer`, but `MdzipWorkspaceView` constructs and owns its rendering behavior internally. `MdzipWorkspaceViewOptions` and `MdzipWorkspaceComponent` do not expose a renderer input.

The current renderer contract is also synchronous:

```ts
export interface MdzipMarkdownRenderer {
  render(markdown: string, options?: Record<string, unknown>): string;
}
```

Diagram engines and other richer renderers are often asynchronous and may require a post-render mount phase.

### Selected archive entries

Hosts can observe selection through `onSelectionChanged` or the Angular `selectionChanged` output. The snapshot includes `currentPath`, `currentPathType`, and manifest/workspace state.

However, hosts cannot replace only the selected-entry content pane:

- There is no entry renderer registry.
- There is no content-pane slot or mount target.
- There is no cancellable path-opening callback.
- `MdzipWorkspaceComponent` does not expose `openPath()`.
- `manifest.json` is classified as text and rendered by the built-in plain-text preview.
- Manipulating private DOM elements such as `.pane-stack` would depend on undocumented internals.

## Goals

- Preserve a capable default experience with no host configuration.
- Keep optional renderer dependencies out of the base packages.
- Allow complete Markdown renderer replacement when necessary.
- Allow smaller, composable Markdown rendering extensions.
- Allow hosts to replace the content area for selected archive entries.
- Provide feature parity across the raw JavaScript, Angular, React, and Vue integrations.
- Support native framework components through every wrapper package.
- Preserve sanitization and clearly document privileged rendering stages.
- Support asynchronous rendering, cancellation, and cleanup.
- Avoid stale asynchronous results when users switch entries quickly.

## Non-Goals

- Add Mermaid, draw.io, or other specialized renderer dependencies to `@mdzip/editor`.
- Require hosts to replace the default Markdown renderer.
- Expose private editor DOM structure as a public API.
- Make framework-specific concepts such as Angular `TemplateRef`, React elements, or Vue slots part of `@mdzip/editor`.

## Proposed API: Markdown Rendering

### Render context

Replace the generic options record with a documented context:

```ts
export interface MdzipMarkdownRenderContext {
  currentPath: string;
  sourceFormat: MdzipSourceFormat;
  colorScheme: MdzipColorScheme;
  mode: MdzipWorkspaceMode;
  manifest: MdzManifest | null;
  assetResolver?: MdzipAssetUrlResolver;
  signal: AbortSignal;
}
```

### Renderer contract

Allow synchronous or asynchronous renderers:

```ts
export interface MdzipMarkdownRenderer {
  render(
    markdown: string,
    context: MdzipMarkdownRenderContext
  ): string | Promise<string>;
}
```

Expose the renderer through the workspace view:

```ts
export interface MdzipWorkspaceViewOptions {
  // Existing options...
  markdownRenderer?: MdzipMarkdownRenderer;
}
```

The current safe renderer remains the default:

```ts
const renderer =
  options.markdownRenderer ?? defaultSafeMarkdownRenderer;
```

### Optional extension pipeline

Full renderer replacement is useful but heavy. Most integrations should be able to extend the default pipeline:

```ts
export interface MdzipMarkdownRenderExtension {
  name: string;

  transformMarkdown?(
    markdown: string,
    context: MdzipMarkdownRenderContext
  ): string | Promise<string>;

  transformHtml?(
    html: string,
    context: MdzipMarkdownRenderContext
  ): string | Promise<string>;

  mount?(
    container: HTMLElement,
    context: MdzipMarkdownRenderContext
  ): void | MdzipRenderHandle | Promise<void | MdzipRenderHandle>;
}

export interface MdzipRenderHandle {
  update?(context: MdzipMarkdownRenderContext): void | Promise<void>;
  destroy(): void;
}
```

The view options could accept:

```ts
export interface MdzipWorkspaceViewOptions {
  markdownRenderer?: MdzipMarkdownRenderer;
  markdownExtensions?: readonly MdzipMarkdownRenderExtension[];
}
```

### Suggested pipeline

```text
Markdown source
  -> transformMarkdown extensions
  -> Markdown renderer (default: marked)
  -> transformHtml extensions
  -> DOMPurify sanitization
  -> DOM insertion
  -> mount hooks
```

Mermaid could detect fenced `mermaid` blocks, replace them with inert placeholders during transformation, and hydrate those placeholders during `mount()`.

## Proposed API: Selected-Entry Rendering

Markdown customization alone does not cover `manifest.json`, draw.io files, PDFs, or other archive entry types. A broader entry renderer should be able to claim the selected content area.

### Entry context

```ts
export interface MdzipEntryRenderContext {
  path: string;
  pathType: MdzipPathType;
  mode: MdzipWorkspaceMode;
  sourceFormat: MdzipSourceFormat;
  colorScheme: MdzipColorScheme;
  manifest: MdzManifest | null;
  snapshot: MdzipWorkspaceSnapshot;
  signal: AbortSignal;

  readBytes(): Promise<Uint8Array>;
  updateManifest(manifest: MdzManifest): Promise<void>;
}
```

The context should expose supported operations rather than the private `MdzipWorkspaceView` or internal DOM.

### Entry renderer contract

```ts
export interface MdzipEntryRenderer {
  id: string;
  priority?: number;

  matches(context: MdzipEntryRenderContext): boolean;

  mount(
    container: HTMLElement,
    context: MdzipEntryRenderContext
  ): void | MdzipEntryRenderHandle | Promise<void | MdzipEntryRenderHandle>;
}

export interface MdzipEntryRenderHandle {
  update?(context: MdzipEntryRenderContext): void | Promise<void>;
  destroy(): void;
}
```

Register renderers through the view:

```ts
export interface MdzipWorkspaceViewOptions {
  entryRenderers?: readonly MdzipEntryRenderer[];
}
```

Selection behavior:

1. The workspace opens the selected path normally.
2. The view constructs an `MdzipEntryRenderContext`.
3. Registered renderers are checked by priority.
4. The first matching renderer receives a stable content-pane container.
5. If no renderer matches, the existing built-in behavior is used.
6. The renderer handle is destroyed when selection changes or the view is destroyed.

Built-in Markdown, text, image, binary fallback, and manifest rendering can use the same conceptual pipeline internally, even if they are not initially exposed as public renderer objects.

## MDZip Studio Manifest Example

Studio could claim `manifest.json`:

```ts
const manifestRenderer: MdzipEntryRenderer = {
  id: 'mdzip-studio-manifest',
  priority: 100,

  matches: ({ path }) =>
    path.toLowerCase() === 'manifest.json',

  mount: (container, context) =>
    mountStudioInternalsComponent(container, {
      manifest: context.manifest,
      editable: context.mode === 'editable',
      updateManifest: context.updateManifest,
    }),
};
```

When the user selects `manifest.json`, the existing Studio Internals component would occupy the editor content area. Selecting another entry would destroy that component and restore the appropriate built-in or custom renderer.

## Framework Wrapper Parity

All maintained framework wrappers should expose the framework-independent APIs directly:

```ts
interface MdzipWorkspaceRenderingProps {
  markdownRenderer?: MdzipMarkdownRenderer;
  markdownExtensions?: readonly MdzipMarkdownRenderExtension[];
  entryRenderers?: readonly MdzipEntryRenderer[];
}
```

Passing framework-independent renderer objects must work identically in the raw JavaScript, Angular, React, and Vue integrations. Each wrapper should additionally offer an idiomatic way to mount native framework content without requiring the host to manually bootstrap its framework into an `HTMLElement`.

Required parity includes:

- The same matching and priority rules.
- The same `MdzipEntryRenderContext`.
- The same async, cancellation, stale-result, update, and destroy behavior.
- The same fallback to built-in renderers.
- The same manifest update and persistence behavior.
- The same security boundary between sanitized HTML and privileged mounted content.

### Angular

`@mdzip/editor-ng` should expose inputs for the shared renderer contracts:

```ts
@Input() markdownRenderer?: MdzipMarkdownRenderer;
@Input() markdownExtensions: readonly MdzipMarkdownRenderExtension[] = [];
@Input() entryRenderers: readonly MdzipEntryRenderer[] = [];
```

For native Angular components, a template directive provides a natural API:

```html
<mdzip-workspace
  [bytes]="workspaceBytes"
  mode="editable"
>
  <ng-template
    mdzipEntryRenderer="manifest.json"
    let-context
  >
    <app-internals
      [manifest]="context.manifest"
      [editable]="context.mode === 'editable'"
      (manifestChange)="context.updateManifest($event)"
    />
  </ng-template>
</mdzip-workspace>
```

A predicate form may also be useful for extensions or MIME/path families:

```html
<ng-template
  [mdzipEntryRendererMatch]="isDrawioEntry"
  let-context
>
  <app-drawio-viewer [entry]="context" />
</ng-template>
```

The Angular wrapper should own creation and destruction of embedded Angular views. The core editor should only know about the framework-independent renderer contract.

### React

`@mdzip/editor-react` should accept the shared renderer contracts as props:

```tsx
<MdzipWorkspace
  bytes={workspaceBytes}
  markdownRenderer={markdownRenderer}
  markdownExtensions={markdownExtensions}
  entryRenderers={entryRenderers}
/>
```

For native React content, expose an entry renderer prop using a render function or component:

```tsx
<MdzipWorkspace
  bytes={workspaceBytes}
  renderEntry={(context) =>
    context.path.toLowerCase() === 'manifest.json'
      ? (
          <Internals
            manifest={context.manifest}
            editable={context.mode === 'editable'}
            onManifestChange={context.updateManifest}
          />
        )
      : undefined
  }
/>
```

Returning `undefined` delegates to the next registered renderer or the built-in fallback. The React wrapper should create and unmount the React root and preserve the core renderer lifecycle.

### Vue

`@mdzip/editor-vue` should accept the shared renderer contracts as props:

```vue
<MdzipWorkspace
  :bytes="workspaceBytes"
  :markdown-renderer="markdownRenderer"
  :markdown-extensions="markdownExtensions"
  :entry-renderers="entryRenderers"
/>
```

For native Vue content, expose a scoped slot or component renderer:

```vue
<MdzipWorkspace :bytes="workspaceBytes">
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

The Vue wrapper should own mounting and unmounting the slot or component and preserve the core renderer lifecycle.

### Raw JavaScript

The framework-independent API remains the canonical capability and must not depend on a wrapper:

```ts
const view = new MdzipWorkspaceView(host, {
  bytes: workspaceBytes,
  markdownRenderer,
  markdownExtensions,
  entryRenderers: [manifestRenderer],
});
```

The wrapper APIs should adapt to this contract rather than implementing separate rendering systems.

## Lifecycle and Concurrency

Rendering must account for rapid selection and theme changes:

- Create a new `AbortController` for each render generation.
- Abort the previous render when selection changes.
- Ignore async results from obsolete render generations.
- Call `destroy()` before removing a mounted renderer.
- Call `update()` when the same renderer remains active and supports updates.
- Destroy active renderers when `MdzipWorkspaceView.destroy()` runs.

The content area should not be overwritten by a slow Mermaid or draw.io render after the user has already selected another entry.

## Security

Sanitization should remain owned by `@mdzip/editor` by default.

Recommended rules:

- HTML returned by renderers and transform hooks is sanitized before insertion.
- The default DOMPurify policy remains active unless explicitly configured.
- `mount()` hooks are privileged host code because they can create DOM directly.
- Bypassing sanitization requires an explicit, clearly named option.
- Renderer documentation should distinguish sanitized string output from trusted mount behavior.

For example:

```ts
export interface MdzipRenderingSecurityOptions {
  sanitizeHtml?: boolean; // Default: true
}
```

Avoid silently trusting custom HTML because a host supplied a renderer.

## Optional Adapter Packages

Specialized integrations can remain outside the base editor:

```text
@mdzip/editor
@mdzip/editor-ng
@mdzip/editor-react
@mdzip/editor-vue
@mdzip/editor-mermaid
@mdzip/editor-drawio
```

Official adapters are not required initially. Hosts can implement local adapters until repeated usage justifies separate packages.

Any optional adapter should declare its rendering engine as a peer dependency where practical, so the host controls versions and pays the bundle cost only when the adapter is installed.

## Suggested Delivery Phases

### Phase 1: Renderer injection

- Expose `markdownRenderer` through `MdzipWorkspaceViewOptions`.
- Expose it through Angular inputs, React props, and Vue props.
- Add async rendering, cancellation, and stale-result protection.
- Keep the existing renderer as the default.

### Phase 2: Markdown extensions

- Add composable transform and mount hooks.
- Keep sanitization in the editor pipeline.
- Add one dependency-free test extension as an example.

### Phase 3: Entry renderers

- Add `entryRenderers` and content-pane lifecycle management.
- Include manifest context and `updateManifest()`.
- Preserve built-in fallback rendering.

### Phase 4: Native framework renderers

- Add Angular `TemplateRef` support in `@mdzip/editor-ng`.
- Add React component/render-function support in `@mdzip/editor-react`.
- Add Vue scoped-slot/component support in `@mdzip/editor-vue`.
- Add equivalent integration and lifecycle tests for all three wrappers.

Phase 4 should be treated as one cross-framework deliverable. Angular support should not ship as the completed public feature while React or Vue remain unspecified follow-up work.

## Acceptance Criteria

- Existing applications behave exactly as they do today without configuration.
- No Mermaid, draw.io, or framework-specific dependency is added to `@mdzip/editor`.
- A host can supply a custom Markdown renderer.
- A custom renderer may complete asynchronously.
- Changing entries cancels or ignores stale rendering work.
- Default sanitization remains enabled for string HTML.
- A host can register an extension that renders fenced Mermaid blocks.
- A host can claim `manifest.json` and mount a custom editable interface.
- Manifest edits made by a custom renderer flow through supported workspace events and persistence.
- Custom renderer handles are destroyed on selection change and view destruction.
- `@mdzip/editor-ng` can mount and clean up a native Angular template/component.
- `@mdzip/editor-react` can mount and clean up native React content.
- `@mdzip/editor-vue` can mount and clean up native Vue content.
- Raw JavaScript, Angular, React, and Vue expose equivalent renderer capabilities in the same feature release.
- Cross-framework contract tests verify matching, fallback, cancellation, updates, cleanup, and manifest persistence.
- If no custom renderer matches, existing Markdown, text, image, and binary behavior remains unchanged.

## Compatibility Notes

Adding optional fields to `MdzipWorkspaceViewOptions` is backward compatible.

Changing `MdzipMarkdownRenderer.render()` from a synchronous string return to `string | Promise<string>` is source-compatible for existing renderer implementations, but consumers of the method must become async-aware.

If changing the existing interface is considered too disruptive, introduce a new interface and adapt legacy renderers:

```ts
export type MdzipMarkdownRendererLike =
  | MdzipMarkdownRenderer
  | MdzipAsyncMarkdownRenderer;
```

The selected-entry renderer API is additive.

## Open Design Questions

- Should matching use a predicate only, or also support convenient path/glob/MIME declarations?
- Should the editor expose separate preview and source renderers for an entry?
- Should custom entry renderers be allowed to replace the full pane stack or preview only?
- Should `updateManifest()` accept a full manifest, a partial update, or both?
- Should built-in renderers eventually be represented through the same public registry?
- Should all wrapper packages expose imperative `openPath()` for host-owned navigation at the same time?
- Should native framework APIs use one renderer collection, a single catch-all render callback/slot, or support both?

## Recommendation

Implement the generalized selected-entry renderer contract as the long-term extension boundary, with Markdown rendering as a specialized built-in path.

This avoids creating a narrow Mermaid-only hook or a one-off manifest override. It gives hosts one consistent way to support richer Markdown, specialized files, and native application editors while keeping the base package lightweight and fully functional by default.

The framework-independent contract should be the source of truth, and Angular, React, and Vue support should ship with capability and lifecycle parity. Framework-specific ergonomics may differ, but framework choice should not determine whether a host can customize Markdown rendering or replace the selected-entry view.
