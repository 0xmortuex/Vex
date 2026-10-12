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
    '#top-bar', '#icon-sidebar', '#tabs-sidebar', '#nav-buttons',
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
      'Location': 'Konum', 'Sync': 'Eşitleme', 'Passwords': 'Parolalar',
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
      'Automatic': 'Otomatik', 'One column': 'Tek sütun', 'Two columns': 'İki sütun', 'Three columns': 'Üç sütun',
      'Chips across the top': 'Üstte, yan yana düğmeler', 'A list down the left side': 'Solda bir liste',
      'Comfortable': 'Rahat', 'Compact': 'Sıkışık',
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
