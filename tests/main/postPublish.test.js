// scripts/post-publish.js — after `npm run publish`, the release is checked
// before the website's badge moves. v2.31.81 went out with no latest.yml and
// no block map: no installed copy could see it, and nothing said so.

import { describe, it, expect } from 'vitest';

const { problems, bumpBadge, REQUIRED } = require('../../scripts/post-publish.js');
const pkg = require('../../package.json');

const whole = (tag) => ({ tagName: tag, isDraft: false, assets: REQUIRED.map(name => ({ name, size: 1000 })) });

describe('post-publish', () => {
  it('a release with the installer, its block map and latest.yml is complete', () => {
    expect(REQUIRED).toEqual(['latest.yml', 'Vex-Setup.exe', 'Vex-Setup.exe.blockmap']);
    expect(problems(whole('v2.31.86'), 'v2.31.86')).toEqual([]);
  });

  it('names everything that is wrong: a draft, a missing asset, an empty one', () => {
    const r = whole('v1.0.0');
    r.isDraft = true;
    r.assets = r.assets.filter(a => a.name !== 'latest.yml');
    r.assets[0].size = 0;
    expect(problems(r, 'v1.0.0')).toEqual(['it is still a draft', 'latest.yml is missing', 'Vex-Setup.exe is empty']);
    expect(problems(whole('v1.0.0'), 'v1.0.1')).toEqual(['the release for v1.0.1 was not found']);
    expect(problems(null, 'v1.0.1')).toEqual(['the release for v1.0.1 was not found']);
  });

  it('moves the badge and nothing else; a page without one is an error', () => {
    const html = '<span>Latest: v2.31.85</span><a href="v2.31.85">notes</a>';
    expect(bumpBadge(html, '2.31.86')).toBe('<span>Latest: v2.31.86</span><a href="v2.31.85">notes</a>');
    expect(bumpBadge(bumpBadge(html, '2.31.86'), '2.31.86')).toBe(bumpBadge(html, '2.31.86'));
    expect(() => bumpBadge('<span>Download</span>', '2.31.86')).toThrow(/no "Latest: vX\.Y\.Z" badge/);
  });

  it('runs after `npm run publish`', () => {
    expect(pkg.scripts.postpublish).toBe('node scripts/post-publish.js');
  });
});
