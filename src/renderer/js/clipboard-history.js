// === Clipboard history — the thing you copied before the thing you copied ===
//
// You copy a tracking number, then copy the address to paste it somewhere, and
// the tracking number is gone. There is no way back: the clipboard holds one
// thing and the last copy wins.
//
// Windows has Win+V, and every clipboard manager works the same way — by
// watching the system clipboard. That means they also record what you copy out
// of your password manager, your banking app, your terminal. Vex does not do
// that. It sees exactly one thing: text you copied off a web page, reported by
// the guest preload (preload-webview.js, 'vex-copy'). Copies made in Vex's own
// interface are not seen. Other programs are not seen. A copy out of a password
// or one-time-code field is never sent in the first place.
//
// WHERE IT LIVES matters as much as what it holds:
//   recent   in memory, for this session only, and gone when Vex closes
//   pinned   on disk, because you asked for that one to be kept
//
// A clipboard history that quietly wrote every copy to disk would be a file
// full of things people copied once and never thought about again. Keeping is
// a decision, so it is the user's.

const ClipboardHistory = {
  PIN_KEY: 'vex.clipboardPins',
  SETTING: 'vex.clipboardHistory',
  MAX: 60,              // recent entries held in memory
  MAX_PINS: 100,
  MAX_LEN: 10000,

  recent: [],
  pinned: [],

  init() {
    try {
      const a = JSON.parse(localStorage.getItem(this.PIN_KEY) || '[]');
      this.pinned = Array.isArray(a) ? a.filter(x => x && typeof x.text === 'string').slice(0, this.MAX_PINS) : [];
    } catch { this.pinned = []; }
    return this;
  },

  // Default on. Off means nothing is recorded at all — not held, not shown.
  enabled() { try { return localStorage.getItem(this.SETTING) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.SETTING, on ? 'on' : 'off'); } catch {}
    if (!on) this.recent = [];
  },

  _savePins() {
    this.pinned = this.pinned.slice(0, this.MAX_PINS);
    try { localStorage.setItem(this.PIN_KEY, JSON.stringify(this.pinned)); } catch {}
  },

  // Guest pages announce their copies here. Everything about the entry that is
  // not the text itself is for telling two similar copies apart later.
  record({ text, host, title }) {
    if (!this.enabled()) return null;
    const value = String(text == null ? '' : text);
    if (!value.trim() || value.length > this.MAX_LEN) return null;

    // Copying the same thing twice is one entry, moved back to the top —
    // otherwise re-copying something floods the list with itself.
    const same = this.recent.findIndex(i => i.text === value);
    if (same >= 0) {
      const [existing] = this.recent.splice(same, 1);
      existing.at = Date.now();
      this.recent.unshift(existing);
      return existing;
    }

    const entry = {
      id: window.vexId ? window.vexId('clip') : 'clip-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      text: value,
      host: String(host || ''),
      title: String(title || ''),
      at: Date.now(),
    };
    this.recent.unshift(entry);
    if (this.recent.length > this.MAX) this.recent.length = this.MAX;
    return entry;
  },

  // Recent first, then anything pinned that is not already in it. Pinned
  // entries are marked so the list can show why they survived.
  list() {
    if (!this.enabled()) return [];
    const seen = new Set(this.recent.map(i => i.text));
    return [
      ...this.recent.map(i => ({ ...i, pinned: this.pinned.some(p => p.text === i.text) })),
      ...this.pinned.filter(p => !seen.has(p.text)).map(p => ({ ...p, pinned: true })),
    ];
  },

  isPinned(text) { return this.pinned.some(p => p.text === text); },

  // Pinning is what moves something from memory to disk, so it is also the
  // only thing here that writes anything down.
  pin(id) {
    const item = this.recent.find(i => i.id === id) || this.pinned.find(i => i.id === id);
    if (!item) throw new Error('That clipboard entry is gone');
    if (this.isPinned(item.text)) return item;
    this.pinned.unshift({ ...item, pinnedAt: Date.now() });
    this._savePins();
    return item;
  },

  unpin(id) {
    const item = this.recent.find(i => i.id === id) || this.pinned.find(i => i.id === id);
    const text = item ? item.text : null;
    const before = this.pinned.length;
    this.pinned = this.pinned.filter(p => p.id !== id && (text === null || p.text !== text));
    if (this.pinned.length !== before) this._savePins();
  },

  remove(id) {
    this.recent = this.recent.filter(i => i.id !== id);
    this.unpin(id);
  },

  // "Clear" means clear: the session list and everything kept on disk.
  clear() {
    this.recent = [];
    this.pinned = [];
    try { localStorage.removeItem(this.PIN_KEY); } catch {}
  },

  // Put an old entry back on the clipboard. It goes to the front of the recent
  // list as a copy would, because that is what just happened.
  async use(id) {
    const item = this.list().find(i => i.id === id);
    if (!item) throw new Error('That clipboard entry is gone');
    await navigator.clipboard.writeText(item.text);
    this.record({ text: item.text, host: item.host, title: item.title });
    window.showToast?.('Copied — paste it where you need it');
    return item;
  },

  // One line describing an entry in a list: the first line of it, and where it
  // came from. A 4,000-character copy must not become a 4,000-character row.
  preview(item, width = 80) {
    const oneLine = String(item.text || '').replace(/\s+/g, ' ').trim();
    return oneLine.length > width ? oneLine.slice(0, width - 1) + '…' : oneLine;
  },

  // The whole list, for when you don't remember a word to search for. Click to
  // copy; the pin keeps an entry past this session; Esc closes.
  openPicker() {
    document.querySelector('.vex-clip-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-clip-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.38);display:grid;place-items:start center;padding-top:10vh';
    overlay.innerHTML = `
      <div class="vex-clip-box" role="dialog" aria-modal="true" aria-label="Clipboard history"
           style="width:min(620px,92vw);max-height:70vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1;font-size:13.5px;font-weight:650;color:var(--text)">Clipboard history</div>
          <button data-clear type="button" style="font-size:11.5px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer">Clear all</button>
        </div>
        <div data-list style="overflow-y:auto;padding:6px"></div>
        <div style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">
          Copies made on web pages. Private and Tor tabs are never recorded, and nothing is kept after you close Vex unless you pin it.
        </div>
      </div>`;

    const listEl = overlay.querySelector('[data-list]');
    const draw = () => {
      const items = this.list();
      if (!items.length) {
        listEl.innerHTML = window.VexUI
          ? VexUI.emptyState('clipboard', 'Nothing copied yet', 'Copy something on a page and it shows up here')
          : '<div style="padding:26px;text-align:center;font-size:12.5px;color:var(--text-muted)">Nothing copied yet.</div>';
        return;
      }
      listEl.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:8px;cursor:pointer';
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--vex-hover-fill,var(--surface))'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        row.innerHTML = `
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(this.preview(item, 90))}</div>
            <div style="font-size:10.5px;color:var(--text-muted)">${esc(item.host || 'a page')}${item.pinned ? ' · kept' : ''}</div>
          </div>
          <button data-pin type="button" title="${item.pinned ? 'Stop keeping this' : 'Keep this past today'}"
                  style="background:none;border:none;cursor:pointer;padding:4px;color:${item.pinned ? 'var(--primary)' : 'var(--text-muted)'}">${window.VexIcons ? VexIcons.svg('pin', { size: 14 }) : ''}</button>
          <button data-remove type="button" title="Remove"
                  style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text-muted)">${window.VexIcons ? VexIcons.svg('x', { size: 14 }) : ''}</button>`;
        row.addEventListener('click', (e) => {
          if (e.target.closest('[data-pin]')) {
            if (item.pinned) this.unpin(item.id); else this.pin(item.id);
            draw();
            return;
          }
          if (e.target.closest('[data-remove]')) { this.remove(item.id); draw(); return; }
          this.use(item.id).then(close, (err) => window.showToast?.(err.message, 'error'));
        });
        listEl.appendChild(row);
      }
    };

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-clear]').addEventListener('click', async () => {
      if (!(await vexConfirm({
        title: 'Clear the clipboard history?',
        message: 'This forgets everything copied this session, and anything you pinned. What is on the clipboard right now is not touched.',
        okLabel: 'Clear it', danger: true,
      }))) return;
      this.clear();
      draw();
    });
    document.addEventListener('keydown', onKey, true);
    draw();
    document.body.appendChild(overlay);
    return overlay;
  },

  // Guest copies arrive on the webview's own ipc-message channel, registered
  // through the lifecycle so a closed tab takes its listener with it.
  attach(webview) {
    const on = (webview && webview._lifecycle)
      ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn)
      : (ev, fn) => webview.addEventListener(ev, fn);
    on('ipc-message', (e) => {
      if (e.channel !== 'vex-copy') return;
      // A private or Tor tab leaves nothing behind, and that includes this.
      if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) return;
      const data = (e.args && e.args[0]) || {};
      let host = '';
      try { host = new URL(webview.getURL()).hostname.replace(/^www\./, ''); } catch {}
      this.record({ text: data.text, host, title: data.title });
    });
  },
};

if (typeof window !== 'undefined') window.ClipboardHistory = ClipboardHistory;
if (typeof module !== 'undefined' && module.exports) module.exports = { ClipboardHistory };
