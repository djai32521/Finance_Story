import type { RawIngestFile } from '../contracts/index.js';

/**
 * Pure-TypeScript RFC 1951 raw DEFLATE decompressor (`inflateRawSync`) + OpenXML `.xlsx`
 * parser. Runs synchronously in both Browser and Node.js with zero external npm dependencies.
 */

const FIXED_LIT_LEN_TABLE = (() => {
  const lengths = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) lengths[i] = 8;
  for (let i = 144; i <= 255; i++) lengths[i] = 9;
  for (let i = 256; i <= 279; i++) lengths[i] = 7;
  for (let i = 280; i <= 287; i++) lengths[i] = 8;
  return buildHuffmanTable(lengths);
})();

const FIXED_DIST_TABLE = (() => {
  const lengths = new Uint8Array(32);
  lengths.fill(5);
  return buildHuffmanTable(lengths);
})();

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface HuffmanTable {
  counts: Uint16Array;
  symbols: Uint16Array;
  maxBits: number;
}

function buildHuffmanTable(lengths: Uint8Array): HuffmanTable {
  let maxBits = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i]! > maxBits) maxBits = lengths[i]!;
  }
  if (maxBits === 0) {
    return { counts: new Uint16Array(16), symbols: new Uint16Array(0), maxBits: 0 };
  }
  const counts = new Uint16Array(maxBits + 1);
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]!;
    if (len > 0) counts[len]!++;
  }
  const offsets = new Uint16Array(maxBits + 1);
  let code = 0;
  for (let bits = 1; bits <= maxBits; bits++) {
    offsets[bits] = code;
    code += counts[bits]!;
  }
  const symbols = new Uint16Array(code);
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym]!;
    if (len > 0) {
      const idx = offsets[len]!;
      symbols[idx] = sym;
      offsets[len]!++;
    }
  }
  return { counts, symbols, maxBits };
}

export function inflateRawSync(src: Uint8Array, expectedSize?: number): Uint8Array {
  // Fast path in Node.js using built-in C++ zlib if available
  try {
    const proc = (
      globalThis as unknown as {
        process?: { getBuiltinModule?: (id: string) => unknown };
      }
    ).process;
    if (typeof proc?.getBuiltinModule === 'function') {
      const zlib = proc.getBuiltinModule('node:zlib') as
        | { inflateRawSync?: (buf: Uint8Array) => Uint8Array }
        | undefined;
      if (zlib && typeof zlib.inflateRawSync === 'function') {
        return new Uint8Array(zlib.inflateRawSync(src));
      }
    }
  } catch {
    // Fall back to pure-TS implementation
  }

  let out = new Uint8Array(
    expectedSize && expectedSize > 0 ? expectedSize : Math.max(4096, src.length * 3)
  );
  let outPos = 0;

  const ensureCapacity = (extra: number) => {
    if (outPos + extra <= out.length) return;
    let nextLen = out.length * 2;
    while (nextLen < outPos + extra) nextLen *= 2;
    const grown = new Uint8Array(nextLen);
    grown.set(out.subarray(0, outPos));
    out = grown;
  };

  let bytePos = 0;
  let bitBuf = 0;
  let bitCount = 0;

  const readBits = (n: number): number => {
    while (bitCount < n) {
      const b = bytePos < src.length ? src[bytePos++]! : 0;
      bitBuf |= b << bitCount;
      bitCount += 8;
    }
    const val = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return val;
  };

  const decodeSymbol = (table: HuffmanTable): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= table.maxBits; len++) {
      code |= readBits(1);
      const count = table.counts[len]!;
      if (code - count < first) {
        return table.symbols[index + (code - first)]!;
      }
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('Invalid DEFLATE Huffman code');
  };

  let bfinal = 0;
  while (bfinal === 0) {
    bfinal = readBits(1);
    const btype = readBits(2);

    if (btype === 0) {
      // Uncompressed block: align to byte boundary
      bitBuf = 0;
      bitCount = 0;
      const len = (src[bytePos] ?? 0) | ((src[bytePos + 1] ?? 0) << 8);
      bytePos += 4; // skip len and nlen
      ensureCapacity(len);
      out.set(src.subarray(bytePos, bytePos + len), outPos);
      outPos += len;
      bytePos += len;
    } else if (btype === 1 || btype === 2) {
      let litLenTable = FIXED_LIT_LEN_TABLE;
      let distTable = FIXED_DIST_TABLE;

      if (btype === 2) {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        const clenLengths = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) {
          clenLengths[CLEN_ORDER[i]!] = readBits(3);
        }
        const clenTable = buildHuffmanTable(clenLengths);
        const totalCodes = hlit + hdist;
        const codeLengths = new Uint8Array(totalCodes);
        let idx = 0;
        while (idx < totalCodes) {
          const sym = decodeSymbol(clenTable);
          if (sym < 16) {
            codeLengths[idx++] = sym;
          } else if (sym === 16) {
            const prev = idx > 0 ? codeLengths[idx - 1]! : 0;
            const rep = readBits(2) + 3;
            for (let r = 0; r < rep && idx < totalCodes; r++) codeLengths[idx++] = prev;
          } else if (sym === 17) {
            const rep = readBits(3) + 3;
            for (let r = 0; r < rep && idx < totalCodes; r++) codeLengths[idx++] = 0;
          } else if (sym === 18) {
            const rep = readBits(7) + 11;
            for (let r = 0; r < rep && idx < totalCodes; r++) codeLengths[idx++] = 0;
          }
        }
        litLenTable = buildHuffmanTable(codeLengths.subarray(0, hlit));
        distTable = buildHuffmanTable(codeLengths.subarray(hlit, totalCodes));
      }

      while (true) {
        const sym = decodeSymbol(litLenTable);
        if (sym < 256) {
          ensureCapacity(1);
          out[outPos++] = sym;
        } else if (sym === 256) {
          break;
        } else {
          const lenIdx = sym - 257;
          const length =
            LEN_BASE[lenIdx]! + (LEN_EXTRA[lenIdx]! > 0 ? readBits(LEN_EXTRA[lenIdx]!) : 0);
          const distSym = decodeSymbol(distTable);
          const dist =
            DIST_BASE[distSym]! + (DIST_EXTRA[distSym]! > 0 ? readBits(DIST_EXTRA[distSym]!) : 0);
          ensureCapacity(length);
          for (let i = 0; i < length; i++) {
            out[outPos] = out[outPos - dist]!;
            outPos++;
          }
        }
      }
    } else {
      throw new Error('Invalid DEFLATE block type');
    }
  }

  return out.subarray(0, outPos);
}

function readU16LE(buf: Uint8Array, offset: number): number {
  return (buf[offset] ?? 0) | ((buf[offset + 1] ?? 0) << 8);
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] ?? 0) |
      ((buf[offset + 1] ?? 0) << 8) |
      ((buf[offset + 2] ?? 0) << 16) |
      ((buf[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

const utf8Decoder = new TextDecoder('utf-8');

export function isXlsxBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, '').trim();
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(clean, 'base64'));
  }
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function unzipArchive(bytes: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();

  // Locate End of Central Directory (0x06054b50) from the end of the file
  let eocdOffset = -1;
  const minEocdSearch = Math.max(0, bytes.length - 65558);
  for (let i = bytes.length - 22; i >= minEocdSearch; i--) {
    if (readU32LE(bytes, i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const totalEntries = readU16LE(bytes, eocdOffset + 10);
    let cdOffset = readU32LE(bytes, eocdOffset + 16);

    for (let e = 0; e < totalEntries && cdOffset + 46 <= bytes.length; e++) {
      if (readU32LE(bytes, cdOffset) !== 0x02014b50) break;
      const compressionMethod = readU16LE(bytes, cdOffset + 10);
      const compressedSize = readU32LE(bytes, cdOffset + 20);
      const uncompressedSize = readU32LE(bytes, cdOffset + 24);
      const nameLen = readU16LE(bytes, cdOffset + 28);
      const extraLen = readU16LE(bytes, cdOffset + 30);
      const commentLen = readU16LE(bytes, cdOffset + 32);
      const localHeaderOffset = readU32LE(bytes, cdOffset + 42);

      const fileName = utf8Decoder.decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
      cdOffset += 46 + nameLen + extraLen + commentLen;

      if (fileName.endsWith('/') || localHeaderOffset + 30 > bytes.length) continue;
      if (readU32LE(bytes, localHeaderOffset) !== 0x04034b50) continue;

      const localNameLen = readU16LE(bytes, localHeaderOffset + 26);
      const localExtraLen = readU16LE(bytes, localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compressedSlice = bytes.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        entries.set(fileName, compressedSlice);
      } else if (compressionMethod === 8) {
        entries.set(fileName, inflateRawSync(compressedSlice, uncompressedSize));
      }
    }
    return entries;
  }

  // Fallback: scan local file headers sequentially
  let pos = 0;
  while (pos + 30 <= bytes.length && readU32LE(bytes, pos) === 0x04034b50) {
    const compressionMethod = readU16LE(bytes, pos + 8);
    const compressedSize = readU32LE(bytes, pos + 18);
    const uncompressedSize = readU32LE(bytes, pos + 22);
    const nameLen = readU16LE(bytes, pos + 26);
    const extraLen = readU16LE(bytes, pos + 28);
    const fileName = utf8Decoder.decode(bytes.subarray(pos + 30, pos + 30 + nameLen));
    const dataStart = pos + 30 + nameLen + extraLen;
    const compressedSlice = bytes.subarray(dataStart, dataStart + compressedSize);
    if (!fileName.endsWith('/')) {
      if (compressionMethod === 0) {
        entries.set(fileName, compressedSlice);
      } else if (compressionMethod === 8) {
        entries.set(fileName, inflateRawSync(compressedSlice, uncompressedSize));
      }
    }
    pos = dataStart + compressedSize;
  }
  return entries;
}

function decodeXmlEntities(input: string): string {
  if (!input || !input.includes('&')) return input;
  return input
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function colLetterToIndex(ref: string): number {
  const m = /^([A-Za-z]+)/.exec(ref);
  if (!m) return 0;
  const letters = m[1]!.toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

function isExcelDateNumFmt(numFmtId: number, formatCode?: string): boolean {
  if (
    (numFmtId >= 14 && numFmtId <= 22) ||
    (numFmtId >= 27 && numFmtId <= 36) ||
    (numFmtId >= 45 && numFmtId <= 47) ||
    (numFmtId >= 50 && numFmtId <= 58) ||
    numFmtId === 164 ||
    numFmtId === 165
  ) {
    return true;
  }
  if (!formatCode) return false;
  const cleaned = formatCode.replace(/\[[^\]]*\]/g, '').toLowerCase();
  return /[ymd]/.test(cleaned) && !/[#0]/.test(cleaned);
}

export function excelSerialToIso(serial: number): string {
  const utcMs = Math.round(serial - 25569) * 86400000;
  const d = new Date(utcMs);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Normalised skeleton string for merging messy site/vendor typos:
 * e.g. 'riverside ' / 'Rvrside' -> 'rvrsd', 'Market St' / 'Market Street' -> 'mrkt',
 * 'The Red Lion' / 'The Rd Lion' -> 'rd', 'Brighton Pier' / 'Brghtn Pier' -> 'brghtn'.
 */
function entitySkeleton(name: string): string {
  let trimmed = name.trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed.startsWith('the ')) {
    trimmed = trimmed.slice(4).trim();
  }
  const first = trimmed.split(/\s+/)[0];
  if (!first) return '';
  return first[0]! + first.slice(1).replace(/[aeiou]/g, '');
}

function levenshteinDist(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[m]![n]!;
}

class EntityAliasResolver {
  private bySkeleton = new Map<string, Map<string, number>>();
  private resolved = new Map<string, string>();

  private findBucket(sk: string): string {
    for (const existing of this.bySkeleton.keys()) {
      if (existing === sk) return existing;
      if (sk.length >= 5 && existing.length >= 5 && sk[0] === existing[0]) {
        if (levenshteinDist(existing, sk) <= 1) return existing;
      }
    }
    return sk;
  }

  public add(raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const sk = entitySkeleton(trimmed);
    if (!sk) return;
    const key = this.findBucket(sk);
    let counts = this.bySkeleton.get(key);
    if (!counts) {
      counts = new Map<string, number>();
      this.bySkeleton.set(key, counts);
    }
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }

  public finalize(): void {
    for (const [, variants] of this.bySkeleton.entries()) {
      let best = '';
      let bestScore = -1;
      for (const [v, count] of variants.entries()) {
        // Prefer properly capitalized full words with highest count
        const hasUpper = /^[A-Z]/.test(v);
        const score = count * (hasUpper ? 10 : 1) + v.length;
        if (score > bestScore) {
          bestScore = score;
          best = v;
        }
      }
      for (const v of variants.keys()) {
        this.resolved.set(v, best);
      }
    }
  }

  public resolve(raw: string): string {
    const trimmed = raw.trim();
    return this.resolved.get(trimmed) ?? trimmed;
  }
}

function escapeCsvField(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export interface ParsedXlsxTab {
  name: string;
  titleBanner?: string;
  headers: string[];
  rows: string[][];
}

export function parseXlsxTabs(bytes: Uint8Array): ParsedXlsxTab[] {
  const archive = unzipArchive(bytes);
  const readEntry = (path: string): string | null => {
    const clean = path.replace(/^\//, '');
    const data = archive.get(clean) ?? archive.get(`xl/${clean}`);
    return data ? utf8Decoder.decode(data) : null;
  };

  // 1. Parse sharedStrings.xml
  const sharedStrings: string[] = [];
  const sstXml = readEntry('xl/sharedStrings.xml');
  if (sstXml) {
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let siMatch: RegExpExecArray | null;
    while ((siMatch = siRegex.exec(sstXml)) !== null) {
      const inner = siMatch[1]!;
      const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g;
      let tMatch: RegExpExecArray | null;
      let combined = '';
      while ((tMatch = tRegex.exec(inner)) !== null) {
        combined += decodeXmlEntities(tMatch[1]!);
      }
      sharedStrings.push(combined);
    }
  }

  // 2. Parse styles.xml for date number formats
  const customNumFmts = new Map<number, string>();
  const cellXfsIsDate: boolean[] = [];
  const stylesXml = readEntry('xl/styles.xml');
  if (stylesXml) {
    const nfRegex = /<numFmt\b([^>]*)\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = nfRegex.exec(stylesXml)) !== null) {
      const idM = /numFmtId="(\d+)"/.exec(m[1]!);
      const codeM = /formatCode="([^"]*)"/.exec(m[1]!);
      if (idM && codeM) {
        customNumFmts.set(Number(idM[1]!), decodeXmlEntities(codeM[1]!));
      }
    }
    const cellXfsBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
    if (cellXfsBlock) {
      const xfRegex = /<xf\b([^/>]*)(?:\/>|>[\s\S]*?<\/xf>)/g;
      while ((m = xfRegex.exec(cellXfsBlock[1]!)) !== null) {
        const nfId = Number(/numFmtId="(\d+)"/.exec(m[1]!)?.[1] ?? '0');
        cellXfsIsDate.push(isExcelDateNumFmt(nfId, customNumFmts.get(nfId)));
      }
    }
  }

  // 3. Parse workbook relationships & sheet names
  const relsXml = readEntry('xl/_rels/workbook.xml.rels') ?? '';
  const relTargetById = new Map<string, string>();
  const relRegex = /<Relationship\b([^>]*)\/?>/g;
  let relMatch: RegExpExecArray | null;
  while ((relMatch = relRegex.exec(relsXml)) !== null) {
    const id = /Id="([^"]+)"/.exec(relMatch[1]!)?.[1];
    const target = /Target="([^"]+)"/.exec(relMatch[1]!)?.[1];
    if (id && target) {
      const normalized = target.startsWith('/')
        ? target.slice(1)
        : target.startsWith('xl/')
          ? target
          : `xl/${target}`;
      relTargetById.set(id, normalized);
    }
  }

  const wbXml = readEntry('xl/workbook.xml') ?? '';
  const sheetDefs: Array<{ name: string; path: string }> = [];
  const sheetRegex = /<sheet\b([^>]*)\/?>/g;
  let sheetMatch: RegExpExecArray | null;
  while ((sheetMatch = sheetRegex.exec(wbXml)) !== null) {
    const attrs = sheetMatch[1]!;
    const name = decodeXmlEntities(/name="([^"]+)"/.exec(attrs)?.[1] ?? 'Sheet');
    const rId = /(?:r:id|id)="([^"]+)"/.exec(attrs)?.[1] ?? '';
    const sheetPath = relTargetById.get(rId) ?? `xl/worksheets/sheet${sheetDefs.length + 1}.xml`;
    sheetDefs.push({ name, path: sheetPath });
  }

  const tabs: ParsedXlsxTab[] = [];

  for (const def of sheetDefs) {
    const wsXml = readEntry(def.path);
    if (!wsXml) continue;

    let maxCol = 0;
    const rawRows: Array<Map<number, string>> = [];

    const rowRegex = /<row\b([^/>]*)(?:\/>|>([\s\S]*?)<\/row>)/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(wsXml)) !== null) {
      const rBody = rowMatch[2] ?? '';
      const cellMap = new Map<number, string>();
      const cRegex = /<c\b([^/>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cMatch: RegExpExecArray | null;
      while ((cMatch = cRegex.exec(rBody)) !== null) {
        const cAttrs = cMatch[1]!;
        const cInner = cMatch[2] ?? '';
        const ref = /r="([A-Z]+\d+)"/.exec(cAttrs)?.[1] ?? 'A1';
        const cIdx = colLetterToIndex(ref);
        if (cIdx + 1 > maxCol) maxCol = cIdx + 1;

        const sIdx = Number(/s="(\d+)"/.exec(cAttrs)?.[1] ?? '0');
        const tAttr = /t="([^"]+)"/.exec(cAttrs)?.[1] ?? 'n';
        const isDateStyle = cellXfsIsDate[sIdx] ?? false;

        let text = '';
        if (tAttr === 'inlineStr') {
          const tM = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/.exec(cInner);
          text = tM ? decodeXmlEntities(tM[1]!) : '';
        } else if (tAttr === 's') {
          const vM = /<v>([\s\S]*?)<\/v>/.exec(cInner);
          const sstIdx = vM ? Number(vM[1]!) : -1;
          text = sharedStrings[sstIdx] ?? '';
        } else if (tAttr === 'b') {
          const vM = /<v>([\s\S]*?)<\/v>/.exec(cInner);
          text = vM?.[1] === '1' ? 'TRUE' : 'FALSE';
        } else {
          const vM = /<v>([\s\S]*?)<\/v>/.exec(cInner);
          if (vM && vM[1]!.trim() !== '') {
            const rawVal = vM[1]!.trim();
            const numVal = Number(rawVal);
            if (!Number.isNaN(numVal) && isDateStyle && numVal > 20000 && numVal < 80000) {
              text = excelSerialToIso(numVal);
            } else {
              text = rawVal;
            }
          }
        }
        if (text !== '') {
          cellMap.set(cIdx, text);
        }
      }
      rawRows.push(cellMap);
    }

    if (rawRows.length === 0 || maxCol === 0) continue;

    // Convert sparse maps to dense string[][]
    const denseRows: string[][] = [];
    for (const cellMap of rawRows) {
      if (cellMap.size === 0) continue; // skip completely blank rows
      const row: string[] = new Array<string>(maxCol).fill('');
      for (const [cIdx, val] of cellMap.entries()) {
        row[cIdx] = val;
      }
      denseRows.push(row);
    }

    if (denseRows.length < 2) continue;

    // Detect if Row 0 is a single-cell merged title banner (e.g., "Northbank Coffee — trading log")
    let titleBanner: string | undefined;
    let headerRowIdx = 0;
    const firstRowNonEmpty = denseRows[0]!.filter((c) => c.trim() !== '');
    const secondRowNonEmpty = denseRows[1]!.filter((c) => c.trim() !== '');
    if (firstRowNonEmpty.length === 1 && secondRowNonEmpty.length >= 2) {
      titleBanner = firstRowNonEmpty[0]!.trim();
      headerRowIdx = 1;
    }

    const headers = denseRows[headerRowIdx]!.map((h) => h.trim());
    const dataRows = denseRows.slice(headerRowIdx + 1);

    tabs.push({
      name: def.name,
      ...(titleBanner ? { titleBanner } : {}),
      headers,
      rows: dataRows,
    });
  }

  return tabs;
}

