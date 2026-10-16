// @vitest-environment jsdom
//
// T2-075: a successful GitHub run for a repo whose site is open offers a
// refresh, only when switched on, only for the right tabs, never by itself.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { RefreshOnDeploy } = require('../../src/renderer/js/refresh-on-deploy.js');

let reloaded, notify;
const run = (over = {}) => ({ kind: 'run', owner: 'Me', repo: 'My-Site', success: true, conclusion: 'success', ...over });

beforeEach(() => {
  localStorage.clear();
  reloaded = [];
  window.showToast = vi.fn();
  window.VexProblems = { note: vi.fn() };
  globalThis.TabManager = { tabs: [
    { id: 1, url: 'https://me.github.io/my-site/', title: 'Site' },
    { id: 2, url: 'https://news.com/', title: 'News' },
    { id: 3, url: 'https://me.github.io/', title: 'Asleep', sleeping: true },
    { id: 4, url: 'https://my-site.vercel.app/x', title: 'Preview' },
  ] };
  globalThis.WebviewManager = { webviews: new Map([[1, { reload: () => reloaded.push(1) }], [4, { reload: () => reloaded.push(4) }]]) };
  notify = vi.fn((opts, show) => { show(); return { route: 'toast' }; });
  globalThis.VexAttention = { notify };
  delete globalThis.VexLedger;
});

describe('which tabs', () => {
  it('finds the usual hosts a repo is served from, skipping sleeping tabs', () => {
    expect(RefreshOnDeploy.tabsFor('Me', 'My-Site').map(t => t.id)).toEqual([1, 4]);
  });
  it('uses the sites the person added, subdomains included', () => {
    RefreshOnDeploy.setSites('me/my-site', ['https://www.news.com/path']);
    expect(RefreshOnDeploy.tabsFor('me', 'my-site').map(t => t.id)).toEqual([1, 2, 4]);
  });
  it('refuses a bad repository or site and raises a damaged list', () => {
    expect(() => RefreshOnDeploy.setSites('nonsense', ['a.com'])).toThrow(/owner\/name/);
    expect(() => RefreshOnDeploy.setSites('a/b', ['not a site'])).toThrow(/like example.com/);
    localStorage.setItem('vex.refreshOnDeploy.sites', '{x');
    expect(() => RefreshOnDeploy.sites()).toThrow(/could not be read/);
  });
});

describe('the offer', () => {
  it('does nothing until switched on', () => {
    expect(RefreshOnDeploy.onWatch(run())).toBe(null);
    expect(notify).not.toHaveBeenCalled();
  });
  it('does nothing for a failed run, a release, or a repo with no open site', () => {
    RefreshOnDeploy.setEnabled(true);
    expect(RefreshOnDeploy.onWatch(run({ success: false, conclusion: 'failure' }))).toBe(null);
    expect(RefreshOnDeploy.onWatch({ kind: 'release', owner: 'me', repo: 'my-site' })).toBe(null);
    expect(RefreshOnDeploy.onWatch(run({ repo: 'other' }))).toBe(null);
    expect(notify).not.toHaveBeenCalled();
  });
  it('offers once through the Attention Budget and reloads only when Refresh is pressed', () => {
    RefreshOnDeploy.setEnabled(true);
    RefreshOnDeploy.onWatch(run());
    expect(notify.mock.calls[0][0]).toMatchObject({ feature: 'refresh-on-deploy', urgency: 'useful', id: 'me/my-site', action: { key: 'refresh' } });
    expect(reloaded).toEqual([]);
    const opts = window.showToast.mock.calls[0][3];
    opts.action.run();
    expect(reloaded).toEqual([1, 4]);
  });
  it('says so when the tab is gone', () => {
    globalThis.TabManager.tabs = [];
    expect(RefreshOnDeploy.refresh('me/my-site')).toBe(0);
    expect(window.showToast.mock.calls.at(-1)[1]).toBe('warn');
  });
});

describe('GitHub watch', () => {
  it('passes the repo and the outcome in its event', async () => {
    const { GitHubWatch } = require('../../src/renderer/js/github-watch.js');
    window.vex = {};
    const seen = [];
    document.addEventListener('vex:github-watch', (e) => seen.push(e.detail));
    GitHubWatch.announce('Deploy passed', 'https://x', { kind: 'run', owner: 'me', repo: 'my-site', success: true });
    expect(seen[0]).toMatchObject({ text: 'Deploy passed', url: 'https://x', kind: 'run', owner: 'me', success: true });
  });
});
