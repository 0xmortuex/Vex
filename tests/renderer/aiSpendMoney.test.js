// @vitest-environment jsdom
//
// T3-093 (Wave 6): a money budget for cloud AI from prices the person edits, spent figure estimated after each
// cloud answer, the cloud stopped for the month when it is reached; and the quality history as a table.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let AIRouter, VexAISpend, VexAIMoney, fetchAI, ledger;
const answer = (text, model) => vi.fn(async () => ({ ok: true, json: async () => ({ result: text, ...(model ? { model } : {}) }) }));

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.resetModules();
  window.showToast = vi.fn();
  ledger = { note: vi.fn() };
  globalThis.VexLedger = ledger;
  globalThis.VexSensitivity = fresh(JS + 'ai-sensitivity.js').VexSensitivity;
  ({ VexAISpend } = fresh(JS + 'ai-spend-cap.js'));
  globalThis.VexAISpend = VexAISpend;
  ({ VexAIMoney } = fresh(JS + 'ai-spend-money.js'));
  globalThis.VexAIMoney = VexAIMoney;
  fetchAI = answer('{"reply":"' + 'x'.repeat(400) + '"}', 'claude-sonnet-4');
  window.VexConfig = { aiWorkerUrl: () => 'https://worker.example/ai', fetchAI: (...a) => fetchAI(...a) };
  globalThis.VexJobs = { every: () => ({ stop() {} }) };
  globalThis.Ollama = { ping: vi.fn(async () => false), generate: vi.fn(async () => '{"reply":"from local"}'), chat: vi.fn(async () => '{"reply":"from local"}'), getBaseUrl: () => 'http://127.0.0.1:11434' };
  ({ AIRouter } = fresh(JS + 'ai-router.js'));
});
afterEach(() => { for (const k of ['VexAISpend', 'VexAIMoney', 'VexSensitivity', 'VexLedger', 'Ollama', 'VexJobs']) delete globalThis[k]; delete window.VexConfig; vi.useRealTimers(); });

describe('the price table', () => {
  it('starts empty, refuses a bad row and says which, and keeps a good table', () => {
    expect(VexAIMoney.rates()).toEqual([]);
    expect(() => VexAIMoney.setRates([{ model: '', inPerM: 1, outPerM: 2 }])).toThrow(/Row 1 needs a model name/);
    expect(() => VexAIMoney.setRates([{ model: 'a', inPerM: 1, outPerM: 2 }, { model: 'A', inPerM: 1, outPerM: 2 }])).toThrow(/Row 2: "A" is listed twice/);
    expect(() => VexAIMoney.setRates([{ model: 'a', inPerM: -1, outPerM: 2 }])).toThrow(/Row 1: the price for a million incoming tokens/);
    expect(() => VexAIMoney.setRates([{ model: 'a', inPerM: 1, outPerM: '' }])).toThrow(/outgoing/);
    expect(() => VexAIMoney.setRates('no')).toThrow(/list of rows/);
    VexAIMoney.setRates([{ model: 'claude-sonnet', inPerM: '3', outPerM: '15' }, { model: '*', inPerM: 1, outPerM: 4 }]);
    expect(VexAIMoney.rates()).toEqual([{ model: 'claude-sonnet', inPerM: 3, outPerM: 15 }, { model: '*', inPerM: 1, outPerM: 4 }]);
  });
  it('finds the row by exact name, then by the longest part, then *', () => {
    const rates = [{ model: 'claude', inPerM: 1, outPerM: 1 }, { model: 'claude-sonnet', inPerM: 3, outPerM: 15 }, { model: '*', inPerM: 9, outPerM: 9 }];
    expect(VexAIMoney.rateFor('Claude', rates).inPerM).toBe(1);
    expect(VexAIMoney.rateFor('claude-sonnet-4-20260101', rates).inPerM).toBe(3);
    expect(VexAIMoney.rateFor('mistral', rates).inPerM).toBe(9);
    expect(VexAIMoney.rateFor('mistral', rates.slice(0, 2))).toBe(null);
    expect(VexAIMoney.rateFor('', [{ model: 'claude', inPerM: 1, outPerM: 1 }])).toBe(null);
  });
  it('costs tokens at the price of a million', () => {
    expect(VexAIMoney.cost('m', 1000000, 500000, [{ model: 'm', inPerM: 3, outPerM: 15 }])).toBeCloseTo(10.5);
    expect(VexAIMoney.cost('other', 100, 100, [{ model: 'm', inPerM: 3, outPerM: 15 }])).toBe(null);
  });
  it('counts a request by the text it carries and a picture as 1500 tokens', () => {
    expect(VexAIMoney.requestSize({ message: 'abcd', pageContext: { text: 'x'.repeat(96), title: '' }, conversationHistory: [{ content: 'yy' }] })).toEqual({ chars: 102, images: 0 });
    expect(VexAIMoney.requestSize({ message: 'a', image: 'BASE64' })).toEqual({ chars: 1, images: 1 });
    expect(VexAIMoney.estimateTokens(10)).toBe(3);
    expect(VexAIMoney.answerText({ result: { reply: 'hi' } })).toBe('hi');
  });
});

describe('the figure and the budget', () => {
  it('adds up an estimate after each cloud answer through the router, at the answering model\'s price', async () => {
    VexAIMoney.setRates([{ model: 'claude-sonnet', inPerM: 3, outPerM: 15 }]);
    VexAIMoney.setMoneyCap(100);
    await AIRouter.callOn('cloud', 'chat', { message: 'x'.repeat(4000) });
    const s = VexAIMoney._read();
    expect(s.calls).toBe(1);
    expect(s.tokensIn).toBe(1000);
    expect(s.tokensOut).toBeGreaterThan(90);
    expect(s.spent).toBeCloseTo((1000 * 3 + s.tokensOut * 15) / 1e6, 8);
    expect(s.byModel['claude-sonnet-4'].calls).toBe(1);
    expect(VexAIMoney.line()).toMatch(/About 0\.00\d+ USD spent .* 1 call, 1000 tokens in .*Budget 100 USD: 100 left\./);
  });

  it('a model with no price is counted as a call with no price, never guessed', async () => {
    await AIRouter.callOn('cloud', 'chat', { message: 'hello' });
    const s = VexAIMoney._read();
    expect(s.spent).toBe(0);
    expect(s.unpriced).toBe(1);
    expect(VexAIMoney.line()).toMatch(/1 call had no price in the table/);
  });

  it('when the budget is reached the cloud is not used: a plain error with no local model, the local model with one', async () => {
    VexAIMoney.setRates([{ model: '*', inPerM: 1000, outPerM: 1000 }]);
    VexAIMoney.setMoneyCap(0.01);
    await AIRouter.callOn('cloud', 'chat', { message: 'x'.repeat(4000) });
    expect(VexAIMoney.reached()).toBe(true);
    expect(VexAISpend.reachedWhich()).toBe('money');
    fetchAI.mockClear();
    await expect(AIRouter.callOn('cloud', 'chat', { message: 'again' })).rejects.toMatchObject({ code: 'vex-spend-cap', message: expect.stringMatching(/money budget of 0\.01 USD for cloud AI is used up.*no local model is running/) });
    expect(fetchAI).not.toHaveBeenCalled();
    Ollama.ping.mockResolvedValue(true);
    await AIRouter.refreshOllamaStatus();
    const out = await AIRouter.callOn('cloud', 'chat', { message: 'again' });
    expect(out.backend).toBe('local');
    expect(fetchAI).not.toHaveBeenCalled();
    expect(ledger.note).toHaveBeenCalledTimes(1);
    expect(window.showToast.mock.calls.some(c => /money budget .* ran on your local model/.test(c[0]))).toBe(true);
  });

  it('is not reached with no budget, starts at zero in a new month, and can be started again', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 16, 12, 0));
    VexAIMoney.setRates([{ model: '*', inPerM: 100000, outPerM: 0 }]);
    VexAIMoney.record('chat', { message: 'x'.repeat(4000) }, { result: 'y' });
    expect(VexAIMoney.spent()).toBeGreaterThan(0);
    expect(VexAIMoney.reached()).toBe(false);
    VexAIMoney.setMoneyCap(1);
    expect(VexAIMoney.reached()).toBe(true);
    vi.setSystemTime(new Date(2026, 10, 1, 0, 5));
    expect(VexAIMoney.spent()).toBe(0);
    expect(VexAIMoney.moneyCap()).toBe(1);
    expect(VexAIMoney.reached()).toBe(false);
    VexAIMoney.record('chat', { message: 'x'.repeat(4000) }, { result: 'y' });
    VexAIMoney.forgetMonth();
    expect(VexAIMoney.spent()).toBe(0);
  });

  it('refuses a budget or currency that is not sensible, and reads damage as an error', () => {
    for (const bad of [-1, 'abc', 1e9]) expect(() => VexAIMoney.setMoneyCap(bad)).toThrow(/number from 0/);
    expect(() => VexAIMoney.setCurrency('')).toThrow(/short label/);
    expect(() => VexAIMoney.setCurrency('TOOLONGX')).toThrow(/short label/);
    expect(VexAIMoney.setCurrency('TL')).toBe('TL');
    localStorage.setItem('vex.aiMoney', '{nope');
    expect(() => VexAIMoney.rates()).toThrow(/not readable/);
  });

  it('a failure to add up is reported and never breaks the answer', async () => {
    window.VexProblems = { note: vi.fn() };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const real = Storage.prototype.setItem;
    const quota = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { if (k === 'vex.aiMoney') throw new Error('quota'); return real.call(this, k, v); });
    const out = await AIRouter.callOn('cloud', 'chat', { message: 'hello' });
    expect(out.backend).toBe('cloud');
    expect(window.VexProblems.note).toHaveBeenCalledWith('AI spend', expect.any(String), expect.any(Error));
    quota.mockRestore(); spy.mockRestore();
    delete window.VexProblems;
  });
});

