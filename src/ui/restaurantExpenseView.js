/** Restoran Ekstra Giderler — toptancı carisi dışındaki harcamalar (PRD v2 §2.4). */

import { PAYMENT_METHODS, RESTAURANT_EXPENSE_CATEGORIES } from '../core/finance.js';
import { formatDate, formatMoney } from '../core/format.js';
import { clear, confirmDialog, errorList, field, h, openModal, select, toast } from './dom.js';

export function restaurantExpenseView(app) {
  const { restaurantExpenses } = app.store.getState();
  const p = app.period();
  const rows = restaurantExpenses.filter((e) => e.date >= p.from && e.date <= p.to);
  const total = rows.filter((e) => e.active !== false).reduce((sum, e) => sum + e.amount, 0);

  const byCategory = RESTAURANT_EXPENSE_CATEGORIES
    .map((category) => ({
      category,
      value: rows.filter((e) => e.active !== false && e.category === category)
        .reduce((sum, e) => sum + e.amount, 0),
    }))
    .filter((c) => c.value > 0);

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Restoran Ekstra Giderler'),
        h('p', { class: 'muted' }, 'Toptancı cari hesapları dışında kalan restoran harcamaları.')),
      h('button', { class: 'btn primary', type: 'button', onClick: () => openForm(app, null) }, '＋ Harcama Ekle')),

    h('div', { class: 'kpi-grid' },
      h('div', { class: 'card kpi' },
        h('span', { class: 'muted small' }, 'Dönem Toplamı'),
        h('strong', { class: 'bad' }, formatMoney(total)),
        h('span', { class: 'muted small' }, `${rows.length} harcama`)),
      ...byCategory.slice(0, 3).map((c) => h('div', { class: 'card kpi' },
        h('span', { class: 'muted small' }, c.category),
        h('strong', {}, formatMoney(c.value)),
        h('span', { class: 'muted small' }, total ? `%${((c.value / total) * 100).toFixed(1)} pay` : '—')))),

    h('div', { class: 'card table-card', dataset: { print: 'giderler' } },
      h('table', {},
        h('thead', {}, h('tr', {}, ...['Tarih', 'Kategori', 'Açıklama', 'Ödeme', 'Tutar', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...(rows.length
          ? rows.map((expense) => h('tr', { class: expense.active === false ? 'passive-row' : '' },
            h('td', {}, formatDate(expense.date)),
            h('td', {}, expense.category),
            h('td', {}, expense.note || h('span', { class: 'muted' }, '—')),
            h('td', { class: 'muted small' }, expense.paymentMethod || '—'),
            h('td', { class: 'num' }, formatMoney(expense.amount)),
            h('td', {}, h('div', { class: 'row gap' },
              h('button', { class: 'icon-btn', type: 'button', title: 'Düzenle', onClick: () => openForm(app, expense) }, '✏️'),
              h('button', {
                class: 'icon-btn', type: 'button', title: 'Sil',
                onClick: () => confirmDialog('Bu harcama silinsin mi?', async () => {
                  await app.store.deleteRestaurantExpense(expense.id);
                  app.refresh();
                  toast('Harcama silindi.', 'warn');
                }),
              }, '🗑️')))))
          : [h('tr', {}, h('td', { colspan: '6', class: 'empty' }, 'Bu dönemde restoran ekstra gideri yok.'))])))),

    h('p', { class: 'muted small' },
      'Bu harcamalar restoran giderlerine ve genel kârlılık raporuna dahil edilir; ' +
      'toptancı borç ve bakiye hesaplarını etkilemez.'));
}

export function openForm(app, source) {
  const draft = {
    id: source?.id,
    date: source?.date ?? new Date().toISOString().slice(0, 10),
    category: source?.category ?? RESTAURANT_EXPENSE_CATEGORIES[0],
    amount: source?.amount ?? 0,
    note: source?.note ?? '',
    paymentMethod: source?.paymentMethod ?? '',
    active: source?.active !== false,
  };

  openModal({
    title: source ? 'Harcamayı Düzenle' : 'Restoran Ekstra Harcaması',
    size: 'sm',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      return h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
        errorBox,
        h('div', { class: 'grid-2' },
          field('Tarih *', h('input', {
            type: 'date', value: draft.date, onInput: (e) => { draft.date = e.target.value; },
          })),
          field('Tutar *', h('input', {
            type: 'number', min: '0', step: 'any', value: draft.amount, class: 'rex-amount', autofocus: true,
            onInput: (e) => { draft.amount = Number(e.target.value); },
          }))),
        field('Kategori *', select({ class: 'rex-category', onChange: (e) => { draft.category = e.target.value; } },
          RESTAURANT_EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c })), draft.category)),
        field('Açıklama', h('input', {
          type: 'text', value: draft.note, class: 'rex-note', placeholder: 'Mutfak robotu tamiri',
          onInput: (e) => { draft.note = e.target.value; },
        })),
        field('Ödeme Yöntemi', select({ onChange: (e) => { draft.paymentMethod = e.target.value; } },
          [{ value: '', label: 'Belirtilmedi' }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: m }))],
          draft.paymentMethod)),
        h('label', { class: 'check-inline' },
          h('input', {
            type: 'checkbox', checked: draft.active,
            onChange: (e) => { draft.active = e.target.checked; },
          }), 'Aktif (pasif harcama hesaba girmez)'),
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'submit',
            onClick: async () => {
              clear(errorBox).classList.add('hidden');
              try {
                await app.store.saveRestaurantExpense(draft);
                toast('Harcama kaydedildi.');
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
