// @vitest-environment jsdom
//
// T3-030: the watchers ask main for the shared polite client (api:request with a polite hint), and
// the hint reaches main exactly as three plain knobs on a GET.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const fs = require('fs');
const path = require('path');

const { AgentTools } = require('../../src/renderer/js/agent-tools.js');
const { GitHubWatch } = require('../../src/renderer/js/github-watch.js');
const { PageWatch } = require('../../src/renderer/js/page-watch.js');

beforeEach(() => { window.vex = { apiRequest: vi.fn(async () => ({ ok: true, status: 200, headers: {}, body: '{}' })) }; });

describe('what the watchers send', () => {
  it('an agent page read carries no polite hint, a page watch does', async () => {
    await AgentTools._get('https://example.com/a');
    expect(window.vex.apiRequest.mock.calls[0][0].polite).toBeUndefined();
    await AgentTools._get('https://example.com/a', { 'If-None-Match': '"x"' }, PageWatch.POLITE);
    expect(window.vex.apiRequest.mock.calls[1][0]).toMatchObject({ publicOnly: true, polite: { background: true } });
  });

  it('the GitHub watch asks through api:request, public only, as a background request', async () => {
    await GitHubWatch._get('/repos/o/r/releases/latest');
    expect(window.vex.apiRequest.mock.calls[0][0]).toMatchObject({ publicOnly: true, egress: 'GitHub watch', polite: { background: true } });
  });

  it('a GitHub watch without the bridge raises instead of using a raw fetch', async () => {
    window.vex = {};
    await expect(GitHubWatch._get('/x')).rejects.toThrow(/not available/);
  });
});

describe('main routes the watchers through the shared client', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../../src/main.js'), 'utf8');
  it('rss, the GitHub vault, the release ticker and api:request use it', () => {
    expect(main).toMatch(/_politeNetFetch\(feedUrl/);
    expect(main).toMatch(/createGithubVault\(\{[^}]*fetch: _politeNetFetch/);
    expect(main).toMatch(/createCastlabsTicker\(\{ fetch: (?:_politeBackgroundFetch|_githubVault\.asFetch\(\))/);
    expect(main).toMatch(/politeAsk && init\.method === 'GET'/);
  });
  it('the cache partition is decided in main, from publicOnly, not by the window', () => {
    expect(main).toMatch(/partition: publicOnly \? 'public' : 'net'/);
  });
});
