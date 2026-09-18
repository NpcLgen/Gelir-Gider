# Gelir-Gider · Ürün Gereksinim Dokümanı (PRD)

**Ürün:** Konaklama işletmeleri için oda bazlı gelir-gider ve kârlılık takip sistemi
**Sürüm:** 0.1 · **Durum:** Uygulanmış (bu depodaki kod bu dokümanı karşılar)

---

## 1. Amaç

Küçük ve orta ölçekli konaklama işletmelerinde (butik otel, pansiyon, apart) kârlılık
**işletme toplamında değil, oda bazında** ölçülmelidir. Bir odanın gerçek maliyeti üç
bileşenden oluşur:

1. **Odaya özel giderler** — o odadaki bir cihazın bakımı, arızası, demirbaş yenilemesi.
2. **Kişi bazlı sarfiyat** — kahvaltı, su, buklet seti, nevresim: odada *kaç kişinin*
   *kaç gece* kaldığıyla doğru orantılıdır.
3. **Genel giderlerden alınan pay** — elektrik, su, doğalgaz: jakuzili, saunalı,
   klimalı bir oda, standart bir odadan belirgin biçimde fazla tüketir.

Sistem bu üç bileşeni ayrı ayrı modelleyip her odanın net kârını üretir. Bunun için
temel veri kaynağı **Oda Kartı**'dır (bkz. §4.7).

## 2. Hedef Kullanıcılar

| Rol | İhtiyaç |
| --- | --- |
| İşletme sahibi | Hangi oda kazandırıyor, hangisi zarar ettiriyor? |
| Ön büro / resepsiyon | Kapasiteyi aşmayan, çakışmayan rezervasyon girişi |
| Muhasebe | Giderin doğru odaya/yönteme yazılması, dönem raporu |
| Teknik servis | Hangi odada hangi cihaz var, bakım gideri kime yazılacak? |

## 3. Kapsam

**Kapsam içi:** oda kartları, rezervasyon, gider kaydı, maliyet dağıtım motoru,
dönemsel oda kârlılığı raporu, kişi başı sarfiyat tarifesi, veri dışa/içe aktarımı.

**Kapsam dışı (v0.1):** çok kullanıcılı yetkilendirme, kanal yöneticisi (channel
manager) entegrasyonu, e-fatura, KDV ayrıştırması, çok şubeli işletme.

---

## 4. Modüller

### 4.1 Oda Yönetimi
Oda ızgarası (`Odalar` sekmesi). Her oda bir karta tıklanarak yönetilir. Kart üzerinde
dönem geliri, gideri, kârı ve doluluğu özet olarak gösterilir.

### 4.2 Rezervasyon Yönetimi
Misafir, oda, tarih aralığı, kişi sayısı, tutar, kanal ve kahvaltı durumu. Kişi sayısı
oda kapasitesiyle sınırlıdır (§4.7.2). Aynı odada tarih çakışması engellenir.

### 4.3 Gider Yönetimi
Her gider bir **dağıtım yöntemi** ile kaydedilir:

| Yöntem | Kullanım | Dağıtım tabanı |
| --- | --- | --- |
| `direct` | Odaya özel bakım/onarım/demirbaş | %100 seçili oda |
| `perGuest` | Kahvaltı, sarf malzeme, çamaşırhane | Kişi-gece oranı |
| `weighted` | Elektrik, su, doğalgaz | Demirbaş katsayısı × büyüklük × doluluk |
| `equal` | Personel, kira | Satıştaki odalara eşit |
| `general` | Komisyon, vergi, pazarlama | Dağıtılmaz, işletme geneli |

Kategori seçimi, yöntemi otomatik ön-doldurur; kullanıcı değiştirebilir.

### 4.4 Maliyet Dağıtım Motoru
`src/core/costEngine.js`. Dönem (ay) bazlı çalışır, §5'teki formülleri uygular.

### 4.5 Raporlama
`Panel` sekmesi: dönem KPI'ları (gelir, dağıtılan gider, işletme geneli gider, net kâr,
doluluk, kişi başı maliyet) ve oda bazlı kârlılık tablosu. Satıra tıklandığında kalem
kalem gider kırılımı açılır.

### 4.6 Ayarlar
Kişi başı sarfiyat tarifesi, boş odaların sabit pay oranı, veri dışa/içe aktarımı,
demo verisine dönüş.

---

### 4.7 Gelişmiş Oda Profili ve Envanter Kartları (Kişi Bazlı Maliyet Altyapısı)

Sistemin kârlılığı, oda spesifik masrafları ve kişi bazlı sarfiyatları doğru
hesaplayabilmesi için her odanın detaylı bir **"Oda Kartı"** mantığıyla yönetildiği
yapılandırma modülüdür. Odalar ızgarasında bir odaya tıklandığında açılan panelde
aşağıdaki parametreler yapılandırılır.

> **Uygulama:** `src/ui/roomCard.js` (arayüz), `src/core/model.js` (kural ve doğrulama),
> `src/core/catalog.js` (yatak ve demirbaş katalogları).

#### 4.7.1 Oda İsimlendirme ve Tanımlama

* Odalara özel **numara** ve **konsept ismi** atanabilir (Örn: `101 - King Suite`,
  `102 - Bahçe Manzaralı Standart`).
* Ek alanlar: kat, durum (Satışta / Bakımda / Pasif), gecelik liste fiyatı,
  **oda büyüklük katsayısı** (standart oda = 1; süit = 1,4 gibi) ve serbest not.
* Oda numarası zorunludur ve tekrar edemez. Etiketleme kuralı:
  `numara - konsept ismi`, konsept ismi boşsa yalnızca numara.

#### 4.7.2 Kapasite ve Yatak Yapılandırması

* Odadaki **yatak tipi ve sayısı** satır satır eklenir (Örn: `1 × Çift Kişilik`,
  `1 × Tek Kişilik`). Katalog: Çift Kişilik (2), Tek Kişilik (1), Ranza (2),
  Çekyat (2), İlave Yatak (1), Bebek Karyolası (0 — kapasiteye sayılmaz).
* **Yatak kapasitesi** otomatik hesaplanır: `Σ (yatak adedi × yatağın kişi sayısı)`.
* **Maksimum konaklayabilecek kişi sayısı** açılır menüden seçilir. Menü yalnızca
  `1 … yatak kapasitesi` aralığını sunar; kapasite üstü bir değer seçilemez ve
  kaydedilemez. Yatak eklenip çıkarıldığında menü ve seçili değer anında güncellenir.

**Finansal etkisi**

* Rezervasyon girilirken **"Konaklayan Kişi Sayısı"** bu kapasiteyi aşamaz; rezervasyon
  formundaki kişi sayısı menüsü seçili odanın `maxOccupancy` değerine göre kurulur ve
  kural ayrıca kayıt anında doğrulanır (arayüz atlatılsa bile veri katmanı reddeder).
* Girilen net kişi sayısı, **Kişi Başı Maliyet (Cost Per Guest)** algoritmasını
  tetikler: o rezervasyonun her gecesi için kahvaltı, su ve diğer sarf malzemesi
  giderleri `kişi × gece` tabanında hesaplanıp **ilgili odaya** yazılır (§5.2).

#### 4.7.3 Demirbaş ve Özellik Listesi (Check-box Modülü)

* Odanın içindeki cihaz ve donanımlar **çoklu seçim (checkbox)** ile işaretlenir.
  Liste gruplandırılmıştır: *Isıtma & Soğutma*, *Islak Hacim*, *Mutfak & Minibar*,
  *Elektronik*, *Konfor & Manzara*.
* **Arayüz beklentisi:** 101'e tıklandığında açılan panelde donanımlar işaretlenir —
  `[x] Jakuzi`, `[x] Şömine`, `[x] Klima`, `[ ] Minibar`, `[x] Smart TV`,
  `[x] Espresso Makinesi` … Her satırın sağında o donanımın tüketim katsayısı rozet
  olarak görünür (`⚡ +%45`, `💧 +%60`, `🔥 +%15`).

**Finansal etkisi — 1. Maliyet Çarpanı**

Jakuzi, klima, sauna gibi yüksek tüketimli donanımlara sahip odalar genel elektrik/su/
ısıtma giderlerinden daha yüksek pay alır. Odanın bir gider türü için demirbaş yükü:

```
demirbaşYükü(oda, tür) = 1 + Σ seçili demirbaşların katsayısı[tür]
```

Örnek: Jakuzi (+0,45) + Klima (+0,35) + Smart TV (+0,08) + Espresso (+0,10) seçili bir
odanın elektrik yükü **×1,98**'dir; demirbaşsız bir oda ×1,00 kalır.

**Finansal etkisi — 2. Direkt Gider Ataması**

* Gider eklerken dağıtım yöntemi `Doğrudan Odaya` seçildiğinde, oda seçimi ardından
  **demirbaş listesi yalnızca o odanın kartında işaretli, servis edilebilir
  donanımlarla** dolar. Böylece "Jakuzi motor arızası" gideri iki tıkla 101'e yazılır.
* Oda kartının sağ sütunundaki **demirbaş çipleri** kısayoldur: çipe tıklamak, oda ve
  demirbaş alanları önceden doldurulmuş bir gider formu açar.
* Doğrulama: bir gider, o odanın kartında işaretli olmayan bir demirbaşa yazılamaz.

#### 4.7.4 Canlı Maliyet Etkisi Paneli

Oda kartının sağ sütununda, kaydetmeden önce seçimlerin sonucu canlı gösterilir:
gider türü başına toplam ağırlık (`büyüklük × demirbaş yükü`), maksimum kapasite,
**tam dolulukta günlük kişi başı sarfiyat** ve gecelik liste fiyatı.

#### 4.7.5 Kabul Kriterleri

| # | Kriter | Doğrulayan test |
| --- | --- | --- |
| K1 | Oda numara + konsept ismiyle etiketlenir | `oda kartı: numara ve konsept ismi birlikte etiketlenir` |
| K2 | Yatak yapılandırması kapasiteyi üretir; bebek karyolası sayılmaz | `yatak yapılandırması kapasiteyi belirler`, `bebek karyolası kapasiteye sayılmaz` |
| K3 | Maks. kişi sayısı yatak kapasitesini aşamaz | `maksimum kişi sayısı yatak kapasitesini aşamaz` |
| K4 | Oda numarası tekrar edemez | `aynı oda numarası iki kez tanımlanamaz` |
| K5 | Rezervasyondaki kişi sayısı kapasiteyi aşamaz | `rezervasyondaki kişi sayısı oda kapasitesini aşamaz`, `kapasiteyi aşan rezervasyon store seviyesinde reddedilir` |
| K6 | Demirbaş katsayısı `1 + Σ` olarak hesaplanır | `demirbaş katsayısı: 1 + seçili demirbaşların yükü` |
| K7 | Jakuzili oda genel giderden fazla pay alır | `genel gider demirbaş katsayısına göre dağıtılır (jakuzili oda daha çok pay alır)` |
| K8 | Doğrudan gider %100 ilgili odaya yazılır | `doğrudan gider tamamıyla ilgili odaya yazılır` |
| K9 | Gider, odada olmayan demirbaşa yazılamaz | `doğrudan gider odada olmayan demirbaşa yazılamaz` |
| K10 | Kişi başı sarfiyat kişi-gece oranına göre dağıtılır | `kişi başı gider, kişi-gece oranına göre paylaştırılır` |
| K11 | Checkbox seçimi katsayıyı canlı günceller | Tarayıcı akışı: `Demirbaş checkbox işaretlenince katsayı canlı güncellenir` |
| K12 | Demirbaş çipi, ön-doldurulmuş gider formu açar | Tarayıcı akışı: `Oda kartından demirbaşa doğrudan gider yazılır` |

---

## 5. Hesaplama Kuralları

Tüm hesaplar bir **dönem** (varsayılan: seçili ay) için yapılır. Gece aralıkları
yarı açıktır: `[giriş, çıkış)`.

### 5.1 Gelir

```
odaGeliri = Σ rezervasyonlar ( toplamTutar × dönemİçiGece / toplamGece )
```

Dönemi aşan konaklamalarda gelir gecelere eşit yayılır, yalnızca döneme düşen kısım sayılır.
İptal edilen rezervasyonlar gelir ve sarfiyat üretmez.

### 5.2 Kişi Başı Maliyet (Cost Per Guest)

Ayarlardaki tarife kalemleri her rezervasyon için otomatik maliyet üretir:

| Hesap tabanı | Birim | Tipik kalem |
| --- | --- | --- |
| `guestNight` | kişi × dönem içi gece | Kahvaltı, su, buklet |
| `guestStay` | kişi × konaklama | Nevresim seti |
| `stay` | konaklama başına | Çıkış temizliği |

`requiresBreakfast` işaretli kalemler yalnızca "kahvaltı dahil" rezervasyonlarda işler.
`guestStay` ve `stay` tabanlı kalemler, rezervasyonun **giriş tarihi** döneme düştüğünde
bir kez yazılır.

Ayrıca `perGuest` yöntemiyle girilen toplu giderler (ör. aylık market alışverişi) odalara
kişi-gece oranıyla paylaştırılır:

```
odaPayı = tutar × odaKişiGece / toplamKişiGece
```

### 5.3 Genel Gider Dağıtımı (Maliyet Çarpanı)

```
ağırlık(oda, tür) = büyüklükKatsayısı
                  × (1 + Σ demirbaşKatsayısı[tür])
                  × ( sabitPay + (1 − sabitPay) × dolulukOranı )

odaPayı = tutar × ağırlık(oda) / Σ ağırlık(tüm odalar)
```

* `sabitPay` (varsayılan **0,25**) boş odaların da üstlendiği payı temsil eder:
  0 → gider yalnızca dolu odalara yansır; 1 → doluluk yok sayılır, yalnızca demirbaş
  katsayısı belirleyicidir.
* `dolulukOranı = odaGecesi / dönemGünSayısı`.
* **Pasif** odalar dağıtıma girmez. Hiçbir odanın ağırlığı üretilemezse gider satıştaki
  odalara eşit paylaştırılır.

### 5.4 Yuvarlama

Dağıtım kuruş hassasiyetinde yapılır; yuvarlama artıkları en büyük kesirli paya eklenir.
**Parçaların toplamı her zaman dağıtılan tutara eşittir** (`splitByWeights`).

### 5.5 Örnek Senaryo (birim testlerle birebir)

İki oda, Ocak dönemi, `sabitPay = 1` (doluluk etkisi kapalı):

| | 101 King Suite | 102 Standart |
| --- | --- | --- |
| Demirbaş | Jakuzi | — |
| Elektrik yükü | ×1,45 | ×1,00 |
| Konaklama | 2 kişi × 3 gece = 6 kişi-gece | 1 kişi × 2 gece = 2 kişi-gece |
| Gelir | 15.000 ₺ | 6.000 ₺ |

Giderler: 2.450 ₺ elektrik (`weighted`), 800 ₺ sarf (`perGuest`), 5.000 ₺ jakuzi motor
arızası (`direct` → 101), 1.000 ₺ komisyon (`general`). Tarife: kahvaltı 100 ₺/kişi-gece
(102 kahvaltısız).

| Kalem | 101 | 102 |
| --- | --- | --- |
| Doğrudan | 5.000,00 | 0,00 |
| Kişi başı (gider) | 600,00 | 200,00 |
| Kişi başı (tarife) | 600,00 | 0,00 |
| Elektrik (katsayılı) | 1.450,00 | 1.000,00 |
| **Toplam gider** | **7.650,00** | **1.200,00** |
| **Kâr** | **7.350,00** | **4.800,00** |
| Kişi başı maliyet | 1.275,00 | 600,00 |

Komisyon (1.000 ₺) odalara dağıtılmaz; net kâr hesabında işletme geneli olarak düşülür.

---

## 6. Doğrulama Kuralları

**Oda:** numara zorunlu ve tekil · en az bir yatak · maks. kişi sayısı 1…yatak kapasitesi ·
büyüklük katsayısı > 0 · liste fiyatı ≥ 0.

**Rezervasyon:** oda ve misafir adı zorunlu · geçerli tarihler, çıkış > giriş ·
kişi sayısı ≥ 1 ve ≤ oda kapasitesi · satışta olmayan odaya rezervasyon yok ·
aynı odada tarih çakışması yok (çıkış günü aynı gün girişe açıktır) · tutar ≥ 0.

**Gider:** geçerli tarih · açıklama zorunlu · tutar > 0 · `direct` için oda zorunlu ·
demirbaş seçilecekse odanın kartında işaretli olmalı · `weighted` için gider türü zorunlu.

**Ayarlar:** sabit pay 0…1 · tarife kalemi adı boş olamaz, tutar ≥ 0.

Oda silindiğinde: rezervasyonları silinir, doğrudan giderleri işletme geneline düşer
(veri kaybı olmaz).

---

## 7. Teknik Mimari

```
index.html            → uygulama girişi (ESM, derleme adımı yok)
src/core/             → tarayıcıdan ve Node testlerinden aynen kullanılan saf mantık
  catalog.js          → yatak tipleri, demirbaş kataloğu + katsayılar, gider kategorileri
  model.js            → fabrikalar, kapasite/katsayı hesapları, doğrulama kuralları
  costEngine.js       → dağıtım motoru ve dönem raporu
  dates.js            → gece/dönem aritmetiği
  store.js            → localStorage tabanlı durum yönetimi (abonelikli)
  seed.js             → demo veri seti
src/ui/               → bağımlılıksız DOM görünümleri
  roomCard.js         → §4.7 Oda Kartı paneli
test/                 → node:test birim testleri
```

Bağımlılık yoktur; `npm start` statik sunucuyu, `npm test` birim testlerini çalıştırır.
Veriler tarayıcıda `localStorage` üzerinde `gelir-gider:v1` anahtarında tutulur.

## 8. Yol Haritası

1. Çok kullanıcılı sunucu tarafı (API + veritabanı) ve rol bazlı yetki.
2. Kanal yöneticisi ve takvim (ICS) senkronizasyonu.
3. KDV/fatura ayrıştırması, dönem kapanışı ve kilit.
4. Sayaç okumalarıyla (elektrik/su) gerçek tüketim kalibrasyonu — katsayıların
   tahminden ölçüme geçmesi.
