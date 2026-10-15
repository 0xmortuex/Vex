// === Brief extra: One new thing ===============================================
//
// Each day suggests ONE Vex feature the user has no record of using yet.
// "Used" is read from what Vex already keeps (VexFeatures.used: the command
// bar's usage counts and the sidebar's per-panel stamps); nothing new is
// tracked about the person. The suggestion rotates: the feature shown least
// recently comes first, and the day's pick is pinned so it does not change on
// every refresh.
//
// Section object for the Morning Brief registry (VexBrief.register):
//   { id, title, build(), isEnabled() }
// build() returns null (nothing to show) or
//   { id, title, icon, lines: [{ text, detail, actions: [{ label, icon, run }] }] }
//
// State (localStorage vex.brief.oneNew):
//   shownAt { featureId: ms }   when it was last suggested (the rotation)
//   never   [featureId]         "never show this one again"
//   pick    { day, id }         today's pinned suggestion
//   skipDay 'YYYY-MM-DD'        "not today" hides the card for the rest of the day
// The whole card is switched off in the brief extras settings (vex.briefExtras.oneNew).
const VexBriefOneNew = {
  id: 'one-new-thing',
  title: 'One new thing',
  icon: 'sparkles',
  STATE_KEY: 'vex.brief.oneNew',
  SETTINGS_KEY: 'vex.briefExtras',
  MAX_NEVER: 200,

  _json(key, fb) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fb : v; }
    catch { return fb; }
  },

  isEnabled() {
    const s = this._json(this.SETTINGS_KEY, {});
    return !(s && s.oneNew === false);
  },

  dayKey(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  state() {
    const s = this._json(this.STATE_KEY, {});
    return {
      shownAt: (s.shownAt && typeof s.shownAt === 'object') ? s.shownAt : {},
      never: Array.isArray(s.never) ? s.never.filter(x => typeof x === 'string') : [],
      pick: (s.pick && typeof s.pick === 'object') ? s.pick : null,
      skipDay: typeof s.skipDay === 'string' ? s.skipDay : '',
    };
  },

  _save(st) {
    st.never = st.never.slice(-this.MAX_NEVER);
    localStorage.setItem(this.STATE_KEY, JSON.stringify(st));
  },

  // Pure. Which feature to suggest for `today`, given what is used and the state.
  // Returns a feature or null. Does not write anything.
  choose(items, isUsed, st, today) {
    const open = items.filter(f => f && f.id && !isUsed(f) && !st.never.includes(f.id));
    if (!open.length) return null;
    if (st.pick && st.pick.day === today) {
      const pinned = open.find(f => f.id === st.pick.id);
      if (pinned) return pinned;
    }
    // Stable: ties keep catalogue order.
    return open
      .map((f, i) => ({ f, i, at: st.shownAt[f.id] || 0 }))
      .sort((a, b) => a.at - b.at || a.i - b.i)[0].f;
  },

  _features(deps) {
    const F = (deps && deps.features) || (typeof VexFeatures !== 'undefined' ? VexFeatures : null);
    if (!F) throw new Error('The feature catalogue is not loaded');
    return F;
  },

  build(now = new Date(), deps) {
    const F = this._features(deps);
    const today = this.dayKey(now);
    const st = this.state();
    if (st.skipDay === today) return null;
    const f = this.choose(F.ITEMS, (x) => F.used(x), st, today);
    if (!f) return null;
    if (!st.pick || st.pick.day !== today || st.pick.id !== f.id) {
      st.pick = { day: today, id: f.id };
      st.shownAt[f.id] = now.getTime();
      this._save(st);
    }
    const keys = F.keysOf(f);
    const first = (F.actions(f) || [])[0] || null;
    const actions = [];
    if (first) actions.push({ label: first.act === 'command' ? (f.openLabel || 'Try it') : 'Open it', icon: 'sparkles', run: () => this.open(f, first.act, deps) });
    actions.push({ label: 'Not today', icon: 'clock', run: () => this.skipToday(now) });
    actions.push({ label: 'Never show this one', icon: 'x', run: () => this.never(f.id) });
    return {
      id: this.id,
      title: this.title,
      icon: this.icon,
      lines: [{
        text: F.nameOf(f),
        detail: (f.what || '') + (keys ? ' Shortcut: ' + keys + '.' : ''),
        featureId: f.id,
        actions,
      }],
    };
  },

  // Runs the feature's own entry point. Throws when the manager it needs is
  // not there, rather than doing nothing.
  open(f, act, deps) {
    const F = this._features(deps);
    if (act === 'panel') {
      if (typeof SidebarManager === 'undefined') throw new Error('The sidebar is not available in this window');
      SidebarManager.openPanel(f.panel);
      return true;
    }
    if (act === 'command') {
      const cmd = F.command(f);
      if (!cmd) throw new Error('That command no longer exists');
      if (typeof CommandBar === 'undefined' || typeof CommandBar._execute !== 'function') throw new Error('The command bar is not available in this window');
      CommandBar._execute(cmd);
      return true;
    }
    if (act === 'settings') {
      if (typeof SettingsUI === 'undefined') throw new Error('Settings are not available in this window');
      SettingsUI.openSection(f.setting.id || f.setting.section);
      return true;
    }
    throw new Error('There is no way to open that feature from here');
  },

  skipToday(now = new Date()) { const st = this.state(); st.skipDay = this.dayKey(now); this._save(st); },
  never(id) { const st = this.state(); if (!st.never.includes(id)) st.never.push(id); st.pick = null; this._save(st); },
  // Lets every "never" feature back into the rotation (Settings button).
  resetNever() { const st = this.state(); st.never = []; this._save(st); },
};

if (typeof window !== 'undefined') window.VexBriefOneNew = VexBriefOneNew;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBriefOneNew };
