// The version comes from the ranked commits since the last release (the
// owner's point system, 2026-10-10): size x kind x reach, every 10 points move
// the middle number and every 1000 the first.
import { describe, it, expect } from 'vitest';
const { parseRank, nextVersion, readOverrides, readBases, score } = require('../../scripts/version-points.js');

describe('a rank', () => {
  it('scores size x kind x reach, rounded', () => {
    expect(parseRank('security-high-some').points).toBe(100);
    expect(parseRank('fix-high-everyone').points).toBe(75);
    expect(parseRank('fix-small-some').points).toBe(10);
    expect(parseRank('feature-critical-everyone').points).toBe(225);
    expect(parseRank('feature-evo-everyone').points).toBe(300);
    expect(parseRank('polish-small-rare').points).toBe(3);
    expect(parseRank('none').points).toBe(0);
  });

  it('refuses anything it cannot read', () => {
    for (const bad of ['', 'fix', 'fix-huge-some', 'bug-small-some', 'fix-small-some-extra']) {
      expect(() => parseRank(bad)).toThrow(/bad rank/);
    }
  });
});

describe('the next version', () => {
  it('treats all three numbers as one counter', () => {
    expect(nextVersion('13.40.5', 1250)).toBe('14.65.5');
    expect(nextVersion('13.39.9', 1)).toBe('13.40.0');
    expect(nextVersion('13.99.9', 1)).toBe('14.0.0');
    expect(nextVersion('13.39.9', 10)).toBe('13.40.9');
  });

  it('carries an old middle above 99 or patch above 9, and needs points', () => {
    expect(nextVersion('2.110.6', 1)).toBe('3.10.7');
    expect(nextVersion('2.32.65', 1)).toBe('2.38.6');
    expect(() => nextVersion('13.39.9', 0)).toThrow(/no points/);
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
    expect(s.total).toBe(100);
    expect(s.unranked.map(r => r.subject)).toEqual(['Old commit']);

    s = score(commits, readOverrides('# owner changes\nccccccc fix-mid-everyone\naaaaaaa security-mid-some  # not that big'));
    expect(s.total).toBe(38 + 50);
    expect(s.unranked).toEqual([]);
  });

  it('refuses a release-ranks.txt line it cannot read', () => {
    expect(() => readOverrides('zzz fix-small-some')).toThrow(/cannot read/);
    expect(() => readOverrides('abcdef1 fix-giant-some')).toThrow(/bad rank/);
  });
});

describe('what a release counts as', () => {
  it('reads base lines, which rank lines ignore', () => {
    const text = 'base v2.38.1 13.39.9  # every older commit ranked\nabcdef1 fix-small-some';
    expect(readBases(text).get('v2.38.1')).toBe('13.39.9');
    expect([...readOverrides(text).keys()]).toEqual(['abcdef1']);
    expect(() => readBases('base 2.38.1 13.39.9')).toThrow(/cannot read/);
  });

  it('the recorded history adds up to the base it claims, above every released version', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const ranks = readOverrides(fs.readFileSync(path.join(root, 'ranks-history.txt'), 'utf8'));
    const total = [...ranks.values()].reduce((n, r) => n + parseRank(r).points, 0);
    expect(ranks.size).toBe(759);
    const base = readBases(fs.readFileSync(path.join(root, 'release-ranks.txt'), 'utf8')).get('v2.38.1');
    expect(nextVersion('0.0.0', total)).toBe(base);
    expect(Number(base.split('.')[0])).toBeGreaterThan(2);
  });
});
