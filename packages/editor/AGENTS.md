# Notes for AI Agents

Read `README.md` before looking at source or type files.

## Key facts that are easy to miss

**`open()` vs `openWorkspace()`**

`open(bytes)` parses the ZIP archive in the browser and is slow for large files.
`openWorkspace(workspace)` skips the parse entirely. Use it when the host has already parsed the archive on the native side.

**Paste in markdown source files**

`workspace.pasteImage()` returns `null` for `sourceFormat === 'markdown'` — it does not throw. The paste event handler automatically shows the conversion dialog by calling `executeCommand('insert-image')`.

**`MdzWorkspace` runtime shape**

The runtime workspace object has fields not in the TypeScript type: `validation`, `orphanedAssets`, and `asset.kind`. Serialise by spreading the full runtime value, not just declared fields.

**VS Code preset**

Use `controls: { preset: 'hosted-editor' }` for VS Code and other native hosts.

**Performance**

`archiveBytesWithPendingText()` skips redundant ZIP rebuilds when pending text has not changed. This optimization is critical for large documents during paste operations and similar workflows that trigger multiple rebuild cycles.

**Documents vs assets (since 1.3.0)**

Markdown files live in `workspace.documents`; everything else lives in `workspace.assets`. `removeAsset()` only removes assets — use `removeFile()` to delete either kind (it refuses the entry-point document and `manifest.json`). `renameFile()` also moves files and rewrites markdown references. `setEntryPoint()` and `setCoverImage()` update the manifest through `updateManifest`.

**Nav-pane file management gating (since 1.3.0)**

The context menu's mutating items and drag-and-drop are gated by the `fileActions` control-policy flag (true in `standalone-editor`/`hosted-editor`), not by `orphanActions`. Copy/Download items are non-mutating and appear even in read-only mode. Files are draggable whenever the workspace is editable — dragging onto the editor inserts a markdown link and does not require `fileActions`.

**`onConversionRequested` hook (since 1.3.0)**

Hosts intercept the markdown→MDZ conversion flow by returning/resolving `true` from `onConversionRequested(action)`. This replaces the old capture-phase paste workaround in VS Code-style hosts. A rejecting hook reports to `onFailed` and falls back to the built-in dialog.
