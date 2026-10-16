// @vitest-environment jsdom
//
// js/spell-lang.js (T3-040) and the game / DRM guard on floating a video by itself (T3-041).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fs = require('fs');
const path = require('path');
const { VexSpellLang } = require('../../src/renderer/js/spell-lang.js');
const { PiPManager } = require('../../src/renderer/js/pip-manager.js');

const read = (...p) => fs.readFileSync(path.resolve(__dirname, '../..', ...p), 'utf8');

describe('spelling languages', () => {
  beforeEach(() => {
    localStorage.clear();
    window.showToast = vi.fn();
    window.vexSpellcheck = { setLanguages: vi.fn(async (c) => ({ choice: c })), addWord: vi.fn(async () => ({ ok: true })) };
  });

  it('keeps a choice only after main accepted it', async () => {
    await VexSpellLang.setChoice('tr');
    expect(VexSpellLang.choice()).toBe('tr');
    window.vexSpellcheck.setLanguages = vi.fn(async () => { throw new Error('No spelling dictionary is available for that choice'); });
    await expect(VexSpellLang.setChoice('both')).rejects.toThrow(/dictionary/);
    expect(VexSpellLang.choice()).toBe('tr');
    await expect(VexSpellLang.setChoice('klingon')).rejects.toThrow(/Unknown/);
  });

  it('offers the language submenu in a field and add-to-dictionary on a flagged word', () => {
    const wv = { getWebContentsId: () => 5 };
    const rows = VexSpellLang.menuRows(wv, { isEditable: true, misspelledWord: 'merhaba' });
    expect(rows.lang[0].sub.map(s => s.label)).toEqual(['Automatic', 'English', 'Turkish', 'English and Turkish']);
    expect(rows.lang[0].sub.find(s => s.checked).label).toBe('Automatic');
    expect(rows.word[0].label).toBe('Add "merhaba" to the dictionary');
    rows.word[0].action();
    expect(window.vexSpellcheck.addWord).toHaveBeenCalledWith(5, 'merhaba');
    expect(VexSpellLang.menuRows(wv, { isEditable: false }).lang).toEqual([]);
  });

  it('off puts the checker back to Automatic and on puts the saved choice back', async () => {
    await VexSpellLang.setChoice('both');
    window.vexSpellcheck.setLanguages.mockClear();
    await VexSpellLang.setEnabled(false);
    expect(window.vexSpellcheck.setLanguages).toHaveBeenLastCalledWith('auto');
    expect(VexSpellLang.menuRows({}, { isEditable: true }).lang).toEqual([]);
    await VexSpellLang.setEnabled(true);
    expect(window.vexSpellcheck.setLanguages).toHaveBeenLastCalledWith('both');
  });

  it('has its channels schema-checked, UI-only, closed in private windows, in the preload and handled once in main', () => {
    const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
    for (const c of ['spellcheck:set-languages', 'spellcheck:state']) expect(UI_ONLY_CHANNELS.has(c), c).toBe(true);
    const policy = read('src', 'main', 'ipc-policy.js');
    expect(policy).toMatch(/TARGET_CHANNELS = new Set\([^;]*'spellcheck:add-word'/);
    expect(policy).toMatch(/PRIVATE_DISABLED = [^;]*spellcheck:set-languages/);
    const schemas = read('src', 'main', 'ipc-schemas.js');
    const preload = read('src', 'preload.js');
    const main = read('src', 'main.js');
    for (const c of ['spellcheck:set-languages', 'spellcheck:state', 'spellcheck:add-word']) {
      expect(schemas).toContain("define('" + c + "'");
      expect(preload).toContain("invoke('" + c + "'");
      expect(main.split("ipcMain.handle('" + c + "'").length - 1, c).toBe(1);
    }
  });
});

describe('floating a video by itself', () => {
  let frames;
  const wv = { getWebContentsId: () => 7, isConnected: true };
  const best = (o) => ({ token: 'tk', score: 1, playing: true, disabled: false, enabled: true, drm: false, media: null, ...o });
  beforeEach(() => {
    frames = { scan: [{ inPip: false, best: best() }], enter: [{ mine: true, ok: true }] };
    window.vex = {
      evalAllFrames: vi.fn(async (id, code) => {
        const mode = /\)\("(\w+)"/.exec(code)[1];
        return { ok: true, results: (frames[mode] || []).map(value => ({ ok: true, value })) };
      }),
    };
    globalThis.TabManager = { activeTabId: 'a', tabs: [{ id: 'a' }, { id: 'b' }] };
    globalThis.WebviewManager = { webviews: new Map([['a', wv]]) };
    PiPManager._autoTabs.clear();
    PiPManager._lastActive = 'a';
    PiPManager._game = false;
    PiPManager.setAutoEnabled(true);
  });
  const switchAway = async () => { TabManager.activeTabId = 'b'; PiPManager._tabsChanged(); await new Promise(r => setTimeout(r, 0)); };

  it('floats when no game is in front', async () => {
    await switchAway();
    expect(PiPManager._autoTabs.has('a')).toBe(true);
  });

  it('floats nothing while a game is in front, or before main has said', async () => {
    PiPManager._game = true;
    await switchAway();
    expect(window.vex.evalAllFrames).not.toHaveBeenCalled();
    PiPManager._game = null;
    TabManager.activeTabId = 'a'; PiPManager._lastActive = 'a';
    await switchAway();
    expect(window.vex.evalAllFrames).not.toHaveBeenCalled();
  });

  it('follows main\'s game state once init has wired it', async () => {
    let push;
    window.vex.onGameState = (cb) => { push = cb; };
    window.vex.gameState = vi.fn(async () => ({ game: false }));
    PiPManager._gameWired = false;
    PiPManager.init();
    expect(PiPManager._game).toBe(null);
    await Promise.resolve(); await Promise.resolve();
    expect(PiPManager._game).toBe(false);
    push({ game: true, app: 'cs2' });
    expect(PiPManager._game).toBe(true);
  });

  it('does not float protected (DRM) video by itself', async () => {
    frames.scan = [{ inPip: false, best: best({ drm: true }) }];
    await switchAway();
    expect(PiPManager._autoTabs.has('a')).toBe(false);
    expect(window.vex.evalAllFrames.mock.calls.every(c => !/\("enter"/.test(c[1]))).toBe(true);
  });
});
