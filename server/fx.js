/**
 * Döviz kuru servisi (PRD v2 §4.1).
 *
 * Kur **sunucu tarafında** çekilir: tarayıcıdan doğrudan TCMB'ye istek atmak
 * CORS nedeniyle engelleniyordu, bu yüzden güncelleme hiç çalışmıyordu.
 * Birden çok kaynak sırayla denenir; hepsi başarısız olursa mevcut kur korunur
 * ve çağırana açıklayıcı hata döner.
 */

const TIMEOUT_MS = 12000;

/** Desteklenen kaynaklar. Sıra önemlidir: ilk başarılı yanıt kullanılır. */
export const FX_PROVIDERS = [
  {
    key: 'tcmb',
    label: 'TCMB Efektif Satış',
    url: 'https://www.tcmb.gov.tr/kurlar/today.xml',
    parse: (text, currency) => parseTcmb(text, currency, 'BanknoteSelling'),
  },
  {
    key: 'tcmb_buy',
    label: 'TCMB Döviz Alış',
    url: 'https://www.tcmb.gov.tr/kurlar/today.xml',
    parse: (text, currency) => parseTcmb(text, currency, 'ForexBuying'),
  },
  {
    key: 'frankfurter',
    label: 'Frankfurter (ECB)',
    url: (currency) => `https://api.frankfurter.app/latest?from=${currency}&to=TRY`,
    parse: (text) => {
      const data = JSON.parse(text);
      const rate = Number(data?.rates?.TRY);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error('TRY kuru bulunamadı.');
      return { rate, date: data.date ?? null };
    },
  },
];

export const PROVIDER_MAP = Object.fromEntries(FX_PROVIDERS.map((p) => [p.key, p]));

function parseTcmb(xml, currency, tag) {
  const block = xml.match(new RegExp(`<Currency[^>]*CurrencyCode="${currency}"[\\s\\S]*?</Currency>`));
  if (!block) throw new Error(`${currency} kuru yanıtta bulunamadı.`);
  const pick = (name) => {
    const found = block[0].match(new RegExp(`<${name}>([^<]+)</${name}>`));
    const value = found ? Number(String(found[1]).replace(',', '.')) : NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  // İstenen alan boşsa (bazı para birimlerinde olur) sırayla alternatiflere düş.
  const rate = pick(tag) ?? pick('ForexSelling') ?? pick('ForexBuying');
  if (!rate) throw new Error(`${currency} için geçerli kur alanı yok.`);
  // TCMB kök etiketi iki tarih taşır: Tarih="04.10.2026" (TR) ve Date="10/04/2026" (US).
  // Arayüz Türkçe olduğu için TR biçimi tercih edilir.
  const date = xml.match(/\bTarih="([^"]+)"/)?.[1] ?? xml.match(/\bDate="([^"]+)"/)?.[1] ?? null;
  return { rate, date };
}

async function fetchText(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'OtelFinans/2.0', accept: 'application/xml, application/json, text/plain' },
    });
    if (!response.ok) throw new Error(`sunucu ${response.status} döndü`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kuru çeker. `preferred` kaynağı önce denenir, başarısız olursa diğerleri.
 * @returns {{rate:number, provider:string, providerLabel:string, sourceDate:string|null, fetchedAt:string, attempts:Array}}
 */
export async function fetchRate({ currency = 'EUR', preferred = 'tcmb', fetchImpl = globalThis.fetch } = {}) {
  const ordered = [
    ...FX_PROVIDERS.filter((p) => p.key === preferred),
    ...FX_PROVIDERS.filter((p) => p.key !== preferred),
  ];

  const attempts = [];
  for (const provider of ordered) {
    const url = typeof provider.url === 'function' ? provider.url(currency) : provider.url;
    try {
      const text = await fetchText(url, fetchImpl);
      const { rate, date } = provider.parse(text, currency);
      return {
        rate: Math.round(rate * 10000) / 10000,
        provider: provider.key,
        providerLabel: provider.label,
        sourceDate: date,
        fetchedAt: new Date().toISOString(),
        attempts,
      };
    } catch (err) {
      attempts.push({ provider: provider.key, label: provider.label, error: err.message });
    }
  }

  const detail = attempts.map((a) => `${a.label}: ${a.error}`).join(' · ');
  const error = new Error(`Kur alınamadı. Denenen kaynaklar — ${detail}`);
  error.attempts = attempts;
  throw error;
}
