/**
 * Gelen / giden fatura sayfaları.
 *
 * Gelir ve gider bölümleri birebir aynı düzeni kullanır: tek fark, gelen
 * faturaların gidere, giden faturaların gelire yazılmasıdır. Sayfa düzeni
 * e-fatura portalının Excel çıktısındaki yedi sütunu temel alır:
 * Müşteri · Fatura Tarihi · Fatura No · Tutar · Para Birimi ·
 * Vergiler Hariç Toplam Tutar · Vergiler Dahil Toplam Tutar
 */

import { api } from '../core/api.js';
import { CURRENCIES } from '../core/catalog.js';
import { invoiceAmount, invoiceKdv, invoiceSummary } from '../core/finance.js';
import { rateFor } from '../core/fx.js';
import { formatDate, formatMoney } from '../core/format.js';
import { clear, confirmDialog, errorList, field, h, openModal, select, toast } from './dom.js';
import { importResult, importToast } from './excelView.js';

/** İki sayfanın yalnızca etiket ve depo adlarıyla ayrıştığı tanım. */
const KINDS = {
  gelen: {
    title: 'Gider Faturaları',
    lead: 'e-Fatura portalından gelen (alış) faturalar. Tutarlar gider toplamına ve kârlılık raporuna girer.',
    collection: 'purchaseInvoices',
    templateKind: 'gelenFatura',
    save: 'savePurchaseInvoice',
    remove: 'deletePurchaseInvoice',
    tone: 'bad',
    totalLabel: 'Dönem Gider Faturası',
    customerLabel: 'Tedarikçi / Müşteri',
    note: 'Gelen faturalar Giderler özetine ve genel kârlılık hesabına dahil edilir. '
      + 'Aynı gideri hem genel harcama hem fatura olarak girdiyseniz birini pasife alın.',
    empty: 'Bu dönemde gelen fatura yok. Excel’den içe aktarabilirsiniz.',
  },
  giden: {
    title: 'Gelirler',
    lead: 'e-Fatura portalına giden (satış) faturalar. Tutarlar gelir toplamına ve kârlılık raporuna girer.',
    collection: 'salesInvoices',
    templateKind: 'gidenFatura',
    save: 'saveSalesInvoice',
    remove: 'deleteSalesInvoice',
    tone: 'good',
    totalLabel: 'Dönem Gelir Faturası',
    customerLabel: 'Müşteri',
    note: 'Giden faturalar Dashboard gelir toplamına eklenir. Aynı satışı hem rezervasyon hem fatura '
      + 'olarak girdiyseniz mükerrer sayılmaması için fatura kaydını pasife alın.',
    empty: 'Bu dönemde giden fatura yok. Excel’den içe aktarabilirsiniz.',
  },
};

/** Sayfa durumu (içe aktarım sonucu ve arama) tür bazında saklanır. */
const pageState = { gelen: { search: '', lastResult: null }, giden: { search: '', lastResult: null } };

export const purchaseInvoiceView = (app) => invoiceView(app, 'gelen');
export const salesInvoiceView = (app) => invoiceView(app, 'giden');

