/** Uygulama kabuğu: gezinme, dönem seçimi ve görünüm yönlendirmesi. */

import { buildReport } from '../core/costEngine.js';
import { monthPeriod } from '../core/dates.js';
import { createStore } from '../core/store.js';
import { clear, h } from './dom.js';
import { expensesView, openExpenseForm } from './expensesView.js';
import { reportView } from './reportView.js';
import { reservationsView } from './reservationsView.js';
import { roomsView } from './roomsView.js';
import { settingsView } from './settingsView.js';

const VIEWS = [
  { key: 'panel', label: 'Panel', icon: '📊', render: reportView },
  { key: 'odalar', label: 'Odalar', icon: '🚪', render: roomsView },
  { key: 'rezervasyonlar', label: 'Rezervasyonlar', icon: '🗓️', render: reservationsView },
  { key: 'giderler', label: 'Giderler', icon: '🧾', render: expensesView },
  { key: 'ayarlar', label: 'Ayarlar', icon: '⚙️', render: settingsView },
];

export function mount(root) {
  const store = createStore();
  let month = new Date().toISOString().slice(0, 7);
  let current = (location.hash.slice(1) || 'panel');
  if (!VIEWS.some((v) => v.key === current)) current = 'panel';

  const content = h('main', { class: 'content' });
  const nav = h('nav', { class: 'nav' });
  const monthInput = h('input', {
    type: 'month', value: month, class: 'month-input',
    onChange: (e) => { month = e.target.value || month; app.refresh(); },
  });

  const app = {
    store,
    period: () => monthPeriod(month),
    report: () => {
      const state = store.getState();
      return buildReport({ ...state, period: monthPeriod(month) });
    },
    addExpenseFor(roomId, amenityKey) {
      openExpenseForm(app, null, { roomId, amenityKey, category: 'maintenance', allocation: 'direct' });
    },
    go(key) {
      current = key;
      location.hash = key;
      app.refresh();
    },
    refresh() {
      renderNav();
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

  window.addEventListener('hashchange', () => {
    const key = location.hash.slice(1) || 'panel';
    if (VIEWS.some((v) => v.key === key) && key !== current) {
      current = key;
      app.refresh();
    }
  });

  clear(root).appendChild(h('div', { class: 'layout' },
    h('aside', { class: 'sidebar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, '🏨'),
        h('div', {}, h('strong', {}, 'Gelir-Gider'), h('div', { class: 'muted small' }, 'Oda Bazlı Kârlılık'))),
      nav,
      h('div', { class: 'sidebar-foot' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Dönem'), monthInput))),
    content));

  app.refresh();
  return app;
}
