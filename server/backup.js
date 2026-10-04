/**
 * Yedekleme ve geri yükleme (admin).
 *
 * Yedekler sunucudaki `data/backups/` klasöründe `.json` dosyaları olarak tutulur.
 * Aynı klasör bir ağ sürücüsüne veya bulut eşitleme klasörüne (OneDrive, Drive,
 * Dropbox, NAS) işaret edebilir: `BACKUP_DIR` ortam değişkeni ile yolu değiştirin,
 * böylece yedekler farklı bilgisayarlardan erişilebilir olur.
 *
 * Otomatik yedek: sunucu açılışında ve ayarlanan aralıkta çalışır; en eski
 * yedekler `keep` sayısını aşınca silinir.
 */

import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DATA_DIR, emptyDb, load, resetForTests, SCHEMA_VERSION, update } from './db.js';

export const BACKUP_DIR = process.env.BACKUP_DIR || join(DATA_DIR, 'backups');

const stamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const isBackupName = (name) => /^otel-yedek-.*\.json$/.test(name);

/** Yedeklenen koleksiyonlar. Kullanıcılar da dâhildir (şifreler hash'li saklanır). */
const COLLECTIONS = [
  'users', 'rooms', 'reservations', 'expenses', 'prices', 'settings',
  'employees', 'extraWorkers', 'suppliers', 'supplierTxns', 'cashDays',
  'restaurantIncomes', 'restaurantExpenses', 'foreignWorkers',
  'purchaseInvoices', 'salesInvoices', 'auditLog',
];

export function snapshot(db) {
  const data = {};
  for (const key of COLLECTIONS) data[key] = db[key];
  return {
    format: 'otel-finans-yedek',
    version: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    counts: Object.fromEntries(COLLECTIONS.map((k) => [k, Array.isArray(db[k]) ? db[k].length : 1])),
    data,
  };
}

/** Yedek dosyası oluşturur. */
export async function createBackup({ reason = 'manuel', user = null } = {}) {
  const db = await load();
  const payload = snapshot(db);
  payload.reason = reason;
  payload.createdBy = user?.username ?? 'sistem';

  await mkdir(BACKUP_DIR, { recursive: true });
  const name = `otel-yedek-${stamp()}-${reason}.json`;
  const path = join(BACKUP_DIR, name);
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf8');
  const info = await stat(path);
  return { name, size: info.size, createdAt: payload.createdAt, reason, createdBy: payload.createdBy };
}

export async function listBackups() {
  try {
    const names = (await readdir(BACKUP_DIR)).filter(isBackupName).sort().reverse();
    const rows = [];
    for (const name of names) {
      const info = await stat(join(BACKUP_DIR, name));
      rows.push({ name, size: info.size, createdAt: info.mtime.toISOString() });
    }
    return rows;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function readBackup(name) {
  if (!isBackupName(name)) throw new Error('Geçersiz yedek dosyası adı.');
  const raw = await readFile(join(BACKUP_DIR, name), 'utf8');
  return JSON.parse(raw);
}

export async function deleteBackup(name) {
  if (!isBackupName(name)) throw new Error('Geçersiz yedek dosyası adı.');
  await unlink(join(BACKUP_DIR, name));
}

/** Yedek içeriğini doğrular. */
export function validateBackup(payload) {
  const errors = [];
  if (payload?.format !== 'otel-finans-yedek') errors.push('Bu dosya bir sistem yedeği değil.');
  if (!payload?.data || typeof payload.data !== 'object') errors.push('Yedek içeriği okunamadı.');
  else {
    for (const key of ['rooms', 'expenses', 'settings']) {
      if (payload.data[key] === undefined) errors.push(`Yedekte "${key}" bölümü eksik.`);
    }
    if (Array.isArray(payload.data.users) && payload.data.users.length === 0) {
      errors.push('Yedekte hiç kullanıcı yok; geri yüklenirse sisteme giriş yapılamaz.');
    }
  }
  if (payload?.version > SCHEMA_VERSION) {
    errors.push(`Yedek daha yeni bir sürümden (${payload.version}); önce uygulamayı güncelleyin.`);
  }
  return errors;
}

/**
 * Yedekten geri yükler. Geri yüklemeden önce mevcut durumun güvenlik yedeği alınır.
 * @param {object} payload yedek içeriği
 * @param {{keepUsers?: boolean}} options kullanıcı hesapları korunsun mu
 */
export async function restoreBackup(payload, { keepUsers = false, user = null } = {}) {
  const errors = validateBackup(payload);
  if (errors.length) {
    const error = new Error(errors[0]);
    error.errors = errors;
    throw error;
  }

  // Geri yükleme geri alınamaz; önce mevcut durumu yedekle.
  const safety = await createBackup({ reason: 'geri-yukleme-oncesi', user });

  await update((db) => {
    const currentUsers = db.users;
    const base = emptyDb();
    for (const key of COLLECTIONS) {
      db[key] = payload.data[key] !== undefined ? payload.data[key] : base[key];
    }
    if (keepUsers) db.users = currentUsers;
    db.version = SCHEMA_VERSION;
  });

  return { safety, counts: payload.counts ?? null };
}

/* ------------------------------------------------- otomatik yedekleme -- */

let timer = null;

/** Eski yedekleri temizler, en yeni `keep` adedi kalır. */
export async function pruneBackups(keep = 20) {
  const rows = await listBackups();
  const removed = [];
  for (const row of rows.slice(keep)) {
    await deleteBackup(row.name);
    removed.push(row.name);
  }
  return removed;
}

/**
 * Otomatik yedeklemeyi başlatır.
 * @param {{intervalHours?: number, keep?: number, onBackup?: Function}} options
 */
export function startAutoBackup({ intervalHours = 24, keep = 20, onBackup = () => {} } = {}) {
  stopAutoBackup();
  if (!(intervalHours > 0)) return null;

  const run = async () => {
    try {
      const info = await createBackup({ reason: 'otomatik' });
      await pruneBackups(keep);
      onBackup(info);
    } catch (err) {
      console.error(`Otomatik yedekleme başarısız: ${err.message}`);
    }
  };

  // Açılışta bir kez, sonra aralıklarla.
  run();
  timer = setInterval(run, intervalHours * 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}

export function stopAutoBackup() {
  if (timer) clearInterval(timer);
  timer = null;
}
