// === Game mode helpers: one door for the game state, one Settings group =====
//
// Game mode (js/game-session.js) hears every change of the game state from the
// main process (a game started or ended, a launcher opened or closed). The four
// helpers that hang off it each want the same news:
//
//   GameFlush      save my work when a game (or its launcher) starts   T1-041
//   GameWarmdown   hold background work when a launcher opens           T1-035
//   GamePitstop    one card when a game ends                            T1-032
//   GameChecklist  an optional list to look at before I play            T1-023
//
// GameSession.onState passes the state here first. A helper that throws is
// reported to Problems and never stops the others, nor Game mode itself.
// Settings › Game helpers holds the switches and the lists.
const GameHelpers = {
  helpers() {
    return [
      ['Save before a game', typeof GameFlush !== 'undefined' ? GameFlush : null],
      ['Warm-down', typeof GameWarmdown !== 'undefined' ? GameWarmdown : null],
      ['Pit stop', typeof GamePitstop !== 'undefined' ? GamePitstop : null],
      ['Checklist', typeof GameChecklist !== 'undefined' ? GameChecklist : null],
    ];
  },

  onState(s) {
    for (const [name, h] of this.helpers()) {
      if (!h || typeof h.onState !== 'function') continue;
      try { h.onState(s); }
      catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Game mode', name + ' failed on a game change', err); else console.error('[GameHelpers] ' + name + ' failed:', err); }
    }
  },

  // ---- Settings ----------------------------------------------------------------------
  _toggle(parent, label, hint, get, set) {
    const row = document.createElement('div');
    row.className = 'setting-toggle-row';
    const span = document.createElement('span');
    span.textContent = label;
    if (hint) span.title = hint;
    const sw = document.createElement('label');
    sw.className = 'toggle';
    sw.innerHTML = '<input type="checkbox"><span class="toggle-slider"></span>';
    const box = sw.querySelector('input');
    box.setAttribute('aria-label', label);
    box.checked = !!get();
    box.addEventListener('change', () => {
      try { set(box.checked); }
      catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); }
    });
    row.append(span, sw);
    parent.appendChild(row);
    return row;
  },
  _info(parent, text) { const p = document.createElement('p'); p.className = 'setting-info muted'; p.textContent = text; parent.appendChild(p); return p; },
  _button(parent, text, fn) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn-secondary'; b.textContent = text;
    b.addEventListener('click', () => { Promise.resolve().then(fn).catch(err => window.showToast?.((err && err.message) || String(err), 'error')); });
    parent.appendChild(b);
    return b;
  },

  render(body) {
    body.textContent = '';
    const again = () => this.render(body);
    this._info(body, 'Four small helpers around Game mode. They only read the names of programs Vex already watches for, never touch a game, and each has its own switch. Game mode must be on for the warm-down.');

    if (typeof GameFlush !== 'undefined') {
      this._toggle(body, 'Save my work when a game starts', 'The open tabs, the note being typed, text in page boxes and pending settings are written to disk the moment a game or its launcher starts, so a crash loses nothing.', () => GameFlush.enabled(), (on) => GameFlush.setEnabled(on));
      const last = GameFlush.last();
      if (last) this._info(body, 'Last time: ' + new Date(last.at).toLocaleString() + ' — ' + (last.done.length ? 'saved ' + last.done.join(', ') : 'nothing to save') + (last.failed.length ? '; could not save ' + last.failed.map(f => f.step).join(', ') : '') + '.');
    }

    if (typeof GameWarmdown !== 'undefined') {
      this._toggle(body, 'Warm down when a game launcher opens', 'When Steam, Epic or another launcher on your list opens, Vex holds sync, indexing, update checks and background work, and (with Game mode’s consent) sleeps background tabs. It ends when the launcher closes, the game starts, or after 15 minutes.', () => GameWarmdown.enabled(), (on) => { GameWarmdown.setEnabled(on); again(); });
      if (GameWarmdown.enabled()) {
        const list = GameWarmdown.launchers();
        this._info(body, 'Launchers watched: ' + (list.length ? list.map(l => l.name).join(', ') : 'none') + '.');
        const rm = document.createElement('div');
        rm.className = 'gs-btns';
        for (const l of list) this._button(rm, 'Remove ' + l.name, async () => { GameWarmdown.removeLauncher(l.id); again(); });
        body.appendChild(rm);
        const row = document.createElement('div');
        this._button(row, 'Add a launcher…', async () => {
          const exe = await window.vexPrompt({ title: 'Add a launcher', label: 'Program name', message: 'As Task Manager shows it, for example Steam.exe', okLabel: 'Next' });
          if (exe == null) return;
          const name = await window.vexPrompt({ title: 'Add a launcher', label: 'Name', value: GameSession.exeKey(exe), okLabel: 'Add' });
          if (name == null) return;
          GameWarmdown.addLauncher({ name, exe });
          again();
        });
        this._button(row, 'Back to the usual list', async () => { GameWarmdown.resetLaunchers(); again(); });
        body.appendChild(row);
      }
    }

    if (typeof GamePitstop !== 'undefined') {
      this._toggle(body, 'Show a pit-stop card when a game ends', 'One card: what Vex held back, what is waiting, the tabs it slept and a button to wake them. It replaces the short “While you played” toast.', () => GamePitstop.enabled(), (on) => GamePitstop.setEnabled(on));
      const row = document.createElement('div');
      this._button(row, 'Show the last pit stop', async () => { GamePitstop.show(); });
      body.appendChild(row);
    }

    if (typeof GameChecklist !== 'undefined') {
      this._toggle(body, 'Pre-game checklist', 'Off until you turn it on. When a launcher opens or one of your games starts, a card lists your own to-dos and two checks (an unsaved note, running downloads). It never blocks or delays a game: “Play anyway” is always there.', () => GameChecklist.enabled(), (on) => { GameChecklist.setEnabled(on); again(); });
      if (GameChecklist.enabled()) {
        const items = GameChecklist.items();
        if (!items.length) this._info(body, 'Your list is empty.');
        for (const it of items) {
          const row = document.createElement('div');
          row.className = 'setting-toggle-row';
          const t = document.createElement('span');
          t.textContent = it.text + (it.repeat === 'daily' ? ' (every day)' : '');
          row.appendChild(t);
          this._button(row, 'Remove', async () => { GameChecklist.removeItem(it.id); again(); });
          body.appendChild(row);
        }
        const row = document.createElement('div');
        this._button(row, 'Add an item…', async () => {
          const text = await window.vexPrompt({ title: 'Before you play', label: 'What should be done first?', message: 'For example: homework, take out the bins, reply to Mum', okLabel: 'Next' });
          if (text == null) return;
          const daily = await window.vexConfirm({ title: 'Every day?', message: 'Should it be ticked off again each day?', okLabel: 'Every day', cancelLabel: 'Just once' });
          GameChecklist.addItem(text, { daily });
          again();
        });
        body.appendChild(row);
      }
    }
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    for (const [, h] of this.helpers()) if (h && typeof h.init === 'function') h.init();
    if (window.VexSettingsGroups) VexSettingsGroups.register({ id: 'game-helpers', title: 'Game mode helpers', keywords: 'game steam launcher warm-down flush pit stop checklist homework', render: (body) => this.render(body) });
    return true;
  },
};

if (typeof window !== 'undefined') { window.GameHelpers = GameHelpers; GameHelpers.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { GameHelpers };
