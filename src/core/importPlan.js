/**
 * Excel satırlarının sınıflandırılması — sunucu ve tarayıcı ortak kullanır.
 *
 * Satırlar dört kovaya ayrılır: yeni (valid), daha önce işlenmiş (skipped),
 * aynı anahtarla farklı bilgi taşıyan (conflict) ve geçersiz (invalid).
 * Kaydetme işini çağıran arka uç üstlenir; bu modül hiçbir yere yazmaz.
 */

import { createInvoice, validateInvoice } from './finance.js';
import { createExpense, validateExpense } from './model.js';
import { TEMPLATES } from './excelFormat.js';

/** Sütun yapısı şablona uymadığında atılır. */
export class ImportFormatError extends Error {
  constructor(message, detail) {
    super(message);
    this.status = 422;
    this.detail = detail;
  }
}

const badRequest = (message) => new ImportFormatError(message, {});
const ApiError = class extends ImportFormatError {
  constructor(status, message, detail) { super(message, detail); this.status = status; }
};


const normalizeHeader = (value) => String(value ?? '').trim().toLocaleLowerCase('tr');
const parseAmount = (value) => {
  const text = String(value ?? '').trim().replace(/\s/g, '');
  if (!text) return NaN;
  // "12.500,50" ve "12500.50" biçimlerinin ikisini de kabul et.
  const normalized = text.includes(',') && text.lastIndexOf(',') > text.lastIndexOf('.')
    ? text.replace(/\./g, '').replace(',', '.')
    : text.replace(/,/g, '');
  return Number(normalized);
};
const parseBool = (value) => !/^(hay[ıi]r|no|false|0)$/i.test(String(value ?? '').trim());
const parseDate = (value) => {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const tr = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (tr) return `${tr[3]}-${tr[2].padStart(2, '0')}-${tr[1].padStart(2, '0')}`;
  // Excel seri numarası (1900 tarih sistemi)
  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 20000 && serial < 60000) {
    const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return text;
};

const norm = (value) => String(value ?? '').trim().toLocaleUpperCase('tr');
/** İki tutar aynı mı (kuruş farkı yok sayılır)? */
const sameMoney = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01;

/**
 * Aynı kaydın daha önce işlenip işlenmediğini söyler.
 * `key` kaydı tanımlayan alan (fatura no gibi), `same` ise geri kalan bilgilerin
 * de birebir aynı olup olmadığını döndürür. Böylece "aynı numara + aynı bilgi"
 * sessizce atlanır, "aynı numara + farklı bilgi" çakışma olarak bildirilir.
 */
const DUPLICATE_RULES = {
  invoice: {
    key: (i) => norm(i.invoiceNo),
    same: (a, b) => norm(a.customer) === norm(b.customer)
      && a.date === b.date
      && norm(a.currency) === norm(b.currency)
      && sameMoney(a.grossAmount, b.grossAmount)
      && sameMoney(a.netAmount, b.netAmount),
    label: (i) => `${i.invoiceNo} numaralı fatura`,
  },
  expense: {
    key: (e) => [e.date, norm(e.description), norm(e.category)].join('|'),
    same: (a, b) => sameMoney(a.amount, b.amount) && norm(a.currency) === norm(b.currency),
    label: (e) => `${e.date} tarihli "${e.description}" gideri`,
  },
};

/**
 * Şablona göre satırları okur, doğrular ve (dryRun değilse) kaydeder.
 * Daha önce işlenmiş kayıtlar tekrar yazılmaz: aynı anahtar ve aynı bilgi
 * taşıyan satırlar "atlandı" olarak, bilgisi değişmiş olanlar "çakışma" olarak
 * raporlanır. Geçersiz satırlar sebebiyle birlikte döndürülür.
 */
export function planImport(parsed, kind, db) {
  const template = TEMPLATES[kind];
  const rows = parsed.rows ?? [];
  if (!rows.length) throw badRequest('Excel dosyası boş.');

  const header = rows[0].map(normalizeHeader);
  const expected = template.columns.map((c) => normalizeHeader(c.label));
  const missing = expected.filter((label) => !header.includes(label));
  if (missing.length) {
    throw new ApiError(422, 'Excel sütun yapısı şablona uymuyor. "?" düğmesinden örnek şablonu indirin.', {
      missingColumns: missing,
      expectedColumns: template.columns.map((c) => c.label),
      foundColumns: rows[0],
    });
  }
  const columnAt = Object.fromEntries(template.columns.map((c) => [c.key, header.indexOf(normalizeHeader(c.label))]));

  const valid = [];
  const invalidRows = [];
  // İşlenen faturaların künyesi: aynı yüklemedeki kayıtlar tek toplu iş altında toplanır.
  const importedAt = new Date().toISOString();
  const importBatch = `imp_${importedAt.replace(/[^\d]/g, '').slice(0, 14)}`;
  /** Daha önce birebir aynısı işlenmiş satırlar. */
  const skippedRows = [];
  /** Aynı anahtarla kayıtlı ama bilgileri değişmiş satırlar. */
  const conflictRows = [];

  const ruleName = template.direction ? 'invoice' : 'expense';
  const rule = DUPLICATE_RULES[ruleName];
  const collection = template.target ?? 'expenses';
  // Mevcut kayıtlar anahtarlarıyla indekslenir; aktarım sırasındakiler de eklenir.
  const seen = new Map();
  for (const item of db[collection] ?? []) {
    const key = rule.key(item);
    if (key) seen.set(key, item);
  }

  /**
   * Kayıt daha önce işlendiyse true döner ve satırı uygun listeye yazar.
   */
  const alreadyProcessed = (item, lineNo, row) => {
    const key = rule.key(item);
    if (!key) return false;
    const existing = seen.get(key);
    if (!existing) return false;
    if (rule.same(existing, item)) {
      skippedRows.push({ line: lineNo, reason: `${rule.label(item)} zaten kayıtlı; tekrar işlenmedi.`, raw: row });
    } else {
      conflictRows.push({
        line: lineNo,
        reason: `${rule.label(item)} farklı bilgilerle kayıtlı; değiştirmemek için atlandı.`,
        raw: row,
      });
    }
    return true;
  };

  rows.slice(1).forEach((row, index) => {
    const lineNo = index + 2; // başlık satırı 1
    if (row.every((cell) => !String(cell ?? '').trim())) return; // boş satır
    const get = (key) => String(row[columnAt[key]] ?? '').trim();

    if (template.direction) {
      // e-Fatura dosyası: yalnızca şablondaki yedi sütun okunur.
      const item = createInvoice({
        direction: template.direction,
        importedAt,
        importBatch,
        importKind: kind,
        customer: get('customer'),
        date: parseDate(get('date')),
        invoiceNo: get('invoiceNo'),
        amount: parseAmount(get('amount')),
        currency: get('currency').toUpperCase() || 'TRY',
        netAmount: parseAmount(get('netAmount')) || 0,
        grossAmount: parseAmount(get('grossAmount')) || 0,
      });
      // Mükerrer kontrolü aşağıda ayrıca yapılır; doğrulama yalnızca alanlara bakar.
      const errors = validateInvoice(item, { invoices: [] });
      if (errors.length) invalidRows.push({ line: lineNo, errors, raw: row });
      else if (!alreadyProcessed(item, lineNo, row)) {
        seen.set(rule.key(item), item);
        valid.push(item);
      }
    } else if (kind === 'gider') {
      const room = db.rooms.find((r) => String(r.number) === get('roomNumber'));
      const item = createExpense({
        date: parseDate(get('date')),
        category: get('category') || 'other',
        description: get('description'),
        amount: parseAmount(get('amount')),
        currency: get('currency').toUpperCase() || 'TRY',
        allocation: get('allocation') || undefined,
        roomId: room?.id ?? '',
        vendor: get('vendor'),
      });
      const errors = validateExpense(item, { rooms: db.rooms });
      if (get('roomNumber') && !room) errors.push(`"${get('roomNumber')}" numaralı oda bulunamadı.`);
      if (errors.length) invalidRows.push({ line: lineNo, errors, raw: row });
      else if (!alreadyProcessed(item, lineNo, row)) {
        seen.set(rule.key(item), item);
        valid.push(item);
      }
    }
  });

  return {
    kind,
    collection,
    totalRows: rows.length - 1,
    valid,
    validCount: valid.length,
    invalidCount: invalidRows.length,
    invalidRows: invalidRows.slice(0, 100),
    /** Daha önce birebir aynısı işlendiği için atlanan satırlar. */
    skippedCount: skippedRows.length,
    skippedRows: skippedRows.slice(0, 100),
    /** Aynı anahtarla kayıtlı ama bilgisi değişmiş satırlar. */
    conflictCount: conflictRows.length,
    conflictRows: conflictRows.slice(0, 100),
    preview: valid.slice(0, 20),
  };
}

/* --------------------------------------------- Excel dışa aktarım (§2.1) -- */
