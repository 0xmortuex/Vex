// === Ctrl+Tab by recency (T1-014) ============================================
//
// Ctrl+Tab walked the strip left to right. What you want is "the tab I was on
// before this one, and the one before that": the order you USED them in. While
// Ctrl is held, a list of the tabs in that order is shown and each Ctrl+Tab
// (Ctrl+Shift+Tab goes back up) moves the selection; letting go of Ctrl goes
// to the selected tab, Escape stays where you are.
//
// The keys are read in the main process (src/main/mru-keys.js), because the
// release of Ctrl never reaches this window while a web page has the focus. It
// sends { kind: 'step' | 'commit' | 'cancel' } over tabs:mru-key and this file
// draws the list and does the switch. Nothing is switched while you cycle, so
// walking through four tabs leaves the order of the others alone.
//
// Off, Ctrl+Tab is the strip-order walk it always was. The switch is
// "Ctrl+Tab by recency" in Settings; the main process is told whenever it
// changes (setMruKeys) and at start.
const VexTabMru = {
  KEY: 'vex.tabMru',               // '0' = off; anything else (or nothing) = on
  AUTO_COMMIT_MS: 10 * 1000,       // a lost key-up must not leave the list up
  MAX_ROWS: 9,
  THUMB_WIDTH: 280,
  THUMB_DELAY_MS: 250,

  _session: null,                  // { order: Tab[], idx, timer, thumbTimer }
  _el: null,

  enabled() { return localStorage.getItem(this.KEY) !== '0'; },
  setEnabled(on) {
    localStorage.setItem(this.KEY, on ? '1' : '0');
    this.syncMain();
    if (!on) this.cancel();
  },

  // Whether the main process answers the key this registry action is bound to (Ctrl+Tab for
  // next-tab, Ctrl+Shift+Tab for prev-tab, as they come). Main steps the list and lets the key-down
  // reach this window as well, so the registry's own handler must do nothing for it.
  takes(actionId) {
    if (!this.enabled()) return false;
    if (typeof ShortcutsRegistry === 'undefined') return false;
    const combo = ShortcutsRegistry.getShortcut(actionId);
    return combo === 'Ctrl+Tab' || combo === 'Ctrl+Shift+Tab';
  },

  // Main owns the keys, so it has to know whether they are Vex's.
  syncMain() {
    if (!window.vex || typeof window.vex.setMruKeys !== 'function') throw new Error('Ctrl+Tab by recency needs the window bridge (setMruKeys)');
    window.vex.setMruKeys(this.enabled());
  },

  // ---- the order ---------------------------------------------------------------
  // The tabs, most recently used first, the one in front always first. A tab
  // never used since Vex started has no time and goes last, in strip order.
  // `tabs` are in strip order (TabManager.displayOrder()).
  order(tabs, activeId) {
    const list = tabs.map((tab, at) => ({ tab, at }));
    list.sort((a, b) => {
      if (a.tab.id === activeId) return -1;
      if (b.tab.id === activeId) return 1;
      const d = (b.tab.lastViewedAt || 0) - (a.tab.lastViewedAt || 0);
      return d || a.at - b.at;
    });
    return list.map(e => e.tab);
  },

  // The tabs as the strip draws them, then ordered. Used by Ctrl+Tab and by the tab search.
  list() {
    if (typeof TabManager === 'undefined') throw new Error('TabManager is not loaded');
    return this.order(TabManager.displayOrder(), TabManager.activeTabId);
  },

  // What a row shows for a tab.
  describe(tab) {
    let host = '';
    const url = String(tab.url || '');
    if (/^vex:\/\/start\b/i.test(url) || /\/renderer\/start\.html(?:[?#]|$)/i.test(url)) host = 'New Tab';
    else { try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = url.slice(0, 60); } }
    let group = '';
    if (tab.groupId && typeof TabManager !== 'undefined') {
      const g = (TabManager.groups || []).find(x => x.id === tab.groupId);
      if (g) group = g.name || g.title || '';
    }
    return {
      id: tab.id,
      title: tab.title || host || 'New Tab',
      host,
      url,
      favicon: tab.favicon || '',
      pinned: !!tab.pinned,
      sleeping: !!tab.sleeping,
      audible: !!tab.audible && !tab.muted,
      muted: !!tab.muted,
      group,
    };
  },

  // ---- the cycle -----------------------------------------------------------------
  onKey(msg) {
    if (!msg || typeof msg !== 'object') throw new Error('A Ctrl+Tab message has to be an object');
    if (msg.kind === 'step') {
      if (msg.dir !== 1 && msg.dir !== -1) throw new Error('A Ctrl+Tab step goes forward (1) or back (-1), not ' + msg.dir);
      this.step(msg.dir);
    } else if (msg.kind === 'commit') this.commit();
    else if (msg.kind === 'cancel') this.cancel();
    else throw new Error('Unknown Ctrl+Tab message: ' + msg.kind);
  },

  step(dir) {
    if (!this._session) {
      const order = this.list();
      if (order.length < 2) return false;
      this._session = { order, idx: 0, timer: null, thumbTimer: null };
    }
    const s = this._session;
    s.idx = (s.idx + dir + s.order.length) % s.order.length;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => this.commit(), this.AUTO_COMMIT_MS);
    this._render();
    return true;
  },

  selected() { return this._session ? this._session.order[this._session.idx] : null; },

  commit() {
    const s = this._session;
    if (!s) return null;
    const target = s.order[s.idx];
    this._end();
    if (!target || target.id === TabManager.activeTabId) return null;
    // The tab may have been closed while the list was up.
    if (!TabManager.tabs.some(t => t.id === target.id)) return null;
    TabManager.switchTab(target.id);
    return target;
  },

  cancel() { if (this._session) this._end(); },

  _end() {
    const s = this._session;
    this._session = null;
    if (s) { clearTimeout(s.timer); clearTimeout(s.thumbTimer); }
    if (this._el) this._el.remove();
    this._el = null;
  },

  // ---- drawing -------------------------------------------------------------------
  _icon(name, size = 13) { return typeof VexIcons !== 'undefined' && VexIcons.has(name) ? VexIcons.svg(name, { size }) : ''; },

  _render() {
    const s = this._session;
    if (!s) return;
    if (!this._el) {
      const el = document.createElement('div');
      el.id = 'tab-mru';
      el.className = 'tt-overlay tt-mru';
      el.innerHTML = '<div class="tt-card" role="listbox" aria-label="Recently used tabs"><div class="tt-thumb" aria-hidden="true"></div><ul class="tt-list"></ul><div class="tt-hint">Ctrl+Tab goes on, Ctrl+Shift+Tab back, let go of Ctrl to switch, Esc to stay</div></div><div class="tt-sr" role="status" aria-live="polite"></div>';
      document.body.appendChild(el);
      this._el = el;
    }
    const list = this._el.querySelector('.tt-list');
    list.textContent = '';
    // A window of rows around the selection: with forty tabs the list does not need to be forty tall.
    const n = s.order.length;
    const rows = Math.min(n, this.MAX_ROWS);
    let from = Math.max(0, Math.min(s.idx - Math.floor(rows / 2), n - rows));
    for (let i = from; i < from + rows; i++) {
      const d = this.describe(s.order[i]);
      const li = document.createElement('li');
      li.className = 'tt-row' + (i === s.idx ? ' selected' : '');
      li.id = 'tab-mru-row-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === s.idx ? 'true' : 'false');
      li.dataset.tabId = d.id;
      const fav = document.createElement('span');
      fav.className = 'tt-fav';
      if (d.favicon && /^(https?:|data:image\/)/i.test(d.favicon)) {
        const img = document.createElement('img');
        img.src = d.favicon; img.alt = ''; img.width = 16; img.height = 16;
        fav.appendChild(img);
      }
      const text = document.createElement('span');
      text.className = 'tt-text';
      const title = document.createElement('span'); title.className = 'tt-title'; title.textContent = d.title;
      const sub = document.createElement('span'); sub.className = 'tt-sub'; sub.textContent = d.group ? d.group + ' · ' + d.host : d.host;
      text.append(title, sub);
      const flags = document.createElement('span');
      flags.className = 'tt-flags';
      flags.innerHTML = (d.pinned ? this._icon('pin') : '') + (d.sleeping ? this._icon('sleep') : '') + (d.audible ? this._icon('volume') : '') + (d.muted ? this._icon('mute') : '');
      li.append(fav, text, flags);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); s.idx = i; this.commit(); });
      list.appendChild(li);
    }
    const card = this._el.querySelector('.tt-card');
    card.setAttribute('aria-activedescendant', 'tab-mru-row-' + s.idx);
    const sel = this.describe(s.order[s.idx]);
    this._el.querySelector('.tt-sr').textContent = sel.title + ', ' + (s.idx + 1) + ' of ' + n;
    this._thumbLater(s, s.order[s.idx]);
  },

  // The picture of the selected page, once the selection has rested a moment.
  _thumbLater(s, tab) {
    clearTimeout(s.thumbTimer);
    const box = this._el.querySelector('.tt-thumb');
    box.textContent = '';
    box.classList.remove('has-image');
    if (tab.sleeping || tab._lazy || typeof WebviewManager === 'undefined' || !WebviewManager.webviews) return;
    const wv = WebviewManager.webviews.get(tab.id);
    if (!wv || !wv._attached || typeof wv.capturePage !== 'function') return;
    s.thumbTimer = setTimeout(() => {
      Promise.resolve(wv.capturePage()).then((img) => {
        if (this._session !== s || s.order[s.idx] !== tab || !img || (typeof img.isEmpty === 'function' && img.isEmpty())) return;
        const el = document.createElement('img');
        el.alt = '';
        el.src = img.resize({ width: this.THUMB_WIDTH }).toDataURL();
        box.textContent = '';
        box.appendChild(el);
        box.classList.add('has-image');
      }).catch((err) => {
        if (typeof VexProblems !== 'undefined') VexProblems.note('Tabs', 'Could not take the picture of a tab for Ctrl+Tab', err);
        else console.error('[TabMru] no picture:', err);
      });
    }, this.THUMB_DELAY_MS);
  },

  init() {
    if (!window.vex || typeof window.vex.onMruKey !== 'function') throw new Error('Ctrl+Tab by recency needs the window bridge (onMruKey)');
    window.vex.onMruKey((msg) => {
      try { this.onKey(msg); }
      catch (err) {
        this._end();
        if (typeof VexProblems !== 'undefined') VexProblems.note('Tabs', 'Ctrl+Tab by recency failed', err);
        else console.error('[TabMru]', err);
      }
    });
    this.syncMain();
  },
};

if (typeof window !== 'undefined') window.VexTabMru = VexTabMru;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTabMru };
