// === Time travel: slide the whole browser back to an earlier moment ==========
//
// Vex already keeps a rolling set of tab snapshots per workspace
// (js/workspace-snapshots.js). This reaches further: one local journal of the
// whole browser — tabs (address, title, group), the active workspace, the
// notes (id, title, hash), the reminders that are due and the focus state —
// pushed to main whenever it changed (src/main/state-journal.js keeps it,
// bounded in days and bytes). A slider then picks any moment in the window and
// shows how things were, with two ways back:
//
//   Reopen these tabs         the tabs of that moment that are not open now,
//                             as new tabs; nothing open is closed or changed.
//   Restore this note version the text of a note as it was then. What the note
//                             holds now is stored as a version first, so the
//                             restore can itself be undone from this panel.
//
// What is never pushed: private windows (this file does nothing there), Tor,
// routed and temporary-session tabs (VexTabPolicy.canShareTab, and main
// drops them again), and anything while a game runs (VexJobs holds the job;
// main refuses the push too). Note TEXT is only kept when Windows can encrypt
// it for this account; otherwise the journal records titles and hashes only
// and "Restore this note version" is not offered.
//
// Forget (in the panel) removes the journal and every stored note version.
//
// The rules (what is collected, how a moment is described) are pure functions
// of plain data, tested in tests/renderer/timeTravel.test.js. briefSection()
// is for the morning brief to call; nothing here edits today.js.
const VexTimeTravel = {
  NOTES_KEY: 'vex.notes',
  PUSH_EVERY_MS: 60 * 1000,
  MAX_TABS: 80,
  _sent: new Map(),       // note id -> hash of the text main already holds
  _lastSig: '',
  _job: null,
  briefProvider: null,    // () => string[] — set by the brief if it wants its lines journalled

  // ---- pure helpers ----------------------------------------------------------
  // The same 32-bit FNV-1a as main/state-journal.js hashText.
  hashText(text) {
    const s = String(text == null ? '' : text);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0') + '-' + s.length;
  },

  // env: { tabs, activeTabId, groups, workspace, notes, reminders, focus, brief,
  //        policy: { canShareTab, isRouted }, sent: Map, force: [ids] }
  // → the raw snapshot main redacts and stores.
  buildRaw(env) {
    const policy = env.policy || {};
    const groupName = new Map((env.groups || []).map(g => [g.id, g.name || '']));
    const tabs = [];
    for (const t of env.tabs || []) {
      if (!t || typeof t.url !== 'string') continue;
      if (typeof policy.canShareTab === 'function' && !policy.canShareTab(t)) continue;
      tabs.push({
        url: t.url, title: t.title || '', partition: t.partition || null, pinned: !!t.pinned,
        active: t.id === env.activeTabId, groupName: t.groupId ? (groupName.get(t.groupId) || '') : '',
        routed: typeof policy.isRouted === 'function' ? !!policy.isRouted(t.partition) : false,
      });
      if (tabs.length >= this.MAX_TABS) break;
    }
    const force = new Set(env.force || []);
    const sent = env.sent || new Map();
    const notes = [];
    for (const n of env.notes || []) {
      if (!n || typeof n.id !== 'string' || !n.id) continue;
      const content = typeof n.content === 'string' ? n.content : '';
      const h = this.hashText(content);
      const row = { id: n.id, title: typeof n.title === 'string' ? n.title : '', h };
      // The text goes along only when main does not already hold this version.
      if (force.has(n.id) || sent.get(n.id) !== h) row.content = content;
      notes.push(row);
    }
    return {
      tabs, notes,
      workspace: env.workspace ? { id: env.workspace.id || '', name: env.workspace.name || '' } : null,
      reminders: (env.reminders || []).filter(r => r && Number.isFinite(r.at)).slice(0, 60)
        .map(r => ({ title: String(r.message || r.title || ''), due: r.at })),
      focus: env.focus ? { on: !!env.focus.on, label: env.focus.label || '' } : null,
      brief: env.brief && env.brief.length ? { lines: env.brief.slice(0, 8) } : null,
    };
  },

  // What makes a push worth sending: everything but the note text.
  signature(raw) {
    return JSON.stringify([raw.tabs.map(t => [t.url, t.title, t.groupName, t.pinned, t.active]),
      raw.notes.map(n => [n.id, n.title, n.h]), raw.workspace, raw.reminders, raw.focus, raw.brief]);
  },

  when(ts, now = Date.now()) {
    const s = Math.max(0, Math.round((now - ts) / 1000));
    if (s < 90) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    const d = Math.round(h / 24);
    return d + ' day' + VexPlural.s(d) + ' ago';
  },

  // One short sentence list about a moment compared with now. `diff` is the
  // journal's diff(then, now) result.
  describeDiff(diff) {
    const out = [];
    if (!diff) return out;
    const n = (k, one, many) => k + ' ' + (k === 1 ? one : many);
    if (diff.tabs.removed.length) out.push(n(diff.tabs.removed.length, 'tab was open then and is not now', 'tabs were open then and are not now'));
    if (diff.tabs.added.length) out.push(n(diff.tabs.added.length, 'tab is open now that was not then', 'tabs are open now that were not then'));
    if (diff.notes.changed.length) out.push(n(diff.notes.changed.length, 'note has changed since', 'notes have changed since'));
    if (diff.notes.removed.length) out.push(n(diff.notes.removed.length, 'note existed then and is gone', 'notes existed then and are gone'));
    if (diff.workspace) out.push('You were in ' + ((diff.workspace.from && diff.workspace.from.name) || 'another workspace') + ' then.');
    if (diff.focus) out.push(diff.focus.from ? 'Focus mode was on.' : 'Focus mode was off.');
    return out;
  },

  // ---- collecting from the live interface -------------------------------------
  _liveEnv(extra) {
    const policy = (typeof window !== 'undefined' && window.VexTabPolicy) || null;
    let notes = [];
    try { const a = JSON.parse(localStorage.getItem(this.NOTES_KEY) || '[]'); if (Array.isArray(a)) notes = a; } catch { notes = []; }
    const hasTM = typeof TabManager !== 'undefined';
    let workspace = null;
    try { workspace = (typeof WorkspaceManager !== 'undefined' && WorkspaceManager.getActive) ? WorkspaceManager.getActive() : null; } catch { workspace = null; }
    let brief = null;
    if (typeof this.briefProvider === 'function') { try { brief = this.briefProvider(); } catch (err) { console.error('[time-travel] the brief provider failed:', err); } }
    return {
      tabs: hasTM ? (TabManager.tabs || []) : [], activeTabId: hasTM ? TabManager.activeTabId : null,
      groups: hasTM ? (TabManager.groups || []) : [], workspace, notes,
      focus: typeof FocusMode !== 'undefined' ? { on: !!FocusMode.active, label: '' } : null,
      brief, policy, sent: this._sent, ...extra,
    };
  },

  async push({ force = [], always = false } = {}) {
    if (typeof window === 'undefined' || !window.vex || typeof window.vex.journalPush !== 'function') return null;
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return null;
    let reminders = [];
    try { if (window.vex.reminders && window.vex.reminders.list) reminders = await window.vex.reminders.list(); } catch { reminders = []; }
    const raw = this.buildRaw(this._liveEnv({ reminders, force }));
    const sig = this.signature(raw);
    const hasText = raw.notes.some(n => 'content' in n);
    if (!always && sig === this._lastSig && !hasText) return { stored: false, reason: 'unchanged' };
    const res = await window.vex.journalPush(raw);
    // main saw (and, if it can keep it, stored) every text that was sent.
    for (const n of raw.notes) if ('content' in n) this._sent.set(n.id, n.h);
    this._lastSig = sig;
    return res;
  },

  start() {
    if (this._job || typeof VexJobs === 'undefined') return;
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return;
    this._job = VexJobs.every('Time travel journal', this.PUSH_EVERY_MS, () => this.push(), { when: 'background' });
    // First one a little after launch, once tabs have restored.
    setTimeout(() => { this.push().catch(err => console.error('[time-travel] first push failed:', err)); }, 45 * 1000);
  },

  // ---- acting on a moment --------------------------------------------------------
  // Opens the tabs of `snap` that are not open now. → how many.
  reopenTabs(snap, env = {}) {
    const tm = env.tabManager || (typeof TabManager !== 'undefined' ? TabManager : null);
    const policy = env.policy || window.VexTabPolicy;
    if (!tm) throw new Error('Tabs are not available');
    const open = new Set((tm.tabs || []).map(t => t.url));
    let made = 0, first = null;
    for (const t of snap.tabs || []) {
      if (open.has(t.u)) continue;
      const rec = { url: t.u, partition: t.part || null };
      if (policy && policy.canRestore && !policy.canRestore(rec)) continue;
      const tab = tm.createTab(t.u, false, null, { partition: t.part || undefined });
      if (tab) { tab.pinned = !!t.p; if (first == null) first = tab.id; }
      open.add(t.u);
      made++;
    }
    if (first != null && tm.switchTab) tm.switchTab(first);
    if (made && tm.persistTabs) tm.persistTabs();
    return made;
  },

  // Puts a note's text back. The text it holds now goes into the journal first.
  async restoreNote(id, version) {
    if (typeof NotesPanel !== 'undefined' && NotesPanel.flush) NotesPanel.flush();
    await this.push({ force: [id], always: true });
    let notes = [];
    try { notes = JSON.parse(localStorage.getItem(this.NOTES_KEY) || '[]'); } catch { notes = []; }
    if (!Array.isArray(notes)) notes = [];
    const now = new Date().toISOString();
    const at = notes.findIndex(n => n && n.id === id);
    if (at >= 0) notes[at] = { ...notes[at], title: version.title, content: version.content, updatedAt: now };
    else notes.push({ id, title: version.title, content: version.content, pinned: false, tags: [], sourceUrl: '', sourceTitle: '', createdAt: now, updatedAt: now });
    localStorage.setItem(this.NOTES_KEY, JSON.stringify(notes));
    if (typeof NotesPanel !== 'undefined' && NotesPanel.reloadSyncedState) NotesPanel.reloadSyncedState(true);
    this._sent.delete(id);
    await this.push({ always: true });
  },

  // ---- brief-ready section -------------------------------------------------------
  // A day ago, in a few lines, for the morning brief to show. → { id, title, lines } or null.
  async briefSection({ hoursAgo = 24 } = {}) {
    if (!window.vex || typeof window.vex.journalAt !== 'function') return null;
    const then = Date.now() - hoursAgo * 3600 * 1000;
    const got = await window.vex.journalAt(then);
    if (!got) return null;
    const diff = await window.vex.journalDiff(got.ts, Date.now());
    const lines = [(got.snap.tabs || []).length + ' tabs were open ' + this.when(got.ts) + '.'].concat(this.describeDiff(diff));
    return { id: 'time-travel', title: 'This time yesterday', icon: 'history', lines, at: got.ts };
  },

  // ---- the panel -------------------------------------------------------------------
  _icon(name, size = 14) { return (typeof VexIcons !== 'undefined' && VexIcons.has(name)) ? VexIcons.svg(name, { size }) : ''; },
  _esc(s) { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  _fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; },

  _close() {
    if (this._onKey) { document.removeEventListener('keydown', this._onKey, true); this._onKey = null; }
    document.getElementById('vex-timetravel')?.remove();
  },

  async open() {
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) { window.showToast?.('Time travel is not available in a private window'); return; }
    if (!window.vex || typeof window.vex.journalStats !== 'function') throw new Error('Time travel is not available in this build');
    this._close();
    const root = document.createElement('div');
    root.id = 'vex-timetravel';
    root.className = 'vex-tt-overlay';
    root.innerHTML = '<div class="vex-tt-card" role="dialog" aria-modal="true" aria-label="Time travel">'
      + '<div class="vex-tt-head"><span class="vex-tt-title">' + this._icon('history', 16) + ' Time travel</span>'
      + '<button class="vex-tt-btn" id="vex-tt-close" aria-label="Close">' + this._icon('x') + '</button></div>'
      + '<div class="vex-tt-body" id="vex-tt-body"></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', (e) => { if (e.target === root) this._close(); });
    root.querySelector('#vex-tt-close').addEventListener('click', () => this._close());
    this._onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); this._close();
    };
    document.addEventListener('keydown', this._onKey, true);
    try { await this.push({ always: true }); } catch (err) { console.error('[time-travel] could not journal the present before opening:', err); }
    await this._paint(null);
  },

  async _paint(ts) {
    const body = document.getElementById('vex-tt-body');
    if (!body) return;
    const stats = await window.vex.journalStats();
    const list = await window.vex.journalList({});
    const e = (s) => this._esc(s);
    const settings = '<div class="vex-tt-settings">'
      + '<span>' + stats.count + ' snapshot' + VexPlural.s(stats.count) + ' · ' + this._fmtBytes(stats.totalBytes) + ' of ' + this._fmtBytes(stats.maxBytes) + ' · ' + (stats.noteRestore ? 'note versions kept' : 'note versions off (no OS encryption)') + '</span>'
      + '<label>Keep for <select id="vex-tt-days" aria-label="Keep the journal for">'
      + [7, 14, 30, 60, 90].map(d => '<option value="' + d + '"' + (d === stats.retentionDays ? ' selected' : '') + '>' + d + ' days</option>').join('') + '</select></label>'
      + '<label class="vex-tt-check"><input type="checkbox" id="vex-tt-on"' + (stats.enabled ? ' checked' : '') + '> Record</label>'
      + '<button class="vex-tt-btn danger" id="vex-tt-forget">' + this._icon('trash') + ' Forget</button></div>';
    if (!list.length) {
      body.innerHTML = '<div class="vex-tt-empty">Nothing recorded yet. Vex adds a snapshot about once a minute while the browser changes, never in a private window or while you game.</div>' + settings;
      this._wireSettings(body);
      return;
    }
    const min = list[0].ts, max = Date.now();
    const at = ts == null ? list[list.length - 1].ts : ts;
    const got = await window.vex.journalAt(at);
    body.innerHTML = '<div class="vex-tt-slider"><input type="range" id="vex-tt-range" aria-label="Moment" min="' + min + '" max="' + max + '" step="60000" value="' + Math.min(max, Math.max(min, at)) + '">'
      + '<div class="vex-tt-when"><strong>' + e(new Date(got ? got.ts : at).toLocaleString()) + '</strong> <span>' + e(this.when(got ? got.ts : at)) + '</span></div></div>'
      + '<div id="vex-tt-moment"></div>' + settings;
    const range = body.querySelector('#vex-tt-range');
    let timer = null;
    range.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this._paint(Number(range.value)).catch(err => this._fail(err)), 200);
    });
    range.focus({ preventScroll: true });
    this._wireSettings(body);
    await this._paintMoment(got, body.querySelector('#vex-tt-moment'));
  },

  async _paintMoment(got, host) {
    const e = (s) => this._esc(s);
    if (!got) { host.innerHTML = '<div class="vex-tt-empty">The journal starts later than this moment.</div>'; return; }
    const snap = got.snap;
    const diff = await window.vex.journalDiff(got.ts, Date.now());
    const lines = this.describeDiff(diff);
    const tabsGone = diff.tabs.removed.length;
    const groups = new Map();
    for (const t of snap.tabs) { const k = t.g || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
    let tabsHtml = '';
    for (const [g, tabs] of groups) {
      tabsHtml += (g ? '<div class="vex-tt-group">' + e(g) + '</div>' : '')
        + tabs.map(t => '<div class="vex-tt-tab" title="' + e(t.u) + '">' + (t.a ? '<span class="vex-tt-dot" aria-label="was in front"></span>' : '') + e(t.t || t.u) + '</div>').join('');
    }
    const changed = new Map(diff.notes.changed.map(n => [n.id, n]));
    const removed = new Map(diff.notes.removed.map(n => [n.id, n]));
    const noteRows = snap.notes.filter(n => changed.has(n.id) || removed.has(n.id)).slice(0, 30);
    const notesHtml = noteRows.map(n => '<div class="vex-tt-note"><span>' + e(n.t || 'Untitled') + '</span>'
      + '<button class="vex-tt-btn" data-note="' + e(n.id) + '">' + this._icon('undo') + ' Restore this version</button></div>').join('');
    host.innerHTML = '<div class="vex-tt-summary">'
      + '<div><span class="vex-tt-k">Workspace</span> ' + e((snap.ws && snap.ws.name) || 'unknown') + '</div>'
      + '<div><span class="vex-tt-k">Focus</span> ' + (snap.focus && snap.focus.on ? 'on' : 'off') + '</div>'
      + '<div><span class="vex-tt-k">Reminders due</span> ' + snap.reminders.length + '</div></div>'
      + (lines.length ? '<ul class="vex-tt-diff">' + lines.map(l => '<li>' + e(l) + '</li>').join('') + '</ul>' : '<div class="vex-tt-empty">Nothing differs from now.</div>')
      + (snap.brief && snap.brief.lines.length ? '<div class="vex-tt-h">Brief</div>' + snap.brief.lines.map(l => '<div class="vex-tt-tab">' + e(l) + '</div>').join('') : '')
      + '<div class="vex-tt-h">Tabs (' + snap.tabs.length + ')</div><div class="vex-tt-tabs">' + (tabsHtml || '<div class="vex-tt-empty">No tabs were recorded.</div>') + '</div>'
      + '<div class="vex-tt-actions"><button class="vex-tt-btn primary" id="vex-tt-reopen"' + (tabsGone ? '' : ' disabled') + '>' + this._icon('refresh') + ' Reopen these tabs' + (tabsGone ? ' (' + tabsGone + ')' : '') + '</button></div>'
      + (notesHtml ? '<div class="vex-tt-h">Notes edited since</div>' + notesHtml : '');
    host.querySelector('#vex-tt-reopen').addEventListener('click', async () => {
      try {
        const ok = await vexConfirm({ title: 'Reopen these tabs?', message: tabsGone + ' tab' + VexPlural.s(tabsGone) + ' from ' + new Date(got.ts).toLocaleString() + ' will open in new tabs. Nothing that is open now changes.', okLabel: 'Reopen' });
        if (!ok) return;
        const n = this.reopenTabs(snap);
        window.showToast?.('Reopened ' + n + ' tab' + VexPlural.s(n));
        this._close();
      } catch (err) { this._fail(err); }
    });
    host.querySelectorAll('[data-note]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        const id = btn.dataset.note;
        const v = await window.vex.journalNoteVersion(id, got.ts);
        if (!v) { await vexAlert({ title: 'No saved text', message: 'Vex did not keep the text of this note at that moment (note versions need Windows account encryption, and start when the journal does).' }); return; }
        const ok = await vexConfirm({ title: 'Restore this note version?', message: '"' + (v.title || 'Untitled') + '" goes back to how it was at ' + new Date(v.ts).toLocaleString() + '. What it holds now is saved as a version first, so you can undo this here.', okLabel: 'Restore' });
        if (!ok) return;
        await this.restoreNote(id, v);
        window.showToast?.('Note restored');
        await this._paint(got.ts);
      } catch (err) { this._fail(err); }
    }));
  },

  _wireSettings(body) {
    const fail = (err) => this._fail(err);
    body.querySelector('#vex-tt-days')?.addEventListener('change', (ev) => {
      window.vex.journalConfigure({ retentionDays: Number(ev.target.value) }).then(() => this._paint(null), fail);
    });
    body.querySelector('#vex-tt-on')?.addEventListener('change', (ev) => {
      window.vex.journalConfigure({ enabled: ev.target.checked }).then(() => this._paint(null), fail);
    });
    body.querySelector('#vex-tt-forget')?.addEventListener('click', async () => {
      try {
        const ok = await vexConfirm({ title: 'Forget the whole journal?', message: 'Every snapshot and every stored note version is deleted from this PC. Your notes, tabs and bookmarks are not touched.', okLabel: 'Forget everything', danger: true });
        if (!ok) return;
        await window.vex.journalForget();
        this._sent.clear(); this._lastSig = '';
        await this._paint(null);
      } catch (err) { fail(err); }
    });
  },

  _fail(err) {
    console.error('[time-travel]', err);
    window.VexProblems?.note('Time travel', 'Something went wrong', err);
    window.showToast?.('Time travel: ' + (err && err.message ? err.message : err), 'error');
  },
};

if (typeof window !== 'undefined') window.VexTimeTravel = VexTimeTravel;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTimeTravel };
