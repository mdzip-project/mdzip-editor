import type { MdzWorkspaceAsset } from '@mdzip/core-js';
import type { MdzipWorkspaceService } from './workspace.js';

export interface MdzipAssetCacheEntry {
  bytes: Uint8Array;
  mimeType: string;
}

export interface MdzipAssetCache {
  get(contentKey: string): Promise<MdzipAssetCacheEntry | undefined>;
  set(contentKey: string, entry: MdzipAssetCacheEntry): Promise<void>;
  getReference(referenceKey: string): Promise<string | undefined>;
  setReference(referenceKey: string, contentKey: string): Promise<void>;
}

export interface MdzipIndexedDbAssetCacheOptions {
  databaseName?: string;
  maxBytes?: number;
  maxEntries?: number;
  maxAgeMs?: number;
}

interface StoredAsset {
  key: string;
  bytes: ArrayBuffer;
  mimeType: string;
  size: number;
  accessedAt: number;
}

export class MdzipIndexedDbAssetCache implements MdzipAssetCache {
  private readonly databaseName: string;
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  private readonly maxAgeMs: number;
  private databasePromise: Promise<IDBDatabase> | null = null;

  public constructor(options: MdzipIndexedDbAssetCacheOptions = {}) {
    this.databaseName = options.databaseName ?? 'mdzip-asset-cache';
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    this.maxEntries = options.maxEntries ?? 512;
    this.maxAgeMs = options.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000;
  }

  public async get(contentKey: string): Promise<MdzipAssetCacheEntry | undefined> {
    const db = await this.database();
    const stored = await request<StoredAsset | undefined>(
      db.transaction('assets', 'readonly').objectStore('assets').get(contentKey)
    );
    if (!stored) return undefined;
    if (Date.now() - stored.accessedAt > this.maxAgeMs) {
      await this.deleteAsset(contentKey);
      return undefined;
    }
    stored.accessedAt = Date.now();
    void this.putStored(stored).catch(() => undefined);
    return { bytes: new Uint8Array(stored.bytes), mimeType: stored.mimeType };
  }

  public async set(contentKey: string, entry: MdzipAssetCacheEntry): Promise<void> {
    const bytes = entry.bytes.slice().buffer;
    await this.putStored({
      key: contentKey,
      bytes,
      mimeType: entry.mimeType,
      size: bytes.byteLength,
      accessedAt: Date.now()
    });
    await this.prune();
  }

  public async getReference(referenceKey: string): Promise<string | undefined> {
    const db = await this.database();
    return request<string | undefined>(
      db.transaction('references', 'readonly').objectStore('references').get(referenceKey)
    );
  }

  public async setReference(referenceKey: string, contentKey: string): Promise<void> {
    const db = await this.database();
    const transaction = db.transaction('references', 'readwrite');
    transaction.objectStore('references').put(contentKey, referenceKey);
    await transactionDone(transaction);
  }

  private async database(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is unavailable.');
    }
    this.databasePromise ??= new Promise((resolve, reject) => {
      const open = indexedDB.open(this.databaseName, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains('assets')) {
          open.result.createObjectStore('assets', { keyPath: 'key' });
        }
        if (!open.result.objectStoreNames.contains('references')) {
          open.result.createObjectStore('references');
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('Could not open the asset cache.'));
    });
    return this.databasePromise;
  }

  private async putStored(stored: StoredAsset): Promise<void> {
    const db = await this.database();
    const transaction = db.transaction('assets', 'readwrite');
    transaction.objectStore('assets').put(stored);
    await transactionDone(transaction);
  }

  private async deleteAsset(contentKey: string): Promise<void> {
    const db = await this.database();
    const transaction = db.transaction('assets', 'readwrite');
    transaction.objectStore('assets').delete(contentKey);
    await transactionDone(transaction);
  }

  private async prune(): Promise<void> {
    const db = await this.database();
    const entries = await request<StoredAsset[]>(
      db.transaction('assets', 'readonly').objectStore('assets').getAll()
    );
    entries.sort((a, b) => b.accessedAt - a.accessedAt);
    let totalBytes = 0;
    const removals: string[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      totalBytes += entry.size;
      if (index >= this.maxEntries || totalBytes > this.maxBytes || Date.now() - entry.accessedAt > this.maxAgeMs) {
        removals.push(entry.key);
      }
    }
    if (!removals.length) return;
    const transaction = db.transaction('assets', 'readwrite');
    const store = transaction.objectStore('assets');
    for (const key of removals) store.delete(key);
    await transactionDone(transaction);
  }
}

export interface MdzipAssetSessionOptions {
  cache?: MdzipAssetCache;
  sourceId?: string | (() => Promise<string>);
  onFailed?: (error: unknown) => void;
}

export interface MdzipResolvedImage {
  url: string;
  /** Intrinsic pixel width, when it could be sniffed from the image bytes. */
  width?: number;
  /** Intrinsic pixel height, when it could be sniffed from the image bytes. */
  height?: number;
}

export class MdzipAssetSession {
  private readonly urls = new Map<string, string>();
  private readonly sizes = new Map<string, { width: number; height: number }>();
  private readonly pending = new Map<string, Promise<string | undefined>>();
  private sourceIdPromise: Promise<string> | null = null;
  private destroyed = false;

  public constructor(
    private readonly workspace: MdzipWorkspaceService,
    private readonly assets: readonly MdzWorkspaceAsset[],
    private readonly ownerDocument: Document,
    private readonly options: MdzipAssetSessionOptions = {}
  ) {}

  public resolveKnown(path: string, currentPath: string): string | undefined {
    const assetPath = resolveAssetPath(path, currentPath, this.assets);
    return assetPath ? this.urls.get(assetPath.toLowerCase()) : undefined;
  }

  public async resolve(path: string, currentPath: string): Promise<string | undefined> {
    if (this.destroyed) return undefined;
    const assetPath = resolveAssetPath(path, currentPath, this.assets);
    if (!assetPath) return undefined;
    const key = assetPath.toLowerCase();
    const existing = this.urls.get(key);
    if (existing) return existing;
    const active = this.pending.get(key);
    if (active) return active;
    const pending = this.resolveAsset(assetPath).finally(() => this.pending.delete(key));
    this.pending.set(key, pending);
    return pending;
  }

  /**
   * Resolves an image to its URL plus, when sniffable from the bytes, its
   * intrinsic dimensions — enabling progressive hydration that reserves layout
   * space before the image visually loads.
   */
  public async resolveImage(path: string, currentPath: string): Promise<MdzipResolvedImage | undefined> {
    const url = await this.resolve(path, currentPath);
    if (!url) return undefined;
    const assetPath = resolveAssetPath(path, currentPath, this.assets);
    const size = assetPath ? this.sizes.get(assetPath.toLowerCase()) : undefined;
    return size ? { url, width: size.width, height: size.height } : { url };
  }

  public async rewriteHtml(html: string, currentPath: string, signal: AbortSignal): Promise<string> {
    const template = this.ownerDocument.createElement('template');
    template.innerHTML = html;
    const images = Array.from(template.content.querySelectorAll<HTMLImageElement>('img[src]'));
    await Promise.all(images.map(async (image) => {
      const source = image.getAttribute('src');
      if (!source) return;
      const resolved = await this.resolve(source, currentPath);
      if (!signal.aborted && resolved) image.setAttribute('src', resolved);
    }));
    if (signal.aborted) throw new DOMException('Rendering aborted.', 'AbortError');
    return template.innerHTML;
  }

  public destroy(): void {
    this.destroyed = true;
    const urlApi = this.ownerDocument.defaultView?.URL;
    if (urlApi?.revokeObjectURL) {
      for (const url of this.urls.values()) {
        if (url.startsWith('blob:')) urlApi.revokeObjectURL(url);
      }
    }
    this.urls.clear();
    this.sizes.clear();
    this.pending.clear();
  }

  private async resolveAsset(assetPath: string): Promise<string | undefined> {
    const asset = this.assets.find((item) => item.path.toLowerCase() === assetPath.toLowerCase());
    if (!asset) return undefined;
    let loadedBytes: Uint8Array | undefined;
    try {
      const referenceKey = await this.referenceKey(asset.path);
      if (this.options.cache && referenceKey) {
        const contentKey = await this.options.cache.getReference(referenceKey);
        if (contentKey) {
          const cached = await this.options.cache.get(contentKey);
          if (cached) return this.storeUrl(asset.path, cached.bytes, cached.mimeType);
        }
      }

      loadedBytes = await this.workspace.readPathBytes(asset.path);
      if (!loadedBytes) return undefined;
      if (this.options.cache) {
        const contentKey = await contentAddress(loadedBytes, asset.mimeType);
        await this.options.cache.set(contentKey, { bytes: loadedBytes, mimeType: asset.mimeType });
        if (referenceKey) await this.options.cache.setReference(referenceKey, contentKey);
      }
      return this.storeUrl(asset.path, loadedBytes, asset.mimeType);
    } catch (error) {
      this.options.onFailed?.(error);
      const bytes = loadedBytes ?? await this.workspace.readPathBytes(asset.path).catch(() => undefined);
      return bytes ? this.storeUrl(asset.path, bytes, asset.mimeType) : undefined;
    }
  }

  private storeUrl(path: string, bytes: Uint8Array, mimeType: string): string | undefined {
    if (this.destroyed) return undefined;
    const urlApi = this.ownerDocument.defaultView?.URL;
    const url = urlApi?.createObjectURL
      ? urlApi.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }))
      : `data:${mimeType};base64,${bytesToBase64(bytes)}`;
    this.urls.set(path.toLowerCase(), url);
    const size = sniffImageSize(bytes, mimeType);
    if (size) this.sizes.set(path.toLowerCase(), size);
    return url;
  }

  private async referenceKey(path: string): Promise<string | undefined> {
    if (!this.options.sourceId) return undefined;
    this.sourceIdPromise ??= typeof this.options.sourceId === 'string'
      ? Promise.resolve(this.options.sourceId)
      : this.options.sourceId();
    return `${await this.sourceIdPromise}:${path.toLowerCase()}`;
  }
}

export async function mdzipArchiveSourceId(bytes: Uint8Array): Promise<string> {
  return `sha256:${await sha256(bytes)}`;
}

async function contentAddress(bytes: Uint8Array, mimeType: string): Promise<string> {
  const mime = new TextEncoder().encode(`${mimeType}\0`);
  const input = new Uint8Array(mime.length + bytes.length);
  input.set(mime);
  input.set(bytes, mime.length);
  return `sha256:${await sha256(input)}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Reads intrinsic pixel dimensions from common image headers without decoding
 * the image. Returns `undefined` for formats it does not recognize.
 */
export function sniffImageSize(
  bytes: Uint8Array,
  mimeType: string
): { width: number; height: number } | undefined {
  const len = bytes.length;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG: 8-byte signature, then IHDR with big-endian width/height.
  if (len >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // GIF: 'GIF', then little-endian logical screen width/height.
  if (len >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }

  // BMP: 'BM', then signed little-endian width/height in the DIB header.
  if (len >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
  }

  // WebP: RIFF container with a WEBP fourcc and one of three chunk forms.
  if (len >= 30
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === 'VP8 ') {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
      return {
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
      };
    }
    if (chunk === 'VP8X') {
      return {
        width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
        height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
      };
    }
  }

  // JPEG: scan for a Start-Of-Frame marker carrying the dimensions.
  if (len >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < len) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      const segmentLength = view.getUint16(offset + 2);
      if (segmentLength < 2) break;
      offset += 2 + segmentLength;
    }
  }

  // SVG: read width/height or fall back to the viewBox extents.
  if (mimeType === 'image/svg+xml' || (len >= 5 && bytes[0] === 0x3c)) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, Math.min(len, 2048)));
    const svg = /<svg[^>]*>/i.exec(text)?.[0];
    if (svg) {
      const width = /\bwidth\s*=\s*["']?\s*([\d.]+)/i.exec(svg)?.[1];
      const height = /\bheight\s*=\s*["']?\s*([\d.]+)/i.exec(svg)?.[1];
      if (width && height) return { width: Math.round(Number(width)), height: Math.round(Number(height)) };
      const viewBox = /\bviewBox\s*=\s*["']?\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/i.exec(svg);
      if (viewBox) return { width: Math.round(Number(viewBox[1])), height: Math.round(Number(viewBox[2])) };
    }
  }

  return undefined;
}

function resolveAssetPath(
  rawPath: string,
  currentPath: string,
  assets: readonly MdzWorkspaceAsset[]
): string | undefined {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(rawPath)) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath.replace(/^<|>$/g, '').split(/[?#]/, 1)[0] ?? '');
  } catch {
    return undefined;
  }
  const direct = assets.find(
    (asset) => asset.path.toLowerCase() === decoded.replace(/^[/\\]+/, '').toLowerCase()
  );
  if (direct) return direct.path;
  const base = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1) : '';
  const normalized = normalizePath(decoded.startsWith('/') ? decoded.slice(1) : `${base}${decoded}`);
  return assets.find((asset) => asset.path.toLowerCase() === normalized.toLowerCase())?.path;
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}
