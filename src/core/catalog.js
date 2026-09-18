/**
 * Sistem sözlükleri: yatak tipleri, demirbaş/özellik kataloğu ve gider kategorileri.
 *
 * Demirbaş katsayıları (`load`) genel gider dağıtımında kullanılır:
 * bir odanın elektrik/su/ısıtma ağırlığı `1 + seçili demirbaşların katsayı toplamı`
 * şeklinde hesaplanır. Katsayılar "temel bir odaya kıyasla ek tüketim oranı"dır;
 * örn. jakuzili bir oda elektrikte %45, suda %60 daha fazla pay alır.
 */

export const CURRENCIES = [
  { key: 'TRY', label: 'Türk Lirası', symbol: '₺' },
  { key: 'EUR', label: 'Euro', symbol: '€' },
];
export const BASE_CURRENCY = 'TRY';
export const CURRENCY_KEYS = CURRENCIES.map((c) => c.key);

/** PRD §2.2 — gider ana grupları (raporlama ve filtreleme bu gruplara göre yapılır). */
export const EXPENSE_GROUPS = [
  { key: 'fixed', label: 'Sabit Giderler', color: '#3987e5', hint: 'Kira, maaş, muhasebe, sigorta' },
  { key: 'variable', label: 'Değişken Giderler', color: '#d95926', hint: 'Elektrik, su, doğalgaz, çamaşırhane' },
  { key: 'operational', label: 'Operasyonel / Oda Giderleri', color: '#199e70', hint: 'Buklet, temizlik ürünleri, bakım' },
  { key: 'marketing', label: 'Pazarlama & Komisyon', color: '#c98500', hint: 'Acenta komisyonları, reklam' },
];
export const EXPENSE_GROUP_MAP = Object.fromEntries(EXPENSE_GROUPS.map((g) => [g.key, g]));

/** PRD §8.1 — genel gider dağıtım yöntemi (Seçenek A / B / C). */
export const ALLOCATION_METHODS = [
  { key: 'equal', label: 'A · Eşit Dağıtım', hint: 'Toplam genel gider / oda sayısı' },
  { key: 'area', label: 'B · Metrekare Bazlı', hint: 'Odaların m² büyüklüklerine göre ağırlıklı' },
  { key: 'coefficient', label: 'C · Özel Katsayı', hint: 'Oda çarpanı × demirbaş katsayısı (jakuzi, klima…)' },
];

export const FX_SOURCES = [
  { key: 'manual', label: 'Sabit Kur (manuel)' },
  { key: 'tcmb', label: 'TCMB Efektif Satış' },
  { key: 'tcmb_buy', label: 'TCMB Döviz Alış' },
];

export const UTILITY_KINDS = ['electricity', 'water', 'heating'];

export const UTILITY_LABELS = {
  electricity: 'Elektrik',
  water: 'Su',
  heating: 'Isıtma / Doğalgaz',
};

/** Yatak tipleri. `sleeps` = o yatağın taşıdığı kişi kapasitesi. */
export const BED_TYPES = [
  { key: 'double', label: 'Çift Kişilik Yatak', sleeps: 2, icon: '🛏️' },
  { key: 'single', label: 'Tek Kişilik Yatak', sleeps: 1, icon: '🛏️' },
  { key: 'bunk', label: 'Ranza', sleeps: 2, icon: '🪜' },
  { key: 'sofa', label: 'Çekyat', sleeps: 2, icon: '🛋️' },
  { key: 'extra', label: 'İlave Yatak', sleeps: 1, icon: '➕' },
  { key: 'baby', label: 'Bebek Karyolası', sleeps: 0, icon: '🍼' },
];

export const BED_TYPE_MAP = Object.fromEntries(BED_TYPES.map((b) => [b.key, b]));

/**
 * Demirbaş & özellik kataloğu.
 * - `load`     : genel gider dağıtım katsayıları (elektrik / su / ısıtma)
 * - `service`  : true ise bakım/arıza gideri bu demirbaşa doğrudan yazılabilir
 * - `group`    : arayüzdeki gruplama başlığı
 */
export const AMENITIES = [
  // --- Isıtma / Soğutma ---
  { key: 'ac', label: 'Klima', icon: '❄️', group: 'Isıtma & Soğutma', service: true,
    load: { electricity: 0.35, water: 0, heating: 0 } },
  { key: 'fireplace', label: 'Şömine', icon: '🔥', group: 'Isıtma & Soğutma', service: true,
    load: { electricity: 0.02, water: 0, heating: 0.40 } },
  { key: 'floorHeating', label: 'Yerden Isıtma', icon: '🌡️', group: 'Isıtma & Soğutma', service: true,
    load: { electricity: 0.05, water: 0, heating: 0.35 } },
  { key: 'towelWarmer', label: 'Havlupan', icon: '🧣', group: 'Isıtma & Soğutma', service: true,
    load: { electricity: 0.06, water: 0, heating: 0.08 } },

  // --- Islak Hacim ---
  { key: 'jacuzzi', label: 'Jakuzi', icon: '🛁', group: 'Islak Hacim', service: true,
    load: { electricity: 0.45, water: 0.60, heating: 0.15 } },
  { key: 'sauna', label: 'Sauna', icon: '🧖', group: 'Islak Hacim', service: true,
    load: { electricity: 0.50, water: 0.10, heating: 0.20 } },
  { key: 'shower', label: 'Duş Kabini', icon: '🚿', group: 'Islak Hacim', service: true,
    load: { electricity: 0, water: 0.15, heating: 0.05 } },
  { key: 'waterHeater', label: 'Şofben / Termosifon', icon: '♨️', group: 'Islak Hacim', service: true,
    load: { electricity: 0.25, water: 0.05, heating: 0.10 } },

  // --- Mutfak & Minibar ---
  { key: 'minibar', label: 'Minibar', icon: '🧊', group: 'Mutfak & Minibar', service: true,
    load: { electricity: 0.15, water: 0, heating: 0 } },
  { key: 'espresso', label: 'Espresso Makinesi', icon: '☕', group: 'Mutfak & Minibar', service: true,
    load: { electricity: 0.10, water: 0.03, heating: 0 } },
  { key: 'kettle', label: 'Su Isıtıcı (Kettle)', icon: '🫖', group: 'Mutfak & Minibar', service: true,
    load: { electricity: 0.05, water: 0.02, heating: 0 } },
  { key: 'kitchenette', label: 'Mini Mutfak', icon: '🍳', group: 'Mutfak & Minibar', service: true,
    load: { electricity: 0.18, water: 0.12, heating: 0 } },

  // --- Elektronik ---
  { key: 'smartTv', label: 'Smart TV', icon: '📺', group: 'Elektronik', service: true,
    load: { electricity: 0.08, water: 0, heating: 0 } },
  { key: 'soundSystem', label: 'Ses Sistemi', icon: '🔊', group: 'Elektronik', service: true,
    load: { electricity: 0.06, water: 0, heating: 0 } },
  { key: 'hairDryer', label: 'Saç Kurutma Makinesi', icon: '💨', group: 'Elektronik', service: true,
    load: { electricity: 0.03, water: 0, heating: 0 } },
  { key: 'safeBox', label: 'Elektronik Kasa', icon: '🔐', group: 'Elektronik', service: true,
    load: { electricity: 0.02, water: 0, heating: 0 } },

  // --- Konfor & Manzara (tüketime etkisi yok, fiyatlamaya etkisi var) ---
  { key: 'balcony', label: 'Balkon', icon: '🌅', group: 'Konfor & Manzara', service: false,
    load: { electricity: 0, water: 0, heating: 0 } },
  { key: 'seaView', label: 'Deniz Manzarası', icon: '🌊', group: 'Konfor & Manzara', service: false,
    load: { electricity: 0, water: 0, heating: 0 } },
  { key: 'gardenView', label: 'Bahçe Manzarası', icon: '🌳', group: 'Konfor & Manzara', service: false,
    load: { electricity: 0, water: 0, heating: 0 } },
  { key: 'workDesk', label: 'Çalışma Masası', icon: '🪑', group: 'Konfor & Manzara', service: false,
    load: { electricity: 0.01, water: 0, heating: 0 } },
];

export const AMENITY_MAP = Object.fromEntries(AMENITIES.map((a) => [a.key, a]));

export const AMENITY_GROUPS = AMENITIES.reduce((acc, a) => {
  (acc[a.group] ||= []).push(a);
  return acc;
}, {});

export const ROOM_STATUSES = [
  { key: 'active', label: 'Satışta' },
  { key: 'maintenance', label: 'Bakımda' },
  { key: 'passive', label: 'Pasif' },
];

