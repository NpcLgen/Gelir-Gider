/**
 * Yedekleme ve Geri Yükleme (admin).
 *
 * Yedekler sunucudaki klasörde tutulur. Bu klasör bir ağ sürücüsüne veya bulut
 * eşitleme klasörüne yönlendirilirse yedekler farklı bilgisayarlardan erişilebilir
 * olur (BACKUP_DIR ortam değişkeni).
 */

import { api } from '../core/api.js';
import { clear, confirmDialog, errorList, field, h, openModal, toast } from './dom.js';

const state = { data: null, loading: false, error: '' };

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

export function backupView(app) {
  const container = h('div', { class: 'stack' });

  const render = () => {
    clear(container);
    container.appendChild(h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Yedekleme ve Geri Yükleme'),
        h('p', { class: 'muted' }, 'Tüm sistem verisinin yedeğini alın, indirin veya bir yedekten geri dönün.')),
      h('div', { class: 'row gap wrap' },
        h('button', {
          class: 'btn', type: 'button',
          onClick: async () => {
            try {
              const name = await api.download('/api/backups/download', {}, 'otel-yedek.json');
              toast(`${name} indirildi.`);
            } catch (err) { toast(err.message, 'error'); }
          },
        }, '⬇️ Anlık Yedeği İndir'),
        h('button', {
          class: 'btn primary backup-now', type: 'button',
          onClick: async () => {
            try {
              const info = await api.post('/api/backups', { reason: 'manuel' });
              toast(`Yedek alındı: ${info.name}`);
              await load();
            } catch (err) { toast(err.message, 'error'); }
          },
        }, '💾 Şimdi Yedek Al'))));

    if (state.loading) {
      container.appendChild(h('div', { class: 'card empty' }, 'Yedekler yükleniyor…'));
      return;
    }
    if (state.error) {
      container.appendChild(h('div', { class: 'error-box' }, state.error));
      return;
    }
    if (!state.data) return;

    const { backups, directory, settings } = state.data;

    container.appendChild(h('div', { class: 'kpi-grid' },
      kpi('Yedek Sayısı', String(backups.length), 'Sunucudaki yedek dosyaları'),
      kpi('Son Yedek', backups[0] ? new Date(backups[0].createdAt).toLocaleString('tr-TR') : '—',
        backups[0] ? formatSize(backups[0].size) : 'Henüz yedek yok',
        backups.length ? '' : 'bad'),
      kpi('Otomatik Yedekleme', settings.autoEnabled === false ? 'Kapalı' : `Her ${settings.intervalHours} saatte`,
        `En fazla ${settings.keep} yedek saklanır`, settings.autoEnabled === false ? 'bad' : 'good')));

    container.appendChild(autoSettingsCard(settings, load));

    container.appendChild(h('section', { class: 'card stack' },
      h('h3', {}, 'Yedek Klasörü'),
      h('code', { class: 'path-box' }, directory),
      h('p', { class: 'muted small' },
        'Bu klasörü bir ağ sürücüsüne veya bulut eşitleme klasörüne (OneDrive, Google Drive, ' +
        'Dropbox, NAS) yönlendirirseniz yedeklere diğer bilgisayarlardan da erişebilirsiniz. ' +
        'Sunucuyu başlatırken BACKUP_DIR ortam değişkenini ayarlayın.'),
      h('pre', { class: 'code-block' },
        'Windows:  set BACKUP_DIR=C:\\Users\\Ad\\OneDrive\\OtelYedek && npm start\n' +
        'Mac/Linux: BACKUP_DIR=~/Dropbox/OtelYedek npm start')));

    container.appendChild(h('section', { class: 'card stack' },
      h('h3', {}, 'Dosyadan Geri Yükle'),
      h('p', { class: 'muted small' },
        'Bilgisayarınızdaki bir yedek dosyasını (.json) yükleyin. Yükleme öncesinde içerik kontrol edilir.'),
      h('label', { class: 'btn file-btn' }, '📂 Yedek Dosyası Seç',
        h('input', {
          type: 'file', accept: 'application/json,.json', hidden: true, class: 'restore-file',
          onChange: async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const payload = JSON.parse(await file.text());
              openRestoreDialog(app, { payload, label: file.name, onDone: load });
            } catch {
              toast('Dosya okunamadı; geçerli bir JSON yedeği seçin.', 'error');
            }
          },
        }))));

    container.appendChild(h('section', { class: 'card table-card' },
      h('header', { class: 'card-header' },
        h('h3', {}, 'Sunucudaki Yedekler'),
        h('span', { class: 'muted small' }, 'En yeniden eskiye')),
      h('table', {},
        h('thead', {}, h('tr', {}, ...['Dosya', 'Tarih', 'Boyut', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...(backups.length
          ? backups.map((backup) => h('tr', {},
            h('td', {}, h('strong', {}, backup.name.replace(/^otel-yedek-/, '').replace(/\.json$/, ''))),
            h('td', {}, new Date(backup.createdAt).toLocaleString('tr-TR')),
            h('td', { class: 'num' }, formatSize(backup.size)),
            h('td', {}, h('div', { class: 'row gap' },
              h('button', {
                class: 'btn small', type: 'button',
                onClick: () => openRestoreDialog(app, { name: backup.name, label: backup.name, onDone: load }),
              }, '↩️ Geri Yükle'),
              h('button', {
                class: 'icon-btn', type: 'button', title: 'İndir',
                onClick: async () => {
                  try {
                    await api.download('/api/backups/download', { name: backup.name }, backup.name);
                    toast('Yedek indirildi.');
                  } catch (err) { toast(err.message, 'error'); }
                },
              }, '⬇️'),
              h('button', {
                class: 'icon-btn', type: 'button', title: 'Sil',
                onClick: () => confirmDialog(`${backup.name} silinsin mi?`, async () => {
                  await api.del(`/api/backups/${encodeURIComponent(backup.name)}`);
                  toast('Yedek silindi.', 'warn');
                  await load();
                }),
              }, '🗑️')))))
          : [h('tr', {}, h('td', { colspan: '4', class: 'empty' }, 'Henüz yedek alınmamış.'))])))));
  };

  const load = async () => {
    state.loading = true;
    state.error = '';
    render();
    try {
      state.data = await api.get('/api/backups');
    } catch (err) {
      state.error = err.message;
    } finally {
      state.loading = false;
      render();
    }
  };

  load();
  return container;
}

