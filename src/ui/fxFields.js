/**
 * Döviz işlemlerinde kur mührü ve kur farkı alanları.
 *
 * Hem rezervasyon hem fatura formlarında aynı bölüm kullanılır:
 *  · işlem gününün kuru (kur defterinden) ve TL karşılığı
 *  · kur bulunamadığında o günün kurunu elle girme
 *  · "Kesilen Fatura Tutarı (TL)" ve otomatik kur farkı
 */

import { formatDate, formatDecimal, formatMoney } from '../core/format.js';
import { createExchangeRate, resolveRate, round2 } from '../core/rates.js';
import { clear, field, h, toast } from './dom.js';

/** `195 € / 7.410,00 ₺` biçiminde çift para birimi gösterimi. */
export function dualAmount(amount, currency, rate) {
  const own = formatMoney(amount, currency);
  if (currency === 'TRY' || !(Number(rate) > 0)) return own;
  return `${own} / ${formatMoney(round2(Number(amount) * Number(rate)), 'TRY')}`;
}

/**
 * Form bölümünü üretir.
 * @param {object} app
 * @param {object} draft `currency`, `fxRate`, `fxRateDate`, `fxSource`, `invoicedAmountTry` taşır
 * @param {{dateOf:Function, amountOf:Function}} options
 * @returns {{box: HTMLElement, render: Function}}
 */
export function fxSection(app, draft, { dateOf, amountOf }) {
  const box = h('div', { class: 'stack tight' });

  /** Verilen tarihe kur kaydı ekler ve bölümü yeniler. */
  const saveManualRate = async (date, value) => {
    const entry = createExchangeRate({
      date, currency: draft.currency, rate: value, kind: 'manual', source: 'Manuel giriş',
    });
    await app.store.saveExchangeRate(entry);
    toast(`${formatDate(date)} kuru kaydedildi: 1 ${draft.currency} = ${formatDecimal(value)} ₺`);
    render();
  };

  function render() {
    clear(box);
    if (draft.currency === 'TRY') {
      draft.fxRate = 0;
      draft.fxRateDate = '';
      draft.fxSource = '';
      return;
    }

    const date = dateOf();
    const amount = Number(amountOf()) || 0;
    const rates = app.store.getState().exchangeRates ?? [];
    const resolved = resolveRate(rates, date, { currency: draft.currency });

    // Kullanıcı kuru elle değiştirmediyse defterdeki kur mühürlenir.
    if (resolved.found && !draft.fxRateManual) {
      draft.fxRate = resolved.rate;
      draft.fxRateDate = resolved.date;
      draft.fxSource = resolved.exact ? resolved.source : `${resolved.source} (önceki gün)`;
    }

    const rate = Number(draft.fxRate) || 0;
    const systemTry = rate > 0 ? round2(amount * rate) : 0;

    /* --- kur durumu --- */
    if (!date) {
      box.appendChild(h('div', { class: 'verdict verdict-below fx-missing' },
        h('strong', {}, '📅 Önce işlem tarihini giriniz.'),
        h('span', { class: 'small' }, 'Kur, işlemin yapıldığı güne göre belirlenir.')));
    } else if (!resolved.exact && !draft.fxRateManual) {
      // O güne ait kur yok: sistem hata vermez, kullanıcıdan o günün kurunu ister.
      // Yakın bir kur varsa önerilir ve işlem bloke edilmez.
      const input = h('input', {
        type: 'number', min: '0', step: 'any', class: 'fx-manual-rate',
        placeholder: 'Örn. 38,00',
        value: resolved.found ? formatDecimal(resolved.rate).replace(',', '.') : '',
      });
      box.appendChild(h('div', { class: 'verdict verdict-below fx-missing' },
        h('strong', {}, `💱 ${formatDate(date)} tarihine ait ${draft.currency} kuru kayıtlı değil.`),
        h('span', { class: 'small' }, resolved.found
          ? `Şimdilik en yakın önceki günün (${formatDate(resolved.date)}) kuru olan ${formatDecimal(resolved.rate)} ₺ kullanılıyor. `
            + 'Doğru kuru girip kaydederseniz bu güne yazılır.'
          : 'Bu günün kurunu girin; kur defterine kaydedilip işlemde kullanılacak.'),
        h('div', { class: 'row gap center wrap' },
          input,
          h('button', {
            class: 'btn small primary fx-manual-save', type: 'button',
            onClick: async () => {
              const value = Number(input.value);
              if (!(value > 0)) { toast('Kur 0’dan büyük olmalıdır.', 'error'); return; }
              draft.fxRateManual = false;
              await saveManualRate(date, value);
            },
          }, '💾 Bu Günün Kuru Olarak Ekle')),
        rate > 0 ? h('span', { class: 'small fx-dual' }, `Tutar: ${dualAmount(amount, draft.currency, rate)}`) : null));
    } else {
      const tone = resolved.exact ? 'ok' : 'below';
      box.appendChild(h('div', { class: `verdict verdict-${tone} fx-seal` },
        h('strong', {}, `💱 1 ${draft.currency} = ${formatDecimal(rate)} ₺`),
        h('span', { class: 'small' },
          `${draft.fxSource || 'Manuel'} · ${draft.fxRateDate ? formatDate(draft.fxRateDate) : formatDate(date)}`
          + (resolved.exact ? '' : ' · bu güne ait kur yok, en yakın önceki gün kullanıldı')),
        h('span', { class: 'small fx-dual' }, `Tutar: ${dualAmount(amount, draft.currency, rate)}`)));
    }

    /* --- kuru elle değiştirme --- */
    box.appendChild(h('div', { class: 'grid-2' },
      field(`Kullanılan Kur (1 ${draft.currency} = ₺)`, h('input', {
        type: 'number', min: '0', step: 'any', value: rate || '', class: 'fx-rate-input',
        onInput: (e) => {
          draft.fxRate = Number(e.target.value);
          draft.fxRateManual = true;
          draft.fxSource = 'Manuel giriş';
          draft.fxRateDate = date;
          renderDifference();
        },
      }), 'Kayda mühürlenir; kur sonradan değişse bile bu tutar sabit kalır.'),
      field('Kesilen Fatura Tutarı (TL)', h('input', {
        type: 'number', min: '0', step: 'any', value: draft.invoicedAmountTry || '', class: 'invoiced-try',
        onInput: (e) => { draft.invoicedAmountTry = Number(e.target.value); renderDifference(); },
      }), 'Resmi faturadaki TL tutarı. Boş bırakılırsa kur farkı hesaplanmaz.')));

    const differenceBox = h('div', {});
    box.appendChild(differenceBox);

    /** Kur farkını canlı hesaplar. */
    function renderDifference() {
      clear(differenceBox);
      const currentRate = Number(draft.fxRate) || 0;
      const invoiced = Number(draft.invoicedAmountTry) || 0;
      const computed = currentRate > 0 ? round2(amount * currentRate) : 0;
      if (!(invoiced > 0) || !(computed > 0)) {
        if (computed > 0) {
          differenceBox.appendChild(h('p', { class: 'muted small fx-diff-pending' },
            `Sistemin hesapladığı tutar: ${formatMoney(computed)} · fatura tutarı girilmedi, kur farkı bekliyor.`));
        }
        return;
      }
      const difference = round2(invoiced - computed);
      const tone = difference === 0 ? 'ok' : (difference > 0 ? 'ok' : 'below');
      const label = difference === 0
        ? '✔ Kur farkı yok'
        : (difference > 0 ? '▲ Olumlu Kur Farkı (gelir)' : '▼ Olumsuz Kur Farkı (gider)');
      differenceBox.appendChild(h('div', { class: `verdict verdict-${tone} fx-difference` },
        h('strong', {}, `${label}: ${formatMoney(Math.abs(difference))}`),
        h('span', { class: 'small' },
          `Sistem: ${formatMoney(computed)} (${formatDecimal(amount)} × ${formatDecimal(currentRate)})`
          + ` · Fatura: ${formatMoney(invoiced)}`)));
    }
    renderDifference();
  }

  render();
  return { box, render };
}
