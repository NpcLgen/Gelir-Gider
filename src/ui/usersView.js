/** Kullanıcı ve Yetki Yönetimi — yalnızca Admin (PRD §6). */

import { formatDate } from '../core/format.js';
import { clear, confirmDialog, errorList, field, h, openModal, toast } from './dom.js';

export function usersView(app) {
  const { users, modules, me, auditLog } = app.store.getState();

  const rows = users.map((user) => h('tr', { class: user.active ? '' : 'passive-row' },
    h('td', {}, h('strong', {}, user.displayName || user.username),
      h('div', { class: 'muted small' }, `@${user.username}`)),
    h('td', {}, user.isAdmin
      ? h('span', { class: 'pill pill-active' }, '👑 Admin')
      : h('span', { class: 'pill' }, 'Kullanıcı')),
    h('td', {}, user.isAdmin
      ? h('span', { class: 'muted small' }, 'Tüm modüller')
      : h('span', { class: 'muted small' }, `${Object.values(user.permissions).filter(Boolean).length} / ${modules.length} modül`)),
    h('td', {}, user.active
      ? h('span', { class: 'pill pill-active' }, 'Aktif')
      : h('span', { class: 'pill pill-passive' }, 'Pasif')),
    h('td', { class: 'muted small' }, user.lastLoginAt
      ? new Date(user.lastLoginAt).toLocaleString('tr-TR')
      : 'Hiç giriş yapmadı'),
    h('td', {}, user.mustChangePassword ? h('span', { class: 'badge-warn' }, 'Şifre değiştirmeli') : ''),
    h('td', {}, h('div', { class: 'row gap' },
      h('button', { class: 'icon-btn', type: 'button', title: 'Düzenle', onClick: () => openUserForm(app, user) }, '✏️'),
      user.id === me?.id
        ? h('span', { class: 'muted small', title: 'Kendi hesabınızı silemezsiniz' }, '—')
        : h('button', {
          class: 'icon-btn', type: 'button', title: 'Sil',
          onClick: () => confirmDialog(`${user.username} kullanıcısı silinsin mi?`, async () => {
            try {
              await app.store.deleteUser(user.id);
              app.refresh();
              toast('Kullanıcı silindi.', 'warn');
            } catch (err) {
              toast(err.message, 'error');
            }
          }),
        }, '🗑️')))));

  return h('div', { class: 'stack' },
    h('div', { class: 'row between center wrap gap' },
      h('div', {},
        h('h1', {}, 'Kullanıcı ve Yetki Yönetimi'),
        h('p', { class: 'muted' }, 'Yetkisi kapalı modüller kullanıcının menüsünde görünmez ve sunucu tarafında da engellenir.')),
      h('button', { class: 'btn primary', type: 'button', onClick: () => openUserForm(app, null) }, '＋ Yeni Kullanıcı')),

    h('div', { class: 'card table-card' },
      h('table', {},
        h('thead', {}, h('tr', {}, ...['Kullanıcı', 'Rol', 'Yetkiler', 'Durum', 'Son Giriş', '', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...rows))),

    h('section', { class: 'card table-card' },
      h('header', { class: 'card-header' },
        h('h3', {}, 'İşlem Kayıtları'),
        h('span', { class: 'muted small' }, 'Kritik finansal değişiklikler kullanıcı ve tarihle kaydedilir')),
      h('table', {},
        h('thead', {}, h('tr', {}, ...['Zaman', 'Kullanıcı', 'İşlem', 'Kayıt', 'Özet'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...(auditLog.length
          ? auditLog.slice(0, 60).map((entry) => h('tr', {},
            h('td', { class: 'muted small' }, new Date(entry.at).toLocaleString('tr-TR')),
            h('td', {}, entry.username),
            h('td', {}, h('span', { class: 'tag' }, actionLabel(entry.action))),
            h('td', { class: 'muted small' }, entry.entity),
            h('td', {}, entry.summary)))
          : [h('tr', {}, h('td', { colspan: '5', class: 'empty' }, 'Kayıt yok.'))])))));
}

const actionLabel = (action) => ({
  create: 'Oluşturma', update: 'Güncelleme', delete: 'Silme', login: 'Giriş',
  logout: 'Çıkış', import: 'İçe aktarım', bulk: 'Toplu işlem', password_change: 'Şifre',
}[action] ?? action);

export function openUserForm(app, source) {
  const { modules } = app.store.getState();
  const draft = {
    id: source?.id,
    username: source?.username ?? '',
    displayName: source?.displayName ?? '',
    password: '',
    isAdmin: source?.isAdmin ?? false,
    active: source?.active !== false,
    permissions: { ...(source?.permissions ?? {}) },
  };

  openModal({
    title: source ? `Kullanıcı: ${source.username}` : 'Yeni Kullanıcı',
    subtitle: 'Modül erişimleri aç/kapa anahtarlarıyla yönetilir.',
    size: 'lg',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      const permissionBox = h('div', { class: 'perm-grid' });

      const renderPermissions = () => {
        clear(permissionBox);
        if (draft.isAdmin) {
          permissionBox.appendChild(h('p', { class: 'muted' },
            '👑 Admin kullanıcı tüm modüllere erişir; ayrıca yetki seçmeye gerek yoktur.'));
          return;
        }
        const groups = modules.reduce((acc, module) => {
          (acc[module.group] ||= []).push(module);
          return acc;
        }, {});
        for (const [group, items] of Object.entries(groups)) {
          permissionBox.appendChild(h('div', { class: 'perm-group' },
            h('h4', {}, group),
            ...items.map((module) => h('label', { class: `perm-row${draft.permissions[module.key] ? ' checked' : ''}` },
              h('input', {
                type: 'checkbox', checked: Boolean(draft.permissions[module.key]),
                dataset: { module: module.key },
                onChange: (e) => {
                  draft.permissions[module.key] = e.target.checked;
                  e.target.closest('.perm-row').classList.toggle('checked', e.target.checked);
                },
              }),
              h('span', { class: 'toggle-mini' }),
              h('span', {}, module.label)))));
        }
      };
      renderPermissions();

      return h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
        errorBox,
        h('div', { class: 'grid-3' },
          field('Kullanıcı Adı *', h('input', {
            type: 'text', value: draft.username, class: 'user-username', autocomplete: 'off',
            onInput: (e) => { draft.username = e.target.value; },
          })),
          field('Ad Soyad', h('input', {
            type: 'text', value: draft.displayName, class: 'user-display',
            onInput: (e) => { draft.displayName = e.target.value; },
          })),
          field(source ? 'Yeni Şifre (boş bırakılırsa değişmez)' : 'Şifre *', h('input', {
            type: 'password', value: draft.password, class: 'user-password', autocomplete: 'new-password',
            onInput: (e) => { draft.password = e.target.value; },
          }), 'En az 6 karakter, bir harf ve bir rakam.')),
        h('div', { class: 'row gap wrap' },
          h('label', { class: 'check-inline' },
            h('input', {
              type: 'checkbox', checked: draft.isAdmin, class: 'user-admin',
              onChange: (e) => { draft.isAdmin = e.target.checked; renderPermissions(); },
            }), '👑 Admin (tüm yetkiler + kullanıcı yönetimi)'),
          h('label', { class: 'check-inline' },
            h('input', {
              type: 'checkbox', checked: draft.active,
              onChange: (e) => { draft.active = e.target.checked; },
            }), 'Aktif (pasif kullanıcı giriş yapamaz)')),
        h('h4', {}, 'Modül Yetkileri'),
        permissionBox,
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'submit',
            onClick: async () => {
              try {
                const payload = { ...draft };
                if (!payload.password) delete payload.password;
                await app.store.saveUser(payload);
                toast('Kullanıcı kaydedildi.');
                close();
                app.refresh();
              } catch (err) {
                clear(errorBox).appendChild(errorList(err.errors ?? [err.message]));
                errorBox.classList.remove('hidden');
              }
            },
          }, 'Kaydet')));
    },
  });
}

