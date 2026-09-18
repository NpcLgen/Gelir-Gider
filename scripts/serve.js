#!/usr/bin/env node
/** Bağımlılıksız statik sunucu: `npm start` → http://localhost:5173 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path === '/' || path.endsWith('/')) path += 'index.html';
    const file = join(root, path);
    if (!file.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    await stat(file);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Bulunamadı');
  }
});

/**
 * Port doluysa (EADDRINUSE) çökmek yerine sıradaki boş portu dener.
 * Başka bir uygulama ya da unutulmuş bir sunucu 5173'ü tutuyorsa bile çalışır.
 */
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
  console.log('  Durdurmak için: Ctrl + C');
  console.log('');
});

server.listen(port);
