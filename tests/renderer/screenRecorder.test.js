// @vitest-environment jsdom
//
// Record the screen: Vex's own picker, Chromium's recorder, and chunks sent
// to disk in order.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { ScreenRecorder } = require('../../src/renderer/js/screen-recorder.js');

class FakeRecorder {
  constructor(stream, opts) { this.stream = stream; this.opts = opts; this.state = 'inactive'; this.listeners = {}; FakeRecorder.last = this; }
  start(slice) { this.state = 'recording'; this.slice = slice; }
  stop() { this.state = 'inactive'; (this.listeners.stop || []).forEach(f => f()); }
  addEventListener(ev, f) { (this.listeners[ev] ||= []).push(f); }
  emit(bytes) { this.ondataavailable({ data: { size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer } }); }
}
function fakeStream(withAudio = true) {
  const ended = [];
  const video = { stop: vi.fn(), addEventListener: (ev, f) => { if (ev === 'ended') ended.push(f); } };
  const tracks = [video, ...(withAudio ? [{ stop: vi.fn(), addEventListener: () => {} }] : [])];
  return { stream: { getTracks: () => tracks, getVideoTracks: () => [video], getAudioTracks: () => tracks.slice(1) }, end: () => ended.forEach(f => f()), video };
}

let chunks;
beforeEach(() => {
  document.body.innerHTML = '';
  ScreenRecorder._rec = null;
  chunks = [];
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => true);
  globalThis.MediaRecorder = FakeRecorder;
  FakeRecorder.isTypeSupported = (t) => t === 'video/mp4' || t.startsWith('video/webm');
  window.vex = {
    recStart: vi.fn(async (ext) => ({ ok: true, id: 'r1', ext })),
    recChunk: vi.fn(async (id, bytes) => { chunks.push([...bytes]); return { ok: true }; }),
    recFinish: vi.fn(async () => ({ ok: true, path: 'C:/Users/me/Videos/Vex recording.mp4', bytes: 3 * 1024 * 1024 })),
    recCancel: vi.fn(async () => ({ ok: true })),
  };
});

describe('choosing a format', () => {
  it("WebM first even where MP4 exists — this build's MP4 recorder hands over nothing until Stop", () => {
    expect(ScreenRecorder.format(() => true)).toEqual({ mime: 'video/webm;codecs=vp9,opus', ext: 'webm' });
    expect(ScreenRecorder.format((t) => t === 'video/mp4')).toEqual({ mime: 'video/mp4', ext: 'mp4' });   // fallback only
    expect(ScreenRecorder.format(() => false)).toBe(null);
  });
  it('shows time the way people read it', () => {
    expect(ScreenRecorder.elapsed(0)).toBe('0:00');
    expect(ScreenRecorder.elapsed(75000)).toBe('1:15');
    expect(ScreenRecorder.elapsed(3723000)).toBe('1:02:03');
  });
});

describe('recording', () => {
  it('asks Vex\'s picker for a screen with sound, records, and sends chunks in order', async () => {
    const { stream } = fakeStream();
    navigator.mediaDevices = { getDisplayMedia: vi.fn(async () => stream) };
    await ScreenRecorder.start();
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: true }));
    expect(window.vex.recStart).toHaveBeenCalledWith('webm');
    expect(FakeRecorder.last.slice).toBe(1000);
    expect(document.querySelector('.vex-rec-pill')).not.toBe(null);
    FakeRecorder.last.emit([1, 2]);
    FakeRecorder.last.emit([3]);
    await ScreenRecorder.stop();
    expect(chunks).toEqual([[1, 2], [3]]);
    expect(window.vex.recFinish).toHaveBeenCalledWith('r1');
    expect(window.showToast).toHaveBeenLastCalledWith(expect.stringMatching(/Recording saved — Vex recording\.mp4 \(3\.0 MB/));
    expect(document.querySelector('.vex-rec-pill')).toBe(null);
    expect(stream.getTracks().every(t => t.stop.mock.calls.length)).toBe(true);   // capture really ends
  });

  it('choosing nothing in the picker is not an error', async () => {
    const e = new Error('cancelled'); e.name = 'NotAllowedError';
    navigator.mediaDevices = { getDisplayMedia: vi.fn(async () => {
      const ov = document.createElement('div'); ov.className = 'scrpick-ov'; document.body.appendChild(ov);   // the picker was shown
      await new Promise(r => setTimeout(r, 120));
      ov.remove();
      throw e;
    }) };
    expect(await ScreenRecorder.start()).toBe(null);
    expect(window.vex.recStart).not.toHaveBeenCalled();
  });

  it('refused before the picker ever opened is a failure, said out loud — not a silent "cancel"', async () => {
    const e = new Error('Permission denied'); e.name = 'NotAllowedError';
    navigator.mediaDevices = { getDisplayMedia: vi.fn(async () => { throw e; }) };
    await expect(ScreenRecorder.start()).rejects.toThrow(/refused before anything could be chosen: Permission denied/);
  });

  it('"Stop sharing" from Windows ends the recording and saves it', async () => {
    const s = fakeStream();
    navigator.mediaDevices = { getDisplayMedia: vi.fn(async () => s.stream) };
    await ScreenRecorder.start();
    s.end();
    await vi.waitFor(() => expect(window.vex.recFinish).toHaveBeenCalled());
    expect(ScreenRecorder.recording()).toBe(false);
  });

  it('Discard asks, then deletes instead of saving', async () => {
    navigator.mediaDevices = { getDisplayMedia: vi.fn(async () => fakeStream().stream) };
    await ScreenRecorder.start();
    document.querySelector('.vex-rec-pill [data-discard]').click();
    await vi.waitFor(() => expect(window.vex.recCancel).toHaveBeenCalledWith('r1'));
    expect(window.vex.recFinish).not.toHaveBeenCalled();
  });

  it('a write failure stops the recording and still saves what there is', async () => {
    navigator.mediaDevices = { getDisplayMedia: vi.fn(async () => fakeStream().stream) };
    window.vex.recChunk = vi.fn(async () => ({ ok: false, error: 'Disk full' }));
    await ScreenRecorder.start();
    FakeRecorder.last.emit([1]);
    await vi.waitFor(() => expect(window.vex.recFinish).toHaveBeenCalled());
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Disk full — saving what was recorded/), 'error');
  });

  it('a chunk refused by throwing still lets Discard remove the file', async () => {
    navigator.mediaDevices = { getDisplayMedia: vi.fn(async () => fakeStream().stream) };
    window.vex.recChunk = vi.fn(async () => { throw new Error("Error invoking remote method 'rec:chunk': Error: Collection limit exceeded"); });
    await ScreenRecorder.start();
    FakeRecorder.last.emit([1]);
    await vi.waitFor(() => expect(window.vex.recFinish).toHaveBeenCalled());   // stopped itself, saved what there was
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Collection limit exceeded — saving what was recorded/), 'error');
  });

  it('one recording at a time', async () => {
    navigator.mediaDevices = { getDisplayMedia: vi.fn(async () => fakeStream().stream) };
    await ScreenRecorder.start();
    await expect(ScreenRecorder.start()).rejects.toThrow(/Already recording/);
    await ScreenRecorder.stop(true);
  });
});
