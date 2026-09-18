/** Biçimlendirme yardımcıları (tr-TR). */

import { BASE_CURRENCY } from './catalog.js';
import { convert } from './fx.js';

const moneyFormatters = new Map();
const compact = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function moneyFormatter(currency) {
  if (!moneyFormatters.has(currency)) {
    moneyFormatters.set(currency, new Intl.NumberFormat('tr-TR', {
      style: 'currency', currency, maximumFractionDigits: 2,
    }));
  }
  return moneyFormatters.get(currency);
}

export const formatMoney = (value, currency = BASE_CURRENCY) =>
  moneyFormatter(currency).format(Number(value) || 0);

export const formatNumber = (value) => compact.format(Number(value) || 0);
export const formatDecimal = (value) => decimal.format(Number(value) || 0);
export const formatPercent = (value) => `%${decimal.format((Number(value) || 0) * 100)}`;
export const formatSignedPercent = (value) => {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${decimal.format(value * 100)}%`;
};
export const formatDate = (value) => {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return `${d}.${m}.${y}`;
};

/**
 * Raporlar baz para biriminde (TRY) üretilir; görüntüleme para birimine çeviren
 * ve biçimlendiren yardımcı (PRD §6.1 kur anahtarı).
 */
export function createPresenter(settings) {
  const currency = settings?.displayCurrency ?? BASE_CURRENCY;
  const rate = Number(settings?.fx?.rate) || 1;
  const toDisplay = (baseAmount) => convert(baseAmount, BASE_CURRENCY, currency, rate);
  return {
    currency,
    rate,
    toDisplay,
    money: (baseAmount) => formatMoney(toDisplay(baseAmount), currency),
    /** Girildiği para birimindeki ham tutar (gider satırı gibi yerlerde). */
    raw: (amount, itemCurrency) => formatMoney(amount, itemCurrency || BASE_CURRENCY),
  };
}
