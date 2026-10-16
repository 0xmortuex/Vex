// === Exam-day pack and exam safe mode ==========================================
//
// The night before: one card per exam with the entry document, the hall address, when to
// leave and a checklist you tick; "Open its pages" opens the tabs you listed, and "Keep
// offline copies" makes the listed pages available without a connection (the archive
// library, js/offline-pages.js).
//
// Exam safe mode is one switch for the time of the exam. While it is on:
//   * everything is quiet: it is a source of AttentionState ('exam'), so toasts, badges,
//     Vex's own pings and the OS notifications of the main process all wait;
//   * Vex does not check for updates and does not sync by itself (a sync owed is made
//     when the mode ends); an update already downloaded is never installed by it;
//   * no tab goes to sleep (a page you hold open for an online exam stays loaded);
//   * for an ONLINE exam, accidental Ctrl+W, Ctrl+R, F5 and Ctrl+Shift+R are stopped and a
//     bar says "Exam in progress - do not close".
// It always has a way out: the bar's "End exam mode" button (after a confirmation), and it
// ends by itself at the time you gave. It does nothing to hide anything from an exam's
// proctoring software and does not claim to; it only keeps Vex out of the way.
//
//   VexExamSafeMode.active() / until() / holds('sync'|'updates')    asked by the hooks
const VexExamSafeMode = {
  KEY: 'vex.examMode',            // { packs: [...], active: { packId, startedAt, until, online } | null }
  PREF: 'vex.examMode.enabled',
  MAX_PACKS: 20,
  MAX_PAGES: 12,
  MAX_CHECKS: 30,
  BLOCKED_KEYS: ['w', 'r', 'F5'], // with Ctrl; the last needs no modifier
  _bar: null,
  _keyHandler: null,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    localStorage.setItem(this.PREF, on ? 'on' : 'off');
    if (!on && this.active()) this.deactivate('switched-off');
  },

  // ---- store ---------------------------------------------------------------------
  _read() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); } catch (err) { throw new Error('The exam packs could not be read: ' + err.message); }
    const d = { packs: [], active: null };
    if (!raw) return d;
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The saved exam packs are damaged: ' + err.message); }
    if (o && Array.isArray(o.packs)) d.packs = o.packs.filter(p => p && typeof p.id === 'string' && typeof p.title === 'string').slice(0, this.MAX_PACKS);
    if (o && o.active && typeof o.active === 'object' && Number.isFinite(o.active.until)) d.active = o.active;
    return d;
  },
  _write(d) {
    try { localStorage.setItem(this.KEY, JSON.stringify(d)); }
    catch (err) { throw new Error('The exam packs could not be saved: ' + err.message, { cause: err }); }
  },
  packs() { return this._read().packs; },
  pack(id) { return this.packs().find(p => p.id === id) || null; },

  // ---- pure -----------------------------------------------------------------------
  cleanPack(f) {
    const title = String((f && f.title) || '').trim();
    if (!title) throw new Error('Give the pack a title');
    const pages = (Array.isArray(f.pages) ? f.pages : String(f.pages || '').split(/\s+/)).map(s => String(s).trim()).filter(Boolean);
    if (pages.length > this.MAX_PAGES) throw new Error('At most ' + this.MAX_PAGES + ' pages');
    for (const u of pages) { let p; try { p = new URL(u); } catch { throw new Error('"' + u + '" is not a web address'); } if (!/^https?:$/.test(p.protocol)) throw new Error('"' + u + '" must start with http:// or https://'); }
    const checklist = (Array.isArray(f.checklist) ? f.checklist : String(f.checklist || '').split('\n')).map(c => typeof c === 'string' ? { text: c.trim(), done: false } : { text: String(c.text || '').trim(), done: !!c.done }).filter(c => c.text);
    if (checklist.length > this.MAX_CHECKS) throw new Error('At most ' + this.MAX_CHECKS + ' checklist lines');
    const leaveAt = f.leaveAt == null || f.leaveAt === '' ? null : Number(f.leaveAt);
    if (leaveAt != null && !Number.isFinite(leaveAt)) throw new Error('The leave time is not a time');
    return { title: title.slice(0, 100), entryDoc: String(f.entryDoc || '').trim().slice(0, 200), hall: String(f.hall || '').trim().slice(0, 300), leaveAt, pages, checklist, online: f.online === true, minutes: Math.min(600, Math.max(15, Math.round(Number(f.minutes) || 120))) };
  },
  // The text of the night-before card.
  cardText(pack, now = Date.now()) {
    const lines = [pack.title];
    if (pack.leaveAt) lines.push('Leave at: ' + new Date(pack.leaveAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + (pack.leaveAt < now ? ' (passed)' : ''));
    if (pack.hall) lines.push('Where: ' + pack.hall);
    if (pack.entryDoc) lines.push('Bring: ' + pack.entryDoc);
    for (const c of pack.checklist) lines.push((c.done ? '[x] ' : '[ ] ') + c.text);
    return lines.join('\n');
  },
  progress(pack) { return { done: pack.checklist.filter(c => c.done).length, total: pack.checklist.length }; },

  addPack(fields) {
    const d = this._read();
    if (d.packs.length >= this.MAX_PACKS) throw new Error('At most ' + this.MAX_PACKS + ' packs');
    const p = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), ...this.cleanPack(fields) };
    d.packs.push(p);
    this._write(d);
    return p;
  },
  removePack(id) {
    const d = this._read();
    if (d.active && d.active.packId === id) throw new Error('This pack is in use: end exam mode first');
    d.packs = d.packs.filter(p => p.id !== id);
    this._write(d);
  },
  tick(id, index, done) {
    const d = this._read();
    const p = d.packs.find(x => x.id === id);
    if (!p || !p.checklist[index]) throw new Error('That checklist line is gone');
    p.checklist[index].done = !!done;
    this._write(d);
    return p;
  },

  // ---- the switch ------------------------------------------------------------------
  // The state, ended by itself when its time is up.
  // Asked for every tab on every redraw, so the answer is kept for a second.
  _active(now = Date.now()) {
    if (this._c && now - this._c.t < 1000) return this._c.v;
    let v = null;
    if (this.enabled()) {
      const d = this._read();
      if (d.active) { if (d.active.until <= now) { this._c = null; this.deactivate('time'); } else v = d.active; }
    }
    this._c = { t: now, v };
    return v;
  },
  active() { return !!this._active(); },
  until() { const a = this._active(); return a ? a.until : 0; },
  // kind: 'sync' | 'updates'
  holds(kind) { return this.active() && (kind === 'sync' || kind === 'updates'); },

  activate(packId, now = Date.now()) {
    if (!this.enabled()) throw new Error('Exam safe mode is switched off in Settings');
    const d = this._read();
    if (d.active && d.active.until > now) throw new Error('Exam safe mode is already on');
    const p = packId ? d.packs.find(x => x.id === packId) : null;
    if (packId && !p) throw new Error('That pack is gone');
    const minutes = p ? p.minutes : 120;
    d.active = { packId: packId || '', startedAt: now, until: now + minutes * 60000, online: !!(p && p.online) };
    this._write(d);
    this._c = null;
    this._apply(d.active);
    return d.active;
  },
  deactivate(how = 'ended') {
    const d = this._read();
    if (!d.active) return false;
    d.active = null;
    this._write(d);
    this._c = null;
    this._unapply(how);
    return true;
  },

  _apply(a) {
    this._keys(a.online);
    this._showBar(a);
    this._notify(true);
  },
  _unapply() {
    this._keys(false);
    this._bar?.remove(); this._bar = null;
    this._notify(false);
    // A sync owed while the mode held it is made now.
    try { if (window.SyncEngine && typeof SyncEngine.resumeAfterGame === 'function') SyncEngine.resumeAfterGame(); } catch (err) { console.error('[ExamMode] could not catch up the sync:', err); }
  },
  _notify(on) {
    try { document.dispatchEvent(new CustomEvent('vex:exam-mode', { detail: { on } })); } catch (err) { console.error('[ExamMode] event failed:', err); }
    if (typeof AttentionState !== 'undefined') AttentionState.changed();
  },

  // Stops the accidental close/reload keys while an online exam is open.
  _keys(on) {
    if (this._keyHandler) { document.removeEventListener('keydown', this._keyHandler, true); this._keyHandler = null; }
    if (!on) return;
    this._keyHandler = (e) => {
      const k = e.key;
      const hit = (e.ctrlKey || e.metaKey) && (String(k).toLowerCase() === 'w' || String(k).toLowerCase() === 'r') || k === 'F5';
      if (!hit) return;
      e.preventDefault(); e.stopPropagation();
      window.showToast?.('Exam in progress: close and reload are off. End exam mode from the bar if you need them.');
    };
    document.addEventListener('keydown', this._keyHandler, true);
  },

  _showBar(a) {
    this._bar?.remove();
    const bar = document.createElement('div');
    bar.id = 'vex-exam-bar';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99990;display:flex;gap:12px;align-items:center;padding:8px 14px;border-radius:10px;background:var(--surface, #222);color:var(--text, #eee);border:1px solid var(--border, #555);box-shadow:0 4px 18px var(--vex-shadow-color, rgba(0,0,0,.4));font-size:13px';
    const t = document.createElement('span');
    t.textContent = (a.online ? 'Exam in progress - do not close. ' : 'Exam mode. ') + 'Quiet until ' + new Date(a.until).toTimeString().slice(0, 5) + '.';
    const end = document.createElement('button');
    end.type = 'button'; end.className = 'btn-secondary'; end.textContent = 'End exam mode';
    end.addEventListener('click', async () => {
      if (await window.vexConfirm({ title: 'End exam mode?', message: 'Notifications, update checks and sync come back.', okLabel: 'End it' })) this.deactivate('ended');
    });
    bar.append(t, end);
    document.body.appendChild(bar);
    this._bar = bar;
  },

  // Called once at start: a mode that was on when Vex closed is picked up again (or ended if its time is over).
  init() {
    if (this._wired) return;
    this._wired = true;
    const a = this._active();
    if (a) this._apply(a);
  },

  // ---- pages -------------------------------------------------------------------------
  openPages(id) {
    const p = this.pack(id);
    if (!p) throw new Error('That pack is gone');
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    if (!p.pages.length) throw new Error('This pack lists no pages');
    for (const u of p.pages) TabManager.createTab(u, false);
    return p.pages.length;
  },
  offlineStatus(id) {
    const p = this.pack(id);
    if (!p) throw new Error('That pack is gone');
    if (typeof VexOfflinePages === 'undefined') throw new Error('Offline pages are not available');
    return p.pages.map(u => ({ url: u, offline: VexOfflinePages.isOffline(u) }));
  },
  // Opens each missing page, keeps a copy of it, and closes the tab again.
  async keepOffline(id, onStep) {
    const todo = this.offlineStatus(id).filter(x => !x.offline);
    let kept = 0;
    for (const item of todo) {
      if (onStep) onStep(item.url);
      const made = TabManager.createTab(item.url, true);
      const tab = made && typeof made === 'object' ? made : TabManager.tabs.find(t => t.id === made);
      if (!tab) throw new Error('Could not open ' + item.url);
      try {
        const wv = await this._loaded(tab.id);
        if (!wv) throw new Error('The page did not finish loading: ' + item.url);
        await VexOfflinePages.markActive();
        kept++;
      } finally { TabManager.closeTab(tab.id); }
    }
    return kept;
  },
  _loaded(tabId, timeoutMs = 30000) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const look = () => {
        const wv = WebviewManager.webviews.get(tabId);
        if (wv && typeof wv.isLoading === 'function' && !wv.isLoading() && Date.now() - t0 > 1500) return resolve(wv);
        if (Date.now() - t0 > timeoutMs) return resolve(null);
        setTimeout(look, 500);
      };
      look();
    });
  },

  // ---- screen ---------------------------------------------------------------------------
  open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('exam-safe-mode');
    const G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-exam-packs', title: 'Exam-day pack', sub: 'The night-before card, and one switch that keeps Vex quiet during the exam. It does not hide anything from an exam\'s proctoring.' });
    const draw = () => {
      body.textContent = '';
      const live = this._active();
      if (live) {
        body.appendChild(G.note('Exam mode is ON until ' + new Date(live.until).toTimeString().slice(0, 5) + '.'));
        body.appendChild(G.button('End exam mode', async () => { if (await window.vexConfirm({ title: 'End exam mode?', message: 'Notifications, update checks and sync come back.', okLabel: 'End it' })) { this.deactivate('ended'); draw(); } }, { danger: true }));
      } else {
        body.appendChild(G.button('Turn exam mode on (no pack)', () => { try { this.activate(null); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
      }
      body.appendChild(G.button('New pack', async () => { try { await this._newDialog(); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { primary: true }));
      for (const p of this.packs()) {
        const box = document.createElement('div');
        box.className = 'vexsr-rule';
        box.style.cssText = 'display:block;margin:12px 0';
        const h = document.createElement('div');
        const pr = this.progress(p);
        h.textContent = p.title + (pr.total ? ' (' + pr.done + '/' + pr.total + ')' : '') + (p.online ? ' - online exam' : '');
        box.appendChild(h);
        const info = [p.leaveAt ? 'Leave ' + new Date(p.leaveAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '', p.hall, p.entryDoc ? 'Bring: ' + p.entryDoc : ''].filter(Boolean).join(' | ');
        if (info) box.appendChild(G.note(info));
        p.checklist.forEach((c, i) => {
          const l = document.createElement('label');
          l.style.cssText = 'display:flex;gap:8px;align-items:center;margin:3px 0';
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = c.done;
          cb.addEventListener('change', () => { try { this.tick(p.id, i, cb.checked); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } });
          l.append(cb, document.createTextNode(c.text));
          box.appendChild(l);
        });
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:6px';
        row.append(
          G.button('Open its pages', () => { try { window.showToast?.(this.openPages(p.id) + ' tabs opened'); } catch (err) { window.showToast?.(err.message, 'error'); } }),
          G.button('Keep offline copies', async () => {
            try { const n = await this.keepOffline(p.id, (u) => window.showToast?.('Keeping ' + u)); window.showToast?.(n + ' page(s) kept offline'); } catch (err) { window.showToast?.(err.message, 'error'); }
          }),
          G.button('Copy the card', async () => { try { await navigator.clipboard.writeText(this.cardText(p)); window.showToast?.('Copied'); } catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); } }),
          G.button(live ? 'Exam mode is on' : 'Start exam mode with this pack', () => { try { this.activate(p.id); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { primary: !live }),
          G.button('Remove', async () => { if (await window.vexConfirm({ title: 'Remove the pack?', message: p.title, okLabel: 'Remove', danger: true })) { try { this.removePack(p.id); } catch (err) { window.showToast?.(err.message, 'error'); } draw(); } }, { danger: true }),
        );
        box.appendChild(row);
        body.appendChild(box);
      }
    };
    draw();
  },

  async _newDialog() {
    const P = (o) => window.vexPrompt(o);
    const title = await P({ title: 'Exam-day pack', label: 'Exam', placeholder: 'Physics midterm', okLabel: 'Next' });
    if (title == null) return;
    const entryDoc = await P({ title: 'Entry document', message: 'What you must bring (ID, exam card ...).', label: 'Bring', okLabel: 'Next' });
    if (entryDoc == null) return;
    const hall = await P({ title: 'Hall and address', label: 'Where', okLabel: 'Next' });
    if (hall == null) return;
    const leave = await P({ title: 'When to leave', message: 'For example 2026-12-18 07:30, or in Turkish "yarın sabah 7:30". Leave empty to skip.', label: 'Leave at', okLabel: 'Next' });
    if (leave == null) return;
    let leaveAt = null;
    if (leave.trim()) {
      const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(leave.trim());
      if (iso) leaveAt = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4]), Number(iso[5])).getTime();
      else if (typeof VexTrParse !== 'undefined') { const r = VexTrParse.parse(leave); if (!r) throw new Error('Could not read that time'); leaveAt = r.at; }
      else throw new Error('Write the time as YYYY-MM-DD HH:MM');
    }
    const pages = await P({ title: 'Pages to open', message: 'Web addresses, one per line (the exam site, the syllabus...).', multiline: true, label: 'Pages', okLabel: 'Next' });
    if (pages == null) return;
    const checklist = await P({ title: 'Checklist', message: 'One line each: calculator, water, charger ...', multiline: true, label: 'Checklist', value: 'ID and exam card\nPens\nCalculator (if allowed)\nWater\nCharger', okLabel: 'Next' });
    if (checklist == null) return;
    const online = await window.vexConfirm({ title: 'Is it an online exam?', message: 'Online: accidental close and reload keys are stopped and a bar says "do not close".', okLabel: 'Online', cancelLabel: 'In a hall' });
    const mins = await P({ title: 'How long should exam mode last?', message: 'Minutes. It ends by itself.', label: 'Minutes', value: '120', okLabel: 'Save' });
    if (mins == null) return;
    this.addPack({ title, entryDoc, hall, leaveAt, pages: pages.split('\n'), checklist: checklist.split('\n'), online, minutes: Number(mins) });
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Before an exam: a card with what to bring and when to leave, your pages in tabs, offline copies. During it: one switch that keeps Vex quiet, with no update checks or sync. It never hides anything from an exam\'s proctoring.'));
    el.appendChild(G.button('Exam-day pack and exam mode', () => this.open(), { primary: true }));
    if (this.active()) el.appendChild(G.note('Exam mode is on until ' + new Date(this.until()).toTimeString().slice(0, 5) + '.'));
  },
};

if (typeof window !== 'undefined') {
  window.VexExamSafeMode = VexExamSafeMode;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'exam-safe-mode', title: 'Exam-day pack', keywords: 'exam day pack safe mode quiet checklist offline online do not close', build: (el) => VexExamSafeMode.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'exam-pack', label: 'Exam-Day Pack and Exam Mode', hint: 'The night-before card and one quiet switch for the exam', icon: 'graduation', action: () => VexExamSafeMode.open() });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexExamSafeMode.init());
    else VexExamSafeMode.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexExamSafeMode };
