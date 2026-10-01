// @vitest-environment jsdom
//
// With no model ever chosen, the agent ran on llama3.2:3b, installed or not,
// and in a test it liked ten posts when asked to like one (2026-09-27). It now
// gets the best installed model that can call tools, up to 14B; a model the
// user picked is never overridden.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The user's models on 2026-09-28, as Ollama's /api/show describes them.
const INSTALLED = {
  'qwen3.5:latest': { capabilities: ['completion', 'vision', 'tools', 'thinking'], parameterSize: '9.7B' },
  'llama3.2:3b': { capabilities: ['completion', 'tools'], parameterSize: '3.2B' },
  'dolphin-llama3:latest': { capabilities: ['completion'], parameterSize: '8B' },
  'nomic-embed-text:latest': { capabilities: ['embedding'], parameterSize: '137M' },
  'llama3.3:70b': { capabilities: ['completion', 'tools'], parameterSize: '70.6B' },
};

async function router() {
  vi.resetModules();
  globalThis.VexJobs = { every: () => ({ stop() {} }) };
  globalThis.Ollama = {
    ping: vi.fn(async () => true),
    listModels: vi.fn(async () => Object.keys(INSTALLED).map(name => ({ name }))),
    show: vi.fn(async (name) => INSTALLED[name]),
  };
  return (await import('../../src/renderer/js/ai-router.js')).AIRouter;
}
const settle = () => new Promise(r => setTimeout(r, 10));

beforeEach(() => localStorage.clear());

describe('the model the agent gets when none was chosen', () => {
  it('is the largest installed model that can call tools, up to 14B', async () => {
    const R = await router();
    const described = Object.entries(INSTALLED).map(([name, d]) => ({ name, ...d }));
    expect(R.bestInstalledModel(described)).toBe('qwen3.5:latest');
    expect(R.bestInstalledModel(described.filter(m => m.name !== 'qwen3.5:latest'))).toBe('llama3.2:3b');
    expect(R.bestInstalledModel(described.filter(m => !m.capabilities.includes('tools')))).toBeNull();
  });

  it('is picked at start-up when nothing was chosen, without saving it', async () => {
    const R = await router();
    await R.init();
    await settle();
    expect(R.getModel()).toBe('qwen3.5:latest');
    expect(localStorage.getItem('vex.localAIModel')).toBeNull();
  });

  it('never replaces a model the user chose', async () => {
    localStorage.setItem('vex.localAIModel', JSON.stringify('llama3.2:3b'));
    const R = await router();
    await R.init();
    await settle();
    expect(R.getModel()).toBe('llama3.2:3b');
    expect(Ollama.listModels).not.toHaveBeenCalled();
  });

  it('a choice made while it is still looking wins', async () => {
    const R = await router();
    let release;
    Ollama.listModels = vi.fn(() => new Promise(r => { release = () => r(Object.keys(INSTALLED).map(name => ({ name }))); }));
    await R.init();
    R.setModel('llama3.2:3b');
    release();
    await settle();
    expect(R.getModel()).toBe('llama3.2:3b');
  });
});
