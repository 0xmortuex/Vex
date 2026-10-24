// === The Vex Extension Store: the list ======================================
// One reviewable file. Every entry here is an extension from its REAL source;
// Vex hosts no copies of anyone's code:
//
//   * `webstoreId` entries install from the Chrome Web Store. Vex downloads the
//     package from Google's own update server and installs it only when its
//     CRX3 signatures check out, including that the id is the developer's own
//     key (src/main/webstore.js). The id was taken from the project's own README
//     or site, and proven by fetching and verifying its package.
//   * the catalogue's GitHub entries (js/extension-catalog.js: first-party
//     extensions and uBlock Origin) install from the publisher's own release
//     (src/main/extension-sources.js). They are added by combined() below.
//
// Each entry was installed into a throwaway profile and opened on the site it is
// for, then marked honestly:
//
//   level  'full'     it loads and does its job under Electron's extension support;
//          'partial'  it loads and the main part works, but something it offers
//                     does not (said in `caveat`), or Vex already does it itself;
//          'none'     does not work. Such an entry is dropped, not listed: the
//                     validity test refuses one.
//   works  what happens in Vex, in a sentence (the reason behind the badge);
//   caveat what will not work or what to know, or null;
//   sizeKB the package as the store served it when it was checked (a guide: updates change it);
//   tr     the Turkish of what / works / caveat, shown when Vex is in Turkish.
//
// Electron's limits (see extension-catalog.js): no blocking webRequest, no
// userScripts or DevTools panels, nothing in Private or Tor tabs.
const VexExtensionStoreData = (() => {
  const CATEGORIES = [
    { id: 'youtube', name: 'YouTube', tr: 'YouTube' },
    { id: 'privacy', name: 'Privacy and blocking', tr: 'Gizlilik ve engelleme' },
    { id: 'appearance', name: 'Appearance and dark mode', tr: 'Görünüm ve koyu mod' },
    { id: 'productivity', name: 'Productivity', tr: 'Üretkenlik' },
    { id: 'developer', name: 'Developer', tr: 'Geliştirici' },
    { id: 'media', name: 'Media and social', tr: 'Medya ve sosyal' },
    { id: 'shopping', name: 'Shopping and games', tr: 'Alışveriş ve oyun' },
    { id: 'vex', name: 'Made for Vex', tr: 'Vex için yapıldı' },
  ];

  const store = (id) => 'https://chromewebstore.google.com/detail/' + id;
  const web = (e) => ({ ...e, sourceUrl: store(e.webstoreId) });

  // One row per extension: key, Web Store id, name, publisher, category, level, size (KB),
  // what, works, caveat, then the Turkish of those three, and true when Vex already does it itself.
  const row = (key, webstoreId, name, publisher, category, level, sizeKB, what, works, caveat, trWhat, trWorks, trCaveat, redundant) => web({
    key, webstoreId, name, publisher, category, level, sizeKB, what, works, caveat, redundant: !!redundant,
    tr: { what: trWhat, works: trWorks, caveat: trCaveat },
  });

  const WEB = [
    // ---- YouTube ------------------------------------------------------------
    row('ambient-light', 'paponcgjfojgemddooebbgniglhkajkj', 'Ambient Light for YouTube', 'Wessel Kroos', 'youtube', 'full', 973,
      'Adds a soft glow around a YouTube video in the colours of the picture, like a TV with a light strip behind it, and can dim the rest of the page.',
      'Tested: it loads, its script runs on youtube.com and a canvas appeared while a video played. It only needs a content script and extension storage.',
      'The glow uses your graphics card. On a weak one, lower its quality in the extension\'s options.',
      'YouTube videosunun çevresine görüntünün renklerinde yumuşak bir ışık ekler, arkasında ışık şeridi olan bir televizyon gibi. Sayfanın geri kalanını da kısabilir.',
      'Denendi: yüklenir, betiği youtube.com’da çalışır ve video oynarken sayfaya bir tuval eklendi. Yalnızca bir içerik betiği ve eklenti depolaması ister.',
      'Işık ekran kartını kullanır. Zayıf bir kartta eklentinin seçeneklerinden kalitesini düşür.'),
    row('return-youtube-dislike', 'gebbhagfogifgggkldgodflihgfeippi', 'Return YouTube Dislike', 'Anarios and contributors', 'youtube', 'full', 1285,
      'Puts the dislike count back on YouTube videos, with the like and dislike bar.',
      'Tested: it loads and its script runs on a YouTube video page, where it added its elements to the page.',
      'The numbers are estimates from people who use the extension plus an archive of old counts, not YouTube\'s own. It asks returnyoutubedislikeapi.com about each video you open.',
      'YouTube videolarına beğenmeme sayısını ve beğeni/beğenmeme çubuğunu geri koyar.',
      'Denendi: yüklenir ve betiği bir YouTube video sayfasında çalışıp sayfaya kendi öğelerini ekledi.',
      'Sayılar, eklentiyi kullananların oylarından ve eski sayıların arşivinden yapılan tahminlerdir; YouTube’un kendi sayıları değildir. Açtığın her video için returnyoutubedislikeapi.com’a sorar.'),
    row('sponsorblock', 'mnjggcdmjocbbbhaepdhchncahnbgone', 'SponsorBlock for YouTube', 'Ajay Ramachandran', 'youtube', 'full', 1805,
      'Skips sponsor segments, intros, outros and self-promotion in YouTube videos, using timestamps other viewers have submitted.',
      'Tested: it loads and its scripts run on a YouTube video page, adding its player controls.',
      'It asks sponsor.ajay.app for the segments of each video (it sends a short hash prefix of the video id, not the id itself).',
      'Başkalarının gönderdiği zaman damgalarına göre YouTube videolarındaki sponsor bölümlerini, girişleri, çıkışları ve kendi reklamını atlar.',
      'Denendi: yüklenir ve betikleri bir YouTube video sayfasında çalışıp oynatıcıya kendi denetimlerini ekler.',
      'Her videonun bölümlerini sponsor.ajay.app’ten sorar (videonun kimliğini değil, kimliğin kısa bir özet önekini gönderir).'),
    row('dearrow', 'enamippconapkdmgfgjchkhakpfinmaj', 'DeArrow', 'Ajay Ramachandran', 'youtube', 'full', 1372,
      'Replaces clickbait titles and misleading thumbnails on YouTube with ones the community wrote or picked.',
      'Tested: it loads and its script runs on the YouTube home page.',
      'It looks titles and thumbnails up on dearrow.ajay.app and sponsor.ajay.app.',
      'YouTube’daki tıklama tuzağı başlıkları ve yanıltıcı küçük resimleri, topluluğun yazdığı ya da seçtiği olanlarla değiştirir.',
      'Denendi: yüklenir ve betiği YouTube ana sayfasında çalışır.',
      'Başlıkları ve küçük resimleri dearrow.ajay.app ve sponsor.ajay.app’ten sorar.'),
    row('enhancer-for-youtube', 'ponfpcnoihfmfllpaingbgckeeldkhle', 'Enhancer for YouTube', 'Maxime RF (MRFDEV)', 'youtube', 'full', 487,
      'Extra controls for YouTube: playback speed, volume with the mouse wheel, cinema mode, loop, automatic quality, themes and keyboard shortcuts.',
      'Tested: it loads and its script runs on a playing YouTube video, where it added its controls to the page.',
      null,
      'YouTube için ek denetimler: oynatma hızı, fare tekerleğiyle ses, sinema modu, döngü, otomatik kalite, temalar ve klavye kısayolları.',
      'Denendi: yüklenir ve betiği oynayan bir YouTube videosunda çalışıp sayfaya kendi denetimlerini ekledi.',
      null),
    row('improve-youtube', 'bnomihfieiccainjcjblhegjgglakjdd', 'ImprovedTube', 'ImprovedTube (open source)', 'youtube', 'full', 809,
      'A large panel of YouTube options: player controls, themes, hiding Shorts and recommendations, default quality and speed, and more. Listed on the store as "Improve YouTube!".',
      'Tested: it loads and its script runs on a YouTube video page, where it changed the page.',
      'Its download option can start a download but cannot choose the file name.',
      'YouTube için büyük bir seçenek paneli: oynatıcı denetimleri, temalar, Shorts ve önerileri gizleme, varsayılan kalite ve hız ve fazlası. Mağazada "Improve YouTube!" adıyla geçer.',
      'Denendi: yüklenir ve betiği bir YouTube video sayfasında çalışıp sayfayı değiştirdi.',
      'İndirme seçeneği bir indirme başlatabilir ama dosya adını seçemez.'),
    row('unhook', 'khncfooichmfjbepaaaebmommgaepoid', 'Unhook', 'Unhook', 'youtube', 'full', 37,
      'Hides YouTube\'s recommendations, comments, Shorts and other distractions, so you see only what you search for.',
      'Tested: it loads and its script runs on YouTube, where it set its hiding styles on the page.',
      null,
      'YouTube’un önerilerini, yorumlarını, Shorts’unu ve diğer dikkat dağıtıcıları gizler; yalnızca aradığını görürsün.',
      'Denendi: yüklenir ve betiği YouTube’da çalışıp sayfaya gizleme stillerini koydu.',
      null),
    // ---- Privacy and blocking ----------------------------------------------
    row('privacy-badger', 'pkehgijcmpdhfbdbbnkijodmdjhbjlgp', 'Privacy Badger', 'Electronic Frontier Foundation', 'privacy', 'partial', 3233,
      'Learns which third parties follow you from site to site and stops them, without a fixed blocklist.',
      'Tested: it loads, its script runs on pages and its popup opens. Its blocking uses Chrome request rules, which Vex applies itself; how well they block was not measured.',
      'Vex already blocks ads and trackers on its own, so you may see little extra. Its privacy-settings changes (WebRTC and the like) are not available here.',
      'Siteden siteye seni hangi üçüncü tarafların izlediğini öğrenir ve sabit bir engelleme listesi olmadan durdurur.',
      'Denendi: yüklenir, betiği sayfalarda çalışır ve açılır penceresi açılır. Engellemesi Chrome istek kurallarını kullanır, bunları Vex kendisi uygular; ne kadar engellediği ölçülmedi.',
      'Vex reklamları ve izleyicileri zaten kendisi engeller, o yüzden fazladan az şey görebilirsin. Gizlilik ayarlarını değiştirmesi (WebRTC gibi) burada yok.'),
    row('decentraleyes', 'ldpochfccmkkmhdbclfhpagapcfdljkj', 'Decentraleyes', 'Thomas Rientjes', 'privacy', 'partial', 7030,
      'Serves common scripts and fonts from a copy inside the extension instead of a content delivery network, so that network does not see you.',
      'Tested: it loads and its page opens. It works through Chrome request rules, which Vex applies itself; the effect was not measured.',
      'It cannot change privacy settings here, and Vex\'s own blocker already cuts a lot of third-party requests.',
      'Yaygın betikleri ve yazı tiplerini bir içerik dağıtım ağı yerine eklentinin içindeki bir kopyadan sunar; böylece o ağ seni görmez.',
      'Denendi: yüklenir ve sayfası açılır. Chrome istek kurallarıyla çalışır, bunları Vex kendisi uygular; etkisi ölçülmedi.',
      'Burada gizlilik ayarlarını değiştiremez; Vex’in kendi engelleyicisi de üçüncü taraf isteklerinin çoğunu zaten keser.'),
    row('ublock-origin-lite', 'ddkjiahejlhfcafbddmgiahcphecmpfh', 'uBlock Origin Lite', 'Raymond Hill', 'privacy', 'partial', 8957,
      'The lightweight version of the best-known content blocker, built on Chrome request rules.',
      'Tested: it loads and its popup opens. Its rules run through Vex\'s own request-rule layer, after Vex\'s blocker.',
      'Vex already blocks ads and trackers at the network layer by default, so this mostly adds a second list. Its user-script filters do not work here.',
      'En bilinen içerik engelleyicinin Chrome istek kurallarına dayanan hafif sürümü.',
      'Denendi: yüklenir ve açılır penceresi açılır. Kuralları Vex’in kendi istek kuralı katmanından, Vex’in engelleyicisinden sonra çalışır.',
      'Vex reklamları ve izleyicileri varsayılan olarak ağ katmanında zaten engeller; bu çoğunlukla ikinci bir liste ekler. Kullanıcı betiği süzgeçleri burada çalışmaz.', true),
    row('consent-o-matic', 'mdjildafknihdffpkfmmpnpoiajfjnjd', 'Consent-O-Matic', 'Aarhus University (CAVI)', 'privacy', 'full', 94,
      'Answers cookie-consent pop-ups for you, saying no to everything that is not needed.',
      'Tested: it loads, its script runs on pages and its popup opens.',
      null,
      'Çerez onayı pencerelerini senin yerine yanıtlar; gerekli olmayan her şeye hayır der.',
      'Denendi: yüklenir, betiği sayfalarda çalışır ve açılır penceresi açılır.',
      null),
    // ---- Appearance and dark mode ------------------------------------------
    row('dark-reader', 'eimadpbcbfnmbkopoojfekhnkhdbieeh', 'Dark Reader', 'Dark Reader Ltd', 'appearance', 'full', 831,
      'Dark mode for every site, with settings per site.',
      'Tested: it loads and darkened a test page (its dark scheme and styles were present). Content script plus local storage.',
      'Its settings stay on this machine: extension sync is not available here. Vex also has its own dark mode for a site.',
      'Her site için koyu mod, site başına ayarlarla.',
      'Denendi: yüklenir ve bir deneme sayfasını koyulaştırdı (koyu şeması ve stilleri sayfada vardı). İçerik betiği ve yerel depolama.',
      'Ayarları bu makinede kalır: eklenti eşitlemesi burada yok. Vex’in bir site için kendi koyu modu da var.'),
    row('stylus', 'clngdbkpkpeebahjckkjfobafhncgmne', 'Stylus', 'Stylus contributors', 'appearance', 'full', 1214,
      'Your own CSS on any site, or ready-made styles from userstyles.world.',
      'Tested: it loads, its scripts run on pages and its popup opens. Styles are injected as content scripts.',
      'Cloud sync of your styles will not work; export a backup instead.',
      'Herhangi bir sitede kendi CSS’in ya da userstyles.world’deki hazır stiller.',
      'Denendi: yüklenir, betikleri sayfalarda çalışır ve açılır penceresi açılır. Stiller içerik betiği olarak eklenir.',
      'Stillerin bulut eşitlemesi çalışmaz; yerine yedek dışa aktar.'),
    row('stylebot', 'oiaejidbmkiecgbjeifoejpgmdaleoha', 'Stylebot', 'Ankit Ahuja', 'appearance', 'full', 3582,
      'Change how any website looks with your own CSS, in a point-and-click editor.',
      'Tested: it loads, its script runs on pages and its popup opens.',
      null,
      'Herhangi bir web sitesinin görünümünü kendi CSS’inle, işaretle-tıkla bir düzenleyiciyle değiştir.',
      'Denendi: yüklenir, betiği sayfalarda çalışır ve açılır penceresi açılır.',
      null),
    // ---- Productivity --------------------------------------------------------
    row('bitwarden', 'nngceckbapebfimnlniiiahkandclblb', 'Bitwarden', 'Bitwarden Inc.', 'productivity', 'partial', 24293,
      'Your Bitwarden password manager in the toolbar: save and fill logins, generate passwords.',
      'Tested: it loads, its scripts run on pages and its popup opens. Signing in and filling a real vault was not tried.',
      'For people who already use Bitwarden (Vex has its own password manager). Its side panel, its link to a desktop app and some notification buttons are not available here.',
      'Araç çubuğunda Bitwarden parola yöneticin: girişleri kaydet ve doldur, parola üret.',
      'Denendi: yüklenir, betikleri sayfalarda çalışır ve açılır penceresi açılır. Oturum açıp gerçek bir kasa doldurmak denenmedi.',
      'Zaten Bitwarden kullananlar için (Vex’in kendi parola yöneticisi var). Yan paneli, masaüstü uygulamasına bağlantısı ve bazı bildirim düğmeleri burada yok.'),
    row('vimium', 'dbepggeogbaibhgnhhndojpepiihcmeb', 'Vimium', 'Vimium contributors', 'productivity', 'partial', 204,
      'Browse with the keyboard: follow links, scroll and switch tabs with Vim-style keys.',
      'Tested: it loads and its script runs on pages. The keys that need your history, bookmarks or recently closed tabs are not available.',
      'Its address-bar search over history and bookmarks does not work here; keys Vex takes first (such as Ctrl+B) go to Vex.',
      'Klavyeyle gez: bağlantıları aç, kaydır ve sekme değiştir, Vim tarzı tuşlarla.',
      'Denendi: yüklenir ve betiği sayfalarda çalışır. Geçmişine, yer imlerine ya da yakın zamanda kapattığın sekmelere ihtiyaç duyan tuşlar yok.',
      'Geçmiş ve yer imlerinde adres çubuğu araması burada çalışmaz; Vex’in önce aldığı tuşlar (Ctrl+B gibi) Vex’e gider.'),
    row('singlefile', 'mpiodijhokgodhhofbcjdecpffjipkle', 'SingleFile', 'Gildas Lormeau', 'productivity', 'partial', 1557,
      'Saves a whole web page as one HTML file you can open anywhere.',
      'Tested: it loads and its script runs on pages. Saving a page was not exercised end to end.',
      'It cannot choose the file name or open the saved file for you, and its side panel and bookmark features are not available.',
      'Bir web sayfasının tamamını her yerde açabileceğin tek bir HTML dosyası olarak kaydeder.',
      'Denendi: yüklenir ve betiği sayfalarda çalışır. Bir sayfayı baştan sona kaydetmek denenmedi.',
      'Dosya adını seçemez ve kaydedilen dosyayı senin için açamaz; yan paneli ve yer imi özellikleri burada yok.'),
    row('obsidian-clipper', 'cnjifjpddelmedmihgijeibhnjfabmlf', 'Obsidian Web Clipper', 'Obsidian', 'productivity', 'partial', 4191,
      'Clips web pages into your Obsidian vault as Markdown, with templates.',
      'Tested: it loads and its script runs on pages. Sending a clip into Obsidian was not tried.',
      'Its side panel is not available here.',
      'Web sayfalarını şablonlarla Markdown olarak Obsidian kasana keser.',
      'Denendi: yüklenir ve betiği sayfalarda çalışır. Bir kesiti Obsidian’a göndermek denenmedi.',
      'Yan paneli burada yok.'),
    row('languagetool', 'oldceeleldhonbafppcapldpdifcinji', 'LanguageTool', 'LanguageTool', 'productivity', 'partial', 15386,
      'Checks your spelling and grammar as you type, in many languages.',
      'Tested: it loads, its script runs on pages and its popup opens.',
      'It sends the text you check to LanguageTool\'s servers, so do not use it on anything private.',
      'Yazarken yazım ve dil bilgisini birçok dilde denetler.',
      'Denendi: yüklenir, betiği sayfalarda çalışır ve açılır penceresi açılır.',
      'Denetlediğin metni LanguageTool’un sunucularına gönderir; özel bir şey için kullanma.'),
    row('search-by-image', 'cnojnbdhbhnkbcieeekonklommdnndci', 'Search by Image', 'Armin Sebastian', 'productivity', 'partial', 865,
      'Right-click an image and search for it with Google Lens, Bing, TinEye, Yandex and many other engines.',
      'Tested: it loads and its script runs on pages. Its right-click menu items work in Vex; running a search was not exercised.',
      'A search sends the image you picked to the engine you choose, which opens in a new tab.',
      'Bir görüntüye sağ tıkla ve Google Lens, Bing, TinEye, Yandex ve daha birçok motorla ara.',
      'Denendi: yüklenir ve betiği sayfalarda çalışır. Sağ tık menü öğeleri Vex’te çalışır; bir arama yapmak denenmedi.',
      'Bir arama, seçtiğin görüntüyü seçtiğin motora gönderir; motor yeni bir sekmede açılır.'),
    row('wayback-machine', 'fpnmgdkabkmnadcjpehmlllkndpkmiak', 'Wayback Machine', 'Internet Archive', 'productivity', 'partial', 1362,
      'Open the saved copy of a page that is gone, or save the current page to the Internet Archive.',
      'Tested: it loads and its script runs on Wikipedia. The bookmark features are not available.',
      'Saving a page sends its address to the Internet Archive.',
      'Kaybolmuş bir sayfanın kayıtlı kopyasını aç ya da geçerli sayfayı Internet Archive’a kaydet.',
      'Denendi: yüklenir ve betiği Wikipedia’da çalışır. Yer imi özellikleri yok.',
      'Bir sayfayı kaydetmek, adresini Internet Archive’a gönderir.'),
    // ---- Developer -----------------------------------------------------------
    row('refined-github', 'hlepfoohegkhhmjieoechaddaejaokhf', 'Refined GitHub', 'Refined GitHub contributors', 'developer', 'full', 651,
      'Dozens of small improvements to github.com: better diffs, shortcuts, one-click actions and cleaner pages.',
      'Tested: it loads and its script ran on a GitHub repository page, adding its elements to the page.',
      'A few features need a GitHub personal access token, set in its options.',
      'github.com’a onlarca küçük iyileştirme: daha iyi karşılaştırmalar, kısayollar, tek tıkla eylemler ve daha temiz sayfalar.',
      'Denendi: yüklenir ve betiği bir GitHub depo sayfasında çalışıp sayfaya kendi öğelerini ekledi.',
      'Birkaç özellik, seçeneklerinde ayarlanan bir GitHub kişisel erişim belirteci ister.'),
    row('material-icons-github', 'bggfcpfjbdkhfhfmkjpbhnkhnpjjeomc', 'Material Icons for GitHub', 'Material Extensions', 'developer', 'full', 1176,
      'Replaces GitHub\'s file and folder icons with the Material Icon Theme icons from VS Code.',
      'Tested: it loads and its script ran on a GitHub folder page, adding its icons.',
      null,
      'GitHub’ın dosya ve klasör simgelerini VS Code’daki Material Icon Theme simgeleriyle değiştirir.',
      'Denendi: yüklenir ve betiği bir GitHub klasör sayfasında çalışıp simgelerini ekledi.',
      null),
    row('octotree', 'bkhaagjahfmjljalopjnoealnfndnagc', 'Octotree', 'Octotree', 'developer', 'full', 3504,
      'A file tree for GitHub repositories, so you can move around code without opening every folder.',
      'Tested: it loads and its sidebar appeared on a GitHub repository page.',
      'It works on public repositories; private ones need an access token, and some features are in its paid plan.',
      'GitHub depoları için bir dosya ağacı; her klasörü açmadan kodda gezin.',
      'Denendi: yüklenir ve kenar çubuğu bir GitHub depo sayfasında göründü.',
      'Herkese açık depolarda çalışır; özel depolar için bir erişim belirteci gerekir ve bazı özellikler ücretli planındadır.'),
    row('gitako', 'giljefjcheohhamkjphiebfjnlphnokk', 'Gitako', 'Gitako (open source)', 'developer', 'full', 1908,
      'A free, open-source file tree for GitHub, with quick file search.',
      'Tested: it loads and its panel appeared on a GitHub repository page.',
      'Private repositories need an access token, set in its options.',
      'GitHub için ücretsiz, açık kaynaklı bir dosya ağacı, hızlı dosya aramasıyla.',
      'Denendi: yüklenir ve paneli bir GitHub depo sayfasında göründü.',
      'Özel depolar, seçeneklerinde ayarlanan bir erişim belirteci ister.'),
    row('json-formatter', 'bcjindcccaagfpapjjmafapmmgkkhgoa', 'JSON Formatter', 'Callum Locke', 'developer', 'full', 20,
      'Makes JSON in a tab readable: highlighted, collapsible, with clickable links.',
      'Tested: it loads and formatted a JSON page (its collapsible view appeared).',
      null,
      'Bir sekmedeki JSON’u okunur yapar: renkli, katlanabilir, tıklanabilir bağlantılarla.',
      'Denendi: yüklenir ve bir JSON sayfasını biçimlendirdi (katlanabilir görünümü ortaya çıktı).',
      null),
    row('cookie-editor', 'hlkenndednhfkekhgcdicdfddnkalmdm', 'Cookie-Editor', 'Christophe Gagnier', 'developer', 'partial', 290,
      'Create, edit, search and delete the cookies of the site you are on.',
      'Tested: it loads and its popup opens and renders.',
      'It sees only the cookies of normal tabs, never those of Private, burner or Tor tabs, and its side panel is not available.',
      'Bulunduğun sitenin çerezlerini oluştur, düzenle, ara ve sil.',
      'Denendi: yüklenir ve açılır penceresi açılıp görünür.',
      'Yalnızca normal sekmelerin çerezlerini görür; Gizli, geçici ve Tor sekmelerininkini asla. Yan paneli yok.'),
    row('web-developer', 'bfbameneiokkgbdmiekhjnmfkcnldhhm', 'Web Developer', 'Chris Pederick', 'developer', 'partial', 574,
      'A toolbar of web developer tools: outline elements, turn off CSS or JavaScript, view forms and cookies, resize the window.',
      'Tested: it loads, its script runs on pages and its popup opens. The tools that need history, clearing browsing data or site settings are not available.',
      'Its history, clear-browsing-data and site-settings tools do nothing here; the rest work.',
      'Bir web geliştirici araç çubuğu: öğeleri çerçevele, CSS ya da JavaScript’i kapat, formları ve çerezleri gör, pencereyi yeniden boyutlandır.',
      'Denendi: yüklenir, betiği sayfalarda çalışır ve açılır penceresi açılır. Geçmişe, tarama verisini temizlemeye ya da site ayarlarına ihtiyaç duyan araçlar yok.',
      'Geçmiş, tarama verisini temizleme ve site ayarları araçları burada bir şey yapmaz; gerisi çalışır.'),
    row('wappalyzer', 'gppongmhjkpfnbhagpmjfkannfbllamg', 'Wappalyzer', 'Wappalyzer', 'developer', 'partial', 34052,
      'Shows which technologies a website was built with: frameworks, analytics, servers and more.',
      'Tested: it loads, its script runs on pages and its popup opens. It sees finished requests only, so a few detections may be missing.',
      'It only sees finished requests, so some technologies may go undetected. A large download (about 34 MB).',
      'Bir web sitesinin hangi teknolojilerle yapıldığını gösterir: çerçeveler, analizler, sunucular ve fazlası.',
      'Denendi: yüklenir, betiği sayfalarda çalışır ve açılır penceresi açılır. Yalnızca tamamlanmış istekleri görür, bu yüzden birkaç tespit eksik kalabilir.',
      'Yalnızca tamamlanmış istekleri görür, bu yüzden bazı teknolojiler tespit edilemeyebilir. Büyük bir indirme (yaklaşık 34 MB).'),
    // ---- Media and social ----------------------------------------------------
    row('video-speed-controller', 'nffaoalbilbmmfgbnbgppjihopabppdk', 'Video Speed Controller', 'Ilya Grigorik', 'media', 'full', 103,
      'Speed controls on every HTML5 video: faster, slower, rewind and skip with the keyboard, on any site.',
      'Tested: it loads and its script runs on pages (it only shows a control when a page has a video).',
      null,
      'Her HTML5 videosunda hız denetimleri: klavyeyle hızlandır, yavaşlat, geri sar ve atla, her sitede.',
      'Denendi: yüklenir ve betiği sayfalarda çalışır (denetimi yalnızca sayfada video olduğunda gösterir).',
      null),
    row('7tv', 'ammjkodgmmoknidbanneddgankgfejfh', '7TV', '7TV', 'media', 'full', 3637,
      'Third-party emotes in Twitch chat, with an emote picker.',
      'Tested: it loads and its script runs on twitch.tv. Chat itself was not opened.',
      null,
      'Twitch sohbetinde üçüncü taraf ifadeler, bir ifade seçiciyle.',
      'Denendi: yüklenir ve betiği twitch.tv’de çalışır. Sohbetin kendisi açılmadı.',
      null),
    row('frankerfacez', 'fadndhdgpmmaapbmfcknlfgcflmmmieb', 'FrankerFaceZ', 'FrankerFaceZ', 'media', 'full', 7346,
      'Twitch chat emotes, badges and many interface settings.',
      'Tested: it loads and its script runs on twitch.tv. Chat itself was not opened.',
      null,
      'Twitch sohbeti ifadeleri, rozetler ve birçok arayüz ayarı.',
      'Denendi: yüklenir ve betiği twitch.tv’de çalışır. Sohbetin kendisi açılmadı.',
      null),
    // ---- Shopping and games --------------------------------------------------
    row('steamdb', 'kdbmhfkmnlmbkgbabkdealhhbfhlmmon', 'SteamDB', 'SteamDB', 'shopping', 'full', 360,
      'Adds prices in other regions, price history and links to SteamDB on Steam store pages.',
      'Tested: it loads and its script ran on a Steam store page, adding its elements.',
      null,
      'Steam mağaza sayfalarına diğer bölgelerdeki fiyatları, fiyat geçmişini ve SteamDB bağlantılarını ekler.',
      'Denendi: yüklenir ve betiği bir Steam mağaza sayfasında çalışıp kendi öğelerini ekledi.',
      null),
  ];

  // The catalogue's own entries, in the store's terms. An entry whose name is
  // already on the shelf above is not listed twice; one that does not work is left out.
  const CATALOG_META = {
    rosuite: { publisher: '0xmortuex', category: 'vex', level: 'full',
      tr: { what: 'Daha iyi Roblox: sunucu tarayıcısı (en kalabalık ya da en boş olan önce, süzgeçler, sunucuya katıl), canlı oyun istatistikleri, profil değeri ve etkinliği, takas hesaplayıcısı.',
        works: 'Tam çalışır. İçerik betikleri ve Roblox’un herkese açık API’leri, mevcut Roblox oturumunla. Sekmelerde ve Roblox panelinde çalışır.',
        caveat: 'Takaslar ve sunucudaki arkadaşlar için Roblox’ta oturum açmış olman gerekir. Vex için yapıldı, açık kaynak.' } },
    'github-pulse': { publisher: '0xmortuex', category: 'vex', level: 'full',
      tr: { what: 'Her GitHub deposunun üstünde bir çubuk: son iş akışı çalıştırmaları, dağıtım ve sürüm, ayrıca Cloudflare Worker’ının en son ne zaman dağıtıldığı.',
        works: 'Tam çalışır. Bir içerik betiği ve GitHub’ın herkese açık API’si.',
        caveat: 'Cloudflare kısmı isteğe bağlıdır; seçeneklerinde salt okunur bir API belirteci ister. Vex için yapıldı, açık kaynak.' } },
    'devforum-plus': { publisher: '0xmortuex', category: 'vex', level: 'full',
      tr: { what: 'Geliştiriciler için Roblox Geliştirici Forumu: koddaki API adları belgelerine bağlanır, Alt+D ile belge araması, kodun yanında Kopyala düğmesi.',
        works: 'Tam çalışır. Bir içerik betiği ve haftalık bir API adı listesi.',
        caveat: 'Vex için yapıldı, açık kaynak.' } },
    chatkeep: { publisher: '0xmortuex', category: 'vex', level: 'full',
      tr: { what: 'ChatGPT, Claude veya Gemini sohbetini Markdown olarak dışa aktar ve üçü için tek bir istem kitaplığı tut.',
        works: 'Sekmelerde tam çalışır. Bir içerik betiği; hiçbir yere bir şey göndermez.',
        caveat: 'Sohbet siteleri sayfalarını sık değiştirir; ChatKeep güncellenene kadar bir dışa aktarma boş çıkabilir. Vex için yapıldı, açık kaynak.' } },
    'cineverse-plus': { publisher: '0xmortuex', category: 'vex', level: 'full',
      tr: { what: 'Her filmde IMDb puanı olan Paribu Cineverse ve sana en yakın sinemalardaki en yakın seanslar.',
        works: 'Tam çalışır. Konumun Ayarlar › Konum’dan gelir.',
        caveat: 'IMDb puanları için seçeneklerine bir kez yapıştırılan ücretsiz bir OMDb anahtarı gerekir. Vex için yapıldı, açık kaynak.' } },
    'dark-reader': { publisher: 'Dark Reader Ltd', category: 'appearance', level: 'full',
      tr: { what: 'Her site için koyu mod, site başına ayarlarla.',
        works: 'Tam çalışır. Yerel depolamalı bir içerik betiğidir; Electron’un en iyi desteklediği türdür.',
        caveat: 'Ayarları bu makinede kalır; eklenti eşitlemesi burada yok.' } },
    stylus: { publisher: 'Stylus contributors', category: 'appearance', level: 'full',
      tr: { what: 'Herhangi bir sitede kendi CSS’in ya da userstyles.world’deki stiller.',
        works: 'Tam çalışır; stiller içerik betiği olarak eklenir.',
        caveat: 'Stillerin bulut eşitlemesi çalışmaz; yerine yedek dışa aktar.' } },
    violentmonkey: { publisher: 'Violentmonkey contributors', category: 'developer', level: 'none', tr: null },
    'return-youtube-dislike': { publisher: 'Anarios and contributors', category: 'youtube', level: 'full',
      tr: { what: 'YouTube’a beğenmeme sayısını geri koyar.',
        works: 'Tam çalışır: bir içerik betiği ve bir ağ isteği; ikisi de desteklenir.',
        caveat: null } },
    'ublock-origin': { publisher: 'Raymond Hill', category: 'privacy', level: 'partial', redundant: true,
      tr: { what: 'En bilinen içerik engelleyici.',
        works: 'Kurulur ve arka plan sayfası çalışır ama burada istekleri ENGELLEYEMEZ: Electron eklentilere engelleyici API vermez. En fazla bazı sayfa öğelerini gizler.',
        caveat: 'Gerçek engelleme için Vex’in kendi engelleyicisini kullan: ağ katmanında çalışır ve varsayılan olarak açıktır.' } },
  };

  function combined(catalog) {
    const names = new Set(WEB.map(e => e.name.toLowerCase()));
    const gh = [];
    for (const c of (catalog && catalog.ENTRIES) || []) {
      const meta = CATALOG_META[c.id];
      if (!meta) throw new Error('extension-store-data: the catalogue entry "' + c.id + '" has no store entry in CATALOG_META');
      if (meta.level === 'none' || names.has(c.name.toLowerCase())) continue;
      gh.push({
        key: 'gh-' + c.id, catalogId: c.id, name: c.name, publisher: meta.publisher, category: meta.category,
        level: meta.level, what: c.what, works: c.works, caveat: c.caveat, redundant: !!meta.redundant,
        sourceUrl: c.source, tr: meta.tr,
      });
    }
    return WEB.concat(gh);
  }

  return { CATEGORIES, WEB, CATALOG_META, combined, web };
})();

if (typeof window !== 'undefined') window.VexExtensionStoreData = VexExtensionStoreData;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexExtensionStoreData };
