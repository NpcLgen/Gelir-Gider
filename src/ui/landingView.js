/**
 * Karşılama (Landing) sayfası — PRD III §3.
 *
 * Domaine girildiğinde kullanıcıyı doğrudan giriş paneli değil, yazılımın
 * amacını ve faydalarını anlatan kurumsal bir sayfa karşılar. "Giriş Yap"
 * düğmeleri mevcut giriş ekranına yönlendirir.
 */

import { clear, h } from './dom.js';

const FEATURES = [
  {
    icon: '🎯',
    title: 'Nokta Atışı Kârlılık Analizi',
    text: 'Genel giderler odalara metrekare, kişi sayısı veya özel katsayıyla dağıtılır; '
      + 'her odanın gecelik maliyeti, başa baş fiyatı ve tavsiye edilen satış fiyatı ayrı ayrı görünür.',
  },
  {
    icon: '🧮',
    title: 'Otomatik Vergi Hesaplama',
    text: 'Otel ve restoran KDV’si, konaklama vergisi, turizm payı ve gelir vergisi '
      + 'güncel oranlarla otomatik hesaplanır; matrah dökümü adım adım gösterilir.',
  },
  {
    icon: '🍽️',
    title: 'Otel ve Restoran Finansı Bir Arada',
    text: 'Konaklama gelirleri, restoran gün sonu kayıtları, toptancı cari hesapları ve '
      + 'personel giderleri tek panelde birleşir.',
  },
  {
    icon: '📑',
    title: 'e-Fatura Excel Aktarımı',
    text: 'Portaldan indirdiğiniz gelen ve giden fatura dosyalarını olduğu gibi yükleyin; '
      + 'kayıtlar doğrudan işlenir, mükerrer faturalar otomatik atlanır.',
  },
];

/** Uygulamanın arayüzünü temsil eden hafif bir SVG mockup. */
function heroMockup() {
  const bar = (x, height, color) => `<rect x="${x}" y="${150 - height}" width="26" height="${height}" rx="5" fill="${color}"/>`;
  return h('div', {
    class: 'landing-mockup',
    'aria-hidden': 'true',
    html: `
      <svg viewBox="0 0 420 260" role="img" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="420" height="260" rx="16" fill="#131a28"/>
        <rect x="0" y="0" width="420" height="34" rx="16" fill="#1a2335"/>
        <circle cx="20" cy="17" r="5" fill="#e0575c"/>
        <circle cx="38" cy="17" r="5" fill="#f0b429"/>
        <circle cx="56" cy="17" r="5" fill="#199e70"/>
        <rect x="14" y="50" width="118" height="54" rx="10" fill="#1b2435"/>
        <rect x="26" y="62" width="60" height="7" rx="3" fill="#56637d"/>
        <rect x="26" y="78" width="86" height="13" rx="4" fill="#4ca98a"/>
        <rect x="146" y="50" width="118" height="54" rx="10" fill="#1b2435"/>
        <rect x="158" y="62" width="54" height="7" rx="3" fill="#56637d"/>
        <rect x="158" y="78" width="80" height="13" rx="4" fill="#5b9ae8"/>
        <rect x="278" y="50" width="128" height="54" rx="10" fill="#1b2435"/>
        <rect x="290" y="62" width="64" height="7" rx="3" fill="#56637d"/>
        <rect x="290" y="78" width="92" height="13" rx="4" fill="#e08f5a"/>
        <rect x="14" y="118" width="392" height="128" rx="12" fill="#1b2435"/>
        <g transform="translate(40 76)">
          ${bar(0, 54, '#5b9ae8')}${bar(44, 86, '#4ca98a')}${bar(88, 38, '#e08f5a')}
          ${bar(132, 104, '#5b9ae8')}${bar(176, 66, '#4ca98a')}${bar(220, 92, '#8e86e0')}
          ${bar(264, 48, '#e0575c')}${bar(308, 78, '#4ca98a')}
        </g>
      </svg>`,
  });
}

/**
 * Karşılama sayfasını basar.
 * @param {HTMLElement} root
 * @param {Function} onLogin "Giriş Yap" tıklanınca çağrılır
 */
export function landingView(root, onLogin) {
  const loginButton = (extraClass = '') => h('button', {
    class: `btn primary landing-login ${extraClass}`.trim(), type: 'button', onClick: onLogin,
  }, 'Giriş Yap');

  clear(root).appendChild(h('div', { class: 'landing' },
    h('header', { class: 'landing-top' },
      h('div', { class: 'landing-brand' },
        h('span', { class: 'brand-mark' }, '🏨'),
        h('div', {},
          h('strong', {}, 'Otel Finans'),
          h('div', { class: 'muted small' }, 'Yönetim Sistemi'))),
      loginButton('landing-login-top')),

    h('section', { class: 'landing-hero' },
      h('div', { class: 'landing-hero-text' },
        h('p', { class: 'landing-eyebrow' }, 'Butik oteller için finans yönetimi'),
        h('h1', {}, 'Butik Otel Gelir Gider Sistemi'),
        h('p', { class: 'landing-lead' },
          'Konaklama ve restoran gelirlerinizi, tüm giderlerinizi, vergi yükümlülüklerinizi ve '
          + 'oda bazlı kârlılığınızı tek ekranda görün. Gelir ve gider faturalarınızı Excel’den '
          + 'aktarın, net kârınızı anında hesaplayın.'),
        h('div', { class: 'landing-cta' },
          loginButton('landing-login-hero'),
          h('span', { class: 'muted small' }, 'Hesabınız yöneticiniz tarafından tanımlanır.'))),
      heroMockup()),

    h('section', { class: 'landing-features' },
      h('h2', {}, 'Sistem ne sağlıyor?'),
      h('div', { class: 'landing-feature-grid' },
        ...FEATURES.map((feature) => h('article', { class: 'card landing-feature' },
          h('span', { class: 'landing-feature-icon' }, feature.icon),
          h('h3', {}, feature.title),
          h('p', { class: 'muted small' }, feature.text))))),

    h('footer', { class: 'landing-footer' },
      h('div', { class: 'landing-footer-grid' },
        h('div', {},
          h('h4', {}, 'İletişim'),
          h('p', { class: 'muted small' },
            h('a', { href: 'tel:+908508400000' }, '+90 850 840 00 00'), h('br'),
            h('a', { href: 'mailto:info@otelfinans.com' }, 'info@otelfinans.com'))),
        h('div', {},
          h('h4', {}, 'Destek'),
          h('p', { class: 'muted small' },
            h('a', { href: 'mailto:destek@otelfinans.com' }, 'destek@otelfinans.com'), h('br'),
            'Hafta içi 09:00 – 18:00')),
        h('div', {},
          h('h4', {}, 'Sistem'),
          h('p', { class: 'muted small' },
            'Kurulum ve kullanım belgeleri uygulama içinde yer alır.', h('br'),
            'Veriler işletmenin kendi sunucusunda saklanır.'))),
      h('p', { class: 'landing-copyright muted small' },
        `© ${new Date().getFullYear()} Otel Finans ve Yönetim Sistemi · Tüm hakları saklıdır.`))));
}
