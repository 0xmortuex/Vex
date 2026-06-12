// === Vex First-Run Onboarding ===
//
// A step-by-step setup wizard shown once on a fresh install. Walks the user
// through each tool that benefits from setup (theme, name, weather, GitHub, AI
// backend), with a Skip on every step and a "Skip all" to bail at any point.
// Runs in the host renderer. Start-page values (name/weather/GitHub) live in the
// start page's OWN localStorage (separate webview session), so we write them
// there via the live webview AND mirror to host localStorage (where Settings
// reads them), then reload the start page so it picks them up.

const Onboarding = {
  KEY: 'vex.onboardingDone',
  step: 0,

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

  start() { this.step = 0; this._render(); },

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
      { key: 'welcome',  title: 'Welcome to Vex 👋',        sub: 'Let’s set up the bits that make Vex feel like yours. This takes about a minute — skip anything you don’t want.' },
      { key: 'theme',    title: 'Pick a theme',             sub: 'You can change this anytime from the start page or Settings.' },
      { key: 'name',     title: 'What should we call you?', sub: 'Used only for the start-page greeting. Leave blank for none.' },
      { key: 'weather',  title: 'Weather location',         sub: 'Type your city for accurate weather on the start page.' },
      { key: 'github',   title: 'GitHub username',          sub: 'Optional — shows your repo/follower stats + activity on the start page.' },
      { key: 'ai',       title: 'AI backend',               sub: 'Vex can use cloud AI (Claude), a local Ollama model, or on-device AI. Set one up now or later in Settings.' },
      { key: 'done',     title: 'All set ✨',               sub: 'You’re ready. Everything here lives in Settings if you want to change it later.' },
    ];
  },

  _close() { document.getElementById('vex-onboarding')?.remove(); },

  _render() {
    const steps = this.STEPS();
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

  _renderBody(key, body) {
    const input = (id, ph, val) => `<input id="${id}" placeholder="${this._esc(ph)}" value="${this._esc(val || '')}" spellcheck="false" autocomplete="off" style="width:100%;box-sizing:border-box;padding:11px 13px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:14px;outline:none;font-family:'Outfit',sans-serif">`;
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
      body.innerHTML = input('ob-city', 'e.g. Istanbul') + `<div id="ob-city-status" style="font-size:12px;color:var(--text-muted);margin-top:8px;min-height:16px"></div>`;
    } else if (key === 'github') {
      let v = ''; try { v = localStorage.getItem('vex.githubUsername') || ''; } catch {}
      body.innerHTML = input('ob-gh', 'e.g. octocat', v);
    } else if (key === 'ai') {
      let cur = ''; try { cur = localStorage.getItem('vex.aiWorkerUrl') || ''; } catch {}
      body.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px">
          <label style="font-size:12.5px;color:var(--text-muted)">Cloud AI Worker URL (Claude — see SELF_HOSTING.md)</label>
          ${input('ob-ai-url', 'https://your-vex-ai.workers.dev', cur)}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
            <button id="ob-ollama" style="padding:8px 14px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit;font-size:12.5px">Set up local Ollama instead</button>
            <span id="ob-ollama-status" style="font-size:12px;color:var(--text-muted);align-self:center"></span>
          </div>
          <p style="font-size:11.5px;color:var(--text-muted);margin-top:4px">You can also download an on-device model later in Settings → On-Device AI. Leave blank to decide later.</p>
        </div>`;
      body.querySelector('#ob-ollama')?.addEventListener('click', async () => {
        const st = body.querySelector('#ob-ollama-status');
        st.textContent = 'Checking for Ollama…';
        let up = false;
        try { up = (typeof AIRouter !== 'undefined') ? await AIRouter.refreshOllamaStatus() : false; } catch {}
        if (up) { st.textContent = '✓ Ollama detected — local AI ready'; try { AIRouter.setPreferLocal(true); } catch {} }
        else { st.textContent = 'Not found — opening the install guide…'; try { TabManager.createTab('https://ollama.com/download', true); } catch {} }
      });
    } else {
      body.innerHTML = '';   // welcome / done have no body
    }
  },

  async _commitAndNext(key, overlay) {
    if (key === 'name') {
      const v = overlay.querySelector('#ob-name')?.value.trim() || '';
      this._setStart('vex.userName', v || null);
    } else if (key === 'github') {
      const v = overlay.querySelector('#ob-gh')?.value.trim() || '';
      this._setStart('vex.githubUsername', v || null);
    } else if (key === 'ai') {
      const v = overlay.querySelector('#ob-ai-url')?.value.trim() || '';
      try { v ? localStorage.setItem('vex.aiWorkerUrl', v) : localStorage.removeItem('vex.aiWorkerUrl'); } catch {}
    } else if (key === 'weather') {
      const city = overlay.querySelector('#ob-city')?.value.trim() || '';
      if (city) {
        const st = overlay.querySelector('#ob-city-status');
        if (st) st.textContent = 'Looking up…';
        try {
          const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=tr`);
          const d = await r.json();
          const hit = d && d.results && d.results[0];
          if (hit) {
            this._setStart('vex.weatherLoc', JSON.stringify({ lat: hit.latitude, lon: hit.longitude, city: hit.name + (hit.country_code ? ', ' + hit.country_code : '') }));
          } else if (st) { st.textContent = 'Couldn’t find that — you can set it later. Continuing…'; }
        } catch { if (st) st.textContent = 'Lookup failed — set it later in the start page.'; }
      }
    }
    this.step++;
    this._render();
  },
};

if (typeof window !== 'undefined') window.Onboarding = Onboarding;
if (typeof module !== 'undefined' && module.exports) module.exports = { Onboarding };
