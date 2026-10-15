// Page-to-project compiler: the prompt, the character budget, the citation
// reading and the source-coverage list, all with a fake model. No model, no
// network: the model is a function the test passes in.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const { ProjectCompiler: C } = require('../../src/renderer/js/project-compiler.js');

const src = (title, text, extra = {}) => ({ kind: 'tab', title, url: 'https://example.com/' + encodeURIComponent(title), text, ...extra });
const para = (n) => 'This is a sentence about the subject. '.repeat(n).trim();

// A model that answers with a document citing the sources it is told to.
const modelCiting = (...nums) => vi.fn(async (prompt) => ({
  text: JSON.stringify({ reply: '# Findings\n\n## Summary\n\nThe sources agree on the basics ' + nums.map(n => '[' + n + ']').join('') + '.\n\n- A point [' + nums[0] + ']' }),
  model: 'fake-model:1b',
}));

describe('normalizeSources', () => {
  it('numbers every source in the order given and keeps the empty ones', () => {
    const out = C.normalizeSources([src('A', 'text  one'), src('B', ''), null, src('C', 'three')]);
    expect(out.map(s => s.n)).toEqual([1, 2, 3]);
    expect(out[0].text).toBe('text one');
    expect(out[1].chars).toBe(0);
  });

  it('keeps only web addresses as links', () => {
    const [a, b] = C.normalizeSources([src('A', 'x', { url: 'javascript:alert(1)' }), src('B', 'y', { url: 'https://ok.example/p' })]);
    expect(a.url).toBe('');
    expect(b.url).toBe('https://ok.example/p');
  });
});

describe('fit (the budget)', () => {
  it('gives short sources all of their text and the long ones the rest', () => {
    const sources = C.normalizeSources([src('short', para(2)), src('long1', para(400)), src('long2', para(400))]);
    const { included } = C.fit(sources, { totalChars: 3000, maxSources: 10, perSourceMax: 6000, outputMin: 40 });
    expect(included[0].truncated).toBe(false);
    expect(included[0].text.length).toBe(sources[0].chars);
    expect(included[1].truncated).toBe(true);
    const total = included.reduce((n, s) => n + s.text.length, 0);
    expect(total).toBeLessThanOrEqual(3000);
    expect(included[1].text.length).toBeGreaterThan(1000);
  });

  it('leaves out a source with no text and one past the source limit, with the reason', () => {
    const sources = C.normalizeSources([src('a', para(3)), src('b', ''), src('c', para(3)), src('d', para(3))]);
    const { included, omitted } = C.fit(sources, { totalChars: 5000, maxSources: 2, perSourceMax: 6000, outputMin: 40 });
    expect(included.map(s => s.n)).toEqual([1, 3]);
    expect(omitted[2]).toMatch(/no readable text/);
    expect(omitted[4]).toMatch(/only 2 sources fit/);
  });
});

describe('buildPrompt', () => {
  const included = C.normalizeSources([src('Alpha', 'alpha body'), src('Beta', 'beta body')]);
  it('numbers the sources, names the allowed numbers and carries the shape of the document', () => {
    const p = C.buildPrompt({ kind: 'comparison', included, title: 'GPUs', instruction: 'focus on price' });
    expect(p.system).toMatch(/\[1\] \[2\]/);
    expect(p.system).toMatch(/no facts of your own/);
    expect(p.user).toMatch(/\[1\] Alpha \(https:\/\/example\.com\/Alpha\)/);
    expect(p.user).toMatch(/\[2\] Beta/);
    expect(p.user).toMatch(/markdown table/);
    expect(p.user).toMatch(/titled "GPUs"/);
    expect(p.user).toMatch(/focus on price/);
  });

  it('has a shape for each of the four kinds and refuses another', () => {
    for (const k of ['report', 'checklist', 'comparison', 'study']) {
      expect(C.buildPrompt({ kind: k, included }).user.length).toBeGreaterThan(50);
    }
    expect(C.buildPrompt({ kind: 'checklist', included }).user).toMatch(/- \[ \]/);
    expect(() => C.buildPrompt({ kind: 'poem', included })).toThrow(/Unknown kind/);
    expect(() => C.buildPrompt({ kind: 'report', included: [] })).toThrow(/nothing to build from/);
  });
});

describe('unwrapReply', () => {
  it('reads the JSON envelope, a fenced one, and plain text', () => {
    expect(C.unwrapReply('{"reply":"# Doc\\n\\nbody"}')).toBe('# Doc\n\nbody');
    expect(C.unwrapReply('```json\n{"reply":"fenced"}\n```')).toBe('fenced');
    expect(C.unwrapReply('# Plain\n\nbody')).toBe('# Plain\n\nbody');
    expect(C.unwrapReply('')).toBe('');
  });
});