/** Kendi şifresini değiştirme (her kullanıcı). */
export function openOwnPasswordForm(app) {
  const draft = { currentPassword: '', newPassword: '', repeat: '' };
  openModal({
    title: 'Şifre Değiştir',
    size: 'sm',
    content: (close) => {
      const errorBox = h('div', { class: 'error-box hidden' });
      return h('form', { class: 'stack', onSubmit: (e) => e.preventDefault() },
        errorBox,
        field('Mevcut Şifre', h('input', {
          type: 'password', autocomplete: 'current-password',
          onInput: (e) => { draft.currentPassword = e.target.value; },
        })),
        field('Yeni Şifre', h('input', {
          type: 'password', autocomplete: 'new-password',
          onInput: (e) => { draft.newPassword = e.target.value; },
        })),
        field('Yeni Şifre (tekrar)', h('input', {
          type: 'password', autocomplete: 'new-password',
          onInput: (e) => { draft.repeat = e.target.value; },
        })),
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Vazgeç'),
          h('button', {
            class: 'btn primary', type: 'submit',
            onClick: async () => {
              clear(errorBox).classList.add('hidden');
              if (draft.newPassword !== draft.repeat) {
                errorBox.appendChild(errorList(['Yeni şifreler eşleşmiyor.']));
                errorBox.classList.remove('hidden');
                return;
              }
              try {
                await app.store.changeOwnPassword(draft.currentPassword, draft.newPassword);
                toast('Şifreniz güncellendi.');
                close();
              } catch (err) {
                errorBox.appendChild(errorList(err.errors ?? [err.message]));
                errorBox.classList.remove('hidden');
              }
            },
          }, 'Şifreyi Değiştir')));
    },
  });
}
