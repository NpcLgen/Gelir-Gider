/** Ayarlar — kişi başı sarfiyat tarifesi ve genel gider dağıtım parametreleri. */

import { TARIFF_BASIS } from '../core/catalog.js';
import { createTariffItem } from '../core/model.js';
import { formatMoney } from '../core/format.js';
import { clear, confirmDialog, errorList, field, h, select, toast } from './dom.js';

export function settingsView(app) {
  const settings = structuredClone(app.store.getState().settings);
  const errorBox = h('div', { class: 'error-box hidden' });
  const tariffBox = h('div', { class: 'stack tight' });

  const renderTariff = () => {
    clear(tariffBox);
    settings.perGuestTariff.forEach((item, index) => {
      tariffBox.appendChild(h('div', { class: 'tariff-row' },
        h('input', {
          type: 'text', value: item.label, placeholder: 'Kahvaltı',
          onInput: (e) => { settings.perGuestTariff[index].label = e.target.value; },
        }),
        h('input', {
          type: 'number', min: '0', step: '1', value: item.amount, class: 'count',
          onInput: (e) => { settings.perGuestTariff[index].amount = Number(e.target.value); },
        }),
        select({ onChange: (e) => { settings.perGuestTariff[index].basis = e.target.value; } },
          TARIFF_BASIS.map((b) => ({ value: b.key, label: b.label })), item.basis),
        h('label', { class: 'check-inline small' },
          h('input', {
            type: 'checkbox', checked: item.requiresBreakfast,
            onChange: (e) => { settings.perGuestTariff[index].requiresBreakfast = e.target.checked; },
          }), 'Kahvaltı dahil ise'),
        h('label', { class: 'check-inline small' },
          h('input', {
            type: 'checkbox', checked: item.active !== false,
            onChange: (e) => { settings.perGuestTariff[index].active = e.target.checked; },
          }), 'Aktif'),
        h('button', {
          class: 'icon-btn', type: 'button', title: 'Kaldır',
          onClick: () => { settings.perGuestTariff.splice(index, 1); renderTariff(); },
        }, '✕')));
    });
  };
  renderTariff();

  const shareValue = h('strong', {}, `%${Math.round((settings.fixedShare ?? 0.25) * 100)}`);

  return h('div', { class: 'stack' },
    h('div', {}, h('h1', {}, 'Ayarlar'),
      h('p', { class: 'muted' }, 'Kişi başı maliyet algoritmasının ve genel gider dağıtımının parametreleri.')),
    errorBox,
    h('section', { class: 'card stack' },
      h('h3', {}, 'Kişi Başı Sarfiyat Tarifesi'),
      h('p', { class: 'muted small' }, 'Her rezervasyon için otomatik maliyet üretir: kalem adı · birim tutar · hesap tabanı.'),
      h('div', { class: 'tariff-head' }, h('span', {}, 'Kalem'), h('span', {}, 'Tutar'), h('span', {}, 'Hesap Tabanı'), h('span', {}, ''), h('span', {}, ''), h('span', {}, '')),
      tariffBox,
      h('button', {
        class: 'btn small ghost', type: 'button',
        onClick: () => { settings.perGuestTariff.push(createTariffItem({ label: '', amount: 0 })); renderTariff(); },
      }, '＋ Kalem Ekle')),
    h('section', { class: 'card stack' },
      h('h3', {}, 'Genel Gider Dağıtımı'),
      field('Boş odaların sabit pay oranı',
        h('div', { class: 'row gap center' },
          h('input', {
            type: 'range', min: '0', max: '1', step: '0.05', value: settings.fixedShare,
            onInput: (e) => { settings.fixedShare = Number(e.target.value); shareValue.textContent = `%${Math.round(settings.fixedShare * 100)}`; },
          }), shareValue),
        '0 = gider yalnızca dolu odalara yansır · 1 = doluluk dikkate alınmaz, yalnızca demirbaş katsayısı kullanılır.')),
    h('div', { class: 'row gap' },
      h('button', {
        class: 'btn primary', type: 'button',
        onClick: () => {
          try {
            app.store.saveSettings(settings);
            toast('Ayarlar kaydedildi.');
            app.refresh();
          } catch (err) {
            clear(errorBox).appendChild(errorList(err.errors ?? [err.message]));
            errorBox.classList.remove('hidden');
          }
        },
      }, '💾 Kaydet'),
      h('button', {
        class: 'btn ghost', type: 'button',
        onClick: () => {
          const blob = new Blob([app.store.exportJSON()], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = h('a', { href: url, download: `gelir-gider-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
        },
      }, '⬇️ Verileri Dışa Aktar'),
      h('label', { class: 'btn ghost file-btn' }, '⬆️ İçe Aktar',
        h('input', {
          type: 'file', accept: 'application/json', hidden: true,
          onChange: async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              app.store.importJSON(await file.text());
              toast('Veriler içe aktarıldı.');
              app.refresh();
            } catch {
              toast('Dosya okunamadı.', 'error');
            }
          },
        })),
      h('button', {
        class: 'btn danger ghost', type: 'button',
        onClick: () => confirmDialog('Tüm veriler demo setine sıfırlansın mı?', () => {
          app.store.reset({ withSeed: true }); app.refresh(); toast('Demo verisi yüklendi.', 'warn');
        }),
      }, '↺ Demo Verisine Dön')),
    h('p', { class: 'muted small' }, `Örnek: 2 kişilik bir oda tam dolu iken günlük kişi başı sarfiyat ${formatMoney(
      settings.perGuestTariff.filter((t) => t.active !== false && t.basis === 'guestNight').reduce((s, t) => s + t.amount, 0) * 2,
    )}.`));
}
