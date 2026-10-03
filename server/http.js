/** HTTP yardımcıları: gövde okuma, çerez ayrıştırma, JSON yanıt. */

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export const sendError = (res, status, message, extra = {}) =>
  sendJson(res, status, { error: message, ...extra });

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key) out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function cookieHeader(name, value, { maxAge, clear = false } = {}) {
  const parts = [`${name}=${clear ? '' : encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (clear) parts.push('Max-Age=0');
  else if (maxAge) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

export async function readBody(req, { limit = 25 * 1024 * 1024 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('İstek gövdesi çok büyük.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req) {
  const body = await readBody(req, { limit: 8 * 1024 * 1024 });
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new Error('Geçersiz JSON gövdesi.');
  }
}
