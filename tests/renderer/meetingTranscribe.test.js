// @vitest-environment jsdom
//
// The meeting copilot's transcript of the owner's own voice (js/meeting-transcribe.js), with the microphone,
// the audio graph and the main-process engine all faked: the pure parts, the consent each session, the banner,
// the segmenting, the speech-timer hook, and where the text ends up.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const JS = '../../src/renderer/js/';
const ROOT = path.resolve(__dirname, '../..');
const { VexMeetingTranscribe: MT } = require(JS + 'meeting-transcribe.js');
const { MeetingCopilot } = require(JS + 'meeting-copilot.js');
const { VexSpeechTimer } = require(JS + 'speech-timer.js');

const loud = (n = 4096) => new Float32Array(n).fill(0.2);
const quiet = (n = 4096) => new Float32Array(n);

let proc, tracks, chunkCalls, vexApi;
function fakeAudio() {
  tracks = [{ stop: vi.fn() }];
  globalThis.AudioContext = class {
    constructor(o) { this.opts = o; this.destination = {}; }
    createMediaStreamSource() { return { connect() {} }; }
    createScriptProcessor() { proc = { onaudioprocess: null, connect() {}, disconnect: vi.fn() }; return proc; }
    async close() {}
  };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => tracks })) } });
}
const feed = (block) => proc.onaudioprocess({ inputBuffer: { getChannelData: () => block } });
// 4096 samples at 16 kHz is 0.256 s: 28 blocks is just over 7 s.
const speak = (blocks) => { for (let i = 0; i < blocks; i++) feed(loud()); };
const pause = (blocks) => { for (let i = 0; i < blocks; i++) feed(quiet()); };
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  globalThis.MeetingCopilot = MeetingCopilot;
  globalThis.VexSpeechTimer = VexSpeechTimer;
  window.GameMode = { gaming: false };
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => true);
  chunkCalls = [];
  vexApi = {
    transcribeConfig: vi.fn(async () => ({ ready: true, engine: 'C:\\tools\\whisper-cli.exe', model: 'M', keepAudio: false })),
    transcribeBegin: vi.fn(async () => ({ started: true, token: 'tok' })),
    transcribeChunk: vi.fn(async (token, b64) => { chunkCalls.push({ token, b64 }); return { text: 'spoken words ' + chunkCalls.length }; }),
    transcribeEnd: vi.fn(async () => ({ kept: null })),
  };
  window.vex = vexApi;
  fakeAudio();
  MT.setEnabled(true);
  MeetingCopilot.begin({ title: 'Budget' });
});
afterEach(async () => { if (MT.isListening()) await MT.stop(); delete globalThis.AudioContext; delete globalThis.VexJobs; });

describe('pure parts', () => {
  it('encodes a 16 kHz mono 16-bit WAV', () => {
    const w = MT.encodeWav(new Float32Array([0, 1, -1, 0.5]));
    expect(w.length).toBe(44 + 8);
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...w.slice(8, 12))).toBe('WAVE');
    const v = new DataView(w.buffer);
    expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([1, 1, 16000, 16]);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
    expect(v.getUint32(40, true)).toBe(8);
  });
  it('turns bytes into base64 even for long audio', () => {
    const big = new Uint8Array(100000).map((_, i) => i % 251);
    expect(Buffer.from(MT.toBase64(big), 'base64').equals(Buffer.from(big))).toBe(true);
  });
  it('cuts a segment at a pause after the minimum, or at the maximum, and drops silence', () => {
    const seg = MT.createSegmenter();
    let out = null;
    for (let i = 0; i < 28; i++) out = seg.push(loud()) || out;          // just over 7 s of voice
    expect(out).toBeNull();                                               // no pause yet
    for (let i = 0; i < 3 && !out; i++) out = seg.push(quiet());          // 0.77 s of quiet
    expect(out).toBeNull();
    out = seg.push(quiet());                                              // past 0.8 s of quiet
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBeGreaterThan(16000 * 7);
    const long = MT.createSegmenter();
    let first = null;
    for (let i = 0; i < 200 && !first; i++) first = long.push(loud());
    expect(first.length).toBeGreaterThanOrEqual(16000 * 30);
    const silent = MT.createSegmenter();
    let nothing = 'unset';
    for (let i = 0; i < 130; i++) { const r = silent.push(quiet()); if (r) nothing = r; }
    expect(nothing).toBe('unset');                                       // silence is never a segment
    expect(silent.cut()).toBeNull();
  });
  it('labels a part with the turn it was in', () => {
    expect(MT.labelFor('Ana')).toBe('during Ana\'s turn');
    expect(MT.labelFor('')).toBe('');
  });
});

describe('before it listens', () => {
  it('is off until switched on, and refuses without a meeting, with a game running, or without an engine', async () => {
    MT.setEnabled(false);
    await expect(MT.start()).rejects.toThrow(/switched off/);
    MT.setEnabled(true);
    MeetingCopilot.discard();
    await expect(MT.start()).rejects.toThrow(/Start the meeting notes/);
    MeetingCopilot.begin({ title: 'x' });
    window.GameMode.gaming = true;
    await expect(MT.start()).rejects.toThrow(/game is running/);
    window.GameMode.gaming = false;
    vexApi.transcribeConfig = vi.fn(async () => ({ ready: false }));
    await expect(MT.start()).rejects.toThrow(/Choose the whisper.cpp program/);
    expect(vexApi.transcribeBegin).not.toHaveBeenCalled();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
  it('asks every time, says it is the microphone only, and opens nothing when the answer is no', async () => {
    window.vexConfirm = vi.fn(async () => false);
    expect(await MT.start()).toBe(false);
    const o = window.vexConfirm.mock.calls[0][0];
    expect(o.message).toMatch(/YOUR microphone/);
    expect(o.message).toMatch(/does not record the call/);
    expect(o.message).toMatch(/whisper-cli\.exe/);
    expect(vexApi.transcribeBegin).not.toHaveBeenCalled();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    window.vexConfirm = vi.fn(async () => true);
    await MT.start(); await MT.stop();
    await MT.start();
    expect(window.vexConfirm).toHaveBeenCalledTimes(2);                  // the second session asked again
  });
  it('does not open the microphone when main\'s own box is declined', async () => {
    vexApi.transcribeBegin = vi.fn(async () => ({ started: false }));
    expect(await MT.start()).toBe(false);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(MT.isListening()).toBe(false);
  });
  it('says so when Windows does not allow the microphone, and closes the session in main', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(async () => { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; });
    await expect(MT.start()).rejects.toThrow(/Windows Settings > Privacy > Microphone/);
    expect(MT.isListening()).toBe(false);
    expect(document.getElementById('vex-transcribe-banner')).toBeNull();
  });
});

describe('while it listens', () => {
  it('shows a bar the whole time, and removes it and the microphone on stop', async () => {
    await MT.start();
    const bar = document.getElementById('vex-transcribe-banner');
    expect(bar).not.toBeNull();
    expect(bar.textContent).toMatch(/Listening to your microphone/);
    expect(bar.querySelector('[data-stop]')).not.toBeNull();
    await MT.stop();
    expect(document.getElementById('vex-transcribe-banner')).toBeNull();
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(proc.disconnect).toHaveBeenCalled();
    expect(vexApi.transcribeEnd).toHaveBeenCalledWith('tok');
  });
  it('sends each segment as WAV text and files what comes back as the meeting transcript', async () => {
    await MT.start();
    speak(28); pause(4);
    await settle(); await settle();
    expect(chunkCalls).toHaveLength(1);
    const wav = Buffer.from(chunkCalls[0].b64, 'base64');
    expect(wav.toString('latin1', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16000);
    const s = MeetingCopilot.current();
    expect(s.transcript).toHaveLength(1);
    expect(s.transcript[0].text).toBe('spoken words 1');
    const md = MeetingCopilot.markdown(s, MeetingCopilot.plain(s));
    expect(md).toMatch(/## Transcript of my voice \(made on this PC\)/);
    expect(md).toContain('spoken words 1');
    const p = MeetingCopilot.buildPrompt(s);
    expect(p.prompt).toMatch(/\(spoken\) spoken words 1/);
  });
  it('stop sends what is left, waits for the engine and reports', async () => {
    await MT.start();
    speak(10);                                // 2.5 s, no pause: still held
    expect(chunkCalls).toHaveLength(0);
    const r = await MT.stop();
    expect(chunkCalls).toHaveLength(1);
    expect(r).toMatchObject({ segments: 1, skipped: 0, failed: 0, kept: null });
    expect(MeetingCopilot.current().transcript).toHaveLength(1);
  });
  it('labels parts with the speech timer\'s speaker, and a change of speaker ends the part', async () => {
    VexSpeechTimer._run = { current: { name: 'Ana' } };
    await MT.start();
    speak(12);
    VexSpeechTimer._run = { current: { name: 'Bo' } };
    window.dispatchEvent(new CustomEvent('vex:speaker-change', { detail: { name: 'Bo' } }));
    speak(12);
    await MT.stop();
    const parts = MeetingCopilot.current().transcript;
    expect(parts.map((p) => p.speaker)).toEqual(['during Ana\'s turn', 'during Bo\'s turn']);
    VexSpeechTimer._run = null;
  });
  it('says a part was skipped when the heavy-work gate refuses it, and counts it', async () => {
    globalThis.VexJobs = { heavy: vi.fn(async () => ({ ran: false, reason: 'a game is running' })) };
    await MT.start();
    speak(28); pause(4);
    await settle(); await settle();
    expect(document.getElementById('vex-transcribe-banner').textContent).toMatch(/1 skipped.*a game is running/);
    const r = await MT.stop();
    expect(r.skipped).toBe(1);
    expect(MeetingCopilot.current().transcript || []).toHaveLength(0);
    expect(globalThis.VexJobs.heavy.mock.calls[0][2]).toMatchObject({ kind: 'audio', feature: 'meeting-transcribe' });
  });
  it('a failing engine is shown, not swallowed', async () => {
    vexApi.transcribeChunk = vi.fn(async () => { throw new Error('model file is damaged'); });
    await MT.start();
    speak(28); pause(4);
    await settle(); await settle();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Transcription failed: model file is damaged/), 'error');
    const r = await MT.stop();
    expect(r.failed).toBe(1);
  });
});

describe('the copilot and the timer', () => {
  it('stores spoken parts apart from typed lines, with limits', () => {
    const s = MeetingCopilot.newSession({ title: 'T', now: 1000 });
    MeetingCopilot.addLine(s, 'typed', { now: 2000 });
    MeetingCopilot.addTranscript(s, '  spoken   words ', { at: 3000, speaker: 'during Ana\'s turn' });
    expect(s.transcript).toEqual([{ at: 3000, speaker: 'during Ana\'s turn', text: 'spoken words' }]);
    expect(MeetingCopilot.allLines(s).map((l) => l.text)).toEqual(['typed', 'spoken words']);
    expect(() => MeetingCopilot.addTranscript(s, '   ')).toThrow(/no text/);
    s.transcript = new Array(MeetingCopilot.MAX_TRANSCRIPT).fill({ at: 1, speaker: '', text: 'x' });
    expect(() => MeetingCopilot.addTranscript(s, 'one more')).toThrow(/most transcript parts/);
  });
  it('the speech timer names the speaker whose turn is on', () => {
    expect(VexSpeechTimer.currentSpeaker()).toBe('');
    VexSpeechTimer._run = { current: { name: 'Cy' } };
    expect(VexSpeechTimer.currentSpeaker()).toBe('Cy');
    VexSpeechTimer._run = null;
  });
  it('the copilot file itself still opens no input device (the old guard)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer/js/meeting-copilot.js'), 'utf8');
    for (const word of ['getUserMedia', 'getDisplayMedia', 'MediaRecorder', 'desktopCapturer', 'mediaDevices', 'SpeechRecognition', 'AudioContext', 'captureStream']) expect(src.includes(word), word).toBe(false);
  });
});

describe('wiring', () => {
  it('has a script tag after the copilot, a manifest, a catalog entry and a usage row, maturity new', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
    expect(html.indexOf('js/meeting-transcribe.js')).toBeGreaterThan(html.indexOf('js/meeting-copilot.js'));
    expect(fs.readFileSync(path.join(ROOT, 'src/renderer/js/feature-manifests.js'), 'utf8')).toMatch(/id: 'meeting-transcribe'[^}]*maturity: 'new'/);
    expect(fs.readFileSync(path.join(ROOT, 'src/renderer/js/feature-catalog.js'), 'utf8')).toContain("feature: 'meeting-transcribe'");
    expect(fs.readFileSync(path.join(ROOT, 'src/renderer/js/vex-usage-registry.js'), 'utf8')).toContain("['meeting-transcribe'");
  });
});
