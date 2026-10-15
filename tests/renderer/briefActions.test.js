// @vitest-environment jsdom
//
// The brief-actions group: snooze anything, one-tap mail triage and drafts,
// the GitHub desk, interests, time-of-day layout, next action, lost-tab finder.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { VexSnooze } = require('../../src/renderer/js/snooze-anything.js');
const { MailTriage } = require('../../src/renderer/js/mail-triage-actions.js');
const { InboxTriage } = require('../../src/renderer/js/inbox-triage.js');
const { GitHubDesk } = require('../../src/renderer/js/github-desk.js');
const { VexInterests } = require('../../src/renderer/js/interests-profile.js');
const { VexDayLayout } = require('../../src/renderer/js/day-layout.js');
const { VexNextAction } = require('../../src/renderer/js/next-action.js');
const { LostTabFinder } = require('../../src/renderer/js/lost-tab-finder.js');
const { BriefActions } = require('../../src/renderer/js/brief-actions.js');
const { mailtoUrl } = require('../../src/main/mail-draft.js');

// Wednesday 2026-10-14 15:30 local.
const NOW = new Date(2026, 9, 14, 15, 30, 0).getTime();

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ now: NOW });
  window.showToast = vi.fn();
  globalThis.VexProblems = { note: vi.fn() };
  window.VexProblems = globalThis.VexProblems;
  globalThis.InboxTriage = InboxTriage;
  globalThis.VexSnooze = VexSnooze;
  globalThis.MailTriage = MailTriage;
  globalThis.BriefActions = BriefActions;
});
afterEach(() => { vi.useRealTimers(); delete globalThis.TabSnooze; delete globalThis.Recall; delete globalThis.HistoryPanel; delete globalThis.AIRouter; });

describe('parseWhen', () => {
  const at = (t) => VexSnooze.parseWhen(t, NOW);
  it('understands relative and named times', () => {
    expect(at('in 2 hours').at).toBe(NOW + 2 * 3600000);
    expect(at('in an hour').at).toBe(NOW + 3600000);
    expect(new Date(at('tomorrow morning').at).getHours()).toBe(9);
    expect(new Date(at('tomorrow morning').at).getDate()).toBe(15);
    expect(new Date(at('this evening').at).getHours()).toBe(19);
    expect(new Date(at('monday').at).getDay()).toBe(1);
    expect(new Date(at('weekend').at).getDay()).toBe(6);
    expect(new Date(at('tomorrow at 8am').at).getHours()).toBe(8);
  });
  it('refuses what it does not understand', () => {
    expect(at('whenever')).toBeNull();
    expect(at('')).toBeNull();
  });
});

describe('VexSnooze list', () => {
  it('stores, hides pending mail and returns due items', () => {
    VexSnooze.add('story', { title: 'A', url: 'https://a.example/x', ref: 'https://a.example/x' }, 'in 1 hour', NOW);
    expect(VexSnooze.due(NOW)).toHaveLength(0);
    expect(VexSnooze.isPending('story', 'https://a.example/x', NOW)).toBe(true);
    expect(VexSnooze.due(NOW + 2 * 3600000)).toHaveLength(1);
    expect(VexSnooze.section.build({ now: NOW + 2 * 3600000 }).items[0].text).toBe('A');
  });
  it('throws on an unknown time rather than doing nothing', () => {
    expect(() => VexSnooze.add('story', { title: 'A' }, 'whenever', NOW)).toThrow(/when/);
  });
  it('drops items long past due', () => {
    VexSnooze.add('page', { title: 'old', url: 'https://o.example/' }, NOW + 1000, NOW);
    expect(VexSnooze.due(NOW + 5 * 24 * 3600000)).toHaveLength(0);
    expect(VexSnooze.list()).toHaveLength(0);
  });
  it('snoozes a tab through TabSnooze', () => {
    globalThis.TabSnooze = { snooze: vi.fn(() => ({ id: 'sn_1', title: 'T', url: 'https://t.example/' })) };
    const e = VexSnooze.snoozeTab('t1', 'tomorrow morning', NOW);
    expect(TabSnooze.snooze).toHaveBeenCalled();
    expect(e.kind).toBe('tab');
  });
});

describe('mail triage', () => {
  const m = { uid: 7, messageId: '<abc@x>', subject: 'Can you review this?', from: { name: 'Ann', address: 'ann@example.com' }, seen: false };
  it('hides done mail and snoozed mail until due, and puts marked first', () => {
    const n = { uid: 8, messageId: '<n@x>', subject: 'Other', from: { address: 'b@example.com' } };
    expect(MailTriage.visible('acc', [n, m], NOW)).toHaveLength(2);
    MailTriage.mark('acc', m, NOW);
    expect(MailTriage.visible('acc', [n, m], NOW)[0]).toBe(m);
    MailTriage.done('acc', n, NOW);
    expect(MailTriage.visible('acc', [n, m], NOW)).toEqual([m]);
    MailTriage.snooze('acc', m, 'in 1 hour', NOW);
    expect(MailTriage.visible('acc', [n, m], NOW)).toEqual([]);
    expect(MailTriage.visible('acc', [n, m], NOW + 2 * 3600000)).toEqual([m]);
  });
  it('asks for a reply only for mail from people', () => {
    expect(MailTriage.needsReply(m)).toBe(true);
    expect(MailTriage.needsReply({ subject: 'Your receipt', from: { address: 'no-reply@shop.com' } })).toBe(false);
  });
  it('drafts with the local backend only and never composes by itself', async () => {
    window.vex = { mail: { message: vi.fn(async () => ({ ok: true, value: { subject: 'Hello', from: 'Ann <ann@example.com>', text: 'Can you send the file?', webmail: '' } })) }, composeMail: vi.fn() };
    globalThis.AIRouter = { callOn: vi.fn(async () => ({ result: '{"reply":"Sure, I will send it today."}' })), callAI: vi.fn() };
    const d = await MailTriage.draft('acc', m);
    expect(AIRouter.callOn).toHaveBeenCalledWith('local', 'chat', expect.objectContaining({ message: expect.stringContaining('Can you send the file?') }));
    expect(AIRouter.callAI).not.toHaveBeenCalled();
    expect(window.vex.composeMail).not.toHaveBeenCalled();
    expect(d.reply).toBe('Sure, I will send it today.');
    expect(d.to).toBe('ann@example.com');
    expect(d.subject).toBe('Re: Hello');
  });
  it('fails loudly when the local AI fails, with no fallback', async () => {
    window.vex = { mail: { message: vi.fn(async () => ({ ok: true, value: { subject: 'Hi', text: 'x y z', from: 'A' } })) } };
    globalThis.AIRouter = { callOn: vi.fn(async () => { throw new Error('Ollama is not running'); }), callAI: vi.fn() };
    await expect(MailTriage.draft('acc', m)).rejects.toThrow('Ollama is not running');
    expect(AIRouter.callAI).not.toHaveBeenCalled();
  });
});

describe('mailto with a recipient', () => {
  it('puts a plain address in and refuses anything else', () => {
    expect(mailtoUrl('Re: x', 'hi', 'ann@example.com').startsWith('mailto:ann@example.com?subject=')).toBe(true);
    expect(mailtoUrl('s', 'b').startsWith('mailto:?subject=')).toBe(true);
    expect(() => mailtoUrl('s', 'b', 'a@b.c?bcc=evil@x.y')).toThrow();
  });
});

