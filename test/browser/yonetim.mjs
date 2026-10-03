/**
 * Yeni PRD akışları (opsiyonel tarayıcı testi):
 * giriş/yetki, çalışanlar, ekstra çalışan, toptancı cari, kasa, vergi,
 * kullanıcı yönetimi, Excel ve dinamik yazdırma.
 *
 *   npm start                     # ayrı terminalde
 *   npm run test:browser:yonetim
 *
 * Temiz bir kurulum beklenir (data/ klasörü yoksa varsayılan Admin oluşur).
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const ADMIN = { user: process.env.TEST_USER || 'Admin', pass: process.env.TEST_PASS || 'Admin2026' };
const CHANGED = process.env.TEST_PASS2 || 'Otel2026Guvenli';

const errors = [];
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
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
    for (const backdrop of await page.$$('.modal-backdrop')) await backdrop.evaluate((el) => el.remove());
  }
};

// Menü etiketleri emoji ile başlar; sondan eşleştirmek "Ayarlar"ı "Oda Ayarları"ndan ayırır.
const go = (label) => page.locator('.nav-item').filter({ hasText: new RegExp(`${label}$`) }).first().click();
const clearToast = () => page.evaluate(() => document.querySelector('.toast')?.classList.remove('show'));
const waitForToast = (fragment) => page.waitForFunction(
  (text) => { const el = document.querySelector('.toast.show'); return Boolean(el && el.textContent.includes(text)); },
  fragment, { timeout: 10000 },
);

async function login(username, password) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.login-card');
  await page.fill('.login-card input[type="text"]', username);
  await page.fill('.login-card input[type="password"]', password);
  await page.click('.login-card button[type="submit"]');
  await page.waitForSelector('.layout, .login-card:has-text("Şifre Değiştirme Zorunlu"), .error-box:not(.hidden)', { timeout: 15000 });
}

const today = new Date();
const y = today.getUTCFullYear();
const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
const monthKey = `${y}-${mm}`;
/** Testin tekrar çalıştırılabilmesi için koşuya özel kullanıcı adı. */
const TEST_USERNAME = `resepsiyon${Date.now().toString().slice(-6)}`;

/* ------------------------------------------------- §1.1 / §7 Giriş ------ */

