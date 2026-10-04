/**
 * Gelen / giden fatura akışı (tarayıcı).
 *
 *   npm start                     # ayrı bir terminalde
 *   npm run test:browser:fatura
 *
 * e-Fatura portalının Excel çıktısı testin içinde üretilir (boş hücreler dâhil),
 * böylece gerçek dosya olmadan da uçtan uca doğrulanır.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { makeGo } from './nav.mjs';
import { exportWorkbook } from '../../server/excel.js';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const USER = process.env.TEST_USER || 'Admin';
const PASS = process.env.TEST_PASS || 'Admin2026';
const CHANGED = process.env.TEST_PASS2 || 'Otel2026Guvenli';

const workDir = mkdtempSync(join(tmpdir(), 'otel-fatura-browser-'));

/* ------------------------------------------- portal dosyası üretimi ---- */

const PORTAL_HEADER = [
  'Fatura Senaryo', 'GİB Fatura Türü', 'Müşteri', 'Müşteri VKN', 'Fatura Tarihi', 'Fatura No',
  'ETTN', 'ERP Statü', 'İrsaliye No', 'Tutar', 'Para Birimi', 'Statü', 'Paket Bilgisi',
  '"Zarf Durumu', 'Vergiler Hariç Toplam Tutar', 'Vergiler Dahil Toplam Tutar',
  'Oluşturma Tarihi', 'Departman Adı', 'Özel Alan 1',
];

const portalRow = ({ customer, date, no, amount, currency = 'TRY', net, gross }) => ([
  'Temel', 'Satış', customer, '6160398170', date, no,
  '901C6FD7-EFEF', 'INCELEMEBEKLIYOR', '', amount, currency, 'Kabul edildi', '',
  '', net, gross, '', '', '',
]);

/** Dosyayı diske yazar ve yolunu döndürür. */
function portalFile(name, rows) {
  const path = join(workDir, name);
  writeFileSync(path, exportWorkbook([{ name: 'Faturalar', rows: [PORTAL_HEADER, ...rows] }]));
  return path;
}

const today = new Date();
const ay = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
const gun = (d) => `${ay}-${String(d).padStart(2, '0')}`;

const GELEN = portalFile('gelen.xlsx', [
  portalRow({ customer: 'MERAM ELEKTRİK A.Ş.', date: gun(2), no: 'MRM-TEST-1', amount: 39596, net: 32997.04, gross: 39596.06 }),
  portalRow({ customer: 'ÖZ GÜRBÜZ TARIM LTD.', date: gun(3), no: 'AAA-TEST-2', amount: 72000, net: 72000, gross: 72000 }),
  portalRow({ customer: 'HELİOS SEYAHAT LTD.', date: gun(4), no: 'BEF-TEST-3', amount: 728, currency: 'EUR', net: 606.67, gross: 728 }),
]);
const GIDEN = portalFile('giden.xlsx', [
  portalRow({ customer: 'Li JiaNi', date: gun(2), no: 'SCA-TEST-1', amount: 6731.24, net: 6064.18, gross: 6731.24 }),
  portalRow({ customer: 'DANDAN DIAO', date: gun(3), no: 'SCA-TEST-2', amount: 2506.63, net: 2258.23, gross: 2506.63 }),
]);
// Beklenen TRY toplamları (EUR satırı kurla çevrildiği için ayrı kontrol edilir).
const GELEN_TRY = 39596.06 + 72000;
const GIDEN_TOPLAM = 6731.24 + 2506.63;

/* ------------------------------------------------------------ kurulum -- */

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
    for (const b of await page.$$('.modal-backdrop')) await b.evaluate((el) => el.remove());
  }
};

