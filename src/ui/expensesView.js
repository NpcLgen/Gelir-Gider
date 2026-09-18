/**
 * Gider Yönetimi (PRD §1.2, §2.3, §6.3, §7.2).
 * Aktif/pasif anahtarı, dekont eki, tekrarlayan gider, kategori/grup filtreleri.
 */

import {
  ALLOCATIONS, AMENITY_MAP, CURRENCIES, EXPENSE_GROUPS, EXPENSE_GROUP_MAP,
  UTILITY_KINDS, UTILITY_LABELS,
} from '../core/catalog.js';
import { allCategories, categoryOf, roomLabel, serviceableAmenities } from '../core/model.js';
import { formatDate, formatMoney } from '../core/format.js';
import { clear, confirmDialog, errorList, field, h, openModal, select, toast } from './dom.js';

const filters = { groups: new Set(), search: '', showPassive: true, onlyRecurring: false };

export function expensesView(app) {
  const { expenses, rooms, settings } = app.store.getState();
  const present = app.present();
  const p = app.period();

  const visible = expenses.filter((expense) => {
    if (!filters.showPassive && !expense.active) return false;
    if (filters.onlyRecurring && !expense.recurring?.enabled) return false;
    if (filters.groups.size && !filters.groups.has(categoryOf(settings, expense.category).group)) return false;
    if (filters.search) {
      const needle = filters.search.toLocaleLowerCase('tr');
      const hay = `${expense.description} ${expense.vendor}`.toLocaleLowerCase('tr');
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const inPeriod = visible.filter((e) => e.date >= p.from && e.date <= p.to);
  const periodTotal = app.report().totals.expenses;

  const rows = visible.map((expense) => {
    const room = rooms.find((r) => r.id === expense.roomId);
    const allocation = ALLOCATIONS.find((a) => a.key === expense.allocation);
    const category = categoryOf(settings, expense.category);
    const group = EXPENSE_GROUP_MAP[category.group];
    return h('tr', { class: expense.active ? '' : 'passive-row' },
      h('td', {}, h('button', {
        class: `toggle${expense.active ? ' on' : ''}`, type: 'button',
        title: expense.active ? 'Aktif — hesaplamaya dâhil' : 'Pasif — hesaplamadan düşüldü',
        'aria-pressed': String(expense.active),
        onClick: () => {
          const next = app.store.toggleExpense(expense.id);
          toast(next.active ? 'Gider aktifleştirildi.' : 'Gider pasife alındı, hesaplamadan düşüldü.', next.active ? 'ok' : 'warn');
          app.refresh();
        },
      }, h('span', { class: 'toggle-knob' }))),
      h('td', {}, formatDate(expense.date),
        expense.recurring?.enabled
          ? h('div', { class: 'micro muted' }, `🔁 her ayın ${expense.recurring.dayOfMonth}. günü`)
          : null),
      h('td', {},
        h('span', { class: 'group-dot', style: { background: group?.color }, title: group?.label }),
        category.label),
      h('td', {},
        h('strong', {}, expense.description),
        expense.vendor ? h('div', { class: 'muted small' }, expense.vendor) : null),
      h('td', {},
        allocation?.label ?? expense.allocation,
        expense.allocation === 'weighted' ? h('div', { class: 'muted small' }, UTILITY_LABELS[expense.weightKind]) : null),
      h('td', {},
        room ? roomLabel(room) : h('span', { class: 'muted' }, '—'),
        expense.amenityKey ? h('div', { class: 'muted small' }, `${AMENITY_MAP[expense.amenityKey].icon} ${AMENITY_MAP[expense.amenityKey].label}`) : null),
      h('td', { class: 'num' }, formatMoney(expense.amount, expense.currency),
        expense.currency !== 'TRY' ? h('div', { class: 'micro muted' }, present.money(expense.amount * settings.fx.rate)) : null),
      h('td', {}, h('div', { class: 'row gap' },
        expense.attachment
          ? h('a', {
            class: 'icon-btn', href: expense.attachment.dataUrl, target: '_blank',
            download: expense.attachment.name, title: `Dekont: ${expense.attachment.name}`,
          }, '📎')
          : h('button', {
            class: 'icon-btn faded', type: 'button', title: 'Dekont/fiş ekle',
            onClick: () => openExpenseForm(app, expense),
          }, '📎'),
        h('button', {
          class: `icon-btn${expense.recurring?.enabled ? ' active' : ''}`, type: 'button',
          title: expense.recurring?.enabled ? 'Tekrarlayan gider' : 'Tekrarlanır yap',
          onClick: () => openRecurringDialog(app, expense),
        }, '🔁'),
        h('button', { class: 'icon-btn', type: 'button', title: 'Düzenle', onClick: () => openExpenseForm(app, expense) }, '✏️'),
        h('button', {
          class: 'icon-btn', type: 'button', title: 'Sil',
          onClick: () => confirmDialog(`"${expense.description}" gideri silinsin mi?`, () => {
            app.store.deleteExpense(expense.id); app.refresh(); toast('Gider silindi.', 'warn');
          }),
        }, '🗑️'))));
  });

  const groupFilters = h('div', { class: 'chip-checks' }, ...EXPENSE_GROUPS.map((group) =>
    h('label', { class: `chip chip-check${filters.groups.has(group.key) ? ' checked' : ''}` },
      h('input', {
        type: 'checkbox', checked: filters.groups.has(group.key),
        onChange: (e) => {
          if (e.target.checked) filters.groups.add(group.key); else filters.groups.delete(group.key);
          app.refresh();
        },
      }),
      h('span', { class: 'swatch', style: { background: group.color } }), group.label)));

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Gider Yönetimi'),
        h('p', { class: 'muted' }, 'Pasife alınan gider silinmez, yalnızca kârlılık hesabından düşer.')),
      h('button', { class: 'btn primary', type: 'button', onClick: () => openExpenseForm(app, null) }, '＋ Yeni Gider')),

    h('div', { class: 'card filter-bar' },
      groupFilters,
      h('input', {
        type: 'search', placeholder: 'Açıklama veya tedarikçi ara…', value: filters.search, class: 'search',
        onInput: (e) => { filters.search = e.target.value; app.refresh(); },
      }),
      h('label', { class: 'check-inline small' },
        h('input', {
          type: 'checkbox', checked: filters.onlyRecurring,
          onChange: (e) => { filters.onlyRecurring = e.target.checked; app.refresh(); },
        }), 'Sadece tekrarlayanlar'),
      h('label', { class: 'check-inline small' },
        h('input', {
          type: 'checkbox', checked: filters.showPassive,
          onChange: (e) => { filters.showPassive = e.target.checked; app.refresh(); },
        }), 'Pasifleri göster')),

    h('p', { class: 'muted small' },
      `${visible.length} kayıt listeleniyor · dönem içi ${inPeriod.length} kalem · dönem gider toplamı ${present.money(periodTotal)} (tekrarlayanlar dâhil)`),

    h('div', { class: 'card table-card' },
      h('table', {},
        h('thead', {}, h('tr', {}, ...['', 'Tarih', 'Kategori', 'Açıklama', 'Dağıtım', 'Oda / Demirbaş', 'Tutar', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: '8', class: 'empty' }, 'Kayıt yok.'))])))));
}

function openRecurringDialog(app, expense) {
  const draft = { ...expense.recurring, enabled: expense.recurring?.enabled ?? false };
  openModal({
    title: 'Tekrarlayan Gider',
    subtitle: `${expense.description} — abonelik/otomatik yansıtma ayarı`,
    size: 'sm',
    content: (close) => h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
      h('label', { class: 'check-inline' },
        h('input', {
          type: 'checkbox', checked: draft.enabled,
          onChange: (e) => { draft.enabled = e.target.checked; },
        }), 'Her ay otomatik yansıt'),
      field('Ayın kaçıncı günü', h('input', {
        type: 'number', min: '1', max: '28', value: draft.dayOfMonth ?? 1,
        onInput: (e) => { draft.dayOfMonth = Number(e.target.value); },
      }), '1–28 arası (her ayda mevcut olan günler).'),
      field('Bitiş tarihi (opsiyonel)', h('input', {
        type: 'date', value: draft.until || '',
        onInput: (e) => { draft.until = e.target.value; },
      })),
      h('div', { class: 'row end gap' },
        h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
        h('button', {
          class: 'btn primary', type: 'submit',
          onClick: () => {
            try {
              app.store.saveExpense({ ...expense, recurring: draft });
              toast(draft.enabled ? 'Gider her ay otomatik yansıyacak.' : 'Tekrarlama kapatıldı.');
              close();
              app.refresh();
            } catch (err) {
              toast((err.errors ?? [err.message]).join(' '), 'error');
            }
          },
        }, 'Kaydet'))),
  });
}

export function openExpenseForm(app, source, preset = {}) {
  const { rooms, settings } = app.store.getState();
  const categories = allCategories(settings);
  const today = new Date().toISOString().slice(0, 10);
  const startCategory = source?.category || preset.category || 'maintenance';
  const draft = {
    id: source?.id,
    date: source?.date || today,
    category: startCategory,
    description: source?.description || '',
    amount: source?.amount ?? 0,
    currency: source?.currency || 'TRY',
    active: source?.active !== false,
    allocation: source?.allocation || preset.allocation || categoryOf(settings, startCategory).defaults.allocation,
    weightKind: source?.weightKind || 'electricity',
    roomId: source?.roomId || preset.roomId || '',
    amenityKey: source?.amenityKey || preset.amenityKey || '',
    vendor: source?.vendor || '',
    recurring: source?.recurring || { enabled: false, dayOfMonth: 1, until: '' },
    attachment: source?.attachment || null,
  };

  openModal({
    title: source ? 'Gideri Düzenle' : 'Yeni Gider',
    size: 'md',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      const targetBox = h('div', { class: 'stack tight' });
      const attachmentBox = h('div', { class: 'stack tight' });
      let allocationSelect;

      const renderAttachment = () => {
        clear(attachmentBox);
        attachmentBox.appendChild(field('Dekont / Fiş',
          h('div', { class: 'row gap center wrap' },
            h('label', { class: 'btn small ghost file-btn' }, '📎 Dosya Seç',
              h('input', {
                type: 'file', accept: 'image/*,application/pdf', hidden: true,
                onChange: (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 3 * 1024 * 1024) { toast('Dosya 3 MB’den küçük olmalı.', 'error'); return; }
                  const reader = new FileReader();
                  reader.onload = () => {
                    draft.attachment = { name: file.name, type: file.type, dataUrl: String(reader.result) };
                    renderAttachment();
                  };
                  reader.readAsDataURL(file);
                },
              })),
            draft.attachment
              ? h('span', { class: 'row gap center' },
                h('a', { href: draft.attachment.dataUrl, target: '_blank', download: draft.attachment.name }, draft.attachment.name),
                h('button', {
                  class: 'icon-btn', type: 'button', title: 'Kaldır',
                  onClick: () => { draft.attachment = null; renderAttachment(); },
                }, '✕'))
              : h('span', { class: 'muted small' }, 'Fatura veya fiş (PDF/JPEG, maks. 3 MB)'))));
      };
      renderAttachment();

      const renderTarget = () => {
        clear(targetBox);
        const allocation = ALLOCATIONS.find((a) => a.key === draft.allocation);
        if (allocation?.needsRoom) {
          const room = rooms.find((r) => r.id === draft.roomId);
          const amenities = room ? serviceableAmenities(room) : [];
          if (draft.amenityKey && !amenities.some((a) => a.key === draft.amenityKey)) draft.amenityKey = '';
          targetBox.appendChild(field('Oda *', select({ class: 'expense-room', onChange: (e) => { draft.roomId = e.target.value; renderTarget(); } },
            [{ value: '', label: 'Oda seçin…' }, ...rooms.map((r) => ({ value: r.id, label: roomLabel(r) }))], draft.roomId)));
          targetBox.appendChild(field('Demirbaş (opsiyonel)',
            select({ class: 'expense-amenity', onChange: (e) => { draft.amenityKey = e.target.value; } },
              [{ value: '', label: 'Demirbaş seçilmedi' }, ...amenities.map((a) => ({ value: a.key, label: `${a.icon} ${a.label}` }))],
              draft.amenityKey),
            room ? 'Yalnızca bu odanın kartında işaretli demirbaşlar listelenir.' : 'Önce oda seçin.'));
        }
        if (allocation?.needsKind) {
          targetBox.appendChild(field('Gider Türü *',
            select({ onChange: (e) => { draft.weightKind = e.target.value; } },
              UTILITY_KINDS.map((k) => ({ value: k, label: UTILITY_LABELS[k] })), draft.weightKind),
            'Odaların dağıtım katsayılarına göre ağırlıklı paylaştırılır.'));
        }
        if (draft.allocation === 'perGuest') {
          targetBox.appendChild(h('p', { class: 'muted small' }, 'Tutar, dönem içindeki kişi-gece sayılarına göre odalara paylaştırılır.'));
        }
        if (draft.allocation === 'general') {
          targetBox.appendChild(h('p', { class: 'muted small' }, 'Bu gider odalara dağıtılmaz; işletme geneli olarak raporlanır.'));
        }
      };
      renderTarget();

      return h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
        errorBox,
        h('div', { class: 'grid-3' },
          field('Tarih *', h('input', { type: 'date', value: draft.date, onInput: (e) => { draft.date = e.target.value; } })),
          field('Tutar *', h('input', {
            type: 'number', min: '0', step: 'any', value: draft.amount,
            onInput: (e) => { draft.amount = Number(e.target.value); },
          })),
          field('Para Birimi', select({ onChange: (e) => { draft.currency = e.target.value; } },
            CURRENCIES.map((c) => ({ value: c.key, label: `${c.symbol} ${c.key}` })), draft.currency))),
        field('Kategori *', select({
          class: 'expense-category',
          onChange: (e) => {
            draft.category = e.target.value;
            const defaults = categoryOf(settings, draft.category).defaults;
            draft.allocation = defaults.allocation;
            if (defaults.weightKind) draft.weightKind = defaults.weightKind;
            allocationSelect.value = draft.allocation;
            renderTarget();
          },
        }, categories.map((c) => ({ value: c.key, label: c.label })), draft.category)),
        field('Açıklama *', h('input', {
          type: 'text', value: draft.description, placeholder: 'Jakuzi motor arızası - işçilik',
          onInput: (e) => { draft.description = e.target.value; },
        })),
        field('Tedarikçi', h('input', { type: 'text', value: draft.vendor, onInput: (e) => { draft.vendor = e.target.value; } })),
        field('Dağıtım Yöntemi *', (allocationSelect = select({
          class: 'expense-allocation',
          onChange: (e) => { draft.allocation = e.target.value; renderTarget(); },
        }, ALLOCATIONS.map((a) => ({ value: a.key, label: a.label })), draft.allocation))),
        targetBox,
        attachmentBox,
        h('label', { class: 'check-inline' },
          h('input', {
            type: 'checkbox', checked: draft.recurring.enabled,
            onChange: (e) => { draft.recurring = { ...draft.recurring, enabled: e.target.checked, dayOfMonth: Number(draft.date.slice(-2)) || 1 }; },
          }), 'Her ay otomatik tekrarla (abonelik)'),
        h('label', { class: 'check-inline' },
          h('input', { type: 'checkbox', checked: draft.active, onChange: (e) => { draft.active = e.target.checked; } }),
          'Aktif (kârlılık hesabına dâhil)'),
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'submit',
            onClick: () => {
              try {
                app.store.saveExpense(draft);
                toast('Gider kaydedildi.');
                close();
                app.refresh();
              } catch (err) {
                clear(errorBox).appendChild(errorList(err.errors ?? [err.message]));
                errorBox.classList.remove('hidden');
              }
            },
          }, 'Kaydet')));
    },
  });
}
