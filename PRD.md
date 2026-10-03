# Otel Finans ve Yönetim Sistemi
## Ürün Gereksinimleri Dokümanı (PRD) — Fonksiyonel Gereksinimler ve Kabul Kriterleri

**Sürüm:** 1.0 · **Durum:** Uygulandı — bu depodaki kod bu belgeyi karşılar.
**Doğrulama:** 106 birim/API testi (`npm test`) + 55 adımlı tarayıcı akış testi (`npm run test:browser`).
**Ek belge:** Oda kârlılığı, maliyet dağıtımı ve fiyat tavsiyesi için [PRD-BI.md](PRD-BI.md).

---

## Mimari Notu

Bu PRD login, rol/modül yetkisi ve **"yetkisiz işlemlerin hem arayüz hem sunucu/API
seviyesinde engellenmesi"** istiyor. Bunlar yalnızca tarayıcı tarafında tutulan bir
uygulamayla sağlanamaz. Bu nedenle sistem iki katmanlıdır:

```
Tarayıcı (src/)  ──HTTP+çerez──▶  Node sunucusu (server/)  ──▶  data/db.json
   dinamik menü                     oturum · yetki · doğrulama · denetim kaydı
```

* `npm start` tek komutla hem arayüzü hem API'yi ayağa kaldırır; harici bağımlılık yoktur.
* Veriler sunucudaki `data/db.json` dosyasında tutulur (atomik yazma).
* **Her uç nokta kendi modül iznini doğrular**; arayüz atlatılsa bile istek 403 döner.

---

## 1. Giriş ve Güvenlik

### 1.1. Kullanıcı Giriş Paneli (Login) ✅

*Uygulama: `src/ui/login.js`, `server/auth.js`.*

* Uygulama açılışında kullanıcı doğrudan sisteme erişemez; giriş ekranı zorunludur.
* Kullanıcı adı ve şifre ile kimlik doğrulama yapılır. Şifreler **PBKDF2-SHA512**
  (150.000 tur, kayıt başına tuz) ile saklanır; düz metin hiçbir yerde tutulmaz.
* Oturum `httpOnly`, `SameSite=Strict` çerezle taşınır (12 saat, kayan süre).
* Başarılı girişten sonra kullanıcının yetkileri okunur; menü bu yetkilerden kurulur.
* Yetkisi bulunmayan menü ve sayfalar gösterilmez; adres çubuğundan gidilse bile açılmaz.

**Kabul kriterleri ve doğrulayan testler**

| # | Kriter | Test |
| --- | --- | --- |
| G1 | Login yapılmadan ana ekrana erişilemez | `oturum açılmadan veri uçlarına erişilemez` · tarayıcı: `Giriş yapılmadan ana ekrana erişilemiyor` |
| G2 | Geçerli bilgilerle giriş başarılı olur | `varsayılan Admin hesabıyla giriş yapılır…` |
| G3 | Hatalı bilgilerde uygun hata gösterilir | `hatalı kullanıcı adı veya şifre aynı mesajla reddedilir` · tarayıcı: `Hatalı bilgilerde hata mesajı gösteriliyor` |
| G4 | Kullanıcı yalnızca tanımlı yetkileriyle işlem yapar | `yetkisiz modüllerde API isteği 403 döner` · tarayıcı: `Yetkisiz API isteği sunucuda engellenir` |

> **Güvenlik notu:** Hatalı kullanıcı adı ile hatalı şifre **aynı** mesajı döndürür;
> böylece hangi kullanıcıların var olduğu sızdırılmaz.

---

## 2. Veri ve Rapor Yönetimi

### 2.1. Excel İçe / Dışa Aktarım ✅

*Uygulama: `server/excel.js` (bağımlılıksız XLSX okuma/yazma), `src/ui/excelView.js`.*

* Excel dosyasından toplu veri aktarımı yapılır (gelir ve gider).
* Sistemdeki kayıtlar Excel formatında dışa aktarılır; sayfalar: Gelirler, Giderler,
  Çalışanlar, Ekstra Çalışan, Toptancı Cari, Kasa. **Yetkisi olmayan sayfa dosyaya eklenmez.**
* Yükleme ekranında **"❓ Yardım / Örnek Şablon"** düğmesi bulunur; sistemin kabul ettiği
  sütun yapısını içeren örnek `.xlsx` şablonu indirir (ayrıca açıklama sayfası ekler).
* Hatalı/eksik sütun yapısında kullanıcı bilgilendirilir: beklenen ve bulunan sütunlar listelenir.
* Geçersiz satırlar **satır numarası ve gerekçesiyle** listelenir; geçerli satırlar aktarılır.
* **Ön kontrol (dryRun)** seçeneği: kayıt eklemeden yalnızca doğrulama yapar.
* Türkçe biçimler tanınır: `12.500,75` ve `12500.75`, `01.10.2026` ve `2026-10-01`,
  Excel tarih seri numarası.

| # | Kriter | Test |
| --- | --- | --- |
| E1 | Örnek şablon indirilebilir | `örnek şablon indirilebilir ve beklenen sütunları içerir` · tarayıcı: `Örnek Excel şablonu "?" düğmesinden indirilir` |
| E2 | Şablona uygun veriler aktarılır | `şablona uygun Excel içe aktarılır, geçersiz satırlar bildirilir` |
| E3 | Geçersiz satırlar bildirilir | aynı test (satır 4 hatalı olarak raporlanır) |
| E4 | Hatalı sütun yapısı bildirilir | `sütun yapısı uymayan dosya açıklayıcı hata verir` |
| E5 | Veriler Excel olarak dışa aktarılır | `dışa aktarım yetkiye göre sayfa üretir` · tarayıcı: `Dönem verisi Excel olarak dışa aktarılır` |
| E6 | Ön kontrol kayıt eklemez | `ön kontrol (dryRun) kayıt eklemez` |

### 2.2. Dinamik Yazdırma Seçenekleri ✅

*Uygulama: `src/ui/printDialog.js`.*

* Yazdırılabilir raporlarda üst şeritte **🖨️** düğmesi bulunur (yetki: `yazdirma`).
* Düğmeye basıldığında seçim modalı açılır; içerikler checkbox ile seçilir:
  Özet Göstergeler · Grafikler · Gelirler · Giderler · KDV ve Vergiler · Kasa Durumu ·
  Oda Bazlı Tablolar · Diğer Tablolar.
* "Tümünü Seç" / "Tümünü Kaldır" kısayolları vardır.
* Seçilmeyen bölümler yazdırma çıktısında görünmez; yazdırma bitince sayfa eski hâline döner.

| # | Kriter | Test |
| --- | --- | --- |
| Y1 | Yazdırma öncesi seçim ekranı açılır | tarayıcı: `Yazdırma seçim ekranı açılır ve içerik seçilebilir` |
| Y2 | Kullanıcı istediği bölümleri seçebilir | aynı test (tümünü kaldırma doğrulanır) |
| Y3 | Çıktıda yalnızca seçilenler bulunur | `print-hidden` sınıfı `@media print` ile gizlenir |

---

## 3. Gider Yönetimi

### 3.1. Giderler Ana Menüsü ✅

Menüdeki **Giderler** grubu beş sayfa içerir:

| Sayfa | İçerik |
| --- | --- |
| **Giderler** (özet) | Tüm gider kaynaklarının birleşik listesi ve dönem toplamı |
| **Genel Harcamalar** | Fatura, bakım, sarf malzeme vb. tekil gider kayıtları |
| **Çalışanlar** | Sabit personel maaş + SGK |
| **Ekstra Çalışan** | Günübirlik/geçici ödemeler |
| **Vergiler** | Vergi raporu (§5.1) |

**Giderler (özet) sayfası** dönemin bütün gider kalemlerini tek tabloda toplar:
genel harcamalar (tekrarlayanlar ve otomatik açılan faturalar dâhil), personel
maaş + SGK, ekstra çalışan ödemeleri ve toptancı faturaları. Her kaynak için
toplam ve yüzde pay kartı gösterilir; karta tıklayınca ilgili sayfaya gidilir.
Gider grupları (sabit/değişken/operasyonel/pazarlama) ve vergi yükü ayrıca özetlenir.

> Kaynak kartları ve tablo satırları **kullanıcının yetkisine göre** filtrelenir:
> `calisanlar` yetkisi olmayan kullanıcı personel kalemlerini bu listede görmez.

### 3.2. Çalışanlar (Sabit Personel) ✅

*Uygulama: `src/ui/employeesView.js`, `src/core/finance.js`.*

* Girilen bilgiler: personel adı, görev, **net maaş**, **SGK/sigorta**, dönem (ay), not.
* Maaş ve SGK **ayrı ayrı** tutulur; toplamı ilgili ayın giderine dahil edilir.
* Aynı personel aynı dönemde iki kez kaydedilemez.
* "Önceki Aydan Kopyala" ile tekrarlayan personel yeni döneme taşınır.

| # | Kriter | Test |
| --- | --- | --- |
| C1 | Yeni personel eklenebilir | `personel maaş ve SGK ayrı tutulur…` · tarayıcı: `Personel maaş ve SGK ayrı girilir…` |
| C2 | Maaş ve SGK ayrı girilir | aynı testler |
| C3 | Ayın gider toplamı otomatik güncellenir | tarayıcı adımı dönem personel giderini doğrular |
| C4 | Mükerrer kayıt engellenir | `aynı personel aynı dönemde iki kez kaydedilemez` |

### 3.3. Ekstra Çalışan ✅

* Girilen bilgiler: çalışan adı/açıklama, çalışma tarihi, yevmiye/ödeme tutarı, açıklama.
* Ödeme **yalnızca girildiği döneme** yansır; başka aya taşınmaz.

| # | Kriter | Test |
| --- | --- | --- |
| K1 | Ödeme manuel girilebilir | `ekstra çalışan ödemesi tarih ve tutar ister` |
| K2 | Tutar ilgili ayın giderine eklenir | tarayıcı: `Ekstra çalışan ödemesi döneme yansır` |

### 3.4. Genel Harcamalar ✅

* "＋ Yeni Gider" ve sağ alt köşedeki hızlı ekle (FAB) düğmesi.
* Alanlar: tarih, tutar, para birimi, kategori, açıklama, tedarikçi, dağıtım yöntemi,
  oda/demirbaş, dekont eki, tekrarlama.
* Kaydedilen harcama ilgili ayın gider toplamına anında dahil olur.

### 3.5. Dönemsel Gider Yönetimi ✅

* **Tek seferlik giderler** yalnızca girildiği ayda görünür.
* **Tekrarlayan giderler** "Her ayın X günü" olarak işaretlenir; rapor üretilirken o döneme
  otomatik yansır. Bitiş tarihi verilirse sonrasında oluşmaz; pasife alınırsa hiç işlenmez.
* **Faturalar:** Ayarlar → *Dönemsel Fatura Kalemleri*'nde tanımlı elektrik/su/doğalgaz gibi
  kalemler, yeni dönem açıldığında **0 TL** olarak otomatik oluşturulur; fatura gelince tutar
  güncellenir ve ilgili ayın giderine dahil olur. Aynı dönem için ikinci kez oluşturulmaz.

| # | Kriter | Test |
| --- | --- | --- |
| D1 | Tekrarlayan gider her ay yansır | `tekrarlayan gider her ayın belirtilen gününde yansır` |
| D2 | Başlangıç/bitiş sınırlarına uyar | `tekrarlayan gider başlangıç tarihinden önce ve bitişten sonra yansımaz` |
| D3 | Yeni dönemde fatura 0 TL açılır, mükerrer açılmaz | `dönemsel faturalar yeni ayda 0 TL olarak açılır ve tekrar açılmaz` |
| D4 | Pasif gider hesaptan düşer, silinmez | `pasif gider hesaplamadan düşer, kayıt silinmez` · tarayıcı: `Gider aktif/pasif anahtarı…` |
| D5 | Tüm gider kaynakları tek listede toplanır | tarayıcı: `Giderler alt kategorisi tüm gider kalemlerini birleştiriyor` |

---

## 4. Restoran ve Toptancı Yönetimi

### 4.1 / 4.2. Toptancılar ve Cari Panel ✅

*Uygulama: `src/ui/suppliersView.js`, `finance.supplierBalance()`.*

* Yeni toptancı eklenir; mevcut toptancı **pasife alınabilir** veya silinebilir
  (silme, bağlı cari hareketleri de kaldırır).
* Her toptancının bağımsız **cari paneli** vardır: kesilen faturalar, yapılan ödemeler,
  toplam borç, **yürüyen bakiye**, işlem tarihleri ve fatura numaraları.
* **Fatura borcu artırır, ödeme azaltır.** Fatura kaydında fatura numarası zorunludur;
  KDV oranı girilir ve vergi raporunda indirilecek KDV olarak kullanılır.

| # | Kriter | Test |
| --- | --- | --- |
| T1 | Toptancı bazında cari görüntülenir | tarayıcı: `Toptancı eklenir ve cari paneli açılır` |
| T2 | Fatura borcu artırır | `fatura borcu artırır, ödeme azaltır; bakiye yürüyen olarak hesaplanır` |
| T3 | Ödeme borcu azaltır | aynı test · tarayıcı: `Fatura borcu artırır, ödeme azaltır` |
| T4 | Kalan bakiye net gösterilir | aynı testler (12.000 − 5.000 = 7.000) |

### 4.3. Toptancı Arama ve Filtreleme ✅

Toptancı adı, fatura numarası ve tarih aralığı ile filtreleme; "Filtreleri Temizle" kısayolu.

| # | Kriter | Test |
| --- | --- | --- |
| T5 | Tarih aralığı filtrelenir | `cari hesap tarih aralığına göre filtrelenir` |
| T6 | Toptancı adına göre filtrelenir | tarayıcı: `Toptancı adına göre arama çalışır` |
| T7 | Fatura numarasına göre aranır | arayüzde fatura no araması (`filters.invoiceNo`) |

---

## 5. Vergi ve Kasa Yönetimi

### 5.1. Vergi Raporu ✅

*Konum: Giderler → Vergiler. Uygulama: `src/ui/taxView.js`, `finance.taxReport()`.*

**KDV hesabı** — tutarlar KDV dahil kabul edilir, iç yüzde ile ayrıştırılır:

```
Hesaplanan KDV   = konaklama geliri × oran / (100 + oran)
İndirilecek KDV  = belgeli gider × oran / (100 + oran)
Ödenecek Net KDV = Hesaplanan − İndirilecek      (negatifse "devreden KDV")
```

Rapor ayrı satırlar hâlinde şunları gösterir: **KDV · Konaklama Vergisi · Turizm Payı ·
Net Kâr · Net Kâr üzerinden Gelir/Kurumlar Vergisi · Vergi Sonrası Net Kâr.**

* Konaklama vergisi ve turizm payı **KDV hariç** gelir üzerinden hesaplanır.
* Personel ödemeleri KDV doğurmadığı için indirilecek KDV matrahına dahil edilmez.
* Rapor dönem bazında görüntülenir (üst şeritteki dönem seçicisi).
* **Vergi oranları sabit kodlanmamıştır**; Ayarlar yetkisi olan kullanıcı rapor ekranından
  günceller (varsayılanlar: KDV %10/%20, konaklama vergisi %2, turizm payı %0,75, gelir vergisi %25).

| # | Kriter | Test |
| --- | --- | --- |
| V1 | Hesaplar kayıtlı verilerden otomatik yapılır | `ödenecek net KDV = hesaplanan − indirilecek` |
| V2 | Vergi kalemleri ayrı gösterilir | tarayıcı: `Vergi raporu KDV, konaklama vergisi ve turizm payını ayrı gösterir` |
| V3 | Rapor dönem bazlıdır | dönem seçicisi raporu yeniden üretir |
| V4 | Oranlar değiştirilebilir | `vergi oranları değiştirilebilir ve doğrulanır` · tarayıcı: `Vergi oranları değiştirilebilir ve rapora yansır` |
| V5 | Devreden KDV ayrıca gösterilir | `indirilecek KDV fazlaysa devreden KDV oluşur` |

### 5.2. Gün Sonu ve Kasa Açığı ✅

*Uygulama: `src/ui/cashView.js`, `finance.cashSummary()`.*

```
Beklenen Kasa = Gün Başı Devir + Günlük Gelir − Günlük Gider
Fark          = Fiili (sayılan) Kasa − Beklenen Kasa
```

* Günlük gelir: o gece konaklayan rezervasyonların gecelik payı.
* Günlük gider: o tarihli giderler (tekrarlayanlar dâhil) + ekstra çalışan ödemeleri +
  toptancılara yapılan ödemeler.
* Sonuç net olarak gösterilir: **Kasa Açığı · Kasa Fazlası · Denk / Fark Yok**.
* Aylık toplam fark ve açık/fazla veren gün sayısı raporlanır.
* Aynı güne ikinci gün sonu kaydı engellenir.

| # | Kriter | Test |
| --- | --- | --- |
| S1 | Gün sonu işlemi yapılabilir | tarayıcı: `Gün sonu: kasa açığı tespit edilir` |
| S2 | Kayıtlı ve fiili kasa karşılaştırılır | `kasa denk olduğunda fark yok bildirilir` |
| S3 | Fark açık şekilde gösterilir | `sayılan kasa eksikse kasa açığı bildirilir`, `…fazlaysa kasa fazlası bildirilir` |
| S4 | Aylık toplam fark raporlanır | Kasa ekranındaki "Aylık Toplam Fark" göstergesi |
| S5 | Mükerrer gün sonu engellenir | `aynı güne ikinci gün sonu kaydı reddedilir` |

---

## 6. Kullanıcı ve Yetki Yönetimi

### 6.1. Admin Arayüzü ✅

Yalnızca Admin: kullanıcı oluşturur, bilgilerini düzenler, aktif/pasif yapar, şifresini
değiştirir ve erişebileceği modülleri belirler. Her kullanıcı kendi şifresini değiştirebilir.

### 6.2. Rol ve Modül Bazlı Yetkilendirme ✅

18 modül aç/kapa anahtarıyla yönetilir: Dashboard · Gelirler · Fiyat Girişi · Oda Ayarları ·
Giderler · Çalışanlar · Ekstra Çalışan · Genel Harcamalar · Vergiler · Restoran · Toptancılar ·
Kasa · Finansal Raporlar · Excel İçe Aktarım · Excel Dışa Aktarım · Yazdırma · Ayarlar ·
Kullanıcı Yönetimi.

**İş kuralları**

* Yetkisi kapalı kullanıcı ilgili modülü görmez (menüde yer almaz).
* Yetkisi olmayan kullanıcı ilgili sayfaya adresten de erişemez; API isteği 403 döner.
* Kullanıcı yönetimi yalnızca Admin tarafından yapılır.
* **Sistemde en az bir aktif Admin kalmalıdır** (son admin pasife alınamaz/silinemez).
* Pasife alınan kullanıcının açık oturumları anında düşer.
* Yetkisi olmayan kullanıcıya kişisel/firma bilgileri **maskelenerek** döner
  (`•••`); tutarlar korunur, böylece toplamlar şaşmaz.

| # | Kriter | Test |
| --- | --- | --- |
| A1 | Yetkisiz modül görünmez | tarayıcı: `Sınırlı kullanıcı yalnızca yetkili modülleri görür` |
| A2 | Yetkisiz URL'ye erişilemez | tarayıcı: `Yetkisiz sayfaya adresten gidilemez` |
| A3 | Kullanıcı yönetimi yalnızca Admin'de | `kullanıcı yönetimi yalnızca Admin tarafından yapılabilir` |
| A4 | Son admin korunur | `sistemde en az bir aktif Admin kalmalıdır` |
| A5 | Pasif kullanıcı giriş yapamaz | `pasif kullanıcı giriş yapamaz` |
| A6 | Kişisel veriler maskelenir | `yetkisiz kullanıcıya kişisel veriler maskelenerek döner` |

---

## 7. Varsayılan Admin Kullanıcısı ✅

Kurulumda (veritabanı boşken) başlangıç hesabı oluşturulur ve sunucu açılışında ekrana yazılır:

| Alan | Değer |
| --- | --- |
| Kullanıcı Adı | `Admin` |
| Şifre | `Admin2026` |

**Güvenlik kuralı uygulanmıştır:** İlk girişten sonra şifre değiştirme **zorunludur** —
değiştirilene kadar uygulamaya geçilemez. Şifre politikası: en az 6 karakter, en az bir
harf ve bir rakam.

---

## 8. Genel Sistem Kuralları ✅

| Kural | Uygulama |
| --- | --- |
| Tüm finansal kayıtlar tarih/dönem bazında tutulur | Her kayıtta `date` veya `period` alanı |
| Aylık raporlar bağımsız görüntülenir | Üst şeritte dönem seçici ve hızlı aralıklar |
| Kayıt değişince hesaplar otomatik güncellenir | Değişiklik sonrası durum sunucudan tazelenir |
| Kritik kayıtlarda silme yerine pasife alma | Gider, personel, toptancı, cari hareket ve kullanıcıda aktif/pasif |
| Yetkisiz işlemler arayüz **ve** API'de engellenir | Menü filtresi + her uçta modül kontrolü |
| Kritik değişiklikler kullanıcı ve tarihle kaydedilir | `server/audit.js`; Kullanıcı Yönetimi ekranında görüntülenir |
| Raporlarda tarih aralığı seçilebilir | Bu Ay · Geçen Ay · Bu Çeyrek · YTD · Geçen Yılın Aynı Ayı · Özel Aralık |
| Parasal değerler TL cinsinden tutulur ve gösterilir | Baz para birimi TRY; EUR kalemler tarihine ait kurla çevrilir |
| Vergi oranları yönetilebilir parametredir | Ayarlar/Vergi Raporu ekranından düzenlenir |

---

## 9. Ana Menü Yapısı ✅

```
▾ GENEL      → Dashboard · Gelirler · Fiyat Girişi · Oda Ayarları
▾ GİDERLER   → Giderler · Genel Harcamalar · Çalışanlar · Ekstra Çalışan · Vergiler
▾ RESTORAN   → Toptancılar
▾ KASA       → Gün Sonu / Kasa
▾ RAPORLAR   → Finansal Raporlar · Excel İşlemleri
▾ YÖNETİM    → Kullanıcı ve Yetki · Ayarlar
```

* Menü, Admin'in verdiği yetkilere göre **dinamik** oluşturulur: yetkisi olmayan girdi
  hiç basılmaz. Grup başlığındaki sayı, o gruptaki erişilebilir sayfa adedini gösterir.
* **Grup başlıkları aç-kapa çalışır:** başlığa tıklandığında alt başlıklar açılır/kapanır.
  Tercih tarayıcıda hatırlanır; kapalı bir gruptaki sayfaya gidildiğinde grup otomatik açılır
  ve kapalı grupta aktif sayfa varsa başlıkta nokta işaretiyle belirtilir.

| # | Kriter | Test |
| --- | --- | --- |
| M1 | Gruplar açılıp kapanır, tercih hatırlanır | tarayıcı: `Menü grupları açılıp kapanabiliyor ve tercih hatırlanıyor` |
| M2 | Özet kartından ilgili sayfaya geçilir | tarayıcı: `Özet kartından ilgili gider sayfasına geçiliyor` |

---

## 10. Proje Yapısı

```
scripts/serve.js      → tek komutla statik dosya + API sunucusu
server/
  db.js               → dosya tabanlı depo, atomik yazma, sıralı güncelleme
  auth.js             → PBKDF2 şifre saklama, oturum, varsayılan Admin
  permissions.js      → 18 modül, yetki kontrolü
  api.js              → kimlik, CRUD, fiyat, ayarlar, faturalar, kullanıcılar, Excel
  excel.js            → bağımlılıksız XLSX okuma/yazma (node:zlib), şablonlar
  audit.js            → denetim kaydı
src/core/             → tarayıcı ve sunucunun paylaştığı saf mantık
  finance.js          → personel, toptancı cari, kasa, vergi hesapları
  costEngine.js       → maliyet dağıtımı, fiyat eşikleri (bkz. PRD-BI.md)
  model.js · dates.js · fx.js · format.js · api.js · store.js
src/ui/               → görünümler (login, dashboard, giderler/özet, toptancılar, kasa,
                        vergi, kullanıcılar, excel, yazdırma, takvim, oda kartı…)
test/                 → birim ve API testleri + opsiyonel tarayıcı akışları
data/db.json          → veritabanı (sürüm kontrolüne dahil değildir)
```

## 11. Gelecek Fazlar

1. **Faz 2 — Kanal yöneticisi:** Booking/Airbnb gelir ve komisyonlarının API ile aktarımı
   (komisyon oranı alanı hazır).
2. **Faz 2 — İlişkisel veritabanı:** `data/db.json` yerine ACID garantili ilişkisel veritabanı.
   Mevcut veri modeli bu geçişe uygun normalize edilmiştir.
3. **Faz 2 — TCMB kur proxy'si:** Tarayıcıdan doğrudan çekimi CORS engellediğinden sunucu
   tarafı kur servisi.
4. **Faz 3 — Muhasebe entegrasyonu:** Mali müşavire doğrudan aktarım (Excel/CSV/PDF hazır).
