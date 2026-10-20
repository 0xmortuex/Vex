// @vitest-environment jsdom
//
// The pop-up after an update (js/update-tour.js): every feature that is new, each with a switch, why it is there and how to use it.
// Which features are new is found by itself (the ones Vex did not have at the last start) and from the release notes' (feature: id) tags.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
const { parseChangelogList } = require('../../src/main-helpers.js');
const { VexUpdateNotes } = require('../../src/renderer/js/update-log.js');
globalThis.VexUpdateNotes = VexUpdateNotes;

const CHANGELOG = [
  '# Changelog', '',
  '## v5.1.0 (2026-10-21) — Pointers', '',
  '- **A cursor of your own**: pick a shape and colour. Try: Settings > Mouse cursor. (feature: alpha)',
  '- **Settings is a gear now**: it used to be a sun.',
  '- **A thing nobody has**: not in this build. (feature: missing)',
  '- **Another fix**: the fix.', '',
  '## v5.0.0 (2026-10-01) — Old', '',
  '- **The base**: base. (feature: base)', '',
].join('\n');
const LIST = parseChangelogList(CHANGELOG);
const ENTRIES = [LIST[0]];   // the update being told about: v5.1.0 only

let features, on, registry, calls, VexUpdateTour;

const NAMES = { alpha: 'Alpha cursor', beta: 'Beta effect', gamma: 'Gamma fixed', delta: 'Delta panel', base: 'Base' };
function fakes() {
  on = { alpha: false, beta: true, base: true };
  calls = { enable: [], off: [], panel: [] };
  const ids = ['base', 'alpha', 'beta', 'gamma', 'delta'];
  globalThis.VexRegistry = registry = {
    all: () => ids.map(id => ({ id, title: NAMES[id], killSwitch: id === 'gamma' ? 'none' : 'usage' })),
    switchOff: vi.fn(async (id) => { calls.off.push(id); on[id] = false; }),
  };
  globalThis.VexUsage = { get: (id) => (id in on ? { id } : null), isEnabled: (id) => !!on[id] };
  globalThis.VexFeatures = {
    offState: (item) => (on[item.id] ? null : { enable: async () => { calls.enable.push(item.id); on[item.id] = true; } }),
  };
  globalThis.VexActivation = {
    entryFor: (id) => (id === 'delta' ? { id, feature: id, panel: 'delta-panel' } : { id, feature: id, setting: id === 'gamma' ? { id: 'setting-gamma', label: 'Gamma' } : undefined }),
    describe: vi.fn(async (entry, id) => ({
      name: NAMES[id], what: 'What ' + id + ' is for.', more: '', how: 'How to use ' + id + '.', touches: ['Sends nothing off this computer'],
      settings: id === 'alpha' ? { target: 'setting-alpha', label: 'Alpha' } : null,
    })),
  };
  // The real one stores the choice (vex.panelOverrides), which is what the switch reads back.
  globalThis.SidebarManager = { setPanelOverride: vi.fn((p, o) => { calls.panel.push([p, o]); localStorage.setItem('vex.panelOverrides', JSON.stringify({ [p]: o })); }) };
  globalThis.SettingsUI = { openSection: vi.fn() };
  globalThis.VexSettingsGroups = {
    note: (t) => Object.assign(document.createElement('p'), { textContent: t, className: 'note' }),
    button: (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.addEventListener('click', fn); return b; },
    dialog: ({ title, sub }) => {
      const overlay = document.createElement('div'); overlay.id = 'vex-update-tour'; overlay.dataset.title = title; overlay.dataset.sub = sub;
      const body = document.createElement('div'); overlay.appendChild(body); document.body.appendChild(overlay);
      return { overlay, body, close: () => overlay.remove() };
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.VexProblems = { note: vi.fn() }; globalThis.VexProblems = window.VexProblems;
  fakes();
  delete require.cache[require.resolve('../../src/renderer/js/update-tour.js')];
  ({ VexUpdateTour } = require('../../src/renderer/js/update-tour.js'));
});
afterEach(() => {
  for (const k of ['VexRegistry', 'VexUsage', 'VexFeatures', 'VexActivation', 'SidebarManager', 'SettingsUI', 'VexSettingsGroups', 'VexI18nUI', 'VexBoot', 'VexExtras']) delete globalThis[k];
});
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const tour = () => document.getElementById('vex-update-tour');
const names = () => [...tour().querySelectorAll('.vex-tour-name')].map(n => n.textContent);

describe('which features are new', () => {
  it('has none the first time, which only makes the record', () => {
    expect(VexUpdateTour.known()).toBeNull();
    expect(VexUpdateTour.fresh()).toEqual([]);
  });
  it('is every feature Vex did not have at the last start', () => {
    VexUpdateTour.saveKnown(['base', 'alpha']);
    expect(VexUpdateTour.fresh()).toEqual(['beta', 'gamma', 'delta']);
  });
  it('keeps the record up to date quietly when no update is waiting, and leaves it when one is', () => {
    VexUpdateTour.saveKnown(['base']);
    localStorage.setItem('vex.whatsNewPending', JSON.stringify({ from: '5.0.0', to: '5.1.0' }));
    expect(VexUpdateTour.syncKnown()).toBe(false);
    expect(VexUpdateTour.known()).toEqual(['base']);               // the pop-up still has the old record to compare with
    localStorage.removeItem('vex.whatsNewPending');
    expect(VexUpdateTour.syncKnown()).toBe(true);
    expect(VexUpdateTour.known()).toEqual(['base', 'alpha', 'beta', 'gamma', 'delta']);
  });
  it('says so, and starts the record again, when it cannot be read', () => {
    localStorage.setItem('vex.featuresKnown', '{broken');
    expect(VexUpdateTour.known()).toBeNull();
    expect(window.VexProblems.note).toHaveBeenCalled();
  });
  it('lists the tagged ones first, then the new ones, each once, and ignores a tag for a feature that does not exist', () => {
    VexUpdateTour.saveKnown(['base', 'alpha']);
    const got = VexUpdateTour.collect(ENTRIES);
    expect(got.map(f => f.id)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    expect(got[0]).toMatchObject({ id: 'alpha', lead: 'A cursor of your own', why: 'pick a shape and colour.', how: 'Settings > Mouse cursor.', tagged: true });
    expect(got[1].tagged).toBe(false);
  });
  it('splits the explanation from the steps', () => {
    expect(VexUpdateTour.splitTry('why it exists. Try: do this.')).toEqual({ why: 'why it exists.', how: 'do this.' });
    expect(VexUpdateTour.splitTry('only a reason')).toEqual({ why: 'only a reason', how: '' });
    expect(VexUpdateTour.splitTry('')).toEqual({ why: '', how: '' });
  });
  it('explains the points that are not about a feature', () => {
    expect(VexUpdateTour.fixes(ENTRIES)).toEqual([
      { lead: 'Settings is a gear now', detail: 'it used to be a sun.' },
      { lead: 'Another fix', detail: 'the fix.' },
    ]);
  });
});

describe('the pop-up', () => {
  it('shows nothing when there is nothing new', async () => {
    VexUpdateTour.saveKnown();
    expect(await VexUpdateTour.open({ entries: [] })).toBe(false);
    expect(tour()).toBeNull();
  });
  it('shows one block per new feature, with a switch as it stands, why, how and what it touches', async () => {
    VexUpdateTour.saveKnown(['base']);
    expect(await VexUpdateTour.open({ entries: ENTRIES, version: 'v5.1.0' })).toBe(true);
    expect(tour().dataset.title).toBe('Vex 5.1.0 is here: what is new, feature by feature');
    expect(names().slice(0, 4)).toEqual(['Alpha cursor', 'Beta effect', 'Gamma fixed', 'Delta panel']);
    const alpha = tour().querySelectorAll('.vex-tour-feat')[0];
    expect(alpha.querySelector('input').checked).toBe(false);
    expect(alpha.querySelector('input').getAttribute('aria-label')).toBe('Turn Alpha cursor on or off');
    const text = alpha.textContent;
    expect(text).toContain('Why A cursor of your own: pick a shape and colour. What alpha is for.');
    expect(text).toContain('How Settings > Mouse cursor.');                       // the release notes' steps beat the generic ones
    expect(text).toContain('What it touches Sends nothing off this computer.');
    expect(tour().querySelectorAll('.vex-tour-feat')[1].querySelector('input').checked).toBe(true);
    expect(tour().querySelectorAll('.vex-tour-feat')[1].textContent).toContain('How How to use beta.');   // no steps in the notes: the feature's own
  });
  it('says plainly when a feature has no switch, instead of drawing one that does nothing', async () => {
    VexUpdateTour.saveKnown(['base']);
    await VexUpdateTour.open({ entries: ENTRIES });
    const gamma = tour().querySelectorAll('.vex-tour-feat')[2];
    expect(gamma.querySelector('input')).toBeNull();
    expect(gamma.textContent).toContain('Part of Vex: no switch');
  });
  it('lists the fixes of the update, each opening to its explanation', async () => {
    VexUpdateTour.saveKnown(['base']);
    await VexUpdateTour.open({ entries: ENTRIES });
    const fixes = [...tour().querySelectorAll('details.vex-tour-fix')];
    expect(fixes.map(d => d.querySelector('summary').textContent)).toEqual(['Settings is a gear now', 'Another fix']);
    expect(fixes[0].querySelector('p').textContent).toBe('it used to be a sun.');
  });
  it('offers each feature\'s own Settings, which closes the pop-up and opens them', async () => {
    VexUpdateTour.saveKnown(['base']);
    await VexUpdateTour.open({ entries: ENTRIES });
    const open = [...tour().querySelectorAll('button')].find(b => b.textContent === 'Open its settings');
    open.click();
    expect(SettingsUI.openSection).toHaveBeenCalledWith('setting-alpha');
    expect(tour()).toBeNull();
  });
  it('lists at most twelve and says how many more there are', async () => {
    const ids = Array.from({ length: 15 }, (_, i) => 'f' + i);
    globalThis.VexRegistry.all = () => ids.map(id => ({ id, title: id, killSwitch: 'usage' }));
    globalThis.VexActivation.describe = async (e, id) => ({ name: id, what: 'w', more: '', how: 'h', touches: [], settings: null });
    VexUpdateTour.saveKnown([]);
    await VexUpdateTour.open({ entries: [] });
    expect(tour().querySelectorAll('.vex-tour-feat')).toHaveLength(12);
    expect(tour().textContent).toContain('and 3 more new features.');
  });
});

describe('the switch', () => {
  const flip = async (card, want) => { const i = card.querySelector('input'); i.checked = want; i.dispatchEvent(new Event('change')); await flush(); return i; };
  beforeEach(async () => { VexUpdateTour.saveKnown(['base']); await VexUpdateTour.open({ entries: ENTRIES }); });
  const cards = () => tour().querySelectorAll('.vex-tour-feat');

  it('turns a feature on through the same check the "switched off" offer uses, and says so', async () => {
    const input = await flip(cards()[0], true);
    expect(calls.enable).toEqual(['alpha']);
    expect(input.checked).toBe(true);
    expect(cards()[0].querySelector('.vex-tour-status').textContent).toBe('Alpha cursor is on');
  });
  it('turns a feature off again', async () => {
    const input = await flip(cards()[1], false);
    expect(registry.switchOff).toHaveBeenCalledWith('beta');
    expect(input.checked).toBe(false);
    expect(cards()[1].querySelector('.vex-tour-status').textContent).toBe('Beta effect is off');
  });
  it('a refusal puts the switch back and says why, to the person and in the Problems log', async () => {
    globalThis.VexFeatures.offState = () => ({ enable: async () => { throw new Error('Leave Minimal Vex before turning this feature on'); } });
    const input = await flip(cards()[0], true);
    expect(input.checked).toBe(false);
    expect(cards()[0].querySelector('.vex-tour-status').textContent).toBe('Could not change Alpha cursor: Leave Minimal Vex before turning this feature on');
    expect(window.VexProblems.note).toHaveBeenCalled();
    expect(input.disabled).toBe(false);
  });
  it('switches a panel feature through the sidebar', async () => {
    const input = await flip(cards()[3], false);
    expect(calls.panel).toEqual([['delta-panel', { hidden: true }]]);
    expect(input.checked).toBe(false);
  });
  it('switches a feature that is a checkbox in Settings through that checkbox', async () => {
    VexUpdateTour.saveKnown(['base']);
    document.body.insertAdjacentHTML('beforeend', '<input type="checkbox" id="setting-gamma" checked>');
    const cap = VexUpdateTour.capability({ id: 'gamma', feature: 'gamma', setting: { id: 'setting-gamma' } }, 'gamma');
    expect(cap.kind).toBe('checkbox');
    expect(cap.on()).toBe(true);
    await cap.set(false);
    expect(document.getElementById('setting-gamma').checked).toBe(false);
  });
  it('Turn all on and Turn all off go through each switch', async () => {
    const all = (label) => [...tour().querySelectorAll('button')].find(b => b.textContent === label);
    all('Turn all on').click();
    await flush(); await new Promise(r => setTimeout(r, 20)); await flush();
    expect(calls.enable).toContain('alpha');
    all('Turn all off').click();
    await flush(); await new Promise(r => setTimeout(r, 20)); await flush();
    expect(registry.switchOff).toHaveBeenCalledWith('beta');
    expect(registry.switchOff).toHaveBeenCalledWith('alpha');
  });
});

describe('closing it', () => {
  it('Done, the X, Escape and a click outside are all the same: final for this update, and the features count as seen', async () => {
    VexUpdateTour.saveKnown(['base']);
    const onClose = vi.fn();
    await VexUpdateTour.open({ entries: ENTRIES, onClose });
    expect(VexUpdateTour.known()).toEqual(['base']);
    [...tour().querySelectorAll('button')].find(b => b.textContent === 'Done').click();
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(VexUpdateTour.known()).toEqual(['base', 'alpha', 'beta', 'gamma', 'delta']);
    expect(VexUpdateTour.fresh()).toEqual([]);
  });
  it('closed from outside (what Escape and the X do) is the same', async () => {
    VexUpdateTour.saveKnown(['base']);
    const onClose = vi.fn();
    await VexUpdateTour.open({ entries: ENTRIES, onClose });
    tour().remove();
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(VexUpdateTour.fresh()).toEqual([]);
  });
  it('a preview changes nothing about what counts as seen', async () => {
    VexUpdateTour.saveKnown(['base']);
    const onClose = vi.fn();
    await VexUpdateTour.open({ entries: ENTRIES, preview: true, onClose });
    tour().remove();
    await flush();
    expect(VexUpdateTour.known()).toEqual(['base']);
  });
  it('a preview with nothing tagged and nothing new still shows the latest features', async () => {
    VexUpdateTour.saveKnown();
    expect(await VexUpdateTour.open({ entries: [], preview: true })).toBe(true);
    expect(tour().querySelectorAll('.vex-tour-feat').length).toBeGreaterThan(0);
  });
});

describe('after an update, from the card\'s side', () => {
  function load() {
    vi.resetModules();
    window.VexTabPolicy = { isPrivateWindow: false };
    window.vex = { getAppVersion: vi.fn(async () => '5.1.0'), getReleaseNotes: vi.fn(async () => LIST[0]), getReleaseList: vi.fn(async () => LIST), openExternal: vi.fn() };
    const file = require.resolve('../../src/renderer/js/update-log.js');
    delete require.cache[file];
    require(file);
  }
  const start = async () => {
    localStorage.setItem('vex.lastSeenVersion', '5.0.0');
    load();
    await flush();
    vi.advanceTimersByTime(1300);
    await flush();
  };
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); delete window.VexUpdateTour; });

  it('shows the pop-up, not the small card, when there are new features; closing it clears the waiting notice', async () => {
    VexUpdateTour.saveKnown(['base']);
    window.VexUpdateTour = VexUpdateTour;
    await start();
    expect(tour()).not.toBeNull();
    expect(document.querySelector('.whatsnew-tip')).toBeNull();
    expect(localStorage.getItem('vex.whatsNewPending')).not.toBeNull();
    tour().remove();
    await flush();
    expect(localStorage.getItem('vex.whatsNewPending')).toBeNull();
  });
  it('keeps the small card when the update added no features', async () => {
    VexUpdateTour.saveKnown();
    window.VexUpdateTour = { open: vi.fn(async () => false) };
    await start();
    expect(document.querySelector('.whatsnew-tip')).not.toBeNull();
  });
  it('keeps the small card, and says so, when the pop-up fails', async () => {
    window.VexUpdateTour = { open: vi.fn(async () => { throw new Error('boom'); }) };
    await start();
    expect(document.querySelector('.whatsnew-tip')).not.toBeNull();
    expect(window.VexProblems.note).toHaveBeenCalled();
  });
});

describe('the command and the record', () => {
  it('Ctrl+K "Show the new features of this update" is registered', () => {
    const registerCommand = vi.fn();
    globalThis.VexExtras = { registerCommand };
    delete require.cache[require.resolve('../../src/renderer/js/update-tour.js')];
    require('../../src/renderer/js/update-tour.js');
    expect(registerCommand).toHaveBeenCalledWith(expect.objectContaining({ id: 'update-tour', label: 'Show the new features of this update' }));
  });
  it('keeps the record up to date once the late modules are in', async () => {
    let done;
    globalThis.VexBoot = { whenSettled: () => new Promise((r) => { done = r; }) };
    delete require.cache[require.resolve('../../src/renderer/js/update-tour.js')];
    const { VexUpdateTour: T } = require('../../src/renderer/js/update-tour.js');
    expect(T.known()).toBeNull();
    done();
    await flush();
    expect(T.known()).toEqual(['base', 'alpha', 'beta', 'gamma', 'delta']);
  });
  it('is loaded late, with the feature it belongs to', () => {
    expect(fs.readFileSync('src/renderer/js/lazy-boot.js', 'utf8')).toContain("{ src: 'js/update-tour.js', usage: ['whats-new-me'] }");
    expect(fs.readFileSync('src/renderer/js/feature-manifests.js', 'utf8')).toContain("'vex.featuresKnown'");
  });
  it('has Turkish for the pop-up\'s own words', () => {
    const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
    for (const s of ['Why', 'How', 'What it touches', 'Open its settings', 'Turn all on', 'Turn all off', 'Fixes and changes in this update', 'Part of Vex: no switch', 'No new features to show.']) {
      expect(VexI18nUI.lookup(s, 'tr'), s).not.toBeNull();
    }
  });
});
