// @vitest-environment jsdom
//
// The window's side of the GitHub token vault (js/github-vault.js): the token
// is typed once, handed to the main process, and kept nowhere in the window.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const TOKEN = 'github_pat_11ABCDEFG0abcdefghijklmnopqrst_UVWXYZ0123456789';
let G, bridge;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  bridge = {
    githubStatus: vi.fn(async () => ({ has: true, savedAt: 1, quota: { limit: 5000, remaining: 4000, resetAt: 1800000000000 } })),
    githubTokenSet: vi.fn(async () => ({ ok: true })),
    githubTokenClear: vi.fn(async () => ({ ok: true })),
    githubTokenTest: vi.fn(async () => ({ ok: true, kind: 'fine-grained', scopes: [], expires: '', quota: { limit: 5000, remaining: 3999 }, note: 'n' })),
    githubGet: vi.fn(async () => ({ status: 200, ok: true, authed: true, text: '{"a":1}', quota: { limit: 5000, remaining: 3998 } })),
  };
  window.vex = bridge;
  window.showToast = vi.fn();
  globalThis.vexPrompt = vi.fn(async () => TOKEN);
  globalThis.vexConfirm = vi.fn(async () => true);
  delete require.cache[require.resolve('../../src/renderer/js/github-vault.js')];
  ({ GitHubVault: G } = require('../../src/renderer/js/github-vault.js'));
});

describe('entering the token', () => {
  it('asks in a hidden box, hands it to main once, and keeps it nowhere', async () => {
    expect(await G.enter()).toBe(true);
    expect(globalThis.vexPrompt.mock.calls[0][0]).toMatchObject({ password: true });
    expect(bridge.githubTokenSet).toHaveBeenCalledWith(TOKEN);
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain('github_pat');
    expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain('github_pat');
    expect(document.documentElement.innerHTML).not.toContain('github_pat');
    expect(JSON.stringify(G)).not.toContain('github_pat');
  });
  it('does nothing when the box is cancelled or empty', async () => {
    globalThis.vexPrompt = vi.fn(async () => null);
    expect(await G.enter()).toBe(false);
    globalThis.vexPrompt = vi.fn(async () => '   ');
    expect(await G.enter()).toBe(false);
    expect(bridge.githubTokenSet).not.toHaveBeenCalled();
  });
  it('shows why a token was refused, and does not hide the error', async () => {
    bridge.githubTokenSet = vi.fn(async () => { throw new Error('That is a classic token'); });
    await expect(G.enter()).rejects.toThrow(/classic/);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('classic'), 'error');
  });
});

describe('reading GitHub', () => {
  it('passes the path on, remembers the quota and parses JSON', async () => {
    expect(await G.json('/repos/o/r/commits')).toEqual({ a: 1 });
    expect(bridge.githubGet).toHaveBeenCalledWith('/repos/o/r/commits', undefined);
    expect(G.quotaText()).toMatch(/3998 of 5000 requests left/);
  });
  it('explains the common refusals', async () => {
    bridge.githubGet = vi.fn(async () => ({ status: 404, ok: false, authed: false, text: '{}' }));
    await expect(G.json('/repos/o/p')).rejects.toThrow(/private repository needs the token/);
    bridge.githubGet = vi.fn(async () => ({ status: 403, ok: false, authed: true, text: '{}', quota: { limit: 5000, remaining: 0 } }));
    await expect(G.json('/repos/o/p')).rejects.toThrow(/limiting requests \(0 of 5000/);
  });
  it('refuses every call while switched off, and keeps the token for later', async () => {
    G.setEnabled(false);
    await expect(G.get('/rate_limit')).rejects.toThrow(/switched off/);
    expect(bridge.githubGet).not.toHaveBeenCalled();
    expect(bridge.githubTokenClear).not.toHaveBeenCalled();
    G.setEnabled(true);
    await expect(G.get('/rate_limit')).resolves.toBeTruthy();
  });
});

describe('testing and revoking', () => {
  it('shows the quota from a test', async () => {
    const r = await G.test();
    expect(r.quota.remaining).toBe(3999);
    expect(G.quotaText()).toMatch(/3999 of 5000/);
  });
  it('revokes only after a confirmation', async () => {
    globalThis.vexConfirm = vi.fn(async () => false);
    expect(await G.revoke()).toBe(false);
    expect(bridge.githubTokenClear).not.toHaveBeenCalled();
    globalThis.vexConfirm = vi.fn(async () => true);
    expect(await G.revoke()).toBe(true);
    expect(bridge.githubTokenClear).toHaveBeenCalled();
    expect(G.quotaText()).toBe('');
  });
});

describe('Wave 5: GitHubVault.fetch routes api.github.com reads through the vault', () => {
  it('sends an api.github.com address to main (no token in the window) and returns a fetch-shaped answer', async () => {
    const r = await G.fetch('https://api.github.com/users/o/repos?per_page=10');
    expect(bridge.githubGet).toHaveBeenCalledWith('/users/o/repos?per_page=10', undefined);
    expect(r.ok).toBe(true);
    expect(await r.json()).toEqual({ a: 1 });
  });
  it('leaves other hosts, and a switched-off vault, to the plain network helper', async () => {
    window.VexNet = { fetch: vi.fn(async () => ({ ok: true, status: 200 })) };
    await G.fetch('https://example.com/x');
    expect(window.VexNet.fetch).toHaveBeenCalledTimes(1);
    G.setEnabled(false);
    await G.fetch('https://api.github.com/users/o');
    expect(window.VexNet.fetch).toHaveBeenCalledTimes(2);
    expect(bridge.githubGet).not.toHaveBeenCalled();
  });
});
