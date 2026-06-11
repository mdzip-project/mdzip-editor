# Nav Pane Context Menu — Plan

Add right-click context menu items to the navigation pane:

1. **New .md file** — on a folder, or on blank area (creates at archive root).
2. **Delete** — on any file. Prompts for confirmation first, *except* orphaned assets, which delete immediately (matching today's orphan-menu behavior).
3. **Set as entry point** — on any `.md` file that is not already the entry point.
4. **Rename…** — on any file (also serves as "move" by typing a new path).
5. **New folder** — on a folder or blank area.
6. **Copy markdown link / image embed** — on any file; copies `[name](relative/path)` (or `![](…)` for images) relative to the current document.
7. **Replace file…** — on assets; re-upload new content keeping the same path.
8. **Download** — on any file; save a copy outside the archive.
9. **Set as cover image / Remove cover image** — on image assets; toggles the manifest `cover` field.
10. **Duplicate** — on any file; copy with an auto-suffixed name.

Plus three non-menu changes:

- **Visually distinguish the entry-point document** in the nav tree (bold label) so it's always identifiable.
- **Drag-and-drop**: drag files between folders in the tree (move), and drop OS files onto the pane (add as assets).
- **`onConversionRequested` host hook** — lets a consuming app take over the markdown→MDZ conversion flow (e.g. when a user adds an image to a `.md` file) instead of the built-in dialog.

Status: **implemented** (2026-06-11). All five phases landed in one pass; verified by
unit tests (`packages/editor/tests/workspace.test.mjs`, 51 passing) and browser automation
(`scripts/verify-nav-menu.mjs` — 20 checks, `scripts/verify-dnd.mjs` — 4 checks, both green
against the demo). Notes vs. plan: the `.md`-via-`addAsset` round-trip **does** classify the
file as a document after reload, so no `addMarkdownFile()` was needed; `setEntryPoint` emits
`['manifest']` (no new change kind); rename ships *with* reference rewriting, including
re-basing a moved document's own relative links.

Post-plan addition (same day): **tree→editor drag-and-drop** — dragging a nav-tree file onto
the editor surface inserts a markdown link (`[name](rel)`) or image embed (`![name](rel)`) at
the pointer position (CodeMirror `posAtCoords` + `dropCursor`). Draggability was decoupled
from `fileActions`: files (including the entry point, excluding the manifest) are draggable
whenever the workspace is editable; tree-internal *moves* are still gated by `fileActions` at
drop time. OS image files dropped on the editor embed like a paste (conversion dialog on
plain markdown sources). Verified by `scripts/verify-editor-drop.mjs` (7 checks).

Bug found after manual testing: real drags showed the drop cursor but inserted nothing —
`effectAllowed: 'move'` (dragstart) vs `dropEffect: 'link'` (editor dragover) made the
browser cancel the drop before the event fired. Fixed with `effectAllowed: 'copyMove'`
(tree moves = `'move'`, editor inserts = `'copy'`). Synthetic `dispatchEvent('drop')` tests
bypass this negotiation, so `scripts/verify-real-drag.mjs` (3 checks, Playwright `dragTo`
real mouse drags) now covers it.

---

## Current state

- The nav tree is rendered by `renderNavNode()` ([view.ts:540](../../packages/editor/src/view.ts#L540)). Files render as `<button data-nav-path="...">`; directories render as `<details class="nav-directory">` with **no path attribute** — but `MdzipNavNode` already has a `path` field ([workspace-view.ts:7](../../packages/editor/src/workspace-view.ts#L7)), so it just isn't emitted.
- There is already a single-item context menu for orphaned assets:
  - Markup: `.orphan-context-menu` / `data-ref="orphan-menu"` (view.ts ~2341), styles in [view-css.ts:621](../../packages/editor/src/view-css.ts#L621).
  - Positioning/open logic: `showOrphanMenu()` ([view.ts:2024](../../packages/editor/src/view.ts#L2024)), state in `orphanMenuState`, rendered in `render()` (~line 1136).
  - Triggers: `contextmenu` on `elNavTree` (view.ts:1303), click on the warning badge, Enter key.
  - Action: `removeOrphan()` → `workspace.removeAsset(path, { requireOrphaned: true })` — **no confirmation prompt**.
- **Important data-model split** (`MdzWorkspace` from `@mdzip/core-js`): markdown files live in `workspace.documents`; everything else non-manifest lives in `workspace.assets`. Consequences:
  - `removeAsset()` ([workspace.ts:404](../../packages/editor/src/workspace.ts#L404)) only filters `assets` — it **cannot delete a non-entry `.md` document today**. The workspace service needs a generalized removal.
  - `addAsset()` ([workspace.ts:384](../../packages/editor/src/workspace.ts#L384)) creates an *asset*, but it then re-serializes and re-opens the archive (`reloadPreservingCurrentText(serializeWorkspaceBytes())`), and re-opening classifies by extension — so a `.md` added via `addAsset` should land in `documents` after the reload. **Verify this round-trip in a test**; if it doesn't hold, add a dedicated `addMarkdownFile()`.
  - The entry-point markdown is a document, never an asset, so it is inherently protected from `removeAsset` — keep that protection explicit in the new removal path.
- Entry point support already in core-js: `MdzWorkspace.entryPoint`, `MdzWorkspaceDocument.isEntryPoint`, and `MdzPackagerCore.updateManifest(manifest, { entryPoint })` (mdz-core.d.ts:901). The manifest patch flows through `serializeWorkspaceBytes()` → `MdzArchiveCore.updateFiles(..., { manifest })` ([workspace.ts:677](../../packages/editor/src/workspace.ts#L677)).
- Incremental serialization: `pendingWrites` / `pendingRemovals` maps ([workspace.ts:659](../../packages/editor/src/workspace.ts#L659)) patch the archive in place. Rename/move can be expressed as *write at new path + removal at old path* with no new core-js API.
- Gating precedent: `controlPolicy.orphanActions` boolean, plus `snapshot.mode !== 'read-only'` (view.ts:1085). Presets defined around view.ts:290–337.
- Confirmation-dialog precedent: the MDZ conversion dialog (`elConversionDialog`). Name-input precedent: the title dialog (`elTitleInput` + validation + save/cancel).

## Design

### 1. Generalize the orphan menu into a nav context menu

Replace `.orphan-context-menu` with a general `.nav-context-menu` (`data-ref="nav-menu"`) whose items are populated per-target at open time. Menu state replaces `orphanMenuState`:

```ts
type NavMenuTarget =
  | { kind: 'file'; path: string; orphaned: boolean; isMarkdown: boolean; isEntryPoint: boolean; isImage: boolean }
  | { kind: 'directory'; path: string }   // '' = root / blank area
private navMenuState: { target: NavMenuTarget; x: number; y: number } | null;
```

Items by target (separators between the groups shown with `‖`):

| Target | Items |
|---|---|
| Directory / blank area | New .md file · New folder |
| Non-entry `.md` document | Set as entry point ‖ Copy markdown link ‖ Rename… · Duplicate ‖ Download ‖ Delete… (prompt) |
| Entry-point `.md` document | Copy markdown link ‖ Rename… · Duplicate ‖ Download *(no Set-as-entry, no Delete)* |
| Image asset | Set/Remove cover image ‖ Copy image embed ‖ Rename… · Duplicate · Replace… ‖ Download ‖ Delete… (prompt) |
| Other asset | Copy markdown link ‖ Rename… · Duplicate · Replace… ‖ Download ‖ Delete… (prompt) |
| Orphaned asset | as its asset type, but Delete has no prompt (current `removeOrphan` semantics) |
| Manifest (`isMdzipManifestPath`) | Download only |

Mutating items (create/rename/duplicate/replace/delete/entry-point/cover) require `fileActions` + editable mode; **Copy** and **Download** are non-mutating and appear whenever the menu is available, including read-only mode. If no items qualify, the menu doesn't open.

The existing orphan warning badge and its click/Enter handlers keep working — they open the same menu with the orphan target.

### 2. Context-menu trigger changes (view.ts:1303)

Rewrite the `contextmenu` listener on `elNavTree`:

- `closest('[data-nav-path]')` → file target (`data-orphan` for the orphaned flag; markdown/entry-point determined from the snapshot).
- else `closest('summary')` inside `.nav-directory` → directory target, using a new `data-nav-dir="${node.path}"` attribute emitted by `renderNavNode()` on the `<details>` element.
- else (blank area of `elNavTree`) → root directory target (`path: ''`).
- Always `preventDefault()` when we show a menu; require `sourceFormat === 'mdz'` (plain markdown source has no archive to operate on). Item-level gating per the table above: mutating items need `fileActions` + editable mode, Copy/Download don't.

Dismissal: reuse the existing pattern that closes the orphan menu (document click / render cycle). Verify Escape closes it; add if missing.

### 3. New .md file flow

1. Menu item clicked → open a small "New file" dialog (clone the title-dialog pattern: input + validation + Create/Cancel). Pre-fill `untitled.md`; remember the target directory.
2. Validation: non-empty, no `/` or `\` (single segment), append `.md` if no extension, reject duplicate path (case-insensitive, matching the workspace's comparison style), reject manifest name.
3. On confirm: `await workspace.addAsset(`${dir ? dir + '/' : ''}${name}`, new TextEncoder().encode('# <basename>\n'))` — relies on the reload round-trip classifying it as a document (see Current state; add `addMarkdownFile()` if that fails).
4. Then `openPath(newPath)` and `render()`.

### 4. Delete flow

- Orphaned asset: existing `removeOrphan()` path unchanged (no prompt).
- Any other deletable file: confirm dialog (clone conversion-dialog pattern) — "Delete `<path>` from the archive? This cannot be undone." Confirm → new generalized `workspace.removeFile(path)`:
  - Asset → current `removeAsset` logic.
  - Non-entry document → filter from `workspaceValue.documents`, `recordPendingRemoval`, reserialize/reload (mirror `removeAsset`).
  - Entry-point document or manifest → return `false` (and the menu never offers it).
  - Keep `removeAsset` as a public API (wrappers/hosts use it); implement both over a shared private removal.
- If the deleted file is `currentPath`, `reloadPreservingCurrentText(..., target.path)` re-selects — verify it falls back to the entry point.
- Deleting a *referenced* asset leaves a dangling markdown link — acceptable; preview already tolerates missing refs.

### 5. Set as entry point

New workspace method:

```ts
public async setEntryPoint(archivePath: string): Promise<boolean>
```

1. Guards: `assertEditable`, `sourceFormat === 'mdz'`, target exists in `workspaceValue.documents`, not already the entry point. Otherwise return `false`.
2. `commitPendingTextToWorkspace()`.
3. Update `workspaceValue.entryPoint`, flip `isEntryPoint` on the affected documents, and `workspaceValue.manifest = MdzPackagerCore.updateManifest(manifest, { entryPoint: path })`.
4. Reserialize + `reloadPreservingCurrentText()`. `openedArchiveFromWorkspace` re-derives `content.entryPoint` / `markdownText` from the new entry document ([archive-utils.ts:39](../../packages/editor/src/archive-utils.ts#L39)).
5. Reset `liveOrphanedPaths` so orphan analysis recomputes against the new entry document (referenced-image sets change with the entry).
6. `dirty = true`, emit `edit` with `['manifest']` (or a new `'entry-point'` change kind — decide at implementation; new kind is more honest but touches the change-kind union).
7. Keep the current selection; don't auto-navigate to the new entry point.

Old entry point simply becomes a regular document — still in the nav, still editable, now deletable.

### 6. Entry-point highlight in nav tree

In `renderNavNode()`: when `node.entry.path === state.content.entryPoint` (and `sourceFormat === 'mdz'`), add class `entry-point` to the file button and append " — entry point" to the `title` tooltip. CSS: `font-weight: 600` on `.nav-file.entry-point .nav-label` (works in both color schemes; no color dependence). Must compose with the existing `current-entry` highlight — bold + current-selection background together should read fine; verify visually.

### 7. Rename / move

Menu item **Rename…** opens the name dialog pre-filled with the file's full archive path (not just the basename) — editing the directory part *is* the move operation; no separate "Move" item.

New workspace method:

```ts
public async renameFile(oldPath: string, newPath: string): Promise<boolean>
```

1. Guards: editable, mdz, source exists, normalized `newPath` valid (no `..`, no leading/trailing `/`, not `manifest.json`), no case-insensitive collision with an existing path.
2. `commitPendingTextToWorkspace()`.
3. Read content (`readWorkspacePathBytes(oldPath)`), then `recordPendingWrite(newPath, content)` + `recordPendingRemoval(oldPath)`; update the in-memory `documents`/`assets` entry's path.
4. If the renamed file is the entry point: also update `workspaceValue.entryPoint` + manifest (reuse the `setEntryPoint` manifest step).
5. If `currentPath === oldPath`, retarget `currentPathValue` to `newPath` before reload.
6. Reserialize + reload, `dirty = true`, emit `edit`.

**Reference rewriting (best effort):** renaming an image that markdown references would dangle the links. After the rename, rewrite matching references in all loaded document texts: resolve each `![...](target)` via the existing relative-path logic (`referencedImagePaths` regex at [workspace.ts:772](../../packages/editor/src/workspace.ts#L772) is the basis) and rewrite ones that resolved to `oldPath` using `relativeMarkdownAssetPath`. Same for renaming a `.md` that other docs link to (the preview link resolver `resolveMdzipArchiveLinkTarget` shows the resolution rules). Lazy documents (`readText`) must be materialized first — acceptable cost on rename. If this proves too fiddly for the first pass, ship rename with a dialog warning ("links to this file are not updated") and do rewriting as the immediate follow-up.

### 8. New folder

ZIP archives have no real empty directories in our model — `openedArchiveFromWorkspace` only produces file entries, and `buildMdzipNavTree` infers folders from paths. So:

- **New folder** creates an *ephemeral* folder node held in view state: `private pendingNewFolders: Set<string>` in `MdzipWorkspaceView`. `render()` merges these into the tree built by `buildMdzipNavTree` (insert empty `MdzipNavNode`s before rendering).
- The ephemeral folder is a normal context-menu/drop target, so "New folder → right-click it → New .md file" works; once a file exists inside, the path is real and the pending entry is dropped (prune any `pendingNewFolders` entry that now has at least one archive file under it, on every render).
- Pending folders are view-local: they don't dirty the workspace and vanish on reopen if left empty. Show them slightly dimmed (e.g. `opacity: 0.7`) to signal "not saved yet".
- (Check during implementation whether core-js `addFile` accepts a trailing-slash directory entry — `ArchiveEntry.isDirectory` exists in [archive-utils.ts:14](../../packages/editor/src/archive-utils.ts#L14) but is never set true. If real directory entries are cheap, prefer them; the ephemeral approach is the fallback and assumed default.)

### 9. Drag-and-drop

Two distinct behaviors, both gated like the menu (policy + editable + mdz):

**a) Internal move (tree → tree).** Set `draggable="true"` on file buttons. HTML5 DnD:
- `dragstart` on `[data-nav-path]` → `dataTransfer.setData('application/x-mdzip-path', path)`.
- `dragover`/`dragleave` on directory `<summary>`, the root blank area, and pending folders → highlight drop target (`.drag-over` class), `preventDefault()` to allow drop.
- `drop` → compute `newPath = targetDir + '/' + basename(oldPath)`; no-op if unchanged; collision → show error (reuse dialog or a transient message); otherwise `renameFile(oldPath, newPath)`. Entry point and manifest are not draggable.
- Auto-expand collapsed `<details>` after hovering ~700 ms (nice-to-have; skip if it drags the first pass out).

**b) External files (OS → pane).** `dragover`/`drop` on `elNavPane` accepting `DataTransfer.files`:
- Drop on a folder → that directory; blank area → root.
- For each file: validate name, reject duplicates (or auto-suffix `-2` — decide at implementation; auto-suffix matches the pasted-image precedent `nextPastedImagePath`), then `workspace.addAsset(dir + name, bytes)`.
- Reuse the existing image-paste byte-reading utilities where possible.

Internal DnD depends on `renameFile` (section 7); external drop only needs `addAsset` and can land independently.

### 10. Copy markdown link / image embed

View-level only — no workspace changes. Build the relative path from the *current* document to the target with `relativeMarkdownAssetPath` (already used by image paste, [workspace.ts:472](../../packages/editor/src/workspace.ts#L472)); fall back to the archive-root path when no document is open. Images copy `![<basename>](rel/path)`, everything else copies `[<basename>](rel/path)`. Write via `navigator.clipboard.writeText` in a try/catch routed to `options.onFailed` — clipboard access can be denied in embedded webviews. (A separate "Copy archive path" item is subsumed by this; skip it.)

### 11. Replace file…

`workspace.replaceAsset(archivePath, bytes)` **already exists** ([workspace.ts:395](../../packages/editor/src/workspace.ts#L395)). The menu item opens a hidden file input (same pattern as `elImageInput` for image insert), reads the picked file's bytes, and calls `replaceAsset`. Keep the original archive path regardless of the picked file's name; no extension check beyond a soft warning if the extension changes (content-type mismatch is the user's call). Assets only — documents are edited in place.

### 12. Download

`readPathBytes(path)` → `new Blob([bytes])` → temporary `<a download="<basename>" href="blob:…">` click, then revoke the object URL. Works in plain browsers; embedded hosts (VS Code webview) may block anchor downloads — if so the existing `onFailed` surface reports it, and a host-callback escape hatch (`onDownloadRequested?`) can be added later if a real host needs it. Available on every file including the manifest.

### 13. Set as cover image / Remove cover image

The manifest already has an editable `cover` field (`MdzManifestEditableMetadata.cover` in core-js). New workspace method mirroring `setManifestTitle` ([workspace.ts:508](../../packages/editor/src/workspace.ts#L508)):

```ts
public async setCoverImage(archivePath: string | null): Promise<boolean>
```

Guards: editable, mdz, and when non-null the path must be an existing image asset. `updateManifest(manifest, { cover: path })`, reserialize/reload, `dirty`, emit `edit ['manifest']`. The menu shows **Set as cover image** normally and **Remove cover image** when `manifest.cover` already resolves to this file. Optional nice-to-have: a small badge or tooltip suffix on the current cover in the nav tree (mirror the entry-point treatment, e.g. a subtle icon rather than bold).

### 14. Duplicate

View-level: `readPathBytes(oldPath)` → `addAsset(suffixedPath, bytes)` → `openPath(newPath)`. Suffix rule: insert `-2` (then `-3`, …) before the extension until the path is free, matching the `nextPastedImagePath` precedent. Duplicating a `.md` relies on the same reload round-trip as New .md file (section 3) to land it in `documents`. Duplicating the entry point is allowed — the copy is a regular document.

### 15. Control policy

Add `fileActions?: boolean` to `MdzipControlPolicy` (resolved: `fileActions: boolean`), defaulting per preset alongside `orphanActions` (view.ts:290–337): `false` for viewer-ish presets, `true` where `orphanActions: true`. Gate all *mutating* menu items and DnD on it; Copy/Download ride on the menu being present at all (nav shown + mdz source). Update `control-policy.test.ts`.

### 16. Host hook: `onConversionRequested`

All three conversion triggers already funnel through one method, `requestMdzConversion(action)` ([view.ts:1637](../../packages/editor/src/view.ts#L1637)), with action kinds `'navigation'` (nav button on a plain `.md`), `'image-picker'` (Insert Image toolbar button), and `'image-file'` (an image File already in hand — paste/drop). New option on `MdzipWorkspaceViewOptions`:

```ts
onConversionRequested?: (action: { kind: 'navigation' | 'image-picker' | 'image-file'; file?: File })
  => boolean | Promise<boolean>;
```

Semantics:

- Called by `requestMdzConversion` *after* its existing guards (editable, `sourceFormat === 'markdown'`), *before* opening the built-in dialog.
- Return/resolve `true` → the host owns the flow; the editor does nothing further (no dialog). The host typically converts the document its own way and reloads/reopens the editor.
- Return/resolve `false` (or hook absent) → built-in conversion dialog proceeds as today.
- Hook throws/rejects → report via `options.onFailed` and fall back to the built-in dialog (fail open, so the user isn't stranded).
- While a returned promise is pending, don't open the dialog and ignore duplicate `requestMdzConversion` calls (a simple in-flight flag).

Implementation notes:

- `requestMdzConversion` becomes async-tolerant: `void`-returning wrapper that awaits the hook then conditionally sets `conversionAction` + `render()`.
- Export the `MdzipConversionAction` union (currently a private type at [view.ts:117](../../packages/editor/src/view.ts#L117)) so hosts can type the parameter; the hook signature above matches it shape-wise (`file` optional covers all three kinds).
- Wrappers enumerate callbacks explicitly (e.g. [editor-react/src/index.tsx:43](../../packages/editor-react/src/index.tsx#L43)), so add the prop to all three wrappers and their READMEs.
- This directly removes the VS Code extension's capture-phase paste workaround documented in [mdzip-editor-improvements.md](mdzip-editor-improvements.md) §1a — with the hook, the host intercepts `'image-file'` conversions cleanly.

### 17. CSS

Rename/extend `.orphan-context-menu` styles (view-css.ts:621–648, plus the media query at 1314) to `.nav-context-menu`; multi-item support is already there (`button:hover/:focus-visible`). Add: `.nav-file.entry-point` bold label; `.drag-over` drop-target highlight; pending-folder dimming; menu separator rule (groups per the section-1 table: entry-point+cover / copy / rename+duplicate+replace / download / delete).

## Files to change

| File | Change |
|---|---|
| [packages/editor/src/workspace.ts](../../packages/editor/src/workspace.ts) | `removeFile()` (documents + assets), `setEntryPoint()`, `renameFile()` + reference rewriting, `setCoverImage()`; verify `.md`-via-`addAsset` round-trip |
| [packages/editor/src/view.ts](../../packages/editor/src/view.ts) | `data-nav-dir` on directories; generalize menu markup/state/open/render; contextmenu handler; new-file + rename dialogs; delete-confirm dialog; entry-point class; pending folders; DnD handlers; copy-link, replace (file input), download, duplicate actions; `onConversionRequested` option + export `MdzipConversionAction`; control-policy gating |
| [packages/editor/src/view-css.ts](../../packages/editor/src/view-css.ts) | menu rename + separators; entry-point bold; cover badge; drag-over + pending-folder styles; dialog styles (reuse title-dialog classes if possible) |
| [packages/editor/src/control-policy.test.ts](../../packages/editor/src/control-policy.test.ts) | `fileActions` flag + preset defaults |
| [packages/editor/tests/workspace.test.mjs](../../packages/editor/tests/workspace.test.mjs) | add-`.md`-becomes-document round-trip; `removeFile` on document/asset/entry/manifest; `setEntryPoint` (manifest patch, orphan recompute, old entry demoted); `renameFile` (move, collision, entry-point rename, reference rewrite); `setCoverImage` (set, remove, non-image rejected) |
| Framework wrappers (react/vue/ng) | add `onConversionRequested` prop/input to all three; document it and `fileActions` in the three READMEs (`controls` itself passes through unchanged) |

## Suggested phasing

The scope is large; each phase is independently shippable:

1. **Menu skeleton + create/delete** — sections 1–4, 15, 17 (includes the `removeFile` documents fix).
2. **Entry point** — sections 5–6.
3. **Utility items** — sections 10–14 (copy link, replace, download, cover, duplicate). Mostly view-level; `setCoverImage` is the only workspace change.
4. **Rename/move + new folder + DnD** — sections 7–9 (rename's reference rewriting is the riskiest piece; external-file drop can land before internal moves).
5. **`onConversionRequested` hook** — section 16. Independent of the nav menu entirely; can ship first or alongside any phase (it unblocks the VS Code extension's paste workaround removal).

## Test plan

- Unit: control-policy resolution for `fileActions`; workspace methods listed in the table above.
- Hook: `onConversionRequested` returning `true` suppresses the dialog for all three action kinds (`'image-file'` carries the `File`); `false`/absent shows it; rejection routes to `onFailed` then shows it; pending promise blocks duplicate triggers.
- Manual (demo app): right-click folder → new file inside it; blank area → file at root; duplicate-name rejected; delete referenced asset → prompt → gone, preview tolerates dangling ref; delete orphan → no prompt; delete non-entry `.md` works; entry markdown & manifest → no delete item; set entry point → bold marker moves, orphan badges recompute, save round-trips (reopen shows new entry); rename file → links rewritten (or warned); rename-as-move via path edit; new folder → create file inside → folder persists after save/reopen; drag file into folder → moved; drag OS image onto pane → added; copy markdown link from a nested doc → relative path correct; replace image asset → preview updates; download asset → bytes match; set cover → manifest round-trips, "Remove cover image" appears; duplicate entry point → copy is a regular doc; read-only mode → only Copy/Download offered; `sourceFormat: 'markdown'` → no menu, no DnD.

## Out of scope

- Undo for deletes/renames (archive rebuild makes this non-trivial; `dirty` flag + host save flow is the safety net).
- Multi-select operations.
- Renaming/moving whole folders (rename applies to files; folder rename = future work building on `renameFile` batching).
