# Migration Notes

This repository starts by extracting reusable MDZip workspace behavior from `mdzip-vscode`.

## Extracted First

* Archive helpers from `src/mdzArchiveUtils.ts`
* Document/workspace state from `src/mdzDocument.ts`
* Metadata helpers from `src/shared/editorMetadata.ts`

## Remains In `mdzip-vscode`

* VS Code activation and command wiring
* Custom editor provider integration
* VS Code file system, webview, dialog, and notification APIs
* MCP server integration

## Future Path

Once `@mdzip/editor` and `@mdzip/editor-ng` stabilize, `mdzip-vscode` can migrate its custom editor provider to use `@mdzip/editor` as the document/workspace engine.

