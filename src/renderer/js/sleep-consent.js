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
//   never   (the default) — nothing is ever slept unless you press something
//   ask     — a notice that waits, and doing nothing is a no
//   auto    — what Vex used to do, for anyone who wants the memory back
//
// and ONE function, gate(), is what every unattended sleeper calls: idle tabs,
// idle panels, the memory ceiling, the discard while Vex is behind another
// app, Discord's idle sleep and refresh, gaming mode. None has a consent of
// its own. (Discord had one, vex.discordMemoryConsent, and a saved "ask" in it
// beat a "never" here; a hidden 30-minute tab hibernation in webview.js had
// none at all and blanked tabs under "never". Both are gone — migrateOnce.)
//
// The default is `never` because asking was not enough. Vex had SIX of these,
// and the two found last were the ones doing the damage: the memory guard,
// which sleeps idle tabs whenever Vex is over its ceiling, and idle discard,
// which sleeps every background tab three minutes after the Vex window goes
// behind another app. That last one is why switching to another program and
// back reloaded the tab you were reading — reported twice, once as "the
// claude tab resets", once as "apps like discord and claude keep closing".
//
// Under "ask", "Always" on a notice answers for THAT kind only (idle tabs,
// idle panels, Discord, the memory ceiling, gaming) — one click on a tabs
// notice used to switch every sleeper to automatic.
//
// Memory can still be freed the moment you want it freed: Free memory now,
// Sleep it now, the keep-awake card. And Vex still SAYS when something has
// grown — a notice is information, not an action.
//
// It governs the UNATTENDED ones only. Pressing "Sleep it now", "Free memory
// now", or a keep-awake card is permission: the button IS the answer, and
// asking again would be theatre.
const SleepConsent = {
  KEY: 'vex.sleepConsent',
  ALWAYS_KEY: 'vex.sleepAlways',
  QUIET_MS: 4 * 3600000,
  GONE_MS: 30000,

  // The kinds a notice can be about, and what "Always" on it covers.
  KINDS: {
    tabs: 'idle tabs',
    panels: 'idle panels',
    discord: 'Discord',
    guard: 'the memory ceiling',
    gaming: 'gaming mode',
  },

  mode() {
    let v = null;
    try { v = localStorage.getItem(this.KEY); } catch { v = null; }
    return (v === 'auto' || v === 'ask') ? v : 'never';
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

  // ---- "Always", per kind -----------------------------------------------------
  always() {
    let a = [];
    try { a = JSON.parse(localStorage.getItem(this.ALWAYS_KEY) || '[]'); } catch { a = []; }
    return Array.isArray(a) ? a.filter(k => Object.prototype.hasOwnProperty.call(this.KINDS, k)) : [];
  },
  allowKind(kind) {
    if (!Object.prototype.hasOwnProperty.call(this.KINDS, kind)) throw new Error('Vex does not sleep "' + kind + '" by itself');
    const a = this.always();
    if (!a.includes(kind)) a.push(kind);
    try { localStorage.setItem(this.ALWAYS_KEY, JSON.stringify(a)); }
    catch (err) { console.error('[SleepConsent] the answer could not be saved:', err.message); }
    document.dispatchEvent(new CustomEvent('vex:sleep-consent', { detail: { mode: this.mode(), always: a } }));
    return a;
  },
  clearAlways() {
    try { localStorage.removeItem(this.ALWAYS_KEY); }
    catch (err) { console.error('[SleepConsent] could not clear the answers:', err.message); }
    document.dispatchEvent(new CustomEvent('vex:sleep-consent', { detail: { mode: this.mode(), always: [] } }));
  },

  // What applies to one kind: "never" beats everything; under "ask", a kind
  // answered "Always" is automatic.
  modeFor(kind) {
    const m = this.mode();
    if (m === 'ask' && kind && this.always().includes(kind)) return 'auto';
    return m;
  },

  // Once, on the first start of this version: a saved "auto" or "ask" goes
  // back to never. Changing the DEFAULT to never (v2.32.84) did nothing for
  // anyone who had already answered one of the notices — a saved choice
  // beats a default — and the "Always" button on those notices saved
  // "auto". So the user who asked, twice, for Vex to stop closing Discord and
  // Claude kept a profile that told it to, and Discord went on being slept
  // after fifteen hidden minutes (found in the profile 2026-09-27:
  // vex.sleepConsent = "auto"). Settings › Performance turns it back on, and
  // this never runs again, so a choice made after it is kept.
  RESET_KEY: 'vex.sleepConsentReset',
  DISCORD_KEY: 'vex.discordMemoryConsent',
  resetOnce() {
    try {
      if (localStorage.getItem(this.RESET_KEY)) return false;
      localStorage.setItem(this.RESET_KEY, '1');
      let changed = false;
      const was = localStorage.getItem(this.KEY);
      if (was === 'auto' || was === 'ask') { localStorage.setItem(this.KEY, 'never'); changed = true; }
      // Discord's own answer, saved by its notice the same way.
      if (localStorage.getItem(this.DISCORD_KEY) === 'auto') { localStorage.removeItem(this.DISCORD_KEY); changed = true; }
      return changed;
    } catch (err) {
      console.error('[SleepConsent] could not reset the saved choice:', err.message);
      return false;
    }
  },

  // Once: the two keys that let something sleep around this setting go.
  // vex.discordMemoryConsent (a saved "ask"/"auto" for Discord beat "never"
  // here) and vex.tabHibernateMinutes (the hidden tab hibernation, now
  // removed — auto-sleep is the one idle timer for tabs). Nothing is carried
  // over: the choice in Settings › Performance is the only answer.
  MODEL_KEY: 'vex.sleepModelOne',
  migrateOnce() {
    try {
      if (localStorage.getItem(this.MODEL_KEY)) return false;
      localStorage.setItem(this.MODEL_KEY, '1');
      const had = localStorage.getItem(this.DISCORD_KEY) != null || localStorage.getItem('vex.tabHibernateMinutes') != null;
      localStorage.removeItem(this.DISCORD_KEY);
      localStorage.removeItem('vex.tabHibernateMinutes');
      return had;
    } catch (err) {
      console.error('[SleepConsent] could not remove the old sleep keys:', err.message);
      return false;
    }
  },

  _quiet: {},

  // THE gate. Every unattended sleep, discard, blank or refresh calls this and
  // nothing else. Returns true when the work was done or the question put,
  // false when it was not — because the answer is never, because it cannot be
  // asked right now (canAsk:false, e.g. while Vex is behind another app), or
  // because it was asked recently.
  //
  // `run` is called only on a yes. An unanswered notice expires and nothing
  // happens, because that is what ignoring a question means.
  gate({ id, kind, title, detail, yes, run, canAsk = true, offerAlways = true }) {
    if (typeof run !== 'function') throw new Error('There is nothing to do on a yes');
    const k = kind || id;
    const mode = this.modeFor(k);
    if (mode === 'never') return false;
    if (mode === 'auto') { run(); return true; }
    if (!canAsk || typeof document === 'undefined') return false;
    const key = id || k || 'sleep';
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
    const what = this.KINDS[k];
    act(yes || 'Let them sleep', 'Free the memory now', () => { done(); go(); });
    act('Not now', 'Leave them alone — Vex will not ask again for four hours', () => {
      done();
      this._quiet[key] = Date.now() + this.QUIET_MS;
      window.showToast?.('Left alone — Vex will not ask again for four hours');
    });
    if (offerAlways && what) {
      act('Always', 'Do this for ' + what + ' from now on without asking — everything else still asks', () => {
        done();
        this.allowKind(k);
        go();
        window.showToast?.('Vex will free memory from ' + what + ' without asking from now on — everything else still asks. Settings › Performance changes it back');
      });
    }
    document.body.appendChild(bar);
    // Ignoring it is a no.
    setTimeout(() => { if (bar.isConnected) bar.remove(); }, this.GONE_MS);
    return true;
  },

  // The old name; same gate.
  ask(opts) { return this.gate(opts); },

  // A game is the one moment a question cannot be answered: the screen is not
  // Vex's. So gaming mode does not ask mid-game — it leaves everything alone
  // and offers, once, when the game has finished. Yes means "next time":
  // gaming mode then sleeps by itself, and nothing else changes.
  offerAfterGame(what) {
    if (this.modeFor('gaming') !== 'ask') return false;
    if (this._offered) return false;
    this._offered = true;
    return this.gate({
      id: 'gaming',
      title: 'Vex left your tabs alone while ' + (what || 'the game') + ' was running.',
      detail: 'It can free that memory for the game next time — background tabs and hidden panels sleep and come back when you open them.',
      yes: 'Do that next time',
      offerAlways: false,
      run: () => {
        this.allowKind('gaming');
        window.showToast?.('Next time a game starts, Vex sleeps background tabs and hidden panels by itself — everything else still asks. Settings › Performance changes it back');
      },
    });
  },

  // ---- Settings › Performance ------------------------------------------------
  // Under "never", every row that only matters when Vex may sleep things by
  // itself (marked data-sleep-dependent) is greyed out, with one line why.
  // Under "ask", the kinds answered "Always" are listed with a way back.
  renderSettingsState(root) {
    if (typeof document === 'undefined') return;
    root = root || document;
    const off = this.never();
    root.querySelectorAll('[data-sleep-dependent]').forEach(row => {
      row.style.opacity = off ? '0.5' : '';
      row.title = off ? 'Off while “Before Vex puts anything to sleep on its own” is set to never' : '';
      row.querySelectorAll('input, select, button').forEach(el => {
        if (off && !el.disabled) { el.disabled = true; el.dataset.sleepDisabled = '1'; }
        else if (!off && el.dataset.sleepDisabled === '1') { el.disabled = false; delete el.dataset.sleepDisabled; }
      });
    });
    const note = document.getElementById('sleep-consent-note');
    if (!note) return;
    note.textContent = '';
    if (off) {
      note.textContent = 'Off — Vex never sleeps, blanks or refreshes a tab or panel by itself, so the greyed-out rows below wait for this choice. Resting Discord, clearing its cache and unloading the AI model still run: they reload nothing.';
      return;
    }
    const a = this.always();
    if (this.mode() === 'ask' && a.length) {
      note.appendChild(document.createTextNode('Without asking (you pressed Always): ' + a.map(k => this.KINDS[k]).join(', ') + '. '));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-secondary';
      b.textContent = 'Ask about these again';
      b.addEventListener('click', () => { this.clearAlways(); window.showToast?.('Vex will ask again before anything sleeps'); });
      note.appendChild(b);
    }
  },
};

if (typeof window !== 'undefined') {
  window.SleepConsent = SleepConsent;
  // After the file store has filled browser storage (js/storage.js), which
  // is authoritative: a key removed before that can be written back from the
  // file's copy. Nothing reads either key any more, so the wait costs nothing.
  const afterHydration = (fn, tries = 0) => {
    const ps = window.PersistentStorage;
    if (!ps || ps._readyPromise || tries > 600) {
      Promise.resolve(ps && ps._readyPromise).then(fn, fn);
      return;
    }
    setTimeout(() => afterHydration(fn, tries + 1), 100);
  };
  afterHydration(() => SleepConsent.migrateOnce());
  // Before any sleeper's first check (they start seconds after this script).
  if (SleepConsent.resetOnce()) {
    setTimeout(() => window.showToast?.('Vex no longer puts Discord, Claude or your tabs to sleep by itself — Settings › Performance turns it back on', 'info', 9000), 6000);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('vex:sleep-consent', () => SleepConsent.renderSettingsState());
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { SleepConsent };
