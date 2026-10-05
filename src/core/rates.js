/**
 * Tarihsel döviz kuru defteri ve kur farkı hesapları.
 *
 * Kurlar `exchangeRates` koleksiyonunda **tarih bazında** saklanır
 * (01.09.2026 → 1 EUR = 38,00 ₺). Her döviz işlemi kaydedilirken o günün kuru
 * kayda **mühürlenir** (`fxRate`); böylece kur sonradan değişse bile geçmiş
 * kayıtların TL karşılığı sabit kalır.
 *
 * Kur farkı: fiilen kesilen faturanın TL tutarı ile kurdan hesaplanan TL tutarı
 * arasındaki farktır. Pozitifse olumlu kur farkı (gelir), negatifse olumsuz kur
 * farkı (gider) sayılır.
 */

import { isValidDate } from './dates.js';

const num = (value, fallback = 0) => {
  const n = typeof value === 'string' ? Number(String(value).replace(',', '.')) : Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const text = (value) => String(value ?? '').trim();

/** Kur kaydının kaynağı / tipi. */
export const RATE_KINDS = [
  { key: 'tcmb', label: 'TCMB Efektif Satış' },
  { key: 'tcmb_buy', label: 'TCMB Döviz Alış' },
  { key: 'frankfurter', label: 'Frankfurter (ECB)' },
  { key: 'manual', label: 'Manuel giriş' },
];
export const RATE_KIND_MAP = Object.fromEntries(RATE_KINDS.map((k) => [k.key, k]));
export const rateKindLabel = (kind) => RATE_KIND_MAP[kind]?.label ?? kind ?? '—';

export function createExchangeRate(patch = {}) {
  const kind = RATE_KIND_MAP[patch.kind] ? patch.kind : 'manual';
  return {
    id: patch.id || `fxr_${text(patch.currency).toUpperCase() || 'EUR'}_${patch.date || ''}`,
    /** Kurun ait olduğu gün (YYYY-AA-GG). */
    date: patch.date || '',
    currency: (text(patch.currency) || 'EUR').toUpperCase(),
    /** 1 birim dövizin TL karşılığı. */
    rate: num(patch.rate, 0),
    kind,
    source: text(patch.source) || rateKindLabel(kind),
    /** Kaynağın bildirdiği tarih (TCMB'de 04.10.2026 gibi). */
    sourceDate: text(patch.sourceDate),
    fetchedAt: patch.fetchedAt || new Date().toISOString(),
    enteredBy: text(patch.enteredBy),
  };
}

export function validateExchangeRate(rate) {
  const errors = [];
  if (!isValidDate(rate?.date)) errors.push('Geçerli bir tarih giriniz (YYYY-AA-GG).');
  if (!text(rate?.currency)) errors.push('Para birimi zorunludur.');
  if (num(rate?.rate, 0) <= 0) errors.push('Kur 0’dan büyük olmalıdır.');
  if (num(rate?.rate, 0) > 100000) errors.push('Kur değeri makul aralıkta değil.');
  return errors;
}

/** Tarih → kur kaydı eşlemesi (aynı gün için son kayıt geçerlidir). */
export function rateMap(rates = [], currency = 'EUR') {
  const map = new Map();
  for (const rate of rates) {
    if (rate.currency !== currency) continue;
    map.set(rate.date, rate);
  }
  return map;
}

/** Yalnızca o güne ait kayıtlı kuru döndürür; yoksa null. */
export function rateOn(rates = [], date, currency = 'EUR') {
  if (!isValidDate(date)) return null;
  const found = rates.filter((r) => r.currency === currency && r.date === date);
  return found.length ? found[found.length - 1] : null;
}

/**
 * Bir tarih için kullanılacak kuru çözer.
 * @returns {{rate:number, date:string, source:string, kind:string, exact:boolean, found:boolean}}
 *   `exact` → tam o güne ait kayıt bulundu
 *   `found` → en azından daha eski bir kayıt bulundu (yoksa `fallbackRate` kullanılır)
 */
export function resolveRate(rates = [], date, { currency = 'EUR', fallbackRate = 0, fallbackSource = 'Varsayılan kur' } = {}) {
  const exact = rateOn(rates, date, currency);
  if (exact) {
    return { rate: exact.rate, date: exact.date, source: exact.source, kind: exact.kind, exact: true, found: true };
  }
  // Tam gün yoksa en yakın önceki gün (hafta sonu / tatil günleri için).
  const earlier = rates
    .filter((r) => r.currency === currency && isValidDate(r.date) && r.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (earlier.length) {
    const near = earlier[earlier.length - 1];
    return { rate: near.rate, date: near.date, source: near.source, kind: near.kind, exact: false, found: true };
  }
  return {
    rate: num(fallbackRate, 0), date: '', source: fallbackSource, kind: 'manual', exact: false, found: false,
  };
}

/**
 * Kaydı o günün kuruyla mühürler. Kayıt TL ise mühür gerekmez.
 * @returns {{fxRate:number, fxRateDate:string, fxSource:string}}
 */
export function sealRate(rates, { date, currency = 'TRY', fallbackRate = 0 } = {}) {
  if (currency === 'TRY') return { fxRate: 0, fxRateDate: '', fxSource: '' };
  const resolved = resolveRate(rates, date, { currency, fallbackRate });
  return {
    fxRate: round2(resolved.rate),
    fxRateDate: resolved.date || date,
    fxSource: resolved.exact ? resolved.source : `${resolved.source}${resolved.found ? ' (önceki gün)' : ''}`,
  };
}

/** Kaydın mühürlenmiş kurla hesaplanan TL karşılığı. */
export function amountInTry(record, amount) {
  const value = num(amount ?? record?.totalAmount ?? record?.amount, 0);
  if (!record || record.currency === 'TRY' || !record.currency) return round2(value);
  const rate = num(record.fxRate, 0);
  return rate > 0 ? round2(value * rate) : round2(value);
}

/** Kayıt için fiilen kesilen fatura tutarı girilmiş mi? */
export const isInvoiced = (record) => num(record?.invoicedAmountTry, 0) > 0;

/**
 * Kur farkı = kesilen fatura tutarı (TL) − kurdan hesaplanan TL tutarı.
 * Fatura tutarı girilmemişse 0 döner (henüz faturalanmamış kayıt).
 */
export function exchangeDifference(record, amount) {
  if (!isInvoiced(record)) return 0;
  return round2(num(record.invoicedAmountTry, 0) - amountInTry(record, amount));
}

/** Dönem içi kur farkı özeti. */
export function exchangeDifferenceSummary(records = [], { amountOf = (r) => r.totalAmount, dateOf = (r) => r.date, from = '', to = '' } = {}) {
  let positive = 0;
  let negative = 0;
  let invoicedCount = 0;
  let pendingCount = 0;
  const rows = [];

  for (const record of records) {
    const date = dateOf(record);
    if (from && date < from) continue;
    if (to && date > to) continue;
    if (record.currency !== 'EUR') continue;
    if (record.status === 'cancelled' || record.active === false) continue;

    const systemTry = amountInTry(record, amountOf(record));
    if (!isInvoiced(record)) {
      pendingCount += 1;
      rows.push({ record, date, systemTry, invoicedTry: 0, difference: 0, pending: true });
      continue;
    }
    const difference = exchangeDifference(record, amountOf(record));
    invoicedCount += 1;
    if (difference >= 0) positive += difference;
    else negative += -difference;
    rows.push({ record, date, systemTry, invoicedTry: num(record.invoicedAmountTry, 0), difference, pending: false });
  }

  return {
    positive: round2(positive),
    negative: round2(negative),
    net: round2(positive - negative),
    invoicedCount,
    pendingCount,
    rows: rows.sort((a, b) => b.date.localeCompare(a.date)),
  };
}

/**
 * Döviz işlemlerinin kullandığı ama kur defterinde bulunmayan günler.
 * Kullanıcıdan bu günlerin kurunu elle girmesi istenir.
 */
export function missingRateDates(records = [], rates = [], { dateOf = (r) => r.date, currency = 'EUR' } = {}) {
  const have = rateMap(rates, currency);
  const missing = new Map();
  for (const record of records) {
    if (record.currency !== currency) continue;
    if (record.status === 'cancelled' || record.active === false) continue;
    const date = dateOf(record);
    if (!isValidDate(date) || have.has(date)) continue;
    missing.set(date, (missing.get(date) ?? 0) + 1);
  }
  return [...missing.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export { round2 };

/**
 * Dönemin toplam kur farkı.
 *
 * Gelir kayıtlarında (rezervasyon, giden fatura) fatura tutarı sistem tutarının
 * üzerindeyse **olumlu kur farkı (gelir)**, altındaysa olumsuz kur farkı (gider)
 * oluşur. Gider kayıtlarında (gelen fatura) yön terstir: fazla ödenen tutar gider,
 * eksik ödenen tutar gelir sayılır.
 */
export function periodExchangeDifference({
  reservations = [], salesInvoices = [], purchaseInvoices = [], from = '', to = '',
} = {}) {
  const income = exchangeDifferenceSummary(reservations, {
    amountOf: (r) => r.totalAmount, dateOf: (r) => r.checkIn, from, to,
  });
  const sales = exchangeDifferenceSummary(salesInvoices, {
    amountOf: (r) => r.grossAmount || r.amount, dateOf: (r) => r.date, from, to,
  });
  const purchase = exchangeDifferenceSummary(purchaseInvoices, {
    amountOf: (r) => r.grossAmount || r.amount, dateOf: (r) => r.date, from, to,
  });

  // Gider tarafında işaret ters çevrilir.
  const gain = round2(income.positive + sales.positive + purchase.negative);
  const loss = round2(income.negative + sales.negative + purchase.positive);

  return {
    gain,
    loss,
    net: round2(gain - loss),
    invoicedCount: income.invoicedCount + sales.invoicedCount + purchase.invoicedCount,
    pendingCount: income.pendingCount + sales.pendingCount + purchase.pendingCount,
    rows: [
      ...income.rows.map((r) => ({ ...r, kind: 'rezervasyon', sign: 1 })),
      ...sales.rows.map((r) => ({ ...r, kind: 'gelir faturası', sign: 1 })),
      ...purchase.rows.map((r) => ({ ...r, kind: 'gider faturası', sign: -1 })),
    ].sort((a, b) => b.date.localeCompare(a.date)),
  };
}
