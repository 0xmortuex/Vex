// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://www.youtube.com/watch?v=abc" }
// T2-003 (Wave 6): captions on a player that draws its own (YouTube's public player API, nothing clicked), and the
// loudness level measured where Night mode leaves the sound, before the Master Volume gain.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { SitePlayback: S } = require('../../src/renderer/js/site-volume.js');

beforeEach(() => {
  localStorage.clear();
  delete globalThis.MasterVolume;
  delete globalThis.VexTabPolicy;
  delete window.__vexPlay;
  delete window.__vexAudio;
  delete window.__vexNight;
  document.body.innerHTML = '';
});
afterEach(() => { document.body.innerHTML = ''; delete window.AudioContext; delete window.__vexNight; vi.useRealTimers(); });

function video(props = {}) {
  const v = document.createElement('video');
  let rate = 1;
  Object.defineProperty(v, 'playbackRate', { get: () => rate, set: (x) => { rate = x; } });
  Object.defineProperty(v, 'duration', { get: () => props.duration ?? 600 });
  Object.defineProperty(v, 'readyState', { get: () => 4 });
  Object.defineProperty(v, 'currentSrc', { get: () => location.origin + '/v.mp4' });
  Object.defineProperty(v, 'paused', { get: () => false });
  Object.defineProperty(v, 'textTracks', { get: () => Object.assign([], { addEventListener() {} }) });
  document.body.appendChild(v);
  return v;
}

function ytPlayer(on = false, withApi = true) {
  const p = document.createElement('div');
  p.id = 'movie_player';
  if (withApi) {
    p.state = { on, toggled: 0 };
    p.isSubtitlesOn = () => p.state.on;
    p.toggleSubtitlesOn = () => { p.state.toggled++; p.state.on = !p.state.on; };
  }
  document.body.appendChild(p);
  return p;
}

describe('captions on a player that draws its own', () => {
  it('names the player it reaches', () => {
    expect(S.CAPTION_PLAYERS).toEqual(['YouTube']);
  });

  it('turns them on through the player API when the site is kept with captions, once per video', () => {
    const p = ytPlayer(false);
    video();
    (0, eval)(S.script({ rate: null, captions: true, level: false, resumeAt: null }));
    expect(p.state.toggled).toBe(1);
    expect(p.state.on).toBe(true);
    (0, eval)(S.script({ rate: null, captions: true, level: false, resumeAt: null }));
    expect(p.state.toggled).toBe(1);                                   // the same video: not touched again
    window.history.pushState({}, '', '/watch?v=next');
    (0, eval)(S.script({ rate: null, captions: true, level: false, resumeAt: null }));
    expect(p.state.toggled).toBe(1);                                   // already on for the next video: left on
    p.state.on = false;
    window.history.pushState({}, '', '/watch?v=third');
    (0, eval)(S.script({ rate: null, captions: true, level: false, resumeAt: null }));
    expect(p.state.on).toBe(true);
  });

  it('does nothing when captions are not kept, and clicks nothing', () => {
    const p = ytPlayer(false);
    const click = vi.fn();
    p.addEventListener('click', click);
    document.body.insertAdjacentHTML('beforeend', '<button class="ytp-subtitles-button" aria-pressed="false"></button>');
    document.querySelector('.ytp-subtitles-button').addEventListener('click', click);
    video();
    (0, eval)(S.script({ rate: null, captions: false, level: false, resumeAt: null }));
    expect(p.state.toggled).toBe(0);
    (0, eval)(S.script({ rate: null, captions: true, level: false, resumeAt: null }));
    expect(click).not.toHaveBeenCalled();
  });

  it('a page without the API is left alone', () => {
    ytPlayer(false, false);
    video();
    expect(() => (0, eval)(S.script({ rate: null, captions: true, level: false, resumeAt: null }))).not.toThrow();
  });

  it('the sampler reports YouTube captions as on or off', () => {
    const p = ytPlayer(true);
    video();
    expect(((0, eval)(S.readScript())).captions).toBe(true);
    p.state.on = false;
    expect(((0, eval)(S.readScript())).captions).toBe(false);
  });
});

describe('the level and Night mode', () => {
  function audio() {
    const log = [];
    const node = (name) => ({ name, connect: vi.fn((to) => log.push([name, 'connect', to && to.name])), disconnect: vi.fn((to) => log.push([name, 'disconnect', to && to.name])), gain: { setTargetAtTime: vi.fn(), value: 1 } });
    window.AudioContext = function () {
      this.state = 'running'; this.destination = { name: 'destination' }; this.currentTime = 0; this.resume = async () => {};
      let g = 0;
      this.createMediaElementSource = () => node('source');
      this.createGain = () => node('gain' + (++g));
      this.createAnalyser = () => ({ ...node('analyser'), fftSize: 2048, getFloatTimeDomainData: (b) => b.fill(0.05) });
    };
    return log;
  }

  it('measures at the source with Night mode off, and after its make-up gain when it is on', () => {
    vi.useFakeTimers();
    const log = audio();
    const v = video();
    (0, eval)(S.script({ rate: null, captions: false, level: true, resumeAt: null }));
    expect(log).toContainEqual(['source', 'connect', 'analyser']);
    const makeup = { name: 'makeup', connect: vi.fn(), disconnect: vi.fn() };
    window.__vexNight = { on: true, nodes: new WeakMap([[v, { through: true, makeup }]]) };
    vi.advanceTimersByTime(600);
    expect(makeup.connect).toHaveBeenCalledTimes(1);
    expect(makeup.connect.mock.calls[0][0].name).toBe('analyser');
    expect(log).toContainEqual(['source', 'disconnect', 'analyser']);
    window.__vexNight = { on: true, nodes: new WeakMap([[v, { through: false, makeup }]]) };
    vi.advanceTimersByTime(600);
    expect(makeup.disconnect).toHaveBeenCalledTimes(1);                // Night mode routed around: back to the source
  });

  it('the leveller gain stays after the Master Volume gain, so the slider scales the leveled sound', () => {
    audio();
    video();
    const src = S.script({ rate: null, captions: false, level: true, resumeAt: null });
    expect(src).toMatch(/n\.out\.connect\(lg\); lg\.connect\(A\.ctx\.destination\)/);
    expect(src).toMatch(/Measured where Night mode leaves the sound/);
  });
});
