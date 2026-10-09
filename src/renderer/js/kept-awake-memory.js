// === A word when something set never to sleep grows big ===================
//
// The owner's Vex used 5 GB on 2026-10-09: one renderer held 3.3 GB, their
// claude.ai tabs, two of them set to never sleep and open for three days.
// Nothing said so: the memory notice was off (vex.memoryNoticeMB = 0), and it
// is a different thing anyway. That notice is a ceiling the user chose for
// every tab; this is a tab the user chose to keep awake, which then grew
// without anyone choosing that. So it speaks even with the notice off.
//
// A tab or web panel that is kept awake by choice (a keep-awake timer, a
// never-sleep site, a panel kept awake) and whose process passes LIMIT_MB
// gets ONE toast: "claude.ai is using 3.3 GB and never sleeps. [Reload]
// [Let it sleep]". Once per process per session, never while it is on a call
// or playing, and never while a game runs (the shared job timer holds it,
// js/jobs.js). Memory is per process (main's app:tab-memory): same-site tabs
// share one, so they are named together and reloaded together.
const KeptAwakeMemory = {
  JOB: 'Kept-awake memory',
  EVERY_MS: 5 * 60 * 1000,
  LIMIT_MB: 1536,
  _told: new Set(),
  _job: null,

  init() {
    if (this._job) return false;
    if (typeof VexJobs === 'undefined') throw new Error('The job timer is not loaded');
    this._job = VexJobs.every(this.JOB, this.EVERY_MS, () => this.check(), { when: 'ui' });
    return true;
  },

  _host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  _wcOf(wv) {
    if (!wv || typeof wv.getWebContentsId !== 'function') return null;
    try { return wv.getWebContentsId(); } catch { return null; }
  },

  // Kept awake because the user said so, and how: 'never' or 'timer'. A tab
  // that is recording is kept awake too, but not by a choice to undo here.
  _tabChoice(tab) {
    if (tab.keepAwakeUntil && Date.now() < tab.keepAwakeUntil) return tab.keepAwakeUntil >= Number.MAX_SAFE_INTEGER ? 'never' : 'timer';
    const h = this._host(tab.url);
    if (h && typeof TabManager._neverSleepHosts === 'function' && TabManager._neverSleepHosts().has(h)) return 'never';
    return '';
  },

  // Everything awake by choice, with the webContents to measure.
  targets() {
    const out = [];
    if (typeof TabManager !== 'undefined' && typeof WebviewManager !== 'undefined') {
      for (const tab of TabManager.tabs || []) {
        if (tab.sleeping || tab._lazy) continue;
        const choice = this._tabChoice(tab);
        if (!choice) continue;
        const wc = this._wcOf(WebviewManager.webviews.get(tab.id));
        if (wc == null) continue;
        const busy = (tab.audible && !tab.muted) || (typeof TabManager.isCapturing === 'function' && TabManager.isCapturing(tab));
        out.push({ key: 'tab:' + tab.id, kind: 'tab', id: tab.id, host: this._host(tab.url), choice, wc, busy: !!busy });
      }
    }
    if (typeof SidebarManager !== 'undefined' && SidebarManager.panelWebviews) {
      for (const name of Object.keys(SidebarManager.panelWebviews)) {
        if (!SidebarManager.keptAwakeNow(name)) continue;
        const wc = this._wcOf(SidebarManager.panelWebviews[name]);
        if (wc == null) continue;
        const choice = SidebarManager.keepAwakeFor(name).mode === 'always' ? 'never' : 'timer';
        out.push({ key: 'panel:' + name, kind: 'panel', id: name, label: SidebarManager.panelLabel(name), choice, wc, busy: !!SidebarManager.panelBusy(name) });
      }
    }
    return out;
  },

  _fmt(mb) { return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB'; },

  // "claude.ai is using 3.3 GB and never sleeps."
  message(group) {
    const items = group.items;
    const never = items.every(t => t.choice === 'never');
    const hosts = [...new Set(items.filter(t => t.kind === 'tab').map(t => t.host))];
    const panels = items.filter(t => t.kind === 'panel').map(t => t.label);
    let who;
    if (items.length === 1) who = items[0].kind === 'panel' ? items[0].label : items[0].host;
    else if (!panels.length && hosts.length === 1) who = items.length + ' ' + hosts[0] + ' tabs';
    else who = [...panels, ...hosts].join(' and ');
    const one = items.length === 1;
    return who + (one ? ' is' : ' are') + ' using ' + this._fmt(group.mb) + (one ? '' : ' together')
      + (never ? (one ? ' and never sleeps.' : ' and never sleep.') : (one ? ' and is kept awake.' : ' and are kept awake.'));
  },

  // Measure, and say it once for each process past the limit.
  async check() {
    const all = this.targets();
    if (!all.length) return [];
    if (!window.vex || typeof window.vex.tabMemory !== 'function') throw new Error('Vex cannot measure its tabs here');
    const mem = await window.vex.tabMemory(all.map(t => t.wc));
    const groups = new Map();
    for (const t of all) {
      const row = mem && mem.byId && mem.byId[t.wc];
      if (!row) continue;
      const mb = Math.round(row.memKB / 1024);
      if (mb < this.LIMIT_MB) continue;
      const g = groups.get(row.pid) || { pid: row.pid, mb, items: [] };
      g.items.push(t);
      groups.set(row.pid, g);
    }
    const shown = [];
    for (const g of groups.values()) {
      if (g.items.some(t => this._told.has(t.key))) continue;
      // Reloading would end the call or the sound; ask again next time.
      if (g.items.some(t => t.busy)) continue;
      for (const t of g.items) this._told.add(t.key);
      this.offer(g);
      shown.push(g);
    }
    return shown;
  },

  offer(group) {
    if (typeof window.showToast !== 'function') throw new Error('The toast system is not loaded');
    const items = group.items;
    return window.showToast(this.message(group), 'warn', 20000, {
      actions: [
        { label: 'Reload', title: 'Reloading gives the memory back; you stay signed in', run: () => this.reload(items) },
        { label: 'Let it sleep', title: 'Turn off keep-awake, so it sleeps when you are not using it', run: () => this.letSleep(items) },
      ],
    });
  },

  _guest(t) {
    if (t.kind === 'panel') return (typeof SidebarManager !== 'undefined' && SidebarManager.panelWebviews[t.id]) || null;
    return (typeof WebviewManager !== 'undefined' && WebviewManager.webviews.get(t.id)) || null;
  },

  reload(items) {
    const gone = [];
    for (const t of items) {
      const wv = this._guest(t);
      if (!wv || typeof wv.reload !== 'function') { gone.push(t); continue; }
      wv.reload();
    }
    document.dispatchEvent(new CustomEvent('vex:memory-event', { detail: { note: 'Reloaded a kept-awake ' + (items[0].kind === 'panel' ? 'panel' : 'tab') } }));
    if (gone.length) window.showToast('It was closed before it could be reloaded', 'error');
    return items.length - gone.length;
  },

  letSleep(items) {
    for (const t of items) {
      if (t.kind === 'panel') {
        if (!SidebarManager.setKeepAwakeMode(t.id, 'off')) throw new Error('The setting could not be saved');
        continue;
      }
      const tab = (TabManager.tabs || []).find(x => x.id === t.id);
      if (!tab) continue;
      tab.keepAwakeUntil = 0;
      const h = this._host(tab.url);
      if (h && TabManager._neverSleepHosts().has(h)) {
        if (typeof SiteProfiles === 'undefined') throw new Error('The site settings are not loaded');
        SiteProfiles.setNeverSleep(h, false);
      }
      TabManager._refreshKeepAwakeIndicator(tab);
    }
    if (items.some(t => t.kind === 'tab')) TabManager.persistTabs();
    const who = items[0].kind === 'panel' ? items[0].label : items[0].host;
    window.showToast(who + ' can sleep again');
  },
};

if (typeof window !== 'undefined') window.KeptAwakeMemory = KeptAwakeMemory;
if (typeof module !== 'undefined' && module.exports) module.exports = { KeptAwakeMemory };
