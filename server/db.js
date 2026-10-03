/**
 * Dosya tabanlı veri deposu (PRD §5 "ilişkisel yapıya hazır" ara adım).
 *
 * Tüm veriler tek bir JSON dosyasında tutulur; yazma işlemi geçici dosyaya yapılıp
 * atomik olarak yeniden adlandırılır, böylece çökme anında dosya bozulmaz.
 * Yazmalar sıraya alınır (son yazan kazanır değil, sırayla uygulanır).
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || join(root, 'data');
const DB_PATH = join(DATA_DIR, 'db.json');

export const SCHEMA_VERSION = 2;

/** Boş veritabanı iskeleti. */
export function emptyDb() {
  return {
    version: SCHEMA_VERSION,
    users: [],
    rooms: [],
    reservations: [],
    expenses: [],
    prices: {},
    settings: {},
    /** PRD §3.2 — sabit personel (maaş + SGK), dönem bazlı. */
    employees: [],
    /** PRD §3.3 — ekstra/günübirlik çalışan ödemeleri. */
    extraWorkers: [],
    /** PRD §4.2 — toptancılar (cari hesap). */
    suppliers: [],
    /** Toptancı cari hareketleri: fatura ve ödeme. */
    supplierTxns: [],
    /** PRD §5.2 — gün sonu kasa sayımları. */
    cashDays: [],
    /** PRD §8 — kritik değişikliklerin kullanıcı ve tarih kaydı. */
    auditLog: [],
  };
}

let cache = null;
let writeQueue = Promise.resolve();

export async function load() {
  if (cache) return cache;
  try {
    const raw = await readFile(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cache = { ...emptyDb(), ...parsed };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Veritabanı okunamadı (${err.message}); boş veritabanı ile başlanıyor.`);
    cache = emptyDb();
  }
  return cache;
}

async function persist(db) {
  await mkdir(dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
  await rename(tmp, DB_PATH);
}

/**
 * Veritabanını güvenli biçimde değiştirir. `mutator(db)` döndürdüğü değer
 * çağırana geri verilir; yazma işlemi sıraya alınır.
 */
export function update(mutator) {
  const run = async () => {
    const db = await load();
    const result = await mutator(db);
    await persist(db);
    return result;
  };
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
}

/** Testler için: belleği ve dosyayı sıfırla. */
export async function resetForTests(initial = emptyDb()) {
  cache = initial;
  await persist(cache);
  return cache;
}

export const dbPath = () => DB_PATH;
