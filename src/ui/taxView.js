/** Vergi Raporu — KDV, konaklama vergisi, turizm payı ve gelir vergisi (PRD §5.1). */

import { defaultTaxRates, employeeTotal, taxReport } from '../core/finance.js';
import { formatMoney, formatPercent } from '../core/format.js';
import { clear, errorList, field, h, toast } from './dom.js';

/**
 * Dönemin vergi tabanlarını toplar.
 * Gider KDV tabanı: yalnızca belgeli (toptancı faturaları + tedarikçili giderler)
 * kalemler indirilecek KDV üretir; personel maaşı gibi kalemler üretmez.
 */
export function taxInputs(app) {
  const state = app.store.getState();
  const report = app.report();
  const p = app.period();

  const supplierInvoices = state.supplierTxns.filter((t) => t.active !== false
    && t.type === 'invoice' && t.date >= p.from && t.date <= p.to);
  const supplierTotal = supplierInvoices.reduce((sum, t) => sum + t.amount, 0);
  const supplierKdv = supplierInvoices.reduce((sum, t) => sum + (t.amount * t.kdvRate) / (100 + t.kdvRate), 0);

  const month = p.from.slice(0, 7);
  const payroll = state.employees
    .filter((e) => e.active !== false && e.period === month)
    .reduce((sum, e) => sum + employeeTotal(e), 0)
    + state.extraWorkers.filter((w) => w.active !== false && w.date >= p.from && w.date <= p.to)
      .reduce((sum, w) => sum + w.amount, 0);

  // Belgeli giderler: dönemdeki gider kalemlerinin tedarikçisi olanlar.
  const documented = report.expenses
    .filter((e) => e.vendor)
    .reduce((sum, e) => sum + e.amountBase, 0);

  return {
    revenue: report.totals.revenue,
    expensesTotal: Math.round((report.totals.expenses + payroll + supplierTotal) * 100) / 100,
    payroll: Math.round(payroll * 100) / 100,
    supplierTotal: Math.round(supplierTotal * 100) / 100,
    supplierKdv: Math.round(supplierKdv * 100) / 100,
    documented: Math.round(documented * 100) / 100,
    kdvBase: Math.round((documented + supplierTotal) * 100) / 100,
  };
}

export function taxView(app) {
  const settings = app.store.getState().settings;
  const rates = { ...defaultTaxRates(), ...(settings.tax ?? {}) };
  const inputs = taxInputs(app);
  const p = app.period();

  const report = taxReport({
    revenue: inputs.revenue,
    expenses: inputs.expensesTotal,
    expenseKdvBase: inputs.kdvBase,
    rates,
  });

  const canEdit = app.can('ayarlar');

  return h('div', { class: 'stack print-area' },
    h('div', { class: 'row between center wrap gap no-print' },
      h('div', {},
        h('h1', {}, 'Vergi Raporu'),
        h('p', { class: 'muted' }, `${p.from} → ${p.to} · tüm hesaplar sistemdeki kayıtlı verilerden üretilir.`)),
      h('button', {
        class: 'btn', type: 'button',
        onClick: () => app.openPrintDialog('Vergi Raporu'),
      }, '🖨️ Yazdır')),

    h('div', { class: 'kpi-grid' },
      kpi('Hesaplanan KDV', formatMoney(report.collectedKdv), `Gelir üzerinden %${rates.kdvIncome}`),
      kpi('İndirilecek KDV', formatMoney(report.deductibleKdv), `Belgeli gider üzerinden %${rates.kdvExpense}`),
      kpi(report.netKdv >= 0 ? 'Ödenecek Net KDV' : 'Devreden KDV',
        formatMoney(Math.abs(report.netKdv)),
        'Hesaplanan − İndirilecek', report.netKdv > 0 ? 'bad' : 'good'),
      kpi('Net Kâr (vergi öncesi)', formatMoney(report.netProfit), 'KDV hariç', report.netProfit >= 0 ? 'good' : 'bad')),

    h('section', { class: 'card table-card' },
      h('header', { class: 'card-header' }, h('h3', {}, 'Vergi Kalemleri')),
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Vergi Kalemi'), h('th', {}, 'Matrah / Açıklama'),
          h('th', { class: 'num' }, 'Oran'), h('th', { class: 'num' }, 'Tutar'))),
        h('tbody', {},
          taxRow('KDV (hesaplanan)', 'Konaklama geliri (KDV dahil)', `%${rates.kdvIncome}`, report.collectedKdv),
          taxRow('KDV (indirilecek)', 'Belgeli gider ve toptancı faturaları', `%${rates.kdvExpense}`, -report.deductibleKdv),
          taxRow(report.netKdv >= 0 ? 'Ödenecek Net KDV' : 'Devreden KDV', 'Hesaplanan − İndirilecek', '—', report.netKdv, true),
          taxRow('Konaklama Vergisi', 'KDV hariç konaklama geliri', `%${rates.accommodationTax}`, report.accommodationTax),
          taxRow('Turizm Payı', 'KDV hariç konaklama geliri', `%${rates.tourismShare}`, report.tourismShare),
          taxRow('Net Kâr', 'KDV hariç gelir − gider − konaklama v. − turizm payı', '—', report.netProfit, true),
          taxRow('Gelir / Kurumlar Vergisi', 'Net kâr üzerinden', `%${rates.incomeTax}`, report.incomeTax),
          taxRow('Vergi Sonrası Net Kâr', 'Tüm vergiler düşüldükten sonra', '—', report.netProfitAfterTax, true)))),

    h('section', { class: 'card stack' },
      h('h3', {}, 'Hesaplamaya Giren Tutarlar'),
      h('div', { class: 'kv-list' },
        kv('Konaklama geliri (KDV dahil)', formatMoney(inputs.revenue)),
        kv('Toplam gider', formatMoney(inputs.expensesTotal)),
        kv('— personel ve ekstra çalışan', formatMoney(inputs.payroll)),
        kv('— toptancı faturaları', formatMoney(inputs.supplierTotal)),
        kv('KDV indirimine esas belgeli gider', formatMoney(inputs.kdvBase))),
      h('p', { class: 'muted small' },
        'Personel ödemeleri KDV doğurmadığı için indirilecek KDV matrahına dahil edilmez.')),

    canEdit ? rateEditor(app, rates) : h('p', { class: 'muted small no-print' },
      'Vergi oranlarını değiştirmek için "Ayarlar" yetkisi gerekir.'));
}

function taxRow(label, base, rate, amount, strong = false) {
  return h('tr', { class: strong ? 'row-strong' : '' },
    h('td', {}, strong ? h('strong', {}, label) : label),
    h('td', { class: 'muted small' }, base),
    h('td', { class: 'num' }, rate),
    h('td', { class: `num ${amount < 0 ? 'good' : ''}` },
      strong ? h('strong', {}, formatMoney(amount)) : formatMoney(amount)));
}

function rateEditor(app, rates) {
  const draft = { ...rates };
  const errorBox = h('div', { class: 'error-box hidden' });

  const inputs = [
    ['kdvIncome', 'Gelir KDV Oranı (%)', 'Konaklama hizmetlerinde hesaplanan KDV.'],
    ['kdvExpense', 'Gider KDV Oranı (%)', 'Belgeli giderlerde indirilecek KDV.'],
    ['accommodationTax', 'Konaklama Vergisi (%)', 'KDV hariç konaklama geliri üzerinden.'],
    ['tourismShare', 'Turizm Payı (%)', 'KDV hariç konaklama geliri üzerinden.'],
    ['incomeTax', 'Gelir / Kurumlar Vergisi (%)', 'Net kâr üzerinden.'],
  ];

  return h('section', { class: 'card stack no-print' },
    h('h3', {}, 'Vergi Oranları'),
    h('p', { class: 'muted small' }, 'Oranlar sabit kodlanmamıştır; mevzuat değiştiğinde buradan güncellenir.'),
    errorBox,
    h('div', { class: 'grid-3' }, ...inputs.map(([key, label, hint]) =>
      field(label, h('input', {
        type: 'number', min: '0', max: '100', step: 'any', value: draft[key], class: `tax-${key}`,
        onInput: (e) => { draft[key] = Number(e.target.value); },
      }), hint))),
    h('div', { class: 'row gap' },
      h('button', {
        class: 'btn primary', type: 'button',
        onClick: async () => {
          clear(errorBox).classList.add('hidden');
          try {
            await app.store.saveTaxRates(draft);
            toast('Vergi oranları güncellendi.');
            app.refresh();
          } catch (err) {
            clear(errorBox).appendChild(errorList(err.errors ?? [err.message]));
            errorBox.classList.remove('hidden');
          }
        },
      }, '💾 Oranları Kaydet'),
      h('button', {
        class: 'btn ghost', type: 'button',
        onClick: async () => { await app.store.saveTaxRates(defaultTaxRates()); app.refresh(); toast('Varsayılan oranlara dönüldü.'); },
      }, '↺ Varsayılanlar')));
}

function kpi(label, value, hint, tone) {
  return h('div', { class: 'card kpi' },
    h('span', { class: 'muted small' }, label),
    h('strong', { class: tone || '' }, value),
    h('span', { class: 'muted small' }, hint));
}

const kv = (label, value) => h('div', { class: 'kv' }, h('span', {}, label), h('strong', {}, value));
