// === Vex per-container routing UI ===
// Route a container (or this tab's session) through Tor or a custom proxy, so a
// whole set of logins can browse over Tor persistently — or spin up a fresh
// Tor-routed container in one click. Ctrl+K → "Route Through Tor / Proxy".
const ContainerRouting = {
  _activePartition() { try { const t = TabManager.getActiveTab(); return (t && t.partition) || 'persist:main'; } catch { return 'persist:main'; } },
  _isContainer(p) { return /^persist:container-/.test(p || ''); },

  async open() {
    document.getElementById('vex-routing')?.remove();
    const part = this._activePartition();
    let cur = { mode: 'direct' };
    try { cur = (await window.vex.routingGet(part)) || cur; } catch {}
    const m = document.createElement('div');
    m.id = 'vex-routing';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    const chip = "padding:6px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12.5px;font-family:'Outfit',sans-serif";
    const prim = "padding:8px 14px;background:var(--primary,var(--accent,#d4a574));color:#111;border:1px solid transparent;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:600;font-family:'Outfit',sans-serif";
    const scopeNote = this._isContainer(part)
      ? 'This is an isolated container — routing only affects its tabs.'
      : 'Heads-up: this is your main session, so this routes <b>all</b> normal tabs. For an isolated one, use “New Tor container” below.';
    m.innerHTML = `<div style="width:480px;max-width:94vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;box-shadow:0 24px 60px rgba(0,0,0,0.5);color:var(--text)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:15px;font-weight:700;flex:1">🧅 Route through Tor / Proxy</span><button id="rt-close" style="${chip}">✕</button></div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:4px">Session: <code>${window.escapeHtml ? window.escapeHtml(part) : part}</code></div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:14px">${scopeNote}</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="rt-opt" data-mode="direct" style="${chip};text-align:left">🌐 Direct — no proxy ${cur.mode === 'direct' ? '· <b>current</b>' : ''}</button>
        <button class="rt-opt" data-mode="tor" style="${chip};text-align:left">🧅 Tor — route this session through Tor ${cur.mode === 'tor' ? '· <b>current</b>' : ''}</button>
        <div style="display:flex;gap:8px">
          <input id="rt-proxy" placeholder="socks5://127.0.0.1:1080 or http://host:port" value="${cur.mode === 'proxy' ? (window.escapeHtml ? window.escapeHtml(cur.custom || '') : (cur.custom || '')) : ''}" style="flex:1;padding:8px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;font-size:12px;font-family:monospace">
          <button id="rt-proxy-go" style="${chip}">Use proxy</button>
        </div>
      </div>
      <div id="rt-msg" style="font-size:11.5px;color:var(--text-muted);min-height:16px;margin:12px 0"></div>
      <div style="border-top:1px solid var(--border);margin-top:6px;padding-top:12px;display:flex;align-items:center;gap:8px">
        <span style="flex:1;font-size:12px;color:var(--text-muted)">Or start fresh:</span>
        <button id="rt-new-tor" style="${prim}">➕ New Tor container</button>
      </div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#rt-close').addEventListener('click', () => m.remove());
    const msg = (t, ok) => { const e = m.querySelector('#rt-msg'); if (e) { e.innerHTML = t; e.style.color = ok ? '#4caf50' : 'var(--text-muted)'; } };

    const apply = async (mode, custom) => {
      msg(mode === 'tor' ? 'Connecting to Tor…' : 'Applying…');
      try {
        const r = await window.vex.routingSet(part, mode, custom);
        if (!r || !r.ok) { msg('Failed: ' + ((r && r.error) || 'unknown'), false); return; }
        // Reload the active tab so the new route takes effect immediately.
        try { const wv = WebviewManager.getActiveWebview(); if (wv) wv.reload(); } catch {}
        msg('✓ ' + (mode === 'tor' ? 'Now routing through Tor.' : mode === 'proxy' ? 'Now using your proxy.' : 'Back to direct.'), true);
        window.showToast?.(mode === 'tor' ? '🧅 Session routed through Tor' : mode === 'proxy' ? 'Proxy applied' : 'Direct connection restored');
      } catch (e) { msg('Error: ' + e.message, false); }
    };
    m.querySelectorAll('.rt-opt').forEach(b => b.addEventListener('click', () => apply(b.dataset.mode)));
    m.querySelector('#rt-proxy-go').addEventListener('click', () => { const v = (m.querySelector('#rt-proxy').value || '').trim(); if (v) apply('proxy', v); });
    m.querySelector('#rt-new-tor').addEventListener('click', async () => {
      const p = 'persist:container-tor-' + Date.now().toString(36);
      msg('Creating Tor container…');
      try {
        const r = await window.vex.routingSet(p, 'tor');
        if (!r || !r.ok) { msg('Failed to start Tor: ' + ((r && r.error) || ''), false); return; }
        TabManager.createTab('https://check.torproject.org/', true, null, { partition: p });
        m.remove();
        window.showToast?.('🧅 Opened a Tor-routed container');
      } catch (e) { msg('Error: ' + e.message, false); }
    });
  },
};

if (typeof window !== 'undefined') window.ContainerRouting = ContainerRouting;
