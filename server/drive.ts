/**
 * Google Drive File/Folder & Google Sheets Connector (`server/drive.ts`)
 *
 * Supports:
 * - Google Sheets URLs (`docs.google.com/spreadsheets/d/<ID>`) -> CSV export
 * - Direct Google Drive File URLs (`drive.google.com/file/d/<ID>`) -> Direct download
 * - Google Drive Folders (`drive.google.com/drive/folders/<ID>`):
 *   1. Google Drive API v3 when `accessToken` or `GOOGLE_DRIVE_API_KEY` is available
 *   2. Public link-shared `embeddedfolderview?id=<ID>#list` HTML scraper (zero OAuth required)
 */

import type { DriveFileEntry, DriveFolderListing, RawIngestFile } from '../contracts/index.js';
import { convertXlsxToCsvIngestFiles, isXlsxBytes } from '../pipeline/xlsx.js';

export interface ParsedDriveTarget {
  kind: 'folder' | 'sheet' | 'file';
  id: string;
}

/**
 * Parse a Google Drive folder URL, Google Sheet URL, Drive file URL, or raw Drive ID.
 */
export function parseDriveUrl(input: string): ParsedDriveTarget | null {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return null;

  // 1. Google Sheets URL: docs.google.com/spreadsheets/d/<ID>
  const sheetMatch = trimmed.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/i);
  if (sheetMatch?.[1]) {
    return { kind: 'sheet', id: sheetMatch[1] };
  }

  // 2. Google Drive Folder URL: drive.google.com/.../folders/<ID>
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{10,})/i);
  if (folderMatch?.[1]) {
    return { kind: 'folder', id: folderMatch[1] };
  }

  // 3. Google Drive File or Document URL: /file/d/<ID> or /document/d/<ID> or /d/<ID>
  const fileMatch = trimmed.match(/\/(?:file|document)\/d\/([a-zA-Z0-9_-]{10,})/i);
  if (fileMatch?.[1]) {
    return { kind: 'file', id: fileMatch[1] };
  }

  // 4. Query parameter ?id=<ID> or &id=<ID>
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/i);
  if (idParamMatch?.[1]) {
    const id = idParamMatch[1];
    if (/embeddedfolderview|folder/i.test(trimmed)) {
      return { kind: 'folder', id };
    }
    if (/spreadsheets/i.test(trimmed)) {
      return { kind: 'sheet', id };
    }
    return { kind: 'file', id };
  }

  // 5. Generic /d/<ID>
  const genericDMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]{10,})/i);
  if (genericDMatch?.[1]) {
    return { kind: 'file', id: genericDMatch[1] };
  }

  // 6. Raw 25+ char Drive ID
  if (/^[a-zA-Z0-9_-]{25,}$/.test(trimmed)) {
    return { kind: 'folder', id: trimmed };
  }

  return null;
}

function inferMimeTypeFromNameOrHref(name: string, href: string): string {
  const lowerName = name.toLowerCase();
  const lowerHref = href.toLowerCase();
  if (lowerHref.includes('docs.google.com/spreadsheets') || lowerName.endsWith('.gsheet')) {
    return 'application/vnd.google-apps.spreadsheet';
  }
  if (lowerHref.includes('docs.google.com/document') || lowerName.endsWith('.gdoc')) {
    return 'application/vnd.google-apps.document';
  }
  if (lowerName.endsWith('.csv')) return 'text/csv';
  if (lowerName.endsWith('.tsv')) return 'text/tab-separated-values';
  if (lowerName.endsWith('.json')) return 'application/json';
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.txt') || lowerName.endsWith('.md')) return 'text/plain';
  return 'text/csv';
}

/**
 * Parse Google Drive's public `embeddedfolderview?id=<ID>#list` HTML into `DriveFileEntry[]`.
 */
export function parseEmbeddedDriveFolderHtml(
  html: string,
  _folderId: string
): { folderName: string; files: DriveFileEntry[] } {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const rawTitle = titleMatch
    ? titleMatch[1]!.replace(/\s*-\s*Google\s+Drive\s*$/i, '').trim()
    : '';
  const folderName = rawTitle || 'Shared Google Drive Folder';

  const files: DriveFileEntry[] = [];
  const seenIds = new Set<string>();

  const entryRegex =
    /<div[^>]+class="flip-entry"[^>]+id="entry-([a-zA-Z0-9_-]+)"[\s\S]*?<a[^>]+href="([^"]+)"[\s\S]*?<div[^>]+class="flip-entry-title"[^>]*>([^<]+)<\/div>/gi;

  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(html)) !== null) {
    const id = match[1]?.trim() ?? '';
    const href = match[2]?.trim() ?? '';
    const name = match[3]?.trim() ?? '';
    if (!id || !name || seenIds.has(id)) continue;
    seenIds.add(id);

    const mimeType = inferMimeTypeFromNameOrHref(name, href);
    const isSheet = mimeType === 'application/vnd.google-apps.spreadsheet';
    const downloadUrl = isSheet
      ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/export?format=csv`
      : `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;

    files.push({
      id,
      name,
      mimeType,
      webViewLink: href,
      downloadUrl,
    });
  }

  return { folderName, files };
}

/**
 * List files in a Google Drive folder, or resolve a single Google Sheet / Drive file link.
 */
export async function listDriveFolder(
  urlOrId: string,
  accessToken?: string
): Promise<DriveFolderListing> {
  const parsed = parseDriveUrl(urlOrId);
  if (!parsed) {
    throw new Error('Invalid Google Drive folder, file, or Google Sheets URL/ID.');
  }

  if (parsed.kind === 'sheet') {
    const exportUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
      parsed.id
    )}/export?format=csv`;
    return {
      folderId: parsed.id,
      folderName: 'Google Sheets Ledger',
      source: 'sheets_export',
      files: [
        {
          id: parsed.id,
          name: `google_sheet_${parsed.id.slice(0, 8)}.csv`,
          mimeType: 'text/csv',
          webViewLink: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(parsed.id)}/edit`,
          downloadUrl: exportUrl,
        },
      ],
    };
  }

  if (parsed.kind === 'file') {
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(
      parsed.id
    )}`;
    return {
      folderId: parsed.id,
      folderName: 'Google Drive File',
      source: 'direct_file',
      files: [
        {
          id: parsed.id,
          name: `drive_file_${parsed.id.slice(0, 8)}.csv`,
          mimeType: 'text/csv',
          webViewLink: `https://drive.google.com/file/d/${encodeURIComponent(parsed.id)}/view`,
          downloadUrl,
        },
      ],
    };
  }

  const folderId = parsed.id;
  const driveApiKey = process.env.GOOGLE_DRIVE_API_KEY?.trim() || '';

  // 1. Try Google Drive API v3 if OAuth accessToken or GOOGLE_DRIVE_API_KEY is configured
  if (accessToken || driveApiKey) {
    try {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const apiUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,webViewLink)${
        !accessToken && driveApiKey ? `&key=${encodeURIComponent(driveApiKey)}` : ''
      }`;
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      const res = await fetch(apiUrl, { headers });
      if (res.ok) {
        const data = (await res.json()) as {
          files?: Array<{
            id: string;
            name: string;
            mimeType: string;
            webViewLink?: string;
          }>;
        };
        if (Array.isArray(data.files) && data.files.length > 0) {
          const files: DriveFileEntry[] = data.files.map((f) => {
            const isSheet = f.mimeType === 'application/vnd.google-apps.spreadsheet';
            return {
              id: f.id,
              name: f.name,
              mimeType: f.mimeType,
              webViewLink: f.webViewLink,
              downloadUrl: isSheet
                ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(f.id)}/export?format=csv`
                : `https://drive.google.com/uc?export=download&id=${encodeURIComponent(f.id)}`,
            };
          });
          return {
            folderId,
            folderName: 'Connected Google Drive Folder',
            files,
            source: 'drive_api',
          };
        }
      }
    } catch {
      // Fall through to embedded folder HTML view
    }
  }

  // 2. Fetch public link-shared Google Drive embeddedfolderview HTML (no OAuth required)
  const embedUrl = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(
    folderId
  )}#list`;
  const embedRes = await fetch(embedUrl);
  if (embedRes.ok) {
    const html = await embedRes.text();
    const parsedHtml = parseEmbeddedDriveFolderHtml(html, folderId);
    return {
      folderId,
      folderName: parsedHtml.folderName,
      files: parsedHtml.files,
      source: 'embedded_html',
    };
  }

  throw new Error(
    `Unable to list Google Drive folder (${embedRes.status}). Ensure the folder is shared with "Anyone with the link" or provide an access token.`
  );
}

/**
 * Download a file or Google Sheet from Google Drive and package it as a `RawIngestFile`.
 */
export async function fetchDriveFileContent(
  fileIdOrUrl: string,
  mimeType?: string,
  accessToken?: string,
  fileNameHint?: string
): Promise<RawIngestFile> {
  const parsed = parseDriveUrl(fileIdOrUrl);
  const id = parsed?.id ?? fileIdOrUrl.trim();
  if (!id) {
    throw new Error('Missing Google Drive file ID or URL.');
  }

  const isSheet =
    parsed?.kind === 'sheet' ||
    mimeType === 'application/vnd.google-apps.spreadsheet' ||
    fileIdOrUrl.includes('docs.google.com/spreadsheets');

  const isGoogleDoc =
    mimeType === 'application/vnd.google-apps.document' ||
    fileIdOrUrl.includes('docs.google.com/document');

  const headers: Record<string, string> = {};
  let downloadUrl: string;

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
    if (isSheet) {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        id
      )}/export?mimeType=text/csv`;
    } else if (isGoogleDoc) {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        id
      )}/export?mimeType=text/plain`;
    } else {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        id
      )}?alt=media&supportsAllDrives=true`;
    }
  } else {
    if (isSheet) {
      downloadUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
        id
      )}/export?format=csv`;
    } else if (isGoogleDoc) {
      downloadUrl = `https://docs.google.com/document/d/${encodeURIComponent(
        id
      )}/export?format=txt`;
    } else {
      downloadUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
    }
  }

  const res = await fetch(downloadUrl, { headers });
  if (!res.ok) {
    throw new Error(
      `Google Drive download returned HTTP ${res.status}. Ensure the file or sheet is link-shared.`
    );
  }

  const resolvedContentType = (
    res.headers.get('content-type') ??
    mimeType ??
    (isSheet ? 'text/csv' : 'text/plain')
  )
    .split(';')[0]!
    .trim()
    .toLowerCase();

  const isBinary =
    resolvedContentType === 'application/pdf' ||
    resolvedContentType.startsWith('image/') ||
    resolvedContentType.includes('spreadsheetml') ||
    resolvedContentType.includes('octet-stream');

  const defaultExt = isSheet ? '.csv' : isBinary ? '.pdf' : '.csv';
  const resolvedName =
    fileNameHint && fileNameHint.trim().length > 0
      ? fileNameHint.trim()
      : `drive_${id.slice(0, 10)}${defaultExt}`;

  if (isBinary) {
    const arrayBuffer = await res.arrayBuffer();
    const u8 = new Uint8Array(arrayBuffer);
    if (isXlsxBytes(u8)) {
      const xlsxName =
        fileNameHint && fileNameHint.trim().length > 0
          ? fileNameHint.trim()
          : `drive_${id.slice(0, 10)}.xlsx`;
      try {
        const converted = convertXlsxToCsvIngestFiles(u8, xlsxName);
        if (converted.files.length === 1 && converted.files[0]) {
          return converted.files[0];
        }
        if (converted.files.length > 1 && converted.files[0]) {
          const mergedLines = [converted.files[0].content];
          for (const extraFile of converted.files.slice(1)) {
            const extraRows = extraFile.content.split(/\r?\n/).slice(1);
            if (extraRows.length > 0) {
              mergedLines.push(extraRows.join('\n'));
            }
          }
          return {
            ...converted.files[0],
            content: mergedLines.join('\n'),
          };
        }
      } catch {
        // Fall through to base64 xlsx
      }
      return {
        name: xlsxName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        content: Buffer.from(arrayBuffer).toString('base64'),
        encoding: 'base64',
      };
    }
    return {
      name: resolvedName,
      mimeType: resolvedContentType,
      content: Buffer.from(arrayBuffer).toString('base64'),
      encoding: 'base64',
    };
  }

  const textContent = await res.text();
  return {
    name: resolvedName,
    mimeType: isSheet ? 'text/csv' : resolvedContentType || 'text/csv',
    content: textContent,
    encoding: 'utf8',
  };
}
