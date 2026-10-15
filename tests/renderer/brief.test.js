// @vitest-environment jsdom
//
// Morning Brief: a registry of isolated sections. One section failing is that
// section's own error; mail is opt-in and its model summary stays local.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const { VexBrief } = require('../../src/renderer/js/brief.js');
const { BriefSections } = require('../../src/renderer/js/brief-sections.js');

const NOW = new Date(2026, 9, 16, 9, 0).getTime();   // Fri 16 Oct 2026, 09:00
const at = (h, m = 0) => new Date(2026, 9, 16, h, m).getTime();

function fresh() {
  for (const d of VexBrief.defs()) VexBrief.unregister(d.id);
  localStorage.clear();
  VexBrief._last = null;
}

describe('the registry', () => {
  beforeEach(fresh);

  it('refuses a section with no id or no build()', () => {
    expect(() => VexBrief.register({ build() {} })).toThrow(/id/);
    expect(() => VexBrief.register({ id: 'x' })).toThrow(/build/);
  });

  it('one section throwing or hanging does not blank the others', async () => {
    VexBrief.TIMEOUT_MS = 30;
    VexBrief.register({ id: 'good', title: 'Good', order: 1, build: () => ({ summary: 'fine' }) });
    VexBrief.register({ id: 'bad', title: 'Bad', order: 2, build: () => { throw new Error('boom'); } });
    VexBrief.register({ id: 'slow', title: 'Slow', order: 3, build: () => new Promise(() => {}) });
    const out = await VexBrief.build({ now: NOW });
    const by = Object.fromEntries(out.sections.map(s => [s.id, s]));
    expect(by.good.status).toBe('ok');
    expect(by.good.summary).toBe('fine');
    expect(by.bad.status).toBe('error');
    expect(by.bad.error).toBe('boom');
    expect(by.slow.status).toBe('error');
    expect(by.slow.error).toMatch(/in time/);
    VexBrief.TIMEOUT_MS = 8000;
  });

  it('keeps a slow section\'s answer for its ttl, and force reads it again', async () => {
    const build = vi.fn(() => ({ summary: 'n' }));
    VexBrief.register({ id: 'slow', title: 'S', ttlMs: 60000, build });
    await VexBrief.build({ now: NOW });
    await VexBrief.build({ now: NOW + 1000 });
    expect(build).toHaveBeenCalledTimes(1);
    await VexBrief.build({ now: NOW + 2000, force: true });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('an opt-in section is off until chosen; others follow their default', () => {
    VexBrief.register({ id: 'mail', title: 'Mail', optIn: true, defaultOn: false, build: () => null });
    VexBrief.register({ id: 'news', title: 'News', build: () => null });
    expect(VexBrief.isEnabled('mail')).toBe(false);
    expect(VexBrief.isEnabled('news')).toBe(true);
    VexBrief.setEnabled('mail', true);
    VexBrief.setEnabled('news', false);
    expect(VexBrief.isEnabled('mail')).toBe(true);
    expect(VexBrief.isEnabled('news')).toBe(false);
    expect(() => VexBrief.setEnabled('nope', true)).toThrow(/No such/);
  });

  it('reorders, ignores unknown ids and appends sections added later', () => {
    VexBrief.register({ id: 'a', order: 1, build: () => null });
    VexBrief.register({ id: 'b', order: 2, build: () => null });
    VexBrief.register({ id: 'c', order: 3, build: () => null });
    VexBrief.move('c', -1);
    expect(VexBrief.orderedIds()).toEqual(['a', 'c', 'b']);
    VexBrief.setPrefs({ order: ['b', 'gone', 'a'] });
    expect(VexBrief.orderedIds()).toEqual(['b', 'a', 'c']);
    expect(VexBrief.move('b', -1)).toEqual(['b', 'a', 'c']);   // already first
  });

  it('builds nothing at all when the brief is turned off', async () => {
    const build = vi.fn(() => ({ summary: 'x' }));
    VexBrief.register({ id: 'a', build });
    VexBrief.setPrefs({ enabled: false });
    const out = await VexBrief.build({ now: NOW });
    expect(out.enabled).toBe(false);
    expect(out.sections).toEqual([]);
    expect(build).not.toHaveBeenCalled();
  });

  it('normalises a payload: bounded, http(s) links only, empty is empty', () => {
    const def = { id: 'a', title: 'A', icon: 'mail', maxItems: 2 };
    const out = VexBrief.normalise(def, {
      items: [{ text: 'x'.repeat(500), url: 'javascript:alert(1)' }, { text: 'b', url: 'https://ok.example/' }, { text: 'c' }],
      action: { label: 'Go', cmd: { type: 'brief-refresh' } },
    });
    expect(out.items).toHaveLength(2);
    expect(out.items[0].text).toHaveLength(200);
    expect(out.items[0].url).toBe('');
    expect(out.items[1].url).toBe('https://ok.example/');
    expect(VexBrief.normalise(def, null).status).toBe('empty');
    expect(VexBrief.normalise(def, { items: [] }).status).toBe('empty');
    expect(VexBrief.normalise(def, { hint: 'turn me on' }).status).toBe('hint');
  });

  it('greets by the hour and names the date', () => {
    expect(VexBrief.greeting(at(8)).text).toBe('Good morning');
    expect(VexBrief.greeting(at(14)).text).toBe('Good afternoon');
    expect(VexBrief.greeting(at(21)).text).toBe('Good evening');
    expect(VexBrief.greeting(at(8)).date).toMatch(/\d/);
  });
});

describe('commands from the start page', () => {
  beforeEach(fresh);
  afterEach(() => { delete globalThis.SessionManager; delete window.showToast; });

  it('opens only a session the last snapshot offered', async () => {
    const restoreSession = vi.fn();
    globalThis.SessionManager = { restoreSession };
    window.showToast = vi.fn();
    VexBrief._last = { sections: [{ id: 'resume', items: [{ cmd: { type: 'brief-resume', id: 's1' } }] }] };
    await VexBrief.onStartCommand({ type: 'brief-resume', id: 'evil' });
    expect(restoreSession).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalled();
    await VexBrief.onStartCommand({ type: 'brief-resume', id: 's1' });
    expect(restoreSession).toHaveBeenCalledWith('s1', false);
  });

  it('refuses a file path that was not offered', async () => {
    const createTab = vi.fn();
    globalThis.TabManager = { createTab };
    window.showToast = vi.fn();
    VexBrief._last = { sections: [{ id: 'saved', items: [{ cmd: { type: 'brief-open-file', path: 'C:\\clips\\a.mp4' } }] }] };
    await VexBrief.onStartCommand({ type: 'brief-open-file', path: 'C:\\Windows\\system32\\cmd.exe' });
    expect(createTab).not.toHaveBeenCalled();
    await VexBrief.onStartCommand({ type: 'brief-open-file', path: 'C:\\clips\\a.mp4' });
    expect(createTab).toHaveBeenCalledWith('file:///C:/clips/a.mp4', true);
    delete globalThis.TabManager;
  });
});

describe('the pure helpers', () => {
  it('finds the longest free stretch between what is on', () => {
    const busy = [{ at: at(10), minutes: 60, text: 'Standup' }, { at: at(13), end: at(14), text: 'Lunch' }];
    const f = BriefSections.focusSuggestion(busy, NOW);
    // 09:00-10:00 (60), 11:00-13:00 (120), 14:00-18:00 (240)
    expect(BriefSections.hhmm(f.best.from)).toBe('14:00');
    expect(BriefSections.hhmm(f.best.to)).toBe('18:00');
    expect(f.minutes).toBe(240);
    expect(f.next.text).toBe('Standup');
  });

  it('says so when the day is empty or over', () => {
    const empty = BriefSections.focusSuggestion([], NOW);
    expect(empty.empty).toBe(true);
    expect(empty.minutes).toBe(9 * 60);
    expect(BriefSections.focusSuggestion([], at(17, 55))).toBeNull();
  });

  it('has no best stretch when the day is packed', () => {
    const busy = [{ at: at(9), end: at(18), text: 'All day workshop' }];
    expect(BriefSections.focusSuggestion(busy, NOW).best).toBeNull();
  });

  it('reads a model reply that is prose or JSON', () => {
    expect(BriefSections.plainReply('Two need you.')).toBe('Two need you.');
    expect(BriefSections.plainReply('{"reply":"Two need you."}')).toBe('Two need you.');
    expect(BriefSections.plainReply(null)).toBe('');
  });

  it('digests an inbox into counts, senders and subjects, without bodies', () => {
    const triage = require('../../src/renderer/js/inbox-triage.js').InboxTriage;
    const inbox = {
      unseen: 3,
      messages: [
        { uid: 1, subject: 'Can you review this?', from: { name: 'Dana', address: 'dana@x.com' }, seen: false, date: 3 },
        { uid: 2, subject: 'Your receipt', from: { name: 'Shop', address: 'no-reply@shop.com' }, seen: false, date: 2 },
        { uid: 3, subject: 'Lunch', from: { name: 'Sam', address: 'sam@x.com' }, seen: true, date: 1 },
      ],
    };
    const d = BriefSections.mailDigest({ email: 'me@x.com' }, inbox, triage);
    expect(d.label).toBe('me@x.com');
    expect(d.unseen).toBe(3);
    expect(d.needs).toBe(1);
    expect(d.bulk).toBe(1);
    expect(d.senders).toEqual(['Dana']);
    expect(BriefSections.mailPrompt([d])).toContain('Can you review this?');
    expect(Object.keys(d).sort()).toEqual(['bulk', 'label', 'look', 'needs', 'senders', 'subjects', 'unseen']);
  });

  it('remembers GitHub announcements for a day and marks failures', () => {
    localStorage.clear();
    BriefSections.recordGh({ text: 'CI failed — a/b', url: 'https://github.com/a/b/actions/runs/1' }, NOW);
    BriefSections.recordGh({ text: 'New release of a/b: v2', url: 'javascript:x' }, NOW + 1000);
    const ev = BriefSections.ghEvents(NOW + 2000);
    expect(ev).toHaveLength(2);
    expect(ev.find(e => /failed/.test(e.text)).failed).toBe(true);
    expect(ev.find(e => /release/.test(e.text)).url).toBe('');
    expect(BriefSections.ghEvents(NOW + 25 * 3600000)).toHaveLength(0);
  });
});

describe('the registered sections', () => {
  beforeEach(() => {
    fresh();
    BriefSections.registerAll(VexBrief);
    window.vex = undefined;
  });
  afterEach(() => {
    for (const g of ['AINews', 'AIRouter', 'InboxTriage']) delete globalThis[g];
    delete window.vex;
  });

  it('registers every promised section, mail off by default', () => {
    expect(VexBrief.defs().map(d => d.id)).toEqual(['ai-news', 'mail', 'github', 'schedule', 'watched', 'radar', 'resume', 'saved', 'numbers', 'focus']);
    expect(VexBrief.isEnabled('mail')).toBe(false);
    expect(VexBrief.isEnabled('ai-news')).toBe(true);
  });

  it('AI news says it is off, then lists unread top stories by importance', async () => {
    globalThis.AINews = { prefs: () => ({ enabled: false }), list: () => [] };
    let out = await VexBrief.build({ now: NOW });
    expect(out.sections.find(s => s.id === 'ai-news').status).toBe('hint');
    globalThis.AINews = {
      prefs: () => ({ enabled: true }),
      list: () => [
        { id: 'a', title: 'Minor', url: 'https://n/a', source: 'S', importance: 10, publishedAt: NOW - 3600000 },
        { id: 'b', title: 'Major', url: 'https://n/b', source: 'S', importance: 90, publishedAt: NOW - 7200000 },
        { id: 'c', title: 'Read', url: 'https://n/c', source: 'S', importance: 99, read: true, publishedAt: NOW - 1000 },
        { id: 'd', title: 'Old', url: 'https://n/d', source: 'S', importance: 99, publishedAt: NOW - 5 * 86400000 },
      ],
    };
    VexBrief._cache.clear();
    out = await VexBrief.build({ now: NOW });
    const s = out.sections.find(x => x.id === 'ai-news');
    expect(s.items.map(i => i.text)).toEqual(['Major', 'Minor']);
  });

  it('the schedule orders calendar, reminders and tasks and marks overdue', async () => {
    const snap = {
      events: [{ text: 'Dentist', at: at(15), end: at(16), allDay: false }],
      reminders: [{ text: 'Call Dana', at: at(8), overdue: true }, { text: 'When on GitHub', at: null, site: 'github.com' }],
      tasks: [{ text: 'Nightly sweep', at: at(11), action: 'Open pages' }],
    };
    const out = await VexBrief.build({ now: NOW, snap });
    const s = out.sections.find(x => x.id === 'schedule');
    expect(s.items.map(i => i.text)).toEqual(['Call Dana', 'Nightly sweep', 'Dentist', 'When on GitHub']);
    expect(s.items[0].badge).toBe('Overdue');
    expect(s.summary).toMatch(/4 things today, 1 overdue/);
  });

  it('mail reads nothing until an account is chosen', async () => {
    VexBrief.setEnabled('mail', true);
    const inbox = vi.fn();
    window.vex = { mail: { accounts: vi.fn(async () => ({ ok: true, value: [{ id: 'm1', email: 'me@x.com' }] })), inbox } };
    globalThis.InboxTriage = require('../../src/renderer/js/inbox-triage.js').InboxTriage;
    let out = await VexBrief.build({ now: NOW });
    expect(out.sections.find(s => s.id === 'mail').status).toBe('hint');
    expect(inbox).not.toHaveBeenCalled();
  });

  it('mail summary: counts when no local model, model only when it resolves local', async () => {
    VexBrief.setEnabled('mail', true);
    VexBrief.setPrefs({ mailAccounts: ['m1'], mailAi: true });
    window.vex = { mail: {
      accounts: async () => ({ ok: true, value: [{ id: 'm1', email: 'me@x.com' }] }),
      inbox: async () => ({ ok: true, value: { unseen: 2, messages: [{ uid: 1, subject: 'Can you sign?', from: { name: 'Dana', address: 'd@x.com' }, seen: false, date: 1 }] } }),
    } };
    globalThis.InboxTriage = require('../../src/renderer/js/inbox-triage.js').InboxTriage;
    const callAI = vi.fn(async () => ({ result: 'One needs a signature.' }));
    globalThis.AIRouter = { resolveBackend: vi.fn(async () => 'cloud'), callAI };
    let s = (await VexBrief.build({ now: NOW, force: true })).sections.find(x => x.id === 'mail');
    expect(callAI).not.toHaveBeenCalled();             // cloud: mail text never goes
    expect(s.summary).toMatch(/2 unread messages across 1 account/);
    expect(s.items.some(i => i.text === 'Can you sign?')).toBe(true);
    globalThis.AIRouter.resolveBackend = vi.fn(async () => 'local');
    s = (await VexBrief.build({ now: NOW, force: true })).sections.find(x => x.id === 'mail');
    expect(callAI).toHaveBeenCalledTimes(1);
    expect(callAI.mock.calls[0][0]).toBe('digest');
    expect(s.summary).toBe('One needs a signature.');
  });
});
