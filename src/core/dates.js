/** Tarih yardımcıları. Tüm tarihler 'YYYY-MM-DD' metin formatındadır (UTC kabul edilir). */

const DAY_MS = 86400000;

export function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toTime(value));
}

export function toTime(value) {
  return Date.parse(`${value}T00:00:00Z`);
}

export function toISO(time) {
  return new Date(time).toISOString().slice(0, 10);
}

export function addDays(value, days) {
  return toISO(toTime(value) + days * DAY_MS);
}

/** [start, end) aralığındaki gece sayısı. */
export function nightsBetween(start, end) {
  const nights = Math.round((toTime(end) - toTime(start)) / DAY_MS);
  return nights > 0 ? nights : 0;
}

/**
 * İki yarı-açık aralığın kesişimindeki gece sayısı.
 * Dönem filtresi için kullanılır: [periodStart, periodEnd] kapsayıcı verilir,
 * hesapta periodEnd'in ertesi günü üst sınır olarak alınır.
 */
export function overlapNights(startA, endA, startB, endB) {
  const start = Math.max(toTime(startA), toTime(startB));
  const end = Math.min(toTime(endA), toTime(endB));
  const nights = Math.round((end - start) / DAY_MS);
  return nights > 0 ? nights : 0;
}

/** Dönem nesnesi: kapsayıcı [from, to] tarihlerini yarı-açık aralığa çevirir. */
export function period(from, to) {
  return { from, to, start: from, end: addDays(to, 1) };
}

export function monthPeriod(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  const from = `${yyyymm}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return period(from, `${yyyymm}-${String(lastDay).padStart(2, '0')}`);
}

export function daysInPeriod(p) {
  return nightsBetween(p.start, p.end);
}

/** Dönem içindeki tüm günleri 'YYYY-MM-DD' olarak üretir. */
export function eachDate(p) {
  const days = [];
  for (let t = toTime(p.start); t < toTime(p.end); t += DAY_MS) days.push(toISO(t));
  return days;
}

export const monthKey = (value) => value.slice(0, 7);

export function shiftMonth(yyyymm, delta) {
  const [y, m] = yyyymm.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 0=Pazar … 6=Cumartesi */
export const weekday = (value) => new Date(toTime(value)).getUTCDay();
/** PRD §1.1 — hafta sonu tanımı: Cuma ve Cumartesi geceleri. */
export const isWeekend = (value) => [5, 6].includes(weekday(value));

/** PRD §7.1 — hızlı tarih aralıkları. */
export function quickRange(key, today = new Date()) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const mk = `${y}-${String(m).padStart(2, '0')}`;
  switch (key) {
    case 'lastMonth': return monthPeriod(shiftMonth(mk, -1));
    case 'thisQuarter': {
      const first = Math.floor((m - 1) / 3) * 3 + 1;
      const from = `${y}-${String(first).padStart(2, '0')}-01`;
      const lastMonth = first + 2;
      const lastDay = new Date(Date.UTC(y, lastMonth, 0)).getUTCDate();
      return period(from, `${y}-${String(lastMonth).padStart(2, '0')}-${lastDay}`);
    }
    case 'ytd': return period(`${y}-01-01`, today.toISOString().slice(0, 10));
    case 'sameMonthLastYear': return monthPeriod(`${y - 1}-${String(m).padStart(2, '0')}`);
    case 'thisMonth':
    default: return monthPeriod(mk);
  }
}

/** Bir dönemin bir önceki yıldaki karşılığı (YOY karşılaştırması için). */
export function previousYear(p) {
  const shift = (value) => `${Number(value.slice(0, 4)) - 1}${value.slice(4)}`;
  return { from: shift(p.from), to: shift(p.to), start: shift(p.start), end: shift(p.end) };
}
