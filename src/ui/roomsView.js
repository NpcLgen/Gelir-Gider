/** Oda listesi — kartlara tıklandığında Oda Kartı paneli açılır. */

import { AMENITY_MAP, ROOM_STATUSES } from '../core/catalog.js';
import { amenityLoad, bedSummary } from '../core/model.js';
import { formatDecimal, formatPercent } from '../core/format.js';
import { h } from './dom.js';
import { openRoomCard } from './roomCard.js';

const statusLabel = (key) => ROOM_STATUSES.find((s) => s.key === key)?.label ?? key;

export function roomsView(app) {
  const { rooms } = app.store.getState();
  const report = app.report();
  const present = app.present();

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Odalar'),
        h('p', { class: 'muted' }, 'Bir odaya tıklayarak oda kartını açın; kapasite ve demirbaş seçimleri maliyet dağıtımını belirler.')),
      h('button', { class: 'btn primary', type: 'button', onClick: () => openRoomCard(app, null) }, '＋ Yeni Oda')),

    rooms.length === 0
      ? h('div', { class: 'card empty' }, 'Henüz oda tanımlanmadı. "Yeni Oda" ile ilk oda kartını oluşturun.')
      : h('div', { class: 'room-grid' }, ...rooms.map((room) => {
        const row = report.rooms.find((r) => r.room.id === room.id);
        return h('button', {
          class: `room-tile status-${room.status}`, type: 'button',
          onClick: () => openRoomCard(app, room),
        },
          h('div', { class: 'row between center' },
            h('span', { class: 'room-number' }, room.number),
            h('span', { class: `pill pill-${room.status}` }, statusLabel(room.status))),
          h('div', { class: 'room-name' }, room.name || 'İsimsiz oda'),
          h('div', { class: 'muted small' }, bedSummary(room)),
          h('div', { class: 'row gap small muted wrap' },
            h('span', {}, `👤 maks. ${room.maxOccupancy} kişi`),
            room.area ? h('span', {}, `📐 ${room.area} m²`) : null,
            h('span', { title: 'Elektrik dağıtım katsayısı' }, `⚡ ×${formatDecimal(amenityLoad(room, 'electricity'))}`)),
          h('div', { class: 'room-amenities' },
            ...room.amenities.slice(0, 8).map((key) =>
              h('span', { class: 'amenity-dot', title: AMENITY_MAP[key].label }, AMENITY_MAP[key].icon)),
            room.amenities.length > 8 ? h('span', { class: 'amenity-dot' }, `+${room.amenities.length - 8}`) : null),
          row ? h('div', { class: 'room-metrics' },
            metric('Gelir', present.money(row.revenue)),
            metric('Gider', present.money(row.totalCost)),
            metric('Kâr', present.money(row.profit), row.profit >= 0 ? 'good' : 'bad'),
            metric('Doluluk', formatPercent(row.occupancyRate))) : null);
      })));
}

function metric(label, value, tone) {
  return h('div', { class: 'metric' },
    h('span', { class: 'muted small' }, label),
    h('strong', { class: tone || '' }, value));
}
