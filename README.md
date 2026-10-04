# Otel Finans ve Yönetim Sistemi

Otelin **finansal verimliliğine, oda bazlı maliyetlerine ve net kârlılığına** odaklanan,
kullanıcı/yetki yönetimi olan bir yönetim sistemi. Ön büro programı değil: gelir-gider
dengesini şeffaflaştırır, maliyetleri odalara dağıtır, vergi ve kasa durumunu raporlar.

* Gereksinimler: **[PRD.md](PRD.md)** — giriş/yetki, Excel, giderler, toptancı cari, vergi, kasa
  (sürüm **2.0**: restoran gelir/gider, yabancı çalışanlar, döviz kuru, yedekleme, mobil uyum)
* Ek belge: **[PRD-BI.md](PRD-BI.md)** — oda kârlılığı, maliyet dağıtımı, fiyat tavsiyesi

## Hızlı başlangıç

```bash
npm start     # sunucuyu başlatır, adresi ekrana yazar (varsayılan http://127.0.0.1:5173)
```

İlk çalıştırmada varsayılan yönetici hesabı oluşturulur ve ekrana yazılır:

| Kullanıcı Adı | Şifre |
| --- | --- |
| `Admin` | `Admin2026` |

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
npm test                    # 150 birim ve API testi (node:test, bağımlılıksız)
npm run test:browser        # 93 adımlı uçtan uca tarayıcı akışı (Playwright gerektirir)
npm run test:browser:v2     # yalnızca PRD v2.0 akışları (restoran, kur, yedek, mobil)
npm run test:browser:fatura # yalnızca gelen/giden fatura akışı
```

Tarayıcı testi için: `npm i -D playwright && npx playwright install chromium`, sunucu ayakta olmalı.

## Modüller

| Modül | Ne yapar | PRD |
| --- | --- | --- |
| **Giriş & Yetki** | Kullanıcı girişi (şifre göster/gizle), 24 modül için aç/kapa yetkiler, dinamik menü, denetim kaydı | §1, §6, §7 |
| **Dashboard** | Kâr/zarar, marj, ADR, RevPAR, doluluk, gider dağılımı, başa baş, YOY | BI §3 |
| **Gelirler** | Giden (satış) fatura listesi; e-Fatura Excel'inden toplu aktarım, TL/EUR, KDV | §17 |
| **Rezervasyonlar** | Rezervasyon kaydı, kapasite ve çakışma kontrolü, TL/EUR, acenta komisyonu | §9 |
| **Fiyat Girişi** | Takvim ızgarası, toplu güncelleme, fiyat kopyalama, maliyet altı fiyat uyarısı | BI §1.1, §3.3 |
| **Giderler (özet)** | Genel harcama + personel + ekstra çalışan + toptancı faturalarının birleşik listesi, kaynak ve grup dağılımı | §3.1 |
| **Genel Harcamalar** | Aktif/pasif anahtarı, dekont eki, tekrarlayan giderler, 5 dağıtım yöntemi | §3.4, §3.5 |
| **Gider Faturaları** | Gelen (alış) fatura listesi; e-Fatura Excel'inden toplu aktarım, mükerrer koruması | §17 |
| **Çalışanlar** | Sabit personel maaş + SGK, dönem bazlı, önceki aydan kopyalama | §3.2 |
| **Ekstra Çalışan** | Günübirlik ödemeler, yalnızca girildiği döneme yansır | §3.3 |
| **Vergiler** | KDV (konaklama %10 / restoran %10 / indirilecek), konaklama vergisi, turizm payı, gelir vergisi, vergi matrahı | §5.1, v2 §2.2 |
| **Yabancı Çalışanlar** | Dönem bazlı maaş kaydı; gidere girer, vergi matrahından indirilmez (ayarlanabilir) | v2 §3.1 |
| **Restoran Gelirleri** | Gün sonu kaydı (günde en fazla 2), günlük/aylık otomatik toplam, %10 KDV | v2 §2.1–§2.3 |
| **Restoran Ekstra Giderler** | Toptancı carisini etkilemeyen restoran harcamaları | v2 §2.4 |
| **Toptancılar** | Cari hesap: fatura/ödeme, yürüyen bakiye, ad/fatura no/tarih filtreleri | §4 |
| **Gün Sonu / Kasa** | Beklenen kasa ile fiili kasa karşılaştırması, kasa açığı/fazlası | §5.2 |
| **Finansal Raporlar** | Dönem özeti, oda kârlılığı, gider dökümü; PDF/Excel/CSV | §2.1 |
| **Excel İşlemleri** | Örnek şablon, ön kontrollü içe aktarım, yetkiye göre dışa aktarım | §2.1 |
| **Oda Ayarları** | Oda kartı: kapasite, yatak düzeni, demirbaş listesi, maliyet katsayıları | BI §8.4 |
| **Yedekleme** | Tam yedek alma/indirme, doğrulamalı geri yükleme, otomatik yedek, ağ/bulut klasörü | v2 ek |
| **Ayarlar** | 5 sekme: Genel · Vergi ve Finans · Döviz Kuru · Kullanıcı ve Güvenlik · Görünüm | §8, v2 §5.1 |

## Mimari

```
Tarayıcı (src/)  ──HTTP + httpOnly çerez──▶  Node sunucusu (server/)  ──▶  data/db.json
   dinamik menü                                oturum · yetki · doğrulama · denetim
