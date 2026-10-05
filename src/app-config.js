/**
 * Uygulama yapılandırması ve arka uç seçimi.
 *
 * İki çalışma biçimi vardır:
 *
 *  • `rest`     — depodaki Node sunucusu (`npm start`). Veriler `data/db.json`.
 *  • `firebase` — yalnızca statik dosya sunan paylaşımlı hosting (cPanel).
 *                 Kimlik doğrulama Firebase Authentication, veri Firebase
 *                 Realtime Database üzerinden REST ile yürür; sunucu gerekmez.
 *
 * `backend: 'auto'` (varsayılan) ortamı kendisi anlar: sayfanın yanında çalışan
 * bir `/api` ucu varsa Node sunucusu, yoksa Firebase kullanılır. Böylece aynı
 * dosyalar hem geliştirme makinesinde hem cPanel'de değişiklik yapılmadan
 * çalışır.
 *
 * cPanel'e yüklemeden önce aşağıdaki `firebase` bloğunu kendi proje
 * bilgilerinizle değiştirin (bkz. DEPLOY.md).
 */

export const APP_CONFIG = {
  /** 'auto' | 'rest' | 'firebase' */
  backend: 'auto',

  /**
   * Firebase proje bilgileri (Firebase Console → Proje ayarları → Web uygulaması).
   * Bu değerler tarayıcıya açıktır; güvenlik `database.rules.json` ile sağlanır.
   */
  firebase: {
    apiKey: 'AIzaSyCaXBbIOLyFQtv_HzUWWjMO2HZ9SOhCLiw',
    authDomain: 'gelir-gider-3a491.firebaseapp.com',
    databaseURL: 'https://gelir-gider-3a491-default-rtdb.firebaseio.com/',
    projectId: 'gelir-gider-3a491',
    storageBucket: 'gelir-gider-3a491.firebasestorage.app',
    messagingSenderId: '512056142056',
    appId: '1:512056142056:web:a5624ba725498068a8815d',
    measurementId: 'G-V3W56J00TH',

    /**
     * Kullanıcılar sisteme kullanıcı adıyla girer; Firebase e-posta ister.
     * "mehmet" → "mehmet@otel.local" şeklinde tamamlanır. E-posta yazan
     * kullanıcılar için olduğu gibi kullanılır.
     */
    loginDomain: 'otel.local',
  },
};

/** Node sunucusunun yanında mı çalışıyoruz? (sayfaya göreli `api/...` denenir) */
async function hasRestApi() {
  try {
    const url = new URL('api/auth/me', document.baseURI);
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    // Statik hosting burada 404 + HTML döndürür; Node sunucusu 401 + JSON.
    return (response.headers.get('content-type') ?? '').includes('application/json');
  } catch {
    return false;
  }
}

let resolved = null;

/**
 * Arka ucu seçer ve API katmanına bağlar. `mount()` öncesinde bir kez çağrılır.
 * @returns {Promise<'rest'|'firebase'>}
 */
export async function configureBackend(config = APP_CONFIG) {
  if (resolved) return resolved;

  const mode = config.backend === 'auto'
    ? (await hasRestApi() ? 'rest' : 'firebase')
    : config.backend;

  if (mode === 'firebase') {
    const [{ setApiImplementation }, { createFirebaseApi }] = await Promise.all([
      import('./core/api.js'),
      import('./core/backend/firebase.js'),
    ]);
    setApiImplementation(createFirebaseApi(config.firebase));
  }

  resolved = mode;
  return mode;
}

/** Testler için seçim belleğini sıfırlar. */
export const resetBackendChoice = () => { resolved = null; };
