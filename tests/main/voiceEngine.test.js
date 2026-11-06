// Voice control's engine runner (main/voice-engine.js) against a FAKE engine process. Real child processes and a real Windows
// named pipe; no model, no network. What is proved here: the audio reaches the engine, it never touches the disk or a log, the
// process has no shell and a bare environment, a hung engine is killed, a second clip is refused while one runs, and the limits hold.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';

const req = createRequire(import.meta.url);
const { createVoiceEngine, pcmToWav, cleanText, MIN_BYTES, MAX_BYTES } = req('../../src/main/voice-engine.js');
const FAKE = path.resolve(__dirname, '../fixtures/fake-voice-engine.js');

const pcm = (seconds = 1, fill = 7) => new Uint8Array(Math.round(16000 * 2 * seconds)).fill(fill);
const fakeStore = (over = {}) => ({
  status: () => ({ engine: { installed: true }, models: { base: { installed: true }, small: { installed: false } } }),
  verifyModel: async () => true,
  modelPath: (id) => 'C:\\voice\\models\\' + id + '.bin',
  enginePath: () => 'C:\\voice\\engine\\whisper-cli.exe',
  engineDir: os.tmpdir(),
  ...over,
});

// Runs the fake engine through node; remembers how it was started.
function launcher(mode = 'ok') {
  const seen = [];
  const spawnImpl = (exe, args, opts) => {
    seen.push({ exe, args, opts });
    return cp.spawn(process.execPath, [FAKE, ...args], { ...opts, env: { ...opts.env, FAKE_VOICE_MODE: mode } });
  };
  return { seen, spawnImpl };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

afterEach(() => { vi.restoreAllMocks(); });

describe('the audio reaches the engine through a pipe', () => {
  it('hands the whole clip over and returns the engine text', async () => {
    const { spawnImpl, seen } = launcher();
    const engine = createVoiceEngine({ store: fakeStore(), spawnImpl });
    const clip = pcm(1.5, 9);
    const out = await engine.transcribe(clip, { model: 'base', language: 'tr' });
    const samples = clip.length / 2;
    let sum = 0;
    for (const b of pcmToWav(clip).subarray(44)) sum = (sum + b) % 1000003;
    expect(out.text).toBe(`heard ${samples} samples sum ${sum} lang tr`);
    expect(out.language).toBe('tr');
    expect(seen).toHaveLength(1);
    expect(engine.busy()).toBe(false);
  });

  it('starts the engine with an argument list, no shell, a bare environment and a pipe instead of a file', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.invalid:1';
    try {
      const { spawnImpl, seen } = launcher();
      await createVoiceEngine({ store: fakeStore(), spawnImpl }).transcribe(pcm(), { model: 'base' });
      const { args, opts } = seen[0];
      expect(opts.shell).toBe(false);
      expect(opts.windowsHide).toBe(true);
      expect(opts.stdio[0]).toBe('ignore');
      expect(Object.keys(opts.env).sort()).toEqual(['PATH', 'SystemRoot']);
      const f = args[args.indexOf('-f') + 1];
      expect(f).toMatch(process.platform === 'win32' ? /^\\\\\.\\pipe\\vex-voice-[0-9a-f]{32}$/ : /vex-voice-[0-9a-f]{32}\.sock$/);
      expect(args.join(' ')).not.toMatch(/\.wav/i);
      expect(args.slice(0, 2)).toEqual(['-m', 'C:\\voice\\models\\base.bin']);
    } finally { delete process.env.HTTPS_PROXY; }
  });

  it('uses a different unguessable pipe for every clip', async () => {
    const { spawnImpl, seen } = launcher();
    const engine = createVoiceEngine({ store: fakeStore(), spawnImpl });
    await engine.transcribe(pcm(), { model: 'base' });
    await engine.transcribe(pcm(), { model: 'base' });
    expect(seen[0].args[3]).not.toBe(seen[1].args[3]);
  });
});

describe('the audio never reaches the disk or a log', () => {
  it('writes no file at all while it transcribes (no temp WAV, no stream, no append)', async () => {
    const fs = req('node:fs');
    const spies = ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'createWriteStream', 'writeSync', 'openSync', 'mkdtempSync', 'copyFileSync', 'renameSync']
      .map(name => vi.spyOn(fs, name));
    const pspies = ['writeFile', 'appendFile', 'open', 'mkdtemp', 'copyFile'].map(name => vi.spyOn(fs.promises, name));
    const { spawnImpl } = launcher();
    const before = nodeFs.readdirSync(os.tmpdir()).length;
    const out = await createVoiceEngine({ store: fakeStore(), spawnImpl }).transcribe(pcm(1, 5), { model: 'base' });
    expect(out.text).toContain('heard 16000 samples');
    for (const s of [...spies, ...pspies]) expect(s, 'a file function was called').not.toHaveBeenCalled();
    expect(nodeFs.readdirSync(os.tmpdir()).length).toBe(before);
  });

  it('logs nothing, neither on success nor on failure', async () => {
    const logs = ['log', 'info', 'warn', 'error', 'debug'].map(k => vi.spyOn(console, k).mockImplementation(() => {}));
    const ok = launcher();
    await createVoiceEngine({ store: fakeStore(), spawnImpl: ok.spawnImpl }).transcribe(pcm(), { model: 'base' });
    const bad = launcher('fail');
    await expect(createVoiceEngine({ store: fakeStore(), spawnImpl: bad.spawnImpl }).transcribe(pcm(), { model: 'base' })).rejects.toThrow(/code 3/);
    for (const l of logs) expect(l).not.toHaveBeenCalled();
  });
});

describe('the process lifecycle', () => {
  it('kills an engine that does not answer in time', async () => {
    const { spawnImpl } = launcher('hang');
    const engine = createVoiceEngine({ store: fakeStore(), spawnImpl, timeoutMs: 400 });
    const p = engine.transcribe(pcm(), { model: 'base' });
    await vi.waitFor(() => expect(engine.pid()).toBeTruthy());
    const pid = engine.pid();
    await expect(p).rejects.toThrow(/longer than/);
    expect(engine.busy()).toBe(false);
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
  });

  it('cancel() stops a running engine at once and says it was cancelled', async () => {
    const { spawnImpl } = launcher('hang');
    const engine = createVoiceEngine({ store: fakeStore(), spawnImpl });
    const p = engine.transcribe(pcm(), { model: 'base' });
    await vi.waitFor(() => expect(engine.pid()).toBeTruthy());
    const pid = engine.pid();
    expect(engine.cancel()).toBe(true);
    await expect(p).rejects.toMatchObject({ cancelled: true });
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
    expect(engine.cancel()).toBe(false);
  });

  it('dispose() (app quit) kills the engine too', async () => {
    const { spawnImpl } = launcher('hang');
    const engine = createVoiceEngine({ store: fakeStore(), spawnImpl });
    const p = engine.transcribe(pcm(), { model: 'base' });
    await vi.waitFor(() => expect(engine.pid()).toBeTruthy());
    engine.dispose();
    await expect(p).rejects.toMatchObject({ cancelled: true });
  });

  it('refuses a second clip while one is being worked on', async () => {
    const { spawnImpl } = launcher('hang');
    const engine = createVoiceEngine({ store: fakeStore(), spawnImpl, timeoutMs: 5000 });
    const first = engine.transcribe(pcm(), { model: 'base' });
    await vi.waitFor(() => expect(engine.busy()).toBe(true));
    await expect(engine.transcribe(pcm(), { model: 'base' })).rejects.toThrow(/already listening/);
    engine.cancel();
    await expect(first).rejects.toMatchObject({ cancelled: true });
  });

  it('stops an engine that prints far too much', async () => {
    const { spawnImpl } = launcher('flood');
    await expect(createVoiceEngine({ store: fakeStore(), spawnImpl }).transcribe(pcm(), { model: 'base' })).rejects.toThrow(/too much/);
  });

  it('reports a failing engine with its exit code and message', async () => {
    const { spawnImpl } = launcher('fail');
    await expect(createVoiceEngine({ store: fakeStore(), spawnImpl }).transcribe(pcm(), { model: 'base' })).rejects.toThrow(/code 3.*model is damaged/);
  });

  it('says so when the engine program cannot start', async () => {
    const spawnImpl = (exe, args, opts) => cp.spawn(path.join(os.tmpdir(), 'no-such-engine-' + Date.now() + '.exe'), args, opts);
    await expect(createVoiceEngine({ store: fakeStore(), spawnImpl }).transcribe(pcm(), { model: 'base' })).rejects.toThrow(/could not start/);
  });
});

