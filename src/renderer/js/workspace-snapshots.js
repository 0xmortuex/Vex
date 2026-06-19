// === Vex Workspace Time-Travel — periodic tab-set snapshots + restore ===
//
// Beyond the manual session/workspace save, this quietly snapshots the current
// workspace's open tabs every few minutes (and on demand), keeping a capped
// rolling history per workspace in localStorage. Open the picker (command bar →
// "Workspace Time-Travel") to restore any past tab set — non-destructively, as
// new tabs, so you never lose what's open now.

const WorkspaceSnapshots = {
  KEY: 'vex.workspaceSnapshots',
  MAX: 25,
  INTERVAL_MS: 10 * 60 * 1000, // auto-snapshot cadence
  _timer: null,

  init() {
    if (this._timer) return;
    // First capture a minute after launch (once tabs have restored), then on a
    // steady cadence. Auto-snapshots that match the previous one are skipped.
    setTimeout(() => this.snapshot(true), 60 * 1000);
    this._timer = setInterval(() => this.snapshot(true), this.INTERVAL_MS);
  },

  _all() { try { return JSON.parse(localStorage.getItem(this.KEY) || '{}'); } catch { return {}; } },
  _save(o) { try { localStorage.setItem(this.KEY, JSON.stringify(o)); } catch {} },
  _wsId() { return (typeof WorkspaceManager !== 'undefined' && WorkspaceManager.activeId) || 'default'; },
  _wsName() {
    try { return (WorkspaceManager.getActive && WorkspaceManager.getActive().name) || 'Workspace'; } catch { return 'Workspace'; }
  },

  _currentTabs() {
    if (typeof TabManager === 'undefined') return [];
    return (TabManager.tabs || [])
      .filter(t => t.url && !/^about:/i.test(t.url) && !(typeof isStartPage === 'function' && isStartPage(t.url)))
      .map(t => ({ url: t.url, title: t.title || t.url, pinned: !!t.pinned }));
  },

  snapshot(auto) {
    const tabs = this._currentTabs();
    if (!tabs.length) { if (!auto) window.showToast?.('Nothing to snapshot'); return; }
    const all = this._all();
    const wsId = this._wsId();
    const list = all[wsId] || [];
    const sig = tabs.map(t => t.url).join('|');
    if (auto && list[0] && list[0].sig === sig) return; // unchanged → skip dupe
    list.unshift({ ts: Date.now(), sig, tabs });
    all[wsId] = list.slice(0, this.MAX);
    this._save(all);
    if (!auto) { window.showToast?.(`Snapshot saved · ${tabs.length} tab${tabs.length > 1 ? 's' : ''}`); this._repaint(); }
  },

  _rel(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60); if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60); if (h < 24) return h + ' hr ago';
    const d = Math.round(h / 24); return d + ' day' + (d > 1 ? 's' : '') + ' ago';
  },

  restore(ts) {
    const list = this._all()[this._wsId()] || [];
    const snap = list.find(s => s.ts === ts);
    if (!snap || typeof TabManager === 'undefined') return;
    let first = null;
    snap.tabs.forEach((t) => {
      try { const id = TabManager.createTab(t.url, false); if (first == null) first = id; } catch {}
    });
    if (first != null) { try { TabManager.switchTab(first); } catch {} }
    window.showToast?.(`Restored ${snap.tabs.length} tab${snap.tabs.length > 1 ? 's' : ''}`);
    this._close();
  },

  _delete(ts) {
    const all = this._all(); const wsId = this._wsId();
    all[wsId] = (all[wsId] || []).filter(s => s.ts !== ts);
    this._save(all); this._repaint();
  },

  _close() { document.getElementById('vex-wsnap')?.remove(); },

  _repaint() {
    const body = document.getElementById('vex-wsnap-body');
    if (!body) return;
    const list = this._all()[this._wsId()] || [];
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    if (!list.length) { body.innerHTML = `<div style="color:var(--text-muted);padding:18px 4px;text-align:center">No snapshots yet for this workspace.</div>`; return; }
    body.innerHTML = list.map(s => {
      const titles = s.tabs.slice(0, 3).map(t => esc(t.title)).join(' · ');
      const more = s.tabs.length > 3 ? ` +${s.tabs.length - 3} more` : '';
      return `<div class="wsnap-row" style="display:flex;align-items:center;gap:10px;padding:9px 8px;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;color:var(--text);font-weight:600">${this._rel(s.ts)} · ${s.tabs.length} tab${s.tabs.length > 1 ? 's' : ''}</div>
          <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${titles}${more}</div>
        </div>
        <button data-restore="${s.ts}" style="padding:5px 11px;background:var(--primary);color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:11.5px">Restore</button>
        <button data-del="${s.ts}" title="Delete" style="padding:5px 8px;background:var(--bg);color:var(--text-muted);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:11.5px">✕</button>
      </div>`;
    }).join('');
    body.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', () => this.restore(parseInt(b.dataset.restore, 10))));
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => this._delete(parseInt(b.dataset.del, 10))));
  },

  open() {
    this._close();
    const m = document.createElement('div');
    m.id = 'vex-wsnap';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:520px;max-width:94vw;max-height:80vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:16px 18px;border-bottom:1px solid var(--border)">
        <span style="font-size:15px;font-weight:700;color:var(--text);flex:1">🕰️ Time-Travel · ${this._wsName()}</span>
        <button id="wsnap-now" style="padding:6px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px">Snapshot now</button>
        <button id="wsnap-close" style="padding:6px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px">✕</button>
      </div>
      <div id="vex-wsnap-body" style="overflow-y:auto;padding:4px 14px 14px"></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) this._close(); });
    m.querySelector('#wsnap-close').addEventListener('click', () => this._close());
    m.querySelector('#wsnap-now').addEventListener('click', () => this.snapshot(false));
    this._repaint();
  },
};

if (typeof window !== 'undefined') window.WorkspaceSnapshots = WorkspaceSnapshots;
if (typeof module !== 'undefined' && module.exports) module.exports = { WorkspaceSnapshots };
