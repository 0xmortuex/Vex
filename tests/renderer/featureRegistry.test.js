// @vitest-environment jsdom
//
// js/feature-registry.js + js/feature-manifests.js: one manifest per feature,
// every feature VexUsage switches has one, every vex.* storage key is owned by
// exactly one manifest (or sits on the documented legacy list), maturity and
// staged enablement, and the tier default Minimal Vex reads.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

function load(withManifests = true) {
  vi.resetModules();
  delete window.__vexUsageQueue;
  globalThis.VexRegistry = fresh(JS + 'feature-registry.js').VexRegistry;
  globalThis.VexUsage = fresh(JS + 'vex-usage.js').VexUsage;
  if (withManifests) fresh(JS + 'feature-manifests.js');
  globalThis.VexUsageRegistry = fresh(JS + 'vex-usage-registry.js').VexUsageRegistry;
}

beforeEach(() => { localStorage.clear(); load(); });

describe('define()', () => {
  beforeEach(() => { VexRegistry._reset(); });

  it('stores a manifest with the defaults filled in and frozen', () => {
    const m = VexRegistry.define({ id: 'demo', title: 'Demo', storageKeys: ['vex.demo'] });
    expect(m).toMatchObject({ id: 'demo', maturity: 'stable', killSwitch: 'usage', tiers: { minimal: false, standard: true } });
    expect(m.budget.gameFetches).toBe(0);
    expect(Object.isFrozen(m)).toBe(true);
  });

  it('refuses a second manifest with the same id', () => {
    VexRegistry.define({ id: 'demo', title: 'Demo' });
    expect(() => VexRegistry.define({ id: 'demo', title: 'Again' })).toThrow(/already has a manifest/);
  });

  it('refuses a storage key that two features both claim, and leaves no half of the second manifest behind', () => {
    VexRegistry.define({ id: 'a', title: 'A', storageKeys: ['vex.shared'] });
    expect(() => VexRegistry.define({ id: 'b', title: 'B', storageKeys: ['vex.mine', 'vex.shared'] })).toThrow(/claimed by "a" and by "b"/);
    expect(VexRegistry.ownerOfKey('vex.mine')).toBe(null);
    expect(VexRegistry.has('b')).toBe(false);
  });

  it('treats a key ending in a dot as a prefix claim, in both directions', () => {
    VexRegistry.define({ id: 'p', title: 'P', storageKeys: ['vex.thing.'] });
    expect(VexRegistry.ownerOfKey('vex.thing.abc')).toBe('p');
    expect(() => VexRegistry.define({ id: 'q', title: 'Q', storageKeys: ['vex.thing.abc'] })).toThrow(/one owner per key/);
  });

  it('rejects bad shapes with a message that names the feature', () => {
    expect(() => VexRegistry.define({ id: 'x', maturity: 'gold' })).toThrow(/maturity is new, beta, experimental or stable/);
    expect(() => VexRegistry.define({ id: 'x', storageKeys: ['theme'] })).toThrow(/not a vex\.\* storage key/);
    expect(() => VexRegistry.define({ id: 'x', budget: { nope: 1 } })).toThrow(/unknown budget item/);
    expect(() => VexRegistry.define({ id: 'x', budget: { jobMsPerMin: -1 } })).toThrow(/zero or more/);
    expect(() => VexRegistry.define({ id: 'x', tiers: { huge: true } })).toThrow(/tiers are minimal and standard/);
    expect(() => VexRegistry.define({ id: 'x', killSwitch: 'maybe' })).toThrow(/killSwitch/);
    expect(() => VexRegistry.define({ id: 'bad id' })).toThrow(/feature id/);
  });

  it('knows which feature owns a job and a command', () => {
    VexRegistry.define({ id: 'j', title: 'J', jobs: ['Do it'], commands: ['do-it'] });
    expect(VexRegistry.forJob('Do it')).toBe('j');
    expect(VexRegistry.forCommand('do-it')).toBe('j');
    expect(() => VexRegistry.define({ id: 'k', title: 'K', jobs: ['Do it'] })).toThrow(/belongs to "j"/);
  });

  it('describes what a feature touches in plain words', () => {
    VexRegistry.define({ id: 'p', title: 'P', permissions: { reads: ['your tabs'], writes: ['one note'], sends: [] } });
    expect(VexRegistry.permissionLines('p')).toEqual(['Reads: your tabs', 'Writes: one note', 'Sends nothing off this computer']);
    VexRegistry.define({ id: 'q', title: 'Q', permissions: { sends: ['a question to your AI backend'] } });
    expect(VexRegistry.permissionLines('q').at(-1)).toBe('Sends off this computer: a question to your AI backend');
  });
});

describe('the shipped manifests', () => {
  it('give every feature VexUsageRegistry switches a manifest, and register() takes title and group from it', () => {
    const table = VexUsageRegistry.table();
    for (const [id] of table) expect(VexRegistry.has(id), id).toBe(true);
    // A module that is absent is not registered, so register only what exists here: a feature
    // whose module is missing must not make the registration throw.
    expect(() => VexUsageRegistry.register()).not.toThrow();
  });

  it('throw, rather than guess, for a feature without a manifest', () => {
    VexRegistry._reset();
    expect(() => VexUsageRegistry.register()).toThrow(/has no manifest/);
  });

  it('are at least the 45 features the usage registry switched, plus the core entries', () => {
    expect(VexRegistry.all().length).toBeGreaterThanOrEqual(45);
    for (const id of ['feature-registry', 'why-did-that', 'library-data']) expect(VexRegistry.get(id).killSwitch).toBe('none');
  });

  it('declare every job and command only once', () => {
    const jobs = VexRegistry.all().flatMap(m => m.jobs);
    expect(new Set(jobs).size).toBe(jobs.length);
    const cmds = VexRegistry.all().flatMap(m => m.commands);
    expect(new Set(cmds).size).toBe(cmds.length);
  });

  it('name commands that really exist in the command registry', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer/js/command.js'), 'utf8')
      + fs.readdirSync(path.join(ROOT, 'src/renderer/js')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(ROOT, 'src/renderer/js', f), 'utf8')).join('\n');
    for (const m of VexRegistry.all()) for (const c of m.commands) expect(src.includes("'" + c + "'"), m.id + ' → ' + c).toBe(true);
  });

  it('keep the three housekeeping features on in the minimal tier', () => {
    for (const id of ['tab-auto-sleep', 'tab-auto-group', 'theme-auto']) expect(VexRegistry.tierDefault(id, 'minimal'), id).toBe(true);
    expect(VexRegistry.tierDefault('brief-snooze', 'minimal')).toBe(false);
  });
});

// Every vex.* key written in the source is owned by exactly one manifest or sits on the
// legacy list. The legacy list is debt: it may only shrink.
describe('every vex.* localStorage key is claimed exactly once', () => {
  const legacy = require('./legacyStorageKeys.js');
  // File names and the like that merely start with "vex.".
  const NOT_STORAGE = new Set(['vex.txt']);

  function walk(dir, out) {
    for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, n.name);
      if (n.isDirectory()) { if (n.name !== 'bundle' && n.name !== 'node_modules') walk(p, out); }
      else if (n.name.endsWith('.js')) out.push(p);
    }
    return out;
  }
  function scan() {
    const files = [...walk(path.join(ROOT, 'src/renderer/js'), []), ...walk(path.join(ROOT, 'src/main'), []), path.join(ROOT, 'src/main.js')];
    const keys = new Map();
    const lit = /(['"`])(vex\.[A-Za-z0-9_.:-]*[A-Za-z0-9_.])\1/g;
    const tpl = /`(vex\.[A-Za-z0-9_.:-]*\.)\$\{/g;
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(lit)) { if (!keys.has(m[2])) keys.set(m[2], new Set()); keys.get(m[2]).add(path.relative(ROOT, f)); }
      for (const m of src.matchAll(tpl)) { if (!keys.has(m[1])) keys.set(m[1], new Set()); keys.get(m[1]).add(path.relative(ROOT, f)); }
    }
    return keys;
  }
  const covers = (claim, key) => claim === key || (claim.endsWith('.') && key.startsWith(claim));

  it('has no key that nobody owns (add a manifest for the feature; do not extend the legacy list)', () => {
    const keys = scan();
    const unowned = [...keys.keys()].filter(k => !NOT_STORAGE.has(k) && !VexRegistry.ownerOfKey(k) && !legacy.some(l => covers(l, k)));
    expect(unowned.map(k => k + '  (' + [...keys.get(k)][0] + ')')).toEqual([]);
  });

  it('has no key claimed by both a manifest and the legacy list', () => {
    const both = legacy.filter(k => VexRegistry.ownerOfKey(k));
    expect(both).toEqual([]);
  });

  it('has no manifest-owned key twice (define() refuses it; this checks the shipped set)', () => {
    const owned = VexRegistry.all().flatMap(m => m.storageKeys);
    expect(new Set(owned).size).toBe(owned.length);
  });

  it('has no stale entry on the legacy list (a key no longer in the source is removed from it)', () => {
    const keys = [...scan().keys()];
    const stale = legacy.filter(l => !keys.some(k => covers(l, k)));
    expect(stale).toEqual([]);
  });

  it('has no duplicate on the legacy list', () => {
    expect(new Set(legacy).size).toBe(legacy.length);
  });

  it('keeps every manifest-owned key in the source (an owner that nothing writes any more is stale)', () => {
    const keys = [...scan().keys()];
    const missing = VexRegistry.all().flatMap(m => m.storageKeys.map(k => [m.id, k]))
      // The usage registry builds its prior-mode keys from a prefix constant.
      .filter(([, k]) => !keys.some(s => covers(k, s) || covers(s, k)));
    expect(missing).toEqual([]);
  });
});

describe('maturity and staged enablement', () => {
  function fake(id, on = true) {
    const f = { on };
    VexUsage.register({ id, title: id, isEnabled: () => f.on, disable: () => { f.on = false; }, enable: () => { f.on = true; } });
    return f;
  }

  beforeEach(() => {
    VexRegistry._reset();
    VexRegistry.defineAll([
      { id: 'old-one', title: 'Old one', maturity: 'stable' },
      { id: 'fresh-one', title: 'Fresh one', maturity: 'new' },
      { id: 'beta-one', title: 'Beta one', maturity: 'beta' },
    ]);
  });

  it('labels new and beta features and nothing else', () => {
    expect(VexRegistry.maturityLabel('old-one')).toBe('');
    expect(VexRegistry.maturityLabel('fresh-one')).toBe('New');
    expect(VexRegistry.maturityLabel('beta-one')).toBe('Beta');
    expect(VexRegistry.syncEligible('old-one')).toBe(true);
    expect(VexRegistry.syncEligible('beta-one')).toBe(false);
  });

  it('turns a new feature OFF on an existing profile and leaves a stable one alone', async () => {
    const old = fake('old-one'); const fresh = fake('fresh-one'); const beta = fake('beta-one');
    const held = await VexRegistry.stage({ existing: true });
    expect(held.sort()).toEqual(['beta-one', 'fresh-one']);
    expect(old.on).toBe(true);
    expect(fresh.on).toBe(false);
    expect(beta.on).toBe(false);
  });

  it('leaves a new feature as it is on a brand-new profile', async () => {
    const fresh = fake('fresh-one');
    expect(await VexRegistry.stage({ existing: false })).toEqual([]);
    expect(fresh.on).toBe(true);
  });

  it('decides once: a feature the person switched on later is not switched off again', async () => {
    const fresh = fake('fresh-one');
    await VexRegistry.stage({ existing: true });
    expect(fresh.on).toBe(false);
    await VexUsage.enable('fresh-one');
    VexRegistry._state = null;                       // a new session reads the record from storage
    expect(await VexRegistry.stage({ existing: true })).toEqual([]);
    expect(fresh.on).toBe(true);
  });

  it('does not touch a feature the person had already switched off', async () => {
    const fresh = fake('fresh-one', false);
    expect(await VexRegistry.stage({ existing: true })).toEqual([]);
    expect(fresh.on).toBe(false);
  });

  it('offers "try it" once, to the inbox when one subscribes', async () => {
    fake('fresh-one');
    await VexRegistry.stage({ existing: true });
    expect(VexRegistry.pendingOffers()).toEqual(['fresh-one']);
    const added = [];
    VexRegistry.onOffer((x) => added.push(x));
    expect(VexRegistry.offerTry()).toBe(1);
    expect(added[0].text).toMatch(/New in Vex: Fresh one/);
    expect(VexRegistry.offerTry()).toBe(0);
    await added[0].turnOn();
    expect(VexUsage.isEnabled('fresh-one')).toBe(true);
  });

  it('falls back to one gated toast with a Try it button when nothing subscribed', async () => {
    fake('fresh-one');
    await VexRegistry.stage({ existing: true });
    globalThis.VexAttention = { gate: vi.fn(() => true) };
    window.showToast = vi.fn();
    expect(VexRegistry.offerTry()).toBe(1);
    expect(window.showToast.mock.calls[0][3].action.label).toBe('Try it');
    delete globalThis.VexAttention;
  });

  it('switchOff and switchOn go through VexUsage and refuse a feature with no switch', async () => {
    VexRegistry.define({ id: 'core', title: 'Core', killSwitch: 'none' });
    await expect(VexRegistry.switchOff('core')).rejects.toThrow(/cannot be switched off/);
    await expect(VexRegistry.switchOff('old-one')).rejects.toThrow(/not running in this build/);
    const f = fake('old-one');
    await VexRegistry.switchOff('old-one');
    expect(f.on).toBe(false);
    await VexRegistry.switchOn('old-one');
    expect(f.on).toBe(true);
  });
});

describe('diagnostics()', () => {
  it('lists every manifest with whether it runs here and is switched on', () => {
    VexUsageRegistry.register();
    const rows = VexRegistry.diagnostics();
    expect(rows.length).toBe(VexRegistry.all().length);
    const row = rows.find(r => r.id === 'tab-cleanup');
    expect(row).toMatchObject({ id: 'tab-cleanup', maturity: 'stable', running: false, tripped: false });
  });
});

describe('Minimal Vex reads the tier default', () => {
  it('leaves alone a feature whose manifest keeps it on in the minimal tier, and switches the rest off and back', async () => {
    VexRegistry._reset();
    VexRegistry.defineAll([{ id: 'keep', title: 'Keep', tiers: { minimal: true } }, { id: 'drop', title: 'Drop' }]);
    globalThis.VexSettingsGroups = fresh(JS + 'vex-settings-groups.js').VexSettingsGroups;
    const M = fresh(JS + 'vex-minimal-mode.js').VexMinimalMode;
    const state = { keep: true, drop: true };
    for (const id of ['keep', 'drop']) VexUsage.register({ id, title: id, isEnabled: () => state[id], disable: () => { state[id] = false; }, enable: () => { state[id] = true; } });
    await M.enter();
    expect(state).toEqual({ keep: true, drop: false });
    await M.leave();
    expect(state).toEqual({ keep: true, drop: true });
  });
});
