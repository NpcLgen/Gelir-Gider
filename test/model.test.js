import test from 'node:test';
import assert from 'node:assert/strict';

import {
  amenityLoad,
  bedCapacity,
  bedSummary,
  createExpense,
  createReservation,
  createRoom,
  maxOccupancyOptions,
  roomLabel,
  serviceableAmenities,
  validateExpense,
  validateReservation,
  validateRoom,
} from '../src/core/model.js';
import { fixtureRooms } from './fixtures.js';

test('oda kartı: numara ve konsept ismi birlikte etiketlenir', () => {
  const [suite] = fixtureRooms();
  assert.equal(roomLabel(suite), '101 - King Suite');
});

test('yatak yapılandırması kapasiteyi belirler', () => {
  const room = createRoom({
    number: '301',
    beds: [{ type: 'double', count: 1 }, { type: 'single', count: 1 }],
  });
  assert.equal(bedCapacity(room), 3);
  assert.deepEqual(maxOccupancyOptions(room), [1, 2, 3]);
  assert.equal(bedSummary(room), '1 Çift Kişilik Yatak + 1 Tek Kişilik Yatak');
});

test('bebek karyolası kapasiteye sayılmaz', () => {
  const room = createRoom({ number: '302', beds: [{ type: 'double', count: 1 }, { type: 'baby', count: 1 }] });
  assert.equal(bedCapacity(room), 2);
});

test('maksimum kişi sayısı yatak kapasitesini aşamaz', () => {
  const room = createRoom({ number: '303', beds: [{ type: 'single', count: 1 }], maxOccupancy: 3 });
  const errors = validateRoom(room, { rooms: [] });
  assert.ok(errors.some((e) => e.includes('yatak kapasitesini')), errors.join('|'));
});

test('aynı oda numarası iki kez tanımlanamaz', () => {
  const rooms = fixtureRooms();
  const duplicate = createRoom({ number: '101', beds: [{ type: 'single', count: 1 }], maxOccupancy: 1 });
  assert.ok(validateRoom(duplicate, { rooms }).some((e) => e.includes('zaten tanımlı')));
});

test('geçerli oda kartı hatasızdır', () => {
  const [suite] = fixtureRooms();
  assert.deepEqual(validateRoom(suite, { rooms: fixtureRooms().slice(1) }), []);
});

test('demirbaş katsayısı: 1 + seçili demirbaşların yükü', () => {
  const [suite, standard] = fixtureRooms();
  assert.equal(amenityLoad(suite, 'electricity'), 1.45); // jakuzi
  assert.equal(amenityLoad(suite, 'water'), 1.6);
  assert.equal(amenityLoad(standard, 'electricity'), 1);
});

test('bakım gideri yazılabilecek demirbaşlar listelenir', () => {
  const room = createRoom({ number: '304', amenities: ['jacuzzi', 'seaView'], beds: [{ type: 'double', count: 1 }], maxOccupancy: 2 });
  assert.deepEqual(serviceableAmenities(room).map((a) => a.key), ['jacuzzi']);
});

test('rezervasyondaki kişi sayısı oda kapasitesini aşamaz', () => {
  const rooms = fixtureRooms();
  const reservation = createReservation({
    roomId: 'room_b', guestName: 'Kalabalık Grup', guests: 4,
    checkIn: '2026-02-01', checkOut: '2026-02-03', totalAmount: 5000,
  });
  const errors = validateReservation(reservation, { rooms, reservations: [] });
  assert.ok(errors.some((e) => e.includes('kapasitesi 2 kişidir')), errors.join('|'));
});

test('kapasite sınırındaki rezervasyon kabul edilir', () => {
  const rooms = fixtureRooms();
  const reservation = createReservation({
    roomId: 'room_a', guestName: 'Tam Kapasite', guests: 3,
    checkIn: '2026-02-01', checkOut: '2026-02-03', totalAmount: 9000,
  });
  assert.deepEqual(validateReservation(reservation, { rooms, reservations: [] }), []);
});

test('aynı odada çakışan tarih rezervasyonu engellenir', () => {
  const rooms = fixtureRooms();
  const existing = createReservation({
    id: 'res_1', roomId: 'room_a', guestName: 'İlk', guests: 2,
    checkIn: '2026-02-01', checkOut: '2026-02-05', totalAmount: 8000,
  });
  const clash = createReservation({
    roomId: 'room_a', guestName: 'İkinci', guests: 2,
    checkIn: '2026-02-04', checkOut: '2026-02-07', totalAmount: 8000,
  });
  assert.ok(validateReservation(clash, { rooms, reservations: [existing] }).some((e) => e.includes('oda dolu')));

  const afterCheckout = createReservation({
    roomId: 'room_a', guestName: 'Üçüncü', guests: 2,
    checkIn: '2026-02-05', checkOut: '2026-02-07', totalAmount: 8000,
  });
  assert.deepEqual(validateReservation(afterCheckout, { rooms, reservations: [existing] }), []);
});

test('bakımdaki odaya rezervasyon açılamaz', () => {
  const rooms = fixtureRooms().map((r) => (r.id === 'room_b' ? { ...r, status: 'maintenance' } : r));
  const reservation = createReservation({
    roomId: 'room_b', guestName: 'Test', guests: 1, checkIn: '2026-02-01', checkOut: '2026-02-02', totalAmount: 100,
  });
  assert.ok(validateReservation(reservation, { rooms, reservations: [] }).some((e) => e.includes('satışta değil')));
});

test('doğrudan gider odada olmayan demirbaşa yazılamaz', () => {
  const rooms = fixtureRooms();
  const expense = createExpense({
    date: '2026-01-10', category: 'maintenance', description: 'Jakuzi motoru',
    amount: 4000, allocation: 'direct', roomId: 'room_b', amenityKey: 'jacuzzi',
  });
  assert.ok(validateExpense(expense, { rooms }).some((e) => e.includes('demirbaş listesinde yok')));
});

test('doğrudan gider seçili odanın demirbaşına yazılabilir', () => {
  const rooms = fixtureRooms();
  const expense = createExpense({
    date: '2026-01-10', category: 'maintenance', description: 'Jakuzi motor arızası',
    amount: 4000, allocation: 'direct', roomId: 'room_a', amenityKey: 'jacuzzi',
  });
  assert.deepEqual(validateExpense(expense, { rooms }), []);
});

test('gider kategorisi varsayılan dağıtım yöntemini getirir', () => {
  const expense = createExpense({ date: '2026-01-10', category: 'utility_electricity', description: 'Elektrik', amount: 100 });
  assert.equal(expense.allocation, 'weighted');
  assert.equal(expense.weightKind, 'electricity');
});
