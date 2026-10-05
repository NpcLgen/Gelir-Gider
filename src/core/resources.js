/**
 * Koleksiyon tanımları — sunucu (Node) ve tarayıcı (Firebase) ortak kullanır.
 *
 * Her koleksiyon: izin anahtarı, fabrika, doğrulayıcı, denetim özeti ve sıralama.
 * Böylece CRUD davranışı hangi arka uçta çalışırsa çalışsın birebir aynıdır.
 */

import {
  createCashDay, createEmployee, createExtraWorker, createForeignWorker, createInvoice,
  createRestaurantExpense, createRestaurantIncome, createSupplier, createSupplierTxn,
  validateCashDay, validateEmployee, validateExtraWorker, validateForeignWorker, validateInvoice,
  validateRestaurantExpense, validateRestaurantIncome, validateSupplier, validateSupplierTxn,
} from './finance.js';
import { createExpense, createRoom, validateExpense, validateRoom } from './model.js';
import { createExchangeRate, sealRate, validateExchangeRate } from './rates.js';

/**
 * Döviz kaydını işlem gününün kuruyla mühürler.
 * Kullanıcı kuru elle verdiyse (fxRate) ona dokunulmaz; böylece "o günün kuru
 * yoksa kullanıcıdan iste" akışı çalışır.
 */
function applySeal(item, db, date) {
  if (!item || item.currency === 'TRY' || !item.currency) return item;
  if (Number(item.fxRate) > 0) return item;
  const sealed = sealRate(db.exchangeRates ?? [], {
    date,
    currency: item.currency,
    // Hiç kur kaydı yoksa ayarlardaki güncel kur son çare olarak kullanılmaz:
    // kullanıcıdan o günün kuru istenir (doğrulama hata verir).
    fallbackRate: 0,
  });
  return { ...item, ...sealed };
}

/**
 * Her koleksiyon: izin anahtarı, fabrika, doğrulayıcı ve denetim özeti.
 * Böylece CRUD uçları tek bir yerden türetilir.
 */
export const RESOURCES = {
  rooms: {
    permission: 'odalar', factory: createRoom,
    validate: (item, db) => validateRoom(item, { rooms: db.rooms }),
    label: 'Oda', summary: (r) => `${r.number} ${r.name}`.trim(),
    onDelete: (db, id) => {
      db.reservations = db.reservations.filter((x) => x.roomId !== id);
      delete db.prices[id];
      db.expenses = db.expenses.map((e) => (e.roomId === id
        ? { ...e, roomId: '', amenityKey: '', allocation: e.allocation === 'direct' ? 'general' : e.allocation }
        : e));
    },
    sort: (a, b) => String(a.number).localeCompare(String(b.number), 'tr', { numeric: true }),
  },
  expenses: {
    permission: 'genelHarcamalar', factory: createExpense,
    validate: (item, db) => validateExpense(item, { rooms: db.rooms }),
    label: 'Gider', summary: (e) => `${e.description} (${e.amount})`,
    sort: (a, b) => b.date.localeCompare(a.date),
  },
  employees: {
    permission: 'calisanlar', factory: createEmployee,
    validate: (item, db) => validateEmployee(item, { employees: db.employees }),
    label: 'Personel', summary: (e) => `${e.name} ${e.period}`,
    sort: (a, b) => b.period.localeCompare(a.period) || a.name.localeCompare(b.name, 'tr'),
  },
  extraWorkers: {
    permission: 'ekstraCalisan', factory: createExtraWorker,
    validate: (item) => validateExtraWorker(item),
    label: 'Ekstra çalışan', summary: (e) => `${e.name} ${e.date}`,
    sort: (a, b) => b.date.localeCompare(a.date),
  },
  suppliers: {
    permission: 'toptancilar', factory: createSupplier,
    validate: (item, db) => validateSupplier(item, { suppliers: db.suppliers }),
    label: 'Toptancı', summary: (s) => s.name,
    onDelete: (db, id) => { db.supplierTxns = db.supplierTxns.filter((t) => t.supplierId !== id); },
    sort: (a, b) => a.name.localeCompare(b.name, 'tr'),
  },
  supplierTxns: {
    permission: 'toptancilar', factory: createSupplierTxn,
    validate: (item, db) => validateSupplierTxn(item, { suppliers: db.suppliers }),
    label: 'Cari hareket', summary: (t) => `${t.type} ${t.invoiceNo || ''} ${t.amount}`,
    sort: (a, b) => b.date.localeCompare(a.date),
  },
  restaurantIncomes: {
    permission: 'restoranGelir', factory: createRestaurantIncome,
    validate: (item, db) => validateRestaurantIncome(item, { incomes: db.restaurantIncomes }),
    label: 'Restoran geliri', summary: (i) => `${i.date} ${i.sequence}. gün sonu ${i.amount}`,
    sort: (a, b) => b.date.localeCompare(a.date) || a.sequence - b.sequence,
  },
  restaurantExpenses: {
    permission: 'restoranGider', factory: createRestaurantExpense,
    validate: (item) => validateRestaurantExpense(item),
    label: 'Restoran gideri', summary: (e) => `${e.category} ${e.amount}`,
    sort: (a, b) => b.date.localeCompare(a.date),
  },
  foreignWorkers: {
    permission: 'yabanciCalisanlar', factory: createForeignWorker,
    validate: (item, db) => validateForeignWorker(item, { workers: db.foreignWorkers }),
    label: 'Yabancı çalışan', summary: (w) => `${w.name} ${w.period}`,
    sort: (a, b) => b.period.localeCompare(a.period) || a.name.localeCompare(b.name, 'tr'),
  },
  purchaseInvoices: {
    permission: 'giderFaturalari',
    seal: (item, db) => applySeal(item, db, item.date),
    factory: (patch) => createInvoice({ ...patch, direction: 'gelen' }),
    validate: (item, db) => validateInvoice(item, { invoices: db.purchaseInvoices }),
    label: 'Gider faturası', summary: (i) => `${i.invoiceNo} · ${i.customer}`,
    sort: (a, b) => b.date.localeCompare(a.date) || a.invoiceNo.localeCompare(b.invoiceNo, 'tr'),
  },
  salesInvoices: {
    permission: 'gelirler',
    seal: (item, db) => applySeal(item, db, item.date),
    factory: (patch) => createInvoice({ ...patch, direction: 'giden' }),
    validate: (item, db) => validateInvoice(item, { invoices: db.salesInvoices }),
    label: 'Gelir faturası', summary: (i) => `${i.invoiceNo} · ${i.customer}`,
    sort: (a, b) => b.date.localeCompare(a.date) || a.invoiceNo.localeCompare(b.invoiceNo, 'tr'),
  },
  exchangeRates: {
    permission: 'ayarlar', factory: createExchangeRate,
    seal: null,
    validate: (item) => validateExchangeRate(item),
    label: 'Döviz kuru',
    summary: (r) => `${r.date} · 1 ${r.currency} = ${r.rate} TRY (${r.source})`,
    sort: (a, b) => b.date.localeCompare(a.date),
  },
  cashDays: {
    permission: 'kasa', factory: createCashDay,
    validate: (item, db) => {
      const errors = validateCashDay(item);
      if (db.cashDays.some((d) => d.id !== item.id && d.date === item.date)) {
        errors.push(`${item.date} için gün sonu zaten kaydedilmiş.`);
      }
      return errors;
    },
    label: 'Gün sonu', summary: (d) => `${d.date} sayım ${d.countedCash}`,
    sort: (a, b) => b.date.localeCompare(a.date),
  },
};

export const RESOURCE_KEYS = Object.keys(RESOURCES);
