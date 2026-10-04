/** Excel İşlemleri — içe/dışa aktarım ve örnek şablon (PRD §2.1). */

import { api } from '../core/api.js';
import { formatDate } from '../core/format.js';
import { clear, h, openModal, toast } from './dom.js';

const state = { kind: 'gider', lastResult: null };

/** İçe aktarım sonucunu tek cümlelik bildirime çevirir. */
export function importToast(result, birim = 'kayıt') {
  const parcalar = [];
  if (result.imported) parcalar.push(`${result.imported} yeni ${birim} aktarıldı`);
  if (result.skippedCount) parcalar.push(`${result.skippedCount} ${birim} zaten işlenmişti`);
  if (result.conflictCount) parcalar.push(`${result.conflictCount} çakışma`);
  if (result.invalidCount) parcalar.push(`${result.invalidCount} satır reddedildi`);
  if (!parcalar.length) return 'İşlenecek yeni kayıt bulunamadı.';
  return `${parcalar.join(' · ')}.`;
}

export function excelView(app) {
  const p = app.period();
  const canImport = app.can('excelIceAktarim');
  const canExport = app.can('excelDisaAktarim');
  const resultBox = h('div', {});

  const renderResult = () => {
    clear(resultBox);
    if (!state.lastResult) return;
    resultBox.appendChild(importResult(state.lastResult));
  };
  renderResult();

  const upload = async (file, dryRun) => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      state.lastResult = await api.postRaw('/api/excel/import', buffer, { kind: state.kind, dryRun: dryRun ? '1' : '0' });
      renderResult();
      if (dryRun) {
        toast(`Ön kontrol: ${importToast(state.lastResult)}`,
          state.lastResult.invalidCount || state.lastResult.conflictCount ? 'warn' : 'ok');
      } else {
        await app.store.reload();
        toast(importToast(state.lastResult), state.lastResult.imported ? 'ok' : 'warn');
        app.refresh();
      }
    } catch (err) {
      state.lastResult = { error: err.message, ...(err.payload ?? {}) };
      renderResult();
      toast(err.message, 'error');
    }
  };

  return h('div', { class: 'stack' },
    h('div', {},
      h('h1', {}, 'Excel İşlemleri'),
      h('p', { class: 'muted' }, 'Gelir ve gider kayıtlarını toplu olarak aktarın veya sistemdeki verileri dışarı alın.')),

    canImport ? h('section', { class: 'card stack' },
      h('div', { class: 'row between center wrap gap' },
        h('h3', {}, 'İçe Aktarım'),
        h('button', {
          class: 'btn small help-btn', type: 'button', title: 'Örnek şablonu indir',
          onClick: () => openTemplateHelp(app),
        }, '❓ Yardım / Örnek Şablon')),
      h('div', { class: 'row gap wrap center' },
        h('div', { class: 'segmented' },
          ...[['gider', 'Giderler'], ['gelir', 'Rezervasyonlar'],
            ['gelenFatura', 'Gelen Fatura'], ['gidenFatura', 'Giden Fatura']].map(([key, label]) => h('button', {
            class: `seg-btn${state.kind === key ? ' active' : ''}`, type: 'button',
            onClick: () => { state.kind = key; state.lastResult = null; app.refresh(); },
          }, label))),
        h('label', { class: 'btn file-btn' }, '📂 Dosya Seç ve Kontrol Et',
          h('input', {
            type: 'file', accept: '.xlsx', hidden: true, class: 'excel-dry',
            onChange: (e) => upload(e.target.files?.[0], true),
          })),
        h('label', { class: 'btn primary file-btn' }, '⬆️ Dosyayı İçe Aktar',
          h('input', {
            type: 'file', accept: '.xlsx', hidden: true, class: 'excel-import',
            onChange: (e) => upload(e.target.files?.[0], false),
          }))),
      h('p', { class: 'muted small' },
        'Önce "Dosya Seç ve Kontrol Et" ile deneme yapabilirsiniz: kayıt eklenmez, yalnızca hatalı satırlar listelenir.'),
      resultBox) : null,

    canExport ? h('section', { class: 'card stack' },
      h('h3', {}, 'Dışa Aktarım'),
      h('p', { class: 'muted small' },
        `Seçili dönem (${formatDate(p.from)} → ${formatDate(p.to)}) için gelirler, giderler, personel, toptancı cari ve kasa sayfaları tek dosyada indirilir. Yetkiniz olmayan sayfalar dosyaya eklenmez.`),
      h('div', { class: 'row gap wrap' },
        h('button', {
          class: 'btn primary', type: 'button',
          onClick: async () => {
            try {
              const name = await api.download('/api/excel/export', { from: p.from, to: p.to });
              toast(`${name} indirildi.`);
            } catch (err) { toast(err.message, 'error'); }
          },
        }, '⬇️ Dönemi Excel’e Aktar'),
        h('button', {
          class: 'btn', type: 'button',
          onClick: async () => {
            try {
              const name = await api.download('/api/excel/export', {});
              toast(`${name} indirildi.`);
            } catch (err) { toast(err.message, 'error'); }
          },
        }, '⬇️ Tüm Verileri Aktar'))) : null);
}

/** "?" yardım penceresi: beklenen sütun yapısı + örnek şablon indirme. */
export function openTemplateHelp(app) {
  openModal({
    title: 'Excel Şablonu Yardımı',
    subtitle: 'Sistemin kabul ettiği sütun yapısı',
    size: 'md',
    content: () => h('div', { class: 'stack' },
      h('p', {}, 'Aşağıdaki şablonları indirip kendi verinizle doldurun. Başlık satırını değiştirmeyin.'),
      h('div', { class: 'row gap wrap' },
        h('button', {
          class: 'btn primary', type: 'button',
          onClick: async () => {
            try {
              const name = await api.download('/api/excel/template', { kind: 'gider' }, 'ornek-sablon-gider.xlsx');
              toast(`${name} indirildi.`);
            } catch (err) { toast(err.message, 'error'); }
          },
        }, '⬇️ Gider Şablonu'),
        h('button', {
          class: 'btn primary', type: 'button',
          onClick: async () => {
            try {
              const name = await api.download('/api/excel/template', { kind: 'gelir' }, 'ornek-sablon-gelir.xlsx');
              toast(`${name} indirildi.`);
            } catch (err) { toast(err.message, 'error'); }
          },
        }, '⬇️ Gelir Şablonu'),
        ...[['gelenFatura', 'Gelen Fatura Şablonu'], ['gidenFatura', 'Giden Fatura Şablonu']]
          .map(([kind, label]) => h('button', {
            class: 'btn', type: 'button',
            onClick: async () => {
              try {
                const name = await api.download('/api/excel/template', { kind }, `ornek-sablon-${kind}.xlsx`);
                toast(`${name} indirildi.`);
              } catch (err) { toast(err.message, 'error'); }
            },
          }, `⬇️ ${label}`))),
      h('h4', {}, 'Gider sütunları'),
      h('ul', { class: 'plain-list' },
        ...['Tarih (YYYY-AA-GG)', 'Kategori', 'Açıklama', 'Tutar', 'Para Birimi (TRY/EUR)',
          'Dağıtım (direct/perGuest/weighted/equal/general)', 'Oda No', 'Tedarikçi']
          .map((c) => h('li', {}, c))),
      h('h4', {}, 'Gelir sütunları'),
      h('ul', { class: 'plain-list' },
        ...['Giriş Tarihi', 'Çıkış Tarihi', 'Oda No', 'Misafir Adı', 'Kişi Sayısı', 'Toplam Tutar',
          'Para Birimi', 'Kanal', 'Komisyon (%)', 'Kahvaltı Dahil (Evet/Hayır)']
          .map((c) => h('li', {}, c))),
      h('h4', {}, 'Gelen / giden fatura sütunları'),
      h('ul', { class: 'plain-list' },
        ...['Müşteri', 'Fatura Tarihi', 'Fatura No', 'Tutar', 'Para Birimi',
          'Vergiler Hariç Toplam Tutar', 'Vergiler Dahil Toplam Tutar']
          .map((c) => h('li', {}, c))),
      h('p', { class: 'muted small' },
        'e-Fatura portalından indirdiğiniz dosyayı olduğu gibi yükleyebilirsiniz: yalnızca yukarıdaki ' +
        'başlıkları taşıyan sütunlar okunur, diğer sütunlar yok sayılır.'),
      h('p', { class: 'muted small' },
        'Tutarlarda "12.500,75" ve "12500.75" biçimlerinin ikisi de kabul edilir. Tarihlerde 01.10.2026 ' +
        've Excel tarih hücreleri de çalışır.')),
  });
}

export function importResult(result) {
  if (result.error) {
    return h('div', { class: 'error-box' },
      h('strong', {}, result.error),
      result.expectedColumns
        ? h('div', { class: 'stack tight' },
          h('p', { class: 'small' }, 'Beklenen sütunlar:'),
          h('ul', { class: 'error-list' }, ...result.expectedColumns.map((c) => h('li', {}, c))),
          result.foundColumns
            ? h('p', { class: 'small' }, `Dosyada bulunan: ${result.foundColumns.join(' | ')}`)
            : null)
        : null);
  }

  const skipped = result.skippedCount ?? 0;
  const conflicts = result.conflictCount ?? 0;
  const problem = result.invalidCount > 0 || conflicts > 0;

  // Özet: yeni kayıt / zaten işlenmiş / çakışan / hatalı.
  const parts = [];
  parts.push(result.dryRun
    ? `${result.validCount} yeni kayıt`
    : `${result.imported} kayıt aktarıldı`);
  if (skipped) parts.push(`${skipped} kayıt zaten işlenmişti (atlandı)`);
  if (conflicts) parts.push(`${conflicts} çakışma`);
  if (result.invalidCount) parts.push(`${result.invalidCount} hatalı satır`);

  /** Satır listesi tablosu. */
  const rowTable = (title, rows, cls) => h('div', { class: 'card table-card' },
    h('header', { class: 'card-header' }, h('h4', {}, title)),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Satır'), h('th', {}, 'Sebep'), h('th', {}, 'İçerik'))),
      h('tbody', {}, ...rows.map((row) => h('tr', {},
        h('td', {}, String(row.line)),
        h('td', { class: `${cls} small` }, row.reason ?? row.errors.join(' · ')),
        h('td', { class: 'muted small' }, row.raw.join(' | ')))))));

  return h('div', { class: 'stack tight' },
    h('div', { class: `verdict verdict-${problem ? 'below' : 'ok'}` },
      h('strong', {}, (result.dryRun ? 'Ön kontrol: ' : '') + parts.join(' · ')),
      h('span', { class: 'small' }, `Toplam ${result.totalRows} satır okundu.`)),
    result.invalidRows?.length ? rowTable('Reddedilen satırlar', result.invalidRows, 'bad') : null,
    result.conflictRows?.length
      ? rowTable('Aynı kayıt farklı bilgilerle duruyor', result.conflictRows, 'warn')
      : null,
    result.skippedRows?.length
      ? h('details', { class: 'card' },
        h('summary', { class: 'muted small' }, `${skipped} kayıt daha önce işlendiği için atlandı — listeyi göster`),
        rowTable('Atlanan satırlar', result.skippedRows, 'muted'))
      : null);
}
