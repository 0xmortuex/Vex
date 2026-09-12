// === Developer mode ========================================================
//
// Two ways to use Vex, on top of whichever theme is chosen:
//
//   User       what everyone gets. Nothing extra.
//   Developer  a dashboard of the things you reach for while working ON Vex
//              rather than browsing with it — what version is running, what
//              the stores hold, and the resets you otherwise do by hand.
//
// It is a mode, not a theme: it changes what is AVAILABLE, not what things look
// like, so it works under every look Vex ships.
//
// Everything destructive asks first and says exactly what it will remove.
// "Reset Vex" wipes the browser's own data, so it is behind a typed
// confirmation rather than a single click that cannot be taken back.
const VexDevMode = {
  KEY: 'vex.devMode',

  isOn() {
    try { return localStorage.getItem(this.KEY) === '1'; } catch { return false; }
  },

  // Returns false when the preference could not be stored, so a caller can say
  // so rather than claim a mode change that will not survive a restart.
  set(on) {
    try { localStorage.setItem(this.KEY, on ? '1' : '0'); } catch { return false; }
    this.apply();
    return true;
  },

  toggle() { return this.set(!this.isOn()); },

  // Show or hide every developer-only surface at once.
  apply() {
    const on = this.isOn();
    document.body.classList.toggle('vex-dev-mode', on);
    for (const el of document.querySelectorAll('[data-dev-only]')) el.hidden = !on;
    const btn = document.getElementById('btn-dev-dash');
    if (!btn) return;
    btn.hidden = !on;
    // Sit immediately after the Toolbox button. That button is drawn by
    // JobProfiles whenever a job is set and is re-created on every redraw, so
    // the position is re-established here rather than fixed in the markup.
    const toolbox = [...document.querySelectorAll('#top-bar-right .vex-job-btn')]
      .find(b => /Toolbox/i.test(b.title || ''));
    if (toolbox && toolbox.nextSibling !== btn) toolbox.after(btn);
  },

  init() {
    this.apply();
    document.getElementById('btn-dev-dash')?.addEventListener('click', () => this.openDashboard());
  },

  // ---- the numbers the dashboard reports ---------------------------------
  _bytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  },

  stats() {
    let keys = 0, bytes = 0;
    const biggest = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const size = (localStorage.getItem(k) || '').length + k.length;
        keys++; bytes += size;
        biggest.push([k, size]);
      }
    } catch { /* storage unavailable — reported as zero below, not hidden */ }
    biggest.sort((a, b) => b[1] - a[1]);
    const tabs = (typeof TabManager !== 'undefined' && TabManager.tabs) ? TabManager.tabs.length : 0;
    const wv = document.querySelectorAll('webview').length;
    return {
      keys, bytes, biggest: biggest.slice(0, 8), tabs, webviews: wv,
      listeners: null,
      chromium: (navigator.userAgent.split('Chrome/')[1] || '').split(' ')[0] || 'unknown',
      tools: (typeof Toolbox !== 'undefined' && Toolbox.all) ? Toolbox.all().length : 0,
      commands: (typeof CommandBar !== 'undefined' && CommandBar.commands) ? CommandBar.commands.length : 0,
      features: (typeof VexFeatures !== 'undefined' && VexFeatures.ITEMS) ? VexFeatures.ITEMS.length : 0,
      personas: (typeof PersonasManager !== 'undefined' && PersonasManager.getAll) ? PersonasManager.getAll().length : 0,
    };
  },

  // ---- actions ------------------------------------------------------------
  //
  // Each says what it did, or why it could not. None of them fail silently.
  actions() {
    return [
      {
        id: 'reload', label: 'Reload the interface', icon: 'refresh',
        what: 'Restarts the renderer without restarting Vex. Tabs and settings survive.',
        run: () => { location.reload(); return 'Reloading…'; },
      },
      {
        id: 'devtools', label: 'Open DevTools', icon: 'terminal',
        what: 'The Chromium inspector for the interface itself, not the page.',
        run: () => {
          if (!window.vexDevTools || !window.vexDevTools.open) throw new Error('DevTools are not exposed in this build.');
          window.vexDevTools.open();
          return 'DevTools opened';
        },
      },
      {
        id: 'copy-diag', label: 'Copy diagnostics', icon: 'clipboard',
        what: 'Version, Chromium build, tab and store counts — what a bug report needs.',
        run: async () => {
          const s = this.stats();
          const text = [
            'Vex diagnostics',
            'chromium   ' + s.chromium,
            'tabs       ' + s.tabs,
            'webviews   ' + s.webviews,
            'storage    ' + s.keys + ' keys, ' + this._bytes(s.bytes),
            'tools      ' + s.tools,
            'commands   ' + s.commands,
            'features   ' + s.features,
            'personas   ' + s.personas,
            'devMode    on',
          ].join('\n');
          await navigator.clipboard.writeText(text);
          return 'Diagnostics copied';
        },
      },
      {
        id: 'clear-ai', label: 'Clear AI conversations', icon: 'message',
        what: 'Every stored chat, in every tab.',
        confirm: 'Delete every AI conversation?',
        run: () => {
          localStorage.removeItem('vex.aiConversations');
          if (typeof AIPanel !== 'undefined') { AIPanel._conversations = {}; AIPanel._renderMessages?.(); }
          return 'AI conversations cleared';
        },
      },
      {
        id: 'clear-tools', label: 'Reset tool preferences', icon: 'toolbox',
        what: 'The options and remembered inputs each tool keeps, plus your favourites.',
        confirm: 'Reset every tool’s saved options and favourites?',
        run: () => {
          const doomed = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.startsWith('vex.tool.') || k === 'vex.toolFavourites')) doomed.push(k);
          }
          for (const k of doomed) localStorage.removeItem(k);
          return `Cleared ${doomed.length} tool preference${doomed.length === 1 ? '' : 's'}`;
        },
      },
      {
        id: 'seed-tabs', label: 'Open five test tabs', icon: 'tabs',
        what: 'Five real pages, for trying tab behaviour without hunting for URLs.',
        run: () => {
          if (typeof TabManager === 'undefined') throw new Error('TabManager is not available.');
          const urls = ['https://example.com/', 'https://example.org/', 'https://example.net/',
            'https://www.iana.org/help/example-domains', 'https://httpbin.org/html'];
          for (const u of urls) TabManager.createTab(u, false);
          return 'Opened 5 tabs';
        },
      },
      {
        id: 'wizard', label: 'Replay the setup wizard', icon: 'sparkles',
        what: 'Runs first-run setup again, without touching anything else.',
        run: () => {
          if (typeof Onboarding === 'undefined' || !Onboarding.start) throw new Error('The setup wizard is not loaded.');
          localStorage.removeItem('vex.onboardingDone');
          Onboarding.start();
          return 'Setup wizard restarted';
        },
      },
      {
        id: 'reset', label: 'Reset Vex', icon: 'warning', danger: true,
        what: 'Removes every Vex setting, tab, note, chat and saved tool preference from this machine. Your vault and browsing history in the underlying profile are not touched by this button.',
        typed: 'RESET',
        run: () => {
          const doomed = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('vex')) doomed.push(k);
          }
          for (const k of doomed) localStorage.removeItem(k);
          setTimeout(() => location.reload(), 400);
          return `Removed ${doomed.length} keys — reloading`;
        },
      },
    ];
  },


  // The same dashboard, in the sidebar. Sharing the action list means the two
  // surfaces can never drift apart — a new action appears in both.
  renderPanel(container) {
    if (!container) return;
    const esc = (s) => (window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));
    const icon = (n, sz) => (window.VexIcons && VexIcons.has(n)) ? VexIcons.svg(n, { size: sz || 14 }) : '';
    const s = this.stats();

    container.innerHTML = `
      <div class="panel-header"><h2>Developer</h2></div>
      <div class="dd-panel">
        <section class="dd-stats">
          ${[['Chromium', s.chromium], ['Tabs', s.tabs], ['Keys', s.keys],
    ['Storage', this._bytes(s.bytes)], ['Tools', s.tools], ['Commands', s.commands]]
    .map(([k, v]) => `<div class="dd-stat"><span class="dd-stat-v">${esc(v)}</span><span class="dd-stat-k">${esc(k)}</span></div>`).join('')}
        </section>
        <h4 class="dd-h">Quick actions</h4>
        <div class="dd-actions dd-actions-narrow" id="dd-panel-actions"></div>
        <button class="dd-open-full" id="dd-open-full">${icon('maximize', 13)} Open the full dashboard</button>
      </div>`;

    const wrap = container.querySelector('#dd-panel-actions');
    for (const a of this.actions()) {
      const b = document.createElement('button');
      b.className = 'dd-action' + (a.danger ? ' dd-danger' : '');
      b.innerHTML = `<span class="dd-action-icon">${icon(a.icon, 14)}</span>
        <span class="dd-action-text"><span class="dd-action-label"></span></span>`;
      b.querySelector('.dd-action-label').textContent = a.label;
      b.title = a.what;
      b.addEventListener('click', () => this._runAction(a, () => this.renderPanel(container)));
      wrap.appendChild(b);
    }
    container.querySelector('#dd-open-full')?.addEventListener('click', () => this.openDashboard());
  },

  // One place that asks, runs and reports — used by both surfaces.
  async _runAction(a, after) {
    try {
      if (a.typed) {
        const answer = window.vexPrompt
          ? await window.vexPrompt(`${a.what}\n\nType ${a.typed} to confirm.`, '')
          : window.prompt(`${a.what}\n\nType ${a.typed} to confirm.`);
        if (String(answer || '').trim().toUpperCase() !== a.typed) { window.showToast?.('Cancelled'); return; }
      } else if (a.confirm) {
        const ok = window.vexConfirm ? await window.vexConfirm(a.confirm) : window.confirm(a.confirm);
        if (!ok) return;
      }
      const msg = await a.run();
      if (msg) window.showToast?.(msg);
      if (typeof after === 'function') after();
    } catch (err) {
      window.showToast?.((err && err.message) || 'That did not work', 'error');
    }
  },

  // ---- the dashboard ------------------------------------------------------
  openDashboard() {
    document.getElementById('vex-devdash')?.remove();
    const esc = (s) => (window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));
    const icon = (n, sz) => (window.VexIcons && VexIcons.has(n)) ? VexIcons.svg(n, { size: sz || 14 }) : '';
    const s = this.stats();

    const m = document.createElement('div');
    m.id = 'vex-devdash';
    m.className = 'dd-overlay';
    m.innerHTML = `
      <div class="dd-shell" role="dialog" aria-label="Developer dashboard">
        <div class="dd-head">
          <span class="dd-head-icon">${icon('terminal', 16)}</span>
          <span class="dd-head-title">Developer</span>
          <span class="dd-head-sub">Tools for working on Vex, not with it</span>
          <button class="dd-icon-btn" id="dd-close" title="Close" aria-label="Close">${icon('x', 15)}</button>
        </div>
        <div class="dd-body">
          <section class="dd-stats">
            ${[['Chromium', s.chromium], ['Tabs', s.tabs], ['Webviews', s.webviews],
    ['Stored keys', s.keys], ['Storage used', this._bytes(s.bytes)],
    ['Tools', s.tools], ['Commands', s.commands], ['Features', s.features], ['Personas', s.personas]]
    .map(([k, v]) => `<div class="dd-stat"><span class="dd-stat-v">${esc(v)}</span><span class="dd-stat-k">${esc(k)}</span></div>`).join('')}
          </section>

          <h4 class="dd-h">Quick actions</h4>
          <div class="dd-actions" id="dd-actions"></div>

          <h4 class="dd-h">Largest stored values</h4>
          <table class="dd-table">
            ${s.biggest.map(([k, n]) => `<tr><th>${esc(k)}</th><td>${esc(this._bytes(n))}</td></tr>`).join('')
    || '<tr><td>Nothing stored yet.</td></tr>'}
          </table>
        </div>
      </div>`;
    document.body.appendChild(m);

    const close = () => m.remove();
    m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
    m.querySelector('#dd-close').addEventListener('click', close);
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

    const wrap = m.querySelector('#dd-actions');
    for (const a of this.actions()) {
      const b = document.createElement('button');
      b.className = 'dd-action' + (a.danger ? ' dd-danger' : '');
      b.innerHTML = `<span class="dd-action-icon">${icon(a.icon, 14)}</span>
        <span class="dd-action-text"><span class="dd-action-label"></span><span class="dd-action-what"></span></span>`;
      b.querySelector('.dd-action-label').textContent = a.label;
      b.querySelector('.dd-action-what').textContent = a.what;
      b.addEventListener('click', () => this._runAction(a, () => { if (['clear-tools', 'clear-ai'].includes(a.id)) close(); }));
      wrap.appendChild(b);
    }
    return { root: m, close };
  },
};

if (typeof window !== 'undefined') window.VexDevMode = VexDevMode;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDevMode };
