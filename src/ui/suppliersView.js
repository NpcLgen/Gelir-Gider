/** Restoran → Toptancılar: cari hesap, fatura/ödeme ve arama (PRD §4). */

import { supplierBalance } from '../core/finance.js';
import { formatDate, formatMoney } from '../core/format.js';
import { clear, confirmDialog, errorList, field, h, openModal, select, toast } from './dom.js';

const filters = { search: '', invoiceNo: '', from: '', to: '', showPassive: false };
let openSupplierId = null;

export function suppliersView(app) {
  const { suppliers, supplierTxns } = app.store.getState();

  const visible = suppliers.filter((supplier) => {
    if (!filters.showPassive && supplier.active === false) return false;
    if (filters.search) {
      const needle = filters.search.toLocaleLowerCase('tr');
      if (!supplier.name.toLocaleLowerCase('tr').includes(needle)) return false;
    }
    if (filters.invoiceNo) {
      const hit = supplierTxns.some((t) => t.supplierId === supplier.id
        && String(t.invoiceNo ?? '').toLocaleLowerCase('tr').includes(filters.invoiceNo.toLocaleLowerCase('tr')));
      if (!hit) return false;
    }
    return true;
  });

  const range = { from: filters.from, to: filters.to };
  const totals = visible.reduce((acc, supplier) => {
    const balance = supplierBalance(supplier.id, supplierTxns, range);
    acc.debt += balance.totalDebt;
    acc.paid += balance.totalPaid;
    acc.balance += balance.balance;
    return acc;
  }, { debt: 0, paid: 0, balance: 0 });

  const cards = visible.map((supplier) => {
    const balance = supplierBalance(supplier.id, supplierTxns, range);
    const isOpen = openSupplierId === supplier.id;
    return h('div', { class: `card supplier-card${supplier.active === false ? ' passive-row' : ''}` },
      h('div', { class: 'row between center wrap gap' },
        h('div', {},
          h('h3', {}, supplier.name),
          h('div', { class: 'muted small' },
            [supplier.category, supplier.phone, supplier.taxNumber].filter(Boolean).join(' · ') || '—')),
        h('div', { class: 'row gap center' },
          h('div', { class: 'supplier-balance' },
            h('span', { class: 'muted small' }, 'Kalan Bakiye'),
            h('strong', { class: balance.balance > 0 ? 'bad' : 'good' }, formatMoney(balance.balance))),
          h('button', {
            class: 'btn small', type: 'button',
            onClick: () => { openSupplierId = isOpen ? null : supplier.id; app.refresh(); },
          }, isOpen ? '▲ Cari Hesabı Gizle' : '▼ Cari Hesabı Aç'),
          h('button', { class: 'icon-btn', type: 'button', title: 'Düzenle', onClick: () => openSupplierForm(app, supplier) }, '✏️'),
          h('button', {
            class: 'icon-btn', type: 'button', title: 'Sil',
            onClick: () => confirmDialog(`${supplier.name} ve tüm cari hareketleri silinsin mi?`, async () => {
              await app.store.deleteSupplier(supplier.id);
              app.refresh();
              toast('Toptancı silindi.', 'warn');
            }),
          }, '🗑️'))),

      h('div', { class: 'kv-list supplier-summary' },
        kv('Toplam borç (fatura)', formatMoney(balance.totalDebt)),
        kv('Yapılan ödeme', formatMoney(balance.totalPaid)),
        kv('İşlem sayısı', String(balance.ledger.length))),

      isOpen ? ledgerTable(app, supplier, balance) : null);
  });

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Toptancılar'),
        h('p', { class: 'muted' }, 'Restoran ve mutfak tedarikçilerinin cari hesapları: fatura borcu artırır, ödeme azaltır.')),
      h('button', { class: 'btn primary', type: 'button', onClick: () => openSupplierForm(app, null) }, '＋ Yeni Toptancı')),

    h('div', { class: 'card filter-bar' },
      h('input', {
        type: 'search', class: 'search supplier-search', placeholder: 'Toptancı adı ara…', value: filters.search,
        onInput: (e) => { filters.search = e.target.value; app.refresh(); },
      }),
      h('input', {
        type: 'search', class: 'search', placeholder: 'Fatura no ara…', value: filters.invoiceNo,
        onInput: (e) => { filters.invoiceNo = e.target.value; app.refresh(); },
      }),
      h('label', { class: 'check-inline small' }, 'Tarih:',
        h('input', { type: 'date', value: filters.from, onChange: (e) => { filters.from = e.target.value; app.refresh(); } }),
        h('span', { class: 'muted' }, '→'),
        h('input', { type: 'date', value: filters.to, onChange: (e) => { filters.to = e.target.value; app.refresh(); } })),
      filters.from || filters.to || filters.search || filters.invoiceNo
        ? h('button', {
          class: 'btn small ghost', type: 'button',
          onClick: () => { Object.assign(filters, { search: '', invoiceNo: '', from: '', to: '' }); app.refresh(); },
        }, '✕ Filtreleri Temizle')
        : null,
      h('label', { class: 'check-inline small' },
        h('input', {
          type: 'checkbox', checked: filters.showPassive,
          onChange: (e) => { filters.showPassive = e.target.checked; app.refresh(); },
        }), 'Pasifleri göster')),

    h('div', { class: 'kpi-grid' },
      kpi('Toplam Borç', formatMoney(totals.debt), `${visible.length} toptancı`),
      kpi('Toplam Ödeme', formatMoney(totals.paid), 'Seçili aralıkta'),
      kpi('Kalan Bakiye', formatMoney(totals.balance), totals.balance > 0 ? 'Ödenecek' : 'Borç yok',
        totals.balance > 0 ? 'bad' : 'good')),

    ...(cards.length ? cards : [h('div', { class: 'card empty' }, 'Kayıtlı toptancı bulunamadı.')]));
}

function ledgerTable(app, supplier, balance) {
  const rows = balance.ledger.slice().reverse().map((txn) => h('tr', {},
    h('td', {}, formatDate(txn.date)),
    h('td', {}, h('span', { class: `tag tag-${txn.type === 'invoice' ? 'direct' : 'tariff'}` },
      txn.type === 'invoice' ? 'Fatura' : 'Ödeme')),
    h('td', {}, txn.invoiceNo || h('span', { class: 'muted' }, '—')),
    h('td', { class: 'num' }, txn.type === 'invoice' ? formatMoney(txn.amount) : ''),
    h('td', { class: 'num' }, txn.type === 'payment' ? formatMoney(txn.amount) : ''),
    h('td', { class: 'num' }, h('strong', {}, formatMoney(txn.runningBalance))),
    h('td', {}, txn.note || ''),
    h('td', {}, h('div', { class: 'row gap' },
      h('button', { class: 'icon-btn', type: 'button', title: 'Düzenle', onClick: () => openTxnForm(app, supplier, txn) }, '✏️'),
      h('button', {
        class: 'icon-btn', type: 'button', title: 'Sil',
        onClick: () => confirmDialog('Bu cari hareket silinsin mi?', async () => {
          await app.store.deleteSupplierTxn(txn.id);
          app.refresh();
          toast('Hareket silindi.', 'warn');
        }),
      }, '🗑️')))));

  return h('div', { class: 'stack tight supplier-ledger' },
    h('div', { class: 'row gap' },
      h('button', {
        class: 'btn small', type: 'button',
        onClick: () => openTxnForm(app, supplier, null, 'invoice'),
      }, '＋ Fatura Ekle'),
      h('button', {
        class: 'btn small', type: 'button',
        onClick: () => openTxnForm(app, supplier, null, 'payment'),
      }, '＋ Ödeme Ekle')),
    h('div', { class: 'card table-card' },
      h('table', {},
        h('thead', {}, h('tr', {}, ...['Tarih', 'Tür', 'Fatura No', 'Borç', 'Ödeme', 'Bakiye', 'Açıklama', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...(rows.length
          ? rows
          : [h('tr', {}, h('td', { colspan: '8', class: 'empty' }, 'Bu aralıkta hareket yok.'))])))));
}

const kv = (label, value) => h('div', { class: 'kv' }, h('span', {}, label), h('strong', {}, value));

function kpi(label, value, hint, tone) {
  return h('div', { class: 'card kpi' },
    h('span', { class: 'muted small' }, label),
    h('strong', { class: tone || '' }, value),
    h('span', { class: 'muted small' }, hint));
}

export function openSupplierForm(app, source) {
  const draft = {
    id: source?.id,
    name: source?.name ?? '',
    category: source?.category ?? 'Gıda',
    phone: source?.phone ?? '',
    taxNumber: source?.taxNumber ?? '',
    note: source?.note ?? '',
    active: source?.active !== false,
  };

  openModal({
    title: source ? 'Toptancıyı Düzenle' : 'Yeni Toptancı',
    size: 'sm',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      return h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
        errorBox,
        field('Toptancı Adı *', h('input', {
          type: 'text', value: draft.name, autofocus: true, class: 'supplier-name',
          onInput: (e) => { draft.name = e.target.value; },
        })),
        h('div', { class: 'grid-2' },
          field('Kategori', select({ onChange: (e) => { draft.category = e.target.value; } },
            ['Gıda', 'İçecek', 'Temizlik', 'Kasap', 'Manav', 'Diğer'].map((c) => ({ value: c, label: c })), draft.category)),
          field('Telefon', h('input', { type: 'text', value: draft.phone, onInput: (e) => { draft.phone = e.target.value; } })),
          field('Vergi No', h('input', { type: 'text', value: draft.taxNumber, onInput: (e) => { draft.taxNumber = e.target.value; } }))),
        field('Not', h('input', { type: 'text', value: draft.note, onInput: (e) => { draft.note = e.target.value; } })),
        h('label', { class: 'check-inline' },
          h('input', { type: 'checkbox', checked: draft.active, onChange: (e) => { draft.active = e.target.checked; } }),
          'Aktif (pasif toptancı listede gizlenir, kayıtları korunur)'),
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'submit',
            onClick: async () => {
              clear(errorBox).classList.add('hidden');
              try {
                const saved = await app.store.saveSupplier(draft);
                openSupplierId = saved?.id ?? openSupplierId;
                toast('Toptancı kaydedildi.');
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

export function openTxnForm(app, supplier, source, defaultType = 'invoice') {
  const draft = {
    id: source?.id,
    supplierId: supplier.id,
    type: source?.type ?? defaultType,
    date: source?.date ?? new Date().toISOString().slice(0, 10),
    amount: source?.amount ?? 0,
    invoiceNo: source?.invoiceNo ?? '',
    kdvRate: source?.kdvRate ?? 20,
    note: source?.note ?? '',
  };

  openModal({
    title: `${supplier.name} · ${draft.type === 'invoice' ? 'Fatura' : 'Ödeme'}`,
    subtitle: draft.type === 'invoice' ? 'Borç bakiyesini artırır.' : 'Borç bakiyesini azaltır.',
    size: 'sm',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      const invoiceBox = h('div', {});

      const renderInvoiceFields = () => {
        clear(invoiceBox);
        if (draft.type !== 'invoice') return;
        invoiceBox.appendChild(h('div', { class: 'grid-2' },
          field('Fatura No *', h('input', {
            type: 'text', value: draft.invoiceNo, class: 'txn-invoice',
            onInput: (e) => { draft.invoiceNo = e.target.value; },
          })),
          field('KDV Oranı (%)', h('input', {
            type: 'number', min: '0', max: '100', step: 'any', value: draft.kdvRate,
            onInput: (e) => { draft.kdvRate = Number(e.target.value); },
          }), 'Vergi raporunda indirilecek KDV olarak kullanılır.')));
      };
      renderInvoiceFields();

      return h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
        errorBox,
        field('İşlem Türü', select({
          class: 'txn-type',
          onChange: (e) => { draft.type = e.target.value; renderInvoiceFields(); },
        }, [{ value: 'invoice', label: 'Fatura (borç)' }, { value: 'payment', label: 'Ödeme (tahsilat)' }], draft.type)),
        h('div', { class: 'grid-2' },
          field('Tarih *', h('input', { type: 'date', value: draft.date, onInput: (e) => { draft.date = e.target.value; } })),
          field('Tutar *', h('input', {
            type: 'number', min: '0', step: 'any', value: draft.amount, class: 'txn-amount',
            onInput: (e) => { draft.amount = Number(e.target.value); },
          }))),
        invoiceBox,
        field('Açıklama', h('input', { type: 'text', value: draft.note, onInput: (e) => { draft.note = e.target.value; } })),
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'submit',
            onClick: async () => {
              clear(errorBox).classList.add('hidden');
              try {
                await app.store.saveSupplierTxn(draft);
                toast(draft.type === 'invoice' ? 'Fatura kaydedildi.' : 'Ödeme kaydedildi.');
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
