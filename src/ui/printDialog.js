/** Dinamik yazdırma seçenekleri (PRD §2.2). */

import { h, openModal } from './dom.js';

/**
 * Yazdırma öncesi içerik seçimi. Seçilmeyen bölümler `.print-hidden` sınıfıyla
 * gizlenir, yazdırma sonrası eski haline döner.
 */
export const PRINT_SECTIONS = [
  { key: 'kpi', label: 'Özet Göstergeler', selector: '.kpi-grid' },
  { key: 'charts', label: 'Grafikler', selector: '.donut, .bar-list, .chart-pad, .progress' },
  { key: 'gelirler', label: 'Gelirler / Rezervasyonlar', selector: '[data-print="gelirler"]' },
  { key: 'giderler', label: 'Giderler', selector: '[data-print="giderler"]' },
  { key: 'kdv', label: 'KDV ve Vergiler', selector: '[data-print="vergiler"]' },
  { key: 'kasa', label: 'Kasa Durumu', selector: '[data-print="kasa"]' },
  { key: 'odalar', label: 'Oda Bazlı Tablolar', selector: '[data-print="odalar"]' },
  { key: 'restoran', label: 'Restoran Gelirleri', selector: '[data-print="restoran"]' },
  { key: 'tables', label: 'Diğer Tablolar', selector: '.table-card' },
];

export function openPrintDialog(title = 'Rapor') {
  const selection = Object.fromEntries(PRINT_SECTIONS.map((s) => [s.key, true]));

  openModal({
    title: 'Yazdırma Seçenekleri',
    subtitle: `${title} — çıktıya girecek bölümleri seçin`,
    size: 'sm',
    content: (close) => {
      const list = h('div', { class: 'print-options' }, ...PRINT_SECTIONS.map((section) =>
        h('label', { class: 'print-option' },
          h('input', {
            type: 'checkbox', checked: true, dataset: { section: section.key },
            onChange: (e) => { selection[section.key] = e.target.checked; },
          }),
          h('span', {}, section.label))));

      return h('div', { class: 'stack' },
        list,
        h('div', { class: 'row gap' },
          h('button', {
            class: 'btn small ghost', type: 'button',
            onClick: () => {
              list.querySelectorAll('input').forEach((input) => {
                input.checked = true;
                selection[input.dataset.section] = true;
              });
            },
          }, 'Tümünü Seç'),
          h('button', {
            class: 'btn small ghost', type: 'button',
            onClick: () => {
              list.querySelectorAll('input').forEach((input) => {
                input.checked = false;
                selection[input.dataset.section] = false;
              });
            },
          }, 'Tümünü Kaldır')),
        h('p', { class: 'muted small' }, 'Yazdırma önizlemesinde yalnızca seçtiğiniz bölümler görünür.'),
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'button',
            onClick: () => { close(); applyAndPrint(selection); },
          }, '🖨️ Önizleme ve Yazdır')));
    },
  });
}

function applyAndPrint(selection) {
  const hidden = [];
  for (const section of PRINT_SECTIONS) {
    if (selection[section.key]) continue;
    for (const el of document.querySelectorAll(section.selector)) {
      el.classList.add('print-hidden');
      hidden.push(el);
    }
  }

  const restore = () => {
    hidden.forEach((el) => el.classList.remove('print-hidden'));
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);

  // Yazdırma iptal edilse bile sayfa eski haline dönmeli.
  setTimeout(() => {
    window.print();
    setTimeout(restore, 1500);
  }, 50);
}
