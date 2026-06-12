import { MdzArchiveCore, type MdzManifest } from '@mdzip/core-js';
import { isMdzipManifestPath } from './workspace-view.js';

export interface CanonicalMarkdownReadResult {
  entryPoint: string;
  markdown: string;
  manifest: MdzManifest | null;
}

export async function readCanonicalMarkdown(
  bytes: Uint8Array
): Promise<CanonicalMarkdownReadResult> {
  const archive = await MdzArchiveCore.open(bytes);
  const entryPoint = await archive.resolveEntryPoint();
  const manifest = await archive.readManifest();
  const markdown = await archive.readText(entryPoint);

  return { entryPoint, markdown, manifest };
}

export type ArchiveInventoryEntryKind = 'markdown' | 'manifest' | 'image' | 'file';

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
): Promise<ArchiveInventory> {
  const archive = await MdzArchiveCore.open(bytes);
  const entryPoint = await archive.resolveEntryPoint();
  const manifest = await archive.readManifest();
  const archiveEntries = archive.listEntries();

  const entries: ArchiveInventoryEntry[] = [];

  for (const entry of archiveEntries) {
    const entryBytes = await archive.readBytes(entry.path);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', entryBytes as BufferSource);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    let kind: ArchiveInventoryEntryKind = 'file';
    if (isMdzipManifestPath(entry.path)) {
      kind = 'manifest';
    } else if (entry.isMarkdown) {
      kind = 'markdown';
    } else if (entry.isImage) {
      kind = 'image';
    }

    entries.push({
      path: entry.path,
      kind,
      size: entryBytes.length,
      hash,
    });
  }

  return { entries, entryPoint, manifest };
}

export type ArchiveInventoryDiffStatus = 'added' | 'removed' | 'changed' | 'unchanged';

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
): ArchiveInventoryDiff {
  const beforeMap = new Map(before.entries.map(e => [e.path, e]));
  const seenPaths = new Set<string>();
  const entries: ArchiveInventoryDiffEntry[] = [];

  let addedCount = 0;
  let removedCount = 0;
  let changedCount = 0;

  // Walk after entries
  for (const afterEntry of after.entries) {
    seenPaths.add(afterEntry.path);
    const beforeEntry = beforeMap.get(afterEntry.path);

    if (!beforeEntry) {
      // Added
      entries.push({
        path: afterEntry.path,
        status: 'added',
        kind: afterEntry.kind,
        after: afterEntry,
      });
      addedCount++;
    } else if (beforeEntry.hash !== afterEntry.hash) {
      // Changed
      entries.push({
        path: afterEntry.path,
        status: 'changed',
        kind: afterEntry.kind,
        before: beforeEntry,
        after: afterEntry,
      });
      changedCount++;
    } else {
      // Unchanged
      entries.push({
        path: afterEntry.path,
        status: 'unchanged',
        kind: afterEntry.kind,
        before: beforeEntry,
        after: afterEntry,
      });
    }
  }

  // Walk before entries for removed
  for (const beforeEntry of before.entries) {
    if (!seenPaths.has(beforeEntry.path)) {
      entries.push({
        path: beforeEntry.path,
        status: 'removed',
        kind: beforeEntry.kind,
        before: beforeEntry,
      });
      removedCount++;
    }
  }

  // Sort by path
  entries.sort((a, b) => a.path.localeCompare(b.path));

  return { entries, changedCount, addedCount, removedCount };
}
