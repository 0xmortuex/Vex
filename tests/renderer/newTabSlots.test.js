// @vitest-environment jsdom
//
// New Tab slot grid and render budget (T0-024): js/newtab-slots.js, its place in
// the Today snapshot (js/today.js) and its consumer in start.html.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const JS = path.join(ROOT, 'src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };
const NAMES = ['VexDefaults', 'VexMigrations', 'NewTabSlots', 'VexBrief', 'VexDelights', 'VexProgress', 'VexPlayfulness', 'VexToday', 'Onboarding'];
let N;

beforeEach(() => {
  localStorage.clear();
  for (const n of NAMES) delete globalThis[n];
  const d = fresh('vex-defaults.js');
  globalThis.VexDefaults = d.VexDefaults; globalThis.VexMigrations = d.VexMigrations;
  N = fresh('newtab-slots.js').NewTabSlots; globalThis.NewTabSlots = N;
});

// Every optional thing is on, so every candidate is available.
function everythingOn() {
  globalThis.VexBrief = { prefs: () => ({ enabled: true }), isEnabled: () => true };
  globalThis.VexDelights = { isOn: () => true };
  globalThis.VexProgress = { enabled: () => true };
}

describe('the plan', () => {
  it('shows the hero and at most three cards and one footer line in the calm layout, by priority', () => {
    everythingOn();
    const p = N.plan({ layout: 'calm' });
    expect(p.hero).toBe(true);
    expect(p.cards).toEqual(['brief', 'today', 'news-actions']);      // 90, 80, 60: ahead of weather, widgets, ...
    expect(p.footer).toEqual(['recent']);
    expect(p.dropped.map(d => d.id)).toEqual(expect.arrayContaining(['weather', 'widgets', 'one-new-thing', 'tools', 'streaks', 'pet', 'fortune', 'github']));
    expect(p.dropped.every(d => /no free (card|footer) slot/.test(d.reason))).toBe(true);
  });

  it('a card that has nothing to show does not take a slot', () => {
    globalThis.VexBrief = { prefs: () => ({ enabled: true }), isEnabled: (id) => id !== 'news-actions' };
    const p = N.plan({ layout: 'calm' });
    expect(p.cards).toEqual(['brief', 'today', 'weather']);
  });

  it('stays inside the 50 ms render budget and the payload bound', () => {
    everythingOn();
    for (const layout of ['calm']) {
      const p = N.plan({ layout });
      expect(p.spentMs).toBeLessThanOrEqual(N.BUDGET_MS);
      expect(p.bytes).toBeLessThanOrEqual(N.MAX_BYTES);
    }
  });

  it('drops a costly card that would break the budget, even with a free slot', () => {
    for (const d of N.list()) N.unregister(d.id);
    N.register({ id: 'heavy-a', slot: 'card', priority: 90, cost: 30, element: 'brief-section' });
    N.register({ id: 'heavy-b', slot: 'card', priority: 80, cost: 30, element: 'today-section' });
    N.register({ id: 'light-c', slot: 'card', priority: 10, cost: 5, element: 'tools-section' });
    const p = N.plan({ layout: 'calm' });
    expect(p.cards).toEqual(['heavy-a', 'light-c']);
    expect(p.dropped).toEqual([{ id: 'heavy-b', reason: 'over the 50 ms budget' }]);
    expect(p.spentMs).toBe(N.HERO_MS + 30 + 5);
  });

  it('the everything layout shows every available card and only reports the cost', () => {
    everythingOn();
    const p = N.plan({ layout: 'all' });
    expect(p.cards.length).toBeGreaterThan(3);
    expect(p.dropped).toEqual([]);
  });

  it('plans a crowd of 300 candidates well inside the budget, and keeps three', () => {
    for (const d of N.list()) N.unregister(d.id);
    for (let i = 0; i < 300; i++) N.register({ id: 'c' + i, slot: i % 10 === 0 ? 'footer' : 'card', priority: i % 100, cost: 1 + (i % 7), bytes: 50, element: 'brief-section' });
    const t0 = performance.now();
    const p = N.plan({ layout: 'calm' });
    const took = performance.now() - t0;
    expect(took).toBeLessThan(50);
    expect(p.cards).toHaveLength(3);
    expect(p.footer).toHaveLength(1);
    expect(p.spentMs).toBeLessThanOrEqual(N.BUDGET_MS);
  });

  it('survives a candidate whose availability check throws, and says so', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const d of N.list()) N.unregister(d.id);
    N.register({ id: 'broken', slot: 'card', priority: 99, cost: 1, element: 'brief-section', available: () => { throw new Error('boom'); } });
    N.register({ id: 'fine', slot: 'card', priority: 1, cost: 1, element: 'today-section' });
    expect(N.plan({ layout: 'calm' }).cards).toEqual(['fine']);
    expect(err).toHaveBeenCalled();
  });

  it('refuses a candidate the start page cannot place', () => {
    expect(() => N.register({ id: 'x-bad', slot: 'card', priority: 5, cost: 1, element: 'some-other-div' })).toThrow(/cannot hide/);
    expect(() => N.register({ id: 'x-bad', slot: 'card', priority: 5, cost: 1 })).toThrow(/exactly one/);
    expect(() => N.register({ id: 'x-bad', slot: 'card', priority: 500, cost: 1, element: 'brief-section' })).toThrow(/priority/);
    expect(() => N.register({ id: 'x-bad', slot: 'card', priority: 5, cost: 9999, element: 'brief-section' })).toThrow(/cost/);
  });
});

