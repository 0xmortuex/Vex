// === Fun and progress: Settings group =========================================
//
// One Settings group that this module builds and inserts itself, so
// index.html only needs the script tags:
//
//   VexFunSettings.render(container)   draws the switches and the cards
//   VexFunSettings.inject()            adds the group to the Settings panel
//
// The same cards are available to the Profile page: render a card on its own
// with VexDiscovery.render(el) / VexDailyChallenge.render(el), and read the
// level with VexLevels.snapshot().
const VexFunSettings = {
  ID: 'vex-fun-settings',

  render(container) {
    if (!container) throw new Error('No place to draw the fun settings');
    const E = (v) => VexProgress.esc(v);
    const toggles = VexProgress.FLAGS.map(f => {
      const t = VexProgress.LABELS[f];
      return '<div class="setting-toggle-row"><span>' + E(t.label) + '</span>' +
        '<label class="toggle"><input type="checkbox" data-fun-flag="' + f + '" aria-label="' + E(t.label) + '"' + (VexProgress.enabled(f) ? ' checked' : '') + '>' +
        '<span class="toggle-slider"></span></label></div>' +
        '<p class="setting-info muted" style="margin:2px 0 10px">' + E(t.hint) + '</p>';
    }).join('');
    container.innerHTML = toggles +
      '<div data-fun-card="levels"></div><div data-fun-card="discovery"></div><div data-fun-card="challenge"></div>';
    container.querySelectorAll('[data-fun-flag]').forEach(inp => inp.addEventListener('change', () => {
      try { VexProgress.setEnabled(inp.dataset.funFlag, inp.checked); }
      catch (err) { inp.checked = !inp.checked; window.showToast?.(err.message, 'error'); return; }
      this._cards(container);
    }));
    this._cards(container);
  },

  _cards(container) {
    const lvl = container.querySelector('[data-fun-card="levels"]');
    if (VexProgress.enabled('levels')) {
      const s = VexLevels.snapshot();
      lvl.innerHTML = '<div class="fun-card" role="group" aria-label="Browser level"><div class="fun-card-head">' +
        (globalThis.VexIcons ? globalThis.VexIcons.svg('zap', { size: 15 }) : '') +
        '<strong>Level ' + s.level + ': ' + VexProgress.esc(s.title) + '</strong></div>' +
        '<div class="fun-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + s.span + '" aria-valuenow="' + s.into + '" aria-label="Progress to level ' + (s.level + 1) + '"><span style="width:' + Math.round(s.progress * 100) + '%"></span></div>' +
        '<p class="setting-info muted">' + s.into + ' of ' + s.span + ' points to ' + VexProgress.esc(s.nextTitle) + '. Points come from useful things only.</p></div>';
    } else lvl.innerHTML = '';
    VexDiscovery.render(container.querySelector('[data-fun-card="discovery"]'));
    VexDailyChallenge.render(container.querySelector('[data-fun-card="challenge"]'));
    // The off-state sentences of the cards are noise next to their own switch.
    container.querySelectorAll('[data-fun-card]').forEach(c => {
      const flag = c.dataset.funCard;
      if (!VexProgress.enabled(flag)) c.innerHTML = '';
    });
  },

  // Adds the group to the Settings panel, once. Returns the group element, or
  // null when the panel is not in this document.
  inject() {
    if (typeof document === 'undefined') return null;
    const existing = document.getElementById(this.ID);
    if (existing) return existing;
    const root = document.querySelector('.settings-content');
    if (!root) return null;
    const group = document.createElement('div');
    group.className = 'setting-group';
    group.id = this.ID;
    group.innerHTML = '<label class="setting-label">Fun and progress (all optional, all off until you turn them on)</label><div data-fun-body></div>';
    root.appendChild(group);
    this._css();
    this.render(group.querySelector('[data-fun-body]'));
    return group;
  },

  _css() {
    if (document.getElementById('vex-fun-style')) return;
    const st = document.createElement('style');
    st.id = 'vex-fun-style';
    st.textContent =
      '.fun-card{border:1px solid var(--vex-border,rgba(128,128,128,.3));border-radius:10px;padding:10px 12px;margin:8px 0;background:var(--vex-hover-fill,transparent)}' +
      '.fun-card-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}' +
      '.fun-bar{height:6px;border-radius:3px;background:var(--vex-hover-fill,rgba(128,128,128,.2));overflow:hidden}' +
      '.fun-bar span{display:block;height:100%;background:var(--vex-accent,#7aa2ff)}' +
      '.fun-list{margin:8px 0 0;padding-left:18px}.fun-actions{display:flex;gap:8px;margin-top:6px}';
    document.head.appendChild(st);
  },
};

if (typeof document !== 'undefined') {
  // Settings builds this group itself each time it opens (the chips read the
  // heading: "Play: " puts it in the Play chip). Without the shared registry
  // (a test, an older page) it is injected once, as before.
  const go = () => {
    if (typeof VexSettingsGroups !== 'undefined' && typeof VexSettingsGroups.register === 'function') {
      VexSettingsGroups.register({
        id: 'fun-progress',
        title: 'Play: fun and progress (all optional, all off until you turn them on)',
        render: (c) => { VexFunSettings._css(); VexFunSettings.render(c); },
      });
      return;
    }
    if (!VexFunSettings.inject()) setTimeout(() => VexFunSettings.inject(), 1500);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
}

globalThis.VexFunSettings = VexFunSettings;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFunSettings };
