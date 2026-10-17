// === Vex Agent: pinned tasks and the up-front estimate =========================
//
// Two small add-ons to the agent (js/agent-loop.js macros, js/agent-task-panel.js plan card).
//
//   Pinned tasks     a recorded task (a saved agent run, or one you taught with js/teach-mode.js)
//                    can be pinned as its own Ctrl+K command, "Run task: <name>". Choosing it
//                    first shows a dry-run preview of every step, which changes nothing, and runs
//                    only when you press Run. The run itself is the ordinary macro replay
//                    (AgentLoop.runMacro): same permission rules, it still asks at each step it
//                    asked at before, and it stops at the first step that fails.
//   Estimate         the plan card says how long the plan will take before you approve it. Local
//                    runs were measured at about 6.3 s a step (82 steps took 518 s). When the plan
//                    is long and your AI backend is the cloud one, the card offers the cloud for
//                    the agent: that is your own per-agent cloud setting (AgentSafety useCloud),
//                    asked about and switched only after you confirm, and every cloud request
//                    still passes the sensitivity gate (js/ai-sensitivity.js) before it leaves.
//
// Pure helpers have no DOM and are tested directly (tests/renderer/agentPins.test.js).
const VexAgentPins = {
  FEATURE: 'agent-pins',
  PREF: 'vex.agentPins.enabled',
  KEY: 'vex.agentPins.ids',
  MAX: 12,
  SECONDS_PER_STEP_LOCAL: 6.3,   // measured: 82 steps = 518 s
  LONG_RUN_SECONDS: 120,         // above this the card mentions the cloud option
  _cmdIds: [],

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('The setting could not be saved: ' + err.message, { cause: err }); }
    this.sync();
    return !!on;
  },

  // ---- the estimate (pure) --------------------------------------------------------------------
  duration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return s + ' s';
    const m = Math.floor(s / 60), r = s % 60;
    return m + ' min' + (r ? ' ' + r + ' s' : '');
  },

  // steps: a count. backend: 'local' | 'cloud'. -> { steps, seconds, text, overBudget }
  estimate(steps, { backend = 'local', maxMinutes = 0 } = {}) {
    const n = Math.max(0, Math.floor(Number(steps) || 0));
    if (backend === 'cloud') {
      return { steps: n, seconds: null, overBudget: false, text: n + ' step' + VexPlural.s(n) + ' on the cloud model. How long that takes depends on the pages; it has not been measured.' };
    }
    const seconds = Math.round(n * this.SECONDS_PER_STEP_LOCAL);
    const over = maxMinutes > 0 && seconds > maxMinutes * 60;
    return {
      steps: n, seconds, overBudget: over,
      text: 'About ' + this.duration(seconds) + ' for ' + n + ' step' + VexPlural.s(n) + ' on the local model (about ' + this.SECONDS_PER_STEP_LOCAL + ' s a step, measured).'
        + (over ? ' That is more than your ' + maxMinutes + ' minute budget, so the run would stop before the end.' : ''),
    };
  },

  // Is the cloud worth offering? Only when the run is long, runs locally now, the AI backend is the
  // cloud one (the agent can use it) and the per-agent setting is still off. Never when it is on.
  cloudOffer({ est, backend, prefs, status }) {
    if (!est || est.seconds == null || backend !== 'local') return null;
    if (est.seconds < this.LONG_RUN_SECONDS && !est.overBudget) return null;
    if (!status || status.forceCloud !== true) return null;
    if (prefs && prefs.useCloud === true) return null;
    return {
      text: 'This is a long run for the local model. Your AI backend is the cloud one, so the agent could use it instead. The text of the pages it reads would be sent to it, after the sensitivity gate has looked at it.',
      button: 'Use the cloud for the agent...',
    };
  },

  // Under a plan card: the estimate line and, when it applies, the cloud offer. Returns the element.
  planNote({ stepCount, backend, prefs, status, onOffer }) {
    const est = this.estimate(stepCount, { backend, maxMinutes: prefs && prefs.maxMinutes });
    const box = document.createElement('div');
    box.className = 'vex-at-note vex-at-estimate';
    box.setAttribute('role', 'note');
    const line = document.createElement('div');
    line.textContent = est.text;
    box.appendChild(line);
    const offer = this.cloudOffer({ est, backend, prefs, status });
    if (offer && typeof onOffer === 'function') {
      const p = document.createElement('div');
      p.textContent = offer.text;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'vex-at-btn'; b.textContent = offer.button;
      b.addEventListener('click', onOffer);
      box.append(p, b);
    }
    return box;
  },

  // The confirm behind the offer. Turns on the owner's own per-agent cloud setting, nothing more.
  async allowCloud() {
    if (typeof AgentSafety === 'undefined' || typeof AgentSafety.setPrefs !== 'function') throw new Error('The agent settings are not available');
    const ok = await window.vexConfirm({
      title: 'Use the cloud model for the agent?',
      message: 'The agent would send the text of the pages it reads to your cloud AI. Every request still goes through the sensitivity gate, which blocks private tabs, password pages and secrets and asks before mail, bank or health pages leave. This turns on the "use cloud" setting for the agent; you can turn it off in the agent panel.',
      okLabel: 'Use the cloud',
    });
    if (!ok) return false;
    AgentSafety.setPrefs({ useCloud: true });
    if (typeof VexLedger !== 'undefined') VexLedger.note({ feature: this.FEATURE, what: 'Allowed the cloud model for the agent task runner', why: 'You chose it on a long plan\'s card; requests still pass the sensitivity gate.' });
    return true;
  },

  // ---- pinned tasks (pure) ----------------------------------------------------------------------------
  describeCall(call) {
    const p = (call && call.parameters) || {};
    const short = (v, n = 70) => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '...' : s; };
    const secret = /pass|secret|token|card|otp|code|pin/i;
    switch (call && call.tool) {
      case 'navigate': return 'Open ' + short(p.url);
      case 'click_text': return 'Click "' + short(p.text, 40) + '"';
      case 'click': return 'Click ' + short(p.selector, 50);
      case 'type_text': return 'Type into ' + short(p.selector, 40) + (secret.test(String(p.selector || '')) ? ' (value hidden)' : ': "' + short(p.text, 40) + '"');
      case 'select_option': return 'Choose "' + short(p.value, 40) + '" in ' + short(p.selector, 40);
      case 'hand_over': return 'Hand over to you: ' + short(p.why, 80);
      case 'wait': return 'Wait';
      case 'scroll': return 'Scroll';
      default: {
        const bits = Object.entries(p).slice(0, 3).map(([k, v]) => k + ': ' + (secret.test(k) ? '(hidden)' : short(v, 30)));
        return String(call && call.tool || 'step') + (bits.length ? ' (' + bits.join(', ') + ')' : '');
      }
    }
  },

  // The dry run: what replaying would do, in order. Nothing is executed to make it.
  dryRun(macro) {
    if (!macro || !Array.isArray(macro.calls) || !macro.calls.length) throw new Error('That task has no steps');
    const lines = macro.calls.map((c, i) => (i + 1) + '. ' + this.describeCall(c));
    return { title: 'Run "' + String(macro.name || 'task').slice(0, 60) + '"?', lines, text: lines.join('\n'), count: lines.length };
  },

  // ---- pins ----------------------------------------------------------------------------------------------
  pinned() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); } catch (err) { throw new Error('The pinned tasks could not be read: ' + err.message, { cause: err }); }
    if (!raw) return [];
    let a;
    try { a = JSON.parse(raw); } catch (err) { throw new Error('The saved pinned tasks are damaged: ' + err.message, { cause: err }); }
    return Array.isArray(a) ? a.filter(x => typeof x === 'string') : [];
  },
  _save(ids) {
    try { localStorage.setItem(this.KEY, JSON.stringify(ids.slice(0, this.MAX))); }
    catch (err) { throw new Error('The pinned tasks could not be saved: ' + err.message, { cause: err }); }
  },
  _macros() {
    if (typeof AgentLoop === 'undefined' || typeof AgentLoop.macros !== 'function') throw new Error('Saved agent tasks are not available in this build');
    return AgentLoop.macros();
  },
  pin(id) {
    if (!this._macros().some(m => m.id === id)) throw new Error('That saved task is gone');
    const ids = this.pinned();
    if (ids.includes(id)) return false;
    if (ids.length >= this.MAX) throw new Error('At most ' + this.MAX + ' pinned tasks: unpin one first');
    ids.push(id);
    this._save(ids);
    this.sync();
    return true;
  },
  unpin(id) {
    this._save(this.pinned().filter(x => x !== id));
    this.sync();
  },

  commandId(id) { return 'agent-pin:' + id; },

  // Runs after a dry-run preview. The replay is AgentLoop.runMacro, unchanged.
  async runPinned(id) {
    if (!this.enabled()) throw new Error('Pinned tasks are switched off in Settings');
    const macro = this._macros().find(m => m.id === id);
    if (!macro) { this.unpin(id); throw new Error('That saved task is gone, so its command was removed'); }
    const d = this.dryRun(macro);
    const ok = await window.vexConfirm({ title: d.title, message: 'Dry run: these ' + d.count + ' steps, in this order. Nothing has been done yet, and each step still asks the way it did when you recorded it.\n\n' + d.text, okLabel: 'Run it' });
    if (!ok) return null;
    if (typeof AIPanel !== 'undefined' && typeof AIPanel.isOpen === 'function' && !AIPanel.isOpen()) AIPanel.toggle();
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    return AgentLoop.runMacro(id);
  },

  // Makes the command bar's entries match the pins. Safe to call again.
  sync() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return 0;
    // Removed in place: other modules hold this same array.
    for (let i = CommandBar.commands.length - 1; i >= 0; i--) if (this._cmdIds.includes(CommandBar.commands[i].id)) CommandBar.commands.splice(i, 1);
    this._cmdIds = [];
    if (!this.enabled()) return 0;
    let ids, macros;
    try { ids = this.pinned(); macros = this._macros(); }
    catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Pinned tasks', 'Could not add the pinned commands', err); return 0; }
    for (const id of ids) {
      const m = macros.find(x => x.id === id);
      if (!m) continue;
      const cid = this.commandId(id);
      this._cmdIds.push(cid);
      CommandBar.commands.push({
        id: cid, label: 'Run task: ' + String(m.name).slice(0, 60), hint: m.calls.length + ' steps, no AI. Shows a dry run first.', icon: 'refresh',
        action: () => { this.runPinned(id).catch(err => window.showToast?.((err && err.message) || 'Could not run it', 'error')); },
      });
    }
    return this._cmdIds.length;
  },

  async _choose(title, list) {
    const pick = await window.vexPrompt({
      title,
      message: list.map((m, i) => (i + 1) + '. ' + m.name + ' (' + m.calls.length + ' steps)').join('\n'),
      value: '1', okLabel: 'Choose',
    });
    if (pick == null) return null;
    const chosen = list[parseInt(pick, 10) - 1];
    if (!chosen) throw new Error('Type one of the numbers in the list');
    return chosen;
  },

  async pinDialog() {
    const all = this._macros();
    const pinned = this.pinned();
    const list = all.filter(m => !pinned.includes(m.id));
    if (!list.length) throw new Error(all.length ? 'Every saved task is already pinned' : 'No saved tasks yet: run something as an agent, then "Save as a task" in the AI history');
    const m = await this._choose('Pin a task to Ctrl+K', list);
    if (!m) return null;
    this.pin(m.id);
    window.showToast?.('Pinned: Ctrl+K, "Run task: ' + m.name.slice(0, 40) + '"');
    return m;
  },

  async unpinDialog() {
    const pinned = this.pinned();
    const list = this._macros().filter(m => pinned.includes(m.id));
    if (!list.length) throw new Error('No tasks are pinned');
    const m = await this._choose('Unpin a task', list);
    if (!m) return null;
    this.unpin(m.id);
    window.showToast?.('Unpinned "' + m.name.slice(0, 40) + '"');
    return m;
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Pin a recorded agent task as its own Ctrl+K command. Choosing it shows a dry run of every step first and runs only when you press Run it; the replay is the normal one and still asks where it asked before. Plan cards also say how long a run will take.'));
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px';
    const fail = (e) => window.showToast?.((e && e.message) || String(e), 'error');
    row.append(
      G.button('Pin a task', () => { this.pinDialog().catch(fail); }, { primary: true }),
      G.button('Unpin a task', () => { this.unpinDialog().catch(fail); }),
    );
    el.appendChild(row);
    let n = 0;
    try { n = this.pinned().length; } catch (e) { el.appendChild(G.note(e.message)); }
    el.appendChild(G.note(n + ' pinned.'));
  },

  init() {
    if (this._wired) return this;
    this._wired = true;
    this.sync();
    return this;
  },
};

if (typeof window !== 'undefined') {
  window.VexAgentPins = VexAgentPins;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'agent-pins', title: 'Pinned agent tasks', keywords: 'agent task macro pin ctrl+k command dry run preview estimate cloud', build: (el) => VexAgentPins.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    VexExtras.registerCommand({ id: 'agent-pin-task', label: 'Pin a Saved Task to Ctrl+K', hint: 'Make a recorded agent task its own command, with a dry run before it runs', icon: 'pin', action: () => { VexAgentPins.pinDialog().catch(fail); } });
    VexExtras.registerCommand({ id: 'agent-unpin-task', label: 'Unpin a Task From Ctrl+K', hint: 'Remove a pinned agent task command', icon: 'pin', action: () => { VexAgentPins.unpinDialog().catch(fail); } });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'complete') VexAgentPins.init();
    else window.addEventListener('load', () => VexAgentPins.init(), { once: true });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexAgentPins };
