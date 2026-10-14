// === Vex interface translation ============================================
//
// js/i18n.js translates the setup wizard, and nothing else: every other label
// in Vex is English, however you answered the language step. This adds the
// rest of the chrome.
//
// It works by matching the ENGLISH string rather than by tagging a thousand
// elements with data-i18n attributes. index.html and the panels are built from
// literal English text in dozens of files, and marking each one up would be a
// large, error-prone edit that new UI would immediately drift out of. Matching
// the source string means a translation lands the moment the text is added to
// the table below, wherever it is drawn from.
//
// The cost of that approach is over-reach: translate the whole document and a
// page title, a bookmark or a person's name could be "translated" because it
// happens to read "History". So translation is confined to SCOPES — the parts
// of the window Vex itself draws — and never runs over page content, a
// <webview>, or anything a user typed. Anything not in the table is left
// exactly as it is.
const VexI18nUI = {
  // Only inside these. Everything else on screen belongs to the user or to a
  // web page, and must never be rewritten.
  SCOPES: [
    '#top-bar', '#icon-sidebar', '#tabs-sidebar', '#nav-buttons', '#pip-btn',
    '.panel-header', '#panel-settings', '#panel-shortcuts', '#panel-memory',
    '#panel-downloads', '#panel-history', '#panel-bookmarks', '#panel-notes',
    '#command-bar', '.vexd-card',
    // The Library's feature list (js/feature-library.js), not the articles
    // saved beside it, which are the person's own words.
    '.flib',
  ],

  // Attributes worth translating; `title` is most of the toolbar.
  ATTRS: ['title', 'aria-label', 'placeholder'],

  // English -> translation. Only the chrome: the words you see every day.
  // Kept deliberately small and exact rather than machine-translated wholesale,
  // because a wrong translation in a browser's own furniture is worse than
  // English.
  TABLE: {
    tr: {
      // --- toolbar and navigation ---
      'Back': 'Geri', 'Forward': 'İleri', 'Reload': 'Yenile', 'Stop': 'Durdur',
      'New Tab': 'Yeni sekme', 'Close tab': 'Sekmeyi kapat', 'Close': 'Kapat',
      'Home': 'Ana sayfa', 'Search or enter address': 'Arayın veya adres girin',
      'Minimize': 'Küçült', 'Maximize': 'Büyüt', 'Restore': 'Geri yükle',
      'Bookmark this page': 'Bu sayfayı yer imlerine ekle',
      'Copy link': 'Bağlantıyı kopyala', 'Copy URL': 'Adresi kopyala',
      'Split Screen': 'Bölünmüş ekran', 'Picture-in-Picture': 'Pencere içinde pencere',
      // The button over a video (js/pip-manager.js) and its Settings row.
      'Picture in Picture': 'Pencere içinde pencere',
      'Picture-in-Picture button on videos': 'Videolardaki pencere içinde pencere düğmesi',
      'When I hover a video': 'Bir videonun üzerine geldiğimde',
      'Always show': 'Her zaman göster',
      'Never show (keyboard shortcut only)': 'Hiç gösterme (yalnızca klavye kısayolu)',
      'Show it on all sites again': 'Tüm sitelerde yeniden göster',
      'Picture-in-Picture button hidden for {}': 'Pencere içinde pencere düğmesi şu sitelerde gizli: {}',
      "Don't show here": 'Burada gösterme',
      'Show only when I hover a video': 'Yalnızca bir videonun üzerine geldiğimde göster',
      'Always show on videos': 'Videolarda her zaman göster',
      'Never show (use Ctrl+Shift+P)': 'Hiç gösterme (Ctrl+Shift+P kullanın)',
      'Edit Layout': 'Düzeni düzenle', 'Extensions': 'Eklentiler',
      'Zoom in': 'Yakınlaştır', 'Zoom out': 'Uzaklaştır', 'Reset zoom': 'Yakınlaştırmayı sıfırla',
      // The toolbar tooltips that stayed English (found 2026-10-10).
      'Stop loading this page': 'Bu sayfanın yüklenmesini durdur',
      'Vex page — site information': 'Vex sayfası — site bilgileri',
      'Local file — site information': 'Yerel dosya — site bilgileri',
      // The same button on a website names the site ({} is its host).
      'Connection is secure — site information and settings for {}': 'Bağlantı güvenli — {} için site bilgileri ve ayarları',
      'Not secure — site information and settings for {}': 'Güvenli değil — {} için site bilgileri ve ayarları',
      'This page did not load — site information and settings for {}': 'Bu sayfa yüklenmedi — {} için site bilgileri ve ayarları',
      'All features': 'Tüm özellikler',
      'All features — show every panel, button and setting Vex has': 'Tüm özellikler — Vex’in her panelini, düğmesini ve ayarını göster',
      'Hide the sidebar': 'Kenar çubuğunu gizle', 'Show the sidebar': 'Kenar çubuğunu göster',
      'Show sidebar': 'Kenar çubuğunu göster', 'Collapse sidebar': 'Kenar çubuğunu daralt',
      'Close / open the left sidebar': 'Sol kenar çubuğunu kapat / aç',
      'Command Bar': 'Komut çubuğu', 'New tab': 'Yeni sekme',
      'Privacy — trackers & ads blocked': 'Gizlilik — engellenen izleyiciler ve reklamlar',

      // --- panels ---
      'Settings': 'Ayarlar', 'History': 'Geçmiş', 'Downloads': 'İndirilenler',
      'Bookmarks': 'Yer imleri', 'Notes': 'Notlar', 'Memory': 'Bellek',
      'Library': 'Kitaplık', 'Feeds': 'Akışlar', 'Highlights': 'Vurgular',
      'Recall': 'Geri çağırma', 'Schedules': 'Zamanlanmış görevler',
      'Authenticator': 'Kimlik doğrulayıcı', 'Privacy': 'Gizlilik',
      'Fill code from authenticator': 'Kimlik doğrulayıcıdan kod doldur',
      'Search accounts': 'Hesaplarda ara', 'Rename account': 'Hesabı yeniden adlandır', 'Remove account': 'Hesabı kaldır',
      'Shortcuts': 'Kısayollar', 'Queue': 'Kuyruk', 'Work': 'Çalışma',
      'Start Page': 'Başlangıç sayfası', 'Toolbox': 'Araç kutusu',
      // A web panel's page as a tab (js/panel-to-tab.js).
      'Open in a tab': 'Sekmede aç', 'Copy page link': 'Sayfa bağlantısını kopyala',
      'Page link copied': 'Sayfa bağlantısı kopyalandı', 'Could not copy the link': 'Bağlantı kopyalanamadı',
      'This panel does not show a web page': 'Bu panel bir web sayfası göstermiyor',
      'has no page to open yet': 'henüz açılacak bir sayfa göstermiyor',
      'Open a web panel first': 'Önce bir web paneli açın',
      'Open Roblox Hub page in a tab': 'Roblox Hub sayfasını sekmede aç',
      'Open side panel page in a tab': 'Yan paneldeki sayfayı sekmede aç',
      'The page Roblox Hub is showing, as a tab with its address — still signed in': 'Roblox Hub’ın gösterdiği sayfa, adresiyle birlikte bir sekmede — oturumunuz açık kalır',
      'The page the open side panel is showing, as a tab with its address — still signed in': 'Açık yan panelin gösterdiği sayfa, adresiyle birlikte bir sekmede — oturumunuz açık kalır',

      // --- common actions ---
      'Save': 'Kaydet', 'Cancel': 'İptal', 'Delete': 'Sil', 'Remove': 'Kaldır',
      'Edit': 'Düzenle', 'Add': 'Ekle', 'Open': 'Aç', 'Clear': 'Temizle',
      'Search': 'Ara', 'Rename': 'Yeniden adlandır', 'Duplicate': 'Çoğalt',
      'Retry': 'Yeniden dene', 'Copy': 'Kopyala', 'Paste': 'Yapıştır',
      'Reset': 'Sıfırla', 'Apply': 'Uygula', 'Done': 'Bitti', 'Next': 'İleri',
      'Import': 'İçe aktar', 'Export': 'Dışa aktar', 'Refresh': 'Yenile',
      'Pause': 'Duraklat', 'Resume': 'Sürdür', 'Show in folder': 'Klasörde göster',

      // --- settings sections ---
      'General': 'Genel', 'Browser': 'Tarayıcı', 'Appearance': 'Görünüm',
      'Layout': 'Düzen', 'Sidebar': 'Kenar çubuğu', 'Performance': 'Performans',
      'Sessions': 'Oturumlar', 'Workspaces': 'Çalışma alanları',
      'Location': 'Konum', 'Sync': 'Eşitleme', 'Passwords': 'Parolalar', 'Passkeys': 'Geçiş anahtarları',
      'Autofill': 'Otomatik doldurma', 'Security': 'Güvenlik',
      'Keyboard Shortcuts': 'Klavye kısayolları', 'Tab Groups': 'Sekme grupları',
      'Personalization': 'Kişiselleştirme', 'Reading': 'Okuma', 'Focus': 'Odak',
      // The AI section's own row of chips (2026-10-10).
      'AI sections': 'Yapay zekâ bölümleri', 'Personas': 'Kişilikler',
      'Skills': 'Beceriler', 'On-Device': 'Cihaz üzerinde',
      // The chips that stayed English, and every section heading (a heading
      // holds the section's mark, so only its text node is translated).
      'Profiles': 'Profiller', 'Data': 'Veriler', 'Permissions': 'İzinler',
      'Boosts': 'Güçlendirmeler', 'Chains': 'Zincirler', 'Extras': 'Ekstralar',
      'Cloud': 'Bulut', 'About': 'Hakkında', 'AI': 'Yapay zekâ',
      'Search settings…': 'Ayarlarda arayın…',
      'Default Browser': 'Varsayılan tarayıcı', 'Sidebar Buttons': 'Kenar çubuğu düğmeleri',
      'Privacy & Security': 'Gizlilik ve güvenlik', 'Privacy Hardening': 'Gizlilik sıkılaştırma',
      'Vex Sync': 'Vex eşitleme', 'AI Backend': 'Yapay zekâ altyapısı',
      'AI Personas': 'Yapay zekâ kişilikleri', 'AI Memory': 'Yapay zekâ belleği',
      'On-Device AI': 'Cihaz üzerinde yapay zekâ', 'MCP Servers': 'MCP sunucuları',
      'AI Skills': 'Yapay zekâ becerileri', 'AI History Indexing': 'Yapay zekâ geçmiş dizini',
      'Private routing': 'Özel yönlendirme', 'Site Settings': 'Site ayarları',
      'Site Permissions': 'Site izinleri', 'Chrome Extensions': 'Chrome eklentileri',
      'Smart Tab Grouping': 'Akıllı sekme gruplama', 'Command Chains': 'Komut zincirleri',
      // Page watcher: the Settings block, the toolbar badge and its commands.
      'Page watcher': 'Sayfa izleyici', 'Watched pages': 'İzlenen sayfalar', 'Watched pages…': 'İzlenen sayfalar…',
      'Watch pages for changes': 'Sayfaları değişiklikler için izle',
      'Describe changes with my local AI model': 'Değişiklikleri yerel yapay zekâ modelimle anlat',
      'How small a change to tell': 'Ne kadar küçük değişiklik bildirilsin',
      'Only bigger changes (3 lines or more)': 'Yalnızca büyük değişiklikler (3 satır ve üzeri)',
      'Any change in the words': 'Sözcüklerdeki her değişiklik', 'Everything, even a clock': 'Her şey, saat bile',
      'Pages watched at most': 'En fazla izlenen sayfa', 'Looks kept for each page': 'Her sayfa için saklanan kontrol sayısı',
      'Watch this page for changes': 'Bu sayfayı değişiklikler için izle',
      'Tell me when this page changes': 'Bu sayfa değişince bana söyle',
      'Watched Pages': 'İzlenen sayfalar', 'Watched Pages (what changed)': 'İzlenen sayfalar (ne değişti)',
      'Reading & Accessibility': 'Okuma ve erişilebilirlik',
      'Recall (full-text history)': 'Geri çağırma (tam metin geçmişi)',
      'Browsing extras': 'Gezinme ekstraları',
      'Cloud Services (self-hosted)': 'Bulut hizmetleri (kendi sunucunuzda)',
      'Gaming and streaming': 'Oyun ve yayın', 'Discord hotkeys': 'Discord kısayol tuşları',
      'When a game is running': 'Bir oyun çalışırken', 'Your local models': 'Yerel modelleriniz',
      'Streamer mode': 'Yayıncı modu',

      // --- settings controls people actually change ---
      'Default search engine': 'Varsayılan arama motoru',
      'Add your own…': 'Kendinizinkini ekleyin…',
      'Search keywords': 'Arama anahtar kelimeleri', 'Add a keyword…': 'Anahtar kelime ekle…',
      'Auto-sleep inactive tabs': 'Etkin olmayan sekmeleri uyut',
      'Sleep after (minutes)': 'Şu kadar dakika sonra uyut',
      'Memory Saver': 'Bellek tasarrufu',
      'Block ads and trackers': 'Reklamları ve izleyicileri engelle',
      'Tab Layout': 'Sekme düzeni', 'GUI Style': 'Arayüz stili',
      'Horizontal (top bar, like Chrome)': 'Yatay (üst çubuk, Chrome gibi)',
      'Vertical (left sidebar)': 'Dikey (sol kenar çubuğu)',
      'Fill sign-in codes from your email': 'E-postanızdaki giriş kodlarını doldur',
      '· only a code the same site emailed you, read from your open webmail': '· yalnızca aynı sitenin size e-postayla gönderdiği kod, açık web postanızdan okunur',
      // Settings > Downloads (js/downloads-panel.js); 'Location' is above.
      'Change': 'Değiştir',
      'Ask where to save each file before downloading': 'İndirmeden önce her dosyanın nereye kaydedileceğini sor',
      // Settings > General > Workspaces (js/workspaces.js).
      'Manage Workspaces': 'Çalışma alanlarını yönet',
      'Private and Tor tabs when you switch workspace': 'Çalışma alanı değiştirirken gizli ve Tor sekmeleri',
      'Ask each time': 'Her seferinde sor', 'Always close them': 'Her zaman kapat',
      // Settings > Appearance (js/appearance-prefs.js).
      'Website appearance': 'Web sitesi görünümü', 'Follow Vex': 'Vex’i izle',
      'Follow Windows': 'Windows’u izle', 'Light': 'Açık', 'Dark': 'Koyu',
      'Reduce motion': 'Hareketi azalt',
      'Tor tabs always show sites light, like Tor Browser.': 'Tor sekmeleri, Tor Browser gibi siteleri her zaman açık renkte gösterir.',
      // Settings › Appearance › Settings layout, and the layout button beside
      // the search box (js/settings-ui.js).
      'Settings layout': 'Ayarlar düzeni', 'Settings categories': 'Ayar kategorileri',
      'Settings columns': 'Ayarlar sütunları', 'Settings category menu': 'Ayarlar kategori menüsü',
      'Settings density': 'Ayarlar yoğunluğu',
      'Columns': 'Sütunlar', 'Category menu': 'Kategori menüsü', 'Density': 'Yoğunluk',
      'Automatic': 'Otomatik', 'One column': 'Tek sütun', 'One column, full width': 'Tek sütun, tam genişlik', 'Two columns': 'İki sütun', 'Three columns': 'Üç sütun',
      'Chips across the top': 'Üstte, yan yana düğmeler', 'A list down the left side': 'Solda bir liste',
      'Comfortable': 'Rahat', 'Compact': 'Sıkışık',
      'Back to the default layout': 'Varsayılan düzene dön',
      'Automatic uses two columns from about 1300px wide, and three on very wide screens.': 'Otomatik, yaklaşık 1300 piksel genişlikten itibaren iki, çok geniş ekranlarda üç sütun kullanır.',
      'On a narrow window the list becomes chips again.': 'Dar bir pencerede liste yeniden üstte düğmelere dönüşür.',
      'Compact fits more on the screen: tighter rows, the same text size.': 'Sıkışık, ekrana daha fazlasını sığdırır: satırlar daha sık, yazı boyutu aynı.',
      'Three columns need a wider window, so Settings shows two.': 'Üç sütun için pencere dar, bu yüzden Ayarlar iki sütun gösteriyor.',
      'Three columns need a wider window, so Settings shows one.': 'Üç sütun için pencere dar, bu yüzden Ayarlar tek sütun gösteriyor.',
      'Two columns need a wider window, so Settings shows one.': 'İki sütun için pencere dar, bu yüzden Ayarlar tek sütun gösteriyor.',
      'This window is too narrow for the list, so the chips are shown.': 'Bu pencere liste için çok dar, bu yüzden düğmeler gösteriliyor.',

      // --- states you see constantly ---
      'Loading...': 'Yükleniyor…', 'Loading…': 'Yükleniyor…',
      'No results': 'Sonuç yok', 'Nothing here yet': 'Burada henüz bir şey yok',
      'Today': 'Bugün', 'Yesterday': 'Dün',
      'Discover Vex': 'Vex’i keşfedin',
      'Search every feature…': 'Tüm özelliklerde arayın…',
      'New to you': 'Sizin için yeni',
      'Show me': 'Bana göster', 'Turn on & show me': 'Aç ve bana göster',
      // The Library's buttons and the heading above what cannot be opened.
      'Open panel': 'Paneli aç', 'Open settings': 'Ayarları aç', 'Run command': 'Komutu çalıştır',
      'Open the volume slider': 'Ses kaydırıcısını aç', 'How it works': 'Nasıl çalışır',
      'Ask Vex about this': 'Vex’e bunu sor',
      // Game Control Center: the command, its Settings row and its toasts.
      'Open Game Control Center': 'Game Control Center’ı aç',
      'Bypass, game boost, network, overlay and gamma light': 'Engel aşma, oyun hızlandırma, ağ, katman ve gama ışığı',
      'Game Control Center location': 'Game Control Center konumu',
      'Browse…': 'Gözat…', 'Find it automatically': 'Kendiliğinden bul', 'Found automatically': 'Kendiliğinden bulundu',
      'Opened Game Control Center': 'Game Control Center açıldı',
      'Choose location…': 'Konum seç…',
      'Game Control Center location saved': 'Game Control Center konumu kaydedildi',
      // Game mode (js/game-session.js): the chip, Settings and the questions.
      'Game mode on': 'Oyun modu açık', 'Turn off for now': 'Şimdilik kapat',
      'Put everything back until this game ends': 'Bu oyun bitene kadar her şeyi eski haline getir',
      'Game mode is off until this game ends': 'Oyun modu bu oyun bitene kadar kapalı',
      'Game mode': 'Oyun modu', 'My games': 'Oyunlarım', 'No games yet.': 'Henüz oyun yok.',
      'Add a game…': 'Oyun ekle…', 'Add a game': 'Oyun ekle', 'Program name': 'Program adı', 'Name': 'Ad',
      'Next': 'İleri', 'Add': 'Ekle', 'Remove': 'Kaldır', 'Remove this game?': 'Bu oyun kaldırılsın mı?',
      'its guide pages are removed too.': 'rehber sayfaları da kaldırılır.',
      'Guide pages': 'Rehber sayfaları', 'Add the page in front': 'Öndeki sayfayı ekle', 'Add the running game': 'Çalışan oyunu ekle',
      'Turn on Game mode?': 'Oyun modu açılsın mı?', 'Turn on': 'Aç', 'Not now': 'Şimdi değil',
      'Add this page to which game?': 'Bu sayfa hangi oyuna eklensin?',
      'Add this page to a game’s guide': 'Bu sayfayı bir oyunun rehberine ekle',
      'Off for now — Vex asks once, the first time a game starts.': 'Şimdilik kapalı — Vex, bir oyun ilk kez başladığında bir kez sorar.',
      // Game dossier (js/game-dossier.js).
      'Remember what you look at while you play?': 'Oynarken baktıklarınız hatırlansın mı?',
      'While one of your listed games runs, Vex will remember the web pages you open and the searches you make, so you can find that guide or build again. It keeps the address, title, time spent and, if Recall is on and already knows the page, a short snippet. It never records private windows, Tor or burner tabs, sign-in, payment, bank or mail pages, or sites on your never-remember list. It is stored only on this PC, is not synced, and you can delete one page or everything at any time.': 'Listenizdeki bir oyun çalışırken Vex, açtığınız web sayfalarını ve yaptığınız aramaları hatırlar; böylece o rehberi veya yapıyı yeniden bulabilirsiniz. Adresi, başlığı, geçirilen süreyi ve Recall açıksa ve sayfayı zaten biliyorsa kısa bir özeti saklar. Gizli pencereleri, Tor veya tek kullanımlık sekmeleri, giriş, ödeme, banka veya e-posta sayfalarını ve asla hatırlama listenizdeki siteleri kaydetmez. Yalnızca bu bilgisayarda tutulur, eşitlenmez ve istediğiniz zaman tek bir sayfayı ya da her şeyi silebilirsiniz.',
      'Game dossier': 'Oyun dosyası', 'Dossier': 'Dosya', 'dossier': 'dosya',
      'Vex can remember the pages you open and the searches you make while a game runs, so you can find them again.': 'Vex, bir oyun çalışırken açtığınız sayfaları ve yaptığınız aramaları hatırlayabilir; böylece onları yeniden bulabilirsiniz.',
      'Remember what I look at while I play': 'Oynarken baktıklarımı hatırla',
      'Open recently used pages with the guide': 'Son kullanılan sayfaları rehberle birlikte aç',
      'Never recorded: private windows, Tor and burner tabs, sign-in, payment, bank and mail pages, and these sites.': 'Asla kaydedilmez: gizli pencereler, Tor ve tek kullanımlık sekmeler, giriş, ödeme, banka ve e-posta sayfaları ve şu siteler.',
      'Never remember a site…': 'Bir siteyi asla hatırlama…', 'Never remember a site': 'Bir siteyi asla hatırlama', 'Website': 'Web sitesi', 'Pinned': 'Sabitlendi',
      'For example example.com — its subdomains are covered too.': 'Örneğin example.com — alt alan adları da kapsanır.',
      'Dossier for this game': 'Bu oyunun dosyası', 'Open dossier': 'Dosyayı aç',
      'Open which game’s dossier?': 'Hangi oyunun dosyası açılsın?',
      'Search this dossier': 'Bu dosyada ara', 'Export as Markdown': 'Markdown olarak dışa aktar',
      'Summarise what I learned': 'Öğrendiklerimi özetle', 'Asking your local AI…': 'Yerel yapay zekaya soruluyor…',
      'The local AI returned nothing.': 'Yerel yapay zeka bir şey döndürmedi.',
      'Clear everything': 'Her şeyi temizle', 'Clear this dossier?': 'Bu dosya temizlensin mi?',
      'every remembered page and search is deleted. Your guide pages stay.': 'hatırlanan her sayfa ve arama silinir. Rehber sayfalarınız kalır.',
      'Pin': 'Sabitle', 'Unpin': 'Sabitlemeyi kaldır', 'Add to my guide': 'Rehberime ekle', 'Added to': 'Eklendi:', 'guide': 'rehber',
      'Never remember this site': 'Bu siteyi asla hatırlama', 'Never remember this site?': 'Bu site asla hatırlanmasın mı?',
      'what is kept about it is deleted too.': 'hakkında tutulanlar da silinir.', 'Never remember': 'Asla hatırlama',
      'Most used': 'En çok kullanılan', 'Searches': 'Aramalar', 'Nothing matches.': 'Eşleşen yok.', 'Nothing yet.': 'Henüz bir şey yok.',
      'in your guide': 'rehberinde', 'pages': 'sayfa', 'pages kept': 'sayfa saklanıyor',
      'Remembering what you look at while this game runs.': 'Bu oyun çalışırken baktıklarınız hatırlanıyor.',
      'Not remembering right now — turn it on under Settings › Privacy Hardening › Gaming and streaming › Game mode.': 'Şu an hatırlanmıyor — Ayarlar › Gizlilik › Oyun ve yayın › Oyun modu altından açın.',
      'Vex gets out of a game\'s way and opens that game\'s own guide, then puts everything back when the game ends.':'Vex, oyunun yolundan çekilir ve o oyunun kendi rehberini açar; oyun bitince her şeyi eski haline getirir.',
    },
  },

  // The language in force. 'en' means "leave everything alone".
  locale() {
    try {
      let v = localStorage.getItem('vex.lang') || 'en';
      try { v = JSON.parse(v); } catch { /* stored unquoted */ }
      return this.TABLE[v] ? v : 'en';
    } catch { return 'en'; }
  },

  // The translation for one English string, or null when there isn't one.
  //
  // Tooltips in the toolbar are nearly all "Label (Ctrl+K)" — the shortcut is
  // not language, so the label is translated and the shortcut kept as it is.
  // Without this the whole toolbar stayed English over a one-word mismatch.
  lookup(text, lang) {
    const table = this.TABLE[lang || this.locale()];
    if (!table) return null;
    const key = String(text == null ? '' : text).trim();
    if (!key) return null;
    if (table[key] != null) return table[key];
    const m = /^(.+?)\s*\(([^()]*)\)$/.exec(key);
    if (m && table[m[1].trim()] != null) return table[m[1].trim()] + ' (' + m[2] + ')';
    // "… for example.com": the site's name is not language either. The table
    // holds "… for {}" and the host goes where {} is.
    const f = /^(.+ for) (\S+)$/.exec(key);
    if (f && table[f[1] + ' {}'] != null) return table[f[1] + ' {}'].replace('{}', f[2]);
    return null;
  },

  // The first direct text node with words in it: a section heading is
  // "<span class=set-emoji><svg/></span>General", a chip "<svg/>Privacy".
  _firstText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return n;
    return null;
  },

  // Each translated string keeps its English (data-i18n…) and what was shown
  // in its place (data-i18n…-shown). Both are needed: Vex's own code changes
  // labels while Turkish is on (a download's Pause becomes Resume), and that
  // fresh English must be translated in turn, and be what comes back on
  // switching to English — not the English the element started with.
  _swap(el, key, current, set, lang) {
    const shownKey = key + 'Shown';
    const cur = String(current).trim();
    if (el.dataset[shownKey] != null && el.dataset[shownKey] === cur) return false;   // still ours
    const hit = this.lookup(cur, lang);
    if (!hit) return false;
    el.dataset[key] = cur;
    el.dataset[shownKey] = hit;
    set(hit);
    return true;
  },

  // Translate one element's attributes and its text: all of it when it holds
  // nothing but text, otherwise its first text node only. Markup is never
  // rebuilt and no event listener is disturbed.
  translateEl(el, lang) {
    let changed = false;
    for (const attr of this.ATTRS) {
      const value = el.getAttribute && el.getAttribute(attr);
      if (!value) continue;
      if (this._swap(el, 'i18n' + attr.replace(/-/g, ''), value, (v) => el.setAttribute(attr, v), lang)) changed = true;
    }
    if (el.children.length === 0) {
      if (el.textContent && this._swap(el, 'i18nText', el.textContent, (v) => { el.textContent = v; }, lang)) changed = true;
    } else {
      const node = this._firstText(el);
      if (node && this._swap(el, 'i18nFirst', node.textContent, (v) => { node.textContent = node.textContent.replace(node.textContent.trim(), v); }, lang)) changed = true;
    }
    return changed;
  },

  // Put everything back to the English it was drawn with — unless Vex has
  // since replaced the translation with something else, which then stays.
  revert(root) {
    const scope = root || document;
    const back = (key, attrName, current, set) => {
      scope.querySelectorAll('[' + attrName + ']').forEach((el) => {
        const en = el.dataset[key];
        const shown = el.dataset[key + 'Shown'];
        const cur = current(el);
        if (cur != null && shown != null && String(cur).trim() === shown) set(el, en);
        delete el.dataset[key];
        delete el.dataset[key + 'Shown'];
      });
    };
    const firstBack = (el, en) => { const n = this._firstText(el); n.textContent = n.textContent.replace(n.textContent.trim(), en); };
    // A text-only label may have been given a child since (Settings puts its
    // mark in front of each heading): then only its text node goes back.
    back('i18nText', 'data-i18n-text', (el) => (el.children.length ? (this._firstText(el) || {}).textContent : el.textContent),
      (el, en) => { if (el.children.length) firstBack(el, en); else el.textContent = en; });
    back('i18nFirst', 'data-i18n-first', (el) => { const n = this._firstText(el); return n ? n.textContent : null; }, firstBack);
    for (const attr of this.ATTRS) {
      const key = 'i18n' + attr.replace(/-/g, '');
      back(key, 'data-' + key, (el) => el.getAttribute(attr), (el, en) => el.setAttribute(attr, en));
    }
    if (!root && typeof document !== 'undefined') document.documentElement.lang = this.locale();
  },

  // The English a heading was drawn with, for code that reads it to decide
  // something (Settings' categories and Simple mode match English words).
  english(el) {
    if (!el) return '';
    if (el.dataset.i18nText != null) return el.dataset.i18nText;
    const n = this._firstText(el);
    if (el.dataset.i18nFirst != null && n) return el.textContent.replace(n.textContent.trim(), el.dataset.i18nFirst);
    return el.textContent;
  },

  // Translate the chrome. Safe to call as often as you like: an element that
  // has already been translated carries its English original and is skipped.
  apply(root) {
    const lang = this.locale();
    if (lang === 'en') { this.revert(root); return 0; }
    // Screen readers and the spell checker read the window's language from here.
    document.documentElement.lang = lang;
    const scope = root && root.querySelectorAll ? root : document;
    let n = 0;
    const seen = new Set();
    for (const sel of this.SCOPES) {
      scope.querySelectorAll(sel).forEach((container) => {
        // Never reach into a page: a <webview> is somebody else's document.
        if (container.closest && container.closest('webview')) return;
        container.querySelectorAll('*').forEach((el) => {
          if (seen.has(el) || el.tagName === 'WEBVIEW' || el.closest('webview')) return;
          seen.add(el);
          if (this.translateEl(el, lang)) n++;
        });
        if (!seen.has(container)) { seen.add(container); if (this.translateEl(container, lang)) n++; }
      });
    }
    return n;
  },

  // Re-run when the chrome changes: a panel that renders after start-up draws
  // fresh English, so it has to be caught when it appears.
  watch() {
    if (this._watching) return;
    this._watching = true;
    let pending = null;
    const rerun = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => { pending = null; try { this.apply(); } catch (err) { console.warn('[i18n] pass failed:', err && err.message); } });
    };
    document.addEventListener('vex:panel-changed', rerun);
    window.addEventListener('vex-lang-changed', () => { this.revert(); this.apply(); });
    this._rerun = rerun;
  },

  init() {
    this.watch();
    this.apply();
  },
};

if (typeof window !== 'undefined') {
  window.VexI18nUI = VexI18nUI;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => VexI18nUI.init(), { once: true });
  } else {
    VexI18nUI.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexI18nUI };
