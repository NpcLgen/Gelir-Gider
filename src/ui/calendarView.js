/**
 * Fiyatlandırma / Gelir Takvimi (PRD §1.1, §6.2).
 * Odalar × günler tablosu: hücreye tıklayarak fiyat girilir, toplu güncelleme,
 * kopyalama ve eksik gün vurgulama araçları üst şeritte yer alır.
 */

import { CURRENCIES } from '../core/catalog.js';
import { priceVerdict } from '../core/costEngine.js';
import { addDays, eachDate, isWeekend, monthPeriod, shiftMonth } from '../core/dates.js';
import { roomLabel } from '../core/model.js';
import { formatPercent } from '../core/format.js';
import { append, clear, errorList, field, h, openModal, select, toast } from './dom.js';

const dayNames = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const weekdayOf = (date) => new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay();

let highlightMissing = false;

export function calendarView(app) {
  const { rooms, prices, settings } = app.store.getState();
  const p = app.period();
  const dates = eachDate(p);
  const sellable = rooms.filter((r) => r.status !== 'passive');
  const report = app.report();
  const present = app.present();

  const occupancy = buildOccupancyIndex(app.store.getState().reservations);

  const head = h('tr', {}, h('th', { class: 'sticky-col' }, 'Oda'),
    ...dates.map((date) => h('th', {
      class: `cal-head${isWeekend(date) ? ' weekend' : ''}`,
      title: date,
    }, h('div', {}, date.slice(-2)), h('div', { class: 'micro' }, dayNames[weekdayOf(date)]))));

  const pricingOf = (roomId) => report.rooms.find((r) => r.room.id === roomId)?.pricing;

  const body = sellable.map((room) => {
    const pricing = pricingOf(room.id);
    return h('tr', {},
      h('th', { class: 'sticky-col' }, h('div', {}, roomLabel(room)),
        h('div', { class: 'micro muted' },
          pricing ? `alt limit ${present.money(pricing.floor)} · başa baş ${present.money(pricing.breakEven)}` : `maks. ${room.maxOccupancy} kişi`)),
      ...dates.map((date) => {
        const entry = prices?.[room.id]?.[date];
        const filled = entry?.amount > 0;
        const booked = occupancy.get(`${room.id}|${date}`);
        const base = filled ? baseOf(entry, present) : 0;
        const verdict = filled ? priceVerdict(base, pricing) : 'ok';
        const classes = ['cal-cell'];
        classes.push(filled ? 'filled' : 'missing');
        if (filled && verdict !== 'ok') classes.push(`price-${verdict}`);
        if (!filled && highlightMissing) classes.push('flag');
        if (booked) classes.push('booked');
        if (isWeekend(date)) classes.push('weekend');
        return h('td', {},
          h('button', {
            class: classes.join(' '), type: 'button',
            title: cellTitle({ date, booked, filled, verdict, pricing, present }),
            onClick: () => openPriceEditor(app, room, date, entry),
          },
            filled ? present.money(base) : '—',
            verdict === 'loss' ? h('span', { class: 'cal-warn' }, '⚠') : null,
            verdict === 'below' ? h('span', { class: 'cal-warn' }, '!') : null,
            booked ? h('span', { class: 'cal-dot', title: booked }) : null));
      }));
  });

  const coverage = report.totals.priceCoverage;

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Fiyatlandırma / Gelir Takvimi'),
        h('p', { class: 'muted' }, 'Hücreye tıklayarak günlük fiyat girin. Maliyetinin altında kalan fiyatlar işaretlenir.')),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn', type: 'button', onClick: () => openBulkEditor(app) }, '⚡ Toplu Güncelle'),
        h('button', { class: 'btn', type: 'button', onClick: () => openCopyEditor(app) }, '📋 Fiyatları Kopyala'),
        h('button', {
          class: `btn${highlightMissing ? ' primary' : ''}`, type: 'button',
          onClick: () => { highlightMissing = !highlightMissing; app.refresh(); },
        }, '🚩 Boş Günleri Vurgula'))),

    h('div', { class: 'kpi-grid' },
      kpi('Takvim Hedef Geliri', present.money(report.totals.projectedRevenue), 'Tüm odalar tam dolu satılsaydı'),
      kpi('Gerçekleşen Gelir', present.money(report.totals.revenue), formatPercent(
        report.totals.projectedRevenue > 0 ? report.totals.revenue / report.totals.projectedRevenue : 0,
      ) + ' gerçekleşme'),
      kpi('Fiyat Girilme Oranı', formatPercent(coverage), `${report.totals.missingPriceDays} gün eksik`,
        coverage >= 1 ? 'good' : 'bad')),

    h('div', { class: 'card legend-bar' },
      legendItem('filled', 'Fiyat girilmiş'),
      legendItem('missing', 'Eksik gün'),
      legendItem('price-below', 'Başa baş fiyatın altında', '!'),
      legendItem('price-loss', 'Alt limitin altında — zarar', '⚠'),
      h('span', { class: 'muted small' }, '● dolu oda')),

    h('div', { class: 'card table-card calendar-wrap' },
      h('table', { class: 'calendar' }, h('thead', {}, head), h('tbody', {}, ...body))));
}

const baseOf = (entry, present) => (entry.currency === 'EUR' ? entry.amount * present.rate : entry.amount);

const VERDICT_TEXT = {
  loss: 'ALT LİMİTİN ALTINDA — bu fiyatla satılan her gece doğrudan zarar',
  below: 'Başa baş fiyatın altında — sabit giderleri karşılamıyor',
  'under-target': 'Hedef kâr marjının altında',
  ok: 'Hedef marjın üzerinde',
};

function cellTitle({ date, booked, filled, verdict, pricing, present }) {
  const lines = [date];
  if (booked) lines.push(booked);
  if (filled && pricing) {
    lines.push(VERDICT_TEXT[verdict]);
    lines.push(`Alt limit: ${present.money(pricing.floor)} · Başa baş: ${present.money(pricing.breakEven)} · Tavsiye: ${present.money(pricing.recommended)}`);
  }
  return lines.join('\n');
}

function legendItem(className, label, mark) {
  return h('span', { class: 'legend-chip' },
    h('span', { class: `legend-swatch sw-${className}` }, mark || ''),
    h('span', { class: 'small' }, label));
}

function kpi(label, value, hint, tone) {
  return h('div', { class: 'card kpi' },
    h('span', { class: 'muted small' }, label),
    h('strong', { class: tone || '' }, value),
    h('span', { class: 'muted small' }, hint));
}

function buildOccupancyIndex(reservations) {
  const index = new Map();
  for (const reservation of reservations) {
    if (reservation.status === 'cancelled') continue;
    let date = reservation.checkIn;
    while (date && date < reservation.checkOut) {
      index.set(`${reservation.roomId}|${date}`, `${reservation.guestName} (${reservation.guests} kişi)`);
      date = addDays(date, 1);
    }
  }
  return index;
}

export function openPriceEditor(app, room, date, entry) {
  const draft = { amount: entry?.amount ?? room.basePrice, currency: entry?.currency ?? 'TRY' };
  const present = app.present();
  const pricing = app.report().rooms.find((r) => r.room.id === room.id)?.pricing;

  openModal({
    title: `${roomLabel(room)} · ${date}`,
    subtitle: 'Bu gecenin satış fiyatı',
    size: 'sm',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      const advice = h('div', { class: 'price-advice' });

      const baseAmount = () => (draft.currency === 'EUR' ? draft.amount * present.rate : draft.amount);

      const renderAdvice = () => {
        clear(advice);
        if (!pricing) return;
        const verdict = priceVerdict(baseAmount(), pricing);
        const rows = [
          ['Alt limit (değişken maliyet)', pricing.floor, 'Bu fiyatın altında her gece doğrudan zarar.'],
          ['Başa baş fiyat', pricing.breakEven, `Sabit gider payı dâhil (%${Math.round(pricing.plannedOccupancy * 100)} doluluk varsayımı).`],
          ['Tavsiye edilen fiyat', pricing.recommended, `%${Math.round(pricing.targetMargin * 100)} hedef kâr marjıyla.`],
        ];
        append(advice, [
          h('div', { class: `verdict verdict-${verdict}` },
            h('strong', {}, VERDICT_ICON[verdict] + ' ' + VERDICT_TITLE[verdict]),
            h('span', { class: 'small' }, VERDICT_TEXT[verdict])),
          h('div', { class: 'kv-list' }, ...rows.map(([label, value, hint]) =>
            h('div', { class: 'kv' },
              h('span', { title: hint }, label),
              h('strong', {}, present.money(value))))),
          pricing.costPerSoldNight != null
            ? h('p', { class: 'muted small' },
              `Bu odanın dönemdeki gerçekleşen gecelik maliyeti: ${present.money(pricing.costPerSoldNight)}.`)
            : h('p', { class: 'muted small' }, 'Bu odada dönem içinde satış yok; eşikler tarife ve gider payından tahmin edildi.'),
          h('div', { class: 'row gap wrap' },
            h('button', {
              class: 'btn small ghost', type: 'button',
              onClick: () => { setAmount(toEntryCurrency(pricing.breakEven)); },
            }, `Başa başa ayarla`),
            h('button', {
              class: 'btn small primary', type: 'button',
              onClick: () => { setAmount(toEntryCurrency(pricing.recommended)); },
            }, `Tavsiyeye ayarla`)),
        ]);
      };

      // Eşiğin altına düşmemek için yukarı yuvarlanır: 3.631,85 → 3.640
      const toEntryCurrency = (baseValue) =>
        Math.ceil((draft.currency === 'EUR' ? baseValue / present.rate : baseValue) / 10) * 10;

      const amountInput = h('input', {
        type: 'number', min: '0', step: 'any', value: draft.amount, autofocus: true, class: 'price-amount',
        onInput: (e) => { draft.amount = Number(e.target.value); renderAdvice(); },
      });

      const setAmount = (value) => {
        draft.amount = value;
        amountInput.value = String(value);
        renderAdvice();
      };

      renderAdvice();

      const save = () => {
        try {
          app.store.savePrice(room.id, date, draft);
          close();
          app.refresh();
        } catch (err) {
          clear(errorBox).appendChild(errorList(err.errors ?? [err.message]));
          errorBox.classList.remove('hidden');
        }
      };

      return h('form', { class: 'stack', onSubmit: (e) => { e.preventDefault(); save(); } },
        errorBox,
        h('div', { class: 'grid-2' },
          field('Fiyat', amountInput),
          field('Para Birimi', select({
            onChange: (e) => { draft.currency = e.target.value; renderAdvice(); },
          }, CURRENCIES.map((c) => ({ value: c.key, label: `${c.symbol} ${c.key}` })), draft.currency))),
        advice,
        h('div', { class: 'row end gap' },
          entry ? h('button', {
            class: 'btn danger ghost', type: 'button',
            onClick: () => { app.store.clearPrice(room.id, date); close(); app.refresh(); },
          }, 'Fiyatı Sil') : null,
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          // onClick açıkça verilir: tarayıcının form doğrulaması kaydetmeyi sessizce engellemesin.
          h('button', { class: 'btn primary', type: 'submit', onClick: save }, 'Kaydet')));
    },
  });
}

const VERDICT_ICON = { loss: '⛔', below: '⚠️', 'under-target': '⚑', ok: '✔' };
const VERDICT_TITLE = {
  loss: 'ZARAR',
  below: 'Başa başın altında',
  'under-target': 'Hedefin altında',
  ok: 'Hedefe uygun',
};

