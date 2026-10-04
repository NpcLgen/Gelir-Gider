/**
 * Ayarlar (PRD v2 §5.1) — mantıksal kategorilere ayrılmış sekmeli arayüz.
 *
 * Her sekme kendi kartlarını gösterir; kaydedilmemiş değişiklik varsa kullanıcı
 * sekme değiştirirken veya sayfadan çıkarken uyarılır.
 */

import {
  ALLOCATION_METHODS, CURRENCIES, EXPENSE_CATEGORIES, EXPENSE_GROUPS, TARIFF_BASIS,
  UTILITY_KINDS, UTILITY_LABELS,
} from '../core/catalog.js';
import { defaultTaxRates } from '../core/finance.js';
import { createTariffItem } from '../core/model.js';
import { formatDecimal, formatMoney } from '../core/format.js';
import { api } from '../core/api.js';
import { clear, errorList, field, h, openModal, select, toast } from './dom.js';

const TABS = [
  { key: 'genel', label: 'Genel Ayarlar', icon: '⚙️' },
  { key: 'vergi', label: 'Vergi ve Finans', icon: '🧮' },
  { key: 'kur', label: 'Döviz Kuru', icon: '💱' },
  { key: 'guvenlik', label: 'Kullanıcı ve Güvenlik', icon: '🔐' },
  { key: 'gorunum', label: 'Görünüm ve Arayüz', icon: '🎨' },
];

let activeTab = 'genel';

export function settingsView(app) {
  const state = app.store.getState();
  const settings = structuredClone(state.settings);
  settings.tax = { ...defaultTaxRates(), ...(settings.tax ?? {}) };
  let dirty = false;

  const errorBox = h('div', { class: 'error-box hidden' });
  const body = h('div', { class: 'stack' });
  const dirtyBadge = h('span', { class: 'dirty-badge hidden' }, '● Kaydedilmemiş değişiklik');

  const markDirty = () => {
    dirty = true;
    dirtyBadge.classList.remove('hidden');
  };

  const save = async () => {
    clear(errorBox).classList.add('hidden');
    try {
      await app.store.saveSettings(settings);
      dirty = false;
      dirtyBadge.classList.add('hidden');
      toast('Ayarlar kaydedildi.');
      app.refresh();
    } catch (err) {
      clear(errorBox).appendChild(errorList(err.errors ?? [err.message]));
      errorBox.classList.remove('hidden');
    }
  };

  const discard = () => {
    if (!dirty || window.confirm('Kaydedilmemiş değişiklikler iptal edilsin mi?')) {
      dirty = false;
      app.refresh();
    }
  };

  const switchTab = (key) => {
    if (dirty && !window.confirm('Kaydedilmemiş değişiklikleriniz var. Sekmeyi değiştirirseniz kaybolacak. Devam edilsin mi?')) return;
    activeTab = key;
    dirty = false;
    app.refresh();
  };

  const renderers = {
    genel: () => generalTab(app, settings, markDirty),
    vergi: () => taxTab(app, settings, markDirty),
    kur: () => fxTab(app, settings, markDirty),
    guvenlik: () => securityTab(app, state),
    gorunum: () => appearanceTab(app, settings, markDirty),
  };
  clear(body).appendChild(renderers[activeTab]());

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Ayarlar'),
        h('p', { class: 'muted' }, 'Hesaplama kurallarının ve otel dinamiklerinin özelleştirildiği alan.')),
      h('div', { class: 'row gap center' }, dirtyBadge,
        h('button', { class: 'btn ghost', type: 'button', onClick: discard }, 'İptal'),
        h('button', { class: 'btn primary', type: 'button', onClick: save }, '💾 Kaydet'))),

    h('div', { class: 'settings-tabs' }, ...TABS.map((tab) => h('button', {
      class: `settings-tab${activeTab === tab.key ? ' active' : ''}`,
      type: 'button',
      onClick: () => switchTab(tab.key),
    }, h('span', {}, tab.icon), tab.label))),

    errorBox,
    body);
}

const card = (title, hint, ...children) => h('section', { class: 'card stack' },
  h('h3', {}, title),
  hint ? h('p', { class: 'muted small' }, hint) : null,
  ...children);

/* ------------------------------------------------------- Genel Ayarlar -- */

function generalTab(app, settings, markDirty) {
  const shareValue = h('strong', {}, `%${Math.round((settings.fixedShare ?? 0.25) * 100)}`);

  const methodBox = h('div', { class: 'method-grid' }, ...ALLOCATION_METHODS.map((method) =>
    h('label', { class: `method-card${settings.allocationMethod === method.key ? ' checked' : ''}` },
      h('input', {
        type: 'radio', name: 'allocationMethod', value: method.key,
        checked: settings.allocationMethod === method.key,
        onChange: () => {
          settings.allocationMethod = method.key;
          methodBox.querySelectorAll('.method-card').forEach((el) => el.classList.remove('checked'));
          methodBox.querySelector(`input[value="${method.key}"]`).closest('.method-card').classList.add('checked');
          markDirty();
        },
      }),
      h('strong', {}, method.label),
      h('span', { class: 'muted small' }, method.hint))));

  return h('div', { class: 'stack' },
    card('Genel Gider Dağıtım Yöntemi',
      'Elektrik, su, doğalgaz gibi ortak giderlerin odalara nasıl bölüştürüleceğini belirler.',
      methodBox,
      field('Boş odaların sabit pay oranı',
        h('div', { class: 'row gap center' },
          h('input', {
            type: 'range', min: '0', max: '1', step: '0.05', value: settings.fixedShare, class: 'fixed-share',
            onInput: (e) => {
              settings.fixedShare = Number(e.target.value);
              shareValue.textContent = `%${Math.round(settings.fixedShare * 100)}`;
              markDirty();
            },
          }), shareValue),
        '0 = gider yalnızca dolu odalara yansır · 1 = doluluk dikkate alınmaz.')),

    card('Kişi Başı Sarfiyat Tarifesi',
      'Her rezervasyon için otomatik maliyet üretir: kalem adı · birim tutar · hesap tabanı.',
      tariffEditor(settings, markDirty)),

    card('Dönemsel Fatura Kalemleri',
      'Her ayın başında burada tanımlı kalemler 0 TL olarak otomatik açılır; fatura gelince tutarı güncellersiniz.',
      billsEditor(app, settings)));
}

function tariffEditor(settings, markDirty) {
  const box = h('div', { class: 'stack tight' });
  const render = () => {
    clear(box);
    settings.perGuestTariff.forEach((item, index) => {
      box.appendChild(h('div', { class: 'tariff-row' },
        h('input', {
          type: 'text', value: item.label, placeholder: 'Kahvaltı',
          onInput: (e) => { settings.perGuestTariff[index].label = e.target.value; markDirty(); },
        }),
        h('input', {
          type: 'number', min: '0', step: 'any', value: item.amount, class: 'count',
          onInput: (e) => { settings.perGuestTariff[index].amount = Number(e.target.value); markDirty(); },
        }),
        select({ onChange: (e) => { settings.perGuestTariff[index].basis = e.target.value; markDirty(); } },
          TARIFF_BASIS.map((b) => ({ value: b.key, label: b.label })), item.basis),
        h('label', { class: 'check-inline small' },
          h('input', {
            type: 'checkbox', checked: item.requiresBreakfast,
            onChange: (e) => { settings.perGuestTariff[index].requiresBreakfast = e.target.checked; markDirty(); },
          }), 'Kahvaltı dahil ise'),
        h('label', { class: 'check-inline small' },
          h('input', {
            type: 'checkbox', checked: item.active !== false,
            onChange: (e) => { settings.perGuestTariff[index].active = e.target.checked; markDirty(); },
          }), 'Aktif'),
        h('button', {
          class: 'icon-btn', type: 'button', title: 'Kaldır',
          onClick: () => { settings.perGuestTariff.splice(index, 1); markDirty(); render(); },
        }, '✕')));
    });
  };
  render();

  const daily = () => settings.perGuestTariff
    .filter((t) => t.active !== false && t.basis === 'guestNight')
    .reduce((sum, t) => sum + t.amount, 0);

  return h('div', { class: 'stack tight' },
    h('div', { class: 'tariff-head' },
      h('span', {}, 'Kalem'), h('span', {}, 'Tutar'), h('span', {}, 'Hesap Tabanı'),
      h('span', {}, ''), h('span', {}, ''), h('span', {}, '')),
    box,
    h('button', {
      class: 'btn small ghost', type: 'button',
      onClick: () => { settings.perGuestTariff.push(createTariffItem({ label: '', amount: 0 })); markDirty(); render(); },
    }, '＋ Kalem Ekle'),
    h('p', { class: 'muted small' }, `Kişi başı günlük sarfiyat: ${formatMoney(daily())} / kişi / gece.`));
}

function billsEditor(app, settings) {
  const bills = [...(settings.bills ?? [])];
  const box = h('div', { class: 'stack tight' });

  const render = () => {
    clear(box);
    if (!bills.length) box.appendChild(h('p', { class: 'muted small' }, 'Tanımlı fatura kalemi yok.'));
    bills.forEach((bill, index) => {
      box.appendChild(h('div', { class: 'bill-row' },
        h('input', {
          type: 'text', value: bill.label, placeholder: 'Elektrik faturası',
          onInput: (e) => { bills[index].label = e.target.value; },
        }),
        select({ onChange: (e) => { bills[index].category = e.target.value; } },
          EXPENSE_CATEGORIES.map((c) => ({ value: c.key, label: c.label })), bill.category),
        select({ onChange: (e) => { bills[index].weightKind = e.target.value; } },
          UTILITY_KINDS.map((k) => ({ value: k, label: UTILITY_LABELS[k] })), bill.weightKind),
        h('label', { class: 'check-inline small' },
          h('input', {
            type: 'checkbox', checked: bill.active !== false,
            onChange: (e) => { bills[index].active = e.target.checked; },
          }), 'Aktif'),
        h('button', {
          class: 'icon-btn', type: 'button', title: 'Kaldır',
          onClick: () => { bills.splice(index, 1); render(); },
        }, '✕')));
    });
  };
  render();

  return h('div', { class: 'stack tight' },
    h('div', { class: 'bill-head' },
      h('span', {}, 'Fatura Adı'), h('span', {}, 'Kategori'), h('span', {}, 'Gider Türü'), h('span', {}, ''), h('span', {}, '')),
    box,
    h('div', { class: 'row gap' },
      h('button', {
        class: 'btn small ghost', type: 'button',
        onClick: () => {
          bills.push({
            key: `bill_${Math.random().toString(16).slice(2, 8)}`,
            label: '', category: 'utility_electricity', allocation: 'weighted',
            weightKind: 'electricity', active: true,
          });
          render();
        },
      }, '＋ Fatura Kalemi Ekle'),
      h('button', {
        class: 'btn small primary', type: 'button',
        onClick: async () => {
          await app.store.saveBills(bills.filter((b) => b.label.trim()));
          toast('Fatura kalemleri kaydedildi.');
          app.refresh();
        },
      }, '💾 Fatura Kalemlerini Kaydet')));
}

/* --------------------------------------------------- Vergi ve Finans ---- */

function taxTab(app, settings, markDirty) {
  const targetValue = h('strong', {}, `%${Math.round((settings.targetMargin ?? 0) * 100)}`);
  const plannedValue = h('strong', {}, `%${Math.round((settings.plannedOccupancy ?? 0.6) * 100)}`);

  const rateInputs = [
    ['kdvIncome', 'Konaklama KDV Oranı (%)', 'Oda gelirlerinde hesaplanan KDV.'],
    ['kdvRestaurant', 'Restoran / Yiyecek-İçecek KDV (%)', 'Restoran gelirlerinde hesaplanan KDV.'],
    ['kdvExpense', 'Gider KDV Oranı (%)', 'Belgeli giderlerde indirilecek KDV.'],
    ['accommodationTax', 'Konaklama Vergisi (%)', 'KDV hariç konaklama geliri üzerinden.'],
    ['tourismShare', 'Turizm Payı (%)', 'KDV hariç konaklama geliri üzerinden.'],
    ['incomeTax', 'Gelir / Kurumlar Vergisi (%)', 'Net kâr üzerinden.'],
  ];

  return h('div', { class: 'stack' },
    card('Vergi Oranları',
      'Oranlar sabit kodlanmamıştır; mevzuat değiştiğinde buradan güncellenir. Canlı kullanımdan önce mali müşavirinize doğrulatın.',
      h('div', { class: 'grid-3' }, ...rateInputs.map(([key, label, hint]) =>
        field(label, h('input', {
          type: 'number', min: '0', max: '100', step: 'any', value: settings.tax[key] ?? 0, class: `tax-${key}`,
          onInput: (e) => { settings.tax[key] = Number(e.target.value); markDirty(); },
        }), hint))),
      h('label', { class: 'check-inline' },
        h('input', {
          type: 'checkbox', checked: settings.tax.foreignStaffDeductible === true, class: 'tax-foreign',
          onChange: (e) => { settings.tax.foreignStaffDeductible = e.target.checked; markDirty(); },
        }), 'Yabancı çalışan maaşları vergi matrahından indirilebilir sayılsın'),
      h('p', { class: 'muted small' },
        'Varsayılan olarak kapalıdır: yabancı çalışan maaşları gidere dahil edilir ama indirilebilir gider sayılmaz (PRD v2 §3.1).')),

    card('Finansal Hedefler',
      'Dashboard renklendirmesi ve fiyat tavsiyesi bu değerlere göre hesaplanır.',
      h('div', { class: 'grid-2' },
        field('Minimum Kâr Marjı Hedefi',
          h('div', { class: 'row gap center' },
            h('input', {
              type: 'range', min: '0', max: '1', step: '0.01', value: settings.targetMargin, class: 'target-margin',
              onInput: (e) => {
                settings.targetMargin = Number(e.target.value);
                targetValue.textContent = `%${Math.round(settings.targetMargin * 100)}`;
                markDirty();
              },
            }), targetValue),
          'Gerçekleşen marj hedefin altındaysa panelde kırmızı vurgulanır.'),
        field('Planlanan Doluluk (fiyat tavsiyesi için)',
          h('div', { class: 'row gap center' },
            h('input', {
              type: 'range', min: '0.1', max: '1', step: '0.05', value: settings.plannedOccupancy ?? 0.6,
              class: 'planned-occupancy',
              onInput: (e) => {
                settings.plannedOccupancy = Number(e.target.value);
                plannedValue.textContent = `%${Math.round(settings.plannedOccupancy * 100)}`;
                markDirty();
              },
            }), plannedValue),
          'Sabit giderler bu doluluğa bölünerek odanın başa baş gecelik fiyatı bulunur.'))),

    card('Kategori Yöneticisi',
      'Varsayılan kategorilere ek kalemler tanımlayın; arşivlenen kategori formlarda görünmez.',
      categoryEditor(settings, markDirty)));
}

function categoryEditor(settings, markDirty) {
  const box = h('div', { class: 'stack tight' });
  const render = () => {
    clear(box);
    const list = settings.customCategories ?? [];
    if (!list.length) box.appendChild(h('p', { class: 'muted small' }, 'Henüz özel kategori eklenmedi.'));
    list.forEach((category, index) => {
      box.appendChild(h('div', { class: 'category-row' },
        h('input', {
          type: 'color', value: category.color, class: 'color-input',
          onInput: (e) => { settings.customCategories[index].color = e.target.value; markDirty(); },
        }),
        h('input', {
          type: 'text', value: category.label, placeholder: 'Kategori adı',
          onInput: (e) => { settings.customCategories[index].label = e.target.value; markDirty(); },
        }),
        select({ onChange: (e) => { settings.customCategories[index].group = e.target.value; markDirty(); } },
          EXPENSE_GROUPS.map((g) => ({ value: g.key, label: g.label })), category.group),
        h('label', { class: 'check-inline small' },
          h('input', {
            type: 'checkbox', checked: category.archived,
            onChange: (e) => { settings.customCategories[index].archived = e.target.checked; markDirty(); },
          }), 'Arşiv'),
        h('button', {
          class: 'icon-btn', type: 'button', title: 'Sil',
          onClick: () => { settings.customCategories.splice(index, 1); markDirty(); render(); },
        }, '✕')));
    });
  };
  render();

  return h('div', { class: 'stack tight' }, box,
    h('button', {
      class: 'btn small ghost', type: 'button',
      onClick: () => {
        settings.customCategories = [...(settings.customCategories ?? []),
          { key: `cat_${Math.random().toString(16).slice(2, 8)}`, label: '', group: 'variable', color: '#3987e5', allocation: 'general', archived: false }];
        markDirty();
        render();
      },
    }, '＋ Kategori Ekle'));
}

