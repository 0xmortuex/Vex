// "What left this computer": the list claims the last 30 days but held 2000 lines, and two chatty
// sources (the AI-news poll, search suggestions) filled it in ~12 days and pushed out the rare lines
// that matter (an update, Sync, a cloud AI call, the breach check).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEgressLedger, MAX, MAX_AGE_MS } = require('../../src/main/egress-ledger.js');

const HOUR = 3600 * 1000, DAY = 24 * HOUR;
let dir, file, clock, ledger;
const make = (opts = {}) => createEgressLedger({ file, fs, now: () => clock, ...opts });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-egr-'));
  file = path.join(dir, 'egress-ledger.json');
  clock = Date.UTC(2026, 10, 1, 10, 0, 0);   // on the hour
  ledger = make();
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('chatty repeats share one line per hour', () => {
  it('combines the same feature + host within an hour, summing the counts and the bytes', () => {
    for (let i = 0; i < 5; i++) { clock += 60 * 1000; ledger.record({ feature: 'AI news', url: 'https://raw.githubusercontent.com/x', kind: 'fetch', bytesOut: 100, bytesIn: 1000, status: 200 }); }
    const rows = ledger.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: 'AI news', host: 'raw.githubusercontent.com', n: 5, out: 500, in: 5000, ok: true });
    expect(ledger.summary()).toMatchObject({ count: 5, bytesOut: 500, bytesIn: 5000 });
    expect(ledger.summary().byFeature[0]).toMatchObject({ name: 'AI news', count: 5 });
  });

  it('keeps a failed repeat visible: the line says failed and how many', () => {
    ledger.record({ feature: 'AI news', url: 'https://a.example/', kind: 'fetch' });
    ledger.record({ feature: 'AI news', url: 'https://a.example/', kind: 'fetch', ok: false });
    ledger.record({ feature: 'AI news', url: 'https://a.example/', kind: 'fetch' });
    expect(ledger.list()[0]).toMatchObject({ n: 3, bad: 1, ok: false });
  });

  it('starts a new line for the next hour, another host, another feature', () => {
    ledger.record({ feature: 'A', url: 'https://a.example/', kind: 'fetch' });
    ledger.record({ feature: 'A', url: 'https://b.example/', kind: 'fetch' });
    ledger.record({ feature: 'B', url: 'https://a.example/', kind: 'fetch' });
    clock += HOUR;
    ledger.record({ feature: 'A', url: 'https://a.example/', kind: 'fetch' });
    expect(ledger.list()).toHaveLength(4);
  });

  it('never combines the lines that matter: updates, Sync, cloud AI, breach checks, extensions', () => {
    for (const kind of ['update', 'sync', 'ai', 'breach', 'extension']) {
      for (let i = 0; i < 3; i++) ledger.record({ feature: 'F-' + kind, url: 'https://a.example/', kind });
    }
    expect(ledger.list({ limit: 100 })).toHaveLength(15);
  });

  it('adds the streamed bytes of every call that shares a line', async () => {
    const f = ledger.wrap(async () => new Response(new Blob([new Uint8Array(10)]).stream(), { status: 200 }), { feature: 'F', kind: 'fetch' });
    for (let i = 0; i < 3; i++) await (await f('https://a.example/x')).arrayBuffer();
    expect(ledger.list()).toHaveLength(1);
    expect(ledger.list()[0]).toMatchObject({ n: 3, in: 30 });
  });

  it('survives a save and a reload, rolled fields included', () => {
    ledger.record({ feature: 'A', url: 'https://a.example/', kind: 'fetch', bytesIn: 7 });
    ledger.record({ feature: 'A', url: 'https://a.example/', kind: 'fetch', bytesIn: 8 });
    ledger.flush();
    expect(make().list()[0]).toMatchObject({ n: 2, in: 15 });
  });
});

describe('a flood cannot push out the rare lines', () => {
  // 25 days: the AI-news poll every 22 minutes, search suggestions in bursts, and a few rare lines.
  function flood(l) {
    const rare = [];
    for (let d = 0; d < 25; d++) {
      for (let m = 0; m < 24 * 60; m += 22) { clock = Date.UTC(2026, 9, 1) + d * DAY + m * 60000; l.record({ feature: 'AI news', url: 'https://raw.githubusercontent.com/0xmortuex/ai-news-tracker/main/x.json', kind: 'fetch', bytesIn: 4000 }); }
      for (let i = 0; i < 60; i++) { clock = Date.UTC(2026, 9, 1) + d * DAY + (9 * 60 + i) * 60000; l.record({ feature: 'Search suggestions', url: 'https://suggestqueries.google.com/complete/search', kind: 'fetch', bytesOut: 150, bytesIn: 300 }); }
      if (d % 6 === 0) { clock = Date.UTC(2026, 9, 1) + d * DAY + 5 * HOUR; rare.push(l.record({ feature: ['Vex updates', 'Vex Sync', 'Cloud AI', 'Password breach check'][(d / 6) % 4], url: 'https://x.example/', kind: ['update', 'sync', 'ai', 'breach'][(d / 6) % 4] })); }
    }
    clock = Date.UTC(2026, 9, 1) + 25 * DAY;
    return rare;
  }

  it('keeps every rare line and the whole 25 days, with the true request counts', () => {
    const l = make();
    const rare = flood(l);
    const rows = l.list({ limit: 5000 });
    for (const r of rare) expect(rows.some(x => x.t === r.t && x.feature === r.feature), r.feature).toBe(true);
    expect(rows.length).toBeLessThan(MAX);
    expect(l.summary({ sinceMs: 30 * DAY })).toMatchObject({ count: 25 * (Math.ceil(24 * 60 / 22) + 60) + rare.length });
    const first = Math.min(...rows.map(x => x.t));
    expect(first).toBeLessThan(Date.UTC(2026, 9, 2));          // day 1 is still there after 25 days
  });

  it('would have lost the oldest rare lines without the roll-up (the old arithmetic)', () => {
    const perDay = Math.ceil(24 * 60 / 22) + 60;               // ~125 requests a day
    expect(MAX / perDay).toBeLessThan(MAX_AGE_MS / DAY);       // 2000 raw lines last about 16 days, not 30
  });

  it('one feature flooding with distinct hosts cannot evict another feature (fair share)', () => {
    const l = make({ max: 200 });
    for (let i = 0; i < 40; i++) { clock += 1000; l.record({ feature: 'Vex updates', url: 'https://u' + i + '.example/', kind: 'update' }); }
    for (let i = 0; i < 5000; i++) { clock += 1000; l.record({ feature: 'Flood', url: 'https://h' + i + '.example/', kind: 'fetch' }); }
    const rows = l.list({ limit: 1000 });
    expect(rows).toHaveLength(200);
    expect(rows.filter(r => r.feature === 'Vex updates')).toHaveLength(40);
    expect(rows.filter(r => r.feature === 'Flood')).toHaveLength(160);
    expect(rows.find(r => r.feature === 'Flood').host).toBe('h4999.example');   // and it kept its newest
  });

  it('two floods share the list between them, each losing its own oldest', () => {
    const l = make({ max: 100 });
    for (let i = 0; i < 1000; i++) { clock += 1000; l.record({ feature: i % 2 ? 'A' : 'B', url: 'https://h' + i + '.example/', kind: 'fetch' }); }
    const rows = l.list({ limit: 1000 });
    expect(rows).toHaveLength(100);
    expect(rows.filter(r => r.feature === 'A')).toHaveLength(50);
    expect(rows.filter(r => r.feature === 'B')).toHaveLength(50);
  });

  it('a single feature still behaves as before: the newest `max` lines', () => {
    const l = make({ max: 5 });
    for (let i = 0; i < 9; i++) { clock += 1000; l.record({ feature: 'f', url: 'https://h' + i + '.example/', kind: 'fetch' }); }
    expect(l.list({ limit: 10 }).map(e => e.host)).toEqual(['h8.example', 'h7.example', 'h6.example', 'h5.example', 'h4.example']);
  });

  it('still drops lines older than the age limit', () => {
    ledger.record({ feature: 'f', url: 'https://old.example/', kind: 'update' });
    clock += 31 * DAY;
    ledger.record({ feature: 'f', url: 'https://new.example/', kind: 'update' });
    expect(ledger.list().map(e => e.host)).toEqual(['new.example']);
  });
});

describe('files written before this change', () => {
  it('load unchanged: the same lines, no count, the same totals', () => {
    const old = [
      { t: clock - 2 * DAY, feature: 'Vex updates', host: 'github.com', kind: 'update', out: 10, in: 20, ok: true, status: 200 },
      { t: clock - DAY, feature: 'Currency rates', host: 'open.er-api.com', kind: 'fetch', out: 0, in: 0, ok: true, status: 200 },
      { t: clock - 60000, feature: 'Currency rates', host: 'open.er-api.com', kind: 'fetch', out: 0, in: 0, ok: true, status: 200 },
    ];
    fs.writeFileSync(file, JSON.stringify({ v: 1, entries: old }));
    const l = make();
    expect(l.list({ limit: 10 }).reverse()).toEqual(old);
    expect(l.summary({ sinceMs: 30 * DAY })).toMatchObject({ count: 3, bytesOut: 10, bytesIn: 20 });
    // and a new request the same hour as the last old line is not merged into a line from another hour
    l.record({ feature: 'Currency rates', url: 'https://open.er-api.com/v6/latest/USD', kind: 'fetch' });
    expect(l.list({ limit: 10 })).toHaveLength(3 + (Math.floor((clock - 60000) / HOUR) === Math.floor(clock / HOUR) ? 0 : 1));
    l.flush();
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).v).toBe(1);
  });

  it('an oversized old file is trimmed fairly on load, not oldest-first', () => {
    const rows = [];
    for (let i = 0; i < 300; i++) rows.push({ t: clock - 10 * DAY + i * 1000, feature: 'Flood', host: 'h' + i + '.example', kind: 'fetch', out: 0, in: 0, ok: true, status: 200 });
    for (let i = 0; i < 5; i++) rows.push({ t: clock - 20 * DAY + i * 1000, feature: 'Vex Sync', host: 's.example', kind: 'sync', out: 0, in: 0, ok: true, status: 200 });
    fs.writeFileSync(file, JSON.stringify({ v: 1, entries: rows }));
    const l = make({ max: 100 });
    expect(l.list({ limit: 1000 }).filter(r => r.feature === 'Vex Sync')).toHaveLength(5);
    expect(l.size()).toBe(100);
  });

  it('reports the real limits so the screen can state the true window', () => {
    expect(ledger.summary().limits).toEqual({ max: MAX, maxAgeDays: 30 });
  });
});
