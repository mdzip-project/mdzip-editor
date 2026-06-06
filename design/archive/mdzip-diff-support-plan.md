# MDZip Diff Support Plan

## Goal

Add reusable archive-diff support to `@mdzip/editor` so host applications can compare `.mdz` files by their semantic contents instead of raw ZIP bytes.

The VS Code extension can provide the diff UI, but `@mdzip/editor` should own reusable logic for extracting canonical document text, producing stable archive inventories, and summarizing archive-level changes.

## Non-Goals

- Do not implement VS Code commands or `vscode.diff` integration in `@mdzip/editor`.
- Do not build a full visual diff UI in the editor package for the first milestone.
- Do not expose raw ZIP internals as the primary comparison model.

## Phase 1: Lightweight Canonical Markdown Extraction

Add an API that reads only the resolved entry point markdown.

```ts
export interface CanonicalMarkdownReadResult {
  entryPoint: string;
  markdown: string;
  manifest: MdzManifest | null;
}

export async function readCanonicalMarkdown(
  bytes: Uint8Array
): Promise<CanonicalMarkdownReadResult>;
```

Why:

- `openMdzArchive` currently does more than a diff view needs, including image data URI generation, orphaned asset checks, and validation.
- Diff callers need a fast, focused way to get the text users expect to compare.
- This API is useful for VS Code, web previews, CLIs, tests, and agent workflows.

Implementation notes:

1. Open the archive with `MdzArchiveCore.open`.
2. Resolve the entry point with the existing archive entry point logic.
3. Read the manifest if available.
4. Read the resolved entry point as text.
5. Return the entry point path, markdown, and manifest.

## Phase 2: Archive Inventory API

Add a stable inventory representation for archive entries.

```ts
export type ArchiveInventoryEntryKind =
  | 'markdown'
  | 'manifest'
  | 'image'
  | 'file';

export interface ArchiveInventoryEntry {
  path: string;
  kind: ArchiveInventoryEntryKind;
  size: number;
  hash: string;
}

export interface ArchiveInventory {
  entries: ArchiveInventoryEntry[];
  entryPoint: string;
  manifest: MdzManifest | null;
}

export async function createArchiveInventory(
  bytes: Uint8Array
): Promise<ArchiveInventory>;
```

Why:

- A meaningful `.mdz` package diff needs to show added, removed, and changed entries.
- Binary assets should be summarized by path, size, and content hash, not rendered as byte-level text.
- The output should be deterministic so host apps can render predictable diffs.

Implementation notes:

1. Exclude directory entries.
2. Normalize paths to archive-relative POSIX-style paths.
3. Sort entries lexicographically by path.
4. Classify `manifest.json` specially.
5. Classify markdown and image entries using existing metadata from `MdzArchiveCore`.
6. Hash bytes using a stable algorithm such as SHA-256.

## Phase 3: Inventory Diff API

Add a structured diff between two inventories.

```ts
export type ArchiveInventoryDiffStatus =
  | 'added'
  | 'removed'
  | 'changed'
  | 'unchanged';

export interface ArchiveInventoryDiffEntry {
  path: string;
  status: ArchiveInventoryDiffStatus;
  kind: ArchiveInventoryEntryKind;
  before?: ArchiveInventoryEntry;
  after?: ArchiveInventoryEntry;
}

export interface ArchiveInventoryDiff {
  entries: ArchiveInventoryDiffEntry[];
  changedCount: number;
  addedCount: number;
  removedCount: number;
}

export function diffArchiveInventories(
  before: ArchiveInventory,
  after: ArchiveInventory
): ArchiveInventoryDiff;
```

Why:

- Host apps should not duplicate path matching, status classification, and count logic.
- A structured diff can support multiple renderers: plain text, web UI, VS Code virtual documents, or MCP responses.

Implementation notes:

1. Match entries by normalized path.
2. Mark missing-before paths as `added`.
3. Mark missing-after paths as `removed`.
4. Mark matching paths with different hashes as `changed`.
5. Preserve unchanged entries optionally, but make it easy for renderers to omit them.

## Phase 4: Plain-Text Summary Renderer

Add a renderer for host apps that want to pass readable text to a native diff tool.

```ts
export interface RenderArchiveDiffSummaryOptions {
  includeUnchanged?: boolean;
  includeSizes?: boolean;
}

export function renderArchiveInventorySummary(
  inventory: ArchiveInventory,
  options?: RenderArchiveDiffSummaryOptions
): string;

export function renderArchiveDiffSummary(
  diff: ArchiveInventoryDiff,
  options?: RenderArchiveDiffSummaryOptions
): string;
```

Example output:

```text
Manifest
~ manifest.json

Markdown
~ index.md

Assets
+ images/new-diagram.png
- images/old-diagram.png
~ images/changed-image.png
```

Why:

- VS Code can feed these summaries into `vscode.diff`.
- CLI and MCP tools can display the same content without inventing their own formatting.
- Snapshot tests can verify summary output easily.

## Phase 5: High-Level Archive Diff Helper

Add a convenience API that compares two archive byte arrays.

```ts
export interface MdzArchiveDiff {
  before: ArchiveInventory;
  after: ArchiveInventory;
  inventoryDiff: ArchiveInventoryDiff;
  beforeMarkdown: CanonicalMarkdownReadResult;
  afterMarkdown: CanonicalMarkdownReadResult;
}

export async function compareMdzArchives(
  beforeBytes: Uint8Array,
  afterBytes: Uint8Array
): Promise<MdzArchiveDiff>;
```

Why:

- Reduces repeated async setup in host apps.
- Gives VS Code, web, CLI, and MCP integrations a single semantic comparison entry point.
- Keeps archive comparison behavior consistent across contexts.

## Phase 6: Tests

Add focused tests for:

1. Reading canonical markdown from a normal archive.
2. Reading canonical markdown when the manifest entry point differs from `index.md`.
3. Inventory sorting and classification.
4. Added, removed, changed, and unchanged inventory entries.
5. Binary image changes using hashes.
6. Stable plain-text summary output.
7. Malformed or incomplete archives, matching current archive error behavior.

## Recommended First Milestone

Implement:

1. `readCanonicalMarkdown`.
2. `createArchiveInventory`.
3. `diffArchiveInventories`.

Then implement the plain-text renderers once the VS Code extension starts consuming the structured APIs.

## Downstream Consumers

Expected consumers include:

- `mdzip-vscode` native diff commands.
- Future web editor compare/review views.
- CLI tools that compare `.mdz` archives.
- MCP tools that summarize proposed archive edits.
- Tests that need stable archive comparison assertions.
