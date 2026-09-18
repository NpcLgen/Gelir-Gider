/**
 * Uygulama durumu: tarayıcıda localStorage'a yazan, abonelik destekli basit store.
 * Node tarafında (testlerde) bellek içi adaptörle de çalışır.
 */

import {
  createCategory,
  createExpense,
  createPriceEntry,
  createReservation,
  createRoom,
  defaultSettings,
  validateExpense,
  validatePriceEntry,
  validateReservation,
  validateRoom,
  validateSettings,
} from './model.js';
import { defaultFx } from './fx.js';
import { eachDate, isWeekend, period as makePeriod } from './dates.js';
import { seedData } from './seed.js';

const STORAGE_KEY = 'gelir-gider:v1';

const memoryAdapter = () => {
  let value = null;
  return { getItem: () => value, setItem: (_k, v) => { value = v; }, removeItem: () => { value = null; } };
};

function defaultAdapter() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('__probe__', '1');
      localStorage.removeItem('__probe__');
      return localStorage;
    }
  } catch {
    /* gizli sekme vb. — belleğe düş */
  }
  return memoryAdapter();
}

const DAY_MS = 86400000;
const shiftByDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const emptyState = () => ({ rooms: [], reservations: [], expenses: [], prices: {}, settings: defaultSettings() });

