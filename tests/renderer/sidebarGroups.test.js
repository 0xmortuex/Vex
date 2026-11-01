// @vitest-environment jsdom
//
// Sidebar groups (js/sidebar-groups.js): the model (built-in eight, make, rename, move, delete, order, unknown panels, a panel in two
// groups is an error), the rail (one folder button per group with its name under it, open and closed, the dot, the summed badge, the
// names read out), persistence, reset, and the switch off leaving the rail as it was.
// What it looks like (the narrow rail, the contrast, the docked looks) is checked in the real window, not here.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const PANELS = ['start', 'whatsapp', 'claude', 'spotify', 'netflix', 'discord', 'queue', 'roblox', 'github', 'notes', 'downloads',
  'library', 'bookmarks', 'feeds', 'annotations', 'recall', 'authenticator', 'privacy', 'history', 'memory', 'clock', 'devtools-dash'];

function buildRail(extra = []) {
  document.body.innerHTML = '<div id="icon-sidebar">'
    + [...PANELS, ...extra].map(p => `<button class="sidebar-icon" data-panel="${p}" title="${p}"></button>`).join('')
    + '<div class="sidebar-spacer"></div><button class="sidebar-icon" data-panel="settings"></button></div>'
    + '<input type="checkbox" id="setting-sidebar-groups"><div id="sidebar-groups-manager"></div>';
}
// What the rail holds, top to bottom: '#id' for a folder, then the panels inside it.
const order = () => {
  const out = [];
  for (const el of document.querySelectorAll('#icon-sidebar > *')) {
    if (el.classList.contains('sb-folder')) { out.push('#' + el.dataset.group); el.querySelectorAll('.sb-folder-inner > .sidebar-icon').forEach(b => out.push(b.dataset.panel)); }
    else out.push(el.dataset.panel || 'spacer');
  }
  return out;
};
const panelsOnly = () => order().filter(x => !x.startsWith('#') && x !== 'spacer');
const folder = (id) => document.querySelector(`.sb-folder[data-group="${id}"]`);
const inFolder = (id) => [...folder(id).querySelectorAll('.sb-folder-inner > .sidebar-icon')].map(b => b.dataset.panel);

function stubManager() {
  globalThis.SidebarManager = {
    _loadOrder() { try { const a = JSON.parse(localStorage.getItem('vex.sidebarOrder') || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
    _topButtons() {
      const out = [];
      for (const el of (document.getElementById('icon-sidebar') || { children: [] }).children) {
        if (el.classList.contains('sidebar-spacer')) break;
        if (el.classList.contains('sidebar-icon') && el.dataset.panel) out.push(el);
        else if (el.classList.contains('sb-folder')) el.querySelectorAll('.sb-folder-inner > .sidebar-icon[data-panel]').forEach(b => out.push(b));
      }
      return out;
    },
    applySidebarOrder: vi.fn(() => { G.arrange(); }), applyPanelOverrides: vi.fn(), renderSidebarManager: vi.fn(), fitRail: vi.fn(),
  };
}

let G;
async function load() {
  vi.resetModules();
  delete window.VexSidebarGroups;
  await import('../../src/renderer/js/sidebar-groups.js');
  G = window.VexSidebarGroups;
}
const on = () => { localStorage.setItem('vex.sidebarGroups', 'on'); };

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '';
  globalThis.VexIcons = { svg: (n) => `<svg data-i="${n}"></svg>` };
  globalThis.Onboarding = { done: () => false, _usedBefore: () => false };
  window.VexTabPolicy = undefined;
  window.showToast = vi.fn();
  stubManager();
  await load();
});

describe('which panel goes in which group', () => {
  it('follows the agreed grouping', () => {
    const g = (id) => G.GROUPS.find(x => x.id === id).panels;
    expect(g('knowledge')).toEqual(['library', 'notes', 'annotations', 'memory', 'recall']);
    expect(g('browsing')).toEqual(['history', 'bookmarks', 'downloads', 'feeds', 'queue']);
    expect(g('security')).toEqual(['authenticator', 'privacy']);
    expect(g('tools')).toEqual(['clock', 'devtools-dash', 'shortcuts']);
    expect(g('chat')).toEqual(['discord', 'whatsapp']);
    expect(g('media')).toEqual(['spotify', 'netflix', 'roblox']);
    expect(g('aicode')).toEqual(['claude', 'github']);
    expect(g('apps')).toEqual([]);
  });

  it('splits the old Apps group into Chat, Media and games and AI and code, and keeps Apps for pinned sites', () => {
    expect(G.GROUPS.map(x => x.id)).toEqual(['knowledge', 'browsing', 'security', 'tools', 'chat', 'media', 'aicode', 'apps']);
    const home = { discord: 'chat', whatsapp: 'chat', spotify: 'media', netflix: 'media', roblox: 'media', claude: 'aicode', github: 'aicode' };
    for (const [panel, group] of Object.entries(home)) expect(G.groupOf(panel), panel).toBe(group);
    expect(G.GROUPS.find(x => x.id === 'apps').panels).toEqual([]);
    expect(G.GROUPS.find(x => x.id === 'media')).toMatchObject({ label: 'Media and games', railLabel: 'Media' });
    expect(G.GROUPS.find(x => x.id === 'aicode')).toMatchObject({ label: 'AI and code', railLabel: 'Code' });
    expect(G.groupOf('site_pinned1')).toBe('apps');
    expect(G.groupOf('some-future-panel')).toBe('apps');
  });

  it('puts every rail panel in exactly one group, and Start and Settings in none', () => {
    for (const p of PANELS.filter(x => x !== 'start')) expect(G.groupOf(p)).toBeTruthy();
    expect(G.groupOf('start')).toBeNull();
    expect(G.groupOf('settings')).toBeNull();
    const all = G.GROUPS.flatMap(x => x.panels);
    expect(new Set(all).size).toBe(all.length);
  });

  it('puts a pinned site, a game guide and a panel of a later version under Apps', () => {
    expect(G.groupOf('site_abc123')).toBe('apps');
    expect(G.groupOf('gameguide_x')).toBe('apps');
    expect(G.groupOf('some-future-panel')).toBe('apps');
  });

  it('gives every built-in group an icon, a name and a sentence', () => {
    for (const g of G.GROUPS) {
      expect(g.icon, g.id).toBeTruthy();
      expect(g.desc.length, g.id).toBeLessThanOrEqual(G.DESC_MAX);
      expect(g.label.length, g.id).toBeLessThanOrEqual(G.NAME_MAX);
    }
    expect(G.GROUPS[0].desc).toBe('Notes, library and what you keep');
  });
});

describe('the model: absent means the built-in eight', () => {
  it('starts with eight groups in the built-in order and writes nothing', () => {
    expect(G.model().map(g => g.id)).toEqual(['knowledge', 'browsing', 'security', 'tools', 'chat', 'media', 'aicode', 'apps']);
    expect(localStorage.getItem('vex.sidebarGroupDefs')).toBeNull();
  });

  it('plan() leaves out a group with nothing shown, and keeps the given order inside each group', () => {
    const p = G.plan(['start', 'notes', 'history', 'privacy', 'settings'], (x) => x !== 'notes' && x !== 'history');
    expect(p.groups.map(x => x.id)).toEqual(['security']);
    expect(p.lead).toEqual(['start', 'settings']);
    expect(G.plan(['recall', 'library', 'memory', 'notes']).groups[0].panels).toEqual(['recall', 'library', 'memory', 'notes']);
  });

  it('lists the groups in model order whatever order the panels come in', () => {
    expect(G.plan(['discord', 'privacy', 'clock', 'history', 'notes']).groups.map(x => x.id)).toEqual(['knowledge', 'browsing', 'security', 'tools', 'chat']);
  });
});

describe('making, renaming and deleting groups', () => {
  beforeEach(() => { on(); buildRail(); G.arrange(); });

  it('makes a group at the end, with a name, a description, an icon and a palette colour', () => {
    const id = G.createGroup({ name: 'Games', desc: 'Things I play', icon: 'gamepad', color: 'accent' });
    expect(id).toMatch(/^g_/);
    const m = G.model();
    expect(m.map(g => g.id).slice(-1)[0]).toBe(id);
    expect(m.at(-1)).toMatchObject({ name: 'Games', desc: 'Things I play', icon: 'gamepad', color: 'accent', builtin: false });
    expect(G.fullNameOf(m.at(-1))).toBe('Games');
    expect(folder(id)).toBeTruthy();
    expect(folder(id).dataset.color).toBe('accent');
    expect(folder(id).querySelector('.sb-folder-label').textContent).toBe('Games');
    expect(JSON.parse(localStorage.getItem('vex.sidebarGroupDefs')).v).toBe(1);
  });

  it('refuses a made-up colour, a missing name and text that is too long', () => {
    expect(() => G.createGroup({ name: 'X', color: '#ff0000' })).toThrow(/palette/);
    expect(() => G.createGroup({ name: '   ' })).toThrow(/name/);
    expect(() => G.createGroup({ name: 'x'.repeat(G.NAME_MAX + 1) })).toThrow(/at most/);
    expect(() => G.createGroup({ name: 'X', desc: 'x'.repeat(G.DESC_MAX + 1) })).toThrow(/at most/);
    expect(() => G.createGroup({ name: 'X', icon: 'not-an-icon' })).toThrow(/icon/);
    expect(G.model()).toHaveLength(8);
  });

  it('renames a built-in group and edits its description, and an empty value puts the built-in words back', () => {
    G.updateGroup('knowledge', { name: 'Notlarim', desc: 'My own words' });
    expect(folder('knowledge').querySelector('.sb-folder-label').textContent).toBe('Notlarim');
    expect(folder('knowledge').querySelector('.sb-folder-btn').title).toBe('Notlarim - My own words');
    G.updateGroup('knowledge', { name: '', desc: '' });
    expect(folder('knowledge').querySelector('.sb-folder-label').textContent).toBe('Knowledge');
    expect(G.descOf(G.groupInfo('knowledge'))).toBe('Notes, library and what you keep');
  });

  it('keeps a name somebody typed exactly as typed (never translated), and the folder says so', () => {
    G.updateGroup('tools', { name: 'Tools' });
    expect(G.groupInfo('tools').name).toBe('Tools');
    expect(folder('tools').querySelector('.sb-folder-label').getAttribute('translate')).toBe('no');
    expect(folder('tools').querySelector('.sb-folder-btn').getAttribute('translate')).toBe('no');
  });

  it('deletes only a group somebody made, and its buttons go back to their own group', () => {
    const id = G.createGroup({ name: 'Games' });
    G.movePanel('downloads', id, null);
    expect(inFolder(id)).toEqual(['downloads']);
    expect(() => G.deleteGroup('knowledge')).toThrow(/built-in/);
    G.deleteGroup(id);
    expect(folder(id)).toBeNull();
    expect(inFolder('browsing')).toContain('downloads');
    expect(G.groupOf('downloads')).toBe('browsing');
    expect(G.openIds()).not.toContain(id);
  });

  it('hides and shows a built-in group', () => {
    G.updateGroup('tools', { hidden: true });
    expect(folder('tools').hidden).toBe(true);
    G.updateGroup('tools', { hidden: false });
    expect(folder('tools').hidden).toBe(false);
  });

  it('shows a group that is still empty, so there is something to drop buttons on', () => {
    const id = G.createGroup({ name: 'Empty one' });
    expect(folder(id).hidden).toBe(false);
    expect(folder(id).classList.contains('empty')).toBe(true);
  });
});

describe('moving buttons and groups', () => {
  beforeEach(() => { on(); buildRail(); G.arrange(); });

  it('moves a button into another group at a place, and the group lists its buttons in full from then on', () => {
    G.movePanel('downloads', 'knowledge', 'notes');
    expect(inFolder('knowledge')).toEqual(['downloads', 'notes', 'library', 'annotations', 'recall', 'memory']);
    expect(inFolder('browsing')).not.toContain('downloads');
    const k = JSON.parse(localStorage.getItem('vex.sidebarGroupDefs')).groups.find(g => g.id === 'knowledge');
    expect(k.panels).toEqual(['downloads', 'notes', 'library', 'annotations', 'recall', 'memory']);
  });

  it('moves a button to the end of a group when no place is given', () => {
    G.movePanel('history', 'security', null);
    expect(inFolder('security')).toEqual(['authenticator', 'privacy', 'history']);
  });

  it('never moves Start or Settings', () => {
    expect(() => G.movePanel('start', 'tools', null)).toThrow(/Start and Settings/);
    expect(() => G.movePanel('settings', 'tools', null)).toThrow(/Start and Settings/);
  });

  it('refuses a group that does not exist', () => {
    expect(() => G.movePanel('notes', 'nope', null)).toThrow(/Unknown sidebar group/);
  });

  it('moves a button up and down inside its group, and stops at the ends', () => {
    expect(G.nudgePanel('notes', +1)).toBe(true);
    expect(inFolder('knowledge').slice(0, 3)).toEqual(['library', 'notes', 'annotations']);
    expect(G.nudgePanel('library', -1)).toBe(false);
    expect(G.nudgePanel('start', 1)).toBe(false);
  });

  it('reorders the groups, up and down and to a place', () => {
    G.nudgeGroup('apps', -1);
    expect(G.model().map(g => g.id)).toEqual(['knowledge', 'browsing', 'security', 'tools', 'chat', 'media', 'apps', 'aicode']);
    G.reorderGroup('tools', 'knowledge');
    expect(G.model().map(g => g.id)[0]).toBe('tools');
    G.reorderGroup('tools', null);
    expect(G.model().map(g => g.id).at(-1)).toBe('tools');
    expect(order().filter(x => x.startsWith('#'))).toEqual(G.model().map(g => '#' + g.id));
    expect(G.nudgeGroup('knowledge', -1)).toBe(false);
  });

  it('does not write the saved sidebar order or the panel overrides', () => {
    localStorage.setItem('vex.panelOverrides', '{"notes":{"hidden":true}}');
    G.movePanel('downloads', 'knowledge', null);
    G.createGroup({ name: 'Games' });
    G.reorderGroup('apps', 'knowledge');
    G.updateGroup('tools', { name: 'Stuff' });
    expect(localStorage.getItem('vex.sidebarOrder')).toBeNull();
    expect(localStorage.getItem('vex.panelOverrides')).toBe('{"notes":{"hidden":true}}');
  });

  it('keeps the owner\'s saved order inside a group that lists nothing', () => {
    localStorage.setItem('vex.sidebarOrder', JSON.stringify(['recall', 'github', 'memory', 'privacy', 'notes', 'authenticator', 'library']));
    G.arrange();
    expect(inFolder('knowledge').slice(0, 4)).toEqual(['recall', 'memory', 'notes', 'library']);
    expect(inFolder('security')).toEqual(['privacy', 'authenticator']);
    expect(inFolder('aicode')[0]).toBe('github');
  });
});

describe('a panel listed in two groups is an error, shown and not mended', () => {
  const defs = (a, b) => JSON.stringify({ v: 1, groups: [{ id: 'knowledge', panels: a }, { id: 'tools', panels: b }], order: ['knowledge', 'tools'] });
  it('throws from the model with both groups named', () => {
    localStorage.setItem('vex.sidebarGroupDefs', defs(['notes'], ['notes']));
    expect(() => G.model()).toThrow(/"notes" is in two sidebar groups/);
  });
  it('is said out loud by the rail, which stays flat meanwhile, and the saved value is left alone', () => {
    on(); buildRail();
    const raw = defs(['notes'], ['notes']);
    localStorage.setItem('vex.sidebarGroupDefs', raw);
    expect(G.arrange()).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/two sidebar groups/), 'error');
    expect(document.querySelector('.sb-folder')).toBeNull();
    expect(localStorage.getItem('vex.sidebarGroupDefs')).toBe(raw);
  });
  it('refuses a change that would leave a panel in two groups, before saving it', () => {
    expect(() => G.parseDefs(defs(['notes'], ['notes']))).toThrow(/two sidebar groups/);
  });
  it('says so for unreadable and unknown saved values', () => {
    localStorage.setItem('vex.sidebarGroupDefs', '{nope');
    expect(() => G.model()).toThrow(/not readable/);
    localStorage.setItem('vex.sidebarGroupDefs', JSON.stringify({ v: 9, groups: [] }));
    expect(() => G.model()).toThrow(/format/);
    localStorage.setItem('vex.sidebarGroupDefs', JSON.stringify({ v: 1, groups: [{ id: 'a', panels: ['start'] }] }));
    expect(() => G.model()).toThrow(/Start and Settings/);
    localStorage.setItem('vex.sidebarGroupDefs', JSON.stringify({ v: 1, groups: [{ id: 'a', panels: [], color: '#fff' }] }));
    expect(() => G.model()).toThrow(/palette/);
  });
});

describe('persistence, reset, and a later version', () => {
  beforeEach(() => on());

  it('keeps names, icons, buttons and order across a reload', async () => {
    buildRail(); G.arrange();
    const id = G.createGroup({ name: 'Games', icon: 'gamepad', color: 'success' });
    G.movePanel('spotify', id, null);
    G.updateGroup('knowledge', { name: 'Notlarim', desc: 'Mine' });
    G.reorderGroup(id, 'knowledge');
    await load();
    buildRail();
    G.arrange();
    expect(order().filter(x => x.startsWith('#'))[0]).toBe('#' + id);
    expect(inFolder(id)).toEqual(['spotify']);
    expect(folder('knowledge').querySelector('.sb-folder-label').textContent).toBe('Notlarim');
    expect(folder(id).dataset.color).toBe('success');
  });

  it('resets to the built-in eight and takes the made groups away, leaving the saved order and the open folders', () => {
    buildRail(); G.arrange();
    localStorage.setItem('vex.sidebarOrder', '["notes"]');
    G.setOpen('tools', true);
    const id = G.createGroup({ name: 'Games' });
    G.movePanel('clock', id, null);
    G.resetGroups();
    expect(localStorage.getItem('vex.sidebarGroupDefs')).toBeNull();
    expect(G.model().map(g => g.id)).toEqual(['knowledge', 'browsing', 'security', 'tools', 'chat', 'media', 'aicode', 'apps']);
    expect(inFolder('tools')).toContain('clock');
    expect(localStorage.getItem('vex.sidebarOrder')).toBe('["notes"]');
    expect(G.isOpen('tools')).toBe(true);
  });

  it('puts a panel a later version added (not listed anywhere) in its built-in group, and an unknown one in Apps', () => {
    localStorage.setItem('vex.sidebarGroupDefs', JSON.stringify({ v: 1, groups: [{ id: 'knowledge', builtin: true, panels: ['notes'] }], order: ['knowledge'] }));
    expect(G.groupOf('library')).toBe('knowledge');
    expect(G.groupOf('notes')).toBe('knowledge');
    expect(G.groupOf('whatever')).toBe('apps');
    expect(G.model().map(g => g.id)).toEqual(['knowledge', 'browsing', 'security', 'tools', 'chat', 'media', 'aicode', 'apps']);
  });
});

describe('the default', () => {
  it('is on for a new profile, and is written so the wizard finishing does not change it', () => {
    expect(G.enabled()).toBe(true);
    expect(localStorage.getItem('vex.sidebarGroups')).toBe('on');
  });

  it('flips an "off" written by the first version to "on" once, then respects "off"', () => {
    localStorage.setItem('vex.sidebarGroups', 'off');
    expect(G.enabled()).toBe(true);
    G.setEnabled(false);
    expect(G.enabled()).toBe(false);
    expect(G.migrate()).toBeNull();
  });

  it('does not write the saved order or the panel overrides', () => {
    localStorage.setItem('vex.panelOverrides', '{"notes":{"hidden":true}}');
    buildRail();
    G.arrange();
    expect(localStorage.getItem('vex.sidebarOrder')).toBeNull();
    expect(localStorage.getItem('vex.panelOverrides')).toBe('{"notes":{"hidden":true}}');
  });
});

describe('the rail', () => {
  it('with the switch off is left exactly as it was', () => {
    localStorage.setItem('vex.sidebarGroups.v2', '1'); localStorage.setItem('vex.sidebarGroups', 'off');
    buildRail();
    const before = order();
    expect(G.arrange()).toBe(false);
    expect(order()).toEqual(before);
    expect(document.querySelector('.sb-folder')).toBeNull();
  });

  it('with the switch on has one folder button per group, its name under it, Start first and Settings last', () => {
    on(); buildRail();
    expect(G.arrange()).toBe(true);
    const o = order();
    expect(o[0]).toBe('start');
    expect(o.filter(x => x.startsWith('#'))).toEqual(['#knowledge', '#browsing', '#security', '#tools', '#chat', '#media', '#aicode', '#apps']);
    expect(o.slice(-2)).toEqual(['spacer', 'settings']);
    expect(document.querySelectorAll('.sb-folder:not([hidden]) .sb-folder-btn')).toHaveLength(7);   // Apps holds no panel here, so its folder stays out of the rail
    expect(folder('apps').hidden).toBe(true);
    expect(document.querySelector('#icon-sidebar').dataset.sbGrouped).toBe('1');
    for (const f of document.querySelectorAll('.sb-folder')) {
      const kids = [...f.children].map(c => c.className.split(' ')[0]);
      expect(kids).toEqual(['sidebar-icon', 'sb-folder-label', 'sb-folder-body']);   // the tile, the name under it, the body below that
    }
    expect(folder('security').querySelector('.sb-folder-label').textContent).toBe('Security');
    expect(folder('security').querySelector('.sb-folder-btn').title).toBe('Security and privacy - Codes, passwords and privacy');
    expect(folder('knowledge').querySelector('.sbf-ico svg').dataset.i).toBe('book-open');
  });

  it('the tile is a real button with the folder pattern: aria-expanded, aria-controls, a group around the buttons', () => {
    on(); buildRail(); G.arrange();
    const btn = folder('knowledge').querySelector('.sb-folder-btn');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    const body = folder('knowledge').querySelector('.sb-folder-body');
    expect(btn.getAttribute('aria-controls')).toBe(body.id);
    expect(body.getAttribute('role')).toBe('group');
    expect(body.getAttribute('aria-label')).toBe('Knowledge');
    expect(btn.getAttribute('aria-label')).toBe('Knowledge, 5 buttons');
  });

  it('starts closed, opens when the tile or the name is pressed and closes when pressed again, and remembers it', () => {
    on(); buildRail(); G.arrange();
    const f = folder('knowledge');
    expect(f.classList.contains('open')).toBe(false);
    expect(f.querySelector('.sb-folder-inner').inert).toBe(true);
    f.querySelector('.sb-folder-btn').click();
    expect(f.classList.contains('open')).toBe(true);
    expect(f.querySelector('.sb-folder-btn').getAttribute('aria-expanded')).toBe('true');
    expect(f.querySelector('.sb-folder-inner').inert).toBe(false);
    expect(JSON.parse(localStorage.getItem('vex.sidebarGroups.open'))).toEqual(['knowledge']);
    folder('tools').querySelector('.sb-folder-label').click();
    expect(G.openIds().sort()).toEqual(['knowledge', 'tools']);   // several can be open
    f.querySelector('.sb-folder-btn').click();
    expect(f.classList.contains('open')).toBe(false);
    expect(G.openIds()).toEqual(['tools']);
  });

  it('keeps the open state when the rail is laid out again', () => {
    on(); buildRail(); G.arrange();
    G.setOpen('browsing', true);
    G.arrange();
    expect(folder('browsing').classList.contains('open')).toBe(true);
  });

  it('shows a dot on a closed folder that holds the open panel, and not on an open one', async () => {
    on(); buildRail(); G.arrange();
    document.querySelector('[data-panel="notes"]').classList.add('active');
    G.refreshState();
    expect(folder('knowledge').classList.contains('has-active')).toBe(true);
    expect(folder('browsing').classList.contains('has-active')).toBe(false);
    expect(folder('knowledge').querySelector('.sb-folder-btn').getAttribute('aria-label')).toContain('open panel inside');
  });

  it('adds up the unread counts of the buttons inside on the closed folder, and drops it when the folder opens', () => {
    on(); buildRail(); G.arrange();
    for (const [p, n] of [['discord', '3'], ['whatsapp', '4']]) {
      const b = document.createElement('span'); b.className = 'panel-badge'; b.textContent = n;
      document.querySelector(`[data-panel="${p}"]`).appendChild(b);
    }
    G.refreshState();
    const badge = folder('chat').querySelector('.sbf-badge');
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('7');
    expect(folder('chat').querySelector('.sb-folder-btn').getAttribute('aria-label')).toContain('7 unread');
    G.setOpen('chat', true);
    expect(badge.hidden).toBe(true);
  });

  it('hides the folder when its last button is hidden, and brings it back when one is shown', () => {
    on(); buildRail(); G.arrange();
    const sec = ['authenticator', 'privacy'].map(p => document.querySelector(`[data-panel="${p}"]`));
    sec.forEach(b => { b.style.display = 'none'; });
    G.refresh();
    expect(folder('security').hidden).toBe(true);
    expect(panelsOnly()).toContain('privacy');   // the button still exists
    sec[0].style.display = '';
    G.refresh();
    expect(folder('security').hidden).toBe(false);
  });

  it('puts a pinned site under Apps', () => {
    on(); buildRail(['site_one']); G.arrange();
    expect(inFolder('apps')).toContain('site_one');
  });

  it('switching off after grouping puts the saved order back, and the built-in order when none is saved', () => {
    on(); buildRail();
    const builtIn = panelsOnly();
    G.arrange();
    expect(panelsOnly()).not.toEqual(builtIn);
    localStorage.setItem('vex.sidebarGroups.v2', '1'); localStorage.setItem('vex.sidebarGroups', 'off');
    expect(G.arrange()).toBe(false);
    expect(order().filter(x => x.startsWith('#'))).toEqual([]);
    expect(panelsOnly()).toEqual(builtIn);
    expect(document.querySelector('.sb-folder')).toBeNull();
  });

  it('survives a bad open value by saying so instead of hiding it', () => {
    localStorage.setItem('vex.sidebarGroups.open', '{nope');
    expect(() => G.openIds()).toThrow(/open sidebar groups/);
  });

  it('Up and Down walk the buttons of the rail, also inside an open folder', () => {
    on(); buildRail(); G.arrange();
    G.setOpen('security', true);
    const rail = document.getElementById('icon-sidebar');
    // jsdom has no layout: offsetParent is null, so give the buttons one for the walk
    document.querySelectorAll('#icon-sidebar .sidebar-icon').forEach(b => Object.defineProperty(b, 'offsetParent', { get: () => rail }));
    const tile = folder('security').querySelector('.sb-folder-btn');
    tile.focus();
    tile.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement.dataset.panel).toBe('authenticator');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(tile);
  });
});

describe('the picker', () => {
  it('lists the panels under the group names (custom groups in their order, with their names), and Settings after them', () => {
    const id = G.createGroup({ name: 'Games' });
    G.movePanel('spotify', id, null);
    G.reorderGroup(id, 'knowledge');
    const choices = ['notes', 'history', 'settings', 'privacy', 'discord', 'spotify'].map(p => ({ panel: p, label: p }));
    const plan = G.pickerPlan(choices);
    expect(plan.groups.map(g => g.label)).toEqual(['Games', 'Knowledge', 'Browsing', 'Security and privacy', 'Chat']);
    expect(plan.groups[0].items.map(c => c.panel)).toEqual(['spotify']);
    expect(plan.essentials.map(c => c.panel)).toEqual(['settings']);
    expect(plan.groups.flatMap(g => g.items).length + plan.essentials.length).toBe(choices.length);
  });
});

describe('the strings and the registry', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

  it('has a Turkish word for every name and every sentence of the built-in groups', () => {
    const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
    for (const g of G.GROUPS) {
      expect(VexI18nUI.lookup(g.label, 'tr'), g.label).toBeTruthy();
      expect(VexI18nUI.lookup(g.desc, 'tr'), g.desc).toBeTruthy();
    }
    expect(VexI18nUI.lookup('Knowledge', 'tr')).toBe('Bilgi');
    expect(VexI18nUI.lookup('Notes, library and what you keep', 'tr')).toBe('Notlar, kitaplık ve sakladıklarınız');
    expect(VexI18nUI.lookup('Security', 'tr')).toBe('Güvenlik');
  });

  it('shows the built-in words translated, and a name somebody typed as typed', () => {
    const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
    globalThis.VexI18nUI = VexI18nUI;
    localStorage.setItem('vex.lang', 'tr');
    on(); buildRail(); G.arrange();
    expect(folder('knowledge').querySelector('.sb-folder-label').textContent).toBe('Bilgi');
    expect(folder('knowledge').querySelector('.sb-folder-btn').title).toBe('Bilgi - Notlar, kitaplık ve sakladıklarınız');
    G.updateGroup('knowledge', { name: 'Knowledge' });
    expect(folder('knowledge').querySelector('.sb-folder-label').textContent).toBe('Knowledge');
    delete globalThis.VexI18nUI;
    localStorage.removeItem('vex.lang');
  });

  it('owns every key in the manifest, clears them all on Reset to defaults, and syncs only the definitions', () => {
    const manifests = read('src/renderer/js/feature-manifests.js');
    const own = manifests.slice(manifests.indexOf("id: 'sidebar-groups'"), manifests.indexOf("id: 'toolbar-limit'"));
    for (const k of [G.KEY, G.MARKER_KEY, G.FOLDED_KEY, G.OPEN_KEY, G.DEFS_KEY]) {
      expect(own, k).toContain("'" + k + "'");
      expect(read('src/renderer/js/app.js'), k).toContain("'" + k + "'");
    }
    const sync = read('src/renderer/js/sync-engine.js');
    expect(sync.match(/'vex\.sidebarGroupDefs'/g).length).toBeGreaterThanOrEqual(3);   // the synced list, the look group, the look keys
    expect(sync).not.toContain("'vex.sidebarGroups.open'");
    expect(read('docs/SYNC_PROTOCOL.md').match(/`vex\.sidebarGroupDefs`/g).length).toBeGreaterThanOrEqual(2);
  });
});

describe('the stylesheet', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/css/sidebar-groups.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => { const i = css.indexOf(sel + ' {'); if (i < 0) throw new Error('no rule ' + sel); return css.slice(i, css.indexOf('}', i)); };

  it('sets the name under the tile at 11px, medium weight, in the UI sans, cut with an ellipsis', () => {
    const r = rule('#icon-sidebar .sb-folder-label');
    expect(Number(/font-size: ([\d.]+)px/.exec(r)[1])).toBeGreaterThanOrEqual(11);
    expect(Number(/font-weight: (\d+)/.exec(r)[1])).toBeGreaterThanOrEqual(500);
    expect(r).toMatch(/text-overflow: ellipsis/);
    // The name is set in the window's own font (the look's and the New Tab page's), so the rail and the home page match.
    expect(css).toMatch(/#icon-sidebar \.sb-folder-label, #icon-sidebar \.sb-folder-label-edit \{ font-family: inherit; \}/);
  });

  it('takes colours only from tokens (no hex of its own except the unread badge red)', () => {
    const folderCss = css.slice(css.indexOf('#icon-sidebar .sb-folder {'), css.indexOf('/* A rail with groups is a little wider'));
    const hexes = folderCss.match(/#[0-9a-fA-F]{3,8}\b(?![\w-])/g) || [];
    expect(hexes.filter(h => !['#icon', '#e5484d', '#fff'].includes(h) && !/^#icon/.test(h))).toEqual([]);
  });

  it('slides the body open and respects reduced motion', () => {
    expect(rule('#icon-sidebar .sb-folder-body')).toMatch(/grid-template-rows: 0fr/);
    expect(rule('#icon-sidebar .sb-folder.open > .sb-folder-body')).toMatch(/grid-template-rows: 1fr/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*transition: none/);
  });

  it('keeps the rail buttons at 32px or more with icons of 18px or more, and the rail at most 64px before it grows for a name', () => {
    expect(css).toMatch(/\[data-sb-grouped="1"\] \.sidebar-icon \{ width: 36px; height: 36px; \}/);
    expect(css).toMatch(/\[data-sb-grouped="1"\] \.sidebar-icon svg \{ width: 18px; height: 18px; \}/);
    const widths = [...css.matchAll(/width: max\((\d+)px, var\(--sgh-min, 0px\)\)/g)].map(m => Number(m[1]));
    expect(widths.length).toBeGreaterThanOrEqual(3);
    for (const w of widths) expect(w).toBeLessThanOrEqual(64);
  });
});
