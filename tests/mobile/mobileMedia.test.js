// @vitest-environment jsdom
//
// The video bar. Everything it does happens through one script injected into the
// page, and the thing worth pinning down is which video that script picks: the
// probe and the controls have to agree, or the bar shows one clip's state and
// pauses another.
import { describe, it, expect, beforeEach, vi } from 'vitest';

window.VexStore = { get: (key, fallback) => fallback, set: async () => {} };
window.VexBridge = {
  evaluate: vi.fn(async (id, code) => ({ result: runInPage(code) })),
  enterPictureInPicture: vi.fn(async () => ({ entered: true })),
  setBackgroundAudio: vi.fn(async () => {}),
  setKeepAwake: vi.fn(async () => {})
};

const { VexMedia } = require('../../mobile/www/js/media.js');

// A stand-in page: a list of videos the injected script walks with
// document.querySelectorAll, which jsdom gives us for real.
function page(videos) {
  document.body.innerHTML = '';
  for (const spec of videos) {
    const node = document.createElement('video');
    Object.defineProperty(node, 'readyState', { value: spec.ready === false ? 0 : 3 });
    Object.defineProperty(node, 'clientWidth', { value: spec.width || 100 });
    Object.defineProperty(node, 'clientHeight', { value: spec.height || 60 });
    // jsdom's paused and duration are getters, so they are redefined rather
    // than assigned; play() and pause() then move the same flag the page would.
    let paused = spec.paused !== false;
    Object.defineProperty(node, 'paused', { get: () => paused, configurable: true });
    Object.defineProperty(node, 'duration', { get: () => spec.duration || 0, configurable: true });
    Object.defineProperty(node, 'videoWidth', { value: spec.width || 100 });
    Object.defineProperty(node, 'videoHeight', { value: spec.height || 60 });
    node.muted = !!spec.muted;
    node.currentTime = spec.at || 0;
    node.dataset.name = spec.name;
    node.play = () => { paused = false; };
    node.pause = () => { paused = true; };
    document.body.appendChild(node);
  }
}

// eslint-disable-next-line no-eval
function runInPage(code) { return eval(code); }

beforeEach(() => { document.body.innerHTML = ''; window.VexBridge.evaluate.mockClear(); });

describe('which video the bar is about', () => {
  it('nothing, on a page with no video', async () => {
    page([]);
    expect(await VexMedia.state('t1')).toEqual({ playing: false });
  });

  it('the one that is playing, even when a bigger one is paused', async () => {
    // This was the bug: the width comparison could replace a playing video with
    // a wider paused one, so the bar said nothing was playing while something was.
    page([
      { name: 'playing', paused: false, width: 200 },
      { name: 'huge-but-paused', paused: true, width: 900 }
    ]);
    const state = await VexMedia.state('t1');
    expect(state.playing).toBe(true);
    expect(state.width).toBe(200);
  });

  it('the biggest, when none of them is playing', async () => {
    page([{ name: 'small', width: 120 }, { name: 'big', width: 600 }]);
    const state = await VexMedia.state('t1');
    expect(state.playing).toBe(false);
    expect(state.width).toBe(600);
  });

  it('never one that has not loaded enough to say anything', async () => {
    page([{ name: 'cold', ready: false, paused: false, width: 900 }, { name: 'warm', width: 100 }]);
    const state = await VexMedia.state('t1');
    expect(state.width).toBe(100);
  });

  it('and the controls act on that same one', async () => {
    page([
      { name: 'playing', paused: false, width: 200 },
      { name: 'huge-but-paused', paused: true, width: 900 }
    ]);
    await VexMedia.pause('t1');
    const nodes = [...document.querySelectorAll('video')];
    expect(nodes[0].paused).toBe(true);        // the one that was playing
    expect(nodes[1].paused).toBe(true);        // untouched, already paused

    await VexMedia.play('t1');
    // Now neither is playing, so the biggest wins — and that is the one that
    // was asked to play.
    expect(nodes[1].paused).toBe(false);
  });
});

describe('what it reports', () => {
  it('the time, the size and the mute, rounded to whole seconds', async () => {
    page([{ name: 'one', paused: false, width: 1280, height: 720, at: 12.6, duration: 95.4, muted: true }]);
    expect(await VexMedia.state('t1')).toEqual({
      playing: true, width: 1280, height: 720, duration: 95, current: 13, muted: true
    });
  });

  it('nothing at all when the page cannot be reached', async () => {
    window.VexBridge.evaluate.mockRejectedValueOnce(new Error('no tab'));
    expect(await VexMedia.state('t1')).toEqual({ playing: false });
  });
});

describe('the floating window', () => {
  it('refuses when nothing is playing, and is sized to the video when it is', async () => {
    page([{ name: 'one', paused: true, width: 640, height: 360 }]);
    await expect(VexMedia.popOut('t1')).rejects.toThrow('Nothing is playing');

    page([{ name: 'one', paused: false, width: 640, height: 360 }]);
    await VexMedia.popOut('t1');
    expect(window.VexBridge.enterPictureInPicture).toHaveBeenCalledWith(640, 360);
  });
});

describe('brightness', () => {
  it('stays inside a range that is still a picture', async () => {
    page([{ name: 'one', paused: false }]);
    await VexMedia.brightness('t1', 99);
    expect(document.querySelector('video').style.filter).toBe('brightness(2.5)');
    await VexMedia.brightness('t1', 0);
    expect(document.querySelector('video').style.filter).toBe('brightness(1)');
  });
});
