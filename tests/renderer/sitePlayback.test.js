// @vitest-environment jsdom
//
// T2-003: speed, captions, the place in a long video and the loudness level, kept per site
// (js/site-volume.js SitePlayback). The page script is run here against stub media elements
// and a stub Web Audio, because the rules that matter are in it: a protected (DRM) player and
// sound from another site are never tapped, and a suspended audio context is never tapped.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { SitePlayback: S } = require('../../src/renderer/js/site-volume.js');

beforeEach(() => {
  localStorage.clear();
  delete globalThis.MasterVolume;
  delete globalThis.VexTabPolicy;
  delete window.__vexPlay;
  delete window.__vexAudio;
});

describe('what is kept', () => {
  it('keeps a speed other than 1x and forgets 1x', () => {
    expect(S.record('https://lectures.example/a', { rate: 1.5 })).toBe(true);
    expect(S.want('https://lectures.example/b').rate).toBe(1.5);
    expect(S.record('https://www.lectures.example/c', { rate: 1 })).toBe(true);
    expect(S.want('https://lectures.example/b').rate).toBeNull();
    expect(S.sites()).toEqual({});
  });
  it('keeps captions on and off', () => {
    S.record('https://v.example/x', { captions: true });
    expect(S.want('https://v.example/y').captions).toBe(true);
    S.record('https://v.example/x', { captions: false });
    expect(S.want('https://v.example/y').captions).toBe(false);
  });
  it('keeps the place in a video of five minutes or more, per address, without #fragment or t=', () => {
    const base = { rate: 1, captions: false, d: 3600 };
    expect(S.record('https://v.example/watch?v=1&t=5', { ...base, t: 600, href: 'https://v.example/watch?v=1&t=5#c' })).toBe(true);
    expect(S.want('https://v.example/watch?v=1').resumeAt).toBe(600);
    expect(S.want('https://v.example/watch?v=2').resumeAt).toBeNull();
    S.record('https://v.example/short', { d: 120, t: 60, href: 'https://v.example/short' });
    expect(S.places()['v.example/short']).toBeUndefined();
  });
  it('forgets the place at the end, or when it is only the start', () => {
    S.record('https://v.example/a', { d: 3600, t: 900, href: 'https://v.example/a' });
    expect(S.want('https://v.example/a').resumeAt).toBe(900);
    S.record('https://v.example/a', { d: 3600, t: 3590, href: 'https://v.example/a' });
    expect(S.want('https://v.example/a').resumeAt).toBeNull();
    S.record('https://v.example/a', { d: 3600, t: 900, href: 'https://v.example/a' });
    S.record('https://v.example/a', { d: 3600, t: 900, ended: true, href: 'https://v.example/a' });
    expect(S.want('https://v.example/a').resumeAt).toBeNull();
  });
  it('keeps at most 100 places, the newest', () => {
    for (let i = 0; i < 105; i++) S.record('https://v.example/p' + i, { d: 3600, t: 900, href: 'https://v.example/p' + i }, 1000 + i);
    const keys = Object.keys(S.places());
    expect(keys).toHaveLength(100);
    expect(keys).not.toContain('v.example/p0');
    expect(keys).toContain('v.example/p104');
  });
  it('forget removes the site and its places only', () => {
    S.record('https://v.example/a', { rate: 2, d: 3600, t: 900, href: 'https://v.example/a' });
    S.record('https://other.example/a', { rate: 2, d: 3600, t: 900, href: 'https://other.example/a' });
    expect(S.forget('https://v.example/zzz')).toEqual({ site: true, places: 1 });
    expect(S.want('https://v.example/a')).toMatchObject({ rate: null, resumeAt: null });
    expect(S.want('https://other.example/a').rate).toBe(2);
  });
  it('reads a damaged store as an error, not as empty', () => {
    localStorage.setItem('vex.sitePlayback', '{nope');
    expect(() => S.sites()).toThrow(/not readable/);
  });
  it('is off in a private window and when the kept volume switch is off', () => {
    expect(S.enabled()).toBe(true);
    globalThis.MasterVolume = { siteMemoryEnabled: () => false };
    expect(S.enabled()).toBe(false);
    delete globalThis.MasterVolume;
    globalThis.VexTabPolicy = { isPrivateWindow: true };
    expect(S.enabled()).toBe(false);
  });
});

// ---- the script that runs in the page ------------------------------------------------------
function player(props = {}) {
  const v = document.createElement('video');
  let rate = 1, time = 0;
  Object.defineProperty(v, 'playbackRate', { get: () => rate, set: (x) => { rate = x; } });
  Object.defineProperty(v, 'currentTime', { get: () => time, set: (x) => { time = x; } });
  Object.defineProperty(v, 'duration', { get: () => props.duration ?? 3600 });
  Object.defineProperty(v, 'readyState', { get: () => 4 });
  Object.defineProperty(v, 'currentSrc', { get: () => props.src ?? location.origin + '/v.mp4' });
  Object.defineProperty(v, 'paused', { get: () => false });
  if ('mediaKeys' in props) Object.defineProperty(v, 'mediaKeys', { get: () => props.mediaKeys });
  const tracks = props.tracks || [];
  Object.defineProperty(v, 'textTracks', { get: () => Object.assign(tracks, { addEventListener() {} }) });
  document.body.appendChild(v);
  return v;
}

function stubAudio(state = 'running') {
  const made = { sources: 0, gains: 0, analysers: 0 };
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { setTargetAtTime: vi.fn(), value: 1 } });
  window.AudioContext = function () {
    this.state = state;
    this.destination = {};
    this.currentTime = 0;
    this.resume = vi.fn(async () => {});
    this.createMediaElementSource = () => { made.sources++; return node(); };
    this.createGain = () => { made.gains++; return node(); };
    this.createAnalyser = () => { made.analysers++; return { ...node(), fftSize: 2048, getFloatTimeDomainData: (b) => b.fill(0.05) }; };
  };
  return made;
}

describe('the page script', () => {
  afterEach(() => { document.body.innerHTML = ''; delete window.AudioContext; vi.useRealTimers(); });

  it('puts the speed and the place back on a player', () => {
    const v = player();
    (0, eval)(S.script({ rate: 1.5, captions: false, level: false, resumeAt: 900 }));
    expect(v.playbackRate).toBe(1.5);
    expect(v.currentTime).toBe(900);
  });
  it('turns on the first caption track, once', () => {
    const t = { kind: 'captions', mode: 'disabled' };
    player({ tracks: [t, { kind: 'subtitles', mode: 'disabled' }] });
    (0, eval)(S.script({ rate: null, captions: true, level: false, resumeAt: null }));
    expect(t.mode).toBe('showing');
  });
  it('does not jump a video that has already moved on, or a short one', () => {
    const a = player(); a.currentTime = 40;
    const b = player({ duration: 100 });
    (0, eval)(S.script({ rate: null, captions: false, level: false, resumeAt: 900 }));
    expect(a.currentTime).toBe(40);
    expect(b.currentTime).toBe(0);
  });
  it('levels a same-site player when the audio context is running', () => {
    const made = stubAudio('running');
    player();
    (0, eval)(S.script({ rate: null, captions: false, level: true, resumeAt: null }));
    expect(made.sources).toBe(1);
    expect(made.analysers).toBe(1);
  });
  it('never taps a protected player', () => {
    const made = stubAudio('running');
    player({ mediaKeys: {} });
    (0, eval)(S.script({ rate: null, captions: false, level: true, resumeAt: null }));
    expect(made.sources).toBe(0);
  });
  it('never taps sound from another site', () => {
    const made = stubAudio('running');
    player({ src: 'https://cdn.other.example/v.mp4' });
    (0, eval)(S.script({ rate: null, captions: false, level: true, resumeAt: null }));
    expect(made.sources).toBe(0);
  });
  it('never taps a suspended audio context', () => {
    const made = stubAudio('suspended');
    player();
    (0, eval)(S.script({ rate: null, captions: false, level: true, resumeAt: null }));
    expect(made.sources).toBe(0);
  });
  it('reports the player in front for the sampler', () => {
    const v = player(); v.currentTime = 700;
    const r = (0, eval)(S.readScript());
    expect(r).toMatchObject({ rate: 1, t: 700, d: 3600, ended: false });
  });
});
