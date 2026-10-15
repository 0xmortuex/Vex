// @vitest-environment jsdom
//
// Resume workday (js/resume-workday.js): "End of day" saves the working set as
// one named session per day plus the AI thread of the tab in front, and
// "Resume" opens the newest earlier day beside what is open now.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let W;
let sessions;
let restoreSession;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  window.showToast = vi.fn();
  window.VexTabPolicy = { isPrivateWindow: false, canShareTab: () => true };
  sessions = [];
  restoreSession = vi.fn(async () => {});
  let n = 0;
  globalThis.SessionManager = {
    get sessions() { return sessions; },
    set sessions(v) { sessions = v; },
    save: vi.fn(),
    saveCurrentSession: vi.fn((name) => {
      const s = { id: 's' + (++n), name, tabs: [{ id: 't1', url: 'https://a.test' }, { id: 't2', url: 'https://b.test' }] };
      sessions.unshift(s);
      return s;
    }),
    restoreSession,
  };
  globalThis.TabManager = { activeTabId: 't1', tabs: [{ id: 't1', url: 'https://a.test', title: 'A' }, { id: 't2', url: 'https://b.test', title: 'B' }] };
  const conv = [];
  globalThis.AIPanel = {
    _conversations: { t1: [{ role: 'user', content: 'hello', at: 1 }, { role: 'assistant', content: 'hi', at: 2 }] },
    _getConv(id) { return this._conversations[id] || (this._conversations[id] = conv); },
    _persistConversations: vi.fn(),
  };
  await import('../../src/renderer/js/resume-workday.js');
  W = window.VexWorkday;
});

afterEach(() => {
  delete globalThis.SessionManager; delete globalThis.TabManager; delete globalThis.AIPanel;
  vi.restoreAllMocks();
});

describe('VexWorkday', () => {
  it('end of day keeps one named session a day, with the thread', () => {
    const a = W.endOfDay();
    expect(a.tabs).toBe(2);
    expect(a.thread.msgs).toHaveLength(2);
    expect(sessions.some(s => s.workday === a.date)).toBe(true);
    const b = W.endOfDay();
    expect(W._all()).toHaveLength(1);
    expect(sessions.filter(s => s.workday === a.date)).toHaveLength(1);
    expect(b.sessionId).not.toBe(a.sessionId);
  });

  it('a tab the policy keeps private never gives its thread', () => {
    window.VexTabPolicy.canShareTab = () => false;
    expect(W.endOfDay().thread).toBeNull();
  });

  it('resume opens the newest earlier day and puts the thread back on a tab with none', async () => {
    const s = { id: 'old', name: 'Workday 2020-01-01', tabs: [] };
    sessions.push(s);
    localStorage.setItem(W.KEY, JSON.stringify([{ date: '2020-01-01', sessionId: 'old', savedAt: 5, tabs: 3, thread: { url: 'https://b.test', msgs: [{ role: 'user', content: 'x', at: 1 }] } }]));
    const day = await W.resume();
    expect(day.date).toBe('2020-01-01');
    expect(restoreSession).toHaveBeenCalledWith('old', false);
    expect(AIPanel._conversations.t2).toHaveLength(1);
  });

  it('resume with nothing saved says so', async () => {
    await expect(W.resume()).rejects.toThrow(/No workday/);
  });

  it('the timed save is off until asked for, then runs once a day', () => {
    expect(W._tick(new Date(2030, 0, 1, 23, 0))).toBe(false);
    window.VexWorkflow.setPref('workdayAuto', true);
    window.VexWorkflow.setPref('workdayAutoTime', '18:00');
    expect(W._tick(new Date(2030, 0, 1, 17, 0))).toBe(false);
    expect(W._tick(new Date(2030, 0, 1, 19, 0))).toBe(true);
    expect(W._tick(new Date(2030, 0, 1, 19, 1))).toBe(false);
  });

  it('snapshot is plain data for whatever wants to show it', () => {
    W.endOfDay();
    const snap = window.VexWorkflow.snapshot();
    expect(snap.workday.latest.tabs).toBe(2);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
});
