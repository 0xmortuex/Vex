// === Settings as one category at a time ======================================
//
// The owner (2026-11-01): "I thought you merged settings, it is still very bad". Settings was one long scroll of some
// 250 small cards, each with a title and often one switch. Now:
//
//   * the list on the left chooses a category, and the right side shows ONLY that category (General is the first);
//   * the sections of a category are gathered into a few CARDS (3 to 6) with a title each: a section stays the element
//     it always was (same id, same controls, same listeners), it is only shown as a sub-section of its card;
//   * a section that holds one switch or one button is a plain row of its card, not a card of its own;
//   * a search is a list of settings in the main pane (js/settings-find.js), not a filter of cards.
//
// Nothing is removed or moved to another parent: this file sets attributes and classes, and css/settings-pane.css draws
// them. A section a module registers later (js/vex-settings-groups.js) is a section like the others, so it lands in the
// card its heading belongs to. Developer mode still decides which sections show (css/simple-mode.css).
const SettingsPane = {
  DEFAULT: 'General',

  // The cards of each category, in order: [title, { cats: old category names, heads: starts of English headings }].
  // A heading rule beats a category rule; a section that fits no card goes in the first card of its category.
  CARDS: {
    'General': [
      ['Basics', { cats: ['General', 'Location', 'Profiles'], heads: ['default browser'] }],
      ['Start page and daily helpers', { cats: ['Personalization'] }],
      ['Workspaces', { cats: ['Workspaces'] }],
      ['Viewers and players', { cats: ['Browser'] }],
    ],
    'Appearance': [
      ['Look and theme', { cats: ['Appearance'], heads: ['appearance', 'gui style', 'tab layout', 'vex packs', 'your name on this look', 'theme'] }],
      ['Wallpapers and start page', { heads: ['wallpapers', 'new tab layout'] }],
      ['Effects and sounds', { heads: ['mouse cursor', 'click effect', 'sounds'] }],
      ['Reading', { cats: ['Reading'] }],
    ],
    'Privacy and security': [
      ['Tracking and protection', { cats: ['Privacy'], heads: ['privacy', 'safer', 'web safety', 'paste-and-run', 'startup check'] }],
      ['Site permissions', { cats: ['Permissions'], heads: ['site settings', 'site permissions', 'permission hygiene'] }],
      ['Locks and routing', { heads: ['route all of vex', 'private routing', 'encrypted profile lock', 'secure lock', 'containers per site'] }],
      ['When something goes wrong', { heads: ['if something went wrong', 'signed in to', 'what am i signed', 'sign-in: ', 'meeting transcript', 'terms of service', 'unblock centre'] }],
    ],
    'Passwords and sign-in': [
      ['Passwords', { cats: ['Passwords'] }],
      ['Passkeys', { cats: ['Passkeys'] }],
      ['Autofill and cards', { cats: ['Autofill'] }],
    ],
    'Sync and backup': [
      ['Sync', { cats: ['Sync'] }],
      ['Cloud services', { cats: ['Cloud'] }],
      ['Your data', { cats: ['Data'] }],
    ],
    'Downloads and files': [
      ['Downloads', { cats: ['Downloads'] }],
      ['Library', { cats: ['Library'] }],
    ],
    'Tabs and performance': [
      ['Startup and sessions', { cats: ['Sessions'] }],
      ['Speed and memory', { cats: ['Performance'] }],
      ['Tabs', { cats: ['Tab Groups'] }],
      ['History and recall', { cats: ['History', 'Recall'] }],
    ],
    'Sidebar and toolbar': [
      ['Sidebar', { cats: ['Sidebar'] }],
      ['Toolbar and layout', { cats: ['Layout'] }],
      ['Keyboard shortcuts', { cats: ['Shortcuts'] }],
    ],
    'AI': [
      ['AI assistant', { cats: ['AI'] }],
      ['Personas and memory', { cats: ['Personas', 'AI Memory'] }],
      ['On-device, MCP and skills', { cats: ['On-Device', 'MCP', 'Skills'] }],
      ['AI history', { cats: ['AI History'] }],
    ],
    'Focus and study': [
      ['Focus', { cats: ['Focus OS', 'Focus'] }],
      ['Study and research', { cats: ['Knowledge'] }],
    ],
    'Extras and fun': [
      ['Extensions and boosts', { cats: ['Extensions', 'Boosts'] }],
      ['Browsing extras', { cats: ['Extras', 'Chains'] }],
      ['Play', { cats: ['Play'] }],
    ],
    'Developer': [
      ['Developer', { cats: ['Developer'] }],
      ['Vex health', { cats: ['Vex health'] }],
    ],
    'About and updates': [
      ['About Vex', { cats: ['About'] }],
    ],
  },

  // Turkish for what this file and js/settings-find.js write (the English text is the key, as in js/i18n-ui.js).
  TR: {
    'Basics': 'Temel ayarlar',
    'Start page and daily helpers': 'Başlangıç sayfası ve günlük yardımcılar',
    'Workspaces': 'Çalışma alanları',
    'Viewers and players': 'Görüntüleyiciler ve oynatıcılar',
    'Look and theme': 'Görünüm ve tema',
    'Wallpapers and start page': 'Duvar kâğıtları ve başlangıç sayfası',
    'Effects and sounds': 'Efektler ve sesler',
    'Reading': 'Okuma',
    'Tracking and protection': 'İzleme ve koruma',
    'Site permissions': 'Site izinleri',
    'Locks and routing': 'Kilitler ve yönlendirme',
    'When something goes wrong': 'Bir şey ters giderse',
    'Passwords': 'Parolalar',
    'Passkeys': 'Geçiş anahtarları',
    'Autofill and cards': 'Otomatik doldurma ve kartlar',
    'Sync': 'Eşitleme',
    'Cloud services': 'Bulut hizmetleri',
    'Your data': 'Verileriniz',
    'Downloads': 'İndirmeler',
    'Library': 'Kitaplık',
    'Startup and sessions': 'Açılış ve oturumlar',
    'Speed and memory': 'Hız ve bellek',
    'Tabs': 'Sekmeler',
    'History and recall': 'Geçmiş ve anımsama',
    'Sidebar': 'Kenar çubuğu',
    'Toolbar and layout': 'Araç çubuğu ve düzen',
    'Keyboard shortcuts': 'Klavye kısayolları',
    'AI assistant': 'Yapay zekâ asistanı',
    'Personas and memory': 'Kişilikler ve bellek',
    'On-device, MCP and skills': 'Cihaz üstü, MCP ve beceriler',
    'AI history': 'Yapay zekâ geçmişi',
    'Focus': 'Odak',
    'Study and research': 'Çalışma ve araştırma',
    'Extensions and boosts': 'Eklentiler ve güçlendirmeler',
    'Browsing extras': 'Gezinme ekstraları',
    'Play': 'Oyun',
    'Developer': 'Geliştirici',
    'Vex health': 'Vex sağlığı',
    'About Vex': 'Vex hakkında',
    'Open': 'Aç',
    'Show more': 'Daha fazla göster',
    'Developer mode': 'Geliştirici modu',
    'No settings match': 'Hiçbir ayar uymuyor:',
    'Try Ctrl+K for commands and features.': 'Komutlar ve özellikler için Ctrl+K’yı deneyin.',
    'Search results': 'Arama sonuçları',
    '1 result': '1 sonuç',
    'results': 'sonuç',
    'Clear search': 'Aramayı temizle',
    'More options': 'Daha fazla seçenek',
    'Show all': 'Tümünü göster',
  },

  // ---- which card a section belongs to --------------------------------------------------------
  _english(g) {
    const el = g.querySelector('.setting-label');
    if (!el) return '';
    return String(typeof VexI18nUI !== 'undefined' && VexI18nUI.english ? VexI18nUI.english(el) : el.textContent).trim().toLowerCase();
  },
  // { top, title, index } for a section.
  cardOf(g, cat, top) {
    const list = this.CARDS[top] || [];
    const head = this._english(g);
    let hit = list.findIndex(([, r]) => (r.heads || []).some(p => head.startsWith(p)));
    if (hit < 0) hit = list.findIndex(([, r]) => (r.cats || []).includes(cat.name));
    if (hit < 0) hit = 0;
    return { top, title: list[hit] ? list[hit][0] : top, index: hit };
  },
  // Sort key inside a category: the card, so the sections of a card sit together.
  cardRank(g, cat, top) { return this.cardOf(g, cat, top).index; },

  _t(text) {
    if (typeof VexI18nUI === 'undefined' || VexI18nUI.locale() !== 'tr') return text;
    return this.TR[text] || text;
  },

  // Add the Turkish above to the interface table once, so the search and the breadcrumbs read both languages.
  registerTr() {
    if (typeof VexI18nUI === 'undefined' || !VexI18nUI.TABLE || !VexI18nUI.TABLE.tr) return 0;
    let n = 0;
    for (const [en, tr] of Object.entries(this.TR)) {
      if (en === 'results') continue;
      if (!(en in VexI18nUI.TABLE.tr)) { VexI18nUI.TABLE.tr[en] = tr; n++; }
    }
    return n;
  },

  // ---- the page --------------------------------------------------------------------------------
  panel(root) { return (root && root.parentElement) || null; },

  _sections(root) { return Array.from(root.children).filter(el => el.classList.contains('setting-group')); },

  // Developer mode, a reveal or the "show advanced" switch: the same test as css/simple-mode.css.
  _shown(g, panel) {
    if (g.hidden || g.style.display === 'none') return false;
    if (g.dataset.tier !== 'advanced') return true;
    return document.body.dataset.uiMode !== 'simple' || g.classList.contains('set-revealed') || panel.classList.contains('set-show-advanced');
  },

  // Is this section's category the one on screen?
  _inCategory(el, key) { return el.dataset.navKey === key; },

  select(root, key) {
    const panel = this.panel(root);
    if (!panel) return null;
    panel.dataset.paneCat = key;
    for (const el of root.children) {
      if (!el.dataset || !el.dataset.navKey) continue;
      el.classList.toggle('set-pane-off', !this._inCategory(el, key));
    }
    this.refresh(root);
    const nav = panel.querySelector('.set-nav');
    if (nav) nav.querySelectorAll('.set-nav-chip').forEach((chip) => {
      if (chip.dataset.navKey === key) chip.setAttribute('aria-current', 'true'); else chip.removeAttribute('aria-current');
    });
    root.scrollTop = 0;
    if (typeof SettingsUI !== 'undefined') SettingsUI._layout(root);
    return key;
  },

  // The cards of the category on screen: the first section of each run of one card gets the card's title and rounded
  // top, the last the rounded bottom. Only writes what changed (a write would wake the watcher below).
  refresh(root) {
    const panel = this.panel(root);
    if (!panel || !panel.dataset.pane) return 0;
    const key = panel.dataset.paneCat || this.DEFAULT;
    const mark = (g, cls, title) => {
      for (const c of ['set-card-first', 'set-card-mid', 'set-card-last', 'set-card-only']) if (c !== cls && g.classList.contains(c)) g.classList.remove(c);
      if (cls && !g.classList.contains(cls)) g.classList.add(cls);
    };
    const shown = this._sections(root).filter(g => this._inCategory(g, key) && this._shown(g, panel));
    shown.forEach(g => this.densify(g, key));
    this._sections(root).forEach(g => { if (!shown.includes(g)) mark(g, '', ''); });
    // The runs of sections of one card.
    const runs = [];
    for (const g of shown) {
      const last = runs[runs.length - 1];
      if (last && last[0].dataset.card === g.dataset.card) last.push(g); else runs.push([g]);
    }
    // A card that would hold a single switch or button is not a card: its section joins the card before it (the first one, the card
    // after it). That is the "Options" of a category.
    const controls = (run) => run.reduce((n, g) => n + g.querySelectorAll('input:not([type="hidden"]), select, textarea, button:not(.set-info-btn):not(.set-more-btn):not(.set-advanced-toggle)').length, 0);
    for (let i = 0; i < runs.length && runs.length > 1;) {
      if (controls(runs[i]) > 1) { i++; continue; }
      if (i > 0) { runs[i - 1].push(...runs[i]); runs.splice(i, 1); }
      else { runs[1].unshift(...runs[0]); runs.splice(0, 1); }
    }
    const wanted = new Map();
    for (const run of runs) {
      run.forEach((g, k) => {
        const cls = run.length === 1 ? 'set-card-only' : k === 0 ? 'set-card-first' : k === run.length - 1 ? 'set-card-last' : 'set-card-mid';
        mark(g, cls, '');
      });
      wanted.set(run[0], this._t(run[0].dataset.card || ''));
    }
    // The card's title is a line of its own above its first section.
    for (const t of Array.from(root.querySelectorAll(':scope > .set-card-title'))) {
      const next = t.nextElementSibling;
      if (!wanted.has(next) || wanted.get(next) !== t.textContent) t.remove();
    }
    for (const [first, text] of wanted) {
      const prev = first.previousElementSibling;
      if (prev && prev.classList.contains('set-card-title')) continue;
      const t = document.createElement('div');
      t.className = 'set-card-title';
      t.setAttribute('role', 'heading');
      t.setAttribute('aria-level', '2');
      t.textContent = text;
      first.before(t);
    }
    this._clamp(shown, root);
    return runs.length;
  },

  // Called by SettingsUI.enhance once the sections have their navKey: give each its card, make the host for search results, show
  // the category.
  apply(root) {
    const panel = this.panel(root);
    if (!panel) return null;
    this.registerTr();
    panel.dataset.pane = '1';
    let host = root.querySelector(':scope > .set-results');
    if (!host) {
      host = document.createElement('div');
      host.className = 'set-results';
      host.hidden = true;
      root.prepend(host);
    }
    for (const g of this._sections(root)) {
      const cat = SettingsUI._catOf(g);
      const card = this.cardOf(g, cat, SettingsUI.topOf(cat));
      g.dataset.card = card.title;
    }
    const wanted = panel.dataset.paneCat;
    const available = !!wanted && Array.from(root.children).some(el => el.dataset && el.dataset.navKey === wanted);
    this.select(root, available ? wanted : this.DEFAULT);
    this._watch(root, panel);
    return panel.dataset.paneCat;
  },

  // A module that shows or hides a section later, or Developer mode being switched, changes which sections are on screen.
  _watch(root, panel) {
    if (typeof MutationObserver === 'undefined' || this._watching === root) return;
    this._watching = root;
    let queued = false;
    const again = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; SettingsPane.refresh(root); });
    };
    // Only a section itself matters (a deeper element changing its style is not a section shown or hidden).
    new MutationObserver((records) => {
      if (records.some(r => r.target === root || r.target.parentElement === root || (r.type === 'childList' && r.target.closest && r.target.closest('.setting-group') && r.target.closest('.setting-group').dataset.navKey === panel.dataset.paneCat))) again();
    }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style'] });
    new MutationObserver(again).observe(document.body, { attributes: true, attributeFilter: ['data-ui-mode'] });
    new MutationObserver(again).observe(panel, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('transitionend', again);
  },

  // ---- dense rows ----------------------------------------------------------------------------------
  // A section that is one switch, a switch and its sub-switches, or one button is not a box: it is ONE ROW of the category's
  // list ("Fake update guard   hint   [switch]"; "Help and FAQ   [Open]"). A switch whose own text only repeats the heading
  // ("Use Fake update guard") gives its text to the heading; later switches fold behind a chevron. A heading is kept only for
  // a section with four or more rows, and never when it repeats the category's name. Classes only: nothing is moved or removed.
  _STOP: new Set(['use', 'enable', 'enabled', 'turn', 'on', 'off', 'show', 'the', 'a', 'an', 'your', 'vex', 'to', 'when', 'for', 'of', 'and', 'in', 'is', 'with', 'allow']),
  _words(t) { return String(t || '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9\u00c0-\u024f]+/).filter(w => w && !this._STOP.has(w)); },
  _redundant(a, b) {
    const x = this._words(a), y = this._words(b);
    if (!x.length || !y.length) return false;
    const s = new Set(y);
    return x.filter(w => s.has(w)).length / Math.min(x.length, y.length) >= 0.6;
  },
  _CTL: 'input:not([type="hidden"]), select, textarea, button:not(.set-info-btn):not(.set-more-btn):not(.set-chevron):not(.set-clamp-btn)',
  densify(g, topKey) {
    const head = g.querySelector(':scope > .setting-label');
    const box = g.querySelector(':scope > [data-group-body], :scope > .vex-module-group-body') || g;
    const ctl = g.querySelectorAll(this._CTL);
    const toggles = Array.from(box.children).filter(c => c.matches('.setting-toggle-row') && c.querySelectorAll(this._CTL).length === 1 && c.querySelector('input[type="checkbox"]'));
    const nRows = g.querySelectorAll('.setting-toggle-row, .setting-row, .setting-row-label').length;
    const headText = head ? (typeof VexI18nUI !== 'undefined' && VexI18nUI.english ? VexI18nUI.english(head) : head.textContent) : '';
    let kind = '';
    if (toggles.length >= 1 && toggles.length <= 3 && ctl.length === toggles.length) kind = 'toggle';
    else if (ctl.length >= 1 && ctl.length <= 2 && Array.from(ctl).every(c => c.tagName === 'BUTTON')) kind = 'button';
    else if (ctl.length === 0 && nRows === 0 && head) kind = 'text';
    else if (head && nRows >= 1 && nRows < 4) kind = 'plain';
    const was = g.dataset.dense || '';
    // A section whose shape changed (a module filled it in later) starts from nothing.
    if (was !== kind || (kind === 'toggle' && g.dataset.denseN !== String(toggles.length))) {
      for (const c of ['set-dense', 'set-dense-toggle', 'set-dense-button', 'set-head-off', 'set-plain']) g.classList.remove(c);
      g.querySelectorAll('.set-redundant').forEach(e => e.classList.remove('set-redundant'));
      g.querySelectorAll('.set-sub').forEach(e => e.classList.remove('set-sub'));
      const old = g.querySelector(':scope > .set-chevron'); if (old) old.remove();
      delete g.dataset.open;
    }
    g.dataset.dense = kind;
    g.dataset.denseN = String(toggles.length);
    if (kind === 'toggle') {
      g.classList.add('set-dense', 'set-dense-toggle');
      const first = toggles[0];
      const span = first.querySelector(':scope > span');
      if (span) {
        // The switch's own words repeat the heading: the heading is the row's label.
        if (this._redundant(span.textContent, headText)) {
          span.classList.add('set-redundant');
          const input = first.querySelector('input');
          if (input && !input.getAttribute('aria-label')) input.setAttribute('aria-label', String(headText).replace(/\s+/g, ' ').trim());
        } else if (toggles.length === 1) g.classList.add('set-head-off');
      }
      if (toggles.length > 1) {
        toggles.slice(1).forEach(r => r.classList.add('set-sub'));
        if (!g.querySelector(':scope > .set-chevron')) {
          const ch = document.createElement('button');
          ch.type = 'button';
          ch.className = 'set-chevron';
          ch.setAttribute('aria-expanded', 'false');
          ch.setAttribute('aria-label', this._t('More options'));
          ch.title = this._t('More options');
          ch.innerHTML = typeof VexIcons !== 'undefined' ? VexIcons.svg('chevron-down', { size: 14 }) : '';
          ch.addEventListener('click', () => { const on = g.dataset.open !== '1'; if (on) g.dataset.open = '1'; else delete g.dataset.open; ch.setAttribute('aria-expanded', on ? 'true' : 'false'); });
          (head || g).after(ch);
        }
      }
    } else if (kind === 'button') g.classList.add('set-dense', 'set-dense-button');
    else if (kind === 'text') g.classList.add('set-dense');
    else if (kind === 'plain') g.classList.add('set-head-off', 'set-plain');
    // A heading that repeats the category's name says nothing.
    if (head && topKey && this._words(headText).join(' ') === this._words(topKey).join(' ')) g.classList.add('set-head-off');
    return kind;
  },

  // A section taller than CLAMP_AT shows its first CLAMP_TO px and a "Show all" over the rest; the rest is in the page, and
  // a focus, a link or a search result inside it opens it.
  CLAMP_AT: 520,
  CLAMP_TO: 300,
  _clamp(shown, root) {
    if (!root.clientWidth) return;
    for (const g of shown) {
      if (g.classList.contains('set-unclamped') || g.classList.contains('set-clamped')) continue;
      if (g.offsetHeight <= this.CLAMP_AT) continue;
      g.classList.add('set-clamped');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'set-clamp-btn';
      btn.textContent = this._t('Show all');
      btn.addEventListener('click', () => this.unclamp(g));
      g.appendChild(btn);
      g.addEventListener('focusin', () => this.unclamp(g), { once: true });
    }
  },
  unclamp(g) {
    if (!g || !g.classList.contains('set-clamped')) return;
    g.classList.remove('set-clamped');
    g.classList.add('set-unclamped');
    const b = g.querySelector(':scope > .set-clamp-btn');
    if (b) b.remove();
  },

  // The category a section is in (for a result or a link).
  categoryOf(el) {
    const g = el && el.closest ? el.closest('.setting-group') : null;
    return g ? g.dataset.navKey || null : null;
  },
};

if (typeof window !== 'undefined') window.SettingsPane = SettingsPane;
if (typeof module !== 'undefined' && module.exports) module.exports = { SettingsPane };
