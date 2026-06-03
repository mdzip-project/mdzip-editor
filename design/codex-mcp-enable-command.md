# MDZip VS Code: Enable Codex MCP Server

## Goal

Add a `mdzip-vscode` command that makes the bundled MDZip MCP server available to Codex.

Installing the VS Code extension currently makes the MCP server available to VS Code MCP surfaces through `vscode.lm.registerMcpServerDefinitionProvider(...)`, but Codex reads MCP servers from Codex config. Codex should not be expected to discover the VS Code MCP provider automatically.

## Proposed Command

```text
MDZip: Enable Codex MCP Server
```

Suggested command id:

```text
mdzip.enableCodexMcp
```

The command should write a Codex MCP config entry for the bundled server:

```toml
[mcp_servers.MDZip]
command = "node"
args = ["<absolute path to mdz-mcp-server.js>"]
```

The server path should resolve to the installed extension bundle:

```text
<extensionPath>/dist/mdz-mcp-server.js
```

This is the same bundled server currently used by the VS Code MCP provider.

## Config Targets

Support at least user-level Codex config:

```text
~/.codex/config.toml
```

Optionally support workspace-level config for trusted projects:

```text
<workspace>/.codex/config.toml
```

Recommended UX:

1. Ask whether to write user-level or workspace-level Codex config.
2. Default to user-level config.
3. If workspace-level is selected and no workspace folder is open, show a warning.
4. Create parent directories when missing.
5. Preserve unrelated existing config.
6. Upsert only the `[mcp_servers.MDZip]` table.

## Example User Config

```toml
[mcp_servers.MDZip]
command = "node"
args = ["F:\\Code\\1 Projects\\mdzip-project\\mdzip-vscode\\dist\\mdz-mcp-server.js"]
```

## User Message After Success

After writing config, show:

```text
Enabled MDZip MCP server for Codex. Restart Codex or open a new Codex session for the server to become available.
```

Codex loads MCP server configuration at startup, so the new server generally will not appear in an already-running Codex session.

## Related Existing Commands

Existing commands:

```text
MDZip: Copy MCP Server Config Snippet
MDZip: Enable Workspace MCP Server
MDZip: Enable User MCP Server
MDZip: Open MCP Server Status
```

The new command is different from the existing VS Code MCP commands because it targets Codex config rather than VS Code `mcp.json`.

## Available Tools Once Enabled

Codex should see the bundled server tools after restart:

```text
mdz_review_document
mdz_list_entries
mdz_read_text
mdz_read_image
mdz_read_markdown_embedded_images
upsert_canonical_document
```

For review tasks, agents should call `mdz_review_document` first with the `.mdz` archive path.

## Implementation Notes

Use the extension runtime path:

```typescript
const bundledServerPath = vscode.Uri.joinPath(
  context.extensionUri,
  'dist',
  'mdz-mcp-server.js'
).fsPath;
```

Then write:

```toml
[mcp_servers.MDZip]
command = "node"
args = ["..."]
```

Prefer a TOML parser/preserver if one is already acceptable as a dependency. If avoiding dependencies, a conservative implementation can:

1. Read existing `config.toml` as text.
2. Remove an existing `[mcp_servers.MDZip]` table block.
3. Append the generated block.
4. Leave all other config text unchanged.

Be careful not to rewrite unrelated Codex settings.

## Future Option

A future Codex plugin could bundle the MDZip MCP server definition directly. That would be the cleanest install-once Codex experience, but the VS Code command is the fastest bridge for users who already install `mdzip-vscode`.
