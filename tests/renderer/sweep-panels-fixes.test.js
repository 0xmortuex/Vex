// @vitest-environment jsdom
//
// Panels sweep (2026-09-29): the notes, reminders, clock, calendar and small
// tool bugs a live run found, each pinned where it can be without the app.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;

describe('closing the window flushes notes before the files are written', () => {
  it('NotesPanel and StickyNotes flush ahead of PersistentStorage', async () => {
    vi.resetModules();
    let onFlush = null;
    window.vex = { onFlushRequested: (cb) => { onFlush = cb; }, flushStorage: vi.fn(async () => true), persistSet: vi.fn(async () => true), persistDelete: vi.fn(async () => true), persistGetAll: vi.fn(async () => ({})) };
    const { PersistentStorage } = await import('../../src/renderer/js/storage.js?sweep-panels');
    const order = [];
    globalThis.NotesPanel = { flush: () => order.push('notes'), _flushSticky: () => order.push('notes-sticky') };
    globalThis.StickyNotes = { flush: () => order.push('sticky') };
    vi.spyOn(PersistentStorage, '_flush').mockImplementation(async () => { order.push('files'); });
    expect(typeof onFlush).toBe('function');
    await onFlush();
    expect(order).toEqual(['notes', 'notes-sticky', 'sticky', 'files']);
    delete globalThis.NotesPanel; delete globalThis.StickyNotes;
  });
});

describe('clock timers', () => {
  const { VexClock } = require('../../src/renderer/js/clock-panel.js');
  let bridge;
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<button id="timer-pill" hidden><span></span></button>';
    bridge = {
      create: vi.fn(async (message, at, extra) => ({ id: 'r1', message, at, ...extra })),
      delete: vi.fn(async () => ({ ok: true })), list: vi.fn(async () => []), ack: vi.fn(), onFired: vi.fn(),
    };
    window.vex = { reminders: bridge, focusWindow: vi.fn() };
    window.showToast = vi.fn();
    VexClock._timers = [];
    VexClock.stopSound();
  });
  afterEach(() => { VexClock.stopSound(); document.getElementById('vex-ringing')?.remove(); vi.useRealTimers(); });

  it('a 1-minute timer registers a backup at least a minute out, never before the end', async () => {
    const t = await VexClock.addTimer('1 min', 'Tea');
    const backup = bridge.create.mock.calls[0][1];
    expect(backup % 60000).toBe(0);
    expect(backup).toBeGreaterThanOrEqual(t.endAt);
    expect(backup - Date.now()).toBeGreaterThanOrEqual(60000);
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('rings at the end itself and takes the backup away', async () => {
    const t = await VexClock.addTimer('5 min', 'Tea');
    const ring = vi.spyOn(VexClock, 'ring').mockImplementation(() => null);
    t.endAt = Date.now() - 1;
    VexClock._tickTimers();
    expect(ring).toHaveBeenCalledWith(expect.objectContaining({ message: 'Tea', kind: 'timer' }));
    expect(bridge.delete).toHaveBeenCalledWith('r1');
    ring.mockRestore();
  });

  it('the world clock keeps one repaint loop, so a removed city stays removed', () => {
    vi.useFakeTimers();
    localStorage.setItem(VexClock.KEY_CITIES, JSON.stringify([{ name: 'Tokyo', zone: 'Asia/Tokyo' }, { name: 'Paris', zone: 'Europe/Paris' }]));
    const body = document.createElement('div'); document.body.appendChild(body);
    VexClock._renderWorld(body);
    body.querySelectorAll('.ck-x')[0].click();                 // remove Tokyo
    vi.advanceTimersByTime(3000);
    expect([...body.querySelectorAll('.ck-item-label')].map(e => e.textContent)).toEqual(['Paris']);
    expect(body.querySelector('.ck-x svg')).toBeTruthy();       // an icon, not a text glyph
  });
});

describe('quick reminder times', () => {
  const { VexQuickReminder } = require('../../src/renderer/js/quick-reminder.js');
  it('"in 1 minute" at hh:mm:30 rounds up to the next minute', () => {
    const now = new Date(2026, 8, 13, 14, 30, 30);
    expect(VexQuickReminder.parseWhen('in 1 minute', now).getTime()).toBe(new Date(2026, 8, 13, 14, 32).getTime());
  });
});

describe('automations', () => {
  let A;
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    window.showToast = vi.fn();
    window.vexId = (p) => p + Math.random().toString(36).slice(2);
    await import('../../src/renderer/js/automations.js?sweep-panels');
    A = window.Automations;
    A._firedUrl = {}; A._lastUrl = '';
  });

  it('a URL rule does not run again when you switch back to its tab', () => {
    localStorage.setItem(A.KEY, JSON.stringify([{ id: 'a1', name: 'Mail', enabled: true, trigger: { type: 'url', value: 'mail.test' }, action: { type: 'open', value: 'https://cal.test' } }]));
    let url = 'https://mail.test/inbox';
    globalThis.TabManager = { getActiveTab: () => ({ url }), createTab: vi.fn() };
    A._tickUrl(); url = 'https://other.test/'; A._tickUrl(); url = 'https://mail.test/inbox'; A._tickUrl();
    expect(TabManager.createTab).toHaveBeenCalledTimes(1);
  });

  it('a missing command is an error, not a success toast', () => {
    globalThis.CommandBar = { commands: [] };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    A._runAction({ name: 'Gone', action: { type: 'command', value: 'no-such' } });
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/did not run.*no-such/), 'error');
    err.mockRestore();
  });

  it('"8:30" is the same time as "08:30"; nonsense is not a time', () => {
    expect(A._normTime('8:30')).toBe('08:30');
    expect(A._normTime('08:30')).toBe('08:30');
    expect(A._normTime('24:00')).toBe(null);
    expect(A._normTime('soon')).toBe(null);
  });
});

describe('subscribed calendars', () => {
  const { IcsCalendar: C } = require('../../src/renderer/js/ics-calendar.js');
  const day = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
  const ev = (start, rrule) => ({ start, end: start + 3600000, rrule, exdates: [], summary: 'x' });
  beforeEach(() => { window.VexProblems = { note: vi.fn() }; });

  it('a daily event begun four years ago still shows today', () => {
    const out = C.expand(ev(day(2022, 9, 1, 9), 'FREQ=DAILY'), day(2026, 9, 29), day(2026, 9, 30));
    expect(out.map(o => o.start)).toEqual([day(2026, 9, 29, 9)]);
  });

  it('monthly on the 31st skips the shorter months instead of rolling over', () => {
    const out = C.expand(ev(day(2026, 1, 31, 9), 'FREQ=MONTHLY'), day(2026, 1, 1), day(2026, 8, 1));
    expect(out.map(o => new Date(o.start).getMonth() + 1 + '/' + new Date(o.start).getDate())).toEqual(['1/31', '3/31', '5/31', '7/31']);
  });

  it('yearly on 29 February comes only in leap years', () => {
    const out = C.expand(ev(day(2024, 2, 29, 9), 'FREQ=YEARLY'), day(2024, 1, 1), day(2029, 1, 1));
    expect(out.map(o => new Date(o.start).getFullYear())).toEqual([2024, 2028]);
  });
});

describe('the sticky card', () => {
  it('a position saved in a bigger window is pulled back on screen', async () => {
    const { StickyNotes } = await import('../../src/renderer/js/sticky-notes.js');
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://example.com/p', title: 'P' }) };
    localStorage.setItem('vex.stickyPos', JSON.stringify({ x: 5000, y: 4000 }));
    StickyNotes.open();
    const card = document.getElementById('vex-sticky');
    expect(parseInt(card.style.left, 10)).toBeLessThanOrEqual(window.innerWidth - 80);
    expect(parseInt(card.style.top, 10)).toBeLessThanOrEqual(window.innerHeight - 40);
    card.remove();
  });
});

describe('queue panel', () => {
  it('a refused Delete or Done says so', async () => {
    const { QueuePanel } = await import('../../src/renderer/js/queue-panel.js');
    QueuePanel.config = { queueUrl: 'https://q.test', queueSecret: 's' };
    window.showToast = vi.fn();
    window.VexNet = { fetch: vi.fn(async () => ({ ok: false, status: 500 })) };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await QueuePanel.deleteItem('x');
    await QueuePanel.markDone('x');
    expect(window.showToast.mock.calls.map(c => c[1])).toEqual(['error', 'error']);
    err.mockRestore();
    QueuePanel.config = { queueUrl: '', queueSecret: '' };
    delete window.VexNet;
  });
});

describe('tasks inside a code block', () => {
  const fenced = '```\n- [ ] not a task\n```\n- [ ] real one';
  it('NotesPanel ticks the real task, not the code', () => {
    const { NotesPanel } = require('../../src/renderer/js/notes-panel.js');
    expect(NotesPanel.toggleTask(fenced, 0)).toBe('```\n- [ ] not a task\n```\n- [x] real one');
  });
  it('OpenTasks lists and ticks only the real task', () => {
    const { OpenTasks } = require('../../src/renderer/js/open-tasks.js');
    const tasks = OpenTasks.collect([{ id: 'n', title: 'N', content: fenced }]);
    expect(tasks.map(t => [t.text, t.index])).toEqual([['real one', 0]]);
    expect(OpenTasks._toggle(fenced, 0)).toBe('```\n- [ ] not a task\n```\n- [x] real one');
  });
});

describe('feeds', () => {
  it('a relative item link is read against the feed address', () => {
    const { VexFeeds } = require('../../src/renderer/js/rss.js');
    const xml = '<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item><title>a</title><link>/posts/1</link></item></channel></rss>';
    expect(VexFeeds.parse(xml, '', 'https://blog.test/feed.xml')[0].link).toBe('https://blog.test/posts/1');
    const atom = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><entry><title>b</title><link href="2"/></entry></feed>';
    expect(VexFeeds.parse(atom, '', 'https://blog.test/atom/')[0].link).toBe('https://blog.test/atom/2');
  });
});

describe('meeting mode', () => {
  it('opens its note, as the toast says, and holds reminders as "meeting"', () => {
    const { MeetingMode } = require('../../src/renderer/js/meeting-mode.js');
    localStorage.clear();
    window.vex = { reminders: { hold: vi.fn(async () => 0) } };
    window.showToast = vi.fn();
    const show = vi.spyOn(MeetingMode, 'showNote').mockImplementation(() => null);
    vi.spyOn(MeetingMode, '_muteOthers').mockImplementation(() => []);
    MeetingMode.start();
    expect(show).toHaveBeenCalled();
    expect(window.vex.reminders.hold).toHaveBeenCalledWith(expect.any(Number), 'meeting');
    MeetingMode._save(null);
    vi.restoreAllMocks();
  });
});

describe('small ones', () => {
  it('ScheduleWords says 21st, 22nd, 23rd, 31st, 11th', () => {
    const { ScheduleWords } = require('../../src/renderer/js/schedule-words.js');
    const say = (n) => ScheduleWords.describe({ type: 'monthly', dayOfMonth: n, time: '09:00' });
    expect([21, 22, 23, 31, 11, 12, 13, 1].map(say)).toEqual(['on the 21st at 09:00', 'on the 22nd at 09:00', 'on the 23rd at 09:00', 'on the 31st at 09:00', 'on the 11th at 09:00', 'on the 12th at 09:00', 'on the 13th at 09:00', 'on the 1st at 09:00']);
  });

  it('Expenses will not relabel past amounts as another currency', () => {
    const { Expenses } = require('../../src/renderer/js/expenses.js');
    localStorage.clear();
    Expenses.setCurrency('EUR');                               // empty log: fine
    Expenses.add({ amount: '12', category: 'Food' });
    expect(() => Expenses.setCurrency('USD')).toThrow(/cannot convert/);
    expect(Expenses.currency()).toBe('EUR');
  });

  it('Flashcards says when a card could not be saved', () => {
    const { Flashcards } = require('../../src/renderer/js/flashcards.js');
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => Flashcards.save([])).toThrow(/could not be saved/);
    set.mockRestore();
  });
});
