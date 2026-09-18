/** PRD §1.2, §2.1, §2.3, §2.4, §3.1, §3.2 gereksinimlerinin doğrulaması. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { breakEven, buildReport, compareReports, expandExpenses, methodWeight, projectedRevenue } from '../src/core/costEngine.js';
import { monthPeriod, period, previousYear, quickRange } from '../src/core/dates.js';
import { convert, rateFor } from '../src/core/fx.js';
import { createExpense, createPriceEntry, defaultSettings } from '../src/core/model.js';
import { fixtureRooms, fixtureSettings, JAN } from './fixtures.js';

const roomRow = (report, id) => report.rooms.find((r) => r.room.id === id);

const twoRooms = () => [
  { ...fixtureRooms()[0], area: 40, baseWeight: 1.5 }, // jakuzili, büyük
  { ...fixtureRooms()[1], area: 20, baseWeight: 1 },
];

/* --------------------------------------------- §1.2 aktif/pasif giderler -- */

test('pasif gider hesaplamadan düşer, kayıt silinmez', () => {
  const expenses = [
    createExpense({ id: 'a', date: '2026-01-05', category: 'rent', description: 'Kira', amount: 1000, allocation: 'general' }),
    createExpense({ id: 'b', date: '2026-01-06', category: 'rent', description: 'İptal', amount: 500, allocation: 'general', active: false }),
  ];
  const report = buildReport({ rooms: twoRooms(), expenses, settings: fixtureSettings(), period: JAN });
  assert.equal(report.totals.generalExpenses, 1000);
  assert.equal(report.expenses.length, 1);
});

/* ------------------------------------ §2.1 dağıtım yöntemleri (A / B / C) -- */

test('Seçenek A — eşit dağıtım: her oda aynı payı alır', () => {
  const report = buildReport({
    rooms: twoRooms(),
    expenses: [createExpense({ date: '2026-01-05', category: 'utility_electricity', description: 'Elektrik', amount: 1000, allocation: 'weighted', weightKind: 'electricity' })],
    settings: fixtureSettings({ allocationMethod: 'equal' }),
    period: JAN,
  });
  assert.equal(roomRow(report, 'room_a').costs.weighted.electricity, 500);
  assert.equal(roomRow(report, 'room_b').costs.weighted.electricity, 500);
});

test('Seçenek B — metrekare bazlı dağıtım (40 m² / 20 m² → 2/3 ve 1/3)', () => {
  const report = buildReport({
    rooms: twoRooms(),
    expenses: [createExpense({ date: '2026-01-05', category: 'utility_electricity', description: 'Elektrik', amount: 900, allocation: 'weighted', weightKind: 'electricity' })],
    settings: fixtureSettings({ allocationMethod: 'area' }),
    period: JAN,
  });
  assert.equal(roomRow(report, 'room_a').costs.weighted.electricity, 600);
  assert.equal(roomRow(report, 'room_b').costs.weighted.electricity, 300);
});

test('Seçenek C — özel katsayı × demirbaş yükü', () => {
  // 1,5 × 1,45 (jakuzi) = 2,175 ↔ 1,0 × 1,0 = 1,0
  assert.equal(methodWeight(twoRooms()[0], 'electricity', 'coefficient'), 2.175);
  assert.equal(methodWeight(twoRooms()[1], 'electricity', 'coefficient'), 1);
  assert.equal(methodWeight(twoRooms()[0], 'electricity', 'equal'), 1);
  assert.equal(methodWeight(twoRooms()[0], 'electricity', 'area'), 40);

  const report = buildReport({
    rooms: twoRooms(),
    expenses: [createExpense({ date: '2026-01-05', category: 'utility_electricity', description: 'Elektrik', amount: 3175, allocation: 'weighted', weightKind: 'electricity' })],
    settings: fixtureSettings({ allocationMethod: 'coefficient' }),
    period: JAN,
  });
  assert.equal(roomRow(report, 'room_a').costs.weighted.electricity, 2175);
  assert.equal(roomRow(report, 'room_b').costs.weighted.electricity, 1000);
});

/* ------------------------------------------- §2.3 tekrarlayan giderler -- */

test('tekrarlayan gider her ayın belirtilen gününde yansır', () => {
  const rent = createExpense({
    date: '2025-06-01', category: 'rent', description: 'Kira', amount: 1000,
    allocation: 'equal', recurring: { enabled: true, dayOfMonth: 1 },
  });
  const occurrences = expandExpenses([rent], JAN, defaultSettings());
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].date, '2026-01-01');
  assert.equal(occurrences[0].generated, true);

  // Çeyreklik dönemde üç kez yansır.
  const quarter = period('2026-01-01', '2026-03-31');
  assert.equal(expandExpenses([rent], quarter, defaultSettings()).length, 3);
});

test('tekrarlayan gider başlangıç tarihinden önce ve bitişten sonra yansımaz', () => {
  const expense = createExpense({
    date: '2026-02-10', category: 'internet', description: 'Abonelik', amount: 100,
    allocation: 'equal', recurring: { enabled: true, dayOfMonth: 10, until: '2026-04-30' },
  });
  const range = period('2026-01-01', '2026-06-30');
  const dates = expandExpenses([expense], range, defaultSettings()).map((e) => e.date);
  assert.deepEqual(dates, ['2026-02-10', '2026-03-10', '2026-04-10']);
});

/* -------------------------------------------------- §2.4 çift kur / FX -- */

test('EUR gider, tarihine ait kurla TL’ye çevrilir', () => {
  const settings = fixtureSettings({
    fx: { source: 'manual', rate: 50, history: { '2026-01-01': 40 }, updatedAt: '' },
  });
  const report = buildReport({
    rooms: twoRooms(),
    expenses: [createExpense({ date: '2026-01-05', category: 'internet', description: 'Yazılım', amount: 100, currency: 'EUR', allocation: 'general' })],
    settings,
    period: JAN,
  });
  // 2026-01-05 için geçmişteki en yakın kur 40 → 4.000 TL
  assert.equal(report.totals.generalExpenses, 4000);
  assert.equal(rateFor(settings.fx, '2026-01-05'), 40);
  assert.equal(convert(100, 'EUR', 'TRY', 40), 4000);
  assert.equal(convert(4000, 'TRY', 'EUR', 40), 100);
});

test('EUR rezervasyon geliri giriş tarihinin kuruyla hesaplanır', () => {
  const settings = fixtureSettings({ fx: { source: 'manual', rate: 45, history: {}, updatedAt: '' } });
  const report = buildReport({
    rooms: twoRooms(),
    reservations: [{
      id: 'r1', roomId: 'room_a', guestName: 'Weber', guests: 2, checkIn: '2026-01-05', checkOut: '2026-01-07',
      totalAmount: 400, currency: 'EUR', commissionRate: 0, breakfastIncluded: false, status: 'confirmed',
    }],
    settings, period: JAN,
  });
  assert.equal(roomRow(report, 'room_a').revenue, 18000); // 400 € × 45
});

/* ------------------------------------------- §2.2 komisyon / net gelir -- */

test('acenta komisyonu net gelirden düşülür', () => {
  const report = buildReport({
    rooms: twoRooms(),
    reservations: [{
      id: 'r1', roomId: 'room_a', guestName: 'Booking misafiri', guests: 2,
      checkIn: '2026-01-05', checkOut: '2026-01-09', totalAmount: 10000, currency: 'TRY',
      commissionRate: 15, breakfastIncluded: false, status: 'confirmed',
    }],
    settings: fixtureSettings({ perGuestTariff: [] }), period: JAN,
  });
  const row = roomRow(report, 'room_a');
  assert.equal(row.revenue, 10000);
  assert.equal(row.commission, 1500);
  assert.equal(row.netRevenue, 8500);
});

/* --------------------------------------------- §1.1 fiyat takvimi -- */

test('takvim fiyatları beklenen geliri ve eksik gün sayısını üretir', () => {
  const rooms = twoRooms();
  const prices = {
    room_a: { '2026-01-01': createPriceEntry({ amount: 5000 }), '2026-01-02': createPriceEntry({ amount: 5000 }) },
    room_b: { '2026-01-01': createPriceEntry({ amount: 100, currency: 'EUR' }) },
  };
  const settings = fixtureSettings({ fx: { source: 'manual', rate: 40, history: {}, updatedAt: '' } });
  const projection = projectedRevenue(rooms, prices, JAN, settings);
  assert.equal(projection.total, 14000); // 10.000 TL + 100 € × 40
  assert.equal(projection.filledDays, 3);
  assert.equal(projection.missingDays, 31 * 2 - 3);
});

/* ------------------------------------- §3.1 / §3.2 metrikler ve analizler -- */

