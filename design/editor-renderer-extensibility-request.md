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

> Resolved 2026-06-12 — see [Resolution](#resolution-2026-06-12) below.

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

## Resolution (2026-06-12)

Status: **Accepted** with the amendments below. Reviewed against the current
release (`@mdzip/editor@1.3.1` and wrappers at 1.3.1; the request predates
1.3.0 `fileActions`, addressed in D6). The entry renderer contract is adopted
as the canonical long-term extension boundary, with Markdown rendering as a
specialized built-in path, per the recommendation above.

Implementation status (2026-06-12): Phases 1–4 are implemented.
Phases 1–3: `markdownRenderer`, `markdownExtensions`, and `entryRenderers`
in `MdzipWorkspaceViewOptions` and as inputs/props on all three wrappers,
with the async/cancellation/memoization machinery, `updateManifest()`, and
contract tests. Phase 4 shipped as one cross-framework deliverable: Angular
`<ng-template mdzipEntryRenderer>` / `[mdzipEntryRendererMatch]` directives,
React `renderEntry`, and Vue `#entry` scoped slot, each adapted onto the
framework-independent `MdzipEntryRenderer` contract with per-framework
lifecycle tests (vitest) and ESLint coverage across all packages.

**D13 (resolves the last open question).** Native framework APIs support
*both* styles: the renderer collection inputs/props and one idiomatic
catch-all per framework (template directives / render function / scoped
slot). Catch-alls are adapted onto the entry renderer contract and appended
after the explicit collection, so at equal priority explicit renderers win,
and matching/fallback/lifecycle semantics are identical everywhere. A
catch-all declines by producing no content (`undefined` in React, empty
slot render in Vue) or by its path/predicate not matching (Angular).

### Decisions

**D1. Extension boundary.** Entry renderers are the canonical boundary;
Markdown renderer/extension hooks are the specialized path. Accepted as
proposed.

**D2. Entry renderers claim the full pane stack**, not just the preview pane.
A matched renderer suppresses both the CodeMirror edit pane and the built-in
preview. The headline use cases (manifest editor, draw.io, PDF) have no
meaningful source pane, and `manifest.json` is already excluded from text
editing by `canEditMdzipPath`.

**D3. Sanitization ownership.** The view pipeline owns sanitization: HTML
from custom renderers and `transformHtml` hooks is sanitized before DOM
insertion. Amendment to the proposal: `defaultSafeMarkdownRenderer` keeps
sanitizing internally (its standalone export contract is unchanged for any
direct consumers of the published packages), and marks its output as already
sanitized so the pipeline skips the duplicate pass. Exactly one DOMPurify
pass runs per render regardless of path. Bypass remains an explicit,
clearly named option as proposed.

**D4. Placeholder survival.** The sanitizer policy is not extensible by
extensions. Extensions that need to hydrate placeholders in `mount()` must
use class/id markers that survive the existing policy and carry payloads
(e.g. Mermaid source) out-of-band in a side map keyed by marker id — not in
data attributes (`ALLOW_DATA_ATTR` is `false`) or other stripped attributes.
This is also cheaper: large payloads are never attribute-escaped or pushed
through DOMPurify. Revisit scoped sanitizer allowlist extensions only if
real adapters prove this too restrictive.

**D5. `update()` vs re-mount keying.** Renders are keyed by
`(path, matched renderer id)`. Same key → `update()` (if implemented,
else no-op); changed key → `destroy()` then `mount()`. The Markdown preview
pipeline is memoized on `(currentPath, currentText, colorScheme, image map)`:
unrelated snapshot changes (dialogs, nav menu, layout toggles) no longer
reset preview DOM, fixing an existing inefficiency where every snapshot
render re-ran marked + DOMPurify and reset `innerHTML`.

**D6. `fileActions` interaction** (added in 1.3.0, after this request was
drafted). Rename, move, or delete of the entry backing an active renderer is
treated as a selection change: the handle is destroyed, then matching re-runs
against the new state.

**D7. Wrapper prop identity.** Wrappers must not recreate the workspace view
when renderer props change identity. `entryRenderers` and
`markdownExtensions` are diffed by stable renderer `id`/`name`; React's
`renderEntry` callback is held in a ref so a new inline lambda per render is
free. Without this, idiomatic inline props would rebuild the entire workspace
(archive re-parse, nav tree, CodeMirror) on every parent render.

**D8. Matching API.** Predicate-only in the core contract. Convenience
helpers ship as pure functions (e.g. `byPath('manifest.json')`,
`byExtension('.drawio')`), not as declarative fields.

**D9. `updateManifest()` takes a full manifest only.** Matches the existing
`MdzPackagerCore.updateManifest` semantics and keeps the operation atomic;
hosts compose partial updates by spreading. It must route through the
existing `'manifest'` edit event so the `onManifestChanged` host-delegated
persistence contract continues to hold — Studio is precisely such a host.

**D10. Asset resolution.** Markdown arrives at `transformMarkdown` hooks and
the renderer with image sources already rewritten (current behavior). The
resolver is additionally exposed on the render/entry context so `mount()`
hooks can resolve assets the Markdown rewriter does not know about.

**D11. Phasing amendment.** Phase 1 and Phase 2 land together: the
async/cancellation/stale-result machinery is the same in both, and landing
them separately would change the rendering service contract twice.
Phases 3 and 4 as proposed, including the cross-framework parity requirement
for Phase 4.

**D12. Deferred.** Separate preview/source renderers per entry, representing
built-in renderers through the public registry, and wrapper-level imperative
`openPath()` are all deferred — none block the motivating use cases and all
are additive later. `openPath()` is the most likely near-term follow-up.

### Additional acceptance criteria

- With no custom renderer or extension registered, the render path performs
  no more work than the current release: a fully synchronous pipeline runs
  synchronously (no forced microtask hop per keystroke), and the async
  generation/abort machinery engages only when a hook actually returns a
  promise.
- A keystroke in split mode with a registered-but-non-matching entry renderer
  and one markdown extension must not destroy any mounted handle, re-run
  `mount()`, or reset unrelated preview DOM.
- Exactly one sanitization pass runs per rendered document.
- Wrapper renderer-prop identity changes (new array/lambda instances with
  equivalent contents) must not recreate the workspace view.

### Compatibility verification

Checked 2026-06-12 against downstream consumers: neither MDZip Studio nor
mdzip-vscode uses `MdzipRenderingService`, `defaultSafeMarkdownRenderer`, or
`renderMdzipPreviewHtml` at runtime (Studio imports types only; the
`MdzipRenderingService` mention in Studio's `MDZIP_LIBRARY_NOTES.md` is
stale). D3's keep-self-sanitizing amendment therefore protects only unknown
external consumers of the published npm packages, at no implementation cost.

The `MdzipMarkdownRenderer` signature change (options record → documented
context, `string` → `string | Promise<string>`) remains source-compatible
for implementors; direct callers of `.render()` must become async-aware as
noted in Compatibility Notes above.
