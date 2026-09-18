/** Statik sunucunun yol çözümlemesi — Windows ve POSIX'te aynı davranmalı. */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { resolveFile } from '../scripts/serve.js';

const WIN_ROOT = 'C:\\Users\\SAFRAN CAVE HOTEL\\Desktop\\otel';
const POSIX_ROOT = '/home/user/otel';

test('kök istek Windows’ta index.html’e çözülür', () => {
  // Regresyon: path.normalize('/') Windows'ta '\' döndürdüğü için index.html
  // eklenmiyor, sunucu dizini okumaya çalışıp "Bulunamadı" veriyordu.
  assert.equal(resolveFile(WIN_ROOT, '/', path.win32), `${WIN_ROOT}\\index.html`);
});

test('kök istek POSIX’te index.html’e çözülür', () => {
  assert.equal(resolveFile(POSIX_ROOT, '/', path.posix), `${POSIX_ROOT}/index.html`);
});

test('alt klasördeki dosyalar her iki sistemde de çözülür', () => {
  assert.equal(resolveFile(WIN_ROOT, '/src/ui/app.js', path.win32), `${WIN_ROOT}\\src\\ui\\app.js`);
  assert.equal(resolveFile(POSIX_ROOT, '/src/ui/app.js', path.posix), `${POSIX_ROOT}/src/ui/app.js`);
});

test('boşluk içeren klasör adları ve yüzde kodlaması çözülür', () => {
  // Kullanıcı yolu "C:\Users\SAFRAN CAVE HOTEL\..." gibi boşluk içerebilir.
  assert.equal(
    resolveFile(WIN_ROOT, '/test/browser/screen%20shots/a.png', path.win32),
    `${WIN_ROOT}\\test\\browser\\screen shots\\a.png`,
  );
});

test('sonu eğik çizgiyle biten yol dizin kabul edilir', () => {
  assert.equal(resolveFile(POSIX_ROOT, '/src/', path.posix), `${POSIX_ROOT}/src/index.html`);
  assert.equal(resolveFile(WIN_ROOT, '/src/', path.win32), `${WIN_ROOT}\\src\\index.html`);
});

test('kök dizinin dışına çıkma denemeleri engellenir', () => {
  for (const [root, api] of [[WIN_ROOT, path.win32], [POSIX_ROOT, path.posix]]) {
    for (const attack of ['/../../gizli.txt', '/..%2f..%2fgizli.txt', '/src/../../gizli.txt']) {
      const file = resolveFile(root, attack, api);
      assert.ok(
        file === null || file === api.resolve(root) || file.startsWith(api.resolve(root) + api.sep),
        `kök dışına çıktı: ${attack} → ${file}`,
      );
    }
  }
});

test('bozuk yüzde kodlaması reddedilir', () => {
  assert.equal(resolveFile(POSIX_ROOT, '/%E0%A4%A', path.posix), null);
});
