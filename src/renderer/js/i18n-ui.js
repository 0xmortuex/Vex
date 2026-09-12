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

      // --- panels ---
      'Settings': 'Ayarlar', 'History': 'Geçmiş', 'Downloads': 'İndirilenler',
      'Bookmarks': 'Yer imleri', 'Notes': 'Notlar', 'Memory': 'Bellek',
      'Library': 'Kitaplık', 'Feeds': 'Akışlar', 'Highlights': 'Vurgular',
      'Recall': 'Geri çağırma', 'Schedules': 'Zamanlanmış görevler',
      'Authenticator': 'Kimlik doğrulayıcı', 'Privacy': 'Gizlilik',
      'Shortcuts': 'Kısayollar', 'Queue': 'Kuyruk', 'Work': 'Çalışma',
      'Start Page': 'Başlangıç sayfası', 'Toolbox': 'Araç kutusu',

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

      // --- settings controls people actually change ---
      'Default search engine': 'Varsayılan arama motoru',
      'Auto-sleep inactive tabs': 'Etkin olmayan sekmeleri uyut',
      'Sleep after (minutes)': 'Şu kadar dakika sonra uyut',
      'Memory Saver': 'Bellek tasarrufu',
      'Block ads and trackers': 'Reklamları ve izleyicileri engelle',
      'Tab Layout': 'Sekme düzeni', 'GUI Style': 'Arayüz stili',
      'Horizontal (top bar, like Chrome)': 'Yatay (üst çubuk, Chrome gibi)',
      'Vertical (left sidebar)': 'Dikey (sol kenar çubuğu)',

      // --- states you see constantly ---
      'Loading...': 'Yükleniyor…', 'Loading…': 'Yükleniyor…',
      'No results': 'Sonuç yok', 'Nothing here yet': 'Burada henüz bir şey yok',
      'Today': 'Bugün', 'Yesterday': 'Dün',
      'Discover Vex': 'Vex’i keşfedin',
      'Search every feature…': 'Tüm özelliklerde arayın…',
      'New to you': 'Sizin için yeni',
      'Show me': 'Bana göster', 'Turn on & show me': 'Aç ve bana göster',
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
    return null;
  },

  // Translate one element's attributes and, when it holds nothing but text,
  // its text. Elements with children are left to their children, so markup is
  // never rebuilt and no event listener is disturbed.
  translateEl(el, lang) {
    let changed = false;
    for (const attr of this.ATTRS) {
      const value = el.getAttribute && el.getAttribute(attr);
      if (!value) continue;
      const hit = this.lookup(value, lang);
      if (hit) {
        // Keep the English around so switching back is exact, and so the same
        // element is never translated twice.
        if (!el.dataset['i18n' + attr.replace(/-/g, '')]) el.dataset['i18n' + attr.replace(/-/g, '')] = value;
        el.setAttribute(attr, hit);
        changed = true;
      }
    }
    const onlyText = el.children.length === 0;
    if (onlyText && el.textContent) {
      const hit = this.lookup(el.textContent, lang);
      if (hit) {
        if (!el.dataset.i18nText) el.dataset.i18nText = el.textContent.trim();
        el.textContent = hit;
        changed = true;
      }
    }
    return changed;
  },

  // Put everything back to the English it was drawn with.
  revert(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n-text]').forEach((el) => { el.textContent = el.dataset.i18nText; });
    for (const attr of this.ATTRS) {
      const key = 'i18n' + attr.replace(/-/g, '');
      scope.querySelectorAll('[data-' + key.replace(/([A-Z])/g, '-$1').toLowerCase() + ']').forEach((el) => {
        el.setAttribute(attr, el.dataset[key]);
      });
    }
  },

  // Translate the chrome. Safe to call as often as you like: an element that
  // has already been translated carries its English original and is skipped.
  apply(root) {
    const lang = this.locale();
    if (lang === 'en') { this.revert(root); return 0; }
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
