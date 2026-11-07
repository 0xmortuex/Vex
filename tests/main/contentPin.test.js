// @vitest-environment node
//
// Pinning a real Discord theme's file by its SHA-256 (src/main/content-pin.js): a real temp folder, a fake
// fetch, a fake clock. Nothing leaves the machine.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createContentPin, sha256, checkUrl, checkKey } = require('../../src/main/content-pin.js');

const URL1 = 'https://refact0r.github.io/midnight-discord/themes/midnight.theme.css';
let dir, served, calls, log;
const make = () => createContentPin({
  dir, fetchText: async (u) => { calls.push(u); if (served instanceof Error) throw served; return served; },
  now: () => 1000, log,
});
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-pin-'));
  served = 'body { color: red }'; calls = [];
  log = { log() {}, warn() {}, error() {} };
});

describe('content pin for theme files', () => {
  it('pins a file the first time and keeps a copy', async () => {
    const r = await make().check('deepmidnight', URL1);
    expect(r).toMatchObject({ ok: true, status: 'pinned', pinnedSha: sha256('body { color: red }') });
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'deepmidnight.json'), 'utf8'));
    expect(saved.css).toBe('body { color: red }');
    expect(saved.sha256).toBe(sha256('body { color: red }'));
  });

  it('says same when nothing changed, and hands back no css', async () => {
    const pin = make();
    await pin.check('deepmidnight', URL1);
    const r = await pin.check('deepmidnight', URL1);
    expect(r).toMatchObject({ ok: true, status: 'same' });
    expect(r.css).toBeUndefined();
  });

  it('does not apply a changed file: it hands back the old copy and announces once per change', async () => {
    const pin = make();
    await pin.check('deepmidnight', URL1);
    served = 'body { color: blue } /* new */';
    const first = await pin.check('deepmidnight', URL1);
    expect(first).toMatchObject({ ok: true, status: 'changed', css: 'body { color: red }', announce: true, newSha: sha256(served) });
    const second = await pin.check('deepmidnight', URL1);
    expect(second).toMatchObject({ status: 'changed', css: 'body { color: red }', announce: false });
    served = 'body { color: green }';
    expect((await pin.check('deepmidnight', URL1)).announce).toBe(true);
  });

  it('accept re-pins whatever the site serves now', async () => {
    const pin = make();
    await pin.check('deepmidnight', URL1);
    served = 'body { color: blue }';
    expect((await pin.check('deepmidnight', URL1)).status).toBe('changed');
    expect(await pin.accept('deepmidnight', URL1)).toMatchObject({ ok: true, status: 'pinned' });
    expect((await pin.check('deepmidnight', URL1)).status).toBe('same');
  });

  it('a failed download gives back the kept copy, or nothing when there is none', async () => {
    const pin = make();
    served = new Error('offline');
    expect(await pin.check('deepmidnight', URL1)).toEqual({ ok: false, error: 'offline' });
    served = 'body { color: red }';
    await pin.check('deepmidnight', URL1);
    served = new Error('offline');
    expect(await pin.check('deepmidnight', URL1)).toMatchObject({ ok: false, error: 'offline', css: 'body { color: red }' });
  });

  it('refuses an empty or oversized file and writes no pin for it', async () => {
    const pin = make();
    served = '   ';
    expect((await pin.check('deepmidnight', URL1)).ok).toBe(false);
    served = 'x'.repeat(1024 * 1024 + 1);
    expect((await pin.check('deepmidnight', URL1)).ok).toBe(false);
    expect(fs.existsSync(path.join(dir, 'deepmidnight.json'))).toBe(false);
  });

  it('a kept copy that no longer matches its pin is not trusted', async () => {
    const pin = make();
    await pin.check('deepmidnight', URL1);
    const f = path.join(dir, 'deepmidnight.json');
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
    rec.css = 'body { color: purple }';          // edited on disk: the hash is now wrong
    fs.writeFileSync(f, JSON.stringify(rec));
    served = new Error('offline');
    const r = await pin.check('deepmidnight', URL1);
    expect(r.ok).toBe(false);
    expect(r.css).toBeUndefined();
  });

  it('a different address for the same theme is a new pin, not a change', async () => {
    const pin = make();
    await pin.check('deepmidnight', URL1);
    served = 'other';
    const r = await pin.check('deepmidnight', 'https://cdn.jsdelivr.net/gh/x/y@main/z.css');
    expect(r.status).toBe('pinned');
  });

  it('only theme hosts over https, and only plain ids', () => {
    expect(() => checkUrl('http://refact0r.github.io/a.css')).toThrow();
    expect(() => checkUrl('https://evil.example/a.css')).toThrow();
    expect(() => checkUrl('https://github.io.evil.example/a.css')).toThrow();
    expect(() => checkUrl('https://user:pw@refact0r.github.io/a.css')).toThrow();
    expect(checkUrl(URL1)).toBe(URL1);
    expect(() => checkKey('../x')).toThrow();
    expect(() => checkKey('Upper')).toThrow();
    expect(checkKey('deepmidnight')).toBe('deepmidnight');
  });

  it('does not even fetch for a refused address', async () => {
    await expect(make().check('deepmidnight', 'https://evil.example/a.css')).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
