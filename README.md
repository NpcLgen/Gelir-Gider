# Gelir-Gider · Oda Bazlı Kârlılık

Konaklama işletmeleri (butik otel, pansiyon, apart) için **oda bazında** gelir-gider ve
kârlılık takip sistemi. Her odanın kendi "Oda Kartı" vardır; kapasite ve demirbaş
seçimleri, giderlerin odalara nasıl dağıtılacağını belirler.

Ürün gereksinimleri ve hesaplama kuralları: **[PRD.md](PRD.md)**

## Hızlı başlangıç

```bash
npm start     # http://localhost:5173
npm test      # birim testleri (node:test, bağımlılıksız)
```

Tarayıcı akış testi opsiyoneldir (Playwright gerektirir, depo bağımlılığı değildir):

```bash
npm i -D playwright && npx playwright install chromium
npm start &                 # sunucu ayakta olmalı
npm run test:browser
```

Derleme adımı ve bağımlılık yoktur — `index.html` doğrudan ES modülleri yükler.
Veriler tarayıcıda `localStorage`'da tutulur; ilk açılışta demo verisi gelir.

## Ne yapar?

* **Oda Kartı** — numara + konsept ismi, yatak yapılandırması, maksimum kişi sayısı ve
  demirbaş/özellik listesi (checkbox). Seçimlerin maliyet etkisi canlı hesaplanır.
* **Rezervasyon** — kişi sayısı oda kapasitesini aşamaz, tarih çakışması engellenir.
* **Gider** — beş dağıtım yöntemi: doğrudan odaya, kişi başı, demirbaş katsayılı,
  eşit, işletme geneli.
* **Kişi Başı Maliyet (Cost Per Guest)** — kahvaltı, su, buklet gibi sarfiyat
  `kişi × gece` tabanında ilgili odaya yazılır.
* **Maliyet Çarpanı** — jakuzi, klima, sauna gibi donanımlar odanın elektrik/su/ısıtma
  payını artırır.
* **Panel** — dönem KPI'ları ve oda bazlı kârlılık tablosu, kalem kalem gider kırılımı.

## Maliyet dağıtımı — özet

```
ağırlık(oda, tür) = büyüklükKatsayısı × (1 + Σ demirbaşKatsayısı[tür])
                  × ( sabitPay + (1 − sabitPay) × dolulukOranı )
```

| Gider türü | Dağıtım tabanı |
| --- | --- |
| Jakuzi motor arızası | %100 → ilgili oda |
| Kahvaltı, su, buklet | kişi-gece oranı |
| Elektrik, su, doğalgaz | yukarıdaki ağırlık formülü |
| Kira, personel | satıştaki odalara eşit |
| Komisyon, vergi | dağıtılmaz (işletme geneli) |

Ayrıntılar ve örnek senaryo için [PRD.md §5](PRD.md#5-hesaplama-kuralları).

## Proje yapısı

| Yol | İçerik |
| --- | --- |
| `src/core/` | Saf iş mantığı — tarayıcı ve testler aynı kodu kullanır |
| `src/ui/` | Bağımlılıksız DOM görünümleri (`roomCard.js` = Oda Kartı paneli) |
| `test/` | `node:test` birim testleri |
| `scripts/serve.js` | Bağımlılıksız statik geliştirme sunucusu |
