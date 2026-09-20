// === Running tasks — what is actually using the memory ====================
//
// Two questions, and they need different answers.
//
// "Discord is using 1.5 GB — what inside it is doing that?" is the one people
// actually ask, and a list of operating-system processes cannot answer it,
// because the whole app IS one process. So right-clicking a panel or a tab
// opens on that app and asks the page itself: how much JavaScript it holds,
// how far the page has grown, what is playing, what other sites it has
// embedded, what it has stored on your disk — and then the handful of things
// that really lower those numbers, each with the button that does it.
//
// "What is Vex running at all?" is the second, and that is the process list:
// every process, biggest first, named by the Memory panel's own
// describeProcess (one description of a process in this app, not two), with a
// button that ends it.
//
// Ending never destroys anything you did not close yourself:
//   a tab     is put to sleep — its renderer really does go, and the page
//             comes back exactly where you left it when you click it
//   a panel   is closed and slept, the same as the Memory panel's Sleep
//   an extension is switched off, which is the only way its background page
//             stops, so that one always leaves a hold you can undo
// Vex's own processes (main, GPU, the interface, Chromium's services) are
// listed but cannot be ended: Chromium starts them again immediately, and
// ending the main process is quitting.
//
// A hold is "and keep it off": for an hour, for eight, or until you let it
// back. It is kept by putting the thing back to sleep whenever it returns
// (js/jobs.js runs the check), not by blocking anything — so a hold can never
// leave you unable to open something. The Held list at the top says what is
// held and lets it back in one click.
const VexTasks = {
  HOLDS_KEY: 'vex.taskHolds',

  // How long "and keep it off" lasts. null = until you let it back.
  WHEN: [
    { key: 'hour', label: 'for an hour', ms: 60 * 60 * 1000 },
    { key: 'eight', label: 'for eight hours', ms: 8 * 60 * 60 * 1000 },
    { key: 'forever', label: 'until I let it back', ms: null },
  ],

  _el: null,
  _timer: null,
  _focus: null,     // { tab } or { panel } — the row to highlight when it opens

  _esc(s) {
    if (typeof window !== 'undefined' && typeof window.escapeHtml === 'function') return window.escapeHtml(String(s == null ? '' : s));
    return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  },

  _host(url) {
    try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
  },

  _fmt(mb) { return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB'; },

  // ---- Holds ---------------------------------------------------------------

  _read() {
    try { const v = JSON.parse(localStorage.getItem(this.HOLDS_KEY) || '{}'); return (v && typeof v === 'object') ? v : {}; }
    catch { return {}; }
  },

  _write(holds) {
    try { localStorage.setItem(this.HOLDS_KEY, JSON.stringify(holds)); }
    catch (err) { console.warn('[tasks] could not save the holds:', err && err.message); }
  },

  // Every live hold. Expired ones are dropped here — and an extension whose
  // hold has run out is switched back on, because it cannot come back itself.
  holds() {
    const holds = this._read();
    const now = Date.now();
    let changed = false;
    for (const [key, h] of Object.entries(holds)) {
      if (!h || h.until == null || h.until > now) continue;
      delete holds[key];
      changed = true;
      if (key.startsWith('ext:')) this._setExtension(key.slice(4), true, h.label);
    }
    if (changed) this._write(holds);
    return holds;
  },

  isHeld(key) { return !!this.holds()[key]; },

  hold(key, ms, label, kind) {
    if (!key) throw new Error('A hold needs something to hold');
    const holds = this.holds();
    holds[key] = { until: ms == null ? null : Date.now() + ms, label: String(label || key), kind: kind || '', at: Date.now() };
    this._write(holds);
    return holds[key];
  },

  release(key) {
    const holds = this.holds();
    const had = holds[key];
    if (!had) return null;
    delete holds[key];
    this._write(holds);
    if (key.startsWith('ext:')) this._setExtension(key.slice(4), true, had.label);
    return had;
  },

  // "held until 15:04" / "held until you let it back"
  holdText(hold) {
    if (!hold) return '';
    if (hold.until == null) return 'held until you let it back';
    return 'held until ' + new Date(hold.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },

  async _setExtension(folder, enabled, label) {
    if (!window.vex || typeof window.vex.extensionsSetEnabled !== 'function') return false;
    try {
      await window.vex.extensionsSetEnabled(folder, enabled);
      if (enabled) window.showToast?.((label || folder) + ' is switched back on', 'info');
      return true;
    } catch (err) {
      window.showToast?.('Could not ' + (enabled ? 'switch on ' : 'switch off ') + (label || folder) + ': ' + ((err && err.message) || 'failed'), 'error');
      return false;
    }
  },

  // ---- What is running -----------------------------------------------------

  // Which webContents id is which tab and which panel — the same join the
  // Memory panel does, so describeProcess can name them.
  _context() {
    const ctx = { tabs: new Map(), tabIds: new Map(), panels: new Map(), panelNames: new Map(), captures: [] };
    const wcOf = (wv) => { try { return wv && typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null; } catch { return null; } };
    if (typeof TabManager !== 'undefined' && typeof WebviewManager !== 'undefined') {
      for (const t of TabManager.tabs || []) {
        const id = wcOf(WebviewManager.webviews.get(t.id));
        if (id == null) continue;
        ctx.tabs.set(id, t.title || t.url);
        ctx.tabIds.set(id, t.id);
      }
    }
    if (typeof SidebarManager !== 'undefined' && SidebarManager.panelWebviews) {
      for (const [name, wv] of Object.entries(SidebarManager.panelWebviews)) {
        const id = wcOf(wv);
        if (id == null) continue;
        ctx.panels.set(id, SidebarManager.panelLabel(name));
        ctx.panelNames.set(id, name);
      }
    }
    return ctx;
  },

  // One process, ready to draw: what it is, what it costs, what ending it
  // would mean — or why it cannot be ended.
  describe(p, ctx, extensions) {
    const named = (typeof MemoryPanel !== 'undefined')
      ? MemoryPanel.describeProcess(p, ctx)
      : { kind: 'other', what: p.name || ('Process ' + p.pid), detail: '' };
    const contents = Array.isArray(p.contents) ? p.contents : [];
    const row = {
      pid: p.pid,
      kind: named.kind,
      what: named.what,
      detail: named.detail,
      memMB: Math.round((p.memKB || 0) / 1024),
      cpu: p.cpu || 0,
      tabs: [],
      panels: [],
      hosts: [],
      folder: null,
      key: null,
      endable: false,
      why: '',
    };
    for (const c of contents) {
      if (ctx.panelNames.has(c.id)) row.panels.push(ctx.panelNames.get(c.id));
      else if (ctx.tabIds.has(c.id)) row.tabs.push(ctx.tabIds.get(c.id));
      const host = this._host(c.url);
      if (host && !row.hosts.includes(host)) row.hosts.push(host);
    }
    if (row.kind === 'panel' && row.panels.length) {
      row.key = 'panel:' + row.panels[0];
      row.endable = true;
    } else if (row.kind === 'tab' && row.tabs.length) {
      row.key = row.hosts.length ? 'site:' + row.hosts[0] : null;
      const active = typeof TabManager !== 'undefined' ? TabManager.activeTabId : null;
      row.endable = !row.tabs.every(id => id === active);
      if (!row.endable) row.why = 'This is the page you are looking at — open another tab first';
    } else if (row.kind === 'extension') {
      const names = [...new Set(contents.map(c => c.extension).filter(Boolean))];
      const match = (extensions || []).find(e => names.includes(e.name));
      if (match) { row.folder = match.folder; row.key = 'ext:' + match.folder; row.endable = true; }
      else row.why = 'Vex cannot tell which extension this is — switch it off in Settings › Extensions';
    } else if (row.kind === 'main') {
      row.why = 'This is Vex itself — ending it is quitting';
    } else if (row.kind === 'gpu' || row.kind === 'utility') {
      row.why = 'Chromium runs this for the pages that need it and starts it again straight away';
    } else if (row.kind === 'ui') {
      row.why = 'The toolbar, tabs and sidebar you are using';
    } else {
      row.why = 'Nothing is running in it — it goes on its own';
    }
    return row;
  },

  // Every process, biggest first.
  async rows() {
    if (!window.vex || typeof window.vex.processes !== 'function') throw new Error('The process list is not available in this build');
    const got = await window.vex.processes();
    const procs = Array.isArray(got) ? got : (got && got.processes) || [];
    const ctx = this._context();
    ctx.workers = (got && got.workers) || [];
    let extensions = [];
    if (window.vex && typeof window.vex.extensionsList === 'function') {
      try { extensions = await window.vex.extensionsList() || []; } catch { extensions = []; }
    }
    return procs.map(p => this.describe(p, ctx, extensions)).sort((a, b) => b.memMB - a.memMB);
  },

  // ---- Ending --------------------------------------------------------------

  // End one row, optionally keeping it off. `ms` undefined means once only;
  // null means until it is let back. Returns what it did, in words.
  async end(row, ms) {
    if (!row || !row.endable) throw new Error(row && row.why ? row.why : 'That one cannot be ended');
    const keep = ms !== undefined;
    let did = '';
    if (row.kind === 'panel') {
      const name = row.panels[0];
      if (typeof SidebarManager === 'undefined') throw new Error('The sidebar is not available in this window');
      // A voice call or anything playing: ending it would cut that off, so it
      // is refused rather than done quietly.
      const busy = (SidebarManager.panelBusy && SidebarManager.panelBusy(name)) || '';
      if (busy) throw new Error(SidebarManager.panelLabel(name) + ' is in use — ' + busy + '. Ending it would cut that off.');
      if (name === SidebarManager.activePanel || name === SidebarManager.sidePanel) SidebarManager.hideActivePanel();
      SidebarManager.sleepPanel(name);
      did = SidebarManager.panelLabel(name) + ' closed';
    } else if (row.kind === 'tab') {
      const active = TabManager.activeTabId;
      const ids = row.tabs.filter(id => id !== active);
      for (const id of ids) await TabManager.sleepTab(id, true);
      did = ids.length === 1 ? 'Tab put to sleep' : ids.length + ' tabs put to sleep';
    } else if (row.kind === 'extension') {
      if (!await this._setExtension(row.folder, false, row.what)) throw new Error('Could not switch that extension off');
      did = row.what.replace(/ — background$/, '') + ' switched off';
      // An extension cannot come back by itself, so there is always something
      // to undo — a bare "End now" becomes a hold with no end date.
      if (!keep) { this.hold(row.key, null, row.what, row.kind); return did + ' — let it back from Running tasks'; }
    }
    if (keep && row.key) {
      const h = this.hold(row.key, ms, row.what, row.kind);
      return did + ', ' + this.holdText(h);
    }
    return did;
  },

  // Keep the holds kept: anything held that is running again goes back to
  // sleep. Nothing is closed and nothing is blocked — the worst a hold can do
  // is put a page to sleep, which loses nothing.
  enforce() {
    const holds = this.holds();
    const keys = Object.keys(holds);
    if (!keys.length) return [];
    const acted = [];
    for (const key of keys) {
      if (key.startsWith('panel:')) {
        const name = key.slice(6);
        if (typeof SidebarManager === 'undefined' || !SidebarManager.panelWebviews || !SidebarManager.panelWebviews[name]) continue;
        // Open in front of them: they went back to it on purpose, so the hold
        // waits rather than snatching it away.
        if (name === SidebarManager.activePanel || name === SidebarManager.sidePanel) continue;
        // In a voice call, or playing something: a hold is about memory, and
        // no memory saving is worth dropping a call. It waits.
        if (SidebarManager.panelBusy && SidebarManager.panelBusy(name)) continue;
        try { SidebarManager.sleepPanel(name); acted.push(holds[key].label); } catch { /* already gone */ }
      } else if (key.startsWith('site:')) {
        const host = key.slice(5);
        if (typeof TabManager === 'undefined') continue;
        for (const t of TabManager.tabs || []) {
          if (t.id === TabManager.activeTabId || t.sleeping || t._lazy) continue;
          // Playing sound, or holding the microphone or camera: leave it.
          if (t.audible && !t.muted) continue;
          if (TabManager.isCapturing && TabManager.isCapturing(t)) continue;
          if (this._host(t.url) !== host) continue;
          TabManager.sleepTab(t.id, true);
          acted.push(host);
        }
      }
    }
    if (acted.length) {
      const what = [...new Set(acted)].join(', ');
      window.showToast?.(what + ' — still held, so Vex put it back to sleep. Open Running tasks to let it back.', 'info', 6000);
      if (this._el) this.refresh();
    }
    return acted;
  },

  // ---- Inside one app ------------------------------------------------------
  //
  // "Discord is using 1.5 GB" is where the question starts, not where it ends.
  // The next question is what INSIDE it is using that, and a list of operating
  // system processes cannot answer it — one process IS Discord.
  //
  // So this asks the page itself: how much JavaScript it is holding, how big
  // the page has grown, what is playing, what other sites it has embedded,
  // what it has stored on your disk. Then it says which of those you can do
  // something about, with the button that does it.

  // Run a measurement inside a guest page. Everything is guarded in there
  // because one missing API must not cost the whole reading.
  INSIDE_SCRIPT: `(async () => {
    const t = (fn, d) => { try { return fn(); } catch { return d; } };
    const m = t(() => performance.memory, null);
    let store = null;
    try { store = await navigator.storage.estimate(); } catch { store = null; }
    let workers = 0;
    try { workers = (await navigator.serviceWorker.getRegistrations()).length; } catch { workers = 0; }
    const media = t(() => [...document.querySelectorAll('video, audio')], []);
    return {
      url: location.href.slice(0, 200),
      heapMB: m ? Math.round(m.usedJSHeapSize / 1048576) : null,
      heapLimitMB: m ? Math.round(m.jsHeapSizeLimit / 1048576) : null,
      nodes: t(() => document.getElementsByTagName('*').length, 0),
      images: t(() => document.images.length, 0),
      media: media.length,
      playing: media.filter(el => !el.paused && !el.ended).length,
      frames: t(() => [...document.querySelectorAll('iframe')].map(f => { try { return new URL(f.src || 'about:blank').hostname || 'in the page itself'; } catch { return 'in the page itself'; } }), []),
      workers,
      storeMB: store && store.usage != null ? Math.round(store.usage / 1048576) : null,
      storeDetail: (store && store.usageDetails) ? Object.entries(store.usageDetails).map(([k, v]) => [k, Math.round(v / 1048576)]).filter(p => p[1] >= 1) : [],
      vencord: t(() => (window.Vencord && window.Vencord.Plugins && window.Vencord.Plugins.plugins)
        ? Object.values(window.Vencord.Plugins.plugins).filter(p => p && p.started).length : null, null),
    };
  })()`,

  // The <webview> behind a panel name or a tab id.
  _guestFor(target) {
    if (!target) return null;
    if (target.panel) return (typeof SidebarManager !== 'undefined' && SidebarManager.panelWebviews) ? SidebarManager.panelWebviews[target.panel] || null : null;
    if (target.tab != null) return (typeof WebviewManager !== 'undefined') ? WebviewManager.webviews.get(target.tab) || null : null;
    return null;
  },

  _nameFor(target) {
    if (!target) return '';
    if (target.panel) return (typeof SidebarManager !== 'undefined') ? SidebarManager.panelLabel(target.panel) : target.panel;
    const tab = (typeof TabManager !== 'undefined') ? (TabManager.tabs || []).find(t => t.id === target.tab) : null;
    return tab ? (tab.title || tab.url || 'This tab') : 'This tab';
  },

  // What is inside it, measured. Throws with something worth reading.
  async inside(target) {
    const wv = this._guestFor(target);
    if (!wv || typeof wv.executeJavaScript !== 'function') throw new Error(this._nameFor(target) + ' is not loaded, so there is nothing running in it to measure');
    const got = await wv.executeJavaScript(this.INSIDE_SCRIPT);
    // The process it lives in, so the total agrees with Running tasks.
    let processMB = null;
    try {
      const id = typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null;
      if (id != null && window.vex && typeof window.vex.tabMemory === 'function') {
        const mem = await window.vex.tabMemory([id]);
        const one = mem && mem.byId && mem.byId[id];
        if (one) processMB = Math.round(one.memKB / 1024);
      }
    } catch { /* the breakdown is still worth showing without the total */ }
    return Object.assign({ processMB, name: this._nameFor(target) }, got);
  },

  // What a reading means, in rows: a figure, and what it is made of.
  insideRows(d) {
    const rows = [];
    if (d.heapMB != null) {
      rows.push({ what: 'JavaScript it is holding', n: d.heapMB + ' MB',
        detail: d.heapLimitMB ? 'The app’s own code and data. It may use up to ' + (d.heapLimitMB >= 1024 ? (d.heapLimitMB / 1024).toFixed(1) + ' GB' : d.heapLimitMB + ' MB') + ' before Chromium forces it to collect.' : 'The app’s own code and data.' });
    }
    rows.push({ what: 'How big the page has grown', n: d.nodes.toLocaleString() + ' elements',
      detail: d.nodes > 30000 ? 'Very large — a long-running chat that has never been reloaded keeps every message it has drawn.' : 'Each one costs memory, and an app that is never reloaded only adds them.' });
    if (d.images || d.media) {
      rows.push({ what: 'Pictures, video and sound', n: d.images.toLocaleString() + ' images' + (d.media ? ', ' + d.media + ' player' + (d.media === 1 ? '' : 's') : ''),
        detail: d.playing ? d.playing + ' playing right now — video and animated pictures are decoded frame by frame and are the most expensive thing on any page.' : 'Animated pictures (emoji, avatars, GIFs) are decoded frame by frame even when you are not looking at them.' });
    }
    if (d.frames && d.frames.length) {
      const by = {};
      for (const h of d.frames) by[h] = (by[h] || 0) + 1;
      rows.push({ what: 'Other sites embedded in it', n: d.frames.length + ' frame' + (d.frames.length === 1 ? '' : 's'),
        detail: Object.entries(by).map(([h, n]) => n > 1 ? h + ' ×' + n : h).join(', ') + ' — each one is its own page, with its own memory.' });
    }
    if (d.workers) rows.push({ what: 'Background workers', n: String(d.workers), detail: 'Service workers keep running after you close the app’s tab, to deliver notifications.' });
    if (d.storeMB != null) {
      rows.push({ what: 'Kept on your disk', n: d.storeMB >= 1024 ? (d.storeMB / 1024).toFixed(1) + ' GB' : d.storeMB + ' MB',
        detail: (d.storeDetail.length ? d.storeDetail.map(([k, v]) => k.replace(/([A-Z])/g, ' $1').toLowerCase() + ' ' + v + ' MB').join(', ') + ' — ' : '') + 'not memory, but it is read into memory as you use it, and it can all be fetched again.' });
    }
    if (/discord\.com/.test(d.url || '') && typeof DiscordMemory !== 'undefined') {
      const on = DiscordMemory.lite();
      rows.push({
        what: 'Animated emoji and avatars',
        n: on ? 'already still' : 'animating',
        detail: on
          ? 'Lighter Discord is on, so every animated emoji, avatar and sticker is fetched as a still picture. Each animated one is a video that would otherwise be decoded frame by frame, all day, whether or not you are looking at it. GIFs people post still play.'
          : 'Every animated emoji, avatar and sticker on screen is a video being decoded frame by frame, all day. Vex can fetch them as still pictures instead — the button below.',
      });
    }
    if (d.vencord != null) rows.push({ what: 'Vencord plugins running', n: String(d.vencord), detail: 'Each one patches Discord as it runs. Ones you do not use are worth switching off.' });
    return rows;
  },

  // What actually lowers it, with the button that does it. Only things that
  // are true for this app right now.
  insideActions(target, d) {
    const acts = [];
    const name = d.name;
    acts.push({
      label: 'Reload it',
      why: 'A chat app that has been open for days holds everything it has drawn since. Reloading gives that back straight away — usually the biggest single win.',
      run: async () => { const wv = this._guestFor(target); if (!wv) throw new Error('It is not loaded'); wv.reload(); return name + ' is reloading'; },
    });
    acts.push({
      label: 'Clear its cache and reload',
      why: d.storeMB != null ? 'Throws away the ' + (d.storeMB >= 1024 ? (d.storeMB / 1024).toFixed(1) + ' GB' : d.storeMB + ' MB') + ' of pictures and files it has kept. It fetches what it needs again — you stay signed in.' : 'Throws away the pictures and files it has kept; it fetches them again, and you stay signed in.',
      run: async () => {
        const wv = this._guestFor(target);
        const id = wv && typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null;
        if (id == null || !window.vex || typeof window.vex.hardReloadWebview !== 'function') throw new Error('Vex cannot reach that page right now');
        const r = await window.vex.hardReloadWebview(id);
        if (!r || !r.ok) throw new Error((r && r.error) || 'Could not clear it');
        return name + '’s cache is cleared and it is reloading';
      },
    });
    if (target.panel && typeof SidebarManager !== 'undefined') {
      let kept = false;
      try { kept = (SidebarManager.panelSleepPrefs().exempt || []).includes(target.panel); } catch { kept = false; }
      const busy = (SidebarManager.panelBusy && SidebarManager.panelBusy(target.panel)) || '';
      acts.push(kept ? {
        label: 'Let it sleep when you are not looking',
        why: 'It is set to stay awake, so it keeps every megabyte of this while hidden. Letting it sleep hands all of it back until you open it again. It still never sleeps during a voice call or while it is making a sound — only when it has been quiet and hidden for a while — and it cannot notify you while asleep.',
        run: async () => { SidebarManager.setKeepAwake(target.panel, false); return name + ' will sleep once it has been hidden and quiet for a while'; },
      } : {
        label: 'Sleep it now',
        why: busy
          ? 'Not now: ' + busy + '. Sleeping it would end that, so this waits until it is quiet.'
          : 'Closes it and hands back everything above. It comes back where you left it.',
        run: async () => {
          const stop = (SidebarManager.panelBusy && SidebarManager.panelBusy(target.panel)) || '';
          if (stop) throw new Error(name + ' is in use — ' + stop + '. Sleeping it now would cut that off.');
          if (target.panel === SidebarManager.activePanel || target.panel === SidebarManager.sidePanel) SidebarManager.hideActivePanel();
          SidebarManager.sleepPanel(target.panel);
          return name + ' is asleep';
        },
      });
    }
    if (target.tab != null && typeof TabManager !== 'undefined' && target.tab !== TabManager.activeTabId) {
      acts.push({
        label: 'Put it to sleep',
        why: 'Hands back everything above until you click the tab again, which brings it back where you left it.',
        run: async () => { await TabManager.sleepTab(target.tab, true); return name + ' is asleep'; },
      });
    }
    if (/discord\.com/.test(d.url || '') && typeof DiscordMemory !== 'undefined' && !DiscordMemory.lite()) {
      acts.push({
        label: 'Make emoji and avatars still',
        why: 'Fetches every animated emoji, avatar, sticker and server icon as a still picture instead of a moving one. They still appear — they just stop being videos your machine decodes all day. GIFs people post are untouched.',
        run: async () => {
          await DiscordMemory.setLite(true);
          const wv = this._guestFor(target);
          try { if (wv) wv.reload(); } catch { /* it will apply on the next load */ }
          return 'Animated emoji and avatars are still pictures now — ' + name + ' is reloading';
        },
      });
    }
    return acts;
  },

  // ---- The window ----------------------------------------------------------

  // opts.tab / opts.panel opens on what is inside that app — the question
  // people actually have. With nothing, it lists every process Vex runs.
  open(opts) {
    this._focus = opts && (opts.panel || opts.tab != null) ? opts : null;
    if (this._el) { this.refresh(); return this._el; }
    const el = document.createElement('div');
    el.className = 'vextasks-backdrop';
    el.innerHTML = `
      <div class="vextasks" role="dialog" aria-modal="true" aria-label="Running tasks">
        <div class="vextasks-head">
          <div class="vextasks-headings">
            <h2 id="vextasks-title">Running tasks</h2>
            <div class="vextasks-sub" id="vextasks-sub">Measuring…</div>
          </div>
          <div class="vextasks-total" id="vextasks-total">…</div>
          <button class="vextasks-close" aria-label="Close">&times;</button>
        </div>
        <div class="vextasks-held" id="vextasks-held" hidden></div>
        <div class="vextasks-body" id="vextasks-body"><div class="vextasks-empty">Measuring…</div></div>
      </div>`;
    document.body.appendChild(el);
    this._el = el;
    el.querySelector('.vextasks-close').addEventListener('click', () => this.close());
    el.addEventListener('mousedown', (e) => { if (e.target === el) this.close(); });
    this._onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } };
    window.addEventListener('keydown', this._onKey, true);
    this.refresh();
    // Live, because the numbers move and because an end has to be seen to have
    // worked. Three seconds matches the Memory panel's own tab refresh.
    this._timer = setInterval(() => this.refresh(), 3000);
    return el;
  },

  close() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._onKey) { window.removeEventListener('keydown', this._onKey, true); this._onKey = null; }
    this._menu?.remove();
    this._menu = null;
    if (this._el) { this._el.remove(); this._el = null; }
    this._focus = null;
  },

  async refresh() {
    const el = this._el;
    if (!el) return;
    if (this._focus) return this._refreshInside();
    const body = el.querySelector('#vextasks-body');
    el.querySelector('#vextasks-title').textContent = 'Running tasks';
    el.querySelector('#vextasks-sub').textContent = 'Every process Vex is running, biggest first. Ending one gives its memory back — a page you end is put to sleep and comes back where you left it.';
    let rows;
    try { rows = await this.rows(); }
    catch (err) { body.innerHTML = `<div class="vextasks-empty">${this._esc((err && err.message) || 'Could not read the processes')}</div>`; return; }
    if (!this._el) return;                                   // closed while measuring
    const total = rows.reduce((sum, r) => sum + r.memMB, 0);
    el.querySelector('#vextasks-total').textContent = this._fmt(total);
    this._renderHeld();
    body.innerHTML = `
      <table class="vextasks-table">
        <thead><tr><th>What</th><th class="num">Memory</th><th class="num">CPU</th><th></th></tr></thead>
        <tbody>${rows.map((r, i) => this._row(r, i)).join('')}</tbody>
      </table>`;
    this._rows = rows;
    body.querySelectorAll('[data-end]').forEach(b => b.addEventListener('click', (e) => this._endMenu(e.currentTarget, rows[Number(b.dataset.end)])));
    const focused = body.querySelector('.vextasks-row.on');
    if (focused) focused.scrollIntoView({ block: 'center' });
  },

  // What is inside the app you asked about, and what to do about it.
  async _refreshInside() {
    const el = this._el;
    const target = this._focus;
    if (!el || !target) return;
    const body = el.querySelector('#vextasks-body');
    const name = this._nameFor(target);
    el.querySelector('#vextasks-title').textContent = name;
    el.querySelector('#vextasks-sub').textContent = 'What inside it is using the memory, and what actually lowers it.';
    let d;
    try { d = await this.inside(target); }
    catch (err) {
      if (!this._el) return;
      body.innerHTML = `<div class="vextasks-empty">${this._esc((err && err.message) || 'Could not measure it')}
        <div style="margin-top:12px"><button class="vextasks-end" data-all>Show every process Vex runs</button></div></div>`;
      body.querySelector('[data-all]')?.addEventListener('click', () => { this._focus = null; this.refresh(); });
      return;
    }
    if (!this._el) return;
    el.querySelector('#vextasks-total').textContent = d.processMB != null ? this._fmt(d.processMB) : (d.heapMB != null ? this._fmt(d.heapMB) + '+' : '—');
    this._renderHeld();
    const rows = this.insideRows(d);
    const acts = this.insideActions(target, d);
    this._acts = acts;
    body.innerHTML = `
      <table class="vextasks-table vextasks-inside">
        <tbody>${rows.map(r => `
          <tr class="vextasks-row">
            <td><div class="vextasks-what">${this._esc(r.what)}</div><div class="vextasks-detail vextasks-wrap">${this._esc(r.detail)}</div></td>
            <td class="num">${this._esc(r.n)}</td>
          </tr>`).join('')}</tbody>
      </table>
      <div class="vextasks-advice">
        <div class="vextasks-advice-head">What actually lowers it</div>
        ${acts.map((a, i) => `
          <div class="vextasks-act">
            <button class="vextasks-end" data-act="${i}">${this._esc(a.label)}</button>
            <span>${this._esc(a.why)}</span>
          </div>`).join('')}
      </div>
      <div class="vextasks-foot">
        ${d.processMB != null ? `It sits in one process of ${this._esc(this._fmt(d.processMB))} — that figure is what the machine sees, and everything above is what is inside it. ` : ''}
        <button class="vextasks-link" data-all>Show every process Vex runs</button>
      </div>`;
    body.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
      const act = this._acts[Number(b.dataset.act)];
      b.disabled = true;
      try { window.showToast?.(await act.run(), 'success'); }
      catch (err) { window.showToast?.((err && err.message) || 'That did not work', 'error'); }
      b.disabled = false;
      setTimeout(() => this.refresh(), 1200);
    }));
    body.querySelector('[data-all]')?.addEventListener('click', () => { this._focus = null; this.refresh(); });
  },

  // Which row is the thing the user right-clicked running in?
  _isFocus(row) {
    const f = this._focus;
    if (!f) return false;
    if (f.tab != null) return row.tabs.includes(f.tab);
    if (f.panel) return row.panels.includes(f.panel);
    return false;
  },

  _row(r, i) {
    const held = r.key ? this.holds()[r.key] : null;
    const size = r.memMB >= 700 ? ' hot' : r.memMB >= 300 ? ' warm' : '';
    return `
      <tr class="vextasks-row${this._isFocus(r) ? ' on' : ''}${r.cpu >= 25 ? ' busy' : ''}">
        <td>
          <div class="vextasks-what">${this._esc(r.what)}${held ? ` <span class="vextasks-heldtag">${this._esc(this.holdText(held))}</span>` : ''}</div>
          ${r.detail ? `<div class="vextasks-detail" title="${this._esc(r.detail)}">${this._esc(r.detail)}</div>` : ''}
          <div class="vextasks-kind">pid ${r.pid}${r.why ? ' · ' + this._esc(r.why) : ''}</div>
        </td>
        <td class="num${size}">${this._fmt(r.memMB)}</td>
        <td class="num">${r.cpu.toFixed(0)}%</td>
        <td class="num">${r.endable ? `<button class="vextasks-end" data-end="${i}">End…</button>` : ''}</td>
      </tr>`;
  },

  _renderHeld() {
    const host = this._el && this._el.querySelector('#vextasks-held');
    if (!host) return;
    const holds = this.holds();
    const keys = Object.keys(holds);
    host.hidden = !keys.length;
    if (!keys.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<span class="vextasks-held-title">Held off:</span>' + keys.map(k => `
      <span class="vextasks-held-one">${this._esc(holds[k].label)} · ${this._esc(this.holdText(holds[k]))}
        <button data-release="${this._esc(k)}">Let it back</button></span>`).join('');
    host.querySelectorAll('[data-release]').forEach(b => b.addEventListener('click', () => {
      const had = this.release(b.dataset.release);
      window.showToast?.((had ? had.label : 'It') + ' is no longer held', 'info');
      this.refresh();
    }));
  },

  // End now, or end and keep it off. A menu rather than four buttons because
  // most of the time the first one is all anybody wants.
  _endMenu(btn, row) {
    this._menu?.remove();
    const menu = document.createElement('div');
    menu.className = 'vextasks-menu';
    // Only something Vex can recognise again later can be kept off: a panel,
    // an extension, a site. The start page and anything without an address
    // can be ended, and that is all.
    const items = [
      { label: 'End now', ms: undefined },
      ...(row.key ? this.WHEN.map(w => ({ label: 'End, and keep it off ' + w.label, ms: w.ms })) : []),
    ];
    if (!row.key) items.push({ note: 'There is no address to hold this one by, so it can only be ended.' });
    menu.innerHTML = items.map((it, i) => it.note
      ? `<div class="vextasks-menu-note">${this._esc(it.note)}</div>`
      : `<button data-i="${i}">${this._esc(it.label)}</button>`).join('');
    document.body.appendChild(menu);
    this._menu = menu;
    const r = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + 'px';
    const away = (e) => { if (!menu.contains(e.target)) { menu.remove(); this._menu = null; document.removeEventListener('mousedown', away, true); } };
    document.addEventListener('mousedown', away, true);
    menu.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', async () => {
      const item = items[Number(b.dataset.i)];
      menu.remove();
      this._menu = null;
      document.removeEventListener('mousedown', away, true);
      try {
        const said = await this.end(row, item.ms);
        window.showToast?.(said, 'success');
      } catch (err) { window.showToast?.((err && err.message) || 'Could not end that one', 'error'); }
      this.refresh();
    }));
  },

  // The hold check runs whether or not the window is open — a hold set an hour
  // ago has to keep being kept.
  start() {
    if (typeof VexJobs === 'undefined') return;
    VexJobs.every('Held tasks', 20000, () => { try { this.enforce(); } catch (err) { console.warn('[tasks] hold check failed:', err && err.message); } }, { when: 'ui' });
  },
};

if (typeof window !== 'undefined') window.VexTasks = VexTasks;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTasks };
