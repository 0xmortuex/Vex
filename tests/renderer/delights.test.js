// @vitest-environment jsdom
//
// Little surprises (js/delights.js and its six modules): rabbit hole, time
// capsule, on this day, a forgotten bookmark, mood themes, start widgets.
// Pure parts are checked directly; the wiring against stand-ins.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const DAY = 24 * 3600 * 1000;
const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime();

async function load(name, global) {
  const m = await import('../../src/renderer/js/' + name + '.js');
  globalThis[global] = m[global];
  window[global] = m[global];
  return m[global];
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.vexId = (p) => p + '-' + Math.random().toString(36).slice(2, 8);
  delete window.vex;
});
afterEach(() => {
  for (const g of ['VexDelights', 'VexRabbitHole', 'VexTimeCapsule', 'VexOnThisDay', 'VexOldBookmark', 'VexMoodTheme', 'VexWidgets', 'ThemeAuto', 'ThemeManager', 'GameSession', 'TabManager', 'Bookmarks', 'HistoryPanel', 'ReadLater', 'VexInterests', 'CommandBar', 'VexBrief', 'VexJobs']) {
    delete globalThis[g]; delete window[g];
  }
  vi.restoreAllMocks();
});

describe('rabbit hole', () => {
  const lists = () => ({
    history: [
      { url: 'https://old.example/post', title: 'Old post', visitedAt: new Date(NOW - 90 * DAY).toISOString() },
      { url: 'https://today.example/x', title: 'Today', visitedAt: new Date(NOW - 3600e3).toISOString() },
      { url: 'https://site.example/login', title: 'Login', visitedAt: new Date(NOW - 60 * DAY).toISOString() },
      { url: 'https://tor.example/p', title: 'Tor', ownSession: true, visitedAt: new Date(NOW - 60 * DAY).toISOString() },
      { url: 'chrome://settings', title: 'Settings', visitedAt: new Date(NOW - 60 * DAY).toISOString() },
    ],
    bookmarks: [{ id: 'b1', url: 'https://book.example/a', title: 'Book', at: NOW - 200 * DAY }],
    readLater: [{ id: 'r1', url: 'https://later.example/a', title: 'Later', at: NOW - 40 * DAY, read: false }, { id: 'r2', url: 'https://done.example/', title: 'Read', at: NOW - 40 * DAY, read: true }],
  });

  it('gathers from the three lists and drops private, boring and read items', async () => {
    const R = await load('rabbit-hole', 'VexRabbitHole');
    const urls = R.gather(lists()).map(c => c.url).sort();
    expect(urls).toEqual(['https://book.example/a', 'https://later.example/a', 'https://old.example/post', 'https://today.example/x']);
  });

  it('prefers Read Later, leaves out what was seen in the last day, and makes no request', async () => {
    const R = await load('rabbit-hole', 'VexRabbitHole');
    const f = vi.fn(); globalThis.fetch = f;
    const pick = R.pick(lists(), { now: NOW, rng: () => 0, model: { hosts: {}, urls: {}, seen: {} } });
    expect(pick.url).toBe('https://later.example/a');
    const all = R.rank(R.gather(lists()), { now: NOW, model: { hosts: {}, urls: {}, seen: {} } });
    expect(all.map(c => c.url)).not.toContain('https://today.example/x');
    expect(f).not.toHaveBeenCalled();
  });

  it('skip and good feedback persist and change what is offered', async () => {
    const R = await load('rabbit-hole', 'VexRabbitHole');
    R.feedback('https://later.example/a', 'skip');
    const m = R._read();
    expect(m.urls['https://later.example/a'].v).toBe('skip');
    expect(m.hosts['later.example'].skip).toBe(1);
    const pick = R.pick(lists(), { now: Date.now() + 0, rng: () => 0 });
    expect(pick.url).not.toBe('https://later.example/a');
    expect(() => R.feedback('https://x.example/', 'meh')).toThrow(/good|skip/);
  });

  it('stops offering a host that was skipped three more times than liked', async () => {
    const R = await load('rabbit-hole', 'VexRabbitHole');
    for (let i = 0; i < 3; i++) R.feedback('https://book.example/p' + i, 'skip');
    const out = R.rank(R.gather(lists()), { now: Date.now(), model: R._read() });
    expect(out.map(c => c.host)).not.toContain('book.example');
  });

  it('lets the interests profile lift a host a little', async () => {
    const R = await load('rabbit-hole', 'VexRabbitHole');
    const base = { history: [{ url: 'https://a.example/1', title: 'A', visitedAt: new Date(NOW - 30 * DAY).toISOString() }, { url: 'https://b.example/1', title: 'B', visitedAt: new Date(NOW - 30 * DAY).toISOString() }] };
    const out = R.rank(R.gather(base), { now: NOW, model: { hosts: {}, urls: {}, seen: {} }, interest: (h) => (h === 'b.example' ? 2 : 0) });
    expect(out[0].host).toBe('b.example');
  });

  it('reports nothing to pick as an error and opens a tab with a bar when it can', async () => {
    const R = await load('rabbit-hole', 'VexRabbitHole');
    globalThis.TabManager = { createTab: vi.fn(() => 7) };
    await expect(R.surprise()).rejects.toThrow(/Nothing to pick/);
    globalThis.Bookmarks = { items: [{ id: 'b', url: 'https://book.example/a', title: 'Book', at: NOW - 200 * DAY }] };
    const signals = [];
    document.addEventListener('vex:medal-signal', (e) => signals.push(e.detail.id));
    const pick = await R.surprise();
    expect(pick.url).toBe('https://book.example/a');
    expect(TabManager.createTab).toHaveBeenCalledWith('https://book.example/a', true);
    expect(document.querySelector('.vex-delight-bar')).not.toBeNull();
    expect(signals).toContain('rabbit-hole-first');
    // The same page is not offered again straight away.
    await expect(R.surprise()).rejects.toThrow(/Nothing to pick/);
  });
});

