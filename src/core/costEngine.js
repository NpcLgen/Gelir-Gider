/**
 * Maliyet dağıtım motoru.
 *
 * Üç katmanlı dağıtım yapar:
 *  1) Doğrudan giderler        → ilgili odaya %100 (ör. jakuzi motor arızası → 101)
 *  2) Kişi başı sarfiyat       → kişi-gece sayısına göre (kahvaltı, su, buklet...)
 *     a) manuel girilen "perGuest" giderleri (toplam tutar paylaştırılır)
 *     b) kişi başı tarife (Cost Per Guest) ile otomatik üretilen sarfiyat
 *  3) Genel giderler           → demirbaş katsayısı × oda büyüklüğü × doluluk ağırlığı
 *
 * Ağırlık formülü (genel gider dağıtımı):
 *   w(oda, tür) = baseWeight × (1 + Σ demirbaş katsayıları[tür])
 *                            × (fixedShare + (1 − fixedShare) × doluluk oranı)
 *
 * `fixedShare`, boş odaların da üstlendiği sabit payı temsil eder (varsayılan 0.25).
 */

import { UTILITY_KINDS } from './catalog.js';
import { daysInPeriod, isValidDate, overlapNights, period as makePeriod, toTime } from './dates.js';
import { amenityLoad, reservationNights } from './model.js';

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Bir tutarı verilen ağırlıklara göre kuruş hassasiyetinde böler.
 * Yuvarlama artıkları en büyük kesirli paya eklenir; parçaların toplamı
 * her zaman tutarın kendisine eşittir.
 */
export function splitByWeights(amount, weights) {
  const total = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (!(total > 0)) return weights.map(() => 0);
  const cents = Math.round(amount * 100);
  const raw = weights.map((w) => (cents * (w > 0 ? w : 0)) / total);
  const shares = raw.map(Math.floor);
  const remainder = cents - shares.reduce((a, b) => a + b, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (let i = 0; i < remainder; i += 1) shares[order[i % order.length].index] += 1;
  return shares.map((c) => c / 100);
}

const inPeriod = (date, p) => isValidDate(date) && toTime(date) >= toTime(p.start) && toTime(date) < toTime(p.end);

/** Rezervasyonun dönem içine düşen gece sayısı. */
export function nightsInPeriod(reservation, p) {
  if (!isValidDate(reservation.checkIn) || !isValidDate(reservation.checkOut)) return 0;
  return overlapNights(reservation.checkIn, reservation.checkOut, p.start, p.end);
}

/**
 * Kişi başı tarifeden bir rezervasyonun dönem içi sarfiyatını üretir.
 * - guestNight : kişi × dönem içi gece
 * - guestStay  : kişi × konaklama (giriş tarihi dönem içindeyse)
 * - stay       : konaklama başına sabit (giriş tarihi dönem içindeyse)
 */
export function tariffLinesFor(reservation, p, settings) {
  const nights = nightsInPeriod(reservation, p);
  const guests = Math.max(0, Math.round(reservation.guests || 0));
  const arrival = inPeriod(reservation.checkIn, p);
  const lines = [];
  for (const item of settings.perGuestTariff ?? []) {
    if (item.active === false) continue;
    if (item.requiresBreakfast && reservation.breakfastIncluded === false) continue;
    let units = 0;
    if (item.basis === 'guestNight') units = guests * nights;
    else if (item.basis === 'guestStay') units = arrival ? guests : 0;
    else if (item.basis === 'stay') units = arrival ? 1 : 0;
    if (units <= 0) continue;
    lines.push({
      key: item.key,
      label: item.label,
      basis: item.basis,
      units,
      unitAmount: item.amount,
      amount: round2(units * item.amount),
    });
  }
  return lines;
}

/** Odaların dönem içi doluluk, gelir ve kişi-gece istatistikleri. */
export function buildRoomActivity(rooms, reservations, p, settings) {
  const days = daysInPeriod(p);
  const activity = new Map();
  for (const room of rooms) {
    activity.set(room.id, {
      room,
      roomNights: 0,
      guestNights: 0,
      stays: 0,
      revenue: 0,
      occupancyRate: 0,
      tariffLines: [],
      tariffCost: 0,
    });
  }

  for (const reservation of reservations) {
    if (reservation.status === 'cancelled') continue;
    const entry = activity.get(reservation.roomId);
    if (!entry) continue;
    const nights = nightsInPeriod(reservation, p);
    if (nights <= 0) continue;
    const totalNights = reservationNights(reservation);
    const guests = Math.max(0, Math.round(reservation.guests || 0));
    entry.roomNights += nights;
    entry.guestNights += nights * guests;
    if (inPeriod(reservation.checkIn, p)) entry.stays += 1;
    // Gelir, konaklama gecelerine eşit yayılır; sadece döneme düşen kısım sayılır.
    entry.revenue += totalNights > 0 ? (reservation.totalAmount * nights) / totalNights : 0;

    for (const line of tariffLinesFor(reservation, p, settings)) {
      entry.tariffLines.push({ ...line, reservationId: reservation.id, guestName: reservation.guestName });
      entry.tariffCost += line.amount;
    }
  }

  for (const entry of activity.values()) {
    entry.revenue = round2(entry.revenue);
    entry.tariffCost = round2(entry.tariffCost);
    entry.occupancyRate = days > 0 ? entry.roomNights / days : 0;
  }
  return activity;
}

/** Bir odanın genel gider dağıtım ağırlığı. */
export function utilityWeight(room, kind, occupancyRate, fixedShare) {
  if (room.status === 'passive') return 0;
  const base = room.baseWeight > 0 ? room.baseWeight : 1;
  const share = Math.min(1, Math.max(0, fixedShare));
  const occupancyFactor = share + (1 - share) * Math.min(1, Math.max(0, occupancyRate));
  return base * amenityLoad(room, kind) * occupancyFactor;
}

const emptyCosts = () => ({
  direct: 0,
  perGuest: 0,
  tariff: 0,
  equal: 0,
  weighted: { electricity: 0, water: 0, heating: 0 },
});

/**
 * Dönem raporunu üretir.
 * @returns {{period, rooms: Array, totals: Object, unallocated: Object}}
 */
export function buildReport({ rooms = [], reservations = [], expenses = [], settings, period: p }) {
  const activity = buildRoomActivity(rooms, reservations, p, settings);
  const fixedShare = settings.fixedShare ?? 0.25;
  const result = new Map();

  for (const room of rooms) {
    const entry = activity.get(room.id);
    result.set(room.id, {
      room,
      revenue: entry.revenue,
      roomNights: entry.roomNights,
      guestNights: entry.guestNights,
      stays: entry.stays,
      occupancyRate: entry.occupancyRate,
      costs: emptyCosts(),
      weights: Object.fromEntries(
        UTILITY_KINDS.map((kind) => [kind, utilityWeight(room, kind, entry.occupancyRate, fixedShare)]),
      ),
      amenityLoads: Object.fromEntries(UTILITY_KINDS.map((kind) => [kind, amenityLoad(room, kind)])),
      lines: entry.tariffLines.map((line) => ({
        source: 'tariff',
        label: `${line.label} (${line.units} × ${line.unitAmount})`,
        amount: line.amount,
      })),
    });
    result.get(room.id).costs.tariff = entry.tariffCost;
  }

  const unallocated = { general: 0, undistributed: 0, items: [] };
  const periodExpenses = expenses.filter((e) => inPeriod(e.date, p));
  const activeRooms = rooms.filter((r) => r.status === 'active');
  const totalGuestNights = [...activity.values()].reduce((sum, e) => sum + e.guestNights, 0);

  for (const expense of periodExpenses) {
    if (expense.allocation === 'general') {
      unallocated.general = round2(unallocated.general + expense.amount);
      unallocated.items.push({ ...expense, reason: 'İşletme geneli' });
      continue;
    }

    if (expense.allocation === 'direct') {
      const target = result.get(expense.roomId);
      if (!target) {
        unallocated.undistributed = round2(unallocated.undistributed + expense.amount);
        unallocated.items.push({ ...expense, reason: 'Oda bulunamadı' });
        continue;
      }
      target.costs.direct = round2(target.costs.direct + expense.amount);
      target.lines.push({ source: 'direct', label: expense.description, amount: expense.amount, expenseId: expense.id });
      continue;
    }

    let targets = [];
    let weights = [];

    if (expense.allocation === 'perGuest') {
      targets = rooms;
      weights = rooms.map((room) => activity.get(room.id).guestNights);
      if (totalGuestNights <= 0) {
        unallocated.undistributed = round2(unallocated.undistributed + expense.amount);
        unallocated.items.push({ ...expense, reason: 'Dönemde konaklama yok' });
        continue;
      }
    } else if (expense.allocation === 'equal') {
      targets = activeRooms;
      weights = activeRooms.map(() => 1);
    } else if (expense.allocation === 'weighted') {
      targets = rooms;
      weights = rooms.map((room) => result.get(room.id).weights[expense.weightKind] ?? 0);
      if (weights.every((w) => w <= 0)) {
        // Katsayı üretilemezse satıştaki odalara eşit dağıt.
        targets = activeRooms;
        weights = activeRooms.map(() => 1);
      }
    }

    if (!targets.length || weights.every((w) => w <= 0)) {
      unallocated.undistributed = round2(unallocated.undistributed + expense.amount);
      unallocated.items.push({ ...expense, reason: 'Dağıtılacak oda yok' });
      continue;
    }

    const shares = splitByWeights(expense.amount, weights);
    targets.forEach((room, index) => {
      const share = shares[index];
      if (!share) return;
      const target = result.get(room.id);
      if (expense.allocation === 'weighted') {
        target.costs.weighted[expense.weightKind] = round2(
          target.costs.weighted[expense.weightKind] + share,
        );
      } else {
        target.costs[expense.allocation] = round2(target.costs[expense.allocation] + share);
      }
      target.lines.push({
        source: expense.allocation,
        label: expense.description,
        amount: share,
        expenseId: expense.id,
      });
    });
  }

  const roomRows = [...result.values()].map((row) => {
    const weightedTotal = UTILITY_KINDS.reduce((sum, kind) => sum + row.costs.weighted[kind], 0);
    const totalCost = round2(
      row.costs.direct + row.costs.perGuest + row.costs.tariff + row.costs.equal + weightedTotal,
    );
    const profit = round2(row.revenue - totalCost);
    return {
      ...row,
      weightedTotal: round2(weightedTotal),
      totalCost,
      profit,
      margin: row.revenue > 0 ? profit / row.revenue : 0,
      costPerGuestNight: row.guestNights > 0 ? round2(totalCost / row.guestNights) : 0,
      revenuePerGuestNight: row.guestNights > 0 ? round2(row.revenue / row.guestNights) : 0,
      adr: row.roomNights > 0 ? round2(row.revenue / row.roomNights) : 0,
    };
  });

  const totals = roomRows.reduce(
    (acc, row) => {
      acc.revenue = round2(acc.revenue + row.revenue);
      acc.totalCost = round2(acc.totalCost + row.totalCost);
      acc.direct = round2(acc.direct + row.costs.direct);
      acc.perGuest = round2(acc.perGuest + row.costs.perGuest);
      acc.tariff = round2(acc.tariff + row.costs.tariff);
      acc.equal = round2(acc.equal + row.costs.equal);
      acc.weighted = round2(acc.weighted + row.weightedTotal);
      acc.guestNights += row.guestNights;
      acc.roomNights += row.roomNights;
      return acc;
    },
    { revenue: 0, totalCost: 0, direct: 0, perGuest: 0, tariff: 0, equal: 0, weighted: 0, guestNights: 0, roomNights: 0 },
  );

  totals.generalExpenses = round2(unallocated.general + unallocated.undistributed);
  totals.grossProfit = round2(totals.revenue - totals.totalCost);
  totals.netProfit = round2(totals.grossProfit - totals.generalExpenses);
  totals.margin = totals.revenue > 0 ? totals.netProfit / totals.revenue : 0;
  totals.occupancyRate = (() => {
    const capacity = rooms.filter((r) => r.status !== 'passive').length * daysInPeriod(p);
    return capacity > 0 ? totals.roomNights / capacity : 0;
  })();
  totals.costPerGuestNight = totals.guestNights > 0 ? round2(totals.totalCost / totals.guestNights) : 0;

  return { period: p, rooms: roomRows, totals, unallocated };
}

export { makePeriod as period };
