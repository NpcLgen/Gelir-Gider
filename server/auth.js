/**
 * Kimlik doğrulama ve oturum yönetimi (PRD §1.1, §6, §7).
 *
 * Şifreler PBKDF2-SHA512 ile tuzlanarak saklanır (düz metin asla tutulmaz).
 * Oturumlar httpOnly çerezle taşınır; sunucu yeniden başladığında düşerler.
 */

import { randomBytes, pbkdf2 as pbkdf2Cb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { load, update } from './db.js';
import { allPermissions, normalizePermissions } from './permissions.js';

const pbkdf2 = promisify(pbkdf2Cb);

const ITERATIONS = 150000;
const KEYLEN = 64;
const DIGEST = 'sha512';

export const DEFAULT_ADMIN = { username: 'Admin', password: 'Admin2026' };
export const SESSION_COOKIE = 'otel_oturum';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 saat

/** username → eşitlik karşılaştırması büyük/küçük harf duyarsız. */
const sameUser = (a, b) => String(a ?? '').trim().toLocaleLowerCase('tr') === String(b ?? '').trim().toLocaleLowerCase('tr');

export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const derived = await pbkdf2(String(password), salt, ITERATIONS, KEYLEN, DIGEST);
  return { salt, hash: derived.toString('hex'), iterations: ITERATIONS };
}

export async function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.salt) return false;
  const derived = await pbkdf2(String(password), user.salt, user.iterations || ITERATIONS, KEYLEN, DIGEST);
  const stored = Buffer.from(user.passwordHash, 'hex');
  return stored.length === derived.length && timingSafeEqual(stored, derived);
}

export function newId(prefix) {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

/** Şifre politikası (PRD §7 güvenlik kuralı). */
export function passwordProblems(password) {
  const errors = [];
  const value = String(password ?? '');
  if (value.length < 6) errors.push('Şifre en az 6 karakter olmalıdır.');
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(value)) errors.push('Şifre en az bir harf içermelidir.');
  if (!/\d/.test(value)) errors.push('Şifre en az bir rakam içermelidir.');
  return errors;
}

/** Kurulumda varsayılan Admin hesabını oluşturur (PRD §7). */
export async function ensureDefaultAdmin() {
  const db = await load();
  if (db.users.length) return null;
  const { salt, hash, iterations } = await hashPassword(DEFAULT_ADMIN.password);
  return update((current) => {
    if (current.users.length) return null;
    const admin = {
      id: newId('usr'),
      username: DEFAULT_ADMIN.username,
      displayName: 'Sistem Yöneticisi',
      salt,
      passwordHash: hash,
      iterations,
      isAdmin: true,
      active: true,
      permissions: allPermissions(),
      /** İlk girişten sonra varsayılan şifre değiştirilmelidir. */
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };
    current.users.push(admin);
    return admin;
  });
}

/* ------------------------------------------------------------ oturumlar -- */

const sessions = new Map(); // token → { userId, expiresAt }

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function destroySession(token) {
  sessions.delete(token);
}

export function destroyUserSessions(userId) {
  for (const [token, session] of sessions) {
    if (session.userId === userId) sessions.delete(token);
  }
}

export async function userForToken(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const db = await load();
  const user = db.users.find((u) => u.id === session.userId);
  if (!user || user.active === false) return null;
  session.expiresAt = Date.now() + SESSION_TTL_MS; // kayan süre
  return user;
}

export function sessionCount() {
  return sessions.size;
}

export async function findUser(username) {
  const db = await load();
  return db.users.find((u) => sameUser(u.username, username)) ?? null;
}

/** Kullanıcı nesnesini istemciye güvenli biçimde hazırlar. */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: Boolean(user.isAdmin),
    active: user.active !== false,
    permissions: normalizePermissions(user.permissions),
    mustChangePassword: Boolean(user.mustChangePassword),
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt ?? null,
  };
}

export { sameUser };
