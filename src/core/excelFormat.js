/**
 * XLSX biçim mantığı — zip katmanından bağımsız saf bölüm.
 *
 * Node sunucusu (`server/excel.js`) ve tarayıcı (`src/core/excelBrowser.js`)
 * aynı XML üretimini, aynı ayrıştırmayı ve aynı şablonları kullanır.
 */

const escapeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  // XML'de geçersiz kontrol karakterlerini at
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const unescapeXml = (value) => String(value ?? '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

const columnName = (index) => {
  let name = '';
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
};

const columnIndex = (ref) => {
  const letters = String(ref).match(/^[A-Z]+/)?.[0] ?? 'A';
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
};

function sheetXml(rows) {
  const body = rows.map((cells, rowIndex) => {
    const tds = cells.map((cell, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`;
      if (cell == null || cell === '') return '';
      if (typeof cell === 'number' && Number.isFinite(cell)) {
        return `<c r="${ref}"><v>${cell}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${tds}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/**
 * Çalışma kitabının dosya listesini üretir (zip'lenmeye hazır).
 * @param {{name: string, rows: Array<Array<string|number>>}[]} sheets
 * @returns {{name: string, data: string}[]}
 */
export function workbookFiles(sheets) {
  const safe = sheets.length ? sheets : [{ name: 'Sayfa1', rows: [['Veri yok']] }];
  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${
  safe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
  safe.map((s, i) => `<sheet name="${escapeXml(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
  safe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>`,
    },
    ...safe.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sheet.rows) })),
  ];
  return files;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => {
    const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1]));
    return texts.join('');
  });
}

/**
 * Açılmış zip girdilerinden ilk çalışma sayfasını satır dizisine çevirir.
 * @param {Map<string, string>} texts dosya adı → UTF-8 metin
 */
export function rowsFromEntries(texts) {
  const sheetName = [...texts.keys()].find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!sheetName) throw new Error('Excel dosyasında çalışma sayfası bulunamadı.');

  const shared = parseSharedStrings(texts.get('xl/sharedStrings.xml'));
  const xml = texts.get(sheetName);
  const rows = [];

  for (const rowMatch of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    // Boş hücreler `<c r="I2"/>` biçiminde kendi kendini kapatır; bunlar
    // atlanırsa sonraki sütunlar sola kayar ve veriler yanlış sütuna düşer.
    for (const cellMatch of rowMatch[2].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/t="(\w+)"/)?.[1];
      const body = cellMatch[2] ?? '';
      let value = '';
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join('');
      } else if (type === 's') {
        value = shared[Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? -1)] ?? '';
      } else {
        value = unescapeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      }
      const index = ref ? columnIndex(ref) : cells.length;
      cells[index] = value;
    }
    rows[Number(rowMatch[1]) - 1] = [...cells].map((c) => c ?? '');
  }

  return { rows: rows.filter(Boolean).map((r) => r.map((c) => (c == null ? '' : String(c)))) };
}

export { columnName, columnIndex, escapeXml, unescapeXml, parseSharedStrings };

/* ------------------------------------------------- Şablonlar (PRD §2.1) -- */

/** İçe aktarımda beklenen sütun yapısı. Sıra ve başlıklar birebir olmalıdır. */
export const TEMPLATES = {
  gider: {
    sheet: 'Giderler',
    columns: [
      { key: 'date', label: 'Tarih (YYYY-AA-GG)', example: '2026-10-01', required: true },
      { key: 'category', label: 'Kategori', example: 'utility_electricity', required: true },
      { key: 'description', label: 'Açıklama', example: 'Elektrik faturası', required: true },
      { key: 'amount', label: 'Tutar', example: 12500.5, required: true },
      { key: 'currency', label: 'Para Birimi (TRY/EUR)', example: 'TRY' },
      { key: 'allocation', label: 'Dağıtım (direct/perGuest/weighted/equal/general)', example: 'weighted' },
      { key: 'roomNumber', label: 'Oda No (doğrudan gider için)', example: '101' },
      { key: 'vendor', label: 'Tedarikçi', example: 'Enerjisa' },
    ],
  },
  /**
   * e-Fatura portalı Excel çıktısı. Portal dosyasında başka sütunlar da bulunur;
   * içe aktarımda yalnızca aşağıdaki başlıklar okunur, sıraları önemli değildir.
   */
  gelenFatura: {
    sheet: 'Gelen Faturalar',
    target: 'purchaseInvoices',
    direction: 'gelen',
  columns: [
      { key: 'customer', label: 'Müşteri', example: 'MERAM ELEKTRİK PERAKENDE SATIŞ A.Ş.', required: true },
      { key: 'date', label: 'Fatura Tarihi', example: '2026-10-02', required: true },
      { key: 'invoiceNo', label: 'Fatura No', example: 'MRM2026000116826', required: true },
      { key: 'amount', label: 'Tutar', example: 39596 },
      { key: 'currency', label: 'Para Birimi', example: 'TRY' },
      { key: 'netAmount', label: 'Vergiler Hariç Toplam Tutar', example: 32997.04 },
      { key: 'grossAmount', label: 'Vergiler Dahil Toplam Tutar', example: 39596.06, required: true },
    ],
  },
  gidenFatura: {
    sheet: 'Giden Faturalar',
    target: 'salesInvoices',
    direction: 'giden',
  columns: [
      { key: 'customer', label: 'Müşteri', example: 'Yılmaz Turizm A.Ş.', required: true },
      { key: 'date', label: 'Fatura Tarihi', example: '2026-10-02', required: true },
      { key: 'invoiceNo', label: 'Fatura No', example: 'SCA2026000000685', required: true },
      { key: 'amount', label: 'Tutar', example: 39596 },
      { key: 'currency', label: 'Para Birimi', example: 'TRY' },
      { key: 'netAmount', label: 'Vergiler Hariç Toplam Tutar', example: 32997.04 },
      { key: 'grossAmount', label: 'Vergiler Dahil Toplam Tutar', example: 39596.06, required: true },
    ],
  },
};

/** "?" yardım butonunun indirdiği örnek şablon. */
export function templateSheets(kind = 'gider') {
  const template = TEMPLATES[kind] ?? TEMPLATES.gider;
  const rows = [
    template.columns.map((c) => c.label),
    template.columns.map((c) => c.example),
  ];
  const aciklama = [
    ['AÇIKLAMA'],
    ['1. İlk satır başlık satırıdır, değiştirmeyin.'],
    ['2. İkinci satır örnektir; kendi verinizi yazmadan önce silebilirsiniz.'],
    ['3. Tarihler YYYY-AA-GG biçiminde olmalıdır (örn. 2026-10-01). Excel tarih hücreleri de okunur.'],
    ['4. Tutarlarda binlik ayracı kullanmayın; ondalık için virgül veya nokta kullanabilirsiniz.'],
    ['5. Zorunlu sütunlar: ' + template.columns.filter((c) => c.required).map((c) => c.label).join(', ')],
  ];
  if (template.direction) {
    aciklama.push(
      ['6. e-Fatura portalından indirdiğiniz dosyayı olduğu gibi yükleyebilirsiniz;'],
      ['   yalnızca yukarıdaki başlıkları taşıyan sütunlar okunur, diğerleri yok sayılır.'],
      ['7. Hesaplamalarda "Vergiler Dahil Toplam Tutar" kullanılır; KDV = dahil − hariç.'],
      ['8. Aynı fatura numarası ikinci kez yüklenemez (mükerrer kayıt koruması).'],
    );
  }
  return [{ name: template.sheet, rows }, { name: 'Yardım', rows: aciklama }];
}
