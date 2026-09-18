/**
 * Uygulama durumu: tarayıcıda localStorage'a yazan, abonelik destekli basit store.
 * Node tarafında (testlerde) bellek içi adaptörle de çalışır.
 */

import {
  createExpense,
  createReservation,
  createRoom,
  defaultSettings,
  validateExpense,
  validateReservation,
  validateRoom,
  validateSettings,
} from './model.js';
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
          settings: { ...defaultSettings(), ...(parsed.settings ?? {}) },
        };
      }
    } catch {
      /* bozuk kayıt — demoya dön */
    }
    return seed ? seedData() : { rooms: [], reservations: [], expenses: [], settings: defaultSettings() };
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
    deleteExpense(id) {
      state.expenses = state.expenses.filter((e) => e.id !== id);
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
      state = withSeed ? seedData() : { rooms: [], reservations: [], expenses: [], settings: defaultSettings() };
      persist();
    },
    exportJSON: () => JSON.stringify(state, null, 2),
    importJSON(json) {
      const parsed = JSON.parse(json);
      state = {
        rooms: (parsed.rooms ?? []).map(createRoom),
        reservations: (parsed.reservations ?? []).map(createReservation),
        expenses: (parsed.expenses ?? []).map(createExpense),
        settings: { ...defaultSettings(), ...(parsed.settings ?? {}) },
      };
      persist();
      return state;
    },
  };

  return api;
}
