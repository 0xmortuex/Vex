// @vitest-environment jsdom
//
// The main window's half of the in-game overlay (js/game-overlay.js): the saved choices, what is handed to
// main, the hotkey kept in the shortcut list, the Settings section, and the music buttons that press the
// Spotify panel's own controls. Colours and real windows are checked in the real app, not here.

import { describe, it, expect, beforeEach, vi } from 'vitest';

let VexGameOverlay, VexGameOverlaySettings, Registry;
let vexApi;

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '';
  Registry = require('../../src/renderer/js/shortcuts-registry.js');
  globalThis.ShortcutsRegistry = Registry;
  Registry.resetAll();
  vi.resetModules();
  vexApi = {
    gameOverlayConfig: vi.fn(async (req) => ({ hotkey: { accelerator: req.config.hotkey, registered: true, error: '' }, state: {} })),
    gameOverlayToggle: vi.fn(async () => ({})),
    gameOverlayStatus: vi.fn(async () => ({ hotkey: { accelerator: 'Ctrl+Alt+Shift+O', registered: true, error: '' } })),
    onGameOverlayMusic: vi.fn(),
    gameOverlayMusicAnswer: vi.fn(),
  };
  window.vex = vexApi;
  window.showToast = vi.fn();
  ({ VexGameOverlay, VexGameOverlaySettings } = require('../../src/renderer/js/game-overlay.js'));
});

describe('choices', () => {
  it('start off, and a damaged saved value starts again loudly', () => {
    expect(VexGameOverlay.enabled()).toBe(false);
    localStorage.setItem('vex.gameOverlay', '{nope');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(VexGameOverlay.prefs().on).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('the hotkey lives in the shortcut list: Ctrl+Alt+Shift+O, not split view\u2019s Ctrl+Alt+O', () => {
    expect(VexGameOverlay.hotkey()).toBe('Ctrl+Alt+Shift+O');
    expect(Registry.getShortcut('split-focus')).toBe('Ctrl+Alt+O');
    const all = Registry.getAllShortcuts();
    expect(Object.entries(all).filter(([, d]) => d.current === 'Ctrl+Alt+Shift+O').map(([id]) => id)).toEqual(['game-overlay']);
  });
  it('the shortcut list refuses a key another shortcut has, and Vex\u2019s own boss key', () => {
    expect(Registry.setShortcut('game-overlay', 'Ctrl+Alt+O')).toMatchObject({ conflict: 'split-focus' });
    expect(Registry.setShortcut('game-overlay', 'Ctrl+Alt+H')).toMatchObject({ conflict: 'fixed' });
    expect(Registry.setShortcut('game-overlay', 'O')).toMatchObject({ invalid: 'needs-modifier' });
    expect(Registry.setShortcut('game-overlay', 'Ctrl+Alt+Shift+K')).toBe(true);
    expect(VexGameOverlay.hotkey()).toBe('Ctrl+Alt+Shift+K');
  });
});

describe('handing the choices to main', () => {
  it('sends the registry\u2019s hotkey, the colours and the language, and saves only what main accepted', async () => {
    document.body.style.setProperty('--vex-accent', '#123456');
    document.body.setAttribute('data-gui-style', 'firefox');
    const res = await VexGameOverlay.save({ on: true, hint: true });
    const req = vexApi.gameOverlayConfig.mock.calls[0][0];
    expect(req.config.hotkey).toBe('Ctrl+Alt+Shift+O');
    expect(req.config.on).toBe(true);
    expect(req.tokens['--vex-accent']).toBe('#123456');
    expect(req.tokens['data-gui-style']).toBe('firefox');
    expect(req.lang).toBe('en');
    expect(res.hotkey.registered).toBe(true);
    expect(JSON.parse(localStorage.getItem('vex.gameOverlay')).hint).toBe(true);
  });
  it('a refusal from main is raised and nothing is saved', async () => {
    vexApi.gameOverlayConfig.mockRejectedValueOnce(new Error('That is not a web address: x'));
    await expect(VexGameOverlay.save({ on: true, defaultGuide: 'x' })).rejects.toThrow('not a web address');
    expect(localStorage.getItem('vex.gameOverlay')).toBeNull();
  });
  it('a hotkey Windows would not give is shown as a message, not hidden', async () => {
    vexApi.gameOverlayConfig.mockResolvedValueOnce({ hotkey: { accelerator: 'Ctrl+Alt+Shift+O', registered: false, error: 'Another program already uses Ctrl+Alt+Shift+O.' } });
    await VexGameOverlay.save({ on: true });
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Another program'), 'error');
    expect(VexGameOverlay.setEnabled).toBeTypeOf('function');
  });
  it('the Feature switches kill switch saves at once and tells main', async () => {
    VexGameOverlay.setEnabled(true);
    expect(VexGameOverlay.enabled()).toBe(true);
    await Promise.resolve();
    expect(vexApi.gameOverlayConfig).toHaveBeenCalled();
    VexGameOverlay.setEnabled(false);
    expect(VexGameOverlay.enabled()).toBe(false);
    expect(vexApi.gameOverlayConfig.mock.calls.at(-1)[0].config.on).toBe(false);
  });
  it('a language change reaches the overlay (the Turkish page)', async () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    await VexGameOverlay.save({ on: true });
    expect(vexApi.gameOverlayConfig.mock.calls[0][0].lang).toBe('tr');
  });
  it('the search engine is handed over as a template', () => {
    window.VexTypedAddress = { searchUrl: (q) => 'https://duckduckgo.com/?q=' + encodeURIComponent(q) };
    expect(VexGameOverlay.searchTemplate()).toBe('https://duckduckgo.com/?q=%s');
    delete window.VexTypedAddress;
    expect(VexGameOverlay.searchTemplate()).toBe('');
  });
});

describe('the music buttons', () => {
  const player = (hit = true) => {
    globalThis.VexMediaControl = {
      META_SCRIPT: 'meta', clickScript: (sel) => 'click:' + sel[0],
      _webviewOf: (row) => (row.id === 'spotify' && hit ? { id: 'wv' } : null),
    };
    window.vexGuestEval = vi.fn(async (wv, script) => (script === 'meta' ? { title: 'Song', artist: 'Artist', state: 'playing' } : true));
  };
  it('press the Spotify panel\u2019s own play button and then read the title', async () => {
    player();
    const r = await VexGameOverlay.music('toggle');
    expect(window.vexGuestEval.mock.calls[0][1]).toContain('control-button-playpause');
    expect(r).toEqual({ ok: true, title: 'Song', artist: 'Artist', state: 'playing' });
  });
  it('say so when the panel is not open or has no button, instead of pretending', async () => {
    player(false);
    await expect(VexGameOverlay.music('status')).rejects.toThrow('not open');
    player();
    window.vexGuestEval = vi.fn(async () => false);
    await expect(VexGameOverlay.music('next')).rejects.toThrow('no next button');
  });
  it('answers main with the request id, an error included', async () => {
    player(false);
    await VexGameOverlay.answerMusic({ id: '7', action: 'status' });
    expect(vexApi.gameOverlayMusicAnswer).toHaveBeenCalledWith(expect.objectContaining({ id: '7', ok: false }));
    player();
    await VexGameOverlay.answerMusic({ id: '8', action: 'status' });
    expect(vexApi.gameOverlayMusicAnswer).toHaveBeenLastCalledWith(expect.objectContaining({ id: '8', ok: true, title: 'Song' }));
  });
});

describe('the Settings section', () => {
  it('says what it is, what it does not do, and the fullscreen limit; panels only once it is on', async () => {
    const body = document.createElement('div');
    VexGameOverlaySettings.render(body);
    expect(body.textContent).toContain('anti-cheat');
    expect(body.textContent).toContain('never injects into, hooks, reads the memory of or captures your game');
    expect(body.textContent).toContain('exclusive fullscreen');
    expect(body.textContent).not.toContain('Which panels to show');
    await VexGameOverlay.save({ on: true });
    VexGameOverlaySettings.render(body);
    expect(body.textContent).toContain('Which panels to show');
    expect(body.querySelector('button[aria-label="Change the overlay hotkey"]').textContent).toBe('Ctrl+Alt+Shift+O');
    expect(body.querySelectorAll('input[type=checkbox]').length).toBe(1 + 3 + 6);   // switch, three behaviours, six panels
    for (const el of body.querySelectorAll('input, button')) expect(el.getAttribute('aria-label') || el.textContent.trim(), el.outerHTML).toBeTruthy();
  });
  it('adds and removes a guide page for a game; a bad address is refused with the reason', async () => {
    await VexGameOverlay.save({ on: true });
    const body = document.createElement('div');
    VexGameOverlaySettings.render(body);
    const [game, url] = body.querySelectorAll('input[aria-label="Program name of the game"], input[aria-label="Guide page address for that game"]');
    game.value = 'RobloxPlayerBeta'; url.value = 'https://roblox.fandom.com/';
    [...body.querySelectorAll('button')].find(b => b.textContent === 'Add guide page').click();
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('vex.gameOverlay')).guides).toEqual({ RobloxPlayerBeta: 'https://roblox.fandom.com/' }));
    vexApi.gameOverlayConfig.mockRejectedValueOnce(new Error('Only http and https addresses can be used'));
    VexGameOverlaySettings.render(body);
    const [g2, u2] = body.querySelectorAll('input[aria-label="Program name of the game"], input[aria-label="Guide page address for that game"]');
    g2.value = 'x'; u2.value = 'file:///C:/secret';
    [...body.querySelectorAll('button')].find(b => b.textContent === 'Add guide page').click();
    await vi.waitFor(() => expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Only http'), 'error'));
  });
  it('turning a panel off asks main, and keeps the old choice if main refuses', async () => {
    await VexGameOverlay.save({ on: true });
    const body = document.createElement('div');
    VexGameOverlaySettings.render(body);
    vexApi.gameOverlayConfig.mockClear();
    const notes = body.querySelector('input[aria-label="Notes"]');
    notes.checked = false; notes.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(vexApi.gameOverlayConfig).toHaveBeenCalled());
    expect(vexApi.gameOverlayConfig.mock.calls[0][0].config.panels).not.toContain('notes');
  });
});
