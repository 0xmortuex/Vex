// @vitest-environment jsdom
//
// "Back to tab" has to return to where the video came from. Owner's report
// (2026-11-06): a friend's screen share from the Discord panel was floated; the
// player's Back to tab button closed it and Vex stayed where it was. Chromium's
// own (native) PiP window reports the exit as 'vex-pip-left', and only tabs
// listened for it; a web panel's handler ignored it.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs'), path = require('path');
const { PiPManager } = require('../../src/renderer/js/pip-manager.js');
const SIDEBAR = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/sidebar.js'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/app.js'), 'utf8');
const backBtn = require('../../src/main/discord-popout-back.js');

beforeEach(() => {
  document.body.innerHTML = '<button id="pip-btn"></button>';
  globalThis.WebviewManager = { webviews: new Map(), getActiveWebview: () => null };
  globalThis.TabManager = { activeTabId: 'a', tabs: [{ id: 'a' }, { id: 'b' }], getActiveTab() { return this.tabs[0]; }, switchTab: vi.fn() };
  globalThis.SidebarManager = { activePanel: null, sidePanel: null, panelWebviews: {}, showPanel: vi.fn() };
  window.showToast = vi.fn();
  window.vex = { focusWindow: vi.fn(() => Promise.resolve({ ok: true })), onPipClosed: () => {} };
  PiPManager._source = null;
});

describe('returnToSource', () => {
  it('a panel: Vex comes forward and the panel is shown', () => {
    expect(PiPManager.returnToSource({ panel: 'discord' })).toBe(true);
    expect(window.vex.focusWindow).toHaveBeenCalled();
    expect(SidebarManager.showPanel).toHaveBeenCalledWith('discord');
  });

  it('a tab: switched to, Vex comes forward', () => {
    expect(PiPManager.returnToSource({ tabId: 'b' })).toBe(true);
    expect(TabManager.switchTab).toHaveBeenCalledWith('b');
    expect(window.vex.focusWindow).toHaveBeenCalled();
  });

  it('a tab that is gone: said plainly, nothing switched', () => {
    expect(PiPManager.returnToSource({ tabId: 'zzz' })).toBe(false);
    expect(TabManager.switchTab).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('That tab is closed now');
  });

  it('no sidebar to show the panel in: said plainly', () => {
    delete globalThis.SidebarManager;
    expect(PiPManager.returnToSource({ panel: 'discord' })).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('That panel is closed now');
  });

  it('a pop-out source with no live page (asleep) still remembers its panel', () => {
    globalThis.WebviewManager.webviews = new Map();
    PiPManager._silenceSource('panel:discord', null, 'discord');
    expect(PiPManager._source.panel).toBe('discord');
  });
});

describe('leftNative (Chromium\'s own player closed)', () => {
  it('brings the panel back when it is not in front', () => {
    expect(PiPManager.leftNative('discord')).toBe(true);
    expect(SidebarManager.showPanel).toHaveBeenCalledWith('discord');
    expect(window.vex.focusWindow).toHaveBeenCalled();
  });

  it('with the panel already in front, only Vex comes forward and the layout is left alone', () => {
    SidebarManager.sidePanel = 'discord';
    expect(PiPManager.leftNative('discord')).toBe(true);
    expect(SidebarManager.showPanel).not.toHaveBeenCalled();
    expect(window.vex.focusWindow).toHaveBeenCalled();
  });

  it('does nothing while a pop-out window is up (that one reports through onPipClosed)', () => {
    PiPManager._source = { tabId: 'a', wasMuted: false };
    expect(PiPManager.leftNative('discord')).toBe(false);
    expect(SidebarManager.showPanel).not.toHaveBeenCalled();
  });

  it('sidebar.js hands a panel\'s vex-pip-left to it', () => {
    expect(SIDEBAR).toMatch(/e\.channel === 'vex-pip-left'[\s\S]*?PiPManager\.leftNative\(panelName\)/);
  });
});

describe('the Discord pop-out window\'s Back to Discord button', () => {
  it('the injected script builds a closed-shadow button that logs the mark on click, once', () => {
    const code = backBtn.buttonScript('Discord’a dön');
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    new Function(code)(); new Function(code)();
    expect(document.querySelectorAll('#vex-popout-back')).toHaveLength(1);
    expect(code).toContain(JSON.stringify('Discord’a dön'));
    expect(code).toContain('mode:"closed"');
    spy.mockRestore();
  });

  it('recognises only its own message, in both Electron signatures', () => {
    expect(backBtn.isBackMessage(backBtn.messageOf({ message: backBtn.MARK }))).toBe(true);
    expect(backBtn.isBackMessage(backBtn.messageOf({}, backBtn.MARK))).toBe(true);
    expect(backBtn.isBackMessage(backBtn.messageOf({ message: 'hello' }))).toBe(false);
  });

  it('attach: a mark in the console calls onBack; the button goes in on load', async () => {
    const handlers = {};
    const wc = { isDestroyed: () => false, on: (ev, fn) => { handlers[ev] = fn; }, executeJavaScript: vi.fn(() => Promise.resolve()) };
    const onBack = vi.fn();
    backBtn.attach({ webContents: wc }, { label: async () => 'Back', onBack });
    await handlers['did-finish-load']();
    expect(wc.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('vex-popout-back'));
    handlers['console-message']({ message: 'noise' });
    expect(onBack).not.toHaveBeenCalled();
    handlers['console-message']({ message: backBtn.MARK });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('is wired: main attaches it to the pop-out and the renderer shows Discord', () => {
    const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    expect(MAIN).toMatch(/discord-popout-back'\)\.attach\(win,/);
    expect(MAIN).toContain("send('vex:discord-popout-back')");
    expect(APP).toMatch(/onDiscordPopoutBack[\s\S]*?returnToSource\(\{ panel: 'discord' \}\)/);
  });

  it('brings Vex forward again once the pop-out has closed (closing the focused window hands the focus elsewhere)', () => {
    const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    expect(MAIN).toMatch(/win\.once\('closed', bringForward\);[\s\S]*?win\.close\(\);/);
    // ...and the renderer is told from inside bringForward, not before the window is gone
    expect(MAIN).toMatch(/const bringForward = \(\) => \{[\s\S]*?mainWindow\.focus\(\);\s*mainWindow\.webContents\.send\('vex:discord-popout-back'\);/);
  });
});
