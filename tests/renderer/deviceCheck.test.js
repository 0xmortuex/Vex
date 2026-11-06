// @vitest-environment jsdom
//
// js/device-check.js: the "Check my devices" card. jsdom has no camera, so the devices here are fakes that count how many tracks are
// live; what matters is that every one of them is stopped by every way out of the card. The real-Chromium half (fake camera and
// microphone flags, real MediaStream tracks) is the throwaway Electron probe in the report.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

const { VexDeviceCheck } = require('../../src/renderer/js/device-check.js');

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
let tracks; let contexts; let level; let pending; let gum; let latency;

function fakeTrack(kind) {
  const t = { kind, readyState: 'live', stop() { this.readyState = 'ended'; }, getSettings: () => ({ deviceId: kind + '-1' }) };
  tracks.push(t);
  return t;
}
function fakeStream(kind) {
  const list = [fakeTrack(kind)];
  return { getTracks: () => list, getVideoTracks: () => (kind === 'video' ? list : []), getAudioTracks: () => (kind === 'audio' ? list : []) };
}
class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; contexts.push(this); }
  createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData: (b) => b.fill(level) }; }
  createMediaStreamSource() { return { connect() {} }; }
  createOscillator() { const o = { type: '', frequency: { value: 0 }, connect(n) { return n; }, start() { this.started = true; }, stop() {} }; this.osc = o; return o; }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect(n) { return n; } }; }
  async setSinkId(id) { this.sink = id; }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

function install({ video = 'ok', audio = 'ok' } = {}) {
  tracks = []; contexts = []; level = 0; pending = null;
  latency = { ok: true, results: [{ baseline: true, ms: 40 }, { baseline: true, ms: 55 }, { baseline: false, ms: 300 }] };
  gum = vi.fn((c) => {
    const kind = c.video ? 'video' : 'audio';
    const mode = kind === 'video' ? video : audio;
    if (mode === 'hang') return new Promise((resolve) => { pending = () => resolve(fakeStream(kind)); });
    if (mode !== 'ok') return Promise.reject(Object.assign(new Error(mode), { name: mode }));
    return Promise.resolve(fakeStream(kind));
  });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: gum,
    enumerateDevices: async () => [
      { kind: 'videoinput', deviceId: 'video-1', label: 'Fake Camera' }, { kind: 'audioinput', deviceId: 'audio-1', label: 'Fake Mic' },
      { kind: 'audiooutput', deviceId: 'out-1', label: 'Fake Speakers' }, { kind: 'audiooutput', deviceId: 'default', label: 'Default' },
    ],
  } });
  globalThis.AudioContext = FakeAudioContext;
  window.vex = { deviceCheckCamera: vi.fn(async (on) => on), netLatency: vi.fn(async () => latency) };
  window.showToast = vi.fn();
  delete globalThis.AudioOutput;
}
const live = () => tracks.filter((t) => t.readyState === 'live').length;
// jsdom never decodes a picture: say the camera's first frame arrived.
const frame = () => { const v = document.querySelector('.vex-devcheck-overlay video'); if (v) v.dispatchEvent(new Event('loadeddata')); };
async function openCard() {
  const p = VexDeviceCheck.open();
  await flush(); frame(); await flush();
  return p;
}
const card = () => document.querySelector('.vex-devcheck-overlay');
const part = (id) => card().querySelector('[data-part="' + id + '"]');

beforeEach(() => { document.body.innerHTML = ''; vi.useFakeTimers(); install(); });
afterEach(() => { VexDeviceCheck.close(); vi.useRealTimers(); });

describe('plain explanations', () => {
  it('says what to do for each way a device fails, for the camera and the microphone', () => {
    for (const what of ['camera', 'microphone']) {
      expect(VexDeviceCheck.explain({ name: 'NotAllowedError' }, what)).toMatch(/Windows Settings > Privacy & security/);
      expect(VexDeviceCheck.explain({ name: 'NotAllowedError' }, what)).toContain(what);
      expect(VexDeviceCheck.explain({ name: 'NotFoundError' }, what)).toMatch(/No .* was found/);
      expect(VexDeviceCheck.explain({ name: 'OverconstrainedError' }, what)).toMatch(/No .* was found/);
      expect(VexDeviceCheck.explain({ name: 'NotReadableError' }, what)).toMatch(/busy or not answering/);
      expect(VexDeviceCheck.explain({ name: 'AbortError' }, what)).toMatch(/Another app/);
      expect(VexDeviceCheck.explain({ name: 'TypeError', message: 'odd' }, what)).toMatch(/could not be opened: odd/);
    }
    expect(VexDeviceCheck.explain(null, 'camera')).toMatch(/unknown error/);
  });
});

describe('levels and verdicts', () => {
  it('levelOf is the RMS of the samples', () => {
    expect(VexDeviceCheck.levelOf(new Float32Array(100))).toBe(0);
    expect(VexDeviceCheck.levelOf(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5, 5);
    expect(VexDeviceCheck.levelOf(new Float32Array(100).fill(-0.5))).toBeCloseTo(0.5, 5);
    expect(VexDeviceCheck.levelOf([])).toBe(0);
    expect(VexDeviceCheck.levelOf(null)).toBe(0);
  });
  it('the meter is scaled and clamped to 0..1', () => {
    expect(VexDeviceCheck.meterFill(0)).toBe(0);
    expect(VexDeviceCheck.meterFill(0.05)).toBeCloseTo(0.4, 5);
    expect(VexDeviceCheck.meterFill(0.9)).toBe(1);
    expect(VexDeviceCheck.meterFill(-1)).toBe(0);
  });
  it('the microphone is pending until it hears something, then good; silent for six seconds is a problem', () => {
    expect(VexDeviceCheck.micState(false, 0).state).toBe('pending');
    expect(VexDeviceCheck.micState(false, 0).text).toMatch(/Speak now/);
    expect(VexDeviceCheck.micState(false, 5999).state).toBe('pending');
    expect(VexDeviceCheck.micState(false, 6000).state).toBe('problem');
    expect(VexDeviceCheck.micState(true, 100).state).toBe('ok');
    expect(VexDeviceCheck.micState(true, 99999).state).toBe('ok');
  });
  it('the connection: fast, fine, slow, no answer', () => {
    expect(VexDeviceCheck.pingState(40).state).toBe('ok');
    expect(VexDeviceCheck.pingState(149).text).toMatch(/fast/);
    expect(VexDeviceCheck.pingState(200).state).toBe('ok');
    expect(VexDeviceCheck.pingState(200).text).toMatch(/a little slow/);
    expect(VexDeviceCheck.pingState(300).state).toBe('problem');
    expect(VexDeviceCheck.pingState(null).state).toBe('problem');
    expect(VexDeviceCheck.pingState(NaN).state).toBe('problem');
  });
  it('the summary: any problem wins, then anything still pending, else all good', () => {
    const ok = { state: 'ok' };
    expect(VexDeviceCheck.summary({ camera: ok, microphone: ok, speaker: ok, connection: ok })).toMatchObject({ state: 'ok' });
    expect(VexDeviceCheck.summary({ camera: ok, microphone: { state: 'pending' }, speaker: ok, connection: ok })).toMatchObject({ state: 'pending' });
    const bad = VexDeviceCheck.summary({ camera: { state: 'problem' }, microphone: { state: 'pending' }, speaker: ok, connection: { state: 'problem' } });
    expect(bad.state).toBe('problem');
    expect(bad.text).toMatch(/^2 needs a look: camera, connection/);
    expect(VexDeviceCheck.summary({ camera: { state: 'off' }, microphone: ok })).toMatchObject({ state: 'ok' });
  });
});

describe('the set of open devices', () => {
  it('closeAll stops every live track and reports how many', () => {
    const set = VexDeviceCheck.streamSet();
    const a = fakeStream('video'); const b = fakeStream('audio');
    set.addStream(a); set.addStream(b);
    expect(set.liveTracks()).toBe(2);
    expect(set.closeAll().tracks).toBe(2);
    expect(live()).toBe(0);
    expect(set.liveTracks()).toBe(0);
  });
  it('a stream or audio context that arrives after the close is stopped at once', () => {
    const set = VexDeviceCheck.streamSet();
    set.closeAll();
    const s = fakeStream('video');
    expect(set.addStream(s)).toBe(false);
    expect(s.getTracks()[0].readyState).toBe('ended');
    const ctx = new FakeAudioContext();
    expect(set.addContext(ctx)).toBe(false);
    expect(ctx.state).toBe('closed');
  });
});

describe('the card', () => {
  it('opens the camera permission for its window, then the camera and the microphone, and shows a verdict per part', async () => {
    await openCard();
    expect(window.vex.deviceCheckCamera).toHaveBeenCalledWith(true);
    expect(gum).toHaveBeenCalledWith({ video: true });
    expect(gum.mock.calls.some(([c]) => c.audio)).toBe(true);
    expect(live()).toBe(2);
    expect(part('camera').querySelector('[data-badge]').textContent).toBe('Looks good');
    expect(part('connection').querySelector('[data-badge]').textContent).toBe('Looks good');   // baseline 40 ms
    expect(part('microphone').querySelector('[data-text]').textContent).toMatch(/Speak now/);
  });
  it('asks for the camera and the microphone separately (each is its own permission)', async () => {
    await openCard();
    for (const [c] of gum.mock.calls) expect(Boolean(c.video) !== Boolean(c.audio)).toBe(true);
  });
  it('close() stops every stream, closes the audio contexts, gives the camera permission back, and removes the card', async () => {
    await openCard();
    expect(live()).toBe(2);
    const stopped = VexDeviceCheck.close();
    expect(stopped).toBe(2);
    expect(live()).toBe(0);
    expect(contexts.every((c) => c.state === 'closed')).toBe(true);
    expect(window.vex.deviceCheckCamera).toHaveBeenLastCalledWith(false);
    expect(card()).toBeNull();
    expect(VexDeviceCheck.isOpen()).toBe(false);
    expect(VexDeviceCheck.close()).toBe(0);     // twice is harmless
  });
  it('Escape closes it and releases everything', async () => {
    await openCard();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card()).toBeNull();
    expect(live()).toBe(0);
  });
  it('switching tab releases everything', async () => {
    await openCard();
    window.dispatchEvent(new CustomEvent('vex:tab-activated'));
    expect(card()).toBeNull();
    expect(live()).toBe(0);
  });
  it('hiding the window releases everything', async () => {
    await openCard();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    expect(card()).toBeNull();
    expect(live()).toBe(0);
  });
  it('the Close button and a click outside release everything', async () => {
    await openCard();
    card().querySelector('[data-close]').click();
    expect(live()).toBe(0);
    await openCard();
    card().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(live()).toBe(0);
    expect(card()).toBeNull();
  });
  it('a device that finishes opening AFTER the card was closed is stopped the moment it arrives', async () => {
    install({ video: 'hang', audio: 'hang' });
    const p = VexDeviceCheck.open();
    await flush();
    VexDeviceCheck.close();
    pending();                                  // the (last) pending one arrives now
    await flush();
    expect(live()).toBe(0);
    expect(tracks.length).toBe(1);              // it did arrive, and it was stopped
    void p;                                     // the other device never answers: open() stays waiting, which is fine
  });
  it('both pending devices arriving after the close are stopped', async () => {
    const resolvers = [];
    gum.mockImplementation((c) => new Promise((resolve) => resolvers.push(() => resolve(fakeStream(c.video ? 'video' : 'audio')))));
    const p = VexDeviceCheck.open();
    await flush();
    VexDeviceCheck.close();
    resolvers.forEach((r) => r());
    await flush();
    expect(tracks.length).toBe(resolvers.length);
    expect(live()).toBe(0);
    void p;
  });
  it('opening it twice does not leave the first one holding devices', async () => {
    await openCard();
    await openCard();
    expect(live()).toBe(2);
    expect(document.querySelectorAll('.vex-devcheck-overlay').length).toBe(1);
  });
  it('"Check again" lets go of the old streams before opening new ones', async () => {
    await openCard();
    card().querySelector('[data-again]').click();
    await flush(); frame(); await flush();
    expect(live()).toBe(2);
    expect(tracks.length).toBe(4);
  });
  it('changing the camera in the list swaps the stream and keeps only one camera open', async () => {
    await openCard();
    const sel = part('camera').querySelector('select');
    sel.dispatchEvent(new Event('change'));
    await flush(); frame(); await flush();
    expect(tracks.filter((t) => t.kind === 'video' && t.readyState === 'live').length).toBe(1);
    expect(gum.mock.calls.some(([c]) => c.video && c.video.deviceId)).toBe(true);
  });
  it('nothing is recorded or stored: no MediaRecorder, no storage, no fetch', async () => {
    const src = fs.readFileSync('src/renderer/js/device-check.js', 'utf8');
    expect(src).not.toMatch(/MediaRecorder|localStorage|sessionStorage|indexedDB|fetch\(|sendBeacon|XMLHttpRequest|WebSocket/);
    await openCard();
    expect(localStorage.length).toBe(0);
  });
});

describe('when a device does not work', () => {
  it('permission denied: the camera says how to fix it in Windows, the microphone still works', async () => {
    install({ video: 'NotAllowedError' });
    await openCard();
    expect(part('camera').querySelector('[data-badge]').textContent).toBe('Needs a look');
    expect(part('camera').querySelector('[data-text]').textContent).toMatch(/Privacy & security > Camera/);
    expect(live()).toBe(1);
    expect(card().querySelector('[data-summary]').dataset.state).toBe('problem');
  });
  it('no device', async () => {
    install({ audio: 'NotFoundError' });
    await openCard();
    expect(part('microphone').querySelector('[data-text]').textContent).toMatch(/No microphone was found/);
  });
  it('a device another app is using', async () => {
    install({ video: 'NotReadableError' });
    await openCard();
    expect(part('camera').querySelector('[data-text]').textContent).toMatch(/busy or not answering/);
  });
  it('a camera that opens but sends no picture', async () => {
    const p = VexDeviceCheck.open();
    await flush();
    await vi.advanceTimersByTimeAsync(VexDeviceCheck.PICTURE_MS + 50);
    await flush();
    expect(part('camera').querySelector('[data-text]').textContent).toMatch(/sent no picture/);
    await p;
  });
  it('the connection with no answer is a problem, and a failing measurement says why', async () => {
    latency = { ok: true, results: [{ baseline: true, ms: null }] };
    await openCard();
    expect(part('connection').querySelector('[data-text]').textContent).toMatch(/No answer/);
    VexDeviceCheck.close();
    window.vex.netLatency = vi.fn(async () => { throw new Error('offline'); });
    await openCard();
    expect(part('connection').querySelector('[data-text]').textContent).toMatch(/could not be measured: offline/);
  });
  it('a build without the camera bridge says so instead of failing silently', async () => {
    delete window.vex.deviceCheckCamera;
    await expect(VexDeviceCheck.open()).rejects.toThrow(/cannot check the camera/);
    expect(card()).toBeNull();
  });
});

describe('the microphone meter', () => {
  it('shows the level and turns good when it hears you', async () => {
    let raf = [];
    globalThis.requestAnimationFrame = (fn) => { raf.push(fn); return raf.length; };
    globalThis.cancelAnimationFrame = () => { raf = []; };
    await openCard();
    const run = () => { const f = raf.splice(0); f.forEach((fn) => fn()); };
    level = 0; run();
    expect(part('microphone').querySelector('[role="meter"]').getAttribute('aria-valuenow')).toBe('0');
    level = 0.05; run();
    expect(part('microphone').querySelector('[role="meter"]').getAttribute('aria-valuenow')).toBe('40');
    expect(part('microphone').querySelector('[data-badge]').textContent).toBe('Looks good');
  });
  it('says nothing was heard after six silent seconds', async () => {
    let raf = [];
    globalThis.requestAnimationFrame = (fn) => { raf.push(fn); return raf.length; };
    globalThis.cancelAnimationFrame = () => { raf = []; };
    await openCard();
    vi.setSystemTime(Date.now() + 6500);
    raf.splice(0).forEach((fn) => fn());
    expect(part('microphone').querySelector('[data-badge]').textContent).toBe('Needs a look');
    expect(part('microphone').querySelector('[data-text]').textContent).toMatch(/Nothing was heard/);
  });
});

describe('the speaker test', () => {
  it('plays a soft tone through the chosen output, then asks, and "I heard it" makes it good', async () => {
    await openCard();
    const sel = part('speaker').querySelector('select');
    expect([...sel.options].map((o) => o.value)).toEqual(['', 'out-1']);       // system default + the named output, not the "default" alias
    sel.value = 'out-1';
    const buttons = [...part('speaker').querySelectorAll('button')];
    const play = buttons.find((b) => b.textContent === 'Play a test tone');
    const heard = buttons.find((b) => b.textContent === 'I heard it');
    expect(heard.hidden).toBe(true);
    play.click();
    await flush();
    const ctx = contexts[contexts.length - 1];
    expect(ctx.sink).toBe('out-1');
    expect(ctx.osc.started).toBe(true);
    expect(ctx.osc.frequency.value).toBe(VexDeviceCheck.TONE_HZ);
    expect(VexDeviceCheck.TONE_GAIN).toBeLessThanOrEqual(0.2);
    await vi.advanceTimersByTimeAsync(VexDeviceCheck.TONE_MS + 200);
    expect(heard.hidden).toBe(false);
    expect(ctx.state).toBe('closed');
    heard.click();
    expect(part('speaker').querySelector('[data-badge]').textContent).toBe('Looks good');
  });
  it('"I heard nothing" is a problem with advice', async () => {
    await openCard();
    const play = [...part('speaker').querySelectorAll('button')].find((b) => b.textContent === 'Play a test tone');
    play.click(); await flush();
    await vi.advanceTimersByTimeAsync(VexDeviceCheck.TONE_MS + 200);
    [...part('speaker').querySelectorAll('button')].find((b) => b.textContent === 'I heard nothing').click();
    expect(part('speaker').querySelector('[data-badge]').textContent).toBe('Needs a look');
    expect(part('speaker').querySelector('[data-text]').textContent).toMatch(/Pick another output/);
  });
  it('closing the card during the tone closes its audio context too', async () => {
    await openCard();
    [...part('speaker').querySelectorAll('button')].find((b) => b.textContent === 'Play a test tone').click();
    await flush();
    VexDeviceCheck.close();
    expect(contexts.every((c) => c.state === 'closed')).toBe(true);
  });
  it('everything good adds up to "All good"', async () => {
    let raf = [];
    globalThis.requestAnimationFrame = (fn) => { raf.push(fn); return raf.length; };
    globalThis.cancelAnimationFrame = () => { raf = []; };
    await openCard();
    level = 0.1; raf.splice(0).forEach((fn) => fn());
    const play = [...part('speaker').querySelectorAll('button')].find((b) => b.textContent === 'Play a test tone');
    play.click(); await flush();
    await vi.advanceTimersByTimeAsync(VexDeviceCheck.TONE_MS + 200);
    [...part('speaker').querySelectorAll('button')].find((b) => b.textContent === 'I heard it').click();
    expect(card().querySelector('[data-summary]').textContent).toMatch(/^All good/);
    expect(card().querySelector('[data-summary]').dataset.state).toBe('ok');
  });
});

describe('the wiring', () => {
  const read = (f) => fs.readFileSync(f, 'utf8');
  it('is a functional-audio module, loaded on demand, in Ctrl+K, and offered when Meeting mode starts', () => {
    expect(read('src/renderer/js/vex-playfulness.js')).toMatch(/FUNCTIONAL_AUDIO: \[[^\]]*'device-check\.js'/);
    expect(read('src/renderer/js/lazy-boot.js')).toMatch(/js\/device-check\.js/);
    expect(read('src/renderer/index.html')).not.toMatch(/device-check\.js/);
    expect(read('src/renderer/js/command.js')).toMatch(/id: 'device-check', label: 'Check My Devices'/);
    expect(read('src/renderer/js/meeting-mode.js')).toMatch(/label: 'Check my devices'/);
  });
  it('the camera is only ever given to Vex’s own window while the card has asked for it', () => {
    const p = read('src/main/permissions.js');
    expect(p).toMatch(/asked\[0\] === 'camera' && uiCameraOpen\(webContents\)/);
    expect(p).toMatch(/isVexUi\(_wc\) && uiCameraOpen\(_wc\)/);
    expect(read('src/main.js')).toMatch(/ipcMain\.handle\('devicecheck:camera', \(event, on\) => setUiCamera\(event\.sender, on\)\)/);
    expect(read('src/main/ipc-schemas.js')).toMatch(/define\('devicecheck:camera', \[boolean\]\)/);
  });
});
