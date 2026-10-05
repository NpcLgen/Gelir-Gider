/**
 * Faz 3.0 — Ana Dashboard finansal hesaplama motoru (PRD III §4).
 *
 * Dokuz gösterge ve gelir vergisi algoritması tek yerde toplanır; böylece
 * Dashboard, raporlar ve testler aynı sonucu üretir.
 *
 * Vergi algoritması (PRD III §4):
 *   1) Toplam Gelir      = Otel Geliri + Restoran Geliri
 *   2) Toplam İndirimler = Toplam Giderler (sigortalı maaşlar dâhil)
 *                          + Gider KDV Toplamı + Konaklama Vergisi + Turizm Payı
 *   3) Vergi Matrahı     = Toplam Gelir − Toplam İndirimler
 *   4) Gelir Vergisi     = Vergi Matrahı × oran
 *
 * NET KÂR = Vergi Matrahı − Gelir Vergisi.
 */

const num = (value, fallback = 0) => {
  const n = typeof value === 'string' ? Number(String(value).replace(',', '.')) : Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** İç yüzde ile KDV: tutar KDV dahilken taşıdığı vergi. */
export const vatInside = (grossAmount, ratePercent) => {
  const rate = num(ratePercent, 0);
  return round2((num(grossAmount, 0) * rate) / (100 + rate));
};

/**
 * Dönemin dokuz göstergesini hesaplar.
 *
 * @param {object} input
 * @param {number} input.hotelRevenue        Otel geliri (KDV dahil)
 * @param {number} input.restaurantRevenue   Restoran geliri (KDV dahil)
 * @param {number} input.expenses            Toplam giderler (sigortalı maaşlar dâhil)
 * @param {number} input.payroll             Sigortalı çalışan maaşları (giderlerin içindeki payı)
 * @param {number} input.expenseVat          Gider faturalarındaki KDV (dahil − hariç farkı)
 * @param {number} input.exchangeGain        Olumlu kur farkı (gelir)
 * @param {number} input.exchangeLoss        Olumsuz kur farkı (gider)
 * @param {object} input.rates               Vergi oranları
 */
export function businessSummary({
  hotelRevenue = 0,
  restaurantRevenue = 0,
  expenses = 0,
  payroll = 0,
  expenseVat = 0,
  exchangeGain = 0,
  exchangeLoss = 0,
  rates = {},
} = {}) {
  const hotelVatRate = num(rates.kdvIncome, 10);
  const restaurantVatRate = num(rates.kdvRestaurant, hotelVatRate);
  const accommodationRate = num(rates.accommodationTax, 0);
  const tourismRate = num(rates.tourismShare, 0);
  const incomeTaxRate = num(rates.incomeTax, 0);

  const hotel = round2(hotelRevenue);
  const restaurant = round2(restaurantRevenue);
  const totalRevenue = round2(hotel + restaurant);

  /* --- 4 · Otel ve restoran gelir KDV'si --- */
  const hotelVat = vatInside(hotel, hotelVatRate);
  const restaurantVat = vatInside(restaurant, restaurantVatRate);
  const incomeVat = round2(hotelVat + restaurantVat);

  /* --- 5 · Gider KDV toplamı (fatura dahil − hariç farkı) --- */
  const purchaseVat = round2(expenseVat);

  /* --- 6, 7 · Turizm payı ve konaklama vergisi: SADECE otel geliri üzerinden --- */
  // Matrah KDV hariç otel gelirİdir; KDV'nin üzerinden vergi alınmaz.
  const hotelNetRevenue = round2(hotel - hotelVat);
  const accommodationTax = round2((hotelNetRevenue * accommodationRate) / 100);
  const tourismShare = round2((hotelNetRevenue * tourismRate) / 100);

  /* --- 3 · Toplam giderler (kur farkı dâhil) --- */
  const totalExpenses = round2(expenses + num(exchangeLoss, 0));
  const totalRevenueWithFx = round2(totalRevenue + num(exchangeGain, 0));

  /* --- 8 · Gelir vergisi: dört adımlı algoritma --- */
  const totalDeductions = round2(totalExpenses + purchaseVat + accommodationTax + tourismShare);
  const taxBase = round2(totalRevenueWithFx - totalDeductions);
  const incomeTax = round2(Math.max(0, taxBase) * (incomeTaxRate / 100));

  /* --- 9 · Net kâr --- */
  const netProfit = round2(taxBase - incomeTax);

  return {
    /** 1 */ hotelRevenue: hotel,
    /** 2 */ restaurantRevenue: restaurant,
    /** 3 */ totalExpenses,
    /** 4 */ incomeVat,
    hotelVat,
    restaurantVat,
    /** 5 */ expenseVat: purchaseVat,
    /** 6 */ tourismShare,
    /** 7 */ accommodationTax,
    /** 8 */ incomeTax,
    /** 9 */ netProfit,

    // Ara değerler (formül kartında gösterilir)
    totalRevenue,
    totalRevenueWithFx,
    exchangeGain: round2(exchangeGain),
    exchangeLoss: round2(exchangeLoss),
    hotelNetRevenue,
    payroll: round2(payroll),
    otherExpenses: round2(expenses - payroll),
    totalDeductions,
    taxBase,
    netVat: round2(incomeVat - purchaseVat),
    margin: totalRevenueWithFx > 0 ? netProfit / totalRevenueWithFx : 0,
    rates: {
      kdvIncome: hotelVatRate,
      kdvRestaurant: restaurantVatRate,
      accommodationTax: accommodationRate,
      tourismShare: tourismRate,
      incomeTax: incomeTaxRate,
    },
  };
}

export { round2 };
