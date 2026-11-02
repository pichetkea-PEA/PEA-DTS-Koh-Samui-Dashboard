import type { IncomingMessage, ServerResponse } from 'http';

export const DEFAULT_SHARED_FOLDERS: Record<string, { folderId: string; url: string; preferredFormat: 'xlsx' | 'csv' }> = {
  panel1: {
    folderId: '1CMSH2f5hAl0N6F3PHhpr9mwStcX29kgS',
    url: 'https://drive.google.com/drive/folders/1CMSH2f5hAl0N6F3PHhpr9mwStcX29kgS?usp=sharing',
    preferredFormat: 'xlsx',
  },
  panel2: {
    folderId: '1jqS95Z-nF1SivlJFuka8CcIKiyFBMrZ6',
    url: 'https://drive.google.com/drive/folders/1jqS95Z-nF1SivlJFuka8CcIKiyFBMrZ6?usp=sharing',
    preferredFormat: 'csv',
  },
  panel3: {
    folderId: '15rgLYl3V7sqPDNPY8zOLEz9eDBtZLj2_',
    url: 'https://drive.google.com/drive/folders/15rgLYl3V7sqPDNPY8zOLEz9eDBtZLj2_?usp=sharing',
    preferredFormat: 'xlsx',
  },
  page26OpCond: {
    folderId: '1xGm5ZH9mkNQhTAuXmmBCsCnORL0un4nE',
    url: 'https://drive.google.com/drive/folders/1xGm5ZH9mkNQhTAuXmmBCsCnORL0un4nE?usp=sharing',
    preferredFormat: 'xlsx',
  },
  page26LoadCurve: {
    folderId: '1OCCulyWoTU5hnRltkH9J7ZcsNdXDbCeo',
    url: 'https://drive.google.com/drive/folders/1OCCulyWoTU5hnRltkH9J7ZcsNdXDbCeo?usp=sharing',
    preferredFormat: 'xlsx',
  },
};

const KNOWN_FOLDER_FILES: Record<string, { id: string; name: string }> = {
  '1CMSH2f5hAl0N6F3PHhpr9mwStcX29kgS': {
    id: '1Ya1JFd4CuINtfrbfH0H1KiZG10qf6xJ0',
    name: 'DTS_Circuit3_19Sheets_Updated_2021-11-28_to_2026-10-31.xlsx',
  },
  '1jqS95Z-nF1SivlJFuka8CcIKiyFBMrZ6': {
    id: '1xdb2zFsdWDkWeAOr7VYYvVv9ovlKz3vN',
    name: 'Daily_Maximum_Power_Consumption_Database_Updated_2026-10-26_to_2026-10-31.csv',
  },
  '15rgLYl3V7sqPDNPY8zOLEz9eDBtZLj2_': {
    id: '1Lt8jRjIpQJ1D0r7az7cNZ2ey_noOUZeE',
    name: 'DTS_Section_Daily_Profile_19Sheets_Updated_2021-11-28_to_2026-10-31.xlsx',
  },
  '1xGm5ZH9mkNQhTAuXmmBCsCnORL0un4nE': {
    id: '1U8JX9NmtNmO7Xw8CmsZ8yoGuu32NlRb1',
    name: 'Power_Operating_Condition_Database_Updated_2026-10-26_to_2026-10-31.xlsx',
  },
  '1OCCulyWoTU5hnRltkH9J7ZcsNdXDbCeo': {
    id: '1nae0hRouMpxNT8kYb9YARnlXQIDVvVwv',
    name: 'Hourly_Load_Curve_Database_Updated_2026-10-26_to_2026-10-31.xlsx',
  },
};

function extractLatestDateFromFileName(name: string): string {
  const matches = [...(name || '').matchAll(/(\d{4}[-_.]\d{2}[-_.]\d{2})/g)].map((m) =>
    m[1].replace(/[_.]/g, '-')
  );
  if (matches.length > 0) {
    matches.sort();
    return matches[matches.length - 1];
  }
  return '';
}

