/**
 * Yönetici Özeti / Dashboard (PRD §3).
 * Kârlılık göstergeleri, gider dağılım grafiği, başa baş noktası, YOY analizi
 * ve oda bazlı kârlılık tablosu.
 */

import { EXPENSE_GROUPS, UTILITY_KINDS, UTILITY_LABELS } from '../core/catalog.js';
import { compareReports } from '../core/costEngine.js';
import { previousYear } from '../core/dates.js';
import { categoryOf, roomLabel } from '../core/model.js';
import { formatDecimal, formatNumber, formatPercent } from '../core/format.js';
import { barList, deltaBadge, donutChart } from './charts.js';
import { h, openModal } from './dom.js';

export function dashboardView(app) {
  const report = app.report();
  const present = app.present();
  const { totals } = report;
  const settings = app.store.getState().settings;

  const marginTone = totals.targetMet ? 'good' : 'bad';

  const kpis = h('div', { class: 'kpi-grid' },
    kpi('Gelir', present.money(totals.revenue), `Komisyon sonrası ${present.money(totals.netRevenue)}`),
    kpi('Toplam Gider', present.money(totals.expenses), `${present.money(totals.totalCost)} odalara dağıtıldı`),
    kpi('Net Kâr', present.money(totals.netProfit), `Hedef marj %${Math.round(totals.targetMargin * 100)}`, marginTone),
    kpi('Kâr Marjı', formatPercent(totals.margin),
      totals.targetMet ? '✔ hedefin üzerinde' : '✖ hedefin altında', marginTone),
    kpi('ADR', present.money(totals.adr), 'Ortalama satılan gece fiyatı'),
    kpi('RevPAR', present.money(totals.revpar), `${formatNumber(totals.availableRoomNights)} satılabilir gece`),
    kpi('Doluluk', formatPercent(totals.occupancyRate), `${formatNumber(totals.roomNights)} oda-gecesi`),
    kpi('Kişi Başı Maliyet', present.money(totals.costPerGuestNight), `${formatNumber(totals.guestNights)} kişi-gece`));

  return h('div', { class: 'stack' },
    h('div', {},
      h('h1', {}, 'Yönetici Özeti'),
      h('p', { class: 'muted' }, `${report.period.from} → ${report.period.to} · tutarlar ${present.currency} cinsinden`)),
    kpis,
    h('div', { class: 'split-2' }, expenseBreakdown(report, present), breakEvenCard(report, present, totals)),
    yoyCard(app, report, present),
    profitabilityTable(app, report, present),
    report.unallocated.items.length ? unallocatedCard(report, present) : null,
    h('p', { class: 'muted small method-footer' },
      `Genel gider dağıtımı: ${methodLabel(settings.allocationMethod)} · boş oda sabit payı %${Math.round((settings.fixedShare ?? 0) * 100)} · kur 1 € = ${formatDecimal(settings.fx.rate)} ₺`));
}

const methodLabel = (key) => ({
  equal: 'A · Eşit', area: 'B · Metrekare bazlı', coefficient: 'C · Özel katsayı',
}[key] ?? key);

function kpi(label, value, hint, tone) {
  return h('div', { class: 'card kpi' },
    h('span', { class: 'muted small' }, label),
    h('strong', { class: tone || '' }, value),
    h('span', { class: 'muted small' }, hint));
}

/** PRD §3.1 — gider dağılım grafiği (pasta/halka) + tablo görünümü. */
function expenseBreakdown(report, present) {
  const slices = EXPENSE_GROUPS
    .map((group) => ({ label: group.label, value: report.byGroup[group.key] ?? 0, color: group.color }))
    .filter((s) => s.value > 0);
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  return h('section', { class: 'card stack' },
    h('h3', {}, 'Gider Dağılımı'),
    h('div', { class: 'row gap wrap center' },
      donutChart(slices, {
        size: 200,
        format: (v) => present.money(v),
        centerLabel: 'Toplam',
        centerValue: present.money(total),
      }),
      h('div', { class: 'legend' }, ...slices.map((slice) => h('div', { class: 'legend-row' },
        h('span', { class: 'swatch', style: { background: slice.color } }),
        h('span', {}, slice.label),
        h('strong', { class: 'right' }, present.money(slice.value)),
        h('span', { class: 'muted small' }, ` %${total ? ((slice.value / total) * 100).toFixed(1) : 0}`))))),
    h('details', {}, h('summary', { class: 'muted small' }, 'Kategori kırılımını göster'),
      h('table', { class: 'mini-table' },
        h('tbody', {}, ...Object.entries(report.byCategory)
          .sort((a, b) => b[1] - a[1])
          .map(([key, value]) => h('tr', {},
            h('td', {}, key === 'perGuestTariff' ? 'Kişi Başı Sarfiyat (tarife)' : categoryOf({}, key).label),
            h('td', { class: 'num' }, present.money(value))))))));
}

/** PRD §3.2 — başa baş noktası hesaplayıcı. */
function breakEvenCard(report, present, totals) {
  const be = report.breakEven;
  return h('section', { class: 'card stack' },
    h('h3', {}, 'Başa Baş Noktası'),
    h('p', { class: 'muted small' }, 'Sabit giderleri karşılamak için gereken minimum satış.'),
    h('div', { class: 'kv-list' },
      kv('Sabit giderler', present.money(be.fixedCost)),
      kv('Değişken gider / gece', present.money(be.variablePerNight)),
      kv('Katkı payı / gece', present.money(be.contributionPerNight)),
      kv('Gereken oda-gecesi', be.requiredRoomNights == null ? '—' : formatNumber(be.requiredRoomNights)),
      kv('Gereken doluluk', be.requiredOccupancy == null ? '—' : formatPercent(be.requiredOccupancy)),
      kv('Gereken minimum ADR', be.requiredAdr == null ? '—' : present.money(be.requiredAdr))),
    h('div', { class: 'progress', title: 'Gerçekleşen doluluk / gereken doluluk' },
      h('span', {
        class: totals.occupancyRate >= (be.requiredOccupancy ?? 0) ? 'progress-good' : 'progress-bad',
        style: { width: `${Math.min(100, (totals.occupancyRate / Math.max(be.requiredOccupancy || 0.0001, 0.0001)) * 100)}%` },
      })),
    h('p', { class: 'muted small' },
      be.requiredOccupancy == null
        ? 'ADR değişken maliyeti karşılamıyor; başa baş hesaplanamıyor.'
        : totals.occupancyRate >= be.requiredOccupancy
          ? `✔ Doluluk (${formatPercent(totals.occupancyRate)}) başa baş noktasının üzerinde.`
          : `✖ Başa baş için ${formatPercent(be.requiredOccupancy - totals.occupancyRate)} daha doluluk gerekiyor.`));
}

/** PRD §3.2 — yıllık karşılaştırma (YOY). */
function yoyCard(app, report, present) {
  const previous = app.reportFor(previousYear(report.period));
  const diff = compareReports(report, previous);
  const rows = [
    ['Gelir', diff.revenue, (v) => present.money(v)],
    ['Gider', diff.expenses, (v) => present.money(v), true],
    ['Net Kâr', diff.netProfit, (v) => present.money(v)],
    ['Doluluk', diff.occupancyRate, formatPercent],
    ['ADR', diff.adr, (v) => present.money(v)],
    ['RevPAR', diff.revpar, (v) => present.money(v)],
  ];

  return h('section', { class: 'card stack' },
    h('div', { class: 'row between center wrap gap' },
      h('h3', {}, 'Yıllık Karşılaştırma (YOY)'),
      h('span', { class: 'muted small' }, `${report.period.from.slice(0, 7)} ↔ ${previous.period.from.slice(0, 7)}`)),
    h('table', { class: 'mini-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Metrik'), h('th', { class: 'num' }, 'Bu dönem'),
        h('th', { class: 'num' }, 'Geçen yıl'), h('th', { class: 'num' }, 'Değişim'))),
      h('tbody', {}, ...rows.map(([label, d, format, invert]) => h('tr', {},
        h('td', {}, label),
        h('td', { class: 'num' }, format(d.current)),
        h('td', { class: 'num muted' }, format(d.previous)),
        h('td', { class: 'num' }, deltaBadge(d.ratio, { invert: Boolean(invert) })))))),
    previous.totals.revenue === 0
      ? h('p', { class: 'muted small' }, 'Geçen yılın aynı döneminde veri bulunmuyor.')
      : null);
}

function profitabilityTable(app, report, present) {
  const sorted = [...report.rooms].sort((a, b) => b.profit - a.profit);
  const items = sorted.map((row) => ({
    label: roomLabel(row.room),
    value: row.profit,
    color: row.profit >= 0 ? 'var(--good)' : 'var(--bad)',
  }));

  const rows = sorted.map((row) => h('tr', { class: 'clickable', onClick: () => openRoomBreakdown(app, row, present) },
    h('td', {}, h('strong', {}, roomLabel(row.room)),
      h('div', { class: 'muted small' }, `${row.room.area || '—'} m² · ⚡×${formatDecimal(row.amenityLoads.electricity)}`)),
    h('td', { class: 'num' }, formatPercent(row.occupancyRate)),
    h('td', { class: 'num' }, present.money(row.adr)),
    h('td', { class: 'num' }, present.money(row.revpar)),
    h('td', { class: 'num' }, present.money(row.netRevenue)),
    h('td', { class: 'num' }, present.money(row.costs.direct)),
    h('td', { class: 'num' }, present.money(row.costs.perGuest + row.costs.tariff)),
    h('td', { class: 'num' }, present.money(row.weightedTotal + row.costs.equal)),
    h('td', { class: 'num' }, present.money(row.totalCost)),
    h('td', { class: `num ${row.profit >= 0 ? 'good' : 'bad'}` }, present.money(row.profit)),
    h('td', { class: 'num' }, formatPercent(row.margin))));

  return h('section', { class: 'card table-card stack' },
    h('header', { class: 'card-header' }, h('h3', {}, 'Oda Bazlı Kârlılık'),
      h('span', { class: 'muted small' }, 'Satıra tıklayarak gider kırılımını görün')),
    h('table', {},
      h('thead', {}, h('tr', {}, ...['Oda', 'Doluluk', 'ADR', 'RevPAR', 'Net Gelir', 'Doğrudan', 'Kişi Başı', 'Genel Pay', 'Toplam Gider', 'Kâr', 'Marj'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: '11', class: 'empty' }, 'Bu dönemde veri yok.'))]))),
    h('div', { class: 'chart-pad' }, barList(items, { format: (v) => present.money(v) })));
}

function unallocatedCard(report, present) {
  return h('section', { class: 'card' },
    h('h3', {}, 'Odalara Dağıtılmayan Giderler'),
    h('ul', { class: 'plain-list' }, ...report.unallocated.items.map((item) =>
      h('li', {}, h('span', {}, item.description), h('span', { class: 'muted small' }, ` · ${item.reason}`),
        h('strong', { class: 'right' }, present.money(item.amountBase))))));
}

const kv = (label, value) => h('div', { class: 'kv' }, h('span', {}, label), h('strong', {}, value));

export function openRoomBreakdown(app, row, present) {
  openModal({
    title: `${roomLabel(row.room)} · Gider Kırılımı`,
    subtitle: `${app.period().from} → ${app.period().to}`,
    size: 'md',
    content: () => h('div', { class: 'stack' },
      h('div', { class: 'kv-list' },
        kv('Brüt gelir', present.money(row.revenue)),
        kv('Acenta komisyonu', present.money(row.commission)),
        kv('Net gelir', present.money(row.netRevenue)),
        kv('Oda-gecesi', formatNumber(row.roomNights)),
        kv('Kişi-gece', formatNumber(row.guestNights)),
        kv('ADR', present.money(row.adr)),
        kv('RevPAR', present.money(row.revpar)),
        kv('Kişi başı maliyet', present.money(row.costPerGuestNight)),
        kv('Zayi / amortisman', present.money(row.writeOff)),
        kv('Kâr', present.money(row.profit))),
      h('h4', {}, 'Katsayılı Genel Giderler'),
      h('div', { class: 'kv-list' }, ...UTILITY_KINDS.map((kind) =>
        kv(`${UTILITY_LABELS[kind]} (ağırlık ×${formatDecimal(row.weights[kind])})`, present.money(row.costs.weighted[kind])))),
      h('h4', {}, 'Kalem Kalem'),
      h('ul', { class: 'plain-list' }, ...(row.lines.length
        ? row.lines.map((line) => h('li', {},
          h('span', { class: `tag tag-${line.source}` }, sourceLabel(line.source)),
          h('span', {}, line.label),
          h('strong', { class: 'right' }, present.money(line.amount))))
        : [h('li', { class: 'muted' }, 'Bu dönemde gider yok.')]))),
  });
}

const sourceLabel = (source) => ({
  direct: 'Doğrudan', perGuest: 'Kişi Başı', tariff: 'Tarife', equal: 'Eşit', weighted: 'Katsayılı',
}[source] ?? source);
