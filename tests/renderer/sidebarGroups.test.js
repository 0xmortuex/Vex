// @vitest-environment jsdom
//
// Sidebar groups (js/sidebar-groups.js): which panel goes under which heading, headings with nothing shown are left out, the
// saved order is kept inside each group, and with the switch off the rail is exactly what it was.
// What it looks like (the narrow rail, the contrast, the docked looks) is checked in the real window, not here.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const PANELS = ['start', 'whatsapp', 'claude', 'spotify', 'netflix', 'discord', 'queue', 'roblox', 'github', 'notes', 'downloads',
  'library', 'bookmarks', 'feeds', 'annotations', 'recall', 'authenticator', 'privacy', 'history', 'memory', 'clock', 'devtools-dash'];

function buildRail(extra = []) {
  document.body.innerHTML = '<div id="icon-sidebar">'
    + [...PANELS, ...extra].map(p => `<button class="sidebar-icon" data-panel="${p}" title="${p}"></button>`).join('')
    + '<div class="sidebar-spacer"></div><button class="sidebar-icon" data-panel="settings"></button></div>'
    + '<input type="checkbox" id="setting-sidebar-groups">';
}
const order = () => [...document.querySelectorAll('#icon-sidebar > *')].map(el => el.classList.contains('sidebar-group-head') ? '#' + el.dataset.group : el.dataset.panel || 'spacer');
const panelsOnly = () => order().filter(x => !x.startsWith('#') && x !== 'spacer');

function stubManager() {
  globalThis.SidebarManager = {
    _loadOrder() { try { const a = JSON.parse(localStorage.getItem('vex.sidebarOrder') || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
    _topButtons() {
      const out = [];
      for (const el of document.getElementById('icon-sidebar').children) {
        if (el.classList.contains('sidebar-spacer')) break;
        if (el.classList.contains('sidebar-icon') && el.dataset.panel) out.push(el);
      }
      return out;
    },
    applySidebarOrder: vi.fn(), applyPanelOverrides: vi.fn(), renderSidebarManager: vi.fn(),
  };
}

let G;
async function load() {
  vi.resetModules();
  delete window.VexSidebarGroups;
  await import('../../src/renderer/js/sidebar-groups.js');
  G = window.VexSidebarGroups;
}

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '';
  globalThis.VexIcons = { svg: () => '<svg></svg>' };
  globalThis.Onboarding = { done: () => false, _usedBefore: () => false };
  window.VexTabPolicy = undefined;
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
    expect(g('apps')).toEqual(['discord', 'whatsapp', 'spotify', 'netflix', 'claude', 'github', 'roblox']);
  });

  it('puts every rail panel in exactly one group, and Start and Settings in none', () => {
    for (const p of PANELS.filter(x => x !== 'start')) expect(G.groupOf(p)).toBeTruthy();
    expect(G.groupOf('start')).toBeNull();
    expect(G.groupOf('settings')).toBeNull();
    const all = G.GROUPS.flatMap(x => x.panels);
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps Authenticator and Privacy as two panels, and puts pinned sites and game guides with the apps', () => {
    expect(G.groupOf('authenticator')).toBe('security');
    expect(G.groupOf('privacy')).toBe('security');
    expect(G.groupOf('site_abc123')).toBe('apps');
    expect(G.groupOf('gameguide_x')).toBe('apps');
  });
});

describe('plan()', () => {
  it('leaves out a group with nothing shown, so it has no heading', () => {
    const p = G.plan(['start', 'notes', 'history', 'privacy', 'settings'], (x) => x !== 'notes' && x !== 'history');
    expect(p.groups.map(x => x.id)).toEqual(['security']);
    expect(p.lead).toEqual(['start', 'settings']);
  });

  it('keeps the given order inside each group', () => {
    const p = G.plan(['recall', 'library', 'memory', 'notes']);
    expect(p.groups[0].panels).toEqual(['recall', 'library', 'memory', 'notes']);
  });

  it('lists the groups in the agreed order whatever order the panels come in', () => {
    const p = G.plan(['discord', 'privacy', 'clock', 'history', 'notes']);
    expect(p.groups.map(x => x.id)).toEqual(['knowledge', 'browsing', 'security', 'tools', 'apps']);
  });
});

describe('the default', () => {
  it('is on for a new profile, and is written so the wizard finishing does not change it', () => {
    expect(G.enabled()).toBe(true);
    expect(localStorage.getItem('vex.sidebarGroups')).toBe('on');
    globalThis.Onboarding = { done: () => true, _usedBefore: () => true };
    expect(G.enabled()).toBe(true);
  });

  it('is off for a profile that saved its own sidebar order', () => {
    localStorage.setItem('vex.sidebarOrder', JSON.stringify(['notes', 'history']));
    expect(G.enabled()).toBe(false);
    expect(localStorage.getItem('vex.sidebarGroups')).toBe('off');
  });

  it('is off for a profile that was in use before (the wizard is done, or it has data)', () => {
    globalThis.Onboarding = { done: () => true, _usedBefore: () => false };
    expect(G.enabled()).toBe(false);
    localStorage.clear();
    globalThis.Onboarding = { done: () => false, _usedBefore: () => true };
    expect(G.enabled()).toBe(false);
  });

  it('never overrides a saved answer', () => {
    localStorage.setItem('vex.sidebarGroups', 'off');
    expect(G.enabled()).toBe(false);
    localStorage.setItem('vex.sidebarGroups', 'on');
    localStorage.setItem('vex.sidebarOrder', JSON.stringify(['notes']));
    expect(G.enabled()).toBe(true);
  });

  it('does not write the saved order or the panel overrides', () => {
    localStorage.setItem('vex.panelOverrides', '{"notes":{"hidden":true}}');
    G.enabled();
    buildRail();
    G.arrange();
    expect(localStorage.getItem('vex.sidebarOrder')).toBeNull();
    expect(localStorage.getItem('vex.panelOverrides')).toBe('{"notes":{"hidden":true}}');
  });
});

describe('the rail', () => {
  it('with the switch off is left exactly as it was', () => {
    localStorage.setItem('vex.sidebarGroups', 'off');
    buildRail();
    const before = order();
    expect(G.arrange()).toBe(false);
    expect(order()).toEqual(before);
    expect(document.querySelector('.sidebar-group-head')).toBeNull();
  });

  it('with the switch on puts a heading above each group and keeps Start first and Settings last', () => {
    localStorage.setItem('vex.sidebarGroups', 'on');
    buildRail();
    expect(G.arrange()).toBe(true);
    const o = order();
    expect(o[0]).toBe('start');
    expect(o.filter(x => x.startsWith('#'))).toEqual(['#knowledge', '#browsing', '#security', '#tools', '#apps']);
    expect(o.slice(-2)).toEqual(['spacer', 'settings']);
    expect(o.indexOf('#knowledge')).toBe(1);
    expect(o.slice(o.indexOf('#security') + 1, o.indexOf('#tools'))).toEqual(['authenticator', 'privacy']);
  });

  it("keeps the owner's saved order inside every group", () => {
    localStorage.setItem('vex.sidebarGroups', 'on');
    localStorage.setItem('vex.sidebarOrder', JSON.stringify(['recall', 'github', 'memory', 'privacy', 'notes', 'authenticator', 'library']));
    buildRail();
    G.arrange();
    const o = order();
    const slice = (a, b) => o.slice(o.indexOf(a) + 1, o.indexOf(b));
    expect(slice('#knowledge', '#browsing').slice(0, 4)).toEqual(['recall', 'memory', 'notes', 'library']);
    expect(slice('#security', '#tools')).toEqual(['privacy', 'authenticator']);
    expect(o[o.indexOf('#apps') + 1]).toBe('github');
    expect(localStorage.getItem('vex.sidebarOrder')).toBe(JSON.stringify(['recall', 'github', 'memory', 'privacy', 'notes', 'authenticator', 'library']));
  });

  it('puts a pinned site under Apps', () => {
    localStorage.setItem('vex.sidebarGroups', 'on');
    buildRail(['site_one']);
    G.arrange();
    const o = order();
    expect(o.indexOf('site_one')).toBeGreaterThan(o.indexOf('#apps'));
  });

  it('shows no heading for a group whose panels are all hidden', () => {
    localStorage.setItem('vex.sidebarGroups', 'on');
    buildRail();
    for (const p of ['authenticator', 'privacy']) document.querySelector(`[data-panel="${p}"]`).style.display = 'none';
    G.arrange();
    expect(order()).not.toContain('#security');
    expect(panelsOnly()).toContain('privacy');
  });

  it('hides the heading again when its last panel is hidden, and brings it back when one is shown', () => {
    localStorage.setItem('vex.sidebarGroups', 'on');
    buildRail();
    G.arrange();
    const sec = ['authenticator', 'privacy'].map(p => document.querySelector(`[data-panel="${p}"]`));
    sec.forEach(b => { b.style.display = 'none'; });
    G.arrange();
    expect(order()).not.toContain('#security');
    sec[0].style.display = '';
    G.arrange();
    expect(order()).toContain('#security');
  });

  it('folds a group: heading stays, buttons go, the open panel stays, and the state is remembered', () => {
    localStorage.setItem('vex.sidebarGroups', 'on');
    buildRail();
    G.arrange();
    document.querySelector('[data-panel="notes"]').classList.add('active');
    G.setFolded('knowledge', true);
    const head = document.querySelector('.sidebar-group-head[data-group="knowledge"]');
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-panel="library"]').classList.contains('sb-grp-folded')).toBe(true);
    expect(document.querySelector('[data-panel="browsing"]')).toBeNull();
    expect(JSON.parse(localStorage.getItem('vex.sidebarGroups.folded'))).toEqual(['knowledge']);
    head.click();
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-panel="library"]').classList.contains('sb-grp-folded')).toBe(false);
    expect(localStorage.getItem('vex.sidebarGroups.folded')).toBe('[]');
  });

  it('the heading is a real button, so the keyboard works (Enter and Space click a button)', () => {
    localStorage.setItem('vex.sidebarGroups', 'on');
    buildRail();
    G.arrange();
    const head = document.querySelector('.sidebar-group-head');
    expect(head.tagName).toBe('BUTTON');
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(head.getAttribute('aria-label')).toBeTruthy();
  });

  it('switching off after grouping puts the saved order back, and the built-in order when none is saved', () => {
    localStorage.setItem('vex.sidebarGroups', 'on');
    buildRail();
    const builtIn = panelsOnly();
    G.arrange();
    expect(panelsOnly()).not.toEqual(builtIn);
    localStorage.setItem('vex.sidebarGroups', 'off');
    expect(G.arrange()).toBe(false);
    expect(order().filter(x => x.startsWith('#'))).toEqual([]);
    expect(panelsOnly()).toEqual(builtIn);

    localStorage.setItem('vex.sidebarGroups', 'on');
    localStorage.setItem('vex.sidebarOrder', JSON.stringify(['recall', 'github']));
    G.arrange();
    localStorage.setItem('vex.sidebarGroups', 'off');
    G.arrange();
    expect(panelsOnly().slice(0, 2)).toEqual(['recall', 'github']);
  });

  it('survives a bad folded value by saying so instead of hiding it', () => {
    localStorage.setItem('vex.sidebarGroups', 'on');
    localStorage.setItem('vex.sidebarGroups.folded', '{nope');
    expect(() => G.folded()).toThrow(/folded sidebar groups/);
  });
});

describe('the picker', () => {
  it('lists the panels under the group headings, and Settings after them', () => {
    const choices = ['notes', 'history', 'settings', 'privacy', 'discord'].map(p => ({ panel: p, label: p }));
    const plan = G.pickerPlan(choices);
    expect(plan.groups.map(g => g.id)).toEqual(['knowledge', 'browsing', 'security', 'apps']);
    expect(plan.essentials.map(c => c.panel)).toEqual(['settings']);
    expect(plan.groups.flatMap(g => g.items).length + plan.essentials.length).toBe(choices.length);
  });
});

describe('the manifest and the strings', () => {
  it('has a Turkish word for every heading', () => {
    const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
    for (const g of G.GROUPS) expect(VexI18nUI.lookup(g.label, 'tr'), g.label).toBeTruthy();
    expect(VexI18nUI.lookup('Knowledge', 'tr')).toBe('Bilgi');
    expect(VexI18nUI.lookup('Browsing', 'tr')).toBe('Gezinme');
    expect(VexI18nUI.lookup('Security and privacy', 'tr')).toBe('Güvenlik ve gizlilik');
    expect(VexI18nUI.lookup('Tools', 'tr')).toBe('Araçlar');
    expect(VexI18nUI.lookup('Apps', 'tr')).toBe('Uygulamalar');
    expect(VexI18nUI.lookup('Security', 'tr')).toBe('Güvenlik');
  });
});
