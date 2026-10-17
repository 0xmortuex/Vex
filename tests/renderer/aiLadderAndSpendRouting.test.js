// @vitest-environment jsdom
//
// Wave 5: T3-004 the last rung of the degrade ladder (extractive) and the persistent "Running on" line,
// and T3-093 the monthly budget, task-difficulty and quality routing, and "answered by X because Y".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let AIRouter, VexAISpend, AIRouteControl, fetchAI;

const PAGE = 'Vex is a browser built on Electron. It keeps your tabs organised in groups and workspaces. '
  + 'The vault stores passwords on this computer and never sends them anywhere. '
  + 'A daily digest lists what changed on the pages you follow. '
  + 'Updates are checked against a signed feed before anything is installed. '
  + 'The weather in the city was mild and the bus ran late again this morning.';

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<div id="ai-panel"><div class="ai-header"></div></div>';
  vi.resetModules();
  window.showToast = vi.fn();
  globalThis.VexLedger = { note: vi.fn() };
  globalThis.VexSensitivity = fresh(JS + 'ai-sensitivity.js').VexSensitivity;
  ({ VexAISpend } = fresh(JS + 'ai-spend-cap.js'));
  globalThis.VexAISpend = VexAISpend;
  fetchAI = vi.fn(async () => ({ ok: true, json: async () => ({ result: '{"reply":"from the cloud"}' }) }));
  window.VexConfig = { aiWorkerUrl: () => 'https://worker.example/ai', fetchAI: (...a) => fetchAI(...a) };
  globalThis.VexJobs = { every: () => ({ stop() {} }) };
  globalThis.Ollama = { ping: vi.fn(async () => false), generate: vi.fn(async () => '{"reply":"from local"}'), chat: vi.fn(async () => '{"reply":"from local"}'), getBaseUrl: () => 'http://127.0.0.1:11434' };
  ({ AIRouter } = fresh(JS + 'ai-router.js'));
  globalThis.AIRouter = AIRouter;
  ({ AIRouteControl } = fresh(JS + 'ai-route-control.js'));
  AIRouteControl._last = null;
  AIRouteControl._wired = false;
});
afterEach(() => { for (const k of ['VexAISpend', 'VexSensitivity', 'VexLedger', 'Ollama', 'VexJobs', 'AIRouter']) delete globalThis[k]; delete window.VexConfig; vi.useRealTimers(); });

describe('T3-093 monthly budget', () => {
  it('refuses a cloud slot once the month is used up, even with no daily cap', () => {
    VexAISpend.setMonthCap(2);
    expect(VexAISpend.reserve('chat')).toBeTruthy();
    expect(VexAISpend.reserve('chat')).toBeTruthy();
    expect(VexAISpend.reserve('chat')).toBe(null);
    expect(VexAISpend.reachedWhich()).toBe('month');
    expect(VexAISpend.limitText()).toMatch(/This month's limit of 2 cloud AI calls/);
    expect(VexAISpend.monthLine()).toMatch(/Monthly budget reached: 2 of 2/);
  });
  it('gives a slot back on release and starts a new month at zero', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 30, 12, 0));
    VexAISpend.setMonthCap(1);
    const t = VexAISpend.reserve('chat');
    expect(VexAISpend.reserve('chat')).toBe(null);
    VexAISpend.release(t);
    expect(VexAISpend.monthUsed()).toBe(0);
    VexAISpend.reserve('chat');
    vi.setSystemTime(new Date(2026, 10, 1, 0, 5));
    expect(VexAISpend.monthUsed()).toBe(0);
    expect(VexAISpend.monthCap()).toBe(1);
    expect(VexAISpend.reserve('chat')).toBeTruthy();
  });
  it('turns the count into an estimate only when a cost per call was given, and rejects nonsense', () => {
    VexAISpend.setMonthCap(100, 0.02);
    VexAISpend.count('chat'); VexAISpend.count('chat');
    expect(VexAISpend.monthLine()).toMatch(/about 0\.04 at 0\.02 a call/);
    expect(() => VexAISpend.setMonthCap(-1)).toThrow(/whole number/);
    expect(() => VexAISpend.setMonthCap(5, -3)).toThrow(/cost per call/);
  });
  it('the router answers on the local model with the month named when the budget is gone', async () => {
    Ollama.ping.mockResolvedValue(true);
    await AIRouter.refreshOllamaStatus();
    VexAISpend.setMonthCap(1); VexAISpend.count('chat');
    const out = await AIRouter.callAI('chat', { message: 'hi' });
    expect(out.backend).toBe('local');
    expect(fetchAI).not.toHaveBeenCalled();
    expect(window.showToast.mock.calls.flat().join(' ')).toMatch(/This month's limit of 1 cloud AI calls/);
  });
});