const go = makeGo(page);
const clearToast = () => page.evaluate(() => document.querySelector('.toast')?.classList.remove('show'));
const waitToast = (t) => page.waitForFunction((x) => {
  const el = document.querySelector('.toast.show');
  return Boolean(el && el.textContent.includes(x));
}, t, { timeout: 15000 });
/** "₺39.596,06" → 39596.06 */
const money = (text) => Number(String(text).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.login-card');

async function tryLogin(password) {
  await page.fill('.login-card input[type="text"]', USER);
  await page.locator('.login-card .pw-wrap input').first().fill(password);
  await page.click('.login-card button[type="submit"]');
  await page.waitForSelector('.layout, .login-card:has-text("Şifre Değiştirme Zorunlu"), .error-box:not(.hidden)', { timeout: 15000 });
  if (await page.$('.login-card:has-text("Şifre Değiştirme Zorunlu")')) return 'mustChange';
  if (await page.$('.layout')) return 'ok';
  return 'failed';
}

let outcome = await tryLogin(PASS);
if (outcome === 'failed') outcome = await tryLogin(CHANGED);
if (outcome === 'mustChange') {
  const fields = page.locator('.login-card .pw-wrap input');
  await fields.nth(0).fill(PASS);
  await fields.nth(1).fill(CHANGED);
  await fields.nth(2).fill(CHANGED);
  await page.click('.login-card button[type="submit"]');
}
await page.waitForSelector('.layout', { timeout: 15000 });

await page.evaluate(() => fetch('/api/demo', { method: 'POST', credentials: 'same-origin' }));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.layout', { timeout: 15000 });

/* ------------------------------------------------------- gelir bölümü - */

await step('Gelirler sayfası gider sayfasıyla aynı düzeni kullanıyor', async () => {
  await go('Gelirler');
  await page.waitForSelector('h1:has-text("Gelirler")');
  if (await page.$('button:has-text("Yeni Rezervasyon")')) throw new Error('rezervasyon penceresi açılıyor');
  const headers = await page.$$eval('.table-card th', (els) => els.map((e) => e.textContent.trim()));
  for (const needed of ['Fatura Tarihi', 'Fatura No', 'Tutar', 'Para Birimi', 'Vergiler Hariç', 'Vergiler Dahil']) {
    if (!headers.some((t) => t.includes(needed))) throw new Error(`${needed} sütunu yok: ${headers.join(' | ')}`);
  }
  console.log(`   sütunlar: ${headers.filter(Boolean).join(' · ')}`);
});

await step('Rezervasyonlar ayrı bir sayfaya taşındı', async () => {
  await go('Rezervasyonlar');
  await page.waitForSelector('button:has-text("Yeni Rezervasyon")');
});

await step('Giden fatura dosyası gelir faturalarına aktarılıyor', async () => {
  await go('Gelirler');
  await clearToast();
  await page.setInputFiles('input.invoice-import', GIDEN);
  await waitToast('fatura içe aktarıldı');
  const table = await page.textContent('.table-card');
  if (!table.includes('SCA-TEST-1') || !table.includes('Li JiaNi')) throw new Error('faturalar listeye girmedi');
  const total = money(await page.textContent('.kpi:has-text("Dönem Gelir Faturası") strong'));
  if (Math.abs(total - GIDEN_TOPLAM) > 1) throw new Error(`toplam ${total}, beklenen ${GIDEN_TOPLAM}`);
  console.log(`   2 fatura · toplam ₺${total}`);
});

await step('Aynı dosya ikinci kez aktarılmıyor', async () => {
  await clearToast();
  await page.setInputFiles('input.invoice-dry', GIDEN);
  await page.waitForSelector('.verdict');
  const verdict = await page.textContent('.verdict');
  if (!/0 geçerli, 2 hatalı/.test(verdict)) throw new Error(verdict.replace(/\s+/g, ' '));
  const hata = await page.textContent('.table-card:has-text("Satır") tbody');
  if (!hata.includes('zaten kayıtlı')) throw new Error('mükerrer uyarısı yok');
});

/* -------------------------------------------------------- gider bölümü */

await step('Gelen fatura dosyası gider faturalarına aktarılıyor', async () => {
  await go('Gider Faturaları');
  await page.waitForSelector('h1:has-text("Gider Faturaları")');
  await clearToast();
  await page.setInputFiles('input.invoice-import', GELEN);
  await waitToast('fatura içe aktarıldı');
  const table = await page.textContent('.table-card');
  for (const no of ['MRM-TEST-1', 'AAA-TEST-2', 'BEF-TEST-3']) {
    if (!table.includes(no)) throw new Error(`${no} listeye girmedi`);
  }
  if (!table.includes('EUR')) throw new Error('EUR faturası para birimiyle görünmüyor');
  const total = money(await page.textContent('.kpi:has-text("Dönem Gider Faturası") strong'));
  if (total <= GELEN_TRY) throw new Error(`EUR faturası kurla eklenmemiş: ${total}`);
  console.log(`   3 fatura · toplam ₺${total} (EUR kurla çevrildi)`);
});

await step('Fatura KDV’si dahil − hariç farkından hesaplanıyor', async () => {
  const kdv = money(await page.textContent('.kpi:has-text("Fatura KDV") strong'));
  // 39.596,06 − 32.997,04 = 6.599,02 · ikinci faturada KDV yok · EUR faturası kurla eklenir.
  if (kdv < 6599) throw new Error(`KDV ${kdv}, beklenen ≥ 6599`);
  console.log(`   KDV ₺${kdv}`);
});

await step('Fatura araması müşteri ve fatura numarasında çalışıyor', async () => {
  await page.fill('input.invoice-search', 'MERAM');
  await page.waitForTimeout(400);
  const rows = await page.$$eval('.table-card tbody tr', (els) => els.length);
  if (rows !== 1) throw new Error(`arama sonucu ${rows} satır`);
  await page.fill('input.invoice-search', '');
  await page.waitForTimeout(400);
});

await step('Fatura elle de eklenebiliyor', async () => {
  await page.click('button:has-text("Fatura Ekle")');
  await page.waitForSelector('.modal input.inv-customer');
  await page.fill('.modal input.inv-customer', 'Elle Girilen Tedarikçi');
  await page.fill('.modal input.inv-date', gun(5));
  await page.fill('.modal input.inv-no', 'ELLE-1');
  await page.fill('.modal input.inv-net', '1000');
  await page.fill('.modal input.inv-gross', '1200');
  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitToast('Fatura kaydedildi');
  if (!(await page.textContent('.table-card')).includes('ELLE-1')) throw new Error('listeye eklenmedi');
});

/* ------------------------------------------------- toplamlara yansıma - */

await step('Faturalar Dashboard gelir ve gider toplamına giriyor', async () => {
  await go('Dashboard');
  await page.waitForSelector('.kpi-grid');
  const gelir = await page.textContent('.kpi:has-text("Toplam Gelir")');
  if (!gelir.includes('fatura')) throw new Error(`gelir kırılımında fatura yok: ${gelir.replace(/\s+/g, ' ')}`);
  const gider = await page.textContent('.kpi:has-text("Toplam Gider")');
  if (!gider.includes('fatura')) throw new Error(`gider kırılımında fatura yok: ${gider.replace(/\s+/g, ' ')}`);
  console.log(`   ${gelir.replace(/\s+/g, ' ').trim().slice(0, 110)}`);
});

await step('Giderler özetinde "Gider Faturaları" kaynağı görünüyor', async () => {
  await go('Giderler');
  await page.waitForSelector('.card:has-text("Tüm Gider Kalemleri")');
  const kpis = await page.$$eval('.kpi', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  if (!kpis.some((k) => k.includes('Gider Faturaları'))) throw new Error(`kaynak kartı yok: ${kpis.join(' | ')}`);
  const tablo = await page.textContent('.card:has-text("Tüm Gider Kalemleri")');
  if (!tablo.includes('MERAM')) throw new Error('fatura kalemi listede yok');
});

await step('Vergi raporunda fatura KDV satırları görünüyor', async () => {
  await go('Vergiler');
  await page.waitForSelector('.card:has-text("Vergi Kalemleri")');
  const table = await page.textContent('.card:has-text("Vergi Kalemleri")');
  if (!table.includes('KDV (giden faturalar)')) throw new Error('giden fatura KDV satırı yok');
  if (!table.includes('gelen faturalardan')) throw new Error('gelen fatura KDV satırı yok');
});

/* ------------------------------------------------------ bildirim kutusu */

await step('Bildirim kutusu 3 saniye sonra tamamen kayboluyor', async () => {
  await go('Gelirler');
  await page.evaluate(() => {
    const el = document.querySelector('.toast');
    if (el) el.classList.remove('show');
  });
  // Bildirimi tetikle: arama kutusu yerine doğrudan modülün bildirimini kullan.
  await page.click('button:has-text("Fatura Ekle")');
  await page.waitForSelector('.modal input.inv-customer');
  await page.fill('.modal input.inv-customer', 'Bildirim Testi');
  await page.fill('.modal input.inv-date', gun(6));
  await page.fill('.modal input.inv-no', 'TOAST-1');
  await page.fill('.modal input.inv-gross', '100');
  await page.click('.modal button:has-text("Kaydet")');
  await waitToast('Fatura kaydedildi');
  await page.waitForTimeout(300); // açılış geçişi tamamlansın

  const visible = await page.evaluate(() => {
    const el = document.querySelector('.toast');
    return { opacity: getComputedStyle(el).opacity, visibility: getComputedStyle(el).visibility };
  });
  if (Number(visible.opacity) < 0.9) throw new Error(`bildirim görünmüyor: ${JSON.stringify(visible)}`);

  // 3 sn görünür + ~0,45 sn solma; 4,5 sn sonra hiçbir izi kalmamalı.
  await page.waitForTimeout(4500);
  const after = await page.evaluate(() => {
    const el = document.querySelector('.toast');
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return {
      opacity: Number(style.opacity),
      visibility: style.visibility,
      pointerEvents: style.pointerEvents,
      onScreen: box.bottom > 0 && box.top < window.innerHeight,
    };
  });
  if (after.opacity !== 0) throw new Error(`saydamlık ${after.opacity}`);
  if (after.visibility !== 'hidden') throw new Error(`görünürlük ${after.visibility}`);
  if (after.pointerEvents !== 'none') throw new Error('tıklamaları hâlâ yakalıyor');
  console.log(`   3 sn sonra: opacity ${after.opacity} · visibility ${after.visibility}`);
});

console.log(errors.length ? `❌ JS hatası: ${errors.slice(0, 3).join(' | ')}` : '✅ JS hatası yok');
if (errors.length) process.exitCode = 1;
await browser.close();
rmSync(workDir, { recursive: true, force: true });
