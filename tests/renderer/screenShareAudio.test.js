// @vitest-environment jsdom
//
// Discord: pick a screen, the picker closes, nothing is shared.
//
// Discord always asks getDisplayMedia for audio, and Chromium refuses a pick
// that leaves out audio the page asked for ("AbortError: Invalid capture
// constraints"). Vex's picker has a "Share audio" box, and remembers it — so
// after unticking it once, every share died the moment a screen was picked.
// Reproduced on discord.com in the panel. Now the pick always carries the audio
// that was asked for, and when the user does not want it, the guest shim drops
// the audio track BEFORE the page gets the stream.

import { describe, it, expect, vi, beforeEach } from 'vitest';
const fs = require('fs');
const path = require('path');

const preload = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
const picker = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/screen-picker.js'), 'utf8');

// The main-world shim, exactly as it is injected into pages.
function shimSource() {
  const start = preload.indexOf('if(!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return;');
  const open = preload.lastIndexOf('const shimSrc = `', start);
  const close = preload.indexOf('`;', start);
  expect(open).toBeGreaterThan(-1);
  return preload.slice(open + 'const shimSrc = `'.length, close);
}

function track(kind) { return { kind, stop: vi.fn(), applyConstraints: vi.fn(async () => {}), addEventListener() {} }; }
function stream(tracks) {
  const list = tracks.slice();
  return { getTracks: () => list.slice(), getAudioTracks: () => list.filter(t => t.kind === 'audio'), getVideoTracks: () => list.filter(t => t.kind === 'video'), removeTrack: (t) => { list.splice(list.indexOf(t), 1); } };
}

let given;
function install(quality) {
  given = stream([track('video'), track('audio')]);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia: vi.fn(async () => given) } });
  window.__vexShareBridge = { getQuality: typeof quality === 'function' ? quality : vi.fn(async () => quality), capture: vi.fn() };
  (0, eval)(shimSource());
}

beforeEach(() => { delete window.__vexShareBridge; });

describe('the guest getDisplayMedia shim', () => {
  it('"Share audio" unticked: the audio track is stopped and gone before the page sees the stream', async () => {
    install({ width: 0, height: 0, fps: 0, cursor: '', dropAudio: true });
    const audio = given.getAudioTracks()[0];
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    expect(s.getAudioTracks()).toEqual([]);
    expect(s.getVideoTracks()).toHaveLength(1);
    expect(audio.stop).toHaveBeenCalled();
  });

  it('ticked: audio stays, and the quality choice is applied to the video track', async () => {
    install({ width: 1280, height: 720, fps: 30, cursor: 'always', dropAudio: false });
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    expect(s.getAudioTracks()).toHaveLength(1);
    expect(s.getVideoTracks()[0].applyConstraints).toHaveBeenCalledWith({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, cursor: 'always' });
  });

  it('no recorded choice, or a bridge that fails: the page still gets its stream', async () => {
    install(null);
    expect((await navigator.mediaDevices.getDisplayMedia({ video: true })).getTracks()).toHaveLength(2);
    install(async () => { throw new Error('ipc gone'); });
    expect((await navigator.mediaDevices.getDisplayMedia({ video: true })).getTracks()).toHaveLength(2);
  });
});

describe('the pick main hands to Chromium', () => {
  it('carries audio exactly when the page asked for it — never by the checkbox', () => {
    expect(main).toContain("audioRequested: !!request.audioRequested");
    expect(main).toContain("p.callback(p.audioRequested ? { video: src, audio: 'loopback' } : { video: src })");
    expect(main).toContain("dropAudio: p.audioRequested && audio === false");
    expect(main).not.toContain("audio: (audio === false ? undefined : 'loopback')");     // the refusal, as it was
  });

  it('a pick main refuses is said out loud, not thrown away', () => {
    expect(picker).not.toContain("try { window.vex.chooseScreenSource(payload.id, sourceId, sourceId ? readOpts() : null); } catch {}");
    expect(picker).toMatch(/r\.ok === false\) window\.showToast\?\.\(r\.error/);
    expect(main).toContain("error: 'That share request has expired — start the share again'");
  });
});
