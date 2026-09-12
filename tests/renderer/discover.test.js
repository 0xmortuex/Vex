// @vitest-environment jsdom
//
// Discover: every feature Vex has, introduced inside the browser instead of
// only in the GitHub README.
//
// The catalogue must stay honest, which is what most of this file is about: an
// entry that names a Ctrl+K command has to resolve to a real one, so a renamed
// or deleted command fails here rather than leaving Discover pointing at
// nothing. The rest covers the two things a user does with an entry — "Show
// me" and "Open" — and the rule that a feature switched off is still listed,
// with a way to switch it on.

import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons;

// The command registry Discover reads names and actions from.
const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
globalThis.ToolboxPacks = ToolboxPacks;
const { Toolbox } = require('../../src/renderer/js/toolbox.js');
globalThis.Toolbox = Toolbox;
const { CommandBar } = require('../../src/renderer/js/command.js');
globalThis.CommandBar = CommandBar;

const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
globalThis.VexFeatures = VexFeatures;
const { VexTour } = require('../../src/renderer/js/tour.js');
globalThis.VexTour = VexTour;
const { VexDiscover } = require('../../src/renderer/js/discover.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  VexDiscover.close();
});

describe('the catalogue', () => {
  it('covers every category, and every category has features', () => {
    for (const cat of VexFeatures.CATS) {
      expect(VexFeatures.byCat(cat.id).length, cat.id).toBeGreaterThan(0);
    }
    const known = new Set(VexFeatures.CATS.map(c => c.id));
    for (const f of VexFeatures.ITEMS) expect(known.has(f.cat), f.id).toBe(true);
  });

  it('introduces a hundred-plus features, each with a unique id and a sentence', () => {
    expect(VexFeatures.ITEMS.length).toBeGreaterThanOrEqual(100);
    const ids = VexFeatures.ITEMS.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of VexFeatures.ITEMS) {
      expect(typeof f.what === 'string' && f.what.length > 25, f.id).toBe(true);
      expect(f.what.trim().endsWith('.'), f.id).toBe(true);
    }
  });

  // The point of naming a command instead of copying its label.
  it('every `cmd` resolves to a real Ctrl+K command', () => {
    const missing = VexFeatures.ITEMS
      .filter(f => f.cmd && !VexFeatures.command(f))
      .map(f => `${f.id} -> ${f.cmd}`);
    expect(missing, 'catalogue entries pointing at commands that no longer exist').toEqual([]);
  });

  it('takes the name and shortcut from the live command when it has none of its own', () => {
    const split = VexFeatures.get('split');
    expect(VexFeatures.nameOf(split)).toBe('Split Screen');
    expect(VexFeatures.keysOf(split)).toBe('Ctrl+Shift+S');
  });

  it('prefers its own plainer name over a launcher label', () => {
    const groups = VexFeatures.get('tab-groups');
    expect(VexFeatures.command(groups).label).toBe('Organize My Tabs');
    expect(VexFeatures.nameOf(groups)).toBe('Tab groups, sorted by AI');
  });

  it('names an icon the icon set actually has', () => {
    for (const f of VexFeatures.ITEMS) {
      expect(VexIcons.has(VexFeatures.iconOf(f)), `${f.id} -> ${VexFeatures.iconOf(f)}`).toBe(true);
    }
    for (const c of VexFeatures.CATS) expect(VexIcons.has(c.icon), c.id).toBe(true);
  });

  it('searches names, descriptions and shortcuts', () => {
    expect(VexFeatures.search('split').map(f => f.id)).toContain('split');
    expect(VexFeatures.search('paywall').map(f => f.id)).toContain('readfree');
    expect(VexFeatures.search('Ctrl+Shift+S').map(f => f.id)).toContain('split');
    expect(VexFeatures.search('zzzznope')).toEqual([]);
    expect(VexFeatures.search('')).toHaveLength(VexFeatures.ITEMS.length);
  });
});

describe('what is off is still shown', () => {
  it('reports a hidden sidebar panel, and can switch it back on', () => {
    const notes = VexFeatures.get('notes');
    expect(VexFeatures.offState(notes)).toBeNull();

    localStorage.setItem('vex.panelOverrides', JSON.stringify({ notes: { hidden: true } }));
    const off = VexFeatures.offState(notes);
    expect(off).toBeTruthy();
    expect(off.reason).toMatch(/hidden/i);

    globalThis.SidebarManager = { setPanelOverride: vi.fn(), applyPanelOverrides: vi.fn() };
    off.enable();
    expect(SidebarManager.setPanelOverride).toHaveBeenCalledWith('notes', { hidden: false });
    delete globalThis.SidebarManager;
  });

  it('reports a setting that is switched off, and ticking it fires the real change event', () => {
    document.body.innerHTML = '<input type="checkbox" id="setting-adblocker">';
    const adblock = VexFeatures.get('adblock');
    const off = VexFeatures.offState(adblock);
    expect(off.reason).toMatch(/switched off/i);

    const changed = vi.fn();
    document.getElementById('setting-adblocker').addEventListener('change', changed);
    off.enable();
    expect(document.getElementById('setting-adblocker').checked).toBe(true);
    expect(changed).toHaveBeenCalled();
    expect(VexFeatures.offState(adblock)).toBeNull();
  });
});

describe('the Discover screen', () => {
  it('opens on a named category, with every category listed', () => {
    VexDiscover.open(VexFeatures.CATS[0].id);
    expect(document.getElementById('vex-discover')).toBeTruthy();
    // Every category, plus the "New to you" row while anything is unused.
    expect(document.querySelectorAll('#vexd-cats .vexd-cat').length)
      .toBeGreaterThanOrEqual(VexFeatures.CATS.length);
    expect(document.querySelectorAll('#vexd-list .vexd-item'))
      .toHaveLength(VexFeatures.byCat(VexFeatures.CATS[0].id).length);
    expect(document.getElementById('vexd-count').textContent)
      .toBe(`${VexFeatures.ITEMS.length} features`);
  });

  it('opens on "New to you" when there is something you have not tried', () => {
    localStorage.clear();
    VexDiscover.open();
    expect(document.querySelector('.vexd-cat.on').dataset.cat).toBe(VexDiscover.NEW_TO_YOU);
  });

  it('switches category when you pick one', () => {
    VexDiscover.open();
    const target = VexFeatures.CATS[2];
    document.querySelector(`[data-cat="${target.id}"]`).click();
    expect(document.querySelectorAll('#vexd-list .vexd-item'))
      .toHaveLength(VexFeatures.byCat(target.id).length);
    expect(document.querySelector('.vexd-cat.on').dataset.cat).toBe(target.id);
  });

  it('searching looks across every category, not just the open one', () => {
    VexDiscover.open();
    const search = document.getElementById('vexd-search');
    search.value = 'paywall';
    search.dispatchEvent(new Event('input'));
    const names = [...document.querySelectorAll('.vexd-item-name')].map(e => e.textContent);
    expect(names.join(' ')).toMatch(/Read Free/i);
    expect(document.getElementById('vexd-count').textContent).toMatch(/of \d+/);
  });

  it('says so plainly when nothing matches', () => {
    VexDiscover.open();
    const search = document.getElementById('vexd-search');
    search.value = 'zzzznope';
    search.dispatchEvent(new Event('input'));
    expect(document.querySelector('.vexd-empty')).toBeTruthy();
    expect(document.querySelectorAll('.vexd-item')).toHaveLength(0);
  });

  it('offers "Turn on & show me" for a hidden panel instead of hiding the row', () => {
    localStorage.setItem('vex.panelOverrides', JSON.stringify({ notes: { hidden: true } }));
    VexDiscover.open('work');
    const row = document.querySelector('.vexd-item[data-id="notes"]');
    expect(row).toBeTruthy();
    expect(row.classList.contains('off')).toBe(true);
    expect(row.querySelector('[data-enable="notes"]')).toBeTruthy();
    expect(row.querySelector('[data-show="notes"]')).toBeNull();
  });

  it('Open runs the feature through its own Ctrl+K command', () => {
    const cmd = CommandBar.commands.find(c => c.id === 'split');
    const spy = vi.spyOn(CommandBar, '_execute').mockImplementation(() => {});
    VexDiscover.open('tabs');
    document.querySelector('[data-open="split"]').click();
    expect(spy).toHaveBeenCalledWith(cmd);
    expect(document.getElementById('vex-discover')).toBeNull();   // gets out of the way
    spy.mockRestore();
  });

  it('Show me spotlights the real control and comes back afterwards', () => {
    // Build the targets BEFORE opening Discover: assigning to body.innerHTML
    // re-parses the document and throws away the overlay's click handlers.
    const btn = document.createElement('div');
    btn.id = 'btn-command';
    btn.getBoundingClientRect = () => ({ left: 1, top: 1, right: 21, bottom: 21, width: 20, height: 20 });
    document.body.appendChild(btn);

    const spy = vi.spyOn(VexTour, 'run');
    VexDiscover.open('tabs');
    document.querySelector('[data-show="split"]').click();

    expect(spy).toHaveBeenCalled();
    const [steps, opts] = spy.mock.calls[spy.mock.calls.length - 1];
    expect(steps[0].title).toBe('Split Screen');
    expect(steps[0].sel).toBe('#btn-command');   // no button of its own: falls back
    expect(opts.markSeen).toBe(false);              // one button is not "the tour"
    expect(typeof opts.onDone).toBe('function');
    expect(document.getElementById('vex-discover')).toBeNull();  // out of the way

    opts.onDone();                                   // and back again when done
    expect(document.getElementById('vex-discover')).toBeTruthy();
    spy.mockRestore();
    VexTour.end();
  });

  it('prefers a feature’s own control over the command-bar fallback', () => {
    const rail = document.createElement('div');
    rail.id = 'tools-bar';
    rail.getBoundingClientRect = () => ({ left: 0, top: 0, right: 30, bottom: 30, width: 30, height: 30 });
    document.body.appendChild(rail);

    const spy = vi.spyOn(VexTour, 'run');
    VexDiscover.open('look');
    document.querySelector('[data-show="tools-bar"]').click();
    expect(spy.mock.calls[spy.mock.calls.length - 1][0][0].sel).toBe('#tools-bar');
    spy.mockRestore();
    VexTour.end();
  });

  it('Escape closes it', () => {
    VexDiscover.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('vex-discover')).toBeNull();
  });

  it('refuses an id that is not in the catalogue rather than doing nothing', () => {
    VexDiscover.open();
    expect(() => VexDiscover.showMe('no-such-feature')).toThrow(/no-such-feature/);
    expect(() => VexDiscover.openFeature('no-such-feature')).toThrow(/no-such-feature/);
  });
});

describe('the tour engine Discover drives', () => {
  it('drops steps whose target is not on screen, and counts what is left', () => {
    document.body.innerHTML = '<div id="here"></div>';
    document.getElementById('here').getBoundingClientRect =
      () => ({ left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 });

    const shown = VexTour.run([
      { sel: '#here', title: 'Here' },
      { sel: '#gone', title: 'Gone' },
      { title: 'No target at all' },
    ], { markSeen: false });
    expect(shown).toBe(2);
    VexTour.end();
  });

  it('a single spotlight does not mark the whole tour as seen', () => {
    document.body.innerHTML = '<div id="here"></div>';
    document.getElementById('here').getBoundingClientRect =
      () => ({ left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 });
    VexTour.spotlight('#here', { title: 'One thing' });
    VexTour.end();
    expect(localStorage.getItem('vex.tourSeen')).toBeNull();
  });

  it('running a category does not replace the built-in walkthrough', () => {
    const before = VexTour.steps.length;
    document.body.innerHTML = '<div id="here"></div>';
    document.getElementById('here').getBoundingClientRect =
      () => ({ left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 });
    VexTour.run([{ sel: '#here', title: 'Just one' }], { markSeen: false });
    VexTour.end();
    expect(VexTour.steps.length).toBe(before);
  });

  it('returns 0 rather than opening an empty tour', () => {
    document.body.innerHTML = '';
    expect(VexTour.run([{ sel: '#nothing', title: 'x' }], { markSeen: false })).toBe(0);
  });
});

