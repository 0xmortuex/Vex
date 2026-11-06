// The LRC parser behind synced lyrics (src/main/lyrics-lrc.js), exhaustively: every stamp shape, tags, offset, several stamps on a
// line, enhanced word stamps, empty lines, line endings, junk, caps.
import { describe, it, expect } from 'vitest';

const { parseLrc, parseStamp, cleanPlain, MAX_LINES, MAX_TEXT } = require('../../src/main/lyrics-lrc.js');

describe('parseStamp', () => {
  it.each([
    ['00:00.00', 0], ['00:31.48', 31.48], ['01:20.5', 80.5], ['1:05', 65], ['00:10.123', 10.123], ['02:03:50', 123.5],
    ['99:59.99', 99 * 60 + 59.99], ['120:00.00', 7200], ['0:0.0', 0], [' 00:01.00 ', 1],
  ])('reads %s as %s seconds', (text, secs) => { expect(parseStamp(text)).toBeCloseTo(secs, 5); });
  it.each(['', 'ar:Daft', '00:60.00', '00:75', 'x:y', '00', '00:', ':30', '00:10.', '00:10.1234', '-1:00', '1e3:00', '0:00.00.00'])('rejects %j', (text) => { expect(parseStamp(text)).toBeNull(); });
});

describe('parseLrc', () => {
  it('reads plain stamped lines, in order', () => {
    const r = parseLrc('[00:31.48] Like the legend\n[00:35.40] All ends\n[00:39.83] What keeps');
    expect(r.lines).toEqual([[31.48, 'Like the legend'], [35.4, 'All ends'], [39.83, 'What keeps']]);
  });
  it('sorts lines that arrive out of order, and keeps the file order of equal stamps', () => {
    const r = parseLrc('[00:20.00] b\n[00:10.00] a\n[00:20.00] c');
    expect(r.lines.map((l) => l[1])).toEqual(['a', 'b', 'c']);
  });
  it('handles CRLF, lone CR and a byte order mark', () => {
    expect(parseLrc('﻿[00:01.00]a\r\n[00:02.00]b\r[00:03.00]c').lines.map((l) => l[1])).toEqual(['a', 'b', 'c']);
  });
  it('one text with several stamps becomes several lines', () => {
    const r = parseLrc('[00:10.00][01:20.50]Chorus\n[00:30.00]Verse');
    expect(r.lines).toEqual([[10, 'Chorus'], [30, 'Verse'], [80.5, 'Chorus']]);
  });
  it('allows spaces between stamps', () => {
    expect(parseLrc('[00:10.00] [00:12.00]  twice').lines).toEqual([[10, 'twice'], [12, 'twice']]);
  });
  it('keeps empty lines (the music between verses) so the last words are cleared', () => {
    const r = parseLrc('[00:10.00]words\n[00:15.00]\n[00:20.00]more');
    expect(r.lines).toEqual([[10, 'words'], [15, ''], [20, 'more']]);
  });
  it('reads tags and does not turn them into lines', () => {
    const r = parseLrc('[ar:Daft Punk]\n[ti:Get Lucky]\n[al:RAM]\n[length: 06:07]\n[by:someone]\n[00:01.00]a');
    expect(r.lines).toEqual([[1, 'a']]);
    expect(r.meta).toEqual({ ar: 'Daft Punk', ti: 'Get Lucky', al: 'RAM', length: '06:07', by: 'someone' });
  });
  it('applies [offset:] in milliseconds: positive means the words come earlier', () => {
    expect(parseLrc('[offset:+500]\n[00:10.00]a').lines).toEqual([[9.5, 'a']]);
    expect(parseLrc('[offset:-250]\n[00:10.00]a').lines).toEqual([[10.25, 'a']]);
    expect(parseLrc('[offset: 1000]\n[00:10.00]a').offsetMs).toBe(1000);
  });
  it('never lets the offset push a time below zero', () => {
    expect(parseLrc('[offset:5000]\n[00:01.00]a').lines).toEqual([[0, 'a']]);
  });
  it('ignores a silly offset', () => {
    expect(parseLrc('[offset:abc]\n[00:10.00]a').lines).toEqual([[10, 'a']]);
    expect(parseLrc('[offset:99999999]\n[00:10.00]a').lines).toEqual([[10, 'a']]);
  });
  it('strips enhanced word stamps but keeps the words', () => {
    expect(parseLrc('[00:12.00]<00:12.00>Like <00:12.50>the <00:13.00>legend').lines).toEqual([[12, 'Like the legend']]);
  });
  it('accepts hundredths, thousandths, tenths and none', () => {
    const r = parseLrc('[00:01.5]a\n[00:02.50]b\n[00:03.123]c\n[00:04]d');
    expect(r.lines).toEqual([[1.5, 'a'], [2.5, 'b'], [3.123, 'c'], [4, 'd']]);
  });
  it('skips lines without a stamp and an invalid stamp', () => {
    const r = parseLrc('no stamp here\n[00:75.00]bad seconds\n[Chorus]\n[00:05.00]ok');
    expect(r.lines).toEqual([[5, 'ok']]);
  });
  it('keeps a bracketed word after a stamp as part of the words', () => {
    expect(parseLrc('[00:05.00][Chorus] sing').lines).toEqual([[5, '[Chorus] sing']]);
  });
  it('a tag after a stamp is not read as a tag', () => {
    expect(parseLrc('[00:05.00][ar:x] y').lines).toEqual([[5, '[ar:x] y']]);
    expect(parseLrc('[00:05.00][ar:x] y').meta).toEqual({});
  });
  it('collapses whitespace and removes control characters', () => {
    expect(parseLrc('[00:01.00]  a \t b\u0007c  \n').lines).toEqual([[1, 'a b c']]);
  });
  it('caps a line of text', () => {
    const r = parseLrc('[00:01.00]' + 'x'.repeat(MAX_TEXT * 3));
    expect(r.lines[0][1].length).toBe(MAX_TEXT);
  });
  it('caps the number of lines', () => {
    const big = Array.from({ length: MAX_LINES + 500 }, (_, i) => '[' + String(Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') + '.00]l' + i).join('\n');
    expect(parseLrc(big).lines.length).toBe(MAX_LINES);
  });
  it('allows a long track (minutes past 59)', () => {
    expect(parseLrc('[75:30.00]late').lines).toEqual([[4530, 'late']]);
  });
  it('gives no lines for plain text or empty input, never throws', () => {
    expect(parseLrc('just\nplain\nwords').lines).toEqual([]);
    for (const v of ['', null, undefined, 5, {}, []]) expect(parseLrc(v)).toEqual({ lines: [], meta: {}, offsetMs: 0 });
  });
  it('only the first of a repeated tag counts', () => {
    expect(parseLrc('[ar:first]\n[ar:second]\n[00:01.00]a').meta).toEqual({ ar: 'first' });
  });
  it('produces finite, non-negative, ascending times', () => {
    const r = parseLrc('[00:09.00]c\n[00:01.00]a\n[00:05.00]b\n[offset:300]');
    const times = r.lines.map((l) => l[0]);
    expect(times.every((t) => Number.isFinite(t) && t >= 0)).toBe(true);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('cleanPlain', () => {
  it('folds blank runs, trims line ends, removes control characters', () => {
    expect(cleanPlain('﻿a  \r\n\r\n\r\n\r\nb\u0001c\n')).toBe('a\n\nb c');
  });
  it('gives an empty string for anything that is not text', () => {
    for (const v of [null, undefined, 4, {}]) expect(cleanPlain(v)).toBe('');
  });
  it('caps the length', () => { expect(cleanPlain('x'.repeat(50000)).length).toBe(20000); });
});