describe('GitHub desk', () => {
  const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });
  it('lists pull requests, reviews and issues with their checks, public data only', async () => {
    localStorage.setItem('vex.githubUsername', 'me');
    const urls = [];
    GitHubDesk._fetch = async (url) => {
      urls.push(url);
      const u = decodeURIComponent(url);
      const item = (n, extra = {}) => ({ number: n, title: 'PR ' + n, html_url: 'https://github.com/o/r/pull/' + n, repository_url: 'https://api.github.com/repos/o/r', user: { login: 'x' }, updated_at: '2026-10-13T00:00:00Z', ...extra });
      if (u.includes('author:me is:pr')) return json({ items: [item(1, { pull_request: {} })] });
      if (u.includes('review-requested:me')) return json({ items: [item(2, { pull_request: {} })] });
      if (u.includes('assignee:me')) return json({ items: [item(3)] });
      if (/\/pulls\/\d+$/.test(u)) return json({ head: { sha: 'abc' } });
      if (u.includes('/status')) return json({ state: 'success', total_count: 1 });
      if (u.includes('/check-runs')) return json({ check_runs: [{ status: 'completed', conclusion: 'failure' }] });
      return json({}, 404);
    };
    const desk = await GitHubDesk.load({ force: true, now: NOW });
    expect(desk.mine[0].diffUrl).toBe('https://github.com/o/r/pull/1/files');
    expect(desk.mine[0].ci).toBe('failure');
    expect(desk.issues[0].diffUrl).toBe('');
    expect(GitHubDesk.attention(desk).failing).toHaveLength(2);
    expect(urls.every(x => x.startsWith('https://api.github.com'))).toBe(true);
    GitHubDesk._fetch = null;
  });
  it('says what is missing when no username is set', async () => {
    await expect(GitHubDesk.load({ force: true })).rejects.toThrow(/username/);
  });
});

describe('interests profile', () => {
  it('learns, ranks within a bounded lift and fades', () => {
    VexInterests.record(['topic:privacy', 'source:A'], NOW);
    VexInterests.record(['topic:privacy'], NOW);
    const items = [{ id: 'x', f: ['topic:games'], imp: 5 }, { id: 'y', f: ['topic:privacy'], imp: 4.5 }];
    const ranked = VexInterests.rank(items, i => i.f, i => i.imp, NOW);
    expect(ranked[0].id).toBe('y');
    const big = [{ id: 'x', f: ['topic:games'], imp: 9 }, { id: 'y', f: ['topic:privacy'], imp: 4 }];
    expect(VexInterests.rank(big, i => i.f, i => i.imp, NOW)[0].id).toBe('x');
    expect(VexInterests.score(['topic:privacy'], NOW + 30 * 86400000)).toBeCloseTo(VexInterests.score(['topic:privacy'], NOW) / 2, 1);
  });
  it('stores labels only, and resets', () => {
    VexInterests.record(['topic:privacy'], NOW);
    expect(localStorage.getItem('vex.interests')).not.toMatch(/http/);
    VexInterests.reset();
    expect(VexInterests.top()).toEqual([]);
  });
  it('is not one of the synced stores', () => {
    const fs = require('fs');
    expect(fs.readFileSync('src/renderer/js/sync-engine.js', 'utf8')).not.toMatch(/'vex\.(interests|dayLayout|nextAction|mailTriage|snoozeAnything)'/);
  });
});

describe('time-of-day layout', () => {
  it('moves what you use at this hour first, only after enough use', () => {
    const ids = ['news', 'mail', 'github'];
    for (let i = 0; i < 4; i++) VexDayLayout.record('github', NOW);
    expect(VexDayLayout.order(ids, NOW)).toEqual(ids);
    for (let i = 0; i < 8; i++) VexDayLayout.record('github', NOW);
    expect(VexDayLayout.order(ids, NOW)[0]).toBe('github');
    // Another part of the day: untouched.
    const night = new Date(2026, 9, 14, 3, 0, 0).getTime();
    expect(VexDayLayout.order(ids, night)).toEqual(ids);
  });
  it('does not reorder when the person ordered sections by hand', () => {
    for (let i = 0; i < 12; i++) VexDayLayout.record('github', NOW);
    localStorage.setItem('vex.briefActions.prefs', JSON.stringify({ dayLayout: true }));
    const brief = { orderedIds: () => ['news', 'github'], prefs: () => ({ order: ['news', 'github'] }) };
    window.VexDayLayout = VexDayLayout; globalThis.VexDayLayout = VexDayLayout;
    BriefActions._wrapOrder(brief);
    expect(brief.orderedIds()).toEqual(['news', 'github']);
    brief.prefs = () => ({ order: [] });
    expect(brief.orderedIds({ order: [] })[0]).toBe('github');
  });
});

