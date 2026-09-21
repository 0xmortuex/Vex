// === Why is Vex slow right now? ============================================
//
// The answer was already in Vex, in four places nobody thinks to visit at the
// moment it matters: the process list knows which renderer is burning the
// processor, the tab list knows which page that is, the routing screen knows
// whether every request is going the long way round through Tor, and the
// graphics probe knows a game has the card. Each on its own says a number.
// Together they say a sentence.
//
// This is that sentence, and the button that fixes it. Nothing here measures
// anything new — it reads what Vex already knows and puts it in the order
// that matters, heaviest first.
//
// reasons() is deliberately a plain function over a plain object: the whole
// point is the judgement, and judgement is what is worth testing.
const WhySlow = {
  // How much of one processor core counts as "this is the problem". Chromium
  // reports cpu as a percentage of one core, so 25 is a quarter of a core
  // held continuously, which on a background tab is never innocent.
  BUSY_CPU: 25,
  HEAVY_MB: 700,
  TOTAL_MB: 3000,

  fmt(mb) { return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB'; },

  // Everything Vex already knows, gathered in one pass.
  async gather() {
    const out = { rows: [], totalMB: 0, route: null, gpu: null, game: false, sleep: null, error: null };
    // VexTasks.rows() already turns the process list into described rows —
    // and already knows that app:processes answers with { processes, workers }
    // rather than a bare array. Asking it, rather than unpacking that again
    // here, is the difference between one place knowing the shape and two.
    try {
      if (typeof VexTasks === 'undefined') throw new Error('the process list is not available');
      out.rows = await VexTasks.rows();
      out.totalMB = out.rows.reduce((n, r) => n + (r.memMB || 0), 0);
    } catch (err) { out.error = err.message; }
    try { out.route = await window.vex.routingGetAll(); } catch { /* the rest still answers */ }
    try { out.gpu = await window.vex.gpu(); } catch { /* no card reading; say nothing about it */ }
    try { out.game = typeof GameMode !== 'undefined' && GameMode.on(); } catch { /* not a reason then */ }
    try {
      if (typeof SidebarManager !== 'undefined') {
        const p = SidebarManager.panelSleepPrefs();
        out.sleep = { enabled: p.enabled, exempt: p.exempt.map(n => SidebarManager.panelLabel(n)) };
      }
    } catch { /* not a reason then */ }
    return out;
  },

  // The findings, heaviest first. Each is a sentence and, where there is one,
  // something to press. `fix` is a name the screen turns into a button, not a
  // function, so this stays testable and the screen stays the only thing that
  // knows how to do anything.
  reasons(d) {
    const found = [];
    const rows = (d.rows || []).slice();

    // The processor first: a tab holding a core is felt immediately, where a
    // gigabyte of idle memory is not.
    const busy = rows.filter(r => (r.cpu || 0) >= this.BUSY_CPU).sort((a, b) => b.cpu - a.cpu);
    for (const r of busy.slice(0, 3)) {
      found.push({
        id: 'cpu:' + r.pid,
        weight: 1000 + r.cpu,
        title: r.what + ' is using ' + Math.round(r.cpu) + '% of a processor core',
        detail: r.tabs.length || r.panels.length
          ? 'Something on that page is still running — a video, an animation, or a script that never finished.'
          : 'This is inside Vex rather than on a page.',
        fix: r.tabs.length ? 'go-tab' : (r.panels.length ? 'go-panel' : null),
        tab: r.tabs[0] || null,
        panel: r.panels[0] || null,
      });
    }

    // Then weight.
    const heavy = rows.filter(r => (r.memMB || 0) >= this.HEAVY_MB).sort((a, b) => b.memMB - a.memMB);
    for (const r of heavy.slice(0, 3)) {
      found.push({
        id: 'mem:' + r.pid,
        weight: 500 + r.memMB / 100,
        title: r.what + ' is holding ' + this.fmt(r.memMB),
        detail: r.panels.length
          ? 'A panel hands all of it back when it sleeps, and comes back where you left it.'
          : 'Reloading that page gives it back; so does letting the tab sleep.',
        fix: r.panels.length ? 'panel-sleep' : (r.tabs.length ? 'go-tab' : null),
        tab: r.tabs[0] || null,
        panel: r.panels[0] || null,
      });
    }

    if (d.totalMB >= this.TOTAL_MB) {
      found.push({
        id: 'total',
        weight: 400,
        title: 'Vex is holding ' + this.fmt(d.totalMB) + ' altogether',
        detail: 'Memory Saver shortens how long an idle tab or panel waits before it sleeps.',
        fix: 'memory',
      });
    }

    // A route you forgot about is the commonest slow browsing with no
    // explanation, and it is not a fault — it is the cost of the thing.
    if (d.route && d.route.mode && d.route.mode !== 'direct') {
      found.push({
        id: 'route',
        weight: 300,
        title: d.route.mode === 'tor' ? 'Everything is going through Tor' : 'Everything is going through your proxy',
        detail: d.route.mode === 'tor'
          ? 'Tor sends every request through three relays, so pages take seconds rather than milliseconds. That is the cost of it, not a fault.'
          : 'Every request goes through ' + (d.route.custom || 'your proxy') + ' first. If that is far away or busy, so is every page.',
        fix: 'routing',
      });
    }

    // The card: a game has it, or something else has filled it.
    if (d.game) {
      found.push({
        id: 'game',
        weight: 250,
        title: 'A game has the screen',
        detail: 'Windows slows a window a fullscreen game covers, and Vex quietens its own animations while that lasts. This one is working as intended.',
        fix: null,
      });
    }
    if (d.gpu && d.gpu.totalMB && d.gpu.usedPercent >= 85) {
      found.push({
        id: 'gpu',
        weight: 240,
        title: d.gpu.name + ' is ' + d.gpu.usedPercent + '% full',
        detail: 'A local AI model needs room on the card. With none, it runs on the processor instead and an answer that took thirty seconds can take minutes.',
        fix: null,
      });
    }

    // Settings that are doing exactly what they were asked to.
    if (d.sleep && d.sleep.enabled === false) {
      found.push({
        id: 'nosleep',
        weight: 200,
        title: 'Nothing is allowed to sleep',
        detail: 'Panels never hand their memory back while this is off.',
        fix: 'memory',
      });
    } else if (d.sleep && d.sleep.exempt.length >= 3) {
      found.push({
        id: 'kept',
        weight: 150,
        title: d.sleep.exempt.length + ' panels are kept awake',
        detail: d.sleep.exempt.join(', ') + ' never sleep, so they hold their memory all day. Each can be set to wake only for a call instead.',
        fix: 'memory',
      });
    }

    found.sort((a, b) => b.weight - a.weight);
    return found;
  },

  // Nothing wrong is a finding of its own: a screen that answers "why is Vex
  // slow" with an empty list has not answered anything.
  nothing(d) {
    // A process list that could not be read is not a clean bill of health,
    // and saying "nothing is wrong" over a failed measurement is the one
    // answer this screen must never give.
    if (d.error) {
      return {
        title: 'Vex could not measure itself',
        detail: 'The process list could not be read: ' + d.error + '. Everything else it could check — the route and the graphics card — looked ordinary.',
      };
    }
    return {
      title: 'Nothing here is slowing Vex down',
      detail: 'Vex is holding ' + this.fmt(d.totalMB) + ', nothing is holding a processor core, and no route is on.',
    };
  },

  // === Saying it without being asked =======================================
  //
  // A diagnosis screen only helps the people who think to open it — and if
  // you knew to look, you half knew the answer already. So Vex watches, and
  // when one thing has clearly been the problem for a while, it says so once,
  // with the same button that fixes it.
  //
  // The rules that stop this becoming a nag, which is the only way a thing
  // like this survives contact with a real day:
  //
  //  - Sustained, not momentary. A tab must hold a core across two checks a
  //    minute apart. Opening a heavy page is not a fault.
  //  - Never about what you are looking at. The tab in front is allowed to
  //    work hard; that is what you asked it to do.
  //  - Once per cause per hour, and "not now" silences everything for four.
  //  - Only the processor and only a really heavy panel. A route being on, a
  //    game running, three panels kept awake — those are all things you
  //    chose, and a browser that comments on your choices is a browser people
  //    switch off.
  WATCH_MS: 60000,
  QUIET_MS: 4 * 3600000,
  SAID_AGAIN_MS: 3600000,
  WATCH_MB: 1800,

  _said: {},
  _quietUntil: 0,
  _strikes: {},

  // Which single finding, if any, is worth interrupting for. Pure, so the
  // judgement can be tested without waiting a minute for it.
  worthSaying(found, now = Date.now()) {
    if (now < this._quietUntil) return null;
    for (const f of found) {
      if (!/^cpu:|^mem:/.test(f.id)) continue;
      if (f.id.startsWith('mem:') && !/([\d.]+) GB/.test(f.title)) continue;
      if ((this._said[f.id] || 0) > now - this.SAID_AGAIN_MS) continue;
      // Two checks in a row before it counts: a page that is busy for five
      // seconds while it loads is not a problem, it is a page loading.
      if (f.id.startsWith('cpu:') && (this._strikes[f.id] || 0) < 2) continue;
      return f;
    }
    return null;
  },

  // One pass of the watch. Returns what it said, or null.
  async check() {
    let d;
    try { d = await this.gather(); }
    catch { return null; }                       // a check that cannot run says nothing
    if (d.error) return null;
    const found = this.reasons(d).filter(f => !this._isActive(f));
    // Strikes are counted before the decision, so the second sighting of the
    // same busy process is the one that speaks.
    const seen = new Set(found.filter(f => f.id.startsWith('cpu:')).map(f => f.id));
    for (const id of Object.keys(this._strikes)) if (!seen.has(id)) delete this._strikes[id];
    for (const id of seen) this._strikes[id] = (this._strikes[id] || 0) + 1;
    const say = this.worthSaying(found);
    if (!say) return null;
    this._said[say.id] = Date.now();
    this._notice(say);
    return say;
  },

  // The tab in front is allowed to work hard.
  _isActive(f) {
    try { return !!(f.tab && typeof TabManager !== 'undefined' && f.tab === TabManager.activeTabId); }
    catch { return false; }
  },

  _notice(f) {
    document.getElementById('vex-slow-notice')?.remove();
    const esc = (v) => (window.escapeHtml ? window.escapeHtml(String(v)) : String(v));
    const bar = document.createElement('div');
    bar.id = 'vex-slow-notice';
    bar.className = 'vexslow-notice';
    bar.innerHTML = '<span>' + esc(f.title) + '</span>';
    const act = (label, title, run) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', run);
      bar.appendChild(b);
      return b;
    };
    const fix = this._action(f, () => bar.remove());
    if (fix) bar.appendChild(fix);
    act('Why', 'The whole picture', () => { bar.remove(); this.open(); });
    act('Not now', 'Nothing more for four hours', () => {
      bar.remove();
      this._quietUntil = Date.now() + this.QUIET_MS;
      window.showToast?.('Vex will not mention this again for four hours');
    });
    document.body.appendChild(bar);
    // It goes by itself: a bar that waits for you to dismiss it is in the way
    // of the thing you were doing when it appeared.
    setTimeout(() => bar.remove(), 20000);
    return bar;
  },

  start() {
    if (this._timer) clearInterval(this._timer);
    if (localStorage.getItem('vex.slowWatch') === '0') return false;
    this._timer = setInterval(() => {
      this.check().catch(err => console.warn('[WhySlow] the watch failed:', err.message));
    }, this.WATCH_MS);
    return true;
  },

  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },

  // ---- the screen ---------------------------------------------------------
  async open() {
    document.getElementById('vex-whyslow')?.remove();
    const esc = (v) => (window.escapeHtml ? window.escapeHtml(String(v)) : String(v));
    const m = document.createElement('div');
    m.id = 'vex-whyslow';
    m.className = 'vexsr-ov';
    m.innerHTML = '<div class="vexsr-card"><div class="vexsr-head">'
      + '<span class="vexsr-title">Why is Vex slow right now?</span>'
      + '<button class="vexsr-x" id="ws-close" aria-label="Close">✕</button></div>'
      + '<div id="ws-body" class="vexsr-sub" style="margin-top:10px">Looking…</div></div>';
    document.body.appendChild(m);
    const close = () => m.remove();
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.querySelector('#ws-close').addEventListener('click', close);

    const d = await this.gather();
    const found = this.reasons(d);
    const body = m.querySelector('#ws-body');
    body.innerHTML = '';

    if (!found.length) {
      const n = this.nothing(d);
      body.innerHTML = '<div class="vexsr-rule"><span class="vexsr-host">' + esc(n.title) + '</span></div>'
        + '<div class="vexsr-note" style="border:0;padding-top:8px">' + esc(n.detail) + '</div>';
      return m;
    }

    for (const r of found) {
      const row = document.createElement('div');
      row.className = 'vexsr-rule';
      row.style.cssText = 'flex-direction:column;align-items:stretch;gap:4px';
      row.innerHTML = '<span class="vexsr-host">' + esc(r.title) + '</span>'
        + '<span class="vexsr-mode" style="white-space:normal;line-height:1.5">' + esc(r.detail) + '</span>';
      const act = this._action(r, close);
      if (act) row.appendChild(act);
      body.appendChild(row);
    }
    const more = document.createElement('button');
    more.className = 'vexsr-x';
    more.style.cssText = 'margin-top:10px';
    more.textContent = 'What is this using? — the full breakdown';
    more.addEventListener('click', () => { close(); try { VexTasks.open(); } catch (err) { window.showToast?.(err.message, 'error'); } });
    body.appendChild(more);
    return m;
  },

  // The one button a finding is worth: whatever actually fixes it.
  _action(r, close) {
    const b = document.createElement('button');
    b.className = 'vexsr-x';
    b.style.cssText = 'align-self:flex-start;margin-top:4px';
    if (r.fix === 'go-tab' && r.tab) {
      b.textContent = 'Go to that tab';
      b.addEventListener('click', () => { close(); try { TabManager.switchTab(r.tab); } catch (err) { window.showToast?.(err.message, 'error'); } });
    } else if (r.fix === 'go-panel' && r.panel) {
      b.textContent = 'Open that panel';
      b.addEventListener('click', () => { close(); try { SidebarManager.openPanel(r.panel); } catch (err) { window.showToast?.(err.message, 'error'); } });
    } else if (r.fix === 'panel-sleep' && r.panel) {
      b.textContent = 'Let it sleep now';
      b.addEventListener('click', () => {
        try { SidebarManager.sleepPanel(r.panel); window.showToast?.('Slept ' + SidebarManager.panelLabel(r.panel)); close(); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      });
    } else if (r.fix === 'routing') {
      b.textContent = 'Routing settings';
      b.addEventListener('click', () => { close(); try { PrivateRouting.open(); } catch (err) { window.showToast?.(err.message, 'error'); } });
    } else if (r.fix === 'memory') {
      b.textContent = 'Memory settings';
      b.addEventListener('click', () => {
        close();
        try { SettingsUI.openSection('setting-panel-keepawake'); }
        catch { try { SidebarManager.openPanel('settings'); } catch (err) { window.showToast?.(err.message, 'error'); } }
      });
    } else return null;
    return b;
  },
};

if (typeof window !== 'undefined') window.WhySlow = WhySlow;
if (typeof module !== 'undefined' && module.exports) module.exports = { WhySlow };
