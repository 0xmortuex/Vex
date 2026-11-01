// @vitest-environment jsdom
//
// Sidebar groups, the part you touch (js/sidebar-groups-ui.js): dragging a folder or a button (pointer events, with fake rectangles because
// jsdom has no layout), the menus that do the same without dragging, the dialog that makes a group, renaming under the folder, the
// description prompt, deleting with a confirm, and the list in Settings > Sidebar.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const PANELS = ['start', 'discord', 'spotify', 'notes', 'library', 'history', 'downloads', 'clock', 'authenticator', 'privacy'];
let G, UI;

function buildRail() {
  document.body.innerHTML = '<div id="icon-sidebar">'
    + PANELS.map(p => `<button class="sidebar-icon" data-panel="${p}" title="${p}"></button>`).join('')
    + '<div class="sidebar-spacer"></div><button class="sidebar-icon" data-panel="settings"></button></div><div id="sidebar-groups-manager"></div>';
}
const folder = (id) => document.querySelector(`.sb-folder[data-group="${id}"]`);
const inFolder = (id) => [...folder(id).querySelectorAll('.sb-folder-inner > .sidebar-icon')].map(b => b.dataset.panel);
const rect = (top, height, left = 0, width = 60) => ({ top, bottom: top + height, left, right: left + width, width, height, x: left, y: top });

// Fake layout: each folder is 60px for the tile and name, plus 40px per button when open.
function layout() {
  let y = 50;
  for (const f of document.querySelectorAll('.sb-folder')) {
    const open = f.classList.contains('open');
    const kids = [...f.querySelectorAll('.sb-folder-inner > .sidebar-icon')];
    const h = 60 + (open ? kids.length * 40 : 0);
    const top = y;
    f.getBoundingClientRect = () => rect(top, h);
    f.querySelector('.sb-folder-btn').getBoundingClientRect = () => rect(top, 40);
    kids.forEach((b, i) => { b.getBoundingClientRect = () => rect(top + 60 + i * 40, 34); });
    y += h + 4;
  }
}
function ptr(type, x, y, target) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  target.dispatchEvent(e);
}
function drag(from, to) {   // press on `from`, move to `to` in steps, let go
  ptr('pointerdown', from.x, from.y, from.el);
  ptr('pointermove', from.x + 10, from.y + 10, document.getElementById('icon-sidebar'));
  ptr('pointermove', to.x, to.y, document.getElementById('icon-sidebar'));
  ptr('pointerup', to.x, to.y, document.getElementById('icon-sidebar'));
}
const center = (el) => { const r = el.getBoundingClientRect(); return { el, x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '';
  globalThis.VexIcons = { svg: (n) => `<svg data-i="${n}"></svg>` };
  globalThis.VexLayer = { open: (el) => { document.body.appendChild(el); return el; }, close: (el) => el.remove() };
  globalThis.Onboarding = { done: () => false, _usedBefore: () => false };
  window.showToast = vi.fn();
  window.vexPrompt = vi.fn();
  window.vexConfirm = vi.fn();
  globalThis.SidebarManager = {
    _loadOrder: () => [],
    _topButtons() {
      const out = [];
      for (const el of (document.getElementById('icon-sidebar') || { children: [] }).children) {
        if (el.classList.contains('sidebar-spacer')) break;
        if (el.classList.contains('sidebar-icon') && el.dataset.panel) out.push(el);
        else if (el.classList.contains('sb-folder')) el.querySelectorAll('.sb-folder-inner > .sidebar-icon[data-panel]').forEach(b => out.push(b));
      }
      return out;
    },
    applySidebarOrder: vi.fn(() => G.arrange()), applyPanelOverrides: vi.fn(), renderSidebarManager: vi.fn(() => UI.renderManager()), fitRail: vi.fn(),
  };
  vi.resetModules();
  delete window.VexSidebarGroups;
  delete window.VexSidebarGroupsUI;
  await import('../../src/renderer/js/sidebar-groups.js');
  G = window.VexSidebarGroups;
  await import('../../src/renderer/js/sidebar-groups-ui.js');
  UI = window.VexSidebarGroupsUI;
  globalThis.VexSidebarGroupsUI = UI;
  localStorage.setItem('vex.sidebarGroups', 'on');
  buildRail();
  G.arrange();
  UI.wireDrag();
  layout();
});

