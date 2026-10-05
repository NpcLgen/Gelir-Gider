/**
 * Günlük otomatik kur çekimi (cron-job karşılığı).
 *
 * Sunucu açılışında ve belirlenen aralıkta TCMB/ECB'den o günün kuru çekilir ve
 * `exchangeRates` defterine yazılır. Böylece geçmiş kayıtların TL karşılığı,
 * işlemin yapıldığı günün kuruyla sabitlenebilir.
 */

import { createExchangeRate } from '../src/core/rates.js';
import { load, update } from './db.js';
import { fetchRate } from './fx.js';

let timer = null;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * O günün kurunu çeker ve deftere yazar. Kayıt zaten varsa (ve `force` değilse)
 * ağa çıkılmaz.
 * @returns {Promise<{status:'saved'|'exists'|'failed', date:string, rate?:number, error?:string}>}
 */
export async function syncDailyRate({ currency = 'EUR', force = false, user = null } = {}) {
  const date = today();
  const db = await load();
  const existing = (db.exchangeRates ?? []).find((r) => r.date === date && r.currency === currency);
  if (existing && !force) return { status: 'exists', date, rate: existing.rate };

  const preferred = db.settings?.fx?.source || 'tcmb';
  let result;
  try {
    result = await fetchRate({ currency, preferred });
  } catch (err) {
    // Ağ yoksa sistem çalışmaya devam eder; kur elle girilebilir.
    return { status: 'failed', date, error: err.message };
  }

  const entry = createExchangeRate({
    date, currency, rate: result.rate, kind: result.provider,
    source: result.providerLabel, sourceDate: result.sourceDate, fetchedAt: result.fetchedAt,
    enteredBy: user?.username ?? 'otomatik',
  });

  await update((current) => {
    current.exchangeRates = [
      ...(current.exchangeRates ?? []).filter((r) => !(r.date === date && r.currency === currency)),
      entry,
    ].sort((a, b) => b.date.localeCompare(a.date));

    const fx = { ...(current.settings.fx ?? {}) };
    fx.rate = result.rate;
    fx.provider = result.provider;
    fx.providerLabel = result.providerLabel;
    fx.sourceDate = result.sourceDate;
    fx.updatedAt = result.fetchedAt;
    fx.lastError = '';
    fx.history = { ...(fx.history ?? {}), [date]: result.rate };
    current.settings = { ...current.settings, fx };
  });

  return { status: 'saved', date, rate: entry.rate, source: entry.source };
}

/**
 * Günlük kur çekimini başlatır.
 * @param {{intervalHours?: number, currency?: string, onSync?: Function}} options
 */
export function startFxSync({ intervalHours = 12, currency = 'EUR', onSync = () => {} } = {}) {
  stopFxSync();
  const run = () => syncDailyRate({ currency }).then(onSync).catch(() => {});
  // Açılışta bir kez, sonra aralıklarla.
  setTimeout(run, 3000).unref?.();
  timer = setInterval(run, Math.max(1, intervalHours) * 3600 * 1000);
  timer.unref?.();
  return timer;
}

export function stopFxSync() {
  if (timer) clearInterval(timer);
  timer = null;
}
