// === "When X happens, run this program": the window's side ======================
//
// The Settings section for the program hook (src/main/os-hook.js), and the two events that start in this
// window (exam mode armed, a CI run went red), which it reports to main. OFF by default. The window never
// names a program, a path or a command: the program is picked in a system dialog that main opens and is
// started by main only. It reports nothing from a private window (main refuses that too).
//
// Loaded late (js/lazy-boot.js).

const OsHookUI = {
  ID: 'os-hook',

  bridge() {
    const v = typeof window !== 'undefined' ? window.vex : null;
    if (!v || typeof v.osHookStatus !== 'function') throw new Error('The program hook is not available in this build');
    return v;
  },
  async call(fn, ...args) {
    const r = await this.bridge()[fn](...args);
    if (!r || r.ok !== true) throw new Error((r && r.error) || 'The request failed');
    return r;
  },
  fail(what, err) {
    console.error('[OsHook] ' + what + ':', err);
    window.showToast?.(what + ': ' + ((err && err.message) || err), 'error');
  },
  open() {
    if (typeof SettingsUI === 'undefined' || typeof SettingsUI.openSection !== 'function') throw new Error('Settings is not available in this window');
    SettingsUI.openSection('setting-' + this.ID);
  },

  // The window's two events. A private window reports nothing.
  report(event) {
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return;
    const v = window.vex;
    if (!v || typeof v.osHookEvent !== 'function') return;
    Promise.resolve(v.osHookEvent({ event })).then((r) => { if (!r || r.ok !== true) throw new Error((r && r.error) || 'main did not answer'); })
      .catch((err) => { console.error('[OsHook] could not report ' + event + ':', err); window.VexProblems?.note('Program hook', 'An event could not be passed on', err); });
  },
  listen() {
    document.addEventListener('vex:exam-mode', (e) => { if (e && e.detail && e.detail.on === true) this.report('exam-armed'); });
    document.addEventListener('vex:ci-failure', () => this.report('ci-red'));
  },

  render(body) {
    const S = VexSettingsGroups;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const act = (text, fn, opts) => S.button(text, async () => { try { await fn(); } catch (err) { this.fail(text, err); } }, opts);
    const host = el('div');
    body.append(
      S.note('Runs one program of your choice when a Vex event happens: a download finishes, a reminder fires, exam mode is armed, or a CI run goes red. Off until you switch it on. You pick the program in a file dialog; Vex starts that file with the arguments you type and no shell, tells it only the event name (and a download\'s file name) as environment variables, never runs it for private or Tor windows, and asks you again if the file has changed since you approved it.'),
      host);
    const pick = { token: '', program: '' };
    const draw = async () => {
      let st;
      try { st = await this.call('osHookStatus'); }
      catch (err) { host.textContent = ''; host.appendChild(S.note('Could not read the program hook: ' + err.message)); return; }
      host.textContent = '';
      const label = el('label', 'vex-platform-note');
      const box = el('input'); box.type = 'checkbox'; box.checked = st.enabled;
      box.addEventListener('change', async () => {
        try { const r = await this.call('osHookSetEnabled', box.checked); if (r.canceled) box.checked = false; }
        catch (err) { box.checked = false; this.fail('Program hook', err); }
        await draw();
      });
      label.append(box, el('span', '', 'Run a program when something happens'));
      host.appendChild(label);
      if (!st.enabled) return;

      const list = el('div', 'vexsr-list');
      for (const e of st.events) {
        if (!e.rule && !e.last) continue;
        const info = el('span', 'vexsr-host'); info.style.wordBreak = 'normal';
        const lines = [el('div', '', e.label)];
        if (e.rule) {
          lines.push(Object.assign(el('div', 'vexsr-mode', e.rule.program + (e.rule.args.length ? '  ' + e.rule.args.join(' ') : '')), { style: 'white-space:normal' }));
          lines.push(el('div', 'vexsr-mode', 'SHA-256 ' + e.rule.sha256 + '...'));
        }
        if (e.last) lines.push(el('div', 'vexsr-mode', e.last.error ? 'Last run: ' + e.last.error : 'Last run: exit code ' + e.last.code + (e.last.timedOut ? ' (stopped, it took too long)' : '')));
        info.append(...lines);
        const row = el('div', 'vexsr-rule');
        row.append(info, e.rule ? act('Remove', async () => { await this.call('osHookRemove', e.event); await draw(); }, { danger: true, label: 'Remove this program' }) : el('span'));
        list.appendChild(row);
      }
      if (!list.children.length) list.appendChild(S.note('No program is set for any event yet.'));
      host.appendChild(list);

      host.appendChild(S.note('Add a program for an event. Vex shows you the full path, its SHA-256 and the arguments before it saves anything.'));
      const sel = el('select', 'set-input'); sel.setAttribute('aria-label', 'Event');
      for (const e of st.events) sel.appendChild(Object.assign(el('option', '', e.label), { value: e.event }));
      const args = el('textarea', 'set-input'); args.rows = 3; args.spellcheck = false; args.placeholder = 'Arguments, one per line (optional)'; args.setAttribute('aria-label', 'Arguments, one per line');
      const chosen = el('span', 'vexsr-mode', pick.program || 'No program chosen');
      const row = (...k) => { const r = el('div', 'vexsr-rule'); r.append(...k); return r; };
      host.append(sel,
        row(act('Choose program', async () => { const r = await this.call('osHookPickProgram'); if (r.canceled) return; pick.token = r.token; pick.program = r.program; chosen.textContent = r.program; }), chosen),
        args,
        row(act('Add program', async () => {
          if (!pick.token) throw new Error('Choose the program first');
          const lines = args.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
          const r = await this.call('osHookAdd', { event: sel.value, token: pick.token, args: lines });
          pick.token = ''; pick.program = '';
          if (!r.canceled) window.showToast?.('Program added');
          await draw();
        }, { primary: true })));
    };
    draw();
  },
};

if (typeof window !== 'undefined') {
  window.OsHookUI = OsHookUI;
  OsHookUI.listen();
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: OsHookUI.ID, title: 'Program hook (developer)', keywords: 'run program event hook download finished reminder exam ci red command script automation', before: 'about', render: (body) => OsHookUI.render(body) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'os-hook', label: 'Run a program on a Vex event', hint: 'Start a program of your choice when a download finishes, a reminder fires, exam mode is armed or CI goes red', icon: 'terminal', action: () => { try { OsHookUI.open(); } catch (err) { OsHookUI.fail('Program hook', err); } } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { OsHookUI };