function autoSettingsCard(settings, reload) {
  const draft = { ...settings };
  return h('section', { class: 'card stack' },
    h('h3', {}, 'Otomatik Yedekleme'),
    h('p', { class: 'muted small' },
      'Sunucu açılışında ve belirlenen aralıkta otomatik yedek alınır; en eski yedekler silinir.'),
    h('div', { class: 'grid-3' },
      h('label', { class: 'check-inline' },
        h('input', {
          type: 'checkbox', checked: draft.autoEnabled !== false, class: 'auto-backup',
          onChange: (e) => { draft.autoEnabled = e.target.checked; },
        }), 'Otomatik yedekleme açık'),
      field('Aralık (saat)', h('input', {
        type: 'number', min: '1', max: '168', step: '1', value: draft.intervalHours, class: 'backup-interval',
        onInput: (e) => { draft.intervalHours = Number(e.target.value); },
      }), '1–168 saat arası'),
      field('Saklanacak yedek sayısı', h('input', {
        type: 'number', min: '1', max: '200', step: '1', value: draft.keep, class: 'backup-keep',
        onInput: (e) => { draft.keep = Number(e.target.value); },
      }), 'Fazlası otomatik silinir')),
    h('button', {
      class: 'btn primary', type: 'button',
      onClick: async () => {
        try {
          await api.put('/api/backups/settings', draft);
          toast('Yedekleme ayarları kaydedildi.');
          await reload();
        } catch (err) { toast(err.message, 'error'); }
      },
    }, '💾 Yedekleme Ayarlarını Kaydet'));
}

/** Geri yükleme onayı — önce içerik kontrol edilir, sonra onay istenir. */
export function openRestoreDialog(app, { name, payload, label, onDone }) {
  openModal({
    title: 'Yedekten Geri Yükle',
    subtitle: label,
    size: 'md',
    content: (close) => {
      const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Yedek kontrol ediliyor…'));
      const draft = { keepUsers: false };

      (async () => {
        try {
          const check = await api.post('/api/backups/restore', { name, payload, dryRun: true });
          clear(body);
          if (!check.valid) {
            body.appendChild(h('div', { class: 'error-box' }, errorList(check.errors)));
            return;
          }
          const counts = check.counts ?? {};
          body.appendChild(h('div', { class: 'stack' },
            h('div', { class: 'verdict verdict-below' },
              h('strong', {}, '⚠️ Bu işlem mevcut verilerin yerine yedekteki verileri koyar'),
              h('span', { class: 'small' },
                'Geri yükleme öncesinde mevcut durumun güvenlik yedeği otomatik alınır.')),
            h('div', { class: 'kv-list' },
              kv('Yedek tarihi', check.createdAt ? new Date(check.createdAt).toLocaleString('tr-TR') : '—'),
              ...Object.entries(counts)
                .filter(([, value]) => typeof value === 'number' && value > 0)
                .map(([key, value]) => kv(labelOf(key), String(value)))),
            h('label', { class: 'check-inline' },
              h('input', {
                type: 'checkbox', class: 'keep-users',
                onChange: (e) => { draft.keepUsers = e.target.checked; },
              }), 'Mevcut kullanıcı hesaplarını koru (yedekteki kullanıcıları yükleme)'),
            h('div', { class: 'row end gap' },
              h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
              h('button', {
                class: 'btn danger restore-confirm', type: 'button',
                onClick: async () => {
                  try {
                    const result = await api.post('/api/backups/restore', { name, payload, keepUsers: draft.keepUsers });
                    toast(`Geri yükleme tamamlandı. Güvenlik yedeği: ${result.safety.name}`);
                    close();
                    await app.store.reload();
                    await onDone?.();
                    app.refresh();
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              }, '↩️ Geri Yüklemeyi Onayla'))));
        } catch (err) {
          clear(body).appendChild(h('div', { class: 'error-box' }, err.message));
        }
      })();

      return body;
    },
  });
}

const labelOf = (key) => ({
  users: 'Kullanıcı', rooms: 'Oda', reservations: 'Rezervasyon', expenses: 'Gider',
  employees: 'Personel', extraWorkers: 'Ekstra çalışan', suppliers: 'Toptancı',
  supplierTxns: 'Cari hareket', cashDays: 'Gün sonu', restaurantIncomes: 'Restoran geliri',
  restaurantExpenses: 'Restoran gideri', foreignWorkers: 'Yabancı çalışan', auditLog: 'İşlem kaydı',
}[key] ?? key);

function kpi(label, value, hint, tone) {
  return h('div', { class: 'card kpi' },
    h('span', { class: 'muted small' }, label),
    h('strong', { class: tone || '' }, value),
    h('span', { class: 'muted small' }, hint));
}

const kv = (label, value) => h('div', { class: 'kv' }, h('span', {}, label), h('strong', {}, value));
