// @vitest-environment jsdom
//
// Wave 3, daily life: the pure parts and the storage of rituals, follow-ups, the two-minute drawer,
// weekday sets, the deadline ledger, travel mode, containers per site, expense capture, page
// reminders, holidays and TL equivalent.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const D = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

beforeEach(() => { localStorage.clear(); vi.resetModules(); });

describe('rituals', () => {
  let R;
  beforeEach(() => { ({ VexRituals: R } = fresh(JS + 'rituals.js')); });
  it('parses lines into commands and checks and names the bad line', () => {
    expect(R.parseLines('Plan => week-skeleton\nWater the plants')).toEqual([{ label: 'Plan', step: 'week-skeleton' }, { label: 'Water the plants' }]);
    expect(() => R.parseLines('=> x')).toThrow(/Line 1/);
    expect(() => R.parseLines('a =>')).toThrow(/nothing after/);
    expect(() => R.parseLines('  ')).toThrow(/at least one/);
  });
  it('counts a streak over its weekdays and does not break on today unfinished', () => {
    const r = R.make({ name: 'Sunday', days: [0], steps: [{ label: 'a' }], id: 'r1' });
    const sun = (d) => R.dayKey(new Date(2026, 9, d));            // 11 and 4 Oct 2026 are Sundays
    const log = { r1: { [sun(11)]: [0], [sun(4)]: [0] } };
    expect(R.streak(r, log, D(2026, 10, 14))).toBe(2);
    expect(R.streak(r, { r1: { [sun(4)]: [0] } }, D(2026, 10, 14))).toBe(0);
  });
  it('saves, marks steps and refuses an unknown command in strict mode', () => {
    globalThis.CommandBar = { commands: [{ id: 'due-now', label: 'Due', action: vi.fn() }] };
    const r = R.make({ name: 'Morning', steps: R.parseLines('Due => due-now\nStretch') });
    R.save(r);
    expect(R.list()).toHaveLength(1);
    expect(R.mark(r.id, 0, true)).toBe(false);
    expect(R.mark(r.id, 1, true)).toBe(true);
    expect(() => R.save(R.make({ name: 'Bad', steps: [{ label: 'x', step: 'nope' }] }))).toThrow(/not a command/);
    delete globalThis.CommandBar;
  });
  it('runAll names a failing step and still runs the rest', async () => {
    const ok = vi.fn();
    globalThis.CommandBar = { commands: [{ id: 'a', label: 'A', action: () => { throw new Error('boom'); } }, { id: 'b', label: 'B', action: ok }] };
    const r = R.make({ name: 'X', steps: R.parseLines('A => a\nB => b') });
    R.save(r);
    vi.useFakeTimers();
    const p = R.runAll(r);
    await vi.runAllTimersAsync();
    const problems = await p;
    vi.useRealTimers();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/boom/);
    expect(ok).toHaveBeenCalled();
    delete globalThis.CommandBar;
  });
});

describe('follow-ups', () => {
  let F;
  beforeEach(() => { ({ VexFollowUps: F } = fresh(JS + 'follow-ups.js')); });
  it('validates entries', () => {
    expect(() => F.make({ dir: 'waiting', what: 'form' })).toThrow(/who/);
    expect(() => F.make({ dir: 'owe', what: '' })).toThrow(/what/i);
    expect(() => F.make({ dir: 'owe', what: 'x', url: 'javascript:1' })).toThrow(/web address/);
    expect(F.make({ dir: 'owe', what: 'send it' }).channel).toBe('other');
  });
  it('resurfaces a waiting entry at 3 and 7 days, once each', () => {
    const now = D(2026, 10, 20);
    const it = F.make({ dir: 'waiting', who: 'Selin Kaya', what: 'the form', since: now - 3 * 86400000, now });
    expect(F.pending([it], now).map(x => x.stage)).toEqual([3]);
    it.nudged = 3;
    expect(F.pending([it], now)).toEqual([]);
    expect(F.pending([it], now + 4 * 86400000).map(x => x.stage)).toEqual([7]);
  });
  it('builds a nudge and stores entries; the tick marks them nudged', () => {
    const now = D(2026, 10, 20);
    const a = F.add({ dir: 'waiting', who: 'Selin Kaya', what: 'the form', since: now - 8 * 86400000, now });
    expect(F.nudgeText(a, now)).toMatch(/^Hi Selin,/);
    globalThis.VexAttention = { notify: vi.fn() };
    expect(F.tick(now)).toBe(1);
    expect(F.list()[0].nudged).toBe(7);
    expect(F.tick(now)).toBe(0);
    delete globalThis.VexAttention;
  });
  it('refuses unreadable storage instead of starting empty', () => {
    localStorage.setItem('vex.followUps', '{nope');
    expect(() => F.list()).toThrow(/could not be read/);
  });
});

describe('two-minute drawer', () => {
  let T;
  beforeEach(() => { ({ VexTwoMinute: T } = fresh(JS + 'quick-tasks.js')); });
  it('recognises and strips the tag', () => {
    expect(T.isTagged('call the bank #2min')).toBe(true);
    expect(T.isTagged('call #2minutes')).toBe(false);
    expect(T.strip('call the bank #2min @today')).toBe('call the bank @today');
  });
  it('picks only open tagged tasks, at most three', () => {
    const t = (text, done = false) => ({ text, done });
    expect(T.pick([t('a #2min'), t('b'), t('c #2m', true), t('d #2min'), t('e #2min'), t('f #2min')]).map(x => x.text)).toEqual(['a #2min', 'd #2min', 'e #2min']);
  });
  it('sends a tagged capture to the To-do note', () => {
    globalThis.OpenTasks = { add: vi.fn() };
    expect(T.addFromCapture('pay water #2min')).toMatch(/two-minute/);
    expect(OpenTasks.add).toHaveBeenCalledWith('pay water #2min');
    expect(() => T.addFromCapture('#2min')).toThrow(/before the tag/);
    delete globalThis.OpenTasks;
  });
});

describe('weekday set', () => {
  let W;
  beforeEach(() => { ({ VexWeekdaySet: W } = fresh(JS + 'weekday-set.js')); });
  it('normalizes without query, fragment or non-web addresses', () => {
    expect(W.normalize('https://Example.com/a/b/?q=1#x')).toBe('https://example.com/a/b');
    expect(W.normalize('file:///c:/x')).toBe('');
    expect(W.normalize('https://u:p@example.com/')).toBe('');
  });
  it('finds pages in 3 of the last 4 starts that weekday and needs three starts', () => {
    const mon = (d, urls) => [d, { wd: 1, urls }];
    const days = Object.fromEntries([mon('2026-09-14', ['a', 'b']), mon('2026-09-21', ['a', 'c']), mon('2026-09-28', ['a', 'b']), mon('2026-10-05', ['a', 'b'])]);
    expect(W.common(days, 1, '2026-10-12')).toEqual(['a', 'b']);
    expect(W.common({ '2026-09-14': days['2026-09-14'], '2026-09-21': days['2026-09-21'] }, 1, '2026-10-12')).toEqual([]);
  });
  it('notes only pages opened after start, once per day, and not private tabs', () => {
    W._start = Date.now(); W._recording = true; W._session = []; W._preexisting = new Set(['old']);
    expect(W.note('https://a.com/x?y=1', { id: 'old' })).toBe(false);
    expect(W.note('https://a.com/x?y=1', { id: 'n1' })).toBe(true);
    expect(W.note('https://b.com/', { id: 'n2', partition: 'tor-1' })).toBe(false);
    expect(W.note('https://a.com/x', { id: 'n3' })).toBe(false);
    const rec = W.load().days[W.dayKey(W._start)];
    expect(rec.urls).toEqual(['https://a.com/x']);
    expect(W.note('https://c.com/', { id: 'n4' }, W._start + 6 * 60 * 1000)).toBe(false);
  });
});

describe('deadline ledger', () => {
  let L;
  beforeEach(() => { ({ VexDeadlineLedger: L } = fresh(JS + 'deadline-ledger.js')); });
  const now = D(2026, 10, 16);
  it('counts days and the daily share with today counted', () => {
    const e = L.make({ title: 'Book', kind: 'book', due: '2026-10-26', unit: 'pages', total: 300, done: 100, now });
    expect(L.daysLeft(e, now)).toBe(10);
    expect(L.share(e, now)).toMatchObject({ left: 200, perDay: 20, unit: 'pages' });
    expect(L.label(e, now)).toBe('10 days left');
  });
  it('shows lateness and refuses bad input', () => {
    const e = L.make({ title: 'X', due: '2026-10-14', now });
    expect(L.label(e, now)).toBe('2 days late');
    expect(L.status(e, now)).toBe('late');
    expect(() => L.make({ title: 'X', due: '2026-02-31' })).toThrow(/not a day/);
    expect(() => L.make({ title: 'X', due: '2026-10-20', total: 5, done: 6 })).toThrow(/more than/);
  });
  it('sums the share per unit and feeds due-ness rows', () => {
    L.add({ title: 'A', due: '2026-10-18', unit: 'cards', total: 40, now });
    L.add({ title: 'B', due: '2026-10-17', unit: 'cards', total: 10, now });
    expect(L.dailyShare(now)).toEqual({ cards: 25 });
    expect(L._dueRows(now).map(r => r.kind)).toEqual(['deadline', 'deadline']);
  });
  it('adds a found deadline and moves progress', () => {
    const e = L.addFromFound({ dueAt: D(2026, 10, 30), sentence: 'Submit by Friday' });
    expect(e.due).toBe('2026-10-30');
    const b = L.add({ title: 'R', due: '2026-11-30', unit: 'pages', total: 50 });
    expect(L.setProgress(b.id, 10).work.done).toBe(10);
    expect(() => L.setProgress(b.id, 60)).toThrow(/between/);
    expect(() => L.setProgress(e.id, 1)).toThrow(/no amount/);
  });
});

describe('travel mode', () => {
  let V;
  beforeEach(() => { ({ VexTravel: V } = fresh(JS + 'travel-mode.js')); });
  it('sorts next departure first, untimed next, past last', () => {
    const now = D(2026, 10, 16);
    const mk = (title, dep) => V.make({ title, departAt: dep });
    const out = V.sortItems([mk('past', now - 5 * 3600000), mk('none', 0), mk('later', now + 5 * 3600000), mk('soon', now + 3600000)], now);
    expect(out.map(i => i.title)).toEqual(['soon', 'later', 'none', 'past']);
  });
  it('is due to leave inside the lead time', () => {
    const now = D(2026, 10, 16);
    const it = V.make({ title: 't', departAt: now + 30 * 60000 });
    expect(V.leaveDue(it, now, 60)).toBe(true);
    expect(V.leaveDue(it, now - 2 * 3600000, 60)).toBe(false);
  });
  it('reads a time zone and refuses a bad one', () => {
    expect(V.clock('Asia/Tokyo', D(2026, 10, 16)).there).toMatch(/\d\d:\d\d/);
    expect(() => V.clock('Mars/Base')).toThrow(/not a time zone/);
    expect(() => V.setTrip({ tz: 'nope' })).toThrow(/not a time zone/);
  });
  it('refuses a bad image and tells the attention state when switched', () => {
    expect(() => V.make({ title: 't', image: 'data:text/html;base64,AAAA' })).toThrow(/PNG/);
    globalThis.AttentionState = { changed: vi.fn() };
    V.setOn(true);
    expect(V.quiet()).toBe(true);
    expect(AttentionState.changed).toHaveBeenCalled();
    delete globalThis.AttentionState;
  });
  it('fires the leave notice once', () => {
    const now = D(2026, 10, 16);
    V.setOn(true);
    V.add({ title: 'Train', departAt: now + 20 * 60000 });
    globalThis.VexAttention = { notify: vi.fn() };
    expect(V.tick(now)).toBe(1);
    expect(V.tick(now)).toBe(0);
    expect(VexAttention.notify.mock.calls[0][0].urgency).toBe('asked');
    delete globalThis.VexAttention;
  });
});

describe('containers per site', () => {
  let C;
  beforeEach(() => { ({ VexContainerMemory: C } = fresh(JS + 'container-memory.js')); });
  it('finds the registrable domain', () => {
    expect(C.registrable('www.bank.com.tr')).toBe('bank.com.tr');
    expect(C.registrable('a.b.roblox.com')).toBe('roblox.com');
    expect(C.registrable('localhost')).toBe('');
    expect(C.registrable('127.0.0.1')).toBe('');
  });
  it('remembers container use only, and forgets on a main visit', () => {
    expect(C.note('https://www.bank.com.tr/x', 'persist:container-banking')).toBe(true);
    expect(C.suggest('https://login.bank.com.tr/')).toBe('persist:container-banking');
    expect(C.note('https://news.com/', 'persist:main')).toBe(false);
    expect(C.note('https://x.com/', 'tor-1')).toBe(false);
    expect(C.note('https://bank.com.tr/', undefined)).toBe(true);
    expect(C.suggest('https://bank.com.tr/')).toBe(null);
  });
  it('lets a site rule win and honours the off switch', () => {
    C.note('https://roblox.com/', 'persist:container-roblox');
    globalThis.SiteRoutes = { match: () => ({ host: 'roblox.com' }) };
    expect(C.suggest('https://roblox.com/')).toBe(null);
    delete globalThis.SiteRoutes;
    C.setEnabled(false);
    expect(C.suggest('https://roblox.com/')).toBe(null);
  });
  it('adds and removes presets, keeping Main', () => {
    C.addPreset({ name: 'Uni Mail' });
    expect(C.presets().some(p => p.partition === 'persist:container-uni-mail')).toBe(true);
    expect(() => C.addPreset({ name: 'Uni Mail' })).toThrow(/already/);
    expect(() => C.removePreset('persist:main')).toThrow(/Main/);
  });
});

describe('expense capture', () => {
  let X;
  beforeEach(() => { ({ VexExpenseCapture: X } = fresh(JS + 'expense-capture.js')); });
  it('spots a card number by the Luhn check and ignores prices', () => {
    expect(X.looksLikeCard('Card 4111 1111 1111 1111')).toBe(true);
    expect(X.looksLikeCard('Toplam 1.234,50 TL, order 1234567890123')).toBe(false);
  });
  it('ranks the amount beside "toplam" first', () => {
    const f = X.findAmounts('Ara toplam 800,00 TL\nKargo 20 TL\nGenel toplam 1.234,50 TL');
    expect(f[0].raw).toBe('1.234,50 TL');
    expect(f[0].currency).toBe('TRY');
  });
  it('guesses a category', () => {
    expect(X.guessCategory('www.migros.com.tr', '')).toBe('Groceries');
    expect(X.guessCategory('shop.example', 'sipariş')).toBe('Shopping');
    expect(X.guessCategory('x.example', '')).toBe('Other');
  });
  it('computes the month close and the category that rose most', () => {
    const { Expenses } = fresh(JS + 'expenses.js');
    const mk = (day, cents, category) => ({ id: day + category + cents, cents, category, day, note: '', at: 1 });
    const items = [mk('2026-09-03', 100000, 'Food'), mk('2026-09-10', 50000, 'Bills'), mk('2026-08-03', 80000, 'Food'), mk('2026-08-10', 50000, 'Bills')];
    const c = X.monthClose(items, '2026-09', Expenses);
    expect(c.total).toBe(150000);
    expect(c.mover).toMatchObject({ name: 'Food', pct: 25 });
    expect(X.closeLine(c, Expenses)).toMatch(/Food \+25%/);
  });
  it('opts a site in, and refuses to read while a field has focus', async () => {
    X.allowSite('shop.example');
    expect(X.sites()).toEqual(['shop.example']);
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'https://shop.example/ok', executeJavaScript: async () => ({ blocked: true }) }) };
    await expect(X.readSelection()).rejects.toThrow(/text box/);
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'https://shop.example/ok', executeJavaScript: async () => ({ blocked: false, text: 'card 4111 1111 1111 1111', title: 't' }) }) };
    await expect(X.readSelection()).rejects.toThrow(/card number/);
    delete globalThis.WebviewManager;
  });
});

describe('page reminders', () => {
  let P;
  const cmds = [{ id: 'due-now', label: 'Due' }];
  beforeEach(() => {
    ({ VexPageReminders: P } = fresh(JS + 'page-reminders.js'));
    globalThis.VexAttention = { notify: vi.fn((o, show) => show && show()) };
    window.showToast = vi.fn();
    P._tabUrl = new Map();
  });
  const add = (o) => { const r = P.make({ text: 'x', url: 'https://shop.example/order/1', trigger: 'visit', ...o }, cmds); const l = P.list(); l.push(r); P._save(l); return r; };
  it('validates triggers, schemes and command actions', () => {
    expect(() => P.make({ text: 'x', url: 'https://a.com', trigger: 'nope' })).toThrow(/Pick when/);
    expect(() => P.make({ text: 'x', url: 'file:///x', trigger: 'visit' })).toThrow(/web page/);
    expect(() => P.make({ text: 'x', url: 'https://a.com', trigger: 'visit', action: { kind: 'command', value: 'rm' } }, cmds)).toThrow(/not a command/);
  });
  it('fires "visit" on the next visit, not on the page it was made on', () => {
    const r = add({});
    expect(P.onNavigate('t1', 'https://shop.example/order/1?x=1', r.createdAt + 1000)).toHaveLength(0);
    expect(P.onNavigate('t1', 'https://other.example/', r.createdAt + 2000)).toHaveLength(0);
    expect(P.onNavigate('t1', 'https://shop.example/order/1', r.createdAt + 120000)).toHaveLength(1);
    expect(P.onNavigate('t1', 'https://x.example/', r.createdAt + 130000)).toHaveLength(0);
    expect(P.onNavigate('t1', 'https://shop.example/order/1', r.createdAt + 140000)).toHaveLength(0);
  });
  it('fires "leave" when the tab goes elsewhere', () => {
    add({ trigger: 'leave' });
    P.onNavigate('t1', 'https://shop.example/order/1');
    expect(P.onNavigate('t1', 'https://shop.example/order/1#top')).toHaveLength(0);
    expect(P.onNavigate('t1', 'https://elsewhere.example/')).toHaveLength(1);
  });
  it('fires "close" unless the page was marked done', () => {
    add({ trigger: 'close' });
    P.onNavigate('t1', 'https://shop.example/order/1');
    expect(P.onClose('t1')).toHaveLength(1);
    add({ trigger: 'close' });
    P.onNavigate('t2', 'https://shop.example/order/1');
    expect(P.markDone('https://shop.example/order/1')).toBe(1);
    expect(P.onClose('t2')).toHaveLength(0);
  });
  it('offers the action as a button and never runs it by itself', () => {
    const run = vi.fn();
    globalThis.CommandBar = { commands: [{ id: 'due-now', label: 'Due', action: run }] };
    add({ trigger: 'close', action: { kind: 'command', value: 'due-now' } });
    P.onNavigate('t1', 'https://shop.example/order/1');
    P.onClose('t1');
    expect(run).not.toHaveBeenCalled();
    expect(window.showToast.mock.calls[0][3].actions.some(a => /Run/.test(a.label))).toBe(true);
    delete globalThis.CommandBar;
  });
});

describe('holidays', () => {
  let H;
  beforeEach(() => { ({ VexHolidays: H } = fresh(JS + 'holidays.js')); });
  it('knows fixed and bundled movable holidays', () => {
    expect(H.on('2026-10-29').name).toBe('Cumhuriyet Bayramı');
    expect(H.on('2026-10-28').kind).toBe('half');
    expect(H.on('2026-05-28').name).toBe('Kurban Bayramı');
    expect(H.on('2026-06-02')).toBe(null);
    expect(H.hasMovable(2030)).toBe(false);
    expect(H.on('2030-10-29').kind).toBe('public');
  });
  it('treats weekends and holidays as off but a half day as work', () => {
    expect(H.isOff('2026-10-17')).toBe(true);     // Saturday
    expect(H.isOff('2026-10-29')).toBe(true);
    expect(H.isOff('2026-10-28')).toBe(false);
  });
  it('finds a bridge day', () => {
    // 1 May 2029 is a Tuesday: Monday 30 April is the bridge.
    expect(H.bridges('2029-04-23', '2029-05-06').map(b => b.date)).toEqual(['2029-04-30']);
  });
  it('parses whole-day events of an ics file only', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261231\r\nSUMMARY:Ara tatil\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20261201T090000Z\r\nSUMMARY:Meeting\r\nEND:VEVENT\r\nEND:VCALENDAR';
    expect(H.parseIcs(ics)).toEqual([{ date: '2026-12-31', name: 'Ara tatil' }]);
    expect(H.importIcs(ics)).toBe(1);
    expect(H.on('2026-12-31').kind).toBe('user');
    expect(() => H.importIcs('nothing')).toThrow(/no whole-day/);
  });
  it('gives Focus OS busy intervals and shifts to a workday', () => {
    const iv = H.busyIntervals(new Date(2026, 9, 28).getTime(), new Date(2026, 9, 29, 23).getTime());
    expect(iv).toHaveLength(2);
    expect(new Date(iv[0].start).getHours()).toBe(13);
    expect(new Date(H.shiftToWorkday(new Date(2026, 9, 29, 9).getTime())).getDate()).toBe(30);
  });
});

describe('TL equivalent', () => {
  let T;
  beforeEach(() => { ({ VexTl: T } = fresh(JS + 'tl-equivalent.js')); });
  it('reads amounts in both separator styles', () => {
    expect(T.toNumber('1,299.90')).toBe(1299.9);
    expect(T.toNumber('1.299,90')).toBe(1299.9);
    expect(T.toNumber('1,299')).toBe(1299);
    expect(T.toNumber('12,5')).toBe(12.5);
    expect(() => T.toNumber('abc')).toThrow(/not an amount/);
  });
  it('finds foreign prices and ignores lira', () => {
    const p = T.parsePrices('Now $29.99 or 25 EUR, was 1.200 TL');
    expect(p.map(x => [x.amount, x.currency])).toEqual([[29.99, 'USD'], [25, 'EUR']]);
  });
  it('converts with the selling rate and says when a rate is missing', () => {
    const rates = { date: '2026-10-16', source: 'TCMB', rates: { USD: { buying: 40, selling: 41 } } };
    expect(T.convert({ amount: 10, currency: 'USD' }, rates)).toBe(410);
    expect(() => T.convert({ amount: 1, currency: 'EUR' }, rates)).toThrow(/no EUR rate/);
  });
  it('stores a rate by hand with today\'s date and refuses nonsense', () => {
    const r = T.setManual('USD', '41,25', new Date(2026, 9, 16));
    expect(r).toMatchObject({ date: '2026-10-16', source: 'manual' });
    expect(T.rates().rates.USD.selling).toBe(41.25);
    expect(() => T.setManual('XXX', '1')).toThrow(/Unknown currency/);
    expect(() => T.setManual('USD', '0')).toThrow();
  });
  it('fetches only through the bridge and saves what it returns', async () => {
    window.vex = { fxTcmb: vi.fn(async () => ({ date: '2026-10-15', rates: { USD: { buying: 40, selling: 41 }, EUR: { buying: 44, selling: 45 } }, fetchedAt: 1 })) };
    await T.fetchToday();
    expect(T.rates().source).toBe('TCMB');
    window.vex = { fxTcmb: async () => ({ date: 'bad' }) };
    await expect(T.fetchToday()).rejects.toThrow(/no usable/);
    delete window.vex;
  });
});

describe('due-ness sources', () => {
  it('adds kinds with a label and reads them in collect()', async () => {
    const { VexDueness: Du } = fresh(JS + 'dueness.js');
    const now = D(2026, 10, 16);
    Du.addSource('t', { kind: 'deadline', label: 'Deadline' }, () => [{ id: 'd1', text: 'Exam', at: new Date(2026, 9, 17).getTime(), hasTime: false }]);
    const out = await Du.collect(now, { reminders: async () => [], tasks: () => [], events: () => [], schedule: () => [] });
    expect(out.items.map(i => i.kind)).toContain('deadline');
    expect(Du.KIND_LABEL.deadline).toBe('Deadline');
    expect(Du.rank(out.items, now)[0].text).toBe('Exam');
  });
  it('names a source that cannot be read and keeps the others', async () => {
    const { VexDueness: Du } = fresh(JS + 'dueness.js');
    Du.addSource('bad', { kind: 'followup', label: 'Follow-up' }, () => { throw new Error('broken'); });
    const out = await Du.collect(D(2026, 10, 16), { reminders: async () => [], tasks: () => [], events: () => [], schedule: () => [] });
    expect(out.errors.join(' ')).toMatch(/bad: broken/);
  });
});