describe('limits and checks', () => {
  const engine = () => createVoiceEngine({ store: fakeStore(), spawnImpl: launcher().spawnImpl });
  it('refuses a clip that is too short, too long or not 16-bit', async () => {
    await expect(engine().transcribe(new Uint8Array(MIN_BYTES - 2), { model: 'base' })).rejects.toThrow(/too short/);
    await expect(engine().transcribe(new Uint8Array(MAX_BYTES + 2), { model: 'base' })).rejects.toThrow(/60 seconds/);
    await expect(engine().transcribe(new Uint8Array(MIN_BYTES + 1), { model: 'base' })).rejects.toThrow(/16-bit/);
    await expect(engine().transcribe('not bytes', { model: 'base' })).rejects.toThrow(/bytes/);
  });
  it('refuses an unknown language', async () => {
    await expect(engine().transcribe(pcm(), { model: 'base', language: 'xx' })).rejects.toThrow(/Unknown language/);
  });
  it('refuses a model or engine that is not downloaded', async () => {
    await expect(engine().transcribe(pcm(), { model: 'small' })).rejects.toThrow(/model is not downloaded/);
    const noEngine = createVoiceEngine({ store: fakeStore({ status: () => ({ engine: { installed: false }, models: { base: { installed: true } } }) }), spawnImpl: launcher().spawnImpl });
    await expect(noEngine.transcribe(pcm(), { model: 'base' })).rejects.toThrow(/engine is not downloaded/);
  });
  it('does not run off Windows', async () => {
    const e = createVoiceEngine({ store: fakeStore(), spawnImpl: launcher().spawnImpl, platform: 'linux' });
    await expect(e.transcribe(pcm(), { model: 'base' })).rejects.toThrow(/Windows/);
  });
  it('checks the model file before using it', async () => {
    const e = createVoiceEngine({ store: fakeStore({ verifyModel: async () => { throw new Error('does not match its pinned checksum'); } }), spawnImpl: launcher().spawnImpl });
    await expect(e.transcribe(pcm(), { model: 'base' })).rejects.toThrow(/pinned checksum/);
  });
});

describe('the small pure parts', () => {
  it('builds a 16 kHz mono 16-bit WAV image', () => {
    const w = pcmToWav(new Uint8Array([1, 0, 2, 0]));
    expect(w.toString('latin1', 0, 4)).toBe('RIFF');
    expect(w.readUInt32LE(24)).toBe(16000);
    expect(w.readUInt16LE(22)).toBe(1);
    expect(w.readUInt16LE(34)).toBe(16);
    expect(w.readUInt32LE(40)).toBe(4);
    expect([...w.subarray(44)]).toEqual([1, 0, 2, 0]);
  });
  it('drops the markers whisper prints for silence and sound effects', () => {
    expect(cleanText(' [BLANK_AUDIO]\n')).toBe('');
    expect(cleanText('(music)')).toBe('');
    expect(cleanText(' Open downloads. \n')).toBe('Open downloads.');
    expect(cleanText('...')).toBe('');
  });
});
