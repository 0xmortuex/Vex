// @vitest-environment jsdom
//
// Wave 2 "games and daily life": scenes, loadouts, the GCC follower, the intent
// gate, break prompts, orders, exam dates and the receipt locker. Pure rules and
// the wiring that matters; no network, no real windows.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const DAY = 86400000;

function load() {
  localStorage.clear();
  vi.resetModules();
  for (const g of ['GameSession', 'MasterVolume', 'PatchRadar', 'GameMode', 'FocusProfiles', 'VexLedger', 'VexAttention', 'ExamCalendar', 'AttentionState', 'FocusMode', 'VexJobs', 'VexSettingsGroups']) delete globalThis[g];
  globalThis.VexLifeKit = fresh(JS + 'life-kit.js').VexLifeKit;
  globalThis.reminders = [];
  window.vex = { reminders: { create: vi.fn(async (message, at) => { const id = 'r' + (globalThis.reminders.length + 1); globalThis.reminders.push({ id, message, at }); return { id }; }), delete: vi.fn(async () => true) }, pipMemory: vi.fn(async () => ({ ok: true })) };
  window.vexConfirm = vi.fn(async () => true);
  window.VexProblems = { note: vi.fn() };
}
beforeEach(load);

describe('VexLifeKit days', () => {
  it('parses real dates only', () => {
    expect(VexLifeKit.dayString(VexLifeKit.parseDay('2026-10-16'))).toBe('2026-10-16');
    expect(() => VexLifeKit.parseDay('2026-02-30')).toThrow(/real date/);
    expect(() => VexLifeKit.parseDay('16.10.2026')).toThrow(/year-month-day/);
  });
  it('counts whole days and says them', () => {
    const now = new Date(2026, 9, 16, 15).getTime();
    expect(VexLifeKit.daysLeft(VexLifeKit.parseDay('2026-10-19'), now)).toBe(3);
    expect(VexLifeKit.words(0)).toBe('today');
    expect(VexLifeKit.words(-2)).toBe('2 days ago');
  });
  it('refuses a reminder in the past', async () => {
    await expect(VexLifeKit.remind('x', new Date(2020, 0, 1).getTime())).rejects.toThrow(/already passed/);
  });
  it('raises on unreadable saved data instead of replacing it', () => {
    localStorage.setItem('vex.orders', '{nope');
    expect(() => VexLifeKit.read('vex.orders', [])).toThrow(/could not be read/);
  });
});

describe('Game audio scenes (T2-059)', () => {
  let level;
  beforeEach(() => {
    level = 1;
    globalThis.MasterVolume = { level: () => level, apply: vi.fn((v) => { level = v; }) };
    globalThis.GameSession = { exeKey: (v) => String(v).toLowerCase().replace(/\.exe$/, ''), active: false };
    window.GameScenes = globalThis.GameScenes = fresh(JS + 'game-scenes.js').GameScenes;
  });
  it('does nothing until switched on', () => {
    GameScenes.setScene('g1', { volume: 20 });
    expect(GameScenes.apply('g1', 'Foo')).toBe(false);
    expect(MasterVolume.apply).not.toHaveBeenCalled();
  });
  it('sets the scene, then puts the volume back at the end', () => {
    GameScenes.setEnabled(true);
    GameScenes.setScene('g1', { volume: 20 });
    expect(GameScenes.apply('g1', 'Foo')).toBe(true);
    expect(level).toBeCloseTo(0.2);
    expect(GameScenes.restore()).toBeTruthy();
    expect(level).toBe(1);
    expect(localStorage.getItem(GameScenes.PRIOR_KEY)).toBeNull();
  });
  it('mutes as level 0 and keeps the very first level across two games', () => {
    GameScenes.setEnabled(true);
    GameScenes.setScene('a', { mute: true });
    GameScenes.setScene('b', { volume: 50 });
    GameScenes.apply('a'); GameScenes.apply('b');
    GameScenes.restore();
    expect(level).toBe(1);
  });
  it('leaves a slider the person moved during the game alone', () => {
    GameScenes.setEnabled(true);
    GameScenes.setScene('g1', { volume: 20 });
    GameScenes.apply('g1');
    level = 0.7;
    expect(GameScenes.restore()).toBe(false);
    expect(level).toBe(0.7);
  });
  it('validates a scene and tells the floating video about the game', async () => {
    expect(() => GameScenes.setScene('g', { volume: 900 })).toThrow(/0 to 500/);
    expect(() => GameScenes.setScene('', {})).toThrow(/Choose a game/);
    GameScenes.setEnabled(true);
    GameScenes.setHideOverGame(true);
    window.vex.pipMemory.mockClear();
    GameScenes.onGame({ active: true, gameId: 'g1', app: 'Foo.exe' });
    expect(window.vex.pipMemory).toHaveBeenLastCalledWith({ context: 'foo', hideOverGame: true });
    GameScenes.onGame({ active: false });
    expect(window.vex.pipMemory).toHaveBeenLastCalledWith({ context: '', hideOverGame: true });
  });
});

describe('Loadout cards and stale flag (T2-069)', () => {
  beforeEach(() => { window.GameLoadouts = globalThis.GameLoadouts = fresh(JS + 'game-loadouts.js').GameLoadouts; });
  it('flags a card only when a patch came after it was checked', () => {
    const card = { createdAt: 1000, verifiedAt: 2000 };
    expect(GameLoadouts.isStale(card, { at: 3000, label: '1.5' })).toBe(true);
    expect(GameLoadouts.isStale(card, { at: 1500 })).toBe(false);
    expect(GameLoadouts.isStale(card, null)).toBe(false);
  });
  it('validates a card', () => {
    expect(() => GameLoadouts.cleanCard({ title: '', gameId: 'g' })).toThrow(/name/);
    expect(() => GameLoadouts.cleanCard({ title: 't', gameId: '' })).toThrow(/game/);
    expect(() => GameLoadouts.cleanCard({ title: 't', gameId: 'g', source: 'ftp://x' })).toThrow(/http/);
    expect(() => GameLoadouts.cleanCard({ title: 't', gameId: 'g', items: Array(40).fill('a') })).toThrow(/up to 30/);
    const c = GameLoadouts.cleanCard({ title: 't', gameId: 'g', items: 'a\n\nb', source: 'https://x.test/b' });
    expect(c.items).toEqual(['a', 'b']);
  });
  it('stores, verifies against the current patch, and goes stale after a new one', () => {
    globalThis.PatchRadar = { pages: () => [{ changedAt: 5000, latest: 'Patch 1.6' }] };
    const c = GameLoadouts.add({ title: 'Tank', gameId: 'g' });
    expect(GameLoadouts.patchInfo('g')).toEqual({ at: 5000, label: 'Patch 1.6' });
    expect(GameLoadouts.isStale(c, GameLoadouts.patchInfo('g'))).toBe(false);     // created now, after the patch
    globalThis.PatchRadar = { pages: () => [{ changedAt: Date.now() + 5000, latest: 'Patch 1.7' }] };
    expect(GameLoadouts.isStale(GameLoadouts.all()[0], GameLoadouts.patchInfo('g'))).toBe(true);
    const v = GameLoadouts.verify(c.id, Date.now() + 10000);
    expect(v.verifiedPatch).toBe('Patch 1.7');
    expect(GameLoadouts.isStale(v, GameLoadouts.patchInfo('g'))).toBe(false);
  });
  it('lists a card source as a second-screen page after the guide pages', () => {
    globalThis.GameSession = { pages: () => [{ title: 'Guide', url: 'https://a.test/' }] };
    GameLoadouts.add({ title: 'Tank', gameId: 'g', source: 'https://b.test/x' });
    expect(GameLoadouts.pagesFor('g').map(p => p.url)).toEqual(['https://a.test/', 'https://b.test/x']);
  });
});

describe('Game Control Center follower (T2-068)', () => {
  let bridge;
  beforeEach(() => {
    globalThis.GameSession = { exeKey: (v) => String(v).toLowerCase(), active: false, onState: vi.fn(function (s) { this.active = !!s.game; }) };
    globalThis.GameMode = { _m: 'auto', mode() { return this._m; }, setMode(m) { this._m = m; } };
    globalThis.FocusProfiles = { setExternalGame: vi.fn() };
    window.VexGccBridge = globalThis.VexGccBridge = bridge = fresh(JS + 'gcc-bridge.js').VexGccBridge;
  });
  const st = (over) => ({ present: true, stale: false, game: { name: 'G', exe: 'g.exe', running: true }, profile: 'Comp', streamer: false, capture: false, clipsDir: 'C:\\v', recentClips: [{ file: 'a.mp4', game: 'G', session: 's', at: 1 }], ...over });
  it('does nothing while off', async () => {
    window.vex.gccBridgeRead = vi.fn();
    expect(await bridge.tick()).toBeNull();
    expect(window.vex.gccBridgeRead).not.toHaveBeenCalled();
  });
  it('starts Game mode once for a running game and ends it when GCC says it stopped', async () => {
    VexLifeKit.setFlag(bridge.ON_KEY, true);
    window.vex.gccBridgeRead = vi.fn().mockResolvedValue(st());
    await bridge.tick(); await bridge.tick();
    expect(GameSession.onState).toHaveBeenCalledTimes(1);
    expect(FocusProfiles.setExternalGame).toHaveBeenCalledWith(true, 'g.exe');
    window.vex.gccBridgeRead.mockResolvedValue(st({ game: { name: 'G', exe: 'g.exe', running: false } }));
    await bridge.tick();
    expect(GameSession.onState).toHaveBeenLastCalledWith({ game: false });
    expect(FocusProfiles.setExternalGame).toHaveBeenLastCalledWith(false, '');
  });
  it('leaves a game Vex already noticed to Vex\'s own watcher', async () => {
    VexLifeKit.setFlag(bridge.ON_KEY, true);
    GameSession.active = true;
    window.vex.gccBridgeRead = vi.fn().mockResolvedValue(st());
    await bridge.tick();
    expect(GameSession.onState).not.toHaveBeenCalled();
  });
  it('follows streaming and puts the mode back, but not over the person\'s change', async () => {
    VexLifeKit.setFlag(bridge.ON_KEY, true);
    window.vex.gccBridgeRead = vi.fn().mockResolvedValue(st({ streamer: true }));
    await bridge.tick();
    expect(GameMode.mode()).toBe('on');
    window.vex.gccBridgeRead.mockResolvedValue(st({ streamer: false }));
    await bridge.tick();
    expect(GameMode.mode()).toBe('auto');
    window.vex.gccBridgeRead.mockResolvedValue(st({ streamer: true }));
    await bridge.tick();
    GameMode._m = 'off';                                   // the person turned it off meanwhile
    window.vex.gccBridgeRead.mockResolvedValue(st({ streamer: false }));
    await bridge.tick();
    expect(GameMode.mode()).toBe('off');
  });
  it('exposes the profile, clips folder and a clip\'s game, and reports a bad file once', async () => {
    VexLifeKit.setFlag(bridge.ON_KEY, true);
    window.vex.gccBridgeRead = vi.fn().mockResolvedValue(st());
    await bridge.tick();
    expect(bridge.profile()).toBe('Comp');
    expect(bridge.clipsDir()).toBe('C:\\v');
    expect(bridge.clipInfo('A.MP4')).toEqual({ game: 'G', session: 's' });
    window.vex.gccBridgeRead.mockRejectedValue(new Error('bad file'));
    await bridge.tick(); await bridge.tick();
    expect(window.VexProblems.note).toHaveBeenCalledTimes(1);
    expect(bridge.snapshot().state).toBe('error');
  });
  it('putting it off restores streamer mode', async () => {
    VexLifeKit.setFlag(bridge.ON_KEY, true);
    window.vex.gccBridgeRead = vi.fn().mockResolvedValue(st({ streamer: true }));
    await bridge.tick();
    bridge.setEnabled(false);
    expect(GameMode.mode()).toBe('auto');
  });
});

describe('Intent gate (T2-007)', () => {
  beforeEach(() => { window.IntentGate = globalThis.IntentGate = fresh(JS + 'intent-gate.js').IntentGate; });
  it('keeps a clean, bounded host list and matches subdomains only', () => {
    expect(IntentGate.setHosts(['https://www.Reddit.com/r/x', 'x.com', 'reddit.com'])).toEqual(['reddit.com', 'x.com']);
    expect(() => IntentGate.setHosts(['not a site'])).toThrow(/not a site address/);
    expect(IntentGate.listed('https://old.reddit.com/a')).toBe('reddit.com');
    expect(IntentGate.listed('https://notreddit.com/')).toBe('');
    expect(IntentGate.listed('vex://settings')).toBe('');
  });
  it('an answer is a pass; leaving is not; skipping lets you in longer', () => {
    IntentGate.setHosts(['x.com']);
    const t = 1_000_000;
    expect(IntentGate.record('x.com', 'five', t).until).toBe(t + 5 * 60000);
    expect(IntentGate.passActive('x.com', t + 1000)).toBe(true);
    expect(IntentGate.passActive('x.com', t + 6 * 60000)).toBe(false);
    IntentGate.record('x.com', 'skip', t);
    expect(IntentGate.data().passes['x.com'].until).toBe(t + 15 * 60000);
    IntentGate.record('y.com', 'leave', t);
    expect(IntentGate.data().passes['y.com']).toBeUndefined();
    expect(() => IntentGate.record('x.com', 'maybe')).toThrow(/Unknown/);
    expect(IntentGate.stats(t).asked).toBe(3);
  });
  it('asks once, only when on, and only for the tab in front', () => {
    IntentGate.setHosts(['x.com']);
    const wv = {};
    globalThis.TabManager = { activeTabId: 't1' };
    const ask = vi.spyOn(IntentGate, 'ask').mockResolvedValue('five');
    IntentGate.onNavigate(wv, 'https://x.com/', { id: 't1' });
    expect(ask).not.toHaveBeenCalled();                    // off
    IntentGate.setEnabled(true);
    IntentGate.onNavigate(wv, 'https://x.com/', { id: 't2' });
    expect(ask).not.toHaveBeenCalled();                    // a background tab
    IntentGate.onNavigate(wv, 'https://x.com/', { id: 't1' });
    IntentGate.onNavigate(wv, 'https://x.com/', { id: 't1' });
    expect(ask).toHaveBeenCalledTimes(1);                  // not twice while asking
  });
  it('leaving goes back; the question has no way to trap you', async () => {
    IntentGate.setHosts(['x.com']);
    IntentGate.setEnabled(true);
    globalThis.TabManager = { activeTabId: 't1' };
    const wv = { canGoBack: () => true, goBack: vi.fn() };
    vi.spyOn(IntentGate, 'ask').mockResolvedValue('leave');
    IntentGate.onNavigate(wv, 'https://x.com/', { id: 't1' });
    await Promise.resolve(); await Promise.resolve();
    expect(wv.goBack).toHaveBeenCalled();
  });
});

describe('Break prompts (T2-036)', () => {
  let B;
  beforeEach(() => { window.BreakPrompts = globalThis.BreakPrompts = B = fresh(JS + 'break-prompts.js').BreakPrompts; B._activeMs = 0; B._lastInput = 0; B._lastTick = 0; B._lastPrompt = 0; B._firedEye = B._firedStretch = false; });
  it('picks the break for the active time, once per run', () => {
    const p = { eyeMin: 20, stretchMin: 90 };
    expect(B.due(10 * 60000, p, {})).toBeNull();
    expect(B.due(21 * 60000, p, {})).toBe('eye');
    expect(B.due(21 * 60000, p, { eye: true })).toBeNull();
    expect(B.due(95 * 60000, p, { eye: true })).toBe('stretch');
  });
  it('validates settings', () => {
    expect(() => B.setPrefs({ eyeMin: 5, stretchMin: 90 })).toThrow(/10 to 60/);
    expect(() => B.setPrefs({ eyeMin: 20, stretchMin: 500 })).toThrow(/45 to 180/);
  });
  it('counts only real use, waits for a pause, and restarts after being away', () => {
    B.setEnabled(true);
    const prompt = vi.spyOn(B, 'prompt').mockImplementation(() => {});
    let t = 10_000_000;
    B.noteInput(t);
    for (let i = 0; i < 90; i++) { t += 15000; B.noteInput(t - 1000); B.tick(t); }      // 22 min of typing, never paused
    expect(prompt).not.toHaveBeenCalled();                                              // no natural pause yet
    t += 5000;                                                                          // a 5 s pause
    expect(B.tick(t)).toBe('prompted');
    expect(prompt).toHaveBeenCalledWith('eye');
    t += 6 * 60000;
    expect(B.tick(t)).toBe('away');
    expect(B._activeMs).toBe(0);
  });
  it('is held in a bad moment and queues nothing', () => {
    B.setEnabled(true);
    globalThis.GameSession = { active: true };
    const prompt = vi.spyOn(B, 'prompt').mockImplementation(() => {});
    B._activeMs = 25 * 60000; B._lastInput = 1; B._lastTick = 1_000_000 - 15000;
    expect(B.tick(1_000_000)).toBe('held:Game mode');
    expect(prompt).not.toHaveBeenCalled();
    delete globalThis.GameSession;
    globalThis.ExamCalendar = { enabled: () => true, examToday: () => true };
    expect(B.heldBecause()).toBe('an exam day');
  });
  it('counts what happened to a card', () => {
    const card = B.showCard('eye', 'x');
    card.querySelectorAll('button')[0].click();
    expect(B.today().taken).toBe(1);
    expect(document.querySelector('.vex-break-card')).toBeNull();
  });
});

describe('Orders hub (T2-073)', () => {
  beforeEach(() => { window.OrdersHub = globalThis.OrdersHub = fresh(JS + 'orders-hub.js').OrdersHub; });
  it('validates and builds only the carrier\'s public page', () => {
    const o = OrdersHub.clean({ carrier: 'yurtici', number: '1234567890', label: 'Shoes' });
    expect(OrdersHub.trackUrl(o)).toMatch(/^https:\/\/www\.yurticikargo\.com\//);
    expect(() => OrdersHub.clean({ carrier: 'aras', number: 'x y', label: 'a' })).toThrow(/tracking number/);
    expect(() => OrdersHub.clean({ carrier: 'other', number: '', label: 'a', link: 'javascript:1' })).toThrow(/http/);
    expect(() => OrdersHub.clean({ carrier: 'ptt', number: 'RR123456789TR', label: '' })).toThrow(/what it is/);
    expect(OrdersHub.guessCarrier('RR123456789TR')).toBe('ptt');
    expect(OrdersHub.guessCarrier('1234567890')).toBe('');
  });
  it('sets the reminders asked for, one per date, and removes them with the order', async () => {
    const now = new Date(2026, 9, 16, 8).getTime();
    const r = await OrdersHub.add({ carrier: 'ptt', number: 'RR123456789TR', label: 'Book', holdDay: '2026-10-25', refundDay: '2026-11-10' }, now);
    expect(r.failed).toEqual([]);
    expect(globalThis.reminders).toHaveLength(2);
    expect(r.order.remindIds).toHaveLength(2);
    await OrdersHub.markDelivered(r.order.id);
    expect(window.vex.reminders.delete).toHaveBeenCalledTimes(2);
    expect(OrdersHub.all()[0].status).toBe('delivered');
  });
  it('reports a reminder that cannot be set instead of hiding it', async () => {
    const now = new Date(2026, 9, 16, 8).getTime();
    const r = await OrdersHub.add({ carrier: 'ptt', number: 'RR123456789TR', label: 'Book', holdDay: '2026-10-16' }, now);
    expect(r.failed[0]).toMatch(/already passed/);
  });
  it('Track opens a tab and flags old open parcels', () => {
    globalThis.TabManager = { createTab: vi.fn() };
    const o = OrdersHub.clean({ carrier: 'aras', number: 'ABC12345', label: 'x', added: 1 });
    OrdersHub.track(o);
    expect(TabManager.createTab).toHaveBeenCalledWith(expect.stringContaining('araskargo.com.tr'), true);
    localStorage.setItem(OrdersHub.KEY, JSON.stringify({ v: 1, orders: [{ ...o, added: Date.now() - 20 * DAY }] }));
    expect(OrdersHub.list()[0].old).toBe(true);
  });
});

describe('Exam calendar (T2-085)', () => {
  beforeEach(() => { window.ExamCalendar = globalThis.ExamCalendar = fresh(JS + 'exam-calendar.js').ExamCalendar; });
  const ICS = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a1', 'SUMMARY:YKS application\\, opens', 'DTSTART;VALUE=DATE:20270202', 'DTEND;VALUE=DATE:20270209',
    'DESCRIPTION:Check osym.gov.tr', 'URL:https://example.test/x', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:a2', 'SUMMARY:Exam', 'DTSTART:20270620T070000Z', 'END:VEVENT', 'BEGIN:VEVENT', 'SUMMARY:No date', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  it('reads an .ics file: all-day end is the day before, folded lines are joined', () => {
    const ev = ExamCalendar.parseIcs(ICS.replace('Check osym', 'Check\r\n  osym'));
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ uid: 'a1', title: 'YKS application, opens', day: '2027-02-02', endDay: '2027-02-08' });
    expect(ev[0].note).toBe('Check osym.gov.tr');
    expect(ev[1].day).toMatch(/^2027-06-2[01]$/);
    expect(() => ExamCalendar.parseIcs('hello')).toThrow(/not a calendar/);
    expect(() => ExamCalendar.parseIcs('BEGIN:VCALENDAR' + 'x'.repeat(ExamCalendar.MAX_ICS_BYTES))).toThrow(/too large/);
  });
  it('validates an item', () => {
    expect(() => ExamCalendar.clean({ title: 'x', day: '2027-02-10', endDay: '2027-02-01' })).toThrow(/before/);
    expect(() => ExamCalendar.clean({ title: 'x', day: '2027-13-01' })).toThrow();
    expect(() => ExamCalendar.clean({ title: 'x', day: '2027-02-10', url: 'ftp://a' })).toThrow(/http/);
    expect(ExamCalendar.clean({ title: 'x', day: '2027-02-10', body: 'osym' }).body).toBe('osym');
  });
  it('sets reminders for the opening and the closing, only for mornings still ahead', async () => {
    const now = new Date(2027, 0, 30, 10).getTime();
    const r = await ExamCalendar.add({ title: 'YKS application', kind: 'application', body: 'osym', day: '2027-02-02', endDay: '2027-02-08' }, { now });
    expect(r.failed).toEqual([]);
    // opens: 7 days (passed), 1 day (Feb 1), today (Feb 2); closes: 7 days (Feb 1), 1 day (Feb 7), today (Feb 8)
    expect(globalThis.reminders).toHaveLength(6);
    expect(globalThis.reminders[0].message).toMatch(/Check the official site \(OSYM\)/);
  });
  it('import asks first, skips what is already there, and never fetches', async () => {
    const now = Date.now();
    const text = ICS.replace(/2027/g, String(new Date(now).getFullYear() + 2));
    const r1 = await ExamCalendar.importIcs(text, 'osym');
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(r1.added).toBe(2);
    const r2 = await ExamCalendar.importIcs(text, 'osym');
    expect(r2.added).toBe(0);
    expect(r2.skipped).toBe(2);
    expect(ExamCalendar.sorted()).toHaveLength(2);
  });
  it('knows an exam day', () => {
    const today = VexLifeKit.dayString(Date.now());
    localStorage.setItem(ExamCalendar.KEY, JSON.stringify({ v: 1, items: [{ id: 'e', kind: 'exam', day: today, endDay: '', title: 'x', body: 'meb', remindIds: [] }] }));
    expect(ExamCalendar.examToday()).toBe(true);
  });
  it('the source never fetches or signs in', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/exam-calendar.js'), 'utf8');
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|VexNet|webview/);
  });
});

describe('Receipt locker (T2-086)', () => {
  beforeEach(() => { window.ReceiptLocker = globalThis.ReceiptLocker = fresh(JS + 'receipt-locker.js').ReceiptLocker; });
  it('works out the return window and warranty end', () => {
    const r = ReceiptLocker.clean({ store: 'Shop', product: 'Kettle', boughtDay: '2026-10-01', warrantyMonths: '24' });
    expect(r.returnEnd).toBe('2026-10-15');
    expect(r.warrantyEnd).toBe('2028-10-01');
    expect(ReceiptLocker.clean({ store: 's', product: 'p', boughtDay: '2026-10-01', returnDays: '0' }).returnEnd).toBe('');
    const now = new Date(2026, 9, 12, 12).getTime();
    expect(ReceiptLocker.returnState(r, now)).toMatch(/closes in 3 days/);
    expect(ReceiptLocker.returnState(r, new Date(2026, 9, 20).getTime())).toMatch(/closed 5 days ago/);
  });
  it('refuses bad input', () => {
    expect(() => ReceiptLocker.clean({ store: '', product: 'p', boughtDay: '2026-10-01' })).toThrow(/shop/);
    expect(() => ReceiptLocker.clean({ store: 's', product: 'p', boughtDay: '2026-10-01', returnDays: '-3' })).toThrow(/0 to 365/);
    expect(() => ReceiptLocker.clean({ store: 's', product: 'p', boughtDay: '2026-10-01', filePath: 'relative.pdf' })).toThrow(/full path/);
    expect(() => ReceiptLocker.clean({ store: 's', product: 'p', boughtDay: 'soon' })).toThrow(/year-month-day/);
  });
  it('sets 3 / 30 / 7 day reminders, keeps only facts, and the entry removal deletes them', async () => {
    const now = new Date(2026, 9, 2, 8).getTime();
    const r = await ReceiptLocker.add({ store: 'Shop', product: 'Kettle', boughtDay: '2026-10-01', warrantyMonths: '24', filePath: 'C:\\Receipts\\k.pdf' }, now);
    expect(r.failed).toEqual([]);
    expect(globalThis.reminders).toHaveLength(3);
    expect(Object.keys(r.item)).not.toContain('content');
    expect(r.item.filePath).toBe('C:\\Receipts\\k.pdf');
    await ReceiptLocker.remove(r.item.id);
    expect(window.vex.reminders.delete).toHaveBeenCalledTimes(3);
    expect(ReceiptLocker.all()).toEqual([]);
  });
  it('never reads or uploads the file', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/receipt-locker.js'), 'utf8');
    expect(src).not.toMatch(/FileReader|\.text\(\)|\bfetch\(|readFile/);
  });
});

describe('registration', () => {
  it('every new feature has a manifest and a usage adapter', () => {
    const manifests = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/feature-manifests.js'), 'utf8');
    const usage = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/vex-usage-registry.js'), 'utf8');
    for (const id of ['second-screen', 'game-scenes', 'gcc-bridge', 'game-loadouts', 'intent-gate', 'break-prompts', 'orders-hub', 'exam-calendar', 'receipt-locker']) {
      expect(manifests).toContain("id: '" + id + "'");
      expect(usage).toContain("['" + id + "'");
    }
  });
});