/**
 * Gider dağıtım yöntemleri.
 * - direct    : doğrudan tek odaya (ör. jakuzi motor arızası → 101)
 * - perGuest  : konaklayan kişi-gece sayısına göre (kahvaltı, su, buklet...)
 * - weighted  : demirbaş katsayılarına göre ağırlıklı (elektrik, su, ısıtma)
 * - equal     : satıştaki odalara eşit
 * - general   : işletme geneli, odaya dağıtılmaz
 */
export const ALLOCATIONS = [
  { key: 'direct', label: 'Doğrudan Odaya', needsRoom: true },
  { key: 'perGuest', label: 'Kişi Başı (Kişi-Gece)', needsRoom: false },
  { key: 'weighted', label: 'Demirbaş Katsayılı Dağıtım', needsRoom: false, needsKind: true },
  { key: 'equal', label: 'Odalara Eşit Dağıtım', needsRoom: false },
  { key: 'general', label: 'İşletme Geneli (Dağıtılmaz)', needsRoom: false },
];

export const ALLOCATION_MAP = Object.fromEntries(ALLOCATIONS.map((a) => [a.key, a]));

/** Gider kategorileri; `defaults` yeni gider formunu ön-doldurur, `group` raporlamayı belirler. */
export const EXPENSE_CATEGORIES = [
  { key: 'utility_electricity', label: 'Elektrik Faturası', group: 'variable', defaults: { allocation: 'weighted', weightKind: 'electricity' } },
  { key: 'utility_water', label: 'Su Faturası', group: 'variable', defaults: { allocation: 'weighted', weightKind: 'water' } },
  { key: 'utility_gas', label: 'Doğalgaz / Yakıt', group: 'variable', defaults: { allocation: 'weighted', weightKind: 'heating' } },
  { key: 'laundry', label: 'Çamaşırhane', group: 'variable', defaults: { allocation: 'perGuest' } },
  { key: 'internet', label: 'İnternet / Yazılım Aboneliği', group: 'fixed', defaults: { allocation: 'equal' } },
  { key: 'maintenance', label: 'Bakım / Onarım (Demirbaş)', group: 'operational', defaults: { allocation: 'direct' } },
  { key: 'housekeeping', label: 'Temizlik & Sarf Malzeme', group: 'operational', defaults: { allocation: 'perGuest' } },
  { key: 'food', label: 'Gıda / Kahvaltı Alımı', group: 'operational', defaults: { allocation: 'perGuest' } },
  { key: 'amenityKit', label: 'Buklet / Misafir Seti', group: 'operational', defaults: { allocation: 'perGuest' } },
  { key: 'furnishing', label: 'Demirbaş Alımı', group: 'operational', defaults: { allocation: 'direct' } },
  { key: 'writeOff', label: 'Zayi / Amortisman', group: 'operational', defaults: { allocation: 'direct' } },
  { key: 'staff', label: 'Personel Maaşı', group: 'fixed', defaults: { allocation: 'equal' } },
  { key: 'rent', label: 'Kira', group: 'fixed', defaults: { allocation: 'equal' } },
  { key: 'accounting', label: 'Muhasebe / Sigorta', group: 'fixed', defaults: { allocation: 'equal' } },
  { key: 'commission', label: 'Acenta Komisyonu', group: 'marketing', defaults: { allocation: 'general' } },
  { key: 'marketing', label: 'Pazarlama / Reklam', group: 'marketing', defaults: { allocation: 'general' } },
  { key: 'tax', label: 'Vergi / Resmi Ödemeler', group: 'fixed', defaults: { allocation: 'general' } },
  { key: 'other', label: 'Diğer', group: 'variable', defaults: { allocation: 'general' } },
];

export const EXPENSE_CATEGORY_MAP = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, c]));

/** Kişi başı sarfiyat tarifesi kalemlerinin hesap tabanları. */
export const TARIFF_BASIS = [
  { key: 'guestNight', label: 'Kişi × Gece' },
  { key: 'guestStay', label: 'Kişi × Konaklama' },
  { key: 'stay', label: 'Konaklama Başına' },
];

/** Zayi/amortisman kalemleri net kârdan ayrıca raporlanır (PRD §3.2). */
export const WRITE_OFF_CATEGORIES = ['writeOff'];

/** PRD §7.1 — hızlı tarih seçici butonları. */
export const QUICK_RANGES = [
  { key: 'thisMonth', label: 'Bu Ay' },
  { key: 'lastMonth', label: 'Geçen Ay' },
  { key: 'thisQuarter', label: 'Bu Çeyrek' },
  { key: 'ytd', label: 'YTD' },
  { key: 'sameMonthLastYear', label: 'Geçen Yılın Aynı Ayı' },
];
