# Butik Otel BI · Gelir-Gider ve Kârlılık Yönetim Sistemi

9 odalı bir butik otelin **finansal verimliliğine, oda bazlı maliyetlerine ve net
kârlılığına** odaklanan bir BI aracı. Ön büro programı değil: gelir-gider dengesini
şeffaflaştırır, ortak giderleri odalara dağıtır ve oda başına net kârı hesaplar.

Tüm gereksinimler ve hesaplama kuralları: **[PRD.md](PRD.md)**

## Hızlı başlangıç

```bash
npm start     # http://localhost:5173
npm test      # 62 birim testi (node:test, bağımlılıksız)
```

Derleme adımı ve bağımlılık yoktur — `index.html` doğrudan ES modülleri yükler.
Veriler tarayıcıda `localStorage`'da tutulur; ilk açılışta 9 odalı demo verisi gelir.

Tarayıcı akış testi opsiyoneldir (Playwright gerektirir, depo bağımlılığı değildir):

```bash
npm i -D playwright && npx playwright install chromium
npm start &                 # sunucu ayakta olmalı
npm run test:browser        # 28 adımlı uçtan uca akış
```

## Modüller

| Modül | Ne yapar | PRD |
| --- | --- | --- |
| **Dashboard** | Kâr/zarar, marj, ADR, RevPAR, doluluk, kişi başı maliyet; gider dağılım grafiği, başa baş noktası, YOY analizi | §3 |
| **Fiyat / Gelir Takvimi** | Odalar × günler fiyat ızgarası, toplu güncelleme (hafta içi/hafta sonu), fiyat kopyalama, boş gün vurgulama | §1.1 |
| **Gider Yönetimi** | Aktif/pasif anahtarı, dekont eki, tekrarlayan giderler, grup filtreleri, beş dağıtım yöntemi | §1.2, §2.3 |
| **Rezervasyonlar** | Kapasiteyle sınırlı kişi sayısı, çakışma kontrolü, TL/EUR tutar, acenta komisyonu | §8.4.2 |
| **Oda Ayarları (Oda Kartı)** | Numara + konsept ismi, yatak yapılandırması, demirbaş checkbox modülü, canlı maliyet etkisi | §8.4 |
| **Finansal Raporlar** | Dönem özeti, oda kârlılığı, gider dökümü; PDF / Excel / CSV dışa aktarım | §5, §6.1 |
| **Sistem Ayarları** | Dağıtım yöntemi A/B/C, hedef marj, kur kaynağı, kategori yöneticisi, kişi başı tarife | §8 |

## Maliyet dağıtımı — özet

```
ağırlık(oda, tür) = yöntemAğırlığı(oda, tür) × ( sabitPay + (1 − sabitPay) × dolulukOranı )

yöntemAğırlığı =  A → 1                     (eşit)
                  B → oda m²                (metrekare bazlı)
                  C → maliyetÇarpanı × (1 + Σ demirbaş katsayıları)   (özel katsayı)
```

| Gider | Dağıtım tabanı |
| --- | --- |
| Jakuzi motor arızası | %100 → ilgili oda |
| Kahvaltı, su, buklet | kişi-gece oranı (Cost Per Guest) |
| Elektrik, su, doğalgaz | yukarıdaki ağırlık formülü |
| Kira, personel | satıştaki odalara eşit |
| Komisyon, vergi | dağıtılmaz (işletme geneli) |

Tutarlar girildikleri para biriminde saklanır, **kendi tarihlerinin kuruyla** TL'ye
çevrilir; sağ üstteki `₺ / €` anahtarı raporları anında diğer para biriminde gösterir.

Ayrıntılar ve örnek senaryo: [PRD.md §2.1](PRD.md#21-dinamik-maliyet-dağıtım-algoritması-cost-allocation-) ·
[PRD.md §8.4](PRD.md#84-gelişmiş-oda-profili-ve-envanter-kartları-kişi-bazlı-maliyet-altyapısı-)

## Bilinen sınırlar

* **TCMB kuru:** Servis tarayıcıya CORS başlığı göndermediğinden doğrudan çekim
  engellenebilir; bu durumda manuel kur geçerli kalır. Kesintisiz otomatik kur için
  sunucu tarafı proxy Faz 2 kapsamındadır (PRD §2.4).
* **Kalıcılık:** Veriler tek tarayıcıda `localStorage`'da tutulur. Çok cihaz/çok
  kullanıcı için ilişkisel veritabanı Faz 2'dedir (PRD §5). Yedek: Ayarlar → JSON dışa aktar.
