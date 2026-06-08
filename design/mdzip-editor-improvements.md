# @mdzip/editor — Improvement Requests

Three categories of improvements are requested based on VS Code extension integration experience: paste behaviour fixes, documentation for human developers, and documentation for AI agents.

---

## 1. Paste behaviour fixes

### 1a. Image paste in a markdown source file does not trigger the conversion dialog

**Current behaviour**

`MdzipWorkspaceView.handlePaste()` is entered whenever a paste event carries an image and `currentPathType` is `'markdown'`. It calls `insertImageBytes()` → `workspace.pasteImage()`, which immediately returns `null` for `sourceFormat === 'markdown'`. Nothing visible happens — the paste is silently discarded.

**Expected behaviour**

Pasting an image into a markdown source file should trigger the same "Convert to .mdz?" dialog that the toolbar's Insert Image button triggers. Today that dialog is wired only through `executeCommand('insert-image')`, not through the paste path.

**Suggested fix in `view.ts`**

In `handlePaste`, check the source format before calling `insertImageBytes`:

```ts
async handlePaste(event: ClipboardEvent) {
    const snapshot = this.workspace?.snapshot();
    if (!snapshot || snapshot.mode === 'read-only' || snapshot.currentPathType !== 'markdown') {
        return;
    }
    try {
        const image = await readBrowserClipboardImage(event.clipboardData);
        if (!image || !this.cmEditor) { return; }

        // For markdown source, delegate to the conversion dialog instead of
        // silently discarding the paste.
        if (this.workspace?.sourceFormat === 'markdown') {
            const file = new File(
                [image.bytes],
                `pasted.${extensionForMime(image.mimeType)}`,
                { type: image.mimeType }
            );
            this.requestMdzConversion({ kind: 'image-file', file });
            return;
        }

        await this.insertImageBytes(image.bytes, image.mimeType);
    } catch (error) {
        this.options.onFailed?.(error);
    }
}
```

**Current workaround in the VS Code extension**

A capture-phase `paste` listener in `webviewEditor.ts` intercepts image pastes for markdown mode and calls `editor.executeCommand('insert-image', file)`. This should not be necessary.

---

### 1b. Redundant ZIP rebuild in `exportBytes()` after `pasteImage()`

**Current behaviour**

`pasteImage()` does two expensive operations back-to-back:

1. `serializeWorkspaceBytes()` — DEFLATE-compresses all assets to build a new ZIP (rebuild #1).
2. `reloadPreservingCurrentText(bytes)` — sets `this.archiveBytes = bytes` and re-parses the ZIP.

Immediately after, `notifyChanged` fires, which calls `exportBytes()` → `archiveBytesWithPendingText()`. Because `currentPathType` is `'markdown'` (an editable text path), this calls `serializeWorkspaceBytes()` again — rebuild #2. Rebuild #2 produces an identical result to `archiveBytes` that was just set. For a document with several images this adds a second full pako.js DEFLATE pass in the browser, doubling paste latency.

**Suggested fix in `workspace.ts`**

Track whether the in-memory workspace has diverged from `archiveBytes` since the last serialisation. Reset the flag inside `reloadPreservingCurrentText`; set it inside `commitPendingTextToWorkspace` only when the text actually changes:

```ts
async archiveBytesWithPendingText(): Promise<Uint8Array> {
    if (!isEditableTextPath(this.currentPathTypeValue, this.currentPathValue)) {
        return this.archiveBytes;
    }
    if (!this.pendingTextDirty) {
        return this.archiveBytes; // archiveBytes is already current, skip rebuild
    }
    this.commitPendingTextToWorkspace();
    return this.serializeWorkspaceBytes();
}
```

---

## 2. JSDoc on key `.d.ts` declarations

The package ships no TypeScript source — only compiled `.js` and `.d.ts` files. The `.d.ts` files currently have no JSDoc comments at all, so any developer or tool reading them gets bare type signatures with no behavioural context.

**How to fix**: add JSDoc to the TypeScript source files. The TypeScript compiler preserves JSDoc comments in generated `.d.ts` output automatically (it also preserves them in `.js` output unless `removeComments: true` is set, which is common for minified builds — but `.d.ts` comments are always preserved regardless of that flag). Manually editing the `.d.ts` files is not the right approach.

### `open` vs `openWorkspace` (in `view.ts`)

```ts
/**
 * Opens an `.mdz` archive or Markdown file from raw bytes.
 *
 * Parses the ZIP and resolves all assets in the browser. For large archives
 * this can take several seconds. Prefer {@link openWorkspace} when the host
 * has already parsed the archive on the native side.
 */
open(bytes: Uint8Array, options?: MdzipWorkspaceOpenOptions): Promise<void>;

/**
 * Opens a pre-parsed `MdzWorkspace` without rebuilding the archive.
 *
 * Use this when the host (e.g. a VS Code extension) has already called
 * `MdzipWorkspaceService.open()` on the native side and can pass the workspace
 * object directly. Significantly faster than {@link open} for large archives
 * because no ZIP parsing or asset decompression occurs in the browser.
 *
 * Assets must expose either `readDataUri` or `readBytes` so that subsequent
 * ZIP rebuilds (e.g. on paste or asset removal) can read their bytes.
 * Fields present at runtime but absent from the TypeScript interface —
 * `validation`, `orphanedAssets`, and `asset.kind` — must be preserved on the
 * workspace object or operations that depend on them will fail.
 */
openWorkspace(workspace: MdzWorkspace, options?: MdzipWorkspaceOpenOptions): Promise<void>;
```

### `pasteImage` (in `workspace.ts`)

```ts
/**
 * Embeds a pasted image into the current `.mdz` document and rebuilds the archive.
 *
 * Returns `null` — without throwing — when `sourceFormat` is `'markdown'`.
 * Markdown source files do not support embedded images; hosts should intercept
 * paste events and call `executeCommand('insert-image')` to show the MDZ
 * conversion dialog instead.
 *
 * Note: this method always calls `serializeWorkspaceBytes()` (full ZIP rebuild)
 * regardless of the existing archive state. For large documents this can take
 * several hundred milliseconds in the browser.
 */
pasteImage(options: MdzipPasteImageOptions): Promise<MdzipPasteImageResult | null>;
```

### `snapshot().workspace` runtime shape (in `workspace.ts`, on `MdzipWorkspaceSnapshot`)

```ts
/**
 * The underlying `MdzWorkspace` object.
 *
 * The runtime object carries additional fields beyond what the TypeScript type
 * declares: `validation` (required by `getValidationStatus`),
 * `orphanedAssets` (used for orphan detection), and `asset.kind` on each
 * asset entry. If you serialise and re-hydrate this object, spread the full
 * runtime value rather than reconstructing it from declared fields only, or
 * these operations will fail with runtime errors.
 */
workspace: MdzWorkspace;
```

---

## 3. `AGENTS.md` for AI coding agents

Most AI agent frameworks (Claude Code, Copilot, Cursor, etc.) look for an `AGENTS.md` or `CLAUDE.md` file at the root of a repository or package before exploring source files. Adding one to the package root is the most reliable way to surface key behavioural facts before an agent spends time tracing through `.js` source.

The JSDoc additions above cover the most important points at the point of discovery (the `.d.ts` files). `AGENTS.md` is a belt-and-suspenders measure for agents that scan directory structure first.

**Suggested content for `AGENTS.md`**:

```markdown
# Notes for AI Agents

Read `README.md` before looking at source or type files.

## Key facts that are easy to miss

**`open()` vs `openWorkspace()`**
`open(bytes)` parses the ZIP archive in the browser and is slow for large files.
`openWorkspace(workspace)` skips the parse entirely. Use it when the host has
already parsed the archive on the native side.

**Paste in markdown source files**
`workspace.pasteImage()` returns `null` for `sourceFormat === 'markdown'` — it
does not throw. The paste event handler does not automatically show the
conversion dialog; the host must call `executeCommand('insert-image')` to do so.

**`MdzWorkspace` runtime shape**
The runtime workspace object has fields not in the TypeScript type:
`validation`, `orphanedAssets`, and `asset.kind`. Serialise by spreading the
full runtime value, not just declared fields.

**VS Code preset**
Use `controls: { preset: 'hosted-editor' }` for VS Code and other native hosts.
```

---

## Summary

| Item | Location | Effort |
|---|---|---|
| Fix markdown paste triggering conversion dialog | `view.ts` `handlePaste` | Small |
| Eliminate redundant ZIP rebuild on paste | `workspace.ts` `archiveBytesWithPendingText` | Small |
| JSDoc on `open` / `openWorkspace` | `view.ts` | Trivial |
| JSDoc on `pasteImage` | `workspace.ts` | Trivial |
| JSDoc on `snapshot().workspace` runtime shape | `workspace.ts` | Trivial |
| `AGENTS.md` at package root | New file | Trivial |
