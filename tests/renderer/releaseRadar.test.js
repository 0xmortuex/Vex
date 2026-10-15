// @vitest-environment jsdom
//
// Release radar (js/patch-radar.js, ReleaseRadar): only products the person
// uses — from history, installed extensions or GitHub watches — are looked up
// or listed, and nothing is asked of GitHub before the person agrees.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let R;
const NOW = new Date(2030, 0, 15, 12, 0).getTime();
const visits = (host, n, ageDays = 1) => Array.from({ length: n }, (_, i) => ({ url: 'https://' + host + '/p' + i, title: 't', time: NOW - ageDays * 86400000 }));

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  window.showToast = vi.fn();
  window.VexTabPolicy = { isPrivateWindow: false };
  window.vex = { extensionsList: async () => [] };
  globalThis.GitHubWatch = { list: () => [], _get: vi.fn(async (path) => ({ tag_name: 'v1.2.3', name: 'One two three', published_at: new Date(NOW - 86400000).toISOString(), html_url: 'https://github.com' + path, body: 'notes' })) };
  await import('../../src/renderer/js/resume-workday.js');
  await import('../../src/renderer/js/patch-radar.js');
  R = window.ReleaseRadar;
});

afterEach(() => { delete globalThis.GitHubWatch; delete window.vex; vi.restoreAllMocks(); });

describe('who counts as used', () => {
  it('a site visited often enough, an extension, a watched repo', () => {
    localStorage.setItem('vex.history', JSON.stringify([...visits('ollama.com', 4), ...visits('nodejs.org', 1)]));
    const used = R.usedProducts([{ name: 'uBlock Origin' }], ['someone/tool'], NOW);
    const names = used.map(u => u.product.name);
    expect(names).toContain('Ollama');
    expect(names).toContain('uBlock Origin');
    expect(names).toContain('someone/tool');
    expect(names).not.toContain('Node.js');          // one visit is not use
  });

  it('visits older than sixty days do not count', () => {
    localStorage.setItem('vex.history', JSON.stringify(visits('ollama.com', 10, 90)));
    expect(R.usedProducts([], [], NOW)).toEqual([]);
  });

  it('a product nobody shows use of is never listed', () => {
    expect(R.usedProducts([], [], NOW)).toEqual([]);
  });
});

describe('looking up', () => {
  beforeEach(() => {
    localStorage.setItem('vex.history', JSON.stringify(visits('ollama.com', 5)));
  });

  it('asks only for the matched repository, and keeps the answer six hours', async () => {
    const r = await R.refresh({ now: NOW });
    expect(GitHubWatch._get).toHaveBeenCalledTimes(1);
    expect(GitHubWatch._get.mock.calls[0][0]).toBe('/repos/ollama/ollama/releases/latest');
    expect(r.items[0]).toMatchObject({ name: 'Ollama', tag: 'v1.2.3', unseen: true, recent: true });
    await R.refresh({ now: NOW + 3600000 });
    expect(GitHubWatch._get).toHaveBeenCalledTimes(1);
    await R.refresh({ now: NOW + 7 * 3600000 });
    expect(GitHubWatch._get).toHaveBeenCalledTimes(2);
  });

  it('a failed lookup is reported, not swallowed', async () => {
    GitHubWatch._get.mockRejectedValueOnce(new Error('GitHub answered 500'));
    const r = await R.refresh({ now: NOW });
    expect(r.errors[0]).toMatch(/Ollama.*500/);
    expect(r.items).toEqual([]);
  });

  it('marking seen clears "new"', async () => {
    await R.refresh({ now: NOW });
    R.markSeen('ollama/ollama');
    expect(R.items(undefined, undefined, NOW)[0].unseen).toBe(false);
  });

  it('refuses while off and in a private window', async () => {
    window.VexWorkflow.setPref('releaseRadar', false);
    await expect(R.refresh({ now: NOW })).rejects.toThrow(/off/);
    window.VexWorkflow.setPref('releaseRadar', true);
    window.VexTabPolicy.isPrivateWindow = true;
    await expect(R.refresh({ now: NOW })).rejects.toThrow(/private window/);
  });
});
