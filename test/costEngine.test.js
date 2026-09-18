import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReport, nightsInPeriod, splitByWeights, tariffLinesFor, utilityWeight } from '../src/core/costEngine.js';
import { period } from '../src/core/dates.js';
import { createExpense, createReservation, createRoom, createTariffItem } from '../src/core/model.js';
import { JAN, fixtureAll, fixtureRooms, fixtureSettings } from './fixtures.js';

const roomRow = (report, id) => report.rooms.find((r) => r.room.id === id);

test('ağırlıklı bölme kuruşuna kadar tutarı korur', () => {
  const shares = splitByWeights(100, [1, 1, 1]);
  assert.equal(shares.reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(shares, [33.34, 33.33, 33.33]);
  assert.deepEqual(splitByWeights(2450, [1.45, 1]), [1450, 1000]);
  assert.deepEqual(splitByWeights(500, [0, 0]), [0, 0]);
});

test('dönem dışı geceler sayılmaz, gelir gecelere yayılır', () => {
  const reservation = createReservation({
    roomId: 'room_a', guestName: 'Yılbaşı', guests: 2,
    checkIn: '2025-12-30', checkOut: '2026-01-03', totalAmount: 4000, // 4 gece, 2'si ocakta
  });
  assert.equal(nightsInPeriod(reservation, JAN), 2);

  const report = buildReport({
    rooms: fixtureRooms(), reservations: [reservation], expenses: [],
    settings: fixtureSettings(), period: JAN,
  });
  assert.equal(roomRow(report, 'room_a').revenue, 2000);
  assert.equal(roomRow(report, 'room_a').guestNights, 4);
});

test('doğrudan gider tamamıyla ilgili odaya yazılır', () => {
  const report = buildReport(fixtureAll());
  assert.equal(roomRow(report, 'room_a').costs.direct, 5000);
  assert.equal(roomRow(report, 'room_b').costs.direct, 0);
  const line = roomRow(report, 'room_a').lines.find((l) => l.source === 'direct');
  assert.equal(line.label, 'Jakuzi motor arızası');
});

test('kişi başı gider, kişi-gece oranına göre paylaştırılır', () => {
  const report = buildReport(fixtureAll());
  // A: 2 kişi × 3 gece = 6, B: 1 kişi × 2 gece = 2 → 800 TL, 6/8 ve 2/8
  assert.equal(roomRow(report, 'room_a').guestNights, 6);
  assert.equal(roomRow(report, 'room_b').guestNights, 2);
  assert.equal(roomRow(report, 'room_a').costs.perGuest, 600);
  assert.equal(roomRow(report, 'room_b').costs.perGuest, 200);
});

test('kişi başı tarife konaklama başına sarfiyat üretir, kahvaltısız rezervasyonu atlar', () => {
  const report = buildReport(fixtureAll());
  assert.equal(roomRow(report, 'room_a').costs.tariff, 600); // 6 kişi-gece × 100 TL kahvaltı
  assert.equal(roomRow(report, 'room_b').costs.tariff, 0); // kahvaltı dahil değil
});

test('tarife hesap tabanları: kişi-gece, kişi-konaklama, konaklama', () => {
  const settings = fixtureSettings({
    perGuestTariff: [
      createTariffItem({ key: 'gn', label: 'Su', amount: 10, basis: 'guestNight' }),
      createTariffItem({ key: 'gs', label: 'Nevresim', amount: 30, basis: 'guestStay' }),
      createTariffItem({ key: 's', label: 'Çıkış Temizliği', amount: 90, basis: 'stay' }),
    ],
  });
  const reservation = createReservation({
    roomId: 'room_a', guestName: 'Test', guests: 2, checkIn: '2026-01-05', checkOut: '2026-01-08', totalAmount: 0,
  });
  const lines = tariffLinesFor(reservation, JAN, settings);
  assert.deepEqual(lines.map((l) => l.amount), [60, 60, 90]);
});

test('genel gider demirbaş katsayısına göre dağıtılır (jakuzili oda daha çok pay alır)', () => {
  const report = buildReport(fixtureAll());
  const a = roomRow(report, 'room_a');
  const b = roomRow(report, 'room_b');
  assert.equal(a.amenityLoads.electricity, 1.45);
  assert.equal(a.costs.weighted.electricity, 1450);
  assert.equal(b.costs.weighted.electricity, 1000);
  assert.equal(a.costs.weighted.electricity + b.costs.weighted.electricity, 2450);
});

test('doluluk oranı genel gider ağırlığını etkiler (fixedShare < 1)', () => {
  const rooms = fixtureRooms();
  const dolu = { ...rooms[0], amenities: [] };
  const bos = rooms[1];
  const p = period('2026-01-01', '2026-01-10'); // 10 gün
  const doluAgirlik = utilityWeight(dolu, 'electricity', 1, 0.25); // %100 doluluk
  const bosAgirlik = utilityWeight(bos, 'electricity', 0, 0.25); // boş
  assert.equal(doluAgirlik, 1);
  assert.equal(bosAgirlik, 0.25);

  const report = buildReport({
    rooms: [dolu, bos],
    reservations: [createReservation({ roomId: dolu.id, guestName: 'Uzun', guests: 2, checkIn: '2026-01-01', checkOut: '2026-01-11', totalAmount: 0 })],
    expenses: [createExpense({ date: '2026-01-05', category: 'utility_electricity', description: 'Elektrik', amount: 1250, allocation: 'weighted', weightKind: 'electricity' })],
    settings: { ...fixtureSettings(), fixedShare: 0.25 },
    period: p,
  });
  assert.equal(roomRow(report, dolu.id).costs.weighted.electricity, 1000);
  assert.equal(roomRow(report, bos.id).costs.weighted.electricity, 250);
});

test('pasif oda genel giderden pay almaz', () => {
  const rooms = fixtureRooms().map((r) => (r.id === 'room_b' ? { ...r, status: 'passive' } : r));
  const report = buildReport({
    rooms, reservations: [], expenses: [
      createExpense({ date: '2026-01-05', category: 'utility_electricity', description: 'Elektrik', amount: 1000, allocation: 'weighted', weightKind: 'electricity' }),
    ], settings: fixtureSettings(), period: JAN,
  });
  assert.equal(roomRow(report, 'room_a').costs.weighted.electricity, 1000);
  assert.equal(roomRow(report, 'room_b').costs.weighted.electricity, 0);
});

test('eşit dağıtım yalnızca satıştaki odalara uygulanır', () => {
  const rooms = [...fixtureRooms(), createRoom({ id: 'room_c', number: '103', beds: [{ type: 'single', count: 1 }], maxOccupancy: 1, status: 'maintenance' })];
  const report = buildReport({
    rooms, reservations: [], expenses: [
      createExpense({ date: '2026-01-05', category: 'rent', description: 'Kira', amount: 900, allocation: 'equal' }),
    ], settings: fixtureSettings(), period: JAN,
  });
  assert.equal(roomRow(report, 'room_a').costs.equal, 450);
  assert.equal(roomRow(report, 'room_b').costs.equal, 450);
  assert.equal(roomRow(report, 'room_c').costs.equal, 0);
});

test('işletme geneli giderler odalara dağıtılmaz', () => {
  const report = buildReport(fixtureAll());
  assert.equal(report.unallocated.general, 1000);
  assert.equal(report.totals.generalExpenses, 1000);
});

test('konaklama yoksa kişi başı gider dağıtılamaz olarak işaretlenir', () => {
  const report = buildReport({
    rooms: fixtureRooms(), reservations: [], settings: fixtureSettings(), period: JAN,
    expenses: [createExpense({ date: '2026-01-05', category: 'food', description: 'Kahvaltı alımı', amount: 500, allocation: 'perGuest' })],
  });
  assert.equal(report.unallocated.undistributed, 500);
  assert.equal(report.unallocated.items[0].reason, 'Dönemde konaklama yok');
});

test('dağıtılan tutarların toplamı dönem giderlerine eşittir', () => {
  const data = fixtureAll();
  const report = buildReport(data);
  const expenseTotal = data.expenses.reduce((sum, e) => sum + e.amount, 0);
  const allocated = report.totals.direct + report.totals.perGuest + report.totals.equal + report.totals.weighted;
  assert.equal(Math.round((allocated + report.totals.generalExpenses) * 100) / 100, expenseTotal);
});

test('kârlılık metrikleri: kişi başı maliyet, ADR ve marj', () => {
  const report = buildReport(fixtureAll());
  const a = roomRow(report, 'room_a');
  // 5000 doğrudan + 600 kişi başı + 600 tarife + 1450 elektrik = 7650
  assert.equal(a.totalCost, 7650);
  assert.equal(a.revenue, 15000);
  assert.equal(a.profit, 7350);
  assert.equal(a.adr, 5000); // 15000 / 3 gece
  assert.equal(a.costPerGuestNight, 1275); // 7650 / 6 kişi-gece
  assert.equal(Math.round(a.margin * 100), 49);

  assert.equal(report.totals.revenue, 21000);
  assert.equal(report.totals.netProfit, 21000 - report.totals.totalCost - 1000);
});

test('rapor toplamları doluluk oranını dönem gün sayısına göre verir', () => {
  const report = buildReport(fixtureAll());
  // A: 3 gece, B: 2 gece → 5 oda-gecesi / (2 oda × 31 gün)
  assert.equal(report.totals.roomNights, 5);
  assert.equal(Math.round(report.totals.occupancyRate * 10000) / 10000, Math.round((5 / 62) * 10000) / 10000);
});

test('iptal edilen rezervasyon gelir ve sarfiyat üretmez', () => {
  const data = fixtureAll();
  data.reservations = data.reservations.map((r) => (r.id === 'res_a' ? { ...r, status: 'cancelled' } : r));
  const report = buildReport(data);
  assert.equal(roomRow(report, 'room_a').revenue, 0);
  assert.equal(roomRow(report, 'room_a').guestNights, 0);
  assert.equal(roomRow(report, 'room_a').costs.tariff, 0);
  // kişi başı gider artık tamamen B odasına gider
  assert.equal(roomRow(report, 'room_b').costs.perGuest, 800);
});
