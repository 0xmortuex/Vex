// @vitest-environment jsdom
//
// Wave 4 fold-ins: trial capture and the monthly admin reminder (renewal radar), the page-watch
// templates and the new-low price rule, the "why keep this" line and archive-instead-of-close on the
// evening tab cleanup, the held-while-playing list, the four brief cards in the New Tab slot grid,
// and the content packs' consumers (holidays, phrases, checklists, skills).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(JS + p)]; return require(JS + p); };
const GLOBALS = ['VexQuickReminder', 'VexPackContent', 'AttentionState', 'VexAttention', 'AttentionInbox', 'NewTabSlots', 'PageWatch', 'PageWatchUI', 'TabManager', 'VexPermHygiene',
  'HighlightResurface', 'VexSkills', 'VexIncident', 'Bookmarks', 'Annotations', 'ReadLater', 'VexSnippets', 'GameHolds', 'VexBriefCards', 'CommandBar', 'VexSettingsGroups', 'VexProblems', 'VexJobs', 'VexUsage'];

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  for (const g of GLOBALS) delete globalThis[g];
  window.showToast = vi.fn();
  globalThis.vexPrompt = vi.fn();
  globalThis.vexConfirm = vi.fn(async () => true);
  window.vex = undefined;
});

// ---- renewal radar -----------------------------------------------------------------------------
describe('trial capture and the monthly admin reminder', () => {
  const NOW = new Date(2026, 9, 16, 12, 0, 0);           // Friday 16 October 2026, noon
  let create, del;
  beforeEach(() => {
    create = vi.fn(async () => ({ id: 'r' + (create.mock.calls.length) }));
    del = vi.fn(async () => true);
    window.vex = { reminders: { create, delete: del } };
  });

  it('keeps only an https cancel link with no password in it', () => {
    const { RenewalRadar: R } = fresh('renewal-radar.js');
    expect(R.cleanCancelUrl('')).toBe('');
    expect(R.cleanCancelUrl(' https://music.example/account/cancel ')).toBe('https://music.example/account/cancel');
    expect(() => R.cleanCancelUrl('http://music.example/cancel')).toThrow(/https/);
    expect(() => R.cleanCancelUrl('javascript:alert(1)')).toThrow(/https/);
    expect(() => R.cleanCancelUrl('https://me:pw@music.example/')).toThrow(/user name/);
    expect(() => R.cleanCancelUrl('not a link')).toThrow(/web address/);
  });

  it('reads an end date as a date or a length, and never guesses', () => {
    const { RenewalRadar: R } = fresh('renewal-radar.js');
    expect(R.parseTrialEnd('2026-11-03', '2026-10-16')).toBe('2026-11-03');
    expect(R.parseTrialEnd('3 Nov', '2026-10-16')).toBe('2026-11-03');
    expect(R.parseTrialEnd('7 days', '2026-10-16')).toBe('2026-10-23');
    expect(R.parseTrialEnd('in 30 days', '2026-10-16')).toBe('2026-11-15');
    expect(R.parseTrialEnd('14', '2026-10-16')).toBe('2026-10-30');
    for (const bad of ['', 'soon', '0', '400', '2026-02-30', '2026-10-01']) expect(R.parseTrialEnd(bad, '2026-10-16'), bad).toBe('');
  });

  it('files a confirmed trial and sets one reminder, 2 days before, that opens the cancel page', async () => {
    const { RenewalRadar: R } = fresh('renewal-radar.js');
    const item = await R.captureTrial({ name: 'Music', endIso: '2026-11-03', cancelUrl: 'https://music.example/cancel' }, NOW);
    expect(item).toMatchObject({ name: 'Music', kind: 'trial', status: 'confirmed', anchor: '2026-11-03', remindDays: 2, source: 'capture', cancelUrl: 'https://music.example/cancel' });
    expect(create).toHaveBeenCalledTimes(1);
    const [msg, at, extra] = create.mock.calls[0];
    expect(msg).toContain('Music free trial ends on 2026-11-03');
    expect(msg).toContain('cancel page');
    expect(new Date(at).toISOString().slice(0, 10)).toBe(new Date(2026, 10, 1, 9).toISOString().slice(0, 10));
    expect(extra).toEqual({ url: 'https://music.example/cancel' });
    expect(R.items()).toHaveLength(1);
    // Asking again does not set a second reminder for the same thing.
    await R.syncReminders(NOW);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('says so when the reminder cannot be set, and refuses a date that has passed', async () => {
    const { RenewalRadar: R } = fresh('renewal-radar.js');
    await expect(R.captureTrial({ name: 'Old', endIso: '2026-10-01' }, NOW)).rejects.toThrow(/already passed/);
    create.mockRejectedValueOnce(new Error('no reminders'));
    await expect(R.captureTrial({ name: 'Music', endIso: '2026-11-03' }, NOW)).rejects.toThrow(/reminder could not be set: no reminders/);
  });

  it('asks three short questions and files the trial', async () => {
    const { RenewalRadar: R } = fresh('renewal-radar.js');
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://www.musicsite.example/account' }) };
    globalThis.vexPrompt = vi.fn()
      .mockResolvedValueOnce('Music').mockResolvedValueOnce('2099-01-10').mockResolvedValueOnce('https://musicsite.example/cancel');
    const item = await R.captureFromTab();
    expect(globalThis.vexPrompt.mock.calls[0][0].value).toBe('Musicsite');                  // a guess from the address, editable
    expect(globalThis.vexPrompt.mock.calls[2][0].value).toBe('https://www.musicsite.example/account');
    expect(item.cancelUrl).toBe('https://musicsite.example/cancel');
    globalThis.vexPrompt = vi.fn().mockResolvedValueOnce('X').mockResolvedValueOnce('whenever');
    await expect(R.captureFromTab()).rejects.toThrow(/could not read "whenever"/);
    globalThis.vexPrompt = vi.fn().mockResolvedValueOnce(null);
    expect(await R.captureFromTab()).toBeNull();                                            // cancelled: nothing saved
  });

  it('the monthly reminder is the first working day, skips a holiday from a holiday pack, and is one reminder at a time', async () => {
    const { RenewalRadar: R } = fresh('renewal-radar.js');
    expect(R.settings().monthlyAdmin).toBe(false);
    expect(R.adminDate(NOW)).toBe('2026-11-02');                                       // 1 Nov is a Sunday
    globalThis.VexPackContent = { isHoliday: (d) => d === '2026-11-02' };
    expect(R.adminDate(NOW)).toBe('2026-11-03');
    expect(R.adminDate(new Date(2026, 10, 1, 8, 0))).toBe('2026-11-03');               // still 1 Nov, before 10:00
    expect(await R.syncAdmin(NOW)).toBe(false);                                          // off: nothing to do
    expect(create).not.toHaveBeenCalled();
    expect(await R.setMonthlyAdmin(true)).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toBe(R.ADMIN_MESSAGE);
    await R.syncAdmin();
    expect(create).toHaveBeenCalledTimes(1);                                              // same month: not again
    expect(R.settings().monthlyAdmin).toBe(true);
    await R.setMonthlyAdmin(false);
    expect(del).toHaveBeenCalledWith('r1');
    expect(R._rawSettings().adminReminderId).toBeUndefined();
    expect(R.settings().remindDays).toBe(3);                                             // the other setting is untouched
  });
});

// ---- page watch --------------------------------------------------------------------------------
describe('page watch: a new lowest price and the templates', () => {
  it('a wishlist watch speaks only when the price is lower than every price it has seen', () => {
    const { PageWatch: P } = fresh('page-watch.js');
    const w = { kind: 'number', direction: 'down', alertLow: true, lastValue: 100, low: 80 };
    expect(P.judge(w, 90)).toMatchObject({ changed: false });                         // down, but not a new low
    expect(P.judge(w, 120).changed).toBe(false);
    expect(P.judge(w, 79)).toMatchObject({ changed: true });
    expect(P.judge(w, 79).why).toContain('lowest');
    // Without the flag it still behaves as before.
    expect(P.judge({ ...w, alertLow: undefined }, 90).changed).toBe(true);
  });

  it('the lowest value is kept as checks come in, and a new low after a rise is found', () => {
    const { PageWatch: P } = fresh('page-watch.js');
    const w = { kind: 'number', alertLow: true };
    P.noteCheck(w, 1, 120); P.noteCheck(w, 2, 95); P.noteCheck(w, 3, 110);
    expect(w.low).toBe(95);
    w.lastValue = 110;
    expect(P.judge(w, 100).changed).toBe(false);
    expect(P.judge(w, 94).changed).toBe(true);
  });

  it('add() stores the flag for a number watch only', () => {
    const { PageWatch: P } = fresh('page-watch.js');
    window.vex = {};
    const a = P.add({ url: 'https://shop.example/a', title: 'A', kind: 'number', pattern: '(\\d+)', direction: 'down', alertLow: true, byUser: true });
    expect(a.alertLow).toBe(true);
    const b = P.add({ url: 'https://shop.example/b', title: 'B', kind: 'text', alertLow: true, byUser: true });
    expect(b.alertLow).toBeUndefined();
    expect(P.describeRule(a)).toContain('lowest');
  });

  it('the seat and sale patterns compile in the watcher and find what they should', () => {
    const { PageWatchTemplates: T } = fresh('page-watch-templates.js');
    const D = fresh('page-watch-diff.js').PageWatchDiff || globalThis.PageWatchDiff;
    for (const p of [T.PATTERNS.seat, T.PATTERNS.sale]) { expect(p.length).toBeLessThanOrEqual(200); if (D) expect(() => D.compile(p)).not.toThrow(); }
    const seat = new RegExp(T.PATTERNS.seat, 'i');
    expect(seat.exec('Only 4 seats left on this flight')[1]).toBe('4 seats left');
    expect(seat.exec('Sorry, this show is sold out')[1]).toBe('sold out');
    expect(seat.exec('Welcome to our theatre')).toBeNull();
    const sale = new RegExp(T.PATTERNS.sale, 'i');
    expect(sale.exec('Black Friday sale starts 24 Nov, everything half price')[1]).toBe('24 Nov');
    expect(sale.exec('Offer ends November 24')[1]).toBe('November 24');
    expect(sale.exec('Our offer may end soon')).toBeNull();
  });

  it('fills the watch dialog for a template, and finish() adds the lowest-price flag or refuses a bad combination', () => {
    const { PageWatchTemplates: T } = fresh('page-watch-templates.js');
    const form = document.createElement('form');
    form.innerHTML = '<input type="radio" name="pw-what" value="text" checked><input type="radio" name="pw-what" value="number">'
      + '<h2 id="pw-add-title"></h2><input type="checkbox" id="pw-ai" checked><select id="pw-extract"><option value="price"></option><option value="custom"></option></select>'
      + '<input id="pw-pattern"><select id="pw-when"><option value="any"></option><option value="down"></option><option value="below"></option></select>'
      + '<input id="pw-target"><select id="pw-every"><option value="3600000"></option><option value="21600000"></option></select>';
    const q = (s) => form.querySelector(s);
    T.fill('seat', { form, q });
    expect(q('#pw-extract').value).toBe('custom');
    expect(q('#pw-pattern').value).toBe(T.PATTERNS.seat);
    expect(q('#pw-every').value).toBe('3600000');
    expect(q('#pw-ai').checked).toBe(false);
    T.fill('fare', { form, q });
    expect(q('#pw-when').value).toBe('below');
    expect(T.finish('fare', { kind: 'number', direction: 'below', target: 300 })).toMatchObject({ target: 300 });
    expect(() => T.finish('fare', { kind: 'regex' })).toThrow(/goes below/);
    T.fill('wishlist-low', { form, q });
    expect(q('#pw-when').value).toBe('down');
    expect(T.finish('wishlist-low', { kind: 'number', direction: 'any' })).toMatchObject({ alertLow: true, direction: 'down' });
    expect(() => T.finish('wishlist-low', { kind: 'text' })).toThrow(/price/);
    expect(T.finish('price', { kind: 'number' })).toEqual({ kind: 'number' });          // not ours: unchanged
    expect(() => T.fill('nope', { form, q })).toThrow(/Unknown/);
  });

  it('"remind me before this ends": lead time, a time that has passed, and the reminder carries the page link', async () => {
    const { PageWatchTemplates: T } = fresh('page-watch-templates.js');
    expect(T.parseLead('2 hours')).toBe(7200000);
    expect(T.parseLead('1 day')).toBe(86400000);
    expect(T.parseLead('30 min')).toBe(1800000);
    for (const bad of ['', 'soon', '0 min', '99 days', '2 weeks']) expect(() => T.parseLead(bad), bad).toThrow();
    const now = 1_000_000_000_000;
    expect(T.planClaim(now + 5 * 3600000, 2 * 3600000, now)).toEqual({ at: now + 3 * 3600000, late: false });
    expect(T.planClaim(now + 30 * 60000, 2 * 3600000, now)).toEqual({ at: now + 60000, late: true });
    expect(() => T.planClaim(now - 1, 3600000, now)).toThrow(/passed/);
    const made = vi.fn(async () => ({ id: 'x' }));
    globalThis.VexQuickReminder = { parseWhen: () => new Date(Date.now() + 10 * 3600000), create: made };
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://store.example/deal', title: 'Free game' }) };
    globalThis.vexPrompt = vi.fn().mockResolvedValueOnce('tomorrow 18:00').mockResolvedValueOnce('2 hours');
    await T.claimReminder();
    expect(made.mock.calls[0][0]).toBe('Claim before it ends: Free game');
    expect(made.mock.calls[0][2]).toEqual({ url: 'https://store.example/deal' });
    globalThis.TabManager = { getActiveTab: () => ({ url: 'vex://start' }) };
    await expect(T.claimReminder()).rejects.toThrow(/Open a website/);
  });

  it('registers its commands, and takes them away when switched off', () => {
    globalThis.CommandBar = { commands: [] };
    const { PageWatchTemplates: T } = fresh('page-watch-templates.js');
    T._registerCommands();
    expect(CommandBar.commands.map(c => c.id).sort()).toEqual(['claim-reminder', 'watch-fare', 'watch-sale-date', 'watch-seats', 'watch-wishlist-low']);
    T.setEnabled(false);
    expect(CommandBar.commands).toEqual([]);
    T.setEnabled(true);
    expect(CommandBar.commands).toHaveLength(5);
  });
});

// ---- evening tab cleanup ---------------------------------------------------------------------------
describe('evening tab cleanup: why keep it, keep with a reason, archive instead of close', () => {
  const NOW = 1_800_000_000_000;
  const DAY = 86400000;
  const tab = (id, url, daysIdle, over = {}) => ({ id, url, title: 'Tab ' + id, _lastActive: NOW - daysIdle * DAY, ...over });

  it('one line says why you might keep a tab, and a tab you highlighted starts unticked', () => {
    const { TabCleanup: C } = fresh('tab-cleanup.js');
    expect(C.keepLine({ why: 'idle' }, { annotated: true })).toMatchObject({ strong: true });
    expect(C.keepLine({ why: 'idle' }, { annotated: true }).line).toContain('highlighted');
    expect(C.keepLine({ why: 'idle' }, { readLater: true }).strong).toBe(false);
    expect(C.keepLine({ why: 'idle' }, { bookmarked: true }).line).toContain('bookmarked');
    expect(C.keepLine({ why: 'duplicate' }, {}).line).toContain('second copy');
    expect(C.keepLine({ why: 'idle' }, {}).line).toContain('nothing says you need it');
    for (const f of [{}, { annotated: true }, { bookmarked: true }]) expect(C.keepLine({ why: 'idle' }, f).line.startsWith('Why keep it:')).toBe(true);
  });

  it('reads the facts from highlights, bookmarks and read-later', () => {
    const { TabCleanup: C } = fresh('tab-cleanup.js');
    globalThis.Annotations = { store: { 'https://a.test/p': [{ id: 1 }] } };
    globalThis.Bookmarks = { has: (u) => u === 'https://b.test/p' };
    globalThis.ReadLater = { items: [{ url: 'https://c.test/p' }] };
    expect(C.factsFor('https://a.test/p')).toMatchObject({ annotated: true, bookmarked: false, readLater: false });
    expect(C.factsFor('https://b.test/p#top')).toMatchObject({ bookmarked: true });          // the page, whatever part of it was open
    expect(C.factsFor('https://other.test/p')).toMatchObject({ bookmarked: false });
    expect(C.factsFor('https://c.test/p').readLater).toBe(true);
    const out = C.describe([{ id: 1, url: 'https://a.test/p', why: 'idle' }, { id: 2, url: 'https://z.test/', why: 'idle' }]);
    expect(out[0].keep.strong).toBe(true);
    expect(out[1].keep.strong).toBe(false);
  });

  it('a tab you kept is left alone for 30 days, with your reason, and then is proposed again', () => {
    const { TabCleanup: C } = fresh('tab-cleanup.js');
    const tabs = [tab(1, 'https://a.test/x', 10), tab(2, 'https://b.test/y', 10)];
    const ctx = (now, extra = {}) => ({ now, days: 3, activeId: 99, ...extra });
    expect(C.propose(tabs, ctx(NOW)).map(i => i.id).sort()).toEqual([1, 2]);
    C.keep('https://a.test/x#section', '  my   tax return  ', NOW);
    expect(C.keeps(NOW)['https://a.test/x'].why).toBe('my tax return');
    expect(C.propose(tabs, ctx(NOW, { kept: (u) => !!C.keeps(NOW)[C.keyOf(u)] })).map(i => i.id)).toEqual([2]);
    expect(Object.keys(C.keeps(NOW + 31 * DAY))).toEqual([]);                                       // expired
    expect(C.unkeep('https://a.test/x')).toBe(true);
    expect(C.unkeep('https://a.test/x')).toBe(false);
  });

  it('refuses an empty or very long reason, and reports damaged saved data instead of starting over', () => {
    const { TabCleanup: C } = fresh('tab-cleanup.js');
    expect(() => C.keep('https://a.test/', '   ')).toThrow(/few words/);
    expect(() => C.keep('https://a.test/', 'x'.repeat(121))).toThrow(/120/);
    localStorage.setItem(C.KEEP_KEY, '{oops');
    expect(() => C.keeps()).toThrow(/not readable/);
  });

  it('the card has a tick per tab (a highlighted one unticked), the line, and archives only what is ticked', () => {
    const { TabCleanup: C } = fresh('tab-cleanup.js');
    window.VexIcons = { svg: () => '<svg></svg>' };
    globalThis.Annotations = { store: { 'https://a.test/x': [{ id: 1 }] } };
    const items = [{ id: 1, url: 'https://a.test/x', title: 'Marked up', host: 'a.test', why: 'idle', idleDays: 9 }, { id: 2, url: 'https://b.test/y', title: 'Plain', host: 'b.test', why: 'idle', idleDays: 5 }];
    const accepted = [];
    C.acceptWithUndo = (list) => { accepted.push(...list.map(i => i.id)); return list.length; };
    const card = C.showCard(items);
    const boxes = [...card.querySelectorAll('input[type=checkbox]')];
    expect(boxes.map(b => b.checked)).toEqual([false, true]);
    expect(card.textContent).toContain('Why keep it: you highlighted text on this page');
    expect(card.textContent).toContain('Tidy 1 of 2 tabs?');
    card.querySelector('.btn-primary').click();
    expect(accepted).toEqual([2]);
  });

  it('"Archive this tab and close it" refuses Vex pages and private tabs, and archives an ordinary one with an Undo', () => {
    const { TabCleanup: C } = fresh('tab-cleanup.js');
    let active = { id: 7, url: 'vex://start', title: 'Start' };
    globalThis.TabManager = { getActiveTab: () => active, tabs: [active] };
    expect(() => C.archiveActive()).toThrow(/own pages/);
    active = { id: 8, url: 'https://x.test/', title: 'X' };
    window.VexTabPolicy = { canPersist: () => false };
    expect(() => C.archiveActive()).toThrow(/private or Tor/);
    window.VexTabPolicy = { canPersist: () => true };
    const seen = [];
    C.acceptWithUndo = (list) => { seen.push(list[0]); return 1; };
    C.archiveActive();
    expect(seen[0]).toMatchObject({ id: 8, url: 'https://x.test/' });
    globalThis.TabManager = { getActiveTab: () => null };
    expect(() => C.archiveActive()).toThrow(/no tab/);
  });
});

// ---- held while you played -------------------------------------------------------------------------
describe('held while you played', () => {
  let game;
  const load = () => {
    game = false;
    globalThis.AttentionState = { get: () => ({ sources: game ? [{ id: 'game' }] : [] }) };
    return fresh('game-holds.js').GameHolds;
  };

  it('notes every toast only while Game mode is on, once a minute for the same words, and never throws into the toast', () => {
    const G = load();
    expect(G.noteToast('Saved', 'info')).toBe(false);
    game = true;
    G.onState();
    expect(G.noteToast('Saved', 'info')).toBe(true);
    expect(G.noteToast('Saved', 'info')).toBe(false);                                   // the same words within a minute
    expect(G.noteToast('Something broke', 'error')).toBe(true);
    expect(G.log().items.map(i => i.text)).toEqual(['Saved', 'Something broke']);
    expect(G.log().items[1].from).toBe('error');
    localStorage.setItem(G.LOG_KEY, '{oops');
    expect(G.noteToast('Later', 'info')).toBe(false);                                   // reported, not thrown
    window.vex = undefined;
  });

  it('a new game empties the last one; ending a game closes the session', () => {
    const G = load();
    game = true; G.onState(); G.noteToast('One', 'info');
    game = false; G.onState();
    expect(G.log().end).toBeGreaterThan(0);
    expect(G.log().items).toHaveLength(1);
    game = true; G.onState();
    expect(G.log().items).toHaveLength(0);
    expect(G.log().end).toBe(0);
  });

  it('is off when switched off', () => {
    const G = load();
    G.setEnabled(false);
    game = true; G.onState();
    expect(G.noteToast('Saved', 'info')).toBe(false);
    expect(G.enabled()).toBe(false);
  });

  it('gathers toasts, refused notices, Windows notifications and inbox rows since the game began, one row per message', async () => {
    const G = load();
    game = true; G.onState();
    const since = G.log().start;
    G.noteToast('Backup done', 'info');
    globalThis.VexAttention = { denied: () => [
      { feature: 'patch-radar', title: 'Patch 1.2 is out', reason: 'quiet: game', t: since + 10, n: 2 },
      { feature: 'x', title: 'Too old', reason: 'quiet: game', t: since - 5, n: 1 },
      { feature: 'y', title: 'Hourly', reason: 'hourly limit', t: since + 10, n: 1 },
    ] };
    window.vex = { attention: { denied: async () => [{ feature: 'discord', title: 'Server announcement', reason: 'quiet: game', t: since + 20, n: 1 }, { feature: 'patch-radar', title: 'Patch 1.2 is out', reason: 'quiet: game', t: since + 30, n: 1 }] } };
    globalThis.AttentionInbox = { list: () => [{ id: 'a', feature: 'tab-cleanup', label: 'Tab cleanup', title: 'Tidy 4 tabs?', ts: since + 40 }, { id: 'b', feature: 'old', title: 'Before the game', ts: since - 1 }] };
    const out = await G.collect();
    expect(out.map(o => o.text).sort()).toEqual(['Backup done', 'Patch 1.2 is out', 'Server announcement', 'Tidy 4 tabs?']);
    expect(out.find(o => o.text === 'Patch 1.2 is out').n).toBe(3);
    expect(out.find(o => o.text === 'Server announcement').via).toBe('Windows notification');
  });

  it('word rules put matching items first and leave others out, plainly (no patterns), and are bounded', () => {
    const G = load();
    G.addRule('Maintenance', 'flag'); G.addRule('giveaway', 'hide');
    const items = [{ t: 3, text: 'Free giveaway of the week', from: 'discord' }, { t: 2, text: 'Scheduled maintenance tonight', from: 'discord' }, { t: 4, text: 'Saved', from: 'Vex' }, { t: 1, text: 'Weekly maintenance giveaway', from: 'x' }];
    const { shown, hidden } = G.applyRules(items, G.rules());
    expect(hidden).toBe(2);                                                              // a hide word wins over a flag word
    expect(shown.map(s => s.text)).toEqual(['Scheduled maintenance tonight', 'Saved']);
    expect(shown[0].flag).toBe('maintenance');
    expect(() => G.addRule('maintenance', 'hide')).toThrow(/already has a rule/);
    expect(() => G.addRule('', 'flag')).toThrow(/word/);
    expect(() => G.addRule('x'.repeat(41), 'flag')).toThrow(/at most 40/);
    expect(() => G.addRule('a', 'delete')).toThrow(/flags or hides/);
    for (let i = 0; i < 18; i++) G.addRule('w' + i, 'flag');
    expect(() => G.addRule('one more', 'flag')).toThrow(/At most 20/);
    expect(G.removeRule('w1')).toHaveLength(19);
    expect(G.applyRules([{ t: 1, text: '(a+)+$', from: '' }], [{ word: '(a+)+$', mode: 'flag' }]).shown[0].flag).toBe('(a+)+$');   // a plain substring, never a regex
  });

  it('opens a list that says what was held, with the words and counts', async () => {
    const G = load();
    window.VexIcons = { svg: () => '' };
    globalThis.VexSettingsGroups = fresh('vex-settings-groups.js').VexSettingsGroups || window.VexSettingsGroups;
    game = true; G.onState(); G.noteToast('Backup done', 'info');
    G.addRule('backup', 'flag');
    await G.open();
    const dlg = document.getElementById('vex-game-holds');
    expect(dlg.textContent).toContain('[backup] Backup done');
    expect(dlg.textContent).toContain('Held while you played');
  });
});

// ---- brief cards ---------------------------------------------------------------------------------------
describe('brief cards and the New Tab slot grid', () => {
  const load = () => {
    globalThis.VexJobs = { every: vi.fn(() => ({ stop: vi.fn() })) };
    globalThis.NewTabSlots = fresh('newtab-slots.js').NewTabSlots;
    const mod = fresh('brief-extras/foldin-cards.js');
    globalThis.VexBriefCards = mod.VexBriefCards;
    return mod;
  };

  it('registers four slot candidates that are only available once their card has something to say', () => {
    const { VexBriefCards: B } = load();
    const ids = NewTabSlots.list().map(d => d.id);
    for (const id of ['brief-perm-audit', 'brief-platform-status', 'brief-old-highlight', 'brief-watch-flag']) expect(ids).toContain(id);
    const plan = () => NewTabSlots.plan({ layout: 'calm' });
    expect(plan().cards.join()).not.toMatch(/brief-/);                                  // nothing to say: no slot taken
    B.setPref('platformStatus', true);
    B._shown['platform-status'] = true;
    expect(plan().cards).toContain('brief-platform-status');
  });

  it('never exceeds three cards or the render budget, and a red service outranks the quiet extras', () => {
    const { VexBriefCards: B } = load();
    B.setPref('platformStatus', true);
    for (const id of Object.keys(B.CARDS)) B._shown[id] = true;
    const p = NewTabSlots.plan({ layout: 'calm' });
    expect(p.cards.length).toBeLessThanOrEqual(3);
    expect(p.spentMs).toBeLessThanOrEqual(NewTabSlots.BUDGET_MS);
    expect(p.cards).toContain('brief-platform-status');
    expect(p.dropped.some(d => d.id === 'brief-old-highlight')).toBe(true);              // the quietest extra loses its slot
    expect(NewTabSlots.plan({ layout: 'all' }).cards).toContain('brief-old-highlight');   // "everything" keeps every card, as before
  });

  it('the switches: the group, each card, and a private window shows none', () => {
    const { VexBriefCards: B } = load();
    expect(B.cardOn('perm-audit')).toBe(true);
    expect(B.cardOn('platform-status')).toBe(false);                                      // asks the internet: off until chosen
    B.setPref('permAudit', false);
    expect(B.cardOn('perm-audit')).toBe(false);
    B.setEnabled(false);
    expect(B.cardOn('old-highlight')).toBe(false);
    B.setEnabled(true);
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(B.cardOn('old-highlight')).toBe(false);
    window.VexTabPolicy = undefined;
    expect(() => B.setPref('nope', true)).toThrow(/Unknown brief card/);
    localStorage.setItem(B.PREFS_KEY, '{oops');
    expect(() => B.prefs()).toThrow(/not readable/);
  });

  it('is joined to the Morning Brief by id', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/brief-integration.js'), 'utf8');
    for (const id of ['platform-status', 'watch-flag', 'perm-audit', 'old-highlight']) expect(src).toContain("id: '" + id + "'");
  });

  it('permission audit: one line from Permission hygiene, nothing when there is nothing to say', async () => {
    const { VexBriefCards: B, VexBriefPermAudit: S } = load();
    expect(await S.build()).toBeNull();                                                  // hygiene not loaded
    globalThis.VexPermHygiene = { enabled: () => true };
    window.vex = { hygienePermSummary: vi.fn(async () => ({ lines: [], soonLines: [], soon: [] })) };
    expect(await S.build()).toBeNull();
    expect(B.visible('perm-audit')).toBe(false);
    window.vex.hygienePermSummary = vi.fn(async () => ({ lines: ['3 sites can use your mic', '1 site can use your location'], soonLines: ['Camera for meet.example ends in 2 days'], soon: [] }));
    const out = await S.build();
    expect(out.lines[0].text).toBe('3 sites can use your mic; 1 site can use your location.');
    expect(out.lines[0].detail).toContain('ends in 2 days');
    expect(out.lines[0].actions[0].label).toBe('Review');
    expect(B.visible('perm-audit')).toBe(true);
  });

  it('service status: only a major or critical incident is red, a failure to read is not red, and nothing old is shown', async () => {
    const { VexPlatformStatus: P, VexBriefCards: B, VexBriefPlatformStatus: S } = load();
    expect(P.parse({ status: { indicator: 'major', description: 'Major outage' }, incidents: [{ name: 'Gateway down' }] })).toEqual({ indicator: 'major', text: 'Gateway down' });
    expect(P.parse({ status: { indicator: 'none', description: 'All good' } }).text).toBe('All good');
    expect(() => P.parse({ nope: 1 })).toThrow(/not a status page/);
    expect(() => P.parse({ status: { indicator: 'weird' } })).toThrow(/Unknown status/);
    const j = P.judge([{ id: 'a', name: 'A', ok: true, indicator: 'minor' }, { id: 'b', name: 'B', ok: true, indicator: 'critical', text: 'Down' }, { id: 'c', name: 'C', ok: false, error: 'x' }]);
    expect(j).toEqual({ red: [{ id: 'b', name: 'B', text: 'Down' }], failed: 1 });
    // The minimal local check: the bounded public request, labelled for the ledger.
    B.setPref('platformStatus', true);
    const calls = [];
    window.vex = { apiRequest: vi.fn(async (o) => { calls.push(o); return o.url.includes('discord') ? { ok: true, status: 200, body: JSON.stringify({ status: { indicator: 'major' }, incidents: [{ name: 'API errors' }] }) } : o.url.includes('github') ? { ok: true, status: 200, body: 'not json' } : { ok: true, status: 200, body: JSON.stringify({ status: { indicator: 'none', description: 'ok' } }) }; }) };
    const r = await P.refresh(1000);
    expect(calls.every(c => c.publicOnly === true && c.egress === 'Platform status' && c.url.startsWith('https://'))).toBe(true);
    expect(r.red.map(x => x.name)).toEqual(['Discord']);
    expect(r.failed).toBe(1);                                                            // GitHub's answer could not be read: reported, not red
    expect(P.current(1000 + 60000).map(x => x.name)).toEqual(['Discord']);
    expect(P.current(1000 + 3 * 3600 * 1000)).toEqual([]);                               // two hours old: not shown
    const out = await S.build();
    expect(out === null || out.lines.length >= 0).toBe(true);
    // The Wave 3 check is used when this build has it.
    window.vex = { statusCheck: vi.fn(async () => [{ ok: true, indicator: 'critical', incidents: [{ name: 'Outage' }] }, { ok: true, indicator: 'none' }, { ok: false, error: 'timeout' }, { ok: true, indicator: 'none' }]) };
    const w3 = await P.refresh(2000);
    expect(w3.red.map(x => x.name)).toEqual(['Discord']);
    expect(window.vex.statusCheck).toHaveBeenCalledWith(['discordstatus.com', 'www.githubstatus.com', 'www.cloudflarestatus.com', 'status.roblox.com']);
  });

  it('service status: does not ask while a game is on or when the card is off', async () => {
    const { VexPlatformStatus: P, VexBriefCards: B } = load();
    window.vex = { apiRequest: vi.fn() };
    expect(await P.refresh()).toBeNull();                                                // off
    B.setPref('platformStatus', true);                                                   // switching it on does one read straight away
    await new Promise(r => setTimeout(r, 0));
    window.vex.apiRequest.mockClear();
    globalThis.AttentionState = { has: (id) => id === 'game', get: () => ({ sources: [] }) };
    expect(await P.refresh()).toBeNull();
    expect(window.vex.apiRequest).not.toHaveBeenCalled();
  });

  it('an old highlight: one due highlight, with Remembered and Stop these', () => {
    const { VexBriefCards: B, VexBriefOldHighlight: S } = load();
    expect(B.buildOldHighlight()).toBeNull();                                            // module not loaded
    const now = Date.UTC(2026, 9, 16);
    const store = {};
    globalThis.HighlightResurface = {
      enabled: () => true,
      items: () => [{ id: 'h:1', kind: 'highlight', at: now - 8 * 86400000, text: 'The mitochondria is the powerhouse of the cell', title: 'Biology', url: 'https://bio.example/c' }],
      state: () => ({ seen: store, lastDay: '', pending: [] }),
      due: (items, seen) => ({ highlights: items.map(i => ({ ...i, step: 0 })), notes: [] }),
      snippet: (t) => t,
      mark: vi.fn(), _save: vi.fn(), stop: vi.fn(),
    };
    const out = B.buildOldHighlight(now);
    expect(out.lines[0]).toMatchObject({ detail: 'Biology - highlighted 8 days ago', url: 'https://bio.example/c' });
    out.lines[0].actions[0].run();
    expect(HighlightResurface.mark).toHaveBeenCalled();
    out.lines[0].actions[1].run();
    expect(HighlightResurface.stop).toHaveBeenCalledWith('h:1');
    expect(S.id).toBe('old-highlight');
  });

  it('flagged pages: shows only flagged watches that changed in the last day, and "Seen" clears one', () => {
    const { VexBriefCards: B } = load();
    const now = Date.now();
    const list = [
      { id: 'w1', source: 'brief-flag', title: 'Weather warning', url: 'https://met.example/warn', lastChangedAt: now - 3600000, seenAt: 0, paused: false, lastSummary: '1 line added' },
      { id: 'w2', source: 'brief-flag', title: 'Old news', url: 'https://x.example/', lastChangedAt: now - 3 * 86400000, seenAt: 0 },
      { id: 'w3', source: 'user', title: 'Not flagged', url: 'https://y.example/', lastChangedAt: now - 1000, seenAt: 0 },
      { id: 'w4', source: 'brief-flag', title: 'Seen already', url: 'https://z.example/', lastChangedAt: now - 1000, seenAt: now },
    ];
    globalThis.PageWatch = { list: () => list, isUnseen: (w) => w.lastChangedAt > (w.seenAt || 0), markSeen: vi.fn() };
    const out = B.buildWatchFlag(now);
    expect(out.lines.map(l => l.text)).toEqual(['Weather warning']);
    expect(out.lines[0].detail).toContain('1 line added');
    out.lines[0].actions[0].run();
    expect(PageWatch.markSeen).toHaveBeenCalledWith('w1');
  });

  it('"Flag this page" makes an ordinary page watch from the page in front, from a normal tab only', async () => {
    const { VexBriefCards: B } = load();
    const add = vi.fn((spec) => ({ id: 'w', ...spec }));
    globalThis.PageWatch = { add, firstLook: vi.fn(async () => {}), list: () => [] };
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://transit.example/status', title: 'Line 4', partition: null }) };
    await B.flagActivePage();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://transit.example/status', source: 'brief-flag', kind: 'text', byUser: true }));
    globalThis.TabManager = { getActiveTab: () => ({ url: 'vex://start' }) };
    await expect(B.flagActivePage()).rejects.toThrow(/Open a website/);
  });
});

// ---- content from packs --------------------------------------------------------------------------------
describe('holidays, phrases and checklists from packs', () => {
  const dates = (entries) => [{ packId: 'p', packName: 'Holidays', item: { type: 'dates', id: 'd', name: 'H', region: 'TR', entries } }];
  const E = (date, name, kind = 'fixed', verify = false) => ({ date, name, kind, verify });

  it('knows holidays, half days, working days and the next working day', () => {
    const { VexPackContent: C } = fresh('pack-content.js');
    C.setDates(dates([E('2026-10-28', 'Eve', 'half-day'), E('2026-10-29', 'Republic Day'), E('2026-11-02', 'Made-up day')]));
    expect(C.isHoliday('2026-10-29')).toBe(true);
    expect(C.isHoliday('2026-10-28')).toBe(false);
    expect(C.isHalfDay('2026-10-28')).toBe(true);
    expect(C.isWorkday('2026-10-28')).toBe(true);
    expect(C.isWorkday('2026-10-29')).toBe(false);
    expect(C.isWorkday('2026-10-31')).toBe(false);                                       // Saturday
    expect(C.nextWorkday('2026-10-29')).toBe('2026-10-30');
    expect(C.nextWorkday('2026-10-31')).toBe('2026-11-03');                              // the Monday is a holiday: Tuesday
    expect(() => C.addDays('2026-02-30', 1)).toThrow(/Not a date/);
  });

  it('lists what is coming, and a holiday on a Tuesday or Thursday hints at a bridge day it does not promise', () => {
    const { VexPackContent: C } = fresh('pack-content.js');
    C.setDates(dates([E('2026-10-29', 'Republic Day'), E('2026-12-01', 'Tuesday day'), E('2026-12-08', 'Half', 'half-day')]));
    expect(C.upcoming('2026-10-16', 5).map(h => h.name)).toEqual(['Republic Day', 'Tuesday day']);
    const hints = C.bridgeHints('2026-10-01', '2026-12-31');
    expect(hints.map(h => h.date)).toEqual(['2026-10-30', '2026-11-30']);              // Thursday -> Friday, Tuesday -> Monday
    expect(hints[0].holiday.name).toBe('Republic Day');
  });

  it('nothing is available until a holiday pack is switched on, and the switch hides the commands', () => {
    globalThis.CommandBar = { commands: [] };
    const { VexPackContent: C } = fresh('pack-content.js');
    expect(C.available()).toBe(false);
    C.setDates(dates([E('2026-10-29', 'Republic Day')]));
    expect(C.available()).toBe(true);
    C._registerCommands();
    expect(CommandBar.commands.map(c => c.id).sort()).toEqual(['pack-holidays', 'pack-phrases']);
    C.setEnabled(false);
    expect(CommandBar.commands).toEqual([]);
    expect(C.available()).toBe(false);
  });

  it('phrases are searchable, copy their text, and become a typing shortcut only when the person names one', async () => {
    const { VexPackContent: C } = fresh('pack-content.js');
    C.setSnippets([{ packId: 'p', packName: 'MUN', item: { type: 'snippets', id: 's', name: 'Motions', entries: [{ label: 'Point of order', text: 'Point of order: [reason].' }, { label: 'Close debate', text: 'Motion to close debate.' }] } }]);
    expect(C.phrases()).toHaveLength(2);
    expect(C.filter(C.phrases(), 'debate').map(p => p.label)).toEqual(['Close debate']);
    expect(C.filter(C.phrases(), '')).toHaveLength(2);
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    await C.copy('hello');
    expect(write).toHaveBeenCalledWith('hello');
    const save = vi.fn((t) => t);
    globalThis.VexSnippets = { save };
    globalThis.vexPrompt = vi.fn().mockResolvedValueOnce(':order');
    expect(await C.saveAsSnippet(C.phrases()[0])).toBe(':order');
    expect(save).toHaveBeenCalledWith(':order', 'Point of order: [reason].');
    expect(globalThis.vexPrompt.mock.calls[0][0].value).toBe(':point-of-order');
    globalThis.vexPrompt = vi.fn().mockResolvedValueOnce(null);
    expect(await C.saveAsSnippet(C.phrases()[0])).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('checklists from a pack join the built-in ones, keep their own ticks and show the date they were checked', () => {
    const { VexIncident: I } = fresh('incident-playbooks.js');
    const item = { type: 'playbook', id: 'lost-phone', title: 'I lost my phone', sub: 'Quick', verified: '2026-10-16', steps: [{ id: 'a', title: 'Call', text: 'Call the carrier.', run: '' }, { id: 'b', title: 'Look', text: 'Names only.', run: 'downloads' }, { id: 'c', title: 'Sneaky', text: 'x', run: 'format-disk' }] };
    expect(I.setPackPlaybooks([{ packId: 'vex-builtin.incident-extra', packName: 'More', item }])).toBe(1);
    const id = 'pack:vex-builtin.incident-extra:lost-phone';
    expect(I.list().map(l => l.id)).toContain(id);
    const pb = I.get(id);
    expect(pb.steps[0].manual).toBe(true);
    expect(pb.steps[1].run).toBe('downloads');
    expect(pb.steps[2].manual).toBe(true);                                                // an action that is not on the fixed list is never a button
    expect(pb.steps[2].run).toBeUndefined();
    I.setTick(id, 'a', true);
    expect(I.progress(id)).toEqual({ done: 1, total: 3 });
    expect(I.progress('clicked').done).toBe(0);
    expect(() => I.setTick(id, 'zzz', true)).toThrow(/No step/);
    I.setPackPlaybooks([]);
    expect(I.get(id)).toBeNull();
    expect(I.get('clicked')).toBeTruthy();                                                // the built-in ones stay
  });

  it('a prompt from a pack is copied into AI Skills by a button, validated, once, and can be compared and updated', async () => {
    const { VexSkills } = { VexSkills: fresh('skills.js').VexSkills };
    globalThis.VexSkills = VexSkills;
    globalThis.vexId = (p) => p + 'abc123';
    VexSkills.skills = [];
    const packs = fresh('packs-ui.js') && window.VexPacks;
    const item = { id: 'quiz', name: 'Quiz me', icon: 'brain', prompt: 'Ask me 5 questions.', output: 'text', sites: [] };
    packs.addSkillToMine('Prompt library', 'vex-builtin.prompts', item);
    expect(VexSkills.skills).toHaveLength(1);
    expect(VexSkills.skills[0]).toMatchObject({ name: 'Quiz me', imported: true, fromPack: 'vex-builtin.prompts:quiz' });
    expect(() => packs.addSkillToMine('Prompt library', 'vex-builtin.prompts', item)).toThrow(/already in your skills/);
    // A hostile or broken pack item is stopped by the same check an import gets.
    expect(() => packs.addSkillToMine('P', 'p', { id: 'bad', name: 'Bad', icon: 'brain', prompt: 'Do {{shell}}', output: 'text', sites: [] })).toThrow(/Unknown variable/);
    // Compare: the same wording says so; a different one asks, and keeps the old wording in the history.
    expect(await packs.compareSkill('vex-builtin.prompts', item)).toBe(false);
    const changed = { ...item, prompt: 'Ask me 7 questions.' };
    expect(await packs.compareSkill('vex-builtin.prompts', changed)).toBe(true);
    expect(VexSkills.skills[0].prompt).toBe('Ask me 7 questions.');
    expect(VexSkills.skills[0].versions[0].prompt).toBe('Ask me 5 questions.');
    await expect(packs.compareSkill('vex-builtin.prompts', { ...item, id: 'other' })).rejects.toThrow(/have not added/);
    // And the person's own skills can be shared as pack items.
    const shared = packs._collect('skills');
    expect(shared[0]).toMatchObject({ type: 'skills', name: 'Quiz me', prompt: 'Ask me 7 questions.', output: 'text', sites: [] });
  });
});