// The catalogue points at things in index.html, which jsdom tests never load —
// so check the markup itself rather than assuming.
describe('the catalogue points at controls that exist in index.html', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'), 'utf8');

  it('every `panel` has a sidebar icon to spotlight and un-hide', () => {
    const bad = VexFeatures.ITEMS
      .filter(f => f.panel && !html.includes(`data-panel="${f.panel}"`))
      .map(f => `${f.id} -> ${f.panel}`);
    expect(bad, 'panels with no icon on the rail').toEqual([]);
  });

  it('every `sel` and every settings target is a real element id', () => {
    const bad = [];
    for (const f of VexFeatures.ITEMS) {
      if (f.sel && f.sel.startsWith('#') && !html.includes(`id="${f.sel.slice(1)}"`)) bad.push(`${f.id} sel ${f.sel}`);
      if (f.setting?.id && !html.includes(`id="${f.setting.id}"`)) bad.push(`${f.id} setting ${f.setting.id}`);
      if (f.setting?.section && !html.includes(`id="${f.setting.section}"`)) bad.push(`${f.id} section ${f.setting.section}`);
    }
    expect(bad, 'catalogue targets missing from index.html').toEqual([]);
  });

  it('is loaded by index.html, before Discover uses it', () => {
    const cat = html.indexOf('js/feature-catalog.js');
    const disc = html.indexOf('js/discover.js');
    const icons = html.indexOf('js/vex-icons.js');
    expect(cat).toBeGreaterThan(-1);
    expect(icons).toBeLessThan(cat);
    expect(cat).toBeLessThan(disc);
  });
});

describe('"New to you" — what you have never used', () => {
  it('counts everything with no record of use', () => {
    localStorage.clear();
    expect(VexFeatures.unused()).toHaveLength(VexFeatures.ITEMS.length);
  });

  it('reads the command bar\'s own usage record', () => {
    localStorage.setItem('vex.commandUsage', JSON.stringify({ split: { n: 3, at: Date.now() } }));
    expect(VexFeatures.used(VexFeatures.get('split'))).toBe(true);
    expect(VexFeatures.used(VexFeatures.get('peek'))).toBe(false);
    expect(VexFeatures.unused().map(f => f.id)).not.toContain('split');
  });

  it('a recorded id with no uses does not count as used', () => {
    localStorage.setItem('vex.commandUsage', JSON.stringify({ split: { n: 0, at: 0 } }));
    expect(VexFeatures.used(VexFeatures.get('split'))).toBe(false);
  });

  it('also reads the sidebar\'s per-panel record', () => {
    localStorage.setItem('vex.panelUsage', JSON.stringify({ notes: Date.now() }));
    expect(VexFeatures.used(VexFeatures.get('notes'))).toBe(true);
  });

  it('survives a corrupt usage store instead of throwing', () => {
    localStorage.setItem('vex.commandUsage', 'not json');
    localStorage.setItem('vex.panelUsage', '{{{');
    expect(() => VexFeatures.unused()).not.toThrow();
    expect(VexFeatures.used(VexFeatures.get('split'))).toBe(false);
  });

  it('leads the category list, and lists only unused features', () => {
    localStorage.clear();
    localStorage.setItem('vex.commandUsage', JSON.stringify({
      split: { n: 1, at: Date.now() }, peek: { n: 1, at: Date.now() },
    }));
    VexDiscover.open();
    const first = document.querySelector('#vexd-cats .vexd-cat');
    expect(first.dataset.cat).toBe(VexDiscover.NEW_TO_YOU);
    expect(first.classList.contains('fresh')).toBe(true);

    first.click();
    const shown = [...document.querySelectorAll('.vexd-item')].map(e => e.dataset.id);
    expect(shown).not.toContain('split');
    expect(shown).not.toContain('peek');
    expect(shown.length).toBe(VexFeatures.ITEMS.length - 2);
  });

  it('is not offered once you have used everything', () => {
    const all = {};
    for (const f of VexFeatures.ITEMS) if (f.cmd) all[f.cmd] = { n: 1, at: Date.now() };
    const panels = {};
    for (const f of VexFeatures.ITEMS) if (f.panel) panels[f.panel] = Date.now();
    localStorage.setItem('vex.commandUsage', JSON.stringify(all));
    localStorage.setItem('vex.panelUsage', JSON.stringify(panels));
    // Features with neither a command nor a panel can never be recorded, so
    // the row only disappears when those are the only ones left.
    const stillUnused = VexFeatures.unused();
    expect(stillUnused.every(f => !f.cmd && !f.panel)).toBe(true);
  });

  it('is honest that the record is capped, not a certainty', () => {
    localStorage.clear();
    VexDiscover.open(VexDiscover.NEW_TO_YOU);
    expect(document.querySelector('.vexd-cathead-blurb').textContent).toMatch(/last 60 commands/i);
  });
});
