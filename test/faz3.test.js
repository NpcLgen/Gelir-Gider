/** Faz 3.0 — Dashboard göstergeleri ve gelir vergisi algoritması (PRD III §4). */

import test from 'node:test';
import assert from 'node:assert/strict';

const { businessSummary, vatInside } = await import('../src/core/summary.js');

const RATES = { kdvIncome: 10, kdvRestaurant: 10, accommodationTax: 2, tourismShare: 0.75, incomeTax: 25 };

test('KDV iç yüzdeyle hesaplanır', () => {
  assert.equal(vatInside(110000, 10), 10000);
  assert.equal(vatInside(120, 20), 20);
  assert.equal(vatInside(0, 10), 0);
});

test('otel ve restoran geliri ayrı gösterilir', () => {
  const s = businessSummary({ hotelRevenue: 110000, restaurantRevenue: 55000, rates: RATES });
  assert.equal(s.hotelRevenue, 110000);
  assert.equal(s.restaurantRevenue, 55000);
  assert.equal(s.totalRevenue, 165000);
});

test('gelir KDV’si otel ve restoran oranlarıyla toplanır', () => {
  const s = businessSummary({ hotelRevenue: 110000, restaurantRevenue: 55000, rates: { ...RATES, kdvRestaurant: 10 } });
  assert.equal(s.hotelVat, 10000);
  assert.equal(s.restaurantVat, 5000);
  assert.equal(s.incomeVat, 15000);
});

test('restoran KDV oranı ayrı tutulur', () => {
  const s = businessSummary({ hotelRevenue: 110000, restaurantRevenue: 120000, rates: { ...RATES, kdvRestaurant: 20 } });
  assert.equal(s.hotelVat, 10000);
  assert.equal(s.restaurantVat, 20000);
});

test('turizm payı ve konaklama vergisi SADECE otel geliri üzerinden hesaplanır', () => {
  const restoransiz = businessSummary({ hotelRevenue: 110000, restaurantRevenue: 0, rates: RATES });
  const restoranli = businessSummary({ hotelRevenue: 110000, restaurantRevenue: 500000, rates: RATES });
  assert.equal(restoransiz.accommodationTax, restoranli.accommodationTax, 'restoran geliri etkilememeli');
  assert.equal(restoransiz.tourismShare, restoranli.tourismShare);
  // KDV hariç otel geliri 100.000 → %2 = 2.000 · %0,75 = 750
  assert.equal(restoranli.accommodationTax, 2000);
  assert.equal(restoranli.tourismShare, 750);
});

test('gider KDV’si doğrudan fatura farkından gelir', () => {
  const s = businessSummary({ hotelRevenue: 110000, expenseVat: 6599.02, rates: RATES });
  assert.equal(s.expenseVat, 6599.02);
  assert.equal(s.netVat, 3400.98, 'hesaplanan 10.000 − indirilecek 6.599,02');
});

test('gelir vergisi dört adımlı algoritmayla hesaplanır', () => {
  const s = businessSummary({
    hotelRevenue: 110000,       // 1. adım
    restaurantRevenue: 55000,
    expenses: 90000,            // sigortalı maaşlar dâhil
    payroll: 40000,
    expenseVat: 5000,
    rates: RATES,
  });
  // Adım 1: 110.000 + 55.000 = 165.000
  assert.equal(s.totalRevenue, 165000);
  // Adım 2: 90.000 + 5.000 + 2.000 + 750 = 97.750
  assert.equal(s.totalDeductions, 97750);
  // Adım 3: 165.000 − 97.750 = 67.250
  assert.equal(s.taxBase, 67250);
  // Adım 4: 67.250 × %25 = 16.812,50
  assert.equal(s.incomeTax, 16812.5);
  // Net kâr: 67.250 − 16.812,50 = 50.437,50
  assert.equal(s.netProfit, 50437.5);
});

test('maaşlar toplam giderin içindedir, iki kez düşülmez', () => {
  const s = businessSummary({ hotelRevenue: 110000, expenses: 90000, payroll: 40000, rates: RATES });
  assert.equal(s.totalExpenses, 90000);
  assert.equal(s.payroll, 40000);
  assert.equal(s.otherExpenses, 50000);
  // İndirimler: 90.000 + 0 + 2.000 + 750
  assert.equal(s.totalDeductions, 92750);
});

test('matrah negatifse gelir vergisi sıfırdır, net kâr zarar gösterir', () => {
  const s = businessSummary({ hotelRevenue: 11000, expenses: 90000, rates: RATES });
  assert.ok(s.taxBase < 0);
  assert.equal(s.incomeTax, 0);
  assert.equal(s.netProfit, s.taxBase, 'zararda vergi kesilmez');
});

test('kur farkı gelire ve gidere yansır', () => {
  const temiz = businessSummary({ hotelRevenue: 110000, expenses: 10000, rates: RATES });
  const farkli = businessSummary({
    hotelRevenue: 110000, expenses: 10000, exchangeGain: 500, exchangeLoss: 200, rates: RATES,
  });
  assert.equal(farkli.totalRevenueWithFx, 110500);
  assert.equal(farkli.totalExpenses, 10200);
  assert.equal(farkli.taxBase, temiz.taxBase + 500 - 200);
});

test('vergi oranı değişince vergi ve net kâr güncellenir', () => {
  const base = { hotelRevenue: 110000, restaurantRevenue: 55000, expenses: 90000, expenseVat: 5000 };
  const yuzde25 = businessSummary({ ...base, rates: RATES });
  const yuzde20 = businessSummary({ ...base, rates: { ...RATES, incomeTax: 20 } });
  assert.equal(yuzde20.incomeTax, 13450);
  assert.ok(yuzde20.netProfit > yuzde25.netProfit);
});

test('kâr marjı kur farkı dâhil gelire göre hesaplanır', () => {
  const s = businessSummary({ hotelRevenue: 110000, expenses: 10000, rates: RATES });
  assert.ok(Math.abs(s.margin - s.netProfit / s.totalRevenueWithFx) < 1e-9);
  assert.equal(businessSummary({ rates: RATES }).margin, 0, 'gelir yoksa marj 0');
});
