# Değişiklik günlüğü (Türkçe)

Bu dosya CHANGELOG.md’nin Türkçesidir. Vex Türkçe olduğunda “Yenilikler” kartı ve pencereleri bu metinleri gösterir; bir sürümün Türkçesi burada yoksa İngilizcesi gösterilir. Başlık biçimi İngilizce dosyayla aynıdır (`## v<sürüm> (tarih) — Başlık`), `(feature: kimlik)` etiketleri olduğu gibi kalır.

## v42.74.8 (2026-10-29) — 3D Aim Trainer Quick Play çalışıyor: oyun seçilebiliyor ve göremediğiniz videoların üstünde resim içinde resim düğmesi çıkmıyor

### Düzeltildi
- **Google’ın etiket betiğini denetlemeden kullanan siteler artık bozulmuyor.** Vex, Google Tag Manager ve Analytics’i engeller; betiğin yüklenip yüklenmediğini denetlemeden `dataLayer`’a veri ekleyen ya da `gtag` çağıran bir sayfa hata verip duruyordu. app.3daimtrainer.com/quick-play’de hiçbir oyun seçilemiyordu, çünkü tıklama işleyicisi `dataLayer.push` satırında çöküyordu. Vex böyle bir betiği engellediğinde sayfaya artık hiçbir şey yapmayan boş bir `dataLayer` ve `gtag` veriyor, yine de Google’a hiçbir şey göndermiyor. Gerçek uygulamada denendi: oyunu seçip Atla’ya basmak artık alıştırma listesine ulaşıyor. Deneyin: app.3daimtrainer.com/quick-play’i açın ve bir oyun seçin.
- **Göremediğiniz bir videonun üstünde resim içinde resim düğmesi çıkmıyor.** Vex, sayfadaki her video için mavi PiP düğmesini sunuyordu; tam pencere bir ekranın altında gizli kalan videolar için bile. Bu yüzden app.3daimtrainer.com/quick-play’de işaretçinin gittiği her yerde boş alanda mavi kareler beliriyor, birine basınca gizli video görünüyordu. Soluklaştırılmış ya da kendisinden çok daha büyük, düz renkli bir katmanın altındaki video artık düğme almıyor. Normal görünen bir video ve kendi tıkla-durdur katmanı olan bir oynatıcı düğmeyi almaya devam ediyor. Gerçek uygulamada denendi: önceden düğme, gizli videoların üstündeki 6 işaretçi konumunun 5’inde çıkıyordu; şimdi hiçbirinde çıkmıyor. Deneyin: app.3daimtrainer.com/quick-play’i açın ve işaretçiyi gezdirin.

## v42.67.2 (2026-10-28) — Vex çok daha az bellek kullanıyor: arayüz penceresi, reklam engelleyici ve Ayarlar

### Yeni
- **Claude eklentisi sizin yerinize gezebiliyor, anahtar sizde.** Ayarlar > Eklentiler’de Claude kartında “Diğer sekmeleri denetlemesine izin ver” anahtarı var; siz açana kadar kapalı. Açıkken eklenti sekmelerinizi tarayıcının gerçek hata ayıklama protokolüyle yönetir (sayfa okuma, tıklama, yazma, ekran görüntüsü). Tuttuğu her sekmede adını ve bir Durdur düğmesini gösteren bir çubuk görünür; Durdur, sekmeyi kapatmak, anahtarı kapatmak ya da eklentiyi kaldırmak onu hemen bırakır. Gizli ve Tor sekmelerine asla ulaşmaz. Bir eklenti anahtar kapalıyken bir sekmeyi yönetmeye ilk kez kalkıştığında Vex size kendi kutusunda sorar (on dakikada bir) ve İzin ver anahtarı açar; önceden sadece başarısız oluyordu ve Claude “Working” üzerinde kalıyordu. Deneyin: Claude’dan bir web sitesi açmasını isteyin ve İzin ver’e basın.
- **Eklentiler için sekme grupları, geçmiş ve ekran görüntüleri.** Bir eklenti artık Vex’in kendi sekme gruplarını oluşturabilir, adlandırabilir, renklendirebilir, taşıyabilir, daraltabilir ve dağıtabilir; bir sekmede geri ve ileri gidebilir, görünen sekmenin ekran görüntüsünü alabilir ve geçmişini kaybetmeden bir sekmeyi başka adrese götürebilir.
- **Eklentinin yan paneli sayfanın yanında açılıyor.** Claude’un paneli, açıldığı sekmenin sağına yerleşir, genişliğini hatırlar, sürüklenerek genişletilip daraltılabilir ve kendi düğmesiyle kapanır. Tüm pencereyi değil, kendi sekmesini izler.
- **Claude oturum açabiliyor.** Eklentinin oturum açması (chrome.identity.launchWebAuthFlow) artık çalışıyor: Vex oturum açma sayfasını eklentinin kendi oturumunda gizli bir pencerede açar ve sayfa eklentiye yönlendirilince bitirir. Vex’te zaten açık olan hesabı kullanır; açık değilse eklenti bunu söyler ve Giriş yap düğmesi giriş sayfasını açar.
- **Bir eklentinin adını verdiği web sitesi ona mesaj gönderebiliyor.** Eklentiler hangi sitelerin kendileriyle konuşabileceğini söyleyebilir (Claude claude.ai’yi söyler). Electron bu mesajları hiç iletmiyordu: hepsi “Receiving end does not exist” ile başarısız oluyordu; bu yüzden Claude’un paneli “Can’t reach the Claude extension” diyordu ve claude.ai giriş sayfası oturumu eklentiye geri veremiyordu. Vex artık bunları iletiyor; yalnızca eklentinin bildiriminde adı geçen siteler için, gizli ve Tor sekmelerinde asla. Deneyin: Bir sayfada Claude’un yan panelini açın.
- **Eklentiler, bir anahtarın arkasında, bu bilgisayardaki programlarla konuşabiliyor.** Bir eklentinin kartındaki “Bu bilgisayardaki programlarla konuşmasına izin ver” anahtarı (siz açana kadar kapalı), eklenti için kurulum programlarının kaydettiği programları başlatmasına izin verir; Claude Code’un tarayıcı köprüsü Claude eklentisi için kaydedilmiştir. Vex yalnızca kaydı o eklentiyi adıyla anan programı başlatır ve anahtarı kapattığınızda, eklentiyi kaldırdığınızda ya da çıktığınızda hepsini durdurur.

### Değişti
- **Arayüz penceresi yarıdan az bellekle açılıyor.** Ayarlar’a bölüm ekleyen her modül, Vex henüz açılırken o ana kadar kayıtlı tüm bölümleri çiziyordu: yaklaşık 18.000 gizli sayfa öğesi ve bir yığın artık. Bölümler artık Ayarlar’ı açtığınızda çiziliyor. Yeni paketlenmiş bir Vex’te arayüz penceresi 266 MB’tan 130 MB’a, Vex’in tamamı 581 MB’tan 447 MB’a indi. Vex ayrıca çok daha çabuk açılıyor (başlangıç testi 18,0 sn’den 4,6 sn’ye düştü). Ayarlar’ın ilk açılışı yaklaşık 80 ms uzadı; içindeki her şey, arama ve Türkçe başlıklar dahil, aynı.
- **Ayarlar’dan çıkınca belleğini geri veriyor.** Ayarlar’ı kapattıktan bir dakika sonra bölümleri sayfadan alınıyor (yaklaşık 57 MB), açtığınızda yeniden çiziliyor. Art arda açışlarda sınandı: hiçbir şey birikmiyor.
- **Reklam engelleyici artık listelerinin ağır bir kopyasını bellekte tutmuyor.** İlk açılıştan sonra ve süzgeç listelerinin haftalık yenilenmesinden sonra Vex, yeni çözümlenmiş listeleri bir sonraki yeniden başlatmaya kadar tutuyordu: ana işlemde yaklaşık 100 MB. Artık önbelleğindeki kompakt biçimi kullanıyor (ana işlemin başlangıçtan 30 saniye sonraki betik belleği 123-135 MB’tan 32 MB’a indi). Öncekiyle aynı istekleri engelliyor.

### Düzeltildi
- **Claude eklentisinin araç çubuğu düğmesi yeniden çalışıyor.** Düğmeye tıklamak “Claude tıklamayı almadı: Failed to start service worker” diyordu. Arka plan betiği, Vex’te olmayan tarayıcı özelliklerini (sekme grupları, hata ayıklayıcı, yan paneller, ekran dışı sayfalar, oturum açma) okuyordu ve yüklenirken duruyordu. Vex artık bunları sağlıyor (bkz. Yeni): eklenti başlıyor ve düğme panelini açıyor. Bu, bu izinleri isteyen her eklentiye yardımcı olur. Deneyin: Araç çubuğundaki Claude düğmesine tıklayın.
- **Claude çalıştığı sekmeyi açabiliyor.** Claude’dan “youtube’u aç” demek “Opening youtube.com” satırında takılıyordu: çalışma sekmesini chrome://newtab adresiyle yeni bir pencerede açıyor, Vex bunu reddediyordu ve Vex’in yanıtı açtığı sekmeyi bildirmiyordu. Artık Vex’in Yeni Sekme sayfasını açıyor ve hangi sekme olduğunu söylüyor. Deneyin: Claude’dan bir web sitesi açmasını isteyin.
- **Claude’un görevleri başlayabiliyor.** Her görev “anchor tab group not established” ile bitiyordu: Electron yan panelin web görünümünü bir sekme sayıyor, bu yüzden panelin eklentiye mesajları bir sekmeyle geliyordu ve Claude’un çalışanı bunu reddediyor (Chrome’un yan panelinde sekme yoktur). Vex artık eklentinin yan panel olarak bildirdiği sayfalar için sekmeyi çıkarıyor. Deneyin: Claude’dan bir web sitesi açmasını isteyin.
- **Claude’un paneli çalışıyor: “youtube’u aç” YouTube’u açıyor.** Eklentinin arka plan betiği özellik bayraklarını, kendi sayfalarının gönderdiği iki başlık olmadan (`anthropic-client-platform` ve `anthropic-client-version`) istiyordu; sunucu panelin claude.ai görünümünü kapalı olarak yanıtlıyor, çalışanın yanıtı panelin “açık” yanıtının üzerine yazıyordu. Panel kendi mesajlarını reddediyor ve her görev “anchor tab group not established” ile bitiyordu. Vex artık eksik olduğunda eklentinin kendi iki başlığını yalnızca o isteğe ekliyor. Gerçek uygulamada denendi: panelden sohbet kutusuyla YouTube’u açması istendi ve sekme youtube.com’da bitti. Güncellemeden sonraki ilk açılışta, eski yanıtın süresi dolana kadar Claude’un görevlerinin çalışması bir buçuk dakika kadar sürebilir. Deneyin: Claude’dan bir web sitesi açmasını isteyin.
- **Bildirimler artık Claude panelinin mesaj kutusunu örtmüyor.** “Şu sayfada sahip olduklarınız geri yüklendi…” gibi bir bildirim sağ alt köşede, Claude yan panelinde yazdığınız kutunun tam üstünde beliriyordu. Bildirimler artık panelin yanında duruyor. Deneyin: Claude’un yan panelini açın ve bir bildirimin gelmesini bekleyin.

### Denetlendi
- Vex’in paketlenmiş sürümlerinde ikişer kez ve gerçek uygulamada ölçüldü: Ayarlar’ı İngilizce ve Türkçe, aramayla birlikte beş kez kapatıp yeniden açma.
- 18.097 testin tamamı Node 22’de geçti; kaynak denetimi, lint, tipler, duman testi ve arayüz denetimi (1.636 saniye, temiz) de geçti.

## v41.59.4 (2026-10-26) — Ödeme kartları, iki dilde daha akıllı Ctrl+K ve Ayarlar araması, ve artık kaybolmayan arayüz sesleri

### Yeni
- **Ödeme kartları.** Bir sitede ödeme yaptıktan sonra Vex “Bu kart kaydedilsin mi?” diye sorar ve numarayı, adı ve son kullanma tarihini saklar. Başka bir ödeme sayfasında kart numarası kutusuna tıklayıp altındaki küçük listeden bir kart seçin: numara, ad ve son kullanma tarihi dolar, imleç güvenlik kodu kutusuna geçer. Güvenlik kodu (CVV) asla okunmaz, kaydedilmez ya da gönderilmez: kart ağlarının gerektirdiği gibi her ödemede siz yazarsınız. Kartlar Windows tarafından şifrelenen tek bir dosyada, yalnızca bu bilgisayarda tutulur; asla eşitlenmez, özel, Tor ya da yönlendirilen sekmelerde ve düz http sayfalarında kullanılmaz, Vex Kilidi de bunları kapsar. Deneyin: Herhangi bir mağazada ödeme yapın, Vex sorunca Kaydet’e basın, sonra başka bir ödeme sayfası açıp kart numarası kutusuna tıklayın. (feature: payment-cards)
- **Kartları elle ekleyin ve Vex’in tanımadığı formlarda kullanın.** Ayarlar > Ödeme kartları ve Ctrl+K > Ödeme kartları kart ekler, düzenler ve siler. Vex’in tanımadığı bir ödeme sayfasında (çoğu kutularını başka bir sitenin çerçevesinde tutar) kutuya tıklayıp Numarayı yaz, Adı yaz veya Son kullanmayı yaz’a basın; Numarayı kopyala numarayı panoda yalnızca 30 saniye tutar. Bir kutuya sağ tıklayıp “Kayıtlı bir kartı doldur…” seçeneğini de kullanabilirsiniz. Deneyin: Ctrl+K’ya basın, “Ödeme kartları”nı çalıştırın, Kart ekle’ye tıklayın. (feature: payment-cards)
- **Ctrl+K ve Ayarlar araması iki dili ve ne demek istediğinizi anlar.** İngilizce ya da Türkçe yazın, aynı sonuçları alın; eş anlamlılar (“upgrade” güncellemeleri, “gizlilik” Privacy’yi bulur), çoğullar, ekler ve kayan bir tuş (“bookmrks”) çalışır; yazdığınız her kelime bulunmalıdır. Ayarlar artık bölümleri sıralar (önce ad, sonra anahtar kelimeler, etiketler ve metin), eşleşmeleri solda boş bırakmak yerine liste olarak gösterir ve “update” yazınca Gizlilik Sıkılaştırma yerine Vex’i güncellemeyle ilgili bölümleri öne çıkarır. Deneyin: Ayarlar’ı açıp “update”, sonra “güncelleme” yazın.
- **Arayüz seslerinde stil, ton ve düğme basma tıkı var.** Ayarlar > Sesler artık beş stil (Yumuşak, Mekanik, Baloncuk, Atari, Cam), ses düzeyinin yanında bir ton kaydırıcısı, düğmelere basarken tık için bir anahtar, her ses için Dinle düğmesi ve bir sıfırlama sunar. Deneyin: Ayarlar’ı açın, Sesler’i bulun, Mekanik’i seçin ve adres çubuğuna yazın. (feature: ui-sounds)

### Değişti
- Evrensel Form Doldurma metni artık kartların asla saklanmadığını söylemiyor: profili hâlâ kart bilgisi içermez, kayıtlı kartlar ayrı bir özelliktir.

### Düzeltildi
- **Tık sesi artık kaybolmuyor.** Bir web sayfasının üzerinde bırakılan fare düğmesi Vex’in onu hâlâ basılı sanmasına yol açıyordu, bir sayfa klavye odağındayken yazma tıkı reddediliyordu ve Vex açıldıktan sonraki ilk ses henüz çalışmayan bir saate göre planlanıyordu. Üçü de düzeltildi.
- **Yeni Sekme sayfasının arama kutusuna yazmak artık adres çubuğu gibi tıklar.** Sayfa kendi çerçevesinde yaşadığı için Vex’in kendi tuş dinleyicisi onu hiç duymuyordu.
- **Bir araç anahtar kelimelerini tek bir metin olarak verdiğinde Ctrl+K artık tüm araç sonuçlarını düşürmüyor** (gerçek uygulamada bulundu: “join is not a function”).

### Denetlendi
- Kart akışı gerçek uygulamada gerçek fare ve klavye girdisiyle sınandı: kaydetme, şifreli dosya, seçici, doldurma, tanınmayan bir sayfaya yazma ve Ayarlar. 25 denetimin 25’i geçti.
- Sesler gerçek uygulamada sınandı: adres çubuğuna ve Yeni Sekme arama kutusuna yazma, sayfa üzerinde bırakılan bir düğme, beş stilin hepsi ve Ayarlar grubu. 14’ün 14’ü geçti.
- 18.081 testin tamamı Node 22’de geçti; kaynak denetimi, lint, tipler, duman testi ve arayüz denetimi (1.633 saniye, temiz) de geçti.

## v41.19.3 (2026-10-25) — Vex’in kendi görüntüleyicileri (PDF, resim, video ve ses, belge, klasör), akıllı karanlık mod, yazdırma önizlemesi ve Vex Eklenti Mağazası

### Yeni
- **PDF’ler Vex’in kendi görüntüleyicisinde açılıyor.** Chromium’unki yerine: küçük resimler ve içindekiler, arama, yakınlaştırma ve sığdırma kipleri, tek sayfa, kaydırma ve çift sayfa görünümü, döndürme, sunum kipi ve parola istemi var. Temanıza ve görünümünüze uyar, tarayıcınınkinden açıkça farklıdır ve sekmede PDF’in kendi adresi korunur.
- **PDF’e not düşün, formları doldurun.** Vurgulama, altını çizme, üstünü çizme, çizim, metin notu, şekil ve imza ekleyin; geri alma ve yineleme var. Formlar da doldurulabilir. Sonuç bir kopya olarak kaydedilir, özgün dosyanın üzerine asla yazılmaz.
- **PDF görüntüleyici her dosya için sayfanızı ve yakınlaştırmanızı hatırlar;** yalnızca bu bilgisayarda, gizli ve Tor sekmelerinde hiç. Ayarlardan görüntüleyici kapatılabilir, "Tarayıcının görüntüleyicisinde aç" her zaman yanındadır.
- **Tek başına açtığınız bir resim Vex’in resim görüntüleyicisinde açılıyor.** Sığdır, gerçek boyut ve doldur; yakınlaştırma ve sürükleme; döndürme ve çevirme; ayrıntılar paneli (boyut, tür, renk profili ve resim söylüyorsa kamera ile konum; yalnızca burada gösterilir); kopyalama ve kaydetme; aynı klasördeki yan yana resimler ve slayt gösterisi; tam ekran; ve yeni bir kopya kaydeden kırpma ve yeniden boyutlandırma var. Resim asla değişmez. Ayarlar > Resim görüntüleyici’den kapatılabilir.
- **JSON, XML, CSV, Markdown, günlük ve kaynak dosyaları ile kaynak görüntüleme sayfaları Vex’in kendi görüntüleyicisinde açılıyor.** JSON ve XML aranabilir, katlanabilir bir ağaç; CSV sıralanıp süzülebilen bir tablo; Markdown içindekileriyle biçimlenmiş bir sayfa; diğer her şey ise kaydırma, arama, satıra gitme ve büyüyen günlük için sonu izleme sunan numaralı, renkli satırlar. Büyük dosyalar arka planda okunduğu için akıcı kalır. Ayarlar > Belge görüntüleyici bölümünden kapatılabilir.
- **Bir klasör Vex’in kendi sayfasında açılıyor,** Chromium’un düz "Index of" listesi yerine: ada, boyuta, türe ya da tarihe göre sıralama, yazdıkça süzme, ayrıntılar, liste ve gerçek resim önizlemeli büyük simge görünümleri, önizleme bölmesi, istendiğinde klasör boyutu, yeniden adlandırma, yeni klasör ve Geri Dönüşüm Kutusu’na silme, yolu kopyalama, Dosya Gezgini’nde gösterme, dosyayı başka programa sürükleme, sürücüleriyle Bu Bilgisayar ve son klasörler. Yalnızca yazdığınız bir adres, bir yer imi ya da Vex içindeki bir bağlantı için açılır; bir web sayfasındaki bağlantı için asla, gizli ve Tor sekmelerinde de açılmaz. Program, betik veya kısayol tıklamayla ya da Enter ile asla açılmaz. Ayarlar > Klasör tarayıcısı’ndan kapatılabilir.
- **Belge olarak açtığınız videolar ve sesler Vex’in kendi oynatıcısında çalıyor,** temanızın renklerinde: önizlemeli arama çubuğu, 0,25–4 hız, A-B döngüsü, kare kare ilerleme, karenin resmi, resim içinde resim, boyutu/rengi/konumu/gecikmesi ayarlanabilen altyazı (.srt, .vtt, .ass), bölümler, medya tuşları, gece kipi ve her dosyada kalınan yer. Seslerde kapak resmi, spektrum ve klasör sırası var. Chromium’un çözemediği bir biçim artık nedenini söylüyor ve Windows ile aç / İndir seçenekleri sunuyor.
- **Word, Excel, PowerPoint, OpenDocument, RTF ve e-kitap (.epub) dosyaları indirilmek yerine bir görüntüleyicide açılıyor:** başlıkları, tabloları, resimleri, yorumları ve izlenen değişiklikleriyle belgeler; sıralayıp filtreleyebileceğiniz, arayıp CSV olarak kaydedebileceğiniz hızlı bir ızgara olarak elektronik tablolar; notlu ve tam ekran slaytlar; içindekiler, yazı ayarları, arama, vurgular ve kaldığınız yeri hatırlayan bir kitap okuyucusu. Makrolar asla çalıştırılmaz, hiçbir şey bir yere gönderilmez. "Özgün dosyayı indir" her zaman bir tık uzakta; Ayarlar > Belgeler ve e-kitaplar’dan kapatılabilir.
- **İndirmeler için Hızlı bakış.** Bitmiş bir indirmede Boşluk tuşuna basın (ya da göz düğmesini veya sağ tıklamayı kullanın) ve dosyanın içini başka bir program açmadan görün: resimler, PDF’lerin ilk sayfaları, metin, JSON, tablolar, Markdown, ses, video, arşivlerin içindeki adlar ve Office dosyalarının metni. Sol ve Sağ ok indirmeler arasında gezdirir, Esc kapatır, Enter Windows ile açar. Programlar önizlemeden asla çalıştırılmaz.
- **Web siteleri için karanlık mod: açık renkli siteleri ters çevirmek yerine ilk görüntüden itibaren karartır;** fotoğraflar ve logolar doğru görünür, zaten karanlık sayfalara dokunulmaz ve sitenin kendi karanlık düğmesine uyar. Ayarlar > Görünüm’de Kapalı, Siteye göre ya da Listelediklerinizin dışındaki tüm siteler seçilir; parlaklık, karşıtlık, sepya, önizleme ve kuruluysa Dark Reader’a bırakma da var. Eski süzgeç Basit ters çevirme olarak duruyor.
- **Yazdırma önizlemesi.** Ctrl+P sayfaları basılacakları gibi, seçenekleri yanında göstererek açar: yazıcı, kopya sayısı, sayfalar, kâğıt başına sayfa, yön, kâğıt, ölçek, kenar boşlukları, arka plan, üst ve alt bilgi, renk ve sadeleştirilmiş kopya. Yazdır tam bu seçimleri gönderir, PDF olarak kaydet de çizilen dosyayı seçtiğiniz yere yazar.
- **Bir bağlantının üzerine gelince nereye gittiği, sayfanın sol altında ince bir çubukta görünür;** gerçek alan adı kalın yazılır, başka sitelere giden bağlantılar işaretlenir, benzer görünen adresler ve `name@host` hileleri uyarıyla gösterilir.
- **Sayfa yüklenirken ortadaki döner simge yerine araç çubuğunun altında ince bir ilerleme çubuğu görünür** (her sekmenin kendisi; Hareketi azalt açıkken sabit bir çizgi).
- **Web sitelerinde isteğe bağlı ince kaydırma çubukları** (Ayarlar > Görünüm, varsayılan kapalı, site listesiyle): temanın renklerinde ince kaydırma çubukları, sayfanın kendi çubuğunu asla ezmez.
- **Vex Eklenti Mağazası.** 39 eklentilik elle seçilmiş bir raf (YouTube, gizlilik, koyu mod, geliştirici araçları, medya ve fazlası); Eklentiler menüsünden, Ayarlar > Eklentiler’den ya da Ctrl+K > Eklenti mağazasını aç ile açılır. Her kart, eklentinin Vex’te tam mı kısmen mi çalıştığını ve nedenini söyler; Ekle, eklentiyi gerçek kaynağından kurar: paket imzaları denetlenen Chrome Web Mağazası ya da yayıncının kendi GitHub’ı. Vex kopya barındırmaz; böylece geliştiricilerin lisansları ve güncellemeleri onlarda kalır. Ambient Light for YouTube, SponsorBlock, DeArrow, Return YouTube Dislike, Enhancer for YouTube, ImprovedTube, Dark Reader, Stylus, Refined GitHub ve daha fazlası var. Başka bir eklenti için aramaya herhangi bir Chrome Web Mağazası bağlantısı ya da kimliği yapıştırın. Deneyin: Ctrl+K, “eklenti mağazası” yazın, “ambient” arayın, Ekle.
- **Kitaplıkta “Biliyor muydunuz?”.** Çoğu kişinin sormayı hiç düşünmediği özellikler hakkında 45 soruluk yeni bir kategori (“Vex bir sayfayı sesli okuyabilir mi?”, “Bir sekmeyi telefonuma gönderebilir miyim?”, “Bir sitenin benim hakkımda sakladığı her şeyi görebilir miyim?”). Her birinde kısa ve sade bir yanıt, sonra nasıl bulunacağı ve onu çalıştıran bir Dene düğmesi var. Bir işaret henüz denemediklerinizi gösterir ve Kitaplık araması bunları İngilizce ve Türkçe bulur. Deneyin: Kitaplığı açın ve Biliyor muydunuz?’u seçin.
- **Varsayılan olarak açık arayüz sesleri.** Adres çubuğunda ve Ctrl+K’de yazarken yumuşak bir tuş sesi, işaretçi tarayıcının kendi düğmelerine (araç çubuğu, kenar çubuğu, sekmeler, yer imi çubuğu; asla sayfa içeriğine değil) girince net bir tık sesi, sekme açılınca yükselen, kapanınca alçalan iki nota. Oyun modunda, toplantılarda, Odak oturumlarında, gizli ya da arka plandaki pencerede, sürüklerken ve belirlediğiniz sessiz saatlerde susar. Her türü kapatmak ya da sesi ayarlamak için Ayarlar > Sesler. Deneyin: araç çubuğunun üzerine gelin, adres çubuğuna yazın, bir sekme açın.
- **Tek tıkla Gizli pencere.** Araç çubuğunda her görünümde bir maske düğmesi var; Ctrl+K > Yeni Gizli Pencere ve Ctrl+Alt+N aynı pencereyi açar. Her gizli pencere, altta ince bir çubukta bir kez, kapatınca geçmiş, çerez ve oturum bırakmadığını ve bağlantınızı gizlemediğini söyler.

### Değişti
- **Vex Yapay Zekâ yeniden tasarlandı.** Temanızın kendi renkleri ve yazı tipiyle sade, düz bir panel; her renk temasında ve her tarayıcı görünümünde aynı düzen (okunabilirlik 69 temanın hepsinde denetlendi). Sorularınız renk tonlu bloklar, yanıtlar düz metin; kopyala, not al ve yeniden dene düğmeleri artık yanıtın üstüne değil altına geliyor. Kod blokları dil adı ve Kopyala düğmesi olan bir çubukla geliyor. Tek bir yazma kartı: kutunun hemen altında kimin yanıtlayacağı, hangi sekmeleri okuyacağı ve ajanın nasıl soracağı var; menüler pencereden taşmayıp panelin içinde açılıyor. Çalışırken yazıyor noktaları, Yeniden dene düğmeli net bir hata bloğu ve daha derli toplu bir boş sohbet var. Görünüm kaplamaları artık panelin üstüne doku bindirmiyor, emoji benzeri simge kalmadı (üçgenler, oklar ve yıldız çizilmiş simgeler oldu; emoji simgesi olan bir kişilik varsayılan işareti gösteriyor); Ctrl+J hızlı soru çubuğu, ek dosya etiketleri ve ajan kartları da uyumlu. Yapay zekâ paneli artık Türkçe ve Daha büyük yazı açıkken araç çubuğunun altında fazla aşağıdan başlamıyor.
- **Son sekmeyi kapatmak pencereyi kapatır, diğer tarayıcılardaki gibi.** Açık tek sekmede Ctrl+W, sekmenin X’i ya da orta tık, yerine yeni bir sekme açıyordu; bu yüzden Vex’i kapatmanın hızlı bir yolu yoktu. Artık pencere kapanır (kapat düğmesini böyle ayarladıysanız Vex bunun yerine tepsiye iner) ve Kapatılan sekmeyi yeniden aç sekmeyi geri getirir. Toplu bir komutla sekme kapatmak pencereyi hiçbir zaman kapatmaz. Deneyin: bir sekme hariç hepsini kapatın, sonra Ctrl+W’ye basın.
- **Tor ile gizli pencere artık karışmıyor.** Tor düğmesi bir soğan simgesi ve artık Firefox, Chrome ve Safari görünümlerinde de görünür. “Özel yönlendirme” her yerde **Vex’in tamamını Tor ya da vekil sunucu üzerinden yönlendir** adını aldı. Onay kutusu, Tor’u kapatsanız ya da Vex’i yeniden başlatsanız da açık kaldığını ve yeni açılan her gizli pencerenin de bundan geçtiğini söyler; açıkken gizli pencereler “Vex’teki her şey, bu pencere dahil, Tor üzerinden gidiyor” der. Gizli pencere açmak Tor’u kendiliğinden hiçbir zaman başlatmaz.
- **Tor’u kapatmak artık sessizce geri gelmiyor.** Vex’in tamamı Tor’a ayarlıyken Tor ilerleme penceresini iptal ederseniz, Vex bir Doğrudan bağlan düğmesi sunar; çünkü açtığınız her sayfa Tor’u yeniden başlatırdı.

### Düzeltildi
- **Vex açılırken artık varsayılan temayı bir an göstermiyor.** Her açılışta önce krem renkli varsayılan tema ve Klasik görünüm, sonra sizin temanız, sonra sizin görünümünüz geliyordu; çünkü pencere, bunları uygulayan betikler çalışmadan önce çiziliyordu. Vex artık penceresinin nasıl göründüğünü hatırlıyor ve onu ilk kareden itibaren çiziyor (gerçek bir pencerede ölçüldü: yeniden yüklemeden sonra her kare zaten sizin görünümünüz). Deneyin: koyu bir tema ve Firefox görünümünü seçin, sonra Vex’i yeniden başlatın.
- **Gizli pencere artık sizin temanıza ve görünümünüze sahip ve önce koyu bir kutu göstermiyor.** Seçtiğiniz tema ne olursa olsun varsayılan krem temada açılıyordu; çünkü gizli pencerenin kendi depolaması var ve ona yalnızca görünüm söyleniyordu. Artık açıldığı pencerenin görünümü ve temasıyla geliyor, bunları ilk kareden itibaren çiziyor ve yalnızca çizildikten sonra gösteriliyor. Deneyin: koyu bir tema seçin, sonra Gizli pencere düğmesine tıklayın.
- **Yeni sekme artık Yeni Sekme sayfası görünmeden önce beyaz parlamıyor.** Koyu bir temada sayfa alanı, Yeni Sekme sayfası çizilene kadar kısa bir an beyaz bir ekrandı (gerçek bir pencerede ölçüldü: 150 ms ve daha fazla). Artık hemen temanın kendi taban rengini gösteriyor; kenar çubuğunun web panelleri (Discord, WhatsApp, Spotify ve diğerleri) de açılırken aynısını yapıyor.
- **Bir sayfa artık “yükleniyor” durumunda, hiçbir şey yapmayan bir Durdur düğmesiyle takılı kalamıyor.** Bir sayfa çizildikten sonra bir isteği açık tuttuğunda, dönen simge sayfanın üstünde kalıyor, araç çubuğu Durdur’da kalıyor ve Durdur’a basmak hiçbir şey yapmıyordu; oysa geri kalan her şey çalışıyordu. Durdur artık Vex’in yükleme durumunu diğer tarayıcılardaki gibi hemen bitiriyor ve “bitti” sinyali hiç gelmeyen bir yükleme durumunu bir bekçi temizliyor.
- **Ayarlar, sol taraftaki listeyi seçmiş olsanız bile nadiren bölüm menüsü sekme olarak açılabiliyordu.** Düzeni değiştirmek menünün taşınmasını istiyordu ve bu taşımanın ikinci adımı bazen hiç yapılmıyordu. Artık düzen bitene kadar yeniden isteniyor.

### Denetlendi
Gerçek uygulamada, geçici bir profilde açıldı: mağaza (arama, gerçek kurulum onay kutusu, Kuruldu ve Kaldır, yapıştırılan bir bağlantı, Firefox ve Cam görünümleri ve Türkçe); eklentilerinden 33’ü hedef sitelerinde kurulup denendi, çalışmayanlar rafa konmadı; sesler (29 denetim: varsayılanlar, olay başına bir ses, her sessiz kipte sessizlik, 11 simge üzerinde gezinmede 2 tık); Gizli pencere düğmesi altı görünümün hepsinde çakışmadan, gerçek bir gizli pencere ve çubuğuyla açıldı ve hiçbir Tor süreci başlamadı. Bir insan tarafından dinlenmedi: seslerin ne kadar yüksek ve hoş olduğu; ve gizli pencere çubuğunun Tor ve vekil sunucu sürümleri, bunları yalnızca birim testleri kapsıyor. Görüntüleyiciler, geçici bir profilde gerçek paketlenmiş bir sürümde açıldı: 23 çeşit dosya (PDF, resimler, JSON, CSV, Markdown, metin ve günlükler, video, ses, Word, Excel, PowerPoint, e-kitaplar, bir klasör), hem web’den hem bu bilgisayardan; her biri kendi görüntüleyicisinde, sekme dosyanın kendi adresini koruyarak, Firefox görünümünde ve koyu bir temada; Hızlı bakış, yazdırma önizlemesi, karanlık mod, yükleme çubuğu, bağlantı çubuğu ve ince kaydırma çubukları gerçek tıklama ve tuşlarla denendi. Bu, sürümden önce şunları buldurdu ve düzelttirdi: düz liste olarak açılan bir klasör, dosyalarını yükleyemeyen bir klasör sayfası, kapatılamayan bir yazdırma önizlemesi, ses ya da video çalamayan Hızlı bakış ve bu bilgisayardan açılınca tüm uygulamayı donduran bir Word dosyası. Gerçek uygulamada henüz denenmedi: yayın ya da DRM’li bir videonun oynatılması (oynatıcı bunlara hiç dokunmaz), gerçek bir yazıcı, her görüntüleyici için Tor ve gizli sekmeler (yalnızca testlerde denetlendi) ve her görüntüleyicide ekranda Türkçe.

## v37.90.9 (2026-10-24) — PDF’ler Vex’te yeniden açılıyor ve Electron’un en yeni güvenlik sürümü kullanılıyor

### Düzeltildi
- **Bir PDF boş, koyu bir sayfa olarak açılıyordu.** Her sitedeki her PDF, belge yerine boş koyu bir sekme gösteriyordu. Vex’in kendi sayfa betikleri yerleşik PDF görüntüleyicinin içinde çalışıp görüntüleyicinin kendi nesnelerini değiştiriyordu; bu da hiçbir şey çizmesini engelliyordu. Artık görüntüleyiciye dokunmuyorlar. Deneyin: bir sekmede herhangi bir PDF bağlantısını açın, örneğin bir okul ya da kamu belgesi; sayfa, küçük resimler ve araç çubuğu (yakınlaştırma, yazdırma, indirme) Chrome’daki gibi görünür.

### Güvenlik
- **Vex, kullandığı Electron’un en yeni güvenlik sürümüyle çalışıyor (42.11.18, hâlâ Chromium 148).** Önceki sürümün yayımlanmış sekiz sorunu vardı; bunların arasında web sitesi izinlerinin (USB ve diğer aygıtlar, işaretçi kilidi, başka uygulamaları açma) yanlış siteye yazılması ve bağlantıdan açılan pencerelere bir çerez kuralının uygulanmaması da var. Vex’in kullandığı ağ kitaplığı (undici) da yayımlanmış üç sorun için güncellendi.

### Denetlendi
Gerçek uygulamada, yeni Electron ile açıldı: bir okul sitesinden sekiz sayfalık Türkçe bir yönerge ve bir sayfalık bir deneme PDF’i; ikisi de küçük resimleriyle eksiksiz çizildi. Vex’in sayfa betikleri tek tek çıkarılarak bulundu; ikisi de tek başına PDF’i bozmaya yetiyordu, ve yeni bir test değişiklik olmadan başarısız oluyor. Bu iki betiği okuyan testlerin hepsi geçiyor.

## v37.85.6 (2026-10-23) — Araç çubuğundaki YZ düğmesi artık yalnızca bir simge ve Ayarlar açıldıktan sonra yanlış menüyle kalmıyor

### Değişti
- **Araç çubuğundaki YZ düğmesi, yanındaki düğmeler gibi bir simgedir.** Simgenin yanında “AI” yazısı da görünüyordu. Yazı kalktı; üzerine gelince hâlâ “Toggle AI Panel” (YZ panelini aç/kapat) yazar, ekran okuyucular “Yapay zekâ paneli” diye okur. Altı görünümün hepsinde denetlendi.

### Düzeltildi
- **Ayarlar, bölüm menüsü yanlış biçimde kalarak açılabiliyordu.** Ayarlar açılırken bloklar, bölümler dolduktan sonra bir kez yerleştirilir. Bu son yerleştirme menüyü (üstte sekmeler ya da solda liste) veya sütun sayısını değiştirmek zorundaysa işi bitirmiyordu; böylece listeyi istediğiniz yerde sekmeler, ya da tersi görünebiliyordu. Artık düzen bitene kadar yerleştirmeye devam eder; bölümlerin dolması saniyeler süren yavaş bir bilgisayarda da bloklar, en sonda değil, arada sırada yerlerine konur, birbirinin üstünde kalmaz.

### Denetlendi
Düzen bekletmesinin testleri (biri yeni) ve kullanıcı arayüzü denetimi (artık ölçmeden önce Ayarlar düzeninin yerleşmesini bekliyor) ve işlemci üç kat yavaşlatılmış Ayarlar düzenleri: orada görünen çakışmalar ve boşluklar kalktı (on bir düzen, hiçbir şey işaretlenmedi).

## v37.84.8 (2026-10-22) — Kurulum sihirbazında başka bir tarayıcıdan eşyalarınızı getirme ve Vex’in geri kalanı Türkçe: sürüm notları, özellik kitaplığı, iletiler ve Windows iletişim kutuları

### Yeni
- **Kurulum sihirbazı, başka bir tarayıcıdan eşyalarınızı getirmeyi önerir.** Karşılamanın hemen ardından gelen yeni bir adım (kısa sürümde de) yer imleri, geçmiş ve kayıtlı parolalar için içe aktarma penceresini açar ve web sitelerinin neden yine de bir kez oturum açmanızı istediğini söyler: tarayıcılar açık oturumlarını kendilerine saklar ve Vex başka bir tarayıcının çerezlerini ya da parola deposunu asla okumaz; ama parolalarınız içe aktarıldığında bu oturum açma tek tıktır. Deneyin: Ctrl+K’ye basın, “Kurulum sihirbazı”nı çalıştırın ve 2. adıma bakın.
- **Opera GX ve Opera’dan parolalar.** İçe aktarma penceresinin parola bölümü onları dışa aktarma adımlarıyla listeler (opera://settings/passwords, sonra Parolaları dışa aktar). Dışa aktarılan her dosya zaten kabul ediliyordu; liste onları sunmuyordu. Deneyin: Ctrl+K’ye basın, “Başka bir tarayıcıdan içe aktar”ı çalıştırın ve Parolalar altındaki listeyi açın.
- **Her sürüm için Türkçe sürüm notları.** Vex Türkçe olduğunda güncelleme kapağı, “Yenilikler” kartı ve penceresi, Tekrar hoş geldiniz rehberi ve yeni özellikler penceresi notları Türkçe gösterir. Başlangıçtan beri 349 sürümün hepsi çevrildi; böylece uzun bir aradan sonra dönen biri tüm geçmişi Türkçe okur. Bir test her sürümün maddelerini, özellik etiketlerini ve kodunu koruduğunu denetler. Her yeni sürümün GitHub sürüm sayfası da Türkçe notları “Türkçe” başlığı altında taşır. Deneyin: Dili Türkçe yapın, Ctrl+K’ye basın, “Yenilikler”i çalıştırın ve en yeni sürümlerin Türkçe olduğunu görün.
- **Vex’in geri kalanı da Türkçe.** Özellik Kitaplığı (her özelliğin adı, ne işe yaradığı ve nasıl kullanılacağı, 1.316 metin), arka plan sürecinin bir şey ters gittiğinde gösterdiği iletiler (1.231; örneğin “bu dosya açılamadı”) ve Windows’un kendi iletişim kutuları (dosya seçiciler, “Vex yanıt vermeyi bıraktı”, mikrofon sorusu) Vex Türkçe olduğunda Türkçedir. Yükleyici zaten çok dilliydi; Windows’un Varsayılan uygulamalar’da Vex için gösterdiği yazılar artık onu izler. Yeni bir Türkçe README (README.tr.md) var. Vex web sitelerinin kendi metnini çeviremez; onlar için sayfa çevirmenini kullanın. Deneyin: Dili Türkçe yapın, Ctrl+K’ye basın, Özellik Kitaplığı’nı açın ve bir özelliğin adımlarının Türkçe olduğunu görün.
- **Kenar çubuğu düğmeleri sürüklenebilir.** Bir düğmeye basın, fareyi birkaç piksel oynatın; nereye ineceğini bir çizgi gösterir, bırakınca düğme oraya geçer. Düz bir tık yine paneli açar, Esc geri koyar ve sıra, Ayarlar › Kenar çubuğu’ndaki sıranın aynısıdır. Deneyin: Kenar çubuğunda Saat düğmesini Notlar’ın üstüne sürükleyin.
- **Kuyruk nasıl kurulacağını anlatır.** Yeni kurulumlarda zaten kapalıydı ve siz açmadıkça kenar çubuğunda olmaz. Açınca adımları (bir Telegram botu, Telegram numaranız, ücretsiz Worker, bir deneme iletisi) sıralar, adım adım rehberi açar ve Worker’ın adresi ile okuma anahtarı için bir form sunar. Deneyin: Ayarlar › Kenar çubuğu’ndan Kuyruk’u gösterin, sonra açın.
- **Geliştirici bölümünde güncelleme denetimi.** Geliştirici paneli ve panosu, Ayarlar › Hakkında’daki Güncellemeleri denetle’nin aynısına sahip. Deneyin: Ayarlar › Geliştirici, sonra Güncellemeleri denetle.
- **Son İngilizce köşeler de Türkçe.** Şifreli bir profilin kilit açma ekranı (başlığı, yazısı, düğmeleri ve yanlış parola yanıtları; Vex’in son kullanıldığı dilden alınır), “siteye ulaşılamıyor” sayfası (ne olduğu, ne deneneceği, her düğme), hızlı not (kutu ve yanıtları), açılır pencere araç çubuğu ve yüzen video penceresi. Türkçe bir Vex’te özetler, yanıt dilini siz ayarlamadıkça Türkçe gelir (sohbet ve posta yine yazdığınız metni izler). Deneyin: Dili Türkçe yapın, olmayan bir site açın ve sayfayı okuyun.

### Değişti
- **Yeni sekme düğmesi son sekmenizi izler.** Eskiden çubuğun en sağında dururdu. Çubuğun boş kısmı pencereyi sürüklemek için kullanılmaya devam eder ve pencere düğmeleri sağda kalır. Safari görünümü sekmelerini çubuğu dolduracak şekilde korur. Deneyin: Üç sekme açın ve + işaretinin üçüncüden hemen sonra olduğunu görün.
- **Çalışma, Araç kutusunun parçası oldu.** Çalışma, Araç kutusuyla aynı evrak çantasını kullanan ayrı bir kenar çubuğu düğmesiydi. İş şeridi (hangi işe göre kurulduğunuz, Vex yapay zekâya sorun, bu işin hatırlatıcıları, yapışkan not ve haftalık gözden geçirme) artık Araç kutusunun en üstünde, seçtiğiniz araçlar altındaki “İşiniz için” rafı ve Çalışma düğmesi kalktı. Deneyin: Araç kutusunu açın.
- **Ayarlar daha hızlı açılır.** Boyayabilmeden önce otuz kadar bölümü yeniden çiziyor ve her birinden sonra bloklarını yeniden yerleştiriyordu: gerçek uygulamada ölçüldüğünde, yeniden açılış artık ilk görüntüsüne yaklaşık 0,9 sn’de ulaşıyor (kategori menüsünün iki kez kurulması ve otuz sayfa yerleşimi onu geciktiriyordu), açılışın sonundaki uzun duraklama gitti ve oturumun ilk açılışı yaklaşık 1,2 sn sürüyor. Geri kalanı tarayıcının 18.000 öğelik bir sayfayı yerleştirmesi; daha aşağı inmek, Ayarlar kapalıyken de çizili tutmayı gerektirir. Deneyin: Ayarlar’ı açın, kapatın ve yeniden açın.
- **Ayarlar bölümleri mantıklı bir sırada.** Önce görünüm ve yerleşim, sonra başlangıç sayfanız ve profilleriniz, gizlilik ve oturum açma, tarayıcının davranışı, yapay zekâ, hesaplar ve eşitleme; en sonda veriler, Vex’in sağlığı, Geliştirici ve Hakkında. Kategori menüsü de bunu izler. Deneyin: Ayarlar’ı açın ve kategori menüsünü okuyun.
- **Seçim çubuğu metne uyanı sunar.** Bir hatayı seçince Hata ayıkla çıkar; uzun bir metin Özetle alır; başka dildeki metin Çevir alır; hiçbiri beşini birden almaz. Mikrosaniyelerde karar verir, çubuk eskisi kadar hızlı görünür. Deneyin: Bir cümleyi, sonra bir hata iletisini seçin.

### Düzeltildi
- **Ayarlar her açılışta biraz büyüyordu.** Üç bölüm (Yapay zekâ harcama sınırı, Yapay zekâ parası, Yapay zekâ yönlendirme) Ayarlar her açıldığında bir dinleyici ekliyordu ve her biri çizdiği bölümü sonsuza kadar bellekte tutuyordu: açılış başına yaklaşık 65 öğe ve 11 dinleyici. Artık tek dinleyici tutuyorlar ve Ayarlar 24 kez açılsa bile hiç büyümüyor. Deneyin: Ayarlar’ı birkaç kez açıp kapatın, sonra Bellek panelini açın ve Vex’in kendi belleğinin yükselmediğine bakın.
- **İçe aktarma penceresi Türkçede İngilizceydi.** Metni, sayıları (“3 yer imi”) ve iletileri artık Türkçe. Deneyin: Dili Türkçe yapın, Ctrl+K’ye basın ve “Başka bir tarayıcıdan içe aktar”ı çalıştırın.
- **Kurulum sihirbazı Türkçede yarı İngilizceydi.** Türkçe seçildikten sonra başlıkların altındaki açıklamalar 23 adımın çoğunda İngilizce kalıyordu (görünüm seçenekleri, bellek ve gizlilik, oturum açma kodları, Bulut yapay zekâ, Eşitleme, parolalar, bildirimler ve son adım) ve ilk adımdaki iki seçenek de öyleydi. Hepsi artık Türkçe. Deneyin: Ctrl+K’ye basın, “Kurulum sihirbazı”nı çalıştırın, Türkçe’yi seçin ve sihirbazın tamamını adım adım gezin.
- **Parantez içinde not olan metinler Türkçede yarı İngilizce kalıyordu.** “Posta (needs your permission)” gibi etiketlerde artık not da çevriliyor. Deneyin: Dili Türkçe yapın, Ayarlar’ı açın, Özet’i bulun ve Posta satırına bakın.
- **Zilin mavi noktası açık kalıyordu.** Artık “yeni bir şey bekliyor” demek: listeyi açınca gider, yalnızca sonradan eklenen için döner. Deneyin: Zili açın ve kapatın.
- **Başlangıç Sayfası düğmesi başka sekmelerde mavi kalıyordu.** Yalnızca başlangıç sayfası öndeyken yanar. Deneyin: Bir site açın ve ev simgesine bakın.
- **Yapay zekâ düğmesi simgesini yitirmişti.** Tarayıcı görünümlerinde araç çubuğu onu sıkıştırıp yalnızca sözcüğü bırakıyordu. Deneyin: Firefox görünümünde yapay zekâ düğmesine bakın.
- **Türkçe Vex’te yapay zekâ haberleri.** Türkçe haberler varsayılan olarak İngilizcelerin yanında tutulur; eski yalnızca İngilizce listesi olan profillere bir kez eklenir. Deneyin: Ayarlar › Yapay zekâ haberleri › diller.

### Denetlendi
Her değişikliğin testleri, kaynak, tür ve lint denetimleri, dört görünümde 1, 3 ve 30 sekmeyle gerçek Chromium’da ölçülen sekme çubuğu (+ son sekmeyi izler, pencere düğmeleri sağ kenarda kalır, sürükleme alanı kalır), gerçek uygulamada Türkçe sürüm listesi ve “Yenilikler” penceresi ve gerçek uygulamada tam sihirbazın 23 adımının tamamı Türkçe gezildi (ilk adım İngilizce de).

## v37.26.6 (2026-10-21) — Daha kısa sekmeler ve Ayarlar sol tarafta basit bir liste olarak açılıyor

### Değişti
- **Sekmeler daha kısa.** Bir sekme 160 pikselde büyümeyi bırakır; böylece birkaç sekme açıkken kapatma düğmesi başlığın yarım ekran ötesinde değil, hemen yanında durur. Çok sekme olduğunda sekmeler eskisi gibi çubuğu paylaşır ve küçülür. Safari görünümü eşit genişlikteki sekmelerini korur. Deneyin: İki sekme açın ve X’in başlığa yakın olduğuna bakın.
- **Ayarlar, tüm genişliği kullanan tek sütun olarak açılır ve bölümlerin listesi sol tarafta durur.** Bu, yeni kurulumlar ve Ayarlar düzenini hiç değiştirmemiş herkes için varsayılandır; kendi seçtiğiniz düzen korunur ve Ayarlar düzeni kutusundaki “Varsayılan düzene dön” sizi buna geri getirir. Deneyin: Ayarlar’ı açın, düzen düğmesini açın ve Varsayılan düzene dön’ü seçin.

### Denetlendi
Her iki değişikliğin testleri, kullanıcı arayüzü denetiminde Ayarlar düzenleri (üç görünümün her birinde 156 denetim, hiçbir şey işaretlenmedi) ve varsayılan ve Firefox tarzı görünümlerde 1, 2, 8 ve 30 sekmeyle Chromium’da ölçülen gerçek sekme genişlikleri.

## v37.21.0 (2026-10-21) — Güncellemeden sonra her yeni özellik anahtarıyla birlikte, kendi imleciniz ve çok daha fazla Türkçe

### Yeni
- **Güncellemeden sonra bir açılır pencere her yeni özelliği anahtarıyla listeler.** Her birinin bir aç/kapat anahtarı, neden orada olduğu ve ne yaptığı, nasıl kullanılacağı ve neleri okuyup gönderdiği vardır; Ayarlar’ındaki yerine bir yol da bulunur. Güncellemenin düzeltmeleri aşağıda listelenir, her biri açıklamasına açılır. Sizin yerinize hiçbir şey açılmaz. Deneyin: Ctrl+K’ye basın, “Bu güncellemenin yeni özelliklerini göster”i çalıştırın ve bir anahtarı çevirin. (feature: whats-new-me)
- **Kendi imleciniz.** Bir ok, nokta, halka, artı ya da yıldız, bir renk ve bir boyut seçin. Vex’in kendi ekranlarını ve Yeni Sekme sayfasını değiştirir; bir web sitesi kendi imleçlerini korur. Siz seçene kadar kapalıdır. Deneyin: Ayarlar’ı açın, Fare imleci’ni bulun, Halka ve bir renk seçin ve fareyi sol rayın üzerinde gezdirin. (feature: custom-cursor)
- **İstediğiniz zamana kadar kapalı bir tıklama efekti.** Ateş böcekleri, dalgalar, konfeti, bir şok dalgası ya da her tıklamada farklı birini seçen Beni şaşırt. Hareketi azalt açıkken yerinde durur ve Windows’ta animasyonlar kapalıysa Ayarlar bunu söyler (yine de gösterebilirsiniz). Deneyin: Ayarlar’ı açın, Tıklama efekti’ni bulun, açın ve Vex’te herhangi bir yere tıklayın. (feature: click-effect)
- **Kurulum sihirbazı kendiliğinden geri gelir.** Her adımında Atla olan kısa bir sürüm; en son çalıştığından bir ay sonra (Ayarlar’da bir anahtar) ve Vex elle kaldırılıp yeniden kurulduktan sonra. Bir güncelleme onu asla başlatmaz. Deneyin: Ayarlar’ı açın ve “Kurulumu her ay yeniden öner”i arayın. (feature: setup-again)

### Düzeltildi
- **Yeni Sekme arama kutusuna yazmak artık sizin bilginiz dışında Tor’a götüremez.** Arama hiçbir zaman Tor’u başlatmıyordu; Vex’in tamamı için olan yol başlatıyordu ve yeniden başlatmadan sonra hatırlanıyordu. Özel yönlendirme’de Tor’a ya da bir vekile tıklamak artık önce sorar ve kayıtlı bir yol her başlangıçta Doğrudan git düğmesiyle duyurulur. Deneyin: Özel yönlendirme’yi açın, Tor üzerinden’e tıklayın ve bir soru çıktığını, siz onaylayana kadar hiçbir şeyin değişmediğini görün.
- **Kenar çubuğu düğmesi, açıp kapattığı rayın üstünde.** Firefox görünümünde sağdaki araç düğmelerinin arasında uzakta duruyordu; şimdi araç çubuğunun sol ucunda, rayın hemen üstünde. Deneyin: Firefox görünümünü kullanın ve pencerenin sol üstüne bakın.
- **Vex’in çok daha fazlası Türkçe.** Saat ve Geliştirici gibi paneller, her iletişim kutusu, menü ve bildirim ve bir panelin sonradan çizdiği metin artık çevrildi; ayrıca Ayarlar’da, panellerde ve özellik listesinde (her özelliğin neyi okuyup gönderdiği) birkaç bin metin daha, tarihler ve cümlelerin içindeki sayılar. Eski sürüm notları ve web siteleri olduğu gibi kalır. Deneyin: Dili Türkçe yapın ve Ayarlar’ı, Saat panelini ve bir iletişim kutusunu açın.

## v36.69.1 (2026-10-19) — Tekrar hoş geldiniz rehberi, Ayarlar bir dişli ve Yeni Sekme sayfası Türkçe konuşuyor

### Yeni
- **Tekrar hoş geldiniz: en son hangi sürümü kullandığınızı söyleyin ve o zamandan beri neyin değiştiğini görün.** Uzun bir aradan sonra dönen ya da yeni bir bilgisayardaki biri için. Seçtiğiniz sürümden (ya da hatırlamıyorsanız en yeni ondan) beri en önemli değişiklikleri listeler; açılacak bir Ayarlar bölümü olan yerde bir Dene düğmesi, tam notlara bir bağlantı ve (asla zorlanmayan) Basit mod ile Türkçe bir bilgisayarda Türkçe teklifi vardır. Bir güncelleme sekiz ya da daha fazla sürümü atladığında, “Benim için yenilikler” kapalı olsa bile, güncelleme kartının yerine kendiliğinden bir kez açılır. Türkçede rehberin tamamı Türkçedir; yalnızca İngilizce yazıldığını söylediği sürüm notları hariç. Deneyin: Ctrl+K’ye basın, “Tekrar hoş geldiniz: Vex’i en son kullandığımdan beri neler değişti”yi çalıştırın, listeden bir sürüm seçin ve Neyin değiştiğini göster’e basın.

### Düzeltildi
- **Ayarlar simgesi bir güneşti.** Uzun süredir kullanan biri Ayarlar’ı bulamadı, çünkü ray simgesi ışınlı bir daireydi, yani parlaklık işaretiydi. Artık bir dişli; rayda, ortak simge kitaplığında ve Ayarlar panelinin varsayılan simgesinde. Deneyin: Sol rayın altına bakın ve Ayarlar düğmesinin bir dişli olduğunu görün.
- **Birbirine benzeyen simgeler.** Geçmiş ile Saat ve zamanlamalar ikisi de saat yüzüydü, Gizlilik ile Kimlik doğrulayıcı ikisi de kalkandı ve Recall bir yakınlaştırmaya benziyordu. Geçmiş artık geri oklu bir saat, Saat ve zamanlamalar bir çalar saat, Kimlik doğrulayıcı bir anahtar ve Recall metin satırlı bir büyüteç. Deneyin: Sol raya bakın ve Geçmiş, Saat, Gizlilik ile Kimlik doğrulayıcı’nın dört farklı resim olduğunu görün.
- **Araç çubuğunun YZ düğmesi Türkçede “Yapay zekâ” yazısını iki satıra bölüyordu.** Türkçe etiketi artık `YZ` ve ipucu çevrildi. Deneyin: Ayarlar’ı açın, dili Türkçe yapın ve araç çubuğunun YZ düğmesinin tek satırda YZ yazdığını görün.
- **Ctrl+K ipucu taşıyan Türkçe araç çubuğu ipuçları İngilizce kalıyordu.** Sekiz araç çubuğu düğmesinin “İndirilenler · Ctrl+K: İndirilenler” gibi başlıkları var; her parça artık çevrildi. Deneyin: Dil Türkçeyken fareyi araç çubuğunun Böl düğmesinin üzerinde tutun ve ipucunun Türkçe olduğunu görün.
- **Yeni Sekme sayfası, Özet kartları ve kısayollar çubuğu Türkçede çoğunlukla İngilizceydi.** Tarih (hep İngilizceydi), hava durumu kutusu, son listesi, konum iletişim kutusu (ülke adları tarayıcının kendi Türkçe verisinden gelir), Özet kartları (“Sizi bekleyenler”, “Günü bitirirken”, “kapalı” iletileri ve düğmeleri), Yenile ve Bölümler, Ekle kutucuğu, arama kutusu, kısayol iletişim kutusu ve yer imi çubuğunun “Kısayol ekle”si ile düzenleyicisi. Kendi içeriğiniz (geçmiş satırları, kısayol adları, sayfa başlıkları) olduğu gibi bırakılır. Deneyin: Dili Türkçe yapın, yeni bir sekme açın ve tarihin, hava durumu kutusunun ve Özet kartlarının Türkçe olduğunu görün. Her Özet bölümü ya da Ayarlar sayfası henüz çevrilmedi.

### Denetlendi
Her değişikliğin ilgili testleri, kaynak, tür ve lint denetimleri ve Electron’daki gerçek uygulama: uygulamanın gerçek sürüm listesiyle (345 sürüm) İngilizce ve Türkçe Tekrar hoş geldiniz rehberi, konsol hatası olmadan Türkçe ve İngilizce Yeni Sekme sayfası, ölçülen YZ düğmesi (eski etiketle 95 px, `YZ` ile 58 px genişlik) ve çizilip bakılan simgeler. Araç çubuğu, ray ve Tekrar hoş geldiniz rehberine Firefox görünümünde de Türkçe bakıldı; Yeni Sekme sayfası ve tam boy ray simgeleri yalnızca varsayılan görünümde denetlendi. Tam test takımı bu işlemelerde yerelde çalıştırılmadı; CI itme işleminden sonra çalıştırır.

## v36.56.9 (2026-10-19) — Kötü bir kısayol ya da yer imi artık ayarların kaydedilmesini durduramaz ve iletişim kutusu alanları Vex’in geri kalanına benzer

### Düzeltildi
- **Kayıtlı listenin reddettiği bir kısayol, yer imi ya da geçmiş girdisi artık her kaydı engelleyemez.** Yeni Sekme sayfasının kutucuk düzenleyicisi boşluklu metni, `javascript:`, `ftp://` ve `mailto:` kabul ediyordu, kısayol çubuğu düzenleyicisi `about:` ve aynı türden metinleri kabul ediyordu, yer imleri ve geçmiş 8192 karakterden uzun bir adresi ya da 4096’dan uzun bir yer imi başlığını kabul ediyordu. Bunların her biri sonraki her ayar kaydının “Invalid saved URL” ile başarısız olmasına yol açıyordu. Her iki düzenleyici, yer imi yıldızı, “seçili sekmeleri yer imine ekle” ve geçmiş artık bunu kaynağında net bir iletiyle durduruyor. Deneyin: Yer imi çubuğunun sağ ucundaki “Kısayol ekle”ye tıklayın, bir ad ve bağlantı olarak `my favourite site` yazın, Kaydet’e basın ve “Bu, Vex’in kaydedebileceği bir bağlantı değil” dediğini ve kutuyu açık tuttuğunu görün.
- **Reddedilen bir kayıt artık sorunun nerede olduğunu söylüyor.** “Invalid saved URL” girdiyi bulmanın yolunu vermiyordu; artık liste ve girdi numarasıyla bitiyor, örneğin “(bookmarks, entry 2)”.
- **İletişim kutularındaki alanlar tarayıcının kendi küçük biçimsiz kutularıydı.** Ev işleri ve faturalar, Saat dilimi yardımcısı, Moderatör takımı, Yazı masası, Müfredat kapsamı ve Sıfırlama zamanlayıcıları artık Ayarlar’daki aynı metin kutularını ve açılır listeleri kullanıyor. Varsayılan görünümde gerçek Chromium’da denetlendi; Firefox görünümüne bakılmadı. Deneyin: Ctrl+K’ye basın, “Saat dilimi yardımcısı”nı çalıştırın ve metin kutusunun yuvarlak köşeleri olduğunu, tıkladığınızda görünür bir çerçeve çıktığını görün.
- **Sıfırlama zamanlayıcıları: boş “Gün” ve “An” satırları gitti.** Yalnızca denetim gizleniyordu, bu yüzden etiketler ekranda kalıyordu. Deneyin: Ctrl+K’ye basın, “Sıfırlama ve sezon zamanlayıcıları”nı çalıştırın ve “Her gün”ü seçince yalnızca Ad, Ne sıklıkta, Saat, Saat dilimi ve Hatırlatıcı’nın göründüğünü görün.
- **Ayarlar > Hakkında, Vex kaynaktan çalıştırıldığında “DRM başarısız”ı açıklıyor.** O sürüm imzalı değil, bu yüzden korumalı video hiçbir şey yanlış olmadan başarısız olabilir; satır artık bunu söylüyor. Kurulu Vex değişmedi.

### Yeni
- **Sürüm elle denetim listesi tam adımlar taşıyabilir.** `Try: <steps>` ile biten bir değişiklik günlüğü maddesi, bu sözleri Ayarlar > Sürüm denetimi’nde ve `scripts/release-checklist.js` içinde “Bunu yapın” satırı olarak gösterir.
- **Bellek kapısı, bir derlemeyi ya da tam test çalıştırmasını reddettiğinde belleği neyin kullandığını söylüyor.** Belleği en çok tutan beş programı listeler, yine salt okunur.

### Denetlendi
Her değişikliğin ilgili testleri, kaynak, tür ve lint denetimleri ve iletişim kutusu alan biçimlerinin gerçek Chromium’da geri okunması. Tam test takımı bu işlemelerde yerelde çalıştırılmadı (bellek kapısı reddetti); CI itme işleminden sonra çalıştırır. Denetlenmedi: Firefox görünümündeki iletişim kutusu alanları ve ekrandaki DRM notu.

## v36.49.6 (2026-10-19) — Yeni Sekme sayfasını yer imine eklemek artık ayarların kaydedilmesini durdurmuyor ve eklenti belleği arka planda çalışabilir

### Yeni
- **Eklenti belleği: “Gizle ve çalışmaya devam et”.** Ölçüm penceresi Vex’i bir saate kadar kaplıyordu. Yeni düğme onu gizler ve sağ alt köşede Göster ve Durdur’lu küçük bir çip bırakır; ölçüm sürer ve bittiğinde “Sonucu göster”li bir ileti çıkar. Durdur yine her eklentiyi geri açar. Electron’da gerçek tıklamalarla denetlendi.

### Düzeltildi
- **Yeni Sekme sayfasını yer imine eklemek kaydetmeyi bozuyordu.** Yıldız Yeni Sekme sayfasını kabul ediyordu, ama kayıtlı bir yer imi bir web adresi olmalıdır; bu yüzden her kayıt reddediliyordu (“Invalid saved URL” ve “Changes could not be saved”) ve onunla kaydedilen diğer ayarlar kayboluyordu. Yıldız artık Yeni Sekme sayfası, Ayarlar ve web olmayan diğer sayfalar için “Yalnızca web sayfaları yer imine eklenebilir” diyor. Bu türden mevcut bir yer imi yine yıldızla kaldırılabilir.
- **“İlk yer imi” madalyası 2 dakikaya kadar bekliyordu.** Kaydedilen bir yer imi artık madalyaları hemen denetliyor. Madalya açılır penceresi, tasarım gereği, yine yalnızca Oyunculuk “Tam”da gösterilir.
- **Şimdi Çalıyor çubuğu kapatılmış bir sekmeyi tutuyordu.** Çalarken sekme kapatılınca satırı, hiçbir şey yapmayan düğmeleriyle kalıyordu. Satır artık sekme kapanınca gidiyor ve her satırın gizlemek için bir X’i var.
- **İlk açılış: önceki mod yeniden başlatmada korunuyor.** Özelliği kapatıp (örneğin En az Vex ile) yeniden açmak, seçim “aç” olsa bile yeniden başlatmadan sonra “öner” veriyordu.
- **Sürüm betiği** (`scripts/release.js`) artık işlemesine commit kancasının istediği `Rank:` satırını veriyor, bu yüzden commit adımında başarısız olmuyor.

### Denetlendi
Eklenti belleği, yer imi ve Şimdi Çalıyor işlemelerinde tam test takımı (Node 22’de 1.225 dosya, 16.814 test), ayrıca kaynak, tür ve lint denetimleri ve eklenti belleği penceresinin Electron’da 20 denetimlik gerçek çalıştırması. İlk açılış düzeltmesi testleri, lint ve kaynak denetimiyle denetlendi; tam takım o son işlemeden beri çalıştırılmadı. Gerçek bir profilde denemedi: tam bir eklenti belleği çalıştırması, çünkü sahibin profilindeki çalıştırma hiçbir şey ölçmeden durduruldu.

## v36.44.1 (2026-10-18) — Eşleşen anahtarlar, her özelliğe bir giriş, gruplar halinde eklenti belleği ve posta koduyla hava durumu

### Yeni
- **İstediğiniz bir özelliği, ne olduğunu bilerek açın.** Kitaplık’ta, Keşfet’te, Ctrl+K’de ya da bir Yeni Sekme düğmesinde kapalı bir özelliği seçtiğinizde Vex artık önce onu tanıtır: ne yaptığını, nasıl kullanılacağını, neyi okuyup sakladığını ve gönderdiğini, ve nasıl yeniden kapatılacağını. Sonra Aç ve kullan, Ayarlar’ı aç ya da İptal’i seçersiniz. Siz söylemeden hiçbir şey açılmaz, anahtar sonradan denetlenir ve istediğiniz şey bir kez açılır. Minimal Vex ya da bir sessiz kip özelliği kapalı tutuyorsa Vex bunu söyler ve geçersiz kılmaz.
- **Posta koduyla hava durumu.** Kurulum sihirbazı, Yeni Sekme’deki “Konumu değiştir” penceresi ve Ayarlar artık tek bir yer aramasını paylaşıyor; Ayarlar’da bir ülke seçici de var. Posta kodu seçtiğiniz ülkede aranır (OpenStreetMap), böylece Türkiye’de 34852, Bursa’daki Zümrütevler’i değil, Zümrütevler Mahallesi, Maltepe, İstanbul’u bulur. Her sonucun koordinatları kullanılmadan önce denetlenir, bir listeden seçersiniz ve hatalar neyin ters gittiğini söyler. Adlar için hâlâ Open-Meteo kullanılır. Yazdığınız posta kodu OpenStreetMap’e yalnızca Ara’ya bastığınızda gönderilir; gizlilik tablosu bunu listeler.
- **Gruplar halinde eklenti belleği.** “Eklenti belleği” artık eklentileri 8, 4 ya da 2’li gruplar halinde kapatabiliyor ve sayfayı grup başına bir kez okuyor; böylece yaklaşık 60 eklentili bir Vencord kurulumu beş saat yerine yaklaşık bir saat sürüyor. Bilinen ağır eklentiler tek başına sınanır. Öne çıkan bir grup üyelerini listeler; üyeler (4’lü gruplarda) işaretli gelir, böylece aralığı daraltabilirsiniz. Her eklenti, değiştirilmeden önce bir geri yükleme kaydına yazılır ve her adımdan sonra, Durdur’da, hatada ve bir sonraki açılışta yerine konur. Liste artık Vencord’un kendi eklenti tablosundan geliyor; böylece açık, zorunlu olmayan ve başka bir eklentinin ihtiyaç duymadığı her eklenti, ek bir Vencord eklentisi gerekmeden sunuluyor.
- **Eksik anahtarlar ve ekranlar.** Parola sayfası denetimi, Güncelleme öz sınaması, sürüm denetimi, “Nerelerde oturum açtım”, olay denetim listeleri, ilk kullanım kartları, uzun belgeler, yanıt kaynakçaları ve site başına ses düzeyinin her birinin kendi Ayarlar bölümünde gerçek bir anahtarı var; “Oturum açma: neden oturumunuz kapandı” ise kendi bölümüne sahip. Sürüm radarı, Haftalık not, Eski sekmeleri topla, gelen kutusu, sayfa eylemleri, Canlı yer imleri, ekran paylaşımı denetimi ve diğer 11 Kitaplık girdisi artık genel bir Ayarlar bağlantısı yerine kendi gerçek ekranını açıyor. Yeni komut: **Bu Sekmeyi Uyanık Tut…**.

### Düzeltildi
- **Eklenti belleği artık uykuya geçmiş bir Discord’da başarısız olmuyor ya da donmuyor.** Uyuyan bir Discord’un arka planda yüklenmesi önerilir ve ölçüm sürerken uyanık tutulur (boşta uyku, otomatik yenileme ya da kısıtlama yok); kendi uyku ayarlarınız değiştirilmez. Hızlı yöntem sonsuza kadar bekliyordu: Electron, yaklaşık 100 kare derinliğinde çağrı yığınları olan, Discord’unkiler gibi bir yığın profili asla döndürmüyor; bu yüzden artık 30 saniye sonra vazgeçiyor, nedenini söylüyor ve “Teker teker...” seçeneğine yönlendiriyor. Her hata ayıklayıcı adımının bir süre sınırı var ve tuhaf adlı tek bir eklenti artık tüm ölçümü başarısız kılmıyor.
- **Her açılışta oluşturulamayan Ayarlar bölümleri.** Güncelleme öz sınaması, site başına ses düzeyi, uzun belgeler, yanıt kaynakçaları ve Oturum açma bölümü, bir betik çok geç yüklendiği için her açılışta “VexSettingsGroup is not defined” hatasını defalarca günlüğe yazıyordu. Artık hemen oluşturuluyorlar.
- **Yeni Sekme sayfasındaki “Otomatik Pilotu aç” hiçbir şey yapmıyordu** (“10 dakikam var”, “Zaman çizelgesini aç” ve akıllı yer imleri düğmesi de öyle). Yeni Sekme sayfasının düğmeleri yalnızca adları “brief-” ile başladığında iletiliyordu. Artık çalışıyorlar ve bir Özet düğmesi iletilmeden bırakılırsa bir test başarısız oluyor.
- **Anahtarlar artık özellikle uyumlu.** Özellik kullanımı ya da Minimal Vex üzerinden bir geliştirici aracını, bir yapay zekâ tarifini ya da bir iş akışı özelliğini açıp kapatmak artık onu, kendi Ayarlar anahtarının yaptığı gibi tam olarak başlatır ya da durdurur. Bir özelliği kapatmak artık onu paylaşan diğerlerinin Ayarlar bölümünü gizlemiyor. Kendiniz açtığınız bir özellik artık bir sonraki açılışta yeniden kapatılmıyor. Açılıştan sonra yüklenen modüller artık kendiliğinden başlıyor.
- **Bir düğme artık arkanızdan bir özelliği açmıyor:** Oyun odasındaki “Daha fazla mini oyun” önce sorar. Komut kısayol sözcükleri kapalıyken hiçbir şey öğrenmez. Form yardımcısı özel ya da Tor sekmesini asla okumaz. Geliştirici döngüsündeki “Şimdi denetle”, GitHub erişimi kapalıyken artık “yeni hata yok” demiyor. Şifreli profil kilidi, kapalıyken ama profiliniz hâlâ şifreliyken parola değiştirmeyi ve düz dosyalara dönmeyi kullanılabilir tutar. “Bu bitmeden bana hatırlat” özel ve Tor sekmelerini reddeder.
- **Daha net iletiler:** yaklaşık 25 ileti, var olmayan bir Ayarlar bölümünü ya da komutu anıyordu (Güçlendirmeler, Canlı yer imleri, Kullanım, Oturumlar, Yedekleme...). Kapatılan pencereyi yeniden aç, Vex’i üstte tut, Sekmeyi yeni pencereye taşı, bilgi tabanı araması ile tatil ve ifade komutları artık hangi anahtarın kapalı olduğunu söylüyor.
- **Yapay zekâ asistanına, komutu olan özellikler için “çalıştırılacak komut yok” deniyordu.** Artık komutu alıyor.

### Denetlendi
Kaynak üzerinde: tüm test takımı (16.754 test), kaynak, tür ve lint denetimleri, açılış, yeniden başlatma ve 120 çalıştırmalık duman matrisi denetimleri, kullanıcı arayüzü denetimi, 564 Kitaplık girdisinin tamamı üzerinde hedef denetimi, yukarıdaki düzeltmelerin gerçek Electron’da 25 denetimlik bir çalıştırması ve her iki bağımlılık denetimi. Paketlenmiş bir derlemede: derleniyor ve açılış duman testini geçiyor (25 denetimlik çalıştırma kaynak derlemede yapıldı). Denenmedi: bu kurulum dosyasının tam olarak Netflix/Spotify oynatması (DRM imzası yayım sırasında oluşturulur) ve kendi hesaplarınızı gerektiren her şey (Gmail, Discord, GitHub belirteçleri, Tor).

## v36.25.1 (2026-10-18) — Oyun odası, arkadaşınız ve tek profil

### Yeni
- **Tek profil merkezi.** Araç çubuğundaki profil düğmesi ve Ctrl+K, adınız, avatarınız, XP’niz ve madalyalarınız için aynı yeri açar. Ad değişiklikleri tarayıcı profilinizle eşgüdümlü kalır; tarayıcı profillerini değiştirme ve yönetme merkezin içinde yapılabilir.
- **Oyun odası:** hafıza eşleştirme, Yankı karoları, PNG olarak dışa aktarılan piksel kartpostallar, komik yazı istemleri, balonlu naylon ve imkânsız seçimler. Yerel hatıralar toplayın ve etkinlik başına günde 5 mevcut profil puanı kazanın; tekrar oynama sınırsızdır.
- **Bakabileceğiniz bir arkadaş.** Evcil hayvanınızı besleyin, sevin, onunla top oynayın, uyutun ve uyandırın. Taşımak için sürükleyin ya da ok tuşlarını kullanın, konumunu kilitleyin ve adını, türünü, tüyünü, boyutunu ve aksesuarını seçin. Üzerine gelince sevme isteğe bağlıdır. Hareketi azalt açıkken de evcil hayvan görünür kalabilir.
- **Daha eğlenceli günlük görevler;** çizim, hikâye, evcil hayvan zamanı ve hayal gücü istemleriyle.

### Düzeltildi
- **Discord ekran paylaşımı, Electron canlı bir istek çerçevesinin ayrıldığını bildirdiğinde seçiciyi yine açıyor.** Vex, paylaşmadan önce isteği yapan belgeyi hâlâ tam olarak doğrular ve sayfası değişmiş ya da kapanmış istekleri durdurur. Atlatma uyumluluk bilgisi, çalışan her paylaşımda görünmek yerine isteğe bağlı tanılarda kalır.
- **Ctrl+K özellikleri daha doğrudan buluyor.** Güçlü özellik eşleşmeleri komutlar ve araçlarla birlikte sıralanır; böylece “evcil hayvan” ve “XP” gibi sorgular, zayıf eşleşmelerden ve web aramasından önce ilgili özelliğe götürür.

## v36.12.6 (2026-10-17) — Netflix, Prime ve Disney+ oturumda kalıyor ve Dalga 0’dan 6’ya her yeni araç

### Öne çıkanlar
Bu çok büyük bir sürüm: v22.22.1’in üzerine Dalga 0’dan 6’ya yapılan çalışma. **Her yeni ya da deneysel özellik, var olan bir profilde KAPALI başlar** (Vex, verileriniz zaten olan bir profili tanır ve yeni özellikleri geri tutar; haftada en fazla üç “dene” önerisi sunar). Yepyeni bir profil, her özelliğin kendi varsayılanını alır. Aşağıdaki her şey, devamındaki dalga bölümlerinde daha ayrıntılı listelenmiştir.

### Önce düzeltilenler (fark edeceğiniz şeyler)
- **Vex’i yeniden başlattıktan sonra Netflix, Prime Video ve Disney+ hesaplarınızda oturumunuz açık kalıyor.** Artık kullanılmayan bir temizlik, Vex her başladığında kayıtlı girişlerini tutan klasörü siliyordu; bu yüzden üçü de her açılışta oturumunuzu kapatıyordu. Kaldırıldı ve açılış bir daha bir gezinme oturumunu silerse artık bir test başarısız oluyor.
- **WhatsApp aramaları mikrofon isteyebiliyor.** Hiç sorulmamış bir mikrofon ya da kamera, sekmelerde ve kenar çubuğu panellerinde “reddedildi” olarak okunuyordu; bu yüzden WhatsApp gibi siteler hiç sormadan kendi “mikrofonu aç” kutularını gösteriyordu. Artık ikisi de “sor” olarak okunuyor ve kayıtlı bir İzin ver ya da Engelle seçimine uyuluyor.
- **Sabitlenmiş bir Gmail paneli okunmamış sayısını gösteriyor;** kenar çubuğu simgesinde (Gmail’in “Inbox (6,693)” başlığı mail.google.com’da anlaşılır).
- **Vex hareketsiz tutulurken Ctrl+K artık bulanık bir ekranla görünmez bir çubuk açmıyor** (hiç yayımlanmayan v22.24.6’dan).
- **Hata raporunu kopyala ve Resimden üst veriyi kaldır yeniden çalışıyor.** İki betik VexRedact adını paylaşıyordu ve yanlış olan yanıt veriyordu.
- **Kilit ekranı:** kaydedilmiş “Uygulama olarak aç” pencereleri artık kilit ekranının üstünde yeniden açılmıyor; Vex kilitliyken başka bir programdan gönderilen bağlantılar ve hızlı yakalama, kilidi açana kadar bekliyor; çok sayıda eşzamanlı yanlış PIN denemesi artık her biri başarısızlık olarak sayılıyor; Discord web kancası bir @everyone gönderisinden önce ana işlemde soruyor; yerel hizmet `uv run` şablonu yalnızca sabit bir komut kümesini kabul ediyor; uzun bir rakam dizisinde sayfayı dondurabilecek bir fiyat deseni sınırlandı; yapay zekâ harcama sınırı, istekler aynı anda çalışırken artık aşılmıyor.
- **Kilit ekranındaki “Unuttum mu?” artık sizi her siteden de çıkarıyor** (tüm oturumların çerezleri, depolaması ve önbelleği); yalnızca kasadan, kimlik doğrulayıcıdan ve geçiş anahtarlarından değil. Notlar, yer imleri ve geçmiş kalır. Ayarlar metni bunu söylüyor.
- **Vex yalnızca kendi kurduğu Vencord klasörlerini siler.** Kendi Vencord derlemeniz ve Vex’in oluşturmadığı hiçbir klasör el sürülmeden kalır.
- **Yepyeni bir profil varsayılanlarını alır.** İlk açılıştaki tema yazımı kayıtlı veri olarak sayılıyordu; bu yüzden yeni bir kurulum var olan bir profil gibi ele alınıyor ve her yeni özelliği kapalı geliyordu. Son canlı denetimde bulundu ve düzeltildi.
- **Paketlenmiş uygulama başlıyor.** Ortak bir betik hazır olmadan bir genel değişkeni okuyordu; bu, paketlenmiş derlemede açılış paketini durduruyordu (kaynak derleme etkilenmedi). Son paketlenmiş denetimde bulundu ve bir testle düzeltildi.

### Discord belleği (yeni)
Vex’in Vencord’lu Discord paneli, düz Discord uygulamasından çok daha fazla bellek kullanır. Bu sürüm nedenini bulmak ve düşürmek için araçlar ekler: “Discord neden büyük?” (Ctrl+K), siz yanıtlayana kadar duran bir bildirim, isteğe bağlı kendi otomatik yenilemesi, isteğe bağlı bir dinlenme kipi, Discord düğmesinin menüsünde bir Vencord açık/kapalı öğesi, “10 dakika boyunca ölç”, “Önce Vencord’lu, sonra Vencord’suz ölç” ve **eklenti başına bellek** (“Eklenti belleğini ölç”, hızlı bir ayırma okuması ve teker teker eklenti sınaması ile). Eklenti belleği yöntemi eşleşen Vencord eklentisini gerektirir; docs/vencord-bridge.md içindeki Vencord dalı notlarına bakın.


### Önce bunu okuyun: veriyi silebilecek ya da davranışı değiştirebilecek şeyler
- **Recall artık sınırlara sahip (Ayarlar > Depolama).** Recall aramasında tutulan sayfa metni **12 MB**, **3000 sayfa** ve **90 gün** ile sınırlıdır. Bir sınıra ulaşıldığında ya da bir sayfa 90 günden eski olduğunda, EN ESKİ sayfalar bir sonraki açılışta ve bir sonraki kayıtta dizinden düşürülür. Bu, bu sürümü ilk başlattığınızda eski sayfaları arama sonuçlarından kaldırabilir. Üç sayıyı Ayarlar > Depolama’da değiştirin (recall:limits); Recall dizini dışında hiçbir şey silinmez.
- **Geçmiş araması varsayılan olarak yereldir ve hiçbir şey duyarlılık kapısı olmadan bulut yapay zekâya ulaşmaz.** Geçmiş, posta, banka, sağlık ve kasa sayfaları, özel sekmeler ve bir sır gibi görünen her şey geri tutulur ya da yerel modele gönderilir; geçmiş araması için kayıtlı bir “bulut” seçimi bir kez yerele taşınır (deftere yazılır). Bir istek yalnızca siz evet dedikten sonra ya da bilgi gizlendikten sonra gönderilir.
- **“haftaya Sali” artık her yerde gelecek takvim haftasının Salı gününü ifade ediyor** (iki Türkçe ayrıştırıcıdan birinde Cuma günü söylendiğinde 11 gün sonrasıydı). “ertesi gun” bir sonraki gündür.
- **Karantinalı ve dönen kopyalı ayar dosyası sağlama toplamı** (T0-012): hasarlı bir tercih dosyası bir kenara ayrılır ve son iyi kopya geri yüklenir, Sağlık’a bir satır eklenir.
- **Görev çubuğu düğmesindeki indirme yanıp sönmesi**, diğer her öne çıkarma ile aynı korumadan geçer: tam ekran bir oyun varken bunun yerine düğmede bir nokta görünür.

- **Dalga 3 varsayılanları.** Temel sekmeler ile Tüm sekmelerde metin bul için varsayılan bir tuş yoktur (Ctrl+Alt+E ve F, Her Şey ve Odak kipidir); bunları Ayarlar > Kısayollar’da atayın. Kilit için parolalar 128 karaktere kadar olabilir (PIN 4 ila 12 hane olarak kalır).

### Dalga 0-2 (Dalga 2 bütünleştiricisinin taslağından)
### Yeni: temeller (Dalga 0)
- Özellik başına bir bildirim dosyası (kimlik, depolama anahtarları, işler, komutlar, izinler, bütçe, olgunluk), “Dene” önerisiyle aşamalı etkinleştirme, özellik başına bir kesici ve maliyet sayacı, ağır iş zamanlayıcı ve “Vex bunu neden yaptı” (geri alma özellikli defter).
- Dikkat Bütçesi: dört aciliyet sınıfı, saatlik ve günlük sınırlar, yineleme engelleme ve sessiz bir Dikkat Gelen Kutusu (Yoksay / Daha az göster / Asla). Madalyalar, evcil hayvan, sesler, seriler, sekme oyunları ve canlı katmanlar için Eğlence düzeyi (Kapalı / Sakin / Tam).
- Bir işleme bütçesi olan Yeni Sekme yuvaları (kahraman, öncelik ve maliyete göre üç kart, tek bir alt satır). Sürümlü onay, bir kez çalışan taşımalar ve kimin seçtiğini bilen varsayılanlar.
- “Bu bilgisayardan ne çıktı”: Vex’in kendi giden isteklerinin sınırlı bir defteri; açılış çökmeleri tek bir özelliğe yüklenir.
- Sürüm kapıları: DRM/Widevine denetimi, sürüm el denetimi listesi, tam CI dizisiyle birleştirme treni, duman matrisi, yalnızca kendi Electron’unu durduran bir sınama düzeneği, bir oyun çalışırken ya da bellek azken ağır çalıştırmaları reddeden bir kapı.
- Ctrl+K her sağlayıcıyı yalıtır ve zamanlar, ilk satırları önce çizer; olaylar, genel değişkenler, IPC ve paketlenmiş require’lar için statik sözleşme testleri.
- Reddedilen ekran paylaşımları nedenini bir düzeltme düğmesiyle söyler; “Neden oturumum kapandı?”; e-posta kodu otomatik doldurma artık bir okuma yuvasını tutmuyor.

### Yeni: Oyun kipi ve yapay zekâ güveni (Dalga 1)
- Vex tam ekran bir oyunun üzerine asla çıkmaz, odak almaz, yanıp sönmez ya da ses çıkarmaz. Bir başlatıcı açıldığında ısınma sonrası soğuma, bir oyun başladığında işimi kaydet, oyun sonrası bir pit-stop kartı, isteğe bağlı oyun öncesi denetim listesi.
- Vex Ajanı güvenlik katmanı: sayfa metni veridir, bir çalıştırma bir hızda ilerler, her değişiklik defterdedir.
- Geliştirici döngüsü: GitHub salt okunur belirteç kasası, CI hata döngüsü, devlog taslakçısı, uç nokta sağlık panosu, bağımlılık radarı, dağıtım masası. Geliştirici yardımcıları: depo kayıt defteri, arama bang’leri, istek olarak kopyala, GitHub yardımcıları, komut çevirici, seçim çözücü, başvuru kümeleri.
- Günlük akış: vadesi gelenler, günün ilk açılışı, tek gelen kutusu, sonraki adım, park et ve sürdür, kaynağıyla kopyala, son tarih bulucu. Paneller: panellerden bildirimler, VIP kuralları, Bana gerek var, Uzakta kipi, teslim pencereleri, kapatma koruması.
- Sekmeler: yakınlığa göre Ctrl+Tab, sekme arama, Geri/İleri listesi, şerit hızlı eylemleri, gece koçu, duyuru masası, Türkçe metin işleme.

### Yeni: Dalga 2
- **Yapay zekâ (tamamı yalnızca yerel model):** kapsama oranı gösteren uzun belge motoru, uzun konuşma özeti (“son okuduğumdan beri”), kelime farkıyla odaklı alana taslak, gömme modeli yöneticisi, tam alıntıyla denetlenen “bana nerede olduğunu göster” kaynakçaları, kaynağı, kapsamı ve süre sonu olan yapay zekâ belleği, site başına kalıcı yönergeler ve türlü beceriler.
- **Sekmeler ve gezinme:** bulma seçenekleri, temiz bağlantı kopyalama, yazılan sayıyla tamamlama, açık bir sekmeye geç, metin parçası bağlantıları, etkinlik noktası, üstte tut, indirme hızı ve kalan süre, pencere kurtarma, görev çubuğu ilerlemesi.
- **Yakalama:** metin parçacıkları (“:addr” sonra Tab ya da Boşluk), tablo ve liste kopyalama, video dökümü/bölümleri/döngüsü, bülten şeridi, yeniden gün yüzüne çıkan vurgular, resim karartma ve gönderilmemiş form metninin 7 gün şifreli saklanması (Bitmemiş formlar).
- **Geliştirici masası ve tezgâhı:** geliştirme bağlantı noktaları, Actions panosu, günlük okuyucu, eklenti geliştirme döngüsü, düzenleyicide/terminalde aç, Electron göstergesi, sır yapıştırma koruması; hata raporu, yanıt geçersiz kılmaları, MCP seçim araçları, günlük izleyici, hata belleği, belge iğneleri, paket kartı, kod kitaplığı.
- **Kapılar ve güvenlik:** izin hijyeni, kapatma anahtarlı oturum açılmış siteler listesi, parola sayfası denetimi (benzer bir adreste parola yazmadan önce uyarır; Web güvenliği ile aynı algılayıcıyı kullanır), olay denetim listeleri, katman kaplama taraması, sürüm otomatik işaretleme, erişilebilirlik kapısı.
- **Çalışma ve Türkçe:** katı çalışma bloğu, sınav planlayıcı, sınav günü kipi, çıkmış sorular, dersler, ödev özeti, Model BM dosyası; hatırlatıcılarda, yakalamada ve son tarihlerde Türkçe tarihler ve tutarlar (iki ayrıştırıcının paylaştığı tek bir okuma), Türkçe/İngilizce çeviri yardımcıları.
- **Oyunlar ve günlük yaşam:** ikinci ekran, ses sahneleri, Game Control Center bağlantısı (Vex %APPDATA%\game-control-center\vex-bridge.json dosyasını okur; GCC henüz yazmıyor, bkz. docs/gcc-bridge.md), oyun yükleri, niyet kapısı, mola istemleri, siparişler, sınav ve kayıt tarihleri, fişler ve garantiler.
- **Günlük planlama:** artakalanlar (Bugün, Yarın ya da Bırak), tek bir “ne zaman” kutusu (“cum 17:00 okulda”), günü kapat, günün biçimi, zamana ve konuya göre bul, bu sekme neden açık, çalışma alanı başına ne değişti, gerçek kullanımdan odak bloğu uzunluğu, yinelenen işler ve faturalar, haftayı planla, haftalık ayıklama.

### Düzeltildi
- Sınav tarihleri ve metin parçacıkları artık başka bir özellikle depolama anahtarı paylaşmıyor (birbirlerinin listelerinin üzerine yazacaklardı).
- Bana gerek var artık Otomatik Pilot akışını okuyor (var olmayan bir genel değişkeni arıyordu).
- Yeni ana işlem dosyalarındaki birkaç lint bulgusu (hata nedenleri korundu, bir bayt sırası işareti kaçış olarak yazılmıştı).

---
### Dalga 3 ve sürüm incelemesi
Nasıl okunur: aşağıdaki neredeyse her yeni özellik, var olan bir profilde KAPALI gelir (Ayarlar’da ve Ctrl+K’de önerilir) ve yepyeni bir profilde AÇIK gelir; “Yeni profilde bile kapalı” altında listelenenler hariç. Minimal Vex hepsini kapatır ve geri koyar.

### Yeni

**Sakinlik ve denetim**
- **Dikkat Bütçesi, sessiz Gelen Kutusu, tek Eğlence düzeyi (Kapalı / Sakin / Tam).** Saatlik ve günlük sınırları olan dört aciliyet sınıfı; reddedilenler Dikkat Gelen Kutusu’na Yoksay / Daha az göster / Asla ile düşer. Tek bir “dikkat durumu” (oyun, ekran paylaşımı, sınav, toplantı, odak, çalışma, uzakta, sessiz saatler, sakinleşme, seyahat, sessiz anahtar) Vex’in ne zaman sessiz kalacağına karar verir.
- **Özellik başına bir bildirim dosyası, “Vex bunu neden yaptı”, özellik başına bir kesici ve bir maliyet sayacı.** Başlamayan özellikler adlarıyla anılır ve tek başlarına dışarıda bırakılır; ağır işler (dizinleme, OCR, yerel yapay zekâ, ses) boştayken tek tek çalışır ve Oyun kipinde asla çalışmaz.
- **Bir işleme bütçesi olan Yeni Sekme yuvaları**: bir kahraman, öncelik ve maliyete göre üç kart, tek bir alt satır.
- **Özellik sayfası, “Senin için yeni”, niyet araması, kullanım sayıları, depolama defteri, “Verileriniz”, kaynak çipi, tanı paketi, önizleme listesi** (Dalga 3 temelleri). Bir açılış bütçesi denetimi ve açılıştan sonra yüklenen modüller açılışı hızlı tutar.
- **Sürüm incelemesi.** Bir güncellemeden sonra (ve ondan sonraki ilk açılışta bir kez) kısa bir kart, çalıştırdığınız sürümü puanlamanızı ister: 1-5 arası 7 kategori, etiketler, 500 karakterlik bir yorum. Güncellemeyi asla engellemez. Tamamlanan bir inceleme sürüm başına bir kez XP ve “Söz hakkınız” ile “Beş sürüm üst üste” madalyalarını kazandırır. İncelemeler bu bilgisayarda kalır (50 tanesi tutulur; metin olarak kopyala, unut). Bir röleye gönderme KAPALIDIR; kendi https röle adresinizi ve tek seferlik bir onayı gerektirir.

**Oyunlar ve Oyun kipi**
- Oyun kipine önerilen yüklü oyunlar, oyun öncesi denetim listesi, oyun sonrası pit-stop, bir başlatıcı açıldığında ısınma sonrası soğuma, bir oyun başladığında işimi kaydet, ikinci ekran, ses sahneleri, yükler, mola istemleri, GCC köprü durumu, yama özeti, durum denetimi (“ben miyim, oyun mu?”), sıfırlama ve sezon zamanlayıcıları, ödül masası, içerik panosu, yazı masası, ağ nezaketi.
- Vex tam ekran bir oyunun üzerine asla çıkmaz, odak almaz, yanıp sönmez ya da ses çıkarmaz; indirme yanıp sönmesi ve bildirimler bekler.

**Yapay zekâ**
- Hiçbir şey duyarlılık kapısı olmadan bulut yapay zekâya ulaşmaz (geçmiş, posta, bankalar, sağlık, kasa sayfaları, özel sekmeler, sırlar) ve geçmiş araması varsayılan olarak yereldir.
- Uzun belge motoru, konuşma özeti, alana taslak (asla göndermez), gömme modeli yöneticisi, “bana nerede olduğunu göster” kaynakçaları, site başına yönergeler ve türlü beceriler, kaynağı ve süre sonu olan yapay zekâ belleği, tek sade yapay zekâ yol denetimi, yapay zekâ tarifleri, izleme yargısı.
- Diğer arka uçta bir kez yeniden dene (sesli söylenir, duyarlılık kapısını ya da sınırı asla aşmaz), bulut yapay zekâ çağrıları için günlük bir sınır, sayfa metnine göre anahtarlanan bir özet önbelleği (duyarlı ya da özel sayfalar için asla).

**Çalışma ve Türkçe**
- Katı çalışma bloğu (60 saniye ve yazılan bir nedenden sonra çık, asla bir kilit değil), sınav planlayıcı ve sınav günü kipi, çıkmış sorular, dersler, ödev özeti, Model BM dosyası ve araç takımı, konuşma zamanlayıcı, sözlük kartları, çalışma defteri, kopya kâğıdı, taslak / müfredat / kaynak denetimleri, bir şey kaydedilmeden önce onay satırı olarak gösterilen Türkçe tarihler ve tutarlar (“12 Ekim”, “yarin aksam 8'de”, “1.250,50 TL”), Türkçe ve İngilizce yazım denetimi, çeviri yardımcıları.

**Günlük yaşam ve planlama**
- İş gününü sürdür, odak profilleri, Sabah Özeti bölümleri, artakalanlar, tek “ne zaman” kutusu, günü kapat, günün biçimi, haftalık ayıklama, hafta planı, yinelenen işler, ritüeller, takipler, iki dakikalık çekmece, hafta içi kümesi, son tarih defteri, seyahat kipi, site başına kapsayıcılar, gider yakalama, sayfa hatırlatıcıları, tatil planlayıcı, TL karşılığı (banka kurları yalnızca Getir’e bastığınızda çekilir).

**Sekmeler ve gezinme**
- Yakınlığa göre Ctrl+Tab, sekme arama, Geri/İleri listesi, şerit hızlı eylemleri, kaydırma belleği, temel sekmeler, otomatik kaydırma, sabitlenmiş ana sayfa, başarısız sayfa seçenekleri, düz yapıştırma, tüm sekmelerde metin bul, birkaç sekme seç, anında uyandırma resmi, önceden bağlan, mini pencere, tutulan genişlikler, bağlantı ve sekme ipuçları, sekme adları, bölünmüş görünüm tuşları, atlama listesi, tüm pencere kümesini geri yükle, hareket düzenleyici.
- Yeni tuşlar: Ctrl+Alt+O / Ctrl+Alt+Y (bölünmüş görünümde sonraki bölme / değiştir), Ctrl+Alt+I (bağlantı ipuçları), Ctrl+Alt+Q (sekme ipuçları). Temel sekmeler ile Tüm sekmelerde metin bul için varsayılan tuş yoktur (ilk tercihleri Her Şey ve Odak kipi tarafından alınmıştı): Ayarlar > Kısayollar’da bir tane verin.

**Yakalama, kaynaklar ve geliştiriciler**
- Alıntı stilleri, BibTeX ve DOI aramasıyla kaynak listesi, alıntıda arşivle, medya denetimi, telefonla paylaş, çalışma notları, PDF vurguları, yerleşik bir PDF araç takımı (birleştir, ayıkla, döndür, böl; hiçbir yol pencereden gelmez).
- Geliştirici masası (geliştirme bağlantı noktaları, Actions panosu, günlük okuyucu, eklenti geliştirme döngüsü, Electron göstergesi, sır yapıştırma koruması), geliştirici tezgâhı, GitHub salt okunur belirteç kasası, CI hata döngüsü, depo kayıt defteri, OpenAPI içe aktarmalı API oyun alanı, yerel hizmet başlatıcısı ve web kancası denetçisi, Cloudflare bağlantıları, Roblox çözücü.
- Topluluk ve sohbet araçları: saat dilimi yardımcısı, okunmamışı göreve çevir, toplantı bağlantıları, gürültü kuralları, duyuru yazıcısı, topluluk sayıları, bağlantı toplayıcı, moderatör takımı, bir web kancası kasası ve bir Vencord köprü dosyası okuyucusu. Onayınız olmadan hiçbir şey bir sohbeti okumaz ya da gönderi yapmaz; Discord durumu yalnızca önerilir ve kopyalanır.

**Daha güvenli gezinme ve güvenlik (tamamı isteğe bağlı)**
- Konuk oturumu, uzantı farkı ve duraklatma, yapıştır-ve-çalıştır tuzağı, açılış denetimi, güvenli kilit seçenekleri (128 karaktere kadar parolalar), yuva izleyici, fotoğraf hazırlayıcı, form yardımcısı, izin hijyeni (saklanan izinler sabitlenmedikçe N gün sonra biter), “nerelerde oturum açtım” ve bir kapatma anahtarı, parola alanı kilidi, olay denetim listeleri, hile ve sahte güncelleme koruması, çerez bandı reddetme ekstraları, kasa hijyeni, pazar yeri işaretleri, sohbet bağlantısı bayrağı, QR kararı, “Windows Güvenliği ile tara”, web işareti denetimi, ekran paylaşımı güvenli kipi.

### İyileştirildi
- **Recall artık sınırlı: 12 MB, 3000 sayfa ve 90 gün.** Bir sınıra ulaşıldığında önce en eski sayfalar düşürülür. Artık yinelenen .bak yok ve sayılar Ayarlar > Depolama’da görünür. Daha fazlasını tutmak isterseniz sınırları orada yükseltin ya da düşürün.
- İndirmeleri toparlama ve yeni mod masası, taşımalar boyunca “internetten indirildi” işaretini korur; korunamayan bildirilir.
- Kaydedilen medya için gerçek dosya adları, bir sürüm indirme yardımcısı (boyut, SHA-256, yalnızca özet içeren bir VirusTotal bağlantısı, eski kurulum dosyaları), Minecraft jar dosyalarını yükleyiciye ve oyun sürümüne göre dosyalayan (önizlenir, geri alınabilir) bir mod masası.
- Ayar dosyası sağlama toplamı, karantina ve dönen kopyalar; Ctrl+K her sağlayıcıyı yalıtır ve zamanlar; reddedilen bir ekran paylaşımı nedenini söyler; sağlık, sürüm başına çökmeleri gösterir.
- Paket akışları tek bir nazik çekme istemcisini paylaşır.
- Hatırlatıcılar, yakalama ve son tarih bulucu genelinde tarihler, saatler ve tutarlar için tek bir Türkçe okuma.

### Düzeltildi
- İki özelliğin paylaştığı birkaç depolama anahtarının (sınav tarihleri, metin parçacıkları) artık her birinin tek bir sahibi var.
- Gönderilmemiş metin içeren kapatılmış sayfalar onu 7 gün şifreli tutar (Bitmemiş formlar).
- Fiyat izleyici yalnızca değişiklikleri değil, her denetimi sayıyor.
- Öğe yok edici duyarlı sayfaları reddeder ve öğe başına geri almaya sahiptir.
- Tüm takımı çalıştırarak bulunan birleştirme düzeltmeleri (bkz. işlem listesi).

### Yeni profilde bile kapalı
Oyun öncesi denetim listesi, geçici sohbet oturumu, konuk oturumu, uzantı farkı, yapıştır-ve-çalıştır tuzağı, açılış denetimi, güvenli kilit seçenekleri, yuva izleyici, fotoğraf hazırlayıcı, form yardımcısı, yerel hizmet başlatıcısı, web kancası denetçisi.

### Güvenlikle ilgili notlar
- Özel pencereler: ana profile yazan her yeni kanal onlara kapalıdır (IPC ilkesi bunları listeler); yerel hizmet başlatıcısı bir programı yalnızca bir bağımsız değişken dizisiyle ve kabuk olmadan başlatır ve yalnızca canlı yolu, komut satırı ve başlangıç zamanı Vex’in başlattığıyla eşleşirse durdurur.
- Sürüm incelemesi, bir röle ayarlayıp onay vermedikçe hiçbir şey göndermez; duyuru web kancası adresi işletim sistemi tarafından mühürlenir ve pencereye asla geri verilmez.
- Yeni çalışma zamanı bağımlılığı: pdf-lib (@pdf-lib/standard-fonts, @pdf-lib/upng, pako ve tslib 1.14.1 ile); lisanslar THIRD_PARTY_NOTICES.md dosyasına eklendi.
- Türkçe klavyeler: Ctrl+Alt, bazı düzenlerde AltGr’nin gönderilme biçimidir. Ctrl+Alt+Q ve Ctrl+Alt+I (sekme ipuçları ve bağlantı ipuçları), Türkçe Q düzeninde komutu çalıştırmak yerine “@” ya da noktasız bir i yazabilir. Bu olursa Ayarlar > Kısayollar’da yeniden atayın.

### Dalga 4: sadeleştirme, birleştirmeler ve keşfedilebilirlik (integration-7)

#### Önce bunu okuyun (Dalga 4)
- **Aşamalı etkinleştirme artık bir profili kullanım kaydına göre değil, kaydettiklerine göre değerlendiriyor.** Daha eski bir profil (kayıtlı sekmeler, yer imleri, geçmiş, notlar, bir oturum açma ya da yasal kabul vb.) var olan bir profildir; bir kez karar verilir ve hatırlanır. Dalga 3 ve Dalga 4’ün tümü dahil her `new` ya da `beta` özellik orada KAPALI gelir; yepyeni bir profil her özelliğin kendi varsayılanını korur. “Dene” önerileri kayan herhangi 7 günde 3 ile sınırlıdır ve bu tek bütçe “Senin için yeni” satırı ve “gerekene kadar gizli” önerisiyle paylaşılır; böylece asla bir akışa dönüşmezler.
- **Ajan ekran görüntüleri artık her çağrıda soruyor** (görüntü duyarlılık kapısı): bulut yapay zekâya giden bir istekteki resim hakkında, önizlemede bir küçük resimle sorulur.
- **İndirmeyi sürdürme isteğe bağlıdır ve KAPALIDIR** (Ayarlar > İndirmeler). Yalnızca normal bir profilin indirmeleri sürdürülür; ayar kapalıyken yeniden başlatma için tutulan kısmi dosyalar kaldırılır.
- **Yerleşik paketler imzasızdır ama özetle sabitlenmiştir** (dört dosya, ayrılmış `vex-builtin.` kimliği): istem kitaplığı, daha fazla olay denetim listesi, Model BM ifadeleri, Türkiye tatilleri.
- **Sohbet bağlantısı hijyeni ve haftalık ihlal yeniden denetimi varsayılan olarak KAPALIDIR.** Hizmet durumu özet kartı varsayılan olarak kapalıdır ve Oyun kipinde asla gösterilmez.
- **Jingle yuvaları sessiz kalır:** Basit kipte, Odakta, bir toplantıda, pil tasarrufunda, Oyun kipinde ve hareketi azaltırken. Varsayılan olarak hiçbir ses açık değildir.
- **Atlatma denetimi:** açılış sınaması (her açılıştan sonra discord.com’a bir istek) siz açana kadar her profilde KAPALIDIR.

#### Yeni (Dalga 4)
- Varsayılan olarak sessiz: YENİ bir profil zamanlayıcı, kronometre, Yer imleri, Vurgular ve Akışlar panelleri, site başına koyu kip ve güçlendirmeler gözden uzakta başlar (Ayarlar > Gerekene kadar gizli, “Her şeyi göster”, Dikkat Gelen Kutusu’nda haftada bir öneri). Var olan bir profil daha önce gördüğü her şeyi görür. “Senin için yeni”, sahibi olan özelliği tanıttığında gizli bir parçayı geri getirir.
- Eğlence karantinası: her eğlence modülü kapısıyla listelenir; sürüm incelemesi de listelenir.
- Kullanımdan araçlar: gerçekten kullandıklarınızdan önerilen iş araçları.
- FlashMind giriş noktaları (çalışma girişi), kitaplık bağlantıları, sabitlenmiş ajan görevleri, sesli yanıtlar.
- Daha güvenli web: Türkçe marka listesi, izin istemlerinde “bir site neden istiyor” satırı, kendini açıklayan indirmeler (downloads:explain), sohbet bağlantısı hijyeni, üçüncü taraf sayısı, uzantı oturum satırı, haftalık ihlal yeniden denetimi, yedek denetimi.
- İçerik: paket tatilleri ve ifadeleri, izleme şablonları (koltuklar, bilet fiyatları, istek listesi düşüşü, indirim tarihi), “siz oynarken tutulanlar” listesi, dört özet kartı, deneme yakalama ve aylık yönetim hatırlatıcısı, “Tut” düğmeli sekme temizlik nedenleri.
- Boşluklar: indirmeler yeniden başlatmadan sonra sürer (isteğe bağlı), dosya türü başına varsayılan klasör, bir zamanlayıcı adlandırılmış bir komut zincirini çalıştırabilir (komut çubuğu adımları, adımların tam olarak onaylanmasını gerektirir), panel durum şeridi Otomatik Pilot’un kaç şeyi tuttuğunu söyler, Düzeyler toparlamayı, notları, biten görevleri ve okumayı duyar, `api:request` isteğe bağlı bir `egress` etiketi alır.
- Keşfedilebilirlik: her özellik için bir katalog girdisi, uzun bir açıklama ve bir belge satırı (docs/FEATURES.md, 296 özellik), ayrıca bir tur ve özellik bul.

#### Düzeltildi (Dalga 4)
- **Netflix, Prime Video ve Disney+ artık her açılışta oturumunuzu kapatmıyor**: her açılışta Netflix bölümünü silen blok kaldırıldı.
- Mikrofon ve kamera, reddettikten sonra sekmelerde ve kenar çubuğu panellerinde artık “reddedildi” olarak okunuyor (“sor” değil).
- Gmail’in panel rozeti yine “Inbox (6,693) - ...” başlığını okuyor.
- Akşam sekme temizliği kartı, nedenleri olan sekme başına listedir (sekme başına bir işaret).

### Dalga 5 (integration-8)

#### Önce bunu okuyun (Dalga 5)
- **Ayar dosyaları bir sağlama toplamı zarfı taşır** (`$vexStore`): her JSON deposunda şema sürümü ve sağlama toplamı, sır dosyaları bir kenarda tutulur, daha yeni dosyalar reddedilir (T0-012). Hasarlı bir dosya bir kenara ayrılır ve son iyi kopya geri gelir.
- **Yapay zekânın nerede çalıştığı tek bir kayıtlı ayardır** (`vex.aiRoute`: otomatik, yerel ya da bulut). İki eski anahtar (yereli tercih et, her zaman bulut) açılışta bir kez birleştirilir; ikisi de kayıtlıysa Her zaman bulut kazanır, yönlendirici zaten böyle yapıyordu. Kayıtlı her seçim korunur.
- **Sıklık ve yakınlığa göre komut sıralaması herkes için geçerlidir** (Ctrl+K, bir Sıfırla ve “bu neden burada” satırıyla). Eski `vex.commandUsage` anahtarını okur.
- **İzleyiciler interneti tek bir nazik istemci üzerinden sorar** (ana makine başına hız sınırı, Retry-After geri çekilmesi, soran kişiye göre anahtarlanan ETag önbelleği, ölçülü bir hatta sessiz). Bir belirteç kaydettiyseniz GitHub okumaları belirteç kasasından geçer, aksi halde herkese açık istekler olarak aynı istemciden geçer.
- **Açılış**: 18 modül daha açılıştan sonra yükleniyor (Dalga 5’in kendisinden önce 693’ten 675 engelleyici betiğe); duman çalıştırması artık bir DOM düğümü sınırı ve açılış işareti tavanları tutuyor. 16 ham zamanlayıcı VexJobs’a taşındı (kademeli izin listesi 43 dosya / 55 yerden 30 / 39’a düştü).
- Günlük, defter, oyun günlüğü, zaman çizelgesi, yakalama günlüğü, özet önbelleği ve yapay zekâ belleği için **saklama sınırları** (Ayarlar > Depolama): önce bir uyarı, en eskiden başlayarak kırpma, Geri al.
- **Türkçe**: 478 başlık, çip ve komut daha, sayfa iletişim kutuları, tarihler ve çoğullar arayüz diline uyuyor.

#### Yeni (Dalga 5)
- Temeller: kilitlenmesiz pencereden sonra bir öneriyle Deneysel katman; kullanım sayılarına dayanan Basit / Standart / Güçlü kadranı (varsayılan olarak kapalı, kullandığınız hiçbir şeyi gizlemez, önce liste, Geri al); görünüm matrisi testi; kaplama sayımı kademesi; katman yöneticisinde iletişim kutuları, bildirimler, bağlam menüleri ve açılır pencereler; tanı paketinde ekran kartı ve reddedilen iletiler.
- Yapay zekâ ve güvenlik: çıkarımsal son basamaklı ve “Şunda çalışıyor” satırlı yedek merdiven; her yanıtta nedeniyle birlikte aylık bütçe, görev ve kalite yönlendirmesi; her yapay zekâ yanıtında, taslakta ve özette kaynak çipi; yerel model araçları (kendi görevlerinizde bir uygunluk ölçütü, pencerelerinizde sıcak bir model); okuyucu görünümü daha sade yeniden yazabilir (yalnızca yerel model); yapay zekâ tarifleri hatırlatıcıları çaldığında kendi kendine çalışabilir; toplu sekme kapatmalar, zincirler, otomasyonlar ve ajan çalıştırmaları için önce listeli onay; sahte tarayıcı güncelleme kaplamaları için indirme koruması içerik denetimi ve pasif uyarı; konuk oturumu geçici çalışma alanı; kurtarma e-postası zinciri ve haftalık özetle kasa hijyeni; açılış denetimi imzasız programları işaretleyebilir; web işareti açılmış arşiv dosyalarına taşınır; ekran paylaşımı güvenli kipi kasa tekliflerini ve Yeni Sekme geçmiş listesini de tutar; her seçiciden önce ekran paylaşımı ön denetimi.
- Geliştirici araçları: işletim sistemi tarafından mühürlenen sır kasalı API oyun alanı (değişkenler ana işlemde doldurulur), tek bir sekmenin isteklerinden istek olarak kopyala, seçim çözücü (errno, NTSTATUS, EFI, HTTP, sinyaller, cron), PDF araç takımı (işaretle, form doldur, imza resmi, yeniden paketle), eklenti geliştirme döngüsü (Vencord derlemenizi Discord’a yeniden yükle, konsol tepsisi), sürüm denetimi işaretleri, panel koruması yavaşlatma ve grafik işlemi, radarda daha zengin devlog ve sürüm notları, sahte güncelleme koruması, rastgele boş bir bağlantı noktasında web kancası denetçisi.
- Oyunlar: oyun sonrası pit stop (yama notları, bedava oyun, kaçırılan Discord, Sürdür, dosya önerisi), oyun öncesi denetim listesi (yakın zamanda yamalandı mı, sunucular açık mı, çalışma dakikaları sayılır), kodları ve süre sonu olan ödül listesi, ikinci ekranda sıfırlama zamanlayıcıları, abone olunan kanallar için Discord gürültü araçları ve bağlantı toplayıcı, Roblox çözücü, yuva izleyici geri sayımı, site ses belleği (ses düzeyi dengeleyici, isteğe bağlı).
- Çalışma: öğrenci okuma yardımcıları (yerel sözlükçe üzerine gelme, bilinen sözcükleri grileştirme, kelime hazinesi; İngilizce ve Türkçe; varsayılan olarak kapalı), arXiv ve ISBN aramaları, yerel yağmacı yayıncı listeli kaynak denetimi çipi, çevrimdışı başvuru kümeleri, dersler konu görünümü, sınav ücreti son tarihleri, taslak denetimi değerlendirme ölçeği, video slaytları OCR’ı ve bölüm özetleri, Daha önce görüldü (Recall’dan anlam eşleşmesi), Kurulum Galerisi önizlemeleri.
- Günlük: okuma ayıklama odak bloğunu ve bitirme oranını tartar; uzun bir makaledeki yer sekmeden daha uzun yaşar, ince bir ilerleme çubuğuyla; hatırlatıcılar tatilleri atlayabilir; iki dakikalık çekmece kartı; gün biçimi yük sayacı; seyahat kipi zamanlı hatırlatıcıları kaydırır; daha fazla kargo şirketi ve bir zaman çizelgesiyle siparişler merkezi; takip defteri yazdığınız sözleri önerir; sekmeyi yeni pencereye taşı; bölmek için sekmeyi sayfaya sürükle; duyurular için aşamalı şimdi gönder bildirimi (asla kendiliğinden göndermez); kuyruk botu ekleme uç noktası BLOCKED-EXTERNAL durumundadır (docs/queue-bot-add-endpoint.md).

#### Düzeltildi (Dalga 5)
- Resim karartma aracı artık URL ve metin karartıcısıyla VexRedact adını paylaşmıyor (Hata raporunu kopyala ve Üst veriyi kaldır yeniden çalışıyor).
- Geçici çalışma alanı ve konuk rozetleri katman yöneticisinde.
- integration-7’den kalan test hataları (sessiz varsayılanlar olayı, niyet araması, yapay zekâ paneli kabuğu, yerel ayar bütünlüğü, ayar hijyeni) final-int7 üzerinde nedenlerinde düzeltildi.

#### Yeni profilde bile kapalı (Dalga 5)
Her yeni, beta ve deneysel Dalga 5 özelliği (yetenek kadranı, okuma yardımcıları, yerel model araçları, depolama saklaması, API oyun alanı, sahte güncelleme koruması ve diğerleri) eski tarz bir profilde KAPALI başlar; aşamalı etkinleştirme testi bunu kanıtlar.

### Dalga 6 (integration-9)

#### Önce bunu okuyun (Dalga 6)
- **Şifreli profil kilidi (T3-123, isteğe bağlı, varsayılan olarak kapalı).** Ayarlar > Güvenlik, ayar dosyasını ve kişisel depoları (sekmeler, gruplar, yığınlar, kısayollar, eşitleme kayıtları) bir parola ve bir kez gösterilen bir kurtarma koduyla şifreleyebilir. Vex herhangi bir şey okumadan önce küçük bir pencere parolayı sorar. Bir dosyayı değiştirmeden önce doğrulanmış bir anlık görüntü alır ve herhangi bir düz metin kaldırılmadan önce her dosya geri çözülüp karşılaştırılır; düz dosyalara dönüş vardır. Güncellemeler çevresinde alınan yedekler tasarım gereği düzdür (profil şifreliyken Vex ilk açılış yedeğini atlar). İki başlatma bayrağı (Bellek tasarrufu, Düzgün kaydırma) kilit açma penceresinden önce okunur ve profil şifreliyken yok sayılır. Hem parolayı hem kurtarma kodunu kaybederseniz veri gider.
- **Kendi sesinizden toplantı dökümü (isteğe bağlı).** Bir toplantı yardımcı oturumu sürerken, “Sesimi dinle” her seferinde onayladığınız bir kutudan sonra yalnızca mikrofonunuzu açar (asla görüşmeyi ya da ekranı değil) ve açıkken Vex’in üstünde bir çubuk görünür. Konuşma 30 saniyeye kadar parçalara bölünür ve seçtiğiniz yerel bir program ve model dosyası (whisper.cpp) tarafından metne çevrilir; hiçbir yere hiçbir şey gönderilmez.
- **Discord durumu kendi Vencord eklentiniz tarafından ayarlanabilir (isteğe bağlı).** Vex köprü klasörüne tek bir komut dosyası (`vex-status.json`, biçim vex-status/1) yazar; kendi ayarlarında da izin vermeniz gereken eklenti, özel durum metnini ve emojisini ayarlar ve eskisini geri koyar. Vex asla bir Discord belirteci tutmaz. Bir istemci modu kullanmak Discord’un şartlarına aykırıdır.
- **Sürüm denetimi, bu sürümün yeni özelliklerini satırlarını işaretleyene kadar kapalı tutabilir (isteğe bağlı).**
- **Açılış bütçesi:** 667 engelleyici betik (19 modül daha geç listeye taşındı, beş Dalga 6 betiği eklendi).

#### Yeni (Dalga 6)
- Discord bellek bakımı: duran bir bildirim, kendi otomatik yenilemesi, bir Vencord anahtarı ve raporda öneriler; “10 dakika boyunca ölç” (Vencord kapalı sonra açık da); gizli bir Discord sayfasında Discord dinlenme kipi ve daha hafif bir video taraması.
- Sayfada tam sözcük bulma (bulma çubuğundaki “ab” düğmesi), kendi vurguları, sonraki/önceki ve sayısıyla.
- Şimdi tara: tam komutu gösteren bir onaydan sonra Microsoft Defender’ın tarayıcısını indirilen ya da seçilen tek bir dosyada çalıştırır. İndirilen .zip/.tar/.tgz arşivleri için “Buraya çıkar”, yazdıklarına web işaretini taşır; RAR ve 7z arşivlerinin dosya listeleri başlıklarından okunur.
- Hizmet başlatıcısı: kendi program izin listeniz ve sabit QEMU tarifleri.
- Ağ nezaketi, arka plandaki YouTube videolarını düşük kalitede tutabilir (isteğe bağlı).
- Sınav takvimi, ÖSYM’nin 2026’nın geri kalanı için yayımladığı tarihleri her biri kaynağı, okunduğu gün ve bir “doğrula” bayrağıyla birlikte getirir.
- Açılış denetimi, zamanlanmış görevleri ve Başlangıç klasörü kısayollarını programlarına çözer ve imzaları denetler. Yapay zekâ belleği için isteğe bağlı bir yaş sınırı.
- Geçmiş panelinin anahtar sözcük süzgeci önce ortak arama dizinine sorar.

#### İyileştirildi / Düzeltildi (Dalga 6)
- Her yerel ya da cihaz üzerindeki model çağrısı, “ai-ask” olarak VexJobs.heavy üzerinden geçer; VexJobs’a 14 zamanlayıcı daha; doğrudan showToast’a karşı bir kademe ve kapıdan geçen dokuz istenmemiş bildirim.
- Geç yüklenen bir modül düzgün aşamalandırılır: var olan bir profilde açılıştan sonra gelen yeni bir özellik KAPALI biter (VexRegistry.restageLate).
- Kalan her position:fixed kaplaması ya katman yöneticisinde ya da bir pencere kaplaması olmadığı belirtilerek işaretli.
- Uzantı güncelleme denetimi nazik istemciden geçer; Yenilikler yedeği GitHub’ı kasadan okur; diğer JsonStore dosyaları için şema sürümleri.
- Dalga 5 birleştirmesinden sonra anahtarları hiç kaydolmayan on altı Dalga 5 özelliği artık kaydoluyor.
- Tek bir uzantıyı tek bir sayfada duraklatma ve panel başına grafik rakamı Electron ile mümkün değil; ikisi de denetlendi, belgelendi ve testlerle sabitlendi.
- Eşlikçi röle işleyici testleri ve üç röle için tek bir sahip dağıtım kılavuzu (docs/RELAYS_DEPLOY.md).

#### Yeni profilde bile kapalı / yeni anahtarlar (Dalga 6)
- Şifreli profil kilidi, Sesimden toplantı dökümü, Discord bellek bakımı (ana anahtarı yepyeni bir profilde açık gelir ve var olan bir profil için kapalıya aşamalandırılır) ile Discord durumu, Ağ nezaketi, Sürüm denetimi, Yerel hizmetler ve Defender kısayolu üzerindeki yeni seçenekler var olan bir profilde KAPALI başlar.

#### Dalga 6’da ayrıca (ikinci grup)
- **Discord’da eklenti başına RAM (Vex tarafı):** “Discord eklenti geri yükleme” işi, `discord-plugin-ram` komutu ve üç yeni kanal (discord:heap-begin/-end/-usage, yalnızca Vex penceresi); `vex.discordCare` bir ölçüm için kapatılan Vencord eklentisinin geri konması için bekleyen geri yükleme alanı kazanır.
- **PDF:** Resimleri küçült (büyük görselleri daha düşük kalitede yeniden kodlar, yeni `pdf-images.js`); Türkçe harflerin değiştirilmeden doldurulabilmesi ve işaretlenebilmesi için bir Unicode yazı tipi (yeni bağımlılık @pdf-lib/fontkit 1.1.1, bkz. THIRD_PARTY_NOTICES).
- **Ekran paylaşımı bekletmesi:** geçiş anahtarı seçici, 2FA kodları, e-postayla gelen kodlar ve yapay zekâ oturum açma da siz paylaşırken bekler (vex.shareHold). **Yuva izleyici**, zaten açık olan bir rezervasyon sekmesine bakabilir (vex.slotTab). Ajan araçlarının kaydettiği notlar nereden geldiklerini taşır; Klip gelen kutusu girdileri damgalanabilir; Odak bloğu planı; uzun belgeler için okuma özeti; metin belgesi karartma.
- **Çalışma:** daha büyük İngilizce kelime listesi ve Türkçe ek kuralları (reading-aids-lists.js, turkish-lemma.js), ikisi de açılıştan sonra yüklenir.
- **Yapay zekâ para bütçesi (ai-money, var olan profiller için kapalı):** fiyat tablosu, aylık para bütçesi, kalite geçmişi, tarif hedefleri, model uygunluğu aracında “... için X kullan”; Sekme yapay zekâ planı, grup önerisi ve yeniden biçimlendirme bildiriminde kaynak çipleri ve tarifler tarafından kaydedilen notlar ile Klip girdilerinde bir kaynak satırı.
- **Günlük:** YouTube altyazıları, ses düzeyi dengeleyici sıralaması, Shift+Enter özel pencere açar (vex.tabsNav.shiftEnter), özel pencere aç isteğe bağlı bir adres alır, kargo şirketi belleği (vex.orders.carrierMemory).
- **İngilizce çoğullar** tek bir yardımcıdan geçer (vex-plural.js): 393 elle yazılmış ek bir kod dönüştürücüyle taşındı, bir kademeyle korunuyor.
- **Açılış bütçesi:** 672 engelleyici betik.

## v22.24.6 (2026-10-16) — Vex hareketsiz tutulurken Ctrl+K çalışıyor

### Düzeltildi
- **Ctrl+K artık ekranı bulandırıp hiçbir şey göstermiyor.** Oyun kipi / “Vex’i hareketsiz tut” etkinken Vex her animasyonu duraklatıyordu; bu, komut çubuğunun belirme animasyonunu bulanık arka planın altında ilk, görünmez karesinde donduruyordu. Vex hareketsiz tutulurken animasyonlar artık anında bitiyor; böylece çubuk (ve belirerek açılan diğer her pencere) tamamen görünür oluyor.

## v22.22.1 (2026-10-15) — Yapay zekâ haberleri varsayılan olarak İngilizce ve tarihli, ve Discord ekran paylaşımı yeniden çalışıyor

### Yeni
- **Yapay zekâ haberleri seçtiğiniz dilleri korur (Ayarlar › Yapay Zekâ Haberleri › Diller).** Varsayılan olarak yalnızca İngilizce; daha fazlasını eklemek için Türkçe, Çince ya da Diğer dilleri işaretleyin. İşaretlenmemiş bir dildeki haber asla saklanmaz, size söylenmez, rozette sayılmaz ya da bir kural tarafından bakılmaz ve zaten tutulan biri kaldırılır. Hiçbir dil belirtmeyen bir haber İngilizce sayılır. Hiçbir şey çevrilmez ve panel kaç haberin dışarıda bırakıldığını söyler.

### İyileştirildi
- **Yapay zekâ haberleri paneli: bir haberin ne zaman çıktığını görün ve tarihe göre süzün.** Her haber ne kadar eski olduğunu (“12 dakika önce”, “dün”) ve yerel tarih ve saatini (“Oct 15, 7:41 PM”; tarihi olmayan bir haber “tarih bilinmiyor, ilk görülen ...” der) söyler. Yeni “Tarih” süzgeci (Her zaman, Son saat, Bugün, Son 24 saat, Son 3, 7 ya da 14 gün; varsayılan olarak Her zaman) ve “Sırala” (En yeni önce, En önemli önce, Okunmamış önce). Bir satır en yeni ve en eski tarihle birlikte “300 haberden 12’si gösteriliyor” der, süzgeçleriniz Vex açıkken korunur, biri ayarlıysa “Süzgeçleri temizle” görünür ve uzun bir liste “Daha fazla göster” ile 100 haber gösterir.

### Düzeltildi
- **Discord ekran paylaşımı artık “Requesting page changed” hatasıyla başarısız olmuyor.** Vex’in paylaşım seçicisi, sayfanın adresinin tamamı isteği yapandan farklı olduğunda seçiminizi reddediyordu ve Discord bir paylaşım başlarken adresini yeniden yazıyor. Artık yalnızca sayfanın hâlâ aynı sitede olduğunu denetliyor.

## v22.10.8 (2026-10-15) — Yapay zekâ haberleri: seçtiğiniz yapay zekâ haberleri, seçtiğiniz şekilde ulaşıyor

### Yeni
- **Yapay zekâ haberleri (Ayarlar › Yapay Zekâ Haberleri, siz açana kadar kapalı):** Vex, takip etmeyi seçtiğiniz yeni yapay zekâ haberlerini size bildirir. Takip edeceğiniz ya da sessize alacağınız konuları, şirketleri, modelleri, kaynakları ve sözcükleri seçin, bir en düşük önem düzeyi belirleyin ve nasıl bilgilendirileceğinizi seçin: bir Windows bildirimi (Aç ve “Bu kaynağı sessize al” düğmeleriyle; Aç haberi yeni bir sekmeye koyar), Vex içinde bir açılır pencere, bakmadığınız haber sayısını gösteren bir araç çubuğu rozeti ya da günlük bir özet. Sessiz saatler (akşamdan sabaha kadar sayılır) açılır pencereleri tutar ve sonradan size bir kez söyler; yoğun bir saat tek bir “N yeni haber” satırı olur; bir oyun ya da pil tasarrufu denetimi bekletir. Panel haberleri güne göre listeler, kaç kaynak bildirmiş olursa olsun haber başına bir satır, ve “Neden bildirim aldım?” kuralı adıyla söyler. Görebileceğiniz ve değiştirebileceğiniz bir adresteki tek bir JSON dosyasını okur, sizinle ilgili hiçbir şey göndermez ve size neyin ulaşacağına hiçbir yapay zekâ karar vermez. Açtığınızda zaten orada olan haberler yeni olarak gösterilmez. Vex Eşitleme’de yok; seçimleriniz bir yedekte, haberler ise yalnızca kutuyu işaretlerseniz.

### Düzeltildi
- **Yoğun bir bilgisayar artık bir uzantının düzenli ifade kuralını yıpratmıyor.** Böyle bir kuralın süre sınırı 100 ms (20 ms idi) ve kural yalnızca art arda beş aşımdan sonra kapatılıyor; normal bir çalıştırma seriyi bitirir ve zaman aşımı olmayan bir hata yalnızca o tek adresi atlar.

## v21.99.8 (2026-10-15) — Oyun kipi ve oyunlarınız, kullanıcı betikleri, daha akıllı bir sayfa izleyici, pil kipi ve daha sakin bir tarayıcı

### Yeni
- **Oyun kipi (Ayarlar › Gizlilik Sağlamlaştırma › Oyun ve yayın):** oyunlarınızdan biri çalışırken Vex yolundan çekilir. Arka plan sekmeleri uyur, eşitleme, yapay zekâ görevleri, dizinleme ve uzantı güncellemeleri bekler, animasyonlar durur, Vex daha düşük öncelikte çalışır ve araç çubuğundaki bir çip bunu söyler. Oyunlarınızı Ayarlar’da listelersiniz; bir oyunun, başladığında yan paneller olarak açılan kendi rehber sayfaları olabilir. Ctrl+K’de “Oyun Kipi: Şimdilik Kapat” var. Tam ekran bir uygulama ilk kez öne geçtiğinde bir kez sorar: “Aç” kaydeder, “Şimdi değil” yalnızca Vex yeniden başlayana kadar o uygulamayı atlar ve “Bir daha sorma” kapatır.
- **Oyun dosyası (siz açana kadar kapalı, oyun başına):** listelenen bir oyun çalışırken Vex, o oyun için açtığınız sayfaları ve yaptığınız aramaları hatırlar; böylece o yapıyı ya da rehberi yeniden bulabilirsiniz. Ctrl+K › “<oyun> dosyasını aç” bunları güne göre arama, sabitleme, “Rehberime ekle”, silme ve “Bu siteyi asla hatırlama” ile gösterir ve Markdown dışa aktarabilir ya da yerel Ollama’nızla özetleyebilir. Özel ve Tor sekmeleri, oturum açma, ödeme, banka ve posta sayfaları asla kaydedilmez.
- **Sayfa izleyici büyüyor:** bir sayfanın tamamını, bir bölümünü (metni seçin, sağ tıklayın › “Bu sayfayı değişiklikler için izle...”) ya da bir fiyat veya sürüm gibi bir sayıyı izleyin. Vex saat zamanlarını ve reklam hareketini yok sayar, kısa bir geçmiş tutar, nelerin eklenip kaldırıldığını gösterir, izlediğiniz bölüm kaybolduysa size bir kez söyler ve JavaScript sayfalarını gizli bir sekme üzerinden okuyabilir. Araç çubuğu rozeti yalnızca bir şey değiştiğinde görünür.
- **Yama radarı:** bir oyuna yama notları sayfası ya da akışı verin (bir Steam uygulama numarası ya da GitHub owner/repo adresi doldurur). Vex bunu sayfa izleyici aracılığıyla her 6 saatte bir denetler ve oyun kapandığında bir kez “<oyun> için yeni yama notları” der. Adresi onaylamadan hiçbir şey izlenmez.
- **Recall bir sayfayı ne hakkında olduğuna göre bulabilir (“Anlama göre”).** “Ekşi maya starterini canlı tutma hakkındaki o makale”, sözcüklerinizden hiçbiri sayfada olmasa bile sayfayı bulur. Ayarlar › Recall (tam metin geçmişi) bölümünde bir gömme modeli seçene kadar kapalıdır (örneğin kendi Ollama’nızdan `nomic-embed-text`). Sayfalar, Vex boştayken ve hiçbir oyun çalışmıyorken birkaçı bir seferde anlaşılır; Recall’ın zaten tuttuğu başlıktan ve ilk 2.000 karakterden, ve yalnızca sayılar saklanır (`recall-vectors.json`, en fazla 5.000 sayfa). Metin yalnızca 127.0.0.1 üzerindeki Ollama’ya gider, asla bir bulut modele gitmez. Yalnızca anlamla bulunan sonuçlar “anlamla eşleşti” der. Ayarlar, Ollama çalışmıyorsa ya da model kurulu değilse bunu açıkça söyler, “3.000 sayfadan 1.240’ı anlaşıldı” gösterir ve “Anlam dizinini unut” seçeneğine sahiptir. Bir sayfayı ya da siteyi unutmak ya da Recall’ı temizlemek onun sayılarını da kaldırır.
- **“Tarayıcımı ne yavaşlatıyor?” (Ctrl+K ve Bellek panelinin en üstünde yeni bir bölüm)** siteleri, panelleri ve uzantıları son 5 dakikada ya da oturum boyunca kullandıkları işlemci süresine göre, belleklerini ve indirdiklerini göstererek sıralar ve hangisinin sorun olduğunu tek cümleyle söyler. Her satırda Uyut, Sessize al, Kapat ve “Bu siteyi hep uyut” (Çalışan görevler’in kullandığı aynı tutma) vardır. Birkaç sekmenin paylaştığı bir işleyici aralarında eşit bölünür. Özel ve Tor sekmeleri tek bir anonim toplamdır, asla adlandırılmaz ve sekme başına asla saklanmaz. Rakamlar yalnızca bellekte tutulur, dakikada bir örneklenir (panel açıkken her 5 saniyede bir ve bir oyun çalışırken değil).
- **Uzantılara artık sayfalar gezindiğinde ve çerezler değiştiğinde haber veriliyor.** `chrome.webNavigation`; onBeforeNavigate, onCommitted, onDOMContentLoaded, onCompleted, onErrorOccurred, onHistoryStateUpdated ve onReferenceFragmentUpdated olaylarını tetikler (her dinleyicinin eklendiği URL süzgeciyle) ve getFrame / getAllFrames bir sekmenin gerçek çerçevelerini listeler. `chrome.cookies.onChanged`, çerezle, kaldırılıp kaldırılmadığıyla ve nedeniyle tetiklenir. Yalnızca eşleşen izne sahip uzantılar bir şey duyar (çerezler ayrıca o siteye erişim de ister), yalnızca normal sekmelerde, özel, kayıtsız, tek kullanımlık ya da Tor sekmelerinde asla ve Vex’in kendi sayfalarında asla. Hâlâ eksik olanlar: uzantılar için history, bookmarks, tabGroups, sessions ve topSites ile webNavigation’ın yeni pencere ve değiştirilen sekme olayları.
- **Uzantıların istek kuralları artık çalışıyor (declarativeNetRequest).** Bildirimden gelen statik kural kümeleri, dinamik kurallar (yeniden başlatmalar boyunca saklanır) ve oturum kuralları, Chrome’un kendi sınırları ve aynı adres, alan adı, kaynak türü ve yöntem koşullarıyla engeller, izin verir, https’e yükseltir, yönlendirir ve istek ile yanıt üstbilgilerini değiştirir. Bir dizin üzerinden mikrosaniyelerde denetlenirler, Vex’in reklam engelleyicisinden, site anahtarlarından ve HTTPS onarımlarından sonra çalışırlar (bunlar kazanır) ve Özel, kayıtsız ya da Tor sekmelerine asla ulaşmazlar. Yavaş bir kural kümesi uzantının kartında işaretlenir. Çok uzun sürebilecek düzenli ifade kuralları reddedilir. Kapsanmayanlar: yanıt üstbilgisi koşulları; engelleyen webRequest hâlâ hiçbir şey yapmaz.
- **Vex, bilgisayar pille çalışırken güç tasarrufu yapabilir** (Ayarlar › Performans › Pilde, siz açana kadar kapalı). Boştaki sekmeler 10 dakika sonra uyur (pil azken 5), Vex’in kendi arka plan denetimleri (sayfa ve GitHub izlemeleri, takvimler, Sonra oku, diğer cihazlardaki sekmeler, bedava oyunlar, canlı kanallar, Recall sayfa okumaları, eşitleme çekmesi, uzantı güncellemeleri) ve arka plan yapay zekâ bekler ve animasyonları durur. Araç çubuğundaki tek bir “Pil tasarrufu” çipi bunu söyler; fişi takmak bekleyen işi bir kez çalıştırır ve her şeyi yerine koyar. Şebeke ile pil arasındaki bir değişiklik on saniye boyunca tutmalıdır; böylece gevşek bir fiş gidip gelmeye yol açmaz. Ses çalan, bir görüşmede olan, kaydedilen ya da uyanık tutulan sekmeler asla uyutulmaz ve kendi değişiklikleriniz yine eşitlenir. Pili olmayan bir bilgisayarda hiçbir şey yapmaz ve Ayarlar bunu söyler. Windows’un Pil Tasarrufu anahtarı Vex tarafından görülmez.
- **Vex, Game Control Center’a hangi sekmenin meşgul olduğunu söyleyebilir (Ayarlar › Oyun ve yayın, varsayılan olarak kapalı).** Açtığınızda Vex, Game Control Center’ın tuttuğu PC Black Box klasörüne (%LOCALAPPDATA%\PCBlackBox) dakikada en fazla bir kısa satır yazar; en çok işlemci süresi kullanan sekmenin sitesini adlandırır ve yalnızca bir oyun çalışırken ya da bir site öne çıkarken. Game Control Center daha sonra bir gecikme sıçramasının olası nedeni olarak “example.com üzerindeki bir tarayıcı sekmesi bir çekirdeğin yaklaşık %30’unu kullanıyordu” gösterir. Dosya yereldir ve bu bilgisayardaki programlar tarafından okunabilir, Vex klasörü asla oluşturmaz ve özel ile Tor sekmeleri yalnızca tek bir anonim toplam olarak sayılır.
- **Arşiv kitaplığı:** Ctrl+K › Bu Sayfayı Arşivle (ya da sağ tıklayın › Bu sayfayı arşivle), Vex’in Karşıdan Yüklenenler değil, yönettiği bir klasörde kendi içinde tam bir kopya ve metnini tutar; Ctrl+K › Arşiv Kitaplığı kopyaları listeler, arar (başlıklar ve kaydedilen metin), açar, dışa aktarır ve siler. Kopyalar, betikleri kapalı ve her ağ isteğini engelleyen bir pencerede açılır ve arşivlediğiniz bir sayfa yüklenmediğinde ya da 404 yanıtı verdiğinde Vex, Wayback Machine’in yanında kopyanızı açmayı önerir. Asla otomatik değildir; özel, Tor ve yönlendirilen sekmeler, hariç tutulan siteler ile oturum açma, banka, posta ve sağlık sayfaları için reddedilir; sayfa başına 50 MB, toplamda 500 MB ve dolu bir kitaplık yalnızca en eski kopyaları önerir. Eşitlenmez; isteğe bağlı bir yedek grubu tek ayarını taşır.
- **“Bu site bozuk”, çalışmayan bir siteyi adım adım düzeltir.** Site panelinden ya da Ctrl+K’den Vex önce reklam engelleyicinin siteden elini çekmesine izin verir, sonra onun Güçlendirmesini ve zorlanmış koyu kipini duraklatır, sonra site başına anahtarlarının kapattığı şeylere izin verir; her birinden sonra yeniden yükler ve “Bu düzeltti mi?” diye sorar. İşe yaramayan bir adım bir sonrakinden önce geri konur; işe yarayan, Geri al, her değişiklik için bir “Yeniden sıkılaştır” düğmesi ve bir “Kendime bildir” metniyle sıradan bir site başına kural olarak tutulur. Özel pencerelerde ve Tor sekmelerinde hiçbir şey yapmaz. Parmak izi koruması ve Yalnızca HTTPS geneldir ve bunun parçası değildir; farklı bir tarayıcı kimliği denemek atlanır çünkü Vex’te henüz site başına kimlik yok.
- **Global Privacy Control** her siteye gönderilir (`Sec-GPC: 1` üstbilgisi ve `navigator.globalPrivacyControl`), varsayılan olarak açıktır; Ayarlar › Gizlilik Sağlamlaştırma’da ya da bir sitenin panelinde dışarıda bırakılacak sitelerin bir listesi vardır. Bir Tor sekmesi onu asla göndermez.
- **Yönlendiren kırpma** (varsayılan olarak kapalı): bir siteye nereden geldiğiniz söylenen adresi, başka bir siteye giderken sitenin adına kırpın ya da siteler arasında hiçbir şey göndermeyin (Katı). Bir sitenin panelinde, bozulan oturum açma ya da ödeme sayfası için “Bu site yönlendireni gerektiriyor” var. Üstbilgiyi kırpar, `document.referrer`’ı değil, ve Tor sekmelerinde değil.
- **Bir sitenin paneli, o siteyi mobil site olarak ya da yazdığınız bir User-Agent ile isteyebilir,** bir sonraki yüklemeden itibaren ve hangisinin olduğunu gösterir. Masaüstü, Vex’in her yerde gönderdiğidir. Bir Tor sekmesi asla değiştirilmez.
- **Resimler, JavaScript ve çerezlerle aynı panelden bir site için kapatılabilir,** veriden tasarruf etmek için (Tor sekmelerinde değil).
- **Windows’ta oturum açtığımda Vex’i başlat,** “Simge durumunda başlat” ile, Ayarlar › Genel’de. Windows’un neyi tuttuğunu gösterir, yalnızca kurulu uygulamada çalışır (Ayarlar bir kaynak kopyada bunu söyler) ve Vex zaten açıkken bir Windows başlatması pencereye dokunmaz.
- **Kullanıcı betikleri: Vex `.user.js` betiklerini kendisi kurabilir ve çalıştırabilir** (Ayarlar › Kullanıcı Betikleri). Bir yapıştırma, bir adres ya da bir dosyadan bir tane ekleyin; Vex adını, sürümünü, çalıştığı sayfaları, neler yapabileceğini ve hangi sitelerle iletişim kurabileceğini gösterir ve açmadan önce sorar. Her betik kapatılabilir, adlandırdığınız bir sitede çalıştırılabilir, güncelleme için denetlenebilir (yalnızca düğmeye bastığınızda) ya da silinebilir. Araç çubuğundaki bir kod simgesi, önünüzdeki sayfada çalışan betikleri sayar ve “Tüm kullanıcı betiklerini devre dışı bırak” (simgenin menüsü, Ayarlar ya da Ctrl+K) hepsini kapatır. Özel, Tor, tek kullanımlık ya da yönlendirilen sekmelerde, Vex’in kendi sayfalarında ya da siteyi betiğe eklemediğiniz sürece banka, posta ve oturum açma sitelerinde asla çalışmazlar. GM_getValue/setValue/deleteValue/listValues, GM_addStyle, GM_xmlhttpRequest (yalnızca betiğin bildirdiği ana makineler, çerezsiz bir oturumdan), GM_setClipboard, GM_notification, GM_openInTab ve GM_info desteklenir; @require ve @resource desteklenmez. Kullanıcı betikleri yalnızca kutuyu işaretlerseniz bir yedekte bulunur ve Vex Eşitleme’de asla.

### Değişti
- **Zamanlamalar ve Saat artık tek bir kenar çubuğu düğmesi.** Saat panelinin beşinci bir sekmesi var, **Zamanlanmış görevler**, Zamanlamalar panelinin sahip olduğu her şeyle (Etkin, Geçmiş, Şablonlar, Yeni Görev, hatırlatıcılar). Ayrı Zamanlamalar simgesi gitti. Ctrl+Shift+L, Ctrl+K “Zamanlamalar” ve Zamanlamalar’ı açan diğer her şey hâlâ çalışır ve o sekmeye iner. Kenar çubuğu sıranız, gizli ve yan panel ayarlarınız bir kez taşınır: birleşik düğme Saat’in yerini korur ve ikisi de gizli olmadıkça gösterilir. Zamanlanmış görevlerin kendisine dokunulmaz ve panel açık olsun olmasın çalışmaya devam eder.

## v20.86.6 (2026-10-13) — Parola sağlığı ve CSV içe aktarma, klavyeyle rahat kullanılan bir Vex ve daha istikrarlı bir Ayarlar

### Yeni
- **Parola Sağlığı artık tahmin edilmesi kolay parolaları da işaretler** (sonuna rakam eklenmiş yaygın bir parola, tekrarlar, klavye dizileri, kullanıcı adınız ya da sitenin adı) ve **bir yıldır ya da daha uzun süredir değiştirilmemiş** girişleri listeler. Her satırda bir “siteyi aç” düğmesi vardır. Bu, kısa bir yerleşik listeye karşı yapılan bir örüntü denetimidir, bir güç puanı değildir ve hiçbir parolayı hiçbir yere göndermez.
- **Ayarlar › Parolalar, yeniden kullanılan, zayıf ve bir yıllık girişleri işaretler** ve her birinin kaydedildiği tarihi gösterir. Gösterdiğiniz bir parola 30 saniye sonra kendiliğinden yeniden gizlenir ve her kullanıcı adının kendi kopyalama düğmesi vardır.
- **Bitwarden, KeePass, Firefox ve Chrome’dan CSV içe aktarma daha fazlasını korur:** notlar, tarihler ve Kimlik Doğrulayıcı’ya giden 2FA anahtarları. Yalnızca standart zamana dayalı kodlar içe aktarılır; HOTP ve Steam anahtarları desteklenmeyen olarak sayılır.
- **Kimlik Doğrulayıcı hesapları yeniden adlandırılabilir** ve altı hesaptan itibaren bir arama kutusu belirir. Ayarlar › Geçiş anahtarları da altı geçiş anahtarından itibaren aynı aramayı alır.
- **Ayarlar’ın düzen kutusunda “Varsayılan düzene dön” düğmesi vardır:** sütunlar, kategori menüsü ve yoğunluk birlikte geri döner.
- **Ctrl+K, siz yazarken yaklaşık iki kat hızlı yanıt verir** ve Kitaplık daha yeni yardımcıları listeler (Kimlik doğrulayıcıdan kodu doldur, Bu site için parola kaydet, Güçlü parola oluştur, Bir panelin sayfasını sekme olarak aç).
- **Vex klavyeyle çok daha iyi çalışır.** Her pencere açılırken odağı alır, kapanırken geri verir. Hızlı araçlar menüsü ve diğer sağ tık menüleri menü tuşuyla ya da Shift+F10 ile açılır ve oklarla kullanılır. Bir oturum açma alanının altındaki geçiş anahtarı listesi Aşağı, Yukarı ve Enter ile kullanılabilir. Ana Ses, kaydırıcısı odaklanmış olarak açılır. Ayarlar’ın kategori listesi 39 yerine tek bir Tab durağıdır. Odak halkası artık her görünümde ve temada görünür.
- **Vex panelleri ve Ctrl+K’yi daha az yorarak açar:** bir yan paneli açmak ya da bırakmak artık tüm ayar dosyanızı yeniden yazmaz (on adımlık bir testte 7 yazma 1’e indi), Vex’in kendi penceresi artık reklam engelleyicinin sayfa gizleme betiği tarafından izlenmez ve zip kitaplığı başlangıçta yüklenmez. `npm run perf` bu sayıları yazdırır.

### Düzeltildi
- **Ayarlar artık bir bölümün diğerinin üstüne çizildiği bir kare ya da yüzlerce piksellik bir boşluk göstermiyor.** Neden, yerel modeller listesinin Ayarlar açıldıktan bir an sonra gelmesiydi; düzen artık onu bir kare sonra değil, aynı adımda izliyor.
- **İki ya da üç sütunlu Ayarlar’da bir kategoriye tıklamak artık o kategoriyi işaretler.** Neredeyse her durumda yanlış olanı işaretliyordu.
- **Büyük ve En büyük metin artık uzun bölümlerin altında 25-40 piksellik boş alan bırakmıyor.**
- **Ayarlar’a giden bir bağlantı (bir özellikten, bir komuttan ya da bir aracın menüsünden) hâlâ arama yazılıyken çalışır**, hiçbir şey yapmamak yerine.
- **Varsayılanlara Sıfırla, metin boyutunu, yoğunluğu ve yazı tipini hemen geri koyar**, yeniden başlatmayı beklemez.
- **Bir kartın “Güvenlik kodu” artık kimlik doğrulayıcı kodunuzla doldurulmuyor** ve “hotpink” adlı bir alan artık tek kullanımlık kod alanı sanılmıyor.
- **Parolaları kaydetme ve doldurma, web bileşeni (shadow DOM) oturum açma formlarında ve “parolayı göster” gözüne bastıktan sonra çalışır.** Yalnızca birim testlerinde denendi, canlı bir sitede denenmedi; shadow DOM içindeki kayıt formlarında parola önerisi henüz kapsanmıyor.
- **Geçiş anahtarı sayfasının devre dışı düğmeleri devre dışı görünür** ve geçiş anahtarı olmayan bir sayfa odağı alır, böylece Escape onu kapatır.
- **Ayarlar düzen kutusu, kategori listesi solda olduğunda artık pencerenin soluna taşmıyor.**
- **Discord, bir güncelleme başarısız olduktan sonra da Vex temanızı izlemeyi sürdürür**, yeniden başlatmaya kadar sonraki her değişikliği yok saymaz.
- **Ayarlar › Oyun’un Game Control Center konum düğmeleri başarısız olduklarında bunu söyler**, hiçbir şey yapmamak yerine.
- **Ayarlar › Gezinme ekstraları doğru okunuyor:** kopyalama kilidi açıklaması kendi anahtarının altında duruyor ve gizli site listeleri “a.com, b.org” biçiminde okunuyor.
- **Yeni bir denetimin bulduğu küçük klavye ve ekran okuyucu düzeltmeleri:** saatin alarm saatinin bir adı var ve hatırlama panelinin temizle düğmesi ile yapay zekâ panelinin ipucundaki “Kapat” düğmesi artık tıklanacak kadar büyük.

### Perde arkası
- Tek ekranlık bir sürüm durumu (`node scripts/release-check.js`), yayımlanmış bir sürümü ya da kırmızı bir CI’ı reddeden bir sürüm betiği, devam ettirilebilir bir `scripts/publish-all.ps1` ve yavaş bir çalıştırıcının artık bir sürümü başarısız kılmaması için 30 saniyelik test zaman aşımı.

## v20.31.0 (2026-10-12) — Ayarlar “Tek sütun, tam genişlik” artık gerçekten tüm genişliği kullanıyor

### Düzeltildi
- **Ayarlar › “Tek sütun, tam genişlik” artık sol kenardan sağ kenara uzanıyor; hem üstte çipler olduğunda hem de kategori listesi solda olduğunda.** v20.30.0’da bölümler, iki yanı boş kalan dar ve ortalanmış bir sütunda kalıyordu; çünkü ortalama, tüm Ayarlar alanının yan dolgusundan geliyordu ve seçim bunun yerine geçmiyordu.

## v20.30.0 (2026-10-12) — Tam genişlikte bir Ayarlar düzeni ve Ayarlar listesi kendi başına kayıyor

### Yeni
- **Ayarlar’da yeni bir düzen seçeneği var: “Tek sütun, tam genişlik”** (arama kutusunun yanındaki sürgü düğmesi ya da Ayarlar › Görünüm › Ayarlar sütunları): bölümleri ortalanmış okuma genişliği yerine sol kenardan sağ kenara uzanan tek bir sütun.

### Düzeltildi
- **Ayarlar’ın kategori listesi solda dururken, listeyi kaydırmak artık yanındaki ayarları kaydırmıyor.** Listenin başında ya da sonunda fare tekerleği listede kalıyordu ama eskiden ayarlara da geçiyordu, böylece ikisi birlikte hareket ediyordu.

## v20.28.0 (2026-10-12) — Vex’te geçiş anahtarları, her sayfada bir kod ve parola yardımcısı ve yolda durmayan bir Resim İçinde Resim düğmesi

### Yeni
- **Vex geçiş anahtarlarınızı saklar.** “Geçiş anahtarıyla oturum aç” ya da “Geçiş anahtarı oluştur” sunan bir site artık sekmelerde ve yan panellerde çalışır. Vex size kendi sayfasında sorar ve özel anahtar bu bilgisayardaki Vex’in şifreli deposunda kalır. Ayarlar › Geçiş anahtarları onları Yeniden adlandır, Sil ve Geri al ile listeler. Geçiş anahtarlarını diğer cihazlarınıza eşitleme, siz açmadıkça kapalıdır ve yalnızca açıkken oluşturulan geçiş anahtarları eşitlenebilir. Bir site doğrulama istediğinde Vex PIN’inizi kullanır. Sınırlar: yalnızca bir sekmenin ya da panelin en üst sayfası (gömülü bir çerçevenin ya da oturum açma açılır penceresinin içindeki geçiş anahtarı eski davranışı kullanmaya devam eder), yalnızca ES256 anahtar türü, belirli bir donanım üreticisinin onayını şart koşan siteler bunu reddeder ve özel pencerelerde, Tor’da ya da burner sekmelerinde hiçbir şey sunulmaz.
- **“Kimlik doğrulayıcıdan kodu doldur”**: bir sayfanın kod alanına sağ tıklayın (ya da Ctrl+K’ye basın); o site için hesabınızın geçerli kodu doldurulur, birden çok eşleşme olduğunda ya da hiç olmadığında seçebileceğiniz bir liste gösterilir.
- Sayfanın sağ tık menüsündeki **“Bu site için parola kaydet…”** (ve Ctrl+K), otomatik “Parola kaydedilsin mi?” önerisi çıkmadığında bir girişi kendiniz kaydetmenizi sağlar. Bir parola alanına sağ tıklayıp “Güçlü parola oluştur”u seçin; Ayarlar › Parolalar › Ekle’de de bir oluşturucu var.
- **Ayarlar’da bir “Videolarda Resim İçinde Resim düğmesi” seçeneği var** (“Sekme değiştirdiğinizde oynayan videoyu yüzdür”ün yanında): bir videonun üzerine geldiğinizde göster (varsayılan), her zaman ya da hiçbir zaman. Bir site, düğmenin sağ tık menüsünden gizlenebilir ve Ayarlar gizli siteleri yeniden göstermenin bir yoluyla listeler.

### Düzeltildi
- **Oturum açılmış bir sayfanın ortasında bir 2 Adımlı Doğrulama kutusu açıldığında kimlik doğrulayıcı kodu artık doldurulur** (bir grubun sahibini değiştirirken Roblox). Vex kutuyu yalnızca sayfa yüklenirken arıyordu. Ayrıca bir kod alanını yalnızca yer tutucusundan değil, etiketinden, yanındaki sözcüklerden ya da bir shadow root içinde durmasından da tanır.
- **Resim İçinde Resim düğmesi artık sayfadaki hiçbir şeyi kapatmıyor ya da engellemiyor.** Eskiden pencerenin köşesinde sabit dururdu ve her videonun sağ üstüne ikinci bir tane çizilirdi; bu da oynatıcıların yayınlama ve tam ekran düğmelerini, çerez bannerlarını ve sohbet baloncuklarını gizliyordu. Artık yalnızca fareyi bir videonun üzerinde gezdirirken görünüyor, o videonun boş bir köşesinde duruyor, yaklaşık 2,5 saniye hareketsiz kalınca kayboluyor ve sitenin kendi denetimlerini kapatmıyor. Yapımcının testinde tıklanabilir 39 sayfa öğesinin 0’ı engellendi; öncesinde 39’un 15’i engelleniyordu. Ctrl+Shift+P kısayolu değişmedi.
- **Bir yan panel sayfanın yanına yerleştirilmişken araç çubuğunun Geri, İleri ve Yeniden yükle düğmeleri canlı kalır.** v19.91.7 bir panel açıkken, web sitesi ekrandayken bile onları soluklaştırıyordu. Artık odak hangi tarafta olursa olsun panelin yanındaki web sitesi üzerinde işlem yaparlar. Panelin kendi sayfasının içinde basılan bir tuş yine reddedilir ve sayfayı kaplayan bir panel (ya da Ayarlar) onları yine kilitler.

## v19.91.7 (2026-10-12) — Ana Ses Netflix’e ve Prime’a ulaşıyor, Kitaplık her şeyi açıyor ve Discord temanızla düzgün uyuşuyor

### Yeni
- **Kitaplıktaki her özellik bir düğmeyle açılır.** Her kartta artık gerçekten yapabildiği şey var: Paneli aç, Komutu çalıştır, Ayarları aç, Göster. “master volume” aramak ses kaydırıcısını açan bir düğme verir. Açılamayan özellikler (sayfada bul, uyanık tut, seçim çubuğu, DRM ve diğerleri) ölü bir düğme göstermek yerine nasıl çalıştıklarını söyler. Ana Ses’in artık bir Ctrl+K komutu da var.
- **Ctrl+K’de “Game Control Center’ı aç” var**; ayrı Game Control Center uygulamanızı başlatır. Belirlediğiniz konuma (Ayarlar › Oyun ve yayın), Başlat menüsü kısayolunuza, kurulum girdisine ve Program Files’a bakar; bulamazsa nereye baktığını söyler.
- **Ayarlar’da düzen seçenekleri var**, arama kutusunun yanındaki sürgü düğmesinden ya da Ayarlar › Görünüm › Ayarlar düzeninden: bir, iki ya da üç sütun (ya da otomatik), kategoriler üstte çipler olarak ya da solda bulunduğunuz bölümü işaretleyen bir liste olarak ve aynı metin boyutuyla ekrana daha fazlasını sığdıran sıkı bir yoğunluk. Hemen uygulanır, bu cihazda saklanır.
- **Roblox Hub ve diğer her web paneli (Discord, WhatsApp, Spotify, sabitlenmiş siteler), gösterdikleri sayfayı bir sekme olarak açabilir**, oturum açık kalarak, ya da bağlantısını kopyalayabilir: panelin çubuğundaki bir düğme, kenar çubuğu simgesinin sağ tık menüsü ve Ctrl+K.
- **Bir yan panel (Discord, WhatsApp, Spotify, Notlar, sabitlenmiş bir site...) öndeyken web sitesinin Geri, İleri ve Yeniden yükle düğmeleri durur:** araç çubuğu düğmeleri soluklaşır ve “yan panel açıkken kullanılamaz” der; Alt+Sol/Sağ, F5, Ctrl+R, Ctrl+Shift+R ve Ctrl+K’nin Yeniden yükle komutu artık arkada gizli kalan sekmeyi ne hareket ettirir ne de yeniden yükler. Panel kapanır kapanmaz ya da yerleşik panelin yanındaki sayfaya tıkladığınız anda geri gelirler.

### Düzeltildi
- **100%’ün üzerindeki Ana Ses artık Netflix, Prime Video, Disney+ ve diğer korumalı videolarda çalışıyor**, sekmelerde ve yan panellerde. İmkânsız sanılıyordu; Vex’in oynatıcısı buna izin veriyor. Korumalı bir sayfa yükseltmeden sonra sessizleşirse Vex sayfayı yükseltme kapalı olarak bir kez yeniden yükler ve kaydırıcı nedenini söyler.
- **100%’ün üzerindeki Ana Ses artık özel oynatıcı öğelerinin içindeki oynatıcılara, bir sayfanın sayfaya koymadan oluşturduğu oynatıcılara, bir sayfanın kendi Web Audio’suna ve özel pencerelerde, Tor’da ve kimlik sekmelerinde çapraz kaynaklı oynatıcılara da ulaşıyor.** Kaydırıcı neyi yükselttiğini söyleyen bir durum satırı gösterir ve bir sayfa yükseltilemediğinde bunu açıkça söyler (izin vermeyen bir sunucu, kendi ağınızdaki bir oynatıcı, yükseltmeden önce başlamış ses: sayfayı yeniden yükleyin).
- **Resim İçinde Resim bir yan panelden çalışıyor** (kenar çubuğunda Disney+, Prime ve diğerleri), “Bu sayfada video yok” yanıtı vermek yerine: araç çubuğu düğmesi ve Ctrl+Shift+P, korumalı video dahil, panellerde, çerçevelerde, özel öğelerde ve geç oluşturulan oynatıcılarda videoyu bulur.
- **Gizlilik politikası ve şartlar artık “Taslak: hukuki tavsiye değildir” notuyla açılmıyor.** İçlerinde başka bir şey değişmedi, bu yüzden yeniden onay istenmez.
- **“Discord’u Vex temama uydur” artık yalnızca metni değil, Discord’un her parçasını yeniden renklendiriyor.** Açık bir Vex temasıyla Discord’un bazı parçaları koyu metnin altında koyu kalıyordu ve Hesap’taki Düzenle düğmeleri açık gri üzerinde beyazdı. Artık Discord’un kullandığı her renk ayarlanıyor (972 tanesi), açık bir Vex teması Discord’un hangi kipte olduğuna bakılmaksızın tamamen açık bir Discord’u, koyu bir tema da tamamen koyu bir Discord’u veriyor ve her metin, 69 temanın hepsinde, üzerinde durduğu şeye karşı 4,5:1’de tutuluyor (Discord’un hem açık hem koyu metin altında kullandığı birkaç renk 3:1’de dengelenir).
- **Vex Discord’un renklerini uydururken kendi Discord temanız da açıksa,** Vex bunu Ayarlar’da ve bir bildirim olarak söyler (“Kendi Discord temanız ‘NAME’ de açık; renkler çakışabilir.”) ve uydurma sürerken diğer temalarınızı duraklatan bir düğme sunar. Uydurma kapandığında tam eskisi gibi geri gelirler. Siz tıklamadan hiçbir şey duraklatılmaz.
- **Ayarlar artık F11’den, yeniden boyutlandırmadan ya da metin boyutu değişikliğinden sonra bozulmuyor:** yapay zekâ bölümlerinin üstünde boş şerit yok, pencere ya da metin boyutu değişirken bölümler üst üste çizilmiyor, anahtarlar uzun bir etiketin yanında daire kadar küçülmek yerine bütün kalıyor ve bir kişiliğin istem önizlemesi tam bir satırda bitiyor.
- **Bir sayfa yüklenirken gösterilen halka, Windows animasyonları kapalıyken de dönmeyi sürdürür** (duruyor, sonra atıyordu ve takılmış gibi görünüyordu). Vex’in kendi Hareketi azalt anahtarı onu yine bir atışa çevirir.

## v19.56.9 (2026-10-12) — Vex temanızda Discord, daha ferah bir Ayarlar ve v19.1.7’deki her değişiklik elle denetlendi

### Önce bunu okuyun
- **Ayarlarınızdaki değişiklikler saklanmıyorsa, bu düzeltir.** Kısayollar çubuğuna sitesinin logosuyla (varsayılan) eklenen bir kısayol, ayarlar kaydedilirken reddediliyordu ve ondan sonra yapılan her değişiklik, hangi ayar olursa olsun, onunla birlikte reddediliyordu.
- **v19.1.7’deki her değişiklik, gerçekten kullanılarak yeniden denetlendi**, özellik özellik, ve yaklaşık 30 sorun düzeltildi. Aşağıdaki notlar onları listeler; bu girdinin sonu da v19.1.7 notlarının fazla kesin söylediği şeyleri düzeltir.

### Yeni
- **Discord, Vex temanızı giyebilir.** Ayarlar › Görünüm’de “Discord’u Vex temama uydur”u açın (ya da Discord düğmesine sağ tıklayın). BetterDiscord temalarının adını taşıyan Vex temaları, gerçek temayı Vencord aracılığıyla Discord’a yükler (ClearVision, Dark Matter, Tokyo Night ve 18 tane daha, kendi yayımlanmış adreslerinden); diğer her Vex teması, sizin kendi temanız da dahil, Discord’a uyumlu, okunaklı renkler verir. Temaları değiştirdikçe değişir ve kendi Vencord temalarınıza ve QuickCSS’inize asla dokunulmaz. Vex’in kurmayı önerdiği Vencord gerekir. Siz açana kadar kapalıdır.
- **Ayarlar ekranınızı kullanır.** Geniş pencereler bölümleri iki sütunda (çok geniş ekranlarda üç) gösterir; böylece 1920 piksellik bir pencere yaklaşık yarısı kadar, 2560 piksellik bir pencere yaklaşık üçte biri kadar kayar. Daha küçük pencereler ve En büyük metin tek sütunda kalır.
- **Fare tekerleği Ayarlar’ı üzerinde her yerde kaydırır**, yalnızca ortada değil; ayarların yanında, arama kutusunun ve çiplerin üzerinde de.
- **Ctrl+K gizlilik politikasını, şartları, lisansı ve üçüncü taraf bildirimlerini** istediğiniz zaman Vex’in içinde açar (“privacy”, “terms”, “license” ya da “legal” yazın) ve Ayarlar › Hakkında da dördünü çevrimdışı olarak Vex içinde açar.

### Gizlilik ve güvenlik
- **Tor sekmeleri siteleri her zaman açık gösterir, Tor Browser gibi**, Vex temanız ya da Web sitesi görünümünüz ne olursa olsun; böylece bir Tor ziyareti açık ya da koyu ayarınızı ele vermez. Bu, Tor sekmelerini, Tor kapsayıcılarını ve Tor üzerinden yönlendirdiğiniz siteleri kapsar.
- **Gizlilik politikası ve şartlar gerçekten önce gelir:** arkalarında hiçbir Vex tuşu ya da komutu çalışmaz, özel pencere yalnızca onayladıktan sonra açılır ve başka bir programdan açılan bir bağlantı bekler ve “Kabul ediyorum”dan hemen sonra açılır.
- Zamanlanmış yapay zekâ görevleri artık bu bilgisayardaki ya da ev ağınızdaki sayfaları kendi sekmesinde açmıyor ya da okumuyor.
- Bu Sayfayı İzle ve Bu sayfanın beslemesine abone ol, Tor, özel ve kapsayıcı sekmelerinde reddedilir ve bir besleme, sitesini Tor ya da bir vekil üzerinden yönlendirdikten sonra artık gerçek bağlantınızdan okunmaz.
- Bir sayfanın kendi betiği artık 2FA kodunu yeniden doldurmayı tetikleyemez ve Pano Geçmişi’ne Kopyala düğmesinin gerçekte kopyaladığından farklı bir metin koyamaz.
- Özel bir pencerenin Discord menüsü artık orada hiçbir işe yaramayan atlatma seçeneklerini sunmuyor.

### Parolalar ve oturum açma
- Geçiş anahtarına izin verdiğiniz siteler Ayarlar › Gizlilik’te hemen Kaldır ile görünür (yalnızca yeniden başlatmadan sonra görünüyorlardı).
- Kullanıcı adı olmadan kaydedilmiş bir giriş düzenlenebilir.
- Vex’in izlemediği bir sayfada “E-postadan kod doldur” istemek, o sekmedeki sonraki otomatik doldurmanın daha yeni bir kodu bekleme süresini artık atlatmıyor.

### Vex Eşitleme
- **Neyin eşitleneceğini seçin bölümünde bir veri türünü yeniden açmak, kapalıyken yaptığınız değişiklikleri korur**; başka bir cihaz aynı şeyi değiştirdiyse iki sürüm de Eşitleme çakışmaları’nda bekler. Eskiden kayboluyorlardı.
- Eşitleme paneli, tek başına bir e-posta kodunun eşitlenmiş verilerinizi değiştiremeyeceğini ama baştan başlamak için silebileceğini (bunun her cihazın oturumunu kapattığını ve size e-posta gönderdiğini) açıkça söyler ve kaydedilmiş parolaları ve 2FA kodlarını, siz açtığınızda eşitlenenler olarak listeler.

### Sekmeler, adres çubuğu ve sayfalar
- **Vex’in kendi YalnızcaHTTPS ve sertifika sayfaları adres çubuğunda ulaşmaya çalıştığınız adresi gösterir**, Chrome’un yaptığı gibi, geldiğiniz sayfayı değil. Site düğmesi onlara asla güvenli demez.
- **Yapay zekâ paneli artık sekme şeridini, araç çubuğunu ya da pencere düğmelerini kapatmıyor** (+ düğmesi onun altında kalıyordu); tam ekran yapay zekâ sayfa alanını doldurur.
- Adres çubuğunun sağ tık menüsü ve sekme menüsü klavyeyle çalışır (menü tuşu ya da Shift+F10, oklar, Enter, Escape).
- /Docs ve /docs için öneriler her biri kendi adresini gösterir.
- Ayarlar › Genel, hiç yokken kendi arama motorunuz için Düzenle ve Kaldır’ı artık göstermiyor.

### Sayfa izlemeleri, indirmeler ve paneller
- Bir izleme sayfanın tamamını karşılaştırır (uzun bir sayfanın altına yakın bir değişiklik gözden kaçıyordu), nasıl eklenirse eklensin ilk bakışını hemen yapar ve hızlıca eklenen iki izleme de kalır. Ev ağı cihazlarındaki eski izlemeler tek listeye taşındıktan sonra çalışmaya devam eder.
- Bir sayfanın otomatik indirmelerinin sorusu yeniden yanıtlanabilir: İndirmeler listesi artık İzin ver ve Engelle düğmelerini kapatmıyor.
- Discord bir sekme olarak açıkken bir Discord bildirimine tıklamak o sekmeyi öne getirir.
- Roblox’un atlatmasını kapatmak, başka hiçbir şey kullanmıyorsa ByeDPI’yi durdurur.
- Yönlendiren bir bağlantının bir uzantı tarafından indirilmesi, 15 saniye sonra başarısız olmak yerine sonucunu bildirir.

### Temalar ve dil
- Kendi renklerini giyen bir tarayıcı görünümü, açılır listelere, kaydırma çubuklarına ve web sitelerine kendi açık ya da koyu halini verir (açık bir temanın üzerindeki Firefox koyu, açık açılır listeler ve açık siteler gösteriyordu).
- Hareketi azalt artık Yeni Sekme sayfasını da durağanlaştırır.
- Bir sayfa yüklenirken gösterilen halka, Windows animasyonları kapalıyken ya da Hareketi azalt açıkken durmak yerine atar (takılmış gibi görünüyordu).
- Türkçede: web sitelerinde site düğmesinin ipucu, kurulumun “geri kalanı atlansın mı?” sorusu ve Ayarlar › Hakkında’nın “kabul tarihi” satırı.

### v19.1.7 notlarında düzeltmeler
- “Değişiklikler diğer cihazlarınıza yaklaşık 5 saniyede ulaşır”: değişiklikleri yaptıktan yaklaşık 5 saniye sonra gönderilir; diğer cihazlarınız bunları bir sonraki denetimlerinde, 5 dakika içinde alır.
- “Bir oturum açma e-posta kodu tek başına eşitlenmiş verilerinizin üzerine yazamaz ya da onları silemez”: artık onları değiştiremez, ancak “baştan başla” hâlâ silebilir (her cihazın oturumunu kapatır ve size e-posta gönderir).
- Cihaz adları: oturum açarken yazdığınız ad, cihaz listesinin geri kalanı gibi eşitleme sunucusu tarafından görülebilir; yalnızca sonraki bir yeniden adlandırma şifreli olarak gider. Sekme grupları artık her cihazın kendi sekmeleriyle birlikte kalır.
- “Yapay zekâ ajanı artık bu bilgisayara ya da ev ağınıza yönlendirilemez”: bu, sayfa okumalarını kapsıyordu; zamanlanmış görevler artık kapsanıyor ve böyle bir sayfayı bir sohbette açmak önce size sorar.
- Riskli indirmeler: Vex kısayolları, disk görüntülerini, OneNote dosyalarını, yükleyici yamalarını, Denetim Masası öğelerini ve daha fazlasını açmadan önce durdurur, ancak Chrome’un uyardığı her türü değil.
- Eklediğiniz arama anahtar sözcükleri Varsayılanlara Sıfırla tarafından korunur.
- Parolaları gösterme, kopyalama ve dışa aktarma, bir PIN belirlediyseniz PIN’inizi, belirlemediyseniz bir onay ister.
- Yeni pencere ve özel pencere hızlanması 0,3-0,4 sn değil, yaklaşık çeyrek saniye ölçüldü.
- Uzantılar: uzantı kartlarındaki uyarılar listesi yaklaşık 15 değil, çalışmayan 28 şeyi adlandırır; tabs.update sekme değiştiremez ve onActivated, öne açılan bir sekme için tetiklenmez.

## v19.1.7 (2026-10-11) — Eşitlenen parolalar, Chrome gibi engellenen açılır pencereler, küçük kalan eşitleme ve çalışan uzantılar

### Önce bunu okuyun
- **Vex artık kullanılmadan önce gizlilik politikasını ve şartlarını kabul etmenizi istiyor.** Vex’in kendi kendine yaptığı her şeyi listelemek için yeniden yazıldılar (güncelleme denetimleri, engelleme listeleri, sayfa izlemeleri, oturum açma kodlarını e-postanızdan okuma, Recall, Pano Geçmişi, eşitleme ve daha fazlası): ne gönderiliyor, nereye, ne zaman ve onu kapatan anahtar. İkisini de Vex içinde okuyabilir, sonra “Kabul ediyorum” ya da “Vex’ten çık” seçebilirsiniz. Ayarlar › Hakkında ne zaman kabul ettiğinizi gösterir. Belgeler değiştiğinde yeniden sorulursunuz.
- **Parolalarınız ve 2FA kodlarınız cihazlarınız arasında eşitlenebilir.** Ayarlar › Vex Eşitleme › Neyin eşitleneceğini seçin bölümünde Parolalar ya da Kimlik Doğrulayıcı’yı açın (siz açana kadar kapalı ve Vex önce PIN’inizi ister). Her biri uçtan uca şifreli eşitlemenin içinde ayrı ayrı mühürlenir; böylece ne sunucu ne de Vex’in bilgisayarınızdaki eşitlenmiş kopyası bir tanesini okunabilir biçimde tutar. Bir giriş iki cihazda değiştiyse yenisi kazanır ve diğeri Eşitleme çakışmaları’nda bekler.
- **Kendi Tor’undan ya da vekilinden geçen sekmeler** (bu şekilde yönlendirdiğiniz bir site, bir Tor kapsayıcısı, yönlendirdiğiniz bir kapsayıcı), bir Tor sekmesinin her zaman olduğu gibi yapay zekâdan, e-posta kodu doldurmadan, Pano Geçmişi’nden, fiyat geçmişinden ve Recall’dan uzak tutulur ve arama önerisi almaz. Kaydedilmiş parolalar ve 2FA kodları orada yine de doldurulur.

### Gizlilik ve güvenlik
- **Açılır pencereler Chrome’daki gibi engellenir.** Bir sayfanın tıklamanız olmadan açtığı pencere engellenir, adres çubuğunda “Açılır pencere engellendi” gösterilir ve site panelinde “Bu site için izin ver” vardır. Yazdırma pencereleri, oturum açma açılır pencereleri ve tıkladığınız bağlantılar yine açılır.
- **Kaydedilmiş bir parola yalnızca oturum açma alanına tıkladığınızda doldurulur**, sayfa yüklenirken asla; böylece sitedeki bir betik onu hiç görmediğiniz bir formdan okuyamaz.
- **Bir oturum açma e-posta kodu tek başına eşitlenmiş verilerinizin üzerine yazamaz ya da onları silemez.** Her yükleme ve silme artık bu cihazın eşitleme anahtarınıza sahip olduğunu kanıtlıyor ve Ayarlar › Vex Eşitleme hesabın ona kilitli olup olmadığını söylüyor.
- **YalnızcaHTTPS özel pencerelerde, burner, Yeni Kimlik ve Tor sekmelerinde de çalışır.** Güvenli bağlantısı olmayan bir site, şifrelenmemiş yüklenmek yerine Geri dön ya da Devam et içeren bir sayfa gösterir ve bir sertifika hatası, onu açıklayan bir sayfa alır.
- **Tıklamasız arka arkaya indirme başlatan bir sayfa artık önce soruyor** ve bekletilen bir dosya, siz izin vermedikçe indirme klasörünüze asla düşmez.
- **Birinin adını yalnızca paylaşan bir uzantıyı yüklemek “X değiştirilsin mi?” diye sorar** ve onu sıfırdan başlatır; yerine kayıp verilerini okumaz.
- **Bir sayfa tam ekran olduğunda Vex siteyi adıyla belirtir** ve “çıkmak için Esc’ye basın” der; böylece masaüstünüz ya da bir oturum açma penceresi gibi görünen bir sayfa yakalanır.
- Yapay zekâ ajanı artık bu bilgisayara ya da ev ağınıza yönlendirilemez, indirmeden önce her zaman sorar ve özel ile Tor sekmeleri Sekmeleri Düzenle tarafından asla yapay zekâya gönderilmez.
- Cihaz üzerinde yapay zekâ sohbeti açıkken, yeniden başlatmadan sonraki bir sohbet sessizce buluta gitmek yerine yine bu makinede yanıtlanır.
- Bir HID cihazı isteyen bir site yalnızca seçtiğiniz cihazı alır ve yalnızca o sekmenin kapsayıcısında. Bir web sayfası artık bilgisayarınızdan ya da yerel ağdan ses veya video okuyamaz.
- Daha fazla riskli dosya türü açılmadan durdurulur (kısayollar, disk görüntüleri, OneNote dosyaları, yükleyici yamaları ve Chrome’un uyardığı geri kalanı) ve bir film gibi sıradan bir dosya hemen açılır.
- Kilit daha güçlü: PIN’i kilitliyken değiştirilemez, yanlış PIN’ler yeniden başlatmalar boyunca sayılır ve bekleme süresi uzar, site bildirimleri ve kimlik doğrulayıcı değişiklikleri kilidi açana kadar bekler.
- Adres çubuğu, @ işaretinden önce bir ad bulunan bir adresin gerçek ana bilgisayarını gösterir ve asma kilit artık başarısız bir sayfaya güvenli demez.
- Vex, daha önce görmediğiniz bir cihaz eşitleme hesabınızda oturum açtığında bunu adıyla size söyler ve hesabın adresine, eşitleme verileri silinirse bir e-posta gider.
- Reklam ve izleyici engelleme listeleri engelleyici kapalıyken indirilmez ve Vex’in tamamı öyle yapıyorsa Tor ya da vekiliniz üzerinden gider.
- Tor üzerinden yönlendirdiğiniz bir site artık orada yazdığınız parolayı kaydetmeyi önermez.
- Tüm Verileri Dışa Aktar artık kilit PIN’inin karmasını ya da MCP belirteçlerini yazmaz, sorun raporları worker adlarınızı ve ev adreslerinizi dışarıda bırakır ve bir sayfa artık Pano Geçmişi’ni sahte kopyalarla dolduramaz.

### Parolalar ve oturum açma
- **Ayarlar › Parolalar girişlerinizi ekleyebilir, düzenleyebilir, gösterebilir, kopyalayabilir, arayabilir ve dışa aktarabilir** (gösterme ve kopyalama önce yeniden sorar) ve “Asla kaydetme”yi geri alabilir.
- **Parola Sağlığı parolalarınızı bilinen ihlallere karşı denetleyebilir**, siz açana kadar kapalıdır. Her parolanın karmasının yalnızca ilk 5 karakteri bilgisayarınızdan çıkar.
- **Kimlik Doğrulayıcı, parola ifadesiyle kilitli bir dosyaya yedeklenebilir** ve Google Authenticator’ın aktarım QR kodunu tek seferde içe aktarabilir.
- İki adımlı oturum açmalar (Google, Microsoft) kaydetme için sunulur ve engellenen bir geçiş anahtarı isteği, Burada izin ver içeren bir çubuk gösterir.
- Form Doldurma artık tam adınızı Şirket ya da Kullanıcı adı alanlarına koymuyor ve boşaltılmış bir 2FA alanı geçerli kodu alıyor.

### Sekmeler ve adres çubuğu
- **Yeniden yükle, bir sayfa yüklenirken Durdur’a dönüşür** ve F5, Ctrl+F5, F6, Alt+D, Ctrl+PageUp/PageDown ve Ctrl+Shift+PageUp/PageDown diğer tarayıcılardaki gibi çalışır.
- **Adres çubuğu ziyaret ettiğiniz siteleri tamamlar** (“gith” github.com’a gider) ve oraya ne sıklıkla ve ne kadar yakın zamanda gittiğinize göre sıralar. Shift+Delete bir öneriyi kaldırır.
- **Adres çubuğuna yazılan bir cümle aranır**, tek harfli bir anahtar sözcük tarafından alınmak yerine (“a good book” artık Amazon’da aramıyor). Yerleşik site aramaları “@w hotels” ya da anahtar sözcük ve Tab kullanır; Ayarlar › Genel onları listeler ve kendinizinkini eklemenizi sağlar.
- Adres çubuğu gerçek alan adı uzantılarını bilir; böylece “lodash.debounce” aranır ve “router/” açılır. Başka alfabelerdeki adresler yazıldığı gibi görünür.
- **Kaydedilmiş bir oturumu açmak sekmelerini sizinkilerin yanına ekler**, hepsini kapatmak yerine ve bir çalışma alanı değişimi uyuyan sekmeleri uyur halde tutar. Özel ya da Tor sekmeleri açıkken şunu sorar: “Bu seferlik kapat”, “Açık tut” ya da “Her zaman kapat” (Ayarlar › Genel › Çalışma alanları bunu Sor’a geri koyar).
- Bölünmüş ekran tıkladığınız bölmede çalışır ve yeniden başlatmadan sonra geri gelir.
- Şeridin sonunda bir “Tüm sekmeleri listele” düğmesi, bir sayfayı kaydetmek için Ctrl+S, Tarama Verilerini Temizle için Ctrl+Shift+Delete, adres çubuğunda bir sağ tık menüsü ve sekme şeridine bırakılan bağlantılar ya da dosyalar orada açılır.
- Çoğalt, Kapatılan Sekmeyi Yeniden Aç ve panellerden gelen bağlantılar sekmeyi ait olduğu yerin yanına koyar. Sessize alınmış sekmeler sessiz kalır.

### Vex Eşitleme
- **Eşitleme artık sunucu onu reddedene kadar büyümüyor.** Silinen öğeler her cihazda olduğunda temizlenir ve yalnızca yakın geçmiş eşitlenir.
- **Bir eşitleme açık olan bir sekmeyi asla değiştirmez ya da kapatmaz.** Diğer cihazların sekmeleri Geçmiş › Diğer cihazlardaki sekmeler altında listelenir.
- **Değişiklikler diğer cihazlarınıza iki dakika yerine yaklaşık 5 saniyede ulaşır.**
- **Neyin eşitleneceğini seçin**, her veri türü için bir anahtar. Her cihaza ad verin, eşitleme çakışmalarını görün ve geri alın; görünümünüz, kaplamanız ve yazı tipleriniz de artık eşitleniyor.

### Ayarlar ve erişilebilirlik
- **İndirme klasörünüzü seçin**, ya da her dosyanın nereye kaydedileceği sorulsun.
- **Ayarlar › Genel’deki Dil seçeneği** İngilizce ve Türkçe arasında hemen geçiş yapar ve Türkçe artık her Ayarlar başlığına, ipucuna ve kurulum adımına ulaşıyor.
- **Ayarlar klavyeyle ve ekran okuyucuyla çalışır**: odak halkaları, adlandırılmış denetimler ve Tab’ı içeride tutan pencereler.
- Ayarlar araması “dark mode”, “homepage”, “proxy” ve daha fazlasını biliyor. “Diğer” çipi kalktı, bölümleri bakacağınız yerlere taşındı.
- Kararlı güncelleme kanalı, iki gün geride kaldıktan sonra bir güncelleme sunar. Öncesinde neredeyse hiç sunmuyordu.
- Başka bir tarayıcıdan içe aktarma Opera’yı, Vivaldi’yi, Chromium’u, LibreWolf’u ve daha fazlasını bulur.
- **Kendi arama motorunuzu ekleyin**, Ayarlar › Genel’de (“Kendinizinkini ekleyin…”: bir ad ve %s içeren bir adres). Adres çubuğu, Ctrl+K ve Yeni Sekme kutusu için varsayılan olur ve ondan öneri istenmez.
- **Güncellemelerden önceki yedeklerin tek bir listesi**, Ayarlar › Yedekleme’de: her yeni sürümün eskiden başka yerde sakladığı ayar kopyası artık aynı listeye giriyor, parolalar ve anahtarlar olmadan, son beşi saklanıyor. Eski kopyalar taşındı, kaybolmadı ve başarısız olan bir yedek ekranda söylenir.

### Temalar
- **Web siteleri Vex’in açık ya da koyu halini izler**, ya da Windows’u, ya da her zaman açık ya da koyu (Ayarlar › Görünüm › Web sitesi görünümü). Orada bir Hareketi azalt anahtarı da var.
- **Yeni tema: Yüksek Karşıtlık Koyu.**
- Metin, ipuçları ve bağlantılar her temada ve Yeni Sekme sayfasında okunaklı: 45 temanın renkleri 4,5:1 asgarisinin altındaydı ve açık temalı Glass düzeltildi.
- Koyu temalar koyu kaydırma çubukları ve menüler alır. Büyük ve En büyük metin artık kısayollar çubuğuna, bildirimlere, bul çubuğuna ve Yeni Sekme sayfasına ulaşıyor.

### İndirmeler, okuma ve sayfalar
- **İndirmeler paneli aranabilir**, bir bağlantı kopyalanabilir, biten bir dosya silinebilir ya da dışarı sürüklenebilir. Kopan bir bağlantı, gerçekten devam ettiren bir Sürdür gösterir.
- **Beslemeler neyi okuduğunuzu bilir** ve Ctrl+K bir sayfanın beslemesine abone olabilir.
- İzlenen sayfaların tek listesi, Tor ya da vekil siteleri için gerçek bağlantınızdan asla denetlenmez. **Yönlendiricinize, NAS’ınıza ya da evdeki başka bir cihaza eklediğiniz bir izleme artık çalışıyor**, bu bilgisayarın onu ne sıklıkla denetlediğini söyleyen bir notla.
- Vurgulamalar kalın metin ve bağlantılar boyunca geri gelir ve okuma kipinde görünür.
- **Reklam engelleyicinin listeleri haftalık güncellenir** ve engellenmiş bir reklama tıklamak boş bir sekme yerine bunu söyler.

### Uzantılar
- **Uzantıların alarmları, çerezleri ve sekme olayları artık çalışıyor** ve chrome.windows, chrome.notifications ve chrome.downloads alıyorlar.
- Yükleme pencereleri Vex’te nelerin çalışmayacağını açıkça söyler.
- Bir kapsayıcının ilk sekmesi, istek izleyen bir uzantı yüklüyken yeniden yükleniyor.

### Yapay zekâ, Discord ve paneller
- Yapay zekâ paneli artık sorusunu yanıtladığınızda kapanmıyor, Temizle baktığınız sohbeti boşaltıyor ve “remember that…” yapay zekâ belleğinde tutuluyor.
- Yapay Zekâ Çevirisi seçtiğiniz dili kullanır. Yavaş yerel yanıtlar artık iki dakikada kesilmiyor.
- **Discord’un Otomatik yapılandır atlatması yeniden çalışıyor** ve neyin işe yaradığını hatırlıyor; hazırlar arasında geçiş de artık eski bir ciadpi.exe’yi çalışır bırakmıyor.
- Discord’un belleğinin tek bir sınırı ve tek bir bildirimi var ve Vex oyunlar sırasında çok daha az uyanıyor.

### Daha hızlı
- **Yeni bir pencere ya da özel pencere yaklaşık 0,3 sn daha erken açılır**, ilk başlatma da yaklaşık 0,4 sn daha erken.
- Recall her sayfadan sonra değil, en fazla dakikada bir kaydeder.

## v14.72.3 (2026-10-10) — Daha güvenli bir kilit, diğer uygulamalarınız için geri dönen tuşlar ve çok daha sessiz bir Vex

### Yeni bir sürüm numarası türü
- **Vex’in sürümü artık her sürümün getirdiğiyle birlikte büyüyor.** Her değişiklik, ne kadar önemli olduğuna, ne tür bir değişiklik olduğuna ve kaç kişinin fark ettiğine göre puanlanır. Her 10 puan ortadaki sayıyı, her 1.000 puan birinci sayıyı ilerletir. İlk sürümden beri yapılan her değişiklik aynı şekilde puanlandı; bu sürümün v14 olması bu yüzden: bir boşluk yok, yalnızca daha büyük bir sayı. Güncellemeler eskisi gibi çalışır.

### Gizlilik ve güvenlik
- **F12, Ctrl+Shift+J, Ctrl+Shift+F12 ve Ctrl+Alt+H diğer programlarınızda yeniden çalışıyor.** Vex çalışırken bunları tüm Windows için tutuyordu; bu yüzden VS Code’un Tanıma Git’i, Chrome’un konsolu ve Steam’in ekran görüntüsü tuşu hiçbir şey yapmıyordu. Artık yalnızca Vex’in içinde çalışırlar. Patron tuşu Ctrl+Alt+H’yi yalnızca Vex gizliyken Windows için alır; böylece onu geri getirebilirsiniz.
- **Kilitli bir Vex yalnızca PIN’iyle açılır.** DevTools’tan açılabiliyordu. Vex artık PIN’i kendisi denetliyor, kilitlendiğinde DevTools’u kapatıyor ve kilit açılana kadar kapalı tutuyor.
- **E-postanızdan gelen kodlar yalnızca onları gönderen siteye doldurulur**, böylece bir Discord kodu artık benzer görünümlü bir sayfaya düşmez ve eşleşmeyen bir kod asla gönderilmez. Ayarlar › Otomatik doldurma’da bir “Oturum açma kodlarını e-postanızdan doldur” anahtarı var.
- Özel ya da Tor sekmesinin sayfa başlığı artık normal geçmişinizdeki bir girdiyi yeniden adlandırmıyor.
- Burner kimlikleri ve Tor sekmeleri her yerde aynı Chrome sürümünü bildirir; böylece ayırt edilmeleri daha zordur.

### Daha hızlı ve daha sessiz
- **Vex Eşitleme yalnızca bir şey değiştiğinde yükler**, her iki dakikada bir tüm hesabınızı (saatte yaklaşık 28 MB) değil ve telefon değişiklikleri artık iki seferden birinde kaçırılmıyor.
- **Ayar dosyası yarı boyutta** ve artık her dakika, ayar başına bir kez ya da bir sayfa başlığını her değiştirdiğinde (Spotify, Discord ve Gmail bunu sürekli yapar) yeniden yazılmıyor.
- Geçmiş bir kez tutuluyor: her sayfa ziyaretinde yeniden yazılan ikinci bir kopya, Vex’in bir sonraki başlangıcında geçmişinize katılıyor ve her ziyaret korunuyor.
- **Hiç uyumayacak şekilde ayarlanmış ve 1,5 GB’ı aşan bir sekme ya da panel bunu bir kez söyler**, Yeniden yükle ve Uyumasına izin ver ile. Aramalar için uyanık tutulan Discord da dahildir.

### Sekmeler ve sayfalar
- **Geri ve İleri**, bir sekmeyi uyutmaktan, kapatılmış birini yeniden açmaktan ve Vex’i yeniden başlatmaktan sağ çıkar.
- **Bir bağlantıdan açılan sekme**, en sağa değil, geldiği sekmenin yanına gider.
- **“Siteden ayrılınsın mı?” yeniden soruluyor**, bir Vex penceresinde, içine yazdığınız bir sayfadan ayrılmadan önce; böylece yazılan metin kaybolmaz.
- Bir adres yazıp Enter’a bastıktan sonra, sayfa yüklenirken adres çubuğu onu göstermeyi sürdürür.
- **Bul çubuğu her sekmeye aittir**: arka planda açılan sekmelerdeki eşleşmeleri sayar, artık başka bir sekmenin sayısını göstermez ve Shift+Enter geri gider.
- Adres çubuğu önerileri Ctrl+D ile yer imi eklenen sayfaları içerir.

### Kullanımı kolaylaştı
- **Ayarlar normal boyutta yine her kategoriyi gösteriyor**; yapay zekâ ayarları tek bir Yapay zekâ çipinin altında, aralarında geçmek için bir sıra daha küçük çiple duruyor.
- **Vex açık kaldığı sürece her altı saatte bir güncelleme denetler**, yalnızca başladığında değil.
- **Yerel yapay zekâ neyin yanlış olduğunu hemen söyler**: Ollama çalışmıyor, model kurulu değil, model çöktü (örneğin bir oyun çalışırken belleğin yetmemesi) ya da hâlâ yükleniyor.
- Vex Eşitleme, adresi yapay zekâ worker’ınınki olduğunda “Kimlik doğrulaması gerekli” yerine bunu söyler.
- Eski bir Vex’ten gelen sorunlar Bellek › Sağlık’ta “Eski bir sürümden” altına katlanır ve sorun listesini temizlemenin Geri al’ı var.
- “Oturumu her 10 dakikada otomatik kaydet”, adlandırılmış oturumlarınızı itip çıkarmak yerine otomatik kaydedilmiş tek bir oturum tutar ve her seferinde bir bildirim göstermez.

### Düzeltmeler
- E-posta kodu otomatik doldurma yeniden dolduruyor: kod bekleyen bir sayfa, diğer sayfalar üç posta kutusu yuvasını da tutarken geri çevriliyordu.
- Çok uzun adresli tek bir sekme, her sekme, çalışma alanı ve oturum kaydının başarısız olmasına yol açıyordu; geçmiş de bu tür sayfaları reddediyordu.
- Vex başlarken not edilen bir sorun, kaydedilmiş sorun listesini silebiliyordu.
- Silinmiş bir Vex.exe’ye işaret eden Vex’in Başlat menüsü ve masaüstü kısayolları yeniden kurulu Vex’e yönlendirilir.
- Windows’un kapanması, Vex’ten çıkılması ve bir güncellemenin kurulması artık çökme olarak listelenmiyor.
- “Bu sitenin verilerini temizle” başarısız olduğunda ve neyin başarısız olduğunu söyler.
- Ctrl+K › Ortam değiştir, içinde bulunduğunuz sekmeyi taşır; Yapay Zekâ ile Sekmeleri Düzenle’yi yeniden atamak Ctrl+Shift+G’yi serbest bırakır; yakınlaştırma tuşları, hoparlör düğmesi ve sekme önizlemeleri artık hâlâ yüklenen bir sekmede hata vermiyor.

## v13.39.9 (2026-10-09) — İki düzeltme

_v2.38.1 olarak yayımlandı._

### Düzeltmeler
- **Vex Eşitleme artık sizi tek kelime etmeden oturumdan çıkarmıyor.** Vex oturum açmanın ortasında kapatıldıysa ya da Windows kayıtlı oturum açmayı artık okuyamıyorsa, Vex sessizce “Oturum açılmadı” göstermek yerine bunu başlarken ve Ayarlar › Vex Eşitleme’de söyler.
- **Açık Işık ve koyu ile giydiğiniz temayı silmek**, saat için olan temayı giydirir; “artık temanız” bildirimi çıkmaz.

## v13.38.9 (2026-10-09) — Sizin istediğiniz gibi temalar, daha sakin bir Vex ve “Emin misiniz?” yerine Geri al

_v2.38.0 olarak yayımlandı._

### Temalar
- **Açık ve koyu**: Vex, Windows’u ya da bir zamanlamayı izleyerek kendiliğinden bir açık tema ve bir koyu tema giyer. Seçtiğiniz bir tema renklerine göre açık ya da koyu temanız olur, “yanlış” saatte bile hemen görünür ve bildirim bir sonraki geçişte ne olacağını söyler.
- **Chrome Web Mağazası temaları Vex temaları olur**: bir temanın mağaza sayfasında, bağlantısında ya da kimliğinde Vex’e Ekle ya da .crx dosyası. İmzalar bir uzantı gibi denetlenir, renkleri 4,5:1’de okunan bir temaya dönüşür (neyin ayarlandığını söyleyerek), resmi Yeni Sekme sayfasına gider ve kod içeren paketler reddedilir.
- **Herhangi bir resimden ya da Windows duvar kağıdınızdan bir tema**, Sakin, Canlı ve Açık/Koyu sürümleriyle ve resim Yeni Sekme arka planı olarak.
- **Kendi temanızı yapın**: herhangi bir temayı Vex’in ve Yeni Sekme’nin canlı önizlemesiyle, karşıtlık uyarılarıyla ve bir Karşıtlığı düzelt düğmesiyle düzenleyin ve küçük bir .vextheme dosyası olarak paylaşın. Temalarınız eşitlenir ve birini silmek Geri al ile hemen olur.
- **Bir ihtiyaç için yeni temalar**: AMOLED (gerçek siyah), Yüksek Karşıtlık Açık, gece okuması için Akşam ve Windows 11 Mica Açık ile Mica Koyu. Yeni Sekme sayfasındaki her sözcük bunlarda okunur.
- Firefox — koyu’yu (ya da herhangi bir açık/koyu görünüm sürümünü) elle seçmek, renk temanız diğer açıklıktayken kendi renklerini gösterir. Glass bir temanın Yeni Sekme resmini gösterir.

### Kullanımı kolaylaştı
- **Basit kip**: yeni profiller, her şeyi geri getiren tek bir Tüm özellikler anahtarıyla sakin bir Vex ile başlayabilir. Mevcut profiller olduğu gibi kalır.
- **“Emin misiniz?” yerine Geri al**: silme, kapatma, temizleme, bir siteyi sıfırlama ve Un-zap, her şeyi eski yerine tam olarak geri koyan bir Geri al bildirimiyle (düğme ya da Ctrl+Z) hemen gerçekleşir. Yeniden açılamayan sekmeleri kapatmak artık başarısız olan bir Geri al sunmuyor.
- **Asma kilit site için tek bir panel açar**: bağlantı ve sertifika, İzin ver/Sor/Engelle ile izinler, yakınlaştırma, asla uyuma, her zaman çevir, reklam engelleme, anahtarları, nerede açıldığı ve çerezleri; hepsi Ayarlar’ın gösterdiği aynı yerlerde tutulur.
- **Yenilikler**: bir güncellemeden sonra küçük bir kart nelerin yeni olduğunu, sürüm başına bir kez söyler; kaçırdığınız sürümler için Her şeyi gör ile.
- Bildirimler site panelinden, Daha fazla araçtan ve indirme kartlarından uzak durur; böylece Site ayarları, Aç ve Göster erişilebilir kalır.
- Dar ya da ölçeklenmiş bir pencere her görünümde kullanılabilir bir adres alanı korur; başarı metni her temada okunur; yapay zekâ ayarları etiketleri artık sıkışmıyor.

### Parolalar, eşitleme ve cihazlar
- **Vex kayıt formlarında güçlü bir parola önerir** (yalnızca HTTPS) ve gönderdiğinizde kaydeder; Ayarlar › Parolalar’da bir oluşturucu var. Kopyalanan bir parola ya da kod, Vex arka plandayken bile 30 saniye sonra panodan temizlenir.
- **Bir sekmeyi telefonunuza ya da diğer bilgisayarlara gönderin**, sekme menüsünden, adres çubuğundan ya da Ctrl+K’den; size gönderilen sekmeler bir bildirimle Yeni Sekme sayfasında kart olarak bekler.
- **Her eşitleme hesabının kendi sunucu depolaması var** ve mevcut hesaplar ilk eşitlemelerinde kimseyi oturumdan çıkarmadan oraya taşınır (güncellenmiş Sync Worker gerekir). Özel bir pencere asla eşitlenmez ve bunu Ayarlar’da söyler.

### Okuma ve gizlilik
- **Günlük bir okuma özeti**: Sonra Oku’daki her makale yerel yapay zekânız tarafından özetlenir, Kitaplık’ta ve Yeni Sekme sayfasında.
- **Recall artık yeni profiller için isteğe bağlı**; bu sürümden önce kurulan profiller sahip oldukları seçimi korur.

### Uzantılar
- **Uzantılardan sağ tık menüsü öğeleri, klavye kısayolları ve araç çubuğu rozetleri artık çalışıyor**. Uzantılar rozetleri, simgeleri, açılır pencereleri ve menüleriyle araç çubuğuna sabitlenebilir ve menüler ekranda kalır, alt menüler yanlarında açılır.

### Düzeltmeler
- Bir sitenin Boost CSS’i ve gizli öğeleri, JavaScript’i kapalıyken bile uygulanır.
- Engellenen açılır pencereler, Chrome’un yaptığı gibi, sizin istedikleriniz arasından ayırt edilir. Asla uyuma ve her zaman çevir site listeleri eşitlenir.
- Uygulama Olarak Aç pencereleri ve özel pencereler artık reddedilen isteklere takılmıyor; Bunu Yeniden Yap, bulunduğunuz yerde çalışamayan bir komutu artık tekrarlamıyor.
- Windows kod imzalama, bir sertifika kurulduğunda açılmaya hazır ve yüklemeden önce denetleniyor.

## v12.69.5 (2026-10-07) — Tam bir kontrol: daha güvenli, daha küçük ve dediğini yapan ayarlar

_v2.37.0 olarak yayımlandı._

### Gizlilik ve güvenlik
- **Başka bir programı açan bir bağlantı** (Word, Steam, VS Code…) artık önce soruyor, sayfada bir tıklama gerektiriyor ve özel, kayıt dışı ya da Tor sekmelerinden asla çalışmıyor; dosya getiren Office bağlantıları her seferinde soruyor.
- **Kayıt dışı ve burner sekmeleri** artık bir siteye kamera, mikrofon ya da bildirim vermeden önce soruyor, reklamları ve izleyicileri engelliyor ve Chrome gibi görünüyor.
- **Resim İçinde Resim sekmenin kendi oturumunda yüklenir**, böylece Tor ve özel videolar özel kalır.
- **“Vex’in tamamı Tor ya da bir vekil üzerinden” artık her şeyi kapsıyor**: her sekme, kapsayıcı, uygulama paneli, özel pencere ve posta; panel, kendi yolunu neyin koruduğunu söyler.
- Vex’in kendi ekranlarındaki bağlantılar sekme olarak açılır, asla fazladan pencere olarak değil. Uygulama Olarak Aç ve katman, özel, kayıt dışı ve Tor sekmelerinden reddedilir.
- Kaydedilmiş girişler oturum açma açılır pencerelerine yalnızca alana tıkladıktan sonra doldurulur.
- Bir indirmeyi yeniden denemek geldiği sekmeyi kullanır; özel ve Tor sekmelerinden indirmeler diske kaydedilmez; Aç yalnızca Vex’in indirdiği dosyaları çalıştırır.
- MCP sunucu belirteçleri şifrelenir ve yedeklerin dışında bırakılır; çökme günlüğü artık özel sayfaları ya da tam adresleri kaydetmez.
- SponsorBlock ve “Vex’e bu resmi sor”, siz izin vermeden özel ya da Tor sekmelerinden asla dışarı uzanmaz; YalnızcaHTTPS artık bir sertifika hatasında sessizce http’ye düşmez.
- Siteler artık sekme türleri arasında tek bir parmak izi değeri paylaşmıyor; Discord panelinin otomatik kamerası ve mikrofonu yalnızca Discord için geçerlidir.

### Uzantılar
- **Uzantılar kendilerini günceller**: başladıktan iki dakika sonra ve her altı saatte bir denetlenir, asla çevrimdışıyken ya da kotalı bir bağlantıda değil. Daha fazla izin isteyen yeni bir sürüm, onayınız için kartında bekler. Ayarlar › Uzantılar’da “Uzantıları otomatik güncelle” ve “Şimdi denetle” var.
- **“.zip / .crx’ten yükle” bir .crx’i Web Mağazası yüklemesi gibi denetler** (imzalar, mağazadan olduğunu söyleyen her şeyde mağazanın imzası; CRX2 reddedilir) ve her yükleme önce neler yapabileceğini ve nereden geldiğini gösterir.
- **Uzantılar artık bilgisayarınızdaki dosyalara erişemiyor**, siz kartlarında izin vermedikçe. İşi yerel dosyaları açmak olan biri bunu korur ve kartı bunu söyler.

### Uyku ve ayarlar
- **“Asla yapma” artık asla demek.** Gizli 30 dakikalık sekme karartma kalktı, Discord aynı seçimi izliyor (kendi ayrı ayarı kaldırıldı), uyanık tutulan Discord asla uyutulmuyor ve “asla” altında uyku satırları nedeniyle birlikte gri gösteriliyor.
- Bir uyku bildirimindeki “Her zaman” yalnızca o türü kapsar; bir oyundan sonraki “Bir dahaki sefere yap” çalışıyor; Bellek Tasarrufu artık kapalı görünen anahtarların arkasında otomatik uykuyu ya da bellek bekçisini açmıyor; paneller sekmelerle aynı süre sonra uyuyor; bir grubun “Sekmeleri uyut” komutu ses çalan bir sekmeye dokunmuyor; otomatik uyku ayarları eşitleniyor.
- **Vex Eşitleme, hiçbir Sync Worker URL’si ayarlı olmadığında ya da son eşitleme başarısız olduğunda “Eşitlenmiyor” der**, Ayarlar › Bulut’a giden bir düğmeyle; araç çubuğundaki eşitleme simgesi yalnızca eşitleme gerçekten çalışıyorsa etkin görünür.
- “Yereli tercih et” çeviriyi, geçmiş aramasını, çok sekmeli yapay zekâyı ve ajanı yerel modelinizde tutar; “Her zaman bulut” cihaz üzerindeki yapay zekâyı geçer.
- Kurulum: yeniden açmak artık görünümünüzü, panellerinizi ve kısayollarınızı geri almıyor; Bulut yapay zekâ adımı erişim belirtecini istiyor; performans hazırları Vex’in bir şeyleri uyutup uyutamayacağını ayarlıyor; dil değişikliği hemen uygulanıyor.
- Varsayılanlara Sıfırla, tema dahil her ayarı sıfırlar; yardım ve rehber bağlantıları doğru bölümü açar; sayılar yazılmak yerine sayılır.

### Kullanımı kolaylaştı
- **Dar ya da ölçeklenmiş bir pencere kullanılabilir bir araç çubuğu korur**: sığmayan düğmeler bir “Daha fazla araç” menüsüne taşınır ve Kapat her zaman ekranda kalır. Adres çubuğu sayfa yakınlaştırmasını 100% olmadığında gösterir.
- Sekmelerimi Düzenle iptal edilebilir, sonradan asla açılmaz, boş Yeni Sekmeleri atlar ve kutuyu işaretlemediğiniz sürece artık örüntüleri hatırlamaz.
- Temanın ana renginde düğmeler her temada okunur (yaklaşık 55 tanesi açık bir renk üzerinde beyaz metne sahipti), Yeni Sekme sayfasında ve koyu tarayıcı görünümlerinde de.
- YouTube’un reklam engelleme betiklerinin hepsi yine çalışıyor; web panelleri yüklendiklerini gösteriyor; Firefox tarzı kenar çubuğu aşağıda daha fazla simge olduğunda bunu gösteriyor; Ayarlar büyük boyutlarda kategori çiplerini bir ya da iki satırda tutuyor.
- Gizlilik paneli bir sitenin kendi analitiğini sizi izleyen izleyicilerden ayırır; çeviri çubuğu sayfayı kapatmak yerine aşağı iter; sekme menüsü Yeniden yükle ve Yer imi ekler ve erteleme sürelerini bir alt menüye koyar.
- Yeni bir profildeki “Araçlar” bir aracın ne olduğunu açıklar; Kuyruk paneli kurulu olmadığını açıkça söyler; Yeni Sekme, Bellek’te ve sekme önizlemelerinde “Yeni Sekme” olarak görünür; daha derli toplu posta kurulumu; artakalan “İndiriliyor…” bildirimi yok; başlangıçta dinleyici uyarısı yok.

### Daha küçük ve daha derli toplu
- **Yükleyici yaklaşık 38 MB daha küçük** (167 → 130 MB): yapay zekâ ve OCR motorları artık iki kez paketlenmiyor.
- Derleme artık `dist\` içinden çalıştırdığınız bir Vex’i silmiyor; web sitesi rozeti yalnızca bir sürüm yayımlandıktan sonra hareket ediyor.
- README, kendi kendine barındırma rehberi (eşitleme oturum açma kodlarını kimlerin alabileceği dahil), mimari ve sürüm belgeleri güncel; web sitesi artık telefonlarda yana kaymıyor.

## v12.54.5 (2026-10-05) — Bir şey soran tam ekran video artık Vex’i dondurmuyor

_v2.36.4 olarak yayımlandı._

### Düzeltmeler
- **Tam ekrandaki bir sayfadan gelen soru Vex’i dondurdu.** Kenar çubuğu panelindeki Prime Video, tam ekranda oynarken bir şey sordu; soru tam ekran videonun altında gizli kaldı ve diğer her şey tıklama almayı bıraktı. Artık bir soru soran tam ekrandaki sayfa önce tam ekrandan çıkıyor ve sorusunu panelinin üzerinde soruyor.
- **Göremediğiniz bir soru tıklama ya da tuş almaz.** Sekmesi ya da paneli işaretlenir ve köşedeki bir kart kimin sorduğunu Aç ile söyler.
- Her sayfa sorusu Sorunlar altında listelenir (site, nerede, ne türde ve ilk 200 karakteri); böylece bir sayfanın ne sorduğunu görebilirsiniz.
- Kendini kapatmaya çalışan bir kenar çubuğu panelindeki sayfa artık panelı etkilemiyor.

## v12.52.0 (2026-10-05) — Artık donan Vex yok

_v2.36.3 olarak yayımlandı._

### Düzeltildi
- **Bir sayfanın alert, confirm ya da prompt penceresi artık Vex'i dondurmuyor.** Bunlar tüm Vex penceresine bağlı bir Windows ileti kutusu açıyordu; Vex Görev Yöneticisi'nden sonlandırılana kadar her tıklama duruyordu ve kutu bir panelin arkasında gizlenebiliyordu. Artık soru yalnızca o sekmenin ya da kenar çubuğu panelinin üzerinde görünüyor ve o sayfa yanıtınızı beklerken Vex'in geri kalanı çalışmaya devam ediyor, tıpkı Chrome'daki gibi. Arka plandaki bir sekme ya da gizli bir panel bir işaret alır ve siz onu açtığınızda sorar. Bir sayfanın ikinci iletişim kutusundan itibaren daha fazlasını göstermesini durdurabilirsiniz; kapanan ya da başka yere giden bir sayfa da beklemeyi hemen bırakır.
- **Vex yanıt vermeyi bıraktığında bunu söylüyor.** Vex penceresi yanıt vermeyi bırakırsa Vex artık ölü bir pencere bırakmak yerine "Vex yanıt vermeyi bıraktı — Pencere yeniden yüklensin mi?" diye soruyor; yeniden yüklemeyle sekmeleriniz ve ayarlarınız geri geliyor. Takılma, açık olan sayfalarla birlikte çökme günlüğünde tutuluyor ve Vex toparlanırsa soru kendiliğinden kayboluyor.
- Gizli kayıt dışı sekmeler artık diğer sekmelerle aynı sayfa özelliklerine sahip.

## v12.48.2 (2026-10-04) — Yalnızca açılır pencerelerinde değil, sayfada da çalışan uzantılar

_v2.36.2 olarak yayımlandı._

### Düzeltildi
- **Ayarlarını eşitleme depolamasında tutan uzantılar artık web sayfalarında da çalışıyor.** Material Icons for GitHub hiçbir simgeyi değiştirmiyordu, çünkü sayfa betiği ayarlarını okuyamıyordu. Artık GitHub'ın dosya ve klasör simgelerini değiştiriyor ve açılır penceresinde yapılan değişiklikler sayfaya ulaşıyor.
- **Bir uzantının açılır penceresi artık hangi sayfanın üzerinde açıldığını biliyor.** Chrome'da olduğu gibi, "bulunduğunuz sayfayı" isteyen bir uzantıya tıklamak o sekmenin adresini, başlığını ve simgesini görmesini sağlıyor. Material Icons for GitHub, GitHub'da "Desteklenmiyor" diyordu; artık ayarlarını gösteriyor.

## v12.45.7 (2026-10-04) — Uzantıları Chrome Web Mağazası'ndan yükleyin

_v2.36.1 olarak yayımlandı._

### Yeni
- **Uzantıları Chrome Web Mağazası'ndan yükleyin.** Vex'te bir uzantının sayfasını açıp adres çubuğundaki **Vex'e ekle**'ye tıklayın, bağlantısını Ayarlar › Uzantılar'a yapıştırın ya da Ctrl+K → "Bu uzantıyı Web Mağazası'ndan yükle" yolunu kullanın. Vex paketi, Chrome, Brave ve Vivaldi'nin yaptığı gibi Google'ın kendi güncelleme sunucusundan indirir ve yalnızca hem geliştiricinin hem de Web Mağazası'nın imzaları doğrulanırsa yükler. Hiçbir şey yüklenmeden önce neleri okuyabileceğini ve yapabileceğini, ayrıca Vex'te nelerin çalışmayacağını görürsünüz. Kartındaki **Web Mağazası'ndan güncelle** en yeni sürümü getirir ve ayarlarını korur. Gizli pencerelerde ya da Tor sekmelerinde kullanılamaz.

### Düzeltildi
- Uzantı yardımı artık paket dağıtmayı bırakan crxextractor.com'a yönlendirmiyor.
- Uzantıların burada yapamadıklarının listesi güncel: sekme açma ve storage.sync artık çalışıyor; çerezler, gezinme olayları, kullanıcı betikleri ve yan paneller çalışmıyor.

## v12.25.7 (2026-10-03) — Profiller, tarayıcıdan içe aktarma, daha iyi bir okuyucu ve varsayılan olarak gizlilik

_v2.36.0 olarak yayımlandı._

### Yeni
- **Profiller.** İş, okul ya da bilgisayardaki başka biri için ayrı Vex'ler tutun. Her profilin kendi sekmeleri, yer imleri, geçmişi, parolaları, uzantıları, Vex Sync hesabı, ayarları ve çerezleri vardır ve kendi penceresinde çalışır; böylece ikisi aynı anda açık olabilir. Araç çubuğundaki yeni profil düğmesinden (ya da Ayarlar › Profiller'den) bunları ekleyin, yeniden adlandırın, yeniden renklendirin ve silin, birini kendi penceresinde açın ya da masaüstüne kısayolunu koyun. Mevcut Vex'iniz Varsayılan profildir ve içindeki hiçbir şey taşınmaz. Bir güncelleme açık olan tüm profillerinizi kapatıp yeniden açar.
- **Başka bir tarayıcıdan içe aktarma.** Yer imlerinizi (klasörleriyle birlikte) ve son geçmişinizi bu bilgisayardaki Chrome, Edge, Brave ya da Firefox'tan getirin: tarayıcıyı ve profili seçin, nelerin ekleneceğini görün ve fikrinizi değiştirirseniz geri alın. Parolalar, o tarayıcıdan sizin dışa aktardığınız bir dosyadan gelir (adımlar ekranda); Vex başka bir tarayıcının kayıtlı parolalarını asla okumaz.
- **Sorun bildir.** Ayarlar › Hakkında ve komut çubuğu, sürümlerinizle, görünümünüzle ve temanızla ve Vex'in son sorunlarıyla önceden doldurulmuş bir GitHub sorunu açar. Önce metnin tamamını görürsünüz ve düzenleyebilirsiniz; Windows kullanıcı klasörünüz, sorgu dizeleri, e-postalar ve belirteçler çıkarılır ve siz GitHub'da Aç'a basana kadar hiçbir şey gönderilmez.
- **Okuyucu görünümü makaleyi bulur**; menüleri, kenar çubuklarını ve yorumları dışarıda bırakır, bağlantıları, tabloları ve kodu korur ve yazı tipi, boyut, genişlik, satır aralığı ve tema için bir araç çubuğu sunar. Esc sizi sayfada bulunduğunuz yere geri götürür.
- **Sesli okuma makalenin tamamını** ya da seçiminizi cümle cümle okur: cümleyi vurgular ve görünür tutar; duraklatabilir, atlayabilir, hızı değiştirebilir ve bir ses seçebilirsiniz. Sayfanın dilinde konuşur, sayfa belirtmediğinde dili metinden çıkarır ve o dil için yüklü bir ses olmadığında bunu söyler.
- **Pencere İçinde Pencere ana videoyu** sayfada yüzdürür, gömülü ya da özel bir oynatıcının içindeyken bile, ve bunu kapatmış bir sitenin ayarını geçersiz kılmadan önce sorar. Yeni ayar: sekme değiştirdiğinizde oynayan bir videoyu yüzdür.

### Gizlilik
- **Yazdıklarınız, arama motorunuz Google değilse artık Google'a gönderilmiyor.** Öneriler yalnızca seçtiğiniz arama motorundan gelir, gizli bir pencereden, bir Tor sekmesinden ya da bir burner'dan asla gelmez ve kapatılabilir (Ayarlar › Genel).
- **Yeni Sekme hava durumu artık sizi IP adresinden aramıyor.** Bir şehir belirleyene ya da "Yaklaşık konumumu kullan"a basana kadar "Şehrinizi belirleyin" gösterir.
- **SponsorBlock yeni profillerde kapalı** (açtığınız her YouTube videosunun kimliğini sponsor.ajay.app'e gönderir); onu kullanan profiller kullanmaya devam eder.
- **Kurulumda bir Gizlilik seçenekleri adımı var** ve "Vex başlarken güncellemeleri denetle" kapatılabilir.
- Eşitleme ve yapay zekâ belleği ayarları artık nelerin eşitlendiğini ve sunucunun neleri görebildiğini doğru biçimde söylüyor.
- Gizlilik ilkesi, şartlar, lisans ve üçüncü taraf bildirimleri Ayarlar › Hakkında'dan bağlantılıdır.

### Daha hızlı ve daha hafif
- **Yükleyici çok daha küçük**: Vex'in hiç kullanmadığı iki kitaplık artık gönderilmiyor.
- **Vex daha erken başlıyor**: posta okuyucusunun kitaplıkları postayı ilk açışınızda yükleniyor.
- **Boştayken daha az iş**: arka plan işleri, saat, eşitleme göstergesi, URL otomasyonları, site hatırlatıcıları ve yayıncı modu saniyede birkaç kez denetlemek yerine değişikliklere tepki veriyor.

### Kullanımı daha kolay
- **Her temada ve görünümde okunaklı**: metin ve simgeler her yerde, Yeni Sekme sayfasında da, WCAG AA karşıtlığını karşılıyor.
- **Klavye ve ekran okuyucu**: Tab sekmelere ulaşır (üstteki ya da yandaki); ok tuşları gezdirir, Enter geçiş yapar, Delete kapatır, Shift+F10 sekme menüsünü açar. Escape içinde bulunduğunuz paneli kapatır, komut çubuğu ekran okuyucuya hangi sonucun vurgulandığını söyler ve adres alanı belirgin bir odak halkası gösterir.

### Düzeltildi
- **"Değişiklikler kaydedilemedi"** iletisi, başka bir program (virüsten koruma, arama dizinleme) Vex'in ayar dosyasını bir an tuttuğunda görünüyordu. Vex artık bekleyip yeniden deniyor, arka planda denemeye devam ediyor ve nedeni Sorunlar'a kaydediyor.
- **Vex zaten çalışırken onu açmak** (başka bir uygulamadan gelen bir bağlantı, bir hatırlatıcının düğmesi) sonraki açılışın uzantısız güvenli modda gelmesine yol açabiliyordu. Artık yol açmıyor ve bu açılışlar çok daha hızlı devrediliyor.
- **Arka plan belirlemeyen sıradan bir sayfa**, Windows koyu moddayken koyu gri sayfada siyah metin gösteriyordu. Bu tür sayfalar artık Chrome'un verdiği beyaz sayfayı alıyor; koyu olan, koyu için çizilmiş sayfalarda (JSON ve metin görüntüleyicileri, koyu bir düzen isteyen sayfalar) kalıyor. Windows açıkken koyu bir sayfa artık beyaz üzerine beyaz metin göstermiyor.
- **Her içe aktarma geri alınabilir**, yalnızca sonuncusu değil: son 10 içe aktarmanız kendi Geri al düğmesiyle listelenir ve bu, sonradan yaptığınız değişiklikleri korur. "M içinden son N" geçmiş sayısı artık hiçbir zaman içe aktarılamayacak girdileri saymıyor.

## v11.94.2 (2026-10-02) — Eşitleme diğer cihazlarınıza adil davranıyor

_v2.35.2 olarak yayımlandı._

### Düzeltildi
- **Eşitleme artık anlamadığı şeyleri silmiyor.** Başka bir cihazın hesabınıza koyduğu ve Vex'in bu sürümünün kullanmadığı veriler (örneğin yakında gelecek mobil Vex'in eklediği bir şey) artık her eşitlemede silinmiş olarak işaretlenmek yerine olduğu gibi aktarılıyor ve bu cihazın eşitlenmesini artık durduramıyor.
- **Boşalmış bir hesap temiz biçimde yeniden kuruluyor.** Cihazlarınız oturum açık kalırken hesabınızın eşitleme sunucusundaki verileri kaybolursa, bir sonraki eşitleme zaten silinmiş şeyleri geri getiren eski bir kopya yerine yalnızca bu cihazdakileri yüklüyor.
- **Eşitlemeye katılırken yinelenen yer imi yok.** Kurtarma kodunuzla oturum açmak artık hesabınızda aynı adreste zaten bulunan bir yer iminin ikinci bir kopyasını tutmuyor.

### Geliştiriciler için
- docs/SYNC_PROTOCOL.md v2.35.2'ye güncellendi: masaüstünün sahip olduğu ve aktardığı şeyler (§6 kural 1), boş hesaplar (§5.3, kural 3), katılırken yer imlerinin tekilleştirilmesi (§5.4), bir istemcinin yazdıklarının doğrulanması (kural 11) ve telefondaki açık silmeler (§9.6).

## v11.91.7 (2026-10-02) — Her güncellemeden önce yedek ve daha küçük güncellemeler

_v2.35.1 olarak yayımlandı._

### Güncellemeler
- **Verileriniz her güncellemeden önce yedekleniyor.** Şimdi güncelle'ye bastığınızda Vex, kurmak için kapanmadan önce Ayarlar › Yedekleme'nin yaptığı yedeğin aynısını kaydeder. Son üçünü tutar ve Ayarlar › Yedekleme bunları bir Geri yükle düğmesiyle "X sürümüne güncellemeden önce" olarak listeler (önce sorar ve geri alınabilir). Yedek alınamazsa, Yine de yükle ya da İptal'i seçene kadar hiçbir şey yüklenmez.
- **Daha küçük güncellemeler.** Vex çalıştırdığınız sürümün yükleyicisini tutar ve bir sonraki güncelleme yalnızca değişen parçaları indirir (2.34.5'ten 2.35.0'a bu, 235 MB yerine yaklaşık 62 MB olurdu). Biten dosya hâlâ sürümün sağlama toplamıyla denetlenir; daha küçük indirmeyle ilgili herhangi bir şey doğrulanmazsa Vex bunun yerine yükleyicinin tamamını indirir. Tutulan yükleyici Vex'in güncellemeler klasöründe yaklaşık 250 MB yer kaplar ve elle yüklemeden sonraki ilk güncelleme tam indirilir.

### Geliştiriciler için
- docs/SYNC_PROTOCOL.md eşitleme protokolünü tam olarak anlatır (uç noktalar, test vektörleriyle şifreleme, kayıt biçimi, birleştirme ve başka bir istemcinin hiçbir cihazın verisini asla kaybetmemesi için uyması gereken kurallar); yakında gelecek mobil Vex içindir.

## v11.86.1 (2026-10-01) — Vex kendini güncelliyor

_v2.35.0 olarak yayımlandı._

### Yeni
- **Vex'in içinden güncellemeler.** Vex'i açtığınızda daha yeni bir sürüm çıkmışsa, bir kapak sizinkinden bu yana nelerin yeni olduğunu ve üç seçeneği gösterir: **Şimdi güncelle**, **Sonra** (bir dahaki sefere yine sorar) ve **Bu sürümü atla**. Şimdi güncelle, sürümü bir ilerleme çubuğuyla indirir, sürümünün yayımladığı sağlama toplamıyla denetler (hasarlı ya da değiştirilmiş bir dosya reddedilir ve silinir), Vex'i sekmeleriniz kaydedilmiş olarak kapatır, sessizce yükler ve Vex'i yeniden açar. Ayarlar › Güncellemeleri denetle aynı kapağı açar.
- Bunu yapabilen ilk sürüm budur: bundan sonra güncellemeler kendiliğinden yüklenir. Daha eski bir sürümdeyseniz, bunu bir kez olağan yoldan yükleyin.

### Değişti
- Köşedeki küçük güncelleme kartı kalktı, bazı bilgisayarlarda Vex'i kapatabilen eski yerleşik güncelleyici de; Kararlı/En yeni kanal seçimi kapak için hâlâ geçerli.

## v11.78.7 (2026-10-01) — Tor'un küçük harfleri, derleme sunucusunda denetlendi

_v2.34.5 olarak yayımlandı._

Yayımlanmayan v2.34.4'teki her şeyi içerir: testlerinden ikisi, Tor'un indirmesinin biraz geç başladığı derleme sunucusunda diskle yarışıyordu. Uygulama aynı.

## v11.78.6 (2026-10-01) — Tor'un küçük harfleri

_v2.34.4 olarak yayımlandı._

_Etiketlendi ama hiç yayımlanmadı (etiket sonradan kaldırıldı); aşağıdaki her şey v2.34.5'te yayımlandı._

v2.34.3'teki her şeyi içerir.

### Düzeltildi
- **Tor'u durdur yalnızca Tor sekmelerinizi kapatır.** Tor üzerinden giden bir kapsayıcıdaki, site kuralındaki ya da burner'daki sekmeler açık kalır; onları yeniden kullanana kadar yüklenmeyi bırakırlar ve sonra Tor kendiliğinden başlar. Durdur iletişim kutusu hangisinin hangisi olduğunu söyler.
- Tor'u yeniden başlatmak, hiçbir şey indirilmediğinde artık "Tor indiriliyor %100" göstermiyor: doğrudan "Tor başlatılıyor"a geçiyor.
- Bir Tor sekmesinde yanıt vermeyen bir site artık Tor'u suçlamak yerine bunu söylüyor ("site Tor üzerinden yanıt vermedi"); "Tor çalışmıyor" yalnızca gerçekten çalışmadığında söyleniyor.
- Ayarlar › Eşitleme, eski bir cihaz eşitlendikten sonra, güncel olan bir cihazı kısayol karosu eşitlemesinin beklediği cihaz olarak artık adlandırmıyor.

## v11.78.1 (2026-10-01) — Tor'u aşan yollar kapandı ve Yeni Sekme karolarınız her cihazda

_v2.34.3 olarak yayımlandı._

### Gizlilik
- **Sekme simgeleri, bir Tor ya da proxy sekmesinin sitesine gerçek adresinizi gösteriyordu.** Simgeyi Vex'in kendi penceresi alıyordu ve doğrudan çıkıyordu. Tor, proxy, kapsayıcı, burner ve gizli sekmelerin simgeleri artık sekmenin kendi bağlantısından alınıyor ve listeler (geçmiş, yer imleri, Sonra Oku ve diğerleri) böyle bir siteden asla simge istemiyor.
- **Vex çalışırken bir kapsayıcıyı, burner'ı ya da siteyi Tor'a geçirmek, Tor ayağa kalkana kadar sayfaların doğrudan yüklenmesine izin veriyordu.** Artık Tor'u bekliyorlar.
- Gizli bir pencereden açılan bir "Tor sekmesi", Vex öyle dese de hiç Tor üzerinde değildi. Tor sekmeleri artık yalnızca normal pencerelerden açılıyor ve bunu söylüyor.
- Sonra Oku'nun okuma süresi, Sayfa İzleme ve yapay zekânın "bu adresi oku"su artık Tor, proxy ya da kapsayıcı üzerinden yönlendirdiğiniz bir siteyi gerçek bağlantınızdan almıyor.
- Site izinleri (konum, kamera, bildirimler…) kapsayıcı başına tutuluyor ve Ayarlar her birinin hangi kapsayıcıya ait olduğunu gösteriyor.

### Tor
- Durdur, her penceredeki Tor sekmelerini kapatır.
- Bir Tor kapsayıcısı, burner'ı ya da site kuralı, Tor durduktan sonra onu kullandığınızda Tor'u kendiliğinden yeniden başlatır; yüklenemeyen bir Tor sayfası boş kalmak yerine nedenini söyler.
- Açılışta başlayamayan Tor, ona ihtiyaç duyan bir sayfa açtığınızda yeniden denenir.

### Eşitleme
- **Yeni Sekme sayfası karolarınız ve kısayol çubuğu artık cihazlar arasında eşitleniyor**, tek tek. Hesaptaki her cihaz bu sürümü ya da daha yenisini çalıştırdığında başlarlar (Ayarlar › Eşitleme beklediği bir cihazı adlandırır); böylece daha eski bir cihaz bunları asla silemez.

### Ayrıca
- Proxy altındaki aramalar: yönlendirme ayarları artık Discord ve Meet aramalarının bağlanamayabileceğini söylüyor, çünkü adresinizi gizlemek için WebRTC proxy ile sınırlı tutuluyor.
- Discord bağlantı düzeltmesi, bir kapsayıcı doğrudan bağlantıya geri alındığında çalışmaya devam ediyor.
- Göz at: geç beliren bir çerez başlığı artık Escape'in onu kapatmasını engellemiyor.
- JavaScript kapalı bir sekme, arka planda ne kadar beklerse beklesin Geri listesini koruyor.
- Uzantılara hangi sekmenin gerçekten önde olduğu söyleniyor.
- Yeni bir sekme açıldığı anda bir adres yazmak artık onu kaybettirmiyor.

## v11.73.1 (2026-09-30) — Tor işiniz bitince duruyor ve listenin geri kalanı

_v2.34.2 olarak yayımlandı._

### Gizlilik
- **Bir kapsayıcıdaki ya da site kuralıyla açılan sekmeler sormadan kamera, mikrofon ve bildirimler alıyordu** ve yerel ağ adresinizi WebRTC'ye gösteriyordu. Artık diğer her sekme gibi soruyorlar (Tor site kuralları reddeder) ve normal sekmelerinizle aynı reklam engelleyiciyi, indirmeleri ve tarayıcı kimliğini alıyorlar.
- Bir proxy üzerinden yönlendirilen bir site ya da kapsayıcı artık gerçek adresinizi WebRTC üzerinden göstermiyor.
- Bir "Tor üzerinden" site kuralını kaldırmak ya da değiştirmek onu gerçekten serbest bırakıyor: eskiden Tor çalışmaya devam ediyor ve her açılışta yeniden başlıyordu. Kaldırılmış bir kuraldan gelen ve hâlâ açık olan bir sekme siz kapatana kadar Tor'da kalır ve asla onun dışında yüklenmez.
- Bir kapsayıcının proxy ya da Tor yolu, Discord bağlantı düzeltmesi tarafından açılışta artık doğrudan bağlantıya sıfırlanmıyor.
- **Bir Tor sekmesine konumunuz verilebiliyordu**: Vex'in kendi konum özelliği size soruyordu ve izin verildiğinde sayfaya kayıtlı konumunuzu veriyordu. Tor sekmeleri ve Tor site kuralları artık bunu asla almıyor.

### Tor
- **Tor kendiliğinden duruyor**, onu kullanan son sayfa kapandıktan yarım dakika sonra.
- **"Tor çalışıyor" işareti ve bir Durdur düğmesi**, Tor çalıştığı sürece, başladığı andan itibaren üst çubukta duruyor.
- Tor artık Vex çöktüğünde bile Vex ile birlikte sona eriyor; eskiden arka planda çalışmaya devam ediyordu.

### Eşitleme
- Kişilikler, araçlar, zamanlanmış görevler, hatırlatıcılar ve zorunlu koyu siteler artık cihazlar arasında, bir cihazın tüm listesinin diğerininkinin yerini alması yerine tek tek birleşiyor; araçlar ve kişilikler ayrıca eşitlenmiş bir değişikliği hemen gösteriyor.
- Eşitleme sunucusunda: bir cihazı kaldırmak ya da silmek oturumlarını sonlandırıyor; e-posta adresleri bir gizli anahtarla dizinleniyor; yarıda bırakılan bir oturum açma artık bir cihaz eklemiyor. Mevcut hesaplar bir sonraki oturum açışlarında kendiliğinden geçiş yapıyor.

### Sekmeler ve tuşlar
- Vex'in kendi kutularında (adres çubuğu, yapay zekâ, notlar) Ctrl+Shift+Z, sayfayı uyutmak yerine yineliyor.
- Ctrl+Tab sekmeleri gördüğünüz sırayla gezer ve daraltılmış grupları atlar.
- JavaScript'i kapalı bir siteden normal bir siteye geçen bir sekme Geri listesini koruyor.
- Göz at'ta bir çerez başlığı artık Escape'in onu kapatmasını engellemiyor.

### Ayrıca
- Ayarlar › Hakkında ham kod yerine "Widevine hazır (sürüm …)" diyor.
- Posta: yanlış bir bağlantı noktası 20 değil 8 saniyede bildiriliyor; Daha fazla yükle, 100 iletiden sonra da gelen kutusunun tamamına kadar sürüyor.
- Yapay zekâ artık sorunuzu iki kez almıyor; bulut yapay zekâsı birkaç sekme için, bir sekmedeki kadar tur hatırlıyor.
- Uzantılar açtıkları bir sekmeyi kapatabiliyor (chrome.tabs.remove).
- JavaScript'i kapalı sayfalar artık konsolu uyarılarla doldurmuyor.

## v11.68.1 (2026-09-30) — Tor, eşitleme, posta ve klavye, gerçekten sınandı

_v2.34.1 olarak yayımlandı._

Daha önce hiç sınanmamış kısımlar bu kez gerçekten sürüldü: Tor başlatıldı ve check.torproject.org'da denetlendi, eşitleme ve posta yerelde çalıştırılan gerçek sunuculara karşı, güncellemeler yerel bir güncelleme sunucusuna karşı sınandı ve her kısayol ve hareket gerçek klavye ve fare girdisi olarak gönderildi.

### Güvenlik
- **Electron 42.11** (castLabs, hâlâ Chromium 148), dört Electron güvenlik duyurusu için: korumalı bir sayfanın açtığı pencerelere korumalı alan bayraklarının geçirilmemesi, dosya ve HTTP işleyicileri üzerinden çapraz kaynaklı okumalar, bir webview'in web çalışanlarında Node ve zehirlenebilir bir ön yükleme kodu önbelleği.

### Gizlilik
- **Bir Tor sekmesinden yeni sekmede açılan bir bağlantı Tor'dan çıkıyordu** ve gerçek bağlantınız üzerinden yükleniyordu (target=_blank, orta tık, window.open). Artık sekmenin kendi oturumunda kalıyor; gizli, burner ve kapsayıcı sekmeleri de, ve böyle bir sekmeden "Seçimi ara" ve "Lens ile resim ara" da.
- **Tor üzerinden yönlendirilen bir burner kimliği ya da kapsayıcı gerçek adresinizi WebRTC üzerinden sızdırıyordu.** Artık bir Tor sekmesi gibi kilitli; bir Tor sayfasının açtığı pencere de öyle.
- Tor indirilirken İptal gerçekten iptal ediyor; eskiden Tor birkaç saniye sonra yine de başlıyordu.
- Bir site için JavaScript'i kapatmak artık zaten açık olan bir sekmenin içinde o siteye gittiğinizde de çalışıyor.

### Eşitleme
- **Zaten yer imleri ya da notları olan bir cihazda eşitlemeye katılmak onları siliyordu.** Artık korunuyor ve yükleniyor; hesabın zaten sahip olduğu her şey için hesabın kopyası geçerli oluyor. Notlar, yer imleri gibi tek tek birleşiyor.
- Başka bir cihaz önce eşitlediğinde Şimdi Eşitle artık "Push returned 409" ile başarısız olmuyor.
- Başarısız oturum açmalar artık cihaz listesinde fazladan cihaz bırakmıyor.
- Yanlış bir kurtarma kodu "OperationError" yerine bunu söylüyor.
- "eşitleme çakışmaları saklandı" iletisi artık her eşitlemede geri gelmiyor; aynı şeye yapılan iki düzenlemeden yenisi kazanıyor.
- "/" ile biten bir eşitleme sunucusu adresi çalışıyor; sunucunun oturumunu kapattığı bir cihaza bu söyleniyor.
- Cihazlarıma Gönder bir hatayı sözcüklerle açıklıyor; okunamayan tek bir öğe artık gerisini kaybettirmiyor.

### Posta
- Gelen kutusu ayıklaması artık kendi sunucunuzdan bir postayı Gmail'e göndermiyor, açık olan hesabı kullanıyor ve birkaç hesabınız olduğunda doğru Gmail hesabını açıyor.
- Kendi sertifikası olan yerel bir köprü (ProtonMail Bridge) eklenebiliyor; sertifika ve TLS sorunları sözcüklerle açıklanıyor; kurulum formunda bir Güvenlik seçeneği (TLS / STARTTLS) var.
- Uzun bir gelen kutusu en yeni 50 iletiyi gösterdiğini söylüyor ve daha fazlasını yükleyebiliyor.
- Bir e-postadaki telefon numarası artık doğrulama kodu sanılmıyor.

### Klavye ve fare
- **Bir metin kutusunda Yinele (Ctrl+Shift+Z) sekmeyi uyutuyor ve yazdıklarınızı kaybettiriyordu.** Bir metin kutusunun ya da düzenleyicinin kendi kullandığı tuşlar (yinele ve düzenleyicilerde kalın ve altı çizili) artık sayfada kalıyor. Yazdığınız metin olan bir sekmeyi uyutmak önce soruyor.
- Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+R ve Alt+Left/Right bir sayfa odaktayken çalışıyor; Ctrl+1–9 adres çubuğundan çalışıyor ve Ctrl+9 son sekmeye gidiyor.
- Orta tık, dikey listede gruplanmış bir sekmeyi kapatır.
- Güncelleme istemi artık indirme bildirimleri tarafından örtülmüyor ("Bunu atla" indirmenin Göster'ine tıklıyordu).

### Ayrıca
- Göz at: sitenin kendi açılır penceresini kapatan Escape artık Göz at'ı kapatmıyor; sayfa içindeki Ctrl+Enter onu sekme olarak açıyor.
- Gizli bir pencere, site başına anahtarları değiştikleri anda alıyor.
- Birkaç sekme hakkındaki sorular, yerel yapay zekâyla da konuşmayı hatırlıyor.
- chrome.tabs.create uzantıya açtığı sekmeyi veriyor.
- Bir yedeği geri yüklemek "Hatırlatıcılar eşitlendi" değil, "Hatırlatıcılar geri yüklendi" diyor; eşitlenen hatırlatıcılar saat değişikliğinde zamanlarını koruyor; uzantı güncellemeleri arkalarında boş klasör bırakmıyor.
- Güncelleme hataları kısa ve sade; Yeni Tor Sekmesi ipucu artık Tor'un çalışıyor olması gerektiğini söylemiyor; Ayarlar › Hakkında'daki Güncelleme kanalı satırı düzgün yerleştirildi.

## v11.50.6 (2026-09-30) — Popüler Discord temalarının ardından 28 yeni tema ve 5 yeni görünüm

_v2.34.0 olarak yayımlandı._

### Yeni
- **En popüler Discord temalarının ardından 28 renk teması** (BetterDiscord'un listesinden), renkleri her temanın kendi stil sayfasından alınmış olarak: ClearVision, Dark Matter, Dusk Plus, Dark Plus, Terminal Green, AMOLED, Record Green, Dark Neon, Deep Midnight, SoftX, Neutron, Nocturnal, Tokyo Night, Material, Android Beige, Kaleidoscope, Code Dark, Synthesis, Virtual Red, Paper Red, Noctis Viola, Wildberry, GX Red, Gruvbox, RosyNight, Azurite, Neptune ve EzLight. Hepsi iyi okunuyor (metin karşıtlığı denetlendi), Yeni Sekme sayfasını kapsıyor ve her görünümde çalışıyor; seçici her temanın neyden esinlendiğini söylüyor.
- Ayarlar › GUI Stili'nde ve kurulumda **beş yeni görünüm**: **Fluent** ve **Fluent koyu** (Windows 11: renk tonlu bir çerçeve, yuvarlak sekmeler, bulunduğunuz sekmenin altında vurgu hapı), **Glossy** (Aero dönemi cam ve parlamalar), **Neobrutal** (kalın çerçeveler, sert gölgeler) ve **Terminal** (tek aralıklı yazı, kutu kenarlıkları, `[ 1: title ]` olarak yazılan sekmeler). Her biri temanızın renklerini de alır.

### Düzeltildi
- **Vex'in kendi yazı tipleri yüklenmiyordu** (Outfit, JetBrains Mono, Space Grotesk, Fraunces, Spectral): yazı tipi seçicinin yazı tipi stil sayfasını yeniden yazması onları düşürmüştü; bu yüzden bunların her seçimi Windows'ta ne varsa ona düşüyordu.
- Firefox Light ve Firefox Dark Yeni Sekme sayfasına hiç ulaşmıyordu ve vex://start üzerinden ona yalnızca ilk sekiz tema ulaşıyordu.
- Vencord'u güncellemek artık ayarlarını kaybettirmiyor; güvenli modda bir uzantı yüklemek ya da güncellemek normal bir yeniden başlatmayı bekliyor.
- Uzantı açılır pencereleri, küçük olanlar dahil, tam olarak boyutlandırılıyor (Stylus'unki Chrome'daki gibi 246×117).
- Gizli bir pencere, normal pencerede sonradan değiştirilen site başına anahtarı birkaç saniye içinde alıyor.
- İzin istemleri sıralarını bekliyor, ikincisi birincisini kaldırmıyor; iki dakika sonra süresi dolan istem kayboluyor ve bunu söylüyor.
- Bir Göz at ya da Duyarlı Önizleme sayfasının içinde Escape, sayfa Escape'i kendisi kullanmıyorsa onu kapatıyor.
- Geçmişi Temizle, sekme listenizin yedek kopyasını da temizliyor.
- Ana Ses, sayfa sesi ve Gece modu, sonradan yüklenen bir çerçevedeki oynatıcıya ulaşıyor; Gece modu artık zaten yönettiği oynatıcıları yeniden yönlendirmiyor.
- Bir kişilik açıkken Sekmeleri Grupla ve birkaç sekme hakkındaki sorular kendi yönergelerini koruyor; geçmiş araması ve ajan görevleri bulunduğunuz sekmenin sohbetine gidiyor ve bir geçmiş aramasının yanıtı sohbetle birlikte saklanıyor.
- Kısayol düzenleyici, Vex'in kendisinin yanıtladığı tuşları (Ctrl+T, Ctrl+W, Ctrl+K) ne kadar beklerseniz bekleyin kaydedebiliyor.
- Dikey sekme listesindeki grup okları doğru yöne bakıyor ve ana hatlarıyla çiziliyor; grup çipleri Oxford ile koyu görünümlerde okunabiliyor.

## v11.45.6 (2026-09-29) — İndirme denetimi her kabuktan çalışıyor

_v2.33.15 olarak yayımlandı._

Yayımlanmayan v2.33.14'teki her şeyi içerir.

### Düzeltildi
- **"Bu indirme imzalı mı?" yalnızca Vex bir PowerShell 7 penceresinden başlatıldığında "bilinmiyor" diyebiliyordu.** İmzayı okuyan Windows PowerShell, Vex'ten PowerShell 7'nin modül listesini devralıyor ve imzaları okuyan bölümü yükleyemiyordu. Denetim artık onu kendi listesiyle başlatıyor. Bu şekilde çalışan derleme sunucusu tarafından bulundu.

## v11.45.1 (2026-09-29) — Her özelliğin iki taraması: yaklaşık iki yüz düzeltme

_v2.33.14 olarak yayımlandı._

Yedi test kullanıcısı Vex'in her bölümünü bir insanın yaptığı gibi kullandı: sekmeler ve görünümler, paneller, adres ve komut çubukları ile Araç Kutusu, sayfa araçları ve medya, gizlilik ve verileriniz, yapay zekâ, ve uzantılar ile hizmet panelleri. Aşağıdaki her düzeltme denetlendi ve çoğu ayrıca çalışan bir Vex'te çalışırken görüldü.

### Güvenlik ve gizlilik
- **İndirilen bir dosyanın adı komut çalıştırabiliyordu**: dosyayı açtığınızda ve Vex imzasını denetlediğinde ad bir PowerShell komutuna giriyordu ve adı bir web sitesi seçer. Artık yalnızca veri olarak geçiriliyor.
- **Vex'i Kilitle'nin etrafından dolaşılabiliyordu.** Gizli bir pencere (Ctrl+Alt+N) kilitsiz açılıyor ve kayıtlı parolaları okuyabiliyordu, Tab kilit ekranının arkasındaki düğmelere ulaşıyordu, Ctrl+H arkasında Geçmiş'i açıyordu ve yeniden başlatma Vex'in kilidini açıyordu. Kilitliyken kilit ekranının arkasındaki hiçbir şeye ulaşılamıyor, hiçbir kısayol çalışmıyor, parola kasası ve yeni gizli pencereler reddediyor ve Vex yeniden başlatmadan sonra yine kilitli başlıyor.
- **Gizli bir pencere açmak her site başına kuralı siliyordu** ve her pencere için **reklam engelleyiciyi yeniden açıyordu**. Artık hiçbiri olmuyor.
- Gizli bir pencerede "Bu ziyarete izin ver", sitenin normal pencerenizde de izinli olmasını sağlıyordu. Artık her pencerenin ziyareti kendine ait.
- Geçmişi Temizle, komut çubuğunun geçmişinde ve Recall'ın tam metin aramasında her ziyareti bırakıyordu. Artık ikisi de temizleniyor.
- Yedekler, ekran dahil olduklarını söylese de notlarınızı, okuma listenizi, yapay zekâ konuşmalarınızı, vurgularınızı ve ana ayarlarınızı dışarıda bırakıyordu. Artık yedekte yer alıyorlar.
- Geri Yükle onayı yedekleme ekranının arkasında açılıyor, bu yüzden bir geri yükleme bitirilemiyordu. Vex'in iletişim kutuları artık her zaman en üstte.
- Tor istenen bir burner kimliği, Tor başarısız olduğunda Tor'suz açılıyordu. Artık duruyor ve nedenini söylüyor. Tor yolu ayrıca kaydediliyor ve her açılışta Tor'u başlatıyordu.
- "hello" biçiminde bir proxy kapsayıcı yönlendirmesi tarafından kabul ediliyor ve çalışıyor olarak bildiriliyordu. Adres artık denetleniyor.
- Bir sitede parolayı değiştirmek yeni parolayı kaydetmeyi hiç önermiyordu. Artık öneriyor.

### Tuşlar ve adres çubuğu
- **Vex Ctrl+B, Ctrl+H, Ctrl+M ve Ctrl+Shift+Z'yi sayfalardan alıyordu**: bir düzenleyicide kalın, sekme kenar çubuğunu gizliyor ve yinele sekmeyi uyutuyordu. Chrome'daki gibi, sayfa artık bu tuşları önce duyuyor ve Vex yalnızca sayfa onları kullanmadığında harekete geçiyor. Discord'da Ctrl+Shift+M sizi yine susturuyor.
- Bir kısayol düz bir harfe ayarlanabiliyordu ve bu harf artık hiçbir sayfada yazılamıyordu. Bir kısayol Ctrl, Alt ya da bir işlev tuşu gerektiriyor ve kopyala, yapıştır, geri al ve geliştirici araçları tuşları reddediliyor.
- **Seçtiğiniz arama motoru yok sayılıyordu**: Bing, Startpage ve Ecosia hepsi Google'da arıyordu. Adres çubuğu, komut çubuğu ve seçili metindeki "… için ara" artık motorunuzu kullanıyor ve Ayarlar altısını da listeliyor.
- localhost, 192.168.1.1, [::1]:3000, my-server:3000, about:blank ve file:// adresleri açılmak yerine aranıyordu ve "node.js tutorial" bozuk bir adres açıyordu. İkisi de artık doğru.
- Komut çubuğundaki "Git", adresi küçük harfe çeviriyor ve bu YouTube'unkiler gibi bağlantıları bozuyordu.
- **Yazdır ve Sayfa Kaynağını Görüntüle**, sayfanın sağ tık menüsünde ve komut çubuğunda, Ctrl+P ve Ctrl+U ile birlikte. Vex'te ikisi de daha önce yoktu.
- Ctrl+K'de bir komutun tam adını yazmak bazen başka bir şeyi çalıştırıyordu. Adını verdiğiniz komut artık önce geliyor.
- "bana 10 dakikalık bir zamanlayıcı yap" gibi düz cümleler Ctrl+K'de yine çalışıyor.
- "Sekmeyi Çoğalt" (komut çubuğu, sayfa menüsü, fare hareketi) kopyalamak yerine asıl sekmeye geçiyordu. Yeniden açma hareketi hiçbir şey yapmıyordu. "Sekmeyi Uyut" ve Ctrl+Shift+Z hiçbir şeyi uyutmuyordu; artık sizi sonraki sekmeye geçirip onu uyutuyorlar.

### Sekmeler ve görünümler
- Sabitlenmiş sekmeler Firefox, Chrome ve diğer tarayıcı görünümlerinde tam genişlikte çiziliyordu. Artık simge boyutunda.
- Çok sekme varken bulunduğunuz sekme üstteki şeritte ekran dışında kalabiliyordu. Artık görünüme kaydırılıyor.
- **Firefox ve Chrome görünümlerinde, vurgu metninin soluk vurgunun üzerinde durduğu her yerde metin görünmezdi**: etkin Notlar bölümü, Zamanlamalar'ın "Etkin" sekmesi, görev anahtarları ve daha fazlası.
- Bölünmüş ekranda gösterilen sekmeler gizliymiş gibi uyutuluyordu.
- "Sağdaki Sekmeleri Kapat", gördüğünüz değil, dahili bir sıraya göre çalışıyordu.
- Sekmeler, Kitaplık'ta otomatik arşivleme kapalı olsa bile bir hafta sonra arşivleniyordu.
- Ertelenmiş sekmeler Kitaplık'ta listeleniyor ve birini erken uyandırabiliyorsunuz. Elle yeniden açılan biri artık iki kez geri gelmiyor.
- Çalışma alanları yeniden adlandırılabiliyor ve silinebiliyor (çalışma alanı listesindeki kalem ya da sağ tık) ve silmek önce soruyor.
- Bir oturumu geri yüklemek, çalışma alanları gibi yalnızca bulunduğunuz sekmeyi yüklüyor.
- Bildirimler artık menü öğelerini örtmüyor ve tıklamayı yutmuyor.
- Escape; grup renk seçicisini, uyanık tutma seçicisini, Sekme Sağlığı'nı, çalışma alanı listesini, düzen düzenleyicisini, ekran görüntüsü önizlemesini ve düzenleyicisini, Geliştirici panosunu, Telefona Gönder'i, "Vex neden yavaş"ı ve Kurulum Galerisi'ni kapatıyor.

### Paneller
- **Vex'i kapatmadan hemen önce yazılan metin kayboluyordu**: Notlar'dan ve yapışkan notlardan.
- Hızlı yakalama, not kaydedilmiş olsa da hep "Vex yanıt vermedi" ile bitiyordu.
- Bir dakika ya da daha uzun Saat zamanlayıcıları bir dakikaya kadar erken çalıyordu ve bir dakikalık zamanlayıcı hata gösteriyordu. "1 dakika içinde" bir hatırlatıcı zamanı olarak reddediliyordu. Site hatırlatıcıları "1 Oca 02:00" gösteriyordu.
- Dünya saati kaldırdığınız şehirleri geri getiriyor ve zaman kaydırıcısını geri alıyordu.
- Bir Odak oturumunu durdurmak, Toplantı modunun hatırlatıcılar üzerindeki tutuşunu iptal ediyordu.
- Otomasyonlar bir sekmeye her geri döndüğünüzde yeniden çalışıyor, var olmayan bir komut için başarı bildiriyor ve "8:30" olarak yazılmış bir zamanla hiç eşleşmiyordu.
- Abone olunan takvimler uzun süren günlük etkinlikleri düşürüyor ve ayın 31'indeki aylık etkinlikleri yanlış günlere taşıyordu.
- "Sonra Oku'yu Podcast Olarak Oynat" hiçbir şey okumuyordu. Bir notta bir görevi işaretlemek bir kod bloğunun içindeki bir satırı işaretleyebiliyordu. Akışlardaki göreli bağlantılar bozuktu. Toplantı modu artık notunu açıyor. Ekran dışına kaydedilen bir yapışkan not ekrana geri geliyor.

### Sayfa araçları ve medya
- **Ana Sesi açmak her videoyu tam sese kilitliyor**, sitenin kendi kaydırıcısını geçersiz kılıyordu. Gece modu ve Ana Ses artık birlikte açık olabiliyor.
- Okuma modunun "Okuma Modundan Çık" düğmesi hiçbir şey yapmıyordu; iki kez çalıştırmak özgün sayfayı kaybettiriyordu; paragraflardaki kod tekrarlanıyordu.
- İşaretle metin aracının kutusuna yazı yazılamıyordu. Uzun tam sayfa ekran görüntüleri not almak için çok küçüktü.
- Duyarlı Önizleme bir hatayla başarısız oluyordu. Alıntılar bir kuruluşun adını baş harflere bölüyordu. Medya yakalayıcı yanlış dosya boyutu gösteriyordu. Kaydedilen bir PDF "dummy.pdf.pdf" olarak adlandırılıyordu.
- Bir videoya ya da sese sağ tıklamak artık Oynat/Duraklat, Döngü, denetimler, Pencere İçinde Pencere ve adresini sunuyor.
- Hesap makinesi: "5000 lbs to ton" çalışıyor, kopyalanan sonuç gösterilenle eşleşiyor ve kelvinde derece işareti yok. Base64 dolgulu girdiyi çözüyor.

### Yapay zekâ
- **Bir onay kartı açıkken Durdur**, görevi sonsuza kadar çalışır bırakıyordu ve sonradan Onayla, durdurulan eylemi yine yerine getiriyordu.
- Bir sohbet yanıtı durdurulamıyordu ve "dur" yazmak bir soru olarak yanıtlanıyordu. Yanıtlarken artık bir Durdur düğmesi var.
- Yerel modelde Çevir seçtiğiniz dili yok sayıyor, birkaç sekme hakkındaki sorular sekmeleri yok sayıyor, Sekme Komutu hep "Yapılacak bir şey yok" diyor ve İki Model sayfa olmadan yanıtlayıp bir şeyler uyduruyordu.
- Özetler, çeviriler ve açıklamalar panel yeniden çizildiğinde sohbetten kayboluyordu. Yeniden dene soruyu iki kez soruyordu. Kodla başlayan bir yanıt biçimlendirmesini kaybediyordu. "/agent" ve "/chat" bir yardım kartıyla geçersiz kılınıyordu.
- Eklenmiş bir dosya Yeni sohbet boyunca ve diğer her sekmede ekli kalıyordu. Hatırlanan olgular, dosyalı uzun sohbetlerden düşürülüyordu.
- Beni Yetiştir ve sabah özeti ham JSON gösteriyordu. Öğretme modu açılır listeleri yazma olarak kaydediyordu. Modelin çoğu grafik kartındayken "işlemcide çalışıyor" uyarısı gösteriliyordu.

### Uzantılar ve hizmetler
- **Stylus'un arka planı Vex onu Açık gösterirken başlangıçta duruyordu** ve açılır pencereler ile seçenek sayfaları, Electron'da olmayan Chrome parçaları için Vex'in yerine koyduklarından hiçbirini almıyordu. Artık hepsi alıyor; Stylus başlıyor ve açılır penceresi çalışıyor.
- Violentmonkey çalışmıyor olarak işaretlendi: Electron'da olmayan iki Chrome parçasına ihtiyaç duyuyor, bu yüzden hiçbir betik çalışamıyor.
- Ayarlar › Uzantılar'dan açılan bir açılır pencere kendini sayfa sanıyordu. Bazı açılır pencereler kırpılmış açılıyordu.
- Her uzantı sayfası, PiP oynatıcısı ve file:// sayfaları reklam engelleyiciden ve geçmişten hata çıkarıyordu.
- Güvenli mod hiçbir uzantı listelemiyordu, bu yüzden açılışı bozan kaldırılamıyordu. Artık "yüklenmedi" işaretiyle listeliyor.
- GitHub paneli ad değişikliğinden sonra önceki kullanıcıyı, bilinmeyen bir kullanıcı ya da çevrimdışıyken sonsuza kadar "Yükleniyor…" gösteriyordu.
- Yer paylaşımı penceresi fareyle taşınabiliyor ve kapatılabiliyor.

### İkinci geçiş: her alan yeniden ve yukarıdaki her düzeltme yeniden denetlendi
Yedi alan, düzeltmelerin üstünde ikinci kez, kaynakta ve yüklü uygulamada sınandı ve yukarıdaki her düzeltme yeniden kanıtlandı. Yaklaşık doksan tane daha bulunup düzeltildi:

- **Bir web sayfası uydurma olaylarla Vex'in tuşlarına basabiliyor ve fare hareketlerini çizebiliyordu**, arka plandaki bir sekmeden bile sekmeleri kapatıp panelleri açıyordu. Artık yalnızca kendi klavyeniz ve fareniz sayılıyor ve bir hareket yalnızca öndeki sekmeye etki ediyor.
- **Vex'in kendi penceresi odaktayken Ctrl+Alt kısayolları Ctrl olanı da yapıyordu**: Ctrl+Alt+W (Sayfayı izle) sekmeyi kapatıyor, Ctrl+Alt+T bir tane açıyor, Ctrl+Alt+M sessize alıyordu.
- **Sayfanın sağ tık alt menülerine ulaşılamıyordu** (Sayfa, Bu site, "Bu video/bağlantı/resim/metin için daha fazlası"); bu yüzden Yazdır, Sayfa Kaynağını Görüntüle ve video satırlarına ulaşılamıyordu. Video satırları artık çerçevelerdeki ve gölge köklerindeki videolar için de çalışıyor ve reddedilen bir Oynat nedenini söylüyor.
- **Pencere düğmeleri**, varsayılan görünümde yaklaşık 1130 piksel genişliğin altında, yarım ekran bir pencere dahil, ekran dışındaydı.
- **Bir uzantıyı güncellemek ayarlarını siliyordu**: her güncelleme yeni bir klasöre yükleniyor ve bu ona yeni bir kimlik veriyordu. Güncellemeler artık eski kopyanın yerine geçiyor. Stylus'un açılır penceresi çalışıyor, açılır pencereler tam boyutlandırılıyor, içlerindeki bağlantılar ve düğmeler sekme açıyor ve bir kapsayıcı sekmesinin üzerindeki açılır pencere sayfayı biliyor.
- **Vex'i Kilitle**: kilitlemeden önce açık olan pencereler siz kilidi açana kadar gizli, 2FA kodları kilitliyken reddediyor, gizli bir pencereden gelen tuşlar yalnızca o pencereye etki ediyor ve yanlış PIN bekleme süresi yeniden başlatmadan sonra da sürüyor. Kilit PIN'inin özeti yedeklerin dışında bırakılıyor.
- **Gizli pencereler**: site başına anahtarlar (JavaScript, çerezler, diğer sitelerden içerik) artık orada geçerli; reklam engelleyici anahtarı birinden değiştirilemiyor; Çalışma Alanı Değiştir artık sekmelerini yok etmiyor; Ertele ve Oturumu Kaydet, rol yapmak yerine orada çalışamayacaklarını söylüyor.
- **Otomatik doldurma** temizlediğiniz alanları yeniden doldurup duruyordu, bu yüzden başka bir hesap yazılamıyordu. Geçmişi Temizle ayrıca yakın zamanda kapatılanlar listesini ve geçmişin yedek kopyalarını siliyor.
- **Her yerde seçtiğiniz arama motoru** (Ayarlar, kurulum, Yeni Sekme sayfası) her yerde aynı anda kullanılıyor ve Yeni Sekme sayfası adres çubuğuyla aynı adres kurallarını izliyor. Herhangi bir betikteki adresler (münchen.de), Windows yolları ve C:\ dosyaları açılıyor; "readme.md" ve "node.js" aranıyor. Başarısız bir adres boş sayfa yerine nedenini söylüyor.
- **Bir yedeği geri yüklemek, istediği yeniden başlatmada çalışma alanlarını kaybediyordu** ve Yeniden Başlat artık önce her şeyi kaydediyor.
- **Zamanlamalarda "her 30 dakikada" saatlik çalışıyordu**; başka bir saat dilimindeki takvim etkinlikleri yılın yarısında bir saat kaymış oluyordu; günlük hatırlatıcılar saat değişikliğinden sonra bir saat kayıyordu; + ya da • işaretli onay kutuları yanlış görevi işaretliyordu.
- **Yapay zekâ**: içinde sıradan bir "for" geçen sorular ("akşam yemeği için fikirler") yanıt yerine bir yardım kartı alıyordu; Durdur dönen bir balon bırakıyordu; ajanı durdurup yeniden başlatmak yeni çalıştırmayı bozuyordu; Yeniden dene yanıtını en alta koyuyordu; sohbetler yeniden başlatmadan sonra saatlerini kaybediyor ve en yeniler önce siliniyordu; yeni yanıtlar yeniden çizilene kadar Yeniden dene'ye sahip değildi; özel bir kişilik "{}" yanıtlıyordu; Yeniden Biçimlendir bir reddi CSS olarak kaydediyordu.
- **Ana Ses ve site başına ses** artık birlikte çalışıyor ve çerçevelerdeki oynatıcılara ulaşıyor; Gece modu herhangi bir sayfada kapatılabiliyor.
- **Escape, Vex'teki her pencereyi ve sayfayı kapatıyor**, bir sayfanın içinden açıldığında da; metin karakterleri olarak çizilen simgeler (✕ ✓ ✎ ⟳ ▲ ▼) her yerde Vex'in simgeleri.

Tüm test paketi (derleme sunucusundaki gibi Node 22), lint, tür ve kaynak denetimleri, her iki başlangıç denetimi ve her alan için kaynakta ve yeni derlenmiş yüklü bir uygulamada Vex'in canlı çalıştırmaları, varsayılan ve Firefox görünümlerinde hatasız 25 kenar çubuğu panelinin tamamı dahil, ile denetlendi.

## v11.15.1 (2026-09-29) — Uzantı açılır pencereleri açılıyor ve hangi sayfada olduğunuzu biliyor

_v2.33.13 olarak yayımlandı._

### Düzeltildi
- **Dark Reader'ın açılır penceresi "Yükleniyor, lütfen bekleyin"de kalıyordu.** Onu doldurmak için Dark Reader arka planından ayarlarını istiyor ve arka plan ayrıca uzantının klavye kısayollarına ve yerel dosyaları okuyup okuyamayacağına bakıyor. Electron'da bunların ikisi de yok, bu yüzden arama başarısız oluyor ve açılır pencere hiç yanıt almıyordu. Vex artık ikisini de dürüstçe yanıtlıyor: Vex'te uzantı kısayolları için tuş atanmamış ve yerel dosyalara izin var, çünkü Vex uzantıları böyle yükler.
- **Bir uzantının açılır penceresi kendisini bulunduğunuz sayfa sanıyordu.** Electron, klavye odağı hangi sayfadaysa onu geçerli sekme sayıyor ve bir açılır pencere açılırken odağı alıyor. Dark Reader "Bu sayfa tarayıcı tarafından korunuyor" diyordu ve sitenin anahtarı açılır pencereye etki edecekti. Vex artık uzantıya açılır pencerenin hangi sekmenin üzerinde açıldığını söylüyor. Yalnızca o uzantıya ve yalnızca açılır penceresi açıkken söylüyor.
- **Açılır pencereler kaydırma çubuklarıyla çok küçük açılıyordu.** Vex bir açılır pencereyi, hâlâ yüklenirken bir kez boyutlandırıyordu. Artık açılır pencerenin içeriği değiştiğinde, Chrome'un 800×600 sınırına kadar, sığacak şekilde yeniden boyutlanıyor.

Bu aynı zamanda Dark Reader'ın siyaha çevirdiği bir Google Doc'u düzeltmenin de yolu: Doc'ta uzantılar menüsünden Dark Reader'ı açın ve orada kapatmak için sitenin adına tıklayın.

Dark Reader ile canlı bir Vex'te denetlendi: açılır pencere kaydırma çubukları olmadan eksiksiz açılıyor ve altındaki sayfayı adlandırıyor. Site anahtarı Wikipedia'yı koyudan normal açık görünümüne geri getirdi.

## v11.14.1 (2026-09-28) — Pencere ekranda kalıyor

_v2.33.12 olarak yayımlandı._

### Düzeltildi
- **Tam ekrandan sonra pencere ekrandan taşıyordu.** Tam ekrandan çıkmak (F11 ya da bir videonun tam ekran düğmesi) pencereyi tüm ekran boyutunda ve artık ekranı kaplamayan durumda bırakıyordu: sağ kenardan ve görev çubuğunun altına taşıyordu ve bir dokunuş onu daha da dışarı itiyordu. Vex'in penceresi saydam ve çerçevesiz (cam görünüm için) ve Electron böyle pencereleri güvenilir biçimde geri koymuyor. Vex artık pencerenin nerede olduğunu ve ekranı kaplayıp kaplamadığını hatırlıyor ve tam ekran bittiğinde onu oraya, her zaman ekranın içinde, döndürüyor.
- **Ekranı kapla düğmesi küçültmüyordu.** Aynı türden pencerede ekranı kaplamak ekranı dolduruyor ama ne Electron ne de Windows onu ekranı kaplamış olarak bildiriyor, bu yüzden her basış yine ekranı kaplıyordu. Düğme artık pencereyi önceki boyut ve yerine döndürüyor.

Gerçek pencereyi Windows üzerinden ölçerek denetlendi: ekranı kapla ekranı görev çubuğunun üstünde dolduruyor, ikinci basış 1400×900'e eskisi gibi dönüyor ve tam ekrana girip çıkmak, ekranı kaplamış ya da değil, onu tam olarak eskisi gibi döndürüyor.

## v11.11.6 (2026-09-28) — "VirusTotal'da denetle" hiç görmediği bir dosyayı açıklıyor

_v2.33.11 olarak yayımlandı._

### Düzeltildi
- **"VirusTotal'da denetle" "Öğe bulunamadı"ya düşebiliyor ve bozuk görünüyordu.** Vex bir indirmeyi VirusTotal'da parmak iziyle arıyor ve VirusTotal'ın yalnızca birinin daha önce gönderdiği dosya için raporu var. Yeni ya da nadir bir dosyanın, örneğin bir saat önce yayımlanmış bir programın, raporu yok. Parmak izi doğruydu (dosyayla denetlendi); VirusTotal onu sadece hiç görmemişti. Vex artık o sayfanın ne anlama geldiğini söylüyor ve dosyanın klasörünü açıyor; böylece taramak için onu virustotal.com'a sürükleyebilirsiniz. Vex, VirusTotal'ın hangi dosyaları bildiğini önceden söyleyemez, çünkü bunu sormak bir API anahtarı gerektirir.

## v11.11.3 (2026-09-28) — Vex bir insan gibi kullanılarak bulunan altı gündelik takılma

_v2.33.10 olarak yayımlandı._

Vex bir insanın kullandığı gibi, gerçek tıklamalar, yazma ve tuş basışlarıyla, beş gündelik rutin boyunca sürüldü: gezinme; sekmeleri fareyle yönetme; yan paneller; ayarları değiştirme ve yeniden başlatma; ve bağlantılar, video, bir indirme, komut çubuğu ve yapay zekâ. 39 adımın 37'si ilk seferde ya da aşağıdaki düzeltmelerden sonra çalıştı. Diğer ikisi testin basamadığı kısayollar (sona bakın).

### Düzeltildi
- **Bir indirmeden sonraki ilk tıklama hiçbir şey yapmıyordu.** Bir indirme bittiğinde küçük listesi, sayfaya tıklamanın onu kapatması için tüm pencerenin üzerinde görünmez bir katmanla birlikte araç çubuğunun altında açılıyordu. Herhangi bir yerdeki, yapay zekâ düğmesine, bir sekmeye ya da komut çubuğuna sonraki tıklama yalnızca listeyi kapatıyordu. Katman sayfadaki tıklamalar için kalıyor, ama Vex'in kendi düğmelerinden birine tıklamak artık o düğmeye de geçiyor.
- **Bölünmüş Ekranı Escape ile iptal etmek görünmez bir duvar bırakıyordu.** "Bir sekme seç" seçicisi tüm pencerenin üzerinde bir katman olarak ekranda kalıyor ve sonraki tıklamayı yutuyordu. Escape artık onu iptal ediyor ve bölünmüş ekranı kapatmak da onu kapatıyor.
- **Sekme menüsü pencerenin altından taşıyordu.** Yaklaşık yirmi öğesi var ve kısa bir pencerede "Diğerlerini Kapat" ve "Sağdaki Sekmeleri Kapat"a ulaşılamıyordu. Artık kaydırılıyor, aynı şekilde yapılan diğer menüler de, sayfanın sağ tık menüsü dahil.
- **Bir sekmedeki hoparlör onu susturmuyordu**, üstteki sekme şeridinde (Firefox ve Chrome görünümleri); yalnızca sekmeye geçiyordu. Artık dikey sekmelerdeki ve diğer her tarayıcıdaki gibi susturuyor ve sesi açıyor. Shift ile sekmenin hangi hoparlörlerden çalacağını seçiyor.
- **Komut çubuğundaki "Bölün", sekizinci olan Bölünmüş Ekran'ın üstünde, "Mors Kodu" dahil altı araç kutusu aracını listeliyordu.** Vex'in komutları ve araç kutusunun araçları artık birlikte, en iyi eşleşme önce olacak şekilde sıralanıyor ve gevşek bir eşleşme "Ara"dan sonra geliyor.
- **Biten bir indirmenin kartı yapay zekâ panelinin ileti kutusunu örtüyordu**, ikisi de sağ alt köşede. Kart artık panel açıkken onun yanına geçiyor.

### Denetlendi ve çalışıyor
Bir adres yazmak; yazarken öneriler; bağlantılara tıklamak; Geri, İleri ve Yenile; sayıyla sayfada bul; Ctrl+D ile yer imi eklemek; bir sekmeyi kapatıp geri getirmek; Ctrl+tık ile bir bağlantıyı arka plan sekmesinde açmak; araç çubuğundan ve bir sayfanın içinden Ctrl+Tab ve Ctrl+1. Sabitleme, susturma, çoğaltma, gruplama, bir grubu daraltma, uyutma, orta tıkla kapatma ve bir sekmeyi yeni bir yere sürükleme. Geçmiş ve yer imi araması, bir not yazmak, çalan bir zamanlayıcı ve İndirmeler, Bellek ve Ayarlar panelleri. Ayarlar, açık sekmeler, sabitlenmiş bir sekme ve bir grup Vex'i X'iyle kapatıp yeniden açmaktan sağ çıkıyor ve yeni bir arama motoru hemen kullanılıyor. Sağ tıklanan bir bağlantı yeni sekmede açılıyor, bir video oynuyor, bir indirme İndirmeler'e iniyor ve yapay zekâ yanıtlıyor.

### Sınanamadı
Ctrl+=, Ctrl+- ve Ctrl+K pencereye ulaşmadan yakalanıyor, orada test tuş gönderemiyor. Her biri elle bir kez basmaya değer.

## v11.8.8 (2026-09-28) — Yeni Sekme sayfası kendi renklerini koruyor

_v2.33.9 olarak yayımlandı._

### Düzeltildi
- **Dark Reader yüklüyken Yeni Sekme sayfası düz griye dönüyordu.** Dark Reader Vex'te çalışmaya başlayınca (v2.33.2), web sitelerinde yaptığı gibi Vex'in kendi Yeni Sekme sayfasını da Vex'in temasının üzerine yeniden renklendiriyordu: sayfa yerel bir dosya ve uzantılar yerel dosyaları okuyabilir. Vex'in kendi sayfaları artık Dark Reader'ın bir sayfayı rahat bırakmak için saydığı etiketi taşıyor, Chrome'un uzantıları kendi sayfalarından uzak tutması gibi. Web siteleri eskisi gibi koyulaştırılmaya devam ediyor.

## v11.7.8 (2026-09-28) — PDF'ler sekmede açılıyor

_v2.33.8 olarak yayımlandı._

### Düzeltildi
- **Bir PDF boş sayfa olarak açılıyordu.** Chromium'un PDF görüntüleyicisi bir eklentidir ve yalnızca eklentilerin açık olduğu yerde çalışır; Vex sekmelerini onlarsız kuruyordu. Sekmeler artık onlara sahip, bu yüzden bir PDF sekmede görüntüleyicinin kendi araç çubuğuyla (yakınlaştırma, yazdırma, indirme) görünüyor. Bununla başka hiçbir şey etkinleşmiyor: PDF görüntüleyicisi Electron'un sahip olduğu tek eklenti.

### Denetlendi
Yüklü uygulamanın (kaynağın değil, paketlenmiş derlemenin) yapay zekâsız yeni bir profilde taraması: başlıyor ve yeniden başlatmadan sağ çıkıyor; web sayfaları, sayfada bul (çubuğun sayısı da), okuyucu modu, yan yana çeviri, bölünmüş görünüm, yer imleri, geçmiş, notlar, çalan bir zamanlayıcı, oyun modu açık ve kapalı, gizli ve Tor sekmeleri, bir sekmeyi uyutmak ve uyandırmak, kapatılan bir sekmeyi yeniden açmak, komut çubuğu, sağ tık menüsü, bellek paneli ve çalışan görevler, her Ayarlar bölümü, tüm 37 tema ve 9 görünüm ve Discord, Spotify ve WhatsApp panellerinin hepsi çalıştı, pencerede hata yok. Yirmi bir açık sekme 3,2 GB kullandı; arka plandakileri uyutmak bunu 661 MB'a indirdi.

## v11.4.1 (2026-09-28) — v2.33.6, denetimleri Windows'ta geçerek

_v2.33.7 olarak yayımlandı._

### Düzeltildi
- **v2.33.6'nın kendi denetimi Windows derleme makinesinde başarısız oldu.** Bir test, uzantı "sync" yerine koyucusunun iki kopyasını karşılaştırıyor ve bir Windows çıkışı bir dosyaya CRLF satır sonları verip diğerine vermedi. Artık satır sonlarına bakmadan karşılaştırıyor. Uygulamada hiçbir şey değişmedi.

## v11.4.0 (2026-09-28) — Return YouTube Dislike oyları kaydediyor ve ajan en iyi modelinizi alıyor

_v2.33.6 olarak yayımlandı._

### Düzeltildi
- **Return YouTube Dislike bir oyu kaydedemiyordu** ve arka planı bir hizmet çalışanı olan diğer uzantılar ayarlarını kaydedemiyordu. Onların "sync" depolaması orada başarısız oluyordu ve Vex'in yerine koyucusu yalnızca uzantı sayfalarına ulaşıyordu. Hizmet çalışanları artık kendi ön yüklemesinden onu alıyor ve sayfalar ile çalışanlar onu uzantının kendi depolamasında tek yerde tutuyor; böylece birinin kaydettiğini öteki okuyor. Canlı denetlendi: Return YouTube Dislike kaydoluyor ve tüm ayarlarını hatasız kaydediyor ve Dark Reader sayfaları yine temalandırıyor. Önceki yerine koyucunun kaydettiği ayarlar (v2.33.2'den v2.33.5'e) bir kez taşınıyor.
- **Model seçilmediğinde ajan, elinizde olsa da olmasa da llama3.2:3b ile çalışıyordu** ve bu kadar küçük bir model eylem için güvenli değildi: bir testte bir gönderiyi beğenmesi istendiğinde on tanesini beğendi. Artık araç çağırabilen, 14B'ye kadar, yüklü en iyi modelinizi kullanıyor (bu makinede qwen3.5). Ayarlar › Yapay zekâ'da bir model seçmek her zaman önceliklidir.

## v11.3.0 (2026-09-28) — Sağ tık öğeleri ekleyen eklentiler artık başlıyor

_v2.33.5 olarak yayımlandı._

### Düzeltildi
- **Sağ tık menüsüne öğe ekleyen bir eklenti başlarken duruyordu.** Electron eklentilere bağlam menüsü API’si vermiyor ve uBlock Origin bunu başlarken okuyup yarı yolda hata veriyordu. Bunu isteyen eklentilere artık başarılı olan ama hiçbir şey eklemeyen çağrılar veriliyor; Vex’in sağ tık menüsünde eklenti öğesi yoktur. Kurulu on bir eklentinin hepsinde denetlendi: her biri yükleniyor, Dark Reader Wikipedia’yı, Hacker News’i ve BBC News’i düzgünce koyulaştırıyor (zaten koyu olan GitHub’a dokunmuyor) ve komut çubuğu hesap makinesi gerçek pencerede “12*7”, “2^10” ve “20 cm to in” sorularını yanıtlıyor.

### Bilinenler
- **Return YouTube Dislike oylarınızı kaydedemiyor.** Arka planı bir service worker olarak çalışıyor; orada Electron’un “sync” depolaması hâlâ başarısız oluyor ve Vex’in yerine koyduğu çözüm yalnızca eklenti sayfalarına ulaşıyor. Beğenmeme sayılarını görmek etkilenmiyor.
- **uBlock Origin başka bir eksik API’de (`webNavigation`) hâlâ duruyor.** Zaten Vex’te istekleri engelleyemiyordu; bunu Vex’in kendi reklam ve izleyici engelleyicisi yapar (Ayarlar › Gizlilik).

## v11.0.5 (2026-09-28) — Ajan, ikinci tur: sekmeler, ayarlar ve dürüst yanıtlar

_v2.33.4 olarak yayımlandı._

qwen3.5 üzerinde sekiz görevden oluşan ikinci tur: iki açık mağazayı karşılaştırma (geçti), yalnızca resim olan bir grafiği okuma (geçti, ona bakarak), üç sayfaya yayılmış bir tabloda tek bir siparişi bulma (geçti), bir Vex zamanlayıcısı başlatma (geçti), en ucuz üç ürünü bir nota yazma (model onları yanlış sıraladı), biri hariç tüm sekmeleri kapatma, belirsiz bir “toplantı odası ayırt” ve akış modunu açma. Son üçü Vex’te hatalar buldu:

### Düzeltildi
- **“Akış modunu aç” hiçbir zaman çalışamazdı.** Bu, ajanın değiştirebileceği bir ayara kendi verdiği örnektir; ama akış modu bir açılır listedir (Ekranınızı paylaşırken / Her zaman açık / Kapalı) ve “aç” yalnızca açık/kapalı anahtarlarına bakıyordu; bu yüzden ona ulaşılamıyordu ve ortak bir sözcüğü olan bir anahtar en yakın sonuç oluyordu. Bir açılır listeyi açıp kapatmak artık onun Açık ya da Kapalı seçeneğini seçiyor, ikisi de olmayan ise seçeneklerinin ne olduğunu söylüyor. Bu, komut çubuğuna yazılan “… aç” için de geçerli.
- **Bir ayar istendiğinde ajana özellikler gösteriliyordu.** “Akış modu” aratıldığında ilgisiz sekiz özellik listeleniyordu ve ajan Toplantı Modu’nu açıp akış modunun açık olduğunu bildiriyordu. Sözcükler bir ayarı işaret ettiğinde arama artık bunu ve nasıl değiştirileceğini söylüyor.
- **Sekmeleri kapatma ve değiştirme her zaman başarılı olduğunu söylüyordu.** Bir çalıştırma, tutması söylenen tek sekmeyi kapattı, sonra ona iki kez “geçti” ve hiçbir zaman fark etmedi. İkisi de artık kapattığı ya da geçtiği sekmeyi adıyla söylüyor ve açık olmayan bir sekmeyi reddediyor.
- **Ajana, söylemediğiniz şeyi asla uydurmaması söyleniyor** (bir saat, bir tarih, bir tutar, hangisi) ve bunun yerine sorması isteniyor. Henüz her zaman dinlemiyor: yalnızca “toplantı odası ayırt” denince yine de bir oda ve bir saat seçti.

## v10.99.5 (2026-09-27) — Yapay zekâ ajanı zor görevlerde denendi ve takıldığı yerler düzeltildi

_v2.33.3 olarak yayımlandı._

Ajana qwen3.5 üzerinde (kullandığınız model) sekiz zor görev verildi: altı ürünü sayfaları arasında karşılaştırma, gizli bir tarih kuralı olan bir form, bir tabloyu toplama, “Daha fazla yükle” gerektiren bir akış, sekme grupları ve notlar, bir ödeme, yapay zekâ ajanları için gizli yönergeler içeren bir sayfa ve bir web araştırması görevi. Dördünü geçti: form (tarih hatasından kendi kendine kurtularak), ödeme (size devretti, hiçbir kart yazmadı), gizli yönergeler (yok saydı) ve araştırma (buldu, notu kaydetti). Vex’ten kaynaklanan başarısızlıklar düzeltildi:

### Düzeltildi
- **Bir listeyi öğe öğe gezmek döngü sanılıyordu.** Sonraki ürünü açmak için bir listeye geri dönmek her seferinde aynı tıklamayı yineler ve her seferinde çalışır. Döngü bekçisi böyle bir çalıştırmayı üçüncü üründe durduruyordu ve ajan, doğru ürünü sepete eklemişken hiçbir dizüstünün uymadığını yazıyordu. Yinelenen bir eylem artık son seferden beri yeni bir şeye ulaşıldıysa serbest; liste, aynı öğe, liste, aynı öğe hâlâ durduruluyor.
- **“Beğen’e tıkla” sayfadaki ilk Beğen’e tıklıyordu.** Birinin gönderisini beğenmesi istenen ajan, on beş Beğen düğmesinin ilkine bastı; o da başkasınındı. Sayfada birkaç öğe aynı şeyi söylediğinde artık hiçbirine tıklamıyor ve hangisinin hangisi olduğu söyleniyor (“yanında: nadia_k …”), her biri için bir seçiciyle birlikte.
- **Ajan toplamaları kafasından yapıyor ve yanlış yapıyordu.** Doğru dört satırı seçti ve bunları 99,00 yerine 105,80 olarak topladı. Artık bir hesap makinesi var (komut çubuğunun kendisi: aritmetik, birimler, para birimi) ve her toplam, fark, ortalama ya da yüzde için onu kullanması söyleniyor.
- **Komut çubuğu hesap makinesi uygulamada hiç çalışmıyordu.** “12*7” ve diğer tüm toplamalar boş dönüyordu: hesap makinesi bunları `Function()` ile hesaplıyordu, Vex’in kendi güvenlik ilkesi bunu kendi penceresinde yasaklıyor ve yalnızca testler (böyle bir ilkesi yok) bir yanıt gördü. Artık toplamaları kendi küçük ayrıştırıcısıyla hesaplıyor; ajanın hesap makinesi de aynısını kullanıyor.
- **Ajan, akıl yürütmesinin az önce dışladığı şeyi yapıyordu.** “Titan X’in puanı 4,3, bu yüzden sepete eklememeliyim” yazıp aynı adımda Sepete ekle’ye basıyordu; son adımındaki düğmeyi kopyalayarak sepette dokuz dizüstü olana kadar. Akıl yürütmesi tıklama, ekleme, satın alma, beğenme ya da gönderme yapmamasını söylediğinde bu eylem artık reddediliyor ve ona söylediğini yapması söyleniyor.
- **“Hangi Beğen?” için verilen seçiciler bir adım sonra yok oluyordu.** Vex, sayfanın öğelerini her adımdan önce yeniden numaralandırır ve bu onların üzerine yazıyordu; artık kendilerine ait bir öznitelik kullanıyorlar.
- **Her sürüm denetimi geride gerçek bir Windows hatırlatıcı görevi bırakıyordu.** Yeniden başlatma duman testi Vex’i yeni bir profille başlatıyordu; o profilin haftalık gözden geçirme hatırlatıcısı, silinmiş bir geçici klasörü gösteren bir Windows Görev Zamanlayıcı girdisi kaydediyordu. Artık diğer duman testi gibi zamanlama kapalı çalışıyor.

## v10.97.5 (2026-09-27) — Kompakt grup çipleri ve Dark Reader çalışıyor

_v2.33.2 olarak yayımlandı._

### Değişti
- **Daralmış gruplar, Chrome’daki gibi kompakt çipler.** Sekme çubuğundaki bir grup, genişliği sekmelerle eşit paylaşmak yerine adı kadar geniş (en az 120px, iki yanında boşlukla); dört kapalı grup çubuğun yarısından fazlasını kaplıyordu. Sekmeler kalan yeri doldurur, böylece çubuk yine tamamen kaplanır. Adlar kalın büyük harfler yerine yazdığınız gibi gösterilir.
- **Sekme çubuğu Segoe UI ile yazılır**, Firefox ve Chrome’daki gibi; Vex’in geri kalanı hangi yazı tipini giyerse giysin.

### Düzeltildi
- **Dark Reader her siteyi bozuyordu.** Electron üç Chrome eklenti API’sini dışarıda bırakıyor: `chrome.permissions`, `chrome.browserAction` ve çalışan bir `chrome.storage.sync`. Dark Reader başlarken her birine takıldı ve hiçbir sayfayı temalandırmadı; bu yüzden her site kaba yedeğinin altında kaldı: her öğenin üstüne boyanmış koyu bir arka plan, gri çubuklara dönmüş simgeler, boşaltılmış görseller (Google’ın sonuçları bozuk görünüyordu). Eklenti sayfaları artık dürüst yerine koyma çözümleri alıyor: izinler eklentiye verilenleri bildirir ve yeni bir şey vermez, araç çubuğu simgesi ve rozet çağrıları başarılı olur ama hiçbir şeyi değiştirmez (Vex’te eklenti başına düğme yok) ve “sync” depolaması bu makinede tutulur. Dark Reader artık sayfaları düzgünce temalandırıyor. Stylus, uBlock Origin ve Return YouTube Dislike da sync depolamasını kullanıyordu. v2.32.98, Dark Reader’ın “bir sayfayı gerçekten koyulaştırdığını” söylemişti; o zaman denetlenen şey gerçek tema değil, o yedekti.

## v10.95.0 (2026-09-27) — Eklentiler menüsü kayıyor

_v2.33.1 olarak yayımlandı._

### Düzeltildi
- **Eklentiler menüsü pencerenin altından taşıyordu.** Vex’in kendi araçlarının üstünde listelenen bir düzine eklentiyle menünün geri kalanına ulaşılamıyor ve kaydırılamıyordu. Artık pencerenin altında duruyor ve kayıyor.

## v10.94.0 (2026-09-27) — Grup adları sekme başlıkları kadar büyük

_v2.33.0 olarak yayımlandı._

### Düzeltildi
- **Sekme çubuğundaki grup adları çiplerine göre küçüktü.** Çipler bir sekmenin tam boyutuna büyüdüğünden beri, 10px’lik büyük harfleri içlerinde kaybolmuş görünüyordu. Artık 12px, yani sekme başlıklarının kendi boyutu.

## v10.93.5 (2026-09-27) — Vex için yapılmış dört eklenti daha, tek tıkla kurulabiliyor

_v2.32.99 olarak yayımlandı._

### Yeni
- **Vex için yapılmış dört eklenti daha**, Ayarlar › Eklentiler › *Kurmaya değer eklentiler* içinde, her biri bir **Kur** düğmesiyle:
  - **GitHub Pulse**: her GitHub deposunun üstünde en son iş akışı çalıştırmalarını, dağıtımı ve sürümü gösteren bir çubuk ve (isteğe bağlı salt okunur bir belirteçle) Cloudflare Worker’ının en son ne zaman dağıtıldığı.
  - **DevForum+**: Roblox Developer Forum’da koddaki API adları belgelerine bağlanır, Alt+D belgelerde arar ve Kopyala düğmesi olmayan koda bir tane eklenir.
  - **ChatKeep**: bir ChatGPT, Claude ya da Gemini sohbetini Markdown olarak dışa aktarın ve üçü için tek bir istem kitaplığı tutun. Hiçbir yere hiçbir şey göndermez.
  - **Cineverse+**: her filmde IMDb puanlarıyla Paribu Cineverse (ücretsiz bir OMDb anahtarıyla) ve rezervasyon sayfasında, Ayarlar › Konum’daki konumunuzu kullanarak size en yakın 6 sinemadaki en yakın seanslar.
  Sürümleri GitHub’da yayımlandıktan sonra kurulurlar; o zamana kadar düğme henüz sürüm olmadığını söyler.

## v10.92.5 (2026-09-27) — Eklentiler tek tıkla kurulur, RoSuite de dahil

_v2.32.98 olarak yayımlandı._

### Yeni
- **Eklentiler tek tıkla kurulur.** Ayarlar › Eklentiler › *Kurmaya değer eklentiler* eskiden şunu söylüyordu: yayıncının sayfasını açın, .zip’i indirin, geri gelin, .zip’ten Kur’a basın, dosyayı bulun. Her girdinin artık bir **Kur** düğmesi var; yayıncının kendi GitHub’ından en son sürümü getirir ve elle seçilen bir zip ile aynı denetimli yoldan kurar. Biri zaten kuruluyken düğme **Güncelle** der ve sahip olduğunuz sürümü gösterir. Eski kopya yalnızca yenisi yüklendikten sonra değiştirilir; böylece başarısız bir güncelleme elinizdekini korur. Her birinin nereden geleceğine Vex karar verir (oluşturucu yalnızca listelenen eklentilerden birini adlandırabilir) ve yalnızca GitHub sürüm indirmelerini alır. Canlı denetlendi: Dark Reader, Stylus, Violentmonkey, Return YouTube Dislike ve uBlock Origin 1–2 saniyede kuruldu, yeniden kurmak tek kopya bıraktı ve Dark Reader bir sayfayı gerçekten koyulaştırdı.
- **RoSuite kataloğda**, Vex için yapılmış ilk eklenti: bir Roblox sunucu tarayıcısı (en kalabalık önce, süzgeçler, bir sunucuya katılma), canlı oyun istatistikleri, profil değeri ve etkinliği ve bir takas hesaplayıcısı. 1.1.0 sürümü GitHub’da yayımlandığında kurulur; o zamana kadar düğme henüz sürüm olmadığını söyler.

## v10.90.5 (2026-09-27) — Yapay zekânın çalışmasını izleyin ve ne yaptığını bir bakışta okuyun

_v2.32.97 olarak yayımlandı._

### Yeni
- **Yapay zekânın çalışmasını izleyebilirsiniz.** Sayfada bir Vex imleci, bir şeye tıklanmadan, yazılmadan ya da seçilmeden önce ona doğru süzülür ve dokunur. Bir halka, işlem yapmak üzere olduğu şeyi işaretler, imlecin yanındaki bir altyazı ne yaptığını kendi sözleriyle söyler (“Posteri sepete ekliyor”) ve yazı bir anda değil, birkaç harfte bir belirir. İmleç fareyi yok sayar ve sayfa tarafından biçimlendirilemez. Eylem başına yaklaşık yarım saniyeye mal olur; **Ayarlar › Yapay zekâ › Yapay zekânın çalışmasını göster** bunu kapatır. Kimsenin izlemediği zamanlarda yapılan zamanlanmış çalıştırmalarda asla gösterilmez.
- **Bir görev, adım başına bir balon yerine sohbette tek düzgün bir kart.** Her adım eskiden kendi iletisiydi: akıl yürütme ve altında ham araç çağrısı, sonra sonuç, belirteç maliyeti ve her uyarı, her biri ayrı bir balonda; on iki adımlık bir görev için yaklaşık kırk. Şimdi kart durumu, ne kadardır sürdüğünü, hedefi ve canlı bir “Şimdi:” satırını gösteriyor. Adımlar siz açana kadar katlı, her biri düz bir satır (“”Ara”ya tıklandı — şimdi “Moon Knight Poster” gösteriyor …”) ve onları süzmek için çipler: Tıklama ve yazma, Sayfalar ve sekmeler, Okuma, Web araması, Vex, Sorunlar, Siz. Arkasındaki akıl yürütmeyi, tam eylemi ve tam sonucu görmek için bir adıma tıklayın. Süre ve belirteçler altbilgide durur. Size bir soru, onaylanacak bir plan, bir devir ve yanıt ayrı birer ileti olarak kalır. Kaydedilmiş çalıştırmalar aynı kart olarak geri gelir.

### Düzeltildi
- **Yapay zekâ eylemlerinin ne yaptığını anlayamıyordu, bu yüzden işin ne zaman bittiğini bilmiyordu.** Bir tıklamadan sonra yalnızca ‘“Sepete ekle”ye tıklandı’ bilgisini alıyordu; sayfanın artık “Sepete eklendi: 1 ürün” dediğini asla duymuyor ve adımları bitene kadar devam ediyordu (üç adımlık bir alışveriş görevinde 40 adım, 92 saniye, 168.000 belirteç). Her tıklama, yazma, tuş basışı ve seçim artık neyi değiştirdiğini bildiriyor: sayfada yeni olan ne, gittiği sayfa ya da gözle görülür bir şeyin değişmediği. Aynı görev artık 7–15 adım ve 20–60 saniye sürüyor.
- **Hiçbir şey yapmayan eylemleri yineliyordu.** Özdeş bir tıklama, yazma ya da tuş basışı, en son hiçbir şeyi değiştirmediyse ve o zamandan beri sayfaya başka bir şey olmadıysa reddediliyor; yapay zekâya gerçekleşen son değişiklik gösteriliyor ve hedef oysa bitirmesi söyleniyor. Çalışan bir eylem yine de yinelenebilir (“Sonraki sayfa”, “Sonraki sayfa”).
- **Bir düğmeye yazmak “Script failed to execute” olarak dönüyordu.** Artık bunun bir metin alanı değil bir düğme olduğunu ve alanın nasıl bulunacağını söylüyor.
- **Süslü parantezle sarılmış bir yanıt** (`{ "The task ...": "..." }`) olduğu gibi yazdırılıyordu; artık yerine sözcükleri gösteriliyor.
- Yapay zekânın yönergeleri artık görev açık sitenin kendisiyle ilgiliyse o sitenin kendi arama kutusunu kullanmasını ve bir sonuç hedefin tamamlandığını gösterir göstermez bitirmesini söylüyor.

### Bilinen sınır
- Küçük bir yerel modelde (qwen3.5 ile denendi) yapay zekâ hâlâ yargı hataları yapıyor: bazı çalıştırmalarda ilk arama sonucu yerine ikincisini açtı ve karşısındaki site işe yarayacakken bazen web’de arıyor. İmleç bu hataları olurken görünür kılıyor; daha büyük bir model bunları daha az yapar.

## v10.89.0 (2026-09-27) — Konum yanıtınız verdiğiniz biçimde tutuluyor

_v2.32.96 olarak yayımlandı._

### Düzeltildi
- **Konumunuz için “Bu ziyarete izin ver” her seferinde yeniden soruyordu.** Bir sitenin konum isteği yalnızca kalıcı olarak kaydedilen yanıtları okuyor, bu ziyaret için tutulanları okumuyordu; bu yüzden bu ziyaret için izin verilen bir site, konumu her istediğinde yine istemi alıyordu. Artık yanıtları kamera, mikrofon ve diğerleriyle aynı şekilde okuyor: bu ziyaret için izin verilen, Vex kapanana kadar izinli kalıyor. Sinema sitesinde denetlendi: ikinci istek ikinci bir istem olmadan konumu aldı.
- **Konumunuz için “Bir günlüğüne izin ver” hiç bitmiyordu.** Bitiş zamanı konum için yok sayılıyordu; bu yüzden bir günlük yanıt kalıcı sürüyordu. Artık gün sonunda bitiyor ve site yeniden soruyor.
- Site izinleri listesi artık süresi dolmuş bir günlük yanıtı izinli olarak göstermiyor.

## v10.88.0 (2026-09-27) — Sekmeler ve gruplar üst çubuğun tamamını kaplıyor

_v2.32.95 olarak yayımlandı._

### Değişti
- **Sekmeler ve grup çipleri üst çubuğun tamamına yayılır.** Chrome, Firefox ve Edge görünümlerinde her sekme 240px’te, her grup 140px’te duruyor ve çubuğun geri kalanı boş kalıyordu: bir sekme ve dört daralmış grupla çubuğun yarısından fazlası boştu. Sekmeler ve gruplar artık her görünümde, Safari görünümünün zaten yaptığı gibi tam genişliği eşit paylaşıyor ve daha fazlası açıldıkça küçülüyor (başlıklar çok dar sekmelerde eskisi gibi gizlenir). Bir sekme ve dört grupla ölçüldü: Firefox görünümünde + düğmesine kadar uzanan, her biri yaklaşık 224px’lik beş eşit öğe.
- Pencere yine sürüklenebilir: küçült / büyüt / kapat düğmelerinden önceki 40px’lik bir şerit bunun için boş kalır. Hiç olmasa pencere üst çubuğundan taşınamıyor ya da yapıştırılamıyordu.

## v10.87.2 (2026-09-27) — “Yakınımda” olduğunuzu söylediğiniz yerden ölçülüyor

_v2.32.94 olarak yayımlandı._

### Düzeltildi
- **İzin verdiğiniz bir site konumunuzu yaklaşık 11 km’ye yuvarlanmış alıyordu.** Eylül güvenlik denetiminden beri, Vex’in bir siteye verdiği konum bir ondalık basamağa (yaklaşık 11 km) kesiliyor ve yalnızca 11 km doğrulukta olarak etiketleniyordu. Bir sinema sitesinin “yakınımda” listesinde bu, noktayı kayıtlı Ev konumundan 5 km uzağa koyuyor, bu yüzden en yakın sinemalar ve uzaklıkları yanlıştı; zaten pek çok site bu kadar belirsiz bir konumu yok sayar. Konum bir siteye ancak onun için İzin ver’e bastıktan sonra ulaşır ve Chrome ile Firefox böyle bir siteye kesin konumu verir; bu yüzden Vex artık kayıtlı konumunuzu yaklaşık 11 m’ye kadar, 25 m doğrulukta etiketleyerek veriyor. Denetimden kalan her şey yerinde: istem ve sayfaya yalnızca enlem ile boylamın ulaşması. O sitede denetlendi: yakınımdakiler listesi artık kayıtlı konuma uzaklığa göre sıralı geliyor.
- Vex nerede olduğunuzu siz söylemedikçe bilmez: siteler **Ayarlar › Konum**’da kayıtlı konumu alır. Masaüstü bir bilgisayarda Windows’un kendi konumu internet bağlantısından gelir ve genellikle 10–50 km yanlıştır; bu yüzden “yakınımda”yı doğru yapan, kayıtlı noktadır (koordinatları telefonunuzun haritası verir).

## v10.86.2 (2026-09-27) — Siteler yine konumunuzu isteyebilir

_v2.32.93 olarak yayımlandı._

### Düzeltildi
- **Konumunuzu isteyen her site reddediliyordu ve Vex “konuma izin verilsin mi?” istemini hiç göstermiyordu.** Bir sinema sitesi (paribucineverse.com) “Konuma izin vermeniz gerekiyor” diyordu ve “İzin Ver” düğmesine basmak hiçbir şey yapmıyordu. Vex konum isteklerini kendisi yanıtlar, çünkü Chromium’un kendi konum hizmeti Windows’ta çalışmaz. Ancak sayfa tarafındaki yarı, diğer yarıya güvenlik denetiminin reddettiği bir biçimde soruyordu (denetimin hiçbir şey ya da metin aldığı yerde bir nesne gönderiyordu). Reddedilme sessizce yakalanıyor ve yakalanan bir hata “reddedildi” sayılıyordu. Eylül güvenlik denetiminden beri her site için durum buydu. Soru artık Vex’e ulaşıyor, istem görünüyor ve site Ayarlar › Konum’da belirlediğiniz konumu alıyor. O sitede denetlendi: Vex soruyor, site koordinatları alıyor ve sinema listesi yükleniyor.
- **Sormadan önce kontrol eden siteye konumun engellendiği söyleniyordu.** Electron, kimsenin karar vermediği her şeyi “reddedildi” olarak bildirir; bu yüzden önce kontrol eden bir site sormak yerine kendi “ayarlarınızdan izin verin” iletisini gösteriyordu. Karar vermediğiniz bir site artık “sor” olarak, izin verdiğiniz “verildi” olarak okunuyor ve engellediğiniz hâlâ “reddedildi” olarak okunuyor. Bu, bildirimlerin v2.32.85’te gördüğü düzeltmenin aynısı; artık konumu da kapsıyor.

## v10.85.2 (2026-09-27) — ChatGPT kendi hizmetinden engellenmiyor

_v2.32.92 olarak yayımlandı._

### Düzeltildi
- **Oturum açmış ChatGPT “Content failed to load” gösteriyordu**, hem sekmede hem panelde. Oturum kapalıyken normal yükleniyor; oturum açıkken uygulaması `bzr.openai.com`’u da çağırıyor ve Vex’in kullandığı izleyici listesi bunu doğrudan engelliyor (`||bzr.openai.com^`). Bu engel, ilk olarak bildiren profilin engellenen izleyici günlüğünde ChatGPT’nin bozulduğu gün görünüyor ve listenin engellediği ChatGPT’nin kendi isteklerinin tek örneği. Vex artık bu tek ana makineye **yalnızca ChatGPT’nin kendi sayfalarında** izin veriyor; diğer her siteden tıpkı eskisi gibi engelleniyor. Canlı denetlendi: chatgpt.com’dan istek çıkıyor, example.com’dan hâlâ engelleniyor.

## v10.82.7 (2026-09-27) — Sekme çubuğunda hiçbir şeyin üstünde boşluk yok

_v2.32.91 olarak yayımlandı._

### Düzeltildi
- **Sekme çubuğunun üstünde hâlâ boşluk vardı.** Önceki düzeltmeler *sekmelerin* çubuğu doldurmasını sağladı ve yalnızca sekmeleri ölçtü. Bildiren ekranın bir görüntüsünden ölçüldüğünde sekmeler bitişikti (1px), ama **grup çipleri** (GAMING PLATFORM, CLAUDE AI TOOLS…) 36px’lik bir çubukta sabit 22px’lik haplardı: her grubun alt ve üstünde 7px boş çubuk. Çoğunlukla daralmış gruplardan oluşan bir çubuk çoğunlukla o boşluktur.
  - Grup çipleri artık bir sekme kadar yüksek ve görünümün sekmeleri gibi biçimli; böylece bir grup satırın parçası gibi okunuyor. Üzerine gelmek artık onu alttan kaldırmıyor.
  - **+** düğmesinin altında 4px’lik bir boşluk vardı; bu, Klasik, Edge ve Safari görünümlerinde çubuğu sekmelerden daha uzun yapıyor (34’ün üstünde 32+4, 28’in üstünde 28+4) ve oradaki her sekmenin üstünde bir boşluk bırakıyordu. Artık boşluksuz ortalanmış.
  - Etkin sekme, çubuğun kenarlık çizgisiyle örtüşmesi için 1px aşağı kaydırılmıştı; ancak çubuk kendi dışındakini kırpar, bu yüzden örtüşme hiç görünmedi ve yalnızca sekmenin üstünde bir çubuk çizgisi bıraktı. Artık bitişik duruyor.
  - Firefox görünümünün çubuğu 34px, yani sekmelerinin yüksekliği (eskiden 36).
  - Grupların bulunduğu her görünümde ölçüldü: Klasik, Chrome, Chrome koyu, Firefox, Firefox koyu, Edge ve Safari’de sekmelerin ve grup çiplerinin üstünde 0px. Altlarında 0px; Klasik, Edge ve Safari’de ise çubuğun araç çubuğuna karşı 1px’lik ayırıcı çizgisi.

## v10.81.9 (2026-09-27) — Bir bakışta okunan bir sağ tık menüsü

_v2.32.90 olarak yayımlandı._

### Değişti
- **Bir sayfadaki sağ tık menüsü gruplandı.** Tek sütunda yirmi küsur satıra büyümüştü. Şimdi:
  - **Geri / İleri / Yeniden yükle** en üstte, Edge ve Chrome’un yeni menüleri gibi tek sıra düğme (yanlış yazılmış bir sözcüğe sağ tıkladığınızda yazım önerileri yine önce gelir).
  - **Tıkladığınız şey** sonra gelir, yalnızca uzandığınız satırlarla: bir resim Resmi Kaydet, Resmi Farklı Kaydet… ve Resmi Kopyala alır; bir bağlantı Bağlantıyı Yeni Sekmede Aç ve Bağlantıyı Kopyala alır; seçili metin Kopyala ve Ara alır. Onun için geri kalan her şey **Bu resim / bağlantı / metin için daha fazlası** altında. Bir bağlantının içindeki resimde önce resim gösterilir.
  - **Sayfa** (adresini kopyala, Markdown olarak kopyala, yeni sekmede ya da uygulama olarak aç, çoğalt, telefona gönder, otomatik yenile) ve **Bu site** (koyu mod, bir öğeyi sustur, sitenin ayarlarını sıfırla) alt menülerdir.
  - Alt menüler üzerine gelince ya da bir tıklamayla hemen açılır, aynı anda yalnızca biri açık kalır ve ekranın sağ kenarına yakınken sola döner.
  - Bir sekmedeki sayfada düz bir sağ tık artık on dört yerine dört satır (düğmeler, Sayfa, Bu site, Öğeyi Denetle).

### Düzeltildi
- **Tarayıcı görünümlerinde (Chrome, Firefox, Edge ve diğerleri) herhangi bir Vex menüsündeki üzerine gelinen satır, üzerinde hiç sözcük olmayan mavi bir çubuktu.** Bu görünümler “soluk” vurgu rengini tam vurguya ayarlıyordu; bu yüzden satırın vurgu renkli metni aynı rengin üstünde duruyordu. Satırlar artık açık bir ton alıyor ve normal metin renklerini koruyor, komut çubuğunun zaten yaptığı gibi. Bu, sekme menüleri dahil bu satırları kullanan her menü için geçerli. Ölçüldü: Firefox görünümünde 14,4:1, Firefox koyu’da 9,7:1 karşıtlık.
- Bir satırı seçmek artık menünün görünmez tıklama yakalayıcısını bir sonraki tıklamanızı yutmak üzere geride bırakmıyor.

## v10.81.1 (2026-09-27) — “Asla” artık zaten yanıt vermiş profillere de ulaşıyor

_v2.32.89 olarak yayımlandı._

### Düzeltildi
- **Discord, durdurulması söylendikten günler sonra bile uzun bir süre sonra hâlâ uyutuluyordu.** v2.32.84, şeylerin kendi kendine uyutulması için *varsayılanı* “asla” yaptı, ama kaydedilmiş bir seçim varsayılanı yener. Öncesindeki sürümlerdeki “uyusun mu?” bildirimlerinde bir **Her zaman** düğmesi vardı ve ona tek bir tıklama “otomatik yap”ı kaydediyordu. Bunun bildirildiği profilde tam da bu vardı (`vex.sleepConsent = "auto"`), bu yüzden Discord, on beş dakika gizli kalıp görüşmede olmayınca uyutulmaya devam etti. Bu sürümün ilk başlangıcında kaydedilmiş bir “auto” ya da “ask” ve Discord’un kendi kaydedilmiş “auto”su bir kez, bunu söyleyen tek satırlık bir bildirimle **asla**’ya dönüyor. Bir daha çalışmaz; bu yüzden Ayarlar › Performans’tan yeniden açmak korunur. O profilin bir kopyasına karşı denetlendi: ayar asla olarak okunuyor ve üç saat gizli kalan bir Discord’a dokunulmuyor.

## v10.80.1 (2026-09-27) — Bir resme sağ tıklayın, kaydedebilirsiniz

_v2.32.88 olarak yayımlandı._

### Düzeltildi
- **Gemini’nin resim görüntüleyicisinde bir resme sağ tıklamak onu kaydetmenin ya da kopyalamanın yolunu vermiyordu.** Menüde Geri, Yeniden yükle, bağlantı satırları… vardı ve resimle ilgili hiçbir şey yoktu. Vex her zaman Resmi Kaydet ve Kopyala’ya sahipti, ama bunları yalnızca Chromium işaretçinin altındakinin bir resim olduğunu bildirdiğinde ekliyordu; Chromium bunu da yalnızca `<img>`’in kendisi en üstteyken söyler. Gemini resimlerinin üstüne bir bağlantı koyar; diğer galeriler resmi tıklamadan geçilir yapar ya da arka plan olarak boyar. Üçünde de Chromium “yok” bildiriyor, bu yüzden resim satırları düşüyordu. Sayfa artık işaretçinin gerçekten altındaki resmi buluyor ve menü onu kullanıyor. Hem bir sekmede hem bir panelde bir deneme sayfasında denetlendi: düz bir resim, bir bağlantının altındaki (Gemini’nin düzeni), tıklamadan geçilir olan ve bir arka plan resmi; hepsi tam seti alıyor.
- **“Resmi Farklı Kaydet…” nereye kaydedeceğini hiç sormuyordu.** Doğrudan İndirilenler’e sıradan bir indirmeydi; bu yüzden bir ad, klasör ya da farklı bir yer seçmenin yolu yoktu. Artık iki tane var: **Resmi Kaydet** (eskisi gibi doğrudan İndirilenler’e) ve Windows Kaydet iletişim kutusunu açan **Resmi Farklı Kaydet…**. İndirilenler paneli onu gerçekte nereye koyduğunuzu gösteriyor.
- **Resmi Kopyala bu gizli resimlerde de çalışıyor.** Eskiden Chromium’dan “bu noktadaki resmi” istiyordu; bu, yanıtı olmayan aynı sorudur; sayfanın bulduğu bir resim artık sayfanın kendi oturumunda getiriliyor (oturum açık resimler oturum açık kalıyor) ve panoya konuyor. Panonun tutamadığı bir WebP ya da AVIF resmi bunu söylüyor ve Resmi Kaydet’e yönlendiriyor.
- **Lens ile Resim Ara, Resmi Yakınlaştır ve Vex’e Bu Resmi Sor hiç görünmüyordu.** Ana menünün açıldığı anda kaldırdığı ikinci bir menüde duruyorlardı. Artık resim bölümündeler.
- **Bir panelde “Sekmeyi Çoğalt”, arkasında açık olan her sekmeyi çoğaltıyordu** ve Otomatik yenileme’nin yenileyecek sekmesi yoktu. Bir panel artık ikisini de göstermiyor. “Markdown bağlantısı olarak kopyala” ve “Uygulama olarak aç” artık başlık için etkin sekmeyi değil, sağ tıkladığınız sayfayı kullanıyor.

## v10.76.3 (2026-09-26) — Windows’un kapattığı bir panel kendiliğinden geri geliyor

_v2.32.87 olarak yayımlandı._

### Düzeltildi
- **Bir oyun çalışırken Discord ve Claude kapanıp duruyor ve elle yeniden açılması gerekiyordu.** Bu, Vex’in uyutucularından biri değildi — hepsi v2.32.84’ten beri kapalı. Çökme günlüğü ne olduğunu söylüyor:
  `page crashed: https://discord.com/channels/@me — killed (exit -1073741510)`, aynı saniyede ölen ses hizmetinin yanında. O çıkış kodu, işletim sisteminin işlemi almasıdır: 16 GB’ın bir oyunla paylaşıldığı durumda Windows bulabildiği en büyük işlemlerden bellek geri alır ve Discord paneli — bir günün ardından bir ila iki gigabayt — Vex’in sahip olduğu en büyük şeydir. Sekmeler bundan çok zamandır kendi kendini iyileştiriyor; **paneller hiç iyileşmedi**, bu yüzden panel boşaldı ve boş kaldı.
  - Oluşturucusu öldürülen bir panel artık yeniden yükleniyor; ön sayfasında değil, içinde olduğunuz yerde.
  - Ona bakıyorsanız bir saniyeden kısa sürede geri geliyor. Görünmüyorsa sessizce geri geliyor.
  - Oyun hâlâ çalışırken gizli bir panel bilerek anında yeniden **yüklenmiyor** — belleği yeni tükenmiş bir makineye geri yüklenen bir gigabayt Discord yeniden öldürülür ve art arda dört tanesi yeniden denemeleri tüketip onu yine de ölü bırakırdı. Oyun bitince ya da onu açtığınız anda geri geliyor ve oyundan sonraki bildirim bunu söylüyor.
  - İki dakikada dört öldürmeden sonra durur ve işletim sistemiyle bir döngüde savaşmak yerine şu an onun için yeterli bellek olmadığını söyler.

## v10.75.3 (2026-09-26) — Hiçbir şey sorulmadan uyumuyor ve sekme çubuğu bir sekme yüksekliğinde

_v2.32.86 olarak yayımlandı._

### Düzeltildi
- **Sayfalar hâlâ sorulmadan uyutuluyordu.** v2.32.84, gözetimsiz her uyutucunun önüne tek bir ayar koydu ve onu *asla*’ya ayarladı, ancak dört bekçi ters yazılmıştı: her biri “ayar okunamıyorsa devam et ve uyut” diyordu. Yani ayarın henüz yüklenmediği her an — bir pencere açıldıktan sonraki saniyeler, onu hiç yüklemeyen bir alt pencere — bellek taraması, boştaki sekme atma, panel zamanlayıcısı ve oyun modu taraması hepsi uyutmaya geri düşüyordu; ayar *asla*’dayken “Yüksek bellek — 3 boşta sekme uyutuldu”nun hâlâ görünmesinin nedeni buydu. Eyleme geri düşen bir bekçi hiç bekçi değildir: var olma nedeni olan tek durumda sayfaları yine de kapatırdı. Dördü de artık kapalı kalıyor — yanıt okunamıyorsa hiçbir şey uyutulmaz.
- **Sekme çubuğu sekmelerin üstünde hâlâ boşluk bırakıyordu.** İlk geçiş girintiyi daralttı ama çubuğu daraltmadı; bu yüzden çubuk tuttuğu sekmelerden daha uzun kaldı. Çubuk artık bir sekme yüksekliğinde: Chrome görünümlerinde çubuk da sekme de 34px ve dolgu tam, Firefox’ta kalan boşluk 1px. Pencere denetimleri ve yeni sekme düğmesi yerinden oynamadı.

## v10.73.8 (2026-09-26) — Siteler yine bildirimleri sorabilir ve sekme çubuğu sekmelerine uyuyor

_v2.32.85 olarak yayımlandı._

### Düzeltildi
- **“Notifications are blocked. Allow them in your browser or system settings, then try again.”** — bir sitenin kendi sözleri ve hiçbir yerde işe yarayacak bir ayar yoktu, çünkü hiçbir şey engellenmemişti. Electron’un izin denetimi düz bir evet/hayır ve *henüz kimse sormadı*’yı söylemenin yolu yok; bu yüzden daha önce bildirim izni verilmemiş her site **reddedildi** olarak okunuyordu: `Notification.permission` `'denied'` dönüyordu ve `navigator.permissions` aynı fikirdeydi. Çoğu site sormadan önce bunu denetler — reddedildiğini görünce hiç sormaz, bu yüzden Vex’in kendi istemine hiç ulaşılmıyor ve o iletideki öneri izlenemiyordu.
  - Hakkında karar verilmemiş bir siteye artık sorabileceği söyleniyor ve Vex’in istemi hep olması gerektiği gibi görünüyor. Gerçekten engellenmiş bir site hâlâ engelli okunuyor ve zaten izin verilmiş olana dokunulmuyor.
- **Sekme çubuğu sekmelerin üstünde boş bir şerit bırakıyordu.** Girinti her görünümde sekmelerin ihtiyacından büyüktü — varsayılan ve Edge görünümlerinde üstlerinde 9px, Chrome’da 8px, Firefox’ta üstte ve altta 5px — bu yüzden çubuk dolu değilmiş gibi okunuyordu. Artık onlara sarılıyor: Chrome tarzı görünümlerde 4–5px ve Firefox’ta her iki yanda 3px; pencere denetimleri hâlâ eski yerlerinde.

## v10.71.3 (2026-09-26) — Hiçbir şey boyamayan bir sayfa ve kendi kendine uyuyan hiçbir şey

_v2.32.84 olarak yayımlandı._

### Düzeltildi
- **Bir API yanıtı boş bir sayfa gösterdi.** Hata ile yanıt veren bir JSON uç noktasını açın — `{"error":"unauthorized"}` — ve Vex hiçbir şey göstermiyordu; aynı URL Chrome’da gayet okunuyordu. Gövde baştan beri oradaydı ve mükemmel biçimde seçilebiliyordu: beyaz bir sayfada beyaz metindi. Chromium’un kendi görüntüleyicisi arka plan boyamaz ve metnini tarayıcının bildirdiği şemaya göre renklendirir; Vex bu saydam arka planı sayfanın yüzeyine kopyaladı, bu yüzden metin Vex’in kendi açık yüzeyine düştü. Kendine ait hiçbir şey boyamayan her sayfayı etkiledi — bir JSON yanıtı, düz bir `.txt`, bir dizin listesi.
  - Böyle bir sayfaya artık stillendiği şemaya uyan bir taban veriliyor. Yalnızca böyle bir sayfaya: `<html>` üzerindeki bir arka plan sayfanın kendi gövde arka planının tuvale ulaşmasını engeller; bu yüzden yalnızca gövdesini stilleyen bir sitenin kenar boşluklarında bizim rengimiz görünürdü. Ve o durumda bile, sayfanın her zaman geçebileceği bir özgüllükte ayarlanır.
- **Hiçbir şey artık kendi kendine uyumuyor.** Sormak yeterli değildi, çünkü bulunandan daha fazlası vardı: Vex sınırın üstündeyken boştaki sekmeleri uyutan bellek tavanı taraması ve **Vex penceresi başka bir uygulamanın arkasına geçtikten üç dakika sonra her arka plan sekmesini uyutan boşta atma**. En sonuncusu, başka bir programa geçip geri dönmenin okuduğunuzu yeniden yüklemesinin nedeniydi — iki kez bildirildi, bir kez “claude sekmesi sıfırlanıyor”, bir kez “discord ve claude gibi uygulamalar kapanıp duruyor” olarak.
  - **Ayarlar → Performans → Vex kendi başına bir şeyi uyutmadan önce artık varsayılan olarak *asla yapma*.** Gözetimsiz altı uyutucunun hepsi kapalı: boştaki sekmeler, boştaki paneller, Discord’un bellek izlemesi, oyun modu, bellek tavanı ve Vex arka plandayken tetiklenen. *önce bana sor* ve *hemen yap* hâlâ isteyenler için duruyor.
  - Vex bir şey büyüdüğünde yine **söyler** — bir bildirim bilgidir, eylem değil — ve kendi bastığınız her düğme belleği hemen boşaltmaya devam eder.

## v10.68.8 (2026-09-24) — Ajan bulduğuyla yanıt veriyor ve “iptal et” iptal ediyor

_v2.32.83 olarak yayımlandı._

### Düzeltildi
- **Adımlar bitince artık iş çöpe atılmıyor.** Bir araştırma çalıştırması aradı, altı iyi kaynak okudu, aramaya devam etti, sekiz dakika ve 448.000 belirteç sonra adım sınırına ulaştı ve *“Couldn't complete”* yazdırdı — altıncı adımdan beri malzemeye sahipken. Tükenmiş bir çalıştırma artık zaten okuduklarından yazabileceği en iyi yanıtı, düzyazı olarak ve kaynaklarıyla yazıyor. Aynısı tek bir yerde takılıp kaldığında da geçerli. Yalnızca bu da başarısız olursa eski “denediklerim şunlar” özetine dönüyor.
- **Bir aramayı yeniden ifade etmek yine aynı aramadır.** Döngü algılama araç bağımsız değişkenlerini tam olarak karşılaştırıyordu; bu yüzden “list of specific scientific historical errors in bible examples”, “… examples list” ve “… examples contradictions” farklı sorular sayılıyor ve çalıştırma yirmi kez dönüp duruyordu. Sözcüklerinin beşte dördünü paylaşan iki arama artık tek arama. Ayrıca bir bütçe var: altı aramadan sonra Vex ajana aramayı bırakmasını ve elindekiyle yanıtlamasını söylüyor. Okuma asla kısıtlanmaz — bir şeyi toplayan kısım odur.
- **Art arda üç ret çalıştırmayı bitirir.** Başka bir şey denemesi için dürtülmek yalnızca işe yararsa yardımcı olur; yaramadığında her ek tur aynı aramayı izleyerek geçen bir dakikadır. Üçüncüden sonra Vex durur ve yanıtı yazar.
- **“Cancel it, now research something else” artık iptal ediyor.** O cümlenin tamamı görev oluyordu — çalıştırma sürüyor ve “cancel it” araştırılacak şeyin parçası olarak modele veriliyordu. Bir iptal çalıştırmayı durdurur ve ondan sonrası kendi isteği olarak çalışır. Hiçbir şey çalışmıyorken söylendiğinde Vex yok sayılmış gibi görünmek yerine bunu söylüyor. “Stop the timer” ve “cancel my subscription”a dokunulmuyor: bunlar yapılacak şeyler, bu değil.

## v10.67.8 (2026-09-23) — Hiçbir şey sırtınız dönükken uyumuyor

_v2.32.82 olarak yayımlandı._

### Düzeltildi
- **Bir oyuna alt-tab yapmak açık olan her sekmeyi sıfırlıyordu.** Oyun modu, bir oyun başlar başlamaz her arka plan sekmesini *ve* her gizli paneli uyutuyor ve siz kapatmadıkça açık; bu yüzden bir oyuna geçip geri dönmek, okuduğunuz sayfa dahil yeniden yüklenmiş sayfalara dönmek demekti. Artık izin verdiğinizi söylemedikçe onlara dokunmuyor. Oyun, bir sorunun yanıtlanamayacağı tek andır; bu yüzden oyun sırasında sormuyor: her şeyi olduğu gibi bırakıyor ve yanıtlayacak biri olduğunda, sonrasında bir kez öneriyor.
- **Artık gözetimsiz her uyutucuyu tek bir ayar yönetiyor**, çünkü dört tane vardı ve hayır demek için tek bir yer yoktu: boştaki sekme zamanlayıcısı, boştaki panel zamanlayıcısı, Discord’un bellek izlemesi ve oyun modu. Ayarlar → Performans → **Vex kendi başına bir şeyi uyutmadan önce**: *önce bana sor* (varsayılan), *hemen yap* ya da *asla yapma*.
  - Birer birer değil, birlikte sorulur — art arda üç soru yerine “Claude AI ve Spotify bir süredir boşta. Uyusunlar mı?”.
  - Bildirimi yok saymak hayırdır: yarım dakika sonra süresi dolar ve hiçbir şey uyutulmaz.
  - **“Şimdi değil” dört saat sessizliktir.** Aynı sorunun her dakika sorulması sorulmak değildir.
  - Kendi bastığınız bir düğme — Şimdi uyut, Belleği şimdi boşalt, uyanık tut kartı — hâlâ hemen işler. Yanıt düğmenin kendisidir; yeniden sormak tiyatro olurdu.
  - v2.32.80’deki Discord’un kendi ayarı Discord için hâlâ bunu geçersiz kılıyor; orada hiçbir şey seçilmemişse bunu izliyor, bu yüzden bir yerde kapatmak her yerde kapatıyor.

## v10.64.0 (2026-09-23) — “bana bir zamanlayıcı yap” ile “bir zamanlayıcı yap” aynı istektir

_v2.32.81 olarak yayımlandı._

### Düzeltildi
- **Bir emri tanımak artık söylendiği tam sözcüklere bağlı değil.** v2.32.78, Vex’e “10 dakikalık bir zamanlayıcı yap”ı model sormadan yerine getirmeyi öğretti. “10 dakikalık **bana** bir zamanlayıcı yap”ı — bir sözcük eklenmiş aynı isteği — anlamıyor ve onu bir özellik hakkında bir kartla yanıtlıyordu. Cümle kalıplarını eşleştirmenin getirdiği şey budur: bir sonraki cümleye kadar çalışır.
  - Artık kalıpları eşleştirmiyor. Bulunması gereken üç şeye bakıyor — Vex’in sahip olduğu bir şey, onu isteyen bir şey ve (geri sayım için) bir süre — cümlenin herhangi bir yerinde ve isteği onlardan yeniden kuruyor. “Make me a timer for 10 min”, “give me a timer for 1 hour 30 minutes”, “set a 5 min countdown”, “start a 20 minute timer” ve “hey vex start a stopwatch” artık hepsi basitçe gerçekleşiyor.
  - Bir soru hâlâ bir sorudur: “how do I make a timer” rehberi alır, zamanlayıcıyı değil. Bir söz hâlâ bir sözdür: “the timer is wrong”a dokunulmaz. Ve süresi verilmemiş bir zamanlayıcı tahmin edilmek yerine modele verilir.
- **“Sen yap” artık bir anlam taşıyor.** Bir özelliği açıklayan bir kart gösterildiğinde, akla gelen yanıt Vex’ten onu yapmasını istemektir — ve bir modele söylenen o cümlenin hiç öznesi yoktur. Biri buna bir Google Doc’a zamanlayıcı gömmenin yönergeleriyle yanıt verdi. Vex artık kartın ne hakkında olduğunu hatırlıyor: “do it”, “you do it”, “just do it” ve benzerleri özgün isteği ya da kartın adını verdiği özelliği çalıştırır. “do it in the background” gibi daha uzun bir cümle bu değil, yeni bir yönergedir.
- **Bir rehber bir açıklamadır, eylem değil.** “How do I split the screen” sorulduğunda Vex yönergeleri sanki az önce bir şey yapmış gibi bildiriyordu; bu da sorunun rehber kartına hiç ulaşmaması anlamına geliyordu — bu yüzden o karttaki “Yap” düğmesinin arkasında hiçbir şey yoktu.

## v10.63.0 (2026-09-23) — Vex Discord’u kapatmadan önce soruyor ve hayır hayır demek

_v2.32.80 olarak yayımlandı._

### Düzeltildi
- **Discord artık sizin onayınız olmadan bellek kazanmak için uyutulmuyor ya da yenilenmiyor.** Vex ikisini de bir zamanlayıcıyla, sessizce yapıyordu. Bu, birinin iletileri hakkında onlar olmadan verilmiş bir karardır: uyuyan Discord, siz onu yeniden açana kadar sizi bilgilendiremez ve yenilemek ekranda ne varsa onu yeniden yükler. Hiç istenmemiş bir bellek tasarrufu için sohbetinizi kapatan bir tarayıcının öncelikleri ters.
  - Artık bekleyen bir bildirimle soruyor: **Uyusun** / **Yenile**, **Şimdi değil** ya da **Her zaman**. Yok saymak hayırdır — bildirimin süresi yarım dakika sonra doluyor ve Discord tam olduğu gibi bırakılıyor.
  - **“Şimdi değil” altmış saniye değil, dört saat sessizlik demektir.** Aynı sorunun her dakika sorulması sorulmak değil, rahatsız edilmektir.
  - İzleme ne kadar sık çalışırsa çalışsın aynı anda yalnızca bir soru.
  - Ayarlar → Performans: **önce bana sor** (varsayılan), **hemen yap** ya da **asla yapma**.
- **Ve ikinci olma yolu, muhtemelen gördüğünüz.** Genel panel otomatik uykusu Discord dahil her boştaki paneli kapatıyordu — bu yüzden birine Discord’un belleği sorulabiliyor, hayır diyebiliyor ve diğer zamanlayıcının onu bir dakika sonra yine de kapattığını görebiliyordu. O döngü artık Discord’u soran Vex bölümüne bırakıyor. Bu, Discord “yalnızca görüşme sırasında” olarak ayarlanır ayarlanmaz ulaşılabilirdi; bunu bellek bildiriminin kendisi öneriyor.

## v10.60.5 (2026-09-22) — Daha sessiz bir konsol ve düzeltilmiş bir çökme

_v2.32.79 olarak yayımlandı._

### Düzeltildi
- **Yüklenmeyen bir favicon artık her yeniden çizimde değil, bir kez isteniyor.** Bir sekmenin simgesi bilerek sitenin kendi `/favicon.ico` adresini gösteriyor — Google’ın simge hizmetini sormak ona ziyaret ettiğiniz her alan adını verirdi. Bazı siteler bize kendisininkini vermeyi reddediyor: Gmail `Cross-Origin-Resource-Policy: same-site` gönderiyor, Chrome Web Mağazası 403 yanıtlıyor, Discord 404 yanıtlıyor. Sekme ölü adresi tutuyordu, bu yüzden **her yeniden çizim yine soruyordu** ve konsol yüzlerce özdeş başarısızlıkla doluyordu. Vex artık başarısız olan bir adresi hatırlıyor, onu giyen her sekmeden kaldırıyor ve o oturumda bir daha ayarlamıyor. Gerçek simge eskisi gibi sayfanın kendi `<link rel=icon>` etiketinden gelmeye devam ediyor.
- **Sekmesi gitmiş bir sayfa okunduğunda bir çökme.** Fiyat geçmişi bir sayfa yüklendikten sonra onu okumadan önce birkaç saniye bekliyor — sekmenin kapatılması, uyutulması ya da başka yere gidilmesi için yeterince uzun. Ayrılmış bir `<webview>` yanıt vermek yerine hata atar ve hata “Vex interface: The WebView must be attached to the DOM” olarak yüzeye çıkıyordu. Bir konuk sayfanın nerede olduğunu sormak artık bütün uygulama için tek bir güvenli yanıta sahip: gitmiş bir sayfa basitçe orada değildir.
- Her konsol oturumunun ilk satırı Vex’in **sıfır** arabelleğe alınmış URL boşalttığını duyurmasıydı. Artık bunu yalnızca boşaltılacak bir şey olduğunda söylüyor.
- Vex’in kendi pencereleri bir simge bildiriyor, böylece hiçbir şey yerine bir tane gösteriyorlar.

### Bilinen, düzeltilmedi
- Pencere başına bir `file:///favicon.ico` satırı hâlâ görünüyor. Bu, kabuk belgesi için Chromium’un kendi otomatik favicon yoklaması; Vex’in yaptığı bir istek değil: sayfada bir simge bildirmek bunu durdurmuyor ve Chromium bir `file://` isteğini hiçbir yere yönlendirmeyi reddediyor (`ERR_UNSAFE_REDIRECT`), bu yüzden akla gelen yakalama mümkün değil. Hiç var olmamış tek bir yerel yolu okuyor, ağa dokunmuyor ve hiçbir şey üzerinde etkisi yok — ama yine de konsolda bir satır ve hâlâ orada olduğunu söylemek dürüstlüktür.

## v10.58.0 (2026-09-21) — Yapan bir yardımcı, hangi oturumda olduğunu söyleyen bir sekme ve her şeyi içeren tek dosya

_v2.32.78 olarak yayımlandı._

### Değişti
- **Vex’in yapabileceği bir şey istendiğinde Vex artık yapıyor.** “Make an timer for 10 minutes” istendiğinde, bir geri sayımın nasıl çalıştığı hakkında üç paragraf, var olmayan bir düğme için adımlar ve ardından alarmları açıklama teklifiyle yanıt verdi. Saat, süre ayrıştırıcısı ve Windows uyandırması baştan beri elindeydi.
  - Vex artık cümleyi **herhangi bir model danışılmadan önce** tanıyor: anında, hiçbir model yüklü değilken çalışır ve bir kullanıcı arayüzü uyduramaz, çünkü o yolda hiçbir şey bir şey uyduramaz. “Make a timer for 10 minutes”, “set a 25 min countdown”, “start a 20 minute timer”, “hey vex start a stopwatch”, alarmlar ve hatırlatıcılar basitçe gerçekleşiyor ve Vex bunu tek satırla söylüyor.
  - Yine de **modele sormak** için bir basış var, çünkü tanıma kesin değil, güvenilirdir.
  - Yapamadığında bunu tek cümleyle söylüyor. Hızlı eylemler kendi başarısızlıklarını yutuyordu; bu yüzden başlamayan bir zamanlayıcı başlamış gibi görünüyordu.
- **Bir sekme artık hangi oturumda olduğunu söylüyor.** Bir kapsayıcı sekmesi ve sıradan bir sekme aynı görünüyordu — bir parolanın yanlış olana girmesinin ve “neden bundan çıkış yaptım” sorusunun gizem olmasının yolu buydu. Kapsayıcılar, Tor yönlendirmeli ve proxy yönlendirmeli sekmeler her biri renkli bir kenar giyiyor ve üzerine gelince hangi oturumda olduklarını söylüyor. Yalıtım özelliğin bütünüydü ve görünmezdi.
- **Site kuralları yönlendirmeden fazlasını yapıyor.** İnsanların gerçekten en çok istediği kural bir IP adresi hakkında hiç değil: **bu site her zaman iş kapsayıcımda açılsın**. İki hesap, çıkış yapmadan, hatırlamadan. Her kural ayrıca sitenin **her zaman sessiz** olduğunu ve **asla uyumasına izin verilmediğini** söyleyebilir.
- **Basabileceğiniz şeyler** (`Ctrl+Shift+K`). Vex altmıştan fazla tuşa yanıt veriyor ve bir sürümde on bir tane kazandı; hepsi kimsenin gidip okumaya karar vermediği bir ayarlar sayfasında listeleniyor — yani tuşlar vardı ve kullanılmadan kalıyordu. Artık yaptığınız şeyin üstünde, gruplanmış olarak beliriyorlar; bulunduğunuz yerde önemli olanlar işaretlenmiş ve başa konmuş. Arkasında hiçbir şey olmayan bir tuş listelenip sessizce bozuk bırakılmak yerine dışarıda bırakılıyor; kendi ayarladığınız biri sizin olarak işaretleniyor. Sayfadaki hiçbir şey yanlışlıkla değiştirilemez ve değiştirenin ekranına bir geçit var.
- **Her şeyi yedekleyin ya da geri koyun** (Ayarlar → Veri ya da `Ctrl+K`). Bir kurulum kodu dekoru taşır. Bu, geri kalanı taşır: notlar, oturumlar, tuş atamaları, site kuralları, paneller, bütün görünüm. Kayıtlı oturum açma bilgileri ve kimlik doğrulayıcı kodları dosyada **asla** yoktur — Vex’in içinde şifreli olarak yaşarlar ve oradan hiç okunamazlar; bunları içeren bir yedek, indirilenler klasöründe duran bir parola dosyası olurdu. Yapay zekâ sohbetleriniz yalnızca kutuyu işaretlerseniz girer. Bir geri yükleme, bir şeyi değiştirmeden önce dosyanın neyi içerdiğini söyler, okuyamadığı bir girdiyi geri kalanından vazgeçmek yerine atlar ve Vex’i kapatana kadar **geri alınabilir**.
- **“Vex neden yavaş” artık sesini çıkarıyor.** Bir tanı ekranı yalnızca açmayı düşünenlere yardım eder — ve bakmayı biliyorsanız cevabı zaten yarı yarıya biliyordunuz. Bir şey bir dakikadır açıkça sorun olduğunda Vex bunu bir kez, onu düzelten düğmeyle söylüyor. İkinci bir görüş bekliyor, baktığınız sekmeden asla söz etmiyor, saatte bir şey söylüyor ve “şimdi değil”de dört saat susuyor. Açık bir yönlendirme, çalışan bir oyun ya da uyanık tutmayı seçtiğiniz paneller hakkında asla yorum yapmaz: seçimleriniz hakkında yorum yapan bir tarayıcı, insanların kapattığı bir tarayıcıdır.
- **Yapay zekâ geçmişi tarihli ve gruplu.** Sohbetlerin hiç saati yoktu, bu yüzden liste yalnızca “12 ileti” diyebiliyor ve hiçbir şeye göre sıralanamıyordu. Her ileti artık ne zaman söylendiğini taşıyor; liste Bugün, Dün, Bu hafta daha önce ve aya göre gruplanıyor, bugünküler için saat, eskiler için tarih ile. Sabitlenmiş sohbetler ad ile yer için kavga eden bir önek yerine kendi başlıklarını alıyor ve Sabitle / Yeniden adlandır / Nota çevir, her biri tam bir satır almak yerine üzerine gelince beliren tek bir bantta duruyor.
- **`Ctrl+K` artık bir özelliği yalnızca adına göre değil, ne yaptığına göre buluyor.** “make text bigger” ya da “hide my ip for one site” yazmak, ikisi de var olduğu hâlde eskiden hiçbir şey bulmuyordu.
- Sekmeyi uyanık tutma kartı artık bir görüşmedeki, mikrofonu ya da kamerayı kullanan veya ses çalan bir sekmenin zaten asla uyutulmadığını söylüyor — böylece kimse savunma amaçlı “Asla”yı seçip boşuna bir gigabayt tutmuyor.

### Düzeltildi
- **Özellik araması, kendisi için yazılmış tek alana hiç bakmıyordu.** Her katalog girdisi `phrases` taşır — bir özelliğin adını bilmeyen birinin kullanacağı sözcükler — ve arama adı, açıklamayı, kategoriyi ve kısayolu okuyor, bunları okumuyordu. 226 girdilik düz İngilizce arama terimleri bir kez bile aranmamıştı.
- **“How do I…?” emirleri yanıtlıyordu.** Bir zamanlayıcı *yapması* istendiğinde rehber cümleyi Vex hakkında bir soru olarak eşleştiriyor ve bir özelliği açıklayan bir kart gösteriyordu. Vex’in yerine getirebileceği bir yönerge artık onu nasıl yerine getireceğinin açıklamasını yeniyor.
- `Ctrl+K`’de başarısız olan bir komut konsolda işlenmemiş bir ret ve ekranda sessizlik üretiyordu; artık neyin ters gittiğini söylüyor.
- Yapay zekânın kendi istemleri artık Vex’in düğmelerini, menülerini ve kısayollarını tarif etmeyi, bir tane uydurmayı, bir telefon ya da başka bir program için adımlar vermeyi, istenmeden gündelik bir şeyin ne olduğunu açıklamayı ya da başka bir şeyi açıklama teklifiyle bitirmeyi yasaklıyor.
- “Daha derine in” artık bir şeyin gerçekleşmiş olduğu bir yanıtın altında görünmüyor.

## v10.54.2 (2026-09-21) — Aramalarınız arasında uyuyan bir panel, site başına kurallar ve neden yavaş olduğunu söyleyen tek bir ekran

_v2.32.77 olarak yayımlandı._

### Değişti
- **Bir panelin ne kadar uyanık kalacağı, bir sekmeninki gibi seçilir** (kenar çubuğundaki bir simgeye sağ tıklayın → **Uyanık tut…**, ya da Ayarlar → Performans). Eskiden bir onay kutusuydu: sonsuza kadar uyanık ya da değil. Şimdi sekmelerin hep sahip olduğu kartın aynısı var — bir saat, beş, on iki, yirmi dört, yazdığınız bir sayı ya da siz söyleyene kadar asla — ve yalnızca bir panelin sunabileceği bir seçenekle:
  - **Yalnızca bir aramadayken.** Vex, mikrofonu tutan ya da ses çıkaran bir paneli uyutmayı zaten reddeder; bu seçenek buna dayanır: arama boyunca uyanık, günün geri kalanında uykuda. Discord’un gigabaytı tam burada gider ve tutulmasının nedeni de buydu: “uyanık tut” bütün gün demekti, çünkü başka bir şey söylemenin yolu yoktu.
  - Discord bellek bildirimi artık bunu doğrudan sunuyor, üstelik rakamın ekranda göründüğü anda. Yararlı olacağı anda karşınıza çıkan bir ayarı kullanırsınız.
  - Ayarlar’daki her panelin satırı artık bir onay işareti göstermek yerine neye ayarlı olduğunu söylüyor, çünkü “uyanık” artık beş yanıt taşıyor ve bir onay işareti bunların yalnızca ikisini söyleyebilir.
  - Uyanık kalacak şekilde ayarlanmış ama zaten uykuda olan bir panel, ayarın panel bir sonraki açılışına kadar sessizce hiçbir şey ifade etmemesi yerine, o anda yeniden kurulur.
- **Her zaman bir yoldan geçen siteler** (`Ctrl+K` → **Site Kuralları**, ya da Ayarlar → Özel yönlendirme). Bir site adı verin; oraya giden her sekme, Tor üzerinden ya da sahip olduğunuz bir vekil sunucu üzerinden yönlendirilen kendi oturumunda açılsın — her seferinde, siz hatırlamak zorunda kalmadan ve gezintinizin geri kalanını yönlendirmeden. `example.com` için yazılan bir kural `mail.example.com` adresini de kapsar.
  - Güvenli tarafta kapanır. Yönlendirilen oturum Vex başlarken hazırlanır ve bir Tor oturumuna, tek bir istek bile çıkamadan, reddeden bir geri döngü vekili kurulur. Tor henüz ayakta değilse site yüklenmez; sessizce doğrudan yüklenmez — bir kuralı kural olmamasından daha kötü yapan hata tam da budur.
  - Bilerek bir kapsayıcıda açtığınız sekmeye dokunulmaz. Bir kural yalnızca sıradan bir sekmeyi taşır.
  - Ekranda açıkça söylenir: yönlendirilen oturum ayrı bir çerez kavanozudur, bu yüzden bir kuralla açılan sitede oturumunuz kapalıdır. Tor için amaç budur; bir vekil için bilmeye değer.
- **Vex şu anda neden yavaş?** (`Ctrl+K`). Yanıt zaten Vex’in içindeydi, ama tam gerektiği anda kimsenin uğramadığı dört yerde: işlem listesi hangi işleyicinin işlemciyi yaktığını, sekme listesi o sayfanın hangisi olduğunu, yönlendirme ekranı her isteğin uzun yoldan gidip gitmediğini, grafik yoklaması da kartı bir oyunun tuttuğunu bilir. Her biri tek başına bir sayıdır. Birlikte bir cümle olurlar; en ağır olan başta, her biri sorunu çözen düğmeyle birlikte — o sekmeye git, o panelin uyumasına izin ver, yönlendirme ayarlarını aç.
  - Başarısız olmuş bir ölçümün üstüne asla “her şey yolunda” demez: okunamayan bir işlem listesi, nedeniyle birlikte kendi başına bir yanıttır.
- **Vex’in ne kadar büyük olduğu ve ne kadar sıkı dizildiği** (`Ctrl+K` → **Yazı tipi**). Sayfa yakınlaştırması bir sayfayı büyütür ama Vex’in kendi sekme şeridine, kenar çubuğuna, menülerine ve ayarlarına hiç dokunmamıştır — oysa on iki pikselli yazıyı okuyamayan biri tam olarak bunların büyümesine ihtiyaç duyar. Yüzde on küçükten yarı yarıya büyüğe beş boyut, simgeleri, dolguları ve kenarlıkları da beraberinde götürerek; ve dört satır yoğunluğu, çünkü satırlar bir dizüstü için dolgulanmamışsa büyük bir ekran bir listeden çok daha fazlasını sığdırır. Bir web sayfası tutan panel doğal boyutunu korur: bir sayfanın kendi yakınlaştırması vardır ve burada ölçeklemek onunla çatışırdı.
- **Bir kurulum kodu artık görünümün tamamını taşıyor.** Paneller, kısayollar ve temayı taşıyordu — bir kurulumun çoğunu ama görünümün hiçbirini, bu yüzden aynı koda sahip iki kişi farklı tarayıcılar görüyordu. Artık kaplamayı ve yazı tipini de taşıyor. Bundan önce paylaşılan kodlar hâlâ çalışır; yalnızca görünüm taşımazlar ve bu Vex’te bulunmayan bir desen ya da yazı tipi uygulanmak yerine atlanır.
- **Bir indirmeyi biter bitmez açın**; başta bir kez sorulur — yani bunu beklediğinizi bildiğiniz anda, çoktan kaybolmuş bir bildirimi yakalamaya çalışmak yerine. Bir indirmenin gerçekten izlendiği araç çubuğu açılır menüsünde ve panelde bulunur. Güvenlik denetimini aşmanın bir yolu değildir: bu şekilde açılan bir yükleyici, elle açılanla tam olarak aynı biçimde sorgulanır — kim imzaladı, nereden geldi — çünkü bir dosyayı beklemek, imzasız bir programı çalıştırmaya onay vermek değildir.
- **“Bu ne kullanıyor?” artık Vencord eklentilerinin neye mal olduğunu söylüyor**, yalnızca kaçının çalıştığını değil. Otuz dört eklentinin çalışması sonuçsuz bir olgudur; “MessageLogger son on dakikada 18.000 olay boyunca 4,2 saniye harcadı” ise üzerine harekete geçilebilecek bir şeydir. Rakamlar, her eklentinin başlangıcını, olay işleyicilerini ve bağlam menülerini zamanlayan ve artık bunun için sade bir anlık görüntü yayımlayan PluginProfiler’dan gelir. O olmadan satır, nasıl açılacağını söyler — ve ölçülebilir hiçbir maliyet olmadığında bunu da, suçluluk ima etmek yerine, söyler.
- **Yapılmış ama bulunamayan iki şey** artık Kitaplık’ta ve aranabilir: Vex’in tamamı için özel yönlendirme ve arayüz boyutu.

### Düzeltildi
- **Her şeyi Tor ya da bir vekil üzerinden yönlendirmek yeniden başlatmadan sonra korunmuyordu.** Ayar, her gezinti oturumunu temsil eden bir adla kaydedilmişti ve kendi başına bir oturummuş gibi geri yükleniyordu — bu yüzden yeniden başlatma, hiçbir şeyin kullanmadığı bir oturumu vekile yönlendirip her gerçek sekmeyi doğrudan geri getiriyordu. Özellikle v2.32.76 ile birlikte gelmişti; artık yeniden her oturuma uygulanıyor, güvenli tarafta kapanarak, geri yüklenen hiçbir sayfa istek yapamadan önce.
- Ayarlar’daki “Uyanık tut” satırı hâlâ artık var olmayan onay kutularını anlatıyordu.

## v10.50.4 (2026-09-21) — Vex’in tamamı tek bir yoldan ve daha yeni özellikler insanların aradığı yerde

_v2.32.76 olarak yayımlandı._

### Değişti
- **Özel yönlendirme: Vex’in yaptığı her şey, Tor üzerinden ya da kendi vekil sunucunuz üzerinden** (`Ctrl+K` → **Özel Yönlendirme**, ya da Ayarlar → Özel yönlendirme). Yönlendirme kapsayıcı başına zaten vardı; bu, “bu hesap Tor’dan geçsin” için doğru biçim ama insanların VPN derken kastettiği şey için yanlış biçimdir. Bu ise tek bir yolu her sekmeye ve her kapsayıcıya birden uygular ve yeniden başlatmadan sonra geri koyar.
  - **Üstelik denetlenebilir.** Denetle düğmesi, internetin yol *üzerinden* hangi adresi gördüğünü sorar, aynı soruyu hiç yolu olmayan bir oturumdan yeniden sorar ve ikisini size gösterir — çünkü trafiğin yönlendirildiği iddiasının hiçbir değeri yoktur, yan yana iki adresin ise değeri vardır. Kendi makinenizdeki bir vekilin kendi adresinizle çıkması, başarısızlık denmek yerine açıklanır.
  - Bir yol açıkken araç çubuğunda bir işaret görünür: unuttuğunuz bir yol, açıklaması olmayan yavaş gezintidir.
  - Ekranın kendisinde açıkça söylenir: Vex bir VPN hizmeti değildir ve bir tane çalıştırmaz. Tarayıcıyı Tor üzerinden ya da zaten sahip olduğunuz bir vekil üzerinden yönlendirir. Vex dışındaki her şey her zamanki yoldan gider.
  - Göndermeden önce uçtan uca sınandı: yerel bir vekil üzerinden (vekil her isteği gördü ve doğrudana geri geçildikten sonra hiçbir şey görmedi) ve Tor üzerinden (başlaması 14 saniye; ardından internet bu makine yerine bir Tor çıkış düğümü gördü).
- **Ayarlar artık daha yeni özellikleri biliyor.** Tema, kaplama ve yazı tipi seçicilerini ve Kitaplık’a bir girişi barındıran bir **Görünüm** grubu ve bir **Özel yönlendirme** grubu — her biri gerçek ekranı açan bir düğme, çünkü bir doku, bir yazı tipi ve bir palet açılır listede gösterilemez. İnsanlar bunları Ayarlar’da arar; şimdiye kadar yalnızca `Ctrl+K` içinde yaşıyorlardı.

### Düzeltildi
- Yönlendirme denetimi, yönlendirilmemiş bir bağlantıya “trafik taşıyor” diyordu — artık hiçbir şeyin yönlendirilmediğini söylüyor, ki asıl anlamı budur.

## v10.46.6 (2026-09-21) — Kaplamalar, Times New Roman, son sekmeye tek tuşla dönüş ve bunu sadece yapan bir yapay zekâ

_v2.32.75 olarak yayımlandı._

### Değişti
- **Kaplamalar: Vex’in yalnızca rengi değil, neyden yapıldığı** (`Ctrl+K` → **Kaplama**). Otuz yedi tema vardı ve hepsi düz renkti. Bir kaplama herhangi bir temanın ve herhangi bir tarayıcı görünümünün üstünde durur ve üç ayrı seçimdir:
  - **Doku** — on dokuz tane, Vex’in kendi yüzeylerine çizilmiş: noktalar, milimetrik kâğıt, çizgili, çapraz, çapraz tarama, petek, üçgenler, devre, dalgalar, balık pulu, gece gökyüzü, konfeti, kontur, ekose, sepet örgüsü, şevronlar, tuğla işi, terrazzo ve kâğıt dokusu. Her biri temanın kendi mürekkebiyle, seçtiğiniz bir şiddette (güçlükle seçilir → kalın) çizilir; böylece renklerinizle çatışmak yerine onları izler. Web sayfalarına asla dokunulmaz.
  - **Biçim** — yumuşak, keskin, yuvarlak, çizilmiş (kalın ana hatlar) ya da yoğun; köşeleri, kenarlık kalınlığını ve öğeler arasındaki boşluğu değiştirir.
  - **Işık** — normal gölgeler, düz, yükseltilmiş ya da temanın vurgu renginde bir hale.
  - Seçicideki her örnek sunduğu şeyle çizilir, çünkü bir isim listesi size hiçbir şey söylemez.
- **Times New Roman artık varsayılan yazı tipi.** Vex geometrik bir sans ile geliyordu; artık her yerde — paneller, menüler, yeni sekme sayfası — bir serif giyiyor. Kod yazı tipi değişmedi, böylece hizalanması gereken her şey hâlâ hizalanıyor ve 23 yazı tipinin tamamı (Segoe UI, Calibri, Georgia, Garamond, Verdana…) hâlâ `Ctrl+K` → Yazı tipi içinde bir tık uzakta, Outfit’i geri isterseniz o da dahil.
- **Az önce bulunduğunuz sekmeye tek tuşla dönüş** — `Alt+Q`, ve geri dönmek için yeniden basın. Alt+Tab’ın yararlı yarısı, hiçbir şeye basılı tutmadan. Her şey gibi yeniden atanabilir.
- **Yeniden atanan her kısayol artık bir sayfayı okurken çalışıyor.** Bir sayfanın içinden yalnızca sabit bir tuş listesi yukarı iletiliyordu; bu yüzden v2.32.72’de eklenen on bir `Ctrl+Alt` kısayolu — ve kendinizin yeniden atadığı her şey — odak Vex’in kendi arayüzünde olmadıkça hiçbir şey yapmıyordu. Kayıt defteri artık pencereye hangi tuşlara yanıt verdiğini bildiriyor ve bu liste her yeniden atamayı izliyor.

### Düzeltildi
- **Bir emir yerine getirilir, açıklanmaz.** Bir şey yapması istendiğinde Vex AI, bunu kendiniz nasıl yapabileceğinizi anlatırdı ya da önce size onu öğretirdi. Artık açıkça söyleniyor: bir talimat bir emirdir — yap, ne olduğunu tek satırda söyle ya da yapamayacağını tek cümlede söyle. Giriş yok, kimsenin istemediği öğüt yok. Ajanın özeti, nasıl çalıştığı değil, ne yaptığıdır.
  - Ajana ulaşmak için de aynısı: “sil”, “temizle”, “kopyala”, “dışa aktar”, “kur”, “arşivle”, “kaydet”, “gizle”, “yakınlaştır” ve otuz sıradan fiil daha, bir şeyin iş olup olmadığına karar veren listede eksikti; bu yüzden o emirler soru gibi yanıtlanıyordu.
- **Yapay zekâ paneli daha derli toplu.** Üç önerilen istem, bir sohbetin bütün ömrü boyunca her konuşmanın altında duruyordu (bunlar boş bir sohbet içindir ve bir yeniden çizim, onları gizleyen koddan sonra geri koyuyordu); Dışa aktar ve Temizle, yazdığınız kutunun altında kendilerine ait bir satır alıyordu ve artık başlıkta simge; “Vex AI” ekranda iki kez yazılıydı. Bir yanıtın içindeki başlıklar, listeler, alıntılar, tablolar ve satır içi kodun artık birbirine karışmak yerine kendi aralıkları var.
- v2.32.73 ile gelen yinelenmiş bir stil sayfası bağlantısı.

## v10.42.8 (2026-09-21) — Gerçekten ilerleyen indirme ilerlemesi

_v2.32.74 olarak yayımlandı._

### Düzeltildi
- **İndirme çubuğu aktarımın tamamı boyunca %0’da duruyor, sonra bitmiş olarak zıplıyordu.** Electron’un her parçada bildirdiği ilerleme İndirilenler paneline gidiyor, başka hiçbir yere gitmiyordu — araç çubuğu düğmesine bir indirmenin başladığı ve bittiği söyleniyor, arada hiçbir şey söylenmiyordu. Artık her parçadan haberdar edilir; böylece çubuk doluyor, yüzde yükseliyor ve alttaki satır, olurken, ne kadarın ne kadarından, ne hızla ve ne kadar süre kaldığını söylüyor.
- **Açılır liste artık saniyede onlarca kez kendini yeniden kurmuyor.** Her parçada atılıp yeniden kuruluyordu; çubuğun hiç animasyonlanmamasının ve Duraklat ile İptal’in ıskalayabilmesinin nedeni buydu: bastığınız düğme, basma ile tıklama arasında değiştirilmiş oluyordu. Artık saniyede en çok beş kez yeniden çiziliyor ve bir yeniden çizim yeni bir satır kurmak yerine zaten orada olan satırdaki sayıları değiştiriyor.
- **“Neredeyse bitti” artık “başladı” anlamına gelmiyor.** Kalan süre ondan az olan her şey için gösteriliyordu; hızlı bir bağlantıda bu indirmenin tamamıdır; artık son üç saniye ve ondan önce saniyeleri düzgünce geri sayıyor.
- **Açılır listeyi kapatmak “şimdi değil” demektir, “asla” değil.** Bir indirme sırasında kapatmak, kapattığınızı hatırlayan bayrak hiç temizlenmediği için onun kendi kendine bir daha açılmasını durduruyordu. Hiçbir şey inmediğinde temizleniyor.

## v10.41.3 (2026-09-21) — Bilmediğinizi Vex’e sorun, Kitaplık’ta raflar ve Vex’in giydiği yazı tipi

_v2.32.73 olarak yayımlandı._

### Değişti
- **Kitaplık’ın en üstünde “Bilmediğinizi Vex’e sorun”.** Arama yalnızca adını zaten bildiğiniz bir özelliği bulur; hiç duymadıklarınız için işe yaramaz. Bu, sorunu ele alır: ne YAPMAYA çalıştığınızı söyleyin — “sürekli sekme kaybediyorum”, “bir sitede iki hesap”, “Discord bütün RAM’imi kullanıyor” — ve Vex, bunların özellikleriyle yanıt verir, aynı kartlar olarak çizilmiş, her biri Aç / Göster / Vex’e bunu sor ile. Hiçbir şey eşleşmediğinde bunu açıkça söyler ve soruyu, Vex’in kendi özellik listesi verilmiş olan yapay zekâya devreder.
  - Altında, Vex’in sizin kullandıklarınıza dair kendi kaydından **hiç çalıştırmadığınız üç şey** — her gün farklı ve denediğiniz anda kaybolur.
- **Her özellik artık bir rafta.** On iki kategori 221 özelliği dosyalamıştı ve “Üretkenlik”i tek bir başlık altında elli dört şey olarak bırakmıştı. Her alanın içinde artık adlandırılmış raflar var — *Hatırlatıcılar ve alarmlar*, *Bellek ve uyku*, *Kaldığınız yere geri dönme*, *Hangi model ve sizin hakkınızda ne biliyor* — toplam 35 tane. Arama yine düz bir liste verir, çünkü o noktada ne istediğinizi zaten söylemişsinizdir.
- **Vex’in giydiği yazı tipini siz seçersiniz** (`Ctrl+K` → **Yazı tipi**). Segoe UI ve Calibri’den **Times New Roman**, Georgia, Garamond ve Cambria’ya yirmi üç yazı tipi — ve kod için beş tane daha, ayrı tutulmuş, böylece geri kalanı ne giyerse giysin kısayollar ve sayı sütunları hâlâ hizalanır. Her panel, menü, düğme ve yeni sekme sayfası onu izler; sayfalar olması gerektiği gibi kendi tipografilerini korur.
  - Sunulan her şey zaten makinede var. Hiçbir şey indirilmez, bu yüzden çevrimdışı çalışır ve sizi okunamaz bir arayüzle bırakamaz.
  - Seçicideki her yazı tipi kendi biçiminde çizilir, çünkü bir yazı tipinin adı, onda okumak isteyip istemediğiniz hakkında hiçbir şey söylemez.

## v10.39.3 (2026-09-20) — On bir kısayol daha ve istediğiniz her şey için bir tuş

_v2.32.72 olarak yayımlandı._

### Değişti
- **Komut çubuğundaki her şeyin artık bir klavye kısayolu olabilir.** Kısayollar ekranının altında bir kutu var: Vex’in yapabildiği 250 kadar şey içinde arayın, birini seçin, tuşlara basın. Listede **Kendi kısayollarınız** altında görünür ve onu yeniden kaldırmak için bir × vardır. Başka bir şey yapan bir tuş sessizce çalınmak yerine adıyla reddedilir.
- **Tuşu olmayan on bir özelliğin artık bir tuşu var**, hepsi Ctrl+Alt üzerinde (hâlâ yer olan yerde) ve hepsi yeniden atanabilir:
  - `Ctrl+Alt+B` Kitaplık · `Ctrl+Alt+E` Vex’in yapabildiği her şey · `Ctrl+Alt+T` Çalışan görevler · `Ctrl+Alt+J` İndirilenler · `Ctrl+Alt+P` Girişler ve 2FA kodları · `Ctrl+Alt+F` Odak modu · `Ctrl+Alt+C` Seçimi Notlar’a kırp · `Ctrl+Alt+W` Bu sayfayı değişiklikler için izle · `Ctrl+Alt+X` Araç kutusu · `Ctrl+Alt+K` Sonra Oku’ya kaydet · `Ctrl+Alt+G` Bu sayfayı çevir.
- **Kısayollar paneli artık düzenleyici.** Eskiden yazılı bir tuş listesiydi; bu da siz değiştirdikten sonra bile varsayılanları göstermesi ve üzerindeki hiçbir şeyin değiştirilememesi demekti. Artık Ayarlar’daki aynı düzenlenebilir ekran; bu yüzden gösterdiği şey tuşlarınızın gerçekten ne olduğudur.

### Düzeltildi
- Arkasında hiçbir şey olmayan bir kısayol artık tuşu yutmuyor: onu isteyen başka her şeye iletiliyor.

## v10.37.3 (2026-09-20) — Paneli kapattığınızda bir yanıt yazılmaya devam eder

_v2.32.71 olarak yayımlandı._

### Düzeltildi
- **Yapay zekâ panelini kapatmak artık yanıtı durdurmuş gibi görünmüyor.** Hiçbir zaman durdurmadı — istek sürdü ve yanıt kaydedildi — ama paneli yeniden açmak ileti listesini yeniden çiziyordu ve bu, yanıtın yazıldığı balonu da beraberinde götürüyordu. Ondan sonraki her sözcük ekran dışında bir yere düşüyordu; bu yüzden yanıtın tamamı gelene kadar görülecek bir şey yoktu: ölü bir sorudan ayırt edilemezdi. Balon artık, aynısı olarak, geri konuyor; böylece yarım yazılmış bir yanıt gözünüzün önünde sürüyor.
  - Aynısı yanıt sırasında sekme değiştirmek için de geçerli. Her sohbet kendi sekmesine aittir: ayrılırsanız yanıt yazılmaya devam eder; geri dönerseniz orada, hâlâ sürmektedir.
- **Panel kapalıyken araç çubuğu düğmesi Vex’in çalıştığını söylüyor** — atan bir nokta ve ipucunda “Vex yanıtlıyor”. Siz başka yerdeyken yanıt geldiğinde nokta yeşile döner ve bir satır yanıtladığını söyler.

## v10.36.3 (2026-09-20) — Arama sırasında hiçbir şey uyumaz ve hareketli emojiler video olmaktan çıkar

_v2.32.70 olarak yayımlandı._

### Düzeltildi
- **Bir sesli arama bellek kazanmak için asla kesilmez.** Bir paneli uyutmak yaptığı işi bitirir; bu yüzden bir paneli kendiliğinden uyutan her yol artık önce onun bir aramada olup olmadığını, mikrofonu ya da kamerayı tutup tutmadığını veya herhangi bir ses çıkarıp çıkarmadığını soruyor — ve çıkarıyorsa bekliyor. Bu, “kapalı tut” tutuşlarını, Bitir’i ve Şimdi uyut’u, zaten dikkatli olan boşta uyutmanın yanı sıra kapsar. Elle uyuttuğunuz bir panel hâlâ sizin kararınızdır; Vex’in kendiliğinden uyuttuğu bir panel bir aramayı kesmez.
- **Daha hafif Discord, hiçbir şey yerine durağan resmi getiriyor.** Eskiden hareketli bir emoji, avatar ya da çıkartma için isteği iptal ediyor ve Discord’un kendi durağan sürümünü çizmesine güveniyordu; bunun olmadığı yerde süs sadece eksik kalıyordu ve bu Discord’un bozuk olması gibi görünüyordu. Artık aynı CDN’den aynı resmi durağan olarak istiyor, böylece her zaman geliyor — sadece makinenizin bütün gün çözdüğü bir video olmaktan çıkıyor. İnsanların paylaştığı GIF’lere, eskiden olduğu gibi dokunulmuyor.

### Değişti
- **“Bu ne kullanıyor?” Vex’in hareketli emojiler için zaten ne yaptığını söylüyor.** Discord panelinde artık bunun için bir satır var — *zaten durağan* ya da *hareketli* — ve kapalıyken, onu açan ve paneli yeniden yükleyen bir düğme. Daha hafif Discord açık olarak gelir; bu yüzden çoğu kişi için bunu söyleyen satır budur.
- *Bakmadığınızda uyumasına izin ver* düğmesi artık önemli kısmı söylüyor: bir aramada ya da bir şey çalarken hâlâ asla uyumaz.

## v10.33.8 (2026-09-20) — Vex’in yapabildiği her şey tek yerde; işlem listesi yerine bir uygulamanın içindekiler; izleyebileceğiniz indirmeler

_v2.32.69 olarak yayımlandı._

### Değişti
- **Vex’in yapabildiği her şey — Kitaplık, ikinci sekme.** Alana göre gruplanmış, aranabilir tek bir başvuruda 220 özelliğin tamamı. Her biri ne işe yaradığını, sonra gerçekten yardımcı olan paragrafı söyler: ne zaman başvurulacağı ve insanları şaşırtan kısım (uyuyan bir sekme gerçekten işlemini geri verir; üçüncü site geçişi YouTube’un neden karardığıdır; Discord, var olan en ağır paneldir). Her girdinin üç düğmesi vardır — **Aç**, **Göster** (gerçek denetimi işaret eder) ve **Vex’e bunu sor**; bu, o girdiyi gerçekler olarak kullanarak yardımcıya sorar, böylece yanıt bir modelin belleği yerine sizin Vex’iniz hakkında olur.
  - Kitaplık düğmesi, gizlendiği herkes için kenar çubuğuna geri geldi ve `Ctrl+K` → **Vex’in Yapabildiği Her Şey** doğrudan oraya gider.
  - Rehberin verdiği her yanıt artık, Kitaplık’ı o özellikte açan **Girdinin tamamını oku** ile bitiyor.
- **“Bu ne kullanıyor?” artık kendisine sorulan soruyu yanıtlıyor.** Bir sekmeye ya da kenar çubuğu paneline sağ tıklayın; Çalışan görevler **o uygulamada** açılır: ne kadar JavaScript tuttuğu, sayfanın ne kadar büyüdüğü, ne çaldığı, içine hangi başka sitelerin gömülü olduğu, diskinizde ne kadar tuttuğu — ve Discord için kaç Vencord eklentisinin çalıştığı. Altında, bu sayıları gerçekten düşüren birkaç şey, her biri onu yapan düğmeyle birlikte: yeniden yükle, önbelleğini temizle, bakmadığınızda uyumasına izin ver.
  - İşletim sistemi işlemlerinin düz listesi, Bitir ve tutuşlar değişmeden **Vex’in çalıştırdığı her işlemi göster** arkasında hâlâ duruyor — ama artık “Discord ne yapıyor” sorusunun yanıtı değil.
- **Bir indirme, inerken kendini gösterir.** Birini başlatmak indirmeler düğmesini bir çubukla açar: ne kadarın ne kadarından, ne hızla ve ne kadar süre kaldığı; satırda **Duraklat** ve **İptal** ile. Düğmenin kendisi bir ilerleme çubuğu taşır ve bir indirme sürerken açılır listeyi kapatmak “şimdi değil” demektir — sonraki dosya onu yeniden açtırmaz.

### Düzeltildi
- **İkinci yapay zekâ düğmesi gitti.** Bir iş profili seçen herkesin yan yana, tamamen aynı şeyi yapan iki parıltısı vardı: gerçek yapay zekâ düğmesi ve tarayıcı görünümlerinin onu gizlediği zamanlarda iş profilinin geri eklediği düğme. Görünümler onu v2.32.66’da gizlemeyi bıraktı, bu yüzden yedek kaldırıldı.
- **İndirmeler açılır listesi sayfaya tıkladığınızda kapanıyor.** Bir sayfanın içindeki tıklama Vex’in kendi penceresine asla ulaşmaz; bu yüzden açılır liste, düğmeye yeniden tıklayana kadar öylece duruyordu.
- **Gizli olan araç çubuğu düğmeleri artık gerçekten gizli.** Sınıflarındaki `display: flex`, tarayıcının kendi kuralını sessizce eziyordu; bu yüzden geliştirici araçları düğmesi geliştirici modu kapalıyken görünüyordu ve site kuralları işareti yalnızca geri tutulan sitelerde değil, her sitede görünüyordu.
- **Kenar çubuğu simgeleri pencereye sığıyor.** Kısa bir pencerede son birkaç panel, kaydırma çubuğu ve söyleyen hiçbir şey olmadan, alttan taşıyordu. Artık sığacak kadar küçülüyorlar ve bu bile yetmediğinde ray kaydığını söylüyor.

## v10.28.8 (2026-09-20) — Çalışan görevler, seçtiğiniz bir tur, Firefox’un kendi renkleri ve yazıldıkça kendini biçimlendiren yanıtlar

_v2.32.68 olarak yayımlandı._

### Değişti
- **Çalışan görevler** — belleği gerçekte neyin kullandığı ve onu sonlandırmanın bir yolu. Herhangi bir sekmeye ya da panele sağ tıklayın → **Bu ne kullanıyor?**, ya da Ctrl+K → *Çalışan Görevler*. Vex’in çalıştırdığı her işlem, en büyüğü başta ve gerçekte ne olduğuyla adlandırılmış (“Panel: Discord — 1.013 MB”, “uBlock Origin — arka plan”, “GPU işlemi”), sonlandırılabilenlerde **Bitir** ile.
  - Sonlandırmak, kendiniz kapatmadığınız hiçbir şeyi kaybettirmez: bir sayfa uyutulur ve kaldığınız yerden geri gelir, bir panel kapatılır, bir uzantı kapatılır.
  - Ya da onu sonlandırın **ve kapalı tutun** — bir saat, sekiz saat ya da geri izin verene kadar. Geri gelen tutulmuş bir şey sessizce yeniden uyutulur, asla engellenmez ve en üstteki çubuk neyin tutulduğunu, geri izin vermek için tek tıkla söyler.
  - Vex’in kendi işlemleri listelenir ama sonlandırılamaz ve her biri nedenini söyler: ana işlem Vex’in kendisidir, Chromium hizmetlerini hemen yeniden başlatır ve baktığınız sayfa için önce başka bir sekmenin açık olması gerekir.
- **“Hızlı bir tur at” artık “Tur at” ve hangisini istediğinizi soruyor.** *Hızlı tur*, her gün kullandığınız denetimleri adlandıran dakikadır. *Tam tur* önce hangi alanları önemsediğinizi sorar — sekmeler, yapay zekâ, gizlilik, okuma, üretkenlik, medya, paneller, girişler, görünümler, geliştirici araçları, verileriniz, yalnızca Vex’te — her birinde kaç özellik olduğuyla, ve gezintiyi işaretlediklerinizden kurar. Alanları bir sonraki sefer için hatırlar.
- **Firefox’un kendi renkleri artık bir tema.** *Firefox Açık* ve *Firefox Koyu*, tema seçicide (Ctrl+Shift+Y) ve kurulum sihirbazında; böylece renkler yalnızca Firefox görünümünün biçimiyle değil, kendisiyle de eşleşebiliyor — başlangıç sayfası dahil.
- **Bir yanıt yazılırken kendini biçimlendirir.** Başlıklar, kalın yazı, listeler ve kod eskiden yalnızca model bitirdikten sonra görünüyordu; bu yüzden önemli kısımlar tam da izlediğiniz sırada görünmezdi. Yarım yazılmış bir kod çiti çizim için kapatılır ve sonraki sözcükle yeniden açılır; böylece hiçbir şey geri kalanı yutmaz.
- **Geri tutulan bir site bunu söyler.** Bulunduğunuz site için JavaScript, çerezler ya da diğer sitelerden içerik kapalı olduğunda, araç çubuğunda neyin kapalı olduğunu adlandıran bir işaret belirir — tıklamak anahtarları açar. Ekranda bunu açıklayan hiçbir şey olmadan siyah bir YouTube oynatıcısı tam olarak böyle görünürdü.

## v10.25.0 (2026-09-20) — Resim İçinde Resim düğmeleri yeniden çalışıyor, daha kısa bir kurulum ve insanların gerçekten sorduğu sorulara yanıtlar

_v2.32.67 olarak yayımlandı._

### Düzeltildi
- **Resim İçinde Resim açılır penceresinin düğmeleri hiçbir şey yapmıyordu.** *Sekmeye dön*, *Kapat* ve *Üstte tut* hepsi güvenilmeyen iletiler olarak reddediliyordu, çünkü pencere ön yükleme dosyasıyla tanınıyordu ve bu Electron bir tane bildirmeyi bırakmıştı — bu yüzden Sekmeye dön’e basmak tam olarak “resim gitti ve başka bir şey olmadı” gibi görünüyordu. Düzeltildi ve canlı denetlendi: açılır pencereyi kapatır ve sizi videonun geldiği sekmeye götürür.
- Reddedilen bir ileti eskiden tek kelime edilmeden yutuluyordu; ölü bir düğmenin iz bırakmamasının nedeni buydu. Reddedilmeler artık hangi kanalın ve neden reddedildiğini söylüyor (içinde ne olduğunu asla).

### Değişti
- **Kurulum sihirbazı önce tek şey soruyor: ne kadarını istediğinizi.** *Yalnızca temel şeyler* yaklaşık iki dakikadır — Vex’in nasıl göründüğü, hangi panelleri tuttuğunuz, adınız, arama motorunuz ve bağlantıların burada açılıp açılmayacağı. *Her şey* on birin tamamıdır. Başlık yalnızca hangi adımda olduğunuzu değil, ne kadar süre kaldığını söylüyor ve her adımın hâlâ bir Atla’sı var.
  - Son adım hatırlanmaya değer tek şeyi söylüyor: **Ctrl+K**’ye basın ve ne istediğinizi kendi sözlerinizle söyleyin.
  - Sihirbazı sonradan yeniden açmak yine her adımı sunuyor, kısa yol bir tık uzakta.
- **Vex’e her şeyi kendi sözlerinizle sorun.** İnsanların gerçekten sorduğu soruların on dördü artık bir arama sonucu yerine yazılı bir yanıta sahip: “neler yapabilirsin”, “bütün RAM’imi kullanıyor”, “bir sitede iki hesap istiyorum”, “otomatik oynatmayı durdur”, “reklamları engelle”, “çok fazla sekme”, “bu sayfayı kaydet”, “yapay zekâyı kur”, “benim yerime yap”, “izleniyor muyum”, “parolalarım nerede”, “o kısayol çalışmıyor”, “eşyalarımı yedekle”, “görünümünü değiştir”, “resim içinde resim”. Her biri bir cümleyle yanıtlar, adımları listeler ve onu yapan bir düğme sunar.
  - Bir şikâyet artık bir soru sayılıyor — artık “nasıl yapılır” ile başlaması gerekmiyor.

## v10.23.5 (2026-09-20) — Hata taraması: önce tıklama gerektiren kısayollar, eksik düğmeler, kaymayan bir panel

_v2.32.66 olarak yayımlandı._

### Düzeltildi
- **Kısayollar artık bir sayfayı okurken çalışıyor.** Vex’in kendi tuşları yalnızca Vex’in kendi arayüzünde odak varken duyuluyordu — bu yüzden bir sayfaya tıkladığınız anda yarısı susuyor ve “önce başka bir yere tıklamak” gerekiyormuş gibi görünüyordu. Ctrl+B, Ctrl+H, Ctrl+M ve Ctrl+Shift+T / O / S / Z / A / M / L / H artık hepsi bir sayfanın içinden yanıt veriyor, Ctrl+J ve tema seçici de (ve yeniden atadığınız her tuş, çünkü tuşun kendisi yukarı iletiliyor ve kendi atamanız hâlâ karar veriyor).
  - Sayfaya ait olan şey sayfanın kalır: Ctrl+S, Ctrl+P, Ctrl+A, Ctrl+C, geliştirici araçları tuşları ve kendi bul özelliği olan bir sitede Ctrl+F.
- **Yapay zekâ paneli ve Bölünmüş görünüm, tarayıcı görünümlerinde araç çubuğuna geri döndü.** Vex’in kendi arayüzünün geri kalanıyla gizlenmişlerdi, ama Notlar (rayda) ya da Tor (komut çubuğunda) gibi başka bir düğmeleri yoktu — bu yüzden Firefox görünümünde ikisi de fareyle hiç açılamıyordu.
- **Kimlik Doğrulayıcı paneli kayıyor.** Bir avuçtan fazla 2FA hesabıyla, kıvrımın altındaki kodlara ulaşılamıyordu, çünkü o panelde hiçbir şey kaymıyordu.

Tarama sırasında ölçüldü ve dokunulmadı: komut çubuğunu, bir paneli, yapay zekâ panelini, yeni bir sekmeyi ya da başka bir sekmeyi açmak 7 ile 33 ms arasında bitiyor ve 44 sekmelik bir şeridi yeniden çizmek 1 ms sürüyor. Yavaş olan tek şey Ayarlar’ın ilk açılışı (kurulurken 172 ms), çalıştırma başına bir kez.

## v10.19.7 (2026-09-20) — Kim canlı

_v2.32.65 olarak yayımlandı._

### Değişti
- **Kim canlı** (Ctrl+K): takip ettiğiniz Twitch ve YouTube kanalları ve hangilerinin şu anda yayında olduğu — yayının başlığıyla ve Twitch’te kaç kişinin izlediğiyle. Birini adresini, @kullanıcı adını ya da yalnızca adını yapıştırarak takip edin.
  - Hesap yok, API anahtarı yok: iki site de bunu kanalın kendi herkese açık sayfasında söylüyor ve Vex yalnızca o tek olguyu okuyor.
  - Vex arka planda her on dakikada bir denetler (bir oyun açıkken hiçbir şey çalışmaz) ve bir kanal canlı olduğunda **bir kez** bir şey söyler; kanal kapanıp geri gelene kadar yeniden söylemez. Başarısız olmuş bir denetim “soramadı” sayılır, asla “kapalı” değil; bu yüzden kopan bir bağlantı aynı yayını iki kez duyurmasına yol açamaz.
  - Listeden **İzle** onu bir sekmede açar ve **Köşede** her zaman üstte olan pencerede açar.

Bu, özgün 120 fikirden burada yapılabilenlerin listesini bitiriyor. Dış nedenlerle hâlâ erişilemeyenler: Gönder yönlendirme görseli düzeltmesi (Worker’ın yeniden dağıtılması gerekiyor), Roblox arkadaşları (bir hizmet gerekiyor), YouTube altyazılarını getirme (YouTube engelliyor) ve Belge Resim İçinde Resim (Electron o pencereleri hemen kapatıyor).

## v10.17.7 (2026-09-20) — Rutin işler için küçük bir model, sözcüklerinizi öğrenen yönlendirme, makinenize uyan bir tavan

_v2.32.64 olarak yayımlandı._

### Değişti
- **Rutin işler için küçük bir model** (Ctrl+K): kimsenin izlemediği işler için — bir sayfayı dizinlemek, bir sekme grubuna ad vermek, bir soruyu sınıflamak — hızlı bir yerel model belirleyin; sohbet ve ajan sizin onlar için seçtiğiniz modeli korur. Boş bırakırsanız, eskisi gibi tek bir model her şeyi yapar.
- **Vex, cümlelerinizden hangilerinin görev olduğunu öğrenir.** Onu `/agent` ya da `/chat` ile düzeltmek artık ona öğretiyor: o cümlenin sıradışı sözcükleri seçtiğiniz tarafla birlikte hatırlanıyor ve bir sonraki sefer ona benzeyen bir cümle kendiliğinden doğru yöne gidiyor. Yalnızca düzeltmeler sayılır — kurallara katılmak hiçbir şey öğretmez — hafta boyunca tekrarlanan tek bir sözcük diğer her şeyi oyla alt edemez ve *Vex’in Cümle Kuruluşum Hakkında Öğrendiklerini Unut* onu boşaltır. Bu makineden asla çıkmaz.
- **Bu makineye uyan bir bellek tavanı.** Boştaki sekmelerin ne zaman uyutulacağına karar veren tavan her makinede aynı 1200 MB idi — büyük bir makinede çok fazla ihtiyatlı, küçük bir makinede çok geç. *Bellek Tavanını Bu Makineden Ayarla*, gerçekten sahip olduğunuz miktardan (toplamın yaklaşık onda biri, 600 ile 4000 MB arasında tutulur) ve şu anda boş olandan hesaplar, ve herhangi bir şeyi değiştirmeden önce size sayıyı ve nedenini söyler.

## v10.13.9 (2026-09-20) — Ağaç sekmeler ve gerçekten yanıt isteyen şeylere göre ayrılmış bir gelen kutusu

_v2.32.63 olarak yayımlandı._

### Değişti
- **Ağaç sekmeler** (Ctrl+K): yan şeritte, başka bir sekmeden açılan bir sekme, onların arasını birleştiren kısa bir çizgiyle onun altında girintili durur — böylece bir araştırma sapması daha fazla gürültü yerine bir sapma gibi görünür. Yalnızca hâlâ açık, aynı grupta ve listede kendisinin üstünde olan bir ebeveynin altında girintilenir; başka her şey olduğu yerde kalır. Siz açana kadar kapalıdır.
- **Gelen kutum gerçekte ne istiyor** (Ctrl+K): okunmamış postanız üç yığına ayrılır — yanıt isteyen (bir kişi, bir konu dizisi, bir soru), bakmaya değer olan ve onu sürekli gönderene göre gruplanmış toplu postalar — her biri neden oraya düştüğünü söyleyen bir satırla. Birine tıklamak o iletiyi tam olarak web postanızda açar, orada yanıtlayabilirsiniz; bir göndericiye tıklamak yığınının tamamını tek bir arama olarak açar, orada bin tanesi dört tıkla arşivlenebilir.
  - Vex’in kendi gelen kutusu bilerek salt okunurdur, bu yüzden burada hiçbir şey taşınmaz, arşivlenmez ya da işaretlenmez ve pencere numara yapmak yerine bunu söyler.

## v10.8.9 (2026-09-20) — Bu hafta saklamak için bedava ve klip klasörünüz

_v2.32.62 olarak yayımlandı._

### Değişti
- **Bu haftanın ücretsiz oyunları** (Ctrl+K): Epic ve Steam’in saklamak üzere neyi hediye ettiği, mağazaların kendi listelerinden — hesap yok, anahtar yok. Önce şu an bedava olanlar, en yakında bitecek olan en üstte, sonra sıradakiler, her biri ne kadar süre kaldığıyla. Yalnızca sizin olarak kalacak oyunlar listelenir: %90 indirim bir indirimdir. *Haber ver*’i işaretleyin; Vex günde bir kez, sessizce denetler ve yeni biri başladığında bir şey söyler.
- **Kliplerim** (Ctrl+K): kayıtlarınızın düştüğü klasör — OBS, ShadowPlay, Discord — en yeni en başta, her klibin ne zaman yapıldığı ve ne kadar büyük olduğuyla. Birine tıklayıp bir sekmede izleyin, bir sohbete yapıştırmak için *Yolu kopyala*, ya da bir yere sürüklemek için *Göster*. Vex yalnızca o klasörü okur: hiçbir şey taşınmaz, yeniden adlandırılmaz ya da yüklenmez.

## v10.6.9 (2026-09-20) — Vex’e bir görev öğretin

_v2.32.61 olarak yayımlandı._

### Değişti
- **Vex’e bu görevi öğret** (Ctrl+K). Bir işi bir kez yapın — bir panele giden altı tık, aylık fatura, her hafta aynı form — ve Vex bunu sonradan tekrarlayabileceği bir görev olarak kaydeder, hiçbir yapay zekâ olmadan. Pencerenin altındaki bir rozet, kaydederken adımları sayar; *Bitti* ve *At* ile.
  - Bir düğme, bir sonraki dağıtımda değişen bir sınıf adıyla değil, sözcükleriyle (“Devam”) yeniden oynatılır; bir alan kimliği ya da adıyla; bir sayfa geçişi adresiyle. Tek bir alana yazmak, bitirdiğiniz değerle tek bir adımdır ve bir çift tıklama tek bir tıktır.
  - **Parolalar asla kaydedilmez.** Bir parola, tek seferlik kod ya da kart alanı, sayfayı size geri veren bir adım olur: yeniden oynatma orada durur, siz yazarsınız ve devam eder. Canlı denetlendi — içine bir parola yazılmış bir formda yapılan kayıt onun hiçbir izini içermiyor ve yeniden oynatma yine de görevi bitirdi.
  - Öğretilmiş bir görevi Ctrl+K › *Kayıtlı Bir Görevi Tekrarla* ile, ajanın kendisiyle tamamen aynı izin kuralları altında tekrarlayın.

## v10.1.9 (2026-09-20) — Ajan aynı anda birkaç kaynağı okur, kendi zamanlamalarını kurar ve çalışırken duraklatılabilir

_v2.32.60 olarak yayımlandı._

### Değişti
- **Aynı anda birkaç kaynak.** Araştırma eskiden bir seferde bir sayfaydı — altı kaynak, altı bekleme. Ajan artık tek seferde altı sayfaya kadar okuyor, her biri kendi metniyle dönüyor ve başarısız olan diğerlerini de götürmüyor.
- **“Hafta içi her gün 8:30’da durum sayfasına bak.”** Ajan tekrarlayan görevi kendisi kurar: sözcükler gerçek bir zamanlamaya dönüşür, Zamanlamalar panelinde diğerleri gibi görünür ve geri al onu kaldırır. Saati çıkaramadığı bir şey tahmin edilmek yerine reddedilir — hiçbir şey sessizce yanlış saatte çalışmaz.
- **Bir dosya indirme.** Fatura, yükleyici, PDF istendiğinde ajan onu olağan onayla İndirilenler klasörünüze indirir ve indirmeler listesinde görünür. Bu makinedeki bir dosyaya ya da ağınızdaki bir şeye yöneltilemez.
- **Kayıtlı bir girişle oturum açma.** Ajan, girişler merkezinden bir oturum açma sayfasını doldurmasını isteyebilir — model kullanıcı adını ya da parolayı asla görmez, yalnızca işe yaradığı söylenir ve sonrasında sitenin kendi düğmesine tıklar. Düz http üzerinde reddedilir ve o site için kayıtlı giriş olmadığında bunu söyler ve size bırakır.
- **Duraklat ve fikrinizi değiştirin.** Durdur’un yanındaki bir **Duraklat** düğmesi bir çalıştırmayı adımlar *arasında* tutar, asla birinin ortasında değil: sayfa olduğu yerde kalır ve hiçbir şey atılmaz. O tutulurken yazdığınız her şey ajana söylenecek bir sonraki şey olur — “ABD sitesini değil, Birleşik Krallık sitesini kullan” — böylece yanlış yöne giden bir çalıştırma yeniden başlatılmak yerine düzeltilir.

## v9.98.1 (2026-09-20) — Uzantılarınızın görebildikleri, ses için gece modu, bir videodaki anlar, vurgulardan kartlar

_v2.32.59 olarak yayımlandı._

### Değişti
- **Her uzantının gerçekte görebildikleri.** Ayarlar › Uzantılar artık bunu kartta söylüyor: *Açtığınız her sayfayı okuyabilir ve değiştirebilir*, ya da adlandırdığı siteler, artı izin verilen şeyleri izin dizeleri yerine cümlelerle — çerezleriniz, geçmişiniz, her sekmenin adresi, bu makinedeki bir programla konuşma. Kapsamı geniş olanlar en üste sıralanır, çünkü listeyi denetlemek için açtığınız şey budur. Vex bir uzantıya bazı siteleri verip diğerlerini vermeyebilir (hepsi ya da hiçbiri), ve numara yapmak yerine bunu söyler.
- **Sesi dengele** (Ctrl+K, site başına): sessiz diyalog yükselir, yüksek bölümler aşağıda tutulur — gece on birde, sese el sürmeden bir film. Sayfanın bir sonraki çaldığı her şeye de uygulanır ve o site için hatırlanır. Bir sitenin Vex’in okumasına izin vermediği ses sessizce kısılmak yerine bildirilir.
- **Bu anı not et.** Bir video ya da podcast çalarken, *Bu Anı Not Et* satırınızı zamanla birlikte yazar, o saniyeye bir bağlantı olarak — YouTube’un kendi `t=` değeri, başka her yerde bir medya parçası. Video başına bir not, adresiyle bulunur; böylece bir konuşmanın notları tek sayfa kalır.
- **Vurgularınızdan kartlar.** *Vurguladıklarımdan Kart Yap*, bir sayfanın vurgularını kartlara çevirir — bir vurguya yazdığınız not soru, vurgulanan metin yanıt olur — ve *Kartlarımı Gözden Geçir* onları, doğru bilmeye devam ettikçe uzayan bir aralıkla geri getirir (bir gün, üç, bir hafta ve devamı). Birini yanlış mı bildiniz? Yarın geri gelir ve en başa değil, iki adım geri düşer. Her şey bu makinede kalır.

## v9.96.1 (2026-09-20) — Bir sekmeyi @ ile adlandırın, aynı anda iki model ve hakkında soru sorabileceğiniz bir PDF

_v2.32.58 olarak yayımlandı._

### Değişti
- **Bir sekmeyi @ ile adlandırın.** Yapay zekâ kutusuna `@` yazın; açık sekmeler adlarıyla orada — birini seçin ve yazmakta olduğunuz cümleden ayrılmadan soruya girer. Aynı liste kişiliklerinizi de tutar (`@`’in zaten kastettiği şey) ve adı yazdığınızla başlayan bir kişilik başa gelir. Kutunun üstündeki hap, kaç sekmenin dahil olduğunu gösterir; böylece seçim asla görünmez olmaz.
- **İki modele yan yana sorun** (Ctrl+K): aynı soru aynı anda bulut modeline ve bu makinedeki modele sorulur, iki yanıt yan yana ve her birinin ne kadar sürdüğüyle. Kapalı ya da yapılandırılmamış bir arka uç, karşılaştırmayı bozmak yerine bunu kendi sütununda söyler. *Bu yanıtı tut*, o soruyu ve yanıtı sohbete koyar; böylece konuşma seçtiğinizden devam eder.
- **Makinenizdeki bir dosya hakkında sorun.** Yapay zekâ paneline bir PDF ya da metin dosyası bırakın ve hakkında sorun. Sözcükler bu makinede okunur — bir PDF’in sıkıştırılmış akışları ana işlemde açılır, boşluk yerine geçen kerning bir boşluk olur — ve soruyla birlikte, asla talimat olarak değil, yanıtlanacak malzeme olarak gider. Kâğıt taraması, modele çöp vermek yerine içinde metin olmadığını söyler ve dosyanın kendisi hiçbir yere yüklenmez.

## v9.94.1 (2026-09-20) — Tek bir site için anahtarlar, “ben miyim, sunucu mu?” ve toplantı modu

_v2.32.57 olarak yayımlandı._

### Değişti
- **Bu sitenin neye izni var** (Ctrl+K): tek bir site için üç anahtar — **JavaScript**, **çerezler** ve **diğer sitelerden içerik**. Her biri normalde açıktır; birini kapatmak, siz geri açana kadar o sitenin her sayfasına uygulanır.
  - JavaScript kapalıyken sekme onsuz yeniden kurulur, çünkü bir sayfa başladıktan sonra geri çalıştırılmamış yapılamaz.
  - Çerezler kapalıyken siteye hiçbiri gönderilmez, onun geri gönderdiklerinin hiçbiri tutulmaz ve zaten sahip olduğu çerezler alınır — her yüklemede, böylece sayfanın kendi betiğinde yazdığı bir çerez de hayatta kalmaz.
  - Diğer sitelerden içerik kapalıyken sayfanın kendisine ait olmayan bir ana makineden yüklediği her şey reddedilir: reklamlar, izleyiciler, gömmeler. Canlı denetlendi — ana makine dışı bir resim normal yüklenir, sonra anahtar kapalıyken reddedilir ve anahtar geri açıldığında çerezler geri gelir.
- **Ben miyim, sunucu mu?** (Ctrl+K): kendi bağlantınızı ve Discord, Steam, Riot, Roblox, Epic ve YouTube’u zamanlar ve tek bir cümleyle yanıtlar. Bir hizmet yalnızca hem kendi çizginizin epey gerisinde hem de hissedilecek kadar yavaş olduğunda yavaş denir — başka bir kıtadaki bir oyun sunucusu uzaktır, bozuk değildir.
- **Toplantı modu** (Ctrl+K): hatırlatıcılarınızı tutar, ses çıkaran diğer her sekmeyi sessize alır ve üzerinde saat yazan bir not açar. *Toplantıya Bir Satır Not Et*, az önce söyleneni saatiyle yazar; *Bir Eylem Maddesi Ekle* bunu bir görev olarak yazar, böylece diğer her şeyle birlikte Açık Görevler’de görünür. Zaten sessize alınmış bir sekme sonunda sessiz kalır ve bir toplantı Vex kapatılıp yeniden açılsa da sürer. Hiçbir şey kaydedilmez ya da yazıya dökülmez — yazdığınızı ve başka hiçbir şeyi not eder.
- **Aynı sayfa iki kez değil.** Aynı kapsayıcıda zaten açık olan bir sayfayı açmak, ikinci bir kopya yapmak yerine o sekmeye gider. Sekmeyi Çoğalt, kapatılmış bir sekmeyi yeniden açmak ve bir oturumu geri yüklemek yine size bir kopya verir ve bütün bu şey kapatılabilir (Ctrl+K › *Zaten Açık Olan Bir Sayfaya Geç*).

## v9.89.1 (2026-09-20) — Tek seferde bir çerez, son geldiğinizden beri yeni olanlar ve çift tıklamayla sözlük

_v2.32.56 olarak yayımlandı._

### Değişti
- **Bu site için çerezler ve depolama** (Ctrl+K): bir sitenin tuttuğu her çerez ve her depolanan öğe tek tek listelenir — hepsini temizlemek yerine bir değeri değiştirin ya da tek birini kaldırın. Çerezler sekmenin kendi kapsayıcısında okunur ve değiştirilir, böylece bir İş sekmesinin çerezleri İş sekmesinin kalır. Canlı denetlendi: `yes`’ten `no`’ya düzenlenen bir onay çerezi son kullanma tarihini korudu, bir HttpOnly oturum çerezi kaldırıldı, depolanmış bir ayar değiştirildi — ve sayfanın kendisi üçünü de gördü.
  - Bütün olarak geri getirilemeyecek kadar büyük bir değer gösterilir ama düzenlenemez, böylece hiçbir şey kısaltılmış olarak geri yazılmaz.
- **Son geldiğimden beri yeni olanlar.** Sürekli geri döndüğünüz bir konu dizisi, değişiklik günlüğü ya da wiki sayfası için: geçen sefer orada olmayan paragraflar işaretlenir ve sayfa ilkine kayar. Yalnızca hakkında sorduğunuz sayfalar hatırlanır ve tutulan şey paragraf başına bir özettir — asla metin değil. Hatırlanan bir sayfa, geldiğinizde kendini işaretler ve *Burada Neyin Yeni Olduğunu İşaretlemeyi Durdur* onu unutur ve işaretleri temizler.
- **Buraya nasıl geldim.** Bu sekmeye yol açan sayfa zinciri: açıldığı sayfa ve ondan önceki. Sekmesi hâlâ açık olan bir sıçrama ona geçer; kapattığınız yeniden açılır. Yalnızca Vex’in bu çalışması için tutulur.
- **Yan yana çevir.** Çeviri çubuğunda bir *Yan yana* düğmesi var: sayfa tam olarak olduğu gibi kalır ve çeviri her paragrafın altına daha sessiz bir renkte girer, böylece ikisini de okuyabilirsiniz. Çeviriyi kaldırmak için yeniden çalıştırın. Fransızca gerçek bir sayfaya karşı canlı denetlendi.
- **Bir sözcüğe çift tıklayarak anlamını görün.** Siz açana kadar kapalıdır (Ctrl+K). Açıkken, herhangi bir sayfadaki bir sözcüğe çift tıklamak anlamını yanında gösterir. Sözcük, sayfa tarafından değil Vex tarafından Wiktionary’de aranır — bu yüzden siteye hangi sözcükleri bilmediğiniz asla söylenmez — ve bir sözcük kaç kez tıklasanız da bir kez sorulur.

### Düzeltildi
- Kilit ekranı testi, kasıtlı olarak yavaş olan bir PIN denetimi için sabit 50 ms bekliyordu ve yüklü bir makinede rastgele başarısız oluyordu; artık yanıtı bekliyor.

## v9.84.1 (2026-09-20) — Tüm sekme grupları bir seferde, indirme sıralama, müzik denetimleri

_v2.32.55 olarak yayımlandı._

### Değişti
- **Bir sekme grubunun tamamına işlem yapın.** Bir grubun adına sağ tıklayın: sekmelerini **uyut** (belleklerini geri vererek), **yeniden yükle**, **sesini kapat ya da aç** ya da sonra yeniden açmak için **oturum olarak kaydet**. Gerçek bir grupta canlı denetlendi: ses çalan ya da uyanık tutulan bir sekmeye hâlâ dokunulmuyor, baktığınız uyutulmuyor ve oturum yalnızca o grubun sayfalarını tutuyor.
- **İndirmeler kendilerini sıralayabilir.** İndirilenler paneli › *Sıralama kuralları*: hangi indirmeler (“pdf”, “github.com” ya da “github.com’dan pdf”), İndirilenler altında hangi klasöre gidecekleri ve isteğe bağlı olarak `{date}`, `{site}`, `{name}` ile kurulan yeni bir ad belirtin. Eşleşen ilk kural kazanır, bu yüzden belirli olanlar başa gider.
  - Dosya ilk bayt gelmeden adlandırılır ve dosyalanır, böylece sonradan hiçbir şeyin taşınması gerekmez.
  - Yazdığınız bir klasör ya da ad İndirilenler klasöründen çıkamaz ya da Windows’un ayırdığı bir adı alamaz.
  - Canlı denetlendi: bir siteden bir PDF, kendi klasörünün içinde `2026-09-20 127.0.0.1 invoice_final_2.pdf` olarak geldi.
- **Her yerden müzik denetimleri** (Ctrl+K): *Müziği Oynat ya da Duraklat*, *Sonraki Parça*, *Önceki Parça*, *Müzik Ses Düzeyi…*. Oynat, duraklat ve ses düzeyi sayfanın kendi oynatıcısını kullanır, bu yüzden site düğmelerine ne derse desin çalışırlar; sonraki ve önceki oynatıcının kendi düğmelerini kullanır ve bir sitede Vex’in bulabileceği hiçbiri olmadığında bunu açıkça söyler.

## v9.82.1 (2026-09-20) — Vex’e kendi sözlerinizle sorun, düzgünce yanıtlasın

_v2.32.54 olarak yayımlandı._

### Değişti
- **Yalnızca Ctrl+K’de değil, yapay zekâ panelinde sorun.** *reklamları nasıl durdururum* gibi bir soru artık bir kart olarak dönüyor: özelliğin ne olduğu, adımlar ve düğmeler — **Yap**, **Göster** (gerçek denetimi işaret eder), **Adım adım göster** ve eşleşme yanlışsa **Yine de yapay zekâya sor**. Yanıtlamak için hiçbir model yüklenmez.
- **İnsanların gerçekten kullandığı sözcükleri anlıyor.** Yaklaşık altmış özellik artık gündelik sözcüklerini taşıyor; böylece *karanlık yap*, *ip’mi gizle*, *çerez bannerlarından kurtul*, *bir videoyu küçük pencerede izle* ve *parolalarımı hatırla* hepsi doğru şeye düşüyor. Birinin yazacağı biçimde yazılmış otuz soruda ölçüldü: otuzu yanıtlandı, doğru özellikte.
- **Daha iyi eşleştirme.** Özelliğin kendi adındaki bir sözcük, açıklamasının içine gömülü aynı sözcükten daha çok sayılır; “read”/“reading” eşleşir ama “list”/“listen” eşleşmez; ve adında aynı sözcük olan özelleşmiş bir özelliğe karşı sade özellik kazanır — *ekran görüntüsü al*, Koda ekran görüntüsü değil, Ekran görüntüsü verir.
- **Gerçekten birkaç adım süren üçü için gezintiler** — ajan, kapsayıcı sekmeler ve Eşitleme — her denetimi sırayla vurgulayarak.
- **Listenin hiç bahsetmediği dört özellik**: bu sayfada bul, adres çubuğunun hangi arama motorunu kullandığı, çerez bannerlarını reddetme ve bellek tasarrufu.
- **Bir test onu dürüst tutar**: rehberin sunabileceği her özellik hâlâ var olan bir komuta, denetime, panele ya da Ayarlar anahtarına işaret etmelidir; böylece bir yanıt sizi asla kaldırılmış bir düğmeye gönderemez.

### İndirmeler
- **“İndirme bitti” kartı, siz ilgilenene kadar kalır.** Eskiden birkaç saniye sonra kendini ekrandan kaldırıyordu, bu yüzden başka yere bakmak size dosyaya mal oluyordu. Artık Aç, Göster ya da × için bekliyor — yalnızca yığın beşle sınırlı, böylece bir toplu işlem pencereyi gömemez.
- **Araç çubuğunda bir indirmeler düğmesi**, uzantılar düğmesinin yanında. Bir şey inerken kendini işaretler ve son altıyı açılır listede gösterir: bitmiş birine tıklayıp açın (panelin yaptığı aynı güvenlik denetimiyle) ya da tam liste için *İndirmeleri aç*. Hâlâ inen biri paneli açar.
- **Bir indirmeyi açmak için İndirilenler panelinde çift tıklayın**, Gezgin’de yapacağınız gibi. Kendi düğmeleri hâlâ önceliklidir.

## v9.78.3 (2026-09-20) — Vex'e bir şeyi yapıp yapamadığını sorun

_v2.32.53 olarak yayımlandı._

### Değişti
- **Vex'e Vex'i kendi sözlerinizle sorun.** Ctrl+K'ye bir soru yazın — *sekmelerimi nasıl gruplarım*, *vex reklamları engelleyebilir mi*, *ekranımı kaydetmenin bir yolu var mı* — Vex bunu yapan özelliği söyler, ne işe yaradığını anlatır ve adımları gösterir. Ona basmak, nereye bakacağınızı söylemek yerine işi yapar.
  - Yanıtlar Vex'in kendi özellik listesinden gelir; bu yüzden Vex'te olmayan bir şeyi asla vaat edemez. Hiçbir şey eşleşmediğinde yanıt uydurmak yerine "Vex'te bunun için henüz bir şey yok" der.
  - Yapay zekâya ihtiyaç duymaz: sözcükler yerel yapay zekâ çalışsın ya da çalışmasın, anında kendi bilgisayarınızda eşleştirilir.
  - Kapalı ya da gizli bir özellik önce fark edilir; böylece ilk adım onu yeniden açmak olur.
  - Çalıştırılacak bir şey olmadığında Vex ekrandaki gerçek denetimi gösterir.

  Sıradaki: aynı yanıt, yapay zekâ panelinde *Göster* ve *Yap* düğmeleriyle ve gerçekten birkaç adım gerektiren birkaç özellik için adım adım rehberlerle.

## v9.76.3 (2026-09-20) — Bir videonun bu anına not alın

_v2.32.52 olarak yayımlandı._

### Değişti
- **Videonun Bu Anına Not Al** (Ctrl+K). Bir video oynarken zaman damgası ve doğrudan o saniyeye dönen bir bağlantıyla bir not kaydeder — yazarsanız kendi satırınızla birlikte. YouTube bağlantıları `t=` değerini korur; diğer siteler standart `#t=` değerini alır, böylece video bıraktığınız yerde açılır.

## v9.75.3 (2026-09-20) — Kaydedilmiş bir bağlantının ne kadar sürdüğü ve bir indirmenin içinde ne olduğu

_v2.32.51 olarak yayımlandı._

### Değişti
- **Kaydedilmiş bağlantılar yaşlarını ve okunma sürelerini gösterir.** Birini kaydettiğinizde Vex sayfayı sessizce okur ve okuma süresini tutar; böylece Kitaplık "12 gün önce kaydedildi · 6 dk okuma" der — değerlendiremediğiniz bir kuyruğa kimse başlamaz.
- **Eskiler için bir dürtme.** Bir aydan uzun süre önce kaydedilmiş ve hâlâ okunmamış bağlantılar, toplam okuma süreleriyle birlikte Kitaplık'ın en üstünde sayılır ve tek bir düğme hepsini temizler. Okuduğunuz bağlantılar için hatırlatma yapılmaz.
- **Bir .zip dosyasını açmadan önce içine bakın.** Vex indirilen bir arşivi açmadan önce sorduğunda artık bir *İçine bak* düğmesi var: içindekilerin adları ve boyutları, en çok 200 tane, paket açmayı koruyan aynı korumalardan geçirilerek okunur. Hiçbir şey açılmaz.

## v9.73.3 (2026-09-20) — Site başına ses düzeyi ve sekmede konsol hataları

_v2.32.50 olarak yayımlandı._

### Değişti
- **Bir siteyi tuttuğunuz ses düzeyi hatırlanır.** Bir sekmeye sağ tıklayın › *Sayfa ses düzeyi…* ve değer o site için saklanır — YouTube %40, Spotify %80 — ve sonraki her ziyarette, sayfanın sonradan başlattığı medyada da (sıradaki parça, sayfada daha aşağıdaki bir video) geri konur. %100'e geri almak onu unutturur.
  - Sayfa ilk saniyelerde sesi kendisi sıfırlarsa Vex sizin değerinizi geri koyar; sitenin kendi kaydırıcısını sonra oynatırsanız o geçerli olur.
  - Canlı denetlendi: sayfanın sonradan oluşturduğu medyaya uygulandı, sayfanın sıfırlaması düzeltildi, sonraki bir değişikliğe dokunulmadı.
- **Geliştirdiğiniz sayfalardaki konsol hataları.** localhost, 127.0.0.1, bir .local adresi ya da bir dosya olan sayfalar için sekmede kırmızı bir sayı belirir; üzerine gelince son hata görünür. Her sayfada yeniden sıfırdan başlar ve sıradan web siteleri bunun dışında tutulur. Hata veren yerel bir sunucuya karşı canlı denetlendi.

## v9.71.3 (2026-09-20) — Tüm sohbetlerde arayın, yapay zekânın neyi hatırladığını görün, bir kaynağa göz atın

_v2.32.49 olarak yayımlandı._

### Değişti
- **Tüm sohbetlerde arayın.** Son sohbetler'in üstündeki bir kutu, hepsindeki sözcükleri bir arada arar ve eşleşen satırı gösterir. Sohbetler sekmelere ait olduğundan, kapatılmış bir sekmenin sohbetine başka türlü ulaşılamıyordu.
- **Yapay zekânın bir sohbeti hatırlamaya başladığı yerde bir çizgi.** Vex bir soruyla birlikte son on iletiyi gönderir; bu yüzden çizginin üstündeki hiçbir şeye atıfta bulunulamaz. Bir şeyi unutmuş gibi görünen bir yanıtın artık görünür bir nedeni var.
- **Bir yanıtın andığı kaynağın üzerinde durun;** küçük bir kart o sayfanın başlığını ve ilk sözcüklerini gösterir, böylece açmaya değip değmediğini anlarsınız. Adres başına bir kez okunur ve oturum boyunca saklanır; okunamayan bir sayfa bunu söyler.

## v9.69.3 (2026-09-20) — Oyununuzun üzerinde yüzen bir kaplama penceresi

_v2.32.48 olarak yayımlandı._

### Değişti
- **Bu Sayfayı Kaplama Olarak Aç** (Ctrl+K). Bulunduğunuz sayfa, diğer uygulamaların üzerinde yüzen küçük bir pencerede açılır — bir oyunun yanında bir rehber, harita, wiki ya da sohbet.
  - Vex oturumunuzdaki gerçek bir sayfadır; bu yüzden oturumunuz açık kalır.
  - **Esc** onu kapatır, **Ctrl+Up / Ctrl+Down** onu daha çok ya da daha az saydam yapar, **Ctrl+P** yüzmesini durdurur. Bu tuşlar sayfa görmeden önce işlenir; bu yüzden tuş vuruşlarını yutan bir sayfa sizi kendi düğmesi olmayan bir pencerede mahsur bırakamaz.
  - Saydamlığı ne kadar bıraktığınız bir sonraki sefer için hatırlanır.
  - Özel tam ekrandaki bir oyun, bu pencere de dahil her şeyin üzerine çizer; bu özellik kenarlıksız pencere modu içindir.
  - Canlı denetlendi: kaplama Vex'in oturumunda açıldı, yüzdü ve saydamdı, sonra yeniden kapandı.

## v9.67.3 (2026-09-20) — Çekme istekleriniz, sorunlarınız ve CI, GitHub panelinde

_v2.32.47 olarak yayımlandı._

### Değişti
- **GitHub paneli açık çekme isteklerinizi ve sorunlarınızı gösterir;** tüm depolarınızdan, en yenisi başta. Birine tıklayarak açın.
- **Depolarınız için bir CI ışığı.** En son değiştirdiğiniz beş depo, son GitHub Actions çalıştırmasının nasıl gittiğini gösterir: yeşil geçti, kırmızı başarısız oldu, turuncu çalışıyor.
- Yalnızca herkese açık verileri okur (Vex'te GitHub ile oturum açma yoktur); bu yüzden bildirimler ve özel depolar gösterilmez. Her şey, oturum açmamış istekler için GitHub'ın sınırı içinde kalmak üzere en fazla beş dakikada bir alınır. GitHub'ın tanımadığı bir kullanıcı adı ya da GitHub'ın yavaşlamayı istemesi panelde söylenir.
- Hesabınızla canlı denetlendi: CI ışıklı dört depo (Vex'in kendisi çalıştırmasını sürerken gösteriyordu) ve açık çekme istekleriniz.

## v9.66.3 (2026-09-20) — Vex'i bir PIN ile kilitleyin ve bir Kararlı güncelleme kanalı

_v2.32.46 olarak yayımlandı._

### Değişti
- **Vex'i kilitleyin.** Ayarlar › Gizlilik ve Güvenlik › Vex'i Kilitle bölümünde bir PIN belirleyin, sonra üç yolla kilitleyin:
  - Ctrl+Alt+L, bir sayfanın içinde de çalışır,
  - Ctrl+K › *Vex'i Kilitle*,
  - ya da bilgisayarda 5, 15, 30 veya 60 dakika boyunca klavye ya da fare girdisi olmadığında kendiliğinden.

  Nasıl davranır:
  - Bir PIN ekranı pencerenin tamamını kaplar ve altındaki her sayfa ve panel yalnızca bulanıklaştırılmaz, gizlenir.
  - Yanlış bir PIN reddedilir ve art arda beş yanlıştan sonra 30 saniye bekler.
  - PIN yalnızca tuzlanmış bir özet olarak saklanır.
  - Bu bir gizlilik ekranıdır, şifreleme değildir: diskteki profiliniz kilitlenmez.
  - Firefox görünümünde canlı denetlendi: bir sayfanın içinden Ctrl+Alt+L, sonra kilidi açmak için PIN.
- **Güncelleme kanalları.** *Güncellemeleri Denetle* altında **En Yeni** (eskisi gibi her sürüm) ya da **Kararlı** seçin. Kararlı, en yeni sürüm iki gündür yayında olduktan sonra bir güncellemeyi size bildirir; böylece birkaç sürümün çıktığı bir gün birkaç yerine tek bir istem olur.

## v9.61.3 (2026-09-20) — Discord resimleri yeniden yükleniyor ve YouTube'da sponsor atlama

_v2.32.45 olarak yayımlandı._

### Düzeltildi
- **Discord, paylaşılan GIF'ler ve bağlantı önizlemeleri için "Image failed to load" gösteriyordu.** "Daha hafif Discord" (v2.32.36), insanların paylaştıkları da dahil her GIF'i ve her bağlantı önizleme resmini engelliyordu; bu da Discord bozukmuş gibi görünmesine yol açıyordu. Artık yalnızca süslemelerin hareket etmesini durduruyor (avatarlar, emojiler, çıkartmalar, sunucu simgeleri ve afişler) ve birinin paylaştığı ya da bağladığı her şey her zaman yükleniyor.

### Değişti
- **YouTube'daki sponsor bölümleri atlanır,** SponsorBlock'un topluluk verileri kullanılarak. Oynatma bir sponsor anlatımına, kendi tanıtımına ya da "beğen ve abone ol" bölümüne ulaştığında video onu atlar ve bunu köşede bir an için söyler.
  - Yalnızca videonun kimliği gönderilir.
  - Ayarlar › Gizlilik ve Güvenlik'ten kapatın.
  - Canlı denetlendi: bir videonun işaretli sponsor bölümüne atlamak, bölümün sonuna sıçradı.

## v9.56.3 (2026-09-19) — Açık bir sekmeye geçin ve sekmelere notlar

_v2.32.44 olarak yayımlandı._

### Değişti
- **Zaten açık mı? Ona geçin.** Adres çubuğuna yazdığınız bir sayfa zaten açıksa, önerisi artık *Sekmeye geç* der. Seçmek sayfayı ikinci kez açmak yerine o sekmeye gider ve yazdığınız boş yeni sekmeyi kapatır.
- **Bir sekmeye not.** Bir sekmeye sağ tıklayın › *Bu sekmeye not ekle…* ("yanıt bekliyorum").
  - Sekmede küçük bir işaret olarak görünür; not, üzerine gelince ya da sekmeler yanda olduğunda başlığın altında görünür.
  - Yeniden başlatmalar boyunca sekmeyle birlikte kalır.
  - Yeniden başlatma dahil, Firefox görünümünde canlı denetlendi.

## v9.53.3 (2026-09-19) — Vurgular ve kaynakçalarla araştırma

_v2.32.43 olarak yayımlandı._

### Değişti
- **Araştırma projelerinde vurgular.** Bir sayfada bir pasaj seçin, sonra Ctrl+K › *Seçili Metni Projeye Ekle*. Geldiği sayfayla ve sayfanın kendisi hakkında söylediğiyle birlikte saklanır: sayfa yayımlıyorsa yazarlar, tarih, site ve DOI. Projeye eklenen sayfalar da artık bu ayrıntıları saklar.
- **Kaynakçalarla kaydedin.** Bir proje şunları içeren bir belge olarak kaydedilir:
  - alıntı olarak vurgular,
  - sayfalar, notlar ve sohbetler,
  - ve APA, MLA, Harvard ya da Chicago biçiminde numaralı bir **Kaynakça** listesi.

  Her vurgu ve sayfa kaynak numarasıyla işaretlenir ve bir vurgu, geldiği sayfayla aynı girdiyi paylaşır.

### Düzeltildi
- MLA ve Chicago atıfları, adı bir baş harfle biten bir yazardan sonra noktayı ikiye katlıyordu ("Smith, Jane Q..").

### Yapılmadı ve nedeni
- **Bir sayfanın herhangi bir bölümü için, sitenin kendi altyazılarıyla görüntü içinde görüntü,** yapıldı ve sınandı, sonra çıkarıldı:
  - Vex'in çalıştığı Electron sürümü bu tür yüzen pencereyi açıldığı anda kapatıyor.
  - YouTube'un kendi oynatıcısı kendi küçük penceresinde açılmayı reddediyor (153 ve 152 hataları).

  Sıradan görüntü içinde görüntü, sitenin altyazıları olmadan çalışmaya devam ediyor.

## v9.52.5 (2026-09-19) — Takvimleriniz Vex'te ve bir sekmeyi ya da GIF'i kaydetme

_v2.32.42 olarak yayımlandı._

### Değişti
- **Google, Outlook veya Apple takviminiz, salt okunur.** Takvim'de (Ctrl+K › Takvim), *Takvim ekle*'ye tıklayın ve iCal adresini yapıştırın. Google Takvim'de bu Ayarlar › takviminiz › *iCal biçiminde gizli adres*'tir. Etkinlikleri şurada görünür:
  - ay ve gün görünümlerinde,
  - ve yeni sekme sayfasındaki Bugün'de,
  - ve sabah özetinde.

  Daha fazla ayrıntı:
  - Yinelenen etkinlikler açılır (günlük, belirli günlerde haftalık, aylık, yıllık; bitiş tarihleri ve atlanan günlerle) ve taşınan oluşumlar da öyle.
  - Diğer saat dilimlerindeki saatler, saat değişiklikleri dahil dönüştürülür.
  - Vex'in henüz açamadığı kurallar bir kez gösterilir ve tahmin edilmez, Bellek › Sağlık'ta not edilir.
  - Her 30 dakikada bir yenilenir. Okunamayan bir takvim nedenini Takvim'de ve Bugün'de söyler.
  - Adres bir parola gibi çalışır, bu yüzden sağlık raporlarına konmaz.
  - Google'ın herkese açık ABD resmi tatiller takvimiyle canlı denetlendi.
- **Bu Sekmeyi Kaydet** ve **Bir Alanı Kaydet** (Ctrl+K). Yalnızca öndeki sayfayı ya da pencerenin üzerinde sürüklediğiniz bir kutuyu, bir seçici olmadan, video olarak kaydederler. Canlı denetlendi: kayıt tam olarak sekmeye göre kırpıldı.
- **Bir GIF Kaydet** (Ctrl+K): bir kutu sürükleyin, 30 saniyeye kadar kaydedin ve bir sohbet ya da sorun için hareketli GIF olarak kaydedilir. Canlı denetlendi: Chromium yaptığı GIF'i açıyor ve yazıcı bağımsız bir kod çözücüyle sınandı.

## v9.47.5 (2026-09-19) — Bir sabah özeti, Markdown veya e-kitap olarak sayfalar, ekran görüntülerinden metin

_v2.32.41 olarak yayımlandı._

### Değişti
- **Sabah özetiniz.** Ctrl+K › *Sabah özetimi yaz*, bugünün hatırlatıcılarını, zamanlanmış görevlerini, değişen sayfaları, kaydedilmiş bağlantıları ve son günün akış başlıklarını tek bir kısa paragrafa dönüştürür. Gün bitene kadar yeni sekme sayfasındaki Bugün'ün en üstünde durur.
  - Yapay zekâya yalnızca o zaman sorulur, asla kendiliğinden değil; bu yüzden yeni bir sekme açmak hiçbir zaman bir model yüklemez.
  - Yalnızca bu olguları kullanması söylenir. İçlerinde hiçbir şeyin olmadığı bir günde yapay zekâya sormak yerine bunu söyler.
- **Sayfayı Markdown Olarak Kaydet** ve **Sayfayı E-kitap Olarak Kaydet** (.epub), Ctrl+K'de. İkisi de çevresindeki menüleri, üst ve alt bilgileri, kenar çubuklarını ve formları değil, makalenin kendisini saklar.
  - Bağlantılar bağlantı, tablolar tablo olarak kalır.
  - E-kitap nereden ve ne zaman geldiğini söyler ve bir e-okuyucu resimleri çekemediği için resimleri açıklamalarına dönüştürür.
  - Uzun bir Wikipedia makalesinde canlı denetlendi. E-kitap dosyası ayrı bir zip okuyucusuyla denetlendi, her parça sağlamdı.
- Bir ekran görüntüsünde **Metni kopyala**, resimdeki sözcükleri okur ve kopyalar. Bilgisayarınızda çalışır (ilk seferde okuma motorunu indirir). Canlı denetlendi: "Invoice 4471 due Friday / Total: 312.50 EUR" yaklaşık bir saniyede tam olarak geri okundu.

## v9.42.5 (2026-09-19) — Paylaşım için temiz bir pencere, kaydedilen bölünmüş düzenler, bağlantılar teker teker

_v2.32.40 olarak yayımlandı._

### Değişti
- **Bu sayfayı temiz bir pencerede paylaşın** (Ctrl+K). İçinde yalnızca o sayfanın olduğu özel bir pencere:
  - yer imi çubuğu yok, panel kenar çubuğu yok, başka sekme yok,
  - ve yayıncı modu her zaman açık.

  Ekranınızı paylaşırken ya da kayıt yaparken kendi tarayıcınızı görüntüden çıkarmak için. Özel olduğundan sayfada oturum açık değildir. Firefox görünümünde canlı denetlendi.
- **Bölünmüş ekran bir çalışma alanı anlık görüntüsüyle kaydedilir ve geri gelir.** Hangi sekmelerin yan yana olduğu, hangi sırayla ve ayırıcının nerede olduğu. Anlık görüntü listesi "2 yönlü bölünmüş" der. Canlı denetlendi: 35/65 bir bölünme kaydedildi, her şey kapatıldı, olduğu gibi geri yüklendi.
- **Kaydedilmiş bağlantılarınızı teker teker okuyun.** Ctrl+K › *Sonra Oku'dan sıradaki* (ya da Kitaplık'ta *Teker teker oku*), bulunduğunuz sekmede okunmamış en eski bağlantıyı açar ve kaç tane kaldığını söyler. Bir sayfanın sağ tık menüsünden kaydedilen bağlantılar artık bağlantı metnini başlık olarak saklar.

### Düzeltildi
- **Bölünmüş ekran, sol bölmenin üzerinde yanlış adresi gösteriyordu.** İki küçük adres çubuğu sol yarının üzerinde üst üste biniyordu; bu yüzden sol bölme sağ bölmenin adresini gösteriyordu ve ayırıcıyı yok sayıyorlardı. Her biri artık ayırıcıyı sürüklerken de kendi bölmesinin üzerinde duruyor.
- **Adres çubuğunda imleç varken sekme değiştirmek** (yeni bir sekme imleci oraya koyar) geçtiğiniz sayfanın üzerinde çubuğu boş bırakıyordu. Artık o sayfanın adresini gösteriyor.
- **Özel pencereler, hangi görünümü kullanırsanız kullanın Klasik görünümde açılıyordu.** Artık açıldıkları pencerenin görünümünü alıyorlar.
- **Özel pencereler her seferinde ilk çalıştırma kurulum sihirbazını gösteriyordu.** Artık göstermiyor.
- Sağ tık menüsünden bir bağlantıyı Sonra Oku'ya kaydetmek iki bildirim gösteriyordu ve herhangi bir hatayı gizliyordu. Artık bir tane gösteriyor ve hata bildiriliyor.

## v9.38.7 (2026-09-19) — Sorarak ayarlar, GitHub derleme uyarıları ve aracıdan daha fazlası

_v2.32.39 olarak yayımlandı._

### Değişti
- **Sorarak bir ayarı değiştirin.** Ctrl+K'de ya da aracıya sorun: *fare hareketlerini kapat*, *yayıncı modunu aç*, *arama motorunu DuckDuckGo yap*.
  - Vex, Ayarlar'daki anahtarı ya da açılır listeyi yanındaki sözcüklerden bulur, tam olarak neyin değişeceğini gösterir ve yalnızca siz evet deyince değiştirir.
  - Ayarın kendi denetimini kullanır; bu yüzden her zamanki gibi kaydedilir.
  - İki ayar anlamına gelebilecek sözcükler tahmin edilmez, size geri söylenir. Aracının Geri al'ı değiştirilen bir ayarı yerine koyar.
  - Firefox görünümünde canlı denetlendi: Ctrl+K'ye yazıldı, onaylandı ve ayar değişti.
- **"Bu derleme bitince söyle."** Bir GitHub Actions çalıştırmasında Ctrl+K › *Bu GitHub çalıştırması bitince söyle*, ya da *bitince söyle* yazın, ya da aracıya sorun. Vex iki dakikada bir GitHub'a sorar ve çalıştırma geçtiğinde ya da başarısız olduğunda bir masaüstü bildirimi gösterir, sonra izlemeyi bırakır.
  - Bir depoda ya da sürümler sayfasında, yeni bir sürüm olduğunda size söyler (30 dakikada bir denetlenir).
  - İzlenen sayfalarınızla birlikte listelenirler. Yalnızca herkese açık depolar, çünkü Vex'te GitHub ile oturum açma yok.
  - GitHub'a karşı canlı denetlendi: v2.32.38'in CI çalıştırması "Verify Vex passed" olarak geri geldi.
- **İndirmeler, Vex öndeki pencere olmadığında bittiklerini ya da başarısız olduklarını masaüstünde söyler.**
- **Bir aracı yanıtı bir takvim girdisine ya da bir e-postaya dönüşebilir.** Yanıtın altında:
  - **Takvime ekle** ne zaman olduğunu sorar ("yarın 15:00") ve yanıtı içinde taşıyan bir .ics kaydeder.
  - **E-posta taslağı** yanıtı yeni bir ileti olarak kendi posta uygulamanızda açar ve kime gideceğini siz seçersiniz. Çok uzun bir yanıt sığacak şekilde kısaltılır ve bunu söyler.
- Ayarlar › Yapay Zekâ'daki **Tüm modelleri karşılaştır**, aracı sınamasını yüklü her modelde sırayla çalıştırır ve geçilen turlara, sonra hıza göre sıralar.
  - Her model sınamasından sonra bellekten çıkarılır; böylece ekran kartı hepsini tutarken bırakılmaz.
  - Bir oyun çalışırken başlamaz.
- **Bir YouTube videosu hakkındaki yanıtlardaki zaman damgaları düğmedir:** [2:05]'e basın ve video oraya atlar. Bir videoda sohbet, YouTube verdiğinde oynatıcının çevresindeki sayfa yerine videonun altyazılarını okur.

### Bilinen sorun
- **YouTube artık birçok video için altyazıları kendi oynatıcısı dışında hiçbir şeye vermeyi reddediyor.** Bu oturumda birkaç videoda denendi:
  - altyazı indirmesi boş geldi,
  - döküm hizmeti "precondition check failed" yanıtını verdi,
  - ve kendi döküm paneli hiç yüklenmedi.

  Bu yüzden bir videoyu okumak (sohbet ve aracının "bu videoyu oku"su) çoğu video için sayfa metnine düşüyor ve hata artık nedenini söylüyor. Başka bir yol inceleniyor.

## v9.33.7 (2026-09-19) — Daha sağlam: diskte notlar, çökme geçmişi, kötü bir güncellemeden geri dönüş yolu

_v2.32.38 olarak yayımlandı._

### Değişti
- **Notlar, yapay zekâ sohbetleri, geçmiş, aracı çalıştırmaları, pano, ek açıklamalar ve Sonra oku, tarayıcı depolamasında değil diskte tutulur.** Tarayıcı depolaması yaklaşık 5 MB ile sınırlıdır ve bunlar sınırsız büyüyen depolardır; bu yüzden onu dolduracak olanlar bunlardı. Mevcut kopyalar Vex başlarken taşınır. Canlı denetlendi: bir not yazıldı, Vex yeniden başlatıldı ve not diskten geri geldi ve Notlar panelinde göründü.
  - Sığmamaya başlayan diğer her değer artık yazıldığı gibi geri okunur. Eskiden dolu bir depo onu diske kaydediyordu ama bir sonraki yeniden başlatmaya kadar eski kopyayı okumaya devam ediyordu.
  - **%80 dolulukta bir uyarı,** günde bir kez, neyin doldurduğunu adlandıran Bellek › Sağlık'ı gösterir.
- **Arka plan işleri için tek bir zamanlayıcı.** On iki periyodik iş (rozetler, Bugün kartı, Ayarlar'daki sayaçlar, yerel yapay zekâ durumu, sekme grubu önerileri, sayfa izlemeleri, telefonunuzdan gönderilen sekmeler, anlık görüntüler ve diğerleri) artık tek bir zamanlayıcıyı paylaşır.
  - Yalnızca ekranda önemli olan işler, Vex simge durumundayken ya da bir oyun çalışırken bekler.
  - Sayfa izlemeleri gibi size bildirim gönderen işler yalnızca bir oyun sırasında bekler.
  - Tutulan her şey siz geri döner dönmez bir kez çalışır. Sağlık kaç çalıştırmanın tutulduğunu gösterir.
- **Başlangıç, parça parça,** Bellek › Sağlık'ta:
  - kaydedilmiş verilerin okunması,
  - sekmelerin geri yüklenmesi,
  - arayüzün geri kalanı,
  - çeyrek saniye ya da daha fazla süren her uzantı. Uzantılar pencereyle birlikte yüklenir; bu yüzden ilk sayfayı geciktirmezler.
- **Önceki başlatmalardaki çökmeler** de Sağlık'ta, ne zaman ve hangi sürümde olduklarıyla birlikte, son bir hafta için listelenir. Profilinizdeki küçük bir dosyada tutulurlar. Hiçbir yere hiçbir şey gönderilmez.
- Bellek › Süreçler'deki **Rapor kaydet…**, süreçleri, sağlığı ve ayarlarınızı bir hata raporu için bir metin dosyasına yazar. Uzun değerler yalnızca boyutlarını gösterir ve kişisel olabilecek her şey (belirteçler, parolalar, hesaplar, posta, eşitleme) adıyla dışarıda bırakılır.
- **Kötü bir güncellemeden sonra geri dönmek.** Yeni bir sürüm iki kez başlatılamazsa, güvenli mod artık hangi güncellemeyle başladığını söyler ve **<sürüm> sürümüne geri dön** önerir. Bu, önceki yükleyiciyi indirir ve güncellemeleri bir gün duraklatır; böylece eski sürüm bozuk olanı hemen geri önermez.
- **Her güncellemeden önceki ayarlar,** son beş, Ayarlar › Veri'de her biri için bir Geri Yükle düğmesiyle listelenir. Eskiden yalnızca güvenli modun içinden geri yüklenebiliyorlardı.
- **Güvenli modda başlat** görev çubuğundadır: Vex'e sağ tıklayın. Vex zaten çalışıyorsa güvenli moda yeniden başlar. (İlk planlandığı gibi başlatırken Shift'e basılı tutmak, her başlatmada yavaş bir denetim anlamına gelirdi.)

### Düzeltildi
- Komut satırından güvenli modda başladıktan sonra "Normal şekilde yeniden başlat", yeniden güvenli moda başlıyordu.

## v9.28.1 (2026-09-19) — Yayıncı modu yalnızca paylaştığınızda ve daha istikrarlı bir aracı

_v2.32.37 olarak yayımlandı._

### Düzeltildi
- **Yayıncı modu artık bir arama sırasında açılmıyor.** Kendiliğinden açılacak şekilde ayarlandığında, bunu artık yalnızca ekranınızı paylaşırken yapıyor: Discord'da (panel ya da sekme), bir sitenin ekran paylaşımında ya da Vex ekranı kaydederken. Bir sesli ya da görüntülü aramaya katılmak ya da mikrofonu veya kamerayı açmak ona dokunmaz. Paylaşım durduğunda yeniden kapanır. Ayar artık *Ekranınızı paylaşırken (aramalarda değil)* diyor.

### Değişti
- **Değişmiş bir sayfaya takılan kayıtlı bir aracı görevi devam eder.** Eskiden bir adımın başarısız olması (taşınmış bir düğme, değişmiş bir sayfa) tüm makroyu durduruyordu. Şimdi aracı görevi oradan kendisi alıyor; ona nelerin yapıldığı ve neyin başarısız olduğu söylenir. Durdur'a bastıysanız ya da bir adımı reddettiyseniz yine durur.
- **"Bu değişince söyle", sade sözcüklerle.** Aracıya sorun ya da Ctrl+K'ye yazın: *fiyat 300'ün altına düşünce söyle*, *bu sayfayı değişiklikler için izle*, *50'nin üstüne çıkınca söyle*. Bulunduğunuz sekmede bir sayfa izlemesi kurar. Aracının Geri al'ı onu kaldırır.
- **Her aracı adımının maliyeti.** Her model çağrısından sonra aracı ne kadar sürdüğünü ve model bildirdiğinde kaç belirteç kullandığını gösterir. "Aracı bitti" toplamı verir.
- **"Her zaman github.com'da".** Aracı, adını vermediğiniz bir sitede işlem yapmadan önce sorduğunda artık bir *Her zaman <site>'te* düğmesi var. O site sonraki çalıştırmalar için hatırlanır. Her biri için bir Kaldır düğmesiyle liste, Ayarlar › Yapay Zekâ'da, aracı ayarlarının altındadır.

## v9.26.6 (2026-09-19) — Çok daha az bellek kullanan Discord

_v2.32.36 olarak yayımlandı._

### Notlar
Discord'u küçültme yollarının listesinden istenen her şey (makinenizde yaklaşık 1,07 GB ölçüldü). Hepsi Ayarlar › Performans'ta:
- **Discord'u sekme olarak aç** (yeni seçenek: *panel* ya da *sekme*). Sekme olarak Discord yalnızca sekme açıkken çalışır ve kapatıldığında hiçbir şey kullanmaz.
  - Kenar çubuğunun Discord düğmesi kalır: Discord sekmesini açar ya da zaten açıksa ona geçer; böylece asla iki tane olmaz.
  - Panelle aynı oturumu kullanır; bu yüzden oturumunuz, Vencord yapınız ve Discord bağlantısı engel aşma ayarları da onunla gelir.
  - Discord kısayolları ve arama rozeti sekmeyi izler.
  - Bedeli: sekme kapalıyken Discord bildirimleri yoktur ve kapatmak bir aramayı bitirir.
- **Discord boştayken uykuya geçer.** Gizliyken ve bir aramada değilken 15 dakika boyunca (ya da 30, 60, asla) panel uykuya geçer ve tüm belleğini boşaltır. Açtığınızda uyanır. Bir arama sırasında, mikrofon ya da kamera açıkken ya da ses çalarken asla uykuya geçirilmez. Uykudayken Discord bildirimleri yoktur.
- **Daha erken yenilenir.** "Discord şunu aşınca yenile" sınırı artık 1,5 GB'tan **1 GB**'a düşürüldü. Eski varsayılanda bırakılmış bir sınır bir kez aşağı çekildi; başka bir değer seçerseniz korunur.
- **Daha hafif Discord** (açık): hareketli avatarlar, emojiler ve çıkartmalar, paylaşılan GIF'ler, GIF seçicinin önizlemeleri ve bağlantı önizlemelerindeki resimler basitçe alınmaz; durağan avatarlar, emojiler ve paylaşılan resimler normal görünür. Bir Discord sekmesinde canlı denetlendi: bir GIF ve hareketli bir emoji hiçbir istek çıkmadan reddedildi ve durağan bir emoji yüklendi.
- **Gizliyken önbellekler temizlenir.** Discord'u gizledikten 20 saniye sonra bellekteki resimleri ve yazı tipleri serbest bırakılır ve baktığınızda yeniden çözülür.
- **En ağır Vencord eklentilerini kapatın,** tek düğme: MessageLoggerEnhanced, MessageLogger, ShowHiddenChannels, PlatformIndicators ve WhoReacted; eklenti incelemesindeki en büyük bellek kullanıcıları. Vencord'un kendi ayarlarını kullanır, sonra Discord'u yeniden yükler. Siz basana kadar hiçbir şey değişmez.
- **Vex'in sizin yerinize değiştiremediği Discord'un kendi ayarlarında,** bölüm neyin yardımcı olduğunu listeler:
  - Azaltılmış hareket ve otomatik oynayan GIF, hareketli emoji ya da çıkartma olmaması,
  - bağlantı ya da resim önizlemesi olmaması,
  - ve okumadığınız büyük sunuculardan ayrılmak.

## v9.22.8 (2026-09-19) — Llama yalnızca siz isteyince, ve oyun, Discord, yayın

_v2.32.35 olarak yayımlandı._

### Değişti
- **Geçmiş dizinleme artık varsayılan olarak kapalı ve mevcut profillerde bir kez kapatıldı.** Ziyaret ettiğiniz her sayfayı özetler; böylece yapay zekâ geçmiş araması sayfaları anlamlarıyla bulabilir ve bunu yerel yapay zekâ modeliyle yapar. Bu yüzden llama, siz gezinirken, oyun oynarken de yüklenip duruyordu; çünkü oyun modu yalnızca *tam ekran* oyunları fark eder ve pencerede Roblox sayılmaz.
  - Artık model yalnızca yapay zekâya bir şey sorduğunuzda çalışır.
  - Yapay zekâ geçmiş araması sayfaları yine de başlıklarına ve adreslerine göre bulur.
  - Özetleri yeniden istiyorsanız Ayarlar › Yapay Zekâ'da **Yapay Zekâ Geçmiş Dizinleme**'yi açın. Bu tek seferlik kapatmadan sonra açmanız korunur.

### Notlar
Listeden dört fikir daha, tamamlandı:
- **Oyun, paneller de.** Bir oyun başladığında gizli paneller artık arka plan sekmeleriyle birlikte uykuya geçer. "Belleği şimdi boşalt" ile aynı kuraldır: Ayarlar'da uyanık tutulan, ses çalan ya da aramada olan bir panel asla.
- **Oyun, sekmeler geri gelir.** Oyun bittiğinde, uykuya aldığı sekmeler hepsi birden ya da yalnızca bir sonraki tıklayışınızda değil, tek tek uyanır. Ayarlar › Oyun'da bunun için bir anahtar var.
- **Oyun, Vex sakin durur.** Oyun ekranı kaplarken Vex kendi animasyonlarını durdurur. Windows tam ekran bir oyunun kapladığı pencereyi zaten yavaşlatır; bu da geri kalanı durdurur. Bunun için de bir anahtar var.
- **Discord aramanız, Discord simgesinde.** Paneli açmadan, Discord simgesindeki küçük bir rozet bir aramada olduğunuzu gösterir:
  - mikrofonunuz açıkken yeşil, sessize alındığında ya da sağırlaştırıldığında kırmızı,
  - paylaşırken bir ekran simgesi,
  - sözcükler için üzerine gelin ("Bir Discord aramasında: sessizde, ekranınızı paylaşıyorsunuz").
  - Discord'un kendi Sessize Al, Sağırlaştır ve Yayını Durdur düğmelerini okur. Sessize Al ve Sağırlaştır, Discord kısayollarının zaten kullandığı aynı düğmelerdir. Paylaşım, Discord hesabınız olmadan sınanamadı.
- **Yayıncı modu, boşluklar kapatıldı:**
  - bir **sekme başlığındaki** e-posta adresi (ör. "Inbox – you@gmail.com") yayıncı modu açıkken bulanıklaştırılır,
  - **Posta**'daki adresler ve Eşitleme'deki "Şu hesapla oturum açıldı" ve Vex'in **form doldurma** menüsü de öyle,
  - bir oyunun içinden yayıncı modunu açıp kapatmak için bir **kısayol** var (Ayarlar › Kısayollar, siz ayarlayana kadar kapalı).
- Firefox görünümünde denetlendi: Gmail tarzı bir sekme başlığı sekme çubuğunda bulanıklaştırıldı ve oyun anahtarları göründü.

## v9.19.0 (2026-09-19) — Daha güvenli bağlantılar, indirmeler ve izinler

_v2.32.34 olarak yayımlandı._

### Düzeltildi
- **Bir sitenin izin isteminde "Bu ziyarete izin ver" çalışmıyordu** (v2.31.95'ten beri). Düğme "bu ziyaret için" gönderir ve arayüzün çağrılarındaki güvenlik denetimi yalnızca evet ya da hayır bekliyordu, bu yüzden yanıtı reddediyordu. Sitenin isteği zaman aşımına uğrayıp reddedilene kadar takılıyordu ve yalnızca "Her zaman izin ver" çalışıyordu. Düzeltildi ve canlı denetlendi: bir sayfa mikrofon istedi, "Bu ziyarete izin ver"e tıklandı ve sayfa bunun verildiğini gördü.

### Notlar
Listeden dört fikir daha, tamamlandı:
- **Bir gün için izin ver.** Site izin istemleri artık **Bir gün için izin ver** de sunuyor. 24 saat sonra site yeniden sorar. Ayarlar › Site İzinleri'nde diğer yanıtlar gibi görünür ve oradan kaldırılabilir.
- **Hangi siteler mikrofonunuzu ve kameranızı kullandı.** Ayarlar › Site İzinleri'nde "Şu anda kullanımda" altında bir **Yakın zamanda kullanılanlar** listesi var: örneğin "meet.example.com: şimdi; bugün 2 kez, son olarak 20:02". 30 gün tutar, özel ya da Tor sekmelerinden hiçbir şey almaz ve **Bu geçmişi temizle** onu boşaltır.
- **Bu bağlantı nereye gidiyor?** Bir bağlantıya sağ tıklayın. Kısaltılmış bağlantılar (bit.ly, t.co…) ve yönlendirmeler gerçekte vardıkları yere kadar izlenir:
  - Çerezsiz ve oturumsuz boş bir oturumdan sorar; böylece site hakkınızda hiçbir şey öğrenmez.
  - Gerçek adresi izleme etiketleri olmadan gösterir, benzer görünen alan adlarını ve şifrelenmemiş sayfaları uyarır ve **Aç** ya da **Gerçek adresi kopyala** sunar.
  - Bağlantıyı izlemenin siteyle gerçek bağlantınızdan temas etmesi anlamına geleceği özel ya da Tor sekmelerinde sunulmaz.
- **Bir indirmeyi VirusTotal'da denetleyin.** "Bu program çalıştırılsın mı?" istemi artık **VirusTotal'da denetle** düğmesine sahip. Dosyanın VirusTotal raporunu parmak iziyle (SHA-256) açar; bu, onlarca tarayıcının ne dediğini gösterir. Dosyanın kendisi asla yüklenmez.
- Firefox görünümünde canlı denetlendi: iki kez yönlendiren kısa bir bağlantı gerçek hedefini gösterdi, Yakın zamanda kullanılanlar listesi bir sekme mikrofonu kullandıktan sonra doldu ve istem dört seçeneğin hepsini gösterdi.

## v9.14.0 (2026-09-19) — Yapay zekâ sohbetinden daha fazlası

_v2.32.33 olarak yayımlandı._

### Notlar
Listeden yarım kalmış beş fikir, tamamlandı:
- **Her yanıtı not olarak kaydedin.** Her yanıtın, Kopyala'nın yanında bir **Not olarak kaydet** düğmesi var; karşılaştırma tabloları dahil. Not, onu üreten soruyla adlandırılır.
- **Sıradaki adım.** En son yanıtın altında:
  - **Daha derine in** daha fazla ayrıntı, örnek ve çekince ister.
  - **Kaynakları aç** yanıtın andığı bağlantıları (en çok beş), arka plan sekmelerinde açar.
- **Sohbetleri sabitleyin, yeniden adlandırın ve saklayın.** Sohbet listesinde (saat düğmesi):
  - **Sabitle** bir sohbeti en üstte tutar.
  - **Yeniden adlandır** ona kendi adınızı verir.
  - **Nota** tüm konuşmayı tek bir not olarak kaydeder.
- **Yapay zekâ kutusuna bir resim yapıştırın ya da bırakın.** Eklenir (kutunun üstünde, kaldırmak için × ile gösterilir) ve sorunuzla birlikte gider. Tek başına Enter'a basmak "Bu resimde ne var?" sorusunu sorar. Sağ tık › Vex'e bu resmi sor ile aynı yolu kullanır; bu yüzden resimleri görebilen bir modele ihtiyaç duyar.
- Metin seçtiğinizde beliren çubukta **Hata ayıkla**: bir hata iletisi için. Hatanın ne anlama geldiğini, olası nedeni ve çözümü söyler; kod ise kod olarak.
- Firefox görünümünde denetlendi: düğmeleri ve çipleriyle tablo yanıtı ve kutuya yapıştırılan bir resim.

## v9.12.0 (2026-09-19) — Bildirdiğiniz düzeltmeler, Firefox görünümünde

_v2.32.32 olarak yayımlandı._

### Düzeltildi
- **"Yenilikler" bir güncellemeden sonra hiç görünmüyordu** ve 7 Eylül'den beri görünmemişti. Güncellemeden sonra Vex, sürümü atlayarak çalışan sürümün sürüm notlarını ister. O gün arayüzün ana programdan istediği her şeye eklenen bir güvenlik denetimi sürümün verilmesini gerektiriyordu, bu yüzden isteği reddediyordu. Ret yutuldu ve açılır pencere sessizce görünmedi. "Yenilikler"i elle açmak yine de çalışıyordu, bu yüzden kimse fark etmedi.
  - Sürüm artık atlanabilir ve sürüm notlarının okunamaması artık sessizce atılmak yerine Sağlık'ta kaydediliyor.
  - Yeni bir test, arayüzden gelen **her** çağrıyı ana programın kabul ettikleriyle karşılaştırıyor. Bunu buldu, başkasını bulmadı.
  - Düzeltmeden önce yeniden üretildi: son görülen sürüm 2.31.97 olarak ayarlandı ve başlangıç kodu çalıştırıldı. Hiçbir şey görünmedi; artık görünüyor.
- **Ctrl+K, komut çubuğu düğmesine tıklayana kadar hiçbir şey yapmıyordu.** Çoğu zaman odak bir sayfanın içinde (Yeni Sekme sayfası da bir sayfadır) ve sayfalar Ctrl+K'yi hiçbir zaman Vex'e iletmiyordu.
  - Artık komut çubuğunu herhangi bir sayfanın içinden açıyor.
  - İstisnalar, kendi Ctrl+K'leri geçiş penceresi olan Discord ve Slack'tir. Düğme orada yine de Vex'inkini açar.
  - Firefox görünümünde Yeni Sekme sayfasının içinde basılarak sınandı.
- **Bir zamanlayıcıyı başlatmak ya da durdurmak 2-3 saniye sürüyordu.** Zamanlayıcı, görünmeden ya da kaybolmadan önce Windows'un uyandırma görevini kaydetmesini bekliyordu; bu da PowerShell'i başlatmak demektir.
  - Artık hemen görünüyor ve gidiyor, Windows'a sonradan bildiriliyor.
  - Kaydı hâlâ sürerken durdurulan bir zamanlayıcının geç gelen uyandırması kaldırılır; böylece sonradan çalamaz.
- **Çalışma paneli kaydırılamıyordu,** Firefox görünümünde ve Saat paneli de aynı gizli hataya sahipti. Bir paneli açmak düzenini düz bir bloğa zorluyordu. Bu, kendilerini kendi kaydırma alanlarıyla bir sütun olarak düzenleyen iki paneli bozdu ve içerikleri alttan taştı. Paneller artık kendi düzenlerini koruyor. Firefox görünümünde ve varsayılan görünümde sınandı: Çalışma ikisinde de kayıyor.
- **Firefox görünümünde kenar çubuğunu kapatıp yeniden açmak için bir düğme yoktu.** Artık araç çubuğunda Firefox'un kendi **Kenar çubuğu** düğmesi var ve **Ctrl+B** aynı işi yapıyor:
  - kenar çubuğunun tamamını (simge rayı ve açık panel) gizler ve geri getirir,
  - kenar çubuğu gösterilirken düğme vurgulanır,
  - seçim hatırlanır.
- v2.32.30'un sınayamadığı **bir web sayfasının içinde Ctrl+Alt+D** artık denetlendi: bir sayfanın içinden dikteyi başlatıyor.

### Ayrıca tamamlandı (fikir listesinden)
- **"Yerel yapay zekâ yavaş olacak" artık bir çıkış yolu sunuyor.** Artık yalnızca aracı için değil sohbette de görünen uyarının düğmeleri var:
  - **Bunun yerine ‹daha küçük bir model› kullan**: boş olan ekran kartı belleğine sığan, yüklü en büyük model.
  - Bir Yapay Zekâ Worker'ı kurulduysa **Bulutu kullan**.
  - Sonraki yanıt seçtiğinizi kullanır.
- **Tarihli yapılacaklar sizi uyarabilir.** Tarihli bir yapılacağın yanındaki bir zil, o günün 9:00'una (bugünse ve 9:00 geçtiyse bir sonraki saate) bir hatırlatıcı kurar ve zil kurulu olduğunu gösterir.

## v9.8.2 (2026-09-19) — Posta (salt okunur)

_v2.32.31 olarak yayımlandı._

### Notlar
- **Posta** (`Ctrl+K`). Gmail, Yahoo, iCloud ya da herhangi bir IMAP hesabından en yeni 50 ileti, okunmamış sayısıyla birlikte ve her ileti metin olarak, iki bölmeli bir pencerede.
- **Bilerek salt okunur.** Posta kutusu salt okunur açılır ve iletiler bayraklarına dokunmadan alınır. Vex'te okumak postayı asla okundu olarak işaretlemez, taşımaz ya da sunucuda hiçbir şeyi değiştirmez. Yanıtlamak için **Gmail'de yanıtla**, tam o iletiyi web postasında açar. Yahoo ve iCloud gelen kutusunu açar.
- **Hiçbir şey açtığınızı bildirmez.** İletiler metin olarak gösterilir; bu yüzden resimler ve diğer uzak içerik asla yüklenmez ve bir izleme pikseli istek almaz. Yalnızca HTML olan posta, hiçbir betiğin çalışamayacağı tarayıcının ayrıştırıcısı tarafından sözcüklerine dönüştürülür. Bağlantılar yeni bir sekmede açılır. Ekler ad ve boyutla listelenir, web postasından indirilmek üzere.
- **Oturum açma:**
  - Ana parolanızı değil, Gmail, Yahoo ve iCloud'un posta programları için verdiği türden bir **uygulama parolası** kullanır. Pencere her sağlayıcının onu nereye sakladığını söyler.
  - Vex parolayı saklamadan önce denetlemek için bir kez oturum açar. Adresler ve parolalar, **Windows tarafından şifrelenmiş** tek bir dosyada tutulur ve bir parola bir daha gösterilmez.
  - Diğer sağlayıcılar: IMAP sunucusunu girin. 993 numaralı bağlantı noktasında bağlantı baştan şifrelidir. Başka herhangi bir bağlantı noktasında Vex, parolayı göndermeden önce şifrelemeye (STARTTLS) geçmekte ısrar eder. Tek istisna, ProtonMail Bridge gibi bu bilgisayardaki bir programdır.
- **Dürüst bir sınır:** **Outlook.com ve Hotmail burada okunamaz.** Microsoft artık posta programlarının parolayla oturum açmasına izin vermiyor ve kendi oturum açma akışını zorunlu kılıyor. Vex bunu oturum açmada başarısız olmak yerine baştan söyler.
- **Yerel bir test posta sunucusuna karşı canlı sınandı:**
  - Yanlış bir parola nedeniyle reddedildi, doğrusu oturum açtı.
  - İzleme pikseli olan bir HTML iletisi metin olarak gösterildi ve pikselin sunucusu **0 istek** aldı.
  - Okunmamış ileti sonrasında sunucuda **hâlâ okunmamıştı.**
  - Kayıtlı hesaplar dosyası şifrelidir, düz metin olarak hiçbir parola yoktur.
- O testte bulundu ve yayımlanmadan önce düzeltildi: posta kitaplığının HTML postanın kendi metin sürümü, izleme pikseli dahil her resmin adresini tıklanabilir bir bağlantı olarak listeliyordu. Vex artık metni onlar olmadan kendisi yapıyor.

## v9.3.2 (2026-09-19) — Dikte

_v2.32.30 olarak yayımlandı._

### Notlar
- **Dikte et** (**Ctrl+Alt+D** ya da Ctrl+K › Dikte et). İmleci bir web sayfasında ya da Vex'te herhangi bir metin kutusuna koyun, Ctrl+Alt+D'ye basın, konuşun ve yeniden basın (ya da **Durdur**). Sözcükler imlecin olduğu yere yazılır. **Esc** ya da × kaydı atar.
- **Bu bilgisayarda çalışır.** Electron'un kendi konuşma tanıması yok; Chrome'unki sesinizi Google'a gönderir. Bu yüzden Vex OpenAI'nin Whisper'ını kendisi çalıştırır:
  - Model Hugging Face'ten bir kez indirilir, **yalnızca siz evet dedikten sonra**: Base 73 MB; Small 238 MB, daha yavaş ama özellikle İngilizce dışındaki diller için belirgin biçimde daha iyi.
  - Bundan sonra çevrimdışı çalışır ve söylediğiniz hiçbir şey bilgisayardan çıkmaz.
  - İlk seferde model inerken kaydeder; böylece hemen konuşmaya başlayabilirsiniz.
- **Oyunlara ve belleğe saygılı:**
  - Normalde ekran kartında çalışır, ama **bir oyun çalışırken işlemcide** (Vex'in oyun algılaması), böylece bir oyunun kare hızına asla zarar vermez.
  - Model, en son dikte etmenizden iki dakika sonra bellekten bırakılır.
- **Dikte Ayarları** (Ctrl+K): model, konuştuğunuz dil (ya da Whisper'ın algılamasına izin verin) ve **İndirilen modelleri kaldır**.
- Vex'in kendi penceresi artık istem olmadan mikrofonu kullanabilir ve **yalnızca** mikrofonu, asla kamerayı; dikte bunu kullanır. Web sayfaları eskisi gibi yine sorar.
- **Canlı sınandı:** bir sayfanın metin kutusunda, söylenen bir cümle *"Remind me to call the dentist tomorrow morning at 9."* olarak çıktı. Bu, test makinesinde bir oyun çalıştığı için işlemcideydi ve 4 saniyelik konuşma için yaklaşık 6 saniye sürdü; ekran kartı daha hızlı. Sayfa içi **Ctrl+Alt+D** tuşu testlerle kapsanıyor, ama otomatik testte odaktaki pencereye bir şey yazmadan gerçekten basılamadı; bu yüzden önce onu deneyin.

## v8.98.2 (2026-09-19) — Yeniden yapın

_v2.32.29 olarak yayımlandı._

### Notlar
Saat'te ve başka yerlerde daha önce yaptığınız eylemleri tekrarlayabilmeyi istediniz. Artık dört yer hatırlıyor:
- **Saat: zamanlayıcılar.** Başlattığınız her zamanlayıcı süresi ve etiketiyle hatırlanır (son 8, yinelenmeden). Hazır ayarların altında "3:00 · Çay" ya da "25:00 · Odak" gibi **Yeniden** çipleri bir tıkla yenisini başlatır.
- **Saat: alarmlar.** Kurduğunuz her alarm hatırlanır: saat, günler ve etiket. Artık kurulu olmadığında (çalmış tek seferlik bir alarm ya da kaldırdığınız), aynı günlerle **Yeniden kur** altında görünür.
- **Hatırlatıcılar.** *Hatırlat* içinde geçmiş hatırlatıcıların bir **Yeniden hatırlat** listesi var. Orada kurduklarınızı ve son haftada çalmış olanları, nasıl yapılmış olurlarsa olsunlar (Takvim, yapay zekâ), içerir. **Yeniden** metni, ilgili sayfayı, yinelemeyi ve aciliyeti doldurur ve sizi *Ne zaman?* kutusuna koyar, çünkü değişen tek şey zamandır.
- **Ctrl+K: Bunu Yeniden Yap.** Kullandığınız son komutu yeniden çalıştırır ve ipucu hangisi olduğunu söyler ("Yeniden: Bu Sayfanın Bağlantılarını Denetle"). Ayrıca Ayarlar'da yeniden atanabilen **Ctrl+Alt+A** üzerindedir. Vex'in diğer Ctrl+Alt kısayolları gibi, Vex penceresi odaktayken çalışır, bir web sayfasının içinde yazarken değil; web sayfaları kendi tuşlarını korur.
- **Sayfa denetimleri.** Bağlantı denetimi, hız denetimi, erişilebilirlik denetimi ve site taraması sayılarını sayfa başına saklar:
  - Aynı sayfanın bir sonraki denetimi **neyin değiştiğiyle** açılır, örneğin *Bozuk 2 → 1 · Çalışan 0 → 1* ya da *Geçen seferle aynı*.
  - Her raporda **Yeniden çalıştır** vardır. Hız denetimi için önce sayfayı yeniden yükler, çünkü zamanlamaları bir sayfa yüklemesini anlatır.
  - **Son Sayfa Denetimleri** (`Ctrl+K`) bunları listeler, herhangi birini yeniden çalıştırmak için. Başka bir sayfa gösteriliyorsa önce sayfayı açar.
  - Yalnızca sayılar saklanır, sayfa ya da rapor asla; özel ya da Tor sekmesinden hiçbir şey saklanmaz.
- Canlı sınandı: bir test sayfasındaki iki bozuk bağlantıdan biri düzeltildikten sonra Yeniden çalıştır *Bozuk 2 → 1 · Çalışan 0 → 1* bildirdi. Bir zamanlayıcı, bir alarm (Sal/Per 06:15) ve bağlantılı haftalık bir hatırlatıcı doğru geri geldi.

## v8.96.2 (2026-09-19) — İzlenen sayfalar olmaları gereken yerde görünür

_v2.32.28 olarak yayımlandı._

### Düzeltildi
- **"Değişen izlenen sayfalar" her zaman boştu,** hem yeni sekme sayfasının **Bugün** kartında hem de Cuma **Haftalık Gözden Geçirme**'de. İkisi de listeyi hiç yazılmamış `WebMonitor` adlı bir modülden okuyordu; gerçeği *Bu değişince söyle* (`PageWatch`). Okuma korumalı olduğundan sessizce başarısız oluyordu. Testleri aynı eksik modülü taklit ettiğinden geçiyordu. İkisi de artık gerçek izlemeleri okuyor: Bugün son 24 saatte değişenleri, gözden geçirme son haftadakileri gösteriyor. Bir saat önce değişen izlenen bir sayfayla canlı denetlendi; ikisinde de görünüyor.
- **Yeni bir denetim bunun yeniden olmasını önler:** korumalı herhangi bir okuma, Vex'te hiçbir şeyin bildirmediği bir modülü adlandırırsa artık bir test başarısız oluyor. Eski koda karşı çalıştırıldığında tam olarak bu hatayı adlandırıyor ve başka hata bulmuyor.

### Notlar
- Fiyat uyarıları zaten var, bu yüzden onlar için yeni bir şey yapılmadı. *Bu değişince söyle*, bir sayfadaki bir sayıyı izleyebilir ve bir değerin **altına** (ya da üstüne) düştüğünde size söyleyebilir. Fiyat Geçmişi (v2.32.27) ile birlikte bu, "daha ucuz olunca söyle"yi karşılar.

## v8.95.2 (2026-09-19) — Fiyat geçmişi

_v2.32.27 olarak yayımlandı._

### Notlar
- **Fiyat Geçmişi** (`Ctrl+K`). Fiyat izleyiciler sizin için mağazaları tarayan hizmetlerdir ve karşılığında baktığınız her ürünü görürler. Vex kimseye ihtiyaç duymayan kısmı yapar:
  - Mağazalar fiyatlarını arama motorları için yayımlar (schema.org Product/Offer verisi ya da `product:price` etiketleri). Bir ürün sayfası açtığınızda Vex o fiyatı bu bilgisayarda, günde bir nokta olarak not eder.
  - O sayfada daha sonra Fiyat Geçmişi, baktığınız her seferde ne kadar olduğunu, **gördüğünüz en düşüğü** ve en yükseği, küçük bir grafikle gösterir.
  - Baktığınız diğer her ürün, ilk gördüğünüzden beri ne kadar yükselip düştüğüyle listelenir.
- **Neyi kaydettiğine dikkat eder:**
  - Temiz bir sayı olmayan bir fiyat atlanır, asla tahmin edilmez.
  - İzleme etiketleri (`utm_…`, `gclid`, …) yok sayılır; böylece bir ürün bir satırdır.
  - Bir mağaza para birimini değiştirirse sterlinle avroyu karıştırmak yerine yeni bir satır başlar.
  - Özel ve Tor sekmeleri asla okunmaz. Sayfadaki "Fiyatları not et" anahtarı onu kapatır ve **Hepsini unut** geçmişi siler.
- **Dürüst bir sınır:** yalnızca bugünden itibaren açtığınız sayfaların fiyatlarını bilir. Mağazaları kendiliğinden denetlemez ve fiyatını yayımlamayan bir sayfa kaydedilmez.
- Yerel bir test mağazasında canlı sınandı: fiyat bülten etiketi çıkarılarak not edildi ve gerçek bir özel sekmede açılan aynı türden sayfa reddedildi ve hiç kaydedilmedi.

### Dahili
- v2.32.26'nın CI çalıştırması başarısız oldu. Üç Takvim testi, Vex'in Chromium 148'inde olan ama CI'nin test ettiği Node 22'de olmayan `Intl.Locale.getWeekInfo()` kullanıyordu: o, standart yeniden adlandırmadan önceki eski `weekInfo` özelliğine sahip. Takvim artık ikisinden birini okuyor ve ikisi de yoksa bunu açıkça söylüyor. Tüm takım artık CI'nin yaptığı gibi her sürümden önce yerelde Node 22 altında da çalışıyor.

## v8.93.2 (2026-09-19) — Takvim

_v2.32.26 olarak yayımlandı._

### Notlar
- **Takvim** (`Ctrl+K`). Vex zaten tarihli şeyleri iki ayrı listede tutuyordu: hatırlatıcılar ve tarihli yapılacaklar (`@2026-10-03`, `@tomorrow`) ve hiçbiri bir ay göstermiyordu. Şimdi biri gösteriyor:
  - Hatırlatıcılar kendi günlerinde görünür. **Yinelenen bir hatırlatıcı, yineleneceği her günde görünür:** günlük, hafta içi, haftalık ya da belirli günler.
  - Notlarınızdaki tarihli yapılacaklar kendi günlerinde görünür ve orada işaretlenebilir.
  - Gelecekteki herhangi bir güne tıklayarak o güne **bir hatırlatıcı ekleyin.** Diğer her şey gibi aynı hatırlatıcı sisteminden geçer; bu yüzden Vex kapalı olsa bile bildirir.
  - Hafta, yerel ayarınızın başlattığı yerde başlar: ABD'de Pazar, Avrupa'nın çoğunda Pazartesi.
- Alarmlar ve zamanlayıcılar saatte kalır, çünkü her karedeki günlük bir alarm hiçbir şey söylemez. Vex'in kendi haftalık gözden geçirme hatırlatıcısı da dışarıda bırakılır.
- **Dürüst bir sınır:** bu Google ya da Outlook'a bağlı değildir; bu, oradaki hesabınızı gerektirirdi. Zamanlı herhangi bir hatırlatıcı yine de eskisi gibi bir takvim dosyası olarak onlara kaydedilebilir.

## v8.91.2 (2026-09-19) — Paketler

_v2.32.25 olarak yayımlandı._

### Notlar
- **Paketler** (`Ctrl+K`). Bir takip numarası yapıştırın ve Vex siz yazarken kimin olduğunu söyler: UPS, USPS, FedEx, DHL, Royal Mail, Canada Post, Australia Post ya da Amazon. Diğer ülkelerden uluslararası posta, bağımsız bir hizmet olarak etiketlenen 17TRACK'e gider.
- **Biçimin bir tane olduğu yerlerde kontrol basamakları doğrulanır:** UPS `1Z…` ve uluslararası posta biçimi `AB123456789GB`. Rastgele bir dize paket sanılmaz.
- Yalnızca rakamlardan oluşan numaralar kargo şirketleri arasında paylaşılır (bir FedEx numarası on iki herhangi bir rakama benzer), bu yüzden bunlar **"Muhtemelen FedEx"** der ve kargo şirketi seçilebilir.
- Beklediklerinizin etiketli bir listesini tutun ("Yeni ayakkabılar", "İngiltere'den kitap"). **Takip et** kargo şirketinin sayfasını açar, **Kopyala** numarayı kopyalar ve çöp kutusu geldiğinde onu kaldırır.
- **Dürüst bir sınır:** Vex durumu kendisi getirmez. Her kargo şirketinin takip API'si bir işletme hesabı ve anahtar gerektirir ve onları birleştiren ücretli hizmetler aldığınız her paketi görürdü. Bu yüzden Takip et'e basana kadar hiçbir yere hiçbir şey gönderilmez ve durum kargo şirketinin kendi sayfasındadır.

## v8.89.2 (2026-09-19) — Harcamalar

_v2.32.24 olarak yayımlandı._

### Notlar
- **Harcamalar** (`Ctrl+K`). Harcadığınızı kaydedin: bir tutar, bir kategori, isteğe bağlı bir not ve gün. Ay görünümü toplamı, geçen ayla nasıl kıyaslandığını ve her kategori için bir çubuk gösterir. Okla önceki aylara geri dönün. **CSV'yi dışa aktar** hepsini bir e-tabloya verir.
- **Tam toplamlar.** Tutarlar kayan noktayla değil, tam sent olarak tutulur; böylece otuz tane 0,10'luk giriş tam olarak 3,00 eder.
- **İnsanların parayı yazdığı gibi yazılır:** `12.50`, `12,50`, `1,234.56`, `1.234,56`, `£12`. Belirsiz ya da bozuk her şey tahmin edilmek yerine bir nedenle reddedilir.
- **Üstte seçilen tek bir para birimi.** *Farklı* bir para biriminde yazılmış bir tutar (USD'yi korurken `£45` yazmak) sessizce dolar olarak yeniden etiketlenmez, reddedilir.
- CSV bir e-tabloda açmak için güvenlidir: `=`, `+`, `-` veya `@` ile başlayan bir not formül olarak çalıştırılmaz, metin olarak dışa aktarılır.
- Her şey bu bilgisayarda kalır. Kayıtlı günlük hiç okunamazsa Vex, üzerine yazılacak boş bir tane başlatmak yerine bunu söyler.
- Yayımlanmadan önce canlı testte bulundu: daha önceki bir ayda bir şey kaydettikten sonra gün kutusu o ayın 1'ine varsayılıyordu; bu yüzden sonraki girdiler sessizce geriye tarihleniyordu. Artık her zaman bugünle başlıyor.

## v8.87.2 (2026-09-19) — Bu siteyi tara

_v2.32.23 olarak yayımlandı._

### Notlar
- **Bu Siteyi Tara** (`Ctrl+K`). *Bu Sayfanın Bağlantılarını Denetle* tek bir sayfa için yanıt verir; bu ise sitenin tamamı için yanıt verir. Bulunduğunuz sayfadan başlayarak Vex aynı site içindeki bağlantıları izler, en fazla 200 sayfaya kadar gider ve düzeltilmesi gerekenleri listeler:
  - **bozuk sayfalar ve her birine bağlantı veren sayfa** ("Bağlantı veren sayfayı aç"), çünkü ölü bir adres ancak bağlantının verildiği yerde düzeltilebilir
  - sunucu hataları ve oturum açmayı gerektiren sayfalar
  - yavaş sayfalar (3 saniyeden uzun)
  - sayfada ya da `X-Robots-Tag` başlığında `noindex` ile aramadan gizlenmiş sayfalar
  - eksik başlıklar, birkaç sayfada aynı olan başlıklar ve eksik açıklamalar
  - yönlendirmeden geçen bağlantılar
  - **Raporu kopyala** her şeyi düz metin olarak verir.
- **Tasarımı gereği kibar:**
  - Aynı sitede kalır ve `Crawl-delay` dahil **robots.txt'ye uyar**; bu, beklemeyle birlikte her seferinde bir sayfa demektir.
  - RFC 9309'a uygun olarak, robots.txt dosyasını sunamayan (sunucu hatası ya da yanıt yok) bir site hiç taranmaz. robots.txt'si olmayan bir site sorun değildir.
  - Yalnızca HTML okur. Bir zip ya da video gibi başka her şey için yalnızca durumu sorulur ve asla indirilmez.
  - `nofollow` bağlantıları ve sayfaları atlar; **Durdur**'a bastığınız ya da sayfayı kapattığınız anda durur.
  - İstekler, bağlantı denetleyicisinin kullandığıyla aynı, çerezsiz ve oturumsuz boş bir oturumdan gelir. Özel ya da Tor sekmelerinde asla çalışmaz.
- Yerel bir test sitesinde canlı olarak sınandı; sitede bilerek bırakılmış bir bozuk bağlantı, yönlendirme, yavaş sayfa, yinelenen başlık, noindex sayfası, robots.txt tarafından engellenmiş bir sayfa ve dışarıya giden bir bağlantı vardı. Hepsi bildirildi ve sunucunun günlüğü engellenen sayfaya ve dış siteye hiç ulaşılmadığını gösteriyor.

## v8.86.2 (2026-09-19) — Beyaz tahta

_v2.32.22 olarak yayımlandı._

### Notlar
- **Beyaz Tahta** (`Ctrl+K`). Üzerine çizim yapabileceğiniz boş beyaz bir sayfa; **Bu Sayfayı İşaretle** ile aynı kalem, fosforlu kalem, kutu, ok, metin ve geri alma araçlarına sahiptir. PNG olarak kaydedin ya da kopyalayın.
- Kalem kırmızı yerine koyu renkle başlar ve Gizle düğmesi yoktur, çünkü boş bir sayfada gizlenecek bir şey yoktur.
- **Çizim yaptıktan sonra kapatırken önce sorar.** İşaretlenmiş bir ekran görüntüsü yeniden alınabilir, ama bir karalama alınamaz. Boş bir tahtayı kapatırken sormaz.

### Dahili
- Birim testinde değil, canlı testte bulundu: komut düzenleyiciye önce var olmayan `window.ScreenshotTool` olarak ulaşıyordu (bu bir üst düzey `const`), bu yüzden Ctrl+K hiçbir şey yapmıyordu. Artık komşuları gibi çıplak adı kullanıyor; mevcut koruma testi bu kalıbı kapsıyor.

## v8.84.2 (2026-09-19) — Alışkanlıklar

_v2.32.21 olarak yayımlandı._

### Notlar
- **Alışkanlıklar** (`Ctrl+K`). Her gün yapmak istediğiniz bir şeye ad verin ve işaretleyin. Her alışkanlık son yedi günü işaret kutuları olarak, sürdürdüğünüz seriyi ve en iyi serinizi gösterir.
- **Bilerek esnek.** Bugün ve önceki altı gün işaretlenebilir; böylece unutulan bir dün yine de sayılır. İşaretlenmemiş bir bugün, gün bitene kadar seriyi bozmaz.
- Günler, yerel takvim tarihlerinizdir; bu yüzden 23:50'de yapılan bir şey o güne sayılır.
- Kayıtlı alışkanlıklar okunamazsa Vex, üzerlerine yazılacak boş bir liste başlatmak yerine bunu söyler.

## v8.82.2 (2026-09-19) — Görev panosu

_v2.32.20 olarak yayımlandı._

### Notlar
- **Görev Panosu** (`Ctrl+K` ya da Yapılacaklar listesindeki **Pano** düğmesi). Not görevleriniz üç sütunda: **Yapılacak**, **Yapılıyor** ve **Bitti**. Bir kartı başka bir sütuna sürükleyin ya da okları kullanın.
- **Birbirinden kopabilecek ayrı bir pano yok.** Taşıma, görevin kendi notundaki satırında yapılan bir düzenlemedir: Yapılıyor `@doing` ekler, Bitti kutuyu işaretler, Yapılacak ikisini de temizler. Bir nota kendiniz `@doing` yazabilirsiniz de, görev Yapılıyor'da görünür.
- Bitti, işaretlenmiş her görevi değil, en son biten 20 görevi gösterir.
- Panoya yalnızca Vex'in kendi kartları bırakılabilir; sıradan metni üzerine sürüklemek hiçbir şey yapmaz.

### Dahili
- v2.31.96'dan beri her işlemede bildirilen CI hataları düzeltildi (altı lint hatası ve yüksek önemde bir uyarı nedeniyle adm-zip 0.6.1'e güncellendi). Düzeltme için çalışan "Verify Vex" her adımı geçti.

## v8.79.2 (2026-09-19) — Bu sayfa neden yavaş?

_v2.32.19 olarak yayımlandı._

### Notlar
- **Bu Sayfa Neden Yavaş?** (`Ctrl+K`). Chromium, bir sayfanın nasıl yüklendiğiyle ilgili her şeyi ölçer ve sayfanın içinde tutar; ama DevTools'u açıp nereye bakacağını bilmeden kimse görmez. Vex artık bunu okuyor ve açık bir dille söylüyor:
  - **Her biri derecelendirilmiş dört zamanlama**, Google'ın Core Web Vitals eşiklerine göre: sunucunun ne zaman yanıt verdiği, ilk şeyin ne zaman çizildiği, ana içeriğin ne zaman göründüğü (ve ne olduğu) ve düzenin ne kadar zıpladığı.
  - **Suçlular, kelimelerle:** ilk çizimi geciktiren sayfa başlığındaki betikler; gösterildiğinden çok daha büyük gönderilen resimler; binlerce öğeden oluşan sayfalar; ağır indirmeler ve başka şirketlerin sunucularına yapılan istekler.
  - **En ağır dosyalar** ve düz metin için **Raporu kopyala**.
- **Ölçülmüş, dürüst bir sınır:** diğer sitelerdeki sunucular, açıklamayı seçmedikçe dosyalarının boyutunu gizler; bu yüzden büyük bir haber sitesindeki her reklam ve izleyici 0 bayt bildirdi. Bu nedenle indirme toplamları **"en az"** olarak gösterilir ve Vex kaç dosyanın boyutunu gizlediğini söyler. Diğer şirketlerden gelen pay, her zaman görülebilen **isteklerle** sayılır; bayt cinsinden sayılsaydı payı çok düşük gösterirdi.
- example.com'da (Hızlı, hiçbir şey bulunmadı) ve The Verge'de (Hızlı zamanlamalar, ama ilk çizimi engelleyen iki betik ve 5.127 öğeli bir sayfa) sınandı.

## v8.78.2 (2026-09-19) — Gün boyu şişmeyen Discord

_v2.32.18 olarak yayımlandı._

### Notlar
- **Önce ölçüldü.** Bildirimi yapan makinede Discord panelinin işlemi tek başına **2,15 GB** tutuyordu; Vex'in geri kalanı ise toplam yaklaşık 1 GB tutuyordu. Discord, bildirimleri gelsin diye uyanık tutulur; yani hiç uyutulmadı ve hiç yeniden yüklenmedi, bütün gün açık bırakılan bir Discord de büyümeye devam eder.
- **Discord artık bir bellek sınırına sahip** (Ayarlar › Performans, varsayılan **1,5 GB**, ya da Asla / 700 MB / 1 GB / 2 GB). Sınır aşıldığında Vex yeni bir Discord getirir, ama yalnızca bunun size hiçbir maliyeti olmadığında:
  - **gizlidir**: baktığınız panel değil ve yanındaki de değil
  - **görüşmede değilsiniz**: mikrofon ya da kamera yok, çalan bir şey yok, ekranda Bağlantıyı kes düğmesi yok
  - en fazla **30 dakikada bir**
  - Oturum açık kalır ve bildirmeye devam eder; yalnızca temiz başlar. Canlı denetlendi: panel gizliyken yeni bir işlem başladı ve sonradan açıldığında yenisi görüldü.
- **Çok düşük bir sınır döngüye giremez.** Yenilemeden üç dakika sonra Vex yeni Discord'u ölçer. Yeni olan zaten sınırınıza yakınsa Vex, tekrar tekrar yenilemek yerine sınırı bir kez onun üstüne çıkarır ve size söyler.
- Mevcut "Discord … kullanıyor" bildirimi, Discord açıkken yine görünür. Bir yenileme onu temizler, çünkü içindeki sayı eskimiştir.

### Eklenti incelemesinin bulduğu (kendi Vencord derlemeniz için)
- Kod incelemesi **MessageLoggerEnhanced**'ı diğer her şeyin çok üstünde sıraladı: her sunucu ve DM'ler için bellekte **sunucu başına 2.000 iletiye** kadar tutuyor. **MessageLogger** da açıksa iş iki kez yapılır. Sırada **AutoExport** (5 dakikada bir tam üye listesi isteği), **ShowHiddenChannels**, **PlatformIndicators** ve **WhoReacted** var. Büyük bir sunucuda tüm üye listesini açan bir pencere (RoleMembers, ServerMemberExporter, WhipCount, ServerInfo, PermissionsViewer) açmak, Discord yeniden yüklenene kadar bu üyeleri bellekte tutar; yeni sınırın temizlediği bir başka şey de budur.

### Dahili
- Bir web paneli oluşturma işlemi kendi işlevine taşındı; böylece bir panel gösterilmeden yeniden oluşturulabilir. Bir paneli göstermek eskisi gibi çalışıyor (361 panel testinin hepsi geçiyor).
- Yayından önce testlerin bulduğu: hiçbir şey kayıtlı değilken sınır 0 ("Asla") okunuyordu; yani özellik herkes için kapalı olarak yayımlanacaktı.

## v8.76.7 (2026-09-19) — Ekranı kaydet

_v2.32.17 olarak yayımlandı._

### Notlar
- **Ekranı Kaydet** (`Ctrl+K`, durdurmak için yeniden çalıştırın). Birine bir şeyin nasıl yapıldığını ya da neyin ters gittiğini göstermek bir videodur ve bugüne kadar bu, bir kayıt programı kurmak demekti. Discord ekran paylaşımının kullandığı seçicide bir ekran ya da pencere seçin, isterseniz sesiyle birlikte. Üstteki kırmızı bir hap süreyi gösterir ve **Durdur** ile **At** düğmeleri vardır. Durdurduğunuzda nereye kaydedeceğinizi seçersiniz.
- **Kayıt sırasında diske yazılır**, her saniye bir parça; bu yüzden uzun bir kayıt asla bellekte yığılmaz. Atmak ya da kaydetmeyi reddetmek onu siler; geçici bir klasörde gizli hiçbir şey kalmaz. Paylaşımı Windows'un kendi "Paylaşımı durdur" çubuğundan bitirmek de aynı şekilde durdurur ve kaydeder.
- **Neden MP4 değil de WebM**, varsayılarak değil ölçülerek: bu derleme MP4 kaydedebiliyor, ama MP4 kaydedicisi siz Durdur'a basana kadar hiçbir şey vermiyor (36 baytlık bir başlık, sonra sessizlik); yani tüm kayıt sürdüğü kadar bellekte dururdu. WebM (VP9 video + Opus ses) parça parça gelir. Windows'un Media Player'ında, Chrome'da, VLC'de ve Discord'da oynar.

### Düzeltmeler (bunu yaparken bulundu)
- Vex'in kendi penceresine ekran yakalama reddediliyordu; bu yüzden kaydedici, herhangi bir seçici görünmeden "İzin reddedildi" ile başarısız oluyordu. Vex'in kendi arayüzü artık ekranı yakalayabiliyor, ve yalnızca ekranı (mikrofonunuzu ya da kameranızı değil). Neyi yakalayacağınızı seçicide siz seçersiniz ve onay budur. Web sayfaları yine normal izin istemini alır.
- Vex'in kendi parçaları arasında geçen verilere yönelik güvenlik denetimi, ikili verinin her baytını ayrı bir öğe olarak sayıyordu. Tek bir saniyelik video 30.000 öğelik sınırı aşıyordu, bu yüzden her parça reddediliyordu. İkili veri artık bir boyut sınırıyla tek blok olarak denetleniyor.
- Seçiciyi iptal etmek ve seçici hiç açılmadan reddedilmek, ikisi de "hiçbir şey seçmediniz" gibi görünüyordu. Artık bir ret bunu söylüyor.
- Bir parça yazılamazsa, At geçici dosyayı geride bırakabiliyordu. Artık bırakamaz.

## v8.71.7 (2026-09-19) — Bir sayfayı işaretle ve özel olanı gizle

_v2.32.16 olarak yayımlandı._

### Notlar
- **Bu Sayfayı İşaretle** (`Ctrl+K`) ekrandakini yakalar ve doğrudan işaretleme düzenleyicisinde açar. Eskiden üç adım gerekiyordu: ekran görüntüsü, önizleme, sonra Not al.
- **Gizle.** Bir e-posta adresinin, bir adın, bir sipariş numarasının ya da bir bakiyenin üzerini sürükleyin; okunamayan düz bloklara pikselleştirilir. Bu, kendi hesabınızın ekran görüntüsünü güvenle paylaşmak için olan araçtır. Gizleme, kaydedilen resimdeki **pikselleri değiştirir**; soyulabilecek bir katman ya da birinin geri alabileceği bir siyah kutu değildir. Canlı denetlendi: example.com'un başlığı okunamaz çıktı.
- **Fosforlu kalem** ve **Metin**, Kalem, Kutu ve Ok'a katıldı. Metin, her arka planda okunabilir kalması için koyu bir çerçeve alır.
- Her araç artık onunla ne yapılacağını anlatan tek satırlık bir ipucu gösteriyor ve araç çubuğu yazılmış simgeler yerine düzgün simgeler kullanıyor.

### Düzeltmeler
- **Kopyalama sessizce başarısız oluyordu.** Windows resmi reddederse düzenleyici kapanıyordu ve panonuzda hiçbir şey olmuyordu, bundan söz de edilmiyordu. Artık size söylüyor ve çalışmanızı açık tutuyor; böylece onu kaydedebilirsiniz.

## v8.69.7 (2026-09-19) — Her not'taki her yapılacak, tek listede

_v2.32.15 olarak yayımlandı._

### Notlar
- **Yapılacaklar Listesi** (`Ctrl+K`). Notlar `- [ ] thing` satırını zaten gerçek bir onay kutusuna dönüştürüyordu. Ama kontrol listelerinizi *bir arada* göstermiyordu; bu yüzden bir kazan teklifi hakkındaki notun ortasına yazılan bir görev, ancak o notu açarsanız yeniden karşınıza çıkıyordu. Artık tek bir liste, her nottaki her açık görevi toplar.
  - **Listede işaretleyin, notunda da işaretlenir.** O not aynı anda düzenleyicide açık olsa bile işaret kaybolamaz. Not işaretlendiği sırada açıkken, gerçek Notlar düzenleyicisine karşı canlı denetlendi.
  - **Yapılacak ekle** (`Ctrl+K` ya da listenin üstündeki kutu) görevi, ilk seferde oluşturulan *Yapılacaklar* adlı sabitlenmiş bir nota koyar.
  - **Tarihler:** bir görevi `@tomorrow`, `@today` ya da `@2026-10-03` ile bitirin. Tarihli görevler öne gelir, süresi geçenler kırmızıyla işaretlenir ve tarih etiketi listede gizlenir.
  - **Notu aç**, sizi görevin yazıldığı yere götürür.
- Bu, Notlar'ın yanında ikinci bir yapılacaklar uygulaması değildir. Her görev, yazdığınız notta bir satır olarak kalır; böylece görevlerinizin gerçekten yaşadığı tek bir yer vardır ve diğer notlarınız gibi eşitlenir.

## v8.67.7 (2026-09-19) — Bu sayfayı herkes kullanabilir mi?

_v2.32.14 olarak yayımlandı._

### Notlar
- **Bu Sayfanın Erişilebilirliğini Denetle** (`Ctrl+K`). Erişilebilirlik denetimleri genellikle çoğu kişinin hiç açmadığı geliştirici araçlarında bulunur ve çoğu kişinin okuyamadığı WCAG ölçüt numaralarıyla rapor verir. Sorunların kendisi ise basittir; bu yüzden Vex artık önünüzdeki sayfayı bunlar için denetliyor ve açık bir dille söylüyor:
  - **açıklaması olmayan resimler** (ekran okuyucu dosya adını okur ya da resmin vurguladığı noktayı atlar)
  - **etiketi olmayan form kutuları** (yalnızca yer tutucu, bakmaya değer diye işaretlenir, çünkü yazmaya başlar başlamaz kaybolur)
  - **kelimesi olmayan düğmeler ve bağlantılar** (genellikle bir simge, yalnızca "düğme" diye okunur)
  - **okunamayacak kadar soluk metin**, WCAG'nin kendi kontrast formülüyle: normal metin için 4,5:1, büyük metin için 3:1. Arka plan resminin üzerindeki metne tahmin yürütmek yerine dokunulmaz.
  - **bir düzeyi atlayan başlıklar** ya da hiç ana başlık olmaması
  - **eksik bir sayfa dili ya da başlığı**
- Her bulgunun, düzeltilecek öğeyi çerçeveleyen **Sayfada göster** düğmesi vardır. **Raporu kopyala**, sitenin sahibi için düz metin verir. Tekrar eden bir bulgu bir kez söylenir ve uygulandığı her öğe altında listelenir.
- W3C'nin kasıtlı olarak erişilemez hazırladığı kendi gösterim sitesine karşı sınandı: 12 açıklamasız resim ve 7 kelimesiz bağlantı dahil **22 bulgu**. Aynı sitenin W3C'nin *düzeltilmiş* sürümünde: **hiçbir şey bulunmadı**; yani yanlış alarm yok.
- Ne olduğunu açıkça söyler: yaygın, kesin hatalar; bir site sahibinin bir öğleden sonrada düzeltebileceği türden. Tam bir WCAG denetimi değildir ve temiz bir sonuç bunu belirtir.

## v8.66.7 (2026-09-19) — Vex oyununuzun yolundan çekiliyor

_v2.32.13 olarak yayımlandı._

### Notlar
- **Önce gerçekler; 16 GB'lık, RTX 4060'lı (8 GB) bir makinede ölçüldü.** Ollama'nın Vex ile çalışması, oyun oynarken size hiçbir şeye mal olmaz: boştayken **29 MB RAM ve hiç grafik belleği yok**. Gerçek maliyet, yakın zamanda kullandığınız bir yapay zekâ modelidir. qwen3.5 kartın 8 GB'ının yaklaşık **5,5 GB'ını** tutar ve Ollama onu son yanıttan sonra **5 dakika** orada tutar. O aralıkta bir oyun başlatırsanız, oyun video belleği için modelle savaşır. Arka plan sekmeleri de RAM'e mal olur.
- **Tam ekran bir oyun başladığında Vex artık kendiliğinden üç şey yapar** (Ayarlar › Oyun, her biri kendi anahtarıyla, hepsi açık):
  - **Grafik kartını boşaltır.** Yüklü her model boşaltılır. Oyun sırasında yapay zekâya bir şey sorarsanız yine yanıt alırsınız ve model hemen ardından karttan ayrılır.
  - **Arka plan sekmelerini uyutur.** Bulunduğunuz sekme dışındaki her sekme; ama müzik çalan, görüşmede olan ya da uyanık tuttuğunuz bir sekme **uyutulmaz**. Bıraktığınız yerde uyanırlar.
  - **Arka plan yapay zekâsını bekletir.** Zamanlanmış yapay zekâ görevleri siz bitirene kadar bekler ve sonra yetişir, geçmiş dizinleme duraklar. Sizin istemediğiniz hiçbir şey kartınıza model yüklemez.
- Siz oynarken hiçbir şey açılmaz; bir oyunun üzerinde bildirim, amacın tam tersidir. Geri döndüğünüzde Vex ne yaptığını söyler, örneğin *"Roblox oynarken Vex 2,4 GB grafik belleğini boşalttı ve 3 sekmeyi uyuttu."* Bu, canlı bir testteki gerçek iletidir.
- **Yapay zekâ modeli artık bir yanıttan 1 dakika sonra boşaltılır**, Ollama'nın 5 dakikası yerine. Tek maliyeti, bir duraklamadan sonra gelen bir soru için birkaç saniyelik yeniden yüklemedir. Ayarlar › Oyun'da 0, 1, 5 ya da 15 dakikayı seçebilirsiniz.
- **Bir oyunun çalıştığını nasıl anlıyor:** Windows'un oyunlar sırasında bildirimleri tutmak için kullandığı sinyali kullanır. Bu, özel ve kenarlıksız tam ekranı kapsar ve oyundan hiçbir şey okunmaz. Vex'in bir video için tam ekran olması sayılmaz. Canlı testte Roblox'u doğru algıladı.
  - Denetim, **16 MB** kullanan küçük, gizli bir yardımcıda çalışır. Windows'un içindeki C# derleyicisiyle bir kez derlenir. İlk sürüm **135 MB**'lık bir PowerShell döngüsüydü, bu da amacı boşa çıkarıyordu; bu yüzden yayından önce değiştirildi. Yardımcı hiç pencere göstermez ve Vex kapanınca kendini kapatır.
- Dürüst sınır: başka bir programdaki (örneğin VLC) tam ekran video Windows'a aynı görünür; bu yüzden Vex onu da oyun sayar. Tek etkisi, GPU'nun boşaltılması ve sekmelerin uyutulmasıdır.

## v8.62.9 (2026-09-19) — Bu sayfadaki hangi bağlantılar bozuk?

_v2.32.12 olarak yayımlandı._

### Notlar
- **Bu Sayfanın Bağlantılarını Denetle** (`Ctrl+K`). Bağlantılarla dolu bir sayfa çürür: eski bir yazı taşınmış bir makaleye, bir mağaza ilanı ölü bir ürüne, kendi siteniz sildiğiniz bir sayfaya işaret eder. Bugüne kadar bunu onlara tek tek tıklayarak öğreniyordunuz. Vex artık sayfadaki her bağlantıyı bir anda denetliyor ve yanıtları, ne yapacağınıza göre sıralıyor:
  - **Bozuk**: sayfa yok (404) ya da site artık yok.
  - **Sunucu hatası**: site şu anda çöküyor; sonra deneyin.
  - **Taşındı**: hâlâ çalışıyor, ama sizi başka yere gönderiyor ve nereye gönderdiğini gösteriyor. Bir sitenin yalnızca http'den https'ye geçmesi ya da `www` eklemesi taşınmış sayılmaz.
  - **Oturum açmayı gerektirir**: bir giriş ya da bot duvarı. Bu ölü bir bağlantı değildir, bu yüzden öyle bildirilmez.
  - **Sayfada göster**, bağlantıya kaydırır ve kırmızıyla çerçeveler, çünkü düzelttiğiniz şey bir listedeki adres değil, paragraftır. **Raporu kopyala**, sayfanın sahibine göndermeniz için düz metin verir.
- Kibardır: aynı anda altı istek, hiçbir sayfa indirilmesin diye önce hızlı, yalnızca başlık denetimi, bağlantı başına 12 saniyelik sınır ve en fazla 300 bağlantı.
- **Özeldir.** Denetimler ayrı, boş bir oturumdan çıkar: çerez yok, oturum yok, gezintinizden hiçbir şey yok. İletişim kurulan kırk site, kimin sorduğu hakkında hiçbir şey öğrenmez. Bunun bir bedeli, oturumunuzun arkasındaki bir sayfanın *oturum açmayı gerektirir* diye görünmesidir. Özel ya da Tor sekmesinde asla çalışmaz. Canlı denetlendi: hiçbir şey gönderilmiyor.
- Testte bulundu: Electron'un yerleşik fetch'i, bir yönlendirmenin nereye gittiğini ya gizliyordu ya da yönlendirmede iptal ediyordu; bu yüzden taşınmış bir bağlantı dokunulmamış görünüyordu. example.com'un iana.org'a taşınan kendi "Learn more" bağlantısını bile kaçırdı. Denetleyici artık yönlendirmeleri kendisi, her seferinde bir adım olarak izliyor.

### Bir düzeltme
- v2.32.5'te, özel bir sekmede yapılan bir kopyanın pano geçmişine ulaşmadığının *doğrulandığını* söylemiştim. Bu denetim kusurluydu. "Özel"i, Electron'un sessizce geri aldığı bir biçimde taklit etti ve kopyaladığı metin zaten geçmişteydi; yani her iki durumda da geçerdi. Artık doğru biçimde denetlendi: gerçek bir kayıt dışı sekme ve benzersiz bir metin parçasıyla. Normal sekmenin kopyası kaydedildi; kayıt dışı sekmenin kopyası kaydedilmedi. Özellik doğruydu; önceki kanıt değildi.

## v8.61.9 (2026-09-19) — Yapay zekânın düşünmesini izleyin

_v2.32.11 olarak yayımlandı._

### Notlar
- **Düşünmeyi göster** (yapay zekâ panelinin üstündeki beyin düğmesi ya da `Ctrl+K` → *Yapay Zekâ Düşünmesini Göster*). Yapay zekâ bir yanıt üzerinde çalışırken, Claude'un düşünmesini göstermesi gibi, artık ne düşündüğünü görebilirsiniz. *Düşünüyor…* altındaki soluk tek bir satır, modelin son düşüncesine dönüşüp durur. Tüm akıl yürütmeyi açmak için ona tıklayın. Yanıt başlayınca satır kaybolur ve akıl yürütme, yanıtın üstünde *N kelimelik düşünce* olarak tutulur ve sohbetle birlikte kaydedilir.
  - **Ajanda** da çalışır: her adım, modelin düşüncesini "ne yapıyorum → hangi araç" altında gösterir.
  - **Akıl yürüten modeller** içindir — qwen3.5, deepseek-r1 ve benzerleri. Akıl yürütmeyen bir modelin gösterecek bir şeyi yoktur, bu yüzden eskisi gibi yalnızca *Düşünüyor…* görürsünüz.
- **Varsayılan olarak kapalıdır ve dürüst nedeni şu.** Şimdiye kadar Vex yerel modelinize hiç düşünmemesini söylüyordu, çünkü bu çok daha hızlı. Bu makinedeki qwen3.5 üzerinde ölçüldü: düşünmeden yanıt başına yaklaşık **3 saniye**, düşünmeyle **16–39 saniye** (yanıt vermeden önce 2.500–6.700 karakterlik akıl yürütme). Zor soru için açın, hızlı soru için kapatın. Kapalı, eskisiyle tamamen aynı anlama gelir: düşünme istenmez ve gösterilmez.
- Zamanlanmış ajan görevleri, anahtar açık olsa bile asla düşünmez. Onları kimse izlemiyor, bu yüzden yavaşlatmak için bir neden yok.
- Düşünme en başta kapatılmıştı, çünkü qwen3.5 bazen düşünüp sonra yanıt vermiyordu. Güncel Ollama'da (0.34) bu, altı denemede bir kez bile olmadı. Olursa Vex bunu söyler ve sizi boş bir yanıtla bırakmak yerine anahtara yönlendirir.
- Bilginize: Vex, Ollama'nın kendi ayrı akışında gönderdiği düşünceleri atıyordu. Artık onları okuyor.

## v8.60.9 (2026-09-19) — Sayfanın tamamı tek ekran görüntüsünde

_v2.32.10 olarak yayımlandı._

### Notlar
- **Sayfanın Tamamının Ekran Görüntüsünü Al** (`Ctrl+K`). Bir web sayfasının ekran görüntüsü her zaman sayfanın yalnızca bir ekran boyuydu. Fiş, uzun yazışma, grafikli makale için bu, kaydır, yakala, kaydır, yakala ve birleştir — ya da vazgeç demekti. Şimdi kaydırmayı, yakalamayı ve birleştirmeyi Vex yapıyor ve size baştan sona tek bir resim veriyor. Normal ekran görüntüsüyle aynı önizlemede açılır; böylece kopyalayabilir, kaydedebilir ya da not alabilirsiniz.
  - Daha aşağıdaki, henüz yüklenmemiş resimler önce yüklenir; böylece boş kutular olarak çıkmazlar.
  - Ekranın üstüne sabitlenmiş bir başlık, her ekran boyunda değil, üstte bir kez görünür.
  - Sayfa, kaydırılmış olduğunuz yere tam olarak geri döner.
  - Çok uzun bir sayfa sığacak şekilde küçültülür. Yaklaşık 30.000 pikselin ötesinde üst kısmı alırsınız ve bu size söylenir; sekme çökmez.
- Nasıl doğru yapıldığı, kayıt için. Daha hızlı iki tek geçişli yöntem de doğru boyutta ama *ilk ekran boyunun aşağıya kadar tekrarlandığı* bir resim döndürdü: bir Vex sekmesinin içinde sayfa yalnızca bir ekran boyunu çizer. Sonraki deneme, diğer pencerelerinizin arkasındaki bir pencerenin hiç yapmadığı bir şeyi, pencerenin yeniden boyanmasını bekledi ve bir çalışma yedi dakikayı aştı. Yayımlanan sürüm her ekran boyunu istek üzerine alır. Uzun bir Wikipedia makalesinde: 10.949 piksel yüksekliğinde, hepsi doğru, 7 saniyede.
- O sekmede DevTools açıksa Vex, sayfa için onunla çekişmek yerine önce kapatmanızı ister.

## v8.58.9 (2026-09-19) — Bir sayfadan bir şeyleri çıkarmak

_v2.32.9 olarak yayımlandı._

### Notlar
Bir tarayıcı size bir sayfayı göstermekte çok iyi, ama ondan herhangi bir şeyi saklamanıza izin vermekte tuhaf biçimde kötüdür. Beş yeni `Ctrl+K` komutu:
- **Sayfayı PDF Olarak Kaydet.** Doğrudan bir dosyaya. Olağan yol yazdırma penceresi, vakit alan bir önizleme ve bir hedef menüsüdür. Arka planlar korunur.
- **Sayfayı Tek Dosya Olarak Kaydet.** Sayfanın tamamı, metni, resimleri ve stilleriyle, herhangi bir Chromium tarayıcısında çevrimdışı açılan tek bir `.mhtml` içinde. Gelecek ay ücretli duvarın arkasına alınacak ya da silinecek makale içindir. Tarayıcıların çoğunda bunun için hiç menü yoktur. Kaydedilen, tam olarak baktığınız şeydir, oturum açık durumu dahil, çünkü hiçbir şey yeniden indirilmez.
- **Bağlantı Listesi Aç.** Biri size on iki bağlantı gönderir ve siz onları tek tek açarsınız. Artık onları herhangi bir biçimde yapıştırırsınız: satır başına bir tane, virgüllerle karışık bir yığın ya da içinde bağlantılar olan bir sohbet iletisi. Her biri kendi sekmesinde açılır. Panonuzda zaten bağlantılar varsa sizin için doldurulur. Vex sekiz taneden fazlasını açmadan önce sorar ve elliden fazlasını açmaz.
- **Bu Sayfadaki Resimler.** Sayfadaki her resim, en büyüğü önce, sayfanın sunduğu en büyük boyutta. İzleme pikselleri ve simgeler dışarıda bırakılır. Birini ya da hepsini kaydedin (on taneden fazlaysa Vex önce sorar). İndirmeler sekmenin kendisi üzerinden gider; böylece oturumun arkasındaki resimler de iner.
- **Bu Sayfayı Alıntıla.** APA 7, MLA 9, Harvard, Chicago ya da BibTeX; sayfanın kendi hakkında yayımladıklarından oluşturulur: Google Akademik'in okuduğu akademik `citation_*` etiketleri, sonra Open Graph, sonra JSON-LD. DOI, sayfa adresine göre önceliklidir. Sayfa bir yazar belirtmiyorsa alıntı yazarı dışarıda bırakır ve teslim etmeden önce denetlemenizi söyler. Vex bir tane uydurmaz. Stil seçiminiz hatırlanır.

### Düzeltmeler (yayından önce bulundu)
- Gece yarısından sonra oluşturulan bir BibTeX "Erişim" tarihi, Greenwich'in doğusundaki herkes için dünü söylerdi. UTC olarak yazılıyordu; artık kendi tarihinizi kullanıyor.

## v8.56.9 (2026-09-19) — Bir konunun her şeyi, tek bir yerde

_v2.32.8 olarak yayımlandı._

### Notlar
- **Araştırma projeleri** (`Ctrl+K` → *Araştırma Projeleri*). Bir şeyi araştırmak günler alır ve her şeye dokunur: on bir sekme, bir daha asla bulamayacağınız dört yer imi, bir not ve her biri artık var olmayan bir sekmeye bağlı iki yapay zekâ sohbeti. Bir hafta sonra soru geri gelir ve hiçbiri bir arada değildir.
  - Proje, tek bir konu için bir klasördür. **Bu Sayfayı Projeye Ekle**, okuduğunuz her şeyi dosyalar; notlar yanına konur.
  - **Bu Sohbeti Projeye Kaydet**, yapay zekâ sohbetini ait olduğu araştırmayla birlikte tutar. Her tarayıcının kaybettiği kısım budur, çünkü bir sohbet bir sekmeye aittir ve sekmeler kapanır.
  - Bir proje, üzerinde çalıştığınız projedir; böylece bir şey eklemek bir karar değil, tek bir komuttur.
  - **Tümünü aç**, her şeyi sekmeler olarak geri getirir — ve önce kaç tane olduğunu söyler, çünkü yirmi sekmeyi yanlışlıkla açmak kötü bir öğleden sonradır.
  - **Markdown olarak kopyala** hepsini dışa aktarır: bağlantılar olarak sayfalar, notlarınız ve yazılmış her sohbet. Yapıldığı araçtan çıkamayan bir araştırma bir tuzaktır.
- Özel ve Tor sekmeleri, burada da her yerde olduğu gibi toplanmaz — ne sayfa ne de içlerinde yapılan bir sohbet.

## v8.54.9 (2026-09-19) — Bu hangi renk?

_v2.32.7 olarak yayımlandı._

### Notlar
- **Damlalık** (`Ctrl+K` → *Ekrandan Renk Seç*). Bir renge bakıyorsunuz ve onun hex değerini istiyorsunuz. Bugüne kadar bu, bir ekran görüntüsü, bir boyama programı ve bir tahmin demekti — ya da ziyaret ettiğiniz her sayfaya güvenmeniz gereken bir uzantı.
  - Yalnızca sayfadaki değil, **ekrandaki** herhangi bir pikseli örnekler: bir video, bir PDF, bir tasarım aracı, tamamen başka bir program.
  - Hex doğrudan panoya gider, çünkü yapıştıracağınız şey odur.
  - **Seçtiğiniz Renkler** son bir düzineyi tutar; her biri hex, rgb ve hsl olarak, kopyalamak için tıklayın.
- Chromium'da bu, Chrome 95'ten beri yerleşik olarak var ve neredeyse hiçbir şey kullanmıyor. Büyüteç Chromium'un kendisi tarafından çizilir; bu yüzden hiçbir sayfaya bir şey enjekte edilmez ve hiçbir sayfaya bunu kullandığınız söylenmez.
- Escape ile iptal etmek, hata olarak değil, iptal olarak ele alınır. Ve Chromium büyüteci yalnızca doğrudan istediğinizde açtığı için, başka bir yoldan gelen bir istek, `EyeDropper::open() requires user gesture` iletisini aktarmak yerine bunu kelimelerle söyler.

## v8.52.9 (2026-09-19) — Aynı paragrafı yeniden yazmayı bırakın

_v2.32.6 olarak yayımlandı._

### Notlar
- **Parçacıklar** (`Ctrl+K` → *Parçacıklar*). Adresiniz. Bir fatura için banka bilgileriniz. Her hafta aynı türden e-postaya gönderdiğiniz üç satırlık yanıt. Herkes bir şeyi yeniden yazar ve olağan yanıt, içinden kopyaladığınız bir not uygulamasıdır — dört kelime için iki bağlam değişimi.
  - Bir parçacık, bir kısaltma ve onun dönüştüğü metindir. Herhangi bir sayfadaki herhangi bir kutuya `;addr` yazın, **Tab**'a basın; adresiniz olur.
  - **Tab, ve yalnızca imlecin hemen önündeki kelime sizin kelimelerinizden biriyse.** Başka her yerde Tab, bir sonraki alana geçmeye devam eder, ki bunun için vardır. Siz yazarken hiçbir şey genişlemez: yarısında olduğunuz bir kelimenin içinde ateşlenen bir genişletici, yeniden yazmaktan daha kötüdür.
  - Sıradan kutularda, büyük ileti kutularında ve sitelerin kendi yaptığı zengin düzenleyicilerde çalışır — çalışan bir derlemede üçüne karşı da doğrulandı.
  - Çok satırlı parçacıklar bir ileti kutusunda satırlarını korur. Tarayıcının satır sonlarını bırakıp "Street" ile "Manchester"ı birbirine yapıştıracağı tek satırlık bir alanda ise boşluğa dönüşürler.
  - En uzun eşleşme kazanır, bu yüzden `;sig` ve `;sig2` birlikte var olabilir.
  - **Parola alanında asla.**
- Sayfaya yalnızca kısaltmalar ve metinleri söylenir — ad yok, kimlik yok, sizinle ilgili başka hiçbir şey yok — ve yalnızca sizin yaptığınız liste.

## v8.50.9 (2026-09-19) — Kopyaladığınız şeyden önce kopyaladığınız şey

_v2.32.5 olarak yayımlandı._

### Notlar
- **Pano geçmişi** (`Ctrl+K` → *Pano Geçmişi*). Bir takip numarasını kopyalarsınız, sonra onu bir yere yapıştırmak için adresi kopyalarsınız ve takip numarası gider. Pano tek bir şey tutar ve son kopya kazanır.
  - **İçinde geçen herhangi bir kelimeyi yazın** ve geri gelsin — `Ctrl+K`, kopyadan bir kelime, Enter ve yeniden panodadır.
  - Ya da her kopyanın ne olduğunu ve hangi siteden geldiğini gösteren listeye göz atın.
- **Tek bir şeyi izler: web sayfalarında yapılan kopyaları.** Win+V dahil Windows'taki her pano yöneticisi, sistem panosunu izleyerek çalışır — bu da parola yöneticinizden, bankacılık uygulamanızdan ve terminalinizden kopyaladığınız şeyleri de kaydeder demektir. Vex bunların hiçbirini görmez. Vex'in kendi arayüzünde yapılan kopyalar da kaydedilmez.
  - Bir **parola alanından ya da tek kullanımlık kod kutusundan** yapılan kopya asla gönderilmez — sayfa tarafındaki yakalama, hiçbir şey sekmeden çıkmadan önce onu reddeder. Çalışan bir derlemede gerçek parola ve OTP alanlarına karşı doğrulandı.
  - **Özel ve Tor sekmeleri hiçbir şey kaydetmez**, içlerindeki her şey gibi.
- **Sabitlemediğiniz sürece Vex'i kapattıktan sonra hiçbir şey tutulmaz.** Oturum listesi bellekte yaşar ve Vex ile birlikte gider. Bir kaydı diske yazan şey sabitlemedir; yani bir şeyi tutmak sizin verdiğiniz bir karardır, sizin yerinize verilmiş bir karar değil. *Tümünü temizle* ikisini de temizler.
- Her şeyi Ayarlar → Gezinti ekstraları'ndan kapatın. Kapalı, hiçbir şeyin kaydedilmediği anlamına gelir — ve zaten tutulan şey yalnızca gizlenmez, atılır.

### Düzeltmeler
- v2.32.4'te eklenen indirme güvenlik denetimi yalnızca indirmeler panelini koruyordu. Bir indirme biter bitmez görünen bildirimdeki **Aç** düğmesi — bir yükleyicinin gerçekten açıldığı yer — doğrudan onun yanından geçiyordu. Artık iki düğme de aynı soruyu soruyor.

## v8.45.9 (2026-09-19) — Çift tıklamadan önce bir yükleyicinin gerçekte ne olduğu

_v2.32.4 olarak yayımlandı._

### Notlar
- **Vex artık indirilen bir programın çalışmadan önce ne olduğunu söylüyor.** Yükleyici, bir tarayıcının size verdiği, makineye her şeyi yapabilecek tek şeydir ve tarayıcılar bu konuda hiçbir şey söylemez. Windows "emin misiniz" diye sorar ve yayımcıyı belirtir — çift tıklamadan sonra ve yalnızca dosya imzalıysa. İndirmeler listesinden bir `.exe`, `.msi`, `.bat` ya da arşiv açmak artık önce şunu söylüyor:
  - **Kimin imzaladığı** — dosyanın kendisinden, çalıştırılmadan okunur. "Example Ltd tarafından imzalandı" ya da açıkça *İmzalı değil — kimse bu dosyaya adını koymamış*. İmzasızlık bir suçlama değildir; küçük araçların çoğu imzasızdır. Büyük bir şirketten geldiğini iddia eden imzasız bir yükleyici, dikkat edilmeye değer olandır.
  - **Nereden geldiği** — gerçekten güvenmek istediğiniz site; dosyanın kendi hakkındaki iddialarından değil, indirmeden alınır.
  - **SHA-256 değeri** — böylece projenin yayımladığıyla karşılaştırabilirsiniz.
- Hiçbir yere hiçbir şey gönderilmez. Karma makinenizde hesaplanır ve gösterilir; çevrimiçi aranıp aranmayacağı Vex'in değil, sizin kararınızdır. Vex bir antivirüs değildir ve öyleymiş gibi davranmaz — yerel olarak bilinebilecek olanı bildirir ve karar vermeyi size bırakır.
- Bir PDF, resim ya da belge her zamanki gibi açılır. Bir arşiv, içindekilerin denetlenmediğini açıkça söyler.
- **Denetimin kendisi başarısız olursa yoldan çekilir.** Taşınmış bir dosya, okunamayan bir imza, böyle bir köprüsü olmayan eski bir derleme: dosya eskisi gibi açılır. Kendi indirmelerinizi açmanızı engelleyen bir güvenlik denetimi, hiç denetim olmamasından daha kötü olurdu.

## v8.43.9 (2026-09-19) — Ajanın yaptığı bir görevi kaydedin ve yapay zekâ olmadan tekrarlayın

_v2.32.3 olarak yayımlandı._

### Notlar
- Yapay zekâ geçmişindeki herhangi bir ajan çalışmasında **"Görev olarak kaydet"**. İşe yarayan bir çalışma bir tariftir — ve onu model aracılığıyla yeniden yapmak otuz saniyeye, bir model yüklemeye ve her seferinde biraz farklı bir yanıta mal olur; oysa istediğiniz aynı altı adımdı.
- **Ctrl+K → Bir görevi tekrarla**, bu adımları doğrudan çalıştırır. Yapay zekâ yok, bekleme yok, aynı sonuç: testlerde ölçüldü, model bir kez bile çağrılmıyor.
- Bilerek akıllı değildir. Bir adım başarısız olursa — sayfa değişmiştir, bir düğme kaybolmuştur — durur, hangi adım ve neden olduğunu söyler ve yapay zekânın çözebilmesi için isteği görev olarak göndermenizi söyler. Sessizce yarım çalışan bir makro, hiç makro olmamasından daha kötü olurdu.
- Ajanın kendisi için geçerli olan izin kuralları aynen geçerlidir: sormadığınız bir sitede işlem yapan kaydedilmiş bir adım yine önce onaylanır ve reddetmek çalışmayı durdurur.

## v8.41.9 (2026-09-19) — Bir sekmeyi yalnızca başlığıyla değil, üzerindekilerle bulun

_v2.32.2 olarak yayımlandı._

### Notlar
- **Ctrl+K artık açık sekmelerinizin içinde arıyor.** Sekmeleri başlığa göre buluyordu; bu, otuz sekmeniz olana ve istediğiniz sekmenin adı "Sipariş onayı", hatırladığınız kelime ise "iade" olana kadar sorun değildir. Her sayfa, oturduğunda bir kez göz gezdirilir ve kendi kelimeleri aranabilir olur — içerik eşleşmesi başlık eşleşmelerinin altında listelenir ve *Bu sayfada* diye işaretlenir.
- Bir kelimeyi sizin için yarım tamamlar: "iad" ifadesi, iade yazan sayfayı bulur. Yazdığınız her kelime orada olmalıdır; bu yüzden ikinci bir kelime genişletmez, daraltır.
- Hiçbir şey makineden çıkmaz ve hiçbir şey diske yazılmaz: kelimeler sekme açık kaldığı sürece bellekte yaşar, özel bir sekme asla okunmaz ve yanıt vermeyen bir sayfa eskisi gibi başlığa göre bulunabilir kalır.

## v8.39.9 (2026-09-19) — Bu sayfa değiştiğinde bana söyle

_v2.32.1 olarak yayımlandı._

### Notlar
- **"Bu sayfa değiştiğinde bana söyle"** (Ctrl+K). Otomatik yenileme, bir sayfayı zamanlayıcıyla yeniden yükler; bu işin yarısıdır — yine de ona bakmanız gerekir. Bir izleme, sayfayı arka planda sessizce okur, öncekiyle karşılaştırır ve yalnızca farklıysa konuşur: bir bildirim ve bir masaüstü bildirimi, çünkü bütün mesele sizin başka bir yerde olmanızdır.
  - Sayfanın tamamını ya da CSS seçicisiyle bir bölümünü izleyin — "makale değişti" ile "reklam döndü" arasındaki fark.
  - Bunun yerine bir **sayı** izleyin: yukarı, aşağı ya da bir rakamın ötesinde. "300'ün altına düştüğünde bana söyle" insanların gerçekte kastettiği şeydir ve £1,299.99 ile "12 adetten 4'ü kaldı" ifadesini bir insan gibi okur.
  - 5 dakikada bir ile günde bir arası. İlk bakış başlangıç noktasını belirler ve hiçbir şey söylemez.
  - Yüklenmeyi bırakan bir sayfa ya da eşleşmeyi bırakan bir seçici, her denetimde değil, beş başarısızlıktan sonra bir kez bildirilir. **İzlenen sayfalar**, neye göz kulak olunduğunu ve en son ne görüldüğünü listeler.
- Geliştirme: arama performansı testi mutlak milisaniyeleri sınıyordu ve bir oyun çalışırken, kod dokunulmamışken üst üste üç kez başarısız oldu. Üst sınırları artık makinenin o anki hızına göre ölçekleniyor — yanlış bir başarısızlık, takımı görmezden gelmeyi öğretir.

## v8.37.9 (2026-09-19) — Vex geliştirme sunucularınızı görebiliyor ve bir sayfayı yerel, hazırlık ve canlı arasında geçirebiliyor

_v2.32.0 olarak yayımlandı._

### Notlar
- **Çalışan geliştirme sunucuları** (Ctrl+K). Bir geliştirme sunucusu bir terminalde başlatılır ve sonra aranır — hangi port'tu, hâlâ açık mı? Tarayıcı bakmaya gittiğiniz yerdir ve bunu söyleyemeyen tek şeydir. Vex otuz küsur yaygın porta kapı çalar ve yanıt verenleri, onu oraya koyan şey hakkında bir tahminle (Vite, Next.js, bir Cloudflare Worker, Ollama) listeler. Bu yerel bir bağlantıdır ve başka bir şey değildir: hiçbir istek gönderilmez; bu yüzden dinleyen hiçbir şey bulunmakla rahatsız edilmez.
- **Ortamı değiştir** (Ctrl+K). Aynı yol yerel sunucunuzda, hazırlıkta ya da canlıda — ana bilgisayardan sonraki her şey tam olarak korunur, ki yeniden yazmamaya değer olan kısım budur. Vex'e bir sitenin hazırlık ve yerel adreslerini bir kez söyleyin (**Ortamları ayarla**) ve her yönde çalışır; açık olan her geliştirme sunucusu, yazmış olsanız da olmasanız da önerilir. Yerel bir adres http alır, çünkü https'de ısrar etmek "yerele geç"i boş bir sayfaya çevirir.
- Yayından önce kendi testi yakaladı: localhost:5173'ten geri dönmek, siteyle ilgisi olmayan gerçek bir adres olan shop.example:5173 üretiyordu, çünkü bir ana bilgisayarı port olmadan ayarlamak eskisini korur.

## v8.36.9 (2026-09-19) — Güncelleme istemi artık ısrar etmiyor

_v2.31.99 olarak yayımlandı._

### Notlar
- **"Sonra" artık bir gün demek, bir sonraki açılışa kadar değil.** Vex günde birkaç kez yayımlanıyor; bu yüzden güncelleme açılır penceresi her başladığında geri geliyordu — ve amansız bir açılır pencere, okunmadan kapatılan olandır. (Discord bellek bildirimi tam olarak bu sorunu yaşıyordu, v2.31.82'de aynı şekilde düzeltildi.)
- **"Bunu atla"**, o sürümden bir daha söz etmez; bir sonraki yine ulaşır.

## v8.34.6 (2026-09-19) — Kaybedeceğiniz düşünce için her şeyin üstünde bir kutu

_v2.31.98 olarak yayımlandı._

### Notlar
- **Hızlı yakalama.** Oyun oynarken aklınıza gelen bir düşünce, Alt+Tab yapıp Vex'i bulup paneli bulup tıkladığınızda gitmiştir. Artık tek bir kısayol tuşu, yaptığınız şeyin — bir oyun, bir yayın, başka bir program — üzerinde küçük bir kutu açıyor, tek bir satır alıyor ve gidiyor:
  - herhangi bir şey → ilk birkaç kelimesiyle başlıklandırılmış bir not;
  - **bana hatırlat…**, **zamanlayıcı 20 dk**, **alarm 7am** → hatırlatıcı ya da zamanlayıcı, tam olarak Ctrl+K'nin yapacağı gibi;
  - **/** herhangi bir şey → bir Vex komutu;
  - **sor …** → yapay zekâ paneli, çünkü bir saniye içinde kapanan bir kutudaki yanıt işe yaramaz.
- Ana pencereyi asla oyununuzun üstüne sürüklemez, farenizin bulunduğu ekranda belirir ve Escape kapatır. Kısayol tuşunu Ayarlar › Gizlilik › Oyun ve yayın'da ayarlayın ya da Ctrl+K → **Hızlı yakalama**'dan açın — önce yapılandırmanız gereken bir kısayol tuşuyla ulaşılabilen bir özellik neredeyse görünmezdir.
- Kutu iki kanal alır ve başka bir şey almaz: bir satır gönder ve kapat. Vex'in IPC ilkesi, güvenilmeyen bir gönderene reddedilmesi gereken her şeyi ona reddeder; bunu, bu özelliğin ilk sürümünü tamamen reddederek kanıtladı.
- Yayımlanmadan önce düzeltildi: kutu odağını kaybettiği anda kendini kapatıyordu — odağı koruyan tam ekran bir oyunun üzerinde açılırken bu, anında kaybolmak demekti. Artık yalnızca gerçekten odaklandıktan sonra odak kaybında kapanıyor.

## v8.29.6 (2026-09-19) — Ajanın yaptığını geri alın ve videoları ve PDF'leri okumasına izin verin

_v2.31.97 olarak yayımlandı._

### Notlar
- **Bir ajan çalışmasını geri al.** Kendi başına hareket eden bir ajanın geri dönüş yolu olmalıdır ve "bu altı notun hangisini o yazdı?" bir yol değildir. Artık her çalışma ne YAPTIĞINI kaydediyor — notlar, yer imleri, sekme grupları, zamanlayıcılar, hatırlatıcılar — ve yapay zekâ geçmişindeki **Geri al**, listeyi size gösterdikten sonra en yenisinden başlayarak onları kaldırır. Yalnızca Vex'in kendi şeyleri: bir web sayfasında yaptığı şey sayfanın işidir ve buradan geri alınamaz, ve rol yapmak yerine bunu söyler. Zaten gitmiş olan her şey bildirilir ve gerisi yine de gider.
- **Bir YouTube bağlantısı artık çıkmaz sokak değil.** Sayfa, içinde kelime olmayan bir uygulama kabuğudur; bu yüzden ajan onu okuyor, hiçbir şey bulamıyor ve vazgeçiyordu. Artık gerçekte *söylenenleri* okuyor — altyazı parçasını, bir yanıt bir ana işaret edebilsin diye birkaç dakikada bir zaman damgasıyla. Anahtar yok, üçüncü taraf yok; altyazısı olmayan bir video bunu söyler.
- **PDF'ler reddedilmek yerine okunuyor.** Resmî her şeyin yarısı birinin içinde yaşar ve "bu adres bir sayfa değil, bir dosya" sonuçtu. Düz metin kısımları okunur; her şeyi sıkıştırılmış tutan bir dosya bunu söyler ve onu bir sekmede açmaya yönlendirir, ve kısa bir okuma, belgenin tamamı gibi geçirilmek yerine kısmi olarak işaretlenir.

## v8.27.6 (2026-09-19) — Herhangi bir tabloyu elektronik tablo olarak alın ve bir sitenin video oynatma hızını ayarlayın

_v2.31.96 olarak yayımlandı._

### Notlar
- **Tabloları CSV olarak kopyala** (Ctrl+K). Bir sayfadan bir tabloyu kopyalamak size birbirine geçmiş metin verir: sütunlar işaretlemededir ve hiçbir tarayıcı bunları size sunmaz. Bu, gerçek hücreleri okur — iki sütuna yayılan bir hücre bir sonrakini boş bırakır; böylece satırlar yine de hizalanır — ve virgül, tırnak ya da satır sonu içeren her şeyi tırnak içine alarak düzgün CSV yazar. **Tabloları not olarak kaydet** aynısını Notlar'ınızda bir Markdown tablosu olarak yapar.
- **Video hızı, site başına, hatırlanır.** Hız denetimi olan siteler onu üç menü derine gömer, olmayanlar sizi 1×'te bırakır. Bir site için bir kez ayarlayın ve oradaki her video bu hızda oynar; sonradan beliren ve oynatıcısı sıfırlamaya çalışan bir video da dahil.

## v8.25.6 (2026-09-19) — Bir siteye tek ziyaret için izin verin ve mikrofonunuzu kullanan her şeyi görün (ve durdurun)

_v2.31.95 olarak yayımlandı._

### Notlar
- **"İzin ver" artık sonsuza dek demek değil.** İstemin iki yanıtı ve varsayılan olarak işaretli bir Hatırla kutusu vardı; bu yüzden tek bir görüşme için mikrofona razı olmak, ona kalıcı olarak razı olmaktı. Artık üç yanıt var: **Engelle**, **Bu ziyarete izin ver**, **Her zaman izin ver**. Yalnızca ziyaret için verilen yanıt Vex kapanana kadar sürer ve asla diske yazılmaz — yeniden başlatmayı atlatan bir "sadece bu seferlik" bir yalan olurdu.
- **Ayarlar › Site İzinleri, şu anda mikrofonunuzu ya da kameranızı neyin kullandığını gösterir**, sekme sekme ve panel panel, ve **Durdur** onu bitirir. Vex bunu her zaman biliyordu — sekmede kayıt rozetini çizer — ama bunu görecek bir yer ve harekete geçecek bir yol yoktu: sayfanın mikrofonu kendiliğinden bırakması gerekiyordu. Panel açıkken liste yenilenir.

## v8.23.6 (2026-09-19) — Bir sekmeyi ertele, bir bağlantının gerçekte nereye gittiğini gör ve herhangi bir resim hakkında sor

_v2.31.94 olarak yayımlandı._

### Notlar
- **Bir sekmeyi ertele.** Bir sekme, kapatmak onu kaybettirdiği için açık kalır — böylece çubuk bugünlük olmayan şeylerle dolar. Birine sağ tıklayın: *bir saat sonra*, *bu akşam*, *yarın sabah*, *bu hafta sonu*, *Pazartesi sabahı*, *bir hafta sonra*. Şimdi kapanır ve söylediğiniz zamanda kendiliğinden yeniden açılır, ve erteleme yazılı tutulur; bu yüzden yeniden başlatma onu kaybettirmez.
- **Bir haftadır dokunmadığınız sekmeler kapatılmaz, arşivlenir.** Çubuktan çıkıp adres ve başlığı koruyarak bir listeye girerler; tek bir tıklama herhangi birini geri getirir. Hiçbir şey asla silinmez — hâlâ isteyebileceğiniz bir sekmeyi kapatmak, bunun önlemek için var olduğu şeydir. `vex.autoArchive` ile kapatın.
- **Bir bağlantıyı kopyalamak, izleyici olmadan gerçekte gittiği yeri kopyalar.** Sarılmış bir bağlantı (Google, Facebook, DuckDuckGo, Reddit, Steam, Bing, LinkedIn) gerçek hedefine açılır ve kampanya etiketleri — utm_*, fbclid, gclid ve yaklaşık altmış tane daha — atılır; böylece birine yapıştırdığınız şey sizi size bağlayan bir belirteç taşımaz. Açma yerel olarak yapılır; hiçbir şey sorulmaz ve baktığınız kimseye söylenmez. *Bağlantıyı Olduğu Gibi Kopyala*, dokunulmamış istediğinizde oradadır.
- **Tanıdık bir adresi taklit eden adres belirtilir.** paypa1.com, secure-paypal.net, github-support.co ve tamamen başka bir alfabeyle yazılanlar. Bir çubuk ne olduğunu söyler ve geri dönmeyi önerir; asla engellemez, çünkü yalancı çoban olan bir tarayıcı, uyarıları tıklanıp geçilen bir tarayıcıdır. Gerçek alt alan adları — docs.github.com — asla işaretlenmez.
- **Herhangi bir resme sağ tıklayın → "Vex'e bu resmi sor".** Model görebiliyor (v2.31.86'dan beri); bu yüzden bu, resim hakkında bir sorudur. Resim Vex üzerinden alınır, küçültülür ve görme yeteneği olan bir modele verilir.
- **Tek kullanımlık kodlar artık panodan çıkıyor.** Bir parolayı kopyalamak zaten 30 saniye sonra temizleniyordu; bir 2FA kodunu kopyalamak temizlenmiyordu ve bir sonraki yapıştırdığınız şey için orada duruyordu. İkisi de artık tek bir uygulamadan geçiyor ve hiçbiri o zamandan beri kopyaladığınız bir şeyin üzerine yazmıyor.
- Vex'in kendi resim alımı dürüstçe yanıt verir: düzgün bir User-Agent gönderir ve bir HTTP hatası "bu adres bir resim değil" yerine hata olarak bildirilir. Ölçüldü: bazı siteler (Wikimedia) ne gönderilirse gönderilsin reddeder — bu onların ilkesidir ve Vex artık tahmin yürütmek yerine bunu söylüyor.

## v8.18.6 (2026-09-18) — Discord'u bir oyunun içinden sessize alın, yayın yaparken kodlarınızı bulanıklaştırın ve sesinizi cihazlar arasında bölün

_v2.31.93 olarak yayımlandı._

### Notlar
- **Tam ekran bir oyunun içinden çalışan Discord kısayol tuşları.** Kendinizi sessize almak, Alt+Tab ile çıkmak, Vex'i bulmak, paneli bulmak ve tıklamak demekti — ki o zamana kadar an geçmişti. Vex artık *sessize al*, *sağırlaştır* ve *görüşmeden ayrıl* için sistem genelinde kısayol tuşları alıyor ve panelde Discord'un kendi düğmelerine basıyor. Bunları Ayarlar › Gizlilik › Oyun ve yayın'da istediğiniz tuşlara basarak ayarlayın. Her biri siz ayarlayana kadar kapalıdır, çünkü genel bir kısayol tuşu o kombinasyonu — oyun dahil — diğer her programdan alır ve başka bir programın zaten tuttuğu biri sessizce ölü kalmak yerine bildirilir. Bas-konuş yok: bu, tuşun *bırakılmasını* gerektirir ve Electron'un genel kısayolları bunu bildirmez; yarı çalışan biri hiç olmamasından daha kötüdür.
- **Yayıncı modu.** Vex tek kullanımlık kodlarınızı, kayıtlı parolalarınızı ve iletileri alıntılayan bildirimleri tutar — ve paylaştığınız aynı ekranda durur. Bir şey yakalanırken bunlar bulanıklaştırılır; birinin üzerine gelin ve okuyun, ve kopyalama yine gerçek değeri kopyalar. Açıldığında bunu söyler; böylece bulanık bir kod asla bir muamma olmaz. Varsayılan olarak *bir şey yakalanırken*, ya da her zaman açık, ya da kapalı.
- **Bir siteyi kulaklıklarınıza, diğerini hoparlörlere gönderin.** Windows tüm bir programa tek bir çıkış cihazı verir, bu yüzden bir tarayıcı her şeyi aynı yerden çalar: bir Discord görüşmesi ve bir müzik sekmesi, tüm tarayıcıyı taşımadan bölünemezdi; bu da oyunun sesini de onunla birlikte taşırdı. Bir sitenin nerede çalacağını seçmek için bir sekmenin ses simgesine Shift-tıklayın. Seçim site başına hatırlanır, yeniden yükleme olmadan açık her sekmeye aynı anda uygulanır ve panelleri de izler. Windows, bir şey bir kez mikrofon iznini alana kadar çıkışlarınızı adlandırmaz — Vex yalnızca *Cihazlarımı göster*'e basarsanız sorar ve mikrofonu aynı anda açıp kapatır.

## v8.13.6 (2026-09-18) — Ajan kendi notlarınızı okuyabiliyor, gösterdiğiniz sitede kalıyor ve kendi işini denetliyor

_v2.31.92 olarak yayımlandı._

### Notlar
- **Zaten sakladığınız şeyleri okuyabiliyor.** Ajan bir not *yazabiliyordu* ama hiçbirini okuyamıyordu; bu yüzden "monitörler hakkında ne not almıştım?" ya da "bunu alışveriş listeme ekle" gibi istekler başarısız oluyordu. Yeni: notlarınızda arama yapmak, birini baştan sona okumak, var olan bir nota satır eklemek, yer imlerinizde arama yapmak ve henüz çalmamış hatırlatıcıları listelemek. Ekleme dışında hepsi salt okunurdur, hepsi Vex'in içinde kalır; burada hiçbir şey bir sayfaya ya da ağa dokunmaz. Canlı ölçüldü: notu buldu, iki monitörü ve kararı alıntıladı, sonra ona bir satır ekledi.
- **Gösterdiğiniz sitede kalıyor.** Bir sayfa her şeyi söyleyebilir ve hiç bahsetmediğiniz bir siteye bir bağlantıyla geçip yazmaya başlayan bir ajan, ajanlardaki asıl risktir; şimdiye kadar Vex modelin düzgün davranmasına güveniyordu. Adını verdiğiniz siteler ve çalıştırmanın başladığı sayfa serbesttir; bunun dışındaki her şey, *her* izin kipinde, tıklamadan ya da yazmadan önce size sorulur ve bir siteyi onaylamak onu çalıştırmanın geri kalanı için onaylar. Okuma asla sınırlanmaz, yalnızca eylem sınırlanır.
- **Bir oturum açma, ödeme ya da captcha karşısında sayfayı size geri veriyor.** Yeni bir *Sıra sizde* kartı: ajan neye ihtiyaç duyduğunu açıklar, bekler ve bıraktığınız yerden devam eder. Ona açıkça asla bir parola, kart numarası ya da tek kullanımlık kod yazmaması ve "insan olduğunuzu kanıtlayın" engelini asla aşmaya çalışmaması söylenmiştir.
- **Kendi işini denetliyor.** Yerel bir model, başarısız olan bir çağrı için başarı bildirmişti. Bir notu kaydetmek, bir sayfayı yer imlerine eklemek, bir sekme grubu oluşturmak ve bir zamanlayıcı başlatmak artık "bitti" demeden önce geri okunuyor: "Not kaydedildi **ve doğrulandı**", "0:45 kaldı". Gerçekleşmeyen bir yazma da başarısızlık olarak bildiriliyor.
- Kendi şeylerinizde arama artık çoğul ekleri de eşleştiriyor: "monitörler" diye aradı, not "Monitör" diyordu, hiçbir şey bulamadı ve kendini tekrarladı. Canlı görüldü, düzeltildi ve teste bağlandı.

## v8.12.1 (2026-09-18) — Yapay zekâ ne zaman yavaş olacağını, neden başarısız olduğunu söylüyor ve ekran kartınızı geri veriyor

_v2.31.91 olarak yayımlandı._

### Notlar
- **"Yapay zekâ bozuk" çoğu zaman ekran kartının dolu olması demektir.** Yerel bir model video belleğinde yaşar. Burada ölçüldü: bir oyun ve OBS, 8 GB'lık bir kartı 7,7 GB'a ve yüzde 92 meşguliyete çıkarmıştı; model işlemciye itildi ve 30 saniye süren aynı ajan görevi iki dakikalık sınırı aştı ve hiçbir şey döndürmedi, üstelik iki kez ve ekranda bunu açıklayan hiçbir şey yoktu. Vex artık kartı okuyor ve isteğin öncesinde bunu söylüyor: *"qwen3.5 ekran kartında değil işlemcide çalışıyor; yanıtların dakikalar sürmesini bekleyin."*
- **Her yapay zekâ hatasında "Bu neden başarısız oldu?"** Tek bir düğme hepsini denetler: Worker URL'si, internet, Ollama, modelin kurulu olup olmadığı, yüklü olup olmadığı ve *nereye* yüklendiği ve kartın ne kadar dolu olduğu. Yanıtı bir cümleyle verir, altında da kontrolleri sıralar; böylece ona itiraz edebilirsiniz.
- **Ajanın düşünmesini izleyebilirsiniz.** Yerel bir model onlarca saniye alır ve bir dakika boyunca "Düşünüyor…" yazması takılmadan ayırt edilemez. Yanıtı artık yazıldıkça görünüyor: önce düşünce, sonra uzandığı araç. Canlı ölçüldü: 17 saniyelik bir adımda 46 güncelleme.
- **Ayarlar › Yapay zekâ'da bir model yöneticisi.** Neyin kurulu olduğu, şu anda neyin yüklü olduğu ve kartta mı yoksa işlemcide mi olduğu, her birinin ne kadar yer gerektirdiği ve sizinkine sığıp sığmadığı; ayrıca kurma, kullanma, bellekten çıkarma ve silme, terminal gerekmeden. 8 GB'lık bir kart 9 GB'lık bir modeli kötü, 4 GB'lık iki modeli rahatça taşır ve şimdiye kadar hiçbir şey bunu söylemiyordu.
- **Vex, siz oyun oynarken kartı geri veriyor.** *Ekran kartını boşalt* modeli isteğe bağlı olarak bellekten çıkarır (ölçüldü: 5,2 GB geri geldi), *Belleği şimdi boşalt* da bunu yapar ve Vex, başka bir şey karta ihtiyaç duyduğunda beş dakika gizli kaldıktan sonra bunu kendiliğinden yapar; asla bir yanıtın ortasında yapmaz. Sonraki istek modeli birkaç saniyede yeniden yükler.

## v8.8.3 (2026-09-18) — Vex sessizce başarısız olmayı bırakıyor: bir sorun günlüğü, geri dönmenin bir yolu ve yayımlanmadan önce çalıştırılan bir yükleyici

_v2.31.90 olarak yayımlandı._

### Notlar
- **Sessizce başarısız olan şeyler artık bunu söylüyor.** Vex'te 907 yer bir hatayı yakalıyor ve hiçbir şey söylemiyor. Bu çoğunlukla doğrudur; yüklenmeyen bir favicon için bildirim göstermeye değmez, ama bu haftanın en kötü iki hatası da böyle gizli kaldı: Discord ekran paylaşımı *reddedildi* ve ret atıldı, ve bir ajan çalıştırması sohbetle birlikte hiç kaydedilmedi, üstelik hiçbir şey bunu söylemedi. Sessizce başarısız olan her şey artık **Bellek paneli › Sağlık** içine bir satır yazıyor; yinelemeler için sayaç ve temizlemek için bir düğme var. Ayrıca daha önce hiçbir şeyin yakalamadığını da yakalıyor: arayüzdeki yakalanmamış bir hata ya da işlenmemiş bir promise, ki bunlar şimdiye kadar yalnızca DevTools konsoluna ulaşıyordu. Hiçbir şey hiçbir yere gönderilmez; görebilesiniz ve bana yapıştırabilesiniz diye orada.
- **Vex başlamadığında içeri geri dönmenin bir yolu.** Başlamayı hiç bitiremeyen iki açılış, üçüncüyü **güvenli kipe** sokar: uzantı yok, panel yok, oturum geri yükleme yok ve nedenini söyleyen bir şerit; *Önceki ayarları geri yükle* ve *Normal şekilde yeniden başlat* ile. Şimdiye kadar tarayıcıyı bozan bir uzantı kaldırılamıyordu, çünkü kaldırmak tarayıcıyı açmak demekti. `--safe-mode` bunu doğrudan ister. Ölçüldü: yarıda kesilen iki başlatma, üçüncü şeritle birlikte sade olarak açıldı ve iyi bir açılıştan sonraki başlatma yeniden normaldi.
- **Ayarlarınız her yeni sürümden önce saklanıyor.** Yeni bir sürümün ilk açılışı önce ayarlarınızı kenara kopyalar; böylece bir şeyi bozan bir güncelleme geri alınabilir. Beş kopya tutulur ve geri yüklemenin kendisi de geri alınabilir.
- **Yükleyici, yüklenmeden önce çalıştırılıyor.** `npm run publish` bir yükleyici derliyor ve onu hiç çalıştırmadan herkese gönderiyordu: testler kaynağı kapsıyor, paketlenmiş uygulamayı hiçbir şey kapsamıyordu; oysa orada hatalar başka türdendir (yapıdan çıkarılmış bir dosya, yalnızca paketlendikten sonra eksik olan bir çalışma zamanı bağımlılığı). Yayımlama artık derle → **derlenen uygulamayı başlat** → sürümü oluştur → yükle şeklinde; böylece bu makinede önce başlamamış hiçbir şey size ulaşmaz. Açılmayan bir derleme yayımlamayı durdurur ve arkasında sürüm bırakmaz.
- **Tarayıcı depolaması dolduğunda artık hiçbir şey kaybolmuyor.** Vex orada 60 tür şey tutar ve sınırı aşan bir yazma *hata fırlatır*; her biri bunu yutan altmış çağrı noktasında notlar ve sohbetler sessizce kaydedilemeyebiliyordu. Artık kaydediliyor, bir kez söyleniyor ve değer yine de böyle bir sınırı olmayan diske gidiyor. Sağlık, ne kadar dolu olduğunu ve neyin doldurduğunu gösterir.
- Geliştirme: duman testi, geçici profilini silmeden önce Vex'in çıkmasını bekliyor (bu yarışı her seferinde kaybediyor ve arkasında 85 klasör bırakıyordu) ve bir test çalıştırması Temp içinde hiçbir şey bırakmıyor.

## v8.4.5 (2026-09-18) — İzin istemleri nelerin istendiğini söylüyor ve "Hatırla" yalnızca onu kapsıyor

_v2.31.89 olarak yayımlandı._

### Notlar
- **Düzeltildi: bir sitenin mikrofonuna izin vermek kamerasını ve ekran paylaşımlarını da önceden onaylıyordu.** Chromium, mikrofonu, kamerayı, ikisini birlikte ve bir *ekran paylaşımını* Vex'e tek bir izin olarak bildirir; bunları yalnızca Vex'in yok saydığı bir ayrıntı birbirinden ayırır. Bu yüzden bu istemlerin hepsi "kameranıza ve mikrofonunuza erişmek istiyor" diyordu, bir ekran paylaşımı için bile, yalnızca mikrofon için bile; **Hatırla** da yanıtı tek bir anahtar altına kaydediyordu: bir sitede mikrofona bir kez izin verirseniz kamera ve ekran paylaşımı istekleri sormadan kabul ediliyordu; bir ekran paylaşımını engellerseniz mikrofon da onunla birlikte engelleniyordu. Çalışan bir Vex'te ölçüldü. Her istek artık gerçekte ne olduğuyla sorulup hatırlanıyor: *mikrofonunuzu kullanmak*, *kameranızı kullanmak*, *kameranızı ve mikrofonunuzu kullanmak* ya da *ekranınızı paylaşmak* (ekranı ya da pencereyi yine sonradan siz seçersiniz).
- Bu sürümden önce kaydettiğiniz yanıtlar kamera ve mikrofon için çalışmaya devam eder (istemleri bunu söylüyordu) ve bir ekran paylaşımı için asla geçerli sayılmaz. Ayarlar › Site İzinleri bunları "kamera ve mikrofon" olarak gösterir.
- İstemler artık düzgün okunuyor: "size bildirim göndermek istiyor", "konumunuzu bilmek istiyor" (eskiden "bildirim gönder erişmek istiyor" diyordu).
- Geliştirme: bir test çalıştırması artık kendi geçici klasörünü alıyor ve çalıştırma bitince siliyor; test çalıştırmaları iki hafta içinde Temp içinde 4.761 klasör (8,5 GB) bırakmıştı. Duman ve kullanıcı arayüzü denetimi betikleri geçici profillerini silmeyi sessizce vazgeçmek yerine yeniden deniyor ve artık Windows zamanlanmış görevleri kaydetmiyor.

## v8.2.5 (2026-09-18) — Discord ekran paylaşımı "Sesi paylaş" kapalıyken çalışıyor

_v2.31.88 olarak yayımlandı._

### Notlar
- **Düzeltildi: Discord'da bir ekran seçtiniz, seçici kapandı ve hiçbir şey paylaşılmadı.** Discord bir ekran paylaşımında her zaman ses ister ve Chromium, sayfanın istediği sesi dışarıda bırakan bir seçimi reddeder ("Invalid capture constraints"). Vex'in seçicisinde bir *Sesi paylaş* kutusu var ve bunu hatırlıyor; bu yüzden onu bir kez işaretsiz bıraktıktan sonra her paylaşım, bir ekran seçtiğiniz anda tek kelime etmeden ölüyordu. Panelde discord.com üzerinde yeniden üretildi: işaretliyken çalıştı, işaretsizken başarısız oldu. Seçim artık her zaman istenen sesi taşıyor ve kutu işaretsizken Vex, akış Discord'a ulaşmadan önce ses izini kaldırıyor; yani kutunun dediği gibi sessiz paylaşıyor. Düzeltmeden sonra iki türlü de ölçüldü: sesli ve seslisiz canlı 1080p.
- **Vex'in başlatamadığı bir paylaşım artık nedenini söylüyor.** Seçici, aldığı yanıtı atıyordu; bu yüzden reddedilen ya da süresi dolan bir paylaşım hiçbir şey olmuyormuş gibi görünüyordu.

## v8.0.0 (2026-09-18) — Gönder karar veriyor, sohbetler kaybolmuyor, Vex Ollama'yı kendisi başlatıyor ve bellek koruması rahatsız etmeyi bırakıyor

_v2.31.87 olarak yayımlandı._

### Notlar
- **Tek bir Gönder düğmesi.** Robot düğmesi kalktı. Artık Gönder karar veriyor: bir görev ("20 dakikalık bir zamanlayıcı başlat", "aç…", "bunu yer imlerine ekle", "sekmelerimi grupla", "bana hatırlat…") ya da bir sohbet modelinin yalnızca tahmin edebileceği bir soru ("en son…", "bugün hava", "…fiyatı") ajan olarak çalışır; sayfa, yazma ya da açıklama ile ilgili her şey sohbet olarak yanıtlanır. `/agent …` ya da `/chat …` birini zorlar. İzin menüsü, hiçbir şey çalışmadan önce ilk seferde yine soruyor.
- **Düzeltildi: bir yapay zekâ sohbeti paneli kapatıp yeniden açtığınızda kayboluyordu ve Son sohbetler içinde yoktu.** Bir ajan çalıştırması (isteğiniz, her adım, yanıt) yalnızca ekranda var oluyordu; sekmenin konuşmasıyla birlikte hiç saklanmıyordu, bu yüzden paneli yeniden açmak boş bir konuşmadan yeniden çiziyordu. Artık sohbetin bir parçası: istek gönderdiğiniz anda, yanıt ise sona erdiğinde kaydediliyor ve *Ajanın ne yaptığını göster* adımları geri getiriyor. Ajan hâlâ çalışırken paneli yeniden açmak da artık adımlarını silmiyor.
- **Vex, Ollama'yı sizin için başlatıyor.** Yeniden başlatmadan sonra Ollama çalışmaz ve hiçbir Yapay zekâ Worker'ı ayarlı değilse, Ollama'yı elle açana kadar her istek "Bulut yapay zekâ yapılandırılmamış" diye başarısız oluyordu. Yerel model istendiğinde ve yanıt vermediğinde Vex artık `ollama serve` komutunu arka planda, pencere açmadan başlatıyor ve devam ediyor; kurulumunuz yerel modele dayanıyorsa bunu açılışta da yapıyor. *Ollama durumunu yenile* de onu başlatır. Anahtar: Ayarlar › Yapay zekâ › *Gerektiğinde Ollama'yı başlat*. Arka plan dizinleme onu asla başlatmaz; uzak bir Ollama adresine dokunulmaz.
- **Düzeltildi: "Yüksek bellek — N boştaki sekme uyutuldu" bildirimi sürekli çıkıyordu ve sekmeler siz onlardan ayrıldıktan saniyeler sonra uyutuluyordu.** Koruma, Vex'in *tamamını* tavanla karşılaştırıyordu; oysa ağır bir oturumun çoğu sekmelerde değildir (yalnızca Discord paneli yaklaşık 1 GB), bu yüzden varsayılan 1,2 GB tavanla sürekli aşılmış oluyordu: her sekme bırakıldıktan sonra 45 saniye içinde uyutuluyordu, her seferinde bir bildirimle, ve bunların hiçbiri toplamı düşüremiyordu. Artık beş dakikadan kısa süre önce bırakılan bir sekme henüz boşta sayılmıyor; boştaki sekmelerin gerçekte ne tuttuğu ölçülüyor ve bu önemli olmayacak kadar azsa hiçbir şey uyutulmuyor; yalnızca gerektiği kadar sekme uyutuluyor; ve bildirim 30 dakikada en çok bir kez geliyor ve ne kadar boşaldığını söylüyor. Bellek paneli yine de her taramayı kaydeder.
- Geliştirme: `VEX_NO_OS_SCHEDULE=1` ile başlatılan bir Vex hiçbir Windows zamanlanmış görevi kaydetmiyor; böylece test profilleri arkalarında uyandırma görevleri bırakmayı bırakıyor.

## v7.96.2 (2026-09-18) — Ajan Vex'in kendi özelliklerini kullanıyor, sayfayı görebiliyor, söylendiğinde duruyor ve işini koruyor

_v2.31.86 olarak yayımlandı._

### Notlar
- **Düzeltildi: 20 dakikalık bir zamanlayıcı istendiğinde ajan bir zamanlayıcı *web sitesi* açıp onu başlatılmamış bırakıyordu.** Zamanlayıcı aracı yoktu ve hiçbir şey ona Vex'te bir saat olduğunu söylemiyordu. Artık gerçek bir Vex zamanlayıcısı başlatıyor (araç çubuğundakini, ki çalar) ve zamanlayıcıları listeleyip iptal edebiliyor.
- **Ajan Vex'in neler yapabildiğini biliyor.** Her istek artık Keşfet'in gösterdiği özellik kataloğunu taşıyor (12 kategori, 100'ün üzerinde özellik) ve iki yeni araç var: *bir Vex özelliğine bak* ve *bir Vex komutu çalıştır*; bu, Ctrl+K'ye yazabileceğiniz her şeyi yapar: "hafta içi 7'ye alarm", "kronometre", "Tokyo'da saat kaç", "belleği boşalt" ya da adıyla herhangi bir komut. Bir web sitesine uzanmadan önce Vex'e bakması söylenmiş. Temizleyen, sıfırlayan ya da oturumu kapatan bir komut Otomatik onayla'da bile sorulur. Ona bugünün tarihi de söylenir; bir modelin kendi "bugün" fikri eğitim kesim tarihidir.
- **Sayfayı görebiliyor.** *Ekran görüntüsü* aracı sayfayı yakalayıp resmi atıyordu. Model artık onu görüyor (küçültülmüş olarak, bir kez); sayfa metninin açıklamadığı grafikler, tuvaller, resimler ve düzenler için. Görüntü destekli yerel modellerde çalışır (qwen3.5'te var; olmayan bir modele tahmin yürütmek yerine bunun olmadığı söylenir). Test edildi: 12 KB'lık bir görüntüden bir sayfanın renklerini ve düzenini doğru tarif etti.
- **Dur demek durmak demek.** Eskiden bir bayrak ayarlıyordu, o sırada çalışan model çağrısı ise devam ediyordu; yerel bir modelde 10 ila 20 saniye. Dur artık uçuştaki çağrıyı iptal ediyor: tıklamadan durmaya 0,8 sn ölçüldü. Durdurulan bir çağrı başka bir arka uçta yeniden denenmez.
- **Çalıştırmalar saklanıyor.** Son 30 ajan çalıştırması (hedef, adımlar, yanıt, zaman, model) yapay zekâ panelinin geçmişinde listelenir ve bir tıkla yeniden açılır. Her nihai yanıtta **Not olarak kaydet** ve **Kopyala** var.
- **Zamanlanmış görevler araştırma yapabiliyor.** Gözetimsiz bir çalıştırma artık web'de arama yapabilir, sayfaları okuyabilir ve bir not kaydedebilir ("her sabah şunu araştır ve not al") ve başarısız bir okumada ölmek yerine onun etrafından dolaşır. Yine tıklayamaz, yazamaz ya da diğer sekmelerinize dokunamaz.
- **Ayarlar › Yapay zekâ › Bu modeli ajan olarak sına.** Dört hazır soru (hiçbir şey yürütülmez, hiçbir şey makineden çıkmaz), yerel bir modelin doğru araçları seçip seçmediğini, ne kadar hızlı olduğunu, ekran görüntülerini görüp göremediğini ve bağlam boyutunun yeterli olup olmadığını söyler. Yeni ayar: *Ajan bağlam boyutu* (8K–64K).
- Bulut ajanının ekran görüntülerini görebilmesi için Yapay zekâ Worker'ının güncellenmiş `worker.js` ile yeniden dağıtılması gerekir; o zamana kadar ona göremediği söylenir ve metni okur.
- Sürümler: `npm run publish` artık web sitesinin rozetini taşımadan önce sürümün gerçekten yükleyicisi, blok haritası ve `latest.yml` dosyasına sahip olduğunu (ve taslak olmadığını) denetleyerek bitiyor; aksi halde yüksek sesle reddediyor.

## v7.91.2 (2026-09-18) — Araştırıp harekete geçebilen, yerel modelinizde çalışan ve sizin seçtiğiniz şekilde soran bir ajan

_v2.31.85 olarak yayımlandı._

### Notlar
- **Araştırma.** Ajanın sekme gerektirmeyen *web araması* ve *bir sayfayı oku* araçları var: arar (DuckDuckGo, yedek olarak Bing), en iyi sonuçları okur ve biçimlendirilmiş Markdown ile bir Kaynaklar listesi halinde yanıtlar. Eskiden "X'i araştır", bir arama motorunun sayfasını tek tek tıklayarak sürmek demekti. Bu makinedeki ya da yerel ağınızdaki adresleri okumaz.
- **Sayfalarda eylem artık modern sitelerde gerçekten çalışıyor.** Yazma, alanın değerini doğrudan yazıyordu; React ve Vue girdileri bunu hiç fark etmiyordu ve "Enter'a bas" hiçbir şeye basmıyordu. Yazma artık gerçek girdi yolundan geçiyor ve `submit` Enter'a basar ya da formu gönderir. Tıklamalar tüm işaretçi dizisini gönderiyor (fare basılınca açılan menüler artık açılıyor). Yeni: *görünen metne göre tıkla* (seçici gerekmez), *bir tuşa bas*, gördüğünüz metne göre seçilen açılır listeler ve başka bir açık sekmeyi ona geçmeden okumak.
- **Vex'in kendi özellikleri artık araçlar:** bir not kaydet, bir hatırlatıcı ayarla ("yarın 9"), bir yer imi ekle, geçmişinde ara, sekmeleri bir gruba koy, grupları yeniden adlandır; sekmelerin üstüne. "X'i araştır, not olarak kaydet ve kaynağı yer imi yap" tek bir istektir.
- **Yerel modelinizde çalışıyor.** Ajan yalnızca buluttaydı: Yapay zekâ Worker URL'si yokken Ollama çalışıyor olsa bile "Bulut yapay zekâ yapılandırılmamış" diyordu. Artık bu durumda yerel modeli kullanıyor ve talimatların dışarı itilmemesi için yeterince büyük bir bağlam penceresiyle. qwen3.5 üzerinde baştan sona test edildi: yaklaşık 30 saniyede kaynaklı araştırma.
- **Ajan izni, adlandırıldı.** *Sor / Planla / Otomatik* hapları neyi yönettiklerini söylemiyordu (ve ikisi aynı anda yanabiliyordu). Artık tek bir hap var: *Ajan: Elle onayla ▾*; her seçeneği açıklayan bir menü açar: **Elle onayla**, **Önce planla**, **Otomatik onayla**. Robot düğmesi onu ilk seferde, hiçbir şey çalışmadan önce açar. *Önce planla* artık gerçek bir plan: numaralı adımlar, bir kez onaylanır. Her kipte satın almadan, ödemeden, göndermeden, paylaşmadan ya da silmeden önce sorar; bunu modelin iddiası değil Vex karar verir.
- **Daha sağlam çalıştırmalar.** Hatalı biçimli tek bir yanıt görevi bitiriyordu; artık neyin yanlış olduğu söylenip yeniden isteniyor. Uzun bir araştırma modelin belleğini aşmasın diye eski araç sonuçları konuşmada kısaltılıyor. 15 yerine en çok 40 adım.
- Dürüst bir sınır: küçük bir yerel model bazen dikkatsiz okur (bir kez daha yeni bir sürümü listelerken bir sürüme "en son" dedi). Bulut modeli daha keskindir; tesisat ikisi için de aynıdır.

## v7.86.2 (2026-09-18) — Yapay zekâ ajanı artık "Ajan başladı"da takılmıyor ve sekme gruplarını yeniden adlandırabiliyor

_v2.31.84 olarak yayımlandı._

### Notlar
- **Düzeltildi: ajan sonsuza kadar "Ajan başladı: …" ekranında kalıyordu; adım yok, hata yok, yalnızca Dur.** İlk işi öndeki sayfayı okumaktır ve sayfa yüklenmemiş bir sekmede bu okuma hiç bitmiyordu: tek gezinmesi bir indirmeye dönüşen bir sekmede (bir `…/download/Vex-Setup.exe` bağlantısı) ya da herhangi bir boş yanıtta belge yoktur ve Electron bir betik çağrısını bir belge yüklenene kadar bekletir. Hiçbir şey fırlatılmadığı için hiçbir şey bildirilmiyordu. Yeniden üretildi ve ölçüldü: iki sayfa okuması da 8 saniyeyi aşıp takıldı; artık yaklaşık 1 ms'de "Bu sekmede yüklenmiş sayfa yok" yanıtını veriyorlar ve ajan sayfa bağlamı olmadan devam ediyor.
- **Yapay zekâ yollarındaki her sayfa okumasının ve sayfa eyleminin artık bir son süresi var** (on çağrı: iki sayfa okuyucu ve ajanın tıkla, yaz, seç, kaydır, çıkar, bekle ve ara eylemleri). Yanıt vermeyi bırakan bir sayfa ajanı dondurmak yerine 8 sn sonra bildiriliyor.
- **Ajan sekme gruplarıyla çalışabiliyor.** "Sekme gruplarımı yeniden adlandır" daha önce imkânsızdı; tüm araçları öndeki sayfa üzerinde çalışıyordu ve gruplar Vex'in kendisine aittir. Yeni araçlar: *sekme gruplarını listele* (sormadan çalışır) ve *sekme grubunu yeniden adlandır* (Sor kipinde, tıklama gibi önce sorar). Hiçbir sayfa açık değilken de çalışırlar. Grup menüsündeki Yeniden adlandır aynı kodu kullanır.
- Ajan hâlâ yalnızca bulut arka ucunda çalışıyor; Yapay zekâ Worker URL'si yoksa takılmak yerine bunu söylüyor.

## v7.83.7 (2026-09-17) — Yapay zekâ ile Sekmeleri Düzenle, yerel akıl yürütme modellerinde çalışıyor

_v2.31.83 olarak yayımlandı._

### Notlar
- **Düzeltildi: Ctrl+Shift+G "Yapay zekâ hatalı biçimli bir yanıt döndürdü" diyordu.** Yerel bir akıl yürütme modelinde (qwen3, deepseek-r1…) Ollama modelin düşüncelerini ayrı bir alana koyar ve JSON istendiğinde model tüm turunu orada harcayıp *boş* bir yanıt döndürüyordu; qwen3.5 üzerinde ölçüldü: 1.700 karakter düşünce, sıfır yanıt. Her yerel yapay zekâ özelliği JSON ister, bu yüzden yalnızca sekme gruplama değil hepsi etkileniyordu. JSON istekleri artık modele önce düşünmemesini söylüyor; düşünme kipi olmayan modeller bayrağı yok sayar.
- **Boş bir yanıt artık bunu söyleyen bir hata** — "qwen3.5 yalnızca akıl yürütme üretti ve yanıt üretmedi" — üç katman yukarıda yanlış okunan boş bir dize yerine.
- **Sekme gruplama daha fazla yanıt türünü okuyor ve gerisini açıklıyor.** Bir kod bloğu içindeki JSON'u, bir `<think>` bloğundan sonrakini ya da iki yanında birer cümle olanı kabul ediyor; aksi halde yanıtın boş mu olduğunu, JSON olmadığını mı yoksa bitmeden mi kesildiğini söylüyor.
- **Yerel modelde daha hızlı:** sekmeler uzun iç kimlikleri yerine `t1…tn` olarak gönderiliyor (her biri yaklaşık 20 belirteç, yanıtta tekrarlanıyor) ve sonradan geri eşleniyor; modelin uydurduğu bir kimlik atılıyor. Aynı sekiz sekmelik gruplama burada 21–25 sn'den 14 sn'ye indi.

## v7.82.7 (2026-09-14) — Discord bellek bildirimi geri gelmeyi bırakıyor ve mesaj kutusunun üzerinden çekiliyor

_v2.31.82 olarak yayımlandı._

### Notlar
- **Düzeltildi: Discord bellek bildirimi Sonra'dan sonra her dakika geri geliyordu.** Sonra yalnızca bildirimi susturuyordu; şeridin kendisi sonraki denetimde yeniden kuruluyordu. Sonra artık dört saat sessizlik demek ve yeni bir *Bir daha gösterme* bellek bildirimlerini kapatıyor.
- **Düzeltildi: Discord'un mesaj kutusunun üzerinde duruyordu.** Her iki bildirim de, Discord'unki ve ağır bir sekmeninki, artık panelin ya da sayfanın *üstünde* ince bir şerit; Klasik görünümde panelin gezinme şeridinin altında.
- **Bellek bildirimleri bir ayar.** Ayarlar › Performans › *Bellek bildirimleri*: Varsayılan (sekmeler 800 MB, Discord 1 GB), Kapalı ya da kendi belirlediğiniz bir tavan. Tek ayar ikisini de kapsar.
- **Yayımlama:** GitHub sürümü artık yükleyici ve blok haritası içine yüklenmeden önce oluşturuluyor; böylece iki yükleme onu oluşturmak için yarışamıyor (bu yarış, v2.31.81'i elle yamalanana kadar `latest.yml` olmadan bıraktı). Bu, v2.31.81'de olan herkes için delta indirme olarak gelen ilk sürümdür.

## v7.81.7 (2026-09-14) — Delta güncellemeler, panel başına uyanık tutma, ağır sekme bildirimi, Sağlık, daha hızlı açılış

_v2.31.81 olarak yayımlandı._

### Notlar
- **Güncellemeler yalnızca değişeni indiriyor.** Şimdiye kadarki her güncelleme 98 MB'lık yükleyicinin tamamını çekiyordu; delta paketleri artık yayımlanıyor, bu yüzden bundan sonraki sürümden itibaren güncelleyici değişen blokların birkaç MB'ını çekecek. (Bu güncelleme yine tam indirme: ilk delta, blok haritası olan bir önceki sürüm gerektirir.)
- **Panel başına uyanık tutma.** Ayarlar › Performans her web panelini bir *Uyanık tut* anahtarıyla listeler. Discord ve WhatsApp varsayılan olarak açık; uyuyan bir panel yeni ileti bildirimi gösteremez ve panel uykusu bunu daha önce söylemiyordu.
- **Ağır sekme bildirimi.** 800 MB'ı geçen bir sekme, öndeyken *Yeniden yükle* ile tek satırlık bir bildirim gösterir, tıpkı Discord panelininki gibi; asla otomatik değil, kayıt yaparken ya da çalarken asla; *Sonra* o sekme için yarım saatlik sessizliktir.
- **Bellek panelinde Sağlık:** çalışma süresi ve başlangıç zamanlamaları (uygulama hazır, pencere gösterildi, arayüz yüklendi, ilk sayfa), açılıştan beri sayfa çökmeleri ve donmaları ve kaybedilen yardımcı süreçler, yüklenemeyen uzantılar, güncelleyicinin son sözü, Windows'ta zamanlanmış hatırlatıcılar. *Raporu kopyala* içinde yer alır.
- **Daha hızlı açılış.** Araç Kutusu'nun paketleri ve başvuru tabloları (yaklaşık 800 KB, 325 araç) her açılışta ayrıştırılmak yerine ilk kullanımda (Araç Kutusu'nu ya da Ctrl+K'yi açarken) yükleniyor. Bu makinede ölçüldü: uygulama hazır 0,2 sn, pencere 0,6 sn, arayüz 1,3 sn, ilk sayfa 2,0 sn.
- **Belleği her yerden boşaltın:** Ctrl+K → "belleği boşalt" ya da Ctrl+Alt+M (Ayarlar › Kısayollar altında yeniden atanabilir).

## v7.76.1 (2026-09-14) — Discord dinleniyor, mikrofon ve kamera rozetleri, bir bellek eğilimi ve onu boşaltmak için tek bir düğme

_v2.31.80 olarak yayımlandı._

### Notlar
- **Discord, gizliyken ve bir görüşmede değilken dinleniyor.** Paneli, anında yeniden bağlanabilmesi için arka plan kısıtlamasıyla kapalı çalışır; öyle bırakılınca bütün gün bir çekirdeğin yaklaşık yüzde 35'ini yakıyordu (üç saatte 3.763 sn işlemci, ölçüldü). Görüşme olmadan, yani mikrofon kullanımda değil, sesli değil ve sayfasında Bağlantıyı kes düğmesi yokken iki dakika görünmez kalırsa kısıtlanır; açmak ya da bir görüşmenin başlaması onu hemen uyandırır. Ayarlar › Performans › *Discord'u gizliyken ve bir görüşmede değilken dinlendir*.
- **Mikrofon ve kamera rozetleri.** Mikrofonu ya da kamerayı kullanan bir sekme veya panel kırmızı bir rozet gösterir (konuk, bir iz başlayıp durduğu anda bunu bildirir). Böyle bir sekme veya panel asla uyutulmaz ve Bellek paneli onu Video Yakalama ve Ses satırlarında adıyla anar; "yakalama hizmetlerini kim tutuyor?" sorusu kendiliğinden yanıtlanır.
- **Açılıştan beri bellek eğilimi**, Bellek panelinin en üstünde: açılıştan itibaren her 30 saniyede örneklenen toplam bellek, Vex'in bu konuda yaptığı her şey için bir nokta (uyutulan sekmeler, uyutulan bir panel, yeniden yüklenen Discord) ve oturum boyunca değişim.
- **Belleği şimdi boşalt**, tek düğme: boştaki sekmeleri uyut (30 dakikadan uzun süredir boşta olan sabitlenmişler de), gizli panelleri uyut, sayfası açık olmayan oturumlardan uzantıları bellekten çıkar.
- **Ayarlar › Uzantılar'da uBlock Origin hakkında bir not:** Electron uzantılara istek engelleme vermez ve Vex reklam ve izleyici isteklerini kendisi engeller; bu yüzden Vex'te uBlock yalnızca sayfa öğelerini gizleyebilir, arka plan sayfası için yaklaşık 85 MB karşılığında. Hiçbir şey kaldırılmadı; kart bunu söylüyor.
- **Ölçüldü, değiştirilmedi:** arayüz işleyicisi yüzde 0,2 işlemcide boşta duruyor ve panellerin ve menülerin 15 aç/kapat döngüsü boyunca büyüme yok; daha önce görülen yüzde 7, Bellek panelinin süreç tablosunu her 3 sn'de yeniden çizmesiydi ve artık her 10 sn'de. Başlangıç sayfasının 111 MB'ı Chromium'un işleyici başına taban değeridir (38 MB özel); on beş bulanıklık filtresinin hepsini kaldırmak hiçbir şeyi değiştirmedi, bu yüzden kalıyorlar.

## v7.72.3 (2026-09-14) — Boştaki bellek: tek bir uBlock, istek üzerine kapsayıcılar, sabitlenmiş sekmeler uyuyabiliyor

_v2.31.79 olarak yayımlandı._

### Notlar
2.31.78'den sonra bir Bellek paneli raporundan: 15 süreç, 1,98 GB; uBlock Origin'in beş kopyası (426 MB), üçü hiçbir sekmenin açık olmadığı kapsayıcı oturumları için ve bellek korumasının dokunmasına izin verilmeyen iki sabitlenmiş claude.ai sekmesi (550 MB).
- **Kapsayıcı oturumları uzantıları yalnızca içlerinde bir sekme açıkken alıyor** ve son sekme kapandıktan bir dakika sonra geri veriyor; varsayılan oturum da aynı. Açılışta beş yerine tek bir uBlock Origin arka plan sayfası (iki sürüm önce on bir tane vardı). Normal sekmeler ve uygulama panelleri değişmedi; bunlar, bir içerik betiği ilk sayfayı kaçırmasın diye hevesle yüklenir.
- **Bellek koruması artık sabitlenmiş sekmeleri uyutabiliyor.** Bellek tavanını aştığında yine önce sabitlenmemiş boştaki sekmeleri uyutur; bu yetmezse yarım saattir bakılmamış bir sabitlenmiş sekme de gider. Sabitleme yerini korur ve sekme bir tıkla uyanır. (İki sabitlenmiş claude.ai sekmesi, mikrofon erişimleri yüzünden Chromium'un yakalama ve ses hizmetlerini de, 236 MB, ayakta tutuyordu; sekmeler uyuyunca bunlar da gidiyor.)
- **Süreç listesi yardımcı süreçleri açıklıyor**: Video Yakalama, Ses, Ağ ve DRM hizmetinin her birinin ne işe yaradığını ve ne zaman sona erdiklerini.

## v7.70.0 (2026-09-14) — Daha az bellek: uzantılar yalnızca geçerli oldukları yerde, uyuyan paneller ve okuyabileceğiniz bir süreç listesi

_v2.31.78 olarak yayımlandı._

### Notlar
Bu sürümden önce gerçek bir makinede ölçüldü: 27 süreç, 3 GB yerleşik bellek. Bunun üçte biri Discord paneliydi; yaklaşık 390 MB, uBlock Origin'in on bir boşta kopyasıydı; şimdiye kadar açılmış her kenar çubuğu paneli bellekte kalıyordu.
- **Uzantılar yalnızca geçerli oldukları yerde yükleniyor.** Gezinti oturumları her uzantıyı alır. Bir kenar çubuğu panelinin oturumu (Discord, WhatsApp, Claude, Spotify, Prime, Roblox) bir uzantıyı yalnızca içerik betikleri o siteyi adlandırdığında alır: Vencord Discord'a, RoSuite Roblox'a, uBlock Origin gibi genel bir uzantı (Manifest v2, kalıcı bir arka plan sayfası) yalnızca gezintiye gider: 11 yerine 5 kopya, altı süreç daha az. Ayarlar › Uzantılar her uzantı için *Çalıştığı yer: gezinti sekmeleri + Discord* gösterir ve her yerde çalıştırmak için bir anahtar sunar; değişiklik canlı uygulanır.
- **Gizli paneller uyuyor.** Claude, Spotify, GitHub… süreçlerini sekmelerle aynı boşta kalma süresinden sonra geri verir (Bellek Tasarrufu altında 10 dakika), ses çalarken asla, ve bir sonraki açılışta taze gelir. Discord (ses, bildirimler) varsayılan olarak uyanık tutulur; ikisi de Ayarlar › Performans altında anahtardır. Bir panelin simgesine sağ tıklayın → *Paneli uyut*.
- **Discord bellek bildirimi.** 1 GB'ı geçince Discord paneli bir Yeniden yükle düğmesiyle tek satırlık bir bildirim gösterir (ve en çok yarım saatte bir bir bildirim). Asla otomatik değil; yeniden yükleme bir sesli görüşmeyi düşürür.
- **Bellek paneli artık her şeyi gösteriyor.** Panel başına gerçek MB gösteren bir *Paneller* bölümü (Uyut / Yeniden yükle / Aç) ve Vex'in çalıştırdığı her süreci adlandıran bir *Süreçler* bölümü: *Panel: Discord*, *Sekme: Hacker News*, *uBlock Origin — arka plan · persist:main*, *GPU süreci*, hizmet çalışanları; yerleşik ve özel bellek ve işlemci ile, tür başına toplamlarla ve her yere yapıştırabileceğiniz düz metin bir tablo veren bir *Raporu kopyala* düğmesiyle.
- **Düzeltildi:** Bugün özeti "bugün"ü ikinci bir saatten okuyordu ve gece yarısında kayıyordu; Bellek panelindeki uyuyan bir satır başıboş bir `U0001f4a4` gösteriyordu.

## v7.64.4 (2026-09-13) — İki panel: başlıkta bir +, sürüklenecek bir ayırıcı, tarafları değiştirme

_v2.31.77 olarak yayımlandı._

### Notlar
- **Chrome, Safari ve IE görünümleri de bunu yapabiliyor.** Bu görünümlerde Shift+tıklanacak ya da sağ tıklanacak bir simge rayı yok; bu yüzden panel başlığında artık bu panelin yanında açılacak diğer panelleri listeleyen bir **+** (ve iki panel olduğunda *Tarafları değiştir*) ve ikinci paneli adlandırıp kapatan bir çip var: *+ Claude AI ×*.
- **İki paneli ayıran bölücüyü sürükleyin** ve payı değiştirin (yüzde 20–80); Vex hatırlar. Bölücüye çift tıklayın ya da menülerdeki *Tarafları değiştir*'i kullanın, onları değiş tokuş etmek için.
- **Düzeltildi:** Klasik görünümde, Claude'un yanında Discord, yani iki web paneli, yan yana yerine alt alta dizilecekti.
- **Düzeltildi:** Ayarlar › Kenar çubuğu'nda bir kenar çubuğu düğmesini gizlemek ya da bir siteyi sabitlemeden çıkarmak, ikinci panel olduğu sırada onu ekranda bırakıyordu.
- **Düzeltildi:** Başlat düğmesi başka bir panelin yanında açılabiliyor ve boş bir yarı gösteriyordu.
- Ayarlar › Kenar çubuğu üç giriş yolunu açıklıyor.

## v7.62.9 (2026-09-13) — Aynı anda iki panel, paneller tam boyutta açılıyor, okunabilir öneriler

_v2.31.76 olarak yayımlandı._

### Notlar
- **Claude, Discord'un yanında — ikisi de aynı anda kullanılabilir.** Bir kenar çubuğu simgesine Shift+tıklayın ya da sağ tıklayıp *Discord'un yanında aç*'ı seçin; panel zaten açık olanın yanında, her biri alanın yarısı olarak açılır. Vex çifti hatırlar: ikisinden birini sonradan açarsanız diğeri de onunla gelir; ikinci panelin simgesine yeniden tıklayana (ya da sağ tıklayıp → *Yanındakini kapat*) kadar, ki bu çifti unutur. Ayarlar hiçbir zaman paylaşmaz.
- **Paneller tarayıcı görünümlerinde büyütülmüş açılıyor.** Discord, Claude, Prime, Roblox bütün uygulamalardır; Chrome, Safari, Firefox ve Glass görünümlerinde bir panel artık tüm sayfa alanını kaplayarak açılıyor. Panel başlığındaki Geri yükle'ye basarak onu kenar çubuğuna geri koyun; Büyüt'e yeniden basana kadar öyle kalır.
- **Düzeltildi: Chrome tarzı görünümlerde ilk arama önerisi okunamıyordu.** İşaretçinin altındaki satır, yani adres çubuğunun hemen altındaki ilk satır, mavi bir çubuk üzerinde mavi metindi; çünkü bu görünümler satırın hem dolgusunu hem metnini aynı vurgu rengine eşliyor. Artık gerçek bir adres çubuğundaki gibi açık bir ton ve sıradan metin. (Hiçbir şey önceden seçili değildir; orada duran işaretçiydi.)

## v7.60.9 (2026-09-13) — DevTools her yerden yeniden açılıyor

_v2.31.75 olarak yayımlandı._

### Notlar
- **Düzeltildi: geliştirici panosunun DevTools'u aç düğmesi "bu derlemede sunulmuyor" diyordu.** Var olmayan bir köprü yöntemini çağırıyordu. Artık arayüzün kendi denetçisini altta yuvalanmış olarak açıyor ve ikinci basışta kapatıyor.
- **Düzeltildi: bir kenar çubuğu panelinde DevTools'u aç sessizce hiçbir şey yapmayabiliyordu.** Sayfası yeni bağlanmış bir panel kimliğini -1 olarak bildirir; bu, sayfayı adresiyle bulan koda ulaşmadan reddediliyordu ve tek rapor konsolda bir satırdı. Her iki kapı da artık adres aramasının gerçekleşmesine izin veriyor (aynı sahiplik denetimiyle) ve yine de açılamazsa bir ileti bunu söylüyor.
- DevTools penceresi açıldığında öne getiriliyor.

## v7.60.4 (2026-09-13) — Kurulum sihirbazı önemli ayarları soruyor

_v2.31.74 olarak yayımlandı._

### Notlar
- **İlk çalıştırmada üç yeni adım.** *Tarayıcı nasıl davranır*: sekmelerin nerede durduğu, fare hareketleri, çerez bannerları, kopyalamayı engelleyen siteler, oturum otomatik kaydı, sekme grubu önerileri. *Vex neyi okuyabilir*: yapay zekâ geçmiş dizinleme ve e-posta kodu otomatik doldurma, açılmadan önce sade sözlerle açıklanır. *Bildirimler*: Windows'un bunu gösterip göstermediğini söyleyen bir deneme düğmesi ve göstermediyse nereye bakılacağı. Her adım geçerli değeri gösterir ve Ayarlar ile aynı kod üzerinden uygulanır.
- **Performans adımı artık vaat ettiği dokuzu gerçekten sunuyor.** Yedi tane listeliyordu: sabitlenmiş sekme istisnası ve bellek koruması eksikti.
- **Düzeltildi:** Görünüm ve Performans adımları, sihirbaz yeniden açıldığında her seferinde ayarsız gösteriliyordu; çünkü iki adım "bitti"yi bir şekilde kaydediyor, denetim ise başka şekilde okuyordu.
- Toplam 22 adım; her şey yine atlanabilir ve sonrasında her şey Ayarlar'da.

## v7.58.9 (2026-09-13) — Ctrl+K'de cümleler, bildirimde ertele, haftalık bir gözden geçirme, sizi izleyen hatırlatıcılar

_v2.31.73 olarak yayımlandı._

### Notlar
- **Komut çubuğunda sade cümleler.** Ctrl+K'ye "yarın 9'da Dana'yı aramamı hatırlat", "zamanlayıcı 25 dk çay", "hafta içi 7'ye alarm", "Tokyo'da saat kaç" ya da "kronometre" yazın ve Enter'a basın. Panel yok.
- **Bildirimden ertele.** Bir hatırlatıcının Windows bildiriminde artık 9 dk ertele ve Aç düğmeleri var. Her biri Vex'in okuduğu bir vex:// bağlantısı başlatır; bildirim Eylem Merkezi'nde bekledikten sonra bile çalışır.
- **Haftalık bir gözden geçirme.** Her Cuma beşte bir hatırlatıcı tek bir dürüst kart açar: ne çaldı, ne ertelendi, neyi kaydedip hiç okumadınız, izlenen hangi sayfalar değişti, hangi araçları kullandınız. Ayrıca Ctrl+K → Haftalık gözden geçirme altında ve Çalışma panelinde.
- **Hatırlatıcılar sizi izliyor.** Vex Eşitleme açıkken bir makinede kurulan hatırlatıcı, açık oldukları sürece diğerlerinde çalar. Windows'u onun için yalnızca onu kuran makine uyandırır ve herhangi bir yerde çalmış olan asla iki kez çalmaz. Bir eşitleme hiçbir şeyi silmez.
- **Alarm sesi ve ses düzeyi**, önizlemeyle: dört ses, bir kaydırıcı ve ısrarlı ya da yumuşak (bir kez, sonra her otuz saniyede).
- **Çalışma, geri kalanından ayrı.** Hatırlatıcılar ve alarmlar, kurulduğu işi taşır; Bugün onları işaretler ve Çalışma paneli bu iş için kurulanları listeler.
- **Yeni sekmenin Son listesi gerçek ziyaretleri gösteriyor.** Eklendiğinden beri bir yer tutucuydu.
- `scripts/verify-reminders.js --exe <path>` kurulu bir Vex.exe'yi sürer. Kurulu 2.31.72'ye karşı, Vex kapalıyken çalıştırıldı: Windows Vex.exe'yi başlattı ve bildirim 17:47:00,9'da teslim edildi; paketlenmiş yol, doğrulandı.

## v7.53.9 (2026-09-13) — Bir Saat: alarmlar, zamanlayıcılar, kronometre, dünya saati

_v2.31.72 olarak yayımlandı._

### Notlar
- **Kenar çubuğunda bir Saat paneli** (ve Ctrl+K → Saat) dört sekmeyle.
- **Alarmlar çalıyor.** Saat, haftanın günleri, bir etiket ve siz Kapat ya da Ertele'ye (9 dakika) basana kadar çalmaya devam eden sesli bir alarm. Bir alarm altta bir hatırlatıcıdır, bu yüzden Windows uyandırmasını alır: Vex kapalı olsa bile çalar. Tekrarlayan alarmlar seçilen sonraki güne geçer ve yeniden kapatılana kadar yine çalar.
- **Zamanlayıcılar.** "25 dk", "1s 30", "90sn" ya da 10:00, aynı anda birkaç tane, hazır ayarlarla. En yakın olanı üst çubukta ilerler; Saat'i açmak için ona tıklayın. Bir dakika ya da daha uzun bir zamanlayıcı yeniden yüklemeyi aşarak saymaya devam eder ve alarmın yanı sıra bir masaüstü bildirimiyle sona erer.
- **Tur kaydeden bir kronometre.**
- **Seçtiğiniz şehirler için bir dünya saati** — canlı saatler, gündüz ya da gece, sizden fark — ve "burada saat 15:00 iken orada saat kaç" için bir kaydırıcı. Herhangi bir IANA dilimi de çalışır. Şehirler yeni sekme sayfasında da görünür.
- **Başka bir şehrin saatinde hatırlatıcılar.** "New York saatiyle 9" ya da "yarın Tokyo'da 17:00" o ana denk düşer ve kaydedilmeden önce her iki saatte de okunarak geri gösterilir.
- Canlı doğrulandı: 15:46'ya kurulan bir alarm 15:46'da ses döngüsü çalışarak çaldı, Kapat bunu kaydetti ve bir sonraki Pazar'a taşıdı.

## v7.48.9 (2026-09-13) — Tekrarlayan, sayfaları ve siteleri izleyen hatırlatıcılar; yeni sekmede Bugün

_v2.31.71 olarak yayımlandı._

### Notlar
- **Hatırlatıcılar tekrarlanabiliyor** — her gün, hafta içi ya da her hafta, aynı saatte. Her oluşumun kendi Windows uyandırma görevi var, bu yüzden "hafta içi 9" Vex kapalıyken de ulaşır.
- **Bana bu sayfayı hatırlat.** İletişim kutusu bulunduğunuz sayfayı önerir; hatırlatıcının bildirimi onu Vex'te bir Sayfayı aç düğmesiyle açar. "Buna geri dön" artık sizi geri getiriyor.
- **Bu siteyi bir sonraki açışımda.** Saat yerine "github.com'u açtığımda" yazın; hatırlatıcı bir sekme oraya indiği anda çalar. Tek tıklık bir çip geçerli siteyi önerir.
- **Herhangi bir seçime sağ tıklayın** — bir Discord iletisi, bir paragraf, bir görev — *Bana bunu hatırlat*, *Bu sayfa için not olarak kaydet* ya da *Vex yapay zekâya bunu sor* için. Kenar çubuğu panellerinin içinde de çalışır.
- **Yeni sekme sayfasında Bugün:** bugün vadesi gelen hatırlatıcılar, çalışmak üzere olan zamanlanmış görevler, değişen izlenen sayfalar ve yakın zamanda kaydettiğiniz sayfalar, hep birlikte.
- **Odak hatırlatıcılarınızı tutuyor.** Bir odak oturumu sırasında bekler ve oturum bitince, vadelerinin geldiği zamanla işaretlenmiş bir toplu olarak gelirler; Acil'i işaretlemediyseniz.
- **Her araç son on sonucunu saklıyor** (tek tıkla geri yüklenir) ve Araç Kutusu en son açtığınız araçları favorilerinizin yanında gösteriyor.
- **Zamanlı her hatırlatıcı bir takvim girdisi olarak kaydedilebilir** (.ics, tekrar kuralı dahil), Outlook ya da Google Takvim için.
- Gerçek bir pencerede canlı doğrulandı: bir site hatırlatıcısı gezinmede çaldı, acil hatırlatıcı odak sırasında çalarken normal olan bekledi ve yeni sekme sayfası günün hatırlatıcısını çizdi.

## v7.43.9 (2026-09-13) — Web sitesi bildirimleri, bir deneme düğmesi, erteleme

_v2.31.70 olarak yayımlandı._

### Notlar
- **Web sitelerinden bildirimler artık çalışıyor — Discord, WhatsApp, izin verdiğiniz her şey.** Hiç çalışmamıştı. İstem onları veriyordu, sonra Vex görüntüleme zamanında reddediyordu: kararlar sonunda eğik çizgi olmayan kaynak altında saklanıyordu ve Chromium'un bir bildirimi göstermeden önce çalıştırdığı denetime eğik çizgili kaynak veriliyordu; bu yüzden izin verilmiş bir site kendi kararıyla hiç eşleşmiyordu. Canlı ölçüldü — navigator.permissions.query, İzin ver'den saniyeler sonra "denied" diyordu. İki yazım artık uyuşuyor. Geçmişte izin verdiğiniz siteler yeniden sorulmadan kabul ediliyor.
- **Ayarlar › Site izinleri'nde bir "Deneme bildirimi gönder" düğmesi var.** Windows'un bunu gösterip göstermediğini sözcüklerle söyler ve görmediyseniz nereye bakacağınızı da. Bildirimler uygulamanın bütün ömrü boyunca sessizce başarısız oldu, çünkü hiçbir şey bunu denetlemiyordu.
- **Bir hatırlatıcının bildirimine tıklamak hatırlatıcıyı Vex'te açıyor**, tam metniyle, vadesinin ne zaman olduğuyla ve 10 dk / 1 saat / Yarın 9 ertele ile. Masaüstü bildirimi reddedildiyse, hatırlatıcı kaybolmak yerine kendiliğinden Vex'te açılıyor.
- **Hatırlatıcılar Zamanlamalar panelinde görünüyor**, zamanlanmış görevlerin yanında, kaldırmanın bir yoluyla ve bir "Bana hatırlat" düğmesiyle; olacak her şeyi görmek için tek bir yer.
- `scripts/verify-reminders.js` gerçek uygulamayı açar ve tüm yolu kanıtlar — Windows görevi, bildirim, temizlik — ve `--closed` ile Windows'un kapatılmış bir Vex'i uyandırdığını. İki buçuk dakika sürdüğü ve gerçek bir bildirim gösterdiği için VEX_SMOKE_REMINDERS=1 arkasına alındı.

## v7.40.1 (2026-09-13) — Görünen bildirimler, Vex kapalıyken çalan hatırlatıcılar

_v2.31.69 olarak yayımlandı._

### Notlar
- **Masaüstü bildirimleri çalışıyor — ilk kez.** Vex'in arayüzü bir file:// sayfasıdır ve Chromium bu kaynağa Bildirim API'sini tümden reddeder: izin, henüz kimse sormadan "denied" okunuyordu ve görünen tek istem "null size bildirim göndermek istiyor" diyordu. Vex'in şimdiye kadar göndermeyi denediği her bildirim — zamanlanmış hatırlatıcılar, sayfa değişikliği uyarıları — asla geçemeyecek bir denetimin ardında sessizce atılıyordu. Artık Windows'un kabul ettiği ve bildirimin gerçekten gösterilip gösterilmediğini bildiren ana süreç tarafından gönderiliyorlar. Reddedilen bir bildirim, kaybolmak yerine nedeniyle birlikte uygulama içinde söyleniyor.
- **Hatırlatıcılar Vex kapalıyken bile çalıyor.** Bir hatırlatıcı artık ana süreçte kendi zamanlayıcısıyla yaşıyor, bu yüzden bir yeniden yükleme onu kaybedemiyor; Windows'ta da Görev Zamanlayıcı'daki eşleşen tek seferlik bir görev, çalışmıyorsa Vex'i o dakikada başlatıyor. Birini kurun, Vex'ten çıkın, bildirim yine de gelir; görev sonrasında kendini temizler. İki durumda da canlı doğrulandı: 13:28'e kurulan bir hatırlatıcı Vex açıkken 13:28:00,002'de gösterildi ve 13:31'e kurulan, Windows'un başlattığı bir Vex'ten 13:31:00,5'te gösterildi.
- Makine kapalıyken kaçırılan bir hatırlatıcı bir sonraki başlatmada, vadesinin geldiği zamanla işaretlenmiş olarak çalar. Hiçbir şey asla iki kez çalmaz.
- Beni hatırlat iletişim kutusu neyin kurulu olduğunu listeler ve birini geri almanıza izin verir. Windows uyandırma görevini oluşturmayı reddederse, iletişim kutusu bunu, günü geldiğinde öğrenmeniz yerine kaydederken söyler.
- Bir geliştirme çalıştırmasının başlığı da "Electron" değil "Vex". Windows bir bildirimi, süreci hedefleyen Başlat Menüsü kısayolunun adıyla adlandırır; Electron ilk bildirimde kendi exe'sinin adıyla bir kısayol yazar ve o eski kısayol kazanıyordu. Bir kaynak çalıştırması artık açılışta bu ikili için Electron'un kısayolunu kaldırıyor ve Vex'in kimliğini taşıyan kendi kısayolunu yazıyor. Kurulu uygulamanın başlığı her zaman "Vex" idi.

## v7.36.3 (2026-09-13) — Bana hatırlat ve bir yeniden başlatma düğmesi

_v2.31.68 olarak yayımlandı._

### Notlar
- **Bir görevi yapıştırın, ne zaman olduğunu söyleyin, Vex size sonra söylesin.** Ctrl+K → **Bana hatırlat**. Yapmanız gereken şey için tek bir kutu — seçili olan metinle önceden doldurulur — ve ne zaman için bir tane daha. "2 saat içinde", "45 dk içinde", "yarın 9", "cuma 17:00", "bu akşam", "öğle", "2026-09-20 14:00" ve henüz ilerideyse bugün, değilse yarın anlamına gelen "18:00" gibi yalın bir saati anlıyor. Beş tek tıklık çip olağan olanları kapsıyor.
- **Hiçbir şeyi kaydetmeden önce zamanı geri okuyor.** Kutunun altındaki satır "Yarın 09:00'da — şimdiden 19 saat sonra" der; böylece Vex'in sizin kastettiğinizi anladığını görebilirsiniz. Okunamayan bir ifade, imkânsız bir saat, var olmayan bir tarih ya da geçmiş bir an, sessizce beklenmedik bir yere düşmek yerine her biri neyin yanlış olduğunu söyler.
- Hatırlatıcılar sıradan zamanlanmış görevlerdir; bu yüzden Zamanlamalar panelinde görünür, yeniden başlatmadan sağ çıkar ve Vex kapalı olduğu için kaçırılan biri siz açtığınızda yine ulaşır.
- **Geliştirici panosunda bir Vex'i yeniden başlat düğmesi,** Arayüzü yeniden yükle'nin yanında. Yeniden yükleme arayüzü, yani js, css, index.html'i yeniden çalıştırır. Ana süreçteki, önyükleme betiklerindeki ya da site ince ayarlarındaki değişiklikleri alamaz, çünkü bunlar pencere var olmadan önce çalışmıştı; birini düzenleyip yeniden yüklemek, düzenleme hiçbir şey yapmamış gibi görünür. İki düğme de artık hangi değişiklikleri kapsadığını söylüyor.

## v7.31.0 (2026-09-13) — Her aracın yanında bir başvuru

_v2.31.67 olarak yayımlandı._

### Notlar
- **Her araç artık kendini açıklıyor.** Paketlerdeki 303 aracın hepsi yazılı bir başvuru paneliyle açılıyor — 887 bölümde ve bin üzerinde tablo satırında kabaca 30.000 sözcük. Aracın adının yinelenmesi değil: insanların karıştırdığı HTTP durum kodları, chmod bitleri ve bir dizinde ne anlama geldikleri, bir ABD galonunun neden bir İngiliz galonundan beşte bir küçük olduğu, bir kesrin ne zaman bittiği, 35 °C'lik bir yaş termometre sıcaklığının ne anlama geldiği, bankacı yuvarlamasının neden var olduğu. Daha önce yalnızca BMI'nin vardı.
- **Başvuru, bir yöntemin nerede çöktüğünü söylüyor.** Luhn denetimi bir yazım hatası yapılmadığını kanıtlar, başka hiçbir şeyi değil. Bir user-agent dizesi 1990'lardan beri yalan söylüyor. BAC hesaplayıcıları asla araç kullanıp kullanmayacağınıza karar vermemeli. CRC-32 kazaları yakalar ve sahte yapılması çocuk oyuncağıdır. Araç size sayıyı verir; panel onun ne değerde olduğunu söyler.
- **BMI üç alandan altıya çıkıyor.** Bel, yaş ve Asya eşik kümesi kilo ve boya katılıyor ve yanıt artık bandınızın aralığını, boyunuz için sağlıklı kilo aralığını, ondan ne kadar uzak olduğunuzu, BMI Prime'ı, Ponderal indeksi, vücut yüzey alanını, bel-boy oranını ve yaşa uygun bir notu içeriyor. Kendi çalışılmış örneklerinden ikisi yanlıştı ve düzeltildi.
- **Çalışma paneli yeniden yapıldı.** Yirmi yedi satır içi stil ve bir aracın ne yaptığını size hiçbir şey söylemeyen, simge ve ad kutucuklarından oluşan sıkışık bir ızgaraydı. Artık iş kendini tanıtıyor, "Vex yapay zekâya sor" mesajınızın nereye gideceğini dürüstçe söyleyen tek belirgin eylem ve araçlarınız açıklamalarıyla okunabilir bir liste.
- **Düzeltildi:** birkaç özellikten söz eden bir Vex yapay zekâ yanıtı hiç kısayol sunamayabiliyordu. Çip listesi, bir özelliğin gerçekten açılıp açılamayacağı denetlenmeden önce sınırlanıyordu; bu yüzden elle yaptığınız girdiler, yapamayacaklarınızı dışarı itiyordu.
- Keşfet artık başvuru panelini, iki araç boyutunu, favorileri, geliştirici kipini ve geliştirici panosunu kapsıyor.

## v7.29.5 (2026-09-13) — Favoriler, bir geri dönüş yolu ve bir geliştirici kipi

_v2.31.66 olarak yayımlandı._

### Notlar
- **Bir aracı açmak artık yerinizi kaybettirmiyor.** Araç Kutusu'ndan açılan bir aracın artık başlatıcıyı tam bıraktığınız gibi, aynı arama, aynı filtre, aynı kaydırma konumuyla geri koyan bir geri düğmesi var. Eskiden bir aracı kapatmak sizi tarayıcıya bırakıyordu ve bir sonrakini bulmak baştan başlamak demekti.
- **Kullandığınız araçları yıldızlayın.** Her kartta bir yıldız ve Araç Kutusu'nu her açışınızda en üstte bir Favoriler bölümü.
- **Bir geliştirici kipi.** Ctrl+K'den açın ve Araç Kutusu düğmesinin yanında ve kenar çubuğunda bir pano belirir. Chromium'un neyi çalıştırdığını, kaç sekme ve webview'in canlı olduğunu, depolamada ne olduğunu ve hangi değerlerin en büyük olduğunu gösterir; ayrıca hızlı eylemler: arayüzü yeniden yükle, DevTools'u aç, bir hata raporu için tanılamaları kopyala, yapay zekâ konuşmalarını temizle, araç tercihlerini sıfırla, beş deneme sekmesi aç, kurulum sihirbazını yeniden oynat ve Vex'i sıfırla.
- Bir tema değil bir kip olduğundan her görünümde çalışır. Vex'i sıfırla önce sizden sözcüğü yazmanızı ister ve Vex'in kendi verisi olmayan hiçbir şeye dokunmaz.

## v7.25.5 (2026-09-13) — Her araç tezgâhta

_v2.31.65 olarak yayımlandı._

### Notlar
- **340 aracın hepsi artık aynı tezgâhta açılıyor.** Ayarlar sütunu, yazdıkça canlı sonuçlar, hatırlanan seçenekler, kopyala, değiş tokuş ve iki boyut — kompakt ya da yanında bir başvuru paneliyle tam ekran. Daha önce sekiz araçta bu vardı ve diğer üç yüzü etiketli kutulardan oluşan bir yığında açılıyordu.
- **Başvuru paneli her araç için, zaten bildiklerinden kuruluyor:** ne yaptığı, ailesi, diğer adları ve yüklemek için tıklayabileceğiniz çalışılmış örnekler.
- **El yapımı son yedi araç yeniden yapıldı.** Regex her eşleşmeyi konumuyla ve her yakalama grubunu adıyla ya da numarasıyla gösterir ve değiştirebilir ya da bölebilir. CSV düzgün ayrıştırılıyor — tırnaklı virgüller, çift tırnaklar ve hücre içindeki satır sonları hayatta kalıyor — ve bir tabloya, JSON'a, Markdown'a ya da temiz CSV'ye dönüştürülüyor. UUID v4'ü ve zamana göre sıralı v7'yi yapar ve birini ayırarak okur. Parola gerçek entropiyi ve kırma sürelerini bildirir. Renk, AA/AAA notlarıyla WCAG karşıtlığını ve eşleşen bir palet yapar. Cron her alanı açıklar ve sonraki gerçek tetiklenme zamanlarını listeler. Markdown işler, düz yazıya indirger ya da başlık taslağını gösterir.
- **22 yeni araç.** Bir alan adının, benzer görünen bir sahte gibi betikleri karıştırdığında uyarı veren Punycode/IDN; 0,1 + 0,2'nin neden 0,3 olmadığını gösteren bir kayan nokta denetçisi; bir alt ağ hesaplayıcısı; CRC-32; Shannon entropisi; XOR ve Vigenère; bir User-Agent okuyucusu; px/rem/em dönüştürme; bir cubic-bezier değerlendiricisi; katmanlı kutu gölgeleri; medya sorgusu aralıkları; umask; .gitignore başlangıçları; Open Graph etiketleri; JSON'dan YAML'a ya da TOML'a; HTTP durum kodları; satır tekilleştirme; slug'lar; yer tutucu metin; görünmez karakterleri adlandıran bir karakter denetçisi; ve bir sürüm aralığı açıklayıcısı.
- Hatalar yutulmak yerine gösteriliyor ve boş bir girdi artık sizi aracın kendi hata iletisiyle karşılamıyor.

## v7.20.2 (2026-09-13) — Açmaya değer araçlar

_v2.31.64 olarak yayımlandı._

### Notlar
- **Araçların artık iki boyutu var.** Varsayılan olarak gelen panel ve pencereyi dolduran tam ekran kipi; bu yalnızca daha büyük değil: yanında biçimleri, kuralları ve doğrudan girdi alanına tıklayarak açabileceğiniz çalışılmış örnekleri açıklayan bir başvuru sütunu belirir. Her araç hangi boyutu tercih ettiğinizi hatırlar.
- **Yeniden yapılan her araçta düzgün bir ayarlar sütunu.** Seçenekler, bir Çalıştır düğmesi, yazdıkça canlı güncelleme ve Girdiyi hatırla; böylece araç, tek bir kutu ve tahminden ibaret olmak yerine yapılandırabileceğiniz bir şey oluyor.
- **Base64 artık Base64'ten gerçekte beklenen işi yapıyor.** Önceden tam olarak tek bir durumu işliyordu: standart, dolgulu, UTF-8. Artık Base64URL'yi (`-` ve `_`), IMAP posta kutusu adlarını, seçtiğiniz özel bir alfabeyi ve dolgusuz girdiyi çözüyor; bir JWT'nin verdiği ve eskiden "Not valid Base64" olarak dönen şey tam olarak budur. Eksik dolguyu geri koyar, yapıştırmadan gelen tırnakları ve satır sonlarını tolere eder, metin, onaltılık ya da ham bayt okur veya yazar. Bir şeyi çözemediğinde, onu durduran karakterin adını söyler.
- **Aynı şekilde yeniden yapılan yedi araç daha:** Karma (SHA-1'den SHA-512'ye, HMAC, onaltılık/Base64/Base64URL), URL kodlama (bileşen ya da tüm URI, form tarzı boşluklar ve bir URL'yi parçalarına ayırma), JSON (biçimlendirme, küçültme, anahtarları sıralama ve sözdizimi hatasının satır ve sütunu), JWT (başlık, yük ve gerçek tarihler; imzayı doğrulamadığını açıkça söyler), Zaman damgası, Harf biçimini değiştirme (aynı anda 13 biçim) ve Sözcük sayısı.
- Hatalar gösterilir, asla yutulmaz: sessizce hiçbir şey üretmeyen bir araç, bozuk bir araçla aynı görünür.

## v7.16.4 (2026-09-13) — Vex yapay zekâsı düşündükçe yazıyor

_v2.31.63 olarak yayımlandı._

### Notlar
- **Yanıtlar yazıldıkça görünüyor.** Yerel bir model yavaştır ve Vex, yanıt bitene kadar tamamını geri tutardı; bu da bir yükleme göstergesine uzun uzun bakmak demekti. Metin artık üretildikçe geliyor ve önce akıl yürütme doluyor; böylece takıldığını merak etmek yerine çalıştığını görebiliyorsunuz.
- **Yapay zekânın andığı her şeyi açabilirsiniz.** Bir yanıt bir Vex özelliğinin adını andığında, altında onu açan bir düğme belirir. Az önce size söylenen şeyi aramak zorunda değilsiniz.
- **Sohbetleriniz artık sekmeyle birlikte kaybolmuyor.** Bir sekmeyi kapatmak, onun konuşmasını siliyordu; Son sohbetler, kendi sohbetinizin yeniden açılamadığını söylerdi. Sohbetler artık saklanıyor ve yerinde açılıyor; hangisine baktığınızı söyleyen bir not ve geri dönmenin bir yolu var. Gizli sekmelerdeki sohbetler yine hiçbir zaman diske yazılmaz.
- **Kişilikleri süzün.** 25 tane olunca liste bir kaydırmaydı; şimdi bir arama.
- **Uygulama değiştirmek artık paneli kapatmıyor.** Bir sayfanın içine tıklamak onu yine kapatır, bunun amacı bu; ama alt+sekme ile uzaklaşıp geri dönmek yerinizi kaybettiriyordu.
- **Yanıtlarda emoji yok.** Vex'in arayüzü baştan sona çizilmiş simgelerden oluşur; bir model bunu bilmez ve bir gülen yüzle başlar. Varsayılan olarak yanıtlardan ayıklanırlar. Yalnızca ayıklar, hiçbir şey yeniden ifade edilmez ve kopyalama size modelin söylediğinin tam olarak aynısını verir.

## v7.12.6 (2026-09-13) — Vex yapay zekâsı: düşünme ve Vex'in ne olduğunu bilen yanıtlar

_v2.31.62 olarak yayımlandı._

### Notlar
- **Modelin ne düşündüğünü görün.** Akıl yürütme modelleri (qwen3, deepseek-r1 ve benzerleri) yanıtlamadan önce bir sorunu adım adım çözer. Vex bunu atıyordu; daha da kötüsü, yanıt ayrıştırıcısını bozuyordu ve ayrıştırıcı da yanıtı ham metinden geri kazımak zorunda kalıyordu. Akıl yürütme artık her yanıtın üstünde "Thought for N words" açılır listesi olarak görünüyor, siz isteyene kadar kapalı duruyor ve konuşmayla birlikte kalıyor.
- **Düşünüyor çemberi yine dönüyor.** Yavaş değildi, donmuştu. Vex, Windows hareketi azaltacak şekilde ayarlıyken animasyonları kapatır; kayan ve dönen şeyler için mantıklı, ama bir şeyin olduğunu göstermek tek işi olan öğeyi de donduruyordu. Gösterge artık dönmek yerine nabız gibi atıyor: hâlâ belirgin, hâlâ hareket yok.
- **Vex'in neler yapabildiğini sorun ve gerçek bir yanıt alın.** Yapay zekâ yalnızca önündeki sayfadaki metne sahipti; bu yüzden yeni bir sekmede yeni sekmeyi okuyarak yanıtlıyor ve kısayol çubuğunu sanki tarayıcının kendisiymiş gibi anlatıyordu. Vex hakkındaki sorulara artık Vex'in kendi 137 özellik listesi eşlik ediyor ve modele tahmin yürütmek yerine emin olmadığını söylemesi söyleniyor.

## v7.11.1 (2026-09-12) — Vex yapay zekâsı, yeniden yapıldı

_v2.31.61 olarak yayımlandı._

### Notlar
- **İki kip.** Sağda bildiğiniz panel ve pencereyi alan, konuşmayı okunabilir bir sütunda ortalayan yeni bir tam ekran kipi. Düğme panel başlığında ya da Ctrl+Shift+F ile ve Vex hangisini tercih ettiğinizi hatırlar.
- **Başka yere tıklayınca kapanıyor.** Başka bir yere tıklamak, Escape'e basmak ya da sayfanın içine tıklamak artık onu kapatıyor. Bundan önce yalnızca kendi ✕ düğmesiyle kapanıyordu; siz dönüp kapatana kadar orada duruyordu.
- **Panel artık çoğunlukla konuşma.** Başlıkla ilk ileti arasında altı satır denetim duruyordu (kişilik, istemler, sekmeler, aracı kipi, hızlı eylemler) ve sohbete kalan yükseklik ne kaldıysa o oluyordu. Artık yazma alanında tek bir satırlar ve başlangıç önerileri yalnızca boş bir sohbette görünüyor.
- **Temanızla uyumlu.** Her renk Vex'in geri kalanıyla aynı tema belirteçlerinden geliyor; böylece kendi renklerini taşımak yerine hangi görünümü kullanıyorsanız onu izliyor.
- **5 yerine 25 kişilik.** Özetleyici, Şeytanın Avukatı, Alışveriş, Güvenlik, Öğretmen, Çevirmen, Veri, Beyin Fırtınası, Yanıt, Küçük Yazı, Hata Ayıklama, Sorgu, Mutfak, Haber Odası, Sade Dil, Rakamlar, Seyahat, Makale, Ürün ve Sekme Çobanı; her biri yalnızca etiketi değil, yanıtı değiştirecek şekilde yazıldı.
- **Çalışmak için daha fazlası:** yeni sohbet, son sohbetler, bir konuşmayı dosyaya aktarma, herhangi bir iletiyi kopyalama, bir yanıtı yeniden deneme ve bir soruyu düzenleyip yeniden sorma.

## v7.7.4 (2026-09-12) — İşinizin araçları geri geldi

_v2.31.60 olarak yayımlandı._

### Notlar
- **İşinizin önerdiği her araç yeniden kullanılabilir.** v2.31.58 bu listeleri yalnızca çizilmiş simgesi olan araçlara kısaltmıştı; bu da bazı işleri ağır biçimde kırpmıştı: Ön Uç Geliştirici 11 araçtan 1'e indi. Bu, yanlış yerde yanlış bir çözümdü: yersiz görünen araçlar üst çubuktaki başıboş düğmelerdi ve onlar önceki sürümle kalktı. Listeler geri yüklendi.
- **v2.31.58'deyseniz araçlarınız kendiliğinden geri gelir.** O sürümün kaldırdığı her şey Vex'in bir sonraki başlayışında, şu an sahip olduklarınızla birleştirilerek geri konur; böylece o zamandan beri eklediğiniz araç da korunur.

## v7.7.3 (2026-09-12) — Her şey Araç Kutusu'nda ve yanında Vex yapay zekâsı

_v2.31.59 olarak yayımlandı._

### Notlar
- **Üst çubuktaki başıboş araç düğmeleri kalktı.** Bir iş ayarlamak, Araç Kutusu simgesinin yanına üç adede kadar tekil araç düğmesi koyuyordu ve bunlar çizilmiş bir simge yerine tipografik bir işaret (".*", "{ }", "Aa") gösteriyordu; yanlarındaki düğmeye hiç benzemeden orada duruyorlardı. Artık her araç Araç Kutusu'nun içinde, aynı yerde bir tık uzaklıkta.
- **Araç Kutusu düğmesinin hemen yanında bir Vex yapay zekâsı düğmesi.** Yapay zekâ sohbetini açar. Panel açılamazsa hiçbir şey yapmamak yerine bunu söyler.

## v7.5.9 (2026-09-12) — İş araçları: yalnızca gerçek simgeli olanlar

_v2.31.58 olarak yayımlandı._

### Notlar
- **Düzgün simgesi olmayan araçlar işinizden çıktı.** 318 aracın 137'si çizilmiş bir simge yerine tipografik bir işaretle (".*", "{ }", "Aa") işaretli ve ikisini karıştırmak İş panelinin tutarsız görünmesine yol açıyordu. Bir iş artık yalnızca gerçek bir simge çizen araçları öneriyor ve bu değişiklikten önce kurulmuş bir profilden diğerleri bir kez, otomatik olarak çıkarılıyor. Hiçbir şey silinmiyor: 318'in hepsi hâlâ Araç Kutusu'nda ve seçicinin aramasından kendiniz eklediğiniz bir araç yerinde kalıyor.
- 420 iş profilinde bu, önerilen araç yuvalarının %28'ini kaldırıyor. Hiçbir iş boş kalmıyor, ama 33'ü yalnızca bir ya da iki araçla kalıyor; en çok teknik işler, çünkü geliştirici araçlarının ezici çoğunluğu tipografik işaretli olanlar. Ön Uç Geliştirici 11'den 1'e iniyor.

## v7.5.8 (2026-09-12) — İş araçları ve gün boyu büyüyen bir sızıntı

_v2.31.57 olarak yayımlandı._

### Notlar
- **İşinizin araçları artık hepsi aynı görünüyor.** 318 aracın 137'si çizilmiş bir simge yerine tipografik bir işaretle (".*", "{ }", "Aa") işaretliydi ve bunlar sayfaya düz metin olarak bırakılıyordu; bu yüzden İş panelinde diğerlerinden farklı boyutta ve hizada çıkıyorlardı. Her araç simgesi artık hangi türden olursa olsun aynı kutuda duruyor.
- **İş panelinden Vex yapay zekâsına sorun.** Araçlarınızın yanındaki yeni bir düğme, mesleğinizi bağlam olarak vererek yapay zekâ sohbetini açar; böylece ilk yanıt işiniz hakkında olur. Yapay zekânın gerçekte nerede çalışacağını söyler: bir tane çalışıyorsa yerel modelinizi adıyla, çalışmıyorsa bulutu; bunu öğrenirken tahmin yürütmek yerine "checking" der.
- **Bir sekmeyi kapatmak artık onu gerçekten serbest bırakıyor.** Her sekme, pencere açık kaldığı sürece sayfa öğesini ve yaklaşık 28 olay dinleyicisini geride bırakıyordu. 40 sekme açıp kapatmak, 38'ini hâlâ bellekte bırakıyordu; tarayıcı gün boyu ağırlaşıyor ve yalnızca yeniden başlatmak bunu temizliyordu. Bunun büyük kısmı artık sekme kapandığı anda serbest bırakılıyor.

Kalan büyümenin bir kısmı Vex'te değil, Electron'un kendi webview uygulamasının içinde; bu yüzden sorunu büyük ölçüde azaltıyor ama tamamen bitirmiyor.

## v7.3.3 (2026-09-12) — Çalışıyormuş gibi yapan düğmeler

_v2.31.56 olarak yayımlandı._

### Notlar
Arayüzdeki üç şey iyi görünüyordu ve tıklandığında hiçbir şey yapmıyordu. Hiçbiri hata bildirmedi, bu yüzden bu kadar uzun süre yaşadılar.

- **"All Sticky Notes" artık açılıyor.** Sayfalarda bıraktığınız tüm yapışkan notları göstermesi gereken düğme hiçbir şey yapmıyordu; geri döneceği yedek liste bile görünmüyordu, çünkü çağırdığı kod yanlışlıkla başarılı olduğunu sanıyordu.
- **"Manage personas" artık açılıyor.** Aynı neden, aynı sessizlik. Açılamazsa artık ölü bir düğme gibi görünmek yerine bunu söylüyor.
- **Keşfet; Discord'u, Netflix'i ve kimlik doğrulayıcıyı açabiliyor.** Üçü de Keşfet'te listelenir, ama komut ya da ayar değil yan panel oldukları için Aç düğmeleri yoktu.

Yeni bir test, ilk iki düğmenin ardındaki hatayı (bir modüle, o modül window üzerine hiç konmamışken `window` üzerinden uzanan kodu) tüm arayüzde tarıyor; böylece bir düğme artık bu yolla sessizce bozulamaz.

## v7.2.3 (2026-09-12) — Hiç denetlenmemiş kısımlar

_v2.31.55 olarak yayımlandı._

### Notlar
Vex'in davranışında hiçbir değişiklik yok. Bu sürüm, denetimdeki son boşlukları kapatıyor: daha önce bir oturum açma, bir arka uç ya da sansürlü bir ağ gerektirdiği için kapsam dışı bırakılan alanları.

- **Yapay zekâ özellikleri gerçek bir arka uca karşı çalıştırıldı.** Ollama'nın protokolünü konuşan bir sunucu ayağa kaldırıldı; böylece sohbet, özetleme, sekme gruplama, yapay zekâ belleği ve Yeniden Biçimlendir kendi gerçek yollarını çalıştırdı. İyi davranan bir yanıtı, yanlış biçimdeki bir yanıtı, yarıda kesilen bir yanıtı ve hata döndüren bir arka ucu işliyorlar; sonuncusu, boş bir balon yerine sorunu gösterir ve yeniden denemeyi önerir.
- **Yalnızca kaynak değil, kurulu uygulama denetlendi.** Kullanıcıların gerçekten indirdiği yapı derlendi ve çalıştırıldı: bu ay eklenen her özellik içinde var, Keşfet 137 özelliğin hepsini listeliyor, 318 aracın hepsi yükleniyor, korumalı video oynatma hazır, içinde hiçbir yerde emoji yok ve kötü niyetli bir sayfa başlığı hâlâ arayüze ulaşamıyor.
- **Roblox ve Discord atlatması artık testlere sahip**, onu bozan durum da dahil: Discord'un otomatik yapılandırmasının, Roblox kullanırken paylaşılan bağlantı yardımcısını yeniden başlatması. Canlı olarak da doğrulandı: başlıyor, bağlanıyor ve temiz biçimde kapanıyor.
- **Tek bir Vencord yapısını tutma**: "yapımı kurmak hiçbir şey yapmıyor" ifadesinin ardındaki kural, yani daha yeni tarihli devre dışı bir klasörün çalışan klasörü geçmesi, artık bunun da kapsamında.

## v7.1.4 (2026-09-12) — Denetlenmemiş hiçbir şey kalmadı

_v2.31.54 olarak yayımlandı._

### Notlar
Bu sürümde kullanıcının göreceği bir değişiklik yok: denetimlerin sonuncusu ve denetlediği her şeyin sağlam çıktığı.

- **Verileriniz gerçekten geri geliyor.** On tür kayıtlı öğe (yer imleri, sonra oku, notlar, beceriler, kendi araçlarınız, otomasyonlar, yapay zekâ belleği, başlangıç sayfası kısayolları, geçmiş ve izlenen sayfalar) çalışan bir tarayıcıda yazıldı, tarayıcı doğrudan öldürüldü ve her biri yeniden başlatmada hâlâ oradaydı. Birim testleri depolama katmanının yerine geçiyor, bu yüzden bunu yalnızca gerçek bir yeniden başlatma kanıtlar; birkaç sürüm önce geçmişin silindiğini yakalayan denetim budur.
- **Makine dairesinin kalan iki parçasının da artık testleri var.** Hangi pencerenin hangi sayfaya sahip olduğuna karar veren parça (her iç isteğin denetlendiği geçit) ve güncelleyiciyle konuşan parça. Bunlar birlikte, bir sayfaya olması gerekenden fazla ayrıcalık verilemeyeceğini, bir pencerenin başka bir pencerenin sekmeleri üzerinde işlem yapamayacağını, yalnızca Vex'in kendi arayüzünün arayüz sayıldığını ve güncelleme ilerlemesinin dürüstçe bildirildiğini sabitliyor.

## v7.1.3 (2026-09-12) — Bir şeyi silmek artık iki şeyi silmiyor

_v2.31.53 olarak yayımlandı._

### Düzeltildi
- **Bir yer imini silmek, yanında ikincisini de silebiliyordu.** Her kayıtlı liste (yer imleri, sonra oku, oturumlar, çalışma alanları, otomasyonlar, komut zincirleri, kendi araçlarınız, yapay zekâ belleği, izlenen sayfalar, beceriler, MCP sunucuları, sabitlenmiş siteler) her kayda yalnızca saatten oluşan bir kimlik veriyordu. Aynı milisaniyede kaydedilen iki şey aynı kimliği paylaşıyordu ve silme işlemi o kimliği eşleştirerek çalıştığından, birini kaldırmak ikisini de kaldırıyordu. Hiçbir şey sizi uyarmadı; ikinci öğe sadece yok oldu. On üçünün hepsi artık çakışamayan bir kimlik alıyor ve bir test, yeni bir listenin bunu eski yoldan yapmasına izin vermiyor.

### Notlar
- Hiç sürülmemiş altı panel (yer imleri, kitaplık, akışlar, vurgular, kimlik doğrulayıcı ve kuyruk) çalışan bir tarayıcıda gerçek verilerle denendi: hepsi çiziliyor, hepsi kapatılıp yeniden açılmaya dayanıyor ve hiçbiri düşmanca bir başlığı biçimlemeye çevirmiyor. Akış okuyucusu, kasıtlı olarak kötü niyetli bir RSS öğe başlığıyla denetlendi ve onu düz metin olarak gösterdi.

## v6.96.3 (2026-09-12) — Bir web sitesinin adı Vex'in içine uzanamaz

_v2.31.52 olarak yayımlandı._

### Düzeltildi
- **Bir web sitesi, yalnızca başlığını seçerek Vex'in penceresinin içine kendi biçimlemesini koyabiliyordu.** <kbd>Ctrl</kbd>+<kbd>K</kbd>'ye basıp geçmişinize bakın ya da açık sekmelerinizde arayın; her sayfanın başlığı Vex'in kendi arayüzüne metin olarak değil biçimleme olarak yerleştiriliyordu. `<img src=x onerror=…>` başlıklı bir site, tarayıcının kendi penceresinin içinde o öğenin oluşturulmasını sağlıyordu; bu da sekmelerinize, ayarlarınıza ve kayıtlı parolalarınıza ulaşabilen kısımdır. Vex'in içerik güvenliği kuralları betiğin kendisinin çalışmasını engelledi, yani bu en kötü durumdan bir katman uzaktaydı; ama enjeksiyon gerçekti: özenle hazırlanmış bir başlık, geçmişinizi açtığınız anda tarayıcının sitenin sunucusundan bir şey almasına yine de yol açabiliyordu. Başlıklar artık tek bir yerde metin olarak yerleştiriliyor; böylece hiçbir gelecek sonuç bunu yeniden ortaya çıkaramaz.
- **On altı emoji hâlâ kaynakta saklanıyordu**: sağ tık menüsünün tamamı ve GitHub paneli, karakter olarak değil kaçış kodları olarak yazılmıştı; önceki tarama bu yüzden yanlarından geçti. Buna karşı koruyan denetim artık onları da çözüyor. GitHub panelindeki yıldızlar ve çatallar, anlamlarını kaybetmek yerine çizilmiş simgeler olarak korundu.
- **Yapay zekâdan hâlâ her sekme grubu için bir emoji uydurması isteniyordu**, grupların bir tane göstermeyi bırakmasından aylar sonra. Üretiliyor, belirteç olarak ödeniyor ve atılıyordu.

### Notlar
- Parola kasasının artık kendi testleri var: hiç yoktu ve Vex'in sakladığı en hassas şey o. Önemli kısımları sabitliyorlar: parolalar üstveri için ayrılmış kanallardan asla geçmez, şifrelenemeyen bir kasa düz metne dönmek yerine kaydetmeyi reddeder, bozuk bir kasa boş görünmek yerine bunu söyler ve benzer görünen bir ana makine adı hiçbir şey almaz.
- Ayrıca denetlendi ve sağlam bulundu: her iç kanaldaki izin geçidi (bilinmeyen bir kanal tamamen reddedilir) ve Recall'ın arama parçacıkları, sayfa metnini doğru biçimde kaçırıyor.

## v6.88.8 (2026-09-12) — Web siteleri artık panonuzu okuyamıyor

_v2.31.51 olarak yayımlandı._

### Düzeltildi
- **Herhangi bir web sitesi en son kopyaladığınız şeyi sessizce okuyabiliyordu.** Vex, pano okuma iznini otomatik olarak veriyordu; bu yüzden bir sayfa, hiçbir istem, hiçbir düğmeye basma ve bir şeyin olduğuna dair hiçbir işaret olmadan `navigator.clipboard.readText()` çağırabiliyordu. Çalışan bir tarayıcıda gerçek bir sayfaya karşı kanıtlandı: panoyu kelimesi kelimesine geri okudu. Bu, Vex'te çoğu tarayıcıdan daha önemlidir, çünkü Vex'te Kopyala düğmeli bir parola kasası ve tek kullanımlık kodları kopyalayan bir kimlik doğrulayıcı var; yani "en son kopyaladığınız şey" düzenli olarak bir parola ya da oturum açma kodudur. Bir sayfa artık, Chrome'da olduğu gibi, istemek zorunda ve istek ne istediğini sade sözcüklerle söylüyor: *"wants to read what you last copied"*. Panoya yazma değişmedi; bu sıradan bir kopyala düğmesidir ve hiçbir şey ele vermez.

### Notlar
Bu sürümün arkasında üç tarama var. İkisi hiçbir şey bulmadı, bunu yüksek sesle söylemeye değer:

- **Araç Kutusu'ndaki 318 aracın tümü** çalışan bir tarayıcıda açıldı. Her biri çalışan bir ekran çizdi: çökme yok, çıktıda "NaN" ya da "undefined" yok, kutusundan taşan bir şey yok.
- **35 Ayarlar kategorisinin tümü**: her çip gerçek bir yere çıkıyor, her bölüm bir kategoriye ait ve 34 anahtar ve açılır listenin tümü, tek bir hata olmadan her değerden geçirilerek çevrildi.
- **Ana süreç** bir şey çıkaran oldu. `permissions.js`, `session-security.js`, `updates.js` ve `vault.js` dosyalarının hiç kendi testleri olmamıştı; izin ilkesinin artık bir testi var ve Vex'in sormadan neyi verdiğini sabitliyor.

## v6.81.3 (2026-09-12) — Web sitesini değil, videoyu yüzdürün

_v2.31.50 olarak yayımlandı._

### Eklendi
- **Pencere İçinde Pencere videonun kendisini yüzdürüyor.** Bir site yerel PiP'i reddettiğinde, Vex küçük pencerede *sitenin tamamını* yeniden yüklerdi: sayfanın ikinci bir kopyası, kendi oynatıcısı, kendi reklamları; sekme ise arkada oynamaya devam ederdi. Artık yalnızca videoyu tutan sade bir oynatıcıyı, tam bulunduğunuz anda açıyor. Parça parça yayın yapan siteler (YouTube, Netflix) bu şekilde yüzdürülemiyor; çünkü videoları yalnızca kendi sayfalarının içinde var. Bu yüzden onlar tüm sayfa yedeğini koruyor ve Vex artık sizi merak içinde bırakmak yerine olan şeyin bu olduğunu söylüyor.
- **Yüzen oynatıcıyı kapatın, sekme oynatıcının kaldığı yerden devam etsin.** Küçük pencerede beş dakika izleyin; sekme artık bıraktığınız yerde durmuyor.
- **Keşfet'te "Sizin için yeni".** Keşfet'in artık gösterdiği ilk şey, kullandığınıza dair hiçbir kaydınız olmayan her şeydir; sayılmış olarak ve bunları gezmek için "Bunları göster" ile. Vex son 60 komutunuzu hatırlar, bu yüzden bir şeye hiç dokunmadığınızı iddia etmek yerine bunu açıkça söyler.
- **Arayüz yalnızca kurulum sihirbazı değil, Türkçe de konuşuyor.** Türkçe seçmek eskiden sihirbazı ve başlangıç sayfasını çeviriyor, diğer her etiketi İngilizce bırakıyordu. Araç çubuğu, kenar çubuğu panelleri, yaygın düğmeler ve ana Ayarlar başlıkları artık takip ediyor; normal bir pencerede yaklaşık 90 etiket. İpuçları kısayollarını koruyor (*Geri (Alt+Left)*). Henüz arayüzün tamamı değil ve çevirisi olmayan her şey tahmin edilmek yerine İngilizce kalıyor.

### Notlar
- Çeviri, her öğenin etiketlenmesini gerektirmek yerine İngilizce metinle eşleşiyor; onlarca dosyaya yayılmış bir arayüzü kapsamanın tek yolu bu. Bu yüzden pencerenin yalnızca Vex'in kendi çizdiği kısımlarıyla sınırlı: asla sayfa içeriği, asla bir sekme başlığı, asla yazdığınız bir şey değil.
- Bu sürümde iki av boş döndü, bunu kaydetmeye değer: **~190 komut çubuğu girdisinin her biri** çalışan bir tarayıcıda çağrıldı ve hiçbiri başarısız olmadı; ve GitHub etkinlik parçacığını öldüren "iki kez bildirildi, sessizce ölür" hatasının taranması başka bir örnek bulmadı.

## v6.76.3 (2026-09-12) — Başlangıç sayfası denetlendi

_v2.31.49 olarak yayımlandı._

### Düzeltildi
- **Bir kısayol, başlangıç sayfanızda kod çalıştırabiliyordu.** Kısayol adları sayfaya metin olarak değil biçimleme olarak giriyordu; bu yüzden `<img src=x onerror=…>` adlı bir kısayol betiğini çalıştırıyordu. Bu önemli, çünkü kısayol adları yalnızca kendi yazdıklarınız değil: Vex'in başkalarına göndermenizi önerdiği **paylaşılan kurulum kodlarında** ve cihazlarınız arasındaki **Vex Eşitleme**'de dolaşırlar. Kendi "Araçlarım" girdilerinizde aynı açık vardı, **GitHub commit iletilerinde** de: bunlar doğrudan API'den gelir ve itme yaptığınız bir depoya commit gönderen herkes bir tane yazabilir. Hepsi artık kaçırılıyor ve yeni biri çıkarsa bir test derlemeyi başarısız kılıyor.
- **"Recent GitHub Activity" hiçbir sürümde, hiçbir zaman çalışmamıştı.** Bir değişken iki kez bildirilmişti, bu yüzden kod GitHub'a ulaşmadan hata veriyordu; hata, hiçbir şey söylememek üzere yazılmış bir `catch` içine düşüyordu. Panel, kullanıcı adı belirleyen herkes için boş kaldı. Artık çalışıyor ve yüklenemediğinde sessizce durmak yerine bunu söylüyor.
- **Hava durumu kartındaki "Konumu değiştir" düğmesi, kurulum sihirbazıyla tam olarak aynı hataya sahipti**: beş eşleşme, her zaman Türkçe. Manchester ve Springfield'ın her birinin yaklaşık yüz eşleşmesi var, bu yüzden istediğiniz çoğunlukla aralarında değildi. Artık aynı ülke → şehir/ilçe/posta kodu seçicisine sahip, her yeri tam olarak gösteriyor (*Manchester · England · United Kingdom*) ve bir yer var ama seçtiğiniz ülkede değilse gerçek bir ileti veriyor.

### Notlar
- İki konum seçicisi, aynı hataları taşıyan aynı kodun ayrı kopyalarıydı. Artık tek bir modül; bu yüzden bir daha birbirinden ayrışamazlar.
- Vex'in her komut çubuğu girdisi (yaklaşık 190 tane, hemen her özelliğe giden yol) bu tarama kapsamında çalışan bir tarayıcıda çağrıldı. Hiçbiri başarısız olmadı.
- 35 yeni test, toplamda 2.764.

## v6.71.3 (2026-09-12) — Pencere İçinde Pencere denetlendi

_v2.31.48 olarak yayımlandı._

### Düzeltildi
- **Videoyu iki kez duyuyordunuz.** Bir sayfa yerel Pencere İçinde Pencere'yi reddettiğinde Vex bir açılır pencere yedeğine başvurur; bu da aynı sayfayı yeniden yükler, yani iki oynatıcı yan yana çalışıyor ve senkronundan kayıyordu. Videonun geldiği sekme artık açılır pencere açıkken sessize alınıyor **ve duraklatılıyor**, açılır pencere kapandığında sesi geri veriliyor. Kendiniz sessize aldığınız bir sekme sessiz kalır.
- **"Sekmeye dön" sekmeye geri dönmüyordu.** Yalnızca Vex penceresini öne getiriyor, sizi o arada gezdiğiniz hangi sekmedeyseniz orada bırakıyordu. Artık videonun geldiği sekmeye geçiyor ve o sekmeyi bu arada kapattıysanız bunu söylüyor.
- **Videonun üzerindeki PiP düğmesi, Pencere İçinde Pencere'yi engelleyen sayfalarda hiçbir şey yapmıyordu.** Konsola yazıp vazgeçiyordu; araç çubuğu düğmesi ve `Ctrl+Shift+P` ise açılır pencereyi açıyordu. Aynı özellik, iki giriş noktası, biri sessizce ölü; artık aynı şekilde yedeğe düşüyor.
- **O düğme bazı sayfalarda hiç görünmüyordu.** Videonun bağlanacağı bir öğe yoksa düğme oluşturulup sonra yere düşürülüyordu. Ayrıca birden fazla video tutan bir kapsayıcıda yinelenen üzerine gelme işleyicilerinin üst üste binmesi artık mümkün değil.
- **Uyuyan ya da atılmış bir sekmede "Sekmeye dön"**, dönülecek bir şey bulamıyordu; çünkü sekme yalnızca sayfası canlıyken hatırlanıyordu.

### Notlar
- Pencere İçinde Pencere, test edilebilsin diye `app.js` içinden kendi modülüne taşındı: açılır pencerenin denetim çubuğu kapalı bir gölge kökte duruyor, bu yüzden o pencerenin dışından hiçbir şey ona tıklayamaz ve düğmelerinin ne yaptığını denetlemenin tek yolu kodu doğrudan çalıştırmak. 13 yeni test.
- Denetim, zaten çalışan şeyleri de doğruladı: video algılama ve araç çubuğu düğmesi, DOM'u yeniden yazan bir sayfaya dayanan açılır pencerenin denetim çubuğu, onu kapatan Escape ve Ctrl+W, çökme ve yanıt vermeme korumaları, hatırlanan boyut ve konum, sabitleme anahtarı, `file:`/`javascript:` URL'lerinin reddi ve Vex kapanırken pencerenin hiçbir zaman arkada bırakılmaması.

## v6.68.8 (2026-09-12) — Keşfet: her özellik, tanıtıldı

_v2.31.47 olarak yayımlandı._

### Eklendi
- **Keşfet: Vex'in yapabildiği her şey** (`Ctrl+K` → "Keşfet"). Şimdiye kadar bu tarayıcının yaptığı her şeyin tek eksiksiz listesi GitHub'daki README'de duruyordu; bu, tarayıcıyı gerçekten kullanan hiç kimse için işe yaramaz. Keşfet o listenin uygulamanın içindeki hâli: **12 kategoride 137 özellik**, aranabilir. Her biri ne *için* olduğunu bir cümleyle söyler ve iki düğmesi vardır: ekranınızdaki gerçek denetimi vurgulayan **Bana göster** ve onu doğrudan çalıştıran **Aç**. Bir kategori seçin; "Bu kategoriyi gez" özelliklerini sırayla dolaştırır.
- **Kapattığınız bir özellik yine listelenir**, kapalı olarak işaretlenmiş ve **Aç ve bana göster** ile: göremediğiniz bir özellik keşfedemeyeceğiniz bir özelliktir; tüm sorun buydu.
- **Kurulum sihirbazı her görünümü sunuyor**, yalnızca Glass ve Classic'i değil: Chrome, Chrome koyu, Firefox, Firefox koyu, Safari, XP'de Internet Explorer ve 98'de Netscape; her biri anında uygulanır, böylece sihirbazın arkasındaki pencere önizleme olur. Classic'i seçmek ayrıca sekmelerinizi nerede istediğinizi de sorar.
- Sihirbazda **"Hız, bellek ve gizlilik" adımı**. Bu ayarlar tarayıcının gerçekte nasıl davranacağına karar verir (sekmelerin uyuyup uyumaması 800 MB ile 4 GB arasındaki farktır) ve bunların her biri eskiden sessiz bir varsayılandı. **Dengeli**, **Bellek tasarrufu**, **En yüksek gizlilik** ya da **Hepsini kapalı bırak** seçeneklerinden birini seçin, her biri ne yaptığını açıkça söyler; ya da listeyi açıp yedisini de kendiniz ayarlayın. Her şey Ayarlar'ın kullandığı aynı denetimler aracılığıyla yazılır, böylece ikisi asla çelişemez.

### Düzeltildi
- **Hava durumu adımı şehrinizi bulamıyordu.** Hangi dili seçmiş olursanız olun, **Türkçe** olarak en iyi **beş** eşleşmeyi istiyordu. Manchester'ın yaklaşık yüz eşleşmesi var, Springfield'ın da aynı; bu yüzden doğru olan çoğunlukla beşin arasında değildi ve İngilizce bir adı Türkçe sonuçlara karşı aramak çoğu zaman hiçbir şeyle eşleşmiyordu. Artık önce **ülkenizi** seçiyorsunuz, sonra bir **şehir, ilçe veya posta kodu** arıyorsunuz ve tam hiyerarşisini gösteren bir listeden kesin yeri seçiyorsunuz (*Ataşehir · İstanbul · Türkiye*), yerin posta kodları varsa onlarla birlikte.
- **Hava durumu adımı tahmin yürütüyordu.** Bir şey yazıp hiçbir eşleşme seçmediyseniz, coğrafi kodlayıcının ilk sıraladığı yeri sessizce kaydediyordu; hiç gitmediğiniz bir kasabanın hava durumuna böyle sahip oluyordunuz. Artık tahmin yürütmüyor.
- **Kurulum sihirbazı boş ve geçersiz yanıtları sessizce kabul ediyordu.** Adınız, GitHub kullanıcı adınız, yapay zekâ işçi URL'si, eşitleme işçi URL'si ve hava durumu boş ya da anlamsız bir şeyi kabul edip, ayarlamışsınız gibi devam ediyordu; böylece insanlar ayarlamadıkları şeyleri yapılandırdıklarına inanarak kurulumu bitiriyordu. Her alan artık denetleniyor: neyin yanlış olduğunu söylüyor (*"this is empty"*, *"that is not a GitHub username"*, *“use https://”*) ve ya düzeltirsiniz ya da bilerek **Atla**'ya basarsınız. Atla her zaman orada ve her zaman çalışır.
- **Keşfet'in kataloğu sapmıyor.** Bir özelliğin zaten bir Ctrl+K komutu olduğunda, katalog etiketini kopyalamak yerine komutun adını veriyor ve komut artık yoksa testler başarısız oluyor; uygulamada olmayan bir düğmeye, panele ya da ayara işaret eden her girdi için de öyle.

### Notlar
- Kılavuz düğmesi artık Keşfet'i açıyor; özgün doğrusal tur hâlâ "Kılavuz / Tur" olarak orada ve Keşfet'ten tek bir düğmeyi vurgulamak artık turun tamamını görülmüş olarak işaretlemiyor.
- 55 yeni test (toplam 2.716).

## v6.65.8 (2026-09-12) — Gerçek simgeler ve çok uzun bir hata avı

_v2.31.46 olarak yayımlandı._

### Değişti
- **Vex'te artık hiçbir yerde emoji yok.** Arayüzdeki her emoji artık rengini kullandığınız temadan alan çizilmiş bir simge; böylece simgeler nihayet tarayıcı görünümlerini yok saymak yerine onlarla uyuşuyor. Bu Ctrl+K'yi, Ayarlar'ı, kenar çubuğunu, sekme rozetlerini, notları, geçmişi, eşitlemeyi, kişilikleri, becerileri, araç kutusunu, bildirimleri ve ilk çalıştırma ekranını kapsıyor. Geriye kalan tek emojiler tutulmasını istediklerinizdir: güncelleme kartındaki konfeti ve kendi araç çubuğu düğmelerinize yazdığınız her şey. Artık testlerle birlikte bir denetim çalışıyor, böylece geri sızamazlar.
- **Yapay Zekâ Becerileri gerçek bir simge seçiyor.** Beceri düzenleyicisindeki emoji kutusu artık küçük bir simge seçici. Önceden kaydettiğiniz beceriler çalışmaya devam ediyor; emojileri eşleşen simgeyle değiştiriliyor.
- **Bir sekme için seçilen kişilik o sekmede kalıyor.** Eskiden seçim yapmamış her sekme için de varsayılan oluyordu. Ayarlar'daki "Kullan" varsayılanı yine belirliyor.

### Eklendi
- **Eklentiler yöneticisinin içinde kurmaya değer eklentiler.** Beş öneri; her biri ne yaptığıyla, Vex altında gerçekte ne olduğuyla ve yayıncının kendi indirme sayfasına bir bağlantıyla birlikte. Vex'in yalnızca kısmen çalıştırabildiği ikisi işaretli. "Vex'in yapamadıkları" listesi aynı yerden üretiliyor, bu yüzden eskiyemez.
- **Yapışkan notlar artık Notlar panelinde yaşıyor.** Bir "Sayfa notları" bölümü, not bıraktığınız her sayfayı listeler: sayfayı açın, notu yerinde düzenleyin, kartı yeniden gösterin ya da yapışkanı geldiği yere bağlantısını koruyan gerçek bir nota çevirin. Panel başlığındaki yeni düğmeler menülerde dolanmadan bir yapışkan yapıyor, sayfayı kırpıyor ya da yeni bir not başlatıyor.
- **Notlar düzgün bir düzenleyici kazandı.** Bir biçimlendirme araç çubuğu (kalın, italik, başlık, liste, denetim listesi, kod, bağlantı; Ctrl+B/I/E ile), onay kutularını gerçekten işaretleyebildiğiniz canlı bir önizleme, süzgeçli etiketler, sabitleme, sıralama, başlık, gövde, etiketler ve kaynak boyunca arama, sözcük sayısı ve okuma süresi, Markdown olarak kopyalama, dışa aktarma ve çoğaltma.
- **Recall düzgün arıyor.** Köklendirmeyle tam sözcükler, böylece "throttled" "throttling"i buluyor; tırnak içinde ifadeler; hariç tutmak için "-word"; ve `site:`, `after:` ve `before:` süzgeçleri. Sonuçlar, eşleşen sözcükler vurgulanarak ilgililik ve yakınlığa göre sıralanıyor ve bir sonucu kopyalayabilir, bir sayfayı unutabilir ya da bir siteyi bir daha asla dizinlememeyi seçebilirsiniz. Bir istatistik satırı kaç sayfanın dizinlendiğini ve ne kadar yer kapladığını söylüyor. 3.000 sayfayı aramak yaklaşık iki milisaniye sürüyor.
- **Zamanlanmış görevler bir değil, yedi şey yapabiliyor.** Bir yapay zekâ görevi çalıştırma, bir sayfa kümesini açma, bir adresle eşleşen sekmeleri yeniden yükleme, arka plandaki sekmeleri uyutma, bir oturum anlık görüntüsü kaydetme, gezinme verilerini temizleme ya da yalnızca hatırlatma. Zamanlamalar her N dakikada ya da saatte, günlük, seçilen hafta günlerinde, aylık (ayın son günü dahil), bir tarih ve saatte bir kez ya da tam bir cron ifadesi olabilir; sonraki üç çalıştırmanın canlı önizlemesi, sade İngilizce açıklamalar ("Every weekday at 08:30 — next: Mon at 08:30"), süreleriyle görev başına çalıştırma geçmişi, şimdi çalıştır, duraklat, çoğalt ve Vex kapalıyken kaçan bir çalıştırmayı yakalama ya da atlama seçimiyle.
- **İndirmeler duraklatılabilir, sürdürülebilir, iptal edilebilir ve yeniden denenebilir**, sürerken panelden.
- **Yapay zekâ konuşmalarınız sekme başına saklanıyor** ve yeniden başlatmadan sonra duruyor. Eskiden yalnızca bellekte yaşıyorlardı.

### Düzeltildi

#### Notlar
- **Yazmakta olduğunuz notlar kaybolabiliyordu.** Kaydedilmemiş metin, notlar arasında geçtiğinizde, paneli kapattığınızda ya da çıktığınızda atılıyordu; bir saniyelik bir gecikme vardı ve onu boşaltan hiçbir şey yoktu.
- **Bir notun başlığına yazmak aramanızı siliyordu.** Arama kutusu yazdığınızı hâlâ gösterirken liste her şeye sıfırlanıyordu.
- **Bir not açıkken bir sayfayı kırpmak, yazdıklarınızı artık var olmayan bir nota gönderiyordu.**
- Başlığı ya da gövdesi eksik bir not listeyi boş bırakıyordu. Önizleme ve Düzenle yer değiştirebiliyordu. Silmenin onayı yoktu. Tarihler "Invalid Date" yazabiliyordu. Bir notu dışa aktarmak kendi indirmesini iptal edebiliyordu.
- **Not listesi, yerleşik kenar çubuğunda kullanılamazdı**: sabit genişlikli bir liste düzenleyiciye yaklaşık 180 piksel bırakıyordu.
- **Yapışkan notlar: bir kartı yeniden açmak yazdıklarınızı atıyordu** ve "Aç", düz bir web sitesi dışındaki her şey için var olmayan bir adrese gidiyordu.

#### Recall
- **Kısa sayfalar hiç hatırlanmıyordu.** 200 karakterin altındaki her gövde metni atlanıyordu, bu yüzden `example.com` hiç bulunamıyordu.
- **Her sayfanın neredeyse üçte ikisi atılıyordu**: sayfa 16.000 karaktere kadar okunuyor, sonra 6.000 olarak saklanıyordu.
- **Arama sözcüklerin içinde eşleşiyordu**: "cat", "Concatenation" ve "Deep packet inspection"ı buluyordu. Ayrıca "throttled" aradığınızda "throttling"i bulamıyor, uzun sayfaları ilgili olanların üstüne sıralıyor, bir sayfanın ne kadar yeni olduğunu yok sayıyor ve aradığınızı içermeyen parçacıklar gösteriyordu.
- **Ziyaret ettiğiniz her sayfa tüm dizini diske iki kez yeniden yazıyordu** ve bu dizinle birlikte büyüyordu.

#### Zamanlanmış görevler
- **Her çalıştırma bir arka plan sekmesi sızdırıyordu** ve sızan sekmeler yeniden başlatmada geri geliyordu, bu yüzden sızıntı birikiyordu.
- **Aynı dakikaya düşen görevler atılıyordu.** Aynı saatte üç günlük görev, birinin çalışması demekti.
- **Zamanı çoktan geçmiş tek seferlik bir görev sorunsuz kaydediliyor ve hiç çalışmıyordu**: hiç tarih alanı yoktu.
- **Ayın 31'indeki aylık görevler** her şubatta bir ay geriye düşüyordu. Yepyeni bir günlük görev hemen çalışıyordu.
- **Cron hiçbir zaman gerçekten çalışmadı**: aralık yok, ad yok ve yıllık bir ifade hiçbir şey döndürmüyordu.

#### Sekmeler, çalışma alanları ve bölünmüş ekran
- **Sağ tık menüsündeki "Sekmeyi sabitle" görebileceğiniz hiçbir şey yapmıyordu.**
- **Çalışma alanları arasında geçmek her yığını kaybettiriyordu**, önceki çalışma alanının sabitlenmiş sekmelerini ekranda ölü düğmeler olarak bırakıyor ve geri yüklenen grupları boş çiziyordu.
- **Bölünmüş ekran açıkken çalışma alanları arasında geçmek tamamen boş bir pencere veriyordu** ve bir sekmeye tıklamak hiçbir şeyi değiştirmiyordu.
- **Bölünmüş bir bölmedeki sekmeyi kapatmak, hiçbir şeyin onaramayacağı ölü bir yarım ekran bırakıyordu.**
- **Tek bir bozuk favicon, Vex'in sekmelerinizi hiç kaydetmesini sessizce durduruyordu**: ulaşılamayan bir siteyi ziyaret etmek yeterliydi.
- **Hoparlör ve uyku rozetleri dikey kenar çubuğunda**, başka bir şey yeniden çizime zorlayana kadar hiç güncellenmiyordu. Yüklenemeyen bir sayfa sonsuza dek "Loading…" başlıklı kalıyordu. Bir sekme önizlemesi ekranda kalıcı olarak takılabiliyordu. Başarısız bir Göz Atma boş beyaz bir çerçeve gösteriyordu.

#### Yapay zekâ
- **"python'da bir listenin ortalamasını nasıl bulurum?" diye sormak bir geçmiş araması çalıştırıyordu** ve geçmiş girdilerinizden 200'e kadarını yapay zekâya gönderiyordu. "find", "remember" ya da "recall" içeren her ileti bunu yapıyordu.
- **Ollama çalışmıyorken Yerel Yapay Zekâ'yı seçmek "Cannot read properties of null" üretiyordu.**
- **Yapay Zekâ Yeniden Biçimlendir hiç çalışmıyordu**: yapay zekânın hiç döndürmediği bir alanı okuyordu.
- **Yeniden yaz/Düzelt/Kısalt, yerel arka uçta ham JSON'u sayfanıza yapıştırıyordu.**
- **Aracı, Durdur'a bastıktan sonra hâlâ eylem yapabiliyordu** ve "Show full plan, then execute" hiç plan göstermiyor ve her şeyi onaylıyordu.
- **Hatırlanan olgular, bir konuşma uzayınca sessizce uygulanmayı bırakıyordu** ve başarısız olan bir cihaz üzerindeki yanıt sessizce buluta yeniden gönderiliyordu.
- Konuşmalar artık yeniden başlatmalar boyunca sekme başına saklanıyor.

#### Ayarlar, indirmeler ve gizlilik
- **Biten bir indirme "0 B" diyebiliyordu.** Dosya boyutunu duyurmayan her sunucu, panelin o sıfırı gerçekten aldığı baytların üzerine kopyalamasına yol açıyordu.
- **İndirmelerde, aktarım sürerken duraklatma, sürdürme ya da iptal yoktu** ve duraklatılmış bir aktarım hâlâ indiriyormuş gibi görünüyordu. Başarısız ya da iptal edilmiş bir indirme artık yeniden denenebilir.
- **Aç ve Klasörde göster, dosyası olmayan indirmelerde görünüyordu** ve tıklandığında hiçbir şey yapmıyordu.
- **Dolu bir indirme listesi hâlâ süren aktarımları çıkarıyordu.**
- **Glass ya da bir tarayıcı görünümü altında dikey bir sekme düzeni seçmek, üst sekme şeridini ve dikey rayı aynı anda ekrana koyuyordu**: bu düzenler pencereyi kendileri düzenler ve artık seçiminizle savaşmak yerine bunu söylüyor.
- **"Kişiselleştirme"nin Ayarlar gezinmesinde çipi yoktu**: aramak sizi Kişiliklere götürüyordu, çünkü adı o sözcüğü içeriyor.
- **Gizlilik panosu, engelleme açık değilken bile açık olduğunu söylüyordu** ve siz kapattıktan sonra oturumun geri kalanında yoklamaya devam ediyordu.

#### Başka yerlerde
- **Okuma kipi bir sayfanın kendi `<title>` değerini biçimleme olarak çalıştırıyordu.** Başlığında `<script>` etiketi olan bir sayfa, okuma görünümüne canlı bir etiket koyuyordu. Arka plandaki bir sekmeden okuma kipinden çıkmak, aslında baktığınız sayfayı atıyordu.
- **Bir Güçlendirmeyi kapatmak onu hiçbir zaman zaten açık olan sayfalardan kaldırmıyordu** ve "bu siteyi sıfırla", bir sonraki düzenlemenizde az önce sildiğiniz güçlendirmeyi diriltiyordu.
- **Çerez bandı engellemeyi kapatmak kendi kendini geri alıyordu**: kurallarını temizlemek kendi izleyicisini uyandırıyor ve izleyici onları doğrudan geri boyuyordu.
- **Odak engelleme listesini boşaltmak engellemeyi sonsuza dek kapatıyordu**, odak kipi ise hâlâ engelleme sözü veriyordu. Artık bir Varsayılanları geri yükle düğmesi ve liste boş olduğunda bunu açıkça söyleyen bir satır var.
- **Parola sızıntısı uyarısı, uyardığı ilk adreste duruyordu**, sayfadaki diğer tüm sızıntıları gizliyordu ve kayıtlı bir girişin adresi yoksa *her* sitede uyarıyordu.
- **Siteye özel koyu kip hiç eşitlenmiyordu**: hâlâ çok önce emekli edilmiş bir ayar adı altında listeleniyordu.
- **Yenilikler ve ekran seçici, her açılışta bir klavye dinleyicisi sızdırıyordu.** Okuma cetveli de öyle.
- **Başarısız bir güncelleme indirmesi çubuğu hiçbir şey söylemeden %0'da takılı bırakıyordu**; dosyası olmayan bir sürüm, "downloading" iletisinin arkasında boş bir sekme açıyordu.
- **Bir klavye kısayolunu kaydetmek, paneli kapattıktan sonra da dinlemeye devam ediyordu**: bastığınız sonraki kısayol yutuluyor ve sessizce yeniden atanıyordu.
- **Eşitleme, sunucuya ulaşamadığında "cihaz yok" diyordu**, bu da hiç cihazınızın olmamasıyla aynı görünüyordu. Eşitleme verilerini silmek yerel kopyayı sonraki her eşitlemenin başarısız olduğu ve sizi sessizce oturumdan çıkardığı bir durumda bırakıyordu.
- **Konumu koordinatsız "manuel" olarak ayarlamak, konumunuzu IP'den üçüncü taraf bir hizmete sormaya sessizce geri düşüyordu**: kendi açıklaması hiçbir şeyin cihazınızdan çıkmadığını söyleyen bir kip altında. Artık isteği reddediyor ve nedenini söylüyor.
- **Kenar çubuğunu yeniden sıralamak, Ayarlar listesinin eski sırayı göstermesine yol açıyordu.**
- **Roblox ve Discord atlatmaları tek bir bağlantı yardımcısını paylaşıyor.** Roblox atlatması açıkken Discord'un otomatik yapılandırmasını çalıştırmak, Roblox'u artık var olmayan bir yardımcıya yöneltiyordu; bu yüzden Roblox hiçbir şey söylenmeden bağlanmayı bırakıyordu. Roblox artık paylaşılan yardımcıyı izliyor ve durursa bunu söylüyor.

### Notlar
- Bu sürüm, tüm tarayıcının yedi paralel denetiminin sonucudur: ayarlar, eklentiler, notlar, recall, zamanlanmış görevler, sekmeler ve çalışma alanları, yapay zekâ özellikleri, indirmeler, gizlilik, eşitleme ve çeşitli ufak şeyler. Listelenen her hata düzeltilmeden önce çalışan uygulamada yeniden üretildi.
- Test paketi 2.489 testten 2.661 teste çıktı.
- Bulunan ve bilerek dokunulmayan bir şey: sert bir çökmeden sonra (normal bir çıkıştan sonra değil), sekme listesi ve çalışma alanı listesi hangi çalışma alanının etkin olduğu konusunda çelişebilir, çünkü iki ayrı yerde kaydedilirler. Bunu düzgün düzeltmek ikisini birleştirmek demektir ve bu, bu sürümün taşıması gerekenden büyük bir değişikliktir.

## v6.58.3 (2026-09-12) — Geçmişinizi koruyan geçmiş

_v2.31.45 olarak yayımlandı._

### Düzeltildi
- **Gezinme geçmişiniz siliniyordu.** Geçmiş paneli kayıtlı geçmişinizi yalnızca paneli ilk açtığınızda yüklüyordu; bu yüzden bir oturumda ziyaret ettiğiniz ilk sayfa, ondan önceki her şeyin üzerine yazıyordu. Bunu kanıtladım: üç kayıtlı girdi, bir sayfa ziyaret edildi, bir girdi kaldı. Geçmişiniz artık hayatta kalıyor ve adres çubuğundaki, aynı listeyi okuyan geçmiş önerileri de öyle.
- **Geçmiş girdileri sayfanın adı yerine "Loading..." diyordu.** Bir ziyaret, sayfa yüklenmeye başladığı anda kaydedilir ve sayfa ne olduğunu söyledikten sonra başlık hiç düzeltilmiyordu.
- **Bir sayfaya geri dönmek artık aynı satırdan bir tane daha eklemiyor.** Chrome'un yaptığı gibi o sayfayı yeni bir zamanla en üste taşıyor.
- **Geçmiş paneli açıkken ve yeniden açtığınızda güncelleniyor.** Eskiden bir kez çiziliyor ve bir daha bakmıyordu; bu yüzden bu arada ziyaret edilen her şey yeniden başlatmaya kadar görünmez kalıyordu.
- **İki değil, tek geçmiş.** Ctrl+K hızlı görünümü, panelle çelişebilen ayrı, daha küçük bir kopyayı okuyordu.
- **Adres çubuğunun tamamı tıklanabilir.** Metin alanı 32 piksellik bir çubuğun içinde 13–15 piksel yüksekliğindeydi; bu yüzden metnin üstüne veya altına tıklamak hiçbir şey yapmıyordu.
- **Görülemeyen simgeler.** Kısayollar çubuğundaki "+" tarayıcı görünümlerinde beyaz üzerine neredeyse beyazdı; kısayol harf çipleri beyaz harfleri 2,8:1 kadar zayıf olabilen bir renk üzerine koyuyordu; seçili kenar çubuğu simgesi Glass ve ray görünümlerinde açık vurgularda kayboluyordu; ve Glass'ın "Vex" logotipi ile çalışma alanı düğmesi Oxford temasında 1,5:1'de duruyordu.
- **Chrome eklentileri: on bir hata.** Eklentiler 11 oturumun yalnızca 3'üne yükleniyordu; bu yüzden kenar çubuğu panellerinde ve kapsayıcı sekmelerinde hiç yoktu. Başarısız bir kurulum, her başlangıçta yeniden denenen ve kaldırılamayan bir klasör bırakıyordu. Yeniden kurmak yinelenen kopyalar yığıyordu. Yerelleştirilmiş eklentiler `__MSG_extName__` olarak listeleniyordu. Hatalar nedeni söylemek yerine "konsola bakın" diyordu. Bir eklentiyi devre dışı bırakmanın ve bir eklentinin açılır penceresini açmanın bir yolu yoktu.

### Eklendi
- **Her Araç Kutusu aracı Ctrl+K'de.** "bmi", "subnet" ya da "loan" yazın ve aracın kendisini açın.
- **Geçmişi siteye veya güne göre silin.** Bir satıra sağ tıklayıp "… sitesine yapılan her ziyareti sil"i seçin ya da bir tarih başlığındaki "Günü temizle"yi kullanın. Eskiden tek seçenek her şeyi temizlemekti.
- **Glass da yerleşik kenar çubuğunu alıyor**, sayfayı örtmek yerine yanında duran, rayını koruyan.
- **Yeni Sekme sayfası tarayıcı görünümünü giyiyor**, yalnızca renklerini değil: Chrome'un arama hapı ve kutucukları, Firefox'un kartları, Safari'nin yumuşak ızgarası, XP'nin Tahoma yazı tipi ve köşeli kenarları, 98'in kabartmalı eğimleri.
- **Bir eklentiyi etkinleştirin veya devre dışı bırakın** ve açılır penceresini araç çubuğundan veya yöneticiden açın. Yönetici artık simgeleri ve her eklentinin gerçekten yüklenip yüklenmediğini gösteriyor.
- **`npm run check:ui`**: gerçek uygulamayı süren ve her GUI stilini ve temasını çakışan denetimler, simgeleri örten rozetler, isabet ettirilemeyecek kadar küçük hedefler, adsız simge düğmeleri, kırpılma ve karşıtlık açısından ölçen bir kendi kendine denetim.
- **Uyuyan bir sekme "was 219 MB" rakamını yeniden başlatmalar boyunca koruyor.**

### Notlar
- Arayüz kendi kendine denetimi 156 bulgudan 48'e indi. Yedi tarayıcı görünümünün hepsi artık kendi renklerinde temiz. Geriye kalanların 32'si, paleti kasıtlı olarak düşük karşıtlıklı olan Solarized temasında; Classic de onda aynısını gösteriyor.
- Eklentilerin burada neler yapıp neler yapamayacağı, varsayılmak yerine ölçüldü: Electron, Vex'e istek engelleme vermiyor, bu yüzden uBlock Origin yüklenir ve çalışır ama **reklamları engelleyemez** (Vex'in yerleşik engelleyicisi hâlâ engelliyor). Bağlam menüleri, klavye kısayolları, rozetler, `storage.sync` ve `tabs.create` eksik ve eklentiler Özel ya da Tor sekmelerinde asla yüklenemiyor; yönetici artık sizi tahminde bırakmak yerine bunu söylüyor.

## v6.47.0 (2026-09-12) — 318 araç, 420 iş

_v2.31.44 olarak yayımlandı._

### Eklendi
- **Araç Kutusu'nda 15'ten 318 araca çıkan araç var.** Yeniler 79 birim çevirici, matematik ve bilim aracı, 68 metin, yazı ve üretici aracı, 86 para, iş, tarih ve sağlık aracı ve 70 geliştirici, veri, web, güvenlik ve tasarım aracıdır. Hepsi Vex'in içinde çalışır ve hiçbir yere hiçbir şey gönderilmez. Her birinin otomatik denetlenen çalışılmış örnekleri var; bu yüzden yanlış bir formül derlemeyi başarısız kılar.
- **Araç Kutusu'nda arama ve kategoriler.** Bir aracı bulmak için "loan", "bmi" ya da "json" yazın veya kategoriye göre süzün. İşinizin araçları önce gelir.
- **65'ten 420 iş**, 24 kategoride. Bunlara zanaatlar, ağırlama, ulaşım, perakende, emlak, kamu hizmeti, tarım, spor ve ebeveyn ya da emekli gibi kişisel olanlar dahil. Her iş, gerçekten kullandığı araçlarla gelir. Mevcut işler adlarını ve temalarını korur, ama onlardan on tanesi artık yeni kategoriler altında listeleniyor; yani Makine Mühendisi Mühendislik altında ve Muhasebeci Finans altında.

### Değişti
- **Kendi araçlarınız artık Araç Kutusu'nda yaşıyor.** Eklediğiniz bağlantılar eskiden kenar çubuğunda ayrı bir simge sırası olarak duruyordu. Artık Araç Kutusu'nda "Bağlantılarınız" altında görünüyorlar ve kenar çubuğunda tek bir Araç Kutusu düğmesi kalıyor. Onları kenar çubuğuna geri koymak için Araç Kutusu'nda "Bağlantılarımı burada değil kenar çubuğunda göster"i işaretleyin.
- **Bir iş için araç seçmek yüzlerce araçla çalışıyor.** İş kurulumu, her aracın uzun bir listesi yerine açtığınız araçları ve daha fazlasını eklemek için bir arama kutusunu gösteriyor.

### Düzeltildi
- **Bellek panelindeki uyku çalışıyor.** Satır, sekme gerçekten uykuya geçmeden yeniden çiziliyordu; bu yüzden hiçbir şey olmamış gibi görünüyordu ve uyanık kalacak şekilde ayarlanmış bir sekme düğmeyi yok sayıyordu. Uyku artık tıkladığınızda her zaman çalışıyor ve satır, sekme uyuduktan sonra güncelleniyor. "Etkin olmayan sekmeleri uyut" da güncellemeden önce aynı şekilde bekliyor.
- **Uyku ayı her temada görünüyor.** Yaklaşık %44 güçle çizilmiş ince bir çerçeveydi ve çoğu temada kayboluyordu. Artık temanın ana metin renginde tam güçte dolu bir ay; yalnızca sekmenin başlığı ve simgesi soluyor. Her GUI stili, renk kipi ve tema denetlendi, 560 birleşim ve her biri en az 3:1 karşıtlıkta. Dikey sekme listesi de artık ayı gösteriyor.
- **Adres çubuğu önerileri adres çubuğuyla hizalanıyor.** Tarayıcı görünümlerinde adres çubuğu tam genişlikte uzanıyordu, ama öneriler hâlâ 600 piksellik bir kutuda ortalanmıştı ve yazdığınız şeyin bir yanında kalıyordu. Artık çubukla uçtan uca eşleşiyorlar.

## v6.42.0 (2026-09-11) — Kenar çubuğu uygulamalarını büyütün, gerçek bellek rakamları

_v2.31.43 olarak yayımlandı._

### Eklendi
- **Bir kenar çubuğu uygulamasını büyütün.** Tarayıcı görünümlerinde kenar çubuğunun artık kapatmanın yanında bir büyütme düğmesi var. Discord, Roblox, Claude, Prime Video ve diğer her panel tüm sayfa alanını doldurabilir ve aynı düğme onları kenar çubuğuna geri koyar.
- **Bir görünümün özgün renklerini tema seçiciden geri alın.** Bir tarayıcı görünümü altında, tema seçicideki ilk kart artık o görünümün kendi paletinde gösterilen "<görünüm> — özgün renkler". Bir tema seçmek görünümü o temanın renklerine geçirir ve bu kart onu geri alır.

### Düzeltildi
- **Geri, ileri ve yeniden yükle artık bir sitenin kendi düğmelerini örtmüyor.** Web panellerinde bu üç düğme, sitelerin kendi denetimlerini tuttuğu sayfanın sol üst köşesinin üzerinde yüzüyordu. Claude'un kenar çubuğu anahtarının üstüne oturuyor ve Roblox'un menüsünü örtüyorlardı. Tarayıcı görünümlerinde artık kenar çubuğunun başlığında duruyorlar; Classic'te sayfanın üstünde kendilerine ait bir şerit alıyorlar.
- **Bellek paneli yalnızca gerçek rakamları gösteriyor.** Bir sekmenin belleğini okuyamadığında, bazen tahmin olduğunu işaretlemeden uydurma bir 80 ya da 150 MB gösteriyordu. Her rakam artık gerçek bir ölçüm ya da satır sekmenin hâlâ başladığını söylüyor.
- **Uyuyan sekmeler de rakam gösteriyor.** Uyuyan bir sekme artık "0 MB · asleep (was 219 MB)" yazıyor: uyuyan bir sekme gerçekten hiçbir şey kullanmaz ve Vex, uykuya geçmeden hemen önce ne kullandığını not eder. Geri yüklenip hiç açılmayan sekmeler "0 MB · not loaded yet" yazıyor.
- **Sekme Sağlığı'nın toplamı artık belleği iki kez saymıyor.** Her sekmeyi ayrı ayrı topluyordu; bu yüzden aynı sitenin birkaç sekmesinin paylaştığı bir süreç sekme başına bir kez sayılıyordu. Artık Vex'in gerçek toplamını, Bellek paneliyle aynı rakamı gösteriyor.
- **Okunmamış rozetler artık simgelerini gizlemiyor.** Firefox, Netscape ve Glass kenar çubuklarında bir "99+" rozeti simgenin çoğunu örtüyordu. Artık düğmenin köşesinde duruyor.
- **Gizlilik panelini açmak artık tarayıcı görünümlerinde araç çubuğunu sıkıştırmıyor**; orada düğmeleri yer imleri çubuğuyla çakışıyordu.
- **Tarayıcı görünümlerindeki web panelleri artık boş çıkmıyor.** Düğmeleri başlığa taşındıktan sonra bir web panelinin sayfası sıfır piksel yüksekliğe düşebiliyordu.
- **Netscape'in küçük kenar çubuğu kapatma ve büyütme kutularına isabet ettirmek daha kolay.**

### Notlar
- Dokuz GUI stilinin hepsindeki her düğme, çakışmalar, simgeleri örten rozetler, küçük hedefler, adsız simgeler ve kırpılma açısından otomatik olarak denetlendi; bunun içinde görünümlerin altısındaki her panelin içi de var. Bu düzeltmelerden sonra hiçbir şey kalmadı.
- "was" rakamı yeniden başlatmadan sonra saklanmıyor. Bu güncellemeden ya da son yeniden başlatmadan önce uyuyan bir sekme, onsuz "0 MB · asleep" gösterir.

## v6.40.5 (2026-09-11) — Her tarayıcı görünümünün kendi kenar çubuğu var

_v2.31.42 olarak yayımlandı._

### Eklendi
- **Kenar çubuğu tarayıcı görünümlerine geri döndü, o tarayıcının kendi biçiminde.** Panelleriniz (Discord, Spotify, WhatsApp, Notlar ve diğerleri) artık gerçek bir tarayıcının kenar çubuğu gibi sayfanın üstünü örtmek yerine yanında açılıyor:
  - **Chrome:** araç çubuğundaki bir yan panel düğmesi paneli sağda açar; en üstteki bir açılır liste paneller arasında geçiş yapar.
  - **Firefox:** ince simge şeridi solda durur, panel de onun yanında açılır.
  - **Safari:** araç çubuğunun en solundaki bir kenar çubuğu düğmesi paneli solda açar.
  - **XP'deki Internet Explorer:** solda Explorer çubuğu, araç çubuğundan açılır.
  - **98'deki Netscape:** seçildiğinde içeri basılan gri düğmelerden oluşan bir şerit ve kendi küçük başlık çubuğu ile kapatma kutusu olan bir kenar çubuğu.
- **Kenar çubuğunun iç kenarını sürükleyerek genişletin ya da daraltın.** Vex genişliği hatırlar. Ayarlar bir kenar çubuğuna sığmadığı için hâlâ sayfanın tamamının üstünde açılır.

### Düzeltildi
- **Paneller artık XP ve 98'de yanlış renkleri almıyor.** Notlar listesi gibi panel parçaları XP ya da 98 başlık çubuğunun mavisini alıyordu ve birkaç yüzey hâlâ renk temanızın renklerini alıyordu. Artık görünümle uyumlular.
- **Yeni sekme artık önce renk temanızı göstermiyor.** Yeni Sekme sayfası, herhangi bir şey çizmeden önce görünümün renklerini uyguluyor.

## v6.36.7 (2026-09-11) — Yeni Sekme sayfası tarayıcı görünümüyle uyuşuyor

_v2.31.41 olarak yayımlandı._

### Düzeltildi
- **Yeni Sekme sayfası artık tarayıcı görünümüyle uyuşuyor.** Görünüm kendi renklerindeyken Yeni Sekme sayfası renk temanızı koruyordu; bu yüzden Chrome'un açık renkli çerçevesi koyu yeşil bir Matrix sayfasının üstünde duruyordu. Sayfa ayrı bir belgedir ve görünümden hiç haberdar edilmemişti. Artık görünümün renklerini alıyor: Chrome'da beyaz, Chrome koyu'da koyu gri ve yedisinin hepsinde böyle. "Renk temamla eşleştir" seçiliyken eskisi gibi temayı izler.
- **Görünümler kendi yazı tiplerini koruyor.** Renk temaları yazı tiplerini her düğmeye ve alana zorluyordu; bu yüzden XP'nin adres çubuğunda Tahoma yerine Oxford'un serif yazı tipi görünüyordu. Her görünüm artık temadan bağımsız olarak kendi yazı tipini kullanıyor.

### Notlar
- Görünüm kendi renklerindeyken Özel Görsel temasının fotoğrafı Yeni Sekme sayfasında gösterilmez, çünkü görünümün koyu metni kararmış fotoğrafın üstünde kalırdı. "Renk temamla eşleştir" ile geri gelir.

## v6.35.2 (2026-09-11) — Yedi tarayıcı görünümü, her renk temasında

_v2.31.40 olarak yayımlandı._

### Eklendi
- **Ayarlar › GUI Stili içinde yedi yeni görünüm.** Vex artık tamamen başka bir tarayıcı gibi görünebilir: Chrome, Chrome koyu, Firefox, Firefox koyu, Safari, Windows XP'deki Internet Explorer ve Windows 98'deki Netscape. Her biri sekmeleri, adres çubuğunu ve düğmeleri o tarayıcıdaki yerlerine taşır ve XP'nin mavi başlık düğmelerinden 98'in kabartmalı gri kenarlarına kadar şekillerini ve yazı tiplerini kullanır. Sekmeleriniz, yer imleriniz ve geri kalan her şey olduğu gibi kalır.
- **Her renk teması her görünümle çalışır.** Bir görünüm kendi renklerini koruyabilir ya da renklerini renk temanızdan alabilir; böylece 35 temanın hepsi yedi görünümün hepsini yeniden renklendirir. Bir görünüm açıkken tema seçmek onu temaya uyacak şekilde değiştirir ve GUI Stili altındaki yeni bir "Tarayıcı görünümü renkleri" ayarı onu geri çevirir. XP ve 98'de başlık çubuğu temanızın vurgu rengini alır; beyaz yazısının okunabilmesi için yeterince koyu tutulur.

### Notlar
- Gerçek tarayıcılara benzemeleri için görünümler Vex'in yan rayını ve birkaç araç çubuğu düğmesini (çalışma alanları, yapay zekâ, notlar, bölünmüş görünüm, Tor) gizler. Hepsi hâlâ araç çubuğunun sağındaki menü düğmesinde ya da Ctrl+K ile bulunur. Oradaki "Çalışma Alanını Değiştir" çalışma alanı listesini araç çubuğunun altında açar.
- Her görünüm, çalışan uygulamada metin, simge ve adres çubuğu karşıtlığı için her temayla (245 çift) denetlendi ve birbirinden çok farklı altı temayla ekran görüntüsü alındı. Tek zayıf nokta Solarized üzerindeki Windows 98'dir; tasarımı gereği düşük karşıtlıklıdır ve Vex'in normal görünümünde de aynı derecede soluktur.

## v6.27.7 (2026-09-11) — F12 görebileceğiniz DevTools açıyor ve Sheets bağlantıları kopyalanıyor

_v2.31.39 olarak yayımlandı._

### Düzeltildi
- **F12 ve Ctrl+Shift+I yine DevTools açıyor.** Açıyorlardı, ama görünmez biçimde. DevTools'u sayfanın altına yerleşik olarak istiyorlardı; Vex içindeki bir sayfanın yerleşecek kendi penceresi olmadığı için DevTools görünebileceği bir yer olmadan açılıyordu. Tuşa yeniden basmak da o görünmez kopyayı kapatıyordu; bu yüzden tuş hiçbir şey yapmıyormuş gibi görünüyordu. DevTools artık sağ tıkla DevTools'u Aç'ın zaten yaptığı gibi kendi penceresinde açılıyor.
- **Google E-Tablolar'dan metin kopyalamak bağlantıları koruyor.** Bir yere bağlanan hücre artık "metin (bağlantı)" olarak kopyalanıyor. Önceden yalnızca sözcükler korunuyordu; bu yüzden diğer tablolara giden bağlantıların listesi artık açamayacağınız başlıklar olarak çıkıyordu. Google'ın izleme yönlendirmesi kaldırılıyor ve gerçek adresi alıyorsunuz; aynı dosyadaki başka bir sekmeye giden bağlantı da kendi başına açabileceğiniz bir bağlantıya dönüşüyor.
- **Çalışma alanı renkleri artık temanızla çekişmiyor.** Bir çalışma alanı eskiden Vex'teki her vurguyu (düğmeleri, ilerleme çubuklarını ve adres çubuğunu çevreleyen çerçeveyi) kendi renginde yeniden boyuyordu; yeşil bir temadaki kırmızı çalışma alanı yeşil bir adres çubuğunun içine kırmızı bir kutu çiziyordu. Artık renkleri her yerde temanız belirliyor ve çalışma alanı rengi onun yerine çalışma alanı değiştiriciyi işaretliyor; böylece hangi çalışma alanında olduğunuzu yine bir bakışta anlayabiliyorsunuz.
- **Yeniden Başlat düğmesinin kendi simgesi var.** Birkaç düğme ötedeki Yenile ile karıştırılması kolay olan dairesel bir oktu. Artık bir güç simgesi.

### Notlar
- DevTools hatası ekrandaki gerçek pencereler listelenerek doğrulandı: önceden F12'ye basmak yalnızca Vex penceresini bırakıyordu; şimdi bir DevTools penceresi beliriyor ve yeniden basmak onu kapatıyor.

## v6.26.7 (2026-09-11) — Google E-Tablolar: metin kopyalama ve Ctrl+F

_v2.31.38 olarak yayımlandı._

### Düzeltildi
- **Google E-Tablolar'dan metin kopyalamak gerçek hücreleri alıyor.** Eskiden yalnızca tablonun başlığını, sekme adını ve iki kaydırma okunu döndürüyordu, başka hiçbir şey yoktu; çünkü okuduğu sayfa yalnızca bir çerçeveydi ve ızgara ayrıca getiriliyordu. Artık dosyadaki her sayfayı okuyor, her satır bir satıra ve hücreler sekmelerle ayrılacak şekilde; böylece başka bir e-tabloya temiz biçimde yapışıyor. Bağlantılı hücrelerin metni de dahil.
- **Bir Google E-Tablolar ya da Docs belgesinde Ctrl+F, Google'ın kendi aramasını açıyor.** Sekme değiştirdikten hemen sonra basmak Vex'in bulma çubuğunu açıyordu ve bu çubuk E-Tablolar ya da Docs'ta hiçbir şey bulamaz, çünkü onlar metinlerini sayfadaki metin olarak değil resim olarak çizer; bu yüzden 15. satırda açıkça görünen bir ad 0 / 0 olarak dönüyordu. Tuş artık her zaman belgeye gidiyor.

### Notlar
- İkisi de gerçek bir Google E-Tablosu üzerinde çalışan uygulamada doğrulandı: kopyalama 31 satırın hepsini döndürdü ve Ctrl+F tablonun kendi bulma kutusunu açtı.

## v6.25.7 (2026-09-10) — Ayrı pencereye alınmış aramadan Ekranınızı Paylaşın

_v2.31.37 olarak yayımlandı._

### Düzeltildi
- **"Ekranınızı Paylaşın", ayrı pencereye alınmış bir Discord aramasında çalışıyor.** Ayrı penceredeki diğer tüm düğmeler çalışıyordu, ama bu hiçbir şey yapmıyor gibi görünüyordu. Bir şey yapıyordu: ekran ya da pencere seçmeye yarayan seçici ana Vex penceresinde açılıyor ve ayrı pencereye alınmış arama varsayılan olarak her şeyin üstünde yüzüyor; bu yüzden seçici, hiçbir zaman göremeyeceğiniz biçimde onun arkasında açılıyordu. Seçici artık öne geliyor ve ayrı pencere, siz seçim yaparken yüzmeyi bırakıyor.

### Notlar
- Çalışan uygulamada yeniden üretildi: seçici açılıyordu, her ekranı ve pencereyi listeliyordu ve onu tutan pencere aramanın arkasında kalıyordu.

## v6.24.7 (2026-09-09) — F12 baktığınız panelin peşinden gidiyor

_v2.31.36 olarak yayımlandı._

### Düzeltildi
- **F12 ve Ctrl+Shift+I artık açık bir kenar çubuğu paneli için DevTools açıyor.** Bir panel içerik alanını örter, yani baktığınız şey odur; ama kısayol yalnızca etkin sekmeyi arıyordu ve bir panel sekme değildir. Discord, Spotify ya da WhatsApp üzerindeyken, o sırada etkin olan gizli sekme için DevTools açıyordu ya da hiçbir şey bulamayıp sessiz kalıyordu. Artık bir panel açıkken paneli inceliyor, aksi hâlde sekmeye dönüyor.

### Notlar
- Sekmeden önce panelin seçilmesi testlerle kapsanıyor. Tuşun kendisi otomatik olarak denenemedi; ne enjekte edilen tuşlar ne de yapay işletim sistemi tuşları kısayol işleyicisine ulaşıyor. Bu yüzden F12 hâlâ hiçbir şey yapmıyorsa tuş Vex'e hiç ulaşmıyordur ve neden başka bir yerdedir.

## v6.24.2 (2026-09-09) — Yerinde kalan sağ tık menüleri

_v2.31.35 olarak yayımlandı._

### Düzeltildi
- **Sağ tık menüsü öğeleri Discord, Netflix ve diğer panellerin üzerinde yine çalışıyor.** Bir panel açmak, içindeki sayfanın canı istediğinde klavye odağını geri almasına yol açıyordu ve Vex bunu başka bir uygulamaya geçtiğiniz şeklinde okuyup hâlâ okuduğunuz menüyü sessizce kapatıyordu. Tıklama da boş bir yere düşüyor ve hiçbir şey olmuyordu. Yenile, "... uygulamasına geç" ve "Vencord sürümümü kur" öğelerinin hiçbir şey yapmıyormuş gibi görünmesinin arkasındaki buydu. Menü artık siz bir şey seçene, başka yere tıklayana ya da Escape'e basana kadar kalıyor; gerçekten farklı bir uygulamaya geçmek yine de onu kapatıyor.

- **Kurulum sihirbazının yanında bir Yeniden Başlat düğmesi var.** Yeniden başlatmak, birkaç düzeltmenin sizden istediği gibi Vex'i elle kapatıp yeniden açmak anlamına geliyordu. Yeniden başlatma her sekmeyi kapattığı için önce soruyor.

### Notlar
- Menü hatası çalışan uygulamada yeniden üretildi, sonra uçtan uca doğrulandı: panel sayfası odağı tutarken menüden "Vencord sürümümü kur"u seçmek artık gerçekten kuruyor; önceden kurmuyordu.

## v6.23.2 (2026-09-08) — Kenar çubuğu paneli hizmet değiştirme

_v2.31.34 olarak yayımlandı._

### Düzeltildi
- **Kenar çubuğu panelinde "Netflix / Prime Video / Disney+ / Roku hizmetine geç" yine çalışıyor.** Geçiş, "Bağlantıyı değiştir" ve "Varsayılana sıfırla" hepsi panelin sayfasına hatırlanan bir başvuruyu kullanıyordu ve bu başvuru panel yeniden kurulduğunda eskiyor; ardından hiçbir şey yapmadan sessizce kalıyorlardı. Panel "Güncellendi" diyor ve tam olduğu yerde duruyordu. Artık her zaman gerçekten ekranda olan paneli yönetiyorlar ve başarısız bir gezinme atılmak yerine günlüğe yazılıyor.

### Notlar
- Çalışan uygulamaya karşı doğrulandı: hatırlanan başvuru kasten eskitildiğinde "Netflix hizmetine geç", düzeltmeden önce paneli Prime Video üzerinde bırakıyordu, düzeltmeden sonra Netflix'e taşıyor.

## v6.22.2 (2026-09-07) — Sayfada bul

_v2.31.33 olarak yayımlandı._

### Düzeltildi
- **Bulma çubuğu yine okunabilir.** Buzlu cam olarak çiziliyordu, ama bir web sayfasının üstünde yüzen buzlu bir panelin buzlayacak bir şeyi yoktur; bu yüzden saydam çıkıyordu ve bir belge gibi beyaz bir sayfanın üstünde kutu ile yazdığınız metin neredeyse görünmüyordu. Artık her temada opak.
- **Ctrl+F, Google Docs, E-Tablolar ve Slaytlar'da çalışıyor.** Bu uygulamalar metinlerini tarayıcının arayamayacağı bir biçimde çiziyor; bu yüzden bulma çubuğu onlarda hiçbir şeyi eşleştiremiyordu ve Vex tuşu uygulama kendi aramasını kullanamadan alıyordu. Ctrl+F artık doğrudan belgeye gidiyor ve orada çalışıyor. Başka her yerde Vex bulma çubuğu tam eskisi gibi açılıyor.

## v6.20.7 (2026-09-07) — E-postayla gelen oturum açma kodları, uçtan uca

_v2.31.32 olarak yayımlandı._

### Düzeltildi
- **E-postayla gelen oturum açma kodları artık Spotify ve diğer sitelerde doldurulıyor.** Kalan iki hata giderildi. Kodu beklemek tarayıcının tamamında aynı anda tek sayfayla sınırlıydı; bu yüzden başka bir yerde açık kalan bir oturum açma sayfası, gerçekten kullandığınız sayfayı sessizce engelleyebiliyordu. Ve bekleme, sayfa başladığı anda tam olarak eklenmemişse tümüyle bırakılıyordu (ki başladığı an tam da budur) ve girişimden hiçbir iz kalmıyordu. Geri çevrilen bir girişim artık kaybolmak yerine kaydediliyor.

### Notlar
- Tüm akış, posta kutusu sekmesi arka planda uykudayken gerçek Spotify kod ekranına karşı Vex içinde sürülerek doğrulandı: hem kodun zaten beklediği durum hem de siz beklerken geldiği durum.

## v6.18.7 (2026-09-07) — Kodu arka plandaki bir posta kutusundan okuma

_v2.31.31 olarak yayımlandı._

### Düzeltildi
- **E-postayla gelen oturum açma kodları, posta kutunuz arka planda olsa bile okunuyor.** Bunu iki şey engelliyordu. Uykuya geçmiş bir posta sekmesi hiç uyandırılmıyordu; bu yüzden posta kutusu açık olduğu hâlde Vex hiçbir posta kutusunun açık olmadığını bildiriyordu. Ve uyanık ama oturum açma sayfasının arkasında duran bir posta sekmesi tarayıcı tarafından donduruluyordu; bu yüzden yeni postayı hiç almıyordu: Vex aynı eski iletileri tekrar tekrar okuyordu ve kodun geldiğini hiç görmüyordu. Posta kutunuz artık Vex bir kodu beklerken uyanık ve çalışır tutuluyor, sonra tam olduğu gibi geri bırakılıyor.

## v6.17.7 (2026-09-07) — Spotify'da e-postayla gelen oturum açma kodları

_v2.31.30 olarak yayımlandı._

### Düzeltildi
- **E-postayla gelen oturum açma kodları artık Spotify'da doldurulıyor.** Önceki sürüm bunun başarısız olmasının iki nedenini düzeltti, ama burada önemli olanı değil: Vex, sayfa hâlâ yalnızca e-posta adresinizi sorarken izlemeye başlıyor, yaklaşık on beş saniye içinde bunun bir kod sayfası olmadığına karar verip duruyordu; kod kutusu henüz yokken. Spotify ise yeni bir sayfa yüklemeden kod adımını araya sokuyor; bu yüzden hiçbir şey yeniden bakmıyordu. Vex artık sayfa hâlâ bir oturum açma gibi göründüğü sürece ve e-postanın gelmesine yetecek kadar uzun izlemeye devam ediyor. Sıradan sayfalar eskisi kadar hızlı bırakılmaya devam ediyor.

## v6.16.7 (2026-09-07) — Otomatik doldurma ve oturum açma istemi düzeltmeleri

_v2.31.29 olarak yayımlandı._

### Düzeltildi
- **Kimlik doğrulayıcı kodları artık Roblox ve diğer sitelerde doldurulıyor.** İki adımlı doğrulama ekranı parola adımından sonra görünür ve Roblox bunu yeni bir sayfa yüklemeden gösterir; bu yüzden Vex bir kez bakmış, kod kutusu bulamamış ve pes etmişti. Artık siz sitede kaldığınız sürece kutunun görünmesini bekliyor. Adı kimlik doğrulayıcı kaydınızla eşleşen siteler, size siteyi göstererek bir kez soruyor, sonra yanıtınızı hatırlıyor.
- **E-postayla gelen oturum açma kodları yine doldurulıyor.** Açık posta kutunuzu aramak hâlâ yüklenmekte olan bir sekmeye çarpabiliyordu; bu da aramayı sessizce bırakan bir hata fırlatıyordu, yani birkaç sekme açıkken kod hiç getirilmiyordu. Posta kutunuzu açmak da hiçbir zaman başarılı olamayacak ve gerçek aramayı engelleyen bir arama başlatıyordu.
- **Windows geçiş anahtarı ve güvenlik anahtarı penceresi artık parolayla oturum açmaları bölmüyor.** Bastırılması, varsayılanı boş olacak şekilde site başına isteğe bağlı olmuştu; bu yüzden her yerde geri dönmüştü. Artık yeniden tüm sitelerde bastırılıyor ve Ayarlar bunu hâlâ daraltabilir ya da kapatabilir.

## v6.13.7 (2026-09-07) — 2FA ve e-posta kodu otomatik doldurma

_v2.31.28 olarak yayımlandı._

### Düzeltildi
- **Kimlik doğrulayıcı kodları artık Roblox'ta doldurulıyor.** Roblox kutusunu yalnızca "Enter 6-digit Code" olarak etiketliyor; Vex bunu iki adımlı doğrulama alanı olarak tanımıyordu, bu yüzden 2-Step Verification ekranında hiçbir şey olmuyordu. Sade bir "kod" kutusu, çevresindeki sayfa açıkça bir iki adımlı doğrulama ekranı olduğunda artık tanınıyor; böylece tanıtım ve kupon kutularına hâlâ dokunulmuyor.
- **Bir sır yazılarak eklenen kimlik doğrulayıcı kayıtları artık çalışıyor.** Elle eklenen kodların hizmet adı yoktur ve adı bir sonek taşıyan hizmetler (örneğin "Roblox Corporation") de tanınmıyordu. Vex artık kayıt adına, etiketine ya da ikisine göre eşleştiriyor.
- **E-postayla gelen oturum açma kodları artık Spotify'da doldurulıyor.** Bir siteden size kod e-postalamasını istemek sayfayı kod adımına taşır ve Vex bunu sayfadan ayrılmak sayılarak pes ediyordu; tam kod kutusu belirdiği anda. Artık aynı sitede kaldığınız sürece izlemeye devam ediyor.

## v6.11.2 (2026-09-07) — Oturum açma ve otomatik doldurma düzeltmeleri

_v2.31.27 olarak yayımlandı._

### Düzeltildi
- **Google ile oturum açmak Vex'i çökertebiliyordu.** Bir Google oturum açma açılır penceresi, kayıtlı girişinizi doldurmak yerine "A JavaScript error occurred in the main process" iletişim kutusunu gösteriyordu. Açılır pencere otomatik doldurması başka bir modüle taşınmış ve bağlanmamış koda çağrı yapıyordu ve hata işlenmek yerine yakalanmamış bir hata olarak dışarı kaçıyordu.
- **Kayıtlı parolalar Spotify'da dolmaz oldu.** E-posta ve parola adımları arasında sayfa adresini yeniden yazan girişler (Spotify bunu yapar) ilk adımdan sonra otomatik dolmayı bıraktı. E-postayla gelen oturum açma kodları da aynı şekilde etkilendi.
- **Kimlik doğrulayıcı kodları çoğu sitede dolmaz oldu.** İki adımlı doğrulama otomatik doldurması yalnızca sekiz hizmeti tanıyordu; bu yüzden Roblox, Spotify, Steam ve diğer her şey hiç dolmuyordu. Vex artık adı kimlik doğrulayıcı kaydınızla eşleşen siteyi de tanıyor: bir kez soruyor, size siteyi gösteriyor, sonra yanıtınızı hatırlıyor. Yalnızca ekranda gerçekten bir iki adımlı doğrulama alanı varken soruyor.

## v5.88.7 (2026-09-07) — Roblox paneli geri düğmesi

_v2.31.26 olarak yayımlandı._

### Düzeltildi
- **Roblox paneli geri düğmesi yokmuş gibi görünüyordu.** Kenar çubuğu web panelleri v2.31.17'den beri kendi geri/ileri/yenile çubuğunu taşıyor, ama Roblox'ta onu göremiyordunuz: çubuk panelin sol üst köşesinde soluk biçimde duruyor ve tam da Roblox'un kendi logosunu ve başlığını çizdiği yer orası; bu yüzden sayfaya karışıyordu. Artık Roblox panelinde opak ve her zaman görünür; diğer paneller zaten sahip oldukları ince görünümü koruyor.

### Değişti
- **Vex artık çok daha yeni bir tarayıcı motoru üzerinde çalışıyor**: Chromium 124 yerine Electron 42 / Chromium 148. Eski bir tarayıcı hakkında şikâyet etmeye başlayan ya da daha yeni web özelliklerine dayanan sayfalar yeniden düzgün davranmalı. Widevine oynatma (Spotify, Netflix) etkilenmiyor ve hâlâ imzalı.

### Dahili
- Hiçbir şeyin yüklemediği, kullanılmayan bir "Roblox Hub" paneli olan `roblox-panel.js` kaldırıldı.
- Derleme araçları Electron ile birlikte yükseltildi: electron-builder 26, yenilenmiş bağımlılıklar ve yeni bir simge üretme betiği.

## v5.88.2 (2026-09-05) — Pencere İçinde Pencere düzeltmeleri

_v2.31.25 olarak yayımlandı._

### Düzeltildi
- **Pencere İçinde Pencere ayrı penceresi kapatılamıyordu.** Başlık çubuğu, görev çubuğu düğmesi, klavye kısayolu ya da kendi düğmeleri yoktu; bu yüzden belirdiğinde ondan kurtulmanın tek yolu Görev Yöneticisi'ydi. Artık kendi denetim çubuğunu taşıyor (sekmeye dön, üstte tut ve kapat) ve Esc ya da Ctrl+W onu kapatıyor.
- **Pencere İçinde Pencere, normal çalışmış olsa bile ayrı pencereyi açıyordu.** Vex, videonun PiP'ye girip girmediğini yanlış sayfaya bakarak denetliyordu ve bu hiçbir zaman evet diyemezdi; bu yüzden her basış, çalışan PiP'nin üstüne ayrıca ayrı pencereyi de açıyordu. Kapatılamayan pencerenin sürekli çıkmasının sebebi buydu.
- **PiP düğmesi ve Ctrl+Shift+P artık gerçek bir aç/kapa düğmesi**: yeniden basmak, onu ikinci kez başlatmaya çalışmak yerine Pencere İçinde Pencere'den çıkıyor.
- **Ayrı pencere artık tam ekran uygulamaların üstünde yüzmüyor** ve Alt+Tab'ı arkasında hapsetmiyor; içindeki Ctrl+Shift+P üstte tutmayı açıp kapatıyor.
- **Ayrı pencere boyutunu, konumunu ve üstte tut ayarını hatırlıyor** ve bulunduğu monitörü çıkarırsanız ekran dışında yeniden açılmayı reddediyor.
- **Ayrı pencere artık geride bırakılamıyor.** Vex ile birlikte kapanıyor, onu kapatabilecek hiçbir şey kalmamış yüzen bir pencere olarak takılı kalmıyor, sayfası çökerse ya da donarsa yıkılıyor ve bir sayfa artık kapanmasına izin vermemezlik edemiyor.
- **Pencere İçinde Pencere artık çalışamadığında bunu size söylüyor**, geçerli sayfada sessizce hiçbir şey yapmak yerine.

## v5.85.7 (2026-09-04) — Tıklamaların sessizce hiçbir şey yapmamasını düzeltme

_v2.31.24 olarak yayımlandı._

### Düzeltildi
- **Düğmeler ve menü öğeleri tamamen yanıt vermeyi bırakabiliyordu** (bir kenar çubuğu panelinde yenileme, “Vencord sürümümü kur” ve diğerleri) ve hiçbir hata iletisi yoktu. Sağ tık menüsü, bir sonraki tıklamanızı yakalamak için arkasında görünmez, pencerenin tamamını kaplayan bir katman bırakır; o menü temizlik yapmadan kaybolursa katman kalıyor ve uygulamadaki her tıklamayı yutuyordu. Vex artık başıboş bir katmanı fare hareket ettirir ettirmez temizliyor; bir sonraki tıklamanızdan önce.

## v5.81.9 (2026-09-04) — Discord ses yeniden bağlanma düzeltmesi

_v2.31.23 olarak yayımlandı._

### Düzeltildi
- **DPI atlatma açıkken Discord sesi birkaç saniyede bir yeniden bağlanıp duruyordu.** Atlatma, Discord'un ses bağlantısına da uygulanıyordu ve engellemeyi aşma hileleri bu tür uzun ömürlü bağlantıyı bozuyor. Ses artık doğrudan bağlanıyor; sohbet ve oturum açma atlatmada kalıyor.

## v5.79.4 (2026-09-04) — Vencord'un kaybolmasını düzeltme + DRM ses notu

_v2.31.22 olarak yayımlandı._

### Düzeltildi
- **Vencord ve eklentileri bir güncellemeden sonra kaybolabiliyordu.** Tek bir Vencord sürümünü tutan rutin, eskimiş/devre dışı bir kopyayı tutup çalışan kopyayı silebiliyordu. Artık yüklenemeyen kopyaları yok sayıyor ve her zaman gerçek, en yeni sürümü tutuyor.

### Eklendi
- **Ana Ses Düzeyi** artık Netflix/Disney+/Prime ve diğer DRM videolarında kendini açıklıyor: orada yüzde 100'ün ötesine zorlamak, sesin DRM korumalı olduğunu (bu yüzden tarayıcıda yükseltilemediğini) söyleyen bir not gösteriyor ve hiçbir şey yapmıyormuş gibi görünen bir kaydırıcı yerine Equalizer APO gibi bir Windows güçlendiricisi öneriyor.

## v5.78.1 (2026-09-03) — Ana Ses Düzeyi daha fazla sitede yükseltiyor

_v2.31.21 olarak yayımlandı._

### Düzeltildi
- **Ana Ses Düzeyi'nin yüzde 100'ün üstüne yükseltmesi artık çok daha fazla sitede çalışıyor.** Kaynaktan daha yüksek sese çıkmak Web Audio gerektirir ve medya izin vermedikçe farklı kaynaklı video/ses üzerinde sessiz kalır; bu yüzden bu siteler yüzde 100'de takılıp kalıyordu. Vex artık medyayı farklı kaynaklara uyumlu hâle getiriyor ve yükseltmenin uygulanması için yeniden yönlendiriyor; oynatma sürüyor. (Netflix/Disney+ gibi DRM videoları yine yüzde 100'ün üstüne yükseltilemez; sesleri korumalıdır.)

## v5.76.6 (2026-09-03) — Vencord sürümü kendini onarma + kurulum günlüğü

_v2.31.20 olarak yayımlandı._

### Düzeltildi
- **“Vencord sürümümü kur”, önceki bir sürümün dosyaları hâlâ kullanımdayken (örn. Discord paneli açıkken) ESKİ bir sürümü yüklemeye devam edebiliyordu**; bu yüzden iki sürüm aynı anda yükleniyor ve eskisi kazanıyordu. Vex artık yalnızca en yeni sürümü tutuyor, başlangıçta (dosyalar kilitlenmeden önce) ve kurulumdan hemen sonra; böylece yeni bir sürüm gerçekten devralıyor. Yeniden başlatmak takılı kalmış eski bir sürümü kalıcı olarak temizler.

### Değişti
- Yerel bir Vencord sürümünü kurmak artık uygulama veri klasöründe her adımı kaydeden küçük bir günlüğü `vencord-install.log` dosyasına yazıyor; böylece her kurulum sorunu teşhis edilebilir.

## v5.76.1 (2026-09-03) — Yerel Vencord kurulumu en son sürümü yüklüyor

_v2.31.19 olarak yayımlandı._

### Düzeltildi
- **“Vencord sürümümü kur”, ESKİ sürümünüzü çalıştırmaya devam edebiliyordu** (örn. yeniden derledikten sonra hâlâ yalnızca eski eklenti özelliklerini gösteriyordu). Vex artık her zaman en son derlenen `extension-chrome.zip` dosyasını kuruyor ve ardından Discord panelini tamamen yeniden oluşturuyor; böylece yeni kurulan eklentiler, bir yenilemenin önceki sürümü tutması yerine gerçekten yükleniyor.

## v5.75.6 (2026-09-03) — Daha anlaşılır Vencord sürümü kurulumu

_v2.31.18 olarak yayımlandı._

### Düzeltildi
- **“Vencord sürümümü kur (özel eklentiler)” hiçbir şey yapmıyormuş gibi geliyordu.** Aslında kuruyordu (ve Vencord Discord paneline yükleniyordu), ama tek işaret kısa bir bildirim ve arka planda bir yenilemeydi. Artık Discord paneline geçiyor ve değişikliği görmeniz için yeniliyor, açık bir iletiyle; ve sürüm bulunamazsa nasıl üretileceğini (`pnpm buildWeb`) açıklıyor.

## v5.75.3 (2026-09-02) — Panel gezinmesi, otomatik yenilenen kodlar ve Tor düzeltmesi

_v2.31.17 olarak yayımlandı._

### Eklendi
- **Her kenar çubuğu uygulama panelinde Geri / İleri / Yenile** (Spotify, Claude, sabitlenmiş siteler, …), yalnızca Discord'da değil. Paneller sekme değildir, bu yüzden ana araç çubuğu onları yönetemiyordu; şimdi her birinin kendi ince çubuğu var ve düğmeler her zaman panelin geçerli sayfası üzerinde işlem yapıyor.

### Düzeltildi
- **E-posta kodu otomatik doldurma artık gelen kutunuzu sizin için yeniliyor.** Gmail'in ekranda zaten gösterdiği her şeyi okuyordu; bu yüzden bir kod çoğu zaman yalnızca Gmail'i kendiniz yeniledikten sonra beliriyordu. Artık kod gelene kadar yaklaşık 90 sn boyunca gelen kutusunu yeni posta getirmesi için dürtüyor (Gmail'in kendi Yenile düğmesine zararsızca tıklayarak), sonra dolduruyor.
- **Tor başlamıyordu — “tar module missing”**, indirme yüzde 100'e ulaştıktan sonra. Tor'u açan bileşen uygulamaya dahil edilmemişti. Artık dahil, bu yüzden Tor açılıyor ve başlıyor. (Makinenizde Tor Browser ya da tor hizmeti zaten çalışıyorsa Vex yine onu kullanır.)

## v5.69.8 (2026-09-02) — Kenar çubuğu Yenile düzeltmesi

_v2.31.16 olarak yayımlandı._

### Düzeltildi
- **Bir kenar çubuğu uygulama/site düğmesinde Sağ tık → Yenile** sessizce hiçbir şey yapmayabiliyordu. Panelin sayfasına saklanmış bir başvuruyu yeniliyordu ve bu başvuru panelin hizmetini değiştirdikten, yeniden bağladıktan ya da gizleyip yeniden gösterdikten sonra eskiyebiliyordu; ayrılmış bir sayfayı yenilemek etkisizdir. Yenile artık panelin canlı sayfasını bulup yeniliyor ve bu başarısız olursa panelin URL'sini yeniden açıyor; böylece her zaman bir şey yapıyor.

## v5.68.8 (2026-09-01) — Site uyumluluk araçları ve site başına asla uyuma

_v2.31.15 olarak yayımlandı._

### Eklendi
- **“Bu Sitenin Tarayıcı Kimliğini Göster”** (Ctrl+K 🕵️) — geçerli sayfanın tarayıcı hakkında gördüklerini (kullanıcı aracısı, Chrome markası, `window.chrome`, `navigator.webdriver`, WebGL) ve bir sitenin Vex'i “desteklenmiyor” olarak işaretleyip işaretlemeyeceğine dair sade bir GEÇTİ/KALDI kararını gösterir. Bir Kopyala düğmesi raporu dışa aktarır.
- Site Ayarları'nda (🌐) **“Bu sitenin uyumasına asla izin verme”** anahtarı — seçilen bir siteyi yeniden başlatmalar boyunca arka planda yüklü tutar; Bellek Tasarrufu'nu, otomatik uykuyu ve boştayken atmayı atlar.

### Düzeltildi
- **Sıkı CSP'li siteler** (Adobe ve benzerleri) artık Vex'in konum ve parmak izi karşıtı yamalarını da uyguluyor — daha önce bu sitelerin İçerik Güvenliği Politikası'nın engellediği bir enjeksiyon yöntemini kullanıyorlardı; bu yüzden konum ve parmak izi koruması orada sessizce çalışmıyordu. İkisi de artık v2.31.14 tarayıcı kimliği düzeltmesiyle aynı CSP'ye dayanıklı yolu kullanıyor.

## v5.64.8 (2026-09-01) — Adobe ve sıkı CSP'li siteler

_v2.31.14 olarak yayımlandı._

### Düzeltildi
- **Adobe “desteklenmeyen tarayıcı” (Tarayıcı desteklenmiyor)** düzeltildi. Adobe'nin oturum açma ve web uygulaması sayfaları, Vex'in “gerçek Chrome” kimliğini enjekte etme biçimini engelleyen sıkı bir İçerik Güvenliği Politikası gönderiyor; bu yüzden bu sayfalarda `navigator.userAgentData` yalnızca “Chromium” bildiriyordu ve Adobe tarayıcıyı reddediyordu. Vex artık bu yamaları CSP'ye dayanıklı biçimde uyguluyor; böylece Chrome markası ve `window.chrome` yalnızca gevşek CSP'li sayfalarda değil her yerde mevcut. Bu, diğer sıkı CSP'li siteleri de aynı türden “desteklenmeyen tarayıcı” / doğrulama hatalarına karşı sağlamlaştırıyor.

## v5.63.8 (2026-09-01) — Daha fazla araç ve meslek

_v2.31.13 olarak yayımlandı._

### Eklendi
- **5 yeni Araç Kutusu aracı** (artık 15): JWT Çözücü, URL Kodlama/Çözme, Büyük/Küçük Harf Dönüştürme (BÜYÜK/küçük/Başlık/camelCase/snake_case/kebab/CONSTANT), Parola Üretici ve canlı Markdown Önizleme.
- İş Kurulumu'nda **22 meslek daha** (artık 65) — SRE, ML/Bulut/Blockchain/API/BT/SysAdmin, Hareket ve 3D, Teknik Yazar, Blog Yazarı, Sosyal Medya, Danışman, İK, İşe Alım Uzmanı, Operasyon, İstatistikçi, İnşaat Mühendisi, Diş Hekimi, Veteriner, Podcast Yapımcısı, Yayıncı — her biri kullandıkları araçlarla eşlendi.

### Değişti
- **Çalışma paneli** cilası — araç kartlarında üzerine gelme efektleri ve iş başlığında bir kategori etiketi.
- **Bu Sitenin Verilerini Temizle ve Yeniden Yükle** komutu (`Ctrl+K`) — bir sitenin çerezlerini, depolamasını ve önbelleğe alınmış yanıtlarını siler ve sert yeniden yükler; eski “desteklenmeyen tarayıcı” yönlendirmelerini, oturum açma aksaklıklarını ve ücret duvarlarını giderir.

## v5.59.8 (2026-09-01) — PiP dönüşü, Çalışma paneli ve site uyumluluğu

_v2.31.12 olarak yayımlandı._

### Eklendi
- **Çalışma kenar çubuğu paneli** — bir evrak çantası simgesi mesleğiniz için bir panel açar (İş Kurulumu'ndan): etkin araçlarınız bir tık uzağınızda, geçerli iş + tema, hızlı eylemler ve işi değiştirmek ya da araçları yönetmek için bir bağlantı.

### Düzeltildi
- **Pencere İçinde Pencere "Sekmeye dön"** artık gerçekten sizi sekmeye döndürüyor — Vex'i videonun sekmesine geçiriyor, pencereyi öne getiriyor ve videoyu yeniden görünüme kaydırıyor (önceden yalnızca mini pencereyi kapatıyordu).
- **"Desteklenmeyen tarayıcı" sayfaları (örn. Adobe)** — bazı siteler Vex'in gerçek bir tarayıcı olmadığına karar vermek için `window.chrome` alanına (Electron'un boş bıraktığı) bakıyordu. Vex artık gerçek Chrome `window.chrome` alanlarını sunuyor; bu sayfalar normal yükleniyor.

## v5.55.8 (2026-09-01) — Daha güvenilir kod otomatik doldurma

_v2.31.11 olarak yayımlandı._

### Düzeltildi
- **E-posta kodu otomatik doldurma, gelen kutunuzda zaten bulunan bir kodu kaçırıyordu** (örn. Gmail açıkken Spotify). E-postanın hâlâ okunmamış görünmesini *ve* doğrulama ifadesiyle eşleşmesini gerektiriyordu — Gmail onu okundu işaretlediğinde ya da gönderen farklı ifade ettiğinde fazla katıydı. Artık daha fazla kod ifadesini tanıyor ve son çare olarak, daha yeni bir şey gelmeyen en yeni açık doğrulama kodunu, okunmamış bayrağı güvenilir olmasa bile dolduruyor; gerçekten daha yeni bir kodu ise yine tercih ediyor.

## v5.54.8 (2026-08-31) — Oyun reklamlarının geri kalanını engelle

_v2.31.10 olarak yayımlandı._

### Düzeltildi
- Tarayıcı oyunlarındaki **kalan yan ray reklamı** (makeitmeme.com) artık engelleniyor. Fuse (`fuseplatform.net`) tarafından, RTB House'tan (`creativecdn.com`) gelen reklam öğeleriyle sunuluyordu; ikisi de her zaman açık engelleme listesine eklendi; böylece filtre motoru başlangıçta yüklenmeyi bitirmeden önce bile durduruluyorlar.

## v5.53.3 (2026-08-31) — Oyun sitesi reklamlarını engelle

_v2.31.9 olarak yayımlandı._

### Düzeltildi
- **Tarayıcı oyunlarındaki reklamlar** (makeitmeme.com ve benzerleri) artık engelleniyor. Görüntülü reklamları, EasyList'i atlatmak için alt alan adlarını döndüren bir Playwire reklam ağı olan `html-load.com` üzerinden sunuluyordu. Bu ve o reklam yığınının geri kalanı Vex'in engelleme listesine eklendi.

## v5.51.8 (2026-08-31) — Cloudflare Turnstile düzeltmesi

_v2.31.8 olarak yayımlandı._

### Düzeltildi
- gartic.io gibi sitelerde **Cloudflare Turnstile "Verification failed"**. Vex, Kullanıcı Aracısı'nda ve istek üstbilgilerinde kendini Google Chrome olarak sunuyor, ama tarayıcının JavaScript istemci ipuçları (`navigator.userAgentData`) hâlâ "Chromium" diyordu — bu uyuşmazlık bot algılamasını tetikliyordu. Vex artık üçünde de tutarlı biçimde "Google Chrome" bildiriyor; böylece doğrulamalar normal geçiyor.

## v5.48.0 (2026-08-31) — İşiniz için yapılmış bir Vex

_v2.31.7 olarak yayımlandı._

### Eklendi
- **İş Profilleri** — kurulum sihirbazında ya da `Ctrl+K` → **İşiniz İçin Kişiselleştir** ile mesleğinizi seçin (Teknoloji, Tasarım, Yazarlık, İş, Bilim, Sağlık, Eğitim, Hukuk, Yaratıcı alanlarında 43). Vex uygun bir tema uygular, o işin günlük kullandığı yerleşik araçları etkinleştirir ve Tor düğmesinin yanına hızlı araç düğmeleri ekler. Hangi araçları istediğinizi tam olarak siz seçersiniz.
- **🧰 Araç Kutusu** — 10 yerleşik araç, hepsi yerel (dış site yok): Regex test aracı, JSON biçimlendirici, CSV görüntüleyici, Base64, Karma (SHA‑1/256/512), Unix zaman damgası, Cron açıklayıcı, UUID, Sözcük sayacı ve Renk ve karşıtlık. Araç Kutusu düğmesinden ya da `Ctrl+K` → **Araç Kutusu** ile açın.

## v5.38.0 (2026-08-31) — Günlük araçlar

_v2.31.6 olarak yayımlandı._

### Eklendi
- **Komut çubuğundan açık bir sekmeye geçin** — `Ctrl+K`'ye basın, bir sekmenin başlığını ya da URL'sini yazın; eşleşen açık sekmeler "↪ Sekmeye geç" olarak görünür.
- **📱 Telefona Gönder** — geçerli sayfanın (ya da sağ tıklanan bir bağlantının) QR kodunu gösterir, telefonunuzda açmanız için. Yerel olarak üretilir — makinenizden hiçbir şey çıkmaz.
- **Yapıştır ve Git** — panonuzdaki URL'yi ya da aramayı tek adımda açın.
- **Sekmeyi Çoğalt** ve **Tüm Sekme URL'lerini Kopyala** — komut çubuğundan (Çoğalt sağ tık menüsünde de var).
- **⟳ Otomatik yenileme** — sayfa sağ tık menüsünden bir sekmeyi aralıkla yeniden yükleyin (30 sn / 1 dk / 5 dk / 15 dk) — panolar, canlı skorlar ve derleme günlükleri için.

## v5.33.0 (2026-08-31) — Tek tıkla yeniden başlatma

_v2.31.5 olarak yayımlandı._

### Eklendi
- **"⟳ Uygulamak için Vex'i yeniden başlat" düğmesi** — yalnızca açılışta etkili olan ayarlar (Bellek Tasarrufu gibi) artık bunu sizden istemekle yetinmek yerine tek tıkla yeniden başlatma sunuyor. Düğme, bir yeniden başlatma beklerken ayarın altında görünür ve tıklanınca Vex'i yeniden başlatır; sekmeleriniz geri gelir.

## v5.31.5 (2026-08-31) — Bölmeyi panel panel seçme, oturum açma araçları ve Bellek Tasarrufu

_v2.31.4 olarak yayımlandı._

### Değişti
- **Bölünmüş ekran artık her paneli seçtiriyor.** Böl'e (ya da 3/4 panele) basmak, sıradaki sekmeyi kapmak yerine seçebileceğiniz açık sekmelerinizi gösterir — panel 2, sonra 3, sonra 4. İptal, seçtiğiniz panelleri korur.

### Eklendi
- **Daha fazla sağlayıcıdan e-posta kodları** — otomatik doldurma artık Gmail'e ek olarak Outlook, Proton, Yahoo ve iCloud postasından da doğrulama kodlarını okuyor.
- **Otomatik doldurmayı sına** — Oturum Açmalar ve Kodlar içinde, e-postanıza ulaşıp okuyup okuyamadığını bildiren bir kendini denetleme (kaynak bulundu mu? gelen kutusu okunabilir mi? kod görünüyor mu?).
- **Kodu doldurduktan sonra otomatik gönder** (isteğe bağlı) — formun doğrula/gönder düğmesine sizin yerinize basar.
- **Parola Sağlığı** (`Ctrl+K` → Parola Sağlığı ya da merkez) — yeniden kullanılan, zayıf ya da 2FA'sı olmayan kayıtlı parolaları bulur. Çözümleme uygulamada yerel olarak çalışır; parolalarınız makinenizden hiç çıkmaz.
- **🧠 Bellek Tasarrufu** (Ayarlar → Performans) — RAM'i düşürmek için tek anahtar: sekmeleri daha erken (10 dk) uyutur, Vex simge durumuna küçültüldüğünde arka plan sekmelerini atar, işleyici işlemlerini sınırlar ve bellek içi sayfa önbelleğini kapatır. Tamamen uygulamak için yeniden başlatın.

### Performans
- **E-posta kodu otomatik doldurma artık Gmail'de asla uyuma gerektirmiyor.** Uyuyan bir Gmail'i yalnızca kodu okumak için uyandırır, sonra hemen tekrar uykuya koyar; böylece Gmail, kalıcı yaklaşık 300–500 MB yerine kodlar arasında yaklaşık 0 MB tutuyor.
- **Gizli arka plan Gmail okuyucusu** birkaç dakika boştan sonra kendini serbest bırakıyor (eskiden sonsuza dek bellekte kalırdı) ve Chromium'un her zaman hazır **yedek işleyicisi** devre dışı — ikisi de boştaki belleği düşürüyor.

## v5.17.9 (2026-08-31) — Güvenilir kod otomatik doldurma ve Özel Görsel

_v2.31.3 olarak yayımlandı._

### Düzeltildi
- **E-posta kodu otomatik doldurma artık gelen kutunuzda zaten bulunan bir kodu dolduruyor.** En yeni kodun anlık görüntüsünü bir taban olarak alıyor ve yalnızca *farklı* birini dolduruyordu; bu yüzden doğrulama e-postası oturum açma sayfası açıldığında zaten oradaysa (Gmail bir an geç uyandı ya da e-posta sayfa yüklenirken düştü), kod sonsuza dek atlanıyordu. Artık, kendisini aşan daha yeni bir şey olmayan okunmamış bir doğrulama kodunu dolduruyor; yine de eski, zaten tüketilmiş bir kodu asla doldurmuyor.
- **Özel Görsel teması duvar kâğıdı güvenilir.** Görsel artık uygulamanın kendisi tarafından saklanıyor (yalnızca açık olan Gmail tarzı başlangıç sayfalarına itilmiyor); bu yüzden siz seçtiğinizde biri açık olsun olmasın yeni sekme sayfasında görünüyor ve yeniden başlatmalara dayanıyor. Seçiciyi iptal etmek artık mevcut görselinizi silmiyor.

### Eklendi
- **E-posta kodlarını gizli bir Gmail'den okuyun** (Ayarlar → Gizlilik → Otomatik doldurma ya da `Ctrl+K`) — oturum açmış oturumunuzu kullanarak, hiçbir Gmail sekmesi açık ya da uyanık olmadan doğrulama kodlarını doldurur.
- İstek üzerine **"Kodu e-postadan doldur"** — bir `Ctrl+K` komutu ve herhangi bir giriş alanında sağ tık öğesi.
- **E-posta gövdesi yedeği** — kod gelen kutusu özetinde değilse kodu ileti gövdesinden okur.
- Otomatik doldurma kaçırmaları artık **nedenini** söylüyor (Gmail açık değil / hâlâ yükleniyor / kod gelmedi) — o anda bir bildirim olarak ve Oturum Açmalar ve Kodlar merkezinde.

### Değişti
- **"Yenilikler" tipografisi** — sürüm notları artık Vex'in kendi yazı tiplerini kullanıyor (başlıklarda Space Grotesk, gövdede Outfit, kodda JetBrains Mono).

## v5.11.8 (2026-08-31) — Her sürüme göz atın

_v2.31.2 olarak yayımlandı._

### Eklendi
- **Yenilikler sürüm seçici** — sürüm notları penceresinde artık her sürümü listeleyen bir açılır liste var (en yeniden eskiye, v1.0.0'a kadar). Notlarını okumak için herhangi bir sürümü seçin; "GitHub'da Görüntüle" bağlantısı o etikete yönlenir. Paketlenmiş değişiklik günlüğünden okunur, bu yüzden çevrimdışı çalışır.

## v5.10.8 (2026-08-31) — "Yenilikler"i yeniden aç

_v2.31.1 olarak yayımlandı._

### Eklendi
- **"Yenilikler" komutu** (`Ctrl+K → What's New`) — bu sürümün sürüm notlarını istediğiniz zaman yeniden açın. Güncelleme günlüğü yalnızca bir güncellemeden sonra kendiliğinden görünüyordu ve ona geri dönmenin bir yolu yoktu.

## v5.9.8 (2026-08-31) — On bir yeni araç

_v2.31.0 olarak yayımlandı._

### Eklendi
- **Vex için icat edilmiş on özellik** (başka hiçbir tarayıcıda yok), her biri `Ctrl+K` ile: **🔥 Yakılabilir Kimlik** (atılabilir OTR kapsayıcısı + tek kullanımlık e‑posta, isteğe bağlı olarak Tor üzerinden), **🕵️ Sızıntı Kanaryası** (kayıtlı bir e‑postanız yanlış sitede önceden doldurulduğunda uyarır), **🧾 İzleyici Makbuzları** (haftalık anlatımlı gizlilik raporu + eğilim), **⚙️ Otomasyonlar** (eğer‑bu‑ise‑şu: bir URL'de / bir zamanda → aç/panel/komut), **🎯 Odak Akışları** (birleştirilebilir çalışma kipleri — sekmeler + persona + karartma + engelleme), **🎧 Sonra Oku Podcast Olarak** (kayıtlı makalelerinizin kendiliğinden ilerleyen TTS'si), **🎨 Yapay Zekâ Yeniden Biçimlendirme** (yapay zekâ, bir siteyi tarif ettiğiniz bir görünüme getirmek için CSS yazar, bir Boost olarak kaydedilir), **🧾 Evrensel Form Doldurma** (tek bir profil kayıt/ödeme formlarını doldurur), **📝 Sayfa başına Yapışkan Notlar** ve **🔗 Bağlantılı bölünmüş kaydırma**.
- **Kısayollar ve Hareketler kopya kâğıdı** (`Ctrl+K → Shortcuts & Gestures`) — gizli olanlar dahil *her* klavye kısayolunun (sekmeye atlama `Ctrl+1‑9`, `Ctrl+Alt+H` patron tuşu, komut zinciri yuvaları, yakınlaştırma/gezinme), tüm fare hareketlerinin ve her sağ tık eyleminin aranabilir başvurusu. Gizli özellikleri bulunabilir kılar.
- **Daha fazla fare hareketi** — geri/ileri/üst/yenile/kapat/yeniden aç ek olarak: **↑→ yeni sekme**, **↑← sekmeyi çoğalt**, **→↓ sonraki sekme**, **←↓ önceki sekme**.
- **Sekme başına yapay zekâ persona değiştirici** (`Ctrl+K → Switch AI Persona (this tab)`) — Vex zaten sekme başına farklı bir persona çalıştırabiliyor ve `@name` ile geçiş yapabiliyordu, ama hızlı bir seçici yoktu; şimdi var ve sekmenin hangi personayı kullandığını gösteriyor.
- **Daha zengin sağ tık menüsü** — bir seçimi **🔊 Sesli oku**, bir bağlantıyı **📚 Sonra Oku**, **🎯 Öğeyi gizle** (sitede her şeyi gizle) artık sayfa menüsünde, mevcut Açıkla/Özetle/Çevir/Vurgula ve Google Lens görsel aramasının yanında.
- **Ekran paylaşımı kalite ayarları.** Bir site ekranınızı paylaşmak istediğinde (Discord "Go Live", Meet, vb.), kaynak seçici artık **çözünürlüğü** (Kaynak / 720p / 1080p / 1440p), **FPS'yi** (15 / 30 / 60), **sistem sesini paylaş**ı açık/kapalı ve **imleci göster**i açık/kapalı da ayarlatıyor — Discord'un normalde Nitro arkasına koyduğu seçenekler. Bir sayfa dünyası `getDisplayMedia` katmanı aracılığıyla gerçek yakalamaya uygulanır ve bir sonraki sefer için hatırlanır.
- **Sekme Sağlığı panosu** (`Ctrl+K → Tab Health`) — her sekme gerçek durumuna göre gruplanır (etkin · uyanık-tutulan · uyanık · hazırda bekleyen · uyuyan · yüklenmemiş), canlı bellekle ve tek tıkla uyanık tut / uyut / uyandır ile. Uyku sistemini büyü olmaktan çıkarıp görünür kılar.
- **Oturum Açmalar ve Kodlar merkezi** (`Ctrl+K → Logins & Codes`) — üç otomatik doldurma sistemi (kayıtlı parolalar, kimlik doğrulayıcı 2FA ve e-posta kodu) tek yerde, her biri yeni bir yerel **otomatik doldurma günlüğünden** tür başına başarı oranıyla ve canlı bir "Gmail kodlar için hazır mı?" durumuyla.
- **Site Ayarları** (`Ctrl+K → Site Settings`) — Vex'in bulunduğunuz site için web sitesi başına hatırladığı her şey (yakınlaştırma, zorlanmış koyu kip, özel CSS/JS Boost'ları) ve özelleştirdiğiniz her sitenin bir listesi, site başına sıfırlama ile.
- **Kenar çubuğu paneli rozetleri** — her uygulama panelinin başlığına koyduğu okunmamış sayı (Discord, WhatsApp…) artık kenar çubuğu simgesinde bir rozet olarak görünüyor; böylece kenar çubuğu gerçek bir pano oluyor.
- **Kurulum Galerisi** (`Ctrl+K → Setup Gallery`) — tüm Vex kurulumlarını (paneller, kısayollar, tema) taşınabilir kodlar olarak kaydedin, adlandırın, paylaşın ve aralarında geçiş yapın; kişisel bir kitaplık tutun.
- **Düzen ön ayarları** — düzen düzenleyicisi, sürükleyerek yeniden düzenleme denetimlerinin yanında tek tıkla **Varsayılan / Temel / Asgari** ön ayarlarını alıyor.
- **Vex'ten bir şey yapmasını isteyin…** (`Ctrl+K`) — yaygın sekme/pencere eylemlerini **yerel olarak, çevrimdışı** anlayan sade İngilizce bir komut çubuğu ("close all youtube tabs", "sleep the others", "group my github tabs", "split screen", "keep this awake"), herhangi bir şey kapanmadan önce sorar ve ayrıştıramadığı her şeyi yapay zekâ sekme yöneticisine devreder.
- **Tor / Proxy üzerinden yönlendir** (`Ctrl+K`) — tüm bir kapsayıcıyı (ya da bu oturumu) Tor veya özel bir SOCKS/HTTP proxy üzerinden kalıcı olarak gönderin ya da tek tıkla Tor üzerinden yönlendirilen yepyeni bir kapsayıcı açın.
- **Gmail sekmesi olmadan e-posta kodları** — isteğe bağlı: zaten oturum açmış oturumunuzu kullanarak gizli bir arka plan Gmail'inden doğrulama kodlarını okuyun (IMAP yok, OAuth yok, yeni kimlik bilgisi yok). Oturum Açmalar ve Kodlar merkezinde açıp kapatın.
- **Daha akıcı yerel yapay zekâ** — Ollama kurulu olmadığında cihaz üzerindeki özellikler (geçmiş dizinleme gibi) artık her sayfada başarısız olmak yerine sessizce atlanıyor; ayrıntılı yapay zekâ yönlendirme günlükleri bir hata ayıklama bayrağının arkasına alındı. Çok daha sessiz konsol.

### Düzeltildi
- **"Asla uyuma" sekmeleri artık gerçekten hazır kalıyor.** Uyanık tuttuğunuz bir sekme yeniden başlatmadan yüklenmemiş bir taslak olarak geri geliyordu — tıklamak sayfayı anında göstermek yerine sıfırdan yüklüyordu ve arka plan okuyucuları (e-posta kodu otomatik doldurma gibi) okunacak canlı bir şey bulamıyordu. Artık uyanık tutulan her sekme açılışta tamamen canlandırılıyor, uyanık tutmayı açtığınız anda (hiç açılmamış olsa bile) gerçekleştiriliyor ve arka plan kısıtlamasından muaf tutuluyor; böylece öndeyken değilken de sayfası çalışıyor — yani uyanık tutulan bir Gmail arka planda posta almaya devam ediyor ve kod otomatik doldurma güncel bir gelen kutusunu okuyor. Otomatik doldurmanın bazen tutup bazen tutmamasının büyük bir kısmı buydu.
- **Reklam engelleyici erken sayfa yüklemelerinde hata fırlatıyordu.** Kozmetik (öğe gizleme) filtre işleyicileri yalnızca filtre motoru arka planda yüklemeyi bitirdikten sonra kaydediliyordu; bu yüzden o pencerede yüklenen her sayfa "No handler registered" hatası fırlatıyor ve öğe gizleme almıyordu. İşleyiciler artık baştan kaydediliyor ve yalnızca motoru bekliyor — hata yok ve kozmetik filtreleme ilk sayfadan itibaren uygulanıyor.
- **Discord yayın ayrı penceresi ekranınızı tutsak ediyordu.** Bir yayını ayrı pencereye almak, her zaman üstte sabitlenmiş, neredeyse tam ekran bir pencere açıyordu; her şeyi örtüyordu — Alt+Tab uygulamaları değiştiriyordu ama önce ayrı pencereyi simge durumuna küçültmeden onları göremiyor ya da onlara ulaşamıyordunuz. Her zaman üstte yüzme artık yalnızca ayrı pencere küçük (pencere içinde pencere boyutunda) bir pencereyken uygulanıyor: büyük açın ya da büyütün, Alt+Tab ile özgürce geçebileceğiniz normal bir pencere gibi davranır; yeniden küçültün, yine üstte yüzer.

## v4.90.8 (2026-08-29) — Düzeltmeler

_v2.30.1 olarak yayımlandı._

### Düzeltildi
- **E-posta kodu otomatik doldurma, önceki bir denemeden *eskimiş* bir kodu doldurabiliyordu.** Bir kod birkaç an önce e-postalanmışsa (örn. bir yeniden deneme), otomatik doldurma yeni kod düşmeden hemen önce o eski kodu dolduruyordu — bu yüzden oturum açma "invalid code" ile başarısız oluyordu. Artık kod ekranı açıldığı anda gelen kutunuzda zaten bulunan kodun anlık görüntüsünü alıyor ve yalnızca *farklı* olanı dolduruyor — mevcut denemenizin gerçekten tetiklediği kodu. (Önceki zaman damgası denetimi fazla kabaydı: Gmail'in satır zaman damgaları dakika ayrıntısındadır, bu yüzden aynı dakika içindeki bir yeniden deneme kaçıyordu. Kod değerini karşılaştırmak kesin.)

## v4.88.3 (2026-08-29) — Sizin için yapılmış bir tarayıcı: arayüzü yeniden düzenleyin

_v2.30.0 olarak yayımlandı._

### Eklendi
- **Düzeni Düzenle — tarayıcınızın kendi arayüzünü yerinde yeniden düzenleyin.** Vex'in sloganı "sizin için yapılmış bir tarayıcı"; şimdi onu gerçekten yerinden oynatabilirsiniz. `Ctrl+K → "Edit Layout"` ya da **Ayarlar → Görünüm → Düzen** ile açın; tüm arayüz bulunduğu yerde düzenlenebilir hâle gelir: **sürükleyerek yeniden sırala, ✕ ile gizle.** Yalnızca düz düğmeleri değil, *her şeyi* kapsar — Vex logosu, çalışma alanı değiştirici, eşitleme göstergesi, adres çubuğu ve onun URL Kopyala / Özetle düğmeleri, Geri/İleri/Yenile, her üst çubuk düğmesi (Tor, Notlar, Uzantılar, Yapay Zekâ, Böl, Komut), her **kenar çubuğu simgesi** ve her **Glass kısayol çipi** (Google, YouTube, Discord…). Bir üst çubuk düğmesini **farklı bir kümeye** de sürükleyebilirsiniz — Tor'u sola, Geri'yi sağa ya da bir düğmeyi doğrudan adres çubuğunun içine bırakın. Ve **tüm bölümleri** taşıyabilirsiniz: bir bölümün tutamağını sürükleyerek sol kümenin, adres çubuğunun ya da sağ kümenin tamamını yeni bir sıraya alın (örn. adres çubuğunu en sola koyun). Alttaki bir çubukta bir **Gizli → geri yüklemek için tıkla** tepsisi, ayrıca **Araç çubuğunu sıfırla** ve **Bitti** bulunur. Düzeniniz kaydedilir ve yeniden başlatmalara dayanır. (Kenar çubuğu değişiklikleri Ayarlar → Kenar çubuğu ile eşzamanlı kalır; bir kısayolun ✕'i onu kaldırır — + çipi ile yeniden ekleyin.)

## v4.81.3 (2026-08-29) — 2FA kodlarını otomatik doldurma

_v2.29.10 olarak yayımlandı._

### Düzeltildi
- **Bir kenar çubuğu paneli açıldıktan sonra bölünmüş ekran bozuluyordu.** Bölünmüş ekran açıkken bir panel (Discord vb.) açmak, geri döndüğünüzde içerik alanını yarım genişlikte bir ızgarada takılı bırakıyordu — bölünmüş düzenin zorlanmış ızgarası panelin gizlenmesini geçersiz kılıyordu. Bir panel açmak artık önce bölünmeden temiz biçimde çıkıyor.
- **Bölünmüş ekran boş bir sağ panel gösteriyordu.** Bölünmüş ekran etkin sekmeyi "sıradaki" sekmeyle eşliyordu — ama diğer hemen her sekme canlı web görünümü olmadan uykuda, bu yüzden sağ taraf boş geliyordu. Artık bölmeden önce iki sekmeyi de uyandırıyor/gerçekleştiriyor; böylece iki panel de sayfalarını gerçekten gösteriyor.

### Eklendi
- **E-posta doğrulama kodlarını Gmail'inizden otomatik doldurun.** Bir site size e-postaladığı bir kod istediğinde ve bir Vex sekmesinde Gmail (web) açıksa, Vex kodu gelen kutunuzdan okuyup kod alanına dolduruyor — sekme değiştirmek, e-postayı açmak ve kopyalamak yok. Gmail sekmenizin öndeyken bile olması gerekmiyor: arka plandaysa ya da uykudaysa Vex onu öne getirmeden yerinde okuyor. Önemlisi, yalnızca *henüz gelmiş* bir kodu dolduruyor (e-postanın zaman damgasıyla eşleştirilerek); böylece önceki bir oturum açmadan gelen kutunuzda duran daha eski bir kod yanlışlıkla asla kullanılmıyor. *Yalnızca* zaten açık olan bir Gmail sekmesini okuyor (kayıtlı kimlik bilgisi yok, e-posta arka ucu yok), yalnızca gerçek bir tek kullanımlık kod alanını dolduruyor ve e-posta genellikle istediğinizden birkaç saniye sonra düştüğü için bir süre yeniden deniyor. Gerçek bir parolasız Spotify oturum açmasında uçtan uca doğrulandı. *(Uygulama tabanlı 2FA yine Kimlik Doğrulayıcı'yı kullanır.)*
- **Bölünmüş ekran artık 3 ve 4 panel yapıyor.** Klasik yan yana bölmenin ötesinde, **3 eşit sütuna** ya da **2×2 dörtlüye** bölün — komut paletini (Ctrl+K) açın ve "Split into 3 panes" / "Split into 4 panes" seçin. 2 panelli bölme sürüklenebilir ayırıcısını koruyor.
- **Bulut yapay zekâ kurulumunda artık kurulum sihirbazında düzgün bir anlatım var** — Vex Eşitleme adımıyla uyumlu: ne olduğu (kendi Cloudflare Worker'ınız + OpenRouter anahtarınız üzerinde Claude) ve çıplak bir "URL yapıştır" kutusu yerine 3 açık adım.
- **Vex 2FA kodlarınızı otomatik dolduruyor.** Bir sitenin kimlik doğrulayıcı uygulaması (TOTP) 2FA ekranında, Vex artık 6 haneli kodu doğrudan yerleşik Kimlik Doğrulayıcı'dan dolduruyor — paneli açıp okuyup yazmak yok. Yalnızca gerçek bir tek kullanımlık kod alanını dolduruyor (asla bir arama ya da promosyon kodu kutusunu) ve — önemlisi — bir kod yalnızca ait olduğu sitede girilir: eşleşme, hesabın düzenleyicisine karşı sitenin gerçek alan adıyla yapılır; bu yüzden benzer görünen/kimlik avı bir ana makine (örn. `github.com.evil.com`) hiçbir şey almıyor. Hesaplarınızı Kimlik Doğrulayıcı'ya ekleyin (QR'ı tarayın ya da anahtarı yapıştırın) ve 2FA yazmanız gereken bir şey daha olmaktan çıksın. *(Not: bu kimlik doğrulayıcı uygulaması kodları içindir — GitHub Mobile gibi, tasarım gereği telefonunuzu gerektiren telefon onayı istemlerini otomatikleştiremez.)*

## v4.64.3 (2026-08-29) — Tek tıkla Tor, Tor Browser gerekmez

_v2.29.9 olarak yayımlandı._

### Eklendi
- **Tor düğmesi artık Tor'u sizin için başlatıyor.** Önceden Tor Browser'ın (ya da bir tor hizmetinin) zaten çalışıyor olması gerekiyordu — aksi hâlde soğan düğmesi yalnızca gidip bir tane başlatmanızı söylüyordu. Artık Vex Tor'u kendisi çalıştırıyor: ilk kullanımda resmî Tor Expert Bundle'ı indirir (~15 MB, bir kez), arka planda `tor`'u başlatır ve **canlı ilerleme çubukları** gösterir — bir indirme çubuğu, sonra her önyükleme aşamasıyla bir "Tor ağına bağlanılıyor" çubuğu — ve tamamen bağlandığı anda (check.torproject.org üzerinden doğrulanarak) Tor sekmenizi kendiliğinden açar. Zaten Tor Browser/hizmeti çalışıyorsa onu kullanır (anında). Tor, Vex kapanınca kapanır.

## v4.44.3 (2026-08-29) — Gizlilik ve oturum açma cilası: daha güçlü reklam engelleyici, akıllı otomatik doldurma, geçiş anahtarı rahatsızlığı yok

_v2.29.8 olarak yayımlandı._

### Eklendi
- **Gizlilik Panosu** — Vex'in sizin için ne kadar engellediğini canlı gösteren yeni bir 🛡️ kenar çubuğu paneli: çalışan bir "bu oturumda engellenen istek" toplamı, birden çok sitede sizi izleyen siteler arası izleyiciler ve sıralı bir en çok suçlular listesi. Vex'in zaten yaptığı engellemenin salt okunur görünümü — hiçbir yeni şey bir yere gönderilmez.
- **Yalnızca HTTPS kipi** (Ayarlar → Gizlilik, varsayılan olarak kapalı). Bir sitenin şifreli https sürümünü her zaman önce dener. Bir sitede gerçekten https yoksa Vex yalnızca o site için http'ye geri döner (bir uyarıyla); böylece hiçbir şey bozulmaz — ve https üzerinden istediğiniz bir site asla sessizce düşürülmez.
- **Daha güçlü bir reklam engelleyici.** İki yükseltme: yerleşik engelleyici artık yalnızca reklam+izleme yerine *tam* filtre listesi kümesini (EasyList + EasyPrivacy ile Peter Lowe'unkiler, uBlock Origin filtreleri, kötü amaçlı yazılım/gizlilik/bozulma düzeltme/hızlı düzeltmeler ve rahatsız edici öğeler) kullanıyor — böylece ağ düzeyinde daha fazla reklam ve izleyici isteği engelleniyor. Ve Vex artık süreç içinde **kozmetik filtreleme** yapıyor: yalnızca ağ engellemesinin sayfada bıraktığı reklam *yuvalarını ve artık yer tutucuları* (ve durduramadığı birinci taraf reklam kutularını) her sitede, reklam engelleyici aç/kapat anahtarını izleyerek gizliyor.
- **Kimlik Doğrulayıcı: QR ekran görüntüsüyle hesap ekleyin.** Ekle formunda, bir 2FA QR kodunun ekran görüntüsünü tıklayın/sürükleyin/yapıştırın; Vex onu sizin için okur (yerel olarak çözülür, ağ yok) — artık "kodu elle gir" seçeneğini aramak yok. Elle giriş hâlâ var.
- **Üst araç çubuğunda Notlar düğmesi** (🧅 Tor düğmesinin yanında), böylece kenar çubuğunu açmadan bir tık uzakta. Kenar çubuğu Notlar düğmesi de kalıyor (yalnızca araç çubuğundakini istiyorsanız Ayarlar → Kenar çubuğu'nda gizleyin).
- **Kimlik Doğrulayıcı: kopyalamak için bir kodun herhangi bir yerine tıklayın.** Küçük kopyala düğmesini aramak yok — tüm satıra tıklayın (ya da Enter'a basın) ve 2FA kodu panonuzda, onaylamak için kısa bir parıltıyla.
- **Gizli sekmeler artık bir bakışta işaretli.** Tor ve kayıt dışı sekmeler hem sekme kenar çubuğunda hem de yatay/Glass şeridinde bir 🧅/🔒 rozeti ve ince bir mor kenar gösteriyor; böylece hangi sekmelerin kaydedilmediğini her zaman biliyorsunuz.
- **Otomatik doldurma artık oturum açma açılır pencerelerinde çalışıyor.** "Google/Discord/… ile oturum aç" küçük ayrı bir pencere açar; kayıtlı girişiniz artık orada da doluyor (ana otomatik doldurmayla aynı kimlik avına karşı güvenli, yalnızca gerçek oturum açma alanı mantığı).
- **Parolasız siteler için oturum açma e-postasını önceden doldurma.** Spotify gibi siteler sizi e-postalanan bir kodla oturum açtırır (kaydedilecek parola yok), bu yüzden tam otomatik doldurma hiç uygulanmıyordu. Vex artık bir oturum açma sayfasında yazdığınız e-postayı site başına hatırlıyor ve bir sonraki sefere önceden dolduruyor — böylece yalnızca kodu giriyorsunuz. Yalnızca e-posta, asla parola ve yalnızca gerçek bir oturum açma alanına (asla bir arama kutusuna).
- **Claude kenar çubuğu Google ile kendiliğinden oturum açıyor.** Claude paneli oturumu kapalı ekranını gösterdiğinde, Vex sizin için "Google ile devam et"e kendiliğinden tıklıyor (Google oturum açmasının gerçekten açılması için uygun bir kullanıcı hareketiyle). Claude paneline kapsamlı ve iptal edilen bir oturum açmanın döngüye girememesi için kısıtlı.
- **Oturum açma sırasında artık "Windows Güvenliği" geçiş anahtarı istemi yok.** Bir site (Google vb.) geçiş anahtarı istediğinde çıkan o yerel "Geçiş anahtarıyla oturum aç / Güvenlik anahtarınızı USB bağlantı noktasına takın" iletişim kutusu, güvenlik anahtarı kullanmıyorsanız bir sıkıntıdır. Vex artık geçiş anahtarı isteklerini reddediyor; böylece oturum açma parola/diğer yöntemlere dönüyor ve iletişim kutusu hiç görünmüyor. (Parola otomatik doldurma etkilenmiyor. Geçiş anahtarlarını geri *istiyorsanız* bu kapatılabilir.)

### Değişti
- **Ölü "Görünüm" ayarları bölümü kaldırıldı.** Vurgu rengi örnekleri renk temalarıyla çekişiyordu (ve temalar var olduktan sonra yararlı bir şey yapmıyordu) ve "Sekme kenar çubuğunu göster" anahtarı kenar çubuğunun kendi daraltma düğmesini yineliyordu. Görünüm çipi artık doğrudan gerçek görünüm denetimlerine (GUI Stili / Sekme Düzeni) atlıyor.
- **Tor sekmesi artık hemen kullanabileceğiniz bir arama sayfası açıyor.** Soğana tıklamak sizi Tor "denetim" sayfasına düşürüyordu ve bu çıkmaz sokak gibi geliyordu. Artık DuckDuckGo'yu açıyor (Tor üzerinden temiz çalışır — sizi CAPTCHA'larda boğan Google'ın aksine), böylece doğrudan aramaya başlayabilirsiniz. Arka plan denetimi hâlâ Tor'da olduğunuzu doğruluyor.

### Düzeltildi
- **Tor sekmeleri kayıtlı oturumunuza sızıyordu.** Tor üzerinden açılan bir sekme kalıcı olarak saklanıyor ve bir sonraki açılışta *normal* bir sekme olarak yeniden açılıyordu — özel olarak gezdiğiniz bir sayfayı gerçek bağlantınız üzerinden yeniden yüklüyor ve URL'sini kaydediyordu. Tor (ve kayıt dışı) sekmeler artık asla kaydedilmiyor — olması gerektiği gibi kapanınca yok oluyorlar.
- **Tor artık gerçekten Tor'da olup olmadığınızı söylüyor.** Tor'un bağlantı noktasının açık olduğunu bulmak Tor'un bağlanmayı bitirdiği anlamına gelmez. Vex artık sekmenin gerçekten Tor üzerinden yönlendirildiğini (check.torproject.org üzerinden) doğruluyor ve açık bir sonuç gösteriyor — başarıda "🧅 Bağlandı · çıkış IP'si …", ya da bağlantı noktası açık ama trafik henüz geçmiyorsa (hâlâ önyükleniyor) veya proxy hiç Tor değilse sade bir uyarı.
- **"Uyumasını engelle" sızdırıyordu.** Uyanık tuttuğunuz bir sekme, arka plandaki boşta hazırda bekletme taraması (yalnızca etkin/sesli/sabitlenmiş sekmeleri esirgiyor, uyanık tutulanları değil) tarafından yine de uyutulabiliyordu — ve ayar, geri yükleme kodu uyanık tut bayrağını sekmeye geri taşımadığı için Vex yeniden başlatıldığında tamamen düşüyordu. İkisi de düzeltildi: hazırda bekletme taraması artık uyanık tutmaya saygı gösteriyor ve ayar yeniden başlatmadan sağ çıkıyor (zamanlı bir "N saat uyanık tut" kalan süresiyle devam ediyor; "geri alınana kadar" siz kapatana kadar kalıyor). Uyanık tutulan bir sekmeyi işaretleyen **☕ rozeti** de bozuktu — stili yanlış CSS sınıfını hedefliyordu ve yalnızca uyanık tut menüsünü açtıktan sonra yükleniyordu; bu yüzden yeniden başlatmadan sonra hâlâ uyanık tutulan bir sekme rozet göstermiyor ve olmadığı hâlde devre dışı *görünüyordu*. Rozet artık açılışta hemen görünüyor, hem dikey hem yatay sekme çubuklarında.
- **Klavye kısayolu düzenleyicisi veremeyeceği yeniden bağlamaları vaat ediyordu.** Yirmi çekirdek kısayol (Yeni Sekme, Bul, Komut Çubuğu, Geçmiş, Sekmeyi Sessize Al, Kenar Çubuğunu Aç/Kapat, Tam Ekran, …) pencere katmanının derinlerinde işleniyor ve düzenleyicinin bağlaması danışılmadan önce tetikleniyor — bu yüzden onları "yeniden bağlamak" hiçbir şey yapmıyordu. Artık sabit **sistem** kısayolları olarak gösteriliyorlar (tuş yine çalışıyor, yalnızca yeniden atanamıyor); yeniden bağlanabilen kısayollar ise hâlâ bağlanabiliyor. Ve ölü bir tuş olan **Özel Pencere** kısayolu (Ctrl+Shift+N'si Notlar tarafından alınmıştı, bu yüzden Notlar'ı açıyordu) artık **Ctrl+Alt+N** üzerinde yaşıyor ve gerçekten özel bir pencere açıyor.
- **Hiçbir şey yapmayan üç persona düzenleyici ayarı kaldırıldı** — "Tercih Edilen Yapay Zekâ Arka Ucu", "Varsayılan sekme bağlamı" ve "Takip soruları öner" kaydediliyordu ama hiçbir şey tarafından okunmuyordu (yapay zekâ yönlendiricisi onları hiç almadı; takipler modelin yanıtından ve personanın kendi isteminden gelir). Her persona kartındaki yanıltıcı arka uç rozeti de kalktı. Sıcaklık, Hızlı İstemler ve geri kalanlara dokunulmadı.

## v4.13.2 (2026-08-28) — Daha temiz kenar çubuğu, temaya uyan Glass ve bir dalga düzeltme

_v2.29.7 olarak yayımlandı._

### Eklendi
- **Klavye kısayolları artık bir web sayfası odaktayken de çalışıyor.** Eskiden bir siteye tıkladığınız anda temel tarayıcı kısayolları hiçbir şey yapmıyordu; tarayıcıya yalnızca tam ekran/geliştirici araçları/sert yenileme ulaşıyordu. Artık **Ctrl+T** (yeni sekme), **Ctrl+W** (kapat), **Ctrl+L** (adres çubuğu), **Ctrl+Tab / Ctrl+Shift+Tab** (sekmeler arasında geçiş), **Ctrl+1–9** (sekmeye atla), **Ctrl +/−/0** (yakınlaştırma), **Ctrl+F** (bul) ve **Ctrl+D** (yer imi) her yerde çalışıyor. Web sayfalarının meşru olarak kullandığı uygulama kısayolları (Ctrl+B kalın, Ctrl+K hızlı geçiş) bilerek sayfaya bırakıldı.
- **Kenar çubuğu sade geliyor.** Varsayılan olarak yalnızca tarayıcı çekirdeği, uygulamalarınız, Notlar, Authenticator ve GitHub istatistikleri görünür; az kullanılan paneller (Sekme kuyruğu, RSS, Kitaplık, Ek açıklamalar, Recall, Yapay zekâ belleği, Zamanlamalar) kaldırıldı. Herhangi birini **Ayarlar → Kenar çubuğu** bölümünden tek tıkla geri getirebilir ya da istediğiniz zaman **Ctrl+K** ile açabilirsiniz.
- **Glass artık kurulum sihirbazında birinci sınıf bir seçenek** ve **Glass görünümü renk temanızı benimsiyor** — Crimson seçerseniz buzlu arayüz kırmızı, Emerald seçerseniz yeşil parlar; artık sabit bir çivit mavisi değil.

### Düzeltildi
- **Notlar kullanılamıyordu.** Bir not seçmek ya da oluşturmak hata veriyordu ve düzenleyici hiç dolmuyordu; panel yeniden tamamen çalışıyor.
- **Otomatik doldurma e-postanızı yanlış yerlere yazıyordu.** Discord’da “+ Rol ekle” seçicisine ve “Sohbet bul veya başlat” aramasına kayıtlı e-postanız yazılıyordu. Otomatik doldurma artık yalnızca gerçek oturum açma alanlarını doldurur (arama/açılır kutu alanlarını asla), önce e-postanın girildiği 2 adımlı olanlar dahil gerçek oturum açmalar ise yine dolar.
- **Sağ tık ve açılır menüler, web sayfasına tıkladığınızda kapanmıyordu.** Kenar çubuğu düğmesi menüsü, sekme menüsü, araçlar menüsü, uzantılar menüsü, medya/ses/serbest okuma açılır pencereleri ve daha fazlası artık herhangi bir yere ilk tıklamada kapanıyor.
- **Menüler web sayfalarının üzerinde kamufle oluyordu.** Sekme sağ tık menüsü ve adres çubuğu önerileri yarı saydamdı ve bir sitenin üzerinde okunması zordu; artık opak.
- **İndirmeler aynı adlı dosyaların üzerine sessizce yazıyordu.** İkinci bir `image.png`, ilkinin üzerine yazılıyordu; Vex artık ikisini de tutuyor (`image (1).png`).
- **Kurulum stili değiştirilince (Minimal ⇄ Tam) kenar çubuğu düğmeleri kayboluyor** ve geri gelmiyordu; artık geçiş her paneli geri getiriyor.
- **Pencere İçinde Pencere araç çubuğu düğmesi hiç düzgün çalışmadı.** Sayfadan tarayıcıya “burada bir video var” sinyali, `<webview>` sınırını aşamayan bir ileti kanalı kullanıyordu; bu yüzden araç çubuğundaki PiP düğmesinin göster/gizle işlemi hiç tetiklenmiyor ve tıklaması videoya ulaşamıyordu. Doğru webview IPC üzerinden yeniden bağlandı; düğme artık yalnızca etkin sekmede video olduğunda görünüyor ve yerel PiP’i başlatıyor. Ayrıca sayfa başına video taraması geciktirildi; böylece Discord gibi yoğun sitelerde artık işlemciyi yormuyor.
- **“Parola kaydedilsin mi?” yanlış kullanıcı adını önerebiliyordu** — 3 veya daha fazla karakterli bir metin alanına (arama kutusu, yorum) yazılan her şey oturum adı olarak hatırlanıyordu. Artık yalnızca gerçek kullanıcı adı/e-posta alanlarını hatırlıyor ve bunu oturum açma formuyla sınırlıyor.
- **Kayıtlı bir oturumu geri yüklemek tarayıcıyı donduruyordu.** Geçerli sekmeleri temizlerken son sekmeyi kapatmak otomatik olarak yenisini oluşturan bir döngüye giriyordu; bu yüzden “hepsini kapat” hiç bitmiyordu. Geri yükleme artık anında tamamlanıyor.
- **Başlangıç sayfası Glass kipinde temayla uyuşmuyordu.** Glass açıkken başlangıç sayfası, renk temasından bağımsız olarak sabit bir çivit/lacivert arka plan tutuyordu; bu yüzden Ruby gibi temalarda temalı arayüzle çatışıyordu. Artık rengini temadan alıyor ve pencerenin geri kalanıyla uyuşuyor.
- **Zamanlanmış görevler bir dakikaya kadar erken çalışıyor ve atlanabiliyordu.** Günlük/haftalık/aylık görevler artık zamanlarında çalışıyor (yaklaşık 60 sn önce değil) ve bilgisayar uykudayken kaçırılan bir görev, siz döndüğünüzde (en fazla 6 saat gecikmeyle) sessizce atlanmak yerine çalışıyor.
- **Yapay zekâ sohbeti kilitlenebiliyordu.** Yanlış bir yerde oluşan bir hata, panelin sonsuza kadar göndermeyi reddetmesine yol açabiliyordu; artık her zaman toparlanıyor.
- **PiP düğmesi artık sekme değiştirdiğinizde yenileniyor** (önceki sekmeden kalma eski bir durumu gösterebiliyordu).
- **Ajan kipi:** bir sayfada birkaç alanı doldurmak artık “takıldı” diye yarıda kesilmiyor ve ajanın yazma/seçme eylemleri artık her zaman “tamam” demek yerine gerçek başarı/başarısızlığı bildiriyor.
- **Okuma Modu bir sekmeyi tuzağa düşürebiliyordu.** Okuma Modu’na girip sonra yeniden başlatmak (ya da sekmeyi bir oturumdan geri yüklemek), sekmeyi gerçek sayfaya dönüş yolu olmadan makale anlık görüntüsünde bırakıyor ve geçmişinize devasa bir anlık görüntü adresi dolduruyordu. Okuma Modu artık olduğu gibi geçici bir görünüm olarak ele alınıyor; sekme gerçek sayfasını koruyor ve geçmiş temiz kalıyor.
- **Geri yüklenen sekme yığınları artık kaybolmuyor**, sekme sürükleyerek yeniden sıralama beklediğiniz yere bırakıyor ve çok büyük indirmeler (≥1 TB) doğru boyut birimini gösteriyor.
- **Artık favicon takibi yok.** Vex, site simgelerini sekme şeridi, geçmiş, yer imleri, Recall, Sonra Oku, kenar çubuğunun sabitlenmiş siteleri, başlangıç sayfası hızlı erişimi ve daha fazlasında Google’dan (`google.com/s2/favicons`) çekiyordu; bu da sekmelerinizdeki, geçmişinizdeki ve yer imlerinizdeki her alan adını Google’a sessizce bildiriyordu. Bunların hepsi artık sitenin kendi birinci taraf favicon’unu kullanıyor. Gezinmenizle ilgili hiçbir şey Google’a gitmiyor.
- **Daha küçük düzeltmeler:** adres çubuğunda Yukarı Ok artık son öneriye ulaşıyor; komut paleti artık yinelenen bir “Geçmiş” göstermiyor; bir sekmeyi yığına sürüklemek artık onu yanlış yere koymuyor; açık sekmelerde tam metin geçmiş dizinleme yeniden çalışıyor; sekme kenar çubuğu anahtarı basılı durumunu gösteriyor; zararsız bir gezinme hatası artık konsolu doldurmuyor; ve Discord yazım denetimi değiştirmesi daha güvenilir.

## v3.80.1 (2026-08-27) — Daha güvenli DRM ayarları + derleme koruması

_v2.29.6 olarak yayımlandı._

### Düzeltildi
- **Sağlıklı bir DRM bileşeninde görünen “DRM’yi sıfırla” düğmesi kaldırıldı.** Ayarlar → Hakkında, Widevine çalışırken bile bir sıfırlama sunuyordu; sağlıklı bir bileşeni sıfırlamak yıkıcıdır (onu temizler ve yeniden indirir, sonra Vex’i yeniden başlatır) ve yanlış bir teşhise dayanıyordu. Düğme artık yalnızca DRM bileşeni gerçekten yüklenemediğinde, “Yeniden dene” etiketiyle ve önce bir onay istenerek görünüyor.

### Değişti
- **Derlemeler artık paketlenmiş uygulamanın Doğrulanmış Medya Yolu (VMP) imzasını denetliyor ve geçersizse iptal ediliyor** — bir derlemenin bir daha asla bozuk Spotify/Netflix/Prime DRM göndermesini engelleyen, hata durumunda kapanan bir koruma (2.29.5 öncesi bozulmanın nedeni). 2.29.5 `afterSign` düzeltmesinin üzerine ek bir güvence.

## v3.79.6 (2026-08-27) — DRM oynatma gerçekten düzeltildi (geçerli VMP imzası)

_v2.29.5 olarak yayımlandı._

### Düzeltildi
- **Spotify, Netflix, Prime Video, Disney+ — tüm DRM oynatma başarısız oluyordu (parçalar atlıyor / “şu anda çalınamıyor” / video başlamıyor).** Gerçek neden uygulama kodu değil, bir paketleme hatasıydı. Vex’in Widevine Doğrulanmış Medya Yolu (VMP) imzalaması, electron-builder’ın `afterPack` kancası olarak çalışıyordu; bu kanca Authenticode kod imzalamasından *önce* tetiklenir; yani geçerli bir VMP imzası uygulanıyor ve Authenticode `Vex.exe`’yi yeniden yazdığında hemen geçersiz kılınıyordu. Yayımlanan derlemeler, castLabs’in kendi doğrulayıcısının reddettiği bir imza taşıyordu (`InvalidSignature`); bu yüzden akış hizmetlerinin lisans sunucuları Widevine lisansını reddediyordu (Spotify HTTP 403 döndürüyordu: ses iniyordu ama şifresi çözülemiyordu, bu yüzden her parça otomatik olarak sonrakine atlıyordu; Netflix/Prime/Disney+ aynı şekilde başarısız oluyordu). İmzalayıcıyı `afterSign` kancasına taşıyarak düzeltildi; böylece VMP imzalaması ikili dosyaya dokunan son adım oluyor ve imza geçerli kalıyor. Bu, 2.29.2 ve 2.29.4 denemelerinin yerini alıyor; onlar tek tek Spotify parçalarının belirtilerini ele alıyordu, oysa geçersiz imza asıl nedendi ve yalnızca bir alt kümeyi değil, korumalı *tüm* oynatmayı etkiliyordu.

## v3.74.6 (2026-08-26) — Spotify oynatma: gerçek düzeltme (donanım DRM)

_v2.29.4 olarak yayımlandı._

### Düzeltildi
- **Bir parça alt kümesinde “Spotify şu anda bunu çalamıyor” — bu sefer gerçekten düzeltildi.** Başarısız olan parçalar Chrome’da sorunsuz çalıyor; yani bu hiçbir zaman bir Spotify kısıtlaması değildi: Chrome donanım destekli Widevine şifre çözmeyi varsayılan olarak etkinleştirir, Electron etkinleştirmez; bu yüzden Vex yalnızca temel yazılım dayanıklılığı sunuyordu (SW_SECURE_CRYPTO) ve daha fazlasına ihtiyaç duyan parçalar başarısız oluyordu. Vex artık `HardwareSecureDecryption` özelliğini etkinleştiriyor; bu, MediaFoundation Widevine CDM’yi devreye sokar — imzalı bir derlemede SW_SECURE_DECODE’un ve tüm donanım dayanıklılık düzeylerinin açıldığı doğrulandı. Donanım DRM’si olmayan makinelerde otomatik olarak yazılıma geri döner, bu yüzden onlarda gerilemeye yol açamaz. (2.29.2’deki dayanıklılık yeniden denemesi belirtiyi ele alıyordu; bu ise nedeni çözüyor. Ek olarak Netflix/diğer DRM videoları artık HD/donanım yollarını da kullanabiliyor.)

## v3.72.1 (2026-08-26) — Yazım denetimi düzeltmesi Discord’da kalıcı oluyor

_v2.29.3 olarak yayımlandı._

### Düzeltildi
- **Discord yazma alanında sağ tık “kelimeyi düzelt” geri alınıyordu.** Bir yazım önerisine tıklamak kelimeyi değiştiriyordu, ancak yanına tıklayıp yazar yazmaz yanlış yazılmış kelime geri geliyordu. Discord’un düzenleyicisi (Slate.js) kendi modelini tutar ve DOM’u ona göre uzlaştırır; Vex’in menüsüne tıklamak odağı Discord çerçevesinden aldığı için değişiklik Slate’in modeline hiç ulaşmıyordu. Vex artık değiştirmeden önce çerçeveye yeniden odaklanıyor ve kelimeyi yeniden seçiyor; böylece düzeltme kaydediliyor ve kalıcı oluyor. Düz giriş alanları ve diğer düzenleyiciler (örn. Claude) etkilenmez.

## v3.71.1 (2026-08-26) — Claude bildirim hatası bastırıldı

_v2.29.2 olarak yayımlandı._

### Düzeltildi
- **Bazı Spotify parçaları “Spotify şu anda bunu çalamıyor” gösteriyordu.** Spotify, bir parça alt kümesi için Electron’un DRM’sinin sağladığından (SW_SECURE_CRYPTO) daha yüksek bir Widevine dayanıklılığı (SW_SECURE_DECODE) istiyor; bu yüzden bu parçalar başarısız olurken geri kalanı çalıyordu. Vex artık başarısız olan DRM müzakeresini desteklediği düzeyde yeniden deniyor; böylece bu parçalar çalıyor. (Yalnızca ilk istek başarısız olduğunda devreye girer; çalışan oynatmayı asla zayıflatmaz.)
- **Claude panelinde “Anlık bildirimler etkinleştirilirken bilinmeyen bir hata oluştu”**, 2.29.1’in Push API’yi kaldırmasından sonra bile sürüyordu — claude.ai bildirim anahtarını Notification API’ye göre gösterip ardından hiçbir Electron tarayıcısının karşılayamayacağı bir anlık bildirim aboneliği deniyordu. Vex artık claude.ai’de bildirimleri kullanılamaz olarak bildiriyor; böylece hata yerine normal bir “bildirimler engellendi” durumu gösteriyor. (Web Push, Electron’un doğal bir sınırlamasıdır; bunun bir parçası olarak claude.ai’den gelen ön plan bildirimleri devre dışı bırakıldı.)

## v3.69.1 (2026-08-26) — Parola kaydetme, anlık bildirim ve ilk çalıştırma düzeltmeleri

_v2.29.1 olarak yayımlandı._

### Eklendi
- **Modern oturum açmaları gerçekten yakalayan parola kaydetme.** Vex artık bir düğme + JavaScript ile gönderen sitelerde (Spotify, Google, çoğu uygulama) ve çok adımlı önce e-posta sonra parola akışlarında oturum açma bilgilerinizi kaydetmeyi öneriyor; yalnızca eski tarz form gönderimlerinde değil. Kayıtlı oturumlar geri döndüğünüzde otomatik doluyor ve **boş bir oturum açma alanına tıklamak kayıtlı verileri geri getiriyor** (tıkla-doldur). Kenar çubuğu panelleri (Spotify, WhatsApp, Claude…) da artık kaydetme + otomatik doldurma özelliğine sahip; daha önce yoktu.

### Düzeltildi
- **Claude panelinde (ve diğer sitelerde) “Anlık bildirimler etkinleştirilirken bilinmeyen bir hata oluştu”.** v2.29.0 Push API’yi reddeden bir nesneyle taklit etmişti, ancak siteler anlık bildirimi `pushManager`’ın var olup olmadığına bakarak algılıyor; bu yüzden yine deneyip hata alıyorlardı. Vex artık Web Push yüzeyini tamamen kaldırıyor ve anlık bildirimi olmayan bir tarayıcıyı (eski Safari gibi) taklit ediyor; her büyük site bunu, anlık bildirimi hiç sunmayarak sorunsuz biçimde ele alıyor. Normal bildirimler etkilenmez.
- **Yeni bir kurulumda iki karşılama ekranı.** Kurulum sihirbazı ve eski bir karşılama kartı aynı anda görünüyordu. Sihirbaz artık tek ilk çalıştırma karşılaması; “Tura çık” son adımına taşındı.

### Değişti
- **Google oturum açma için daha fazla sağlamlaştırma.** userAgentData düzeltmesine ek olarak Vex artık Google sayfalarında tam dolu bir `window.chrome` (runtime/app/csi/loadTimes) sunuyor; böylece tarayıcı parmak izi gerçek Chrome ile daha eksiksiz eşleşiyor.

## v3.64.3 (2026-08-25) — Vex’inizi seçin karşılaması, sekme sürükleyerek yeniden sıralama ve uzun süredir bekleyen bir yığın düzeltme

_v2.29.0 olarak yayımlandı._

### Eklendi
- **“Başlangıç noktanızı seçin”** — Karşılama’nın hemen ardından gelen yeni bir sihirbaz adımı. **The Mortuex Setup** (her şey açık, Vex’in yaratıcısının kullandığı haliyle), **Minimal** (temiz bir tarayıcı — uygulama paneli yok, boş kısayol çubuğu), **Özel** (panel ve kısayol başına onay kutuları ile bir Glass anahtarı) ya da **Paylaşılan bir kurulum kullan** (bir kurulum kodu yapıştırın) seçeneklerinden birini seçin. Her kartın görsel bir önizlemesi vardır; her seçim Ayarlar → Kenar çubuğu’ndan geri alınabilir.
- **Paylaşılabilir kurulum kodları** — tüm kurulumunuzu (paneller, kısayollar, tema, Glass/Klasik) sihirbazdan bir `VEXSETUP1.` kodu olarak dışa aktarın; herkes bunu kendi sihirbazına yapıştırabilir ve Vex kendini buna uygun düzenler. Kodlar canlı doğrulanır ve içe aktarılırken temizlenir.
- **Sekmeleri sürükleyerek yeniden sıralayın** — üst şeritteki sekmeleri her tarayıcıdaki gibi basılı tutup sürükleyin: bir ekleme çizgisi sekmenin nereye ineceğini gösterir, bir gruba bırakmak sekmeyi gruba katar, sabitlenmiş bölgeye sürüklemek sabitler ve bir sekmeyi yığından çekmek yığın kayıtlarını bozmadan korur.
- **Dağınıklığı azaltma önerisi** — kurulumdan iki hafta sonra, birkaç uygulama paneli hiç açılmadıysa Vex bunları gizlemeyi önerir (bir kez, kapatılabilir).
- **Günlük hikmet, sizin istediğiniz gibi** — başlangıç sayfasındaki günlük ayet artık bir seçim: Kur’an (Türkçe veya İngilizce), İncil, Tanah, filozoflardan ve yazarlardan seküler sözler ya da tamamen kapalı. İncil/Tanah/sözler, derlenmiş yerel kümeler arasında dönüşümlü gelir; ağ gerekmez.
- **Başlangıç sayfası dili** — İngilizce veya Türkçe; karşılama, etiketler, arama yer tutucusu ve günlük ayeti kapsar (arayüzün tamamının çevirisi yol haritasında).
- **Düzenlenebilir alanlardaki sağ tık menüleri artık Kes / Kopyala / Yapıştır / Tümünü seç sunuyor**; üstte yazım denetimi önerileri var.

### Düzeltildi
- **Google oturum açma Vex’i reddediyordu** (“Bu tarayıcı veya uygulama güvenli olmayabilir”) — sayfanın görebildiği `navigator.userAgentData`, taklit edilen UA’nın iddia ettiği “Google Chrome” markasından yoksundu; kapsamı sınırlı bir site ayarı bunu ekliyor ve gerçek Chromium derlemesiyle sürüm bakımından tutarlı kalıyor.
- **Sekmeler her sekme değişiminde küçülüyor ve şeridi artık kaplamıyordu** — boyut sınıflandırıcı, sınıfın zorladığı kendi genişliklerini geri ölçüyordu (tek yönlü bir cırcır) ve `very-narrow` sekmeler 40 piksele kilitlenmişti. Boyutlandırma artık kullanılabilir genişlikten hesaplanıyor, sekmeler çubuğu her zaman dolduruyor ve eski kaydırma konumları sınırlanıyor.
- **“Anlık bildirimler etkinleştirilirken bilinmeyen bir hata oluştu”** — Electron Web Push’u karşılayamaz, ancak API’yi duyuruyordu; bu yüzden siteler her zaman başarısız olan bir aboneliğe giriyordu. Push API artık özellik algılamadan gizleniyor ve doğrudan `subscribe()` çağıranlar çökme yerine temiz, Chrome benzeri bir `NotAllowedError` alıyor. Normal bildirimler çalışmaya devam ediyor ve Windows bildirimleri artık her çalıştırmada görüntüleniyor (AppUserModelID başlangıçta ayarlanıyor).
- **Kenar çubuğu uygulama panellerinde sağ tık hiçbir şey yapmıyordu** (Discord, Claude, Spotify, WhatsApp…) — menü bağlantısı hiç var olmayan bir `window` özelliğine dayanıyordu. Paneller artık tam Vex bağlam menüsünü alıyor.
- **Yazım denetimi hiç gerçekten çalışmadı** — hiçbir Hunspell sözlüğü indirilmemişti ve oturumlar hiç yapılandırılmamıştı. Oturumlar artık açık diller alıyor ve en-US sözlüğü ana işlemden kuruluyor (oturum başına vekillerden etkilenmez); böylece yanlış yazılmış kelimeler Discord paneli dahil her yerde kırmızı dalgalı çizgi ve sağ tık önerileri alıyor.
- **Eşitleme durumu var ama yapılandırılmış bir çalışan URL’si yokken açılışta `file:///C:/sync/...` konsol gürültüsü** — tüm eşitleme uç noktaları artık yapılandırılmamışsa temiz biçimde vazgeçiyor.
- **“Yenilikler”, çevrimiçi kullanıcılara “Sürüm notları yüklenemedi (çevrimdışı mı?)” gösteriyordu** — sürüm notları artık uygulamanın içine paketlenmiş değişiklik günlüğünden geliyor (ağ yok, hız sınırı yok); GitHub yalnızca son çare olarak kullanılıyor.

## v3.35.7 (2026-07-08) — Kenar çubuğu anahtarı: artık artakalan şerit yok

_v2.28.1 olarak yayımlandı._

### Düzeltildi
- **Sol kenar çubuğunu kapatmak (Ctrl+B) arkada boş renkli bir şerit bırakıyordu.** Anahtar yalnızca rayın genişliğini sıfırlıyordu; kendi kenar boşluğu, iç boşluğu ve kenarlığı kalıyordu ve Glass GUI stilinin sabit 46 piksellik ray genişliği daralmayı tamamen geçersiz kılıyordu. Ray artık hem Klasik hem Glass stilinde hiçliğe kadar daralıyor ve sayfa/webview’lar (kenar çubuğu site panelleri dahil) pencerenin tüm genişliğini kullanacak şekilde yeniden akıyor.

## v3.34.7 (2026-07-07) — Electron 42 (Chromium 148) + medya sağlığı sağlamlaştırması

_v2.28.0 olarak yayımlandı._

### Değişti
- **Electron 30.5.1 → 42.5.2 sürümüne yükseltildi (castLabs, Widevine)** — Chromium 124 → 148 olarak atlıyor; iki yıllık güvenlik yamaları, codec/GPU düzeltmeleri ve web platformu özellikleri geliyor. Doğrulandı: tüm test paketi, duman önyüklemesi, Widevine CDM başlatma (4.10.3050.0) ve site ayarı enjeksiyonlarının hepsi yeni çalışma zamanında geçiyor.
- **Site başına sayfa yamaları artık tek bir kayıt defterinde duruyor** (`src/site-tweaks.js`); webview preload’undaki elle yazılmış bloklar yerine. Discord her zaman görünür taklidi ve HEVC maskesi bir tablodaki girdiler (ana bilgisayar deseni + ana dünya kodu + enjeksiyon mekanizması), birim testinden geçiyor ve kendi preload’ı olarak kaydediliyor — webview preload’ları korumalı alanda çalıştığı için kayıt defteri ana preload’dan `require` edilemez (doğrulandı: yerel bir require orada sessizce hiç yüklenmiyor).

### Eklendi
- **Medya çözme hataları artık görünür kılınıyor.** Konuk sayfalar medya hata olaylarını ve donmuş çözme imzasını (oynatma süresi ilerliyor, yeni çözülmüş kare sıfır — TikTok HEVC hatasının hiçbir hata olayı olmadan tam olarak böyle ortaya çıkması) ana bilgisayara bildiriyor; o da bunları sayfa URL’sine karşı günlüğe kaydediyor ve oturum başına bir kez bir bildirim gösteriyor. Bir sonraki codec hatası, hislere dayalı bir tarif yerine konsoldan teşhis edilecek.
- **HEVC maskesi Instagram’a genişletildi** — Reels, H.265’i TikTok ile aynı şekilde sunuyor ve donanım HEVC çözmenin bozuk olduğu GPU’larda aynı donmuş kare hatası görülüyor; Instagram artık H.264’e de geri dönüyor (canlı doğrulandı: HEVC yoklamaları reddedildi, H.264 sağlam).
- **Tek komutla sürümler** — `node scripts/release.js <version> "<title>"` DEĞİŞİKLİK GÜNLÜĞÜ girdisinin var olduğunu doğrular, sürümleri artırır, yalnızca sürüm dosyalarını işler, gönderir, GitHub sürümünü derler + yayımlar ve web sitesinin sürüm rozetini günceller; böylece depo, sürüm ve web sitesi artık birbiriyle çelişemez.

## v3.27.2 (2026-07-07) — TikTok: videolar artık ilk karede donmuyor

_v2.27.23 olarak yayımlandı._

### Düzeltildi
- **TikTok videoları ses çalmaya devam ederken tek bir donmuş kare gösteriyordu.** TikTok, tarayıcıyı HEVC/H.265 desteği için yoklar ve tarayıcı evet derse `bytevc1` (H.265) akışlarını sunar — Electron’un codec yoklamaları “evet” yanıtını verir (platform HEVC yolu var), ancak gerçek donanım çözme başarısız olur; bu yüzden yalnızca ilk anahtar kare çiziliyordu. Vex artık HEVC’yi TikTok’un codec yoklamalarından gizliyor (`MediaSource.isTypeSupported`, `canPlayType`, `mediaCapabilities.decodingInfo`); böylece TikTok her yerde çözülen H.264’e geri dönüyor. tiktok.com ile sınırlı; TikTok’un CSP’si satır içi betik enjeksiyonunu engellediği için `webFrame.executeJavaScript` ile enjekte edilir.

## v3.24.7 (2026-07-04) — Discord paneli: artık rastgele yeniden yüklenme yok

_v2.27.22 olarak yayımlandı._

### Düzeltildi
- **Discord paneli, başka bir sekmeye geçip geri döndüğünüzde rastgele yeniden bağlanıyor ve yükleme ekranına düşüyordu.** Paneli gizlemek (`display:none`) Sayfa Görünürlüğünü “gizli”ye çeviriyordu; bu yüzden Discord ağ geçidi WebSocket’ini kapatıyor ve devam edemediğinde tam bir yeniden yükleme yapıyordu. Vex artık Discord konuğunu her zaman görünür olarak bildirmeye devam ediyor (Sayfa Görünürlüğü API’si taklit ediliyor, yalnızca Discord ile sınırlı); böylece sekme geçişlerinde yükleme ekranı parlaması olmadan bağlı kalıyor.

## v3.16.2 (2026-06-19) — Özellik paketi: satır içi yapay zekâ düzenlemeleri, bağlantı ipuçları, akıllı recall ve daha fazlası

_v2.27.21 olarak yayımlandı._

### Eklendi
- **Satır içi yapay zekâ metin düzenlemeleri** — düzenlenebilir herhangi bir alanda metin seçin; seçim çubuğu artık **✍️ Yeniden yaz / ✓ Düzelt / ✂️ Kısalt** sunar; bunlar metni dönüştürüp yerine geri yazar (salt okunur Açıkla/Özetle/Çevir, herhangi bir seçim için hâlâ orada).
- **Klavye bağlantı ipuçları** — bir sayfada **`f`** tuşuna basın; her bağlantı/düğme üzerinde harf etiketleri belirir, tıklamak için etiketi yazın. **Shift+F** bir bağlantıyı yeni sekmede açar, **Esc** iptal eder. `vex.linkHints` ayarıyla açıp kapatın (varsayılan açık).
- **Tor sekmesi** — sağ üst araç çubuğunda yeni bir 🧅 soğan düğmesi (ve komut çubuğunda “Yeni Tor Sekmesi”) azami güvenlikli özel bir sekme açar: tamamen yerel bir Tor SOCKS5 vekili üzerinden, uzak DNS ile (sızıntı yok) yönlendirilen, bellekte tutulan tek kullanımlık bir oturum; **WebRTC devre dışı**, tüm site izinleri reddedilir ve parmak izi direnci vardır. Tor’un yerelde çalışıyor olması gerekir (9150 numaralı bağlantı noktasında Tor Browser veya 9050’de bir tor hizmeti); algılanmazsa Vex başlatmanız için sizi yönlendirir ve doğrulamak için check.torproject.org’u açar.
- **Yeni Kimlik sekmesi** (komut çubuğu) — çerezlerin/depolamanın kapanınca yok olduğu, tamamen yalıtılmış tek kullanımlık bir oturum açar; taze döndürülmüş, kendi içinde tutarlı bir Chrome parmak izi vardır. Sabit kapsayıcıların aksine siteler onu oturum açmalarınızla ilişkilendiremez.
- **Akıllı Recall** — Recall panelinde bir **✨ Akıllı arama** anahtarı var: yapay zekâ doğal dil sorgunuzu ilgili terimlere genişletir ve tam metin sonuçlarını birleştirir; böylece bir sayfayı *anlamına* göre bulabilirsiniz. (Çalıştırmak için Enter’a basın; yeni bağımlılık yok.)
- **Beni Güncelle** (komut çubuğu) — en yeni RSS öğelerinizin + okunmamış Sonra Oku’nun yapay zekâ özeti; kaynak makaleler doğrudan açmanız için listelenir.
- **Çalışma Alanı Zaman Yolculuğu** (komut çubuğu) — her çalışma alanının açık sekmelerinin anlık görüntüsünü her 10 dakikada bir (ve isteğe bağlı olarak) otomatik alır; geçmiş herhangi bir sekme kümesini yıkıcı olmadan yeni sekmeler olarak geri yükleyin.

### Değişti
- **Çerez bannerlarını otomatik reddet** — onay engelleyici artık yalnızca bannerı gizlemek yerine büyük CMP’lerde (OneTrust, Cookiebot, Didomi, Usercentrics, Quantcast, Google FC…) “Tümünü reddet”e etkin olarak tıklıyor; böylece vazgeçme gerçekten kaydediliyor.

### Düzeltildi
- **Discord yayın açılır penceresi** — artık boyutunu/konumunu hatırlıyor ve pencere içinde pencere tarzında yüzüyor (**Ctrl+Shift+P** üstte sabitlemeyi açıp kapatır). Önemlisi, açılır pencere tam ekranken her zaman üstte **otomatik olarak bırakılıyor**; böylece **Alt+Tab çalışıyor** (önceki sabitleme düzeyi uygulama geçişini tıkıyordu).

## v3.11.2 (2026-06-19) — Discord paneli: dönüşte donma yok + çalışan yayın açılır penceresi

_v2.27.20 olarak yayımlandı._

### Düzeltildi
- **Discord paneli, onu kapattığınızda (Discord düğmesine yeniden tıkladığınızda) ya da başka bir sekmeye geçip geri döndüğünüzde birkaç saniye donuyordu.** Paneli gizlemek konuğu `display:none` yapar ve Electron’un varsayılan arka plan kısıtlaması Chromium’un sayfayı askıya almasına izin veriyordu; bu yüzden dönüşte ağır Discord SPA’sı boyanmadan önce ağ geçidine yeniden bağlanmak ve kısıtlanmış zamanlayıcıları yeniden oynatmak zorundaydı. Discord panelinin webview’ı artık `backgroundThrottling=no` ile çalışıyor; böylece gizliyken canlı kalıyor ve anında yeniden gösteriliyor. (Yalnızca Discord ile sınırlı; diğer paneller pil tasarrufu için varsayılan kısıtlamayı korur.)
- **Discord “Açılır pencere” (bir arkadaşın ekran paylaşımını / yayınını izleme) sıkışık bir önizlemede açılıyordu;** burada **Tam Ekran hiçbir şey yapmıyordu** ve **“Sekme olarak aç” boş bir sekme yüklüyordu**. Açılır pencere Discord’dan gelen betikli bir `window.open` olduğu için Peek kimlik doğrulama açılır penceresi kartı gibi giydirilmişti (bu, `fullscreenable: false` zorlar ve yayını bozan bir “Sekme olarak aç” çubuğu ekler). Discord açılır pencereleri artık Discord oturumuna sabitlenmiş **normal yeniden boyutlandırılabilir, tam ekran yapılabilir bir pencere** olarak açılıyor; tam ekran çalışıyor ve bozuk çerçeve çubuğu gitti.

## v3.7.7 (2026-06-19) — Sekme başına “Uykuya geçmesini engelle”

_v2.27.19 olarak yayımlandı._

### Eklendi
- **Bir sekmeye sağ tıklayın → ☕ Uykuya geçmesini engelle** — onu ne kadar uyanık tutacağınızı seçin: **1 / 5 / 12 / 24 saat, Özel… veya Asla (geri alınana kadar)**. Uyanık tutulan sekmeler otomatik uyku + bellek baskısı korumasının dışında kalır, küçük bir ☕ işareti gösterir ve ayar yeniden başlatmalarda kalıcıdır. Elle “Sekmeyi uyut” hâlâ çalışır (onu geçersiz kılar). Değiştirmek ya da “Uykuya yeniden izin ver” demek için menüyü yeniden açın.

## v3.5.7 (2026-06-19) — Acil düzeltme: Discord paneli boş görünüyordu

_v2.27.18 olarak yayımlandı._

### Düzeltildi
- **Discord paneli v2.27.17’de yalnızca üstü gösterip altında boş kalıyordu** — yeni geri/ileri çubuğu paneli bir esnek sütuna dönüştürdü, ancak `showPanel` panelin görüntüsünü satır içi ayarlıyor; bu yüzden düzen hiç uygulanmadı ve webview çöktü. Gezinme düğmeleri artık **panelin üzerinde yüzüyor** (webview hiçbir zaman yeniden boyutlandırılmıyor).

## v3.3.2 (2026-06-19) — Sekmelerde Discord girişi + panel geri/ileri

_v2.27.17 olarak yayımlandı._

### Eklendi
- **Discord, bypass sayesinde normal sekmelerde çalışıyor** — Discord bypass açıkken `discord.com` / `discord.gg` / `discordapp.com` artık normal sekmelerde de bunun üzerinden yönleniyor (bir PAC betiği ile; geri kalan her şey doğrudan kalır). Sansürlü ağlarda takılı kalan **OAuth “Discord ile giriş yap”** yetkilendirme sayfasını ve “Discord’da aç” bağlantılarını düzeltir. (Yalnızca TCP — ses için hâlâ Zapret gerekir.)
- **Discord panelinde geri / ileri / yenile çubuğu** — web Discord’da masaüstü uygulamasının geçmiş düğmeleri yok; bu yüzden panelde artık ince bir gezinme çubuğu var (Klasik + Glass için temalı).

## v3.0.7 (2026-06-18) — “Yenilikler”, sürümü açtığınızda kapanıyor

_v2.27.16 olarak yayımlandı._

### Düzeltildi
- “Yenilikler” penceresi artık “GitHub’da son sürümü görüntüle”ye tıkladığınızda **otomatik olarak kapanıyor** (sürüm tarayıcınızda açılıyor, bu yüzden pencereyi açık tutmanın bir nedeni yok).

## v3.0.2 (2026-06-18) — “Yenilikler” son sürümü tarayıcınızda açıyor

_v2.27.15 olarak yayımlandı._

### Düzeltildi
- Güncelleme günlüğü penceresindeki **“GitHub’da görüntüle”** bağlantısı artık **son sürümü** **sistem tarayıcınızda** açıyor (böylece GitHub düzgün görüntülenir); stil sayfasının yüklenemeyip çıplak bir gezinme menüsü gösterebildiği uygulama içi pencere yerine.

## v2.99.4 (2026-06-18) — Glass kısayol çubuğu (favicon’lar + özel) ve pencere gösterme düzeltmesi

_v2.27.14 olarak yayımlandı._

### Eklendi
- **Glass kısayol çubuğu yükseltmesi** — her kısayol artık sitenin **gerçek favicon’unu** (harf rozeti yedeği), bir **＋ Kısayol ekle** düğmesini ve **herhangi bir kısayola sağ tık → ad / bağlantı / renk düzenle ya da sil** özelliğini gösteriyor. Özel kısayollar kalıcıdır.

### Düzeltildi
- **Pencere bazen görev çubuğunda açılıp hiç öne çıkmıyordu** — saydam/çerçevesiz pencere artık gizli oluşturuluyor ve yalnızca boyandıktan sonra gösteriliyor (bir güvenlik yedeğiyle); boş/odaklanamayan açılışı düzeltir.

## v2.97.9 (2026-06-18) — Glass GUI, Discord ses/ekran paylaşımı, Roblox paneli, güncelleme günlükleri

_v2.27.13 olarak yayımlandı._

### Eklendi
- **Yeni “Glass” GUI Stili** (Ayarlar → GUI Stili) — tek tıkla geçtiğiniz tüm arayüz görünümü: **sekmeler üste taşınır**, adres çubuğunun altında Chrome/Firefox tarzı bir **kısayol çubuğu** belirir, pencere denetimleri sekme satırına taşınır ve arayüz + ana sayfa yumuşak bir parıltıyla **buzlu cama** dönüşür. Kendi içinde tam bir palet (renk temalarınızdan bağımsız); Klasik varsayılan olarak kalır.
- **Discord ses artık kulaklığınızı yakalıyor** — mikrofon girişi *ve* çıkış/cihaz seçimi Discord panelinde çalışıyor (medya izni, daha önce hiç görünmeyen bir istemle engellenen özel Discord oturumu için otomatik veriliyor).
- **Ekran paylaşımı / Canlı Yayın** — `getDisplayMedia` için, sistem sesi geri döngüsü dahil, düzgün bir “Neyi paylaşacağınızı seçin” seçicisi (küçük resimli ekranlar + pencereler).
- **Roblox bir kenar çubuğu paneli olarak** — `roblox.com`’u Discord gibi temiz bir panel olarak açar (eski Roblox Hub’ın yerine), sansürlü ağlar için Discord’un ByeDPI’sini paylaşan bir **🛡️ Engel bypass** anahtarıyla.
- **Güncelleme günlükleri (“Yenilikler”)** — Vex otomatik güncellendikten sonra bir pencere, o sürümün notlarını doğrudan GitHub sürümünden çekerek gösterir. İstediğiniz zaman yeniden açılabilir.

## v2.87.9 (2026-06-18) — Akış değiştiricide The Roku Channel

_v2.27.12 olarak yayımlandı._

### Eklendi
- **The Roku Channel** (ücretsiz, lisanslı) akış paneli değiştiricisine katılıyor — akış simgesine sağ tıklayın → **📡 Roku Channel’a geç**; Netflix / Prime Video / Disney+ ile yan yana. Aynı oturumu paylaşır ve URL ile simgeyi değiştirir.

## v2.86.9 (2026-06-18) — Discord bypass: tek tıkla Otomatik yapılandır (artık gerçekten çalışıyor)

_v2.27.11 olarak yayımlandı._

### Eklendi
- **🔧 Bypass’ı otomatik yapılandır** (Discord’a sağ tık ve otomatik “Discord engellenmiş görünüyor” açılır penceresi) — her ByeDPI desync kipini tarar, **her birini gerçek bir Discord el sıkışmasına karşı titizlikle sınar** (iki isteğin de geçmesi gerekir; böylece bir tesadüf kazanamaz), canlı bir “X/N kipi sınanıyor…” kartı gösterir ve gerçekten çalışan ilkini tutar. Yerleşik hafif kip yalnızca son çaredir. Her kipin gerçek sonucu `userData/byedpi/sweep.log` dosyasına kaydedilir.
- Bypass artık **açılışta çalışıyor** ve başarılı olursa **Discord panelini otomatik yeniden yüklüyor**; böylece boş bir parlama olmadan doğrudan çalışıyor.

### Düzeltildi
- **Sessizce çöken ByeDPI ön ayarları** — `--md5sig`, ByeDPI v0.17.3 tarafından desteklenmiyor; bu yüzden onu kullanan her ön ayar hemen çıkıyordu (“bilinmeyen seçenek”) ve tarama hiçbir zaman çalışan bir kipe ulaşmıyordu. Ön ayarlar yalnızca geçerli bayraklarla yeniden düzenlendi; bilinen iyi `--fake -1 --ttl 8 --tlsrec 1+s` önce deneniyor, ayrıca `--fake-sni` (izin verilen bir alan adını taklit et; böylece DPI bağlantıyı beyaz listeye alır).
- Tarama artık **yerleşik hafif testte kısa devre yapmıyor** (bu test uygulamayı gerçekten taşımadan da geçebiliyordu) — önce ByeDPI desync kipleri deneniyor.

### Değişti
- Discord sağ tık menüsü **Bypass’ı otomatik yapılandır** + **Bypass’ı kapat (Zapret kullan)** olarak sadeleştirildi — artık Hafif/Güçlü/ön ayar/özel karmaşası yok.

## v2.84.4 (2026-06-18) — Daha güçlü Discord bypass (ByeDPI, otomatik ayarlama) [deneysel]

_v2.27.10 olarak yayımlandı._

### Eklendi
- **ByeDPI ile Güçlü Discord bypass** — Discord’a sağ tık → “Bypass: Güçlü (ByeDPI, otomatik ayarla)”. Vex resmi kullanıcı alanı ByeDPI’sini (`ciadpi`) isteğe bağlı olarak indirir ve yerel bir SOCKS5 desync vekili olarak çalıştırır (böl/karıştır/sahte-TTL/tlsrec) — yönetici yetkisi olmadan Zapret/GoodbyeDPI’nin gücü. **Otomatik ayarlama** yaklaşık 10 desync ön ayarını dolaşır ve Discord TLS el sıkışması gerçekten tamamlanan ilkini tutar; ayrıca belirli bir ön ayarı zorlayabilir ya da **özel ByeDPI bayrakları** yapıştırabilirsiniz. ciadpi çıktısı `userData/byedpi/ciadpi.log` dosyasına kaydedilir. Sağlam başlatma (dinlediğini doğrular, yeniden dener).
- Artık üç bypass düzeyi var: **Kapalı** (kendi Zapret’inizi kullanın), **Hafif** (yerleşik DoH + SNI parçalama), **Güçlü** (ByeDPI).

### Notlar
- Deneysel: desync etkinliği ISS’ye özgüdür ve durumludur; bu yüzden tutarsız olabilir; antivirüs `ciadpi.exe`’yi işaretleyebilir. Ön ayarların hiçbiri geçemezse Zapret’i çalıştırın ve bypass’ı Kapalı yapın.

## v2.80.6 (2026-06-18) — Engel bypass’lı ve Vencord destekli Discord paneli

_v2.27.9 olarak yayımlandı._

### Eklendi
- **Kenar çubuğunda Discord** — Discord’un engellendiği bölgeler (örn. Türkiye) için yerleşik bir **sansür bypass’ı** ile birlikte bir Discord paneli (kendi `persist:discord` oturumu): oturum, **DNS-over-HTTPS** üzerinden çözümleme yapan yerel bir vekil üzerinden yönlendirilir ve **SNI içindeki TLS ClientHello’yu** iki TCP segmentine **böler** (GoodbyeDPI/ByeDPI/Zapret “böl” tekniği). Varsayılan olarak açık, yalnızca Discord ile sınırlı, hata durumunda açık kalır; sağ tık → “Engel bypass” ile açıp kapatın. En iyi çaba — inatçı bir DPI için yine de özel bir araç gerekebilir.
- **Tek tıkla Vencord** — Discord simgesine sağ tık → “Vencord’u kur / güncelle”, resmi Vencord tarayıcı uzantısını indirir ve Discord paneline yükler (Vex artık uzantıları o oturuma yüklüyor ve Vencord’un enjekte edebilmesi için orada CSP’yi gevşetiyor). Özel kullanıcı eklentileri, Vencord’un web uzantısını derleyip (`pnpm buildWeb`) Ayarlar → Uzantılar üzerinden yükleyerek desteklenir.

## v2.60.6 (2026-06-17) — Arama kısayolları, Ana Ses, Netflix, görüntü yakınlaştırma

_v2.27.8 olarak yayımlandı._

### Eklendi
- **Adres çubuğunda arama anahtar sözcükleri ve bang’ler** — `yt cats` → YouTube, `gh vex` → GitHub, `w einstein` → Wikipedia, `a usb cable` → Amazon vb., ayrıca her yerde DuckDuckGo bang’leri (`!w einstein`, `einstein !yt`). Yerleşikler: `g · ddg · b · yt · gh · w/wiki · a/amazon · r/reddit · so · npm · mdn · maps · img · x/tw · imdb · tr`; kendinizinkini `localStorage 'vex.searchKeywords'` ile ekleyin.
- **Ana Ses** — Hızlı Araçlar → “Ana Ses”: her sekme ve paneldeki medya için gerçek zamanlı, tek bir kaydırıcı (0–%500). %100’ün üzeri Web Audio ile yükseltir (sekmelerde/normal medyada çalışır); çapraz kaynaklı ve DRM’li medya (Netflix/Disney+/Prime) tasarım gereği 0–%100 ile sınırlıdır (sesleri yükseltilemez).
- **Netflix** — kenar çubuğu paneli olarak geri döndü (“N”, kendi `persist:netflix` oturumunda). **Netflix / Prime Video / Disney+ arasında geçiş yapmak için ona sağ tıklayın** — simge buna uyacak şekilde değişir ve üçü tek bir oturum açma deposunu paylaşır.
- **Görüntüyü yakınlaştır** — herhangi bir görüntüye sağ tık → “Görüntüyü yakınlaştır”, kaydırma ve yakınlaştırma özellikli bir ışık kutusu açar (imlecin olduğu yerde yakınlaştırmak için kaydırın, kaydırmak için sürükleyin, sığdırmak için çift tıklayın, kapatmak için Esc).

### Değişti
- Otomatik oynatma ilkesi, AudioContext’ler hemen başlasın diye gevşetildi — Ana Ses’in yükseltmesinin devreye girmesi için gerekli.

## v2.55.6 (2026-06-17) — Güç araçları: seçim yapay zekâsı, Serbest Oku, Medya Yakalayıcı, daha hızlı öneriler

_v2.27.7 olarak yayımlandı._

### Eklendi
- **Seçim yapay zekâsı** — herhangi bir sayfada metin seçin; üzerinde yüzen bir **Açıkla / Özetle / Çevir** çubuğu belirir (sağ tık → menü yerine tek bir hareket). Sağ tık menüsü ayrıca Açıkla ile Çevir arasında **Seçimi özetle** kazanır.
- **Serbest Oku** — okuduğunuz sayfadaki ödeme duvarlarını aşın (Hızlı Araçlar → 📰 Serbest Oku veya Ctrl+K). Üç taktik: **sayaçlı bir ödeme duvarını sıfırla** (yalnızca o sitenin çerezlerini + depolamasını temizler ve yeniden yükler — “ayda N ücretsiz makale” sayaçlarını sıfırlar), archive.today üzerinde **ücretsiz arşivlenmiş bir kopya aç** (sert abone duvarları için) veya **okuma modu**.
- **Medya Yakalayıcı** — bir sayfada oynayan video/sesi bulun ve kaydedin (Hızlı Araçlar → 🎬 Medya İndir veya Ctrl+K). Aşamalı dosyalar (mp4/webm/mp3/…) tek tıkla iner; HLS/DASH akış bağlantıları VLC veya yt-dlp için kopyalanabilir/açılabilir. DRM/MSE videosu (YouTube, Netflix) yakalanamaz ve listelenmez.

### Değişti
- **Adres çubuğu önerileri çok daha hızlı** — Google-suggest gecikmesi ~270 ms’den ~80 ms’ye düştü; oluşturucu tarafı önbelleği (geri silme/yeniden yazma anında, ağ yok) ve ana taraf LRU önbelleği + istek zaman aşımı eklendi. Artık Chrome gibi hissettiriyor.
- **Bellek paneli gerçek sayılar gösteriyor** — gerçek sekme başına işletim sistemi işlem belleği (eskiden sabit 150/80/1 MB tahminleriydi), gerçek bir tarayıcı toplamı, bir “N uykuda” sayısı ve bir işlemi paylaşan aynı site sekmeleri için bir `·shared` etiketi.

### Düzeltildi
- **Otomatik uyku artık sesi susturmuyor** — otomatik uyku, “Etkin olmayanları uyut” ve bellek baskısı koruması, aktif olarak ses çalan bir sekmeyi artık atlıyor (sessize alınmış sekmeler hâlâ kapsamda).

### Dahili
- Yeni `npm run smoke` — yalıtılmış bir profilde oluşturucunun başlatıldığını (sekme + webview çiziliyor, çekirdek yöneticiler tanımlı) doğrulayan gerçek Electron önyükleme duman testi; birim testlerinin yakalayamadığı “açılmıyor / oluşturucu hata veriyor” gerilemelerini yakalar.

## v2.50.6 (2026-06-17) — OAuth açılır pencereleri yönlendirmeyle başlayan akışlardan sağ çıkıyor + Peek tarzı oturum açma penceresi

_v2.27.6 olarak yayımlandı._

### Düzeltildi
- **Discord/Ticket Tool girişi artık gerçekten tamamlanıyor.** v2.27.5, açılır pencerenin *ilk* URL biçimine bakıyordu; ancak Ticket Tool oturum açma açılır penceresini, OAuth biçimli olmayan bir sıçrama URL’sinde (`api.tickettool.xyz/api/auth/login`) açıyor ve bu yalnızca *sonradan* `discord.com/oauth2/authorize` → geri çağrıya yönlendiriyor. `setWindowOpenHandler` pencere içi yönlendirmelerde yeniden tetiklenmez; bu yüzden ilk URL denetimi bunu kaçırıyor ve açılır pencere yine Peek’te çıkmaza giriyordu. Vex artık bir açılır pencereyi **betikli bir `window.open` açılır penceresi** olduğunda da gerçek tutuyor (disposition `new-window` *ve* pencere özellikleri ya da bir çerçeve adı ile) — sonrasında nereye giderse gitsin her tarayıcıda gerçek, açıcıya bağlı bir pencere — böylece yönlendirmeyle başlayan OAuth akışları ayakta kalıyor. Çıplak shift+tıklama (özellik/ad yok) değişmeden Peek’e yönlenmeye devam eder.

### Değişti
- **Oturum açma açılır penceresi yine uygulama içi Peek bindirmesi gibi giydirildi** — loşlaştırılmış Vex’in ortasında, kompakt, çerçevesiz bir dikdörtgen; üzerinde Peek çubuğu (geri · yenile · URL · **Sekme olarak aç** · kopyala · kapat) bindirilmiş. Hâlâ gerçek bir `window.opener` bağlantılı pencere (Peek bindirmesi açıcıyı barındıramıyor, oturum açmayı bozan da buydu); böylece geri teslimi bozmadan görünüm geri getirildi. Taşımak için çubuğu sürükleyin; **Esc** veya arka plana tıklama kapatır; sağlayıcı bitirdiğinde otomatik kapanır.

### Notlar
- Bu, açıcısı bozulmayan muameleyi “OAuth biçimli URL’lerden” “herhangi bir betikli `window.open` açılır penceresine” genişletir — standart tarayıcı davranışı; betiksiz gezinmeler hâlâ sekmelere/Peek’e yönlenir.
- `scripts/verify-oauth-popup-partition.js`, **Senaryo C**’yi (sıçrama → OAuth yönlendirmesi) kazandı: açılır pencerenin yönlendirme *boyunca* `window.opener` bozulmadan gerçek kaldığını ve açıcının bölümüne sabitlendiğini kanıtlar — eski ilk URL denetiminin geçemeyeceği bir senaryo. 24/24 denetim yeşil; betikli açılır pencere algılayıcısı için birim testleri eklendi.

## v2.48.1 (2026-06-17) — Düzeltme: açılır pencerelerde Discord (ve diğer) OAuth girişlerinin başarısız olması

_v2.27.5 olarak yayımlandı._

### Düzeltildi
- **Açılır pencere kullanan OAuth girişleri artık tamamlanıyor ve kaynak sekmeyi oturum açmış hâle getiriyor** — önceden bir Discord-OAuth akışının (örn. tickettool.xyz üzerindeki Ticket Tool panosu) kimlik doğrulama açılır penceresi Peek bindirmesine yönlendiriliyor ve bu `window.opener`’ı koparıyordu; bu yüzden yetkilendirmeden sonra geri çağrı *“Giriş işlemi başarılı. Ama bir şeyler ters gitti…”* gösteriyordu — kod değişimi çalışıyor ama oturumun sekmeye geri teslimi başarısız oluyordu. Vex artık **herhangi bir OAuth biçimli açılır pencereyi** (yalnızca 4 koda gömülü sağlayıcıyı değil) `window.opener` bozulmadan gerçek bir açılır pencere olarak tutuyor; bir ana bilgisayar izin listesi yerine URL *biçimine* bakıyor — yol `…/oauth2?/(authorize|auth)` ya da `…/auth/(authorize|callback)`, veya `response_type=code`, veya `client_id`+`redirect_uri`. Açılır pencere ayrıca **açıkça kaynak sekmenin oturum bölümüne** sabitleniyor; böylece oturum çerezi sekmenin okuyabileceği yere iniyor — yalnızca varsayılan oturum için değil, kapsayıcı sekmeleri (`persist:container-work`) ve kayıt dışı sekmeler için de doğrulandı.

### Notlar
- Bu, gerçek açılır pencere (açıcısı bozulmayan) muamelesini 4 ana bilgisayarlık izin listesinden herhangi bir OAuth biçimli açılır pencereye genişletir. Bu standart tarayıcı davranışıdır ve yalnızca OAuth biçimli açılır pencereler için geçerlidir (OAuth olmayan `window.open` açılır pencereleri hâlâ Peek’e yönlenir); veri yalıtımını değiştirmez (açılır pencere, izin listesindeki sağlayıcıların zaten yaptığı gibi açıcı sekmenin bölümünü paylaşır).
- Yeni `scripts/verify-oauth-popup-partition.js`, açılır pencerenin oturumunu gerçek Electron’da kanıtlar (kimlik, diskteki bölüm yolu, çerezin inişi, geçici OTR, `window.opener` boş değil). OAuth biçimi algılayıcısı için birim testleri eklendi.

## v2.45.6 (2026-06-16) — “Dokümandan Metni Kopyala” gerçek Google Docs metnini güvenilir şekilde alıyor

_v2.27.4 olarak yayımlandı._

### Düzeltildi
- **“Dokümandan Metni Kopyala” artık OCR’a düşmek yerine Google Docs’tan gerçek metni gerçekten alıyor.** Önceki sürüm Google’ın `mobilebasic`/dışa aktarma uç noktalarını düzenleyici sayfasının *içinden* çekiyordu; orada Google Docs’un hizmet çalışanı isteği yakalıyor ve canvas uygulama kabuğunu (gerçek metin yok) döndürüyordu; bu yüzden her metin yolu engellenmiş gibi görünüyor ve OCR’a düşüyordu. Artık Google’ın düz HTML işlemesini (Docs için `/mobilebasic`, Sheets için `/htmlview`) **oturum açmış oturumunuzda gizli, ekran dışı bir webview’da gerçek bir üst düzey gezinme** olarak yüklüyor — “URL’yi mobilebasic olarak değiştir” hilesinin otomatikleştirilmişi — ve işlenen metni okuyor. Gerçek bir gezinme gerçek metin sayfasını alır; böylece OCR hataları olmadan tam metin elde edersiniz. Sayfa içi dışa aktarma çekimi artık ikincil bir yol ve OCR yalnızca son çare. Sonuç paneli başlığı hangi yolun çalıştığını gösteriyor (“Google Doc (gerçek metin)” ve “OCR (görünür sayfa)”).

## v2.44.6 (2026-06-16) — “Dokümandan Metni Kopyala” artık GERÇEK metni alıyor (OCR hatası yok)

_v2.27.3 olarak yayımlandı._

### Değişti
- **“Dokümandan Metni Kopyala” artık, özel “kopyalamanın kilidini aç” uzantıları gibi, önce dokümanın gerçek metnini çıkarıyor — tam, OCR hatası yok.** OCR’a atlamak yerine artık Google’ın kendi gerçek metin işleme uç noktalarını sayfanın içinden çekiyor (böylece Google oturum çerezlerinizi taşıyorlar), sırayla: **`/mobilebasic`** (Google’ın sunucuda işlenmiş düz HTML sürümü — indirmeden farklı şekilde denetlenir, bu yüzden kopyalama kapalı çoğu dokümanda hâlâ gerçek metni sunar), sonra **`/export?format=txt`**, sonra **`/export?format=html`**. Sheets `export?format=csv` + `htmlview` kullanır; Slides metin dışa aktarmasını kullanır. Gerçek içerik döndüren ilk yol kazanır → sıfır hatayla tam metin. Oturum açma / “erişim iste” ara sayfalarını algılar ve gereksiz bir oturum açma sayfası döndürmek yerine atlar. **OCR (Tesseract.js, cihazda) artık yalnızca Google her metin yolunu sert biçimde engellerse son çaredir.**

## v2.43.1 (2026-06-16) — Google Docs’tan ve kopyalama kilitli sayfalardan metin kopyalayın

_v2.27.2 olarak yayımlandı._

### Eklendi
- **“Dokümandan Metni Kopyala” — Google Docs’tan ve kopyalama kilitli sayfalardan metni alın.** Kopyalama Kilidi Açma (v2.27.0) normal sayfa metninin seçimini yeniden etkinleştirir, ancak **Google Docs metnini bir `<canvas>` üzerine işler**; bu yüzden kilidi açılacak seçilebilir metin yoktur — farklı bir yaklaşım gerekir. Yeni araç (Hızlı Araçlar menüsü → “Dokümandan Metni Kopyala” veya Ctrl+K → “Dokümandan Metni Kopyala”) metni otomatik olarak iki yoldan alır: (1) **Google dışa aktarma hızlı yolu** — Docs/Sheets için dokümanın kendi `/export?format=txt|csv` uç noktasını *sayfanın içinden* çeker; böylece Google oturum çerezlerinizi taşır ve görüntüleme erişiminiz varsa tam metni döndürür; (2) **OCR yedeği** — dışa aktarma engellenmişse ya da doküman canvas ile işleniyorsa, işlenmiş sayfayı yakalar ve pikselleri Tesseract.js ile okur (isteğe bağlı yüklenir, **tamamen makinenizde** çalışır — görüntü hiçbir zaman ayrılmaz). Çıkarılan metin panonuza kopyalanır ve seçip düzenleyebileceğiniz bir panelde gösterilir. OCR görünür ekran başına çalışır (uzun dokümanlar için kaydırıp yeniden çalıştırın); dışa aktarma yolu için Google’da görüntüleme erişimiyle oturum açmış olmanız gerekir.

## v2.41.1 (2026-06-16) — Üst çubukta Hızlı Araçlar menüsü (yapboz düğmesi)

_v2.27.1 olarak yayımlandı._

### Eklendi
- **Üst çubukta, yapay zekâ düğmesinin hemen solunda bir “Hızlı Araçlar ve Uzantılar” düğmesi.** Yapboz simgesine tıklayın; sayfa başına kullanışlı araçların tek dokunuşluk menüsü açılır — **Kopyalamanın ve Sağ Tıkın Kilidini Aç** (yeni Kopyalama Kilidi Açma özelliği, listenin başında), Okuma Modu, Bu site için karanlık mod, Sayfayı Çevir, Sesli Oku, Öğeyi Yok Et, Bu Siteyi Güçlendir, Ekran Görüntüsü, Duyarlı Önizleme ve Gizlilik Raporu — ayrıca Ayarlar’ı açan **Chrome uzantılarını yönet…**. Her öğe komut çubuğundaki karşılığıyla aynı eylemi çalıştırır; böylece davranış tutarlı kalır. Açılır pencere temalıdır (açık ya da koyu her temayla eşleşir) ve Esc ya da dışarı tıklamayla kapanır.

## v2.39.1 (2026-06-16) — Kopyalama Kilidi Açma: seçmeyi ve kopyalamayı engelleyen siteleri aşın

_v2.27.0 olarak yayımlandı._

### Eklendi
- **Kopyalama Kilidi Açma — bunları devre dışı bırakan sitelerde seçmeyi, kopyalamayı ve sağ tıkı yeniden etkinleştirin.** Birçok sayfa metin seçimini ve sağ tık menüsünü kapatır (CSS `user-select:none`, `oncontextmenu` engelleyicileri ya da `copy`/`selectstart` olaylarını yutan yakalama aşaması işleyicileri ile). Vex artık bunu aşabiliyor. Kullanmanın iki yolu: **Ctrl+K → “Kopyalamanın ve Sağ Tıkın Kilidini Aç”** yalnızca geçerli sayfanın kilidini isteğe bağlı olarak açar (“bunu kopyalayayım” düğmesi) ya da her sayfada otomatik uygulamak için **Ayarlar → Gezinme ekstraları → “Kopyalama ve sağ tıka her zaman izin ver (site engellerini aş)”** seçeneğini açın. Kilit açma, enjekte edilmiş CSS ile seçimi yeniden etkinleştirir, sitelerin yeniden atadığı satır içi `on*` engelleyicilerini temizler ve yakalama aşaması engelleme işleyicilerini `preventDefault` **çağırmadan** durdurur — böylece yerel kopyalama ve bağlam menüsü geçer ve Vex’in kendi fare hareketleri çalışmaya devam eder. Varsayılan **kapalıdır**; böylece web uygulamalarındaki (elektronik tablolar, kod düzenleyiciler) meşru kopyalama işleyicilerine asla karışmaz. Not: Google Docs gibi canvas ile işlenen düzenleyicileri okuyamaz (orada seçilebilir metin yoktur) ve DRM korumalı medyaya asla dokunmaz.

## v2.34.3 (2026-06-15) — Geçersiz Widevine (VMP) imzalaması için güvenilir derleme kapısı

_v2.26.5 olarak yayımlandı._

### Değişti
- **Widevine imzalayıcı bir geliştirme/önbelleğe alınmış imzaya geri düştüğünde derleme artık iptal ediliyor** — uygulamanın DRM için geçerli biçimde imzalanmadığının (Spotify/Netflix) kesin işareti. `scripts/vmp-sign.js`, `sign-pkg`’nin kendi çıktısını “Certificate is valid for development only” / “Using cached signature” için tarar ve derlemeyi çözüm adımlarıyla başarısız kılar. (v2.26.4 `verify-pkg`’ye güveniyordu; bu, derleme içi bir kapı olarak güvenilmez çıktı — derleme ortamında başarı bildirirken tek başına çalıştırıldığında başarısız oluyordu.) DRM’siz bir derlemeyi bilerek yapmak için `VEX_SKIP_VMP_VERIFY=1` ayarlayın. **DRM’yi düzeltmek geçerli bir castLabs EVS imzası gerektirir** (`python -m castlabs_evs.account reauth` / `signup`, sonra yeniden derleyin) — bu bir uygulama kodu sorunu değildir.

## v2.34.2 (2026-06-15) — Widevine (VMP) imzası geçersiz olduğunda derleme yüksek sesle başarısız oluyor (2.26.5 ile yerini yitirdi)

_v2.26.4 olarak yayımlandı._

### Değişti
- İmzalamadan sonra derlemeyi `vmp verify-pkg` ile denetlemeye çalışıldı; bu, derleme ortamında güvenilmez çıktı (derleme içinde geçti, tek başına çalıştırıldığında başarısız oldu) ve v2.26.5’teki çıktı algılama kapısı tarafından geçersiz kılındı.

## v2.34.1 (2026-06-15) — DRM Yeniden Dene artık takılı bileşen güncelleyici durumunu sıfırlıyor

_v2.26.3 olarak yayımlandı._

### Düzeltildi
- **DRM Yeniden Dene artık takılı bir Widevine kurulumunu gerçekten kurtarıyor.** Etkilenen makinelerde standart Widevine CDM kaydolmuş ama indirmeyi hiç bitirmemişti (boş `WidevineCdm` klasörü, kayıtlı sürüm yok) ve bileşen güncelleyici geri çekilmeye devam ediyordu; bu yüzden yalnızca klasörü temizlemek (v2.26.2) işe yaramıyordu. Yeniden Dene artık ayrıca güncelleyicinin Widevine bileşenlerine ait kaydını `Local State` içinden siliyor (kayıtlı parolalarınızı/çerezlerinizi koruyan şifreleme anahtarını koruyarak); böylece yeniden başlatma CDM’yi sıfırdan indiriyor.

## v2.33.1 (2026-06-15) — DRM Yeniden Dene artık önbelleğe alınmış bileşeni temizliyor (temiz yeniden indirme)

_v2.26.2 olarak yayımlandı._

### Düzeltildi
- **DRM “Yeniden dene” düğmesi artık yeniden başlatmadan önce önbelleğe alınmış Widevine bileşenini temizliyor.** İlk kurulum diskte kısmi/bozuk bir bileşen bıraktığında düz bir yeniden başlatma işe yaramıyordu; güncelleyici bozuk kopyayı yeniden kullanıp her seferinde başarısız oluyordu. Yeniden Dene artık profiliniz altındaki bileşen önbelleğini siliyor; böylece yeniden başlatma onu temiz biçimde yeniden indiriyor.

## v2.32.1 (2026-06-15) — Dayanıklı Widevine/DRM kurulumu + Yeniden dene düğmesi

_v2.26.1 olarak yayımlandı._

### Düzeltildi
- **DRM (“Widevine”) kurulumu artık dayanıklı ve kurtarılabilir.** Ayarlar → Hakkında, kurtarma yolu olmadan *“DRM başarısız: …”* gösterebiliyordu ve durmuş bir CDM indirmesi ana pencereyi bile geciktirebiliyordu. castLabs Widevine bileşeni artık ateşle-ve-unut biçiminde başlatılıyor (pencere oluşturmayı asla engellemez), her deneme 30 sn’lik bir zaman aşımıyla yarışıyor ve yavaş bir ilk çalıştırma indirmesi ikinci bir deneme alıyor. Başarısız olduğunda **Ayarlar → Hakkında artık bir Yeniden dene düğmesi gösteriyor**; bu düğme kurulumu yeniden çalıştırmak için Vex’i yeniden başlatır (geçici bir ilk çalıştırma ağ hatası için güvenilir çözüm) ve durum yeniden sorgulanıyor; böylece yavaş bir indirme kendiliğinden “hazır”a dönüyor. Korumalı oynatma (Spotify/Netflix), CDM hazır bildirdiğinde çalışır.

## v2.29.6 (2026-06-15) — EasyList reklam engelleme, sekme hazırda bekletme, site başına karanlık mod ve gizlilik düzeltmeleri

_v2.26.0 olarak yayımlandı._

### Eklendi
- **EasyList + EasyPrivacy reklam/izleyici engelleme.** İstek engelleyici artık tam EasyList + EasyPrivacy filtre kümeleri üzerinde çalışıyor (`@ghostery/adblocker` ile); elle tutulan önceki alan adı listesine göre büyük bir kapsam sıçraması. Cerrahi biçimde bağlandı — Vex `webRequest`’i devretmek yerine motorun eşleştiricisini kendi istek işleyicisinin içinde çağırıyor; böylece izleyici sayacı, bölüm başına bağlantı ve frame-ancestors temizleme çalışmaya devam ediyor. Eski liste hâlâ VEYA ile ekleniyor, böylece hiçbir şey gerilemiyor; motor sayfa gezinmelerini asla engellemiyor ve derlenmiş motor, anında ve çevrimdışı güvenli başlangıç için profiliniz altında önbelleğe alınıyor.
- **Sekme hazırda bekletme.** Bir eşiğin (varsayılan 30 dk; devre dışı bırakmak için `vex.tabHibernateMinutes` değerini `0` yapın) ötesinde boşta bırakılan arka plan sekmeleri belleği boşaltmak için askıya alınır ve üzerine tıkladığınızda yeniden yüklenir. Etkin sekme, ses çalan sekmeler, sabitlenmiş sekmeler ve yerel/başlangıç sayfaları asla askıya alınmaz.
- **Site başına karanlık mod.** Bir sayfaya sağ tıklayın → yalnızca o siteyi zorla karartmak için **Bu site için karanlık mod** (ana bilgisayar başına hatırlanır). Sağ tık → **Bu sitenin ayarlarını sıfırla**, o sitenin kayıtlı yakınlaştırmasını ve karanlık mod geçersiz kılmasını temizler. Eski genel zorla karartma anahtarı hâlâ çalışır.

### Düzeltildi
- **Favicon’lar artık gezinmenizi Google’a sızdırmıyor.** Sekme simgeleri önceden Google’ın `s2/favicons` hizmetinden geliyordu; bu, açtığınız her alan adını Google’a bildiriyordu — Vex’in izleyici engelleyicisiyle çelişen bir durum. Vex artık her sitenin kendi birinci taraf favicon’unu kullanıyor (temiz bir yer tutucu yedeğiyle).
- **İstemci İpuçları artık taklit edilen Chrome kullanıcı aracısıyla eşleşiyor.** `Sec-CH-UA` istek üstbilgileri Chrome UA ayarlı olsa bile hâlâ Electron’u duyuruyordu; artık her sekme oturumunda Chrome 124’e normalleştiriliyor; böylece İstemci İpuçlarını koklayan siteler (çoğu modern site bunu UA dizesine tercih eder) tutarlı bir masaüstü Chrome görüyor.

## v1.99.6 (2026-06-15) — Onay engelleyicisinin bozduğu site düzenleri düzeltildi (örn. Roblox altbilgisi sayfanın ortasında)

_v2.25.3 olarak yayımlandı._

### Düzeltildi
- **Sayfalar artık yanlış yerleştirilmiş içerikle işlenmiyor (Roblox, “Hakkımızda” altbilgisini oyun mağazası sayfasının ortasında gösteriyordu).** Vex’in çerez/onay banner engelleyicisi `html,body{position:static!important;overflow:auto!important}` kuralını **her** sayfaya koşulsuz enjekte ediyordu. Bu geçersiz kılma, sitelerin öğeleri `<body>`’ye sabitlemek için kullandığı konumlandırma bağlamını sıyırıyordu; bu yüzden Roblox’un genel altbilgisi sayfanın ortasına düşüyordu. Kaydırma/konum kilidi açma (bir bannerın kaydırma kilidini geri almak için var) artık **yalnızca gerçek bir onay öğesi mevcutken** uygulanıyor — yüklemeden sonra bağlanan bannerlar için kısaca yeniden denetleniyor — böylece bannersız siteler olduğu gibi bırakılıyor. Çerez bannerları eskisi gibi engellenmeye devam ediyor.
- **Normal sekmeler artık Chrome kullanıcı aracısını bildiriyor.** Chrome UA taklidi (“desteklenmeyen tarayıcı engellerinden kaçın”) varsayılan oturumu ve panel bölümlerini kapsıyordu ancak her sekmenin kullandığı bölüm olan `persist:main`’i atlıyordu; bu yüzden siteler ham Electron UA’sını görüyordu. `persist:main` artık Chrome UA’sını da alıyor.

## v1.98.6 (2026-06-13) — Firebase oturum açma açılır penceresi artık Peek’te boş açılmıyor

_v2.25.2 olarak yayımlandı._

### Düzeltildi
- **Boş yüklenen “Google ile giriş yap” açılır pencereleri artık tamamlanıyor.** Firebase kimlik doğrulama işleyicisi açılır penceresi (örn. `elevenlabs.io/__/auth/handler`) Peek bindirmesine yönlendiriliyor ve bu `window.opener`’ı koparıyordu; bu yüzden açılır pencere oturum açmayı asla geri teslim edemiyor, yalnızca beyaz kalıyordu. Vex artık kimlik doğrulama işleyicisini gerçek bir açılır pencere olarak açıyor (sitenin kendi alan adında olduğu için `/__/auth/handler` yoluyla eşleştirilir) ve açıcıyı bozulmadan koruyor. v2.25.1 ile birlikte bu, ElevenLabs ve benzeri sitelerde birleşik oturum açmayı düzeltir.

## v1.97.6 (2026-06-13) — “Google ile giriş yap” yeniden çalışıyor (Firebase yönlendirme girişleri)

_v2.25.1 olarak yayımlandı._

### Düzeltildi
- **Birleşik oturum açma (örn. ElevenLabs ve diğer Firebase sitelerinde “Google ile giriş yap”) artık *“Eksik başlangıç durumu nedeniyle istek işlenemiyor.”* hatasıyla başarısız olmuyor.** Chromium’un üçüncü taraf depolama bölümlendirmesi, kimlik doğrulama işleyicisinin depolamasını yalıtıyordu; bu yüzden yönlendirme kendi oturum açma durumunu okuyamıyordu. Vex artık bu bölümlendirmeyi devre dışı bırakıyor ve yönlendirme tabanlı girişleri geri getiriyor. (Bölümlendirmenin koruduğu siteler arası izlemeyi Vex’in reklam/izleyici engelleyicisi hâlâ ele alıyor.)

## v1.95.1 (2026-06-13) — Sol kenar çubuğundaki her düğmeyi özelleştirin

_v2.25.0 olarak yayımlandı._

### Eklendi
- **Sol kenar çubuğundaki her düğme artık özelleştirilebilir**, yalnızca web uygulaması olanlar değil. **Herhangi bir düğmeye sağ tıklayın** → Yeniden adlandır, Simgeyi değiştir, Gizle, Sıfırla. Bir web sitesi açan düğmeler (Claude/Spotify/WhatsApp, sabitlenmiş siteler) ayrıca **Bağlantıyı değiştir** + hizmet geçişi alır.
- **Ayarlar → Kenar çubuğu düğmeleri** — her düğmeyi **yeniden adlandırmak, simgesini değiştirmek, bağlantısını değiştirmek (web düğmeleri), göstermek/gizlemek ve yeniden sıralamak** için ana liste ve **gizli düğmeleri geri yükleme** yeri (daha önce bir düğme gizlendikten sonra geri dönüş yolu yoktu).

### Düzeltildi
- Kenar çubuğu sağ tık menüsü artık bir öğeyi seçtikten sonra arkada görünmez bir bindirme bırakmıyor (sekme/grup menülerinde düzeltilen hatanın aynı sınıfı).

## v1.93.1 (2026-06-13) — Tıklanan bağlantılar soğuk başlangıçta Vex ile açılıyor

_v2.24.1 olarak yayımlandı._

### Düzeltildi
- **Vex zaten çalışmıyorken bir bağlantıya tıklamak artık yalnızca tarayıcıyı değil, bağlantıyı da açıyor.** Soğuk bir açılışta bağlantı, sayfa işleyicisini bağlamayı bitirmeden geliyor ve düşürülüyordu; Vex başlangıç sayfasını gösteriyordu. Vex artık gelen bağlantıyı sayfa hazır olana kadar arabelleğe alıyor ve sonra ona gidiyor. Gerçek Electron’da doğrulandı.

## v1.90.6 (2026-06-13) — Grup renkleri gerçekten değişiyor + her temayla eşleşiyor

_v2.24.0 olarak yayımlandı._

### Düzeltildi
- **Bir sekme grubunun rengini değiştirmek artık onu gerçekten değiştiriyor.** Üst çubuktaki grup hapları, ne seçerseniz seçin hepsi *aynı* rengi işliyordu. Kök neden: hap rengi sayfa kökünde hesaplanıyordu (orada grubun kendi rengi bilinmez); bu yüzden her grup tek bir sabit varsayılana düşüyordu. Renk artık her grubun kendi hapında hesaplanıyor; böylece seçimler farklı oluyor ve hemen uygulanıyor. Yalnızca birim testlerinde değil, temalar arasında gerçek Chromium’da doğrulandı.
- Grup/sekme/yığın sağ tık menüleri artık bir sonraki tıklamanızı yutabilecek görünmez tam ekran bir bindirme bırakmıyor.

### Değişti
- **Grup renkleri artık her temayla eşleşiyor — ve temayı değiştirdiğinizde yeniden eşleşiyor.** Renkler tema referansları olarak saklanıyor ve seçenekler etkin temanın paletinden çekiliyor; böylece bir grup Dracula’da Dracula’nın moru, Ocean’da Ocean’ın camgöbeği oluyor — temaları değiştirmek gruplarınızı canlı olarak yeniden renklendiriyor. Yeni gruplar varsayılan olarak geçerli temanın vurgu rengini alıyor. Bu **yapay zekâ ile oluşturulan gruplar** için de geçerli (otomatik gruplayıcı ve yapay zekâ sekme komutu) — tema paletine eşleniyor ve elle oluşturulan gruplar gibi yeniden temalanıyor.

## v1.88.1 (2026-06-13) — Sihirbaz her şeyi gösteriyor + tüm ayarlar yeniden düzenlenebilir

_v2.23.0 olarak yayımlandı._

### Değişti
- **Kurulum sihirbazını yeniden açmak artık her adımı gösteriyor**; adımlar daha önce kaydettiklerinizle önceden doldurulur ve **“✓ zaten ayarlı”** etiketi taşır. Hiçbir şey gizlenmez, bu yüzden tema, GitHub ve Yerel yapay zekâ (Ollama) her zaman görünür. Her yapay zekâ arka ucu (Bulut / Ollama / Cihaz üzerinde) ayrı ayrı değerlendirilir; bulut yapay zekâya sahip olmak artık Ollama adımını gizlemez.

### Eklendi
- **Hava durumu konumu artık Ayarlar → Kişiselleştirme içinde düzenlenebiliyor**; sihirbazdakiyle aynı ilçe seçim listesi var (ara → “Ataşehir · İstanbul · Türkiye” seçin). Mevcut konumunuzu da gösterir.
- **Ayarlar’daki “Tema seç…” düğmesi** tema seçiciyi açar; böylece temaya Ayarlar’dan da ulaşılabilir.
- Ayarlar’da **görünen adınızı, GitHub kullanıcı adınızı, arama motorunuzu veya hava durumunuzu** düzenlemek artık başlangıç sayfasını **hemen** güncelliyor (önceden bazıları yalnızca yeniden başlatmadan sonra uygulanıyordu).

## v1.86.6 (2026-06-13) — Daha kapsamlı kurulum sihirbazı + ilçe doğruluğunda konum

_v2.22.0 olarak yayımlandı._

### Eklendi
- Kurulum sihirbazı artık **çok daha fazlasını** kapsıyor: varsayılan **arama motoru**, **Vex’i varsayılan tarayıcınız yapma**, üç yapay zekâ arka ucu **ayrı adımlar** olarak (Bulut / Claude, tek tıkla algılamalı yerel **Ollama** ve **cihaz üzerinde** WebGPU), **Vex Sync** ve ilk girişinizi **parola yöneticisine** ekleme; bunlar tema, ad, hava durumu ve GitHub’a ek olarak geliyor.
- **İlçe düzeyinde konum.** Hava durumu konumu artık en fazla 5 eşleşme arıyor ve *“Ataşehir · İstanbul · Türkiye”* olarak gösterilen tam doğru olanı seçmenize izin veriyor; böylece ilçeler başıboş bir en üst sonuca takılmak yerine doğru çözümleniyor. Hem kurulum sihirbazı hem de başlangıç sayfasındaki konum düğmesi için geçerli.

### Değişti
- Devam etme mantığı yeni adımları anlıyor: **herhangi bir** yapay zekâ arka ucunu yapılandırmak üç yapay zekâ adımını da temizler (bulut yapay zekâyı kurduktan sonra Ollama kurmanız için asla rahatsız edilmezsiniz) ve diğer her adım değeri kaydedilince kaybolur.

## v1.85.1 (2026-06-12) — Güncelleme istemi + devam ettirilebilir kurulum sihirbazı

_v2.21.0 olarak yayımlandı._

### Eklendi
- **Güncelleme var penceresi.** Açılıştan birkaç saniye sonra (ve Ayarlar → Güncellemeleri Denetle’den), daha yeni bir sürüm varsa Vex, yeni yükleyiciyi doğrudan indiren bir **İndir** düğmesiyle bir istem gösterir. Hafif HTTPS sürüm denetimini kullanır; bu yüzden eski otomatik güncelleyici yolu gibi uygulamayı çökertemez.
- Üst çubukta, yeniden yükle düğmesinin hemen sağında **kurulum sihirbazı düğmesi**; ilk çalıştırmada atladıysanız karşılama sihirbazını istediğiniz zaman yeniden açın.

### Değişti
- Karşılama sihirbazı artık **baştan başlamak yerine kaldığı yerden devam ediyor.** Yeniden açtığınızda yalnızca henüz tamamlamadığınız adımları (tema, ad, hava durumu, GitHub, yapay zekâ) gösterir ve zaten ayarlı olanları atlar; böylece işi yarıda bırakmak her şeyi baştan yapmanıza yol açmaz. Geriye bir şey kalmadıysa sadece her şeyin hazır olduğunu söyler.

## v1.77.6 (2026-06-12) — Tema önizlemeleri artık gerçekten çiziliyor

_v2.20.3 olarak yayımlandı._

### Düzeltildi
- Tema önizleme küçük resimleri **sıfır boyuta çöküyordu**; bu yüzden her kart önizleme yerine yalnızca düz renkli bir etiket çubuğu gösteriyordu. Buna iki yerleşim hatası yol açıyordu: küçük resim yüksekliği için `aspect-ratio` kullanıyordu (tek çocuğu mutlak konumlandırılmışsa hiçbir şey hesaplamaz) ve kart bir `<button>` olduğundan, UA varsayılanı `align-items: flex-start` küçük resmin tam genişliğe uzanmasını engelliyordu. Küçük resmin artık açık bir genişliği ve yüksekliği var; böylece ayrıntılı mini pencere önizlemesi her tema için çiziliyor. Basitleştirilmiş bir taslakla değil, gerçek seçici CSS’i yakalanarak doğrulandı.

## v1.76.6 (2026-06-12) — Kurşun geçirmez tema önizlemeleri

_v2.20.2 olarak yayımlandı._

### Düzeltildi
- Tema önizlemeleri kurulu uygulamada **düz renk blokları** olarak çiziliyordu (dayandıkları kapsayıcı sorgusu CSS’i o bağlamda uygulanmıyordu). Her önizleme artık yalnızca **satır içi stillerle** çiziliyor; harici CSS sınıfı, CSS değişkeni ya da kapsayıcı sorgusu yok; her temanın gerçek renkleri doğrudan stil sayfasından okunuyor. Her tema (orijinaller ve yeniler) artık aynı ayrıntılı Vex penceresini gösteriyor ve önizlemeler eski, önbelleğe alınmış ya da geçersiz kılınmış stillerle bozulamıyor.

## v1.75.6 (2026-06-12) — Ayrıntılı canlı önizlemeler

_v2.20.1 olarak yayımlandı._

### Değişti
- Canlı tema önizlemeleri artık **ayrıntılı** Vex penceresi (üst çubuk, kenar çubuğu, sekme ve tam Vex Sync ayarları içeriği); yeni temaların sahip olduğu aynı zengin görünüm, her temanın renklerinde CSS’ten canlı çiziliyor. Her temanın önizlemesi stil olarak aynı ve asla bir görsel dosyası değil.

## v1.75.1 (2026-06-12) — Canlı tema önizlemeleri + kenar çubuğu düzeltmeleri

_v2.20.0 olarak yayımlandı._

### Değişti
- **Tema önizlemeleri artık CSS’ten canlı çiziliyor**, her temanın kendi renklerinde; hiç görsel dosyası yok. Her tema (orijinaller dahil) tam olarak aynı biçimde ve önizlemeler artık hiçbir zaman eski, önbelleğe alınmış ya da sürümler arasında uyumsuz olamaz.

### Düzeltildi
- **Kenar çubuğunu kapat düğmesi** (Vex Sync simgesinin yanında) artık sol kenar çubuğunun **tamamını**, simge rayı dahil, daraltıyor; yeniden açmak için tekrar tıklayın. Yapay zekâ düğmesinin yanındaki yinelenen anahtar kaldırıldı.

## v1.73.6 (2026-06-12) — Eşitleme simgesinin yanında kenar çubuğu anahtarı

_v2.19.1 olarak yayımlandı._

### Eklendi
- Üst çubukta, Vex Sync simgesinin hemen yanında bir **sol kenar çubuğunu kapat/aç** düğmesi (hâlâ Ctrl+B ile ve sekmeler başlığında da var).

## v1.71.6 (2026-06-12) — Tema önizlemelerini zorla yenile

_v2.19.0 olarak yayımlandı._

### Düzeltildi
- **Tema önizlemeleri artık bir güncellemeden sonra her zaman yeniden yükleniyor**; önizleme görselleri uygulama sürümüne göre önbellekten kaçınıyor, böylece eski önbelleğe alınmış ekran görüntüleri yerine yeniden üretilen (tek tip) önizlemeler görünüyor. 35 temanın hepsi aynı önizleme stilini paylaşıyor.

## v1.70.6 (2026-06-12) — Favori temalar + 6 tema daha

_v2.18.0 olarak yayımlandı._

### Eklendi
- **Favori temalar**: seçicide (Ctrl+Shift+Y veya başlangıç sayfasındaki Tema düğmesi) herhangi bir tema kartının üzerine gelin ve favorilere eklemek için **yıldıza** tıklayın. Yıldızlı temalar seçicinin en üstündeki **★ Favoriler** bölümünde görünür.
- **6 tema daha**: Ruby, Lime, Bronze, Plum, Arctic ve Wine (toplam 35).
- Tüm önizlemeler tek tutarlı üretilmiş stilde kalır.

## v1.68.6 (2026-06-12) — 8 tema daha + tek tip önizlemeler

_v2.17.0 olarak yayımlandı._

### Eklendi
- **8 yeni tema**: Slate, Emerald, Amethyst, Volcano, Sapphire, Honey, Mint ve Obsidian (toplam 29).

### Değişti
- **Tüm tema önizlemeleri artık tek tutarlı stil kullanıyor**: her tema kartı kendi renklerinde aynı tam uygulama çizimi; böylece seçicinin tamamı tek tip.

## v1.66.7 (2026-06-12) — Orijinal önizlemelere geri dönüş

_v2.16.5 olarak yayımlandı._

### Düzeltildi
- **Orijinal tema önizleme ekran görüntüleri** (hep orada olan gerçekleri) geri yüklendi. v2.16.4 bunların üzerine üretilmiş bir çizim yazmıştı; v2.16.3 durumuna geri dönüldü (ilk temalar için orijinal ekran görüntüleri; daha yeniler için eşleşen önizlemeler).

## v1.66.2 (2026-06-12) — Orijinal önizlemeleri geri yükle, yenileri onlara uydur

_v2.16.3 olarak yayımlandı._

### Düzeltildi
- v2.16.2’nin üzerine yazdığı **orijinal tema önizleme ekran görüntüleri** (Oxford, Ocean, Midnight vb.) geri yüklendi ve yeni temaların önizlemeleri aynı 1400×600 boyutunda **aynı tam uygulama stilinde** (üst çubuk, kenar çubuğu, sekmeler, Ayarlar içeriği) yeniden üretildi; böylece her temanın önizlemesi artık orijinallerle tutarlı görünüyor.

## v1.66.1 (2026-06-12) — Her tema için gerçek önizleme ekran görüntüleri

_v2.16.2 olarak yayımlandı._

### Değişti
- **Her temanın artık seçicide gerçek bir ekran görüntüsü önizlemesi var** (düz bir renk örneği ya da mini taslak değil); 21 temanın hepsi kendi renklerinde gerçek bir Vex penceresi olarak tutarlı şekilde çiziliyor. İstediğiniz zaman `npm run capture-themes` ile yeniden üretin.

## v1.65.6 (2026-06-12) — Widevine/DRM durumu

_v2.16.1 olarak yayımlandı._

### Eklendi
- **Ayarlar → Hakkında içinde DRM (Widevine) durumu**: korumalı oynatmanın (Spotify, Netflix) gerçekten etkin olup olmadığını gösterir; böylece DRM’nin hazır mı, yükleniyor mu, yoksa yalnızca kurulu sürümde mi çalıştığını bir bakışta anlayabilirsiniz.

### Not
- Korumalı (DRM) oynatma, **kurulu, VMP imzalı sürümü** gerektirir; Vex’i kaynaktan (`npm start`) çalıştırırken çalışmaz. Spotify “Playback of protected content is not enabled” diyorsa Ayarlar → Hakkında içindeki yeni DRM satırına bakın.

## v1.64.8 (2026-06-12) — Tema önizlemeleri + 6 tema daha

_v2.16.0 olarak yayımlandı._

### Eklendi
- **6 tema daha**: Aurora, Crimson, Gold, Sakura, Cyberpunk ve Monochrome (toplam 21 tema).
- **Canlı önizleme kartları**: ekran görüntüsü olmayan temalar artık kendi paletlerinden çizilmiş gerçek bir mini arayüz taslağı (kenar çubuğu, sekmeler, araç çubuğu, metin, vurgu düğmesi) gösteriyor; böylece seçicideki her tema düz bir renk örneği yerine düzgün bir önizleme gibi görünüyor.

## v1.62.8 (2026-06-12) — “Güncellemeleri Denetle” düzeltmesi

_v2.15.1 olarak yayımlandı._

### Düzeltildi
- **“Güncellemeleri Denetle” artık uygulamayı kapatmıyor.** electron-updater’ın yerel denetleyicisini çağırıyordu; bu yapıda o, süreci çökerten yerel yardımcılar başlatabiliyor. Elle denetim artık hafif bir HTTPS sürüm sorgusu (son sürümün numarasını alıp karşılaştırır); uygulamayı çökertemez, güncel olup olmadığınızı söyler ve daha yeni bir sürüm varsa doğrudan indirmeye bağlantı verir.

## v1.60.3 (2026-06-12) — Arama motorları, daha fazla tema, özel duvar kâğıdı ve daha fazlası

_v2.15.0 olarak yayımlandı._

### Eklendi
- Başlangıç sayfasında **arama motoru seçici**: arama çubuğundaki motor düğmesine tıklayıp **Google, Bing, DuckDuckGo, Brave, Startpage, Ecosia veya YouTube** arasından seçin. Çubuk hangisinin etkin olduğunu gösterir (“Search with DuckDuckGo…”) ve Enter sorgunuzu oraya gönderir. Seçiminiz hatırlanır.
- **Kenar çubuğu daraltma düğmesi**: sekmeler başlığındaki bir ok sol kenar çubuğunu daraltır/genişletir (hâlâ Ctrl+B ile; üst çubuktaki düğme de yeniden açar).
- **6 yeni tema**: Sunset, Rosé, Matrix, Mocha, Solarized ve Vaporwave; mevcut 8’e ek olarak.
- **Özel Görsel teması**: tema seçicide **Özel Görsel**’i seçip herhangi bir resim yükleyin; başlangıç sayfası duvar kâğıdınız olur (otomatik küçültülür, okunabilirlik için bir perdeyle) ve temiz bir grafit-koyu arayüzle eşleşir.
- **Kurulum sırasında cihaz üzerinde model indirme**: ilk çalıştırma sihirbazının yapay zekâ adımı artık orada bir WebGPU modeli seçip indirmenize izin veriyor (desteklenen yerlerde).

### Değişti
- **Hava durumu °F yerine °C gösteriyor.**

## v1.52.8 (2026-06-12) — İlk çalıştırma kurulum sihirbazı

_v2.14.0 olarak yayımlandı._

### Eklendi
- **İlk çalıştırma kurulum sihirbazı**: yeni bir kurulumda Vex artık her aracı adım adım kurmanızı sağlıyor: bir **tema**, **adınız**, **hava durumu** konumu, **GitHub** kullanıcı adı ve **yapay zekâ arka ucu** (bulut çalışan URL’si / Ollama algıla / sonra cihaz üzerinde) seçin. Her adımda bir **Atla** var ve tamamen çıkmak için bir **Kurulumu atla** var. İstediğiniz zaman Ctrl+K → “Kurulum Sihirbazını Çalıştır” ile yeniden çalıştırın. Mevcut kurulumlar bunu hiç görmez.

### Değişti
- **Hava durumu artık başlangıç sayfasında °F yerine °C gösteriyor.**

## v1.45.3 (2026-06-12) — Başlangıç sayfasında Tema düğmesi

_v2.13.0 olarak yayımlandı._

### Eklendi
- Başlangıç sayfasının sağ üstünde bir **Tema** düğmesi; tıklayınca tam tema seçici (önizlemeli 8 temanın hepsi) görünür. Birini seçmek tüm tarayıcıyı anında yeniden temalandırır.

## v1.43.3 (2026-06-12) — Günlük ayet, hava durumu konumu ve Spotify oynatma

_v2.12.0 olarak yayımlandı._

### Eklendi
- Başlangıç sayfasında, karşılamanın altında **günlük Kur’an ayeti (Türkçe)**: her gün farklı bir ayet (Diyanet meali), gün boyunca sabit kalması için önbelleğe alınır ve çevrimdışıysanız sessizce gizlenir.
- **Hava durumu için konum belirleme**: Hava Durumu widget’ının yanında “📍 Konum belirle” düğmesi. Şehrinizi yazın (Open-Meteo ile coğrafi kodlanır) ve hava durumu ona geçer; konum kaydedilince düğme kaybolur. Yalnızca yerel olarak saklanır.

### Düzeltildi
- **Yerleşik Spotify artık çalabiliyor.** İki neden vardı: Widevine DRM bileşeni başlatılmıyordu (castLabs Electron, herhangi bir EME oynatmasından önce `components.whenReady()` ister) ve `mediaKeySystem` izni normal bir tarayıcıdaki gibi otomatik verilmek yerine soruluyordu (ve panelde sessizce başarısız oluyordu). İkisi de düzeltildi; Oynat ve diğer oynatma denetimleri Spotify panelinde çalışıyor.

## v1.40.3 (2026-06-12) — Döndürücü düzeltmesi

_v2.11.5 olarak yayımlandı._

### Düzeltildi
- **Yükleme döndürücüleri artık her turda yukarı-sola sıçramıyor.** Paylaşılan `spin` anahtar karesi, yalnızca ortalanmış webview yükleyicisinin ihtiyaç duyduğu bir `translate(-50%,-50%)` içeriyordu; bu yüzden diğer tüm döndürücüler (yapay zekâ paneli “Düşünüyor”, geçmiş, eşitleme, genel) döngüde atlıyordu. Genel döndürücü artık olduğu yerde düzgünce dönüyor; ortalanmış yükleyici kendi anahtar karesini koruyor.

## v1.39.8 (2026-06-12) — Yapay zekâ arka ucu yenile düğmesi

_v2.11.4 olarak yayımlandı._

### Eklendi
- Ayarlar → Yapay Zekâ Arka Ucu içindeki “Yerel (Ollama)” durumunun hemen yanında bir **Yenile** düğmesi; böylece Ollama’yı anında yeniden denetleyebilirsiniz (yeniden ping atar ve model listesini yeniden yükler). Mevcut “Ollama Durumunu Yenile” düğmesi de hâlâ çalışıyor.

## v1.39.3 (2026-06-12) — Ayarlar kaydırma düzeltmesi

_v2.11.3 olarak yayımlandı._

### Düzeltildi
- Kategori çubuğu sabit kalırken **Ayarlar yine kaydırılıyor.** v2.11.2 başlığı sabitlemişti ama yanlışlıkla kaydırmayı öldürmüştü (panel `display:block` ayarlıyor ve bu, flex yerleşimini geçersiz kılıyordu). Başlık artık mutlak konumlu sabit bir katman ve liste normal kaydırmasını koruyor; ikisinin de en iyisi.

## v1.38.3 (2026-06-12) — Ayarlar başlığı düzeltmesi

_v2.11.2 olarak yayımlandı._

### Düzeltildi
- **Ayarlar kategori çubuğu artık gerçekten sabit kalıyor**: bu yerleşimde `position: sticky` tutmuyordu; bu yüzden arama + kategori çipleri artık kaydırma alanının üstünde sabit bir başlık. Ayarları kaydırın, çipler yerinde kalır.

## v1.37.3 (2026-06-12) — Düzeltmeler

_v2.11.1 olarak yayımlandı._

### Düzeltildi
- **Cihaz üzerinde yapay zekâ sohbeti “Düşünüyor…” üzerinde takılıyordu**: yerel yol JSON gramer üretimini zorluyordu ve bu, küçük WebGPU modellerini kilitliyor. Cihaz üzerinde sohbet artık düz metin istemi kullanıyor (böylece gerçekten yanıt veriyor), yalnızca sohbetle sınırlı ve bir şey takılırsa bulut/Ollama’ya geri dönen 120 sn zaman aşımı var; böylece döndürücü asla sonsuza kadar dönemez.
- **Ayarlar kategori çubuğu artık sabit kalıyor**: kaydırırken (yapışkan stil, düz bir araç çubuğu sarmalayıcısına taşındı).

### Eklendi
- **Ayarlar’da arama çubuğu**: tüm ayarları anahtar sözcükle süzün; arama sırasında kategori çipleri gizlenir.

## v1.34.8 (2026-06-12) — Ekran görüntüsünden koda + ajanda MCP araçları

_v2.11.0 olarak yayımlandı._

### Eklendi
- **Ekran Görüntüsü → Kod** (Ctrl+K → “Screenshot → Code”): geçerli sayfayı yakalayın ve yapay zekânın onu tek, kendi kendine yeten bir dosya olarak yeniden oluşturmasını sağlayın. **Düz HTML+CSS**, **HTML+Tailwind** veya **React (CDN)** seçin, sonra sonucu yeni bir sekmede önizleyin ya da kodu kopyalayın. Ekran görüntüsü, hızlı ve ucuz kalması için yüklemeden önce istemci tarafında küçültülür. *(Yapay zekâ çalışanının yeni `screenshot-to-code` görsel eylemiyle yeniden dağıtılmış olmasını gerektirir; çalışanınız daha eskiyse uygulama net bir ileti gösterir.)*
- **Ajanda MCP araçları**: bağlı MCP sunucularınızdaki araçlar artık otonom ajana yerleşik eylemlerinin yanında sunuluyor (çakışmasınlar diye `mcp__…` ad alanıyla). Ajandan, bağlı bir MCP sunucusunun yapabileceği bir şeyi yapmasını isteyin; o aracı doğrudan çağırıp sonucu akıl yürütmesine geri besleyebilir. v2.10.0’daki bağımsız MCP gezgini elle yapılan çağrılar için hâlâ çalışıyor.

## v1.32.3 (2026-06-12) — MCP istemcisi

_v2.10.0 olarak yayımlandı._

### Eklendi
- **MCP Sunucuları** (Ayarlar → MCP Sunucuları veya Ctrl+K → “MCP Servers & Tools”): Vex’i HTTP üzerinden **Model Context Protocol** sunucularına bağlayın. Bir sunucu ekleyin (URL + isteğe bağlı bearer belirteci), Vex MCP el sıkışmasını yapar ve sunucunun araçlarını listeler; yerleşik bir **gezgin** de bir araç seçmenize, JSON bağımsız değişkenlerini doldurmanıza (aracın girdi şemasından önceden iskeletlenmiş) ve çalıştırmanıza, sonucu satır içinde görmenize izin verir. JSON-RPC trafiği Vex üzerinden vekil edilir; böylece CORS sınırı yoktur ve hem düz JSON hem de SSE yanıtları işlenir.
- Kapsam notu: bu bağımsız bir MCP istemcisi/gezginidir; MCP araçlarını otonom ajana bağlamak planlı bir devam çalışmasıdır, kararlı ajana dokunulmasın diye ayrı tutulmuştur.

## v1.29.8 (2026-06-12) — Cihaz üzerinde yapay zekâ (WebGPU)

_v2.9.0 olarak yayımlandı._

### Eklendi
- **Cihaz Üzerinde Yapay Zekâ** (Ayarlar → Cihaz Üzerinde Yapay Zekâ veya Ctrl+K → “On-Device AI”): küçük bir LLM’i WebGPU ile **tamamen kendi makinenizde** çalıştırın; özel, çevrimdışı, sunucusuz. Bir model seçin (Llama 3.2 1B/3B, Qwen 2.5 1.5B, Phi 3.5 mini), **İndir ve yükle**’ye basın (ağırlıklar bir kez iner ve önbelleğe alınır) ve “Sohbet ve özetler için cihaz üzerinde yapay zekâyı kullan”ı açın. Sohbet / özetleme / açıklama / çeviri bundan sonra yerelde çalışır; ajan ve çoklu sekme hâlâ bulutu kullanır.
- Tamamen isteğe bağlı ve güvenli: siz istemeden hiçbir şey indirilmez, WebGPU özellik olarak algılanır (cihazınızda yoksa seçenek kendini açıklar) ve cihaz üzerinde hazır değilse ya da hata verirse yönlendirici **otomatik olarak bulut/Ollama’ya döner**. Model seçiminiz hatırlanır.

## v1.24.8 (2026-06-12) — Siteler arası izleyici içgörüleri

_v2.8.0 olarak yayımlandı._

### Eklendi
- Gizlilik Raporu’nda (Ctrl+K → “Privacy Report”) **“Sizi sitelerde takip edenler”**: Vex artık engellenen her izleyicinin *hangi sitelerinizde* göründüğünü kaydediyor ve birden çok sitede görülenleri öne çıkarıyor: web’de sizi gerçekten takip eden şirketler, erişime göre sıralı ve site listesiyle. Ham engelleme sayısını gerçek bir gizlilik tablosuna çevirir (Ghostery/Disconnect tarzı).

## v1.22.8 (2026-06-12) — Kalıcı yapay zekâ belleği

_v2.7.0 olarak yayımlandı._

### Eklendi
- **Yapay Zekâ Belleği** (Ayarlar → Yapay Zekâ Belleği): Vex’e *her* sohbette aklında tutacağı gerçekleri ve tercihleri söyleyin: adınız, mesleğiniz, üslup (“kısa yanıtla”), diller, teknoloji yığınınız, konumunuz… Her yapay zekâ isteğinde bağlam olarak eklenirler; böylece asistan oturumlar arasında kim olduğunuzu unutmaz.
- **Bir şeyi hatırla** (Ctrl+K → “AI: Remember a Fact”): ayarları açmadan her yerden bir anı not edin.
- Hem yerel (Ollama) hem de bulut arka uçlarında çalışır; çalışanda değişiklik gerekmez ve tamamen ek niteliğindedir (kişiliğinizi ya da varsayılan istemi asla geçersiz kılmaz). Bellek cihaz başınadır ama Vex Sync açıkken **cihazlarınız arasında eşitlenir**. İstediğiniz zaman kapatın; bir gerçek eklemediğiniz sürece hiçbir şey gönderilmez.

## v1.17.8 (2026-06-12) — Geliştirici ve güçlü kullanıcı araçları

_v2.6.0 olarak yayımlandı._

### Eklendi
- **API istemcisi** (Ctrl+K → “API Client”): yerleşik bir REST istemcisi; bir yöntem seçin, başlıkları ve gövdeyi ayarlayın, Gönder’e basın ve yanıta daraltılabilir, sözdizimi renkli bir JSON ağacı (veya ham metin) olarak göz atın. CORS’suz (curl gibi ana süreçte çalışır); durumu, süreyi ve boyutu gösterir.
- **JSON’u biçimlendir** (Ctrl+K → “Format JSON”): geçerli ham JSON sekmesini aynı daraltılabilir ağaca çevirir.
- **Duyarlı Önizleme** (Ctrl+K → “Responsive Preview”): geçerli sayfayı iPhone SE / iPhone 14 / iPad / dizüstü / masaüstü genişliklerinde tek bir katmanda yan yana görün, tümünü yeniden yükle ile. Duyarlı yerleşimleri denetlemek için Polypane’in hafifi.
- **Bu Sayfayı İzle** (Ctrl+K): Vex bir sayfayı düzenli aralıklarla yeniden getirir, metne indirger ve **değiştiğinde sizi uyarır** (stok yenileme, belgeler, durum sayfaları, ilanlar). Her şeyi **İzlenen Sayfalar**’da yönetin; isteğe bağlı işletim sistemi bildirimleri. Her izleme kendi aralığında çalışır.
- **Wayback arşivleme**: “Save to Wayback Machine” geçerli sayfayı web.archive.org’da saklar; “View Archived Version” (sağ tık → bağlantılarda da) ölü/değişmiş bağlantıları kurtarmak için en son anlık görüntüyü açar.

## v1.12.8 (2026-06-12) — Gizlilik sağlamlaştırma paketi

_v2.5.0 olarak yayımlandı._

### Eklendi
- **Parmak izi koruması** (Ayarlar → Gizlilik Sağlamlaştırma, varsayılan kapalı): Brave tarzı “farbling”, izleme betiklerinin sizi parmak iziyle tanımak için özetlediği canvas / WebGL / ses çıktılarına oturum başına, algılanamayacak kadar küçük gürültü ekler ve `hardwareConcurrency` / `deviceMemory` / GPU dizelerini normalleştirir. Gürültü bir oturum içinde tutarlıdır (siteler çalışmaya devam eder) ama her açılışta değişir; böylece siteler arasında ya da zaman içinde sessizce eşlenemezsiniz. Açıp kapattıktan sonra açılan sayfalara uygulanır.
- **DNS-over-HTTPS** (Ayarlar → Gizlilik Sağlamlaştırma, varsayılan kapalı): DNS sorgularınızı Cloudflare, Google veya Quad9 üzerinden şifreleyin. *Fırsatçı* (güvenli, sistem DNS’ine geri döner) veya *Sıkı* (yalnızca DoH). Chromium’un güvenli çözümleyicisi sayesinde tarayıcı genelinde hemen uygulanır.
- **Gizlilik Raporu** (Ctrl+K → “Privacy Report” veya Ayarlar’daki düğme): bu oturumda kaç izleyici/reklamın engellendiğini, en çok engellenen alan adlarını ve parmak izi + DNS koruma durumunuzu gösteren canlı bir kalkan. Sayaçları istediğiniz zaman sıfırlayın.
- Mevcut reklam/izleyici engelleyici artık durdurduklarını **sayıyor**; böylece raporda gerçek rakamlar var.

## v1.5.3 (2026-06-12) — Okuma paketi: vurgular, geri çağırma ve erişilebilirlik

_v2.4.0 olarak yayımlandı._

### Eklendi
- **Kalıcı vurgular**: herhangi bir sayfada metin seçip vurgulayın (Ctrl+K → “Highlight” veya sağ tık → Highlight; sarı/yeşil/pembe). Vurgular URL başına yerel olarak saklanır ve sayfayı her ziyaret edişinizde **yeniden görünür**. Herhangi bir vurguya not ekleyin. Yeni **Vurgular** kenar çubuğu paneli tüm sayfalardaki her vurguyu sayfaya göre gruplanmış ve sayı rozetiyle listeler.
- **Geri çağırma (“memex”)**: okuduğunuz her şeyde tam metin arama. Gezinirken her sayfanın okunabilir metni yerel olarak dizinlenir (sınırlı, `userData/recall.json` içinde saklanır, asla yüklenmez). Yeni **Geri Çağırma** kenar çubuğu paneli herhangi bir sayfayı yalnızca başlığıyla değil *içeriğiyle* bulur: “DPI kısıtlaması hakkındaki o paragraf”. Kayıt dışı/kapsayıcı/dosya sayfaları asla dizinlenmez. Ayarlar → Geri Çağırma’dan açıp kapatın ve temizleyin.
- **Okuma ve Erişilebilirlik paketi** (Ayarlar → Okuma ve Erişilebilirlik), her sayfaya uygulanır:
  - **Disleksi dostu yazı tipleri**: Lexend, Atkinson Hyperlegible, OpenDyslexic.
  - **Renk görme filtreleri**: protanopi / döteranopi / tritanopi benzetimi + gri tonlama (feColorMatrix).
  - **Okuma cetveli**: yerinizi korumanız için imlecinizi izleyen yarı saydam bir çubuk.
  - **Bionic Reading** (Ctrl+K): okumayı hızlandırmak için her sözcüğün başını kalın yapar; geri almak için yeniden çalıştırın.
  - **Hızlı Okuma / RSVP** (Ctrl+K): makaleyi ayarlanabilir 150–900 WPM hızında her seferinde bir sözcük göstererek akıtır.
  - **Seçimi Çevir** (Ctrl+K): vurgulanan metni satır içinde kendi dilinize çevirin.

## v1.0.3 (2026-06-12) — Uyarlanabilir bellek bekçisi

_v2.3.2 olarak yayımlandı._

### Eklendi
- **Bellek bekçisi** (Ayarlar → Performans): toplam tarayıcı belleği bir tavanı (varsayılan 1,2 GB) aştığında Vex, tekrar altına inene kadar en az yakın zamanda kullanılan arka plan sekmelerini (etkin veya sabitlenmiş olanları asla) uyutur. Hafif oturumlara dokunulmaz; ağır olanlar sınırda kalır, böylece Vex normal kullanımı bölmeden tabanına yakın kalır. Kapalı / 0,9 / 1,2 / 1,6 / 2,4 GB.

## v0.34.6 (2026-06-12) — Tembel oturum geri yükleme (büyük bellek kazancı)

_v2.3.1 olarak yayımlandı._

### Değişti
- **Tembel oturum geri yükleme**: açılışta yalnızca odaktaki sekme bir webview yükler; kayıtlı oturumunuzun geri kalanı hafif yer tutucular (başlık + favicon) olarak geri gelir ve tıkladığınız anda belirir. Gerçek bir oturumda bu, başlangıç belleğini yaklaşık %60 düşürdü (≈950 MB → ≈390 MB özel). Uyuyan sekmeler ve sekme grupları etkilenmez; otomatik uyutma henüz yüklenmemiş sekmeleri atlar.

## v0.34.5 (2026-06-12) — Kitaplık, yapay zekâ sekme komutları ve daha fazlası

_v2.3.0 olarak yayımlandı._

### Eklendi
- **Sonra Oku / Kitaplık**: sayfaları bir kuyruğa kaydedin (Ctrl+K → “Read Later”), yeni Kitaplık kenar çubuğu panelinde okunmamış rozeti; açmak okundu olarak işaretler.
- **Otomatik arşivleme**: N gündür dokunulmamış sekmeler (Ayarlar → Kitaplık) açık kalıp çürümek yerine Kitaplık arşivine kapanır.
- **Notlara kırp**: seçili metin (veya sayfa bağlantısı) kaynak + tarihle sabitlenmiş bir “Kırpıntılar” notuna kaydedilir.
- **Yapay zekâ sekme komutları**: “tüm YouTube sekmelerini kapat”, “alışveriş sekmelerimi grupla”: yapay zekâ planlar, siz onaylarsınız, o uygular.
- **Şimdi Çalıyor**: ses çıkaran sekmeler için bir mini çubuk: oynat/duraklat, sessize al, sekmeye atla.
- **Siteyi kenar çubuğuna sabitle**: herhangi bir siteyi Vivaldi tarzı bir web paneli olarak tutun (sabitlemeyi kaldırmak için simgesine sağ tıklayın).
- **Kayıt dışı sekme**: geçici sekme: geçmiş yok, çerezler kapanınca kaybolur.
- **Patron tuşu**: Ctrl+Alt+H her Vex penceresini anında gizler ve sessize alır; geri yüklemek için tekrar basın.
- **Ters görsel arama**: herhangi bir görsele sağ tıklayın → Google Lens ile ara / kopyala / aç.
- **QR kodu**: geçerli sayfayı telefonunuzda açmak için Ctrl+K → “QR Code”.
- **Sekme başına ses seviyesi**: sekmeye sağ tık → “Page volume…”.
- **Kaynak İzleyici**: tarayıcı süreci başına canlı CPU/bellek.
- **Hızlı yuvalar**: Ctrl+Alt+1/2/3 ilk üç komut zincirinizi çalıştırır.
- **Ortam gruplama**: gruplanmış bir sekmeden açılan bağlantılar o gruba otomatik olarak katılır.

## v0.34.4 (2026-06-12) — Odak, hareketler, yer imleri, akışlar ve daha fazlası

_v2.2.0 olarak yayımlandı._

### Eklendi
- **Odak Modu**: Ctrl+K → “Focus 25/50”: oturum boyunca tüm arayüzü gizler ve dikkat dağıtan siteleri engeller (Ayarlar → Odak’ta düzenlenebilir engelleme listesi).
- **Kompakt Mod**: sayfa için azami alan sağlamak üzere iki kenar çubuğunu da daraltın (kalıcıdır).
- **Fare hareketleri**: sağ düğmeyi basılı tutup sürükleyin: ← geri, → ileri, ↑ en üst, ↓ yeniden yükle, ↓→ sekmeyi kapat, ↓← yeniden aç.
- **Yer imleri**: URL çubuğunda ☆ + klasörlü ve aramalı bir Yer imleri kenar çubuğu paneli.
- **Akışlar (RSS)**: minimal, algoritmasız bir akış okuyucu paneli.
- **Sesli Oku**: geçerli makale için metin okuma.
- **Yapay Zekâ Yazı**: yapay zekâ metni doğrudan sayfadaki odaktaki girdi alanına yazar/yeniden yazar.
- **Komut Zincirleri**: birkaç komut çubuğu eylemini tek komut olarak çalıştırın (Ayarlar → Komut Zincirleri).
- **Kapsayıcı sekmeler**: yalıtılmış çerezli İş/Kişisel/Alışveriş sekmeleri (iki hesapta aynı anda oturum açın).
- **Çerez bandı otomatik gizleme**: büyük onay duvarları gizlenir ve kaydırma kilidi açılır (Ayarlar’dan açıp kapatın).
- **Ekran görüntüsü açıklaması**: yakalanan ekran görüntülerinde kalem/kutu/ok düzenleyicisi.
- Eşitleme çalışanı: oturum açma için e-postasız geliştirme yedeği (RESEND_API_KEY yokken kodu döndürür).

## v0.34.3 (2026-06-12) — Göz atma, Beceriler, Güçlendirmeler, Devir ve Parolalar

_v2.1.0 olarak yayımlandı._

### Eklendi
- **Göz Atma (Peek)**: herhangi bir bağlantıya Shift+tıklayarak onu kayan bir katmanda önizleyin; Esc kapatır, Ctrl+Enter (veya tek tık) onu gerçek bir sekmeye yükseltir.
- **Yapay Zekâ Becerileri**: kaydedilmiş, yeniden kullanılabilir yapay zekâ komutları (“5 maddede özetle”, “5 yaşındaymışım gibi anlat”, …); komut çubuğundan geçerli sayfada çalışır; kendinizinkini Ayarlar → Yapay Zekâ Becerileri’nde oluşturun.
- **Güçlendirmeler (Boosts)**: site başına özelleştirme: **Öğeyi Gizle** (Ctrl+K) o sitede herhangi bir öğeyi sonsuza dek gizler; **Bu Siteyi Güçlendir** özel bir CSS/JS düzenleyicisi açar. Ayarlar → Güçlendirmeler’de yönetilir.
- **Telefona Gönder / Devir**: geçerli sekmeyi eşitleme çalışanı üzerinden diğer Vex cihazlarınıza gönderin (Ctrl+K → “Send to Phone”); Vex Mobile’dan gönderilen sekmeler burada otomatik açılır. Vex Sync oturumu gerektirir.
- **Parola yöneticisi**: Vex oturum açarken girişleri kaydetmeyi önerir, geri dönüşlerde otomatik doldurur ve Ayarlar → Parolalar’da listeler. İşletim sistemi anahtarlığıyla (safeStorage/DPAPI) bekleme halinde şifrelenir; site başına asla kaydetme listesi.

## v0.34.2 (2026-06-12) — Ayarlar yenilendi ve özelleştirilebilir kenar çubuğu

_v2.0.5 olarak yayımlandı._

### Eklendi
- **Özelleştirilebilir kenar çubuğu düğmeleri**: bir hizmet simgesine (Claude / WhatsApp / Spotify) sağ tıklayıp **Yeniden adlandır**, **Simgeyi değiştir** (15 simgeli seçici), **Bağlantıyı değiştir**, **Sil (gizle)** veya **Sıfırla**’yı seçin. Claude tek tıkla **Claude / Gemini / ChatGPT’ye geçebilir**. Özelleştirmeler açılışlar arasında kalıcıdır.

### Değişti
- **Ayarlar yeniden tasarımı**: düz liste artık simgeli, canlı, renk kodlu **kategori kartları**, bölümler arasında atlamak için yapışkan kategori gezintisi ve daha capcanlı anahtarlar/girdiler/düğmeler. Mevcut tüm ayarlar ve işleyiciler değişmedi.

## v0.34.1 (2026-06-12) — Rehberli tur

_v2.0.4 olarak yayımlandı._

### Eklendi
- **Etkileşimli tur**: her denetimi (adres çubuğu, dikey sekmeler, çalışma alanları, komut çubuğu, yapay zekâ ajanı, bölünmüş ekran…) ipuçları ve Geri / İleri / Atla ile vurgulayan bir spot ışığı gezintisi. İlk çalıştırmada otomatik sunulur; istediğiniz zaman `Ctrl+K` → “Tour” ile yeniden oynatın.

## v0.0.3 (2026-04-16) — Cila ve temizlik

_v1.2.0 olarak yayımlandı._

### Değişti
- Kenar çubuğundaki yinelenen yapay zekâ düğmesi kaldırıldı; üst çubuktaki düğme artık tek giriş noktası
- Ayarlar Hakkında: Electron/Chromium sürümleriyle belirgin sürüm gösterimi
- Birleştirilmiş bildirim toast’ları (sağdan kayarak girer, renk kodlu kenarlıklar)
- Pencerenin üstünde çalışma alanı vurgu rengi şeridi

### Eklendi
- URL çubuğunda URL’yi kopyala düğmesi
- Sekmeleri kapatmak için orta tıklama
- Tümünü seçmek için URL çubuğuna çift tıklama
- Ayarlar Hakkında’da Electron + Chromium sürüm bilgisi
- Ayarlar’da “Sorun Bildir” bağlantısı
- Güncelleme denetimi zaman damgası kalıcılığı

### Düzeltildi
- Yapay zekâ paneli artık kenar çubuğu panel sistemine kaydedilmiyor
- Tutarlı döndürücü ve boş durum CSS sınıfları artık genel olarak kullanılabilir

## v0.0.2 (2026-04-16) — Çoklu sekme yapay zekâ

_v1.1.0 olarak yayımlandı._
- Sekme seçici: Geçerli/Tümü/Grup/Özel sekme seçim kipleri
- Karşılaştırma tablolarıyla sekmeler arası yapay zekâ akıl yürütmesi
- Çoklu sekme bağlam çıkarımı (paralel, 60K karakter bütçesi)
- “Sekmeleri karşılaştır” ve “Sekmeleri özetle” hızlı eylemleri + komutları

## v0.0.0 (2026-04-16)

_v1.0.0 olarak yayımlandı._

### Özellikler
- Sürükleyerek yeniden sıralama ve sekme gruplarıyla dikey sekmeler
- Kenar çubuğu panelleri: WhatsApp, Claude AI, CUSA, Roblox, GitHub
- Düzenlenebilir kısayollar, hava durumu, GitHub istatistikleriyle özel başlangıç sayfası
- URL, arama ve yapay zekâ kipli komut çubuğu (Ctrl+K)
- 40’tan fazla alan adıyla reklam/izleyici engelleyici
- Sekme oturumları, çalışma alanları (Kişisel/CUSA/Okul/Geliştirme)
- Markdown önizlemeli Notlar paneli
- İlerleme takipli İndirmeler yöneticisi
- Aramalı ve tarih süzgeçli tam gezinti Geçmişi
- Sekme başına kullanım ve uyku kipli Bellek paneli
- Etkin olmayan sekmeleri otomatik uyutma
- Yeniden başlatmada sekme geri yükleme, yakın zamanda kapatılan sekmeler (Ctrl+Shift+T)
- 7 hazır ayar + özel renklerle tema düzenleyici
- Okuma kipi, çeviri, ekran görüntüleri
- Alan adı başına yakınlaştırma kalıcılığı
- Üzerine gelince sekme önizlemesi
- Kenar çubuklarının otomatik gizlendiği F11 tam ekran
- Video başına PiP düğmesi katmanı
- Sekme ses göstergesi + sessize alma (Ctrl+M)
- Gizli/özel pencereler
- Sekme sabitleme (yalnızca simge kipi)
- Sayfa bağlamından haberdar yapay zekâ asistanı paneli
- 19 araçlı yapay zekâ ajanı (gezin, tıkla, yaz, çıkar vb.)
- 3 izin kipi: Sor, Planla, Otomatik
- Şablonlu zamanlanmış yapay zekâ görevleri
- GitHub Releases ile otomatik güncelleyici
- Başlat Menüsü + Masaüstü kısayollu Windows yükleyicisi (NSIS)
