// @vitest-environment jsdom
//
// T2-079: duplicate watcher alerts collapse into one, alerts wait in the Inbox
// by default, instant is opt-in, nothing is lost, and with it off the watchers
// speak exactly as before.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { WatchAlerts } = require('../../src/renderer/js/watch-alerts.js');
const { PageWatch } = require('../../src/renderer/js/page-watch.js');
const { GitHubWatch } = require('../../src/renderer/js/github-watch.js');

let suggest, notify, now;
const t0 = 1e12;

beforeEach(() => {
  localStorage.clear();
  WatchAlerts._recent.clear(); WatchAlerts._count = 0;
  now = t0;
  WatchAlerts._now = () => now;
  suggest = vi.fn(() => true);
  notify = vi.fn((opts, show) => { show(); return { route: 'toast' }; });
  globalThis.VexAttention = { suggest, notify };
  window.showToast = vi.fn();
  window.vex = {};
  window.VexProblems = { note: vi.fn() };
  delete globalThis.WatchAlertsOff;
});

const alert = (over = {}) => ({ source: 'page-watch', entity: 'https://github.com/Me/Repo/releases', title: 'Repo changed', url: 'https://github.com/Me/Repo/releases', show: vi.fn(), ...over });

describe('what is one thing', () => {
  it('a GitHub repository is the same whatever page or watcher saw it', () => {
    expect(WatchAlerts.entityOf('https://github.com/Me/Repo/releases/tag/v2')).toBe('github.com/me/repo');
    expect(WatchAlerts.entityOf('https://www.Shop.com/item/?utm=1#x')).toBe('shop.com/item');
    expect(WatchAlerts.entityOf('patch:Roblox')).toBe('patch:roblox');
  });
});

describe('route', () => {
  it('waits in the Inbox by default and does not call the watcher\'s own toast', () => {
    const a = alert();
    expect(WatchAlerts.route(a)).toBe(true);
    expect(a.show).not.toHaveBeenCalled();
    expect(suggest.mock.calls[0][0]).toMatchObject({ feature: 'watch-alerts', id: 'github.com/me/repo', title: 'Repo changed', action: { key: 'open' } });
    expect(notify).not.toHaveBeenCalled();
  });

  it('three watchers on one repo inside 15 minutes make ONE line, with the count', () => {
    WatchAlerts.route(alert());
    now += 60000;
    WatchAlerts.route(alert({ source: 'github-watch', entity: 'https://github.com/me/repo', title: 'New release of me/repo' }));
    now += 60000;
    WatchAlerts.route(alert({ source: 'page-watch' }));
    expect(WatchAlerts.collapsed()).toBe(2);
    const last = suggest.mock.calls.at(-1)[0];
    expect(last.id).toBe('github.com/me/repo');
    expect(last.body).toMatch(/Seen 3 times, also by GitHub watch/);
    expect(new Set(suggest.mock.calls.map(c => c[0].id)).size).toBe(1);
  });

  it('after 15 minutes the same thing is a new alert', () => {
    WatchAlerts.route(alert());
    now += 16 * 60000;
    WatchAlerts.route(alert());
    expect(WatchAlerts._recent.get('github.com/me/repo').n).toBe(1);
    expect(suggest).toHaveBeenCalledTimes(2);
  });

  it('different things are different alerts', () => {
    WatchAlerts.route(alert());
    WatchAlerts.route(alert({ entity: 'https://other.com/x', title: 'Other' }));
    expect(new Set(suggest.mock.calls.map(c => c[0].id)).size).toBe(2);
  });

  it('a watcher set to instant speaks through the Attention Budget, once', () => {
    WatchAlerts.setInstant('page-watch', true);
    const a = alert();
    WatchAlerts.route(a);
    WatchAlerts.route(alert({ show: a.show }));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ feature: 'watch-alerts', urgency: 'useful' });
    expect(a.show).toHaveBeenCalledTimes(1);
    expect(suggest).not.toHaveBeenCalled();
  });

  it('is never lost: when the Inbox cannot hold it, it is shown the instant way', () => {
    suggest.mockReturnValue(false);
    const a = alert();
    expect(WatchAlerts.route(a)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(a.show).toHaveBeenCalledTimes(1);
  });

  it('switched off it takes nothing', () => {
    WatchAlerts.setEnabled(false);
    expect(WatchAlerts.route(alert())).toBe(false);
    expect(suggest).not.toHaveBeenCalled();
  });

  it('refuses a bad call', () => {
    expect(() => WatchAlerts.route(alert({ source: 'mystery' }))).toThrow(/Unknown watcher/);
    expect(() => WatchAlerts.route(alert({ title: '' }))).toThrow(/title/);
    expect(() => WatchAlerts.route(alert({ show: null }))).toThrow(/own way of showing/);
    expect(() => WatchAlerts.setInstant('mystery', true)).toThrow(/Unknown watcher/);
  });

  it('raises a damaged instant list', () => {
    localStorage.setItem('vex.watchAlerts.instant', '{x');
    expect(() => WatchAlerts.instantSources()).toThrow(/could not be read/);
  });
});

describe('the watchers', () => {
  beforeEach(() => { globalThis.WatchAlerts = WatchAlerts; });

  it('with it on, a page watch change waits for the digest instead of a toast', () => {
    PageWatch.announce({ title: 'Price', url: 'https://shop.com/x', kind: 'number' }, { why: 'went down from 10 to 9' });
    expect(window.showToast).not.toHaveBeenCalled();
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it('with it off, a page watch change toasts as before', () => {
    WatchAlerts.setEnabled(false);
    PageWatch.announce({ title: 'Price', url: 'https://shop.com/x', kind: 'number' }, { why: 'went down from 10 to 9' });
    expect(window.showToast).toHaveBeenCalledTimes(1);
  });

  it('a GitHub run and the page watch on the same repo make one alert', () => {
    PageWatch.announce({ title: 'Releases', url: 'https://github.com/me/repo/releases', kind: 'text' }, { why: 'x' });
    GitHubWatch.announce('Deploy passed', 'https://github.com/me/repo/actions/runs/1', { kind: 'run', owner: 'me', repo: 'repo', success: true });
    expect(new Set(suggest.mock.calls.map(c => c[0].id)).size).toBe(1);
    expect(WatchAlerts.collapsed()).toBe(1);
  });

  it('the event the briefs listen to still fires', () => {
    const seen = [];
    document.addEventListener('vex:github-watch', (e) => seen.push(e.detail));
    GitHubWatch.announce('Deploy passed', 'https://x.com', { kind: 'run', owner: 'me', repo: 'repo', success: true });
    expect(seen).toHaveLength(1);
  });
});
