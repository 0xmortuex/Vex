// Following channels, and the rule that makes the notification bearable: a
// channel is announced once when it goes live, and a check that failed never
// counts as "off" — otherwise the next check announces the same stream again.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { LiveChannels: L } = require('../../src/renderer/js/live-channels.js');

const store = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  globalThis.window = { vex: { liveCheck: vi.fn(), notify: vi.fn(async () => true) }, showToast: vi.fn() };
});

describe('following a channel', () => {
  it('takes an address, a handle, or a bare name', () => {
    expect(L.parse('https://www.twitch.tv/lofigirl')).toEqual({ kind: 'twitch', name: 'lofigirl' });
    expect(L.parse('youtube.com/@NASA')).toEqual({ kind: 'youtube', name: 'NASA' });
    expect(L.parse('@NASA')).toEqual({ kind: 'youtube', name: 'NASA' });
    expect(L.parse('lofigirl')).toEqual({ kind: 'twitch', name: 'lofigirl' });
  });

  it('refuses something that is not a channel', () => {
    expect(() => L.parse('https://example.com/whatever')).toThrow(/not a Twitch or YouTube/);
    expect(() => L.parse('  ')).toThrow(/Paste the channel/);
  });

  it('the same channel cannot be followed twice', () => {
    L.add('twitch.tv/lofigirl');
    expect(() => L.add('LofiGirl')).toThrow(/already follow/);
    expect(L.list()).toHaveLength(1);
  });

  it('unfollowing takes it off the list', () => {
    L.add('lofigirl');
    L.add('@NASA');
    L.remove('twitch', 'LofiGirl');
    expect(L.list()).toEqual([{ kind: 'youtube', name: 'NASA' }]);
  });
});

describe('what is worth saying out loud', () => {
  const live = { kind: 'twitch', name: 'lofigirl', live: true, title: 'lofi radio', url: 'https://www.twitch.tv/lofigirl' };
  const off = { ...live, live: false, title: '' };
  const unknown = { ...live, live: null, error: 'offline' };

  it('a channel that just went live', () => {
    expect(L.wentLive([live], {}).map(s => s.name)).toEqual(['lofigirl']);
  });

  it('one that was already live is not announced again', () => {
    expect(L.wentLive([live], { 'twitch::lofigirl': true })).toEqual([]);
  });

  it('one that went off and came back is announced again', () => {
    L._remember([live]);
    L._remember([off]);
    expect(L.wentLive([live]).map(s => s.name)).toEqual(['lofigirl']);
  });

  it('a check that failed changes nothing \u2014 not off, not announced', () => {
    L._remember([live]);
    L._remember([unknown]);
    expect(L.wentLive([live])).toEqual([]);
  });
});

describe('checking', () => {
  it('tells you once, naming the stream', async () => {
    L.add('lofigirl');
    window.vex.liveCheck = vi.fn(async () => ({ ok: true, statuses: [{ kind: 'twitch', name: 'lofigirl', live: true, title: 'lofi radio' }] }));
    await L.check();
    expect(window.vex.notify).toHaveBeenCalledWith('lofigirl is live', 'lofi radio');
    window.vex.notify.mockClear();
    await L.check();
    expect(window.vex.notify).not.toHaveBeenCalled();
  });

  it('following nobody asks nothing', async () => {
    expect(await L.check()).toEqual([]);
    expect(window.vex.liveCheck).not.toHaveBeenCalled();
  });

  it('a failure is passed on rather than swallowed', async () => {
    L.add('lofigirl');
    window.vex.liveCheck = vi.fn(async () => ({ ok: false, error: 'no connection' }));
    await expect(L.check()).rejects.toThrow('no connection');
  });
});
