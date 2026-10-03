/** Kritik finansal değişikliklerin kullanıcı ve tarih kaydı (PRD §8). */

import { newId } from './auth.js';

const MAX_ENTRIES = 5000;

export function record(db, { user, action, entity, entityId, summary }) {
  db.auditLog.push({
    id: newId('log'),
    at: new Date().toISOString(),
    userId: user?.id ?? null,
    username: user?.username ?? 'sistem',
    action,
    entity,
    entityId: entityId ?? null,
    summary: summary ?? '',
  });
  if (db.auditLog.length > MAX_ENTRIES) db.auditLog.splice(0, db.auditLog.length - MAX_ENTRIES);
}
