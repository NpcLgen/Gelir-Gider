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
import { BACKUP_COLLECTIONS as COLLECTIONS, snapshotOf, validateBackup as checkBackup } from '../src/core/backupFormat.js';

export const BACKUP_DIR = process.env.BACKUP_DIR || join(DATA_DIR, 'backups');

const stamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const isBackupName = (name) => /^otel-yedek-.*\.json$/.test(name);

/** Yedek biçimi `src/core/backupFormat.js` içinde tanımlıdır (iki arka uçta ortak). */
export function snapshot(db, createdBy = 'sistem') {
  return snapshotOf(db, { version: SCHEMA_VERSION, createdBy });
}

/** Yedek dosyası oluşturur. */
export async function createBackup({ reason = 'manuel', user = null } = {}) {
  const db = await load();
  const payload = snapshot(db, user?.username ?? 'sistem');
  payload.reason = reason;

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
export const validateBackup = (payload) => checkBackup(payload, SCHEMA_VERSION);

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
