// === Weekly unified triage (T2-071) ===================================================
//
// Things pile up in three places that never look at each other: the read-later
// queue, the quick-capture clips and the downloads. Each has its own panel and
// none of them is opened weekly. This is ONE list over all three, oldest first,
// worked through with the keyboard:
//
//   j / k   (or the arrow keys)   next / previous
//   1       Keep     it stays where it is; it leaves this list
//   2       Note     a note is made from it (title and address, the clip text, or
//                    the file name and place); it leaves this list
//   3       Delete   read-later: removed (with Undo for a few seconds); clip:
//                    removed; download: the file goes to the Recycle Bin after
//                    you confirm once for this session
//
// What leaves the list is remembered (500 ids, local), so the list is a queue that
// shrinks, not a view that comes back. Bookmarks are not in it: a bookmark was
// kept on purpose, and a weekly sweep that deletes them is the wrong default.
//
// Two numbers for the Morning Brief (and so the New Tab page): "intake outpaces
// triage" (items that came in this week against items you triaged), and one line of
// tab debt (tabs open for over 7 days that you never went back to; only tabs Vex
// has a last-used time for are counted).
//
// Everything stays on this computer.

const VexTriage = {
  PREF: 'vex.triage.enabled',
  DONE: 'vex.triage.done',           // { [itemId]: ms } the 500 newest
  LOG: 'vex.triage.log',             // [ms] one per triaged item, the 300 newest
  MAX_DONE: 500,
  MAX_LOG: 300,
  DAYS_DOWNLOADS: 30,
  WEEK: 7 * 86400000,
  SOURCE: { 'read-later': 'Read later', clip: 'Clip', download: 'Download' },
  _confirmedDelete: false,

  enabled() { return VexPlanKit.flag(this.PREF); },
  setEnabled(on) { return VexPlanKit.setFlag(this.PREF, on); },

  // ---- pure ------------------------------------------------------------------------------
  // Oldest first; an item already triaged is not in it.
  rank(items, done = {}) {
    return (Array.isArray(items) ? items : []).filter(i => i && i.id && !done[i.id]).sort((a, b) => (a.at || 0) - (b.at || 0) || a.id.localeCompare(b.id));
  },
  // intake: items that arrived in the last week (all stores, triaged or not); triaged: log entries in the week.
  pressure(items, log, now = Date.now()) {
    const since = now - this.WEEK;
    const intake = (items || []).filter(i => i && i.at >= since).length;
    const triaged = (log || []).filter(t => t >= since).length;
    return { intake, triaged, outpaces: intake > triaged && intake - triaged >= 3 };
  },
  tabDebt(tabs, now = Date.now(), canPersist = () => true) {
    return (tabs || []).filter(t => t && !t.pinned && t.url && /^https?:/i.test(t.url) && Number.isFinite(t._lastActive) && now - t._lastActive > this.WEEK && canPersist(t)).length;
  },

  // ---- the stores -----------------------------------------------------------------------------
  _src() {
    return {
      readLater: () => (typeof ReadLater !== 'undefined' ? ReadLater.items : []),
      clips: async () => {
        if (!window.vex || typeof window.vex.clipsInboxList !== 'function') return [];
        const r = await window.vex.clipsInboxList();
        if (!r || !r.ok) throw new Error('the capture inbox did not answer');
        return r.items || [];
      },
      downloads: () => (typeof DownloadsPanel !== 'undefined' && Array.isArray(DownloadsPanel.downloads) ? DownloadsPanel.downloads : []),
    };
  },
  // -> { items (all, triaged or not), errors }
  async collect(now = Date.now(), src = this._src()) {
    const items = [];
    const errors = [];
    const guard = async (name, fn) => { try { await fn(); } catch (err) { errors.push(name + ': ' + ((err && err.message) || 'unavailable')); } };
    await guard('read later', async () => {
      for (const i of await src.readLater()) {
        if (!i || !i.url || i.read) continue;
        items.push({ id: 'rl:' + (i.id || i.url), source: 'read-later', text: VexPlanKit.line(i.title || i.url, 90), sub: i.url, at: Number(i.at) || 0, url: i.url, ref: i });
      }
    });
    await guard('clips', async () => {
      for (const c of await src.clips()) {
        if (!c || !c.id || !c.text) continue;
        items.push({ id: 'cp:' + c.id, source: 'clip', text: VexPlanKit.line(c.text, 90), sub: '', at: Number(c.at) || 0, full: String(c.text), ref: c });
      }
    });
    await guard('downloads', async () => {
      const since = now - this.DAYS_DOWNLOADS * 86400000;
      for (const d of await src.downloads()) {
        if (!d || d.state !== 'completed' || d.missing || d.ephemeral || !d.path) continue;
        const at = Date.parse(d.startedAt || '') || 0;
        if (at < since) continue;
        items.push({ id: 'dl:' + d.id, source: 'download', text: VexPlanKit.line(d.filename, 90), sub: d.path, at, ref: d });
      }
    });
    return { items, errors };
  },

  done() { const o = VexPlanKit.readJson(this.DONE, {}); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; },
  log() { const l = VexPlanKit.readJson(this.LOG, []); return Array.isArray(l) ? l : []; },
  _record(id, now) {
    const d = this.done();
    d[id] = now;
    const keep = Object.keys(d).sort((a, b) => d[b] - d[a]).slice(0, this.MAX_DONE);
    const nd = {}; for (const k of keep) nd[k] = d[k];
    VexPlanKit.writeJson(this.DONE, nd);
    VexPlanKit.writeJson(this.LOG, [...this.log(), now].slice(-this.MAX_LOG));
  },

  // ---- acting -----------------------------------------------------------------------------------------
  _makeNote(title, content) {
    if (typeof OpenTasks === 'undefined') throw new Error('Notes are not loaded');
    const notes = OpenTasks.notes();
    const now = new Date().toISOString();
    const note = { id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), title: VexPlanKit.line(title, 80), content, pinned: false, tags: ['triage'], sourceUrl: '', sourceTitle: '', createdAt: now, updatedAt: now };
    notes.unshift(note);
    OpenTasks.writeNotes(notes, note.id);
    return note;
  },
  // action: 'keep' | 'note' | 'delete'. -> true when the item left the list.
  async act(item, action, now = Date.now()) {
    if (!['keep', 'note', 'delete'].includes(action)) throw new Error('Triage is Keep, Note or Delete');
    if (action === 'note') {
      if (item.source === 'read-later') this._makeNote(item.text, item.text + '\n' + item.url);
      else if (item.source === 'clip') this._makeNote(item.full.slice(0, 60), item.full);
      else this._makeNote('Download: ' + item.text, 'File: ' + item.text + '\nIn: ' + item.sub);
    } else if (action === 'delete') {
      if (item.source === 'read-later') {
        if (typeof ReadLater === 'undefined') throw new Error('Read later is not loaded');
        const n = ReadLater.removeWithUndo(x => x === item.ref, () => 'Removed from read later', null);
        if (!n) throw new Error('That item is already gone');
      } else if (item.source === 'clip') {
        const r = await window.vex.clipsInboxRemove(item.ref.id);
        if (r && r.ok === false) throw new Error(r.error || 'The clip could not be removed');
      } else {
        if (typeof DownloadsPanel === 'undefined' || typeof DownloadsPanel._deleteFile !== 'function') throw new Error('Downloads are not loaded');
        if (!this._confirmedDelete) {
          const ok = await vexConfirm({ title: 'Move downloaded files to the Recycle Bin?', message: 'Deleting a download in this list sends the file to the Recycle Bin, where you can get it back. Asked once per triage.', okLabel: 'Go ahead', cancelLabel: 'Not now', danger: true });
          if (!ok) return false;
          this._confirmedDelete = true;
        }
        await DownloadsPanel._deleteFile(item.ref.id);
        if (!item.ref.missing) return false;          // you said no in the file's own question
      }
    }
    this._record(item.id, now);
    return true;
  },

  // ---- Morning Brief -----------------------------------------------------------------------------------------
  briefModule() {
    return {
      id: 'weekly-triage', title: 'Piling up', icon: 'list',
      isEnabled: () => this.enabled(),
      build: async () => {
        const now = Date.now();
        const { items } = await this.collect(now);
        const open = this.rank(items, this.done());
        const p = this.pressure(items, this.log(), now);
        let debt = 0;
        try { debt = typeof TabManager !== 'undefined' ? this.tabDebt(TabManager.tabs, now, t => !(window.VexTabPolicy && typeof window.VexTabPolicy.canPersist === 'function') || window.VexTabPolicy.canPersist(t)) : 0; }
        catch (err) { window.VexProblems?.note('Triage', 'Could not count old tabs', err); }
        const lines = [];
        if (open.length) lines.push({ text: open.length + (open.length === 1 ? ' item waits' : ' items wait') + ' in read later, clips and downloads', detail: p.outpaces ? 'Intake outpaces triage: ' + p.intake + ' came in this week, ' + p.triaged + ' sorted' : p.intake + ' came in this week, ' + p.triaged + ' sorted', actions: [{ label: 'Sort now', run: () => { this.open(); } }] });
        if (debt) lines.push({ text: debt + (debt === 1 ? ' tab' : ' tabs') + ' open for over a week and not visited since' });
        return lines.length ? { lines } : null;
      },
    };
  },

  // ---- the list -----------------------------------------------------------------------------------------------------
  async open() {
    if (!this.enabled()) { window.showToast?.('Weekly triage is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('weekly-triage');
    const { overlay, body } = VexSettingsGroups.dialog({ id: 'vex-triage', title: 'Weekly triage', sub: 'j / k move · 1 Keep · 2 Note · 3 Delete. Oldest first.' });
    let col;
    try { col = await this.collect(); } catch (err) { body.appendChild(VexSettingsGroups.note('Could not read your stores: ' + err.message)); return; }
    const st = { list: this.rank(col.items, this.done()), at: 0 };
    const draw = () => {
      body.textContent = '';
      if (!st.list.length) body.appendChild(VexSettingsGroups.note('Nothing is waiting. Read later, clips and downloads are sorted.'));
      st.at = Math.min(st.at, Math.max(0, st.list.length - 1));
      const list = document.createElement('div'); list.className = 'vexsr-list'; list.setAttribute('role', 'listbox');
      st.list.slice(0, 60).forEach((it, i) => {
        const { row } = VexPlanKit.listRow(this.SOURCE[it.source], it.text + (it.sub && it.source !== 'clip' ? '  (' + VexPlanKit.line(it.sub, 50) + ')' : ''));
        row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(i === st.at));
        if (i === st.at) row.style.outline = '2px solid var(--primary)';
        row.addEventListener('click', () => { st.at = i; draw(); });
        list.appendChild(row);
      });
      body.appendChild(list);
      if (st.list.length) {
        const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;margin-top:8px';
        for (const [key, label, action] of [['1', 'Keep', 'keep'], ['2', 'Note', 'note'], ['3', 'Delete', 'delete']]) bar.appendChild(VexSettingsGroups.button(key + '  ' + label, () => decide(action), { danger: action === 'delete', label }));
        body.appendChild(bar);
      }
      if (col.errors.length) body.appendChild(VexSettingsGroups.note('Could not read: ' + col.errors.join('; ')));
    };
    const decide = async (action) => {
      const it = st.list[st.at];
      if (!it) return;
      try { if (await this.act(it, action)) st.list.splice(st.at, 1); }
      catch (err) { window.showToast?.(err.message, 'error'); }
      draw();
    };
    const onKey = (e) => {
      if (!overlay.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (document.querySelector('.vex-dialog-overlay') || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
      const k = e.key;
      if (k === 'j' || k === 'ArrowDown') { st.at = Math.min(st.list.length - 1, st.at + 1); }
      else if (k === 'k' || k === 'ArrowUp') { st.at = Math.max(0, st.at - 1); }
      else if (k === '1') { decide('keep'); return; } else if (k === '2') { decide('note'); return; } else if (k === '3') { decide('delete'); return; }
      else return;
      e.preventDefault(); draw();
    };
    document.addEventListener('keydown', onKey, true);
    draw();
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('One list over read later, clips and downloads, oldest first, worked with j / k and 1 Keep, 2 Note, 3 Delete. The Morning Brief says when intake outpaces triage and how many tabs have sat for over a week. Ctrl+K › Weekly triage.'));
    el.appendChild(VexSettingsGroups.button('Open the triage list', () => { this.open().catch(err => window.showToast?.(err.message, 'error')); }, { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexTriage = VexTriage;
  window.VexBriefModules = window.VexBriefModules || [];
  window.VexBriefModules.push(VexTriage.briefModule());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'weekly-triage', title: 'Weekly triage', keywords: 'triage weekly read later clips downloads keep note delete tab debt', before: 'about', build: (el) => VexTriage.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'weekly-triage', label: 'Weekly triage', hint: 'Read later, clips and downloads in one list: keep, note or delete', icon: 'list', action: () => { VexTriage.open().catch(err => window.showToast?.(err.message, 'error')); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTriage };
