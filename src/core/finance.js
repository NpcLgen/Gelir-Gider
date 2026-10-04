/**
 * PRD §3 (personel, ekstra çalışan), §4 (toptancı cari) ve §5 (vergi, kasa)
 * varlıkları: fabrikalar, doğrulama ve hesaplamalar.
 * Sunucu ve tarayıcı aynı kuralları kullanır.
 */

import { isValidDate, monthKey } from './dates.js';

const num = (value, fallback = 0) => {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const text = (value) => String(value ?? '').trim();
const isValidMonth = (value) => typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);

export function uid(prefix = 'id') {
  const rnd = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(16).slice(2, 10);
  return `${prefix}_${rnd}`;
}

/* ------------------------------------------- §3.2 Çalışanlar (sabit personel) -- */

export function createEmployee(patch = {}) {
  return {
    id: patch.id || uid('emp'),
    name: text(patch.name),
    role: text(patch.role),
    /** Dönem: 'YYYY-MM'. Her ay ayrı kayıt tutulur (PRD §3.5 dönemsellik). */
    period: isValidMonth(patch.period) ? patch.period : '',
    netSalary: num(patch.netSalary, 0),
    sgk: num(patch.sgk, 0),
    active: patch.active !== false,
    /** Her ay otomatik oluşsun mu (tekrarlayan personel gideri). */
    recurring: patch.recurring !== false,
    note: text(patch.note),
  };
}

export function validateEmployee(employee, { employees = [] } = {}) {
  const errors = [];
  if (!text(employee.name)) errors.push('Personel adı zorunludur.');
  if (!isValidMonth(employee.period)) errors.push('Geçerli bir dönem (ay) seçilmelidir.');
  if (num(employee.netSalary, -1) < 0) errors.push('Net maaş negatif olamaz.');
  if (num(employee.sgk, -1) < 0) errors.push('SGK tutarı negatif olamaz.');
  const clash = employees.find((e) => e.id !== employee.id
    && e.period === employee.period
    && text(e.name).toLocaleLowerCase('tr') === text(employee.name).toLocaleLowerCase('tr'));
  if (clash) errors.push(`${employee.name} için ${employee.period} dönemi zaten kayıtlı.`);
  return errors;
}

export const employeeTotal = (employee) => round2(num(employee.netSalary) + num(employee.sgk));

/* -------------------------------------------------- §3.3 Ekstra çalışan -- */

export function createExtraWorker(patch = {}) {
  return {
    id: patch.id || uid('ext'),
    name: text(patch.name),
    date: patch.date || '',
    amount: num(patch.amount, 0),
    note: text(patch.note),
    active: patch.active !== false,
  };
}

export function validateExtraWorker(worker) {
  const errors = [];
  if (!text(worker.name)) errors.push('Çalışan adı / açıklama zorunludur.');
  if (!isValidDate(worker.date)) errors.push('Geçerli bir çalışma tarihi giriniz.');
  if (num(worker.amount, 0) <= 0) errors.push('Yevmiye / ödeme tutarı 0’dan büyük olmalıdır.');
  return errors;
}

/* ------------------------------------------------------ §4.2 Toptancılar -- */

export function createSupplier(patch = {}) {
  return {
    id: patch.id || uid('sup'),
    name: text(patch.name),
    phone: text(patch.phone),
    taxNumber: text(patch.taxNumber),
    category: text(patch.category) || 'Gıda',
    active: patch.active !== false,
    note: text(patch.note),
  };
}

export function validateSupplier(supplier, { suppliers = [] } = {}) {
  const errors = [];
  if (!text(supplier.name)) errors.push('Toptancı adı zorunludur.');
  const clash = suppliers.find((s) => s.id !== supplier.id
    && text(s.name).toLocaleLowerCase('tr') === text(supplier.name).toLocaleLowerCase('tr'));
  if (clash) errors.push(`"${supplier.name}" adlı toptancı zaten kayıtlı.`);
  return errors;
}

export const SUPPLIER_TXN_TYPES = [
  { key: 'invoice', label: 'Fatura (borç)', sign: 1 },
  { key: 'payment', label: 'Ödeme (tahsilat)', sign: -1 },
];

export function createSupplierTxn(patch = {}) {
  const type = patch.type === 'payment' ? 'payment' : 'invoice';
  return {
    id: patch.id || uid('stx'),
    supplierId: patch.supplierId || '',
    type,
    date: patch.date || '',
    amount: num(patch.amount, 0),
    invoiceNo: text(patch.invoiceNo),
    /** Gider KDV'si — vergi raporunda indirilecek KDV olarak kullanılır. */
    kdvRate: num(patch.kdvRate, 20),
    note: text(patch.note),
    active: patch.active !== false,
  };
}

export function validateSupplierTxn(txn, { suppliers = [] } = {}) {
  const errors = [];
  if (!suppliers.some((s) => s.id === txn.supplierId)) errors.push('Toptancı seçilmelidir.');
  if (!isValidDate(txn.date)) errors.push('Geçerli bir işlem tarihi giriniz.');
  if (num(txn.amount, 0) <= 0) errors.push('Tutar 0’dan büyük olmalıdır.');
  if (txn.type === 'invoice' && !text(txn.invoiceNo)) errors.push('Fatura numarası zorunludur.');
  if (num(txn.kdvRate, -1) < 0 || num(txn.kdvRate, 0) > 100) errors.push('KDV oranı 0–100 arasında olmalıdır.');
  return errors;
}

/** Bir toptancının cari özeti: toplam borç, ödeme ve kalan bakiye. */
export function supplierBalance(supplierId, txns, { from = '', to = '' } = {}) {
  const rows = txns
    .filter((t) => t.supplierId === supplierId && t.active !== false)
    .filter((t) => (!from || t.date >= from) && (!to || t.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  let debit = 0;
  let credit = 0;
  const ledger = rows.map((txn) => {
    if (txn.type === 'invoice') debit += txn.amount;
    else credit += txn.amount;
    return { ...txn, runningBalance: round2(debit - credit) };
  });

  return {
    ledger,
    totalDebt: round2(debit),
    totalPaid: round2(credit),
    balance: round2(debit - credit),
  };
}

/* ------------------------------------------------- §5.2 Gün sonu / kasa -- */

export function createCashDay(patch = {}) {
  return {
    id: patch.id || uid('csh'),
    date: patch.date || '',
    /** Fiili (sayılan) kasa tutarı. */
    countedCash: num(patch.countedCash, 0),
    /** Gün başı devir. */
    openingCash: num(patch.openingCash, 0),
    note: text(patch.note),
    closedBy: text(patch.closedBy),
    closedAt: patch.closedAt || '',
  };
}

export function validateCashDay(day) {
  const errors = [];
  if (!isValidDate(day.date)) errors.push('Geçerli bir tarih giriniz.');
  if (num(day.countedCash, -1) < 0) errors.push('Fiili kasa tutarı negatif olamaz.');
  if (num(day.openingCash, -1) < 0) errors.push('Devir tutarı negatif olamaz.');
  return errors;
}

/**
 * Bir günün kasa durumu: sistemdeki gelir/giderden beklenen kasa ile fiili kasayı
 * karşılaştırır (PRD §5.2).
 */
export function cashSummary({ date, openingCash = 0, countedCash = 0, income = 0, expense = 0 }) {
  const expected = round2(num(openingCash) + num(income) - num(expense));
  const counted = round2(num(countedCash));
  const difference = round2(counted - expected);
  return {
    date,
    openingCash: round2(num(openingCash)),
    income: round2(num(income)),
    expense: round2(num(expense)),
    expectedCash: expected,
    countedCash: counted,
    difference,
    status: difference === 0 ? 'balanced' : difference > 0 ? 'surplus' : 'shortage',
    statusLabel: difference === 0 ? 'Denk / Fark Yok' : difference > 0 ? 'Kasa Fazlası' : 'Kasa Açığı',
  };
}


/* ------------------------------- §2.1/§2.3 Restoran gelirleri (gün sonu) -- */

/** Bir güne en fazla iki gün sonu kaydı girilebilir. */
export const MAX_DAY_END_PER_DAY = 2;

export function createRestaurantIncome(patch = {}) {
  const sequence = Math.min(MAX_DAY_END_PER_DAY, Math.max(1, Math.round(num(patch.sequence, 1))));
  return {
    id: patch.id || uid('rin'),
    date: patch.date || '',
    /** Gün sonu sıra numarası (1 veya 2). */
    sequence,
    amount: num(patch.amount, 0),
    /** Tutar KDV dahil mi girildi? */
    kdvIncluded: patch.kdvIncluded !== false,
    note: text(patch.note),
    /** İptal edilen kayıtlar hesaplamalara girmez. */
    active: patch.active !== false,
  };
}

export function validateRestaurantIncome(income, { incomes = [] } = {}) {
  const errors = [];
  if (!isValidDate(income.date)) errors.push('Geçerli bir tarih giriniz.');
  if (num(income.amount, 0) <= 0) errors.push('Gelir tutarı 0’dan büyük olmalıdır.');
  if (![1, 2].includes(income.sequence)) errors.push('Gün sonu sıra numarası 1 veya 2 olmalıdır.');

  const sameDay = incomes.filter((i) => i.id !== income.id && i.date === income.date && i.active !== false);
  if (income.active !== false) {
    if (sameDay.some((i) => i.sequence === income.sequence)) {
      errors.push(`${income.date} tarihinde ${income.sequence}. gün sonu zaten kayıtlı.`);
    }
    if (sameDay.length >= MAX_DAY_END_PER_DAY) {
      errors.push(`Bir güne en fazla ${MAX_DAY_END_PER_DAY} gün sonu kaydı girilebilir.`);
    }
  }
  return errors;
}

/** Bir günün restoran geliri: aynı tarihin gün sonu kayıtları toplanır. */
export function restaurantDayTotal(date, incomes) {
  const rows = incomes.filter((i) => i.date === date && i.active !== false);
  return {
    date,
    entries: rows.sort((a, b) => a.sequence - b.sequence),
    total: round2(rows.reduce((sum, i) => sum + i.amount, 0)),
  };
}

/** Dönem içi restoran geliri ve KDV'si. */
export function restaurantIncomeSummary(incomes, { from = '', to = '', kdvRate = 10 } = {}) {
  const rows = incomes.filter((i) => i.active !== false
    && (!from || i.date >= from) && (!to || i.date <= to));

  let gross = 0;
  let kdv = 0;
  for (const income of rows) {
    // KDV hariç girildiyse tutara KDV eklenerek brüt bulunur.
    const grossAmount = income.kdvIncluded ? income.amount : income.amount * (1 + kdvRate / 100);
    gross += grossAmount;
    kdv += (grossAmount * kdvRate) / (100 + kdvRate);
  }

  const byDay = new Map();
  for (const income of rows) {
    byDay.set(income.date, round2((byDay.get(income.date) ?? 0) + income.amount));
  }

  return {
    gross: round2(gross),
    kdv: round2(kdv),
    net: round2(gross - kdv),
    count: rows.length,
    days: byDay.size,
    byDay: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])),
  };
}

/* ----------------------------------- §2.4 Restoran ekstra giderleri ------ */

export const RESTAURANT_EXPENSE_CATEGORIES = [
  'Restoran Ekipmanı', 'Mutfak Sarf Malzemesi', 'Küçük Tamirat',
  'Temizlik Malzemesi', 'Operasyonel Harcama', 'Diğer',
];

export const PAYMENT_METHODS = ['Nakit', 'Kredi Kartı', 'Havale/EFT', 'Veresiye', 'Diğer'];

export function createRestaurantExpense(patch = {}) {
  return {
    id: patch.id || uid('rex'),
    date: patch.date || '',
    category: RESTAURANT_EXPENSE_CATEGORIES.includes(patch.category) ? patch.category : 'Diğer',
    amount: num(patch.amount, 0),
    note: text(patch.note),
    paymentMethod: PAYMENT_METHODS.includes(patch.paymentMethod) ? patch.paymentMethod : '',
    active: patch.active !== false,
  };
}

export function validateRestaurantExpense(expense) {
  const errors = [];
  if (!isValidDate(expense.date)) errors.push('Geçerli bir harcama tarihi giriniz.');
  if (num(expense.amount, 0) <= 0) errors.push('Tutar 0’dan büyük olmalıdır.');
  if (!text(expense.note) && !expense.category) errors.push('Açıklama veya kategori giriniz.');
  return errors;
}

/* --------------------------------------- §3.1 Yabancı çalışanlar --------- */

export function createForeignWorker(patch = {}) {
  return {
    id: patch.id || uid('frw'),
    name: text(patch.name),
    /** Dönem: 'YYYY-MM'. */
    period: isValidMonth(patch.period) ? patch.period : '',
    amount: num(patch.amount, 0),
    paymentDate: patch.paymentDate || '',
    note: text(patch.note),
    active: patch.active !== false,
  };
}

export function validateForeignWorker(worker, { workers = [] } = {}) {
  const errors = [];
  if (!text(worker.name)) errors.push('Çalışan adı zorunludur.');
  if (!isValidMonth(worker.period)) errors.push('Geçerli bir dönem (ay) seçilmelidir.');
  if (num(worker.amount, 0) <= 0) errors.push('Maaş tutarı 0’dan büyük olmalıdır.');
  if (worker.paymentDate && !isValidDate(worker.paymentDate)) errors.push('Ödeme tarihi geçersiz.');
  const clash = workers.find((w) => w.id !== worker.id && w.period === worker.period
    && text(w.name).toLocaleLowerCase('tr') === text(worker.name).toLocaleLowerCase('tr'));
  if (clash) errors.push(`${worker.name} için ${worker.period} dönemi zaten kayıtlı.`);
  return errors;
}

/* ----------------------------------------------------- §5.1 Vergi oranları -- */

