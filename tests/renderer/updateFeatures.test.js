// @vitest-environment jsdom
//
// The update card explains each fix and puts a switch beside each new feature (src/renderer/js/update-log.js): a release bullet that ends
// with "(feature: id)" names a feature, and the card and What's new for me then carry that feature's real on/off switch. Only for a
// feature that has one in this build: there are no buttons that do nothing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
const { parseChangelogList } = require('../../src/main-helpers.js');
const { VexUpdateNotes } = require('../../src/renderer/js/update-log.js');

const CHANGELOG = [
  '# Changelog', '',
  '## v4.1.0 (2026-10-20) — A cursor of your own', '',
  '- **A cursor of your own**: pick a shape and a colour. Try: Settings > Mouse cursor. (feature: custom-cursor)',
  '- **Settings is a gear now**: it used to be a sun, and nobody could find it.',
  '- **A click animation**: a short one, where you click. (feature: Click-Effect)',
  '- **A thing with no switch here**: it only exists in some builds. (feature: ghost)',
  '- **A thing that cannot be switched**: always on. (feature: fixed)',
  '- **Same one twice**: again. (feature: custom-cursor)', '',
  '## v4.0.0 (2026-10-01) — Old', '',
  '- **The base**: the base release.', '',
].join('\n');
const LIST = parseChangelogList(CHANGELOG);

describe('reading the tag', () => {
  it('finds the feature a bullet names, in lower case, and never shows the tag', () => {
    const b = '**A click animation**: a short one. (feature: Click-Effect)';
    expect(VexUpdateNotes.featureOf(b)).toBe('click-effect');
    expect(VexUpdateNotes.plain(b)).toBe('A click animation: a short one.');
    expect(VexUpdateNotes.lead(b)).toBe('A click animation');
    expect(VexUpdateNotes.detail(b)).toBe('a short one.');
    expect(VexUpdateNotes.firstSentence('A plain point with no lead. (feature: x-y)')).toBe('A plain point with no lead');
  });
  it('a bullet with no tag names nothing', () => {
    expect(VexUpdateNotes.featureOf('**Settings is a gear**: it was a sun.')).toBeNull();
    expect(VexUpdateNotes.featureOf('')).toBeNull();
  });
  it('a tag in the middle of a sentence is not a tag', () => {
    expect(VexUpdateNotes.featureOf('**X**: see (feature: custom-cursor) in Settings and more')).toBeNull();
  });
  it('gives the explanation after the lead, and nothing when there is no lead', () => {
    expect(VexUpdateNotes.detail('**Lead**: the explanation. Try: do this.')).toBe('the explanation. Try: do this.');
    expect(VexUpdateNotes.detail('No lead here at all.')).toBe('');
    expect(VexUpdateNotes.detail('**Only a lead**')).toBe('');
  });
  it('lists every point with its lead, explanation and feature', () => {
    const items = VexUpdateNotes.items(LIST[0].body);
    expect(items).toHaveLength(6);
    expect(items[0]).toEqual({ lead: 'A cursor of your own', detail: 'pick a shape and a colour. Try: Settings > Mouse cursor.', feature: 'custom-cursor' });
    expect(items[1].feature).toBeNull();
  });
  it('the highlights are what they were: the leads, without the tag', () => {
    expect(VexUpdateNotes.points(LIST[0].body)[0]).toBe('A cursor of your own');
  });
  it('picks each feature once, only those with a real switch, newest release first, at most the number asked for', () => {
    const usable = (id) => id !== 'ghost' && id !== 'fixed';
    expect(VexUpdateNotes.features(LIST, usable).map(f => f.id)).toEqual(['custom-cursor', 'click-effect']);
    expect(VexUpdateNotes.features(LIST, usable, 1)).toHaveLength(1);
    expect(VexUpdateNotes.features(LIST, () => false)).toEqual([]);
    expect(VexUpdateNotes.features(LIST).map(f => f.id)).toEqual(['custom-cursor', 'click-effect', 'ghost', 'fixed']);
    expect(VexUpdateNotes.features(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
let state, registry, problems;

function setFeatures() {
  state = { 'custom-cursor': { title: 'Mouse cursor', on: false }, 'click-effect': { title: 'Click effect', on: true } };
  registry = {
    all: () => [...Object.entries(state).map(([id, f]) => ({ id, title: f.title, killSwitch: 'usage' })), { id: 'ghost', title: 'Ghost', killSwitch: 'usage' }, { id: 'fixed', title: 'Fixed', killSwitch: 'none' }],
    switchOn: vi.fn(async (id) => { state[id].on = true; }),
    switchOff: vi.fn(async (id) => { state[id].on = false; }),
  };
  globalThis.VexRegistry = registry;
  globalThis.VexUsage = { get: (id) => (state[id] ? { id } : null), isEnabled: (id) => state[id].on };
}

function load() {
  vi.resetModules();
  window.VexTabPolicy = { isPrivateWindow: false };
  problems = vi.fn();
  window.VexProblems = { note: problems };
  globalThis.VexProblems = window.VexProblems;
  window.showToast = vi.fn();
  window.vex = {
    getAppVersion: vi.fn(async () => '4.1.0'),
    getReleaseNotes: vi.fn(async () => LIST[0]),
    getReleaseList: vi.fn(async () => LIST),
    openExternal: vi.fn(),
  };
  const file = require.resolve('../../src/renderer/js/update-log.js');
  delete require.cache[file];
  require(file);
}
const card = () => document.querySelector('.whatsnew-tip');
async function start() {
  localStorage.setItem('vex.lastSeenVersion', '4.0.0');
  load();
  await flush();
  vi.advanceTimersByTime(1300);
  await flush();
}

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); document.body.innerHTML = ''; setFeatures(); delete globalThis.VexBoot; });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete globalThis.VexRegistry; delete globalThis.VexUsage; delete globalThis.VexBoot; delete window.VexUpdateFeatureSwitch; });

describe('the card: a switch beside each new feature', () => {
  it('lists the new things you can turn on, only those with a real switch here, with the fix explained', async () => {
    await start();
    const section = card().querySelector('.whatsnew-feats');
    expect(section).not.toBe(null);
    const rows = [...section.querySelectorAll('.whatsnew-feat')];
    expect(rows.map(r => r.querySelector('strong').textContent)).toEqual(['A cursor of your own', 'A click animation']);
    expect(rows[0].querySelector('.whatsnew-feat-text span').textContent).toBe('pick a shape and a colour. Try: Settings > Mouse cursor.');
    expect(card().textContent).not.toContain('(feature:');
    expect(card().textContent).not.toContain('Ghost');
  });
  it('shows each switch as the feature stands, labelled for a screen reader', async () => {
    await start();
    const inputs = [...card().querySelectorAll('.whatsnew-feat input')];
    expect(inputs.map(i => i.checked)).toEqual([false, true]);
    expect(inputs[0].getAttribute('role')).toBe('switch');
    expect(inputs[0].getAttribute('aria-label')).toBe('Turn Mouse cursor on or off');
  });
  it('flipping it on turns the feature on, and says so', async () => {
    await start();
    const input = card().querySelector('.whatsnew-feat input');
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    await flush();
    expect(registry.switchOn).toHaveBeenCalledWith('custom-cursor');
    expect(state['custom-cursor'].on).toBe(true);
    expect(window.showToast).toHaveBeenCalledWith('Mouse cursor is on', 'info');
    expect(input.disabled).toBe(false);
  });
  it('flipping it off turns the feature off again', async () => {
    await start();
    const input = card().querySelectorAll('.whatsnew-feat input')[1];
    input.checked = false;
    input.dispatchEvent(new Event('change'));
    await flush();
    expect(registry.switchOff).toHaveBeenCalledWith('click-effect');
    expect(state['click-effect'].on).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('Click effect is off', 'info');
  });
  it('a refusal puts the switch back and says why, in the Problems log and to the person', async () => {
    registry.switchOn = vi.fn(async () => { throw new Error('it is not running in this build'); });
    await start();
    const input = card().querySelector('.whatsnew-feat input');
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    await flush();
    expect(input.checked).toBe(false);
    expect(problems).toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('Could not change Mouse cursor: it is not running in this build', 'error');
    expect(input.disabled).toBe(false);
  });
  it('turning a feature on does not close the card or mark anything as seen by itself', async () => {
    await start();
    const input = card().querySelector('.whatsnew-feat input');
    input.checked = true; input.dispatchEvent(new Event('change')); await flush();
    expect(card()).not.toBe(null);
    expect(localStorage.getItem('vex.whatsNewPending')).not.toBe(null);
  });
  it('has no section at all when no feature here has a switch', async () => {
    delete globalThis.VexRegistry;
    await start();
    expect(card()).not.toBe(null);
    expect(card().querySelector('.whatsnew-feats')).toBe(null);
    expect(card().textContent).not.toContain('New things you can turn on');
  });
  it('explains a point when it is opened, and leaves the ones with nothing to add as they were', async () => {
    await start();
    const open = [...card().querySelectorAll('details.whatsnew-more')];
    expect(open.length).toBeGreaterThanOrEqual(3);
    const gear = open.find(d => d.querySelector('summary').textContent === 'Settings is a gear now');
    expect(gear.querySelector('p').textContent).toBe('it used to be a sun, and nobody could find it.');
  });
  it('waits for the late modules, so a switch is never made for a feature that is about to appear', async () => {
    let done;
    globalThis.VexBoot = { whenSettled: () => new Promise((r) => { done = r; }) };
    await start();
    expect(card()).toBe(null);
    done();
    await flush();
    expect(card()).not.toBe(null);
    expect(card().querySelectorAll('.whatsnew-feat')).toHaveLength(2);
  });
  it('does not wait for ever when the late modules never settle', async () => {
    globalThis.VexBoot = { whenSettled: () => new Promise(() => {}) };
    await start();
    expect(card()).toBe(null);
    vi.advanceTimersByTime(12500);
    await flush();
    expect(card()).not.toBe(null);
  });
});

describe('the switch on its own (What\'s new for me, Welcome back)', () => {
  it('says which features have one, and builds the switch for them', async () => {
    load();
    const S = window.VexUpdateFeatureSwitch;
    expect(S.usable('custom-cursor')).toBe(true);
    expect(S.usable('ghost')).toBe(false);          // a manifest, but nothing running behind it
    expect(S.usable('fixed')).toBe(false);          // cannot be switched
    expect(S.usable('nothing-called-this')).toBe(false);
    const el = S.control('custom-cursor');
    expect(el.querySelector('input').checked).toBe(false);
    expect(() => S.control('nothing-called-this')).toThrow(/no feature called/);
  });
  it('What\'s new for me shows it beside a point that names a feature, and not beside one that does not', async () => {
    load();
    globalThis.VexUpdateNotes = VexUpdateNotes;
    window.vex.getAppVersion = vi.fn(async () => '4.1.0');
    const mine = require('../../src/renderer/js/whats-new-me.js');
    const { VexWhatsNewMe } = mine;
    globalThis.VexSettingsGroups = {
      register() {}, button: (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.addEventListener('click', fn); return b; },
      note: (t) => Object.assign(document.createElement('div'), { textContent: t }),
      dialog: () => { const body = document.createElement('div'); body.id = 'wn-body'; document.body.appendChild(body); return { body, close: () => body.remove() }; },
    };
    localStorage.setItem('vex.whatsNewMe.seen', '4.0.0');
    const p = await VexWhatsNewMe.pending();
    const pts = p.releases[0].points;
    expect(pts.find(x => x.text === 'A cursor of your own').feature).toBe('custom-cursor');
    expect(pts.find(x => x.text === 'Settings is a gear now').feature).toBe('');
    await VexWhatsNewMe.open();
    const rows = [...document.querySelectorAll('#wn-body .vexsr-rule')].filter(r => r.querySelector('.vexsr-host'));
    const withSwitch = rows.filter(r => r.querySelector('.whatsnew-switch')).map(r => r.querySelector('.vexsr-host').textContent);
    expect(withSwitch).toEqual(['A cursor of your own', 'A click animation']);
    delete globalThis.VexSettingsGroups; delete globalThis.VexUpdateNotes;
  });
});

describe('the release notes themselves', () => {
  const manifests = fs.readFileSync('src/renderer/js/feature-manifests.js', 'utf8');
  const ids = new Set([...manifests.matchAll(/\{ id: '([a-z0-9._:-]+)'/g)].map(m => m[1]));
  const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
  it('every (feature: id) tag in the CHANGELOG names a feature that exists', () => {
    const tags = [...changelog.matchAll(/\(feature:\s*([^)\s]+)\)/gi)].map(m => m[1]);
    const unknown = tags.filter(t => !ids.has(t));
    expect(unknown).toEqual([]);
  });
  it('every tag is lower case, so it matches what the card looks up', () => {
    const tags = [...changelog.matchAll(/\(feature:\s*([^)\s]+)\)/gi)].map(m => m[1]);
    expect(tags.filter(t => t !== t.toLowerCase())).toEqual([]);
  });
  it('RELEASING.md tells the person writing the notes how to tag a feature', () => {
    expect(fs.readFileSync('RELEASING.md', 'utf8')).toContain('(feature: ');
  });
});

describe('Turkish', () => {
  it('has the words of the new section and its switch', () => {
    const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
    for (const s of ['New things you can turn on', 'Turn {title} on or off', '{title} is on', '{title} is off', 'Could not change {title}:']) {
      expect(VexI18nUI.lookup(s, 'tr'), s).not.toBeNull();
    }
  });
});
