/**
 * Uygulama kabuğu (PRD §1.1, §4, §9).
 *
 * Açılışta oturum kontrol edilir: oturum yoksa giriş ekranı zorunludur.
 * Menü, kullanıcının modül yetkilerinden dinamik olarak kurulur; yetkisiz
 * sayfaya adres çubuğundan gidilse bile erişim engellenir.
 */

import { CURRENCIES, QUICK_RANGES } from '../core/catalog.js';
import { buildReport } from '../core/costEngine.js';
import { monthPeriod, period as makePeriod, quickRange, shiftMonth } from '../core/dates.js';
import { createPresenter } from '../core/format.js';
import { api, setUnauthorizedHandler } from '../core/api.js';
import { createStore } from '../core/store.js';
import { calendarView, openBulkEditor } from './calendarView.js';
import { cashView } from './cashView.js';
import { dashboardView } from './dashboardView.js';
import { append, clear, h, toast } from './dom.js';
import { employeesView } from './employeesView.js';
import { excelView } from './excelView.js';
import { expenseSummaryView } from './expenseSummaryView.js';
import { expensesView, openExpenseForm } from './expensesView.js';
import { extraWorkersView } from './extraWorkersView.js';
import { forcePasswordChange, loginView } from './login.js';
import { landingView } from './landingView.js';
import { openPrintDialog } from './printDialog.js';
import { reportsView } from './reportsView.js';
import { roomsView } from './roomsView.js';
import { settingsView } from './settingsView.js';
import { backupView } from './backupView.js';
import { foreignWorkersView } from './foreignWorkersView.js';
import { purchaseInvoiceView, salesInvoiceView } from './invoiceView.js';
import { processedInvoicesView } from './processedInvoicesView.js';
import { restaurantExpenseView } from './restaurantExpenseView.js';
import { restaurantIncomeView } from './restaurantView.js';
import { suppliersView } from './suppliersView.js';
import { taxView } from './taxView.js';
import { openOwnPasswordForm, usersView } from './usersView.js';

/** PRD §9 — ana menü yapısı. `module` yetkisi olmayan girdi menüde görünmez. */
const VIEWS = [
  { key: 'panel', label: 'Dashboard', icon: '📊', module: 'dashboard', group: 'Genel', render: dashboardView },
  { key: 'takvim', label: 'Fiyat Girişi', icon: '🗓️', module: 'fiyatGirisi', group: 'Genel', render: calendarView },
  { key: 'odalar', label: 'Oda Ayarları', icon: '🚪', module: 'odalar', group: 'Genel', render: roomsView },

  // PRD III §2 — "Gelirler" bu kategoriye taşındı; kategori adı "Gelir - Gider" oldu.
  { key: 'gelirler', label: 'Gelirler', icon: '🧾', module: 'gelirler', group: 'Gelir - Gider', render: salesInvoiceView },
  { key: 'tumGiderler', label: 'Giderler', icon: '📉', module: 'giderler', group: 'Gelir - Gider', render: expenseSummaryView },
  { key: 'giderler', label: 'Genel Harcamalar', icon: '🧾', module: 'genelHarcamalar', group: 'Gelir - Gider', render: expensesView },
  { key: 'giderFaturalari', label: 'Gider Faturaları', icon: '📨', module: 'giderFaturalari', group: 'Gelir - Gider', render: purchaseInvoiceView },
  { key: 'islenenFaturalar', label: 'İşlenen Faturalar', icon: '✅', module: 'excelIceAktarim', altModule: 'gelirler', group: 'Gelir - Gider', render: processedInvoicesView },
  { key: 'calisanlar', label: 'Çalışanlar', icon: '👷', module: 'calisanlar', group: 'Gelir - Gider', render: employeesView },
  { key: 'ekstra', label: 'Ekstra Çalışan', icon: '🧑‍🔧', module: 'ekstraCalisan', group: 'Gelir - Gider', render: extraWorkersView },
  { key: 'yabanci', label: 'Yabancı Çalışanlar', icon: '🌍', module: 'yabanciCalisanlar', group: 'Gelir - Gider', render: foreignWorkersView },
  { key: 'vergiler', label: 'Vergiler', icon: '🧮', module: 'vergiler', group: 'Gelir - Gider', render: taxView },

  { key: 'restoranGelir', label: 'Restoran Gelirleri', icon: '🍽️', module: 'restoranGelir', group: 'Restoran', render: restaurantIncomeView },
  { key: 'restoranGider', label: 'Ekstra Giderler', icon: '🧂', module: 'restoranGider', group: 'Restoran', render: restaurantExpenseView },
  { key: 'toptancilar', label: 'Toptancılar', icon: '🥬', module: 'toptancilar', group: 'Restoran', render: suppliersView },

  { key: 'kasa', label: 'Gün Sonu / Kasa', icon: '💰', module: 'kasa', group: 'Kasa', render: cashView },

  { key: 'raporlar', label: 'Finansal Raporlar', icon: '📁', module: 'finansalRaporlar', group: 'Raporlar', render: reportsView },
  { key: 'excel', label: 'Excel İşlemleri', icon: '📑', module: 'excelIceAktarim', altModule: 'excelDisaAktarim', group: 'Raporlar', render: excelView },

  { key: 'kullanicilar', label: 'Kullanıcı ve Yetki', icon: '👥', module: 'kullaniciYonetimi', group: 'Yönetim', render: usersView },
  { key: 'yedekleme', label: 'Yedekleme', icon: '💾', module: 'yedekleme', group: 'Yönetim', render: backupView },
  { key: 'ayarlar', label: 'Ayarlar', icon: '⚙️', module: 'ayarlar', group: 'Yönetim', render: settingsView },
];

/**
 * Etkin oturumun olay dinleyicilerini tutar.
 *
 * Çıkış→giriş akışında eski oturumun `hashchange` dinleyicisi sayfada kalıyor ve
 * yeni kullanıcının gittiği sayfayı "yetkiniz yok" diyerek geri alıyordu (PRD v2 §1.2).
 * Her yeni oturum, öncekini iptal ederek başlar.
 */
let activeSession = null;

function endActiveSession() {
  activeSession?.abort();
  activeSession = null;
}

export async function mount(root) {
  endActiveSession();
  setUnauthorizedHandler(() => showLogin('Oturumunuz sona erdi. Lütfen tekrar giriş yapın.'));

  const session = await api.get('/api/auth/me').catch(() => null);
  if (!session?.user) {
    // PRD III §3 — oturum yoksa önce karşılama sayfası açılır.
    // `#giris` adresiyle (veya oturum düştüğünde) doğrudan giriş ekranı gelir.
    if (location.hash === '#giris') showLogin();
    else showLanding();
    return null;
  }
  return startApp(root, session.user);

  function showLanding() {
    landingView(root, () => {
      location.hash = 'giris';
      showLogin();
    });
  }

  function showLogin(message) {
    loginView(root, (user) => startApp(root, user));
    if (message) toast(message, 'warn');
  }
}

