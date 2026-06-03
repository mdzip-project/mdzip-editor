import {
  MDZ_IMAGE_MIME_TYPES,
  MdzArchiveCore,
  MdzPackagerCore,
  type MdzArchiveEntryInfo,
  type MdzManifest,
  type MdzValidationResult
} from 'mdzip-core-js';

export interface ArchiveEntry {
  path: string;
  isMarkdown: boolean;
  isImage: boolean;
  isDirectory: boolean;
}

export interface OpenedArchive {
  paths: ArchiveEntry[];
  entryPoint: string;
  manifest: MdzManifest | null;
  markdownText: string;
  images: Map<string, string>;
  orphanedAssetPaths: string[];
  validation: MdzValidationResult;
}

export interface NewArchiveAsset {
  archivePath: string;
  fileBytes: Uint8Array;
}

export async function openMdzArchive(bytes: Uint8Array): Promise<OpenedArchive> {
  const archive = await MdzArchiveCore.open(bytes);
  const entryPoint = await archive.resolveEntryPoint();
  const manifest = await archive.readManifest();
  const validation = await archive.validate();

  const paths = archive
    .listEntries()
    .filter((entry) => !entry.isDirectory)
    .map(mapEntry);

  const markdownText = await archive.readText(entryPoint);
  const orphanedAssets = await archive.findOrphanedAssets({ entryPoint });

  const images = new Map<string, string>();
  for (const entry of paths) {
    if (entry.isImage) {
      images.set(entry.path, await archive.readDataUri(entry.path));
    }
  }

  return {
    paths,
    entryPoint,
    manifest,
    markdownText,
    images,
    orphanedAssetPaths: orphanedAssets.orphanedAssetPaths,
    validation
  };
}

export async function updateMarkdownInArchive(
  existingBytes: Uint8Array,
  entryPointPath: string,
  newMarkdown: string
): Promise<Uint8Array> {
  const result = await MdzArchiveCore.addFile(existingBytes, entryPointPath, newMarkdown);
  return blobToBytes(result.blob);
}

export async function updateBinaryInArchive(
  existingBytes: Uint8Array,
  archivePath: string,
  fileBytes: Uint8Array
): Promise<Uint8Array> {
  const result = await MdzArchiveCore.addFile(existingBytes, archivePath, fileBytes);
  return blobToBytes(result.blob);
}

export async function removeFilesFromArchive(
  existingBytes: Uint8Array,
  archivePaths: string[]
): Promise<Uint8Array> {
  const result = await MdzArchiveCore.removeFiles(existingBytes, archivePaths);
  return blobToBytes(result.blob);
}

export async function findOrphanedAssetPathsInArchive(
  existingBytes: Uint8Array,
  entryPoint?: string
): Promise<string[]> {
  const result = await MdzArchiveCore.findOrphanedAssets(
    existingBytes,
    entryPoint ? { entryPoint } : undefined
  );
  return result.orphanedAssetPaths;
}

export async function readBinaryFileFromArchive(
  existingBytes: Uint8Array,
  archivePath: string
): Promise<Uint8Array> {
  const archive = await MdzArchiveCore.open(existingBytes);
  try {
    return await archive.readBytes(archivePath);
  } catch {
    throw new Error(`Archive file "${archivePath}" not found.`);
  }
}

export async function readTextFileFromArchive(
  existingBytes: Uint8Array,
  archivePath: string
): Promise<string> {
  const archive = await MdzArchiveCore.open(existingBytes);
  try {
    return await archive.readText(archivePath);
  } catch {
    throw new Error(`Archive file "${archivePath}" not found.`);
  }
}

export async function buildNewArchive(markdownContent: string): Promise<Blob> {
  return buildNewArchiveWithTitle(markdownContent, 'document');
}

export async function buildNewArchiveWithTitle(
  markdownContent: string,
  title: string
): Promise<Blob> {
  const result = await MdzPackagerCore.buildArchive(
    [{ path: 'index.md', text: markdownContent }],
    'document',
    {
      createIndex: false,
      mapFiles: false,
      filters: MdzPackagerCore.DEFAULT_FILTERS,
      mode: 'document',
      entryPoint: 'index.md',
      title
    }
  );
  return result.blob;
}

export async function buildNewArchiveBytesWithTitle(
  markdownContent: string,
  title: string,
  assets: readonly NewArchiveAsset[] = []
): Promise<Uint8Array> {
  const blob = await buildNewArchiveWithTitle(markdownContent, title);
  let bytes = await blobToBytes(blob);

  for (const asset of assets) {
    bytes = await updateBinaryInArchive(bytes, asset.archivePath, asset.fileBytes);
  }

  return bytes;
}

export async function updateManifestTitleInArchive(
  existingBytes: Uint8Array,
  newTitle: string
): Promise<Uint8Array> {
  const archive = await MdzArchiveCore.open(existingBytes);
  const manifest = await archive.readManifest();
  if (!manifest) {
    throw new Error('Cannot set title: manifest.json is missing.');
  }

  const result = await MdzArchiveCore.addFile(
    existingBytes,
    'manifest.json',
    JSON.stringify({ ...manifest, title: newTitle }, null, 2)
  );
  return blobToBytes(result.blob);
}

export function isImagePath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ext in MDZ_IMAGE_MIME_TYPES;
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function mapEntry(entry: MdzArchiveEntryInfo): ArchiveEntry {
  return {
    path: entry.path,
    isMarkdown: entry.isMarkdown,
    isImage: entry.isImage,
    isDirectory: entry.isDirectory
  };
}

