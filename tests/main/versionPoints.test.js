// The version comes from the ranked commits since the last release (the
// owner's point system, 2026-10-10): size x kind x reach, and every 10 points
// move the middle number.
import { describe, it, expect } from 'vitest';
const { parseRank, nextVersion, readOverrides, score } = require('../../scripts/version-points.js');

describe('a rank', () => {
  it('scores size x kind x reach, rounded', () => {
    expect(parseRank('security-high-some').points).toBe(8);
    expect(parseRank('fix-high-everyone').points).toBe(6);
    expect(parseRank('fix-small-some').points).toBe(1);
    expect(parseRank('feature-critical-everyone').points).toBe(21);
    expect(parseRank('polish-small-rare').points).toBe(0);
    expect(parseRank('none').points).toBe(0);
  });

  it('refuses anything it cannot read', () => {
    for (const bad of ['', 'fix', 'fix-huge-some', 'bug-small-some', 'fix-small-some-extra']) {
      expect(() => parseRank(bad)).toThrow(/bad rank/);
    }
  });
});

describe('the next version', () => {
  it('treats the middle and last numbers as one counter', () => {
    expect(nextVersion('2.39.0', 47)).toBe('2.43.7');
    expect(nextVersion('2.43.7', 2)).toBe('2.43.9');
    expect(nextVersion('2.43.9', 1)).toBe('2.44.0');
    expect(nextVersion('2.38.1', 3)).toBe('2.38.4');
  });

  it('never leaves the first number, carries an old patch above 9, and needs points', () => {
    expect(nextVersion('2.99.5', 10)).toBe('2.100.5');
    expect(nextVersion('2.32.65', 1)).toBe('2.38.6');
    expect(() => nextVersion('2.39.0', 0)).toThrow(/no points/);
  });
});

describe('ranking the commits', () => {
  const commits = [
    { hash: 'aaaaaaa111', subject: 'Lock', body: 'Lock fixed\n\nRank: security-high-some\nCo-Authored-By: x' },
    { hash: 'bbbbbbb222', subject: 'Test only', body: 'Rank: none' },
    { hash: 'ccccccc333', subject: 'Old commit', body: 'no rank line' },
  ];

  it('reads Rank lines, lets release-ranks.txt fill gaps and win, and lists what is unranked', () => {
    let s = score(commits, new Map());
    expect(s.total).toBe(8);
    expect(s.unranked.map(r => r.subject)).toEqual(['Old commit']);

    s = score(commits, readOverrides('# owner changes\nccccccc fix-mid-everyone\naaaaaaa security-mid-some  # not that big'));
    expect(s.total).toBe(3 + 4);
    expect(s.unranked).toEqual([]);
  });

  it('refuses a release-ranks.txt line it cannot read', () => {
    expect(() => readOverrides('zzz fix-small-some')).toThrow(/cannot read/);
    expect(() => readOverrides('abcdef1 fix-giant-some')).toThrow(/bad rank/);
  });
});
