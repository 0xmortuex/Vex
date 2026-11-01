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

  it('is on for a profile that saved its own sidebar order or was in use before, with that order and the hidden panels untouched', () => {
    const order = JSON.stringify(['notes', 'history']);
    const over = '{"notes":{"hidden":true},"clock":{"name":"Time"}}';
    localStorage.setItem('vex.sidebarOrder', order);
    localStorage.setItem('vex.panelOverrides', over);
    globalThis.Onboarding = { done: () => true, _usedBefore: () => true };
    expect(G.enabled()).toBe(true);
    expect(localStorage.getItem('vex.sidebarGroups')).toBe('on');
    buildRail();
    G.arrange();
    expect(localStorage.getItem('vex.sidebarOrder')).toBe(order);
    expect(localStorage.getItem('vex.panelOverrides')).toBe(over);
  });

  it('flips an "off" written by the first version to "on" once, then respects "off"', () => {
    localStorage.setItem('vex.sidebarGroups', 'off');   // no marker: the old migration wrote it
    expect(G.enabled()).toBe(true);
    expect(localStorage.getItem('vex.sidebarGroups')).toBe('on');
    expect(localStorage.getItem('vex.sidebarGroups.v2')).toBe('1');
    G.setEnabled(false);                                  // the person's own choice
    expect(G.enabled()).toBe(false);
    expect(G.migrate()).toBeNull();
    expect(localStorage.getItem('vex.sidebarGroups')).toBe('off');
  });

  it('writes an unset key as "on" and never writes "off" itself', () => {
    expect(G.migrate()).toBe('on');
    localStorage.removeItem('vex.sidebarGroups');          // Reset to defaults
    expect(G.enabled()).toBe(true);
  });

  it('never overrides a saved answer once the marker is there', () => {
    localStorage.setItem('vex.sidebarGroups.v2', '1');
    localStorage.setItem('vex.sidebarGroups.v2', '1'); localStorage.setItem('vex.sidebarGroups', 'off');
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
    localStorage.setItem('vex.sidebarGroups.v2', '1'); localStorage.setItem('vex.sidebarGroups', 'off');
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
    localStorage.setItem('vex.sidebarGroups.v2', '1'); localStorage.setItem('vex.sidebarGroups', 'off');
    expect(G.arrange()).toBe(false);
    expect(order().filter(x => x.startsWith('#'))).toEqual([]);
    expect(panelsOnly()).toEqual(builtIn);

    localStorage.setItem('vex.sidebarGroups', 'on');
    localStorage.setItem('vex.sidebarOrder', JSON.stringify(['recall', 'github']));
    G.arrange();
    localStorage.setItem('vex.sidebarGroups.v2', '1'); localStorage.setItem('vex.sidebarGroups', 'off');
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


// The size and type of the rail are checked in the real window (screenshots and getComputedStyle); these read the stylesheet text so
// a later edit cannot quietly shrink them again (owner, 2026-11-01: heading 8.5px in a serif, icons 16px).
describe('the rail design (stylesheet text)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = (f) => fs.readFileSync(path.join(__dirname, '../../src/renderer/css', f), 'utf8');
  const groups = css('sidebar-groups.css');
  const head = groups.slice(groups.indexOf('#icon-sidebar .sidebar-group-head {'));
  const rule = (src, sel) => { const i = src.indexOf(sel + ' {'); if (i < 0) throw new Error('no rule ' + sel); return src.slice(i, src.indexOf('}', i)); };

  it('sets the heading at 11px or more, medium weight, in the UI sans, with the text colour of the rail', () => {
    const r = rule(head, '#icon-sidebar .sidebar-group-head');
    expect(Number(/font-size: ([\d.]+)px/.exec(r)[1])).toBeGreaterThanOrEqual(11);
    expect(Number(/font-weight: (\d+)/.exec(r)[1])).toBeGreaterThanOrEqual(500);
    expect(r).toMatch(/color: var\(--sgh-fg\)/);
    expect(r).toMatch(/--sgh-fg: var\(--b-text, var\(--vex-text-primary\)\)/);
    expect(r).toMatch(/border-top: 1px solid/);
    expect(groups).toMatch(/\.sgh-label \{\s*font-family: "Segoe UI Variable Text", "Segoe UI", system-ui[^}]*sans-serif !important/);
    expect(groups).not.toMatch(/ellipsis/);
  });

  it('gives the fold chevron 14px and the heading a hit target of at least 24px', () => {
    expect(rule(head, '#icon-sidebar .sidebar-group-head .sgh-chev svg')).toMatch(/width: 14px; height: 14px/);
    expect(Number(/min-height: (\d+)px/.exec(rule(head, '#icon-sidebar .sidebar-group-head'))[1])).toBeGreaterThanOrEqual(24);
    const js = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/sidebar-groups.js'), 'utf8');
    expect(js).toMatch(/VexIcons\.svg\('chevron-down', \{ size: 14 \}\)/);
  });

  it('keeps the rail buttons at 32px or more with icons of 18px or more, also while the window is short', () => {
    const b = css('gui-browser.css');
    expect(rule(b.slice(b.indexOf('/* Icon rail (Firefox, Netscape)')), 'body[data-sb-launcher="rail"] :is(#icon-sidebar .sidebar-icon, #tools-bar .tool-icon)')).toMatch(/var\(--b-rail-btn, 34px\)/);
    expect(b).toMatch(/\.sidebar-icon, #tools-bar \.tool-icon\) svg \{ width: 18px; height: 18px; \}/);
    expect(groups).toMatch(/\[data-sb-grouped="1"\] \.sidebar-icon \{ width: 36px; height: 36px; \}/);
    expect(groups).toMatch(/\[data-sb-grouped="1"\] \.sidebar-icon svg \{ width: 18px; height: 18px; \}/);
    const side = css('sidebar.css');
    for (const cls of ['compact', 'tight']) {
      const m = new RegExp('#icon-sidebar\\.' + cls + ' \\.sidebar-icon \\{ width: (\\d+)px; height: (\\d+)px').exec(side);
      expect(Number(m[1]), cls).toBeGreaterThanOrEqual(32);
      expect(Number(new RegExp('#icon-sidebar\\.' + cls + ' \\.sidebar-icon svg \\{ width: (\\d+)px').exec(side)[1])).toBeGreaterThanOrEqual(18);
    }
  });

  it('widens a rail with groups only a little (at most 64px) and grows it for a longer word', () => {
    const widths = [...groups.matchAll(/width: max\((\d+)px, var\(--sgh-min, 0px\)\)/g)].map(m => Number(m[1]));
    expect(widths.length).toBeGreaterThanOrEqual(3);
    for (const w of widths) expect(w).toBeLessThanOrEqual(64);
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
