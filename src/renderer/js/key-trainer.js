// === Keyboard trainer =========================================================
//
// Short, friendly challenges that teach Vex's own keys: "Open the command bar
// in 2 keys". The challenges are not a list written here; they are made from
// the live shortcut registry (js/shortcuts-registry.js), so a key you changed
// in Settings is the key you are asked for, and a key that does nothing in
// this window is never asked.
//
//   VexKeyTrainer.candidates(all)      pure: [{ id, label, combo, keys }] from
//                                      ShortcutsRegistry.getAllShortcuts()
//   VexKeyTrainer.deck(all, n, rng)    n distinct candidates, shuffled
//   VexKeyTrainer.matches(combo, ev)   does this keydown spell that combo
//   VexKeyTrainer.open()               the overlay (Ctrl+K: "Practise keys")
//
// Safety and scope:
//   * The overlay listens for keys ONLY while it is open, on its own, and it
//     swallows them (capture phase on window, stopImmediatePropagation) so a
//     practised key does not also do its real job underneath.
//   * Keys the main process acts on before the page sees them (the registry
//     marks them `system`, plus the short list below) are never asked, since
//     the overlay could not stop them.
//   * Nothing here sends a key anywhere. It only reads the ones you press.
//   * No score, no failure count, no streak. A wrong key says which key it
//     was and the right one; "Show me" gives the answer. Your quickest round
//     is kept on this computer, as a thing to enjoy, not to beat.
//
// Storage: localStorage `vex.keytrainer` { bestMs, rounds, learned: {id: true} }.
// Signals the medal `shortcut-trainer` after the first finished round.
const VexKeyTrainer = {
  KEY: 'vex.keytrainer',
  ROUND: 5,

  // Not asked: they would reach the main process or lock / hide the window.
  NEVER_ASK: ['lock-vex', 'private-window', 'fullscreen', 'free-memory', 'clear-data',
    'sleep-tab', 'close-tab', 'new-tab', 'print-page', 'screenshot'],

  _plainWords: { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' },

  candidates(all) {
    const out = [];
    const seen = new Set();
    for (const id of Object.keys(all || {})) {
      const d = all[id];
      if (!d || !d.current || !d.hasHandler || d.system || d.removable) continue;
      if (this.NEVER_ASK.includes(id)) continue;
      if (/^Ctrl\+Alt\+[0-9]$/.test(d.current)) continue;
      if (seen.has(d.current)) continue;
      seen.add(d.current);
      out.push({ id, label: d.label || id, combo: d.current, keys: d.current.split('+').length });
    }
    return out;
  },

  // Fisher-Yates over a copy.
  deck(all, n, rng) {
    const r = rng || Math.random;
    const pool = this.candidates(all);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.max(0, n));
  },

  // The prompt for one challenge, in the words the trainer is about.
  challengeText(c) {
    return c.label.replace(/\s*\(.*?\)\s*$/, '') + ' in ' + c.keys + ' key' + (c.keys === 1 ? '' : 's');
  },

  matches(combo, ev) {
    if (typeof ShortcutsRegistry === 'undefined') throw new Error('The shortcut registry is not loaded');
    return ShortcutsRegistry.eventToShortcut(ev) === combo;
  },

  _state() {
    const v = VexExpression.read(this.KEY, null);
    return {
      bestMs: v && Number.isFinite(v.bestMs) ? v.bestMs : null,
      rounds: v && Number.isInteger(v.rounds) ? v.rounds : 0,
      learned: v && v.learned && typeof v.learned === 'object' ? v.learned : {},
    };
  },
  stats() { return this._state(); },

  // Called when a round of ROUND challenges is done.
  finishRound(ms, ids) {
    const st = this._state();
    const isBest = st.bestMs == null || ms < st.bestMs;
    if (isBest) st.bestMs = Math.round(ms);
    st.rounds += 1;
    for (const id of ids || []) st.learned[id] = true;
    VexExpression.write(this.KEY, st);
    VexExpression.signal('shortcut-trainer');
    return { isBest, bestMs: st.bestMs, rounds: st.rounds };
  },

  open() {
    if (typeof ShortcutsRegistry === 'undefined') throw new Error('The shortcut registry is not loaded');
    const X = VexExpression;
    const all = ShortcutsRegistry.getAllShortcuts();
    const cards = this.deck(all, this.ROUND);
    if (!cards.length) { X.toast('No keys to practise in this window'); return null; }
    let i = 0;
    let shown = false;
    let roundStart = Date.now();
    let busy = false;
    const done = [];
    const kbd = (combo) => combo.split('+').map(k => `<kbd style="border:1px solid var(--border);border-radius:5px;padding:1px 6px;font-size:12.5px">${X.esc(k)}</kbd>`).join(' + ');
    const dlg = X.dialog('Keyboard practice', {
      noEscape: false,
      onClose: () => window.removeEventListener('keydown', onKey, true),
    });

    const drawCard = (feedback) => {
      const c = cards[i];
      shown = false;
      dlg.body.innerHTML = `
        <div style="font-size:11.5px;color:var(--text-muted)">${i + 1} of ${cards.length}</div>
        <div style="font-size:16px;font-weight:650;margin:6px 0 8px" data-kt-prompt>${X.esc(this.challengeText(c))}</div>
        <div style="font-size:12.5px;color:var(--text-muted);min-height:20px" data-kt-feedback>${feedback || 'Press the keys now. Nothing underneath will react.'}</div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button type="button" class="btn-secondary" data-kt-show>Show me</button>
          <button type="button" class="btn-secondary" data-kt-skip>Skip</button>
          <button type="button" class="btn-secondary" data-kt-close style="margin-left:auto">Close</button>
        </div>`;
      dlg.body.querySelector('[data-kt-show]').addEventListener('click', () => {
        shown = true;
        dlg.body.querySelector('[data-kt-feedback]').innerHTML = 'It is ' + kbd(c.combo) + '. Try it.';
      });
      dlg.body.querySelector('[data-kt-skip]').addEventListener('click', () => advance(false));
      dlg.body.querySelector('[data-kt-close]').addEventListener('click', () => dlg.close());
    };

    const finish = () => {
      window.removeEventListener('keydown', onKey, true);
      const ms = Date.now() - roundStart;
      let r = null;
      try { r = this.finishRound(ms, done); } catch (err) { X.toast(err.message, 'error'); }
      dlg.body.innerHTML = `
        <div style="font-size:15px;font-weight:650">Round finished</div>
        <div style="font-size:12.5px;color:var(--text-muted);margin:6px 0">${done.length} of ${cards.length} keys practised in ${VexKeyTrainer.formatMs(ms)}.${r && r.isBest && r.rounds > 1 ? ' That is your quickest round.' : ''}</div>
        <div style="display:flex;gap:8px;margin-top:12px"><button type="button" class="btn-secondary" data-kt-again>Another round</button><button type="button" class="btn-secondary" data-kt-close style="margin-left:auto">Close</button></div>`;
      dlg.body.querySelector('[data-kt-close]').addEventListener('click', () => dlg.close());
      dlg.body.querySelector('[data-kt-again]').addEventListener('click', () => { dlg.close(); VexKeyTrainer.open(); });
    };

    const advance = (ok) => {
      if (ok) done.push(cards[i].id);
      i += 1;
      if (i >= cards.length) finish(); else drawCard();
    };

    const onKey = (e) => {
      // Pure modifier presses are not an attempt.
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      // The overlay keeps its own keys: Escape closes it (the dialog's own
      // handler), Tab and Enter work its buttons.
      if (e.key === 'Escape' || e.key === 'Tab') return;
      if ((e.key === 'Enter' || e.key === ' ') && !e.ctrlKey && !e.altKey && !e.metaKey && e.target && e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (busy || i >= cards.length) return;
      const c = cards[i];
      const typed = ShortcutsRegistry.eventToShortcut(e);
      if (typed === c.combo) {
        busy = true;
        dlg.body.querySelector('[data-kt-feedback]').innerHTML = 'Yes: ' + kbd(c.combo);
        setTimeout(() => { busy = false; if (dlg.el.isConnected) advance(true); }, 450);
      } else if (typed) {
        dlg.body.querySelector('[data-kt-feedback]').innerHTML = 'That was ' + kbd(typed) + '. This one is ' + (shown ? kbd(c.combo) + '.' : 'a different key; try again, or press Show me.');
      }
    };
    window.addEventListener('keydown', onKey, true);
    roundStart = Date.now();
    drawCard();
    return dlg;
  },

  formatMs(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  },

  commands: [
    {
      id: 'keytrainer', label: 'Practise Vex Keys',
      hint: 'A short round of keyboard challenges made from your own shortcuts; only reads keys while it is open',
      icon: 'keyboard',
      action: () => { try { VexKeyTrainer.open(); } catch (err) { window.showToast?.(err.message, 'error'); } },
    },
  ],

  renderSettings(container) {
    const p = document.createElement('p');
    p.className = 'setting-info muted';
    p.style.margin = '0 0 6px';
    const st = this._state();
    p.textContent = 'Five short key challenges, made from the shortcuts you have now. Start from Ctrl+K: Practise Vex Keys.'
      + (st.rounds ? ' Rounds so far: ' + st.rounds + '.' : '');
    container.appendChild(p);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn-secondary'; b.textContent = 'Practise now';
    b.addEventListener('click', () => { try { this.open(); } catch (err) { window.showToast?.(err.message, 'error'); } });
    container.appendChild(b);
  },
};

if (typeof window !== 'undefined') window.VexKeyTrainer = VexKeyTrainer;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexKeyTrainer };
