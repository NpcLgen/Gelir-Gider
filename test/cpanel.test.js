/**
 * cPanel + Firebase kurulumu (statik hosting).
 *
 * Firebase REST uçları (kimlik + Realtime Database) bellek içi bir taklitle
 * karşılanır; böylece arka uç uyarlayıcısı gerçek ağa çıkmadan sınanır.
 * Ayrıca dağıtım dosyaları (veritabanı kuralları, .htaccess) doğrulanır.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, it } from 'node:test';

import { RESOURCE_KEYS, RESOURCES } from '../src/core/resources.js';
import { MODULE_KEYS } from '../src/core/permissions.js';
import { snapshotOf, validateBackup } from '../src/core/backupFormat.js';
import { exportWorkbook as browserExport, parseWorkbook as browserParse } from '../src/core/excelBrowser.js';
import { exportWorkbook as nodeExport, parseWorkbook as nodeParse } from '../server/excel.js';
import { ValidationError } from '../src/core/api.js';

const root = new URL('..', import.meta.url);
const readJson = async (name) => JSON.parse(await readFile(new URL(name, root), 'utf8'));

/* ------------------------------------------------- Realtime Database kuralları -- */

describe('database.rules.json', () => {
  let rules;
  before(async () => { rules = (await readJson('database.rules.json')).rules; });

  it('oturumsuz erişim kökte kapalıdır', () => {
    assert.equal(rules['.read'], false);
    assert.equal(rules['.write'], false);
  });

  it('okuma yalnızca etkin kullanıcıya açıktır', () => {
    assert.match(rules.data['.read'], /auth != null/);
    assert.match(rules.data['.read'], /active'\)\.val\(\) !== false/);
  });

  it('kök düzeyinde yazma yalnızca yöneticidedir', () => {
    assert.match(rules.data['.write'], /isAdmin'\)\.val\(\) === true/);
  });

  it('her koleksiyon için kural vardır ve yetki anahtarı geçerlidir', () => {
    for (const name of RESOURCE_KEYS) {
      const rule = rules.data[name];
      assert.ok(rule, `${name} için kural yok`);
      const module = RESOURCES[name].permission;
      assert.ok(MODULE_KEYS.includes(module), `${module} geçerli bir modül değil`);
      assert.match(rule['.write'], new RegExp(`permissions/${module}`),
        `${name} kuralı ${module} yetkisini kontrol etmiyor`);
      assert.match(rule.$id['.validate'], /hasChildren\(\['id'\]\)/);
    }
  });

  it('işlem kaydı yalnızca eklenebilir', () => {
    assert.equal(rules.data.auditLog['.write'], undefined);
    assert.match(rules.data.auditLog.$id['.write'], /!data\.exists\(\)/);
  });

  it('ilk kurulumda yalnızca hiç kullanıcı yokken yönetici açılabilir', () => {
    const rule = rules.data.users.$uid['.write'];
    assert.match(rule, /!root\.child\('data\/users'\)\.exists\(\)/);
    assert.match(rule, /newData\.child\('isAdmin'\)\.val\(\) === true/);
  });

  it('kullanıcı kendi şifre durumunu ve son girişini yazabilir', () => {
    assert.match(rules.data.users.$uid.lastLogin['.write'], /auth\.uid === \$uid/);
    assert.match(rules.data.users.$uid.mustChangePassword['.write'], /newData\.val\(\) === false/);
  });

  it('rezervasyon modülü kaldırıldığı için yazmaya kapalıdır', () => {
    assert.match(rules.data.reservations['.write'], /isAdmin/);
  });
});

/* --------------------------------------------------------------- .htaccess -- */

describe('.htaccess', () => {
  let text;
  before(async () => { text = await readFile(new URL('.htaccess', root), 'utf8'); });

  it('ES modülleri doğru MIME türüyle sunulur', () => {
    assert.match(text, /AddType application\/javascript \.js/);
    assert.match(text, /AddType application\/javascript \.mjs/);
  });

  it('sunucu tarafı klasörleri ve kural dosyası dışarıya kapalıdır', () => {
    assert.match(text, /\^\/\(server\|scripts\|test\|node_modules\|data\)/);
    assert.match(text, /database\.rules\.json/);
  });

  it('index.html önbelleğe alınmaz (güncelleme hemen görünür)', () => {
    assert.match(text, /no-cache/);
  });
});

/* ----------------------------------------------------------- yedek biçimi -- */

describe('yedek biçimi (iki arka uçta ortak)', () => {
  const db = { rooms: [{ id: 'r1' }], expenses: [], settings: { x: 1 }, users: [{ id: 'u1' }] };

  it('sayımları ve biçim imzasını yazar', () => {
    const payload = snapshotOf(db, { version: 5, createdBy: 'admin' });
    assert.equal(payload.format, 'otel-finans-yedek');
    assert.equal(payload.counts.rooms, 1);
    assert.equal(payload.createdBy, 'admin');
    assert.deepEqual(validateBackup(payload, 5), []);
  });

  it('kur defterini de yedekler', () => {
    const payload = snapshotOf({ ...db, exchangeRates: [{ id: 'k1' }] }, { version: 5 });
    assert.equal(payload.counts.exchangeRates, 1);
  });

  it('yabancı dosyayı ve ileri sürümü reddeder', () => {
    assert.match(validateBackup({ format: 'baska' }, 5).join(' '), /sistem yedeği değil/);
    assert.match(validateBackup(snapshotOf(db, { version: 9 }), 5).join(' '), /daha yeni bir sürümden/);
  });

  it('kullanıcısız yedeği uyarır', () => {
    const payload = snapshotOf({ ...db, users: [] }, { version: 5 });
    assert.match(validateBackup(payload, 5).join(' '), /hiç kullanıcı yok/);
  });
});

/* ------------------------------------------------- Excel: tarayıcı ↔ sunucu -- */

describe('Excel katmanı iki yönde uyumludur', () => {
  const sheets = [{ name: 'Test', rows: [['Tarih', 'Tutar'], ['2026-10-01', 125.5]] }];

  it('tarayıcıda yazılan dosya sunucuda okunur', () => {
    const bytes = browserExport(sheets);
    const parsed = nodeParse(Buffer.from(bytes));
    assert.deepEqual(parsed.rows[0], ['Tarih', 'Tutar']);
    assert.equal(parsed.rows[1][0], '2026-10-01');
  });

  it('sunucuda yazılan dosya tarayıcıda okunur', async () => {
    const parsed = await browserParse(nodeExport(sheets));
    assert.deepEqual(parsed.rows[0], ['Tarih', 'Tutar']);
    assert.equal(parsed.rows[1][1], '125.5');
  });
});

/* ------------------------------------------------- Firebase REST taklidi -- */

const API_KEY = 'test-key';
const DB_URL = 'https://ornek-rtdb.firebaseio.com';

/** Bellek içi Realtime Database + kimlik servisi. */
function createFakeFirebase() {
  const tree = {};
  const accounts = new Map();   // email -> { localId, password }
  let counter = 0;

  const segments = (path) => path.split('/').filter(Boolean);
  const nodeAt = (path, create = false) => {
    let node = tree;
    for (const key of segments(path)) {
      if (node[key] === undefined || node[key] === null) {
        if (!create) return undefined;
        node[key] = {};
      }
      node = node[key];
    }
    return node;
  };
  const setAt = (path, value) => {
    const parts = segments(path);
    const last = parts.pop();
    let node = tree;
    for (const key of parts) {
      if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
      node = node[key];
    }
    if (value === null) delete node[last];
    else node[last] = value;
  };

  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });

  const fetchImpl = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    const body = options.body ? JSON.parse(options.body) : {};

    if (url.hostname === 'identitytoolkit.googleapis.com') {
      const action = url.pathname.split(':')[1];
      if (action === 'signInWithPassword') {
        const account = accounts.get(body.email);
        if (!account || account.password !== body.password) {
          return json({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, 400);
        }
        return json({ localId: account.localId, idToken: `tok-${account.localId}`, refreshToken: 'ref', expiresIn: '3600' });
      }
      if (action === 'signUp') {
        if (accounts.get(body.email)) return json({ error: { message: 'EMAIL_EXISTS' } }, 400);
        counter += 1;
        const localId = `uid${counter}`;
        accounts.set(body.email, { localId, password: body.password });
        return json({ localId, idToken: `tok-${localId}`, refreshToken: 'ref', expiresIn: '3600' });
      }
      if (action === 'update') {
        const entry = [...accounts.entries()].find(([, a]) => `tok-${a.localId}` === body.idToken);
        if (entry) entry[1].password = body.password;
        return json({ idToken: body.idToken, refreshToken: 'ref', expiresIn: '3600' });
      }
      return json({ error: { message: 'UNKNOWN' } }, 400);
    }

    if (url.origin === DB_URL) {
      if (!url.searchParams.get('auth')) return json({ error: 'Permission denied' }, 401);
      const path = url.pathname.replace(/\.json$/, '');
      const method = options.method ?? 'GET';
      if (method === 'GET') return json(nodeAt(path) ?? null);
      if (method === 'PUT') { setAt(path, body); return json(body); }
      if (method === 'PATCH') {
        for (const [key, value] of Object.entries(body)) setAt(`${path}/${key}`, value);
        return json(body);
      }
      if (method === 'DELETE') { setAt(path, null); return json(null); }
    }

    throw new Error(`Taklit edilmeyen istek: ${url.href}`);
  };

  return {
    fetch: fetchImpl,
    tree,
    addAccount(email, password) {
      counter += 1;
      const localId = `uid${counter}`;
      accounts.set(email, { localId, password });
      return localId;
    },
    seedUser(record) { setAt(`data/users/${record.id}`, record); },
    read: (path) => nodeAt(path),
  };
}

function installBrowserGlobals() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  const noop = () => {};
  globalThis.document = {
    createElement: () => ({ click: noop, remove: noop, set href(v) { this._href = v; }, set download(v) { this._download = v; } }),
    body: { appendChild: noop },
  };
  return store;
}

describe('Firebase arka ucu', () => {
  const originalFetch = globalThis.fetch;
  let fake;
  let api;
  let createFirebaseApi;

  before(async () => {
    installBrowserGlobals();
    ({ createFirebaseApi } = await import('../src/core/backend/firebase.js'));
  });

  after(() => { globalThis.fetch = originalFetch; });

  beforeEach(() => {
    localStorage.clear();
    fake = createFakeFirebase();
    globalThis.fetch = fake.fetch;
    api = createFirebaseApi({ apiKey: API_KEY, databaseURL: DB_URL, loginDomain: 'otel.local' });
  });

  const loginAs = (username, password = 'sifre123') => api.post('/api/auth/login', { username, password });

  it('eksik yapılandırmayı reddeder', () => {
    assert.throws(() => createFirebaseApi({ apiKey: '' }), /yapılandırması eksik/);
  });

  it('kullanıcı adını e-postaya çevirerek giriş yapar', async () => {
    const uid = fake.addAccount('mehmet@otel.local', 'sifre123');
    fake.seedUser({ id: uid, username: 'mehmet', isAdmin: false, active: true, permissions: { genelHarcamalar: true } });

    const { user } = await loginAs('mehmet');
    assert.equal(user.username, 'mehmet');
    assert.equal(user.permissions.genelHarcamalar, true);
    assert.equal(user.permissions.ayarlar, false);
    assert.ok(fake.read(`data/users/${uid}`).lastLogin, 'son giriş zamanı yazılmalı');
  });

  it('hatalı şifrede Türkçe hata verir', async () => {
    fake.addAccount('mehmet@otel.local', 'sifre123');
    await assert.rejects(loginAs('mehmet', 'yanlis'), /Kullanıcı adı veya şifre hatalı/);
  });

  it('ilk girişte hiç kullanıcı yoksa yönetici olarak tanımlar', async () => {
    const uid = fake.addAccount('admin@otel.local', 'sifre123');
    const { user } = await loginAs('admin');
    assert.equal(user.isAdmin, true);
    assert.equal(fake.read(`data/users/${uid}`).isAdmin, true);
  });

  it('kullanıcı kaydı yoksa ve sistem doluysa girişi engeller', async () => {
    const owner = fake.addAccount('admin@otel.local', 'sifre123');
    fake.seedUser({ id: owner, username: 'admin', isAdmin: true, active: true });
    fake.addAccount('yabanci@otel.local', 'sifre123');
    await assert.rejects(loginAs('yabanci'), /sistemde tanımlı değil/);
  });

  it('devre dışı hesabı içeri almaz', async () => {
    const uid = fake.addAccount('eski@otel.local', 'sifre123');
    fake.seedUser({ id: uid, username: 'eski', isAdmin: false, active: false, permissions: {} });
    await assert.rejects(loginAs('eski'), /devre dışı/);
  });

  it('oturum olmadan durum sorgusu 401 verir', async () => {
    await assert.rejects(api.get('/api/state'), /Oturum bulunamadı/);
  });

  describe('oturum açılmış yönetici', () => {
    beforeEach(async () => {
      const uid = fake.addAccount('admin@otel.local', 'sifre123');
      fake.seedUser({ id: uid, username: 'admin', displayName: 'Yönetici', isAdmin: true, active: true });
      await loginAs('admin');
    });

    it('durum yanıtı modülleri ve kullanıcıyı taşır', async () => {
      const state = await api.get('/api/state');
      assert.equal(state.me.username, 'admin');
      assert.ok(state.modules.length >= 20);
      assert.deepEqual(state.expenses, []);
      assert.equal(state.users.length, 1);
    });

    it('gider kaydeder, sıralar ve işlem kaydı tutar', async () => {
      await api.post('/api/expenses', {
        date: '2026-09-01', category: 'utility_electricity', description: 'Eylül elektrik', amount: 1000,
      });
      await api.post('/api/expenses', {
        date: '2026-10-01', category: 'utility_electricity', description: 'Ekim elektrik', amount: 1200,
      });

      const state = await api.get('/api/state');
      assert.deepEqual(state.expenses.map((e) => e.date), ['2026-10-01', '2026-09-01']);
      const log = Object.values(fake.read('data/auditLog') ?? {});
      assert.ok(log.some((row) => /Ekim elektrik/.test(row.summary)));
      assert.ok(log.every((row) => row.at && row.username));
    });

    it('geçersiz kaydı doğrulama hatasıyla reddeder', async () => {
      await assert.rejects(
        api.post('/api/expenses', { date: '2026-10-01', description: '', amount: -5 }),
        (err) => err instanceof ValidationError,
      );
      assert.equal(fake.read('data/expenses'), undefined);
    });

    it('kaydı siler', async () => {
      const room = await api.post('/api/rooms', {
        number: '101', name: 'Deniz', beds: [{ type: 'double', count: 1 }], maxOccupancy: 2,
      });
      assert.ok(fake.read(`data/rooms/${room.id}`));
      await api.del(`/api/rooms/${room.id}`);
      assert.equal(fake.read(`data/rooms/${room.id}`), undefined);
    });

    it('ayarları günceller', async () => {
      await api.put('/api/settings', { displayCurrency: 'EUR' });
      assert.equal(fake.read('data/settings').displayCurrency, 'EUR');
    });

    it('dönem başında fatura kalemlerini açar', async () => {
      await api.put('/api/settings', {
        bills: [{ key: 'elektrik', label: 'Elektrik', category: 'utility_electricity', allocation: 'general', active: true }],
      });
      const result = await api.post('/api/periods/2026-10/bills');
      assert.equal(result.created, 1);
      const again = await api.post('/api/periods/2026-10/bills');
      assert.equal(again.created, 0, 'aynı dönem ikinci kez açılmaz');
    });

    it('kuru olmayan döviz faturası tarihlerini bildirir', async () => {
      await api.post('/api/exchangeRates', { date: '2026-10-02', currency: 'EUR', rate: 38, kind: 'manuel' });
      await api.post('/api/salesInvoices', {
        customer: 'Acme', date: '2026-10-02', invoiceNo: 'A-1', amount: 195, currency: 'EUR', grossAmount: 195,
      });
      const missing = await api.get('/api/fx/missing', { currency: 'EUR' });
      assert.deepEqual(missing.dates, []);

      const sealed = (await api.get('/api/state')).salesInvoices[0];
      assert.equal(sealed.fxRate, 38);
      assert.equal(sealed.fxRateDate, '2026-10-02');
    });

    it('yedekleme ekranı Firebase bilgisini döndürür', async () => {
      const info = await api.get('/api/backups');
      assert.equal(info.mode, 'firebase');
      assert.deepEqual(info.backups, []);
      assert.equal(info.settings.intervalHours, 24);
      await assert.rejects(api.post('/api/backups', {}), /sunucu klasörü yoktur/);
    });

    it('yedeği önce denetler, sonra geri yükler', async () => {
      const payload = snapshotOf({
        rooms: [{ id: 'r9', number: '901', name: 'Yedek', maxOccupancy: 2, beds: [], amenities: [] }],
        expenses: [], settings: { displayCurrency: 'TRY' }, users: [{ id: 'u1', username: 'admin' }],
      }, { version: 5, createdBy: 'admin' });

      const check = await api.post('/api/backups/restore', { payload, dryRun: true });
      assert.equal(check.valid, true);
      assert.equal(check.counts.rooms, 1);

      await api.post('/api/backups/restore', { payload, keepUsers: true });
      assert.equal(fake.read('data/rooms/r9').number, '901');
    });

    it('Excel şablonunu tarayıcıda üretir', async () => {
      const name = await api.download('/api/excel/template', { kind: 'gelenFatura' });
      assert.equal(name, 'ornek-sablon-gelenFatura.xlsx');
    });

    it('Excel içe aktarımında mükerrer faturayı tekrar işlemez', async () => {
      const rows = [
        ['Müşteri', 'Fatura Tarihi', 'Fatura No', 'Tutar', 'Para Birimi',
          'Vergiler Hariç Toplam Tutar', 'Vergiler Dahil Toplam Tutar'],
        ['MERAM ELEKTRİK', '2026-10-02', 'MRM2026000116826', 39596.06, 'TRY', 32997.04, 39596.06],
      ];
      const file = browserExport([{ name: 'Gelen Faturalar', rows }]);

      const first = await api.postRaw('/api/excel/import', file, { kind: 'gelenFatura' });
      assert.equal(first.imported, 1);
      assert.equal(first.skippedCount, 0);

      const second = await api.postRaw('/api/excel/import', file, { kind: 'gelenFatura' });
      assert.equal(second.imported, 0);
      assert.equal(second.skippedCount, 1);
      assert.equal(Object.keys(fake.read('data/purchaseInvoices')).length, 1);
    });

    it('kullanıcı açar ve yetkilerini saklar', async () => {
      const created = await api.post('/api/users', {
        username: 'resepsiyon', password: 'sifre123', displayName: 'Resepsiyon',
        permissions: { gelirler: true },
      });
      assert.equal(created.mustChangePassword, true);
      assert.equal(created.permissions.gelirler, true);
      assert.equal(created.permissions.ayarlar, false);
      // Yeni hesap açmak yöneticinin oturumunu düşürmez.
      assert.equal((await api.get('/api/auth/me')).user.username, 'admin');
    });

    it('kullanıcı silmek erişimi kapatır', async () => {
      const created = await api.post('/api/users', { username: 'gecici', password: 'sifre123' });
      await api.del(`/api/users/${created.id}`);
      assert.equal(fake.read(`data/users/${created.id}`).active, false);
    });

    it('çıkışta oturum silinir', async () => {
      await api.post('/api/auth/logout');
      assert.equal(localStorage.getItem('otel:firebase-oturum'), null);
      await assert.rejects(api.get('/api/state'), /Oturum bulunamadı/);
    });
  });

  describe('yetkisiz kullanıcı', () => {
    beforeEach(async () => {
      const admin = fake.addAccount('admin@otel.local', 'sifre123');
      fake.seedUser({ id: admin, username: 'admin', isAdmin: true, active: true });
      const uid = fake.addAccount('resepsiyon@otel.local', 'sifre123');
      fake.seedUser({
        id: uid, username: 'resepsiyon', isAdmin: false, active: true,
        permissions: { gelirler: true },
      });
      await loginAs('resepsiyon');
    });

    it('yetkisi olmayan modüle yazamaz', async () => {
      await assert.rejects(
        api.post('/api/expenses', { date: '2026-10-01', category: 'other', description: 'Deneme', amount: 10 }),
        /genelHarcamalar.*yetkiniz bulunmuyor/,
      );
    });

    it('yetkili olduğu modüle yazabilir', async () => {
      const invoice = await api.post('/api/salesInvoices', {
        customer: 'Acme', date: '2026-10-02', invoiceNo: 'B-1', amount: 1000, currency: 'TRY', grossAmount: 1000,
      });
      assert.ok(fake.read(`data/salesInvoices/${invoice.id}`));
    });

    it('kullanıcı listesini ve işlem kaydını görmez', async () => {
      const state = await api.get('/api/state');
      assert.deepEqual(state.users, []);
      assert.deepEqual(state.auditLog, []);
    });

    it('kullanıcı yönetimi ve yedekleme yönetici işidir', async () => {
      await assert.rejects(api.post('/api/users', { username: 'x', password: 'sifre123' }), /yalnızca yöneticiye/);
      await assert.rejects(api.get('/api/backups'), /yalnızca yöneticiye/);
    });
  });
});

/* ------------------------------------------------------- yapılandırma ---- */

describe('src/app-config.js', () => {
  it('Firebase bilgileri eksiksizdir', async () => {
    const { APP_CONFIG } = await import('../src/app-config.js');
    assert.equal(APP_CONFIG.backend, 'auto');
    for (const key of ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId', 'loginDomain']) {
      assert.ok(APP_CONFIG.firebase[key], `${key} boş olmamalı`);
    }
    assert.match(APP_CONFIG.firebase.databaseURL, /^https:\/\/.+firebaseio\.com\/?$/);
  });
});
