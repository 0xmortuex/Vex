// === Search bangs for docs, packages and games ===============================
//
// "!npm zod" or "zod !npm" in the address bar or Ctrl+K opens npm's own search
// for zod. The bang is looked up HERE, in a table on this computer, so the words
// you typed go straight to npm and not through DuckDuckGo first. A bang that is
// not in the table (!yt, !a ...) still goes to DuckDuckGo as before.
//
// The table has built-in rows (docs, package registries, wikis, game stores) and
// your own: add a row, change where a built-in one goes, remove it. "!gh owner/repo"
// opens that repository; "!gh something else" searches GitHub.
//
// js/search-shortcuts.js asks resolve() before it falls back to DuckDuckGo, so
// the address bar, Ctrl+K and the New Tab box all agree (js/typed-address.js).
//
// What is kept (this computer only): your rows in vex.searchBangs, and the switch
// in vex.searchBangs.enabled. Nothing is sent anywhere but the page you open.
//
// A shorter word after three uses (T1-005): when you submit the same bang three times
// within a week, one line waits in the Attention Inbox offering a short word of your own
// ("!n" for "!npm") that goes to the same place. The button adds that row to your table;
// nothing is added by itself. The uses are counted from what you SUBMIT (noteUse, called
// by the address bar), not from what you type, and only their times are kept.
const VexBangs = {
  KEY: 'vex.searchBangs',
  ENABLED_KEY: 'vex.searchBangs.enabled',
  USES_KEY: 'vex.searchBangs.uses',
  OFFERED_KEY: 'vex.searchBangs.offered',
  USES_NEEDED: 3,
  USES_WINDOW_MS: 7 * 24 * 3600 * 1000,
  NAME: /^[a-z0-9][a-z0-9._-]{0,15}$/,
  MAX_USER: 60,

  // bang -> { name, url } ; %s is where the (encoded) words go.
  BUILTINS: {
    npm:     { name: 'npm', url: 'https://www.npmjs.com/search?q=%s' },
    mdn:     { name: 'MDN', url: 'https://developer.mozilla.org/en-US/search?q=%s' },
    gh:      { name: 'GitHub', url: 'https://github.com/search?q=%s&type=repositories' },
    pypi:    { name: 'PyPI', url: 'https://pypi.org/search/?q=%s' },
    crates:  { name: 'crates.io', url: 'https://crates.io/search?q=%s' },
    docsrs:  { name: 'docs.rs', url: 'https://docs.rs/releases/search?query=%s' },
    wiki:    { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s' },
    osdev:   { name: 'OSDev wiki', url: 'https://wiki.osdev.org/index.php?search=%s' },
    modrinth: { name: 'Modrinth', url: 'https://modrinth.com/mods?q=%s' },
    steam:   { name: 'Steam', url: 'https://store.steampowered.com/search/?term=%s' },
    mcwiki:  { name: 'Minecraft Wiki', url: 'https://minecraft.wiki/?search=%s' },
    rbx:     { name: 'Roblox docs', url: 'https://www.google.com/search?q=site%3Acreate.roblox.com%2Fdocs+%s' },
  },

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) !== 'false'; }
    catch (err) { console.error('[Bangs] the switch could not be read:', err); return true; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); this.registerCommands(); },

  // ---- the table ------------------------------------------------------------------
  // Your rows: { bang: "https://site/?q=%s" }. Throws when the list is not readable,
  // so a change can never write an empty list over it.
  _userStrict() {
    const raw = localStorage.getItem(this.KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Your search bangs are not readable, so they were not changed');
    return obj;
  },
  user() {
    try { return this._userStrict(); }
    catch (err) { console.error('[Bangs] your bangs could not be read, the built-in ones are used:', err.message); return {}; }
  },

  // Every row as shown: [{ bang, name, url, builtin, changed }]
  table() {
    const mine = this.user();
    const out = [];
    for (const [bang, b] of Object.entries(this.BUILTINS)) {
      const own = typeof mine[bang] === 'string' && mine[bang].includes('%s');
      out.push({ bang, name: b.name, url: own ? mine[bang] : b.url, builtin: true, changed: own });
    }
    for (const [bang, url] of Object.entries(mine)) {
      if (this.BUILTINS[bang] || typeof url !== 'string' || !url.includes('%s')) continue;
      out.push({ bang, name: bang, url, builtin: false, changed: false });
    }
    return out;
  },
  lookup(word) {
    const w = String(word == null ? '' : word).trim().toLowerCase().replace(/^!/, '');
    return this.table().find(r => r.bang === w) || null;
  },

  check(bang, url) {
    const b = String(bang == null ? '' : bang).trim().toLowerCase().replace(/^!/, '');
    if (!this.NAME.test(b)) throw new Error('A bang is one short word of letters, digits, dots or dashes, with no spaces');
    const addr = String(url == null ? '' : url).trim();
    if (!/^https?:\/\/[^\s]+$/i.test(addr)) throw new Error('The address must start with https:// (or http://)');
    if (addr.split('%s').length !== 2) throw new Error('Put %s once in the address, where the words you type go');
    return { bang: b, url: addr };
  },
  set(bang, url) {
    const c = this.check(bang, url);
    const all = this._userStrict();
    if (!(c.bang in all) && Object.keys(all).length >= this.MAX_USER) throw new Error('At most ' + this.MAX_USER + ' bangs of your own - remove one first');
    all[c.bang] = c.url;
    localStorage.setItem(this.KEY, JSON.stringify(all));
    this.registerCommands();
    return c.bang;
  },
  // A built-in row goes back to its original address; one of yours is deleted.
  remove(bang) {
    const all = this._userStrict();
    delete all[String(bang || '').toLowerCase()];
    localStorage.setItem(this.KEY, JSON.stringify(all));
    this.registerCommands();
  },

  // ---- resolving a typed line ---------------------------------------------------------
  // "!npm zod", "zod !npm" -> { url, name, query, bang }, or null when the line has no
  // bang this table knows (or there are no words to search for).
  resolve(text) {
    if (!this.enabled()) return null;
    const val = String(text == null ? '' : text).trim();
    if (!val || val.length > 500) return null;
    let m = /^!([a-z0-9][a-z0-9._-]*)\s+(.+)$/i.exec(val);
    let word, query;
    if (m) { word = m[1]; query = m[2]; } else {
      m = /^(.+?)\s+!([a-z0-9][a-z0-9._-]*)$/i.exec(val);
      if (!m) return null;
      word = m[2]; query = m[1];
    }
    query = query.trim();
    const row = this.lookup(word);
    if (!row || !query) return null;
    // "!gh owner/repo" is that repository.
    if (row.bang === 'gh' && !row.changed && /^[\w.-]+\/[\w.-]+$/.test(query)) {
      return { url: 'https://github.com/' + query, name: 'GitHub', query, bang: row.bang };
    }
    return { url: row.url.replace('%s', encodeURIComponent(query)), name: row.name, query, bang: row.bang };
  },

  // ---- the short word offer (T1-005) -----------------------------------------------------------
  _json(key, fallback) {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') throw new Error(key + ' is not readable');
    return v;
  },
  // A short word for a bang that is free: its first letter, then its first two, then a digit.
  suggestAlias(bang) {
    const taken = new Set(this.table().map(r => r.bang));
    const b = String(bang || '').toLowerCase();
    const tries = [b.slice(0, 1), b.slice(0, 2), b.slice(0, 1) + '1', b.slice(0, 1) + '2'];
    return tries.find(w => w && w.length < b.length && !taken.has(w) && this.NAME.test(w)) || null;
  },
  // A line was submitted: count it when it used a bang of the table. On the third time in a week
  // one Attention Inbox row offers a short word, once per bang. -> the alias offered, or null.
  noteUse(text, now = Date.now()) {
    if (!this.enabled()) return null;
    const hit = this.resolve(text);
    if (!hit) return null;
    const uses = this._json(this.USES_KEY, {});
    const fresh = (Array.isArray(uses[hit.bang]) ? uses[hit.bang] : []).filter(t => now - t < this.USES_WINDOW_MS);
    fresh.push(now);
    uses[hit.bang] = fresh.slice(-10);
    localStorage.setItem(this.USES_KEY, JSON.stringify(uses));
    if (fresh.length < this.USES_NEEDED) return null;
    const offered = this._json(this.OFFERED_KEY, {});
    if (offered[hit.bang]) return null;
    const alias = this.suggestAlias(hit.bang);
    if (!alias) return null;
    if (typeof VexAttention === 'undefined') throw new Error('VexAttention is not loaded, so the short word cannot be offered');
    offered[hit.bang] = now;
    localStorage.setItem(this.OFFERED_KEY, JSON.stringify(offered));
    VexAttention.suggest({
      feature: 'search-bangs', id: 'alias:' + hit.bang, label: 'Search bangs',
      title: 'You used !' + hit.bang + ' ' + fresh.length + ' times this week',
      body: 'Add !' + alias + ' as a shorter word for it? It goes to ' + hit.name + ' like !' + hit.bang + ' does.',
      action: { label: 'Add !' + alias, key: 'alias:' + hit.bang + ':' + alias },
    });
    return alias;
  },
  // The inbox button.
  takeAlias(key) {
    const m = /^alias:([a-z0-9._-]+):([a-z0-9._-]+)$/.exec(String(key || ''));
    if (!m) throw new Error('That is not a short word offer');
    const row = this.lookup(m[1]);
    if (!row) throw new Error('!' + m[1] + ' is no longer in your table');
    this.set(m[2], row.url);
    window.showToast?.('!' + m[2] + ' now searches ' + row.name);
    return m[2];
  },

  // ---- pack-compatible data ------------------------------------------------------------
  // The shape of an "aliases" item in a plugin pack (src/main/packs.js): each word runs
  // the Ctrl+K command bang:<word>, which asks what to search for. So a pack can ship
  // these as shortcut words.
  packAliases() {
    return {
      type: 'aliases', name: 'Docs, package and game bangs',
      entries: this.table().filter(r => this.NAME.test(r.bang)).slice(0, 50).map(r => ({ word: r.bang, command: 'bang:' + r.bang })),
    };
  },

  // ---- Ctrl+K: "Search npm" asks for the words, then opens the page --------------------
  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    const list = this.enabled() ? this.table().map(r => ({
      id: 'bang:' + r.bang, label: 'Search ' + r.name, icon: 'search', hint: '!' + r.bang + ' words, in the address bar too',
      action: async () => {
        const q = await window.vexPrompt({ title: 'Search ' + r.name, label: 'What to search for' });
        if (q == null || !String(q).trim()) return;
        const hit = this.resolve('!' + r.bang + ' ' + String(q).trim());
        if (!hit) throw new Error('That bang could not be resolved');
        TabManager.createTab(hit.url, true);
      },
    })) : [];
    VexModuleCommands.set('bang:', list);
    return true;
  },

  // ---- Settings -----------------------------------------------------------------------
  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('Type !npm zod (or zod !npm) in the address bar or Ctrl+K and npm\'s own search opens. The table is on this computer; a bang not in it still goes to DuckDuckGo.'));
    body.appendChild(S.toggle('Search bangs', this.enabled(), (on) => {
      this.setEnabled(on);
      if (typeof VexUsage !== 'undefined') VexUsage.touch('search-bangs');
    }));
    const list = document.createElement('div');
    for (const r of this.table()) {
      const row = document.createElement('div');
      row.className = 'setting-toggle-row';
      const label = document.createElement('span');
      const code = document.createElement('code');
      code.textContent = '!' + r.bang;
      label.append(code, ' ' + r.name + (r.changed ? ' (yours)' : '') + ' - ' + r.url);
      row.appendChild(label);
      if (!r.builtin || r.changed) {
        row.appendChild(S.button(r.builtin ? 'Reset' : 'Remove', () => {
          try { this.remove(r.bang); window.VexSettingsGroups?.inject(); } catch (err) { window.showToast?.(err.message, 'error'); }
        }));
      }
      list.appendChild(row);
    }
    body.appendChild(list);
    const add = async () => {
      const bang = await window.vexPrompt({ title: 'Add a search bang', message: 'One short word, typed after an exclamation mark. Typing the name of a built-in bang changes where it goes.', label: 'Bang', placeholder: 'jira' });
      if (bang == null) return;
      const url = await window.vexPrompt({ title: 'Where !' + String(bang).trim().replace(/^!/, '') + ' searches', message: 'The site\'s search address, with %s where your words go.', label: 'Address', placeholder: 'https://example.com/search?q=%s' });
      if (url == null) return;
      const saved = this.set(bang, url);
      window.showToast?.('Type "!' + saved + ' something" in the address bar to search there');
      window.VexSettingsGroups?.inject();
    };
    body.appendChild(S.button('Add a bang...', () => { add().catch(err => window.showToast?.(err.message, 'error')); }));
    body.appendChild(S.button('Copy as plugin pack data', async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(this.packAliases(), null, 2)); window.showToast?.('Copied the bangs as a pack "aliases" item'); }
      catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); }
    }));
  },
};

if (typeof window !== 'undefined') {
  window.VexBangs = VexBangs;
  VexBangs.registerCommands();
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle('search-bangs', (key) => { try { VexBangs.takeAlias(key); } catch (err) { window.showToast?.(err.message, 'error'); } });
    }
  });
  document.addEventListener('DOMContentLoaded', () => VexBangs.registerCommands());
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBangs };
