// src/main/maker-repos.js and scripts/update-maker-repos.js ("More from the creator"): only public repositories can ever be
// kept, the refresh asks one fixed address only when called, says why it failed and when GitHub's limit resets, and the
// channels are closed in a private window.
import { describe, it, expect, vi } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMakerRepos, normalizeRepos } = require('../../src/main/maker-repos.js');
const { buildFile } = require('../../scripts/update-maker-repos.js');
const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');

const repo = (over = {}) => ({
  name: 'thing', private: false, fork: false, archived: false, stargazers_count: 3, forks_count: 1, description: 'A  thing\n', language: 'Python',
  topics: ['a', 'b'], license: { spdx_id: 'MIT' }, updated_at: '2026-10-01T00:00:00Z', pushed_at: '2026-10-02T00:00:00Z', homepage: 'https://x.example', owner: { login: '0xmortuex' }, ...over,
});
const headers = (o = {}) => ({ get: (k) => (o[k.toLowerCase()] == null ? null : String(o[k.toLowerCase()])) });
const ok = (list) => ({ ok: true, status: 200, headers: headers(), json: async () => list });

describe('normalizeRepos', () => {
  it('keeps the plain fields and sorts by stars', () => {
    const { repos, dropped } = normalizeRepos([repo({ name: 'low', stargazers_count: 1 }), repo({ name: 'high', stargazers_count: 9 })]);
    expect(dropped).toBe(0);
    expect(repos.map(r => r.name)).toEqual(['high', 'low']);
    expect(repos[0]).toMatchObject({ description: 'A thing', language: 'Python', license: 'MIT', url: 'https://github.com/0xmortuex/high', homepage: 'https://x.example/', fork: false, archived: false });
  });

  it('drops a private repository, one without private:false, and one of someone else', () => {
    const { repos, dropped } = normalizeRepos([
      repo({ name: 'pub' }), repo({ name: 'secret', private: true }), repo({ name: 'unknown', private: undefined }),
      repo({ name: 'internal', visibility: 'internal' }), repo({ name: 'theirs', owner: { login: 'someone' } }),
    ]);
    expect(repos.map(r => r.name)).toEqual(['pub']);
    expect(dropped).toBe(4);
  });

  it('throws for something that is not a list', () => {
    expect(() => normalizeRepos({ message: 'Not Found' })).toThrow(/list/);
  });
});

describe('the snapshot script', () => {
  it('never writes a private repository, even when the payload has one', () => {
    const { body, count, dropped } = buildFile([repo({ name: 'pub' }), repo({ name: 'vex-personal', private: true })], new Date('2026-11-01T00:00:00Z'));
    expect(count).toBe(1);
    expect(dropped).toBe(1);
    expect(body).not.toContain('vex-personal');
    expect(body).toContain('"fetchedAt": "2026-11-01T00:00:00.000Z"');
  });

  it('refuses to write something that looks like a token', () => {
    expect(() => buildFile([repo({ description: 'key ghp_abcdefghijklmnopqrstuvwxyz0123456789' })])).toThrow(/token/);
  });

  it('the shipped snapshot is small, public-only and has a date', () => {
    const file = path.join(__dirname, '../../src/renderer/js/maker-repos-data.js');
    expect(fs.statSync(file).size).toBeLessThan(60 * 1024);
    const { VexMakerReposData: d } = require(file);
    expect(d.login).toBe('0xmortuex');
    expect(Number.isNaN(Date.parse(d.fetchedAt))).toBe(false);
    expect(d.repos.length).toBeGreaterThan(0);
    expect(JSON.stringify(d)).not.toMatch(/vex-personal|"private"/);
    for (const r of d.repos) expect(r.url).toBe('https://github.com/0xmortuex/' + r.name);
  });
});

describe('refresh()', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vex-maker-'));
  const make = (publicFetch, dir = tmp()) => createMakerRepos({ publicFetch, dir, fs, path, now: () => Date.parse('2026-11-01T12:00:00Z') });

  it('asks the one fixed address with no credentials, drops private ones and keeps the copy', async () => {
    const publicFetch = vi.fn(async () => ok([repo({ name: 'pub' }), repo({ name: 'hidden', private: true })]));
    const dir = tmp();
    const svc = make(publicFetch, dir);
    expect(await svc.stored()).toBeNull();
    const got = await svc.refresh();
    expect(publicFetch).toHaveBeenCalledTimes(1);
    const [href, init] = publicFetch.mock.calls[0];
    expect(href).toBe('https://api.github.com/users/0xmortuex/repos?per_page=100&page=1');
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', egress: { feature: 'More from the creator' } });
    expect(init.headers.Authorization).toBeUndefined();
    expect(got.repos.map(r => r.name)).toEqual(['pub']);
    expect(got.fetchedAt).toBe('2026-11-01T12:00:00.000Z');
    const again = await svc.stored();
    expect(again.repos.map(r => r.name)).toEqual(['pub']);
    expect(again.fetchedAt).toBe(got.fetchedAt);
  });

  it('reads up to three pages', async () => {
    const full = (tag) => Array.from({ length: 100 }, (_, i) => repo({ name: tag + i }));
    const publicFetch = vi.fn(async () => ok(full('p' + publicFetch.mock.calls.length + '-')));
    const got = await make(publicFetch).refresh();
    expect(publicFetch).toHaveBeenCalledTimes(3);
    expect(got.repos.length).toBe(300);
  });

  it('says the limit is used up and when it resets, and keeps nothing', async () => {
    const reset = Math.floor(Date.parse('2026-11-01T12:25:00Z') / 1000);
    const dir = tmp();
    const svc = make(async () => ({ ok: false, status: 403, headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }), json: async () => ({}) }), dir);
    await expect(svc.refresh()).rejects.toThrow(/limit .* used up\. It resets at \d\d:\d\d \(in about 25 minutes\)/);
    expect(await svc.stored()).toBeNull();
  });

  it('says what GitHub answered for any other failure, and passes a network failure on', async () => {
    await expect(make(async () => ({ ok: false, status: 500, headers: headers() })).refresh()).rejects.toThrow('GitHub answered 500');
    await expect(make(async () => { throw new Error('offline'); }).refresh()).rejects.toThrow('offline');
  });

  it('contacts nothing until refresh() is called', () => {
    const publicFetch = vi.fn();
    make(publicFetch);
    expect(publicFetch).not.toHaveBeenCalled();
  });
});

describe('the channels', () => {
  const read = (...p) => fs.readFileSync(path.resolve(__dirname, '../..', ...p), 'utf8');
  const PRIVATE_DISABLED = eval(read('src', 'main', 'ipc-policy.js').match(/const PRIVATE_DISABLED = (\/.*\/);/)[1]); // eslint-disable-line no-eval

  it('are Vex-window-only, have a schema and a preload entry, and the fetch is closed in a private window', () => {
    for (const ch of ['makerepos:refresh', 'makerepos:stored']) {
      expect(UI_ONLY_CHANNELS.has(ch), ch).toBe(true);
      expect(read('src', 'main', 'ipc-schemas.js')).toContain(ch);
      expect(read('src', 'preload.js')).toContain("'" + ch + "'");
    }
    expect(PRIVATE_DISABLED.test('makerepos:refresh')).toBe(true);
  });
});
