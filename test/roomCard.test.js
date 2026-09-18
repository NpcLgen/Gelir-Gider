import test from 'node:test';
import assert from 'node:assert/strict';

// Oda Kartı modülü saf hesaplarını Node'da da çalıştırabilmeli (DOM'a bağımlı değil).
import { dailyGuestCost } from '../src/ui/roomCard.js';
import { defaultSettings } from '../src/core/model.js';

test('tam dolulukta günlük kişi başı sarfiyat, kişi-gece tabanlı kalemlerden hesaplanır', () => {
  const settings = defaultSettings(); // kahvaltı 145 + su 18 + buklet 22 = 185 TL/kişi/gece
  assert.equal(dailyGuestCost(settings, 1), 185);
  assert.equal(dailyGuestCost(settings, 3), 555);
});

test('pasif tarife kalemi günlük sarfiyata girmez', () => {
  const settings = defaultSettings();
  settings.perGuestTariff = settings.perGuestTariff.map((t) => (t.key === 'breakfast' ? { ...t, active: false } : t));
  assert.equal(dailyGuestCost(settings, 2), 80); // (18 + 22) × 2
});
