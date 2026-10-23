import { DriveFile, DriveFolder } from '../types';
import { getBatchCachedParsedFiles, saveParsedFilesToCache } from './cacheStorage';
import {
  parseTeprContent,
  ParsedTeprFile,
  ScannedFileMeta,
  guessPhaseFromPath,
  extractDateTimeFromText,
  CablePhaseType,
  SectionPeakExtractResult,
  extractSectionPeakFromTepr,
  extractSectionPeakFromSlice,
  parseTeprHeaderFast,
  getPhaseIndexEntry,
  setPhaseIndexEntry,
  flushPhaseIndexToStorage,
  getCalibratedChannelDensity,
  setCalibratedChannelDensity,
} from './teprParser';
import { compileTeprTextIntoMasterSummary } from './masterSectionSummary';
import {
  getLatestAccessTokenSync,
  markAccessTokenInvalid,
  refreshGoogleAccessToken,
} from './firebaseAuth';

export type { DriveFile, DriveFolder };

export function isDriveAuthError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '').toLowerCase();
  return (
    (err as any)?.isAuthError === true ||
    msg.includes('invalid authentication credentials') ||
    msg.includes('expected oauth 2 access token') ||
    msg.includes('unauthenticated') ||
    msg.includes('http 401') ||
    msg.includes('401 unauthorized')
  );
}

export async function driveAuthorizedFetch(
  url: string,
  providedToken: string,
  init?: RequestInit,
  allowInteractiveRefresh = false
): Promise<Response> {
  let activeToken = getLatestAccessTokenSync() || (providedToken ? providedToken.trim() : '');

  if (!activeToken && allowInteractiveRefresh) {
    try {
      const refreshed = await refreshGoogleAccessToken();
      if (refreshed) activeToken = refreshed;
    } catch {
      // Handled below if still empty
    }
  }

  if (!activeToken) {
    const authErr: any = new Error(
      'Google Drive session token is missing or expired. Please click "Reconnect Google Drive" to continue.'
    );
    authErr.isAuthError = true;
    throw authErr;
  }

  const buildHeaders = (token: string): Record<string, string> => {
    const base: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => {
          base[k] = v;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) {
          base[k] = v;
        }
      } else {
        Object.assign(base, init.headers as Record<string, string>);
      }
    }
    base.Authorization = `Bearer ${token}`;
    return base;
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 18000);

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: init?.signal || controller.signal,
      headers: buildHeaders(activeToken),
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (res.status === 401) {
    markAccessTokenInvalid();
    if (allowInteractiveRefresh) {
      try {
        const refreshed = await refreshGoogleAccessToken();
        if (refreshed) {
          res = await fetch(url, {
            ...init,
            headers: buildHeaders(refreshed),
          });
        }
      } catch {
        // Popup may have been blocked or closed; caller will show Reconnect button
      }
    }
  }

  return res;
}

export const KNOWN_FILE_TYPES = [
  {
    id: 'all_text',
    label: 'All Text & Data Files',
    extensions: ['.txt', '.md', '.markdown', '.csv', '.tsv', '.tepr', '.json', '.js', '.ts', '.py', '.sql', '.log', '.env', '.html', '.css', '.xml', '.yaml', '.yml'],
    mimeTypes: ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/javascript', 'application/javascript', 'text/x-python', 'text/html', 'text/css', 'application/vnd.google-apps.document'],
    iconName: 'FileText',
  },
  {
    id: 'tepr',
    label: 'TEPR Report (.tepr)',
    extensions: ['.tepr'],
    mimeTypes: ['text/plain', 'application/octet-stream'],
    iconName: 'Activity',
  },
  {
    id: 'txt',
    label: 'Plain Text (.txt)',
    extensions: ['.txt'],
    mimeTypes: ['text/plain'],
    iconName: 'FileText',
  },
  {
    id: 'md',
    label: 'Markdown (.md)',
    extensions: ['.md', '.markdown'],
    mimeTypes: ['text/markdown', 'text/x-markdown'],
    iconName: 'FileCode',
  },
  {
    id: 'csv',
    label: 'CSV / TSV Data (.csv, .tsv)',
    extensions: ['.csv', '.tsv'],
    mimeTypes: [
      'text/csv',
      'text/tab-separated-values',
      'text/plain',
      'application/vnd.ms-excel',
      'application/csv',
      'text/x-csv',
      'application/x-csv',
      'text/comma-separated-values',
      'application/octet-stream',
      'application/vnd.google-apps.spreadsheet',
    ],
    iconName: 'Table',
  },
  {
    id: 'code_json',
    label: 'Code & Config (.json, .js, .ts, .py, .sql)',
    extensions: ['.json', '.js', '.ts', '.py', '.sql', '.yaml', '.yml'],
    mimeTypes: ['application/json', 'text/javascript', 'application/javascript', 'text/x-python', 'application/x-yaml'],
    iconName: 'Code',
  },
  {
    id: 'logs',
    label: 'Log Files (.log)',
    extensions: ['.log'],
    mimeTypes: ['text/plain', 'application/octet-stream'],
    iconName: 'Terminal',
  },
  {
    id: 'gdoc',
    label: 'Google Docs (auto-extracted)',
    extensions: [],
    mimeTypes: ['application/vnd.google-apps.document'],
    iconName: 'FileEdit',
  },
];

export async function fetchDriveFolders(accessToken: string, parentId = 'root'): Promise<DriveFolder[]> {
  const allFolders: DriveFolder[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const query = `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=nextPageToken,files(id,name,parents)&orderBy=name&pageSize=1000`;
    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const res = await driveAuthorizedFetch(url, accessToken, undefined, true);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const rawMsg = err?.error?.message || `Failed to fetch folders: ${res.statusText}`;
      const errorObj: any = new Error(rawMsg);
      if (res.status === 401 || isDriveAuthError(rawMsg)) {
        errorObj.isAuthError = true;
      }
      throw errorObj;
    }

    const data = await res.json();
    const folders = (data.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      parentId: f.parents?.[0],
    }));
    allFolders.push(...folders);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFolders;
}

export async function fetchFolderDetails(accessToken: string, folderId: string): Promise<{ id: string; name: string }> {
  if (folderId === 'root') {
    return { id: 'root', name: 'My Drive (Root)' };
  }

  const url = `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType`;
  const res = await driveAuthorizedFetch(url, accessToken);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Failed to get folder info: ${res.statusText}`);
  }

  const data = await res.json();
  return { id: data.id, name: data.name };
}

// Helper to fetch direct files and direct subfolders in a single folder
async function fetchDirectFolderContents(
  accessToken: string,
  folderId: string,
  folderPath: string[] = []
): Promise<{ files: DriveFile[]; subfolders: Array<{ id: string; name: string; folderPath: string[] }> }> {
  // Query both files and child folders in this folder
  const baseQuery = `'${folderId}' in parents and trashed = false`;
  const files: DriveFile[] = [];
  const subfolders: Array<{ id: string; name: string; folderPath: string[] }> = [];
  let pageToken: string | undefined = undefined;

  const currentPathStr = folderPath.join('/');
  const immediateFolderName = folderPath.length > 0 ? folderPath[folderPath.length - 1] : undefined;

  do {
    let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(baseQuery)}&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,iconLink,webViewLink)&orderBy=modifiedTime desc&pageSize=1000`;
    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    let attempt = 0;
    let res: Response | null = null;
    while (attempt < 5) {
      attempt++;
      await driveRateLimiter.acquire();
      try {
        res = await driveAuthorizedFetch(url, accessToken);
        if (res.ok) break;
        if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt < 5) {
          driveRateLimiter.reportRateLimitHit();
          await new Promise((r) => setTimeout(r, 150 * Math.pow(1.4, attempt)));
          continue;
        }
        break;
      } catch (err) {
        if (attempt < 5) {
          driveRateLimiter.reportRateLimitHit();
          await new Promise((r) => setTimeout(r, 200 * Math.pow(1.4, attempt)));
          continue;
        }
        break;
      }
    }

    if (!res || !res.ok) {
      const err = await res?.json().catch(() => ({}));
      console.warn(`Warning: Could not fetch contents in folder ${folderId} after retries:`, err);
      break;
    }

    const data = await res.json();
    for (const item of (data.files || [])) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        subfolders.push({
          id: item.id,
          name: item.name,
          folderPath: [...folderPath, item.name],
        });
      } else {
        files.push({
          ...item,
          folderId,
          subfolderName: immediateFolderName,
          folderPath: currentPathStr,
        });
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return { files, subfolders };
}

// Find Google Drive folders matching specific names (e.g. KMB, KMA, KNA)
export async function findDriveFoldersByNames(
  accessToken: string,
  folderNames: string[]
): Promise<Record<string, DriveFolder>> {
  const found: Record<string, DriveFolder> = {};
  if ((!accessToken && !getLatestAccessTokenSync()) || folderNames.length === 0) return found;

  const nameClauses = folderNames
    .map((n) => `name = '${n.replace(/'/g, "\\'")}'`)
    .join(' or ');
  const query = `(${nameClauses}) and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name,parents)&pageSize=100`;

  try {
    const res = await driveAuthorizedFetch(url, accessToken);
    if (!res.ok) return found;
    const data = await res.json();
    for (const f of data.files || []) {
      const upper = String(f.name || '').trim().toUpperCase();
      if (!found[upper]) {
        found[upper] = {
          id: f.id,
          name: f.name,
          parentId: f.parents?.[0],
        };
      }
    }
  } catch (err) {
    console.warn('Could not search folders by name:', err);
  }
  return found;
}

// Ultra-fast multi-level recursive concurrent folder & file scanner
// Seamlessly crawls Year / Month / Date / Day hierarchies at maximum parallel speed
export async function fetchFilesInFolder(
  accessToken: string,
  folderId: string,
  fileTypeId: string,
  customExtension = '',
  concurrency = 10,
  rootFolderName?: string
): Promise<DriveFile[]> {
  const discoveredFiles: DriveFile[] = [];
  const initialPath =
    rootFolderName && rootFolderName !== 'root' && rootFolderName !== 'My Drive (Root)'
      ? [rootFolderName]
      : [];
  const folderQueue: Array<{ id: string; name: string; folderPath: string[] }> = [
    { id: folderId, name: rootFolderName || 'root', folderPath: initialPath }
  ];

  const activeWorkers: Promise<void>[] = [];
  let activeCount = 0;

  // Worker loop pulling folders from queue until all nested levels (Year/Month/Date) are exhausted
  const processQueue = async () => {
    while (folderQueue.length > 0 || activeCount > 0) {
      if (folderQueue.length === 0) {
        // Wait briefly for other workers that might discover new child folders
        await new Promise((resolve) => setTimeout(resolve, 30));
        if (folderQueue.length === 0 && activeCount === 0) break;
        continue;
      }

      const folderItem = folderQueue.shift();
      if (!folderItem) continue;

      activeCount++;
      try {
        const { files, subfolders } = await fetchDirectFolderContents(
          accessToken,
          folderItem.id,
          folderItem.folderPath
        );

        discoveredFiles.push(...files);

        // Enqueue any discovered subfolders (e.g. Year -> Month -> Date)
        if (subfolders.length > 0) {
          folderQueue.push(...subfolders);
        }
      } catch (err) {
        console.warn(`Error scanning folder ${folderItem.name} (${folderItem.id}):`, err);
      } finally {
        activeCount--;
      }
    }
  };

  // Launch parallel concurrent folder scanner workers
  const workerCount = Math.min(concurrency, 8);
  for (let i = 0; i < workerCount; i++) {
    activeWorkers.push(processQueue());
  }

  await Promise.all(activeWorkers);

  const filterConfig = KNOWN_FILE_TYPES.find((t) => t.id === fileTypeId);

  return discoveredFiles.filter((file) => {
    const nameLower = file.name.toLowerCase();

    // If custom extension provided
    if (customExtension.trim()) {
      const ext = customExtension.trim().toLowerCase().startsWith('.') 
        ? customExtension.trim().toLowerCase() 
        : `.${customExtension.trim().toLowerCase()}`;
      return nameLower.endsWith(ext);
    }

    if (!filterConfig || filterConfig.id === 'all_text') {
      // General text filter
      const isMimeText = file.mimeType.startsWith('text/') || 
                         file.mimeType === 'application/json' ||
                         file.mimeType === 'application/javascript' ||
                         file.mimeType === 'application/vnd.google-apps.document';
      const hasTextExtension = [
        '.txt', '.md', '.markdown', '.csv', '.tsv', '.tepr', '.json', '.js', '.ts',
        '.py', '.sql', '.log', '.env', '.html', '.css', '.xml', '.yaml', '.yml', '.rst', '.tex'
      ].some((ext) => nameLower.endsWith(ext));

      return isMimeText || hasTextExtension;
    }

    if (filterConfig.id === 'gdoc') {
      return file.mimeType === 'application/vnd.google-apps.document';
    }

    // Match by configured mimeTypes or extensions
    const matchesMime = filterConfig.mimeTypes.includes(file.mimeType);
    const matchesExt = filterConfig.extensions.some((ext) => nameLower.endsWith(ext));

    return matchesMime || matchesExt;
  });
}

// High-throughput deterministic slot-reservation rate limiter for Google Drive API
// Sustains 75–90 req/sec (well above 60 files/sec) without nested setTimeout loop stalls
class DriveRateLimiter {
  private targetRatePerSec = 85;
  private nextSlotTime = 0;
  private last429Time = 0;

