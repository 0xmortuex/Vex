// @vitest-environment node
// Crash-proof tabs, main side: what is stored, where, and what is refused.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTabSnapshots, cleanUrl } = require('../../src/main/tab-snapshots.js');
const { SecretStore, JsonStore } = require('../../src/main/file-store.js');

// A stand-in for Electron's safeStorage that is obviously not plaintext.
const fakeSafe = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').toString('base64'), 'utf8'),
  decryptString: (b) => Buffer.from(b.toString('utf8'), 'base64').toString('utf8'),
});

function build({ encrypted = true, t = { now: 1_800_000_000_000 } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-snap-'));
  const safe = fakeSafe(encrypted);
  const svc = createTabSnapshots({
    secrets: new SecretStore(safe), plain: new JsonStore(dir), file: path.join(dir, 'tab-snapshots.vex'),
    encryptionAvailable: () => safe.isEncryptionAvailable(), now: () => t.now,
  });
  return { dir, svc, t };
}
const entry = (url, fields = [], y = 300) => ({ url, scroll: { x: 0, y }, fields });

describe('tab snapshots', () => {
  it('stores typed text only encrypted, never as plain text in the profile', async () => {
    const { dir, svc } = build();
    const r = await svc.save({ entries: [entry('https://a.example/post#frag', [{ s: '#c', i: 0, v: 'my long unsent comment' }])] });
    expect(r).toMatchObject({ ok: true, formsKept: true, count: 1 });
    for (const f of fs.readdirSync(dir)) {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(raw, f).not.toContain('my long unsent comment');
    }
    const back = await svc.load();
    expect(back.entries[0].url).toBe('https://a.example/post');
    expect(back.entries[0].fields[0].v).toBe('my long unsent comment');
  });

  it('keeps only address and scroll, in a plain file, when OS encryption is unavailable', async () => {
    const { dir, svc } = build({ encrypted: false });
    const r = await svc.save({ entries: [entry('https://a.example/', [{ s: '#c', i: 0, v: 'secret text' }])] });
    expect(r.formsKept).toBe(false);
    const all = fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    expect(all).not.toContain('secret text');
    expect(all).toContain('https://a.example/');
    expect((await svc.load()).entries[0].fields).toEqual([]);
  });

  it('refuses non-web addresses and drops empty snapshots', async () => {
    const { svc } = build();
    await svc.save({ entries: [entry('file:///C:/x.html'), entry('javascript:alert(1)'), entry('https://b.example/', [], 0)] });
    expect((await svc.load()).entries).toEqual([]);
    expect(cleanUrl('chrome://settings')).toBe(null);
  });

  it('keeps the snapshot of an open but uncaptured tab, and drops closed ones', async () => {
    const { svc } = build();
    await svc.save({ entries: [entry('https://a.example/'), entry('https://b.example/')] });
    await svc.save({ entries: [], keepUrls: ['https://a.example/'] });
    expect((await svc.load()).entries.map(e => e.url)).toEqual(['https://a.example/']);
  });

  it('replaces a snapshot with nothing when the form was sent and cleared', async () => {
    const { svc } = build();
    await svc.save({ entries: [entry('https://a.example/', [{ s: '#c', i: 0, v: 'hello' }])] });
    await svc.save({ entries: [entry('https://a.example/', [], 0)], keepUrls: ['https://a.example/'] });
    expect((await svc.load()).entries).toEqual([]);
  });

  it('forgets snapshots older than two weeks', async () => {
    const { svc, t } = build();
    await svc.save({ entries: [entry('https://a.example/')] });
    t.now += 15 * 24 * 3600 * 1000;
    expect((await svc.load()).entries).toEqual([]);
  });

  it('bounds field count, value size and rejects malformed input', async () => {
    const { svc } = build();
    const many = Array.from({ length: 80 }, (_, i) => ({ s: '#f' + i, i: 0, v: 'x' }));
    const huge = { s: '#h', i: 0, v: 'y'.repeat(20001) };
    await svc.save({ entries: [entry('https://a.example/', [...many, huge])] });
    const e = (await svc.load()).entries[0];
    expect(e.fields).toHaveLength(40);
    expect(e.fields.some(f => f.s === '#h')).toBe(false);
    await expect(svc.save({ entries: 'no' })).rejects.toThrow();
  });

  it('clear removes the files', async () => {
    const { svc } = build();
    await svc.save({ entries: [entry('https://a.example/')] });
    await svc.clear();
    expect((await svc.load()).entries).toEqual([]);
  });
});
