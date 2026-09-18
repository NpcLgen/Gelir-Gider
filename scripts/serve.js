#!/usr/bin/env node
/** Bağımlılıksız statik sunucu: `npm start` → http://127.0.0.1:5173 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import nodePath, { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

/**
 * URL yolunu disk üzerindeki güvenli bir dosya yoluna çevirir.
 *
 * Windows ve POSIX'te aynı davranması gerekir: `path.normalize('/')` Windows'ta
 * ters eğik çizgi döndürdüğü için dizin tespiti URL yolu üzerinden yapılır,
 * ayırıcı dönüşümü sonradan uygulanır. Kök dizinin dışına çıkan istekler
 * (`..`) reddedilir.
 *
 * @returns {string|null} dosya yolu, kök dışına çıkılıyorsa null
 */
export function resolveFile(rootDir, urlPath, path = nodePath) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath);
  } catch {
    return null; // bozuk yüzde kodlaması
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Baştaki ayırıcıları ve kök dışına çıkma denemelerini temizle.
  const relative = path.normalize(pathname).replace(/^([\\/]|\.\.[\\/])+/, '');
  const base = path.resolve(rootDir);
  const file = path.resolve(base, relative);
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  return file;
}

export function createStaticServer() {
  return createServer(async (req, res) => {
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-cache' });
      res.end(body);
    };

    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      let file = resolveFile(root, url.pathname);
      if (!file) {
        send(403, 'Erişim reddedildi');
        return;
      }

      let stats = await stat(file);
      if (stats.isDirectory()) {
        file = join(file, 'index.html');
        stats = await stat(file);
      }

      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': stats.size,
        'cache-control': 'no-cache',
      });
      res.end(body);
      } catch {
        send(404, `Bulunamadı: ${req.url}\n\nSunucunun kök klasörü: ${root}\nBu klasörde index.html bulunmalıdır.`);
      }
  });
}

/**
 * Sunucuyu başlatır. Port doluysa (EADDRINUSE) çökmek yerine sıradaki boş portu
 * dener; başka bir uygulama ya da unutulmuş bir sunucu 5173'ü tutuyorsa bile çalışır.
 */
export async function start() {
  // Açılışta kök klasörü doğrula: yanlış klasörde başlatıldıysa net uyarı ver.
  try {
    await stat(join(root, 'index.html'));
  } catch {
    console.error('');
    console.error('  HATA: index.html bulunamadı.');
    console.error(`  Bakılan klasör: ${root}`);
    console.error('  Sunucuyu projenin kök klasöründen çalıştırın (package.json ile aynı yerde).');
    console.error('');
    process.exit(1);
  }

  const server = createStaticServer();
  const MAX_TRIES = 20;
  let attempt = 0;

  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') {
      console.error(`Sunucu başlatılamadı: ${err.message}`);
      process.exit(1);
    }
    attempt += 1;
    if (attempt > MAX_TRIES) {
      console.error(`${port}–${port + MAX_TRIES} portlarının hepsi dolu. PORT=9000 npm start ile farklı bir port deneyin.`);
      process.exit(1);
    }
    const busy = port + attempt - 1;
    console.log(`${busy} portu dolu, ${busy + 1} deneniyor…`);
    server.listen(port + attempt);
  });

  server.on('listening', () => {
    const actual = server.address().port;
    console.log('');
    console.log('  Gelir-Gider çalışıyor. Tarayıcıda şu adresi açın:');
    console.log('');
    console.log(`      http://127.0.0.1:${actual}`);
    console.log('');
    console.log(`  Klasör: ${root}`);
    console.log('  Durdurmak için: Ctrl + C');
    console.log('');
  });

  server.listen(port);
  return server;
}

// Yalnızca doğrudan çalıştırıldığında başlat (test dosyaları import edebilsin).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await start();
}