describe('T3-093 task and quality routing', () => {
  it('has no opinion until it is switched on', () => {
    expect(VexAISpend.routing()).toBe(false);
    expect(VexAISpend.advise('chat', { message: 'hi' }, { localUp: true, cloudOk: true })).toBe(null);
  });
  it('grades the task by size, feature and picture', () => {
    expect(VexAISpend.difficulty('agent', {})).toBe('hard');
    expect(VexAISpend.difficulty('groupTabs', {})).toBe('easy');
    expect(VexAISpend.difficulty('chat', { message: 'hi' })).toBe('easy');
    expect(VexAISpend.difficulty('chat', { message: 'hi', image: 'x' })).toBe('hard');
    expect(VexAISpend.difficulty('summarize', { pageContext: { text: 'x'.repeat(8000) } })).toBe('normal');
    expect(VexAISpend.difficulty('summarize', { pageContext: { text: 'x'.repeat(20000) } })).toBe('hard');
  });
  it('sends easy to local and hard to cloud, and says why', () => {
    VexAISpend.setRouting(true);
    const e = VexAISpend.advise('chat', { message: 'hi' }, { localUp: true, cloudOk: true });
    expect(e.backend).toBe('local');
    expect(e.because).toMatch(/small task/);
    const h = VexAISpend.advise('agent', {}, { localUp: true, cloudOk: true });
    expect(h.backend).toBe('cloud');
    expect(VexAISpend.advise('chat', { message: 'hi' }, { localUp: false, cloudOk: true })).toBe(null);
  });
  it('passes over a backend that failed most of the time, but only with enough history', () => {
    VexAISpend.setRouting(true);
    for (let i = 0; i < 3; i++) VexAISpend.recordOutcome('chat', 'local', false);
    expect(VexAISpend.failRate('chat', 'local')).toBe(null);
    VexAISpend.recordOutcome('chat', 'local', false);
    expect(VexAISpend.failRate('chat', 'local')).toBe(1);
    const a = VexAISpend.advise('chat', { message: 'hi' }, { localUp: true, cloudOk: true });
    expect(a.backend).toBe('cloud');
    expect(a.because).toMatch(/local model failed/);
  });
  it('the router follows the advice for a feature on Auto and marks the answer', async () => {
    Ollama.ping.mockResolvedValue(true);
    await AIRouter.refreshOllamaStatus();
    VexAISpend.setRouting(true);
    const out = await AIRouter.callAI('chat', { message: 'short question' });
    expect(out.backend).toBe('local');
    expect(out.routedBecause).toMatch(/small task/);
    expect(fetchAI).not.toHaveBeenCalled();
  });
  it('never overrides a pin or the Fast cloud choice', async () => {
    Ollama.ping.mockResolvedValue(true);
    await AIRouter.refreshOllamaStatus();
    VexAISpend.setRouting(true);
    AIRouter.setRoutingPrefs({ ...AIRouter.getRoutingPrefs(), chat: 'cloud' });
    const pinned = await AIRouter.callAI('chat', { message: 'short' });
    expect(pinned.backend).toBe('cloud');
    AIRouter.setRoutingPrefs({ ...AIRouter.getRoutingPrefs(), chat: 'auto' });
    AIRouter.setForceCloud(true);
    const forced = await AIRouter.callAI('chat', { message: 'short' });
    expect(forced.backend).toBe('cloud');
  });
  it('the wrapper puts the reason on the answer itself', async () => {
    Ollama.ping.mockResolvedValue(true);
    await AIRouter.refreshOllamaStatus();
    VexAISpend.setRouting(true);
    AIRouteControl.wrap();
    const out = await AIRouter.callAI('chat', { message: 'short question' });
    expect(out.because).toMatch(/^Spend routing: it is a small task/);
    expect(VexAISpend.qualityRows()[0]).toMatchObject({ feature: 'chat', backend: 'local', ok: 1, fail: 0 });
  });
});

