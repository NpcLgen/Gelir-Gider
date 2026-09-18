/**
 * Çift kur desteği (PRD §1.1, §2.4, §6.1).
 *
 * Tüm tutarlar girildikleri para biriminde saklanır; raporlama anında görüntüleme
 * para birimine çevrilir. Kur, tarih bazlı geçmişle tutulur: geçmiş bir dönem
 * raporlanırken o tarihe en yakın kur kullanılır, böylece gerçek kâr/zarar korunur.
 */

import { BASE_CURRENCY } from './catalog.js';

export function defaultFx() {
  return {
    source: 'manual',
    /** 1 EUR karşılığı TRY. */
    rate: 47.5,
    /** { 'YYYY-MM-DD': eurTry } — TCMB/API'den çekilen veya manuel girilen geçmiş. */
    history: {},
    updatedAt: '',
  };
}

/** Verilen tarihe en uygun kuru döndürür: aynı gün → en yakın geçmiş gün → güncel kur. */
export function rateFor(fx, date) {
  const history = fx?.history ?? {};
  if (date && history[date]) return history[date];
  if (date) {
    const earlier = Object.keys(history).filter((d) => d <= date).sort();
    if (earlier.length) return history[earlier[earlier.length - 1]];
  }
  return Number(fx?.rate) || 1;
}

/** Tutarı kaynaktan hedefe çevirir (ara birim: TRY). */
export function convert(amount, from, to, rate) {
  const value = Number(amount) || 0;
  const source = from || BASE_CURRENCY;
  const target = to || BASE_CURRENCY;
  if (source === target) return value;
  const eurTry = Number(rate) || 1;
  if (source === 'EUR' && target === 'TRY') return value * eurTry;
  if (source === 'TRY' && target === 'EUR') return value / eurTry;
  return value;
}

/** Tutarı raporlama tabanına (TRY) çevirir. */
export const toBase = (amount, currency, rate) => convert(amount, currency, BASE_CURRENCY, rate);

/**
 * TCMB günlük kur XML'ini okur. Tarayıcıda CORS engeli olabileceğinden çağıran
 * taraf hatayı yakalayıp manuel kura düşmelidir (bkz. PRD §2.4 notu).
 */
export async function fetchTcmbRate({ source = 'tcmb', fetchImpl = globalThis.fetch } = {}) {
  const url = 'https://www.tcmb.gov.tr/kurlar/today.xml';
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`TCMB yanıtı okunamadı (${response.status})`);
  const xml = await response.text();
  const block = xml.match(/<Currency[^>]*CurrencyCode="EUR"[\s\S]*?<\/Currency>/);
  if (!block) throw new Error('EUR kuru bulunamadı.');
  const tag = source === 'tcmb_buy' ? 'ForexBuying' : 'BanknoteSelling';
  const value = block[0].match(new RegExp(`<${tag}>([^<]+)</${tag}>`))
    ?? block[0].match(/<ForexSelling>([^<]+)<\/ForexSelling>/);
  if (!value) throw new Error('Kur alanı bulunamadı.');
  const rate = Number(String(value[1]).replace(',', '.'));
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Kur değeri geçersiz.');
  return rate;
}
