/** Demo verisi — ilk açılışta boş ekran yerine gerçekçi bir işletme tablosu gösterir. */

import { createExpense, createReservation, createRoom, defaultSettings } from './model.js';

const pad = (n) => String(n).padStart(2, '0');

export function seedData(today = new Date()) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const d = (day) => `${y}-${pad(m)}-${pad(day)}`;

  const rooms = [
    createRoom({
      id: 'room_101', number: '101', name: 'King Suite', floor: 1, baseWeight: 1.4, basePrice: 6500,
      beds: [{ type: 'double', count: 1 }, { type: 'single', count: 1 }],
      maxOccupancy: 3,
      amenities: ['jacuzzi', 'fireplace', 'ac', 'smartTv', 'espresso', 'safeBox', 'balcony', 'seaView'],
      notes: 'Otelin amiral süiti. Jakuzi bakımı 3 ayda bir yapılır.',
    }),
    createRoom({
      id: 'room_102', number: '102', name: 'Bahçe Manzaralı Standart', floor: 1, baseWeight: 1, basePrice: 3200,
      beds: [{ type: 'double', count: 1 }],
      maxOccupancy: 2,
      amenities: ['ac', 'smartTv', 'kettle', 'shower', 'gardenView'],
    }),
    createRoom({
      id: 'room_103', number: '103', name: 'Aile Odası', floor: 1, baseWeight: 1.2, basePrice: 4400,
      beds: [{ type: 'double', count: 1 }, { type: 'bunk', count: 1 }],
      maxOccupancy: 4,
      amenities: ['ac', 'smartTv', 'minibar', 'shower', 'kitchenette', 'balcony'],
    }),
    createRoom({
      id: 'room_201', number: '201', name: 'Şömineli Deluxe', floor: 2, baseWeight: 1.25, basePrice: 5200,
      beds: [{ type: 'double', count: 1 }, { type: 'sofa', count: 1 }],
      maxOccupancy: 4,
      amenities: ['fireplace', 'floorHeating', 'ac', 'smartTv', 'espresso', 'towelWarmer', 'seaView'],
    }),
    createRoom({
      id: 'room_202', number: '202', name: 'Ekonomi Tek', floor: 2, baseWeight: 0.8, basePrice: 2100,
      beds: [{ type: 'single', count: 1 }],
      maxOccupancy: 1,
      amenities: ['ac', 'smartTv', 'shower'],
    }),
    createRoom({
      id: 'room_203', number: '203', name: 'Sauna Suit', floor: 2, baseWeight: 1.3, basePrice: 5900,
      beds: [{ type: 'double', count: 1 }],
      maxOccupancy: 2, status: 'maintenance',
      amenities: ['sauna', 'jacuzzi', 'ac', 'smartTv', 'minibar', 'waterHeater'],
      notes: 'Sauna rezistansı değişimi bekleniyor.',
    }),
  ];

  const reservations = [
    createReservation({ roomId: 'room_101', guestName: 'Yılmaz Ailesi', guests: 3, checkIn: d(2), checkOut: d(6), totalAmount: 26000, channel: 'direct' }),
    createReservation({ roomId: 'room_101', guestName: 'K. Demir', guests: 2, checkIn: d(12), checkOut: d(15), totalAmount: 19500, channel: 'booking' }),
    createReservation({ roomId: 'room_102', guestName: 'A. Çelik', guests: 2, checkIn: d(3), checkOut: d(9), totalAmount: 19200, channel: 'booking' }),
    createReservation({ roomId: 'room_102', guestName: 'S. Korkmaz', guests: 1, checkIn: d(14), checkOut: d(17), totalAmount: 8700, channel: 'direct', breakfastIncluded: false }),
    createReservation({ roomId: 'room_103', guestName: 'Aydın Ailesi', guests: 4, checkIn: d(5), checkOut: d(12), totalAmount: 30800, channel: 'direct' }),
    createReservation({ roomId: 'room_201', guestName: 'M. Şahin', guests: 2, checkIn: d(8), checkOut: d(11), totalAmount: 15600, channel: 'airbnb' }),
    createReservation({ roomId: 'room_201', guestName: 'Kaya & Ekibi', guests: 4, checkIn: d(18), checkOut: d(21), totalAmount: 17400, channel: 'direct' }),
    createReservation({ roomId: 'room_202', guestName: 'E. Güneş', guests: 1, checkIn: d(4), checkOut: d(10), totalAmount: 12600, channel: 'direct' }),
    createReservation({ roomId: 'room_101', guestName: 'Öztürk Ailesi', guests: 3, checkIn: d(19), checkOut: d(25), totalAmount: 39000, channel: 'direct' }),
    createReservation({ roomId: 'room_102', guestName: 'B. Aslan', guests: 2, checkIn: d(19), checkOut: d(26), totalAmount: 22400, channel: 'airbnb' }),
    createReservation({ roomId: 'room_103', guestName: 'Doğan Ailesi', guests: 4, checkIn: d(14), checkOut: d(20), totalAmount: 26400, channel: 'booking' }),
    createReservation({ roomId: 'room_103', guestName: 'N. Polat', guests: 2, checkIn: d(22), checkOut: d(27), totalAmount: 21000, channel: 'direct' }),
    createReservation({ roomId: 'room_201', guestName: 'H. Erdem', guests: 2, checkIn: d(12), checkOut: d(16), totalAmount: 20800, channel: 'booking' }),
    createReservation({ roomId: 'room_202', guestName: 'T. Yalçın', guests: 1, checkIn: d(16), checkOut: d(23), totalAmount: 14700, channel: 'booking' }),
    createReservation({ roomId: 'room_202', guestName: 'C. Arslan', guests: 1, checkIn: d(24), checkOut: d(28), totalAmount: 8400, channel: 'direct' }),
  ];

  const expenses = [
    createExpense({ date: d(1), category: 'utility_electricity', description: 'Elektrik faturası (aylık)', amount: 18400, allocation: 'weighted', weightKind: 'electricity', vendor: 'Enerjisa' }),
    createExpense({ date: d(1), category: 'utility_water', description: 'Su faturası (aylık)', amount: 5200, allocation: 'weighted', weightKind: 'water', vendor: 'İSKİ' }),
    createExpense({ date: d(1), category: 'utility_gas', description: 'Doğalgaz', amount: 7300, allocation: 'weighted', weightKind: 'heating', vendor: 'İGDAŞ' }),
    createExpense({ date: d(7), category: 'maintenance', description: 'Jakuzi motor arızası - işçilik + parça', amount: 4750, allocation: 'direct', roomId: 'room_101', amenityKey: 'jacuzzi', vendor: 'Aqua Servis' }),
    createExpense({ date: d(9), category: 'maintenance', description: 'Klima gaz dolumu', amount: 1450, allocation: 'direct', roomId: 'room_103', amenityKey: 'ac', vendor: 'İklim Teknik' }),
    createExpense({ date: d(11), category: 'furnishing', description: 'Espresso makinesi değişimi', amount: 8900, allocation: 'direct', roomId: 'room_201', amenityKey: 'espresso', vendor: 'Kahve Dünyası' }),
    createExpense({ date: d(6), category: 'housekeeping', description: 'Temizlik kimyasalları', amount: 3100, allocation: 'perGuest', vendor: 'Hijyen A.Ş.' }),
    createExpense({ date: d(13), category: 'food', description: 'Kahvaltı market alışverişi', amount: 9600, allocation: 'perGuest', vendor: 'Toptancı' }),
    createExpense({ date: d(2), category: 'staff', description: 'Kat hizmetleri personeli', amount: 34000, allocation: 'equal' }),
    createExpense({ date: d(1), category: 'rent', description: 'Bina kirası', amount: 45000, allocation: 'equal' }),
    createExpense({ date: d(15), category: 'marketing', description: 'OTA komisyonları', amount: 6800, allocation: 'general' }),
    createExpense({ date: d(20), category: 'tax', description: 'Muhasebe & vergi', amount: 9500, allocation: 'general' }),
  ];

  return { rooms, reservations, expenses, settings: defaultSettings() };
}
