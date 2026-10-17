// @vitest-environment jsdom
//
// Simplify item "six AI routing keys": the two routing booleans (vex.preferLocalAI,
// vex.forceCloudAI) are one key, vex.aiRoute. Every saved choice survives the one-time
// migration, and the setters write only the new key.
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function router() {
  vi.resetModules();
  globalThis.VexJobs = { every: () => ({ stop() {} }) };
  globalThis.Ollama = { ping: vi.fn(async () => false), listModels: vi.fn(async () => []), show: vi.fn(async () => ({})) };
  delete globalThis.VexMigrations;
  return (await import('../../src/renderer/js/ai-router.js')).AIRouter;
}

beforeEach(() => localStorage.clear());

describe('migrateRouteKey', () => {
  it.each([
    [{}, 'auto'],
    [{ 'vex.preferLocalAI': 'true' }, 'local'],
    [{ 'vex.forceCloudAI': 'true' }, 'cloud'],
    [{ 'vex.preferLocalAI': 'false', 'vex.forceCloudAI': 'false' }, 'auto'],
    [{ 'vex.preferLocalAI': 'true', 'vex.forceCloudAI': 'true' }, 'cloud'],
  ])('saved %j becomes %s and the old keys are gone', async (saved, expected) => {
    for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
    const R = await router();
    R.migrateRouteKey();
    expect(JSON.parse(localStorage.getItem('vex.aiRoute'))).toBe(expected);
    expect(localStorage.getItem('vex.preferLocalAI')).toBeNull();
    expect(localStorage.getItem('vex.forceCloudAI')).toBeNull();
  });

  it('never overwrites a route that is already saved', async () => {
    localStorage.setItem('vex.aiRoute', JSON.stringify('local'));
    localStorage.setItem('vex.forceCloudAI', 'true');
    const R = await router();
    R.migrateRouteKey();
    expect(JSON.parse(localStorage.getItem('vex.aiRoute'))).toBe('local');
  });
});

describe('init and the setters', () => {
  it('init restores the migrated choice into the router', async () => {
    localStorage.setItem('vex.preferLocalAI', 'true');
    const R = await router();
    await R.init();
    expect(R.getOllamaStatus()).toMatchObject({ preferLocal: true, forceCloud: false });
  });

  it('the setters write only vex.aiRoute', async () => {
    const R = await router();
    await R.init();
    R.setForceCloud(true);
    expect(JSON.parse(localStorage.getItem('vex.aiRoute'))).toBe('cloud');
    R.setPreferLocal(true);
    expect(JSON.parse(localStorage.getItem('vex.aiRoute'))).toBe('local');
    R.setPreferLocal(false);
    expect(JSON.parse(localStorage.getItem('vex.aiRoute'))).toBe('auto');
    expect(localStorage.getItem('vex.preferLocalAI')).toBeNull();
    expect(localStorage.getItem('vex.forceCloudAI')).toBeNull();
  });

  it('a saved route that is not auto, local or cloud raises instead of being guessed', async () => {
    localStorage.setItem('vex.aiRoute', JSON.stringify('sideways'));
    const R = await router();
    await expect(R.init()).rejects.toThrow(/not auto, local or cloud/);
  });
});
