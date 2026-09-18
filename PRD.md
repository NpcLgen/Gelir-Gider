# Ürün Gereksinimleri Belgesi (PRD) — 9 Odalı Butik Otel
## Gelir-Gider ve Kârlılık Yönetim Sistemi

**Sürüm:** 1.0 · **Durum:** Uygulandı — bu depodaki kod bu belgeyi karşılar.
**Doğrulama:** 62 birim testi (`npm test`) + 28 adımlı tarayıcı akış testi (`npm run test:browser`).

---

## Proje Vizyonu ve Kapsamı

Bu belge, 9 odalı bir butik otelin operasyonel süreçlerinden ziyade, tamamen finansal
verimliliğine, oda bazlı maliyetlerine ve genel kârlılığına odaklanan yazılımın temel
özelliklerini tanımlar. Bu sistem bir otel yönetim sistemi (PMS) veya ön büro programı
değil; işletmenin gelir-gider dengesini şeffaflaştıran, maliyetleri dağıtan ve net
kârlılığı hesaplayan özel bir **finansal zekâ (BI)** aracıdır.

> **Rezervasyon modülü hakkında not:** Sistem ön büro işlevi üstlenmez; rezervasyon
> kaydı yalnızca *gerçekleşen geliri* ve *kişi-gece* sayısını üretmek için tutulur —
> kişi başı maliyet algoritmasının (§8.4) tek doğru girdisi budur.

**Durum etiketleri:** ✅ uygulandı · 🔜 Faz 2/3.

---

## 1. Temel Arayüz ve Gelir-Gider Modülleri

### 1.1. Odalar ve Fiyatlandırma Modülü (Gelir Projeksiyonu) ✅

Otelin günlük fiyat stratejisinin ve beklenen/gerçekleşen gelirlerinin yönetildiği ana merkez.
*Uygulama: `src/ui/calendarView.js`, `store.bulkPrice` / `store.copyPrices`.*

* **Takvim Görünümlü Fiyat Girişi:** Odalar × günler ızgarası; her hücre tıklanarak o
  gecenin fiyatı girilir. Fiyat `prices[odaId][tarih]` olarak saklanır.
* **Çoklu Para Birimi (Çift Kur Desteği):** Fiyatlar TL veya EUR girilebilir; raporlama
  anında §2.4'teki kurla çevrilir. Sağ üstteki `[₺ TRY] / [€ EUR]` anahtarı tüm ekranı
  anında diğer para birimine döndürür.
* **Toplu Fiyat Güncelleme (Bulk Edit):** Tarih aralığı + oda seçimiyle tek tıkta fiyat
  atama. **Hafta içi** (Pazar–Perşembe) ve **hafta sonu** (Cuma–Cumartesi) için ayrı
  tutar girilebilir; "dolu günleri de güncelle" seçeneği kapatılırsa yalnızca boş günler
  doldurulur.
* **Fiyatları Kopyala:** `Geçen Haftayı Kopyala` / `Geçen Ayı Kopyala` — kaynak aralıktaki
  fiyatlar gün gün hedefe yazılır, mevcut fiyatlar korunur.
* **Boş Günleri Vurgula:** Fiyat girilmemiş günleri kırmızı çerçeveyle belirginleştirir.
* **Renk kodlaması:** yeşil = fiyat girilmiş, kırmızı = eksik gün, mavi nokta = dolu oda.
* **Göstergeler:** Takvim hedef geliri (tam doluluk), gerçekleşen gelir, gerçekleşme oranı
  ve fiyat girilme oranı.

### 1.2. Gider Yönetimi Modülü ✅

*Uygulama: `src/ui/expensesView.js`.*

* **Hızlı Gider Ekleme Paneli:** Ekranın sağ alt köşesinde sabit duran `+` (FAB) butonu;
  `[+ Gider Ekle]` ve `[+ Hızlı Fiyat Gir]` seçeneklerini açar. Modal alanları:
  gider ismi, tutar, para birimi, tarih, kategori, tedarikçi, dağıtım yöntemi.
* **Aktif/Pasif Gider Yönetimi:** Her satırın solundaki toggle switch. Pasife alınan
  gider **silinmez**, yalnızca kârlılık hesabından anında düşer (senaryo testi için).
* **Oda Spesifik Gider Ataması:** Gider "İşletme Geneli" veya "Spesifik Oda Gideri"
  olarak ayrılır.
  * *Örnek senaryo:* 101 numaralı odada jakuzi bulunduğu için bu odanın maliyet çarpanı
    yüksek girilir (§8.1 Seçenek C) **veya** doğrudan odaya "Jakuzi Bakım/Onarım
    Maliyeti" yazılır (§8.3).

---

## 2. Finansal Zekâ ve Maliyet Analiz Özellikleri

### 2.1. Dinamik Maliyet Dağıtım Algoritması (Cost Allocation) ✅

*Uygulama: `src/core/costEngine.js`.*

Sistem giderleri beş yöntemden biriyle dağıtır:

| Yöntem | Kullanım | Dağıtım tabanı |
| --- | --- | --- |
| `direct` | Odaya özel bakım/onarım/demirbaş, zayi | %100 seçili oda |
| `perGuest` | Kahvaltı, sarf malzeme, çamaşırhane | Kişi-gece oranı |
| `weighted` | Elektrik, su, doğalgaz | §8.1'deki yöntem (A/B/C) |
| `equal` | Personel, kira, muhasebe | Satıştaki odalara eşit |
| `general` | Komisyon, vergi, pazarlama | Dağıtılmaz, işletme geneli |

**Ağırlık formülü (genel giderler):**

```
ağırlık(oda, tür) = yöntemAğırlığı(oda, tür) × ( sabitPay + (1 − sabitPay) × dolulukOranı )

yöntemAğırlığı =  A → 1
                  B → oda m²
                  C → maliyetÇarpanı × (1 + Σ demirbaş katsayıları[tür])

odaPayı = tutar × ağırlık(oda) / Σ ağırlık(tüm odalar)
```

* `sabitPay` (varsayılan **0,25**) boş odaların da üstlendiği payı temsil eder.
* **Pasif** odalar dağıtıma girmez; hiçbir ağırlık üretilemezse gider satıştaki odalara
  eşit paylaştırılır.
* Dağıtım kuruş hassasiyetindedir; yuvarlama artıkları en büyük kesirli paya eklenir —
  **parçaların toplamı her zaman dağıtılan tutara eşittir** (`splitByWeights`).

**Sonuç çıktısı:** "Oda 1 bu ay ne kadar brüt gelir getirdi, ne kadar genel/spesifik
masraf çıkardı, net kârı nedir?" sorusunun oda bazlı net cevabı (Dashboard tablosu).

### 2.2. Kategorize Edilmiş Gider Yapısı ✅

Her kategori bir ana gruba bağlıdır; raporlama ve filtreleme bu gruplar üzerinden yapılır:

| Grup | Kapsam |
| --- | --- |
| **Sabit Giderler** | Kira, maaşlar, muhasebe, sigorta, internet/yazılım aboneliği |
| **Değişken Giderler** | Elektrik, su, doğalgaz, çamaşırhane |
| **Operasyonel / Oda Giderleri** | Buklet, temizlik ürünleri, bakım-onarım, demirbaş, zayi |
| **Pazarlama & Komisyon** | Acenta (Booking, Airbnb) komisyonları, reklam |

Acenta komisyonu ayrıca rezervasyon bazında oran olarak girilir ve **net gelirden düşülür**.

### 2.3. Tekrarlayan Giderler (Abonelikler) Modülü ✅

İnternet, yazılım abonelikleri, kira veya personel maaşları "her ayın X gününde gider
tabloma otomatik yansıt" şeklinde işaretlenir. Motor, dönem raporunu üretirken bu
kalemleri o döneme ait gerçek gider kalemleri olarak üretir (`expandExpenses`);
başlangıç tarihinden önce ve bitiş tarihinden sonra yansımaz. Gider satırındaki 🔁
ikonu tekil bir gideri tekrarlayana çevirir.

### 2.4. Otomatik Kur Entegrasyonu (TCMB veya Canlı API) ✅ / 🔜

*Uygulama: `src/core/fx.js`.*

* Tutarlar **girildikleri para biriminde** saklanır; rapor anında TL'ye çevrilir.
* Kur **tarih bazlı geçmişle** tutulur (`fx.history`): geçmiş bir dönem raporlanırken o
  tarihe ait (veya en yakın önceki) kur kullanılır — gerçek kâr/zarar korunur.
* Kur kaynağı: `TCMB Efektif Satış`, `TCMB Döviz Alış` veya `Sabit Kur (manuel)`.
  Ayarlardaki **"TCMB'den Kuru Çek"** butonu `today.xml` servisini okur.
* 🔜 **Bilinen sınır:** TCMB servisi tarayıcıya CORS başlığı göndermez; doğrudan çekim
  engellenirse sistem sessizce **manuel kura** düşer ve kullanıcıyı bilgilendirir.
  Kesintisiz otomatik kur için sunucu tarafı proxy Faz 2 kapsamındadır.

---

## 3. Gelişmiş Finansal Metrikler ve Dashboard ✅

*Uygulama: `src/ui/dashboardView.js`, `src/ui/charts.js`.*

### 3.1. Temel Kârlılık ve Gelir Göstergeleri

| Gösterge | Tanım |
| --- | --- |
| **Aylık Kâr/Zarar** | Gelir − dağıtılan gider − işletme geneli gider; marj yüzdesiyle |
| **ADR** | Ortalama günlük satılan oda fiyatı = gelir / satılan oda-gecesi |
| **RevPAR** | Toplam envanter üzerinden oda başı gerçek gelir = gelir / satılabilir oda-gecesi |
| **Doluluk** | Satılan oda-gecesi / satılabilir oda-gecesi |
| **Kişi Başı Maliyet** | Dağıtılan gider / kişi-gece |

**Gider Dağılım Grafiği (pasta/halka):** Toplam masrafın gruplara dağılımı. Grafik,
erişilebilirlik gereği renk-tek-başına bilgi taşımaz: her dilim açıklama listesinde
tutar ve yüzdeyle etiketlenir, altında kategori kırılım tablosu bulunur. Palet
körlük (CVD) ayrımı, kontrast ve açıklık bantları için doğrulanmıştır.

### 3.2. İleri Düzey Finansal Analizler

* **Başa Baş Noktası (Break-Even) Hesaplayıcı:**
  ```
  katkıPayı/gece   = ADR − (değişken+operasyonel+pazarlama giderleri / satılan gece)
  gerekenGece      = sabit giderler / katkıPayı
  gerekenDoluluk   = gerekenGece / satılabilir oda-gecesi
  gerekenMin. ADR  = (sabit + değişken giderler) / satılan gece
  ```
* **Yıllık Karşılaştırma (YOY):** Seçilen dönem, bir önceki yılın aynı dönemiyle gelir,
  gider, net kâr, doluluk, ADR ve RevPAR bazında karşılaştırılır; değişim yön oku ve
  yüzdeyle gösterilir.
* **Zayi (Fire) ve Amortisman Takibi:** `Zayi / Amortisman` kategorisi kırılan bardak,
  lekelenen havlu, arızalanan eşya gibi kalemleri maliyet olarak işler; hem odaya yazılır
  hem de raporda ayrı toplanır.

---

## 4. UI / UX Mimarisi ✅

* **Sol Menü (Sidebar):** Dashboard · Fiyat/Gelir Takvimi · Gider Yönetimi ·
  Rezervasyonlar · Oda Ayarları · Finansal Raporlar · Sistem Ayarları.
* **Üst Şerit:** ay gezinme (‹ ›), hızlı tarih filtreleri, özel aralık seçici, güncel kur
  ve `[₺ TRY] / [€ EUR]` anahtarı.
* **Hızlı Ekle (FAB):** Sağ alt köşede sabit `+` butonu; üzerine gelindiğinde
  `[+ Gider Ekle]` ve `[+ Hızlı Fiyat Gir]`.
* **Renk Kodlaması:** Takvimde fiyat girilmemiş günler kırmızı, girilenler yeşil.
  Dashboard'da gerçekleşen marj hedefin altındaysa kırmızı, üstündeyse yeşil (§8.2).
* Arayüz ön büro karmaşasından uzak, yalnızca finansal veriye odaklıdır.

---

## 5. Teknik Altyapı ve Gelecek Fazlar

* **Mevcut mimari:** Bağımlılıksız ES modülleri; saf hesap katmanı (`src/core/`) tarayıcı
  ve Node testleri tarafından aynen kullanılır. Kalıcılık tarayıcıda `localStorage`
  (`gelir-gider:v1`), yedekleme JSON dışa/içe aktarımıyla yapılır.
* 🔜 **Veritabanı Yapısı:** Odalar, Gelirler (fiyat takvimi + rezervasyon), Giderler ve
  Kategoriler tabloları finansal tutarlılık (ACID) gözetilerek ilişkisel veritabanına
  taşınacaktır. Mevcut veri modeli bu geçişe hazır normalize edilmiştir.
* 🔜 **Faz 2 — Kanal Yöneticisi Entegrasyonu:** Booking/Airbnb'den kesin gelir ve kesilen
  komisyonun otomatik yansıması için API altyapısı (komisyon oranı alanı şimdiden mevcut).
* ✅/🔜 **Faz 3 — Muhasebe Dışa Aktarımı:** Veriler tek tıkla **Excel**, **CSV** ve
  **PDF** (yazdır → PDF) olarak dışa aktarılabilir; doğrudan mali müşavir entegrasyonu
  Faz 3'tedir.

---

## 6. Fonksiyon Tuşları (Action Buttons & Controls) ✅

### 6.1. Genel / Ortak
* **Döviz Görünüm Modu:** Sağ üstte sabit `[₺ TRY] / [€ EUR]` anahtarı; tüm dashboard,
  gelir ve gider tabloları anında dönüşür.
* **Hızlı Ekle Floating Butonu (FAB):** Sağ alt köşe; `[+ Gider Ekle]`, `[+ Hızlı Fiyat Gir]`.
* **Dışa Aktar:** Raporlar sayfasında `[PDF İndir]` `[Excel'e Aktar]` `[CSV Kaydet]`.

### 6.2. Takvim ve Fiyatlandırma
* **Toplu Güncelle:** Tarih aralığı + hafta içi/hafta sonu fiyat kutucukları + `[Uygula]`.
* **Fiyatları Kopyala:** `[Geçen Haftayı Kopyala]` / `[Geçen Ayı Kopyala]`.
* **Boş Günleri Vurgula:** Eksik günleri kırmızı çerçeveyle işaretler.

### 6.3. Gider Yönetimi
* **Aktif/Pasif Anahtarı:** Her satırın solunda; yeşil (aktif) → gri (pasif).
* **Dekont/Fiş Ekle:** 📎 ikonu; PDF/JPEG yükler (maks. 3 MB), satırdan indirilebilir.
* **Tekrarla (Make Recurring):** 🔁 ikonu; "her ayın X gününde" otomatik yansıtma.

---

## 7. Dinamik Filtreleme Seçenekleri ✅

### 7.1. Zaman ve Tarih
`[Bu Ay]` `[Geçen Ay]` `[Bu Çeyrek]` `[YTD]` `[Geçen Yılın Aynı Ayı]` hızlı butonları,
ay ileri/geri gezinme ve **Özel Tarih Aralığı** (ör. yalnızca bayram haftası).

### 7.2. Gider ve Maliyet
Ana gruplara göre çoklu seçim filtreleri (Sabit / Değişken / Operasyonel / Pazarlama),
açıklama-tedarikçi araması, "sadece tekrarlayanlar" ve "pasifleri göster" anahtarları.

---

## 8. Sistem ve Modül Ayarları ✅

Tek kullanıcılı, rolsüz yapıya göre optimize edilmiştir. *Uygulama: `src/ui/settingsView.js`.*

### 8.1. Maliyet Dağıtım Algoritması Ayarları

| Seçenek | Tanım |
| --- | --- |
| **A · Eşit** | Toplam genel gider / oda sayısı |
| **B · Metrekare Bazlı** | Odaların m² büyüklükleri oranında ağırlıklı dağıtım |
| **C · Özel Katsayı** | Odaya atanan maliyet çarpanı × demirbaş katsayıları (varsayılan) |

Ek parametre: **boş odaların sabit pay oranı** (0 = gider yalnızca dolu odalara yansır,
1 = doluluk dikkate alınmaz).

### 8.2. Finansal Hedef ve Alarm Ayarları

* **Minimum Kârlılık Hedefi:** Aylık hedeflenen net kâr marjı (varsayılan %35).
  Dashboard'da gerçekleşen marj hedefin altındaysa kırmızı, üstündeyse yeşil vurgulanır.
* **Kur Çekim Ayarı:** `TCMB Efektif Satış` / `TCMB Döviz Alış` / `Sabit Kur Gir`.
* **Görüntüleme Para Birimi:** Raporların varsayılan para birimi.

### 8.3. Kategori ve Oda Ayarları

* **Kategori Yöneticisi:** Varsayılan kategorilere ek alt kategoriler yaratma, renk kodu
  atama, arşivleme ve silme.
* **Oda Profili Yönetimi:** 9 odanın isim/numara, durum ve maliyete etki eden
  özellik/demirbaşlarının yönetimi → ayrıntılı tanım **§8.4**.

---

### 8.4. Gelişmiş Oda Profili ve Envanter Kartları (Kişi Bazlı Maliyet Altyapısı) ✅

Sistemin kârlılığı, oda spesifik masrafları ve kişi bazlı sarfiyatları doğru
hesaplayabilmesi için her odanın detaylı bir **"Oda Kartı"** mantığıyla yönetildiği
yapılandırma modülüdür. Odalar ızgarasında bir odaya tıklandığında açılan panelde
aşağıdaki parametreler yapılandırılır.

> **Uygulama:** `src/ui/roomCard.js` (arayüz), `src/core/model.js` (kural ve doğrulama),
> `src/core/catalog.js` (yatak ve demirbaş katalogları).

#### 8.4.1 Oda İsimlendirme ve Tanımlama

* Odalara özel **numara** ve **konsept ismi** atanabilir (Örn: `101 - King Suite`,
  `102 - Bahçe Manzaralı Standart`).
* Ek alanlar: kat, durum (Satışta / Bakımda / Pasif), gecelik liste fiyatı,
  **oda büyüklüğü (m²)** — Seçenek B için —, **maliyet çarpanı** — Seçenek C için — ve not.
* Oda numarası zorunludur ve tekrar edemez. Etiketleme: `numara - konsept ismi`.

#### 8.4.2 Kapasite ve Yatak Yapılandırması

* Odadaki **yatak tipi ve sayısı** satır satır eklenir (Örn: `1 × Çift Kişilik`,
  `1 × Tek Kişilik`). Katalog: Çift Kişilik (2), Tek Kişilik (1), Ranza (2), Çekyat (2),
  İlave Yatak (1), Bebek Karyolası (0 — kapasiteye sayılmaz).
* **Yatak kapasitesi** otomatik hesaplanır: `Σ (yatak adedi × yatağın kişi sayısı)`.
* **Maksimum konaklayabilecek kişi sayısı** açılır menüden seçilir. Menü yalnızca
  `1 … yatak kapasitesi` aralığını sunar; kapasite üstü değer seçilemez ve kaydedilemez.

**Finansal etkisi**

* Rezervasyon girilirken **"Konaklayan Kişi Sayısı"** bu kapasiteyi aşamaz. Rezervasyon
  formundaki menü odanın `maxOccupancy` değerine göre kurulur; kural ayrıca kayıt anında
  doğrulanır (arayüz atlatılsa bile veri katmanı reddeder).
* Girilen net kişi sayısı **Kişi Başı Maliyet (Cost Per Guest)** algoritmasını tetikler:
  o rezervasyonun her gecesi için kahvaltı, su ve diğer sarf malzemesi giderleri
  `kişi × gece` tabanında hesaplanıp **ilgili odaya** yazılır.

**Kişi başı sarfiyat tarifesi** (Ayarlar → hesap tabanları):

| Hesap tabanı | Birim | Tipik kalem |
| --- | --- | --- |
| `guestNight` | kişi × dönem içi gece | Kahvaltı, su, buklet |
| `guestStay` | kişi × konaklama | Nevresim seti |
| `stay` | konaklama başına | Çıkış temizliği |

`requiresBreakfast` işaretli kalemler yalnızca "kahvaltı dahil" rezervasyonlarda işler.

#### 8.4.3 Demirbaş ve Özellik Listesi (Check-box Modülü)

* Odadaki cihaz ve donanımlar **çoklu seçim (checkbox)** ile işaretlenir; liste
  gruplandırılmıştır: *Isıtma & Soğutma*, *Islak Hacim*, *Mutfak & Minibar*,
  *Elektronik*, *Konfor & Manzara*.
* **Arayüz beklentisi:** 101'e tıklandığında açılan panelde donanımlar işaretlenir —
  `[x] Jakuzi`, `[x] Şömine`, `[x] Klima`, `[ ] Minibar`, `[x] Smart TV`,
  `[x] Espresso Makinesi` … Her satırın sağında tüketim katsayısı rozet olarak görünür
  (`⚡ +%45`, `💧 +%60`, `🔥 +%15`).

**Finansal etkisi — 1. Maliyet Çarpanı**

Jakuzi, klima, sauna gibi yüksek tüketimli donanımlara sahip odalar genel elektrik/su/
ısıtma giderlerinden daha yüksek pay alır:

```
demirbaşYükü(oda, tür) = 1 + Σ seçili demirbaşların katsayısı[tür]
```

Örnek: Jakuzi (+0,45) + Klima (+0,35) + Smart TV (+0,08) + Espresso (+0,10) seçili bir
odanın elektrik yükü **×1,98**; demirbaşsız oda ×1,00 kalır. Bu yük, §8.1 Seçenek C'de
odanın maliyet çarpanıyla çarpılarak dağıtım ağırlığını verir.

**Finansal etkisi — 2. Direkt Gider Ataması**

* Gider eklerken dağıtım `Doğrudan Odaya` seçildiğinde, oda seçiminin ardından demirbaş
  listesi **yalnızca o odanın kartında işaretli, servis edilebilir donanımlarla** dolar.
  "Jakuzi motor arızası" gideri böylece iki tıkla 101'e yazılır.
* Oda kartının sağ sütunundaki **demirbaş çipleri** kısayoldur: çipe tıklamak, oda ve
  demirbaş alanları önceden doldurulmuş bir gider formu açar.
* Doğrulama: bir gider, o odanın kartında işaretli olmayan bir demirbaşa yazılamaz.

#### 8.4.4 Canlı Maliyet Etkisi Paneli

Oda kartının sağ sütununda seçimlerin sonucu kaydetmeden önce canlı gösterilir: aktif
dağıtım yöntemi, gider türü başına ağırlık, maksimum kapasite, **tam dolulukta günlük
kişi başı sarfiyat** ve gecelik liste fiyatı.

#### 8.4.5 Kabul Kriterleri ve Test Eşlemesi

| # | Kriter | Doğrulayan test |
| --- | --- | --- |
| K1 | Oda numara + konsept ismiyle etiketlenir | `oda kartı: numara ve konsept ismi birlikte etiketlenir` |
| K2 | Yatak yapılandırması kapasiteyi üretir; bebek karyolası sayılmaz | `yatak yapılandırması kapasiteyi belirler`, `bebek karyolası kapasiteye sayılmaz` |
| K3 | Maks. kişi sayısı yatak kapasitesini aşamaz | `maksimum kişi sayısı yatak kapasitesini aşamaz` |
| K4 | Oda numarası tekrar edemez | `aynı oda numarası iki kez tanımlanamaz` |
| K5 | Rezervasyon kişi sayısı kapasiteyi aşamaz | `rezervasyondaki kişi sayısı oda kapasitesini aşamaz`, `kapasiteyi aşan rezervasyon store seviyesinde reddedilir` |
| K6 | Demirbaş katsayısı `1 + Σ` olarak hesaplanır | `demirbaş katsayısı: 1 + seçili demirbaşların yükü` |
| K7 | Jakuzili oda genel giderden fazla pay alır | `Seçenek C — özel katsayı × demirbaş yükü` |
| K8 | Doğrudan gider %100 ilgili odaya yazılır | `doğrudan gider tamamıyla ilgili odaya yazılır` |
| K9 | Gider, odada olmayan demirbaşa yazılamaz | `doğrudan gider odada olmayan demirbaşa yazılamaz` |
| K10 | Kişi başı sarfiyat kişi-gece oranına göre dağıtılır | `kişi başı gider, kişi-gece oranına göre paylaştırılır` |
| K11 | Checkbox seçimi katsayıyı canlı günceller | Tarayıcı: `Demirbaş checkbox katsayıyı canlı günceller` |
| K12 | Demirbaş çipi ön-doldurulmuş gider formu açar | Tarayıcı: `Oda kartından demirbaşa doğrudan gider yazılır` |

---

## 9. Sistem Geneli Kabul Kriterleri

