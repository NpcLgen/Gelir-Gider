/**
 * Yabancı Çalışanlar (PRD v2 §3.1).
 * Maaşlar gidere ve kârlılığa dahil edilir; vergi matrahında indirilebilir gider
 * olarak sayılıp sayılmayacağı Ayarlar'dan yönetilen bir parametredir.
 */

import { defaultTaxRates } from '../core/finance.js';
import { formatDate, formatMoney } from '../core/format.js';
import { clear, confirmDialog, errorList, field, h, openModal, toast } from './dom.js';

export function foreignWorkersView(app) {
  const state = app.store.getState();
  const month = app.period().from.slice(0, 7);
  const rates = { ...defaultTaxRates(), ...(state.settings.tax ?? {}) };
  const deductible = rates.foreignStaffDeductible === true;

  const rows = state.foreignWorkers.filter((w) => w.period === month);
  const total = rows.filter((w) => w.active !== false).reduce((sum, w) => sum + w.amount, 0);

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Yabancı Çalışanlar'),
        h('p', { class: 'muted' }, `${month} dönemi · maaşlar gidere dahildir, vergi matrahında ayrı değerlendirilir.`)),
      h('button', { class: 'btn primary', type: 'button', onClick: () => openForm(app, null) }, '＋ Çalışan Ekle')),

    h('div', { class: 'kpi-grid' },
      h('div', { class: 'card kpi' },
        h('span', { class: 'muted small' }, 'Dönem Toplam Maaş'),
        h('strong', {}, formatMoney(total)),
        h('span', { class: 'muted small' }, `${rows.length} çalışan`)),
      h('div', { class: 'card kpi' },
        h('span', { class: 'muted small' }, 'Vergi Matrahı Durumu'),
        h('strong', { class: deductible ? '' : 'bad' }, deductible ? 'İndirilebilir' : 'İndirilemez'),
        h('span', { class: 'muted small' }, 'Ayarlar → Vergi ve Finans'))),

    h('div', { class: 'card table-card', dataset: { print: 'giderler' } },
      h('table', {},
        h('thead', {}, h('tr', {}, ...['Çalışan', 'Maaş', 'Ödeme Tarihi', 'Açıklama', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...(rows.length
          ? rows.map((worker) => h('tr', { class: worker.active === false ? 'passive-row' : '' },
            h('td', {}, h('strong', {}, worker.name)),
            h('td', { class: 'num' }, formatMoney(worker.amount)),
            h('td', {}, worker.paymentDate ? formatDate(worker.paymentDate) : h('span', { class: 'muted' }, '—')),
            h('td', {}, worker.note || h('span', { class: 'muted' }, '—')),
            h('td', {}, h('div', { class: 'row gap' },
              h('button', { class: 'icon-btn', type: 'button', title: 'Düzenle', onClick: () => openForm(app, worker) }, '✏️'),
              h('button', {
                class: 'icon-btn', type: 'button', title: 'Sil',
                onClick: () => confirmDialog(`${worker.name} kaydı silinsin mi?`, async () => {
                  await app.store.deleteForeignWorker(worker.id);
                  app.refresh();
                  toast('Kayıt silindi.', 'warn');
                }),
              }, '🗑️')))))
          : [h('tr', {}, h('td', { colspan: '5', class: 'empty' }, `${month} dönemi için kayıt yok.`))])))),

    h('div', { class: 'card' },
      h('h4', {}, 'Vergi Matrahı Kuralı'),
      h('p', { class: 'muted small' }, deductible
        ? 'Şu an yabancı çalışan maaşları indirilebilir gider sayılıyor; vergi matrahından düşülüyor.'
        : 'Yabancı çalışan maaşları gider toplamına ve kârlılık raporuna dahil edilir, ancak vergi matrahından ' +
          'indirilebilir gider olarak düşülmez. Bu ayrım Ayarlar → Vergi ve Finans bölümünden değiştirilebilir.'),
      h('p', { class: 'muted small' },
        'Not: Uygulamanın mevzuata uygunluğu mali müşaviriniz tarafından teyit edilmelidir.')));
}

export function openForm(app, source) {
  const month = app.period().from.slice(0, 7);
  const draft = {
    id: source?.id,
    name: source?.name ?? '',
    period: source?.period ?? month,
    amount: source?.amount ?? 0,
    paymentDate: source?.paymentDate ?? '',
    note: source?.note ?? '',
    active: source?.active !== false,
  };

  openModal({
    title: source ? 'Yabancı Çalışanı Düzenle' : 'Yeni Yabancı Çalışan',
    subtitle: 'Maaş gidere dahil edilir; vergi matrahındaki durumu ayarlardan yönetilir.',
    size: 'sm',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      return h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
        errorBox,
        field('Çalışan Adı *', h('input', {
          type: 'text', value: draft.name, class: 'fw-name', autofocus: true,
          onInput: (e) => { draft.name = e.target.value; },
        })),
        h('div', { class: 'grid-2' },
          field('Dönem *', h('input', {
            type: 'month', value: draft.period, onInput: (e) => { draft.period = e.target.value; },
          })),
          field('Maaş Tutarı *', h('input', {
            type: 'number', min: '0', step: 'any', value: draft.amount, class: 'fw-amount',
            onInput: (e) => { draft.amount = Number(e.target.value); },
          })),
          field('Ödeme Tarihi', h('input', {
            type: 'date', value: draft.paymentDate, onInput: (e) => { draft.paymentDate = e.target.value; },
          }))),
        field('Açıklama', h('input', {
          type: 'text', value: draft.note, onInput: (e) => { draft.note = e.target.value; },
        })),
        h('label', { class: 'check-inline' },
          h('input', {
            type: 'checkbox', checked: draft.active,
            onChange: (e) => { draft.active = e.target.checked; },
          }), 'Aktif'),
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'submit',
            onClick: async () => {
              clear(errorBox).classList.add('hidden');
              try {
                await app.store.saveForeignWorker(draft);
                toast('Çalışan kaydedildi.');
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
