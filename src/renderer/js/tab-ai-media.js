// === Vex: AI Tab Commands + Now Playing media hub + Resource Monitor ===

// ---- AI Tab Commands — natural language over your open tabs (Opera-style) ----
// "close all youtube tabs", "group my shopping tabs", "keep only this one".
// Uses the chat action with a personaSystemPrompt override so the worker
// returns OUR strict JSON; the plan is confirmed before anything closes.
const TabAI = {
  PROMPT: `You are a browser tab manager. The user gives an instruction and a list of open tabs (id, title, url, active).
Return ONLY JSON, no fences: {"close":["tab-ids"],"groups":[{"name":"Group name","color":"indigo|cyan|green|amber|red|violet|rose|teal","ids":["tab-ids"]}],"explanation":"one short sentence"}.
Rules: never close the active tab unless explicitly told; "keep only X" means close everything else except X and the active tab if X is the active tab; only group when asked to group/organize; ids must come from the list.`,

  open() {
    document.getElementById('vex-tabai-modal')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-tabai-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
    m.innerHTML = `<div style="width:430px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:22px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px">🗂 AI Tab Command</div>
      <p style="font-size:11.5px;color:var(--text-muted);margin:0 0 12px">e.g. "close all YouTube tabs" · "group my shopping tabs" · "keep only this one". You confirm before anything closes.</p>
      <input id="tai-q" type="text" placeholder="What should I do with your tabs?" style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;font-family:'Outfit',sans-serif">
      <div id="tai-out" style="font-size:12px;color:var(--text-muted);margin-top:10px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button id="tai-cancel" style="padding:8px 16px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Cancel</button>
        <button id="tai-go" style="padding:8px 18px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600">Plan</button>
      </div></div>`;
    document.body.appendChild(m);
    const q = m.querySelector('#tai-q'); q.focus();
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#tai-cancel').addEventListener('click', () => m.remove());
    const go = () => this._plan(m);
    m.querySelector('#tai-go').addEventListener('click', go);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  },

  async _plan(m) {
    const out = m.querySelector('#tai-out');
    const btn = m.querySelector('#tai-go');
    const want = m.querySelector('#tai-q').value.trim();
    if (!want) return;
    btn.disabled = true; btn.textContent = 'Thinking…';
    try {
      const tabs = TabManager.tabs.map(t => ({ id: t.id, title: String(t.title || '').slice(0, 90), url: t.url, active: t.id === TabManager.activeTabId }));
      const data = await AIRouter.callAI('chat', {
        message: 'Instruction: ' + want + '\n\nOpen tabs:\n' + JSON.stringify(tabs),
        personaSystemPrompt: this.PROMPT,
      });
      let plan = null;
      try { plan = JSON.parse(String(data.result).replace(/^```(json)?/i, '').replace(/```$/,'').trim()); } catch { const mm = String(data.result).match(/\{[\s\S]*\}/); if (mm) { try { plan = JSON.parse(mm[0]); } catch {} } }
      if (!plan) throw new Error('Could not understand the AI response');
      const ids = new Set(TabManager.tabs.map(t => t.id));
      const toClose = (plan.close || []).filter(id => ids.has(id) && id !== TabManager.activeTabId);
      const groups = (plan.groups || []).map(g => ({ ...g, ids: (g.ids || []).filter(id => ids.has(id)) })).filter(g => g.ids.length >= 2);
      const bits = [];
      if (toClose.length) bits.push('close ' + toClose.length + ' tab' + (toClose.length === 1 ? '' : 's'));
      groups.forEach(g => bits.push('group ' + g.ids.length + ' as "' + g.name + '"'));
      if (!bits.length) { out.textContent = (plan.explanation || 'Nothing to do.'); btn.disabled = false; btn.textContent = 'Plan'; return; }
      out.innerHTML = '<strong style="color:var(--text)">Plan:</strong> ' + bits.join(' · ') + (plan.explanation ? '<br>' + plan.explanation : '');
      btn.disabled = false; btn.textContent = 'Apply';
      btn.onclick = () => {
        const HEX = { indigo: '#6366f1', cyan: '#06b6d4', green: '#22c55e', amber: '#f59e0b', red: '#ef4444', violet: '#8b5cf6', rose: '#f43f5e', teal: '#14b8a6' };
        groups.forEach(g => {
          try {
            // Same shape tab-grouper uses — push into TabManager.groups directly.
            // Prefer a theme palette ref so AI groups match + re-theme like manual ones.
            const gid = 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            const color = (typeof TabManager !== 'undefined' && typeof TabManager._aiGroupColorRef === 'function')
              ? TabManager._aiGroupColorRef(g.color)
              : (HEX[g.color] || '#6366f1');
            TabManager.groups.push({ id: gid, name: g.name, color, collapsed: false });
            if (typeof VexStorage !== 'undefined') VexStorage.saveGroups(TabManager.groups);
            g.ids.forEach(id => { if (TabManager._setTabGroup) TabManager._setTabGroup(id, gid); });
            TabManager.rebuildAllTabs?.(); TabManager.persistTabs?.();
          } catch (e) { console.warn('[TabAI] group failed:', e); }
        });
        toClose.forEach(id => { try { TabManager.closeTab(id); } catch {} });
        window.showToast?.('🗂 Done — ' + bits.join(' · '));
        m.remove();
      };
    } catch (e) {
      out.textContent = e.message || 'Failed';
      btn.disabled = false; btn.textContent = 'Plan';
    }
  },
};

// ---- Now Playing — a mini bar for whatever tab is making noise ----
const NowPlaying = {
  playing: new Map(), // tabId -> title
  register(webview, tab) {
    webview.addEventListener('media-started-playing', () => {
      const t = TabManager.tabs.find(x => x.id === tab.id);
      this.playing.set(tab.id, (t && t.title) || 'Media');
      this._render();
    });
    const gone = () => { this.playing.delete(tab.id); this._render(); };
    webview.addEventListener('media-paused', gone);
    webview.addEventListener('destroyed', gone);
    webview.addEventListener('close', gone);
  },

  _render() {
    let bar = document.getElementById('vex-nowplaying');
    // Drop entries whose tabs are gone.
    [...this.playing.keys()].forEach(id => { if (!TabManager.tabs.some(t => t.id === id)) this.playing.delete(id); });
    if (!this.playing.size) { bar?.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'vex-nowplaying';
      bar.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:9000;display:flex;flex-direction:column;gap:6px;max-width:300px';
      document.body.appendChild(bar);
    }
    bar.innerHTML = '';
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    this.playing.forEach((title, tabId) => {
      const t = TabManager.tabs.find(x => x.id === tabId);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:7px 10px;box-shadow:0 8px 24px rgba(0,0,0,0.35);cursor:pointer';
      row.innerHTML = `<span style="font-size:12px">🎵</span>
        <span style="flex:1;min-width:0;font-size:11.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((t && t.title) || title)}</span>
        <button data-pp style="border:none;background:var(--bg);color:var(--text);border-radius:6px;width:24px;height:24px;cursor:pointer;font-size:11px">⏯</button>
        <button data-mute style="border:none;background:var(--bg);color:var(--text);border-radius:6px;width:24px;height:24px;cursor:pointer;font-size:11px">🔇</button>`;
      row.addEventListener('click', (e) => { if (e.target.closest('button')) return; TabManager.switchTab(tabId); });
      row.querySelector('[data-pp]').addEventListener('click', (e) => {
        e.stopPropagation();
        const wv = WebviewManager.webviews.get(tabId);
        try { wv?.executeJavaScript('document.querySelectorAll("video,audio").forEach(m=>m.paused?m.play():m.pause())'); } catch {}
      });
      row.querySelector('[data-mute]').addEventListener('click', (e) => {
        e.stopPropagation();
        const wv = WebviewManager.webviews.get(tabId);
        try { wv?.setAudioMuted(!wv.isAudioMuted()); } catch {}
      });
      bar.appendChild(row);
    });
  },
};

// ---- Resource Monitor — live per-process CPU / memory (GX-style, honest) ----
const ResourceMonitor = {
  async open() {
    document.getElementById('vex-resmon')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-resmon';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
    m.innerHTML = `<div style="width:520px;max-width:94vw;max-height:80vh;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:22px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:15px;font-weight:700;color:var(--text);flex:1">📊 Resource Monitor</span>
        <button id="rm-refresh" style="padding:6px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Refresh</button>
        <button id="rm-close" style="padding:6px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">✕</button>
      </div>
      <div id="rm-body" style="font-size:12px;color:var(--text)">Loading…</div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#rm-close').addEventListener('click', () => m.remove());
    const paint = async () => {
      const body = m.querySelector('#rm-body');
      try {
        const procs = await window.vex.appMetrics();
        if (!procs || !procs.length) { body.textContent = 'No data.'; return; }
        const rows = procs.sort((a, b) => (b.memKB || 0) - (a.memKB || 0)).map(p =>
          `<tr><td style="padding:4px 8px 4px 0">${p.type}</td><td style="padding:4px 8px;text-align:right">${(p.cpu || 0).toFixed(1)}%</td><td style="padding:4px 0;text-align:right">${Math.round((p.memKB || 0) / 1024)} MB</td></tr>`).join('');
        const totalMB = Math.round(procs.reduce((s, p) => s + (p.memKB || 0), 0) / 1024);
        body.innerHTML = `<table style="width:100%;border-collapse:collapse"><tr style="color:var(--text-muted);font-size:10.5px;text-transform:uppercase"><td>Process</td><td style="text-align:right">CPU</td><td style="text-align:right">Memory</td></tr>${rows}</table>
          <div style="margin-top:10px;color:var(--text-muted)">Total: <strong style="color:var(--text)">${totalMB} MB</strong> · Tip: the Memory panel can sleep heavy tabs.</div>`;
      } catch { body.textContent = 'Metrics unavailable.'; }
    };
    m.querySelector('#rm-refresh').addEventListener('click', paint);
    paint();
  },
};

if (typeof window !== 'undefined') { window.TabAI = TabAI; window.NowPlaying = NowPlaying; window.ResourceMonitor = ResourceMonitor; }
if (typeof module !== 'undefined' && module.exports) module.exports = { TabAI, NowPlaying, ResourceMonitor };
