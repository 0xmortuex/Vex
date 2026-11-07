// "What left this computer": the sizes are counted as the bytes really move, not read from a header.
// Before: `in` came only from content-length (a chunked answer counted 0) and `out` only from the body
// (a search query typed in the address showed out=0).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createEgressLedger, requestHeadBytes } = require('../../src/main/egress-ledger.js');

let dir, ledger, clock;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-egb-'));
  clock = 1_700_000_000_000;
  ledger = createEgressLedger({ file: path.join(dir, 'l.json'), fs, now: () => clock });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// A body that hands out the given chunks, one per pull, and records how far it was pulled.
function source(chunks, { failAt = -1 } = {}) {
  const st = { pulled: 0, cancelled: false };
  const stream = new ReadableStream({
    pull(ctrl) {
      if (st.pulled === failAt) { ctrl.error(new Error('connection reset')); return; }
      if (st.pulled >= chunks.length) { ctrl.close(); return; }
      ctrl.enqueue(chunks[st.pulled++]);
    },
    cancel() { st.cancelled = true; },
  }, { highWaterMark: 0 });
  return { st, stream };
}
const bytes = (n) => new Uint8Array(n).fill(7);
const fetchOf = (make) => ledger.wrap(async () => make(), { feature: 'F', kind: 'fetch' });

describe('bytes in', () => {
  it('counts a chunked answer that has no content-length (it used to be 0)', async () => {
    const { stream } = source([bytes(10), bytes(20), bytes(30)]);
    const res = await fetchOf(() => new Response(stream, { status: 200 }))('https://a.example/x');
    expect(ledger.list()[0].in).toBe(0);                     // nothing has streamed yet
    expect((await res.arrayBuffer()).byteLength).toBe(60);   // and the caller gets every byte
    expect(ledger.list()[0].in).toBe(60);
  });

  it('counts the real bytes when content-length is right', async () => {
    const { stream } = source([bytes(100)]);
    const res = await fetchOf(() => new Response(stream, { status: 200, headers: { 'content-length': '100' } }))('https://a.example/x');
    await res.arrayBuffer();
    expect(ledger.list()[0].in).toBe(100);
  });

  it('counts a gzip answer as the wire size when it is known, and as received when it is not', async () => {
    const plain = Buffer.from('hello hello hello hello hello hello hello hello '.repeat(40));
    const gz = zlib.gzipSync(plain);
    expect(gz.length).toBeLessThan(plain.length);
    // The platform decodes the body, so the stream holds the plain bytes while content-length is the compressed size.
    let res = await fetchOf(() => new Response(new Blob([plain]).stream(), { status: 200, headers: { 'content-encoding': 'gzip', 'content-length': String(gz.length) } }))('https://a.example/gz');
    expect((await res.arrayBuffer()).byteLength).toBe(plain.length);
    expect(ledger.list()[0].in).toBe(gz.length);
    clock += 2 * 3600 * 1000;
    res = await fetchOf(() => new Response(new Blob([plain]).stream(), { status: 200, headers: { 'content-encoding': 'gzip' } }))('https://b.example/gz');
    await res.arrayBuffer();
    expect(ledger.list()[0].in).toBe(plain.length);
  });

  it('keeps what had arrived when the caller gives up, cancels the real source, and marks the line failed', async () => {
    const { st, stream } = source([bytes(40), bytes(40), bytes(40)]);
    const res = await fetchOf(() => new Response(stream, { status: 200 }))('https://a.example/x');
    const reader = res.body.getReader();
    expect((await reader.read()).value.byteLength).toBe(40);
    await reader.cancel(new Error('tab closed'));
    expect(st.cancelled).toBe(true);
    expect(ledger.list()[0]).toMatchObject({ in: 40, ok: false });
  });

  it('keeps what had arrived when the connection breaks mid-answer, and the caller still sees the error', async () => {
    const { stream } = source([bytes(25), bytes(25)], { failAt: 1 });
    const res = await fetchOf(() => new Response(stream, { status: 200 }))('https://a.example/x');
    await expect(res.arrayBuffer()).rejects.toThrow('connection reset');
    expect(ledger.list()[0]).toMatchObject({ in: 25, ok: false });
  });

  it('streams: the consumer pulls, nothing is read ahead or held (memory stays flat)', async () => {
    const chunks = Array.from({ length: 500 }, () => bytes(64 * 1024));
    const { st, stream } = source(chunks);
    const res = await fetchOf(() => new Response(stream, { status: 200 }))('https://a.example/big');
    const reader = res.body.getReader();
    for (let i = 0; i < 3; i++) await reader.read();
    // Three chunks were asked for; the source was asked for about that many, not for all 500 (32 MB).
    expect(st.pulled).toBeLessThanOrEqual(5);
    await reader.cancel();
    expect(ledger.list()[0].in).toBe(3 * 64 * 1024);
  });

  it('hands back the same status, headers, url and a body the caller can read as json', async () => {
    const r = new Response(JSON.stringify({ a: 1 }), { status: 201, statusText: 'Created', headers: { 'x-k': 'v' } });
    Object.defineProperty(r, 'url', { value: 'https://a.example/final' });
    const res = await fetchOf(() => r)('https://a.example/first');
    expect(res).toMatchObject({ status: 201, statusText: 'Created', url: 'https://a.example/final', ok: true });
    expect(res.headers.get('x-k')).toBe('v');
    expect(await res.json()).toEqual({ a: 1 });
    expect(ledger.list()[0].in).toBe(JSON.stringify({ a: 1 }).length);
  });

  it('leaves an answer with no body alone (204)', async () => {
    const res = await fetchOf(() => new Response(null, { status: 204 }))('https://a.example/x');
    expect(res.status).toBe(204);
    expect(ledger.list()[0]).toMatchObject({ in: 0, ok: true, status: 204 });
  });
});

describe('bytes out', () => {
  it('counts the address, so a search typed in the URL is not 0 (it used to be)', async () => {
    const url = 'https://suggestqueries.google.com/complete/search?client=firefox&q=my%20secret%20query';
    await fetchOf(() => new Response('[]', { status: 200 }))(url);
    expect(ledger.list()[0].out).toBe(Buffer.byteLength('GET ' + url + ' HTTP/1.1\r\n'));
    expect(ledger.list()[0].out).toBeGreaterThan(url.length);
  });

  it('adds the headers the caller set and the body', async () => {
    const url = 'https://a.example/p';
    await fetchOf(() => new Response('ok'))(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'héllo' });
    expect(ledger.list()[0].out).toBe(requestHeadBytes('POST', url, { 'Content-Type': 'application/json' }) + 6);
    expect(requestHeadBytes('POST', url, { 'Content-Type': 'application/json' })).toBe(Buffer.byteLength('POST ' + url + ' HTTP/1.1\r\n') + Buffer.byteLength('Content-Type: application/json\r\n'));
  });

  it('reads headers given as a Headers object or a list of pairs', () => {
    const a = requestHeadBytes('GET', 'https://a.example/', new Headers({ Accept: 'x' }));
    const b = requestHeadBytes('GET', 'https://a.example/', [['Accept', 'x']]);
    const c = requestHeadBytes('GET', 'https://a.example/', { Accept: 'x' });
    expect(a).toBe(c);
    expect(b).toBe(c);
  });

  it('records a failed request with its request size too', async () => {
    const f = ledger.wrap(async () => { throw new Error('offline'); }, { feature: 'F', kind: 'fetch' });
    await expect(f('https://down.example/?q=1')).rejects.toThrow('offline');
    expect(ledger.list()[0]).toMatchObject({ ok: false, out: Buffer.byteLength('GET https://down.example/?q=1 HTTP/1.1\r\n') });
  });
});
