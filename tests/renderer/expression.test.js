// @vitest-environment jsdom
//
// Fun and expression: unlock rules, profile frames/banners/backgrounds,
// titles, the jingle composer, the fortune of the day, Read Later roulette,
// the speed-run stopwatch and the keyboard trainer.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const js = (n) => path.resolve(__dirname, '../../src/renderer/js/' + n);
const { VexUnlock } = require(js('vex-unlock.js'));
const { VexExpression } = require(js('vex-expression.js'));
const { VexCosmetics } = require(js('vex-cosmetics.js'));
const { VexTitles } = require(js('vex-titles.js'));
const { VexJingle } = require(js('vex-jingle.js'));
const { VexFortune } = require(js('vex-fortune.js'));
const { VexRoulette } = require(js('tab-roulette.js'));
const { VexSpeedRun } = require(js('speed-run.js'));
const { VexKeyTrainer } = require(js('key-trainer.js'));
const ShortcutsRegistry = require(js('shortcuts-registry.js'));

function fakeMedals(has = [], level = 1, defined = []) {
  return {
    has: (id) => has.includes(id),
    levelInfo: () => ({ level }),
    get: (id) => (defined.includes(id) ? { id, title: 'Title of ' + id } : null),
    list: () => defined.map(id => ({ id })),
  };
}

beforeEach(() => {
  localStorage.clear();
  delete globalThis.VexMedals;
  delete globalThis.GameMode;
  delete globalThis.GameSession;
  document.body.innerHTML = '';
  globalThis.ShortcutsRegistry = ShortcutsRegistry;
});
afterEach(() => { delete globalThis.AudioContext; delete globalThis.ReadLater; });

describe('unlock rules', () => {
  it('free, medal, level and any', () => {
    globalThis.VexMedals = fakeMedals(['a'], 3);
    expect(VexUnlock.check({ free: true })).toBe(true);
    expect(VexUnlock.check({ medal: 'a' })).toBe(true);
    expect(VexUnlock.check({ medal: 'b' })).toBe(false);
    expect(VexUnlock.check({ level: 3 })).toBe(true);
    expect(VexUnlock.check({ level: 4 })).toBe(false);
    expect(VexUnlock.check({ any: [{ medal: 'b' }, { level: 2 }] })).toBe(true);
  });

  it('refuses a rule it does not know instead of guessing', () => {
    expect(() => VexUnlock.check({ nonsense: 1 })).toThrow(/Unknown unlock rule/);
    expect(() => VexUnlock.check(null)).toThrow();
  });

  it('works from the medal-awarded event when VexMedals is not loaded', () => {
    expect(VexUnlock.hasMedal('tab-whisperer')).toBe(false);
    document.dispatchEvent(new CustomEvent('vex:medal-awarded', { detail: { id: 'tab-whisperer' } }));
    expect(VexUnlock.hasMedal('tab-whisperer')).toBe(true);
  });

  it('keeps what was unlocked even if the medal later disappears', () => {
    globalThis.VexMedals = fakeMedals(['a']);
    const items = [{ id: 'x', unlock: { medal: 'a' } }, { id: 'y', unlock: { medal: 'zz' } }];
    expect(VexUnlock.settle('t', items)).toEqual(['x']);
    globalThis.VexMedals = fakeMedals([]);
    expect(VexUnlock.settle('t', items)).toEqual(['x']);
  });

  it('names the medal ids a catalog needs and reports undefined ones', () => {
    const rules = [{ medal: 'a' }, { any: [{ medal: 'b' }, { level: 2 }] }, { free: true }];
    expect(VexUnlock.referenced(rules).sort()).toEqual(['a', 'b']);
    globalThis.VexMedals = fakeMedals([], 1, ['a']);
    expect(VexUnlock.unknownMedals(rules)).toEqual(['b']);
  });

  it('says how to get something in plain words, with no pressure', () => {
    globalThis.VexMedals = fakeMedals([], 1, ['a']);
    expect(VexUnlock.describe({ medal: 'a' })).toBe('Comes with the medal Title of a');
    expect(VexUnlock.describe({ level: 5 })).toBe('Comes with level 5');
  });
});