/* ------------------------------------------------------- Döviz Kuru ----- */

function fxTab(app, settings, markDirty) {
  const fx = settings.fx ?? {};
  const status = h('div', { class: 'fx-status' });
  const rateInput = h('input', {
    type: 'number', min: '0', step: 'any', value: fx.rate, class: 'fx-rate',
    onInput: (e) => { settings.fx.rate = Number(e.target.value); markDirty(); },
  });

  const renderStatus = (current = settings.fx) => {
    clear(status);
    const updated = current.updatedAt ? new Date(current.updatedAt).toLocaleString('tr-TR') : null;
    status.appendChild(h('div', { class: 'kv-list' },
      kv('Güncel kur', `1 € = ${formatDecimal(current.rate ?? 0)} ₺`),
      kv('Kaynak', current.providerLabel || 'Manuel giriş'),
      kv('Kaynak tarihi', current.sourceDate || '—'),
      kv('Son güncelleme', updated || 'Henüz güncellenmedi')));
    if (current.lastError) {
      status.appendChild(h('div', { class: 'verdict verdict-below' },
        h('strong', {}, '⚠️ Son güncelleme başarısız'),
        h('span', { class: 'small' }, current.lastError)));
    }
  };
  renderStatus();

  const refresh = async () => {
    const button = status.parentElement?.querySelector('.fx-refresh');
    if (button) { button.disabled = true; button.textContent = '⏳ Kur çekiliyor…'; }
    try {
      const updated = await app.store.refreshFx('EUR', settings.fx.source);
      settings.fx = { ...settings.fx, ...updated };
      rateInput.value = String(updated.rate);
      renderStatus(updated);
      toast(`Kur güncellendi: 1 € = ${formatDecimal(updated.rate)} ₺`);
    } catch (err) {
      // Başarısız güncellemede mevcut kur korunur.
      settings.fx.lastError = err.message;
      renderStatus(settings.fx);
      toast('Kur güncellenemedi; mevcut kur korundu.', 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = '🔄 Kuru Şimdi Güncelle'; }
    }
  };

  const historyRows = Object.entries(fx.history ?? {})
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 10);

  return h('div', { class: 'stack' },
    card('Kur Durumu', 'Kur sunucu üzerinden çekilir; tarayıcı kısıtlamaları güncellemeyi engellemez.',
      status,
      h('div', { class: 'row gap wrap center' },
        h('button', { class: 'btn primary fx-refresh', type: 'button', onClick: refresh }, '🔄 Kuru Şimdi Güncelle'),
        h('span', { class: 'muted small' }, 'Güncelleme başarısız olursa son geçerli kur korunur.'))),

    card('Kur Kaynağı ve Manuel Değer', 'Otomatik güncelleme çalışmazsa kuru elle girebilirsiniz.',
      h('div', { class: 'grid-2' },
        field('Tercih edilen kaynak',
          select({
            class: 'fx-source',
            onChange: (e) => { settings.fx.source = e.target.value; markDirty(); },
          }, [
            { value: 'tcmb', label: 'TCMB Efektif Satış' },
            { value: 'tcmb_buy', label: 'TCMB Döviz Alış' },
            { value: 'frankfurter', label: 'Frankfurter (ECB)' },
            { value: 'manual', label: 'Sabit Kur (yalnızca manuel)' },
          ], settings.fx.source ?? 'tcmb'),
          'Seçilen kaynak başarısız olursa diğerleri sırayla denenir.'),
        field('1 € = ? ₺', rateInput,
          'Tutarlar girildikleri para biriminde saklanır; rapor anında bu kurla çevrilir.'))),

    card('Kur Geçmişi', 'Geçmiş dönem raporları o güne ait kurla hesaplanır.',
      historyRows.length
        ? h('table', { class: 'mini-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Tarih'), h('th', { class: 'num' }, '1 € karşılığı'))),
          h('tbody', {}, ...historyRows.map(([date, rate]) => h('tr', {},
            h('td', {}, date), h('td', { class: 'num' }, `${formatDecimal(rate)} ₺`)))))
        : h('p', { class: 'muted small' }, 'Henüz kur geçmişi yok.')));
}

/* ------------------------------------------- Kullanıcı ve Güvenlik ------ */

function securityTab(app, state) {
  const me = state.me;
  const admin = Boolean(me?.isAdmin);

  return h('div', { class: 'stack' },
    card('Oturum Bilgisi', null,
      h('div', { class: 'kv-list' },
        kv('Kullanıcı', `${me?.displayName ?? ''} (@${me?.username ?? ''})`),
        kv('Rol', admin ? 'Admin — tüm yetkiler' : 'Kullanıcı'),
        kv('Son giriş', me?.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString('tr-TR') : '—'))),

    admin
      ? card('Kullanıcı Yönetimi', 'Kullanıcı oluşturma, yetkilendirme ve işlem kayıtları ayrı bir sayfada yönetilir.',
        h('button', {
          class: 'btn', type: 'button',
          onClick: () => app.go('kullanicilar'),
        }, '👥 Kullanıcı ve Yetki Yönetimine Git'))
      : h('p', { class: 'muted small' }, 'Kullanıcı yönetimi yalnızca Admin yetkisiyle görülebilir.'),

    admin
      ? card('Yedekleme ve Geri Yükleme', 'Tüm sistem verisinin yedeğini alın veya bir yedekten geri yükleyin.',
        h('button', {
          class: 'btn', type: 'button',
          onClick: () => app.go('yedekleme'),
        }, '💾 Yedekleme Paneline Git'))
      : null);
}

/* ---------------------------------------------- Görünüm ve Arayüz ------- */

function appearanceTab(app, settings, markDirty) {
  return h('div', { class: 'stack' },
    card('Para Birimi ve Biçim', 'Raporların varsayılan görüntüleme para birimi.',
      field('Görüntüleme Para Birimi',
        select({
          class: 'display-currency',
          onChange: (e) => { settings.displayCurrency = e.target.value; markDirty(); },
        }, CURRENCIES.map((c) => ({ value: c.key, label: `${c.symbol} ${c.label}` })), settings.displayCurrency),
        'Tutarlar her zaman TL olarak saklanır; bu seçim yalnızca gösterimi değiştirir.')),

    card('Menü ve Gezinme', null,
      h('p', { class: 'muted small' },
        'Sol menüde aynı anda tek bir ana kategori açık kalır. Bir kategoriye tıkladığınızda ' +
        'diğerleri otomatik kapanır; giriş sonrası Dashboard açılır.'),
      h('button', {
        class: 'btn small ghost', type: 'button',
        onClick: () => {
          try {
            localStorage.removeItem('otel:acik-menu-grubu');
            toast('Menü tercihleri sıfırlandı.');
          } catch {
            toast('Tercih sıfırlanamadı.', 'error');
          }
        },
      }, '↺ Menü Tercihlerini Sıfırla')),

    card('Veri ve Demo', null,
      h('div', { class: 'row gap wrap' },
        h('button', {
          class: 'btn ghost', type: 'button',
          onClick: () => {
            const blob = new Blob([app.store.exportJSON()], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = h('a', { href: url, download: `otel-finans-${new Date().toISOString().slice(0, 10)}.json` });
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
            toast('Görünen veriler indirildi.');
          },
        }, '⬇️ Ekrandaki Veriyi İndir'),
        app.me()?.isAdmin ? h('button', {
          class: 'btn ghost demo-btn', type: 'button',
          onClick: async () => {
            const sure = window.confirm(
              'DİKKAT: Demo verisi yüklenecek.\n\nMevcut oda, rezervasyon, fiyat, gider, personel, toptancı ve kasa kayıtlarının TAMAMI silinip örnek verilerle değiştirilecek. Kullanıcı hesapları korunur.\n\nDevam edilsin mi?',
            );
            if (!sure) return;
            const result = await app.store.loadDemoData();
            toast(`Demo verisi yüklendi: ${result.rooms} oda, ${result.reservations} rezervasyon.`);
            app.refresh();
          },
        }, '🧪 Demo Verisi Yükle') : null)));
}

const kv = (label, value) => h('div', { class: 'kv' }, h('span', {}, label), h('strong', {}, value));
