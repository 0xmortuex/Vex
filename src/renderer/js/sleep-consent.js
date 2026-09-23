// === Nothing sleeps behind your back =======================================
//
// Vex had four separate things that would put a tab or a panel to sleep on
// their own: the idle panel timer, the idle tab timer, Discord's memory watch,
// and gaming mode — which sleeps EVERY background tab and every hidden panel
// the moment a game starts, and is on unless you turn it off. Alt-tab into a
// game, come back, and the page you were reading has reloaded.
//
// Each was defensible on its own. Together they meant a browser that closed
// your work to save memory nobody asked it to save, and there was no single
// place to say no.
//
// This is that place. One setting governs every unattended sleeper:
//
//   ask     (the default) — a notice that waits, and doing nothing is a no
//   auto    — what Vex used to do, for anyone who wants the memory back
//   never   — nothing is ever slept unless you press something yourself
//
// It governs the UNATTENDED ones only. Pressing "Sleep it now", "Free memory
// now", or a keep-awake card is permission: the button IS the answer, and
// asking again would be theatre.
const SleepConsent = {
  KEY: 'vex.sleepConsent',
  QUIET_MS: 4 * 3600000,
  GONE_MS: 30000,

  mode() {
    let v = null;
    try { v = localStorage.getItem(this.KEY); } catch { v = null; }
    return (v === 'auto' || v === 'never') ? v : 'ask';
  },

  set(mode) {
    if (!['ask', 'auto', 'never'].includes(mode)) throw new Error('Vex can ask, do it automatically, or never do it');
    try { localStorage.setItem(this.KEY, mode); }
    catch (err) { console.error('[SleepConsent] the choice could not be saved:', err.message); }
    document.dispatchEvent(new CustomEvent('vex:sleep-consent', { detail: { mode } }));
    return mode;
  },

  // May this happen with nobody watching?
  auto() { return this.mode() === 'auto'; },
  never() { return this.mode() === 'never'; },

  _quiet: {},

  // Ask. Returns true when the question was put (or when the answer was
  // already "always" and the work has been done), false when it was not asked
  // — because the answer is standing, or because it was asked recently.
  //
  // `run` is called only on a yes. An unanswered notice expires and nothing
  // happens, because that is what ignoring a question means.
  ask({ id, title, detail, yes, run }) {
    if (typeof run !== 'function') throw new Error('There is nothing to do on a yes');
    const mode = this.mode();
    if (mode === 'never') return false;
    if (mode === 'auto') { run(); return true; }
    if (typeof document === 'undefined') return false;
    const key = id || 'sleep';
    if ((this._quiet[key] || 0) > Date.now()) return false;
    if (document.getElementById('vex-sleep-ask')) return false;   // one at a time

    const esc = (v) => (window.escapeHtml ? window.escapeHtml(String(v)) : String(v));
    const bar = document.createElement('div');
    bar.id = 'vex-sleep-ask';
    bar.className = 'vexslow-notice';
    bar.dataset.ask = key;
    bar.innerHTML = '<span>' + esc(title) + (detail ? '<br><small style="opacity:.75">' + esc(detail) + '</small>' : '') + '</span>';
    const done = () => bar.remove();
    const act = (label, hint, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = hint;
      b.addEventListener('click', fn);
      bar.appendChild(b);
    };
    const go = () => {
      try { run(); }
      catch (err) { window.showToast?.((err && err.message) || 'That did not work', 'error'); }
    };
    act(yes || 'Let them sleep', 'Free the memory now', () => { done(); go(); });
    act('Not now', 'Leave them alone — Vex will not ask again for four hours', () => {
      done();
      this._quiet[key] = Date.now() + this.QUIET_MS;
      window.showToast?.('Left alone — Vex will not ask again for four hours');
    });
    act('Always', 'Do this from now on without asking', () => {
      done();
      this.set('auto');
      go();
      window.showToast?.('Vex will free memory by itself from now on — Settings › Performance changes it back');
    });
    document.body.appendChild(bar);
    // Ignoring it is a no.
    setTimeout(() => { if (bar.isConnected) bar.remove(); }, this.GONE_MS);
    return true;
  },

  // A game is the one moment a question cannot be answered: the screen is not
  // Vex's. So gaming mode does not ask mid-game — it leaves everything alone
  // and offers, once, when the game has finished.
  offerAfterGame(what) {
    if (this.mode() !== 'ask') return false;
    if (this._offered) return false;
    this._offered = true;
    return this.ask({
      id: 'gaming',
      title: 'Vex left your tabs alone while ' + (what || 'the game') + ' was running.',
      detail: 'It can free that memory for the game next time — background tabs and hidden panels sleep and come back when you open them.',
      yes: 'Do that next time',
      run: () => {},        // "Always" is the only answer that changes anything
    });
  },
};

if (typeof window !== 'undefined') window.SleepConsent = SleepConsent;
if (typeof module !== 'undefined' && module.exports) module.exports = { SleepConsent };
