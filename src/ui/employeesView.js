/** Çalışanlar — sabit personel maaş ve SGK takibi (PRD §3.2). */

import { employeeTotal } from '../core/finance.js';
import { shiftMonth } from '../core/dates.js';
import { formatMoney } from '../core/format.js';
import { clear, confirmDialog, errorList, field, h, openModal, toast } from './dom.js';

export function employeesView(app) {
  const { employees } = app.store.getState();
  const month = app.period().from.slice(0, 7);
  const ofMonth = employees.filter((e) => e.period === month);

  const totals = ofMonth.filter((e) => e.active !== false).reduce((acc, e) => ({
    salary: acc.salary + e.netSalary,
    sgk: acc.sgk + e.sgk,
  }), { salary: 0, sgk: 0 });

  const rows = ofMonth.map((employee) => h('tr', { class: employee.active === false ? 'passive-row' : '' },
    h('td', {}, h('strong', {}, employee.name),
      employee.role ? h('div', { class: 'muted small' }, employee.role) : null),
    h('td', { class: 'num' }, formatMoney(employee.netSalary)),
    h('td', { class: 'num' }, formatMoney(employee.sgk)),
    h('td', { class: 'num' }, h('strong', {}, formatMoney(employeeTotal(employee)))),
    h('td', {}, employee.recurring !== false ? '🔁 Her ay' : 'Tek dönem'),
    h('td', {}, employee.note || h('span', { class: 'muted' }, '—')),
    h('td', {}, h('div', { class: 'row gap' },
      h('button', { class: 'icon-btn', type: 'button', title: 'Düzenle', onClick: () => openEmployeeForm(app, employee) }, '✏️'),
      h('button', {
        class: 'icon-btn', type: 'button', title: 'Sil',
        onClick: () => confirmDialog(`${employee.name} (${employee.period}) kaydı silinsin mi?`, async () => {
          await app.store.deleteEmployee(employee.id);
          app.refresh();
          toast('Personel kaydı silindi.', 'warn');
        }),
      }, '🗑️')))));

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Çalışanlar'),
        h('p', { class: 'muted' }, `${month} dönemi · maaş ve SGK ayrı takip edilir, ilgili ayın giderine dahil olur.`)),
      h('div', { class: 'row gap' },
        ofMonth.length === 0 && employees.some((e) => e.recurring !== false)
          ? h('button', {
            class: 'btn', type: 'button',
            onClick: () => copyPreviousMonth(app, month),
          }, '📋 Önceki Aydan Kopyala')
          : null,
        h('button', { class: 'btn primary', type: 'button', onClick: () => openEmployeeForm(app, null) }, '＋ Personel Ekle'))),

    h('div', { class: 'kpi-grid' },
      kpi('Net Maaş Toplamı', formatMoney(totals.salary), `${ofMonth.length} personel`),
      kpi('SGK Toplamı', formatMoney(totals.sgk), 'İşveren payı dahil'),
      kpi('Dönem Personel Gideri', formatMoney(totals.salary + totals.sgk), `${month} ayına yansıyan`)),

    h('div', { class: 'card table-card' },
      h('table', {},
        h('thead', {}, h('tr', {}, ...['Personel', 'Net Maaş', 'SGK', 'Toplam', 'Tekrar', 'Not', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...(rows.length
          ? rows
          : [h('tr', {}, h('td', { colspan: '7', class: 'empty' }, `${month} dönemi için personel kaydı yok.`))])))));
}

function kpi(label, value, hint) {
  return h('div', { class: 'card kpi' },
    h('span', { class: 'muted small' }, label),
    h('strong', {}, value),
    h('span', { class: 'muted small' }, hint));
}

/** Tekrarlayan personeli bir önceki aydan bu aya taşır (PRD §3.5). */
async function copyPreviousMonth(app, month) {
  const previous = shiftMonth(month, -1);
  const source = app.store.getState().employees.filter((e) => e.period === previous && e.recurring !== false);
  if (!source.length) {
    toast(`${previous} döneminde kopyalanacak personel yok.`, 'warn');
    return;
  }
  for (const employee of source) {
    await app.store.saveEmployee({ ...employee, id: undefined, period: month });
  }
  app.refresh();
  toast(`${source.length} personel ${month} dönemine kopyalandı.`);
}

export function openEmployeeForm(app, source) {
  const month = app.period().from.slice(0, 7);
  const draft = {
    id: source?.id,
    name: source?.name ?? '',
    role: source?.role ?? '',
    period: source?.period ?? month,
    netSalary: source?.netSalary ?? 0,
    sgk: source?.sgk ?? 0,
    recurring: source?.recurring !== false,
    active: source?.active !== false,
    note: source?.note ?? '',
  };

  openModal({
    title: source ? 'Personeli Düzenle' : 'Yeni Personel',
    subtitle: 'Maaş ve SGK ayrı girilir; ikisi de ilgili ayın giderine yansır.',
    size: 'md',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      const totalLine = h('p', { class: 'muted small' }, '');
      const updateTotal = () => {
        totalLine.textContent = `Dönem maliyeti: ${formatMoney(Number(draft.netSalary) + Number(draft.sgk))}`;
      };
      updateTotal();

      return h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
        errorBox,
        h('div', { class: 'grid-2' },
          field('Personel Adı *', h('input', {
            type: 'text', value: draft.name, class: 'emp-name',
            onInput: (e) => { draft.name = e.target.value; },
          })),
          field('Görev', h('input', {
            type: 'text', value: draft.role, placeholder: 'Kat görevlisi',
            onInput: (e) => { draft.role = e.target.value; },
          })),
          field('Dönem *', h('input', {
            type: 'month', value: draft.period,
            onInput: (e) => { draft.period = e.target.value; },
          })),
          field('Net Maaş *', h('input', {
            type: 'number', min: '0', step: 'any', value: draft.netSalary, class: 'emp-salary',
            onInput: (e) => { draft.netSalary = Number(e.target.value); updateTotal(); },
          })),
          field('SGK / Sigorta *', h('input', {
            type: 'number', min: '0', step: 'any', value: draft.sgk, class: 'emp-sgk',
            onInput: (e) => { draft.sgk = Number(e.target.value); updateTotal(); },
          }))),
        totalLine,
        field('Not', h('input', { type: 'text', value: draft.note, onInput: (e) => { draft.note = e.target.value; } })),
        h('label', { class: 'check-inline' },
          h('input', {
            type: 'checkbox', checked: draft.recurring,
            onChange: (e) => { draft.recurring = e.target.checked; },
          }), 'Her ay tekrarlanan personel (sonraki aya kopyalanabilir)'),
        h('label', { class: 'check-inline' },
          h('input', {
            type: 'checkbox', checked: draft.active,
            onChange: (e) => { draft.active = e.target.checked; },
          }), 'Aktif (gider hesabına dahil)'),
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'submit',
            onClick: async () => {
              clear(errorBox).classList.add('hidden');
              try {
                await app.store.saveEmployee(draft);
                toast('Personel kaydedildi.');
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
