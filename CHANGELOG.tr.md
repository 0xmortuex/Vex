# Değişiklik günlüğü (Türkçe)

Bu dosya CHANGELOG.md’nin Türkçesidir. Vex Türkçe olduğunda “Yenilikler” kartı ve pencereleri bu metinleri gösterir; bir sürümün Türkçesi burada yoksa İngilizcesi gösterilir. Başlık biçimi İngilizce dosyayla aynıdır (`## v<sürüm> (tarih) — Başlık`), `(feature: kimlik)` etiketleri olduğu gibi kalır.

## v37.34.9 (2026-10-21) — Türkçe sürüm notları, sekmelerinizin yanında yeni sekme düğmesi ve tamamı Türkçe kurulum sihirbazı

### Yeni
- **Sürüm notları Türkçe.** Vex Türkçe olduğunda güncelleme kapağı, “Yenilikler” kartı ve penceresi, Tekrar hoş geldiniz rehberi ve yeni özellikler penceresi notları Türkçe gösterir. Türkçe notu olmayan bir sürüm İngilizce notlarını gösterir. En yeni beş sürüm çevrildi ve bundan sonraki her sürüm çevrilecek. Deneyin: Dili Türkçe yapın, Ctrl+K’ye basın, “Yenilikler”i çalıştırın ve en yeni sürümlerin Türkçe olduğunu görün.

### Değişti
- **Yeni sekme düğmesi son sekmenizi izler.** Eskiden çubuğun en sağında dururdu. Çubuğun boş kısmı pencereyi sürüklemek için kullanılmaya devam eder ve pencere düğmeleri sağda kalır. Safari görünümü sekmelerini çubuğu dolduracak şekilde korur. Deneyin: Üç sekme açın ve + işaretinin üçüncüden hemen sonra olduğunu görün.

### Düzeltildi
- **Kurulum sihirbazı Türkçede yarı İngilizceydi.** Türkçe seçildikten sonra başlıkların altındaki açıklamalar 23 adımın çoğunda İngilizce kalıyordu (görünüm seçenekleri, bellek ve gizlilik, oturum açma kodları, Bulut yapay zekâ, Eşitleme, parolalar, bildirimler ve son adım) ve ilk adımdaki iki seçenek de öyleydi. Hepsi artık Türkçe. Deneyin: Ctrl+K’ye basın, “Kurulum sihirbazı”nı çalıştırın, Türkçe’yi seçin ve sihirbazın tamamını adım adım gezin.
- **Parantez içinde not olan metinler Türkçede yarı İngilizce kalıyordu.** “Posta (needs your permission)” gibi etiketlerde artık not da çevriliyor. Deneyin: Dili Türkçe yapın, Ayarlar’ı açın, Özet’i bulun ve Posta satırına bakın.

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
- **Kayıtlı listenin reddettiği bir kısayol, yer imi ya da geçmiş girdisi artık her kaydı engelleyemez.** Yeni Sekme sayfasının kutucuk düzenleyicisi boşluklu metni, `javascript:`, `ftp://` ve `mailto:` kabul ediyordu, kısayol çubuğu düzenleyicisi `about:` ve aynı türden metinleri kabul ediyordu, yer imleri ve geçmiş 8192 karakterden uzun bir adresi ya da 4096’dan uzun bir yer imi başlığını kabul ediyordu. Bunların her biri sonraki her ayar kaydının “Invalid saved URL” ile başarısız olmasına yol açıyordu. Her iki düzenleyici, yer imi yıldızı, “seçili sekmeleri yer imine ekle” ve geçmiş artık bunu kaynağında net bir iletiyle durduruyor. Deneyin: Yer imi çubuğunun sağ ucundaki “Kısayol ekle”ye tıklayın, bir ad ve bağlantı olarak `benim sevdiğim site` yazın, Kaydet’e basın ve “Bu, Vex’in kaydedebileceği bir bağlantı değil” dediğini ve kutuyu açık tuttuğunu görün.
- **Reddedilen bir kayıt artık sorunun nerede olduğunu söylüyor.** “Invalid saved URL” girdiyi bulmanın yolunu vermiyordu; artık liste ve girdi numarasıyla bitiyor, örneğin “(bookmarks, entry 2)”.
- **İletişim kutularındaki alanlar tarayıcının kendi küçük biçimsiz kutularıydı.** Ev işleri ve faturalar, Saat dilimi yardımcısı, Moderatör takımı, Yazı masası, Müfredat kapsamı ve Sıfırlama zamanlayıcıları artık Ayarlar’daki aynı metin kutularını ve açılır listeleri kullanıyor. Varsayılan görünümde gerçek Chromium’da denetlendi; Firefox görünümüne bakılmadı. Deneyin: Ctrl+K’ye basın, “Saat dilimi yardımcısı”nı çalıştırın ve metin kutusunun yuvarlak köşeleri olduğunu, tıkladığınızda görünür bir çerçeve çıktığını görün.
- **Sıfırlama zamanlayıcıları: boş “Gün” ve “An” satırları gitti.** Yalnızca denetim gizleniyordu, bu yüzden etiketler ekranda kalıyordu. Deneyin: Ctrl+K’ye basın, “Sıfırlama ve sezon zamanlayıcıları”nı çalıştırın ve “Her gün”ü seçince yalnızca Ad, Ne sıklıkta, Saat, Saat dilimi ve Hatırlatıcı’nın göründüğünü görün.
- **Ayarlar > Hakkında, Vex kaynaktan çalıştırıldığında “DRM başarısız”ı açıklıyor.** O sürüm imzalı değil, bu yüzden korumalı video hiçbir şey yanlış olmadan başarısız olabilir; satır artık bunu söylüyor. Kurulu Vex değişmedi.

### Yeni
- **Sürüm elle denetim listesi tam adımlar taşıyabilir.** `Try: <adımlar>` ile biten bir değişiklik günlüğü maddesi, bu sözleri Ayarlar > Sürüm denetimi’nde ve `scripts/release-checklist.js` içinde “Bunu yapın” satırı olarak gösterir.
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
