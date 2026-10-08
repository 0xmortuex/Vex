// @vitest-environment jsdom
//
// Simple mode (js/simple-mode.js): a calm view for new profiles that only
// HIDES — never rewrites the user's own panel overrides — with an existing
// profile marked Full once so an update never changes it, and Settings'
// advanced sections tucked behind a switch while the search still finds them.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const { VexSimpleMode } = require('../../src/renderer/js/simple-mode.js');
const { SidebarManager } = require('../../src/renderer/js/sidebar.js');
const { Onboarding } = require('../../src/renderer/js/onboarding.js');
const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');
globalThis.VexSimpleMode = VexSimpleMode;   // top-level consts in the app
globalThis.SidebarManager = SidebarManager;
globalThis.Onboarding = Onboarding;

const ROOT = process.cwd();
Element.prototype.scrollIntoView = function () {};   // jsdom has no layout
const RAIL = ['start', 'whatsapp', 'claude', 'discord', 'notes', 'downloads', 'library', 'bookmarks', 'privacy', 'history', 'memory', 'site_abc', 'settings'];

function buildChrome() {
  document.body.innerHTML = `
    <div id="top-bar"><div id="top-bar-right"><button id="btn-all-features" hidden></button><button id="btn-tor"></button></div></div>
    <div id="icon-sidebar">${RAIL.map(p => `<button class="sidebar-icon" data-panel="${p}" title="${p}"></button>`).join('')}</div>
    <input type="checkbox" id="setting-simple-mode">
    <div id="sidebar-manager-list"></div>`;
}
const shown = () => [...document.querySelectorAll('.sidebar-icon[data-panel]')].filter(b => b.style.display !== 'none').map(b => b.dataset.panel);

beforeEach(() => {
  localStorage.clear();
  buildChrome();
  delete document.body.dataset.uiMode;
  window.showToast = vi.fn();
  delete window.VexTabPolicy;
});

describe('which mode a profile is in', () => {
  it('a profile with nothing stored counts as Full', () => {
    expect(VexSimpleMode.stored()).toBeNull();
    expect(VexSimpleMode.isSimple()).toBe(false);
  });

  it('an existing profile is marked Full once, and the mark is never redone', () => {
    localStorage.setItem('vex.onboardingDone', 'true');
    expect(VexSimpleMode.migrate()).toBe('full');
    expect(localStorage.getItem('vex.uiMode')).toBe('full');
    localStorage.setItem('vex.uiMode', 'simple');      // the user switched later
    expect(VexSimpleMode.migrate()).toBeNull();
    expect(localStorage.getItem('vex.uiMode')).toBe('simple');
  });

  it('a profile with prior data but no onboarding flag is existing too', () => {
    localStorage.setItem('vex.tabs', '[]');
    expect(VexSimpleMode.migrate()).toBe('full');
  });

  it('a brand-new profile is left for the setup wizard to decide', () => {
    expect(VexSimpleMode.migrate()).toBeNull();
    expect(localStorage.getItem('vex.uiMode')).toBeNull();
  });

  it('a private window never writes the mark', () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    localStorage.setItem('vex.onboardingDone', 'true');
    expect(VexSimpleMode.migrate()).toBeNull();
    expect(localStorage.getItem('vex.uiMode')).toBeNull();
  });

  it('refuses a mode that does not exist', () => {
    expect(() => VexSimpleMode.set('compact')).toThrow(/unknown mode/);
    expect(localStorage.getItem('vex.uiMode')).toBeNull();
  });

  it('a new profile that skips setup gets what setup pre-selects; an old one keeps Full', () => {
    Onboarding._reloadStartPages = () => {};
    localStorage.setItem('vex.panelOverrides', JSON.stringify({ bookmarks: { hidden: true } }));  // the lean default
    Onboarding.finish();
    expect(localStorage.getItem('vex.uiMode')).toBe(VexSimpleMode.DEFAULT_FOR_NEW);
    expect(JSON.parse(localStorage.getItem('vex.panelOverrides')).bookmarks.hidden).toBe(false);
    localStorage.clear();
    localStorage.setItem('vex.tabs', '[]');
    VexSimpleMode.migrate();
    Onboarding.maybeStart();                            // existing install: marks done silently
    expect(localStorage.getItem('vex.uiMode')).toBe('full');
  });
});

describe('the panel rail', () => {
  it('Simple keeps the everyday panels and the user\'s pinned sites; Full shows everything', () => {
    VexSimpleMode.set('simple');
    expect(shown()).toEqual(['start', 'notes', 'downloads', 'bookmarks', 'privacy', 'history', 'site_abc', 'settings']);
    VexSimpleMode.set('full');
    expect(shown()).toEqual(RAIL);
  });

  it('never writes the panel overrides, so switching back restores the user\'s own setup', () => {
    const mine = JSON.stringify({ whatsapp: { hidden: true }, notes: { hidden: true }, discord: { name: 'DC' } });
    localStorage.setItem('vex.panelOverrides', mine);
    VexSimpleMode.set('simple');
    expect(shown()).not.toContain('notes');            // the user's own hide still wins
    VexSimpleMode.set('full');
    expect(localStorage.getItem('vex.panelOverrides')).toBe(mine);
    expect(shown()).not.toContain('whatsapp');
    expect(shown()).toContain('discord');
  });

  it('the Sidebar Buttons list says Simple mode is holding buttons back, only while it is', () => {
    VexSimpleMode.set('simple');
    expect(document.querySelector('#sidebar-manager-list .sidebar-manager-simple')).toBeTruthy();
    VexSimpleMode.set('full');
    expect(document.querySelector('#sidebar-manager-list .sidebar-manager-simple')).toBeNull();
  });
});

describe('the switch', () => {
  it('init wires All features, which turns everything on in one click', () => {
    localStorage.setItem('vex.uiMode', 'simple');
    VexSimpleMode.init();
    const btn = document.getElementById('btn-all-features');
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toContain('All features');
    expect(document.body.dataset.uiMode).toBe('simple');
    btn.click();
    expect(localStorage.getItem('vex.uiMode')).toBe('full');
    expect(btn.hidden).toBe(true);
    expect(document.body.dataset.uiMode).toBe('full');
    expect(document.getElementById('setting-simple-mode').checked).toBe(false);
  });

  it('the Settings toggle switches both ways and announces it', () => {
    localStorage.setItem('vex.uiMode', 'full');
    VexSimpleMode.init();
    const box = document.getElementById('setting-simple-mode');
    box.checked = true; box.dispatchEvent(new Event('change'));
    expect(VexSimpleMode.isSimple()).toBe(true);
    box.checked = false; box.dispatchEvent(new Event('change'));
    expect(VexSimpleMode.isSimple()).toBe(false);
    expect(window.showToast).toHaveBeenCalledTimes(2);
  });

  it('tells listeners the mode changed', () => {
    const seen = [];
    window.addEventListener('vex-ui-mode-changed', e => seen.push(e.detail.mode), { once: true });
    VexSimpleMode.set('simple');
    expect(seen).toEqual(['simple']);
  });
});

describe('toolbar', () => {
  const css = readFileSync(resolve(ROOT, 'src/renderer/css/simple-mode.css'), 'utf8');
  it('hides every listed power button, and only behind body[data-ui-mode="simple"]', () => {
    for (const id of VexSimpleMode.TOOLBAR) expect(css).toContain(`body[data-ui-mode="simple"] #${id}`);
    expect(VexSimpleMode.TOOLBAR).not.toContain('btn-back');
    expect(VexSimpleMode.TOOLBAR).not.toContain('btn-downloads-top');
  });
  it('a hidden toolbar button stays hidden in every look (Glass forced them all on)', () => {
    const dir = resolve(ROOT, 'src/renderer/css');
    for (const f of require('node:fs').readdirSync(dir).filter(n => n.endsWith('.css'))) {
      const text = readFileSync(resolve(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      // A rule that forces a display on every toolbar button must spare [hidden].
      for (const m of text.matchAll(/([^{}]*#top-bar-right\s*>\s*button[^{}]*)\{([^}]*)\}/g)) {
        if (/display:\s*(?!none)[a-z-]+\s*!important/.test(m[2])) expect(m[1], f).toMatch(/:not\(\[hidden\]\)/);
      }
    }
  });
  it('the overflow menu never swallows All features, and re-fits when the mode changes', () => {
    const js = readFileSync(resolve(ROOT, 'src/renderer/js/toolbar-overflow.js'), 'utf8');
    expect(js).toMatch(/NEVER = new Set\([^)]*'btn-all-features'/);
    expect(js).toMatch(/attributeFilter: \[[^\]]*'data-ui-mode'/);
  });
  it('is wired up in the page, before a11y.css', () => {
    const html = readFileSync(resolve(ROOT, 'src/renderer/index.html'), 'utf8');
    expect(html).toContain('<script src="js/simple-mode.js"></script>');
    expect(html.indexOf('css/simple-mode.css')).toBeGreaterThan(-1);
    expect(html.indexOf('css/simple-mode.css')).toBeLessThan(html.indexOf('css/a11y.css'));
    expect(html).toContain('id="setting-simple-mode"');
  });
});

describe('Settings: advanced sections', () => {
  function buildSettings() {
    document.body.innerHTML = `
      <div id="panel-settings"><div class="settings-content">
        <div class="setting-group"><label class="setting-label">General</label><input id="g1"></div>
        <div class="setting-group"><label class="setting-label">Privacy &amp; Security</label></div>
        <div class="setting-group"><label class="setting-label">MCP Servers</label><input id="mcp-input"><div id="mcp-panel-content"></div></div>
        <div class="setting-group"><label class="setting-label">Performance</label><span>memory saver</span></div>
        <div class="setting-group"><label class="setting-label">About</label></div>
      </div></div>`;
    SettingsUI.enhance();
    return document.querySelector('#panel-settings');
  }

  it('sorts the sections into basic and advanced by heading', () => {
    const panel = buildSettings();
    const tiers = [...panel.querySelectorAll('.setting-group')].map(g => g.dataset.tier);
    expect(tiers).toEqual(['basic', 'basic', 'advanced', 'advanced', 'basic']);
    expect(SettingsUI.tierOf('Privacy Hardening')).toBe('advanced');
    expect(SettingsUI.tierOf('Passwords')).toBe('basic');
  });

  it('puts one Show advanced settings button after the last section, even when enhanced again', () => {
    const panel = buildSettings();
    SettingsUI.enhance();
    const btns = panel.querySelectorAll('.set-advanced-toggle');
    expect(btns.length).toBe(1);
    expect(panel.querySelector('.settings-content').lastElementChild).toBe(btns[0]);
    expect(btns[0].textContent).toContain('Show advanced settings (2 more sections)');
    btns[0].click();
    expect(panel.classList.contains('set-show-advanced')).toBe(true);
    expect(btns[0].textContent).toContain('Hide advanced settings');
    expect(btns[0].getAttribute('aria-expanded')).toBe('true');
  });

  it('searching finds advanced sections, and one you click into stays when the search is cleared', () => {
    const panel = buildSettings();
    const root = panel.querySelector('.settings-content');
    root.scrollTop = 500;
    SettingsUI._filter(root, 'memory saver');
    expect(panel.classList.contains('set-searching')).toBe(true);
    expect(root.scrollTop).toBe(0);                    // results start at the top
    const perf = [...root.querySelectorAll('.setting-group')].find(g => g.textContent.includes('Performance'));
    expect(perf.style.display).toBe('');
    document.body.dataset.uiMode = 'simple';
    perf.querySelector('span').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const scrolled = vi.spyOn(perf, 'scrollIntoView');
    SettingsUI._filter(root, '');
    expect(panel.classList.contains('set-searching')).toBe(false);
    expect(perf.classList.contains('set-revealed')).toBe(true);
    expect(scrolled).toHaveBeenCalled();                // taken back to it, not to the top
    // A result merely seen, not used, folds away again.
    const mcp = [...root.querySelectorAll('.setting-group')].find(g => g.textContent.includes('MCP'));
    expect(mcp.classList.contains('set-revealed')).toBe(false);
  });

  it('a deep link into an advanced section opens it', async () => {
    buildSettings();
    globalThis.SidebarManager = { openPanel: vi.fn() };
    window.requestAnimationFrame = (fn) => { fn(); return 0; };
    SettingsUI.openSection('mcp-panel-content');
    expect(document.getElementById('mcp-panel-content').closest('.setting-group').classList.contains('set-revealed')).toBe(true);
    globalThis.SidebarManager = SidebarManager;
  });

  it('the stylesheet hides advanced sections only in Simple mode, and never while searching', () => {
    const css = readFileSync(resolve(ROOT, 'src/renderer/css/simple-mode.css'), 'utf8');
    expect(css).toContain('body[data-ui-mode="simple"] #panel-settings:not(.set-show-advanced):not(.set-searching) .settings-content > .setting-group[data-tier="advanced"]:not(.set-revealed)');
  });
});

describe('Reset to Defaults', () => {
  it('lists the mode, so a reset is the Full browser', () => {
    const app = readFileSync(resolve(ROOT, 'src/renderer/js/app.js'), 'utf8');
    const list = app.match(/const SETTINGS_PREF_KEYS = \[([\s\S]*?)\];/)[1];
    expect(list).toContain("'vex.uiMode'");
  });
});
