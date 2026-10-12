// @vitest-environment jsdom
//
// Picture-in-Picture for a page in a web panel (a pinned Disney+, Prime Video
// or Netflix in the sidebar). The toolbar button and Ctrl+Shift+P looked only at
// the TAB in front, so with the video in a panel they answered "There is no
// video on this page" while it played (owner's report, 2026-10-12); a panel's
// own PiP overlay button, when the page refused native PiP, was dropped because
// only tabs relayed its message; and a video in a closed shadow root could not
// be found at all.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs'), path = require('path');
const { PiPManager, vexPipFrame } = require('../../src/renderer/js/pip-manager.js');
const PRELOAD = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'latin1');
const SIDEBAR = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/sidebar.js'), 'utf8');

const NO_VIDEO = { inPip: false, count: 0, best: null };
const VIDEO = (score = 5e12, extra = {}) => ({ inPip: false, count: 1, best: { token: 'tok', score, playing: true, disabled: false, enabled: true, media: null, ...extra } });

let tabWv, panelWv, answers;
function makeWebview(id) {
  return {
    id, muted: false, sent: [], isConnected: true,
    isAudioMuted() { return this.muted; },
    setAudioMuted(v) { this.muted = v; },
    executeJavaScript() { return Promise.resolve('ok'); },
    send(channel, ...a) { this.sent.push([channel, ...a]); },
    getWebContentsId() { return id; },
    getURL() { return 'https://www.disneyplus.com/play/abc'; },
  };
}

beforeEach(() => {
  document.body.innerHTML = '<button id="pip-btn" style="display:none"></button>';
  tabWv = makeWebview(12);
  panelWv = makeWebview(21);
  answers = { 12: { scan: [NO_VIDEO] }, 21: { scan: [VIDEO()], enter: [{ mine: true, ok: true }] } };
  globalThis.WebviewManager = { webviews: new Map([['tab-1', tabWv]]), getActiveWebview: () => tabWv };
  globalThis.TabManager = {
    activeTabId: 'tab-1',
    tabs: [{ id: 'tab-1', url: 'https://example.com/start' }],
    getActiveTab() { return this.tabs.find(t => t.id === this.activeTabId); },
    switchTab: vi.fn(),
  };
  globalThis.SidebarManager = { activePanel: 'site_disney', sidePanel: null, panelWebviews: { site_disney: panelWv }, showPanel: vi.fn() };
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => true);
  window.vex = {
    // The frame script's mode is the first argument of the call it ends with.
    evalAllFrames: vi.fn(async (wcId, code) => {
      const mode = /\)\("(scan|enter|exit)"/.exec(code)[1];
      return { ok: true, results: (answers[wcId][mode] || []).map(value => ({ ok: true, value })) };
    }),
    openPipWindow: vi.fn(() => Promise.resolve({ ok: true, mode: 'video' })),
    closePipWindow: vi.fn(() => Promise.resolve(true)),
    isPipOpen: vi.fn(() => Promise.resolve(false)),
    onPipClosed: (cb) => { window.__pipClosed = cb; },
  };
  PiPManager._source = null;
  PiPManager.videoDetected = false;
  PiPManager.init();
});

