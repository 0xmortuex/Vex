// @vitest-environment jsdom
//
// T1-032, the missing parts of the after-game pit stop: patch notes, a free game, missed
// Discord, "Resume what I was doing", and the offer of the game's tabs to the dossier.
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
const { GamePitstop } = require('../../src/renderer/js/game-pitstop.js');

const START = 5_000_000;
const game = (extra = {}) => ({ app: 'Roblox', gameId: 'g_rb', start: START, end: START + 30 * 60000, jobsAtStart: 0, inboxIds: new Set(), tabs: new Map(), activeTab: 2, activePanel: '', ...extra });

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.VexTabPolicy = { isPrivateWindow: false };
  window.vex = { attention: { denied: vi.fn(async () => []) } };
  globalThis.GamePitstop = GamePitstop;
  GamePitstop._s = null; GamePitstop._report = null; GamePitstop.hide();
  for (const n of ['PatchRadar', 'FreeGames', 'PanelCapture', 'GameDossier', 'VexAttention', 'AttentionInbox', 'VexJobs', 'SidebarManager', 'GameWarmdown', 'GameHolds']) delete globalThis[n];
  globalThis.GameSession = { games: () => [{ id: 'g_rb', name: 'Roblox' }], active: false };
  globalThis.TabManager = { tabs: [{ id: 1, title: 'Docs', url: 'https://wiki.example/x', sleeping: true }, { id: 2, title: 'Mail', url: 'https://a.example/', sleeping: false }], activeTabId: 1, wakeTab: vi.fn(), switchTab: vi.fn() };
});

describe('the four extra lines', () => {
  it('names the patch notes that changed while you played, including ones queued during the game', async () => {
    globalThis.PatchRadar = { pages: () => [{ changedAt: START + 1000, latest: 'Update 5' }], queue: () => [{ gameId: 'g_other', name: 'Other', title: 'Hotfix', at: START + 5 }] };
    const card = await GamePitstop.compile(game());
    expect(card.patches).toEqual([{ name: 'Roblox', title: 'Update 5' }, { name: 'Other', title: 'Hotfix' }]);
    expect(GamePitstop.summaryLine(card)).toContain('new patch notes for Roblox, Other');
    globalThis.PatchRadar = { pages: () => [{ changedAt: START - 1, latest: 'old' }], queue: () => [] };
    expect(await GamePitstop.compile(game())).toBeNull();
  });

  it('adds a free game only when "tell me about free games" is on', async () => {
    const list = vi.fn(async () => [{ store: 'Epic', title: 'Free One', live: true }]);
    globalThis.FreeGames = { tellMe: () => false, list, fresh: (g) => g };
    expect(await GamePitstop.compile(game())).toBeNull();
    expect(list).not.toHaveBeenCalled();
    globalThis.FreeGames.tellMe = () => true;
    const card = await GamePitstop.compile(game());
    expect(card.free).toEqual([{ store: 'Epic', title: 'Free One' }]);
  });

  it('says a free game could not be read instead of hiding it', async () => {
    window.VexProblems = { note: vi.fn() }; globalThis.VexProblems = window.VexProblems;
    globalThis.FreeGames = { tellMe: () => true, list: async () => { throw new Error('stores down'); }, fresh: (g) => g };
    globalThis.PatchRadar = { pages: () => [{ changedAt: START + 1, latest: 'x' }], queue: () => [] };
    const card = await GamePitstop.compile(game());
    expect(card.free).toEqual([]);
    expect(window.VexProblems.note).toHaveBeenCalledWith('Game mode', expect.stringContaining('free games'), expect.any(Error));
  });

  it('counts the Discord messages Vex kept while you played', async () => {
    const list = vi.fn(() => [{ title: 'Ann (#a, S)', vip: true }, { title: 'Ann (#a, S)' }, { title: 'Bob (#b, S)' }]);
    globalThis.PanelCapture = { list };
    const card = await GamePitstop.compile(game());
    expect(list).toHaveBeenCalledWith({ source: 'discord', since: START });
    expect(card.discord).toEqual({ n: 3, chats: 2, vip: 1 });
    expect(GamePitstop.summaryLine(card)).toContain('3 Discord messages missed');
    GamePitstop.show(card);
    expect(document.getElementById('game-pitstop').textContent).toContain('3 in 2 chats (1 from people you marked VIP)');
  });
});

describe('resume what I was doing', () => {
  it('wakes the slept tabs, returns to the tab that was in front and reopens the panel', async () => {
    globalThis.SidebarManager = { activePanel: '', sidePanel: null, openPanel: vi.fn() };
    globalThis.GamePitstop._report = { sleptIds: [1] };
    const card = await GamePitstop.compile(game({ activePanel: 'notes' }));
    expect(card.resume).toEqual({ tab: 2, panel: 'notes' });
    expect(GamePitstop.canResume(card)).toBe(true);
    vi.useFakeTimers();
    const msg = GamePitstop.resume(card);
    vi.runAllTimers(); vi.useRealTimers();
    expect(TabManager.switchTab).toHaveBeenCalledWith(2);
    expect(SidebarManager.openPanel).toHaveBeenCalledWith('notes');
    expect(TabManager.wakeTab).toHaveBeenCalledWith(1);
    expect(msg).toContain('Resuming');
  });

  it('has no button when nothing would change, and says so if forced', () => {
    TabManager.activeTabId = 2;
    const card = { resume: { tab: 2, panel: '' }, tabs: [], app: 'G' };
    expect(GamePitstop.canResume(card)).toBe(false);
    expect(() => GamePitstop.resume(card)).toThrow(/nothing to resume/);
  });

  it('draws the button on the card', async () => {
    globalThis.PatchRadar = { pages: () => [{ changedAt: START + 1, latest: 'x' }], queue: () => [] };
    const card = await GamePitstop.compile(game());
    GamePitstop.show(card);
    const labels = [...document.querySelectorAll('#game-pitstop button')].map(b => b.textContent);
    expect(labels).toContain('Resume what I was doing');
  });
});

describe('offering the game tabs to the dossier', () => {
  function dossier(on) {
    globalThis.GameDossier = {
      enabledFor: () => on,
      pageSkipReason: (tab) => (/bank/.test(tab.url) ? 'sensitive' : null),
      record: vi.fn(() => ({})),
    };
  }
  it('remembers the pages opened during the game, minus the ones the dossier never keeps', () => {
    dossier(false);
    GamePitstop._s = { tabs: new Map(), app: 'Roblox', gameId: 'g_rb' };
    TabManager.tabs.push({ id: 3, title: 'Bank', url: 'https://bank.example/' });
    expect(GamePitstop.noteTab(2)).toBe(true);
    expect(GamePitstop.noteTab(3)).toBe(false);
    expect(GamePitstop.noteTab(99)).toBe(false);
    expect([...GamePitstop._s.tabs.values()]).toEqual([{ url: 'https://a.example/', title: 'Mail' }]);
  });

  it('offers nothing when the dossier is already recording this game', async () => {
    dossier(true);
    const card = await GamePitstop.compile(game({ tabs: new Map([[2, { url: 'https://a.example/', title: 'Mail' }]]) }));
    expect(card).toBeNull();
  });

  it('adds the pages only after a yes, and not on a no', async () => {
    dossier(false);
    const tabs = new Map([[2, { url: 'https://a.example/', title: 'Mail' }]]);
    const card = await GamePitstop.compile(game({ tabs }));
    expect(card.offer).toEqual([{ url: 'https://a.example/', title: 'Mail' }]);
    window.vexConfirm = vi.fn(async () => false);
    expect(await GamePitstop.offerToDossier(card)).toBe(0);
    expect(GameDossier.record).not.toHaveBeenCalled();
    window.vexConfirm = vi.fn(async () => true);
    expect(await GamePitstop.offerToDossier(card)).toBe(1);
    expect(GameDossier.record).toHaveBeenCalledWith('g_rb', { url: 'https://a.example/', title: 'Mail' }, card.at);
    expect(window.vexConfirm.mock.calls[0][0].message).toContain('never synced');
    expect(card.offer).toEqual([]);
    await expect(GamePitstop.offerToDossier(card)).rejects.toThrow(/no pages/);
  });
});
