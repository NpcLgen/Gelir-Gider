/**
 * cPanel (statik) modu — gerçek tarayıcıda Firebase arka ucu.
 *
 *   npm start                     # ayrı bir terminalde
 *   npm run test:browser:cpanel
 *
 * `/api/...` istekleri 404 ile karşılanır: uygulama kendiliğinden Firebase
 * moduna geçer (src/app-config.js → backend: 'auto'). Firebase kimlik ve
 * Realtime Database uçları bellek içi bir taklitle karşılandığı için test
 * gerçek projeye hiçbir şey yazmaz.
 */

import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeGo } from './nav.mjs';
import { APP_CONFIG } from '../../src/app-config.js';
import { exportWorkbook } from '../../server/excel.js';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const errors = [];
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.setDefaultTimeout(8000);
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
});

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    console.log(`❌ ${name}: ${e.message.split('\n')[0]}`);
    process.exitCode = 1;
  }
};

/* ------------------------------------------- bellek içi Firebase taklidi -- */

const tree = { data: { users: {} } };
const accounts = new Map([['admin@otel.local', { localId: 'uid-admin', password: 'sifre123' }]]);
tree.data.users['uid-admin'] = {
  id: 'uid-admin', username: 'admin', displayName: 'Yönetici',
  isAdmin: true, active: true, mustChangePassword: false,
};

const parts = (path) => path.split('/').filter(Boolean);
const nodeAt = (path) => parts(path).reduce((node, key) => (node == null ? undefined : node[key]), tree);
const setAt = (path, value) => {
  const keys = parts(path);
  const last = keys.pop();
  let node = tree;
  for (const key of keys) {
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key];
  }
  if (value === null) delete node[last];
  else node[last] = value;
};

const jsonBody = (route, body, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body ?? null),
});

// Node sunucusu yok gibi davran: uygulama Firebase moduna düşer.
await page.route('**/api/**', (route) => route.fulfill({
  status: 404, contentType: 'text/html', body: '<!doctype html><title>404</title>',
}));

await page.route('https://identitytoolkit.googleapis.com/**', async (route) => {
  const url = new URL(route.request().url());
  const body = JSON.parse(route.request().postData() || '{}');
  const action = url.pathname.split(':')[1];
  if (action === 'signInWithPassword') {
    const account = accounts.get(body.email);
    if (!account || account.password !== body.password) {
      return jsonBody(route, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, 400);
    }
    return jsonBody(route, {
      localId: account.localId, idToken: `tok-${account.localId}`, refreshToken: 'ref', expiresIn: '3600',
    });
  }
  if (action === 'signUp') {
    const localId = `uid-${accounts.size + 1}`;
    accounts.set(body.email, { localId, password: body.password });
    return jsonBody(route, { localId, idToken: `tok-${localId}`, refreshToken: 'ref', expiresIn: '3600' });
  }
  return jsonBody(route, { error: { message: 'UNKNOWN' } }, 400);
});

const dbHost = new URL(APP_CONFIG.firebase.databaseURL).origin;
await page.route(`${dbHost}/**`, async (route) => {
  const url = new URL(route.request().url());
  const path = url.pathname.replace(/\.json$/, '');
  const method = route.request().method();
  const body = route.request().postData() ? JSON.parse(route.request().postData()) : undefined;

  if (!url.searchParams.get('auth')) return jsonBody(route, { error: 'Permission denied' }, 401);
  if (method === 'GET') return jsonBody(route, nodeAt(path) ?? null);
  if (method === 'PUT') { setAt(path, body); return jsonBody(route, body); }
  if (method === 'PATCH') {
    for (const [key, value] of Object.entries(body ?? {})) setAt(`${path}/${key}`, value);
    return jsonBody(route, body);
  }
  if (method === 'DELETE') { setAt(path, null); return jsonBody(route, null); }
  return jsonBody(route, { error: 'unsupported' }, 400);
});

/* ------------------------------------------------------------- senaryo -- */

