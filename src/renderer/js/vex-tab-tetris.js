// === Tab Tetris: your open tabs as blocks ==================================
//
// Off by default (Settings > Play: tab tetris). The command bar's "Tab Tetris"
// lays the open tabs out as blocks, one cluster per tab group and the loose
// tabs last. It is a playful second way to look at the strip and to tidy it:
//
//   - drag a block onto another block to group them, or onto a group's label
//     to add it; or select blocks and press "Group selected";
//   - "Tidy" groups loose tabs that share a site;
//   - a group's "Close group" clears its blocks with a short animation.
//
// Nothing here is destructive without an undo: closing goes through
// TabManager.closeTabsWithUndo (the same Undo toast as closing several tabs),
// and grouping offers its own Undo that puts every tab back as it was.
// Pinned tabs are left out: this view never touches them.
const VexTabTetris = {
  CELL_W: 104,
  CELL_H: 58,
  GAP: 8,

  // ---- layout (pure) -------------------------------------------------------
  // tabs: [{ id, groupId }] in strip order; groups: [{ id, name }].
  // cols: how many cells wide the board is.
  //
  // Each cluster (a group, then the loose tabs) starts on its own row, below a
  // label row. Inside a cluster, blocks drop like Tetris pieces: each goes to
  // the column span where it lands lowest. Block sizes come from the tab id,
  // so a tab keeps its shape from one opening to the next.
  layout(tabs, groups, cols) {
    const width = Math.max(2, Math.floor(cols));
    const byGroup = new Map();
    const order = [];
    for (const g of groups || []) { byGroup.set(g.id, []); order.push(g.id); }
    const loose = [];
    for (const t of tabs || []) {
      if (t.groupId && byGroup.has(t.groupId)) byGroup.get(t.groupId).push(t);
      else loose.push(t);
    }
    const clusters = [];
    const blocks = [];
    let y = 0;
    const place = (members, meta) => {
      if (!members.length) return;
      const labelRow = y;
      y += 1;                                     // the label's own row
      const top = y;
      const heights = new Array(width).fill(top);
      for (const t of members) {
        const h = VexFun.hash(String(t.id));
        const w = Math.min(width, h % 3 === 0 ? 2 : 1);
        const tall = (h >>> 3) % 3 === 0 ? 2 : 1;
        let bestX = 0, bestY = Infinity;
        for (let x = 0; x + w <= width; x++) {
          let top2 = 0;
          for (let k = x; k < x + w; k++) top2 = Math.max(top2, heights[k]);
          if (top2 < bestY) { bestY = top2; bestX = x; }
        }
        for (let k = bestX; k < bestX + w; k++) heights[k] = bestY + tall;
        blocks.push({ id: t.id, groupId: t.groupId || null, x: bestX, y: bestY, w, h: tall });
      }
      const bottom = Math.max(...heights);
      clusters.push({ ...meta, labelRow, top, bottom, ids: members.map(m => m.id) });
      y = bottom;
    };
    for (const id of order) place(byGroup.get(id), { groupId: id });
    place(loose, { groupId: null });
    return { cols: width, rows: y, blocks, clusters };
  },

  // Pure. Loose tabs that share a site, two or more: [{ host, ids }].
  // `hostOf(tab)` is passed in so the rule is testable without a window.
  tidyPlan(tabs, hostOf) {
    const hosts = new Map();
    for (const t of tabs) {
      if (t.groupId) continue;
      const host = hostOf(t);
      if (!host) continue;
      if (!hosts.has(host)) hosts.set(host, []);
      hosts.get(host).push(t.id);
    }
    return [...hosts.entries()].filter(([, ids]) => ids.length >= 2).map(([host, ids]) => ({ host, ids }));
  },

  // ---- the tab manager -----------------------------------------------------
  _tm() {
    if (typeof TabManager === 'undefined') throw new Error('The tab manager is not available');
    return TabManager;
  },
  _openTabs() {
    return this._tm().tabs.filter(t => !t.pinned);
  },
  _host(t) {
    try { return new URL(t.url).hostname.replace(/^www\./, ''); } catch { return ''; }
  },
  // [{id, groupId}] for every tab, so grouping can be put back exactly.
  _snapshot() {
    const tm = this._tm();
    return { members: tm.tabs.map(t => ({ id: t.id, groupId: t.groupId || null })), groups: tm.groups.map(g => ({ ...g })) };
  },
  _restore(snap) {
    const tm = this._tm();
    tm.groups = snap.groups.map(g => ({ ...g }));
    for (const m of snap.members) {
      const t = tm.tabs.find(x => x.id === m.id);
      if (t) t.groupId = m.groupId && tm.groups.some(g => g.id === m.groupId) ? m.groupId : null;
    }
    VexStorage.saveGroups(tm.groups);
    tm.rebuildAllTabs();
    tm.persistTabs();
  },
  _commit() {
    const tm = this._tm();
    VexStorage.saveGroups(tm.groups);
    tm.rebuildAllTabs();
    tm.persistTabs();
  },
  _newGroup(name) {
    const tm = this._tm();
    const id = 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const fallback = (typeof GROUP_COLORS !== 'undefined' && GROUP_COLORS[0]) || '#6366f1';
    const color = ((tm._themeGroupPalette && tm._themeGroupPalette()[0]) || {}).ref || fallback;
    tm.groups.push({ id, name, color, collapsed: false });
    return id;
  },

  // Puts the tabs in one group (an existing one, or a new one called `name`)
  // and offers Undo. Returns the group id.
  group(ids, { groupId = null, name = '' } = {}) {
    const tm = this._tm();
    const wanted = ids.filter(id => tm.tabs.some(t => t.id === id && !t.pinned));
    if (wanted.length === 0) throw new Error('No tabs to group');
    if (!groupId && wanted.length < 2) throw new Error('Pick at least two tabs to make a group');
    const snap = this._snapshot();
    let gid = groupId;
    if (gid && !tm.groups.some(g => g.id === gid)) throw new Error('That group is gone');
    if (!gid) gid = this._newGroup(name.trim() || 'Group');
    for (const id of wanted) tm.moveTabToGroup(id, gid);
    this._commit();
    const g = tm.groups.find(x => x.id === gid);
    window.VexUndo.offer({
      message: 'Grouped ' + wanted.length + ' tab' + VexPlural.s(wanted.length) + (g ? ' in "' + g.name + '"' : ''),
      undo: () => this._restore(snap),
    });
    VexFun.medal('play.tetris.grouped');
    return gid;
  },

  // Applies tidyPlan: one group per shared site, one Undo for all of them.
  tidy() {
    const tm = this._tm();
    const plan = this.tidyPlan(this._openTabs(), (t) => this._host(t));
    if (!plan.length) return 0;
    const snap = this._snapshot();
    for (const p of plan) {
      const gid = this._newGroup(p.host);
      for (const id of p.ids) tm.moveTabToGroup(id, gid);
    }
    this._commit();
    window.VexUndo.offer({
      message: 'Tidied ' + plan.length + ' site' + VexPlural.s(plan.length) + ' into groups',
      undo: () => this._restore(snap),
    });
    VexFun.medal('play.tetris.grouped');
    return plan.length;
  },

  // Closes tabs with the standard Undo toast. Returns how many.
  close(ids, message) {
    return this._tm().closeTabsWithUndo(ids, message);
  },

  // ---- the screen ----------------------------------------------------------
  _colorOf(groupId) {
    const g = this._tm().groups.find(x => x.id === groupId);
    return g && g.color ? g.color : 'var(--text-muted)';
  },

  open() {
    this._tm();
    const win = VexFun.open({ title: 'Tab Tetris', feature: 'tetris', wide: true });
    const reduced = VexFun.reducedMotion();
    const picked = new Set();
    const bar = document.createElement('div');
    bar.className = 'vexfun-bar';
    const mkBtn = (label, cls, onClick) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = cls; b.textContent = label;
      b.addEventListener('click', onClick);
      bar.appendChild(b);
      return b;
    };
    const stage = document.createElement('div');
    stage.className = 'vexfun-stage';
    const msg = document.createElement('div');
    msg.className = 'vexfun-msg'; msg.setAttribute('role', 'status'); msg.setAttribute('aria-live', 'polite');
    win.body.append(bar, msg, stage);
    const said = (text) => { msg.textContent = text; };
    const fail = (err) => { console.error('[Tab Tetris]', err); said(err && err.message ? err.message : String(err)); };

    const nameFor = async (fallback) => {
      const name = await vexPrompt({ title: 'Name this group', label: 'Group name', value: fallback || '' });
      return name == null ? null : String(name).trim();
    };

    mkBtn('Group selected', 'btn-primary', async () => {
      try {
        if (picked.size < 2) { said('Select two or more blocks first.'); return; }
        const name = await nameFor('');
        if (name === null) return;
        this.group([...picked], { name });
        picked.clear(); render();
      } catch (err) { fail(err); }
    });
    mkBtn('Close selected', 'btn-secondary', () => {
      try {
        if (!picked.size) { said('Select blocks to close first.'); return; }
        const n = this.close([...picked], 'Closed ' + picked.size + ' tab' + VexPlural.s(picked.size));
        picked.clear(); render(); said(n + ' closed. Undo is in the toast.');
      } catch (err) { fail(err); }
    });
    mkBtn('Tidy by site', 'btn-secondary', () => {
      try {
        const n = this.tidy();
        render();
        said(n ? 'Grouped ' + n + ' site' + VexPlural.s(n) + '. Undo is in the toast.' : 'No two loose tabs share a site.');
      } catch (err) { fail(err); }
    });

    const render = () => {
      const tm = this._tm();
      const tabs = this._openTabs();
      const width = Math.min(1000, Math.max(360, window.innerWidth - 120));
      const cols = Math.max(3, Math.min(9, Math.floor((width + this.GAP) / (this.CELL_W + this.GAP))));
      const lay = this.layout(tabs.map(t => ({ id: t.id, groupId: t.groupId || null })), tm.groups.map(g => ({ id: g.id, name: g.name })), cols);
      stage.textContent = '';
      stage.style.width = (cols * (this.CELL_W + this.GAP) - this.GAP) + 'px';
      stage.style.height = Math.max(1, lay.rows) * (this.CELL_H + this.GAP) + 'px';
      if (!tabs.length) { said('No open tabs to arrange.'); return; }
      const px = (n, size) => n * (size + this.GAP);
      const byId = new Map(tabs.map(t => [t.id, t]));
      for (const c of lay.clusters) {
        const grp = c.groupId ? tm.groups.find(g => g.id === c.groupId) : null;
        const label = document.createElement('div');
        label.className = 'vexfun-cluster';
        label.style.top = px(c.labelRow, this.CELL_H) + 'px';
        label.style.width = stage.style.width;
        label.dataset.group = c.groupId || '';
        const dot = document.createElement('span');
        dot.className = 'vexfun-dot';
        dot.style.background = c.groupId ? this._colorOf(c.groupId) : 'var(--text-muted)';
        const text = document.createElement('span');
        text.textContent = (grp ? grp.name : 'Loose tabs') + ' · ' + c.ids.length;
        label.append(dot, text);
        if (grp) {
          const clear = document.createElement('button');
          clear.type = 'button'; clear.className = 'vexfun-link';
          clear.textContent = 'Close group';
          clear.setAttribute('aria-label', 'Close group ' + grp.name);
          clear.addEventListener('click', () => {
            try {
              stage.querySelectorAll('[data-cluster="' + c.groupId + '"]').forEach(el => el.classList.add('vexfun-clear'));
              const go = () => {
                try {
                  this.close(c.ids, 'Closed group "' + grp.name + '"');
                  picked.clear(); render(); said('Group closed. Undo is in the toast.');
                  VexFun.medal('play.tetris.cleared');
                } catch (err) { fail(err); }
              };
              if (reduced) go(); else setTimeout(go, 280);
            } catch (err) { fail(err); }
          });
          label.appendChild(clear);
          // Dropping a block on a group's label adds it to that group.
          label.addEventListener('dragover', (e) => e.preventDefault());
          label.addEventListener('drop', (e) => {
            e.preventDefault();
            const id = e.dataTransfer && e.dataTransfer.getData('text/plain');
            try { if (id && byId.has(id)) { this.group([id], { groupId: c.groupId }); render(); } } catch (err) { fail(err); }
          });
        }
        stage.appendChild(label);
      }
      for (const b of lay.blocks) {
        const t = byId.get(b.id);
        if (!t) continue;
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'vexfun-block' + (picked.has(b.id) ? ' is-picked' : '');
        el.dataset.cluster = b.groupId || '';
        el.draggable = true;
        el.style.left = px(b.x, this.CELL_W) + 'px';
        el.style.top = px(b.y, this.CELL_H) + 'px';
        el.style.width = (b.w * this.CELL_W + (b.w - 1) * this.GAP) + 'px';
        el.style.height = (b.h * this.CELL_H + (b.h - 1) * this.GAP) + 'px';
        el.style.setProperty('--block', b.groupId ? this._colorOf(b.groupId) : 'var(--text-muted)');
        const title = (t.title || t.url || 'Tab').trim();
        el.textContent = title;
        el.title = title;
        el.setAttribute('aria-pressed', picked.has(b.id) ? 'true' : 'false');
        el.addEventListener('click', () => {
          if (picked.has(b.id)) picked.delete(b.id); else picked.add(b.id);
          el.classList.toggle('is-picked', picked.has(b.id));
          el.setAttribute('aria-pressed', picked.has(b.id) ? 'true' : 'false');
        });
        el.addEventListener('dragstart', (e) => { if (e.dataTransfer) { e.dataTransfer.setData('text/plain', b.id); e.dataTransfer.effectAllowed = 'move'; } });
        el.addEventListener('dragover', (e) => e.preventDefault());
        el.addEventListener('drop', async (e) => {
          e.preventDefault();
          const from = e.dataTransfer && e.dataTransfer.getData('text/plain');
          if (!from || from === b.id || !byId.has(from)) return;
          try {
            if (b.groupId) { this.group([from], { groupId: b.groupId }); }
            else {
              const name = await nameFor(this._host(t));
              if (name === null) return;
              this.group([from, b.id], { name });
            }
            picked.clear(); render();
          } catch (err) { fail(err); }
        });
        stage.appendChild(el);
      }
      said('Select blocks and group them, or drag one onto another. Nothing closes without an Undo.');
    };
    render();
    return win;
  },

  init() {
    VexFun.group('play-tetris-settings', 'Play: tab tetris', (g) => {
      VexFun.switchRow(g, 'tetris', 'Tab Tetris', 'a playful view of your open tabs as blocks, to group and tidy them (command bar: "Tab Tetris"). Closing always has Undo');
    });
    if (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) {
      CommandBar.commands.push({
        id: 'tab-tetris', label: 'Tab Tetris', icon: 'layers',
        hint: 'Your tabs as blocks: drag to group, tidy by site, clear a group',
        when: () => VexFun.may('tetris'),
        action: () => this.open(),
      });
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexTabTetris = VexTabTetris;
  if (typeof document !== 'undefined' && typeof VexFun !== 'undefined' && document.querySelector) {
    try { VexTabTetris.init(); } catch (err) { console.error('[Tab Tetris] could not start:', err); }
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTabTetris };
