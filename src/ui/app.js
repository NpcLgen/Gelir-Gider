/**
 * Uygulama kabuğu (PRD §4 UI/UX mimarisi):
 * sol menü, üst şeritte dönem filtreleri ve kur anahtarı, sağ altta hızlı ekle butonu.
 */

import { CURRENCIES, QUICK_RANGES } from '../core/catalog.js';
import { buildReport } from '../core/costEngine.js';
import { monthPeriod, period as makePeriod, quickRange, shiftMonth } from '../core/dates.js';
import { createPresenter } from '../core/format.js';
import { createStore } from '../core/store.js';
import { calendarView, openBulkEditor } from './calendarView.js';
import { dashboardView } from './dashboardView.js';
import { clear, h, toast } from './dom.js';
import { expensesView, openExpenseForm } from './expensesView.js';
import { reportsView } from './reportsView.js';
import { reservationsView } from './reservationsView.js';
import { roomsView } from './roomsView.js';
import { settingsView } from './settingsView.js';

const VIEWS = [
  { key: 'panel', label: 'Dashboard', icon: '📊', render: dashboardView },
  { key: 'takvim', label: 'Fiyat / Gelir Takvimi', icon: '🗓️', render: calendarView },
  { key: 'giderler', label: 'Gider Yönetimi', icon: '🧾', render: expensesView },
  { key: 'rezervasyonlar', label: 'Rezervasyonlar', icon: '🛎️', render: reservationsView },
  { key: 'odalar', label: 'Oda Ayarları', icon: '🚪', render: roomsView },
  { key: 'raporlar', label: 'Finansal Raporlar', icon: '📁', render: reportsView },
  { key: 'ayarlar', label: 'Sistem Ayarları', icon: '⚙️', render: settingsView },
];

export function mount(root) {
  const store = createStore();
  let activeRange = 'thisMonth';
  let custom = null;
  let current = location.hash.slice(1) || 'panel';
  if (!VIEWS.some((v) => v.key === current)) current = 'panel';

  const content = h('main', { class: 'content' });
  const nav = h('nav', { class: 'nav' });
  const topbar = h('header', { class: 'topbar no-print' });

  const app = {
    store,
    period: () => (custom ? makePeriod(custom.from, custom.to) : quickRange(activeRange)),
    present: () => createPresenter(store.getState().settings),
    report: () => app.reportFor(app.period()),
    reportFor: (p) => buildReport({ ...store.getState(), period: p }),
    addExpenseFor(roomId, amenityKey) {
      openExpenseForm(app, null, { roomId, amenityKey, category: 'maintenance', allocation: 'direct' });
    },
    setRange(key) {
      activeRange = key;
      custom = null;
      app.refresh();
    },
    go(key) {
      current = key;
      location.hash = key;
      app.refresh();
    },
    refresh() {
      renderNav();
      renderTopbar();
      clear(content);
      const view = VIEWS.find((v) => v.key === current) ?? VIEWS[0];
      content.appendChild(view.render(app));
    },
  };

  function renderNav() {
    clear(nav);
    for (const view of VIEWS) {
      nav.appendChild(h('button', {
        class: `nav-item${view.key === current ? ' active' : ''}`,
        type: 'button',
        onClick: () => app.go(view.key),
      }, h('span', { class: 'nav-icon' }, view.icon), view.label));
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
        onClick: () => { store.setDisplayCurrency(currency.key); app.refresh(); },
      }, `${currency.symbol} ${currency.key}`)));

    topbar.appendChild(h('div', { class: 'row between center wrap gap' },
      h('div', { class: 'row gap center wrap' }, monthNav, quick, customRange),
      h('div', { class: 'row gap center' },
        h('span', { class: 'muted small' }, `1 € = ${settings.fx.rate.toFixed(2)} ₺`),
        currencyToggle)));
  }

  window.addEventListener('hashchange', () => {
    const key = location.hash.slice(1) || 'panel';
    if (VIEWS.some((v) => v.key === key) && key !== current) {
      current = key;
      app.refresh();
    }
  });

  const fab = h('div', { class: 'fab no-print' },
    h('div', { class: 'fab-menu' },
      h('button', { class: 'btn small', type: 'button', onClick: () => openExpenseForm(app, null) }, '＋ Gider Ekle'),
      h('button', { class: 'btn small', type: 'button', onClick: () => openBulkEditor(app) }, '＋ Hızlı Fiyat Gir')),
    h('button', { class: 'fab-btn', type: 'button', title: 'Hızlı ekle', 'aria-label': 'Hızlı ekle' }, '＋'));

  clear(root).appendChild(h('div', { class: 'layout' },
    h('aside', { class: 'sidebar no-print' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, '🏨'),
        h('div', {}, h('strong', {}, 'Butik Otel BI'), h('div', { class: 'muted small' }, 'Gelir-Gider & Kârlılık'))),
      nav,
      h('div', { class: 'sidebar-foot muted small' }, 'Tek kullanıcılı finansal zekâ aracı')),
    h('div', { class: 'main' }, topbar, content)));
  root.appendChild(fab);

  app.refresh();
  return app;
}