  public async acquire(): Promise<void> {
    const now = performance.now();

    // Additive recovery toward 85 req/sec when no recent 429s
    if (this.targetRatePerSec < 85 && now - this.last429Time > 800) {
      this.targetRatePerSec = Math.min(85, this.targetRatePerSec + 3);
      this.last429Time = now - 300;
    }

    const intervalMs = 1000 / this.targetRatePerSec;
    // Allow an instant burst window of up to 35 concurrent requests before spacing
    const minBaseTime = now - 35 * intervalMs;
    const scheduledTime = Math.max(minBaseTime, this.nextSlotTime) + intervalMs;
    this.nextSlotTime = scheduledTime;

    if (scheduledTime > now + 2) {
      const waitMs = Math.min(200, Math.ceil(scheduledTime - now));
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  public reportRateLimitHit() {
    const now = performance.now();
    this.last429Time = now;
    // Gentle adaptive backoff to 50 req/sec while keeping sustained throughput high
    this.targetRatePerSec = Math.max(50, this.targetRatePerSec - 3);
    if (this.nextSlotTime < now + 30) {
      this.nextSlotTime = now + 30;
    }
  }

  public getTargetRate(): number {
    return this.targetRatePerSec;
  }
}

export const driveRateLimiter = new DriveRateLimiter();

// Minimal in-memory cache for fast file content retrieval without exploding JS heap memory (Max 50 entries)
const MAX_CONTENT_CACHE_ENTRIES = 50;
const fileContentCache = new Map<string, { rawText: string; timestamp: number }>();

function setInContentCache(key: string, text: string) {
  if (fileContentCache.size >= MAX_CONTENT_CACHE_ENTRIES) {
    const oldestKey = fileContentCache.keys().next().value;
    if (oldestKey) fileContentCache.delete(oldestKey);
  }
  fileContentCache.set(key, { rawText: text, timestamp: Date.now() });
}

export function clearDriveContentCache(): void {
  fileContentCache.clear();
}

export async function fetchFileContent(
  accessToken: string, 
  fileId: string, 
  mimeType: string,
  modifiedTime?: string,
  maxRetries = 5,
  skipMemoryCache = false
): Promise<string> {
  const cacheKey = `${fileId}:${modifiedTime || ''}`;
  if (!skipMemoryCache && fileContentCache.has(cacheKey)) {
    return fileContentCache.get(cacheKey)!.rawText;
  }

  // Paced acquisition to guarantee compliance with Google Drive API quotas
  await driveRateLimiter.acquire();

  // If Google Doc, export as plain text
  if (mimeType === 'application/vnd.google-apps.document') {
    const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
    let attempt = 0;
    while (attempt <= maxRetries) {
      attempt++;
      try {
        const res = await driveAuthorizedFetch(exportUrl, accessToken);
        if (!res.ok) {
          if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt <= maxRetries) {
            driveRateLimiter.reportRateLimitHit();
            await new Promise((r) => setTimeout(r, 150 * Math.pow(1.4, attempt) + Math.random() * 60));
            continue;
          }
          const errText = await res.text().catch(() => '');
          let parsedErrMsg = '';
          try {
            const errJson = JSON.parse(errText);
            parsedErrMsg = errJson?.error?.message || errJson?.message || '';
          } catch {
            parsedErrMsg = errText;
          }
          throw new Error(parsedErrMsg || res.statusText || `HTTP ${res.status}`);
        }
        const text = await res.text();
        if (!skipMemoryCache) setInContentCache(cacheKey, text);
        return text;
      } catch (err: any) {
        if (attempt > maxRetries) throw err;
        driveRateLimiter.reportRateLimitHit();
        await new Promise((r) => setTimeout(r, 150 * Math.pow(1.4, attempt) + Math.random() * 60));
      }
    }
  }

  // If Google Sheet, export as CSV
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`;
    let attempt = 0;
    while (attempt <= maxRetries) {
      attempt++;
      try {
        const res = await driveAuthorizedFetch(exportUrl, accessToken);
        if (!res.ok) {
          if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt <= maxRetries) {
            driveRateLimiter.reportRateLimitHit();
            await new Promise((r) => setTimeout(r, 150 * Math.pow(1.4, attempt) + Math.random() * 60));
            continue;
          }
          const errText = await res.text().catch(() => '');
          let parsedErrMsg = '';
          try {
            const errJson = JSON.parse(errText);
            parsedErrMsg = errJson?.error?.message || errJson?.message || '';
          } catch {
            parsedErrMsg = errText;
          }
          throw new Error(parsedErrMsg || res.statusText || `HTTP ${res.status}`);
        }
        const text = await res.text();
        if (!skipMemoryCache) setInContentCache(cacheKey, text);
        return text;
      } catch (err: any) {
        if (attempt > maxRetries) throw err;
        driveRateLimiter.reportRateLimitHit();
        await new Promise((r) => setTimeout(r, 150 * Math.pow(1.4, attempt) + Math.random() * 60));
      }
    }
  }

  // Regular binary / text download via alt=media
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt++;
    try {
      const res = await driveAuthorizedFetch(url, accessToken);

      if (!res.ok) {
        // Handle rate limiting (429 / 403) or transient server errors (5xx) with gentle adaptive backoff
        if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt <= maxRetries) {
          driveRateLimiter.reportRateLimitHit();
          await new Promise((r) => setTimeout(r, 100 * Math.pow(1.2, attempt) + Math.random() * 40));
          continue;
        }
        const errText = await res.text().catch(() => '');
        let errMsg = '';
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson?.error?.message || errJson?.message || '';
        } catch {
          errMsg = errText;
        }
        throw new Error(errMsg || res.statusText || `HTTP ${res.status}`);
      }

      const text = await res.text();
      if (!skipMemoryCache) setInContentCache(cacheKey, text);
      return text;
    } catch (err: any) {
      if (attempt > maxRetries) {
        throw new Error(err?.message || `Failed to download file content (ID: ${fileId})`);
      }
      driveRateLimiter.reportRateLimitHit();
      await new Promise((r) => setTimeout(r, 250 * Math.pow(1.5, attempt) + Math.random() * 120));
    }
  }

  throw new Error(`Failed to download file ${fileId} after ${maxRetries} retries`);
}

export const downloadFileContent = fetchFileContent;

// Lightweight range request to download just the header portion of files for super-fast Phase/Channel parsing
export async function fetchFileHeaderContent(
  accessToken: string,
  fileId: string,
  mimeType: string,
  modifiedTime?: string,
  maxRetries = 2
): Promise<string> {
  const cacheKey = `header:${fileId}:${modifiedTime || ''}`;
  if (fileContentCache.has(cacheKey)) {
    return fileContentCache.get(cacheKey)!.rawText;
  }

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt++;
    try {
      const res = await driveAuthorizedFetch(url, accessToken, {
        headers: {
          Range: 'bytes=0-1000', // First 1000 bytes capture # Channel, Reference Temp, and initial Part 2 rows
        },
      });

      if (!res.ok && res.status !== 206) {
        if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, 150 * Math.pow(2, attempt) + Math.random() * 80));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const text = await res.text();
      fileContentCache.set(cacheKey, { rawText: text, timestamp: Date.now() });
      return text;
    } catch (err: any) {
      if (attempt > maxRetries) return '';
      await new Promise((r) => setTimeout(r, 150 * Math.pow(2, attempt) + Math.random() * 80));
    }
  }
  return '';
}

// Targeted HTTP Byte-Range request to download ONLY the slice of a .TEPR file covering the target DOF section
export async function fetchFileByteRange(
  accessToken: string,
  fileId: string,
  startByte: number,
  endByte: number,
  modifiedTime?: string,
  maxRetries = 2
): Promise<{ text: string; isFullFile: boolean }> {
  const fullKey = `${fileId}:${modifiedTime || ''}`;
  if (fileContentCache.has(fullKey)) {
    const fullText = fileContentCache.get(fullKey)!.rawText;
    return { text: fullText, isFullFile: true };
  }

  const rangeKey = `range:${fileId}:${startByte}-${endByte}:${modifiedTime || ''}`;
  if (fileContentCache.has(rangeKey)) {
    return { text: fileContentCache.get(rangeKey)!.rawText, isFullFile: false };
  }

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt++;
    try {
      const res = await driveAuthorizedFetch(url, accessToken, {
        headers: {
          Range: `bytes=${Math.max(0, Math.floor(startByte))}-${Math.floor(endByte)}`,
        },
      });

      if (!res.ok && res.status !== 206) {
        if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, 180 * Math.pow(2, attempt) + Math.random() * 90));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const text = await res.text();
      const isFull = res.status === 200 && startByte > 0;
      if (isFull) {
        fileContentCache.set(fullKey, { rawText: text, timestamp: Date.now() });
      } else {
        fileContentCache.set(rangeKey, { rawText: text, timestamp: Date.now() });
      }
      return { text, isFullFile: isFull };
    } catch (err) {
      if (attempt > maxRetries) return { text: '', isFullFile: false };
      await new Promise((r) => setTimeout(r, 180 * Math.pow(2, attempt) + Math.random() * 90));
    }
  }
  return { text: '', isFullFile: false };
}

function channelToCablePhase(ch?: number): CablePhaseType {
  if (ch === 0) return 'Phase A';
  if (ch === 1) return 'Phase B';
  if (ch === 2) return 'Phase C';
  if (ch === 3) return 'Submarine Cable';
  return 'Unassigned';
}

function doesChannelMatchFilter(
  ch: number,
  expectedCategory: 'land' | 'submarine',
  expectedPhase: string
): boolean {
  if (expectedCategory === 'submarine' || expectedPhase === 'SM') {
    return ch === 3;
  }
  // Land category (Channels 0, 1, 2)
  if (ch === 3) return false;
  if (expectedPhase === 'A') return ch === 0;
  if (expectedPhase === 'B') return ch === 1;
  if (expectedPhase === 'C') return ch === 2;
  return true;
}

/**
 * STAGE 1: Phase Separation Procedure
 * Fast-scans candidate .TEPR files in the target date range and separates out uninteresting
 * files (other phases/channels) BEFORE reading DOF data.
 * - Uses Persistent Phase Index + Google Drive file size (Submarine >220KB vs Land <200KB) for 0ms separation.
 * - Uses 48-worker 1KB header range probes for any remaining unresolved files.
 */
export async function runPhaseSeparationProcedure(
  accessToken: string | null,
  candidates: ScannedFileMeta[],
  driveFilesMap: Map<string, DriveFile>,
  inMemoryParsedMap: Map<string, ParsedTeprFile>,
  cachedParsedMap: Map<string, ParsedTeprFile>,
  expectedCategory: 'land' | 'submarine',
  expectedPhase: string,
  onProgress?: (
    checked: number,
    total: number,
    matchedCount: number,
    skippedCount: number,
    currentFileName: string
  ) => void,
  shouldAbort?: () => boolean
): Promise<{
  focusedFiles: ScannedFileMeta[];
  skippedOtherPhaseCount: number;
  totalCandidates: number;
}> {
  const total = candidates.length;
  if (total === 0) {
    return { focusedFiles: [], skippedOtherPhaseCount: 0, totalCandidates: 0 };
  }

  const focusedFiles: ScannedFileMeta[] = [];
  const unresolvedFiles: ScannedFileMeta[] = [];
  let skippedOtherPhaseCount = 0;
  let checkedCount = 0;

  // PASS 1: Instant 0ms Separation (In-Memory + IndexedDB + Persistent Phase Index + Explicit Path Match)
  for (let i = 0; i < candidates.length; i++) {
    const sf = candidates[i];

    // 1. Check already-parsed files in memory or IndexedDB
    const parsed = inMemoryParsedMap.get(sf.fileId) || cachedParsedMap.get(sf.fileId);
    if (parsed) {
      const pts = parsed.dataPoints || [];
      const maxPos = pts.length > 0 ? pts[pts.length - 1].position : 0;
      let ch: number | undefined;
      if (parsed.header?.rawComments) {
        for (const cLine of parsed.header.rawComments) {
          const m = cLine.match(/#\s*Channel\s*(?:No\.?|Number)?\s*[:=]\s*(\d+)/i);
          if (m) {
            ch = parseInt(m[1], 10);
            break;
          }
        }
      }
      if (ch === undefined) {
        ch = parsed.channel ?? (parsed.cablePhase === 'Submarine Cable' ? 3 : 0);
      }
      sf.channel = ch;
      sf.cablePhase = channelToCablePhase(ch);
      setPhaseIndexEntry(sf.fileId, {
        ch,
        ref: parsed.header?.fiberReferenceTemp ?? 30.0,
        maxPos,
      });
      checkedCount++;
      if (doesChannelMatchFilter(ch, expectedCategory, expectedPhase)) {
        focusedFiles.push(sf);
      } else {
        skippedOtherPhaseCount++;
      }
      continue;
    }

    // 2. Check persistent Phase Index (dts_tepr_phase_index_v3)
    const idxEntry = getPhaseIndexEntry(sf.fileId);
    if (idxEntry !== undefined) {
      sf.channel = idxEntry.ch;
      sf.cablePhase = channelToCablePhase(idxEntry.ch);
      checkedCount++;
      if (doesChannelMatchFilter(idxEntry.ch, expectedCategory, expectedPhase)) {
        focusedFiles.push(sf);
      } else {
        skippedOtherPhaseCount++;
      }
      continue;
    }

    // 3. Check if channel was explicitly resolved from path/filename (e.g. Phase_A, Submarine_Cable)
    const explicitPathPhase = guessPhaseFromPath(sf.fileName, sf.folderPath, sf.subfolderName);
    if (explicitPathPhase !== 'Unassigned' && sf.channel !== undefined) {
      checkedCount++;
      if (doesChannelMatchFilter(sf.channel, expectedCategory, expectedPhase)) {
        focusedFiles.push(sf);
      } else {
        skippedOtherPhaseCount++;
      }
      continue;
    }

    unresolvedFiles.push(sf);
  }

  if (onProgress && checkedCount > 0) {
    onProgress(
      checkedCount,
      total,
      focusedFiles.length,
      skippedOtherPhaseCount,
      'Instant phase separation pass complete'
    );
  }

  // PASS 2: Ultra-Fast Parallel 1KB Header Probe for any remaining unresolved files
  if (unresolvedFiles.length > 0 && accessToken) {
    let cursor = 0;
    const workersCount = Math.min(48, unresolvedFiles.length);
    let lastReportTime = 0;

    const workers = Array.from({ length: workersCount }, async () => {
      while (true) {
        if (shouldAbort && shouldAbort()) break;
        const idx = cursor++;
        if (idx >= unresolvedFiles.length) break;
        const sf = unresolvedFiles[idx];
        const df = driveFilesMap.get(sf.fileId);
        const fileSize = Number(df?.size || 0);

        try {
          const headerText = await fetchFileHeaderContent(
            accessToken,
            sf.fileId,
            df?.mimeType || 'text/plain',
            sf.modifiedTime
          );
          if (headerText) {
            const parsedHeader = parseTeprHeaderFast(
              headerText,
              fileSize,
              sf.fileName,
              sf.subfolderName,
              sf.folderPath
            );
            setPhaseIndexEntry(sf.fileId, parsedHeader);
            sf.channel = parsedHeader.ch;
            sf.cablePhase = channelToCablePhase(parsedHeader.ch);

            if (doesChannelMatchFilter(parsedHeader.ch, expectedCategory, expectedPhase)) {
              focusedFiles.push(sf);
            } else {
              skippedOtherPhaseCount++;
            }
          } else {
            // Keep as fallback if header couldn't be read
            focusedFiles.push(sf);
          }
        } catch {
          focusedFiles.push(sf);
        } finally {
          checkedCount++;
          const now = Date.now();
          if (onProgress && (checkedCount === total || now - lastReportTime > 120)) {
            lastReportTime = now;
            onProgress(
              checkedCount,
              total,
              focusedFiles.length,
              skippedOtherPhaseCount,
              sf.fileName
            );
          }
        }
      }
    });

    await Promise.all(workers);
  } else if (unresolvedFiles.length > 0) {
    // No accessToken available to probe headers; include unresolved files
    for (const sf of unresolvedFiles) {
      focusedFiles.push(sf);
    }
  }

  flushPhaseIndexToStorage();

  // Sort focused files chronologically
  focusedFiles.sort((a, b) => (a.dateMeta?.timestamp || 0) - (b.dateMeta?.timestamp || 0));

  return {
    focusedFiles,
    skippedOtherPhaseCount,
    totalCandidates: total,
  };
}

/**
 * STAGE 2: Focused Related-DOF-Only Peak Reader
 * Reads ONLY the byte range inside the target .TEPR file corresponding to [minDof, maxDof]
 * and extracts the single maximum fiber temperature (maxTf) for that section.
 */
export async function fetchSectionPeakDofOnly(
  accessToken: string,
  sf: ScannedFileMeta,
  df: DriveFile | undefined,
  minDof: number,
  maxDof: number,
  expectedCategory: 'land' | 'submarine',
  expectedPhase: string
): Promise<SectionPeakExtractResult | null> {
  const fileSize = Number(df?.size || 0);
  const mimeType = df?.mimeType || 'text/plain';

  // For small Land Cable files (<85 KB), or Google Docs, a single request starting at 0 up to maxDof is fastest
  const existingIdx = getPhaseIndexEntry(sf.fileId);
  const targetChannel =
    existingIdx?.ch ?? (expectedCategory === 'submarine' ? 3 : sf.channel ?? 0);
  const calibrated = getCalibratedChannelDensity(targetChannel);

  // Case A: Near-origin section (maxDof <= 4000m, e.g. Submarine Zone 2.1 or any Land Cable Section 1.1-1.6)
  // A single Range request from byte 0 to prefixEndByte captures BOTH the # Header AND the entire [minDof, maxDof] data!
  if (maxDof <= 4000 || (fileSize > 0 && fileSize <= 95000)) {
    const estEndByte = calibrated
      ? Math.ceil(calibrated.p2Off + Math.max(0, maxDof - calibrated.firstPos) * calibrated.bpm + 18000)
      : Math.max(92000, Math.ceil(900 + (maxDof + 350) * 38));

    const { text: prefixText, isFullFile } = await fetchFileByteRange(
      accessToken,
      sf.fileId,
      0,
      estEndByte,
      sf.modifiedTime
    );

    if (!prefixText) return null;

    const headerInfo = parseTeprHeaderFast(
      prefixText.slice(0, 1400),
      fileSize,
      sf.fileName,
      sf.subfolderName,
      sf.folderPath
    );
    setPhaseIndexEntry(sf.fileId, headerInfo);
    sf.channel = headerInfo.ch;
    sf.cablePhase = channelToCablePhase(headerInfo.ch);

    if (!doesChannelMatchFilter(headerInfo.ch, expectedCategory, expectedPhase)) {
      return null;
    }

    const sliceCheck = extractSectionPeakFromSlice(
      prefixText,
      minDof,
      maxDof,
      headerInfo.ref,
      false,
      headerInfo.ch
    );

    // Calibrate true bytes-per-meter from the observed last position in this prefix chunk
    if (
      sliceCheck.sliceLastPos !== null &&
      sliceCheck.sliceLastPos > (headerInfo.firstPos ?? 0) + 150
    ) {
      const trueBpm =
        (prefixText.length - (headerInfo.p2Off ?? 350)) /
        (sliceCheck.sliceLastPos - (headerInfo.firstPos ?? 0));
      setCalibratedChannelDensity(headerInfo.ch, {
        bpm: trueBpm,
        firstPos: headerInfo.firstPos ?? 0,
        p2Off: headerInfo.p2Off ?? 350,
      });
    }

    if (
      sliceCheck.coveredMaxDof ||
      isFullFile ||
      (fileSize > 0 && estEndByte >= fileSize - 1024)
    ) {
      // If we received the full file (typical ~16KB-45KB .TEPR file), compile ALL sections into the Master Summary Table at once!
      if (
        sf.dateMeta?.dateKey &&
        (isFullFile || (fileSize > 0 && estEndByte >= fileSize - 512) || prefixText.length < estEndByte - 1024)
      ) {
        compileTeprTextIntoMasterSummary(
          prefixText,
          sf.fileId,
          sf.fileName,
          sf.dateMeta.dateKey,
          sf.dateMeta.formattedTime,
          headerInfo.ch
        );
      }
      return sliceCheck.result;
    }

    // If maxDof was slightly beyond estEndByte, fetch the exact continuation window using calibrated density
    const updatedCal = getCalibratedChannelDensity(headerInfo.ch);
    if (updatedCal) {
      const startByte2 = Math.max(
        0,
        Math.floor(updatedCal.p2Off + Math.max(0, minDof - updatedCal.firstPos - 300) * updatedCal.bpm)
      );
      const endByte2 = Math.ceil(
        updatedCal.p2Off + (maxDof - updatedCal.firstPos + 400) * updatedCal.bpm
      );
      const { text: slice2 } = await fetchFileByteRange(
        accessToken,
        sf.fileId,
        startByte2,
        endByte2,
        sf.modifiedTime
      );
      if (slice2) {
        const check2 = extractSectionPeakFromSlice(
          slice2,
          minDof,
          maxDof,
          headerInfo.ref,
          startByte2 > 0,
          headerInfo.ch
        );
        if (check2.result) return check2.result;
      }
    }
  } else {
    // Case B: Mid/Deep Submarine Section (minDof > 4000m, e.g. Zones 2.2 to 2.13 up to 54,000m)
    let headerInfo = existingIdx;
    if (!headerInfo || headerInfo.p2Off === undefined) {
      const headerText = await fetchFileHeaderContent(
        accessToken,
        sf.fileId,
        mimeType,
        sf.modifiedTime
      );
      if (headerText) {
        headerInfo = parseTeprHeaderFast(
          headerText,
          fileSize,
          sf.fileName,
          sf.subfolderName,
          sf.folderPath
        );
        setPhaseIndexEntry(sf.fileId, headerInfo);
      } else {
        headerInfo = { ch: 3, ref: 30.0, p2Off: 350, firstPos: 0 };
      }
    }

    sf.channel = headerInfo.ch;
    sf.cablePhase = channelToCablePhase(headerInfo.ch);
    if (!doesChannelMatchFilter(headerInfo.ch, expectedCategory, expectedPhase)) {
      return null;
    }

    const cal = getCalibratedChannelDensity(headerInfo.ch) || {
      bpm: headerInfo.bpm || (fileSize > 220000 ? fileSize / 53500 : 28.0),
      firstPos: headerInfo.firstPos ?? 0,
      p2Off: headerInfo.p2Off ?? 350,
    };

    const spanMeters = Math.max(200, maxDof - minDof);
    const padMeters = Math.max(850, spanMeters * 0.25);
    const startByte = Math.max(
      0,
      Math.floor(cal.p2Off + Math.max(0, minDof - cal.firstPos - padMeters) * cal.bpm)
    );
    const endByte = Math.ceil(cal.p2Off + (maxDof - cal.firstPos + padMeters) * cal.bpm);

    const { text: midSlice, isFullFile } = await fetchFileByteRange(
      accessToken,
      sf.fileId,
      startByte,
      endByte,
      sf.modifiedTime
    );

    if (midSlice) {
      const check = extractSectionPeakFromSlice(
        midSlice,
        minDof,
        maxDof,
        headerInfo.ref,
        startByte > 0 && !isFullFile,
        headerInfo.ch
      );

      // Self-calibrate exact bytes-per-meter from the first valid DOF position at startByte
      if (
        !isFullFile &&
        startByte > cal.p2Off + 5000 &&
        check.sliceFirstPos !== null &&
        check.sliceFirstPos > cal.firstPos + 500
      ) {
        const trueBpm = (startByte - cal.p2Off) / (check.sliceFirstPos - cal.firstPos);
        setCalibratedChannelDensity(headerInfo.ch, {
          bpm: trueBpm,
          firstPos: cal.firstPos,
          p2Off: cal.p2Off,
        });
      }

      if ((check.coveredMinDof && check.coveredMaxDof) || isFullFile) {
        return check.result;
      }

      // If initial slice missed either bound before self-calibration, fetch the exact calibrated window
      const refinedCal = getCalibratedChannelDensity(headerInfo.ch);
      if (refinedCal) {
        const pad2 = Math.max(1000, spanMeters * 0.3);
        const sByte2 = Math.max(
          0,
          Math.floor(
            refinedCal.p2Off + Math.max(0, minDof - refinedCal.firstPos - pad2) * refinedCal.bpm
          )
        );
        const eByte2 = Math.ceil(
          refinedCal.p2Off + (maxDof - refinedCal.firstPos + pad2) * refinedCal.bpm
        );
        const { text: slice2, isFullFile: isFull2 } = await fetchFileByteRange(
          accessToken,
          sf.fileId,
          sByte2,
          eByte2,
          sf.modifiedTime
        );
        if (slice2) {
          const check2 = extractSectionPeakFromSlice(
            slice2,
            minDof,
            maxDof,
            headerInfo.ref,
            sByte2 > 0 && !isFull2,
            headerInfo.ch
          );
          if ((check2.coveredMinDof && check2.coveredMaxDof) || isFull2) {
            return check2.result;
          }
        }
      }
    }
  }

  // Fallback: Full file download and section peak extraction
  const fullRaw = await fetchFileContent(accessToken, sf.fileId, mimeType, sf.modifiedTime);
  if (!fullRaw) return null;
  if (sf.dateMeta?.dateKey) {
    compileTeprTextIntoMasterSummary(
      fullRaw,
      sf.fileId,
      sf.fileName,
      sf.dateMeta.dateKey,
      sf.dateMeta.formattedTime,
      sf.channel
    );
  }
  const fullRes = extractSectionPeakFromTepr(fullRaw, minDof, maxDof, {
    expectedCategory,
    expectedPhase,
    fallbackChannel: sf.channel,
  });
  if (fullRes && fullRes.channel !== undefined) {
    setPhaseIndexEntry(sf.fileId, {
      ch: fullRes.channel,
      ref: fullRes.referenceTemp,
    });
  }
  return fullRes;
}

// 100% Instant offline metadata scanning that parses folder/file names + persistent Phase Index + adaptive file size
export async function scanTeprFilesMetadata(
  accessToken: string,
  files: DriveFile[],
  onProgress?: (loaded: number, total: number, currentFileName: string) => void
): Promise<ScannedFileMeta[]> {
  if (files.length === 0) return [];

  // Check cache for any already parsed files (instant memory/IndexedDB lookup)
  const cachedMap = await getBatchCachedParsedFiles(files);

  const results: ScannedFileMeta[] = [];

  // Instant offline scan purely from folder and file names + persistent phase index
  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    const freshDateMeta = extractDateTimeFromText('', file.name, file.subfolderName, file.folderPath);

    if (cachedMap.has(file.id)) {
      const cached = cachedMap.get(file.id)!;
      results.push({
        fileId: cached.fileId,
        fileName: cached.fileName,
        subfolderName: file.subfolderName,
        folderPath: file.folderPath,
        modifiedTime: file.modifiedTime,
        dateMeta: freshDateMeta || cached.dateMeta,
        cablePhase: cached.cablePhase,
        channel: cached.channel,
      });
    } else {
      const phaseIdx = getPhaseIndexEntry(file.id);
      if (phaseIdx !== undefined) {
        results.push({
          fileId: file.id,
          fileName: file.name,
          subfolderName: file.subfolderName,
          folderPath: file.folderPath,
          modifiedTime: file.modifiedTime,
          dateMeta: freshDateMeta,
          cablePhase: channelToCablePhase(phaseIdx.ch),
          channel: phaseIdx.ch,
        });
      } else {
        // Offline scan: Extract phase from path if explicitly present; otherwise leave Unassigned until # Channel No header is read
        const guessedPhase = guessPhaseFromPath(file.name, file.folderPath, file.subfolderName);

        results.push({
          fileId: file.id,
          fileName: file.name,
          subfolderName: file.subfolderName,
          folderPath: file.folderPath,
          modifiedTime: file.modifiedTime,
          dateMeta: freshDateMeta,
          cablePhase: guessedPhase,
          channel:
            guessedPhase === 'Phase A'
              ? 0
              : guessedPhase === 'Phase B'
              ? 1
              : guessedPhase === 'Phase C'
              ? 2
              : guessedPhase === 'Submarine Cable'
              ? 3
              : undefined,
        });
      }
    }
  }

  // Sort by timestamp
  results.sort((a, b) => (a.dateMeta.timestamp || 0) - (b.dateMeta.timestamp || 0));
  return results;
}

// Parallel concurrent batch downloader for ultra-fast reading of all files in target folder
export async function fetchBatchFilesContent(
  accessToken: string,
  files: DriveFile[],
  onProgress?: (loaded: number, total: number, currentFileName: string) => void,
  concurrency = 8
): Promise<Array<{ file: DriveFile; content: string }>> {
  if (files.length === 0) return [];

  const results: Array<{ file: DriveFile; content: string }> = [];
  let loadedCount = 0;
  const total = files.length;

  // Process in concurrent pools with pacing
  const queue = [...files];
  const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) break;

      try {
        await new Promise((r) => setTimeout(r, 15));
        const content = await fetchFileContent(accessToken, file.id, file.mimeType, file.modifiedTime);
        results.push({ file, content });
      } catch (err) {
        console.warn(`Could not fast-fetch file ${file.name}:`, err);
      } finally {
        loadedCount += 1;
        if (onProgress) {
          onProgress(loadedCount, total, file.name);
        }
      }
    }
  });

  await Promise.all(workers);
  return results;
}

// Ultra-fast streaming fetch and parser with IndexedDB caching for massive/yearly datasets
export async function fastFetchAndParseTeprFiles(
  accessToken: string,
  files: DriveFile[],
  onProgress?: (loaded: number, total: number, currentFileName: string, cachedCount: number) => void,
  concurrency = 36,
  onBatchParsed?: (batch: ParsedTeprFile[]) => void
): Promise<ParsedTeprFile[]> {
  if (files.length === 0) return [];

  const total = files.length;
  let loadedCount = 0;

  // Step 1: Instant load from IndexedDB cache
  const cachedMap = await getBatchCachedParsedFiles(files);
  const parsedResults: ParsedTeprFile[] = [];
  const uncachedFiles: DriveFile[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (cachedMap.has(file.id)) {
      const cached = cachedMap.get(file.id)!;
      // Ensure subfolder and folder path metadata is preserved if updated
      if (file.subfolderName && !cached.dateMeta?.subfolderName) {
        cached.dateMeta.subfolderName = file.subfolderName;
      }
      parsedResults.push(cached);
      loadedCount++;
    } else {
      uncachedFiles.push(file);
    }
  }

  // If we have cached files, notify the UI immediately so data is visible instantly
  if (parsedResults.length > 0 && onBatchParsed) {
    onBatchParsed([...parsedResults]);
  }

  if (onProgress) {
    onProgress(loadedCount, total, `Restored ${parsedResults.length} files from cache`, parsedResults.length);
  }

  // If all files were in cache, return immediately (sub-10ms for thousands of files!)
  if (uncachedFiles.length === 0) {
    parsedResults.sort((a, b) => (a.header.timestamp || 0) - (b.header.timestamp || 0));
    return parsedResults;
  }

  // Step 2: High-speed parallel concurrent fetch and zero-copy parse
  const newlyParsed: ParsedTeprFile[] = [];
  const modifiedTimesMap = new Map<string, string>();
  
  let uncommittedBatch: ParsedTeprFile[] = [];
  let lastProgressUpdate = 0;
  let lastBatchFlush = Date.now();
  let queueCursor = 0;

  const flushBatch = () => {
    if (uncommittedBatch.length > 0) {
      const batchToFlush = [...uncommittedBatch];
      uncommittedBatch = [];
      if (onBatchParsed) {
        onBatchParsed(batchToFlush);
      }
      // Save chunk to cache in background
      saveParsedFilesToCache(batchToFlush, modifiedTimesMap).catch((e) =>
        console.warn('Background caching chunk warning:', e)
      );
    }
  };

  const notifyProgress = (fileName: string, force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (force || loadedCount === total || now - lastProgressUpdate > 150) {
      lastProgressUpdate = now;
      onProgress(loadedCount, total, fileName, parsedResults.length);
    }
  };

  const actualWorkers = Math.min(concurrency, uncachedFiles.length);
  const workers = Array.from({ length: actualWorkers }, async () => {
    while (true) {
      const idx = queueCursor++;
      if (idx >= uncachedFiles.length) break;
      const file = uncachedFiles[idx];

      try {
        const rawContent = await fetchFileContent(accessToken, file.id, file.mimeType, file.modifiedTime);
        const parsed = parseTeprContent(file.id, file.name, rawContent, file.subfolderName, file.folderPath);
        newlyParsed.push(parsed);
        uncommittedBatch.push(parsed);

        if (file.modifiedTime) {
          modifiedTimesMap.set(file.id, file.modifiedTime);
        }

        // Periodically yield parsed files to UI every 60 files or 400ms
        const now = Date.now();
        if (uncommittedBatch.length >= 60 || now - lastBatchFlush > 400) {
          lastBatchFlush = now;
          flushBatch();
        }
      } catch (err) {
        console.warn(`Could not stream and parse file ${file.name}:`, err);
      } finally {
        loadedCount++;
        notifyProgress(file.name);
      }
    }
  });

  await Promise.all(workers);
  flushBatch();
  notifyProgress('Complete', true);

  const allParsed = [...parsedResults, ...newlyParsed];
  allParsed.sort((a, b) => (a.header.timestamp || 0) - (b.header.timestamp || 0));
  return allParsed;
}

export async function saveSummaryToGoogleDrive(
  accessToken: string,
  folderId: string,
  originalFileName: string,
  summaryMarkdown: string
): Promise<{ id: string; name: string }> {
  const cleanName = originalFileName.replace(/\.[^/.]+$/, '');
  const newFileName = `${cleanName}_Summary.md`;

  const metadata = {
    name: newFileName,
    mimeType: 'text/markdown',
    parents: folderId === 'root' ? [] : [folderId],
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: text/markdown; charset=UTF-8\r\n\r\n' +
    summaryMarkdown +
    closeDelimiter;

  const res = await driveAuthorizedFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    accessToken,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
    true
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Failed to save file to Drive: ${res.statusText}`);
  }

  const result = await res.json();
  return { id: result.id, name: result.name };
}

export async function uploadTextFileToGoogleDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  content: string,
  mimeType = 'text/plain'
): Promise<{ id: string; name: string }> {
  const metadata = {
    name: fileName,
    mimeType,
    parents: folderId === 'root' ? [] : [folderId],
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}; charset=UTF-8\r\n\r\n` +
    content +
    closeDelimiter;

  const res = await driveAuthorizedFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    accessToken,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Failed to upload file to Drive: ${res.statusText}`);
  }

  const result = await res.json();
  return { id: result.id, name: result.name };
}

const PERMANENT_DRIVE_CONFIG_FILENAME = '.dts_permanent_target_folder_config.json';

export interface PersistentFolderMemory {
  permanentFolder?: DriveFolder | null;
  powerFolders?: any;
  permanentFolder3?: DriveFolder | null;
  permanentFolder4?: DriveFolder | null;
  updatedAt?: string;
}

// Save permanent target folder config to Google Drive so any device logging into the same Google account restores it automatically
export async function savePermanentConfigToDrive(
  accessToken: string,
  config: PersistentFolderMemory
): Promise<void> {
  if (!accessToken && !getLatestAccessTokenSync()) return;
  try {
    const query = `name = '${PERMANENT_DRIVE_CONFIG_FILENAME}' and trashed = false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      query
    )}&fields=files(id,name)&pageSize=5`;
    const searchRes = await driveAuthorizedFetch(searchUrl, accessToken);
    const searchData = searchRes.ok ? await searchRes.json() : { files: [] };
    const existingFile = searchData.files?.[0];

    const payload = JSON.stringify(
      {
        ...config,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    );

    if (existingFile?.id) {
      await driveAuthorizedFetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=media`,
        accessToken,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: payload,
        }
      );
    } else {
      await uploadTextFileToGoogleDrive(
        accessToken,
        'root',
        PERMANENT_DRIVE_CONFIG_FILENAME,
        payload,
        'application/json'
      );
    }
  } catch (err) {
    console.warn('Could not sync permanent folder config to Google Drive:', err);
  }
}

// Load permanent target folder config from Google Drive on any device after login
export async function loadPermanentConfigFromDrive(
  accessToken: string
): Promise<PersistentFolderMemory | null> {
  if (!accessToken && !getLatestAccessTokenSync()) return null;
  try {
    const query = `name = '${PERMANENT_DRIVE_CONFIG_FILENAME}' and trashed = false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      query
    )}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=5`;
    const searchRes = await driveAuthorizedFetch(searchUrl, accessToken);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const existingFile = searchData.files?.[0];
    if (!existingFile?.id) return null;

    const content = await fetchFileContent(accessToken, existingFile.id, 'application/json');
    if (!content) return null;
    const parsed = JSON.parse(content) as PersistentFolderMemory;
    return parsed;
  } catch (err) {
    console.warn('Could not load permanent folder config from Google Drive:', err);
    return null;
  }
}

// Save & Load user preferences from backend server memory (/api/user-preferences)
export async function saveUserPreferencesToServer(params: {
  email?: string | null;
  uid?: string | null;
  permanentFolder?: DriveFolder | null;
  powerFolders?: any;
  permanentFolder3?: DriveFolder | null;
  permanentFolder4?: DriveFolder | null;
}): Promise<void> {
  try {
    await fetch('/api/user-preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch (err) {
    console.warn('Could not save preferences to server memory:', err);
  }
}

export async function loadUserPreferencesFromServer(params?: {
  email?: string | null;
  uid?: string | null;
}): Promise<PersistentFolderMemory | null> {
  try {
    const qs = new URLSearchParams();
    if (params?.email) qs.set('email', params.email);
    if (params?.uid) qs.set('uid', params.uid);
    const res = await fetch(`/api/user-preferences?${qs.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.preferences || null;
  } catch (err) {
    console.warn('Could not load preferences from server memory:', err);
    return null;
  }
}

/**
 * Fetch both subfolders and files in a specific Google Drive folder.
 * Used for browsing Google Drive folders and selecting master database files (.xlsx, .csv).
 */
export async function fetchDriveFolderItems(
  accessToken: string,
  folderId = 'root'
): Promise<{ files: DriveFile[]; subfolders: DriveFolder[] }> {
  const effectiveToken = getLatestAccessTokenSync() || accessToken;
  if (!effectiveToken) {
    const err: any = new Error('Missing Google Drive session token. Please reconnect Google Drive.');
    err.isAuthError = true;
    throw err;
  }

  const baseQuery = `'${folderId}' in parents and trashed = false`;
  const files: DriveFile[] = [];
  const subfolders: DriveFolder[] = [];
  let pageToken: string | undefined = undefined;

  do {
    let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      baseQuery
    )}&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,iconLink,webViewLink)&orderBy=folder,name,modifiedTime desc&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const res = await driveAuthorizedFetch(url, effectiveToken, undefined, true);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = '';
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson?.error?.message || errJson?.message || '';
      } catch {
        errMsg = errText;
      }
      throw new Error(errMsg || `Could not fetch contents of folder ${folderId} (HTTP ${res.status})`);
    }

    const data = await res.json();
    for (const item of data.files || []) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        subfolders.push({
          id: item.id,
          name: item.name,
          parentId: folderId,
        });
      } else {
        files.push({
          ...item,
          folderId,
        });
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return { files, subfolders };
}

/**
 * Download a binary file (e.g. .xlsx, .csv, or exported Google Sheet) from Google Drive as an ArrayBuffer.
 */
export async function fetchFileArrayBuffer(
  accessToken: string,
  fileId: string,
  mimeType?: string,
  maxRetries = 3
): Promise<ArrayBuffer> {
  const effectiveToken = getLatestAccessTokenSync() || accessToken;
  let url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
  }

  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt++;
    try {
      const res = await driveAuthorizedFetch(url, effectiveToken, undefined, true);
      if (!res.ok) {
        if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt) + Math.random() * 250));
          continue;
        }
        const errText = await res.text().catch(() => '');
        throw new Error(errText || `Failed to download file from Google Drive (HTTP ${res.status})`);
      }
      return await res.arrayBuffer();
    } catch (err: any) {
      if (attempt > maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt) + Math.random() * 200));
    }
  }

  throw new Error('Failed to download file from Google Drive after multiple attempts.');
}


