// Release notes between two versions for the dependency radar (src/main/dev-feeds.js notes(), T1-031),
// against local stand-ins. No real service is called.
import { describe, it, expect } from 'vitest';

const { createDevFeeds, githubRepoOf, selectNotes, breakingLines } = require('../../src/main/dev-feeds');

function stub(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const u = new URL(url);
    const r = routes[u.host + u.pathname];
    if (r instanceof Error) throw r;
    if (!r) return new Response('nope', { status: 404 });
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}), { status: r.status || 200 });
  };
  fn.calls = calls;
  return fn;
}

const REL = [
  { tag_name: 'v4.0.0', name: 'v4', html_url: 'https://github.com/o/r/releases/tag/v4.0.0', body: '## BREAKING: the config file is now .toml\n- other' },
  { tag_name: 'v3.1.0', name: 'v3.1', html_url: 'https://github.com/o/r/releases/tag/v3.1.0', body: 'Adds a flag' },
  { tag_name: 'v3.0.5', name: 'v3.0.5', body: 'Fix' },
  { tag_name: 'v3.0.0', name: 'v3.0.0', body: 'BREAKING CHANGE: dropped old API' },
  { tag_name: 'v5.0.0-beta', prerelease: true, body: 'BREAKING' },
  { tag_name: 'v2.9.0', body: 'old' },
];

describe('release notes between two versions', () => {
  it('names the github.com repository from the registry text, and nothing else', () => {
    expect(githubRepoOf('git+https://github.com/vitest-dev/vitest.git')).toBe('vitest-dev/vitest');
    expect(githubRepoOf('git@github.com:o/r.git')).toBe('o/r');
    expect(githubRepoOf('https://gitlab.com/o/r')).toBe('');
    expect(githubRepoOf('')).toBe('');
  });
  it('keeps the releases after the version in use up to the newest, newest first, with BREAKING lines picked out', () => {
    const r = selectNotes(REL, '3.0.0', '4.0.0');
    expect(r.map(x => x.version)).toEqual(['4.0.0', '3.1.0', '3.0.5']);
    expect(r[0].breaking).toBe(true);
    expect(r[0].breakingLines[0]).toContain('BREAKING');
    expect(r[1].breaking).toBe(false);
    expect(selectNotes(REL, '2.0.0', '4.0.0').find(x => x.version === '3.0.0').breaking).toBe(true);
  });
  it('reads words, not a part of another word', () => {
    expect(breakingLines('this is unbreakable\nBreaking change: x')).toEqual(['Breaking change: x']);
  });
  it('notes() reads the registry, then the releases through the given GitHub reader, and says when there is no repository', async () => {
    const f = stub({ 'registry.npmjs.org/pkg/latest': { body: { version: '4.0.0', repository: { url: 'git+https://github.com/o/r.git' } } }, 'registry.npmjs.org/nogit/latest': { body: { version: '1.0.0' } } });
    const seen = [];
    const d = createDevFeeds({ fetch: f, publicFetch: stub({}), github: async (p) => { seen.push(p); return { ok: true, status: 200, text: JSON.stringify(REL) }; } });
    const n = await d.notes('npm', 'pkg', '3.0.0', '4.0.0');
    expect(seen).toEqual(['/repos/o/r/releases?per_page=100']);
    expect(n.repo).toBe('o/r');
    expect(n.releases[0].breaking).toBe(true);
    for (const c of f.calls) expect(c.init.credentials).toBe('omit');
    const none = await d.notes('npm', 'nogit', '1.0.0', '2.0.0');
    expect(none.releases).toEqual([]);
    expect(none.note).toMatch(/does not name a public GitHub repository/);
    await expect(d.notes('npm', 'pkg', 'x y', '4.0.0')).rejects.toThrow(/not a version/);
    await expect(d.notes('npm', '../x', '1.0.0', '2.0.0')).rejects.toThrow(/not a package name/);
  });
  it('a GitHub refusal is raised, not turned into an empty list', async () => {
    const f = stub({ 'registry.npmjs.org/pkg/latest': { body: { version: '4.0.0', repository: 'github:o/r' } } });
    const d = createDevFeeds({ fetch: f, publicFetch: stub({}), github: async () => ({ ok: false, status: 403, text: '' }) });
    await expect(d.notes('npm', 'pkg', '3.0.0', '4.0.0')).rejects.toThrow(/GitHub answered 403/);
  });
});
