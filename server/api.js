/**
 * REST API — oturum, yetki ve veri uçları (PRD §1, §3–§8).
 *
 * Yetki iki katmanda uygulanır:
 *  - Arayüz: yetkisiz modüller menüde görünmez.
 *  - Sunucu: her uç nokta kendi modül iznini doğrular; yetkisiz istek 403 döner.
 */

import { createInvoice, validateInvoice } from '../src/core/finance.js';
import {
  amountInTry, createExchangeRate, isInvoiced, missingRateDates, rateOn,
  resolveRate, sealRate, validateExchangeRate,
} from '../src/core/rates.js';
import { createCashDay, createEmployee, createExtraWorker, createForeignWorker,
  createRestaurantExpense, createRestaurantIncome, createSupplier, createSupplierTxn,
  defaultTaxRates, validateCashDay, validateEmployee, validateExtraWorker, validateForeignWorker,
  validateRestaurantExpense, validateRestaurantIncome, validateSupplier, validateSupplierTxn,
  validateTaxRates } from '../src/core/finance.js';
import { createExpense, createPriceEntry, createRoom, defaultSettings,
  validateExpense, validatePriceEntry, validateRoom, validateSettings } from '../src/core/model.js';
import { record } from './audit.js';
import { allPermissions, can, MODULES, normalizePermissions } from './permissions.js';
import { buildTemplate, exportWorkbook, parseWorkbook, TEMPLATES } from './excel.js';
import { fetchRate, FX_PROVIDERS } from './fx.js';
import { BACKUP_DIR, createBackup, deleteBackup, listBackups, pruneBackups, readBackup,
  restoreBackup, snapshot, validateBackup } from './backup.js';
import { cookieHeader, parseCookies, readBody, readJson, sendError, sendJson } from './http.js';
import { createSession, destroySession, destroyUserSessions, findUser, hashPassword, newId,
  passwordProblems, publicUser, sameUser, SESSION_COOKIE, userForToken, verifyPassword } from './auth.js';
import { load, update } from './db.js';

const nowIso = () => new Date().toISOString();

class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const badRequest = (message, extra) => new ApiError(400, message, extra);
const invalid = (errors) => new ApiError(422, errors[0], { errors });

/* ------------------------------------------------------------ maskeleme -- */

/**
 * Modül yetkisi olmayan kullanıcıya kayıtlar maskelenerek verilir: toplamlar
 * doğru kalır (dashboard/raporlar şaşmaz) ama kişi ve firma bilgisi gizlenir.
 */
const maskRecords = (rows, fields) => rows.map((row) => {
  const masked = { ...row, masked: true };
  for (const field of fields) if (masked[field]) masked[field] = '•••';
  return masked;
});

function visibleState(db, user) {
  const mask = (key, rows, fields) => (can(user, key) ? rows : maskRecords(rows, fields));
  return {
    rooms: db.rooms,
    reservations: db.reservations,
    expenses: db.expenses,
    prices: db.prices,
    settings: { ...defaultSettings(), tax: defaultTaxRates(), bills: [], ...db.settings },
    employees: mask('calisanlar', db.employees, ['name', 'role', 'note']),
    extraWorkers: mask('ekstraCalisan', db.extraWorkers, ['name', 'note']),
    suppliers: mask('toptancilar', db.suppliers, ['name', 'phone', 'taxNumber', 'note']),
    supplierTxns: mask('toptancilar', db.supplierTxns, ['invoiceNo', 'note']),
    cashDays: mask('kasa', db.cashDays, ['note', 'closedBy']),
    restaurantIncomes: mask('restoranGelir', db.restaurantIncomes, ['note']),
    restaurantExpenses: mask('restoranGider', db.restaurantExpenses, ['note']),
    foreignWorkers: mask('yabanciCalisanlar', db.foreignWorkers, ['name', 'note']),
    purchaseInvoices: mask('giderFaturalari', db.purchaseInvoices, ['customer', 'invoiceNo', 'note']),
    salesInvoices: mask('gelirler', db.salesInvoices, ['customer', 'invoiceNo', 'note']),
    exchangeRates: db.exchangeRates ?? [],
    users: user.isAdmin ? db.users.map(publicUser) : [],
    auditLog: user.isAdmin ? db.auditLog.slice(-300).reverse() : [],
    modules: MODULES,
    me: publicUser(user),
  };
}

/* -------------------------------------------------------- kaynak tanımı -- */

/**
 * Döviz kaydını işlem gününün kuruyla mühürler.
 * Kullanıcı kuru elle verdiyse (fxRate) ona dokunulmaz; böylece "o günün kuru
 * yoksa kullanıcıdan iste" akışı çalışır.
 */
function applySeal(item, db, date) {
  if (!item || item.currency === 'TRY' || !item.currency) return item;
  if (Number(item.fxRate) > 0) return item;
  const sealed = sealRate(db.exchangeRates ?? [], {
    date,
    currency: item.currency,
    // Hiç kur kaydı yoksa ayarlardaki güncel kur son çare olarak kullanılmaz:
    // kullanıcıdan o günün kuru istenir (doğrulama hata verir).
    fallbackRate: 0,
  });
  return { ...item, ...sealed };
}

/**
 * Her koleksiyon: izin anahtarı, fabrika, doğrulayıcı ve denetim özeti.
 * Böylece CRUD uçları tek bir yerden türetilir.
 */
const RESOURCES = {
  rooms: {
    permission: 'odalar', factory: createRoom,
    validate: (item, db) => validateRoom(item, { rooms: db.rooms }),
    label: 'Oda', summary: (r) => `${r.number} ${r.name}`.trim(),
    onDelete: (db, id) => {
      db.reservations = db.reservations.filter((x) => x.roomId !== id);
      delete db.prices[id];
      db.expenses = db.expenses.map((e) => (e.roomId === id
        ? { ...e, roomId: '', amenityKey: '', allocation: e.allocation === 'direct' ? 'general' : e.allocation }
        : e));
    },
    sort: (a, b) => String(a.number).localeCompare(String(b.number), 'tr', { numeric: true }),
  },
  expenses: {
    permission: 'genelHarcamalar', factory: createExpense,
    validate: (item, db) => validateExpense(item, { rooms: db.rooms }),
    label: 'Gider', summary: (e) => `${e.description} (${e.amount})`,
    sort: (a, b) => b.date.localeCompare(a.date),
  },
  employees: {
    permission: 'calisanlar', factory: createEmployee,
    validate: (item, db) => validateEmployee(item, { employees: db.employees }),
    label: 'Personel', summary: (e) => `${e.name} ${e.period}`,
    sort: (a, b) => b.period.localeCompare(a.period) || a.name.localeCompare(b.name, 'tr'),
  },
  extraWorkers: {
    permission: 'ekstraCalisan', factory: createExtraWorker,
    validate: (item) => validateExtraWorker(item),
    label: 'Ekstra çalışan', summary: (e) => `${e.name} ${e.date}`,
    sort: (a, b) => b.date.localeCompare(a.date),
  },
  suppliers: {
    permission: 'toptancilar', factory: createSupplier,
    validate: (item, db) => validateSupplier(item, { suppliers: db.suppliers }),
    label: 'Toptancı', summary: (s) => s.name,
    onDelete: (db, id) => { db.supplierTxns = db.supplierTxns.filter((t) => t.supplierId !== id); },
    sort: (a, b) => a.name.localeCompare(b.name, 'tr'),
  },
  supplierTxns: {
    permission: 'toptancilar', factory: createSupplierTxn,
    validate: (item, db) => validateSupplierTxn(item, { suppliers: db.suppliers }),
    label: 'Cari hareket', summary: (t) => `${t.type} ${t.invoiceNo || ''} ${t.amount}`,
    sort: (a, b) => b.date.localeCompare(a.date),
  },
  restaurantIncomes: {
    permission: 'restoranGelir', factory: createRestaurantIncome,
    validate: (item, db) => validateRestaurantIncome(item, { incomes: db.restaurantIncomes }),
    label: 'Restoran geliri', summary: (i) => `${i.date} ${i.sequence}. gün sonu ${i.amount}`,
    sort: (a, b) => b.date.localeCompare(a.date) || a.sequence - b.sequence,
  },
  restaurantExpenses: {
    permission: 'restoranGider', factory: createRestaurantExpense,
    validate: (item) => validateRestaurantExpense(item),
    label: 'Restoran gideri', summary: (e) => `${e.category} ${e.amount}`,
    sort: (a, b) => b.date.localeCompare(a.date),
  },
  foreignWorkers: {
    permission: 'yabanciCalisanlar', factory: createForeignWorker,
    validate: (item, db) => validateForeignWorker(item, { workers: db.foreignWorkers }),
    label: 'Yabancı çalışan', summary: (w) => `${w.name} ${w.period}`,
    sort: (a, b) => b.period.localeCompare(a.period) || a.name.localeCompare(b.name, 'tr'),
  },
  purchaseInvoices: {
    permission: 'giderFaturalari',
    seal: (item, db) => applySeal(item, db, item.date),
    factory: (patch) => createInvoice({ ...patch, direction: 'gelen' }),
    validate: (item, db) => validateInvoice(item, { invoices: db.purchaseInvoices }),
    label: 'Gider faturası', summary: (i) => `${i.invoiceNo} · ${i.customer}`,
    sort: (a, b) => b.date.localeCompare(a.date) || a.invoiceNo.localeCompare(b.invoiceNo, 'tr'),
  },
  salesInvoices: {
    permission: 'gelirler',
    seal: (item, db) => applySeal(item, db, item.date),
    factory: (patch) => createInvoice({ ...patch, direction: 'giden' }),
    validate: (item, db) => validateInvoice(item, { invoices: db.salesInvoices }),
    label: 'Gelir faturası', summary: (i) => `${i.invoiceNo} · ${i.customer}`,
    sort: (a, b) => b.date.localeCompare(a.date) || a.invoiceNo.localeCompare(b.invoiceNo, 'tr'),
  },
  exchangeRates: {
    permission: 'ayarlar', factory: createExchangeRate,
    seal: null,
    validate: (item) => validateExchangeRate(item),
    label: 'Döviz kuru',
    summary: (r) => `${r.date} · 1 ${r.currency} = ${r.rate} TRY (${r.source})`,
    sort: (a, b) => b.date.localeCompare(a.date),
  },
  cashDays: {
    permission: 'kasa', factory: createCashDay,
    validate: (item, db) => {
      const errors = validateCashDay(item);
      if (db.cashDays.some((d) => d.id !== item.id && d.date === item.date)) {
        errors.push(`${item.date} için gün sonu zaten kaydedilmiş.`);
      }
      return errors;
    },
    label: 'Gün sonu', summary: (d) => `${d.date} sayım ${d.countedCash}`,
    sort: (a, b) => b.date.localeCompare(a.date),
  },
};

/* ----------------------------------------------------------- yönlendirme -- */

const ROUTES = [];
const route = (method, pattern, handler, options = {}) =>
  ROUTES.push({ method, pattern, handler, ...options });

/* --- kimlik --- */

route('POST', /^\/api\/auth\/login$/, async ({ req, res }) => {
  const { username, password } = await readJson(req);
  const user = await findUser(username);
  const ok = user && user.active !== false && await verifyPassword(password, user);
  if (!ok) {
    // Aynı mesaj: kullanıcı adının var olup olmadığı sızdırılmaz.
    throw new ApiError(401, 'Kullanıcı adı veya şifre hatalı.');
  }
  const token = createSession(user.id);
  await update((db) => {
    const target = db.users.find((u) => u.id === user.id);
    if (target) target.lastLoginAt = nowIso();
    record(db, { user, action: 'login', entity: 'user', entityId: user.id, summary: 'Giriş yapıldı' });
  });
  sendJson(res, 200, { user: publicUser(user) }, {
    'set-cookie': cookieHeader(SESSION_COOKIE, token, { maxAge: 12 * 60 * 60 }),
  });
}, { public: true });

route('POST', /^\/api\/auth\/logout$/, async ({ res, token, user }) => {
  destroySession(token);
  if (user) await update((db) => record(db, { user, action: 'logout', entity: 'user', entityId: user.id, summary: 'Çıkış yapıldı' }));
  sendJson(res, 200, { ok: true }, { 'set-cookie': cookieHeader(SESSION_COOKIE, '', { clear: true }) });
}, { public: true });

route('GET', /^\/api\/auth\/me$/, async ({ res, user }) => {
  sendJson(res, 200, { user: publicUser(user) });
});

route('POST', /^\/api\/auth\/password$/, async ({ req, res, user }) => {
  const { currentPassword, newPassword } = await readJson(req);
  if (!await verifyPassword(currentPassword, user)) throw new ApiError(401, 'Mevcut şifre hatalı.');
  const problems = passwordProblems(newPassword);
  if (problems.length) throw invalid(problems);
  const { salt, hash, iterations } = await hashPassword(newPassword);
  await update((db) => {
    const target = db.users.find((u) => u.id === user.id);
    target.salt = salt;
    target.passwordHash = hash;
    target.iterations = iterations;
    target.mustChangePassword = false;
    record(db, { user, action: 'password_change', entity: 'user', entityId: user.id, summary: 'Kendi şifresini değiştirdi' });
  });
  sendJson(res, 200, { ok: true });
});

/* --- durum --- */

route('GET', /^\/api\/state$/, async ({ res, user }) => {
  const db = await load();
  sendJson(res, 200, visibleState(db, user));
});

/* --- genel CRUD --- */

const resourceName = (path) => path.replace(/^\/api\//, '').split('/')[0];

route('POST', /^\/api\/(rooms|expenses|employees|extraWorkers|suppliers|supplierTxns|cashDays|restaurantIncomes|restaurantExpenses|foreignWorkers|purchaseInvoices|salesInvoices|exchangeRates)$/, async ({ req, res, user, path }) => {
  const name = resourceName(path);
  const spec = RESOURCES[name];
  requirePermission(user, spec.permission);
  const payload = await readJson(req);
  const saved = await update((db) => {
    const item = spec.seal ? spec.seal(spec.factory(payload), db) : spec.factory(payload);
    const errors = spec.validate(item, db);
    if (errors.length) throw invalid(errors);
    const index = db[name].findIndex((x) => x.id === item.id);
    if (index >= 0) db[name][index] = item;
    else db[name].push(item);
    if (spec.sort) db[name].sort(spec.sort);
    record(db, {
      user, action: index >= 0 ? 'update' : 'create', entity: name, entityId: item.id,
      summary: `${spec.label}: ${spec.summary(item)}`,
    });
    return item;
  });
  sendJson(res, 200, saved);
});

route('DELETE', /^\/api\/(rooms|expenses|employees|extraWorkers|suppliers|supplierTxns|cashDays|restaurantIncomes|restaurantExpenses|foreignWorkers|purchaseInvoices|salesInvoices|exchangeRates)\/([\w-]+)$/, async ({ res, user, match }) => {
  const [, name, id] = match;
  const spec = RESOURCES[name];
  requirePermission(user, spec.permission);
  await update((db) => {
    const item = db[name].find((x) => x.id === id);
    if (!item) throw new ApiError(404, 'Kayıt bulunamadı.');
    db[name] = db[name].filter((x) => x.id !== id);
    spec.onDelete?.(db, id);
    record(db, { user, action: 'delete', entity: name, entityId: id, summary: `${spec.label} silindi: ${spec.summary(item)}` });
  });
  sendJson(res, 200, { ok: true });
});

/* --- fiyat takvimi --- */

route('PUT', /^\/api\/prices\/([\w-]+)\/(\d{4}-\d{2}-\d{2})$/, async ({ req, res, user, match }) => {
  requirePermission(user, 'fiyatGirisi');
  const [, roomId, date] = match;
  const payload = await readJson(req);
  const entry = createPriceEntry(payload);
  const errors = validatePriceEntry(entry);
  if (errors.length) throw invalid(errors);
  await update((db) => {
    db.prices[roomId] ??= {};
    if (entry.amount > 0) db.prices[roomId][date] = entry;
    else delete db.prices[roomId][date];
  });
  sendJson(res, 200, entry);
});

route('POST', /^\/api\/prices\/bulk$/, async ({ req, res, user }) => {
  requirePermission(user, 'fiyatGirisi');
  const { entries = [] } = await readJson(req);
  const written = await update((db) => {
    let count = 0;
    for (const { roomId, date, amount, currency } of entries) {
      const entry = createPriceEntry({ amount, currency });
      if (validatePriceEntry(entry).length) continue;
      db.prices[roomId] ??= {};
      if (entry.amount > 0) { db.prices[roomId][date] = entry; count += 1; }
      else delete db.prices[roomId][date];
    }
    record(db, { user, action: 'bulk', entity: 'prices', summary: `${count} güne fiyat uygulandı` });
    return count;
  });
  sendJson(res, 200, { written });
});

/* --- ayarlar --- */

route('PUT', /^\/api\/settings$/, async ({ req, res, user }) => {
  requirePermission(user, 'ayarlar');
  const payload = await readJson(req);
  const saved = await update((db) => {
    const next = { ...defaultSettings(), tax: defaultTaxRates(), bills: [], ...db.settings, ...payload };
    const errors = [...validateSettings(next), ...validateTaxRates(next.tax)];
    if (errors.length) throw invalid(errors);
    db.settings = next;
    record(db, { user, action: 'update', entity: 'settings', summary: 'Ayarlar güncellendi' });
    return next;
  });
  sendJson(res, 200, saved);
});

/* --- dönemsel faturalar (PRD §3.5) --- */

route('POST', /^\/api\/periods\/(\d{4}-\d{2})\/bills$/, async ({ res, user, match }) => {
  requirePermission(user, 'genelHarcamalar');
  const month = match[1];
  const created = await update((db) => {
    const templates = db.settings?.bills ?? [];
    const made = [];
    for (const template of templates) {
      if (template.active === false) continue;
      const date = `${month}-01`;
      const exists = db.expenses.some((e) => e.billKey === template.key && e.date.startsWith(month));
      if (exists) continue;
      // Yeni dönemde fatura 0 TL olarak açılır; tutar fatura gelince güncellenir.
      const expense = createExpense({
        date,
        category: template.category,
        description: template.label,
        amount: 0,
        allocation: template.allocation,
        weightKind: template.weightKind,
      });
      expense.billKey = template.key;
      db.expenses.push(expense);
      made.push(expense);
    }
    if (made.length) {
      db.expenses.sort((a, b) => b.date.localeCompare(a.date));
      record(db, { user, action: 'create', entity: 'expenses', summary: `${month} dönemi için ${made.length} fatura kalemi açıldı` });
    }
    return made;
  });
  sendJson(res, 200, { created });
});

/* --- kullanıcı yönetimi (PRD §6) --- */

const requireAdmin = (user) => {
  if (!user?.isAdmin) throw new ApiError(403, 'Bu işlem yalnızca Admin tarafından yapılabilir.');
};

route('GET', /^\/api\/users$/, async ({ res, user }) => {
  requireAdmin(user);
  const db = await load();
  sendJson(res, 200, db.users.map(publicUser));
});

route('POST', /^\/api\/users$/, async ({ req, res, user }) => {
  requireAdmin(user);
  const payload = await readJson(req);
  const username = String(payload.username ?? '').trim();
  if (!username) throw invalid(['Kullanıcı adı zorunludur.']);

  const existing = payload.id ? null : await findUser(username);
  if (existing) throw invalid([`"${username}" kullanıcı adı zaten kullanılıyor.`]);

  let credentials = null;
  if (payload.password) {
    const problems = passwordProblems(payload.password);
    if (problems.length) throw invalid(problems);
    credentials = await hashPassword(payload.password);
  } else if (!payload.id) {
    throw invalid(['Yeni kullanıcı için şifre zorunludur.']);
  }

  const saved = await update((db) => {
    let target = payload.id ? db.users.find((u) => u.id === payload.id) : null;
    if (payload.id && !target) throw new ApiError(404, 'Kullanıcı bulunamadı.');

    if (target && db.users.some((u) => u.id !== target.id && sameUser(u.username, username))) {
      throw invalid([`"${username}" kullanıcı adı zaten kullanılıyor.`]);
    }

    if (!target) {
      target = {
        id: newId('usr'), createdAt: nowIso(), lastLoginAt: null,
        isAdmin: false, active: true, permissions: {}, mustChangePassword: true,
      };
      db.users.push(target);
    }

    const wasAdmin = target.isAdmin;
    target.username = username;
    target.displayName = String(payload.displayName ?? '').trim() || username;
    target.active = payload.active !== false;
    target.isAdmin = Boolean(payload.isAdmin);
    target.permissions = target.isAdmin ? allPermissions() : normalizePermissions(payload.permissions);
    if (credentials) {
      target.salt = credentials.salt;
      target.passwordHash = credentials.hash;
      target.iterations = credentials.iterations;
      target.mustChangePassword = payload.mustChangePassword !== false;
    }

    // Son admin devre dışı bırakılamaz / yetkisi alınamaz.
    const admins = db.users.filter((u) => u.isAdmin && u.active !== false);
    if (!admins.length) {
      target.isAdmin = wasAdmin || true;
      target.active = true;
      target.permissions = allPermissions();
      throw new ApiError(409, 'Sistemde en az bir aktif Admin kullanıcı kalmalıdır.');
    }

    if (target.active === false) destroyUserSessions(target.id);
    record(db, { user, action: payload.id ? 'update' : 'create', entity: 'user', entityId: target.id, summary: `Kullanıcı: ${target.username}` });
    return publicUser(target);
  });
  sendJson(res, 200, saved);
});

route('DELETE', /^\/api\/users\/([\w-]+)$/, async ({ res, user, match }) => {
  requireAdmin(user);
  const id = match[1];
  if (id === user.id) throw new ApiError(409, 'Kendi hesabınızı silemezsiniz.');
  await update((db) => {
    const target = db.users.find((u) => u.id === id);
    if (!target) throw new ApiError(404, 'Kullanıcı bulunamadı.');
    const remainingAdmins = db.users.filter((u) => u.id !== id && u.isAdmin && u.active !== false);
    if (target.isAdmin && !remainingAdmins.length) {
      throw new ApiError(409, 'Sistemde en az bir aktif Admin kullanıcı kalmalıdır.');
    }
    db.users = db.users.filter((u) => u.id !== id);
    destroyUserSessions(id);
    record(db, { user, action: 'delete', entity: 'user', entityId: id, summary: `Kullanıcı silindi: ${target.username}` });
  });
  sendJson(res, 200, { ok: true });
});

/* --- yedekleme ve geri yükleme (admin) --- */

const requireBackupAccess = (user) => {
  requireAdmin(user);
  requirePermission(user, 'yedekleme');
};

route('GET', /^\/api\/backups$/, async ({ res, user }) => {
  requireBackupAccess(user);
  const db = await load();
  sendJson(res, 200, {
    directory: BACKUP_DIR,
    settings: db.settings?.backup ?? { autoEnabled: true, intervalHours: 24, keep: 20 },
    backups: await listBackups(),
  });
});

route('POST', /^\/api\/backups$/, async ({ req, res, user }) => {
  requireBackupAccess(user);
  const { reason = 'manuel' } = await readJson(req).catch(() => ({}));
  const info = await createBackup({ reason, user });
  const db = await load();
  await pruneBackups(db.settings?.backup?.keep ?? 20);
  await update((current) => record(current, {
    user, action: 'backup', entity: 'backup', entityId: info.name,
    summary: `Yedek oluşturuldu: ${info.name}`,
  }));
  sendJson(res, 200, info);
});

route('GET', /^\/api\/backups\/download$/, async ({ res, user, query }) => {
  requireBackupAccess(user);
  const name = query.get('name');
  // İsim verilmezse anlık yedek indirilir.
  const payload = name ? await readBackup(name) : snapshot(await load());
  const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `attachment; filename="${name || `otel-yedek-${new Date().toISOString().slice(0, 10)}.json`}"`,
    'content-length': body.length,
  });
  res.end(body);
});

route('DELETE', /^\/api\/backups\/([\w.\-]+)$/, async ({ res, user, match }) => {
  requireBackupAccess(user);
  await deleteBackup(decodeURIComponent(match[1]));
  await update((db) => record(db, {
    user, action: 'delete', entity: 'backup', entityId: match[1], summary: `Yedek silindi: ${match[1]}`,
  }));
  sendJson(res, 200, { ok: true });
});

route('POST', /^\/api\/backups\/restore$/, async ({ req, res, user }) => {
  requireBackupAccess(user);
  const { name, payload, keepUsers = false, dryRun = false } = await readJson(req);
  const backup = name ? await readBackup(name) : payload;
  if (!backup) throw badRequest('Geri yüklenecek yedek belirtilmedi.');

  const errors = validateBackup(backup);
  if (dryRun) {
    sendJson(res, 200, {
      dryRun: true, valid: errors.length === 0, errors,
      counts: backup.counts ?? null, createdAt: backup.createdAt ?? null, version: backup.version ?? null,
    });
    return;
  }
  if (errors.length) throw invalid(errors);

  const result = await restoreBackup(backup, { keepUsers, user });
  await update((db) => record(db, {
    user, action: 'restore', entity: 'backup', entityId: name ?? 'yuklenen-dosya',
    summary: `Yedekten geri yüklendi (${name ?? 'dosya'}) · güvenlik yedeği: ${result.safety.name}`,
  }));
  sendJson(res, 200, result);
});

route('PUT', /^\/api\/backups\/settings$/, async ({ req, res, user }) => {
  requireBackupAccess(user);
  const patch = await readJson(req);
  const saved = await update((db) => {
    const backup = {
      autoEnabled: patch.autoEnabled !== false,
      intervalHours: Math.min(168, Math.max(1, Number(patch.intervalHours) || 24)),
      keep: Math.min(200, Math.max(1, Number(patch.keep) || 20)),
    };
    db.settings = { ...db.settings, backup };
    record(db, { user, action: 'update', entity: 'backup', summary: 'Yedekleme ayarları güncellendi' });
    return backup;
  });
  applyAutoBackup(saved);
  sendJson(res, 200, saved);
});

/** Otomatik yedekleme zamanlayıcısını ayarlara göre kurar. */
let applyAutoBackup = () => {};
export const setAutoBackupApplier = (fn) => { applyAutoBackup = fn; };

/* --- döviz kuru (PRD v2 §4.1) --- */

route('GET', /^\/api\/fx\/providers$/, async ({ res }) => {
  sendJson(res, 200, FX_PROVIDERS.map((p) => ({ key: p.key, label: p.label })));
});

route('POST', /^\/api\/fx\/refresh$/, async ({ req, res, user }) => {
  requirePermission(user, 'ayarlar');
  const { currency = 'EUR', source } = await readJson(req).catch(() => ({}));
  const db = await load();
  const preferred = source || db.settings?.fx?.source || 'tcmb';

  let result;
  try {
    result = await fetchRate({ currency, preferred });
  } catch (err) {
    // Başarısız güncellemede mevcut kur korunur.
    throw new ApiError(502, err.message, { attempts: err.attempts ?? [], keptRate: db.settings?.fx?.rate ?? null });
  }

  const today = new Date().toISOString().slice(0, 10);

  const saved = await update((current) => {
    const fx = { ...(current.settings.fx ?? {}) };
    fx.rate = result.rate;
    fx.source = preferred;
    fx.provider = result.provider;
    fx.providerLabel = result.providerLabel;
    fx.sourceDate = result.sourceDate;
    fx.updatedAt = result.fetchedAt;
    fx.lastError = '';
    fx.history = { ...(fx.history ?? {}), [today]: result.rate };
    current.settings = { ...current.settings, fx };

    // Kur defterine bugünün kaydı yazılır (varsa güncellenir).
    const entry = createExchangeRate({
      date: today, currency, rate: result.rate, kind: result.provider,
      source: result.providerLabel, sourceDate: result.sourceDate, fetchedAt: result.fetchedAt,
      enteredBy: user?.username ?? 'sistem',
    });
    current.exchangeRates = [
      ...(current.exchangeRates ?? []).filter((r) => !(r.date === today && r.currency === currency)),
      entry,
    ].sort((a, b) => b.date.localeCompare(a.date));

    // Bugünün henüz faturalanmamış döviz işlemleri yeni kurla yeniden mühürlenir.
    const reseal = (rows, dateOf) => {
      let count = 0;
      for (const row of rows ?? []) {
        if (row.currency !== currency) continue;
        if (dateOf(row) !== today) continue;
        if (isInvoiced(row)) continue; // faturalanmış kayıt dokunulmaz
        row.fxRate = entry.rate;
        row.fxRateDate = entry.date;
        row.fxSource = entry.source;
        count += 1;
      }
      return count;
    };
    const resealed = reseal(current.reservations, (r) => r.checkIn)
      + reseal(current.salesInvoices, (r) => r.date)
      + reseal(current.purchaseInvoices, (r) => r.date);

    record(current, {
      user, action: 'update', entity: 'fx',
      summary: `Kur güncellendi: 1 ${currency} = ${result.rate} TRY (${result.providerLabel})`
        + ` · ${today} kur defterine yazıldı`
        + (resealed ? ` · ${resealed} faturalanmamış işlem güncellendi` : ''),
    });
    fx.resealed = resealed;
    fx.rateEntry = entry;
    return fx;
  });
  sendJson(res, 200, saved);
});

/** Kuru bulunmayan işlem günleri — kullanıcıdan elle girmesi istenir. */
route('GET', /^\/api\/fx\/missing$/, async ({ res, user, query }) => {
  requirePermission(user, 'ayarlar');
  const currency = query.get('currency') || 'EUR';
  const db = await load();
  const rates = db.exchangeRates ?? [];
  const dates = new Map();
  const add = (rows, dateOf) => {
    for (const row of missingRateDates(rows ?? [], rates, { dateOf, currency })) {
      dates.set(row.date, (dates.get(row.date) ?? 0) + row.count);
    }
  };
  add(db.reservations, (r) => r.checkIn);
  add(db.salesInvoices, (r) => r.date);
  add(db.purchaseInvoices, (r) => r.date);

  sendJson(res, 200, {
    currency,
    dates: [...dates.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.date.localeCompare(a.date)),
  });
});

