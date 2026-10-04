# Otel Finans ve Yönetim Sistemi
## Ürün Gereksinimleri Dokümanı (PRD) — Fonksiyonel Gereksinimler ve Kabul Kriterleri

**Sürüm:** 2.0 · **Durum:** Uygulandı — bu depodaki kod bu belgeyi karşılar.
**Doğrulama:** 158 birim/API testi (`npm test`) + 95 adımlı tarayıcı akış testi (`npm run test:browser`).
**Sürüm 2.0 teslim listesi:** 18/18 madde tamamlandı — bkz. [§12](#12-sürüm-20-teslim-listesi-1818).
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
▾ GENEL      → Dashboard · Gelirler (giden faturalar) · Rezervasyonlar ·
               Fiyat Girişi · Oda Ayarları
▾ GİDERLER   → Giderler · Genel Harcamalar · Gider Faturaları (gelen) ·
               Çalışanlar · Ekstra Çalışan · Yabancı Çalışanlar · Vergiler
▾ RESTORAN   → Restoran Gelirleri · Ekstra Giderler · Toptancılar
▾ KASA       → Gün Sonu / Kasa
▾ RAPORLAR   → Finansal Raporlar · Excel İşlemleri
▾ YÖNETİM    → Kullanıcı ve Yetki · Yedekleme · Ayarlar
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
  permissions.js      → 24 modül, yetki kontrolü
  api.js              → kimlik, CRUD, fiyat, ayarlar, faturalar, kullanıcılar, Excel,
                        yedekleme, döviz kuru
  excel.js            → bağımlılıksız XLSX okuma/yazma (node:zlib), şablonlar
  fx.js               → döviz kuru servisi (TCMB / ECB), çoklu kaynak ve yedekleme
  backup.js           → yedek alma, listeleme, doğrulama, geri yükleme, otomatik yedek
  audit.js            → denetim kaydı
src/core/             → tarayıcı ve sunucunun paylaştığı saf mantık
  finance.js          → personel, toptancı cari, kasa, vergi, fatura hesapları
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
3. ~~**Faz 2 — TCMB kur proxy'si**~~ → **Sürüm 2.0'da tamamlandı** (`server/fx.js`).
4. **Faz 3 — Muhasebe entegrasyonu:** Mali müşavire doğrudan aktarım (Excel/CSV/PDF hazır).
5. **Faz 3 — PWA kurulumu:** Telefona "uygulama olarak ekle" için manifest ve servis
   çalışanı (arayüz bugün de telefon/tablet uyumludur, bkz. §14).

---

# Sürüm 2.0 — Güncellenmiş Gereksinimler

## 12. Sürüm 2.0 Teslim Listesi (18/18)

| # | Madde | Durum | Doğrulayan test |
| --- | --- | --- | --- |
| 1 | Login ekranında şifre göster/gizle düğmesi çalışıyor | ✅ | `§1.1 Şifre göster/gizle düğmesi değeri koruyarak çalışır` |
| 2 | Yeni kullanıcıyla kategori geçişleri sorunsuz çalışıyor | ✅ | `§1.2 Çıkış–giriş sonrası menüde gezinme çalışır` |
| 3 | Giriş sonrasında Dashboard açılıyor | ✅ | `§1.3 Giriş sonrası Dashboard açılır` |
| 4 | Aynı anda yalnızca bir ana menü kategorisi açık kalıyor | ✅ | `§1.3 Aynı anda yalnızca bir menü kategorisi açık kalır` |
| 5 | Tarih seçici tasarımı ve filtreleri düzgün çalışıyor | ✅ | `§1.4 Hızlı dönem filtreleri eksiksiz ve çalışıyor` |
| 6 | Restoran gelir paneli oluşturuldu | ✅ | `§2.3 Bir güne iki gün sonu girilir ve toplanır` |
| 7 | Restoran gelirleri genel gelire dahil ediliyor | ✅ | `§2.1 Restoran geliri genel gelire ekleniyor` |
| 8 | Restoran yiyecek-içecek KDV oranı %10 olarak tanımlandı | ✅ | `restoran KDV’si %10 iç yüzde ile hesaplanır` |
| 9 | Aynı gün için en fazla iki gün sonu kaydı oluşturulabiliyor | ✅ | `bir güne en fazla iki gün sonu kaydı girilebilir` |
| 10 | Gün sonları günlük ve aylık olarak doğru toplanıyor | ✅ | `aynı günün iki gün sonu kaydı toplanır (12.500 + 8.750 = 21.250)` |
| 11 | Restoran Ekstra Giderler kategorisi çalışıyor | ✅ | `§2.4 Restoran ekstra gideri tedarikçi carisine dokunmadan eklenir` |
| 12 | Yabancı çalışanlar giderlere eklenebiliyor | ✅ | `§3.1 Giderler özetinde yabancı çalışan kalemi görünür` |
| 13 | Yabancı çalışan maaşları vergi matrahından ayrı tutuluyor | ✅ | `yabancı çalışan maaşı gider olur ama vergi matrahından indirilmez` |
| 14 | Döviz kuru otomatik ve manuel güncelleniyor | ✅ | `§4.1 Başarılı güncelleme kuru ve kaynağı yazar` |
| 15 | Ayarlar arayüzü yeniden düzenlendi | ✅ | `§5.1 Ayarlar kategorilere ayrıldı` |
| 16 | Fiyat girilmemiş odalarda fiyat ve maliyet bilgileri gösteriliyor | ✅ | `§6.1 Boş fiyat hücresinde tavsiye ve maliyet balonu açılır` |
| 17 | Appserv uyumluluk sorunu incelendi ve kök nedeni belirlendi | ✅ | §15 (teknik inceleme) |
| 18 | Yeni özellikler mevcut finansal raporlarla uyumlu çalışıyor | ✅ | `§3.1 Yabancı çalışan gideri eklenir, matrahtan indirilmez` + 133 birim testi |

---

## 13. Sürüm 2.0 Gereksinimleri — Uygulama Notları

### 13.1. Şifre Göster/Gizle (v2 §1.1) ✅

`src/ui/dom.js` içindeki `passwordField()` yardımcısı tüm şifre alanlarını `.pw-wrap`
kutusuna sarar ve sağ tarafa göz düğmesi (`.pw-toggle`) koyar.

* Düğme `input.type` değerini `password` ↔ `text` arasında çevirir; **değer kaybolmaz**.
* `aria-pressed` ve başlık metni görünürlük durumuyla birlikte güncellenir.
* Varsayılan gizlidir ve giriş doğrulamasına dokunmaz (sunucuya giden istek değişmez).
* Giriş ekranı, zorunlu şifre değişimi ve kullanıcı yönetimi formlarının tamamında kullanılır.

### 13.2. Kategori Geçiş Hatası (v2 §1.2) ✅ — kök neden

**Bulgu:** Hata yeni kullanıcıya özgü değildi; **aynı sekmede çıkış yapıp yeniden giriş
yapıldığında** ortaya çıkıyordu. Uygulama her girişte yeni bir arayüz oturumu kuruyor ama
önceki oturumun `hashchange` dinleyicisi DOM'dan kaldırılmıyordu. Eski dinleyici, artık
geçersiz olan eski yetki listesine bakıp adresi geri alıyor ve
"Bu sayfa için yetkiniz bulunmuyor" bildirimi veriyordu; sonuç olarak sayfa değişmiyordu.

**Çözüm:** `src/ui/app.js` içinde her oturum bir `AbortController` ile kapsanır:

```js
let activeSession = null;
function endActiveSession() { activeSession?.abort(); activeSession = null; }
// startApp içinde:
endActiveSession();
const session = new AbortController();
activeSession = session;
window.addEventListener('hashchange', handler, { signal: session.signal });
```

Çıkışta `endActiveSession()` çağrılır; eski dinleyiciler tarayıcı tarafından otomatik
kaldırılır. Sayfa yenileme, geri/ileri ve adres çubuğundan gezinme doğru çalışır;
yetkisiz sayfa erişimi hem arayüzde hem API'de engellenmeye devam eder.

### 13.3. Dashboard Açılışı ve Akordiyon Menü (v2 §1.3) ✅

* Giriş sonrası varsayılan sayfa `panel` (Dashboard); yetkisi yoksa ilk erişilebilir sayfa açılır.
* Menüde **aynı anda yalnızca bir ana kategori** açık kalır (`toggleGroup` diğerlerini kapatır).
* Açık grup `localStorage`'da saklanır; kullanıcı tüm grupları kapatmışsa bu tercih de korunur.
* Kapalı bir gruptaki sayfaya gidildiğinde grup otomatik açılır; aktif sayfa kapalı bir
  gruptaysa başlıkta nokta işaretiyle belirtilir.

### 13.4. Tarih ve Dönem Seçici (v2 §1.4) ✅

Hızlı filtreler: **Bugün · Bu Hafta · Bu Ay · Geçen Ay · Bu Çeyrek · Bu Yıl · YTD ·
Geçen Yılın Aynı Ayı**, ayrıca `📆 Özel Aralık` ile serbest başlangıç/bitiş tarihi.
Ay ileri/geri okları ve ay seçici ayrı durur. Telefonda düğmeler tek sırada yatay kaydırılır.
Başlangıç tarihi bitiş tarihinden ileri olamaz; seçim tüm rapor, tablo ve KPI'lara uygulanır.

### 13.5. Restoran Geliri ve Gün Sonu (v2 §2.1, §2.3) ✅

`Restoran → Restoran Gelirleri` sayfası gün sonu kayıtlarını tablo olarak gösterir:
*Tarih · 1. Gün Sonu · 2. Gün Sonu · Günlük Toplam · KDV · Açıklama*.

| Kural | Uygulama |
| --- | --- |
| Günde en fazla 2 gün sonu | `MAX_DAY_END_PER_DAY = 2`; 3. kayıt doğrulamada reddedilir |
| Aynı sıra numarası tekrar edemez | `validateRestaurantIncome` aynı gün + aynı sıra kaydını engeller |
| Aynı günün kayıtları toplanır | `restaurantDayTotal` → 12.500 + 8.750 = **21.250** |
| İptal edilen kayıt hesaba girmez | `active: false` kaydı toplama ve sınıra dahil edilmez |
| Çift sayım olmaz | Restoran geliri yalnızca gün sonu kaydından üretilir; ayrı manuel gelir girişi yoktur |

Gelir Dashboard'da `Toplam Gelir` kartına **"Oda ₺… + restoran ₺…"** açıklamasıyla eklenir,
finansal raporlarda ve yazdırma seçeneklerinde ayrı bölüm olarak yer alır.

### 13.6. Restoran KDV Oranı (v2 §2.2) ✅

* `Ayarlar → Vergi ve Finans` altında **Restoran KDV Oranı** parametresi; varsayılan **%10**.
* Konaklama KDV'sinden bağımsızdır; biri değişince diğeri etkilenmez.
* Tutar KDV **dahil** veya **hariç** girilebilir; hariç girilirse brüt tutar hesaplanır.
* KDV iç yüzdeyle bulunur: `KDV = tutar × oran / (100 + oran)`.
* Vergi raporunda `KDV (konaklama)`, `KDV (restoran)` ve `KDV (hesaplanan toplam)` satırları ayrıdır.
* Konaklama vergisi ve turizm payı yalnızca **oda** gelirinden alınır.

### 13.7. Restoran Ekstra Giderleri (v2 §2.4) ✅

`Restoran → Ekstra Giderler`: tarih, kategori (Ekipman, Mutfak Sarf, Tamirat, Temizlik,
Operasyonel, Diğer), tutar, açıklama ve isteğe bağlı ödeme yöntemi.
Kayıtta tedarikçi alanı **yoktur**; toptancı borç/bakiye hesaplarını etkilemez.
Giderler özetine, kârlılık ve vergi raporlarına dahil edilir.

### 13.8. Yabancı Çalışanlar (v2 §3.1) ✅

`Giderler → Yabancı Çalışanlar`: ad, dönem (ay), maaş tutarı, ödeme tarihi, açıklama.

* Maaşlar **gider toplamına ve kârlılık raporuna** dahil edilir.
* Vergi raporunda `İndirilemeyen Gider (matraha eklenen)` satırı olarak ayrı gösterilir.
* Vergi matrahı: `taxBase = netKâr + indirilemeyen giderler` → gelir vergisi bu matrah üzerinden.
* Sınıflandırma sabit değildir: `Ayarlar → Vergi ve Finans → "Yabancı çalışan maaşları
  vergi matrahından indirilebilir sayılsın"` kutusu açılırsa maaşlar indirilebilir sayılır.
* Aynı ad + aynı dönem iki kez kaydedilemez.

> Mali müşavir teyidi gereklidir; sistem her iki yorumu da parametreyle destekler.

### 13.9. Döviz Kuru Entegrasyonu (v2 §4.1) ✅ — kök neden

**Bulgu:** Kur tarayıcıdan doğrudan TCMB'ye istenmişti; TCMB `Access-Control-Allow-Origin`
başlığı döndürmediği için **CORS** isteği engelliyor, bu yüzden hem otomatik hem manuel
güncelleme sessizce başarısız oluyordu.

**Çözüm:** Kur çekimi sunucuya taşındı (`server/fx.js`, `POST /api/fx/refresh`).

| Kaynak | Alan |
| --- | --- |
| TCMB Efektif Satış (varsayılan) | `BanknoteSelling` |
| TCMB Döviz Alış | `ForexBuying` |
| Frankfurter (ECB) | JSON `rates.TRY` |
| Sabit Kur | yalnızca manuel giriş |

* Seçilen kaynak önce denenir; başarısız olursa diğerleri sırayla denenir (12 sn zaman aşımı).
* Başarıda kur, **kaynak adı**, kaynak tarihi ve güncelleme zamanı yazılır; geçmiş kurlar
  tarih bazında saklanır ve tabloda listelenir.
* Başarısızlıkta **mevcut kur korunur**, hata mesajı hangi kaynakların neden başarısız
  olduğunu belirtir ve kur kartında uyarı olarak gösterilir.

### 13.10. Ayarların Yeniden Tasarımı (v2 §5.1) ✅

Ayarlar beş sekmeye ayrıldı: **Genel Ayarlar · Vergi ve Finans · Döviz Kuru ·
Kullanıcı ve Güvenlik · Görünüm ve Arayüz**.
Her kart kısa açıklama metni taşır; `Kaydet` / `İptal` düğmeleri başlıkta sabittir;
kaydedilmemiş değişiklik varsa `● Kaydedilmemiş değişiklik` rozeti görünür ve sekme
değişiminde kullanıcı uyarılır. Ayarlar yalnızca `ayarlar` modülü yetkisi olan kullanıcıya
açıktır; yetkisiz istek API'de 403 döner.

### 13.11. Fiyat İpucu Balonu (v2 §6.1) ✅

Fiyat Girişi takviminde **fiyatı girilmemiş** bir hücrenin üzerine gelindiğinde (veya
dokunulduğunda / klavyeyle odaklanıldığında) bilgi balonu açılır:

* **Tavsiye Edilen Satış Fiyatı** — yeşil
* **Ortalama Oda Maliyeti** — kırmızı

Değerler ilgili odanın **seçili döneme ait** maliyet dağıtımından üretilir; veri yoksa
balon hiç açılmaz (tahmini rakam gösterilmez). Fiyatı girilmiş hücrelerde balon çıkmaz,
mevcut fiyat korunur. Balon ekran dışına taşmayacak şekilde konumlandırılır.

---

## 14. Yedekleme, Geri Yükleme ve Cihaz Uyumu

### 14.1. Yedekleme ve Geri Yükleme ✅

`Yönetim → Yedekleme` (admin / `yedekleme` modülü yetkisi):

| İşlem | Açıklama |
| --- | --- |
| ⬇️ Anlık Yedeği İndir | Tüm verinin JSON yedeğini bilgisayara indirir |
| 💾 Şimdi Yedek Al | Sunucuda zaman damgalı yedek dosyası oluşturur |
| 📂 Yedek Dosyası Seç | Bilgisayardaki bir yedeği doğrulayıp geri yükler |
| Geri Yükle | Sunucudaki yedeklerden birini geri yükler |
| 🗑️ Sil | Eski yedeği siler |

* Yedek **tüm koleksiyonları** içerir (kullanıcılar dâhil; şifreler hash'li saklanır).
* Geri yüklemeden **önce otomatik güvenlik yedeği** alınır (`…-geri-yukleme-oncesi.json`),
  böylece yanlış yedek seçilse bile geri dönülebilir.
* Geri yükleme öncesi dosya doğrulanır (biçim, eksik bölüm, şema sürümü, boş kullanıcı listesi)
  ve içerik özeti (kaç oda, kaç rezervasyon…) kullanıcıya gösterilir.
* `Mevcut kullanıcı hesaplarını koru` seçeneğiyle hesaplar korunarak yalnızca veri geri yüklenebilir.
* Tüm yedek/geri yükleme işlemleri denetim kaydına kullanıcı ve tarihle yazılır.

**Otomatik yedekleme ve farklı bilgisayarlardan erişim.** Sunucu açılışta ve belirlenen
aralıkta (varsayılan 24 saat) otomatik yedek alır; `keep` sayısını aşan eski yedekler silinir.
Yedek klasörü `BACKUP_DIR` ortam değişkeniyle değiştirilebilir — bir **ağ sürücüsüne** veya
**bulut eşitleme klasörüne** (OneDrive, Google Drive, Dropbox, NAS) işaret ettirildiğinde
yedekler diğer bilgisayarlardan da erişilebilir olur. Yedekleme sayfası geçerli klasör yolunu
ve örnek komutları gösterir:

```bat
:: Windows (OneDrive'a yedekle)
set BACKUP_DIR=C:\Users\<kullanici>\OneDrive\OtelYedek
npm start
```

```bash
# macOS / Linux (ağ sürücüsüne yedekle)
BACKUP_DIR=/Volumes/NAS/otel-yedek npm start
```

| # | Kriter | Test |
| --- | --- | --- |
| Y1 | Yedek alınır, listelenir, içerik eksiksizdir | `yedek alınır, listelenir ve içeriği eksiksizdir` |
| Y2 | Bozuk/eksik yedek reddedilir | `geçersiz yedek dosyası reddedilir` |
| Y3 | Dosya adı doğrulanır (dizin dışına çıkılamaz) | `yedek dosya adı doğrulanır` |
| Y4 | Geri yükleme veriyi döndürür, güvenlik yedeği alır | `geri yükleme verileri yedekteki haline döndürür` |
| Y5 | Kullanıcılar korunabilir | `kullanıcıları koru seçeneği mevcut hesapları bırakır` |
| Y6 | Eski yedekler budanır | `eski yedekler budanır, en yeniler kalır` |
| Y7 | Arayüzden uçtan uca çalışır | tarayıcı: `Yedekleme sayfası yedek alır ve listeler`, `Geri yükleme önizlemesi ve uygulaması çalışır` |

### 14.2. Tarayıcı, Mobil ve Tablet Uyumu ✅

Arayüz üç kırılma noktasıyla tasarlandı:

| Genişlik | Davranış |
| --- | --- |
| > 1100px | Masaüstü: sabit kenar menüsü, çok sütunlu kartlar |
| ≤ 1100px (tablet) | Menü daralır, geniş tablolar kart içinde yatay kaydırılır, oda kartları tek sütun |
| ≤ 820px (telefon) | Menü yan panele (off-canvas) dönüşür, ☰ düğmesi ve arka perde eklenir; KPI'lar 2 sütun; pencereler alt sayfa (bottom-sheet) olur; dönem düğmeleri tek sırada kaydırılır |
| `pointer: coarse` | Dokunmatik cihazlarda düğme ve hücreler büyütülür; fare üzerine gelme gerektiren bilgiler dokunmayla açılır |

Sayfalar telefon genişliğinde **yatay kaymaz**; yalnızca veri tabloları kendi kartı
içinde kaydırılır. Hızlı ekle (＋) menüsü dokunmatik cihazda düğmeye basınca açılır.

| # | Kriter | Test |
| --- | --- | --- |
| R1 | Tablet genişliğinde yatay taşma yok | tarayıcı: `Tablet genişliğinde içerik yatay taşmıyor` |
| R2 | Telefonda menü yan panel olur, perdeyle kapanır | tarayıcı: `Telefon genişliğinde menü yan panele dönüşür` |
| R3 | Telefonda sayfalar yatay kaymaz | tarayıcı: `Telefon genişliğinde sayfalar yatay kaymıyor` |

### 14.3. Yazdırma Panelindeki Metin Taşması ✅ — kök neden

**Bulgu:** Genel CSS kuralı `input, select, textarea { width: 100% }` onay kutularını da
kapsıyordu. Yazdırma seçenekleri esnek kutu (flex) olduğundan onay kutusu satırın tamamını
kaplıyor, etiket yazısına **0 piksel** kalıyor ve metin harf harf dikey bir şeride
sıkışıyordu.

**Çözüm:** `input[type="checkbox"], input[type="radio"] { width: auto; flex: none; }`
kuralı eklendi; etiket kalan alanı alır (`flex: 1 1 auto; min-width: 0`) ve uzun başlıklar
satır sonunda düzgün kırılır. Seçenek ızgarası dar ekranda tek sütuna iner.

| # | Kriter | Test |
| --- | --- | --- |
| P1 | Seçenek yazıları kutusuna sığar | tarayıcı: `Yazdırma panelindeki seçenek yazıları taşmıyor` |

---

## 15. Appserv Üzerinde Çalıştırma — Teknik İnceleme (v2 §7) ✅

### 15.1. Kök neden

**Bu uygulama PHP değildir.** Saf **Node.js** (v20+) ile yazılmıştır: `scripts/serve.js`
hem statik dosyaları sunar hem de `/api/*` uç noktalarını karşılar. Veriler MySQL'de değil,
sunucudaki `data/db.json` dosyasında tutulur.

AppServ; **Apache + PHP + MySQL + phpMyAdmin** paketidir ve **Node.js çalışma ortamı içermez.**
Bu nedenle:

| Olası sebep (PRD v2 §7 listesi) | Bu uygulamadaki durum |
| --- | --- |
| 1. Teknoloji uyumsuzluğu | **Kök neden budur.** Apache, `.js` dosyasını çalıştıramaz; yalnızca metin olarak sunar |
| 2. PHP sürüm uyumsuzluğu | İlgisiz — projede hiç PHP dosyası yoktur |
| 3. MySQL bağlantısı | İlgisiz — veritabanı yoktur, veri `data/db.json` dosyasındadır |
| 4. Apache yapılandırması | Yalnızca ters proxy kurulacaksa önemlidir (§15.3) |
| 5. Ortam değişkenleri | `PORT`, `DATA_DIR`, `BACKUP_DIR` isteğe bağlıdır; zorunlu değişken yoktur |
| 6. Dosya izinleri | Node sürecinin `data/` klasörüne yazma izni olmalıdır |
| 7. API / URL sorunları | Dosyalar `C:\AppServ\www` altına kopyalandığında Apache `index.html`'i sunar ama `/api/*` isteklerine **404** döner; ekranda veri gelmez |

### 15.2. Önerilen çözüm — doğrudan Node.js ile çalıştırma

```bat
:: 1) Node.js LTS kurulu olmalı (https://nodejs.org) — sürüm kontrolü:
node -v

:: 2) Proje klasörüne gidin ve başlatın:
cd C:\otel\Gelir-Gider
npm start
```

Ekranda yazan adresi (varsayılan `http://127.0.0.1:5173`) tarayıcıda açın. Port doluysa
sunucu bir sonraki boş portu seçer ve kullandığı adresi yazar. AppServ'in Apache'si (80) ve
MySQL'i (3306) ile port çakışması yoktur; AppServ'in çalışıyor olması sorun değildir.

**Sürekli çalışması için (Windows hizmeti):** `nssm install OtelFinans "C:\Program Files\nodejs\node.exe" "C:\otel\Gelir-Gider\scripts\serve.js"`
veya Görev Zamanlayıcı'da "bilgisayar açılışında çalıştır" görevi tanımlayın.

### 15.3. AppServ'i korumak isterseniz — ters proxy

Apache'yi 80 portunda bırakıp isteği Node'a yönlendirebilirsiniz:

```apache
# httpd.conf içinde modülleri açın
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so

ProxyPreserveHost On
ProxyPass        /otel/ http://127.0.0.1:5173/
ProxyPassReverse /otel/ http://127.0.0.1:5173/
```

Node sunucusu yine ayrıca çalışıyor olmalıdır; Apache yalnızca isteği iletir.
Oturum çerezi `httpOnly` ve `SameSite=Lax` olduğundan proxy arkasında da çalışır.

### 15.4. Ağdaki diğer bilgisayarlardan erişim

`npm start` sunucuyu tüm ağ arayüzlerinde dinletir. Aynı ağdaki telefon/tablet veya başka
bir bilgisayardan `http://<sunucu-ip>:5173` adresiyle girilebilir. Windows Güvenlik
Duvarı'nda ilgili porta izin verilmesi gerekir:

```bat
netsh advfirewall firewall add rule name="Otel Finans" dir=in action=allow protocol=TCP localport=5173
```

### 15.5. Kabul kriterleri

| # | Kriter | Durum |
| --- | --- | --- |
| A1 | Çalışmama sebebi teknik olarak tespit edildi | ✅ §15.1 — AppServ'de Node.js çalışma ortamı yok |
| A2 | Kaynak ve çözüm belgelendi | ✅ §15.2–§15.4 |
| A3 | Uygun ortamda sistem başarıyla çalışıyor | ✅ `npm start` + 80 adımlı tarayıcı akış testi |
| A4 | Login, sayfa geçişleri, API ve veri işlemleri test edildi | ✅ `npm test` (133 test) + `npm run test:browser` |

---

## 16. Sürüm 2.0 Genel Kuralları (v2 §8) ✅

| Kural | Uygulama |
| --- | --- |
| Yeni gelir/gider kategorileri Dashboard'a dahil | Restoran geliri `Toplam Gelir`e, restoran ve yabancı çalışan giderleri `Toplam Gider`e girer |
| Tüm finansal kayıtlar tarih bazında | Her kayıtta `date` / `period` alanı zorunludur |
| Gün sonu kayıtları çift sayım oluşturmaz | Restoran geliri tek kaynaktan (gün sonu) üretilir |
| Vergi oranları yönetilebilir parametre | 6 oran + indirilebilirlik anahtarı Ayarlar'dan düzenlenir |
| Kritik kayıtlar silinmek yerine pasife alınır | `active: false` (gider, restoran geliri, çalışan kayıtları) |
| Kritik işlemler kullanıcı ve tarihle kaydedilir | `server/audit.js` — Kullanıcı ve Yetki sayfasında listelenir |
| Yetkiler hem arayüzde hem API'de | 24 modül; menü filtrelenir, her uç nokta ayrıca 403 döner |
| Masaüstü ve mobil kullanım | §14.2 — tablet ve telefon kırılma noktaları |

---

## 17. Gelen ve Giden Faturalar (e-Fatura Excel Aktarımı)

### 17.1. Amaç

e-Fatura portalından indirilen Excel çıktıları sisteme olduğu gibi yüklenebilir:

| Dosya | Nereye yazılır | Menü |
| --- | --- | --- |
| **Gelen Fatura** (alış) | Gider faturaları | Giderler → **Gider Faturaları** |
| **Giden Fatura** (satış) | Gelir faturaları | Genel → **Gelirler** |

Gelir bölümü, gider bölümüyle **birebir aynı düzeni** kullanır (liste + ekle/düzenle
formu + Excel içe aktarım). Rezervasyon penceresi bu sayfadan ayrılarak kendi
sayfasına (**Rezervasyonlar**) taşınmıştır; doluluk, ADR ve RevPAR hesapları
rezervasyonlardan üretilmeye devam eder.

### 17.2. Okunan sütunlar

Portal dosyasında onlarca sütun bulunur; sistem yalnızca aşağıdaki **yedi başlığı**
okur, diğerlerini yok sayar. Sütun sırası önemli değildir, başlık adı eşleşmesi yeterlidir.
Örnek şablonun başlıkları da birebir bunlardır:

| Sütun | Kullanımı |
| --- | --- |
| **Müşteri** | Fatura karşı tarafı (zorunlu) |
| **Fatura Tarihi** | Dönem filtrelerinde kullanılır (zorunlu) |
| **Fatura No** | Mükerrer kayıt koruması (zorunlu) |
| **Tutar** | Bilgi amaçlı; KDV dahil tutar boşsa hesapta bu kullanılır |
| **Para Birimi** | TRY veya EUR; EUR tutarlar dönem kuruyla TL'ye çevrilir |
| **Vergiler Hariç Toplam Tutar** | KDV matrahı |
| **Vergiler Dahil Toplam Tutar** | **Hesaplamalarda kullanılan tutar** (zorunlu) |

* Fatura KDV'si orandan değil, **dahil − hariç** farkından alınır; vergi raporunda
  `KDV (giden faturalar)` ve `— gelen faturalardan` satırları olarak görünür.
* Tarihler `YYYY-AA-GG`, `GG.AA.YYYY` ve **Excel tarih hücresi** (seri numara)
  biçimlerinin üçünde de okunur.
* Desteklenmeyen para birimi (ör. USD) olan satır, sebebiyle birlikte reddedilir.

### 17.3. İçe aktarım kuralları

| Kural | Davranış |
| --- | --- |
| Önce kontrol | "📂 Excel Kontrol Et" kayıt eklemez; hangi satırların yeni, atlanacak, çakışan veya hatalı olduğunu önceden listeler |
| **Daha önce işlenmiş kayıt** | Aynı fatura no **ve** aynı bilgiler zaten varsa satır **tekrar işlenmez**, "atlandı" olarak raporlanır (bkz. §17.6) |
| Hatalı satır | Diğer satırlar aktarılır; hatalılar satır numarası, sebep ve ham içerikle listelenir |
| Eksik sütun | Dosya hiç işlenmez; eksik ve beklenen sütunlar ekranda gösterilir |
| Pasife alma | Kayıt silinmeden `Aktif` kutusu kapatılarak toplamlardan çıkarılabilir |

### 17.4. Raporlara yansıma

* **Dashboard:** `Toplam Gelir` kırılımı `oda + restoran + fatura`, `Toplam Gider`
  kırılımı `kayıt + fatura` olarak gösterilir; ayrıca `Gelir Faturaları` ve
  `Gider Faturaları` KPI kartları eklenir.
* **Giderler özeti:** `Gider Faturaları` yeni bir gider kaynağıdır.
* **Vergi raporu:** fatura KDV'leri hesaplanan ve indirilecek KDV'ye gerçek tutarıyla girer.
* **Excel dışa aktarım:** `Giden Faturalar` ve `Gelen Faturalar` sayfaları eklenir.
* **Yedekleme:** her iki koleksiyon da yedeğe dâhildir (şema sürümü 4).

> **Mükerrer sayım uyarısı.** Aynı satışı hem rezervasyon hem giden fatura olarak
> girerseniz gelir iki kez sayılır. Sayfadaki not bunu hatırlatır; çakışan kaydı
> silmek yerine pasife almak yeterlidir.

### 17.5. Çözülen hata — boş hücreler sütunları kaydırıyordu

Portal dosyalarında boş hücreler `<c r="I2"/>` biçiminde kendi kendini kapatır.
Excel okuyucusu bu hücreleri atlayınca sonraki sütunlar sola kayıyor, "Tutar"
boş görünüyor ve KDV tutarları yanlış sütundan okunuyordu. Okuyucu artık hücre
referansını (`r="I2"`) esas alır ve boş hücreleri yerinde bırakır.

| # | Kriter | Test |
| --- | --- | --- |
| F1 | Boş hücreler sütunları kaydırmaz | `boş hücreler sütunları kaydırmaz` |
| F2 | Şablon yalnızca yedi sütun taşır | `fatura şablonları yalnızca istenen yedi sütunu taşır` |
| F3 | Gelen fatura gidere yazılır | `gelen fatura dosyası gider faturalarına yazılır` |
| F4 | Giden fatura gelire yazılır | `giden fatura dosyası gelir faturalarına yazılır` |
| F5 | Mükerrer fatura reddedilir | `aynı fatura ikinci kez aktarılmaz` |
| F6 | Ön kontrol kayıt eklemez | `ön kontrol (dryRun) kayıt eklemez` |
| F7 | EUR tutarlar kurla çevrilir | `fatura özeti EUR tutarları kurla çevirir` |
| F8 | Fatura KDV'si vergi raporuna girer | `faturaların KDV’si vergi raporuna gerçek tutarıyla girer` |
| F9 | Arayüzde uçtan uca çalışır | tarayıcı: `test/browser/fatura.mjs` (15 adım) |

### 17.6. Mükerrer aktarım koruması

Aynı dosya ikinci kez yüklendiğinde hiçbir kayıt tekrar işlenmez. Her satır üç
kovadan birine düşer:

| Durum | Koşul | Sonuç |
| --- | --- | --- |
| **Yeni** | Anahtar daha önce görülmedi | Kaydedilir |
| **Atlandı** | Anahtar var **ve** bilgiler birebir aynı | Sessizce geçilir; hata sayılmaz |
| **Çakışma** | Anahtar var ama bilgiler değişmiş | Kaydedilmez, mevcut kayıt korunur, uyarı olarak listelenir |

Anahtar ve "bilgiler" tanımı içe aktarım türüne göre değişir:

| Tür | Anahtar | Karşılaştırılan bilgiler |
| --- | --- | --- |
| Gelen / giden fatura | Fatura No (büyük-küçük harf duyarsız) | Müşteri · Fatura tarihi · Para birimi · Vergiler hariç ve dahil tutarlar |
| Gider | Tarih + açıklama + kategori | Tutar · Para birimi |
| Rezervasyon | Oda + giriş + çıkış + misafir adı | Tutar · Para birimi |

* Gelen ve giden faturalar ayrı defterlerdir; aynı numara ikisinde de bulunabilir.
* Aynı dosya içinde tekrar eden satır da yalnızca bir kez işlenir.
* Ön kontrol (dryRun) bu kovaları aktarımdan **önce** gösterir.
* Bildirim ve özet metni sayıları birlikte verir:
  `12 yeni fatura aktarıldı · 6 fatura zaten işlenmişti · 1 çakışma.`
* Denetim kaydına da aynı kırılım yazılır.

| # | Kriter | Test |
| --- | --- | --- |
| M1 | Aynı dosya ikinci kez kayıt üretmez | `aynı dosya ikinci kez yüklenince hiçbir satır tekrar işlenmez` |
| M2 | Yalnızca yeni satırlar işlenir | `dosyanın yarısı yeniyse yalnızca yeni satırlar işlenir` |
| M3 | Atlanan satır hata sayılmaz | `aynı dosya ikinci kez yüklenince hiçbir satır tekrar işlenmez` |
| M4 | Bilgi değişmişse mevcut kayıt korunur | `aynı numara farklı bilgiyle gelirse çakışma bildirilir, kayıt değişmez` |
| M5 | Aynı dosyadaki tekrar da atlanır | `aynı dosyadaki mükerrer satır ikinci kez işlenmez` |
| M6 | Büyük/küçük harf farkı mükerrerdir | `fatura no büyük/küçük harf farkıyla da mükerrer sayılır` |
| M7 | Gider aktarımı da tekrarlanmaz | `aynı gider dosyası ikinci kez yüklenince kayıt çoğalmaz` |
| M8 | Rezervasyon aktarımı da tekrarlanmaz | `aynı rezervasyon dosyası ikinci kez yüklenince hata değil atlama üretir` |
| M9 | Arayüzde doğrulanır | tarayıcı: `Daha önce işlenmiş faturalar tekrar işlenmiyor` |

---

## 18. Bildirim Kutusu (Toast) Düzeltmesi

Kaydetme bildirimi aşağı kaydırılarak gizleniyordu (`translate(-50%, 120%)`); kutu
kısa olduğunda bu mesafe ekranın altına çıkmaya yetmiyor ve yeşil kutunun bir kısmı
ekranda kalıyordu. Bildirim artık **3 saniye görünür kalır, sonra 0,45 saniyede
solarak** tamamen kaybolur: `opacity: 0`, `visibility: hidden` ve `pointer-events: none`
birlikte uygulanır, böylece ne görünür ne de tıklamaları yakalar.

| # | Kriter | Test |
| --- | --- | --- |
| T1 | 3 saniye sonra iz bırakmadan kaybolur | tarayıcı: `Bildirim kutusu 3 saniye sonra tamamen kayboluyor` |