```

Yetkilendirme iki katmanlıdır: yetkisiz modül menüde görünmez **ve** ilgili API isteği
sunucuda 403 ile reddedilir. Şifreler PBKDF2-SHA512 ile tuzlanarak saklanır.

Sol menü gruplanmıştır ve grup başlıklarına tıklanarak açılıp kapanır; **aynı anda yalnızca
bir ana kategori açık kalır** ve tercih tarayıcıda hatırlanır. Giriş sonrası Dashboard açılır.

## Veri ve yedekleme

Tüm veriler sunucudaki `data/db.json` dosyasındadır (atomik yazma).
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

## e-Fatura Excel aktarımı

e-Fatura portalından indirdiğiniz dosyayı olduğu gibi yükleyebilirsiniz:

* **Gelen Fatura** dosyası → `Giderler → Gider Faturaları`
* **Giden Fatura** dosyası → `Genel → Gelirler`

Dosyadan yalnızca şu yedi sütun okunur (sıraları önemli değil, diğer sütunlar yok sayılır):
**Müşteri · Fatura Tarihi · Fatura No · Tutar · Para Birimi · Vergiler Hariç Toplam Tutar ·
Vergiler Dahil Toplam Tutar**. Örnek şablonun başlıkları da birebir bunlardır ve her iki
sayfadaki **❓ Örnek Şablon** düğmesinden indirilir.

Hesaplamalarda "Vergiler Dahil Toplam Tutar" kullanılır; KDV, dahil ve hariç tutarın
farkından alınır. Aynı fatura numarası ikinci kez yüklenemez. "📂 Excel Kontrol Et" ile
önce deneme yapabilirsiniz: kayıt eklenmez, yalnızca hatalı satırlar listelenir.

## Telefon, tablet ve tarayıcı uyumu

Arayüz masaüstü, tablet (≤1100px) ve telefon (≤820px) genişliklerinde çalışır: telefonda
menü ☰ düğmesiyle açılan yan panele döner, pencereler alt sayfa olarak açılır, geniş
tablolar kendi kartı içinde yatay kaydırılır ve sayfa yatay kaymaz. Dokunmatik cihazlarda
fareyle üzerine gelmeyi gerektiren bilgiler (ör. oda fiyat ipucu) dokunarak açılır.

Telefonda **tarayıcı menüsü → "Ana ekrana ekle"** ile kısayol oluşturabilirsiniz; sunucu
aynı ağda çalışıyor olmalıdır. Çevrimdışı çalışan gerçek bir uygulama kurulumu (PWA)
yol haritasındadır (PRD §11).

## Appserv ile çalışmaz — neden?

Bu uygulama PHP değil **Node.js**'tir; AppServ (Apache + PHP + MySQL) Node çalışma ortamı
içermediğinden dosyaları `C:\AppServ\www` altına kopyalamak işe yaramaz (`/api/*` istekleri
404 döner). Doğru kullanım `npm start` ile Node sunucusunu çalıştırmaktır; Apache'yi 80
portunda tutmak isterseniz `mod_proxy` ile ters proxy kurulumu PRD §15'te anlatılmıştır.

## Bilinen sınırlar

* **Döviz kuru:** Kur artık sunucu tarafından çekilir (TCMB / ECB); sunucunun internet
  erişimi yoksa güncelleme başarısız olur, bu durumda **son geçerli kur korunur** ve
  Ayarlar → Döviz Kuru'ndan elle girilebilir (PRD §13.9).
* **Tek sunucu:** Sistem tek makinede çalışır; ağdaki diğer bilgisayarlardan erişim için
  sunucunun IP adresi ve güvenlik duvarı ayarı gerekir. HTTPS kullanılmıyorsa yerel ağ
  dışına açmayın.