describe('readCitations', () => {
  it('collects the numbers cited and strips the ones that name nothing', () => {
    const r = C.readCitations('Good [1] and [2, 9] and [7] and a task - [ ] done [x]', new Set([1, 2, 3]));
    expect([...r.cited].sort()).toEqual([1, 2]);
    expect(r.invalid).toEqual([7, 9]);
    expect(r.text).toContain('[1]');
    expect(r.text).toContain('[2]');
    expect(r.text).not.toContain('[7]');
    expect(r.text).not.toContain('9]');
    expect(r.text).toContain('- [ ] done [x]');
  });

  it('strips a Sources list the model wrote itself', () => {
    expect(C.stripTrailingSources('Body [1]\n\n## Sources\n\n1. x\n2. y')).toBe('Body [1]');
    expect(C.stripTrailingSources('Body only')).toBe('Body only');
  });
});

describe('compile with a fake model', () => {
  it('builds the document and says which sources it did not use', async () => {
    const ask = modelCiting(1, 3);
    const r = await C.compile({
      kind: 'report',
      sources: [src('One', para(5)), src('Two', para(5)), src('Three', para(5)), src('Blank', '   ')],
      ask, title: 'Quarterly look', now: Date.UTC(2026, 9, 16),
    });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(r.coverage.used.map(s => s.n)).toEqual([1, 3]);
    expect(r.coverage.unused.map(s => s.n)).toEqual([2, 4]);
    expect(r.markdown).toMatch(/^# Quarterly look/);
    expect(r.markdown).toMatch(/## Sources/);
    expect(r.markdown).toMatch(/1\. \[One\]\(https:\/\/example\.com\/One\) \(tab\)/);
    expect(r.markdown).toMatch(/Used 2 of 4: 1, 3\./);
    expect(r.markdown).toMatch(/These 2 sources were not used:/);
    expect(r.markdown).toMatch(/\[2\] \[Two\].* - was not cited in the document/);
    expect(r.markdown).toMatch(/\[4\] \[Blank\].* - had no readable text/);
    expect(r.markdown).toMatch(/the local model fake-model:1b on 2026-10-16/);
    expect(r.model).toBe('fake-model:1b');
  });

  it('says so when every source was used, and singular for one unused', async () => {
    const all = await C.compile({ kind: 'checklist', sources: [src('A', para(4)), src('B', para(4))], ask: modelCiting(1, 2) });
    expect(all.markdown).toMatch(/All 2 sources were used: 1, 2\./);
    expect(all.coverage.unused).toEqual([]);
    const one = await C.compile({ kind: 'study', sources: [src('A', para(4)), src('B', para(4))], ask: modelCiting(1) });
    expect(one.markdown).toMatch(/This source was not used:/);
  });

  it('removes citations of sources that were never given and warns', async () => {
    const ask = vi.fn(async () => ({ text: '# T\n\nA claim [1][5]. Another [8].\n\nMore text here to be long enough.', model: 'm' }));
    const r = await C.compile({ kind: 'report', sources: [src('A', para(4))], ask });
    expect(r.markdown).not.toMatch(/\[5\]|\[8\]/);
    expect(r.warnings.join(' ')).toMatch(/cited source numbers 5, 8/);
  });

  it('warns when nothing is cited and when a source was shortened', async () => {
    const ask = vi.fn(async () => ({ text: 'A document with no citations at all, long enough to pass the length check.', model: 'm' }));
    const r = await C.compile({ kind: 'report', sources: [src('Big', para(2000))], ask });
    expect(r.warnings.join(' ')).toMatch(/cited no source/);
    expect(r.warnings.join(' ')).toMatch(/Source 1 was shortened/);
    expect(r.coverage.unused.map(s => s.n)).toEqual([1]);
  });

  it('refuses without sources, without readable text, without a model, and on an empty answer', async () => {
    await expect(C.compile({ kind: 'report', sources: [], ask: modelCiting(1) })).rejects.toThrow(/at least one/);
    await expect(C.compile({ kind: 'report', sources: [src('A', '')], ask: modelCiting(1) })).rejects.toThrow(/readable text/);
    await expect(C.compile({ kind: 'report', sources: [src('A', para(3))] })).rejects.toThrow(/No model/);
    await expect(C.compile({ kind: 'nope', sources: [src('A', para(3))], ask: modelCiting(1) })).rejects.toThrow(/Choose what to make/);
    await expect(C.compile({ kind: 'report', sources: [src('A', para(3))], ask: async () => ({ text: '{"reply":"ok"}' }) })).rejects.toThrow(/almost nothing/);
  });

  it('puts the same numbers in the prompt as in the saved source list', async () => {
    let seen = '';
    const ask = async (p) => { seen = p.user; return { text: '# T\n\nClaim [2]. And a longer line to pass the check.', model: 'm' }; };
    const r = await C.compile({ kind: 'report', sources: [src('First', para(3)), src('Second', para(3))], ask });
    expect(seen).toMatch(/\[1\] First/);
    expect(seen).toMatch(/\[2\] Second/);
    expect(r.markdown).toMatch(/2\. \[Second\]/);
  });
});

describe('the model it asks', () => {
  let store;
  beforeEach(() => {
    store = {};
    globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  });
  afterEach(() => { delete globalThis.AIRouter; delete globalThis.localStorage; });

  const router = (backendWanted, fail) => {
    const calls = [];
    globalThis.AIRouter = {
      resolveBackend: vi.fn(async () => backendWanted),
      callOn: vi.fn(async (backend, feature, request) => {
        calls.push({ backend, feature, request });
        if (fail) throw new Error('connection refused');
        return { result: '{"reply":"hi"}', model: 'llama' };
      }),
      _calls: calls,
    };
    return globalThis.AIRouter;
  };

  it('is the local model, even when Vex is set to the cloud one, unless the box is ticked', async () => {
    const r = router('cloud');
    expect(C.cloudAllowed()).toBe(false);
    await C.askModel({ system: 's', user: 'u' });
    expect(r.callOn).toHaveBeenCalledTimes(1);
    expect(r._calls[0].backend).toBe('local');
    expect(r.resolveBackend).not.toHaveBeenCalled();
  });

  it('is the cloud one only when ticked AND Vex is already set to the cloud', async () => {
    C.setCloudAllowed(true);
    let r = router('cloud');
    await C.askModel({ system: 's', user: 'u' });
    expect(r._calls[0].backend).toBe('cloud');
    r = router('local');
    await C.askModel({ system: 's', user: 'u' });
    expect(r._calls[0].backend).toBe('local');
  });

  it('does not try another backend when the local one fails', async () => {
    const r = router('cloud', true);
    await expect(C.askModel({ system: 's', user: 'u' })).rejects.toThrow(/nothing was sent anywhere else/);
    expect(r.callOn).toHaveBeenCalledTimes(1);
  });

  it('hands the document prompt to the model as its persona, not as a chat turn', async () => {
    const r = router('local');
    await C.askModel({ system: 'SYSTEM TEXT', user: 'USER TEXT' });
    const req = r._calls[0].request;
    expect(req.message).toBe('USER TEXT');
    expect(req.persona.systemPrompt).toBe('SYSTEM TEXT');
    expect(req.conversationHistory).toEqual([]);
  });
});

describe('run: providers to a saved note', () => {
  afterEach(() => { delete globalThis.NotesPanel; C._providers = []; });

  it('reads the picked sources, builds, and saves a note', async () => {
    const saved = [];
    globalThis.NotesPanel = { notes: saved, save: vi.fn(), renderList: vi.fn() };
    C.registerProvider({
      id: 'fake', label: 'Fake source', kind: 'fake',
      list: async () => [{ id: 'x', title: 'X' }],
      read: async (id) => (id === 'bad' ? Promise.reject(new Error('gone')) : para(6)),
    });
    const r = await C.run({
      kind: 'report',
      picks: [{ provider: 'fake', id: 'x', title: 'Fake X', url: 'https://f.example/x' }, { provider: 'fake', id: 'bad', title: 'Fake bad' }],
      ask: async () => ({ text: '# R\n\nA claim about X [1]. Longer than forty characters for sure.', model: 'm' }),
    });
    expect(saved).toHaveLength(1);
    expect(saved[0].content).toBe(r.markdown);
    expect(saved[0].tags).toEqual(['compiled', 'report']);
    expect(r.coverage.unused.map(s => s.title)).toEqual(['Fake bad']);
    expect(r.warnings.join(' ')).toMatch(/Could not read: Fake bad: gone/);
  });

  it('refuses a provider that cannot list and read', () => {
    expect(() => C.registerProvider({ id: 'x' })).toThrow(/list\(\) and read\(\)/);
  });
});
