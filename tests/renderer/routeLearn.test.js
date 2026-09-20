// @vitest-environment jsdom
//
// Learning which of your sentences are tasks. This changes what happens when
// you press Enter, so it has to be careful: one correction must not flip
// everything, a single weak word must not overturn a rule, and what it holds
// must stay small and forgettable.
import { describe, it, expect, beforeEach } from 'vitest';
const { RouteLearn: R } = require('../../src/renderer/js/route-learn.js');
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');

beforeEach(() => {
  localStorage.clear();
  globalThis.RouteLearn = R;
});

describe('what it keeps', () => {
  it('the words that carry meaning, not the filler', () => {
    expect(R.words('hey vex can you please check the build')).toEqual(['check', 'build']);
  });

  it('one correction leans, it does not decide', () => {
    R.learn('check the build', true);
    expect(R.lean('check the build')).toBe(2);           // two words, one point each
    expect(R.lean('check')).toBe(1);
  });

  it('corrections the other way cancel out', () => {
    R.learn('check the build', true);
    R.learn('check the build', false);
    expect(R.lean('check the build')).toBe(0);
    expect(R.size()).toBe(0);
  });

  it('one word said all week cannot outvote everything', () => {
    for (let i = 0; i < 40; i++) R.learn('deploy', true);
    expect(R.lean('deploy')).toBeLessThanOrEqual(5);
  });

  it('it stays a short list', () => {
    for (let i = 0; i < 500; i++) R.learn('word' + i + ' something', true);
    expect(R.size()).toBeLessThanOrEqual(R.MAX_WORDS);
  });

  it('forgetting empties it', () => {
    R.learn('check the build', true);
    R.forget();
    expect(R.size()).toBe(0);
  });
});

describe('what it changes', () => {
  it('a clear lean overturns the guess', () => {
    R.learn('check the build', true);
    expect(R.decide('check the build', false)).toMatchObject({ agent: true, changed: true });
  });

  it('a single weak word does not', () => {
    R.learn('ponder', true);                              // one word, one point
    expect(R.decide('ponder this', false)).toMatchObject({ agent: false, changed: false });
  });

  it('nothing learned leaves the rules alone', () => {
    expect(R.decide('what is the capital of France', false).agent).toBe(false);
    expect(R.decide('open youtube', true).agent).toBe(true);
  });
});

describe('through the panel', () => {
  it('a correction is learned, and the next plain sentence follows it', () => {
    // The rules read this as a question, not a task.
    expect(AIPanel.routeMessage('is the build broken').agent).toBe(false);
    // Correct it twice, the way a person would.
    AIPanel.routeMessage('/agent is the build broken');
    AIPanel.routeMessage('/agent is the build broken');
    const out = AIPanel.routeMessage('is the build broken');
    expect(out.agent).toBe(true);
    expect(out.learned).toBe(true);
  });

  it('agreeing with the rules teaches nothing \u2014 there was no correction', () => {
    AIPanel.routeMessage('/agent open youtube');
    expect(R.size()).toBe(0);
  });

  it('the text still comes back without the slash command', () => {
    expect(AIPanel.routeMessage('/chat open youtube')).toMatchObject({ agent: false, text: 'open youtube' });
  });
});
