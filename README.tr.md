<div align="center">

# Vex

### Tam size göre yapılmış bir tarayıcı.

Electron + Chromium üzerine kurulu; hızlı, gizli ve ayrıntısına kadar özelleştirilebilir bir masaüstü tarayıcısı. Yerleşik yapay zekâ ajanı, gerçek DRM'li yayın, Tor ve sansür aşma, parola/2FA/e‑posta kodu otomatik doldurma, kenar çubuğu uygulamaları, bölünmüş ekran ve piksel piksel yeniden düzenleyebileceğiniz bir arayüz sunar.

[![Son sürüm](https://img.shields.io/github/v/release/0xmortuex/Vex?label=indir&style=flat-square)](https://github.com/0xmortuex/Vex/releases/latest)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue?style=flat-square)
![Lisans](https://img.shields.io/badge/license-MIT-green?style=flat-square)

**[⬇ Son sürümü indirin](https://github.com/0xmortuex/Vex/releases/latest)** · **[🌐 Web sitesi](https://0xmortuex.github.io/vex-website/)** · [English](README.md)

</div>

---

## Vex nedir?

Vex, [castLabs Electron](https://github.com/castlabs/electron-releases) üzerinden çalışan bir Chromium masaüstü tarayıcısıdır; bu yüzden **Widevine DRM çalışır** — Netflix, Spotify, Prime ve Disney+ oynatılır. Reklamsız, hafif bir tarama çekirdeğini alışılmadık derecede geniş bir yerleşik araç takımıyla birleştirir: sekmelerinizde iş yapabilen bir yapay zekâ yardımcısı, kenar çubuğu uygulama panelleri, Tor ve DPI aşma ile gizlilik, şifreli eşitleme ve her şeyi özelleştirebileceğiniz bir arayüz. Hiçbiri ücretli eklenti değildir; hepsi tarayıcının içindedir.

> **Windows 10/11 · 64 bit.** İmzalı sürümü [Sürümler](https://github.com/0xmortuex/Vex/releases/latest) sayfasından kurun (DRM/Widevine yalnızca imzalı sürümde çalışır). Vex kendini uygulamanın içinden günceller.

## Türkçe kullanım

Vex varsayılan olarak İngilizcedir; Türkçeyi kendiniz seçersiniz, Windows'un dilinden otomatik olarak seçilmez. Kurulum sihirbazının ilk adımında **English | Türkçe** seçeneği vardır. Sonradan **Ayarlar → Genel → Dil**’den de değiştirebilirsiniz.

Türkçe seçildiğinde şunlar Türkçe olur:

- Tüm arayüz, ayarlar, kurulum sihirbazı ve özellik kitaplığı (adlar, açıklamalar, adım adım anlatımlar).
- Arka planın gösterdiği hata iletileri ve Windows'un kendi iletişim kutuları (dosya seçici, "Vex yanıt vermeyi bıraktı" vb.).
- Yeni Sekme sayfası, tarih ve saatler.
- Güncelleme ekranında ve GitHub sürüm sayfalarında sürüm notları (her sürümün Türkçe bölümü vardır).
- Windows'ta Vex'i varsayılan uygulama olarak gösteren yazılar, kurulumu Türkçe Windows'ta çalıştırdığınızda.

Çevrilemeyenler: açtığınız web sitelerinin kendi metinleri (bunun için sayfa çevirisini kullanın), kaynak koddaki yorumlar ve geliştirici belgeleri.

## Öne çıkanlar

- 🧠 **Yerleşik yapay zekâ ajanı** — sayfalarınız üzerinde sohbet, "tüm YouTube sekmelerini kapat" gibi düz Türkçe/İngilizce komutlar, ekran görüntüsünden koda, özetleme/çeviri, okuduğunuz her şeyde içerik araması. Bulut (kendi Claude Worker'ınız), yerel (Ollama) ya da tamamen cihazda (WebGPU).
- 🔒 **Varsayılan olarak gizli** — reklam ve izleyici engelleme (ağ *ve* görünüm), parmak izi koruması, DNS‑over‑HTTPS, yalnızca HTTPS, tek tıkla Tor ve DPI/sansür aşma vekili — VPN yok, yönetici izni yok.
- ▶️ **Gerçek yayın** — Netflix/Spotify/Prime/Disney+ için Widevine DRM, ayrıca kısa video siteleri için kodek yedekleri.
- 🎨 **Size göre yapılmış tarayıcı** — tüm araç çubuğunu ve kenar çubuğunu sürükleyerek düzenleyin, Klasik ya da buzlu **Glass** arayüz, site başına profiller, paylaşılabilir düzenler, temalar.
- 🧩 **Kenar çubuğu uygulamaları** — Discord, WhatsApp, Spotify, Netflix, Claude, GitHub, Roblox ve sabitlediğiniz her site; her biri kendi yalıtılmış oturumunda, okunmamış rozetleriyle.
- 🔐 **Gerçekten çalışan otomatik doldurma** — şifreli parola kasası, otomatik doldurmalı yerleşik 2FA kimlik doğrulayıcı ve e‑posta doğrulama kodu doldurma.
- 💤 **Kaynakları az kullanır** — boştaki sekmeleri otomatik uyutma/dondurma (güvenebileceğiniz bir "asla uyutma" ile), bellek tavanı koruması ve Sekme Sağlığı panosu.

### Eski tarayıcınızdan taşınma

Vex, Chrome, Edge, Brave, Firefox, Opera ve Opera GX'ten yer imlerini ve geçmişi bu bilgisayarda okuyarak içe aktarır. Parolalar, o tarayıcının kendi parola yöneticisinden dışa aktardığınız bir CSV dosyasıyla gelir; Vex başka bir tarayıcının şifreli depolarını hiçbir zaman açmaz. Bu, kurulum sihirbazında ("Eşyalarınızı getirin" adımı) bulunur.

## Sık kullanılan kısayollar

| Kısayol | İşlem | | Kısayol | İşlem |
|---|---|---|---|---|
| `Ctrl+K` | Komut çubuğu | | `Ctrl+T` / `Ctrl+W` | Yeni / sekmeyi kapat |
| `Ctrl+Shift+T` | Kapatılan sekmeyi geri aç | | `Ctrl+Tab` | Sonraki sekme |
| `Ctrl+L` | Adres çubuğuna odaklan | | `Ctrl+F` | Sayfada bul |
| `Ctrl+Shift+S` | Bölünmüş ekran | | `Ctrl+Shift+P` | Resim içinde resim |
| `Ctrl+Shift+A` | Yapay zekâ paneli | | `Ctrl+D` | Yer imi |
| `Ctrl+Alt+N` | Gizli pencere | | `Ctrl+Alt+H` | Patron tuşu — tüm pencereleri gizle/göster |

Kısayolların çoğu **Ayarlar → Klavye Kısayolları** bölümünden değiştirilebilir. Tam liste için [İngilizce README](README.md#keyboard-shortcuts)'ye bakın.

## Yapay zekâ kurulumu (kendi altyapınızı getirin)

Bulut yapay zekâ, seçtiğiniz istemi ve sayfa bağlamını yapılandırdığınız Worker'a ve model sağlayıcıya gönderir. **Kendi** Cloudflare Worker'ınızı kurun ve adresiyle istemci anahtarını **Ayarlar → Bulut Hizmetleri**'nde girin; bkz. [SELF_HOSTING.md](SELF_HOSTING.md). Başka seçenekler:

- **Yerel** — [Ollama](https://ollama.com) kurun; Vex ona `localhost:11434` üzerinden bağlanır.
- **Cihazda** — WebGPU, model ve çalışma dosyaları indirildikten sonra çıkarımı bilgisayarınızda yapar.

Eşitleme de aynı şekilde sizin kendi barındırdığınız Worker'ı kullanır.

## Kaynaktan derleme

> Windows ve CI'ın kullandığı [Node.js](https://nodejs.org) 22 gerekir; paket yöneticisi **npm**'dir (pnpm ya da yarn değil).

```bash
git clone https://github.com/0xmortuex/Vex.git
cd Vex
npm install
npm start          # geliştirme sürümünü çalıştırır
npm test           # testleri çalıştırır (vitest)
```

castLabs hesabı olmadan Windows yükleyicisi derlemek için Widevine (VMP) imzalama adımını atlayın; derleme bunun dışında aynıdır ama DRM'li oynatma (Netflix, Spotify…) çalışmaz:

```powershell
$env:VEX_SKIP_VMP_VERIFY = "1"; npm run dist:win
```

Sürüm yayımlama için bkz. [RELEASING.md](RELEASING.md).

## Lisans ve gizlilik

- [Lisans](LICENSE) — MIT © [0xmortuex](https://github.com/0xmortuex)
- [Gizlilik](PRIVACY.md) — Vex'in ne gönderdiği, nereye gönderdiği ve nelerin bilgisayarınızda kaldığı. Analitik yok, telemetri yok.
- [Kullanım şartları](TERMS.md)
- [Üçüncü taraf bildirimleri](THIRD_PARTY_NOTICES.md)

Her özelliğin tam listesi İngilizce [README](README.md)'de ve Vex'in içindeki **Kitaplık**'ta (Türkçe) yer alır.

<div align="center"><sub>Vex — tam size göre yapılmış bir tarayıcı.</sub></div>
