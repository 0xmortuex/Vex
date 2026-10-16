// === Vex Settings UI enhancer ===
// Turns the flat list of .setting-group blocks into vivid, color-coded category
// cards and builds a sticky chip-nav to jump between them. Pure presentation —
// it never touches the existing inputs/ids, so all settings handlers keep working.
// Called by SidebarManager.showPanel whenever Settings opens (idempotent).

const SettingsUI = {
  // Small inline SVGs (stroked with currentColor so they follow the category
  // colour and the theme). Rendered inside a shared 24x24 viewBox.
  ICONS: {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H13a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4c0-3.3-4-6-9-6Z"/><circle cx="8" cy="10" r="1.1"/><circle cx="12" cy="7.5" r="1.1"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.7-7 9c-4.1-1.3-7-4.8-7-9V6l7-3Z"/>',
    pencil: '<path d="M4 20h4L20 8l-4-4L4 16v4Z"/><path d="M14 6l4 4"/>',
    bolt: '<path d="M13 3L5 14h6l-1 7l8-11h-6l1-7Z"/>',
    save: '<path d="M5 4h11l3 3v13H5V4Z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    download: '<path d="M12 4v11"/><path d="M7 10l5 5l5-5"/><path d="M5 20h14"/>',
    folders: '<path d="M3 8V6a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v1"/><rect x="3" y="8" width="18" height="12" rx="2"/>',
    pin: '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 3v6h-6"/>',
    spark: '<path d="M12 3l2.1 5.6L20 11l-5.9 2.4L12 19l-2.1-5.6L4 11l5.9-2.4L12 3Z"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17 14.6A6 6 0 0 1 21 20"/>',
    memory: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    plug: '<path d="M9 3v6M15 3v6"/><path d="M6 9h12v3a6 6 0 0 1-12 0V9Z"/><path d="M12 18v3"/>',
    star: '<path d="M12 4l2.4 5.2l5.6.7l-4.1 3.8l1.1 5.5L12 16.5L7 19.2l1.1-5.5L4 9.9l5.6-.7L12 4Z"/>',
    rocket: '<path d="M12 3c3.5 2 5.5 5.5 5.5 9.5L14 16h-4l-3.5-3.5C6.5 8.5 8.5 5 12 3Z"/><path d="M10 16l-2 5l4-2l4 2l-2-5"/>',
    key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M15.5 12v2.5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z"/><path d="M5 17h14"/>',
    bookOpen: '<path d="M12 6.5C10.5 5 8.5 4.5 4 4.5v13c4.5 0 6.5.5 8 2c1.5-1.5 3.5-2 8-2v-13c-4.5 0-6.5.5-8 2Z"/><path d="M12 6.5V19"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7L11.5 7"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7L12.5 17"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
    layers: '<path d="M12 3l9 5l-9 5l-9-5l9-5Z"/><path d="M3 13l9 5l9-5"/>',
    cursor: '<path d="M6 3l12 8l-5 1.2L15.5 18l-2.4 1l-2.6-5.6L6 17V3Z"/>',
    puzzle: '<path d="M10 4h4v2.2a1.8 1.8 0 1 0 3.6 0V4H20v4h-2.2a1.8 1.8 0 1 0 0 3.6H20V20h-4.4v-2.2a1.8 1.8 0 1 0-3.6 0V20H4v-4.4h2.2a1.8 1.8 0 1 0 0-3.6H4V8h6V4Z"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
    cloud: '<path d="M7 18a4 4 0 0 1 .6-8A5.5 5.5 0 0 1 18 10.5a3.75 3.75 0 0 1-.4 7.5H7Z"/>',
    box: '<path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5v-9Z"/><path d="M3 7.5L12 12l9-4.5M12 12v9"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/>',
    // The Settings layout button (VexIcons' sliders).
    sliders: '<path d="M5 3.5v6M5 14.5v6M12 3.5v3M12 11.5v9M19 3.5v9M19 17.5v3"/><circle cx="5" cy="12" r="2.4"/><circle cx="12" cy="9" r="2.4"/><circle cx="19" cy="15" r="2.4"/>',
  },

  // First match wins, so the order matters: "Tab Layout" has to reach Appearance
  // before the Layout row, and "Personalization" has to reach its own category
  // before Personas (it contains the substring "persona") — it used to be filed
  // under Personas and got no nav chip of its own.
  //
  // A category with a `group` keeps its own mark and colour on its card, but
  // shares one chip in the nav with the rest of its group; the group's sections
  // get a row of smaller chips of their own, above the first of them (`short`
  // is the name on that row). The AI sections were seven chips of 37, which
  // wrapped the bar to five rows (the owner, 2026-10-10). Recall and
  // Personalization are not AI — a local full-text index, and the start page's
  // name/weather — so they keep their chips.
  CATS: [
    { name: 'General',         icon: 'search',   color: '#6366f1', match: ['general', 'search engine'] },
    { name: 'Browser',         icon: 'globe',    color: '#0ea5e9', match: ['default browser'] },
    { name: 'Appearance',      icon: 'palette',  color: '#a855f7', match: ['appearance', 'theme', 'gui style', 'tab layout', 'vex packs'] },
    { name: 'Layout',          icon: 'grid',     color: '#c084fc', match: ['layout'] },
    { name: 'Sidebar',         icon: 'panel',    color: '#818cf8', match: ['sidebar', 'links and panels', 'panels and messages'] },
    { name: 'Privacy',         icon: 'shield',   color: '#22c55e', match: ['privacy', 'security', 'private routing', 'web safety', 'safer web', 'if something went wrong', 'signed in to'] },
    { name: 'Autofill',        icon: 'pencil',   color: '#4ade80', match: ['autofill', 'text snippets', 'unfinished forms'] },
    { name: 'Performance',     icon: 'bolt',     color: '#f97316', match: ['performance', 'sleep', 'gaming and streaming', 'game mode', 'discord hotkeys', 'when a game is running', 'on battery', 'loadout cards', 'game audio scenes', 'game control center', 'second screen'] },
    { name: 'Sessions',        icon: 'save',     color: '#f59e0b', match: ['session'] },
    { name: 'Downloads',       icon: 'download', color: '#0284c7', match: ['downloads'] },
    { name: 'Workspaces',      icon: 'folders',  color: '#14b8a6', match: ['workspace'] },
    { name: 'Location',        icon: 'pin',      color: '#ef4444', match: ['location'] },
    { name: 'Sync',            icon: 'refresh',  color: '#06b6d4', match: ['sync'] },
    { name: 'AI',              icon: 'spark',    color: '#d4a574', match: ['ai backend', 'assistant', 'your local models', 'ai agent', 'where ai runs', 'draft into the field', 'thread digest', 'site instructions', 'search by meaning'], group: 'AI' },
    { name: 'Personalization', icon: 'user',     color: '#f0abfc', match: ['personalization', 'morning brief', 'brief actions', 'new tab by time of day', 'new tab layout', 'left-overs', 'chores and bills', 'close the day', 'shape of the day', 'what is due', 'first open of the day', 'next step', 'park and resume', 'copy with source', 'find deadlines', 'put things off', 'plan the week', 'weekly triage', 'what changed since', 'receipts and warranties', 'orders'] },
    { name: 'Profiles',        icon: 'users',    color: '#22d3ee', match: ['profiles'] },
    { name: 'Personas',        icon: 'users',    color: '#8b5cf6', match: ['persona'], group: 'AI' },
    { name: 'AI Memory',       icon: 'memory',   color: '#c084fc', match: ['ai memory'], group: 'AI', short: 'Memory' },
    { name: 'On-Device',       icon: 'monitor',  color: '#2dd4bf', match: ['on-device', 'webgpu'], group: 'AI' },
    { name: 'MCP',             icon: 'plug',     color: '#38bdf8', match: ['mcp'], group: 'AI' },
    { name: 'Skills',          icon: 'star',     color: '#fbbf24', match: ['skill'], group: 'AI' },
    { name: 'AI History',      icon: 'clock',    color: '#7dd3fc', match: ['ai history'], group: 'AI', short: 'History' },
    { name: 'Developer',       icon: 'braces',   color: '#38bdf8', match: ['developer', 'github access', 'refresh after a build'] },
    { name: 'Boosts',          icon: 'rocket',   color: '#f472b6', match: ['boost', 'userscript'] },
    { name: 'Passwords',       icon: 'key',      color: '#34d399', match: ['password'] },
    { name: 'Passkeys',        icon: 'key',      color: '#2dd4bf', match: ['passkey'] },
    { name: 'Focus OS',        icon: 'target',   color: '#f43f5e', match: ['focus os'] },
    { name: 'Focus',           icon: 'target',   color: '#fb7185', match: ['focus', 'distraction budget', 'night usage coach', 'breaks', 'study block', 'ask before distracting'] },
    { name: 'Knowledge',       icon: 'book',     color: '#60a5fa', match: ['knowledge', 'citations', 'research board', 'sources into a document', 'translation glossary', 'explain this page', 'flashmind', 'meeting copilot', 'subscriptions and renewals', 'listen to articles', 'courses', 'exam', 'model un', 'paper brief', 'past papers', 'turkish and english'] },
    { name: 'Library',         icon: 'book',     color: '#38bdf8', match: ['library', 'memory tools'] },
    { name: 'Reading',         icon: 'bookOpen', color: '#818cf8', match: ['reading', 'accessibility'] },
    { name: 'Recall',          icon: 'clock',    color: '#2dd4bf', match: ['recall'] },
    { name: 'Chains',          icon: 'link',     color: '#a3a3a3', match: ['chain'] },
    { name: 'Shortcuts',       icon: 'keyboard', color: '#94a3b8', match: ['shortcut'] },
    { name: 'Tab Groups',      icon: 'layers',   color: '#fb923c', match: ['tab grouping', 'tab tools', 'tabs and navigation'] },
    { name: 'History',         icon: 'clock',    color: '#7dd3fc', match: ['history', 'time travel', 'find by time'] },
    { name: 'Play',            icon: 'puzzle',   color: '#f472b6', match: ['play: ', 'playfulness', 'fun and', 'living vex', 'profile and medals', 'little surprises', 'weekly page, offline'] },
    { name: 'Vex health',      icon: 'info',     color: '#94a3b8', match: ['health check', 'minimal vex', 'feature usage', 'release check'] },
    { name: 'Extras',          icon: 'cursor',   color: '#60a5fa', match: ['browsing extras', 'gesture', 'page watcher', 'announcement desk', 'ai news', 'quiet hours', 'attention', 'why a tab is open', 'repeated searches', 'shopping comparison', 'why is this tab open', 'watcher alerts', 'inbox'] },
    { name: 'Extensions',      icon: 'puzzle',   color: '#10b981', match: ['extension'] },
    { name: 'Permissions',     icon: 'lock',     color: '#eab308', match: ['permission', 'site settings'] },
    { name: 'Cloud',           icon: 'cloud',    color: '#67e8f9', match: ['cloud'] },
    { name: 'Data',            icon: 'box',      color: '#ec4899', match: ['data', 'reset', 'export', 'storage'] },
    { name: 'About',           icon: 'info',     color: '#64748b', match: ['about', 'version', 'update'] },
  ],

  // How a group's one chip looks in the nav (see `group` in CATS).
  GROUPS: {
    AI: { name: 'AI', icon: 'spark', color: '#d4a574' },
  },

  // Which tab layout actually applies, given the stored Tab Layout choice and
  // the active GUI style. Glass and the browser looks lay the window out
  // themselves (body[data-gui-style] is set only for those), so they win over
  // the stored choice — applying a stored 'vertical' under one of them put the
  // top tab strip and the vertical rail on screen at the same time.
  resolveTabLayout(stored, guiStyle) {
    if (guiStyle) return 'horizontal';
    return stored === 'vertical' ? 'vertical' : 'horizontal';
  },

  // One <svg> wrapper for every category mark.
  _svg(iconName, size) {
    const body = this.ICONS[iconName] || this.ICONS.gear;
    return '<svg class="set-cat-icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  },

  // The sections Simple mode (js/simple-mode.js) keeps in view, by the start
  // of their heading. Every other section is "advanced": tucked behind Show
  // advanced settings, and still found by the search.
  BASIC_SECTIONS: [
    'general', 'default browser', 'sidebar buttons', 'privacy & security',
    'autofill', 'sessions', 'downloads', 'passwords', 'passkeys', 'appearance', 'gui style', 'tab layout',
    'reading & accessibility', 'personalization', 'data', 'about',
  ],
  tierOf(labelText) {
    const t = String(labelText || '').trim().toLowerCase();
    return this.BASIC_SECTIONS.some(name => t.startsWith(name)) ? 'basic' : 'advanced';
  },

  // A section the user reached on purpose — by searching for it, or through a
  // deep link — stays in view when the search is cleared.
  reveal(el) {
    const group = el && el.closest ? el.closest('.setting-group') : null;
    if (group && group.dataset.tier === 'advanced') group.classList.add('set-revealed');
    return group;
  },

  _setAdvancedShown(panel, on) {
    panel.classList.toggle('set-show-advanced', on);
    const btn = panel.querySelector('.set-advanced-toggle');
    if (btn) {
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      const n = panel.querySelectorAll('.settings-content > .setting-group[data-tier="advanced"]').length;
      btn.querySelector('.set-advanced-label').textContent = on ? 'Hide advanced settings' : 'Show advanced settings (' + n + ' more sections)';
    }
  },

  // What people type when they look for a section, by the start of its
  // heading. The search only read the words on screen, so "dark mode", "font
  // size", "homepage", "startup", "download folder" and "dil" found nothing,
  // and a section still "Loading…" could not be found at all (found
  // 2026-10-10). Turkish words are here too, for a Turkish Settings.
  KEYWORDS: {
    'on battery': 'battery laptop power saving unplugged low battery plugged in energy pil dizüstü güç tasarrufu',
    'userscripts': 'userscript greasemonkey tampermonkey violentmonkey user.js gm script install per-site script kullanıcı betiği',
    'general': 'search engine default search google duckduckgo bing language dil türkçe turkish english simple mode suggestions arama motoru',
    'default browser': 'default app open links make default varsayılan tarayıcı',
    'sidebar buttons': 'sidebar icons panels reorder hide buttons kenar çubuğu',
    'privacy & security': 'lock pin lock screen tracking cookies do not track https security gizlilik güvenlik kilit',
    'privacy hardening': 'fingerprint webrtc third-party cookies trackers streamer mode gaming game mode discord hotkeys',
    'autofill': 'email codes one-time codes 2fa verification codes otp sign-in codes otomatik doldurma',
    'sessions': 'startup on startup start up restore tabs reopen tabs session restore autosave continue where you left off oturum açılış',
    'downloads': 'download folder download location downloads folder save files save to ask where to save indirme klasörü indirilenler',
    'performance': 'memory ram sleeping tabs tab sleep memory saver auto sleep cpu speed battery bellek uyku hız',
    'profiles': 'profile accounts separate users profil',
    'data': 'export import reset clear data backup restore factory reset veriler yedek sıfırla',
    'location': 'gps geolocation weather konum',
    'vex sync': 'sync devices account eşitleme',
    'ai backend': 'ai claude ollama local model llm assistant yapay zeka yapay zekâ',
    'gui style': 'look skin firefox chrome safari classic glass interface style görünüm',
    'appearance': 'dark mode light mode dark theme night mode colours colors theme font font size text size ui scale bigger text zoom skin karanlık mod koyu tema yazı tipi yazı boyutu settings layout columns compact density category menu side list sütun düzen yoğunluk',
    'private routing': 'proxy tor vpn socks route yönlendirme',
    'tab layout': 'vertical tabs horizontal tabs tabs on the side dikey sekmeler',
    'layout': 'toolbar buttons customize toolbar hide buttons araç çubuğu',
    'site settings': 'camera microphone notifications pop-ups popups javascript per site izinler bildirim',
    'site permissions': 'camera microphone notifications location pop-ups popups permissions izinler bildirim kamera mikrofon',
    'chrome extensions': 'add-ons addons plugins extensions web store eklenti',
    'keyboard shortcuts': 'hotkeys keybindings keys kısayol tuşları',
    'passwords': 'logins password manager saved passwords vault parola şifre',
    'passkeys': 'passkey passkeys webauthn fido sign in without password windows hello biometric security key',
    'reading & accessibility': 'a11y font size text size dyslexia reading font colour blind color blind contrast ruler erişilebilirlik yazı boyutu',
    'browsing extras': 'mouse gestures clipboard cookie banners consent copy right-click',
    'page watcher': 'watch page changes monitor price drop restock version update diff notify tell me when it changes watched pages sayfa izleyici değişiklik izle',
    'ai news': 'ai news model release openai anthropic google meta notify notification toast badge breaking digest quiet hours follow mute topic company feed haber yapay zeka bildirim sessiz saatler',
    'personalization': 'name greeting homepage home page start page new tab page weather github başlangıç sayfası ana sayfa',
    'workflow': 'resume workday end of day focus profile work study gaming ask across tabs weekly note clip release radar whats new chain timer meeting prep calendar card tab cleanup evening archive idle tabs routine morning routine search mail subjects universal search iş akışı toplantı hazırlığı sekme temizliği rutin',
    'morning brief': 'morning brief briefing new tab page sections evening wind down spoken digest streaks goals one new thing news actions mail summary sabah özeti bölümler',
    'brief actions': 'snooze mail triage draft reply pull requests github desk interests day layout next action lost tab finder ertele özet eylemleri',
    'memory tools': 'journal diary link memory saved links dashboards widgets clipboard actions game log backup export hafıza araçları günlük yedek',
    'distraction budget': 'distraction limit daily limit social media video news minutes block downloads tidy tidy up sort downloads folder dikkat bütçesi sınır indirilenler',
    'cloud services': 'worker cloudflare self-hosted token api key bulut',
    'about': 'update updates version check for updates changelog release notes whats new stable channel güncelleme sürüm hakkında',
  },
  keywordsFor(heading) {
    const t = String(heading || '').trim().toLowerCase();
    const hit = Object.keys(this.KEYWORDS).find(k => t.startsWith(k));
    return hit ? this.KEYWORDS[hit] : '';
  },

  _matchCat(text) {
    for (const c of this.CATS) {
      if (c.match.some(m => text.includes(m))) return c;
    }
    return { name: 'Other', icon: 'gear', color: 'var(--primary)' };
  },

  // Live-filter the setting groups by the search query. Hiding the chip nav while
  // searching keeps the result list clean.
  _filter(root, query) {
    const q = (query || '').trim().toLowerCase();
    const groups = Array.from(root.querySelectorAll('.setting-group'));
    let any = false;
    groups.forEach(g => {
      const match = !q || ((g.textContent || '') + ' ' + (g.dataset.keywords || '')).toLowerCase().includes(q);
      g.style.display = match ? '' : 'none';
      if (match) any = true;
    });
    const nav = (root.parentElement || root).querySelector('.set-nav');
    if (nav) nav.style.display = q ? 'none' : '';
    root.querySelectorAll(':scope > .set-subnav').forEach(row => { row.style.display = q ? 'none' : ''; });
    // While searching, Simple mode hides nothing: the advanced sections that
    // match are in the results (css/simple-mode.css marks them Advanced).
    (root.parentElement || root).classList.toggle('set-searching', !!q);
    // Results start at the top: the list kept wherever it had been scrolled
    // to, so the first matches were often above the view.
    if (q) root.scrollTop = 0;
    // The section picked from the results was out of sight before the search;
    // take the user back to it rather than to the top of the list.
    if (!q && this._lastRevealed) {
      const picked = this._lastRevealed;
      this._lastRevealed = null;
      if (picked.isConnected) picked.scrollIntoView({ block: 'start' });
    }
    this._syncPad(root);
    let empty = root.querySelector('.set-empty');
    if (q && !any) {
      if (!empty) { empty = document.createElement('div'); empty.className = 'set-empty'; empty.style.cssText = 'color:var(--text-muted);font-size:13px;padding:20px 4px'; root.appendChild(empty); }
      empty.textContent = 'No settings match “' + query + '”.';
      empty.style.display = '';
    } else if (empty) { empty.style.display = 'none'; }
    // The results, and the empty note, get their place in the columns.
    this._layout(root);
  },

  // The pickers that live in Settings but open as their own screens, because
  // a texture, a typeface and a palette cannot be shown in a drop-down.
  PICKERS: [
    ['setting-open-theme', () => (typeof ThemePicker !== 'undefined' ? ThemePicker.open() : null)],
    ['setting-open-skin', () => (typeof VexSkins !== 'undefined' ? VexSkins.open() : null)],
    ['setting-open-font', () => (typeof VexFonts !== 'undefined' ? VexFonts.open() : null)],
    ['setting-open-routing', () => (typeof PrivateRouting !== 'undefined' ? PrivateRouting.open() : null)],
    ['setting-open-site-routes', () => (typeof SiteRoutes !== 'undefined' ? SiteRoutes.open() : null)],
    ['setting-open-backup', () => (typeof VexBackup !== 'undefined' ? VexBackup.open() : null)],
    // Settings › Data: the same screen, which lists the backups made around updates.
    ['setting-open-update-backups', () => (typeof VexBackup !== 'undefined' ? VexBackup.open() : null)],
    ['setting-open-browser-import', () => (typeof BrowserImport !== 'undefined' ? BrowserImport.open() : null)],
    ['setting-open-library', () => {
      try { if (typeof ReadLater !== 'undefined') ReadLater.showTab('features'); } catch { /* the panel opens either way */ }
      if (typeof SidebarManager !== 'undefined') SidebarManager.openPanel('library');
    }],
  ],

  _wirePickers() {
    for (const [id, open] of this.PICKERS) {
      const btn = document.getElementById(id);
      if (!btn || btn.dataset.wired) continue;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => {
        try { open(); }
        catch (err) { window.showToast?.((err && err.message) || 'That could not be opened', 'error'); }
      });
    }
  },

  // The theme and feature counts in Settings text, from the real lists (the
  // written-down numbers said 37 and 222 when there were 65 and 228).
  _fillCounts(root) {
    const n = {
      themes: (typeof ThemeManager !== 'undefined' && ThemeManager.THEMES) ? ThemeManager.THEMES.length : null,
      features: (typeof VexFeatures !== 'undefined' && VexFeatures.ITEMS) ? VexFeatures.ITEMS.length : null,
    };
    root.querySelectorAll('[data-count]').forEach(el => { const v = n[el.dataset.count]; if (v != null) el.textContent = String(v); });
  },

  // Settings › General › Language: the setup's language step, without the
  // whole setup (it was the only way to change it, and Simple mode hid it).
  _wireLanguage() {
    const sel = document.getElementById('setting-language');
    if (!sel) return;
    sel.value = (typeof VexI18nUI !== 'undefined' ? VexI18nUI.locale() : null) || window.VexI18n?.locale() || 'en';
    if (sel.dataset.wired) return;
    sel.dataset.wired = '1';
    sel.addEventListener('change', () => {
      try {
        if (!window.Onboarding || typeof window.Onboarding.setLanguage !== 'function') throw new Error('the language setting is not loaded');
        window.Onboarding.setLanguage(sel.value);
      } catch (err) { window.showToast?.('The language could not be changed: ' + ((err && err.message) || err), 'error'); }
    });
  },

  enhance() {
    const root = document.querySelector('#panel-settings .settings-content');
    if (!root) return;
    this._wirePickers();
    this._wireLanguage();
    this._fillCounts(root);
    const groups = Array.from(root.children).filter(el => el.classList && el.classList.contains('setting-group'));
    if (!groups.length) return;

    // Build the toolbar (search + chip nav) as a FIXED flex header OUTSIDE the
    // scrolling .settings-content — i.e. a sibling in #panel-settings (a flex
    // column). This pins it reliably without depending on position:sticky, which
    // proved flaky in this layout.
    const panel = root.parentElement || root;            // #panel-settings
    let toolbar = panel.querySelector('.set-toolbar');
    let nav, search;
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'set-toolbar';
      const inner = document.createElement('div');
      inner.className = 'set-toolbar-inner';
      search = document.createElement('input');
      search.className = 'set-search';
      search.type = 'search';
      search.placeholder = 'Search settings…';
      search.spellcheck = false;
      nav = document.createElement('div');
      nav.className = 'set-nav';
      nav.setAttribute('role', 'navigation');
      nav.setAttribute('aria-label', 'Settings categories');
      // The search box, and the Settings layout button beside it.
      const searchRow = document.createElement('div');
      searchRow.className = 'set-search-row';
      searchRow.appendChild(search);
      this._buildLayoutButton(searchRow);
      inner.appendChild(searchRow);
      inner.appendChild(nav);
      toolbar.appendChild(inner);
      panel.insertBefore(toolbar, root);                 // pinned over the scroll area
      search.addEventListener('input', () => SettingsUI._filter(root, search.value));
      // The list on the left goes up and down with the arrow keys too.
      nav.addEventListener('keydown', (e) => SettingsUI._navKey(e, panel, nav));
      // Focus (a click, or Tab) makes that entry the one Tab returns to.
      nav.addEventListener('focusin', (e) => { if (e.target && e.target.classList && e.target.classList.contains('set-nav-chip')) SettingsUI._rove(panel, e.target); });
      // The category in view is the one marked in the menu.
      let marking = false;
      root.addEventListener('scroll', () => {
        if (marking) return;
        marking = true;
        requestAnimationFrame(() => { marking = false; SettingsUI._markCurrent(root); });
      }, { passive: true });
      toolbar.addEventListener('wheel', (e) => SettingsUI._wheelToArea(e, root), { passive: false });
      // Keep the scroll area's top padding matched to the (variable-height) toolbar.
      window.addEventListener('resize', () => SettingsUI._syncPad(root));
      // The toolbar is usually built while the panel is hidden, so it measured
      // 0 and the fallback (88) stood in for a real ~220 in the Firefox look —
      // section tops sat under the toolbar. Measure again whenever it
      // changes size, including the moment it is first shown (found 2026-09-29).
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => SettingsUI._syncPad(root)).observe(toolbar);
      // Clicking or tabbing into a search result keeps that section in view
      // after the search box is cleared (Simple mode would hide it again).
      const keep = (e) => {
        if (!panel.classList.contains('set-searching')) return;
        const group = SettingsUI.reveal(e.target);
        const hidden = document.body.dataset.uiMode === 'simple' && !panel.classList.contains('set-show-advanced');
        if (hidden && group && group.classList.contains('set-revealed')) SettingsUI._lastRevealed = group;
      };
      root.addEventListener('focusin', keep);
      root.addEventListener('pointerdown', keep);
    } else {
      nav = toolbar.querySelector('.set-nav');
      search = toolbar.querySelector('.set-search');
    }
    nav.innerHTML = '';
    root.querySelectorAll(':scope > .set-subnav').forEach(row => row.remove());
    const seen = new Set();
    const rows = {};   // group name -> { row, chip, names } for its row of sub-chips

    groups.forEach((g, i) => {
      const labelEl = g.querySelector('.setting-label');
      // The English heading: Turkish headings would match no category (js/i18n-ui.js).
      const text = (labelEl ? (typeof VexI18nUI !== 'undefined' ? VexI18nUI.english(labelEl) : labelEl.textContent) : '').toLowerCase();
      const cat = this._matchCat(text);
      const tier = this.tierOf(text);
      g.dataset.tier = tier;
      // The English heading goes in too, so an English word still finds a
      // section whose heading is shown in Turkish.
      if (labelEl) g.dataset.keywords = text.trim().split('\n')[0] + ' ' + this.keywordsFor(text);
      g.style.setProperty('--cat-color', cat.color);
      if (!g.id) g.id = 'setcat-' + i;
      // Which entry of the category menu this section belongs to (_markCurrent).
      g.dataset.navKey = cat.group || cat.name;

      if (labelEl && !labelEl.querySelector('.set-emoji')) {
        const chip = document.createElement('span');
        chip.className = 'set-emoji';
        chip.innerHTML = this._svg(cat.icon, 15);
        labelEl.insertBefore(chip, labelEl.firstChild);
      }

      // A grouped section: one row of sub-chips just above the group's first
      // section, outside every card so the search never matches a card by the
      // names on that row (2026-10-10).
      let grp = null;
      if (cat.group) {
        grp = rows[cat.group];
        if (!grp) {
          const row = document.createElement('div');
          row.className = 'set-subnav';
          row.setAttribute('role', 'group');
          row.setAttribute('aria-label', this.GROUPS[cat.group].name + ' sections');
          row.dataset.tier = tier;
          row.dataset.navKey = cat.group;
          g.before(row);
          grp = rows[cat.group] = { row, chip: null, names: new Set() };
        }
        if (!grp.names.has(cat.name)) {
          grp.names.add(cat.name);
          const sub = document.createElement('button');
          sub.type = 'button';
          sub.className = 'set-nav-chip set-subnav-chip';
          sub.style.setProperty('--chip-color', cat.color);
          sub.innerHTML = this._svg(cat.icon, 12) + '<span>' + (cat.short || cat.name) + '</span>';
          sub.dataset.tier = tier;
          sub.addEventListener('click', () => { SettingsUI._wanted = { key: g.dataset.navKey, until: Date.now() + 3000 }; g.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
          grp.row.appendChild(sub);
        }
      }

      const key = cat.group || cat.name;
      if (!seen.has(key)) {
        seen.add(key);
        const look = cat.group ? this.GROUPS[cat.group] : cat;
        // The group's chip lands on its row of sub-chips, which sits right
        // above the group's first section.
        const target = grp ? grp.row : g;
        const navChip = document.createElement('button');
        navChip.className = 'set-nav-chip';
        navChip.style.setProperty('--chip-color', look.color);
        navChip.innerHTML = this._svg(look.icon, 13) + '<span>' + look.name + '</span>';
        navChip.dataset.tier = tier;
        navChip.dataset.navKey = key;
        navChip.addEventListener('click', () => { SettingsUI._wanted = { key, until: Date.now() + 3000 }; target.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
        nav.appendChild(navChip);
        if (grp) grp.chip = navChip;
      }
      // Simple mode hides a group's chip and row only when every section in
      // the group is tucked away.
      if (grp && tier === 'basic') {
        grp.row.dataset.tier = 'basic';
        grp.chip.dataset.tier = 'basic';
      }
    });

    // Simple mode's "Show advanced settings", after the last section. Shown
    // only in Simple mode (css/simple-mode.css); built once, kept last.
    let adv = root.querySelector(':scope > .set-advanced-toggle');
    if (!adv) {
      adv = document.createElement('button');
      adv.type = 'button';
      adv.className = 'set-advanced-toggle';
      adv.innerHTML = this._svg('layers', 15) + '<span class="set-advanced-label"></span>';
      adv.addEventListener('click', () => {
        const on = !panel.classList.contains('set-show-advanced');
        SettingsUI._setAdvancedShown(panel, on);
        if (on) {
          const first = root.querySelector(':scope > .setting-group[data-tier="advanced"]');
          if (first) first.scrollIntoView({ block: 'start' });
        }
      });
    }
    const lastGroup = groups[groups.length - 1];
    if (lastGroup.nextSibling !== adv) lastGroup.after(adv);
    this._setAdvancedShown(panel, panel.classList.contains('set-show-advanced'));

    // Settings › Appearance › Settings layout, and the saved choices.
    this._fillLayoutSetting(document.getElementById('settings-layout-setting'));
    this._applyLayoutAttrs(panel);

    // Push the scroll content below the absolute toolbar (and let anchored jumps
    // clear it too). Measured after the chips are in, so wrapping is accounted for.
    this._syncPad(root);
    // Side-by-side sections in a wide window (see _layout).
    this._watchLayout(root);
    this._markCurrent(root);
  },

  // === Settings layout =====================================================
  // How Settings is laid out, chosen by the user (the owner, 2026-10-12:
  // "give more layout options for the settings"): how many columns, where
  // the category menu is, and how tightly the rows are packed. Kept on this
  // device and never synced (sync is an allow-list, js/sync-engine.js): it is
  // about this screen. Reset to Defaults clears it (app.js), which is the
  // layout Settings had before: automatic columns, chips, comfortable.
  LAYOUT_KEY: 'vex.settingsLayout',
  LAYOUT_CHOICES: {
    columns: [['auto', 'Automatic'], ['1', 'One column'], ['wide', 'One column, full width'], ['2', 'Two columns'], ['3', 'Three columns']],
    nav: [['chips', 'Chips across the top'], ['side', 'A list down the left side']],
    density: [['comfortable', 'Comfortable'], ['compact', 'Compact']],
  },
  // [the row's name in Settings › Appearance, the short name in the
  // toolbar's box, what it does]
  LAYOUT_LABELS: {
    columns: ['Settings columns', 'Columns', 'Automatic uses two columns from about 1300px wide, and three on very wide screens.'],
    nav: ['Settings category menu', 'Category menu', 'On a narrow window the list becomes chips again.'],
    density: ['Settings density', 'Density', 'Compact fits more on the screen: tighter rows, the same text size.'],
  },
  // The least width of a column the user asked for: narrower than the
  // automatic choice's COL_MIN, wide enough for a label beside its switch.
  COL_MIN_CHOSEN: 480,
  // The narrowest Settings that keeps the category list on the left.
  SIDE_MIN: 900,

  layoutPrefs() {
    const out = { columns: 'auto', nav: 'chips', density: 'comfortable' };
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(this.LAYOUT_KEY) || 'null'); }
    catch (err) { console.warn('[settings] the saved Settings layout is unreadable; showing the default:', err && err.message); }
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(out)) {
        if (this.LAYOUT_CHOICES[k].some(([v]) => v === saved[k])) out[k] = saved[k];
      }
    }
    return out;
  },

  setLayoutPref(name, value) {
    const choices = this.LAYOUT_CHOICES[name];
    if (!choices) throw new Error('There is no Settings layout choice called "' + name + '"');
    if (!choices.some(([v]) => v === value)) throw new Error('"' + value + '" is not one of the ' + name + ' choices');
    const prefs = this.layoutPrefs();
    prefs[name] = value;
    localStorage.setItem(this.LAYOUT_KEY, JSON.stringify(prefs));
    this.applyLayoutPrefs();
    return prefs;
  },

  _isDefaultLayout(prefs) {
    return prefs.columns === 'auto' && prefs.nav === 'chips' && prefs.density === 'comfortable';
  },

  // Every choice back to its default (the saved layout dropped), on screen at once.
  resetLayoutPrefs() {
    localStorage.removeItem(this.LAYOUT_KEY);
    return this.applyLayoutPrefs();
  },

  // The saved choices, on screen at once: no reload.
  applyLayoutPrefs() {
    const panel = typeof document !== 'undefined' ? document.getElementById('panel-settings') : null;
    if (!panel) return null;
    const prefs = this._applyLayoutAttrs(panel);
    const root = panel.querySelector('.settings-content');
    if (root) { this._layout(root); this._markCurrent(root); }
    return prefs;
  },

  _applyLayoutAttrs(panel) {
    const prefs = this.layoutPrefs();
    if (prefs.density === 'compact') panel.dataset.setDensity = 'compact';
    else delete panel.dataset.setDensity;
    // One column that uses the whole width instead of the readable 960px.
    if (prefs.columns === 'wide') panel.dataset.setWide = '1';
    else delete panel.dataset.setWide;
    panel.querySelectorAll('select[data-set-layout]').forEach(sel => { sel.value = prefs[sel.dataset.setLayout]; });
    const plain = this._isDefaultLayout(prefs);
    panel.querySelectorAll('.set-layout-reset').forEach(btn => { btn.disabled = plain; });
    return prefs;
  },

  // The list on the left, or the chips, for a panel this many CSS pixels wide.
  navFor(panelWidth, choice) {
    return choice === 'side' && Number(panelWidth) >= this.SIDE_MIN ? 'side' : 'chips';
  },

  _layoutSelect(name, label) {
    const sel = document.createElement('select');
    sel.dataset.setLayout = name;
    sel.setAttribute('aria-label', label);
    for (const [value, text] of this.LAYOUT_CHOICES[name]) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      sel.appendChild(o);
    }
    sel.value = this.layoutPrefs()[name];
    sel.addEventListener('change', () => {
      try { SettingsUI.setLayoutPref(name, sel.value); }
      catch (err) {
        window.showToast?.('The Settings layout could not be changed: ' + ((err && err.message) || err), 'error');
        SettingsUI.applyLayoutPrefs();   // the box shows what is really in force
      }
    });
    return sel;
  },

  // Why a choice is not what is on screen: too narrow a window.
  _layoutNote(name) {
    const note = document.createElement('span');
    note.className = 'set-layout-note';
    note.dataset.setLayoutNote = name;
    note.setAttribute('role', 'status');
    note.hidden = true;
    return note;
  },

  // Settings › Appearance › Settings layout: three rows.
  _fillLayoutSetting(host) {
    if (!host || host.childElementCount) return;
    const head = document.createElement('div');
    head.className = 'setting-toggle-row set-layout-heading';
    const title = document.createElement('span');
    title.textContent = 'Settings layout';
    head.appendChild(title);
    host.appendChild(head);
    for (const name of ['columns', 'nav', 'density']) {
      const [label, , hint] = this.LAYOUT_LABELS[name];
      const row = document.createElement('div');
      row.className = 'setting-toggle-row';
      const text = document.createElement('span');
      text.appendChild(document.createTextNode(label));
      text.appendChild(document.createElement('br'));
      const h = document.createElement('span');
      h.className = 'set-layout-hint';
      h.textContent = hint;
      text.appendChild(h);
      if (name !== 'density') text.appendChild(this._layoutNote(name));
      row.appendChild(text);
      row.appendChild(this._layoutSelect(name, label));
      host.appendChild(row);
    }
  },

  // The small layout button beside the search box, and its box of the same
  // three choices.
  _buildLayoutButton(row) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'set-layout-btn';
    btn.title = 'Settings layout';
    btn.setAttribute('aria-label', 'Settings layout');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = this._svg('sliders', 16);
    const pop = document.createElement('div');
    pop.className = 'set-layout-pop';
    pop.hidden = true;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Settings layout');
    const title = document.createElement('div');
    title.className = 'set-layout-pop-title';
    title.textContent = 'Settings layout';
    pop.appendChild(title);
    for (const name of ['columns', 'nav', 'density']) {
      const short = this.LAYOUT_LABELS[name][1];
      const field = document.createElement('label');
      field.className = 'set-layout-field';
      const t = document.createElement('span');
      t.textContent = short;
      field.appendChild(t);
      field.appendChild(this._layoutSelect(name, short));
      pop.appendChild(field);
      if (name !== 'density') pop.appendChild(this._layoutNote(name));
    }
    // Back to what Settings had: three boxes to put back one by one otherwise.
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'set-layout-reset';
    reset.textContent = 'Back to the default layout';
    reset.addEventListener('click', () => {
      SettingsUI.resetLayoutPrefs();
      pop.querySelector('select').focus();   // the button is off now
    });
    pop.appendChild(reset);
    reset.disabled = this._isDefaultLayout(this.layoutPrefs());
    const show = (on) => {
      pop.hidden = !on;
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) {
        if (typeof VexI18nUI !== 'undefined') VexI18nUI.apply();
        pop.querySelector('select').focus();
      }
    };
    btn.addEventListener('click', () => show(pop.hidden));
    pop.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      show(false);
      btn.focus();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) show(false);
    }, true);
    row.appendChild(btn);
    row.appendChild(pop);
  },

  // The notes under a choice the window is too narrow for.
  _layoutNotes(panel, prefs, cols, nav) {
    const wanted = Number(prefs.columns) || 0;
    const texts = {
      columns: wanted > cols
        ? (wanted === 3 ? 'Three' : 'Two') + ' columns need a wider window, so Settings shows ' + (cols === 2 ? 'two.' : 'one.')
        : '',
      nav: prefs.nav === 'side' && nav !== 'side' ? 'This window is too narrow for the list, so the chips are shown.' : '',
    };
    const lang = typeof VexI18nUI !== 'undefined' ? VexI18nUI.locale() : 'en';
    panel.querySelectorAll('[data-set-layout-note]').forEach((el) => {
      const text = texts[el.dataset.setLayoutNote] || '';
      if (el.dataset.note === text) return;
      el.dataset.note = text;
      el.textContent = text;
      el.hidden = !text;
      if (text && lang !== 'en') VexI18nUI.translateEl(el, lang);
    });
  },

  // The category in view is marked in the menu (aria-current): the section
  // nearest the top of the scroll area, the leftmost when two start level.
  _markCurrent(root) {
    if (!root) return null;
    const panel = root.parentElement || root;
    const nav = panel.querySelector('.set-nav');
    if (!nav) return null;
    const area = root.getBoundingClientRect();
    const top = area.top + (parseFloat(root.style.scrollPaddingTop) || 0);
    let best = null;
    let bestTop = Infinity;
    let bestLeft = Infinity;
    // A section that starts at the top of the area is the one the user was
    // taken to (a chip, a deep link). Of two columns, the other one's section
    // that began earlier and runs on under it is not: it was marked instead,
    // so clicking Downloads marked Privacy in nearly every category.
    // Two sections can start level (the first row of columns); the chip just
    // clicked says which one it was.
    const wanted = this._wanted && Date.now() < this._wanted.until ? this._wanted.key : null;
    let near = null;
    let nearGap = Infinity;
    let nearLeft = Infinity;
    for (const el of root.children) {
      if (!el.dataset || !el.dataset.navKey || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= top + 24 || r.top >= area.bottom) continue;
      if (r.top < bestTop - 1 || (Math.abs(r.top - bestTop) <= 1 && r.left < bestLeft)) { best = el; bestTop = r.top; bestLeft = r.left; }
      if (r.top < top - 4 || r.top > top + 80) continue;
      const gap = Math.abs(r.top - top);
      const asked = wanted !== null && el.dataset.navKey === wanted;
      const better = !near || (asked && near.dataset.navKey !== wanted) ||
        ((asked === (near.dataset.navKey === wanted)) && (gap < nearGap - 1 || (Math.abs(gap - nearGap) <= 1 && r.left < nearLeft)));
      if (better) { near = el; nearGap = gap; nearLeft = r.left; }
    }
    if (near) best = near;
    const key = best ? best.dataset.navKey : null;
    let current = null;
    nav.querySelectorAll('.set-nav-chip').forEach((chip) => {
      if (key && chip.dataset.navKey === key) { chip.setAttribute('aria-current', 'true'); current = chip; }
      else chip.removeAttribute('aria-current');
    });
    // The list on the left keeps the marked entry in sight.
    if (current && panel.dataset.setNav === 'side' && nav.scrollHeight > nav.clientHeight) {
      const c = current.offsetTop - nav.offsetTop;
      if (c < nav.scrollTop) nav.scrollTop = c;
      else if (c + current.offsetHeight > nav.scrollTop + nav.clientHeight) nav.scrollTop = c + current.offsetHeight - nav.clientHeight;
    }
    // Tab goes to the marked entry only; the arrows move along the rest.
    if (!nav.contains(document.activeElement)) this._rove(panel, current);
    return key;
  },

  // The list on the left is one stop for Tab, not 39 (the arrow keys move
  // along it, _navKey): the entry marked in view, or the one focused, takes
  // Tab. The chips across the top are all in the Tab order, as before.
  _rove(panel, active) {
    const nav = panel.querySelector('.set-nav');
    if (!nav) return;
    const chips = Array.from(nav.querySelectorAll('.set-nav-chip'));
    if (panel.dataset.setNav !== 'side') { chips.forEach(c => c.removeAttribute('tabindex')); return; }
    const keep = active || nav.querySelector('.set-nav-chip[aria-current="true"]') || chips.find(c => c.getClientRects().length) || chips[0];
    chips.forEach(c => { c.tabIndex = c === keep ? 0 : -1; });
  },

  // Up, Down, Home and End move along the list on the left.
  _navKey(e, panel, nav) {
    if (panel.dataset.setNav !== 'side') return false;
    const chips = Array.from(nav.querySelectorAll('.set-nav-chip')).filter(c => c.getClientRects().length);
    const i = chips.indexOf(document.activeElement);
    if (i < 0) return false;
    const to = { ArrowDown: Math.min(chips.length - 1, i + 1), ArrowUp: Math.max(0, i - 1), Home: 0, End: chips.length - 1 }[e.key];
    if (to === undefined) return false;
    e.preventDefault();
    this._rove(panel, chips[to]);
    chips[to].focus();
    return true;
  },

  // Wide windows lay the sections out side by side (the owner, 2026-10-11:
  // one 720px column in a 1876px panel, many screens of scrolling).
  // A column is never narrower than COL_MIN, so 1280px windows, and Larger and
  // Largest text (the panel is zoomed, so it has fewer CSS pixels), keep the
  // one column they had; never wider than COL_MAX, so lines stay readable.
  COL_MIN: 600,
  COL_MAX: 820,
  COL_GAP: 18,
  COL_SIDE: 32,      // the least space left and right of the columns
  ROW_UNIT: 4,       // the grid's row track, see _layout
  // How many columns fit in a scroll area this many CSS pixels wide, for the
  // user's choice (Settings layout): 'auto' as many as fit at COL_MIN; one,
  // two or three as asked, but fewer when the window cannot give each
  // COL_MIN_CHOSEN (Settings layout says so).
  columnsFor(width, choice = 'auto') {
    const avail = Number(width) - 2 * this.COL_SIDE;
    if (!(avail > 0)) return 1;
    const fits = (n, min) => n * min + (n - 1) * this.COL_GAP <= avail;
    if (choice === 'wide') return 1;
    if (choice === 'auto') {
      let n = 1;
      while (n < 3 && fits(n + 1, this.COL_MIN)) n++;
      return n;
    }
    let n = Math.min(3, Math.max(1, Number(choice) || 1));
    while (n > 1 && !fits(n, this.COL_MIN_CHOSEN)) n--;
    return n;
  },

  // Where every block goes in the columns: `items` are the blocks on screen,
  // in their order, each { rows } tall (in ROW_UNIT grid rows), `wide` for one
  // that spans every column (the heading, "No settings match"), `lead` for a
  // group's chip row, which stays in the column
  // of the section after it, right above it. Every other section goes into the
  // column that ends first (the leftmost on a tie), so they read, and Tab and
  // a screen reader go, top to bottom by where they start. Returns
  // [{ col, row, rows }], col 0 meaning every column, rows counted from 1.
  //
  // Grid auto-placement did this before, with the chip row spanning every
  // column; a spanning row starts below the longest column, so the shorter
  // ones ended in an empty band 180-420px tall above the AI sections, wider
  // in full screen (the owner, 2026-10-12: "some gaps in settings").
  placeBlocks(items, cols) {
    const n = Math.max(1, cols | 0);
    const ends = new Array(n).fill(1);   // the first free row of each column
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const rows = Math.max(1, it.rows | 0);
      if (it.wide || n === 1) {
        const row = Math.max(...ends);
        out.push({ col: n === 1 ? 1 : 0, row, rows });
        ends.fill(row + rows);
        continue;
      }
      let c = 0;
      for (let k = 1; k < n; k++) if (ends[k] < ends[c]) c = k;
      out.push({ col: c + 1, row: ends[c], rows });
      ends[c] += rows;
      const next = items[i + 1];
      if (it.lead && next && !next.wide) {
        const nrows = Math.max(1, next.rows | 0);
        out.push({ col: c + 1, row: ends[c], rows: nrows });
        ends[c] += nrows;
        i++;
      }
    }
    return out;
  },

  // Columns on, or off, for the scroll area's current width, and every block
  // put in its place (placeBlocks) with its height in grid rows. Run again
  // whenever the area or a block changes size (_watchLayout), and by the
  // search. `keepCols` (from the size observer) places the blocks for the
  // column count already in use and leaves a change of count to the next
  // frame: see _watchLayout.
  _layout(root, opts) {
    const again = this._layoutBlocks(root, opts);
    // The style written to the blocks is not a change of content to react to.
    if (this._contentObserver) this._contentObserver.takeRecords();
    return again;
  },

  _layoutBlocks(root, { keepCols = false } = {}) {
    if (!root) return false;
    // Every block watched from the moment it is there, Settings open or not
    // (opening it builds the chip rows anew). A watch started inside the size
    // observer's own callback cannot be reported in that pass, and Chromium
    // says "ResizeObserver loop completed with undelivered notifications"
    // (seen opening Settings after a look change): there it waits a frame.
    if (!this._observed) this._observed = new WeakSet();
    const kids = Array.from(root.children);
    let unwatched = false;
    if (this._blockObserver) {
      for (const el of kids) {
        if (this._observed.has(el)) continue;
        if (keepCols) { unwatched = true; continue; }
        this._observed.add(el);
        this._blockObserver.observe(el, { box: 'border-box' });
      }
    }
    // Hidden (Settings closed): nothing to measure. What it had stays, so it
    // opens again as it was, not one frame in one column first.
    if (!root.clientWidth) return unwatched;
    const panel = root.parentElement || root;
    const prefs = this.layoutPrefs();
    // The category menu first: the list on the left takes width from the
    // columns. Like a new column count, a change waits for the next frame.
    const navHad = panel.dataset.setNav === 'side' ? 'side' : 'chips';
    const navWant = this.navFor(panel.clientWidth, prefs.nav);
    if (!keepCols && navWant !== navHad) {
      if (navWant === 'side') panel.dataset.setNav = 'side';
      else delete panel.dataset.setNav;
      this._syncPad(root);
      this._rove(panel);
    }
    const nav = keepCols ? navHad : navWant;
    const want = this.columnsFor(root.clientWidth, prefs.columns);
    const had = Number(panel.dataset.setCols) || 1;
    const cols = keepCols ? had : want;
    // Said before the heights are read: a note changes its section's height.
    if (!keepCols) this._layoutNotes(panel, prefs, cols, nav);
    const again = want !== cols || navWant !== nav || unwatched;
    if (cols > 1) {
      panel.dataset.setCols = String(cols);
      panel.style.setProperty('--set-cols', String(cols));
      panel.style.setProperty('--set-grid-max', (cols * this.COL_MAX + (cols - 1) * this.COL_GAP) + 'px');
    } else {
      delete panel.dataset.setCols;
      panel.style.removeProperty('--set-cols');
      panel.style.removeProperty('--set-grid-max');
    }
    // A new count: off with the old places first. A block still in column 3
    // of a grid now two wide sits in a column of its own, measures at the
    // wrong width, and its height is wrong.
    if (cols === 1 || cols !== had) {
      for (const el of kids) { el.style.removeProperty('grid-row'); el.style.removeProperty('grid-column'); }
      if (cols === 1) return again;
    }
    // A grid row as it is drawn. Under Larger text (the panel's zoom) a 4px
    // row is 5.2 screen pixels, and Chromium draws it in 1/64ths, rounded
    // down: 5.1875. Counted as 4px, AI Personas (1285 rows) came out 16px
    // short and its last line ran into the next section.
    // The zoom itself, from the style: the ratio of the box to offsetWidth
    // (a whole number) said 1.4997 for the 1.5 of Largest, a row of 3.9905px
    // instead of 4, and a 4500px section took 6 rows too many (35-40px gaps
    // under Largest text).
    let zoom = 1;
    for (let el = root; el && el.nodeType === 1; el = el.parentElement) {
      const z = parseFloat(getComputedStyle(el).zoom);
      if (z > 0) zoom *= z;
    }
    const pitch = Math.floor(this.ROW_UNIT * zoom * 64) / 64 / zoom;
    // Every height first, then every place: one layout pass, not one a block.
    const shown = [];
    const items = [];
    for (const el of kids) {
      if (!el.getClientRects().length) continue;   // hidden: no grid area
      const cs = getComputedStyle(el);
      const h = el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
      shown.push(el);
      items.push({
        rows: Math.max(1, Math.ceil(h / pitch)),
        lead: el.classList.contains('set-subnav'),
        // Show advanced settings ends the list in the column that ends first:
        // across every column, it left the same empty band under the others.
        wide: !el.classList.contains('setting-group') && !el.classList.contains('set-subnav') && !el.classList.contains('set-advanced-toggle'),
      });
    }
    const at = this.placeBlocks(items, cols);
    shown.forEach((el, i) => {
      el.style.gridColumn = at[i].col ? String(at[i].col) : '1 / -1';
      el.style.gridRow = at[i].row + ' / span ' + at[i].rows;
    });
    return again;
  },

  // Watch the scroll area's width, and every block's size, once.
  //
  // The scroll area's own observer places the blocks again in the same frame,
  // before it is painted. It used to wait for the next frame, and a change
  // that takes long to restyle (Larger text, full screen) painted one or two
  // frames, 300ms, with every block at its old height: 15-28 blocks over each
  // other and gaps of thousands of pixels. Placing blocks changes no size of
  // the area, so it is safe inside that observer.
  //
  // A block's own size is another matter: put in a new place inside an
  // observer that reports only blocks, its size is at the depth already
  // delivered, and Chromium says "ResizeObserver loop completed with
  // undelivered notifications" (an error Vex records; seen opening Settings
  // after a look change). So a block's change, a new column count (which
  // changes every block's width) and a block not yet watched all wait for
  // the next frame, from a second observer.
  _watchLayout(root) {
    if (this._layoutWatched === root || typeof ResizeObserver === 'undefined') { this._layout(root); return; }
    this._layoutWatched = root;
    let pending = false;
    const recount = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; SettingsUI._layout(root); });
    };
    this._blockObserver = new ResizeObserver(recount);
    this._sizeObserver = new ResizeObserver(() => {
      if (SettingsUI._layout(root, { keepCols: true })) recount();
    });
    // Its border box: the toolbar's observer sets its padding-top (_syncPad),
    // which is no reason to lay out again.
    this._sizeObserver.observe(root, { box: 'border-box' });
    // A section whose content is changed by script (the local models list
    // arriving after "Reading the models...", a row added, a group opened)
    // is placed again in the same task, before anything is drawn. The block
    // observer above only hears of it after layout and waits a frame, which
    // painted one frame, sometimes more on a busy machine, with that section
    // over the next one or 1000px of empty space under it (check:ui caught
    // it as a gap above AI Memory, one run in three). A mutation callback
    // runs as a microtask and is outside Chromium's ResizeObserver loop, so
    // it may place blocks (measured: the same placement inside the block
    // observer's own callback reported the loop error).
    if (typeof MutationObserver !== 'undefined') {
      this._contentObserver = new MutationObserver(() => {
        if (SettingsUI._layout(root, { keepCols: true })) recount();
      });
      this._contentObserver.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'open', 'style'] });
    }
    this._layout(root);
  },

  // The wheel anywhere over Settings scrolls it: the search box and the chips
  // sit in a pinned toolbar outside the scroll area, so the wheel there scrolled
  // nothing (the owner, 2026-10-11). A scroll box inside the toolbar that can
  // still scroll that way (the one-row chip nav in a short window) keeps it.
  _wheelToArea(e, area) {
    if (e.defaultPrevented || e.ctrlKey || !area) return false;   // Ctrl+wheel zooms
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * area.clientHeight : e.deltaY;
    if (!dy) return false;
    for (let el = e.target; el && el !== e.currentTarget && el.nodeType === 1; el = el.parentElement) {
      if (this._keepsWheel(el, dy)) return false;
    }
    area.scrollTop += dy;
    e.preventDefault();
    return true;
  },
  _keepsWheel(el, dy) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight) return false;
    // A box that does not hand the wheel on keeps it even at its end.
    if (cs.overscrollBehaviorY === 'contain' || cs.overscrollBehaviorY === 'none') return true;
    return dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  },

  // Match the scroll area's top padding + scroll-padding to the toolbar height.
  _syncPad(root) {
    if (!root) return;
    const panel = root.parentElement || root;
    const tb = panel.querySelector('.set-toolbar');
    if (!tb) return;
    // With the category list on the left the toolbar is beside the scroll
    // area, not over it: the stylesheet's own padding stands.
    if (panel.dataset.setNav === 'side') {
      root.style.removeProperty('padding-top');
      root.style.scrollPaddingTop = '16px';
      return;
    }
    const h = (tb.offsetHeight || 88) + 8;
    root.style.paddingTop = h + 'px';
    root.style.scrollPaddingTop = h + 'px';
  },

  // Deep link into a settings sub-section: open the Settings panel, scroll the
  // element with the given id into view and flash it briefly. Retries over a
  // few animation frames instead of a timing-sensitive setTimeout — the settings
  // markup is static, so the element normally exists on the first frame.
  openSection(anchorId) {
    if (!anchorId) return;
    const mgr = (typeof SidebarManager !== 'undefined') ? SidebarManager : window.SidebarManager;
    if (mgr && typeof mgr.openPanel === 'function') mgr.openPanel('settings');
    else if (mgr && typeof mgr.showPanel === 'function') mgr.showPanel('settings');
    else if (typeof window.openPanel === 'function') window.openPanel('settings');
    let tries = 0;
    const attempt = () => {
      const el = document.getElementById(anchorId);
      if (el) {
        // A search left in the box hides every section that does not match
        // it, the one linked to included: the link did nothing. Clear it.
        const hiddenBy = el.closest('.setting-group');
        if (hiddenBy && hiddenBy.style.display === 'none') {
          const root = hiddenBy.closest('.settings-content');
          const box = root && (root.parentElement || root).querySelector('.set-search');
          if (box) { box.value = ''; SettingsUI._filter(root, ''); }
        }
        // A link into an advanced section opens it even in Simple mode.
        SettingsUI.reveal(el);
        // Instantly, and again while the layout settles: a smooth scroll was
        // cut short as the panels above rendered and pushed the section down,
        // stopping well before it (found 2026-09-29). Any touch of the scroll
        // area by the user ends the re-scrolling.
        el.scrollIntoView({ block: 'start' });
        const area = el.closest('.settings-content') || el.parentElement;
        if (area && typeof ResizeObserver !== 'undefined') {
          const again = new ResizeObserver(() => el.scrollIntoView({ block: 'start' }));
          again.observe(area);
          for (const child of area.children) again.observe(child);
          const stop = () => {
            again.disconnect();
            area.removeEventListener('wheel', stop);
            area.removeEventListener('pointerdown', stop);
            area.removeEventListener('keydown', stop);
          };
          area.addEventListener('wheel', stop, { passive: true });
          area.addEventListener('pointerdown', stop);
          area.addEventListener('keydown', stop);
          setTimeout(stop, 1500);
        }
        el.classList.remove('settings-anchor-flash');
        void el.offsetWidth; // restart the animation if it was already running
        el.classList.add('settings-anchor-flash');
        setTimeout(() => el.classList.remove('settings-anchor-flash'), 1300);
      } else if (++tries < 10) {
        requestAnimationFrame(attempt);
      }
    };
    requestAnimationFrame(attempt);
  },
};

if (typeof window !== 'undefined') window.SettingsUI = SettingsUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { SettingsUI };
