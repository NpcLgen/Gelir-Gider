/** Dışa aktarım (PRD §5 Faz 3, §6.1) — CSV, Excel ve PDF (yazdır → PDF). */

const BOM = '﻿';

export function toCsv(rows, { delimiter = ';' } = {}) {
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    return /["\n;,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(escape).join(delimiter)).join('\r\n');
}

export function downloadFile(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv(filename, rows) {
  downloadFile(filename, BOM + toCsv(rows), 'text/csv;charset=utf-8');
}

/**
 * Excel çıktısı: Excel'in doğrudan açtığı HTML tablo biçimi (.xls).
 * Harici kütüphane gerektirmez, Türkçe karakterler ve biçimlendirme korunur.
 */
export function exportExcel(filename, sheets) {
  const tables = sheets.map((sheet) => `
    <h3>${escapeHtml(sheet.title)}</h3>
    <table border="1" cellspacing="0" cellpadding="4">
      ${sheet.rows.map((row, index) => `<tr>${row
    .map((cell) => (index === 0 ? `<th>${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`))
    .join('')}</tr>`).join('')}
    </table>`).join('<br/>');

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head><meta charset="utf-8" /><style>th{background:#eee;text-align:left}</style></head>
    <body>${tables}</body></html>`;
  downloadFile(filename, BOM + html, 'application/vnd.ms-excel;charset=utf-8');
}

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Tarayıcının yazdırma penceresi üzerinden PDF çıktısı. */
export function printReport() {
  window.print();
}