describe('a video in a web panel', () => {
  it('is floated by the toolbar button even though the tab in front has none', async () => {
    const r = await PiPManager.toggle();
    expect(r).toBe('entered');
    expect(window.showToast.mock.calls.map(c => c[0])).not.toContain('There is no video on this page');
    const enter = window.vex.evalAllFrames.mock.calls.find(c => /\)\("enter"/.test(c[1]));
    expect(enter[0]).toBe(21);                       // the panel's page, not the tab's
  });

  it('still says there is no video when neither the panel nor the tab has one', async () => {
    answers[21].scan = [NO_VIDEO];
    const r = await PiPManager.toggle();
    expect(r).toBe('none');
    expect(window.showToast.mock.calls.map(c => c[0])).toContain('There is no video on this page');
  });

  it('with a video in both, the one that is playing is floated, and the clicked page wins a tie', async () => {
    answers[12].scan = [VIDEO(1e12, { playing: false })];     // a paused one in the tab
    answers[12].enter = [{ mine: true, ok: true }];
    await PiPManager.toggle();
    expect(window.vex.evalAllFrames.mock.calls.find(c => /\)\("enter"/.test(c[1]))[0]).toBe(21);
    window.vex.evalAllFrames.mockClear();
    answers[12].scan = [VIDEO()];                              // now equal
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => tabWv });
    await PiPManager.toggle();
    expect(window.vex.evalAllFrames.mock.calls.find(c => /\)\("enter"/.test(c[1]))[0]).toBe(12);
    delete document.activeElement;
  });

  it('a video already floating from the panel is brought back by the same button', async () => {
    answers[21].scan = [{ inPip: true, count: 1, best: null }];
    answers[21].exit = [{ inPip: false, exited: true }];
    expect(await PiPManager.toggle()).toBe('exited');
    expect(window.vex.evalAllFrames.mock.calls.some(c => c[0] === 21 && /\)\("exit"/.test(c[1]))).toBe(true);
  });

  it('when the page refuses native PiP, the pop-out is for the panel\'s page and the panel is silenced', async () => {
    answers[21].enter = [{ mine: true, error: 'blocked', name: 'NotAllowedError' }];
    expect(await PiPManager.toggle()).toBe('popout');
    expect(window.vex.openPipWindow).toHaveBeenCalledWith('https://www.disneyplus.com/play/abc', null, 21);
    expect(panelWv.muted).toBe(true);
    expect(tabWv.muted).toBe(false);
    // and "Back to tab" brings the panel back, not a tab
    window.__pipClosed('back-to-tab');
    expect(SidebarManager.showPanel).toHaveBeenCalledWith('site_disney');
    expect(panelWv.muted).toBe(false);
  });

  it("the panel's own PiP overlay button reaches the pop-out too", async () => {
    await PiPManager.popoutPanel('site_disney', panelWv, { src: 'https://cdn.example.com/a.mp4' });
    expect(window.vex.openPipWindow).toHaveBeenCalledWith('https://www.disneyplus.com/play/abc', { src: 'https://cdn.example.com/a.mp4' }, 21);
  });

  it('shows the toolbar button while the panel plays, and hides it when it stops', () => {
    const btn = document.getElementById('pip-btn');
    panelWv._vexMediaPlaying = true;
    document.dispatchEvent(new CustomEvent('vex:panel-changed', { detail: { panel: 'site_disney' } }));
    expect(btn.style.display).toBe('flex');
    panelWv._vexMediaPlaying = false;
    document.dispatchEvent(new CustomEvent('vex:panel-changed', { detail: { panel: null } }));
    expect(btn.style.display).toBe('none');
  });

  it('sidebar.js relays a panel\'s video report and its PiP fallback', () => {
    expect(SIDEBAR).toMatch(/e\.channel === 'vex-video-detected'[\s\S]*?_vexHasVideo[\s\S]*?PiPManager\._showButton\(\)/);
    expect(SIDEBAR).toMatch(/e\.channel === 'vex-pip-fallback'[\s\S]*?PiPManager\.popoutPanel\(panelName, wv,/);
  });
});

describe('a video in a closed shadow root', () => {
  it('is found by the scan through the list the preload keeps', () => {
    document.body.innerHTML = '<div id="h"></div>';
    const root = document.getElementById('h').attachShadow({ mode: 'closed' });
    root.innerHTML = '<video src="blob:x"></video>';
    Object.defineProperty(window, '__vexClosedRoots', { configurable: true, value: [new WeakRef(root)] });
    const r = vexPipFrame('scan');
    expect(r.count).toBe(1);
    delete window.__vexClosedRoots;
  });

  it('the preload keeps that list: a weak reference, closed roots only, behaviour of attachShadow unchanged', () => {
    const at = PRELOAD.indexOf('Closed shadow roots, for Picture-in-Picture');
    expect(at).toBeGreaterThan(0);
    const block = PRELOAD.slice(at, at + 2500);
    expect(block).toContain("init.mode === 'closed'");
    expect(block).toContain('new WeakRef(r)');
    expect(block).toContain('orig.apply(this, arguments)');
    expect(block).toContain('enumerable:false');
  });
});
