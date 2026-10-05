/**
 * Bağımlılıksız XLSX okuma/yazma (PRD §2.1).
 *
 * XLSX bir ZIP arşividir; sıkıştırma için Node'un yerleşik `zlib` modülü kullanılır.
 * Yazarken satır içi metin (inlineStr) tercih edilir, böylece sharedStrings tablosuna
 * gerek kalmaz. Okurken hem sıkıştırılmış (deflate) hem de düz (store) girdiler
 * desteklenir ve sharedStrings çözülür.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';

/* ------------------------------------------------------------------ CRC -- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/* ------------------------------------------------------------- ZIP yazma -- */

function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const compressed = deflateRawSync(raw, { level: 6 });
    const useDeflate = compressed.length < raw.length;
    const payload = useDeflate ? compressed : raw;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);              // sürüm
    local.writeUInt16LE(0x0800, 6);          // UTF-8 bayrağı
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(0, 10);              // saat
    local.writeUInt16LE(0x21, 12);           // tarih (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, payload);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(useDeflate ? 8 : 0, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(payload.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(0, 42);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}

/* ------------------------------------------------------------- ZIP okuma -- */

function unzip(buffer) {
  const entries = new Map();
  // Merkezî dizin sonunu (EOCD) sondan ara.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 66000; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Geçerli bir Excel (.xlsx) dosyası değil.');

  const count = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLen = buffer.readUInt16LE(pointer + 28);
    const extraLen = buffer.readUInt16LE(pointer + 30);
    const commentLen = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLen);

    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const payload = buffer.subarray(dataStart, dataStart + compressedSize);

    try {
      entries.set(name, method === 8 ? inflateRawSync(payload) : Buffer.from(payload));
    } catch (err) {
      throw new Error(`Excel dosyası açılamadı (${name}): ${err.message}`);
    }
    pointer += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* --------------------------------------------------------------- XML --- */

/* --------------------------------------- biçim katmanı (ortak) --------- */

export {
  TEMPLATES, columnName, parseSharedStrings, workbookFiles,
} from '../src/core/excelFormat.js';

import { rowsFromEntries, templateSheets, workbookFiles as buildFiles } from '../src/core/excelFormat.js';

/**
 * Çalışma kitabı üretir (Node: deflate ile sıkıştırılmış zip).
 * @param {{name: string, rows: Array<Array<string|number>>}[]} sheets
 */
export function exportWorkbook(sheets) {
  return zip(buildFiles(sheets));
}

/**
 * İlk çalışma sayfasını satır dizisine çevirir.
 * @returns {{rows: string[][]}}
 */
export function parseWorkbook(buffer) {
  const entries = unzip(buffer);
  const texts = new Map();
  for (const [name, data] of entries) texts.set(name, data.toString('utf8'));
  return rowsFromEntries(texts);
}

/** "?" yardım butonunun indirdiği örnek şablon. */
export function buildTemplate(kind = 'gider') {
  return exportWorkbook(templateSheets(kind));
}

export { crc32, unzip, zip };
