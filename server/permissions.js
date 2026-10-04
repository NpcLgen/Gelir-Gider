/**
 * Modül bazlı yetkilendirme (PRD §6.2).
 * Menü, bu listeden ve kullanıcının izinlerinden dinamik olarak kurulur.
 */

export const MODULES = [
  { key: 'dashboard', label: 'Dashboard', group: 'Genel' },
  { key: 'gelirler', label: 'Gelirler (Giden Faturalar)', group: 'Genel' },
  { key: 'rezervasyonlar', label: 'Rezervasyonlar', group: 'Genel' },
  { key: 'fiyatGirisi', label: 'Fiyat Girişi', group: 'Genel' },
  { key: 'odalar', label: 'Oda Ayarları', group: 'Genel' },

  { key: 'giderler', label: 'Giderler', group: 'Giderler' },
  { key: 'calisanlar', label: 'Çalışanlar', group: 'Giderler' },
  { key: 'ekstraCalisan', label: 'Ekstra Çalışan', group: 'Giderler' },
  { key: 'yabanciCalisanlar', label: 'Yabancı Çalışanlar', group: 'Giderler' },
  { key: 'genelHarcamalar', label: 'Genel Harcamalar', group: 'Giderler' },
  { key: 'giderFaturalari', label: 'Gider Faturaları (Gelen)', group: 'Giderler' },
  { key: 'vergiler', label: 'Vergiler', group: 'Giderler' },

  { key: 'restoran', label: 'Restoran', group: 'Restoran' },
  { key: 'restoranGelir', label: 'Restoran Gelirleri', group: 'Restoran' },
  { key: 'restoranGider', label: 'Restoran Ekstra Giderler', group: 'Restoran' },
  { key: 'toptancilar', label: 'Toptancılar', group: 'Restoran' },

  { key: 'kasa', label: 'Kasa / Gün Sonu', group: 'Kasa' },

  { key: 'finansalRaporlar', label: 'Finansal Raporlar', group: 'Raporlar' },
  { key: 'excelIceAktarim', label: 'Excel İçe Aktarım', group: 'Raporlar' },
  { key: 'excelDisaAktarim', label: 'Excel Dışa Aktarım', group: 'Raporlar' },
  { key: 'yazdirma', label: 'Yazdırma', group: 'Raporlar' },

  { key: 'ayarlar', label: 'Ayarlar', group: 'Yönetim' },
  { key: 'kullaniciYonetimi', label: 'Kullanıcı Yönetimi', group: 'Yönetim' },
  { key: 'yedekleme', label: 'Yedekleme ve Geri Yükleme', group: 'Yönetim' },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);

/** Yeni kullanıcı için varsayılan izinler (tamamı kapalı). */
export const emptyPermissions = () => Object.fromEntries(MODULE_KEYS.map((k) => [k, false]));

/** Admin tüm modüllere erişir. */
export const allPermissions = () => Object.fromEntries(MODULE_KEYS.map((k) => [k, true]));

export function normalizePermissions(permissions) {
  const base = emptyPermissions();
  for (const key of MODULE_KEYS) base[key] = Boolean(permissions?.[key]);
  return base;
}

/** Admin her modüle erişir; diğer kullanıcılar yalnızca açık modüllere. */
export function can(user, moduleKey) {
  if (!user || user.active === false) return false;
  if (user.isAdmin) return true;
  return Boolean(user.permissions?.[moduleKey]);
}
