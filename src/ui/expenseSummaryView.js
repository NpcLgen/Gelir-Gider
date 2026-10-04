/**
 * Giderler (Tümü) — PRD §3.1 gider ana menüsü.
 * Genel harcamalar, personel, ekstra çalışan, toptancı faturaları ve vergiler
 * tek listede birleştirilir; dönemin toplam gider tablosu buradan okunur.
 */

import { EXPENSE_GROUPS } from '../core/catalog.js';
import { expandExpenses } from '../core/costEngine.js';
import { defaultTaxRates, employeeTotal, taxReport } from '../core/finance.js';
import { categoryOf } from '../core/model.js';
import { formatDate, formatMoney } from '../core/format.js';
import { donutChart } from './charts.js';
import { h } from './dom.js';
import { taxInputs } from './taxView.js';

/** Gider kaynakları — her biri ayrı modül yetkisiyle korunur. */
const SOURCES = [
  { key: 'genel', label: 'Genel Harcamalar', module: 'genelHarcamalar', color: '#3987e5', view: 'giderler' },
  { key: 'personel', label: 'Personel (Maaş + SGK)', module: 'calisanlar', color: '#d95926', view: 'calisanlar' },
  { key: 'ekstra', label: 'Ekstra Çalışan', module: 'ekstraCalisan', color: '#199e70', view: 'ekstra' },
  { key: 'toptanci', label: 'Toptancı Faturaları', module: 'toptancilar', color: '#c98500', view: 'toptancilar' },
  { key: 'restoran', label: 'Restoran Ekstra Giderler', module: 'restoranGider', color: '#d55181', view: 'restoranGider' },
  { key: 'yabanci', label: 'Yabancı Çalışanlar', module: 'yabanciCalisanlar', color: '#9085e9', view: 'yabanci' },
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
  const slices = visibleSources
    .map((s) => ({ label: s.label, value: totals[s.key], color: s.color }))
    .filter((s) => s.value > 0);

  // Vergi yükü ayrı gösterilir: gider değil, kârdan ödenen yükümlülüktür.
  const taxLoad = app.can('vergiler') ? taxSummary(app) : null;

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

  return h('div', { class: 'stack print-area' },
    h('div', { class: 'row between center wrap gap no-print' },
      h('div', {},
        h('h1', {}, 'Giderler'),
        h('p', { class: 'muted' }, `${formatDate(p.from)} → ${formatDate(p.to)} · tüm gider kalemleri tek listede`)),
      app.can('yazdirma')
        ? h('button', { class: 'btn', type: 'button', onClick: () => app.openPrintDialog('Giderler') }, '🖨️ Yazdır')
        : null),

    h('div', { class: 'kpi-grid' },
      h('div', { class: 'card kpi' },
        h('span', { class: 'muted small' }, 'Dönem Toplam Gider'),
        h('strong', { class: 'bad' }, present.money(grandTotal)),
        h('span', { class: 'muted small' }, `${rows.length} kalem`)),
      ...visibleSources.map((source) => h('button', {
        class: 'card kpi kpi-link', type: 'button',
        title: `${source.label} sayfasına git`,
        onClick: () => app.go(source.view),
      },
        h('span', { class: 'muted small' },
          h('span', { class: 'swatch', style: { background: source.color } }), source.label),
        h('strong', {}, present.money(totals[source.key])),
        h('span', { class: 'muted small' },
          grandTotal > 0 ? `%${((totals[source.key] / grandTotal) * 100).toFixed(1)} pay` : '—')))),

    h('div', { class: 'split-2' },
      h('section', { class: 'card stack' },
        h('h3', {}, 'Gider Kaynakları'),
        h('div', { class: 'row gap wrap center' },
          donutChart(slices, {
            size: 190,
            format: (v) => present.money(v),
            centerLabel: 'Toplam',
            centerValue: present.money(grandTotal),
          }),
          h('div', { class: 'legend' }, ...(slices.length
            ? slices.map((slice) => h('div', { class: 'legend-row' },
              h('span', { class: 'swatch', style: { background: slice.color } }),
              h('span', {}, slice.label),
              h('strong', { class: 'right' }, present.money(slice.value))))
            : [h('p', { class: 'muted small' }, 'Bu dönemde gider yok.')])))),

      h('section', { class: 'card stack' },
        h('h3', {}, 'Gider Grupları'),
        h('p', { class: 'muted small' }, 'Sabit, değişken, operasyonel ve pazarlama ayrımı (PRD §2.2).'),
        h('div', { class: 'kv-list' }, ...EXPENSE_GROUPS.map((group) => {
          const value = rows.filter((r) => r.group === group.key).reduce((sum, r) => sum + r.amount, 0);
          return h('div', { class: 'kv' },
            h('span', {},
              h('span', { class: 'group-dot', style: { background: group.color } }), group.label),
            h('strong', {}, present.money(value)));
        })),
        taxLoad
          ? h('div', { class: 'stack tight' },
            h('hr'),
            h('h4', {}, 'Vergi Yükü'),
            h('div', { class: 'kv-list' },
              h('div', { class: 'kv' }, h('span', {}, 'Ödenecek net KDV'), h('strong', {}, present.money(taxLoad.netKdv))),
              h('div', { class: 'kv' }, h('span', {}, 'Konaklama vergisi + turizm payı'), h('strong', {}, present.money(taxLoad.others))),
              h('div', { class: 'kv' }, h('span', {}, 'Gelir / kurumlar vergisi'), h('strong', {}, present.money(taxLoad.incomeTax)))),
            h('button', {
              class: 'btn small ghost no-print', type: 'button',
              onClick: () => app.go('vergiler'),
            }, 'Vergi raporunu aç →'),
            h('p', { class: 'muted small' }, 'Vergiler gider kalemi değildir; kârdan ödenen yükümlülük olarak ayrı izlenir.'))
          : null)),

    h('section', { class: 'card table-card', dataset: { print: 'giderler' } },
      h('header', { class: 'card-header' },
        h('h3', {}, 'Tüm Gider Kalemleri'),
        h('span', { class: 'muted small' }, 'Tekrarlayan giderler ve dönem faturaları dâhil')),
      table));
}

/** Dönemin vergi yükü özeti (vergi raporuyla aynı girdilerden hesaplanır). */
function taxSummary(app) {
  const settings = app.store.getState().settings;
  const rates = { ...defaultTaxRates(), ...(settings.tax ?? {}) };
  const inputs = taxInputs(app);
  const report = taxReport({
    revenue: inputs.revenue,
    expenses: inputs.expensesTotal,
    expenseKdvBase: inputs.kdvBase,
    rates,
  });
  return {
    netKdv: Math.max(0, report.netKdv),
    others: report.accommodationTax + report.tourismShare,
    incomeTax: report.incomeTax,
  };
}