await step('Varsayılan Admin ile giriş ve zorunlu şifre değişikliği', async () => {
  await login(ADMIN.user, ADMIN.pass);
  if (await page.$('.login-card:has-text("Şifre Değiştirme Zorunlu")')) {
    const fields = page.locator('.login-card input[type="password"]');
    await fields.nth(0).fill(ADMIN.pass);
    await fields.nth(1).fill(CHANGED);
    await fields.nth(2).fill(CHANGED);
    await page.click('.login-card button[type="submit"]');
  } else if (!(await page.$('.layout'))) {
    await login(ADMIN.user, CHANGED);
  }
  await page.waitForSelector('.layout', { timeout: 15000 });
  await page.evaluate(() => fetch('/api/demo', { method: 'POST', credentials: 'same-origin' }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.layout', { timeout: 15000 });
});

/* --------------------------------------------------- §3.2 Çalışanlar ---- */

await step('Personel maaş ve SGK ayrı girilir, dönem gideri hesaplanır', async () => {
  await go('Çalışanlar');
  await page.click('button:has-text("Personel Ekle")');
  await page.fill('.modal input.emp-name', 'Ayşe Yıldız');
  await page.fill('.modal input.emp-salary', '32000');
  await page.fill('.modal input.emp-sgk', '11500');
  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitForToast('Personel kaydedildi');
  const text = await page.textContent('.kpi-grid');
  if (!text.includes('43.500')) throw new Error(`dönem gideri hesaplanmadı: ${text.replace(/\s+/g, ' ')}`);
  console.log(`   ${text.replace(/\s+/g, ' ').trim().slice(0, 110)}`);
});

/* ----------------------------------------------- §3.3 Ekstra çalışan ---- */

await step('Ekstra çalışan ödemesi döneme yansır', async () => {
  await go('Ekstra Çalışan');
  await page.click('button:has-text("Ödeme Ekle")');
  await page.fill('.modal input.extra-name', 'Günlük yardımcı');
  await page.fill('.modal input.extra-amount', '1750');
  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitForToast('Ödeme kaydedildi');
  const total = await page.textContent('.kpi strong');
  if (!total.includes('1.750')) throw new Error(`dönem toplamı: ${total}`);
});

/* ------------------------------------------------ §4.2 Toptancı cari --- */

await step('Toptancı eklenir ve cari paneli açılır', async () => {
  await go('Toptancılar');
  await page.click('button:has-text("Yeni Toptancı")');
  await page.fill('.modal input.supplier-name', 'Anadolu Gıda');
  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitForToast('Toptancı kaydedildi');
  // Kayıt sonrası cari hesap kendiliğinden açılır; açılmadıysa aç.
  if (!(await page.$('.supplier-ledger'))) await page.click('button:has-text("Cari Hesabı Aç")');
  await page.waitForSelector('.supplier-ledger');
});

await step('Fatura borcu artırır, ödeme azaltır', async () => {
  await page.click('button:has-text("Fatura Ekle")');
  await page.fill('.modal input.txn-amount', '12000');
  await page.fill('.modal input.txn-invoice', 'A-1001');
  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitForToast('Fatura kaydedildi');

  let balance = await page.textContent('.supplier-balance strong');
  if (!balance.includes('12.000')) throw new Error(`fatura sonrası bakiye: ${balance}`);

  if (!(await page.$('.supplier-ledger'))) await page.click('button:has-text("Cari Hesabı Aç")');
  await page.click('button:has-text("Ödeme Ekle")');
  await page.fill('.modal input.txn-amount', '5000');
  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitForToast('Ödeme kaydedildi');

  balance = await page.textContent('.supplier-balance strong');
  if (!balance.includes('7.000')) throw new Error(`ödeme sonrası bakiye: ${balance}`);
  console.log(`   kalan bakiye ${balance.trim()}`);
});

await step('Toptancı adına göre arama çalışır', async () => {
  await page.fill('.supplier-search', 'bulunmayan');
  await page.waitForTimeout(300);
  if (await page.$('.supplier-card')) throw new Error('filtre uygulanmadı');
  await page.fill('.supplier-search', 'Anadolu');
  await page.waitForTimeout(300);
  if (!(await page.$('.supplier-card'))) throw new Error('arama sonucu bulunamadı');
  await page.fill('.supplier-search', '');
});

/* ------------------------------------------------------ §5.2 Kasa ------ */

await step('Gün sonu: kasa açığı tespit edilir', async () => {
  await go('Gün Sonu / Kasa');
  await page.click('button:has-text("Gün Sonu Yap")');
  await page.waitForSelector('.modal input.counted-cash');
  await page.fill('.modal input.counted-cash', '100');
  await page.waitForTimeout(250);
  const verdict = await page.textContent('.modal .cash-result');
  console.log(`   ${verdict.replace(/\s+/g, ' ').trim().slice(0, 90)}`);
  if (!/Kasa Açığı|Kasa Fazlası|Denk/.test(verdict)) throw new Error(verdict);
  await clearToast();
  await page.click('.modal button:has-text("Gün Sonunu Kaydet")');
  await waitForToast('Gün sonu kaydedildi');
});

/* ------------------------------------------------------ §5.1 Vergi ----- */

await step('Vergi raporu KDV, konaklama vergisi ve turizm payını ayrı gösterir', async () => {
  await go('Vergiler');
  await page.waitForSelector('.card:has-text("Vergi Kalemleri")');
  const table = await page.textContent('.card:has-text("Vergi Kalemleri")');
  for (const kalem of ['KDV (hesaplanan)', 'KDV (indirilecek)', 'Konaklama Vergisi', 'Turizm Payı', 'Gelir / Kurumlar Vergisi']) {
    if (!table.includes(kalem)) throw new Error(`${kalem} satırı yok`);
  }
  const kpis = await page.$$eval('.kpi strong', (els) => els.map((e) => e.textContent.trim()));
  console.log(`   ${kpis.join(' · ')}`);
});

await step('Vergi oranları değiştirilebilir ve rapora yansır', async () => {
  const before = await page.textContent('.kpi:has-text("Hesaplanan KDV") strong');
  await page.fill('input.tax-kdvIncome', '1');
  await clearToast();
  await page.click('button:has-text("Oranları Kaydet")');
  await waitForToast('Vergi oranları güncellendi');
  const after = await page.textContent('.kpi:has-text("Hesaplanan KDV") strong');
  if (before === after) throw new Error(`oran değişimi rapora yansımadı (${before})`);
  console.log(`   %10 → %1: ${before.trim()} → ${after.trim()}`);
  await page.fill('input.tax-kdvIncome', '10');
  await clearToast();
  await page.click('button:has-text("Oranları Kaydet")');
  await waitForToast('Vergi oranları güncellendi');
});

/* ------------------------------------------------- §2.1 Excel ---------- */

await step('Örnek Excel şablonu "?" düğmesinden indirilir', async () => {
  await go('Excel İşlemleri');
  await page.click('button:has-text("Yardım / Örnek Şablon")');
  await page.waitForSelector('.modal:has-text("Excel Şablonu Yardımı")');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.modal button:has-text("Gider Şablonu")'),
  ]);
  if (!download.suggestedFilename().endsWith('.xlsx')) throw new Error(download.suggestedFilename());
  console.log(`   ${download.suggestedFilename()}`);
  await page.click('.modal-header .icon-btn');
});

await step('Dönem verisi Excel olarak dışa aktarılır', async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("Dönemi Excel’e Aktar")'),
  ]);
  if (!download.suggestedFilename().endsWith('.xlsx')) throw new Error(download.suggestedFilename());
});

/* --------------------------------------------- §2.2 Dinamik yazdırma --- */

await step('Yazdırma seçim ekranı açılır ve içerik seçilebilir', async () => {
  await go('Vergiler');
  await page.click('.topbar button:has-text("🖨️")');
  await page.waitForSelector('.modal:has-text("Yazdırma Seçenekleri")');
  const options = await page.$$eval('.print-option', (els) => els.map((e) => e.textContent.trim()));
  console.log(`   seçenekler: ${options.join(' · ')}`);
  if (options.length < 5) throw new Error('seçenek listesi eksik');
  await page.click('.modal button:has-text("Tümünü Kaldır")');
  const checked = await page.$$eval('.print-option input', (els) => els.filter((e) => e.checked).length);
  if (checked !== 0) throw new Error('seçimler kaldırılmadı');
  await page.click('.modal-header .icon-btn');
});


/* ------------------------------------- §9 Menü yapısı ve gider özeti ---- */

await step('Menü grupları açılıp kapanabiliyor ve tercih hatırlanıyor', async () => {
  const groups = await page.$$eval('.nav-group', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  console.log(`   gruplar: ${groups.join(' | ')}`);
  if (groups.length < 5) throw new Error(`grup sayısı: ${groups.length}`);

  const before = (await page.$$('.nav-sub .nav-item')).length;
  await page.locator('.nav-group').filter({ hasText: 'Giderler' }).click();
  await page.waitForTimeout(200);
  const after = (await page.$$('.nav-sub .nav-item')).length;
  if (after >= before) throw new Error(`kapanmadı (${before} → ${after})`);

  // Tercih yenilemeden sonra da korunur.
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.layout', { timeout: 15000 });
  const stillClosed = await page.$$eval('.nav-group.open', (els) => els.map((e) => e.textContent));
  if (stillClosed.some((t) => t.includes('Giderler'))) throw new Error('kapalı tercih hatırlanmadı');

  await page.locator('.nav-group').filter({ hasText: 'Giderler' }).click();
  await page.waitForTimeout(200);
  const items = await page.$$eval('.nav-sub .nav-item', (els) => els.map((e) => e.textContent.trim()));
  if (!items.some((i) => i.includes('Çalışanlar'))) throw new Error('tekrar açılmadı');
});

await step('Giderler alt kategorisi tüm gider kalemlerini birleştiriyor', async () => {
  await page.locator('.nav-item').filter({ hasText: /^.{0,4}Giderler$/ }).first().click();
  await page.waitForSelector('.card:has-text("Tüm Gider Kalemleri")');
  const kpis = await page.$$eval('.kpi', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  console.log(`   ${kpis[0]}`);
  for (const kaynak of ['Genel Harcamalar', 'Personel', 'Ekstra Çalışan', 'Toptancı']) {
    if (!kpis.some((k) => k.includes(kaynak))) throw new Error(`${kaynak} kartı yok`);
  }
  const rows = (await page.$$('.card:has-text("Tüm Gider Kalemleri") tbody tr')).length;
  if (rows < 5) throw new Error(`kalem sayısı az: ${rows}`);

  // Personel ve toptancı faturaları da listeye giriyor mu?
  const tablo = await page.textContent('.card:has-text("Tüm Gider Kalemleri")');
  if (!tablo.includes('Ayşe Yıldız')) throw new Error('personel gideri listede yok');
  if (!tablo.includes('Anadolu Gıda')) throw new Error('toptancı faturası listede yok');
});

await step('Özet kartından ilgili gider sayfasına geçiliyor', async () => {
  // "Personel (Maaş + SGK)" kartı Çalışanlar sayfasına götürür.
  await page.locator('.kpi-link').filter({ hasText: 'Personel' }).click();
  await page.waitForTimeout(400);
  const h1 = await page.textContent('h1');
  if (!h1.includes('Çalışanlar')) throw new Error(h1);
});

/* ------------------------------------------------- §6 Yetkilendirme ---- */

await step('Admin sınırlı yetkili kullanıcı oluşturur', async () => {
  await go('Kullanıcı ve Yetki');
  await page.click('button:has-text("Yeni Kullanıcı")');
  await page.fill('.modal input.user-username', TEST_USERNAME);
  await page.fill('.modal input.user-display', 'Ön Büro');
  await page.fill('.modal input.user-password', 'Resepsiyon2026');
  for (const key of ['dashboard', 'gelirler']) {
    await page.click(`.perm-row:has(input[data-module="${key}"])`);
  }
  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitForToast('Kullanıcı kaydedildi');
  const rows = await page.textContent('tbody');
  if (!rows.includes(TEST_USERNAME)) throw new Error('kullanıcı listeye eklenmedi');
});

await step('İşlem kayıtları kullanıcı ve tarihle tutulur', async () => {
  const log = await page.textContent('.card:has-text("İşlem Kayıtları")');
  if (!log.includes('Admin')) throw new Error('denetim kaydı yok');
});

await step('Sınırlı kullanıcı yalnızca yetkili modülleri görür', async () => {
  await page.click('.account-chip');
  await page.click('button:has-text("Çıkış Yap")');
  await page.waitForSelector('.login-card');
  await login(TEST_USERNAME, 'Resepsiyon2026');
  if (await page.$('.login-card:has-text("Şifre Değiştirme Zorunlu")')) {
    const fields = page.locator('.login-card input[type="password"]');
    await fields.nth(0).fill('Resepsiyon2026');
    await fields.nth(1).fill('Resepsiyon2027');
    await fields.nth(2).fill('Resepsiyon2027');
    await page.click('.login-card button[type="submit"]');
  }
  await page.waitForSelector('.layout', { timeout: 15000 });
  const items = await page.$$eval('.nav-item', (els) => els.map((e) => e.textContent.trim()));
  console.log(`   menü: ${items.join(' · ')}`);
  if (items.length !== 2) throw new Error(`beklenen 2 modül, görülen ${items.length}`);
  if (items.some((i) => i.includes('Çalışanlar') || i.includes('Kullanıcı'))) throw new Error('yetkisiz modül görünüyor');
});

await step('Yetkisiz sayfaya adresten gidilemez', async () => {
  await page.evaluate(() => { location.hash = 'kullanicilar'; });
  await page.waitForTimeout(500);
  if (await page.$('.perm-grid')) throw new Error('yetkisiz sayfa açıldı');
  const h1 = await page.textContent('h1');
  if (h1.includes('Kullanıcı ve Yetki')) throw new Error('yetkisiz sayfa açıldı');
  console.log(`   yönlendirildi: ${h1.trim()}`);
});

await step('Yetkisiz kullanıcıya kişisel veriler maskelenir', async () => {
  const masked = await page.evaluate(async () => {
    const state = await (await fetch('/api/state', { credentials: 'same-origin' })).json();
    return state.employees?.[0] ?? null;
  });
  if (!masked) throw new Error('personel verisi dönmedi');
  if (masked.name !== '•••') throw new Error(`maskelenmedi: ${masked.name}`);
  if (masked.netSalary !== 32000) throw new Error('tutar korunmalı');
});

await step('Yetkisiz API isteği sunucuda engellenir', async () => {
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/employees', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Zorla', period: '2026-10' }),
    });
    return { status: response.status, body: await response.json() };
  });
  if (result.status !== 403) throw new Error(`beklenen 403, gelen ${result.status}`);
  console.log(`   ${result.body.error}`);
});

console.log(errors.length ? `❌ konsol hataları: ${errors.join(' | ')}` : '✅ konsol hatası yok');
await browser.close();
