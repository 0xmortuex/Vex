// The local transcription pipeline for the meeting copilot (main/transcribe.js), run against a FAKE engine:
// the real program (whisper.cpp) is installed by the person. Real child processes, real temp files, no network.
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { createTranscriber, registerTranscribe, wavOk, cleanText, commandLine, MAX_QUEUE } = req('../../src/main/transcribe.js');
const FAKE = path.resolve(__dirname, '../fixtures/fake-whisper.js');

const dirs = [];
const tmp = () => { const d = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'vex-tr-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) nodeFs.rmSync(d, { recursive: true, force: true }); delete process.env.FAKE_WHISPER_MODE; delete process.env.FAKE_WHISPER_LOG; });

function wav(samples = 16000, { rate = 16000, channels = 1, bits = 16 } = {}) {
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVE', 8, 'latin1'); b.write('fmt ', 12, 'latin1');
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(bits, 34);
  b.write('data', 36, 'latin1'); b.writeUInt32LE(samples * 2, 40);
  return b;
}

// A transcriber whose "file dialog" answers with the given files, and whose consent box answers `consent`.
function setup({ consent = 0, timeoutMs, withScript = true } = {}) {
  const profile = tmp(), scratch = tmp();
  const model = path.join(scratch, 'ggml-base.bin'); nodeFs.writeFileSync(model, 'model');
  const picks = [process.execPath, withScript ? FAKE : null, model];
  const dialogs = { open: [], box: [] };
  const answers = { engine: process.execPath, script: FAKE, model };
  const dialog = {
    showOpenDialog: async (_win, opts) => { dialogs.open.push(opts); const kind = /whisper\.cpp program/.test(opts.title) ? 'engine' : /model file/.test(opts.title) ? 'model' : 'script'; return { canceled: false, filePaths: [answers[kind]] }; },
    showMessageBox: async (_win, opts) => { dialogs.box.push(opts); return { response: consent }; },
  };
  const state = new Map();
  const store = { read: async (k) => (state.has(k) ? JSON.parse(state.get(k)) : null), write: async (k, v) => { state.set(k, JSON.stringify(v)); } };
  const t = createTranscriber({ store, dialog, userDataPath: profile, tmpdir: scratch, timeoutMs, log: { error() {}, warn() {} } });
  return { t, profile, scratch, dialogs, store, picks };
}
async function ready(s) { await s.t.pick('engine'); await s.t.pick('model'); await s.t.pick('script'); return s; }

describe('pure parts', () => {
  it('accepts only a 16 kHz mono 16-bit WAV', () => {
    expect(wavOk(wav())).toBe('');
    expect(wavOk(wav(100, { rate: 44100 }))).toMatch(/16 kHz/);
    expect(wavOk(wav(100, { channels: 2 }))).toMatch(/16 kHz/);
    expect(wavOk(Buffer.from('not a wav at all, definitely not a wav, not even close to forty-four bytes'))).toMatch(/not a WAV/);
    expect(wavOk(new Uint8Array(10))).toMatch(/not a WAV/);
  });
  it('drops the sound-effect markers whisper prints for silence', () => {
    expect(cleanText(' [BLANK_AUDIO]\n')).toBe('');
    expect(cleanText('(music)')).toBe('');
    expect(cleanText(' hello   there \n [pause]\n again ')).toBe('hello there again');
    expect(cleanText('...')).toBe('');
  });
  it('builds the command as an argument list', () => {
    expect(commandLine({ engine: 'E', model: 'M', script: '' }, 'tr')).toEqual(['E', '-m', 'M', '-f', '<audio segment>', '-l', 'tr', '-nt', '-np']);
    expect(commandLine({ engine: 'E', model: 'M', script: 'S' }, 'en', 'x.wav').slice(0, 3)).toEqual(['E', 'S', '-m']);
  });
});

describe('choosing the engine and the model', () => {
  it('is not ready until the person has chosen both, and the dialog is main\'s', async () => {
    const s = setup();
    expect((await s.t.config()).ready).toBe(false);
    await s.t.pick('engine');
    expect((await s.t.config()).ready).toBe(false);
    const c = await s.t.pick('model');
    expect(c).toMatchObject({ engine: process.execPath, ready: true, language: 'auto', keepAudio: false });
    expect(s.dialogs.open.every((o) => o.properties.join() === 'openFile')).toBe(true);
    expect(s.dialogs.open.find((o) => /model/.test(o.title)).filters[0].extensions).toContain('bin');
  });
  it('keeps the old choice when the dialog is cancelled, and refuses what is not a file', async () => {
    const s = setup();
    await ready(s);
    const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showMessageBox: async () => ({ response: 0 }) };
    const state = new Map();
    const t2 = createTranscriber({ store: s.store, dialog, userDataPath: s.profile, log: { error() {} } });
    expect((await t2.pick('engine')).engine).toBe(process.execPath);
    const t3 = createTranscriber({ store: s.store, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [s.scratch] }), showMessageBox: async () => ({ response: 0 }) }, userDataPath: s.profile, log: { error() {} } });
    await expect(t3.pick('engine')).rejects.toThrow(/not a file/);
    await expect(t3.pick('nonsense')).rejects.toThrow(/Unknown/);
    void state;
  });
  it('clears a choice, and sets the language and keep-audio with checks', async () => {
    const s = setup();
    await ready(s);
    expect((await s.t.clear('script')).script).toBe('');
    expect((await s.t.set({ language: 'tr', keepAudio: true }))).toMatchObject({ language: 'tr', keepAudio: true });
    await expect(s.t.set({ language: 'turkish!' })).rejects.toThrow(/short code/);
    await expect(s.t.set({ keepAudio: 'yes' })).rejects.toThrow(/on or off/);
  });
});

describe('a listening session', () => {
  it('needs the person\'s answer in main\'s own box, which names the microphone and the exact command', async () => {
    const s = await ready(setup({ consent: 1 }));
    const r = await s.t.begin(null, { sessionName: 'Budget review' });
    expect(r.started).toBe(false);
    const box = s.dialogs.box[0];
    expect(box.message).toMatch(/YOUR microphone.*Budget review/);
    expect(box.detail).toMatch(/call are not captured/);
    expect(box.detail).toContain('-m');
    expect(box.detail).toContain('-nt -np');
    expect(box.detail).toMatch(/deleted as soon as it has been read/);
    expect(box.buttons).toEqual(['Start listening', 'Cancel']);
    expect(s.t.active()).toBe(0);
    await expect(s.t.chunk('made-up-token', wav())).rejects.toThrow(/not on/);
  });
  it('refuses to begin without an engine and a model', async () => {
    const s = setup();
    await expect(s.t.begin(null)).rejects.toThrow(/Choose the whisper.cpp program/);
    expect(s.dialogs.box).toEqual([]);
  });
  it('transcribes a segment with the exact argument list, no shell, and deletes the audio', async () => {
    const s = await ready(setup());
    process.env.FAKE_WHISPER_LOG = path.join(s.scratch, 'calls.log');
    const { token } = await s.t.begin(null);
    const r = await s.t.chunk(token, wav(16000));
    expect(r.text).toBe('hello from seg-1.wav with 16000 samples lang=auto');
    const calls = nodeFs.readFileSync(process.env.FAKE_WHISPER_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['-m', expectedModel(s), '-f', expect.stringMatching(/seg-1\.wav$/), '-l', 'auto', '-nt', '-np']);
    expect(calls[0].wavExists).toBe(true);
    // Nothing of the audio is left behind.
    expect(nodeFs.readdirSync(s.scratch).filter((n) => n.startsWith('vex-transcribe-'))).toHaveLength(1);   // the session folder, still open
    expect(nodeFs.readdirSync(path.join(s.scratch, nodeFs.readdirSync(s.scratch).find((n) => n.startsWith('vex-transcribe-'))))).toEqual([]);
    const ended = await s.t.end(token);
    expect(ended.kept).toBeNull();
    expect(nodeFs.readdirSync(s.scratch).filter((n) => n.startsWith('vex-transcribe-'))).toEqual([]);
    expect(nodeFs.existsSync(path.join(s.profile, 'meeting-audio'))).toBe(false);
  });
  it('passes the language, and keeps the audio only when the person ticked it', async () => {
    const s = await ready(setup());
    await s.t.set({ language: 'tr', keepAudio: true });
    const { token } = await s.t.begin(null);
    expect(s.dialogs.box[0].detail).toMatch(/audio WILL be kept/);
    expect((await s.t.chunk(token, wav(8000))).text).toMatch(/lang=tr/);
    await s.t.chunk(token, wav(8000));
    const { kept } = await s.t.end(token);
    expect(kept).toBe(path.join(s.profile, 'meeting-audio', token.slice(0, 8)));
    expect(nodeFs.readdirSync(kept).sort()).toEqual(['seg-1.wav', 'seg-2.wav']);
  });
  it('a segment of silence comes back empty', async () => {
    const s = await ready(setup());
    process.env.FAKE_WHISPER_MODE = 'blank';
    const { token } = await s.t.begin(null);
    expect((await s.t.chunk(token, wav())).text).toBe('');
    await s.t.end(token);
  });
  it('a failing engine is an error that quotes what it said, and the audio is still deleted', async () => {
    const s = await ready(setup());
    process.env.FAKE_WHISPER_MODE = 'fail';
    const { token } = await s.t.begin(null);
    await expect(s.t.chunk(token, wav())).rejects.toThrow(/code 3: model file is damaged/);
    await s.t.end(token);
    expect(nodeFs.readdirSync(s.scratch).filter((n) => n.startsWith('vex-transcribe-'))).toEqual([]);
  });
  it('stops an engine that hangs, and one that prints without end', async () => {
    const s = await ready(setup({ timeoutMs: 400 }));
    const { token } = await s.t.begin(null);
    process.env.FAKE_WHISPER_MODE = 'hang';
    await expect(s.t.chunk(token, wav())).rejects.toThrow(/took longer/);
    process.env.FAKE_WHISPER_MODE = 'flood';
    await expect(s.t.chunk(token, wav())).rejects.toThrow(/far more text/);
    await s.t.end(token);
  });
  it('refuses bad audio, bad base64 and a closed session', async () => {
    const s = await ready(setup());
    const { token } = await s.t.begin(null);
    await expect(s.t.chunk(token, wav(100, { rate: 8000 }))).rejects.toThrow(/16 kHz/);
    await expect(s.t.chunk(token, '!!not base64!!')).rejects.toThrow(/base64/);
    expect((await s.t.chunk(token, wav(1600).toString('base64'))).text).toMatch(/1600 samples/);
    await s.t.end(token);
    await expect(s.t.chunk(token, wav())).rejects.toThrow(/not on/);
  });
  it('does not let audio pile up behind a slow engine', async () => {
    const s = await ready(setup({ timeoutMs: 600 }));
    process.env.FAKE_WHISPER_MODE = 'hang';
    const { token } = await s.t.begin(null);
    const jobs = Array.from({ length: MAX_QUEUE }, () => s.t.chunk(token, wav(1600)).catch((e) => e.message));
    await expect(s.t.chunk(token, wav(1600))).rejects.toThrow(/not keeping up/);
    const out = await Promise.all(jobs);
    expect(out.every((m) => /took longer/.test(m))).toBe(true);
    await s.t.end(token);
  }, 20000);
  it('every session asks again', async () => {
    const s = await ready(setup());
    const a = await s.t.begin(null); await s.t.end(a.token);
    const b = await s.t.begin(null); await s.t.end(b.token);
    expect(s.dialogs.box).toHaveLength(2);
    expect(a.token).not.toBe(b.token);
  });
});

describe('Vex\'s own window only', () => {
  it('refuses any other sender', async () => {
    const s = await ready(setup());
    const handlers = new Map();
    const wc = { mainFrame: {} };
    registerTranscribe({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, transcriber: s.t, mainWindowOf: () => ({ isDestroyed: () => false, webContents: wc }) });
    expect([...handlers.keys()].sort()).toEqual(['transcribe:begin', 'transcribe:chunk', 'transcribe:clear', 'transcribe:config', 'transcribe:end', 'transcribe:pick', 'transcribe:set']);
    for (const [, fn] of handlers) await expect(fn({ sender: {}, senderFrame: {} }, 'x')).rejects.toThrow(/main Vex window/);
    expect((await handlers.get('transcribe:config')({ sender: wc, senderFrame: wc.mainFrame })).ready).toBe(true);
  });
});

function expectedModel(s) { return path.join(s.scratch, 'ggml-base.bin'); }
