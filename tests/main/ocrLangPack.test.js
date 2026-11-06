// Copy Text from Image: the English + Turkish language data (src/main/ocr-lang-pack.js). Nothing here touches the network:
// the fetch is a fake that serves bytes from memory.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const pack = require('../../src/main/ocr-lang-pack');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const A = Buffer.from('english data '.repeat(2000)), B = Buffer.from('turkish data '.repeat(1500));
const catalogue = { hosts: ['cdn.example'], files: [
  { code: 'eng', file: 'eng.traineddata.gz', url: 'https://cdn.example/eng.gz', bytes: A.length, sha256: sha(A) },
  { code: 'tur', file: 'tur.traineddata.gz', url: 'https://cdn.example/tur.gz', bytes: B.length, sha256: sha(B) },
] };

function response(bytes, { status = 200, url = 'https://cdn.example/x', announce = bytes.length, chunk = 700 } = {}) {
  let at = 0;
  return {
    ok: status >= 200 && status < 300, status, url,
    headers: { get: (k) => (k.toLowerCase() === 'content-length' ? String(announce) : null) },
    body: { getReader: () => ({ read: async () => { if (at >= bytes.length) return { done: true }; const v = bytes.subarray(at, at += chunk); return { done: false, value: new Uint8Array(v) }; } }) },
  };
}

let dir, calls;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-ocrpack-')); calls = []; });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const store = (serve) => pack.createOcrLangStore({ dir: path.join(dir, 'ocr-lang'), catalogue, now: (() => { let t = 0; return () => (t += 1000); })(),
  fetchImpl: async (url, init) => { calls.push(url); return serve(url, init); } });
const good = (url) => response(url.endsWith('eng.gz') ? A : B);

describe('the pinned catalogue', () => {
  it('names two files at an exact package version on one documented host, with a size and a SHA-256', () => {
    expect(pack.FILES.map(f => f.code)).toEqual(['eng', 'tur']);
    expect(pack.HOSTS).toEqual(['cdn.jsdelivr.net']);
    for (const f of pack.FILES) {
      expect(new URL(f.url).hostname).toBe('cdn.jsdelivr.net');
      expect(f.url).toMatch(/@tesseract\.js-data\/(?:eng|tur)@1\.0\.0\/4\.0\.0_best_int\/(?:eng|tur)\.traineddata\.gz$/);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.bytes).toBeGreaterThan(1000000);
    }
    expect(pack.FILES.reduce((n, f) => n + f.bytes, 0)).toBe(5094164);
  });
});

describe('download', () => {
  it('fetches both, checks them, reports progress, and is installed afterwards', async () => {
    const s = store(good);
    expect(s.status().installed).toBe(false);
    const ticks = [];
    const st = await s.download(p => ticks.push(p));
    expect(st.installed).toBe(true);
    expect(calls).toEqual(['https://cdn.example/eng.gz', 'https://cdn.example/tur.gz']);
    expect(ticks.at(-1)).toMatchObject({ code: 'tur', received: A.length + B.length, total: A.length + B.length });
    expect(ticks.every((p, i) => i === 0 || p.received >= ticks[i - 1].received)).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'ocr-lang')).sort()).toEqual(['eng.traineddata.gz', 'tur.traineddata.gz']);
  });
  it('does not fetch what is already in place', async () => {
    const s = store(good);
    await s.download();
    calls.length = 0;
    await s.download();
    expect(calls).toEqual([]);
  });
  it('refuses a file whose bytes are not the pinned ones, deletes it, and says so', async () => {
    const evil = Buffer.from(A); evil[10] ^= 0xff;
    const s = store((url) => response(url.endsWith('eng.gz') ? evil : B));
    await expect(s.download()).rejects.toThrow(/checksum/);
    expect(s.status().installed).toBe(false);
    expect(fs.readdirSync(path.join(dir, 'ocr-lang'))).toEqual([]);
  });
  it('refuses a wrong announced size, an answer that is too long or short, a failed answer and a redirect to another host', async () => {
    await expect(store(() => response(A, { announce: A.length + 5 })).download()).rejects.toThrow(/expected/);
    await expect(store(() => response(Buffer.concat([A, Buffer.from('x')]), { announce: A.length })).download()).rejects.toThrow(/larger/);
    await expect(store(() => response(A.subarray(0, 100), { announce: A.length })).download()).rejects.toThrow(/ended after/);
    await expect(store(() => response(A, { status: 404 })).download()).rejects.toThrow(/404/);
    await expect(store(() => response(A, { url: 'https://evil.example/eng.gz' })).download()).rejects.toThrow(/unexpected host/);
    expect(fs.readdirSync(path.join(dir, 'ocr-lang')).filter(f => !f.endsWith('.part') || true)).toEqual([]);
  });
  it('one at a time, and cancel stops it and leaves nothing behind', async () => {
    let release;
    const gate = new Promise(r => (release = r));
    const s = store(async (url, init) => {
      const r = response(A);
      const reader = r.body.getReader();
      r.body.getReader = () => ({ read: async () => { await gate; if (init.signal.aborted) throw new DOMException('aborted', 'AbortError'); return reader.read(); } });
      return r;
    });
    const first = s.download();
    await new Promise(r => setTimeout(r, 5));
    await expect(s.download()).rejects.toThrow(/already/);
    expect(s.status().busy).toBe(true);
    expect(s.cancel()).toBe(true);
    release();
    await expect(first).rejects.toThrow();
    expect(s.status().busy).toBe(false);
    expect(s.status().installed).toBe(false);
    expect(fs.readdirSync(path.join(dir, 'ocr-lang'))).toEqual([]);
    expect(s.cancel()).toBe(false);
  });
});

describe('read and remove', () => {
  it('reads a language only after checking it, and refuses an unknown one, a missing one and a changed one', async () => {
    const s = store(good);
    expect(() => s.read('tur')).toThrow(/not downloaded/);
    await s.download();
    expect(Buffer.compare(s.read('eng'), A)).toBe(0);
    expect(() => s.read('deu')).toThrow(/Unknown/);
    const f = path.join(dir, 'ocr-lang', 'tur.traineddata.gz');
    const tampered = Buffer.from(B); tampered[3] ^= 1;
    fs.writeFileSync(f, tampered);
    fs.utimesSync(f, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    expect(() => s.read('tur')).toThrow(/checksum/);
    fs.writeFileSync(f, B.subarray(0, 50));
    expect(() => s.read('tur')).toThrow(/expected size/);
  });
  it('remove deletes the files and the install state goes back', async () => {
    const s = store(good);
    await s.download();
    expect(s.remove().installed).toBe(false);
    expect(fs.readdirSync(path.join(dir, 'ocr-lang'))).toEqual([]);
  });
});

describe('the channels', () => {
  function fake() {
    const handlers = new Map();
    const w = { isDestroyed: () => false, webContents: { mainFrame: { id: 1 }, send: vi.fn() } };
    w.webContents.mainFrame = {};
    const ipcMain = { handle: (c, fn) => handlers.set(c, fn) };
    const s = store(good);
    pack.registerOcrLang({ ipcMain, store: s, mainWindowOf: () => w });
    const mainEvent = { sender: w.webContents, senderFrame: w.webContents.mainFrame };
    const otherEvent = { sender: { id: 2 }, senderFrame: {} };
    return { handlers, w, mainEvent, otherEvent, s };
  }
  it('registers exactly the five channels', () => {
    expect([...fake().handlers.keys()].sort()).toEqual(['ocrlang:cancel', 'ocrlang:download', 'ocrlang:read', 'ocrlang:remove', 'ocrlang:status']);
  });
  it('downloading, cancelling and removing are the main window’s; reading and status work from any Vex window', async () => {
    const t = fake();
    await expect(t.handlers.get('ocrlang:download')(t.otherEvent)).rejects.toThrow(/main Vex window/);
    expect(() => t.handlers.get('ocrlang:cancel')(t.otherEvent)).toThrow(/main Vex window/);
    expect(() => t.handlers.get('ocrlang:remove')(t.otherEvent)).toThrow(/main Vex window/);
    expect(t.handlers.get('ocrlang:status')(t.otherEvent).installed).toBe(false);
    const st = await t.handlers.get('ocrlang:download')(t.mainEvent);
    expect(st.installed).toBe(true);
    expect(t.w.webContents.send).toHaveBeenCalledWith('ocrlang:progress', expect.objectContaining({ total: A.length + B.length }));
    const bytes = t.handlers.get('ocrlang:read')(t.otherEvent, 'eng');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(A.length);
    expect(() => t.handlers.get('ocrlang:read')(t.otherEvent, '../../etc/passwd')).toThrow(/Unknown/);
  });
  it('are described, exposed, limited to Vex’s own window and closed to downloads in a private window', () => {
    const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
    expect(read('src/main/ipc-schemas.js')).toMatch(/define\('ocrlang:read', \[oneOf\(\['eng', 'tur'\]\)\]\)/);
    expect(read('src/preload.js')).toMatch(/invoke\('ocrlang:download'\)/);
    expect(read('src/preload.js')).toMatch(/subscribe\('ocrlang:progress'/);
    expect(read('src/main/ipc-policy.js')).toMatch(/'ocrlang:status', 'ocrlang:download', 'ocrlang:cancel', 'ocrlang:remove', 'ocrlang:read'/);
    expect(read('src/main/ipc-policy.js')).toMatch(/ocrlang:\(\?:download\|cancel\|remove\)/);
    expect(read('src/main.js')).toMatch(/feature: 'Text-from-image language pack'/);
  });
});
