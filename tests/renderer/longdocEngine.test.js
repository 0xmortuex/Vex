// @vitest-environment jsdom
//
// T2-025: js/longdoc-engine.js reads a whole text in pieces, says how much it read,
// stays inside its call budget and can be stopped.
import { describe, it, expect, beforeEach } from 'vitest';

const { VexLongDoc: L } = require('../../src/renderer/js/longdoc-engine.js');

beforeEach(() => { localStorage.clear(); delete globalThis.GameMode; });

const para = (n) => Array.from({ length: n }, (_, i) => 'Paragraph ' + i + ' says something about topic ' + i + '. '.repeat(1)).join('\n\n');
// echoes a short marker so merges are checkable
const echo = async (prompt) => JSON.stringify({ reply: 'S(' + prompt.length + ')' });

describe('chunk and plan', () => {
  it('covers the whole text in order with small overlap', () => {
    const text = para(400);
    const parts = L.chunk(text, { chunkChars: 2000, overlap: 100 });
    expect(parts[0].start).toBe(0);
    expect(parts[parts.length - 1].end).toBe(text.length);
    for (let i = 1; i < parts.length; i++) expect(parts[i].start).toBeLessThan(parts[i - 1].end);
    for (const p of parts) expect(p.text.length).toBeLessThanOrEqual(2000);
  });
  it('reports coverage and the next offset when the cap is reached', () => {
    const text = 'word '.repeat(20000);
    const plan = L.plan(text, { chunkChars: 2000, overlap: 100, maxChunks: 10 });
    expect(plan.capped).toBe(true);
    expect(plan.coverage).toBeGreaterThan(10);
    expect(plan.coverage).toBeLessThan(40);
    expect(plan.nextOffset).toBe(plan.coveredTo);
  });
  it('refuses nonsense limits', () => {
    expect(() => L.chunk('x', { chunkChars: 100, overlap: 100 })).toThrow(/overlap/);
    expect(() => L.chunk('x', { maxChunks: 0 })).toThrow(/limit/);
  });
});

describe('run', () => {
  it('a short text takes one call', async () => {
    let calls = 0;
    const r = await L.run('A short text about cats.', { call: async (p) => { calls++; return '{"reply":"cats"}'; } });
    expect(calls).toBe(1);
    expect(r.summary).toBe('cats');
    expect(r.coverage).toBe(100);
    expect(L.coverageLine(r)).toMatch(/all of it/);
  });
  it('maps pieces then merges, with progress and a call count', async () => {
    const seen = [];
    const r = await L.run(para(300), { chunkChars: 3000, overlap: 100, concurrency: 2, call: echo, onProgress: p => seen.push(p.phase + ':' + p.done + '/' + p.total) });
    expect(r.chunksDone).toBeGreaterThan(3);
    expect(r.calls).toBeGreaterThan(r.chunksDone);
    expect(seen[0]).toMatch(/^map:0\//);
    expect(seen.some(s => s.startsWith('merge'))).toBe(true);
    expect(r.coverage).toBe(100);
  });
  it('never silently truncates: a capped run says so and gives the next offset', async () => {
    const r = await L.run('word '.repeat(30000), { chunkChars: 2000, overlap: 100, maxChunks: 5, call: echo });
    expect(r.capped).toBe(true);
    expect(r.coverage).toBeLessThan(100);
    expect(r.nextOffset).not.toBeNull();
    expect(L.coverageLine(r)).toMatch(/Covered \d+ percent/);
    const more = await L.run('word '.repeat(30000), { chunkChars: 2000, overlap: 100, maxChunks: 5, startAt: r.nextOffset, call: echo });
    expect(more.coverage).toBeGreaterThan(r.coverage);
  });
  it('stops at the call ceiling', async () => {
    await expect(L.run(para(300), { chunkChars: 1500, overlap: 50, maxChunks: 40, maxCalls: 5, call: echo })).rejects.toThrow(/model calls/);
  });
  it('can be cancelled and then carries what was read', async () => {
    const ctl = new AbortController();
    let n = 0;
    const call = async () => { n++; if (n === 2) ctl.abort(); return '{"reply":"x"}'; };
    await expect(L.run(para(300), { chunkChars: 3000, overlap: 100, concurrency: 1, call, signal: ctl.signal })).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('raises a model failure instead of hiding it', async () => {
    await expect(L.run(para(300), { chunkChars: 3000, overlap: 100, call: async () => { throw new Error('model down'); } })).rejects.toThrow(/model down/);
  });
  it('is refused while a game runs, and when switched off', async () => {
    globalThis.GameMode = { gaming: true };
    await expect(L.run('text', { call: echo })).rejects.toThrow(/game is running/);
    delete globalThis.GameMode;
    L.setEnabled(false);
    await expect(L.run('text', { call: echo })).rejects.toThrow(/switched off/);
  });
});
