/**
 * REST API — oturum, yetki ve veri uçları (PRD §1, §3–§8).
 *
 * Yetki iki katmanda uygulanır:
 *  - Arayüz: yetkisiz modüller menüde görünmez.
 *  - Sunucu: her uç nokta kendi modül iznini doğrular; yetkisiz istek 403 döner.
 */

import { createEmployee, createExtraWorker, createSupplier, createSupplierTxn, createCashDay,
  defaultTaxRates, validateEmployee, validateExtraWorker, validateSupplier, validateSupplierTxn,
  validateCashDay, validateTaxRates } from '../src/core/finance.js';
import { createExpense, createPriceEntry, createReservation, createRoom, defaultSettings,
  validateExpense, validatePriceEntry, validateReservation, validateRoom, validateSettings } from '../src/core/model.js';
import { record } from './audit.js';
import { allPermissions, can, MODULES, normalizePermissions } from './permissions.js';
import { buildTemplate, exportWorkbook, parseWorkbook, TEMPLATES } from './excel.js';
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
    users: user.isAdmin ? db.users.map(publicUser) : [],
    auditLog: user.isAdmin ? db.auditLog.slice(-300).reverse() : [],
    modules: MODULES,
    me: publicUser(user),
  };
}

/* -------------------------------------------------------- kaynak tanımı -- */

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
  reservations: {
    permission: 'gelirler', factory: createReservation,
    validate: (item, db) => validateReservation(item, { rooms: db.rooms, reservations: db.reservations }),
    label: 'Rezervasyon', summary: (r) => `${r.guestName} ${r.checkIn}→${r.checkOut}`,
    sort: (a, b) => b.checkIn.localeCompare(a.checkIn),
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

route('POST', /^\/api\/(rooms|reservations|expenses|employees|extraWorkers|suppliers|supplierTxns|cashDays)$/, async ({ req, res, user, path }) => {
  const name = resourceName(path);
  const spec = RESOURCES[name];
  requirePermission(user, spec.permission);
  const payload = await readJson(req);
  const saved = await update((db) => {
    const item = spec.factory(payload);
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

route('DELETE', /^\/api\/(rooms|reservations|expenses|employees|extraWorkers|suppliers|supplierTxns|cashDays)\/([\w-]+)$/, async ({ res, user, match }) => {
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
    record(db, { user, action: 'import', entity: 'demo', summary: 'Demo verisi yüklendi; finansal kayıtlar sıfırlandı (kullanıcılar korundu)' });
    return { rooms: db.rooms.length, reservations: db.reservations.length, expenses: db.expenses.length };
  });
  sendJson(res, 200, loaded);
});

/* --- Excel (PRD §2.1) --- */

route('GET', /^\/api\/excel\/template$/, async ({ res, user, query }) => {
  requirePermission(user, 'excelIceAktarim');
  const kind = query.get('kind') === 'gelir' ? 'gelir' : 'gider';
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
  const kind = query.get('kind') === 'gelir' ? 'gelir' : 'gider';
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

/**
 * Şablona göre satırları okur, doğrular ve (dryRun değilse) kaydeder.
 * Geçersiz satırlar sebebiyle birlikte döndürülür (PRD: "geçersiz satırlar bildirilmeli").
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

  rows.slice(1).forEach((row, index) => {
    const lineNo = index + 2; // başlık satırı 1
    if (row.every((cell) => !String(cell ?? '').trim())) return; // boş satır
    const get = (key) => String(row[columnAt[key]] ?? '').trim();

    if (kind === 'gider') {
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
      else valid.push(item);
    } else {
      const room = db.rooms.find((r) => String(r.number) === get('roomNumber'));
      const item = createReservation({
        roomId: room?.id ?? '',
        guestName: get('guestName'),
        guests: Number(get('guests')),
        checkIn: parseDate(get('checkIn')),
        checkOut: parseDate(get('checkOut')),
        totalAmount: parseAmount(get('totalAmount')),
        currency: get('currency').toUpperCase() || 'TRY',
        channel: get('channel') || 'direct',
        commissionRate: parseAmount(get('commissionRate')) || 0,
        breakfastIncluded: parseBool(get('breakfastIncluded')),
      });
      const errors = validateReservation(item, { rooms: db.rooms, reservations: [...db.reservations, ...valid] });
      if (!room) errors.unshift(`"${get('roomNumber')}" numaralı oda bulunamadı.`);
      if (errors.length) invalidRows.push({ line: lineNo, errors, raw: row });
      else valid.push(item);
    }
  });

  if (!dryRun && valid.length) {
    const collection = kind === 'gider' ? 'expenses' : 'reservations';
    await update((current) => {
      current[collection].push(...valid);
      current[collection].sort(RESOURCES[collection].sort);
      record(current, {
        user, action: 'import', entity: collection,
        summary: `Excel içe aktarım: ${valid.length} kayıt eklendi, ${invalidRows.length} satır reddedildi`,
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
