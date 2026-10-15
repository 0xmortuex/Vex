// === Settings › Health check ==================================================
// One button: look at the settings file, the data stores, stored values,
// leftover temporary files, stale migrations and orphaned data
// (src/main/health-check.js), show what is wrong and what each repair would
// do, repair what is chosen, and keep an Undo.
//
//  - A repair that only puts back a copy Vex itself made, or removes a
//    leftover temporary file, is "safe": made as soon as it is chosen.
//  - One that takes a setting or a data file out of play asks first with
//    vexConfirm, and says what it would remove.
//  - Every repair is kept for undo (last three runs), and stored values that
//    were removed are written back by Undo.
const VexHealth = {
  _last: null,       // the scan on screen
  _undoRun: null,    // the run Undo reverses

  _api() {
    const api = window.vex && window.vex.health;
    if (!api || typeof api.scan !== 'function') throw new Error('The health check is not available in this window');
    return api;
  },

  async scan() {
    const r = await this._api().scan();
    if (!r || !r.ok) throw new Error((r && r.error) || 'The scan did not answer');
    this._last = r;
    return r;
  },

  // Remove stored values through the interface's own storage, so the shim that
  // holds them does not write them back.
  _removeKeys(keys) {
    for (const k of keys) localStorage.removeItem(k);
  },

  // ids: finding ids chosen. -> the main process's answer, after the interface's
  // side of it (stored values) is done.
  async repair(ids, confirmed) {
    const r = await this._api().fix(ids, confirmed);
    if (!r || !r.ok) throw new Error((r && r.error) || 'The repair did not answer');
    if (r.removeKeys && r.removeKeys.length) this._removeKeys(r.removeKeys);
    this._undoRun = r.run || null;
    return r;
  },

  async undo() {
    if (!this._undoRun) throw new Error('Nothing to undo');
    const r = await this._api().undo(this._undoRun);
    if (!r || !r.ok) throw new Error((r && r.error) || 'The undo did not answer');
    for (const [k, v] of Object.entries(r.restoreKeys || {})) localStorage.setItem(k, v);
    this._undoRun = null;
    return r;
  },

  open() {
    const dlg = VexSettingsGroups.dialog({
      id: 'vex-health-dialog',
      title: 'Health check',
      sub: 'Looks for damaged settings, stuck leftovers and oversized values, and repairs what can be repaired safely. Nothing is changed until you choose.',
    });
    const { body } = dlg;
    const msg = document.createElement('div');
    msg.className = 'vexsr-msg';
    msg.setAttribute('role', 'status');
    const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? 'var(--danger, #ef4444)' : 'var(--text-muted)'; };
    const list = document.createElement('div');
    list.className = 'vexsr-list';
    const actions = document.createElement('div');
    actions.className = 'vexsr-row';
    actions.style.marginTop = '12px';
    body.append(actions, msg, list);

    const draw = (scan) => {
      list.textContent = '';
      const found = scan.findings;
      if (!found.length) {
        const e = document.createElement('div');
        e.className = 'vexsr-empty';
        e.textContent = 'Nothing wrong. Checked: ' + scan.checked.join('; ') + '.';
        list.appendChild(e);
        return;
      }
      for (const f of found) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule vex-health-row';
        row.dataset.finding = f.id;
        row.dataset.severity = f.severity;
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.disabled = !f.fix;
        box.checked = !!f.fix && !f.fix.confirm;
        box.setAttribute('aria-label', f.title);
        const text = document.createElement('div');
        text.className = 'vex-health-text';
        const t = document.createElement('div');
        t.className = 'vexsr-host';
        t.textContent = f.title;
        const d = document.createElement('div');
        d.className = 'vexsr-mode';
        d.textContent = f.detail + (f.fix ? '  Repair: ' + f.fix.summary + (f.fix.confirm ? ' (asks you first)' : '') : '  No automatic repair.');
        text.append(t, d);
        row.append(box, text);
        list.appendChild(row);
      }
    };

    const run = async () => {
      say('Checking…');
      try {
        const scan = await this.scan();
        draw(scan);
        const n = scan.findings.length;
        say(n ? n + ' thing' + (n === 1 ? '' : 's') + ' found. Tick the repairs you want, then Repair selected.' : 'Everything checked is fine.');
      } catch (err) { say('The check could not run: ' + err.message, true); }
    };

    const scanBtn = VexSettingsGroups.button('Run the check', run, { primary: true });
    const fixBtn = VexSettingsGroups.button('Repair selected', async () => {
      const picked = Array.from(list.querySelectorAll('input:checked')).map(b => b.closest('[data-finding]').dataset.finding);
      if (!picked.length) { say('Tick at least one repair first', true); return; }
      const need = (this._last ? this._last.findings : []).filter(f => picked.includes(f.id) && f.fix && f.fix.confirm);
      let confirmed = false;
      if (need.length) {
        confirmed = await vexConfirm({
          title: 'Repair these?',
          message: 'These take data out of use. Each is kept so Undo can put it back.\n\n' + need.map(f => '- ' + f.fix.summary).join('\n'),
          okLabel: 'Repair', cancelLabel: 'Cancel', danger: true,
        });
        if (!confirmed) return;
      }
      fixBtn.disabled = true;
      try {
        const r = await this.repair(picked, confirmed);
        say(r.applied.length + ' repaired' + (r.skipped.length ? ', ' + r.skipped.length + ' skipped (' + r.skipped.map(s => s.reason).join('; ') + ')' : '') + '.'
          + (r.run ? ' You can undo this.' : ''), r.applied.length === 0);
        undoBtn.hidden = !this._undoRun;
        const scan = await this.scan();
        draw(scan);
      } catch (err) { say('The repair failed: ' + err.message, true); }
      fixBtn.disabled = false;
    });
    const undoBtn = VexSettingsGroups.button('Undo the last repair', async () => {
      undoBtn.disabled = true;
      try {
        const r = await this.undo();
        say('Put back ' + (r.restored.length + Object.keys(r.restoreKeys || {}).length) + ' thing(s). Restart Vex for everything to take.');
        undoBtn.hidden = true;
        await run();
      } catch (err) { say('The undo failed: ' + err.message, true); }
      undoBtn.disabled = false;
    });
    undoBtn.hidden = !this._undoRun;
    actions.append(scanBtn, fixBtn, undoBtn);
    run();
    return dlg;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Checks the settings file and data stores, stored values, leftover temporary files, old migrations and orphaned data, and fixes what it safely can. You see every repair before it is made and can undo it.'));
    el.appendChild(VexSettingsGroups.button('Run the health check', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexHealth = VexHealth;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'health-check',
      title: 'Health check',
      keywords: 'repair fix corrupt damaged settings storage cache oversized orphan migration self-repair troubleshoot',
      before: 'about',
      build: (el) => VexHealth.group(el),
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexHealth };
