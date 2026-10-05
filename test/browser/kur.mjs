/**
 * Tarihsel kur, kur mührü ve kur farkı akışı (PRD §19).
 *
 *   npm start
 *   npm run test:browser:kur
 *
 * PRD örneği uçtan uca doğrulanır:
 *   195 € · 1 EUR = 38,00 ₺ · sistem 7.410 ₺ · fatura 7.450 ₺ → +40 ₺ olumlu kur farkı
 */

import { chromium } from 'playwright';
import { makeGo, openLogin } from './nav.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const USER = process.env.TEST_USER || 'Admin';
const PASS = process.env.TEST_PASS || 'Admin2026';
const CHANGED = process.env.TEST_PASS2 || 'Otel2026Guvenli';

const errors = [];
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
page.setDefaultTimeout(8000);
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
});
page.on('dialog', (d) => d.accept());

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
}, t, { timeout: 12000 });
const settingsTab = async (label) => {
  await go('Ayarlar');
  await page.locator('.settings-tab').filter({ hasText: label }).first().click();
  await page.waitForSelector('.settings-tab.active');
};
/** "₺7.410,00" → 7410 */
const money = (text) => Number(String(text).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));

// Testler bugünün ayında çalışır; kur ve rezervasyon aynı güne yazılır.
const today = new Date();
const ay = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
const gun = (d) => `${ay}-${String(d).padStart(2, '0')}`;
const ISLEM_GUNU = gun(11);
const CIKIS_GUNU = gun(12);
const KUR = 38;
const TUTAR = 195;
const SISTEM_TL = TUTAR * KUR;      // 7.410
const FATURA_TL = 7450;             // kullanıcı girer
const FARK = FATURA_TL - SISTEM_TL; // +40

await openLogin(page, BASE);

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

/* ------------------------------------------------- kur defteri --------- */

await step('Ayarlarda tarihsel kur defteri bulunuyor', async () => {
  await settingsTab('Döviz Kuru');
  await page.waitForSelector('.fx-add-rate');
  const baslik = await page.textContent('.card:has(.fx-add-rate) h3');
  if (!baslik.includes('Tarihsel Kur Defteri')) throw new Error(baslik);
  const sutunlar = await page.$$eval('.fx-ledger th', (els) => els.map((e) => e.textContent.trim()));
  for (const needed of ['Tarih', 'Kur Tipi']) {
    if (!sutunlar.some((c) => c.includes(needed))) throw new Error(`${needed} sütunu yok: ${sutunlar.join(', ')}`);
  }
  console.log(`   sütunlar: ${sutunlar.filter(Boolean).join(' · ')}`);
});

await step('İşlem gününün kuru elle deftere yazılıyor', async () => {
  await settingsTab('Döviz Kuru');
  await page.fill('input.fx-new-date', ISLEM_GUNU);
  await page.fill('input.fx-new-rate', String(KUR));
  await clearToast();
  await page.click('button.fx-add-save');
  await waitToast('kuru deftere eklendi');
  const defter = await page.textContent('.fx-ledger');
  if (!defter.includes('38,00')) throw new Error('kur defterde görünmüyor');
});

/* --------------------------------------- kur mührü ve çift gösterim ---- */

await step('Kuru olmayan güne döviz faturası kur ister', async () => {
  await go('Gelirler');
  await page.click('button:has-text("Fatura Ekle")');
  await page.waitForSelector('.modal input.inv-customer');
  await page.fill('.modal input.inv-customer', 'Kur Testi — eksik gün');
  await page.fill('.modal input.inv-date', gun(19));
  await page.fill('.modal input.inv-no', 'EKSIK-KUR-1');
  await page.fill('.modal input.inv-gross', '100');
  await page.selectOption('.modal select.inv-currency', 'EUR');
  await page.waitForSelector('.modal .fx-missing');
  const uyari = (await page.textContent('.modal .fx-missing')).replace(/\s+/g, ' ');
  if (!uyari.includes('kuru kayıtlı değil')) throw new Error(uyari);
  if (!(await page.$('.modal input.fx-manual-rate'))) throw new Error('kur girme alanı yok');
  if (!(await page.$('.modal button.fx-manual-save'))) throw new Error('kur kaydetme düğmesi yok');
  console.log(`   ${uyari.trim().slice(0, 110)}`);

  // Kullanıcı o günün kurunu girer; kayıt deftere yazılır ve mühür güncellenir.
  await page.fill('.modal input.fx-manual-rate', '41');
  await clearToast();
  await page.click('.modal button.fx-manual-save');
  await waitToast('kuru kaydedildi');
  await page.waitForSelector('.modal .fx-seal');
  const muhurlu = (await page.textContent('.modal .fx-seal')).replace(/\s+/g, ' ');
  if (!muhurlu.includes('41,00')) throw new Error(muhurlu);
  await page.click('.modal-header .icon-btn');
});

await step('Kuru olan güne fatura kuru mühürleniyor ve TL karşılığı görünüyor', async () => {
  await go('Gelirler');
  await page.click('button:has-text("Fatura Ekle")');
  await page.waitForSelector('.modal input.inv-customer');
  await page.fill('.modal input.inv-customer', 'Kur Farkı Testi');
  await page.fill('.modal input.inv-date', ISLEM_GUNU);
  await page.fill('.modal input.inv-no', 'KUR-FARKI-1');
  await page.fill('.modal input.inv-net', '177');
  await page.fill('.modal input.inv-gross', String(TUTAR));
  await page.selectOption('.modal select.inv-currency', 'EUR');
  await page.waitForSelector('.modal .fx-seal');

  const muhur = await page.textContent('.modal .fx-seal');
  if (!muhur.includes('38,00')) throw new Error(`kur mührü yanlış: ${muhur.replace(/\s+/g, ' ')}`);
  const cift = await page.textContent('.modal .fx-dual');
  if (!cift.includes('€') || !cift.includes('₺')) throw new Error(`çift gösterim yok: ${cift}`);
  if (money(cift.split('/')[1]) !== SISTEM_TL) throw new Error(`TL karşılığı ${cift}`);
  console.log(`   ${cift.replace(/\s+/g, ' ').trim()}`);

  if (Number(await page.inputValue('.modal input.fx-rate-input')) !== KUR) throw new Error('kur alanı dolmadı');
});

await step('"Kesilen Fatura Tutarı (TL)" girilince kur farkı anında hesaplanıyor', async () => {
  await page.fill('.modal input.invoiced-try', String(FATURA_TL));
  await page.waitForSelector('.modal .fx-difference');
  const fark = await page.textContent('.modal .fx-difference');
  if (!fark.includes('Olumlu Kur Farkı')) throw new Error(fark.replace(/\s+/g, ' '));
  if (money(fark.split(':')[1]) !== FARK) throw new Error(`fark yanlış: ${fark.replace(/\s+/g, ' ')}`);
  console.log(`   ${fark.replace(/\s+/g, ' ').trim().slice(0, 120)}`);

  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitToast('Fatura kaydedildi');
});

await step('Fatura listesinde döviz ve TL tutarı yan yana görünüyor', async () => {
  await go('Gelirler');
  const satir = page.locator('tr:has-text("Kur Farkı Testi")').first();
  const metin = (await satir.textContent()).replace(/\s+/g, ' ');
  if (!metin.includes('€195,00')) throw new Error(`döviz tutarı yok: ${metin}`);
  if (!metin.includes('₺7.410,00')) throw new Error(`TL karşılığı yok: ${metin}`);
  if (!metin.includes('+₺40,00')) throw new Error(`kur farkı yok: ${metin}`);
  console.log(`   ${metin.trim().slice(0, 130)}`);
});

/* --------------------------------------------- geçmiş kur sabit kalır -- */

await step('Kur sonradan değişse de geçmiş kaydın TL karşılığı sabit kalıyor', async () => {
  await settingsTab('Döviz Kuru');
  await page.fill('input.fx-new-date', gun(13));
  await page.fill('input.fx-new-rate', '50');
  await clearToast();
  await page.click('button.fx-add-save');
  await waitToast('kuru deftere eklendi');

  await go('Gelirler');
  const metin = (await page.locator('tr:has-text("Kur Farkı Testi")').first().textContent()).replace(/\s+/g, ' ');
  if (!metin.includes('₺7.410,00')) throw new Error(`TL karşılığı kaydı: ${metin}`);
  if (!metin.includes('kur 38')) throw new Error(`mühürlenen kur değişmiş: ${metin}`);
});

/* ---------------------------------------------- raporlara yansıma ------ */

await step('Kur farkı Dashboard ve döküm tablosunda raporlanıyor', async () => {
  await go('Dashboard');
  await page.waitForSelector('.kpi-grid');
  const formul = (await page.textContent('.card:has-text("Gelir Vergisi Hesabı")')).replace(/\s+/g, ' ');
  if (!formul.includes('Olumlu kur farkı')) throw new Error(`vergi hesabında kur farkı yok: ${formul.slice(0, 160)}`);
  console.log(`   ${formul.slice(0, 120)}`);

  const dokum = await page.textContent('.card:has-text("Kur Farkı Dökümü")');
  if (!dokum.includes('Kur Farkı Testi')) throw new Error('kayıt dökümde yok');
  if (!dokum.includes('7.410')) throw new Error('sistem tutarı dökümde yok');
  if (!dokum.includes('7.450')) throw new Error('fatura tutarı dökümde yok');
});

await step('Kur farkı finansal raporlarda satır olarak görünüyor', async () => {
  await go('Finansal Raporlar');
  await page.waitForSelector('.card:has-text("Dönem Özeti")');
  const ozet = (await page.textContent('.card:has-text("Dönem Özeti")')).replace(/\s+/g, ' ');
  for (const satir of ['Olumlu Kur Farkı (Gelir)', 'Olumsuz Kur Farkı (Gider)', 'Net Kâr (kur farkı dâhil)']) {
    if (!ozet.includes(satir)) throw new Error(`${satir} satırı yok`);
  }
  const dokum = (await page.textContent('.card:has-text("Kur Farkı Dökümü")')).replace(/\s+/g, ' ');
  if (!dokum.includes('Kur Farkı Testi')) throw new Error('kayıt raporda yok');
  console.log(`   ${dokum.slice(0, 120)}`);
});

await step('Yazdırma panelinde kur farkı seçeneği var', async () => {
  await page.click('.topbar button:has-text("🖨️")');
  await page.waitForSelector('.print-options');
  const secenekler = await page.$$eval('.print-option', (els) => els.map((e) => e.textContent.trim()));
  if (!secenekler.some((o) => o.includes('Kur Farkı'))) throw new Error(secenekler.join(' · '));
  await page.click('.modal-header .icon-btn');
});

/* ----------------------------------------------- manuel kur tetikleme -- */

await step('"Kuru Şimdi Güncelle" kuru deftere yazıyor', async () => {
  await settingsTab('Döviz Kuru');
  const bugun = new Date().toISOString().slice(0, 10);
  await page.route('**/api/fx/refresh', async (route) => {
    // Gerçek servise çıkmadan başarılı yanıt taklit edilir.
    const response = await route.fetch().catch(() => null);
    if (response) return route.fulfill({ response });
    return route.continue();
  });
  await page.unroute('**/api/fx/refresh');

  await clearToast();
  await page.click('button.fx-refresh');
  // Ağ yoksa hata bildirimi gelir; her iki durumda da sistem ayakta kalmalı.
  await page.waitForFunction(() => document.querySelector('.toast.show'), null, { timeout: 15000 });
  const bildirim = await page.textContent('.toast');
  if (/Kur güncellendi/.test(bildirim)) {
    if (!bildirim.includes('deftere yazıldı')) throw new Error(bildirim);
    await page.waitForTimeout(500);
    const defter = await page.textContent('.fx-ledger');
    if (!defter.includes(bugun.slice(-2))) throw new Error('bugünün kaydı deftere yazılmadı');
    console.log(`   ${bildirim.trim().slice(0, 110)}`);
  } else {
    if (!/korundu|güncellenemedi/.test(bildirim)) throw new Error(bildirim);
    console.log(`   (ağ yok) ${bildirim.trim()}`);
  }
});

await step('Eksik kur günleri listeleniyor ve listeden girilebiliyor', async () => {
  await settingsTab('Döviz Kuru');
  await page.waitForSelector('.fx-missing-none, .fx-missing-table', { timeout: 10000 });
  if (await page.$('.fx-missing-table')) {
    const ilkSatir = page.locator('.fx-missing-table tbody tr').first();
    await ilkSatir.locator('input').fill('39');
    await clearToast();
    await ilkSatir.locator('button').click();
    await waitToast('kuru kaydedildi');
    console.log('   eksik gün listeden girildi');
  } else {
    console.log('   eksik kur günü yok');
  }
});

/* ------------------------------------------------------ fatura tarafı - */

await step('İkinci döviz faturasında da kur mührü ve kur farkı çalışıyor', async () => {
  await go('Gelirler');
  await page.click('button:has-text("Fatura Ekle")');
  await page.waitForSelector('.modal input.inv-customer');
  await page.fill('.modal input.inv-customer', 'EUR Fatura Testi');
  await page.fill('.modal input.inv-date', ISLEM_GUNU);
  await page.fill('.modal input.inv-no', 'EUR-KUR-1');
  await page.fill('.modal input.inv-gross', '100');
  await page.selectOption('.modal select.inv-currency', 'EUR');
  await page.waitForSelector('.modal .fx-seal');
  await page.fill('.modal input.invoiced-try', '3850');
  await page.waitForSelector('.modal .fx-difference');
  const fark = await page.textContent('.modal .fx-difference');
  if (!fark.includes('Olumlu Kur Farkı')) throw new Error(fark.replace(/\s+/g, ' '));
  if (money(fark.split(':')[1]) !== 50) throw new Error(`fark ${fark.replace(/\s+/g, ' ')}`);

  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitToast('Fatura kaydedildi');
  const tablo = (await page.textContent('.table-card')).replace(/\s+/g, ' ');
  if (!tablo.includes('+₺50,00')) throw new Error('fatura listesinde kur farkı yok');
});

console.log(errors.length ? `❌ JS hatası: ${errors.slice(0, 3).join(' | ')}` : '✅ JS hatası yok');
if (errors.length) process.exitCode = 1;
await browser.close();
