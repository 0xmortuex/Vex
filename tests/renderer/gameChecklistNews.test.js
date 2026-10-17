// @vitest-environment jsdom
//
// T1-023, the part that was missing: "patched yesterday, servers OK" and "study minutes earn
// game minutes" on the pre-game checklist card. Both are opt-in; neither blocks anything.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { GameChecklist } = require('../../src/renderer/js/game-checklist.js');
const { VexStudyLedger } = require('../../src/renderer/js/study-ledger.js');

const DAY = 86400000;
const LAUNCH = { game: false, app: '', id: '', launcher: true, launcherApp: 'Steam' };
const GAME = { game: true, app: 'Roblox', id: 'g_rb', listed: true };
const IDLE = { game: false, app: '', id: '' };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.VexTabPolicy = { isPrivateWindow: false };
  window.VexProblems = { note: vi.fn() };
  globalThis.VexProblems = window.VexProblems;
  GameChecklist._shownAt = 0; GameChecklist._seen = ''; GameChecklist._playStart = 0; GameChecklist._gameId = ''; GameChecklist.hide();
  delete globalThis.PatchRadar; delete globalThis.VexServiceCheck; delete globalThis.VexStudyLedger; delete globalThis.VexAttention;
});

describe('patched yesterday', () => {
  it('names a patch notes change from the last three days, and nothing older', () => {
    const now = new Date(2026, 9, 15, 12).getTime();
    globalThis.PatchRadar = { pages: (id) => (id === 'g_rb' ? [{ changedAt: now - DAY, latest: 'Hotfix 1.2' }, { changedAt: now - 9 * DAY, latest: 'old' }] : []) };
    expect(GameChecklist.patchLine('g_rb', now).text).toBe('Patch notes changed yesterday: Hotfix 1.2');
    expect(GameChecklist.patchLine('other', now)).toBeNull();
    globalThis.PatchRadar = { pages: () => [{ changedAt: now - 5 * DAY, latest: 'x' }] };
    expect(GameChecklist.patchLine('g_rb', now)).toBeNull();
    globalThis.PatchRadar = { pages: () => [{ changedAt: 0, latest: null }] };
    expect(GameChecklist.patchLine('g_rb', now)).toBeNull();
  });

  it('says servers OK from the listed status pages, or names the incident, or says it could not read', async () => {
    const { VexServiceCheck } = require('../../src/renderer/js/service-check.js');
    globalThis.VexServiceCheck = VexServiceCheck;
    vi.spyOn(VexServiceCheck, 'enabled').mockReturnValue(true);
    vi.spyOn(VexServiceCheck, 'pages').mockReturnValue(['discordstatus.com']);
    const fetchStatus = vi.spyOn(VexServiceCheck, 'fetchStatus');
    fetchStatus.mockResolvedValue([{ ok: true, name: 'Discord', indicator: 'none' }]);
    expect(await GameChecklist.serverLine()).toMatchObject({ id: 'servers', ok: true, text: 'Servers OK' });
    fetchStatus.mockResolvedValue([{ ok: true, name: 'Roblox', indicator: 'major', description: 'Major Outage' }]);
    expect(await GameChecklist.serverLine()).toMatchObject({ ok: false, text: 'Roblox: Major Outage' });
    fetchStatus.mockRejectedValue(new Error('offline'));
    const l = await GameChecklist.serverLine();
    expect(l.ok).toBe(false);
    expect(l.text).toContain('offline');
    expect(window.VexProblems.note).toHaveBeenCalled();
    vi.spyOn(VexServiceCheck, 'enabled').mockReturnValue(false);
    expect(await GameChecklist.serverLine()).toBeNull();
  });

  it('is off by default: no card for a patch alone until the news switch is on', () => {
    const now = Date.now();
    globalThis.PatchRadar = { pages: () => [{ changedAt: now, latest: 'Patch' }] };
    GameChecklist.setEnabled(true);
    expect(GameChecklist.newsOn()).toBe(false);
    expect(GameChecklist.onState(GAME)).toBe(false);
    GameChecklist._seen = '';
    GameChecklist.setNews(true);
    expect(GameChecklist.onState(GAME)).toBe(true);
    const text = document.getElementById('game-checklist').textContent;
    expect(text).toContain('Patch notes changed today: Patch');
    expect(document.querySelector('#game-checklist button.gc-primary').textContent).toBe('Play anyway');
  });
});

describe('study minutes earn game minutes', () => {
  it('is off by default and rejects a nonsense ratio', () => {
    expect(GameChecklist.earn()).toMatchObject({ on: false, ratio: 1 });
    expect(GameChecklist.earnedLine()).toBeNull();
    expect(() => GameChecklist.setEarn({ ratio: 0 })).toThrow(/above 0/);
    expect(() => GameChecklist.setEarn({ ratio: 99 })).toThrow(/up to/);
    expect(GameChecklist.setEarn({ on: true, ratio: 0.5 })).toMatchObject({ on: true, ratio: 0.5 });
  });

  it('turns study minutes into game minutes at the ratio, minus the minutes played today', () => {
    globalThis.VexStudyLedger = { enabled: () => true, minutesBetween: () => 60 };
    GameChecklist.setEarn({ on: true, ratio: 0.5 });
    // 60 study min at 0.5 = 30 game min, none played
    expect(GameChecklist.earnedLine()).toMatchObject({ ok: true, earned: 30, played: 0, left: 30 });
    // a game that ran 20 minutes is counted on the way out
    const t0 = Date.now();
    vi.useFakeTimers(); vi.setSystemTime(t0);
    GameChecklist.onState(GAME);
    vi.setSystemTime(t0 + 20 * 60000);
    GameChecklist.onState(IDLE);
    vi.useRealTimers();
    const l = GameChecklist.earnedLine();
    expect(l).toMatchObject({ played: 20, left: 10, ok: true });
    expect(l.text).toContain('10 min left');
    GameChecklist.setEarn({ ratio: 0.1 });
    expect(GameChecklist.earnedLine()).toMatchObject({ ok: false, left: -14 });
  });

  it('does not count games while the setting is off, and says so when the study ledger is off', () => {
    GameChecklist.onState(GAME); GameChecklist._playStart = Date.now() - 600000; GameChecklist.onState(IDLE);
    expect(JSON.parse(localStorage.getItem('vex.game.checklist.earn') || '{"played":{}}').played).toEqual({});
    GameChecklist.setEarn({ on: true });
    globalThis.VexStudyLedger = { enabled: () => false, minutesBetween: () => 0 };
    expect(GameChecklist.earnedLine()).toMatchObject({ ok: false });
    expect(GameChecklist.earnedLine().text).toContain('study ledger');
  });

  it('the study ledger counts sessions that started in a day', () => {
    localStorage.setItem('vex.studyLedger.enabled', 'on');
    const day = new Date(2026, 9, 14).getTime();
    vi.spyOn(VexStudyLedger, '_read').mockReturnValue({ sessions: [{ start: day + 1000, minutes: 25 }, { start: day + 5000, minutes: 20 }, { start: day - 1000, minutes: 99 }], targets: {}, learned: {}, seenBlocks: [] });
    expect(VexStudyLedger.minutesBetween(day, day + DAY)).toBe(45);
  });

  it('shows the line on the card, and the card does not block', () => {
    globalThis.VexStudyLedger = { enabled: () => true, minutesBetween: () => 40 };
    GameChecklist.setEnabled(true);
    GameChecklist.setEarn({ on: true });
    expect(GameChecklist.onState(LAUNCH)).toBe(true);
    expect(document.getElementById('game-checklist').textContent).toContain('40 min of study earned 40 min of game time today');
  });
});
