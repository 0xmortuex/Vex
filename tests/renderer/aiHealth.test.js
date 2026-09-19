// @vitest-environment jsdom
//
// "The AI stopped working" had a dozen causes and one symptom: a spinner for
// two minutes, then nothing. Measured: a game and OBS had the card at 7.7 of
// 8 GB, the local model was pushed onto the processor, and the same task that
// took 30 seconds ran past the limit — twice — with no way to tell that from
// a broken install.

import { describe, it, expect, vi, beforeEach } from 'vitest';
const { AIHealth } = require('../../src/renderer/js/ai-health.js');

const GPU_BUSY = { name: 'NVIDIA GeForce RTX 4060', utilization: 92, usedMB: 7708, totalMB: 8188, freeMB: 480, usedPercent: 94 };
const GPU_FREE = { name: 'NVIDIA GeForce RTX 4060', utilization: 8, usedMB: 800, totalMB: 8188, freeMB: 7388, usedPercent: 10 };
const state = (over = {}) => ({ online: true, worker: true, model: 'qwen3.5:latest', ollama: true, installed: ['qwen3.5:latest'], loaded: [], gpu: GPU_FREE, ...over });

beforeEach(() => {
  globalThis.AIRouter = { cloudWorkerUrl: () => 'https://worker.example/', getModel: () => 'qwen3.5:latest', getOllamaStatus: () => ({ preferLocal: false }) };
  globalThis.Ollama = { ping: vi.fn(async () => true), listModels: vi.fn(async () => [{ name: 'qwen3.5:latest' }]), running: vi.fn(async () => []) };
  window.vex = { gpu: vi.fn(async () => GPU_FREE) };
});

describe('why a local request is about to be slow', () => {
  it('the model was pushed onto the processor — the case that cost two runs', () => {
    const why = AIHealth.slowReasonFrom(state({ loaded: [{ name: 'qwen3.5:latest', onGpu: false, vramMB: 100 }], gpu: GPU_BUSY }));
    expect(why).toMatch(/running on the processor, not the graphics card \(NVIDIA GeForce RTX 4060 is 94% full\)/);
    expect(why).toMatch(/expect answers to take minutes/);
  });

  it('not loaded and the card is nearly full — it would not fit', () => {
    expect(AIHealth.slowReasonFrom(state({ gpu: GPU_BUSY }))).toMatch(/Only 0\.5 GB of NVIDIA GeForce RTX 4060 is free/);
  });

  it('not loaded and the card is merely busy', () => {
    expect(AIHealth.slowReasonFrom(state({ gpu: { ...GPU_FREE, utilization: 95 } }))).toMatch(/95% busy, so loading qwen3\.5:latest will be slow/);
  });

  it('nothing to say when the card is free, or when there is no card, or Ollama is down', () => {
    expect(AIHealth.slowReasonFrom(state())).toBe(null);
    expect(AIHealth.slowReasonFrom(state({ gpu: null }))).toBe(null);
    expect(AIHealth.slowReasonFrom(state({ ollama: false, gpu: GPU_BUSY }))).toBe(null);
    expect(AIHealth.slowReasonFrom(state({ loaded: [{ name: 'qwen3.5:latest', onGpu: true }], gpu: GPU_BUSY }))).toBe(null);
  });
});

describe('why it failed', () => {
  const headline = (s, err) => AIHealth.explainFrom(s, err).headline;

  it('names the first thing that is actually wrong, in order', () => {
    expect(headline(state({ online: false }), new Error('fetch failed'))).toMatch(/You are offline/);
    expect(headline(state({ worker: false, ollama: false }))).toMatch(/no AI backend/);
    expect(headline(state({ worker: false, ollama: false, online: false }))).toMatch(/no AI backend/);
    expect(headline(state({ worker: false, ollama: true, installed: [] }))).toMatch(/no models installed/);
    expect(headline(state({ worker: false, installed: ['llama3.2:3b'] }))).toMatch(/"qwen3\.5:latest" is not installed/);
  });

  it('a timeout is explained by the card when the card is the reason', () => {
    expect(headline(state({ gpu: GPU_BUSY }), new Error('Ollama did not answer within 120s'))).toMatch(/Only 0\.5 GB/);
    expect(headline(state(), new Error('Ollama did not answer within 120s'))).toMatch(/longer than the two-minute limit/);
  });

  it('knows the failures that are not failures', () => {
    expect(headline(state(), new Error('Stopped by you'))).toBe('You stopped it — that is not a failure.');
    expect(headline(state(), new Error('qwen3.5 only produced reasoning and no answer'))).toMatch(/spent its whole turn thinking/);
    expect(headline(state())).toBe('Everything Vex can check looks fine.');
  });

  it('lists what it checked, so the answer can be argued with', () => {
    const out = AIHealth.explainFrom(state({ loaded: [{ name: 'qwen3.5:latest', onGpu: false }], gpu: GPU_BUSY }));
    expect(out.lines).toEqual([
      'Cloud AI: configured',
      'Internet: connected',
      'Ollama: running',
      'Model "qwen3.5:latest": installed (1 installed)',
      'Loaded: yes, on the PROCESSOR — this is the slow case',
      'NVIDIA GeForce RTX 4060: 7.5 of 8.0 GB used, 92% busy',
    ]);
  });

  it('a Vex with no worker and no Ollama says so plainly', () => {
    const out = AIHealth.explainFrom(state({ worker: false, ollama: false, gpu: null }));
    expect(out.lines).toEqual(['Cloud AI: no Worker URL set (Settings › AI)', 'Internet: connected', 'Ollama: not running']);
  });
});

describe('gathering the state', () => {
  it('asks every part, and never throws when one of them does', async () => {
    globalThis.Ollama.listModels = vi.fn(async () => { throw new Error('refused'); });
    window.vex.gpu = vi.fn(async () => { throw new Error('no probe'); });
    const s = await AIHealth.check();
    expect(s).toMatchObject({ online: true, worker: true, ollama: true, model: 'qwen3.5:latest', gpu: null, installedError: 'refused' });
  });

  it('does not ask Ollama about models when Ollama is not running', async () => {
    globalThis.Ollama.ping = vi.fn(async () => false);
    const s = await AIHealth.check();
    expect(s.ollama).toBe(false);
    expect(globalThis.Ollama.listModels).not.toHaveBeenCalled();
  });
});

describe('what to do about a slow answer', () => {
  const GB = 1024 ** 3;
  const sizes = { 'qwen3.5:latest': 6.6 * GB, 'llama3.2:3b': 2.0 * GB, 'gemma3:1b': 0.8 * GB, 'nomic-embed-text:latest': 0.3 * GB, 'mistral:7b': 4.1 * GB };

  it('offers the largest smaller model that fits in the free video memory, never an embedding model', () => {
    const gpu = { ...GPU_BUSY, freeMB: 3000 };                       // 2.9 GB free
    expect(AIHealth.alternativesFrom(state({ sizes, gpu }))).toEqual({ smaller: 'llama3.2:3b', cloud: true });
    expect(AIHealth.alternativesFrom(state({ sizes, gpu: { ...GPU_BUSY, freeMB: 900 } })).smaller).toBeNull();   // 0.8 GB × 1.2 does not fit
    expect(AIHealth.alternativesFrom(state({ sizes, gpu: { ...GPU_BUSY, freeMB: 1200 } })).smaller).toBe('gemma3:1b');
  });

  it('no cloud without a worker, or offline', () => {
    expect(AIHealth.alternativesFrom(state({ sizes, worker: false })).cloud).toBe(false);
    expect(AIHealth.alternativesFrom(state({ sizes, online: false })).cloud).toBe(false);
  });

  it('the buttons switch the model, or send that feature to the cloud', () => {
    globalThis.AIRouter.setModel = vi.fn();
    globalThis.AIRouter.setRoutingPrefs = vi.fn();
    window.showToast = vi.fn();
    const box = AIHealth.choices({ smaller: 'llama3.2:3b', cloud: true }, 'chat');
    const [small, cloud] = box.querySelectorAll('button');
    expect(small.textContent).toBe('Use llama3.2:3b instead');
    small.click();
    expect(AIRouter.setModel).toHaveBeenCalledWith('llama3.2:3b');
    expect(cloud.disabled).toBe(true);                               // one choice per warning
    const box2 = AIHealth.choices({ smaller: null, cloud: true }, 'agent');
    box2.querySelector('button').click();
    expect(AIRouter.setRoutingPrefs).toHaveBeenCalledWith({ agent: 'cloud' });
    expect(AIHealth.choices({ smaller: null, cloud: false }, 'chat')).toBeNull();
  });

  it('slowAdvice: nothing when it will not be slow; the reason and the way out when it will', async () => {
    Ollama.listModels = vi.fn(async () => Object.entries(sizes).map(([name, size]) => ({ name, size })));
    expect(await AIHealth.slowAdvice()).toBeNull();
    window.vex.gpu = vi.fn(async () => ({ ...GPU_BUSY, freeMB: 3000, utilization: 20 }));
    Ollama.running = vi.fn(async () => [{ name: 'qwen3.5:latest', onGpu: false }]);
    const advice = await AIHealth.slowAdvice();
    expect(advice.why).toMatch(/running on the processor/);
    expect(advice).toMatchObject({ smaller: 'llama3.2:3b', cloud: true });
  });
});
