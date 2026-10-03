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

/* ----------------------------------------------------- §5.1 Vergi oranları -- */

export function defaultTaxRates() {
  return {
    /** Konaklama hizmetlerinde hesaplanan KDV (%). */
    kdvIncome: 10,
    /** Giderlerde varsayılan indirilecek KDV (%). */
    kdvExpense: 20,
    /** Konaklama vergisi (%). */
    accommodationTax: 2,
    /** Turizm payı (%). */
    tourismShare: 0.75,
    /** Net kâr üzerinden gelir/kurumlar vergisi (%). */
    incomeTax: 25,
  };
}

export function validateTaxRates(rates) {
  const errors = [];
  for (const [key, label] of Object.entries({
    kdvIncome: 'Gelir KDV oranı',
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
export function taxReport({ revenue = 0, expenses = 0, expenseKdvBase = null, rates = defaultTaxRates() }) {
  const kdvIncomeRate = num(rates.kdvIncome, 0);
  const kdvExpenseRate = num(rates.kdvExpense, 0);

  const collectedKdv = round2((revenue * kdvIncomeRate) / (100 + kdvIncomeRate));
  const kdvBase = expenseKdvBase == null ? expenses : expenseKdvBase;
  const deductibleKdv = round2((kdvBase * kdvExpenseRate) / (100 + kdvExpenseRate));
  const netKdv = round2(collectedKdv - deductibleKdv);

  const netRevenue = round2(revenue - collectedKdv);
  const accommodationTax = round2((netRevenue * num(rates.accommodationTax, 0)) / 100);
  const tourismShare = round2((netRevenue * num(rates.tourismShare, 0)) / 100);

  const netExpense = round2(kdvBase - deductibleKdv + (expenses - kdvBase));
  const netProfit = round2(netRevenue - netExpense - accommodationTax - tourismShare);
  const incomeTax = round2(Math.max(0, netProfit) * (num(rates.incomeTax, 0) / 100));

  return {
    rates: { ...rates },
    revenue: round2(revenue),
    expenses: round2(expenses),
    collectedKdv,
    deductibleKdv,
    /** Ödenecek net KDV = hesaplanan − indirilecek (negatifse devreden KDV). */
    netKdv,
    carriedKdv: netKdv < 0 ? round2(-netKdv) : 0,
    payableKdv: netKdv > 0 ? netKdv : 0,
    netRevenue,
    netExpense,
    accommodationTax,
    tourismShare,
    netProfit,
    incomeTax,
    netProfitAfterTax: round2(netProfit - incomeTax),
  };
}

export { monthKey, round2 };
