// === The language the main process speaks ====================================
//
// Vex's window is translated in the page (js/i18n-ui.js), but the native Windows dialogs (a file picker, "Vex stopped responding", the
// microphone question) are drawn by this process, which does not see the page's language. The window tells it (i18n:set-language) when
// the language is set or changed, and it is kept in a small file in the profile so the first dialog of the next start, which can come
// before any window exists ("Vex cannot open this profile"), is already in the right language.
//
// Only Turkish exists besides English. install(dialog) wraps the dialog functions so the text they are given is translated on its way
// to the screen; the call sites keep their English, and a text with no Turkish here is shown as written.
'use strict';

const FILE = 'language.txt';

// English -> Turkish. {1}, {2} stand for a value the code puts in; it is carried across as it is.
const TR = {
  'Choose the passwords file you exported': 'Dışa aktardığınız parola dosyasını seçin',
  'Password export (CSV)': 'Parola dışa aktarımı (CSV)',
  'Choose a picture to prepare': 'Hazırlanacak bir resim seçin',
  'Pictures': 'Resimler',
  'Save the prepared picture as a new file': 'Hazırlanan resmi yeni bir dosya olarak kaydedin',
  'Vex cannot open this profile': 'Vex bu profili açamıyor',
  '{1} Nothing was changed. To get your data back without Vex, close Vex and run: node scripts/profile-decrypt.js --profile "<profile folder>" (see docs/profile-lock.md).':
    '{1} Hiçbir şey değiştirilmedi. Verilerinizi Vex olmadan geri almak için Vex’i kapatın ve şunu çalıştırın: node scripts/profile-decrypt.js --profile "<profile folder>" (bkz. docs/profile-lock.md).',
  'Vex cannot ask for the passphrase': 'Vex parolayı soramıyor',
  'Save the recording': 'Kaydı kaydedin',
  'Listen to your microphone?': 'Mikrofonunuz dinlensin mi?',
  'Start listening': 'Dinlemeye başla',
  'Cancel': 'İptal',
  'Vex will listen to YOUR microphone for {1} and turn your voice into text.': 'Vex, {1} için SİZİN mikrofonunuzu dinleyecek ve sesinizi metne çevirecek.',
  'Only your microphone is used: the other people on a call are not captured, and the screen is not recorded. The sound is turned into text on this computer by the program you chose; nothing is sent anywhere. {1}Tell the people in the meeting that you are transcribing what you say. Vex will run, for each piece of audio: {2}':
    'Yalnızca mikrofonunuz kullanılır: aramadaki diğer kişiler yakalanmaz ve ekran kaydedilmez. Ses, seçtiğiniz program tarafından bu bilgisayarda metne çevrilir; hiçbir yere hiçbir şey gönderilmez. {1}Toplantıdaki kişilere söylediklerinizi yazıya döktüğünüzü söyleyin. Vex her ses parçası için şunu çalıştıracak: {2}',
  'Vex stopped responding': 'Vex yanıt vermeyi bıraktı',
  'The window is not answering. Reload it to get going again — your tabs and settings come back with it. Or wait, if something is still finishing.':
    'Pencere yanıt vermiyor. Yeniden devam etmek için yeniden yükleyin — sekmeleriniz ve ayarlarınız onunla birlikte geri gelir. Ya da bir şey hâlâ bitiyorsa bekleyin.',
  'Reload window': 'Pencereyi yeniden yükle',
  'Wait': 'Bekle',
  'Vex could not open this profile': 'Vex bu profili açamadı',
  'Where your clips are': 'Kliplerinizin bulunduğu yer',
  'Export a copy of this page': 'Bu sayfanın bir kopyasını dışa aktarın',
  'Web page, single file': 'Web sayfası, tek dosya',
  'Select extension folder (must contain manifest.json)': 'Uzantı klasörünü seçin (manifest.json içermeli)',
  'Select extension .zip or .crx': 'Uzantı .zip ya da .crx dosyasını seçin',
  'Extensions': 'Uzantılar',
  'Open a Vex pack': 'Bir Vex paketi açın',
  'Vex pack': 'Vex paketi',
  'Save your Vex pack': 'Vex paketinizi kaydedin',
  'Save': 'Kaydet',
  'Save as an e-book': 'E-kitap olarak kaydedin',
  'E-book': 'E-kitap',
  // The unlock window of an encrypted profile (main/profile-unlock.js)
  'Unlock Vex': 'Vex’in kilidini aç',
  'Too many tries - wait {1}': 'Çok fazla deneme - {1} bekleyin',
  'Wrong passphrase': 'Yanlış parola',
  'That recovery code does not open this profile': 'Bu kurtarma kodu bu profili açmıyor',
  'A recovery code is 32 letters and digits, in groups of four': 'Kurtarma kodu, dörderli gruplar halinde 32 harf ve rakamdır',
  'A passphrase is {1} to {2} characters': 'Bir parola {1} ile {2} karakter arasındadır',
  'Unknown way to unlock': 'Bilinmeyen kilit açma yolu',
  // Said to the page by passkeys.js
  '{1}. Use the site’s other sign-in methods.': '{1}. Sitenin diğer oturum açma yöntemlerini kullanın.',
  'Vex is locked. Unlock it to use a passkey.': 'Vex kilitli. Bir geçiş anahtarı kullanmak için kilidini açın.',
  '{1} asked for a passkey too many times, so Vex stopped asking for a minute.': '{1} çok fazla kez geçiş anahtarı istedi; bu yüzden Vex bir dakika sormayı bıraktı.',
  // The Windows notifications this process builds itself (notify.js, reminders.js, main.js, quiet-hours.js). A body is read line by line.
  'Alarm': 'Alarm',
  'Reminder': 'Hatırlatıcı',
  'Reminder — urgent': 'Hatırlatıcı — acil',
  'Snooze 9 min': 'Ertele 9 dk',
  'Open': 'Aç',
  'Mute this source': 'Bu kaynağı sustur',
  'Windows is almost out of memory': 'Windows’un belleği neredeyse bitti',
  'Only {1} GB of {2} GB is left to promise. Vex put its own tabs, AI and background work to rest. It has not touched {3}.':
    '{2} GB’ın yalnızca {1} GB’ı verilebilir durumda kaldı. Vex kendi sekmelerini, yapay zekâsını ve arka plan işlerini dinlendirdi. {3} uygulamasına dokunmadı.',
  'your game': 'oyununuz',
  'From the extension {1}': 'Uzantıdan: {1}',
  'Userscript {1}': 'Kullanıcı betiği {1}',
  'Userscript {1}: {2}': 'Kullanıcı betiği {1}: {2}',
  '{1} notifications held while you were away': 'Yokken tutulan {1} bildirim',
  // --- turkish sweep (agent): the pages Vex draws itself when it stops a site (main.js _showVexPage) ---
  'Blocked by Vex\'s ad blocker': 'Vex’in reklam engelleyicisi tarafından engellendi',
  'is on the ad and tracker lists Vex blocks, so this page was not loaded. Ads and sponsored links often go through an address like this one before the shop or site they point to.': 'sitesi Vex’in engellediği reklam ve izleyici listelerinde olduğu için bu sayfa yüklenmedi. Reklamlar ve sponsorlu bağlantılar, işaret ettikleri mağazaya ya da siteye gitmeden önce çoğu zaman bunun gibi bir adresten geçer.',
  'Go back': 'Geri dön',
  'Go anyway': 'Yine de git',
  'Secure connection not available': 'Güvenli bağlantı yok',
  'This site doesn\'t support a secure connection': 'Bu site güvenli bağlantıyı desteklemiyor',
  'did not answer over HTTPS, so HTTPS-Only mode stopped here instead of loading it unencrypted.': 'sitesi HTTPS üzerinden yanıt vermedi; bu yüzden Yalnızca HTTPS modu, siteyi şifresiz yüklemek yerine burada durdu.',
  'Over an unencrypted connection, anyone on the network (public Wi-Fi, your provider) can read and change what you see and send.': 'Şifresiz bir bağlantıda ağdaki herkes (herkese açık Wi-Fi, servis sağlayıcınız) gördüğünüz ve gönderdiğiniz şeyi okuyabilir ve değiştirebilir.',
  'Continue to the unencrypted site': 'Şifresiz siteye devam et',
  'If you continue, Vex loads': 'Devam ederseniz Vex,',
  'unencrypted until it closes, without asking again.': 'sitesini kapanana kadar şifresiz yükler ve bir daha sormaz.',
  'Certificate not valid': 'Sertifika geçerli değil',
  'This site\'s certificate is not valid': 'Bu sitenin sertifikası geçerli değil',
  'offered a secure connection whose certificate does not check out ({1}). It may be out of date or made for another site, or someone in the middle of your connection may be trying to read it.': 'sitesi sertifikası doğrulanamayan güvenli bir bağlantı sundu ({1}). Süresi dolmuş ya da başka bir site için yapılmış olabilir; ya da bağlantınızın ortasında biri onu okumaya çalışıyor olabilir.',
  'Vex did not load the page, so nothing you would send it has left your computer.': 'Vex sayfayı yüklemedi; bu yüzden ona göndereceğiniz hiçbir şey bilgisayarınızdan çıkmadı.',
  'If this is your own server or device, give it a certificate your computer trusts.': 'Bu sizin kendi sunucunuz ya da cihazınızsa, ona bilgisayarınızın güvendiği bir sertifika verin.',
  'offered a secure connection whose certificate does not check out. That is what happens when someone in the middle of your connection tries to read it.': 'sitesi sertifikası doğrulanamayan güvenli bir bağlantı sundu. Bağlantınızın ortasında biri onu okumaya çalıştığında bu olur.',
  'HTTPS-Only mode stopped here instead of loading the page over an unencrypted connection.': 'Yalnızca HTTPS modu, sayfayı şifresiz bir bağlantıyla yüklemek yerine burada durdu.',
  'If you trust this network and still want the page, you can': 'Bu ağa güveniyor ve sayfayı yine de istiyorsanız,',
  'load it unencrypted': 'şifresiz yükleyin',
  '. Anyone on the network can then read and change what you see and send.': '. O zaman ağdaki herkes gördüğünüz ve gönderdiğiniz şeyi okuyabilir ve değiştirebilir.',
  'This address looks like another site': 'Bu adres başka bir siteye benziyor',
  'is written to look like': 'sitesi şuna benzesin diye yazılmış:',
  ', and it is not that site. Vex stopped before loading it, so nothing you would type there has gone anywhere.': ', ama o site değil. Vex siteyi yüklemeden önce durdu; bu yüzden orada yazacağınız hiçbir şey bir yere gitmedi.',
  'is written the way sites that fake another site are, and it is not that site. Vex stopped before loading it, so nothing you would type there has gone anywhere.': 'sitesi, başka bir siteyi taklit eden sitelerin yazıldığı biçimde yazılmış ve o site değil. Vex siteyi yüklemeden önce durdu; bu yüzden orada yazacağınız hiçbir şey bir yere gitmedi.',
  'Why Vex flagged it': 'Vex bunu neden işaretledi',
  'Continue this once': 'Bunu bir kez sürdür',
  'This site is fine, do not warn again': 'Bu site sorunsuz, bir daha uyarma',
  'If you know this site, choosing “do not warn again” adds': 'Bu siteyi tanıyorsanız, “bir daha uyarma” seçeneği',
  'to your own list. You can change how often Vex warns, or switch this off, in Vex\'s Web safety settings.': 'sitesini kendi listenize ekler. Vex’in ne sıklıkla uyardığını değiştirebilir ya da bunu Vex’in Web güvenliği ayarlarından kapatabilirsiniz.',
  'The name looks like one that is made to be mistaken for another.': 'Ad, başka bir adla karıştırılsın diye yapılmış bir ada benziyor.',
  'One part of the name (“{1}”) mixes {2} letters, which honest sites do not do. It is the usual way to fake a familiar name.': 'Adın bir bölümü (“{1}”) {2} harflerini karıştırıyor; dürüst siteler bunu yapmaz. Tanıdık bir adı taklit etmenin olağan yoludur.',
  'The name is written with letters from another alphabet that look like “{1}”.': 'Ad, “{1}” gibi görünen başka bir alfabenin harfleriyle yazılmış.',
  'Swaps letters for numbers or lookalike pairs so that it reads as “{1}”.': 'Harfleri rakamlarla ya da benzer çiftlerle değiştirerek “{1}” gibi okunmasını sağlıyor.',
  '“{1}” appears at the front of the name, but the site really belongs to “{2}”.': 'Adın başında “{1}” geçiyor, ama site aslında “{2}” adresine ait.',
  'One letter away from “{1}” (two letters swapped), the kind of slip a copycat site registers on purpose.': '“{1}” adından bir harf farklı (iki harfin yeri değişmiş); taklitçi sitelerin bilerek kaydettiği türden bir hata.',
  'One letter away from “{1}” (a doubled letter), the kind of slip a copycat site registers on purpose.': '“{1}” adından bir harf farklı (çift yazılmış bir harf); taklitçi sitelerin bilerek kaydettiği türden bir hata.',
  'One letter away from “{1}” (a doubled letter dropped), the kind of slip a copycat site registers on purpose.': '“{1}” adından bir harf farklı (çift harflerden biri düşmüş); taklitçi sitelerin bilerek kaydettiği türden bir hata.',
  'Only one letter different from “{1}”.': '“{1}” adından yalnızca bir harf farklı.',
  'Written as “{1}” plus an official-sounding word, which is how fake sign-in pages are named.': '“{1}” artı resmî görünen bir sözcük olarak yazılmış; sahte oturum açma sayfaları böyle adlandırılır.',
  'The name uses letters outside the plain alphabet, which is easy to mistake for another name.': 'Ad, düz alfabenin dışında harfler kullanıyor; başka bir adla karıştırılması kolay.',
  'This site is reported as dangerous': 'Bu site tehlikeli olarak bildirilmiş',
  'may try to steal your passwords or put harmful software on this computer. Vex stopped before loading it, so nothing you would type there has gone anywhere.': 'sitesi parolalarınızı çalmaya ya da bu bilgisayara zararlı yazılım yüklemeye çalışabilir. Vex siteyi yüklemeden önce durdu; bu yüzden orada yazacağınız hiçbir şey bir yere gitmedi.',
  'The site name': 'Site adı:',
  'is on a list of reported phishing and malware sites.': 'bildirilen kimlik avı ve kötü amaçlı yazılım sitelerinin listesinde yer alıyor.',
  'Go back to safety': 'Güvenli yere dön',
  'Continue anyway': 'Yine de devam et',
  'Only go on if you are sure this site is safe. Vex will note that you continued to': 'Yalnızca bu sitenin güvenli olduğundan eminseniz devam edin. Vex,',
  'in this tab.': 'sitesine bu sekmede devam ettiğinizi not eder.',
  'I understand the risk, open the site': 'Riski anlıyorum, siteyi aç',
  'Never warn me about this site': 'Bu site için beni bir daha uyarma',
  'This is the test page, so nothing was opened and nothing was saved. A real warning would have gone on to the site here.': 'Bu bir sınama sayfası; bu yüzden hiçbir şey açılmadı ve hiçbir şey kaydedilmedi. Gerçek bir uyarıda burada siteye geçilirdi.',
  'Checked on this computer against a list Vex keeps; the address you went to was not sent anywhere. You can turn this off, or see the list, in Vex Settings under Privacy and security.': 'Vex’in tuttuğu bir listeye karşı bu bilgisayarda denetlendi; gittiğiniz adres hiçbir yere gönderilmedi. Bunu kapatabilir ya da listeyi Vex Ayarları’nda Gizlilik ve güvenlik altında görebilirsiniz.',
  'This exact page address is on a list of reported phishing and malware pages.': 'Bu sayfa adresi, bildirilen kimlik avı ve kötü amaçlı yazılım sayfaları listesinde yer alıyor.',
  'This is a test. No real site is involved and nothing was downloaded; it shows what you would see for a site on the list.': 'Bu bir sınamadır. Gerçek bir site söz konusu değil ve hiçbir şey indirilmedi; listedeki bir site için neyi göreceğinizi gösterir.',
  // --- end turkish sweep ---
  // --- panels and dialogs sweep (agent) ---
  'Choose a file to scan with Microsoft Defender': 'Microsoft Defender ile taranacak bir dosya seçin',
  'Download location': 'İndirme konumu',
  'File to serve for a rule': 'Bir kural için sunulacak dosya',
  'Folder of your clone': 'Klonunuzun klasörü',
  'Folder the service runs in': 'Hizmetin çalıştığı klasör',
  'Folder where your Vencord plugin writes vex-bridge.json': 'Vencord eklentinizin vex-bridge.json dosyasını yazdığı klasör',
  'Log file to follow (read-only)': 'İzlenecek günlük dosyası (salt okunur)',
  'Program to start': 'Başlatılacak program',
  'Start in safe mode': 'Güvenli modda başlat',
  'The dist/browser.js of your own Vencord checkout': 'Kendi Vencord kopyanızın dist/browser.js dosyası',
  'Too many requests at once for one script': 'Tek bir betik için aynı anda çok fazla istek',
  'Your copy: {1}': 'Kopyanız: {1}',
  'Let your Vencord plugin change your Discord status?': 'Vencord eklentiniz Discord durumunuzu değiştirsin mi?',
  'Post to your Discord webhook and ping everyone?': 'Discord webhook’unuza gönderilsin ve herkese bildirim gitsin mi?',
  'To: {1}': 'Kime: {1}',
  'Text: {1}': 'Metin: {1}',
  'Emoji: {1}': 'Emoji: {1}',
  'Allow': 'İzin ver',
  'Post': 'Gönder',
  'Scan': 'Tara',
  'Start': 'Başlat',
  'Add': 'Ekle',
  'Scan this file with Microsoft Defender?': 'Bu dosya Microsoft Defender ile taransın mı?',
  'Vex will run:': 'Vex şunu çalıştıracak:',
  'The file is scanned on this computer; nothing is uploaded. Defender may quarantine it if it finds a threat.': 'Dosya bu bilgisayarda taranır; hiçbir şey yüklenmez. Defender bir tehdit bulursa dosyayı karantinaya alabilir.',
  'Bookmarks bar': 'Yer imleri çubuğu',
  'Other bookmarks': 'Diğer yer imleri',
  'a repeated group that holds a repeat or an alternative can take far too long to match': 'bir tekrar ya da seçenek içeren tekrarlı bir grup eşleşmesi çok uzun sürebilir',
  'back-references are not supported': 'geri başvurular desteklenmiyor',
  'lookahead and lookbehind are not supported': 'ileri ve geri bakış desteklenmiyor',
  'named groups and inline flags are not supported': 'adlandırılmış gruplar ve satır içi bayraklar desteklenmiyor',
  'the pattern has characters that are not plain ASCII': 'desen düz ASCII olmayan karakterler içeriyor',
  'the pattern has no capture group': 'desende yakalama grubu yok',
  'the pattern is empty': 'desen boş',
  'the pattern is not closed': 'desen kapatılmamış',
  'the pattern repeats too many times': 'desen çok fazla kez tekrarlanıyor',
  'a RIFF media file': 'bir RIFF medya dosyası',
  'a video or audio file': 'bir video ya da ses dosyası',
  'an old Office document or an installer package': 'eski bir Office belgesi ya da bir yükleyici paketi',
  'Where is {1}?': '{1} nerede?',
  'the Start menu shortcut "{1}"': '“{1}” Başlat menüsü kısayolu',
  'the installed-programs list (uninstall entry)': 'yüklü programlar listesi (kaldırma girdisi)',
  'the location chosen in Settings': 'Ayarlar’da seçilen konum',
  'A stored value has an unusable name': 'Saklanan bir değerin adı kullanılamaz durumda',
  'Name of {1} characters.': 'Adı {1} karakter.',
  'An old history.json is still in the data folder': 'Veri klasöründe hâlâ eski bir history.json var',
  'Vex folds it into the browsing history at start and then removes it; if it stays, that step failed (see the log).': 'Vex bunu başlangıçta gezinti geçmişine katar ve sonra kaldırır; kalıyorsa bu adım başarısız olmuştur (günlüğe bakın).',
  'It cannot be read ({1}). Vex keeps a copy of the file before each save; that copy reads correctly.': 'Okunamıyor ({1}). Vex her kayıttan önce dosyanın bir kopyasını tutar; o kopya doğru okunuyor.',
  'It cannot be read ({1}), so Vex reads it as empty. The file itself is left on disk.': 'Okunamıyor ({1}); bu yüzden Vex onu boş sayar. Dosyanın kendisi diskte bırakılır.',
  '{1} is damaged, and its backup copy is fine': '{1} bozuk, ancak yedek kopyası sağlam',
  '{1} is damaged and has no good backup copy': '{1} bozuk ve sağlam bir yedek kopyası yok',
  'Put the backup copy back in place of {1}. The damaged file is kept for undo.': 'Yedek kopyayı {1} yerine geri koyun. Bozuk dosya, geri almak için saklanır.',
  'It may be the only copy of that store, so it is left alone.': 'O deponun tek kopyası olabilir; bu yüzden dokunulmaz.',
  'Its copies were converted into backups by an earlier version.': 'Kopyaları, önceki bir sürüm tarafından yedeklere dönüştürüldü.',
  'Left by a save that was interrupted. Vex never reads it.': 'Yarıda kalan bir kayıttan kaldı. Vex bunu hiç okumaz.',
  'Leftover temporary file {1} ({2})': 'Artık geçici dosya {1} ({2})',
  'Starts with "{1}…" and is not valid JSON ({2}).': '“{1}…” ile başlıyor ve geçerli bir JSON değil ({2}).',
  'The old settings-backups folder is empty': 'Eski ayar yedekleri klasörü boş',
  'The old settings-backups folder still holds {1} file(s)': 'Eski ayar yedekleri klasöründe hâlâ {1} dosya var',
  'An earlier version could not convert them into backups; Vex tries again on every start. They are left alone.': 'Önceki bir sürüm bunları yedeğe dönüştüremedi; Vex her başlangıçta yeniden dener. Onlara dokunulmaz.',
  'Remove the empty folder.': 'Boş klasörü kaldırın.',
  'The settings could not be read': 'Ayarlar okunamadı',
  'Vex does not list or restore it. It is left alone.': 'Vex bunu listelemez ya da geri yüklemez. Dokunulmaz.',
  'Save a copy of the picture': 'Resmin bir kopyasını kaydedin',
  'Save a copy of the PDF': 'PDF’nin bir kopyasını kaydedin',
  'Save a copy': 'Bir kopya kaydedin',
  'Save the document': 'Belgeyi kaydedin',
  'Save the new PDF': 'Yeni PDF’yi kaydedin',
  'Save as PDF': 'PDF olarak kaydet',
  'Choose PDF files': 'PDF dosyalarını seçin',
  'Choose a folder for the {1} new PDFs': 'Yeni {1} PDF için bir klasör seçin',
  'Save here': 'Buraya kaydet',
  'Save authenticator backup': 'Kimlik doğrulayıcı yedeğini kaydedin',
  'Export passwords': 'Parolaları dışa aktar',
  'New note': 'Yeni not',
  'Reopen last closed tab': 'Son kapatılan sekmeyi yeniden aç',
  'Vex mini window': 'Vex mini pencere',
  'Vex second screen': 'Vex ikinci ekran',
  'Reset timers': 'Zamanlayıcıları sıfırla',
  'Keyword search with stemming. Pick an embedding model in Settings › Recall to add search by meaning.': 'Kök bulmalı anahtar sözcük araması. Anlama göre aramayı eklemek için Ayarlar › Hatırlama’dan bir gömme modeli seçin.',
  'Off. Pick an embedding model in Settings › Recall.': 'Kapalı. Ayarlar › Hatırlama’dan bir gömme modeli seçin.',
  'this year': 'bu yıl',
  'Allow Vex to start programs?': 'Vex’in program başlatmasına izin verilsin mi?',
  'QEMU virtual machine (disk image in the folder)': 'QEMU sanal makinesi (klasördeki disk görüntüsü)',
  'Vex may start and stop the dev servers you list here: only the commands you add yourself, each in the folder you choose, and never by itself or for a web page. You are shown the exact program and arguments before anything is saved or started.': 'Vex, burada listelediğiniz geliştirme sunucularını başlatıp durdurabilir: yalnızca kendi eklediğiniz komutlar, her biri seçtiğiniz klasörde ve asla kendiliğinden ya da bir web sayfası için değil. Herhangi bir şey kaydedilmeden ya da başlatılmadan önce size tam program ve bağımsız değişkenler gösterilir.',
  'Vex will run exactly this, with no shell:': 'Vex tam olarak bunu, kabuk olmadan çalıştıracak:',
  'in the folder:': 'şu klasörde:',
  'Program: {1}': 'Program: {1}',
  'It is started only when you press Start.': 'Yalnızca Başlat’a bastığınızda başlatılır.',
  'The arguments are fixed from now on. It is started only when you press Start, and the exact command is shown again the first time in each session.': 'Bağımsız değişkenler bundan sonra sabittir. Yalnızca Başlat’a bastığınızda başlatılır ve tam komut her oturumda ilk seferde yeniden gösterilir.',
  'Add "{1}" to your local services?': '“{1}” yerel hizmetlerinize eklensin mi?',
  'Add "{1}" to your own list of programs?': '“{1}” kendi program listenize eklensin mi?',
  'Start "{1}"?': '“{1}” başlatılsın mı?',
  'node <script.js> [words]': 'node <betik.js> [sözcükler]',
  'npm run <script>': 'npm run <betik>',
  'pnpm run <script>': 'pnpm run <betik>',
  'python <script.py> [words]': 'python <betik.py> [sözcükler]',
  'uv run <tool> [words]': 'uv run <araç> [sözcükler]',
  'Dated list': 'Tarihli liste',
  'Page action': 'Sayfa eylemi',
  'Phrases to copy': 'Kopyalanacak ifadeler',
  'Quotes or fortunes': 'Alıntılar ya da fallar',
  'The passkey request failed': 'Geçiş anahtarı isteği başarısız oldu',
  'GitHub read-only token': 'GitHub salt okunur belirteci',
  'Saved passwords': 'Kayıtlı parolalar',
  'Tool-server sign-ins': 'Araç sunucusu oturumları',
  'A Tor tab is never given screen sharing.': 'Bir Tor sekmesine hiçbir zaman ekran paylaşımı verilmez.',
  'Allow screen sharing here': 'Burada ekran paylaşımına izin ver',
  'No screen or window was chosen within 90 seconds, so the request was dropped.': '90 saniye içinde bir ekran ya da pencere seçilmedi; bu yüzden istek bırakıldı.',
  'Open site settings': 'Site ayarlarını aç',
  'Open the bypass setting': 'Aşma ayarını aç',
  'Screen sharing only works on a secure (https) page.': 'Ekran paylaşımı yalnızca güvenli (https) bir sayfada çalışır.',
  'That share request had already expired.': 'Bu paylaşım isteğinin süresi zaten dolmuştu.',
  'The Strong bypass (ByeDPI) is not carrying this page.': 'Güçlü aşma (ByeDPI) bu sayfayı taşımıyor.',
  'The browsing session of this tab has no screen-sharing picker attached, so a share would silently do nothing.': 'Bu sekmenin gezinti oturumuna bağlı bir ekran paylaşımı seçicisi yok; bu yüzden paylaşım sessizce hiçbir şey yapmazdı.',
  'The page that asked for the share is gone.': 'Paylaşımı isteyen sayfa artık yok.',
  'The page that asked was closed or replaced before you chose.': 'İsteyen sayfa, siz seçmeden önce kapatıldı ya da değiştirildi.',
  'The request belongs to another Vex window.': 'İstek başka bir Vex penceresine ait.',
  'The request did not come from a Vex tab (a hidden or pop-up frame), so Vex cannot show its picker for it.': 'İstek bir Vex sekmesinden (gizli ya da açılır pencere çerçevesi) gelmedi; bu yüzden Vex bunun için seçicisini gösteremez.',
  'The screen or window you chose is no longer there.': 'Seçtiğiniz ekran ya da pencere artık yok.',
  'The share could not start: {1}': 'Paylaşım başlatılamadı: {1}',
  'Try again': 'Yeniden dene',
  'Vex could not read the requesting frame to validate the screen share. Retry, and include this reason in your report.': 'Vex, ekran paylaşımını doğrulamak için isteyen çerçeveyi okuyamadı. Yeniden deneyin ve bildiriminize bu nedeni ekleyin.',
  'Vex could not validate the requesting frame’s origin. The screen share was stopped before opening the picker.': 'Vex isteyen çerçevenin kaynağını doğrulayamadı. Ekran paylaşımı, seçici açılmadan önce durduruldu.',
  'Windows listed no screens or windows to share. Check Settings > Privacy > Screen capture, or a protected or disconnected display.': 'Windows paylaşılacak ekran ya da pencere listelemedi. Ayarlar > Gizlilik > Ekran yakalama bölümüne ya da korumalı veya bağlantısı kesilmiş bir ekrana bakın.',
  'Windows would not list the screens: {1}': 'Windows ekranları listelemedi: {1}',
  'Disable it in Settings › Extensions if you do not need it right now. Vex will not turn an extension off for you.': 'Şu an gerekmiyorsa Ayarlar › Uzantılar’dan devre dışı bırakın. Vex sizin yerinize bir uzantıyı kapatmaz.',
  'Many restored tabs, extensions and a busy disk all add to it. Fewer pinned tabs or sleeping groups at start helps.': 'Çok sayıda geri yüklenen sekme, uzantı ve yoğun bir disk buna katkıda bulunur. Başlangıçta daha az sabit sekme ya da uyuyan grup yardımcı olur.',
  'No single tab stands out. Closing tabs you are done with is the biggest lever.': 'Öne çıkan tek bir sekme yok. İşiniz biten sekmeleri kapatmak en büyük kaldıraçtır.',
  'This PC is on its battery. Battery mode puts idle tabs to sleep sooner and holds background jobs until it is plugged in.': 'Bu bilgisayar pille çalışıyor. Pil modu boştaki sekmeleri daha erken uyutur ve arka plan işlerini fişe takılana kadar bekletir.',
  'Turn off animations on battery': 'Pildeyken animasyonları kapat',
  'Turn on battery mode': 'Pil modunu aç',
  'Encrypted DNS and a split handshake': 'Şifreli DNS ve bölünmüş el sıkışma',
  'Use this file': 'Bu dosyayı kullan',
  'Follow this file': 'Bu dosyayı izle',
  'Select folder': 'Klasör seç',
  'Choose folder': 'Klasör seç',
  'Use this build': 'Bu derlemeyi kullan',
  'Use this folder': 'Bu klasörü kullan',
  'Use this program': 'Bu programı kullan',
  'Choose': 'Seç',
  'Programs': 'Programlar',
  'OK': 'Tamam',
  'Starts without extensions': 'Uzantılar olmadan başlar',
  'Open Notes with a new, empty note': 'Notları yeni, boş bir notla aç',
  'New workspace': 'Yeni çalışma alanı',
  'Make a new workspace': 'Yeni bir çalışma alanı oluştur',
  'Bring back the tab you closed last': 'En son kapattığınız sekmeyi geri getir',
  'Quick capture': 'Hızlı yakalama',
  'A small box for a note, a reminder or a timer': 'Bir not, hatırlatıcı ya da zamanlayıcı için küçük bir kutu',
  'Extract {1} here?': '{1} burada çıkarılsın mı?',
  'Extract': 'Çıkar',
  '{1} files, {2} when unpacked.': 'Açıldığında {1} dosya, {2}.',
  '1 file, {1} when unpacked.': 'Açıldığında 1 dosya, {1}.',
  'It will be unpacked into a new folder:': 'Yeni bir klasöre açılacak:',
  'Vex refuses unsafe paths and links, never overwrites a file, and keeps the "downloaded from the internet" mark on what it writes, so Windows still checks a program that comes out of it.': 'Vex güvenli olmayan yolları ve bağlantıları reddeder, hiçbir dosyanın üzerine yazmaz ve yazdıklarında “internetten indirildi” işaretini korur; böylece Windows içinden çıkan bir programı yine denetler.',
  // --- end panels and dialogs sweep ---
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Keys with a hole become patterns that carry the value across.
const TEMPLATES = Object.keys(TR).filter(k => /\{\d\}/.test(k)).map(k => {
  const parts = k.split(/\{\d\}/);
  const order = [...k.matchAll(/\{(\d)\}/g)].map(m => m[1]);
  return { re: new RegExp('^' + parts.map(escapeRe).join('([\\s\\S]*?)') + '$'), order, value: TR[k] };
});

function translate(text, lang) {
  if (lang !== 'tr' || typeof text !== 'string' || !text) return text;
  if (Object.prototype.hasOwnProperty.call(TR, text)) return TR[text];
  for (const t of TEMPLATES) {
    const m = t.re.exec(text);
    // A value put in is translated too when it is a phrase of the table ("your game").
    if (m) return t.value.replace(/\{(\d)\}/g, (all, n) => { const i = t.order.indexOf(n); return i === -1 ? all : translate(m[i + 1], lang); });
  }
  // A notification body is several lines ("…\nFrom the extension Foo"): each line on its own.
  if (text.includes('\n')) return text.split('\n').map(line => translate(line, lang)).join('\n');
  return text;
}

// The options of a dialog call with their text translated: title, message, detail, button labels, checkbox label, filter names.
function localizeOptions(opts, lang) {
  if (lang !== 'tr' || !opts || typeof opts !== 'object' || Array.isArray(opts)) return opts;
  const out = { ...opts };
  for (const k of ['title', 'message', 'detail', 'checkboxLabel', 'buttonLabel']) if (typeof out[k] === 'string') out[k] = translate(out[k], lang);
  if (Array.isArray(out.buttons)) out.buttons = out.buttons.map(b => translate(b, lang));
  if (Array.isArray(out.filters)) out.filters = out.filters.map(f => (f && typeof f.name === 'string' ? { ...f, name: translate(f.name, lang) } : f));
  return out;
}

// The text of a page Vex draws itself (the dangerous-site warning, the certificate notice, the ad-blocked page): every piece of text
// between tags that is, whole, a key of TR is replaced; markup, styles, links and the host names the code puts in are left alone.
function translateHtml(html, lang) {
  if (lang !== 'tr' || typeof html !== 'string') return html;
  const unesc = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = html.split(/(<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>)/i);
  return parts.map((part, i) => (i % 2 ? part : part.replace(/(<title>|>)([^<>]+)(?=<)/g, (all, open, text) => {
    const core = text.trim();
    if (!core) return all;
    const plain = unesc(core);
    const hit = translate(plain, lang);
    if (hit === plain) return all;
    return open + /^\s*/.exec(text)[0] + esc(hit) + /\s*$/.exec(text)[0];
  }))).join('');
}

function create({ fs, dir }) {
  let lang = 'en';
  const file = require('path').join(dir, FILE);
  try { const saved = fs.readFileSync(file, 'utf8').trim(); if (saved === 'tr') lang = 'tr'; }
  catch (err) { if (err && err.code !== 'ENOENT') console.warn('[i18n-main] the saved language could not be read:', err.message); }

  return {
    language: () => lang,
    // The window says which language Vex is in. Anything but 'tr' is English. Written only when it changes.
    setLanguage(next) {
      const value = next === 'tr' ? 'tr' : 'en';
      if (value === lang) return lang;
      lang = value;
      try { fs.writeFileSync(file, value + '\n', 'utf8'); }
      catch (err) { console.warn('[i18n-main] the language could not be saved for the next start:', err.message); }
      return lang;
    },
    t: (text) => translate(text, lang),
    translateHtml: (html) => translateHtml(html, lang),
    // Wrap the dialog functions of Electron's dialog module (once) so the text they show is translated.
    install(dialog) {
      if (!dialog || dialog.__vexI18n) return;
      const self = this;
      for (const name of ['showMessageBox', 'showMessageBoxSync', 'showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync']) {
        const original = dialog[name];
        if (typeof original !== 'function') continue;
        dialog[name] = function (...args) { return original.apply(dialog, args.map(a => localizeOptions(a, self.language()))); };
      }
      if (typeof dialog.showErrorBox === 'function') {
        const original = dialog.showErrorBox;
        dialog.showErrorBox = function (title, content) { return original.call(dialog, translate(title, self.language()), translate(content, self.language())); };
      }
      Object.defineProperty(dialog, '__vexI18n', { value: true });
    },
  };
}

module.exports = { create, translate, translateHtml, localizeOptions, TR };
