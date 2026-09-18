/**
 * Sistem ve Modül Ayarları (PRD §8).
 * Dağıtım algoritması (A/B/C), hedef marj, kur kaynağı, kategori yöneticisi,
 * kişi başı sarfiyat tarifesi ve veri yönetimi.
 */

import { ALLOCATION_METHODS, CURRENCIES, EXPENSE_GROUPS, FX_SOURCES, TARIFF_BASIS } from '../core/catalog.js';
import { createTariffItem } from '../core/model.js';
import { fetchTcmbRate } from '../core/fx.js';
import { formatDecimal, formatMoney } from '../core/format.js';
import { clear, confirmDialog, errorList, field, h, select, toast } from './dom.js';

export function settingsView(app) {
  const state = app.store.getState();
  const settings = structuredClone(state.settings);
  const errorBox = h('div', { class: 'error-box hidden' });
  const tariffBox = h('div', { class: 'stack tight' });
  const categoryBox = h('div', { class: 'stack tight' });

  const save = () => {
    try {
      app.store.saveSettings(settings);
      toast('Ayarlar kaydedildi.');
      app.refresh();
    } catch (err) {
      clear(errorBox).appendChild(errorList(err.errors ?? [err.message]));
      errorBox.classList.remove('hidden');
    }
  };

  /* --- §8.1 Dağıtım yöntemi --- */
  const methodBox = h('div', { class: 'method-grid' }, ...ALLOCATION_METHODS.map((method) =>
    h('label', { class: `method-card${settings.allocationMethod === method.key ? ' checked' : ''}` },
      h('input', {
        type: 'radio', name: 'allocationMethod', value: method.key,
        checked: settings.allocationMethod === method.key,
        onChange: () => {
          settings.allocationMethod = method.key;
          methodBox.querySelectorAll('.method-card').forEach((el) => el.classList.remove('checked'));
          methodBox.querySelector(`input[value="${method.key}"]`).closest('.method-card').classList.add('checked');
        },
      }),
      h('strong', {}, method.label),
      h('span', { class: 'muted small' }, method.hint))));

  /* --- §8.2 Hedef marj --- */
  const targetValue = h('strong', {}, `%${Math.round((settings.targetMargin ?? 0) * 100)}`);
  const shareValue = h('strong', {}, `%${Math.round((settings.fixedShare ?? 0.25) * 100)}`);

  /* --- §8.2 Kur --- */
  const rateInput = h('input', {
    type: 'number', min: '0', step: '0.01', value: settings.fx.rate,
    onInput: (e) => { settings.fx.rate = Number(e.target.value); },
  });
  const fxStatus = h('span', { class: 'muted small' },
    settings.fx.updatedAt ? `Son güncelleme: ${new Date(settings.fx.updatedAt).toLocaleString('tr-TR')}` : 'Manuel kur kullanılıyor.');

  const fetchRate = async () => {
    fxStatus.textContent = 'TCMB kuru çekiliyor…';
    try {
      const rate = await fetchTcmbRate({ source: settings.fx.source });
      settings.fx.rate = rate;
      rateInput.value = String(rate);
      app.store.saveSettings(settings);
      app.store.recordRate(new Date().toISOString().slice(0, 10), rate);
      fxStatus.textContent = `TCMB kuru alındı: 1 € = ${formatDecimal(rate)} ₺`;
      toast('Kur güncellendi.');
      app.refresh();
    } catch (err) {
      fxStatus.textContent = `Kur çekilemedi (${err.message}). Manuel kur kullanılmaya devam edilecek.`;
      toast('Kur çekilemedi; manuel kur geçerli.', 'warn');
    }
  };

  /* --- §8.3 Kategori yöneticisi --- */
  const renderCategories = () => {
    clear(categoryBox);
    const list = settings.customCategories ?? [];
    if (!list.length) categoryBox.appendChild(h('p', { class: 'muted small' }, 'Henüz özel kategori eklenmedi.'));
    list.forEach((category, index) => {
      categoryBox.appendChild(h('div', { class: 'category-row' },
        h('input', {
          type: 'color', value: category.color, class: 'color-input',
          onInput: (e) => { settings.customCategories[index].color = e.target.value; },
        }),
        h('input', {
          type: 'text', value: category.label, placeholder: 'Kategori adı',
          onInput: (e) => { settings.customCategories[index].label = e.target.value; },
        }),
        select({ onChange: (e) => { settings.customCategories[index].group = e.target.value; } },
          EXPENSE_GROUPS.map((g) => ({ value: g.key, label: g.label })), category.group),
        h('label', { class: 'check-inline small' },
          h('input', {
            type: 'checkbox', checked: category.archived,
            onChange: (e) => { settings.customCategories[index].archived = e.target.checked; },
          }), 'Arşiv'),
        h('button', {
          class: 'icon-btn', type: 'button', title: 'Sil',
          onClick: () => { settings.customCategories.splice(index, 1); renderCategories(); },
        }, '✕')));
    });
  };
  renderCategories();

  /* --- Kişi başı tarife --- */
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

  const dailyGuestTotal = settings.perGuestTariff
    .filter((t) => t.active !== false && t.basis === 'guestNight')
    .reduce((sum, t) => sum + t.amount, 0);

  return h('div', { class: 'stack' },
    h('div', {}, h('h1', {}, 'Ayarlar'),
      h('p', { class: 'muted' }, 'Hesaplama algoritmalarının ve otel dinamiklerinin özelleştirildiği alan.')),
    errorBox,

    h('section', { class: 'card stack' },
      h('h3', {}, 'Genel Gider Dağıtım Yöntemi'),
      h('p', { class: 'muted small' }, 'Elektrik, su, doğalgaz gibi ortak giderlerin odalara nasıl bölüştürüleceğini belirler.'),
      methodBox,
      field('Boş odaların sabit pay oranı',
        h('div', { class: 'row gap center' },
          h('input', {
            type: 'range', min: '0', max: '1', step: '0.05', value: settings.fixedShare, class: 'fixed-share',
            onInput: (e) => { settings.fixedShare = Number(e.target.value); shareValue.textContent = `%${Math.round(settings.fixedShare * 100)}`; },
          }), shareValue),
        '0 = gider yalnızca dolu odalara yansır · 1 = doluluk dikkate alınmaz.')),

    h('section', { class: 'card stack' },
      h('h3', {}, 'Finansal Hedef ve Kur'),
      h('div', { class: 'grid-2' },
        field('Minimum Kâr Marjı Hedefi',
          h('div', { class: 'row gap center' },
            h('input', {
              type: 'range', min: '0', max: '1', step: '0.01', value: settings.targetMargin, class: 'target-margin',
              onInput: (e) => { settings.targetMargin = Number(e.target.value); targetValue.textContent = `%${Math.round(settings.targetMargin * 100)}`; },
            }), targetValue),
          'Gerçekleşen marj bu hedefin altındaysa panelde kırmızı vurgulanır.'),
        field('Görüntüleme Para Birimi',
          select({ onChange: (e) => { settings.displayCurrency = e.target.value; } },
            CURRENCIES.map((c) => ({ value: c.key, label: `${c.symbol} ${c.label}` })), settings.displayCurrency))),
      h('div', { class: 'grid-2' },
        field('Kur Kaynağı', select({ onChange: (e) => { settings.fx.source = e.target.value; } },
          FX_SOURCES.map((f) => ({ value: f.key, label: f.label })), settings.fx.source)),
        field('1 € = ? ₺', rateInput, 'Tutarlar girildikleri para biriminde saklanır; rapor anında bu kurla çevrilir.')),
      h('div', { class: 'row gap center wrap' },
        h('button', { class: 'btn small', type: 'button', onClick: fetchRate }, '🔄 TCMB’den Kuru Çek'),
        fxStatus),
      h('p', { class: 'muted small' },
        'Not: TCMB servisi tarayıcıya CORS başlığı göndermediğinden doğrudan çekim engellenebilir; bu durumda manuel kur geçerli kalır (sunucu tarafı proxy Faz 2 kapsamındadır).')),

    h('section', { class: 'card stack' },
      h('h3', {}, 'Kişi Başı Sarfiyat Tarifesi'),
      h('p', { class: 'muted small' }, 'Her rezervasyon için otomatik maliyet üretir: kalem adı · birim tutar · hesap tabanı.'),
      h('div', { class: 'tariff-head' }, h('span', {}, 'Kalem'), h('span', {}, 'Tutar'), h('span', {}, 'Hesap Tabanı'), h('span', {}, ''), h('span', {}, ''), h('span', {}, '')),
      tariffBox,
      h('button', {
        class: 'btn small ghost', type: 'button',
        onClick: () => { settings.perGuestTariff.push(createTariffItem({ label: '', amount: 0 })); renderTariff(); },
      }, '＋ Kalem Ekle'),
      h('p', { class: 'muted small' }, `Kişi başı günlük sarfiyat: ${formatMoney(dailyGuestTotal)} / kişi / gece.`)),

    h('section', { class: 'card stack' },
      h('h3', {}, 'Kategori Yöneticisi'),
      h('p', { class: 'muted small' }, 'Varsayılan kategorilere ek olarak kendi kalemlerinizi tanımlayın; arşivlenen kategori formlarda görünmez.'),
      categoryBox,
      h('button', {
        class: 'btn small ghost', type: 'button',
        onClick: () => {
          settings.customCategories = [...(settings.customCategories ?? []),
            { key: `cat_${Math.random().toString(16).slice(2, 8)}`, label: '', group: 'variable', color: '#3987e5', allocation: 'general', archived: false }];
          renderCategories();
        },
      }, '＋ Kategori Ekle')),

    h('section', { class: 'card stack' },
      h('h3', {}, 'Veri Yönetimi'),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn primary', type: 'button', onClick: save }, '💾 Ayarları Kaydet'),
        h('button', {
          class: 'btn ghost', type: 'button',
          onClick: () => {
            const blob = new Blob([app.store.exportJSON()], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = h('a', { href: url, download: `gelir-gider-${new Date().toISOString().slice(0, 10)}.json` });
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
          },
        }, '⬇️ Yedek Al (JSON)'),
        h('label', { class: 'btn ghost file-btn' }, '⬆️ Yedekten Yükle',
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
        }, '↺ Demo Verisine Dön'))));
}
