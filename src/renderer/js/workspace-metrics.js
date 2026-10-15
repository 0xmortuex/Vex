// === Workspace metrics ===
//
// How much time each workspace (and the research project you are working on)
// gets, how many tabs were opened in it and how many notes were written while
// it was in front. All of it stays on this device: a few numbers per day per
// space, no page addresses and no titles. Export as CSV from Settings ›
// Workspaces; turn it off or reset it there too.
//
//   time    counted while Vex is the focused window and you touched it in the
//           last 5 minutes — in whole seconds, credited to the workspace that
//           was active (and to the active research project, if any)
//   tabs    tabs opened (not the ones Vex restores when it starts, not private
//           or Tor tabs)
//   notes   notes created or edited, each counted once per day per space
//
// Nothing is recorded in a private window. Stored in 'vex.workspaceMetrics',
// not part of Vex Sync.

const WorkspaceMetrics = {
  KEY: 'vex.workspaceMetrics',
  OFF_KEY: 'vex.workspaceMetricsOff',
  TICK_MS: 10000,
  IDLE_MS: 5 * 60 * 1000,
  KEEP_DAYS: 400,
  MAX_NOTE_IDS: 300,
  RESTORE_GRACE_MS: 8000,

  data: { v: 1, spaces: {}, days: {} },
  _last: 0,
  _lastInput: 0,
  _started: 0,
  _noteStamps: null,
  _noteTick: 0,
  _timer: null,
  _dirty: false,

  // --- pure helpers -------------------------------------------------------
  dayKey(d) {
    const x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  },

  // A spreadsheet reads =, +, - and @ at the start of a cell as a formula.
  csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  },

  // rows: [{ date, kind, name, seconds, tabs, notes }]
  toCsv(rows) {
    const head = ['date', 'space_type', 'space', 'seconds', 'minutes', 'tabs_opened', 'notes_written'];
    const lines = [head.join(',')];
    for (const r of rows) {
      lines.push([r.date, r.kind, r.name, r.seconds, (r.seconds / 60).toFixed(1), r.tabs, r.notes].map(v => this.csvCell(v)).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  },

  _clean(raw) {
    const out = { v: 1, spaces: {}, days: {} };
    if (!raw || typeof raw !== 'object') return out;
    if (raw.spaces && typeof raw.spaces === 'object') {
      for (const [k, name] of Object.entries(raw.spaces)) if (/^(ws|proj):[\w.-]{1,80}$/.test(k) && typeof name === 'string') out.spaces[k] = name.slice(0, 80);
    }
    if (raw.days && typeof raw.days === 'object') {
      for (const [day, spaces] of Object.entries(raw.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !spaces || typeof spaces !== 'object') continue;
        const d = {};
        for (const [k, v] of Object.entries(spaces)) {
          if (!out.spaces[k] || !v || typeof v !== 'object') continue;
          d[k] = {
            s: Number.isFinite(v.s) && v.s > 0 ? Math.floor(v.s) : 0,
            t: Number.isFinite(v.t) && v.t > 0 ? Math.floor(v.t) : 0,
            n: Array.isArray(v.n) ? v.n.filter(x => typeof x === 'string').slice(0, this.MAX_NOTE_IDS) : [],
          };
        }
        out.days[day] = d;
      }
    }
    return out;
  },

  // --- storage ------------------------------------------------------------
  load() {
    try { this.data = this._clean(JSON.parse(localStorage.getItem(this.KEY) || 'null')); }
    catch { this.data = this._clean(null); }
    return this.data;
  },
  save() {
    this._prune();
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); this._dirty = false; return true; }
    catch (err) { console.error('[WorkspaceMetrics] could not save:', err && err.message); return false; }
  },
  _prune() {
    const cut = this.dayKey(new Date(Date.now() - this.KEEP_DAYS * 86400000));
    for (const day of Object.keys(this.data.days)) if (day < cut) delete this.data.days[day];
  },

  // The stored value is the exception: 'true' under the "Off" key.
  enabled() { try { return localStorage.getItem(this.OFF_KEY) !== 'true'; } catch { return true; } },
  setEnabled(on) {
    try { if (on) localStorage.removeItem(this.OFF_KEY); else localStorage.setItem(this.OFF_KEY, 'true'); }
    catch (err) { throw new Error('The choice could not be saved: ' + ((err && err.message) || err)); }
  },
  _privateWindow() { return !!(typeof window !== 'undefined' && window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow); },
  _recording() { return this.enabled() && !this._privateWindow(); },

  // The spaces being worked in right now: [{ key, name }].
  currentSpaces() {
    const out = [];
    try {
      if (typeof WorkspaceManager !== 'undefined' && WorkspaceManager.getActive) {
        const ws = WorkspaceManager.getActive();
        if (ws && ws.id) out.push({ key: 'ws:' + String(ws.id).replace(/[^\w.-]/g, '_').slice(0, 80), name: String(ws.name || ws.id) });
      }
    } catch (err) { console.error('[WorkspaceMetrics] workspace unreadable:', err); }
    try {
      if (typeof ResearchProjects !== 'undefined' && ResearchProjects.active) {
        const p = ResearchProjects.active();
        if (p && p.id) out.push({ key: 'proj:' + String(p.id).replace(/[^\w.-]/g, '_').slice(0, 80), name: String(p.name || p.id) });
      }
    } catch (err) { console.error('[WorkspaceMetrics] project unreadable:', err); }
    return out;
  },

  _bucket(space, when) {
    const day = this.dayKey(when || new Date());
    this.data.spaces[space.key] = String(space.name).slice(0, 80);
    const d = this.data.days[day] || (this.data.days[day] = {});
    return d[space.key] || (d[space.key] = { s: 0, t: 0, n: [] });
  },

  addSeconds(sec, when) {
    if (!(sec > 0)) return;
    for (const sp of this.currentSpaces()) this._bucket(sp, when).s += sec;
    this._dirty = true;
  },
  addTab(when) {
    for (const sp of this.currentSpaces()) this._bucket(sp, when).t += 1;
    this._dirty = true;
  },
  addNote(id, when) {
    if (typeof id !== 'string') return;
    for (const sp of this.currentSpaces()) {
      const b = this._bucket(sp, when);
      if (!b.n.includes(id) && b.n.length < this.MAX_NOTE_IDS) { b.n.push(id); this._dirty = true; }
    }
  },

  // --- reading it back ----------------------------------------------------
  // Rows per day per space, newest day first. days = number, or 0 for all.
  rows(days = 0, now = new Date()) {
    const cut = days > 0 ? this.dayKey(new Date(now.getTime() - (days - 1) * 86400000)) : '';
    const rows = [];
    for (const day of Object.keys(this.data.days).sort().reverse()) {
      if (cut && day < cut) continue;
      for (const [key, v] of Object.entries(this.data.days[day])) {
        rows.push({ date: day, kind: key.startsWith('proj:') ? 'project' : 'workspace', key, name: this.data.spaces[key] || key, seconds: v.s, tabs: v.t, notes: v.n.length });
      }
    }
    return rows;
  },

  totals(days = 0, now = new Date()) {
    const by = new Map();
    for (const r of this.rows(days, now)) {
      const t = by.get(r.key) || { key: r.key, kind: r.kind, name: r.name, seconds: 0, tabs: 0, notes: 0 };
      t.seconds += r.seconds; t.tabs += r.tabs; t.notes += r.notes;
      by.set(r.key, t);
    }
    return [...by.values()].sort((a, b) => b.seconds - a.seconds);
  },

  fmtTime(sec) {
    const m = Math.round(sec / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
  },

  async exportCsv() {
    const rows = this.rows(0);
    if (!rows.length) throw new Error('Nothing has been recorded yet');
    if (!window.vex || typeof window.vex.saveTextFile !== 'function') throw new Error('This window cannot save files');
    const res = await window.vex.saveTextFile('vex-workspace-metrics-' + this.dayKey(new Date()) + '.csv', this.toCsv(rows), 'csv');
    return res;
  },

  reset() {
    this.data = this._clean(null);
    this._noteStamps = null;
    return this.save();
  },

  // --- sampling -----------------------------------------------------------
  _touch() { this._lastInput = Date.now(); },

  _noteMap() {
    let list;
    try { list = JSON.parse(localStorage.getItem('vex.notes') || '[]'); } catch { return null; }
    if (!Array.isArray(list)) return null;
    const m = new Map();
    for (const n of list) if (n && typeof n.id === 'string') m.set(n.id, String(n.updatedAt || '') + ':' + String((n.content || '').length));
    return m;
  },

  sampleNotes() {
    const now = this._noteMap();
    if (!now) return 0;
    let n = 0;
    if (this._noteStamps) {
      for (const [id, stamp] of now) {
        if (this._noteStamps.get(id) !== stamp) { this.addNote(id); n++; }
      }
    }
    this._noteStamps = now;
    return n;
  },

  tick(at = Date.now()) {
    if (!this._recording()) { this._last = at; return 0; }
    const elapsed = this._last ? Math.min(at - this._last, this.TICK_MS * 3) : 0;
    this._last = at;
    const active = typeof document !== 'undefined' && document.visibilityState !== 'hidden' && (typeof document.hasFocus !== 'function' || document.hasFocus());
    const idle = this._lastInput && at - this._lastInput > this.IDLE_MS;
    let sec = 0;
    if (active && !idle && elapsed > 0) { sec = Math.round(elapsed / 1000); this.addSeconds(sec); }
    if (at - this._noteTick >= 30000) { this._noteTick = at; this.sampleNotes(); }
    if (this._dirty) this.save();
    return sec;
  },

  _wrapTabs() {
    if (typeof TabManager === 'undefined' || typeof TabManager.createTab !== 'function' || TabManager._vexMetricsWrapped) return;
    const original = TabManager.createTab;
    const self = this;
    TabManager.createTab = function (url, activate, groupId, opts) {
      const id = original.apply(this, arguments);
      try {
        const ephemeral = opts && opts.partition && !String(opts.partition).startsWith('persist:');
        if (id && self._recording() && !ephemeral && Date.now() - self._started > self.RESTORE_GRACE_MS) { self.addTab(); }
      } catch (err) { console.error('[WorkspaceMetrics] tab not counted:', err); }
      return id;
    };
    TabManager._vexMetricsWrapped = true;
  },

  // --- Settings › Workspaces ---------------------------------------------
  renderSettings(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    if (this._privateWindow()) { container.innerHTML = '<div class="muted" style="font-size:12px">Nothing is recorded in a private window.</div>'; return; }
    const range = Number(container.dataset.range || 7);
    const totals = this.totals(range);
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:10px">Time, tabs opened and notes written per workspace and research project. Kept on this device only, as numbers per day: no page addresses or titles.</p>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><input type="checkbox" id="wm-on" ${this.enabled() ? 'checked' : ''} aria-label="Record workspace metrics"><span>Record workspace metrics</span></label>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <label for="wm-range" style="font-size:12px;color:var(--text-muted)">Show</label>
        <select id="wm-range" class="set-input"><option value="7" ${range === 7 ? 'selected' : ''}>last 7 days</option><option value="30" ${range === 30 ? 'selected' : ''}>last 30 days</option><option value="0" ${range === 0 ? 'selected' : ''}>everything</option></select>
      </div>
      ${totals.length ? `<table style="width:100%;font-size:12.5px;border-collapse:collapse">
        <thead><tr style="text-align:left;color:var(--text-muted)"><th style="padding:4px 6px">Space</th><th>Time</th><th>Tabs</th><th>Notes</th></tr></thead>
        <tbody>${totals.map(t => `<tr style="border-top:1px solid var(--border)"><td style="padding:5px 6px">${esc(t.name)} <span class="muted" style="font-size:11px">${t.kind === 'project' ? 'project' : 'workspace'}</span></td><td>${esc(this.fmtTime(t.seconds))}</td><td>${t.tabs}</td><td>${t.notes}</td></tr>`).join('')}</tbody>
      </table>` : '<div class="muted" style="font-size:12px">Nothing recorded for this period yet.</div>'}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button type="button" class="btn-secondary" id="wm-csv">Export CSV</button>
        <button type="button" class="btn-secondary" id="wm-reset" style="color:var(--danger,#ef4444)">Reset metrics</button>
      </div>`;
    container.querySelector('#wm-on').addEventListener('change', (e) => {
      try { this.setEnabled(e.target.checked); } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    container.querySelector('#wm-range').addEventListener('change', (e) => { container.dataset.range = e.target.value; this.renderSettings(container); });
    container.querySelector('#wm-csv').addEventListener('click', async () => {
      try {
        const r = await this.exportCsv();
        if (r && r.ok) window.showToast?.('Metrics saved');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    container.querySelector('#wm-reset').addEventListener('click', async () => {
      if (!(await vexConfirm({ title: 'Reset workspace metrics?', message: 'All recorded time, tab and note counts are deleted from this device.', okLabel: 'Reset', danger: true }))) return;
      this.reset();
      this.renderSettings(container);
    });
  },

  init() {
    this.load();
    this._started = Date.now();
    this._wrapTabs();
    if (typeof document === 'undefined') return;
    for (const ev of ['mousemove', 'keydown', 'pointerdown', 'wheel']) document.addEventListener(ev, () => this._touch(), { passive: true, capture: true });
    this._lastInput = Date.now();
    this._timer = setInterval(() => this.tick(), this.TICK_MS);
    window.addEventListener('beforeunload', () => { if (this._dirty) this.save(); });
    document.addEventListener('DOMContentLoaded', () => this._wrapTabs());
    if (window.VexSettingsGroups) {
      VexSettingsGroups.register({ id: 'workspace-metrics', title: 'Workspace metrics', render: (c) => this.renderSettings(c) });
    }
  },
};

if (typeof window !== 'undefined') { window.WorkspaceMetrics = WorkspaceMetrics; if (document.getElementById) WorkspaceMetrics.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { WorkspaceMetrics };
