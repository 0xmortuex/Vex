// === Sync conflicts: both versions, side by side ============================
//
// Vex Sync keeps both versions when two devices changed the same thing between
// syncs (js/sync-engine.js, records.merge) and lists them in Settings › Vex
// Sync › Sync conflicts, one line each. This is the closer look: the whole of
// each version, field by field with the differing fields marked, and one
// button per version to keep it. Nothing about the wire format or the merge is
// changed; choosing goes through SyncEngine.resolveConflict, as the list does.
//
// A saved login or authenticator account is shown by its label only: its
// password or secret is sealed in the main process and never reaches here.
const VexSyncConflictDetail = {
  MAX_CELL: 4000,

  _text(value) {
    if (value === undefined) return '';
    const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return s.length > this.MAX_CELL ? s.slice(0, this.MAX_CELL) + '\n… (' + (s.length - this.MAX_CELL) + ' more characters)' : s;
  },

  // [{ field, cells: [text per version], differs }] for object versions;
  // null when the versions are not all objects (they are shown whole).
  rows(versions) {
    const objs = versions.map(v => v.value);
    if (!objs.every(o => o && typeof o === 'object' && !Array.isArray(o))) return null;
    const fields = [];
    for (const o of objs) for (const k of Object.keys(o)) if (!fields.includes(k)) fields.push(k);
    return fields.map(field => {
      const cells = objs.map(o => (Object.hasOwn(o, field) ? this._text(o[field]) : null));
      const differs = cells.some(c => c !== cells[0]);
      return { field, cells, differs };
    });
  },

  _cell(text, deleted) {
    const td = document.createElement('td');
    td.className = 'vex-sync-cell';
    if (text === null) { td.textContent = '(not set)'; td.classList.add('vex-sync-missing'); }
    else if (deleted) td.textContent = 'Deleted';
    else td.textContent = text;
    return td;
  },

  // key: a conflict's key (SyncEngine.conflicts()[n].key). `done` is called
  // after a version has been chosen.
  open(key, { done } = {}) {
    if (typeof SyncEngine === 'undefined' || typeof SyncEngine.conflictDetail !== 'function') throw new Error('Vex Sync is not available here');
    const detail = SyncEngine.conflictDetail(key);
    if (!detail) throw new Error('That conflict is no longer there');
    const dlg = VexSettingsGroups.dialog({
      id: 'vex-sync-conflict-dialog',
      title: 'Two versions of ' + detail.what,
      sub: 'Changed on two devices between syncs. The one in use is marked; choose the one to keep.',
    });
    const { body } = dlg;
    const when = at => (at ? new Date(at).toLocaleString() : 'time unknown');
    const table = document.createElement('table');
    table.className = 'vex-sync-compare';
    const head = document.createElement('tr');
    const corner = document.createElement('th');
    corner.textContent = '';
    head.appendChild(corner);
    detail.versions.forEach((v, i) => {
      const th = document.createElement('th');
      th.textContent = 'Version ' + (i + 1) + (v.current ? ' (in use)' : '');
      const sub = document.createElement('div');
      sub.className = 'vex-sync-when';
      sub.textContent = v.deleted ? 'Deleted · ' + when(v.at) : when(v.at);
      th.appendChild(sub);
      head.appendChild(th);
    });
    table.appendChild(head);

    const anySealed = detail.versions.some(v => v.sealed);
    const rows = anySealed || detail.versions.some(v => v.deleted) ? null : this.rows(detail.versions);
    if (anySealed) {
      const tr = document.createElement('tr');
      tr.appendChild(document.createElement('th')).textContent = 'Item';
      detail.versions.forEach(v => tr.appendChild(this._cell(v.deleted ? null : v.label, v.deleted)));
      table.appendChild(tr);
    } else if (rows) {
      for (const r of rows) {
        const tr = document.createElement('tr');
        if (r.differs) tr.className = 'vex-sync-differs';
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = r.field + (r.differs ? ' (differs)' : '');
        tr.appendChild(th);
        r.cells.forEach(c => tr.appendChild(this._cell(c, false)));
        table.appendChild(tr);
      }
    } else {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = 'Value';
      tr.appendChild(th);
      detail.versions.forEach(v => tr.appendChild(this._cell(v.deleted ? null : this._text(v.value), v.deleted)));
      table.appendChild(tr);
    }
    const scroller = document.createElement('div');
    scroller.className = 'vex-sync-scroll';
    scroller.appendChild(table);
    body.appendChild(scroller);

    const msg = document.createElement('div');
    msg.className = 'vexsr-msg';
    msg.setAttribute('role', 'status');
    body.appendChild(msg);
    const buttons = document.createElement('div');
    buttons.className = 'vexsr-row';
    buttons.style.marginTop = '12px';
    detail.versions.forEach((v, i) => {
      const b = VexSettingsGroups.button(v.current ? 'Keep version ' + (i + 1) : 'Use version ' + (i + 1), async () => {
        const ok = await vexConfirm({
          title: 'Use version ' + (i + 1) + '?',
          message: v.deleted
            ? 'This deletes it on this device, and the deletion goes to your other devices on the next sync.'
            : 'This version is put back on this device and goes to your other devices on the next sync. The other version is discarded.',
          okLabel: v.current ? 'Keep it' : 'Use it', cancelLabel: 'Cancel',
        });
        if (!ok) return;
        buttons.querySelectorAll('button').forEach(x => { x.disabled = true; });
        try {
          const r = await SyncEngine.resolveConflict(key, i);
          if (r && r.ok === false) window.showToast?.('Put back on this device. It reaches your other devices on the next sync.', 'info');
          dlg.close();
          if (typeof done === 'function') done();
        } catch (err) {
          msg.textContent = (err && err.message) || String(err);
          msg.style.color = 'var(--danger, #ef4444)';
          buttons.querySelectorAll('button').forEach(x => { x.disabled = false; });
        }
      }, { primary: v.current });
      buttons.appendChild(b);
    });
    body.appendChild(buttons);
    return dlg;
  },
};

if (typeof window !== 'undefined') window.VexSyncConflictDetail = VexSyncConflictDetail;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSyncConflictDetail };
