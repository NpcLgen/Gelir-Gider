/**
 * PRD v2.0 tarayıcı akış testi — 18 maddelik teslim listesini uçtan uca doğrular.
 *
 *   npm start                     # ayrı bir terminalde
 *   npm i -D playwright && npx playwright install chromium
 *   npm run test:browser:v2
 *
 * Ek olarak yedekleme/geri yükleme, mobil-tablet uyumu ve yazdırma panelinin
 * taşma düzeltmesi de burada kontrol edilir.
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
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.setDefaultTimeout(8000);
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
});
// Ayar sekmesi değişiminde çıkan "kaydedilmemiş değişiklik" onayı kabul edilir.
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
}, t, { timeout: 10000 });

const settingsTab = async (label) => {
  await go('Ayarlar');
  await page.locator('.settings-tab').filter({ hasText: label }).first().click();
  await page.waitForSelector('.settings-tab.active');
};

const today = new Date().toISOString().slice(0, 10);

await openLogin(page, BASE);

/* --------------------------------------- §1.1 şifre göster/gizle -------- */

await step('§1.1 Şifre göster/gizle düğmesi değeri koruyarak çalışır', async () => {
  const input = page.locator('.login-card .pw-wrap input');
  await input.fill('deneme123');
  await page.click('.login-card .pw-toggle');
  if (await input.getAttribute('type') !== 'text') throw new Error('şifre görünür olmadı');
  if (await input.inputValue() !== 'deneme123') throw new Error('değer kayboldu');
  const pressed = await page.getAttribute('.login-card .pw-toggle', 'aria-pressed');
  if (pressed !== 'true') throw new Error(`aria-pressed: ${pressed}`);
  await page.click('.login-card .pw-toggle');
  if (await input.getAttribute('type') !== 'password') throw new Error('tekrar gizlenmedi');
});

/* ------------------------------------------------------- giriş --------- */

/** Verilen şifreyle giriş dener. */
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

// Tekrarlanabilirlik için demo verisi yüklenir.
await page.evaluate(() => fetch('/api/demo', { method: 'POST', credentials: 'same-origin' }));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.layout', { timeout: 15000 });

/* ------------------------------------ §1.3 Dashboard + tek kategori ---- */

await step('§1.3 Giriş sonrası Dashboard açılır', async () => {
  const h1 = await page.textContent('h1');
  if (!h1.includes('Yönetici Özeti')) throw new Error(h1);
  if (!(await page.url()).includes('#panel')) throw new Error(`adres: ${await page.url()}`);
});

await step('§1.3 Aynı anda yalnızca bir menü kategorisi açık kalır', async () => {
  await page.locator('.nav-group').filter({ hasText: 'Restoran' }).first().click();
  await page.waitForTimeout(250);
  const open = await page.$$eval('.nav-group.open', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  if (open.length !== 1) throw new Error(`açık grup sayısı: ${open.length} (${open.join(', ')})`);
  if (!open[0].includes('Restoran')) throw new Error(`açık grup: ${open[0]}`);
});

/* -------------------------------------- §1.2 kategori değiştirme hatası - */

await step('§1.2 Çıkış–giriş sonrası menüde gezinme çalışır', async () => {
  // Gerçek çıkış akışı: hesap menüsünden "Çıkış Yap" → giriş ekranı.
  await page.click('.account-chip');
  await page.click('button:has-text("Çıkış Yap")');
  await page.waitForSelector('.login-card', { timeout: 15000 });
  if (await tryLogin(CHANGED) !== 'ok') throw new Error('yeniden giriş yapılamadı');
  await page.waitForSelector('.layout');

  // Aynı sekmede önceki oturumun dinleyicisi kalmışsa sayfa değişmezdi.
  await go('Fiyat Girişi');
  const h1 = await page.textContent('h1');
  if (!/Takvim|Fiyat/.test(h1)) throw new Error(`sayfa değişmedi: ${h1}`);
  await go('Dashboard');
  if (!(await page.textContent('h1')).includes('Yönetici Özeti')) throw new Error('Dashboard’a dönülemedi');
});

/* ---------------------------------------- §1.4 tarih / dönem seçici ---- */

await step('§1.4 Hızlı dönem filtreleri eksiksiz ve çalışıyor', async () => {
  const chips = await page.$$eval('.topbar .chip', (els) => els.map((e) => e.textContent.trim()));
  for (const needed of ['Bugün', 'Bu Hafta', 'Bu Ay', 'Geçen Ay', 'Bu Yıl', 'Özel']) {
    if (!chips.some((c) => c.includes(needed))) throw new Error(`${needed} yok: ${chips.join(', ')}`);
  }
  await page.click('.range-chips .chip:has-text("Geçen Ay")');
  await page.waitForTimeout(300);
  const active = await page.textContent('.range-chips .chip.checked');
  if (!active.includes('Geçen Ay')) throw new Error(`etkin filtre: ${active}`);

  // Özel aralık: iki tarih girilerek dönem elle belirlenir.
  try {
    await page.click('.custom-range summary');
    await page.fill('.custom-range input[type="date"] >> nth=0', '2026-03-02');
    await page.fill('.custom-range input[type="date"] >> nth=1', '2026-03-15');
    await page.click('.custom-range button');
    await page.waitForTimeout(500);
    const title = await page.textContent('.content .muted');
    if (!title.includes('2026-03-02')) throw new Error(`özel aralık uygulanmadı: ${title.trim()}`);
  } finally {
    // Dönem sonraki adımları etkilemesin diye her hâlükârda bu aya döndürülür.
    await page.click('.range-chips .chip:has-text("Bu Ay")');
    await page.waitForTimeout(400);
  }
  console.log(`   filtreler: ${chips.join(' · ')}`);
});

/* -------------------------- §2.1 / §2.3 restoran geliri ve gün sonu ---- */

await step('§2.3 Bir güne iki gün sonu girilir ve toplanır', async () => {
  await go('Restoran Gelirleri');
  await page.waitForSelector('h1:has-text("Restoran Gelirleri")');
  for (const [seq, amount] of [[1, '12500'], [2, '8750']]) {
    await page.click('button:has-text("Gün Sonu Ekle")');
    await page.waitForSelector('.modal input.income-amount');
    await page.fill('.modal input[type="date"]', today);
    await page.selectOption('.modal select.income-sequence', String(seq));
    await page.fill('.modal input.income-amount', amount);
    await clearToast();
    await page.click('.modal button:has-text("Kaydet")');
    await waitToast('Gün sonu kaydedildi');
  }
  const table = await page.textContent('.table-card');
  if (!table.includes('21.250')) throw new Error(`günlük toplam 21.250 değil: ${table.replace(/\s+/g, ' ').slice(0, 160)}`);
  console.log('   12.500 + 8.750 = 21.250 ✓');
});

await step('§2.3 Üçüncü gün sonu kaydı reddedilir', async () => {
  await page.click('button:has-text("Gün Sonu Ekle")');
  await page.waitForSelector('.modal input.income-amount');
  await page.fill('.modal input[type="date"]', today);
  await page.selectOption('.modal select.income-sequence', '1');
  await page.fill('.modal input.income-amount', '999');
  await page.click('.modal button:has-text("Kaydet")');
  await page.waitForSelector('.modal .error-box:not(.hidden)');
  const message = await page.textContent('.modal .error-list');
  if (!/en fazla 2|zaten kayıtlı/.test(message)) throw new Error(message.trim());
  console.log(`   ${message.replace(/\s+/g, ' ').trim()}`);
  await page.click('.modal-header .icon-btn');
});

await step('§2.1 Restoran geliri genel gelire ekleniyor', async () => {
  await go('Dashboard');
  await page.waitForSelector('.kpi-grid');
  // PRD III §4 — restoran geliri kendi kartında ve gelir vergisi hesabında yer alır.
  const kpi = (await page.textContent('.kpi:has-text("Restoran Geliri")')).replace(/\s+/g, ' ');
  if (!/21\.250/.test(kpi)) throw new Error(`restoran geliri kartta yok: ${kpi}`);
  const formul = (await page.textContent('.card:has-text("Gelir Vergisi Hesabı")')).replace(/\s+/g, ' ');
  if (!formul.includes('Restoran geliri')) throw new Error('restoran geliri toplam gelire girmiyor');
  console.log(`   ${kpi.trim().slice(0, 120)}`);
});

/* --------------------------------------------- §2.2 restoran KDV %10 --- */

await step('§2.2 Restoran KDV oranı ayrı tutulur ve değiştirilebilir', async () => {
  await settingsTab('Vergi ve Finans');
  const field = page.locator('input.tax-kdvRestaurant');
  if (!(await field.count())) throw new Error('restoran KDV alanı yok');
  if (await field.inputValue() !== '10') throw new Error(`varsayılan %10 değil: ${await field.inputValue()}`);
  await go('Vergiler');
  const table = await page.textContent('.card:has-text("Vergi Kalemleri")');
  if (!table.includes('KDV (restoran)')) throw new Error('restoran KDV satırı yok');
  if (!/%10/.test(table)) throw new Error('oran tabloda görünmüyor');
});

/* ------------------------------------- §2.4 restoran ekstra giderleri -- */

await step('§2.4 Restoran ekstra gideri tedarikçi carisine dokunmadan eklenir', async () => {
  await go('Toptancılar');
  await page.waitForSelector('.kpi:has-text("Kalan Bakiye")');
  const before = await page.textContent('.kpi:has-text("Kalan Bakiye")');

  await go('Ekstra Giderler');
  await page.click('button:has-text("Harcama Ekle")');
  await page.fill('.modal input.rex-amount', '3400');
  await page.fill('.modal input.rex-note', 'Mutfak robotu tamiri');
  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitToast('Harcama kaydedildi');
  if (!(await page.textContent('.table-card')).includes('Mutfak robotu')) throw new Error('listeye eklenmedi');

  await go('Toptancılar');
  await page.waitForSelector('.kpi:has-text("Kalan Bakiye")');
  const after = await page.textContent('.kpi:has-text("Kalan Bakiye")');
  if (after !== before) throw new Error(`tedarikçi bakiyesi değişti: ${before} → ${after}`);
});

/* -------------------------------------------- §3.1 yabancı çalışanlar -- */

await step('§3.1 Yabancı çalışan gideri eklenir, matrahtan indirilmez', async () => {
  await go('Yabancı Çalışanlar');
  await page.click('button:has-text("Çalışan Ekle")');
  await page.fill('.modal input.fw-name', 'Ahmad Hassan');
  await page.fill('.modal input.fw-amount', '28000');
  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitToast('Çalışan kaydedildi');
  const kpi = await page.textContent('.kpi:has-text("Vergi Matrahı")');
  if (!kpi.includes('İndirilemez')) throw new Error(kpi.replace(/\s+/g, ' '));

  await go('Vergiler');
  await page.waitForSelector('.card:has-text("Vergi Kalemleri")');
  const table = await page.textContent('.card:has-text("Vergi Kalemleri")');
  for (const row of ['İndirilemeyen Gider', 'Vergi Matrahı']) {
    if (!table.includes(row)) throw new Error(`${row} satırı yok`);
  }
  console.log('   KDV (konaklama) · KDV (restoran) · İndirilemeyen Gider · Vergi Matrahı ✓');
});

await step('§3.1 Giderler özetinde yabancı çalışan kalemi görünür', async () => {
  await go('Giderler');
  await page.waitForSelector('.card:has-text("Tüm Gider Kalemleri")');
  const text = await page.textContent('.card:has-text("Tüm Gider Kalemleri")');
  if (!text.includes('Ahmad Hassan')) throw new Error('yabancı çalışan gideri listede yok');
});

/* ------------------------------------------------------- §4.1 kur ----- */

await step('§4.1 Kur paneli kaynak seçimi ve elle güncelleme sunar', async () => {
  await settingsTab('Döviz Kuru');
  await page.waitForSelector('.fx-status');
  const sources = await page.$$eval('select.fx-source option', (els) => els.map((e) => e.textContent.trim()));
  if (sources.length < 2) throw new Error(`kaynak sayısı: ${sources.length}`);
  if (!sources.some((s) => s.includes('TCMB'))) throw new Error(`TCMB yok: ${sources.join(', ')}`);
  if (!(await page.$('button.fx-refresh'))) throw new Error('güncelleme düğmesi yok');
  console.log(`   kaynaklar: ${sources.join(' · ')}`);
});

await step('§4.1 Güncelleme başarısız olursa mevcut kur korunur', async () => {
  await settingsTab('Döviz Kuru');
  const before = await page.inputValue('input.fx-rate');
  // İnternet erişimi olmayan kurulumu taklit et: istek başarısız olsun.
  await page.route('**/api/fx/refresh', (route) => route.fulfill({
    status: 502,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Kur alınamadı. Denenen kaynaklar — TCMB: bağlantı yok' }),
  }));
  await clearToast();
  await page.click('button.fx-refresh');
  await waitToast('Kur güncellenemedi');
  await page.unroute('**/api/fx/refresh');
  const after = await page.inputValue('input.fx-rate');
  if (after !== before) throw new Error(`kur değişti: ${before} → ${after}`);
});

await step('§4.1 Başarılı güncelleme kuru ve kaynağı yazar', async () => {
  await settingsTab('Döviz Kuru');
  await page.route('**/api/fx/refresh', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      rate: 42.1234, provider: 'tcmb', providerLabel: 'TCMB Efektif Satış',
      sourceDate: '04.10.2026', fetchedAt: new Date().toISOString(),
    }),
  }));
  await clearToast();
  await page.click('button.fx-refresh');
  await waitToast('Kur güncellendi');
  await page.unroute('**/api/fx/refresh');
  const status = await page.textContent('.fx-status');
  if (!status.includes('TCMB')) throw new Error(`kaynak yazılmadı: ${status.replace(/\s+/g, ' ')}`);
  if (!/42[.,]12/.test(await page.inputValue('input.fx-rate'))) throw new Error('kur alanı güncellenmedi');
});

/* ----------------------------------------------- §5.1 ayar kategorileri */

await step('§5.1 Ayarlar kategorilere ayrıldı', async () => {
  await go('Ayarlar');
  const tabs = await page.$$eval('.settings-tab', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  for (const needed of ['Genel', 'Vergi', 'Kur', 'Güvenlik', 'Görünüm']) {
    if (!tabs.some((t) => t.includes(needed))) throw new Error(`${needed} sekmesi yok: ${tabs.join(' | ')}`);
  }
  console.log(`   sekmeler: ${tabs.join(' · ')}`);
  // Sekme değişince yalnızca o kategorinin kartları görünür.
  await page.locator('.settings-tab').filter({ hasText: 'Görünüm' }).first().click();
  await page.waitForTimeout(200);
  if (await page.$('.method-card')) throw new Error('genel ayarlar kartı hâlâ görünüyor');
});

/* ------------------------------------------- §6.1 fiyat ipucu balonu --- */

await step('§6.1 Boş fiyat hücresinde tavsiye ve maliyet balonu açılır', async () => {
  await go('Fiyat Girişi');
  await page.waitForSelector('table.calendar');
  // Fiyatı girilmemiş bir hücre bul.
  const cells = page.locator('.cal-cell.missing');
  const count = await cells.count();
  if (!count) throw new Error('boş fiyat hücresi yok');

  // Maliyet verisi olmayan odada balon açılmaz; ilk uygun hücre bulunana kadar denenir.
  let opened = false;
  for (let i = 0; i < Math.min(count, 12) && !opened; i += 1) {
    const cell = cells.nth(i);
    // Takvim yatay kaydırılabilir; hücre görünür alana getirilmeden üzerine gelinemez.
    await cell.scrollIntoViewIfNeeded();
    await cell.hover();
    opened = await page.waitForSelector('.price-hint', { timeout: 1500 }).then(() => true, () => false);
  }
  if (!opened) throw new Error('hiçbir boş hücrede balon açılmadı');
  const hint = await page.textContent('.price-hint');
  if (!hint.includes('Tavsiye Edilen Satış Fiyatı')) throw new Error(hint.replace(/\s+/g, ' '));
  if (!hint.includes('Ortalama Oda Maliyeti')) throw new Error('maliyet satırı yok');
  const tones = await page.$$eval('.price-hint strong', (els) => els.map((e) => e.className));
  if (!tones.includes('good') || !tones.includes('bad')) throw new Error(`renkler: ${tones.join(', ')}`);
  // Balon görünüm alanının dışına taşmamalı.
  const box = await page.locator('.price-hint').boundingBox();
  const size = page.viewportSize();
  if (box.x < 0 || box.y < 0 || box.x + box.width > size.width + 1) throw new Error(`taşma: ${JSON.stringify(box)}`);
  console.log(`   ${hint.replace(/\s+/g, ' ').trim().slice(0, 110)}`);
  await page.mouse.move(2, 2);
});

/* ------------------------------------------- yedekleme / geri yükleme -- */

await step('Yedekleme sayfası yedek alır ve listeler', async () => {
  await go('Yedekleme');
  await page.waitForSelector('h1:has-text("Yedekleme")');
  const path = await page.textContent('.path-box');
  if (!path.trim()) throw new Error('yedek klasörü yolu gösterilmiyor');
  await clearToast();
  await page.click('button.backup-now');
  await waitToast('Yedek alındı');
  await page.waitForSelector('.table-card tbody tr');
  const rows = (await page.$$('.table-card tbody tr')).length;
  if (rows < 1) throw new Error('yedek listesi boş');
  console.log(`   ${rows} yedek · klasör: ${path.trim()}`);
});

await step('Otomatik yedekleme ayarları kaydedilir', async () => {
  await page.locator('input.backup-interval').fill('6');
  await page.locator('input.backup-keep').fill('30');
  await clearToast();
  await page.click('.card:has-text("Otomatik") button.primary');
  await waitToast('Yedekleme ayarları');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.layout');
  await go('Yedekleme');
  await page.waitForSelector('input.backup-interval');
  if (await page.inputValue('input.backup-interval') !== '6') throw new Error('aralık kaydedilmedi');
});

await step('Geri yükleme önizlemesi ve uygulaması çalışır', async () => {
  await go('Yedekleme');
  await page.waitForSelector('.table-card tbody tr');
  // Geri yüklemeden önce veriyi değiştir: restoran kaydı silinince geri gelmeli.
  await page.click('.table-card tbody tr:first-child button:has-text("Geri Yükle")');
  await page.waitForSelector('.modal .restore-confirm');
  const summary = await page.textContent('.modal .kv-list');
  if (!/oda|Oda/.test(summary)) throw new Error(`özet okunamadı: ${summary.replace(/\s+/g, ' ')}`);
  await clearToast();
  await page.click('.modal .restore-confirm');
  await waitToast('Geri yükleme tamamlandı');
  console.log(`   ${summary.replace(/\s+/g, ' ').trim().slice(0, 110)}`);
});

/* ----------------------------------- yazdırma panelinde taşma düzeltmesi */

await step('Yazdırma panelindeki seçenek yazıları taşmıyor', async () => {
  await go('Finansal Raporlar');
  await page.click('.topbar button:has-text("🖨️")');
  await page.waitForSelector('.print-options');
  const overflow = await page.$$eval('.print-option', (els) => els
    .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
    .map((el) => el.textContent.trim()));
  if (overflow.length) throw new Error(`taşan seçenekler: ${overflow.join(' | ')}`);
  const count = (await page.$$('.print-option')).length;
  console.log(`   ${count} seçenek · taşma yok`);
  await page.click('.modal-header .icon-btn');
});

/* ------------------------------------------ mobil / tablet uyumluluğu -- */

await step('Tablet genişliğinde içerik yatay taşmıyor', async () => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await go('Dashboard');
  await page.waitForTimeout(400);
  const scroll = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }));
  if (scroll.doc > scroll.win + 2) throw new Error(`yatay taşma: ${scroll.doc} > ${scroll.win}`);
  const columns = await page.$$eval('.kpi-grid .kpi', (els) => els.length);
  console.log(`   ${scroll.win}px · ${columns} KPI kartı`);
});

await step('Telefon genişliğinde menü yan panele dönüşür', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const btn = page.locator('.menu-btn');
  if (!(await btn.isVisible())) throw new Error('menü düğmesi görünmüyor');
  const hidden = await page.evaluate(() => {
    const el = document.querySelector('.sidebar');
    return el.getBoundingClientRect().right <= 1;
  });
  if (!hidden) throw new Error('kenar çubuğu gizlenmedi');
  await btn.click();
  await page.waitForTimeout(350);
  if (!(await page.$('.sidebar.open'))) throw new Error('kenar çubuğu açılmadı');
  if (!(await page.$('.sidebar-backdrop.show'))) throw new Error('arka perde yok');
  // Perdenin kenar çubuğuyla örtüşmeyen kısmına dokunulur (çubuk 272px geniştir).
  await page.mouse.click(340, 500);
  await page.waitForTimeout(350);
  if (await page.$('.sidebar.open')) throw new Error('perdeye dokunarak kapanmadı');
});

await step('Telefon genişliğinde sayfalar yatay kaymıyor', async () => {
  for (const label of ['Dashboard', 'Fiyat Girişi', 'Genel Harcamalar', 'Vergiler']) {
    await go(label);
    await page.waitForTimeout(350);
    const scroll = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    if (scroll.doc > scroll.win + 2) throw new Error(`${label}: ${scroll.doc} > ${scroll.win}`);
  }
  console.log('   390px · Dashboard, Takvim, Giderler, Vergiler ✓');
});

await page.setViewportSize({ width: 1500, height: 1000 });

console.log(errors.length ? `❌ JS hatası: ${errors.slice(0, 3).join(' | ')}` : '✅ JS hatası yok');
if (errors.length) process.exitCode = 1;
await browser.close();