async function scanSingleDriveFolder(
  folderId: string,
  preferredFormat: 'xlsx' | 'csv' = 'xlsx',
  authHeader = ''
): Promise<{
  folderId: string;
  fileId: string;
  fileName: string;
  modifiedLabel: string;
  latestDateInName: string;
  downloadUrl: string;
  mimeType?: string;
} | null> {
  let foundFiles: Array<{ id: string; name: string; mimeType?: string; modified?: string }> = [];

  // 1. Try Google Drive API v3 if auth token is provided
  if (authHeader) {
    try {
      const driveApiRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=%27${folderId}%27+in+parents+and+trashed%3Dfalse&fields=files(id%2Cname%2CmimeType%2CmodifiedTime)&orderBy=modifiedTime+desc`,
        { headers: { Authorization: authHeader } }
      );
      if (driveApiRes.ok) {
        const driveData: any = await driveApiRes.json();
        if (Array.isArray(driveData.files) && driveData.files.length > 0) {
          foundFiles = driveData.files.map((f: any) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            modified: f.modifiedTime || '',
          }));
        }
      }
    } catch {}
  }

  // 2. Public Google Drive Embedded Folder View (fast ~2KB HTML listing of shared folder files without OAuth)
  if (foundFiles.length === 0) {
    try {
      const embedRes = await fetch(
        `https://drive.google.com/embeddedfolderview?id=${folderId}&_t=${Date.now()}#list`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
          },
        }
      );
      if (embedRes.ok) {
        const embedHtml = await embedRes.text();
        const entryRegex =
          /id="entry-([a-zA-Z0-9_-]+)"[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>(?:[\s\S]*?<div class="flip-entry-last-modified"><div>([^<]*)<\/div>)?/gi;
        let m: RegExpExecArray | null;
        while ((m = entryRegex.exec(embedHtml)) !== null) {
          const fId = m[1].trim();
          const fName = m[2].trim();
          const fMod = (m[3] || '').trim();
          if (/\.(xlsx|csv|xls)$/i.test(fName)) {
            foundFiles.push({ id: fId, name: fName, modified: fMod });
          }
        }
      }
    } catch {}
  }

  // 3. Fallback to standard folder HTML page scrape if embedded view returned nothing
  if (foundFiles.length === 0) {
    try {
      const folderHtmlRes = await fetch(`https://drive.google.com/drive/folders/${folderId}?_t=${Date.now()}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      });
      if (folderHtmlRes.ok) {
        const folderHtml = await folderHtmlRes.text();
        const regex =
          /aria-label="([^"]+\.(?:xlsx|csv|xls))[^"]*"[^>]*?ssk=[\x27"][^\x27"]*?:([a-zA-Z0-9_-]{20,})-0-16/gi;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(folderHtml)) !== null) {
          foundFiles.push({ name: m[1], id: m[2] });
        }
        if (foundFiles.length === 0) {
          const sskMatches = [
            ...folderHtml.matchAll(/ssk=[\x27"][0-9]+:[a-zA-Z0-9_-]+:([a-zA-Z0-9_-]{25,})-0-16[\x27"]/g),
          ];
          const nameMatches = [
            ...folderHtml.matchAll(/aria-label=[\x27"]([^\x27"]+\.(?:xlsx|csv|xls))/gi),
          ];
          if (sskMatches.length > 0 && nameMatches.length > 0) {
            foundFiles.push({ name: nameMatches[0][1], id: sskMatches[0][1] });
          }
        }
      }
    } catch {}
  }

  if (foundFiles.length === 0 && KNOWN_FOLDER_FILES[folderId]) {
    foundFiles.push({
      id: KNOWN_FOLDER_FILES[folderId].id,
      name: KNOWN_FOLDER_FILES[folderId].name,
    });
  }

  if (foundFiles.length === 0) return null;

  // Sort candidates so the file with the newest date in its filename (or preferred extension) is selected first
  foundFiles.sort((a, b) => {
    const dateA = extractLatestDateFromFileName(a.name);
    const dateB = extractLatestDateFromFileName(b.name);
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    const aPref = a.name.toLowerCase().endsWith(`.${preferredFormat}`) ? 1 : 0;
    const bPref = b.name.toLowerCase().endsWith(`.${preferredFormat}`) ? 1 : 0;
    return bPref - aPref;
  });

  const chosen = foundFiles[0];
  return {
    folderId,
    fileId: chosen.id,
    fileName: chosen.name,
    modifiedLabel: chosen.modified || '',
    latestDateInName: extractLatestDateFromFileName(chosen.name),
    downloadUrl: `https://drive.usercontent.google.com/download?id=${chosen.id}&export=download&confirm=t`,
    mimeType: chosen.mimeType,
  };
}

export default async function handler(
  req: IncomingMessage & { query?: any },
  res: ServerResponse & { status?: any; json?: any; send?: any }
) {
  try {
    const host = req.headers.host || 'localhost';
    const parsedUrl = new URL(req.url || '', `https://${host}`);
    const rawUrl = (req.query?.url || parsedUrl.searchParams.get('url') || '').trim();
    const formatParam = String(
      req.query?.format || parsedUrl.searchParams.get('format') || ''
    ).toLowerCase();
    const binaryParam = String(req.query?.binary || parsedUrl.searchParams.get('binary') || '');
    const tokenParam = String(req.query?.token || parsedUrl.searchParams.get('token') || '');
    const scanAllParam = String(req.query?.scanAll || parsedUrl.searchParams.get('scanAll') || '');
    const metaOnlyParam = String(req.query?.metaOnly || parsedUrl.searchParams.get('metaOnly') || '');

    const authHeader =
      (req.headers.authorization as string) || (tokenParam ? `Bearer ${tokenParam}` : '');

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

    // Mode 1: Fast scan of all 5 public shared Google Drive folders (?scanAll=1)
    if (scanAllParam === '1') {
      const p1Url = String(req.query?.panel1Url || parsedUrl.searchParams.get('panel1Url') || DEFAULT_SHARED_FOLDERS.panel1.url);
      const p2Url = String(req.query?.panel2Url || parsedUrl.searchParams.get('panel2Url') || DEFAULT_SHARED_FOLDERS.panel2.url);
      const p3Url = String(req.query?.panel3Url || parsedUrl.searchParams.get('panel3Url') || DEFAULT_SHARED_FOLDERS.panel3.url);
      const opUrl = String(req.query?.opCondUrl || parsedUrl.searchParams.get('opCondUrl') || DEFAULT_SHARED_FOLDERS.page26OpCond.url);
      const lcUrl = String(req.query?.loadCurveUrl || parsedUrl.searchParams.get('loadCurveUrl') || DEFAULT_SHARED_FOLDERS.page26LoadCurve.url);

      const extractFid = (u: string, fallback: string) => u.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] || fallback;

      const [panel1, panel2, panel3, page26OpCond, page26LoadCurve] = await Promise.all([
        scanSingleDriveFolder(extractFid(p1Url, DEFAULT_SHARED_FOLDERS.panel1.folderId), 'xlsx', authHeader),
        scanSingleDriveFolder(extractFid(p2Url, DEFAULT_SHARED_FOLDERS.panel2.folderId), 'csv', authHeader),
        scanSingleDriveFolder(extractFid(p3Url, DEFAULT_SHARED_FOLDERS.panel3.folderId), 'xlsx', authHeader),
        scanSingleDriveFolder(extractFid(opUrl, DEFAULT_SHARED_FOLDERS.page26OpCond.folderId), 'xlsx', authHeader),
        scanSingleDriveFolder(extractFid(lcUrl, DEFAULT_SHARED_FOLDERS.page26LoadCurve.folderId), 'xlsx', authHeader),
      ]);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: true,
          scannedAt: new Date().toISOString(),
          panel1,
          panel2,
          panel3,
          page26OpCond,
          page26LoadCurve,
        })
      );
      return;
    }

    if (!rawUrl) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Missing url parameter' }));
      return;
    }

    const preferredFormat: 'csv' | 'xlsx' = formatParam === 'csv' ? 'csv' : 'xlsx';
    let fetchUrl = rawUrl;
    let isGoogleSheets = false;
    let explicitFileName = '';
    let explicitFileId = '';
    let isDriveApiMedia = false;

    const folderMatch = rawUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) {
      const folderId = folderMatch[1];
      const scanned = await scanSingleDriveFolder(folderId, preferredFormat, authHeader);
      if (!scanned) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error:
              'No Excel (.xlsx) or CSV (.csv) database files found inside the shared Google Drive folder.',
          })
        );
        return;
      }

      if (metaOnlyParam === '1') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, ...scanned }));
        return;
      }

      explicitFileName = scanned.fileName;
      explicitFileId = scanned.fileId;
      if (scanned.mimeType === 'application/vnd.google-apps.spreadsheet') {
        fetchUrl = `https://docs.google.com/spreadsheets/d/${scanned.fileId}/export?format=${preferredFormat}`;
        isGoogleSheets = true;
      } else if (authHeader) {
        fetchUrl = `https://www.googleapis.com/drive/v3/files/${scanned.fileId}?alt=media`;
        isDriveApiMedia = true;
      } else {
        fetchUrl = scanned.downloadUrl;
      }
    } else {
      const sheetsMatch = rawUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (sheetsMatch) {
        const sheetId = sheetsMatch[1];
        explicitFileId = sheetId;
        const gidMatch = rawUrl.match(/[#&?]gid=([0-9]+)/);
        const gidQuery = gidMatch ? `&gid=${gidMatch[1]}` : '';
        fetchUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=${preferredFormat}${gidQuery}`;
        isGoogleSheets = true;
      } else {
        const driveFileMatch =
          rawUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
          rawUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (driveFileMatch) {
          const fileId = driveFileMatch[1];
          explicitFileId = fileId;
          if (authHeader) {
            fetchUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
            isDriveApiMedia = true;
          } else {
            fetchUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
          }
        }
      }
    }

    const fetchHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
      'Cache-Control': 'no-cache',
    };
    if (authHeader && (isDriveApiMedia || fetchUrl.includes('googleapis.com'))) {
      fetchHeaders['Authorization'] = authHeader;
    }

    const response = await fetch(fetchUrl, {
      headers: fetchHeaders,
      redirect: 'follow',
    });

    if (!response.ok) {
      res.statusCode = response.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: `Failed to download shared file (HTTP ${response.status}). Make sure link sharing is set to "Anyone with the link".`,
        })
      );
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    const contentDisposition = response.headers.get('content-disposition') || '';
    let fileName =
      explicitFileName ||
      (isGoogleSheets ? 'Google_Sheets_Database.xlsx' : 'Shared_Drive_Database.csv');
    const fnMatch = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i);
    if (fnMatch && fnMatch[1]) {
      try {
        fileName = decodeURIComponent(fnMatch[1]);
      } catch {
        fileName = fnMatch[1];
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const wantsBinary = binaryParam === '1' || formatParam === 'binary';
    if (wantsBinary) {
      res.statusCode = 200;
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader('X-File-Name', encodeURIComponent(fileName));
      if (explicitFileId) {
        res.setHeader('X-File-Id', explicitFileId);
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'X-File-Name, X-File-Id, Content-Disposition');
      res.end(buffer);
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        fileName,
        fileId: explicitFileId,
        fileSize: buffer.length,
        contentType,
        base64: buffer.toString('base64'),
      })
    );
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: err?.message || 'Failed to fetch shared database URL',
      })
    );
  }
}
