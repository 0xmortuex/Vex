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
    if (this._returnFocus?.isConnected) this._returnFocus.focus();
    this._returnFocus = null;
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

  start() { this._returnFocus = document.activeElement; this.activeSteps = this.STEPS(); this.step = 0; this._pendingLoc = null; this._session = {}; this._wantTour = false; this._perf = null; this._weatherCountry = null; this._weatherHits = null; this._render(); },

  // Re-open the wizard on demand (the top-bar setup button). Shows ALL steps,
  // each pre-filled with whatever's already saved and tagged "✓ already set" so
  // nothing is hidden but you're not redoing anything from scratch.
  relaunch() {
    this._returnFocus = document.activeElement;
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
      case 'job':            return this._has('vex.job');
      case 'name':           return this._has('vex.userName');
      case 'look':           return this._flag('vex.guiStyleChosen');
      case 'performance':    return this._flag('vex.perfConfigured');
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
      { key: 'welcome',        title: 'Welcome to Vex',                sub: 'Let’s set up the bits that make Vex feel like yours. Skip anything you don’t want — you can re-open this wizard anytime from the ✦ button by the reload button.' },
      { key: 'setupstyle',     title: 'Choose your starting point', sub: 'Vex ships fully loaded — but it doesn’t have to be. Pick how much you want; every choice here can be changed later in Settings → Sidebar.' },
      { key: 'theme',          title: 'Pick a theme',             sub: 'You can change this anytime from the start page or Settings.' },
      { key: 'look',           title: 'Pick a look',              sub: 'The shape of the browser itself — Vex’s own, frosted Glass, or a look borrowed from Chrome, Firefox, Safari, Internet Explorer or Netscape. Your theme colours can be kept on top of any of them.' },
      { key: 'performance',    title: 'Speed, memory & privacy',  sub: 'The settings that decide how Vex actually behaves. Pick the one that fits how you work — or open the list and set all nine yourself.' },
      { key: 'job',            title: 'A Vex built for your work', sub: 'Optional — pick your profession and Vex applies a fitting theme and the built-in tools you use daily (you choose exactly which). Change or remove it anytime.' },
      { key: 'language',       title: 'Language · Dil',           sub: 'Sets the start page language — greeting, labels, and the daily verse. (Full interface translation is on the roadmap.)' },
      { key: 'wisdom',         title: 'Daily wisdom',             sub: 'A short verse or quote on your start page each day. Pick your tradition — or turn it off entirely.' },
      { key: 'name',           title: 'What should we call you?', sub: 'Used only for the start-page greeting. Leave blank for none.' },
      { key: 'weather',        title: 'Weather location',         sub: 'Choose your country, then search for a city, district or postcode and pick it from the list.' },
      { key: 'github',         title: 'GitHub username',          sub: 'Optional — shows your repo/follower stats + activity on the start page.' },
      { key: 'search',         title: 'Default search engine',    sub: 'Which search engine the URL bar and start page use.' },
      { key: 'defaultbrowser', title: 'Make Vex your default',    sub: 'So links from Discord, email, and other apps open in Vex.' },
      { key: 'aicloud',        title: 'Cloud AI (Claude)',        sub: 'Paste your self-hosted Vex AI Worker URL for the most capable AI. See SELF_HOSTING.md. Skip if you’ll use local AI instead.' },
      { key: 'ollama',         title: 'Local AI (Ollama)',        sub: 'Run models locally with Ollama — private and free. We’ll detect a running Ollama for you.' },
      { key: 'ondevice',       title: 'On-device AI (WebGPU)',    sub: 'Run a small model fully inside Vex — private, offline, no install. Great if you don’t have Ollama.' },
      { key: 'sync',           title: 'Vex Sync',                 sub: 'End-to-end encrypted sync of your tabs, bookmarks, history & settings across devices — optional, set it up now or later.' },
      { key: 'passwords',      title: 'Password manager',         sub: 'Vex has a built-in, OS-encrypted password vault. Add your first login now, or skip and add them as you browse.' },
      { key: 'done',           title: 'All set',                     sub: 'You’re ready. Everything here lives in Settings if you want to change it later — and Discover (Ctrl+K → “Discover”) introduces every feature Vex has, one at a time.' },
    ].map(step => ({ ...step, title: window.VexI18n?.t(step.key, step.title) || step.title, sub: window.VexI18n?.t(step.key + '.sub', step.sub) || step.sub }));
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
    const s = this.STEPS().find(item => item.key === steps[this.step]?.key);
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
    overlay.firstElementChild.setAttribute('role', 'dialog');
    overlay.firstElementChild.setAttribute('aria-modal', 'true');
    overlay.firstElementChild.setAttribute('aria-label', s.title);
    const labels = { 'ob-skipall': ['skipSetup', 'Skip setup'], 'ob-back': ['back', 'Back'], 'ob-skip': ['skip', 'Skip'], 'ob-next': this.step === 0 ? ['getStarted', 'Get started'] : isLast ? ['finish', 'Finish'] : ['saveContinue', 'Save & continue'] };
    for (const [id, [key, fallback]] of Object.entries(labels)) { const button = overlay.querySelector('#' + id); if (button) button.textContent = window.VexI18n?.t(key, fallback) || fallback; }
    overlay.querySelector('#ob-progress-label').textContent = `${window.VexI18n?.t('step', 'Step') || 'Step'} ${this.step + 1} ${window.VexI18n?.t('of', 'of') || 'of'} ${steps.length}`;
    overlay.querySelector('#ob-skipall').addEventListener('click', () => this.finish());
    overlay.querySelector('#ob-back')?.addEventListener('click', () => { this._stash(s.key, overlay); this.step--; this._render(); });
    overlay.querySelector('#ob-skip')?.addEventListener('click', () => { this._stash(s.key, overlay); this.step++; this._render(); });
    overlay.querySelector('#ob-next').addEventListener('click', () => this._commitAndNext(s.key, overlay));
    // Escape = the same bail-out as the "Skip setup" button.
    this._keyHandler = (e) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') { e.preventDefault(); this.finish(); }
      if (e.key === 'Tab') {
        const nodes = [...overlay.querySelectorAll('button,input,select,a[href]')].filter(node => !node.disabled && !node.hidden);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', this._keyHandler);
    this._renderBody(s.key, overlay.querySelector('#ob-body'));
    overlay.querySelector('input,button')?.focus();
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
      if (code.length > 131072) return null;
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
        <button id="ob-setup-export" style="align-self:flex-start;background:none;border:none;color:var(--text-muted);font-family:inherit;font-size:12px;cursor:pointer;padding:2px 0;text-decoration:underline;text-underline-offset:3px">Copy my current setup as a shareable code</button>
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
      window.showToast?.('Setup code copied to clipboard');
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
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">${themes.map(t =>
          `<button data-theme="${t.id}" style="padding:14px 6px;border-radius:11px;border:2px solid ${t.id === cur ? 'var(--primary)' : 'var(--border)'};background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit;font-size:11.5px;display:flex;flex-direction:column;align-items:center;gap:7px">
            <span style="width:34px;height:34px;border-radius:8px;border:1px solid var(--border);background:linear-gradient(135deg,var(--primary),var(--surface))"></span>${this._esc(t.label)}</button>`).join('')}</div>
`;
      body.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.theme;
        try { ThemeManager.applyTheme(id); } catch {}
        body.querySelectorAll('[data-theme]').forEach(x => x.style.borderColor = 'var(--border)');
        b.style.borderColor = 'var(--primary)';
      }));
    } else if (key === 'look') {
      this._renderLook(body);
    } else if (key === 'performance') {
      this._renderPerformance(body);
    } else if (key === 'job') {
      const cur = (window.JobProfiles && JobProfiles.current());
      const curName = cur ? ((JobProfiles.get(cur) || {}).name || cur) : null;
      body.innerHTML = `
        <div style="font-size:13px;color:var(--text);line-height:1.6">Vex can reshape itself around what you do — a fitting theme, the built-in tools your job uses daily (regex, JSON, color, word count…), and quick buttons next to the Tor button. You choose exactly which tools you want, and can change or remove this anytime.</div>
        <div style="margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <button id="ob-job-open" style="padding:11px 18px;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600">${curName ? 'Change job…' : 'Choose my job →'}</button>
          ${curName ? `<span style="font-size:12.5px;color:var(--text-muted)">Current: <b style="color:var(--text)">${this._esc(curName)}</b></span>` : '<span style="font-size:12px;color:var(--text-muted)">Optional — Skip to keep the default Vex.</span>'}
        </div>`;
      body.querySelector('#ob-job-open')?.addEventListener('click', () => { try { window.JobSetup && JobSetup.open(); } catch {} });
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
      this._renderWeather(body);
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
      body.innerHTML = `<div style="display:flex;flex-direction:column;gap:11px">
        <p style="font-size:12.5px;color:var(--text);margin:0;line-height:1.55">
          <b>Cloud AI</b> gives Vex its most capable assistant (<b>Claude</b>) — for chat, page summaries,
          translation, and Agent mode. It runs on <i>your own</i> free Cloudflare Worker with <i>your own</i>
          API key, so you fully own it and there's no middleman.
        </p>
        <div style="background:rgba(127,127,127,.09);border:1px solid var(--border);border-radius:10px;padding:10px 13px;font-size:12px;color:var(--text-muted);line-height:1.6">
          <b style="color:var(--text)">This step is a bit technical — it's optional, and you can set it up anytime later in Settings → AI.</b> Prefer zero setup? Use <b>Local AI (Ollama)</b> or <b>On-device AI</b> on the next two steps instead.
          <div style="margin-top:7px;color:var(--text)">To turn it on now, 3 steps:</div>
          <ol style="margin:5px 0 0;padding-left:18px">
            <li>Create a free <a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener" style="color:var(--primary)">Cloudflare account</a>, and grab a free <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" style="color:var(--primary)">OpenRouter API key</a> (this is what talks to Claude).</li>
            <li>Open the <a href="https://github.com/0xmortuex/Vex/blob/main/SELF_HOSTING.md#1-ai-assistant-worker-vex-ai-worker" target="_blank" rel="noopener" style="color:var(--primary)">step-by-step deploy guide</a> — a few <code>wrangler</code> commands (~2 min) that take your API key and print a URL.</li>
            <li>Paste that URL below (it looks like <code>https://vex-ai.<i>you</i>.workers.dev</code>) and continue.</li>
          </ol>
        </div>
        <label style="font-size:12.5px;color:var(--text)">Cloud AI Worker URL <span style="color:var(--text-muted)">— paste it from step 2, or leave blank</span></label>
        ${input('ob-ai-url', 'https://vex-ai.your-name.workers.dev', cur)}
        <p style="font-size:11.5px;color:var(--text-muted);margin:0">Blank keeps Cloud AI off — you can still use Local or On-device AI, and add this anytime in Settings → AI.</p>
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
      body.innerHTML = `<div style="display:flex;flex-direction:column;gap:11px">
        <p style="font-size:12.5px;color:var(--text);margin:0;line-height:1.55">
          <b>Vex Sync</b> mirrors your tabs, bookmarks, history &amp; settings across your devices, <b>end-to-end
          encrypted</b> — everything is scrambled on your device before it leaves, so no one (not even us) can read
          it. It runs on <i>your own</i> free Cloudflare account, so you fully own your data.
        </p>
        <div style="background:rgba(127,127,127,.09);border:1px solid var(--border);border-radius:10px;padding:10px 13px;font-size:12px;color:var(--text-muted);line-height:1.6">
          <b style="color:var(--text)">This step is a bit technical — it's optional, and you can set it up anytime later in Settings → Sync.</b>
          <div style="margin-top:7px;color:var(--text)">To turn it on now, 3 steps:</div>
          <ol style="margin:5px 0 0;padding-left:18px">
            <li>Create a free <a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener" style="color:var(--primary)">Cloudflare account</a>.</li>
            <li>Open the <a href="https://github.com/0xmortuex/Vex/blob/main/SELF_HOSTING.md#2-sync-worker-vex-sync-worker" target="_blank" rel="noopener" style="color:var(--primary)">step-by-step deploy guide</a> — it runs a few <code>wrangler</code> commands (~2 min) and prints a URL.</li>
            <li>Paste that URL below (it looks like <code>https://vex-sync.<i>you</i>.workers.dev</code>) and continue.</li>
          </ol>
        </div>
        <label style="font-size:12.5px;color:var(--text)">Sync Worker URL <span style="color:var(--text-muted)">— paste it from step 2, or leave blank</span></label>
        ${input('ob-sync-url', 'https://vex-sync.your-name.workers.dev', cur)}
        <p style="font-size:11.5px;color:var(--text-muted);margin:0">Blank keeps Sync off. To link another device later, just paste the same URL there too.</p>
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
          <span style="display:inline-flex">${VexIcons.svg('compass', { size: 19 })}</span>
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
  // === "Pick a look" — every GUI style, not just Glass vs Classic ==========
  //
  // The browser looks were reachable only from Settings → Appearance, so most
  // people never learned they existed. Each card applies its look immediately,
  // which makes the window behind the wizard the preview.
  LOOKS() {
    return [
      { id: 'classic', name: 'Vex Classic', desc: 'Vex’s own shape: tabs down the side, your theme’s colours everywhere.' },
      { id: 'glass', name: 'Glass', desc: 'Frosted and translucent, tabs on top, a speed-dial shortcuts bar.' },
      { id: 'chrome', name: 'Chrome', desc: 'Rounded tab shapes, the omnibox pill, a side panel on the right.', borrowed: true },
      { id: 'chrome-dark', name: 'Chrome — dark', desc: 'The same, in Chrome’s dark grey.', borrowed: true },
      { id: 'firefox', name: 'Firefox', desc: 'Floating tabs, a wide URL bar, the icon rail on the left.', borrowed: true },
      { id: 'firefox-dark', name: 'Firefox — dark', desc: 'The same, in Firefox’s dark palette.', borrowed: true },
      { id: 'safari', name: 'Safari', desc: 'Quiet and grey, controls in the toolbar, a sidebar on the left.', borrowed: true },
      { id: 'xp', name: 'Internet Explorer · XP', desc: 'Luna blue, Tahoma, square edges. Yes, really.', borrowed: true },
      { id: 'win98', name: 'Netscape · Windows 98', desc: 'Raised grey bevels and a title bar from 1998.', borrowed: true },
    ];
  },

  _renderLook(body) {
    const looks = this.LOOKS();
    let cur = 'classic';
    try { cur = (window.VexGuiStyle && VexGuiStyle.get()) || 'classic'; } catch { cur = 'classic'; }
    let colors = 'look';
    try { colors = (window.VexGuiStyle && VexGuiStyle.getColors && VexGuiStyle.getColors()) || 'look'; } catch { colors = 'look'; }
    let tabs = 'horizontal';
    try { tabs = JSON.parse(localStorage.getItem('vex.tabLayout') || '"horizontal"'); } catch { tabs = 'horizontal'; }

    const card = (l) => '<button data-look="' + l.id + '" style="text-align:left;padding:11px 13px;border-radius:11px;border:2px solid '
      + (l.id === cur ? 'var(--primary)' : 'var(--border)')
      + ';background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit;display:flex;flex-direction:column;gap:3px">'
      + '<span style="font-size:12.5px;font-weight:700">' + this._esc(l.name) + '</span>'
      + '<span style="font-size:11px;color:var(--text-muted);line-height:1.4">' + this._esc(l.desc) + '</span></button>';

    const isBorrowed = (id) => !!(looks.find((l) => l.id === id) || {}).borrowed;

    body.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">'
      + looks.filter((l) => !l.borrowed).map(card).join('') + '</div>'
      + '<div style="margin-top:15px;font-size:12px;font-weight:700;color:var(--text)">Wear another browser</div>'
      + '<div style="font-size:11.5px;color:var(--text-muted);margin:2px 0 9px">Vex, shaped like a browser you already know. Every Vex feature still works the same.</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">'
      + looks.filter((l) => l.borrowed).map(card).join('') + '</div>'
      + '<div id="ob-look-tabs" style="margin-top:15px;display:' + (cur === 'classic' ? 'block' : 'none') + '">'
      + '<div style="font-size:12px;font-weight:700;color:var(--text)">Where your tabs go</div>'
      + '<div style="display:flex;gap:9px;margin-top:7px">'
      + '<button data-tabs="vertical" style="flex:1;padding:9px;border-radius:10px;border:2px solid '
      + (tabs === 'vertical' ? 'var(--primary)' : 'var(--border)')
      + ';background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit;font-size:12px">Down the side</button>'
      + '<button data-tabs="horizontal" style="flex:1;padding:9px;border-radius:10px;border:2px solid '
      + (tabs === 'horizontal' ? 'var(--primary)' : 'var(--border)')
      + ';background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit;font-size:12px">Along the top</button>'
      + '</div></div>'
      + '<div id="ob-look-colors" style="margin-top:15px;display:' + (isBorrowed(cur) ? 'block' : 'none') + '">'
      + '<div style="font-size:12px;font-weight:700;color:var(--text)">Colours for that look</div>'
      + '<div style="display:flex;gap:9px;margin-top:7px">'
      + '<button data-colors="look" style="flex:1;padding:9px;border-radius:10px;border:2px solid '
      + (colors === 'look' ? 'var(--primary)' : 'var(--border)')
      + ';background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit;font-size:12px">Its own colours</button>'
      + '<button data-colors="theme" style="flex:1;padding:9px;border-radius:10px;border:2px solid '
      + (colors === 'theme' ? 'var(--primary)' : 'var(--border)')
      + ';background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit;font-size:12px">My Vex theme’s colours</button>'
      + '</div></div>';

    const repaint = (sel, key, value) => body.querySelectorAll(sel).forEach((x) => {
      x.style.borderColor = x.dataset[key] === value ? 'var(--primary)' : 'var(--border)';
    });

    body.querySelectorAll('[data-look]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.look;
      try { window.VexGuiStyle?.set(id); }
      catch (err) { window.showToast?.('Could not apply that look: ' + (err && err.message), 'error'); return; }
      cur = id;
      try { localStorage.setItem('vex.guiStyleChosen', '1'); }
      catch (err) { console.warn('[setup] could not record the look choice:', err && err.message); }
      repaint('[data-look]', 'look', id);
      const colorRow = body.querySelector('#ob-look-colors');
      if (colorRow) colorRow.style.display = isBorrowed(id) ? 'block' : 'none';
      const tabRow = body.querySelector('#ob-look-tabs');
      if (tabRow) tabRow.style.display = id === 'classic' ? 'block' : 'none';
    }));

    body.querySelectorAll('[data-tabs]').forEach((b) => b.addEventListener('click', () => {
      const mode = b.dataset.tabs;
      const sel = document.getElementById('setting-tab-layout');
      if (sel) { sel.value = mode; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      else {
        try { localStorage.setItem('vex.tabLayout', JSON.stringify(mode)); } catch (err) { console.warn('[setup] could not save the tab layout:', err && err.message); }
        document.body.dataset.tabLayout = mode;
      }
      tabs = mode;
      repaint('[data-tabs]', 'tabs', mode);
    }));

    body.querySelectorAll('[data-colors]').forEach((b) => b.addEventListener('click', () => {
      const mode = b.dataset.colors;
      try { window.VexGuiStyle?.setColors(mode); }
      catch (err) { window.showToast?.('Could not change those colours: ' + (err && err.message), 'error'); return; }
      repaint('[data-colors]', 'colors', mode);
    }));
  },

  // === "Speed, memory & privacy" — the settings that actually matter =======
  //
  // These decide how the browser behaves, and every one of them used to be a
  // silent default most people never found: whether tabs sleep is the
  // difference between 800 MB and 4 GB, and blocking is off until you ask.
  //
  // Each preset states plainly what it does. Nothing is written through a
  // private copy of the settings — every value goes through the same control
  // or API that Settings uses, so the two can never disagree.
  PERF_PRESETS() {
    return [
      {
        id: 'balanced', name: 'Balanced', tag: 'recommended',
        desc: 'Tabs sleep after 30 minutes, ads and trackers blocked, pages loaded over HTTPS only.',
        values: { memorySaver: false, autosleep: true, minutes: 30, adblock: true, farble: false, doh: 'off', httpsOnly: true },
      },
      {
        id: 'memory', name: 'Save memory',
        desc: 'Tabs sleep after 10 minutes and are discarded when the window is minimized. For a machine with 8 GB, or for forty open tabs.',
        values: { memorySaver: true, autosleep: true, minutes: 10, adblock: true, farble: false, doh: 'off', httpsOnly: true },
      },
      {
        id: 'privacy', name: 'Maximum privacy',
        desc: 'Everything above, plus fingerprint randomization and encrypted DNS. A few sites misbehave under it — you can switch it back off.',
        values: { memorySaver: false, autosleep: true, minutes: 30, adblock: true, farble: true, doh: 'auto', httpsOnly: true },
      },
      {
        id: 'nothing', name: 'Leave it all off',
        desc: 'No sleeping, no blocking, no extras. Vex behaves like a plain browser and uses the memory that implies.',
        values: { memorySaver: false, autosleep: false, minutes: 30, adblock: false, farble: false, doh: 'off', httpsOnly: false },
      },
    ];
  },

  // The individual settings, behind "Set them myself".
  PERF_FIELDS() {
    return [
      { key: 'autosleep', label: 'Sleep tabs I stop using', help: 'The single biggest thing you can do about memory.' },
      { key: 'minutes', label: 'Sleep after', help: '', select: [[5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours']] },
      { key: 'memorySaver', label: 'Memory Saver', help: 'Sleeps sooner, discards tabs when minimized, frees background caches.' },
      { key: 'adblock', label: 'Block ads and trackers', help: 'Full filter lists — blocks the request, and hides what it left behind.' },
      { key: 'httpsOnly', label: 'HTTPS-only', help: 'Refuse to load a page over an unencrypted connection.' },
      { key: 'farble', label: 'Fingerprint protection', help: 'Randomize canvas, WebGL and audio. Breaks a small number of sites.' },
      { key: 'doh', label: 'Encrypted DNS', help: 'Hide which sites you visit from your network.', select: [['off', 'Off'], ['auto', 'On — safe'], ['strict', 'On — strict']] },
    ];
  },

  // What these settings are set to right now.
  _perfCurrent() {
    const v = { memorySaver: false, autosleep: true, minutes: 30, adblock: true, farble: false, doh: 'off', httpsOnly: false };
    const box = (id) => document.getElementById(id);
    if (box('setting-memory-saver')) v.memorySaver = box('setting-memory-saver').checked;
    if (box('setting-autosleep')) v.autosleep = box('setting-autosleep').checked;
    if (box('setting-autosleep-minutes')) v.minutes = parseInt(box('setting-autosleep-minutes').value, 10) || 30;
    if (box('setting-adblocker')) v.adblock = box('setting-adblocker').checked;
    if (typeof PrivacyPack !== 'undefined' && PrivacyPack.cfg) {
      v.farble = !!PrivacyPack.cfg.farble;
      v.httpsOnly = !!PrivacyPack.cfg.httpsOnly;
      v.doh = PrivacyPack.cfg.doh || 'off';
    }
    return v;
  },

  // Apply through the real controls, so whatever Settings does on change
  // (persist, tell main, restart a service) happens here too.
  async _perfApply(v) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') { if (el.checked === value) return; el.checked = value; }
      else { if (String(el.value) === String(value)) return; el.value = String(value); }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('setting-memory-saver', !!v.memorySaver);
    set('setting-autosleep', !!v.autosleep);
    set('setting-autosleep-minutes', v.minutes);
    set('setting-adblocker', !!v.adblock);
    if (typeof PrivacyPack !== 'undefined' && PrivacyPack.setCfg) {
      await PrivacyPack.setCfg({ farble: !!v.farble, httpsOnly: !!v.httpsOnly, doh: v.doh || 'off' });
    }
    try { localStorage.setItem('vex.perfConfigured', '1'); }
    catch (err) { console.warn('[setup] could not record the performance choice:', err && err.message); }
  },

  _renderPerformance(body) {
    if (!this._perf) this._perf = Object.assign({ preset: null, open: false }, this._perfCurrent());
    const presets = this.PERF_PRESETS();

    const draw = () => {
      const p = this._perf;
      const chip = (x) => x.tag
        ? '<span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--primary);background:color-mix(in srgb,var(--primary) 15%,transparent);padding:2px 7px;border-radius:999px">' + this._esc(x.tag) + '</span>'
        : '';
      const card = (x) => '<button data-preset="' + x.id + '" style="text-align:left;padding:12px 14px;border-radius:11px;border:2px solid '
        + (p.preset === x.id ? 'var(--primary)' : 'var(--border)')
        + ';background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit;display:flex;flex-direction:column;gap:3px">'
        + '<span style="font-size:13px;font-weight:700;display:flex;align-items:center;gap:7px">' + this._esc(x.name) + chip(x) + '</span>'
        + '<span style="font-size:11.5px;color:var(--text-muted);line-height:1.45">' + this._esc(x.desc) + '</span></button>';

      const control = (f) => {
        if (f.select) {
          const opts = f.select.map((pair) => '<option value="' + this._esc(pair[0]) + '"'
            + (String(p[f.key]) === String(pair[0]) ? ' selected' : '') + '>' + this._esc(pair[1]) + '</option>').join('');
          return '<select data-field="' + f.key + '" aria-label="' + this._esc(f.label)
            + '" style="flex:none;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:8px;font-family:inherit;font-size:12px">' + opts + '</select>';
        }
        return '<input type="checkbox" data-field="' + f.key + '"' + (p[f.key] ? ' checked' : '')
          + ' aria-label="' + this._esc(f.label) + '" style="flex:none;width:17px;height:17px;margin-top:1px;accent-color:var(--primary)">';
      };

      const row = (f) => '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-top:1px solid var(--border)">'
        + '<div style="flex:1;min-width:0"><div style="font-size:12.5px;color:var(--text)">' + this._esc(f.label) + '</div>'
        + (f.help ? '<div style="font-size:11px;color:var(--text-muted);line-height:1.4;margin-top:2px">' + this._esc(f.help) + '</div>' : '')
        + '</div>' + control(f) + '</div>';

      body.innerHTML = '<div style="display:flex;flex-direction:column;gap:9px">' + presets.map(card).join('') + '</div>'
        + '<button id="ob-perf-toggle" aria-expanded="' + (p.open ? 'true' : 'false')
        + '" style="margin-top:12px;background:none;border:none;color:var(--text-muted);font-family:inherit;font-size:12.5px;cursor:pointer;padding:0">'
        + (p.open ? 'Hide the individual settings' : 'Set them myself') + '</button>'
        + '<div id="ob-perf-fields" style="display:' + (p.open ? 'block' : 'none') + ';margin-top:10px">'
        + this.PERF_FIELDS().map(row).join('') + '</div>';

      body.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
        const preset = presets.find((x) => x.id === b.dataset.preset);
        this._perf = Object.assign({ preset: preset.id, open: this._perf.open }, preset.values);
        draw();
      }));
      body.querySelector('#ob-perf-toggle').addEventListener('click', () => {
        this._perf.open = !this._perf.open;
        draw();
      });
      body.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('change', () => {
        const key = el.dataset.field;
        const raw = el.type === 'checkbox' ? el.checked : el.value;
        this._perf[key] = key === 'minutes' ? parseInt(raw, 10) : raw;
        this._perf.preset = null;   // it is custom now; no preset is "the" one
        draw();
      }));
    };
    draw();
  },

  // === Weather location ====================================================
  //
  // The old step was a free-text box that asked Open-Meteo for 5 results in
  // TURKISH, whatever language you had chosen — so an English city name often
  // matched nothing, or matched the wrong place, and a district shared its name
  // with three others with no way to tell them apart. Then, if you never picked
  // one, it silently resolved the top hit behind your back.
  //
  // Now: choose a country, search a city, district or postcode, and pick the
  // exact place from a list that shows its full hierarchy. Nothing is guessed.
  _COUNTRY_CODES: ('AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ '
    + 'CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB '
    + 'GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR '
    + 'KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE '
    + 'NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN '
    + 'SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE '
    + 'ZA ZM ZW').split(' '),

  // Country name in the user's own language, falling back to the code.
  _countryName(code) {
    try {
      const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
      const dn = new Intl.DisplayNames([lang], { type: 'region' });
      return dn.of(code) || code;
    } catch { return code; }
  },

  // A sensible default country: the one the browser's locale implies.
  _guessCountry() {
    try {
      const loc = (typeof navigator !== 'undefined' && navigator.language) || '';
      const m = /[-_]([A-Za-z]{2})$/.exec(loc);
      if (m) { const c = m[1].toUpperCase(); if (this._COUNTRY_CODES.includes(c)) return c; }
    } catch { /* fall through to no country */ }
    return '';
  },

  _countryOptions(selected) {
    const list = this._COUNTRY_CODES
      .map((code) => ({ code, name: this._countryName(code) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return '<option value="">Any country</option>'
      + list.map((c) => '<option value="' + c.code + '"' + (c.code === selected ? ' selected' : '') + '>'
        + this._esc(c.name) + '</option>').join('');
  },

  _renderWeather(body) {
    this._pendingLoc = null;
    if (this._weatherCountry == null) this._weatherCountry = this._guessCountry();

    body.innerHTML = '<label for="ob-country" style="display:block;font-size:11.5px;color:var(--text-muted);margin-bottom:5px">Country</label>'
      + '<select id="ob-country" style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:13.5px;font-family:\'Outfit\',sans-serif;margin-bottom:12px">'
      + this._countryOptions(this._weatherCountry) + '</select>'
      + '<label for="ob-city" style="display:block;font-size:11.5px;color:var(--text-muted);margin-bottom:5px">City, district or postcode</label>'
      + '<div style="display:flex;gap:8px">'
      + '<div style="flex:1">' + this._input('ob-city', 'e.g. Ataşehir · Manchester · 34750', this._session.weatherText || '') + '</div>'
      + '<button id="ob-city-search" style="padding:0 16px;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600">Search</button>'
      + '</div>'
      + '<div id="ob-city-results-wrap" style="display:none;margin-top:10px">'
      + '<label for="ob-city-results" style="display:block;font-size:11.5px;color:var(--text-muted);margin-bottom:5px">Pick the exact place</label>'
      + '<select id="ob-city-results" size="6" style="width:100%;box-sizing:border-box;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:12.5px;font-family:\'Outfit\',sans-serif"></select>'
      + '</div>'
      + '<div id="ob-city-status" style="font-size:12px;color:var(--text-muted);margin-top:8px;min-height:16px"></div>';

    const country = body.querySelector('#ob-country');
    country.addEventListener('change', () => {
      this._weatherCountry = country.value;
      const typed = (body.querySelector('#ob-city') || {}).value;
      if (typed && typed.trim()) this._searchCity(typed.trim(), body);
    });

    const run = () => this._searchCity((body.querySelector('#ob-city') || {}).value.trim(), body);
    body.querySelector('#ob-city-search').addEventListener('click', run);
    body.querySelector('#ob-city').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); run(); }
    });
  },

  // How a place is written out: the most specific part first, then everything
  // above it, so two districts of the same name are told apart at a glance.
  _placeLabel(hit) {
    const parts = [hit.name, hit.admin3, hit.admin2, hit.admin1, hit.country].filter(Boolean);
    const seen = new Set();
    const unique = parts.filter((p) => { const k = String(p).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    let label = unique.join(' · ');
    const codes = Array.isArray(hit.postcodes) ? hit.postcodes.slice(0, 2) : [];
    if (codes.length) label += '  [' + codes.join(', ') + ']';
    return label;
  },

  // The short name stored for the start page.
  _placeShort(hit) {
    const bits = [hit.name];
    if (hit.admin1 && hit.admin1 !== hit.name) bits.push(hit.admin1);
    if (hit.country_code) bits.push(hit.country_code);
    return bits.join(', ');
  },

  async _searchCity(q, body) {
    const wrap = body.querySelector('#ob-city-results-wrap');
    const select = body.querySelector('#ob-city-results');
    const status = body.querySelector('#ob-city-status');
    this._pendingLoc = null;
    if (wrap) wrap.style.display = 'none';
    if (select) select.innerHTML = '';
    if (!q) { if (status) status.textContent = 'Type a city, district or postcode first.'; return; }
    if (status) status.textContent = 'Searching…';

    // Search in the language the user actually picked, not always Turkish —
    // that alone was why so many city names "weren't recognized".
    let lang = 'en';
    try { lang = (this._pendingLang || localStorage.getItem('vex.lang') || 'en').slice(0, 2); } catch { lang = 'en'; }

    let list = [];
    try {
      const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q)
        + '&count=100&language=' + encodeURIComponent(lang) + '&format=json';
      const r = await (window.VexNet?.fetch || fetch)(url);
      const d = await r.json();
      list = (d && d.results) || [];
    } catch (err) {
      if (status) status.textContent = 'Lookup failed (' + ((err && err.message) || 'no connection') + ') — try again.';
      return;
    }

    const country = this._weatherCountry;
    let hits = country ? list.filter((h) => h.country_code === country) : list;
    if (country && !hits.length && list.length) {
      if (status) status.textContent = 'No match for “' + q + '” in ' + this._countryName(country)
        + '. There are ' + list.length + ' elsewhere — set Country to “Any country” to see them.';
      return;
    }
    if (!hits.length) {
      if (status) status.textContent = 'No match for “' + q + '” — try the nearest town, another spelling, or the postcode.';
      return;
    }

    hits = hits.slice(0, 60);
    this._weatherHits = hits;
    select.innerHTML = hits.map((h, i) => '<option value="' + i + '">' + this._esc(this._placeLabel(h)) + '</option>').join('');
    wrap.style.display = 'block';
    status.textContent = hits.length === 1
      ? 'One match — select it to confirm.'
      : hits.length + ' matches. Pick the right one.';

    const choose = () => {
      const hit = this._weatherHits[parseInt(select.value, 10)];
      if (!hit) return;
      this._pendingLoc = { lat: hit.latitude, lon: hit.longitude, city: this._placeShort(hit) };
      status.textContent = 'Using ' + this._placeLabel(hit) + ' — Save & continue to confirm.';
      status.style.color = 'var(--text)';
    };
    select.addEventListener('change', choose);
    if (hits.length === 1) { select.selectedIndex = 0; choose(); }
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
        window.showToast?.('On-device model ready');
      } catch (e) {
        dl.disabled = false; dl.textContent = 'Download now';
        window.showToast?.('Download failed: ' + (e.message || 'error'));
      }
    });
  },

  // === Validation ==========================================================
  //
  // "Save & continue" used to accept an empty box, or a URL that was never
  // going to work, and say nothing — so people finished setup believing they
  // had configured things they hadn't. Now a step either has a usable answer
  // or you press Skip, deliberately. Skip is always available and always
  // works; this only refuses to pretend that nothing is something.
  //
  // Returns null when the step is good, or { field, message } to show.
  _validate(key, overlay) {
    const val = (sel) => (overlay.querySelector(sel)?.value || '').trim();
    const empty = (field, what) => ({ field, message: 'This is empty — ' + what + ', or press Skip to leave it out.' });

    if (key === 'name') {
      const v = val('#ob-name');
      if (!v) return empty('#ob-name', 'type the name you want on your start page');
      if (v.length > 40) return { field: '#ob-name', message: 'That is longer than 40 characters — use something shorter.' };
      return null;
    }

    if (key === 'github') {
      const v = val('#ob-gh');
      if (!v) return empty('#ob-gh', 'type your GitHub username');
      // GitHub's own rule: letters, digits and single hyphens, max 39.
      if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(v)) {
        return { field: '#ob-gh', message: 'That is not a GitHub username — letters, numbers and single hyphens only (no @, no spaces, no full URL).' };
      }
      return null;
    }

    if (key === 'aicloud' || key === 'sync') {
      const sel = key === 'aicloud' ? '#ob-ai-url' : '#ob-sync-url';
      const what = key === 'aicloud' ? 'paste your AI Worker URL' : 'paste your Sync Worker URL';
      const v = val(sel);
      if (!v) return empty(sel, what);
      let u;
      try { u = new URL(v); } catch { return { field: sel, message: 'That is not a web address — it should look like https://your-worker.workers.dev' }; }
      if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
        return { field: sel, message: 'Use https:// — an unencrypted worker would send your requests in the clear.' };
      }
      return null;
    }

    if (key === 'weather') {
      if (this._pendingLoc) return null;
      const typed = val('#ob-city');
      if (!typed) return empty('#ob-city', 'search for your city, district or postcode');
      return { field: '#ob-city', message: 'Pick one of the matches below so the forecast is for the right place — or press Skip.' };
    }

    return null;
  },

  // Show the problem where it happened: red border, message under the field,
  // focus back in the box. Cleared as soon as they type.
  _showError(overlay, problem) {
    overlay.querySelector('#ob-error')?.remove();
    const field = problem.field ? overlay.querySelector(problem.field) : null;
    const note = document.createElement('div');
    note.id = 'ob-error';
    note.setAttribute('role', 'alert');
    note.style.cssText = 'display:flex;align-items:flex-start;gap:7px;margin-top:9px;font-size:12.5px;line-height:1.45;color:var(--danger,#ef4444)';
    note.innerHTML = (window.VexIcons ? VexIcons.svg('warning', { size: 14 }) : '') + '<span></span>';
    note.querySelector('span').textContent = problem.message;

    if (field) {
      field.style.borderColor = 'var(--danger,#ef4444)';
      field.setAttribute('aria-invalid', 'true');
      (field.parentElement || overlay.querySelector('#ob-body')).appendChild(note);
      const clear = () => {
        field.style.borderColor = 'var(--border)';
        field.removeAttribute('aria-invalid');
        overlay.querySelector('#ob-error')?.remove();
        field.removeEventListener('input', clear);
      };
      field.addEventListener('input', clear);
      field.focus();
      field.select?.();
    } else {
      overlay.querySelector('#ob-body').appendChild(note);
    }
  },

  async _commitAndNext(key, overlay) {
    this._stash(key, overlay);   // so Back onto this step re-shows exactly what was typed
    const problem = this._validate(key, overlay);
    if (problem) { this._showError(overlay, problem); return; }
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
      // Validation guarantees a picked place by the time we get here: no more
      // quietly resolving whatever the geocoder ranked first.
      this._setStart('vex.weatherLoc', JSON.stringify(this._pendingLoc));
    } else if (key === 'performance') {
      await this._perfApply(this._perf || this._perfCurrent());
    }
    this.step++;
    this._render();
  },
};

if (typeof window !== 'undefined') window.Onboarding = Onboarding;
if (typeof module !== 'undefined' && module.exports) module.exports = { Onboarding };
