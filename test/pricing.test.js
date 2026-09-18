/** PRD §3.3 — oda bazlı gecelik maliyet, alt limit ve tavsiye fiyatı. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReport, grossUpForCommission, priceVerdict, roomPricing } from '../src/core/costEngine.js';
import { period } from '../src/core/dates.js';
import { createExpense, createRoom, createTariffItem, defaultSettings } from '../src/core/model.js';

const OCAK = period('2026-01-01', '2026-01-31'); // 31 gün

const oda = (patch = {}) => createRoom({
  id: 'oda_1', number: '101', name: 'King Suite', area: 30, baseWeight: 1,
  beds: [{ type: 'double', count: 1 }], maxOccupancy: 2, basePrice: 3000, ...patch,
});

const rezervasyon = (patch = {}) => ({
  id: 'r1', roomId: 'oda_1', guestName: 'Misafir', guests: 2,
  checkIn: '2026-01-01', checkOut: '2026-01-11', totalAmount: 20000, currency: 'TRY',
  commissionRate: 0, breakfastIncluded: true, status: 'confirmed', ...patch,
});

const ayarlar = (patch = {}) => ({
  ...defaultSettings(),
  fixedShare: 1, // doluluk etkisini kapat, sayılar sade kalsın
  targetMargin: 0.35,
  plannedOccupancy: 0.5,
  perGuestTariff: [createTariffItem({ key: 'kahvalti', label: 'Kahvaltı', amount: 100, basis: 'guestNight' })],
  ...patch,
});

/* --------------------------------------------- eşiklerin hesaplanması --- */

test('alt limit, bir gece daha satmanın maliyetidir (kişi başı sarfiyat)', () => {
  const report = buildReport({
    rooms: [oda()],
    reservations: [rezervasyon()], // 2 kişi × 10 gece = 20 kişi-gece
    settings: ayarlar(),
    period: OCAK,
  });
  const p = report.rooms[0].pricing;
  // Tarife: 20 kişi-gece × 100 TL = 2.000 TL → 10 gecede 200 TL/gece
  assert.equal(p.floor, 200);
  assert.equal(p.soldNights, 10);
  assert.equal(p.assumedGuests, 2);
});

test('başa baş fiyat, sabit gider payını planlanan dolulukta dağıtır', () => {
  const report = buildReport({
    rooms: [oda()],
    reservations: [rezervasyon()],
    expenses: [
      createExpense({ date: '2026-01-05', category: 'rent', description: 'Kira', amount: 15500, allocation: 'equal' }),
    ],
    settings: ayarlar(), // planlanan doluluk %50 → 31 × 0,5 ≈ 16 gece
    period: OCAK,
  });
  const p = report.rooms[0].pricing;
  assert.equal(p.plannedNights, 16);
  assert.equal(p.fixedCost, 15500);
  // 15.500 / 16 = 968,75 sabit + 200 değişken
  assert.equal(p.breakEven, 1168.75);
});

test('tavsiye fiyatı hedef marjı tutturur', () => {
  const p = roomPricing(
    {
      room: { maxOccupancy: 2 }, roomNights: 10, guestNights: 20, occupancyRate: 10 / 31,
      costs: { direct: 0, perGuest: 0, tariff: 2000, equal: 13000, weighted: {} },
      weightedTotal: 0, totalCost: 15000,
    },
    { days: 31, fixedShare: 1, targetMargin: 0.35, plannedOccupancy: 0.5, tariff: [] },
  );
  assert.equal(p.floor, 200);            // 2.000 / 10 gece
  assert.equal(p.breakEven, 1012.5);     // 200 + 13.000/16
  // 1.012,50 / (1 − 0,35) = 1.557,69 → %35 marj bırakır
  assert.equal(p.recommended, 1557.69);
  assert.equal(Math.round((1 - p.breakEven / p.recommended) * 100), 35);
});

test('gecelik gerçekleşen maliyet = toplam gider / satılan gece', () => {
  const report = buildReport({
    rooms: [oda()],
    reservations: [rezervasyon()],
    expenses: [createExpense({ date: '2026-01-05', category: 'rent', description: 'Kira', amount: 18000, allocation: 'equal' })],
    settings: ayarlar(),
    period: OCAK,
  });
  const row = report.rooms[0];
  // 18.000 kira + 2.000 tarife = 20.000 → 10 gecede 2.000 TL/gece
  assert.equal(row.totalCost, 20000);
  assert.equal(row.pricing.costPerSoldNight, 2000);
});

/* ------------------------------------------- kullanıcının örnek senaryosu --- */

test('maliyeti 2.000 TL olan oda 1.900 TL’ye satılırsa zarar bildirilir', () => {
  const report = buildReport({
    rooms: [oda()],
    reservations: [rezervasyon({ totalAmount: 19000 })], // 10 gece × 1.900 TL
    expenses: [createExpense({ date: '2026-01-05', category: 'rent', description: 'Kira', amount: 18000, allocation: 'equal' })],
    settings: ayarlar(),
    period: OCAK,
  });
  const row = report.rooms[0];

  assert.equal(row.adr, 1900);                       // gecelik satış fiyatı
  assert.equal(row.pricing.costPerSoldNight, 2000);  // gecelik maliyet
  assert.equal(row.profit, -1000);                   // 19.000 − 20.000
  assert.ok(row.margin < 0, 'marj negatif olmalı');

  // 1.900 TL, başa baş fiyatın (1.325) üzerinde ama tavsiyenin altında:
  // sabit gideri planlanan dolulukta karşılıyor, hedef marjı tutturmuyor.
  assert.equal(row.pricing.breakEven, 1325);
  assert.equal(priceVerdict(1900, row.pricing), 'under-target');

  // Alt limitin (200 TL) altındaki bir fiyat doğrudan zarardır.
  assert.equal(priceVerdict(150, row.pricing), 'loss');
  assert.equal(priceVerdict(1000, row.pricing), 'below');
  assert.equal(priceVerdict(row.pricing.recommended, row.pricing), 'ok');
});

/* ------------------------------------------------------- kenar durumlar --- */

test('satışı olmayan odada eşikler tarifeden tahmin edilir', () => {
  const report = buildReport({
    rooms: [oda()],
    reservations: [],
    expenses: [createExpense({ date: '2026-01-05', category: 'rent', description: 'Kira', amount: 16000, allocation: 'equal' })],
    settings: ayarlar(),
    period: OCAK,
  });
  const p = report.rooms[0].pricing;
  assert.equal(p.costPerSoldNight, null);
  assert.equal(p.floor, 200);  // 100 TL × 2 kişi varsayımı
  assert.equal(p.breakEven, 1200); // 200 + 16.000/16
});

test('düşük planlanan doluluk, tavsiye fiyatını yükseltir', () => {
  const ortak = {
    rooms: [oda()],
    reservations: [rezervasyon()],
    expenses: [createExpense({ date: '2026-01-05', category: 'rent', description: 'Kira', amount: 15500, allocation: 'equal' })],
    period: OCAK,
  };
  const dusuk = buildReport({ ...ortak, settings: ayarlar({ plannedOccupancy: 0.3 }) }).rooms[0].pricing;
  const yuksek = buildReport({ ...ortak, settings: ayarlar({ plannedOccupancy: 0.9 }) }).rooms[0].pricing;
  assert.ok(dusuk.recommended > yuksek.recommended,
    `düşük doluluk daha yüksek fiyat gerektirmeli (${dusuk.recommended} > ${yuksek.recommended})`);
});

test('komisyonlu kanalda aynı neti bırakan brüt fiyat hesaplanır', () => {
  assert.equal(grossUpForCommission(1000, 15), 1176.47);
  assert.equal(grossUpForCommission(1000, 0), 1000);
  // Brüt fiyattan komisyon düşünce tavsiye fiyatına dönmeli
  assert.equal(Math.round(grossUpForCommission(2000, 20) * 0.8), 2000);
});

test('geçersiz fiyat kararı ok döner (bölme hatası olmaz)', () => {
  assert.equal(priceVerdict(0, null), 'ok');
  assert.equal(priceVerdict(-5, { floor: 10, breakEven: 20, recommended: 30 }), 'ok');
});