describe('next action', () => {
  it('suggests only a step that nearly always follows', () => {
    let t = NOW;
    for (let i = 0; i < 4; i++) { VexNextAction.record('panel:mail', 'mail', t); VexNextAction.record('panel:github', 'github', t + 1000); t += 3600000; }
    VexNextAction.record('panel:mail', 'mail', t);
    const s = VexNextAction.suggest(null, t + 1000);
    expect(s.id).toBe('panel:github');
    expect(s.count).toBe(4);
    expect(VexNextAction.suggest(null, t + 2 * 3600000)).toBeNull();
  });
  it('does not suggest from a weak habit', () => {
    VexNextAction.record('cmd:a', '', NOW); VexNextAction.record('cmd:b', '', NOW + 1);
    expect(VexNextAction.suggest('cmd:a')).toBeNull();
  });
});

describe('lost-tab finder', () => {
  it('reads the time phrase and drops the filler', () => {
    const p = LostTabFinder.parse('that page about DPI throttling last week', NOW);
    expect(p.terms).toEqual(['dpi', 'throttling']);
    expect(p.since).toBeGreaterThan(0);
    expect(LostTabFinder.parse('recipe yesterday', NOW).label).toBe('yesterday');
  });
  it('leaves out private, Tor and excluded pages', async () => {
    globalThis.Recall = { enabled: () => true, meaningOn: () => false, isExcluded: (u) => u.includes('excluded.example'),
      search: async () => ({ hits: [
        { url: 'https://a.example/dpi', title: 'DPI notes', at: NOW - 86400000 },
        { url: 'https://excluded.example/dpi', title: 'DPI secret', at: NOW },
        { url: 'http://abcdefg.onion/dpi', title: 'DPI onion', at: NOW },
      ] }) };
    globalThis.HistoryPanel = { list: () => [
      { url: 'https://h.example/dpi', title: 'DPI history', visitedAt: new Date(NOW - 86400000).toISOString() },
      { url: 'https://p.example/dpi', title: 'DPI private', visitedAt: new Date(NOW).toISOString(), private: true },
    ] };
    const out = await LostTabFinder.find('page about dpi', { now: NOW });
    const urls = out.results.map(r => r.url).sort();
    expect(urls).toEqual(['https://a.example/dpi', 'https://h.example/dpi']);
  });
  it('never calls the AI router', async () => {
    globalThis.AIRouter = { callAI: vi.fn() };
    globalThis.Recall = { enabled: () => true, meaningOn: () => false, isExcluded: () => false, search: async () => ({ hits: [] }), searchSmart: vi.fn() };
    globalThis.HistoryPanel = { list: () => [] };
    await LostTabFinder.find('dpi', { now: NOW });
    expect(AIRouter.callAI).not.toHaveBeenCalled();
    expect(Recall.searchSmart).not.toHaveBeenCalled();
  });
});

describe('registration', () => {
  it('registers the sections, gated by the Settings switches', async () => {
    const reg = [];
    const n = BriefActions.registerAll({ register: (d) => reg.push(d) });
    expect(n).toBeGreaterThanOrEqual(4);
    const ids = reg.map(d => d.id);
    expect(ids).toEqual(expect.arrayContaining(['snoozed', 'github-desk']));
    // Observation features start off.
    expect(BriefActions.isOn('interests')).toBe(false);
    expect(BriefActions.isOn('nextAction')).toBe(false);
    const snoozed = reg.find(d => d.id === 'snoozed');
    BriefActions.set('snooze', false);
    VexSnooze.add('page', { title: 'P', url: 'https://p.example/' }, NOW + 1000, NOW - 5000);
    expect(await snoozed.build({ now: NOW + 5000 })).toBeNull();
  });
});
