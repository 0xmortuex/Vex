// Voice control's IPC (main/voice-ipc.js, ipc-schemas.js, ipc-policy.js): Vex's own window only, ids instead of URLs/paths, strict payloads,
// and the test seam that must be IMPOSSIBLE to switch on in a packaged build.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { registerVoice, wavToPcm } = req('../../src/main/voice-ipc.js');
const { validate, schemas } = req('../../src/main/ipc-schemas.js');
const { UI_ONLY_CHANNELS } = req('../../src/main/ipc-policy.js');
const { pcmToWav } = req('../../src/main/voice-engine.js');

const CHANNELS = ['voice:status', 'voice:download', 'voice:cancel-download', 'voice:remove', 'voice:transcribe', 'voice:cancel', 'voice:test-clip'];

function harness({ isPackaged = false, testDir = '' } = {}) {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
  const win = { isDestroyed: () => false, webContents: { mainFrame: { id: 'main' }, send: () => {} } };
  const calls = [];
  const store = {
    status: () => ({ models: {}, engine: {} }),
    download: async (id, cb) => { calls.push(['download', id]); cb && cb({ id, received: 1, total: 2 }); return { ok: true }; },
    cancel: () => true,
    remove: (w) => { calls.push(['remove', w]); return {}; },
  };
  const engine = { transcribe: async (pcm, o) => { calls.push(['transcribe', pcm.length, o]); return { text: 'x' }; }, cancel: () => true };
  registerVoice({ ipcMain, store, engine, mainWindowOf: () => win, isPackaged, testDir });
  const fromMain = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const fromPage = { sender: { other: true }, senderFrame: { id: 'page' } };
  return { handlers, fromMain, fromPage, calls };
}

describe('only the main Vex window may use it', () => {
  it('refuses every channel from anything else', async () => {
    const h = harness();
    for (const ch of ['voice:status', 'voice:download', 'voice:cancel-download', 'voice:remove', 'voice:transcribe', 'voice:cancel']) {
      await expect(Promise.resolve().then(() => h.handlers.get(ch)(h.fromPage, 'base', {}))).rejects.toThrow(/Only the main Vex window/);
    }
    expect(h.calls).toEqual([]);
  });
  it('answers the main window and refuses names that are not ids', async () => {
    const h = harness();
    expect((await h.handlers.get('voice:status')(h.fromMain)).testSeam).toBe(false);
    expect(await h.handlers.get('voice:download')(h.fromMain, 'base')).toEqual({ ok: true });
    await expect(h.handlers.get('voice:download')(h.fromMain, 'https://evil/x.bin')).rejects.toThrow(/Unknown voice file/);
    expect(() => h.handlers.get('voice:remove')(h.fromMain, '../x')).toThrow(/Unknown voice file/);
    expect(() => h.handlers.get('voice:remove')(h.fromMain, 'engine')).toThrow(/together with the models/);
  });
  it('lists every channel in the UI-only policy and in the schema table', () => {
    for (const ch of CHANNELS) {
      expect(UI_ONLY_CHANNELS.has ? UI_ONLY_CHANNELS.has(ch) : UI_ONLY_CHANNELS.includes(ch), ch + ' in the UI-only policy').toBe(true);
      expect(schemas.has(ch), ch + ' has a schema').toBe(true);
    }
  });
});

describe('strict payloads', () => {
  const ok = new Uint8Array(16000 * 2);
  it('accepts exactly the shapes the window sends', () => {
    expect(() => validate('voice:status', [])).not.toThrow();
    expect(() => validate('voice:download', ['engine'])).not.toThrow();
    expect(() => validate('voice:download', ['base'])).not.toThrow();
    expect(() => validate('voice:remove', ['all'])).not.toThrow();
    expect(() => validate('voice:transcribe', [ok, { model: 'small', language: 'tr' }])).not.toThrow();
    expect(() => validate('voice:transcribe', [ok, { model: 'base' }])).not.toThrow();
  });
  it('rejects a path, a URL, a wrong model, a wrong language, text instead of bytes, too little or too much audio', () => {
    expect(() => validate('voice:download', ['C:\\x.bin'])).toThrow();
    expect(() => validate('voice:download', ['https://huggingface.co/x'])).toThrow();
    expect(() => validate('voice:remove', ['engine'])).toThrow();
    expect(() => validate('voice:transcribe', [ok, { model: 'large' }])).toThrow();
    expect(() => validate('voice:transcribe', [ok, { model: 'base', language: 'fr' }])).toThrow();
    expect(() => validate('voice:transcribe', ['AAAA', { model: 'base' }])).toThrow();
    expect(() => validate('voice:transcribe', [new Uint8Array(100), { model: 'base' }])).toThrow();
    expect(() => validate('voice:transcribe', [new Uint8Array(16000 * 2 * 61), { model: 'base' }])).toThrow();
    expect(() => validate('voice:transcribe', [ok])).toThrow();
    expect(() => validate('voice:status', ['extra'])).toThrow();
  });
});

describe('the test seam can not exist in a packaged build', () => {
  const dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'vex-seam-'));
  nodeFs.writeFileSync(path.join(dir, 'hello.wav'), pcmToWav(new Uint8Array(16000 * 2).fill(1)));

  it('is not registered when the app is packaged, whatever the environment says', async () => {
    const h = harness({ isPackaged: true, testDir: dir });
    expect(h.handlers.has('voice:test-clip')).toBe(false);
    expect((await h.handlers.get('voice:status')(h.fromMain)).testSeam).toBe(false);
  });
  it('is not registered without a folder, even in a source run', () => {
    expect(harness({ isPackaged: false, testDir: '' }).handlers.has('voice:test-clip')).toBe(false);
  });
  it('in a source run with a folder it reads a plain .wav name from that folder only', async () => {
    const h = harness({ isPackaged: false, testDir: dir });
    expect((await h.handlers.get('voice:status')(h.fromMain)).testSeam).toBe(true);
    const pcm = await h.handlers.get('voice:test-clip')(h.fromMain, 'hello.wav');
    expect(pcm.length).toBe(16000 * 2);
    for (const bad of ['..\\x.wav', '../x.wav', 'C:\\a.wav', 'a/b.wav', 'hello.txt', '']) {
      expect(() => h.handlers.get('voice:test-clip')(h.fromMain, bad), bad).toThrow(/plain file name/);
    }
    await expect(Promise.resolve().then(() => h.handlers.get('voice:test-clip')(h.fromPage, 'hello.wav'))).rejects.toThrow(/Only the main Vex window/);
  });
  it('main.js decides it from app.isPackaged and nothing else', () => {
    const src = nodeFs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    expect(src).toMatch(/registerVoice\(\{[^}]*isPackaged: app\.isPackaged[^}]*testDir: process\.env\.VEX_VOICE_TEST_DIR/);
  });
  it('wavToPcm refuses other formats', () => {
    const stereo = Buffer.from(pcmToWav(new Uint8Array(100)));
    stereo.writeUInt16LE(2, 22);
    expect(() => wavToPcm(stereo)).toThrow(/16 kHz, mono, 16-bit/);
    expect(() => wavToPcm(Buffer.from('nope'))).toThrow(/not a WAV/);
  });
});
