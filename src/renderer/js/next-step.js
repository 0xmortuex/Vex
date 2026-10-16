// === Next step per workspace, and "the one next thing" =========================
//
// Each workspace gets ONE field: the very next physical step ("open the PR and
// fix the failing test"). The Morning Brief then shows a single card, never a
// list, chosen from three things Vex already knows:
//
//   what is due        js/dueness.js        an overdue item wins
//   the next step      this file            the active workspace's line
//   the block          js/focus-os.js       if a Focus OS block is running, the
//                                           card says when it ends
//
// The active workspace's step also shows as the tooltip of the workspace
// button in the tab strip ("Next: ..."), so it is one hover away everywhere.
//
// (js/next-action.js is a different thing: it learns which command usually
// follows which. This one is a sentence you write.)
//
//   VexNextStep.get(wsId) / set(wsId, text) / clear(wsId)
//   VexNextStep.pick({ due, step, block, now })   pure: the one card, or null
//   Ctrl+K "Set my next step" and "Clear my next step"

const VexNextStep = {
  KEY: 'vex.nextStep',             // { "<workspace id>": { text, at } }
  PREF: 'vex.nextStep.enabled',    // 'off' hides the card and the tooltip
  MAX_TEXT: 160,
  SOON_MS: 90 * 60000,             // a timed item this close wins over the step

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    this.paint();
    return !!on;
  },

  // ---- storage ---------------------------------------------------------------------
  _all() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return {};
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The next steps could not be read: ' + err.message); }
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  },
  get(wsId) {
    const e = this._all()[wsId];
    return e && typeof e.text === 'string' && e.text ? { text: e.text, at: Number(e.at) || 0 } : null;
  },
  set(wsId, text, now = Date.now()) {
    if (typeof wsId !== 'string' || !wsId) throw new Error('Which workspace?');
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!t) return this.clear(wsId);
    if (t.length > this.MAX_TEXT) throw new Error('Keep it to one step: ' + this.MAX_TEXT + ' characters at most');
    const all = this._all();
    all[wsId] = { text: t, at: now };
    localStorage.setItem(this.KEY, JSON.stringify(all));
    this.paint();
    return all[wsId];
  },
  clear(wsId) {
    const all = this._all();
    if (!(wsId in all)) return null;
    delete all[wsId];
    localStorage.setItem(this.KEY, JSON.stringify(all));
    this.paint();
    return null;
  },
  activeId() { return typeof WorkspaceManager !== 'undefined' ? WorkspaceManager.activeId : 'ws_personal'; },
  activeName() { try { return (WorkspaceManager.getActive() || {}).name || ''; } catch { return ''; } },

  // ---- the choice (pure) -------------------------------------------------------------
  // due: the top ranked due item { text, at, hasTime, reason: { group, label } } or null
  // step: { text } or null     block: { goal, end } of a running Focus OS block or null
  pick({ due = null, step = null, block = null, now = Date.now() } = {}) {
    const withBlock = (card) => (block && block.end > now ? { ...card, block: block.goal + ' until ' + this._hhmm(block.end) } : card);
    const dueCard = due ? { kind: 'due', text: due.text, why: due.reason.label } : null;
    const stepCard = step ? { kind: 'step', text: step.text, why: 'Your next step' } : null;
    if (dueCard && due.reason.group === 0) return withBlock(dueCard);
    if (dueCard && due.reason.group === 1 && due.hasTime && due.at - now <= this.SOON_MS) return withBlock(dueCard);
    if (stepCard) return withBlock(stepCard);
    if (dueCard && due.reason.group <= 1) return withBlock(dueCard);
    return null;
  },
  _hhmm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); },

  _block() {
    if (typeof FocusOS === 'undefined') return null;
    const b = FocusOS.active();
    if (!b) return null;
    const g = FocusOS.goal(b.goalId);
    return { goal: g ? g.title : 'a focus block', end: b.end };
  },

  async current(now = Date.now()) {
    let due = null;
    if (typeof VexDueness !== 'undefined' && VexDueness.enabled()) {
      const { rows } = await VexDueness.top(1, now);
      due = rows[0] || null;
    }
    return this.pick({ due, step: this.get(this.activeId()), block: this._block(), now });
  },

  // ---- surfaces -----------------------------------------------------------------------
  section() {
    return {
      id: 'next-step', title: 'The one next thing', icon: 'target', order: 1, defaultOn: true, maxItems: 1,
      build: async (ctx = {}) => {
        if (!this.enabled()) return null;
        const card = await this.current(ctx.now || Date.now());
        if (!card) return { hint: 'Nothing is pressing. Ctrl+K › Set my next step to write the very next move for ' + (this.activeName() || 'this workspace') + '.' };
        return { items: [{ text: card.text, sub: card.block ? 'In ' + card.block : (card.kind === 'step' ? (this.activeName() || 'Workspace') : 'Due'), badge: card.why.slice(0, 24) }] };
      },
    };
  },

  // The workspace button's tooltip: "Work. Next: fix the failing test".
  paint() {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('workspace-btn');
    if (!btn) return;
    const s = this.enabled() ? this.get(this.activeId()) : null;
    if (s) btn.title = (this.activeName() ? this.activeName() + '. ' : '') + 'Next: ' + s.text;
    else btn.removeAttribute('title');
  },

  async edit() {
    if (!this.enabled()) { window.showToast?.('Next steps are switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('next-step');
    const id = this.activeId();
    const cur = this.get(id);
    const text = await window.vexPrompt({ title: 'Next step in ' + (this.activeName() || 'this workspace'), message: 'The very next physical step, one line. Leave it empty to clear it.', value: cur ? cur.text : '', placeholder: 'Open the PR and fix the failing test', okLabel: 'Save' });
    if (text == null) return;
    try { this.set(id, text); } catch (err) { window.showToast?.(err.message, 'error'); return; }
    if (typeof VexBrief !== 'undefined') VexBrief.refresh?.(true);
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    document.addEventListener('vex:workspace-switched', () => { this.paint(); if (typeof VexBrief !== 'undefined') VexBrief.refresh?.(); });
    this.paint();
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('One line per workspace: the very next physical step. The New Tab brief shows a single card, "the one next thing", picked from what is due, your next step and any running focus block.'));
    el.appendChild(VexSettingsGroups.button('Set my next step', () => this.edit(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexNextStep = VexNextStep;
  if (typeof VexBrief !== 'undefined') VexBrief.register(VexNextStep.section());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'next-step', title: 'Next step', keywords: 'next step action workspace one next thing focus', before: 'about', build: (el) => VexNextStep.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'next-step-set', label: 'Set my next step', hint: 'The very next move in this workspace', icon: 'target', action: () => VexNextStep.edit() });
    VexExtras.registerCommand({ id: 'next-step-clear', label: 'Clear my next step', hint: 'Remove the next step of this workspace', icon: 'x', action: () => { try { VexNextStep.clear(VexNextStep.activeId()); window.showToast?.('Next step cleared'); } catch (err) { window.showToast?.(err.message, 'error'); } } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexNextStep };
