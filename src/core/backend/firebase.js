/**
 * Firebase arka ucu — cPanel gibi yalnızca statik dosya sunan ortamlar için.
 *
 * Node sunucusu olmadan çalışır: kimlik doğrulama Firebase Authentication,
 * veri Firebase Realtime Database üzerinden REST ile yürütülür. Hiçbir paket
 * kurulumu veya derleme adımı gerekmez; dosyaları `public_html` içine kopyalamak
 * yeterlidir.
 *
 * `/api/...` protokolünü birebir taklit eder; böylece `store.js` ve tüm
 * görünümler iki arka uçta da değişmeden çalışır.
 *
 * Güvenlik: tarayıcıdaki doğrulama kullanıcı deneyimi içindir. Asıl koruma
 * `database.rules.json` dosyasındaki Realtime Database kurallarıdır.
 */

import { ApiError, ValidationError, downloadBlob, notifyUnauthorized } from '../api.js';
import { RESOURCES } from '../resources.js';
import { allPermissions, can, MODULES, normalizePermissions } from '../permissions.js';
import { defaultSettings, createPriceEntry, validatePriceEntry, validateSettings } from '../model.js';
import { defaultTaxRates } from '../finance.js';
import { createExchangeRate, missingRateDates } from '../rates.js';
import { planImport } from '../importPlan.js';
import { snapshotOf, validateBackup } from '../backupFormat.js';
import { buildTemplate, exportWorkbook, parseWorkbook } from '../excelBrowser.js';

const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';
const SECURE_TOKEN = 'https://securetoken.googleapis.com/v1/token';
const SESSION_KEY = 'otel:firebase-oturum';
/** Yedek dosyası sürümü — Node sunucusundaki SCHEMA_VERSION ile aynı. */
const SCHEMA_VERSION = 5;
const BACKUP_DEFAULTS = { autoEnabled: true, intervalHours: 24, keep: 20 };

/** Dizi tutan koleksiyonlar (RTDB'de nesne olarak saklanır). */
const COLLECTIONS = [
  'rooms', 'reservations', 'expenses', 'employees', 'extraWorkers', 'suppliers',
  'supplierTxns', 'cashDays', 'restaurantIncomes', 'restaurantExpenses',
  'foreignWorkers', 'purchaseInvoices', 'salesInvoices', 'exchangeRates',
];

const nowIso = () => new Date().toISOString();
const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

/** RTDB nesnesini diziye çevirir (anahtar sırası garanti değildir, sort uygulanır). */
const toArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : Object.values(value ?? {}));

/**
 * @param {{apiKey: string, databaseURL: string, loginDomain?: string}} config
 */
export function createFirebaseApi(config) {
  const { apiKey, databaseURL } = config;
  const loginDomain = config.loginDomain || 'otel.local';
  if (!apiKey || !databaseURL) throw new Error('Firebase yapılandırması eksik (apiKey / databaseURL).');

  const dbUrl = databaseURL.replace(/\/+$/, '');

  /* ----------------------------------------------------------- oturum -- */

  let session = null;
  try {
    session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
  } catch { session = null; }

  const persist = () => {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch { /* gizli sekmede sorun değil */ }
  };

  /** Kimlik servisine istek atar; hata mesajlarını Türkçeleştirir. */
  async function identity(action, payload) {
    const response = await fetch(`${IDENTITY}:${action}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    const code = data?.error?.message ?? '';
    const turkish = {
      EMAIL_NOT_FOUND: 'Kullanıcı adı veya şifre hatalı.',
      INVALID_PASSWORD: 'Kullanıcı adı veya şifre hatalı.',
      INVALID_LOGIN_CREDENTIALS: 'Kullanıcı adı veya şifre hatalı.',
      USER_DISABLED: 'Bu hesap devre dışı bırakılmış.',
      EMAIL_EXISTS: 'Bu kullanıcı adı zaten kayıtlı.',
      WEAK_PASSWORD: 'Şifre en az 6 karakter olmalıdır.',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Çok fazla deneme yapıldı; bir süre sonra tekrar deneyin.',
      CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'Güvenlik için tekrar giriş yapmanız gerekiyor.',
    }[code.split(' : ')[0]] ?? `Kimlik doğrulama hatası (${code || response.status}).`;
    throw new ApiError(response.status === 400 ? 401 : response.status, turkish);
  }

  /** Süresi dolmuşsa jetonu yeniler. */
  async function freshToken() {
    if (!session) return null;
    if (Date.now() < session.expiresAt - 60_000) return session.idToken;
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken });
    const response = await fetch(`${SECURE_TOKEN}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) { session = null; persist(); return null; }
    const data = await response.json();
    session = {
      ...session,
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    };
    persist();
    return session.idToken;
  }

  /* --------------------------------------------------- veritabanı GET -- */

  async function rtdb(method, path, body) {
    const token = await freshToken();
    if (!token) {
      notifyUnauthorized();
      throw new ApiError(401, 'Oturum bulunamadı.');
    }
    const url = `${dbUrl}/${path}.json?auth=${encodeURIComponent(token)}`;
    const options = { method, headers: {} };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
      options.headers['content-type'] = 'application/json';
    }
    const response = await fetch(url, options);
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(403, 'Bu işlem için yetkiniz bulunmuyor.');
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ApiError(response.status, `Veritabanı hatası (${response.status}). ${detail.slice(0, 160)}`);
    }
    return response.json().catch(() => null);
  }

  const readPath = (path) => rtdb('GET', path);
  const writePath = (path, value) => rtdb('PUT', path, value);
  const patchPath = (path, value) => rtdb('PATCH', path, value);
  const removePath = (path) => rtdb('DELETE', path);

  /* ------------------------------------------------------------ durum -- */

  /** Tüm veriyi tek okumada alır ve istemci durumuna çevirir. */
  async function loadDb() {
    const raw = (await readPath('data')) ?? {};
    const db = {
      settings: { ...defaultSettings(), tax: defaultTaxRates(), bills: [], ...(raw.settings ?? {}) },
      prices: raw.prices ?? {},
      users: toArray(raw.users),
      auditLog: toArray(raw.auditLog),
    };
    for (const name of COLLECTIONS) {
      const rows = toArray(raw[name]);
      const spec = RESOURCES[name];
      db[name] = spec?.sort ? [...rows].sort(spec.sort) : rows;
    }
    // Ayarlardaki diziler RTDB'de nesneye dönüşebilir.
    db.settings.bills = toArray(db.settings.bills);
    db.settings.customCategories = toArray(db.settings.customCategories);
    db.settings.tariff = toArray(db.settings.tariff);
    return db;
  }

  /** Oturum açmış kullanıcının kaydı. */
  async function currentUser() {
    if (!session) return null;
    const record = await readPath(`data/users/${session.localId}`);
    if (!record) return null;
    return {
      ...record,
      id: session.localId,
      permissions: record.isAdmin ? allPermissions() : normalizePermissions(record.permissions),
    };
  }

  /** Denetim kaydı ekler (hata yutulur: kayıt tutulamadı diye işlem bozulmaz). */
  async function audit(user, entry) {
    const id = uid('log');
    await writePath(`data/auditLog/${id}`, {
      id, at: nowIso(), username: user?.username ?? '—', ...entry,
    }).catch(() => {});
  }

  /* ------------------------------------------------------ yetki kontrol -- */

  async function requirePermission(moduleKey) {
    const user = await currentUser();
    if (!user) { notifyUnauthorized(); throw new ApiError(401, 'Oturum bulunamadı.'); }
    if (!can(user, moduleKey)) throw new ApiError(403, `Bu işlem için "${moduleKey}" yetkiniz bulunmuyor.`);
    return user;
  }

  /* ---------------------------------------------------------- yardımcı -- */

  const invalid = (errors) => new ValidationError(errors);

  /** Döviz kaydını o günün kuruyla mühürler (sunucudaki applySeal ile aynı). */
  const sealWith = (spec, item, db) => (spec.seal ? spec.seal(item, db) : item);

  /* ------------------------------------------------------------- CRUD -- */

  async function saveResource(name, payload) {
    const spec = RESOURCES[name];
    const user = await requirePermission(spec.permission);
    const db = await loadDb();
    const item = sealWith(spec, spec.factory(payload), db);
    const errors = spec.validate(item, db);
    if (errors.length) throw invalid(errors);
    await writePath(`data/${name}/${item.id}`, item);
    await audit(user, {
      action: db[name].some((x) => x.id === item.id) ? 'update' : 'create',
      entity: name, entityId: item.id, summary: `${spec.label}: ${spec.summary(item)}`,
    });
    return item;
  }

  async function deleteResource(name, id) {
    const spec = RESOURCES[name];
    const user = await requirePermission(spec.permission);
    const db = await loadDb();
    const item = db[name].find((x) => x.id === id);
    if (!item) throw new ApiError(404, 'Kayıt bulunamadı.');

    await removePath(`data/${name}/${id}`);
    if (spec.onDelete) {
      // Yan etkiler (ör. oda silinince rezervasyon/fiyat temizliği) uygulanır.
      const copy = { ...db, [name]: db[name].filter((x) => x.id !== id) };
      spec.onDelete(copy, id);
      for (const key of COLLECTIONS) {
        if (JSON.stringify(copy[key]) !== JSON.stringify(db[key])) {
          await writePath(`data/${key}`, Object.fromEntries(copy[key].map((x) => [x.id, x])));
        }
      }
      if (JSON.stringify(copy.prices) !== JSON.stringify(db.prices)) {
        await writePath('data/prices', copy.prices);
      }
    }
    await audit(user, {
      action: 'delete', entity: name, entityId: id,
      summary: `${spec.label} silindi: ${spec.summary(item)}`,
    });
    return { ok: true };
  }

  /* ------------------------------------------------------------- state -- */

  async function stateResponse() {
    const user = await currentUser();
    if (!user) { notifyUnauthorized(); throw new ApiError(401, 'Oturum bulunamadı.'); }
    const db = await loadDb();
    return {
      ...db,
      users: user.isAdmin ? db.users.map(({ password, ...rest }) => rest) : [],
      auditLog: user.isAdmin ? db.auditLog.slice(-300).reverse() : [],
      modules: MODULES,
      me: { ...user, password: undefined },
    };
  }

  /* -------------------------------------------------------------- GET --- */

  async function get(path, query = {}) {
    if (path === '/api/auth/me') {
      const user = await currentUser();
      if (!user) throw new ApiError(401, 'Oturum bulunamadı.');
      return { user: { ...user, password: undefined } };
    }
    if (path === '/api/state') return stateResponse();
    if (path === '/api/fx/providers') return FX_SOURCES.map(({ key, label }) => ({ key, label }));
    if (path === '/api/fx/missing') {
      const currency = query.currency ?? 'EUR';
      const db = await loadDb();
      const dates = new Map();
      const add = (rows, dateOf) => {
        for (const row of missingRateDates(rows ?? [], db.exchangeRates, { dateOf, currency })) {
          dates.set(row.date, (dates.get(row.date) ?? 0) + row.count);
        }
      };
      add(db.salesInvoices, (r) => r.date);
      add(db.purchaseInvoices, (r) => r.date);
      return {
        currency,
        dates: [...dates.entries()].map(([date, count]) => ({ date, count }))
          .sort((a, b) => b.date.localeCompare(a.date)),
      };
    }
    if (path === '/api/backups') {
      const user = await currentUser();
      if (!user?.isAdmin) throw new ApiError(403, 'Bu işlem yalnızca yöneticiye açıktır.');
      const db = await loadDb();
      return {
        mode: 'firebase',
        directory: dbUrl,
        settings: { ...BACKUP_DEFAULTS, ...(db.settings?.backup ?? {}) },
        backups: [],
      };
    }
    throw new ApiError(404, `Uç nokta bulunamadı: ${path}`);
  }

  /* ------------------------------------------------------------- POST --- */

  async function post(path, body = {}) {
    /* --- kimlik --- */
    if (path === '/api/auth/login') {
      const email = String(body.username ?? '').includes('@')
        ? String(body.username).trim()
        : `${String(body.username ?? '').trim().toLowerCase()}@${loginDomain}`;
      const data = await identity('signInWithPassword', {
        email, password: body.password, returnSecureToken: true,
      });
      session = {
        localId: data.localId,
        idToken: data.idToken,
        refreshToken: data.refreshToken,
        expiresAt: Date.now() + Number(data.expiresIn ?? 3600) * 1000,
      };
      persist();
      let user = await currentUser();
      if (!user) user = await bootstrapFirstAdmin(email);
      if (!user) {
        session = null; persist();
        throw new ApiError(403, 'Bu hesap sistemde tanımlı değil. Yöneticinize başvurun.');
      }
      if (user.active === false) {
        session = null; persist();
        throw new ApiError(403, 'Bu hesap devre dışı bırakılmış.');
      }
      await writePath(`data/users/${user.id}/lastLogin`, nowIso()).catch(() => {});
      await audit(user, { action: 'login', entity: 'user', summary: 'Giriş yapıldı' });
      return { user: { ...user, password: undefined } };
    }
    if (path === '/api/auth/logout') {
      session = null;
      persist();
      return { ok: true };
    }
    if (path === '/api/auth/password') {
      const user = await currentUser();
      if (!user) throw new ApiError(401, 'Oturum bulunamadı.');
      if (String(body.newPassword ?? '').length < 6) {
        throw invalid(['Şifre en az 6 karakter olmalıdır.']);
      }
      const token = await freshToken();
      const data = await identity('update', {
        idToken: token, password: body.newPassword, returnSecureToken: true,
      });
      session = {
        ...session,
        idToken: data.idToken ?? session.idToken,
        refreshToken: data.refreshToken ?? session.refreshToken,
        expiresAt: Date.now() + Number(data.expiresIn ?? 3600) * 1000,
      };
      persist();
      await writePath(`data/users/${user.id}/mustChangePassword`, false);
      return { ok: true };
    }

    /* --- kullanıcı yönetimi --- */
    if (path === '/api/users') return saveUser(body);

    /* --- koleksiyonlar --- */
    const resourceMatch = path.match(/^\/api\/(\w+)$/);
    if (resourceMatch && RESOURCES[resourceMatch[1]]) return saveResource(resourceMatch[1], body);

    /* --- fiyat takvimi --- */
    if (path === '/api/prices/bulk') {
      await requirePermission('fiyatGirisi');
      const updates = {};
      for (const entry of body.entries ?? []) {
        const priceEntry = createPriceEntry(entry);
        if (validatePriceEntry(priceEntry).length) continue;
        updates[`${entry.roomId}/${entry.date}`] = priceEntry.amount > 0 ? priceEntry : null;
      }
      await patchPath('data/prices', updates);
      return { count: Object.keys(updates).length };
    }

    /* --- dönemsel faturalar --- */
    const billsMatch = path.match(/^\/api\/periods\/(\d{4}-\d{2})\/bills$/);
    if (billsMatch) return ensureBills(billsMatch[1]);

    /* --- kur --- */
    if (path === '/api/fx/refresh') return refreshFx(body);

    /* --- demo ve yedekleme --- */
    if (path === '/api/demo') return loadDemo();
    if (path === '/api/backups') {
      throw new ApiError(501,
        'Firebase kurulumunda sunucu klasörü yoktur. "Anlık Yedeği İndir" ile yedek dosyasını '
        + 'bilgisayarınıza kaydedin; veriler ayrıca Firebase tarafında yedeklenir.');
    }
    if (path === '/api/backups/restore') return restoreBackup(body);

    throw new ApiError(404, `Uç nokta bulunamadı: ${path}`);
  }

  /* -------------------------------------------------------------- PUT --- */

  async function put(path, body = {}) {
    if (path === '/api/settings') {
      await requirePermission('ayarlar');
      const db = await loadDb();
      const next = { ...db.settings, ...body };
      const errors = validateSettings(next);
      if (errors.length) throw invalid(errors);
      await patchPath('data/settings', body);
      return next;
    }
    if (path === '/api/backups/settings') {
      const me = await currentUser();
      if (!me?.isAdmin) throw new ApiError(403, 'Bu işlem yalnızca yöneticiye açıktır.');
      const backup = {
        autoEnabled: body.autoEnabled !== false,
        intervalHours: Math.min(168, Math.max(1, Number(body.intervalHours) || BACKUP_DEFAULTS.intervalHours)),
        keep: Math.min(200, Math.max(1, Number(body.keep) || BACKUP_DEFAULTS.keep)),
      };
      await patchPath('data/settings', { backup });
      return backup;
    }
    const priceMatch = path.match(/^\/api\/prices\/([\w-]+)\/(\d{4}-\d{2}-\d{2})$/);
    if (priceMatch) {
      await requirePermission('fiyatGirisi');
      const [, roomId, date] = priceMatch;
      const entry = createPriceEntry(body);
      const errors = validatePriceEntry(entry);
      if (errors.length) throw invalid(errors);
      await writePath(`data/prices/${roomId}/${date}`, entry.amount > 0 ? entry : null);
      return entry;
    }
    throw new ApiError(404, `Uç nokta bulunamadı: ${path}`);
  }

  /* ----------------------------------------------------------- DELETE --- */

  async function del(path) {
    const match = path.match(/^\/api\/(\w+)\/([\w-]+)$/);
    if (!match) throw new ApiError(404, `Uç nokta bulunamadı: ${path}`);
    const [, name, id] = match;
    if (name === 'users') return deleteUser(id);
    if (name === 'backups') {
      throw new ApiError(501, 'Firebase kurulumunda sunucuda saklanan yedek dosyası bulunmaz.');
    }
    if (!RESOURCES[name]) throw new ApiError(404, `Uç nokta bulunamadı: ${path}`);
    return deleteResource(name, id);
  }

  /* ------------------------------------------------- kullanıcı işlemleri -- */

  /**
   * İlk kurulum: veritabanında hiç kullanıcı yoksa, giriş yapan ilk Firebase
   * hesabı yönetici olarak kaydedilir. Böylece konsolda elle kayıt açmaya gerek
   * kalmaz. Sonraki hesaplar "Kullanıcı ve Yetki" ekranından tanımlanır.
   * Kurallar (database.rules.json) bu yazmaya yalnızca liste boşken izin verir.
   */
  async function bootstrapFirstAdmin(email) {
    const existing = await readPath('data/users').catch(() => null);
    if (existing && Object.keys(existing).length) return null;

    const username = email.split('@')[0];
    const record = {
      id: session.localId,
      username,
      email,
      displayName: username,
      isAdmin: true,
      active: true,
      mustChangePassword: false,
      permissions: allPermissions(),
      createdAt: nowIso(),
    };
    await writePath(`data/users/${record.id}`, record);
    await audit(record, {
      action: 'create', entity: 'users', entityId: record.id,
      summary: `İlk kurulum: ${username} yönetici olarak tanımlandı`,
    });
    return currentUser();
  }

  async function saveUser(payload) {
    const me = await currentUser();
    if (!me?.isAdmin) throw new ApiError(403, 'Bu işlem yalnızca yöneticiye açıktır.');
    const db = await loadDb();
    const username = String(payload.username ?? '').trim();
    if (!username) throw invalid(['Kullanıcı adı zorunludur.']);

    const existing = db.users.find((u) => u.id === payload.id);
    if (!existing) {
      if (String(payload.password ?? '').length < 6) throw invalid(['Şifre en az 6 karakter olmalıdır.']);
      const email = username.includes('@') ? username : `${username.toLowerCase()}@${loginDomain}`;
      // Yeni hesap kimlik servisinde açılır; kendi oturumumuz korunur.
      const created = await identity('signUp', { email, password: payload.password, returnSecureToken: true });
      const record = {
        id: created.localId,
        username,
        email,
        displayName: String(payload.displayName ?? username).trim(),
        isAdmin: Boolean(payload.isAdmin),
        active: payload.active !== false,
        mustChangePassword: true,
        permissions: normalizePermissions(payload.permissions),
        createdAt: nowIso(),
      };
      await writePath(`data/users/${record.id}`, record);
      await audit(me, { action: 'create', entity: 'users', entityId: record.id, summary: `Kullanıcı: ${username}` });
      return record;
    }

    const record = {
      ...existing,
      username,
      displayName: String(payload.displayName ?? existing.displayName).trim(),
      isAdmin: Boolean(payload.isAdmin),
      active: payload.active !== false,
      permissions: normalizePermissions(payload.permissions),
    };
    await writePath(`data/users/${record.id}`, record);
    await audit(me, { action: 'update', entity: 'users', entityId: record.id, summary: `Kullanıcı: ${username}` });
    return record;
  }

  async function deleteUser(id) {
    const me = await currentUser();
    if (!me?.isAdmin) throw new ApiError(403, 'Bu işlem yalnızca yöneticiye açıktır.');
    if (me.id === id) throw new ApiError(422, 'Kendi hesabınızı silemezsiniz.');
    // Kimlik kaydı Firebase konsolundan silinir; burada erişim kapatılır.
    await patchPath(`data/users/${id}`, { active: false, permissions: {} });
    await audit(me, { action: 'delete', entity: 'users', entityId: id, summary: 'Kullanıcı erişimi kapatıldı' });
    return { ok: true };
  }

  /* --------------------------------------------- dönemsel fatura açma -- */

  async function ensureBills(month) {
    const user = await requirePermission('genelHarcamalar');
    const db = await loadDb();
    const templates = toArray(db.settings.bills);
    const created = [];
    for (const template of templates) {
      if (template.active === false) continue;
      const exists = db.expenses.some((e) => e.billKey === template.key && e.date.startsWith(month));
      if (exists) continue;
      const spec = RESOURCES.expenses;
      const expense = spec.factory({
        date: `${month}-01`,
        category: template.category,
        description: template.label,
        amount: 0,
        allocation: template.allocation,
        weightKind: template.weightKind,
      });
      expense.billKey = template.key;
      await writePath(`data/expenses/${expense.id}`, expense);
      created.push(expense);
    }
    if (created.length) {
      await audit(user, {
        action: 'create', entity: 'expenses',
        summary: `${month} dönemi için ${created.length} fatura kalemi açıldı`,
      });
    }
    return { created: created.length };
  }

  /* ------------------------------------------------------------- kur --- */

  /** Tarayıcıdan erişilebilen (CORS izinli) kur kaynakları. */
  const FX_SOURCES = [
    {
      key: 'frankfurter',
      label: 'Frankfurter (ECB)',
      url: (currency) => `https://api.frankfurter.app/latest?from=${currency}&to=TRY`,
      parse: (data) => ({ rate: Number(data?.rates?.TRY), date: data?.date ?? null }),
    },
    {
      key: 'exchangerate',
      label: 'exchangerate.host',
      url: (currency) => `https://api.exchangerate.host/latest?base=${currency}&symbols=TRY`,
      parse: (data) => ({ rate: Number(data?.rates?.TRY), date: data?.date ?? null }),
    },
  ];

  async function refreshFx({ currency = 'EUR', source } = {}) {
    const user = await requirePermission('ayarlar');
    const db = await loadDb();
    const ordered = [
      ...FX_SOURCES.filter((s) => s.key === source),
      ...FX_SOURCES.filter((s) => s.key !== source),
    ];

    const attempts = [];
    for (const provider of ordered) {
      try {
        const response = await fetch(provider.url(currency));
        if (!response.ok) throw new Error(`sunucu ${response.status} döndü`);
        const { rate, date } = provider.parse(await response.json());
        if (!Number.isFinite(rate) || rate <= 0) throw new Error('TRY kuru bulunamadı');

        const today = nowIso().slice(0, 10);
        const entry = createExchangeRate({
          date: today, currency, rate, kind: provider.key, source: provider.label,
          sourceDate: date, enteredBy: user.username,
        });
        await writePath(`data/exchangeRates/${entry.id}`, entry);

        const fx = {
          ...db.settings.fx,
          rate: entry.rate,
          source: provider.key,
          provider: provider.key,
          providerLabel: provider.label,
          sourceDate: date,
          updatedAt: entry.fetchedAt,
          lastError: '',
          history: { ...(db.settings.fx?.history ?? {}), [today]: entry.rate },
        };
        await patchPath('data/settings', { fx });

        // Bugünün faturalanmamış döviz işlemleri yeni kurla mühürlenir.
        let resealed = 0;
        for (const name of ['salesInvoices', 'purchaseInvoices']) {
          for (const row of db[name]) {
            if (row.currency !== currency || row.date !== today) continue;
            if (Number(row.invoicedAmountTry) > 0) continue;
            await patchPath(`data/${name}/${row.id}`, {
              fxRate: entry.rate, fxRateDate: entry.date, fxSource: entry.source,
            });
            resealed += 1;
          }
        }
        await audit(user, {
          action: 'update', entity: 'fx',
          summary: `Kur güncellendi: 1 ${currency} = ${entry.rate} TRY (${provider.label})`,
        });
        return { ...fx, resealed, rateEntry: entry };
      } catch (err) {
        attempts.push({ provider: provider.key, label: provider.label, error: err.message });
      }
    }

    const detail = attempts.map((a) => `${a.label}: ${a.error}`).join(' · ');
    throw new ApiError(502, `Kur alınamadı. Denenen kaynaklar — ${detail}`, { attempts });
  }

  /* ------------------------------------------------------------ demo --- */

  async function loadDemo() {
    const me = await currentUser();
    if (!me?.isAdmin) throw new ApiError(403, 'Bu işlem yalnızca yöneticiye açıktır.');
    const { seedData } = await import('../seed.js');
    const demo = seedData();

    const payload = {
      rooms: Object.fromEntries(demo.rooms.map((r) => [r.id, r])),
      expenses: Object.fromEntries(demo.expenses.map((e) => [e.id, e])),
      prices: demo.prices,
      settings: { ...demo.settings, tax: defaultTaxRates(), bills: [] },
    };
    for (const name of COLLECTIONS) {
      if (!(name in payload)) payload[name] = null;
    }
    await patchPath('data', payload);
    await audit(me, { action: 'import', entity: 'demo', summary: 'Demo verisi yüklendi' });
    return { rooms: demo.rooms.length, expenses: demo.expenses.length };
  }

  /* -------------------------------------------------------- yedekleme --- */

  async function restoreBackup({ payload, keepUsers, dryRun, name }) {
    const me = await currentUser();
    if (!me?.isAdmin) throw new ApiError(403, 'Bu işlem yalnızca yöneticiye açıktır.');
    if (name) {
      throw new ApiError(422,
        'Firebase kurulumunda sunucuda saklanan yedek bulunmaz; yedek dosyasını bilgisayarınızdan seçin.');
    }

    const errors = validateBackup(payload, SCHEMA_VERSION);
    if (dryRun) {
      return {
        valid: errors.length === 0,
        errors,
        counts: payload?.counts ?? null,
        createdAt: payload?.createdAt ?? null,
        version: payload?.version ?? null,
      };
    }
    if (errors.length) throw invalid(errors);

    const data = payload.data ?? {};
    const next = {};
    for (const name of COLLECTIONS) {
      next[name] = Array.isArray(data[name])
        ? Object.fromEntries(data[name].map((x) => [x.id, x]))
        : (data[name] ?? null);
    }
    next.prices = data.prices ?? {};
    next.settings = data.settings ?? {};
    next.auditLog = Array.isArray(data.auditLog)
      ? Object.fromEntries(data.auditLog.map((x) => [x.id, x]))
      : (data.auditLog ?? null);
    // Kullanıcı kayıtları kimlik servisindeki uid ile eşlenir; "koru" seçilirse
    // mevcut hesaplar olduğu gibi kalır (yedekteki uid'ler farklı olabilir).
    if (!keepUsers && Array.isArray(data.users)) {
      next.users = Object.fromEntries(data.users.filter((u) => u?.id).map((u) => [u.id, u]));
    }
    await writePath('data', next);
    await audit(me, { action: 'restore', entity: 'backup', summary: 'Yedekten geri yüklendi' });
    return { safety: { name: 'firebase-oncesi-indirilen-yedek' }, counts: payload.counts ?? null };
  }

  /* ------------------------------------------------------------ Excel --- */

  async function postRaw(path, raw, query = {}) {
    if (path !== '/api/excel/import') throw new ApiError(404, `Uç nokta bulunamadı: ${path}`);
    const user = await requirePermission('excelIceAktarim');
    const kind = query.kind ?? 'gider';
    const dryRun = query.dryRun === '1';

    const parsed = await parseWorkbook(raw);
    const db = await loadDb();
    let plan;
    try {
      plan = planImport(parsed, kind, db);
    } catch (err) {
      throw new ApiError(err.status ?? 422, err.message, err.detail ?? {});
    }

    if (!dryRun && plan.validCount) {
      const updates = Object.fromEntries(plan.valid.map((item) => [item.id, item]));
      await patchPath(`data/${plan.collection}`, updates);
      await audit(user, {
        action: 'import', entity: plan.collection,
        summary: `Excel içe aktarım: ${plan.validCount} kayıt eklendi, ${plan.skippedCount} kayıt zaten vardı`
          + `, ${plan.conflictCount} çakışma, ${plan.invalidCount} satır reddedildi`,
      });
    }

    const { valid, collection, ...result } = plan;
    return { ...result, dryRun, imported: dryRun ? 0 : plan.validCount };
  }

  async function download(path, query = {}, fallbackName = 'dosya.xlsx') {
    if (path === '/api/excel/template') {
      const kind = query.kind ?? 'gider';
      const bytes = buildTemplate(kind);
      return downloadBlob(new Blob([bytes]), `ornek-sablon-${kind}.xlsx`);
    }
    if (path === '/api/excel/export') {
      await requirePermission('excelDisaAktarim');
      const db = await loadDb();
      const bytes = exportWorkbook(buildSheets(db, query));
      return downloadBlob(new Blob([bytes]), `otel-finans-${query.from || 'tum'}_${query.to || 'veriler'}.xlsx`);
    }
    if (path === '/api/backups/download') {
      const me = await currentUser();
      if (!me?.isAdmin) throw new ApiError(403, 'Bu işlem yalnızca yöneticiye açıktır.');
      const db = await loadDb();
      const payload = snapshotOf(db, { version: SCHEMA_VERSION, createdBy: me.username });
      return downloadBlob(
        new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
        `otel-yedek-${nowIso().slice(0, 10)}.json`,
      );
    }
    throw new ApiError(404, `Uç nokta bulunamadı: ${path}`);
  }

  /** Dışa aktarım sayfaları (sunucudaki ile aynı sütun yapısı). */
  function buildSheets(db, { from = '', to = '' }) {
    const inRange = (date) => (!from || date >= from) && (!to || date <= to);
    const invoiceSheet = (name, rows) => ({
      name,
      rows: [
        ['Müşteri', 'Fatura Tarihi', 'Fatura No', 'Tutar', 'Para Birimi',
          'Vergiler Hariç Toplam Tutar', 'Vergiler Dahil Toplam Tutar', 'Aktif'],
        ...rows.filter((i) => inRange(i.date)).map((i) => [
          i.customer, i.date, i.invoiceNo, i.amount, i.currency,
          i.netAmount, i.grossAmount, i.active === false ? 'Hayır' : 'Evet',
        ]),
      ],
    });
    return [
      {
        name: 'Giderler',
        rows: [
          ['Tarih', 'Kategori', 'Açıklama', 'Tutar', 'Para Birimi', 'Aktif'],
          ...db.expenses.filter((e) => inRange(e.date)).map((e) => [
            e.date, e.category, e.description, e.amount, e.currency, e.active === false ? 'Hayır' : 'Evet',
          ]),
        ],
      },
      invoiceSheet('Giden Faturalar', db.salesInvoices),
      invoiceSheet('Gelen Faturalar', db.purchaseInvoices),
      {
        name: 'Kur Defteri',
        rows: [
          ['Tarih', 'Para Birimi', 'Kur Tipi', 'Kur (TL)', 'Kaynak'],
          ...db.exchangeRates.filter((r) => inRange(r.date)).map((r) => [
            r.date, r.currency, r.kind, r.rate, r.source,
          ]),
        ],
      },
    ];
  }

  return { get, post, put, del, postRaw, download };
}
