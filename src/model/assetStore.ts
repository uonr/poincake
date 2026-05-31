import type { ImageNoteContent } from './note';
import type { FileImageNoteContent, WorldFileImageCodec } from './worldFile';

const DB_NAME = 'poincake';
const DB_VERSION = 1;
const STORE = 'assets';

// A 1x1 transparent PNG, used when an exported note references an asset whose
// bytes are no longer in IndexedDB. Keeps export self-contained and non-throwing.
const MISSING_ASSET_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * Stores image bytes in IndexedDB keyed by their content hash, so a note only
 * has to carry a small `assetId` string (in memory and in undo history) instead
 * of an inflated base64 data URL. Object URLs for loaded assets are cached so
 * the synchronous render path can resolve `assetId -> src` without awaiting.
 */
export class AssetStore implements WorldFileImageCodec {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly objectUrls = new Map<string, string>();

  /** Persist a blob and return its content-hash id, registering an object URL. */
  async put(blob: Blob): Promise<string> {
    const assetId = await hashBlob(blob);
    if (!this.objectUrls.has(assetId)) {
      const db = await this.open();
      await requestToPromise(
        db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, assetId),
      );
      this.objectUrls.set(assetId, URL.createObjectURL(blob));
    }
    return assetId;
  }

  /** Load blobs for the given ids so {@link objectUrl} can resolve them. */
  async hydrate(assetIds: Iterable<string>): Promise<void> {
    const pending = [...new Set(assetIds)].filter((id) => !this.objectUrls.has(id));
    if (pending.length === 0) {
      return;
    }

    const db = await this.open();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    await Promise.all(
      pending.map(async (assetId) => {
        const blob = await requestToPromise<Blob | undefined>(store.get(assetId));
        if (blob) {
          this.objectUrls.set(assetId, URL.createObjectURL(blob));
        }
      }),
    );
  }

  /** Resolve a cached object URL synchronously, or null if not hydrated/known. */
  objectUrl(assetId: string): string | null {
    return this.objectUrls.get(assetId) ?? null;
  }

  /** Revoke every object URL this store handed out. Call on teardown. */
  dispose(): void {
    for (const url of this.objectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
  }

  // --- WorldFileImageCodec: bridge runtime assetId <-> self-contained data URL.

  encodeImage = async (content: ImageNoteContent): Promise<FileImageNoteContent> => {
    const blob = await this.getBlob(content.assetId);
    return {
      kind: 'image',
      src: blob ? await blobToDataUrl(blob) : MISSING_ASSET_DATA_URL,
      alt: content.alt,
      mimeType: content.mimeType,
    };
  };

  decodeImage = async (content: FileImageNoteContent): Promise<ImageNoteContent> => {
    const blob = dataUrlToBlob(content.src);
    const assetId = await this.put(blob);
    return {
      kind: 'image',
      assetId,
      alt: content.alt,
      mimeType: content.mimeType,
    };
  };

  private async getBlob(assetId: string): Promise<Blob | null> {
    const db = await this.open();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const blob = await requestToPromise<Blob | undefined>(store.get(assetId));
    return blob ?? null;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.addEventListener('upgradeneeded', () => {
          if (!request.result.objectStoreNames.contains(STORE)) {
            request.result.createObjectStore(STORE);
          }
        });
        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => reject(request.error));
      });
    }
    return this.dbPromise;
  }
}

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });

const hashBlob = async (blob: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `sha256-${hex}`;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Failed to read asset as a data URL.')),
    );
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(blob);
  });

const dataUrlToBlob = (dataUrl: string): Blob => {
  const commaIndex = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || commaIndex === -1) {
    throw new Error('Malformed data URL.');
  }

  const header = dataUrl.slice(5, commaIndex);
  const isBase64 = header.endsWith(';base64');
  const mimeType = (isBase64 ? header.slice(0, -';base64'.length) : header).split(';')[0] || '';
  const payload = dataUrl.slice(commaIndex + 1);

  if (!isBase64) {
    return new Blob([decodeURIComponent(payload)], { type: mimeType });
  }

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
};
