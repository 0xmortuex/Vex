// Cards from highlights. The spacing is the feature, so it is what this
// leans on: right pushes a card further out, wrong brings it back without
// undoing everything, and a highlight never quietly makes two cards.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { Flashcards: F } = require('../../src/renderer/js/flashcards.js');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 20, 12);
const store = {};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  globalThis.window = { showToast: vi.fn() };
});

const highlight = (over = {}) => ({ id: 'h1', text: '  The mitochondrion  is the  powerhouse ', note: 'What does the mitochondrion do?', url: 'https://example.com/bio', title: 'Biology', ...over });

describe('making a card', () => {
  it('the highlight is the answer, your note is the question', () => {
    const card = F.make(highlight(), NOW);
    expect(card.answer).toBe('The mitochondrion is the powerhouse');
    expect(card.question).toBe('What does the mitochondrion do?');
    expect(card.due).toBe(NOW);
    expect(card.step).toBe(0);
  });

  it('with no note of your own there is still a question', () => {
    expect(F.make(highlight({ note: '' }), NOW).question).toBe('What did you highlight here?');
  });

  it('nothing highlighted makes no card', () => {
    expect(() => F.make(highlight({ text: '   ' }), NOW)).toThrow(/nothing highlighted/i);
  });

  it('the same highlight cannot make a second card', () => {
    F.add(highlight(), NOW);
    expect(() => F.add(highlight(), NOW)).toThrow(/already has a card/);
    expect(F.all()).toHaveLength(1);
  });
});

describe('the spacing', () => {
  it('a new card is due at once', () => {
    F.add(highlight(), NOW);
    expect(F.due(NOW)).toHaveLength(1);
  });

  it('getting it right pushes it further out each time', () => {
    const card = F.add(highlight(), NOW);
    expect(F.answer(card.id, true, NOW).due - NOW).toBe(F.STEPS[0] * DAY);
    expect(F.answer(card.id, true, NOW).due - NOW).toBe(F.STEPS[1] * DAY);
    expect(F.answer(card.id, true, NOW).due - NOW).toBe(F.STEPS[2] * DAY);
  });

  it('the wait stops growing at the last step rather than running away', () => {
    const card = F.add(highlight(), NOW);
    for (let i = 0; i < 20; i++) F.answer(card.id, true, NOW);
    expect(F.all()[0].due - NOW).toBe(F.STEPS[F.STEPS.length - 1] * DAY);
  });

  it('getting it wrong brings it back tomorrow, without undoing a month', () => {
    const card = F.add(highlight(), NOW);
    for (let i = 0; i < 4; i++) F.answer(card.id, true, NOW);   // step 4
    const wrong = F.answer(card.id, false, NOW);
    expect(wrong.due - NOW).toBe(F.STEPS[0] * DAY);
    // Two steps back, not back to the beginning: the next right answer waits
    // days again rather than starting from one.
    expect(wrong.step).toBe(2);
    expect(F.answer(card.id, true, NOW).due - NOW).toBe(F.STEPS[2] * DAY);
  });

  it('a brand new card got wrong comes back tomorrow', () => {
    const card = F.add(highlight(), NOW);
    expect(F.answer(card.id, false, NOW).due - NOW).toBe(F.STEPS[0] * DAY);
  });

  it('a card not due yet is not in the pile', () => {
    const card = F.add(highlight(), NOW);
    F.answer(card.id, true, NOW);
    expect(F.due(NOW)).toHaveLength(0);
    expect(F.due(NOW + 2 * DAY)).toHaveLength(1);
  });

  it('how long until the next one, in words', () => {
    expect(F.nextIn(NOW)).toBe('no cards yet');
    const card = F.add(highlight(), NOW);
    expect(F.nextIn(NOW)).toBe('now');
    F.answer(card.id, true, NOW);
    expect(F.nextIn(NOW)).toBe('in 1 day');
  });

  it('answering a card that has been deleted says so', () => {
    expect(() => F.answer('gone', true, NOW)).toThrow(/gone/);
  });
});

describe('from a page of highlights', () => {
  beforeEach(() => {
    globalThis.Annotations = {
      forUrl: () => [
        { id: 'a', text: 'first thing', note: '' },
        { id: 'b', text: 'second thing', note: 'why?' },
      ],
    };
  });

  it('makes one card per highlight, once', () => {
    expect(F.addPage('https://example.com/bio', 'Biology')).toBe(2);
    expect(F.all()).toHaveLength(2);
    expect(() => F.addPage('https://example.com/bio', 'Biology')).toThrow(/Nothing new/);
  });

  it('a page with no highlights says what to do instead', () => {
    globalThis.Annotations = { forUrl: () => [] };
    expect(() => F.addPage('https://example.com/x', '')).toThrow(/highlight something/i);
  });
});
