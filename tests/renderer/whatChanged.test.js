// @vitest-environment jsdom
//
// T2-046: what changed in a workspace since you last looked (js/what-changed.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const NOW = new Date(2026, 9, 14, 9, 0, 0).getTime();
const H = 3600000;

let C;
const watch = (id, url, changedH, extra = {}) => ({ id, url, title: 'Watch ' + id, lastChangedAt: changedH == null ? 0 : NOW - changedH * H, ...extra });

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  globalThis.VexPlanKit = fresh(JS + 'plan-kit.js').VexPlanKit;
  ({ VexChanged: C } = fresh(JS + 'what-changed.js'));
  globalThis.WorkspaceManager = {
    activeId: 'ws_work',
    workspaces: [
      { id: 'ws_work', name: 'Work', tabs: [] },
      { id: 'ws_school', name: 'School', tabs: [{ url: 'https://school.test/grades' }, { url: 'https://docs.test/course' }] },
    ],
    getActive() { return this.workspaces.find(w => w.id === this.activeId); },
  };
  globalThis.TabManager = { tabs: [{ url: 'https://ci.test/builds/main' }] };
  delete globalThis.PageWatchDiff; delete globalThis.VexAttention;
});

describe('matches()', () => {
  it('matches the same page, a page under a tab, or a tab under the page', () => {
    const tabs = ['https://www.school.test/grades/', 'https://docs.test/course/week1'];
    expect(C.matches('https://school.test/grades', tabs)).toBe(true);
    expect(C.matches('https://docs.test/course/week1/notes', tabs)).toBe(true);
    expect(C.matches('https://docs.test/', tabs)).toBe(true);
    expect(C.matches('https://other.test/grades', tabs)).toBe(false);
    expect(C.matches('garbage', tabs)).toBe(false);
  });
});

describe('changed()', () => {
  const ws = [watch('a', 'https://school.test/grades', 1), watch('b', 'https://school.test/grades', 10), watch('c', 'https://docs.test/course', 2, { paused: true }), watch('d', 'https://other.test/', 1), watch('e', 'https://docs.test/course', null)];
  const urls = ['https://school.test/grades', 'https://docs.test/course'];
  it('lists only real changes after the moment you looked, in the tabs of the workspace, newest first', () => {
    const rows = C.changed(ws, urls, NOW - 5 * H);
    expect(rows.map(w => w.id)).toEqual(['a']);
    expect(C.changed(ws, urls, NOW - 20 * H).map(w => w.id)).toEqual(['a', 'b']);
  });
  it('says nothing when you have never looked (the first sight is the baseline)', () => {
    expect(C.changed(ws, urls, 0)).toEqual([]);
  });
});

describe('forWorkspace()', () => {
  beforeEach(() => {
    globalThis.PageWatch = { list: () => [watch('a', 'https://school.test/grades', 1), watch('x', 'https://ci.test/builds/main', 1)], history: (id) => (id === 'a' ? [{ text: 'A\nB' }, { text: 'A\nB\nC' }] : []) };
  });
  it('stamps the first sight and returns nothing', () => {
    expect(C.forWorkspace('ws_school', NOW)).toEqual([]);
    expect(C.seen().ws_school).toBe(NOW);
  });
  it('reads a background workspace from its saved tabs and the active one from the open tabs', () => {
    C.stamp('ws_school', NOW - 5 * H); C.stamp('ws_work', NOW - 5 * H);
    expect(C.forWorkspace('ws_school', NOW).map(i => i.watch.id)).toEqual(['a']);
    expect(C.forWorkspace('ws_work', NOW).map(i => i.watch.id)).toEqual(['x']);
  });
  it('uses the diff headline when the diff helper exists, else just "changed"', () => {
    expect(C.summaryOf([{ text: 'A' }, { text: 'A\nB' }])).toBe('changed');
    globalThis.PageWatchDiff = { lineDiff: () => ({ added: ['B'], removed: [] }), summarize: () => ({ headline: '1 line added' }) };
    expect(C.summaryOf([{ text: 'A' }, { text: 'A\nB' }])).toBe('1 line added');
    expect(C.summaryOf([])).toBe('changed');
  });
  it('raises when page watch is not loaded', () => {
    delete globalThis.PageWatch;
    expect(() => C.forWorkspace('ws_school', NOW)).toThrow(/Page watch is not loaded/);
  });
});

describe('switching into a workspace', () => {
  beforeEach(() => {
    globalThis.PageWatch = { list: () => [watch('a', 'https://school.test/grades', 1)], history: () => [] };
    window.showToast = vi.fn();
  });
  it('offers the changes after three hours or more away, through the attention gate', () => {
    const notify = vi.fn((o, show) => { show(); return { route: 'toast' }; });
    globalThis.VexAttention = { notify };
    C.init();                                              // remembers ws_work
    C.stamp('ws_school', NOW - 6 * H);
    WorkspaceManager.activeId = 'ws_school';
    expect(C.onTabsChanged(NOW)).toBe(true);
    expect(notify.mock.calls[0][0]).toMatchObject({ feature: 'workspace-changes', urgency: 'useful' });
    expect(C.seen().ws_work).toBe(NOW);                    // leaving counts as looking
  });
  it('stays quiet for a short absence, an unchanged workspace and a first sight', () => {
    globalThis.VexAttention = { notify: vi.fn() };
    C._ws = 'ws_work';
    C.stamp('ws_school', NOW - 1 * H);
    WorkspaceManager.activeId = 'ws_school';
    expect(C.onTabsChanged(NOW)).toBe(false);
    expect(globalThis.VexAttention.notify).not.toHaveBeenCalled();
  });
  it('does nothing when switched off', () => {
    C.setEnabled(false);
    expect(C.onTabsChanged(NOW)).toBe(false);
  });
});

describe('brief module', () => {
  it('is empty without changes and lists them with their summary when there are', async () => {
    globalThis.PageWatch = { list: () => [watch('x', 'https://ci.test/builds/main', 1, { lastChangedAt: Date.now() })], history: () => [] };
    C.stamp('ws_work', Date.now() - 5 * H);
    const out = await C.briefModule().build();
    expect(out.lines[0].text).toBe('Watch x');
    expect(out.summary).toMatch(/1 watched page changed in Work/);
  });
});

describe('new comments on watched GitHub threads (T2-046)', () => {
  const thread = (id, n) => watch(id, 'https://github.com/o/r/issues/' + n, 1, { lastChangedAt: 0 });
  let json;
  beforeEach(() => {
    globalThis.TabManager = { tabs: [{ url: 'https://github.com/o/r/issues/7' }, { url: 'https://github.com/o/r/issues/9' }] };
    globalThis.PageWatch = { list: () => [thread('t7', 7), thread('t9', 9), watch('other', 'https://github.com/o/r/releases', 1)], history: () => [] };
    json = vi.fn(async (path) => ({ comments: path.endsWith('/7') ? 5 : 2 }));
    globalThis.GitHubVault = { json };
  });
  it('parses issue and pull request addresses only', () => {
    expect(C.githubThread('https://github.com/o/r/issues/7')).toEqual({ owner: 'o', repo: 'r', number: 7 });
    expect(C.githubThread('https://github.com/o/r/pull/9/files')).toEqual({ owner: 'o', repo: 'r', number: 9 });
    expect(C.githubThread('https://github.com/o/r/releases')).toBeNull();
    expect(C.githubThread('https://gitlab.com/o/r/issues/1')).toBeNull();
  });
  it('is off until switched on: no request is made', async () => {
    expect(await C.commentNews('ws_work')).toEqual([]);
    expect(json).not.toHaveBeenCalled();
  });
  it('takes the first count as the baseline, then reports only more comments', async () => {
    C.setSource('comments', true);
    expect(await C.commentNews('ws_work')).toEqual([]);
    expect(json).toHaveBeenCalledTimes(2);
    json.mockImplementation(async (path) => ({ comments: path.endsWith('/7') ? 8 : 2 }));
    const news = await C.commentNews('ws_work');
    expect(news.map(n => [n.watch.id, n.added, n.total])).toEqual([['t7', 3, 8]]);
    expect(await C.commentNews('ws_work')).toHaveLength(1);        // still news until you have looked
    C.stamp('ws_work', NOW);
    expect(await C.commentNews('ws_work')).toEqual([]);
  });
  it('raises when GitHub access is missing or says nothing useful', async () => {
    C.setSource('comments', true);
    json.mockImplementation(async () => ({}));
    await expect(C.commentNews('ws_work')).rejects.toThrow(/did not say how many comments/);
    delete globalThis.GitHubVault;
    await expect(C.commentNews('ws_work')).rejects.toThrow(/GitHub access is not loaded/);
  });
  it('shows in the brief when on', async () => {
    C.setSource('comments', true);
    C.stamp('ws_work', Date.now() - 5 * H);
    await C.commentNews('ws_work');
    json.mockImplementation(async () => ({ comments: 10 }));
    const out = await C.briefModule().build();
    expect(out.summary).toMatch(/new comments in Work/);
    expect(out.lines.some(l => /new comment/.test(l.detail))).toBe(true);
  });
});

