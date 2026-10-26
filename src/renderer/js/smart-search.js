// === Smarter search, in English and in Turkish ===================================
//
// One place that decides how well a query fits a thing with a name, a description and a few other words, used by Ctrl+K (js/command.js) and by
// the Settings search (js/settings-ui.js). What it adds to a plain "does the text contain it":
//
//   * every word of the query must be found, in any order ("privacy fingerprint", "fingerprint privacy");
//   * a word matches as a whole, as the start of a word, inside a word, as a plural or an ending away from a word ("updates" finds "update"), or with one
//     slip of the keys ("setings" finds "settings");
//   * both languages at once. A thing is searched under its English text AND its Turkish text (the interface translation table, js/i18n-ui.js,
//     read both ways), so a Turkish word finds an English-named command and an English word finds a section drawn in Turkish: a Turkish person can
//     type either and get the same results;
//   * a word is also searched under its synonyms in both languages ("update" ~ "upgrade" ~ "güncelleme", "privacy" ~ "gizlilik"), and a Turkish
//     word under its stems (js/turkish-lemma.js): "güncellemeleri" finds "güncelleme";
//   * where it was found counts: the name above the keywords, the keywords above the other labels, those above the long text.
//
// Everything here is plain string work with no state but caches, so it is the same in the window and in a test.
const VexSmartSearch = {
  // Words that carry no meaning in a query of several words. A query that is only these is searched as typed.
  STOP: new Set(['a', 'an', 'the', 'to', 'of', 'for', 'in', 'on', 'and', 'or', 'my', 'is', 'it', 'how', 'do', 'i', 'me', 'bir', 've', 'ile', 'icin', 'bu', 'su', 'mi', 'mu', 'ne', 'nasil']),

  // Words that mean the same, in English and in Turkish. A line is a set: any of them stands for all of them. Turkish is written with its own
  // letters here and folded when read, so the lines stay readable.
  SETS: [
    'update upgrade updates updating newer güncelle güncelleme güncellemeler yükselt yenile',
    'version release sürüm',
    'privacy private gizlilik gizli mahremiyet',
    'security secure safety safe güvenlik güvenli',
    'dark night black karanlık koyu gece',
    'light bright açık aydınlık',
    'theme look appearance skin style tema görünüm',
    'download downloads indir indirme indirilenler',
    'history geçmiş',
    'bookmark bookmarks favorite favourite favorites favori yerimi imi imleri',
    'tab tabs sekme sekmeler',
    'window pencere',
    'password passwords parola şifre',
    'search find lookup ara arama bul',
    'setting settings preference preferences option options ayar ayarlar tercih tercihler seçenek',
    'sound audio volume ses',
    'notification notifications alert alerts bildirim bildirimler uyarı',
    'language dil',
    'translate translation çevir çeviri',
    'extension extensions addon addons plugin plugins eklenti eklentiler',
    'print printing yazdır yazdırma yazıcı',
    'screenshot capture snapshot ekran görüntüsü',
    'clear delete remove erase sil temizle kaldır',
    'reset restore default sıfırla varsayılan',
    'backup export yedek yedekle',
    'sync synchronize synchronise eşitle eşitleme senkron',
    'cookie cookies çerez çerezler',
    'camera kamera',
    'microphone mic mikrofon',
    'location gps konum',
    'memory ram bellek',
    'battery power pil güç',
    'speed performance fast hız performans hızlı',
    'font typeface yazı tipi',
    'zoom magnify yakınlaştır büyüt',
    'size boyut',
    'start home homepage başlangıç anasayfa',
    'new yeni',
    'open aç',
    'close kapat',
    'save kaydet',
    'copy kopyala',
    'share paylaş',
    'ad ads advert advertisement blocker adblock reklam reklamlar engelleyici',
    'game gaming oyun',
    'music müzik',
    'account hesap',
    'profile profiles profil',
    'shortcut shortcuts hotkey hotkeys kısayol kısayollar',
    'keyboard klavye',
    'reading read reader oku okuma okuyucu',
    'note notes not notlar',
    'reminder reminders hatırlatıcı hatırlatma',
    'timer countdown zamanlayıcı',
    'about hakkında',
    'help support yardım destek',
    'tour walkthrough tur',
    'problem issue error bug sorun hata',
    'slow yavaş',
    'login signin sign-in giriş oturum',
    'logout signout sign-out çıkış',
    'color colour renk',
    'wallpaper background arka plan duvar kağıdı',
    'mouse fare',
    'pdf belge',
    'video film',
    'picture image photo resim görsel fotoğraf',
    'incognito gizlipencere',
    'proxy vekil',
    'block engelle',
    'allow permission permissions izin izinler',
    'pin sabitle',
    'mute sessiz sustur',
    'share paylaş',
    'ai yapay zeka',
    'weather hava',
    'time clock saat',
    'date tarih',
    'calendar takvim',
    'mail email e-mail eposta posta',
    'file files dosya dosyalar',
    'folder klasör',
    'tracker trackers tracking izleyici izleme',
    'fingerprint parmakizi',
    'encrypt encryption şifreleme',
    'lock kilit',
    'restart relaunch yeniden başlat',
    'sleep suspend uyku',
    'automatic auto otomatik',
  ],

  _group: null,
  // token (folded) -> Set of the other tokens of its sets
  _synonyms() {
    if (this._group) return this._group;
    const map = new Map();
    for (const line of this.SETS) {
      const words = line.split(/\s+/).map(w => this.fold(w)).filter(Boolean);
      for (const w of words) {
        if (!map.has(w)) map.set(w, new Set());
        for (const o of words) if (o !== w) map.get(w).add(o);
      }
    }
    this._group = map;
    return map;
  },

  fold(s) {
    const t = typeof VexTr !== 'undefined' ? VexTr : (typeof require === 'function' ? require('./vex-tr.js').VexTr : null);
    return t ? t.fold(String(s == null ? '' : s)) : String(s == null ? '' : s).toLowerCase();
  },
  // The words of a text, folded. Digits stay, so "ipv6" and "7z" are words.
  words(s) { return this.fold(s).split(/[^a-z0-9]+/).filter(Boolean); },

  // ---- the two languages -----------------------------------------------------------------
  _table() {
    try {
      if (typeof VexI18nUI !== 'undefined' && VexI18nUI && VexI18nUI.TABLE && VexI18nUI.TABLE.tr) return VexI18nUI.TABLE.tr;
    } catch (err) { console.warn('[SmartSearch] the translation table could not be read:', err && err.message); }
    return null;
  },
  _rev: null,
  _revFrom: null,
  // Folded Turkish phrase -> its English original.
  _reverse(table) {
    if (this._rev && this._revFrom === table) return this._rev;
    const map = new Map();
    for (const en of Object.keys(table)) {
      const tr = table[en];
      if (typeof tr !== 'string' || tr.length > 90) continue;
      const k = this.fold(tr);
      if (k && !map.has(k)) map.set(k, en);
    }
    this._rev = map; this._revFrom = table;
    return map;
  },
  // The other language's text for a phrase that is in the table, whichever language it is in: '' when the table does not know it.
  otherLanguage(text) {
    const table = this._table();
    const s = String(text == null ? '' : text).trim();
    if (!table || !s || s.length > 90) return '';
    if (Object.prototype.hasOwnProperty.call(table, s)) return table[s];
    return this._reverse(table).get(this.fold(s)) || '';
  },
  // A text and its other-language twin, as words.
  bilingualWords(text) {
    const out = this.words(text);
    const twin = this.otherLanguage(text);
    if (twin) for (const w of this.words(twin)) out.push(w);
    return out;
  },

  // ---- the query ---------------------------------------------------------------------------
  // The forms one folded word may be found as: itself, its synonyms, and for a Turkish word its stems and their synonyms.
  variants(token) {
    const out = new Set([token]);
    const syn = this._synonyms();
    const add = (t) => { out.add(t); const s = syn.get(t); if (s) for (const x of s) out.add(x); };
    add(token);
    // A plural or an ending in English.
    for (const stem of this._englishStems(token)) add(stem);
    // Endings in Turkish.
    if (typeof VexTrLemma !== 'undefined' && VexTrLemma && typeof VexTrLemma.candidates === 'function' && token.length >= 4) {
      try { for (const c of VexTrLemma.candidates(token).slice(0, 8)) { const f = this.fold(c); if (f.length >= 3) add(f); } }
      catch (err) { console.warn('[SmartSearch] a Turkish stem could not be made for "' + token + '":', err && err.message); }
    }
    return out;
  },
  _englishStems(w) {
    const out = [];
    if (w.length < 4) return out;
    if (w.endsWith('ies') && w.length > 4) out.push(w.slice(0, -3) + 'y');
    if (w.endsWith('es')) out.push(w.slice(0, -2));
    if (w.endsWith('s') && !w.endsWith('ss')) out.push(w.slice(0, -1));
    if (w.endsWith('ing') && w.length > 5) { out.push(w.slice(0, -3)); out.push(w.slice(0, -3) + 'e'); }
    if (w.endsWith('ed') && w.length > 4) { out.push(w.slice(0, -2)); out.push(w.slice(0, -1)); }
    return out;
  },
  // { tokens: [{ raw, variants: [..] }] } or null when there is nothing to search for. The last query is remembered: the command bar scores every
  // command for each key, and the query is the same for all of them.
  _lastQuery: null,
  _lastParsed: null,
  parse(query) {
    if (query === this._lastQuery) return this._lastParsed;
    const parsed = this._parse(query);
    this._lastQuery = query; this._lastParsed = parsed;
    return parsed;
  },
  _parse(query) {
    let words = this.words(query);
    if (!words.length) return null;
    const kept = words.filter(w => !this.STOP.has(w));
    if (kept.length) words = kept;
    return { query: this.fold(query).trim(), tokens: words.map(raw => ({ raw, variants: Array.from(this.variants(raw)) })) };
  },

  // ---- matching ----------------------------------------------------------------------------
  // One slip of the keys: a letter missing, added, wrong, or two next to each other swapped.
  _oneSlip(a, b) {
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0;
    while (i < la && i < lb && a[i] === b[i]) i++;
    if (i === la && i === lb) return true;
    if (la === lb) {
      if (a.slice(i + 1) === b.slice(i + 1)) return true;                                   // one wrong letter
      return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);   // two swapped
    }
    return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);         // one extra / one missing
  },
  // How well one form of a query word fits one word of a text: 0..1.
  fit(v, w) {
    if (v === w) return 1;
    const lv = v.length, lw = w.length;
    if (lv >= 2 && w.startsWith(v)) return lv >= 3 || lw <= 3 ? 0.85 : 0.6;
    // "updates" for "update": the query is the word with an ending.
    if (lw >= 4 && v.startsWith(w) && lv - lw <= 3) return 0.75;
    if (lv >= 4 && w.includes(v)) return 0.5;
    if (lv >= 5 && lw >= 4 && this._oneSlip(v, w)) return 0.45;
    return 0;
  },
  // fields: [{ words: [folded words], weight: 0..1 }]. 0 when a word of the query is found nowhere, else 1..100.
  scoreFields(parsed, fields) {
    if (!parsed || !parsed.tokens.length) return 0;
    let total = 0;
    let inFirst = 0;
    for (const token of parsed.tokens) {
      let best = 0;
      let bestField = -1;
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        if (!f.weight) continue;
        for (const w of f.words) {
          for (let j = 0; j < token.variants.length; j++) {
            const v = token.variants[j];
            // A synonym is a little less than the word itself.
            const q = this.fit(v, w) * (j === 0 ? 1 : 0.9) * f.weight;
            if (q > best) { best = q; bestField = i; }
          }
        }
      }
      if (best === 0) return 0;
      if (bestField === 0) inFirst++;
      total += best;
    }
    let score = (total / parsed.tokens.length) * 100;
    if (inFirst === parsed.tokens.length) score += 8;   // everything was found in the name
    return Math.max(1, Math.min(100, Math.round(score)));
  },

  _wordCache: new Map(),
  // The words of a text in both languages, remembered (a command is scored on every key).
  cachedWords(text) {
    const key = String(text == null ? '' : text);
    let w = this._wordCache.get(key);
    if (!w) {
      w = this.bilingualWords(key);
      if (this._wordCache.size > 30000) this._wordCache.clear();
      this._wordCache.set(key, w);
    }
    return w;
  },
  // A thing with a name, a description and extra words: the fields in the order of importance.
  fieldsOf({ name, keywords, hint }) {
    return [
      { words: this.cachedWords(name), weight: 1 },
      { words: keywords ? this.cachedWords(keywords) : [], weight: 0.85 },
      { words: hint ? this.cachedWords(hint) : [], weight: 0.45 },
    ];
  },
  // Score a thing for a query string; 0 for no match.
  score(query, thing) {
    const parsed = this.parse(query);
    return parsed ? this.scoreFields(parsed, this.fieldsOf(thing)) : 0;
  },
};

if (typeof window !== 'undefined') window.VexSmartSearch = VexSmartSearch;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSmartSearch };
