// === Vex Memory panel: tabs, sidebar panels, and every process Vex runs ===
// Numbers here are measurements from main (app.getAppMetrics), never
// estimates. Three sections: the tabs (sleep / wake / reload / close), the web
// panels (Discord, Claude, Spotify… — sleep / reload / open), and the process
// list, which names each OS process — "Panel: Discord", "uBlock Origin —
// background · persist:spotify", "GPU process" — with resident and committed
// memory and CPU, and a Copy report button for pasting somewhere.

const MemoryPanel = {
  refreshInterval: null,
  _lastReport: '',

  init() {
    const panel = document.getElementById('panel-memory');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = 'true';

    panel.innerHTML = `
      <div class="memory-container">
        <div class="memory-header">
          <h2>Memory</h2>
          <div class="memory-total" id="memory-total">-- MB</div>
        </div>
        <div class="memory-actions">
          <button id="memory-free-now" title="Sleep idle tabs (pinned ones idle over 30 min too), sleep hidden panels, unload extensions from sessions with no page">Free memory now</button>
          <button id="memory-sleep-all">Sleep inactive tabs</button>
          <button id="memory-reload-all">Reload all tabs</button>
        </div>
        <div class="memory-trend" id="memory-trend" title="Total memory since launch, sampled every 30 seconds; dots mark what Vex did"></div>
        <div class="memory-list" id="memory-list">
          <div style="padding:40px;text-align:center;color:var(--text-muted)">Loading...</div>
        </div>
        <div class="memory-section">
          <div class="memory-section-head"><h3>Panels</h3><span class="memory-section-note">Hidden panels sleep after the same idle time as tabs (Settings › Performance); Discord is kept awake.</span></div>
          <div class="memory-list" id="memory-panels"></div>
        </div>
        <div class="memory-section">
          <div class="memory-section-head"><h3>Processes</h3><span class="memory-section-note">Every process Vex runs and what it is.</span><button id="memory-copy-report">Copy report</button></div>
          <div class="memory-summary" id="memory-summary"></div>
          <div id="memory-procs"></div>
        </div>
        <div class="memory-section">
          <div class="memory-section-head"><h3>Health</h3><span class="memory-section-note">Since launch: crashes, hangs, helper processes gone, extension errors, the updater, startup timings.</span></div>
          <div id="memory-health"></div>
        </div>
      </div>
    `;

    document.getElementById('memory-sleep-all')?.addEventListener('click', async (e) => {
      // Reuse TabManager's audible-aware path so we never silence a tab that's
      // playing audio. Redraw only once the sleeps have finished — refreshing
      // straight away showed every tab still awake.
      const btn = e.currentTarget;
      btn.disabled = true;
      try { await TabManager.sleepAllInactive(); } finally { btn.disabled = false; }
      await this.refresh();
      window.showToast?.('Inactive tabs put to sleep');
    });

    document.getElementById('memory-reload-all')?.addEventListener('click', () => {
      TabManager.tabs.forEach(t => {
        if (!t.sleeping && !t._lazy) {
          const wv = WebviewManager.webviews.get(t.id);
          if (wv) wv.reload();
        }
      });
      window.showToast?.('All tabs reloading');
    });

    document.getElementById('memory-free-now')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try { await this.freeNow(); } finally { btn.disabled = false; }
    });

    document.getElementById('memory-copy-report')?.addEventListener('click', async () => {
      if (!this._lastReport) { window.showToast?.('Nothing measured yet', 'error'); return; }
      try {
        await navigator.clipboard.writeText(this._lastReport);
        window.showToast?.('Report copied');
      } catch (err) {
        window.showToast?.('Could not copy: ' + (err && err.message), 'error');
      }
    });

    this.refresh();
    this.startAutoRefresh();
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(() => {
      // Only refresh if panel is visible
      const panel = document.getElementById('panel-memory');
      if (panel && panel.style.display !== 'none') {
        this.refresh();
      }
    }, 3000);
  },

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  },

  async refresh() {
    const list = document.getElementById('memory-list');
    const totalEl = document.getElementById('memory-total');
    if (!list) return;

    // Gather each materialized tab's <webview> webContents id so main can map it
    // to its real OS process memory. Sleeping/lazy tabs have no process.
    const entries = TabManager.tabs.map(tab => {
      const wv = WebviewManager.webviews.get(tab.id);
      const materialized = !!wv && !tab.sleeping && !tab._lazy;
      let wcId = null;
      if (materialized && typeof wv.getWebContentsId === 'function') {
        try { wcId = wv.getWebContentsId(); } catch { /* not attached yet */ }
      }
      return { tab, wv, materialized, wcId };
    });
    const panels = this.panelEntries();

    // Real per-process memory from main. No estimates: a number shown here is
    // a measurement, or the row says why there isn't one.
    let mem;
    try {
      const ids = [...entries.filter(e => e.wcId != null).map(e => e.wcId), ...panels.filter(p => p.wcId != null).map(p => p.wcId)];
      mem = await window.vex.tabMemory(ids);
    } catch (err) {
      console.error('[memory] could not read tab memory:', err);
      if (totalEl) { totalEl.textContent = "Couldn't read memory"; totalEl.className = 'memory-total red'; }
      return;
    }
    const shareCount = MemoryPanel.shareCounts(mem.byId);

    const tabData = entries.map(e => {
      const real = e.wcId != null ? mem.byId[e.wcId] || null : null;
      const d = MemoryPanel.describe(e.tab, real, real ? shareCount[real.pid] : 0);
      return {
        id: e.tab.id,
        title: e.tab.title,
        url: e.tab.url,
        active: e.tab.id === TabManager.activeTabId,
        sleeping: d.sleeping,
        memMB: d.mb,
        label: d.label,
      };
    });

    const asleep = entries.filter(e => e.tab.sleeping || e.tab._lazy).length;
    // True browser footprint (all processes incl. main/GPU), not the per-tab sum.
    const totalMB = Math.round(mem.totalKB / 1024);

    if (totalEl) {
      const fmt = totalMB < 1024 ? totalMB + ' MB' : (totalMB / 1024).toFixed(1) + ' GB';
      totalEl.textContent = asleep ? `${fmt} · ${asleep} asleep` : fmt;
      totalEl.className = 'memory-total ' + (totalMB < 500 ? 'green' : totalMB < 1000 ? 'amber' : 'red');
    }

    // Sort by memory descending; a tab still starting (no number yet) goes last.
    tabData.sort((a, b) => (b.memMB ?? -1) - (a.memMB ?? -1));

    list.innerHTML = tabData.map(t => {
      const sizeClass = t.memMB == null ? '' : t.memMB < 100 ? 'green' : t.memMB < 300 ? 'amber' : 'red';
      const sleeping = t.sleeping;
      const sizeLabel = this._esc(t.label);
      return `
        <div class="memory-item${sleeping ? ' memory-sleeping' : ''}" data-id="${t.id}">
          <div class="memory-item-info">
            <div class="memory-item-title">${this._esc(t.title)}${t.active ? ' (active)' : ''}</div>
            <div class="memory-item-url">${this._esc(t.url)}</div>
          </div>
          <div class="memory-item-size ${sleeping ? '' : sizeClass}">${sizeLabel}</div>
          <div class="memory-item-actions">
            ${!sleeping && !t.active ? '<button class="mem-sleep" title="Sleep">Sleep</button>' : ''}
            ${sleeping ? '<button class="mem-wake" title="Wake">Wake</button>' : ''}
            ${!sleeping ? '<button class="mem-reload" title="Reload">Reload</button>' : ''}
            <button class="mem-close" title="Close" style="color:var(--danger)">Close</button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.memory-item').forEach(el => {
      const tabId = el.dataset.id;
      // A click on Sleep is a direct request: force it past keep-awake (as Tab
      // Health does), and redraw once it has actually slept.
      el.querySelector('.mem-sleep')?.addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = '…';
        await TabManager.sleepTab(tabId, true);
        await this.refresh();
      });
      el.querySelector('.mem-wake')?.addEventListener('click', () => { TabManager.wakeTab(tabId); this.refresh(); });
      el.querySelector('.mem-reload')?.addEventListener('click', () => {
        const wv = WebviewManager.webviews.get(tabId);
        if (wv) wv.reload();
      });
      el.querySelector('.mem-close')?.addEventListener('click', () => { TabManager.closeTab(tabId); this.refresh(); });
    });

    this.renderPanels(panels, mem);
    this.renderTrend();
    // Who holds the microphone or camera — named on the capture utilities' rows.
    const captures = [];
    for (const e of entries) if (TabManager.isCapturing && TabManager.isCapturing(e.tab)) captures.push(`Tab: ${e.tab.title || e.tab.url} (${e.tab.capturing.camera ? 'camera' : 'mic'})`);
    if (typeof SidebarManager !== 'undefined' && SidebarManager.panelCapture) {
      for (const [name, c] of Object.entries(SidebarManager.panelCapture)) if (c && (c.mic || c.camera)) captures.push(`Panel: ${SidebarManager.panelLabel(name)} (${c.camera ? 'camera' : 'mic'})`);
    }
    const ctx = {
      tabs: new Map(entries.filter(e => e.wcId != null).map(e => [e.wcId, e.tab.title || e.tab.url])),
      panels: new Map(panels.filter(p => p.wcId != null).map(p => [p.wcId, p.label])),
      captures,
    };
    // The process table is the expensive part to draw (it was the 7% CPU seen
    // with the panel open): every 10 s is plenty, tabs and panels stay at 3 s.
    if (!this._lastProcs || Date.now() - this._lastProcs > 9500) {
      this._lastProcs = Date.now();
      await this.renderProcesses(ctx);
      await this.renderDiagnostics();
      if (this._lastHealth) this._lastReport += '\n\nHealth\n' + this._lastHealth;
    }
  },

  // ---- Panels ---------------------------------------------------------------

  // The web panels (Discord, Claude, Spotify, pinned sites…): loaded or not,
  // and the webContents id of the loaded ones for main to measure.
  panelEntries() {
    if (typeof SidebarManager === 'undefined' || !SidebarManager.panelConfigs) return [];
    const exempt = SidebarManager.panelSleepPrefs ? SidebarManager.panelSleepPrefs().exempt : [];
    return Object.keys(SidebarManager.panelConfigs).filter(n => SidebarManager.isWebPanel(n)).map(name => {
      const wv = SidebarManager.panelWebviews[name];
      let wcId = null;
      if (wv && typeof wv.getWebContentsId === 'function') { try { wcId = wv.getWebContentsId(); } catch {} }
      return {
        name, label: SidebarManager.panelLabel(name), url: SidebarManager.panelConfigs[name].url,
        loaded: !!wv, wcId,
        open: name === SidebarManager.activePanel || name === SidebarManager.sidePanel,
        exempt: exempt.includes(name),
      };
    });
  },

  // { mb, text } — text is what the size cell says.
  describePanel(p, real) {
    if (!p.loaded) return { mb: 0, text: '0 MB · asleep' };
    if (!real) return { mb: null, text: 'starting…' };
    const mb = Math.round(real.memKB / 1024);
    return { mb, text: `${mb} MB${p.open ? ' · open' : ''}` };
  },

  renderPanels(panels, mem) {
    const host = document.getElementById('memory-panels');
    if (!host) return;
    const rows = panels.map(p => ({ ...p, ...this.describePanel(p, p.wcId != null ? mem.byId[p.wcId] || null : null) }));
    rows.sort((a, b) => (b.mb ?? -1) - (a.mb ?? -1));
    host.innerHTML = rows.map(p => {
      const sizeClass = p.mb == null ? '' : p.mb < 100 ? 'green' : p.mb < 300 ? 'amber' : 'red';
      return `
        <div class="memory-item${p.loaded ? '' : ' memory-sleeping'}" data-panel="${this._esc(p.name)}">
          <div class="memory-item-info">
            <div class="memory-item-title">${this._esc(p.label)}${p.exempt ? '<span class="memory-item-kept">kept awake</span>' : ''}</div>
            <div class="memory-item-url">${this._esc(p.url)}</div>
          </div>
          <div class="memory-item-size ${p.loaded ? sizeClass : ''}">${this._esc(p.text)}</div>
          <div class="memory-item-actions">
            ${p.loaded && !p.open ? '<button class="mem-panel-sleep" title="Sleep">Sleep</button>' : ''}
            ${p.loaded ? '<button class="mem-panel-reload" title="Reload">Reload</button>' : ''}
            ${!p.open ? '<button class="mem-panel-open" title="Open">Open</button>' : ''}
          </div>
        </div>`;
    }).join('') || '<div style="padding:12px;color:var(--text-muted);font-size:12px">No web panels.</div>';

    host.querySelectorAll('.memory-item').forEach(el => {
      const name = el.dataset.panel;
      el.querySelector('.mem-panel-sleep')?.addEventListener('click', async () => {
        try { SidebarManager.sleepPanel(name); } catch (err) { window.showToast?.(err.message, 'error'); }
        await this.refresh();
      });
      el.querySelector('.mem-panel-reload')?.addEventListener('click', () => {
        const wv = SidebarManager.panelWebviews[name];
        try { if (wv) wv.reload(); } catch (err) { window.showToast?.(err.message, 'error'); }
      });
      el.querySelector('.mem-panel-open')?.addEventListener('click', () => SidebarManager.showPanel(name));
    });
  },

  // ---- Processes ------------------------------------------------------------

  // What one OS process is, from main's list joined with what the renderer
  // knows: which webContents ids are tabs and which are panels.
  describeProcess(p, ctx) {
    const contents = Array.isArray(p.contents) ? p.contents : [];
    if (p.type === 'Browser') return { kind: 'main', what: 'Vex — main process', detail: 'windows, IPC, extensions, reminders' };
    if (p.type === 'GPU') return { kind: 'gpu', what: 'GPU process', detail: 'compositing and video for every page' };
    if (p.type === 'Utility') {
      // Chromium starts these for a page and keeps them while any page needs
      // them; the Memory panel cannot see which page, so it says what would.
      const name = p.name || 'service';
      const why = /video capture/i.test(name) ? 'runs while a page uses the camera, screen share, or watches the device list (a chat site with voice, say); ends when none does'
        : /audio/i.test(name) ? 'runs while a page plays or records sound, or keeps an audio context; ends when none does'
        : /network/i.test(name) ? 'all HTTP for every page; always on'
        : /cdm|decrypt|widevine/i.test(name) ? 'DRM for Spotify, Netflix, Prime; ends when they close'
        : '';
      const captures = (ctx && Array.isArray(ctx.captures)) ? ctx.captures : [];
      const holders = /video capture|audio/i.test(name) && captures.length ? ' — in use by ' + captures.join(', ') : '';
      return { kind: 'utility', what: 'Utility — ' + name, detail: why + holders };
    }
    const bg = contents.filter(c => c.kind === 'backgroundPage');
    if (bg.length) {
      const names = [...new Set(bg.map(c => c.extension || 'extension'))];
      return { kind: 'extension', what: names.join(', ') + ' — background', detail: bg.map(c => c.partition || 'unknown session').join(' · ') };
    }
    if (contents.some(c => c.kind === 'window')) return { kind: 'ui', what: 'Vex interface', detail: 'toolbar, tabs, sidebar' };
    const pages = contents.filter(c => c.kind === 'webview');
    if (pages.length) {
      const named = pages.map(c => {
        if (ctx && ctx.panels && ctx.panels.has(c.id)) return { kind: 'panel', name: 'Panel: ' + ctx.panels.get(c.id) };
        if (ctx && ctx.tabs && ctx.tabs.has(c.id)) return { kind: 'tab', name: 'Tab: ' + ctx.tabs.get(c.id) };
        return { kind: 'tab', name: c.title || c.url || 'page' };
      });
      const what = named[0].name + (named.length > 1 ? ` + ${named.length - 1} more (same site, shared)` : '');
      return { kind: named.some(n => n.kind === 'panel') ? 'panel' : 'tab', what, detail: pages.map(c => c.url).filter(Boolean).join(' · ') };
    }
    // No page in it: most likely one of the running service workers (an MV3
    // extension's background lives in a renderer of its own, one per session),
    // else a spare renderer or a page closing. Electron cannot say which.
    const workers = (ctx && Array.isArray(ctx.workers)) ? ctx.workers : [];
    if (workers.length) {
      const names = {};
      for (const w of workers) { const n = w.extension || (w.url || '').replace(/^[a-z]+:\/\//, '').split('/')[0] || 'worker'; names[n] = (names[n] || 0) + 1; }
      const list = Object.entries(names).map(([n, c]) => c > 1 ? `${n} ×${c}` : n).join(', ');
      return { kind: 'other', what: 'Renderer with no page — a service worker, most likely', detail: `${workers.length} running: ${list}; or a spare renderer` };
    }
    return { kind: 'other', what: 'Renderer with no page', detail: 'spare, or a page closing' };
  },

  _fmt(mb) { return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb + ' MB'; },

  // ---- Health since launch -----------------------------------------------------
  // main's app:diagnostics: events (crashes, hangs, helpers gone), extension
  // load errors, the updater's last word, startup marks. Shown, and appended
  // to the report.
  _fmtAgo(ms) {
    const m = Math.round(ms / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : (m / 60).toFixed(1) + ' h ago';
  },

  healthLines(d) {
    const lines = [];
    const up = Math.round((d.uptimeMs || 0) / 60000);
    lines.push(`Vex ${d.version || '?'} · Electron ${d.electron || '?'} · Chromium ${d.chrome || '?'} · up ${up < 60 ? up + ' min' : (up / 60).toFixed(1) + ' h'}`);
    const m = d.marks || {};
    const parts = ['app-ready', 'window-shown', 'interface-loaded', 'first-page-loaded'].filter(k => k in m).map(k => `${k.replace(/-/g, ' ')} ${(m[k] / 1000).toFixed(1)} s`);
    if (parts.length) lines.push('Startup: ' + parts.join(' · '));
    const ev = Array.isArray(d.events) ? d.events : [];
    lines.push(ev.length ? `${ev.length} event${ev.length === 1 ? '' : 's'} since launch:` : 'No crashes, hangs or helper processes lost since launch.');
    for (const e of ev.slice(-20)) lines.push(`  ${this._fmtAgo(Date.now() - e.at)} — ${e.kind}: ${e.detail}`);
    const ex = Array.isArray(d.extensionErrors) ? d.extensionErrors : [];
    for (const x of ex) lines.push(`  extension failed to load — ${x.folder}: ${x.error}`);
    if (d.update && d.update.result) lines.push(`Updater: ${d.update.result}${d.update.version ? ' ' + d.update.version : ''}${d.update.error ? ' — ' + d.update.error : ''} (${this._fmtAgo(Date.now() - d.update.lastCheckAt)})`);
    else lines.push('Updater: no check yet this session');
    if (d.remindersScheduled != null) lines.push(`Reminders scheduled in Windows: ${d.remindersScheduled}`);
    return lines;
  },

  async renderDiagnostics() {
    const host = document.getElementById('memory-health');
    if (!host) return null;
    if (!window.vex || typeof window.vex.diagnostics !== 'function') { host.innerHTML = '<div class="memory-proc-detail">Health is not available in this build.</div>'; return null; }
    let d;
    try { d = await window.vex.diagnostics(); }
    catch (err) { host.innerHTML = `<div class="memory-proc-detail">Could not read health: ${this._esc(err && err.message)}</div>`; return null; }
    const lines = this.healthLines(d);
    const bad = (d.events && d.events.length) || (d.extensionErrors && d.extensionErrors.length) || (d.update && d.update.error);
    host.innerHTML = `<div class="memory-health${bad ? ' bad' : ''}">${lines.map(l => `<div class="memory-health-line${/^  /.test(l) ? ' sub' : ''}">${this._esc(l.trim())}</div>`).join('')}</div>`;
    this._lastHealth = lines.join('\n');
    return d;
  },

  // ---- Trend since launch ------------------------------------------------------
  // Total memory sampled every 30 s from launch (sidebar.js init starts it),
  // with a note whenever Vex did something about it: the panel shows growth,
  // not a snapshot. Six hours kept; anything can post a note through the
  // 'vex:memory-event' document event ({ note }).
  _history: [],
  _trendTimer: null,
  TREND_MS: 30000,
  TREND_KEEP: 720,

  startTrend() {
    if (this._trendTimer) return;
    document.addEventListener('vex:memory-event', (e) => this.note(e.detail && e.detail.note));
    this.sample().catch(() => {});
    this._trendTimer = setInterval(() => this.sample().catch(err => console.error('[memory] trend sample failed:', err.message)), this.TREND_MS);
  },

  async sample() {
    if (!window.vex || typeof window.vex.appMetrics !== 'function') return null;
    const metrics = await window.vex.appMetrics();
    const mb = Math.round(metrics.reduce((s, p) => s + (p.memKB || 0), 0) / 1024);
    this._history.push({ t: Date.now(), mb });
    if (this._history.length > this.TREND_KEEP) this._history.splice(0, this._history.length - this.TREND_KEEP);
    return mb;
  },

  note(text) {
    if (!text) return;
    const last = this._history[this._history.length - 1];
    this._history.push({ t: Date.now(), mb: last ? last.mb : 0, note: String(text).slice(0, 120) });
  },

  // An inline chart, not an icon: a polyline of the samples, a dot per note.
  renderTrend() {
    const host = document.getElementById('memory-trend');
    if (!host) return;
    const pts = this._history.filter(h => h.mb > 0);
    if (pts.length < 2) { host.innerHTML = '<span class="memory-trend-label">Trend since launch appears after a minute.</span>'; return; }
    const W = 600, H = 48, PAD = 4;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    const max = Math.max(...pts.map(p => p.mb)), min = Math.min(...pts.map(p => p.mb));
    const x = (t) => PAD + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * PAD);
    const y = (mb) => H - PAD - ((mb - min) / Math.max(1, max - min)) * (H - 2 * PAD);
    const line = pts.map(p => `${x(p.t).toFixed(1)},${y(p.mb).toFixed(1)}`).join(' ');
    const dots = this._history.filter(h => h.note).map(h => `<circle cx="${x(h.t).toFixed(1)}" cy="${y(h.mb || min).toFixed(1)}" r="3"><title>${this._esc(h.note)}</title></circle>`).join('');
    const first = pts[0].mb, last = pts[pts.length - 1].mb, delta = last - first;
    const mins = Math.round((t1 - t0) / 60000);
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${line}" fill="none" stroke="currentColor" stroke-width="1.5"/>${dots}</svg>
      <span class="memory-trend-label">${this._esc(this._fmt(last))} now · ${delta >= 0 ? '+' : '−'}${this._esc(this._fmt(Math.abs(delta)))} over ${mins} min · low ${this._esc(this._fmt(min))}, high ${this._esc(this._fmt(max))}</span>`;
  },

  // ---- Free memory now -----------------------------------------------------------
  // Everything at once: idle tabs (pinned ones idle over 30 minutes too),
  // hidden panels, extensions in sessions with no page. Never a Discord
  // reload — that is the notice's job, and only by hand.
  async freeNow() {
    const done = [];
    try { await TabManager.sleepAllInactive(); done.push('idle tabs slept'); }
    catch (err) { done.push('tabs: ' + err.message); }
    const now = Date.now();
    let pinned = 0;
    for (const t of TabManager.tabs) {
      const busy = t.id === TabManager.activeTabId || t.sleeping || t._lazy || (t.audible && !t.muted) || (TabManager.isCapturing && TabManager.isCapturing(t));
      if (!t.pinned || busy || now - (t.lastViewedAt || 0) < 30 * 60000) continue;
      await TabManager.sleepTab(t.id, true);
      pinned++;
    }
    if (pinned) done.push(`${pinned} pinned tab${pinned === 1 ? '' : 's'} idle over 30 min`);
    if (typeof SidebarManager !== 'undefined' && SidebarManager.sleepHiddenPanels) {
      const slept = SidebarManager.sleepHiddenPanels();
      if (slept.length) done.push('panels slept: ' + slept.map(n => SidebarManager.panelLabel(n)).join(', '));
    }
    if (window.vex && typeof window.vex.extensionsReleaseIdle === 'function') {
      const r = await window.vex.extensionsReleaseIdle();
      if (r && r.released && r.released.length) done.push('extensions unloaded from ' + r.released.join(', '));
    }
    this.note('Free memory now — ' + (done.join('; ') || 'nothing to free'));
    window.showToast?.(done.length ? 'Freed: ' + done.join('; ') : 'Nothing to free right now');
    await this.refresh();
    return done;
  },

  summarize(rows) {
    const KINDS = [['panel', 'panels'], ['tab', 'tabs'], ['extension', 'extension hosts'], ['ui', 'interface'], ['main', 'main'], ['gpu', 'GPU'], ['utility', 'utilities'], ['other', 'other']];
    const chips = [`${rows.length} processes`, `resident ${this._fmt(Math.round(rows.reduce((s, r) => s + r.memKB, 0) / 1024))}`];
    const priv = rows.reduce((s, r) => s + (r.privKB || 0), 0);
    if (priv) chips.push(`private ${this._fmt(Math.round(priv / 1024))}`);
    for (const [kind, label] of KINDS) {
      const of = rows.filter(r => r.kind === kind);
      if (!of.length) continue;
      chips.push(`${of.length} ${label} · ${this._fmt(Math.round(of.reduce((s, r) => s + r.memKB, 0) / 1024))}`);
    }
    return chips;
  },

  report(rows) {
    const lines = ['Vex processes — ' + new Date().toLocaleString(), this.summarize(rows).join(' | '), ''];
    lines.push('  pid  resident    private   cpu  what');
    for (const r of rows) {
      lines.push(`${String(r.pid).padStart(5)}  ${String(Math.round(r.memKB / 1024) + ' MB').padStart(8)}  ${String(r.privKB ? Math.round(r.privKB / 1024) + ' MB' : '—').padStart(9)}  ${String(r.cpu.toFixed(0) + '%').padStart(4)}  ${r.what}${r.detail ? ' — ' + r.detail : ''}`);
    }
    return lines.join('\n');
  },

  async renderProcesses(ctx) {
    const host = document.getElementById('memory-procs');
    const summary = document.getElementById('memory-summary');
    if (!host) return;
    if (!window.vex || typeof window.vex.processes !== 'function') {
      host.innerHTML = '<div class="memory-proc-detail">The process list is not available in this build.</div>';
      return;
    }
    let got;
    try { got = await window.vex.processes(); }
    catch (err) { host.innerHTML = `<div class="memory-proc-detail">Could not read the processes: ${this._esc(err && err.message)}</div>`; return; }
    const procs = Array.isArray(got) ? got : (got && got.processes) || [];
    const fullCtx = { ...(ctx || {}), workers: (got && got.workers) || [] };
    const rows = procs.map(p => ({ ...p, ...this.describeProcess(p, fullCtx) }));
    rows.sort((a, b) => b.memKB - a.memKB);
    this._lastReport = this.report(rows);
    if (summary) summary.innerHTML = this.summarize(rows).map(c => `<span>${this._esc(c)}</span>`).join('');
    // "Private" is Electron's privateBytes: memory not shared with other processes.
    host.innerHTML = `<table class="memory-proc-table"><thead><tr><th>What</th><th>Resident</th><th>Private</th><th>CPU</th></tr></thead><tbody>${rows.map(r => {
      const mb = Math.round(r.memKB / 1024);
      const cls = (mb >= 700 ? 'hot' : mb >= 300 ? 'warm' : '') + (r.cpu >= 25 ? ' busy' : '');
      return `<tr class="${cls}"><td><div class="memory-proc-what">${this._esc(r.what)}</div>${r.detail ? `<div class="memory-proc-detail" title="${this._esc(r.detail)}">${this._esc(r.detail)}</div>` : ''}<div class="memory-proc-kind">${this._esc(r.type)}${r.sandboxed ? '' : ' · unsandboxed'} · pid ${r.pid}</div></td><td class="num mem">${mb} MB</td><td class="num">${r.privKB ? Math.round(r.privKB / 1024) + ' MB' : '—'}</td><td class="num cpu">${r.cpu.toFixed(0)}%</td></tr>`;
    }).join('')}</tbody></table>`;
  },

  // How many of the measured tabs each process backs (same-site tabs share a
  // renderer, so one process's memory is shown on each of them).
  shareCounts(byId) {
    const n = {};
    for (const e of Object.values(byId || {})) n[e.pid] = (n[e.pid] || 0) + 1;
    return n;
  },

  // What a tab's memory row says — actual numbers only. `real` is main's
  // measurement of the tab's process ({ memKB, pid }) or null; `shareCount` is
  // how many open tabs that process backs. A sleeping tab has no process, so it
  // really uses 0 MB; what it used just before it slept is shown beside that.
  describe(tab, real, shareCount) {
    if (tab.sleeping) {
      const was = tab.memBeforeSleep;
      const wasText = was ? ` (was ${was.mb} MB${was.shared ? ', shared' : ''})` : '';
      return { mb: 0, sleeping: true, label: `0 MB · asleep${wasText}` };
    }
    if (tab._lazy) return { mb: 0, sleeping: true, label: '0 MB · not loaded yet' };
    if (!real) return { mb: null, sleeping: false, label: 'starting…' };
    const mb = Math.round(real.memKB / 1024);
    return { mb, sleeping: false, label: shareCount > 1 ? `${mb} MB · shared by ${shareCount} tabs` : `${mb} MB` };
  },

  _esc(s) { return window.escapeHtml(s); }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { MemoryPanel };