| # | Kriter | Doğrulayan test |
| --- | --- | --- |
| S1 | Pasif gider hesaptan düşer, kayıt silinmez | `pasif gider hesaplamadan düşer, kayıt silinmez` |
| S2 | Dağıtım Seçenek A / B / C doğru çalışır | `Seçenek A — eşit dağıtım`, `Seçenek B — metrekare bazlı dağıtım`, `Seçenek C — özel katsayı × demirbaş yükü` |
| S3 | Tekrarlayan gider her ay yansır, sınırlara uyar | `tekrarlayan gider her ayın belirtilen gününde yansır`, `…başlangıç tarihinden önce ve bitişten sonra yansımaz` |
| S4 | EUR kalemler tarihine ait kurla çevrilir | `EUR gider, tarihine ait kurla TL'ye çevrilir`, `EUR rezervasyon geliri giriş tarihinin kuruyla hesaplanır` |
| S5 | Acenta komisyonu net gelirden düşülür | `acenta komisyonu net gelirden düşülür` |
| S6 | Takvim fiyatları projeksiyon ve eksik gün üretir | `takvim fiyatları beklenen geliri ve eksik gün sayısını üretir` |
| S7 | Toplu güncelleme hafta içi/hafta sonu ayırır | `fiyat takvimi: toplu güncelleme hafta içi/hafta sonu ayrımı yapar` |
| S8 | Kopyalama dolu günleri korur | `fiyat takvimi: kopyalama dolu günlerin üstüne yazmaz` |
| S9 | ADR / RevPAR / doluluk envanter üzerinden hesaplanır | `ADR, RevPAR ve doluluk envanter üzerinden hesaplanır` |
| S10 | Başa baş noktası doğru hesaplanır | `başa baş noktası sabit gideri katkı payına böler` |
| S11 | Hedef marj karşılaştırması rapora işlenir | `hedef marj karşılaştırması rapora işlenir` |
| S12 | YOY karşılaştırması oran üretir | `YOY karşılaştırması iki dönemin farkını oranlar` |
| S13 | Zayi/amortisman ayrı raporlanır | `zayi/amortisman ayrı raporlanır ve odaya yazılır` |
| S14 | Hızlı tarih filtreleri doğru dönem üretir | `hızlı tarih aralıkları doğru dönem üretir` |
| S15 | Dağıtım toplamı gider toplamına eşittir | `dağıtılan tutarların toplamı dönem giderlerine eşittir`, `demo verisi 9 oda ile tutarlıdır ve rapor üretir` |
| S16 | Dışa aktarım CSV/Excel dosyası üretir | Tarayıcı: `Raporlar sayfası CSV indirir`, `… Excel dosyası indirir` |

---

## 10. Veri Modeli ve Proje Yapısı

```
index.html            → uygulama girişi (ESM, derleme adımı yok)
src/core/             → tarayıcıdan ve Node testlerinden aynen kullanılan saf mantık
  catalog.js          → yatak/demirbaş katalogları, gider kategori & grupları, dağıtım yöntemleri
  model.js            → fabrikalar, kapasite/katsayı hesapları, doğrulama kuralları
  costEngine.js       → dağıtım motoru, projeksiyon, ADR/RevPAR/başa baş/YOY
  fx.js               → çift kur, tarih bazlı kur geçmişi, TCMB okuyucu
  dates.js            → gece/dönem aritmetiği, hızlı tarih aralıkları
  store.js            → localStorage tabanlı durum yönetimi (abonelikli)
  seed.js             → 9 odalı demo veri seti
src/ui/               → bağımlılıksız DOM görünümleri
  roomCard.js         → §8.4 Oda Kartı paneli
  calendarView.js     → §1.1 fiyat/gelir takvimi
  dashboardView.js    → §3 yönetici özeti
  expensesView.js     → §1.2 gider yönetimi
  reportsView.js      → §5/§6.1 raporlar ve dışa aktarım
  settingsView.js     → §8 ayarlar
test/                 → node:test birim testleri + opsiyonel tarayıcı akış testi
```

**Ana varlıklar:** `Room` (numara, ad, kat, durum, m², maliyet çarpanı, yataklar,
maxOccupancy, demirbaşlar, liste fiyatı) · `Reservation` (oda, misafir, kişi, tarihler,
tutar, para birimi, komisyon oranı, kahvaltı, durum) · `Expense` (tarih, kategori, tutar,
para birimi, aktif, dağıtım, oda, demirbaş, tekrarlama, dekont) · `Price`
(oda × tarih → tutar, para birimi) · `Settings` (dağıtım yöntemi, sabit pay, hedef marj,
kur, tarife, özel kategoriler).
