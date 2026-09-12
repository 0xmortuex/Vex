// @vitest-environment jsdom
//
// Picture-in-Picture, renderer side.
//
// Two bugs this pins, both found by driving the real app:
//
//  1. The pop-out loads the SAME PAGE again in a second window, and the source
//     tab was left playing — so a video played twice, out of sync, and you
//     heard both. It is now muted and paused while the pop-out is up, and
//     restored when it closes.
//  2. "Back to tab" only focused the Vex window. It left you on whatever tab
//     you had drifted to, which is not what a button called "Back to tab"
//     means. It now switches to the tab the video came from.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// One instance, as in the app: re-requiring per test would leave each old copy
// listening on the shared jsdom window, and they would all mute the same tab.
const { PiPManager } = require('../../src/renderer/js/pip-manager.js');


let webview;
let pipClosedHandler;

function makeWebview() {
  return {
    muted: false,
    paused: false,
    sent: [],
    isAudioMuted() { return this.muted; },
    setAudioMuted(v) { this.muted = v; },
    executeJavaScript(js) { if (/pause/.test(js)) this.paused = true; return Promise.resolve('ok'); },
    send(channel) { this.sent.push(channel); },
  };
}

beforeEach(() => {
  document.body.innerHTML = '<button id="pip-btn" style="display:none"></button>';
  webview = makeWebview();
  pipClosedHandler = null;

  globalThis.WebviewManager = {
    webviews: new Map([['tab-1', webview]]),
    getActiveWebview: () => webview,
  };
  globalThis.TabManager = {
    activeTabId: 'tab-1',
    tabs: [{ id: 'tab-1', url: 'https://example.com/watch' }, { id: 'tab-2', url: 'https://example.com/other' }],
    getActiveTab() { return this.tabs.find(t => t.id === this.activeTabId); },
    switchTab: vi.fn(function (id) { this.activeTabId = id; }),
  };
  window.showToast = vi.fn();
  window.vex = {
    openPipWindow: vi.fn(() => Promise.resolve({ ok: true, mode: 'video' })),
    closePipWindow: vi.fn(() => Promise.resolve(true)),
    isPipOpen: vi.fn(() => Promise.resolve(false)),
    onPipClosed: (cb) => { pipClosedHandler = cb; },
  };

  PiPManager._source = null;
  PiPManager.videoDetected = false;
  PiPManager.init();          // idempotent: replaces its own listener
});

// The guest says "I can't do native PiP" by posting this.
const fallback = (media) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'vex-pip-fallback', media: media || null } }));
const MP4 = { src: 'https://cdn.example.com/clip.mp4', currentTime: 42, paused: false };
const detected = (hasVideo) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'vex-video-detected', hasVideo } }));
const flush = () => new Promise(r => setTimeout(r, 0));

describe('the toolbar button follows the page', () => {
  it('appears when the active page has video and hides when it does not', () => {
    detected(true);
    expect(document.getElementById('pip-btn').style.display).toBe('flex');
    expect(PiPManager.videoDetected).toBe(true);

    detected(false);
    expect(document.getElementById('pip-btn').style.display).toBe('none');
    expect(PiPManager.videoDetected).toBe(false);
  });
});

describe('the pop-out does not leave you hearing the video twice', () => {
  it('mutes and pauses the source tab when the pop-out opens', async () => {
    fallback();
    await flush();

    expect(window.vex.openPipWindow).toHaveBeenCalledWith('https://example.com/watch', null);
    expect(webview.muted).toBe(true);
    expect(webview.paused).toBe(true);
    expect(PiPManager._source).toEqual({ tabId: 'tab-1', wasMuted: false });
  });

  it('gives the sound back when the pop-out closes', async () => {
    fallback();
    await flush();
    expect(webview.muted).toBe(true);

    pipClosedHandler('closed');
    expect(webview.muted).toBe(false);
    expect(PiPManager._source).toBeNull();
  });

  it('leaves a tab you had already muted yourself muted', async () => {
    webview.muted = true;
    fallback();
    await flush();
    expect(PiPManager._source.wasMuted).toBe(true);

    pipClosedHandler('closed');
    expect(webview.muted).toBe(true);       // yours, not ours to undo
  });

  it('does not touch the tab when the pop-out was refused', async () => {
    window.vex.openPipWindow.mockResolvedValueOnce({ ok: false });
    fallback();
    await flush();

    expect(webview.muted).toBe(false);
    expect(PiPManager._source).toBeNull();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/not available/i), 'error');
  });

  it('reports a failure to open rather than swallowing it', async () => {
    window.vex.openPipWindow.mockRejectedValueOnce(new Error('window creation failed'));
    fallback();
    await flush();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/window creation failed/), 'error');
  });

  it('survives the source tab being closed while the pop-out is up', async () => {
    fallback();
    await flush();
    WebviewManager.webviews.delete('tab-1');
    expect(() => pipClosedHandler('closed')).not.toThrow();
    expect(PiPManager._source).toBeNull();
  });
});

describe('"Back to tab" goes back to the tab', () => {
  it('switches to the tab the video came from, not wherever you drifted to', async () => {
    fallback();
    await flush();

    TabManager.activeTabId = 'tab-2';          // you wandered off
    pipClosedHandler('back-to-tab');

    expect(TabManager.switchTab).toHaveBeenCalledWith('tab-1');
    expect(TabManager.activeTabId).toBe('tab-1');
    expect(webview.muted).toBe(false);          // and it can be heard again
  });

  it('a plain close leaves you where you are', async () => {
    fallback();
    await flush();
    TabManager.activeTabId = 'tab-2';
    pipClosedHandler('closed');

    expect(TabManager.switchTab).not.toHaveBeenCalled();
    expect(TabManager.activeTabId).toBe('tab-2');
  });

  it('says so when that tab has been closed since', async () => {
    fallback();
    await flush();
    TabManager.tabs = TabManager.tabs.filter(t => t.id !== 'tab-1');
    pipClosedHandler('back-to-tab');

    expect(TabManager.switchTab).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/closed now/i));
  });
});

describe('the toggle', () => {
  it('asks the guest for native PiP first — the pop-out is only a fallback', async () => {
    await PiPManager.toggle();
    expect(webview.sent).toEqual(['vex-request-pip']);
    expect(window.vex.openPipWindow).not.toHaveBeenCalled();
  });

  it('closes an open pop-out instead of opening a second one', async () => {
    window.vex.isPipOpen.mockResolvedValueOnce(true);
    await PiPManager.toggle();
    expect(window.vex.closePipWindow).toHaveBeenCalled();
    expect(webview.sent).toEqual([]);
  });

  it('says there is nothing to pop out rather than failing silently', async () => {
    WebviewManager.getActiveWebview = () => null;
    await PiPManager.toggle();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/No page/i), 'error');
  });
});

describe('floating the video instead of the whole site', () => {
  it('hands the video description to main when the guest supplies one', async () => {
    fallback(MP4);
    await flush();
    expect(window.vex.openPipWindow).toHaveBeenCalledWith('https://example.com/watch', MP4);
  });

  it('says so when the site forced the whole-page fallback', async () => {
    window.vex.openPipWindow.mockResolvedValueOnce({ ok: true, mode: 'page' });
    fallback(null);
    await flush();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/streams its video in pieces/i));
  });

  it('says nothing extra when the video itself is floating', async () => {
    fallback(MP4);
    await flush();
    expect(window.showToast).not.toHaveBeenCalled();
  });

  // Otherwise you watch five minutes in the little window, close it, and the
  // tab is still sitting where you left it.
  it('moves the page video to where the floating player got to', async () => {
    fallback(MP4);
    await flush();
    pipClosedHandler('back-to-tab', 137.5);
    expect(webview.sent).toContain('vex-pip-resume');
  });

  it('leaves the page alone when there is no position to restore', async () => {
    fallback(MP4);
    await flush();
    webview.sent = [];
    pipClosedHandler('closed', null);
    expect(webview.sent).toEqual([]);
  });

  it('ignores a nonsense position rather than seeking to it', async () => {
    fallback(MP4);
    await flush();
    webview.sent = [];
    pipClosedHandler('closed', -5);
    expect(webview.sent).toEqual([]);
  });
});
