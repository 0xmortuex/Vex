// @vitest-environment jsdom
// T3-117: the request builders for mark up, sign, fill and compress (the window never names a path).
import { describe, it, expect, beforeEach, vi } from 'vitest';
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let U;
const one = [{ token: 'a'.repeat(32), name: 'a.pdf', pages: 3 }];
beforeEach(() => { localStorage.clear(); vi.resetModules(); ({ VexPdfTools: U } = fresh(JS + 'pdf-tools-ui.js')); });

describe('marks', () => {
  it('turns percentages into fractions of the page', () => {
    expect(U.markFromForm({ kind: 'highlight', page: '2', x: '10', y: '20', w: '50', h: '5' }, 3)).toEqual({ kind: 'highlight', page: 2, x: 0.1, y: 0.2, w: 0.5, h: 0.05 });
    expect(U.markFromForm({ kind: 'text', page: 1, x: 5, y: 5, w: '', text: ' Hello ', size: '14', color: 'red' }, 1)).toEqual({ kind: 'text', page: 1, x: 0.05, y: 0.05, text: 'Hello', size: 14, color: 'red' });
    expect(U.markFromForm({ kind: 'signature', page: 1, x: 60, y: 80, w: 25 }, 1)).toEqual({ kind: 'signature', page: 1, x: 0.6, y: 0.8, w: 0.25 });
  });
  it('refuses a mark that does not fit the page or lacks its text', () => {
    expect(() => U.markFromForm({ kind: 'text', page: 4, x: 1, y: 1, text: 'x' }, 3)).toThrow(/page from 1 to 3/);
    expect(() => U.markFromForm({ kind: 'rect', page: 1, x: 80, y: 10, w: 30, h: 5 }, 1)).toThrow(/wider/);
    expect(() => U.markFromForm({ kind: 'rect', page: 1, x: 10, y: 90, w: 30, h: 20 }, 1)).toThrow(/taller/);
    expect(() => U.markFromForm({ kind: 'text', page: 1, x: 1, y: 1, text: ' ' }, 1)).toThrow(/Type the text/);
    expect(() => U.markFromForm({ kind: 'text', page: 1, x: 120, y: 1, text: 'x' }, 1)).toThrow(/0 to 100/);
    expect(() => U.markFromForm({ kind: 'text', page: 1, x: 1, y: 1, text: 'x', color: 'pink' }, 1)).toThrow(/listed colours/);
    expect(() => U.markFromForm({ kind: 'script', page: 1, x: 1, y: 1 }, 1)).toThrow(/Pick text/);
  });
});

describe('requests', () => {
  const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47]);
  const mark = { kind: 'text', page: 1, x: 0.1, y: 0.1, text: 'x' };
  it('compress works on one PDF', () => {
    expect(U.buildRequest(one, { op: 'compress' })).toEqual({ op: 'compress', tokens: [one[0].token] });
    expect(() => U.buildRequest(one.concat(one), { op: 'compress' })).toThrow(/one PDF at a time/);
  });
  it('mark up needs a mark; ascii only when asked', () => {
    expect(() => U.buildRequest(one, { op: 'annotate', items: [] })).toThrow(/at least one mark/);
    expect(U.buildRequest(one, { op: 'annotate', items: [mark] })).toEqual({ op: 'annotate', tokens: [one[0].token], items: [mark] });
    expect(U.buildRequest(one, { op: 'annotate', items: [mark], ascii: true }).ascii).toBe(true);
  });
  it('sign needs the signature picture and a placed signature', () => {
    const placed = { kind: 'signature', page: 1, x: 0.5, y: 0.8, w: 0.25 };
    expect(() => U.buildRequest(one, { op: 'sign', items: [] })).toThrow(/Place the signature/);
    expect(() => U.buildRequest(one, { op: 'sign', items: [placed] })).toThrow(/signature first/);
    const req = U.buildRequest(one, { op: 'sign', items: [placed], signature: sig });
    expect(req).toMatchObject({ op: 'annotate', items: [placed] });
    expect(req.signature).toBe(sig);
  });
  it('fill needs at least one answer', () => {
    expect(() => U.buildRequest(one, { op: 'fill', values: {} })).toThrow(/at least one field/);
    expect(U.buildRequest(one, { op: 'fill', values: { a: 'b' }, flatten: true })).toEqual({ op: 'fill', tokens: [one[0].token], values: { a: 'b' }, flatten: true });
  });
  it('lists the new operations', () => {
    expect(U.OPS.map(o => o.id)).toEqual(expect.arrayContaining(['annotate', 'fill', 'sign', 'compress']));
  });
});

describe('signature picture', () => {
  it('refuses an empty or very long typed name', () => {
    expect(() => U.signatureFromText('  ')).toThrow(/Type your name/);
    expect(() => U.signatureFromText('x'.repeat(61))).toThrow(/60 letters/);
  });
});
