// @vitest-environment jsdom
//
// T3-004 retry on the other AI backend (once, said aloud, never past the sensitivity gate or the cap)
// and T3-093 the daily cap on cloud AI calls (js/ai-spend-cap.js, js/ai-router.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let AIRouter, VexAISpend, fetchAI, ledger;

function cloudOk(result = '{"reply":"from the cloud"}') {
  return vi.fn(async () => ({ ok: true, json: async () => ({ result }) }));
}

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
  fetchAI = cloudOk();
  window.VexConfig = { aiWorkerUrl: () => 'https://worker.example/ai', fetchAI: (...a) => fetchAI(...a) };
  globalThis.VexJobs = { every: () => ({ stop() {} }) };
  globalThis.Ollama = { ping: vi.fn(async () => false), generate: vi.fn(async () => '{"reply":"from local"}'), chat: vi.fn(async () => '{"reply":"from local"}'), getBaseUrl: () => 'http://127.0.0.1:11434' };
  ({ AIRouter } = fresh(JS + 'ai-router.js'));
});
afterEach(() => { delete globalThis.VexAISpend; delete globalThis.VexSensitivity; delete globalThis.VexLedger; delete globalThis.Ollama; delete globalThis.VexJobs; delete window.VexConfig; vi.useRealTimers(); });

describe('the daily cap (VexAISpend)', () => {
  it('has no cap until one is set, and never says "reached" without one', () => {
    expect(VexAISpend.cap()).toBe(0);
    for (let i = 0; i < 50; i++) VexAISpend.count('chat');
    expect(VexAISpend.reached()).toBe(false);
    expect(VexAISpend.line()).toMatch(/No cap\. 50 cloud calls/);
  });

  it('counts per feature and is reached exactly at the cap', () => {
    VexAISpend.setCap(3);
    VexAISpend.count('chat'); VexAISpend.count('chat');
    expect(VexAISpend.reached()).toBe(false);
    VexAISpend.count('summarize');
    expect(VexAISpend.reached()).toBe(true);
    expect(VexAISpend.byFeature()).toEqual({ chat: 2, summarize: 1 });
    expect(VexAISpend.line()).toMatch(/Cap reached: 3 of 3/);
  });

  it('starts at zero on a new day and keeps the cap', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 16, 22, 0));
    VexAISpend.setCap(2); VexAISpend.count('chat'); VexAISpend.count('chat');
    expect(VexAISpend.reached()).toBe(true);
    vi.setSystemTime(new Date(2026, 9, 17, 0, 5));
    expect(VexAISpend.used()).toBe(0);
    expect(VexAISpend.cap()).toBe(2);
    expect(VexAISpend.reached()).toBe(false);
  });

  it('refuses a cap that is not a whole number from 0 up', () => {
    for (const bad of [-1, 1.5, 'abc', 1e9]) expect(() => VexAISpend.setCap(bad)).toThrow(/whole number/);
  });

  it('raises on a saved value it cannot read instead of pretending there is none', () => {
    localStorage.setItem('vex.aiSpend', '{nope');
    expect(() => VexAISpend.cap()).toThrow(/not readable/);
  });

  it('writes the downgrade to the ledger once a day and says it', () => {
    VexAISpend.setCap(1); VexAISpend.count('chat');
    VexAISpend.noteDowngrade('chat'); VexAISpend.noteDowngrade('summarize');
    expect(ledger.note).toHaveBeenCalledTimes(1);
    expect(window.showToast.mock.calls.some(c => /limit \(1 calls\) is used up/.test(c[0]))).toBe(true);
  });
});

describe('the router and the cap', () => {
  it('counts a cloud answer', async () => {
    VexAISpend.setCap(5);
    const out = await AIRouter.callOn('cloud', 'chat', { message: 'hello' });
    expect(out.backend).toBe('cloud');
    expect(VexAISpend.used()).toBe(1);
  });

  it('with the cap reached and no local model, fails with a plain sentence and sends nothing', async () => {
    VexAISpend.setCap(1); VexAISpend.count('chat');
    await expect(AIRouter.callOn('cloud', 'chat', { message: 'hello' })).rejects.toMatchObject({ code: 'vex-spend-cap', message: expect.stringMatching(/limit of 1 cloud AI calls is used up, and no local model is running/) });
    expect(fetchAI).not.toHaveBeenCalled();
    expect(VexAISpend.used()).toBe(1);
  });

  it('with the cap reached and a local model running, answers locally and says so', async () => {
    Ollama.ping.mockResolvedValue(true);
    await AIRouter.refreshOllamaStatus();
    VexAISpend.setCap(1); VexAISpend.count('chat');
    const out = await AIRouter.callOn('cloud', 'chat', { message: 'hello' });
    expect(out.backend).toBe('local');
    expect(fetchAI).not.toHaveBeenCalled();
    expect(ledger.note).toHaveBeenCalledTimes(1);
    expect(window.showToast.mock.calls.some(c => /ran on your local model/.test(c[0]))).toBe(true);
  });
});

describe('retry on the other backend', () => {
  beforeEach(async () => {
    Ollama.ping.mockResolvedValue(true);
    await AIRouter.refreshOllamaStatus();
  });

  it('retries once on local when the cloud fails, says so, and marks the answer', async () => {
    fetchAI = vi.fn(async () => { throw new Error('Failed to fetch'); });
    const seen = [];
    document.addEventListener('vex:ai-fallback', (e) => seen.push(e.detail));
    const out = await AIRouter.callAI('chat', { message: 'hi' });
    expect(out.backend).toBe('local');
    expect(out.fellBackFrom).toBe('cloud');
    expect(out.fallbackReason).toMatch(/Failed to fetch/);
    expect(fetchAI).toHaveBeenCalledTimes(1);
    expect(Ollama.generate).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ feature: 'chat', from: 'cloud', to: 'local' });
    expect(window.showToast.mock.calls.some(c => /the cloud AI failed .* your local model answered "chat" instead/.test(c[0]))).toBe(true);
  });

  it('names both failures when the retry fails too, and tries nothing a third time', async () => {
    fetchAI = vi.fn(async () => { throw new Error('cloud down'); });
    Ollama.generate.mockRejectedValue(new Error('model not loaded'));
    await expect(AIRouter.callAI('chat', { message: 'hi' })).rejects.toThrow(/Both cloud \(cloud down\) and local \(model not loaded\) AI failed/);
    expect(fetchAI).toHaveBeenCalledTimes(1);
    expect(Ollama.generate).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to the cloud when the person chose Private local', async () => {
    AIRouter.setPreferLocal(true);
    Ollama.generate.mockRejectedValue(new Error('model not loaded'));
    await expect(AIRouter.callAI('chat', { message: 'hi' })).rejects.toThrow(/Not falling back to cloud/);
    expect(fetchAI).not.toHaveBeenCalled();
  });

  it('does not retry on the cloud once the cap is reached', async () => {
    let calls = 0;
    window.VexConfig.aiWorkerUrl = () => (calls++ === 0 ? '' : 'https://worker.example/ai');
    Ollama.generate.mockRejectedValue(new Error('model not loaded'));
    VexAISpend.setCap(2); VexAISpend.count('chat'); VexAISpend.count('chat');
    await expect(AIRouter.callAI('translate', { message: 'hi' })).rejects.toThrow(/Not retried on the cloud: today's cloud limit of 2 calls is used up/);
    expect(fetchAI).not.toHaveBeenCalled();
  });

  it('never retries mail on the cloud, even when local failed first', async () => {
    // Local is chosen for this request (the cloud address is empty at the moment of choosing), fails,
    // and the cloud is the "other" backend: a mail request would have to be asked about, so it is not retried.
    let calls = 0;
    window.VexConfig.aiWorkerUrl = () => (calls++ === 0 ? '' : 'https://worker.example/ai');
    Ollama.generate.mockRejectedValue(new Error('model not loaded'));
    const req = { dataClass: 'mail', message: 'summarise this', pageContext: { url: 'https://mail.google.com/mail/u/0/', title: 'Inbox', text: 'Hello there' } };
    await expect(AIRouter.callAI('translate', req)).rejects.toThrow(/Not retried on the cloud: this request holds something that is only sent to the cloud when you say so/);
    expect(fetchAI).not.toHaveBeenCalled();
  });
});
