/** Rezervasyon girişi — kişi sayısı, seçilen odanın kapasitesiyle sınırlıdır. */

import { reservationGuestNights, reservationNights, roomLabel } from '../core/model.js';
import { tariffLinesFor } from '../core/costEngine.js';
import { CURRENCIES } from '../core/catalog.js';
import { formatDate, formatMoney } from '../core/format.js';
import { clear, confirmDialog, errorList, field, h, openModal, select, toast } from './dom.js';

const CHANNELS = [
  { value: 'direct', label: 'Direkt' },
  { value: 'booking', label: 'Booking.com' },
  { value: 'airbnb', label: 'Airbnb' },
  { value: 'other', label: 'Diğer' },
];

export function reservationsView(app) {
  const { reservations, rooms, settings } = app.store.getState();
  const p = app.period();

  const rows = reservations.map((res) => {
    const room = rooms.find((r) => r.id === res.roomId);
    const nights = reservationNights(res);
    const tariffTotal = tariffLinesFor(res, p, settings).reduce((s, l) => s + l.amount, 0);
    return h('tr', { class: res.status === 'cancelled' ? 'muted strike' : '' },
      h('td', {}, h('strong', {}, room ? roomLabel(room) : '—')),
      h('td', {}, res.guestName),
      h('td', { class: 'num' }, `${res.guests} kişi`),
      h('td', {}, `${formatDate(res.checkIn)} → ${formatDate(res.checkOut)}`),
      h('td', { class: 'num' }, nights),
      h('td', { class: 'num' }, reservationGuestNights(res)),
      h('td', { class: 'num' }, formatMoney(res.totalAmount, res.currency)),
      h('td', { class: 'num', title: 'Acenta komisyonu' }, res.commissionRate ? `%${res.commissionRate}` : '—'),
      h('td', { class: 'num', title: 'Dönem içi kişi başı sarfiyat (tarife)' }, formatMoney(tariffTotal)),
      h('td', {}, res.breakfastIncluded ? '☕ Dahil' : '—'),
      h('td', {}, h('div', { class: 'row gap' },
        h('button', { class: 'icon-btn', type: 'button', title: 'Düzenle', onClick: () => openReservationForm(app, res) }, '✏️'),
        h('button', {
          class: 'icon-btn', type: 'button', title: 'Sil',
          onClick: () => confirmDialog(`${res.guestName} rezervasyonu silinsin mi?`, () => {
            app.store.deleteReservation(res.id); app.refresh(); toast('Rezervasyon silindi.', 'warn');
          }),
        }, '🗑️'))));
  });

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Rezervasyonlar'),
        h('p', { class: 'muted' }, 'Girilen kişi sayısı, oda kartındaki kapasiteyi aşamaz ve kişi başı maliyet algoritmasını tetikler.')),
      h('button', { class: 'btn primary', type: 'button', onClick: () => openReservationForm(app, null) }, '＋ Yeni Rezervasyon')),
    h('div', { class: 'card table-card' },
      h('table', {},
        h('thead', {}, h('tr', {},
          ...['Oda', 'Misafir', 'Kişi', 'Tarih', 'Gece', 'Kişi-Gece', 'Tutar', 'Kom.', 'Sarfiyat', 'Kahvaltı', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: '11', class: 'empty' }, 'Kayıt yok.'))])))));
}

export function openReservationForm(app, source) {
  const { rooms } = app.store.getState();
  const draft = {
    id: source?.id,
    roomId: source?.roomId || rooms.find((r) => r.status === 'active')?.id || '',
    guestName: source?.guestName || '',
    guests: source?.guests || 1,
    checkIn: source?.checkIn || '',
    checkOut: source?.checkOut || '',
    totalAmount: source?.totalAmount ?? 0,
    currency: source?.currency || 'TRY',
    commissionRate: source?.commissionRate ?? 0,
    channel: source?.channel || 'direct',
    breakfastIncluded: source?.breakfastIncluded !== false,
    status: source?.status || 'confirmed',
    notes: source?.notes || '',
  };

  openModal({
    title: source ? 'Rezervasyonu Düzenle' : 'Yeni Rezervasyon',
    size: 'md',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      const guestsBox = h('div', {});
      let commissionInput;

      const renderGuests = () => {
        clear(guestsBox);
        const room = app.store.getState().rooms.find((r) => r.id === draft.roomId);
        const max = room?.maxOccupancy || 0;
        if (draft.guests > max) draft.guests = max || 1;
        guestsBox.appendChild(field('Konaklayan Kişi Sayısı *',
          max
            ? select({ class: 'guests-select', onChange: (e) => { draft.guests = Number(e.target.value); renderGuests(); } },
              Array.from({ length: max }, (_, i) => ({ value: i + 1, label: `${i + 1} Kişi` })), draft.guests)
            : h('input', { type: 'text', readOnly: true, class: 'readonly', value: 'Önce oda seçin' }),
          room ? `Kapasite: ${room.maxOccupancy} kişi · Kişi başı sarfiyat bu sayıya göre hesaplanır.` : ''));
      };
      renderGuests();

      const form = h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
        errorBox,
        field('Oda *', select({ class: 'room-select', onChange: (e) => { draft.roomId = e.target.value; renderGuests(); } },
          rooms.map((r) => ({ value: r.id, label: `${roomLabel(r)} · maks. ${r.maxOccupancy} kişi` })), draft.roomId)),
        field('Misafir Adı *', h('input', {
          type: 'text', value: draft.guestName, onInput: (e) => { draft.guestName = e.target.value; },
        })),
        guestsBox,
        h('div', { class: 'grid-2' },
          field('Giriş *', h('input', { type: 'date', value: draft.checkIn, onInput: (e) => { draft.checkIn = e.target.value; } })),
          field('Çıkış *', h('input', { type: 'date', value: draft.checkOut, onInput: (e) => { draft.checkOut = e.target.value; } })),
          field('Toplam Tutar', h('input', {
            type: 'number', min: '0', step: '50', value: draft.totalAmount,
            onInput: (e) => { draft.totalAmount = Number(e.target.value); },
          })),
          field('Para Birimi', select({ class: 'res-currency', onChange: (e) => { draft.currency = e.target.value; } },
            CURRENCIES.map((c) => ({ value: c.key, label: `${c.symbol} ${c.key}` })), draft.currency)),
          field('Kanal', select({
            onChange: (e) => {
              draft.channel = e.target.value;
              const rate = { booking: 15, airbnb: 14 }[draft.channel] ?? 0;
              draft.commissionRate = rate;
              commissionInput.value = String(rate);
            },
          }, CHANNELS, draft.channel)),
          field('Komisyon Oranı (%)', (commissionInput = h('input', {
            type: 'number', min: '0', max: '100', step: '1', value: draft.commissionRate,
            onInput: (e) => { draft.commissionRate = Number(e.target.value); },
          })), 'Net gelirden düşülür (PRD §2.2 Pazarlama & Komisyon).')),
        h('label', { class: 'check-inline' },
          h('input', { type: 'checkbox', checked: draft.breakfastIncluded, onChange: (e) => { draft.breakfastIncluded = e.target.checked; } }),
          'Kahvaltı dahil (kişi başı kahvaltı maliyeti bu odaya yazılır)'),
        h('label', { class: 'check-inline' },
          h('input', { type: 'checkbox', checked: draft.status === 'cancelled', onChange: (e) => { draft.status = e.target.checked ? 'cancelled' : 'confirmed'; } }),
          'İptal edildi'),
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'submit',
            onClick: () => {
              try {
                app.store.saveReservation(draft);
                toast('Rezervasyon kaydedildi.');
                close();
                app.refresh();
              } catch (err) {
                clear(errorBox).appendChild(errorList(err.errors ?? [err.message]));
                errorBox.classList.remove('hidden');
              }
            },
          }, 'Kaydet')));
      return form;
    },
  });
}
