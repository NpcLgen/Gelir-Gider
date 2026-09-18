/**
 * Oda Kartı paneli — bir odaya tıklandığında açılan yapılandırma ekranı.
 * Üç bölüm: Tanımlama · Kapasite & Yatak Yapılandırması · Demirbaş ve Özellik Listesi.
 * Sağ sütunda seçimlerin maliyete etkisi canlı olarak hesaplanır.
 */

import { AMENITY_GROUPS, AMENITY_MAP, BED_TYPES, ROOM_STATUSES, UTILITY_KINDS, UTILITY_LABELS } from '../core/catalog.js';
import {
  amenityLoad,
  bedCapacity,
  bedSummary,
  createRoom,
  maxOccupancyOptions,
  roomLabel,
  serviceableAmenities,
} from '../core/model.js';
import { ALLOCATION_METHODS } from '../core/catalog.js';
import { formatDecimal, formatMoney } from '../core/format.js';
import { append, clear, confirmDialog, errorList, field, h, openModal, select, toast } from './dom.js';

/** Odanın dolu iken günlük kişi başı sarfiyatı (tarife üzerinden tahmin). */
export function dailyGuestCost(settings, guests) {
  return (settings.perGuestTariff ?? [])
    .filter((t) => t.active !== false && t.basis === 'guestNight')
    .reduce((sum, t) => sum + t.amount * guests, 0);
}

export function openRoomCard(app, source) {
  const isNew = !source?.id;
  const draft = createRoom(source ?? {});
  let errorBox = null;

  openModal({
    title: isNew ? 'Yeni Oda Kartı' : `Oda Kartı · ${roomLabel(draft)}`,
    subtitle: 'Oda tanımı, kapasitesi ve demirbaşları bu karttan yönetilir; maliyet dağıtımı bu bilgilere göre yapılır.',
    size: 'lg',
    content: (close) => {
      const summary = h('div', { class: 'card summary-card' });
      const capacityBox = h('div', { class: 'stack' });
      const amenityBox = h('div', { class: 'amenity-grid' });
      errorBox = h('div', { class: 'error-box hidden' });

      const rerender = () => {
        renderCapacity(capacityBox, draft, rerender);
        renderSummary(summary, draft, app);
      };

      /* --- 1. Tanımlama --- */
      const identity = h('div', { class: 'grid-2' },
        field('Oda Numarası *', h('input', {
          type: 'text', value: draft.number, placeholder: '101', required: true,
          onInput: (e) => { draft.number = e.target.value; renderSummary(summary, draft, app); },
        })),
        field('Konsept İsmi', h('input', {
          type: 'text', value: draft.name, placeholder: 'King Suite',
          onInput: (e) => { draft.name = e.target.value; renderSummary(summary, draft, app); },
        })),
        field('Kat', h('input', {
          type: 'number', value: draft.floor, step: '1',
          onInput: (e) => { draft.floor = Number(e.target.value); },
        })),
        field('Durum', select({ onChange: (e) => { draft.status = e.target.value; renderSummary(summary, draft, app); } },
          ROOM_STATUSES.map((s) => ({ value: s.key, label: s.label })), draft.status)),
        field('Liste Fiyatı (gecelik)', h('input', {
          type: 'number', value: draft.basePrice, min: '0', step: '50',
          onInput: (e) => { draft.basePrice = Number(e.target.value); renderSummary(summary, draft, app); },
        })),
        field('Oda Büyüklüğü (m²)', h('input', {
          type: 'number', value: draft.area, min: '0', step: '1',
          onInput: (e) => { draft.area = Number(e.target.value); renderSummary(summary, draft, app); },
        }), 'Metrekare bazlı (Seçenek B) dağıtımda kullanılır.'),
        field('Maliyet Çarpanı', h('input', {
          type: 'number', value: draft.baseWeight, min: '0.1', step: '0.05',
          onInput: (e) => { draft.baseWeight = Number(e.target.value); renderSummary(summary, draft, app); },
        }), 'Özel katsayı (Seçenek C): standart oda 1,0 · jakuzili oda 1,5 gibi.'),
      );

      /* --- 3. Demirbaş & Özellik Listesi --- */
      for (const [group, items] of Object.entries(AMENITY_GROUPS)) {
        const list = h('div', { class: 'amenity-group' }, h('h4', {}, group));
        for (const amenity of items) {
          const checked = draft.amenities.includes(amenity.key);
          const badges = UTILITY_KINDS
            .filter((kind) => amenity.load[kind] > 0)
            .map((kind) => h('span', { class: `badge badge-${kind}`, title: `${UTILITY_LABELS[kind]} katsayısı` },
              `${kind === 'electricity' ? '⚡' : kind === 'water' ? '💧' : '🔥'} +%${Math.round(amenity.load[kind] * 100)}`));
          list.appendChild(h('label', { class: `amenity${checked ? ' checked' : ''}` },
            h('input', {
              type: 'checkbox', checked,
              onChange: (e) => {
                draft.amenities = e.target.checked
                  ? [...new Set([...draft.amenities, amenity.key])]
                  : draft.amenities.filter((k) => k !== amenity.key);
                e.target.closest('.amenity').classList.toggle('checked', e.target.checked);
                renderSummary(summary, draft, app);
              },
            }),
            h('span', { class: 'amenity-icon' }, amenity.icon),
            h('span', { class: 'amenity-label' }, amenity.label),
            h('span', { class: 'amenity-badges' }, ...badges)));
        }
        amenityBox.appendChild(list);
      }

      rerender();

      const save = () => {
        try {
          const saved = app.store.saveRoom(draft);
          toast(`${roomLabel(saved)} kaydedildi.`);
          close();
          app.refresh();
        } catch (err) {
          clear(errorBox).appendChild(errorList(err.errors ?? [err.message]));
          errorBox.classList.remove('hidden');
          errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      };

      return h('div', { class: 'room-card' },
        h('div', { class: 'room-card-main stack' },
          errorBox,
          section('1', 'Oda İsimlendirme ve Tanımlama', identity),
          section('2', 'Kapasite ve Yatak Yapılandırması', capacityBox),
          section('3', 'Demirbaş ve Özellik Listesi', amenityBox,
            'İşaretlenen donanımlar hem genel gider katsayısını hem de bakım giderlerinin yönlendirileceği listeyi belirler.'),
          field('Notlar', h('textarea', {
            rows: 2, value: draft.notes, onInput: (e) => { draft.notes = e.target.value; },
          }))),
        h('aside', { class: 'room-card-side stack' },
          summary,
          h('div', { class: 'row gap wrap' },
            h('button', { class: 'btn primary', type: 'button', onClick: save }, '💾 Oda Kartını Kaydet'),
            h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç')),
          !isNew ? h('button', {
            class: 'btn danger ghost', type: 'button',
            onClick: () => confirmDialog(
              `${roomLabel(draft)} odası ve bağlı rezervasyonları silinsin mi?`,
              () => { app.store.deleteRoom(draft.id); close(); app.refresh(); toast('Oda silindi.', 'warn'); },
            ),
          }, '🗑️ Odayı Sil') : null),
      );
    },
  });
}

function section(no, title, body, hint) {
  return h('section', { class: 'card' },
    h('header', { class: 'card-header' }, h('span', { class: 'step' }, no), h('h3', {}, title)),
    hint ? h('p', { class: 'muted small' }, hint) : null,
    body);
}

function renderCapacity(container, draft, rerender) {
  clear(container);
  const capacity = bedCapacity(draft);

  const rows = h('div', { class: 'stack tight' });
  draft.beds.forEach((bed, index) => {
    rows.appendChild(h('div', { class: 'bed-row' },
      select({ onChange: (e) => { draft.beds[index].type = e.target.value; rerender(); } },
        BED_TYPES.map((b) => ({ value: b.key, label: `${b.icon} ${b.label} (${b.sleeps} kişi)` })), bed.type),
      h('input', {
        type: 'number', min: '1', step: '1', value: bed.count, class: 'count',
        onChange: (e) => { draft.beds[index].count = Math.max(1, Number(e.target.value) || 1); rerender(); },
      }),
      h('button', {
        class: 'icon-btn', type: 'button', title: 'Yatağı kaldır',
        onClick: () => { draft.beds.splice(index, 1); rerender(); },
      }, '✕')));
  });

  const options = maxOccupancyOptions(draft);
  if (capacity && draft.maxOccupancy > capacity) draft.maxOccupancy = capacity;
  if (capacity && !draft.maxOccupancy) draft.maxOccupancy = capacity;

  append(container, [
    rows,
    h('button', {
      class: 'btn small ghost', type: 'button',
      onClick: () => { draft.beds.push({ type: 'single', count: 1 }); rerender(); },
    }, '＋ Yatak Ekle'),
    h('div', { class: 'grid-2' },
      field('Yatak Kapasitesi', h('input', { type: 'text', value: `${capacity} kişi`, readOnly: true, class: 'readonly bed-capacity' }),
        bedSummary(draft)),
      field('Maksimum Kişi Sayısı *',
        options.length
          ? select({ class: 'max-occupancy', onChange: (e) => { draft.maxOccupancy = Number(e.target.value); rerender(); } },
            options.map((n) => ({ value: n, label: `${n} Kişi` })), draft.maxOccupancy)
          : h('input', { type: 'text', value: 'Önce yatak ekleyin', readOnly: true, class: 'readonly' }),
        'Rezervasyonda girilecek kişi sayısı bu değeri aşamaz.')),
  ]);
}

function renderSummary(container, draft, app) {
  clear(container);
  const settings = app.store.getState().settings;
  const capacity = bedCapacity(draft);
  const maxGuests = draft.maxOccupancy || capacity;
  const serviceable = serviceableAmenities(draft);

  const method = settings.allocationMethod ?? 'coefficient';
  const methodInfo = ALLOCATION_METHODS.find((m) => m.key === method);
  const loadRows = UTILITY_KINDS.map((kind) => {
    const load = amenityLoad(draft, kind);
    const weight = method === 'equal' ? 1
      : method === 'area' ? (draft.area > 0 ? draft.area : 1)
        : (draft.baseWeight || 1) * load;
    return h('div', { class: 'kv' },
      h('span', {}, UTILITY_LABELS[kind]),
      h('strong', { title: `${formatDecimal(draft.baseWeight || 1)} (çarpan) × ${formatDecimal(load)} (demirbaş)` },
        method === 'area' ? `${formatDecimal(weight)} m²` : `×${formatDecimal(weight)}`));
  });

  append(container, [
    h('h3', {}, '📊 Maliyet Etkisi'),
    h('p', { class: 'muted small' }, `Aktif yöntem: ${methodInfo?.label ?? method}. Dağıtım motoru aşağıdaki ağırlıkları kullanır.`),
    h('div', { class: 'kv-list' }, ...loadRows),
    h('hr'),
    h('div', { class: 'kv' }, h('span', {}, 'Maksimum kapasite'), h('strong', {}, `${maxGuests} kişi`)),
    h('div', { class: 'kv' },
      h('span', {}, 'Tam dolulukta günlük sarfiyat'),
      h('strong', {}, formatMoney(dailyGuestCost(settings, maxGuests)))),
    h('div', { class: 'kv' },
      h('span', {}, 'Gecelik liste fiyatı'),
      h('strong', {}, formatMoney(draft.basePrice))),
    h('hr'),
    h('h4', {}, '🛠️ Bakım gideri yazılabilecek demirbaşlar'),
    serviceable.length
      ? h('div', { class: 'chips' }, ...serviceable.map((a) =>
        h('button', {
          class: 'chip', type: 'button', title: `${a.label} için gider ekle`,
          onClick: () => {
            if (!draft.id || !app.store.getState().rooms.some((r) => r.id === draft.id)) {
              toast('Önce oda kartını kaydedin.', 'warn');
              return;
            }
            app.addExpenseFor(draft.id, a.key);
          },
        }, `${a.icon} ${a.label}`)))
      : h('p', { class: 'muted small' }, 'Henüz servis edilebilir demirbaş seçilmedi.'),
    AMENITY_MAP.jacuzzi && draft.amenities.includes('jacuzzi')
      ? h('p', { class: 'muted small' }, 'ℹ️ Jakuzili odalar elektrik ve su giderlerinden yüksek pay alır.')
      : null,
  ]);
}
