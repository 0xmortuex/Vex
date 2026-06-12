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

  done() { try { return localStorage.getItem(this.KEY) === 'true'; } catch { return true; } },
  finish() { try { localStorage.setItem(this.KEY, 'true'); } catch {} this._close(); this._reloadStartPages(); },

  // Show only on a genuinely fresh install — never to existing users on update.
  maybeStart() {
    if (this.done()) return;
    const EVIDENCE = ['vex.tabs', 'vex.sessions', 'vex.bookmarks', 'vex.notes', 'vex.history', 'vex.aiWorkerUrl', 'vex.userName', 'vex.githubUsername', 'vex.weatherLoc', 'vex.personas'];
    const used = EVIDENCE.some(k => { try { return localStorage.getItem(k) != null; } catch { return false; } });
    if (used) { this.finish(); return; }            // existing install — mark done, don't nag
    setTimeout(() => this.start(), 900);
  },

  start() { this.activeSteps = this.STEPS(); this.step = 0; this._pendingLoc = null; this._render(); },

  // Re-open the wizard on demand (the top-bar setup button). Resume, don't
  // restart: include only the steps the user hasn't completed yet, so someone
  // who paused half-way isn't forced to redo what they already set.
  relaunch() {
    const missing = this._missingStepKeys();
    if (!missing.length) {
      window.showToast?.('You\'re all set up — nothing left to configure ✨', 'info', 2500);
      return;
    }
    const byKey = {}; this.STEPS().forEach(s => byKey[s.key] = s);
    this.activeSteps = [byKey.welcome, ...missing.map(k => byKey[k]), byKey.done];
    this.step = 0;
    this._pendingLoc = null;
    this._render();
  },

  _has(k) { try { const v = localStorage.getItem(k); return v != null && v !== ''; } catch { return false; } },
  _flag(k) { try { return localStorage.getItem(k) === 'true'; } catch { return false; } },

  // Which optional steps still have no value saved. A step is "done" once its
  // data exists. The three AI backends count as ONE thing — configuring any one
  // (cloud URL, local Ollama, or on-device) clears all three, so we never nag
  // someone who already has a working AI backend to set up the other two.
  _missingStepKeys() {
    const out = [];
    if (!this._has('vex.theme')) out.push('theme');
    if (!this._has('vex.userName')) out.push('name');
    if (!this._has('vex.weatherLoc')) out.push('weather');
    if (!this._has('vex.githubUsername')) out.push('github');
    if (!this._has('vex.searchEngine')) out.push('search');
    if (!this._flag('vex.defaultBrowserConfigured')) out.push('defaultbrowser');
    const aiDone = this._has('vex.aiWorkerUrl') || this._flag('vex.preferLocalAI') || this._flag('vex.preferOnDeviceAI');
    if (!aiDone) { out.push('aicloud', 'ollama', 'ondevice'); }
    if (!this._has('vex.syncWorkerUrl')) out.push('sync');
    if (!this._flag('vex.vaultSeeded')) out.push('passwords');
    return out;
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

  _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },

  STEPS() {
    return [
      { key: 'welcome',        title: 'Welcome to Vex 👋',        sub: 'Let’s set up the bits that make Vex feel like yours. Skip anything you don’t want — you can re-open this wizard anytime from the ✦ button by the reload button.' },
      { key: 'theme',          title: 'Pick a theme',             sub: 'You can change this anytime from the start page or Settings.' },
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

  _close() { document.getElementById('vex-onboarding')?.remove(); },

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
    overlay.innerHTML = `
      <div style="width:520px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,0.55);overflow:hidden">
        <div style="padding:24px 26px 8px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px"><span style="font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace">STEP ${this.step + 1} / ${steps.length}</span><span style="flex:1"></span>${dots}</div>
          <div style="font-size:21px;font-weight:700;color:var(--text);margin-top:8px">${this._esc(s.title)}</div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:6px;line-height:1.5">${this._esc(s.sub)}</div>
        </div>
        <div id="ob-body" style="padding:14px 26px;overflow-y:auto;flex:1"></div>
        <div style="display:flex;align-items:center;gap:8px;padding:16px 26px;border-top:1px solid var(--border)">
          <button id="ob-skipall" style="background:none;border:none;color:var(--text-muted);font-family:inherit;font-size:12.5px;cursor:pointer">Skip setup</button>
          <span style="flex:1"></span>
          ${this.step > 0 && !isLast ? `<button id="ob-back" style="padding:9px 16px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:9px;cursor:pointer;font-family:inherit;font-size:13px">Back</button>` : ''}
          ${!isLast ? `<button id="ob-skip" style="padding:9px 16px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:9px;cursor:pointer;font-family:inherit;font-size:13px">Skip</button>` : ''}
          <button id="ob-next" style="padding:9px 22px;background:var(--primary);color:#fff;border:none;border-radius:9px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600">${this.step === 0 ? 'Get started' : isLast ? 'Finish' : 'Save &amp; continue'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#ob-skipall').addEventListener('click', () => this.finish());
    overlay.querySelector('#ob-back')?.addEventListener('click', () => { this.step--; this._render(); });
    overlay.querySelector('#ob-skip')?.addEventListener('click', () => { this.step++; this._render(); });
    overlay.querySelector('#ob-next').addEventListener('click', () => this._commitAndNext(s.key, overlay));
    this._renderBody(s.key, overlay.querySelector('#ob-body'));
  },

  _input(id, ph, val) {
    return `<input id="${id}" placeholder="${this._esc(ph)}" value="${this._esc(val || '')}" spellcheck="false" autocomplete="off" style="width:100%;box-sizing:border-box;padding:11px 13px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:14px;outline:none;font-family:'Outfit',sans-serif">`;
  },

  _renderBody(key, body) {
    const input = (id, ph, val) => this._input(id, ph, val);
    if (key === 'theme') {
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
    } else if (key === 'name') {
      let v = ''; try { v = localStorage.getItem('vex.userName') || ''; } catch {}
      body.innerHTML = input('ob-name', 'e.g. Alex', v);
    } else if (key === 'weather') {
      this._pendingLoc = null;
      body.innerHTML = `
        <div style="display:flex;gap:8px">
          <div style="flex:1">${input('ob-city', 'e.g. Ataşehir or Istanbul')}</div>
          <button id="ob-city-search" style="padding:0 16px;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600">Search</button>
        </div>
        <div id="ob-city-results" style="display:flex;flex-direction:column;gap:6px;margin-top:10px"></div>
        <div id="ob-city-status" style="font-size:12px;color:var(--text-muted);margin-top:8px;min-height:16px"></div>`;
      const run = () => this._searchCity(body.querySelector('#ob-city')?.value.trim(), body);
      body.querySelector('#ob-city-search')?.addEventListener('click', run);
      body.querySelector('#ob-city')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    } else if (key === 'github') {
      let v = ''; try { v = localStorage.getItem('vex.githubUsername') || ''; } catch {}
      body.innerHTML = input('ob-gh', 'e.g. octocat', v);
    } else if (key === 'search') {
      const ENGINES = this._engines();
      let cur = 'google'; try { cur = localStorage.getItem('vex.searchEngine') || 'google'; } catch {}
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
      let cur = ''; try { cur = localStorage.getItem('vex.aiWorkerUrl') || ''; } catch {}
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
      let cur = ''; try { cur = localStorage.getItem('vex.syncWorkerUrl') || ''; } catch {}
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
    } else {
      body.innerHTML = '';   // welcome / done have no body
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
    if (key === 'name') {
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
