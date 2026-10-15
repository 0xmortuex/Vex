// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

let clock;
// Modules re-imported for each test add document listeners; drop the old ones.
const _added = [];
const _add = document.addEventListener.bind(document);
document.addEventListener = (...a) => { _added.push(a); _add(...a); };
const DAY = '2026-10-16';
const at = (h) => new Date(2026, 9, 16, h, 0, 0).getTime();

async function load() {
  vi.resetModules();
  for (const a of _added.splice(0)) document.removeEventListener(a[0], a[1]);
  localStorage.clear();
  document.body.innerHTML = '<div class="settings-content"></div><div id="host"></div>';
  document.head.innerHTML = '';
  delete globalThis.GameSession;
  const used = new Set();
  globalThis.VexFeatures = {
    ITEMS: Array.from({ length: 12 }, (_, i) => ({ id: 'f' + i, name: 'Feature ' + i })),
    used(item) { return used.has(item.id); },
    unused() { return this.ITEMS.filter(i => !used.has(i.id)); },
    nameOf(i) { return i.name; },
  };
  globalThis.__used = used;
  for (const f of ['fun-core', 'levels', 'discovery-log', 'daily-challenge', 'vex-pet', 'fun-settings']) {
    await import('../../src/renderer/js/fun/' + f + '.js');
  }
  VexFun.now = () => clock;
  VexFun._gameFlag = false;
}

const signals = [];
beforeEach(async () => {
  clock = at(14);
  signals.length = 0;
  await load();
  document.addEventListener('vex:medal-signal', (e) => signals.push(e.detail.id));
});

describe('shared core', () => {
  it('is off by default and rejects unknown flags', () => {
    for (const f of VexFun.FLAGS) expect(VexFun.enabled(f)).toBe(false);
    expect(() => VexFun.enabled('nope')).toThrow(/Unknown/);
    expect(() => VexFun.setEnabled('pet', 'yes')).toThrow(/on or off/);
  });
  it('sends a medal signal once per id', () => {
    expect(VexFun.medal('x')).toBe(true);
    expect(VexFun.medal('x')).toBe(false);
    expect(signals.filter(s => s === 'x')).toHaveLength(1);
  });
  it('raises on damaged storage instead of resetting it', () => {
    localStorage.setItem('vex.fun.levels', '{oops');
    expect(() => VexFun.load('vex.fun.levels', {})).toThrow(/could not be read/);
  });
});

describe('browser levels', () => {
  it('has rising thresholds and a title for every level', () => {
    expect([1, 2, 3, 4].map(n => VexLevels.threshold(n))).toEqual([0, 50, 150, 300]);
    expect(VexLevels.levelFor(49)).toBe(1);
    expect(VexLevels.levelFor(50)).toBe(2);
    expect(VexLevels.titleFor(1)).toBe('Newcomer');
    expect(VexLevels.titleFor(40)).toBe('Level 40');
  });
  it('awards nothing while off, and never for unknown kinds', () => {
    expect(VexLevels.award('note')).toBeNull();
    expect(() => VexLevels.award('time-on-screen')).toThrow(/Unknown level action/);
    expect(VexLevels.snapshot().xp).toBe(0);
  });
  it('awards, caps per day, and resets the cap the next day', () => {
    VexFun.setEnabled('levels', true);
    expect(VexLevels.award('inbox-cleared').gained).toBe(30);
    expect(VexLevels.award('inbox-cleared')).toBeNull();
    clock += 86400000;
    expect(VexLevels.award('inbox-cleared').gained).toBe(30);
    expect(VexLevels.snapshot().xp).toBe(60);
  });
  it('levels up, signals a medal at level 5, and exposes a snapshot', () => {
    VexFun.setEnabled('levels', true);
    const ups = [];
    document.addEventListener('vex:level-up', (e) => ups.push(e.detail.level));
    for (let d = 0; d < 12; d++) { VexLevels.award('inbox-cleared'); VexLevels.award('reading-finished'); clock += 86400000; }
    const s = VexLevels.snapshot();
    expect(s.level).toBeGreaterThanOrEqual(5);
    expect(ups.length).toBeGreaterThan(0);
    expect(signals).toContain('level-5');
    expect(s.progress).toBeGreaterThanOrEqual(0);
    expect(s.progress).toBeLessThanOrEqual(1);
  });
  it('counts the vex:fun-action event', () => {
    VexFun.setEnabled('levels', true);
    document.dispatchEvent(new CustomEvent('vex:fun-action', { detail: { kind: 'note', count: 2 } }));
    expect(VexLevels.snapshot().xp).toBe(10);
  });
});

