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
    document.body.innerHTML = '<video id="a"></video><video id="b"></video>';
    Object.defineProperty(document.getElementById('b'), 'mediaKeys', { value: {} });
    runInPage(MasterVolume._script(2));
    expect(window.__vexMV.report()).toMatchObject({ players: 2, boosted: 1, why: { drm: 1 } });
  });

  it('says it in words, and says nothing at or below 100%', () => {
    const d = (t, pct) => MasterVolume.describe({ players: 0, boosted: 0, contexts: 0, why: {}, ...t }, pct);
    expect(d({ players: 2, boosted: 2 }, 200)).toBe('Boosting 2 players on this page.');
    expect(d({ players: 1, boosted: 1 }, 200)).toBe('Boosting 1 player on this page.');
    expect(d({ players: 1, why: { drm: 1 } }, 200)).toContain("Protected video (DRM): the browser cannot boost it above 100%. Use the video's own volume or Windows' volume.");
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
