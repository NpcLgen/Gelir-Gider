/** Ekstra Çalışan — günübirlik/geçici personel ödemeleri (PRD §3.3). */

import { formatDate, formatMoney } from '../core/format.js';
import { clear, confirmDialog, errorList, field, h, openModal, toast } from './dom.js';

export function extraWorkersView(app) {
  const { extraWorkers } = app.store.getState();
  const p = app.period();
  const ofPeriod = extraWorkers.filter((w) => w.date >= p.from && w.date <= p.to);
  const total = ofPeriod.filter((w) => w.active !== false).reduce((sum, w) => sum + w.amount, 0);

  const rows = ofPeriod.map((worker) => h('tr', { class: worker.active === false ? 'passive-row' : '' },
    h('td', {}, formatDate(worker.date)),
    h('td', {}, h('strong', {}, worker.name)),
    h('td', { class: 'num' }, formatMoney(worker.amount)),
    h('td', {}, worker.note || h('span', { class: 'muted' }, '—')),
    h('td', {}, h('div', { class: 'row gap' },
      h('button', { class: 'icon-btn', type: 'button', title: 'Düzenle', onClick: () => openExtraWorkerForm(app, worker) }, '✏️'),
      h('button', {
        class: 'icon-btn', type: 'button', title: 'Sil',
        onClick: () => confirmDialog(`${worker.name} ödemesi silinsin mi?`, async () => {
          await app.store.deleteExtraWorker(worker.id);
          app.refresh();
          toast('Kayıt silindi.', 'warn');
        }),
      }, '🗑️')))));

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Ekstra Çalışan'),
        h('p', { class: 'muted' }, 'Günübirlik ve geçici çalışan ödemeleri — yalnızca girildiği döneme yansır.')),
      h('button', { class: 'btn primary', type: 'button', onClick: () => openExtraWorkerForm(app, null) }, '＋ Ödeme Ekle')),

    h('div', { class: 'kpi-grid' },
      h('div', { class: 'card kpi' },
        h('span', { class: 'muted small' }, 'Dönem Toplamı'),
        h('strong', {}, formatMoney(total)),
        h('span', { class: 'muted small' }, `${ofPeriod.length} ödeme · ${p.from} → ${p.to}`))),

    h('div', { class: 'card table-card' },
      h('table', {},
        h('thead', {}, h('tr', {}, ...['Tarih', 'Çalışan / Açıklama', 'Tutar', 'Not', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...(rows.length
          ? rows
          : [h('tr', {}, h('td', { colspan: '5', class: 'empty' }, 'Bu dönemde ekstra çalışan ödemesi yok.'))])))));
}

export function openExtraWorkerForm(app, source) {
  const draft = {
    id: source?.id,
    name: source?.name ?? '',
    date: source?.date ?? new Date().toISOString().slice(0, 10),
    amount: source?.amount ?? 0,
    note: source?.note ?? '',
    active: source?.active !== false,
  };

  openModal({
    title: source ? 'Ödemeyi Düzenle' : 'Ekstra Çalışan Ödemesi',
    size: 'sm',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      return h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
        errorBox,
        field('Çalışan Adı / Açıklama *', h('input', {
          type: 'text', value: draft.name, autofocus: true, class: 'extra-name',
          onInput: (e) => { draft.name = e.target.value; },
        })),
        h('div', { class: 'grid-2' },
          field('Çalışma Tarihi *', h('input', {
            type: 'date', value: draft.date, onInput: (e) => { draft.date = e.target.value; },
          })),
          field('Yevmiye / Tutar *', h('input', {
            type: 'number', min: '0', step: 'any', value: draft.amount, class: 'extra-amount',
            onInput: (e) => { draft.amount = Number(e.target.value); },
          }))),
        field('Açıklama', h('input', {
          type: 'text', value: draft.note, onInput: (e) => { draft.note = e.target.value; },
        })),
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'submit',
            onClick: async () => {
              clear(errorBox).classList.add('hidden');
              try {
                await app.store.saveExtraWorker(draft);
                toast('Ödeme kaydedildi.');
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
