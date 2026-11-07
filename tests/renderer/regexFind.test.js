// @vitest-environment jsdom
// Find with a regular expression (js/regex-find.js): the pattern checker, the matching (also as the worker's own source), the time
// limit with a fake worker and a hand-driven timer, the two functions that run inside the page (on a jsdom document), and the wiring.
import { describe, it, expect, vi, afterEach } from 'vitest';
const fs = require('fs'), path = require('path');
const { VexRegexFind: V } = require('../../src/renderer/js/regex-find.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

afterEach(() => { vi.restoreAllMocks(); delete globalThis.VexWholeWordFind; delete window.__vexRX; delete window.Highlight; delete globalThis.CSS; document.body.innerHTML = ''; });

describe('analyze: the pattern before it runs', () => {
  const refused = [
    [String.raw`(a+)+`, /repeat inside a repeat/],
    [String.raw`(.*)*`, /repeat inside a repeat/],
    [String.raw`([a-z]+\s?)*`, /repeat inside a repeat/],
    [String.raw`((a+)b)+`, /repeat inside a repeat/],
    [String.raw`(a|ab)*`, /repeated choice/],
    [String.raw`(a|a)+`, /repeated choice/],
    [String.raw`(\d|\w)+`, /repeated choice/],
    [String.raw`(a)\1`, /Back-references/],
    [String.raw`a.*b.*c.*d.*e.*f.*g.*h`, /open-ended repeats/],
    ['(', /not a valid pattern/],
    ['x)', /not a valid pattern/],
    ['', /Type a pattern/],
    ['a'.repeat(201), /at most 200/],
  ];
  it.each(refused)('refuses %s', (pattern, why) => {
    const r = V.analyze(pattern);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(why);
  });

  const allowed = [
    String.raw`\d{4}-\d{2}`,
    String.raw`^\s*\w+@\w+\.\w+$`,
    String.raw`(foo|bar)+`,
    String.raw`(?:foo|bar)+`,
    String.raw`(a{1,3})+`,
    String.raw`[(]+`,
    String.raw`a{2,}b`,
    String.raw`\p{L}+`,
    String.raw`colou?r`,
  ];
  it.each(allowed)('allows %s', (pattern) => {
    expect(V.analyze(pattern)).toEqual({ ok: true });
  });

  it('counts an escaped backslash before a digit as no back-reference', () => {
    expect(V.analyze('\\\\1')).toEqual({ ok: true });
  });
});

describe('findMatches (also the worker body)', () => {
  it('returns node index and offsets, skips empty matches, and honours the case flag', () => {
    const texts = ['Call 555-1234 now', 'nothing', 'also 999-0000'];
    expect(V.findMatches(texts, String.raw`\d{3}-\d{4}`, 'u', 10)).toEqual({ hits: [[0, 5, 13], [2, 5, 13]], capped: false });
    expect(V.findMatches(['Abc abc'], 'abc', 'u', 10).hits).toEqual([[0, 4, 7]]);
    expect(V.findMatches(['Abc abc'], 'abc', 'ui', 10).hits).toEqual([[0, 0, 3], [0, 4, 7]]);
    expect(V.findMatches(['aaa'], 'x*', 'u', 10)).toEqual({ hits: [], capped: false });
  });
  it('stops at the cap and says so', () => {
    const r = V.findMatches(['a a a a a'], 'a', 'u', 3);
    expect(r.hits.length).toBe(3);
    expect(r.capped).toBe(true);
  });
  it('uses Unicode letters with the u flag', () => {
    expect(V.findMatches(['şehir çok'], String.raw`\p{L}+`, 'u', 10).hits).toEqual([[0, 0, 5], [0, 6, 9]]);
  });
});

describe('the worker source', () => {
  it('answers a message with the result, and with the error text for a bad pattern', () => {
    const posted = [];
    const self = { postMessage: (m) => posted.push(m) };
    new Function('self', V._workerSource())(self);
    self.onmessage({ data: { texts: ['x1 x22'], pattern: String.raw`x\d+`, flags: 'u', max: 10 } });
    expect(posted[0]).toEqual({ ok: true, result: { hits: [[0, 0, 2], [0, 3, 6]], capped: false } });
    self.onmessage({ data: { texts: ['x'], pattern: '(', flags: 'u', max: 10 } });
    expect(posted[1].ok).toBe(false);
    expect(typeof posted[1].error).toBe('string');
  });
});

describe('matchInWorker: the time limit', () => {
  const fake = (handler) => {
    const w = { terminated: 0, onmessage: null, onerror: null, postMessage(msg) { queueMicrotask(() => handler(w, msg)); }, terminate() { w.terminated++; } };
    return w;
  };
  it('resolves with the result and stops the worker', async () => {
    const w = fake((self, msg) => self.onmessage({ data: { ok: true, result: V.findMatches(msg.texts, msg.pattern, msg.flags, msg.max) } }));
    const r = await V.matchInWorker(['ab'], 'b', 'u', { makeWorker: () => w, setTimer: () => 1, clearTimer: () => {} });
    expect(r.hits).toEqual([[0, 1, 2]]);
    expect(w.terminated).toBe(1);
  });
  it('terminates a worker that does not answer in time, and says so', async () => {
    const w = fake(() => {});
    let fire = null;
    let cleared = 0;
    const p = V.matchInWorker(['ab'], 'b', 'u', { makeWorker: () => w, setTimer: (fn, ms) => { fire = { fn, ms }; return 9; }, clearTimer: (t) => { if (t === 9) cleared++; } });
    expect(fire.ms).toBe(1500);
    fire.fn();
    await expect(p).rejects.toThrow(/longer than 1.5 seconds/);
    expect(w.terminated).toBe(1);
    expect(cleared).toBe(1);
  });
  it('ignores an answer that arrives after the stop', async () => {
    const w = fake(() => {});
    let fire = null;
    const p = V.matchInWorker([], 'a', 'u', { makeWorker: () => w, setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => {} });
    fire();
    await expect(p).rejects.toThrow();
    w.onmessage({ data: { ok: true, result: { hits: [], capped: false } } });
    expect(w.terminated).toBe(1);
  });
  it('rejects with the worker\'s error text', async () => {
    const w = fake((self) => self.onmessage({ data: { ok: false, error: 'bad' } }));
    await expect(V.matchInWorker([], 'a', 'u', { makeWorker: () => w, setTimer: () => 1, clearTimer: () => {} })).rejects.toThrow('bad');
    expect(w.terminated).toBe(1);
  });
});

describe('the page functions (run on a jsdom document)', () => {
  it('collects the visible text nodes, skips scripts and empty text, and cuts a long node', () => {
    document.body.innerHTML = '<p>one two</p><script>var x = 1;</script><p>   </p><div>' + 'z'.repeat(50) + '</div><textarea>nope</textarea>';
    const r = V.pageCollect({ maxNode: 20, maxText: 1000 });
    expect(r.texts).toEqual(['one two', 'z'.repeat(20)]);
    expect(r.capped).toBe(true);
    expect(window.__vexRX.nodes.length).toBe(2);
  });
  it('stops collecting at the total text limit', () => {
    document.body.innerHTML = '<p>aaaaa</p><p>bbbbb</p><p>ccccc</p>';
    const r = V.pageCollect({ maxNode: 100, maxText: 12 });
    expect(r.texts).toEqual(['aaaaa', 'bbbbb']);
    expect(r.capped).toBe(true);
  });
  it('draws the hits, steps with wrap-around, counts stale hits, and clears', () => {
    const sets = new Map();
    Object.defineProperty(globalThis, 'CSS', { value: { highlights: { set: (k, v) => sets.set(k, v), delete: (k) => sets.delete(k) } }, configurable: true, writable: true });
    window.Highlight = class { constructor(...r) { this.ranges = r; } };
    document.body.innerHTML = '<p>cat dog cat</p>';
    const c = V.pageCollect({ maxNode: 100, maxText: 1000 });
    expect(c.texts).toEqual(['cat dog cat']);
    const hits = [[0, 0, 3], [0, 8, 11], [5, 0, 1]];     // the last one names a node that is not there
    const first = V.pageApply('find', { hits });
    expect(first).toEqual({ total: 2, active: 1, stale: 1 });
    expect(sets.get('vex-ww').ranges.length).toBe(2);
    expect(sets.get('vex-ww-active').ranges[0].startOffset).toBe(0);
    expect(V.pageApply('next', {}).active).toBe(2);
    expect(V.pageApply('next', {}).active).toBe(1);
    expect(V.pageApply('prev', {}).active).toBe(2);
    expect(V.pageApply('clear', {})).toEqual({ total: 0, active: 0, stale: 0 });
    expect(sets.size).toBe(0);
  });
  it('drops a hit whose text node was removed or got shorter', () => {
    Object.defineProperty(globalThis, 'CSS', { value: { highlights: { set() {}, delete() {} } }, configurable: true, writable: true });
    window.Highlight = class { constructor(...r) { this.ranges = r; } };
    document.body.innerHTML = '<p>hello world</p>';
    V.pageCollect({ maxNode: 100, maxText: 1000 });
    document.querySelector('p').firstChild.nodeValue = 'hi';
    expect(V.pageApply('find', { hits: [[0, 6, 11]] }).stale).toBe(1);
  });
});

describe('search: the order of the steps', () => {
  it('refuses a bad pattern without touching the page', async () => {
    const wv = { executeJavaScript: vi.fn() };
    await expect(V.search(wv, String.raw`(a+)+`)).rejects.toThrow(/repeat inside a repeat/);
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
  });
  it('styles the page, collects its text, matches in the worker, then draws', async () => {
    const order = [];
    globalThis.VexWholeWordFind = { _styles: async () => { order.push('styles'); } };
    const answers = [{ texts: ['abc 123'], capped: false }, { total: 1, active: 1, stale: 0 }];
    const wv = { executeJavaScript: vi.fn(async (code) => { order.push(code.includes('pageApply') || code.includes('"find"') ? 'draw' : 'collect'); return answers.shift(); }) };
    const makeWorker = () => ({ onmessage: null, postMessage(msg) { queueMicrotask(() => { order.push('match'); this.onmessage({ data: { ok: true, result: V.findMatches(msg.texts, msg.pattern, msg.flags, msg.max) } }); }); }, terminate() {} });
    const r = await V.search(wv, String.raw`\d+`, { makeWorker });
    expect(order).toEqual(['styles', 'collect', 'match', 'draw']);
    expect(r).toEqual({ total: 1, active: 1, stale: 0, capped: false });
    expect(wv.executeJavaScript.mock.calls[1][0]).toContain('[[0,4,7]]');
  });
  it('reads Match case into the flags', () => {
    expect(V.flagsFor(true)).toBe('u');
    expect(V.flagsFor(false)).toBe('ui');
  });
  it('writes the count with a plus when capped', () => {
    expect(V.countText({ total: 12, active: 3, capped: true })).toBe('3/12+');
    expect(V.countText({ total: 0, active: 0 })).toBe('0/0');
  });
});

describe('wiring', () => {
  it('is a lazy module with no index.html tag, and registers its own command', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toContain("{ src: 'js/regex-find.js'");
    expect(read('src/renderer/index.html')).not.toContain('regex-find.js');
    expect(read('src/renderer/js/regex-find.js')).toMatch(/registerCommand\(\{ id: 'regex-find', label: 'Find With Regular Expression'/);
  });
  it('is in the catalogue with a command and a long description', () => {
    expect(read('src/renderer/js/feature-catalog.js')).toMatch(/\{ id: 'regex-find', feature: 'regex-find'.*cmd: 'regex-find'/);
    expect(read('src/renderer/js/feature-details.js')).toContain("'regex-find':");
  });
});