describe('applying the plan to the Today snapshot', () => {
  it('hides what was not chosen, removes dropped brief sections and parts, and keeps the payload small', () => {
    everythingOn();
    const snap = {
      newtab: { v: 1, quiet: false, pet: { svg: '<svg/>' }, widgets: [{ text: 'a' }] },
      morning: { sections: [{ id: 'calendar' }, { id: 'one-new-thing' }, { id: 'fortune' }, { id: 'news-actions' }] },
    };
    const slots = N.applyTo(snap, N.plan({ layout: 'calm' }));
    expect(slots.layout).toBe('calm');
    expect(slots.show).toEqual(['brief-section', 'today-section', 'recent-section']);
    expect(slots.hide).toEqual(expect.arrayContaining(['weather-section', 'tools-section', 'gh-activity-section']));
    expect(snap.newtab.pet).toBeUndefined();
    expect(snap.newtab.widgets).toBeUndefined();
    expect(snap.morning.sections.map(s => s.id)).toEqual(['calendar', 'news-actions']);   // core sections are never touched
    expect(JSON.stringify(snap.newtab).length).toBeLessThan(2000);
  });

  it('the everything layout removes nothing', () => {
    everythingOn();
    const snap = { newtab: { v: 1, pet: { svg: '<svg/>' } }, morning: { sections: [{ id: 'fortune' }] } };
    const slots = N.applyTo(snap, N.plan({ layout: 'all' }));
    expect(slots).toEqual({ layout: 'all', show: [], hide: [] });
    expect(snap.newtab.pet).toBeDefined();
    expect(snap.morning.sections).toHaveLength(1);
  });
});

describe('the layout setting', () => {
  it('defaults to calm, is a choice once set, and refreshes the page', async () => {
    expect(N.layout()).toBe('calm');
    globalThis.VexToday = { refresh: vi.fn().mockResolvedValue(null) };
    N.setLayout('all');
    expect(N.layout()).toBe('all');
    expect(VexDefaults.isExplicit('newtab.layout')).toBe(true);
    expect(VexToday.refresh).toHaveBeenCalled();
    expect(() => N.setLayout('wild')).toThrow();
    expect(N.enabled()).toBe(false);
  });

  it('an existing profile keeps every card, a new one gets the grid', () => {
    expect(N._migrateLayout(true)).toBe('all');
    expect(N.layout()).toBe('all');
    VexDefaults.reset('newtab.layout');
    expect(N._migrateLayout(false)).toBe('calm');
    expect(N.layout()).toBe('calm');
    VexDefaults.set('newtab.layout', 'calm');
    expect(N._migrateLayout(true)).toBe('kept');
  });
});

describe('the start page', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/start.html'), 'utf8');

  it('has an id for every block the grid can hide, and hides only ids from its own fixed list', () => {
    for (const id of N.PAGE_ELEMENTS) expect(html, id).toContain('id="' + id + '"');
    expect(html).toContain("var SLOTTED = ['brief-section', 'today-section', 'weather-section', 'tools-section', 'recent-section', 'gh-activity-section']");
    expect(html).toContain('.vex-slot-off { display: none !important; }');
  });

  it('keeps the fixed list in step with the grid', () => {
    const m = html.match(/var SLOTTED = \[([^\]]+)\]/);
    const list = m[1].split(',').map(s => s.trim().replace(/'/g, ''));
    expect(list).toEqual(N.PAGE_ELEMENTS);
  });

  it('today.js applies the grid last, to the finished snapshot', () => {
    const today = fs.readFileSync(path.join(JS, 'today.js'), 'utf8');
    expect(today.indexOf('NewTabSlots.applyTo(snap)')).toBeGreaterThan(today.indexOf('VexBrief.build'));
  });
});
