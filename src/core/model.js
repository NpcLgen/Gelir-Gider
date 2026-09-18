/**
 * Veri modeli, fabrika fonksiyonları ve doğrulama kuralları.
 * Bu dosya tarayıcıdan da Node testlerinden de aynen kullanılır (bağımlılıksız ESM).
 */

import {
  AMENITY_MAP,
  ALLOCATION_MAP,
  BED_TYPE_MAP,
  EXPENSE_CATEGORY_MAP,
  ROOM_STATUSES,
  TARIFF_BASIS,
  UTILITY_KINDS,
} from './catalog.js';
import { isValidDate, nightsBetween } from './dates.js';

const STATUS_KEYS = ROOM_STATUSES.map((s) => s.key);
const BASIS_KEYS = TARIFF_BASIS.map((b) => b.key);

export function uid(prefix = 'id') {
  const rnd =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `${prefix}_${rnd}`;
}

const num = (value, fallback = 0) => {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/* ------------------------------------------------------------------ Oda -- */

export function createRoom(patch = {}) {
  return {
    id: patch.id || uid('room'),
    number: String(patch.number ?? '').trim(),
    name: String(patch.name ?? '').trim(),
    floor: num(patch.floor, 0),
    status: STATUS_KEYS.includes(patch.status) ? patch.status : 'active',
    beds: normalizeBeds(patch.beds),
    maxOccupancy: num(patch.maxOccupancy, 0),
    amenities: normalizeAmenities(patch.amenities),
    baseWeight: patch.baseWeight == null ? 1 : num(patch.baseWeight, 1),
    basePrice: num(patch.basePrice, 0),
    notes: String(patch.notes ?? ''),
  };
}

export function normalizeBeds(beds) {
  if (!Array.isArray(beds)) return [];
  return beds
    .map((b) => ({ type: b?.type, count: Math.max(0, Math.round(num(b?.count, 0))) }))
    .filter((b) => BED_TYPE_MAP[b.type] && b.count > 0);
}

export function normalizeAmenities(amenities) {
  if (!Array.isArray(amenities)) return [];
  return [...new Set(amenities.filter((key) => AMENITY_MAP[key]))];
}

/** Yatak düzeninin taşıdığı toplam kişi kapasitesi. */
export function bedCapacity(room) {
  return normalizeBeds(room?.beds).reduce(
    (total, bed) => total + BED_TYPE_MAP[bed.type].sleeps * bed.count,
    0,
  );
}

/** Kapasite açılır menüsünde sunulacak seçenekler (1..yatak kapasitesi). */
export function maxOccupancyOptions(room) {
  const capacity = bedCapacity(room);
  return Array.from({ length: capacity }, (_, i) => i + 1);
}

export function bedSummary(room) {
  const beds = normalizeBeds(room?.beds);
  if (!beds.length) return 'Yatak tanımlı değil';
  return beds.map((b) => `${b.count} ${BED_TYPE_MAP[b.type].label}`).join(' + ');
}

export function roomLabel(room) {
  if (!room) return '—';
  return room.name ? `${room.number} - ${room.name}` : String(room.number);
}

/** Odanın bir gider türü için demirbaş yükü katsayısı: 1 + Σ seçili demirbaş katsayıları. */
export function amenityLoad(room, kind) {
  if (!UTILITY_KINDS.includes(kind)) return 1;
  return normalizeAmenities(room?.amenities).reduce(
    (total, key) => total + (AMENITY_MAP[key].load[kind] || 0),
    1,
  );
}

/** Bakım/arıza gideri yazılabilecek demirbaşlar (odada seçili ve servis edilebilir olanlar). */
export function serviceableAmenities(room) {
  return normalizeAmenities(room?.amenities)
    .map((key) => AMENITY_MAP[key])
    .filter((a) => a.service);
}

export function validateRoom(room, { rooms = [] } = {}) {
  const errors = [];
  const number = String(room.number ?? '').trim();
  if (!number) errors.push('Oda numarası zorunludur.');
  if (number && rooms.some((r) => r.id !== room.id && String(r.number).trim() === number)) {
    errors.push(`"${number}" numaralı oda zaten tanımlı.`);
  }
  const beds = normalizeBeds(room.beds);
  if (!beds.length) errors.push('En az bir yatak tipi seçilmelidir.');
  const capacity = bedCapacity(room);
  const max = num(room.maxOccupancy, 0);
  if (!Number.isInteger(max) || max < 1) {
    errors.push('Maksimum kişi sayısı seçilmelidir.');
  } else if (capacity && max > capacity) {
    errors.push(
      `Maksimum kişi sayısı (${max}), yatak kapasitesini (${capacity}) aşamaz. Önce yatak ekleyin.`,
    );
  }
  if (num(room.baseWeight, 1) <= 0) errors.push('Oda büyüklük katsayısı 0’dan büyük olmalıdır.');
  if (num(room.basePrice, 0) < 0) errors.push('Liste fiyatı negatif olamaz.');
  return errors;
}

/* ---------------------------------------------------------- Rezervasyon -- */

export function createReservation(patch = {}) {
  return {
    id: patch.id || uid('res'),
    roomId: patch.roomId || '',
    guestName: String(patch.guestName ?? '').trim(),
    guests: Math.round(num(patch.guests, 1)),
    checkIn: patch.checkIn || '',
    checkOut: patch.checkOut || '',
    totalAmount: num(patch.totalAmount, 0),
    channel: patch.channel || 'direct',
    breakfastIncluded: patch.breakfastIncluded !== false,
    status: patch.status === 'cancelled' ? 'cancelled' : 'confirmed',
    notes: String(patch.notes ?? ''),
  };
}

export function reservationNights(reservation) {
  if (!isValidDate(reservation?.checkIn) || !isValidDate(reservation?.checkOut)) return 0;
  return nightsBetween(reservation.checkIn, reservation.checkOut);
}

export function reservationGuestNights(reservation) {
  return reservationNights(reservation) * Math.max(0, Math.round(num(reservation?.guests, 0)));
}

export function reservationsOverlap(a, b) {
  return a.checkIn < b.checkOut && b.checkIn < a.checkOut;
}

export function validateReservation(reservation, { rooms = [], reservations = [] } = {}) {
  const errors = [];
  const room = rooms.find((r) => r.id === reservation.roomId);
  if (!room) errors.push('Oda seçilmelidir.');
  if (!String(reservation.guestName ?? '').trim()) errors.push('Misafir adı zorunludur.');
  if (!isValidDate(reservation.checkIn)) errors.push('Geçerli bir giriş tarihi giriniz.');
  if (!isValidDate(reservation.checkOut)) errors.push('Geçerli bir çıkış tarihi giriniz.');
  if (isValidDate(reservation.checkIn) && isValidDate(reservation.checkOut)) {
    if (nightsBetween(reservation.checkIn, reservation.checkOut) < 1) {
      errors.push('Çıkış tarihi, giriş tarihinden sonra olmalıdır.');
    }
  }

  const guests = num(reservation.guests, 0);
  if (!Number.isInteger(guests) || guests < 1) {
    errors.push('Konaklayan kişi sayısı en az 1 olmalıdır.');
  } else if (room && guests > room.maxOccupancy) {
    // Oda kartındaki kapasite, rezervasyonun üst sınırıdır.
    errors.push(
      `${roomLabel(room)} odasının kapasitesi ${room.maxOccupancy} kişidir; ${guests} kişi kabul edilemez.`,
    );
  }

  if (room && room.status !== 'active' && reservation.status !== 'cancelled') {
    errors.push(`${roomLabel(room)} odası satışta değil (${room.status}).`);
  }
  if (num(reservation.totalAmount, 0) < 0) errors.push('Konaklama tutarı negatif olamaz.');

  if (room && reservation.status !== 'cancelled' && isValidDate(reservation.checkIn) && isValidDate(reservation.checkOut)) {
    const clash = reservations.find(
      (r) =>
        r.id !== reservation.id &&
        r.roomId === reservation.roomId &&
        r.status !== 'cancelled' &&
        reservationsOverlap(r, reservation),
    );
    if (clash) {
      errors.push(`Bu tarihlerde oda dolu: ${clash.guestName} (${clash.checkIn} → ${clash.checkOut}).`);
    }
  }
  return errors;
}

/* ----------------------------------------------------------------- Gider -- */

export function createExpense(patch = {}) {
  const category = EXPENSE_CATEGORY_MAP[patch.category] ? patch.category : 'other';
  const defaults = EXPENSE_CATEGORY_MAP[category].defaults;
  return {
    id: patch.id || uid('exp'),
    date: patch.date || '',
    category,
    description: String(patch.description ?? '').trim(),
    amount: num(patch.amount, 0),
    allocation: ALLOCATION_MAP[patch.allocation] ? patch.allocation : defaults.allocation,
    weightKind: UTILITY_KINDS.includes(patch.weightKind)
      ? patch.weightKind
      : defaults.weightKind || 'electricity',
    roomId: patch.roomId || '',
    amenityKey: AMENITY_MAP[patch.amenityKey] ? patch.amenityKey : '',
    vendor: String(patch.vendor ?? '').trim(),
  };
}

export function validateExpense(expense, { rooms = [] } = {}) {
  const errors = [];
  if (!isValidDate(expense.date)) errors.push('Geçerli bir gider tarihi giriniz.');
  if (!String(expense.description ?? '').trim()) errors.push('Gider açıklaması zorunludur.');
  if (num(expense.amount, 0) <= 0) errors.push('Tutar 0’dan büyük olmalıdır.');
  const allocation = ALLOCATION_MAP[expense.allocation];
  if (!allocation) {
    errors.push('Geçersiz dağıtım yöntemi.');
    return errors;
  }
  if (allocation.needsRoom) {
    const room = rooms.find((r) => r.id === expense.roomId);
    if (!room) {
      errors.push('Doğrudan gider için oda seçilmelidir.');
    } else if (expense.amenityKey) {
      if (!normalizeAmenities(room.amenities).includes(expense.amenityKey)) {
        errors.push(
          `"${AMENITY_MAP[expense.amenityKey]?.label ?? expense.amenityKey}" bu odanın demirbaş listesinde yok.`,
        );
      }
    }
  }
  if (allocation.needsKind && !UTILITY_KINDS.includes(expense.weightKind)) {
    errors.push('Dağıtım için gider türü (elektrik/su/ısıtma) seçilmelidir.');
  }
  return errors;
}

/* -------------------------------------------------------------- Ayarlar -- */

export function createTariffItem(patch = {}) {
  return {
    key: patch.key || uid('tar'),
    label: String(patch.label ?? '').trim(),
    amount: num(patch.amount, 0),
    basis: BASIS_KEYS.includes(patch.basis) ? patch.basis : 'guestNight',
    requiresBreakfast: Boolean(patch.requiresBreakfast),
    active: patch.active !== false,
  };
}

export function defaultSettings() {
  return {
    currency: 'TRY',
    /** Boş odaların genel giderden aldığı sabit pay oranı (0..1). */
    fixedShare: 0.25,
    /** Kişi başı sarfiyat tarifesi — "Cost Per Guest" algoritmasının girdisi. */
    perGuestTariff: [
      createTariffItem({ key: 'breakfast', label: 'Kahvaltı', amount: 145, basis: 'guestNight', requiresBreakfast: true }),
      createTariffItem({ key: 'water', label: 'Su & İkramlık', amount: 18, basis: 'guestNight' }),
      createTariffItem({ key: 'amenityKit', label: 'Buklet Seti', amount: 22, basis: 'guestNight' }),
      createTariffItem({ key: 'linen', label: 'Nevresim / Çamaşır', amount: 35, basis: 'guestStay' }),
      createTariffItem({ key: 'cleaning', label: 'Çıkış Temizliği', amount: 90, basis: 'stay' }),
    ],
  };
}

export function validateSettings(settings) {
  const errors = [];
  const share = num(settings.fixedShare, -1);
  if (share < 0 || share > 1) errors.push('Sabit pay oranı 0 ile 1 arasında olmalıdır.');
  for (const item of settings.perGuestTariff ?? []) {
    if (!String(item.label ?? '').trim()) errors.push('Tarife kaleminin adı boş olamaz.');
    if (num(item.amount, -1) < 0) errors.push(`"${item.label}" tutarı negatif olamaz.`);
    if (!BASIS_KEYS.includes(item.basis)) errors.push(`"${item.label}" için geçersiz hesap tabanı.`);
  }
  return errors;
}
