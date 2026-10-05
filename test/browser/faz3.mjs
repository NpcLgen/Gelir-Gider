/**
 * Faz 3.0 kabul kriterleri (PRD III §5).
 *
 *   npm start
 *   npm run test:browser:faz3
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { makeGo, openLogin } from './nav.mjs';
import { exportWorkbook } from '../../server/excel.js';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const USER = process.env.TEST_USER || 'Admin';
const PASS = process.env.TEST_PASS || 'Admin2026';
const CHANGED = process.env.TEST_PASS2 || 'Otel2026Guvenli';

const workDir = mkdtempSync(join(tmpdir(), 'otel-faz3-'));

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
/** Metindeki ilk para tutarını sayıya çevirir ("₺436.269,09 · 2 fatura" → 436269.09). */
const money = (text) => {
  const match = String(text).match(/-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:,\d+)?/);
  return match ? Number(match[0].replace(/\./g, '').replace(',', '.')) : NaN;
};

const today = new Date();
const ay = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
const gun = (d) => `${ay}-${String(d).padStart(2, '0')}`;

/* --------------------------------------- §3 Karşılama sayfası ---------- */

await page.goto(BASE, { waitUntil: 'load' });

await step('§3 Adres kökünde karşılama sayfası açılıyor', async () => {
  await page.waitForSelector('.landing');
  if (await page.$('.login-card')) throw new Error('doğrudan giriş paneli geldi');
  const baslik = await page.textContent('.landing-hero h1');
  if (baslik.trim() !== 'Butik Otel Gelir Gider Sistemi') throw new Error(baslik);
  if (!(await page.$('.landing-mockup svg'))) throw new Error('hero görseli yok');
  const ozellikler = await page.$$eval('.landing-feature h3', (els) => els.map((e) => e.textContent.trim()));
  if (ozellikler.length < 3) throw new Error(`fayda sayısı: ${ozellikler.length}`);
  console.log(`   faydalar: ${ozellikler.join(' · ')}`);
});

await step('§3 Footer iletişim, destek ve telif bilgisi taşıyor', async () => {
  const footer = (await page.textContent('.landing-footer')).replace(/\s+/g, ' ');
  for (const beklenen of ['İletişim', 'Destek', '@', '+90']) {
    if (!footer.includes(beklenen)) throw new Error(`${beklenen} yok: ${footer.slice(0, 160)}`);
  }
  const telif = await page.textContent('.landing-copyright');
  if (!/©/.test(telif) || !/Tüm hakları saklıdır/.test(telif)) throw new Error(telif);
});

await step('§3 "Giriş Yap" düğmeleri giriş ekranına götürüyor', async () => {
  const ust = await page.$('.landing-login-top');
  const orta = await page.$('.landing-login-hero');
  if (!ust || !orta) throw new Error('sağ üst veya orta CTA yok');
  await orta.click();
  await page.waitForSelector('.login-card', { timeout: 10000 });
  if (!page.url().includes('#giris')) throw new Error(`adres: ${page.url()}`);
});

/* ------------------------------------------------------------ giriş ---- */

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

/* --------------------------------------------- §2 Menü mimarisi -------- */

await step('§2 "Gelir - Gider" kategorisi var, "Gelirler" altında', async () => {
  const gruplar = await page.$$eval('.nav-group', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  if (!gruplar.some((g) => g.includes('Gelir - Gider'))) throw new Error(gruplar.join(' | '));
  if (gruplar.some((g) => /^.?Gelirler/.test(g))) throw new Error('"Gelirler" hâlâ ayrı ana başlık');

  await page.locator('.nav-group').filter({ hasText: 'Gelir - Gider' }).first().click();
  await page.waitForTimeout(250);
  const altlar = await page.$$eval('.nav-sub .nav-item', (els) => els.map((e) => e.textContent.trim()));
  for (const beklenen of ['Gelirler', 'Giderler', 'Gider Faturaları', 'İşlenen Faturalar']) {
    if (!altlar.some((a) => a.includes(beklenen))) throw new Error(`${beklenen} yok: ${altlar.join(' · ')}`);
  }
  console.log(`   alt sekmeler: ${altlar.join(' · ')}`);
});

await step('§2 Rezervasyonlar modülü sistemden kaldırıldı', async () => {
  const gruplar = await page.locator('.nav-group').count();
  const items = new Set(await page.$$eval('.nav-sub .nav-item', (els) => els.map((e) => e.textContent.trim())));
  for (let i = 0; i < gruplar; i += 1) {
    const grup = page.locator('.nav-group').nth(i);
    if ((await grup.getAttribute('aria-expanded')) === 'true') continue;
    await grup.click();
    await page.waitForTimeout(150);
    for (const item of await page.$$eval('.nav-sub .nav-item', (els) => els.map((e) => e.textContent.trim()))) {
      items.add(item);
    }
  }
  if ([...items].some((i) => i.includes('Rezervasyon'))) throw new Error('menüde duruyor');

  const status = await page.evaluate(async () => {
    const r = await fetch('/api/reservations', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: '{}',
    });
    return r.status;
  });
  if (status !== 404) throw new Error(`API ucu açık: ${status}`);

  const moduller = await page.evaluate(async () => {
    const r = await fetch('/api/state', { credentials: 'same-origin' });
    return (await r.json()).modules.map((m) => m.key);
  });
  if (moduller.includes('rezervasyonlar')) throw new Error('modül listesinde duruyor');
});

await step('§2 Giderler sayfası grafiksiz sade tabloya indi', async () => {
  await go('Giderler');
  await page.waitForSelector('.card:has-text("Tüm Gider Kalemleri")');
  if (await page.$('.donut')) throw new Error('halka grafik duruyor');
  if (await page.$('.legend')) throw new Error('grafik açıklaması duruyor');
  if (await page.$('.kpi-grid')) throw new Error('gösterge paneli duruyor');
  const sutunlar = await page.$$eval('.table-card th', (els) => els.map((e) => e.textContent.trim()));
  if (!sutunlar.includes('Tutar')) throw new Error(sutunlar.join(' · '));
  console.log(`   sütunlar: ${sutunlar.join(' · ')}`);
});

/* ------------------------------------- §1 Excel aktarımı ve işlenenler -- */

const PORTAL_HEADER = [
  'Fatura Senaryo', 'Müşteri', 'Fatura Tarihi', 'Fatura No', 'Tutar', 'Para Birimi',
  'Vergiler Hariç Toplam Tutar', 'Vergiler Dahil Toplam Tutar',
];
const portalRow = ({ customer, date, no, net, gross }) =>
  ['Temel', customer, date, no, gross, 'TRY', net, gross];
const portalFile = (name, rows) => {
  const path = join(workDir, name);
  writeFileSync(path, exportWorkbook([{ name: 'Faturalar', rows: [PORTAL_HEADER, ...rows] }]));
  return path;
};

const GIDEN = portalFile('giden.xlsx', [
  portalRow({ customer: 'Faz3 Gelir A.Ş.', date: gun(6), no: 'FZ3-GEL-1', net: 9000, gross: 10000 }),
  portalRow({ customer: 'Faz3 Gelir Ltd.', date: gun(7), no: 'FZ3-GEL-2', net: 4500, gross: 5000 }),
]);
const GELEN = portalFile('gelen.xlsx', [
  portalRow({ customer: 'Faz3 Gider A.Ş.', date: gun(6), no: 'FZ3-GID-1', net: 8000, gross: 9600 }),
]);
const BOZUK = (() => {
  const path = join(workDir, 'bozuk.xlsx');
  writeFileSync(path, exportWorkbook([{
    name: 'Faturalar',
    rows: [PORTAL_HEADER, portalRow({ customer: '', date: gun(8), no: '', net: 0, gross: 0 })],
  }]));
  return path;
})();

await step('§1 Excel’den yüklenen faturalar taslak beklemeden işleniyor', async () => {
  await go('Gelirler');
  await clearToast();
  await page.setInputFiles('input.invoice-import', GIDEN);
  await waitToast('2 yeni fatura aktarıldı');
  const tablo = await page.textContent('.table-card');
  if (!tablo.includes('FZ3-GEL-1')) throw new Error('kayıt listeye girmedi');

  await go('Gider Faturaları');
  await clearToast();
  await page.setInputFiles('input.invoice-import', GELEN);
  await waitToast('1 yeni fatura aktarıldı');
});

