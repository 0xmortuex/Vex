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

  blocklist() {
    try {
      const a = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      if (Array.isArray(a)) return a;
    } catch {}
    return ['youtube.com', 'tiktok.com', 'instagram.com', 'x.com', 'twitter.com', 'reddit.com'];
  },
  saveBlocklist(arr) { try { localStorage.setItem(this.KEY, JSON.stringify(arr)); } catch {} },

  toggle(minutes) {
    if (this.active) this.stop();
    else this.start(minutes || 25);
  },

  start(minutes) {
    this.active = true;
    this.until = Date.now() + minutes * 60 * 1000;
    document.body.classList.add('focus-mode');
    window.showToast?.(`🎯 Focus for ${minutes} min — distracting sites blocked. Ctrl+K → "Focus" to end early.`);
    clearInterval(this._timer);
    this._timer = setInterval(() => {
      if (Date.now() >= this.until) { this.stop(); window.showToast?.('🎉 Focus session complete!'); }
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
    window.showToast?.(`🎯 Blocked during focus (${mins} min left)`);
    try { if (webview.canGoBack()) webview.goBack(); else webview.loadURL(typeof START_URL !== 'undefined' ? START_URL : 'about:blank'); } catch {}
    return true;
  },

  renderPanel(container) {
    if (!container) return;
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:10px">Sites blocked while a focus session is running (<kbd>Ctrl</kbd>+<kbd>K</kbd> → "Focus 25"). One per line.</p>
      <textarea id="focus-blocklist" rows="5" spellcheck="false" style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12.5px;outline:none;resize:vertical;font-family:'JetBrains Mono',monospace">${esc(this.blocklist().join('\n'))}</textarea>
      <button id="focus-save" style="margin-top:8px;padding:8px 16px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Save blocklist</button>`;
    container.querySelector('#focus-save').addEventListener('click', () => {
      const lines = container.querySelector('#focus-blocklist').value.split('\n')
        .map(s => s.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(Boolean);
      this.saveBlocklist(lines);
      window.showToast?.('Blocklist saved');
    });
  },
};

const CompactMode = {
  KEY: 'vex.compactMode',
  toggle() {
    const on = document.body.classList.toggle('compact-mode');
    try { localStorage.setItem(this.KEY, on ? '1' : ''); } catch {}
    window.showToast?.(on ? 'Compact mode on' : 'Compact mode off');
  },
  init() {
    try { if (localStorage.getItem(this.KEY)) document.body.classList.add('compact-mode'); } catch {}
  },
};

if (typeof window !== 'undefined') { window.FocusMode = FocusMode; window.CompactMode = CompactMode; }
if (typeof module !== 'undefined' && module.exports) module.exports = { FocusMode, CompactMode };
