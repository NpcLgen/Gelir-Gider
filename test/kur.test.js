/**
 * Tarihsel kur defteri, kur mührü ve kur farkı (PRD §19).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'otel-kur-'));
process.env.DATA_DIR = DATA_DIR;

const {
  createExchangeRate, validateExchangeRate, rateOn, resolveRate, sealRate,
  amountInTry, exchangeDifference, exchangeDifferenceSummary, isInvoiced,
  missingRateDates, periodExchangeDifference, rateKindLabel,
} = await import('../src/core/rates.js');
const { createReservation, validateReservation, createRoom } = await import('../src/core/model.js');
const { createInvoice } = await import('../src/core/finance.js');
const { emptyDb, load, resetForTests } = await import('../server/db.js');
const { syncDailyRate } = await import('../server/fxSync.js');

test.after(() => rmSync(DATA_DIR, { recursive: true, force: true }));

/** Kur defteri: 1 ve 2 Eylül kurları. */
const LEDGER = [
  createExchangeRate({ date: '2026-09-01', currency: 'EUR', rate: 38, kind: 'tcmb', source: 'TCMB Efektif Satış' }),
  createExchangeRate({ date: '2026-09-02', currency: 'EUR', rate: 38.4, kind: 'tcmb', source: 'TCMB Efektif Satış' }),
];

/* ---------------------------------------------------- kur defteri ------ */

test('kur kaydı tarih, para birimi ve değer ister', () => {
  assert.deepEqual(validateExchangeRate(createExchangeRate({ date: '2026-09-01', currency: 'EUR', rate: 38 })), []);
  const errors = validateExchangeRate(createExchangeRate({ date: '', currency: 'EUR', rate: 0 }));
  assert.ok(errors.some((e) => e.includes('tarih')));
  assert.ok(errors.some((e) => e.includes('0’dan büyük')));
});

test('kur tipi etiketiyle saklanır', () => {
  const rate = createExchangeRate({ date: '2026-09-01', currency: 'EUR', rate: 38, kind: 'tcmb' });
  assert.equal(rate.kind, 'tcmb');
  assert.equal(rate.source, 'TCMB Efektif Satış');
  assert.equal(rateKindLabel('manual'), 'Manuel giriş');
  // Bilinmeyen tip manuel sayılır.
  assert.equal(createExchangeRate({ date: '2026-09-01', rate: 1, kind: 'yok' }).kind, 'manual');
});

test('geçmiş tarih arandığında o günün kuru kullanılır', () => {
  assert.equal(rateOn(LEDGER, '2026-09-01', 'EUR').rate, 38);
  assert.equal(rateOn(LEDGER, '2026-09-02', 'EUR').rate, 38.4);
  assert.equal(rateOn(LEDGER, '2026-09-03', 'EUR'), null);
});

test('güncel kur değişse bile geçmiş gün kuru sabit kalır', () => {
  const güncellenmiş = [...LEDGER, createExchangeRate({ date: '2026-10-05', currency: 'EUR', rate: 50, kind: 'tcmb' })];
  assert.equal(resolveRate(güncellenmiş, '2026-09-01', { currency: 'EUR' }).rate, 38, 'bugünün kuru kullanılmamalı');
  assert.equal(resolveRate(güncellenmiş, '2026-10-05', { currency: 'EUR' }).rate, 50);
});

test('o güne kur yoksa en yakın önceki gün kullanılır ve işaretlenir', () => {
  const resolved = resolveRate(LEDGER, '2026-09-05', { currency: 'EUR' });
  assert.equal(resolved.rate, 38.4);
  assert.equal(resolved.date, '2026-09-02');
  assert.equal(resolved.exact, false);
  assert.equal(resolved.found, true);
});

test('hiç kur yoksa bulunamadı bilgisi döner (hata atılmaz)', () => {
  const resolved = resolveRate([], '2026-09-01', { currency: 'EUR' });
  assert.equal(resolved.found, false);
  assert.equal(resolved.exact, false);
  assert.equal(resolved.rate, 0);
});

test('kuru eksik işlem günleri listelenir', () => {
  const kayıtlar = [
    createReservation({ checkIn: '2026-09-01', currency: 'EUR', totalAmount: 195 }),
    createReservation({ checkIn: '2026-09-09', currency: 'EUR', totalAmount: 100 }),
    createReservation({ checkIn: '2026-09-10', currency: 'TRY', totalAmount: 100 }),
  ];
  const eksik = missingRateDates(kayıtlar, LEDGER, { dateOf: (r) => r.checkIn, currency: 'EUR' });
  assert.deepEqual(eksik.map((e) => e.date), ['2026-09-09'], 'TL kayıt ve kuru olan gün listelenmez');
});

/* ------------------------------------------------------- kur mührü ----- */

test('kayıt o günün kuruyla mühürlenir', () => {
  const sealed = sealRate(LEDGER, { date: '2026-09-01', currency: 'EUR' });
  assert.equal(sealed.fxRate, 38);
  assert.equal(sealed.fxRateDate, '2026-09-01');
  assert.equal(sealed.fxSource, 'TCMB Efektif Satış');
});

test('TL kayıtlarda kur mührü boş kalır', () => {
  assert.deepEqual(sealRate(LEDGER, { date: '2026-09-01', currency: 'TRY' }), { fxRate: 0, fxRateDate: '', fxSource: '' });
});

test('mühürlenmiş kur TL karşılığını sabitler', () => {
  const reservation = createReservation({
    checkIn: '2026-09-01', checkOut: '2026-09-02', currency: 'EUR', totalAmount: 195,
    ...sealRate(LEDGER, { date: '2026-09-01', currency: 'EUR' }),
  });
  assert.equal(reservation.fxRate, 38);
  assert.equal(amountInTry(reservation, reservation.totalAmount), 7410, '195 × 38 = 7.410');
});

test('kuru olmayan döviz rezervasyonu kullanıcıdan kur ister', () => {
  const room = createRoom({ id: 'r1', number: '101', maxOccupancy: 2, beds: [{ type: 'double', count: 1 }] });
  const reservation = createReservation({
    roomId: 'r1', guestName: 'Test', guests: 2, checkIn: '2026-09-09', checkOut: '2026-09-10',
    currency: 'EUR', totalAmount: 195,
  });
  const errors = validateReservation(reservation, { rooms: [room], reservations: [] });
  assert.ok(errors.some((e) => e.includes('kuru bulunamadı') && e.includes('elle giriniz')), errors.join(' | '));
});

test('kur mührü olan döviz rezervasyonu geçerlidir', () => {
  const room = createRoom({ id: 'r1', number: '101', maxOccupancy: 2, beds: [{ type: 'double', count: 1 }] });
  const reservation = createReservation({
    roomId: 'r1', guestName: 'Test', guests: 2, checkIn: '2026-09-01', checkOut: '2026-09-02',
    currency: 'EUR', totalAmount: 195, ...sealRate(LEDGER, { date: '2026-09-01', currency: 'EUR' }),
  });
  assert.deepEqual(validateReservation(reservation, { rooms: [room], reservations: [] }), []);
});

/* ------------------------------------------------------- kur farkı ---- */

test('PRD örneği: 195 € · 38,00 kur · 7.450 TL fatura → +40 TL olumlu kur farkı', () => {
  const reservation = createReservation({
    checkIn: '2026-09-01', checkOut: '2026-09-02', currency: 'EUR', totalAmount: 195,
    invoicedAmountTry: 7450, ...sealRate(LEDGER, { date: '2026-09-01', currency: 'EUR' }),
  });
  assert.equal(amountInTry(reservation, reservation.totalAmount), 7410);
  assert.equal(exchangeDifference(reservation, reservation.totalAmount), 40);
});

test('fatura düşük kesilmişse olumsuz kur farkı oluşur', () => {
  const reservation = createReservation({
    checkIn: '2026-09-01', checkOut: '2026-09-02', currency: 'EUR', totalAmount: 195,
    invoicedAmountTry: 7350, ...sealRate(LEDGER, { date: '2026-09-01', currency: 'EUR' }),
  });
  assert.equal(exchangeDifference(reservation, reservation.totalAmount), -60);
});

test('fatura tutarı girilmemişse kur farkı hesaplanmaz', () => {
  const reservation = createReservation({
    checkIn: '2026-09-01', checkOut: '2026-09-02', currency: 'EUR', totalAmount: 195,
    ...sealRate(LEDGER, { date: '2026-09-01', currency: 'EUR' }),
  });
  assert.equal(isInvoiced(reservation), false);
  assert.equal(exchangeDifference(reservation, reservation.totalAmount), 0);
});

test('dönem özeti olumlu ve olumsuz farkları ayırır', () => {
  const rows = [
    createReservation({ checkIn: '2026-09-01', currency: 'EUR', totalAmount: 195, invoicedAmountTry: 7450, fxRate: 38 }),
    createReservation({ checkIn: '2026-09-02', currency: 'EUR', totalAmount: 100, invoicedAmountTry: 3800, fxRate: 38.4 }),
    createReservation({ checkIn: '2026-09-03', currency: 'EUR', totalAmount: 100, fxRate: 38 }),
    createReservation({ checkIn: '2026-09-04', currency: 'TRY', totalAmount: 5000, invoicedAmountTry: 5000 }),
  ];
  const summary = exchangeDifferenceSummary(rows, { amountOf: (r) => r.totalAmount, dateOf: (r) => r.checkIn });
  assert.equal(summary.positive, 40);
  assert.equal(summary.negative, 40, '100 × 38,4 = 3.840 → fatura 3.800 → −40');
  assert.equal(summary.net, 0);
  assert.equal(summary.invoicedCount, 2);
  assert.equal(summary.pendingCount, 1);
});

test('iptal edilen rezervasyon kur farkına girmez', () => {
  const rows = [
    createReservation({ checkIn: '2026-09-01', currency: 'EUR', totalAmount: 195, invoicedAmountTry: 7450, fxRate: 38, status: 'cancelled' }),
  ];
  assert.equal(exchangeDifferenceSummary(rows, { amountOf: (r) => r.totalAmount, dateOf: (r) => r.checkIn }).invoicedCount, 0);
});

test('gider faturalarında kur farkının yönü terstir', () => {
  const satis = createInvoice({ date: '2026-09-01', customer: 'A', invoiceNo: 'S1', currency: 'EUR', grossAmount: 100, fxRate: 38, invoicedAmountTry: 3850 });
  const alis = createInvoice({ date: '2026-09-01', customer: 'B', invoiceNo: 'A1', currency: 'EUR', grossAmount: 100, fxRate: 38, invoicedAmountTry: 3850 });
  const result = periodExchangeDifference({ salesInvoices: [satis], purchaseInvoices: [alis] });
  // Satışta +50 gelir, alışta +50 gider → net 0.
  assert.equal(result.gain, 50);
  assert.equal(result.loss, 50);
  assert.equal(result.net, 0);
  assert.equal(result.invoicedCount, 2);
});

test('dönem dışı kayıtlar kur farkına girmez', () => {
  const rows = [
    createReservation({ checkIn: '2026-08-31', currency: 'EUR', totalAmount: 100, invoicedAmountTry: 4000, fxRate: 38 }),
    createReservation({ checkIn: '2026-09-01', currency: 'EUR', totalAmount: 100, invoicedAmountTry: 4000, fxRate: 38 }),
  ];
  const summary = exchangeDifferenceSummary(rows, {
    amountOf: (r) => r.totalAmount, dateOf: (r) => r.checkIn, from: '2026-09-01', to: '2026-09-30',
  });
  assert.equal(summary.invoicedCount, 1);
  assert.equal(summary.positive, 200);
});

/* --------------------------------------------- otomatik kur çekimi ---- */

test('günlük kur çekimi deftere yazar', async () => {
  const db = emptyDb();
  db.settings = { fx: { source: 'tcmb', rate: 47.5, history: {} } };
  await resetForTests(db);

  const sahteFetch = async () => ({
    ok: true, status: 200,
    text: async () => `<?xml version="1.0"?><Tarih_Date Tarih="05.10.2026">
      <Currency CurrencyCode="EUR"><ForexBuying>41,0000</ForexBuying><BanknoteSelling>41,5000</BanknoteSelling></Currency>
    </Tarih_Date>`,
  });
  const fx = await import('../server/fx.js');
  const original = globalThis.fetch;
  globalThis.fetch = sahteFetch;
  try {
    const result = await syncDailyRate({ currency: 'EUR' });
    assert.equal(result.status, 'saved');
    assert.equal(result.rate, 41.5);
    const saved = await load();
    assert.equal(saved.exchangeRates.length, 1);
    assert.equal(saved.exchangeRates[0].date, new Date().toISOString().slice(0, 10));
    assert.equal(saved.exchangeRates[0].kind, 'tcmb');
    assert.equal(saved.settings.fx.rate, 41.5);
    assert.ok(fx.FX_PROVIDERS.length > 0);

    // Aynı gün ikinci çağrı ağa çıkmaz.
    const again = await syncDailyRate({ currency: 'EUR' });
    assert.equal(again.status, 'exists');
  } finally {
    globalThis.fetch = original;
  }
});

test('kur çekilemezse sistem hata vermez, elle giriş beklenir', async () => {
  await resetForTests(emptyDb());
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('bağlantı yok'); };
  try {
    const result = await syncDailyRate({ currency: 'EUR' });
    assert.equal(result.status, 'failed');
    assert.match(result.error, /Kur alınamadı/);
    assert.equal((await load()).exchangeRates.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});
