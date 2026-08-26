// === Vex First-Run Onboarding ===
//
// A step-by-step setup wizard. Shown once on a fresh install, and re-openable
// anytime from the top-bar setup button. Walks the user through everything worth
// configuring — theme, name, weather, GitHub, search engine, default browser,
// the three AI backends (cloud / Ollama / on-device), Vex Sync, and the password
// manager — with a Skip on every step and a "Skip setup" to bail at any point.
//
// Re-opening RESUMES rather than restarts: only the steps with nothing saved yet
// are shown (see _missingStepKeys), so a paused setup never makes you redo work.
//
// Start-page values (name/weather/GitHub/search) live in the start page's OWN
// localStorage (separate webview session), so we write them there via the live
// webview AND mirror to host localStorage (where Settings reads them), then
// reload the start page so it picks them up.

const Onboarding = {
  KEY: 'vex.onboardingDone',
  step: 0,
  activeSteps: null,   // the step list currently being walked (full run or resume subset)
  _pendingLoc: null,   // weather location the user picked from the results list
  _session: {},        // values typed this run — survive Back/Skip so navigation never loses input
  _keyHandler: null,   // document-level Escape handler, live only while the wizard is open

  done() { try { return localStorage.getItem(this.KEY) === 'true'; } catch { return true; } },
  finish() {
    try { localStorage.setItem(this.KEY, 'true'); } catch {}
    // The wizard is now the single first-run welcome and owns the tour entry
    // point (its final step's "Take a tour" button). Mark the tour as seen so
    // app.js never auto-offers it separately; launch it only if asked.
    const wantTour = this._wantTour;
    try { localStorage.setItem('vex.tourSeen', '1'); } catch {}
    this._close();
    this._reloadStartPages();
    if (wantTour) setTimeout(() => { try { window.VexTour?.start?.(); } catch {} }, 450);
  },

  // Show only on a genuinely fresh install — never to existing users on update.
  maybeStart() {
    if (this.done()) return;
    const EVIDENCE = ['vex.tabs', 'vex.sessions', 'vex.bookmarks', 'vex.notes', 'vex.history', 'vex.aiWorkerUrl', 'vex.userName', 'vex.githubUsername', 'vex.weatherLoc', 'vex.personas'];
    const used = EVIDENCE.some(k => { try { return localStorage.getItem(k) != null; } catch { return false; } });
    if (used) { this.finish(); return; }            // existing install — mark done, don't nag
    setTimeout(() => this.start(), 900);
  },

  start() { this.activeSteps = this.STEPS(); this.step = 0; this._pendingLoc = null; this._session = {}; this._wantTour = false; this._render(); },

  // Re-open the wizard on demand (the top-bar setup button). Shows ALL steps,
  // each pre-filled with whatever's already saved and tagged "✓ already set" so
  // nothing is hidden but you're not redoing anything from scratch.
  relaunch() {
    this.activeSteps = this.STEPS();
    this.step = 0;
    this._pendingLoc = null;
    this._session = {};
    this._wantTour = false;
    this._render();
  },

  _has(k) { try { const v = localStorage.getItem(k); return v != null && v !== ''; } catch { return false; } },
  _flag(k) { try { return localStorage.getItem(k) === 'true'; } catch { return false; } },

  // Is this step already configured? Each AI backend is judged independently, so
  // setting up cloud AI doesn't mark the Ollama / on-device steps as done.
  _isStepDone(key) {
    switch (key) {
      case 'setupstyle':     return this._has('vex.setupProfile');
      case 'language':       return this._has('vex.lang');
      case 'wisdom':         return this._has('vex.wisdomSource');
      case 'theme':          return this._has('vex.theme');
      case 'name':           return this._has('vex.userName');
      case 'weather':        return this._has('vex.weatherLoc');
      case 'github':         return this._has('vex.githubUsername');
      case 'search':         return this._has('vex.searchEngine');
      case 'defaultbrowser': return this._flag('vex.defaultBrowserConfigured');
      case 'aicloud':        return this._has('vex.aiWorkerUrl');
      case 'ollama':         return this._flag('vex.preferLocalAI');
      case 'ondevice':       return this._flag('vex.preferOnDeviceAI');
      case 'sync':           return this._has('vex.syncWorkerUrl');
      case 'passwords':      return this._flag('vex.vaultSeeded');
      default:               return false;
    }
  },

  // --- write a value to host localStorage AND the live start-page webview(s) ---
  _setStart(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {}
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) return;
    const js = value == null
      ? `try{localStorage.removeItem(${JSON.stringify(key)})}catch(e){}`
      : `try{localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(String(value))})}catch(e){}`;
    for (const wv of WebviewManager.webviews.values()) {
      let url = ''; try { url = wv.getURL(); } catch {}
      if (url && (url.startsWith('vex://start') || /\/renderer\/start\.html/i.test(url))) {
        try { wv.executeJavaScript(js).catch(() => {}); } catch {}
      }
    }
  },
  _reloadStartPages() {
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) return;
    for (const wv of WebviewManager.webviews.values()) {
      let url = ''; try { url = wv.getURL(); } catch {}
      if (url && (url.startsWith('vex://start') || /\/renderer\/start\.html/i.test(url))) {
        try { wv.reload(); } catch {}
      }
    }
  },

  _esc(s) { return window.escapeHtml(s); },

  STEPS() {
    return [
      { key: 'welcome',        title: 'Welcome to Vex 👋',        sub: 'Let’s set up the bits that make Vex feel like yours. Skip anything you don’t want — you can re-open this wizard anytime from the ✦ button by the reload button.' },
      { key: 'setupstyle',     title: 'Choose your starting point', sub: 'Vex ships fully loaded — but it doesn’t have to be. Pick how much you want; every choice here can be changed later in Settings → Sidebar.' },
      { key: 'theme',          title: 'Pick a theme',             sub: 'You can change this anytime from the start page or Settings.' },
      { key: 'language',       title: 'Language · Dil',           sub: 'Sets the start page language — greeting, labels, and the daily verse. (Full interface translation is on the roadmap.)' },
      { key: 'wisdom',         title: 'Daily wisdom',             sub: 'A short verse or quote on your start page each day. Pick your tradition — or turn it off entirely.' },
      { key: 'name',           title: 'What should we call you?', sub: 'Used only for the start-page greeting. Leave blank for none.' },
      { key: 'weather',        title: 'Weather location',         sub: 'Type a city OR a district (e.g. “Ataşehir”), then pick the right match for accurate weather.' },
      { key: 'github',         title: 'GitHub username',          sub: 'Optional — shows your repo/follower stats + activity on the start page.' },
      { key: 'search',         title: 'Default search engine',    sub: 'Which search engine the URL bar and start page use.' },
      { key: 'defaultbrowser', title: 'Make Vex your default',    sub: 'So links from Discord, email, and other apps open in Vex.' },
      { key: 'aicloud',        title: 'Cloud AI (Claude)',        sub: 'Paste your self-hosted Vex AI Worker URL for the most capable AI. See SELF_HOSTING.md. Skip if you’ll use local AI instead.' },
      { key: 'ollama',         title: 'Local AI (Ollama)',        sub: 'Run models locally with Ollama — private and free. We’ll detect a running Ollama for you.' },
      { key: 'ondevice',       title: 'On-device AI (WebGPU)',    sub: 'Run a small model fully inside Vex — private, offline, no install. Great if you don’t have Ollama.' },
      { key: 'sync',           title: 'Vex Sync',                 sub: 'End-to-end encrypted sync of tabs, bookmarks & more across devices. Paste your Sync Worker URL (optional).' },
      { key: 'passwords',      title: 'Password manager',         sub: 'Vex has a built-in, OS-encrypted password vault. Add your first login now, or skip and add them as you browse.' },
      { key: 'done',           title: 'All set ✨',               sub: 'You’re ready. Everything here lives in Settings if you want to change it later.' },
    ];
  },

  _close() {
    document.getElementById('vex-onboarding')?.remove();
    if (this._keyHandler) { document.removeEventListener('keydown', this._keyHandler); this._keyHandler = null; }
  },

  // Snapshot whatever's typed on the current step so Back/Skip navigation
  // (which re-renders from scratch) never throws away this session's input.
  _stash(key, overlay) {
    const grab = (sel) => { const el = overlay.querySelector(sel); return el ? el.value : null; };
    if (key === 'setupstyle')   this._stashSetupStyle(overlay);
    else if (key === 'language') this._session.lang = this._pendingLang;
    else if (key === 'wisdom')  this._session.wisdom = this._pendingWisdom;
    else if (key === 'name')    this._session.name = grab('#ob-name');
    else if (key === 'github')  this._session.github = grab('#ob-gh');
    else if (key === 'aicloud') this._session.aicloud = grab('#ob-ai-url');
    else if (key === 'sync')    this._session.sync = grab('#ob-sync-url');
    else if (key === 'weather') this._session.weatherText = grab('#ob-city');
    else if (key === 'search')  this._session.engine = this._pendingEngine;
  },

  _render() {
    const steps = this.activeSteps || this.STEPS();
    const s = steps[this.step];
    if (!s) { this.finish(); return; }
    this._close();
    const overlay = document.createElement('div');
    overlay.id = 'vex-onboarding';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100060;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-family:\'Outfit\',sans-serif';
    const dots = steps.map((_, i) => `<span style="width:7px;height:7px;border-radius:50%;background:${i === this.step ? 'var(--primary)' : 'var(--border)'};display:inline-block"></span>`).join(' ');
    const isLast = this.step === steps.length - 1;
    const pct = Math.round(((this.step + 1) / steps.length) * 100);
    overlay.innerHTML = `
      <div style="width:520px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,0.55);overflow:hidden">
        <div style="padding:24px 26px 8px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px"><span id="ob-progress-label" style="font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace">Step ${this.step + 1} of ${steps.length}</span><span style="flex:1"></span>${dots}</div>
          <div style="height:4px;background:var(--border);border-radius:999px;overflow:hidden;margin-top:6px"><div id="ob-progress-fill" style="height:100%;width:${pct}%;background:var(--primary);border-radius:999px;transition:width 0.25s ease"></div></div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap">
            <span style="font-size:21px;font-weight:700;color:var(--text)">${this._esc(s.title)}</span>
            ${this._isStepDone(s.key) ? '<span style="font-size:11px;font-weight:600;color:#34d399;background:rgba(52,211,153,0.12);border:1px solid rgba(52,211,153,0.4);padding:3px 9px;border-radius:999px;white-space:nowrap">✓ already set</span>' : ''}
          </div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:6px;line-height:1.5">${this._esc(s.sub)}</div>
        </div>
        <div id="ob-body" style="padding:14px 26px;overflow-y:auto;flex:1"></div>
        <div style="display:flex;align-items:center;gap:8px;padding:16px 26px;border-top:1px solid var(--border)">
          <button id="ob-skipall" style="background:none;border:none;color:var(--text-muted);font-family:inherit;font-size:12.5px;cursor:pointer">Skip setup</button>
          <span style="flex:1"></span>
          ${this.step > 0 ? `<button id="ob-back" style="padding:9px 16px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:9px;cursor:pointer;font-family:inherit;font-size:13px">Back</button>` : ''}
          ${!isLast ? `<button id="ob-skip" style="padding:9px 16px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:9px;cursor:pointer;font-family:inherit;font-size:13px">Skip</button>` : ''}
          <button id="ob-next" style="padding:9px 22px;background:var(--primary);color:#fff;border:none;border-radius:9px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600">${this.step === 0 ? 'Get started' : isLast ? 'Finish' : 'Save &amp; continue'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#ob-skipall').addEventListener('click', () => this.finish());
    overlay.querySelector('#ob-back')?.addEventListener('click', () => { this._stash(s.key, overlay); this.step--; this._render(); });
    overlay.querySelector('#ob-skip')?.addEventListener('click', () => { this._stash(s.key, overlay); this.step++; this._render(); });
    overlay.querySelector('#ob-next').addEventListener('click', () => this._commitAndNext(s.key, overlay));
    // Escape = the same bail-out as the "Skip setup" button.
    this._keyHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.finish(); } };
    document.addEventListener('keydown', this._keyHandler);
    this._renderBody(s.key, overlay.querySelector('#ob-body'));
  },

  _input(id, ph, val) {
    return `<input id="${id}" placeholder="${this._esc(ph)}" value="${this._esc(val || '')}" spellcheck="false" autocomplete="off" style="width:100%;box-sizing:border-box;padding:11px 13px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:14px;outline:none;font-family:'Outfit',sans-serif">`;
  },

  // === Setup style — Full Vex / Minimal / Custom pick-and-choose ===
  //
  // The sidebar app panels the profiles govern. Core surfaces (start,
  // downloads, history, bookmarks, settings) are never hidden here — a
  // browser without them reads as broken, and the Sidebar manager can hide
  // them later if someone really wants to.
  _APP_PANELS() {
    return [
      { id: 'whatsapp',    name: 'WhatsApp' },
      { id: 'claude',      name: 'Claude AI' },
      { id: 'spotify',     name: 'Spotify' },
      { id: 'netflix',     name: 'Netflix' },
      { id: 'discord',     name: 'Discord' },
      { id: 'roblox',      name: 'Roblox' },
      { id: 'github',      name: 'GitHub stats' },
      { id: 'notes',       name: 'Notes' },
      { id: 'queue',       name: 'Tab queue' },
      { id: 'feeds',       name: 'RSS feeds' },
      { id: 'annotations', name: 'Annotations' },
      { id: 'recall',      name: 'Recall' },
      { id: 'memory',      name: 'AI memory' },
      { id: 'schedules',   name: 'Schedules' },
      { id: 'library',     name: 'Library' },
    ];
  },
  _shortcutDefaults() {
    try { const d = window.VexGuiStyle?.defaults?.(); if (Array.isArray(d) && d.length) return d; } catch {}
    return [{ name: 'Google', url: 'https://www.google.com' }, { name: 'YouTube', url: 'https://www.youtube.com' }];
  },

  // Mini browser-mockup thumbnails for the setup-style cards — a glanceable
  // preview of what each profile turns the chrome into. Pure presentational
  // SVG built from theme tokens so they recolor with the theme.
  _setupThumb(kind) {
    const P = 'var(--primary)', B = 'var(--border)', M = 'var(--text-muted)';
    const frame = (inner) => `
      <svg width="76" height="52" viewBox="0 0 76 52" fill="none" aria-hidden="true" style="flex-shrink:0">
        <rect x="1" y="1" width="74" height="50" rx="6" stroke="${B}" stroke-width="1.5" fill="none"/>
        ${inner}
      </svg>`;
    const rail = (n) => Array.from({ length: n }, (_, i) =>
      `<circle cx="8.5" cy="${13 + i * 6.4}" r="2.2" fill="${i === 0 ? P : M}" opacity="${i === 0 ? 1 : 0.55}"/>`).join('');
    const chips = (n) => Array.from({ length: n }, (_, i) =>
      `<rect x="${17 + i * 14}" y="6" width="11" height="4.5" rx="2.25" fill="${i === 0 ? P : M}" opacity="${i === 0 ? 0.9 : 0.45}"/>`).join('');
    if (kind === 'owner') return frame(`${chips(4)}${rail(6)}<rect x="17" y="14" width="53" height="32" rx="3" fill="${P}" opacity="0.14"/><rect x="21" y="19" width="30" height="3" rx="1.5" fill="${M}" opacity="0.6"/><rect x="21" y="26" width="42" height="3" rx="1.5" fill="${M}" opacity="0.35"/>`);
    if (kind === 'minimal') return frame(`${rail(3)}<rect x="17" y="8" width="53" height="38" rx="3" fill="${M}" opacity="0.08"/><rect x="30" y="24" width="27" height="3.5" rx="1.75" fill="${M}" opacity="0.5"/>`);
    if (kind === 'custom') return frame(`${rail(4)}<rect x="17" y="8" width="53" height="38" rx="3" fill="${M}" opacity="0.06"/>
      <rect x="22" y="14" width="8" height="8" rx="2" stroke="${P}" stroke-width="1.5" fill="none"/><path d="M24 18l2 2 3-3.5" stroke="${P}" stroke-width="1.5" stroke-linecap="round" fill="none"/>
      <rect x="34" y="14" width="8" height="8" rx="2" stroke="${M}" stroke-width="1.5" fill="none" opacity="0.5"/>
      <rect x="22" y="27" width="8" height="8" rx="2" stroke="${P}" stroke-width="1.5" fill="none"/><path d="M24 31l2 2 3-3.5" stroke="${P}" stroke-width="1.5" stroke-linecap="round" fill="none"/>
      <rect x="34" y="27" width="8" height="8" rx="2" stroke="${M}" stroke-width="1.5" fill="none" opacity="0.5"/>`);
    // 'code' — a shared setup code
    return frame(`<path d="M28 18l-8 8 8 8M48 18l8 8-8 8" stroke="${P}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><rect x="35.5" y="16" width="5" height="20" rx="2.5" transform="rotate(14 38 26)" fill="${M}" opacity="0.5"/>`);
  },

  // === Shareable setup codes ("VEXSETUP1.<base64url json>") ===
  // Captures theme + Glass/Classic + hidden panels + shortcut bar. Compact
  // enough to paste in a chat; versioned so future fields stay decodable.
  _encodeSetupCode() {
    let theme = null, shortcuts = null, ov = {};
    try { theme = localStorage.getItem('vex.theme') || null; } catch {}
    try { const sc = JSON.parse(localStorage.getItem('vex.shortcuts') || 'null'); if (Array.isArray(sc)) shortcuts = sc.map(s => ({ name: s.name || '', url: s.url })); } catch {}
    try { ov = JSON.parse(localStorage.getItem('vex.panelOverrides') || '{}') || {}; } catch {}
    const APP = this._APP_PANELS().map(p => p.id);
    const data = {
      v: 1,
      theme,
      glass: (() => { try { return (window.VexGuiStyle?.get?.() || 'classic') === 'glass'; } catch { return false; } })(),
      hidden: APP.filter(p => ov[p] && ov[p].hidden),
      shortcuts,   // null = stock set
    };
    const json = JSON.stringify(data);
    const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return 'VEXSETUP1.' + b64;
  },

  // Returns the decoded + sanitized setup object, or null if the code is not
  // a valid setup code. Sanitizing here means import can never smuggle in
  // arbitrary keys, unknown panels, or non-http(s) shortcut URLs.
  _decodeSetupCode(code) {
    try {
      code = String(code || '').trim();
      const m = code.match(/^VEXSETUP1\.([A-Za-z0-9_-]+)$/);
      if (!m) return null;
      const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(escape(atob(b64 + '==='.slice(0, (4 - b64.length % 4) % 4))));
      const d = JSON.parse(json);
      if (!d || d.v !== 1) return null;
      const APP = new Set(this._APP_PANELS().map(p => p.id));
      const out = {
        theme: typeof d.theme === 'string' && /^[a-z0-9-]{1,40}$/i.test(d.theme) ? d.theme : null,
        glass: !!d.glass,
        hidden: Array.isArray(d.hidden) ? d.hidden.filter(p => APP.has(p)) : [],
        shortcuts: null,
      };
      if (Array.isArray(d.shortcuts)) {
        out.shortcuts = d.shortcuts
          .filter(s => s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url))
          .slice(0, 24)
          .map(s => ({ name: String(s.name || '').slice(0, 40), url: s.url.slice(0, 500) }));
      }
      return out;
    } catch { return null; }
  },

  _applySetupCode(d) {
    const APP = this._APP_PANELS().map(p => p.id);
    let ov = {};
    try { ov = JSON.parse(localStorage.getItem('vex.panelOverrides') || '{}') || {}; } catch {}
    for (const p of APP) {
      if (d.hidden.includes(p)) ov[p] = Object.assign({}, ov[p], { hidden: true });
      else if (ov[p]) { delete ov[p].hidden; if (!Object.keys(ov[p]).length) delete ov[p]; }
    }
    try { localStorage.setItem('vex.panelOverrides', JSON.stringify(ov)); } catch {}
    try { if (typeof SidebarManager !== 'undefined') SidebarManager.applyPanelOverrides(); } catch {}
    this._setStart('vex.shortcuts', d.shortcuts == null ? null : JSON.stringify(d.shortcuts));
    try { window.VexGuiStyle?.render?.(); } catch {}
    try { window.VexGuiStyle?.set?.(d.glass ? 'glass' : 'classic'); } catch {}
    if (d.theme) {
      try {
        const themes = (typeof ThemeManager !== 'undefined' && ThemeManager.THEMES) || [];
        if (themes.some(t => t.id === d.theme)) ThemeManager.applyTheme(d.theme);
      } catch {}
    }
    try { localStorage.setItem('vex.setupProfile', 'imported'); } catch {}
  },

  _renderSetupStyle(body) {
    const APP = this._APP_PANELS();
    const SC = this._shortcutDefaults();
    // Session state survives Back/Skip; first open pre-selects the saved
    // profile (relaunch) or Full Vex (fresh install — matches what they see).
    if (!this._session.setup) {
      let saved = null; try { saved = localStorage.getItem('vex.setupProfile'); } catch {}
      this._session.setup = {
        profile: (saved === 'imported' ? 'code' : saved) || 'owner',
        panels: APP.map(p => p.id),
        shortcuts: SC.map(s => s.name),
        glass: (() => { try { return (window.VexGuiStyle?.get?.() || 'classic') === 'glass'; } catch { return false; } })(),
        code: '',
      };
    }
    const sel = this._session.setup;
    const card = (id, title, desc) => `
      <button data-profile="${id}" style="text-align:left;display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:12px;border:2px solid ${sel.profile === id ? 'var(--primary)' : 'var(--border)'};background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit">
        ${this._setupThumb(id)}
        <span style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:14px;font-weight:700">${this._esc(title)}</span>
          <span style="font-size:12px;color:var(--text-muted);line-height:1.45">${this._esc(desc)}</span>
        </span>
      </button>`;
    const check = (kind, id, label, on) => `
      <label style="display:flex;align-items:center;gap:7px;padding:7px 9px;border:1px solid var(--border);border-radius:8px;background:var(--bg);cursor:pointer;font-size:12px;color:var(--text)">
        <input type="checkbox" data-${kind}="${this._esc(id)}" ${on ? 'checked' : ''} style="accent-color:var(--primary)">${this._esc(label)}
      </label>`;
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:9px">
        ${card('owner', 'The Mortuex Setup', 'Vex fully loaded — every app panel (WhatsApp, Discord, Spotify, Netflix…), the full shortcut bar, the Glass look. Exactly how Vex’s creator runs it.')}
        ${card('minimal', 'Minimal', 'Just a fast, clean browser: tabs, downloads, history, bookmarks, settings. No app panels, an empty shortcut bar. Add features whenever you want them.')}
        ${card('custom', 'Custom', 'Pick exactly which app panels and shortcuts you keep — check what you want, uncheck the rest.')}
        ${card('code', 'Use a shared setup', 'Got a setup code from a friend or a creator? Paste it and Vex arranges itself to match — panels, shortcuts, theme, look.')}
        <div id="ob-setup-custom" style="display:${sel.profile === 'custom' ? 'flex' : 'none'};flex-direction:column;gap:10px;padding:12px;border:1px dashed var(--border);border-radius:12px">
          <div style="font-size:12px;font-weight:700;color:var(--text)">Sidebar app panels <span id="ob-setup-count" style="font-weight:400;color:var(--text-muted)"></span></div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px">${APP.map(p => check('panel', p.id, p.name, sel.panels.includes(p.id))).join('')}</div>
          <div style="font-size:12px;font-weight:700;color:var(--text);margin-top:2px">Shortcut bar</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px">${SC.map(s => check('shortcut', s.name, s.name, sel.shortcuts.includes(s.name))).join('')}</div>
          <label style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text);cursor:pointer;margin-top:2px">
            <input type="checkbox" id="ob-setup-glass" ${sel.glass ? 'checked' : ''} style="accent-color:var(--primary)">Glass look — frosted UI, tabs on top, shortcut bar
          </label>
        </div>
        <div id="ob-setup-code" style="display:${sel.profile === 'code' ? 'flex' : 'none'};flex-direction:column;gap:8px;padding:12px;border:1px dashed var(--border);border-radius:12px">
          ${this._input('ob-setup-code-input', 'VEXSETUP1.…', sel.code)}
          <div id="ob-setup-code-status" style="font-size:12px;color:var(--text-muted);min-height:16px"></div>
        </div>
        <button id="ob-setup-export" style="align-self:flex-start;background:none;border:none;color:var(--text-muted);font-family:inherit;font-size:12px;cursor:pointer;padding:2px 0;text-decoration:underline;text-underline-offset:3px">📤 Copy my current setup as a shareable code</button>
      </div>`;
    const updateCount = () => {
      const el = body.querySelector('#ob-setup-count');
      if (el) el.textContent = `· ${body.querySelectorAll('[data-panel]:checked').length} of ${APP.length} kept`;
    };
    // Live validation so a pasted code is judged before Save & continue.
    const validateCode = () => {
      const st = body.querySelector('#ob-setup-code-status');
      const raw = body.querySelector('#ob-setup-code-input')?.value.trim() || '';
      if (!st) return;
      if (!raw) { st.textContent = 'Paste a code that starts with VEXSETUP1.'; st.style.color = 'var(--text-muted)'; return; }
      const d = this._decodeSetupCode(raw);
      if (!d) { st.textContent = '✗ Not a valid setup code — check it copied completely.'; st.style.color = 'var(--danger, #ef4444)'; return; }
      const sc = d.shortcuts == null ? 'stock shortcuts' : `${d.shortcuts.length} shortcut${d.shortcuts.length === 1 ? '' : 's'}`;
      st.textContent = `✓ Valid — ${APP.length - d.hidden.length} of ${APP.length} panels, ${sc}, ${d.glass ? 'Glass' : 'Classic'} look${d.theme ? `, “${d.theme}” theme` : ''}.`;
      st.style.color = 'var(--text)';
    };
    updateCount();
    validateCode();
    body.querySelectorAll('[data-profile]').forEach(b => b.addEventListener('click', () => {
      sel.profile = b.dataset.profile;
      body.querySelectorAll('[data-profile]').forEach(x => x.style.borderColor = x.dataset.profile === sel.profile ? 'var(--primary)' : 'var(--border)');
      const z = body.querySelector('#ob-setup-custom');
      if (z) z.style.display = sel.profile === 'custom' ? 'flex' : 'none';
      const c = body.querySelector('#ob-setup-code');
      if (c) c.style.display = sel.profile === 'code' ? 'flex' : 'none';
      if (sel.profile === 'code') body.querySelector('#ob-setup-code-input')?.focus();
    }));
    body.addEventListener('change', updateCount);
    body.querySelector('#ob-setup-code-input')?.addEventListener('input', validateCode);
    body.querySelector('#ob-setup-export')?.addEventListener('click', async (e) => {
      const code = this._encodeSetupCode();
      try { await navigator.clipboard.writeText(code); } catch {}
      e.target.textContent = '✓ Copied — send it to anyone; they paste it under “Use a shared setup”.';
      window.showToast?.('📤 Setup code copied to clipboard');
    });
  },

  _stashSetupStyle(overlay) {
    const sel = this._session.setup;
    if (!sel) return;
    const body = overlay.querySelector('#ob-body');
    if (!body || !body.querySelector('[data-profile]')) return;
    sel.panels = [...body.querySelectorAll('[data-panel]:checked')].map(i => i.dataset.panel);
    sel.shortcuts = [...body.querySelectorAll('[data-shortcut]:checked')].map(i => i.dataset.shortcut);
    const g = body.querySelector('#ob-setup-glass');
    if (g) sel.glass = g.checked;
    const c = body.querySelector('#ob-setup-code-input');
    if (c) sel.code = c.value;
  },

  _applySetupProfile(sel) {
    const APP = this._APP_PANELS().map(p => p.id);
    let hidden, shortcuts, glass;
    if (sel.profile === 'minimal') {
      hidden = APP; shortcuts = []; glass = false;
    } else if (sel.profile === 'custom') {
      hidden = APP.filter(p => !sel.panels.includes(p));
      shortcuts = this._shortcutDefaults().filter(s => sel.shortcuts.includes(s.name));
      glass = !!sel.glass;
    } else { // owner — everything on, stock shortcuts, Glass
      hidden = []; shortcuts = null; glass = true;
    }
    // Panel visibility rides the existing per-button override store, so the
    // Settings → Sidebar manager shows hidden panels with a Show button —
    // nothing chosen here is a dead end.
    let ov = {};
    try { ov = JSON.parse(localStorage.getItem('vex.panelOverrides') || '{}') || {}; } catch {}
    for (const p of APP) {
      if (hidden.includes(p)) ov[p] = Object.assign({}, ov[p], { hidden: true });
      else if (ov[p]) { delete ov[p].hidden; if (!Object.keys(ov[p]).length) delete ov[p]; }
    }
    try { localStorage.setItem('vex.panelOverrides', JSON.stringify(ov)); } catch {}
    try { if (typeof SidebarManager !== 'undefined') SidebarManager.applyPanelOverrides(); } catch {}
    // Shortcuts feed BOTH the Glass bar and the start page's speed dial (same
    // key, mirrored into start-page storage). null = stock set.
    this._setStart('vex.shortcuts', shortcuts == null ? null : JSON.stringify(shortcuts));
    try { window.VexGuiStyle?.render?.(); } catch {}
    try { window.VexGuiStyle?.set?.(glass ? 'glass' : 'classic'); } catch {}
    try { localStorage.setItem('vex.setupProfile', sel.profile); } catch {}
  },

  _renderBody(key, body) {
    const input = (id, ph, val) => this._input(id, ph, val);
    if (key === 'setupstyle') {
      this._renderSetupStyle(body);
    } else if (key === 'theme') {
      const themes = (typeof ThemeManager !== 'undefined' ? ThemeManager.THEMES : []);
      const cur = (typeof ThemeManager !== 'undefined' ? ThemeManager.currentTheme : '');
      body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">${themes.map(t =>
        `<button data-theme="${t.id}" style="padding:14px 6px;border-radius:11px;border:2px solid ${t.id === cur ? 'var(--primary)' : 'var(--border)'};background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit;font-size:11.5px;display:flex;flex-direction:column;align-items:center;gap:7px">
          <span style="width:34px;height:34px;border-radius:8px;border:1px solid var(--border);background:linear-gradient(135deg,var(--primary),var(--surface))"></span>${this._esc(t.label)}</button>`).join('')}</div>`;
      body.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.theme;
        try { ThemeManager.applyTheme(id); } catch {}
        body.querySelectorAll('[data-theme]').forEach(x => x.style.borderColor = 'var(--border)');
        b.style.borderColor = 'var(--primary)';
      }));
    } else if (key === 'language') {
      const LANGS = [
        { id: 'en', name: 'English', glyph: '🇬🇧' },
        { id: 'tr', name: 'Türkçe', glyph: '🇹🇷' },
      ];
      let cur = this._session.lang;
      if (cur == null) { try { cur = localStorage.getItem('vex.lang') || 'en'; } catch { cur = 'en'; } }
      this._pendingLang = cur;
      body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">${LANGS.map(l =>
        `<button data-lang="${l.id}" style="padding:16px 6px;border-radius:11px;border:2px solid ${l.id === cur ? 'var(--primary)' : 'var(--border)'};background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit;font-size:13px;display:flex;flex-direction:column;align-items:center;gap:8px">
          <span style="font-size:22px">${l.glyph}</span>${this._esc(l.name)}</button>`).join('')}</div>
        <p style="font-size:11.5px;color:var(--text-muted);margin:10px 0 0">More languages are on the way — this currently covers the start page and the daily verse.</p>`;
      body.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => {
        this._pendingLang = b.dataset.lang;
        body.querySelectorAll('[data-lang]').forEach(x => x.style.borderColor = 'var(--border)');
        b.style.borderColor = 'var(--primary)';
      }));
    } else if (key === 'wisdom') {
      const SOURCES = [
        { id: 'quran',   name: 'Qur’an',        desc: 'A daily ayah' },
        { id: 'bible',   name: 'Bible',         desc: 'A daily verse' },
        { id: 'tanakh',  name: 'Tanakh',        desc: 'A daily passage' },
        { id: 'secular', name: 'Quotes',        desc: 'Philosophers & writers' },
        { id: 'off',     name: 'None',          desc: 'No daily text' },
      ];
      let cur = this._session.wisdom;
      if (cur == null) { try { cur = localStorage.getItem('vex.wisdomSource') || 'quran'; } catch { cur = 'quran'; } }
      this._pendingWisdom = cur;
      body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${SOURCES.map(s =>
        `<button data-wisdom="${s.id}" style="padding:14px 6px;border-radius:11px;border:2px solid ${s.id === cur ? 'var(--primary)' : 'var(--border)'};background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit;font-size:12.5px;display:flex;flex-direction:column;align-items:center;gap:5px">
          <span style="font-weight:700">${this._esc(s.name)}</span><span style="font-size:11px;color:var(--text-muted)">${this._esc(s.desc)}</span></button>`).join('')}</div>
        <p style="font-size:11.5px;color:var(--text-muted);margin:10px 0 0">Shown in the language you picked. Change it anytime by re-running this wizard (✦ button).</p>`;
      body.querySelectorAll('[data-wisdom]').forEach(b => b.addEventListener('click', () => {
        this._pendingWisdom = b.dataset.wisdom;
        body.querySelectorAll('[data-wisdom]').forEach(x => x.style.borderColor = 'var(--border)');
        b.style.borderColor = 'var(--primary)';
      }));
    } else if (key === 'name') {
      let v = this._session.name;
      if (v == null) { try { v = localStorage.getItem('vex.userName') || ''; } catch { v = ''; } }
      body.innerHTML = input('ob-name', 'e.g. Alex', v);
    } else if (key === 'weather') {
      this._pendingLoc = null;
      body.innerHTML = `
        <div style="display:flex;gap:8px">
          <div style="flex:1">${input('ob-city', 'e.g. Ataşehir or Istanbul', this._session.weatherText || '')}</div>
          <button id="ob-city-search" style="padding:0 16px;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600">Search</button>
        </div>
        <div id="ob-city-results" style="display:flex;flex-direction:column;gap:6px;margin-top:10px"></div>
        <div id="ob-city-status" style="font-size:12px;color:var(--text-muted);margin-top:8px;min-height:16px"></div>`;
      const run = () => this._searchCity(body.querySelector('#ob-city')?.value.trim(), body);
      body.querySelector('#ob-city-search')?.addEventListener('click', run);
      body.querySelector('#ob-city')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    } else if (key === 'github') {
      let v = this._session.github;
      if (v == null) { try { v = localStorage.getItem('vex.githubUsername') || ''; } catch { v = ''; } }
      body.innerHTML = input('ob-gh', 'e.g. octocat', v);
    } else if (key === 'search') {
      const ENGINES = this._engines();
      let cur = this._session.engine;
      if (cur == null) { try { cur = localStorage.getItem('vex.searchEngine') || 'google'; } catch { cur = 'google'; } }
      body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${ENGINES.map(e =>
        `<button data-engine="${e.id}" style="padding:13px 6px;border-radius:11px;border:2px solid ${e.id === cur ? 'var(--primary)' : 'var(--border)'};background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit;font-size:12.5px;display:flex;flex-direction:column;align-items:center;gap:8px">
          <span style="width:30px;height:30px;border-radius:8px;background:${e.color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px">${this._esc(e.glyph)}</span>${this._esc(e.name)}</button>`).join('')}</div>`;
      this._pendingEngine = cur;
      body.querySelectorAll('[data-engine]').forEach(b => b.addEventListener('click', () => {
        this._pendingEngine = b.dataset.engine;
        body.querySelectorAll('[data-engine]').forEach(x => x.style.borderColor = 'var(--border)');
        b.style.borderColor = 'var(--primary)';
      }));
    } else if (key === 'defaultbrowser') {
      body.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px">
          <div id="ob-db-status" style="font-size:13px;color:var(--text-muted)">Checking current default…</div>
          <button id="ob-db-btn" style="padding:11px 18px;align-self:flex-start;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600">Make Vex my default browser</button>
          <p style="font-size:11.5px;color:var(--text-muted);margin:0">Windows opens its Default Apps screen — choose Vex under “Web browser”, then come back here.</p>
        </div>`;
      const st = body.querySelector('#ob-db-status');
      window.vex.isDefaultBrowser?.().then(is => { if (st) st.textContent = is ? '✓ Vex is already your default browser.' : 'Vex is not your default browser yet.'; }).catch(() => {});
      body.querySelector('#ob-db-btn')?.addEventListener('click', async () => {
        try { await window.vex.setAsDefaultBrowser?.(); } catch {}
        try { localStorage.setItem('vex.defaultBrowserConfigured', 'true'); } catch {}
        if (st) st.textContent = 'Opened Windows settings — pick Vex as your “Web browser”.';
      });
    } else if (key === 'aicloud') {
      let cur = this._session.aicloud;
      if (cur == null) { try { cur = localStorage.getItem('vex.aiWorkerUrl') || ''; } catch { cur = ''; } }
      body.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">
        <label style="font-size:12.5px;color:var(--text-muted)">Cloud AI Worker URL (Claude — see SELF_HOSTING.md)</label>
        ${input('ob-ai-url', 'https://your-vex-ai.workers.dev', cur)}
      </div>`;
    } else if (key === 'ollama') {
      body.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px">
          <button id="ob-ollama" style="padding:11px 16px;align-self:flex-start;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600">Detect running Ollama</button>
          <span id="ob-ollama-status" style="font-size:12.5px;color:var(--text-muted)"></span>
          <p style="font-size:11.5px;color:var(--text-muted);margin:0">No Ollama yet? The button opens the install guide. After installing, run a model (e.g. <code>ollama run llama3.2</code>) and click Detect again.</p>
        </div>`;
      body.querySelector('#ob-ollama')?.addEventListener('click', async () => {
        const st = body.querySelector('#ob-ollama-status');
        st.textContent = 'Checking for Ollama…';
        let up = false;
        try { up = (typeof AIRouter !== 'undefined') ? await AIRouter.refreshOllamaStatus() : false; } catch {}
        if (up) { st.textContent = '✓ Ollama detected — local AI ready'; try { AIRouter.setPreferLocal(true); } catch {} }
        else { st.textContent = 'Not found — opening the install guide…'; try { TabManager.createTab('https://ollama.com/download', true); } catch {} }
      });
    } else if (key === 'ondevice') {
      body.innerHTML = this._onDeviceSection();
      this._wireOnDevice(body);
    } else if (key === 'sync') {
      let cur = this._session.sync;
      if (cur == null) { try { cur = localStorage.getItem('vex.syncWorkerUrl') || ''; } catch { cur = ''; } }
      body.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">
        <label style="font-size:12.5px;color:var(--text-muted)">Sync Worker URL (deploy your own — see SELF_HOSTING.md)</label>
        ${input('ob-sync-url', 'https://your-vex-sync.workers.dev', cur)}
        <p style="font-size:11.5px;color:var(--text-muted);margin:2px 0 0">Everything is end-to-end encrypted on your device before it’s sent. Leave blank to keep sync off.</p>
      </div>`;
    } else if (key === 'passwords') {
      body.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:9px">
          ${input('ob-pw-host', 'Website (e.g. github.com)')}
          ${input('ob-pw-user', 'Username or email')}
          <div style="position:relative">${input('ob-pw-pass', 'Password')}</div>
          <button id="ob-pw-save" style="padding:10px 16px;align-self:flex-start;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600">Save this login</button>
          <span id="ob-pw-status" style="font-size:12.5px;color:var(--text-muted)"></span>
          <p style="font-size:11.5px;color:var(--text-muted);margin:0">Stored encrypted with your OS keychain. Optional — you can also let Vex offer to save logins as you sign in.</p>
        </div>`;
      body.querySelector('#ob-pw-pass').type = 'password';
      body.querySelector('#ob-pw-save')?.addEventListener('click', async () => {
        const host = body.querySelector('#ob-pw-host')?.value.trim();
        const username = body.querySelector('#ob-pw-user')?.value.trim();
        const password = body.querySelector('#ob-pw-pass')?.value || '';
        const st = body.querySelector('#ob-pw-status');
        if (!host || !username || !password) { if (st) st.textContent = 'Fill in website, username, and password first.'; return; }
        try {
          await window.vex.vaultSave?.({ host, username, password });
          try { localStorage.setItem('vex.vaultSeeded', 'true'); } catch {}
          if (st) st.textContent = '✓ Saved to your encrypted vault.';
          body.querySelector('#ob-pw-pass').value = '';
        } catch (e) { if (st) st.textContent = 'Could not save: ' + (e.message || 'error'); }
      });
    } else if (key === 'done') {
      // Single first-run welcome ends here; offer the interface tour as an
      // opt-in button instead of a second stacked welcome overlay.
      body.innerHTML = `
        <button id="ob-take-tour" style="display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:12px 14px;border-radius:11px;border:1px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit;text-align:left">
          <span style="font-size:18px">🧭</span>
          <span style="display:flex;flex-direction:column;gap:2px">
            <span style="font-size:13.5px;font-weight:600">Take a quick tour</span>
            <span style="font-size:11.5px;color:var(--text-muted)">A 60-second walkthrough of tabs, the sidebar, AI, and more — right after you finish.</span>
          </span>
        </button>`;
      const btn = body.querySelector('#ob-take-tour');
      btn?.addEventListener('click', () => {
        this._wantTour = !this._wantTour;
        btn.style.borderColor = this._wantTour ? 'var(--primary)' : 'var(--border)';
        btn.querySelector('span:last-child span:first-child').textContent = this._wantTour ? '✓ Tour queued — starts when you finish' : 'Take a quick tour';
      });
    } else {
      body.innerHTML = '';   // welcome has no body
    }
  },

  _engines() {
    return [
      { id: 'google',     name: 'Google',     glyph: 'G', color: '#4285F4' },
      { id: 'duckduckgo', name: 'DuckDuckGo', glyph: 'D', color: '#de5833' },
      { id: 'bing',       name: 'Bing',       glyph: 'b', color: '#0c8484' },
      { id: 'brave',      name: 'Brave',      glyph: 'B', color: '#fb542b' },
      { id: 'startpage',  name: 'Startpage',  glyph: 'S', color: '#6b4fbb' },
      { id: 'ecosia',     name: 'Ecosia',     glyph: 'E', color: '#2e8b57' },
    ];
  },

  // Geocode the typed text and show up to 5 matches (district · province · country)
  // so the user picks the exact place — districts like "Ataşehir" resolve reliably
  // instead of silently snapping to whatever the single top hit happens to be.
  async _searchCity(q, body) {
    const results = body.querySelector('#ob-city-results');
    const status = body.querySelector('#ob-city-status');
    this._pendingLoc = null;
    if (!q) { if (status) status.textContent = 'Type a city or district first.'; return; }
    if (status) status.textContent = 'Searching…';
    if (results) results.innerHTML = '';
    let list = [];
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=tr`);
      const d = await r.json();
      list = (d && d.results) || [];
    } catch { if (status) status.textContent = 'Lookup failed — check your connection and try again.'; return; }
    if (!list.length) { if (status) status.textContent = 'No matches — try the nearest town or a different spelling.'; return; }
    if (status) status.textContent = 'Pick the right one:';
    results.innerHTML = list.map((hit, i) => {
      const parts = [hit.name, hit.admin1, hit.country].filter(Boolean);
      const label = parts.join(' · ');
      return `<button data-i="${i}" style="text-align:left;padding:10px 12px;background:var(--bg);border:2px solid var(--border);border-radius:10px;color:var(--text);cursor:pointer;font-family:inherit;font-size:13px">${this._esc(label)}</button>`;
    }).join('');
    results.querySelectorAll('[data-i]').forEach(btn => btn.addEventListener('click', () => {
      const hit = list[+btn.dataset.i];
      this._pendingLoc = { lat: hit.latitude, lon: hit.longitude, city: hit.name + (hit.admin1 && hit.admin1 !== hit.name ? ', ' + hit.admin1 : '') + (hit.country_code ? ', ' + hit.country_code : '') };
      results.querySelectorAll('[data-i]').forEach(x => x.style.borderColor = 'var(--border)');
      btn.style.borderColor = 'var(--primary)';
      if (status) status.textContent = '✓ ' + this._pendingLoc.city + ' — Save & continue to confirm.';
    }));
  },

  // On-device (WebGPU) model download UI for the on-device AI step.
  _onDeviceSection() {
    if (typeof WebLLM === 'undefined' || !WebLLM.isSupported()) {
      return `<p style="font-size:12px;color:var(--text-muted)">This machine doesn’t expose WebGPU, so on-device AI isn’t available here. Use Cloud AI or Ollama instead — you can revisit this later in Settings → On-Device AI.</p>`;
    }
    const opts = WebLLM.models().map(m => `<option value="${m.id}">${this._esc(m.name)} · ${this._esc(m.size)}</option>`).join('');
    return `
      <div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <select id="ob-wl-model" style="min-width:180px">${opts}</select>
          <button id="ob-wl-dl" style="padding:8px 14px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600">Download now</button>
        </div>
        <div id="ob-wl-prog" style="display:none;margin-top:8px"><div style="height:7px;background:var(--bg);border:1px solid var(--border);border-radius:5px;overflow:hidden"><div id="ob-wl-bar" style="height:100%;width:0%;background:var(--primary)"></div></div><div id="ob-wl-ptext" style="font-size:11px;color:var(--text-muted);margin-top:5px;font-family:'JetBrains Mono',monospace"></div></div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:6px">First download is a few minutes (cached after). You can skip and do this later.</p>
      </div>`;
  },
  _wireOnDevice(body) {
    const dl = body.querySelector('#ob-wl-dl');
    if (!dl || typeof WebLLM === 'undefined') return;
    const prog = body.querySelector('#ob-wl-prog');
    const bar = body.querySelector('#ob-wl-bar');
    const ptext = body.querySelector('#ob-wl-ptext');
    WebLLM.onProgress((p) => { if (prog) { prog.style.display = 'block'; bar.style.width = Math.round((p.progress || 0) * 100) + '%'; ptext.textContent = p.text || ''; } });
    dl.addEventListener('click', async () => {
      if (WebLLM.isLoading()) return;
      const id = body.querySelector('#ob-wl-model')?.value;
      dl.disabled = true; dl.textContent = 'Downloading…';
      try {
        await WebLLM.load(id);
        WebLLM.setPreferred(true);
        dl.textContent = '✓ Ready';
        window.showToast?.('🧠 On-device model ready');
      } catch (e) {
        dl.disabled = false; dl.textContent = 'Download now';
        window.showToast?.('Download failed: ' + (e.message || 'error'));
      }
    });
  },

  async _commitAndNext(key, overlay) {
    this._stash(key, overlay);   // so Back onto this step re-shows exactly what was typed
    if (key === 'setupstyle') {
      const sel = this._session.setup;
      if (sel && sel.profile === 'code') {
        const d = this._decodeSetupCode(sel.code);
        if (!d) {
          // Don't advance past a bad code — surface why, right where they typed.
          const st = overlay.querySelector('#ob-setup-code-status');
          if (st) { st.textContent = '✗ That’s not a valid setup code — paste the full code (starts with VEXSETUP1.), or pick another option.'; st.style.color = 'var(--danger, #ef4444)'; }
          return;
        }
        this._applySetupCode(d);
      } else if (sel) {
        this._applySetupProfile(sel);
      }
    } else if (key === 'language') {
      // Mirrored into start-page storage; the greeting/labels/verse re-read it
      // on the reload that finish() triggers.
      this._setStart('vex.lang', this._pendingLang || 'en');
    } else if (key === 'wisdom') {
      this._setStart('vex.wisdomSource', this._pendingWisdom || 'quran');
      // The Qur'an cache is per-edition; drop it so a language/source change
      // shows the right text immediately rather than a day later.
      this._setStart('vex.quranVerse', null);
    } else if (key === 'name') {
      const v = overlay.querySelector('#ob-name')?.value.trim() || '';
      this._setStart('vex.userName', v || null);
    } else if (key === 'github') {
      const v = overlay.querySelector('#ob-gh')?.value.trim() || '';
      this._setStart('vex.githubUsername', v || null);
    } else if (key === 'search') {
      const id = this._pendingEngine || 'google';
      this._setStart('vex.searchEngine', id);   // start page + host localStorage
      try {
        if (typeof VexStorage !== 'undefined') {
          const s = (await VexStorage.loadSettings()) || {};
          s.searchEngine = id;
          await VexStorage.saveSettings(s);
        }
      } catch {}
    } else if (key === 'aicloud') {
      const v = overlay.querySelector('#ob-ai-url')?.value.trim() || '';
      try { v ? localStorage.setItem('vex.aiWorkerUrl', v) : localStorage.removeItem('vex.aiWorkerUrl'); } catch {}
    } else if (key === 'sync') {
      const v = overlay.querySelector('#ob-sync-url')?.value.trim() || '';
      try { v ? localStorage.setItem('vex.syncWorkerUrl', v) : localStorage.removeItem('vex.syncWorkerUrl'); } catch {}
    } else if (key === 'weather') {
      if (this._pendingLoc) {
        this._setStart('vex.weatherLoc', JSON.stringify(this._pendingLoc));
      } else {
        // They typed but never picked — try to auto-resolve the top hit so the
        // step isn't lost, but only if there's text.
        const city = overlay.querySelector('#ob-city')?.value.trim() || '';
        if (city) {
          try {
            const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=tr`);
            const d = await r.json();
            const hit = d && d.results && d.results[0];
            if (hit) this._setStart('vex.weatherLoc', JSON.stringify({ lat: hit.latitude, lon: hit.longitude, city: hit.name + (hit.admin1 && hit.admin1 !== hit.name ? ', ' + hit.admin1 : '') + (hit.country_code ? ', ' + hit.country_code : '') }));
          } catch {}
        }
      }
    }
    this.step++;
    this._render();
  },
};

if (typeof window !== 'undefined') window.Onboarding = Onboarding;
if (typeof module !== 'undefined' && module.exports) module.exports = { Onboarding };
