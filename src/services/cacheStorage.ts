// High-Performance Persistent IndexedDB Storage for .TEPR DTS Files
// Enables instant loading of enormous yearly records (thousands of files) in milliseconds

import { ParsedTeprFile } from './teprParser';

const DB_NAME = 'DTS_TEPR_CACHE_V10';
const STORE_NAME = 'parsed_files';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported in this environment'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error('Failed to open IndexedDB'));
    };
  });

  return dbPromise;
}

export function makeCacheKey(fileId: string, modifiedTime?: string): string {
  return `${fileId}_${modifiedTime || '0'}`;
}

export async function getCachedParsedFile(fileId: string, modifiedTime?: string): Promise<ParsedTeprFile | null> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(makeCacheKey(fileId, modifiedTime));

      req.onsuccess = () => {
        if (req.result && req.result.data) {
          resolve(req.result.data as ParsedTeprFile);
        } else {
          resolve(null);
        }
      };

      req.onerror = () => {
        resolve(null);
      };
    });
  } catch (err) {
    console.warn('IndexedDB read failed:', err);
    return null;
  }
}

export async function getBatchCachedParsedFiles(
  files: Array<{ id: string; modifiedTime?: string }>
): Promise<Map<string, ParsedTeprFile>> {
  const result = new Map<string, ParsedTeprFile>();
  if (files.length === 0) return result;

  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);

      const req = store.getAll();
      req.onsuccess = () => {
        if (req.result && Array.isArray(req.result)) {
          const cacheRecordMap = new Map<string, ParsedTeprFile>();
          for (let i = 0; i < req.result.length; i++) {
            const item = req.result[i];
            if (item && item.cacheKey && item.data) {
              cacheRecordMap.set(item.cacheKey, item.data);
            }
          }

          for (let j = 0; j < files.length; j++) {
            const f = files[j];
            const key = makeCacheKey(f.id, f.modifiedTime);
            const cached = cacheRecordMap.get(key);
            if (cached) {
              result.set(f.id, cached);
            }
          }
        }
        resolve(result);
      };

      req.onerror = () => {
        resolve(result);
      };
    });
  } catch (err) {
    console.warn('IndexedDB batch read failed:', err);
    return result;
  }
}

export async function saveParsedFilesToCache(items: ParsedTeprFile[], modifiedTimes?: Map<string, string>): Promise<void> {
  if (items.length === 0) return;

  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      for (const item of items) {
        const modTime = modifiedTimes?.get(item.fileId);
        const key = makeCacheKey(item.fileId, modTime);
        store.put({
          cacheKey: key,
          fileId: item.fileId,
          timestamp: Date.now(),
          data: item,
        });
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('IndexedDB write failed:', err);
  }
}

export async function clearTeprCache(): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to clear cache:', err);
  }
}
