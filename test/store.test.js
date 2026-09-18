import test from 'node:test';
import assert from 'node:assert/strict';

import { ValidationError, createStore } from '../src/core/store.js';
import { seedData } from '../src/core/seed.js';
import { validateRoom } from '../src/core/model.js';
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

test('demo verisi 9 oda ile tutarlıdır ve rapor üretir', () => {
  const data = seedData(new Date('2026-04-15T00:00:00Z'));
  const store = newStore();
  for (const room of data.rooms) assert.deepEqual(validateRoom(room, { rooms: [] }), []);
  assert.equal(data.rooms.length, 9); // PRD: 9 odalı butik otel

  const report = buildReport({ ...data, period: monthPeriod('2026-04') });
  assert.equal(report.rooms.length, data.rooms.length);
  assert.ok(report.totals.revenue > 0);
  assert.ok(report.totals.totalCost > 0);
  assert.ok(report.totals.projectedRevenue > 0, 'takvim fiyatlarından projeksiyon üretilmeli');

  // Dağıtılan + işletme geneli = dönem içinde gerçekleşen giderlerin tamamı
  // (pasif giderler hariç, tekrarlayanlar dâhil, EUR kalemler çevrilmiş).
  const periodExpenseTotal = report.expenses.reduce((sum, e) => sum + e.amountBase, 0);
  const allocated = report.totals.direct + report.totals.perGuest + report.totals.equal + report.totals.weighted;
  assert.equal(
    Math.round((allocated + report.totals.generalExpenses) * 100) / 100,
    Math.round(periodExpenseTotal * 100) / 100,
  );

  // Pasif gider hiçbir kalemde görünmemeli.
  assert.ok(!report.expenses.some((e) => e.description.includes('pasif')));
});

test('fiyat takvimi: toplu güncelleme hafta içi/hafta sonu ayrımı yapar', () => {
  const store = newStore();
  const room = store.saveRoom({ number: '101', beds: [{ type: 'double', count: 1 }], maxOccupancy: 2 });
  const written = store.bulkPrice({
    roomIds: [room.id], from: '2026-03-02', to: '2026-03-08', // Pzt–Paz
    weekdayAmount: 3000, weekendAmount: 4500,
  });
  assert.equal(written, 7);
  const prices = store.getState().prices[room.id];
  assert.equal(prices['2026-03-02'].amount, 3000); // Pazartesi
  assert.equal(prices['2026-03-06'].amount, 4500); // Cuma
  assert.equal(prices['2026-03-07'].amount, 4500); // Cumartesi
  assert.equal(prices['2026-03-08'].amount, 3000); // Pazar
});

test('fiyat takvimi: kopyalama dolu günlerin üstüne yazmaz', () => {
  const store = newStore();
  const room = store.saveRoom({ number: '101', beds: [{ type: 'double', count: 1 }], maxOccupancy: 2 });
  store.bulkPrice({ roomIds: [room.id], from: '2026-03-01', to: '2026-03-07', weekdayAmount: 2000, weekendAmount: 2000 });
  store.savePrice(room.id, '2026-03-08', { amount: 9999 });

  const written = store.copyPrices({
    roomIds: [room.id], sourceFrom: '2026-03-01', sourceTo: '2026-03-07', targetFrom: '2026-03-08',
  });
  const prices = store.getState().prices[room.id];
  assert.equal(prices['2026-03-08'].amount, 9999, 'dolu gün korunmalı');
  assert.equal(prices['2026-03-09'].amount, 2000);
  assert.equal(written, 6);
});

test('gider aktif/pasif anahtarı kaydı silmez', () => {
  const store = newStore();
  const expense = store.saveExpense({ date: '2026-03-02', category: 'rent', description: 'Kira', amount: 1000, allocation: 'general' });
  const toggled = store.toggleExpense(expense.id);
  assert.equal(toggled.active, false);
  assert.equal(store.getState().expenses.length, 1);
  store.toggleExpense(expense.id);
  assert.equal(store.getState().expenses[0].active, true);
});

test('kur ayarı ve görüntüleme para birimi kaydedilir', () => {
  const store = newStore();
  store.saveFx({ rate: 50 });
  store.recordRate('2026-03-01', 48.2);
  store.setDisplayCurrency('EUR');
  const { settings } = store.getState();
  assert.equal(settings.fx.rate, 48.2);
  assert.equal(settings.fx.history['2026-03-01'], 48.2);
  assert.equal(settings.displayCurrency, 'EUR');
  assert.throws(() => store.saveFx({ rate: 0 }), ValidationError);
});

test('kategori yöneticisi özel kategori ekler ve siler', () => {
  const store = newStore();
  const category = store.saveCategory({ label: 'Havuz Kimyasalı', group: 'operational', color: '#199e70' });
  assert.equal(store.getState().settings.customCategories.length, 1);
  store.deleteCategory(category.key);
  assert.equal(store.getState().settings.customCategories.length, 0);
  assert.throws(() => store.saveCategory({ label: '' }), ValidationError);
});
