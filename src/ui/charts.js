/**
 * Bağımlılıksız SVG grafikler.
 * Renkler: doğrulanmış kategorik paletin koyu tema yuvaları (bkz. catalog.js
 * EXPENSE_GROUPS). Dilimler arasında 2px yüzey boşluğu bırakılır, her dilim
 * doğrudan etiketlenir ve altında tablo görünümü sunulur — kimlik hiçbir zaman
 * yalnızca renge bırakılmaz.
 */

import { h } from './dom.js';

const TAU = Math.PI * 2;
const polar = (cx, cy, r, angle) => [cx + r * Math.cos(angle - Math.PI / 2), cy + r * Math.sin(angle - Math.PI / 2)];

function arcPath(cx, cy, rOuter, rInner, start, end) {
  const large = end - start > Math.PI ? 1 : 0;
  const [x1, y1] = polar(cx, cy, rOuter, start);
  const [x2, y2] = polar(cx, cy, rOuter, end);
  const [x3, y3] = polar(cx, cy, rInner, end);
  const [x4, y4] = polar(cx, cy, rInner, start);
  return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4} Z`;
}

const svgEl = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const child of children.flat()) if (child) el.appendChild(child);
  return el;
};

/**
 * Halka (donut) grafik — parça/bütün ilişkisi için.
 * @param {{label:string, value:number, color:string}[]} slices
 */
export function donutChart(slices, { size = 220, format = String, centerLabel = '', centerValue = '' } = {}) {
  const data = slices.filter((s) => s.value > 0);
  const total = data.reduce((sum, s) => sum + s.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 4;
  const rInner = rOuter * 0.62;
  const gap = total > 0 ? (2 / rOuter) : 0; // yaklaşık 2px yüzey boşluğu

  const svg = svgEl('svg', {
    viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img',
    'aria-label': 'Gider dağılımı halka grafiği',
  });

  if (!total) {
    svg.appendChild(svgEl('circle', { cx, cy, r: rOuter, fill: 'none', stroke: 'var(--line)', 'stroke-width': 2 }));
  }

  let angle = 0;
  for (const slice of data) {
    const sweep = (slice.value / total) * TAU;
    const start = angle + (data.length > 1 ? gap / 2 : 0);
    const end = angle + sweep - (data.length > 1 ? gap / 2 : 0);
    if (end > start) {
      const path = svgEl('path', {
        d: arcPath(cx, cy, rOuter, rInner, start, end),
        fill: slice.color,
        class: 'donut-slice',
      });
      path.appendChild(svgEl('title', {}, document.createTextNode(
        `${slice.label}: ${format(slice.value)} (%${((slice.value / total) * 100).toFixed(1)})`,
      )));
      svg.appendChild(path);
    }
    angle += sweep;
  }

  return h('div', { class: 'donut' },
    svg,
    h('div', { class: 'donut-center' },
      h('span', { class: 'muted small' }, centerLabel),
      h('strong', {}, centerValue)));
}

/** Yatay bar listesi — sıralı büyüklük karşılaştırması için. */
export function barList(items, { format = String } = {}) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return h('div', { class: 'bar-list' }, ...items.map((item) => h('div', { class: 'bar-list-row' },
    h('span', { class: 'bar-list-label' },
      item.color ? h('span', { class: 'swatch', style: { background: item.color } }) : null,
      item.label),
    h('span', { class: 'bar-list-track' },
      h('span', {
        class: 'bar-list-fill',
        style: { width: `${(Math.abs(item.value) / max) * 100}%`, background: item.color || 'var(--accent)' },
      })),
    h('strong', { class: 'bar-list-value' }, format(item.value)))));
}

/** Değişim göstergesi — yön ok ile de belirtilir, yalnızca renge bırakılmaz. */
export function deltaBadge(ratio, { invert = false } = {}) {
  if (ratio == null) return h('span', { class: 'delta muted' }, '— yeni');
  const positive = invert ? ratio < 0 : ratio > 0;
  const arrow = ratio > 0 ? '▲' : ratio < 0 ? '▼' : '■';
  const sign = ratio > 0 ? '+' : '';
  return h('span', { class: `delta ${positive ? 'good' : 'bad'}` },
    `${arrow} ${sign}${(ratio * 100).toFixed(1)}%`);
}
