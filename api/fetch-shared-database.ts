import type { IncomingMessage, ServerResponse } from 'http';

const KNOWN_FOLDER_FILES: Record<string, { id: string; name: string }> = {
  '1CMSH2f5hAl0N6F3PHhpr9mwStcX29kgS': {
    id: '1Z7Sy8SEajFuqvfZJkTtBbV0fXEBZHD6N',
    name: 'DTS_Circuit3_19Sheets_Updated_2025-07-01_to_2026-10-18 (1).xlsx',
  },
  '1jqS95Z-nF1SivlJFuka8CcIKiyFBMrZ6': {
    id: '1TnB2X_ctCOsFCQ_4oBJfNMTsilSXmFP-',
    name: 'Daily_Maximum_Power_Consumption_Database_Updated_2026-09-30_to_2026-10-18.csv',
  },
  '15rgLYl3V7sqPDNPY8zOLEz9eDBtZLj2_': {
    id: '1cZTbNwPPL9rom44BZIyI_f_m1mSyHYwK',
    name: 'DTS_Section_Daily_Profile_19Sheets_Updated_2025-07-01_to_2026-10-18.xlsx',
  },
};

export default async function handler(req: IncomingMessage & { query?: any }, res: ServerResponse & { status?: any; json?: any; send?: any }) {
  try {
    const host = req.headers.host || 'localhost';
    const parsedUrl = new URL(req.url || '', `https://${host}`);
    const rawUrl = (req.query?.url || parsedUrl.searchParams.get('url') || '').trim();
    const formatParam = String(req.query?.format || parsedUrl.searchParams.get('format') || '').toLowerCase();
    const binaryParam = String(req.query?.binary || parsedUrl.searchParams.get('binary') || '');
    const tokenParam = String(req.query?.token || parsedUrl.searchParams.get('token') || '');

    if (!rawUrl) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Missing url parameter' }));
      return;
    }

    const authHeader =
      (req.headers.authorization as string) || (tokenParam ? `Bearer ${tokenParam}` : '');

    let fetchUrl = rawUrl;
    let isGoogleSheets = false;
    let explicitFileName = '';
    let isDriveApiMedia = false;

    const folderMatch = rawUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) {
      const folderId = folderMatch[1];
      let foundFiles: { name: string; id: string; mimeType?: string }[] = [];

      if (authHeader) {
        try {
          const driveApiRes = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=%27${folderId}%27+in+parents+and+trashed%3Dfalse&fields=files(id%2Cname%2CmimeType)&orderBy=modifiedTime+desc`,
            { headers: { Authorization: authHeader } }
          );
          if (driveApiRes.ok) {
            const driveData: any = await driveApiRes.json();
            if (Array.isArray(driveData.files) && driveData.files.length > 0) {
              foundFiles = driveData.files.map((f: any) => ({
                name: f.name,
                id: f.id,
                mimeType: f.mimeType,
              }));
            }
          }
        } catch {}
      }

      if (foundFiles.length === 0) {
        try {
          const folderHtmlRes = await fetch(`https://drive.google.com/drive/folders/${folderId}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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

      if (foundFiles.length > 0) {
        const targetFile = foundFiles[0];
        explicitFileName = targetFile.name;
        if (targetFile.mimeType === 'application/vnd.google-apps.spreadsheet') {
          const format = formatParam === 'csv' ? 'csv' : 'xlsx';
          fetchUrl = `https://docs.google.com/spreadsheets/d/${targetFile.id}/export?format=${format}`;
          isGoogleSheets = true;
        } else if (authHeader) {
          fetchUrl = `https://www.googleapis.com/drive/v3/files/${targetFile.id}?alt=media`;
          isDriveApiMedia = true;
        } else {
          fetchUrl = `https://drive.usercontent.google.com/download?id=${targetFile.id}&export=download&confirm=t`;
        }
      } else {
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
    } else {
      const sheetsMatch = rawUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (sheetsMatch) {
        const sheetId = sheetsMatch[1];
        const gidMatch = rawUrl.match(/[#&?]gid=([0-9]+)/);
        const gidQuery = gidMatch ? `&gid=${gidMatch[1]}` : '';
        const format = formatParam === 'csv' ? 'csv' : 'xlsx';
        fetchUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=${format}${gidQuery}`;
        isGoogleSheets = true;
      } else {
        const driveFileMatch =
          rawUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
          rawUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (driveFileMatch) {
          const fileId = driveFileMatch[1];
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
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'X-File-Name, Content-Disposition');
      res.end(buffer);
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        fileName,
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
