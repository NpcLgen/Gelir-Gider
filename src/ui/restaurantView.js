/**
 * Restoran Gelirleri — gün sonu kayıtları (PRD v2 §2.1, §2.3).
 * Bir güne en fazla iki gün sonu girilir; aynı günün kayıtları toplanır.
 */

import { MAX_DAY_END_PER_DAY, defaultTaxRates, restaurantDayTotal, restaurantIncomeSummary } from '../core/finance.js';
import { eachDate } from '../core/dates.js';
import { formatDate, formatMoney } from '../core/format.js';
import { clear, confirmDialog, errorList, field, h, openModal, select, toast } from './dom.js';

export function restaurantIncomeView(app) {
  const state = app.store.getState();
  const p = app.period();
  const rates = { ...defaultTaxRates(), ...(state.settings.tax ?? {}) };
  const kdvRate = rates.kdvRestaurant ?? 10;

  const summary = restaurantIncomeSummary(state.restaurantIncomes, { from: p.from, to: p.to, kdvRate });
  const günler = [...new Set(state.restaurantIncomes
    .filter((i) => i.date >= p.from && i.date <= p.to)
    .map((i) => i.date))].sort((a, b) => b.localeCompare(a));

  const rows = günler.map((date) => {
    const day = restaurantDayTotal(date, state.restaurantIncomes);
    const iptaller = state.restaurantIncomes.filter((i) => i.date === date && i.active === false);
    return h('tr', {},
      h('td', {}, h('strong', {}, formatDate(date))),
      ...[1, 2].map((seq) => {
        const entry = day.entries.find((e) => e.sequence === seq);
        return h('td', { class: 'num' }, entry
          ? h('span', { class: 'row gap center end' },
            formatMoney(entry.amount),
            h('button', {
              class: 'icon-btn', type: 'button', title: 'Düzenle',
              onClick: () => openIncomeForm(app, entry),
            }, '✏️'))
          : h('button', {
            class: 'btn small ghost', type: 'button',
            onClick: () => openIncomeForm(app, null, { date, sequence: seq }),
          }, `＋ ${seq}. gün sonu`));
      }),
      h('td', { class: 'num' }, h('strong', {}, formatMoney(day.total))),
      h('td', { class: 'num muted' }, formatMoney((day.total * kdvRate) / (100 + kdvRate))),
      h('td', { class: 'muted small' },
        day.entries.map((e) => e.note).filter(Boolean).join(' · ')
        || (iptaller.length ? `${iptaller.length} iptal kayıt` : '—')));
  });

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Restoran Gelirleri'),
        h('p', { class: 'muted' },
          `Gün sonu kayıtları · bir güne en fazla ${MAX_DAY_END_PER_DAY} kayıt · KDV oranı %${kdvRate}`)),
      h('button', {
        class: 'btn primary', type: 'button',
        onClick: () => openIncomeForm(app, null),
      }, '＋ Gün Sonu Ekle')),

    h('div', { class: 'kpi-grid' },
      kpi('Dönem Restoran Geliri', formatMoney(summary.gross), `${summary.count} gün sonu · ${summary.days} gün`),
      kpi('KDV Tutarı', formatMoney(summary.kdv), `%${kdvRate} oranla`),
      kpi('KDV Hariç Net Gelir', formatMoney(summary.net), 'Kârlılık hesabına giren tutar'),
      kpi('Günlük Ortalama', formatMoney(summary.days ? summary.gross / summary.days : 0), 'Kayıt olan günlerde')),

    h('div', { class: 'card table-card', dataset: { print: 'gelirler' } },
      h('header', { class: 'card-header' },
        h('h3', {}, 'Günlük Gün Sonu Kayıtları'),
        h('span', { class: 'muted small' }, 'Aynı günün kayıtları otomatik toplanır')),
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Tarih'), h('th', { class: 'num' }, '1. Gün Sonu'), h('th', { class: 'num' }, '2. Gün Sonu'),
          h('th', { class: 'num' }, 'Günlük Toplam'), h('th', { class: 'num' }, 'KDV'), h('th', {}, 'Açıklama'))),
        h('tbody', {}, ...(rows.length
          ? rows
          : [h('tr', {}, h('td', { colspan: '6', class: 'empty' }, 'Bu dönemde restoran gelir kaydı yok.'))])))),

    h('p', { class: 'muted small' },
      'Restoran gelirleri genel gelir toplamına ve Dashboard hesaplarına otomatik dahil edilir; ' +
      'otel konaklama gelirinden ayrı raporlanır.'));
}

function kpi(label, value, hint) {
  return h('div', { class: 'card kpi' },
    h('span', { class: 'muted small' }, label),
    h('strong', {}, value),
    h('span', { class: 'muted small' }, hint));
}

export function openIncomeForm(app, source, preset = {}) {
  const state = app.store.getState();
  const today = new Date().toISOString().slice(0, 10);
  const date = source?.date ?? preset.date ?? today;

  // Boş olan ilk sıra numarası önerilir.
  const used = state.restaurantIncomes
    .filter((i) => i.date === date && i.active !== false && i.id !== source?.id)
    .map((i) => i.sequence);
  const suggested = preset.sequence ?? [1, 2].find((n) => !used.includes(n)) ?? 1;

  const draft = {
    id: source?.id,
    date,
    sequence: source?.sequence ?? suggested,
    amount: source?.amount ?? 0,
    kdvIncluded: source?.kdvIncluded !== false,
    note: source?.note ?? '',
    active: source?.active !== false,
  };

  openModal({
    title: source ? 'Gün Sonu Kaydını Düzenle' : 'Restoran Gün Sonu Ekle',
    subtitle: `Bir güne en fazla ${MAX_DAY_END_PER_DAY} gün sonu kaydı girilebilir.`,
    size: 'sm',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      const info = h('p', { class: 'muted small' }, '');

      const renderInfo = () => {
        const day = restaurantDayTotal(draft.date, state.restaurantIncomes.filter((i) => i.id !== draft.id));
        const toplam = day.total + Number(draft.amount || 0);
        info.textContent = day.entries.length
          ? `${formatDate(draft.date)} günündeki diğer kayıt: ${formatMoney(day.total)} → günlük toplam ${formatMoney(toplam)}`
          : `${formatDate(draft.date)} için ilk gün sonu kaydı.`;
      };
      renderInfo();

      return h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
        errorBox,
        h('div', { class: 'grid-2' },
          field('Tarih *', h('input', {
            type: 'date', value: draft.date,
            onInput: (e) => { draft.date = e.target.value; renderInfo(); },
          })),
          field('Gün Sonu Sırası *', select({
            class: 'income-sequence',
            onChange: (e) => { draft.sequence = Number(e.target.value); },
          }, [{ value: 1, label: '1. Gün Sonu' }, { value: 2, label: '2. Gün Sonu' }], draft.sequence))),
        field('Gelir Tutarı *', h('input', {
          type: 'number', min: '0', step: 'any', value: draft.amount, class: 'income-amount', autofocus: true,
          onInput: (e) => { draft.amount = Number(e.target.value); renderInfo(); },
        })),
        h('label', { class: 'check-inline' },
          h('input', {
            type: 'checkbox', checked: draft.kdvIncluded,
            onChange: (e) => { draft.kdvIncluded = e.target.checked; },
          }), 'Tutar KDV dahil girildi'),
        info,
        field('Açıklama', h('input', {
          type: 'text', value: draft.note, onInput: (e) => { draft.note = e.target.value; },
        })),
        h('label', { class: 'check-inline' },
          h('input', {
            type: 'checkbox', checked: draft.active,
            onChange: (e) => { draft.active = e.target.checked; },
          }), 'Aktif (iptal edilen kayıt hesaba girmez)'),
        h('div', { class: 'row end gap' },
          source ? h('button', {
            class: 'btn danger ghost', type: 'button',
            onClick: () => confirmDialog('Bu gün sonu kaydı silinsin mi?', async () => {
              await app.store.deleteRestaurantIncome(source.id);
              close();
              app.refresh();
              toast('Kayıt silindi.', 'warn');
            }),
          }, 'Sil') : null,
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'submit',
            onClick: async () => {
              clear(errorBox).classList.add('hidden');
              try {
                await app.store.saveRestaurantIncome(draft);
                toast('Gün sonu kaydedildi.');
                close();
                app.refresh();
              } catch (err) {
                clear(errorBox).appendChild(errorList(err.errors ?? [err.message]));
                errorBox.classList.remove('hidden');
              }
            },
          }, 'Kaydet')));
    },
  });
}