/* --- demo verisi (ilk kurulum kolaylığı) --- */

route('POST', /^\/api\/demo$/, async ({ res, user }) => {
  requireAdmin(user);
  const { seedData } = await import('../src/core/seed.js');
  const demo = seedData();
  const loaded = await update((db) => {
    db.rooms = demo.rooms;
    db.reservations = demo.reservations;
    db.expenses = demo.expenses;
    db.prices = demo.prices;
    db.settings = { ...demo.settings, tax: defaultTaxRates(), bills: db.settings?.bills ?? [] };
    // Demo yüklemesi tam sıfırlamadır: personel, toptancı ve kasa kayıtları da temizlenir.
    db.employees = [];
    db.extraWorkers = [];
    db.suppliers = [];
    db.supplierTxns = [];
    db.cashDays = [];
    db.restaurantIncomes = [];
    db.restaurantExpenses = [];
    db.foreignWorkers = [];
    db.purchaseInvoices = [];
    db.salesInvoices = [];

    // Demo verisi tutarlı olsun diye işlem günlerine kur kaydı üretilir ve
    // döviz rezervasyonları o günün kuruyla mühürlenir.
    const demoRate = Number(db.settings?.fx?.rate) || 47.5;
    const rateDates = new Set(db.reservations.filter((r) => r.currency === 'EUR').map((r) => r.checkIn));
    for (const expense of db.expenses) if (expense.currency === 'EUR') rateDates.add(expense.date);
    rateDates.add(new Date().toISOString().slice(0, 10));
    db.exchangeRates = [...rateDates]
      .filter(Boolean)
      .map((date, index) => createExchangeRate({
        date, currency: 'EUR',
        // Gerçekçi görünmesi için küçük günlük dalgalanma.
        rate: Math.round((demoRate - 1 + (index % 7) * 0.3) * 100) / 100,
        kind: 'manual', source: 'Demo verisi', enteredBy: 'demo',
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
    for (const reservation of db.reservations) {
      Object.assign(reservation, applySeal(reservation, db, reservation.checkIn));
    }

    record(db, { user, action: 'import', entity: 'demo', summary: 'Demo verisi yüklendi; finansal kayıtlar sıfırlandı (kullanıcılar korundu)' });
    return { rooms: db.rooms.length, reservations: db.reservations.length, expenses: db.expenses.length };
  });
  sendJson(res, 200, loaded);
});

/* --- Excel (PRD §2.1) --- */

route('GET', /^\/api\/excel\/template$/, async ({ res, user, query }) => {
  requirePermission(user, 'excelIceAktarim');
  const kind = TEMPLATES[query.get('kind')] ? query.get('kind') : 'gider';
  const buffer = buildTemplate(kind);
  res.writeHead(200, {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="ornek-sablon-${kind}.xlsx"`,
    'content-length': buffer.length,
  });
  res.end(buffer);
});

route('POST', /^\/api\/excel\/import$/, async ({ req, res, user, query }) => {
  requirePermission(user, 'excelIceAktarim');
  const kind = TEMPLATES[query.get('kind')] ? query.get('kind') : 'gider';
  const dryRun = query.get('dryRun') === '1';
  const buffer = await readBody(req);
  const parsed = parseWorkbook(buffer);
  const result = await importRows(parsed, kind, user, dryRun);
  sendJson(res, 200, result);
});

route('GET', /^\/api\/excel\/export$/, async ({ res, user, query }) => {
  requirePermission(user, 'excelDisaAktarim');
  const db = await load();
  const from = query.get('from') || '';
  const to = query.get('to') || '';
  const sheets = buildExportSheets(db, { from, to, user });
  const buffer = exportWorkbook(sheets);
  res.writeHead(200, {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="otel-finans-${from || 'tum'}_${to || 'veriler'}.xlsx"`,
    'content-length': buffer.length,
  });
  res.end(buffer);
});


/* --------------------------------------------- Excel içe aktarım (§2.1) -- */

const normalizeHeader = (value) => String(value ?? '').trim().toLocaleLowerCase('tr');
const parseAmount = (value) => {
  const text = String(value ?? '').trim().replace(/\s/g, '');
  if (!text) return NaN;
  // "12.500,50" ve "12500.50" biçimlerinin ikisini de kabul et.
  const normalized = text.includes(',') && text.lastIndexOf(',') > text.lastIndexOf('.')
    ? text.replace(/\./g, '').replace(',', '.')
    : text.replace(/,/g, '');
  return Number(normalized);
};
const parseBool = (value) => !/^(hay[ıi]r|no|false|0)$/i.test(String(value ?? '').trim());
const parseDate = (value) => {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const tr = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (tr) return `${tr[3]}-${tr[2].padStart(2, '0')}-${tr[1].padStart(2, '0')}`;
  // Excel seri numarası (1900 tarih sistemi)
  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 20000 && serial < 60000) {
    const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return text;
};

const norm = (value) => String(value ?? '').trim().toLocaleUpperCase('tr');
/** İki tutar aynı mı (kuruş farkı yok sayılır)? */
const sameMoney = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01;

/**
 * Aynı kaydın daha önce işlenip işlenmediğini söyler.
 * `key` kaydı tanımlayan alan (fatura no gibi), `same` ise geri kalan bilgilerin
 * de birebir aynı olup olmadığını döndürür. Böylece "aynı numara + aynı bilgi"
 * sessizce atlanır, "aynı numara + farklı bilgi" çakışma olarak bildirilir.
 */
const DUPLICATE_RULES = {
  invoice: {
    key: (i) => norm(i.invoiceNo),
    same: (a, b) => norm(a.customer) === norm(b.customer)
      && a.date === b.date
      && norm(a.currency) === norm(b.currency)
      && sameMoney(a.grossAmount, b.grossAmount)
      && sameMoney(a.netAmount, b.netAmount),
    label: (i) => `${i.invoiceNo} numaralı fatura`,
  },
  expense: {
    key: (e) => [e.date, norm(e.description), norm(e.category)].join('|'),
    same: (a, b) => sameMoney(a.amount, b.amount) && norm(a.currency) === norm(b.currency),
    label: (e) => `${e.date} tarihli "${e.description}" gideri`,
  },
};

/**
 * Şablona göre satırları okur, doğrular ve (dryRun değilse) kaydeder.
 * Daha önce işlenmiş kayıtlar tekrar yazılmaz: aynı anahtar ve aynı bilgi
 * taşıyan satırlar "atlandı" olarak, bilgisi değişmiş olanlar "çakışma" olarak
 * raporlanır. Geçersiz satırlar sebebiyle birlikte döndürülür.
 */
export async function importRows(parsed, kind, user, dryRun = false) {
  const template = TEMPLATES[kind];
  const rows = parsed.rows ?? [];
  if (!rows.length) throw badRequest('Excel dosyası boş.');

  const header = rows[0].map(normalizeHeader);
  const expected = template.columns.map((c) => normalizeHeader(c.label));
  const missing = expected.filter((label) => !header.includes(label));
  if (missing.length) {
    throw new ApiError(422, 'Excel sütun yapısı şablona uymuyor. "?" düğmesinden örnek şablonu indirin.', {
      missingColumns: missing,
      expectedColumns: template.columns.map((c) => c.label),
      foundColumns: rows[0],
    });
  }
  const columnAt = Object.fromEntries(template.columns.map((c) => [c.key, header.indexOf(normalizeHeader(c.label))]));

  const db = await load();
  const valid = [];
  const invalidRows = [];
  // İşlenen faturaların künyesi: aynı yüklemedeki kayıtlar tek toplu iş altında toplanır.
  const importedAt = new Date().toISOString();
  const importBatch = `imp_${importedAt.replace(/[^\d]/g, '').slice(0, 14)}`;
  /** Daha önce birebir aynısı işlenmiş satırlar. */
  const skippedRows = [];
  /** Aynı anahtarla kayıtlı ama bilgileri değişmiş satırlar. */
  const conflictRows = [];

  const ruleName = template.direction ? 'invoice' : 'expense';
  const rule = DUPLICATE_RULES[ruleName];
  const collection = template.target ?? 'expenses';
  // Mevcut kayıtlar anahtarlarıyla indekslenir; aktarım sırasındakiler de eklenir.
  const seen = new Map();
  for (const item of db[collection] ?? []) {
    const key = rule.key(item);
    if (key) seen.set(key, item);
  }

  /**
   * Kayıt daha önce işlendiyse true döner ve satırı uygun listeye yazar.
   */
  const alreadyProcessed = (item, lineNo, row) => {
    const key = rule.key(item);
    if (!key) return false;
    const existing = seen.get(key);
    if (!existing) return false;
    if (rule.same(existing, item)) {
      skippedRows.push({ line: lineNo, reason: `${rule.label(item)} zaten kayıtlı; tekrar işlenmedi.`, raw: row });
    } else {
      conflictRows.push({
        line: lineNo,
        reason: `${rule.label(item)} farklı bilgilerle kayıtlı; değiştirmemek için atlandı.`,
        raw: row,
      });
    }
    return true;
  };

  rows.slice(1).forEach((row, index) => {
    const lineNo = index + 2; // başlık satırı 1
    if (row.every((cell) => !String(cell ?? '').trim())) return; // boş satır
    const get = (key) => String(row[columnAt[key]] ?? '').trim();

    if (template.direction) {
      // e-Fatura dosyası: yalnızca şablondaki yedi sütun okunur.
      const item = createInvoice({
        direction: template.direction,
        importedAt,
        importBatch,
        importKind: kind,
        customer: get('customer'),
        date: parseDate(get('date')),
        invoiceNo: get('invoiceNo'),
        amount: parseAmount(get('amount')),
        currency: get('currency').toUpperCase() || 'TRY',
        netAmount: parseAmount(get('netAmount')) || 0,
        grossAmount: parseAmount(get('grossAmount')) || 0,
      });
      // Mükerrer kontrolü aşağıda ayrıca yapılır; doğrulama yalnızca alanlara bakar.
      const errors = validateInvoice(item, { invoices: [] });
      if (errors.length) invalidRows.push({ line: lineNo, errors, raw: row });
      else if (!alreadyProcessed(item, lineNo, row)) {
        seen.set(rule.key(item), item);
        valid.push(item);
      }
    } else if (kind === 'gider') {
      const room = db.rooms.find((r) => String(r.number) === get('roomNumber'));
      const item = createExpense({
        date: parseDate(get('date')),
        category: get('category') || 'other',
        description: get('description'),
        amount: parseAmount(get('amount')),
        currency: get('currency').toUpperCase() || 'TRY',
        allocation: get('allocation') || undefined,
        roomId: room?.id ?? '',
        vendor: get('vendor'),
      });
      const errors = validateExpense(item, { rooms: db.rooms });
      if (get('roomNumber') && !room) errors.push(`"${get('roomNumber')}" numaralı oda bulunamadı.`);
      if (errors.length) invalidRows.push({ line: lineNo, errors, raw: row });
      else if (!alreadyProcessed(item, lineNo, row)) {
        seen.set(rule.key(item), item);
        valid.push(item);
      }
    }
  });

  if (!dryRun && valid.length) {
    await update((current) => {
      current[collection].push(...valid);
      current[collection].sort(RESOURCES[collection].sort);
      record(current, {
        user, action: 'import', entity: collection,
        summary: `Excel içe aktarım: ${valid.length} kayıt eklendi, ${skippedRows.length} kayıt zaten vardı`
          + `, ${conflictRows.length} çakışma, ${invalidRows.length} satır reddedildi`,
      });
    });
  }

  return {
    kind,
    dryRun,
    totalRows: rows.length - 1,
    imported: dryRun ? 0 : valid.length,
    validCount: valid.length,
    invalidCount: invalidRows.length,
    invalidRows: invalidRows.slice(0, 100),
    /** Daha önce birebir aynısı işlendiği için atlanan satırlar. */
    skippedCount: skippedRows.length,
    skippedRows: skippedRows.slice(0, 100),
    /** Aynı anahtarla kayıtlı ama bilgisi değişmiş satırlar. */
    conflictCount: conflictRows.length,
    conflictRows: conflictRows.slice(0, 100),
    preview: valid.slice(0, 20),
  };
}

/* --------------------------------------------- Excel dışa aktarım (§2.1) -- */

export function buildExportSheets(db, { from = '', to = '', user }) {
  const inRange = (date) => (!from || date >= from) && (!to || date <= to);
  const roomLabelOf = (id) => {
    const room = db.rooms.find((r) => r.id === id);
    return room ? `${room.number}${room.name ? ` - ${room.name}` : ''}` : '';
  };

  const sheets = [];

  sheets.push({
    name: 'Gelirler',
    rows: [
      ['Giriş', 'Çıkış', 'Oda', 'Misafir', 'Kişi', 'Tutar', 'Para Birimi', 'Kanal', 'Komisyon %', 'Kahvaltı', 'Durum'],
      ...db.reservations.filter((r) => inRange(r.checkIn)).map((r) => [
        r.checkIn, r.checkOut, roomLabelOf(r.roomId), r.guestName, r.guests,
        r.totalAmount, r.currency, r.channel, r.commissionRate,
        r.breakfastIncluded ? 'Evet' : 'Hayır', r.status === 'cancelled' ? 'İptal' : 'Onaylı',
      ]),
    ],
  });

  sheets.push({
    name: 'Giderler',
    rows: [
      ['Tarih', 'Kategori', 'Açıklama', 'Tutar', 'Para Birimi', 'Dağıtım', 'Oda', 'Tedarikçi', 'Aktif', 'Tekrarlayan'],
      ...db.expenses.filter((e) => inRange(e.date)).map((e) => [
        e.date, e.category, e.description, e.amount, e.currency, e.allocation,
        roomLabelOf(e.roomId), e.vendor, e.active === false ? 'Hayır' : 'Evet',
        e.recurring?.enabled ? `Her ayın ${e.recurring.dayOfMonth}. günü` : 'Hayır',
      ]),
    ],
  });

  if (can(user, 'calisanlar')) {
    sheets.push({
      name: 'Çalışanlar',
      rows: [
        ['Dönem', 'Personel', 'Görev', 'Net Maaş', 'SGK', 'Toplam', 'Aktif'],
        ...db.employees.filter((e) => !from || `${e.period}-01` >= from.slice(0, 7) + '-01').map((e) => [
          e.period, e.name, e.role, e.netSalary, e.sgk, e.netSalary + e.sgk, e.active === false ? 'Hayır' : 'Evet',
        ]),
      ],
    });
  }

  if (can(user, 'ekstraCalisan')) {
    sheets.push({
      name: 'Ekstra Çalışan',
      rows: [
        ['Tarih', 'Çalışan', 'Tutar', 'Açıklama'],
        ...db.extraWorkers.filter((e) => inRange(e.date)).map((e) => [e.date, e.name, e.amount, e.note]),
      ],
    });
  }

  if (can(user, 'toptancilar')) {
    const supplierName = (id) => db.suppliers.find((s) => s.id === id)?.name ?? '';
    sheets.push({
      name: 'Toptancı Cari',
      rows: [
        ['Tarih', 'Toptancı', 'Tür', 'Fatura No', 'Tutar', 'KDV %', 'Açıklama'],
        ...db.supplierTxns.filter((t) => inRange(t.date)).map((t) => [
          t.date, supplierName(t.supplierId), t.type === 'invoice' ? 'Fatura' : 'Ödeme',
          t.invoiceNo, t.amount, t.kdvRate, t.note,
        ]),
      ],
    });
  }

  // Gelen / giden faturalar aynı sütun yapısıyla dışa aktarılır.
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

  if (can(user, 'gelirler')) sheets.push(invoiceSheet('Giden Faturalar', db.salesInvoices ?? []));
  if (can(user, 'giderFaturalari')) sheets.push(invoiceSheet('Gelen Faturalar', db.purchaseInvoices ?? []));

  if (can(user, 'ayarlar')) {
    sheets.push({
      name: 'Kur Defteri',
      rows: [
        ['Tarih', 'Para Birimi', 'Kur Tipi', 'Kur (TL)', 'Kaynak'],
        ...(db.exchangeRates ?? []).filter((r) => inRange(r.date))
          .map((r) => [r.date, r.currency, r.kind, r.rate, r.source]),
      ],
    });
  }

  if (can(user, 'kasa')) {
    sheets.push({
      name: 'Kasa',
      rows: [
        ['Tarih', 'Devir', 'Sayılan Kasa', 'Açıklama'],
        ...db.cashDays.filter((d) => inRange(d.date)).map((d) => [d.date, d.openingCash, d.countedCash, d.note]),
      ],
    });
  }

  return sheets;
}

/* ------------------------------------------------------------- yardımcı -- */

function requirePermission(user, moduleKey) {
  if (!can(user, moduleKey)) {
    const label = MODULES.find((m) => m.key === moduleKey)?.label ?? moduleKey;
    throw new ApiError(403, `Bu işlem için "${label}" yetkiniz bulunmuyor.`);
  }
}

export { ApiError, badRequest, requirePermission, RESOURCES, visibleState };

/* ------------------------------------------------------- istek işleyici -- */

export async function handleApi(req, res, url) {
  const path = url.pathname;
  const match = ROUTES.map((r) => ({ r, m: r.pattern.exec(path) })).find(({ r, m }) => m && r.method === req.method);

  if (!match) {
    const pathExists = ROUTES.some((r) => r.pattern.test(path));
    sendError(res, pathExists ? 405 : 404, pathExists ? 'Bu yöntem desteklenmiyor.' : 'Uç nokta bulunamadı.');
    return;
  }

  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const user = await userForToken(token);

  if (!match.r.public && !user) {
    sendError(res, 401, 'Oturum bulunamadı. Lütfen giriş yapın.');
    return;
  }

  try {
    await match.r.handler({ req, res, url, user, token, path, match: match.m, query: url.searchParams });
  } catch (err) {
    if (err instanceof ApiError) sendError(res, err.status, err.message, err.extra);
    else {
      console.error('API hatası:', err);
      sendError(res, 500, err.message || 'Beklenmeyen bir hata oluştu.');
    }
  }
}
