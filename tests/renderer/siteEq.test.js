// @vitest-environment jsdom
//
// js/site-eq.js: bass, treble, mono and balance kept per site. The signal itself (the chain measured on an
// offline audio context and on a real playing element) is proved in a real Electron probe, not here: jsdom has no
// audio. What is tested here is the logic around it - the settings, the storage, the page script's routing with a
// recording fake of the audio graph (never touched while flat, tapped when a setting moves, bypassed when flat
// again, another site's sound and protected video left alone and reported), and the box in the volume slider.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { VexSiteEq: E } = require('../../src/renderer/js/site-eq.js');

beforeEach(() => { localStorage.clear(); });

describe('the settings', () => {
  it('are clamped and rounded: +-12 dB in whole steps, balance -1..1, mono a real boolean', () => {
    expect(E.clean({ bass: 40, treble: -40, balance: 3, mono: 'yes' })).toEqual({ bass: 12, treble: -12, balance: 1, mono: false });
    expect(E.clean({ bass: 2.6, treble: -0.4, balance: 0.33, mono: true })).toEqual({ bass: 3, treble: 0, balance: 0.35, mono: true });
    expect(E.clean(null)).toEqual({ bass: 0, treble: 0, balance: 0, mono: false });
    expect(E.clean({ bass: 'x', treble: NaN })).toEqual({ bass: 0, treble: 0, balance: 0, mono: false });
    expect(Object.is(E.clean({ bass: -0.2 }).bass, 0)).toBe(true);   // never -0
  });
  it('knows flat', () => {
    expect(E.isNeutral({})).toBe(true);
    expect(E.isNeutral({ bass: 0.3 })).toBe(true);                   // rounds to flat
    for (const c of [{ bass: 1 }, { treble: -1 }, { balance: 0.1 }, { mono: true }]) expect(E.isNeutral(c)).toBe(false);
  });
});

describe('kept per site', () => {
  it('saves for the site, covers its subdomains and www, and is flat elsewhere', () => {
    expect(E.save('https://www.example.com/watch?v=1', { bass: 6 })).toBe('example.com');
    expect(E.for('https://example.com/other').bass).toBe(6);
    expect(E.for('https://video.example.com/x').bass).toBe(6);
    expect(E.for('https://notexample.com/').bass).toBe(0);
    expect(E.for('https://example.org/').bass).toBe(0);
    expect(E.has('https://video.example.com/')).toBe(true);
    expect(E.has('about:blank')).toBe(false);
  });
  it('flat removes the site, and a second subdomain edit updates the one entry', () => {
    E.save('https://example.com/', { treble: 5 });
    E.save('https://a.example.com/', { treble: 7 });
    expect(Object.keys(E.all())).toEqual(['example.com']);
    expect(E.for('https://example.com/').treble).toBe(7);
    E.save('https://example.com/', {});
    expect(E.all()).toEqual({});
  });
  it('refuses a page that is not a web page, and says so for a damaged store', () => {
    expect(() => E.save('about:blank', { bass: 3 })).toThrow('That is not a web page');
    expect(() => E.save('vex://newtab', { bass: 3 })).toThrow('That is not a web page');
    localStorage.setItem(E.KEY, '{broken');
    expect(() => E.all()).toThrow(/could not be read/);
  });
  it('drops flat and invalid entries when reading, and cleans the rest', () => {
    localStorage.setItem(E.KEY, JSON.stringify({ 'a.com': { bass: 99 }, 'b.com': { bass: 0 }, 'c.com': 5 }));
    expect(E.all()).toEqual({ 'a.com': { bass: 12, treble: 0, balance: 0, mono: false } });
  });
  it('forget removes one site', () => {
    E.save('https://a.com/', { bass: 1 }); E.save('https://b.com/', { bass: 2 });
    expect(E.forget('a.com')).toBe(true);
    expect(E.forget('a.com')).toBe(false);
    expect(Object.keys(E.all())).toEqual(['b.com']);
  });
});

describe('what it cannot shape is said in words', () => {
  it('counts players and reasons', () => {
    expect(E.limits([{ players: 3, shaped: 1, why: { cors: 1, drm: 1 } }])).toBe('Shaping 1 player on this page. 1 player plays from another site that does not allow its sound to be processed, and stays as it was. Protected video (DRM) cannot be shaped; use the video\'s own volume.');
    expect(E.limits([{ players: 5, shaped: 2, why: { cors: 3 } }, { players: 1, shaped: 0, why: { tapfail: 1 } }])).toBe('Shaping 2 players on this page. 3 players play from another site that does not allow their sound to be processed, and stay as they were. 1 player could not be reached.');
    expect(E.limits([{ players: 2, shaped: 0, why: { routed: 2 } }])).toContain('2 players already use the page\'s own audio processing');
    expect(E.limits([{ players: 0, shaped: 0, why: {} }])).toContain('Nothing is playing on this page yet');
    expect(E.limits([{ players: 1, shaped: 0, why: {} }])).toBe('Waiting for the sound to start.');
    expect(E.limits([])).toContain('Nothing is playing');
  });
});

describe('the page script', () => {
  it('compiles, builds the chain in the order gain -> low shelf -> high shelf -> mono -> balance -> speakers', () => {
    const s = E.script({ bass: 3 });
    expect(() => new Function(s)).not.toThrow();
    const order = ["createBiquadFilter(); low.type='lowshelf'", "high.type='highshelf'", 'var mono=c.createGain()', 'c.createStereoPanner()', 'low.connect(high); high.connect(mono); mono.connect(pan); pan.connect(dest)'];
    let at = -1;
    for (const part of order) { const i = s.indexOf(part); expect(i, part).toBeGreaterThan(at); at = i; }
    expect(s).toContain('n.out.connect(n.eq.input)');           // the master gain feeds the chain
    expect(s).toContain('{"bass":3,"treble":0,"balance":0,"mono":false}');
  });
  it('cannot be fed a script through the settings: only the four numbers/boolean reach it', () => {
    const s = E.script({ bass: '1);alert(1);//', mono: 'true);x(', balance: { toString() { return 'x'; } } });
    expect(s).toContain('({"bass":0,"treble":0,"balance":0,"mono":false});');
    expect(s).not.toContain('alert');
  });
});

// A recording fake of the audio graph, enough for the script's routing.
function installFakeAudio({ state = 'running' } = {}) {
  const log = { sources: 0, connects: [], disconnects: [] };
  class Node {
    constructor(kind) { this.kind = kind; this.id = ++Node.n; }
    connect(d) { log.connects.push([this.kind + this.id, d.kind + d.id]); return d; }
    disconnect(d) { if (!d) return; log.disconnects.push([this.kind + this.id, d.kind + d.id]); }
  }
  Node.n = 0;
  class Param { constructor() { this.value = 0; } }
  class Ctx {
    constructor() { this.state = state; this.destination = new Node('dest'); log.ctx = this; }
    createMediaElementSource(m) { if (m.__routedByPage) { const e = new Error('already'); e.name = 'InvalidStateError'; throw e; } log.sources++; return new Node('src'); }
    createGain() { const n = new Node('gain'); n.gain = new Param(); n.gain.value = 1; return n; }
    createBiquadFilter() { const n = new Node('biquad'); n.gain = new Param(); n.frequency = new Param(); return n; }
    createStereoPanner() { const n = new Node('pan'); n.pan = new Param(); return n; }
    resume() { return new Promise((res) => { log.release = () => { this.state = 'running'; res(); }; }); }
  }
  window.AudioContext = Ctx;
  window.__vexAudio = undefined; window.__vexEq = undefined;
  return log;
}
const player = (o = {}) => {
  const m = document.createElement('audio');
  if (o.src) Object.defineProperty(m, 'currentSrc', { value: o.src });
  if (o.drm) Object.defineProperty(m, 'mediaKeys', { value: {} });
  if (o.routed) m.__routedByPage = true;
  m.load = vi.fn(); m.play = vi.fn(() => Promise.resolve());
  document.body.appendChild(m);
  return m;
};
const run = (cfg) => (0, eval)(E.script(cfg));

describe('the page script routes only when a setting moves', () => {
  let log;
  beforeEach(() => { document.body.innerHTML = ''; log = installFakeAudio(); });
  afterEach(() => { delete window.AudioContext; delete window.__vexAudio; delete window.__vexEq; });

  it('never touches a player while everything is flat', () => {
    const m = player();
    run({});
    expect(log.sources).toBe(0);
    expect(window.__vexAudio.nodes.get(m)).toBeUndefined();
    expect(window.__vexEq.report()).toMatchObject({ players: 1, shaped: 0, neutral: true });
  });

  it('taps a player once a setting moves, sends its gain through the chain, and not to the speakers directly', () => {
    const m = player();
    run({});
    run({ bass: 6 });
    expect(log.sources).toBe(1);
    const n = window.__vexAudio.nodes.get(m);
    expect(n.eqThrough).toBe(true);
    expect(n.eq.low.gain.value).toBe(6);
    const out = 'gain' + n.out.id;   // the player's master gain
    expect(log.disconnects.some(([a, b]) => b.startsWith('dest') && a === out)).toBe(true);
    expect(log.connects.some(([a, b]) => a === out && b.startsWith('biquad'))).toBe(true);
    expect(window.__vexEq.report()).toMatchObject({ players: 1, shaped: 1 });
  });

  it('puts the settings on the nodes: shelves in dB, balance on the panner, mono as a one-channel mix', () => {
    const m = player();
    run({ bass: -4, treble: 9, balance: 0.4, mono: true });
    const t = window.__vexAudio.nodes.get(m).eq;
    expect([t.low.gain.value, t.high.gain.value, t.pan.pan.value]).toEqual([-4, 9, 0.4]);
    expect(t.mono.channelCount).toBe(1);
    expect(t.mono.channelCountMode).toBe('explicit');
    expect(t.mono.gain.value).toBeCloseTo(Math.SQRT2, 6);
    run({ mono: false, bass: 1 });
    expect(t.mono.channelCountMode).toBe('max');
    expect(t.mono.gain.value).toBe(1);
  });

  it('flat again bypasses the chain: the gain goes straight to the speakers, and the player is not tapped twice', () => {
    const m = player();
    run({ treble: 5 });
    log.connects.length = 0; log.disconnects.length = 0;
    run({});
    const n = window.__vexAudio.nodes.get(m);
    expect(n.eqThrough).toBe(false);
    expect(log.connects.some(([a, b]) => a === 'gain' + n.out.id && b.startsWith('dest'))).toBe(true);
    expect(log.sources).toBe(1);
    run({ treble: 5 });
    expect(log.sources).toBe(1);
    expect(n.eqThrough).toBe(true);
  });

  it('shapes a player that appears later, and waits for the audio engine to run', async () => {
    run({ bass: 3 });
    const late = player();
    window.__vexEq.set({ bass: 3, treble: 0, balance: 0, mono: false });
    expect(window.__vexAudio.nodes.get(late).eqThrough).toBe(true);
    delete window.__vexAudio; delete window.__vexEq;
    log = installFakeAudio({ state: 'suspended' });
    const m2 = player();
    run({ bass: 3 });
    expect(log.sources).toBe(0);                               // not tapped while the engine is not running
    log.release();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(window.__vexAudio.nodes.get(m2).eqThrough).toBe(true);   // and tapped as soon as it runs
  });

  it('leaves protected video alone and says why', () => {
    player({ drm: true });
    run({ bass: 5 });
    expect(log.sources).toBe(0);
    expect(window.__vexEq.report().why).toEqual({ drm: 1 });
  });

  it('a player the page already routed is reported as such, not broken', () => {
    player({ routed: true });
    run({ bass: 5 });
    expect(window.__vexEq.report().why).toEqual({ routed: 1 });
  });

  it('another site\'s sound is asked for permission once (crossOrigin set, reloaded) and never tapped before it answers', () => {
    const m = player({ src: 'https://cdn.other.example/a.mp4' });
    run({ bass: 5 });
    expect(m.crossOrigin).toBe('anonymous');
    expect(m.load).toHaveBeenCalledTimes(1);
    expect(log.sources).toBe(0);
    // the server refuses
    m.dispatchEvent(new Event('error'));
    expect(m.crossOrigin).toBe(null);
    expect(window.__vexEq.report().why).toEqual({ cors: 1 });
    expect(log.sources).toBe(0);
    // the server allows it
    const ok = player({ src: 'https://cdn.other.example/b.mp4' });
    window.__vexEq.set({ bass: 5, treble: 0, balance: 0, mono: false });
    ok.dispatchEvent(new Event('canplay'));
    expect(window.__vexAudio.nodes.get(ok).eqThrough).toBe(true);
  });
});

describe('the box in the volume slider', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.showToast = vi.fn();
    window.vexGuestUrl = (wv) => wv.url;
    window.MasterVolume = { _allWebviews: () => window.__wvs || [] };
  });
  afterEach(() => { delete window.__wvs; delete window.MasterVolume; vi.useRealTimers(); });
  const webview = (url) => ({ url });
  const ranges = (box) => [...box.querySelectorAll('input[type=range]')];

  it('draws bass, treble and balance sliders and a mono box for a web page, and nothing for other pages', () => {
    const box = document.createElement('div');
    E.draw(box, { url: 'about:blank', wv: webview('about:blank'), persist: true });
    expect(box.children.length).toBe(0);
    E.draw(box, { url: 'https://example.com/v', wv: webview('https://example.com/v'), persist: true });
    expect(ranges(box).map(r => r.getAttribute('aria-label'))).toEqual(['Bass', 'Treble', 'Left / right']);
    expect(box.querySelector('input[type=checkbox]')).toBeTruthy();
    expect(box.textContent).toContain('Protected video (DRM)');   // the limits are stated before anything is tried
    expect(box.textContent).toContain('example.com');
  });

  it('moving a slider applies to every tab on the site at once, and a change keeps it for the site', () => {
    const a = webview('https://example.com/a'), b = webview('https://video.example.com/b'), other = webview('https://other.org/');
    window.__wvs = [a, b, other];
    const sent = [];
    window.vexGuestEvalFrames = vi.fn(async (wv, code) => { sent.push([wv, code]); return { results: [] }; });
    const box = document.createElement('div'); document.body.appendChild(box);
    E.draw(box, { url: a.url, wv: a, persist: true });
    const bass = ranges(box)[0];
    bass.value = '8'; bass.dispatchEvent(new Event('input'));
    expect(sent.map(([wv]) => wv).sort()).toEqual([a, b].sort());
    expect(sent.every(([, code]) => code.includes('"bass":8'))).toBe(true);
    expect(E.for(a.url).bass).toBe(0);                          // an input alone is not kept yet
    bass.dispatchEvent(new Event('change'));
    expect(E.for(a.url).bass).toBe(8);
    expect(E.for(b.url).bass).toBe(8);
    expect(E.for(other.url).bass).toBe(0);
    expect(box.textContent).toContain('Sound settings kept for example.com.');
  });

  it('mono and Back to flat', () => {
    const a = webview('https://example.com/a'); window.__wvs = [a];
    window.vexGuestEvalFrames = vi.fn(async () => ({ results: [] }));
    const box = document.createElement('div'); document.body.appendChild(box);
    E.draw(box, { url: a.url, wv: a, persist: true });
    const mono = box.querySelector('input[type=checkbox]');
    mono.checked = true; mono.dispatchEvent(new Event('change'));
    expect(E.for(a.url).mono).toBe(true);
    [...box.querySelectorAll('button')].find(b => b.textContent === 'Back to flat').click();
    expect(E.has(a.url)).toBe(false);
    expect(mono.checked).toBe(false);
    expect(ranges(box).every(r => +r.value === 0)).toBe(true);
  });

  it('a private tab applies the sound but keeps nothing and says so', () => {
    const a = webview('https://example.com/a'); window.__wvs = [a];
    window.vexGuestEvalFrames = vi.fn(async () => ({ results: [] }));
    const box = document.createElement('div'); document.body.appendChild(box);
    E.draw(box, { url: a.url, wv: a, persist: false });
    const t = ranges(box)[1];
    t.value = '5'; t.dispatchEvent(new Event('input')); t.dispatchEvent(new Event('change'));
    expect(window.vexGuestEvalFrames).toHaveBeenCalled();
    expect(localStorage.getItem(E.KEY)).toBe(null);
    expect(box.textContent).toContain('This tab is private, so this is not kept.');
  });

  it('reports what could not be shaped a moment after a change', async () => {
    vi.useFakeTimers();
    const a = webview('https://example.com/a'); window.__wvs = [a];
    window.vexGuestEvalFrames = vi.fn(async (wv, code) => ({ results: code.includes('report') ? [{ ok: true, value: { players: 2, shaped: 1, why: { cors: 1 } } }] : [] }));
    const box = document.createElement('div'); document.body.appendChild(box);
    E.draw(box, { url: a.url, wv: a, persist: true });
    const bass = ranges(box)[0];
    bass.value = '3'; bass.dispatchEvent(new Event('input')); bass.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(1600);
    expect(box.querySelector('.mastervol-eqstatus').textContent).toContain('1 player plays from another site that does not allow its sound to be processed');
  });
});

describe('applied to pages as they open', () => {
  const mvSrc = () => require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/master-volume.js'), 'utf8');
  it('pages open with the kept settings only for sites that have some', async () => {
    const { MasterVolume } = require('../../src/renderer/js/master-volume.js');
    window.vexGuestEvalFrames = vi.fn(async () => ({ results: [{ ok: true, value: null }] }));
    window.vexGuestUrl = (wv) => wv.url;
    window.VexSiteEq = E;
    // nothing kept: no script at all
    MasterVolume.applyEq({ url: 'https://example.com/' });
    expect(window.vexGuestEvalFrames).not.toHaveBeenCalled();
    E.save('https://example.com/', { bass: 5 });
    MasterVolume.applyEq({ url: 'https://other.org/' });
    expect(window.vexGuestEvalFrames).not.toHaveBeenCalled();
    MasterVolume.applyEq({ url: 'https://example.com/' });
    await Promise.resolve(); await Promise.resolve();
    expect(window.vexGuestEvalFrames).toHaveBeenCalledTimes(1);
    expect(window.vexGuestEvalFrames.mock.calls[0][1]).toContain('"bass":5');
    delete window.VexSiteEq;
  });
  it('is wired into tabs, panels, late frames and the volume box', () => {
    const rd = (f) => require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/' + f), 'utf8');
    expect(rd('webview.js')).toContain('MasterVolume.applyEq(webview)');
    expect(rd('sidebar.js')).toContain('MasterVolume.applyEq(wv)');
    expect(mvSrc()).toContain("VexLazy.ensure('js/site-eq.js')");
    expect(mvSrc()).toContain('mastervol-eq');
    expect(rd('lazy-boot.js')).toContain('js/site-eq.js');
  });
});