describe('dragging a folder', () => {
  it('moves it down the rail, to where the line shows, and the order is kept', () => {
    G.setOpen('knowledge', true); layout();
    drag(center(folder('knowledge').querySelector('.sb-folder-btn')), { x: 30, y: folder('tools').getBoundingClientRect().top + 50 });
    const ids = G.model().map(g => g.id);
    expect(ids.indexOf('knowledge')).toBeGreaterThan(ids.indexOf('tools'));
    expect([...document.querySelectorAll('.sb-folder')].map(f => f.dataset.group)).toEqual(ids);
  });

  it('moves it above the first one when let go over the top half of that one', () => {
    drag(center(folder('apps').querySelector('.sb-folder-btn')), { x: 30, y: folder('knowledge').getBoundingClientRect().top + 5 });
    expect(G.model().map(g => g.id)[0]).toBe('apps');
  });

  it('draws the line while dragging and takes it away after', () => {
    const from = center(folder('tools').querySelector('.sb-folder-btn'));
    ptr('pointerdown', from.x, from.y, from.el);
    ptr('pointermove', from.x, from.y + 30, document.getElementById('icon-sidebar'));
    ptr('pointermove', 30, folder('browsing').getBoundingClientRect().top + 5, document.getElementById('icon-sidebar'));
    expect(document.querySelector('.sb-drop-before, .sb-drop-after')).toBeTruthy();
    ptr('pointerup', 30, 70, document.getElementById('icon-sidebar'));
    expect(document.querySelector('.sb-drop-before, .sb-drop-after, .sb-dragging')).toBeNull();
  });

  it('a press without movement is only a click and opens the folder', () => {
    const tile = folder('tools').querySelector('.sb-folder-btn');
    ptr('pointerdown', 10, 60, tile);
    ptr('pointerup', 10, 60, document.getElementById('icon-sidebar'));
    tile.click();
    expect(G.isOpen('tools')).toBe(true);
    expect(G.model().map(g => g.id)).toEqual(['knowledge', 'browsing', 'security', 'tools', 'apps']);
  });

  it('Escape while dragging puts it back and writes nothing', () => {
    const from = center(folder('apps').querySelector('.sb-folder-btn'));
    ptr('pointerdown', from.x, from.y, from.el);
    ptr('pointermove', from.x, from.y - 40, document.getElementById('icon-sidebar'));
    ptr('pointermove', 30, folder('knowledge').getBoundingClientRect().top + 5, document.getElementById('icon-sidebar'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    ptr('pointerup', 30, 55, document.getElementById('icon-sidebar'));
    expect(localStorage.getItem('vex.sidebarGroupDefs')).toBeNull();
    expect(document.querySelector('.sb-dragging')).toBeNull();
  });
});

describe('dragging a button', () => {
  it('drops it on another folder\'s tile: it goes last in that folder, and the folder opens', () => {
    G.setOpen('browsing', true); layout();
    drag(center(inFolder('browsing').length ? document.querySelector('[data-panel="history"]') : null), { x: 30, y: folder('tools').getBoundingClientRect().top + 10 });
    expect(inFolder('tools')).toEqual(['clock', 'history']);
    expect(G.groupOf('history')).toBe('tools');
    expect(G.isOpen('tools')).toBe(true);
  });

  it('drops it between two buttons of an open folder: it lands before the one under the pointer\'s upper half', () => {
    G.setOpen('browsing', true); G.setOpen('knowledge', true); layout();
    const lib = document.querySelector('[data-panel="library"]');
    const r = lib.getBoundingClientRect();
    drag(center(document.querySelector('[data-panel="history"]')), { x: 30, y: r.top + 3 });
    const k = inFolder('knowledge');
    expect(k.indexOf('history')).toBe(k.indexOf('library') - 1);
    expect(inFolder('browsing')).not.toContain('history');
  });

  it('drops it after the last button when let go on the lower half', () => {
    G.setOpen('browsing', true); G.setOpen('knowledge', true); layout();
    const last = document.querySelector('[data-panel="library"]');
    const k = inFolder('knowledge');
    const lastPanel = k[k.length - 1];
    const target = document.querySelector(`[data-panel="${lastPanel}"]`);
    drag(center(document.querySelector('[data-panel="history"]')), { x: 30, y: target.getBoundingClientRect().bottom - 2 });
    expect(inFolder('knowledge').at(-1)).toBe('history');
    expect(last).toBeTruthy();
  });

  it('works inside the same folder too (reordering)', () => {
    G.setOpen('knowledge', true); layout();
    const k = inFolder('knowledge');
    drag(center(document.querySelector(`[data-panel="${k[0]}"]`)), { x: 30, y: document.querySelector(`[data-panel="${k[1]}"]`).getBoundingClientRect().bottom - 2 });
    expect(inFolder('knowledge')).toEqual([k[1], k[0]]);
  });

  it('cannot start from Start or Settings, which stay in the rail', () => {
    const start = document.querySelector('[data-panel="start"]');
    start.getBoundingClientRect = () => rect(0, 34);
    drag({ el: start, x: 10, y: 10 }, { x: 30, y: folder('tools').getBoundingClientRect().top + 10 });
    expect(localStorage.getItem('vex.sidebarGroupDefs')).toBeNull();
    expect(document.querySelector('#icon-sidebar > [data-panel="start"]')).toBeTruthy();
  });

  it('does not write the saved sidebar order', () => {
    G.setOpen('browsing', true); layout();
    drag(center(document.querySelector('[data-panel="history"]')), { x: 30, y: folder('tools').getBoundingClientRect().top + 10 });
    expect(localStorage.getItem('vex.sidebarOrder')).toBeNull();
    expect(localStorage.getItem('vex.panelOverrides')).toBeNull();
  });

  it('leaves the old drag alone only when groups are off (it is the sidebar\'s own code that checks)', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/renderer/js/sidebar.js'), 'utf8');
    expect(src).toMatch(/VexSidebarGroups\.enabled\(\)\) return;\r?\n\s*drag = \{/);
  });
});

describe('the menus (the keyboard way of dragging)', () => {
  const items = () => [...document.querySelectorAll('.tab-context-menu .tab-context-item')].map(i => i.textContent);
  const click = (label) => [...document.querySelectorAll('.tab-context-menu .tab-context-item')].find(i => i.textContent === label).click();

  it('a folder\'s menu offers open, rename, description, icon and colour, move, new group and hide', () => {
    UI.groupMenu({ clientX: 5, clientY: 5, target: document.body }, 'tools');
    expect(items()).toEqual(['Open folder', 'Rename…', 'Edit description…', 'Change icon and colour…', 'Move group up', 'Move group down', 'New group…', 'Hide group']);
    expect(document.querySelector('.tab-context-menu').getAttribute('role')).toBe('menu');
    expect(document.querySelector('.tab-context-item').getAttribute('role')).toBe('menuitem');
  });

  it('has no Move up for the first group and no Move down for the last', () => {
    UI.groupMenu({ clientX: 5, clientY: 5, target: document.body }, 'knowledge');
    expect(items()).not.toContain('Move group up');
    UI.groupMenu({ clientX: 5, clientY: 5, target: document.body }, 'apps');
    expect(items()).not.toContain('Move group down');
  });

  it('Move group down does it', () => {
    UI.groupMenu({ clientX: 5, clientY: 5, target: document.body }, 'knowledge');
    click('Move group down');
    expect(G.model().map(g => g.id).slice(0, 2)).toEqual(['browsing', 'knowledge']);
  });

  it('a group somebody made is deleted (after a confirm), a built-in one is only hidden', async () => {
    const id = G.createGroup({ name: 'Games' });
    UI.groupMenu({ clientX: 5, clientY: 5, target: document.body }, id);
    expect(items()).toContain('Delete group…');
    expect(items()).not.toContain('Hide group');
    window.vexConfirm.mockResolvedValue(false);
    click('Delete group…');
    await Promise.resolve();
    expect(window.vexConfirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    expect(G.groupInfo(id)).toBeTruthy();
    window.vexConfirm.mockResolvedValue(true);
    await UI.removeGroup(id);
    expect(G.groupInfo(id)).toBeNull();
  });

  it('a button\'s menu gets Move to group (every other group, listed) and Move up and down in its group', async () => {
    const groups = UI.panelMenuItems('history', { clientX: 5, clientY: 5 });
    expect(groups.map(i => i.label)).toEqual(['Move to group…', 'Move up in group', 'Move down in group']);
    groups[0].action();
    expect(items()).toEqual(['Knowledge', 'Security and privacy', 'Tools', 'Apps', 'New group…']);   // not its own group
    click('Tools');
    expect(G.groupOf('history')).toBe('tools');
    expect(G.isOpen('tools')).toBe(true);
  });

  it('Move down in group moves the button one place', () => {
    const before = inFolder('knowledge');
    UI.panelMenuItems('notes', { clientX: 1, clientY: 1 })[2].action();
    const after = inFolder('knowledge');
    expect(after.indexOf('notes')).toBe(before.indexOf('notes') + 1);
  });

  it('Start and Settings get none of it, and neither does a rail with the groups off', () => {
    expect(UI.panelMenuItems('start', {})).toEqual([]);
    expect(UI.panelMenuItems('settings', {})).toEqual([]);
    G.setEnabled(false);
    expect(UI.panelMenuItems('history', {})).toEqual([]);
  });

  it('the rail\'s own menu (on its background) offers a new group', () => {
    UI.railMenu({ clientX: 3, clientY: 3 });
    expect(items()).toEqual(['New group…']);
  });

  it('the menu works with the arrow keys and Enter', () => {
    UI.groupMenu({ clientX: 5, clientY: 5, target: document.body }, 'tools');
    const menu = document.querySelector('.tab-context-menu');
    expect(document.activeElement.textContent).toBe('Open folder');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement.textContent).toBe('Rename…');
    menu.querySelector('.tab-context-item').focus();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(G.isOpen('tools')).toBe(true);
  });
});

describe('the dialog that makes a group', () => {
  const dlg = () => document.querySelector('.sbg-dialog');
  it('makes one with a name, a description, an icon and a colour of the theme, and opens it', async () => {
    const p = UI.newGroup();
    dlg().querySelector('#sbg-name').value = 'Games';
    dlg().querySelector('#sbg-desc').value = 'What I play';
    dlg().querySelectorAll('.sbg-icons .sbg-pick')[1].click();   // gamepad
    dlg().querySelectorAll('.sbg-colors .sbg-pick')[2].click();   // success
    dlg().querySelector('[data-ok]').click();
    const id = await p;
    expect(G.groupInfo(id)).toMatchObject({ name: 'Games', desc: 'What I play', icon: 'gamepad', color: 'success' });
    expect(G.isOpen(id)).toBe(true);
    expect(dlg()).toBeNull();
  });

  it('offers thirteen icons and the six colours of the palette, nothing else', () => {
    UI.newGroup();
    expect(dlg().querySelectorAll('.sbg-icons .sbg-pick')).toHaveLength(G.ICONS.length);
    expect(G.ICONS.length).toBeGreaterThanOrEqual(12);
    expect(dlg().querySelectorAll('.sbg-colors .sbg-pick')).toHaveLength(6);
    expect(dlg().querySelector('input[type="color"]')).toBeNull();
  });

  it('will not make one without a name, and says why', () => {
    UI.newGroup();
    dlg().querySelector('[data-ok]').click();
    expect(dlg()).toBeTruthy();
    expect(dlg().querySelector('.sbg-error').hidden).toBe(false);
    expect(G.model()).toHaveLength(5);
  });

  it('Escape and Cancel make nothing', async () => {
    const p = UI.newGroup();
    dlg().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await p).toBeNull();
    expect(G.model()).toHaveLength(5);
  });

  it('edits a built-in group\'s name and description; leaving them as shown keeps the built-in words', async () => {
    const p = UI.editGroup('knowledge');
    expect(dlg().querySelector('#sbg-name').value).toBe('Knowledge');
    expect(dlg().querySelector('#sbg-desc').value).toBe('Notes, library and what you keep');
    dlg().querySelectorAll('.sbg-colors .sbg-pick')[0].click();
    dlg().querySelector('[data-ok]').click();
    await p;
    expect(G.groupInfo('knowledge').name).toBe('');
    expect(G.groupInfo('knowledge').desc).toBe('');
    expect(G.groupInfo('knowledge').color).toBe('accent');
  });

  it('is a dialog for assistive technology, with the pressed icon and colour marked', () => {
    UI.newGroup();
    expect(dlg().getAttribute('role')).toBe('dialog');
    expect(dlg().getAttribute('aria-modal')).toBe('true');
    expect(dlg().querySelectorAll('.sbg-pick[aria-pressed="true"]')).toHaveLength(2);
    expect(dlg().querySelector('#sbg-name').maxLength).toBe(G.NAME_MAX);
    expect(dlg().querySelector('#sbg-desc').maxLength).toBe(G.DESC_MAX);
  });
});

describe('renaming and describing', () => {
  it('renames under the folder: Enter saves', () => {
    UI.renameInline('knowledge');
    const input = folder('knowledge').querySelector('.sb-folder-label-edit');
    expect(input.value).toBe('Knowledge');
    input.value = 'Notlarim';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(folder('knowledge').querySelector('.sb-folder-label').textContent).toBe('Notlarim');
    expect(folder('knowledge').querySelector('.sb-folder-label-edit')).toBeNull();
    expect(G.groupInfo('knowledge').name).toBe('Notlarim');
  });

  it('Escape puts the old name back and writes nothing', () => {
    UI.renameInline('knowledge');
    const input = folder('knowledge').querySelector('.sb-folder-label-edit');
    input.value = 'Zzz';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(folder('knowledge').querySelector('.sb-folder-label').hidden).toBe(false);
    expect(folder('knowledge').querySelector('.sb-folder-label').textContent).toBe('Knowledge');
    expect(localStorage.getItem('vex.sidebarGroupDefs')).toBeNull();
  });

  it('edits the description through the prompt, and asks again when it is too long', async () => {
    window.vexPrompt.mockResolvedValueOnce('x'.repeat(81)).mockResolvedValueOnce('Short and mine');
    await UI.editDescription('tools');
    expect(window.vexPrompt).toHaveBeenCalledTimes(2);
    expect(window.showToast).toHaveBeenCalledWith('A description can be at most 80 characters', 'error');
    expect(G.groupInfo('tools').desc).toBe('Short and mine');
    expect(folder('tools').querySelector('.sb-folder-btn').title).toBe('Tools - Short and mine');
  });

  it('a cancelled prompt changes nothing', async () => {
    window.vexPrompt.mockResolvedValue(null);
    await UI.editDescription('tools');
    expect(localStorage.getItem('vex.sidebarGroupDefs')).toBeNull();
  });
});

describe('Settings > Sidebar: the list of groups', () => {
  const rows = () => [...document.querySelectorAll('#sidebar-groups-manager .sbg-row')];

  it('lists the five with name, description and how many buttons, and a New group and a Reset', () => {
    UI.renderManager();
    expect(rows()).toHaveLength(5);
    expect(rows()[0].querySelector('.sbg-name').textContent).toBe('Knowledge');
    expect(rows()[0].querySelector('.sbg-desc').textContent).toBe('Notes, library and what you keep');
    expect(rows()[0].querySelector('.sbg-count').textContent).toBe('2 buttons');
    expect(document.querySelector('#sidebar-groups-manager [data-act="new"]')).toBeTruthy();
    expect(document.querySelector('#sidebar-groups-manager [data-act="reset"]').textContent).toBe('Reset groups to the built-in five');
  });

  it('moves a group up and down, with the first Up and the last Down off', () => {
    UI.renderManager();
    expect(rows()[0].querySelector('[data-act="up"]').disabled).toBe(true);
    expect(rows()[4].querySelector('[data-act="down"]').disabled).toBe(true);
    rows()[1].querySelector('[data-act="up"]').click();
    expect(G.model()[0].id).toBe('browsing');
    expect(rows()[0].dataset.groupRow).toBe('browsing');
  });

  it('every button says which group it is for', () => {
    UI.renderManager();
    expect(rows()[2].querySelector('[data-act="up"]').getAttribute('aria-label')).toBe('Move up: Security and privacy');
  });

  it('deletes a made group (not a built-in one, which can be hidden and shown), after a confirm', async () => {
    const id = G.createGroup({ name: 'Games' });
    UI.renderManager();
    const row = rows().find(r => r.dataset.groupRow === id);
    expect(row.querySelector('[data-act="delete"]')).toBeTruthy();
    expect(rows()[0].querySelector('[data-act="delete"]')).toBeNull();
    rows()[0].querySelector('[data-act="hide"]').click();
    expect(G.groupInfo('knowledge').hidden).toBe(true);
    expect(rows()[0].classList.contains('is-hidden')).toBe(true);
    window.vexConfirm.mockResolvedValue(true);
    row.querySelector('[data-act="delete"]').click();
    await vi.waitFor(() => expect(G.groupInfo(id)).toBeNull());
  });

  it('puts the built-in five back after a confirm', async () => {
    const id = G.createGroup({ name: 'Games' });
    UI.renderManager();
    window.vexConfirm.mockResolvedValue(true);
    document.querySelector('#sidebar-groups-manager [data-act="reset"]').click();
    await vi.waitFor(() => expect(G.groupInfo(id)).toBeNull());
    expect(G.model()).toHaveLength(5);
  });

  it('is hidden while the groups are off, and says what is wrong when the saved groups are broken', () => {
    G.setEnabled(false);
    expect(document.getElementById('sidebar-groups-manager').hidden).toBe(true);
    G.setEnabled(true);
    localStorage.setItem('vex.sidebarGroupDefs', JSON.stringify({ v: 1, groups: [{ id: 'knowledge', panels: ['notes'] }, { id: 'tools', panels: ['notes'] }] }));
    UI.renderManager();
    expect(document.querySelector('#sidebar-groups-manager [role="alert"]').textContent).toMatch(/two sidebar groups/);
    expect(document.querySelector('#sidebar-groups-manager button').textContent).toBe('Reset groups to the built-in five');
  });
});

describe('the strings', () => {
  it('has a Turkish text for every label the menus, the dialog and the list show', () => {
    const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/renderer/js/sidebar-groups-ui.js'), 'utf8');
    const labels = [...src.matchAll(/label: '([^']+)'/g)].map(m => m[1]);
    const more = ['New group', 'Icon and colour', 'Edit group', 'Create', 'Give the group a name', 'Group name', 'Groups', 'Reset groups to the built-in five', 'Delete this group?',
      'Reset the groups?', 'Edit description', 'Rename group', 'Show group', 'Delete group', 'Accent', 'Accent 2', 'Green', 'Amber', 'Red', 'Neutral', 'Description', 'Icon', 'Name', 'Save', 'Cancel'];
    const missing = [...new Set([...labels, ...more])].filter(s => !VexI18nUI.lookup(s, 'tr'));
    expect(missing).toEqual([]);
  });
});
