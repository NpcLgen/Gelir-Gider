/** Sunucu API istemcisi. Hatalar ValidationError/ApiError olarak yüzeye çıkar. */

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

export const api = {
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
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    return name;
  },
};