describe('the quality history', () => {
  it('is a table, worst first, with the failure rate, and can be reset', () => {
    VexAISpend.recordOutcome('summarize', 'cloud', true, 1200);
    VexAISpend.recordOutcome('summarize', 'cloud', true, 800);
    for (let i = 0; i < 3; i++) VexAISpend.recordOutcome('digest', 'local', false, 0);
    VexAISpend.recordOutcome('digest', 'local', true, 3000);
    const t = VexAIMoney.qualityTable();
    expect(t[0]).toMatchObject({ feature: 'digest', backend: 'local', ok: 1, fail: 3, rate: 0.75 });
    expect(t[1]).toMatchObject({ feature: 'summarize', backend: 'cloud', ok: 2, fail: 0, rate: 0 });
    VexAIMoney.resetQuality();
    expect(VexAIMoney.qualityTable()).toEqual([]);
  });
  it('opens as a dialog with a row per feature and backend', () => {
    globalThis.VexSettingsGroups = fresh(JS + 'vex-settings-groups.js').VexSettingsGroups || window.VexSettingsGroups;
    VexAISpend.recordOutcome('chat', 'cloud', true, 900);
    VexAIMoney.openQuality();
    const rows = document.querySelectorAll('#vex-ai-quality tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toMatch(/chat.*cloud.*1.*0.*0%/);
    delete globalThis.VexSettingsGroups;
  });
});

describe('wiring', () => {
  it('has a script tag, a manifest, and the router records after every cloud answer', () => {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    expect(fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8')).toMatch(/js\/ai-spend-money\.js/);
    expect(fs.readFileSync(path.join(root, 'src/renderer/js/feature-manifests.js'), 'utf8')).toMatch(/id: 'ai-money'/);
    expect(fs.readFileSync(path.join(root, 'src/renderer/js/ai-router.js'), 'utf8')).toMatch(/VexAIMoney\.record\(feature, request, answer\)/);
  });
});
