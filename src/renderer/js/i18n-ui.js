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
    '#command-bar', '.vexd-card', '#vex-archive', '.slad-card',
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
      // --- feature audit 2026-10 ---
      'Keep This Tab Awake…': 'Bu sekmeyi uyanık tut…',
      'Knowledge: show-me-where citations': 'Bilgi: kaynağı göster alıntıları',
      'Long documents': 'Uzun belgeler',
      'Sign-in: why you were signed out': 'Oturum: neden çıkış yapıldı',
      'Volume: kept per site': 'Ses: site başına saklanan',
      // --- Wave 5 headings, chips and commands ---
      'Go to a higher level of this address': 'Bu adresin üst düzeyine git',
      'Move this tab to a new window': 'Bu sekmeyi yeni pencereye taşı',
      'Reading aids: I know the selected word': 'Okuma yardımları: seçili sözcüğü biliyorum',
      'Reading aids: clear the marks': 'Okuma yardımları: işaretleri temizle',
      'Reading aids: mark up this page': 'Okuma yardımları: bu sayfayı işaretle',
      'Reading aids: save the selected word': 'Okuma yardımları: seçili sözcüğü kaydet',
      'Requests of this tab: copy one as cURL, fetch or PowerShell': 'Bu sekmenin istekleri: birini cURL, fetch veya PowerShell olarak kopyala',
      'Reset command order': 'Komut sırasını sıfırla',
      'Resolve the selected Roblox id': 'Seçili Roblox kimliğini çöz',
      'Search the web for the selection': 'Seçimi web\'de ara',
      'Split view: fill the area': 'Bölünmüş görünüm: alanı doldur',
      'Subject view': 'Konu görünümü',
      'Weekly safety check': 'Haftalık güvenlik kontrolü',
      'Which model fits my tasks?': 'Hangi model işlerime uyuyor?',
      'Fake update guard': 'Sahte güncelleme koruması',
      'Local model: fit and warm-up': 'Yerel model: uygunluk ve ısınma',
      'Reading aids': 'Okuma yardımları',
      // --- Wave 6 headings and commands ---
      'AI quality history': 'Yapay zeka kalite geçmişi',
      'Measure Discord over 10 minutes': 'Discord\'u 10 dakika boyunca ölç',
      'Plugin memory: which Vencord plugin costs how many MB': 'Eklenti belleği: hangi Vencord eklentisi kaç MB tutuyor',
      'Redact a text document': 'Bir metin belgesinin gizli kısımlarını karart',
      'Slot watcher: keep looking at this tab': 'Zaman aralığı gözcüsü: bu sekmeye bakmaya devam et',
      'Slot watcher: look at this tab': 'Zaman aralığı gözcüsü: bu sekmeye bak',
      'AI spend cap: money budget and prices': 'Yapay zeka harcama sınırı: para bütçesi ve fiyatlar',
      'Encrypted profile lock': 'Şifreli profil kilidi',
      'Meeting transcript': 'Toplantı dökümü',
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
      // Schedules is now the Clock panel's "Scheduled tasks" sub-tab.
      'Clock and schedules': 'Saat ve zamanlanmış görevler', 'Scheduled tasks': 'Zamanlanmış görevler',
      'Clock and schedules — alarms, timers, stopwatch, world clock, scheduled tasks (Ctrl+Shift+L)': 'Saat ve zamanlanmış görevler — alarmlar, zamanlayıcılar, kronometre, dünya saati, zamanlanmış görevler (Ctrl+Shift+L)',
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
      'Boosts': 'Güçlendirmeler', 'Developer': 'Geliştirici', 'Chains': 'Zincirler', 'Extras': 'Ekstralar', 'Play': 'Oyun',
      // Chips added with the 2026-10 features.
      'Focus OS': 'Odak planı', 'Knowledge': 'Bilgi', 'Vex health': 'Vex sağlığı',
      'Health check': 'Sağlık denetimi', 'Minimal Vex': 'Sade Vex', 'Feature usage': 'Özellik kullanımı',
      'Little surprises': 'Küçük sürprizler', 'Living Vex': 'Yaşayan Vex', 'Citations in Notes': 'Notlarda kaynakça',
      'Knowledge base': 'Bilgi tabanı', 'Research board': 'Araştırma panosu', 'Translation glossary': 'Çeviri sözlüğü',
      'Meeting copilot': 'Toplantı yardımcısı', 'Listen to articles': 'Makaleleri dinle',
      'Subscriptions and renewals': 'Abonelikler ve yenilemeler', 'Sources into a document': 'Kaynaklardan belge',
      'Explain this page (local model)': 'Bu sayfayı açıkla (yerel model)', 'Web safety': 'Web güvenliği',
      'Time travel': 'Zaman yolculuğu', 'Vex Packs': 'Vex paketleri', 'Profile and medals': 'Profil ve madalyalar',
      'Fun and expression': 'Eğlence ve ifade', 'Quiet hours': 'Sessiz saatler',
      // Userscripts: the Settings heading, the commands and the toolbar marker.
      'Userscripts': 'Kullanıcı betikleri', 'Userscripts (manage)': 'Kullanıcı betikleri (yönet)',
      'Disable all userscripts': 'Tüm kullanıcı betiklerini kapat',
      'Install, switch off or delete userscripts; one click turns them all off': 'Kullanıcı betiklerini kur, kapat ya da sil; tek tıkla hepsini kapat',
      'Turn all userscripts off at once; nothing runs until you turn them back on': 'Tüm kullanıcı betiklerini birden kapat; yeniden açana kadar hiçbiri çalışmaz',
      'Userscripts running on this page': 'Bu sayfada çalışan kullanıcı betikleri',
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
      'Workflow and chains': 'İş akışı ve zincirler',
      'Morning Brief': 'Sabah özeti', 'Brief actions': 'Özet eylemleri',
      'Memory tools': 'Hafıza araçları', 'Distraction budget': 'Dikkat bütçesi',
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
      // AI news: Settings block, toolbar badge and panel.
      'AI news': 'Yapay zekâ haberleri', 'AI News': 'Yapay zekâ haberleri', 'Tell me about AI news': 'Yapay zekâ haberlerini bana bildir',
      'Send a test notification': 'Deneme bildirimi gönder', 'Check now': 'Şimdi denetle', 'Open AI news': 'Yapay zekâ haberlerini aç',
      'Where from': 'Kaynak', 'News address': 'Haber adresi', 'Save address': 'Adresi kaydet', 'Use the default address': 'Varsayılan adresi kullan',
      'Check every': 'Denetleme sıklığı', 'How you are told': 'Nasıl haber verilsin',
      'Windows notification': 'Windows bildirimi', 'Pop-up inside Vex': 'Vex içinde açılır bildirim', 'Toolbar badge': 'Araç çubuğu rozeti',
      'Daily digest': 'Günlük özet', 'Play the notification sound': 'Bildirim sesini çal',
      'What to follow and what to mute': 'Neyi izleyelim, neyi susturalım', 'Follow': 'Takip et', 'Mute': 'Sustur',
      'Topics': 'Konular', 'Companies': 'Şirketler', 'Sources': 'Kaynaklar', 'Your rules': 'Kurallarınız',
      'Add a rule…': 'Kural ekle…', 'Save rule': 'Kuralı kaydet', 'Quiet hours': 'Sessiz saatler', 'Not too many': 'Çok fazla olmasın',
      'Mute source': 'Kaynağı sustur', 'Mute topic…': 'Konuyu sustur…', 'Why was I notified?': 'Neden bildirim aldım?',
      'Mark all read': 'Tümünü okundu say', 'Unread only': 'Yalnızca okunmamışlar', 'Search stories': 'Haberlerde ara',
      'All topics': 'Tüm konular', 'All sources': 'Tüm kaynaklar', 'Today': 'Bugün', 'Yesterday': 'Dün',
      'Model releases': 'Model sürümleri', 'Research and papers': 'Araştırma ve makaleler', 'Open source and open weights': 'Açık kaynak ve açık ağırlıklar',
      'Policy and regulation': 'Politika ve düzenleme', 'Chips and hardware': 'Çipler ve donanım', 'Funding and business': 'Yatırım ve iş dünyası',
      'Safety and security': 'Güvenlik', 'Tools and products': 'Araçlar ve ürünler', 'China': 'Çin', 'Turkey': 'Türkiye',
      'Forget the stories Vex holds': 'Vex’in tuttuğu haberleri unut',
      'Languages': 'Diller', 'Turkish': 'Türkçe', 'Chinese': 'Çince', 'Other languages': 'Diğer diller',
      'Only stories in the languages ticked here are kept. Nothing is translated; a story that names no language counts as English.': 'Yalnızca burada işaretli dillerdeki haberler tutulur. Hiçbir şey çevrilmez; dil belirtmeyen haber İngilizce sayılır.',
      'Keep at least one language ticked': 'En az bir dil işaretli kalmalı',
      'N stories in other languages were left out (Settings › AI News › Languages)': 'N haber başka dillerde olduğu için alınmadı (Ayarlar › Yapay zekâ haberleri › Diller)',
      'Date': 'Tarih', 'Any time': 'Her zaman', 'Last hour': 'Son bir saat', 'Last 24 hours': 'Son 24 saat', 'Last 3 days': 'Son 3 gün',
      'Last 7 days': 'Son 7 gün', 'Last 14 days': 'Son 14 gün', 'Sort by': 'Sırala', 'Newest first': 'En yeni önce',
      'Most important first': 'En önemli önce', 'Unread first, then newest': 'Önce okunmamışlar, sonra en yeniler',
      'Clear filters': 'Filtreleri temizle', 'Show more': 'Daha fazla göster', 'just now': 'az önce', 'yesterday': 'dün',
      '%n minute ago': '%n dakika önce', '%n minutes ago': '%n dakika önce', '%n hour ago': '%n saat önce', '%n hours ago': '%n saat önce',
      '%n day ago': '%n gün önce', '%n days ago': '%n gün önce', '%n month ago': '%n ay önce', '%n months ago': '%n ay önce',
      'date unknown, first seen %s': 'tarih bilinmiyor, ilk görülme: %s', 'First seen': 'İlk görülme', 'Date unknown': 'Tarih bilinmiyor',
      'Showing %n of %t story': '%t haberden %n tanesi gösteriliyor', 'Showing %n of %t stories': '%t haberden %n tanesi gösteriliyor',
      'newest': 'en yeni', 'oldest': 'en eski',
      'Watched Pages': 'İzlenen sayfalar', 'Watched Pages (what changed)': 'İzlenen sayfalar (ne değişti)',
      'Reading & Accessibility': 'Okuma ve erişilebilirlik',
      'Recall (full-text history)': 'Geri çağırma (tam metin geçmişi)',
      'Find by meaning (optional)': 'Anlama göre bul (isteğe bağlı)',
      'Use this model': 'Bu modeli kullan', 'Forget meaning index': 'Anlam dizinini unut',
      'matched by meaning': 'anlamına göre eşleşti',
      'Recall by meaning': 'Anlama göre geri çağırma',
      'Browsing extras': 'Gezinme ekstraları',
      'Cloud Services (self-hosted)': 'Bulut hizmetleri (kendi sunucunuzda)',
      'Gaming and streaming': 'Oyun ve yayın', 'Discord hotkeys': 'Discord kısayol tuşları',
      'When a game is running': 'Bir oyun çalışırken', 'Your local models': 'Yerel modelleriniz',
      'Streamer mode': 'Yayıncı modu',
      // --- On battery (js/battery-mode.js) ---
      'On battery': 'Pilde', 'Saving battery': 'Pil tasarrufu',
      'Low battery — saving power': 'Pil azaldı — güç tasarrufu',
      'Save power when this PC is on battery': 'Bilgisayar pildeyken güç tasarrufu yap',
      'Sleep idle tabs sooner': 'Boştaki sekmeleri daha erken uyut',
      'Wait with background checks': 'Arka plan kontrollerini beklet',
      'Hold background AI': 'Arka plandaki yapay zekâyı beklet',
      'Keep Vex still': 'Vex’i hareketsiz tut',
      'Count the battery as low at': 'Pili şu seviyede düşük say',
      'Off.': 'Kapalı.',
      'No battery detected on this PC, so this does nothing here.': 'Bu bilgisayarda pil bulunamadı, bu yüzden burada hiçbir şey yapmaz.',
      'No battery detected on this PC, so turning this on would do nothing here.': 'Bu bilgisayarda pil bulunamadı, bu yüzden açmak burada hiçbir şey yapmaz.',
      'Vex follows mains and battery and the charge level. Windows’ own Battery Saver switch is not something Vex can see.': 'Vex şebeke/pil durumunu ve şarj düzeyini izler. Windows’un kendi Pil Tasarrufu düğmesini Vex göremez.',

      // --- archive library (js/archive-library.js) ---
      'Archive library': 'Arşiv kitaplığı',
      'Archive this page': 'Bu sayfayı arşivle',
      'Archive This Page': 'Bu sayfayı arşivle',
      'Archive Library': 'Arşiv kitaplığı',
      'Open the library': 'Kitaplığı aç',
      'Open library': 'Kitaplığı aç',
      'Open your copy': 'Kopyanızı açın',
      'Search titles and the saved text': 'Başlıklarda ve kayıtlı metinde arayın',
      'Search your copies': 'Kopyalarınızda arayın',
      'No copies yet': 'Henüz kopya yok',
      'No copy matches': 'Eşleşen kopya yok',
      'Try other words.': 'Başka sözcükler deneyin.',
      'Open a page and press Archive this page.': 'Bir sayfa açın ve Bu sayfayı arşivle düğmesine basın.',
      'Open': 'Aç', 'Export': 'Dışa aktar', 'Delete': 'Sil',
      'Offer my copy when a page I archived will not load': 'Arşivlediğim bir sayfa açılmazsa kopyamı öner',
      'Copies of pages you chose to keep, on this PC only.': 'Saklamayı seçtiğiniz sayfaların kopyaları, yalnızca bu bilgisayarda.',
      'Keeps a copy of the page on this PC, in a library Vex manages, so it still opens when the page is changed or gone.': 'Sayfanın bir kopyasını bu bilgisayarda, Vex’in yönettiği bir kitaplıkta saklar; sayfa değişse ya da kalksa da açılır.',
      'The pages you chose to keep, searchable by title and by what they say, each opening without the network and without running its scripts.': 'Saklamayı seçtiğiniz sayfalar; başlığa ve içeriğe göre aranır, her biri ağ olmadan ve betikleri çalışmadan açılır.',

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
      'Don’t ask again': 'Bir daha sorma',
      '{app} is running. Game mode makes Vex stay out of its way while it does: background tabs sleep, sync, AI tasks and indexing wait, and Vex runs quieter. It never touches the game itself. Everything comes back when the game ends.': '{app} çalışıyor. Oyun modu, çalışırken Vex’in yolundan çekilmesini sağlar: arka plandaki sekmeler uyur, eşitleme, yapay zekâ görevleri ve dizinleme bekler, Vex daha sessiz çalışır. Oyuna hiç dokunmaz. Oyun bitince her şey geri gelir.',
      'A game is running. Game mode makes Vex stay out of its way while it does: background tabs sleep, sync, AI tasks and indexing wait, and Vex runs quieter. It never touches the game itself. Everything comes back when the game ends.': 'Bir oyun çalışıyor. Oyun modu, çalışırken Vex’in yolundan çekilmesini sağlar: arka plandaki sekmeler uyur, eşitleme, yapay zekâ görevleri ve dizinleme bekler, Vex daha sessiz çalışır. Oyuna hiç dokunmaz. Oyun bitince her şey geri gelir.',
      'A full-screen app ({app}) is in front. If it is a game, Game mode makes Vex stay out of its way while you play: background tabs sleep, sync, AI tasks and indexing wait, and Vex runs quieter. It never touches the game itself. Everything comes back when it ends.': 'Tam ekran bir uygulama ({app}) önde. Bir oyunsa, Oyun modu siz oynarken Vex’in yolundan çekilmesini sağlar: arka plandaki sekmeler uyur, eşitleme, yapay zekâ görevleri ve dizinleme bekler, Vex daha sessiz çalışır. Oyuna hiç dokunmaz. Bittiğinde her şey geri gelir.',
      'A full-screen app is in front. If it is a game, Game mode makes Vex stay out of its way while you play: background tabs sleep, sync, AI tasks and indexing wait, and Vex runs quieter. It never touches the game itself. Everything comes back when it ends.': 'Tam ekran bir uygulama önde. Bir oyunsa, Oyun modu siz oynarken Vex’in yolundan çekilmesini sağlar: arka plandaki sekmeler uyur, eşitleme, yapay zekâ görevleri ve dizinleme bekler, Vex daha sessiz çalışır. Oyuna hiç dokunmaz. Bittiğinde her şey geri gelir.',
      'Vex will ask again for a different app. To stop being asked, choose “Don’t ask again” in the question, or turn Game mode off in Settings › Privacy Hardening › Gaming and streaming': 'Vex farklı bir uygulama için yine soracak. Sorulmasını durdurmak için soruda “Bir daha sorma”yı seçin ya da Ayarlar › Gizlilik Sertleştirme › Oyun ve yayın bölümünde Oyun modunu kapatın.',
      'Game mode is off — Settings › Privacy Hardening › Gaming and streaming turns it on': 'Oyun modu kapalı — Ayarlar › Gizlilik Sertleştirme › Oyun ve yayın bölümünden açılır.',
      'Add this page to which game?': 'Bu sayfa hangi oyuna eklensin?',
      'Add this page to a game’s guide': 'Bu sayfayı bir oyunun rehberine ekle',
      'Off for now — Vex asks once, the first time a game starts.': 'Şimdilik kapalı — Vex, bir oyun ilk kez başladığında bir kez sorar.',
      // Patch radar (js/patch-radar.js).
      'Patch notes page': 'Yama notları sayfası', 'Add a patch notes page…': 'Yama notları sayfası ekle…',
      'Patch notes page for': 'Yama notları sayfası:', 'Address, Steam app number, or GitHub owner/repo': 'Adres, Steam uygulama numarası veya GitHub sahip/depo',
      'Look': 'Bak', 'new': 'yeni', 'seen': 'görüldü', 'paused': 'duraklatıldı', 'hidden tab': 'gizli sekme',
      'suggested, unverified': 'önerilen, doğrulanmadı', 'Watch': 'İzle',
      'New patch notes for': 'Yeni yama notları:', 'patch notes': 'yama notları', 'Patch notes': 'Yama notları',
      'Watching for patch notes for': 'Yama notları izleniyor:', 'Watch for patch notes for': 'Yama notları izlensin mi:',
      'This page needs JavaScript': 'Bu sayfa JavaScript gerektiriyor', 'Use the hidden tab': 'Gizli sekmeyi kullan',
      'A feed. Newest item:': 'Bir besleme. En yeni öğe:',
      'An ordinary page. Vex will say when its text changes.': 'Sıradan bir sayfa. Vex, metni değişince söyler.',
      'Checked every 6 hours from this computer. Stop it any time here.': 'Bu bilgisayardan 6 saatte bir kontrol edilir. İstediğin zaman buradan durdurabilirsin.',
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
      // "This site is broken" (js/site-ladder.js)
      'This site is broken': 'Bu site bozuk',
      'This Site Is Broken': 'Bu site bozuk',
      'Step': 'Adım', 'of': '/',
      'Did that fix it?': 'Düzeldi mi?',
      'Yes, it works now': 'Evet, şimdi çalışıyor',
      'No, try the next thing': 'Hayır, sonrakini dene',
      'No, put it back': 'Hayır, eski haline getir',
      'Stop and put it back': 'Dur ve eski haline getir',
      'Report to myself': 'Kendime rapor et',
      'Undo this fix': 'Bu düzeltmeyi geri al',
      'Tighten again': 'Yeniden sıkılaştır',
      'Check browser identity': 'Tarayıcı kimliğini denetle',
      'Fixed — and kept for {}': 'Düzeldi ve şu site için saklandı: {}',
      'What was changed for {}': 'Şu site için neler değişti: {}',
      'None of those fixed it': 'Hiçbiri düzeltmedi',
      'Nothing of Vex’s is holding this site back': 'Vex’in hiçbir ayarı bu siteyi engellemiyor',
      'Everything is back the way it was.': 'Her şey eski haline döndü.',
      'The problem is probably not one of Vex’s per-site settings.': 'Sorun büyük olasılıkla Vex’in site başına ayarlarından biri değil.',
      'Vex has nothing to relax for {}': 'Vex’in şu site için gevşetebileceği bir şey yok: {}',
      'Its ad blocker is off or not in use, and it has no rule, Boost or forced dark mode.': 'Reklam engelleyicisi kapalı ya da kullanılmıyor; siteye ait kural, Boost veya zorunlu koyu mod da yok.',
      'The page was reloaded. Only this site is changed. If this does not fix it, Vex puts it back before trying the next thing.': 'Sayfa yeniden yüklendi. Yalnızca bu site değişir. Bu düzeltmezse Vex, sonrakini denemeden önce eski haline getirir.',
      'This is kept as an ordinary rule for this site only. It shows in the site panel and in Settings › Site settings.': 'Bu, yalnızca bu site için sıradan bir kural olarak saklanır. Site panelinde ve Ayarlar › Site ayarları’nda görünür.',
      'Ads and trackers are now allowed for {}': 'Reklam ve izleyicilere şu site için izin verildi: {}',
      'The Boost and forced dark mode are paused for {}': 'Boost ve zorunlu koyu mod şu site için duraklatıldı: {}',
      'What its rules turned off is allowed again for {}': 'Kurallarının kapattığı şeylere şu site için yeniden izin verildi: {}',
      'Everything that applied is relaxed together for {}': 'Uygulanabilen her şey şu site için birlikte gevşetildi: {}',
      'Ads and trackers are not blocked for {}': 'Reklam ve izleyiciler şu site için engellenmiyor: {}',
      'Its Boost is paused for {}': 'Boost’u şu site için duraklatıldı: {}',
      'Forced dark mode is paused for {}': 'Zorunlu koyu mod şu site için duraklatıldı: {}',
      'Its Boost and forced dark mode are paused for {}': 'Boost’u ve zorunlu koyu modu şu site için duraklatıldı: {}',
      'JavaScript allowed again for {}': 'JavaScript şu site için yeniden açıldı: {}',
      'Cookies allowed again for {}': 'Çerezler şu site için yeniden açıldı: {}',
      'Content from other sites allowed again for {}': 'Diğer sitelerin içeriği şu site için yeniden açıldı: {}',
      'JavaScript, cookies allowed again for {}': 'JavaScript ve çerezler şu site için yeniden açıldı: {}',
      'JavaScript, content from other sites allowed again for {}': 'JavaScript ve diğer sitelerin içeriği şu site için yeniden açıldı: {}',
      'Cookies, content from other sites allowed again for {}': 'Çerezler ve diğer sitelerin içeriği şu site için yeniden açıldı: {}',
      'JavaScript, cookies, content from other sites allowed again for {}': 'JavaScript, çerezler ve diğer sitelerin içeriği şu site için yeniden açıldı: {}',
      'Does this site not work?': 'Bu site çalışmıyor mu?',
      'Vex tries its own settings one at a time and asks if each one helped.': 'Vex kendi ayarlarını tek tek dener ve her birinin işe yarayıp yaramadığını sorar.',
      'A fix is kept for this site.': 'Bu site için bir düzeltme saklanıyor.',
      'Show what was changed': 'Nelerin değiştiğini göster',
      // Start with Windows, Global Privacy Control, the referrer, and a site's
      // own User-Agent and pictures (Settings, the Library and the site panel).
      'Start Vex when I sign in to Windows': 'Windows’ta oturum açtığımda Vex’i başlat',
      'Start minimised': 'Simge durumunda başlat',
      'Global Privacy Control': 'Küresel Gizlilik Denetimi',
      'Referrer trimming': 'Yönlendiren adres kısaltma',
      'Browser default': 'Tarayıcı varsayılanı',
      'Leave it out': 'Hariç tut',
      'Needs the referrer': 'Yönlendiren adrese ihtiyacı var',
      'No site is left out.': 'Hiçbir site hariç tutulmadı.',
      'No site is listed.': 'Listede site yok.',
      'Pictures': 'Resimler',
      'How it sees you': 'Sizi nasıl görür',
      'Ask for this site as': 'Bu siteyi şöyle iste',
      'Desktop site (the usual)': 'Masaüstü sitesi (olağan)',
      'Mobile site': 'Mobil site',
      'Custom User-Agent…': 'Özel User-Agent…',
      'Send Global Privacy Control': 'Küresel Gizlilik Denetimi’ni gönder',
      'This site needs the referrer': 'Bu site yönlendiren adrese ihtiyaç duyuyor',
      'Start Vex when Windows starts': 'Windows başlarken Vex’i başlat',
      'Pictures off for a site': 'Bir site için resimleri kapat',
      'Ask for a site as mobile, or with your own User-Agent': 'Bir siteyi mobil olarak veya kendi User-Agent’ınızla iste',

      // --- Settings headings and Ctrl+K commands added in Waves 0-3 (T3-053). tests/renderer/localeCompleteness.test.js
      // fails when a new heading, chip or command is neither here nor on its allowlist. ---
      'On-Device AI (WebGPU)': 'Cihaz üzerinde yapay zekâ (WebGPU)',
      'Badges': 'Rozetler',
      'AI agent — task runner': 'Yapay zekâ aracısı — görev çalıştırıcı',
      'Announcement desk': 'Duyuru masası',
      'Attention': 'Dikkat',
      'Copy as cURL, fetch or PowerShell': 'cURL, fetch veya PowerShell olarak kopyala',
      'Copy with source': 'Kaynağıyla kopyala',
      'Copy selection as...': 'Seçimi şu biçimde kopyala...',
      'Find deadlines': 'Son tarihleri bul',
      'Developer helpers': 'Geliştirici yardımcıları',
      'Developer loop': 'Geliştirici döngüsü',
      'What is due': 'Zamanı gelenler',
      'First open of the day': 'Günün ilk açılışı',
      'Game mode helpers': 'Oyun modu yardımcıları',
      'GitHub access': 'GitHub erişimi',
      'Inbox': 'Gelen kutusu',
      'New Tab layout': 'Yeni sekme düzeni',
      'Next step': 'Sonraki adım',
      'Set my next step': 'Sonraki adımımı belirle',
      'Clear my next step': 'Sonraki adımımı temizle',
      'Night usage coach': 'Gece kullanımı koçu',
      'Make This Page Available Offline': 'Bu sayfayı çevrimdışı kullanılabilir yap',
      'Pages Available Offline': 'Çevrimdışı kullanılabilen sayfalar',
      'Page actions — boost scripts': 'Sayfa eylemleri — güçlendirme betikleri',
      'Page recorder — record and schedule boost scripts': 'Sayfa kaydedici — güçlendirme betiklerini kaydet ve zamanla',
      'Panels and messages': 'Paneller ve mesajlar',
      'Park and resume': 'Park et ve devam et',
      'Park: one line': 'Park: tek satır',
      'Parked cards': 'Park edilen kartlar',
      'Update self-test': 'Güncelleme öz sınaması',
      'Release check': 'Sürüm denetimi',
      'Reading — readability per site': 'Okuma — site başına okunabilirlik',
      'Tab tools': 'Sekme araçları',
      'Update safety net': 'Güncelleme güvenlik ağı',
      'Playfulness': 'Eğlence düzeyi',
      'What Changed in My World This Week': 'Bu hafta dünyamda neler değişti',
      'Workspace metrics': 'Çalışma alanı ölçümleri',
      'Your Year in Vex': 'Vex’te yılınız',
      // Study helpers (T3-027, 029, 034, 044, 049, 028, 076, 104, 106, 115)
      'Study helpers': 'Çalışma yardımcıları',
      'Glossary': 'Terimler sözlüğü',
      'Find terms on this page': 'Bu sayfadaki terimleri bul',
      'Study time': 'Çalışma süresi',
      'Cheat sheet from highlights': 'Vurgulardan özet kâğıdı',
      'Check a draft': 'Taslağı denetle',
      'Syllabus coverage': 'Müfredat kapsamı',
      'Source check (rough)': 'Kaynak denetimi (kabaca)',
      'MUN toolkit': 'MUN araç seti',
      'Motion wording': 'Önerge ifadeleri',
      'Speech timer': 'Konuşma zamanlayıcısı',
      'Turkish helpers': 'Türkçe yardımcıları',
      'Add to glossary...': 'Terimler sözlüğüne ekle...',
      'Put Turkish letters back...': 'Türkçe harfleri geri koy...',
      'Reading font': 'Okuma yazı tipi', 'Line spacing': 'Satır aralığı', 'Letter and word spacing': 'Harf ve sözcük aralığı',
      'Focus line (dims the page except a band at the cursor)': 'Odak çizgisi (imlecin çevresi dışında sayfayı karartır)',

      // --- Headings, chips and Ctrl+K commands that were still English (Wave 5, T3-053). Brand names are kept as they are. ---
      'AI History': 'Yapay zekâ geçmişi',
      'AI Compose': 'Yapay zekâ ile yaz',
      'AI Restyle This Site': 'Bu sitenin görünümünü yapay zekâ ile değiştir',
      'AI Tab Command': 'Yapay zekâ sekme komutu',
      'AI Translate': 'Yapay zekâ ile çevir',
      'AI recipes': 'Yapay zekâ tarifleri',
      'AI: Remember a Fact': 'Yapay zekâ: Bir bilgiyi hatırla',
      'API Client': 'API istemcisi',
      'Add This Page to Project': 'Bu sayfayı projeye ekle',
      'Add a To-do': 'Yapılacak ekle',
      'Add a tool…': 'Araç ekle…',
      'Add an Action Item': 'Eylem maddesi ekle',
      'Add the Selected Text to Project': 'Seçili metni projeye ekle',
      'All Sticky Notes': 'Tüm yapışkan notlar',
      'Ask Two Models Side by Side': 'İki modele yan yana sor',
      'Ask Vex to do something…': 'Vex’ten bir şey yapmasını iste…',
      'Auto-refresh This Tab': 'Bu sekmeyi otomatik yenile',
      'Automations': 'Otomasyonlar',
      'Autopilot: What Needs Me': 'Otopilot: Bana ne gerekiyor',
      'Back Up Everything, or Put It Back': 'Her şeyi yedekle ya da geri yükle',
      'Back to the pinned page': 'Sabitlenen sayfaya dön',
      'Background email-code reading (toggle)': 'Arka planda e-posta kodu okuma (aç/kapat)',
      'Bionic Reading': 'Biyonik okuma',
      'Bookmark This Page': 'Bu sayfayı yer imlerine ekle',
      'Boost This Site': 'Bu siteyi güçlendir',
      'Burner Identity': 'Tek kullanımlık kimlik',
      'Calendar': 'Takvim',
      'Check Accessibility of This Page': 'Bu sayfanın erişilebilirliğini denetle',
      'Check a QR code': 'Bir QR kodunu denetle',
      'Check screen sharing': 'Ekran paylaşımını denetle',
      'Check the marks on my downloads': 'İndirmelerimin işaretlerini denetle',
      'Check this listing for red flags': 'Bu ilanda şüpheli işaretlere bak',
      'Choose Theme': 'Tema seç',
      'Chores and bills': 'İşler ve faturalar',
      'Cite This Page': 'Bu sayfayı kaynak göster',
      'Cited pages': 'Kaynak gösterilen sayfalar',
      'Clear Browsing Data': 'Gezinti verilerini temizle',
      'Clip to Notes': 'Notlara kırp',
      'Clipboard History': 'Pano geçmişi',
      'Clips Inbox (text kept from the capture box)': 'Kırpıntı kutusu (yakalama kutusundan kalan metin)',
      'Clock': 'Saat',
      'Close Duplicate Tabs': 'Yinelenen sekmeleri kapat',
      'Close Tab': 'Sekmeyi kapat',
      'Close all overlays': 'Tüm katmanları kapat',
      'Close the day': 'Günü kapat',
      'Close the second-screen window': 'İkinci ekran penceresini kapat',
      'Cloudflare dashboard': 'Cloudflare paneli',
      'Colours You Picked': 'Seçtiğiniz renkler',
      'Compact Mode': 'Kompakt mod',
      'Compare Tabs': 'Sekmeleri karşılaştır',
      'Compare Two Pages': 'İki sayfayı karşılaştır',
      'Cookie banners: leave this site alone, or handle it again': 'Çerez bildirimleri: bu siteye dokunma ya da yeniden ele al',
      'Copy All Tab URLs': 'Tüm sekme adreslerini kopyala',
      'Copy Page as Markdown': 'Sayfayı Markdown olarak kopyala',
      'Copy Text from Doc (Google Docs / OCR)': 'Belgeden metin kopyala (Google Docs / OCR)',
      'Copy a Table or List from This Page': 'Bu sayfadan bir tablo ya da liste kopyala',
      'Copy diagnostics': 'Tanılama bilgilerini kopyala',
      'Copy tables as CSV': 'Tabloları CSV olarak kopyala',
      'Courses': 'Dersler',
      'Crawl This Site': 'Bu siteyi tara',
      'Daily Journal': 'Günlük',
      'Deadlines with countdown': 'Geri sayımlı son tarihler',
      'Delegation Dossier (Model UN)': 'Delegasyon dosyası (Model BM)',
      'Developer dashboard': 'Geliştirici paneli',
      'Developer mode': 'Geliştirici modu',
      'Devices': 'Cihazlar',
      'Dictate': 'Dikte et',
      'Dictation Settings': 'Dikte ayarları',
      'Discover — everything Vex can do': 'Keşfet — Vex’in yapabildiği her şey',
      'Do That Again': 'Bunu yeniden yap',
      'Do You Remember?': 'Hatırlıyor musun?',
      'Done with this page': 'Bu sayfayla işim bitti',
      'Double-Click a Word for Its Meaning': 'Anlamı için bir sözcüğe çift tıklayın',
      'Download Media on Page': 'Sayfadaki medyayı indir',
      'Duplicate Tab': 'Sekmeyi çoğalt',
      'Essential tabs': 'Temel sekmeler',
      'Even Out the Sound (Night Mode)': 'Sesi dengele (gece modu)',
      'Everything Vex Can Do': 'Vex’in yapabildiği her şey',
      'Exam and registration dates': 'Sınav ve kayıt tarihleri',
      'Exam-Day Pack and Exam Mode': 'Sınav günü paketi ve sınav modu',
      'Exams': 'Sınavlar',
      'Expenses': 'Harcamalar',
      'Explain Selection': 'Seçimi açıkla',
      'Export All Data': 'Tüm verileri dışa aktar',
      'Feeds (RSS)': 'Akışlar (RSS)',
      'Fill This Form': 'Bu formu doldur',
      'Fill code from clipboard': 'Kodu panodan doldur',
      'Fill code from email': 'Kodu e-postadan doldur',
      'Find a Page I Lost': 'Kaybettiğim bir sayfayı bul',
      'Find by time and topic': 'Zamana ve konuya göre bul',
      'Find installed games': 'Yüklü oyunları bul',
      'Find text in all tabs': 'Tüm sekmelerde metin bul',
      'Flag a question (?)': 'Bir soruyu işaretle (?)',
      'Focus 25': 'Odak 25',
      'Focus 50': 'Odak 50',
      'Focus Flows': 'Odak akışları',
      'Focus OS: Finish the Running Block': 'Odak planı: Süren bloğu bitir',
      'Focus OS: Goals and Work Blocks': 'Odak planı: Hedefler ve çalışma blokları',
      'Focus OS: New Goal': 'Odak planı: Yeni hedef',
      'Focus OS: Start the Next Block': 'Odak planı: Sıradaki bloğu başlat',
      'Focus block length': 'Odak bloğu süresi',
      'Follow-ups: I owe, waiting on': 'Takipler: borçlu olduklarım, beklediklerim',
      'Font': 'Yazı tipi',
      'Forget What Vex Learned About My Phrasing': 'Vex’in ifade tarzım hakkında öğrendiklerini unut',
      'Format JSON (this tab)': 'JSON’u biçimlendir (bu sekme)',
      'Free Games This Week': 'Bu haftanın ücretsiz oyunları',
      'Generate a strong password': 'Güçlü bir parola oluştur',
      'Go Through My Cards': 'Kartlarımı gözden geçir',
      'Guide on the second screen': 'Rehber ikinci ekranda',
      'Habits': 'Alışkanlıklar',
      'Hard Reload': 'Zorla yenile',
      'Have I seen this before?': 'Bunu daha önce gördüm mü?',
      'Hidden Elements on This Site': 'Bu sitedeki gizli öğeler',
      'Highlight Selection': 'Seçimi vurgula',
      'Highlight Selection (Green)': 'Seçimi vurgula (yeşil)',
      'Highlight Selection (Pink)': 'Seçimi vurgula (pembe)',
      'Highlight unusual terms': 'Olağandışı koşulları vurgula',
      'Highlights to Notes': 'Vurguları notlara aktar',
      'Hints: click with the keyboard': 'İpuçları: klavyeyle tıkla',
      'Hints: go to a tab': 'İpuçları: bir sekmeye git',
      'History (quick view)': 'Geçmiş (hızlı bakış)',
      'Holidays and bridge days': 'Tatiller ve köprü günleri',
      'How I Got Here': 'Buraya nasıl geldim',
      'I Have Some Minutes to Read': 'Okumak için birkaç dakikam var',
      'I clicked something': 'Bir şeye tıkladım',
      'Images on This Page': 'Bu sayfadaki resimler',
      'Import from Another Browser': 'Başka bir tarayıcıdan içe aktar',
      'Install this extension from the Web Store': 'Bu eklentiyi Web Mağazası’ndan yükle',
      'Is It Me or the Server?': 'Sorun bende mi, sunucuda mı?',
      'Keep This Bookmark Alive': 'Bu yer imini canlı tut',
      'Keep this page as a source': 'Bu sayfayı kaynak olarak sakla',
      'Last month in money (with CSV export)': 'Geçen ay parayla (CSV dışa aktarmalı)',
      'Left-overs from earlier': 'Öncekilerden kalanlar',
      'Linked Scrolling (split screen)': 'Bağlantılı kaydırma (bölünmüş ekran)',
      'Links and panels': 'Bağlantılar ve paneller',
      'Living Bookmarks': 'Canlı yer imleri',
      'Load Session': 'Oturumu yükle',
      'Loadout cards': 'Donanım kartları',
      'Local services': 'Yerel hizmetler',
      'Lock Vex': 'Vex’i kilitle',
      'Log expense from this page': 'Bu sayfadan harcama kaydet',
      'Logins & Codes': 'Girişler ve kodlar',
      'MCP Servers & Tools': 'MCP sunucuları ve araçları',
      'Mail': 'Posta',
      'Make Cards from What I Highlighted': 'Vurguladıklarımdan kart yap',
      'Make a Shortcut Word for a Command…': 'Bir komut için kısayol sözcüğü oluştur…',
      'Manage AI Personas': 'Yapay zekâ kişiliklerini yönet',
      'Mark This Page as Finished Reading': 'Bu sayfayı okundu olarak işaretle',
      'Mark Up This Page': 'Bu sayfayı işaretle',
      'Master Volume': 'Ana ses düzeyi',
      'Media control: what is making sound': 'Medya denetimi: ne ses çıkarıyor',
      'Meeting Mode': 'Toplantı modu',
      'Merge Duplicate Tabs': 'Yinelenen sekmeleri birleştir',
      'Mini Dashboards': 'Mini paneller',
      'Move this throwaway tab to my normal session': 'Bu geçici sekmeyi normal oturumuma taşı',
      'Music Volume…': 'Müzik ses düzeyi…',
      'Mute All Others': 'Diğerlerinin hepsini sustur',
      'Mute Tab': 'Sekmeyi sustur',
      'Mute everything except this tab': 'Bu sekme dışındaki her şeyi sustur',
      'My Clips': 'Kırpıntılarım',
      'My session leaked': 'Oturumum sızdı',
      'New Cornell note': 'Yeni Cornell notu',
      'New Identity Tab': 'Yeni kimlik sekmesi',
      'New Off-the-Record Tab': 'Yeni kayıt dışı sekme',
      'New Persona...': 'Yeni kişilik...',
      'New Personal Container Tab': 'Yeni kişisel kapsayıcı sekmesi',
      'New Shopping Container Tab': 'Yeni alışveriş kapsayıcı sekmesi',
      'New Tor Tab': 'Yeni Tor sekmesi',
      'New Work Container Tab': 'Yeni iş kapsayıcı sekmesi',
      'New for you': 'Sizin için yeni',
      'Newsletter Lane': 'Bülten şeridi',
      'Next Project Space': 'Sonraki proje alanı',
      'Next Track': 'Sonraki parça',
      'Next from Read Later': 'Sonra Oku’dan sıradaki',
      'Note This Moment': 'Bu anı not et',
      'Note This Moment of the Video': 'Videonun bu anını not et',
      'Note a Line in the Meeting': 'Toplantıdan bir satır not et',
      'Notes on This Video': 'Bu videonun notları',
      'Open This Page as an Overlay': 'Bu sayfayı katman olarak aç',
      'Open a List of Links': 'Bir bağlantı listesi aç',
      'Open as App': 'Uygulama olarak aç',
      'Open clipboard link in a container': 'Pano bağlantısını bir kapsayıcıda aç',
      'Open my set for today': 'Bugünkü takımımı aç',
      'Open the Toolbox': 'Araç kutusunu aç',
      'Orders and parcels': 'Siparişler ve kargolar',
      'Organize My Tabs': 'Sekmelerimi düzenle',
      'PDF highlights': 'PDF vurguları',
      'PDF toolkit': 'PDF araç seti',
      'Page Changelog Sites': 'Sayfa değişiklik günlüğü siteleri',
      'Page reminders': 'Sayfa hatırlatıcıları',
      'Paper Brief': 'Makale özeti',
      'Paranoid Mode for This Site (on or off)': 'Bu site için paranoyak mod (açık/kapalı)',
      'Parcels': 'Kargolar',
      'Password Health': 'Parola sağlığı',
      'Past-Paper Session': 'Çıkmış soru oturumu',
      'Paste & Go': 'Yapıştır ve git',
      'Paste as plain text': 'Düz metin olarak yapıştır',
      'Peek Current Page': 'Geçerli sayfaya göz at',
      'Permission hygiene': 'İzin temizliği',
      'Personalize for Your Job': 'Mesleğinize göre kişiselleştir',
      'Pick a Colour From the Screen': 'Ekrandan bir renk seç',
      'Pin Site to Sidebar': 'Siteyi kenar çubuğuna sabitle',
      'Pin/Unpin Tab': 'Sekmeyi sabitle/sabitlemeyi kaldır',
      'Plan the week': 'Haftayı planla',
      'Play Read-Later as Podcast': 'Sonra Oku’yu podcast gibi oynat',
      'Play or Pause the Music': 'Müziği oynat ya da duraklat',
      'Prepare for My Next Meeting': 'Sonraki toplantıma hazırlan',
      'Previous Track': 'Önceki parça',
      'Price History': 'Fiyat geçmişi',
      'Print…': 'Yazdır…',
      'Privacy Report': 'Gizlilik raporu',
      'Private Routing — All of Vex Through Tor or a Proxy': 'Özel yönlendirme — Vex’in tamamı Tor ya da bir vekil sunucu üzerinden',
      'Private Window': 'Gizli pencere',
      'Project Spaces': 'Proje alanları',
      'Pull Requests and Issues Desk': 'Çekme istekleri ve sorunlar masası',
      'Put this off until...': 'Bunu şu zamana ertele...',
      'QR Code for This Page': 'Bu sayfa için QR kodu',
      'Questions to ask': 'Sorulacak sorular',
      'Quick capture': 'Hızlı yakalama',
      'Re-index Open Tabs': 'Açık sekmeleri yeniden dizinle',
      'Read Aloud': 'Sesli oku',
      'Read Free (bypass paywall)': 'Ücretsiz oku (ödeme duvarını aş)',
      'Read Later': 'Sonra oku',
      'Reader-first Sites': 'Önce okuyucu açılan siteler',
      'Reader-first for This Site': 'Bu site için önce okuyucu',
      'Reading Mode': 'Okuma modu',
      'Reading digest (Catch me up)': 'Okuma özeti (Beni güncelle)',
      'Recall — Search What You\'ve Read': 'Geri çağır — okuduklarınızda arayın',
      'Receipts and warranties': 'Fişler ve garantiler',
      'Recent Page Checks': 'Son sayfa denetimleri',
      'Record This Tab': 'Bu sekmeyi kaydet',
      'Record a GIF': 'GIF kaydet',
      'Record an Area': 'Bir alanı kaydet',
      'Record the Screen (Start / Stop)': 'Ekranı kaydet (başlat / durdur)',
      'Remember... (AI History Search)': 'Hatırla... (yapay zekâ geçmiş araması)',
      'Remind me': 'Bana hatırlat',
      'Remind me about this page': 'Bu sayfayı bana hatırlat',
      'Rename this tab': 'Bu sekmeyi yeniden adlandır',
      'Reopen Closed Tab': 'Kapatılan sekmeyi yeniden aç',
      'Reopen closed window': 'Kapatılan pencereyi yeniden aç',
      'Repeat a task': 'Bir görevi yinele',
      'Report a Problem': 'Sorun bildir',
      'Research Projects': 'Araştırma projeleri',
      'Reset Zoom': 'Yakınlaştırmayı sıfırla',
      'Resolve a Roblox id': 'Bir Roblox kimliğini çöz',
      'Resource Monitor': 'Kaynak izleyici',
      'Responsive Preview': 'Duyarlı önizleme',
      'Rituals': 'Ritüeller',
      'Roblox Hub': 'Roblox merkezi',
      'Route Through Tor / Proxy': 'Tor / vekil sunucu üzerinden yönlendir',
      'Run Setup Wizard': 'Kurulum sihirbazını çalıştır',
      'Running Tasks': 'Çalışan görevler',
      'Running dev servers': 'Çalışan geliştirme sunucuları',
      'Save Page As…': 'Sayfayı farklı kaydet…',
      'Save Page as Markdown': 'Sayfayı Markdown olarak kaydet',
      'Save Page as One File': 'Sayfayı tek dosya olarak kaydet',
      'Save Page as PDF': 'Sayfayı PDF olarak kaydet',
      'Save Page as an E-book': 'Sayfayı e-kitap olarak kaydet',
      'Save Session': 'Oturumu kaydet',
      'Save This Chat to Project': 'Bu sohbeti projeye kaydet',
      'Save a PDF highlight': 'Bir PDF vurgusu kaydet',
      'Save a password for this site': 'Bu site için parola kaydet',
      'Save tables as a note': 'Tabloları not olarak kaydet',
      'Save to Wayback Machine': 'Wayback Machine’e kaydet',
      'Say why this tab is open': 'Bu sekmenin neden açık olduğunu yaz',
      'Screenshot': 'Ekran görüntüsü',
      'Screenshot a Region': 'Bir bölgenin ekran görüntüsünü al',
      'Screenshot the Whole Page': 'Sayfanın tamamının ekran görüntüsünü al',
      'Screenshot → Code': 'Ekran görüntüsü → Kod',
      'Search Everything': 'Her şeyde ara',
      'Search Saved Links': 'Kayıtlı bağlantılarda ara',
      'Search open tabs': 'Açık sekmelerde ara',
      'Send to My Devices': 'Cihazlarıma gönder',
      'Send to Phone': 'Telefona gönder',
      'Set environments': 'Ortamları ayarla',
      'Set the Memory Ceiling from This Machine': 'Bellek üst sınırını bu makineye göre ayarla',
      'Setup Gallery': 'Kurulum galerisi',
      'Shape of the day': 'Günün şekli',
      'Share this page in a clean window': 'Bu sayfayı temiz bir pencerede paylaş',
      'Share-safe mode: off for this share': 'Paylaşım güvenli modu: bu paylaşım için kapalı',
      'Shared from my phone': 'Telefonumdan paylaşılanlar',
      'Shortcut Words': 'Kısayol sözcükleri',
      'Shortcuts & Gestures': 'Kısayollar ve hareketler',
      'Show AI Thinking (On / Off)': 'Yapay zekânın düşünmesini göster (açık / kapalı)',
      'Show tickets': 'Biletleri göster',
      'Simple mode': 'Basit mod',
      'Site Rules — Always Open These Sites Through Tor': 'Site kuralları — Bu siteleri her zaman Tor üzerinden aç',
      'Site down or my bypass?': 'Site mi çöktü, yoksa benim aşmam mı?',
      'Skim a repository': 'Bir depoya göz at',
      'Skin': 'Kaplama',
      'Sleep All Inactive': 'Etkin olmayan hepsini uyut',
      'Sleep Tab': 'Sekmeyi uyut',
      'Small Model for Routine Jobs': 'Rutin işler için küçük model',
      'Snippets': 'Metin parçaları',
      'Snooze This Tab Until...': 'Bu sekmeyi şu zamana kadar ertele...',
      'Sort Minecraft mods': 'Minecraft modlarını sırala',
      'Sources and citations': 'Kaynaklar ve alıntılar',
      'Speed Read (RSVP)': 'Hızlı oku (RSVP)',
      'Split into 3 panes': '3 bölmeye ayır',
      'Split into 4 panes': '4 bölmeye ayır',
      'Split view: 25 / 75': 'Bölünmüş görünüm: 25 / 75',
      'Split view: 50 / 50': 'Bölünmüş görünüm: 50 / 50',
      'Split view: 75 / 25': 'Bölünmüş görünüm: 75 / 25',
      'Split view: next pane': 'Bölünmüş görünüm: sonraki bölme',
      'Split view: swap panes': 'Bölünmüş görünüm: bölmeleri değiştir',
      'Sticky Note for This Page': 'Bu sayfa için yapışkan not',
      'Stop Marking What’s New Here': 'Burada yenileri işaretlemeyi bırak',
      'Study Block': 'Çalışma bloğu',
      'Summarize All Tabs': 'Tüm sekmeleri özetle',
      'Summarize Page': 'Sayfayı özetle',
      'Switch AI Persona (this tab)': 'Yapay zekâ kişiliğini değiştir (bu sekme)',
      'Switch Workspace': 'Çalışma alanını değiştir',
      'Switch environment': 'Ortamı değiştir',
      'Switch to a Page I Already Have Open': 'Zaten açık olan bir sayfaya geç',
      'TL equivalent of the selection': 'Seçimin TL karşılığı',
      'Tab Health': 'Sekme sağlığı',
      'Take a Tour': 'Tura çık',
      'Task Board': 'Görev panosu',
      'Teach Vex This Task': 'Vex’e bu görevi öğret',
      'Tell me when this GitHub run finishes': 'Bu GitHub çalışması bitince haber ver',
      'Tidy Stale Tabs Now': 'Eskiyen sekmeleri şimdi topla',
      'Tidy workspaces': 'Çalışma alanlarını topla',
      'Time travel: whole browser': 'Zaman yolculuğu: tüm tarayıcı',
      'Timeline': 'Zaman çizelgesi',
      'Timeline by Week': 'Haftalık zaman çizelgesi',
      'To-do List': 'Yapılacaklar listesi',
      'Toggle Fullscreen': 'Tam ekranı aç/kapat',
      'Toggle Tabs Sidebar': 'Sekme kenar çubuğunu aç/kapat',
      'Tools': 'Araçlar',
      'Track Stock Status': 'Stok durumunu izle',
      'Track This Price': 'Bu fiyatı izle',
      'Tracker Receipts': 'İzleyici makbuzları',
      'Translate Page': 'Sayfayı çevir',
      'Translate Selection': 'Seçimi çevir',
      'Translate Side by Side': 'Yan yana çevir',
      'Tree Tabs (nest tabs under the one they came from)': 'Ağaç sekmeler (sekmeleri geldikleri sekmenin altına yerleştir)',
      'Triage my read-later queue': 'Sonra oku kuyruğumu ayıkla',
      'Trip workspace': 'Gezi çalışma alanı',
      'Tuning advisor: what slows Vex down': 'Ayar danışmanı: Vex’i ne yavaşlatıyor',
      'Two-minute drawer': 'İki dakikalık çekmece',
      'Undo Last Grouping': 'Son gruplamayı geri al',
      'Undo mod sort': 'Mod sıralamasını geri al',
      'Unfinished Forms': 'Bitmemiş formlar',
      'Unlock Copy & Right-Click': 'Kopyalama ve sağ tıklamanın kilidini aç',
      'Vault hygiene': 'Kasa temizliği',
      'Video Transcript, Chapters and Loop': 'Video dökümü, bölümler ve döngü',
      'Video speed': 'Video hızı',
      'View Archived Version': 'Arşivlenmiş sürümü görüntüle',
      'View Page Source': 'Sayfa kaynağını görüntüle',
      'Wake All Tabs': 'Tüm sekmeleri uyandır',
      'Watch conditions': 'İzleme koşulları',
      'Web Safety: Lookalikes, Downloads, Prompts': 'Web güvenliği: benzer siteler, indirmeler, istemler',
      'Webhook inspector': 'Webhook denetçisi',
      'Weekly review': 'Haftalık gözden geçirme',
      'Weekly triage': 'Haftalık ayıklama',
      'What Do I Usually Do Next': 'Genelde sonra ne yaparım',
      'What I changed': 'Ne değiştirdim',
      'What My Inbox Actually Wants': 'Gelen kutum aslında ne istiyor',
      'What This Site Is Allowed': 'Bu siteye neler izinli',
      'What You Can Press — Shortcut Sheet': 'Hangi tuşlara basabilirsiniz — kısayol sayfası',
      'What am I signed in to': 'Nerelerde oturum açtım',
      'What changed since I last looked': 'En son baktığımdan beri ne değişti',
      'What is slowing my browser?': 'Tarayıcımı ne yavaşlatıyor?',
      'What’s New Since I Was Last Here': 'En son geldiğimden beri neler yeni',
      'Which AI answered?': 'Hangi yapay zekâ yanıtladı?',
      'Whiteboard': 'Beyaz tahta',
      'Who Is Live': 'Kimler canlı yayında',
      'Why Did That Happen?': 'Bu neden oldu?',
      'Why Is This Page Slow?': 'Bu sayfa neden yavaş?',
      'Why Is Vex Slow Right Now?': 'Vex şu anda neden yavaş?',
      'Why was I signed out?': 'Oturumum neden kapandı?',
      'Workspace Time-Travel': 'Çalışma alanı zaman yolculuğu',
      'Write in Two Languages': 'İki dilde yaz',
      'Write my morning brief': 'Sabah özetimi yaz',
      'Your data': 'Verileriniz',
      'Zap Element': 'Öğeyi yok et',
      'Zoom In': 'Yakınlaştır',
      'Zoom Out': 'Uzaklaştır',
      'AI spend cap': 'Yapay zekâ harcama sınırı',
      'Appointment slot watcher': 'Randevu saati izleyicisi',
      'Archive on cite': 'Alıntılayınca arşivle',
      'Ask before distracting sites': 'Dikkat dağıtan sitelerden önce sor',
      'Breaks': 'Molalar',
      'Community and chat tools': 'Topluluk ve sohbet araçları',
      'Containers per site': 'Site başına kapsayıcılar',
      'Developer bench': 'Geliştirici tezgâhı',
      'Diagnostics': 'Tanılama',
      'Download desk': 'İndirme masası',
      'Draft into the field': 'Taslağı alana yaz',
      'Exam-day pack': 'Sınav günü paketi',
      'Extension changes and pause': 'Eklenti değişiklikleri ve duraklatma',
      'Follow-ups': 'Takipler',
      'Form assistant': 'Form yardımcısı',
      'Game Control Center link': 'Game Control Center bağlantısı',
      'Game audio scenes': 'Oyun ses sahneleri',
      'Guest session': 'Misafir oturumu',
      'Guide on a second screen': 'İkinci ekranda rehber',
      'Holidays': 'Tatiller',
      'Idle workspaces': 'Boştaki çalışma alanları',
      'If something went wrong': 'Bir şey ters giderse',
      'Links and windows': 'Bağlantılar ve pencereler',
      'Media control': 'Medya denetimi',
      'Model UN dossier': 'Model BM dosyası',
      'More developer tools': 'Daha fazla geliştirici aracı',
      'More tab tools': 'Daha fazla sekme aracı',
      'Mouse gesture editor': 'Fare hareketi düzenleyicisi',
      'Orders': 'Siparişler',
      'Paper brief': 'Makale özeti',
      'Password page check': 'Parola sayfası denetimi',
      'Past papers': 'Çıkmış sorular',
      'Paste-and-run tripwire': 'Yapıştır-ve-çalıştır tuzağı',
      'Photo preparer': 'Fotoğraf hazırlayıcı',
      'Put things off (when box)': 'Ertele (ne zaman kutusu)',
      'Reading and watching with AI': 'Yapay zekâyla okuma ve izleme',
      'Refresh after a build': 'Derlemeden sonra yenile',
      'Safer browsing helpers': 'Daha güvenli gezinti yardımcıları',
      'Search by meaning (embedding model)': 'Anlama göre ara (gömme modeli)',
      'Search by what you want': 'İstediğinize göre ara',
      'Search index': 'Arama dizini',
      'Secure lock options': 'Güvenli kilit seçenekleri',
      'Site instructions': 'Site yönergeleri',
      'Startup check': 'Başlangıç denetimi',
      'Storage': 'Depolama',
      'Storage and sync scope': 'Depolama ve eşitleme kapsamı',
      'Study notes': 'Çalışma notları',
      'Summary cache': 'Özet önbelleği',
      'TL equivalent': 'TL karşılığı',
      'Tab comforts': 'Sekme kolaylıkları',
      'Tabs and navigation': 'Sekmeler ve gezinme',
      'Terms of service highlighter': 'Hizmet koşulları vurgulayıcı',
      'Text snippets': 'Metin parçaları',
      'Thread digest': 'Konu özeti',
      'Travel mode': 'Seyahat modu',
      'Turkish and English': 'Türkçe ve İngilizce',
      'Unfinished forms': 'Bitmemiş formlar',
      'Usage counts and suggestions': 'Kullanım sayıları ve öneriler',
      'Version review': 'Sürüm incelemesi',
      'Watch suggestions': 'İzleme önerileri',
      'Watcher alerts': 'İzleyici uyarıları',
      'Weekday first-open tabs': 'Hafta içi ilk açılan sekmeler',
      'What each feature touches': 'Her özellik nelere dokunuyor',
      'What changed since you looked': 'Baktığınızdan beri ne değişti',
      'Where AI runs': 'Yapay zekâ nerede çalışır',
      'Why is this tab open': 'Bu sekme neden açık',
      'Study block': 'Çalışma bloğu',
      'Expense capture': 'Harcama yakalama',
      'Deadlines': 'Son tarihler',
      'Archive This Tab and Close It': 'Bu sekmeyi arşivle ve kapat',
      'Export Saved Words for FlashMind': 'Kayıtlı sözcükleri FlashMind için dışa aktar',
      'Held while you played': 'Siz oynarken bekletilenler',
      'Mistake Journal': 'Hata günlüğü',
      'Pin a Saved Task to Ctrl+K': 'Kayıtlı bir görevi Ctrl+K’ye sabitle',
      'Quiz Me From This Page': 'Bu sayfadan beni sına',
      'Related From My Library (Panel)': 'Kitaplığımdan ilgili olanlar (panel)',
      'Save Selected Word With Its Sentence': 'Seçili sözcüğü cümlesiyle kaydet',
      'Simple, Standard or Power': 'Basit, Standart ya da Güçlü',
      'Teach-Back Questions From This Page': 'Bu sayfadan geri öğretme soruları',
      'Unpin a Task From Ctrl+K': 'Bir görevin Ctrl+K sabitlemesini kaldır',
      'Why is Discord big?': 'Discord neden büyük?',
      'Bypass check': 'Aşma denetimi',
      'Hidden until needed': 'Gerekene kadar gizli',
      'Holidays and phrases from packs': 'Paketlerden tatiller ve kalıplar',
      'Library links': 'Kitaplık bağlantıları',
      'Pinned agent tasks': 'Sabitlenmiş aracı görevleri',
      'Safer web': 'Daha güvenli web',
      'Study entry points': 'Çalışma giriş noktaları',
      'Watch templates': 'İzleme şablonları',
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
