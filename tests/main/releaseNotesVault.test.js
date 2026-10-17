// T1-040: the What's New fallback reads GitHub through the vault, never with its own unauthenticated fetch.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createGithubVault, apiUrl } = require('../../src/main/github-vault.js');

const main = fs.readFileSync(path.resolve(__dirname, '../../src/main.js'), 'utf8');
const handler = main.slice(main.indexOf("ipcMain.handle('updates:notes'"), main.indexOf("ipcMain.handle('updates:list'"));

describe('updates:notes fallback', () => {
  it('has no direct api.github.com fetch of its own', () => {
    expect(handler.length).toBeGreaterThan(200);
    expect(handler).not.toMatch(/boundedNetFetch|https:\/\/api\.github\.com/);
    expect(handler).toMatch(/_githubVault\.get\(/);
  });

  it('asks only for paths the vault lists, for the tag and for the latest release', () => {
    expect(apiUrl('/repos/0xmortuex/Vex/releases/tags/v2.35.0')).toBe('https://api.github.com/repos/0xmortuex/Vex/releases/tags/v2.35.0');
    expect(apiUrl('/repos/0xmortuex/Vex/releases/latest')).toBe('https://api.github.com/repos/0xmortuex/Vex/releases/latest');
  });

  it('reads the release through the vault, with the token it holds and without ever returning it', async () => {
    const seen = [];
    const vault = createGithubVault({
      secretStore: { read: async () => ({ token: 'github_pat_' + 'a'.repeat(40) }), write: async () => {}, clear: async () => {} },
      file: 'x.enc',
      fetch: async (url, init) => {
        seen.push({ url, auth: init.headers.Authorization });
        return { ok: true, status: 200, headers: new Map(), arrayBuffer: async () => Buffer.from(JSON.stringify({ tag_name: 'v2.35.0', name: 'N', body: 'B' })) };
      },
    });
    const r = await vault.get('/repos/0xmortuex/Vex/releases/tags/v2.35.0');
    expect(JSON.parse(r.text).tag_name).toBe('v2.35.0');
    expect(seen[0].url).toBe('https://api.github.com/repos/0xmortuex/Vex/releases/tags/v2.35.0');
    expect(seen[0].auth).toMatch(/^Bearer github_pat_/);
    expect(JSON.stringify(r)).not.toMatch(/github_pat_/);
  });
});
