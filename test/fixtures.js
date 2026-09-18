import { createExpense, createReservation, createRoom, createTariffItem, defaultSettings } from '../src/core/model.js';
import { period } from '../src/core/dates.js';

export const JAN = period('2026-01-01', '2026-01-31'); // 31 gün

export function fixtureRooms() {
  return [
    createRoom({
      id: 'room_a', number: '101', name: 'King Suite', baseWeight: 1,
      beds: [{ type: 'double', count: 1 }, { type: 'single', count: 1 }],
      maxOccupancy: 3, amenities: ['jacuzzi'], basePrice: 5000,
    }),
    createRoom({
      id: 'room_b', number: '102', name: 'Bahçe Manzaralı Standart', baseWeight: 1,
      beds: [{ type: 'double', count: 1 }],
      maxOccupancy: 2, amenities: [], basePrice: 3000,
    }),
  ];
}

/** Doluluk etkisini devre dışı bırakır (fixedShare = 1): saf demirbaş katsayısı testleri için. */
export function fixtureSettings(overrides = {}) {
  return {
    ...defaultSettings(),
    fixedShare: 1,
    perGuestTariff: [createTariffItem({ key: 'bf', label: 'Kahvaltı', amount: 100, basis: 'guestNight', requiresBreakfast: true })],
    ...overrides,
  };
}

export function fixtureReservations() {
  return [
    // 2 kişi × 3 gece = 6 kişi-gece
    createReservation({ id: 'res_a', roomId: 'room_a', guestName: 'A Misafiri', guests: 2, checkIn: '2026-01-05', checkOut: '2026-01-08', totalAmount: 15000 }),
    // 1 kişi × 2 gece = 2 kişi-gece, kahvaltısız
    createReservation({ id: 'res_b', roomId: 'room_b', guestName: 'B Misafiri', guests: 1, checkIn: '2026-01-10', checkOut: '2026-01-12', totalAmount: 6000, breakfastIncluded: false }),
  ];
}

export function fixtureExpenses() {
  return [
    createExpense({ id: 'exp_el', date: '2026-01-15', category: 'utility_electricity', description: 'Elektrik', amount: 2450, allocation: 'weighted', weightKind: 'electricity' }),
    createExpense({ id: 'exp_pg', date: '2026-01-15', category: 'housekeeping', description: 'Sarf malzeme', amount: 800, allocation: 'perGuest' }),
    createExpense({ id: 'exp_dir', date: '2026-01-16', category: 'maintenance', description: 'Jakuzi motor arızası', amount: 5000, allocation: 'direct', roomId: 'room_a', amenityKey: 'jacuzzi' }),
    createExpense({ id: 'exp_gen', date: '2026-01-17', category: 'marketing', description: 'OTA komisyonu', amount: 1000, allocation: 'general' }),
  ];
}

export function fixtureAll() {
  return {
    rooms: fixtureRooms(),
    reservations: fixtureReservations(),
    expenses: fixtureExpenses(),
    settings: fixtureSettings(),
    period: JAN,
  };
}
