/**
 * Maliyet dağıtım motoru ve finansal metrikler.
 *
 * Dağıtım katmanları:
 *  1) Doğrudan giderler    → ilgili odaya %100 (ör. jakuzi motor arızası → 101)
 *  2) Kişi başı sarfiyat   → kişi-gece sayısına göre (kahvaltı, su, buklet…)
 *     a) manuel `perGuest` giderleri, b) kişi başı tarife (Cost Per Guest)
 *  3) Genel giderler       → PRD §8.1'deki yönteme göre (A eşit / B m² / C özel katsayı)
 *
 * Ağırlık formülü (genel gider dağıtımı):
 *   w(oda, tür) = yöntemAğırlığı(oda, tür) × (fixedShare + (1 − fixedShare) × doluluk)
 *
 * Tüm tutarlar hesaba TRY (baz para birimi) olarak girer; EUR kalemler kendi
 * tarihlerindeki kurla çevrilir (PRD §2.4 — gerçekleşen kâr/zarar).
 */

import { BASE_CURRENCY, EXPENSE_GROUPS, UTILITY_KINDS } from './catalog.js';
import {
  addDays,
  daysInPeriod,
  eachDate,
  isValidDate,
  overlapNights,
  period as makePeriod,
  toTime,
} from './dates.js';
import { rateFor, toBase } from './fx.js';
import {
  amenityLoad,
  defaultSettings,
  expenseGroup,
  isWriteOff,
  reservationNights,
} from './model.js';

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

/**
 * Pasif giderleri eler, tekrarlayan giderleri (abonelikleri) dönem içinde
 * gerçek kalemler hâline getirir ve tutarları baz para birimine çevirir.
 * PRD §1.2 (aktif/pasif) ve §2.3 (tekrarlayan giderler).
 */
export function expandExpenses(expenses, p, settings) {
  const fx = settings.fx;
  const out = [];
  const push = (expense, date) => {
    out.push({
      ...expense,
      date,
      occurrenceId: date === expense.date ? expense.id : `${expense.id}@${date}`,
      generated: date !== expense.date,
      amountBase: round2(toBase(expense.amount, expense.currency, rateFor(fx, date))),
      group: expenseGroup(expense),
    });
  };

  for (const expense of expenses) {
    if (expense.active === false) continue;
    if (!isValidDate(expense.date)) continue;

    if (!expense.recurring?.enabled) {
      if (inPeriod(expense.date, p)) push(expense, expense.date);
      continue;
    }

    const day = String(expense.recurring.dayOfMonth).padStart(2, '0');
    for (const date of eachDate(p)) {
      if (!date.endsWith(`-${day}`)) continue;
      if (date < expense.date) continue; // abonelik başlangıcından önce yansımaz
      if (expense.recurring.until && date > expense.recurring.until) continue;
      push(expense, date);
    }
  }
  return out;
}

/** Odaların dönem içi doluluk, gelir ve kişi-gece istatistikleri. */
export function buildRoomActivity(rooms, reservations, p, settings) {
  const days = daysInPeriod(p);
  const fx = settings.fx;
  const activity = new Map();
  for (const room of rooms) {
    activity.set(room.id, {
      room,
      roomNights: 0,
      guestNights: 0,
      stays: 0,
      revenue: 0,
      commission: 0,
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
    const gross = toBase(reservation.totalAmount, reservation.currency, rateFor(fx, reservation.checkIn));
    const share = totalNights > 0 ? (gross * nights) / totalNights : 0;
    entry.revenue += share;
    entry.commission += share * ((reservation.commissionRate || 0) / 100);

    for (const line of tariffLinesFor(reservation, p, settings)) {
      entry.tariffLines.push({ ...line, reservationId: reservation.id, guestName: reservation.guestName });
      entry.tariffCost += line.amount;
    }
  }

  for (const entry of activity.values()) {
    entry.revenue = round2(entry.revenue);
    entry.commission = round2(entry.commission);
    entry.tariffCost = round2(entry.tariffCost);
    entry.occupancyRate = days > 0 ? entry.roomNights / days : 0;
  }
  return activity;
}

/** PRD §8.1 — seçili yönteme göre odanın ham dağıtım ağırlığı. */
export function methodWeight(room, kind, method) {
  if (method === 'equal') return 1;
  if (method === 'area') return room.area > 0 ? room.area : 1;
  const base = room.baseWeight > 0 ? room.baseWeight : 1;
  return base * amenityLoad(room, kind);
}

/** Odanın genel gider dağıtım ağırlığı (doluluk etkisi dâhil). */
export function utilityWeight(room, kind, occupancyRate, fixedShare, method = 'coefficient') {
  if (room.status === 'passive') return 0;
  const share = Math.min(1, Math.max(0, fixedShare));
  const occupancyFactor = share + (1 - share) * Math.min(1, Math.max(0, occupancyRate));
  return methodWeight(room, kind, method) * occupancyFactor;
}

/** Fiyat takviminden dönem içi beklenen (projeksiyon) geliri hesaplar. */
export function projectedRevenue(rooms, prices, p, settings) {
  const fx = settings.fx;
  const dates = eachDate(p);
  const byRoom = new Map();
  let total = 0;
  let filledDays = 0;
  let missingDays = 0;

  for (const room of rooms) {
    if (room.status === 'passive') continue;
    let roomTotal = 0;
    let filled = 0;
    for (const date of dates) {
      const entry = prices?.[room.id]?.[date];
      if (entry && entry.amount > 0) {
        roomTotal += toBase(entry.amount, entry.currency, rateFor(fx, date));
        filled += 1;
      }
    }
    filledDays += filled;
    missingDays += dates.length - filled;
    byRoom.set(room.id, { total: round2(roomTotal), filled, missing: dates.length - filled });
    total += roomTotal;
  }

  return {
    total: round2(total),
    byRoom,
    filledDays,
    missingDays,
    coverage: filledDays + missingDays > 0 ? filledDays / (filledDays + missingDays) : 0,
  };
}

const emptyCosts = () => ({
  direct: 0,
  perGuest: 0,
  tariff: 0,
  equal: 0,
  weighted: { electricity: 0, water: 0, heating: 0 },
});

/**
 * Dönem raporunu üretir. Tüm tutarlar baz para biriminde (TRY) döner.
 * @returns {{period, rooms: Array, totals: Object, unallocated: Object, byGroup: Object}}
 */
export function buildReport({ rooms = [], reservations = [], expenses = [], prices = {}, settings, period: p }) {
  const cfg = { ...defaultSettings(), ...(settings ?? {}) };
  const activity = buildRoomActivity(rooms, reservations, p, cfg);
  const fixedShare = cfg.fixedShare ?? 0.25;
  const method = cfg.allocationMethod ?? 'coefficient';
  const result = new Map();

  for (const room of rooms) {
    const entry = activity.get(room.id);
    result.set(room.id, {
      room,
      revenue: entry.revenue,
      commission: entry.commission,
      roomNights: entry.roomNights,
      guestNights: entry.guestNights,
      stays: entry.stays,
      occupancyRate: entry.occupancyRate,
      costs: emptyCosts(),
      writeOff: 0,
      weights: Object.fromEntries(
        UTILITY_KINDS.map((kind) => [kind, utilityWeight(room, kind, entry.occupancyRate, fixedShare, method)]),
      ),
      amenityLoads: Object.fromEntries(UTILITY_KINDS.map((kind) => [kind, amenityLoad(room, kind)])),
      lines: entry.tariffLines.map((line) => ({
        source: 'tariff',
        label: `${line.label} (${line.units} × ${line.unitAmount})`,
        amount: line.amount,
        group: 'operational',
      })),
    });
    result.get(room.id).costs.tariff = entry.tariffCost;
  }

  const unallocated = { general: 0, undistributed: 0, items: [] };
  const byGroup = Object.fromEntries(EXPENSE_GROUPS.map((g) => [g.key, 0]));
  const byCategory = {};
  const periodExpenses = expandExpenses(expenses, p, cfg);
  const activeRooms = rooms.filter((r) => r.status === 'active');
  const totalGuestNights = [...activity.values()].reduce((sum, e) => sum + e.guestNights, 0);
  let writeOffTotal = 0;

  const note = (expense) => {
    byGroup[expense.group] = round2((byGroup[expense.group] ?? 0) + expense.amountBase);
    byCategory[expense.category] = round2((byCategory[expense.category] ?? 0) + expense.amountBase);
    if (isWriteOff(expense)) writeOffTotal = round2(writeOffTotal + expense.amountBase);
  };

  for (const expense of periodExpenses) {
    note(expense);
    const amount = expense.amountBase;

    if (expense.allocation === 'general') {
      unallocated.general = round2(unallocated.general + amount);
      unallocated.items.push({ ...expense, reason: 'İşletme geneli' });
      continue;
    }

    if (expense.allocation === 'direct') {
      const target = result.get(expense.roomId);
      if (!target) {
        unallocated.undistributed = round2(unallocated.undistributed + amount);
        unallocated.items.push({ ...expense, reason: 'Oda bulunamadı' });
        continue;
      }
      target.costs.direct = round2(target.costs.direct + amount);
      if (isWriteOff(expense)) target.writeOff = round2(target.writeOff + amount);
      target.lines.push({
        source: 'direct', label: expense.description, amount, expenseId: expense.id, group: expense.group,
      });
      continue;
    }

    let targets = [];
    let weights = [];

    if (expense.allocation === 'perGuest') {
      targets = rooms;
      weights = rooms.map((room) => activity.get(room.id).guestNights);
      if (totalGuestNights <= 0) {
        unallocated.undistributed = round2(unallocated.undistributed + amount);
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
      unallocated.undistributed = round2(unallocated.undistributed + amount);
      unallocated.items.push({ ...expense, reason: 'Dağıtılacak oda yok' });
      continue;
    }

    const shares = splitByWeights(amount, weights);
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
      if (isWriteOff(expense)) target.writeOff = round2(target.writeOff + share);
      target.lines.push({
        source: expense.allocation, label: expense.description, amount: share, expenseId: expense.id, group: expense.group,
      });
    });
  }

  // Tarife sarfiyatı operasyonel gider grubuna eklenir (pasta grafik bütünlüğü).
  const tariffTotal = [...result.values()].reduce((sum, row) => sum + row.costs.tariff, 0);
  byGroup.operational = round2((byGroup.operational ?? 0) + tariffTotal);
  if (tariffTotal > 0) byCategory.perGuestTariff = round2(tariffTotal);

  const projection = projectedRevenue(rooms, prices, p, cfg);

  const roomRows = [...result.values()].map((row) => {
    const weightedTotal = UTILITY_KINDS.reduce((sum, kind) => sum + row.costs.weighted[kind], 0);
    const totalCost = round2(
      row.costs.direct + row.costs.perGuest + row.costs.tariff + row.costs.equal + weightedTotal,
    );
    const netRevenue = round2(row.revenue - row.commission);
    const profit = round2(netRevenue - totalCost);
    const projected = projection.byRoom.get(row.room.id);
    return {
      ...row,
      netRevenue,
      weightedTotal: round2(weightedTotal),
      totalCost,
      profit,
      margin: netRevenue > 0 ? profit / netRevenue : 0,
      costPerGuestNight: row.guestNights > 0 ? round2(totalCost / row.guestNights) : 0,
      revenuePerGuestNight: row.guestNights > 0 ? round2(row.revenue / row.guestNights) : 0,
      adr: row.roomNights > 0 ? round2(row.revenue / row.roomNights) : 0,
      revpar: daysInPeriod(p) > 0 && row.room.status !== 'passive'
        ? round2(row.revenue / daysInPeriod(p))
        : 0,
      projectedRevenue: projected?.total ?? 0,
      missingPriceDays: projected?.missing ?? 0,
    };
  });

  const totals = roomRows.reduce(
    (acc, row) => {
      acc.revenue = round2(acc.revenue + row.revenue);
      acc.commission = round2(acc.commission + row.commission);
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
    {
      revenue: 0, commission: 0, totalCost: 0, direct: 0, perGuest: 0, tariff: 0,
      equal: 0, weighted: 0, guestNights: 0, roomNights: 0,
    },
  );

  const days = daysInPeriod(p);
  const sellableRooms = rooms.filter((r) => r.status !== 'passive').length;
  const availableRoomNights = sellableRooms * days;

  totals.netRevenue = round2(totals.revenue - totals.commission);
  totals.generalExpenses = round2(unallocated.general + unallocated.undistributed);
  totals.grossProfit = round2(totals.netRevenue - totals.totalCost);
  totals.netProfit = round2(totals.grossProfit - totals.generalExpenses);
  totals.expenses = round2(totals.totalCost + totals.generalExpenses);
  totals.margin = totals.netRevenue > 0 ? totals.netProfit / totals.netRevenue : 0;
  totals.occupancyRate = availableRoomNights > 0 ? totals.roomNights / availableRoomNights : 0;
  totals.availableRoomNights = availableRoomNights;
  totals.costPerGuestNight = totals.guestNights > 0 ? round2(totals.totalCost / totals.guestNights) : 0;
  totals.adr = totals.roomNights > 0 ? round2(totals.revenue / totals.roomNights) : 0;
  totals.revpar = availableRoomNights > 0 ? round2(totals.revenue / availableRoomNights) : 0;
  totals.writeOff = writeOffTotal;
  totals.projectedRevenue = projection.total;
  totals.priceCoverage = projection.coverage;
  totals.missingPriceDays = projection.missingDays;
  totals.targetMargin = cfg.targetMargin ?? 0;
  totals.targetMet = totals.margin >= (cfg.targetMargin ?? 0);

  return {
    period: p,
    currency: BASE_CURRENCY,
    rooms: roomRows,
    totals,
    unallocated,
    byGroup,
    byCategory,
    expenses: periodExpenses,
    breakEven: breakEven({ totals, byGroup, availableRoomNights }),
  };
}

/**
 * Başa baş noktası (PRD §3.2).
 * Sabit giderler, satılan oda-gecesi başına değişken maliyet ve mevcut ADR üzerinden
 * "zarar etmemek için gereken doluluk" ve "gereken minimum fiyat" hesaplanır.
 */
export function breakEven({ totals, byGroup, availableRoomNights }) {
  const fixedCost = round2(byGroup.fixed ?? 0);
  const variableCost = round2((byGroup.variable ?? 0) + (byGroup.operational ?? 0) + (byGroup.marketing ?? 0));
  const soldNights = totals.roomNights;
  const variablePerNight = soldNights > 0 ? round2(variableCost / soldNights) : 0;
  const adr = totals.adr;
  const contribution = round2(adr - variablePerNight);

  const requiredNights = contribution > 0 ? fixedCost / contribution : null;
  return {
    fixedCost,
    variableCost,
    variablePerNight,
    contributionPerNight: contribution,
    requiredRoomNights: requiredNights == null ? null : Math.ceil(requiredNights),
    requiredOccupancy: requiredNights != null && availableRoomNights > 0
      ? requiredNights / availableRoomNights
      : null,
    /** Mevcut dolulukta zarar etmemek için gereken minimum ortalama gece fiyatı. */
    requiredAdr: soldNights > 0 ? round2((fixedCost + variableCost) / soldNights) : null,
  };
}

/** İki dönemin karşılaştırması (PRD §3.2 — YOY). */
export function compareReports(current, previous) {
  const delta = (a, b) => ({
    current: a,
    previous: b,
    change: round2(a - b),
    ratio: b !== 0 ? (a - b) / Math.abs(b) : null,
  });
  return {
    revenue: delta(current.totals.revenue, previous.totals.revenue),
    expenses: delta(current.totals.expenses, previous.totals.expenses),
    netProfit: delta(current.totals.netProfit, previous.totals.netProfit),
    occupancyRate: delta(current.totals.occupancyRate, previous.totals.occupancyRate),
    adr: delta(current.totals.adr, previous.totals.adr),
    revpar: delta(current.totals.revpar, previous.totals.revpar),
  };
}

export { makePeriod as period, addDays };