async function startApp(root, user) {
  endActiveSession();
  const session = new AbortController();
  activeSession = session;

  const store = await createStore();

  if (user.mustChangePassword) {
    forcePasswordChange(root, {
      store, user,
      onDone: () => startApp(root, { ...user, mustChangePassword: false }),
      onLogout: () => mount(root),
    });
    return null;
  }

  let activeRange = 'thisMonth';
  let custom = null;
  const me = () => store.getState().me ?? user;
  const can = (moduleKey) => Boolean(me()?.isAdmin || me()?.permissions?.[moduleKey]);

  const allowed = VIEWS.filter((view) => can(view.module) || (view.altModule && can(view.altModule)));

  // PRD v2 §1.3: giriş sonrası varsayılan açılış Dashboard'dır.
  // Sayfa yenilemesinde adresteki sayfa korunur; yeni girişte adres sıfırlanır.
  const hashKey = location.hash.slice(1);
  const defaultKey = allowed.some((v) => v.key === 'panel') ? 'panel' : allowed[0]?.key ?? 'panel';
  let current = allowed.some((v) => v.key === hashKey) ? hashKey : defaultKey;
  if (location.hash.slice(1) !== current) location.hash = current;

  const content = h('main', { class: 'content' });
  const nav = h('nav', { class: 'nav' });
  const topbar = h('header', { class: 'topbar no-print' });
  const sidebar = h('aside', { class: 'sidebar no-print' });
  const backdrop = h('div', { class: 'sidebar-backdrop', onClick: () => closeSidebar() });

  const openSidebar = () => {
    sidebar.classList.add('open');
    backdrop.classList.add('show');
  };
  const closeSidebar = () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
  };

  const app = {
    store,
    can,
    me,
    period: () => (custom ? makePeriod(custom.from, custom.to) : quickRange(activeRange)),
    present: () => createPresenter(store.getState().settings),
    report: () => app.reportFor(app.period()),
    reportFor: (p) => buildReport({ ...store.getState(), period: p }),
    openPrintDialog,
    addExpenseFor(roomId, amenityKey) {
      openExpenseForm(app, null, { roomId, amenityKey, category: 'maintenance', allocation: 'direct' });
    },
    setRange(key) {
      activeRange = key;
      custom = null;
      app.refresh();
    },
    go(key) {
      if (!allowed.some((v) => v.key === key)) {
        toast('Bu sayfa için yetkiniz bulunmuyor.', 'error');
        return;
      }
      current = key;
      location.hash = key;
      openGroupFor(key);
      closeSidebar();
      app.refresh();
    },
    refresh() {
      renderNav();
      renderTopbar();
      clear(content);
      const view = allowed.find((v) => v.key === current) ?? allowed[0];
      if (!view) {
        content.appendChild(h('div', { class: 'card empty' },
          'Hiçbir modüle yetkiniz yok. Lütfen yöneticinize başvurun.'));
        return;
      }
      content.appendChild(view.render(app));
    },
  };

  /** PRD v2 §1.3: aynı anda yalnızca bir ana kategori açık kalır. */
  const OPEN_GROUP_KEY = 'otel:acik-menu-grubu';
  const groupOf = (key) => allowed.find((v) => v.key === key)?.group;

  let openGroup = groupOf(current) ?? allowed[0]?.group ?? null;
  try {
    const saved = localStorage.getItem(OPEN_GROUP_KEY);
    // Kullanıcı tüm grupları kapattıysa bu tercih korunur (aktif sayfa noktayla belirtilir).
    if (saved === 'null') openGroup = null;
    // Diğer durumda kaydedilmiş grup yalnızca mevcut sayfanın grubuysa açılır.
    else if (saved && groupOf(current) === saved) openGroup = saved;
  } catch {
    /* gizli sekme vb. — varsayılanla devam */
  }

  const persistOpenGroup = () => {
    try {
      localStorage.setItem(OPEN_GROUP_KEY, openGroup ?? 'null');
    } catch {
      /* hatırlamadan devam */
    }
  };

  function openGroupFor(key) {
    const group = groupOf(key);
    if (group && group !== openGroup) {
      openGroup = group;
      persistOpenGroup();
    }
  }

  function toggleGroup(group) {
    // Akordiyon: açılan grup dışındakiler kapanır.
    openGroup = openGroup === group ? null : group;
    persistOpenGroup();
    renderNav();
  }

  function renderNav() {
    clear(nav);
    const groups = new Map();
    for (const view of allowed) {
      if (!groups.has(view.group)) groups.set(view.group, []);
      groups.get(view.group).push(view);
    }

    for (const [group, items] of groups) {
      const open = openGroup === group;
      const activeInside = items.some((v) => v.key === current);

      nav.appendChild(h('button', {
        class: `nav-group${open ? ' open' : ''}${activeInside ? ' has-active' : ''}`,
        type: 'button',
        'aria-expanded': String(open),
        title: open ? `${group} bölümünü kapat` : `${group} bölümünü aç`,
        onClick: () => toggleGroup(group),
      },
        h('span', { class: 'nav-caret' }, '▸'),
        h('span', { class: 'nav-group-label' }, group),
        !open && activeInside ? h('span', { class: 'nav-dot' }) : null,
        h('span', { class: 'nav-count' }, String(items.length))));

      if (!open) continue;

      nav.appendChild(h('div', { class: 'nav-sub' }, ...items.map((view) => h('button', {
        class: `nav-item${view.key === current ? ' active' : ''}`,
        type: 'button',
        onClick: () => app.go(view.key),
      }, h('span', { class: 'nav-icon' }, view.icon), view.label))));
    }
  }

  function renderTopbar() {
    const settings = store.getState().settings;
    const p = app.period();
    clear(topbar);

    const quick = h('div', { class: 'range-chips' }, ...QUICK_RANGES.map((range) =>
      h('button', {
        class: `chip${!custom && activeRange === range.key ? ' checked' : ''}`, type: 'button',
        onClick: () => app.setRange(range.key),
      }, range.label)));

    const monthValue = p.from.slice(0, 7);
    const monthNav = h('div', { class: 'row gap center' },
      h('button', {
        class: 'icon-btn', type: 'button', title: 'Önceki ay',
        onClick: () => { custom = monthPeriod(shiftMonth(monthValue, -1)); app.refresh(); },
      }, '‹'),
      h('input', {
        type: 'month', value: monthValue, class: 'month-input',
        onChange: (e) => { if (e.target.value) { custom = monthPeriod(e.target.value); app.refresh(); } },
      }),
      h('button', {
        class: 'icon-btn', type: 'button', title: 'Sonraki ay',
        onClick: () => { custom = monthPeriod(shiftMonth(monthValue, 1)); app.refresh(); },
      }, '›'));

    const customRange = h('details', { class: 'custom-range' },
      h('summary', { class: 'chip' }, '📆 Özel Aralık'),
      h('div', { class: 'card popover row gap center wrap' },
        h('input', { type: 'date', value: p.from, id: 'range-from' }),
        h('span', { class: 'muted' }, '→'),
        h('input', { type: 'date', value: p.to, id: 'range-to' }),
        h('button', {
          class: 'btn small primary', type: 'button',
          onClick: (e) => {
            const box = e.target.closest('.custom-range');
            const from = box.querySelector('#range-from').value;
            const to = box.querySelector('#range-to').value;
            if (!from || !to || from > to) { toast('Geçerli bir aralık seçin.', 'error'); return; }
            custom = makePeriod(from, to);
            box.removeAttribute('open');
            app.refresh();
          },
        }, 'Uygula')));

    const currencyToggle = h('div', { class: 'currency-toggle', role: 'group', 'aria-label': 'Para birimi' },
      ...CURRENCIES.map((currency) => h('button', {
        class: `cur-btn${settings.displayCurrency === currency.key ? ' active' : ''}`,
        type: 'button',
        onClick: async () => { await store.setDisplayCurrency(currency.key); app.refresh(); },
      }, `${currency.symbol} ${currency.key}`)));

    const account = h('details', { class: 'account-menu' },
      h('summary', { class: 'chip account-chip' },
        h('span', { class: 'avatar' }, (me().displayName || me().username).slice(0, 1).toLocaleUpperCase('tr')),
        me().displayName || me().username,
        me().isAdmin ? h('span', { class: 'pill pill-active' }, 'Admin') : null),
      h('div', { class: 'card popover right stack tight' },
        h('div', { class: 'muted small' }, `@${me().username}`),
        h('button', {
          class: 'btn small ghost', type: 'button',
          onClick: () => openOwnPasswordForm(app),
        }, '🔑 Şifre Değiştir'),
        h('button', {
          class: 'btn small danger ghost', type: 'button',
          onClick: async () => {
            await api.post('/api/auth/logout').catch(() => {});
            // Çıkışta doğrudan giriş ekranı gelir; karşılama sayfası adres kökü içindir.
            location.hash = 'giris';
            mount(root);
          },
        }, '🚪 Çıkış Yap')));

    topbar.appendChild(h('div', { class: 'row between center wrap gap' },
      h('div', { class: 'row gap center wrap' },
        h('button', {
          class: 'menu-btn', type: 'button', title: 'Menü', 'aria-label': 'Menüyü aç',
          onClick: openSidebar,
        }, '☰'),
        monthNav, quick, customRange),
      h('div', { class: 'row gap center' },
        h('span', { class: 'muted small' }, `1 € = ${(settings.fx?.rate ?? 0).toFixed(2)} ₺`),
        currencyToggle,
        can('yazdirma') ? h('button', {
          class: 'btn small', type: 'button', title: 'Yazdırma seçenekleri',
          onClick: () => openPrintDialog(allowed.find((v) => v.key === current)?.label ?? 'Rapor'),
        }, '🖨️') : null,
        account)));
  }

  window.addEventListener('hashchange', () => {
    const key = location.hash.slice(1) || current;
    if (key !== current) {
      if (allowed.some((v) => v.key === key)) {
        current = key;
        openGroupFor(key);
        app.refresh();
      } else {
        // Yetkisiz sayfaya adresten gidilemez.
        location.hash = current;
        toast('Bu sayfa için yetkiniz bulunmuyor.', 'error');
      }
    }
  }, { signal: session.signal });

  // Dokunmatik cihazda üzerine gelme yoktur; kısayol menüsü düğmeyle açılıp kapanır.
  const closeFab = () => fab?.classList.remove('open');
  const fab = can('genelHarcamalar') || can('fiyatGirisi')
    ? h('div', { class: 'fab no-print' },
      h('div', { class: 'fab-menu' },
        can('genelHarcamalar')
          ? h('button', {
            class: 'btn small', type: 'button',
            onClick: () => { closeFab(); openExpenseForm(app, null); },
          }, '＋ Gider Ekle')
          : null,
        can('fiyatGirisi')
          ? h('button', {
            class: 'btn small', type: 'button',
            onClick: () => { closeFab(); openBulkEditor(app); },
          }, '＋ Hızlı Fiyat Gir')
          : null),
      h('button', {
        class: 'fab-btn', type: 'button', title: 'Hızlı ekle', 'aria-label': 'Hızlı ekle',
        onClick: () => fab.classList.toggle('open'),
      }, '＋'))
    : null;

  append(sidebar, [
    h('div', { class: 'brand' },
      h('span', { class: 'brand-mark' }, '🏨'),
      h('div', {}, h('strong', {}, 'Otel Finans'), h('div', { class: 'muted small' }, 'Yönetim Sistemi')),
      h('button', {
        class: 'icon-btn sidebar-close', type: 'button', title: 'Menüyü kapat',
        onClick: closeSidebar,
      }, '✕')),
    nav,
    h('div', { class: 'sidebar-foot muted small' }, `${allowed.length} modül erişiminiz var`),
  ]);

  clear(root).appendChild(h('div', { class: 'layout' },
    sidebar, backdrop,
    h('div', { class: 'main' }, topbar, content)));
  if (fab) root.appendChild(fab);

  // Yeni dönem açıldığında düzenli fatura kalemleri 0 TL olarak oluşturulur.
  if (can('genelHarcamalar')) {
    store.ensureBills(app.period().from.slice(0, 7)).catch(() => {});
  }

  app.refresh();
  return app;
}
