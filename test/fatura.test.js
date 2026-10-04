/**
 * Gelen / giden fatura içe aktarımı ve hesaplamaları.
 * e-Fatura portalının Excel çıktısı birebir taklit edilir (boş hücreler dâhil).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'otel-fatura-'));
process.env.DATA_DIR = DATA_DIR;

const { exportWorkbook, parseWorkbook, TEMPLATES, buildTemplate } = await import('../server/excel.js');
const { importRows } = await import('../server/api.js');
const { emptyDb, load, resetForTests } = await import('../server/db.js');
const {
  createInvoice, validateInvoice, invoiceAmount, invoiceKdv, invoiceSummary,
  defaultTaxRates, taxReport,
} = await import('../src/core/finance.js');

test.after(() => rmSync(DATA_DIR, { recursive: true, force: true }));

const ADMIN = { username: 'Admin', isAdmin: true };

/** Portal çıktısı: 19 sütun, aralarında boş hücreler. */
const PORTAL_HEADER = [
  'Fatura Senaryo', 'GİB Fatura Türü', 'Müşteri', 'Müşteri VKN', 'Fatura Tarihi', 'Fatura No',
  'ETTN', 'ERP Statü', 'İrsaliye No', 'Tutar', 'Para Birimi', 'Statü', 'Paket Bilgisi',
  '"Zarf Durumu', 'Vergiler Hariç Toplam Tutar', 'Vergiler Dahil Toplam Tutar',
  'Oluşturma Tarihi', 'Departman Adı', 'Özel Alan 1',
];

/** Tek satırlık portal kaydı; boş sütunlar gerçek dosyadaki gibi boş bırakılır. */
const portalRow = ({ customer, dateSerial, no, amount, currency, net, gross }) => ([
  'Temel', 'Satış', customer, '6160398170', dateSerial, no,
  '901C6FD7-EFEF', 'INCELEMEBEKLIYOR', '', amount, currency, 'Kabul edildi', '',
  '', net, gross, 46297.89, '', '',
]);

const portalWorkbook = (rows) => exportWorkbook([{ name: 'Faturalar', rows: [PORTAL_HEADER, ...rows] }]);

/* ------------------------------------------------ ayrıştırıcı hatası ---- */

test('boş hücreler sütunları kaydırmaz', () => {
  const buffer = portalWorkbook([portalRow({
    customer: 'MERAM ELEKTRİK', dateSerial: 46295, no: 'MRM2026000116826',
    amount: 39596, currency: 'TRY', net: 32997.04, gross: 39596.06,
  })]);
  const { rows } = parseWorkbook(buffer);
  assert.equal(rows[0].length, PORTAL_HEADER.length);
  const at = (label) => rows[1][rows[0].indexOf(label)];
  assert.equal(at('Müşteri'), 'MERAM ELEKTRİK');
  assert.equal(at('Fatura No'), 'MRM2026000116826');
  assert.equal(at('Para Birimi'), 'TRY', 'boş "İrsaliye No" sütunu verileri sola kaydırmamalı');
  assert.equal(at('Vergiler Hariç Toplam Tutar'), '32997.04');
  assert.equal(at('Vergiler Dahil Toplam Tutar'), '39596.06');
});

/* ------------------------------------------------------- şablonlar ----- */

test('fatura şablonları yalnızca istenen yedi sütunu taşır', () => {
  for (const kind of ['gelenFatura', 'gidenFatura']) {
    const labels = TEMPLATES[kind].columns.map((c) => c.label);
    assert.deepEqual(labels, [
      'Müşteri', 'Fatura Tarihi', 'Fatura No', 'Tutar', 'Para Birimi',
      'Vergiler Hariç Toplam Tutar', 'Vergiler Dahil Toplam Tutar',
    ]);
  }
  const { rows } = parseWorkbook(buildTemplate('gelenFatura'));
  assert.equal(rows[0][0], 'Müşteri');
  assert.equal(rows[0][6], 'Vergiler Dahil Toplam Tutar');
});

test('şablonla üretilen dosya da içe aktarılabilir', async () => {
  await resetForTests(emptyDb());
  const parsed = parseWorkbook(buildTemplate('gidenFatura'));
  const result = await importRows(parsed, 'gidenFatura', ADMIN, false);
  assert.equal(result.imported, 1, JSON.stringify(result.invalidRows));
  const db = await load();
  assert.equal(db.salesInvoices[0].invoiceNo, 'SCA2026000000685');
});

/* ------------------------------------------------- portal dosyasını al - */

test('gelen fatura dosyası gider faturalarına yazılır', async () => {
  await resetForTests(emptyDb());
  const buffer = portalWorkbook([
    portalRow({ customer: 'MERAM ELEKTRİK', dateSerial: 46295, no: 'MRM-1', amount: 39596, currency: 'TRY', net: 32997.04, gross: 39596.06 }),
    portalRow({ customer: 'HELİOS SEYAHAT', dateSerial: 46295, no: 'BEF-2', amount: 728, currency: 'EUR', net: 606.67, gross: 728 }),
  ]);
  const result = await importRows(parseWorkbook(buffer), 'gelenFatura', ADMIN, false);
  assert.equal(result.imported, 2, JSON.stringify(result.invalidRows));

  const db = await load();
  assert.equal(db.salesInvoices.length, 0, 'gelen fatura gelire yazılmamalı');
  assert.equal(db.purchaseInvoices.length, 2);
  const meram = db.purchaseInvoices.find((i) => i.invoiceNo === 'MRM-1');
  assert.equal(meram.direction, 'gelen');
  assert.equal(meram.customer, 'MERAM ELEKTRİK');
  assert.equal(meram.date, '2026-09-30', 'Excel seri tarihi çevrilmeli');
  assert.equal(meram.grossAmount, 39596.06);
  assert.equal(meram.netAmount, 32997.04);
  assert.equal(meram.currency, 'TRY');
  assert.equal(db.purchaseInvoices.find((i) => i.invoiceNo === 'BEF-2').currency, 'EUR');
});

test('giden fatura dosyası gelir faturalarına yazılır', async () => {
  await resetForTests(emptyDb());
  const buffer = portalWorkbook([
    portalRow({ customer: 'Li JiaNi', dateSerial: 46294.5857, no: 'SCA-685', amount: 6731.24, currency: 'TRY', net: 6064.18, gross: 6731.24 }),
  ]);
  const result = await importRows(parseWorkbook(buffer), 'gidenFatura', ADMIN, false);
  assert.equal(result.imported, 1, JSON.stringify(result.invalidRows));

  const db = await load();
  assert.equal(db.purchaseInvoices.length, 0);
  assert.equal(db.salesInvoices[0].direction, 'giden');
  assert.equal(db.salesInvoices[0].date, '2026-09-29', 'ondalıklı seri tarih de çevrilmeli');
  assert.equal(db.salesInvoices[0].customer, 'Li JiaNi');
});

test('aynı dosya ikinci kez yüklenince hiçbir satır tekrar işlenmez', async () => {
  await resetForTests(emptyDb());
  const buffer = portalWorkbook([
    portalRow({ customer: 'A Ltd', dateSerial: 46295, no: 'AYNI-1', amount: 100, currency: 'TRY', net: 90, gross: 100 }),
    portalRow({ customer: 'B Ltd', dateSerial: 46295, no: 'AYNI-2', amount: 200, currency: 'TRY', net: 180, gross: 200 }),
  ]);
  const first = await importRows(parseWorkbook(buffer), 'gelenFatura', ADMIN, false);
  assert.equal(first.imported, 2);
  assert.equal(first.skippedCount, 0);

  const second = await importRows(parseWorkbook(buffer), 'gelenFatura', ADMIN, false);
  assert.equal(second.imported, 0, 'tekrar işlenmemeli');
  assert.equal(second.skippedCount, 2);
  assert.equal(second.invalidCount, 0, 'atlanan satır hata sayılmamalı');
  assert.equal(second.conflictCount, 0);
  assert.match(second.skippedRows[0].reason, /zaten kayıtlı; tekrar işlenmedi/);
  assert.equal((await load()).purchaseInvoices.length, 2, 'kayıt çoğalmamalı');
});

test('dosyanın yarısı yeniyse yalnızca yeni satırlar işlenir', async () => {
  await resetForTests(emptyDb());
  const eski = portalRow({ customer: 'A Ltd', dateSerial: 46295, no: 'KARMA-1', amount: 100, currency: 'TRY', net: 90, gross: 100 });
  await importRows(parseWorkbook(portalWorkbook([eski])), 'gelenFatura', ADMIN, false);

  const yeni = portalRow({ customer: 'C Ltd', dateSerial: 46296, no: 'KARMA-2', amount: 300, currency: 'TRY', net: 270, gross: 300 });
  const result = await importRows(parseWorkbook(portalWorkbook([eski, yeni])), 'gelenFatura', ADMIN, false);
  assert.equal(result.imported, 1);
  assert.equal(result.skippedCount, 1);
  const db = await load();
  assert.equal(db.purchaseInvoices.length, 2);
  assert.deepEqual(db.purchaseInvoices.map((i) => i.invoiceNo).sort(), ['KARMA-1', 'KARMA-2']);
});

test('aynı dosyadaki mükerrer satır ikinci kez işlenmez', async () => {
  await resetForTests(emptyDb());
  const row = portalRow({ customer: 'A Ltd', dateSerial: 46295, no: 'TEK-1', amount: 100, currency: 'TRY', net: 90, gross: 100 });
  const result = await importRows(parseWorkbook(portalWorkbook([row, row])), 'gelenFatura', ADMIN, false);
  assert.equal(result.imported, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal((await load()).purchaseInvoices.length, 1);
});

test('aynı numara farklı bilgiyle gelirse çakışma bildirilir, kayıt değişmez', async () => {
  await resetForTests(emptyDb());
  const ilk = portalRow({ customer: 'A Ltd', dateSerial: 46295, no: 'CAK-1', amount: 100, currency: 'TRY', net: 90, gross: 100 });
  await importRows(parseWorkbook(portalWorkbook([ilk])), 'gelenFatura', ADMIN, false);

  const degisik = portalRow({ customer: 'A Ltd', dateSerial: 46295, no: 'CAK-1', amount: 999, currency: 'TRY', net: 900, gross: 999 });
  const result = await importRows(parseWorkbook(portalWorkbook([degisik])), 'gelenFatura', ADMIN, false);
  assert.equal(result.imported, 0);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.conflictCount, 1);
  assert.match(result.conflictRows[0].reason, /farklı bilgilerle kayıtlı/);

  const db = await load();
  assert.equal(db.purchaseInvoices.length, 1);
  assert.equal(db.purchaseInvoices[0].grossAmount, 100, 'mevcut kayıt değişmemeli');
});

test('fatura no büyük/küçük harf farkıyla da mükerrer sayılır', async () => {
  await resetForTests(emptyDb());
  const buffer = portalWorkbook([
    portalRow({ customer: 'A Ltd', dateSerial: 46295, no: 'abc-1', amount: 100, currency: 'TRY', net: 90, gross: 100 }),
  ]);
  await importRows(parseWorkbook(buffer), 'gelenFatura', ADMIN, false);
  const second = await importRows(parseWorkbook(portalWorkbook([
    portalRow({ customer: 'A Ltd', dateSerial: 46295, no: 'ABC-1', amount: 100, currency: 'TRY', net: 90, gross: 100 }),
  ])), 'gelenFatura', ADMIN, false);
  assert.equal(second.skippedCount, 1);
  assert.equal(second.imported, 0);
});

test('ön kontrol de atlanacak satırları önceden gösterir', async () => {
  await resetForTests(emptyDb());
  const buffer = portalWorkbook([
    portalRow({ customer: 'A Ltd', dateSerial: 46295, no: 'ONK-1', amount: 100, currency: 'TRY', net: 90, gross: 100 }),
  ]);
  await importRows(parseWorkbook(buffer), 'gelenFatura', ADMIN, false);
  const check = await importRows(parseWorkbook(buffer), 'gelenFatura', ADMIN, true);
  assert.equal(check.dryRun, true);
  assert.equal(check.validCount, 0);
  assert.equal(check.skippedCount, 1);
});

test('gelen ve giden faturalar birbirinin mükerreri sayılmaz', async () => {
  await resetForTests(emptyDb());
  const row = portalRow({ customer: 'A Ltd', dateSerial: 46295, no: 'ORTAK-1', amount: 100, currency: 'TRY', net: 90, gross: 100 });
  const gelen = await importRows(parseWorkbook(portalWorkbook([row])), 'gelenFatura', ADMIN, false);
  const giden = await importRows(parseWorkbook(portalWorkbook([row])), 'gidenFatura', ADMIN, false);
  assert.equal(gelen.imported, 1);
  assert.equal(giden.imported, 1, 'ayrı defterler ayrı değerlendirilir');
});

test('ön kontrol (dryRun) kayıt eklemez', async () => {
  await resetForTests(emptyDb());
  const buffer = portalWorkbook([
    portalRow({ customer: 'B Ltd', dateSerial: 46295, no: 'DRY-1', amount: 100, currency: 'TRY', net: 90, gross: 100 }),
  ]);
  const result = await importRows(parseWorkbook(buffer), 'gelenFatura', ADMIN, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.imported, 0);
  assert.equal(result.validCount, 1);
  assert.equal((await load()).purchaseInvoices.length, 0);
});

test('eksik sütunlu dosya anlaşılır hatayla reddedilir', async () => {
  await resetForTests(emptyDb());
  const buffer = exportWorkbook([{ name: 'X', rows: [['Müşteri', 'Fatura No'], ['A', 'B']] }]);
  await assert.rejects(
    () => importRows(parseWorkbook(buffer), 'gelenFatura', ADMIN, true),
    (err) => {
      assert.match(err.message, /sütun yapısı/);
      assert.ok(err.extra.missingColumns.some((c) => c.includes('vergiler dahil')));
      return true;
    },
  );
});

test('geçersiz satırlar sebebiyle birlikte bildirilir', async () => {
  await resetForTests(emptyDb());
  const buffer = portalWorkbook([
    portalRow({ customer: '', dateSerial: 46295, no: 'X-1', amount: 100, currency: 'TRY', net: 90, gross: 100 }),
    portalRow({ customer: 'C Ltd', dateSerial: 46295, no: 'X-2', amount: 0, currency: 'TRY', net: 0, gross: 0 }),
    portalRow({ customer: 'D Ltd', dateSerial: 46295, no: 'X-3', amount: 100, currency: 'USD', net: 90, gross: 100 }),
  ]);
  const result = await importRows(parseWorkbook(buffer), 'gelenFatura', ADMIN, true);
  assert.equal(result.validCount, 0);
  assert.equal(result.invalidCount, 3);
  const messages = result.invalidRows.map((r) => r.errors.join(' '));
  assert.match(messages[0], /Müşteri adı/);
  assert.match(messages[1], /0’dan büyük/);
  assert.match(messages[2], /USD/);
});

/* ---------------------------------------------------- hesaplamalar ----- */

test('hesaplamalarda KDV dahil tutar kullanılır', () => {
  const invoice = createInvoice({ customer: 'A', date: '2026-10-01', invoiceNo: '1', amount: 39596, netAmount: 32997.04, grossAmount: 39596.06 });
  assert.equal(invoiceAmount(invoice), 39596.06);
  assert.equal(invoiceKdv(invoice), 6599.02);
});

test('yalnızca tutar girilmişse o kullanılır', () => {
  const invoice = createInvoice({ customer: 'A', date: '2026-10-01', invoiceNo: '1', amount: 5000 });
  assert.equal(invoiceAmount(invoice), 5000);
  assert.equal(invoiceKdv(invoice), 0);
});

test('fatura özeti EUR tutarları kurla çevirir', () => {
  const invoices = [
    createInvoice({ customer: 'A', date: '2026-10-01', invoiceNo: '1', grossAmount: 1000, netAmount: 900, currency: 'TRY' }),
    createInvoice({ customer: 'B', date: '2026-10-02', invoiceNo: '2', grossAmount: 100, netAmount: 90, currency: 'EUR' }),
  ];
  const summary = invoiceSummary(invoices, { rateFor: () => 40 });
  assert.equal(summary.gross, 5000, '1000 TRY + 100 EUR × 40');
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.byCurrency, [['TRY', 1000], ['EUR', 100]]);
});

test('pasif fatura ve dönem dışı fatura toplama girmez', () => {
  const invoices = [
    createInvoice({ customer: 'A', date: '2026-10-01', invoiceNo: '1', grossAmount: 1000 }),
    createInvoice({ customer: 'B', date: '2026-10-02', invoiceNo: '2', grossAmount: 500, active: false }),
    createInvoice({ customer: 'C', date: '2026-11-02', invoiceNo: '3', grossAmount: 700 }),
  ];
  const summary = invoiceSummary(invoices, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(summary.gross, 1000);
  assert.equal(summary.count, 1);
});

test('fatura doğrulaması zorunlu alanları ister', () => {
  const errors = validateInvoice(createInvoice({}));
  assert.ok(errors.some((e) => e.includes('Müşteri')));
  assert.ok(errors.some((e) => e.includes('fatura tarihi')));
  assert.ok(errors.some((e) => e.includes('Fatura no')));
  assert.ok(errors.some((e) => e.includes('0’dan büyük')));
});

test('vergiler hariç tutar, dahil tutardan büyük olamaz', () => {
  const invoice = createInvoice({ customer: 'A', date: '2026-10-01', invoiceNo: '1', netAmount: 200, grossAmount: 100 });
  assert.ok(validateInvoice(invoice).some((e) => e.includes('büyük olamaz')));
});

test('faturaların KDV’si vergi raporuna gerçek tutarıyla girer', () => {
  const rates = { ...defaultTaxRates(), kdvIncome: 10, kdvRestaurant: 10, kdvExpense: 20 };
  const report = taxReport({
    revenue: 110000,
    invoiceRevenue: 50000,
    invoiceRevenueKdv: 4500,
    expenses: 60000,
    expenseKdvBase: 12000,
    invoiceExpenseKdv: 3000,
    rates,
  });
  assert.equal(report.roomKdv, 10000);
  assert.equal(report.salesInvoiceKdv, 4500);
  assert.equal(report.collectedKdv, 14500);
  assert.equal(report.purchaseInvoiceKdv, 3000);
  assert.equal(report.deductibleKdv, 5000, '12.000 × 20/120 = 2.000, + 3.000 fatura KDV’si');
  assert.equal(report.netKdv, 9500);
  assert.equal(report.invoiceRevenue, 50000);
  assert.equal(report.totalRevenue, 160000);
  assert.equal(report.invoiceNetRevenue, 45500);
});

/* ------------------------- gider / rezervasyon aktarımı da tekrarlanmaz - */

/** Şablon başlıklarıyla bir çalışma kitabı üretir. */
const templateWorkbook = (kind, rows) => exportWorkbook([{
  name: TEMPLATES[kind].sheet,
  rows: [TEMPLATES[kind].columns.map((c) => c.label), ...rows],
}]);

test('aynı gider dosyası ikinci kez yüklenince kayıt çoğalmaz', async () => {
  await resetForTests(emptyDb());
  // Tarih · Kategori · Açıklama · Tutar · Para Birimi · Dağıtım · Oda No · Tedarikçi
  const buffer = templateWorkbook('gider', [
    ['2026-10-01', 'other', 'Elektrik faturası', 12500, 'TRY', 'general', '', 'Enerjisa'],
    ['2026-10-02', 'other', 'Su faturası', 3100, 'TRY', 'general', '', 'ASKİ'],
  ]);
  const first = await importRows(parseWorkbook(buffer), 'gider', ADMIN, false);
  assert.equal(first.imported, 2);

  const second = await importRows(parseWorkbook(buffer), 'gider', ADMIN, false);
  assert.equal(second.imported, 0, 'aynı giderler tekrar işlenmemeli');
  assert.equal(second.skippedCount, 2);
  assert.equal((await load()).expenses.length, 2);
});

test('gider tutarı değişmişse çakışma olarak bildirilir', async () => {
  await resetForTests(emptyDb());
  const row = ['2026-10-01', 'other', 'Elektrik faturası', 12500, 'TRY', 'general', '', 'Enerjisa'];
  await importRows(parseWorkbook(templateWorkbook('gider', [row])), 'gider', ADMIN, false);
  const degisik = [...row];
  degisik[3] = 18000;
  const result = await importRows(parseWorkbook(templateWorkbook('gider', [degisik])), 'gider', ADMIN, false);
  assert.equal(result.conflictCount, 1);
  assert.equal(result.imported, 0);
  assert.equal((await load()).expenses[0].amount, 12500, 'mevcut tutar korunmalı');
});

test('aynı rezervasyon dosyası ikinci kez yüklenince hata değil atlama üretir', async () => {
  const db = emptyDb();
  const { createRoom } = await import('../src/core/model.js');
  db.rooms = [createRoom({
    id: 'r1', number: '101', name: 'Suit', maxOccupancy: 3,
    beds: [{ type: 'double', count: 1 }, { type: 'single', count: 1 }],
  })];
  await resetForTests(db);

  // Giriş · Çıkış · Oda No · Misafir · Kişi · Tutar · Para Birimi · Kanal · Komisyon · Kahvaltı
  const buffer = templateWorkbook('gelir', [
    ['2026-10-03', '2026-10-06', '101', 'Yılmaz Ailesi', 2, 18000, 'TRY', 'direct', 0, 'Evet'],
  ]);
  const first = await importRows(parseWorkbook(buffer), 'gelir', ADMIN, false);
  assert.equal(first.imported, 1, JSON.stringify(first.invalidRows));

  const second = await importRows(parseWorkbook(buffer), 'gelir', ADMIN, false);
  assert.equal(second.imported, 0);
  assert.equal(second.skippedCount, 1, 'çakışan tarih hatası değil, atlama olmalı');
  assert.equal(second.invalidCount, 0);
  assert.equal((await load()).reservations.length, 1);
});
