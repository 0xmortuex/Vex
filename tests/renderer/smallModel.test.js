// @vitest-environment jsdom
//
// A second, smaller local model for the jobs nobody is watching. The risk is
// the opposite of the feature: the chat or the agent quietly answering on a
// small model the user did not choose for them.
import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  globalThis.VexJobs = { every: () => ({ stop: () => {} }) };
});

const router = () => {
  delete require.cache[require.resolve('../../src/renderer/js/ai-router.js')];
  return require('../../src/renderer/js/ai-router.js').AIRouter;
};

describe('which model answers', () => {
  it('everything uses the one model until a small one is named', () => {
    const R = router();
    R.setModel('qwen3.5:14b');
    expect(R.modelFor('chat')).toBe('qwen3.5:14b');
    expect(R.modelFor('historyIndex')).toBe('qwen3.5:14b');
  });

  it('routine work goes to the small model, chat and the agent do not', () => {
    const R = router();
    R.setModel('qwen3.5:14b');
    R.setSmallModel('llama3.2:1b');
    for (const feature of R.routineFeatures()) expect(R.modelFor(feature), feature).toBe('llama3.2:1b');
    expect(R.modelFor('chat')).toBe('qwen3.5:14b');
    expect(R.modelFor('agent')).toBe('qwen3.5:14b');
    expect(R.modelFor('summarize')).toBe('qwen3.5:14b');
  });

  it('clearing it puts everything back on one model', () => {
    const R = router();
    R.setModel('qwen3.5:14b');
    R.setSmallModel('llama3.2:1b');
    R.setSmallModel('   ');
    expect(R.getSmallModel()).toBe('');
    expect(R.modelFor('historyIndex')).toBe('qwen3.5:14b');
  });

  it('the choice is remembered', () => {
    const R = router();
    R.setSmallModel('llama3.2:1b');
    expect(JSON.parse(localStorage.getItem('vex.localSmallModel'))).toBe('llama3.2:1b');
  });
});
