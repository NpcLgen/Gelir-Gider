/**
 * Finansal Raporlar (PRD §5 Faz 3, §7).
 * Dönem özeti, oda bazlı tablo, gider dökümü ve dışa aktarım.
 */

import { EXPENSE_GROUPS, EXPENSE_GROUP_MAP } from '../core/catalog.js';
import { categoryOf, roomLabel } from '../core/model.js';
import { formatDate, formatDecimal, formatNumber, formatPercent } from '../core/format.js';
import { h, toast } from './dom.js';
import { exportCsv, exportExcel, printReport } from './export.js';

export function reportsView(app) {
  const report = app.report();
  const present = app.present();
  const settings = app.store.getState().settings;
  const p = app.period();
  const stamp = `${p.from}_${p.to}`;

  const summaryRows = () => [
    ['Metrik', `Değer (${present.currency})`],
    ['Dönem', `${p.from} → ${p.to}`],
    ['Brüt Gelir', present.toDisplay(report.totals.revenue).toFixed(2)],
    ['Acenta Komisyonu', present.toDisplay(report.totals.commission).toFixed(2)],
    ['Net Gelir', present.toDisplay(report.totals.netRevenue).toFixed(2)],
    ['Odalara Dağıtılan Gider', present.toDisplay(report.totals.totalCost).toFixed(2)],
    ['İşletme Geneli Gider', present.toDisplay(report.totals.generalExpenses).toFixed(2)],
    ['Net Kâr', present.toDisplay(report.totals.netProfit).toFixed(2)],
    ['Kâr Marjı', formatPercent(report.totals.margin)],
    ['Doluluk', formatPercent(report.totals.occupancyRate)],
    ['ADR', present.toDisplay(report.totals.adr).toFixed(2)],
    ['RevPAR', present.toDisplay(report.totals.revpar).toFixed(2)],
    ['Kişi Başı Maliyet', present.toDisplay(report.totals.costPerGuestNight).toFixed(2)],
    ['Zayi / Amortisman', present.toDisplay(report.totals.writeOff).toFixed(2)],
    ['Başa Baş Doluluk', report.breakEven.requiredOccupancy == null ? '—' : formatPercent(report.breakEven.requiredOccupancy)],
  ];

  const roomRows = () => [
    ['Oda', 'm²', 'Doluluk', 'Oda-Gecesi', 'Kişi-Gece', 'ADR', 'RevPAR', 'Brüt Gelir', 'Komisyon', 'Net Gelir',
      'Doğrudan', 'Kişi Başı', 'Tarife', 'Katsayılı', 'Eşit', 'Toplam Gider', 'Kâr', 'Marj'],
    ...report.rooms.map((row) => [
      roomLabel(row.room), row.room.area || '', formatPercent(row.occupancyRate), row.roomNights, row.guestNights,
      present.toDisplay(row.adr).toFixed(2), present.toDisplay(row.revpar).toFixed(2),
      present.toDisplay(row.revenue).toFixed(2), present.toDisplay(row.commission).toFixed(2),
      present.toDisplay(row.netRevenue).toFixed(2), present.toDisplay(row.costs.direct).toFixed(2),
      present.toDisplay(row.costs.perGuest).toFixed(2), present.toDisplay(row.costs.tariff).toFixed(2),
      present.toDisplay(row.weightedTotal).toFixed(2), present.toDisplay(row.costs.equal).toFixed(2),
      present.toDisplay(row.totalCost).toFixed(2), present.toDisplay(row.profit).toFixed(2),
      formatPercent(row.margin),
    ]),
  ];

  const expenseRows = () => [
    ['Tarih', 'Kategori', 'Grup', 'Açıklama', 'Tedarikçi', 'Dağıtım', 'Oda', 'Tutar', 'Para Birimi', `Tutar (${present.currency})`, 'Tekrarlayan'],
    ...report.expenses.map((expense) => {
      const room = app.store.getState().rooms.find((r) => r.id === expense.roomId);
      return [
        expense.date, categoryOf(settings, expense.category).label,
        EXPENSE_GROUP_MAP[expense.group]?.label ?? expense.group,
        expense.description, expense.vendor, expense.allocation, room ? roomLabel(room) : '',
        expense.amount, expense.currency, present.toDisplay(expense.amountBase).toFixed(2),
        expense.generated ? 'Evet (otomatik)' : expense.recurring?.enabled ? 'Evet' : 'Hayır',
      ];
    }),
  ];

  const exportAll = (kind) => {
    if (kind === 'csv') {
      exportCsv(`gelir-gider-${stamp}.csv`, [...summaryRows(), [], ...roomRows(), [], ...expenseRows()]);
      toast('CSV indirildi.');
    } else if (kind === 'excel') {
      exportExcel(`gelir-gider-${stamp}.xls`, [
        { title: `Dönem Özeti (${p.from} → ${p.to})`, rows: summaryRows() },
        { title: 'Oda Bazlı Kârlılık', rows: roomRows() },
        { title: 'Gider Dökümü', rows: expenseRows() },
      ]);
      toast('Excel dosyası indirildi.');
    } else {
      printReport();
    }
  };

  const groupTotals = EXPENSE_GROUPS.map((group) => ({ group, value: report.byGroup[group.key] ?? 0 }));
  const grandTotal = groupTotals.reduce((sum, g) => sum + g.value, 0);

  return h('div', { class: 'stack print-area' },
    h('div', { class: 'row between center wrap gap no-print' },
      h('div', {},
        h('h1', {}, 'Finansal Raporlar'),
        h('p', { class: 'muted' }, `${p.from} → ${p.to} · ${present.currency} · kur 1 € = ${formatDecimal(settings.fx.rate)} ₺`)),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn', type: 'button', onClick: () => exportAll('pdf') }, '🖨️ PDF İndir'),
        h('button', { class: 'btn', type: 'button', onClick: () => exportAll('excel') }, '📊 Excel’e Aktar'),
        h('button', { class: 'btn', type: 'button', onClick: () => exportAll('csv') }, '📄 CSV Kaydet'))),

    h('section', { class: 'card table-card' },
      h('header', { class: 'card-header' }, h('h3', {}, 'Dönem Özeti')),
      table(summaryRows())),

    h('section', { class: 'card table-card' },
      h('header', { class: 'card-header' }, h('h3', {}, 'Gider Grupları')),
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Grup'), h('th', {}, 'Kapsam'), h('th', { class: 'num' }, 'Tutar'), h('th', { class: 'num' }, 'Pay'))),
        h('tbody', {}, ...groupTotals.map(({ group, value }) => h('tr', {},
          h('td', {}, h('span', { class: 'group-dot', style: { background: group.color } }), group.label),
          h('td', { class: 'muted small' }, group.hint),
          h('td', { class: 'num' }, present.money(value)),
          h('td', { class: 'num' }, formatPercent(grandTotal ? value / grandTotal : 0))))))),

    h('section', { class: 'card table-card' },
      h('header', { class: 'card-header' }, h('h3', {}, 'Oda Bazlı Kârlılık')),
      table(roomRows())),

    h('section', { class: 'card table-card' },
      h('header', { class: 'card-header' }, h('h3', {}, 'Gider Dökümü'),
        h('span', { class: 'muted small' }, `${report.expenses.length} kalem (tekrarlayanlar otomatik üretildi)`)),
      table(expenseRows().map((row, index) => (index === 0 ? row : row.map((cell, col) => (col === 0 ? formatDate(cell) : cell)))))));
}

function table(rows) {
  const [head, ...body] = rows;
  return h('table', {},
    h('thead', {}, h('tr', {}, ...head.map((cell) => h('th', {}, cell)))),
    h('tbody', {}, ...body.map((row) => h('tr', {}, ...row.map((cell, index) =>
      h('td', { class: index > 0 && !Number.isNaN(Number(cell)) && cell !== '' ? 'num' : '' },
        typeof cell === 'number' ? formatNumber(cell) : cell))))));
}