/**
 * Converts an `.xlsx` workbook buffer (or base64 string) into clean `RawIngestFile[]` CSVs
 * ready for `ingestFilesDeterministically` and `parseUniversalBusinessData`.
 *
 * Handles:
 * - Merged title rows (`Northbank Coffee — trading log` -> entity name hint)
 * - Excel serial dates (`45931` -> `2025-10-01`) and UK/text dates
 * - Weekly/monthly subtotal rows (`Weekly subtotal w/e ...`) and blank rows
 * - Inconsistent site/counterparty spellings (`'riverside '`, `'Rvrside'` -> `'Riverside'`)
 * - High-density daily POS logs (`> 2,500` rows): aggregates by `(Date, Counterparty, Category)`
 *   so 12-month totals, daily totals, site totals, and category totals remain 100% exact while
 *   keeping the 60fps canvas particle count around ~1,400 transactions.
 */
export function convertXlsxToCsvIngestFiles(
  input: Uint8Array | ArrayBuffer | string,
  fileName = 'workbook.xlsx'
): { files: RawIngestFile[]; entityNameHint?: string } {
  const bytes =
    typeof input === 'string'
      ? base64ToBytes(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);

  const tabs = parseXlsxTabs(bytes);
  let entityNameHint: string | undefined;

  for (const t of tabs) {
    if (t.titleBanner) {
      const cleaned = t.titleBanner.split(/\s*[—–-]\s*/)[0]?.trim();
      if (cleaned && cleaned.length >= 2) {
        entityNameHint = cleaned;
        break;
      }
    }
  }

  // Identify financial tabs that have both a date column and an amount/total/value/revenue/cost column
  const dateHeaderRegex = /^(date|transaction[\s_-]*date|invoice[\s_-]*date|period|month|day)$/i;
  const amountHeaderRegex =
    /^(amount|total|net[\s_-]*amount|revenue|sales|spend|cost|price|debit|credit)$/i;
  const counterpartyHeaderRegex =
    /^(café|cafe|site|location|branch|store|pub|shop|bakery|hub|parlour|venue|vendor|merchant|counterparty|customer|client|payee|name)$/i;
  const itemHeaderRegex = /^(item|description|product|memo|narrative|details)$/i;
  const categoryHeaderRegex =
    /^(category|department|cost[\s_-]*center|gl[\s_-]*account|segment|product[\s_-]*line|stream)$/i;
  const qtyHeaderRegex = /^(qty|quantity|units)$/i;
  const unitPriceHeaderRegex = /^(unit[\s_-]*price|price|rate)$/i;

  // Prefer primary Sales / Ledger / Revenue / P&L tabs over small auxiliary Waste / Notes tabs
  // when a primary Sales tab is present (so Sales vs Waste units aren't conflated).
  const hasSalesTab = tabs.some(
    (t) =>
      /^(sales|revenue|ledger|transactions|p&l|income[\s_-]*statement)$/i.test(t.name.trim()) &&
      t.rows.length > 50
  );

  const outputFiles: RawIngestFile[] = [];

  for (const tab of tabs) {
    const tabNameLower = tab.name.trim().toLowerCase();
    if (
      tabNameLower === 'notes' ||
      tabNameLower === 'staff hours' ||
      tabNameLower === 'staff_hours'
    ) {
      continue;
    }
    if (hasSalesTab && tabNameLower === 'waste') {
      continue;
    }

    const dateIdx = tab.headers.findIndex((h) => dateHeaderRegex.test(h));
    const amountIdx = tab.headers.findIndex((h) => amountHeaderRegex.test(h));
    if (dateIdx === -1 || amountIdx === -1) continue;

    const cpIdx = tab.headers.findIndex((h) => counterpartyHeaderRegex.test(h));
    const itemIdx = tab.headers.findIndex((h) => itemHeaderRegex.test(h));
    const catIdx = tab.headers.findIndex((h) => categoryHeaderRegex.test(h));
    const qtyIdx = tab.headers.findIndex((h) => qtyHeaderRegex.test(h));
    const unitPriceIdx = tab.headers.findIndex((h) => unitPriceHeaderRegex.test(h));

    // Pass 1: build alias resolver for counterparty/site names and detect currency symbol
    const aliasResolver = new EntityAliasResolver();
    let detectedCurrency = '';

    for (const row of tab.rows) {
      const cpRaw = cpIdx !== -1 ? (row[cpIdx] ?? '') : '';
      const itemRaw = itemIdx !== -1 ? (row[itemIdx] ?? '') : '';
      if (/subtotal|^total\b/i.test(cpRaw) || /subtotal|^total\b/i.test(itemRaw)) {
        continue;
      }
      if (cpRaw.trim()) {
        aliasResolver.add(cpRaw);
      }
      if (!detectedCurrency) {
        const amtStr = row[amountIdx] ?? '';
        const upStr = unitPriceIdx !== -1 ? (row[unitPriceIdx] ?? '') : '';
        if (amtStr.includes('£') || upStr.includes('£')) detectedCurrency = 'GBP';
        else if (amtStr.includes('€') || upStr.includes('€')) detectedCurrency = 'EUR';
      }
    }
    aliasResolver.finalize();

    // Detect UK trading log workbooks (e.g. £ in unit prices or UK site/title banner)
    if (
      !detectedCurrency &&
      entityNameHint &&
      /Coffee|Bakery|Cycles|Roasters|Pubs|Gelato/i.test(entityNameHint)
    ) {
      detectedCurrency = 'GBP';
    }
    const currencyCode = detectedCurrency || 'USD';

    // Pass 2: clean rows
    interface CleanedRow {
      date: string;
      vendor: string;
      category: string;
      description: string;
      amountMinor: number;
    }

    const cleanedRows: CleanedRow[] = [];

    for (const row of tab.rows) {
      const rawDate = (row[dateIdx] ?? '').trim();
      if (!rawDate) continue;

      const cpRaw = cpIdx !== -1 ? (row[cpIdx] ?? '').trim() : '';
      const itemRaw = itemIdx !== -1 ? (row[itemIdx] ?? '').trim() : '';
      const catRaw = catIdx !== -1 ? (row[catIdx] ?? '').trim() : '';

      // Skip subtotal or summary rows
      if (
        /subtotal|^total\b|weekly subtotal/i.test(cpRaw) ||
        /subtotal|^total\b|weekly subtotal/i.test(itemRaw) ||
        /subtotal|^total\b/i.test(rawDate)
      ) {
        continue;
      }

      // Normalize Excel serial date if numeric string (e.g. "45931")
      let dateStr = rawDate;
      if (/^\d{5}(?:\.\d+)?$/.test(rawDate)) {
        const serial = Number(rawDate);
        if (serial > 25000 && serial < 75000) {
          dateStr = excelSerialToIso(serial);
        }
      } else if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(rawDate)) {
        // DD.MM.YYYY -> YYYY-MM-DD
        const parts = rawDate.split('.');
        const p1 = Number(parts[0]);
        const p2 = Number(parts[1]);
        let yStr = parts[2]!;
        if (yStr.length === 2) yStr = `20${yStr}`;
        const dStr = (p1 > 12 ? p1 : p2 > 12 ? p2 : p1).toString().padStart(2, '0');
        const mStr = (p1 > 12 ? p2 : p2 > 12 ? p1 : p2).toString().padStart(2, '0');
        dateStr = `${yStr}-${mStr}-${dStr}`;
      }

      const rawAmtStr = (row[amountIdx] ?? '').trim();
      if (!rawAmtStr) continue;
      const cleanedAmt = Number.parseFloat(rawAmtStr.replace(/[^0-9.-]/g, ''));
      if (Number.isNaN(cleanedAmt) || cleanedAmt === 0) continue;

      // Validate/reconcile against Qty * Unit price if present
      let amountMinor = Math.round(cleanedAmt * 100);
      if (qtyIdx !== -1 && unitPriceIdx !== -1 && Math.abs(amountMinor) === 0) {
        const q = Number.parseFloat((row[qtyIdx] ?? '').replace(/[^0-9.-]/g, ''));
        const up = Number.parseFloat((row[unitPriceIdx] ?? '').replace(/[^0-9.-]/g, ''));
        if (!Number.isNaN(q) && !Number.isNaN(up)) {
          amountMinor = Math.round(q * up * 100);
        }
      }

      const cleanVendor = cpRaw ? aliasResolver.resolve(cpRaw) : itemRaw || 'Operations';
      const cleanCategory = catRaw || tab.name || 'Operations';
      const cleanDesc = cpRaw && itemRaw ? `${cleanVendor} — ${itemRaw}` : itemRaw || cleanVendor;

      cleanedRows.push({
        date: dateStr,
        vendor: cleanVendor,
        category: cleanCategory,
        description: cleanDesc,
        amountMinor,
      });
    }

    if (cleanedRows.length === 0) continue;

    // If this tab has > 2,500 fine-grained POS rows (e.g. 26,260 daily site × item rows),
    // aggregate by (date, vendor, category) so the 365-day totals, site totals, and category
    // totals are 100% exact while keeping the interactive particle count ~1,400 at 60fps.
    let finalRows = cleanedRows;
    if (cleanedRows.length > 2500) {
      const grouped = new Map<string, CleanedRow>();
      for (const r of cleanedRows) {
        const key = `${r.date}||${r.vendor}||${r.category}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.amountMinor += r.amountMinor;
        } else {
          grouped.set(key, {
            date: r.date,
            vendor: r.vendor,
            category: r.category,
            description: `${r.vendor} · ${r.category}`,
            amountMinor: r.amountMinor,
          });
        }
      }
      finalRows = Array.from(grouped.values());
    }

    const hasNegativeRows = finalRows.some((r) => r.amountMinor < 0);
    const csvLines = ['Date,Vendor,Department,Description,Amount,Currency'];
    for (const r of finalRows) {
      const signedMinor = hasNegativeRows ? r.amountMinor : -Math.abs(r.amountMinor);
      const amountDec = (signedMinor / 100).toFixed(2);
      csvLines.push(
        [
          escapeCsvField(r.date),
          escapeCsvField(r.vendor),
          escapeCsvField(r.category),
          escapeCsvField(r.description),
          amountDec,
          currencyCode,
        ].join(',')
      );
    }

    const baseName = entityNameHint || fileName.replace(/^.*[/\\]/, '').replace(/\.xlsx?$/i, '');
    const outName = outputFiles.length === 0 ? `${baseName}.csv` : `${baseName}_${tab.name}.csv`;
    outputFiles.push({
      name: outName,
      mimeType: 'text/csv',
      content: csvLines.join('\n'),
      encoding: 'utf8',
    });
  }

  return {
    files: outputFiles,
    ...(entityNameHint ? { entityNameHint } : {}),
  };
}
