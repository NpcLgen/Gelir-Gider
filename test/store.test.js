import test from 'node:test';
import assert from 'node:assert/strict';

import { ValidationError, createStore } from '../src/core/store.js';
import { seedData } from '../src/core/seed.js';
import { buildReport } from '../src/core/costEngine.js';
import { monthPeriod } from '../src/core/dates.js';

function memoryAdapter() {
  let value = null;
  return { getItem: () => value, setItem: (_k, v) => { value = v; }, removeItem: () => { value = null; } };
}

const newStore = () => createStore({ adapter: memoryAdapter(), seed: false });

test('oda kaydedilir, güncellenir ve numaraya göre sıralanır', () => {
  const store = newStore();
  store.saveRoom({ id: 'r2', number: '102', name: 'Standart', beds: [{ type: 'double', count: 1 }], maxOccupancy: 2 });
  const suite = store.saveRoom({ id: 'r1', number: '101', name: 'King Suite', beds: [{ type: 'double', count: 1 }], maxOccupancy: 2 });
  assert.deepEqual(store.getState().rooms.map((r) => r.number), ['101', '102']);

  store.saveRoom({ ...suite, name: 'King Suite Plus' });
  assert.equal(store.getState().rooms[0].name, 'King Suite Plus');
  assert.equal(store.getState().rooms.length, 2);
});

test('geçersiz oda kaydı ValidationError fırlatır', () => {
  const store = newStore();
  assert.throws(
    () => store.saveRoom({ number: '', beds: [], maxOccupancy: 0 }),
    (err) => err instanceof ValidationError && err.errors.length >= 2,
  );
});

test('demirbaş kutucuğu aç/kapat oda kartını günceller', () => {
  const store = newStore();
  const room = store.saveRoom({ number: '101', beds: [{ type: 'double', count: 1 }], maxOccupancy: 2, amenities: ['ac'] });
  store.toggleAmenity(room.id, 'jacuzzi');
  assert.deepEqual(store.getState().rooms[0].amenities, ['ac', 'jacuzzi']);
  store.toggleAmenity(room.id, 'ac');
  assert.deepEqual(store.getState().rooms[0].amenities, ['jacuzzi']);
});

test('kapasiteyi aşan rezervasyon store seviyesinde reddedilir', () => {
  const store = newStore();
  const room = store.saveRoom({ number: '101', beds: [{ type: 'double', count: 1 }], maxOccupancy: 2 });
  assert.throws(
    () => store.saveReservation({ roomId: room.id, guestName: 'Grup', guests: 5, checkIn: '2026-03-01', checkOut: '2026-03-03', totalAmount: 100 }),
    ValidationError,
  );
  assert.equal(store.getState().reservations.length, 0);
});

test('oda silinince rezervasyonları da silinir, doğrudan giderleri genele düşer', () => {
  const store = newStore();
  const room = store.saveRoom({ number: '101', beds: [{ type: 'double', count: 1 }], maxOccupancy: 2, amenities: ['jacuzzi'] });
  store.saveReservation({ roomId: room.id, guestName: 'Misafir', guests: 2, checkIn: '2026-03-01', checkOut: '2026-03-03', totalAmount: 100 });
  store.saveExpense({ date: '2026-03-02', category: 'maintenance', description: 'Jakuzi', amount: 500, allocation: 'direct', roomId: room.id, amenityKey: 'jacuzzi' });

  store.deleteRoom(room.id);
  assert.equal(store.getState().reservations.length, 0);
  assert.equal(store.getState().expenses[0].allocation, 'general');
});

test('abonelik değişikliklerde tetiklenir ve veri kalıcı yazılır', () => {
  const adapter = memoryAdapter();
  const store = createStore({ adapter, seed: false });
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  store.saveRoom({ number: '101', beds: [{ type: 'double', count: 1 }], maxOccupancy: 2 });
  assert.equal(calls, 1);
  off();
  store.saveRoom({ number: '102', beds: [{ type: 'double', count: 1 }], maxOccupancy: 2 });
  assert.equal(calls, 1);

  const reopened = createStore({ adapter, seed: false });
  assert.equal(reopened.getState().rooms.length, 2);
});

test('dışa/içe aktarım durumu korur', () => {
  const store = newStore();
  store.saveRoom({ number: '101', beds: [{ type: 'double', count: 1 }], maxOccupancy: 2 });
  const json = store.exportJSON();
  const fresh = newStore();
  fresh.importJSON(json);
  assert.equal(fresh.getState().rooms[0].number, '101');
});

test('demo verisi tutarlıdır ve rapor üretir', () => {
  const data = seedData(new Date('2026-04-15T00:00:00Z'));
  const store = newStore();
  for (const room of data.rooms) assert.deepEqual([], store.saveRoom(room) && []);
  const report = buildReport({ ...data, period: monthPeriod('2026-04') });
  assert.equal(report.rooms.length, data.rooms.length);
  assert.ok(report.totals.revenue > 0);
  assert.ok(report.totals.totalCost > 0);
  const expenseTotal = data.expenses.reduce((s, e) => s + e.amount, 0);
  const allocated = report.totals.direct + report.totals.perGuest + report.totals.equal + report.totals.weighted;
  assert.equal(Math.round((allocated + report.totals.generalExpenses) * 100) / 100, expenseTotal);
});
