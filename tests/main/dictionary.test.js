// Wiktionary's answer, turned into a few plain sentences. The card shows this
// text, so anything that is still markup here is markup in the card.
import { describe, it, expect } from 'vitest';
const { readDefinitions, plain } = require('../../src/main/dictionary.js');

describe('taking the markup off', () => {
  it('links, italics and labels become the words inside them', () => {
    expect(plain('The branch of <a href="/wiki/metaphysics">metaphysics</a> that addresses <i>being</i>.'))
      .toBe('The branch of metaphysics that addresses being.');
  });

  it('an editor’s HTML comment is not part of the definition', () => {
    expect(plain('<!--{{senseid|en|Q1}} a note-->A real sense.')).toBe('A real sense.');
  });

  it('entities come back as the characters they stand for', () => {
    expect(plain('2025&#x2D;06 &amp; more &#8212; here &nbsp;now')).toBe('2025-06 & more — here now');
  });

  it('a definition that is only markup is nothing at all', () => {
    expect(plain('<span class="usage-label-sense"></span>')).toBe('');
  });
});

describe('which definitions are kept', () => {
  const data = {
    en: [
      { partOfSpeech: 'Noun', definitions: [{ definition: '' }, { definition: 'A first sense.', examples: ['<i>Used</i> like this.'] }, { definition: 'A second sense.' }, { definition: 'A third sense.' }] },
      { partOfSpeech: 'Verb', definitions: [{ definition: 'To do the thing.', parsedExamples: [{ example: 'He <b>did</b> it.' }] }] },
    ],
    fr: [{ partOfSpeech: 'Nom', definitions: [{ definition: 'Le sens.' }] }],
  };

  it('English only, a couple per part of speech, with the example', () => {
    const out = readDefinitions(data);
    expect(out).toEqual([
      { part: 'noun', def: 'A first sense.', example: 'Used like this.' },
      { part: 'noun', def: 'A second sense.', example: '' },
      { part: 'verb', def: 'To do the thing.', example: 'He did it.' },
    ]);
  });

  it('never more than a card’s worth', () => {
    const many = { en: Array.from({ length: 10 }, (_, i) => ({ partOfSpeech: 'Noun' + i, definitions: [{ definition: 'sense ' + i }] })) };
    expect(readDefinitions(many).length).toBeLessThanOrEqual(5);
  });

  it('a word with no English entry comes back empty, not broken', () => {
    expect(readDefinitions({ fr: [{ partOfSpeech: 'Nom', definitions: [{ definition: 'x' }] }] })).toEqual([]);
    expect(readDefinitions(null)).toEqual([]);
    expect(readDefinitions({ en: 'not a list' })).toEqual([]);
  });
});
