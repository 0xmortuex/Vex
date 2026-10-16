// === Archive idle workspaces and prune snapshots (T3-096) =====================
//
// A workspace nobody has opened for a month is clutter in the switcher, and every workspace keeps
// up to 25 time-travel snapshots (js/workspace-snapshots.js). This does two small things, both only
// when you say so, both with a way back:
//
//   Archive      collapses an idle workspace (30+ days since it was last in front) into a card. The
//                workspace, its saved tabs and its snapshots are kept whole in the card; Restore
//                puts all of it back. Never the workspace in front, never the last one.
//   Prune        drops snapshots older than 7 days, always keeping each workspace's newest one.
//                The dropped ones are kept for one Undo (the ledger) until the next prune.
//
// Once a day a background check adds ONE row to the Attention Inbox when something is idle; it never
// archives by itself. "Idle" is measured from vex.workspaceArchive.active, which this file keeps: a
// workspace first seen today counts as active today, so nothing is archived on the strength of a
// date Vex never recorded.
//
//   VexWorkspaceArchive.idle(now)          -> [{ id, name, tabs, idleDays }]
//   VexWorkspaceArchive.archive(id)        -> the card
//   VexWorkspaceArchive.restore(cardId)
//   VexWorkspaceArchive.pruneCandidates(now) -> { count, workspaces }
//   VexWorkspaceArchive.prune(now)         -> { removed }

const VexWorkspaceArchive = {
  ACTIVE_KEY: 'vex.workspaceArchive.active',     // { wsId: last time it was in front }
  CARDS_KEY: 'vex.workspaceArchive.cards',
  PRUNED_KEY: 'vex.workspaceArchive.pruned',     // the snapshots of the last prune, for one undo
  PREF: 'vex.workspaceArchive.enabled',
  FEATURE: 'workspace-archive',
  IDLE_DAYS: 30,
  KEEP_SNAPSHOT_DAYS: 7,
  MAX_CARDS: 20,
  PRUNED_MAX_BYTES: 400 * 1024,
  DAY: 24 * 3600 * 1000,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },
  _now() { return Date.now(); },

  _json(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('"' + key + '" is not readable: ' + err.message); }
    return v == null ? fallback : v;
  },
  _put(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (err) { throw new Error('Could not save "' + key + '": ' + err.message); }
  },

  _wm() { if (typeof WorkspaceManager === 'undefined') throw new Error('Workspaces are not loaded'); return WorkspaceManager; },
  _snaps() { if (typeof WorkspaceSnapshots === 'undefined') throw new Error('Workspace snapshots are not loaded'); return WorkspaceSnapshots; },

  // ---- when each workspace was last in front -----------------------------------
  active() { const v = this._json(this.ACTIVE_KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; },
  touch(wsId, now = this._now()) {
    if (!wsId) return;
    const a = this.active();
    a[wsId] = now;
    this._put(this.ACTIVE_KEY, a);
  },
  // First sight of every workspace counts as "today"; the one in front is touched.
  seed(now = this._now()) {
    const wm = this._wm();
    const a = this.active();
    let changed = false;
    for (const w of wm.workspaces) if (!(w.id in a)) { a[w.id] = now; changed = true; }
    if (wm.activeId) { a[wm.activeId] = now; changed = true; }
    for (const id of Object.keys(a)) if (!wm.workspaces.some(w => w.id === id) && !this.cards().some(c => c.ws && c.ws.id === id)) { delete a[id]; changed = true; }
    if (changed) this._put(this.ACTIVE_KEY, a);
    return a;
  },

  // ---- idle ------------------------------------------------------------------------
  idle(now = this._now()) {
    const wm = this._wm();
    const a = this.active();
    if (wm.workspaces.length <= 1) return [];
    return wm.workspaces
      .filter(w => w.id !== wm.activeId && typeof a[w.id] === 'number' && now - a[w.id] >= this.IDLE_DAYS * this.DAY)
      .map(w => ({ id: w.id, name: w.name, tabs: Array.isArray(w.tabs) ? w.tabs.length : 0, idleDays: Math.floor((now - a[w.id]) / this.DAY) }));
  },

  // ---- cards -------------------------------------------------------------------------
  cards() { const v = this._json(this.CARDS_KEY, []); return Array.isArray(v) ? v.filter(c => c && c.id && c.ws && c.ws.id) : []; },

  archive(wsId, now = this._now()) {
    const wm = this._wm();
    const ws = wm.workspaces.find(w => w.id === wsId);
    if (!ws) throw new Error('That workspace is gone');
    if (wm.workspaces.length <= 1) throw new Error('The last workspace cannot be archived');
    if (wsId === wm.activeId) throw new Error('The workspace in front cannot be archived: switch to another first');
    const cards = this.cards();
    if (cards.length >= this.MAX_CARDS) throw new Error('There are already ' + this.MAX_CARDS + ' archived workspaces: restore or delete one first');
    const snapStore = this._snaps();
    const all = snapStore._all();
    const snapshots = Array.isArray(all[wsId]) ? all[wsId] : [];
    const card = { id: 'wa_' + now.toString(36) + Math.random().toString(36).slice(2, 6), at: now, ws: JSON.parse(JSON.stringify(ws)), index: wm.workspaces.indexOf(ws), snapshots };
    // The card is written first: if that fails nothing has been taken out of the switcher.
    this._put(this.CARDS_KEY, [card, ...cards]);
    wm.workspaces = wm.workspaces.filter(w => w.id !== wsId);
    wm.save();
    wm.render();
    if (snapshots.length) { delete all[wsId]; snapStore._save(all); }
    if (typeof VexLedger !== 'undefined') VexLedger.note({ feature: this.FEATURE, what: 'Archived the workspace "' + ws.name + '"', why: 'You asked: it had not been in front for ' + Math.floor((now - (this.active()[wsId] || now)) / this.DAY) + ' days', undo: { kind: 'workspace-unarchive', id: card.id } });
    return card;
  },

  restore(cardId) {
    const wm = this._wm();
    const cards = this.cards();
    const card = cards.find(c => c.id === cardId);
    if (!card) throw new Error('That archived workspace is gone');
    if (wm.workspaces.some(w => w.id === card.ws.id)) throw new Error('A workspace with that identity is already there');
    const at = Math.max(0, Math.min(card.index, wm.workspaces.length));
    wm.workspaces.splice(at, 0, card.ws);
    wm.save();
    wm.render();
    if (Array.isArray(card.snapshots) && card.snapshots.length) {
      const snapStore = this._snaps();
      const all = snapStore._all();
      all[card.ws.id] = card.snapshots;
      snapStore._save(all);
    }
    this._put(this.CARDS_KEY, cards.filter(c => c.id !== cardId));
    this.touch(card.ws.id);
    return card.ws;
  },

  removeCard(cardId) {
    const cards = this.cards();
    if (!cards.some(c => c.id === cardId)) throw new Error('That archived workspace is gone');
    this._put(this.CARDS_KEY, cards.filter(c => c.id !== cardId));
  },

  // ---- snapshots ------------------------------------------------------------------------
  pruneCandidates(now = this._now()) {
    const all = this._snaps()._all();
    const cutoff = now - this.KEEP_SNAPSHOT_DAYS * this.DAY;
    const drop = {};
    let count = 0;
    for (const [wsId, list] of Object.entries(all)) {
      if (!Array.isArray(list) || list.length < 2) continue;
      // The list is newest first: the first one is always kept.
      const old = list.slice(1).filter(s => s && typeof s.ts === 'number' && s.ts < cutoff);
      if (old.length) { drop[wsId] = old; count += old.length; }
    }
    return { count, workspaces: Object.keys(drop).length, drop };
  },

  prune(now = this._now()) {
    const snapStore = this._snaps();
    const c = this.pruneCandidates(now);
    if (!c.count) return { removed: 0 };
    const kept = JSON.stringify(c.drop);
    if (kept.length > this.PRUNED_MAX_BYTES) throw new Error('Too many old snapshots to keep for an undo (' + Math.round(kept.length / 1024) + ' KB). Nothing was removed.');
    // The undo copy is written first.
    this._put(this.PRUNED_KEY, { at: now, drop: c.drop });
    const all = snapStore._all();
    for (const [wsId, old] of Object.entries(c.drop)) {
      const ts = new Set(old.map(s => s.ts));
      all[wsId] = (all[wsId] || []).filter(s => !ts.has(s.ts));
    }
    snapStore._save(all);
    if (typeof VexLedger !== 'undefined') VexLedger.note({ feature: this.FEATURE, what: 'Removed ' + c.count + ' old workspace snapshot' + (c.count === 1 ? '' : 's'), why: 'You asked to keep only the last ' + this.KEEP_SNAPSHOT_DAYS + ' days (the newest of each workspace stays)', undo: { kind: 'snapshots-unprune', at: now } });
    return { removed: c.count };
  },

  unprune(at) {
    const snapStore = this._snaps();
    const saved = this._json(this.PRUNED_KEY, null);
    if (!saved || saved.at !== at) throw new Error('The removed snapshots are no longer kept: only the latest prune can be undone');
    const all = snapStore._all();
    for (const [wsId, old] of Object.entries(saved.drop || {})) {
      const have = new Set((all[wsId] || []).map(s => s.ts));
      all[wsId] = [...(all[wsId] || []), ...old.filter(s => !have.has(s.ts))].sort((a, b) => b.ts - a.ts).slice(0, snapStore.MAX);
    }
    snapStore._save(all);
    try { localStorage.removeItem(this.PRUNED_KEY); } catch (err) { throw new Error('Restored, but could not clear the undo copy: ' + err.message); }
  },

  // ---- the daily look ------------------------------------------------------------------------
  check() {
    if (!this.enabled()) return 0;
    const idle = this.idle();
    const prune = this.pruneCandidates();
    if (!idle.length && prune.count < 10) return 0;
    if (typeof VexAttention === 'undefined') throw new Error('The attention budget is not loaded');
    const parts = [];
    if (idle.length) parts.push(idle.length + ' workspace' + (idle.length === 1 ? ' has' : 's have') + ' not been opened for ' + this.IDLE_DAYS + '+ days (' + idle.map(i => i.name).slice(0, 3).join(', ') + ')');
    if (prune.count >= 10) parts.push(prune.count + ' old snapshots could go');
    VexAttention.suggest({ feature: this.FEATURE, id: 'idle', label: 'Idle workspaces', title: 'Tidy your workspaces?', body: parts.join('; ') + '. Nothing is removed until you say so.', action: { label: 'Look', key: 'open' } });
    return idle.length + prune.count;
  },

  // ---- window ---------------------------------------------------------------------------------
  open() {
    const { body } = VexSettingsGroups.dialog({ id: 'vex-ws-archive', title: 'Idle workspaces', sub: 'Workspaces not in front for ' + this.IDLE_DAYS + '+ days become cards you can restore; old snapshots can be pruned. Both can be undone.' });
    const draw = () => {
      body.textContent = '';
      let idle, cards, prune;
      try { this.seed(); idle = this.idle(); cards = this.cards(); prune = this.pruneCandidates(); }
      catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      const row = (text, buttons) => {
        const r = document.createElement('div');
        r.className = 'vexsr-rule';
        const s = document.createElement('span');
        s.className = 'vexsr-host';
        s.style.wordBreak = 'normal';
        s.textContent = text;
        r.append(s, ...buttons);
        body.appendChild(r);
      };
      if (!idle.length) body.appendChild(VexSettingsGroups.note('No workspace has been idle for ' + this.IDLE_DAYS + ' days.'));
      for (const i of idle) {
        row(i.name + ' (' + i.tabs + ' tab' + (i.tabs === 1 ? '' : 's') + ', idle ' + i.idleDays + ' days)', [VexSettingsGroups.button('Archive', async () => {
          const ok = await window.vexConfirm({ title: 'Archive "' + i.name + '"?', message: 'It leaves the switcher and becomes a card here. Its tabs and snapshots are kept; Restore puts everything back.', okLabel: 'Archive' });
          if (!ok) return;
          try { this.archive(i.id); window.showToast?.('Archived ' + i.name); } catch (err) { window.showToast?.(err.message, 'error'); }
          draw();
        }, { label: 'Archive ' + i.name })]);
      }
      if (cards.length) body.appendChild(VexSettingsGroups.note('Archived'));
      for (const c of cards) {
        row(c.ws.name + ' (archived ' + new Date(c.at).toLocaleDateString() + ', ' + ((c.ws.tabs || []).length) + ' tabs)', [
          VexSettingsGroups.button('Restore', () => { try { this.restore(c.id); window.showToast?.('Restored ' + c.ws.name); } catch (err) { window.showToast?.(err.message, 'error'); } draw(); }, { label: 'Restore ' + c.ws.name }),
          VexSettingsGroups.button('Delete', async () => {
            const ok = await window.vexConfirm({ title: 'Delete the archived "' + c.ws.name + '"?', message: 'Its saved tabs and snapshots are gone for good.', okLabel: 'Delete' });
            if (!ok) return;
            try { this.removeCard(c.id); } catch (err) { window.showToast?.(err.message, 'error'); }
            draw();
          }, { danger: true, label: 'Delete ' + c.ws.name }),
        ]);
      }
      body.appendChild(VexSettingsGroups.note('Snapshots: ' + prune.count + ' older than ' + this.KEEP_SNAPSHOT_DAYS + ' days in ' + prune.workspaces + ' workspace' + (prune.workspaces === 1 ? '' : 's') + ' (the newest of each stays).'));
      if (prune.count) {
        body.appendChild(VexSettingsGroups.button('Prune ' + prune.count + ' snapshots', async () => {
          const ok = await window.vexConfirm({ title: 'Prune old snapshots?', message: prune.count + ' snapshots older than ' + this.KEEP_SNAPSHOT_DAYS + ' days go. The newest of each workspace stays, and the removal can be undone from "Why did that happen?".', okLabel: 'Prune' });
          if (!ok) return;
          try { const r = this.prune(); window.showToast?.('Removed ' + r.removed + ' snapshots'); } catch (err) { window.showToast?.(err.message, 'error'); }
          draw();
        }, { danger: true }));
      }
    };
    draw();
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('workspace-unarchive', async (token) => { this.restore(token.id); });
      VexLedger.registerUndo('snapshots-unprune', async (token) => { this.unprune(token.at); });
    }
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle(this.FEATURE, (key) => { if (key === 'open') this.open(); });
    if (typeof WorkspaceManager !== 'undefined') this.seed();
    document.addEventListener('vex:workspace-switched', (e) => {
      try { this.touch(e.detail && e.detail.id); this.touch(this._wm().activeId); }
      catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Workspace archive', 'Could not note a workspace switch', err); else throw err; }
    });
    if (typeof VexJobs !== 'undefined') {
      VexJobs.every('Workspace archive check', this.DAY, () => {
        try { this.check(); } catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Workspace archive', 'The daily look failed', err); else throw err; }
      }, { when: 'background', feature: 'workspace-archive' });
    }
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Workspaces you have not opened for 30 days can be archived into a card (and restored), and snapshots older than 7 days can be pruned. Nothing happens by itself: Vex only adds a row to the Attention Inbox. Ctrl+K › Tidy workspaces.'));
    el.appendChild(VexSettingsGroups.button('Look at my workspaces', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexWorkspaceArchive = VexWorkspaceArchive;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'workspace-archive', title: 'Idle workspaces', keywords: 'workspace archive idle snapshots prune tidy restore card', before: 'about', build: (el) => VexWorkspaceArchive.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'workspace-archive', label: 'Tidy workspaces', hint: 'Archive idle workspaces and prune old snapshots, with Undo', icon: 'folder', action: () => VexWorkspaceArchive.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexWorkspaceArchive };
