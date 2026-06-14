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

export class MdzipAssetSession {
  private readonly urls = new Map<string, string>();
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
