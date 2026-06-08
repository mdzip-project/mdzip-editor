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
