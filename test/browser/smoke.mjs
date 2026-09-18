/**
 * Tarayıcı akış testi (opsiyonel).
 *
 *   npm start                     # ayrı bir terminalde
 *   npm i -D playwright && npx playwright install chromium
 *   node test/browser/smoke.mjs
 *
 * Playwright bu deponun bağımlılığı değildir; `npm test` yalnızca birim testlerini çalıştırır.
 * Chromium yolu PW_CHROMIUM ortam değişkeniyle verilebilir.
 */

import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
page.setDefaultTimeout(8000);
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const BASE = process.env.BASE_URL || 'http://localhost:5173/';
await page.goto(BASE, { waitUntil: 'load' });

const step = async (name, fn) => {
  try { await fn(); console.log(`✅ ${name}`); }
  catch (e) {
    console.log(`❌ ${name}: ${e.message.split('\n')[0]}`);
    process.exitCode = 1;
    for (const backdrop of await page.$$('.modal-backdrop')) await backdrop.evaluate((el) => el.remove());
  }
};

await step('Panel açılır ve KPI kartları dolu', async () => {
  await page.waitForSelector('.kpi-grid .kpi');
  const kpis = await page.$$eval('.kpi strong', (els) => els.map((e) => e.textContent));
  if (kpis.length !== 6) throw new Error(`KPI sayısı ${kpis.length}`);
  console.log('   KPI:', kpis.join(' | '));
});

await step('Oda bazlı kârlılık tablosu satır üretir', async () => {
  const rows = await page.$$('.table-card tbody tr');
  if (rows.length < 5) throw new Error(`satır ${rows.length}`);
});

await step('Odalar sekmesi ve oda kartı açılışı', async () => {
  await page.click('.nav-item:has-text("Odalar")');
  await page.waitForSelector('.room-tile');
  await page.click('.room-tile:has-text("101")');
  await page.waitForSelector('.room-card');
  const title = await page.textContent('.modal-header h2');
  if (!title.includes('101 - King Suite')) throw new Error(title);
});

await step('Kapasite bölümü yatak özetini ve maks. kişi seçimini gösterir', async () => {
  const cap = await page.inputValue('.bed-capacity');
  if (cap !== '3 kişi') throw new Error(`kapasite: ${cap}`);
  const opts = await page.$$eval('select.max-occupancy option', (els) => els.map((o) => o.textContent));
  if (opts.join(',') !== '1 Kişi,2 Kişi,3 Kişi') throw new Error(opts.join(','));
});

await step('Demirbaş checkbox işaretlenince katsayı canlı güncellenir', async () => {
  const before = await page.textContent('.summary-card .kv strong');
  await page.click('.amenity:has-text("Minibar")');
  const after = await page.textContent('.summary-card .kv strong');
  if (before === after) throw new Error(`katsayı değişmedi: ${before}`);
  console.log(`   elektrik ağırlığı ${before} → ${after}`);
});

await step('Oda kartı kaydedilir', async () => {
  await page.click('button:has-text("Oda Kartını Kaydet")');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  await page.waitForSelector('.toast.show');
});

await step('Yatak kapasitesini aşan maks. kişi sayısı seçilemez (102 odası)', async () => {
  await page.click('.room-tile:has-text("102")');
  await page.waitForSelector('.room-card');
  const opts = await page.$$eval('select.max-occupancy option', (els) => els.map((o) => o.textContent));
  if (opts.join(',') !== '1 Kişi,2 Kişi') throw new Error(opts.join(','));
  await page.click('.modal-header .icon-btn');
});

await step('Rezervasyonda kişi sayısı oda kapasitesiyle sınırlı', async () => {
  await page.click('.nav-item:has-text("Rezervasyonlar")');
  await page.click('button:has-text("Yeni Rezervasyon")');
  await page.waitForSelector('.modal');
  await page.selectOption('select.room-select', { index: 1 }); // 102
  const guestOpts = await page.$$eval('select.guests-select option', (els) => els.map((o) => o.textContent));
  if (guestOpts.join(',') !== '1 Kişi,2 Kişi') throw new Error(guestOpts.join(','));
});

await step('Çakışan tarih rezervasyonu hata verir', async () => {
  const today = new Date();
  const y = today.getUTCFullYear(); const m = String(today.getUTCMonth() + 1).padStart(2, '0');
  await page.fill('.modal input[type="text"]', 'Test Misafir');
  await page.fill('.modal input[type="date"] >> nth=0', `${y}-${m}-04`);
  await page.fill('.modal input[type="date"] >> nth=1', `${y}-${m}-06`);
  await page.click('.modal button:has-text("Kaydet")');
  await page.waitForSelector('.error-box:not(.hidden)');
  const err = await page.textContent('.error-list');
  if (!err.includes('oda dolu')) throw new Error(err);
  console.log(`   hata mesajı: ${err.trim()}`);
});

await step('Geçerli rezervasyon kaydedilir', async () => {
  const today = new Date();
  const y = today.getUTCFullYear(); const m = String(today.getUTCMonth() + 1).padStart(2, '0');
  await page.fill('.modal input[type="date"] >> nth=0', `${y}-${m}-26`);
  await page.fill('.modal input[type="date"] >> nth=1', `${y}-${m}-28`);
  await page.fill('.modal input[type="number"] >> nth=0', '7500');
  await page.click('.modal button:has-text("Kaydet")');
  if (await page.isVisible('.error-box:not(.hidden)')) throw new Error(await page.textContent('.error-list'));
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  const rows = await page.$$('tbody tr');
  if (rows.length < 9) throw new Error(`rezervasyon satırı ${rows.length}`);
});

await step('Oda kartından demirbaşa doğrudan gider yazılır', async () => {
  await page.click('.nav-item:has-text("Odalar")');
  await page.click('.room-tile:has-text("101")');
  await page.waitForSelector('.summary-card');
  await page.click('.chip:has-text("Jakuzi")');
  const dialog = page.locator('.modal-backdrop').last(); // gider formu oda kartının üstünde açılır
  await dialog.locator('.modal:has-text("Yeni Gider")').waitFor();
  const selects = await dialog.locator('select').evaluateAll((els) => els.map((e) => e.options[e.selectedIndex].textContent));
  if (!selects.some((s) => s.includes('Jakuzi'))) throw new Error(selects.join(' | '));
  if (!selects.some((s) => s.includes('101'))) throw new Error(selects.join(' | '));
  await dialog.locator('input[type="number"]').first().fill('1200');
  await dialog.locator('input[type="text"]').first().fill('Jakuzi filtre değişimi');
  await dialog.locator('button:has-text("Kaydet")').click();
  // gider formu kapanır, altındaki oda kartı açık kalır
  await page.waitForFunction(() => document.querySelectorAll('.modal-backdrop').length === 1);
  for (const backdrop of await page.$$('.modal-backdrop')) await backdrop.evaluate((el) => el.remove());
});

await step('Gider listesinde oda/demirbaş görünür', async () => {
  await page.click('.nav-item:has-text("Giderler")');
  const text = await page.textContent('tbody');
  if (!text.includes('Jakuzi filtre değişimi')) throw new Error('gider listede yok');
});

await step('Panelde kırılım modalı açılır', async () => {
  await page.click('.nav-item:has-text("Panel")');
  await page.click('.table-card tbody tr >> nth=0');
  await page.waitForSelector('.modal:has-text("Gider Kırılımı")');
  const tags = await page.$$eval('.tag', (els) => [...new Set(els.map((e) => e.textContent))]);
  console.log('   kırılım etiketleri:', tags.join(', '));
  if (!tags.length) throw new Error('kırılım boş');
  await page.click('.modal-header .icon-btn');
});

await step('Ayarlar: tarife düzenlenip kaydedilir', async () => {
  await page.click('.nav-item:has-text("Ayarlar")');
  await page.waitForSelector('.tariff-row');
  await page.fill('.tariff-row >> nth=0 >> input.count', '160');
  await page.click('button:has-text("Kaydet")');
  await page.waitForSelector('.toast.show');
  await page.click('.nav-item:has-text("Ayarlar")');
  const value = await page.inputValue('.tariff-row >> nth=0 >> input.count');
  if (value !== '160') throw new Error(`tarife kaydedilmedi: ${value}`);
});

await step('Yenilemede veriler korunur (localStorage)', async () => {
  await page.reload({ waitUntil: 'load' });
  await page.click('.nav-item:has-text("Giderler")');
  const text = await page.textContent('tbody');
  if (!text.includes('Jakuzi filtre değişimi')) throw new Error('kalıcılık yok');
});

await page.screenshot({ path: 'test/browser/screenshots/panel.png', fullPage: true });
await page.click('.nav-item:has-text("Odalar")');
await page.screenshot({ path: 'test/browser/screenshots/odalar.png', fullPage: true });
await page.click('.room-tile:has-text("101")');
await page.waitForSelector('.room-card');
await page.screenshot({ path: 'test/browser/screenshots/oda-karti.png', fullPage: true });

if (errors.length) { console.log('❌ konsol hataları:', errors); process.exitCode = 1; }
else console.log('✅ konsol hatası yok');
await browser.close();