describe('time capsule', () => {
  it('validates the date and needs something to hold', async () => {
    const C = await load('time-capsule', 'VexTimeCapsule');
    const now = new Date(2026, 9, 16, 8);
    expect(C.parseDay('2026-02-30')).toBeNull();
    await expect(C.add({ url: 'https://a.example/', dueOn: 'soon' }, now)).rejects.toThrow(/YYYY-MM-DD/);
    await expect(C.add({ url: 'https://a.example/', dueOn: '2026-10-16' }, now)).rejects.toThrow(/after today/);
    await expect(C.add({ dueOn: '2026-12-01' }, now)).rejects.toThrow(/page or a note/);
    await expect(C.add({ url: 'file:///c:/x', dueOn: '2026-12-01' }, now)).rejects.toThrow(/web pages/);
  });

  it('makes the reminder for 09:00 on the day and keeps the capsule', async () => {
    const C = await load('time-capsule', 'VexTimeCapsule');
    const create = vi.fn(async () => ({ id: 'rem1' }));
    window.vex = { reminders: { create, delete: vi.fn(async () => {}), ack: vi.fn(async () => {}) } };
    const cap = await C.add({ url: 'https://a.example/p', title: 'A page', dueOn: '2026-12-01' }, new Date(2026, 9, 16));
    expect(create).toHaveBeenCalledTimes(1);
    const [msg, at, extra] = create.mock.calls[0];
    expect(msg).toContain('A page');
    expect(new Date(at).getHours()).toBe(9);
    expect(new Date(at).getMonth()).toBe(11);
    expect(extra).toEqual({ url: 'https://a.example/p' });
    expect(cap.reminderId).toBe('rem1');
    expect(C.upcoming(new Date(2026, 9, 17)).length).toBe(1);
    expect(C.due(new Date(2026, 11, 1)).length).toBe(1);
  });

  it('fails loudly when reminders are not available', async () => {
    const C = await load('time-capsule', 'VexTimeCapsule');
    await expect(C.add({ text: 'hello', dueOn: '2026-12-01' }, new Date(2026, 9, 16))).rejects.toThrow(/Reminders are not available/);
    expect(C.list()).toEqual([]);
  });

  it('opens a page capsule in a tab, acknowledges it and signals a medal once', async () => {
    const C = await load('time-capsule', 'VexTimeCapsule');
    const ack = vi.fn(async () => {});
    window.vex = { reminders: { create: async () => ({ id: 'r' }), delete: async () => {}, ack } };
    globalThis.TabManager = { createTab: vi.fn() };
    const cap = await C.add({ url: 'https://a.example/', dueOn: '2026-12-01' }, new Date(2026, 9, 16));
    const sig = [];
    document.addEventListener('vex:medal-signal', (e) => sig.push(e.detail.id));
    await C.open(cap.id);
    expect(TabManager.createTab).toHaveBeenCalledWith('https://a.example/', true);
    expect(ack).toHaveBeenCalledWith('r');
    expect(C.list()[0].openedAt).toBeTruthy();
    expect(C.due(new Date(2027, 0, 1))).toEqual([]);
    expect(sig).toEqual(['time-capsule-opened']);
  });

  it('does not build a brief section when nothing is due', async () => {
    const C = await load('time-capsule', 'VexTimeCapsule');
    expect(C.section.build()).toBeNull();
    expect(C.section.isEnabled()).toBe(false);
  });
});

describe('on this day', () => {
  it('collects the same date in earlier years across the lists', async () => {
    const O = await load('on-this-day', 'VexOnThisDay');
    const now = new Date(2026, 9, 16, 10).getTime();
    const at = (y, h = 9) => new Date(y, 9, 16, h).getTime();
    const groups = O.collect({
      history: [{ url: 'https://a.example/', title: 'A', visitedAt: new Date(at(2024)).toISOString() }, { url: 'https://b.example/', title: 'B', visitedAt: new Date(at(2026)).toISOString() }, { url: 'https://t.example/', ownSession: true, visitedAt: new Date(at(2024)).toISOString() }, { url: 'https://c.example/', title: 'C', visitedAt: new Date(2024, 9, 17).toISOString() }],
      notes: [{ id: 'n', title: 'Plans', content: '', createdAt: at(2024, 20) }, { id: 'm', title: '', content: 'First line\nsecond', createdAt: at(2023) }],
      bookmarks: [{ id: 'b', url: 'https://d.example/', title: 'D', at: at(2023, 14) }],
      readLater: [], clips: [{ name: 'night_raid.mp4', at: at(2024, 23) }],
    }, now);
    expect(groups.map(g => g.year)).toEqual([2024, 2023]);
    expect(groups[0].items.map(i => i.kind)).toEqual(['read', 'wrote', 'recorded']);
    expect(groups[0].items.map(i => i.text)).not.toContain('C');
    expect(groups[1].items.find(i => i.kind === 'wrote').text).toBe('First line');
    expect(O.describe(groups[0])).toBe('You read "A", wrote "Plans", recorded "night raid".');
  });

  it('is empty on a date with nothing and never counts this year', async () => {
    const O = await load('on-this-day', 'VexOnThisDay');
    expect(O.collect({ history: [{ url: 'https://a.example/', visitedAt: new Date(NOW).toISOString() }] }, NOW)).toEqual([]);
  });
});

