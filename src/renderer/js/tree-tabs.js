// === Tabs that sit under the tab they came from ============================
//
// Twenty tabs down the side is a flat list of twenty things with no shape. But
// they are not shapeless: most were opened from another one — a thread, then
// its three links; a search, then the four results you opened. Tree tabs draw
// that: a tab opened from another is indented under it, with a line joining
// them, so a research detour looks like a detour rather than more noise.
//
// The relationship is already recorded for "How I got here" (js/tab-trail.js);
// this is the same information, shown in the tab strip. Nothing is stored
// twice, and nothing new is written to disk.
//
// It only applies to the vertical strip, where indenting has room to mean
// something, and only within a group: a tab's parent in another group is not
// above it on screen, so pretending otherwise would be a lie.
const TreeTabs = {
  SETTING: 'vex.treeTabs',
  MAX_DEPTH: 4,
  STEP: 13,                         // pixels per level

  enabled() { try { return localStorage.getItem(this.SETTING) === 'on'; } catch { return false; } },
  setEnabled(on) {
    try { localStorage.setItem(this.SETTING, on ? 'on' : 'off'); } catch {}
    this.apply();
    return !!on;
  },
  toggle() {
    const on = this.setEnabled(!this.enabled());
    window.showToast?.(on
      ? 'Tabs now sit under the tab they were opened from'
      : 'Tabs are a flat list again');
    return on;
  },

  // How deep a tab sits: one level per hop back to a tab that is still open,
  // in the same group, and above it in the list.
  depth(tabId, { tabs, trail }) {
    const byId = new Map((tabs || []).map(t => [t.id, t]));
    const me = byId.get(tabId);
    if (!me) return 0;
    let depth = 0;
    let at = tabId;
    const seen = new Set([tabId]);
    while (depth < this.MAX_DEPTH) {
      const hop = trail && trail.get ? trail.get(at) : null;
      if (!hop || seen.has(hop.id)) break;
      const parent = byId.get(hop.id);
      // A parent that is closed, in another group, or below this tab in the
      // list is not something to indent under.
      if (!parent) break;
      if ((parent.groupId || null) !== (me.groupId || null)) break;
      if (tabs.indexOf(parent) > tabs.indexOf(me)) break;
      seen.add(hop.id);
      depth++;
      at = hop.id;
    }
    return depth;
  },

  // The indent for every open tab, as a map — worked out once per render
  // rather than per tab.
  depths(tabs, trail) {
    const out = new Map();
    for (const tab of tabs || []) out.set(tab.id, this.depth(tab.id, { tabs, trail }));
    return out;
  },

  // Paints the current strip. Called after any render of the tab list.
  apply() {
    const vertical = typeof document !== 'undefined' && document.body && document.body.dataset.tabLayout !== 'horizontal';
    const on = this.enabled() && vertical;
    document.body.classList.toggle('tree-tabs', on);
    const els = document.querySelectorAll('#tabs-list .tab-item, .tab-group-tabs .tab-item');
    if (!on) {
      els.forEach(el => { el.style.marginLeft = ''; el.removeAttribute('data-depth'); });
      return 0;
    }
    const tabs = typeof TabManager !== 'undefined' ? TabManager.tabs : [];
    const trail = (typeof TabTrail !== 'undefined' && TabTrail.from) ? TabTrail.from : null;
    const depths = this.depths(tabs, trail);
    let nested = 0;
    els.forEach(el => {
      const depth = depths.get(el.dataset.tabId) || 0;
      el.style.marginLeft = depth ? (depth * this.STEP) + 'px' : '';
      if (depth) { el.setAttribute('data-depth', String(depth)); nested++; }
      else el.removeAttribute('data-depth');
    });
    return nested;
  },

  init() {
    // Every path that draws tabs announces itself here, so this is the one
    // place the indent is put back rather than inside each of them.
    window.addEventListener('vex-tabs-changed', () => this.apply());
    this.apply();
    return this;
  },
};

if (typeof window !== 'undefined') window.TreeTabs = TreeTabs;
if (typeof module !== 'undefined' && module.exports) module.exports = { TreeTabs };
