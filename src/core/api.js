/**
 * API istemcisi. Hatalar ValidationError/ApiError olarak yüzeye çıkar.
 *
 * Varsayılan taşıyıcı Node sunucusuna HTTP ile gider. cPanel gibi yalnızca
 * statik dosya sunan ortamlarda `setApiImplementation()` ile Firebase
 * uygulaması devreye alınır; görünümler ve `store.js` değişmez.
 */

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export class ApiError extends Error {
  constructor(status, message, payload = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

/** Oturum düştüğünde uygulamanın giriş ekranına dönmesi için kanca. */
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, { body, raw, query } = {}) {
  const url = query ? `${path}?${new URLSearchParams(query)}` : path;
  const options = { method, credentials: 'same-origin', headers: {} };

  if (raw) {
    options.body = raw;
    options.headers['content-type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    options.body = JSON.stringify(body);
    options.headers['content-type'] = 'application/json';
  }

  const response = await fetch(url, options);
  const type = response.headers.get('content-type') ?? '';

  if (!type.includes('application/json')) {
    if (!response.ok) throw new ApiError(response.status, `Sunucu hatası (${response.status}).`);
    return response;
  }

  const payload = await response.json();
  if (response.ok) return payload;

  // Girişin kendisi ve oturum sorgusu "oturum düştü" kancasını tetiklemez;
  // aksi hâlde hatalı şifre mesajı ekrana basılır basılmaz silinirdi.
  const isAuthProbe = path === '/api/auth/login' || path === '/api/auth/me';
  if (response.status === 401 && !isAuthProbe) onUnauthorized();
  if (response.status === 422 && Array.isArray(payload.errors)) throw new ValidationError(payload.errors);
  throw new ApiError(response.status, payload.error ?? `Sunucu hatası (${response.status}).`, payload);
}

/** Dosyayı tarayıcıya indirtir (her iki arka uçta da ortak). */
export function downloadBlob(blob, name) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return name;
}

/** Node sunucusuna konuşan varsayılan uygulama. */
const restImplementation = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  del: (path) => request('DELETE', path),
  postRaw: (path, raw, query) => request('POST', path, { raw, query }),
  /** Dosya indirir (Excel çıktıları). */
  async download(path, query, fallbackName = 'dosya.xlsx') {
    const url = query ? `${path}?${new URLSearchParams(query)}` : path;
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) onUnauthorized();
      throw new ApiError(response.status, payload.error ?? 'Dosya indirilemedi.');
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
    return downloadBlob(await response.blob(), name);
  },
};

let implementation = restImplementation;

/** Arka uç uygulamasını değiştirir (ör. Firebase). */
export function setApiImplementation(next) {
  implementation = next ?? restImplementation;
}

/** Hangi arka ucun etkin olduğunu söyler. */
export const activeBackend = () => (implementation === restImplementation ? 'rest' : 'firebase');

/** Oturum düştü kancasını arka uç uygulamaları da tetikleyebilir. */
export const notifyUnauthorized = () => onUnauthorized();

export const api = {
  get: (path, query) => implementation.get(path, query),
  post: (path, body) => implementation.post(path, body),
  put: (path, body) => implementation.put(path, body),
  del: (path) => implementation.del(path),
  postRaw: (path, raw, query) => implementation.postRaw(path, raw, query),
  download: (path, query, fallbackName) => implementation.download(path, query, fallbackName),
};
