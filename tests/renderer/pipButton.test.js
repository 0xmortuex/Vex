// @vitest-environment jsdom
//
// The Picture-in-Picture button must never block the page. It used to be a
// permanent "PiP" pill in the window's bottom-right corner (plus a second one
// injected into every video's top-right corner), sitting on a player's own
// volume / settings / fullscreen icons, chat bubbles, cookie banners and sticky
// bars, and swallowing the clicks meant for them (owner's report, 2026-10-12).
//
// Now: the page decides where the button may go (vexPipPlace in
// preload-webview.js: the first corner of the video with no control under it),
// the host draws it there only while the pointer is over the video (or always,
// or never, per Settings), and only the button itself takes the pointer.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fs = require('fs'), path = require('path');
const { PiPManager } = require('../../src/renderer/js/pip-manager.js');
const PRELOAD = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'latin1');
const APP = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/app.js'), 'utf8');
const SIDEBAR = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/sidebar.js'), 'utf8');
const WEBVIEW = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/webview.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');

// The placement function, taken out of the preload exactly as shipped.
const src = PRELOAD.slice(PRELOAD.indexOf('// ---- vexPipPlace begin ----'), PRELOAD.indexOf('// ---- vexPipPlace end ----'));
// eslint-disable-next-line no-new-func
const vexPipPlace = new Function(src + '\nreturn vexPipPlace;')();

// ---- a tiny page: elements with rects, stacked top to bottom ----
let layers;      // topmost first
function box(tag, l, t, w, h, attrs) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  el.getBoundingClientRect = () => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t });
  document.body.appendChild(el);
  return el;
}
function page({ w = 1000, h = 600 } = {}) {
  layers = [];
  document.body.innerHTML = '';
  document.elementsFromPoint = (x, y) => layers.filter(el => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  }).concat([document.body, document.documentElement]);
  return {
    innerWidth: w, innerHeight: h, location: { hostname: 'example.com' },
    getComputedStyle: (el) => ({ cursor: el.style.cursor || 'auto', visibility: 'visible', display: 'block' }),
  };
}
// a video at (l,t,w,h); layers listed later are lower
function video(l, t, w, h) {
  const v = box('video', l, t, w, h);
  Object.defineProperty(v, 'currentSrc', { value: 'https://cdn.example.com/a.mp4' });
  Object.defineProperty(v, 'paused', { value: false });
  Object.defineProperty(v, 'ended', { value: false });
  return v;
}
const control = (l, t, w = 40, h = 40, tag = 'button', attrs = {}) => { const el = box(tag, l, t, w, h, attrs); layers.unshift(el); return el; };
const add = (el) => { layers.push(el); return el; };

describe('where the button goes on a video (preload vexPipPlace)', () => {
  it('is the top-right corner of the video, inside it, with a small margin', () => {
    const win = page();
    add(video(100, 50, 640, 360));
    const g = vexPipPlace(document, win, {});
    expect(g.rect).toEqual({ l: 100, t: 50, w: 640, h: 360 });
    expect(g.btn.corner).toBe('top-right');
    expect(g.btn.x).toBe(100 + 640 - 8 - 32);
    expect(g.btn.y).toBe(50 + 8);
  });

  it('moves to the top-left when the player has its own controls in the top-right', () => {
    const win = page();
    control(100 + 640 - 50, 50 + 10, 40, 40, 'button', { 'aria-label': 'Cast' });
    add(video(100, 50, 640, 360));
    expect(vexPipPlace(document, win, {}).btn.corner).toBe('top-left');
  });

  it('keeps off a control that is only a pointer cursor, not a button', () => {
    const win = page();
    const d = control(100 + 640 - 50, 50 + 10, 40, 40, 'div');
    d.style.cursor = 'pointer';
    add(video(100, 50, 640, 360));
    expect(vexPipPlace(document, win, {}).btn.corner).toBe('top-left');
  });

  it("keeps off the site's own picture-in-picture and fullscreen buttons", () => {
    const win = page();
    control(100 + 640 - 90, 50 + 10, 36, 36, 'button', { 'aria-label': 'Picture in picture' });
    control(100 + 640 - 50, 50 + 10, 36, 36, 'button', { 'aria-label': 'Fullscreen' });
    add(video(100, 50, 640, 360));
    const g = vexPipPlace(document, win, {});
    expect(g.btn.corner).not.toBe('top-right');
    // and wherever it went, none of its sample points is on a control
    for (const el of layers.filter(l => l.tagName === 'BUTTON')) {
      const r = el.getBoundingClientRect();
      const hit = g.btn.x < r.right && g.btn.x + g.btn.size > r.left && g.btn.y < r.bottom && g.btn.y + g.btn.size > r.top;
      expect(hit).toBe(false);
    }
  });

  it('a layer laid over the whole video (click to pause) is not a control', () => {
    const win = page();
    const layer = box('div', 100, 50, 640, 360, { tabindex: '0' });
    layer.style.cursor = 'pointer';
    layers.push(layer);
    add(video(100, 50, 640, 360));
    expect(vexPipPlace(document, win, {}).btn.corner).toBe('top-right');
  });

  it('plain text or an image over the video does not take the corner', () => {
    const win = page();
    const label = box('span', 100 + 640 - 80, 50 + 8, 70, 30);
    layers.push(label);
    add(video(100, 50, 640, 360));
    expect(vexPipPlace(document, win, {}).btn.corner).toBe('top-right');
  });

  it('draws nothing when every corner has a control under it', () => {
    const win = page();
    const v = video(100, 50, 640, 360);
    // a button in every candidate place: corners, second row, and the middle edges
    for (const [x, y] of [[700, 58], [108, 58], [700, 98], [108, 98], [700, 176], [108, 176], [700, 322], [108, 322], [700, 340], [108, 340]]) control(x - 4, y - 4, 48, 48);
    add(v);
    const g = vexPipPlace(document, win, {});
    expect(g.rect).not.toBeNull();
    expect(g.btn).toBeNull();
  });

  it('a control below the video, or beside it, does not matter', () => {
    const win = page();
    add(video(100, 50, 640, 360));
    add(box('button', 100 + 640 - 50, 50 + 10, 40, 40));   // under the video in the stack
    layers.push(box('button', 760, 50, 40, 40));           // outside it
    expect(vexPipPlace(document, win, {}).btn.corner).toBe('top-right');
  });

  it('the video under the pointer is the one reported, and `over` says so', () => {
    const win = page();
    add(video(20, 20, 300, 200));
    add(video(400, 100, 500, 300));
    const a = vexPipPlace(document, win, { pointer: { x: 450, y: 200 } });
    expect(a.over).toBe(true);
    expect(a.rect.l).toBe(400);
    const b = vexPipPlace(document, win, { pointer: { x: 10, y: 580 } });
    expect(b.over).toBe(false);
    expect(b.rect.l).toBe(400);             // the larger one when the pointer is on none
  });

  it('a small preview or a hidden video is not given a button', () => {
    const win = page();
    add(video(10, 10, 120, 68));
    const g = vexPipPlace(document, win, {});
    expect(g.rect).toBeNull();
    expect(g.btn).toBeNull();
  });

  it('finds a video in an open shadow root handed to it, and reads controls through it', () => {
    const win = page();
    const host = box('div', 100, 50, 640, 360);
    const root = host.attachShadow({ mode: 'open' });
    const v = document.createElement('video');
    Object.defineProperty(v, 'currentSrc', { value: 'https://cdn.example.com/a.mp4' });
    v.getBoundingClientRect = () => ({ left: 100, top: 50, right: 740, bottom: 410, width: 640, height: 360 });
    root.appendChild(v);
    const cast = document.createElement('button');
    cast.getBoundingClientRect = () => ({ left: 690, top: 60, right: 730, bottom: 100, width: 40, height: 40 });
    root.appendChild(cast);
    layers.push(host);
    root.elementsFromPoint = (x, y) => (x >= 690 && x < 730 && y >= 60 && y < 100 ? [cast, v] : [v]);
    const g = vexPipPlace(document, win, { roots: [root] });
    expect(g.rect.w).toBe(640);
    expect(g.btn.corner).toBe('top-left');
  });

  it('the button is smaller in page pixels when the page is zoomed in', () => {
    const win = page();
    add(video(100, 50, 640, 360));
    expect(vexPipPlace(document, win, { zoom: 2 }).btn.size).toBe(16);
    expect(vexPipPlace(document, win, {}).btn.size).toBe(32);
  });
});

// ---- the host side ----
let wv, panelWv, wvRect;
function makeWebview(id, rect) {
  return {
    id, isConnected: true, sent: [],
    getWebContentsId: () => id,
    getURL: () => 'https://www.example.com/watch',
    getBoundingClientRect: () => ({ left: rect.l, top: rect.t, right: rect.l + rect.w, bottom: rect.t + rect.h, width: rect.w, height: rect.h }),
    contains: () => false,
    send(c) { this.sent.push(c); },
    isAudioMuted: () => false, setAudioMuted() {}, executeJavaScript: () => Promise.resolve('ok'),
  };
}
const geo = (extra = {}) => ({
  vw: 1000, vh: 500, over: true, frame: false, count: 1, playing: true, fullscreen: false, inPip: false, host: 'example.com',
  rect: { l: 0, t: 0, w: 800, h: 450 }, btn: { x: 760, y: 8, corner: 'top-right', size: 32 }, ...extra,
});
const pill = () => document.getElementById('pip-btn');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'));
  localStorage.clear();
  document.body.innerHTML = '<button id="pip-btn" style="display:none"></button><select id="setting-pip-button"><option value="hover"></option><option value="always"></option><option value="never"></option></select><div id="setting-pip-sites-row" style="display:none"><span id="setting-pip-sites-text"></span><button id="setting-pip-sites-clear"></button></div>';
  document.elementFromPoint = undefined;
  wvRect = { l: 100, t: 100, w: 1000, h: 500 };
  wv = makeWebview(12, wvRect);
  panelWv = makeWebview(21, { l: 100, t: 100, w: 500, h: 400 });
  globalThis.WebviewManager = { webviews: new Map([['tab-1', wv]]), getActiveWebview: () => wv };
  globalThis.TabManager = { activeTabId: 'tab-1', tabs: [{ id: 'tab-1', url: 'https://example.com/' }], getActiveTab() { return this.tabs[0]; }, switchTab: vi.fn() };
  globalThis.SidebarManager = { activePanel: null, sidePanel: null, panelWebviews: { site_x: panelWv }, showPanel: vi.fn() };
  window.showToast = vi.fn();
  window.vex = {
    evalAllFrames: vi.fn(async (id, code) => {
      const mode = /\)\("(scan|enter|exit)"/.exec(code)[1];
      const value = mode === 'scan' ? { inPip: false, count: 1, best: { token: 't', score: 5e12, playing: true, disabled: false, enabled: true, media: null } } : { mine: true, ok: true };
      return { ok: true, results: [{ ok: true, value }] };
    }),
    openPipWindow: vi.fn(() => Promise.resolve({ ok: true, mode: 'video' })),
    closePipWindow: vi.fn(), isPipOpen: vi.fn(() => Promise.resolve(false)), onPipClosed: () => {},
  };
  PiPManager._geo = new Map();
  PiPManager._pillWv = null;
  PiPManager._pillHover = false;
  PiPManager._source = null;
  PiPManager.init();
});
afterEach(() => { vi.useRealTimers(); });

describe('Picture-in-Picture button: when it shows (default: when I hover a video)', () => {
  it('is hidden until the pointer is over the video, and sits at the video corner, not the window corner', () => {
    PiPManager.noteGeometry(wv, geo({ over: false }), null);
    expect(pill().style.display).toBe('none');
    PiPManager.noteGeometry(wv, geo(), null);
    expect(pill().style.display).toBe('flex');
    // the page's rect + its button position, scaled to the webview (1000/1000)
    expect(pill().style.left).toBe((100 + 760) + 'px');
    expect(pill().style.top).toBe((100 + 8) + 'px');
  });

  it('follows a page that is shown at another scale', () => {
    wvRect.l = 0; wv.getBoundingClientRect = () => ({ left: 50, top: 20, right: 550, bottom: 270, width: 500, height: 250 });
    PiPManager.noteGeometry(wv, geo(), null);               // page is 1000 wide, shown 500 wide
    expect(pill().style.left).toBe(Math.round(50 + 760 * 0.5) + 'px');
    expect(pill().style.top).toBe(Math.round(20 + 8 * 0.5) + 'px');
  });

  it('goes away after 2.5 seconds of no pointer movement', () => {
    PiPManager.noteGeometry(wv, geo(), null);
    vi.advanceTimersByTime(2400);
    expect(pill().style.display).toBe('flex');
    vi.advanceTimersByTime(300);
    expect(pill().style.display).toBe('none');
  });

  it('keeps showing while the pointer keeps moving', () => {
    for (let i = 0; i < 6; i++) { PiPManager.noteGeometry(wv, geo(), null); vi.advanceTimersByTime(1000); }
    expect(pill().style.display).toBe('flex');
  });

  it('goes away when the pointer leaves the video, after a moment to reach the button', () => {
    PiPManager.noteGeometry(wv, geo(), null);
    PiPManager.noteGeometry(wv, geo({ over: false }), null);
    expect(pill().style.display).toBe('flex');
    vi.advanceTimersByTime(PiPManager.GRACE_MS + 100);
    expect(pill().style.display).toBe('none');
  });

  it('stays while the pointer is on the button itself, and goes when it leaves it', () => {
    PiPManager.noteGeometry(wv, geo(), null);
    pill().dispatchEvent(new MouseEvent('mouseenter'));
    PiPManager.noteGeometry(wv, geo({ over: false }), null);
    vi.advanceTimersByTime(10000);
    expect(pill().style.display).toBe('flex');
    pill().dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(PiPManager.GRACE_MS + 100);
    expect(pill().style.display).toBe('none');
  });

  it('a report that is not about the pointer (a scroll, play) does not bring it back', () => {
    PiPManager.noteGeometry(wv, geo(), null);
    document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));     // pointer went to Vex's own toolbar
    vi.advanceTimersByTime(PiPManager.GRACE_MS + 100);
    expect(pill().style.display).toBe('none');
    PiPManager.noteGeometry(wv, geo({ ptr: 0 }), null);                              // the page still thinks it is there
    expect(pill().style.display).toBe('none');
    PiPManager.noteGeometry(wv, geo({ ptr: 1 }), null);                              // it moved: back
    expect(pill().style.display).toBe('flex');
  });

  it('a report the page queued just before the pointer left does not keep it up', () => {
    PiPManager.noteGeometry(wv, geo(), null);
    document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    vi.advanceTimersByTime(80);
    PiPManager.noteGeometry(wv, geo(), null);               // the throttled last move report
    vi.advanceTimersByTime(PiPManager.GRACE_MS + 100);
    expect(pill().style.display).toBe('none');
    vi.advanceTimersByTime(300);                             // a real return, well after
    PiPManager.noteGeometry(wv, geo(), null);
    expect(pill().style.display).toBe('flex');
  });

  it('the pointer going onto the window around the page hides it, not 2.5 s later', () => {
    PiPManager.noteGeometry(wv, geo(), null);
    const toolbar = document.createElement('div');
    document.body.appendChild(toolbar);
    toolbar.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    vi.advanceTimersByTime(PiPManager.GRACE_MS + 100);
    expect(pill().style.display).toBe('none');
  });

  it('the pointer going onto the button itself is not leaving', () => {
    PiPManager.noteGeometry(wv, geo(), null);
    pill().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    pill().dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(PiPManager.GRACE_MS + 100);
    expect(pill().style.display).toBe('flex');
  });

  it('is never drawn when the page found no free corner', () => {
    PiPManager.noteGeometry(wv, geo({ btn: null }), null);
    expect(pill().style.display).toBe('none');
  });

  it('is hidden on a fullscreen video until the pointer moves', () => {
    PiPManager.setMode('always');
    PiPManager.noteGeometry(wv, geo({ fullscreen: true, over: false }), null);
    expect(pill().style.display).toBe('none');
    PiPManager.noteGeometry(wv, geo({ fullscreen: true }), null);
    expect(pill().style.display).toBe('flex');
    vi.advanceTimersByTime(3000);
    expect(pill().style.display).toBe('none');
  });

  it('is not drawn for a page that is not showing (another tab, a closed panel)', () => {
    PiPManager.noteGeometry(panelWv, geo(), 'site_x');
    expect(pill().style.display).toBe('none');
    SidebarManager.activePanel = 'site_x';
    PiPManager.noteGeometry(panelWv, geo(), 'site_x');
    expect(pill().style.display).toBe('flex');
    expect(pill().style.left).toBe((100 + 760 * 0.5) + 'px');     // the panel is 500 wide for a 1000 wide page
  });

  it('is not drawn over a menu or a dialog that covers the spot', () => {
    document.elementFromPoint = () => document.createElement('div');
    PiPManager.noteGeometry(wv, geo(), null);
    expect(pill().style.display).toBe('none');
  });

  it('a video inside another site\'s frame only counts while the page is playing media', () => {
    PiPManager.noteGeometry(wv, geo({ frame: true }), null);
    expect(pill().style.display).toBe('none');
    wv._vexMediaPlaying = true;
    PiPManager.noteGeometry(wv, geo({ frame: true }), null);
    expect(pill().style.display).toBe('flex');
    vi.advanceTimersByTime(10000);                          // no movement is visible through a frame
    expect(pill().style.display).toBe('flex');
  });

  it('a page that navigated (rect null) takes the button away at once', () => {
    PiPManager.noteGeometry(wv, geo(), null);
    PiPManager.noteGeometry(wv, { rect: null, btn: null, over: false }, null);
    expect(pill().style.display).toBe('none');
  });

  it('the old always-on corner behaviour is gone: a detected video alone shows nothing', () => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'vex-video-detected', hasVideo: true } }));
    expect(pill().style.display).toBe('none');
    wv._vexMediaPlaying = true;
    document.dispatchEvent(new CustomEvent('vex:panel-changed', { detail: {} }));
    expect(pill().style.display).toBe('none');
  });
});

describe('Settings: When I hover a video / Always show / Never show', () => {
  it('defaults to hover, and stores the other two', () => {
    expect(PiPManager.mode()).toBe('hover');
    PiPManager.setMode('always');
    expect(localStorage.getItem('vex.pipButton')).toBe('always');
    PiPManager.setMode('never');
    expect(PiPManager.mode()).toBe('never');
    PiPManager.setMode('hover');
    expect(localStorage.getItem('vex.pipButton')).toBeNull();
  });

  it('refuses an unknown value instead of storing it', () => {
    expect(() => PiPManager.setMode('sometimes')).toThrow(/Unknown Picture-in-Picture button setting/);
    expect(PiPManager.mode()).toBe('hover');
  });

  it('Always show: shown on a video without the pointer, still at the free corner', () => {
    PiPManager.setMode('always');
    PiPManager.noteGeometry(wv, geo({ over: false }), null);
    expect(pill().style.display).toBe('flex');
    vi.advanceTimersByTime(60000);
    expect(pill().style.display).toBe('flex');
  });

  it('Never show: nothing is drawn, whatever the pointer does; the shortcut still floats the video', async () => {
    PiPManager.setMode('never');
    PiPManager.noteGeometry(wv, geo(), null);
    expect(pill().style.display).toBe('none');
    expect(await PiPManager.toggle()).toBe('entered');
  });

  it('changing the select in Settings changes the mode and the button at once', () => {
    PiPManager.noteGeometry(wv, geo(), null);
    expect(pill().style.display).toBe('flex');
    const sel = document.getElementById('setting-pip-button');
    sel.value = 'never';
    sel.dispatchEvent(new Event('change'));
    expect(PiPManager.mode()).toBe('never');
    expect(pill().style.display).toBe('none');
  });

  it('shows the saved choice in the select', () => {
    localStorage.setItem('vex.pipButton', 'always');
    PiPManager._syncSettings();
    expect(document.getElementById('setting-pip-button').value).toBe('always');
  });

  it('is synced with the other settings', () => {
    expect(APP).toMatch(/'vex\.pipButton', 'vex\.pipButtonOff'/);
    expect(HTML).toMatch(/id="setting-pip-button"[\s\S]*?value="hover"[\s\S]*?value="always"[\s\S]*?value="never"/);
  });
});

describe('Don\'t show here (per site)', () => {
  it('hides the button on that site only, and Settings lists it with a way back', () => {
    PiPManager.hideSite('Example.com');
    expect(PiPManager.hiddenSites()).toEqual(['example.com']);
    PiPManager.noteGeometry(wv, geo(), null);
    expect(pill().style.display).toBe('none');
    PiPManager.noteGeometry(wv, geo({ host: 'other.org' }), null);
    expect(pill().style.display).toBe('flex');
    expect(document.getElementById('setting-pip-sites-row').style.display).toBe('');
    expect(document.getElementById('setting-pip-sites-text').textContent).toContain('example.com');
    document.getElementById('setting-pip-sites-clear').click();
    expect(PiPManager.hiddenSites()).toEqual([]);
    expect(document.getElementById('setting-pip-sites-row').style.display).toBe('none');
  });

  it('the button\'s right-click menu offers it, and choosing it hides the button there', () => {
    PiPManager.noteGeometry(wv, geo(), null);
    pill().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 900, clientY: 120 }));
    const items = [...document.querySelectorAll('.tab-context-menu .tab-context-item')].map(i => i.textContent);
    expect(items).toContain("Don't show here");
    expect(items).toContain('Always show on videos');
    expect(items).toContain('Never show (use Ctrl+Shift+P)');
    [...document.querySelectorAll('.tab-context-item')].find(i => i.textContent === "Don't show here").click();
    expect(PiPManager.siteHidden('example.com')).toBe(true);
    expect(pill().style.display).toBe('none');
  });

  it('a page with no site name cannot be hidden, and says so', () => {
    expect(() => PiPManager.hideSite('')).toThrow(/no site name/);
  });
});

describe('the button still floats the video it is over, in a tab and in a panel', () => {
  it('clicking it floats the video of the page it is drawn on', async () => {
    PiPManager.noteGeometry(wv, geo(), null);
    pill().click();
    await vi.advanceTimersByTimeAsync(0);
    const calls = window.vex.evalAllFrames.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(c => c[0] === 12)).toBe(true);
    expect(calls.some(c => /\)\("enter"/.test(c[1]))).toBe(true);
  });

  it('on a panel, it floats the panel\'s video, not the tab\'s', async () => {
    SidebarManager.activePanel = 'site_x';
    PiPManager.noteGeometry(panelWv, geo(), 'site_x');
    expect(pill().style.display).toBe('flex');
    pill().click();
    await vi.advanceTimersByTimeAsync(0);
    const calls = window.vex.evalAllFrames.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(c => c[0] === 21)).toBe(true);
  });

  it('is still the same toggle: a floating pop-out is closed by it', async () => {
    window.vex.isPipOpen = vi.fn(() => Promise.resolve(true));
    PiPManager.noteGeometry(wv, geo(), null);
    pill().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(window.vex.closePipWindow).toHaveBeenCalled();
  });
});

describe('wiring', () => {
  it('tabs and panels relay the page\'s geometry to the manager', () => {
    expect(WEBVIEW).toMatch(/e\.channel === 'vex-pip-geometry'[\s\S]*?PiPManager\.noteGeometry\(webview,/);
    expect(SIDEBAR).toMatch(/e\.channel === 'vex-pip-geometry'[\s\S]*?PiPManager\.noteGeometry\(wv, [\s\S]*?panelName\)/);
  });

  it('the page no longer injects its own "PiP" overlay onto every video', () => {
    expect(PRELOAD).not.toMatch(/data-vex-pip/);
    expect(PRELOAD).toMatch(/vex-pip-geometry/);
  });

  it('the pill is small and only it takes the pointer', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/css/panels.css'), 'utf8');
    const rule = /#pip-btn \{[^}]*\}/.exec(css)[0];
    expect(rule).toMatch(/position: fixed/);
    expect(rule).toMatch(/width: 32px/);
    expect(rule).toMatch(/opacity: 0\.6/);
    expect(rule).not.toMatch(/bottom:|right:/);
    expect(HTML).toMatch(/<button id="pip-btn" title="Picture in Picture \(Ctrl\+Shift\+P\)"/);
  });
});

describe('Turkish', () => {
  it('the tooltip, the Settings row and the menu are translated', () => {
    for (const s of ['Picture in Picture (Ctrl+Shift+P)', 'Picture-in-Picture button on videos', 'When I hover a video', 'Always show',
      'Never show (keyboard shortcut only)', 'Show it on all sites again', "Don't show here", 'Show only when I hover a video',
      'Always show on videos', 'Never show (use Ctrl+Shift+P)']) {
      expect(VexI18nUI.lookup(s, 'tr'), s).toBeTruthy();
    }
    expect(VexI18nUI.lookup('Picture-in-Picture button hidden for a.com,b.org', 'tr')).toContain('a.com,b.org');
    expect(VexI18nUI.SCOPES).toContain('#pip-btn');
  });
});
