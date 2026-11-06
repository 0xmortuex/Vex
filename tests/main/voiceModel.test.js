// Voice control's pinned download (main/voice-model.js), against a LOCAL test server: no internet, no real model. What is proved:
// a file with the right size and SHA-256 is installed, a wrong hash / size / host is rejected and deleted, progress and cancel work,
// the engine zip is unpacked allow-list only, a model changed after the download is refused, and Delete removes everything.
// Also: the real catalogue's pins are well formed and name only the expected hosts.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import nodeFs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const req = createRequire(import.meta.url);
const { createVoiceStore, ENGINE, MODELS, hostAllowed } = req('../../src/main/voice-model.js');
const AdmZip = req('adm-zip');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const modelBytes = Buffer.alloc(300000, 3);
const zip = new AdmZip();
zip.addFile('Release/whisper-cli.exe', Buffer.from('MZ-cli'));
zip.addFile('Release/whisper.dll', Buffer.from('MZ-whisper'));
zip.addFile('Release/ggml.dll', Buffer.from('MZ-ggml'));
zip.addFile('Release/ggml-cpu-haswell.dll', Buffer.from('MZ-cpu'));
zip.addFile('Release/main.exe', Buffer.from('should not be written'));
zip.addFile('Release/whisper-server.exe', Buffer.from('a server: never extracted'));
zip.addFile('../evil.dll', Buffer.from('path trick'));
const zipBytes = zip.toBuffer();

let server, base, behaviour = {};
const dirs = [];
const tmp = () => { const d = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'vex-vm-')); dirs.push(d); return d; };

beforeAll(async () => {
  server = http.createServer((rq, rs) => {
    const send = (buf, extra = {}) => { rs.writeHead(200, { 'content-length': extra.length ?? buf.length }); rs.end(buf); };
    if (rq.url === '/model.bin') return send(behaviour.model || modelBytes);
    if (rq.url === '/engine.zip') return send(behaviour.zip || zipBytes);
    if (rq.url === '/slow.bin') {
      rs.writeHead(200, { 'content-length': modelBytes.length });
      let at = 0;
      const t = setInterval(() => { if (at >= modelBytes.length) { clearInterval(t); rs.end(); } else { rs.write(modelBytes.subarray(at, at + 20000)); at += 20000; } }, 25);
      rq.on('close', () => clearInterval(t));
      return;
    }
    if (rq.url === '/redirect') { rs.writeHead(302, { location: 'http://localhost:' + server.address().port + '/model.bin' }); return rs.end(); }
    if (rq.url === '/missing') { rs.writeHead(404); return rs.end('no'); }
    rs.writeHead(500); rs.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
afterAll(() => new Promise(r => server.close(r)));
afterEach(() => { behaviour = {}; for (const d of dirs.splice(0)) nodeFs.rmSync(d, { recursive: true, force: true }); });

const catalogue = (over = {}) => ({
  engine: { id: 'engine', label: 'engine', url: base + '/engine.zip', bytes: zipBytes.length, sha256: sha(zipBytes), hosts: ['127.0.0.1'] },
  models: { base: { id: 'base', label: 'Base', note: 'n', file: 'ggml-base-q5_1.bin', url: base + '/model.bin', bytes: modelBytes.length, sha256: sha(modelBytes), hosts: ['127.0.0.1'] }, ...over },
});
const store = (cat = catalogue()) => { const dir = tmp(); return { dir, s: createVoiceStore({ dir, fetchImpl: (u, i) => fetch(u, i), catalogue: cat }) }; };

describe('a good download', () => {
  it('installs the model when size and SHA-256 match, and reports progress ending at the total', async () => {
    const { dir, s } = store();
    const seen = [];
    expect(s.status().models.base.installed).toBe(false);
    const r = await s.download('base', (p) => seen.push(p));
    expect(r).toEqual({ ok: true });
    expect(nodeFs.readFileSync(path.join(dir, 'models', 'ggml-base-q5_1.bin')).equals(modelBytes)).toBe(true);
    expect(nodeFs.existsSync(path.join(dir, 'models', 'ggml-base-q5_1.bin.part'))).toBe(false);
    expect(s.status().models.base.installed).toBe(true);
    expect(seen.at(-1)).toMatchObject({ id: 'base', received: modelBytes.length, total: modelBytes.length });
    expect(await s.verifyModel('base')).toBe(true);
  });

  it('unpacks only the allowed engine files and ignores path tricks', async () => {
    const { dir, s } = store();
    expect(s.status().engine.installed).toBe(false);
    await s.download('engine');
    const files = nodeFs.readdirSync(path.join(dir, 'engine')).sort();
    expect(files).toEqual(['engine.json', 'ggml-cpu-haswell.dll', 'ggml.dll', 'whisper-cli.exe', 'whisper.dll']);
    expect(nodeFs.existsSync(path.join(dir, '..', 'evil.dll'))).toBe(false);
    expect(nodeFs.existsSync(path.join(dir, 'engine.zip'))).toBe(false);
    expect(nodeFs.existsSync(path.join(dir, 'engine.zip.part'))).toBe(false);
    expect(JSON.parse(nodeFs.readFileSync(path.join(dir, 'engine', 'engine.json'), 'utf8')).sha256).toBe(sha(zipBytes));
    expect(s.status().engine.installed).toBe(true);
  });

  it('follows a redirect when the final host is an allowed one', async () => {
    const { s } = store(catalogue({ base: { id: 'base', label: 'Base', note: 'n', file: 'm.bin', url: base + '/redirect', bytes: modelBytes.length, sha256: sha(modelBytes), hosts: ['127.0.0.1', 'localhost'] } }));
    expect(await s.download('base')).toEqual({ ok: true });
  });
});

describe('a bad download is refused, deleted and never used', () => {
  it('rejects a file whose SHA-256 does not match, and leaves nothing behind', async () => {
    const tampered = Buffer.from(modelBytes); tampered[1000] = 99;
    behaviour = { model: tampered };
    const { dir, s } = store();
    await expect(s.download('base')).rejects.toThrow(/did not match its pinned checksum/);
    expect(nodeFs.readdirSync(path.join(dir, 'models'))).toEqual([]);
    expect(s.status().models.base.installed).toBe(false);
    expect(s.status().busy).toBe(null);
  });

  it('rejects a file of a different size (announced by the server)', async () => {
    behaviour = { model: Buffer.alloc(modelBytes.length + 10, 3) };
    const { dir, s } = store();
    await expect(s.download('base')).rejects.toThrow(/bytes, not the/);
    expect(nodeFs.readdirSync(path.join(dir, 'models'))).toEqual([]);
  });

  it('rejects a body that is shorter than announced, or longer', async () => {
    const { s: a } = store();
    behaviour = { model: modelBytes.subarray(0, 1000) };
    await expect(a.download('base')).rejects.toThrow(/bytes, not the|ended after/);
    // A server that lies in content-length is caught by the running count.
    const lying = http.createServer((q, r) => { r.writeHead(200, { 'content-length': modelBytes.length }); r.end(modelBytes); });
    await new Promise(r => lying.listen(0, '127.0.0.1', r));
    const url = 'http://127.0.0.1:' + lying.address().port + '/';
    const { dir, s } = store(catalogue({ base: { id: 'base', label: 'B', note: 'n', file: 'm.bin', url, bytes: modelBytes.length - 5, sha256: sha(modelBytes.subarray(0, modelBytes.length - 5)), hosts: ['127.0.0.1'] } }));
    await expect(s.download('base')).rejects.toThrow(/bytes, not the/);
    expect(nodeFs.readdirSync(path.join(dir, 'models'))).toEqual([]);
    await new Promise(r => lying.close(r));
  });

  it('rejects a download that ends up on a host that is not in the pin', async () => {
    const { dir, s } = store(catalogue({ base: { id: 'base', label: 'Base', note: 'n', file: 'm.bin', url: base + '/redirect', bytes: modelBytes.length, sha256: sha(modelBytes), hosts: ['127.0.0.1'] } }));
    await expect(s.download('base')).rejects.toThrow(/unexpected host \(localhost\)/);
    expect(nodeFs.readdirSync(path.join(dir, 'models'))).toEqual([]);
  });

  it('rejects an HTTP error', async () => {
    const { s } = store(catalogue({ base: { id: 'base', label: 'Base', note: 'n', file: 'm.bin', url: base + '/missing', bytes: 10, sha256: sha('x'), hosts: ['127.0.0.1'] } }));
    await expect(s.download('base')).rejects.toThrow(/answered 404/);
  });

  it('rejects an engine zip that fails its hash, or that has no whisper-cli.exe', async () => {
    const flipped = Buffer.from(zipBytes); flipped[10] ^= 0xff;        // same size, different bytes
    behaviour = { zip: flipped };
    const a = store();
    await expect(a.s.download('engine')).rejects.toThrow(/pinned checksum/);
    expect(nodeFs.existsSync(path.join(a.dir, 'engine'))).toBe(false);
    const empty = new AdmZip(); empty.addFile('Release/readme.txt', Buffer.from('x'));
    const eb = empty.toBuffer();
    behaviour = { zip: eb };
    const b = store({ ...catalogue(), engine: { id: 'engine', label: 'e', url: base + '/engine.zip', bytes: eb.length, sha256: sha(eb), hosts: ['127.0.0.1'] } });
    await expect(b.s.download('engine')).rejects.toThrow(/does not contain whisper-cli.exe/);
    expect(nodeFs.existsSync(path.join(b.dir, 'engine'))).toBe(false);
  });

  it('refuses a model that was changed on disk after it was installed', async () => {
    const { dir, s } = store();
    await s.download('base');
    expect(await s.verifyModel('base')).toBe(true);
    const f = path.join(dir, 'models', 'ggml-base-q5_1.bin');
    const changed = Buffer.from(modelBytes); changed[5] = 1;
    nodeFs.writeFileSync(f, changed);
    await expect(s.verifyModel('base')).rejects.toThrow(/does not match its pinned checksum/);
    nodeFs.writeFileSync(f, modelBytes.subarray(0, 10));
    await expect(s.verifyModel('base')).rejects.toThrow(/wrong size/);
  });
});

describe('progress, cancel, one at a time, delete', () => {
  it('cancel() stops a running download, deletes the partial file and reports cancelled', async () => {
    const { dir, s } = store(catalogue({ base: { id: 'base', label: 'Base', note: 'n', file: 'm.bin', url: base + '/slow.bin', bytes: modelBytes.length, sha256: sha(modelBytes), hosts: ['127.0.0.1'] } }));
    let first;
    const p = s.download('base', (pr) => { first = first || pr; if (pr.received > 0) s.cancel(); });
    expect(await p).toEqual({ ok: false, cancelled: true });
    expect(nodeFs.readdirSync(path.join(dir, 'models'))).toEqual([]);
    expect(s.status().busy).toBe(null);
    expect(s.cancel()).toBe(false);
  });

  it('allows only one download at a time', async () => {
    const { s } = store(catalogue({ base: { id: 'base', label: 'Base', note: 'n', file: 'm.bin', url: base + '/slow.bin', bytes: modelBytes.length, sha256: sha(modelBytes), hosts: ['127.0.0.1'] } }));
    const p = s.download('base');
    await expect(s.download('engine')).rejects.toThrow(/already running/);
    expect(s.status().busy).toBe('base');
    await p;
  });

  it('refuses ids it does not know, so a window can never name a URL or a path', async () => {
    const { s } = store();
    await expect(s.download('../../etc/passwd')).rejects.toThrow(/Unknown voice file/);
    expect(() => s.modelPath('huge')).toThrow(/Unknown voice model/);
    expect(() => s.remove('..\\x')).toThrow(/Unknown voice model/);
  });

  it('"Delete voice model" removes the engine, the models and any partial file', async () => {
    const { dir, s } = store();
    await s.download('engine'); await s.download('base');
    nodeFs.writeFileSync(path.join(dir, 'models', 'ggml-base-q5_1.bin.part'), 'x');
    const st = s.remove('all');
    expect(st.engine.installed).toBe(false);
    expect(st.models.base.installed).toBe(false);
    expect(nodeFs.readdirSync(path.join(dir, 'models'))).toEqual([]);
    expect(nodeFs.existsSync(path.join(dir, 'engine'))).toBe(false);
  });

  it('will not delete while a download is running', async () => {
    const { s } = store(catalogue({ base: { id: 'base', label: 'Base', note: 'n', file: 'm.bin', url: base + '/slow.bin', bytes: modelBytes.length, sha256: sha(modelBytes), hosts: ['127.0.0.1'] } }));
    const p = s.download('base');
    expect(() => s.remove('all')).toThrow(/Cancel the running download/);
    await p;
  });
});

describe('the real catalogue', () => {
  it('pins https URLs on the expected hosts with 64-hex SHA-256 values and plain sizes', () => {
    for (const e of [ENGINE, ...Object.values(MODELS)]) {
      expect(e.url).toMatch(/^https:\/\//);
      expect(hostAllowed(e.url, e.hosts)).toBe(true);
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isInteger(e.bytes) && e.bytes > 1000000).toBe(true);
    }
    expect(ENGINE.url).toContain('github.com/ggml-org/whisper.cpp/releases/download/b5454/');
    // Hugging Face is pinned to a commit, not a branch, so the bytes can never change.
    for (const m of Object.values(MODELS)) expect(m.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
  });
  it('names the three measured values', () => {
    expect(MODELS.base.sha256).toBe('422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898');
    expect(MODELS.small.sha256).toBe('ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb');
    expect(ENGINE.sha256).toBe('6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb');
  });
  it('matches hosts by suffix on a dot, not by substring', () => {
    expect(hostAllowed('https://cdn-lfs.hf.co/x', ['hf.co'])).toBe(true);
    expect(hostAllowed('https://evilhf.co/x', ['hf.co'])).toBe(false);
    expect(hostAllowed('https://hf.co.evil.com/x', ['hf.co'])).toBe(false);
    expect(hostAllowed('not a url', ['hf.co'])).toBe(false);
  });
});
