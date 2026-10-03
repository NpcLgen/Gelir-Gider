/** PRD §3 (personel), §4 (toptancı cari), §5 (vergi, kasa) hesaplamaları. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cashSummary, createCashDay, createEmployee, createExtraWorker, createSupplier, createSupplierTxn,
  defaultTaxRates, employeeTotal, supplierBalance, taxReport, validateCashDay, validateEmployee,
  validateExtraWorker, validateSupplier, validateSupplierTxn, validateTaxRates,
} from '../src/core/finance.js';

/* ------------------------------------------------ §3.2 Çalışanlar ------- */

test('personel maaş ve SGK ayrı tutulur, toplam dönem gideridir', () => {
  const employee = createEmployee({ name: 'Ayşe Yıldız', period: '2026-10', netSalary: 32000, sgk: 11500 });
  assert.equal(employeeTotal(employee), 43500);
  assert.deepEqual(validateEmployee(employee, { employees: [] }), []);
});

test('aynı personel aynı dönemde iki kez kaydedilemez', () => {
  const existing = createEmployee({ id: 'e1', name: 'Ayşe Yıldız', period: '2026-10', netSalary: 32000 });
  const duplicate = createEmployee({ name: 'ayşe yıldız', period: '2026-10', netSalary: 30000 });
  const errors = validateEmployee(duplicate, { employees: [existing] });
  assert.ok(errors.some((e) => e.includes('zaten kayıtlı')), errors.join('|'));
});

test('personel kaydı dönem ve negatif tutar doğrulaması yapar', () => {
  const errors = validateEmployee(createEmployee({ name: '', period: 'hatalı', netSalary: -5 }), {});
  assert.ok(errors.some((e) => e.includes('Personel adı')));
  assert.ok(errors.some((e) => e.includes('dönem')));
  assert.ok(errors.some((e) => e.includes('Net maaş')));
});

/* --------------------------------------------- §3.3 Ekstra çalışan ------ */

test('ekstra çalışan ödemesi tarih ve tutar ister', () => {
  assert.deepEqual(validateExtraWorker(createExtraWorker({ name: 'Yardımcı', date: '2026-10-05', amount: 1500 })), []);
  const errors = validateExtraWorker(createExtraWorker({ name: '', date: 'x', amount: 0 }));
  assert.equal(errors.length, 3);
});

/* ------------------------------------------------- §4.2 Toptancı cari --- */

test('fatura borcu artırır, ödeme azaltır; bakiye yürüyen olarak hesaplanır', () => {
  const supplier = createSupplier({ id: 'sup_1', name: 'Anadolu Gıda' });
  const txns = [
    createSupplierTxn({ supplierId: 'sup_1', type: 'invoice', date: '2026-10-02', amount: 12000, invoiceNo: 'A-1001' }),
    createSupplierTxn({ supplierId: 'sup_1', type: 'payment', date: '2026-10-10', amount: 5000 }),
    createSupplierTxn({ supplierId: 'sup_1', type: 'invoice', date: '2026-10-15', amount: 3000, invoiceNo: 'A-1042' }),
  ];
  const balance = supplierBalance(supplier.id, txns);
  assert.equal(balance.totalDebt, 15000);
  assert.equal(balance.totalPaid, 5000);
  assert.equal(balance.balance, 10000);
  assert.deepEqual(balance.ledger.map((l) => l.runningBalance), [12000, 7000, 10000]);
});

test('cari hesap tarih aralığına göre filtrelenir', () => {
  const txns = [
    createSupplierTxn({ supplierId: 's1', type: 'invoice', date: '2026-09-20', amount: 8000, invoiceNo: 'E-1' }),
    createSupplierTxn({ supplierId: 's1', type: 'invoice', date: '2026-10-05', amount: 2000, invoiceNo: 'E-2' }),
  ];
  const ekim = supplierBalance('s1', txns, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(ekim.totalDebt, 2000);
  assert.equal(ekim.ledger.length, 1);
});

test('pasif cari hareket bakiyeye girmez', () => {
  const txns = [
    createSupplierTxn({ supplierId: 's1', type: 'invoice', date: '2026-10-02', amount: 1000, invoiceNo: 'X-1' }),
    createSupplierTxn({ supplierId: 's1', type: 'invoice', date: '2026-10-03', amount: 9999, invoiceNo: 'X-2', active: false }),
  ];
  assert.equal(supplierBalance('s1', txns).balance, 1000);
});

test('fatura kaydı fatura numarası zorunlu kılar, ödeme kılmaz', () => {
  const suppliers = [createSupplier({ id: 's1', name: 'Tedarik' })];
  const fatura = createSupplierTxn({ supplierId: 's1', type: 'invoice', date: '2026-10-02', amount: 100 });
  assert.ok(validateSupplierTxn(fatura, { suppliers }).some((e) => e.includes('Fatura numarası')));
  const odeme = createSupplierTxn({ supplierId: 's1', type: 'payment', date: '2026-10-02', amount: 100 });
  assert.deepEqual(validateSupplierTxn(odeme, { suppliers }), []);
});

test('aynı isimli toptancı iki kez eklenemez', () => {
  const suppliers = [createSupplier({ id: 's1', name: 'Anadolu Gıda' })];
  const errors = validateSupplier(createSupplier({ name: 'anadolu gıda' }), { suppliers });
  assert.ok(errors.some((e) => e.includes('zaten kayıtlı')));
});

/* ---------------------------------------------------- §5.2 Kasa --------- */

test('kasa denk olduğunda fark yok bildirilir', () => {
  const summary = cashSummary({ date: '2026-10-05', openingCash: 2000, income: 9000, expense: 3000, countedCash: 8000 });
  assert.equal(summary.expectedCash, 8000);
  assert.equal(summary.difference, 0);
  assert.equal(summary.statusLabel, 'Denk / Fark Yok');
});

test('sayılan kasa eksikse kasa açığı bildirilir', () => {
  const summary = cashSummary({ date: '2026-10-05', openingCash: 0, income: 5000, expense: 1000, countedCash: 3850 });
  assert.equal(summary.expectedCash, 4000);
  assert.equal(summary.difference, -150);
  assert.equal(summary.status, 'shortage');
  assert.equal(summary.statusLabel, 'Kasa Açığı');
});

test('sayılan kasa fazlaysa kasa fazlası bildirilir', () => {
  const summary = cashSummary({ date: '2026-10-05', openingCash: 0, income: 5000, expense: 1000, countedCash: 4200 });
  assert.equal(summary.difference, 200);
  assert.equal(summary.statusLabel, 'Kasa Fazlası');
});

test('aynı güne iki gün sonu kaydı doğrulaması modelde tarih ister', () => {
  assert.deepEqual(validateCashDay(createCashDay({ date: '2026-10-05', countedCash: 1000 })), []);
  assert.ok(validateCashDay(createCashDay({ date: '', countedCash: 1000 })).length);
});

/* ---------------------------------------------------- §5.1 Vergi -------- */

test('ödenecek net KDV = hesaplanan − indirilecek', () => {
  // 110.000 TL gelir, %10 KDV dahil → 10.000 TL hesaplanan KDV
  // 60.000 TL belgeli gider, %20 KDV dahil → 10.000 TL indirilecek KDV
  const report = taxReport({ revenue: 110000, expenses: 60000, rates: { ...defaultTaxRates(), kdvIncome: 10, kdvExpense: 20 } });
  assert.equal(report.collectedKdv, 10000);
  assert.equal(report.deductibleKdv, 10000);
  assert.equal(report.netKdv, 0);
  assert.equal(report.payableKdv, 0);
});

test('indirilecek KDV fazlaysa devreden KDV oluşur', () => {
  const report = taxReport({ revenue: 11000, expenses: 60000 });
  assert.ok(report.netKdv < 0);
  assert.equal(report.payableKdv, 0);
  assert.equal(report.carriedKdv, Math.abs(report.netKdv));
});

test('konaklama vergisi ve turizm payı KDV hariç gelir üzerinden hesaplanır', () => {
  const report = taxReport({ revenue: 110000, expenses: 0, rates: { ...defaultTaxRates(), kdvIncome: 10, accommodationTax: 2, tourismShare: 0.75 } });
  assert.equal(report.netRevenue, 100000);
  assert.equal(report.accommodationTax, 2000);
  assert.equal(report.tourismShare, 750);
});

test('gelir vergisi net kâr üzerinden hesaplanır, zararda sıfırdır', () => {
  const karli = taxReport({ revenue: 110000, expenses: 12000, rates: { ...defaultTaxRates(), incomeTax: 25 } });
  assert.equal(karli.incomeTax, Math.round(Math.max(0, karli.netProfit) * 0.25 * 100) / 100);
  const zararli = taxReport({ revenue: 11000, expenses: 90000 });
  assert.ok(zararli.netProfit < 0);
  assert.equal(zararli.incomeTax, 0);
});

test('vergi oranları değiştirilebilir ve doğrulanır', () => {
  assert.deepEqual(validateTaxRates(defaultTaxRates()), []);
  assert.ok(validateTaxRates({ ...defaultTaxRates(), kdvIncome: 150 }).length);
  assert.ok(validateTaxRates({ ...defaultTaxRates(), incomeTax: -1 }).length);

  const dusukKdv = taxReport({ revenue: 110000, expenses: 0, rates: { ...defaultTaxRates(), kdvIncome: 1 } });
  assert.ok(dusukKdv.collectedKdv < 2000, 'oran değişimi KDV’yi etkilemeli');
});

test('KDV matrahı ayrı verilebilir (personel gideri KDV doğurmaz)', () => {
  const report = taxReport({ revenue: 110000, expenses: 100000, expenseKdvBase: 60000 });
  // Yalnızca 60.000 TL belgeli gider KDV indirimi üretir
  assert.equal(report.deductibleKdv, Math.round((60000 * 20) / 120 * 100) / 100);
});
