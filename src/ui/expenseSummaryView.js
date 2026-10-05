/**
 * Giderler (Tümü) — PRD §3.1 gider ana menüsü, PRD III §2 ile sadeleştirildi.
 *
 * Genel harcamalar, gider faturaları, personel, ekstra/yabancı çalışan ve
 * toptancı faturaları tek listede birleşir. Sayfa grafik veya gösterge paneli
 * içermez: Gelir paneliyle aynı sade veri tablosu düzenini kullanır.
 */

import { expandExpenses } from '../core/costEngine.js';
import { employeeTotal, invoiceAmount } from '../core/finance.js';
import { rateFor } from '../core/fx.js';
import { categoryOf } from '../core/model.js';
import { formatDate, formatMoney } from '../core/format.js';
import { h } from './dom.js';

/** Gider kaynakları — her biri ayrı modül yetkisiyle korunur. */
const SOURCES = [
  { key: 'genel', label: 'Genel Harcamalar', module: 'genelHarcamalar', color: '#3987e5', view: 'giderler' },
  { key: 'personel', label: 'Personel (Maaş + SGK)', module: 'calisanlar', color: '#d95926', view: 'calisanlar' },
  { key: 'ekstra', label: 'Ekstra Çalışan', module: 'ekstraCalisan', color: '#199e70', view: 'ekstra' },
  { key: 'toptanci', label: 'Toptancı Faturaları', module: 'toptancilar', color: '#c98500', view: 'toptancilar' },
  { key: 'restoran', label: 'Restoran Ekstra Giderler', module: 'restoranGider', color: '#d55181', view: 'restoranGider' },
  { key: 'yabanci', label: 'Yabancı Çalışanlar', module: 'yabanciCalisanlar', color: '#9085e9', view: 'yabanci' },
  { key: 'fatura', label: 'Gider Faturaları', module: 'giderFaturalari', color: '#4aa3a3', view: 'giderFaturalari' },
];

/**
 * Dönemdeki tüm gider kalemlerini tek listeye toplar.
 * @returns {{rows: Array, totals: Object, grandTotal: number}}
 */
export function collectExpenses(app) {
  const state = app.store.getState();
  const p = app.period();
  const month = p.from.slice(0, 7);
  const rows = [];

  if (app.can('genelHarcamalar')) {
    for (const expense of expandExpenses(state.expenses, p, state.settings)) {
      rows.push({
        source: 'genel',
        date: expense.date,
        title: expense.description,
        detail: categoryOf(state.settings, expense.category).label,
        extra: expense.vendor,
        amount: expense.amountBase,
        group: expense.group,
        generated: expense.generated,
      });
    }
  }

  if (app.can('calisanlar')) {
    for (const employee of state.employees) {
      if (employee.period !== month || employee.active === false) continue;
      rows.push({
        source: 'personel',
        date: `${employee.period}-01`,
        title: employee.name,
        detail: employee.role || 'Personel',
        extra: `Maaş ${formatMoney(employee.netSalary)} + SGK ${formatMoney(employee.sgk)}`,
        amount: employeeTotal(employee),
        group: 'fixed',
      });
    }
  }

  if (app.can('ekstraCalisan')) {
    for (const worker of state.extraWorkers) {
      if (worker.active === false || worker.date < p.from || worker.date > p.to) continue;
      rows.push({
        source: 'ekstra',
        date: worker.date,
        title: worker.name,
        detail: 'Ekstra çalışan',
        extra: worker.note,
        amount: worker.amount,
        group: 'fixed',
      });
    }
  }

  if (app.can('toptancilar')) {
    for (const txn of state.supplierTxns) {
      if (txn.active === false || txn.type !== 'invoice') continue;
      if (txn.date < p.from || txn.date > p.to) continue;
      const supplier = state.suppliers.find((s) => s.id === txn.supplierId);
      rows.push({
        source: 'toptanci',
        date: txn.date,
        title: supplier?.name ?? 'Toptancı',
        detail: `Fatura ${txn.invoiceNo || ''}`.trim(),
        extra: txn.note,
        amount: txn.amount,
        group: 'operational',
      });
    }
  }

  if (app.can('restoranGider')) {
    for (const expense of state.restaurantExpenses) {
      if (expense.active === false || expense.date < p.from || expense.date > p.to) continue;
      rows.push({
        source: 'restoran',
        date: expense.date,
        title: expense.note || expense.category,
        detail: expense.category,
        extra: expense.paymentMethod,
        amount: expense.amount,
        group: 'operational',
      });
    }
  }

  if (app.can('yabanciCalisanlar')) {
    for (const worker of state.foreignWorkers) {
      if (worker.active === false || worker.period !== month) continue;
      rows.push({
        source: 'yabanci',
        date: worker.paymentDate || `${worker.period}-01`,
        title: worker.name,
        detail: 'Yabancı çalışan maaşı',
        extra: worker.note,
        amount: worker.amount,
        group: 'fixed',
      });
    }
  }

  if (app.can('giderFaturalari')) {
    for (const invoice of state.purchaseInvoices ?? []) {
      if (invoice.active === false || invoice.date < p.from || invoice.date > p.to) continue;
      const rate = rateFor(state.settings.fx, invoice.date);
      const amount = invoice.currency === 'EUR'
        ? invoiceAmount(invoice) * (Number(rate) || 1)
        : invoiceAmount(invoice);
      rows.push({
        source: 'fatura',
        date: invoice.date,
        title: invoice.customer,
        detail: `Gelen fatura ${invoice.invoiceNo}`,
        extra: invoice.currency === 'TRY' ? invoice.note : `${invoice.currency} ${invoice.grossAmount}`,
        amount: Math.round(amount * 100) / 100,
        group: 'operational',
      });
    }
  }

  rows.sort((a, b) => b.date.localeCompare(a.date));

  const totals = Object.fromEntries(SOURCES.map((s) => [s.key, 0]));
  for (const row of rows) totals[row.source] += row.amount;
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  for (const key of Object.keys(totals)) totals[key] = round2(totals[key]);

  return { rows, totals, grandTotal: round2(rows.reduce((sum, r) => sum + r.amount, 0)) };
}

export function expenseSummaryView(app) {
  const present = app.present();
  const p = app.period();
  const { rows, totals, grandTotal } = collectExpenses(app);
  const state = app.store.getState();

  const visibleSources = SOURCES.filter((s) => app.can(s.module));
  const table = h('table', {},
    h('thead', {}, h('tr', {}, ...['Tarih', 'Kaynak', 'Açıklama', 'Detay', 'Tutar'].map((t) => h('th', {}, t)))),
    h('tbody', {}, ...(rows.length
      ? rows.map((row) => {
        const source = SOURCES.find((s) => s.key === row.source);
        return h('tr', {},
          h('td', {}, formatDate(row.date)),
          h('td', {},
            h('span', { class: 'swatch', style: { background: source.color } }),
            source.label.split(' ')[0],
            row.generated ? h('span', { class: 'muted small' }, ' · otomatik') : null),
          h('td', {}, h('strong', {}, row.title),
            row.extra ? h('div', { class: 'muted small' }, row.extra) : null),
          h('td', { class: 'muted small' }, row.detail),
          h('td', { class: 'num' }, present.money(row.amount)));
      })
      : [h('tr', {}, h('td', { colspan: '5', class: 'empty' }, 'Bu dönemde gider kaydı yok.'))])));

  // PRD III §2 — sayfanın üstündeki grafik/dashboard alanı kaldırıldı;
  // Gelir paneliyle aynı sade veri tablosu düzeni kullanılır.
  return h('div', { class: 'stack print-area' },
    h('div', { class: 'row between center wrap gap no-print' },
      h('div', {},
        h('h1', {}, 'Giderler'),
        h('p', { class: 'muted' }, `${formatDate(p.from)} → ${formatDate(p.to)} · tüm gider kalemleri tek listede`)),
      h('div', { class: 'row gap wrap' },
        ...visibleSources.map((source) => h('button', {
          class: 'btn small ghost', type: 'button',
          title: `${source.label} sayfasına git`,
          onClick: () => app.go(source.view),
        }, source.label)),
        app.can('yazdirma')
          ? h('button', { class: 'btn', type: 'button', onClick: () => app.openPrintDialog('Giderler') }, '🖨️ Yazdır')
          : null)),

    h('div', { class: 'card filter-bar row between center wrap gap' },
      h('span', { class: 'muted small' }, `${rows.length} gider kalemi`),
      h('strong', { class: 'bad' }, `Dönem Toplamı: ${present.money(grandTotal)}`)),

    h('section', { class: 'card table-card', dataset: { print: 'giderler' } },
      h('header', { class: 'card-header' },
        h('h3', {}, 'Tüm Gider Kalemleri'),
        h('span', { class: 'muted small' }, 'Tekrarlayan giderler ve dönem faturaları dâhil')),
      table));
}
