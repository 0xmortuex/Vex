// === "When all downloads finish": the Downloads panel row and the countdown ====
//
// The state machine is in the main process (src/main/after-downloads.js); this
// is only what you see. A row in the Downloads panel with a choice - Do nothing,
// Sleep, Shut down - that has to be set on purpose each time (it is never
// remembered), and, when the last download is done, a 60 second countdown over
// the window with a large Cancel. The same words also go to a Windows
// notification (main.js), for when the window is out of sight.
//
// Loaded on demand (VexLazy.ensure('js/after-downloads-ui.js')).

const AfterDownloadsUI = {
  _rows: new Set(),
  _overlay: null,
  _tick: null,

  _t(text, ...a) {
    let out = text;
    try { out = (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; } catch (err) { console.error('[AfterDownloads] translation failed:', err.message); }
    return out.replace(/\{(\d)\}/g, (_m, i) => a[Number(i) - 1]);
  },

  // -> the sentence under the choice, for each state
  statusText(s) {
    if (!s || !s.armed) return '';
    const down = s.action === 'shutdown';
    if (s.phase === 'countdown') return this._t(down ? 'Your PC will shut down soon. Press Cancel to stop it.' : 'Your PC will sleep soon. Press Cancel to stop it.');
    return this._t(down
      ? 'Set: your PC will shut down when all downloads have finished. It switches itself off after 12 hours, or if a download fails.'
      : 'Set: your PC will sleep when all downloads have finished. It switches itself off after 12 hours, or if a download fails.');
  },

  mount(panel) {
    const list = panel && panel.querySelector('#downloads-list');
    if (!list || panel.querySelector('.after-dl-row')) return;
    const row = document.createElement('div');
    row.className = 'after-dl-row';
    row.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 12px;font-size:12px';
    const label = document.createElement('label');
    label.textContent = this._t('When all downloads finish:');
    label.htmlFor = 'after-dl-choice';
    const select = document.createElement('select');
    select.id = 'after-dl-choice';
    select.setAttribute('aria-label', this._t('When all downloads finish'));
    for (const [value, text] of [['nothing', 'Do nothing'], ['sleep', 'Put the PC to sleep'], ['shutdown', 'Shut the PC down']]) {
      const o = document.createElement('option');
      o.value = value; o.textContent = this._t(text);
      select.appendChild(o);
    }
    const status = document.createElement('span');
    status.className = 'after-dl-status';
    status.style.cssText = 'color:var(--text-muted);flex:1 1 220px';
    status.setAttribute('role', 'status');
    row.append(label, select, status);
    list.parentNode.insertBefore(row, list);
    const entry = { select, status };
    this._rows.add(entry);
    select.addEventListener('change', () => this._choose(select.value));
    window.vex.afterDlGet().then((s) => this._paint(s)).catch((err) => window.VexProblems?.note('Downloads', 'Could not read the after-downloads setting', err));
  },

  async _choose(value) {
    try {
      const s = value === 'nothing' ? await window.vex.afterDlDisarm() : await window.vex.afterDlArm(value);
      this._paint(s);
    } catch (err) {
      window.showToast?.(this._t('Not changed: {1}', String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')), 'error');
      try { this._paint(await window.vex.afterDlGet()); } catch (e2) { window.VexProblems?.note('Downloads', 'Could not read the after-downloads setting', e2); }
    }
  },

  _paint(s) {
    for (const r of this._rows) {
      if (!r.select.isConnected) { this._rows.delete(r); continue; }
      r.select.value = s && s.armed ? s.action : 'nothing';
      r.status.textContent = this.statusText(s);
    }
  },

  // What main says happened.
  onEvent(e) {
    if (!e || typeof e.kind !== 'string') return;
    const sleeping = e.action !== 'shutdown';
    if (e.kind === 'countdown') { this._showCountdown(e); this._paint({ armed: true, action: e.action, phase: 'countdown' }); return; }
    this._hideCountdown();
    if (e.kind === 'armed') this._paint({ armed: true, action: e.action, phase: 'waiting' });
    else if (e.kind === 'restarted') { this._paint({ armed: true, action: e.action, phase: 'waiting' }); window.showToast?.(this._t('A new download started, so the wait begins again')); }
    else {
      this._paint({ armed: false });
      if (e.kind === 'blocked') window.showToast?.(this._t('A download did not finish, so your PC was left on'), 'error');
      else if (e.kind === 'error') window.showToast?.(this._t(sleeping ? 'Could not put the PC to sleep: {1}' : 'Could not shut the PC down: {1}', e.message), 'error');
      else if (e.kind === 'disarmed' && e.why === 'cancelled') window.showToast?.(this._t('Cancelled. Your PC stays on'));
      else if (e.kind === 'disarmed' && e.why === 'expired') window.showToast?.(this._t('Vex stopped waiting for your downloads after 12 hours'));
    }
  },

  _showCountdown(e) {
    this._hideCountdown();
    const sleeping = e.action !== 'shutdown';
    const box = document.createElement('div');
    box.className = 'after-dl-overlay';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', this._t(sleeping ? 'Your PC will go to sleep' : 'Your PC will shut down'));
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)';
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--surface,#222);color:var(--text,#fff);border:1px solid var(--border,#555);border-radius:12px;padding:24px 28px;max-width:420px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.5)';
    const head = document.createElement('div');
    head.style.cssText = 'font-size:16px;font-weight:600;margin-bottom:6px';
    head.textContent = this._t('Your downloads are finished');
    const line = document.createElement('div');
    line.style.cssText = 'font-size:22px;font-weight:700;margin:8px 0 16px';
    line.setAttribute('aria-live', 'polite');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn-primary';
    cancel.style.cssText = 'font-size:16px;padding:12px 36px;font-weight:700';
    cancel.textContent = this._t('Cancel');
    cancel.addEventListener('click', () => {
      window.vex.afterDlCancel().then((s) => this._paint(s)).catch((err) => window.showToast?.(this._t('Could not cancel: {1}', err.message), 'error'));
      this._hideCountdown();
    });
    card.append(head, line, cancel);
    box.appendChild(card);
    box.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cancel.click(); });
    document.body.appendChild(box);
    // keep:true - it must stay up until you answer: "Close all overlays" and a double Escape leave it alone (js/vex-layer.js).
    if (typeof VexLayer !== 'undefined') VexLayer.track(box, { tier: 'system', id: 'after-downloads-countdown', keep: true });
    this._overlay = box;
    const paint = () => {
      const left = Math.max(0, Math.ceil((e.fireAt - Date.now()) / 1000));
      line.textContent = left === 1
        ? this._t(sleeping ? 'Sleeping in 1 second' : 'Shutting down in 1 second')
        : this._t(sleeping ? 'Sleeping in {1} seconds' : 'Shutting down in {1} seconds', left);
    };
    // A chain of timeouts, not an interval: the count must stay true even where background jobs pause (battery, Game mode).
    const step = () => { paint(); this._tick = setTimeout(step, 250); };
    step();
    cancel.focus();
  },
  _hideCountdown() {
    if (this._tick) { clearTimeout(this._tick); this._tick = null; }
    if (this._overlay) { this._overlay.remove(); this._overlay = null; }
  },
};

if (typeof window !== 'undefined') window.AfterDownloadsUI = AfterDownloadsUI;
if (typeof module !== 'undefined') module.exports = { AfterDownloadsUI };
