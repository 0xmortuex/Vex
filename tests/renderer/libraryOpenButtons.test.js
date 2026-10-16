// @vitest-environment jsdom
//
// The Library lists everything Vex can do, and a listing is only as good as
// what its buttons do. Owner, 2026-10-12: "make sure that you can open things
// from the library — when I search up Master Volume there should be a button
// to open, and for some that can't be opened there should be a description of
// how that feature works."
//
// So this walks the WHOLE catalogue: an entry either has a real way to open it
// (a live Ctrl+K command, a sidebar panel, a Settings switch or section that is
// in the page, a control to point at) and gets a button for it, or it cannot
// be opened and gets a "How it works" block and no button at all.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
const { FeatureLibrary } = require('../../src/renderer/js/feature-library.js');
const { VexGuide } = require('../../src/renderer/js/vex-guide.js');
const { FeatureDetails, FeatureHow } = require('../../src/renderer/js/feature-details.js');
globalThis.ThemeManager = require('../../src/renderer/js/theme-manager.js').ThemeManager;

const read = (p) => fs.readFileSync(path.join(__dirname, '../../src/renderer/', p), 'utf8');
const html = read('index.html');
const commandSrc = read('js/command.js');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const panels = new Set([...html.matchAll(/data-panel="([^"]+)"/g)].map(m => m[1]));
const cmdIds = [...commandSrc.matchAll(/\{ id: '([^']+)'/g)].map(m => m[1]);
// Commands and Settings sections that other modules add themselves
// (VexExtras.registerCommand, the dev loop's cmd(), VexSettingsGroups.register).
const { commandIds: extraCommandIds, groupSections } = require('./_catalogTargets.js');
for (const id of extraCommandIds) if (!cmdIds.includes(id)) cmdIds.push(id);

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="host"></div>';
  globalThis.VexFeatures = VexFeatures;
  globalThis.VexGuide = VexGuide;
  globalThis.FeatureLibrary = FeatureLibrary;
  globalThis.FeatureDetails = FeatureDetails;
  globalThis.FeatureHow = FeatureHow;
  // Every command id the real command bar declares, each with an action.
  globalThis.CommandBar = { commands: cmdIds.map(id => ({ id, label: id, action: vi.fn() })) };
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  window.showToast = vi.fn();
  FeatureLibrary._query = '';
  FeatureLibrary._cat = null;
});

describe('every catalogue entry can be opened or explained', () => {
  it('has a working way to open it, or a "How it works" and no button', () => {
    const neither = VexFeatures.ITEMS.filter(f => !VexFeatures.actions(f).length && !(FeatureHow[f.id] && FeatureHow[f.id].length >= 60)).map(f => f.id);
    expect(neither).toEqual([]);
  });

  it('every entry you do by hand has its How it works written', () => {
    const missing = VexFeatures.ITEMS.filter(f => f.manual && !FeatureHow[f.id]).map(f => f.id);
    expect(missing).toEqual([]);
    const stale = Object.keys(FeatureHow).filter(id => !VexFeatures.get(id));
    expect(stale).toEqual([]);
  });

  it('every command, panel and Settings reference resolves to something real', () => {
    const bad = [];
    for (const f of VexFeatures.ITEMS) {
      if (f.cmd && !cmdIds.includes(f.cmd)) bad.push(f.id + ' cmd ' + f.cmd);
      if (f.panel && !panels.has(f.panel)) bad.push(f.id + ' panel ' + f.panel);
      if (f.setting && f.setting.id && !ids.has(f.setting.id)) bad.push(f.id + ' setting ' + f.setting.id);
      if (f.setting && f.setting.section && !ids.has(f.setting.section) && !groupSections.has(f.setting.section)) bad.push(f.id + ' section ' + f.setting.section);
      if (f.setting && !f.setting.id && !f.setting.section) bad.push(f.id + ' setting with no target');
    }
    expect(bad).toEqual([]);
  });

  it('draws exactly one button per action, and none for what cannot be opened', () => {
    FeatureLibrary.render(document.getElementById('host'));
    for (const f of VexFeatures.ITEMS) {
      const card = document.querySelector(`.flib-card[data-id="${f.id}"]`);
      expect(card, f.id).toBeTruthy();
      const buttons = [...card.querySelectorAll('[data-act]')];
      expect(buttons.map(b => b.dataset.act), f.id).toEqual(VexFeatures.actions(f).map(a => a.act));
      if (buttons.length) expect(buttons[0].classList.contains('primary'), f.id).toBe(true);
      const how = card.querySelector('.flib-how');
      if (!buttons.length) expect(how, f.id + ' has neither a button nor a how-it-works').toBeTruthy();
      if (FeatureHow[f.id]) expect(how.textContent, f.id).toBe(FeatureHow[f.id]);
    }
  }, 60000);   // renders every card; a loaded CI machine passed 5 s once
});

describe('Master Volume', () => {
  it('is found by its own name and opens its slider', () => {
    const hits = VexFeatures.search('master volume').map(f => f.id);
    expect(hits).toContain('volume');
    const f = VexFeatures.get('volume');
    const acts = VexFeatures.actions(f);
    expect(acts[0]).toMatchObject({ act: 'command', label: 'Open the volume slider' });
    // The command is the real one: it calls MasterVolume.show().
    expect(commandSrc).toMatch(/id: 'master-volume'[^\n]*MasterVolume\.show\(\)/);
  });
});

describe('what each button does', () => {
  it('Open panel opens the sidebar panel', () => {
    globalThis.SidebarManager = { openPanel: vi.fn() };
    FeatureLibrary.open('notes', 'panel');
    expect(SidebarManager.openPanel).toHaveBeenCalledWith('notes');
  });

  it('Run command runs the live command', () => {
    const cmd = CommandBar.commands.find(c => c.id === 'master-volume');
    FeatureLibrary.open('volume', 'command');
    expect(cmd.action).toHaveBeenCalledTimes(1);
  });

  it('Open settings deep-links to the switch or the section', () => {
    globalThis.SettingsUI = { openSection: vi.fn() };
    FeatureLibrary.open('adblock', 'settings');
    FeatureLibrary.open('fingerprint', 'settings');
    expect(SettingsUI.openSection.mock.calls.map(c => c[0])).toEqual(['setting-adblocker', 'privacy-panel-content']);
  });

  it('a button that cannot do its job says so instead of doing nothing', () => {
    delete globalThis.SidebarManager;
    FeatureLibrary.open('notes', 'panel');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/sidebar is not available/), 'error');
    FeatureLibrary.open('notes', 'nonsense');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Unknown action/), 'error');
  });
});
