/** Demo verisi — 9 odalı butik otel (PRD referans senaryosu). */

import { createExpense, createPriceEntry, createReservation, createRoom, defaultSettings } from './model.js';
import { eachDate, isWeekend, monthPeriod, shiftMonth } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');

export function seedData(today = new Date()) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const mk = `${y}-${pad(m)}`;
  const d = (day) => `${mk}-${pad(day)}`;

  const rooms = [
    createRoom({
      id: 'room_101', number: '101', name: 'King Suite', floor: 1, area: 42, baseWeight: 1.4, basePrice: 6500,
      beds: [{ type: 'double', count: 1 }, { type: 'single', count: 1 }],
      maxOccupancy: 3,
      amenities: ['jacuzzi', 'fireplace', 'ac', 'smartTv', 'espresso', 'safeBox', 'balcony', 'seaView'],
      notes: 'Otelin amiral süiti. Jakuzi bakımı 3 ayda bir yapılır.',
    }),
    createRoom({
      id: 'room_102', number: '102', name: 'Bahçe Manzaralı Standart', floor: 1, area: 24, baseWeight: 1, basePrice: 3200,
      beds: [{ type: 'double', count: 1 }], maxOccupancy: 2,
      amenities: ['ac', 'smartTv', 'kettle', 'shower', 'gardenView'],
    }),
    createRoom({
      id: 'room_103', number: '103', name: 'Aile Odası', floor: 1, area: 34, baseWeight: 1.2, basePrice: 4400,
      beds: [{ type: 'double', count: 1 }, { type: 'bunk', count: 1 }], maxOccupancy: 4,
      amenities: ['ac', 'smartTv', 'minibar', 'shower', 'kitchenette', 'balcony'],
    }),
    createRoom({
      id: 'room_104', number: '104', name: 'Ekonomi Çift', floor: 1, area: 20, baseWeight: 0.9, basePrice: 2600,
      beds: [{ type: 'double', count: 1 }], maxOccupancy: 2,
      amenities: ['ac', 'smartTv', 'shower'],
    }),
    createRoom({
      id: 'room_201', number: '201', name: 'Şömineli Deluxe', floor: 2, area: 36, baseWeight: 1.25, basePrice: 5200,
      beds: [{ type: 'double', count: 1 }, { type: 'sofa', count: 1 }], maxOccupancy: 4,
      amenities: ['fireplace', 'floorHeating', 'ac', 'smartTv', 'espresso', 'towelWarmer', 'seaView'],
    }),
    createRoom({
      id: 'room_202', number: '202', name: 'Ekonomi Tek', floor: 2, area: 16, baseWeight: 0.8, basePrice: 2100,
      beds: [{ type: 'single', count: 1 }], maxOccupancy: 1,
      amenities: ['ac', 'smartTv', 'shower'],
    }),
    createRoom({
      id: 'room_203', number: '203', name: 'Sauna Suit', floor: 2, area: 40, baseWeight: 1.3, basePrice: 5900,
      beds: [{ type: 'double', count: 1 }], maxOccupancy: 2, status: 'maintenance',
      amenities: ['sauna', 'jacuzzi', 'ac', 'smartTv', 'minibar', 'waterHeater'],
      notes: 'Sauna rezistansı değişimi bekleniyor.',
    }),
    createRoom({
      id: 'room_204', number: '204', name: 'Deniz Manzaralı Çift', floor: 2, area: 28, baseWeight: 1.1, basePrice: 4100,
      beds: [{ type: 'double', count: 1 }], maxOccupancy: 2,
      amenities: ['ac', 'smartTv', 'minibar', 'shower', 'balcony', 'seaView', 'kettle'],
    }),
    createRoom({
      id: 'room_301', number: '301', name: 'Çatı Katı Loft', floor: 3, area: 46, baseWeight: 1.35, basePrice: 7200,
      beds: [{ type: 'double', count: 1 }, { type: 'sofa', count: 1 }], maxOccupancy: 4,
      amenities: ['jacuzzi', 'ac', 'smartTv', 'espresso', 'kitchenette', 'soundSystem', 'balcony', 'seaView'],
    }),
  ];

  const reservations = [
    createReservation({ roomId: 'room_101', guestName: 'Yılmaz Ailesi', guests: 3, checkIn: d(2), checkOut: d(6), totalAmount: 26000, channel: 'direct' }),
    createReservation({ roomId: 'room_101', guestName: 'K. Demir', guests: 2, checkIn: d(12), checkOut: d(15), totalAmount: 19500, channel: 'booking', commissionRate: 15 }),
    createReservation({ roomId: 'room_101', guestName: 'Öztürk Ailesi', guests: 3, checkIn: d(19), checkOut: d(25), totalAmount: 39000, channel: 'direct' }),
    createReservation({ roomId: 'room_102', guestName: 'A. Çelik', guests: 2, checkIn: d(3), checkOut: d(9), totalAmount: 19200, channel: 'booking', commissionRate: 15 }),
    createReservation({ roomId: 'room_102', guestName: 'S. Korkmaz', guests: 1, checkIn: d(14), checkOut: d(17), totalAmount: 8700, channel: 'direct', breakfastIncluded: false }),
    createReservation({ roomId: 'room_102', guestName: 'B. Aslan', guests: 2, checkIn: d(19), checkOut: d(26), totalAmount: 22400, channel: 'airbnb', commissionRate: 14 }),
    createReservation({ roomId: 'room_103', guestName: 'Aydın Ailesi', guests: 4, checkIn: d(5), checkOut: d(12), totalAmount: 30800, channel: 'direct' }),
    createReservation({ roomId: 'room_103', guestName: 'Doğan Ailesi', guests: 4, checkIn: d(14), checkOut: d(20), totalAmount: 26400, channel: 'booking', commissionRate: 15 }),
    createReservation({ roomId: 'room_103', guestName: 'N. Polat', guests: 2, checkIn: d(22), checkOut: d(27), totalAmount: 21000, channel: 'direct' }),
    createReservation({ roomId: 'room_104', guestName: 'Schneider', guests: 2, checkIn: d(7), checkOut: d(14), totalAmount: 420, currency: 'EUR', channel: 'booking', commissionRate: 15 }),
    createReservation({ roomId: 'room_201', guestName: 'M. Şahin', guests: 2, checkIn: d(8), checkOut: d(11), totalAmount: 15600, channel: 'airbnb', commissionRate: 14 }),
    createReservation({ roomId: 'room_201', guestName: 'H. Erdem', guests: 2, checkIn: d(12), checkOut: d(16), totalAmount: 20800, channel: 'booking', commissionRate: 15 }),
    createReservation({ roomId: 'room_201', guestName: 'Kaya & Ekibi', guests: 4, checkIn: d(18), checkOut: d(21), totalAmount: 17400, channel: 'direct' }),
    createReservation({ roomId: 'room_202', guestName: 'E. Güneş', guests: 1, checkIn: d(4), checkOut: d(10), totalAmount: 12600, channel: 'direct' }),
    createReservation({ roomId: 'room_202', guestName: 'T. Yalçın', guests: 1, checkIn: d(16), checkOut: d(23), totalAmount: 14700, channel: 'booking', commissionRate: 15 }),
    createReservation({ roomId: 'room_204', guestName: 'Rossi', guests: 2, checkIn: d(6), checkOut: d(13), totalAmount: 560, currency: 'EUR', channel: 'airbnb', commissionRate: 14 }),
    createReservation({ roomId: 'room_204', guestName: 'F. Kurt', guests: 2, checkIn: d(17), checkOut: d(22), totalAmount: 20500, channel: 'direct' }),
    createReservation({ roomId: 'room_301', guestName: 'Weber Ailesi', guests: 4, checkIn: d(3), checkOut: d(10), totalAmount: 980, currency: 'EUR', channel: 'booking', commissionRate: 15 }),
    createReservation({ roomId: 'room_301', guestName: 'C. Aksoy', guests: 2, checkIn: d(15), checkOut: d(19), totalAmount: 28800, channel: 'direct' }),
    createReservation({ roomId: 'room_301', guestName: 'Z. Ünal', guests: 3, checkIn: d(24), checkOut: d(28), totalAmount: 29600, channel: 'direct' }),
  ];

  const expenses = [
    createExpense({ date: d(1), category: 'utility_electricity', description: 'Elektrik faturası', amount: 22400, allocation: 'weighted', weightKind: 'electricity', vendor: 'Enerjisa' }),
    createExpense({ date: d(1), category: 'utility_water', description: 'Su faturası', amount: 6100, allocation: 'weighted', weightKind: 'water', vendor: 'İSKİ' }),
    createExpense({ date: d(1), category: 'utility_gas', description: 'Doğalgaz', amount: 8300, allocation: 'weighted', weightKind: 'heating', vendor: 'İGDAŞ' }),
    createExpense({ date: d(7), category: 'maintenance', description: 'Jakuzi motor arızası - işçilik + parça', amount: 4750, allocation: 'direct', roomId: 'room_101', amenityKey: 'jacuzzi', vendor: 'Aqua Servis' }),
    createExpense({ date: d(9), category: 'maintenance', description: 'Klima gaz dolumu', amount: 1450, allocation: 'direct', roomId: 'room_103', amenityKey: 'ac', vendor: 'İklim Teknik' }),
    createExpense({ date: d(11), category: 'furnishing', description: 'Espresso makinesi değişimi', amount: 8900, allocation: 'direct', roomId: 'room_201', amenityKey: 'espresso', vendor: 'Kahve Dünyası' }),
    createExpense({ date: d(18), category: 'writeOff', description: 'Zayi: kırılan cam bardak takımı + lekelenen havlular', amount: 1850, allocation: 'direct', roomId: 'room_301', vendor: '—' }),
    createExpense({ date: d(6), category: 'housekeeping', description: 'Temizlik kimyasalları', amount: 3100, allocation: 'perGuest', vendor: 'Hijyen A.Ş.' }),
    createExpense({ date: d(13), category: 'food', description: 'Kahvaltı market alışverişi', amount: 9600, allocation: 'perGuest', vendor: 'Toptancı' }),
    createExpense({ date: d(20), category: 'laundry', description: 'Çamaşırhane hizmeti', amount: 4200, allocation: 'perGuest', vendor: 'Beyaz Çamaşırhane' }),
    // Tekrarlayan giderler (abonelikler) — her ayın aynı gününde otomatik yansır.
    createExpense({ date: `${shiftMonth(mk, -6)}-01`, category: 'rent', description: 'Bina kirası', amount: 65000, allocation: 'equal', recurring: { enabled: true, dayOfMonth: 1 } }),
    createExpense({ date: `${shiftMonth(mk, -6)}-05`, category: 'staff', description: 'Personel maaşları', amount: 48000, allocation: 'equal', recurring: { enabled: true, dayOfMonth: 5 } }),
    createExpense({ date: `${shiftMonth(mk, -6)}-10`, category: 'internet', description: 'İnternet + otel yazılımı aboneliği', amount: 120, currency: 'EUR', allocation: 'equal', recurring: { enabled: true, dayOfMonth: 10 } }),
    createExpense({ date: `${shiftMonth(mk, -6)}-15`, category: 'accounting', description: 'Mali müşavir', amount: 7500, allocation: 'equal', recurring: { enabled: true, dayOfMonth: 15 } }),
    createExpense({ date: d(25), category: 'commission', description: 'OTA komisyon mahsuplaşması', amount: 4800, allocation: 'general', vendor: 'Booking.com' }),
    createExpense({ date: d(26), category: 'marketing', description: 'Sosyal medya reklamı', amount: 3200, allocation: 'general' }),
    createExpense({ date: d(22), category: 'other', description: 'İptal edilen peyzaj bakımı (pasif)', amount: 5400, allocation: 'equal', active: false }),
  ];

  return { rooms, reservations, expenses, prices: seedPrices(rooms, mk), settings: defaultSettings() };
}

/** Bu ay ve geçen ay için takvim fiyatları üretir; birkaç gün bilerek boş bırakılır. */
function seedPrices(rooms, monthKeyValue) {
  const prices = {};
  for (const room of rooms) {
    if (room.status === 'passive') continue;
    const roomPrices = {};
    for (const key of [shiftMonth(monthKeyValue, -1), monthKeyValue]) {
      for (const date of eachDate(monthPeriod(key))) {
        const day = Number(date.slice(-2));
        // Ayın son 4 günü bilerek boş: "Boş Günleri Vurgula" özelliği görünür olsun.
        if (key === monthKeyValue && day > 26) continue;
        const weekendUplift = isWeekend(date) ? 1.2 : 1;
        roomPrices[date] = createPriceEntry({ amount: Math.round((room.basePrice * weekendUplift) / 50) * 50 });
      }
    }
    prices[room.id] = roomPrices;
  }
  return prices;
}
