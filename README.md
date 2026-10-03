# Otel Finans ve Yönetim Sistemi

Otelin **finansal verimliliğine, oda bazlı maliyetlerine ve net kârlılığına** odaklanan,
kullanıcı/yetki yönetimi olan bir yönetim sistemi. Ön büro programı değil: gelir-gider
dengesini şeffaflaştırır, maliyetleri odalara dağıtır, vergi ve kasa durumunu raporlar.

* Gereksinimler: **[PRD.md](PRD.md)** — giriş/yetki, Excel, giderler, toptancı cari, vergi, kasa
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
npm test                    # 106 birim ve API testi (node:test, bağımlılıksız)
npm run test:browser        # 51 adımlı uçtan uca tarayıcı akışı (Playwright gerektirir)
```

Tarayıcı testi için: `npm i -D playwright && npx playwright install chromium`, sunucu ayakta olmalı.

## Modüller

| Modül | Ne yapar | PRD |
| --- | --- | --- |
| **Giriş & Yetki** | Kullanıcı girişi, 18 modül için aç/kapa yetkiler, dinamik menü, denetim kaydı | §1, §6, §7 |
| **Dashboard** | Kâr/zarar, marj, ADR, RevPAR, doluluk, gider dağılımı, başa baş, YOY | BI §3 |
| **Gelirler** | Rezervasyon kaydı, kapasite ve çakışma kontrolü, TL/EUR, acenta komisyonu | §9 |
| **Fiyat Girişi** | Takvim ızgarası, toplu güncelleme, fiyat kopyalama, maliyet altı fiyat uyarısı | BI §1.1, §3.3 |
| **Genel Harcamalar** | Aktif/pasif anahtarı, dekont eki, tekrarlayan giderler, 5 dağıtım yöntemi | §3.4, §3.5 |
| **Çalışanlar** | Sabit personel maaş + SGK, dönem bazlı, önceki aydan kopyalama | §3.2 |
| **Ekstra Çalışan** | Günübirlik ödemeler, yalnızca girildiği döneme yansır | §3.3 |
| **Vergiler** | KDV (hesaplanan/indirilecek/ödenecek), konaklama vergisi, turizm payı, gelir vergisi | §5.1 |
| **Toptancılar** | Cari hesap: fatura/ödeme, yürüyen bakiye, ad/fatura no/tarih filtreleri | §4 |
| **Gün Sonu / Kasa** | Beklenen kasa ile fiili kasa karşılaştırması, kasa açığı/fazlası | §5.2 |
| **Finansal Raporlar** | Dönem özeti, oda kârlılığı, gider dökümü; PDF/Excel/CSV | §2.1 |
| **Excel İşlemleri** | Örnek şablon, ön kontrollü içe aktarım, yetkiye göre dışa aktarım | §2.1 |
| **Oda Ayarları** | Oda kartı: kapasite, yatak düzeni, demirbaş listesi, maliyet katsayıları | BI §8.4 |
| **Ayarlar** | Dağıtım yöntemi, hedef marj, kur, kategoriler, dönemsel fatura kalemleri | §8 |

## Mimari

```
Tarayıcı (src/)  ──HTTP + httpOnly çerez──▶  Node sunucusu (server/)  ──▶  data/db.json
   dinamik menü                                oturum · yetki · doğrulama · denetim
```

Yetkilendirme iki katmanlıdır: yetkisiz modül menüde görünmez **ve** ilgili API isteği
sunucuda 403 ile reddedilir. Şifreler PBKDF2-SHA512 ile tuzlanarak saklanır.

## Veri ve yedekleme

Tüm veriler sunucudaki `data/db.json` dosyasındadır (atomik yazma). Bu dosyayı kopyalamak
tam yedek almak demektir; ayrıca **Ayarlar → Yedek Al (JSON)** ile indirilebilir.

## Bilinen sınırlar

* **TCMB otomatik kur:** Servis tarayıcıya CORS başlığı göndermediğinden doğrudan çekim
  engellenebilir; bu durumda manuel kur geçerli kalır (PRD §11).
* **Tek sunucu:** Sistem tek makinede çalışır; ağdaki diğer bilgisayarlardan erişim için
  sunucunun IP adresi ve güvenlik duvarı ayarı gerekir. HTTPS kullanılmıyorsa yerel ağ
  dışına açmayın.
