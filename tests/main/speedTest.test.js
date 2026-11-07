// The speed test (src/main/speed-test.js): a fixed payload from one fixed host, measured with an injected clock. No network.
import { describe, it, expect } from 'vitest';
const fs = require('fs'), path = require('path');
const speed = require('../../src/main/speed-test.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

// A response that streams the given chunk sizes.
function response(sizes, { ok = true, status = 200, url = 'https://speed.cloudflare.com/__down?bytes=1000000' } = {}) {
  let i = 0;
  return {
    ok, status, url,
    body: { getReader: () => ({ read: async () => (i < sizes.length ? { done: false, value: new Uint8Array(sizes[i++]) } : { done: true }) }) },
  };
}
// A clock that returns the listed times, one per call.
const clock = (times) => { let i = 0; return () => times[Math.min(i++, times.length - 1)]; };
const BYTES = 1000000;

describe('mbps', () => {
  it('turns bytes and milliseconds into megabits per second', () => {
    expect(speed.mbps(1000000, 1000)).toBeCloseTo(8, 6);
    expect(speed.mbps(12500000, 1000)).toBeCloseTo(100, 6);
  });
  it('refuses nothing-to-measure inputs', () => {
    expect(() => speed.mbps(0, 10)).toThrow();
    expect(() => speed.mbps(10, 0)).toThrow();
  });
});

describe('runSpeedTest', () => {
  it('asks the fixed host for the fixed size and counts the bytes after the first chunk', async () => {
    const asked = [];
    const fetchImpl = async (url, init) => { asked.push([url, init]); return response([250000, 250000, 250000, 250000]); };
    // first chunk at t=100, last at t=1100: 750000 bytes in 1000 ms = 6 Mbps
    const r = await speed.runSpeedTest({ fetchImpl, now: clock([100, 400, 700, 1100]), bytes: BYTES });
    expect(asked[0][0]).toBe('https://speed.cloudflare.com/__down?bytes=1000000');
    expect(asked[0][1].redirect).toBe('error');
    expect(r.ok).toBe(true);
    expect(r.bytes).toBe(750000);
    expect(r.ms).toBe(1000);
    expect(r.mbps).toBeCloseTo(6, 6);
  });
  it('refuses a size outside the allowed range', async () => {
    const fetchImpl = async () => response([1]);
    await expect(speed.runSpeedTest({ fetchImpl, bytes: 10 })).rejects.toThrow(/not allowed/);
    await expect(speed.runSpeedTest({ fetchImpl, bytes: 1e9 })).rejects.toThrow(/not allowed/);
  });
  it('needs a fetch function', async () => {
    await expect(speed.runSpeedTest({})).rejects.toThrow(/fetch function/);
  });
  it('fails out loud on a bad status, a wrong host and a missing body', async () => {
    await expect(speed.runSpeedTest({ bytes: BYTES, fetchImpl: async () => response([], { ok: false, status: 503 }) })).rejects.toThrow(/503/);
    await expect(speed.runSpeedTest({ bytes: BYTES, fetchImpl: async () => response([BYTES], { url: 'https://evil.example/__down' }) })).rejects.toThrow(/unexpected host/);
    await expect(speed.runSpeedTest({ bytes: BYTES, fetchImpl: async () => ({ ok: true, status: 200, url: 'https://speed.cloudflare.com/x', body: null }) })).rejects.toThrow(/no data/);
  });
  it('stops a server that sends more than was asked for', async () => {
    await expect(speed.runSpeedTest({ bytes: BYTES, now: clock([1, 2, 3]), fetchImpl: async () => response([600000, 600000]) })).rejects.toThrow(/more than/);
  });
  it('fails when fewer bytes arrive than were asked for', async () => {
    await expect(speed.runSpeedTest({ bytes: BYTES, now: clock([1, 2, 3]), fetchImpl: async () => response([300000, 300000]) })).rejects.toThrow(/received 600000 of 1000000/);
  });
  it('says so when the transfer was too quick to measure', async () => {
    await expect(speed.runSpeedTest({ bytes: BYTES, now: clock([5, 5, 5]), fetchImpl: async () => response([500000, 500000]) })).rejects.toThrow(/too quick/);
  });
  it('reports the time limit when the request is aborted, and clears its timer', async () => {
    let cleared = 0;
    const fetchImpl = (url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
    const setTimer = (fn) => { queueMicrotask(fn); return 7; };
    await expect(speed.runSpeedTest({ bytes: BYTES, fetchImpl, setTimer, clearTimer: (t) => { if (t === 7) cleared++; }, timeoutMs: 20000 })).rejects.toThrow(/longer than 20 seconds/);
    expect(cleared).toBe(1);
  });
});

describe('wiring and documents', () => {
  it('names one fixed host and a 10 MB size', () => {
    expect(speed.HOST).toBe('speed.cloudflare.com');
    expect(speed.SIZE_BYTES).toBe(10000000);
    expect(speed.URL_OF(10000000)).toBe('https://speed.cloudflare.com/__down?bytes=10000000');
  });
  it('goes through the egress ledger under the label Speed test', () => {
    expect(read('src/main.js')).toMatch(/ipcMain\.handle\('speedtest:run'[\s\S]{0,400}feature: 'Speed test'/);
  });
  it('has a schema, a preload call, and is closed in private windows', () => {
    expect(read('src/main/ipc-schemas.js')).toContain("define('speedtest:run', [])");
    expect(read('src/preload.js')).toContain("ipcRenderer.invoke('speedtest:run')");
    expect(read('src/main/ipc-policy.js')).toMatch(/speedtest:/);
  });
  it('PRIVACY.md names the host and the ledger label', () => {
    const privacy = read('PRIVACY.md');
    expect(privacy).toContain(speed.HOST);
    expect(privacy).toContain('Speed test');
  });
});
