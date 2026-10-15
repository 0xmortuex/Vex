// @vitest-environment jsdom
//
// Focus scenes (gating, auto-stop, the synthesised graph) and the sticker
// sheet (data model, medal-signal grants, the corkboard).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { VexLiving } = require('../../src/renderer/js/living-core.js');
const { FocusScenes } = require('../../src/renderer/js/focus-scenes.js');
const { StickerSheet } = require('../../src/renderer/js/sticker-sheet.js');

function fakeAudioCtx() {
  const created = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = (type) => {
    const n = { type, connect() {}, start() { this.started = true; }, stop() { this.stopped = true; }, frequency: param(), gain: param(), Q: param() };
    created.push(n);
    return n;
  };
  return {
    sampleRate: 8000, currentTime: 0, state: 'running', destination: {}, created, closed: false,
    createBuffer: (c, len) => ({ length: len, getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => node('src'), createBiquadFilter: () => node('biquad'),
    createGain: () => node('gain'), createOscillator: () => node('osc'),
    close() { this.closed = true; return Promise.resolve(); }
  };
}

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; vi.useFakeTimers(); FocusScenes._reset(); StickerSheet._reset(); });
afterEach(() => { FocusScenes.stop('test', { immediate: true }); vi.useRealTimers(); });

describe('Focus scenes: pure parts', () => {
  it('refuses in Game mode and for an unknown scene', () => {
    expect(FocusScenes.playBlock({ gameActive: false }, 'rain')).toBe('');
    expect(FocusScenes.playBlock({ gameActive: true }, 'rain')).toBe('game-mode');
    expect(FocusScenes.playBlock({}, 'jazz')).toBe('unknown-scene');
  });

  it('plans the auto-stop from the session end, or none when there is no end', () => {
    expect(FocusScenes.planAutoStop(1000, 61000)).toBe(60000);
    expect(FocusScenes.planAutoStop(5000, 1000)).toBe(0);
    expect(FocusScenes.planAutoStop(1000, 0)).toBeNull();
    expect(FocusScenes.planAutoStop(1000, undefined)).toBeNull();
  });

  it('volume maps to a bounded gain', () => {
    expect(FocusScenes.gainFor(0)).toBe(0);
    expect(FocusScenes.gainFor(1)).toBeCloseTo(0.9);
    expect(FocusScenes.gainFor(9)).toBeCloseTo(0.9);
    expect(FocusScenes.gainFor(-2)).toBe(0);
    expect(FocusScenes.gainFor(0.5)).toBeLessThan(0.5);
  });

  it('schedules events inside sane bounds per scene', () => {
    const rand = VexLiving.rng(11);
    for (let i = 0; i < 50; i++) {
      expect(FocusScenes.nextEventMs('rain', rand)).toBeLessThan(200);
      expect(FocusScenes.nextEventMs('cafe', rand)).toBeGreaterThanOrEqual(3000);
    }
    expect(() => FocusScenes.nextEventMs('x', rand)).toThrow();
  });

  it('noise stays in range', () => {
    for (const kind of ['white', 'pink', 'brown']) {
      const d = FocusScenes.fillNoise(new Float32Array(4000), kind, VexLiving.rng(2));
      const peak = d.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak).toBeGreaterThan(0.01);
      expect(peak).toBeLessThan(2);
    }
  });
});

describe('Focus scenes: playing', () => {
  it('synthesises every scene from nodes, with no audio file', async () => {
    for (const scene of FocusScenes.SCENES) {
      const ctx = fakeAudioCtx();
      await FocusScenes.play(scene, { env: { gameActive: false }, ctxFactory: () => ctx, volume: 0.5, random: VexLiving.rng(1) });
      expect(ctx.created.filter(n => n.started).length).toBeGreaterThanOrEqual(2);
      FocusScenes.stop('test', { immediate: true });
      expect(ctx.closed).toBe(true);
    }
  });

  it('never plays in Game mode', async () => {
    const ctx = fakeAudioCtx();
    const factory = vi.fn(() => ctx);
    await expect(FocusScenes.play('rain', { env: { gameActive: true }, ctxFactory: factory })).rejects.toThrow(/Game mode/);
    expect(factory).not.toHaveBeenCalled();
    expect(FocusScenes.state().playing).toBe(false);
  });

  it('stops by itself at the end of the focus session and releases the device', async () => {
    const ctx = fakeAudioCtx();
    await FocusScenes.play('fire', { env: {}, ctxFactory: () => ctx, untilMs: Date.now() + 60000 });
    expect(FocusScenes.state().playing).toBe(true);
    vi.advanceTimersByTime(59000);
    expect(FocusScenes.state().playing).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(FocusScenes.state().playing).toBe(false);
    vi.advanceTimersByTime(3000);          // fade-out, then the context closes
    expect(ctx.closed).toBe(true);
  });

  it('holds no timer after it stops', async () => {
    await FocusScenes.play('rain', { env: {}, ctxFactory: fakeAudioCtx, untilMs: Date.now() + 600000 });
    FocusScenes.stop('user');
    vi.advanceTimersByTime(5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a game starting fades a playing scene out', async () => {
    FocusScenes.install({ FocusMode: { start() {}, stop() {} } });
    await FocusScenes.play('space', { env: {}, ctxFactory: fakeAudioCtx });
    document.dispatchEvent(new CustomEvent('vex:game-mode', { detail: { active: true } }));
    expect(FocusScenes.state().playing).toBe(false);
  });

  it('hooks focus: starts with the session only when asked, stops when it ends', async () => {
    const FM = { until: 0, start(min) { this.until = Date.now() + min * 60000; }, stop() {} };
    FocusScenes.install({ FocusMode: FM });
    const ctx = fakeAudioCtx();
    globalThis.window.AudioContext = function () { return ctx; };
    FM.start(25);                                     // sceneWithFocus is off: silence
    await vi.advanceTimersByTimeAsync(0);
    expect(FocusScenes.state().playing).toBe(false);

    VexLiving.write({ scene: 'cafe', sceneWithFocus: true, sceneVolume: 0.4 });
    FM.start(25);
    await vi.advanceTimersByTimeAsync(0);
    expect(FocusScenes.state().playing).toBe(true);
    expect(FocusScenes.state().autoStopAt).toBeGreaterThan(Date.now());
    FM.stop();
    expect(FocusScenes.state().playing).toBe(false);
    delete globalThis.window.AudioContext;
  });

  it('does not start with focus during Game mode', async () => {
    const FM = { until: 0, start() {}, stop() {} };
    FocusScenes.install({ FocusMode: FM });
    VexLiving.write({ scene: 'rain', sceneWithFocus: true });
    window.showToast = vi.fn();
    document.dispatchEvent(new CustomEvent('vex:game-mode', { detail: { active: true } }));
    // VexLiving.watch keeps the game flag once a layer is watching
    const off = VexLiving.watch(() => {});
    document.dispatchEvent(new CustomEvent('vex:game-mode', { detail: { active: true } }));
    FM.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(FocusScenes.state().playing).toBe(false);
    expect(window.showToast).toHaveBeenCalled();
    document.dispatchEvent(new CustomEvent('vex:game-mode', { detail: { active: false } }));
    off();
  });
});

describe('Sticker sheet: model', () => {
  const S = StickerSheet;

  it('the same medal id always gives the same sticker, and never twice', () => {
    expect(S.stickerForKey('first-tab')).toBe(S.stickerForKey('first-tab'));
    expect(S.IDS).toContain(S.stickerForKey('anything'));
    let m = S.normalize(null);
    let r = S.grant(m, { id: 'first-tab' }, 5);
    expect(r.granted.key).toBe('first-tab');
    r = S.grant(r.model, { id: 'first-tab' });
    expect(r.granted).toBeNull();
    expect(r.reason).toBe('already');
    expect(S.grant(m, {}).reason).toBe('no-id');
    expect(S.grant(m, null).reason).toBe('no-id');
  });

  it('reads the id from the usual fields', () => {
    expect(S.signalKey({ id: 'a' })).toBe('a');
    expect(S.signalKey({ medal: 'b' })).toBe('b');
    expect(S.signalKey({ milestone: 7 })).toBe('7');
    expect(S.signalKey({ id: '  ' })).toBe('');
  });

  it('you can place a sticker only as often as you earned it', () => {
    let m = S.grant(S.normalize(null), { id: 'k1' }).model;
    const id = m.collected[0].sticker;
    m = S.place(m, id, 0.2, 0.3);
    expect(m.placed.length).toBe(1);
    expect(() => S.place(m, id, 0.5, 0.5)).toThrow(/left to place/);
    expect(() => S.place(m, 'nope', 0, 0)).toThrow(/Unknown sticker/);
  });

  it('moves, rotates, resizes and raises inside bounds; removing frees the sticker', () => {
    let m = S.grant(S.normalize(null), { id: 'k1' }).model;
    const id = m.collected[0].sticker;
    m = S.place(m, id, 2, -1);
    const uid = m.placed[0].uid;
    expect(m.placed[0].x).toBe(1);
    expect(m.placed[0].y).toBe(0);
    m = S.rotate(m, uid, 400); expect(m.placed[0].rot).toBe(45);
    m = S.resize(m, uid, 0.1); expect(m.placed[0].scale).toBe(0.6);
    m = S.remove(m, uid);
    expect(S.available(m, id)).toBe(1);
    expect(() => S.move(m, uid, 0, 0)).toThrow(/No such sticker/);
  });

  it('survives garbage in storage', () => {
    const m = S.normalize({ collected: [{ key: 'a', sticker: 'star' }, { key: 5, sticker: 'x' }, null], placed: [{ uid: 'u', sticker: 'nope' }] });
    expect(m.collected.length).toBe(1);
    expect(m.placed.length).toBe(0);
    localStorage.setItem(S.KEY, '{{');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(S.load().collected).toEqual([]);
    warn.mockRestore();
  });

  it('every catalog sticker is plain SVG: no emoji, no bitmaps, no script', () => {
    for (const c of S.CATALOG) {
      expect(c.svg).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(c.svg).not.toMatch(/<(script|image|foreignObject)/i);
      expect(c.svg.length).toBeGreaterThan(40);
    }
    expect(new Set(S.IDS).size).toBe(S.IDS.length);
  });
});

describe('Sticker sheet: signals and the board', () => {
  const S = StickerSheet;

  it('ignores milestones while the switch is off, collects them when on', () => {
    expect(S.onMedal({ detail: { id: 'm1' } })).toBeNull();
    expect(S.load().collected.length).toBe(0);
    VexLiving.write({ stickers: true });
    const g = S.onMedal({ detail: { id: 'm1' } });
    expect(g.key).toBe('m1');
    expect(S.onMedal({ detail: { id: 'm1' } })).toBeNull();
    expect(S.load().collected.length).toBe(1);
  });

  it('listens for vex:medal-signal on the document', () => {
    VexLiving.write({ stickers: true });
    S.listen();
    document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id: 'doc-1' } }));
    expect(S.load().collected.map(c => c.key)).toEqual(['doc-1']);
  });

  it('mounts a board with no timers, places from the tray, and deletes by keyboard', () => {
    VexLiving.write({ stickers: true });
    S.onMedal({ detail: { id: 'a' } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const before = vi.getTimerCount();
    S.mount(host);
    expect(vi.getTimerCount()).toBe(before);
    expect(host.querySelector('.vex-board-empty')).toBeTruthy();
    host.querySelector('.vex-tray-item').click();
    const st = host.querySelector('.vex-sticker');
    expect(st).toBeTruthy();
    expect(S.load().placed.length).toBe(1);
    expect(host.querySelector('.vex-tray-item')).toBeNull();      // none left to place
    st.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(S.load().placed.length).toBe(0);
    expect(host.querySelectorAll('.vex-tray-item').length).toBe(1);
    expect(S.snapshot()).toMatchObject({ mounted: true, collected: 1, placed: 0, timers: 0, frames: 0 });
    S.unmount();
    expect(host.querySelector('.vex-board')).toBeNull();
  });
});
