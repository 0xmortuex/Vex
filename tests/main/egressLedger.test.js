// src/main/egress-ledger.js: "what left this computer". One bounded list of every request
// Vex itself made: when, which feature, which host, what kind, how many bytes, and never a
// path, a query, a header or any content.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEgressLedger, classify, hostOf, isThisMachine, DAY_MS } = Object.assign({ DAY_MS: 24 * 3600 * 1000 }, require('../../src/main/egress-ledger.js'));

let dir, file, clock, ledger, notes;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-egress-'));
  file = path.join(dir, 'egress-ledger.json');
  clock = 1_700_000_000_000;
  notes = [];
  ledger = createEgressLedger({ file, fs, now: () => clock, max: 5, maxAgeMs: 3 * DAY_MS, log: (m) => notes.push(m) });
});
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

describe('what a line holds', () => {
  it('keeps the host and sizes and nothing that could say what was sent', () => {
    const e = ledger.record({ feature: 'Cloud AI (chat)', url: 'https://ai.example.workers.dev/path/secret?token=abc#frag', kind: 'ai', bytesOut: 1234, bytesIn: 99 });
    expect(e).toEqual({ t: clock, feature: 'Cloud AI (chat)', host: 'ai.example.workers.dev', kind: 'ai', out: 1234, in: 99, ok: true, status: 0 });
    ledger.flush();
    const saved = fs.readFileSync(file, 'utf8');
    for (const secret of ['secret', 'token', 'abc', 'frag', '/path']) expect(saved).not.toContain(secret);
  });

  it('refuses a URL that is not a network address, and an unknown kind', () => {
    expect(() => ledger.record({ url: 'not a url' })).toThrow(/Not a URL/);
    expect(() => ledger.record({ url: 'file:///C:/secret.txt' })).toThrow(/Only network requests/);
    expect(() => ledger.record({ url: 'https://example.com/', kind: 'spying' })).toThrow(/Unknown kind/);
  });

  it('works out the feature and kind from the address when the caller did not say', () => {
    expect(classify('https://api.pwnedpasswords.com/range/ABCDE')).toEqual({ feature: 'Password breach check', kind: 'breach' });
    expect(classify('https://x.workers.dev/sync/pull')).toEqual({ feature: 'Vex Sync', kind: 'sync' });
    expect(classify('https://x.workers.dev/')).toEqual({ feature: 'Cloud AI', kind: 'ai' });
    expect(classify('https://example.com/')).toEqual({ feature: 'Vex', kind: 'fetch' });
    expect(hostOf('https://User:Pw@Example.COM:8443/a?b')).toBe('example.com');
  });

  it('knows the local machine and network are not "left this computer"', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.0.1', '::1', 'x.localhost']) expect(isThisMachine(h), h).toBe(true);
    for (const h of ['example.com', '172.32.0.1', '8.8.8.8']) expect(isThisMachine(h), h).toBe(false);
  });
});

describe('the bound', () => {
  it('keeps at most `max` lines, newest', () => {
    for (let i = 0; i < 9; i++) { clock += 1000; ledger.record({ url: 'https://h' + i + '.example/', feature: 'f' }); }
    expect(ledger.size()).toBe(5);
    expect(ledger.list({ limit: 10 }).map(e => e.host)).toEqual(['h8.example', 'h7.example', 'h6.example', 'h5.example', 'h4.example']);
  });

  it('drops lines older than the age limit', () => {
    ledger.record({ url: 'https://old.example/', feature: 'f' });
    clock += 4 * DAY_MS;
    ledger.record({ url: 'https://new.example/', feature: 'f' });
    expect(ledger.list().map(e => e.host)).toEqual(['new.example']);
  });
});

describe('persistence', () => {
  it('writes the file and a new ledger reads it back', () => {
    ledger.record({ url: 'https://a.example/', feature: 'f', kind: 'news', bytesIn: 5 });
    expect(ledger.flush()).toBe(true);
    const again = createEgressLedger({ file, fs, now: () => clock, max: 5, maxAgeMs: 3 * DAY_MS });
    expect(again.list()[0]).toMatchObject({ host: 'a.example', kind: 'news', in: 5 });
  });

  it('says so, and starts again, when the file is damaged (never silently)', () => {
    fs.writeFileSync(file, '{ not json');
    const l = createEgressLedger({ file, fs, now: () => clock, log: (m) => notes.push(m) });
    expect(l.list()).toEqual([]);
    expect(notes.join(' ')).toMatch(/not readable and is started again/);
  });

  it('reports a save that fails', () => {
    const l = createEgressLedger({ file: path.join(dir, 'no', 'such', 'dir', 'x.json'), fs, now: () => clock, log: (m) => notes.push(m) });
    l.record({ url: 'https://a.example/', feature: 'f' });
    expect(l.flush()).toBe(false);
    expect(notes.join(' ')).toMatch(/could not be saved/);
  });

  it('forgets everything on clear(), on disk too', () => {
    ledger.record({ url: 'https://a.example/', feature: 'f' });
    ledger.flush();
    expect(ledger.clear()).toBe(true);
    expect(createEgressLedger({ file, fs, now: () => clock }).list()).toEqual([]);
  });
});

describe('wrap()', () => {
  const response = (status, headers = {}) => ({ ok: status < 400, status, headers: new Headers(headers) });

  it('records the host, the body size sent and the length received, and returns the response untouched', async () => {
    const res = response(200, { 'content-length': '321' });
    const inner = vi.fn(async () => res);
    const f = ledger.wrap(inner, { feature: 'Vex updates', kind: 'update' });
    const out = await f('https://updates.example/latest.yml?v=1', { method: 'POST', body: 'héllo' });
    expect(out).toBe(res);
    expect(inner).toHaveBeenCalledWith('https://updates.example/latest.yml?v=1', { method: 'POST', body: 'héllo' });
    expect(ledger.list()[0]).toMatchObject({ feature: 'Vex updates', kind: 'update', host: 'updates.example', out: 6, in: 321, ok: true, status: 200 });
  });

  it('takes the caller\u2019s hint from init.egress and removes it before the request goes out', async () => {
    const inner = vi.fn(async () => response(200));
    const f = ledger.wrap(inner, {});
    await f('https://x.workers.dev/', { egress: { feature: 'Cloud AI (summarize)', kind: 'ai' }, method: 'POST' });
    expect(inner.mock.calls[0][1]).toEqual({ method: 'POST' });
    expect(ledger.list()[0]).toMatchObject({ feature: 'Cloud AI (summarize)', kind: 'ai' });
  });

  it('records a failed request too, and rethrows the error', async () => {
    const f = ledger.wrap(async () => { throw new Error('offline'); }, { feature: 'F', kind: 'fetch' });
    await expect(f('https://down.example/')).rejects.toThrow('offline');
    expect(ledger.list()[0]).toMatchObject({ host: 'down.example', ok: false });
  });

  it('does not list a request to this machine, or to file:', async () => {
    const f = ledger.wrap(async () => response(200), {});
    await f('http://127.0.0.1:11434/api/tags');
    await f('http://localhost:3000/');
    await f('file:///C:/x.html');
    expect(ledger.size()).toBe(0);
  });
});

describe('summary() and the proof line', () => {
  it('counts the last 24 hours by feature, host and kind', () => {
    ledger.record({ url: 'https://a.example/', feature: 'One', kind: 'news', bytesOut: 10, bytesIn: 100 });
    ledger.record({ url: 'https://a.example/', feature: 'One', kind: 'news', bytesOut: 10, bytesIn: 100 });
    ledger.record({ url: 'https://b.example/', feature: 'Two', kind: 'ai', bytesOut: 5, bytesIn: 1 });
    const s = ledger.summary();
    expect(s).toMatchObject({ count: 3, bytesOut: 25, bytesIn: 201, nothingLeft: false });
    expect(s.byFeature.map(x => [x.name, x.count])).toEqual([['One', 2], ['Two', 1]]);
    expect(s.byHost[0]).toMatchObject({ name: 'a.example', count: 2 });
  });

  it('says nothing left when nothing did in the window, and not before the ledger is that old', () => {
    const old = createEgressLedger({ file, fs, now: () => clock, max: 100, maxAgeMs: 30 * DAY_MS });
    old.record({ url: 'https://a.example/', feature: 'f' });
    clock += 2 * DAY_MS;
    const s = old.summary();
    expect(s.nothingLeft).toBe(true);
    expect(s.count).toBe(0);
    expect(s.keptSince).toBeLessThan(clock - DAY_MS);          // the ledger is older than the window, so "nothing" is a real claim
  });

  it('filters the list by kind, feature and part of a host', () => {
    ledger.record({ url: 'https://a.example/', feature: 'One', kind: 'news' });
    ledger.record({ url: 'https://b.example/', feature: 'Two', kind: 'ai' });
    expect(ledger.list({ kind: 'ai' }).map(e => e.host)).toEqual(['b.example']);
    expect(ledger.list({ feature: 'One' }).map(e => e.host)).toEqual(['a.example']);
    expect(ledger.list({ host: 'b.ex' }).map(e => e.host)).toEqual(['b.example']);
  });
});
