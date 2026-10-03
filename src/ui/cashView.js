/** Kasa / Gün Sonu — kayıtlı kasa ile fiili kasanın karşılaştırılması (PRD §5.2). */

import { cashSummary } from '../core/finance.js';
import { eachDate, period as makePeriod } from '../core/dates.js';
import { expandExpenses, nightsInPeriod } from '../core/costEngine.js';
import { employeeTotal } from '../core/finance.js';
import { formatDate, formatMoney } from '../core/format.js';
import { clear, confirmDialog, errorList, field, h, openModal, toast } from './dom.js';

/**
 * Bir günün sistemdeki gelir ve giderini toplar.
 * Gelir: o gece konaklayan rezervasyonların gecelik payı.
 * Gider: o tarihli giderler + ekstra çalışan ödemeleri + toptancı ödemeleri.
 */
export function dayTotals(state, date) {
  const day = makePeriod(date, date);
  const { reservations, expenses, extraWorkers, supplierTxns, settings } = state;

  const income = reservations
    .filter((r) => r.status !== 'cancelled')
    .reduce((sum, r) => {
      const nights = nightsInPeriod(r, day);
      if (!nights) return sum;
      const total = Math.max(1, Math.round((Date.parse(`${r.checkOut}T00:00:00Z`) - Date.parse(`${r.checkIn}T00:00:00Z`)) / 86400000));
      const rate = r.currency === 'EUR' ? (settings.fx?.rate ?? 1) : 1;
      return sum + (r.totalAmount * rate * nights) / total;
    }, 0);

  const expenseTotal = expandExpenses(expenses, day, settings).reduce((sum, e) => sum + e.amountBase, 0)
    + extraWorkers.filter((w) => w.active !== false && w.date === date).reduce((sum, w) => sum + w.amount, 0)
    + supplierTxns.filter((t) => t.active !== false && t.type === 'payment' && t.date === date)
      .reduce((sum, t) => sum + t.amount, 0);

  return { income: Math.round(income * 100) / 100, expense: Math.round(expenseTotal * 100) / 100 };
}

export function cashView(app) {
  const state = app.store.getState();
  const p = app.period();
  const days = eachDate(p);

  const summaries = days
    .map((date) => {
      const saved = state.cashDays.find((d) => d.date === date);
      const totals = dayTotals(state, date);
      if (!saved && totals.income === 0 && totals.expense === 0) return null;
      return {
        date,
        saved,
        summary: cashSummary({
          date,
          openingCash: saved?.openingCash ?? 0,
          countedCash: saved?.countedCash ?? 0,
          income: totals.income,
          expense: totals.expense,
        }),
      };
    })
    .filter(Boolean)
    .reverse();

  const closed = summaries.filter((s) => s.saved);
  const monthDiff = closed.reduce((sum, s) => sum + s.summary.difference, 0);
  const shortage = closed.filter((s) => s.summary.status === 'shortage').length;
  const surplus = closed.filter((s) => s.summary.status === 'surplus').length;

  const rows = summaries.map(({ date, saved, summary }) => h('tr', { class: saved ? '' : 'muted' },
    h('td', {}, formatDate(date)),
    h('td', { class: 'num' }, formatMoney(summary.openingCash)),
    h('td', { class: 'num good' }, formatMoney(summary.income)),
    h('td', { class: 'num bad' }, formatMoney(summary.expense)),
    h('td', { class: 'num' }, h('strong', {}, formatMoney(summary.expectedCash))),
    h('td', { class: 'num' }, saved ? formatMoney(summary.countedCash) : h('span', { class: 'muted' }, '—')),
    h('td', { class: 'num' }, saved
      ? h('strong', { class: summary.status === 'balanced' ? '' : summary.status === 'surplus' ? 'good' : 'bad' },
        formatMoney(summary.difference))
      : '—'),
    h('td', {}, saved
      ? h('span', { class: `badge-${summary.status === 'shortage' ? 'alert' : 'warn'}${summary.status === 'balanced' ? ' hidden' : ''}` },
        summary.statusLabel)
      : h('span', { class: 'muted small' }, 'Gün sonu yapılmadı')),
    h('td', {}, h('div', { class: 'row gap' },
      h('button', {
        class: 'btn small', type: 'button',
        onClick: () => openCashDayForm(app, date, saved),
      }, saved ? 'Düzenle' : 'Gün Sonu Yap'),
      saved ? h('button', {
        class: 'icon-btn', type: 'button', title: 'Sil',
        onClick: () => confirmDialog(`${formatDate(date)} gün sonu kaydı silinsin mi?`, async () => {
          await app.store.deleteCashDay(saved.id);
          app.refresh();
          toast('Gün sonu kaydı silindi.', 'warn');
        }),
      }, '🗑️') : null))));

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Kasa / Gün Sonu'),
        h('p', { class: 'muted' }, 'Sistemdeki gelir-giderden beklenen kasa ile sayılan fiili kasa karşılaştırılır.')),
      h('button', {
        class: 'btn primary', type: 'button',
        onClick: () => openCashDayForm(app, new Date().toISOString().slice(0, 10), null),
      }, '＋ Gün Sonu Yap')),

    h('div', { class: 'kpi-grid' },
      kpi('Aylık Toplam Fark', formatMoney(monthDiff),
        monthDiff === 0 ? 'Kasa denk' : monthDiff > 0 ? 'Kasa fazlası' : 'Kasa açığı',
        monthDiff === 0 ? '' : monthDiff > 0 ? 'good' : 'bad'),
      kpi('Kasa Açığı Olan Gün', String(shortage), `${closed.length} gün sonu yapıldı`, shortage ? 'bad' : ''),
      kpi('Kasa Fazlası Olan Gün', String(surplus), 'Fazla veren günler', surplus ? 'good' : '')),

    h('div', { class: 'card table-card' },
      h('table', {},
        h('thead', {}, h('tr', {}, ...['Tarih', 'Devir', 'Gelir', 'Gider', 'Beklenen Kasa', 'Sayılan', 'Fark', 'Sonuç', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...(rows.length
          ? rows
          : [h('tr', {}, h('td', { colspan: '9', class: 'empty' }, 'Bu dönemde kasa hareketi yok.'))])))));
}

function kpi(label, value, hint, tone) {
  return h('div', { class: 'card kpi' },
    h('span', { class: 'muted small' }, label),
    h('strong', { class: tone || '' }, value),
    h('span', { class: 'muted small' }, hint));
}

export function openCashDayForm(app, date, source) {
  const state = app.store.getState();
  const draft = {
    id: source?.id,
    date: source?.date ?? date,
    openingCash: source?.openingCash ?? 0,
    countedCash: source?.countedCash ?? 0,
    note: source?.note ?? '',
    closedBy: state.me?.displayName ?? state.me?.username ?? '',
    closedAt: new Date().toISOString(),
  };

  openModal({
    title: `Gün Sonu · ${formatDate(draft.date)}`,
    subtitle: 'Sayılan kasa tutarını girin; sistem farkı hesaplar.',
    size: 'sm',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      const resultBox = h('div', {});

      const renderResult = () => {
        clear(resultBox);
        const totals = dayTotals(state, draft.date);
        const summary = cashSummary({
          date: draft.date,
          openingCash: draft.openingCash,
          countedCash: draft.countedCash,
          income: totals.income,
          expense: totals.expense,
        });
        const tone = summary.status === 'balanced' ? 'ok' : summary.status === 'surplus' ? 'under-target' : 'loss';
        resultBox.appendChild(h('div', { class: 'stack tight' },
          h('div', { class: 'kv-list' },
            kv('Gün başı devir', formatMoney(summary.openingCash)),
            kv('Sistem geliri', formatMoney(summary.income)),
            kv('Sistem gideri', formatMoney(summary.expense)),
            kv('Beklenen kasa', formatMoney(summary.expectedCash)),
            kv('Sayılan kasa', formatMoney(summary.countedCash))),
          h('div', { class: `verdict verdict-${tone} cash-result` },
            h('strong', {}, `${summary.status === 'balanced' ? '✔' : summary.status === 'surplus' ? '▲' : '⛔'} ${summary.statusLabel}`),
            h('span', { class: 'small' }, `Fark: ${formatMoney(summary.difference)}`))));
      };
      renderResult();

      return h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
        errorBox,
        h('div', { class: 'grid-2' },
          field('Tarih *', h('input', {
            type: 'date', value: draft.date,
            onInput: (e) => { draft.date = e.target.value; renderResult(); },
          })),
          field('Gün Başı Devir', h('input', {
            type: 'number', min: '0', step: 'any', value: draft.openingCash,
            onInput: (e) => { draft.openingCash = Number(e.target.value); renderResult(); },
          })),
          field('Sayılan (Fiili) Kasa *', h('input', {
            type: 'number', min: '0', step: 'any', value: draft.countedCash, class: 'counted-cash', autofocus: true,
            onInput: (e) => { draft.countedCash = Number(e.target.value); renderResult(); },
          }))),
        resultBox,
        field('Açıklama', h('input', { type: 'text', value: draft.note, onInput: (e) => { draft.note = e.target.value; } })),
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'submit',
            onClick: async () => {
              clear(errorBox).classList.add('hidden');
              try {
                await app.store.saveCashDay(draft);
                toast('Gün sonu kaydedildi.');
                close();
                app.refresh();
              } catch (err) {
                clear(errorBox).appendChild(errorList(err.errors ?? [err.message]));
                errorBox.classList.remove('hidden');
              }
            },
          }, 'Gün Sonunu Kaydet')));
    },
  });
}

const kv = (label, value) => h('div', { class: 'kv' }, h('span', {}, label), h('strong', {}, value));