describe('T3-004 the extractive rung', () => {
  it('picks the sentences that answer the question, in page order', () => {
    const s = AIRouteControl.extract(PAGE, 'where does the vault store passwords', 2);
    expect(s.join(' ')).toMatch(/vault stores passwords/);
    expect(s.length).toBe(2);
  });
  it('returns nothing for text with no usable sentences', () => {
    expect(AIRouteControl.extract('hi', '', 3)).toEqual([]);
  });
  it('is off until the switch is on', () => {
    expect(AIRouteControl.ladderOn()).toBe(false);
    expect(AIRouteControl.degrade('summarize', { pageContext: { text: PAGE } }, new Error('down'))).toBe(null);
  });
  it('answers a summary from the text, labelled, when every backend failed', () => {
    AIRouteControl.setLadder(true);
    const r = AIRouteControl.degrade('summarize', { pageContext: { text: PAGE } }, new Error('Both cloud (x) and local (y) AI failed'));
    expect(r.backend).toBe('extractive');
    const j = JSON.parse(r.result);
    expect(j.reply).toMatch(/Extracted, not written by a model/);
    expect(j.summary.length).toBeGreaterThan(20);
  });
  it('does not invent an answer when there is no text to extract from', () => {
    AIRouteControl.setLadder(true);
    expect(AIRouteControl.degrade('chat', { message: 'hello' }, new Error('down'))).toBe(null);
    expect(AIRouteControl.degrade('agent', { pageContext: { text: PAGE } }, new Error('down'))).toBe(null);
  });
  it('the wrapper falls to the rung on failure, but rethrows a stop and a sensitivity refusal', async () => {
    AIRouteControl.setLadder(true);
    const real = vi.fn(async () => { throw new Error('Both cloud (a) and local (b) AI failed'); });
    AIRouter.callAI = real; delete AIRouter.__routeControlWrapped;
    AIRouteControl.wrap();
    const out = await AIRouter.callAI('explain', { message: 'what is the vault', pageContext: { text: PAGE } });
    expect(out.backend).toBe('extractive');
    expect(out.because).toMatch(/No AI backend could answer/);
    const ac = new AbortController(); ac.abort();
    await expect(AIRouter.callAI('explain', { pageContext: { text: PAGE }, signal: ac.signal })).rejects.toThrow(/Both cloud/);
    real.mockRejectedValueOnce(Object.assign(new Error('held back'), { code: 'vex-sensitive' }));
    await expect(AIRouter.callAI('explain', { pageContext: { text: PAGE } })).rejects.toThrow(/held back/);
  });
  it('without the switch a failure still throws', async () => {
    AIRouter.callAI = vi.fn(async () => { throw new Error('down'); }); delete AIRouter.__routeControlWrapped;
    AIRouteControl.wrap();
    await expect(AIRouter.callAI('summarize', { pageContext: { text: PAGE } })).rejects.toThrow(/down/);
  });
});

describe('T3-004 the persistent line', () => {
  it('is absent until the ladder is on, then says what runs, and follows the last answer', async () => {
    AIRouteControl.drawLine();
    expect(document.getElementById('ai-running-on')).toBe(null);
    AIRouteControl.setLadder(true);
    expect(document.getElementById('ai-running-on').textContent).toMatch(/^Running on: the cloud AI\./);
    AIRouteControl._last = { backend: 'extractive' };
    AIRouteControl.drawLine();
    expect(document.getElementById('ai-running-on').textContent).toMatch(/no AI backend/);
    AIRouteControl.setLadder(false);
    expect(document.getElementById('ai-running-on')).toBe(null);
  });
});
