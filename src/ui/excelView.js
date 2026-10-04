/** Excel İşlemleri — içe/dışa aktarım ve örnek şablon (PRD §2.1). */

import { api } from '../core/api.js';
import { formatDate } from '../core/format.js';
import { clear, h, openModal, toast } from './dom.js';

const state = { kind: 'gider', lastResult: null };

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
      if (!dryRun && state.lastResult.imported) {
        await app.store.reload();
        toast(`${state.lastResult.imported} kayıt içe aktarıldı.`);
        app.refresh();
      } else if (dryRun) {
        toast('Ön kontrol tamamlandı.');
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

  const tone = result.invalidCount ? 'warn' : 'ok';
  return h('div', { class: 'stack tight' },
    h('div', { class: `verdict verdict-${tone === 'ok' ? 'ok' : 'below'}` },
      h('strong', {}, result.dryRun
        ? `Ön kontrol: ${result.validCount} geçerli, ${result.invalidCount} hatalı satır`
        : `${result.imported} kayıt aktarıldı, ${result.invalidCount} satır reddedildi`),
      h('span', { class: 'small' }, `Toplam ${result.totalRows} satır okundu.`)),
    result.invalidRows?.length
      ? h('div', { class: 'card table-card' },
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Satır'), h('th', {}, 'Hata'), h('th', {}, 'İçerik'))),
          h('tbody', {}, ...result.invalidRows.map((row) => h('tr', {},
            h('td', {}, String(row.line)),
            h('td', { class: 'bad small' }, row.errors.join(' · ')),
            h('td', { class: 'muted small' }, row.raw.join(' | ')))))))
      : null);
}
