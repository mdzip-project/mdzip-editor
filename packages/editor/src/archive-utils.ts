import {
  MDZ_IMAGE_MIME_TYPES,
  MdzArchiveCore,
  MdzPackagerCore,
  type MdzManifest,
  type MdzValidationResult,
  type MdzWorkspace
} from '@mdzip/core-js';

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
  return openedArchiveFromWorkspace(await MdzArchiveCore.openWorkspace(bytes, {
    includeOrphanedAssetAnalysis: true
  }));
}

export async function openedArchiveFromWorkspace(workspace: MdzWorkspace): Promise<OpenedArchive> {
  const entryPoint = workspace.entryPoint
    ?? workspace.documents.find((document) => document.isEntryPoint)?.path
    ?? workspace.documents[0]?.path
    ?? 'index.md';
  const markdownText = workspace.documents.find(
    (document) => document.path.toLowerCase() === entryPoint.toLowerCase()
  )?.text ?? '';
  const paths = [
    ...workspace.documents.map((document): ArchiveEntry => ({
      path: document.path,
      isMarkdown: true,
      isImage: false,
      isDirectory: false
    })),
    ...(workspace.manifest ? [{
      path: 'manifest.json',
      isMarkdown: false,
      isImage: false,
      isDirectory: false
    }] : []),
    ...workspace.assets.map((asset): ArchiveEntry => ({
      path: asset.path,
      isMarkdown: false,
      isImage: asset.kind === 'image',
      isDirectory: false
    }))
  ].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
  const images = new Map<string, string>();
  for (const asset of workspace.assets) {
    if (asset.kind !== 'image') {
      continue;
    }
    if (asset.readDataUri) {
      images.set(asset.path, await asset.readDataUri());
      continue;
    }
    const bytes = asset.bytes
      ? await binarySourceToBytes(asset.bytes)
      : await asset.readBytes?.();
    if (bytes) {
      images.set(asset.path, `data:${asset.mimeType};base64,${bytesToBase64(bytes)}`);
    }
  }

  return {
    paths,
    entryPoint,
    manifest: workspace.manifest,
    markdownText,
    images,
    orphanedAssetPaths: workspace.orphanedAssets?.orphanedAssetPaths ?? [],
    validation: workspace.validation
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

async function binarySourceToBytes(source: ArrayBuffer | Uint8Array | Blob): Promise<Uint8Array> {
  if (source instanceof Uint8Array) {
    return source;
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  return blobToBytes(source);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