describe('cosmetics', () => {
  it('ships at least 12 SVG items in all three kinds, free ones included', () => {
    expect(VexCosmetics.CATALOG.length).toBeGreaterThanOrEqual(12);
    for (const k of VexCosmetics.KINDS) {
      const items = VexCosmetics.CATALOG.filter(c => c.kind === k);
      expect(items.length).toBeGreaterThanOrEqual(4);
      expect(items.some(i => i.unlock.free)).toBe(true);
    }
    expect(new Set(VexCosmetics.CATALOG.map(c => c.kind + ':' + c.id)).size).toBe(VexCosmetics.CATALOG.length);
  });

  it('draws every item as a plain svg with a name and no emoji', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const c of VexCosmetics.CATALOG) {
      const svg = VexCosmetics.svg(c.kind, c.id);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('aria-label=');
      expect(svg).not.toMatch(emoji);
      expect(svg).not.toMatch(/<script|<image|href=/i);
    }
  });

  it('only equips what is owned and tells why not', () => {
    globalThis.VexMedals = fakeMedals([], 1);
    expect(VexCosmetics.owned('frame')).toEqual(['ring-plain']);
    expect(() => VexCosmetics.equip('frame', 'ring-laurel')).toThrow(/not unlocked/);
    expect(() => VexCosmetics.equip('frame', 'nope')).toThrow(/No frame/);
    expect(VexCosmetics.list('frame').find(f => f.id === 'ring-laurel').how).toMatch(/medal/);
    globalThis.VexMedals = fakeMedals(['first-focus'], 1);
    const seen = [];
    document.addEventListener('vex:cosmetics-changed', e => seen.push(e.detail));
    expect(VexCosmetics.equip('frame', 'ring-laurel')).toBe(true);
    expect(VexCosmetics.equipped().frame).toBe('ring-laurel');
    expect(seen).toEqual([{ kind: 'frame', id: 'ring-laurel' }]);
    VexCosmetics.equip('frame', null);
    expect(VexCosmetics.equipped().frame).toBe(null);
  });

  it('nothing is equipped by default, and the avatar comes back unframed', () => {
    expect(VexCosmetics.equipped()).toEqual({ frame: null, banner: null, background: null });
    expect(VexCosmetics.renderAvatar('<svg id="a"></svg>')).toBe('<svg id="a"></svg>');
    VexCosmetics.equip('frame', 'ring-plain');
    expect(VexCosmetics.renderAvatar('<svg id="a"></svg>')).toContain('vex-frame');
  });

  it('does not unequip an item when the medal catalog changes', () => {
    globalThis.VexMedals = fakeMedals(['first-focus']);
    VexCosmetics.equip('frame', 'ring-laurel');
    globalThis.VexMedals = fakeMedals([]);
    expect(VexCosmetics.equipped().frame).toBe('ring-laurel');
  });

  it('refuses unreadable saved state with a message', () => {
    localStorage.setItem('vex.cosmetics', '{not json');
    expect(() => VexCosmetics.equipped()).toThrow(/Could not read/);
  });
});

describe('titles', () => {
  it('has at least 20, each with a rule, unique ids', () => {
    expect(VexTitles.CATALOG.length).toBeGreaterThanOrEqual(20);
    expect(new Set(VexTitles.CATALOG.map(t => t.id)).size).toBe(VexTitles.CATALOG.length);
    expect(VexTitles.CATALOG.filter(t => t.unlock.medal).length).toBeGreaterThanOrEqual(15);
    for (const t of VexTitles.CATALOG) expect(() => VexUnlock.check(t.unlock)).not.toThrow();
  });

  it('is earned by a medal and equipped under the name', () => {
    expect(VexTitles.line()).toBe('');
    expect(() => VexTitles.equip('night-owl')).toThrow(/not unlocked/);
    globalThis.VexMedals = fakeMedals(['night-owl']);
    VexTitles.equip('night-owl');
    expect(VexTitles.current()).toEqual({ id: 'night-owl', name: 'Night Owl' });
    expect(VexTitles.line()).toBe('Night Owl');
    VexTitles.equip(null);
    expect(VexTitles.current()).toBe(null);
  });

  it('shares the medal ids with the cosmetics list for the medals work', () => {
    const ids = [...VexTitles.referencedMedals(), ...VexCosmetics.referencedMedals()];
    expect(ids).toContain('tab-whisperer');
    expect(ids).toContain('inbox-zero');
    expect(ids).toContain('night-owl');
  });
});

describe('jingle', () => {
  it('is off by default at both moments', () => {
    const s = VexJingle.get();
    expect(s.startup.on).toBe(false);
    expect(s.finish.on).toBe(false);
    expect(VexJingle.playSlot('startup')).toBe(false);
    expect(VexJingle.playSlot('finish')).toBe(false);
  });

  it('validates what it is given', () => {
    expect(() => VexJingle.set({ volume: 101 })).toThrow(/0 to 100/);
    expect(() => VexJingle.set({ startup: { notes: [] } })).toThrow(/1 to 8/);
    expect(() => VexJingle.set({ startup: { notes: [null, null] } })).toThrow(/only rests/);
    expect(() => VexJingle.set({ startup: { notes: [99] } })).toThrow(/0 to 14/);
    expect(() => VexJingle.set({ startup: { instrument: 'kazoo' } })).toThrow(/Unknown instrument/);
    expect(() => VexJingle.set({ finish: { on: 'yes' } })).toThrow();
    expect(VexJingle.get().volume).toBe(40);
  });

  it('turns notes into timed frequencies, rests staying silent', () => {
    const ev = VexJingle.events({ instrument: 'bell', notes: [0, null, 5] });
    expect(ev.length).toBe(2);
    expect(ev[0].at).toBe(0);
    expect(ev[0].freq).toBeCloseTo(261.63, 1);
    expect(ev[1].at).toBeCloseTo(0.4, 5);
    expect(ev[1].freq).toBeCloseTo(523.25, 1);   // degree 5 = one octave up
    expect(VexJingle.INSTRUMENTS.length).toBeGreaterThanOrEqual(4);
  });

  function fakeAudio() {
    const made = { osc: 0 };
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
    class AC {
      constructor() { this.currentTime = 0; this.destination = {}; this.state = 'running'; }
      createGain() { return { gain: param(), connect() {} }; }
      createOscillator() { made.osc++; return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
      createBiquadFilter() { return { type: '', frequency: { value: 0 }, connect() {} }; }
    }
    globalThis.AudioContext = AC;
    VexJingle._ctx = null;
    return made;
  }

  it('plays only a switched-on slot, at the chosen volume, and not during a game', () => {
    const made = fakeAudio();
    VexJingle.set({ finish: { on: true } });
    expect(VexJingle.playSlot('finish')).toBe(true);
    expect(made.osc).toBeGreaterThan(0);
    const before = made.osc;
    globalThis.GameSession = { active: true };
    expect(VexJingle.playSlot('finish')).toBe(false);
    expect(made.osc).toBe(before);
    delete globalThis.GameSession;
    VexJingle.set({ volume: 0 });
    expect(VexJingle.playSlot('finish')).toBe(false);
  });

  it('previews even while off, and says so when there is no audio', () => {
    const made = fakeAudio();
    expect(VexJingle.preview('startup')).toBeGreaterThan(0);
    expect(made.osc).toBeGreaterThan(0);
    delete globalThis.AudioContext;
    VexJingle._ctx = null;
    expect(() => VexJingle.preview('startup')).toThrow(/no audio output/);
  });

  it('plays the finish tune on vex:focus-complete once wired', () => {
    fakeAudio();
    VexJingle.set({ finish: { on: true } });
    const spy = vi.spyOn(VexJingle, 'playSlot');
    VexJingle.wire();
    document.dispatchEvent(new CustomEvent('vex:focus-complete', { detail: { minutes: 25 } }));
    expect(spy).toHaveBeenCalledWith('finish');
    spy.mockRestore();
  });

  it('startup does nothing while off', () => {
    VexJingle._started = false;
    expect(VexJingle.startup(0)).toBe(false);
  });
});

describe('fortune of the day', () => {
  it('has 200+ distinct short hand-written lines', () => {
    const L = VexFortune.LINES;
    expect(L.length).toBeGreaterThanOrEqual(200);
    expect(new Set(L.map(l => l.text)).size).toBe(L.length);
    for (const l of L) {
      expect(['t', 'k', 'p']).toContain(l.kind);
      expect(l.text.length).toBeGreaterThan(8);
      expect(l.text.length).toBeLessThanOrEqual(140);
      expect(l.text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });

  it('gives the same line all day and a different one tomorrow', () => {
    const a = new Date(2026, 9, 16, 8, 0), b = new Date(2026, 9, 16, 23, 59), c = new Date(2026, 9, 17, 0, 1);
    expect(VexFortune.today(a).text).toBe(VexFortune.today(b).text);
    expect(VexFortune.today(c).text).not.toBe(VexFortune.today(a).text);
  });

  it('shows every line once before any repeats', () => {
    const n = VexFortune.LINES.length;
    const seen = new Set();
    for (let d = 0; d < n; d++) seen.add(VexFortune.indexFor(new Date(2026, 0, 1 + d), n));
    expect(seen.size).toBe(n);
  });

  it('is off by default, so the brief module answers nothing', () => {
    expect(VexFortune.isEnabled()).toBe(false);
    expect(VexFortune.brief.isEnabled()).toBe(false);
    expect(VexFortune.brief.build()).toBe(null);
  });

  it('builds the brief card when on, and stays silent during a game', () => {
    VexFortune.setEnabled(true);
    const card = VexFortune.brief.build(new Date(2026, 9, 16));
    expect(card.id).toBe('fortune');
    expect(card.lines).toHaveLength(1);
    expect(card.lines[0].text.length).toBeGreaterThan(0);
    globalThis.GameMode = { gaming: true };
    expect(VexFortune.brief.build()).toBe(null);
    expect(typeof VexFortune.brief.title).toBe('string');
  });

  it('has the brief module shape', () => {
    const m = VexFortune.brief;
    expect(typeof m.id).toBe('string');
    expect(typeof m.title).toBe('string');
    expect(typeof m.build).toBe('function');
    expect(typeof m.isEnabled).toBe('function');
  });
});

describe('Read Later roulette', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c', read: true }, { id: 'd' }];

  it('picks only unread items, honouring the random source', () => {
    expect(VexRoulette.pick(items, { rng: () => 0 }).id).toBe('a');
    expect(VexRoulette.pick(items, { rng: () => 0.99 }).id).toBe('d');
    expect(VexRoulette.pick([], {})).toBe(null);
    expect(() => VexRoulette.pick(items, { rng: () => 1 })).toThrow(/0 up to/);
  });

  it('never offers one it was told to skip', () => {
    for (let i = 0; i < 30; i++) expect(VexRoulette.pick(items, { skip: ['a', 'b'] }).id).toBe('d');
    expect(VexRoulette.pick(items, { skip: new Set(['a', 'b', 'd']) })).toBe(null);
  });

  it('"not that one" moves on, and starts over once everything was passed on', () => {
    const s = VexRoulette.session({ candidates: () => items, rng: () => 0 });
    expect(s.next().item.id).toBe('a');
    expect(s.pass().item.id).toBe('b');
    expect(s.pass().item.id).toBe('d');
    const again = s.pass();
    expect(again.wrapped).toBe(true);
    expect(again.item.id).toBe('a');
  });

  it('with an empty queue answers null instead of looping', () => {
    const s = VexRoulette.session({ candidates: () => [], rng: () => 0 });
    expect(s.next().item).toBe(null);
  });

  it('opens the page only when Open it is pressed', () => {
    const open = vi.fn();
    globalThis.ReadLater = { items: [{ id: 'x', url: 'https://example.com/a', title: 'A page', at: Date.now() }], open, describeAge: () => 'today' };
    const dlg = VexRoulette.open();
    expect(open).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('A page');
    dlg.el.querySelector('[data-r-open]').click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.vex-expr-backdrop')).toBe(null);
  });

  it('has a command bar entry', () => {
    expect(VexRoulette.commands[0].id).toBe('roulette');
    expect(typeof VexRoulette.commands[0].action).toBe('function');
  });
});

describe('speed-run', () => {
  it('formats times', () => {
    expect(VexSpeedRun.formatMs(65000)).toBe('1:05');
    expect(VexSpeedRun.formatMs(3723000)).toBe('1:02:03');
    expect(() => VexSpeedRun.formatMs(-1)).toThrow();
  });

  it('keeps only your own best and says whether this was it', () => {
    expect(VexSpeedRun.record('reading', 90000).isBest).toBe(true);
    const slower = VexSpeedRun.record('reading', 120000);
    expect(slower.isBest).toBe(false);
    expect(slower.best).toBe(90000);
    expect(VexSpeedRun.record('reading', 60000)).toMatchObject({ isBest: true, previous: 90000 });
    expect(VexSpeedRun.bests().reading.runs).toBe(3);
    expect(() => VexSpeedRun.record('nope', 1)).toThrow(/Unknown course/);
  });

  it('times a run to the moment the list is empty', async () => {
    let t = 1000;
    let left = 3;
    const course = { id: 'reading', name: 'Queue', what: 'pages', remaining: () => left };
    const run = VexSpeedRun.begin(course, { now: () => t });
    expect(await run.start()).toBe(3);
    t += 20000; left = 1;
    expect(await run.check()).toEqual({ left: 1, done: false });
    t += 25000; left = 0;
    const r = await run.check();
    expect(r.done).toBe(true);
    expect(r.result.ms).toBe(45000);
    expect(r.result.isBest).toBe(true);
    expect(VexSpeedRun.bests().reading.ms).toBe(45000);
  });

  it('stopping records nothing', async () => {
    const course = { id: 'reading', name: 'Queue', what: 'pages', remaining: () => 2 };
    const run = VexSpeedRun.begin(course);
    await run.start();
    run.stop();
    expect(VexSpeedRun.bests()).toEqual({});
  });

  it('refuses to start on an empty list', async () => {
    const run = VexSpeedRun.begin({ id: 'reading', name: 'Queue', what: 'pages', remaining: () => 0 });
    await expect(run.start()).rejects.toThrow(/nothing to clear/);
  });

  it('counts unread Read Later pages', () => {
    globalThis.ReadLater = { items: [{ id: 1 }, { id: 2, read: true }, { id: 3 }] };
    expect(VexSpeedRun.COURSES.find(c => c.id === 'reading').remaining()).toBe(2);
  });

  it('has no ranking or sharing surface at all', () => {
    const src = fs.readFileSync(js('speed-run.js'), 'utf8');
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  });
});

describe('keyboard trainer', () => {
  const all = {
    'command-bar': { label: 'Command Bar (URLs, commands, search)', current: 'Ctrl+K', hasHandler: true },
    'close-tab': { label: 'Close Tab', current: 'Ctrl+W', hasHandler: true, system: true },
    'tabs-sidebar': { label: 'Toggle Tabs Sidebar', current: 'Ctrl+B', hasHandler: true },
    'no-handler': { label: 'Nothing', current: 'Ctrl+Alt+Q', hasHandler: false },
    'lock-vex': { label: 'Lock Vex', current: 'Ctrl+Alt+L', hasHandler: true },
    'dup': { label: 'Dup', current: 'Ctrl+K', hasHandler: true },
    'cmd:foo': { label: 'Own', current: 'Ctrl+Alt+Y', hasHandler: true, removable: true },
  };

  it('asks only for keys it can safely watch', () => {
    const ids = VexKeyTrainer.candidates(all).map(c => c.id);
    expect(ids).toEqual(['command-bar', 'tabs-sidebar']);
  });

  it('phrases it as "in N keys"', () => {
    const c = VexKeyTrainer.candidates(all)[0];
    expect(VexKeyTrainer.prompt(c)).toBe('Command Bar in 2 keys');
  });

  it('makes a distinct deck from the real registry', () => {
    for (const id of ['keys-sheet', 'ask-ai-bar', 'ai-focus-mode', 'reading-mode', 'toggle-theme', 'group-tabs', 'focus-url', 'reload']) ShortcutsRegistry.register(id, () => {});
    const real = ShortcutsRegistry.getAllShortcuts();
    const deck = VexKeyTrainer.deck(real, 5, () => 0.3);
    expect(deck.length).toBe(5);
    expect(new Set(deck.map(d => d.combo)).size).toBe(5);
    // The registry's own fixed keys never show up.
    for (const d of deck) expect(real[d.id].system).toBeFalsy();
  });

  it('matches a keydown to a combo', () => {
    expect(VexKeyTrainer.matches('Ctrl+Shift+K', new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(VexKeyTrainer.matches('Ctrl+K', new KeyboardEvent('keydown', { key: 'j', ctrlKey: true }))).toBe(false);
  });

  it('keeps keys inside its own overlay and does not let them through', () => {
    for (const id of ['keys-sheet', 'ask-ai-bar', 'ai-focus-mode', 'reading-mode', 'toggle-theme', 'group-tabs', 'focus-url', 'reload']) ShortcutsRegistry.register(id, () => {});
    const real = ShortcutsRegistry.getAllShortcuts();
    const first = VexKeyTrainer.deck(real, 5, () => 0)[0];
    const leaked = vi.fn();
    document.addEventListener('keydown', leaked, true);
    const dlg = VexKeyTrainer.open();
    const fire = (combo) => {
      const parts = combo.split('+');
      const key = parts[parts.length - 1];
      const ev = new KeyboardEvent('keydown', {
        key: key.length === 1 ? key.toLowerCase() : key, bubbles: true, cancelable: true,
        ctrlKey: parts.includes('Ctrl'), altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift'),
      });
      window.dispatchEvent(ev);
      return ev;
    };
    const wrong = fire('Ctrl+Alt+Shift+Q');
    expect(wrong.defaultPrevented).toBe(true);
    expect(leaked).not.toHaveBeenCalled();
    expect(dlg.el.textContent).toMatch(/That was/);
    // Closing removes the listener: keys go through again.
    dlg.close();
    const after = fire('Ctrl+Alt+Shift+Q');
    expect(after.defaultPrevented).toBe(false);
    expect(first).toBeTruthy();
    document.removeEventListener('keydown', leaked, true);
  });

  it('records a finished round without a score or a streak', () => {
    const r1 = VexKeyTrainer.finishRound(30000, ['command-bar']);
    expect(r1.isBest).toBe(true);
    const r2 = VexKeyTrainer.finishRound(45000, ['tabs-sidebar']);
    expect(r2.isBest).toBe(false);
    const st = VexKeyTrainer.stats();
    expect(st.rounds).toBe(2);
    expect(st.learned).toEqual({ 'command-bar': true, 'tabs-sidebar': true });
    expect(Object.keys(st).sort()).toEqual(['bestMs', 'learned', 'rounds']);
  });
});

describe('hub', () => {
  it('registers commands once and offers brief modules', () => {
    globalThis.CommandBar = { commands: [] };
    expect(VexExpression.register({ id: 't1', commands: [{ id: 'c1', label: 'x', action() {} }], brief: { id: 'b', build() {}, isEnabled() {} } })).toBe(true);
    expect(VexExpression.register({ id: 't1' })).toBe(false);
    expect(CommandBar.commands.map(c => c.id)).toEqual(['c1']);
    expect(VexExpression.briefModules().some(b => b.id === 'b')).toBe(true);
    delete globalThis.CommandBar;
  });

  it('mounts one Settings group at runtime, once', () => {
    document.body.innerHTML = '<div id="panel-settings"><div class="settings-content"></div></div>';
    VexExpression.register({ id: 'mounted', title: 'Mounted', renderSettings: (c) => { c.textContent = 'hello'; } });
    const g = VexExpression.mountSettings();
    expect(g.id).toBe('settings-expression');
    expect(g.textContent).toContain('Mounted');
    expect(VexExpression.mountSettings()).toBe(g);
    expect(document.querySelectorAll('#settings-expression').length).toBe(1);
  });

  it('the modules draw their own settings, all off at first', () => {
    const box = document.createElement('div');
    for (const m of [VexFortune, VexJingle, VexSpeedRun, VexKeyTrainer]) {
      const part = document.createElement('div');
      m.renderSettings(part);
      box.appendChild(part);
    }
    const toggles = [...box.querySelectorAll('input[type=checkbox]')];
    expect(toggles.length).toBeGreaterThanOrEqual(3);
    // The first is the fortune, the next two are the jingle's moments: off.
    expect(toggles[0].checked).toBe(false);
    expect(toggles[1].checked).toBe(false);
    expect(toggles[2].checked).toBe(false);
  });
});

describe('index.html', () => {
  it('only needs script tags, in dependency order', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/index.html'), 'utf8');
    const order = ['vex-unlock', 'vex-expression', 'vex-cosmetics', 'vex-titles', 'vex-jingle', 'vex-fortune', 'tab-roulette', 'speed-run', 'key-trainer', 'expression-boot'];
    let last = -1;
    for (const n of order) {
      const i = html.indexOf('src="js/' + n + '.js"');
      expect(i).toBeGreaterThan(last);
      last = i;
    }
    expect(html.indexOf('js/readlater.js')).toBeLessThan(html.indexOf('js/vex-unlock.js'));
    expect(html.indexOf('js/expression-boot.js')).toBeLessThan(html.indexOf('js/app.js'));
  });
});
