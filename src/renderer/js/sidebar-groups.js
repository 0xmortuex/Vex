// === Sidebar groups ==========================================================
// Vex has more than twenty panels. Instead of merging any of them, the rail (and the panel picker in the docked
// looks) puts them under five headings you can fold:
//   Knowledge            Library, Notes, Highlights, Memory, Recall
//   Browsing             History, Bookmarks, Downloads, Feeds, Queue
//   Security and privacy Authenticator, Privacy (two panels, side by side)
//   Tools                Clock, Developer, Shortcuts
//   Apps                 Discord, WhatsApp, Spotify, Netflix, Claude, GitHub, Roblox, and every pinned site
// Start and Settings are the essentials: they have no heading and are always shown.
//
// This is a VIEW laid over the saved order. Nothing here writes vex.sidebarOrder or vex.panelOverrides: the buttons are only
// laid out group by group (each group in the saved order), and switching the grouping off puts the rail back as it was.
// No panel is merged, renamed or given a new id, so shortcuts, Ctrl+K, the screen-share blur and the Simple mode list all see
// the same panels.
//
//   vex.sidebarGroups         'on' | 'off'. Unset means 'on' for every profile, new or old (migrate() writes it): groups are only a view,
//                             the saved order and hidden panels are never rewritten. A saved 'off' is respected.
//   vex.sidebarGroups.v2      marker. Before it, an older version wrote 'off' for profiles in use, which cannot be told from a choice:
//                             once, a stored 'off' without the marker becomes 'on'; after that 'off' is the person's own.
//   vex.sidebarGroups.folded  JSON array of folded group ids.
//
// A folded group shows only its heading (and the button of the panel that is open, so the rail still says where you are).
(function () {
  const KEY = 'vex.sidebarGroups';
  const FOLDED_KEY = 'vex.sidebarGroups.folded';
  const MARKER_KEY = 'vex.sidebarGroups.v2';
  const EVENT = 'vex:sidebar-groups';

  // The English names are translated by VexI18nUI (js/i18n-ui.js).
  const GROUPS = [
    { id: 'knowledge', label: 'Knowledge', panels: ['library', 'notes', 'annotations', 'memory', 'recall'] },
    { id: 'browsing', label: 'Browsing', panels: ['history', 'bookmarks', 'downloads', 'feeds', 'queue'] },
    { id: 'security', label: 'Security and privacy', railLabel: 'Security', panels: ['authenticator', 'privacy'] },
    { id: 'tools', label: 'Tools', panels: ['clock', 'devtools-dash', 'shortcuts'] },
    { id: 'apps', label: 'Apps', panels: ['discord', 'whatsapp', 'spotify', 'netflix', 'claude', 'github', 'roblox'] },
  ];
  // Always on show, no heading.
  const ESSENTIALS = ['start', 'settings'];

  // Which group a panel belongs to: null for Start and Settings; a pinned site, a game guide and any other panel that is
  // not named above is an app.
  function groupOf(panel) {
    if (!panel || ESSENTIALS.includes(panel)) return null;
    const g = GROUPS.find(x => x.panels.includes(panel));
    return g ? g.id : 'apps';
  }
  const groupInfo = (id) => GROUPS.find(g => g.id === id) || null;

  // The pure part. `panels` are the panel ids in the order the rail has them (the saved order, or the built-in one); `visible`
  // tells which of them are on show. Returns the layout: essentials first, then each group that has at least one visible
  // panel, its panels in the order given. A group without a visible panel is left out, so it has no heading.
  function plan(panels, visible) {
    const isVisible = typeof visible === 'function' ? visible : () => true;
    const lead = [];
    const byGroup = new Map(GROUPS.map(g => [g.id, []]));
    for (const p of panels) {
      const g = groupOf(p);
      if (g == null) lead.push(p); else byGroup.get(g).push(p);
    }
    const groups = [];
    for (const g of GROUPS) {
      const members = byGroup.get(g.id);
      if (members.some(isVisible)) groups.push({ id: g.id, label: g.label, panels: members });
    }
    return { lead, groups };
  }

  // ---- Storage ------------------------------------------------------------------------------------------------------
  function readRaw(key) {
    try { return localStorage.getItem(key); }
    catch (err) { throw new Error('Could not read the sidebar groups setting: ' + err.message, { cause: err }); }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); }
    catch (err) { throw new Error('Could not save the sidebar groups setting: ' + err.message, { cause: err }); }
  }

  // Everyone gets the groups (the owner's call, 2026-11-01): unset becomes 'on', also on a profile in use or with a saved sidebar order,
  // because nothing is rewritten, only laid out differently. The first version wrote 'off' for such profiles; that 'off' is not a
  // choice, so it is flipped to 'on' once (the marker), and from then on 'off' stays off. A private window is always 'on'.
  function migrate() {
    const stored = readRaw(KEY);
    if (window.VexTabPolicy?.isPrivateWindow) { if (stored !== 'on') write(KEY, 'on'); return stored === 'on' ? null : 'on'; }
    const marked = readRaw(MARKER_KEY) != null;
    if (!marked) write(MARKER_KEY, '1');
    if (stored === 'on') return null;
    if (stored === 'off' && marked) return null;
    write(KEY, 'on');
    return 'on';
  }

  function enabled() {
    migrate();
    return readRaw(KEY) === 'on';
  }

  function folded() {
    const raw = readRaw(FOLDED_KEY);
    if (raw == null) return [];
    let a;
    try { a = JSON.parse(raw); }
    catch (err) { throw new Error('The saved folded sidebar groups are not readable: ' + err.message, { cause: err }); }
    return Array.isArray(a) ? a.filter(id => GROUPS.some(g => g.id === id)) : [];
  }
  const isFolded = (id) => folded().includes(id);

  function setFolded(id, on) {
    if (!groupInfo(id)) throw new Error('Unknown sidebar group: ' + id);
    const set = new Set(folded());
    if (on) set.add(id); else set.delete(id);
    write(FOLDED_KEY, JSON.stringify([...set]));
    refresh();
    window.dispatchEvent(new CustomEvent('vex:sidebar-groups', { detail: { folded: [...set] } }));
  }
  const toggleFolded = (id) => { setFolded(id, !isFolded(id)); return isFolded(id); };

  function setEnabled(on) {
    write(KEY, on ? 'on' : 'off');
    if (typeof SidebarManager !== 'undefined') {
      SidebarManager.applySidebarOrder();
      SidebarManager.applyPanelOverrides();
      SidebarManager.renderSidebarManager();
    }
    const box = document.getElementById('setting-sidebar-groups');
    if (box) box.checked = !!on;
    window.dispatchEvent(new CustomEvent('vex:sidebar-groups', { detail: { enabled: !!on } }));
    return !!on;
  }

  // ---- The rail -------------------------------------------------------------------------------------------------------
  const bar = () => document.getElementById('icon-sidebar');
  const shownBtn = (b) => b.style.display !== 'none' && !b.hidden;

  // Buttons are numbered once, in the order they first appear, so the built-in order can be put back.
  function stamp(buttons) {
    let max = -1;
    for (const b of buttons) if (b.dataset.sbSeq != null) max = Math.max(max, Number(b.dataset.sbSeq));
    for (const b of buttons) if (b.dataset.sbSeq == null) b.dataset.sbSeq = String(++max);
  }

  // The order the rail would have without groups: the saved order, then the rest in their first order.
  function baseOrder(buttons, saved) {
    const rank = new Map(saved.map((p, i) => [p, i]));
    return buttons.slice().sort((a, b) => {
      const ra = rank.has(a.dataset.panel) ? rank.get(a.dataset.panel) : Infinity;
      const rb = rank.has(b.dataset.panel) ? rank.get(b.dataset.panel) : Infinity;
      if (ra !== rb) return ra < rb ? -1 : 1;
      return Number(a.dataset.sbSeq) - Number(b.dataset.sbSeq);
    });
  }

  function clearGroupMarks(el) {
    el.querySelectorAll('.sidebar-group-head').forEach(h => h.remove());
    el.querySelectorAll('.sb-grp-folded').forEach(b => b.classList.remove('sb-grp-folded'));
    delete el.dataset.sbGrouped;
    el.style.removeProperty('--sgh-min');
  }

  function makeHead(g) {
    const h = document.createElement('button');
    h.type = 'button';
    h.className = 'sidebar-group-head';
    h.dataset.group = g.id;
    // The plan carries no railLabel: the short word on show is looked up here. The name read out is that word; the long name (Security and
    // privacy) is the hover text and the description.
    const short = (groupInfo(g.id) || {}).railLabel;
    h.title = short ? g.label : 'Show or hide the buttons in this group';
    h.innerHTML = '<span class="sgh-chev" aria-hidden="true">' + VexIcons.svg('chevron-down', { size: 14 }) + '</span>'
      + '<span class="sgh-label"></span>';
    const label = h.querySelector('.sgh-label');
    label.textContent = short || g.label;
    h.setAttribute('aria-label', short || g.label);
    if (typeof VexI18nUI !== 'undefined') {
      VexI18nUI.translateEl(h);
      VexI18nUI.translateEl(label);
    }
    h.addEventListener('click', () => toggleFolded(g.id));
    return h;
  }

  // Lay the rail out. Called by SidebarManager.applySidebarOrder before its own work; true means "grouped, done".
  function arrange() {
    const rail = bar();
    if (!rail || typeof SidebarManager === 'undefined') return false;
    const on = enabled();
    if (!on && rail.dataset.sbGrouped !== '1') return false;   // never grouped: today's code runs untouched
    const spacer = rail.querySelector('.sidebar-spacer');
    const buttons = SidebarManager._topButtons();
    stamp(buttons);
    const ordered = baseOrder(buttons, SidebarManager._loadOrder());
    clearGroupMarks(rail);
    if (!on) {
      // Switched off: back to the saved order (or the built-in one); SidebarManager's own code follows.
      ordered.forEach(b => rail.insertBefore(b, spacer));
      return false;
    }
    const byPanel = new Map(ordered.map(b => [b.dataset.panel, b]));
    const { lead, groups } = plan(ordered.map(b => b.dataset.panel), (p) => shownBtn(byPanel.get(p)));
    // Groups with no visible panel are not in the plan, but their (hidden) buttons still need a place.
    const placed = new Set(lead);
    const seq = [];
    lead.forEach(p => seq.push({ btn: byPanel.get(p) }));
    for (const g of groups) {
      seq.push({ head: g });
      g.panels.forEach(p => { placed.add(p); seq.push({ btn: byPanel.get(p) }); });
    }
    ordered.forEach(b => { if (!placed.has(b.dataset.panel)) seq.push({ btn: b }); });
    for (const item of seq) rail.insertBefore(item.btn || makeHead(item.head), spacer);
    rail.dataset.sbGrouped = '1';
    refresh();
    return true;
  }

  // Headings and fold state, after buttons were shown or hidden (SidebarManager.applyPanelOverrides).
  function refresh() {
    const rail = bar();
    if (!rail || rail.dataset.sbGrouped !== '1') return;
    const fold = new Set(folded());
    const heads = [...rail.querySelectorAll('.sidebar-group-head')];
    for (const h of heads) {
      const id = h.dataset.group;
      const members = [];
      for (let el = h.nextElementSibling; el && !el.classList.contains('sidebar-group-head') && !el.classList.contains('sidebar-spacer'); el = el.nextElementSibling) {
        if (el.classList.contains('sidebar-icon') && el.dataset.panel) members.push(el);
      }
      const any = members.some(shownBtn);
      const isOpen = !fold.has(id);
      h.hidden = !any;
      h.setAttribute('aria-expanded', String(isOpen));
      members.forEach(b => b.classList.toggle('sb-grp-folded', !isOpen));
    }
    fitWidth(rail);
  }

  // The rail is wide enough for its longest heading word in the language on show (Turkish 'Uygulamalar' is wider than 'Knowledge'),
  // so no heading is ever cut or wrapped. The CSS takes the larger of its own width and this one (--sgh-min).
  function fitWidth(rail) {
    const need = Math.max(0, ...[...rail.querySelectorAll('.sidebar-group-head:not([hidden]) .sgh-label')].map(l => l.getBoundingClientRect().width));
    if (need > 0) rail.style.setProperty('--sgh-min', Math.ceil(need) + 2 + (rail.offsetWidth - rail.clientWidth) + 'px'); else rail.style.removeProperty('--sgh-min');
  }

  // The panel picker of the docked looks: [{ panel, label }] -> a list of headed sections plus the essentials.
  // The picker does not fold (a <select> cannot): every panel stays reachable from it.
  function pickerPlan(choices) {
    const byId = new Map(choices.map(c => [c.panel, c]));
    const { lead, groups } = plan(choices.map(c => c.panel));
    return {
      essentials: lead.map(p => byId.get(p)),
      groups: groups.map(g => ({ id: g.id, label: g.label, items: g.panels.map(p => byId.get(p)) })),
    };
  }

  function init() {
    const box = document.getElementById('setting-sidebar-groups');
    if (box) {
      box.checked = enabled();
      box.addEventListener('change', () => {
        try { setEnabled(box.checked); }
        catch (err) { box.checked = enabled(); window.showToast?.(err.message, 'error'); }
      });
    }
  }
  // A web font that arrives late changes the words' width.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => refresh());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.VexSidebarGroups = {
    KEY, FOLDED_KEY, MARKER_KEY, EVENT, GROUPS, ESSENTIALS,
    groupOf, groupInfo, plan, pickerPlan, migrate, enabled, setEnabled, folded, isFolded, setFolded, toggleFolded, arrange, refresh,
  };
})();