test('ADR, RevPAR ve doluluk envanter üzerinden hesaplanır', () => {
  const report = buildReport({
    rooms: twoRooms(),
    reservations: [{
      id: 'r1', roomId: 'room_a', guestName: 'Test', guests: 2,
      checkIn: '2026-01-01', checkOut: '2026-01-11', totalAmount: 50000, currency: 'TRY',
      commissionRate: 0, breakfastIncluded: false, status: 'confirmed',
    }],
    settings: fixtureSettings({ perGuestTariff: [] }), period: JAN,
  });
  assert.equal(report.totals.roomNights, 10);
  assert.equal(report.totals.availableRoomNights, 62); // 2 oda × 31 gün
  assert.equal(report.totals.adr, 5000); // 50.000 / 10 gece
  assert.equal(report.totals.revpar, round(50000 / 62));
  assert.equal(round(report.totals.occupancyRate * 1000) / 1000, round((10 / 62) * 1000) / 1000);
});

test('başa baş noktası sabit gideri katkı payına böler', () => {
  const be = breakEven({
    totals: { roomNights: 10, adr: 5000 },
    byGroup: { fixed: 30000, variable: 8000, operational: 2000, marketing: 0 },
    availableRoomNights: 62,
  });
  assert.equal(be.fixedCost, 30000);
  assert.equal(be.variablePerNight, 1000); // 10.000 / 10 gece
  assert.equal(be.contributionPerNight, 4000); // 5.000 − 1.000
  assert.equal(be.requiredRoomNights, 8); // ceil(30.000 / 4.000)
  assert.equal(round(be.requiredOccupancy * 10000) / 10000, round((7.5 / 62) * 10000) / 10000);
  assert.equal(be.requiredAdr, 4000); // (30.000 + 10.000) / 10
});

test('hedef marj karşılaştırması rapora işlenir', () => {
  const report = buildReport({
    rooms: twoRooms(),
    reservations: [{
      id: 'r1', roomId: 'room_a', guestName: 'Test', guests: 1,
      checkIn: '2026-01-01', checkOut: '2026-01-03', totalAmount: 10000, currency: 'TRY',
      commissionRate: 0, breakfastIncluded: false, status: 'confirmed',
    }],
    expenses: [createExpense({ date: '2026-01-02', category: 'rent', description: 'Kira', amount: 1000, allocation: 'general' })],
    settings: fixtureSettings({ perGuestTariff: [], targetMargin: 0.35 }),
    period: JAN,
  });
  assert.equal(report.totals.netProfit, 9000);
  assert.equal(report.totals.margin, 0.9);
  assert.equal(report.totals.targetMet, true);
});

test('YOY karşılaştırması iki dönemin farkını oranlar', () => {
  const current = { totals: { revenue: 150, expenses: 80, netProfit: 70, occupancyRate: 0.5, adr: 100, revpar: 50 } };
  const previous = { totals: { revenue: 100, expenses: 100, netProfit: 0, occupancyRate: 0.4, adr: 90, revpar: 36 } };
  const diff = compareReports(current, previous);
  assert.equal(diff.revenue.change, 50);
  assert.equal(diff.revenue.ratio, 0.5);
  assert.equal(diff.netProfit.ratio, null); // önceki dönem 0 → oran yok
});

test('zayi/amortisman ayrı raporlanır ve odaya yazılır', () => {
  const report = buildReport({
    rooms: twoRooms(),
    expenses: [createExpense({ date: '2026-01-08', category: 'writeOff', description: 'Kırılan bardaklar', amount: 750, allocation: 'direct', roomId: 'room_a' })],
    settings: fixtureSettings(), period: JAN,
  });
  assert.equal(report.totals.writeOff, 750);
  assert.equal(roomRow(report, 'room_a').writeOff, 750);
  assert.equal(roomRow(report, 'room_a').costs.direct, 750);
});

/* ------------------------------------------------ §7.1 hızlı tarih filtreleri -- */

test('hızlı tarih aralıkları doğru dönem üretir', () => {
  const today = new Date('2026-08-15T00:00:00Z');
  assert.deepEqual(pick(quickRange('thisMonth', today)), ['2026-08-01', '2026-08-31']);
  assert.deepEqual(pick(quickRange('lastMonth', today)), ['2026-07-01', '2026-07-31']);
  assert.deepEqual(pick(quickRange('thisQuarter', today)), ['2026-07-01', '2026-09-30']);
  assert.deepEqual(pick(quickRange('ytd', today)), ['2026-01-01', '2026-08-15']);
  assert.deepEqual(pick(quickRange('sameMonthLastYear', today)), ['2025-08-01', '2025-08-31']);
  assert.deepEqual(pick(previousYear(monthPeriod('2026-08'))), ['2025-08-01', '2025-08-31']);
});

const pick = (p) => [p.from, p.to];
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
