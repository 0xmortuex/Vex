// === Quiet hours: the Settings section ======================================
//
// The rule lives in the main process (src/main/quiet-hours.js), which sits in
// front of every desktop toast: inside the quiet window they are held, then
// released together as one digest when it ends, or at the release times set
// here. Reminders and alarms, and toasts from the VIP sites listed here, are
// never held. Off by default.
const QuietHoursUI = {
  _msg(err) { return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); },

  _lines(text) { return String(text || '').split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean); },

  mountSettings() {
    const PS = window.ProtectSettings;
    if (!PS) return null;
    const body = PS.group({ id: 'settings-quiet-hours', title: 'Quiet hours for notifications', intro: 'During the quiet window Vex holds its desktop notifications and shows them together when it ends. Reminders and alarms always come through, and so do the VIP sites below.' });
    if (!body || body.dataset.ready) return body;
    body.dataset.ready = '1';
    const q = window.vex && window.vex.quiet;
    if (!q) { body.textContent = 'Quiet hours are not available in this window.'; return body; }

    const row = (label, el) => { const l = document.createElement('label'); l.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:12.5px;margin:6px 0;flex-wrap:wrap'; l.append(label, el); return l; };
    const start = document.createElement('input'); start.type = 'time'; start.className = 'set-input'; start.setAttribute('aria-label', 'Quiet hours start');
    const end = document.createElement('input'); end.type = 'time'; end.className = 'set-input'; end.setAttribute('aria-label', 'Quiet hours end');
    const times = document.createElement('input'); times.type = 'text'; times.className = 'set-input'; times.placeholder = '12:30, 18:00 (optional)'; times.setAttribute('aria-label', 'Release times');
    const vip = document.createElement('textarea'); vip.className = 'set-input'; vip.rows = 3; vip.placeholder = 'One site per line, e.g. mail.example.com'; vip.setAttribute('aria-label', 'VIP sites');
    vip.style.cssText = 'width:100%;max-width:360px;font-size:12.5px';
    const status = document.createElement('div'); status.setAttribute('role', 'status'); status.style.cssText = 'font-size:11.5px;color:var(--text-muted);margin:6px 0';
    const held = document.createElement('div'); held.style.cssText = 'font-size:12px;margin:6px 0';

    const show = async () => {
      try {
        const c = await q.get();
        start.value = c.start; end.value = c.end; times.value = c.digestTimes.join(', '); vip.value = c.vip.join('\n');
        toggleInput.checked = c.enabled;
        held.textContent = c.held ? c.held + ' notification' + VexPlural.s(c.held) + ' held right now.' : 'Nothing is being held.';
        status.textContent = c.enabled ? (c.inWindow ? 'Quiet hours are in effect now.' : 'On. Not in the quiet window right now.') : 'Off.';
      } catch (err) { status.textContent = 'Could not read the settings: ' + this._msg(err); }
    };
    const save = async (patch) => {
      try { await q.set(patch); await show(); }
      catch (err) { status.textContent = 'Not saved: ' + this._msg(err); window.showToast?.('Quiet hours not saved: ' + this._msg(err), 'error'); }
    };

    const toggle = PS.toggle({ text: 'Hold notifications during quiet hours', checked: false, onChange: (v) => save({ enabled: v }) });
    const toggleInput = toggle.querySelector('input');
    start.addEventListener('change', () => save({ start: start.value }));
    end.addEventListener('change', () => save({ end: end.value }));
    times.addEventListener('change', () => save({ digestTimes: this._lines(times.value) }));
    vip.addEventListener('change', () => save({ vip: this._lines(vip.value) }));

    body.append(
      toggle,
      row('From', start), row('Until', end),
      row('Also release the held ones at', times),
      row('VIP sites that always come through', vip),
      held,
      PS.button('Show held now', async () => {
        try { const r = await q.release(); status.textContent = r.released ? 'Released ' + r.released + '.' : 'Nothing was held.'; await show(); }
        catch (err) { status.textContent = 'Could not show them: ' + this._msg(err); }
      }, { icon: 'bell' }),
      PS.button('Discard held', async () => {
        const ok = await vexConfirm({ title: 'Discard held notifications?', message: 'They are deleted without being shown.', okLabel: 'Discard', danger: true });
        if (!ok) return;
        try { await q.drop(); await show(); } catch (err) { status.textContent = 'Could not discard them: ' + this._msg(err); }
      }, { danger: true }),
      status,
    );
    show();
    return body;
  },
};

if (typeof window !== 'undefined') {
  window.QuietHoursUI = QuietHoursUI;
  const boot = () => { try { QuietHoursUI.mountSettings(); } catch (err) { console.error('[QuietHoursUI] settings group failed:', err); } };
  if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') boot();
    else document.addEventListener('DOMContentLoaded', boot);
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { QuietHoursUI };
