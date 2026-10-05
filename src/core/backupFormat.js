/**
 * Yedek dosyası biçimi — sunucu (Node) ve tarayıcı (Firebase) ortak kullanır.
 *
 * Aynı dosya iki arka uçta da okunup yazılabilir: Node sunucusunda alınan bir
 * yedek cPanel + Firebase kurulumuna, oradaki yedek de Node sunucusuna geri
 * yüklenebilir.
 */

export const BACKUP_FORMAT = 'otel-finans-yedek';

/** Yedeklenen koleksiyonlar. Kullanıcılar da dâhildir (şifreler hash'li saklanır). */
export const BACKUP_COLLECTIONS = [
  'users', 'rooms', 'reservations', 'expenses', 'prices', 'settings',
  'employees', 'extraWorkers', 'suppliers', 'supplierTxns', 'cashDays',
  'restaurantIncomes', 'restaurantExpenses', 'foreignWorkers',
  'purchaseInvoices', 'salesInvoices', 'exchangeRates', 'auditLog',
];

/** Verilen durumdan yedek içeriği üretir. */
export function snapshotOf(db, { version, createdBy = 'sistem', now = new Date() } = {}) {
  const data = {};
  for (const key of BACKUP_COLLECTIONS) data[key] = db[key];
  return {
    format: BACKUP_FORMAT,
    version,
    createdAt: now.toISOString(),
    createdBy,
    counts: Object.fromEntries(BACKUP_COLLECTIONS.map((k) => [k, Array.isArray(db[k]) ? db[k].length : 1])),
    data,
  };
}

/** Yedeği geri yüklemeden önce denetler; boş dizi = sorun yok. */
export function validateBackup(payload, schemaVersion = Infinity) {
  const errors = [];
  if (payload?.format !== BACKUP_FORMAT) errors.push('Bu dosya bir sistem yedeği değil.');
  if (!payload?.data || typeof payload.data !== 'object') errors.push('Yedek içeriği okunamadı.');
  else {
    for (const key of ['rooms', 'expenses', 'settings']) {
      if (payload.data[key] === undefined) errors.push(`Yedekte "${key}" bölümü eksik.`);
    }
    if (Array.isArray(payload.data.users) && payload.data.users.length === 0) {
      errors.push('Yedekte hiç kullanıcı yok; geri yüklenirse sisteme giriş yapılamaz.');
    }
  }
  if (payload?.version > schemaVersion) {
    errors.push(`Yedek daha yeni bir sürümden (${payload.version}); önce uygulamayı güncelleyin.`);
  }
  return errors;
}
