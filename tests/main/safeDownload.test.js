// The Safe Download Assistant's service (src/main/safe-download.js): settings, the check on a finished download, Quarantine,
// and its place in the download flow and the IPC contract.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSafeDownload } = require('../../src/main/safe-download');
const { createDownloadService } = require('../../src/main/downloads.js');
const { validate, schemas } = require('../../src/main/ipc-schemas.js');
const policy = require('../../src/main/ipc-policy.js');

let dir, noted, downloaded;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-safedl-svc-')); noted = []; downloaded = new Set(); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const MZ = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100, 0x90)]);
function make(over = {}) {
  return createSafeDownload({
    fs, file: path.join(dir, 'safe-download.json'), quarantineDir: path.join(dir, 'quarantine'),
    signatureOf: async () => ({ status: 'NotSigned', signer: '' }),
    isDownloadedFile: (p) => downloaded.has(p), noteFile: (p) => noted.push(p),
    ...over,
  });
}
const put = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); downloaded.add(p); return p; };

describe('settings', () => {
  it('start on, normal, with every check', () => {
    expect(make().get()).toMatchObject({ on: true, strictness: 'normal', checks: { content: true, archives: true, signature: true, source: true } });
  });
  it('are kept between runs', () => {
    const a = make();
    a.set({ strictness: 'strict', checks: { signature: false } });
    a.set({ on: false });
    expect(make().get()).toMatchObject({ on: false, strictness: 'strict', checks: { content: true, signature: false } });
  });
  it('refuse nonsense out loud', () => {
    const a = make();
    expect(() => a.set({ on: 'yes' })).toThrow(/on or off/);
    expect(() => a.set({ strictness: 'extreme' })).toThrow(/relaxed, normal or strict/);
    expect(() => a.set({ checks: { everything: true } })).toThrow(/Unknown check/);
    expect(() => a.set({ checks: { content: 1 } })).toThrow(/on or off/);
    expect(() => a.set(null)).toThrow();
    expect(a.get().strictness).toBe('normal');
  });
  it('a damaged settings file is said in the log and leaves the defaults', () => {
    fs.writeFileSync(path.join(dir, 'safe-download.json'), '{not json');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(make().get().on).toBe(true);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('assess', () => {
  it('returns nothing at all while switched off (the kill switch)', async () => {
    const s = make();
    s.set({ on: false });
    expect(await s.assess({ path: put('invoice.pdf', MZ), fileName: 'invoice.pdf' })).toBeNull();
  });
  it('gives a red verdict for a program named invoice.pdf, with the reasons in both languages', async () => {
    const s = make();
    const v = await s.assess({ path: put('invoice.pdf', MZ), fileName: 'invoice.pdf', url: 'https://example.org/invoice.pdf' });
    expect(v.level).toBe('red');
    expect(v.reasons[0].tr).toBeTruthy();
  });
  it('switching a group of checks off changes the verdict', async () => {
    const s = make();
    s.set({ checks: { content: false } });
    expect((await s.assess({ path: put('invoice.pdf', MZ), fileName: 'invoice.pdf' })).level).toBe('green');
  });
  it('the signature reader is not asked while that check is off', async () => {
    const signatureOf = vi.fn(async () => ({ status: 'Valid', signer: 'X' }));
    const s = make({ signatureOf });
    s.set({ checks: { signature: false } });
    await s.assess({ path: put('setup.exe', MZ), fileName: 'setup.exe' });
    expect(signatureOf).not.toHaveBeenCalled();
  });
  it('the dangerous-site list, the look-alike check and the redirect chain feed the verdict', async () => {
    const s = make({ threatCheck: (u) => (u.includes('bad.example') ? { kind: 'domain' } : null), lookalikeOf: () => '', registrable: (h) => h });
    const v = await s.assess({ path: put('setup.exe', MZ), fileName: 'setup.exe', url: 'https://cdn.example.org/setup.exe', chain: ['https://bad.example/go', 'https://cdn.example.org/setup.exe'] });
    expect(v.level).toBe('red');
    expect(v.reasons.map(r => r.id)).toContain('dangerous-site');
  });
  it('a file that has vanished comes back gray, not clean', async () => {
    const v = await make().assess({ path: path.join(dir, 'gone.pdf'), fileName: 'gone.pdf' });
    expect(v.level).toBe('gray');
  });
});

describe('Quarantine', () => {
  it('moves the file into the quarantine folder under a name that cannot run, and deletes nothing', () => {
    const s = make();
    const p = put('cheat.exe', MZ);
    const r = s.quarantine(p);
    expect(fs.existsSync(p)).toBe(false);
    expect(fs.existsSync(r.path)).toBe(true);
    expect(path.dirname(r.path)).toBe(path.join(dir, 'quarantine'));
    expect(r.name.endsWith('.quarantined')).toBe(true);
    expect(fs.readFileSync(r.path).equals(MZ)).toBe(true);
    expect(noted).toEqual([r.path]);
    expect(s.isQuarantined(r.path)).toBe(true);
    expect(s.isQuarantined(p)).toBe(false);
  });
  it('keeps nothing of a hostile name that could redirect it', () => {
    const s = make();
    const p = put('a b;c.exe', MZ);
    const r = s.quarantine(p);
    expect(path.dirname(r.path)).toBe(path.join(dir, 'quarantine'));
    const rlo = put('fdp\u202Eexe.txt', MZ);
    expect(s.quarantine(rlo).name).not.toMatch(/[\u202A-\u202E]/);
  });
  it('refuses a file Vex did not download, a file already in quarantine and a missing file', () => {
    const s = make();
    const stranger = path.join(dir, 'mine.exe');
    fs.writeFileSync(stranger, MZ);
    expect(() => s.quarantine(stranger)).toThrow(/only does this to files it downloaded/);
    expect(fs.existsSync(stranger)).toBe(true);
    const r = s.quarantine(put('a.exe', MZ));
    downloaded.add(r.path);
    expect(() => s.quarantine(r.path)).toThrow(/already in quarantine/);
    const gone = path.join(dir, 'gone.exe'); downloaded.add(gone);
    expect(() => s.quarantine(gone)).toThrow(/not there/);
    expect(() => s.quarantine('')).toThrow();
  });
  it('two files with the same name both survive', () => {
    const s = make();
    const a = s.quarantine(put('same.exe', Buffer.from('MZa')));
    const b = s.quarantine(put('same.exe', Buffer.from('MZb')));
    expect(a.path).not.toBe(b.path);
    expect(fs.readFileSync(b.path, 'utf8')).toBe('MZb');
  });
  it('isQuarantined is not fooled by a path that climbs out', () => {
    const s = make();
    expect(s.isQuarantined(path.join(dir, 'quarantine', '..', 'x.exe'))).toBe(false);
    expect(s.isQuarantined(path.join(dir, 'quarantine-evil', 'x.exe'))).toBe(false);
    expect(s.isQuarantined('')).toBe(false);
  });
  it('the internet mark goes with the file', () => {
    const move = vi.fn((from, to, doMove) => { doMove(); return { carried: true, kept: true }; });
    const s = make({ motw: { move } });
    s.quarantine(put('a.exe', MZ));
    expect(move).toHaveBeenCalledOnce();
  });
});

describe('in the download flow', () => {
  function harness(assessFile) {
    const sent = [];
    const service = createDownloadService({
      app: { getPath: () => 'C:/downloads' },
      secureSessions: { owner: () => null, partitionOf: () => 'persist:main' },
      broadcast: (channel, data) => sent.push({ channel, data }),
      ipcMain: { handle: () => {} },
      assessFile,
    });
    const session = { on: (name, fn) => { session._will = fn; } };
    service.wireDownloadsOnSession(session, 'test');
    return { service, session, sent };
  }
  function item(url = 'https://example.org/invoice.pdf') {
    const handlers = {};
    return {
      chosen: '', getFilename: () => 'invoice.pdf', getURL: () => url, getURLChain: () => [url], getTotalBytes: () => 10, getReceivedBytes: () => 10,
      getSavePath() { return this.chosen; }, setSavePath: vi.fn(), setSaveDialogOptions: vi.fn(), isPaused: () => false, canResume: () => false,
      on: (n, fn) => { handlers[n] = fn; }, once: (n, fn) => { handlers[n] = fn; }, fire: (n, ...a) => handlers[n]?.(null, ...a),
    };
  }
  const tick = () => new Promise(r => setTimeout(r, 0));
  it('the verdict is on the download-complete event, and the file path and chain were handed to the check', async () => {
    const verdict = { level: 'red', headline: { en: 'x', tr: 'y' }, reasons: [], top: null, canQuarantine: true, noPreview: false };
    const assessFile = vi.fn(async () => verdict);
    const h = harness(assessFile);
    const it1 = item();
    h.session._will({ preventDefault() {} }, it1, null);
    it1.fire('done', 'completed');
    await tick();
    const done = h.sent.find(s => s.channel === 'download-complete').data;
    expect(done.safe).toBe(verdict);
    expect(assessFile).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'invoice.pdf', url: 'https://example.org/invoice.pdf', noClick: false, chain: expect.any(Array) }));
  });
  it('a failed check is said on the row as gray, never as clean, and logged', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness(async () => { throw new Error('boom'); });
    const it1 = item();
    h.session._will({ preventDefault() {} }, it1, null);
    it1.fire('done', 'completed');
    await tick();
    const done = h.sent.find(s => s.channel === 'download-complete').data;
    expect(done.safe.level).toBe('gray');
    expect(done.safe.reasons[0].en).toContain('boom');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it('a download that did not finish is not checked, and with no assistant the event is as before', async () => {
    const assessFile = vi.fn(async () => ({ level: 'green' }));
    const h = harness(assessFile);
    const it1 = item();
    h.session._will({ preventDefault() {} }, it1, null);
    it1.fire('done', 'interrupted');
    await tick();
    expect(assessFile).not.toHaveBeenCalled();
    expect(h.sent.find(s => s.channel === 'download-complete').data.safe).toBeNull();
    const plain = harness(null);
    const it2 = item();
    plain.session._will({ preventDefault() {} }, it2, null);
    it2.fire('done', 'completed');
    expect(plain.sent.find(s => s.channel === 'download-complete').data.safe).toBeNull();
  });
});

describe('the IPC contract', () => {
  it('declares a schema and a policy entry for each channel', () => {
    for (const ch of ['safedl:get', 'safedl:set', 'safedl:quarantine']) expect(schemas.has(ch), ch).toBe(true);
    const text = fs.readFileSync(path.join(__dirname, '../../src/main/ipc-policy.js'), 'utf8');
    for (const ch of ['safedl:get', 'safedl:set', 'safedl:quarantine']) expect(text).toContain("'" + ch + "'");
    expect(policy).toBeTruthy();
  });
  it('accepts a valid change and rejects a malformed one', () => {
    expect(() => validate('safedl:get', [])).not.toThrow();
    expect(() => validate('safedl:set', [{ on: false, strictness: 'strict', checks: { content: false } }])).not.toThrow();
    expect(() => validate('safedl:set', [{ strictness: 'extreme' }])).toThrow();
    expect(() => validate('safedl:set', [{ checks: { content: 'yes' } }])).toThrow();
    expect(() => validate('safedl:set', [{ checks: { a: true, b: true, c: true, d: true, e: true } }])).toThrow();
    expect(() => validate('safedl:set', ['on'])).toThrow();
    expect(() => validate('safedl:quarantine', ['C:\\Users\\x\\a.exe'])).not.toThrow();
    expect(() => validate('safedl:quarantine', [{ path: 'x' }])).toThrow();
    expect(() => validate('safedl:quarantine', ['x'.repeat(5000)])).toThrow();
    expect(() => validate('safedl:quarantine', [])).toThrow();
  });
  it('the preload exposes exactly these three and main answers them', () => {
    const pre = fs.readFileSync(path.join(__dirname, '../../src/preload.js'), 'utf8');
    const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    for (const ch of ['safedl:get', 'safedl:set', 'safedl:quarantine']) {
      expect(pre).toContain("ipcRenderer.invoke('" + ch + "'");
      expect(main).toContain("ipcMain.handle('" + ch + "'");
    }
    expect(main).toMatch(/isQuarantined\(filePath\)\) return \{ ok: false/);
  });
});
