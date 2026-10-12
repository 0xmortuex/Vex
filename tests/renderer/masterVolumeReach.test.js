// @vitest-environment jsdom
//
// Master Volume above 100% did nothing for a player in a shadow root (custom
// player elements, which is how some streaming sites build theirs), for a
// player that never is in the page (new Audio().play()), for a page's own Web
// Audio graph, and in a private window, off-the-record tab, identity tab and
// Tor tab, where no CORS header was added so a cross-origin player stayed at
// 100% (measured in the running app 2026-10-12). The slider also said nothing
// about what it did on the page in front.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fs = require('fs'), path = require('path');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/site-volume.js');
const { MasterVolume } = require('../../src/renderer/js/master-volume.js');
const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
const COMMANDS = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/command.js'), 'utf8');

const runInPage = (js) => (0, eval)(js);

// A Web Audio stand-in: a source per element (only once, as the real one), gains that hold a value.
function fakeAudio() {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } });
  class Ctx {
    constructor() { this.state = 'running'; this.destination = {}; }
    addEventListener() {}
    resume() { return Promise.resolve(); }
    createMediaElementSource(m) {
      if (m.__routed) { const e = new Error('already connected'); e.name = 'InvalidStateError'; throw e; }
      m.__routed = true; return node();
    }
    createGain() { return node(); }
  }
  window.AudioContext = Ctx;
}

// The page's own Web Audio, with real connect()/disconnect() bookkeeping.
function pageAudio() {
  class AudioNode { constructor(ctx) { this.context = ctx; this.to = []; } connect(d) { this.to.push(d); return d; } disconnect(d) { this.to = d ? this.to.filter(x => x !== d) : []; } }
  class AudioDestinationNode extends AudioNode {}
  class GainNode extends AudioNode { constructor(ctx) { super(ctx); this.gain = { value: 1 }; } }
  class PageCtx {
    constructor() { this.state = 'running'; this.destination = new AudioDestinationNode(this); }
    createGain() { return new GainNode(this); }
    addEventListener() {}
    resume() { return Promise.resolve(); }
  }
  window.AudioNode = AudioNode; window.AudioDestinationNode = AudioDestinationNode;
  return { AudioNode, PageCtx };
}

let realPlay;
beforeEach(() => {
  for (const k of ['__vexMV', '__vexAudio', '__vexVolume', '__vexVolumeWired', 'AudioContext', 'AudioNode', 'AudioDestinationNode', 'vexGuestEvalFrames']) delete window[k];
  document.replaceChild(document.createElement('html'), document.documentElement);
  document.documentElement.append(document.createElement('head'), document.createElement('body'));
  localStorage.clear();
  realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
});
afterEach(() => { HTMLMediaElement.prototype.play = realPlay; vi.restoreAllMocks(); });

describe('players the page keeps out of reach', () => {
  it('a player inside an open shadow root is boosted', () => {
    fakeAudio();
    document.body.innerHTML = '<div id="host"></div>';
    const root = document.getElementById('host').attachShadow({ mode: 'open' });
    root.innerHTML = '<video></video>';
    const v = root.querySelector('video');
    runInPage(MasterVolume._script(2));
    expect(window.__vexAudio.nodes.get(v).out.gain.value).toBe(2);
  });

  it('a player that never is in the page is boosted when it plays', () => {
    fakeAudio();
    runInPage(MasterVolume._script(2));
    const a = new Audio();
    a.play();
    expect(window.__vexAudio.nodes.get(a).out.gain.value).toBe(2);
  });

  it('a player in a closed shadow root made after the script ran is boosted when it plays', () => {
    fakeAudio();
    runInPage(MasterVolume._script(2));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'closed' });
    const v = document.createElement('video');
    root.appendChild(v);
    v.dispatchEvent(new Event('play'));
    expect(window.__vexAudio.nodes.get(v).out.gain.value).toBe(2);
  });

  it('a page at 100% is not touched: no wrapper on play, attachShadow or connect', () => {
    fakeAudio();
    const { AudioNode } = pageAudio();
    const [play, attach, connect] = [HTMLMediaElement.prototype.play, Element.prototype.attachShadow, AudioNode.prototype.connect];
    runInPage(MasterVolume._script(1));
    expect(HTMLMediaElement.prototype.play).toBe(play);
    expect(Element.prototype.attachShadow).toBe(attach);
    expect(AudioNode.prototype.connect).toBe(connect);
  });
});

describe("a page's own Web Audio", () => {
  it('what it sends to its destination goes through one gain that the slider sets', () => {
    fakeAudio();
    const { PageCtx } = pageAudio();
    runInPage(MasterVolume._script(2));
    const c = new PageCtx();
    const g = c.createGain();
    g.connect(c.destination);
    expect(g.to[0]).not.toBe(c.destination);
    const master = g.to[0];
    expect(master.gain.value).toBe(2);
    expect(master.to).toEqual([c.destination]);
    window.__vexMV.set(3);
    expect(master.gain.value).toBe(3);
    window.__vexMV.set(0.5);
    expect(master.gain.value).toBe(0.5);       // turned down too, not only up
  });

  it('a second graph on the same context shares that one gain, and disconnect still works', () => {
    fakeAudio();
    const { PageCtx } = pageAudio();
    runInPage(MasterVolume._script(2));
    const c = new PageCtx();
    const a = c.createGain(), b = c.createGain();
    a.connect(c.destination); b.connect(c.destination);
    expect(a.to[0]).toBe(b.to[0]);
    a.disconnect(c.destination);
    expect(a.to).toEqual([]);
  });

  it("Vex's own tap graph is never sent through it", () => {
    fakeAudio();
    pageAudio();
    document.body.innerHTML = '<video></video>';
    runInPage(MasterVolume._script(2));
    const out = window.__vexAudio.nodes.get(document.querySelector('video')).out;
    expect(out.gain.value).toBe(2);                         // the element's own gain, once
    expect(window.__vexAudio.ctx.destination).toEqual({});  // untouched
  });
});

describe('what the slider says about the page in front', () => {
  it('the page script reports players, boosted ones and why the rest are not', () => {
    fakeAudio();
    document.body.innerHTML = '<video id="a"></video><audio id="b" src="http://192.168.1.20/radio.mp3"></audio>';
    const b = document.getElementById('b');
    b.load = () => {};
    b.play = () => Promise.resolve();
    runInPage(MasterVolume._script(2));
    b.dispatchEvent(new Event('error'));              // the server on the local network sends no CORS header
    expect(window.__vexMV.report()).toMatchObject({ players: 2, boosted: 1, why: { cors: 1 } });
  });

  it('says it in words, and says nothing at or below 100%', () => {
    const d = (t, pct) => MasterVolume.describe({ players: 0, boosted: 0, contexts: 0, why: {}, ...t }, pct);
    expect(d({ players: 2, boosted: 2 }, 200)).toBe('Boosting 2 players on this page.');
    expect(d({ players: 1, boosted: 1 }, 200)).toBe('Boosting 1 player on this page.');
    expect(d({ players: 1, why: { silent: 1 } }, 200)).toContain("Protected video (DRM): the browser cannot boost it above 100%. Use the video's own volume or Windows' volume.");
    expect(d({ players: 1, why: { cors: 1 } }, 200)).toContain('own network');
    expect(d({}, 200)).toContain('Nothing is playing on this page yet');
    // sound that Chromium hears but no player of ours is under: say what to do
    expect(d({ audible: 1 }, 200)).toContain('Reload the page to boost it');
    expect(d({ players: 2, boosted: 2 }, 100)).toBe('');
  });

  it('the open slider shows what the pages in front answered', async () => {
    window.vexGuestEvalFrames = vi.fn(async () => ({ all: true, results: [{ ok: true, value: { players: 3, boosted: 2, contexts: 0, why: { cors: 1 } } }, { ok: false, error: 'x' }] }));
    globalThis.WebviewManager = { getActiveWebview: () => ({ id: 'tab' }), webviews: new Map() };
    globalThis.SidebarManager = { activePanel: 'p1', sidePanel: null, panelWebviews: { p1: { id: 'panel' } } };
    localStorage.setItem(MasterVolume.KEY, '2');
    MasterVolume.show();
    await vi.waitFor(() => expect(document.querySelector('.mastervol-status').hidden).toBe(false));
    // the tab and the panel are both asked, and added up
    expect(window.vexGuestEvalFrames).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.mastervol-status').textContent).toMatch(/Boosting 4 players on this page\./);
    MasterVolume.close();
    delete globalThis.WebviewManager; delete globalThis.SidebarManager;
  });
});

