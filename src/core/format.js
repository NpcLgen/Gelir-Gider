/** Biçimlendirme yardımcıları (tr-TR). */

const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatMoney = (value) => money.format(Number(value) || 0);
export const formatNumber = (value) => compact.format(Number(value) || 0);
export const formatDecimal = (value) => decimal.format(Number(value) || 0);
export const formatPercent = (value) => `%${decimal.format((Number(value) || 0) * 100)}`;
export const formatDate = (value) => {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return `${d}.${m}.${y}`;
};
