/**
 * Tarayıcı tarafı XLSX okuma/yazma (Firebase / cPanel modu).
 *
 * Node sunucusu olmadığında Excel işlemleri tarayıcıda yapılır:
 *  · Yazma  → zip girdileri **sıkıştırılmadan** (method 0) yazılır; Excel ve
 *             LibreOffice bu biçimi sorunsuz açar, ek kütüphane gerekmez.
 *  · Okuma  → sıkıştırılmış girdiler `DecompressionStream('deflate-raw')`
 *             ile açılır (Chrome/Edge/Safari/Firefox destekler).
 *
 * XML üretimi, ayrıştırma ve şablonlar `excelFormat.js` ile ortaktır; böylece
 * sunucu ve tarayıcı birebir aynı dosyayı üretir.
 */

import { rowsFromEntries, templateSheets, workbookFiles } from './excelFormat.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

/* --------------------------------------------------------------- CRC32 -- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------- küçük yardımcı -- */

/** Parça parça byte yazmak için basit tampon. */
function writer() {
  const parts = [];
  let length = 0;
  const push = (bytes) => { parts.push(bytes); length += bytes.length; };
  return {
    push,
    get length() { return length; },
    toUint8Array() {
      const out = new Uint8Array(length);
      let at = 0;
      for (const part of parts) { out.set(part, at); at += part.length; }
      return out;
    },
  };
}

const u16 = (value) => new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
const u32 = (value) => new Uint8Array([
  value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff,
]);

/* ----------------------------------------------------------- ZIP yazma -- */

/** Girdileri sıkıştırmadan (stored) zip'ler. */
function zipStored(files) {
  const out = writer();
  const central = writer();
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = encoder.encode(name);
    const payload = typeof data === 'string' ? encoder.encode(data) : data;
    const crc = crc32(payload);

    const local = writer();
    local.push(u32(0x04034b50));
    local.push(u16(20));          // sürüm
    local.push(u16(0x0800));      // UTF-8 bayrağı
    local.push(u16(0));           // method 0 — sıkıştırma yok
    local.push(u16(0));           // saat
    local.push(u16(0x21));        // tarih (1980-01-01)
    local.push(u32(crc));
    local.push(u32(payload.length));
    local.push(u32(payload.length));
    local.push(u16(nameBytes.length));
    local.push(u16(0));
    local.push(nameBytes);
    local.push(payload);
    const localBytes = local.toUint8Array();
    out.push(localBytes);

    central.push(u32(0x02014b50));
    central.push(u16(20));
    central.push(u16(20));
    central.push(u16(0x0800));
    central.push(u16(0));
    central.push(u16(0));
    central.push(u16(0x21));
    central.push(u32(crc));
    central.push(u32(payload.length));
    central.push(u32(payload.length));
    central.push(u16(nameBytes.length));
    central.push(u16(0));         // ek alan
    central.push(u16(0));         // yorum
    central.push(u16(0));         // disk
    central.push(u16(0));         // iç öznitelik
    central.push(u32(0));         // dış öznitelik
    central.push(u32(offset));
    central.push(nameBytes);

    offset += localBytes.length;
  }

  const centralBytes = central.toUint8Array();
  const end = writer();
  end.push(u32(0x06054b50));
  end.push(u16(0));
  end.push(u16(0));
  end.push(u16(files.length));
  end.push(u16(files.length));
  end.push(u32(centralBytes.length));
  end.push(u32(offset));
  end.push(u16(0));

  const result = writer();
  result.push(out.toUint8Array());
  result.push(centralBytes);
  result.push(end.toUint8Array());
  return result.toUint8Array();
}

/* ----------------------------------------------------------- ZIP okuma -- */

const readU16 = (bytes, at) => bytes[at] | (bytes[at + 1] << 8);
const readU32 = (bytes, at) => (
  (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
);

/** `deflate-raw` açar. Tarayıcı desteklemiyorsa anlaşılır hata verir. */
async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Tarayıcınız sıkıştırılmış Excel dosyalarını açamıyor; dosyayı yeniden kaydedip deneyin.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Zip girdilerini { ad → metin } eşlemesine çevirir. */
async function unzipToTexts(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i -= 1) {
    if (readU32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Geçerli bir Excel (.xlsx) dosyası değil.');

  const count = readU16(bytes, eocd + 10);
  let pointer = readU32(bytes, eocd + 16);
  const texts = new Map();

  for (let i = 0; i < count; i += 1) {
    if (readU32(bytes, pointer) !== 0x02014b50) break;
    const method = readU16(bytes, pointer + 10);
    const compressedSize = readU32(bytes, pointer + 20);
    const nameLen = readU16(bytes, pointer + 28);
    const extraLen = readU16(bytes, pointer + 30);
    const commentLen = readU16(bytes, pointer + 32);
    const localOffset = readU32(bytes, pointer + 42);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLen));

    const localNameLen = readU16(bytes, localOffset + 26);
    const localExtraLen = readU16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const payload = bytes.subarray(dataStart, dataStart + compressedSize);

    try {
      const raw = method === 8 ? await inflateRaw(payload) : payload;
      texts.set(name, decoder.decode(raw));
    } catch (err) {
      throw new Error(`Excel dosyası açılamadı (${name}): ${err.message}`);
    }
    pointer += 46 + nameLen + extraLen + commentLen;
  }
  return texts;
}

/* ------------------------------------------------------------ genel API -- */

/**
 * Çalışma kitabı üretir.
 * @param {{name: string, rows: Array<Array<string|number>>}[]} sheets
 * @returns {Uint8Array}
 */
export function exportWorkbook(sheets) {
  return zipStored(workbookFiles(sheets));
}

/**
 * İlk çalışma sayfasını satır dizisine çevirir.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<{rows: string[][]}>}
 */
export async function parseWorkbook(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return rowsFromEntries(await unzipToTexts(bytes));
}

/** "?" yardım düğmesinin indirdiği örnek şablon. */
export function buildTemplate(kind = 'gider') {
  return exportWorkbook(templateSheets(kind));
}

export { TEMPLATES } from './excelFormat.js';
