// @vitest-environment jsdom
//
// "Tell me when the build finishes": a GitHub Actions run or a repository's
// releases, asked of GitHub's API, told on the desktop.
import { describe, it, expect, vi, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { GitHubWatch: G } = require('../../src/renderer/js/github-watch.js');

let replies, notified;
beforeEach(() => {
  localStorage.clear();
  replies = {};
  notified = [];
  window.showToast = vi.fn();
  window.vex = { notify: vi.fn(async (t, b) => { notified.push(b); }) };
  window.VexNet = { fetch: vi.fn(async (url) => {
    const r = replies[url.replace(G.API, '')];
    if (!r) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r.shift() };
  }) };
});

describe('what can be watched', () => {
  it('a run, or a repository and its releases', () => {
    expect(G.parse('https://github.com/0xmortuex/Vex/actions/runs/35464144224')).toEqual({ kind: 'run', owner: '0xmortuex', repo: 'Vex', id: '35464144224' });
    expect(G.parse('https://github.com/0xmortuex/Vex/actions/runs/35464144224/job/99')).toMatchObject({ kind: 'run', id: '35464144224' });
    expect(G.parse('https://github.com/0xmortuex/Vex/releases')).toEqual({ kind: 'release', owner: '0xmortuex', repo: 'Vex' });
    expect(G.parse('https://github.com/0xmortuex/Vex')).toMatchObject({ kind: 'release' });
    expect(G.parse('https://github.com/0xmortuex/Vex/issues/3')).toBeNull();
    expect(G.parse('https://example.com/a/b')).toBeNull();
  });
  it('anything else is refused, and the same thing is not watched twice', () => {
    expect(() => G.add('https://example.com')).toThrow(/Open a GitHub Actions run/);
    G.add('https://github.com/o/r/actions/runs/1');
    expect(() => G.add('https://github.com/o/r/actions/runs/1/job/2')).toThrow('already being watched');
  });
});

describe('a run', () => {
  it('says nothing while it runs, then how it ended, and stops watching', async () => {
    G.add('https://github.com/o/r/actions/runs/7');
    replies['/repos/o/r/actions/runs/7'] = [{ status: 'in_progress' }, { status: 'completed', conclusion: 'failure', name: 'Verify Vex', display_title: 'v2.32.38', html_url: 'u' }];
    const t0 = Date.now();
    await G.checkDue(t0);
    expect(notified).toEqual([]);
    await G.checkDue(t0 + 60000);                          // not due yet: two minutes between looks
    expect(window.VexNet.fetch).toHaveBeenCalledTimes(1);
    await G.checkDue(t0 + 2 * 60000 + 1);
    expect(notified).toEqual(['Verify Vex failed — o/r: v2.32.38']);
    expect(G.list()).toEqual([]);
  });
});

describe('releases', () => {
  it('the first look is the baseline; a new tag is news', async () => {
    G.add('https://github.com/o/r/releases');
    replies['/repos/o/r/releases/latest'] = [{ tag_name: 'v1' }, { tag_name: 'v1' }, { tag_name: 'v2', name: 'Version 2' }];
    const t0 = Date.now();
    await G.checkDue(t0);
    await G.checkDue(t0 + 31 * 60000);
    expect(notified).toEqual([]);
    await G.checkDue(t0 + 62 * 60000);
    expect(notified).toEqual(['New release of o/r: Version 2']);
    expect(G.list()).toHaveLength(1);
  });

  it('a repository GitHub will not show says why, on the watch', async () => {
    G.add('https://github.com/o/private');
    await G.checkDue();
    expect(G.list()[0].error).toMatch(/private repositories are not visible/);
  });
});
