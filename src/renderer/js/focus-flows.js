// === Vex Focus Flows ===
// Named, composable work MODES you trigger on demand — distinct from Focus Mode
// (which is a 25/50-min Pomodoro timer with one fixed blocklist). A flow bundles:
// a set of tabs to open, an AI persona for the tab, a dimmed-UI option, and an
// optional site blocklist. One click sets the whole scene up. Ctrl+K → "Focus
// Flows". Saved in localStorage 'vex.focusFlows'.
const FocusFlows = {
  KEY: 'vex.focusFlows',
  _active: null,       // { flow, endBar, styleEl, pollTimer }

  _load() { try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  _save(a) { try { localStorage.setItem(this.KEY, JSON.stringify(a.slice(0, 100))); } catch {} },
  _esc(s) { try { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s); } catch { return ''; } },
  _host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || '').trim(); } },
  _chip() { return "padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif"; },
  _primary() { return "padding:6px 12px;background:var(--primary,var(--accent,#d4a574));color:#111;border:1px solid transparent;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;font-family:'Outfit',sans-serif"; },

  // ---- Modal ----
  open() {
    try {
      document.getElementById('vex-focusflows')?.remove();
      const m = document.createElement('div');
      m.id = 'vex-focusflows';
      m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
      m.innerHTML = `<div style="width:560px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
        <div style="display:flex;align-items:center;gap:8px;padding:16px 20px 10px">
          <span style="font-size:15px;font-weight:700;color:var(--text);flex:1">🎯 Focus Flows</span>
          <button id="ff-close" style="${this._chip()}">✕</button>
        </div>
        <div id="ff-body" style="overflow-y:auto;padding:4px 20px 20px;font-size:12.5px;color:var(--text)"></div></div>`;
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
      m.querySelector('#ff-close').addEventListener('click', () => m.remove());
      this._paint(m);
    } catch (e) { try { window.showToast?.('Focus Flows failed to open'); } catch {} }
  },

  _paint(m, editing) {
    const body = m.querySelector('#ff-body'); if (!body) return;
    const flows = this._load();
    let personas = [];
    try { personas = (typeof PersonasManager !== 'undefined' && PersonasManager.getAll()) ? PersonasManager.getAll() : []; } catch {}

    let html = `<div style="font-size:11.5px;color:var(--text-muted);margin:2px 0 12px">A flow opens a set of tabs, sets an AI persona, can dim the UI, and can block distracting sites — all in one click. Great for "Writing", "Research", "Deep work".</div>`;

    if (flows.length) {
      html += flows.map((f, i) => `<div data-i="${i}" style="display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--border);border-radius:9px;margin-bottom:6px;background:var(--bg)">
        <span style="font-size:16px">${this._esc(f.emoji || '🎯')}</span>
        <span style="flex:1;min-width:0">
          <span style="display:block;font-weight:600">${this._esc(f.name || 'Flow')}</span>
          <span style="display:block;font-size:11px;color:var(--text-muted)">${(f.openTabs || []).length} tab(s)${f.persona ? ' · persona' : ''}${f.dimUI ? ' · dim' : ''}${(f.blockSites || []).length ? ' · blocks ' + (f.blockSites || []).length : ''}</span>
        </span>
        <button data-act="go" style="${this._primary()}">Activate</button>
        <button data-act="edit" style="${this._chip()}">✎</button>
        <button data-act="del" style="${this._chip()}">✕</button>
      </div>`).join('');
    } else {
      html += `<div style="color:var(--text-muted);margin-bottom:8px">No flows yet — create one below.</div>`;
    }

    // Editor
    const ed = editing || {};
    const personaOpts = ['<option value="">No persona change</option>'].concat(
      personas.map(p => `<option value="${this._esc(p.id)}"${ed.persona === p.id ? ' selected' : ''}>${this._esc(p.emoji || p.icon || '🎭')} ${this._esc(p.name || 'Persona')}</option>`)
    ).join('');
    const ta = "width:100%;box-sizing:border-box;padding:8px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;font-size:12px;font-family:monospace;resize:vertical;outline:none";
    const inp = "box-sizing:border-box;padding:8px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;font-size:12.5px;font-family:'Outfit',sans-serif;outline:none";
    html += `<div style="border-top:1px solid var(--border);margin-top:14px;padding-top:14px">
      <div style="font-weight:700;margin-bottom:8px">${ed.id ? 'Edit flow' : 'New flow'}</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <input id="ff-emoji" maxlength="2" placeholder="🎯" value="${this._esc(ed.emoji || '')}" style="${inp};width:52px;text-align:center">
        <input id="ff-name" placeholder="Flow name (e.g. Writing)" value="${this._esc(ed.name || '')}" style="${inp};flex:1">
      </div>
      <label style="display:block;font-size:11.5px;color:var(--text-muted);margin-bottom:3px">Tabs to open (one URL per line)</label>
      <textarea id="ff-tabs" rows="3" spellcheck="false" placeholder="https://docs.google.com\nhttps://notion.so" style="${ta};margin-bottom:8px">${this._esc((ed.openTabs || []).join('\n'))}</textarea>
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px">AI persona <select id="ff-persona" style="${inp}">${personaOpts}</select></label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="ff-dim"${ed.dimUI ? ' checked' : ''}> Dim the UI</label>
      </div>
      <label style="display:block;font-size:11.5px;color:var(--text-muted);margin-bottom:3px">Block these sites while active (one host per line, optional)</label>
      <textarea id="ff-block" rows="2" spellcheck="false" placeholder="twitter.com\nreddit.com" style="${ta};margin-bottom:10px">${this._esc((ed.blockSites || []).join('\n'))}</textarea>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        ${ed.id ? `<button id="ff-cancel" style="${this._chip()}">Cancel edit</button>` : ''}
        <button id="ff-savebtn" style="${this._primary()}">${ed.id ? 'Save changes' : 'Save flow'}</button>
      </div>
    </div>`;

    body.innerHTML = html;

    // Wire list rows
    body.querySelectorAll('[data-i]').forEach(row => {
      const i = parseInt(row.dataset.i, 10);
      row.querySelector('[data-act="go"]')?.addEventListener('click', () => { const f = this._load()[i]; if (f) { this.activate(f); m.remove(); } });
      row.querySelector('[data-act="edit"]')?.addEventListener('click', () => { const f = this._load()[i]; if (f) this._paint(m, f); });
      row.querySelector('[data-act="del"]')?.addEventListener('click', () => { const a = this._load(); a.splice(i, 1); this._save(a); this._paint(m); });
    });

    // Wire editor
    body.querySelector('#ff-cancel')?.addEventListener('click', () => this._paint(m));
    body.querySelector('#ff-savebtn')?.addEventListener('click', () => {
      const name = (body.querySelector('#ff-name').value || '').trim();
      if (!name) { window.showToast?.('Give the flow a name'); return; }
      const flow = {
        id: (ed && ed.id) || ('flow-' + Date.now().toString(36)),
        name,
        emoji: (body.querySelector('#ff-emoji').value || '').trim() || '🎯',
        openTabs: (body.querySelector('#ff-tabs').value || '').split('\n').map(s => s.trim()).filter(Boolean).map(u => /^https?:\/\//i.test(u) ? u : ('https://' + u)),
        persona: body.querySelector('#ff-persona').value || null,
        dimUI: body.querySelector('#ff-dim').checked,
        blockSites: (body.querySelector('#ff-block').value || '').split('\n').map(s => this._host(s.trim())).filter(Boolean),
      };
      const a = this._load();
      const idx = a.findIndex(x => x.id === flow.id);
      if (idx >= 0) a[idx] = flow; else a.unshift(flow);
      this._save(a);
      this._paint(m);
      window.showToast?.('Saved "' + name + '"');
    });
  },

  // ---- Activate / end ----
  activate(flow) {
    try {
      if (this._active) this.end();
      const did = [];
      // Open tabs
      (flow.openTabs || []).forEach((url, i) => { try { if (typeof TabManager !== 'undefined') TabManager.createTab(url, i === 0); } catch {} });
      if ((flow.openTabs || []).length) did.push((flow.openTabs.length) + ' tab(s)');
      // Persona on the (new) active tab
      if (flow.persona && typeof PersonasManager !== 'undefined' && typeof PersonasManager.setActiveForTab === 'function' && typeof TabManager !== 'undefined') {
        try { PersonasManager.setActiveForTab(TabManager.activeTabId, flow.persona); did.push('persona'); } catch {}
      }
      // Dim UI
      let styleEl = null;
      if (flow.dimUI) {
        try {
          document.body.classList.add('focus-flow-dim');
          styleEl = document.getElementById('focus-flow-dim-style');
          if (!styleEl) {
            styleEl = document.createElement('style'); styleEl.id = 'focus-flow-dim-style';
            styleEl.textContent = `body.focus-flow-dim #top-bar, body.focus-flow-dim #icon-sidebar, body.focus-flow-dim #tabs-sidebar, body.focus-flow-dim #top-tab-bar, body.focus-flow-dim #gui-shortcuts-bar { opacity:0.35; transition:opacity .18s; } body.focus-flow-dim #top-bar:hover, body.focus-flow-dim #icon-sidebar:hover, body.focus-flow-dim #tabs-sidebar:hover, body.focus-flow-dim #top-tab-bar:hover, body.focus-flow-dim #gui-shortcuts-bar:hover { opacity:1; }`;
            document.head.appendChild(styleEl);
          }
          did.push('dimmed UI');
        } catch {}
      }
      // Optional site block via active-webview poll (self-contained — no nav hooks)
      let pollTimer = null;
      if ((flow.blockSites || []).length) {
        const blocked = flow.blockSites.slice();
        const isBlocked = (h) => blocked.some(b => h === b || h.endsWith('.' + b));
        pollTimer = setInterval(() => {
          try {
            const wv = (typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview) ? WebviewManager.getActiveWebview() : null;
            if (!wv) return;
            let url = ''; try { url = wv.getURL(); } catch {}
            if (!url) return;
            const h = this._host(url);
            if (h && isBlocked(h)) {
              try { if (wv.canGoBack()) wv.goBack(); else wv.loadURL(typeof START_URL !== 'undefined' ? START_URL : 'about:blank'); } catch {}
              window.showToast?.('🚫 ' + h + ' is blocked during "' + flow.name + '"');
            }
          } catch {}
        }, 1500);
        did.push('blocking ' + blocked.length + ' site(s)');
      }

      this._active = { flow, styleEl, pollTimer };
      this._showEndBar(flow);
      window.showToast?.('🎯 ' + flow.name + (did.length ? ' — ' + did.join(', ') : ''));
    } catch (e) { try { window.showToast?.('Could not start the flow'); } catch {} }
  },

  end() {
    try {
      const a = this._active; if (!a) return;
      try { if (a.pollTimer) clearInterval(a.pollTimer); } catch {}
      try { document.body.classList.remove('focus-flow-dim'); } catch {}
      try { document.getElementById('focus-flow-endbar')?.remove(); } catch {}
      this._active = null;
      window.showToast?.('Flow ended');
    } catch {}
  },

  _showEndBar(flow) {
    try {
      document.getElementById('focus-flow-endbar')?.remove();
      const bar = document.createElement('div');
      bar.id = 'focus-flow-endbar';
      bar.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:100001;display:flex;align-items:center;gap:12px;background:var(--surface,#222);color:var(--text,#eee);border:1px solid var(--border,#444);border-radius:11px;padding:8px 14px;box-shadow:0 8px 30px rgba(0,0,0,.4);font-family:'Outfit',sans-serif;font-size:12.5px";
      bar.innerHTML = `<span>${this._esc(flow.emoji || '🎯')} <b>${this._esc(flow.name)}</b> flow active</span><button id="ff-endbtn" style="${this._chip()}">End flow</button>`;
      document.body.appendChild(bar);
      bar.querySelector('#ff-endbtn').addEventListener('click', () => this.end());
    } catch {}
  },
};

if (typeof window !== 'undefined') window.FocusFlows = FocusFlows;
