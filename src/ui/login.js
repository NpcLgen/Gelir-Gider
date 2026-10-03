/** Giriş ekranı ve zorunlu şifre değiştirme (PRD §1.1, §7). */

import { api } from '../core/api.js';
import { clear, errorList, field, h, toast } from './dom.js';

/**
 * Giriş ekranını basar. Başarılı girişte `onSuccess(user)` çağrılır.
 */
export function loginView(root, onSuccess) {
  const draft = { username: '', password: '' };
  const errorBox = h('div', { class: 'error-box hidden' });
  const submit = h('button', { class: 'btn primary wide', type: 'submit' }, 'Giriş Yap');

  const doLogin = async () => {
    clear(errorBox).classList.add('hidden');
    submit.disabled = true;
    submit.textContent = 'Kontrol ediliyor…';
    try {
      const { user } = await api.post('/api/auth/login', draft);
      onSuccess(user);
    } catch (err) {
      errorBox.appendChild(errorList(err.errors ?? [err.message]));
      errorBox.classList.remove('hidden');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Giriş Yap';
    }
  };

  clear(root).appendChild(h('div', { class: 'login-page' },
    h('form', {
      class: 'login-card', onSubmit: (e) => { e.preventDefault(); doLogin(); },
    },
      h('div', { class: 'login-brand' },
        h('span', { class: 'brand-mark' }, '🏨'),
        h('div', {},
          h('h1', {}, 'Otel Finans ve Yönetim Sistemi'),
          h('p', { class: 'muted' }, 'Devam etmek için giriş yapın'))),
      errorBox,
      field('Kullanıcı Adı', h('input', {
        type: 'text', autocomplete: 'username', autofocus: true, required: true,
        onInput: (e) => { draft.username = e.target.value; },
      })),
      field('Şifre', h('input', {
        type: 'password', autocomplete: 'current-password', required: true,
        onInput: (e) => { draft.password = e.target.value; },
      })),
      submit,
      h('p', { class: 'muted small center' },
        'Yetkiniz olmayan modüller menüde görünmez. Şifrenizi bilmiyorsanız yöneticinize başvurun.'))));
}

/**
 * Varsayılan şifreyle giren kullanıcıyı şifre değiştirmeye zorlar (PRD §7).
 * Kapatılamaz; iptal edilirse oturum kapatılır.
 */
export function forcePasswordChange(root, { store, user, onDone, onLogout }) {
  const draft = { currentPassword: '', newPassword: '', repeat: '' };
  const errorBox = h('div', { class: 'error-box hidden' });

  const save = async () => {
    clear(errorBox).classList.add('hidden');
    if (draft.newPassword !== draft.repeat) {
      errorBox.appendChild(errorList(['Yeni şifreler eşleşmiyor.']));
      errorBox.classList.remove('hidden');
      return;
    }
    try {
      await store.changeOwnPassword(draft.currentPassword, draft.newPassword);
      toast('Şifreniz güncellendi.');
      onDone();
    } catch (err) {
      errorBox.appendChild(errorList(err.errors ?? [err.message]));
      errorBox.classList.remove('hidden');
    }
  };

  clear(root).appendChild(h('div', { class: 'login-page' },
    h('form', { class: 'login-card', onSubmit: (e) => { e.preventDefault(); save(); } },
      h('div', { class: 'login-brand' },
        h('span', { class: 'brand-mark' }, '🔐'),
        h('div', {},
          h('h1', {}, 'Şifre Değiştirme Zorunlu'),
          h('p', { class: 'muted' }, `${user.displayName || user.username} — varsayılan şifreyle giriş yaptınız.`))),
      errorBox,
      field('Mevcut Şifre', h('input', {
        type: 'password', autocomplete: 'current-password', required: true,
        onInput: (e) => { draft.currentPassword = e.target.value; },
      })),
      field('Yeni Şifre', h('input', {
        type: 'password', autocomplete: 'new-password', required: true,
        onInput: (e) => { draft.newPassword = e.target.value; },
      }), 'En az 6 karakter, en az bir harf ve bir rakam.'),
      field('Yeni Şifre (tekrar)', h('input', {
        type: 'password', autocomplete: 'new-password', required: true,
        onInput: (e) => { draft.repeat = e.target.value; },
      })),
      h('button', { class: 'btn primary wide', type: 'submit' }, 'Şifreyi Değiştir ve Devam Et'),
      h('button', {
        class: 'btn ghost wide', type: 'button',
        onClick: async () => { await api.post('/api/auth/logout'); onLogout(); },
      }, 'Çıkış Yap'))));
}