describe('new mail from the sites of watched pages (T2-046)', () => {
  const SINCE = NOW - 5 * H;
  let inbox;
  beforeEach(() => {
    globalThis.TabManager = { tabs: [{ url: 'https://shop.example/track/123' }] };
    globalThis.PageWatch = { list: () => [watch('s', 'https://shop.example/track/123', 1)], history: () => [] };
    const msg = (uid, addr, seen, ago) => ({ uid, subject: 'S' + uid, from: { name: '', address: addr }, date: NOW - ago * H, seen });
    inbox = vi.fn(async () => ({ ok: true, value: { messages: [msg(1, 'orders@mail.shop.example', false, 1), msg(2, 'x@elsewhere.test', false, 1), msg(3, 'orders@shop.example', true, 1), msg(4, 'orders@shop.example', false, 9)] } }));
    window.vex = { mail: { accounts: vi.fn(async () => ({ ok: true, value: [{ id: 'a1' }] })), inbox } };
  });
  it('is off until switched on: no mail is asked for', async () => {
    expect(await C.mailNews('ws_work', SINCE)).toEqual([]);
    expect(window.vex.mail.accounts).not.toHaveBeenCalled();
  });
  it('lists only unread mail since you looked from the same site as a watched page', async () => {
    C.setSource('mail', true);
    const out = await C.mailNews('ws_work', SINCE);
    expect(out.map(m => m.subject)).toEqual(['S1']);
    expect(inbox).toHaveBeenCalledWith('a1', 30);
  });
  it('asks nothing when no page is watched in the workspace, or you never looked', async () => {
    C.setSource('mail', true);
    expect(await C.mailNews('ws_work', 0)).toEqual([]);
    globalThis.PageWatch = { list: () => [], history: () => [] };
    expect(await C.mailNews('ws_work', SINCE)).toEqual([]);
    expect(window.vex.mail.accounts).not.toHaveBeenCalled();
  });
  it('raises when mail does not answer', async () => {
    C.setSource('mail', true);
    inbox.mockImplementation(async () => ({ ok: false, error: 'Mail: connect ECONNREFUSED' }));
    await expect(C.mailNews('ws_work', SINCE)).rejects.toThrow(/ECONNREFUSED/);
  });
  it('matches sites with or without a subdomain, both ways', () => {
    expect(C.sameSite('mail.shop.example', 'shop.example')).toBe(true);
    expect(C.sameSite('shop.example', 'www.shop.example')).toBe(true);
    expect(C.sameSite('evilshop.example', 'shop.example')).toBe(false);
  });
});
