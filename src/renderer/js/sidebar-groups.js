// === Sidebar groups (folders) ================================================
// Vex has more than twenty panels. The rail puts them in folders, like Discord's server folders: each group is ONE button (a rounded
// tile with the group's icon) with its name right under it. Pressing the button opens the folder downward, in place, inside a soft
// tinted background; pressing it again closes it. Several folders can be open.
//   Knowledge            Library, Notes, Highlights, Memory, Recall
//   Browsing             History, Bookmarks, Downloads, Feeds, Queue
//   Security and privacy Authenticator, Privacy (two panels, side by side)
//   Tools                Clock, Developer, Shortcuts
//   Apps                 Discord, WhatsApp, Spotify, Netflix, Claude, GitHub, Roblox, and every pinned site
// Start and Settings are the essentials: they have no folder and are always shown.
//
// The groups are a VIEW laid over the saved order. Nothing here writes vex.sidebarOrder or vex.panelOverrides: the buttons are only
// laid out folder by folder, and switching the grouping off puts the rail back as it was. No panel is merged, renamed or given a new
// id, so shortcuts, Ctrl+K, the screen-share blur and the Simple mode list all see the same panels.
//
//   vex.sidebarGroups         'on' | 'off'. Unset means 'on' for every profile, new or old (migrate() writes it): a saved 'off' is respected.
//   vex.sidebarGroups.v2      marker. Before it, an older version wrote 'off' for profiles in use, which cannot be told from a choice:
//                             once, a stored 'off' without the marker becomes 'on'; after that 'off' is the person's own.
//   vex.sidebarGroupDefs      JSON { v:1, groups:[{ id, name?, desc?, icon?, color?, hidden?, builtin?, panels:[ids] }], order:[ids] }.
//                             ABSENT means the five built-in groups with the built-in mapping below. A panel listed in a group lives
//                             there; a panel listed nowhere falls back to its built-in group, and a panel the built-ins do not know
//                             (a pinned site, a game guide, a panel of a later version) lands in Apps. A panel listed in two groups
//                             is an error that is shown, never quietly mended.
//   vex.sidebarGroups.open    JSON array of the folders that are open. Folders start closed.
//   vex.sidebarGroups.folded  the old fold list of the heading version; it is no longer read and is only cleared by Reset to defaults.
//
// Creating, renaming, drawing and dragging live in js/sidebar-groups-ui.js (loaded after start-up, it is only needed on interaction).
(function () {
  const KEY = 'vex.sidebarGroups';
  const FOLDED_KEY = 'vex.sidebarGroups.folded';
  const OPEN_KEY = 'vex.sidebarGroups.open';
  const MARKER_KEY = 'vex.sidebarGroups.v2';
  const DEFS_KEY = 'vex.sidebarGroupDefs';
  const EVENT = 'vex:sidebar-groups';

  const NAME_MAX = 24;
  const DESC_MAX = 80;
  // The icons a group can wear (all VexIcons) and the colours it can take. A colour is a name of the THEME's palette, never a hex, so a
  // folder always matches the look it is shown in (and the wallpaper match, which re-declares those tokens on the rail).
  const ICONS = ['folder', 'gamepad', 'star', 'heart', 'music', 'briefcase', 'bulb', 'rocket', 'book-open', 'compass', 'shield', 'toolbox', 'grid'];
  const COLORS = ['accent', 'accent2', 'success', 'warning', 'danger', 'neutral'];

  // The English names and sentences are translated by VexI18nUI (js/i18n-ui.js) while nobody has typed their own.
  const GROUPS = [
    { id: 'knowledge', label: 'Knowledge', icon: 'book-open', desc: 'Notes, library and what you keep', panels: ['library', 'notes', 'annotations', 'memory', 'recall'] },
    { id: 'browsing', label: 'Browsing', icon: 'compass', desc: 'History, bookmarks and downloads', panels: ['history', 'bookmarks', 'downloads', 'feeds', 'queue'] },
    { id: 'security', label: 'Security and privacy', railLabel: 'Security', icon: 'shield', desc: 'Codes, passwords and privacy', panels: ['authenticator', 'privacy'] },
    { id: 'tools', label: 'Tools', icon: 'toolbox', desc: 'Clock, developer tools and shortcuts', panels: ['clock', 'devtools-dash', 'shortcuts'] },
    { id: 'chat', label: 'Chat', icon: 'heart', desc: 'Discord and WhatsApp', panels: ['discord', 'whatsapp'] },
    { id: 'media', label: 'Media and games', railLabel: 'Media', icon: 'gamepad', desc: 'Spotify, Netflix and Roblox', panels: ['spotify', 'netflix', 'roblox'] },
    { id: 'aicode', label: 'AI and code', railLabel: 'AI', icon: 'bulb', desc: 'Claude and GitHub', panels: ['claude', 'github'] },
    // The home of every other site you pin: it is left out of the rail until something is in it.
    { id: 'apps', label: 'Apps', icon: 'grid', desc: 'Your pinned sites and other apps', panels: [] },
  ];
  // Always on show, no folder.
  const ESSENTIALS = ['start', 'settings'];

  const tr = (s) => (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup ? (VexI18nUI.lookup(s) || s) : s);

  // ---- Storage ------------------------------------------------------------------------------------------------------
  function readRaw(key) {
    try { return localStorage.getItem(key); }
    catch (err) { throw new Error('Could not read the sidebar groups setting: ' + err.message, { cause: err }); }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); }
    catch (err) { throw new Error('Could not save the sidebar groups setting: ' + err.message, { cause: err }); }
  }

  // ---- The model ----------------------------------------------------------------------------------------------------
  // Reads and checks the saved definitions. Anything wrong is an Error with a sentence a person can act on.
  function parseDefs(raw) {
    let d;
    try { d = JSON.parse(raw); }
    catch (err) { throw new Error('The saved sidebar groups are not readable: ' + err.message, { cause: err }); }
    if (!d || typeof d !== 'object' || Array.isArray(d) || d.v !== 1 || !Array.isArray(d.groups)) {
      throw new Error('The saved sidebar groups are not in a format this version knows (Settings > Sidebar > Reset groups puts the built-in groups back)');
    }
    const ids = new Set();
    const owner = new Map();
    for (const g of d.groups) {
      if (!g || typeof g.id !== 'string' || !g.id) throw new Error('A saved sidebar group has no id');
      if (ids.has(g.id)) throw new Error('The saved sidebar groups list "' + g.id + '" twice');
      ids.add(g.id);
      if (!Array.isArray(g.panels)) throw new Error('The saved sidebar group "' + g.id + '" has no list of panels');
      for (const p of g.panels) {
        if (typeof p !== 'string' || !p) throw new Error('The saved sidebar group "' + g.id + '" lists something that is not a panel');
        if (ESSENTIALS.includes(p)) throw new Error('Start and Settings cannot be in a sidebar group (found in "' + g.id + '")');
        if (owner.has(p)) throw new Error('The panel "' + p + '" is in two sidebar groups ("' + owner.get(p) + '" and "' + g.id + '"). Fix it in Settings > Sidebar, or reset the groups');
        owner.set(p, g.id);
      }
      if (g.icon != null && !ICONS.includes(g.icon) && !GROUPS.some(b => b.icon === g.icon)) throw new Error('The saved sidebar group "' + g.id + '" has an icon this version does not have: ' + g.icon);
      if (g.color != null && g.color !== '' && !COLORS.includes(g.color)) throw new Error('The saved sidebar group "' + g.id + '" has a colour that is not in the palette: ' + g.color);
    }
    if (d.order != null && !Array.isArray(d.order)) throw new Error('The saved sidebar group order is not a list');
    return d;
  }

  let cache = null;
  // The groups as the rail shows them, in order: [{ id, builtin, name, desc, icon, color, hidden, panels, base }]. `name` and `desc` are
  // what the person typed ('' when nobody did); `base` is the built-in record (or null for a group they made).
  function model() {
    const raw = readRaw(DEFS_KEY);
    if (cache && cache.raw === raw) return cache.list;
    const defs = raw == null ? null : parseDefs(raw);
    const stored = new Map(((defs && defs.groups) || []).map(g => [g.id, g]));
    const view = (base, s) => ({
      id: base ? base.id : s.id, builtin: !!base, base,
      name: typeof s.name === 'string' ? s.name : '', desc: typeof s.desc === 'string' ? s.desc : '',
      icon: s.icon || (base && base.icon) || 'folder', color: s.color || '', hidden: !!s.hidden,
      panels: Array.isArray(s.panels) ? s.panels.slice() : [],
    });
    const made = [];
    for (const b of GROUPS) made.push(view(b, stored.get(b.id) || {}));
    for (const s of ((defs && defs.groups) || [])) if (!GROUPS.some(b => b.id === s.id)) made.push(view(null, s));
    const rank = new Map((((defs && defs.order) || [])).map((id, i) => [id, i]));
    const at = (g, i) => (rank.has(g.id) ? rank.get(g.id) : 1000 + i);
    const list = made.map((g, i) => ({ g, k: at(g, i) })).sort((a, b) => a.k - b.k).map(x => x.g);
    cache = { raw, list };
    return list;
  }
  const groupInfo = (id) => model().find(g => g.id === id) || null;

  // What the rail shows under a button, what the tooltip says, and the sentence.
  const labelOf = (g) => g.name || (g.base ? tr(g.base.railLabel || g.base.label) : '');
  const fullNameOf = (g) => g.name || (g.base ? tr(g.base.label) : '');
  const descOf = (g) => g.desc || (g.base ? tr(g.base.desc) : '');

  // Which group a panel is in: null for Start and Settings. Listed in a group, there; else its built-in group; else Apps.
  function groupOf(panel) {
    if (!panel || ESSENTIALS.includes(panel)) return null;
    const list = model();
    const own = list.find(g => g.panels.includes(panel));
    if (own) return own.id;
    const b = GROUPS.find(x => x.panels.includes(panel));
    return b ? b.id : 'apps';
  }

  // The panels of every group, in the order the group shows them: the ones the group lists first, as listed, then the others in the
  // order given. `panels` are the ids in the order the rail has them (the saved order, or the built-in one).
  function membership(panels) {
    const out = new Map(model().map(g => [g.id, []]));
    const present = new Set(panels);
    for (const g of model()) {
      const mine = out.get(g.id);
      for (const p of g.panels) if (present.has(p)) mine.push(p);
    }
    for (const p of panels) {
      const id = groupOf(p);
      if (id == null) continue;
      const mine = out.get(id);
      if (!mine.includes(p)) mine.push(p);
    }
    return out;
  }

  // The pure part. Returns the layout: essentials first, then each group that has at least one visible panel, its panels in the order
  // the group shows them. A group without a visible panel is left out.
  function plan(panels, visible) {
    const isVisible = typeof visible === 'function' ? visible : () => true;
    const lead = panels.filter(p => groupOf(p) == null);
    const mem = membership(panels);
    const groups = [];
    for (const g of model()) {
      const members = mem.get(g.id);
      if (members.some(isVisible)) groups.push({ id: g.id, label: fullNameOf(g), name: labelOf(g), panels: members });
    }
    return { lead, groups };
  }

  // ---- Changing the groups ------------------------------------------------------------------------------------------
  // The definitions as they are now, written out in full so that one change can be made to them.
  function editable() {
    const list = model();
    const groups = list.map(g => {
      const o = { id: g.id };
      if (g.builtin) o.builtin = true;
      if (g.name) o.name = g.name;
      if (g.desc) o.desc = g.desc;
      if (g.icon && (!g.base || g.icon !== g.base.icon)) o.icon = g.icon;
      if (g.color) o.color = g.color;
      if (g.hidden) o.hidden = true;
      o.panels = g.panels.slice();
      return o;
    });
    return { v: 1, groups, order: list.map(g => g.id) };
  }

  // The panels the rail has, in the order it has them.
  function railPanels() {
    if (typeof SidebarManager === 'undefined') return [];
    const buttons = SidebarManager._topButtons();
    stamp(buttons);
    return baseOrder(buttons, SidebarManager._loadOrder()).map(b => b.dataset.panel);
  }

  function relayout() {
    if (typeof SidebarManager !== 'undefined') {
      SidebarManager.applySidebarOrder();
      SidebarManager.renderSidebarManager();
    }
  }
  function commit(defs, detail) {
    parseDefs(JSON.stringify(defs));   // a change that would leave a panel in two groups is refused, not saved
    write(DEFS_KEY, JSON.stringify(defs));
    cache = null;
    relayout();
    window.dispatchEvent(new CustomEvent('vex:sidebar-groups', { detail: Object.assign({ groups: true }, detail) }));
  }

  const clean = (v, max, what) => {
    const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
    if (s.length > max) throw new Error(what + ' can be at most ' + max + ' characters');
    return s;
  };
  function checkLook(patch) {
    if (patch.icon != null && patch.icon !== '' && !ICONS.includes(patch.icon) && !GROUPS.some(b => b.icon === patch.icon)) throw new Error('That icon is not one of the group icons');
    if (patch.color != null && patch.color !== '' && !COLORS.includes(patch.color)) throw new Error('That colour is not in the theme palette');
  }

  function createGroup(patch) {
    const name = clean(patch.name, NAME_MAX, 'A group name');
    if (!name) throw new Error('Give the group a name');
    checkLook(patch);
    const d = editable();
    let id;
    do { id = 'g_' + Math.random().toString(36).slice(2, 8); } while (d.groups.some(g => g.id === id));
    const g = { id, name, panels: [] };
    const desc = clean(patch.desc, DESC_MAX, 'A description');
    if (desc) g.desc = desc;
    g.icon = patch.icon || 'folder';
    if (patch.color) g.color = patch.color;
    d.groups.push(g);
    d.order.push(id);
    commit(d, { created: id });
    return id;
  }

  // `patch` may hold name, desc, icon, color, hidden. An empty name or description on a built-in group puts its built-in words back.
  function updateGroup(id, patch) {
    const d = editable();
    const g = d.groups.find(x => x.id === id);
    if (!g) throw new Error('Unknown sidebar group: ' + id);
    checkLook(patch);
    if ('name' in patch) {
      const name = clean(patch.name, NAME_MAX, 'A group name');
      if (!name && !g.builtin) throw new Error('Give the group a name');
      if (name) g.name = name; else delete g.name;
    }
    if ('desc' in patch) { const desc = clean(patch.desc, DESC_MAX, 'A description'); if (desc) g.desc = desc; else delete g.desc; }
    if ('icon' in patch) { if (patch.icon) g.icon = patch.icon; else delete g.icon; }
    if ('color' in patch) { if (patch.color) g.color = patch.color; else delete g.color; }
    if ('hidden' in patch) { if (patch.hidden) g.hidden = true; else delete g.hidden; }
    commit(d, { updated: id });
  }

  function deleteGroup(id) {
    const info = groupInfo(id);
    if (!info) throw new Error('Unknown sidebar group: ' + id);
    if (info.builtin) throw new Error('A built-in group cannot be deleted (it can be renamed or hidden)');
    const d = editable();
    d.groups = d.groups.filter(g => g.id !== id);
    d.order = d.order.filter(x => x !== id);
    commit(d, { deleted: id });
    setOpen(id, false);
  }

  // Put group `id` before group `beforeId`, or last when beforeId is null.
  function reorderGroup(id, beforeId) {
    const d = editable();
    if (!d.order.includes(id)) throw new Error('Unknown sidebar group: ' + id);
    if (beforeId != null && !d.order.includes(beforeId)) throw new Error('Unknown sidebar group: ' + beforeId);
    if (id === beforeId) return;
    d.order = d.order.filter(x => x !== id);
    d.order.splice(beforeId == null ? d.order.length : d.order.indexOf(beforeId), 0, id);
    commit(d, { reordered: id });
  }
  function nudgeGroup(id, dir) {
    const order = model().map(g => g.id);
    const i = order.indexOf(id);
    if (i < 0) throw new Error('Unknown sidebar group: ' + id);
    const j = i + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= order.length) return false;
    reorderGroup(id, dir < 0 ? order[j] : (order[j + 1] == null ? null : order[j + 1]));
    return true;
  }

  // Move a panel into group `toId`, before panel `beforePanel` (or last). The group then lists its panels in full, so the place sticks.
  function movePanel(panel, toId, beforePanel) {
    if (ESSENTIALS.includes(panel)) throw new Error('Start and Settings stay where they are');
    if (!panel) throw new Error('Which button?');
    const d = editable();
    const to = d.groups.find(g => g.id === toId);
    if (!to) throw new Error('Unknown sidebar group: ' + toId);
    const all = railPanels();
    const mem = membership(all);
    const members = (mem.get(toId) || []).filter(p => p !== panel);
    for (const g of d.groups) g.panels = g.panels.filter(p => p !== panel);
    const at = beforePanel == null ? -1 : members.indexOf(beforePanel);
    if (at < 0) members.push(panel); else members.splice(at, 0, panel);
    to.panels = members;
    commit(d, { moved: panel, to: toId });
  }
  // One place up or down inside the group the panel is in.
  function nudgePanel(panel, dir) {
    const id = groupOf(panel);
    if (!id) return false;
    const members = membership(railPanels()).get(id) || [];
    const i = members.indexOf(panel);
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= members.length) return false;
    const d = editable();
    const g = d.groups.find(x => x.id === id);
    const next = members.slice();
    [next[i], next[j]] = [next[j], next[i]];
    g.panels = next;
    commit(d, { nudged: panel });
    return true;
  }
  const isListed = (panel) => model().some(g => g.panels.includes(panel));

  function resetGroups() {
    try { localStorage.removeItem(DEFS_KEY); }
    catch (err) { throw new Error('Could not reset the sidebar groups: ' + err.message, { cause: err }); }
    cache = null;
    relayout();
    window.dispatchEvent(new CustomEvent('vex:sidebar-groups', { detail: { groups: true, reset: true } }));
  }

  // ---- Which folders are open ---------------------------------------------------------------------------------------
  function openIds() {
    const raw = readRaw(OPEN_KEY);
    if (raw == null) return [];
    let a;
    try { a = JSON.parse(raw); }
    catch (err) { throw new Error('The saved open sidebar groups are not readable: ' + err.message, { cause: err }); }
    return Array.isArray(a) ? a.filter(id => typeof id === 'string') : [];
  }
  const isOpen = (id) => openIds().includes(id);
  function setOpen(id, on) {
    const set = new Set(openIds());
    if (on) set.add(id); else set.delete(id);
    write(OPEN_KEY, JSON.stringify([...set]));
    applyOpen();
    window.dispatchEvent(new CustomEvent('vex:sidebar-groups', { detail: { open: [...set] } }));
  }
  const toggleOpen = (id) => { setOpen(id, !isOpen(id)); return isOpen(id); };
  // The names the first version of this feature used (a heading that folds): a group is folded when it is not open.
  const isFolded = (id) => !isOpen(id);
  const toggleFolded = toggleOpen;

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
  let seq = 0;

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

  // Take the folders away, leaving the buttons in the rail itself (above the spacer).
  function flatten(rail, spacer) {
    for (const f of [...rail.querySelectorAll('.sb-folder')]) {
      for (const b of [...f.querySelectorAll('.sb-folder-inner > .sidebar-icon')]) rail.insertBefore(b, spacer);
      f.remove();
    }
    delete rail.dataset.sbGrouped;
    rail.style.removeProperty('--sgh-min');
  }

  function problem(err) {
    window.VexProblems?.note('Sidebar groups', err.message, err);
    window.showToast?.(err.message, 'error');
  }

  function makeFolder(g, buttons) {
    const f = document.createElement('div');
    f.className = 'sb-folder';
    f.dataset.group = g.id;
    if (g.color) f.dataset.color = g.color;
    const bodyId = 'sb-folder-' + g.id + '-' + (++seq);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sidebar-icon sb-folder-btn';
    btn.dataset.group = g.id;
    btn.setAttribute('translate', 'no');
    btn.setAttribute('aria-controls', bodyId);
    btn.innerHTML = '<span class="sbf-ico" aria-hidden="true">' + VexIcons.svg(g.icon, { size: 18 }) + '</span>'
      + '<span class="sbf-dot" aria-hidden="true"></span><span class="panel-badge sbf-badge" aria-hidden="true" hidden></span>';
    const label = document.createElement('span');
    label.className = 'sb-folder-label';
    label.setAttribute('translate', 'no');
    label.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div');
    body.className = 'sb-folder-body';
    body.id = bodyId;
    body.setAttribute('role', 'group');
    const inner = document.createElement('div');
    inner.className = 'sb-folder-inner';
    body.appendChild(inner);
    f.append(btn, label, body);
    buttons.forEach(b => inner.appendChild(b));
    const toggle = () => toggleOpen(g.id);
    btn.addEventListener('click', toggle);
    label.addEventListener('click', toggle);
    f.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.sb-folder-inner')) return;   // a panel button has its own menu
      e.preventDefault();
      if (typeof VexSidebarGroupsUI !== 'undefined') VexSidebarGroupsUI.groupMenu(e, g.id);
    });
    return f;
  }

  // Text, icon, tint and state of one folder (after a rename, a new language, a button shown or hidden).
  function paint(f, g) {
    const btn = f.querySelector('.sb-folder-btn');
    const label = f.querySelector('.sb-folder-label');
    const body = f.querySelector('.sb-folder-body');
    const name = labelOf(g), full = fullNameOf(g), desc = descOf(g);
    label.textContent = name;
    btn.title = desc ? full + ' - ' + desc : full;
    btn.querySelector('.sbf-ico').innerHTML = VexIcons.svg(g.icon, { size: 18 });
    body.setAttribute('aria-label', full);
    if (desc) body.setAttribute('aria-description', desc); else body.removeAttribute('aria-description');
    if (g.color) f.dataset.color = g.color; else delete f.dataset.color;
  }

  // Lay the rail out. Called by SidebarManager.applySidebarOrder before its own work; true means "grouped, done".
  function arrange() {
    const rail = bar();
    if (!rail || typeof SidebarManager === 'undefined') return false;
    const on = enabled();
    if (!on && rail.dataset.sbGrouped !== '1') return false;   // never grouped: today's code runs untouched
    wireRail();
    const spacer = rail.querySelector('.sidebar-spacer');
    const buttons = SidebarManager._topButtons();
    stamp(buttons);
    const ordered = baseOrder(buttons, SidebarManager._loadOrder());
    ordered.forEach(b => rail.insertBefore(b, spacer));
    flatten(rail, spacer);
    if (!on) return false;   // back to the saved order (or the built-in one); SidebarManager's own code follows
    let list, mem;
    try {
      list = model();
      mem = membership(ordered.map(b => b.dataset.panel));
    } catch (err) {
      problem(err);   // shown, not mended: the rail stays flat until the groups are fixed or reset
      return false;
    }
    const byPanel = new Map(ordered.map(b => [b.dataset.panel, b]));
    for (const g of list) {
      const f = makeFolder(g, mem.get(g.id).map(p => byPanel.get(p)));
      paint(f, g);
      rail.insertBefore(f, spacer);
    }
    rail.dataset.sbGrouped = '1';
    refresh();
    return true;
  }

  // The open state, without touching the buttons (so the folder slides).
  function applyOpen() {
    const rail = bar();
    if (!rail || rail.dataset.sbGrouped !== '1') return;
    const open = new Set(openIds());
    for (const f of rail.querySelectorAll('.sb-folder')) {
      const isO = open.has(f.dataset.group);
      f.classList.toggle('open', isO);
      f.querySelector('.sb-folder-btn').setAttribute('aria-expanded', String(isO));
      f.querySelector('.sb-folder-inner').inert = !isO;
    }
    refreshState();
    fitRailSoon();
  }

  const countOf = (b) => { const n = parseInt((b.querySelector(':scope > .panel-badge') || {}).textContent, 10); return Number.isFinite(n) ? n : 0; };
  // The dot for the open panel, the summed badge, the names read out.
  function refreshState() {
    const rail = bar();
    if (!rail || rail.dataset.sbGrouped !== '1') return;
    const byId = new Map(model().map(g => [g.id, g]));
    for (const f of rail.querySelectorAll('.sb-folder')) {
      const g = byId.get(f.dataset.group);
      if (!g) continue;
      const isO = f.classList.contains('open');
      const kids = [...f.querySelectorAll('.sb-folder-inner > .sidebar-icon')].filter(shownBtn);
      const btn = f.querySelector('.sb-folder-btn');
      f.classList.toggle('has-active', kids.some(b => b.classList.contains('active')));
      const sum = kids.reduce((n, b) => n + countOf(b), 0);
      const badge = btn.querySelector('.sbf-badge');
      // Only when different: this runs from a MutationObserver on the rail, so a write that changes nothing must not queue another run.
      const hide = isO || sum <= 0, text = sum > 99 ? '99+' : String(sum);
      if (badge.hidden !== hide) badge.hidden = hide;
      if (badge.textContent !== text) badge.textContent = text;
      const full = fullNameOf(g);
      btn.setAttribute('aria-label', localised(full, kids.length, sum, f.classList.contains('has-active'), isO));
    }
  }
  // "Knowledge, 5 buttons" in the language on show (the built-in words are translated, a name somebody typed is read as it is).
  function localised(full, n, sum, active, isO) {
    const s = [full + ', ' + n + ' ' + tr(n === 1 ? 'button' : 'buttons')];
    if (!isO && sum > 0) s.push(sum + ' ' + tr('unread'));
    if (active) s.push(tr('open panel inside'));
    return s.join(', ');
  }

  // Folders after buttons were shown or hidden (SidebarManager.applyPanelOverrides): one with nothing shown disappears; one the person
  // made and that is still empty stays, so there is something to drop buttons on.
  function refresh() {
    const rail = bar();
    if (!rail || rail.dataset.sbGrouped !== '1') return;
    const byId = new Map(model().map(g => [g.id, g]));
    for (const f of rail.querySelectorAll('.sb-folder')) {
      const g = byId.get(f.dataset.group);
      const kids = [...f.querySelectorAll('.sb-folder-inner > .sidebar-icon')];
      const any = kids.some(shownBtn);
      const emptyMine = !g.builtin && kids.length === 0;
      f.hidden = !!g.hidden || !(any || emptyMine);
      f.classList.toggle('empty', kids.length === 0);
      paint(f, g);
    }
    applyOpen();
    fitWidth(rail);
  }

  // The rail is as wide as its longest name in the language on show needs, up to a limit; the CSS takes the larger of its own width and
  // this one (--sgh-min). Longer names are cut with an ellipsis and read in full from the tooltip.
  function fitWidth(rail) {
    const need = Math.max(0, ...[...rail.querySelectorAll('.sb-folder:not([hidden]) .sb-folder-label')].map(l => {
      const c = l.cloneNode(true);
      c.style.cssText = 'position:absolute;visibility:hidden;max-width:none;white-space:nowrap';
      rail.appendChild(c);
      const w = c.getBoundingClientRect().width;
      c.remove();
      return w;
    }));
    if (need > 0) rail.style.setProperty('--sgh-min', Math.min(72, Math.ceil(need) + 8 + (rail.offsetWidth - rail.clientWidth)) + 'px'); else rail.style.removeProperty('--sgh-min');
  }
  let fitTimer = 0;
  function fitRailSoon() {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => { if (typeof SidebarManager !== 'undefined') SidebarManager.fitRail(); }, 240);
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

  // ---- Keyboard and watching ------------------------------------------------------------------------------------------
  function wireRail() {
    const rail = bar();
    if (!rail || rail.dataset.sbGroupsWired) return;
    rail.dataset.sbGroupsWired = '1';
    // Up and Down walk the buttons of the rail (also the ones inside open folders); Enter and Space press the focused one.
    rail.addEventListener('keydown', (e) => {
      if (rail.dataset.sbGrouped !== '1' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      const cur = document.activeElement;
      if (!cur || !rail.contains(cur) || !cur.classList.contains('sidebar-icon')) return;
      const all = [...rail.querySelectorAll('.sidebar-icon')].filter(b => !b.closest('[hidden]') && !b.closest('[inert]') && b.style.display !== 'none' && b.offsetParent !== null);
      const i = all.indexOf(cur);
      const to = all[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!to) return;
      e.preventDefault();
      to.focus();
    });
    rail.addEventListener('contextmenu', (e) => {
      if (rail.dataset.sbGrouped !== '1' || e.target.closest('.sidebar-icon, .sb-folder')) return;
      e.preventDefault();
      if (typeof VexSidebarGroupsUI !== 'undefined') VexSidebarGroupsUI.railMenu(e);
    });
    // The open panel's button changes class, a badge appears, a pinned site goes: the folders follow, once per frame.
    let queued = false;
    const again = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; if (rail.dataset.sbGrouped === '1') refreshState(); });
    };
    new MutationObserver(again).observe(rail, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    window.addEventListener('vex:panel-unread', again);
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
    wireRail();
  }
  // A web font that arrives late changes the names' width; a new language changes the built-in names and sentences.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => refresh());
  window.addEventListener('vex-lang-changed', () => refresh());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.VexSidebarGroups = {
    KEY, FOLDED_KEY, OPEN_KEY, MARKER_KEY, DEFS_KEY, EVENT, GROUPS, ESSENTIALS, ICONS, COLORS, NAME_MAX, DESC_MAX,
    groupOf, groupInfo, model, membership, plan, pickerPlan, labelOf, fullNameOf, descOf, parseDefs,
    createGroup, updateGroup, deleteGroup, reorderGroup, nudgeGroup, movePanel, nudgePanel, isListed, resetGroups,
    migrate, enabled, setEnabled, openIds, isOpen, setOpen, toggleOpen, isFolded, toggleFolded, arrange, refresh, refreshState,
  };
})();