describe('discovery log', () => {
  it('counts used features as N of M and records the day found', () => {
    VexFun.setEnabled('discovery', true);
    __used.add('f1'); __used.add('f2');
    expect(VexDiscovery.scan().sort()).toEqual(['f1', 'f2']);
    const s = VexDiscovery.snapshot();
    expect(s.text).toBe('2 of 12 discovered');
    expect(s.recent[0].day).toBe(DAY);
    expect(s.missing).toHaveLength(10);
    expect(VexDiscovery.scan()).toEqual([]);
  });
  it('signals milestone medals and does nothing while off', () => {
    __used.add('f0');
    expect(VexDiscovery.scan()).toEqual([]);
    VexFun.setEnabled('discovery', true);
    for (let i = 0; i < 10; i++) __used.add('f' + i);
    VexDiscovery.scan();
    expect(signals).toContain('discovery-10');
  });
  it('renders an accessible card', () => {
    VexFun.setEnabled('discovery', true);
    __used.add('f3'); VexDiscovery.scan();
    const el = document.getElementById('host');
    VexDiscovery.render(el);
    expect(el.textContent).toContain('1 of 12 discovered');
    expect(el.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('1');
  });
});

describe('daily challenge', () => {
  it('is the same all day, and one per day', () => {
    VexFun.setEnabled('challenge', true);
    const a = VexDailyChallenge.snapshot();
    expect(VexDailyChallenge.snapshot().id).toBe(a.id);
    expect(VexDailyChallenge.pickFor('2026-10-16').id).toBe(a.id);
  });
  it('completes a tab challenge through vex:tab-closed and rewards levels', () => {
    VexFun.setEnabled('challenge', true);
    VexFun.setEnabled('levels', true);
    // choose a day whose challenge is close-tabs
    const idx = VexDailyChallenge.POOL.findIndex(p => p.id === 'close-tabs');
    let d = new Date(2026, 9, 16);
    while (VexDailyChallenge.pickFor(VexFun.today(d.getTime())).id !== 'close-tabs') d = new Date(d.getTime() + 86400000);
    expect(idx).toBeGreaterThanOrEqual(0);
    clock = d.getTime();
    for (let i = 0; i < 5; i++) document.dispatchEvent(new CustomEvent('vex:tab-closed', { detail: { tabId: i } }));
    const s = VexDailyChallenge.snapshot();
    expect(s.status).toBe('done');
    expect(s.completedTotal).toBe(1);
    expect(VexLevels.snapshot().xp).toBe(20);
    expect(signals).toContain('challenge-first');
  });
  it('skipping costs nothing and cannot be undone or doubled', () => {
    VexFun.setEnabled('challenge', true);
    VexFun.setEnabled('levels', true);
    VexDailyChallenge.skip();
    expect(VexDailyChallenge.snapshot().status).toBe('skipped');
    expect(VexLevels.snapshot().xp).toBe(0);
    expect(() => VexDailyChallenge.skip()).toThrow(/already/);
    clock += 86400000;
    expect(VexDailyChallenge.snapshot().status).toBe('open');
  });
  it('manual challenges need the person; automatic ones refuse "I did it"', () => {
    VexFun.setEnabled('challenge', true);
    let d = new Date(2026, 9, 16);
    while (!VexDailyChallenge.pickFor(VexFun.today(d.getTime())).manual) d = new Date(d.getTime() + 86400000);
    clock = d.getTime();
    VexDailyChallenge.complete();
    expect(VexDailyChallenge.snapshot().status).toBe('done');
    while (VexDailyChallenge.pickFor(VexFun.today(d.getTime())).manual) d = new Date(d.getTime() + 86400000);
    clock = d.getTime();
    expect(() => VexDailyChallenge.complete()).toThrow(/by itself/);
  });
  it('notices command-bar use', () => {
    VexFun.setEnabled('challenge', true);
    let d = new Date(2026, 9, 16);
    while (VexDailyChallenge.pickFor(VexFun.today(d.getTime())).id !== 'command-bar') d = new Date(d.getTime() + 86400000);
    clock = d.getTime();
    VexDailyChallenge.snapshot();
    localStorage.setItem('vex.commandUsage', JSON.stringify({ a: { n: 2 }, b: { n: 1 } }));
    expect(VexDailyChallenge.snapshot().status).toBe('done');
  });
});

describe('vex pet', () => {
  it('picks sleepy at night, cheer after focus, calm otherwise', () => {
    expect(VexPet.moodFor({ hour: 23, now: 0, cheerUntil: 0 })).toBe('sleepy');
    expect(VexPet.moodFor({ hour: 3, now: 0, cheerUntil: 0 })).toBe('sleepy');
    expect(VexPet.moodFor({ hour: 14, now: 0, cheerUntil: 0 })).toBe('calm');
    expect(VexPet.moodFor({ hour: 23, now: 5, cheerUntil: 10 })).toBe('cheer');
    expect(() => VexPet.moodFor({ hour: 99, now: 0, cheerUntil: 0 })).toThrow();
  });
  it('is drawn only when on, with no emoji and no script', () => {
    expect(VexPet.snapshot().svg).toBe('');
    VexFun.setEnabled('pet', true);
    const s = VexPet.snapshot();
    expect(s.svg.startsWith('<svg')).toBe(true);
    expect(s.svg).not.toMatch(/<script|on\w+=/i);
    expect(/\p{Extended_Pictographic}/u.test(s.svg)).toBe(false);
  });
  it('cheers on vex:focus-complete, mounts, and hides during Game mode', () => {
    VexFun.setEnabled('pet', true);
    const host = document.getElementById('host');
    const h = VexPet.mount(host);
    expect(host.querySelector('.vex-pet-calm')).not.toBeNull();
    document.dispatchEvent(new CustomEvent('vex:focus-complete', { detail: { minutes: 25 } }));
    expect(host.querySelector('.vex-pet-cheer')).not.toBeNull();
    document.dispatchEvent(new CustomEvent('vex:game-mode', { detail: { active: true } }));
    expect(host.querySelector('svg')).toBeNull();
    document.dispatchEvent(new CustomEvent('vex:game-mode', { detail: { active: false } }));
    expect(host.querySelector('svg')).not.toBeNull();
    h.destroy();
    expect(host.querySelector('.vex-pet')).toBeNull();
  });
  it('stops its animation under reduced motion', () => {
    VexPet._style();
    expect(document.getElementById('vex-pet-style').textContent).toMatch(/prefers-reduced-motion:reduce/);
  });
});

describe('settings group', () => {
  it('injects itself into the Settings panel, all switches off', () => {
    const g = VexFunSettings.inject();
    expect(g).not.toBeNull();
    expect(VexFunSettings.inject()).toBe(g);
    const boxes = g.querySelectorAll('[data-fun-flag]');
    expect(boxes).toHaveLength(4);
    boxes.forEach(b => expect(b.checked).toBe(false));
  });
  it('turning a switch on shows its card', () => {
    const g = VexFunSettings.inject();
    const box = g.querySelector('[data-fun-flag="challenge"]');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(VexFun.enabled('challenge')).toBe(true);
    expect(g.querySelector('[aria-label="Daily challenge"]')).not.toBeNull();
  });
});