describe('a forgotten bookmark', () => {
  const items = () => [
    { id: 'a', url: 'https://a.example/', title: 'A', at: NOW - 400 * DAY },
    { id: 'b', url: 'https://b.example/', title: 'B', at: NOW - 300 * DAY },
    { id: 'c', url: 'https://c.example/', title: 'C', at: NOW - 10 * DAY },
    { id: 'd', url: 'https://d.example/', title: 'D', at: NOW - 500 * DAY, archived: true },
  ];

  it('only offers old, unarchived bookmarks, and the same one all day', async () => {
    const B = await load('old-bookmark', 'VexOldBookmark');
    expect(B.eligible(items(), {}, NOW).map(b => b.id)).toEqual(['a', 'b']);
    const s = { day: '', id: '', reviewed: {} };
    const first = B.choose(items(), s, NOW);
    expect(['a', 'b']).toContain(first.id);
    expect(B.choose(items(), s, NOW + 3600e3).id).toBe(first.id);
  });

  it('does not re-ask a bookmark answered "still good" for six months', async () => {
    const B = await load('old-bookmark', 'VexOldBookmark');
    const rev = { a: NOW - 10 * DAY };
    expect(B.eligible(items(), rev, NOW).map(b => b.id)).toEqual(['b']);
    expect(B.eligible(items(), rev, NOW + 200 * DAY).map(b => b.id)).toEqual(['a', 'b', 'c']);
  });

  it('archive moves it to the Archive folder through Bookmarks.save and stops picking it', async () => {
    const B = await load('old-bookmark', 'VexOldBookmark');
    globalThis.Bookmarks = { items: items(), save: vi.fn() };
    B.archive('a');
    expect(Bookmarks.save).toHaveBeenCalled();
    const a = Bookmarks.items.find(b => b.id === 'a');
    expect(a.archived).toBe(true);
    expect(a.folder).toBe('Archive');
    expect(B.eligible(Bookmarks.items, B._read().reviewed, NOW).map(b => b.id)).toEqual(['b']);
    expect(() => B.archive('zzz')).toThrow(/gone/);
  });

  it('still good records the answer and signals', async () => {
    const B = await load('old-bookmark', 'VexOldBookmark');
    globalThis.Bookmarks = { items: items(), save: vi.fn() };
    const sig = [];
    document.addEventListener('vex:medal-signal', (e) => sig.push(e.detail.id));
    B.stillGood('b', NOW);
    expect(B._read().reviewed.b).toBe(NOW);
    expect(sig).toEqual(['old-bookmark-reviewed']);
  });

  it('builds nothing in the brief when no bookmark is old enough', async () => {
    const B = await load('old-bookmark', 'VexOldBookmark');
    globalThis.Bookmarks = { items: [{ id: 'c', url: 'https://c.example/', at: Date.now() }] };
    expect(B.section.build()).toBeNull();
  });
});

describe('mood themes', () => {
  function themes() {
    const tm = {
      availableThemes: ['oxford', 'sakura', 'sunset', 'midnight', 'honey', 'mocha', 'arctic', 'default'],
      THEMES: [{ id: 'oxford' }, { id: 'sakura', mock: { bg: '#ffeef3' } }, { id: 'sunset', mock: { bg: '#2a1410' } }, { id: 'midnight', mock: { bg: '#0b0b1a' } }, { id: 'honey' }, { id: 'mocha' }, { id: 'arctic' }, { id: 'default' }],
      currentTheme: 'default',
      applied: [],
      applyTheme(id, opts) {
        this.currentTheme = id; this.applied.push([id, opts]);
        document.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: id, userChoice: !(opts && opts.auto), ...(opts && opts.auto ? { auto: true } : {}) } }));
      },
    };
    globalThis.ThemeManager = tm; window.ThemeManager = tm;
    return tm;
  }
  const at = (h, m = 0, d = 16, mo = 9) => ({ getHours: () => h, getMinutes: () => m, getTime: () => new Date(2026, mo, d, h, m).getTime(), getMonth: () => mo, getDate: () => d, getFullYear: () => 2026 });

  it('works out the band for an hour, wrapping midnight', async () => {
    const M = await load('mood-themes', 'VexMoodTheme');
    const starts = { morning: 360, day: 600, evening: 1020, night: 1260 };
    expect(M.bandAt(5 * 60, starts)).toBe('night');
    expect(M.bandAt(6 * 60, starts)).toBe('morning');
    expect(M.bandAt(12 * 60, starts)).toBe('day');
    expect(M.bandAt(18 * 60, starts)).toBe('evening');
    expect(M.bandAt(23 * 60, starts)).toBe('night');
  });

  it('names the season and flips it in the southern hemisphere', async () => {
    const M = await load('mood-themes', 'VexMoodTheme');
    expect(M.seasonFor(new Date(2026, 0, 5))).toBe('winter');
    expect(M.seasonFor(new Date(2026, 3, 5))).toBe('spring');
    expect(M.seasonFor(new Date(2026, 9, 5))).toBe('autumn');
    expect(M.seasonFor(new Date(2026, 9, 5), true)).toBe('spring');
  });

  it('puts the band theme on through ThemeManager, flagged as automatic', async () => {
    const tm = themes();
    const M = await load('mood-themes', 'VexMoodTheme');
    M._clock = () => at(20);
    M.set({ mode: 'timeOfDay' });
    expect(tm.currentTheme).toBe('sunset');
    expect(tm.applied.at(-1)[1]).toEqual({ auto: true });
    M._clock = () => at(23);
    expect(M.evaluate()).toBe('midnight');
  });

  it('does nothing while Light and dark is on, and says so as an error for a seasonal week', async () => {
    const tm = themes();
    globalThis.ThemeAuto = { isOn: () => true, coords: () => null, isLightTheme: () => false };
    const M = await load('mood-themes', 'VexMoodTheme');
    M._clock = () => at(20);
    M.set({ mode: 'timeOfDay' });
    expect(tm.applied).toEqual([]);
    expect(() => M.startSeason('arctic')).toThrow(/Light and dark is on/);
  });

  it('a hand pick holds until the next band', async () => {
    const tm = themes();
    const M = await load('mood-themes', 'VexMoodTheme');
    M._clock = () => at(20);
    M.set({ mode: 'timeOfDay' });
    M.start();
    tm.applyTheme('mocha', {}); // the person picks by hand
    expect(M.state().held).toEqual({ band: 'evening' });
    M._clock = () => at(20, 30);
    expect(M.evaluate()).toBeNull();
    expect(tm.currentTheme).toBe('mocha');
    M._clock = () => at(22);
    expect(M.evaluate()).toBe('midnight');
    M.stop();
  });

  it('wears a seasonal theme for a week, then puts the earlier theme back', async () => {
    const tm = themes();
    const M = await load('mood-themes', 'VexMoodTheme');
    const start = new Date(2026, 9, 16, 12);
    M._clock = () => start;
    const s = M.startSeason('arctic', start);
    expect(tm.currentTheme).toBe('arctic');
    expect(s.prev).toBe('default');
    expect(s.until - s.from).toBe(7 * DAY);
    M._clock = () => new Date(start.getTime() + 8 * DAY);
    M.evaluate();
    expect(tm.currentTheme).toBe('default');
    expect(M.state().season).toBeNull();
  });

  it('leaves a hand-picked theme alone when the week ends', async () => {
    const tm = themes();
    const M = await load('mood-themes', 'VexMoodTheme');
    const start = new Date(2026, 9, 16, 12);
    M._clock = () => start;
    M.start();
    M.startSeason('arctic', start);
    tm.applyTheme('mocha', {});
    expect(M.state().season).toBeNull();
    M._clock = () => new Date(start.getTime() + 9 * DAY);
    M.evaluate();
    expect(tm.currentTheme).toBe('mocha');
    M.stop();
  });

  it('waits during Game mode', async () => {
    const tm = themes();
    globalThis.GameSession = { active: true };
    const M = await load('mood-themes', 'VexMoodTheme');
    M._clock = () => at(20);
    M.set({ mode: 'timeOfDay' });
    expect(tm.applied).toEqual([]);
    globalThis.GameSession.active = false;
    expect(M.evaluate()).toBe('sunset');
  });

  it('refuses an unknown theme and an unreadable time', async () => {
    themes();
    const M = await load('mood-themes', 'VexMoodTheme');
    expect(() => M.set({ mode: 'timeOfDay', themes: { ...M.DEFAULT_THEMES, night: 'nope' } })).toThrow(/Pick a theme/);
    expect(() => M.set({ mode: 'timeOfDay', starts: { ...M.DEFAULT_STARTS, day: '25:00' } })).toThrow(/time like/);
  });
});

describe('start widgets', () => {
  it('picks the same quote all day and a bundled one', async () => {
    const W = await load('start-widgets', 'VexWidgets');
    const d = new Date(2026, 9, 16, 8), e = new Date(2026, 9, 16, 22);
    expect(W.quoteOfDay(d)).toBe(W.quoteOfDay(e));
    expect(W.QUOTES).toContain(W.quoteOfDay(d));
    expect(W.QUOTES.length).toBeGreaterThanOrEqual(20);
  });

  it('counts days to and since a date', async () => {
    const W = await load('start-widgets', 'VexWidgets');
    const today = new Date(2026, 9, 16, 20);
    expect(W.countdownText(W.daysUntil(W.parseDay('2026-10-26'), today))).toBe('10 days to go');
    expect(W.countdownText(W.daysUntil(W.parseDay('2026-10-16'), today))).toBe('Today');
    expect(W.countdownText(W.daysUntil(W.parseDay('2026-10-15'), today))).toBe('1 day ago');
    expect(W.parseDay('2026-13-01')).toBeNull();
  });

  it('counts a streak that an untapped today does not break', async () => {
    const W = await load('start-widgets', 'VexWidgets');
    const today = new Date(2026, 9, 16);
    expect(W.streak(['2026-10-15', '2026-10-14', '2026-10-12'], today)).toBe(2);
    expect(W.streak(['2026-10-16', '2026-10-15'], today)).toBe(2);
    expect(W.streak([], today)).toBe(0);
  });

  it('keeps a shelf, validates, caps it and removes the data with the widget', async () => {
    const W = await load('start-widgets', 'VexWidgets');
    expect(W.list()).toEqual([]);
    const q = W.add('quote');
    const c = W.add('countdown', { label: 'Trip', date: '2026-12-24' });
    expect(() => W.add('countdown', { label: '', date: '2026-12-24' })).toThrow(/name/);
    expect(() => W.add('countdown', { label: 'x', date: 'later' })).toThrow(/YYYY-MM-DD/);
    expect(() => W.add('clock')).toThrow(/Unknown widget/);
    const h = W.add('habit', { label: 'Read' });
    expect(h.cfg.key).toBe('vex.startWidgets.habit.' + h.id);
    localStorage.setItem(h.cfg.key, '[]');
    W.move(h.id, -2);
    expect(W.list().map(x => x.id)[0]).toBe(h.id);
    W.update(c.id, { date: '2026-12-31' });
    expect(W.list().find(x => x.id === c.id).cfg.date).toBe('2026-12-31');
    W.remove(h.id);
    expect(localStorage.getItem(h.cfg.key)).toBeNull();
    expect(W.list().map(x => x.id)).toEqual([q.id, c.id]);
    for (let i = W.list().length; i < W.MAX; i++) W.add('quote');
    expect(() => W.add('quote')).toThrow(/widgets already/);
  });

  it('mounts each component into an element with the context it is given', async () => {
    const W = await load('start-widgets', 'VexWidgets');
    const store = new Map();
    const ctx = { now: () => new Date(2026, 9, 16, 9), storage: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => store.set(k, v) } };
    const mount = (w) => { const el = document.createElement('div'); document.body.appendChild(el); const h = W.mount(el, w, ctx); return { el, h }; };

    expect(mount({ type: 'quote' }).el.querySelector('blockquote').textContent.length).toBeGreaterThan(5);
    expect(mount({ type: 'countdown', cfg: { label: 'Trip', date: '2026-10-19' } }).el.textContent).toContain('3 days to go');

    const habit = mount({ type: 'habit', cfg: { label: 'Read', key: 'k1' } });
    const dots = habit.el.querySelectorAll('.vex-widget-dot');
    expect(dots.length).toBe(7);
    dots[6].click();
    expect(JSON.parse(store.get('k1'))).toEqual(['2026-10-16']);
    expect(habit.el.querySelectorAll('.vex-widget-dot.is-done').length).toBe(1);
    expect(habit.el.textContent).toContain('1 day in a row');
    habit.el.querySelectorAll('.vex-widget-dot')[6].click();
    expect(JSON.parse(store.get('k1'))).toEqual([]);

    store.set('p1', 'data:image/jpeg;base64,AAAA');
    expect(mount({ type: 'photo', cfg: { key: 'p1' } }).el.querySelector('img')).not.toBeNull();
    store.set('p2', 'javascript:alert(1)');
    expect(mount({ type: 'photo', cfg: { key: 'p2' } }).el.querySelector('img')).toBeNull();
    expect(() => W.mount(document.createElement('div'), { type: 'nope' })).toThrow(/Unknown widget/);
  });

  it('reports unreadable habit data instead of showing an empty one', async () => {
    const W = await load('start-widgets', 'VexWidgets');
    const ctx = { storage: { get: () => '{not json', set() {} } };
    expect(() => W.TYPES.habit.read(ctx, 'k')).toThrow(/could not be read/);
  });
});

describe('Little surprises settings and wiring', () => {
  it('has everything off by default and says what each one does', async () => {
    const D = await load('delights', 'VexDelights');
    const p = D.prefs();
    expect(Object.values(p).every(v => v === false)).toBe(true);
    expect(D.FEATURES.length).toBe(6);
    expect(D.FEATURES.every(f => f.info.length > 20)).toBe(true);
    expect(() => D.set('nope', true)).toThrow(/No such feature/);
  });

  it('registers brief sections gated by their switch and quiet in Game mode', async () => {
    const D = await load('delights', 'VexDelights');
    await load('time-capsule', 'VexTimeCapsule');
    await load('on-this-day', 'VexOnThisDay');
    await load('old-bookmark', 'VexOldBookmark');
    const reg = [];
    expect(D.registerAll({ register: (s) => reg.push(s) })).toBe(3);
    expect(reg.map(s => s.id).sort()).toEqual(['old-bookmark', 'on-this-day', 'time-capsule']);
    expect(reg.every(s => s.defaultOn === false)).toBe(true);
    const cap = reg.find(s => s.id === 'time-capsule');
    expect(await cap.build({})).toBeNull();           // switch is off
    D.set('capsule', true);
    window.vex = { reminders: { create: async () => ({ id: 'r' }), delete: async () => {}, ack: async () => {} } };
    await VexTimeCapsule.add({ url: 'https://a.example/', title: 'Pg', dueOn: '2026-10-20' }, new Date(2026, 9, 1));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21));
    const out = await cap.build({});
    expect(out.items[0].text).toBe('Pg');
    globalThis.GameSession = { active: true };
    expect(await cap.build({})).toBeNull();
    vi.useRealTimers();
  });

  it('adds its commands to the command bar once', async () => {
    const D = await load('delights', 'VexDelights');
    await load('rabbit-hole', 'VexRabbitHole');
    await load('time-capsule', 'VexTimeCapsule');
    await load('on-this-day', 'VexOnThisDay');
    await load('old-bookmark', 'VexOldBookmark');
    const bar = { commands: [] };
    expect(D.registerCommands(bar)).toBe(5);
    expect(D.registerCommands(bar)).toBe(0);
    expect(bar.commands.map(c => c.id).sort()).toEqual(['old-bookmark', 'on-this-day', 'rabbit-hole', 'time-capsule-new', 'time-capsule-open']);
    expect(bar.commands.every(c => c.label && c.hint && c.icon && typeof c.action === 'function')).toBe(true);
  });

  it('refuses a command while its feature is off', async () => {
    const D = await load('delights', 'VexDelights');
    const R = await load('rabbit-hole', 'VexRabbitHole');
    globalThis.TabManager = { createTab: vi.fn() };
    await R.command.action();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Little surprises'), 'error');
    expect(TabManager.createTab).not.toHaveBeenCalled();
    D.set('rabbit', true);
    expect(R.isEnabled()).toBe(true);
  });

  it('adds its own Settings group and a switch writes the preference', async () => {
    document.body.innerHTML = '<div id="panel-settings"><div class="panel-content"></div></div>';
    const D = await load('delights', 'VexDelights');
    await load('rabbit-hole', 'VexRabbitHole');
    expect(D.mountSettings()).toBe(true);
    expect(D.mountSettings()).toBe(false);
    const boxes = document.querySelectorAll('#delights-content input[type=checkbox]');
    expect(boxes.length).toBe(6);
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event('change'));
    expect(D.isOn('rabbit')).toBe(true);
    expect(document.querySelector('#delights-content').textContent).toContain('Forget what I marked');
  });

  it('turning mood themes off puts the earlier theme back', async () => {
    const tm = { availableThemes: ['default', 'arctic'], THEMES: [{ id: 'default' }, { id: 'arctic' }], currentTheme: 'default', applyTheme(id) { this.currentTheme = id; } };
    globalThis.ThemeManager = tm;
    const D = await load('delights', 'VexDelights');
    const M = await load('mood-themes', 'VexMoodTheme');
    D.set('mood', true);
    M.startSeason('arctic', new Date());
    expect(tm.currentTheme).toBe('arctic');
    D.set('mood', false);
    expect(tm.currentTheme).toBe('default');
    expect(M.state().season).toBeNull();
    expect(M.state().mode).toBe('off');
  });
});
