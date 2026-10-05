/**
 * İşlenen Faturalar (PRD III §1).
 *
 * Excel'den içe aktarılan gelir ve gider faturaları, taslak beklemeden doğrudan
 * veritabanına yazılır. Bu sayfa, hangi yüklemeden hangi faturaların işlendiğini
 * tek tabloda gösterir.
 */

import { invoiceAmount, invoiceKdv } from '../core/finance.js';
import { formatDate, formatMoney } from '../core/format.js';
import { h, select } from './dom.js';

const state = { search: '', direction: 'hepsi', batch: 'hepsi' };

/** Toplu iş numarasını okunur zaman damgasına çevirir. */
const batchLabel = (invoice) => (invoice.importedAt
  ? new Date(invoice.importedAt).toLocaleString('tr-TR')
  : '—');

export function processedInvoicesView(app) {
  const store = app.store.getState();
  const p = app.period();

  const all = [
    ...(app.can('gelirler') ? (store.salesInvoices ?? []).map((i) => ({ ...i, yon: 'gelir' })) : []),
    ...(app.can('giderFaturalari') ? (store.purchaseInvoices ?? []).map((i) => ({ ...i, yon: 'gider' })) : []),
  ].filter((i) => i.importedAt);

  const batches = [...new Set(all.map((i) => i.importBatch).filter(Boolean))].sort().reverse();

  const query = state.search.trim().toLocaleLowerCase('tr');
  const rows = all
    .filter((i) => i.date >= p.from && i.date <= p.to)
    .filter((i) => state.direction === 'hepsi' || i.yon === state.direction)
    .filter((i) => state.batch === 'hepsi' || i.importBatch === state.batch)
    .filter((i) => !query
      || i.customer.toLocaleLowerCase('tr').includes(query)
      || i.invoiceNo.toLocaleLowerCase('tr').includes(query))
    .sort((a, b) => (b.importedAt ?? '').localeCompare(a.importedAt ?? '')
      || b.date.localeCompare(a.date));

  const totals = rows.reduce((acc, invoice) => {
    const amount = invoiceAmount(invoice);
    if (invoice.yon === 'gelir') acc.gelir += amount;
    else acc.gider += amount;
    acc.kdv += invoiceKdv(invoice);
    return acc;
  }, { gelir: 0, gider: 0, kdv: 0 });

  return h('div', { class: 'stack' },
    h('div', {},
      h('h1', {}, 'İşlenen Faturalar'),
      h('p', { class: 'muted' },
        'Excel’den içe aktarılan faturalar taslak beklemeden doğrudan kaydedilir; '
        + 'bu liste hangi yüklemede hangi faturanın işlendiğini gösterir.')),

    h('div', { class: 'kpi-grid' },
      h('div', { class: 'card kpi' },
        h('span', { class: 'muted small' }, 'İşlenen Fatura'),
        h('strong', {}, String(rows.length)),
        h('span', { class: 'muted small' }, `${batches.length} yükleme`)),
      h('div', { class: 'card kpi' },
        h('span', { class: 'muted small' }, 'Gelir Faturaları'),
        h('strong', { class: 'good' }, formatMoney(totals.gelir)),
        h('span', { class: 'muted small' }, `${rows.filter((r) => r.yon === 'gelir').length} fatura`)),
      h('div', { class: 'card kpi' },
        h('span', { class: 'muted small' }, 'Gider Faturaları'),
        h('strong', { class: 'bad' }, formatMoney(totals.gider)),
        h('span', { class: 'muted small' }, `${rows.filter((r) => r.yon === 'gider').length} fatura`)),
      h('div', { class: 'card kpi' },
        h('span', { class: 'muted small' }, 'Toplam Fatura KDV’si'),
        h('strong', {}, formatMoney(totals.kdv)),
        h('span', { class: 'muted small' }, 'Dahil − hariç farkı'))),

    h('div', { class: 'card filter-bar row gap wrap center' },
      h('input', {
        type: 'search', class: 'processed-search', value: state.search,
        placeholder: 'Müşteri veya fatura no ara…',
        onInput: (e) => { state.search = e.target.value; app.refresh(); },
      }),
      select({ class: 'processed-direction', onChange: (e) => { state.direction = e.target.value; app.refresh(); } },
        [
          { value: 'hepsi', label: 'Tümü (gelir + gider)' },
          { value: 'gelir', label: 'Yalnızca gelir faturaları' },
          { value: 'gider', label: 'Yalnızca gider faturaları' },
        ], state.direction),
      select({ class: 'processed-batch', onChange: (e) => { state.batch = e.target.value; app.refresh(); } },
        [
          { value: 'hepsi', label: 'Tüm yüklemeler' },
          ...batches.map((batch) => ({
            value: batch,
            label: batchLabel(all.find((i) => i.importBatch === batch)),
          })),
        ], state.batch)),

    h('div', { class: 'card table-card', dataset: { print: 'faturalar' } },
      h('header', { class: 'card-header' },
        h('h3', {}, `İşlenen Faturalar · ${formatDate(p.from)} → ${formatDate(p.to)}`),
        h('span', { class: 'muted small' }, 'En son işlenen üstte')),
      h('table', { class: 'table-dividers' },
        h('thead', {}, h('tr', {}, ...[
          'İşlenme Zamanı', 'Yön', 'Müşteri', 'Fatura Tarihi', 'Fatura No',
          'Para Birimi', 'Vergiler Hariç', 'Vergiler Dahil', 'KDV', 'Durum',
        ].map((t, i) => h('th', { class: i >= 6 && i <= 8 ? 'num' : '' }, t)))),
        h('tbody', {}, ...(rows.length
          ? rows.map((invoice) => h('tr', { class: invoice.active === false ? 'passive-row' : '' },
            h('td', { class: 'muted small' }, batchLabel(invoice)),
            h('td', {}, invoice.yon === 'gelir'
              ? h('span', { class: 'badge badge-ok' }, '▲ Gelir')
              : h('span', { class: 'badge badge-warn' }, '▼ Gider')),
            h('td', {}, invoice.customer),
            h('td', {}, formatDate(invoice.date)),
            h('td', { class: 'muted small' }, invoice.invoiceNo),
            h('td', { class: 'muted small' }, invoice.currency),
            h('td', { class: 'num' }, formatMoney(invoice.netAmount, invoice.currency)),
            h('td', { class: 'num' }, h('strong', {}, formatMoney(invoice.grossAmount, invoice.currency))),
            h('td', { class: 'num' }, formatMoney(invoiceKdv(invoice), invoice.currency)),
            h('td', { class: 'small' }, invoice.active === false
              ? h('span', { class: 'muted' }, 'Pasif')
              : h('span', { class: 'good' }, '✔ İşlendi'))))
          : [h('tr', {}, h('td', { colspan: '10', class: 'empty' },
            all.length
              ? 'Bu dönemde ve filtrede işlenen fatura yok.'
              : 'Henüz Excel’den fatura aktarılmadı. Gelirler veya Gider Faturaları sayfasından yükleyebilirsiniz.'))])))),

    h('p', { class: 'muted small' },
      'Elle girilen faturalar bu listede yer almaz; yalnızca Excel’den işlenen kayıtlar gösterilir. '
      + 'Hatalı satırlar yükleme ekranında satır numarasıyla birlikte raporlanır.'));
}
