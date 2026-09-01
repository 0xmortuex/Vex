// === Vex Site Settings (per-site profiles) ===
// One place for everything Vex remembers per website — zoom, forced dark mode,
// and custom CSS/JS boosts — for the site you're on, plus a list of every site
// you've customized. "A browser built for you," per site. Ctrl+K → "Site Settings".
const SiteProfiles = {
  _zooms() { try { return JSON.parse(localStorage.getItem('vex.zooms') || '{}') || {}; } catch { return {}; } },
  _saveZooms(z) { try { localStorage.setItem('vex.zooms', JSON.stringify(z)); } catch {} },
  _darkHosts() { try { const a = JSON.parse(localStorage.getItem('vex.forceDarkHosts') || '[]'); return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); } },
  _boosts() { try { return JSON.parse(localStorage.getItem('vex.boosts') || '{}') || {}; } catch { return {}; } },
  _neverSleepHosts() { try { const a = JSON.parse(localStorage.getItem('vex.neverSleepHosts') || '[]'); return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); } },
  _saveNeverSleep(set) { try { localStorage.setItem('vex.neverSleepHosts', JSON.stringify([...set])); } catch {} },

  _activeHost() { try { const t = TabManager.getActiveTab(); return t && t.url ? new URL(t.url).hostname.replace(/^www\./, '') : ''; } catch { return ''; } },
  _activeWebview() { try { return WebviewManager.getActiveWebview ? WebviewManager.getActiveWebview() : WebviewManager.webviews.get(TabManager.activeTabId); } catch { return null; } },
  _hostFromUrl(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } },

  async open() {
    document.getElementById('vex-siteprofiles')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-siteprofiles';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:560px;max-width:95vw;max-height:84vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;padding:18px 20px 10px">
        <span style="font-size:15px;font-weight:700;color:var(--text);flex:1">🌐 Site Settings</span>
        <button id="sp-close" style="${this._chip()}">✕</button>
      </div>
      <div id="sp-body" style="overflow-y:auto;padding:4px 20px 20px;font-size:12.5px;color:var(--text)"></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#sp-close').addEventListener('click', () => m.remove());
    this._paint(m);
  },

  _chip() { return "padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif"; },
  _btn() { return "min-width:30px;height:28px;padding:0 8px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:13px;font-family:'Outfit',sans-serif"; },

  _paint(m) {
    const body = m.querySelector('#sp-body'); if (!body) return;
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');
    const host = this._activeHost();
    const zooms = this._zooms(), dark = this._darkHosts(), boosts = this._boosts();
    const never = this._neverSleepHosts();
    const z = Math.round((zooms[host] || 1) * 100);

    let html = `<div style="font-size:11.5px;color:var(--text-muted);margin:2px 0 12px">Per-website preferences Vex remembers automatically — zoom, forced dark mode, and custom CSS/JS. They re-apply every time you visit that site.</div>`;
    if (host) {
      html += `<div style="font-weight:700;margin:6px 0 8px">This site · <span style="color:var(--primary,var(--accent))">${esc(host)}</span></div>
        <div style="display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--border);border-radius:9px;background:var(--bg);margin-bottom:6px">
          <span style="flex:1">Zoom</span>
          <button id="sp-zoom-out" style="${this._btn()}">−</button>
          <span id="sp-zoom-val" style="min-width:44px;text-align:center">${z}%</span>
          <button id="sp-zoom-in" style="${this._btn()}">+</button>
          <button id="sp-zoom-reset" style="${this._chip()}">Reset</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--border);border-radius:9px;background:var(--bg);margin-bottom:6px">
          <span style="flex:1">Force dark mode</span>
          <button id="sp-dark" style="${this._chip()}">${dark.has(host) ? '✓ On' : 'Off'}</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--border);border-radius:9px;background:var(--bg);margin-bottom:6px">
          <span style="flex:1">Never let this site sleep<br><span style="font-size:10.5px;color:var(--text-muted)">Keep it loaded in the background — skips Memory Saver &amp; auto-sleep</span></span>
          <button id="sp-nosleep" style="${this._chip()}">${never.has(host) ? '✓ On' : 'Off'}</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--border);border-radius:9px;background:var(--bg);margin-bottom:16px">
          <span style="flex:1">Custom CSS / JS ${boosts[host] ? '<span style="color:var(--primary,var(--accent))">· active</span>' : ''}</span>
          <button id="sp-zap" style="${this._chip()}">⚡ Zap element</button>
          <button id="sp-boost" style="${this._chip()}">Edit</button>
        </div>`;
    } else {
      html += `<div style="padding:12px;border:1px dashed var(--border);border-radius:9px;color:var(--text-muted);margin:2px 0 16px;font-size:12px">
        You're on the new-tab page — there's no website to tune here. Open a site (e.g. a news page), reopen this, and you'll get zoom, dark-mode and tweak controls for it. Any sites you've already customized are listed below.
      </div>`;
    }

    // All customized sites
    const allHosts = new Set([...Object.keys(zooms), ...dark, ...Object.keys(boosts)].filter(Boolean));
    html += `<div style="font-weight:700;margin:6px 0 8px">Customized sites <span style="font-size:11px;color:var(--text-muted);font-weight:400">· ${allHosts.size}</span></div>`;
    if (allHosts.size) {
      html += '<div style="border:1px solid var(--border);border-radius:9px;overflow:hidden">' +
        [...allHosts].sort().map(h => {
          const badges = [];
          if (zooms[h]) badges.push(Math.round(zooms[h] * 100) + '%');
          if (dark.has(h)) badges.push('🌙');
          if (boosts[h]) badges.push('⚡');
          return `<div data-host="${esc(h)}" style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--border)">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" data-act="go">${esc(h)}</span>
            <span style="color:var(--text-muted);font-size:11px">${badges.join(' ')}</span>
            <button data-act="reset" title="Reset this site" style="${this._chip()}">↺</button>
          </div>`;
        }).join('') + '</div>';
    } else html += `<div style="color:var(--text-muted);font-size:12px">Nothing customized yet.</div>`;

    body.innerHTML = html;
    this._wire(m, host);
  },

  _wire(m, host) {
    const body = m.querySelector('#sp-body');
    const wv = this._activeWebview();
    const setZoom = (delta, reset) => {
      const zooms = this._zooms();
      let f = reset ? 1 : Math.max(0.3, Math.min(3, (zooms[host] || 1) + delta));
      if (reset) delete zooms[host]; else zooms[host] = f;
      this._saveZooms(zooms);
      try { if (wv) wv.setZoomFactor(f); } catch {}
      const val = body.querySelector('#sp-zoom-val'); if (val) val.textContent = Math.round(f * 100) + '%';
    };
    body.querySelector('#sp-zoom-in')?.addEventListener('click', () => setZoom(0.1));
    body.querySelector('#sp-zoom-out')?.addEventListener('click', () => setZoom(-0.1));
    body.querySelector('#sp-zoom-reset')?.addEventListener('click', () => setZoom(0, true));
    body.querySelector('#sp-dark')?.addEventListener('click', (e) => {
      try { if (wv && WebviewManager.toggleForceDarkForSite) WebviewManager.toggleForceDarkForSite(wv); } catch {}
      setTimeout(() => this._paint(m), 60);
    });
    body.querySelector('#sp-nosleep')?.addEventListener('click', () => {
      const set = this._neverSleepHosts();
      if (set.has(host)) { set.delete(host); }
      else {
        set.add(host);
        // Take effect now: bring the tab (and any others on this host) fully alive.
        try { (TabManager.tabs || []).forEach(t => { if (this._hostFromUrl(t.url) === host) { if (t.sleeping) TabManager.wakeTab(t.id); else if (t._lazy) TabManager._materializeTab(t); } }); } catch {}
      }
      this._saveNeverSleep(set);
      try { window.showToast?.(set.has(host) ? host + ' will stay awake' : host + ' can sleep again'); } catch {}
      this._paint(m);
    });
    body.querySelector('#sp-boost')?.addEventListener('click', () => { try { if (typeof VexBoosts !== 'undefined') VexBoosts.openEditor(); } catch {} m.remove(); });
    body.querySelector('#sp-zap')?.addEventListener('click', () => { try { if (typeof VexBoosts !== 'undefined') VexBoosts.startZapper(); } catch {} m.remove(); });

    body.querySelectorAll('[data-host]').forEach(row => {
      const h = row.dataset.host;
      row.querySelector('[data-act="go"]')?.addEventListener('click', () => { try { TabManager.createTab('https://' + h, true); } catch {} m.remove(); });
      row.querySelector('[data-act="reset"]')?.addEventListener('click', () => { this._resetSite(h); this._paint(m); });
    });
  },

  _resetSite(h) {
    try { const z = this._zooms(); delete z[h]; this._saveZooms(z); } catch {}
    try { const a = [...this._darkHosts()].filter(x => x !== h); localStorage.setItem('vex.forceDarkHosts', JSON.stringify(a)); } catch {}
    try { const b = this._boosts(); delete b[h]; localStorage.setItem('vex.boosts', JSON.stringify(b)); } catch {}
    try { window.showToast?.('Reset ' + h); } catch {}
  },
};

if (typeof window !== 'undefined') window.SiteProfiles = SiteProfiles;
