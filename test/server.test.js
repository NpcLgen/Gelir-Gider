/**
 * Sunucu API testleri — PRD §1 (giriş), §2.1 (Excel), §3–§5 (veri), §6–§7 (yetki).
 * Gerçek HTTP sunucusu geçici bir veri klasörüyle ayağa kaldırılır.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Veri klasörü, modüller yüklenmeden önce ayarlanmalıdır.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'otel-test-'));
process.env.DATA_DIR = DATA_DIR;

const { createStaticServer } = await import('../scripts/serve.js');
const { ensureDefaultAdmin, DEFAULT_ADMIN } = await import('../server/auth.js');
const { exportWorkbook, parseWorkbook, TEMPLATES } = await import('../server/excel.js');

await ensureDefaultAdmin();

const server = createStaticServer();
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  rmSync(DATA_DIR, { recursive: true, force: true });
});

/** Basit çerez taşıyan istemci. */
function client() {
  let cookie = '';
  const call = async (method, path, { body, raw, headers = {} } = {}) => {
    const options = { method, headers: { ...headers } };
    if (cookie) options.headers.cookie = cookie;
    if (raw) { options.body = raw; options.headers['content-type'] = 'application/octet-stream'; }
    else if (body !== undefined) { options.body = JSON.stringify(body); options.headers['content-type'] = 'application/json'; }

    const response = await fetch(base + path, options);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const type = response.headers.get('content-type') ?? '';
    const payload = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, body: payload };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, body) => call('POST', p, { body }),
    put: (p, body) => call('PUT', p, { body }),
    del: (p) => call('DELETE', p),
    raw: (p, raw) => call('POST', p, { raw }),
  };
}

const admin = client();

/* ------------------------------------------------- §1.1 Giriş ve güvenlik -- */

test('oturum açılmadan veri uçlarına erişilemez', async () => {
  const anon = client();
  assert.equal((await anon.get('/api/state')).status, 401);
  assert.equal((await anon.post('/api/rooms', { number: '1' })).status, 401);
  assert.equal((await anon.get('/api/users')).status, 401);
});

test('hatalı kullanıcı adı veya şifre aynı mesajla reddedilir', async () => {
  const anon = client();
  const yanlisSifre = await anon.post('/api/auth/login', { username: DEFAULT_ADMIN.username, password: 'yanlis' });
  const yokKullanici = await anon.post('/api/auth/login', { username: 'olmayan', password: 'Admin2026' });
  assert.equal(yanlisSifre.status, 401);
  assert.equal(yokKullanici.status, 401);
  // Kullanıcının var olup olmadığı sızdırılmamalı.
  assert.equal(yanlisSifre.body.error, yokKullanici.body.error);
});

test('varsayılan Admin hesabıyla giriş yapılır ve şifre değiştirmesi istenir', async () => {
  const response = await admin.post('/api/auth/login', DEFAULT_ADMIN);
  assert.equal(response.status, 200);
  assert.equal(response.body.user.username, 'Admin');
  assert.equal(response.body.user.isAdmin, true);
  assert.equal(response.body.user.mustChangePassword, true);
});

test('şifre politikası uygulanır ve şifre değiştirilebilir', async () => {
  const zayif = await admin.post('/api/auth/password', { currentPassword: DEFAULT_ADMIN.password, newPassword: 'abc' });
  assert.equal(zayif.status, 422);

  const yanlisMevcut = await admin.post('/api/auth/password', { currentPassword: 'yanlis', newPassword: 'Otel2026Guvenli' });
  assert.equal(yanlisMevcut.status, 401);

  const ok = await admin.post('/api/auth/password', { currentPassword: DEFAULT_ADMIN.password, newPassword: 'Otel2026Guvenli' });
  assert.equal(ok.status, 200);
  const me = await admin.get('/api/auth/me');
  assert.equal(me.body.user.mustChangePassword, false);
});

/* ------------------------------------------- §6 Yetkilendirme -------------- */

const resepsiyon = client();

test('Admin sınırlı yetkili kullanıcı oluşturur', async () => {
  const response = await admin.post('/api/users', {
    username: 'resepsiyon', displayName: 'Ön Büro', password: 'Resepsiyon2026',
    permissions: { dashboard: true, gelirler: true, fiyatGirisi: true },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.isAdmin, false);
  assert.equal(response.body.permissions.gelirler, true);
  assert.equal(response.body.permissions.calisanlar, false);

  const login = await resepsiyon.post('/api/auth/login', { username: 'resepsiyon', password: 'Resepsiyon2026' });
  assert.equal(login.status, 200);
});

test('yetkisiz modüllerde API isteği 403 döner', async () => {
  const denemeler = [
    ['POST', '/api/employees', { name: 'X', period: '2026-10' }],
    ['POST', '/api/suppliers', { name: 'Toptancı' }],
    ['POST', '/api/cashDays', { date: '2026-10-01', countedCash: 100 }],
    ['PUT', '/api/settings', { targetMargin: 0.1 }],
  ];
  for (const [method, path, body] of denemeler) {
    const response = method === 'PUT' ? await resepsiyon.put(path, body) : await resepsiyon.post(path, body);
    assert.equal(response.status, 403, `${path} engellenmeli`);
    assert.match(response.body.error, /yetkiniz bulunmuyor/);
  }
});

test('kullanıcı yönetimi yalnızca Admin tarafından yapılabilir', async () => {
  assert.equal((await resepsiyon.get('/api/users')).status, 403);
  assert.equal((await resepsiyon.post('/api/users', { username: 'yeni', password: 'Yeni12345' })).status, 403);
});

test('yetkisiz kullanıcıya kişisel veriler maskelenerek döner', async () => {
  await admin.post('/api/employees', { name: 'Ayşe Yıldız', period: '2026-10', netSalary: 32000, sgk: 11500 });
  const state = await resepsiyon.get('/api/state');
  assert.equal(state.status, 200);
  const employee = state.body.employees[0];
  assert.equal(employee.masked, true);
  assert.equal(employee.name, '•••');
  // Tutarlar korunur, böylece toplamlar şaşmaz.
  assert.equal(employee.netSalary, 32000);
  assert.deepEqual(state.body.users, []);
});

test('sistemde en az bir aktif Admin kalmalıdır', async () => {
  const me = await admin.get('/api/auth/me');
  const response = await admin.post('/api/users', { id: me.body.user.id, username: 'Admin', isAdmin: false });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /en az bir aktif Admin/);
});

test('pasif kullanıcı giriş yapamaz', async () => {
  const created = await admin.post('/api/users', { username: 'pasifkul', password: 'Pasif12345', active: false });
  assert.equal(created.status, 200);
  const anon = client();
  assert.equal((await anon.post('/api/auth/login', { username: 'pasifkul', password: 'Pasif12345' })).status, 401);
});

/* ----------------------------------------------- §3–§5 Veri uçları --------- */

test('oda ve gider kaydedilir; doğrulama sunucuda yapılır', async () => {
  const oda = await admin.post('/api/rooms', {
    number: '101', name: 'King Suite', beds: [{ type: 'double', count: 1 }], maxOccupancy: 2, area: 30,
  });
  assert.equal(oda.status, 200);

  const eksik = await admin.post('/api/expenses', { date: '2026-10-05', description: '', amount: 0 });
  assert.equal(eksik.status, 422);

  const gecerli = await admin.post('/api/expenses', {
    date: '2026-10-05', category: 'other', description: 'Temizlik malzemesi', amount: 2500,
  });
  assert.equal(gecerli.status, 200);
});

test('rezervasyon modülü sistemden kaldırıldı (PRD III §2)', async () => {
  // Uç nokta artık yok: 404 döner, menüde ve modül listesinde de yer almaz.
  const kayit = await admin.post('/api/reservations', { guestName: 'Yılmaz', guests: 2 });
  assert.equal(kayit.status, 404);

  const state = await admin.get('/api/state');
  assert.ok(!state.body.modules.some((m) => m.key === 'rezervasyonlar'), 'modül listesinde kalmamalı');
});

test('toptancı cari hareketleri kaydedilir ve bakiye hesaplanır', async () => {
  const supplier = await admin.post('/api/suppliers', { name: 'Anadolu Gıda', category: 'Gıda' });
  await admin.post('/api/supplierTxns', { supplierId: supplier.body.id, type: 'invoice', date: '2026-10-02', amount: 12000, invoiceNo: 'A-1001' });
  await admin.post('/api/supplierTxns', { supplierId: supplier.body.id, type: 'payment', date: '2026-10-09', amount: 5000 });

  const { supplierBalance } = await import('../src/core/finance.js');
  const state = await admin.get('/api/state');
  const balance = supplierBalance(supplier.body.id, state.body.supplierTxns);
  assert.equal(balance.balance, 7000);
});

test('aynı güne ikinci gün sonu kaydı reddedilir', async () => {
  assert.equal((await admin.post('/api/cashDays', { date: '2026-10-05', countedCash: 4200 })).status, 200);
  const ikinci = await admin.post('/api/cashDays', { date: '2026-10-05', countedCash: 5000 });
  assert.equal(ikinci.status, 422);
  assert.match(ikinci.body.error, /zaten kaydedilmiş/);
});

test('dönemsel faturalar yeni ayda 0 TL olarak açılır ve tekrar açılmaz', async () => {
  await admin.put('/api/settings', {
    bills: [{ key: 'elektrik', label: 'Elektrik faturası', category: 'utility_electricity', allocation: 'weighted', weightKind: 'electricity', active: true }],
  });

  const ilk = await admin.post('/api/periods/2026-11/bills');
  assert.equal(ilk.body.created.length, 1);
  assert.equal(ilk.body.created[0].amount, 0);
  assert.equal(ilk.body.created[0].date, '2026-11-01');

  // İkinci çağrı aynı dönem için yeni kalem açmaz.
  const ikinci = await admin.post('/api/periods/2026-11/bills');
  assert.equal(ikinci.body.created.length, 0);
});

test('toplu fiyat girişi uygulanır', async () => {
  const state = await admin.get('/api/state');
  const roomId = state.body.rooms[0].id;
  const entries = ['2026-10-01', '2026-10-02', '2026-10-03'].map((date) => ({ roomId, date, amount: 4500, currency: 'TRY' }));
  const response = await admin.post('/api/prices/bulk', { entries });
  assert.equal(response.body.written, 3);

  const after = await admin.get('/api/state');
  assert.equal(after.body.prices[roomId]['2026-10-02'].amount, 4500);
});

/* --------------------------------------------------- §2.1 Excel ----------- */

test('örnek şablon indirilebilir ve beklenen sütunları içerir', async () => {
  const response = await admin.get('/api/excel/template?kind=gider');
  assert.equal(response.status, 200);
  const parsed = parseWorkbook(response.body);
  assert.deepEqual(parsed.rows[0], TEMPLATES.gider.columns.map((c) => c.label));
});

test('şablona uygun Excel içe aktarılır, geçersiz satırlar bildirilir', async () => {
  const headers = TEMPLATES.gider.columns.map((c) => c.label);
  const workbook = exportWorkbook([{
    name: 'Giderler',
    rows: [
      headers,
      ['2026-10-12', 'housekeeping', 'Temizlik malzemesi', '1.250,50', 'TRY', 'perGuest', '', 'Hijyen A.Ş.'],
      ['01.10.2026', 'other', 'Kırtasiye', '480', 'TRY', 'general', '', ''],
      ['', 'other', 'Tarihsiz satır', 'abc', 'TRY', 'general', '', ''],
    ],
  }]);

  const response = await admin.raw('/api/excel/import?kind=gider', workbook);
  assert.equal(response.status, 200);
  assert.equal(response.body.imported, 2);
  assert.equal(response.body.invalidCount, 1);
  assert.equal(response.body.invalidRows[0].line, 4);

  // Türkçe sayı ve tarih biçimleri doğru çözümlenmeli.
  const state = await admin.get('/api/state');
  const temizlik = state.body.expenses.find((e) => e.description === 'Temizlik malzemesi');
  assert.equal(temizlik.amount, 1250.5);
  const kirtasiye = state.body.expenses.find((e) => e.description === 'Kırtasiye');
  assert.equal(kirtasiye.date, '2026-10-01');
});

test('sütun yapısı uymayan dosya açıklayıcı hata verir', async () => {
  const workbook = exportWorkbook([{ name: 'Sayfa1', rows: [['Yanlış', 'Başlıklar'], ['a', 'b']] }]);
  const response = await admin.raw('/api/excel/import?kind=gider', workbook);
  assert.equal(response.status, 422);
  assert.match(response.body.error, /sütun yapısı şablona uymuyor/);
  assert.ok(response.body.expectedColumns.length > 0);
});

test('ön kontrol (dryRun) kayıt eklemez', async () => {
  const before = (await admin.get('/api/state')).body.expenses.length;
  const headers = TEMPLATES.gider.columns.map((c) => c.label);
  const workbook = exportWorkbook([{
    name: 'Giderler',
    rows: [headers, ['2026-10-20', 'other', 'Deneme', '100', 'TRY', 'general', '', '']],
  }]);
  const response = await admin.raw('/api/excel/import?kind=gider&dryRun=1', workbook);
  assert.equal(response.body.dryRun, true);
  assert.equal(response.body.imported, 0);
  assert.equal(response.body.validCount, 1);
  assert.equal((await admin.get('/api/state')).body.expenses.length, before);
});

test('dışa aktarım yetkiye göre sayfa üretir', async () => {
  const adminFile = await admin.get('/api/excel/export');
  assert.equal(adminFile.status, 200);
  // XLSX sıkıştırılmış bir ZIP'tir; sayfa adları için arşivi açmak gerekir.
  const { unzip } = await import('../server/excel.js');
  const workbookXml = unzip(adminFile.body).get('xl/workbook.xml').toString('utf8');
  const sheetNames = [...workbookXml.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(sheetNames.includes('Gelirler') && sheetNames.includes('Giderler'), sheetNames.join(', '));
  assert.ok(sheetNames.includes('Çalışanlar'), `admin tüm sayfaları görmeli: ${sheetNames.join(', ')}`);
  assert.ok(sheetNames.includes('Toptancı Cari'));

  // Resepsiyonun Excel dışa aktarım yetkisi yok.
  assert.equal((await resepsiyon.get('/api/excel/export')).status, 403);
});

/* ------------------------------------------------ §8 Denetim kaydı -------- */

test('kritik değişiklikler kullanıcı ve tarihle kaydedilir', async () => {
  const state = await admin.get('/api/state');
  const log = state.body.auditLog;
  assert.ok(log.length > 0);
  const girisKaydi = log.find((entry) => entry.action === 'login');
  assert.ok(girisKaydi.username);
  assert.ok(girisKaydi.at);
  const odaKaydi = log.find((entry) => entry.entity === 'rooms' && entry.action === 'create');
  assert.match(odaKaydi.summary, /101/);
});

test('çıkış sonrası oturum geçersiz olur', async () => {
  const gecici = client();
  await gecici.post('/api/auth/login', { username: 'resepsiyon', password: 'Resepsiyon2026' });
  assert.equal((await gecici.get('/api/state')).status, 200);
  await gecici.post('/api/auth/logout');
  assert.equal((await gecici.get('/api/state')).status, 401);
});

/* ------------------------------------- §19 Tarihsel kur ve kur farkı ------ */

test('kur defterine kayıt eklenir ve durumda görünür', async () => {
  const eklendi = await admin.post('/api/exchangeRates', {
    date: '2026-09-01', currency: 'EUR', rate: 38, kind: 'manual',
  });
  assert.equal(eklendi.status, 200);
  assert.equal(eklendi.body.rate, 38);
  assert.equal(eklendi.body.source, 'Manuel giriş');

  const state = await admin.get('/api/state');
  const kayit = state.body.exchangeRates.find((r) => r.date === '2026-09-01');
  assert.ok(kayit, 'kur defteri durumda yok');
  assert.equal(kayit.rate, 38);
});

test('geçersiz kur reddedilir', async () => {
  const sifir = await admin.post('/api/exchangeRates', { date: '2026-09-01', currency: 'EUR', rate: 0 });
  assert.equal(sifir.status, 422);
  assert.match(sifir.body.error, /0’dan büyük/);
});

test('döviz faturası o günün kuruyla mühürlenir', async () => {
  const kayit = await admin.post('/api/salesInvoices', {
    customer: 'Schmidt', date: '2026-09-01', invoiceNo: 'KUR-1',
    grossAmount: 195, netAmount: 177, currency: 'EUR', invoicedAmountTry: 7450,
  });
  assert.equal(kayit.status, 200, JSON.stringify(kayit.body));
  assert.equal(kayit.body.fxRate, 38, 'o günün kuru mühürlenmeli');
  assert.equal(kayit.body.fxRateDate, '2026-09-01');
  assert.equal(kayit.body.invoicedAmountTry, 7450);
});

test('kur sonradan değişse de mühürlenmiş kayıt değişmez', async () => {
  await admin.post('/api/exchangeRates', { date: '2026-09-01', currency: 'EUR', rate: 99, kind: 'manual' });
  const state = await admin.get('/api/state');
  const kayit = state.body.salesInvoices.find((i) => i.invoiceNo === 'KUR-1');
  assert.equal(kayit.fxRate, 38, 'geçmiş kaydın kuru sabit kalmalı');
});

test('kuru olmayan güne döviz faturası kurla birlikte saklanır', async () => {
  // Kur defterinde 2020 kaydı yok; kullanıcı kuru elle verirse kabul edilir.
  const elle = await admin.post('/api/salesInvoices', {
    customer: 'Elle Kur', date: '2020-01-05', invoiceNo: 'KUR-2',
    grossAmount: 100, currency: 'EUR', fxRate: 12.5, fxSource: 'Manuel giriş',
  });
  assert.equal(elle.status, 200, JSON.stringify(elle.body));
  assert.equal(elle.body.fxRate, 12.5);
});

test('kuru eksik işlem günleri listelenir', async () => {
  const response = await admin.get('/api/fx/missing?currency=EUR');
  assert.equal(response.status, 200);
  assert.equal(response.body.currency, 'EUR');
  assert.ok(response.body.dates.some((d) => d.date === '2020-01-05'), JSON.stringify(response.body.dates));
  assert.equal(response.body.dates.find((d) => d.date === '2020-01-05').count, 1);
});

test('kur defteri yetkisiz kullanıcıya kapalıdır', async () => {
  const response = await resepsiyon.post('/api/exchangeRates', { date: '2026-09-03', currency: 'EUR', rate: 40 });
  assert.equal(response.status, 403);
});
