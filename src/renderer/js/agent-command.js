// === Vex Agent Command bar ===
// Type a request in plain English and Vex does it. Common tab/window actions are
// understood LOCALLY (instant, works offline) — "close all youtube tabs", "sleep
// the others", "group my shopping tabs", "split screen", "keep this awake". Only
// requests it can't parse itself are handed to the AI tab-manager. Destructive
// actions always show a plan and ask first. Ctrl+K → "Ask Vex to do something…".
const AgentCommand = {
  open() {
    document.getElementById('vex-agentcmd')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-agentcmd';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.5);display:flex;align-items:flex-start;justify-content:center;padding-top:14vh';
    m.innerHTML = `<div style="width:520px;max-width:94vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:15px">✨</span>
        <input id="ac-input" placeholder="Ask Vex to do something…" style="flex:1;padding:10px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:9px;font-size:13.5px;font-family:'Outfit',sans-serif" autofocus>
      </div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px">e.g. "close all youtube tabs" · "sleep the other tabs" · "group my github tabs" · "split screen" · "keep this awake" · "mute everything"</div>
      <div id="ac-plan"></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    const input = m.querySelector('#ac-input');
    input.focus();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._run(m, input.value.trim()); if (e.key === 'Escape') m.remove(); });
  },

  _matchTabs(kw) {
    kw = (kw || '').toLowerCase().trim();
    if (!kw) return [];
    return TabManager.tabs.filter(t => ((t.title || '') + ' ' + (t.url || '')).toLowerCase().includes(kw));
  },

  // Parse a local intent → { verb, desc, run } or null if unknown.
  _parse(q) {
    const s = q.toLowerCase().trim();
    let m;

    // split screen
    if (/^(split|split ?screen|split view)\b/.test(s)) {
      const n = (s.match(/\b([234])\b/) || [])[1];
      return { desc: 'Open split screen' + (n ? ' (' + n + ' panes)' : ''), run: () => { try { n ? SplitScreen.activate(parseInt(n, 10)) : SplitScreen.activate(2); } catch { try { SplitScreen.toggle(); } catch {} } } };
    }
    // reload
    if (/^(reload|refresh)( this| page| tab)?$/.test(s)) return { desc: 'Reload this page', run: () => { try { WebviewManager.getActiveWebview().reload(); } catch {} } };
    // new tab / open site
    if ((m = s.match(/^(?:open|go to|new tab(?: to)?)\s+(.+)$/))) {
      let u = m[1].trim();
      const url = /^https?:\/\//.test(u) ? u : (/\.\w{2,}($|\/)/.test(u) ? 'https://' + u : 'https://www.google.com/search?q=' + encodeURIComponent(u));
      return { desc: 'Open ' + u, run: () => { try { TabManager.createTab(url, true); } catch {} } };
    }
    // mute
    if (/^mute (all|everything|every tab)/.test(s)) return { desc: 'Mute all tabs', run: () => { try { TabManager.tabs.forEach(t => { const wv = WebviewManager.webviews.get(t.id); if (wv && wv.setAudioMuted) { wv.setAudioMuted(true); t.muted = true; } }); window.showToast?.('Muted all tabs'); } catch {} } };
    if ((m = s.match(/^mute (?:all )?(.+?) tabs?$/))) { const hits = this._matchTabs(m[1]); return { desc: 'Mute ' + hits.length + ' “' + m[1] + '” tab(s)', run: () => hits.forEach(t => { const wv = WebviewManager.webviews.get(t.id); if (wv && wv.setAudioMuted) { wv.setAudioMuted(true); t.muted = true; } }) }; }
    // sleep
    if (/^sleep (the )?(other|others|rest|idle|inactive)/.test(s)) return { desc: 'Sleep the other tabs', run: () => { try { TabManager.sleepAllInactive(); window.showToast?.('Slept idle tabs'); } catch {} } };
    if (/^sleep (all|everything)/.test(s)) return { desc: 'Sleep all background tabs', run: () => { try { TabManager.sleepAllInactive(); } catch {} } };
    if ((m = s.match(/^sleep (?:all )?(.+?) tabs?$/))) { const hits = this._matchTabs(m[1]).filter(t => t.id !== TabManager.activeTabId); return { desc: 'Sleep ' + hits.length + ' “' + m[1] + '” tab(s)', run: () => hits.forEach(t => { try { TabManager.sleepTab(t.id, true); } catch {} }) }; }
    // keep awake
    if (/^(keep|never sleep).*(this|current)/.test(s) || /^keep this awake/.test(s)) return { desc: 'Keep this tab awake', run: () => { const t = TabManager.getActiveTab(); if (t) { t.keepAwakeUntil = Number.MAX_SAFE_INTEGER; try { if (t._lazy) TabManager._materializeTab(t); TabManager._refreshKeepAwakeIndicator(t); TabManager.persistTabs(); } catch {} window.showToast?.('This tab will never sleep'); } } };
    // group
    if ((m = s.match(/^group (?:my |the |all )?(.+?)(?: tabs?)?$/)) && !/screen|window/.test(s)) {
      const hits = this._matchTabs(m[1]).filter(t => t.id);
      if (hits.length >= 2) return { desc: 'Group ' + hits.length + ' “' + m[1] + '” tab(s)', run: () => { try { const gid = 'g-' + Date.now(); TabManager.groups.push({ id: gid, name: m[1], color: '#d4a574', collapsed: false }); hits.forEach(t => { t.groupId = gid; }); if (typeof VexStorage !== 'undefined') VexStorage.saveGroups(TabManager.groups); TabManager.persistTabs(); TabManager.rebuildAllTabs(); } catch {} } };
    }
    // close
    if (/^close (all |every )?(other|others|the rest)/.test(s)) { const hits = TabManager.tabs.filter(t => t.id !== TabManager.activeTabId); return { destructive: true, desc: 'Close ' + hits.length + ' other tab(s)', run: () => hits.forEach(t => { try { TabManager.closeTab(t.id); } catch {} }) }; }
    if ((m = s.match(/^close (?:all |every )?(.+?) tabs?$/))) { const hits = this._matchTabs(m[1]).filter(t => t.id !== TabManager.activeTabId); return { destructive: true, desc: 'Close ' + hits.length + ' “' + m[1] + '” tab(s)', run: () => hits.forEach(t => { try { TabManager.closeTab(t.id); } catch {} }) }; }

    return null;
  },

  _run(m, q) {
    if (!q) return;
    const plan = this._parse(q);
    const el = m.querySelector('#ac-plan');
    if (!plan) {
      // Hand off to the AI tab-manager for anything we can't parse ourselves.
      el.innerHTML = `<div style="font-size:12px;color:var(--text-muted);padding:8px 0">Not a built-in action — asking the AI tab manager…</div>`;
      setTimeout(() => { m.remove(); try { if (typeof TabAI !== 'undefined') TabAI.open(); } catch {} }, 500);
      return;
    }
    const chip = "padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12.5px;font-family:'Outfit',sans-serif;border:1px solid var(--border);background:var(--bg);color:var(--text)";
    const prim = "padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:600;font-family:'Outfit',sans-serif;border:1px solid transparent;background:var(--primary,var(--accent,#d4a574));color:#111";
    if (plan.destructive) {
      el.innerHTML = `<div style="padding:10px 12px;border:1px solid var(--border);border-radius:9px;background:var(--bg);margin-top:4px">
        <div style="margin-bottom:8px">${window.escapeHtml ? window.escapeHtml(plan.desc) : plan.desc}?</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="ac-cancel" style="${chip}">Cancel</button>
          <button id="ac-do" style="${prim}">Do it</button>
        </div></div>`;
      el.querySelector('#ac-cancel').addEventListener('click', () => m.remove());
      el.querySelector('#ac-do').addEventListener('click', () => { try { plan.run(); } catch {} m.remove(); });
    } else {
      try { plan.run(); } catch {}
      window.showToast?.('✨ ' + plan.desc);
      m.remove();
    }
  },
};

if (typeof window !== 'undefined') window.AgentCommand = AgentCommand;