await step('§1 Hatalı satır, satır numarasıyla bildiriliyor', async () => {
  await go('Gelirler');
  await clearToast();
  await page.setInputFiles('input.invoice-dry', BOZUK);
  await page.waitForSelector('.table-card:has-text("Reddedilen satırlar")');
  const satir = await page.$$eval('.table-card:has-text("Reddedilen satırlar") tbody tr td:first-child',
    (els) => els.map((e) => e.textContent.trim()));
  if (satir[0] !== '2') throw new Error(`satır numarası "${satir[0]}", beklenen "2"`);
  const hata = (await page.textContent('.table-card:has-text("Reddedilen satırlar")')).replace(/\s+/g, ' ');
  if (!hata.includes('Müşteri adı')) throw new Error(hata.slice(0, 140));
  console.log(`   satır ${satir[0]} · ${hata.split('Satır')[1]?.slice(0, 90)}`);
});

await step('§1 "İşlenen Faturalar" sekmesi aktarılanları listeliyor', async () => {
  await go('İşlenen Faturalar');
  await page.waitForSelector('h1:has-text("İşlenen Faturalar")');
  const tablo = (await page.textContent('.table-card')).replace(/\s+/g, ' ');
  for (const no of ['FZ3-GEL-1', 'FZ3-GEL-2', 'FZ3-GID-1']) {
    if (!tablo.includes(no)) throw new Error(`${no} listede yok`);
  }
  if (!tablo.includes('Gelir') || !tablo.includes('Gider')) throw new Error('yön sütunu yok');
  const adet = (await page.textContent('.kpi:has-text("İşlenen Fatura") strong')).trim();
  if (adet !== '3') throw new Error(`işlenen fatura sayısı "${adet}", beklenen "3"`);
  console.log(`   ${adet} fatura · ${(await page.textContent('.kpi:has-text("İşlenen Fatura")')).replace(/\s+/g, ' ').trim()}`);
});

await step('§1 İşlenen faturalar yön ve yüklemeye göre süzülüyor', async () => {
  await page.selectOption('select.processed-direction', 'gider');
  await page.waitForTimeout(400);
  const satirlar = await page.$$eval('.table-card tbody tr', (els) => els.length);
  if (satirlar !== 1) throw new Error(`gider süzgeci ${satirlar} satır döndürdü`);
  await page.selectOption('select.processed-direction', 'hepsi');
  await page.waitForTimeout(400);
});

/* ------------------------------------- §4 Dashboard ve vergi algoritması */

await step('§4 Dashboard dokuz göstergeyi sırayla gösteriyor', async () => {
  await go('Dashboard');
  await page.waitForSelector('.kpi-grid');
  const kartlar = await page.$$eval('.kpi .muted.small:first-child', (els) => els.map((e) => e.textContent.trim()));
  const beklenen = [
    'Otel Geliri', 'Restoran Geliri', 'Toplam Giderler', 'Gelir KDV’si (Otel + Restoran)',
    'Gider KDV Toplamı', 'Turizm Payı', 'Konaklama Vergisi', 'Gelir Vergisi', 'NET KÂR',
  ];
  for (const [i, ad] of beklenen.entries()) {
    if (kartlar[i] !== ad) throw new Error(`${i + 1}. kart "${kartlar[i]}", beklenen "${ad}"`);
  }
  console.log(`   ${kartlar.join(' · ')}`);
});

await step('§4 Turizm payı ve konaklama vergisi yalnızca otel gelirinden', async () => {
  const otel = money(await page.textContent('.kpi:has-text("Otel Geliri") strong'));
  const otelHaric = money((await page.textContent('.kpi:has-text("Otel Geliri")')).split('KDV hariç')[1]);
  const turizm = money(await page.textContent('.kpi:has-text("Turizm Payı") strong'));
  const konaklama = money(await page.textContent('.kpi:has-text("Konaklama Vergisi") strong'));

  const beklenenTurizm = Math.round(otelHaric * 0.0075 * 100) / 100;
  const beklenenKonaklama = Math.round(otelHaric * 0.02 * 100) / 100;
  if (Math.abs(turizm - beklenenTurizm) > 1) throw new Error(`turizm payı ${turizm}, beklenen ${beklenenTurizm}`);
  if (Math.abs(konaklama - beklenenKonaklama) > 1) throw new Error(`konaklama vergisi ${konaklama}, beklenen ${beklenenKonaklama}`);
  console.log(`   otel ${otel} (KDV hariç ${otelHaric}) · turizm ${turizm} · konaklama ${konaklama}`);

  // Restoran geliri eklenince bu iki kalem değişmemeli.
  const oncekiTurizm = turizm;
  await go('Restoran Gelirleri');
  await page.click('button:has-text("Gün Sonu Ekle")');
  await page.waitForSelector('.modal input.income-amount');
  await page.fill('.modal input[type="date"]', gun(9));
  await page.fill('.modal input.income-amount', '50000');
  await clearToast();
  await page.click('.modal button:has-text("Kaydet")');
  await waitToast('Gün sonu kaydedildi');

  await go('Dashboard');
  await page.waitForSelector('.kpi-grid');
  const restoran = money(await page.textContent('.kpi:has-text("Restoran Geliri") strong'));
  if (restoran < 50000) throw new Error(`restoran geliri yansımadı: ${restoran}`);
  const sonrakiTurizm = money(await page.textContent('.kpi:has-text("Turizm Payı") strong'));
  if (Math.abs(sonrakiTurizm - oncekiTurizm) > 0.01) {
    throw new Error(`restoran geliri turizm payını değiştirdi: ${oncekiTurizm} → ${sonrakiTurizm}`);
  }
});

await step('§4 Gider KDV’si fatura dahil − hariç farkından süzülüyor', async () => {
  const giderKdv = money(await page.textContent('.kpi:has-text("Gider KDV Toplamı") strong'));
  // Yüklenen gider faturası: 9.600 − 8.000 = 1.600
  if (giderKdv < 1600) throw new Error(`gider KDV'si ${giderKdv}, en az 1.600 beklenir`);
  console.log(`   gider KDV toplamı ${giderKdv}`);
});

await step('§4 Gelir vergisi dört adımlı algoritmayla hesaplanıyor', async () => {
  const kart = await page.$('.card:has-text("Gelir Vergisi Hesabı")');
  if (!kart) throw new Error('vergi hesabı kartı yok');
  const metin = (await kart.textContent()).replace(/\s+/g, ' ');
  for (const bolum of ['1 · Toplam Gelir', '2 · Toplam İndirimler', '3 · Vergi Matrahı', '4 · Gelir Vergisi', 'NET KÂR']) {
    if (!metin.includes(bolum)) throw new Error(`${bolum} yok`);
  }
  for (const kalem of ['Sigortalı çalışan maaşları', 'Gider KDV toplamı', 'Konaklama vergisi', 'Turizm payı']) {
    if (!metin.includes(kalem)) throw new Error(`indirim kalemi yok: ${kalem}`);
  }

  // Matrah = toplam gelir − toplam indirimler, vergi = matrah × oran.
  const değerler = await page.$$eval('.card:has-text("Gelir Vergisi Hesabı") .kv', (els) => els.map((e) => ({
    label: e.querySelector('span')?.textContent.trim() ?? '',
    value: e.querySelector('strong')?.textContent.trim() ?? '',
  })));
  const bul = (parca) => değerler.find((d) => d.label.includes(parca));
  const matrah = money(bul('3 · Vergi Matrahı').value);
  const vergi = money(bul('4 · Gelir Vergisi').value);
  const netKar = money(bul('NET KÂR').value);
  const beklenenVergi = Math.round(Math.max(0, matrah) * 0.25 * 100) / 100;
  if (Math.abs(vergi - beklenenVergi) > 1) throw new Error(`vergi ${vergi}, beklenen ${beklenenVergi}`);
  if (Math.abs(netKar - (matrah - vergi)) > 1) throw new Error(`net kâr ${netKar}, beklenen ${matrah - vergi}`);
  console.log(`   matrah ${matrah} · vergi ${vergi} · net kâr ${netKar}`);
});

console.log(errors.length ? `❌ JS hatası: ${errors.slice(0, 3).join(' | ')}` : '✅ JS hatası yok');
if (errors.length) process.exitCode = 1;
await browser.close();
rmSync(workDir, { recursive: true, force: true });
