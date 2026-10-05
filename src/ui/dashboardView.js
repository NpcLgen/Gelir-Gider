/**
 * Yönetici Özeti / Dashboard (PRD §3).
 * Kârlılık göstergeleri, gider dağılım grafiği, başa baş noktası, YOY analizi
 * ve oda bazlı kârlılık tablosu.
 */

import { EXPENSE_GROUPS, UTILITY_KINDS, UTILITY_LABELS } from '../core/catalog.js';
import { compareReports, grossUpForCommission, priceVerdict } from '../core/costEngine.js';
import { defaultTaxRates, invoiceSummary, restaurantIncomeSummary } from '../core/finance.js';
import { businessSummary, round2 } from '../core/summary.js';
import { collectExpenses } from './expenseSummaryView.js';
import { rateFor } from '../core/fx.js';
import { periodExchangeDifference } from '../core/rates.js';
import { previousYear } from '../core/dates.js';
import { categoryOf, roomLabel } from '../core/model.js';
import { formatDecimal, formatNumber, formatPercent } from '../core/format.js';
import { barList, deltaBadge, donutChart } from './charts.js';
import { h, openModal } from './dom.js';

export function dashboardView(app) {
  const report = app.report();
  const present = app.present();
  const { totals } = report;
  const state = app.store.getState();
  const settings = state.settings;
  const p = app.period();
  const rates = { ...defaultTaxRates(), ...(settings.tax ?? {}) };

  /* ---------------- 1 · Otel geliri ---------------- */
  // Oda konaklama geliri: gelir faturaları + (varsa) geçmiş oda kayıtları.
  const salesInvoices = app.can('gelirler')
    ? invoiceSummary(state.salesInvoices, { from: p.from, to: p.to, rateFor: (d) => rateFor(settings.fx, d) })
    : { gross: 0, kdv: 0, count: 0 };
  const hotelRevenue = round2(totals.revenue + salesInvoices.gross);

  /* ---------------- 2 · Restoran geliri ------------ */
  const restaurant = app.can('restoranGelir')
    ? restaurantIncomeSummary(state.restaurantIncomes, { from: p.from, to: p.to, kdvRate: rates.kdvRestaurant ?? 10 })
    : { gross: 0, net: 0, kdv: 0, count: 0 };

  /* ---------------- 3 · Toplam giderler ------------ */
  const { rows: expenseRows, totals: expenseTotals, grandTotal: expenseTotal } = collectExpenses(app);
  const payroll = round2(expenseTotals.personel ?? 0);

  /* ---------------- 5 · Gider KDV toplamı ---------- */
  // Her gider faturasındaki (KDV dahil − KDV hariç) farkının toplamı.
  const purchaseInvoices = app.can('giderFaturalari')
    ? invoiceSummary(state.purchaseInvoices, { from: p.from, to: p.to, rateFor: (d) => rateFor(settings.fx, d) })
    : { gross: 0, kdv: 0, count: 0 };
  // Toptancı cari hareketleri gider KDV'sine girmez (restoran içi borç takibidir).
  const expenseVat = round2(purchaseInvoices.kdv);

  /* ---------------- Kur farkı ---------------------- */
  const fxDiff = periodExchangeDifference({
    reservations: state.reservations, // geçmiş oda gelirleri (modül kaldırıldı, veri korunuyor)
    salesInvoices: app.can('gelirler') ? state.salesInvoices : [],
    purchaseInvoices: app.can('giderFaturalari') ? state.purchaseInvoices : [],
    from: p.from, to: p.to,
  });

  /* ---------------- Finansal motor ----------------- */
  const summary = businessSummary({
    hotelRevenue,
    restaurantRevenue: restaurant.gross,
    expenses: expenseTotal,
    payroll,
    expenseVat,
    exchangeGain: fxDiff.gain,
    exchangeLoss: fxDiff.loss,
    rates,
  });

  const kpis = h('div', { class: 'kpi-grid' },
    kpi('Otel Geliri', present.money(summary.hotelRevenue),
      `KDV hariç ${present.money(summary.hotelNetRevenue)}`
      + (salesInvoices.count ? ` · ${salesInvoices.count} fatura` : '')),
    kpi('Restoran Geliri', present.money(summary.restaurantRevenue),
      restaurant.count ? `${restaurant.count} gün sonu · KDV ${present.money(restaurant.kdv)}` : 'Gün sonu kaydı yok'),
    kpi('Toplam Giderler', present.money(summary.totalExpenses),
      `${expenseRows.length} kalem · maaşlar ${present.money(summary.payroll)} dâhil`, 'bad'),
    kpi('Gelir KDV’si (Otel + Restoran)', present.money(summary.incomeVat),
      `Otel ${present.money(summary.hotelVat)} + restoran ${present.money(summary.restaurantVat)}`),
    kpi('Gider KDV Toplamı', present.money(summary.expenseVat),
      'Faturalardaki dahil − hariç farkı'),
    kpi('Turizm Payı', present.money(summary.tourismShare),
      `Yalnızca otel geliri · %${summary.rates.tourismShare}`),
    kpi('Konaklama Vergisi', present.money(summary.accommodationTax),
      `Yalnızca otel geliri · %${summary.rates.accommodationTax}`),
    kpi('Gelir Vergisi', present.money(summary.incomeTax),
      `Matrah ${present.money(summary.taxBase)} · %${summary.rates.incomeTax}`,
      summary.incomeTax > 0 ? 'bad' : ''),
    kpi('NET KÂR', present.money(summary.netProfit),
      `Marj ${formatPercent(summary.margin)}`, summary.netProfit >= 0 ? 'good' : 'bad'));

  return h('div', { class: 'stack' },
    h('div', {},
      h('h1', {}, 'Yönetici Özeti'),
      h('p', { class: 'muted' }, `${report.period.from} → ${report.period.to} · tutarlar ${present.currency} cinsinden`)),
    kpis,
    taxFormulaCard(summary, present),
    h('div', { class: 'split-2' }, expenseBreakdown(report, present), breakEvenCard(report, present, totals)),
    fxDiff.rows.length ? exchangeDifferenceCard(fxDiff, present) : null,
    pricingTable(app, report, present),
    yoyCard(app, report, present),
    profitabilityTable(app, report, present),
    report.unallocated.items.length ? unallocatedCard(report, present) : null,
    h('p', { class: 'muted small method-footer' },
      `Genel gider dağıtımı: ${methodLabel(settings.allocationMethod)} · boş oda sabit payı %${Math.round((settings.fixedShare ?? 0) * 100)} · kur 1 € = ${formatDecimal(settings.fx.rate)} ₺`));
}

/** Gelir vergisi algoritmasının dört adımını şeffaf gösterir (PRD III §4). */
function taxFormulaCard(summary, present) {
  const line = (label, value, tone) => h('div', { class: 'kv' },
    h('span', {}, label),
    h('strong', { class: tone || '' }, present.money(value)));

  return h('section', { class: 'card stack', dataset: { print: 'kdv' } },
    h('header', { class: 'card-header' },
      h('h3', {}, 'Gelir Vergisi Hesabı'),
      h('span', { class: 'muted small' }, 'PRD III §4 — dört adımlı algoritma')),
    h('div', { class: 'split-2' },
      h('div', { class: 'stack tight' },
        h('h4', {}, '1 · Toplam Gelir'),
        h('div', { class: 'kv-list' },
          line('Otel geliri', summary.hotelRevenue),
          line('Restoran geliri', summary.restaurantRevenue),
          summary.exchangeGain > 0 ? line('Olumlu kur farkı', summary.exchangeGain) : null,
          line('Toplam', summary.totalRevenueWithFx, 'good'))),
      h('div', { class: 'stack tight' },
        h('h4', {}, '2 · Toplam İndirimler'),
        h('div', { class: 'kv-list' },
          line('Sigortalı çalışan maaşları', summary.payroll),
          line('Diğer giderler', summary.otherExpenses),
          summary.exchangeLoss > 0 ? line('Olumsuz kur farkı', summary.exchangeLoss) : null,
          line('Gider KDV toplamı', summary.expenseVat),
          line('Konaklama vergisi', summary.accommodationTax),
          line('Turizm payı', summary.tourismShare),
          line('Toplam', summary.totalDeductions, 'bad')))),
    h('div', { class: 'kv-list' },
      line('3 · Vergi Matrahı (gelir − indirimler)', summary.taxBase),
      line(`4 · Gelir Vergisi (matrah × %${summary.rates.incomeTax})`, summary.incomeTax, 'bad'),
      line('NET KÂR (matrah − gelir vergisi)', summary.netProfit, summary.netProfit >= 0 ? 'good' : 'bad')),
    h('p', { class: 'muted small' },
      'Sigortalı çalışan maaşları "Toplam Giderler" kartının içindedir; indirimlerde iki kez sayılmaz. '
      + 'Turizm payı ve konaklama vergisi yalnızca KDV hariç otel geliri üzerinden hesaplanır. '
      + 'Oranları Ayarlar → Vergi ve Finans bölümünden değiştirebilirsiniz.'));
}

const methodLabel = (key) => ({
  equal: 'A · Eşit', area: 'B · Metrekare bazlı', coefficient: 'C · Özel katsayı',
}[key] ?? key);

/** Kur farkı dökümü: hangi kayıt ne kadar fark üretti? */
function exchangeDifferenceCard(fxDiff, present) {
  const rows = fxDiff.rows.slice(0, 12);
  return h('section', { class: 'card table-card stack', dataset: { print: 'kurfarki' } },
    h('header', { class: 'card-header' },
      h('h3', {}, 'Kur Farkı Dökümü'),
      h('span', { class: 'muted small' },
        `Olumlu ${present.money(fxDiff.gain)} · Olumsuz ${present.money(fxDiff.loss)} · Net ${present.money(fxDiff.net)}`)),
    h('table', {},
      h('thead', {}, h('tr', {}, ...['Tarih', 'Kayıt', 'Açıklama', 'Sistem (TL)', 'Fatura (TL)', 'Kur Farkı']
        .map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows.map((row) => {
        const effective = row.difference * (row.sign ?? 1);
        return h('tr', {},
          h('td', {}, row.date),
          h('td', { class: 'muted small' }, row.kind),
          h('td', {}, row.record.guestName ?? row.record.customer ?? '—'),
          h('td', { class: 'num' }, present.raw ? present.raw(row.systemTry, 'TRY') : String(row.systemTry)),
          h('td', { class: 'num' }, row.pending
            ? h('span', { class: 'muted small' }, 'bekliyor')
            : (present.raw ? present.raw(row.invoicedTry, 'TRY') : String(row.invoicedTry))),
          h('td', { class: 'num' }, row.pending
            ? h('span', { class: 'muted' }, '—')
            : h('strong', { class: effective >= 0 ? 'good' : 'bad' },
              `${effective >= 0 ? '+' : '−'}${present.raw ? present.raw(Math.abs(effective), 'TRY') : Math.abs(effective)}`)));
      }))),
    h('p', { class: 'muted small' },
      'Olumlu kur farkı kârlılığa gelir, olumsuz kur farkı gider olarak yansır. '
      + 'Gider faturalarında yön terstir: fazla ödenen tutar gider sayılır.'));
}

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


/** PRD §3.3 — oda bazlı gecelik maliyet, alt limit ve tavsiye fiyatı. */
function pricingTable(app, report, present) {
  const { prices, settings } = app.store.getState();
  const p = app.period();
  const planned = Math.round((settings.plannedOccupancy ?? 0.6) * 100);
  const target = Math.round((settings.targetMargin ?? 0) * 100);

  const rows = report.rooms
    .filter((row) => row.room.status !== 'passive')
    .map((row) => {
      const pr = row.pricing;
      // Takvimde alt limitin altında kalan gün var mı?
      const roomPrices = prices?.[row.room.id] ?? {};
      let lossDays = 0;
      let belowDays = 0;
      for (const [date, entry] of Object.entries(roomPrices)) {
        if (date < p.from || date > p.to || !(entry.amount > 0)) continue;
        const base = entry.currency === 'EUR' ? entry.amount * present.rate : entry.amount;
        const verdict = priceVerdict(base, pr);
        if (verdict === 'loss') lossDays += 1;
        else if (verdict === 'below') belowDays += 1;
      }

      return h('tr', { class: lossDays ? 'row-alert' : '' },
        h('td', {}, h('strong', {}, roomLabel(row.room)),
          h('div', { class: 'muted small' }, `${row.roomNights} gece satıldı · ort. ${formatDecimal(pr.assumedGuests)} kişi`)),
        h('td', { class: 'num' }, pr.costPerSoldNight == null ? '—' : present.money(pr.costPerSoldNight)),
        h('td', { class: 'num bad' }, present.money(pr.floor)),
        h('td', { class: 'num' }, present.money(pr.breakEven)),
        h('td', { class: 'num good' }, h('strong', {}, present.money(pr.recommended))),
        h('td', { class: 'num muted' }, present.money(grossUpForCommission(pr.recommended, 15))),
        h('td', { class: 'num' }, present.money(row.adr)),
        h('td', {},
          lossDays
            ? h('span', { class: 'badge-alert' }, `⛔ ${lossDays} gün zarar`)
            : belowDays
              ? h('span', { class: 'badge-warn' }, `⚠️ ${belowDays} gün başa başın altında`)
              : h('span', { class: 'muted small' }, '✔ sorun yok')));
    });

  const totalLoss = report.rooms.reduce((sum, row) => sum + (row.adr > 0 && row.adr < row.pricing.floor ? 1 : 0), 0);

  return h('section', { class: 'card table-card stack' },
    h('header', { class: 'card-header' },
      h('h3', {}, 'Oda Bazlı Fiyat Tavsiyesi ve Alt Limit'),
      h('span', { class: 'muted small' }, `%${planned} doluluk varsayımı · %${target} hedef marj`)),
    h('p', { class: 'muted small chart-pad' },
      'Alt limit = bir gece daha satmanın maliyeti (kahvaltı, sarfiyat, doluluğa bağlı enerji). ' +
      'Bu fiyatın altındaki her satış doğrudan zarardır. Başa baş fiyat sabit gider payını da karşılar.'),
    h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'Oda'),
        h('th', { class: 'num' }, 'Gecelik Maliyet'),
        h('th', { class: 'num' }, 'Alt Limit'),
        h('th', { class: 'num' }, 'Başa Baş'),
        h('th', { class: 'num' }, 'Tavsiye'),
        h('th', { class: 'num' }, 'Tavsiye (OTA %15)'),
        h('th', { class: 'num' }, 'Gerçekleşen ADR'),
        h('th', {}, 'Takvim Durumu'))),
      h('tbody', {}, ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: '8', class: 'empty' }, 'Oda yok.'))]))),
    totalLoss
      ? h('p', { class: 'alert-line' }, `⛔ ${totalLoss} odanın gerçekleşen ortalama fiyatı (ADR) alt limitin altında — bu odalar satıldıkça zarar ediyor.`)
      : null);
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