export function defaultTaxRates() {
  return {
    /** Konaklama hizmetlerinde hesaplanan KDV (%). */
    kdvIncome: 10,
    /** Restoran / yiyecek-içecek gelirlerinde hesaplanan KDV (%) — PRD v2 §2.2. */
    kdvRestaurant: 10,
    /** Giderlerde varsayılan indirilecek KDV (%). */
    kdvExpense: 20,
    /** Konaklama vergisi (%). */
    accommodationTax: 2,
    /** Turizm payı (%). */
    tourismShare: 0.75,
    /** Net kâr üzerinden gelir/kurumlar vergisi (%). */
    incomeTax: 25,
    /**
     * Yabancı çalışan maaşları vergi matrahından indirilebilir mi? (PRD v2 §3.1)
     * Varsayılan: hayır — gidere dahil edilir, matrahtan indirilmez.
     */
    foreignStaffDeductible: false,
  };
}

export function validateTaxRates(rates) {
  const errors = [];
  for (const [key, label] of Object.entries({
    kdvIncome: 'Gelir KDV oranı',
    kdvRestaurant: 'Restoran KDV oranı',
    kdvExpense: 'Gider KDV oranı',
    accommodationTax: 'Konaklama vergisi oranı',
    tourismShare: 'Turizm payı oranı',
    incomeTax: 'Gelir vergisi oranı',
  })) {
    const value = num(rates?.[key], -1);
    if (value < 0 || value > 100) errors.push(`${label} 0 ile 100 arasında olmalıdır.`);
  }
  return errors;
}

/**
 * Vergi raporu (PRD §5.1).
 * KDV dahil tutarlar üzerinden iç yüzde ile hesaplanır:
 *   KDV = tutar × oran / (100 + oran)
 */
export function taxReport({
  revenue = 0,
  expenses = 0,
  expenseKdvBase = null,
  /** Restoran geliri (KDV dahil) — kendi KDV oranıyla hesaplanır (PRD v2 §2.2). */
  restaurantRevenue = 0,
  /** Vergi matrahından indirilemeyen giderler (ör. yabancı çalışan maaşları). */
  nonDeductibleExpenses = 0,
  rates = defaultTaxRates(),
} = {}) {
  const kdvIncomeRate = num(rates.kdvIncome, 0);
  const kdvRestaurantRate = num(rates.kdvRestaurant, kdvIncomeRate);
  const kdvExpenseRate = num(rates.kdvExpense, 0);

  // Konaklama ve restoran gelirleri ayrı oranlarla KDV üretir.
  const roomKdv = round2((revenue * kdvIncomeRate) / (100 + kdvIncomeRate));
  const restaurantKdv = round2((restaurantRevenue * kdvRestaurantRate) / (100 + kdvRestaurantRate));
  const collectedKdv = round2(roomKdv + restaurantKdv);

  const kdvBase = expenseKdvBase == null ? expenses : expenseKdvBase;
  const deductibleKdv = round2((kdvBase * kdvExpenseRate) / (100 + kdvExpenseRate));
  const netKdv = round2(collectedKdv - deductibleKdv);

  const roomNetRevenue = round2(revenue - roomKdv);
  const restaurantNetRevenue = round2(restaurantRevenue - restaurantKdv);
  const netRevenue = round2(roomNetRevenue + restaurantNetRevenue);

  // Konaklama vergisi ve turizm payı yalnızca konaklama geliri üzerinden alınır.
  const accommodationTax = round2((roomNetRevenue * num(rates.accommodationTax, 0)) / 100);
  const tourismShare = round2((roomNetRevenue * num(rates.tourismShare, 0)) / 100);

  const netExpense = round2(expenses - deductibleKdv);
  const netProfit = round2(netRevenue - netExpense - accommodationTax - tourismShare);

  // Vergi matrahı: indirilemeyen giderler kâra geri eklenir (PRD v2 §3.1).
  const taxBase = round2(netProfit + nonDeductibleExpenses);
  const incomeTax = round2(Math.max(0, taxBase) * (num(rates.incomeTax, 0) / 100));

  return {
    rates: { ...rates },
    revenue: round2(revenue),
    restaurantRevenue: round2(restaurantRevenue),
    totalRevenue: round2(revenue + restaurantRevenue),
    expenses: round2(expenses),
    nonDeductibleExpenses: round2(nonDeductibleExpenses),
    roomKdv,
    restaurantKdv,
    collectedKdv,
    deductibleKdv,
    /** Ödenecek net KDV = hesaplanan − indirilecek (negatifse devreden KDV). */
    netKdv,
    carriedKdv: netKdv < 0 ? round2(-netKdv) : 0,
    payableKdv: netKdv > 0 ? netKdv : 0,
    roomNetRevenue,
    restaurantNetRevenue,
    netRevenue,
    netExpense,
    accommodationTax,
    tourismShare,
    netProfit,
    taxBase,
    incomeTax,
    netProfitAfterTax: round2(netProfit - incomeTax),
  };
}

export { monthKey, round2 };
