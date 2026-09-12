// === Vex Focus Mode + Compact Mode ===
//
// FocusMode: one command hides ALL chrome (sidebars, topbar slims) and can
// run a Pomodoro-style timer during which distracting sites are blocked —
// navigations to blocked hosts get bounced back with a toast. Blocklist is
// editable in Settings → Focus.
// CompactMode: a lighter, permanent space-saver — collapses the two sidebars
// only. Both are body classes styled in extras.css and live in the command bar.

const FocusMode = {
  KEY: 'vex.focusBlocklist',
  active: false,
  until: 0,
  _timer: null,

  // The sites Vex blocks until you have said otherwise. These are a starting
  // point, not a floor: an explicitly saved list replaces them entirely, and an
  // explicitly saved EMPTY list means "block nothing" — which is why the panel
  // both says so out loud and keeps a Restore defaults button. Before that,
  // emptying the box looked like a no-op and silently retired the defaults with
  // no way back short of editing storage by hand.
  DEFAULTS: ['youtube.com', 'tiktok.com', 'instagram.com', 'x.com', 'twitter.com', 'reddit.com'],

  blocklist() {
    try {
      const a = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      if (Array.isArray(a)) return a.filter(s => typeof s === 'string' && s);
    } catch {}
    return this.DEFAULTS.slice();
  },

  // True when the user has saved a list of their own (so the defaults no longer
  // apply), false while Vex is still using the built-in list.
  isCustom() {
    try { return Array.isArray(JSON.parse(localStorage.getItem(this.KEY) || 'null')); } catch { return false; }
  },

  // Returns false when the list could not be written — the caller must not
  // claim it saved.
  saveBlocklist(arr) {
    try { localStorage.setItem(this.KEY, JSON.stringify(arr)); } catch { return false; }
    return true;
  },

  // Put the built-in list back. Returns false if storage refused the write.
  restoreDefaults() {
    try { localStorage.removeItem(this.KEY); } catch { return false; }
    return !this.isCustom();
  },

  toggle(minutes) {
    if (this.active) this.stop();
    else this.start(minutes || 25);
  },

  start(minutes) {
    this.active = true;
    this.until = Date.now() + minutes * 60 * 1000;
    document.body.classList.add('focus-mode');
    // Don't promise blocking we are not doing — an emptied blocklist blocks nothing.
    const blocked = this.blocklist().length;
    window.showToast?.(blocked
      ? `Focus for ${minutes} min — ${blocked} distracting site${blocked === 1 ? '' : 's'} blocked. Ctrl+K → "Focus" to end early.`
      : `Focus for ${minutes} min — your blocklist is empty, so nothing is blocked. Ctrl+K → "Focus" to end early.`);
    clearInterval(this._timer);
    this._timer = setInterval(() => {
      if (Date.now() >= this.until) { this.stop(); window.showToast?.('Focus session complete'); }
    }, 5000);
  },

  stop() {
    this.active = false;
    document.body.classList.remove('focus-mode');
    clearInterval(this._timer);
    this._timer = null;
  },

  // Called from webview will-navigate/did-navigate wiring. Returns true if blocked.
  shouldBlock(url) {
    if (!this.active) return false;
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return false; }
    return this.blocklist().some(b => host === b || host.endsWith('.' + b));
  },

  guard(webview, url) {
    if (!this.shouldBlock(url)) return false;
    const mins = Math.max(1, Math.ceil((this.until - Date.now()) / 60000));
    window.showToast?.(`Blocked during focus (${mins} min left)`);
    try { if (webview.canGoBack()) webview.goBack(); else webview.loadURL(typeof START_URL !== 'undefined' ? START_URL : 'about:blank'); } catch {}
    return true;
  },

  renderPanel(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(s);
    const current = this.blocklist();
    const custom = this.isCustom();
    const btn = (bg, color) => `padding:8px 16px;background:${bg};color:${color};border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px`;
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:10px">Sites blocked while a focus session is running (<kbd>Ctrl</kbd>+<kbd>K</kbd> → "Focus 25"). One per line.</p>
      <textarea id="focus-blocklist" rows="5" spellcheck="false" style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12.5px;outline:none;resize:vertical;font-family:'JetBrains Mono',monospace">${esc(current.join('\n'))}</textarea>
      <div id="focus-state" class="setting-info muted" style="margin-top:8px;display:flex;align-items:center;gap:6px"></div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        <button id="focus-save" style="${btn('var(--primary)', '#fff')};border-color:transparent">Save blocklist</button>
        <button id="focus-restore" style="${btn('var(--bg)', 'var(--text)')}"${custom ? '' : ' disabled'}>Restore defaults</button>
      </div>`;

    const state = container.querySelector('#focus-state');
    const paintState = () => {
      const list = this.blocklist();
      const warn = !list.length;
      state.style.color = warn ? 'var(--danger, #e5484d)' : '';
      state.innerHTML = warn
        ? `${window.VexIcons?.svg('warning', { size: 13 }) || ''}<span>The list is empty — a focus session will not block anything.</span>`
        : `<span>${list.length} site${list.length === 1 ? '' : 's'} blocked during a focus session${this.isCustom() ? '' : " (Vex's built-in list)"}.</span>`;
      container.querySelector('#focus-restore').disabled = !this.isCustom();
    };
    paintState();

    container.querySelector('#focus-save').addEventListener('click', () => {
      const lines = container.querySelector('#focus-blocklist').value.split('\n')
        .map(s => s.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(Boolean);
      if (!this.saveBlocklist(lines)) {
        window.showToast?.('Blocklist could not be saved — Vex is still using the previous list', 'error');
        return;
      }
      paintState();
      window.showToast?.(lines.length
        ? `Blocklist saved — ${lines.length} site${lines.length === 1 ? '' : 's'}`
        : 'Blocklist cleared — focus sessions will not block anything');
    });

    container.querySelector('#focus-restore').addEventListener('click', () => {
      if (!this.restoreDefaults()) { window.showToast?.('Could not restore the default blocklist', 'error'); return; }
      container.querySelector('#focus-blocklist').value = this.blocklist().join('\n');
      paintState();
      window.showToast?.('Default blocklist restored');
    });
  },
};

const CompactMode = {
  KEY: 'vex.compactMode',
  toggle() {
    const on = document.body.classList.toggle('compact-mode');
    let saved = true;
    try { localStorage.setItem(this.KEY, on ? '1' : ''); } catch { saved = false; }
    if (!saved) window.showToast?.(`Compact mode ${on ? 'on' : 'off'} for now — the choice could not be saved and resets on restart`, 'error');
    else window.showToast?.(on ? 'Compact mode on' : 'Compact mode off');
  },
  init() {
    try { if (localStorage.getItem(this.KEY)) document.body.classList.add('compact-mode'); } catch {}
  },
};

if (typeof window !== 'undefined') { window.FocusMode = FocusMode; window.CompactMode = CompactMode; }
if (typeof module !== 'undefined' && module.exports) module.exports = { FocusMode, CompactMode };
