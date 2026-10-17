// === Adaptive focus block length (T2-055) ==========================================
//
// Focus OS proposes blocks of 50 minutes because 50 is a default, not because
// you work in 50s. This measures how long you ACTUALLY stay with something and
// offers the median as the block length.
//
//   A span is a run of activity (keys, clicks, scrolling in Vex) with no gap of
//   5 minutes or more. When the gap comes, the span is closed and its length kept
//   against the workspace it happened in. Spans under 3 minutes are noise and are
//   dropped. Only the LENGTH, the workspace, a coarse kind (reading / making /
//   other, from the kind of page in front) and the day are kept: no addresses,
//   no titles, no keys.
//   The suggestion needs 8 spans of a workspace. It is the median, rounded to 5
//   minutes and held between 10 and 180 (Focus OS's own limits). Blocks you
//   finished in Focus OS are shown beside it as a second opinion.
//
//   Nothing changes by itself. "Use N minutes" in Settings (or Ctrl+K › Focus
//   block length) sets Focus OS's block length when YOU press it.
//
//   Optional, off until ticked ("Plan new blocks with my real length"): Focus OS asks this module
//   for the length of the workspace in front when it PROPOSES blocks for a goal (FocusOS.plan), and
//   uses it instead of the one block length of its settings, for that proposal only. The proposal
//   still waits for a confirm, says in its note that the blocks are your usual length here, and the
//   Focus OS setting itself is never changed. A workspace with too few spans gets the setting's length.
//
// Not recorded: while a game runs, while Vex is hidden, or in a private tab. Kept
// on this computer, 60 spans per workspace, never synced. Sends nothing.

const VexFocusCal = {
  PREF: 'vex.focusCal.enabled',
  PLAN_PREF: 'vex.focusCal.plan',    // 'on': Focus OS proposals use the measured length of the workspace in front
  KEY: 'vex.focusCal',               // { v:1, spans: { [wsId]: [{ min, kind, at }] } }
  GAP_MS: 5 * 60 * 1000,
  MIN_SPAN_MIN: 3,
  MIN_SAMPLES: 8,
  MAX_PER_WS: 60,
  TICK_MS: 5000,                     // activity is noted at most this often
  BLOCK_MIN: 10,
  BLOCK_MAX: 180,
  _cur: null,                        // { ws, kind, start, last }
  _lastTick: 0,

  enabled() { return VexPlanKit.flag(this.PREF); },
  setEnabled(on) {
    VexPlanKit.setFlag(this.PREF, on);
    if (!on) this._cur = null;
    return !!on;
  },

  // Off until ticked (VexPlanKit.flag would answer yes for a key nobody wrote).
  planWith() { try { return this.enabled() && localStorage.getItem(this.PLAN_PREF) === 'on'; } catch (err) { throw new Error('The planning choice could not be read: ' + err.message, { cause: err }); } },
  setPlanWith(on) {
    try { localStorage.setItem(this.PLAN_PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that choice: ' + err.message, { cause: err }); }
    return !!on;
  },
  // The measured block length of a workspace for Focus OS to plan with, or 0 (switched off, too few spans).
  blockFor(wsId = (typeof WorkspaceManager !== 'undefined' ? WorkspaceManager.activeId : 'default')) {
    if (!this.planWith()) return 0;
    const list = this.data().spans[wsId];
    return this.suggest(list);
  },

  // ---- pure --------------------------------------------------------------------------
  kindOf(url) {
    let u;
    try { u = new URL(String(url || '')); } catch { return 'other'; }
    const h = u.hostname.replace(/^www\./, ''), p = u.pathname.toLowerCase();
    if (/\.pdf$/.test(p) || /(wikipedia|medium|substack|arxiv|nature|bbc|nytimes|theguardian)\b/.test(h) || /^(docs|developer|learn)\./.test(h)) return 'reading';
    if (/(github|gitlab|codepen|replit|colab|leetcode|codeforces|overleaf|figma|notion|docs\.google|desmos|wolframalpha)\b/.test(h) || h === 'localhost' || /^127\./.test(h)) return 'making';
    return 'other';
  },
  median(nums) {
    const a = nums.slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  },
  // -> minutes (multiple of 5), or 0 when there are too few spans to say.
  suggest(spans) {
    if (!Array.isArray(spans) || spans.length < this.MIN_SAMPLES) return 0;
    const m = this.median(spans.map(s => s.min));
    return Math.min(this.BLOCK_MAX, Math.max(this.BLOCK_MIN, Math.round(m / 5) * 5));
  },

  // ---- storage ---------------------------------------------------------------------------
  data() {
    const raw = VexPlanKit.readJson(this.KEY, null);
    const spans = raw && raw.spans && typeof raw.spans === 'object' && !Array.isArray(raw.spans) ? raw.spans : {};
    return { v: 1, spans };
  },
  _add(ws, min, kind, at) {
    const d = this.data();
    const list = Array.isArray(d.spans[ws]) ? d.spans[ws] : [];
    list.push({ min: Math.round(min * 10) / 10, kind, at });
    d.spans[ws] = list.slice(-this.MAX_PER_WS);
    VexPlanKit.writeJson(this.KEY, d);
  },
  forget() { VexPlanKit.writeJson(this.KEY, { v: 1, spans: {} }); },

  // ---- recording -----------------------------------------------------------------------------
  _context() {
    if (typeof document !== 'undefined' && document.hidden) return null;
    if (typeof GameMode !== 'undefined' && GameMode.gaming) return null;
    if (typeof GameSession !== 'undefined' && GameSession.active) return null;
    const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    if (tab && window.VexTabPolicy && typeof window.VexTabPolicy.canPersist === 'function' && !window.VexTabPolicy.canPersist(tab)) return null;
    const ws = typeof WorkspaceManager !== 'undefined' ? WorkspaceManager.activeId : 'default';
    return { ws, kind: this.kindOf(tab && tab.url) };
  },
  // The span ends where activity last was.
  _close() {
    const c = this._cur;
    this._cur = null;
    if (!c) return false;
    const min = (c.last - c.start) / 60000;
    if (min < this.MIN_SPAN_MIN) return false;
    this._add(c.ws, min, c.kind, c.last);
    return true;
  },
  noteActivity(now = Date.now()) {
    if (!this.enabled() || now - this._lastTick < this.TICK_MS) return false;
    this._lastTick = now;
    const ctx = this._context();
    if (!ctx) { this._close(); return false; }
    const c = this._cur;
    if (c && (now - c.last >= this.GAP_MS || c.ws !== ctx.ws)) this._close();
    if (!this._cur) this._cur = { ws: ctx.ws, kind: ctx.kind, start: now, last: now };
    else { this._cur.last = now; if (ctx.kind !== 'other') this._cur.kind = ctx.kind; }
    return true;
  },

  // ---- reading it back --------------------------------------------------------------------------
  // -> [{ ws, name, count, median, suggestion, byKind: { reading: min, making: min, other: min } }]
  report() {
    const d = this.data();
    const out = [];
    for (const [ws, list] of Object.entries(d.spans)) {
      if (!Array.isArray(list) || !list.length) continue;
      const byKind = {};
      for (const k of ['reading', 'making', 'other']) {
        const l = list.filter(s => s.kind === k);
        if (l.length >= 3) byKind[k] = Math.round(this.median(l.map(s => s.min)));
      }
      let name = ws;
      if (typeof WorkspaceManager !== 'undefined') { const w = WorkspaceManager.workspaces.find(x => x.id === ws); if (w) name = w.name; }
      out.push({ ws, name, count: list.length, median: Math.round(this.median(list.map(s => s.min))), suggestion: this.suggest(list), byKind });
    }
    return out.sort((a, b) => b.count - a.count);
  },
  // Focus OS blocks you finished: their real length in minutes.
  finishedBlocks() {
    if (typeof FocusOS === 'undefined' || typeof FocusOS.state !== 'function') return [];
    return FocusOS.state().blocks.filter(b => b.state === 'done' && Number.isFinite(b.startedAt) && Number.isFinite(b.endedAt) && b.endedAt > b.startedAt)
      .map(b => (b.endedAt - b.startedAt) / 60000);
  },
  currentBlockMin() {
    if (typeof FocusOS === 'undefined' || typeof FocusOS.settings !== 'function') return 0;
    return FocusOS.settings().blockMin;
  },

  // Feeds Focus OS, on request.
  apply(minutes) {
    const m = Number(minutes);
    if (!Number.isInteger(m) || m < this.BLOCK_MIN || m > this.BLOCK_MAX) throw new Error('A block is ' + this.BLOCK_MIN + ' to ' + this.BLOCK_MAX + ' minutes');
    if (typeof FocusOS === 'undefined') throw new Error('Focus OS is not loaded');
    FocusOS.setSettings({ blockMin: m });
    return m;
  },

  open() {
    if (!this.enabled()) { window.showToast?.('Focus block length is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('focus-calibration');
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-focus-cal', title: 'How long you stay with it', sub: 'Uninterrupted spans (no gap of 5 minutes) measured in Vex, per workspace. Only lengths are kept.' });
    let rep;
    try { rep = this.report(); } catch (err) { body.appendChild(VexSettingsGroups.note('Could not read the measurements: ' + err.message)); return; }
    const cur = this.currentBlockMin();
    if (cur) body.appendChild(VexSettingsGroups.note('Focus OS plans blocks of ' + cur + ' minutes now.'));
    if (!rep.length) body.appendChild(VexSettingsGroups.note('Nothing measured yet. Use Vex for a few days; this needs 8 spans of one workspace.'));
    for (const r of rep) {
      const kinds = Object.entries(r.byKind).map(([k, v]) => k + ' ' + v + ' min').join(', ');
      const { row } = VexPlanKit.listRow(r.suggestion ? r.suggestion + ' min' : 'not yet', r.name + ': median ' + r.median + ' min over ' + r.count + ' spans' + (kinds ? ' (' + kinds + ')' : '') + (r.suggestion ? '' : ', need ' + this.MIN_SAMPLES));
      if (r.suggestion) {
        row.appendChild(VexSettingsGroups.button('Use ' + r.suggestion + ' min', () => {
          try { this.apply(r.suggestion); window.showToast?.('Focus OS blocks are ' + r.suggestion + ' minutes now', 'info'); close(); }
          catch (err) { window.showToast?.(err.message, 'error'); }
        }, { label: 'Use ' + r.suggestion + ' minutes for Focus OS blocks' }));
      }
      body.appendChild(row);
    }
    const fin = this.finishedBlocks();
    if (fin.length >= 3) body.appendChild(VexSettingsGroups.note('Blocks you finished in Focus OS: median ' + Math.round(this.median(fin)) + ' minutes over ' + fin.length + '.'));
    body.appendChild(VexSettingsGroups.button('Forget the measurements', () => { try { this.forget(); close(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { danger: true }));
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    const tick = () => { try { this.noteActivity(); } catch (err) { window.VexProblems?.note('Focus length', 'Could not note activity', err); } };
    for (const ev of ['keydown', 'pointerdown', 'wheel']) document.addEventListener(ev, tick, { capture: true, passive: true });
    const end = () => { try { this._close(); } catch (err) { window.VexProblems?.note('Focus length', 'Could not close the span', err); } };
    window.addEventListener('beforeunload', end);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') end(); });
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Measures how long you stay with one thing before a 5 minute gap, per workspace, and offers the median as the Focus OS block length. Only lengths are kept, on this computer. Nothing changes until you press Use.'));
    const row = document.createElement('label');
    row.className = 'setting-toggle-row';
    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = this.planWith(); box.disabled = !this.enabled();
    box.setAttribute('aria-label', 'Plan new Focus OS blocks with my real length for the workspace I am in');
    box.addEventListener('change', () => { try { this.setPlanWith(box.checked); } catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); } });
    row.append(box, document.createTextNode(' Plan new Focus OS blocks with my real length for the workspace I am in (the Focus OS setting is not changed; each proposal says so and waits for your confirm)'));
    el.appendChild(row);
    el.appendChild(VexSettingsGroups.button('Show my focus length', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexFocusCal = VexFocusCal;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'focus-calibration', title: 'Focus block length', keywords: 'focus block length median uninterrupted calibrate adaptive pomodoro', before: 'about', build: (el) => VexFocusCal.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'focus-calibration', label: 'Focus block length', hint: 'How long you really stay with something, as a Focus OS suggestion', icon: 'target', action: () => VexFocusCal.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFocusCal };
