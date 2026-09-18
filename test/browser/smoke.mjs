/**
 * Tarayıcı akış testi (opsiyonel) — PRD gereksinimlerini uçtan uca doğrular.
 *
 *   npm start                     # ayrı bir terminalde
 *   npm i -D playwright && npx playwright install chromium
 *   npm run test:browser
 *
 * Playwright bu deponun bağımlılığı değildir; `npm test` yalnızca birim testlerini çalıştırır.
 * Chromium yolu PW_CHROMIUM, adres BASE_URL ortam değişkenleriyle verilebilir.
 */

import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(8000);
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const BASE = process.env.BASE_URL || 'http://localhost:5173/';
await page.goto(BASE, { waitUntil: 'load' });

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    console.log(`❌ ${name}: ${e.message.split('\n')[0]}`);
    process.exitCode = 1;
    for (const backdrop of await page.$$('.modal-backdrop')) await backdrop.evaluate((el) => el.remove());
  }
};

const go = (label) => page.click(`.nav-item:has-text("${label}")`);
const today = new Date();
const y = today.getUTCFullYear();
const mm = String(today.getUTCMonth() + 1).padStart(2, '0');

/* ------------------------------------------------- §3 Dashboard ------- */

await step('Dashboard KPI kartları dolu (ADR, RevPAR, marj dâhil)', async () => {
  await page.waitForSelector('.kpi-grid .kpi');
  const labels = await page.$$eval('.kpi .muted.small:first-child', (els) => els.map((e) => e.textContent));
  for (const needed of ['Gelir', 'Net Kâr', 'ADR', 'RevPAR', 'Doluluk', 'Kişi Başı Maliyet']) {
    if (!labels.includes(needed)) throw new Error(`${needed} KPI'si yok: ${labels.join(', ')}`);
  }
  const values = await page.$$eval('.kpi strong', (els) => els.map((e) => e.textContent));
  console.log(`   ${labels.slice(0, 4).join(' / ')} = ${values.slice(0, 4).join(' / ')}`);
});

await step('Gider dağılım halka grafiği dilim ve açıklama üretir', async () => {
  const slices = await page.$$('.donut-slice');
  if (slices.length < 3) throw new Error(`dilim sayısı ${slices.length}`);
  const legend = await page.$$eval('.legend-row', (els) => els.map((e) => e.textContent));
  if (!legend.some((t) => t.includes('Sabit'))) throw new Error(legend.join(' | '));
});

await step('Başa baş noktası hesaplanır', async () => {
  const text = await page.textContent('.card:has-text("Başa Baş Noktası")');
  if (!text.includes('Gereken doluluk')) throw new Error('başa baş kartı eksik');
  if (!/Gereken minimum ADR/.test(text)) throw new Error('minimum ADR yok');
});

await step('YOY tablosu geçen yıl karşılaştırmasını gösterir', async () => {
  const text = await page.textContent('.card:has-text("Yıllık Karşılaştırma")');
  if (!text.includes('RevPAR')) throw new Error('YOY satırları eksik');
});

/* ------------------------------------------ §6.1 kur anahtarı --------- */

await step('Kur anahtarı tüm tabloları EUR’ya çevirir', async () => {
  const before = await page.textContent('.kpi strong');
  await page.click('.cur-btn:has-text("EUR")');
  await page.waitForTimeout(250);
  const after = await page.textContent('.kpi strong');
  if (!after.includes('€')) throw new Error(`EUR’ya dönmedi: ${after}`);
  console.log(`   ${before.trim()} → ${after.trim()}`);
  await page.click('.cur-btn:has-text("TRY")');
});

/* ------------------------------------------ §7.1 tarih filtreleri ----- */

await step('Hızlı tarih filtreleri dönemi değiştirir', async () => {
  await page.click('.chip:has-text("Geçen Ay")');
  await page.waitForTimeout(250);
  const subtitle = await page.textContent('.content p.muted');
  if (!subtitle.includes('→')) throw new Error(subtitle);
  await page.click('.chip:has-text("Bu Ay")');
});

/* ------------------------------------------ §1.1 fiyat takvimi -------- */

await step('Takvim ızgarası odalar × günler olarak açılır', async () => {
  await go('Fiyat / Gelir Takvimi');
  await page.waitForSelector('table.calendar');
  const rows = await page.$$('table.calendar tbody tr');
  if (rows.length < 8) throw new Error(`oda satırı ${rows.length}`);
  const filled = await page.$$('.cal-cell.filled');
  const missing = await page.$$('.cal-cell.missing');
  console.log(`   ${rows.length} oda · ${filled.length} dolu gün · ${missing.length} boş gün`);
  if (!missing.length) throw new Error('eksik gün vurgusu test edilemiyor');
});

await step('Tek hücreye fiyat girilir', async () => {
  await page.click('.cal-cell.missing >> nth=0');
  await page.waitForSelector('.modal:has-text("Bu gecenin satış fiyatı")');
  await page.fill('.modal input[type="number"]', '3750');
  await page.click('.modal button:has-text("Kaydet")');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
});

await step('Toplu güncelleme hafta içi/hafta sonu fiyatı uygular', async () => {
  await page.click('button:has-text("Toplu Güncelle")');
  await page.waitForSelector('.modal:has-text("Toplu Fiyat Güncelleme")');
  const inputs = page.locator('.modal input[type="number"]');
  await inputs.nth(0).fill('2800');
  await inputs.nth(1).fill('4200');
  await page.click('.modal button:has-text("Uygula")');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  await page.waitForSelector('.toast.show');
  const toastText = await page.textContent('.toast');
  if (!/güne fiyat uygulandı/.test(toastText)) throw new Error(toastText);
  console.log(`   ${toastText.trim()}`);
});

await step('Boş günleri vurgula anahtarı çalışır', async () => {
  await page.click('button:has-text("Boş Günleri Vurgula")');
  await page.waitForTimeout(250);
  const flagged = await page.$$('.cal-cell.flag');
  await page.click('button:has-text("Boş Günleri Vurgula")');
  if (!flagged.length) console.log('   (tüm günler dolu — vurgulanacak gün yok)');
});

/* ------------------------------------------ §1.2 / §2.3 giderler ------ */

await step('Gider aktif/pasif anahtarı kaydı silmeden hesaptan düşer', async () => {
  await go('Gider Yönetimi');
  await page.waitForSelector('.toggle');
  const rowsBefore = (await page.$$('tbody tr')).length;
  await page.click('.toggle.on >> nth=0');
  await page.waitForSelector('.toast.show');
  const message = await page.textContent('.toast');
  if (!message.includes('pasife')) throw new Error(message);
  const rowsAfter = (await page.$$('tbody tr')).length;
  if (rowsAfter !== rowsBefore) throw new Error('kayıt silinmiş olmamalı');
  await page.click('.toggle >> nth=0'); // geri al
});

await step('Grup filtresi listeyi daraltır', async () => {
  const before = (await page.$$('tbody tr')).length;
  await page.click('.chip-check:has-text("Sabit Giderler")');
  await page.waitForTimeout(250);
  const after = (await page.$$('tbody tr')).length;
  if (after >= before) throw new Error(`filtre çalışmadı (${before} → ${after})`);
  await page.click('.chip-check:has-text("Sabit Giderler")');
});

await step('Tekrarlayan gider rozetle gösterilir', async () => {
  await page.click('.check-inline:has-text("Sadece tekrarlayanlar") input');
  await page.waitForTimeout(250);
  const text = await page.textContent('tbody');
  if (!text.includes('her ayın')) throw new Error('tekrarlayan gider bulunamadı');
  await page.click('.check-inline:has-text("Sadece tekrarlayanlar") input');
});

await step('EUR gider TL karşılığıyla birlikte listelenir', async () => {
  const text = await page.textContent('tbody');
  if (!text.includes('€')) throw new Error('EUR gider yok');
});

/* --------------------------- §4.7 oda kartı ve direkt gider ataması --- */

await step('Oda kartı: kapasite menüsü yatak kapasitesiyle sınırlı', async () => {
  await go('Oda Ayarları');
  await page.click('.room-tile:has-text("101")');
  await page.waitForSelector('.room-card');
  const cap = await page.inputValue('.bed-capacity');
  const opts = await page.$$eval('select.max-occupancy option', (els) => els.map((o) => o.textContent));
  if (cap !== '3 kişi' || opts.length !== 3) throw new Error(`${cap} / ${opts.join(',')}`);
});

await step('Demirbaş checkbox katsayıyı canlı günceller', async () => {
  const before = await page.textContent('.summary-card .kv strong');
  await page.click('.amenity:has-text("Minibar")');
  const after = await page.textContent('.summary-card .kv strong');
  if (before === after) throw new Error(`katsayı değişmedi: ${before}`);
  console.log(`   elektrik ağırlığı ${before} → ${after}`);
  await page.click('.amenity:has-text("Minibar")');
});

await step('Oda kartından demirbaşa doğrudan gider yazılır', async () => {
  await page.click('.chip:has-text("Jakuzi")');
  const dialog = page.locator('.modal-backdrop').last();
  await dialog.locator('.modal:has-text("Yeni Gider")').waitFor();
  const selects = await dialog.locator('select').evaluateAll((els) => els.map((e) => e.options[e.selectedIndex].textContent));
  if (!selects.some((s) => s.includes('Jakuzi')) || !selects.some((s) => s.includes('101'))) {
    throw new Error(selects.join(' | '));
  }
  await dialog.locator('input[type="number"]').first().fill('1200');
  await dialog.locator('input[type="text"]').first().fill('Jakuzi filtre değişimi');
  await dialog.locator('button:has-text("Kaydet")').click();
  await page.waitForFunction(() => document.querySelectorAll('.modal-backdrop').length === 1);
  for (const backdrop of await page.$$('.modal-backdrop')) await backdrop.evaluate((el) => el.remove());
});

/* ------------------------------------------ rezervasyon kuralları ----- */

await step('Rezervasyonda kişi sayısı oda kapasitesiyle sınırlı', async () => {
  await go('Rezervasyonlar');
  await page.click('button:has-text("Yeni Rezervasyon")');
  await page.waitForSelector('.modal');
  await page.selectOption('select.room-select', { index: 1 }); // 102 — 2 kişilik
  const guestOpts = await page.$$eval('select.guests-select option', (els) => els.map((o) => o.textContent));
  if (guestOpts.join(',') !== '1 Kişi,2 Kişi') throw new Error(guestOpts.join(','));
});

await step('Çakışan tarih rezervasyonu reddedilir', async () => {
  await page.fill('.modal input[type="text"]', 'Test Misafir');
  await page.fill('.modal input[type="date"] >> nth=0', `${y}-${mm}-04`);
  await page.fill('.modal input[type="date"] >> nth=1', `${y}-${mm}-06`);
  await page.click('.modal button:has-text("Kaydet")');
  await page.waitForSelector('.error-box:not(.hidden)');
  const err = await page.textContent('.error-list');
  if (!err.includes('oda dolu')) throw new Error(err);
  console.log(`   ${err.trim()}`);
});

await step('EUR rezervasyon komisyon oranıyla kaydedilir', async () => {
  await page.fill('.modal input[type="date"] >> nth=0', `${y}-${mm}-26`);
  await page.fill('.modal input[type="date"] >> nth=1', `${y}-${mm}-28`);
  await page.fill('.modal input[type="number"] >> nth=0', '250');
  await page.selectOption('.modal select.res-currency', 'EUR');
  await page.click('.modal button:has-text("Kaydet")');
  if (await page.isVisible('.error-box:not(.hidden)')) throw new Error(await page.textContent('.error-list'));
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  const text = await page.textContent('tbody');
  if (!text.includes('Test Misafir')) throw new Error('rezervasyon listeye eklenmedi');
});

/* ------------------------------------------ §8 ayarlar ---------------- */

await step('Dağıtım yöntemi A/B/C arasında değiştirilir', async () => {
  await go('Sistem Ayarları');
  await page.waitForSelector('.method-card');
  await page.click('.method-card:has-text("Metrekare")');
  await page.click('button:has-text("Ayarları Kaydet")');
  await page.waitForSelector('.toast.show');
  await go('Dashboard');
  const footer = await page.textContent('.method-footer');
  if (!footer.includes('Metrekare')) throw new Error(footer);
  console.log(`   ${footer.trim()}`);
  await go('Sistem Ayarları');
  await page.click('.method-card:has-text("Özel Katsayı")');
  await page.click('button:has-text("Ayarları Kaydet")');
});

await step('Hedef marj paneldeki renklendirmeyi belirler', async () => {
  await page.locator('input.target-margin').fill('0.99');
  await page.click('button:has-text("Ayarları Kaydet")');
  await go('Dashboard');
  const tone = await page.getAttribute('.kpi:has-text("Kâr Marjı") strong', 'class');
  if (tone !== 'bad') throw new Error(`hedef altındayken kırmızı olmalı, sınıf: ${tone}`);
  await go('Sistem Ayarları');
  await page.locator('input.target-margin').fill('0.35');
  await page.click('button:has-text("Ayarları Kaydet")');
});

await step('Kategori yöneticisi özel kategori ekler', async () => {
  await page.click('button:has-text("Kategori Ekle")');
  await page.fill('.category-row input[type="text"]', 'Havuz Kimyasalı');
  await page.click('button:has-text("Ayarları Kaydet")');
  await go('Gider Yönetimi');
  await page.click('button:has-text("Yeni Gider")');
  const options = await page.$$eval('select.expense-category option', (els) => els.map((o) => o.textContent));
  if (!options.includes('Havuz Kimyasalı')) throw new Error('özel kategori formda yok');
  await page.click('.modal-header .icon-btn');
});

/* ------------------------------------------ §6.1 raporlar / dışa aktarım */

await step('Raporlar sayfası CSV indirir', async () => {
  await go('Finansal Raporlar');
  await page.waitForSelector('button:has-text("CSV Kaydet")');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("CSV Kaydet")'),
  ]);
  if (!download.suggestedFilename().endsWith('.csv')) throw new Error(download.suggestedFilename());
  console.log(`   ${download.suggestedFilename()}`);
});

await step('Raporlar sayfası Excel dosyası indirir', async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("Excel’e Aktar")'),
  ]);
  if (!download.suggestedFilename().endsWith('.xls')) throw new Error(download.suggestedFilename());
});

/* ------------------------------------------ §6.1 FAB ve kalıcılık ----- */

await step('Sağ alt köşedeki hızlı ekle butonu gider formunu açar', async () => {
  await page.hover('.fab-btn');
  await page.click('.fab-menu button:has-text("Gider Ekle")');
  await page.waitForSelector('.modal:has-text("Yeni Gider")');
  await page.click('.modal-header .icon-btn');
});

await step('Yenilemede veriler korunur (localStorage)', async () => {
  await page.reload({ waitUntil: 'load' });
  await go('Gider Yönetimi');
  const text = await page.textContent('tbody');
  if (!text.includes('Jakuzi filtre değişimi')) throw new Error('kalıcılık yok');
});

await go('Dashboard');
await page.waitForSelector('.kpi-grid');
await page.screenshot({ path: 'test/browser/screenshots/dashboard.png', fullPage: true });
await go('Fiyat / Gelir Takvimi');
await page.screenshot({ path: 'test/browser/screenshots/takvim.png' });
await go('Gider Yönetimi');
await page.screenshot({ path: 'test/browser/screenshots/giderler.png' });
await go('Oda Ayarları');
await page.click('.room-tile:has-text("101")');
await page.waitForSelector('.room-card');
await page.screenshot({ path: 'test/browser/screenshots/oda-karti.png', fullPage: true });

if (errors.length) { console.log('❌ konsol hataları:', errors); process.exitCode = 1; }
else console.log('✅ konsol hatası yok');
await browser.close();
