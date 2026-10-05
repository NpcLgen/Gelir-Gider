# Otel Finans ve Yönetim Sistemi

Otelin **finansal verimliliğine, oda bazlı maliyetlerine ve net kârlılığına** odaklanan,
kullanıcı/yetki yönetimi olan bir yönetim sistemi. Ön büro programı değil: gelir-gider
dengesini şeffaflaştırır, maliyetleri odalara dağıtır, vergi ve kasa durumunu raporlar.

* Gereksinimler: **[PRD.md](PRD.md)** — giriş/yetki, Excel, giderler, toptancı cari, vergi, kasa
  (sürüm **2.0**: restoran gelir/gider, yabancı çalışanlar, döviz kuru, yedekleme, mobil uyum)
* Ek belge: **[PRD-BI.md](PRD-BI.md)** — oda kârlılığı, maliyet dağıtımı, fiyat tavsiyesi
* Yayına alma: **[DEPLOY.md](DEPLOY.md)** — normal bir cPanel'de Firebase ile çalıştırma

## Hızlı başlangıç

```bash
npm start     # sunucuyu başlatır, adresi ekrana yazar (varsayılan http://127.0.0.1:5173)
```

İlk çalıştırmada varsayılan yönetici hesabı oluşturulur ve ekrana yazılır:

| Kullanıcı Adı | Şifre |
| --- | --- |
| `Admin` | `Admin2026` |

Adres kökü karşılama sayfasını açar; **Giriş Yap** düğmesi giriş ekranına götürür.
İlk girişte şifre değiştirmeniz **zorunludur**. Ardından **Ayarlar → 🧪 Demo Verisi Yükle**
ile örnek bir otelin verileriyle sistemi gezebilir, sonra kendi verinizi girebilirsiniz.

Port doluysa sunucu çökmez; sıradaki boş portu seçip adresi yazar.
Belirli bir port için: `PORT=8080 npm start` (Windows PowerShell: `$env:PORT="8080"; npm start`).

Derleme adımı ve harici bağımlılık yoktur. Uygulamayı `index.html`'e çift tıklayarak
açamazsınız; her zaman yukarıdaki sunucuyla açın.

### Windows'ta çalıştırma

Başlat'a sağ tıklayın → **Terminal**, sonra bu beş satırı yapıştırın:

```powershell
cd $env:USERPROFILE\Desktop
Invoke-WebRequest "https://github.com/NpcLgen/Gelir-Gider/archive/refs/heads/claude/advanced-room-profile-inventory-zqdywk.zip" -OutFile otel.zip
Expand-Archive otel.zip -DestinationPath . -Force
cd Gelir-Gider-claude-advanced-room-profile-inventory-zqdywk
cmd /c npm start
```

## Testler

```bash
npm test                    # 241 birim ve API testi (node:test, bağımlılıksız)
npm run test:browser        # 132 adımlı uçtan uca tarayıcı akışı (Playwright gerektirir)
npm run test:browser:v2     # yalnızca PRD v2.0 akışları (restoran, kur, yedek, mobil)
npm run test:browser:fatura # yalnızca gelen/giden fatura akışı
npm run test:browser:kur    # yalnızca tarihsel kur ve kur farkı akışı
npm run test:browser:faz3   # yalnızca Faz 3.0 kabul kriterleri
npm run test:browser:cpanel # yalnızca statik (cPanel + Firebase) kurulum akışı
```

Tarayıcı testi için: `npm i -D playwright && npx playwright install chromium`, sunucu ayakta olmalı.

## Modüller

| Modül | Ne yapar | PRD |
| --- | --- | --- |
| **Karşılama Sayfası** | Oturum yokken açılan tanıtım sayfası: hero, faydalar, "Giriş Yap", iletişim ve telif bilgisi | §23 |
| **Giriş & Yetki** | Kullanıcı girişi (şifre göster/gizle), 23 modül için aç/kapa yetkiler, dinamik menü, denetim kaydı | §1, §6, §7 |
| **Dashboard** | 9 gösterge: otel/restoran geliri, toplam gider, gelir ve gider KDV'si, turizm payı, konaklama vergisi, gelir vergisi, net kâr — dört adımlı vergi hesabı dökümüyle | §24 |
| **Gelirler** | Giden (satış) fatura listesi; e-Fatura Excel'inden toplu aktarım, TL/EUR, KDV | §17 |
| **Fiyat Girişi** | Takvim ızgarası, toplu güncelleme, fiyat kopyalama, maliyet altı fiyat uyarısı | BI §1.1, §3.3 |
| **Giderler (özet)** | Tüm gider kalemlerinin tek, sade veri tablosu (grafiksiz) | §3.1, §22 |
| **İşlenen Faturalar** | Excel'den işlenen gelir/gider faturaları; yükleme ve yön bazında süzme | §21 |
| **Genel Harcamalar** | Aktif/pasif anahtarı, dekont eki, tekrarlayan giderler, 5 dağıtım yöntemi | §3.4, §3.5 |
| **Gider Faturaları** | Gelen (alış) fatura listesi; e-Fatura Excel'inden toplu aktarım, mükerrer koruması | §17 |
| **Çalışanlar** | Sabit personel maaş + SGK, dönem bazlı, önceki aydan kopyalama | §3.2 |
| **Ekstra Çalışan** | Günübirlik ödemeler, yalnızca girildiği döneme yansır | §3.3 |
| **Vergiler** | KDV (konaklama %10 / restoran %10 / indirilecek), konaklama vergisi, turizm payı, gelir vergisi, vergi matrahı | §5.1, v2 §2.2 |
| **Yabancı Çalışanlar** | Dönem bazlı maaş kaydı; gidere girer, vergi matrahından indirilmez (ayarlanabilir) | v2 §3.1 |
| **Restoran Gelirleri** | Gün sonu kaydı (günde en fazla 2), günlük/aylık otomatik toplam, %10 KDV | v2 §2.1–§2.3 |
| **Restoran Ekstra Giderler** | Toptancı carisini etkilemeyen restoran harcamaları | v2 §2.4 |
| **Toptancılar** | Bağımsız cari defter: fatura/ödeme, yürüyen bakiye, filtreler. Buradaki tutarlar **gelir, gider, kârlılık ve vergi hesaplarına yansımaz** | §4 |
| **Gün Sonu / Kasa** | Beklenen kasa ile fiili kasa karşılaştırması, kasa açığı/fazlası | §5.2 |
| **Finansal Raporlar** | Dönem özeti, oda kârlılığı, gider dökümü; PDF/Excel/CSV | §2.1 |
| **Excel İşlemleri** | Örnek şablon, ön kontrollü içe aktarım, yetkiye göre dışa aktarım | §2.1 |
| **Oda Ayarları** | Oda kartı: kapasite, yatak düzeni, demirbaş listesi, maliyet katsayıları | BI §8.4 |
| **Yedekleme** | Tam yedek alma/indirme, doğrulamalı geri yükleme, otomatik yedek, ağ/bulut klasörü | v2 ek |
| **Ayarlar** | 5 sekme: Genel · Vergi ve Finans · Döviz Kuru · Kullanıcı ve Güvenlik · Görünüm | §8, v2 §5.1 |

## Mimari

İki arka uç, tek kod tabanı. Hangisinin kullanılacağını `src/app-config.js` belirler
(`backend: 'auto'` ortamı kendisi anlar):

```
1) Node sunucusu (npm start)
Tarayıcı (src/)  ──HTTP + httpOnly çerez──▶  Node sunucusu (server/)  ──▶  data/db.json
   dinamik menü                                oturum · yetki · doğrulama · denetim

2) Statik hosting (cPanel) — sunucu yok
Tarayıcı (src/)  ──REST──▶  Firebase Authentication  (oturum, şifre)
                 ──REST──▶  Firebase Realtime Database  (veri + kurallar)
```

Ortak çekirdek iki arka uçta da birebir aynı davranır: modül yetkileri
(`src/core/permissions.js`), koleksiyon tanımları ve doğrulama (`src/core/resources.js`),
Excel biçimi (`src/core/excelFormat.js`), mükerrer fatura kuralları
(`src/core/importPlan.js`) ve yedek biçimi (`src/core/backupFormat.js`).

Yetkilendirme iki katmanlıdır: yetkisiz modül menüde görünmez **ve** istek arka uçta
reddedilir — Node sunucusunda 403, Firebase'de ise `database.rules.json` kuralları.
Şifreler Node kurulumunda PBKDF2-SHA512 ile tuzlanarak, Firebase kurulumunda ise
Firebase Authentication tarafında saklanır.

Sol menü gruplanmıştır ve grup başlıklarına tıklanarak açılıp kapanır; **aynı anda yalnızca
bir ana kategori açık kalır** ve tercih tarayıcıda hatırlanır. Giriş sonrası Dashboard açılır.
Menü yapısı: **Genel · Gelir - Gider · Restoran · Kasa · Raporlar · Yönetim**. Rezervasyon
modülü Faz 3.0 ile kaldırılmıştır; sistem yalnızca finansal verilere odaklanır.

## Veri ve yedekleme

Node kurulumunda tüm veriler sunucudaki `data/db.json` dosyasındadır (atomik yazma);
cPanel + Firebase kurulumunda ise Realtime Database'in `/data` düğümünde durur.
Yedek dosyası biçimi ikisinde de aynıdır, bu yüzden yedek iki yönde taşınabilir.
**Yönetim → Yedekleme** sayfasından (admin yetkisi):

* **💾 Şimdi Yedek Al** — sunucuda zaman damgalı yedek dosyası oluşturur
* **⬇️ Anlık Yedeği İndir** — yedeği bilgisayara indirir
* **📂 Yedek Dosyası Seç / Geri Yükle** — doğrulamadan geçen yedeği geri yükler;
  geri yüklemeden önce otomatik **güvenlik yedeği** alınır
* **Otomatik yedekleme** — açılışta ve seçilen aralıkta (varsayılan 24 saat) yedek alır,
  `keep` sayısını aşan eskileri siler

Yedekler varsayılan olarak `data/backups/` klasörüne yazılır. Farklı bilgisayarlardan
erişmek için klasörü bir ağ sürücüsüne veya bulut eşitleme klasörüne taşıyın:

```powershell
# Windows — OneDrive klasörüne yedekle
$env:BACKUP_DIR="C:\Users\<kullanici>\OneDrive\OtelYedek"; npm start
```

```bash
# macOS / Linux — ağ sürücüsüne yedekle
BACKUP_DIR=/Volumes/NAS/otel-yedek npm start
```

## Ana ekran: dokuz gösterge

Dashboard otel ve restoran operasyonunu tek ekranda özetler: **Otel Geliri · Restoran Geliri ·
Toplam Giderler · Gelir KDV'si · Gider KDV Toplamı · Turizm Payı · Konaklama Vergisi ·
Gelir Vergisi · NET KÂR**. Turizm payı ve konaklama vergisi yalnızca KDV hariç otel geliri
üzerinden hesaplanır; restoran geliri bu iki kaleme girmez.

Gelir vergisi dört adımda hesaplanır ve "Gelir Vergisi Hesabı" kartında kalem kalem gösterilir:

```
1) Toplam Gelir      = Otel + Restoran (+ olumlu kur farkı)
2) Toplam İndirimler = Toplam Giderler (maaşlar dâhil) + Gider KDV + Konaklama V. + Turizm Payı
3) Vergi Matrahı     = (1) − (2)
4) Gelir Vergisi     = Vergi Matrahı × oran        →  NET KÂR = (3) − (4)
```

## e-Fatura Excel aktarımı

e-Fatura portalından indirdiğiniz dosyayı olduğu gibi yükleyebilirsiniz:

* **Gelen Fatura** dosyası → `Giderler → Gider Faturaları`
* **Giden Fatura** dosyası → `Genel → Gelirler`

Dosyadan yalnızca şu yedi sütun okunur (sıraları önemli değil, diğer sütunlar yok sayılır):
**Müşteri · Fatura Tarihi · Fatura No · Tutar · Para Birimi · Vergiler Hariç Toplam Tutar ·
Vergiler Dahil Toplam Tutar**. Örnek şablonun başlıkları da birebir bunlardır ve her iki
sayfadaki **❓ Örnek Şablon** düğmesinden indirilir.

Hesaplamalarda "Vergiler Dahil Toplam Tutar" kullanılır; KDV, dahil ve hariç tutarın
farkından alınır.

Fatura tablolarında sütunlar **kesik dikey çizgilerle** ayrılır: metin alanları sola,
para tutarları sağa yaslı kalır ama hangi sayının hangi sütuna ait olduğu bir bakışta
görünür.

**Aynı dosyayı tekrar yükleyebilirsiniz.** Daha önce işlenmiş bir fatura (aynı fatura no
ve aynı bilgiler) ikinci kez işlenmez, "atlandı" olarak raporlanır; yalnızca yeni satırlar
eklenir. Aynı numara farklı tutarla gelirse mevcut kayıt korunur ve satır çakışma olarak
listelenir. Aynı koruma gider ve rezervasyon aktarımlarında da çalışır. "📂 Excel Kontrol Et"
ile önce deneme yapabilirsiniz: kayıt eklenmez, hangi satırların yeni / atlanacak / çakışan /
hatalı olduğu önceden listelenir.

## Döviz kuru ve kur farkı

Döviz (EUR) işlemlerinde TL karşılığı, **işlemin yapıldığı günün kuruyla** sabitlenir:

* **Tarihsel kur defteri** — her günün kuru ayrı kayıt olarak saklanır
  (`Ayarlar → Döviz Kuru → Tarihsel Kur Defteri`). Kur sunucu açılışında ve 12 saatte bir
  otomatik çekilir; `🔄 Kuru Şimdi Güncelle` ile elle de tetiklenir.
* **Kur mührü** — kayıt oluşturulurken o günün kuru kayda yazılır. Kur sonradan değişse
  bile geçmiş kayıtların TL karşılığı değişmez.
* **Çift gösterim** — tutarlar `€195,00 / ₺7.410,00` biçiminde yan yana görünür.
* **Kur farkı** — gelir formlarındaki **"Kesilen Fatura Tutarı (TL)"** alanı ile kurdan
  hesaplanan tutar karşılaştırılır. Fatura yüksekse *Olumlu Kur Farkı (gelir)*, düşükse
  *Olumsuz Kur Farkı (gider)* olarak kârlılığa yansır ve Dashboard ile Finansal
  Raporlar'da ayrı satır olarak raporlanır.
* O güne ait kur yoksa sistem hata vermez: en yakın önceki günün kuru önerilir ve
  kullanıcıdan o günün kurunu girmesi istenir.

## Telefon, tablet ve tarayıcı uyumu

Arayüz masaüstü, tablet (≤1100px) ve telefon (≤820px) genişliklerinde çalışır: telefonda
menü ☰ düğmesiyle açılan yan panele döner, pencereler alt sayfa olarak açılır, geniş
tablolar kendi kartı içinde yatay kaydırılır ve sayfa yatay kaymaz. Dokunmatik cihazlarda
fareyle üzerine gelmeyi gerektiren bilgiler (ör. oda fiyat ipucu) dokunarak açılır.

Telefonda **tarayıcı menüsü → "Ana ekrana ekle"** ile kısayol oluşturabilirsiniz; sunucu
aynı ağda çalışıyor olmalıdır. Çevrimdışı çalışan gerçek bir uygulama kurulumu (PWA)
yol haritasındadır (PRD §11).

## Normal bir cPanel'de yayına alma (Firebase)

Paylaşımlı hostingte Node çalıştırılamaz; bu yüzden aynı dosyalar **sunucusuz** modda da
çalışır: kimlik doğrulama Firebase Authentication, veri Firebase Realtime Database
üzerinden yürür. Yapılacaklar kısaca:

1. `index.html`, `.htaccess` ve `src/` klasörünü `public_html` içine yükleyin.
2. `database.rules.json` içeriğini Firebase Console → Realtime Database → **Kurallar**'a
   yapıştırıp yayınlayın.
3. Authentication → **E-posta/Şifre**'yi açın ve ilk yöneticiyi
   `kullanıcıadı@otel.local` biçiminde oluşturun.
4. Alan adınızı açın: karşılama sayfası gelir, **Giriş Yap** ile oturum açılır.

Adım adım anlatım, güvenlik kuralları ve sorun giderme: **[DEPLOY.md](DEPLOY.md)**.

AppServ (Apache + PHP) kurulumunda dosyaları `C:\AppServ\www` altına kopyalamak tek
başına yetmez: `backend: 'firebase'` ile yukarıdaki statik mod kullanılabilir, yoksa
`/api/*` istekleri 404 döner. Node sunucusunu Apache arkasında 80 portunda tutmak için
`mod_proxy` ters proxy kurulumu PRD §15'tedir.

## Bilinen sınırlar

* **Döviz kuru:** Kur artık sunucu tarafından çekilir (TCMB / ECB); sunucunun internet
  erişimi yoksa güncelleme başarısız olur, bu durumda **son geçerli kur korunur** ve
  Ayarlar → Döviz Kuru'ndan elle girilebilir (PRD §13.9).
* **Tek sunucu (yalnızca Node modunda):** Node kurulumu tek makinede çalışır; ağdaki diğer
  bilgisayarlardan erişim için sunucunun IP adresi ve güvenlik duvarı ayarı gerekir. HTTPS
  kullanılmıyorsa yerel ağ dışına açmayın. cPanel + Firebase kurulumunda bu sınır yoktur:
  veriler buluttadır, her cihaz aynı veriyi görür.
* **Firebase modunda kur kaynağı:** TCMB ve ECB uçları tarayıcıdan çağrılamaz (CORS);
  bu modda Frankfurter (ECB) ve exchangerate.host kullanılır, erişilemezse kur elle girilir.
* **Firebase modunda yedek:** Sunucu klasörü ve otomatik yedek zamanlayıcısı yoktur;
  "Anlık Yedeği İndir" veya Firebase Console → *JSON dışa aktar* kullanılır.
