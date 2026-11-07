// === The rolling automatic backup: the window's half =========================
//
// Off until the person turns it on (Settings > Back up everything, or put it back).
// Then, at most once a day, Vex saves the same file that dialog saves, into its
// backups folder (and into a second folder if the person chose one): the newest
// 7 daily and 4 weekly copies are kept. main/auto-backups.js decides whether it
// may be made right now (not while a game is running, not on battery power, not
// during quiet hours, not twice in a day) and keeps the files; this file asks, a
// few minutes after start-up and then hourly, makes the snapshot only when main
// says one is due, and tells the Attention Inbox when a backup could not be
// saved. The snapshot is made by VexBackup.snapshot, so it holds no saved logins.
//
// Nothing here starts work at boot: the first question is asked three minutes
// after the window is up, and with the switch off main answers "off" at once.
const VexAutoBackup = {
  FIRST_CHECK_MS: 3 * 60 * 1000,
  EVERY_MS: 60 * 60 * 1000,
  FEATURE: 'auto-backup',
  _timer: null,

  _api() { return window.vex && window.vex.backup && typeof window.vex.backup.autoDue === 'function' ? window.vex.backup : null; },

  start() {
    if (this._timer || window.VexTabPolicy?.isPrivateWindow || !this._api()) return;
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle(this.FEATURE, (key) => { if (key === 'open' && window.VexBackup) window.VexBackup.open(); });
    const tick = () => {
      this.check().catch(err => window.VexProblems?.note('auto-backup', 'The automatic backup check failed', err));
    };
    // The first question after a delay; then the shared job tick, which a game, a hidden window or battery-aware mode holds.
    this._timer = setTimeout(() => {
      tick();
      if (typeof VexJobs !== 'undefined') VexJobs.every('auto-backup', this.EVERY_MS, tick, { when: 'background', deferOnBattery: true, feature: '' });
      else window.VexProblems?.note('auto-backup', 'The shared job timer is not loaded, so the automatic backup will only be checked once this session');
    }, this.FIRST_CHECK_MS);
  },

  _inbox(id, title, body) {
    if (typeof AttentionInbox === 'undefined') { window.VexProblems?.note('auto-backup', title + ': ' + body); return; }
    AttentionInbox.add({ feature: this.FEATURE, id, label: 'Automatic backup', title, body, action: { label: 'Open backups', key: 'open' } });
  },

  // -> 'off' | 'not-due:<why>' | 'saved' | 'failed'
  async check() {
    const api = this._api();
    if (!api) return 'off';
    const due = await api.autoDue();
    if (!due || !due.ok) throw new Error((due && due.error) || 'main did not answer');
    if (!due.due) return 'not-due:' + due.why;
    if (!window.VexBackup) throw new Error('the backup feature is not loaded');
    let r;
    try {
      const snap = await window.VexBackup.snapshot([]);
      r = await api.autoSave(JSON.stringify(snap));
    } catch (err) { r = { ok: false, error: 'Vex could not make the backup (' + ((err && err.message) || err) + ')' }; }
    if (r && r.ok) {
      if (r.second && !r.second.ok) this._inbox('second', 'The second copy of the automatic backup could not be written', r.second.error);
      return 'saved';
    }
    if (r && r.skipped) return 'not-due:' + r.skipped;
    this._inbox('failed', 'The automatic backup could not be saved', (r && r.error) || 'unknown error');
    return 'failed';
  },

  // ---- the section in Settings > Back up everything ---------------------------
  async mount(m, msg) {
    const api = this._api();
    const box = m.querySelector('#bk-auto');
    if (!box) return;
    if (!api || window.VexTabPolicy?.isPrivateWindow) { box.hidden = true; return; }
    const on = box.querySelector('#bk-auto-on');
    const where = box.querySelector('#bk-auto-where');
    const status = box.querySelector('#bk-auto-status');
    const list = box.querySelector('#bk-auto-list');
    const tr = (t) => (window.vexTr ? window.vexTr(t) : t);

    const render = async (state) => {
      on.checked = state.on;
      where.textContent = state.folder2 || tr('No second folder chosen');
      box.querySelector('#bk-auto-clear').hidden = !state.folder2;
      const parts = [];
      if (state.lastOkAt) parts.push(tr('Last saved') + ': ' + new Date(state.lastOkAt).toLocaleString());
      if (state.lastError) parts.push(state.lastError);
      status.textContent = parts.join(' · ');
      list.textContent = '';
      const r = await api.autoList();
      if (!r || !r.ok) { status.textContent = (r && r.error) || tr('The automatic backups could not be listed'); return; }
      for (const item of r.items) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        row.dataset.backup = item.name;
        const label = document.createElement('span');
        label.className = 'vexsr-host';
        label.textContent = tr(item.kind === 'weekly' ? 'Weekly backup' : 'Daily backup');
        const when = document.createElement('span');
        when.className = 'vexsr-mode';
        when.textContent = new Date(item.at).toLocaleString() + ' · ' + Math.max(1, Math.round(item.bytes / 1024)) + ' KB';
        const open = async (then) => {
          let got;
          try { got = await api.autoRead(item.name); } catch (err) { got = { ok: false, error: err.message }; }
          if (!got || !got.ok) { msg('That backup could not be read: ' + ((got && got.error) || 'unknown error'), true); return; }
          let data;
          try { data = JSON.parse(got.text); } catch { msg('That backup is not readable as a Vex backup', true); return; }
          await then(data);
        };
        const restore = document.createElement('button');
        restore.className = 'vexsr-x';
        restore.textContent = 'Restore';
        restore.setAttribute('aria-label', 'Restore ' + tr(item.kind === 'weekly' ? 'Weekly backup' : 'Daily backup'));
        restore.addEventListener('click', () => open((data) => window.VexBackup._restore(data, m, msg)));
        const test = document.createElement('button');
        test.className = 'vexsr-x';
        test.textContent = 'Test this backup';
        test.setAttribute('aria-label', 'Test this backup');
        test.addEventListener('click', () => open((data) => window.VexBackup._test(data, m, msg)));
        row.append(label, when, restore, test);
        list.appendChild(row);
      }
    };

    const reload = async () => {
      const s = await api.autoState();
      if (!s || !s.ok) { status.textContent = (s && s.error) || tr('The automatic backup settings could not be read'); return; }
      await render(s.state);
    };
    on.addEventListener('change', async () => {
      const r = await api.autoSet(on.checked);
      if (!r || !r.ok) { msg((r && r.error) || 'The setting could not be saved', true); on.checked = !on.checked; return; }
      await render(r.state);
      msg(r.state.on ? 'Automatic backup is on. The first one is saved a few minutes from now, when it is allowed to run.' : 'Automatic backup is off. The copies already made are kept.');
    });
    box.querySelector('#bk-auto-folder').addEventListener('click', async () => {
      const r = await api.autoChooseFolder();
      if (!r || !r.ok) { msg((r && r.error) || 'The folder could not be set', true); return; }
      if (!r.canceled) await render(r.state);
    });
    box.querySelector('#bk-auto-clear').addEventListener('click', async () => {
      const r = await api.autoClearFolder();
      if (!r || !r.ok) { msg((r && r.error) || 'The folder could not be cleared', true); return; }
      await render(r.state);
    });
    await reload();
  },
};

if (typeof window !== 'undefined') {
  window.VexAutoBackup = VexAutoBackup;
  VexAutoBackup.start();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexAutoBackup };
