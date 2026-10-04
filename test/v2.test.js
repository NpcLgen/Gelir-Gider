/**
 * PRD v2.0 testleri — restoran geliri/gün sonu (§2.1–§2.4), yabancı çalışan (§3.1),
 * döviz kuru servisi (§4.1) ve yedekleme/geri yükleme.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Veri ve yedek klasörleri modüller yüklenmeden önce ayarlanmalıdır.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'otel-v2-'));
process.env.DATA_DIR = DATA_DIR;
process.env.BACKUP_DIR = join(DATA_DIR, 'yedekler');

const {
  MAX_DAY_END_PER_DAY,
  createRestaurantIncome, validateRestaurantIncome, restaurantDayTotal, restaurantIncomeSummary,
  createRestaurantExpense, validateRestaurantExpense,
  createForeignWorker, validateForeignWorker,
  defaultTaxRates, taxReport,
} = await import('../src/core/finance.js');

const { FX_PROVIDERS, PROVIDER_MAP, fetchRate } = await import('../server/fx.js');
const backup = await import('../server/backup.js');
const { emptyDb, resetForTests, load } = await import('../server/db.js');

test.after(() => rmSync(DATA_DIR, { recursive: true, force: true }));

/* --------------------------------------- §2.1 / §2.3 restoran gün sonu -- */

test('aynı günün iki gün sonu kaydı toplanır (12.500 + 8.750 = 21.250)', () => {
  const incomes = [
    createRestaurantIncome({ date: '2026-03-10', sequence: 1, amount: 12500 }),
    createRestaurantIncome({ date: '2026-03-10', sequence: 2, amount: 8750 }),
  ];
  const day = restaurantDayTotal('2026-03-10', incomes);
  assert.equal(day.total, 21250);
  assert.equal(day.entries.length, 2);
  assert.deepEqual(day.entries.map((e) => e.sequence), [1, 2]);
});

test('bir güne en fazla iki gün sonu kaydı girilebilir', () => {
  assert.equal(MAX_DAY_END_PER_DAY, 2);
  const incomes = [
    createRestaurantIncome({ date: '2026-03-10', sequence: 1, amount: 12500 }),
    createRestaurantIncome({ date: '2026-03-10', sequence: 2, amount: 8750 }),
  ];
  const third = createRestaurantIncome({ date: '2026-03-10', sequence: 2, amount: 100 });
  const errors = validateRestaurantIncome(third, { incomes });
  assert.ok(errors.some((e) => e.includes('en fazla 2')), errors.join(' | '));
  assert.ok(errors.some((e) => e.includes('2. gün sonu zaten kayıtlı')), errors.join(' | '));
});

test('iptal edilen gün sonu kaydı hesaba ve sınıra girmez', () => {
  const incomes = [
    createRestaurantIncome({ date: '2026-03-11', sequence: 1, amount: 5000, active: false }),
    createRestaurantIncome({ date: '2026-03-11', sequence: 2, amount: 1000 }),
  ];
  assert.equal(restaurantDayTotal('2026-03-11', incomes).total, 1000);
  const replacement = createRestaurantIncome({ date: '2026-03-11', sequence: 1, amount: 4000 });
  assert.deepEqual(validateRestaurantIncome(replacement, { incomes }), []);
});

test('geçersiz gün sonu kaydı reddedilir', () => {
  const errors = validateRestaurantIncome(createRestaurantIncome({ date: '', amount: 0 }), {});
  assert.ok(errors.some((e) => e.includes('tarih')));
  assert.ok(errors.some((e) => e.includes('0’dan büyük')));
});

/* ------------------------------------------- §2.2 restoran KDV oranı ---- */

test('restoran KDV’si %10 iç yüzde ile hesaplanır', () => {
  const summary = restaurantIncomeSummary([
    createRestaurantIncome({ date: '2026-03-10', sequence: 1, amount: 11000 }),
  ], { kdvRate: 10 });
  // 11.000 × 10 / 110 = 1.000
  assert.equal(summary.kdv, 1000);
  assert.equal(summary.net, 10000);
  assert.equal(summary.gross, 11000);
  assert.equal(summary.days, 1);
});

test('KDV hariç girilen tutara KDV eklenir', () => {
  const summary = restaurantIncomeSummary([
    createRestaurantIncome({ date: '2026-03-10', sequence: 1, amount: 10000, kdvIncluded: false }),
  ], { kdvRate: 10 });
  assert.equal(summary.gross, 11000);
  assert.equal(summary.kdv, 1000);
});

test('restoran KDV oranı ayarlardan değiştirilebilir', () => {
  const summary = restaurantIncomeSummary([
    createRestaurantIncome({ date: '2026-03-10', sequence: 1, amount: 12000 }),
  ], { kdvRate: 20 });
  assert.equal(summary.kdv, 2000);
});

test('restoran geliri tarih aralığına göre süzülür', () => {
  const incomes = [
    createRestaurantIncome({ date: '2026-03-01', sequence: 1, amount: 1000 }),
    createRestaurantIncome({ date: '2026-04-01', sequence: 1, amount: 2000 }),
  ];
  const summary = restaurantIncomeSummary(incomes, { from: '2026-03-01', to: '2026-03-31', kdvRate: 10 });
  assert.equal(summary.count, 1);
  assert.equal(summary.gross, 1000);
});

/* --------------------------------------- §2.4 restoran ekstra giderleri - */

test('restoran ekstra gideri tutar ve kategori ister', () => {
  const errors = validateRestaurantExpense(createRestaurantExpense({ date: '2026-03-10', amount: 0 }));
  assert.ok(errors.length > 0);
  const ok = createRestaurantExpense({ date: '2026-03-10', amount: 450, category: 'Market', description: 'Peçete' });
  assert.deepEqual(validateRestaurantExpense(ok), []);
  // Tedarikçi cari bakiyesini etkilemez: kayıtta supplierId alanı yoktur.
  assert.equal(ok.supplierId, undefined);
});

/* ------------------------------------------------ §3.1 yabancı çalışan -- */

test('yabancı çalışan kaydı ad, dönem ve maaş ister', () => {
  const errors = validateForeignWorker(createForeignWorker({ name: '', amount: 0 }));
  assert.ok(errors.some((e) => e.includes('adı zorunludur')), errors.join(' | '));
  assert.ok(errors.some((e) => e.includes('dönem')), errors.join(' | '));
  assert.ok(errors.some((e) => e.includes('0’dan büyük')), errors.join(' | '));

  const worker = createForeignWorker({ name: 'John Doe', period: '2026-03', amount: 18000 });
  assert.deepEqual(validateForeignWorker(worker, { workers: [] }), []);
  // Aynı dönemde aynı isim iki kez girilemez.
  const clash = createForeignWorker({ name: 'john doe', period: '2026-03', amount: 18000 });
  assert.ok(validateForeignWorker(clash, { workers: [worker] }).some((e) => e.includes('zaten kayıtlı')));
  // Geçersiz ödeme tarihi reddedilir.
  const badDate = createForeignWorker({ name: 'Ann', period: '2026-03', amount: 100, paymentDate: '32.13.2026' });
  assert.ok(validateForeignWorker(badDate).some((e) => e.includes('Ödeme tarihi')));
});

test('yabancı çalışan maaşı gider olur ama vergi matrahından indirilmez', () => {
  const rates = { ...defaultTaxRates(), kdvIncome: 10, kdvRestaurant: 10, kdvExpense: 20, incomeTax: 25 };
  const indirilemez = 50000;
  const withBase = taxReport({ revenue: 1100000, expenses: 600000, nonDeductibleExpenses: indirilemez, rates });
  const without = taxReport({ revenue: 1100000, expenses: 600000, nonDeductibleExpenses: 0, rates });

  // Gider toplamı aynı kalır; yalnızca matrah indirilemeyen tutar kadar artar.
  assert.equal(withBase.expenses, without.expenses);
  assert.equal(withBase.netProfit, without.netProfit);
  assert.equal(withBase.taxBase, without.taxBase + indirilemez);
  assert.ok(withBase.incomeTax > without.incomeTax);
  assert.equal(withBase.incomeTax, Math.round(withBase.taxBase * 0.25 * 100) / 100);
});

test('varsayılan ayarda yabancı personel indirilemez, ayarla değiştirilebilir', () => {
  assert.equal(defaultTaxRates().foreignStaffDeductible, false);
  assert.equal(defaultTaxRates().kdvRestaurant, 10);
});

/* ------------------------------------- oda + restoran KDV'si ayrı ayrı -- */

test('konaklama ve restoran KDV’si ayrı oranlarla hesaplanır', () => {
  const rates = { ...defaultTaxRates(), kdvIncome: 10, kdvRestaurant: 20, kdvExpense: 20 };
  const report = taxReport({ revenue: 110000, restaurantRevenue: 120000, expenses: 0, rates });
  assert.equal(report.roomKdv, 10000);
  assert.equal(report.restaurantKdv, 20000);
  assert.equal(report.collectedKdv, 30000);
  assert.equal(report.totalRevenue, 230000);
  // Konaklama vergisi ve turizm payı yalnızca oda gelirinden alınır.
  assert.equal(report.accommodationTax, Math.round(100000 * 0.02 * 100) / 100);
});

test('indirilecek KDV hesaplanandan fazlaysa devreden KDV oluşur', () => {
  const rates = { ...defaultTaxRates(), kdvIncome: 10, kdvExpense: 20 };
  const report = taxReport({ revenue: 11000, expenses: 120000, rates });
  assert.equal(report.payableKdv, 0);
  assert.ok(report.carriedKdv > 0);
});

/* ------------------------------------------------------- §4.1 kur ------ */

const TCMB_XML = `<?xml version="1.0" encoding="ISO-8859-9"?>
<Tarih_Date Tarih="04.10.2026" Date="10/04/2026">
  <Currency CrossOrder="0" Kod="USD" CurrencyCode="USD">
    <ForexBuying>34,1234</ForexBuying><ForexSelling>34,2000</ForexSelling>
    <BanknoteSelling>34,3000</BanknoteSelling>
  </Currency>
  <Currency CrossOrder="9" Kod="EUR" CurrencyCode="EUR">
    <ForexBuying>37,1000</ForexBuying><ForexSelling>37,2000</ForexSelling>
    <BanknoteSelling>37,4500</BanknoteSelling>
  </Currency>
</Tarih_Date>`;

const fakeFetch = (bodies) => async (url) => {
  const key = Object.keys(bodies).find((k) => String(url).includes(k));
  if (key === undefined) throw new Error(`beklenmeyen adres: ${url}`);
  const value = bodies[key];
  if (value instanceof Error) throw value;
  return { ok: true, status: 200, text: async () => value };
};

test('TCMB efektif satış kuru ayrıştırılır', async () => {
  const result = await fetchRate({ currency: 'EUR', preferred: 'tcmb', fetchImpl: fakeFetch({ tcmb: TCMB_XML }) });
  assert.equal(result.rate, 37.45);
  assert.equal(result.provider, 'tcmb');
  assert.equal(result.sourceDate, '04.10.2026');
  assert.ok(result.fetchedAt);
});

test('TCMB döviz alış kaynağı ayrı alanı okur', async () => {
  const result = await fetchRate({ currency: 'EUR', preferred: 'tcmb_buy', fetchImpl: fakeFetch({ tcmb: TCMB_XML }) });
  assert.equal(result.rate, 37.1);
  assert.equal(result.provider, 'tcmb_buy');
});

test('ilk kaynak başarısızsa yedek kaynağa düşülür', async () => {
  const result = await fetchRate({
    currency: 'EUR',
    preferred: 'tcmb',
    fetchImpl: fakeFetch({
      'tcmb.gov.tr': new Error('ağ hatası'),
      'frankfurter.app': JSON.stringify({ date: '2026-10-03', rates: { TRY: 37.9 } }),
    }),
  });
  assert.equal(result.provider, 'frankfurter');
  assert.equal(result.rate, 37.9);
  assert.equal(result.attempts.length, 2, 'iki TCMB denemesi kaydedilir');
});

test('tüm kaynaklar başarısızsa açıklayıcı hata atılır (mevcut kur korunur)', async () => {
  await assert.rejects(
    () => fetchRate({ currency: 'EUR', fetchImpl: async () => { throw new Error('bağlantı yok'); } }),
    (err) => {
      assert.match(err.message, /Kur alınamadı/);
      assert.equal(err.attempts.length, FX_PROVIDERS.length);
      return true;
    },
  );
});

test('yanıtta para birimi yoksa hata verir', async () => {
  await assert.rejects(
    () => fetchRate({
      currency: 'GBP',
      preferred: 'tcmb',
      fetchImpl: fakeFetch({ 'tcmb.gov.tr': TCMB_XML, 'frankfurter.app': '{"rates":{}}' }),
    }),
    /Kur alınamadı/,
  );
});

test('kaynak listesi arayüzde gösterilecek etiketleri taşır', () => {
  assert.ok(FX_PROVIDERS.length >= 2);
  for (const provider of FX_PROVIDERS) {
    assert.ok(provider.key && provider.label, 'her kaynağın anahtarı ve etiketi olmalı');
    assert.equal(PROVIDER_MAP[provider.key], provider);
  }
});

/* --------------------------------------------- yedekleme / geri yükleme - */

/** Test verisi olan bir veritabanı kurar. */
async function seed() {
  const db = emptyDb();
  db.rooms = [{ id: 'r1', number: '101', name: 'Jakuzili Suit' }];
  db.expenses = [{ id: 'e1', amount: 1000, date: '2026-03-01' }];
  db.settings = { allocationMethod: 'weighted' };
  db.users = [{ id: 'u1', username: 'Admin', role: 'admin' }];
  db.restaurantIncomes = [createRestaurantIncome({ date: '2026-03-10', sequence: 1, amount: 12500 })];
  db.foreignWorkers = [createForeignWorker({ name: 'John Doe', period: '2026-03', amount: 18000 })];
  await resetForTests(db);
  return db;
}

test('yedek alınır, listelenir ve içeriği eksiksizdir', async () => {
  await seed();
  const created = await backup.createBackup({ reason: 'manuel', user: { username: 'Admin' } });
  assert.match(created.name, /^otel-yedek-.*-manuel\.json$/);
  assert.ok(created.size > 0);

  const list = await backup.listBackups();
  assert.ok(list.some((row) => row.name === created.name));

  const payload = await backup.readBackup(created.name);
  assert.equal(payload.format, 'otel-finans-yedek');
  assert.equal(payload.createdBy, 'Admin');
  assert.equal(payload.data.rooms.length, 1);
  assert.equal(payload.data.restaurantIncomes.length, 1);
  assert.equal(payload.data.foreignWorkers.length, 1);
  assert.deepEqual(backup.validateBackup(payload), []);
});

test('geçersiz yedek dosyası reddedilir', () => {
  assert.ok(backup.validateBackup({ hello: 'world' }).some((e) => e.includes('sistem yedeği değil')));
  assert.ok(backup.validateBackup({ format: 'otel-finans-yedek' }).some((e) => e.includes('okunamadı')));
  assert.ok(backup.validateBackup({
    format: 'otel-finans-yedek',
    data: { rooms: [], expenses: [] },
  }).some((e) => e.includes('settings')));
  assert.ok(backup.validateBackup({
    format: 'otel-finans-yedek',
    data: { rooms: [], expenses: [], settings: {}, users: [] },
  }).some((e) => e.includes('hiç kullanıcı yok')));
  assert.ok(backup.validateBackup({
    format: 'otel-finans-yedek',
    version: 9999,
    data: { rooms: [], expenses: [], settings: {} },
  }).some((e) => e.includes('daha yeni bir sürümden')));
});

test('yedek dosya adı doğrulanır (dizin dışına çıkılamaz)', async () => {
  await assert.rejects(() => backup.readBackup('../db.json'), /Geçersiz yedek dosyası adı/);
  await assert.rejects(() => backup.deleteBackup('/etc/passwd'), /Geçersiz yedek dosyası adı/);
});

test('geri yükleme verileri yedekteki haline döndürür ve güvenlik yedeği alır', async () => {
  await seed();
  const created = await backup.createBackup({ reason: 'manuel' });
  const payload = await backup.readBackup(created.name);

  // Veriler değişsin: geri yükleme bunları eski haline döndürmeli.
  await resetForTests({ ...emptyDb(), rooms: [], users: [{ id: 'u9', username: 'Baska' }] });
  assert.equal((await load()).rooms.length, 0);

  const result = await backup.restoreBackup(payload, { user: { username: 'Admin' } });
  assert.match(result.safety.name, /geri-yukleme-oncesi/);

  const db = await load();
  assert.equal(db.rooms.length, 1);
  assert.equal(db.rooms[0].number, '101');
  assert.equal(db.restaurantIncomes.length, 1);
  assert.equal(db.users[0].username, 'Admin', 'kullanıcılar da yedekten gelir');
});

test('kullanıcıları koru seçeneği mevcut hesapları bırakır', async () => {
  await seed();
  const payload = await backup.readBackup((await backup.createBackup({ reason: 'manuel' })).name);
  await resetForTests({ ...emptyDb(), users: [{ id: 'u9', username: 'Mevcut', role: 'admin' }] });

  await backup.restoreBackup(payload, { keepUsers: true });
  const db = await load();
  assert.equal(db.users.length, 1);
  assert.equal(db.users[0].username, 'Mevcut', 'oturumdaki hesaplar korunur');
  assert.equal(db.rooms.length, 1, 'diğer veriler yine geri yüklenir');
});

test('bozuk yedek geri yüklenmez', async () => {
  await seed();
  await assert.rejects(() => backup.restoreBackup({ format: 'yok' }), /sistem yedeği değil/);
  assert.equal((await load()).rooms.length, 1, 'veri bozulmadı');
});

test('eski yedekler budanır, en yeniler kalır', async () => {
  await seed();
  const names = [];
  for (let i = 0; i < 4; i += 1) {
    names.push((await backup.createBackup({ reason: `test${i}` })).name);
    await new Promise((r) => setTimeout(r, 1100)); // dosya adı saniye hassasiyetinde
  }
  const removed = await backup.pruneBackups(2);
  const left = await backup.listBackups();
  assert.equal(left.length, 2);
  assert.ok(removed.length >= 2);
  assert.ok(left.every((row) => !removed.includes(row.name)));
});
