// === Vex Web Monitor: page-change watcher + link-rot archiving ===
//
// PageMonitor — "Watch this page": Vex periodically refetches a URL (via main's
//   CORS-free api:request), strips it to readable text, and alerts you when it
//   changes. Great for restock pages, docs, status pages, listings. Stored in
//   localStorage 'vex.watches'. One shared 60s ticker checks whatever's due.
// LinkRot — one-click "Save to Wayback Machine" + "View archived version" so a
//   page you care about (or a dead link) is preserved / recoverable.

const PageMonitor = {
  KEY: 'vex.watches',
  watches: [],
  _timer: null,

  init() {
    try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); this.watches = Array.isArray(a) ? a : []; } catch { this.watches = []; }
    this._badge();
    clearInterval(this._timer);
    // Single ticker; each watch checks on its own interval.
    this._timer = setInterval(() => this._tick(), 60 * 1000);
    setTimeout(() => this._tick(), 8000);
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.watches)); } catch {} this._badge(); },

  _hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h >>> 0; },
  _strip(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  async add(url, title, intervalMin) {
    if (!url || !/^https?:/i.test(url)) { window.showToast?.('Open a website first'); return; }
    if (this.watches.some(w => w.url === url)) { window.showToast?.('Already watching this page'); return; }
    const w = { id: 'w' + Date.now().toString(36), url, title: title || url, intervalMin: intervalMin || 30, lastHash: null, lastChecked: 0, changed: false, baseline: false };
    this.watches.unshift(w);
    this.save();
    window.showToast?.('👁 Watching — you\'ll be alerted when it changes');
    await this._check(w, true); // establish baseline now
  },

  remove(id) { this.watches = this.watches.filter(w => w.id !== id); this.save(); },

  _tick() {
    const now = Date.now();
    this.watches.forEach(w => { if (now - (w.lastChecked || 0) >= (w.intervalMin || 30) * 60000) this._check(w); });
  },

  async _check(w, silent) {
    w.lastChecked = Date.now();
    const res = await window.vex.apiRequest({ url: w.url, method: 'GET' }).catch(() => null);
    if (!res || !res.ok) { this.save(); return; }
    const hash = this._hash(this._strip(res.body).slice(0, 200000));
    if (w.lastHash == null) { w.lastHash = hash; w.baseline = true; this.save(); return; }
    if (hash !== w.lastHash) {
      w.lastHash = hash; w.changed = true; w.changedAt = Date.now();
      this.save();
      if (!silent) {
        window.showToast?.('🔔 Page changed: ' + (w.title || w.url));
        try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Vex — page changed', { body: w.title || w.url }); } catch {}
      }
    } else { this.save(); }
  },

  _badge() {
    const n = this.watches.filter(w => w.changed).length;
    // Reflect on the command-bar trigger if present; otherwise silent.
    const btn = document.querySelector('.sidebar-icon[data-panel="settings"]');
    // (No dedicated icon — the manager modal shows the dot.)
    return n;
  },

  showManager() {
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    document.getElementById('vex-watches')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-watches';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    const rows = this.watches.length ? this.watches.map(w => {
      let host = w.url; try { host = new URL(w.url).hostname.replace(/^www\./, ''); } catch {}
      const when = w.lastChecked ? new Date(w.lastChecked).toLocaleString() : 'never';
      return `<div data-id="${w.id}" style="display:flex;align-items:center;gap:10px;padding:9px 8px;border-bottom:1px solid var(--border)">
        <span style="width:8px;height:8px;border-radius:50%;background:${w.changed ? '#22c55e' : 'var(--text-muted)'};flex:none"></span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(w.title)}${w.changed ? ' <span style="color:#22c55e;font-size:11px">● changed</span>' : ''}</div>
          <div style="font-size:11px;color:var(--text-muted)">${esc(host)} · every ${w.intervalMin}m · checked ${esc(when)}</div>
        </div>
        <button data-open style="padding:5px 10px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px">Open</button>
        <button data-x title="Stop watching" style="width:26px;height:26px;border:none;background:none;color:var(--text-muted);cursor:pointer;font-size:14px">✕</button>
      </div>`;
    }).join('') : '<div style="color:var(--text-muted);font-size:12.5px;padding:14px 8px">Not watching any pages. Ctrl+K → “Watch This Page”.</div>';
    m.innerHTML = `<div style="width:520px;max-width:94vw;max-height:80vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">
        <div style="padding:16px 18px 10px;display:flex;align-items:center;gap:10px"><strong style="font-size:16px;color:var(--text)">👁 Watched pages</strong><span style="flex:1"></span><button id="wt-close" style="padding:7px 16px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600">Done</button></div>
        <div style="overflow-y:auto;padding:0 18px 16px">${rows}</div>
      </div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('#wt-close').addEventListener('click', close);
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    m.querySelectorAll('[data-id]').forEach(row => {
      const w = this.watches.find(x => x.id === row.dataset.id);
      row.querySelector('[data-open]').addEventListener('click', () => { w.changed = false; this.save(); TabManager.createTab(w.url, true); close(); });
      row.querySelector('[data-x]').addEventListener('click', () => { this.remove(w.id); this.showManager(); });
    });
    // Ask for OS notification permission lazily the first time the user opens this.
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission(); } catch {}
  },
};

const LinkRot = {
  saveToWayback(url) {
    if (!url || !/^https?:/i.test(url)) { window.showToast?.('No page to archive'); return; }
    TabManager.createTab('https://web.archive.org/save/' + url, true);
    window.showToast?.('📦 Saving a snapshot to the Wayback Machine…');
  },
  viewArchived(url) {
    if (!url || !/^https?:/i.test(url)) { window.showToast?.('No URL to look up'); return; }
    // /web/2/<url> redirects to the most recent capture.
    TabManager.createTab('https://web.archive.org/web/2/' + url, true);
  },
};

if (typeof window !== 'undefined') { window.PageMonitor = PageMonitor; window.LinkRot = LinkRot; }
if (typeof module !== 'undefined' && module.exports) module.exports = { PageMonitor, LinkRot };
