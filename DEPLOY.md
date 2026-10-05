# Kurulum: cPanel + Firebase

Uygulama iki ortamda da aynı dosyalarla çalışır:

| Ortam | Arka uç | Veri nerede? |
| --- | --- | --- |
| Kendi bilgisayarı / sunucu (`npm start`) | Node sunucusu | `data/db.json` |
| Paylaşımlı hosting (cPanel) | Firebase | Firebase Realtime Database |

Hangisinin kullanılacağına `src/app-config.js` karar verir. `backend: 'auto'`
(varsayılan) ayarında uygulama açılırken yanında bir `/api` ucu arar: varsa Node
sunucusu, yoksa Firebase kullanılır. Yani cPanel'e yüklemek için kodda
değişiklik yapmak gerekmez.

---

## 1. Firebase tarafı (bir kez)

### 1.1 Proje ve web uygulaması

1. [Firebase Console](https://console.firebase.google.com/) → projenizi açın
   (bu depodaki ayarlar `gelir-gider-3a491` projesine aittir).
2. **Proje ayarları → Genel → Uygulamalarınız → Web** bölümünden
   `firebaseConfig` değerlerini kopyalayın.
3. `src/app-config.js` içindeki `firebase` bloğunu bu değerlerle güncelleyin.
   `databaseURL` alanını da yazmayı unutmayın:

   ```js
   databaseURL: 'https://<proje-adi>-default-rtdb.firebaseio.com/',
   ```

> Bu değerler tarayıcıya açıktır, gizli bilgi değildir. Güvenlik, aşağıdaki
> veritabanı kurallarıyla sağlanır.

### 1.2 Realtime Database

1. **Build → Realtime Database → Veritabanı oluştur** (bölge: Avrupa önerilir).
2. Başlangıçta "kilitli mod"u seçin.
3. **Kurallar** sekmesine geçin ve bu depodaki `database.rules.json` dosyasının
   içeriğini olduğu gibi yapıştırıp **Yayınla**'ya basın.

Kurallar şunu sağlar:

* Oturum açmamış hiç kimse veriyi okuyamaz/yazamaz.
* Devre dışı bırakılmış (`active: false`) hesap hiçbir şey yapamaz.
* Her koleksiyona yazma, kullanıcının o modül yetkisine bağlıdır
  (ör. gider faturası yazmak için `giderFaturalari`).
* Kullanıcı kayıtlarını ve ayarları yalnızca yönetici değiştirebilir.
* İşlem kaydı (`auditLog`) yalnızca eklenebilir; kullanıcı kendi geçmişini silemez.
* Hiç kullanıcı yokken giriş yapan ilk hesap kendisini yönetici olarak
  kaydedebilir (ilk kurulum). Sonrasında bu kapı kapanır.

### 1.3 Kimlik doğrulama (Authentication)

1. **Build → Authentication → Başlayın**.
2. **Sign-in method** → **E-posta/Şifre**'yi etkinleştirin.
3. **Users → Kullanıcı ekle** ile ilk yönetici hesabını açın.
   Kullanıcılar sisteme kullanıcı adıyla girer, Firebase ise e-posta ister;
   bu yüzden e-postayı `kullanıcıadı@otel.local` biçiminde yazın:

   | Giriş ekranına yazılan | Firebase'deki e-posta |
   | --- | --- |
   | `admin` | `admin@otel.local` |
   | `mehmet` | `mehmet@otel.local` |

   Alan adını değiştirmek isterseniz `src/app-config.js` → `loginDomain`.
   E-posta adresiyle giriş yapmak da çalışır (`@` içeren değer olduğu gibi kullanılır).
4. **Settings → Authorized domains** listesine kendi alan adınızı ekleyin.

İlk girişte, veritabanında hiç kullanıcı kaydı yoksa bu hesap otomatik olarak
**yönetici** olarak tanımlanır. Diğer kullanıcıları şu iki adımda ekleyin:

* Uygulamada **Yönetim → Kullanıcı ve Yetki** ekranından kullanıcıyı ve
  yetkilerini oluşturun (hesap Firebase'de de açılır),
* kullanıcı ilk girişinde şifresini değiştirir.

> Bir kullanıcıyı silmek, uygulamada erişimini kapatır (`active: false`).
> Kimlik kaydını tamamen kaldırmak için Firebase Console → Authentication →
> ilgili satır → **Kullanıcıyı sil**.

---

## 2. cPanel tarafı

### 2.1 Yüklenecek dosyalar

Yalnızca istemci tarafı gerekir:

```
index.html
.htaccess
src/            (tüm klasör)
```

Yüklenmesi **gerekmeyen** klasörler: `server/`, `scripts/`, `test/`, `data/`,
`node_modules/`, `package.json`. (`.htaccess` bunlara erişimi zaten kapatır.)

### 2.2 Adımlar

1. cPanel → **Dosya Yöneticisi** → `public_html`.
2. Depoyu ZIP olarak indirip yükleyin ve **Extract** ile açın; ardından
   gereksiz klasörleri silin. (Veya yalnızca yukarıdaki üç öğeyi yükleyin.)
3. `.htaccess` dosyasının `public_html` içinde olduğundan emin olun
   (Dosya Yöneticisi → Settings → *Show hidden files*).
4. cPanel → **SSL/TLS Status** üzerinden ücretsiz sertifikayı kurun, sonra
   `.htaccess` dosyasının sonundaki HTTPS bloğunu yorumdan çıkarın.
5. Alan adınızı tarayıcıda açın. Karşılama sayfası görünür, **Giriş Yap** ile
   Firebase hesabınızla oturum açarsınız.

Uygulamayı bir alt klasöre (`public_html/otel`) koyarsanız da çalışır; yollar
sayfaya görelidir.

### 2.3 Güncelleme

Yeni sürümde yalnızca `index.html` ve `src/` klasörünü üzerine yazın.
`.htaccess` `index.html` dosyasını önbelleğe almadığı için değişiklikler ilk
açılışta görünür; tarayıcı eski JS dosyalarını tutuyorsa <kbd>Ctrl</kbd> +
<kbd>F5</kbd> yeterlidir.

---

## 3. Firebase modunda neler değişir?

| Konu | Node sunucusu | cPanel + Firebase |
| --- | --- | --- |
| Veri dosyası | `data/db.json` | Realtime Database (`/data`) |
| Oturum | Sunucu çerezi | Firebase kimlik jetonu (tarayıcıda saklanır, otomatik yenilenir) |
| Şifreler | Sunucuda hash'li | Firebase Authentication |
| Excel içe/dışa aktarım | Sunucuda üretilir | Tarayıcıda üretilir (aynı biçim, aynı doğrulama) |
| Mükerrer fatura kontrolü | `src/core/importPlan.js` | aynı dosya |
| Kur çekme | TCMB / ECB (sunucu) | Frankfurter (ECB) / exchangerate.host — tarayıcıdan erişilebilen kaynaklar |
| Yedekleme | Sunucu klasörü + otomatik yedek | "Anlık Yedeği İndir" + Firebase Console → Realtime Database → *JSON dışa aktar* |

Yedek dosyası biçimi iki ortamda aynıdır (`src/core/backupFormat.js`), bu yüzden
Node sunucusunda alınan bir yedek Firebase kurulumuna, oradaki yedek de Node
sunucusuna geri yüklenebilir.

### Kur çekme hakkında

TCMB ve ECB uçları tarayıcıdan doğrudan çağrılamaz (CORS izni vermezler).
Firebase modunda bu yüzden CORS'a açık kaynaklar kullanılır. Kaynaklar
erişilemezse kur **elle** girilebilir: **Ayarlar → Döviz Kuru Defteri →
"💾 Kuru Ekle"**. Kur kaydı olmayan bir tarihte döviz faturası kaydedilmek
istendiğinde sistem o günün kurunu sorar; mühürlenen kur sonradan değişmez.

---

## 4. Sorun giderme

| Belirti | Sebep / çözüm |
| --- | --- |
| "Failed to load module script" | `.htaccess` yüklenmemiş; `.js` dosyaları yanlış MIME türüyle sunuluyor. |
| Giriş ekranında "Kullanıcı adı veya şifre hatalı" | Firebase'de hesap `kullanıcıadı@otel.local` biçiminde açılmamış olabilir. |
| "Bu hesap sistemde tanımlı değil" | Firebase'de hesap var ama veritabanında kullanıcı kaydı yok. Yönetici, **Kullanıcı ve Yetki** ekranından kullanıcıyı tanımlamalı. |
| "Bu işlem için yetkiniz bulunmuyor" | Veritabanı kuralları ilgili modül yetkisini görmüyor; kullanıcının yetkilerini kontrol edin. |
| Veriler boş görünüyor | `src/app-config.js` → `databaseURL` yanlış veya kurallar yayınlanmamış. |
| Sayfa Node sunucusuna bağlanmaya çalışıyor | `backend: 'firebase'` olarak sabitleyin. |