const go = makeGo(page);
const settingsTab = async (label) => {
  await go('Ayarlar');
  await page.locator('.settings-tab').filter({ hasText: label }).first().click();
  await page.waitForSelector('.settings-tab.active');
};
const clearToast = () => page.evaluate(() => document.querySelector('.toast')?.classList.remove('show'));
const waitToast = (t) => page.waitForFunction((x) => {
  const el = document.querySelector('.toast.show');
  return Boolean(el && el.textContent.includes(x));
}, t, { timeout: 15000 });

await step('Statik kurulumda karşılama sayfası açılıyor', async () => {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForSelector('.landing', { timeout: 15000 });
  const mode = await page.evaluate(async () => {
    const { activeBackend } = await import('/src/core/api.js');
    return activeBackend();
  });
  if (mode !== 'firebase') throw new Error(`arka uç firebase değil: ${mode}`);
});

await step('Hatalı şifre Türkçe hata veriyor', async () => {
  await page.click('.landing-login-top');
  await page.waitForSelector('.login-card');
  await page.fill('.login-card input[type="text"]', 'admin');
  await page.fill('.login-card input[type="password"]', 'yanlis');
  await page.click('.login-card button[type="submit"]');
  await page.waitForSelector('.error-box:not(.hidden)');
  const text = await page.textContent('.error-box');
  if (!text.includes('şifre hatalı')) throw new Error(`beklenmeyen mesaj: ${text.trim()}`);
});

await step('Firebase hesabıyla giriş yapılıyor', async () => {
  await page.fill('.login-card input[type="password"]', 'sifre123');
  await page.click('.login-card button[type="submit"]');
  await page.waitForSelector('.layout .kpi-grid', { timeout: 20000 });
  const chip = await page.textContent('.account-chip');
  if (!chip.includes('Yönetici')) throw new Error(`hesap çipi: ${chip}`);
  if (!nodeAt('data/users/uid-admin/lastLogin')) throw new Error('son giriş yazılmadı');
});

await step('Gider kaydı Realtime Database’e yazılıyor', async () => {
  await go('Genel Harcamalar');
  await page.click('button:has-text("Yeni Gider")');
  await page.waitForSelector('.modal:has-text("Yeni Gider")');
  await page.fill('.modal input[type="date"]', '2026-10-03');
  await page.locator('.modal input[type="number"]').first().fill('1500');
  await page.selectOption('.modal select.expense-category', 'utility_electricity');
  await page.fill('.modal input[placeholder*="Jakuzi"]', 'Firebase testi elektrik');
  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitToast('Gider kaydedildi');
  const rows = Object.values(nodeAt('data/expenses') ?? {});
  if (rows.length !== 1) throw new Error(`beklenen 1 gider, bulunan ${rows.length}`);
  if (rows[0].description !== 'Firebase testi elektrik') throw new Error('açıklama yazılmadı');
  const log = Object.values(nodeAt('data/auditLog') ?? {});
  if (!log.some((r) => /Firebase testi/.test(r.summary))) throw new Error('işlem kaydı tutulmadı');
});

await step('Sayfa yenilenince oturum korunuyor', async () => {
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.layout', { timeout: 20000 });
  await go('Genel Harcamalar');
  const text = await page.textContent('tbody');
  if (!text.includes('Firebase testi elektrik')) throw new Error('kayıt listelenmedi');
});

await step('Gelir faturası kur mührüyle kaydediliyor', async () => {
  await settingsTab('Döviz Kuru');
  await page.fill('input.fx-new-date', '2026-10-03');
  await page.fill('input.fx-new-rate', '38');
  await clearToast();
  await page.click('button.fx-add-save');
  await waitToast('kuru deftere eklendi');

  await go('Gelirler');
  await page.click('button:has-text("Fatura Ekle")');
  await page.waitForSelector('.modal input.inv-customer');
  await page.fill('.modal input.inv-customer', 'Acme GmbH');
  await page.fill('.modal input.inv-date', '2026-10-03');
  await page.fill('.modal input.inv-no', 'SCA-1');
  await page.fill('.modal input.inv-gross', '195');
  await page.selectOption('.modal select.inv-currency', 'EUR');
  await page.waitForSelector('.modal .fx-seal');
  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitToast('Fatura kaydedildi');

  const invoices = Object.values(nodeAt('data/salesInvoices') ?? {});
  if (invoices.length !== 1) throw new Error(`beklenen 1 fatura, bulunan ${invoices.length}`);
  if (invoices[0].fxRate !== 38) throw new Error(`kur mührü yanlış: ${invoices[0].fxRate}`);
  if (Object.keys(nodeAt('data/exchangeRates') ?? {}).length !== 1) throw new Error('kur defteri yazılmadı');
});

await step('Excel içe aktarım tarayıcıda çalışıyor ve mükerrerleri atlıyor', async () => {
  // Dosya sunucudaki (deflate sıkıştırmalı) yazıcıyla üretilir; tarayıcı kendi
  // çözücüsüyle okur. Böylece iki katmanın uyumu da sınanır.
  const dir = mkdtempSync(join(tmpdir(), 'cpanel-xlsx-'));
  const file = join(dir, 'gelen.xlsx');
  writeFileSync(file, exportWorkbook([{
    name: 'Gelen Faturalar',
    rows: [
      ['Müşteri', 'Fatura Tarihi', 'Fatura No', 'Tutar', 'Para Birimi',
        'Vergiler Hariç Toplam Tutar', 'Vergiler Dahil Toplam Tutar'],
      ['MERAM ELEKTRİK', '2026-10-02', 'MRM-CPANEL-1', 39596.06, 'TRY', 32997.04, 39596.06],
      ['ARAS KARGO', '2026-10-02', 'ARS-CPANEL-2', 1180, 'TRY', 1000, 1180],
    ],
  }]));

  await go('Gider Faturaları');
  await page.waitForSelector('h1:has-text("Gider Faturaları")');
  await clearToast();
  await page.setInputFiles('input.invoice-import', file);
  await waitToast('2 yeni fatura aktarıldı');
  if (Object.keys(nodeAt('data/purchaseInvoices') ?? {}).length !== 2) throw new Error('faturalar yazılmadı');

  // Aynı dosya ikinci kez: hiçbir kayıt çoğalmaz.
  await clearToast();
  await page.setInputFiles('input.invoice-import', file);
  await waitToast('2 fatura zaten işlenmişti');
  if (Object.keys(nodeAt('data/purchaseInvoices') ?? {}).length !== 2) throw new Error('mükerrer kayıt eklendi');
});

await step('Yedekleme ekranı Firebase bilgisini gösteriyor', async () => {
  await go('Yedekleme');
  await page.waitForSelector('h3:has-text("Firebase Kurulumu")');
  const text = await page.textContent('.content');
  if (!text.includes('Firebase Realtime Database')) throw new Error('bilgi metni yok');
  if (await page.locator('.backup-now').count()) throw new Error('sunucu yedek düğmesi görünmemeli');
});

await step('Kullanıcı ve Yetki ekranından hesap açılıyor', async () => {
  await go('Kullanıcı ve Yetki');
  await page.click('button:has-text("Yeni Kullanıcı")');
  await page.waitForSelector('.modal input.user-username');
  await page.fill('.modal input.user-username', 'resepsiyon');
  await page.fill('.modal input.user-display', 'Resepsiyon');
  await page.fill('.modal input.user-password', 'sifre123');
  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitToast('Kullanıcı kaydedildi');
  const users = Object.values(nodeAt('data/users') ?? {});
  if (!users.some((u) => u.username === 'resepsiyon')) throw new Error('kullanıcı yazılmadı');
  const chip = await page.textContent('.account-chip');
  if (!chip.includes('Yönetici')) throw new Error('yönetici oturumu düştü');
});

await step('Çıkış yapınca oturum temizleniyor', async () => {
  await page.click('.account-chip');
  await page.click('button:has-text("Çıkış Yap")');
  await page.waitForSelector('.login-card', { timeout: 15000 });
  const saved = await page.evaluate(() => localStorage.getItem('otel:firebase-oturum'));
  if (saved) throw new Error('oturum silinmedi');
});

if (errors.length) { console.log('❌ konsol hataları:', errors); process.exitCode = 1; }
else console.log('✅ JS hatası yok');
await browser.close();