function mergeSettings(saved) {
  const base = defaultSettings();
  return {
    ...base,
    ...(saved ?? {}),
    fx: { ...defaultFx(), ...(saved?.fx ?? {}) },
  };
}

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export function createStore({ adapter = defaultAdapter(), seed = true } = {}) {
  let state = load();
  const listeners = new Set();

  function load() {
    try {
      const raw = adapter.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          rooms: (parsed.rooms ?? []).map(createRoom),
          reservations: (parsed.reservations ?? []).map(createReservation),
          expenses: (parsed.expenses ?? []).map(createExpense),
          prices: parsed.prices ?? {},
          settings: mergeSettings(parsed.settings),
        };
      }
    } catch {
      /* bozuk kayıt — demoya dön */
    }
    return seed ? seedData() : emptyState();
  }

  function persist() {
    try {
      adapter.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* kota dolu — sessizce geç */
    }
    listeners.forEach((fn) => fn(state));
  }

  const api = {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /* --- Odalar --- */
    saveRoom(patch) {
      const room = createRoom(patch);
      const errors = validateRoom(room, { rooms: state.rooms });
      if (errors.length) throw new ValidationError(errors);
      const index = state.rooms.findIndex((r) => r.id === room.id);
      state.rooms = index >= 0
        ? state.rooms.map((r) => (r.id === room.id ? room : r))
        : [...state.rooms, room];
      state.rooms.sort((a, b) => String(a.number).localeCompare(String(b.number), 'tr', { numeric: true }));
      persist();
      return room;
    },
    deleteRoom(id) {
      state.rooms = state.rooms.filter((r) => r.id !== id);
      state.reservations = state.reservations.filter((r) => r.roomId !== id);
      state.expenses = state.expenses.map((e) =>
        e.roomId === id ? { ...e, roomId: '', amenityKey: '', allocation: e.allocation === 'direct' ? 'general' : e.allocation } : e,
      );
      const { [id]: _removed, ...restPrices } = state.prices;
      state.prices = restPrices;
      persist();
    },
    /** Demirbaş kutucuğunu aç/kapat — oda kartındaki checkbox modülü bunu kullanır. */
    toggleAmenity(roomId, amenityKey) {
      const room = state.rooms.find((r) => r.id === roomId);
      if (!room) return null;
      const amenities = room.amenities.includes(amenityKey)
        ? room.amenities.filter((k) => k !== amenityKey)
        : [...room.amenities, amenityKey];
      return api.saveRoom({ ...room, amenities });
    },

    /* --- Rezervasyonlar --- */
    saveReservation(patch) {
      const reservation = createReservation(patch);
      const errors = validateReservation(reservation, {
        rooms: state.rooms,
        reservations: state.reservations,
      });
      if (errors.length) throw new ValidationError(errors);
      const index = state.reservations.findIndex((r) => r.id === reservation.id);
      state.reservations = index >= 0
        ? state.reservations.map((r) => (r.id === reservation.id ? reservation : r))
        : [...state.reservations, reservation];
      state.reservations.sort((a, b) => b.checkIn.localeCompare(a.checkIn));
      persist();
      return reservation;
    },
    deleteReservation(id) {
      state.reservations = state.reservations.filter((r) => r.id !== id);
      persist();
    },

    /* --- Giderler --- */
    saveExpense(patch) {
      const expense = createExpense(patch);
      const errors = validateExpense(expense, { rooms: state.rooms });
      if (errors.length) throw new ValidationError(errors);
      const index = state.expenses.findIndex((e) => e.id === expense.id);
      state.expenses = index >= 0
        ? state.expenses.map((e) => (e.id === expense.id ? expense : e))
        : [...state.expenses, expense];
      state.expenses.sort((a, b) => b.date.localeCompare(a.date));
      persist();
      return expense;
    },
    /** PRD §1.2 — gideri silmeden hesaplamadan çıkar/geri al. */
    toggleExpense(id) {
      state.expenses = state.expenses.map((e) => (e.id === id ? { ...e, active: !e.active } : e));
      persist();
      return state.expenses.find((e) => e.id === id);
    },
    deleteExpense(id) {
      state.expenses = state.expenses.filter((e) => e.id !== id);
      persist();
    },

    /* --- Fiyat takvimi (PRD §1.1) --- */
    savePrice(roomId, date, patch) {
      const entry = createPriceEntry(patch);
      const errors = validatePriceEntry(entry);
      if (errors.length) throw new ValidationError(errors);
      const roomPrices = { ...(state.prices[roomId] ?? {}) };
      if (entry.amount > 0) roomPrices[date] = entry;
      else delete roomPrices[date];
      state.prices = { ...state.prices, [roomId]: roomPrices };
      persist();
      return entry;
    },
    clearPrice(roomId, date) {
      const roomPrices = { ...(state.prices[roomId] ?? {}) };
      delete roomPrices[date];
      state.prices = { ...state.prices, [roomId]: roomPrices };
      persist();
    },
    /**
     * Toplu fiyat güncelleme (PRD §1.1 / §6.2).
     * Hafta içi ve hafta sonu için ayrı tutar verilebilir; `overwrite` kapalıysa
     * yalnızca boş günler doldurulur.
     */
    bulkPrice({ roomIds, from, to, weekdayAmount, weekendAmount, currency = 'TRY', overwrite = true }) {
      const errors = [];
      if (!roomIds?.length) errors.push('En az bir oda seçilmelidir.');
      if (!from || !to || from > to) errors.push('Geçerli bir tarih aralığı seçiniz.');
      if (!(weekdayAmount > 0) && !(weekendAmount > 0)) errors.push('En az bir fiyat girilmelidir.');
      if (errors.length) throw new ValidationError(errors);

      let written = 0;
      const next = { ...state.prices };
      for (const roomId of roomIds) {
        const roomPrices = { ...(next[roomId] ?? {}) };
        for (const date of eachDate(makePeriod(from, to))) {
          const amount = isWeekend(date) ? weekendAmount : weekdayAmount;
          if (!(amount > 0)) continue;
          if (!overwrite && roomPrices[date]?.amount > 0) continue;
          roomPrices[date] = createPriceEntry({ amount, currency });
          written += 1;
        }
        next[roomId] = roomPrices;
      }
      state.prices = next;
      persist();
      return written;
    },
    /** Fiyatları başka bir tarih aralığından kopyalar (PRD §6.2). */
    copyPrices({ roomIds, sourceFrom, sourceTo, targetFrom, overwrite = false }) {
      const sourceDates = eachDate(makePeriod(sourceFrom, sourceTo));
      if (!sourceDates.length) throw new ValidationError(['Kaynak aralık boş.']);
      let written = 0;
      const next = { ...state.prices };
      for (const roomId of roomIds) {
        const roomPrices = { ...(next[roomId] ?? {}) };
        sourceDates.forEach((date, index) => {
          const source = roomPrices[date];
          if (!source?.amount) return;
          const targetDate = shiftByDays(targetFrom, index);
          if (!overwrite && roomPrices[targetDate]?.amount > 0) return;
          roomPrices[targetDate] = createPriceEntry(source);
          written += 1;
        });
        next[roomId] = roomPrices;
      }
      state.prices = next;
      persist();
      return written;
    },

    /* --- Kategori yöneticisi (PRD §8.3) --- */
    saveCategory(patch) {
      const category = createCategory(patch);
      if (!category.label) throw new ValidationError(['Kategori adı zorunludur.']);
      const list = state.settings.customCategories ?? [];
      const index = list.findIndex((c) => c.key === category.key);
      const next = index >= 0 ? list.map((c) => (c.key === category.key ? category : c)) : [...list, category];
      state.settings = { ...state.settings, customCategories: next };
      persist();
      return category;
    },
    deleteCategory(key) {
      state.settings = {
        ...state.settings,
        customCategories: (state.settings.customCategories ?? []).filter((c) => c.key !== key),
      };
      persist();
    },

    /* --- Kur (PRD §2.4) --- */
    setDisplayCurrency(currency) {
      state.settings = { ...state.settings, displayCurrency: currency };
      persist();
      return currency;
    },
    saveFx(patch) {
      const fx = { ...state.settings.fx, ...patch };
      if (!(Number(fx.rate) > 0)) throw new ValidationError(['Kur 0’dan büyük olmalıdır.']);
      state.settings = { ...state.settings, fx };
      persist();
      return fx;
    },
    /** Belirli bir tarihe kur yazar (geçmiş dönem raporları doğru kalsın diye). */
    recordRate(date, rate) {
      const fx = state.settings.fx;
      state.settings = {
        ...state.settings,
        fx: { ...fx, rate, updatedAt: new Date().toISOString(), history: { ...fx.history, [date]: rate } },
      };
      persist();
    },

    /* --- Ayarlar --- */
    saveSettings(patch) {
      const settings = { ...state.settings, ...patch };
      const errors = validateSettings(settings);
      if (errors.length) throw new ValidationError(errors);
      state.settings = settings;
      persist();
      return settings;
    },

    reset({ withSeed = true } = {}) {
      adapter.removeItem(STORAGE_KEY);
      state = withSeed ? seedData() : emptyState();
      persist();
    },
    exportJSON: () => JSON.stringify(state, null, 2),
    importJSON(json) {
      const parsed = JSON.parse(json);
      state = {
        rooms: (parsed.rooms ?? []).map(createRoom),
        reservations: (parsed.reservations ?? []).map(createReservation),
        expenses: (parsed.expenses ?? []).map(createExpense),
        prices: parsed.prices ?? {},
        settings: mergeSettings(parsed.settings),
      };
      persist();
      return state;
    },
  };

  return api;
}
