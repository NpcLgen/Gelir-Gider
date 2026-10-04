/**
 * Uygulama durumu — sunucu API'si üzerinden.
 *
 * `getState()` eşzamanlı çalışır (görünümler doğrudan okur); tüm değiştirme
 * işlemleri sunucuya gider ve ardından durum yeniden yüklenir, böylece istemci
 * ile sunucu arasında sapma oluşmaz. Doğrulama hem sunucuda hem istemcide
 * aynı kurallarla yapılır; sunucu son sözü söyler.
 */

import { api, ValidationError } from './api.js';
import { defaultSettings } from './model.js';
import { defaultTaxRates } from './finance.js';

export { ValidationError };

const emptyState = () => ({
  rooms: [], reservations: [], expenses: [], prices: {},
  settings: { ...defaultSettings(), tax: defaultTaxRates(), bills: [] },
  employees: [], extraWorkers: [], suppliers: [], supplierTxns: [], cashDays: [],
  restaurantIncomes: [], restaurantExpenses: [], foreignWorkers: [],
  users: [], auditLog: [], modules: [], me: null,
});

export async function createStore() {
  let state = emptyState();
  const listeners = new Set();

  const notify = () => listeners.forEach((fn) => fn(state));

  async function reload() {
    state = { ...emptyState(), ...(await api.get('/api/state')) };
    notify();
    return state;
  }

  /** Kaydet → sunucudan tazele kalıbı. */
  const mutate = async (fn) => {
    const result = await fn();
    await reload();
    return result;
  };

  await reload();

  return {
    getState: () => state,
    reload,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /* --- Odalar --- */
    saveRoom: (patch) => mutate(() => api.post('/api/rooms', patch)),
    deleteRoom: (id) => mutate(() => api.del(`/api/rooms/${id}`)),
    toggleAmenity(roomId, amenityKey) {
      const room = state.rooms.find((r) => r.id === roomId);
      if (!room) return Promise.resolve(null);
      const amenities = room.amenities.includes(amenityKey)
        ? room.amenities.filter((k) => k !== amenityKey)
        : [...room.amenities, amenityKey];
      return mutate(() => api.post('/api/rooms', { ...room, amenities }));
    },

    /* --- Rezervasyonlar --- */
    saveReservation: (patch) => mutate(() => api.post('/api/reservations', patch)),
    deleteReservation: (id) => mutate(() => api.del(`/api/reservations/${id}`)),

    /* --- Giderler --- */
    saveExpense: (patch) => mutate(() => api.post('/api/expenses', patch)),
    deleteExpense: (id) => mutate(() => api.del(`/api/expenses/${id}`)),
    toggleExpense(id) {
      const expense = state.expenses.find((e) => e.id === id);
      if (!expense) return Promise.resolve(null);
      return mutate(() => api.post('/api/expenses', { ...expense, active: !expense.active }));
    },
    /** PRD §3.5 — dönem başında fatura kalemlerini 0 TL olarak açar. */
    ensureBills: (month) => mutate(() => api.post(`/api/periods/${month}/bills`)),

    /* --- Personel ve ekstra çalışan --- */
    saveEmployee: (patch) => mutate(() => api.post('/api/employees', patch)),
    deleteEmployee: (id) => mutate(() => api.del(`/api/employees/${id}`)),
    saveExtraWorker: (patch) => mutate(() => api.post('/api/extraWorkers', patch)),
    deleteExtraWorker: (id) => mutate(() => api.del(`/api/extraWorkers/${id}`)),

    /* --- Toptancılar --- */
    saveSupplier: (patch) => mutate(() => api.post('/api/suppliers', patch)),
    deleteSupplier: (id) => mutate(() => api.del(`/api/suppliers/${id}`)),
    saveSupplierTxn: (patch) => mutate(() => api.post('/api/supplierTxns', patch)),
    deleteSupplierTxn: (id) => mutate(() => api.del(`/api/supplierTxns/${id}`)),

    /* --- Restoran (PRD v2 §2) --- */
    saveRestaurantIncome: (patch) => mutate(() => api.post('/api/restaurantIncomes', patch)),
    deleteRestaurantIncome: (id) => mutate(() => api.del(`/api/restaurantIncomes/${id}`)),
    saveRestaurantExpense: (patch) => mutate(() => api.post('/api/restaurantExpenses', patch)),
    deleteRestaurantExpense: (id) => mutate(() => api.del(`/api/restaurantExpenses/${id}`)),

    /* --- Yabancı çalışanlar (PRD v2 §3.1) --- */
    saveForeignWorker: (patch) => mutate(() => api.post('/api/foreignWorkers', patch)),
    deleteForeignWorker: (id) => mutate(() => api.del(`/api/foreignWorkers/${id}`)),

    /* --- Kasa --- */
    saveCashDay: (patch) => mutate(() => api.post('/api/cashDays', patch)),
    deleteCashDay: (id) => mutate(() => api.del(`/api/cashDays/${id}`)),

    /* --- Fiyat takvimi --- */
    savePrice: (roomId, date, patch) => mutate(() => api.put(`/api/prices/${roomId}/${date}`, patch)),
    clearPrice: (roomId, date) => mutate(() => api.put(`/api/prices/${roomId}/${date}`, { amount: 0 })),
    bulkPriceEntries: (entries) => mutate(() => api.post('/api/prices/bulk', { entries })),

    /* --- Ayarlar --- */
    saveSettings: (patch) => mutate(() => api.put('/api/settings', patch)),
    saveTaxRates: (tax) => mutate(() => api.put('/api/settings', { tax })),
    saveBills: (bills) => mutate(() => api.put('/api/settings', { bills })),
    saveCategory(patch) {
      const list = state.settings.customCategories ?? [];
      const index = list.findIndex((c) => c.key === patch.key);
      const next = index >= 0 ? list.map((c) => (c.key === patch.key ? patch : c)) : [...list, patch];
      return mutate(() => api.put('/api/settings', { customCategories: next }));
    },
    deleteCategory(key) {
      const next = (state.settings.customCategories ?? []).filter((c) => c.key !== key);
      return mutate(() => api.put('/api/settings', { customCategories: next }));
    },
    setDisplayCurrency: (currency) => mutate(() => api.put('/api/settings', { displayCurrency: currency })),
    saveFx: (patch) => mutate(() => api.put('/api/settings', { fx: { ...state.settings.fx, ...patch } })),
    /** Kuru sunucu üzerinden kaynaktan çeker (PRD v2 §4.1). */
    refreshFx: (currency, source) => mutate(() => api.post('/api/fx/refresh', { currency, source })),
    recordRate: (date, rate) => mutate(() => api.put('/api/settings', {
      fx: {
        ...state.settings.fx, rate, updatedAt: new Date().toISOString(),
        history: { ...state.settings.fx.history, [date]: rate },
      },
    })),

    /* --- Kullanıcılar (yalnızca Admin) --- */
    saveUser: (patch) => mutate(() => api.post('/api/users', patch)),
    deleteUser: (id) => mutate(() => api.del(`/api/users/${id}`)),
    changeOwnPassword: (currentPassword, newPassword) =>
      mutate(() => api.post('/api/auth/password', { currentPassword, newPassword })),

    /** İlk kurulumda örnek veri yükler (yalnızca Admin). */
    loadDemoData: () => mutate(() => api.post('/api/demo')),

    /* --- Yedekleme --- */
    exportJSON: () => JSON.stringify(state, null, 2),
  };
}
