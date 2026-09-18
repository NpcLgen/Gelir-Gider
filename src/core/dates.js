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