// Vex's Widevine is a software CDM and the decrypted sound can be routed through Web
// Audio (measured on the Shaka Widevine demo, 2026-10-12): protected players boost.
// A tapped element cannot be un-tapped, so sound that stays silent is put back by
// reloading the page once with boosting off.
describe('protected (EME) players', () => {
  const protectedVideo = (html = '<video></video>') => {
    document.body.innerHTML = html;
    const v = document.querySelector('video');
    Object.defineProperty(v, 'mediaKeys', { value: {} });
    Object.defineProperty(v, 'paused', { value: false });
    Object.defineProperty(v, 'readyState', { value: 4 });
    return v;
  };
  // Web Audio whose analyser hears `sample` for ever.
  const audioHearing = (sample) => {
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } });
    class Ctx {
      constructor() { this.state = 'running'; this.destination = {}; }
      addEventListener() {}
      resume() { return Promise.resolve(); }
      createMediaElementSource() { return node(); }
      createGain() { return node(); }
      createAnalyser() { return { fftSize: 1024, connect() {}, getFloatTimeDomainData(b) { b.fill(sample); } }; }
    }
    window.AudioContext = Ctx;
  };
  beforeEach(() => { vi.useFakeTimers(); sessionStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); sessionStorage.clear(); });

  it('is boosted like any other player', () => {
    audioHearing(0.1);
    const v = protectedVideo();
    runInPage(MasterVolume._script(2));
    expect(window.__vexAudio.nodes.get(v).out.gain.value).toBe(2);
    expect(window.__vexMV.report()).toMatchObject({ players: 1, boosted: 1 });
  });

  it('whose sound arrives is left alone', () => {
    audioHearing(0.1);
    protectedVideo();
    const reload = vi.fn();
    vi.stubGlobal('location', { href: 'http://site.test/', reload });
    runInPage(MasterVolume._script(2));
    vi.advanceTimersByTime(15000);
    expect(sessionStorage.getItem('__vexMVOff')).toBe(null);
    expect(reload).not.toHaveBeenCalled();
    expect(window.__vexMV.report().why).toEqual({});
  });

  it('whose sound stays digitally silent 10 s after the tap reloads the page once with boosting off', () => {
    audioHearing(0);
    const v = protectedVideo();
    const reload = vi.fn();
    vi.stubGlobal('location', { href: 'http://site.test/', reload });
    runInPage(MasterVolume._script(2));
    vi.advanceTimersByTime(9000);
    expect(sessionStorage.getItem('__vexMVOff')).toBe(null);     // not yet
    vi.advanceTimersByTime(2000);
    expect(sessionStorage.getItem('__vexMVOff')).toBe('1');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.__vexMV.report().why).toEqual({ silent: 1 });
    expect(window.__vexAudio.nodes.get(v)).toBeTruthy();
  });

  it('after that reload the page is not tapped again, and the slider says why', () => {
    audioHearing(0.1);
    sessionStorage.setItem('__vexMVOff', '1');
    const v = protectedVideo();
    runInPage(MasterVolume._script(2));
    expect(window.__vexAudio && window.__vexAudio.nodes.get(v)).toBeFalsy();
    expect(window.__vexMV.report().why).toEqual({ silent: 1 });
    expect(MasterVolume.describe({ players: 1, boosted: 0, contexts: 0, why: { silent: 1 }, audible: 0 }, 200))
      .toContain("Protected video (DRM): the browser cannot boost it above 100%. Use the video's own volume or Windows' volume.");
  });

  it('paused or muted sound is not mistaken for silence', () => {
    audioHearing(0);
    const v = protectedVideo();
    Object.defineProperty(v, 'muted', { value: true });
    runInPage(MasterVolume._script(2));
    vi.advanceTimersByTime(30000);
    expect(sessionStorage.getItem('__vexMVOff')).toBe(null);
  });
});

describe('every session gets the media CORS header', () => {
  it('each onHeadersReceived handler in main.js that holds scripts off also adds it', () => {
    const handlers = MAIN.split('webRequest.onHeadersReceived(').slice(1);
    expect(handlers.length).toBeGreaterThanOrEqual(7);
    for (const h of handlers) {
      const body = h.slice(0, h.indexOf('callback({ responseHeaders'));
      expect(body).toMatch(/_addMediaCorsHeaders\(details, (responseHeaders|rh)\)/);
    }
  });
  it('Ctrl+K has a Master Volume command', () => {
    expect(COMMANDS).toMatch(/id: 'master-volume', label: 'Master Volume'.*MasterVolume\.show\(\)/);
  });
});
