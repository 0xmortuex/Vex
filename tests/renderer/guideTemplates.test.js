// The questions people actually ask, answered before the feature search gets
// a chance to guess. What matters: a complaint ("it's eating my RAM") finds
// the right answer, a template never fires on words that only look similar,
// and the answer is the same shape the panel already renders.
import { describe, it, expect, beforeEach } from 'vitest';
const { GuideTemplates: T } = require('../../src/renderer/js/guide-templates.js');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');

beforeEach(() => { globalThis.VexFeatures = VexFeatures; });

describe('finding the right template', () => {
  it('a complaint, not a question, still lands', () => {
    expect(T.match('vex is using all my ram').id).toBe('memory');
    expect(T.match('too many tabs and I cannot find anything').id).toBe('find-a-tab');
    expect(T.match('how do I stop autoplay on this site').id).toBe('autoplay');
  });

  it('"what can you do" is answered rather than searched for', () => {
    expect(T.match('what can you do').id).toBe('what-can-vex-do');
    expect(T.match('so what can vex do exactly').id).toBe('what-can-vex-do');
  });

  it('the most specific phrase wins', () => {
    expect(T.match('I need two accounts on the same site').id).toBe('two-accounts');
  });

  it('words that merely look similar do not fire one', () => {
    expect(T.match('what is the weather tomorrow')).toBe(null);
    expect(T.match('ram raider game')).toBe(null);
    expect(T.match('')).toBe(null);
  });
});

describe('the answer', () => {
  it('has the shape the guide already returns', () => {
    const a = T.answer('it is using all my ram');
    expect(a).toMatchObject({ found: true, template: 'memory', off: null, others: [] });
    expect(typeof a.headline).toBe('string');
    expect(a.steps.length).toBeGreaterThan(1);
  });

  it('carries the feature to act on, when there is one', () => {
    const a = T.answer('I want two accounts');
    expect(a.entry).toBeTruthy();
    expect(a.entry.id).toBe('containers');
  });

  it('nothing matching is null, so the feature search still gets its turn', () => {
    expect(T.answer('translate this page into french')).toBe(null);
  });

  it('every template points at a feature that exists, and reads like an answer', () => {
    for (const item of T.ITEMS) {
      expect(item.ask.length, item.id).toBeGreaterThan(2);
      expect(item.headline.length, item.id).toBeGreaterThan(30);
      expect(item.steps.length, item.id).toBeGreaterThan(1);
      if (item.feature) expect(VexFeatures.ITEMS.some(f => f.id === item.feature), item.id + ' -> ' + item.feature).toBe(true);
    }
  });
});
