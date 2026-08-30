// === Vex Tab Health dashboard ===
// Makes the sleep/keep-awake/hibernate system legible: every tab grouped by its
// real state (active · kept awake · awake · hibernated · sleeping · not loaded)
// with its live memory and one-click controls. Opens from Ctrl+K → "Tab Health".
const TabHealth = {
  _state(tab) {
    if (tab.id === TabManager.activeTabId) return 'active';
    if (TabManager._isKeptAwake && TabManager._isKeptAwake(tab)) return 'kept';
    if (tab.sleeping) return 'sleeping';
    if (tab._lazy) return 'lazy';
    const wv = WebviewManager.webviews.get(tab.id);
    if (wv && wv.dataset && wv.dataset.hibernated === '1') return 'hibernated';
    if (wv) return 'awake';
    return 'lazy';
  },

  _meta: {
    active:     { label: 'Active',      icon: '🟢', hint: 'the tab you\'re looking at' },
    kept:       { label: 'Kept awake',  icon: '☕', hint: 'never sleeps — stays live in the background' },
    awake:      { label: 'Awake',       icon: '●',  hint: 'loaded and in memory' },
    hibernated: { label: 'Hibernated',  icon: '🧊', hint: 'blanked to save memory — reloads on click' },
    sleeping:   { label: 'Sleeping',    icon: '💤', hint: 'unloaded — reloads on click' },
    lazy:       { label: 'Not loaded',  icon: '○',  hint: 'restored but never opened yet' },
  },
  _order: ['active', 'kept', 'awake', 'hibernated', 'sleeping', 'lazy'],

  async open() {
    document.getElementById('vex-tabhealth')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-tabhealth';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:560px;max-width:95vw;max-height:82vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;padding:18px 20px 10px">
        <span style="font-size:15px;font-weight:700;color:var(--text);flex:1">🩺 Tab Health</span>
        <span id="th-total" style="font-size:12px;color:var(--text-muted)"></span>
        <button id="th-sleepothers" title="Sleep every idle background tab now" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">💤 Sleep idle</button>
        <button id="th-refresh" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">↻</button>
        <button id="th-close" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">✕</button>
      </div>
      <div id="th-body" style="overflow-y:auto;padding:4px 20px 20px;font-size:12.5px;color:var(--text)">Loading…</div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#th-close').addEventListener('click', () => m.remove());
    m.querySelector('#th-refresh').addEventListener('click', () => this._paint(m));
    m.querySelector('#th-sleepothers').addEventListener('click', () => { try { TabManager.sleepAllInactive(); } catch {} setTimeout(() => this._paint(m), 200); });
    this._paint(m);
  },

  async _paint(m) {
    const body = m.querySelector('#th-body'); if (!body) return;
    // Per-tab live memory, mapped webContents-id → tab.
    let memByWc = {};
    try {
      const live = TabManager.tabs.map(t => WebviewManager.webviews.get(t.id)).filter(Boolean);
      const ids = live.map(w => { try { return w.getWebContentsId(); } catch { return null; } }).filter(Boolean);
      if (ids.length && window.vex && window.vex.tabMemory) memByWc = (await window.vex.tabMemory(ids)).byId || {};
    } catch {}
    const memFor = (tab) => {
      try { const wv = WebviewManager.webviews.get(tab.id); if (!wv) return null; const wc = wv.getWebContentsId(); const e = memByWc[wc]; return e ? Math.round(e.memKB / 1024) : null; } catch { return null; }
    };

    const groups = {}; this._order.forEach(k => groups[k] = []);
    TabManager.tabs.forEach(t => groups[this._state(t)].push(t));

    let totalMB = 0; Object.values(memByWc).forEach(e => { totalMB += (e.memKB || 0); }); totalMB = Math.round(totalMB / 1024);
    m.querySelector('#th-total').textContent = TabManager.tabs.length + ' tabs · ~' + totalMB + ' MB';

    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');
    let html = '';
    for (const key of this._order) {
      const list = groups[key]; if (!list.length) continue;
      const meta = this._meta[key];
      html += `<div style="margin:14px 0 6px;display:flex;align-items:baseline;gap:8px"><span style="font-weight:700;color:var(--text)">${meta.icon} ${meta.label}</span><span style="font-size:11px;color:var(--text-muted)">${list.length} · ${meta.hint}</span></div>`;
      for (const t of list) {
        const mb = memFor(t);
        const kept = TabManager._isKeptAwake && TabManager._isKeptAwake(t);
        html += `<div data-tabid="${esc(t.id)}" style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;border:1px solid var(--border);margin-bottom:5px;background:var(--bg)">
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" data-act="go">${esc((t.title || t.url || 'Tab')).slice(0, 60)}</span>
          ${mb != null ? `<span style="font-size:11px;color:var(--text-muted);flex-shrink:0">${mb} MB</span>` : ''}
          <button data-act="keep" title="${kept ? 'Kept awake — click to change' : 'Prevent from sleeping'}" style="${this._btn(kept)}">☕</button>
          ${key === 'sleeping' || key === 'lazy' ? `<button data-act="wake" title="Wake now" style="${this._btn(false)}">▲</button>` : `<button data-act="sleep" title="Sleep now" style="${this._btn(false)}">💤</button>`}
        </div>`;
      }
    }
    body.innerHTML = html || 'No tabs.';
    body.querySelectorAll('[data-tabid]').forEach(row => {
      const id = row.dataset.tabid;
      row.querySelector('[data-act="go"]')?.addEventListener('click', () => { try { TabManager.switchTab(id); } catch {} m.remove(); });
      row.querySelector('[data-act="keep"]')?.addEventListener('click', () => { const t = TabManager.tabs.find(x => x.id === id); if (t) { try { TabManager._showKeepAwakeChooser(t); } catch {} } });
      row.querySelector('[data-act="wake"]')?.addEventListener('click', () => { try { const t = TabManager.tabs.find(x => x.id === id); if (t && t.sleeping) TabManager.wakeTab(id); else if (t && t._lazy) TabManager._materializeTab(t); } catch {} setTimeout(() => this._paint(m), 300); });
      row.querySelector('[data-act="sleep"]')?.addEventListener('click', () => { try { TabManager.sleepTab(id, true); } catch {} setTimeout(() => this._paint(m), 200); });
    });
  },

  _btn(on) {
    return `flex-shrink:0;width:28px;height:26px;border-radius:6px;cursor:pointer;font-size:12px;padding:0;border:1px solid ${on ? 'transparent' : 'var(--border)'};background:${on ? 'var(--primary,var(--accent,#d4a574))' : 'var(--surface)'};color:${on ? '#111' : 'var(--text)'};font-family:'Outfit',sans-serif`;
  },
};

if (typeof window !== 'undefined') window.TabHealth = TabHealth;