function invoiceView(app, direction) {
  const kind = KINDS[direction];
  const state = app.store.getState();
  const local = pageState[direction];
  const p = app.period();
  const fx = state.settings.fx;

  const all = state[kind.collection] ?? [];
  const query = local.search.trim().toLocaleLowerCase('tr');
  const rows = all
    .filter((i) => i.date >= p.from && i.date <= p.to)
    .filter((i) => !query
      || i.customer.toLocaleLowerCase('tr').includes(query)
      || i.invoiceNo.toLocaleLowerCase('tr').includes(query));

  const summary = invoiceSummary(rows, { rateFor: (date) => rateFor(fx, date) });
  const passive = rows.filter((i) => i.active === false).length;

  const resultBox = h('div', {});
  const renderResult = () => {
    clear(resultBox);
    if (local.lastResult) resultBox.appendChild(importResult(local.lastResult));
  };
  renderResult();

  /** Excel yükler; dryRun ise yalnızca kontrol eder. */
  const upload = async (file, dryRun) => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      local.lastResult = await api.postRaw('/api/excel/import', buffer,
        { kind: kind.templateKind, dryRun: dryRun ? '1' : '0' });
      renderResult();
      if (dryRun) {
        toast(`Ön kontrol: ${importToast(local.lastResult, 'fatura')}`,
          local.lastResult.invalidCount || local.lastResult.conflictCount ? 'warn' : 'ok');
      } else {
        await app.store.reload();
        toast(importToast(local.lastResult, 'fatura'), local.lastResult.imported ? 'ok' : 'warn');
        app.refresh();
      }
    } catch (err) {
      local.lastResult = { error: err.message, ...(err.payload ?? {}) };
      renderResult();
      toast(err.message, 'error');
    }
  };

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, kind.title),
        h('p', { class: 'muted' }, kind.lead)),
      h('div', { class: 'row gap wrap' },
        h('button', {
          class: 'btn small help-btn', type: 'button', title: 'Örnek şablonu indir',
          onClick: async () => {
            try {
              const name = await api.download('/api/excel/template',
                { kind: kind.templateKind }, `ornek-sablon-${kind.templateKind}.xlsx`);
              toast(`${name} indirildi.`);
            } catch (err) { toast(err.message, 'error'); }
          },
        }, '❓ Örnek Şablon'),
        app.can('excelIceAktarim') ? h('label', { class: 'btn file-btn' }, '📂 Excel Kontrol Et',
          h('input', {
            type: 'file', accept: '.xlsx', hidden: true, class: 'invoice-dry',
            onChange: (e) => upload(e.target.files?.[0], true),
          })) : null,
        app.can('excelIceAktarim') ? h('label', { class: 'btn file-btn' }, '⬆️ Excel’den Aktar',
          h('input', {
            type: 'file', accept: '.xlsx', hidden: true, class: 'invoice-import',
            onChange: (e) => upload(e.target.files?.[0], false),
          })) : null,
        h('button', {
          class: 'btn primary', type: 'button', onClick: () => openInvoiceForm(app, direction, null),
        }, '＋ Fatura Ekle'))),

    h('div', { class: 'kpi-grid' },
      h('div', { class: 'card kpi' },
        h('span', { class: 'muted small' }, kind.totalLabel),
        h('strong', { class: kind.tone }, formatMoney(summary.gross)),
        h('span', { class: 'muted small' }, `${summary.count} fatura${passive ? ` · ${passive} pasif` : ''}`)),
      h('div', { class: 'card kpi' },
        h('span', { class: 'muted small' }, 'Vergiler Hariç Toplam'),
        h('strong', {}, formatMoney(summary.net)),
        h('span', { class: 'muted small' }, 'KDV matrahı')),
      h('div', { class: 'card kpi' },
        h('span', { class: 'muted small' }, 'Fatura KDV’si'),
        h('strong', {}, formatMoney(summary.kdv)),
        h('span', { class: 'muted small' }, 'Dahil − hariç farkı')),
      h('div', { class: 'card kpi' },
        h('span', { class: 'muted small' }, 'Para Birimi Dağılımı'),
        h('strong', {}, summary.byCurrency.length
          ? summary.byCurrency.map(([c, v]) => `${c} ${formatMoney(v).replace(/[^\d.,]/g, '')}`).join(' · ')
          : '—'),
        h('span', { class: 'muted small' }, 'Kaydedildiği para biriminde'))),

    h('div', { class: 'card filter-bar' },
      h('input', {
        type: 'search', class: 'invoice-search', value: local.search,
        placeholder: 'Müşteri veya fatura no ara…',
        onInput: (e) => { local.search = e.target.value; app.refresh(); },
      })),

    resultBox,

    h('div', { class: 'card table-card', dataset: { print: 'faturalar' } },
      h('header', { class: 'card-header' },
        h('h3', {}, `${kind.title} · ${formatDate(p.from)} → ${formatDate(p.to)}`),
        h('span', { class: 'muted small' }, 'En yeni fatura üstte')),
      h('table', {},
        h('thead', {}, h('tr', {}, ...[
          kind.customerLabel, 'Fatura Tarihi', 'Fatura No', 'Tutar', 'Para Birimi',
          'Vergiler Hariç', 'Vergiler Dahil', '',
        ].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...(rows.length
          ? rows.map((invoice) => h('tr', { class: invoice.active === false ? 'passive-row' : '' },
            h('td', {}, invoice.customer),
            h('td', {}, formatDate(invoice.date)),
            h('td', { class: 'muted small' }, invoice.invoiceNo),
            h('td', { class: 'num' }, formatMoney(invoice.amount, invoice.currency)),
            h('td', { class: 'muted small' }, invoice.currency),
            h('td', { class: 'num' }, formatMoney(invoice.netAmount, invoice.currency)),
            h('td', { class: 'num' },
              h('strong', {}, formatMoney(invoice.grossAmount, invoice.currency)),
              invoiceKdv(invoice) > 0
                ? h('div', { class: 'muted micro' }, `KDV ${formatMoney(invoiceKdv(invoice), invoice.currency)}`)
                : null),
            h('td', {}, h('div', { class: 'row gap' },
              h('button', {
                class: 'icon-btn', type: 'button', title: 'Düzenle',
                onClick: () => openInvoiceForm(app, direction, invoice),
              }, '✏️'),
              h('button', {
                class: 'icon-btn', type: 'button', title: 'Sil',
                onClick: () => confirmDialog(`${invoice.invoiceNo} numaralı fatura silinsin mi?`, async () => {
                  await app.store[kind.remove](invoice.id);
                  app.refresh();
                  toast('Fatura silindi.', 'warn');
                }),
              }, '🗑️')))))
          : [h('tr', {}, h('td', { colspan: '8', class: 'empty' }, kind.empty))])))),

    h('p', { class: 'muted small' }, kind.note));
}

export function openInvoiceForm(app, direction, source) {
  const kind = KINDS[direction];
  const draft = {
    id: source?.id,
    customer: source?.customer ?? '',
    date: source?.date ?? new Date().toISOString().slice(0, 10),
    invoiceNo: source?.invoiceNo ?? '',
    amount: source?.amount ?? 0,
    currency: source?.currency ?? 'TRY',
    netAmount: source?.netAmount ?? 0,
    grossAmount: source?.grossAmount ?? 0,
    note: source?.note ?? '',
    active: source?.active !== false,
  };

  openModal({
    title: source ? 'Faturayı Düzenle' : `${kind.title} — Yeni Fatura`,
    subtitle: 'Alanlar e-fatura portalı sütunlarıyla aynıdır.',
    size: 'md',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      return h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
        errorBox,
        field(`${kind.customerLabel} *`, h('input', {
          type: 'text', value: draft.customer, class: 'inv-customer', autofocus: true,
          onInput: (e) => { draft.customer = e.target.value; },
        })),
        h('div', { class: 'grid-2' },
          field('Fatura Tarihi *', h('input', {
            type: 'date', value: draft.date, class: 'inv-date',
            onInput: (e) => { draft.date = e.target.value; },
          })),
          field('Fatura No *', h('input', {
            type: 'text', value: draft.invoiceNo, class: 'inv-no',
            onInput: (e) => { draft.invoiceNo = e.target.value; },
          }))),
        h('div', { class: 'grid-3' },
          field('Tutar', h('input', {
            type: 'number', min: '0', step: 'any', value: draft.amount, class: 'inv-amount',
            onInput: (e) => { draft.amount = Number(e.target.value); },
          })),
          field('Para Birimi', select({ class: 'inv-currency', onChange: (e) => { draft.currency = e.target.value; } },
            CURRENCIES.map((c) => ({ value: c.key, label: `${c.symbol} ${c.key}` })), draft.currency)),
          field('Vergiler Hariç Toplam', h('input', {
            type: 'number', min: '0', step: 'any', value: draft.netAmount, class: 'inv-net',
            onInput: (e) => { draft.netAmount = Number(e.target.value); },
          }))),
        field('Vergiler Dahil Toplam *', h('input', {
          type: 'number', min: '0', step: 'any', value: draft.grossAmount, class: 'inv-gross',
          onInput: (e) => { draft.grossAmount = Number(e.target.value); },
        }), 'Hesaplamalarda bu tutar kullanılır; KDV = dahil − hariç.'),
        field('Açıklama', h('input', {
          type: 'text', value: draft.note, class: 'inv-note',
          onInput: (e) => { draft.note = e.target.value; },
        })),
        h('label', { class: 'check-inline' },
          h('input', {
            type: 'checkbox', checked: draft.active,
            onChange: (e) => { draft.active = e.target.checked; },
          }), 'Aktif (pasif fatura toplamlara girmez)'),
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'submit',
            onClick: async () => {
              clear(errorBox).classList.add('hidden');
              try {
                await app.store[kind.save](draft);
                toast('Fatura kaydedildi.');
                close();
                app.refresh();
              } catch (err) {
                clear(errorBox).appendChild(errorList(err.errors ?? [err.message]));
                errorBox.classList.remove('hidden');
              }
            },
          }, '💾 Kaydet')));
    },
  });
}

export { invoiceAmount };
