/** Panel — dönem bazlı oda kârlılığı ve maliyet dağıtımının kaynağı. */

import { UTILITY_KINDS, UTILITY_LABELS } from '../core/catalog.js';
import { roomLabel } from '../core/model.js';
import { formatDecimal, formatMoney, formatNumber, formatPercent } from '../core/format.js';
import { h, openModal } from './dom.js';

export function reportView(app) {
  const report = app.report();
  const { totals } = report;

  const cards = [
    kpi('Gelir', formatMoney(totals.revenue), 'Dönem içi konaklama geliri'),
    kpi('Dağıtılan Gider', formatMoney(totals.totalCost), 'Odalara yansıyan maliyet'),
    kpi('İşletme Geneli', formatMoney(totals.generalExpenses), 'Odaya dağıtılmayan giderler'),
    kpi('Net Kâr', formatMoney(totals.netProfit), formatPercent(totals.margin) + ' marj', totals.netProfit >= 0 ? 'good' : 'bad'),
    kpi('Doluluk', formatPercent(totals.occupancyRate), `${formatNumber(totals.roomNights)} oda-gecesi`),
    kpi('Kişi Başı Maliyet', formatMoney(totals.costPerGuestNight), `${formatNumber(totals.guestNights)} kişi-gece`),
  ];

  const sorted = [...report.rooms].sort((a, b) => b.profit - a.profit);
  const maxAbs = Math.max(1, ...sorted.map((r) => Math.abs(r.profit)));

  const rows = sorted.map((row) => h('tr', { class: 'clickable', onClick: () => openRoomBreakdown(app, row) },
    h('td', {}, h('strong', {}, roomLabel(row.room)),
      h('div', { class: 'muted small' }, `⚡×${formatDecimal(row.amenityLoads.electricity)} · 💧×${formatDecimal(row.amenityLoads.water)}`)),
    h('td', { class: 'num' }, formatPercent(row.occupancyRate)),
    h('td', { class: 'num' }, formatNumber(row.guestNights)),
    h('td', { class: 'num' }, formatMoney(row.revenue)),
    h('td', { class: 'num' }, formatMoney(row.costs.direct)),
    h('td', { class: 'num' }, formatMoney(row.costs.perGuest + row.costs.tariff)),
    h('td', { class: 'num' }, formatMoney(row.weightedTotal)),
    h('td', { class: 'num' }, formatMoney(row.costs.equal)),
    h('td', { class: 'num' }, formatMoney(row.totalCost)),
    h('td', { class: 'num' }, formatMoney(row.costPerGuestNight)),
    h('td', { class: `num ${row.profit >= 0 ? 'good' : 'bad'}` }, formatMoney(row.profit)),
    h('td', {}, bar(row.profit, maxAbs))));

  return h('div', { class: 'stack' },
    h('div', {}, h('h1', {}, 'Panel'),
      h('p', { class: 'muted' }, 'Oda kartlarındaki kapasite ve demirbaş seçimleri, aşağıdaki dağıtımın girdisidir.')),
    h('div', { class: 'kpi-grid' }, ...cards),
    h('div', { class: 'card table-card' },
      h('header', { class: 'card-header' }, h('h3', {}, 'Oda Bazlı Kârlılık'),
        h('span', { class: 'muted small' }, 'Satıra tıklayarak gider kırılımını görün')),
      h('table', {},
        h('thead', {}, h('tr', {},
          ...['Oda', 'Doluluk', 'Kişi-Gece', 'Gelir', 'Doğrudan', 'Kişi Başı', 'Katsayılı', 'Eşit', 'Toplam Gider', 'Kişi Başı Mly.', 'Kâr', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: '12', class: 'empty' }, 'Bu dönemde veri yok.'))])))),
    report.unallocated.items.length
      ? h('div', { class: 'card' },
        h('h3', {}, 'Odalara Dağıtılmayan Giderler'),
        h('ul', { class: 'plain-list' }, ...report.unallocated.items.map((item) =>
          h('li', {}, h('span', {}, item.description), h('span', { class: 'muted small' }, ` · ${item.reason}`),
            h('strong', { class: 'right' }, formatMoney(item.amount))))))
      : null);
}

function kpi(label, value, hint, tone) {
  return h('div', { class: 'card kpi' },
    h('span', { class: 'muted small' }, label),
    h('strong', { class: tone || '' }, value),
    h('span', { class: 'muted small' }, hint));
}

function bar(value, max) {
  const width = Math.min(100, (Math.abs(value) / max) * 100);
  return h('div', { class: 'bar' }, h('span', { class: value >= 0 ? 'bar-good' : 'bar-bad', style: { width: `${width}%` } }));
}

export function openRoomBreakdown(app, row) {
  openModal({
    title: `${roomLabel(row.room)} · Gider Kırılımı`,
    subtitle: `${app.period().from} → ${app.period().to}`,
    size: 'md',
    content: () => h('div', { class: 'stack' },
      h('div', { class: 'kv-list' },
        kv('Gelir', formatMoney(row.revenue)),
        kv('Oda-gecesi', formatNumber(row.roomNights)),
        kv('Kişi-gece', formatNumber(row.guestNights)),
        kv('Ortalama gecelik (ADR)', formatMoney(row.adr)),
        kv('Kişi başı maliyet', formatMoney(row.costPerGuestNight)),
        kv('Kâr', formatMoney(row.profit))),
      h('h4', {}, 'Katsayılı Genel Giderler'),
      h('div', { class: 'kv-list' }, ...UTILITY_KINDS.map((kind) =>
        kv(`${UTILITY_LABELS[kind]} (ağırlık ×${formatDecimal(row.weights[kind])})`, formatMoney(row.costs.weighted[kind])))),
      h('h4', {}, 'Kalem Kalem'),
      h('ul', { class: 'plain-list' }, ...(row.lines.length
        ? row.lines.map((line) => h('li', {},
          h('span', { class: `tag tag-${line.source}` }, sourceLabel(line.source)),
          h('span', {}, line.label),
          h('strong', { class: 'right' }, formatMoney(line.amount))))
        : [h('li', { class: 'muted' }, 'Bu dönemde gider yok.')]))),
  });
}

const kv = (label, value) => h('div', { class: 'kv' }, h('span', {}, label), h('strong', {}, value));

const sourceLabel = (source) => ({
  direct: 'Doğrudan', perGuest: 'Kişi Başı', tariff: 'Tarife', equal: 'Eşit', weighted: 'Katsayılı',
}[source] ?? source);
