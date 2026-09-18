/** Gider girişi — bakım giderleri doğrudan odaya ve odadaki demirbaşa yönlendirilir. */

import { ALLOCATIONS, AMENITY_MAP, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_MAP, UTILITY_KINDS, UTILITY_LABELS } from '../core/catalog.js';
import { roomLabel, serviceableAmenities } from '../core/model.js';
import { formatDate, formatMoney } from '../core/format.js';
import { clear, confirmDialog, errorList, field, h, openModal, select, toast } from './dom.js';

export function expensesView(app) {
  const { expenses, rooms } = app.store.getState();

  const rows = expenses.map((expense) => {
    const room = rooms.find((r) => r.id === expense.roomId);
    const allocation = ALLOCATIONS.find((a) => a.key === expense.allocation);
    return h('tr', {},
      h('td', {}, formatDate(expense.date)),
      h('td', {}, EXPENSE_CATEGORY_MAP[expense.category]?.label ?? expense.category),
      h('td', {},
        h('strong', {}, expense.description),
        expense.vendor ? h('div', { class: 'muted small' }, expense.vendor) : null),
      h('td', {},
        allocation?.label ?? expense.allocation,
        expense.allocation === 'weighted' ? h('div', { class: 'muted small' }, UTILITY_LABELS[expense.weightKind]) : null),
      h('td', {},
        room ? roomLabel(room) : h('span', { class: 'muted' }, '—'),
        expense.amenityKey ? h('div', { class: 'muted small' }, `${AMENITY_MAP[expense.amenityKey].icon} ${AMENITY_MAP[expense.amenityKey].label}`) : null),
      h('td', { class: 'num' }, formatMoney(expense.amount)),
      h('td', { class: 'row gap' },
        h('button', { class: 'icon-btn', type: 'button', title: 'Düzenle', onClick: () => openExpenseForm(app, expense) }, '✏️'),
        h('button', {
          class: 'icon-btn', type: 'button', title: 'Sil',
          onClick: () => confirmDialog(`"${expense.description}" gideri silinsin mi?`, () => {
            app.store.deleteExpense(expense.id); app.refresh(); toast('Gider silindi.', 'warn');
          }),
        }, '🗑️')));
  });

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Giderler'),
        h('p', { class: 'muted' }, 'Her gider bir dağıtım yöntemiyle kaydedilir; bakım giderleri seçili odanın demirbaşına yazılır.')),
      h('button', { class: 'btn primary', type: 'button', onClick: () => openExpenseForm(app, null) }, '＋ Yeni Gider')),
    h('div', { class: 'card table-card' },
      h('table', {},
        h('thead', {}, h('tr', {}, ...['Tarih', 'Kategori', 'Açıklama', 'Dağıtım', 'Oda / Demirbaş', 'Tutar', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: '7', class: 'empty' }, 'Kayıt yok.'))])))));
}

export function openExpenseForm(app, source, preset = {}) {
  const { rooms } = app.store.getState();
  const today = new Date().toISOString().slice(0, 10);
  const draft = {
    id: source?.id,
    date: source?.date || today,
    category: source?.category || preset.category || 'maintenance',
    description: source?.description || '',
    amount: source?.amount ?? 0,
    allocation: source?.allocation || preset.allocation || EXPENSE_CATEGORY_MAP[source?.category || preset.category || 'maintenance'].defaults.allocation,
    weightKind: source?.weightKind || 'electricity',
    roomId: source?.roomId || preset.roomId || '',
    amenityKey: source?.amenityKey || preset.amenityKey || '',
    vendor: source?.vendor || '',
  };

  openModal({
    title: source ? 'Gideri Düzenle' : 'Yeni Gider',
    size: 'md',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      const targetBox = h('div', { class: 'stack tight' });
      let allocationSelect;

      const renderTarget = () => {
        clear(targetBox);
        const allocation = ALLOCATIONS.find((a) => a.key === draft.allocation);
        if (allocation?.needsRoom) {
          const room = rooms.find((r) => r.id === draft.roomId);
          const amenities = room ? serviceableAmenities(room) : [];
          if (draft.amenityKey && !amenities.some((a) => a.key === draft.amenityKey)) draft.amenityKey = '';
          targetBox.appendChild(field('Oda *', select({ onChange: (e) => { draft.roomId = e.target.value; renderTarget(); } },
            [{ value: '', label: 'Oda seçin…' }, ...rooms.map((r) => ({ value: r.id, label: roomLabel(r) }))], draft.roomId)));
          targetBox.appendChild(field('Demirbaş (opsiyonel)',
            select({ onChange: (e) => { draft.amenityKey = e.target.value; } },
              [{ value: '', label: 'Demirbaş seçilmedi' }, ...amenities.map((a) => ({ value: a.key, label: `${a.icon} ${a.label}` }))],
              draft.amenityKey),
            room ? 'Yalnızca bu odanın kartında işaretli demirbaşlar listelenir.' : 'Önce oda seçin.'));
        }
        if (allocation?.needsKind) {
          targetBox.appendChild(field('Gider Türü *',
            select({ onChange: (e) => { draft.weightKind = e.target.value; } },
              UTILITY_KINDS.map((k) => ({ value: k, label: UTILITY_LABELS[k] })), draft.weightKind),
            'Odaların demirbaş katsayılarına göre ağırlıklı dağıtılır.'));
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
        h('div', { class: 'grid-2' },
          field('Tarih *', h('input', { type: 'date', value: draft.date, onInput: (e) => { draft.date = e.target.value; } })),
          field('Tutar *', h('input', {
            type: 'number', min: '0', step: '10', value: draft.amount,
            onInput: (e) => { draft.amount = Number(e.target.value); },
          }))),
        field('Kategori *', select({
          onChange: (e) => {
            draft.category = e.target.value;
            const defaults = EXPENSE_CATEGORY_MAP[draft.category].defaults;
            draft.allocation = defaults.allocation;
            if (defaults.weightKind) draft.weightKind = defaults.weightKind;
            allocationSelect.value = draft.allocation;
            renderTarget();
          },
        }, EXPENSE_CATEGORIES.map((c) => ({ value: c.key, label: c.label })), draft.category)),
        field('Açıklama *', h('input', {
          type: 'text', value: draft.description, placeholder: 'Jakuzi motor arızası - işçilik',
          onInput: (e) => { draft.description = e.target.value; },
        })),
        field('Tedarikçi', h('input', { type: 'text', value: draft.vendor, onInput: (e) => { draft.vendor = e.target.value; } })),
        field('Dağıtım Yöntemi *', (allocationSelect = select({
          onChange: (e) => { draft.allocation = e.target.value; renderTarget(); },
        }, ALLOCATIONS.map((a) => ({ value: a.key, label: a.label })), draft.allocation))),
        targetBox,
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