export function openBulkEditor(app) {
  const { rooms } = app.store.getState();
  const p = app.period();
  const sellable = rooms.filter((r) => r.status !== 'passive');
  const draft = {
    roomIds: sellable.map((r) => r.id),
    from: p.from,
    to: p.to,
    weekdayAmount: 0,
    weekendAmount: 0,
    currency: 'TRY',
    overwrite: true,
  };

  openModal({
    title: 'Toplu Fiyat Güncelleme',
    subtitle: 'Seçilen tarih aralığına hafta içi / hafta sonu fiyatlarını tek seferde uygular.',
    size: 'md',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      const roomBox = h('div', { class: 'chip-checks' }, ...sellable.map((room) =>
        h('label', { class: 'chip chip-check checked' },
          h('input', {
            type: 'checkbox', checked: true,
            onChange: (e) => {
              draft.roomIds = e.target.checked
                ? [...new Set([...draft.roomIds, room.id])]
                : draft.roomIds.filter((id) => id !== room.id);
              e.target.closest('.chip').classList.toggle('checked', e.target.checked);
            },
          }), roomLabel(room))));

      return h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
        errorBox,
        h('div', { class: 'grid-2' },
          field('Başlangıç', h('input', { type: 'date', value: draft.from, onInput: (e) => { draft.from = e.target.value; } })),
          field('Bitiş', h('input', { type: 'date', value: draft.to, onInput: (e) => { draft.to = e.target.value; } })),
          field('Hafta İçi Fiyatı', h('input', {
            type: 'number', min: '0', step: 'any', placeholder: '0',
            onInput: (e) => { draft.weekdayAmount = Number(e.target.value); },
          }), 'Pazar–Perşembe geceleri'),
          field('Hafta Sonu Fiyatı', h('input', {
            type: 'number', min: '0', step: 'any', placeholder: '0',
            onInput: (e) => { draft.weekendAmount = Number(e.target.value); },
          }), 'Cuma–Cumartesi geceleri'),
          field('Para Birimi', select({ onChange: (e) => { draft.currency = e.target.value; } },
            CURRENCIES.map((c) => ({ value: c.key, label: `${c.symbol} ${c.key}` })), draft.currency))),
        h('label', { class: 'check-inline' },
          h('input', { type: 'checkbox', checked: true, onChange: (e) => { draft.overwrite = e.target.checked; } }),
          'Dolu günlerin fiyatını da güncelle'),
        field('Odalar', roomBox),
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'submit',
            onClick: () => {
              try {
                const written = app.store.bulkPrice(draft);
                toast(`${written} güne fiyat uygulandı.`);
                close();
                app.refresh();
              } catch (err) {
                clear(errorBox).appendChild(errorList(err.errors ?? [err.message]));
                errorBox.classList.remove('hidden');
              }
            },
          }, 'Uygula')));
    },
  });
}

export function openCopyEditor(app) {
  const { rooms } = app.store.getState();
  const p = app.period();
  const sellable = rooms.filter((r) => r.status !== 'passive');

  const run = (mode, close) => {
    const roomIds = sellable.map((r) => r.id);
    let payload;
    if (mode === 'week') {
      payload = {
        roomIds,
        sourceFrom: addDays(p.from, -7), sourceTo: addDays(p.from, -1),
        targetFrom: p.from, overwrite: false,
      };
    } else {
      const previous = monthPeriod(shiftMonth(p.from.slice(0, 7), -1));
      payload = { roomIds, sourceFrom: previous.from, sourceTo: previous.to, targetFrom: p.from, overwrite: false };
    }
    const written = app.store.copyPrices(payload);
    toast(written ? `${written} güne fiyat kopyalandı.` : 'Kopyalanacak fiyat bulunamadı.', written ? 'ok' : 'warn');
    close();
    app.refresh();
  };

  openModal({
    title: 'Fiyatları Kopyala',
    subtitle: 'Boş takvim günlerini geçmiş fiyatlarla hızlıca doldurur (dolu günler korunur).',
    size: 'sm',
    content: (close) => h('div', { class: 'stack' },
      h('button', { class: 'btn', type: 'button', onClick: () => run('week', close) }, '📅 Geçen Haftayı Kopyala'),
      h('button', { class: 'btn', type: 'button', onClick: () => run('month', close) }, '🗓️ Geçen Ayı Kopyala'),
      h('p', { class: 'muted small' }, 'Kaynak aralıktaki fiyatlar, dönemin başından itibaren gün gün yazılır.')),
  });
}
