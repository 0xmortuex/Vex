// @vitest-environment jsdom
//
// The stuck feature-offer path (F1): which crash-log entries hold an offer back, the order offers are made in, and the one
// "Turn on the packs for how you use Vex" screen (js/feature-packs.js). The crash fixtures are the kinds of entries the real
// crash log holds (main.js writes them): a website's "page hung", an extension's background page, Vex's own window.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs');

const JS = '../../src/renderer/js/';
const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000;
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };   // the module's own load-time start() finishes before the test's Inbox exists

const load = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
function fresh() {
  vi.resetModules();
  localStorage.clear();
  delete window.__vexUsageQueue;
  globalThis.VexRegistry = load(JS + 'feature-registry.js').VexRegistry;
  globalThis.VexUsage = load(JS + 'vex-usage.js').VexUsage;
  VexRegistry._reset();
}

const on = {};
function manifest(id, extra = {}) {
  VexRegistry.define({ id, title: id, maturity: 'new', ...extra });
  on[id] = true;
  VexUsage.register({ id, title: id, isEnabled: () => on[id], disable: () => { on[id] = false; }, enable: () => { on[id] = true; } });
}

beforeEach(() => { fresh(); for (const k of Object.keys(on)) delete on[k]; });

// ---------------------------------------------------------------------------------------------------------------------
describe('which crash-log entries count against Vex', () => {
  // [description, entry, counts?]. Entries are what main.js / main/*.js write: kind + detail (+ scope since 2026-11).
  const table = [
    ['a website hung (old entry, an origin)', { kind: 'page hung', detail: 'https://discord.com' }, false],
    ['a website crashed (old entry, an origin)', { kind: 'page crashed', detail: 'https://www.youtube.com — oom (exit 5)' }, false],
    ['an extension background page crashed (old entry)', { kind: 'page crashed', detail: 'backgroundPage — crashed (exit 1)' }, false],
    ['an extension background page hung (old entry)', { kind: 'page hung', detail: 'backgroundPage' }, false],
    ['a chrome-extension page (old entry)', { kind: 'page hung', detail: 'chrome-extension://abcdef' }, false],
    ['a private page (old entry)', { kind: 'page crashed', detail: 'a private page — killed (exit 9)' }, false],
    ['a guest page with no address (old entry)', { kind: 'page hung', detail: 'webview' }, false],
    ['a Vex page (old entry)', { kind: 'page crashed', detail: 'a Vex page — crashed (exit -1073741819)' }, true],
    ['Vex window with no address (old entry)', { kind: 'page hung', detail: 'window' }, true],
    ['Vex did not finish starting', { kind: 'Vex did not finish starting', detail: '3 launches in a row' }, true],
    ['Vex window stopped responding', { kind: 'Vex window stopped responding', detail: '2 pages' }, true],
    ['Vex window recovered', { kind: 'Vex window recovered', detail: 'reloaded after a crash' }, true],
    ['main process stalled', { kind: 'Main process stalled', detail: '4000 ms' }, true],
    ['a helper process (GPU) went away', { kind: 'helper process gone', detail: 'GPU — crashed (exit 1)' }, true],
    ['a helper process (video capture) went away', { kind: 'helper process gone', detail: 'Utility Video Capture — crashed (exit 1)' }, true],
    ['scope vex wins over the detail', { kind: 'page hung', detail: 'https://x.example', scope: 'vex' }, true],
    ['scope site wins over the detail', { kind: 'page crashed', detail: 'a Vex page', scope: 'site' }, false],
    ['scope extension', { kind: 'page crashed', detail: 'x', scope: 'extension' }, false],
    ['a page entry with no detail is kept as a crash (cannot tell, keep waiting)', { kind: 'page crashed', detail: '' }, true],
    ['a kind nobody knows is kept as a crash (cannot tell, keep waiting)', { kind: 'something new', detail: '' }, true],
    ['not an object', null, false],
    ['a number', 5, false],
  ];
  it.each(table)('%s', (_name, entry, want) => { expect(VexRegistry.countsAsVexCrash(entry)).toBe(want); });

  it('the owner\'s crash log (third-party hangs and an extension page) no longer holds an offer back; a real Vex crash still does', async () => {
    manifest('f1');
    await VexRegistry.stage({ existing: true, now: NOW - 10 * DAY });
    const later = NOW;
    const noise = [
      { at: NOW - 5 * DAY, kind: 'page hung', detail: 'https://discord.com' },
      { at: NOW - 3 * DAY, kind: 'page crashed', detail: 'backgroundPage — crashed (exit 1)' },
    ];
    expect(VexRegistry.safeWindowOffers(noise, later)).toEqual(['f1']);
    expect(VexRegistry.safeWindowOffers([...noise, { at: NOW - 2 * DAY, kind: 'helper process gone', detail: 'GPU — crashed (exit 1)' }], later)).toEqual([]);
    expect(VexRegistry.safeWindowOffers([{ at: NOW - 1 * DAY, kind: 'Vex window stopped responding', detail: '' }], later)).toEqual([]);
  });

  it('a crash from before the feature was staged never mattered', async () => {
    manifest('f1');
    await VexRegistry.stage({ existing: true, now: NOW - 10 * DAY });
    expect(VexRegistry.safeWindowOffers([{ at: NOW - 20 * DAY, kind: 'helper process gone', detail: 'GPU' }], NOW)).toEqual(['f1']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the order offers are made in', () => {
  it('puts the features whose commands the person uses first, then the same Settings group, then staging order', async () => {
    manifest('alpha', { group: 'G1', commands: ['a-cmd'] });
    manifest('beta', { group: 'G2', commands: ['b-cmd'] });
    manifest('gamma', { group: 'G1', commands: ['g-cmd'] });      // same group as alpha, whose command is used
    manifest('delta', { group: 'G3', commands: ['d-cmd'] });
    manifest('omega', { group: 'G4', commands: ['o-cmd'] });
    const usage = { 'b-cmd': { n: 40 }, 'a-cmd': { n: 3 } };
    // beta (40) > alpha (3) > gamma (same group as alpha) > the unused ones in staging order
    expect(VexRegistry.rankOffers(['alpha', 'beta', 'gamma', 'delta', 'omega'], usage)).toEqual(['beta', 'alpha', 'gamma', 'delta', 'omega']);
    expect(VexRegistry.rankOffers(['delta', 'omega', 'gamma', 'alpha', 'beta'], {})).toEqual(['delta', 'omega', 'gamma', 'alpha', 'beta']);   // no use at all: exactly the staging order
  });

  it('pendingOffers and offerTry use it, read vex.commandUsage, and do not raise the weekly limit', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) manifest(id, { group: 'g-' + id, commands: [id + '-cmd'] });
    await VexRegistry.stage({ existing: true });
    localStorage.setItem('vex.commandUsage', JSON.stringify({ 'd-cmd': { n: 9 }, 'b-cmd': { n: 2 } }));
    expect(VexRegistry.pendingOffers()).toEqual(['d', 'b', 'a', 'c', 'e']);
    const seen = [];
    VexRegistry.onOffer((x) => seen.push(x.id));
    expect(VexRegistry.OFFERS_PER_WEEK).toBe(3);
    VexRegistry.offerTry();
    expect(seen).toEqual(['d', 'b', 'a']);              // three, the person's own first
  });

  it('an unreadable usage record keeps the staging order and is reported, not hidden', async () => {
    for (const id of ['a', 'b']) manifest(id, { commands: [id + '-cmd'] });
    await VexRegistry.stage({ existing: true });
    localStorage.setItem('vex.commandUsage', '{not json');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(VexRegistry.pendingOffers()).toEqual(['a', 'b']);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the pack screen', () => {
  let inbox;
  async function setup(ids = ['mun-toolkit', 'speech-timer', 'exam-planner', 'game-overlay', 'game-timers', 'ci-fix-loop', 'log-reader', 'sticky-thing']) {
    const feats = {
      'mun-toolkit': { group: 'Study helpers', title: 'MUN toolkit' },
      'speech-timer': { group: 'Study helpers', title: 'Speech timer and speakers list' },
      'exam-planner': { group: 'Exams', title: 'Exam planner' },
      'game-overlay': { group: 'Game overlay', title: 'Game overlay' },
      'game-timers': { group: 'Games and media', title: 'Game timers' },
      'ci-fix-loop': { group: 'Developer loop', title: 'CI fix loop' },
      'log-reader': { group: 'Developer desk', title: 'Log reader' },
      'sticky-thing': { group: 'Misc', title: 'Something unrelated' },
    };
    for (const id of ids) manifest(id, feats[id]);
    await VexRegistry.stage({ existing: true });
    globalThis.VexFeatures = { ITEMS: [{ id: 'exam-planner', feature: 'exam-planner', cat: 'work', name: 'Exam planner', what: 'Plan the weeks before each exam.' }, { id: 'ci-fix-loop', feature: 'ci-fix-loop', cat: 'dev', name: 'CI fix loop', what: 'Read a failed build and plan the fix.' }], nameOf: (e) => e.name };
    delete globalThis.AttentionInbox;                 // loading the module offers once when an Inbox exists; these tests call it themselves
    window.showToast = vi.fn();
    document.body.innerHTML = '';
    globalThis.VexFeaturePacks = window.VexFeaturePacks = load(JS + 'feature-packs.js').VexFeaturePacks;
    await settle();
    inbox = { rows: [], handlers: {}, add: vi.fn((r) => { inbox.rows.push(r); return true; }), handle: vi.fn((f, fn) => { inbox.handlers[f] = fn; }) };
    globalThis.AttentionInbox = inbox;
    return VexFeaturePacks;
  }

  it('sorts the waiting features into the four packs, each once, and leaves the rest out', async () => {
    const P = await setup();
    const packs = P.packs();
    expect(packs.map(p => p.id)).toEqual(['mun', 'study', 'gaming', 'developer']);
    const ids = (id) => packs.find(p => p.id === id).features.map(f => f.id).sort();
    expect(ids('mun')).toEqual(['mun-toolkit', 'speech-timer']);
    expect(ids('study')).toEqual(['exam-planner']);
    expect(ids('gaming')).toEqual(['game-overlay', 'game-timers']);
    expect(ids('developer')).toEqual(['ci-fix-loop', 'log-reader']);
    expect(packs.flatMap(p => p.features).some(f => f.id === 'sticky-thing')).toBe(false);
    const all = packs.flatMap(p => p.features.map(f => f.id));
    expect(new Set(all).size).toBe(all.length);                     // never listed twice
  });

  it('pack rules are a pure table: first pack in RULE_ORDER wins', () => {
    const P = require(JS + 'feature-packs.js').VexFeaturePacks;
    const m = (id, group = '', title = id) => ({ id, group, title });
    expect(P.packOf(null, m('x', 'Study helpers', 'MUN toolkit'))).toBe('mun');
    expect(P.packOf({ cat: 'dev', name: 'Game server tool' }, m('x'))).toBe('developer');       // developer before gaming
    expect(P.packOf(null, m('game-anything'))).toBe('gaming');
    expect(P.packOf(null, m('x', 'Exams'))).toBe('study');
    expect(P.packOf({ cat: 'tabs', name: 'Tab thing' }, m('x', 'Tab tools'))).toBe(null);
  });

  it('lists a feature that is already on, or is not running in this build, nowhere', async () => {
    const P = await setup();
    await VexUsage.enable('exam-planner');
    expect(P.packs().find(p => p.id === 'study')).toBeUndefined();
  });

  it('opening it turns NOTHING on, and shows each feature with a tick box and its sentence, all unticked', async () => {
    const P = await setup();
    P.open();
    const boxes = [...document.querySelectorAll('input[data-feature]')];
    expect(boxes.length).toBe(7);
    expect(boxes.every(b => !b.checked)).toBe(true);
    expect(document.body.textContent).toContain('Plan the weeks before each exam.');
    expect(document.querySelector('[data-pack="mun"]')).not.toBeNull();
    const applyBtn = [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Apply'));
    expect(applyBtn.disabled).toBe(true);
    for (const id of Object.keys(on)) expect(on[id]).toBe(false);          // every staged feature is still off
    expect(localStorage.getItem('vex.featurePacks')).toBeNull();   // opening it records nothing
  });

  it('a pack\'s box ticks all its features, each can be unticked, and Apply turns on exactly the ticked ones', async () => {
    const P = await setup();
    P.open();
    document.querySelector('input[data-pack-all="gaming"]').click();
    const gameBoxes = [...document.querySelectorAll('[data-pack="gaming"] input[data-feature]')];
    expect(gameBoxes.every(b => b.checked)).toBe(true);
    gameBoxes.find(b => b.dataset.feature === 'game-timers').click();           // untick one
    const applyBtn = [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Apply'));
    expect(applyBtn.textContent).toBe('Apply (1)');
    expect(on['game-overlay']).toBe(false);                                      // ticking is not applying
    applyBtn.click();
    await vi.waitFor(() => expect(on['game-overlay']).toBe(true));
    expect(on['game-timers']).toBe(false);
    expect(on['mun-toolkit']).toBe(false);
    await vi.waitFor(() => expect(document.querySelector('.vex-packs-overlay')).toBeNull());
    expect(JSON.parse(localStorage.getItem('vex.featurePacks')).lastApply.ids).toEqual(['game-overlay']);
  });

  it('apply() refuses an empty list and a feature that is not waiting, and changes nothing', async () => {
    const P = await setup();
    await expect(P.apply([])).rejects.toThrow(/at least one/);
    await expect(P.apply(['sticky-thing-that-does-not-exist'])).rejects.toThrow(/not waiting/);
    await VexUsage.enable('exam-planner');
    await expect(P.apply(['exam-planner', 'game-overlay'])).rejects.toThrow(/not waiting/);
    expect(on['game-overlay']).toBe(false);
  });

  it('apply() refuses while Minimal Vex is on', async () => {
    const P = await setup();
    globalThis.VexMinimalMode = { isOn: () => true };
    await expect(P.apply(['exam-planner'])).rejects.toThrow(/Minimal Vex is on/);
    expect(on['exam-planner']).toBe(false);
    delete globalThis.VexMinimalMode;
  });

  it('a feature that will not switch on is reported and left off; the others still turn on', async () => {
    const P = await setup();
    const u = VexUsage.get('game-overlay');
    u.enable = () => { throw new Error('boom'); };
    const r = await P.apply(['game-overlay', 'game-timers']);
    expect(r.on).toEqual(['game-timers']);
    expect(r.failed).toEqual([{ id: 'game-overlay', error: 'boom' }]);
    expect(on['game-overlay']).toBe(false);
  });

  it('"Turn these back off" undoes the last Apply and only what it turned on', async () => {
    const P = await setup();
    await VexUsage.enable('log-reader');                                 // the person turned this on by hand earlier
    await P.apply(['exam-planner', 'game-overlay']);
    expect(P.canUndo()).toBe(true);
    P.open();
    const undoBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Turn these back off');
    expect(undoBtn.hidden).toBe(false);
    undoBtn.click();
    await vi.waitFor(() => expect(P.canUndo()).toBe(false));
    expect(on['exam-planner']).toBe(false);
    expect(on['game-overlay']).toBe(false);
    expect(on['log-reader']).toBe(true);                                 // not part of the Apply: untouched
  });

  it('undo keeps a feature that would not switch off on the note, so the button is still there for it', async () => {
    const P = await setup();
    await P.apply(['exam-planner', 'game-overlay']);
    VexUsage.get('exam-planner').disable = () => { throw new Error('stuck'); };
    const r = await P.undo();
    expect(r.off).toEqual(['game-overlay']);
    expect(r.failed[0].id).toBe('exam-planner');
    expect(P.canUndo()).toBe(true);
  });

  it('a feature turned on here is marked tried, so no "try it" nudge follows', async () => {
    const P = await setup();
    await P.apply(['exam-planner']);
    expect(VexRegistry.pendingOffers()).not.toContain('exam-planner');
  });

  it('Escape closes it without changing anything', async () => {
    const P = await setup();
    P.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vex-packs-overlay')).toBeNull();
    expect(Object.values(on).every(v => v === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('offered once, through the Attention Inbox, never again once dismissed', () => {
  let inbox;
  async function setup({ existing = true, count = 6 } = {}) {
    for (let i = 0; i < count; i++) manifest('exam-x' + i, { group: 'Exams', title: 'Exam thing ' + i });
    await VexRegistry.stage({ existing });
    globalThis.VexFeatures = { ITEMS: [], nameOf: (e) => e.name };
    delete globalThis.AttentionInbox;
    window.showToast = vi.fn();
    document.body.innerHTML = '';
    const P = load(JS + 'feature-packs.js').VexFeaturePacks;
    await settle();
    inbox = { rows: [], handlers: {}, add: vi.fn((r) => { inbox.rows.push(r); return true; }), handle: vi.fn((f, fn) => { inbox.handlers[f] = fn; }) };
    globalThis.AttentionInbox = inbox;
    return P;
  }

  it('adds one Inbox row when enough features are waiting, never a toast or a modal', async () => {
    const P = await setup();
    expect(P.maybeOffer()).toBe(true);
    expect(inbox.rows).toHaveLength(1);
    expect(inbox.rows[0]).toMatchObject({ feature: 'feature-packs', action: { key: 'open' } });
    expect(inbox.rows[0].title).toBe('Turn on the packs for how you use Vex');
    expect(window.showToast).not.toHaveBeenCalled();
    expect(document.querySelector('.vex-packs-overlay')).toBeNull();
  });

  it('offers once: not again on the next start, even if the row is ignored', async () => {
    const P = await setup();
    P.maybeOffer();
    expect(P.maybeOffer()).toBe(false);
    expect(inbox.rows).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('vex.featurePacks')).offeredAt).toBeGreaterThan(0);
  });

  it('"Not now" is remembered: never offered again, but still opens from Ctrl+K / Settings', async () => {
    const P = await setup();
    P.open();
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Not now').click();
    expect(document.querySelector('.vex-packs-overlay')).toBeNull();
    expect(JSON.parse(localStorage.getItem('vex.featurePacks')).dismissedAt).toBeGreaterThan(0);
    expect(P.maybeOffer()).toBe(false);
    expect(inbox.rows).toHaveLength(0);
    P.open();                                                         // the person asks for it
    expect(document.querySelector('.vex-packs-overlay')).not.toBeNull();
    expect(document.body.textContent).toContain('Not now');
  });

  it('is not offered on a new profile, nor when fewer than five features are waiting', async () => {
    let P = await setup({ existing: false });
    expect(P.maybeOffer()).toBe(false);
    fresh(); for (const k of Object.keys(on)) delete on[k];
    P = await setup({ count: 4 });
    expect(P.maybeOffer()).toBe(false);
    expect(inbox.rows).toHaveLength(0);
  });

  it('a switched-off Inbox leaves the offer for a later start instead of using it up', async () => {
    const P = await setup();
    inbox.add = vi.fn(() => false);
    expect(P.maybeOffer()).toBe(false);
    expect(localStorage.getItem('vex.featurePacks')).toBeNull();
  });

  it('the Inbox row\'s button opens the screen', async () => {
    const P = await setup();
    await P.start();
    expect(inbox.rows).toHaveLength(1);                               // start() offers too, once
    inbox.handlers['feature-packs']('open');
    expect(document.querySelector('.vex-packs-overlay')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('registration', () => {
  const read = (f) => fs.readFileSync(f, 'utf8');
  it('is a late module (no index.html tag), has a Ctrl+K command, a catalogue entry, details, a manifest and Turkish', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toMatch(/js\/feature-packs\.js/);
    expect(read('src/renderer/index.html')).not.toMatch(/feature-packs\.js/);
    expect(read('src/renderer/js/command.js')).toMatch(/\{ id: 'feature-packs', label: 'Choose Feature Packs'/);
    expect(read('src/renderer/js/feature-catalog.js')).toMatch(/\{ id: 'feature-packs', feature: 'feature-packs'/);
    expect(read('src/renderer/js/feature-details.js')).toMatch(/'feature-packs': '/);
    expect(read('src/renderer/js/feature-manifests.js')).toMatch(/id: 'feature-packs'[^\n]*storageKeys: \['vex\.featurePacks'\]/);
    expect(read('src/renderer/js/i18n-ui.js')).toMatch(/'Turn on the packs for how you use Vex': /);
    expect(read('src/renderer/js/app.js')).toMatch(/VexFeaturePacks\.maybeOffer\(\)/);
    expect(read('src/renderer/js/vex-minimal-mode.js')).toMatch(/Choose feature packs/);
  });
  it('the main process writes the scope of a page crash or hang beside the entry', () => {
    const m = read('src/main.js');
    expect(m).toMatch(/_diagEvent\('page crashed', `\$\{where\(\)\} — \$\{d\.reason\} \(exit \$\{d\.exitCode\}\)`, crashScope\(\)\)/);
    expect(m).toMatch(/_diagEvent\('page hung', where\(\), crashScope\(\)\)/);
    expect(m).toMatch(/_crashLog\.add\(kind, detail, scope\)/);
  });
});
