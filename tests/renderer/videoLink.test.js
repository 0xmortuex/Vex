// @vitest-environment jsdom
//
// js/video-link.js: the pure URL builder (YouTube, Twitch, Vimeo, any page), the clock text, the page reader and the
// copy flow. A link at the current second; refuses cleanly with no video; live streams and clips get the plain link.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { VexVideoLink: V } = require('../../src/renderer/js/video-link.js');
const link = (url, seconds, live) => V.buildLink({ url, seconds, live });
const url = (u, s, l) => { const r = link(u, s, l); if (!r.ok) throw new Error('expected a link: ' + r.message); return r.url; };

describe('clock and Twitch time', () => {
  it('writes the time the way a person reads it', () => {
    expect(V.clock(0)).toBe('0:00');
    expect(V.clock(65)).toBe('1:05');
    expect(V.clock(3725.9)).toBe('1:02:05');
    expect(V.clock(36000)).toBe('10:00:00');
  });
  it('writes Twitch time as h/m/s without empty leading units', () => {
    expect(V.twitchTime(45)).toBe('45s');
    expect(V.twitchTime(60)).toBe('1m0s');
    expect(V.twitchTime(3723)).toBe('1h2m3s');
    expect(V.twitchTime(3600)).toBe('1h0m0s');
  });
  it('whole seconds: floors, nothing under one second, throws for a number that is not one', () => {
    expect(V.wholeSeconds(12.99)).toBe(12);
    expect(V.wholeSeconds(0.4)).toBe(null);
    expect(V.wholeSeconds(0)).toBe(null);
    for (const bad of [-1, NaN, Infinity, '12', null, undefined]) expect(() => V.wholeSeconds(bad)).toThrow(/Could not read the time/);
  });
});

describe('YouTube', () => {
  it('a watch address becomes a youtu.be link with ?t=', () => {
    expect(url('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 90.7)).toBe('https://youtu.be/dQw4w9WgXcQ?t=90');
  });
  it('drops tracking and the old time, whichever form it was in', () => {
    expect(url('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s&si=abc&feature=share', 125)).toBe('https://youtu.be/dQw4w9WgXcQ?t=125');
    expect(url('https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=30#t=5', 125)).toBe('https://youtu.be/dQw4w9WgXcQ?t=125');
    expect(url('https://youtu.be/dQw4w9WgXcQ?t=1m30s&si=x', 200)).toBe('https://youtu.be/dQw4w9WgXcQ?t=200');
  });
  it('keeps a playlist and puts the time after it as &t=<s>s', () => {
    expect(url('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123_abc&index=4', 61)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123_abc&t=61s');
  });
  it('mobile, music and no-cookie hosts work, and a Short or a /live/ or /embed/ address gives the same id', () => {
    for (const u of ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ?feature=share', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=3', 'https://www.youtube.com/live/dQw4w9WgXcQ?si=1', 'https://www.youtube.com/v/dQw4w9WgXcQ']) {
      expect(url(u, 7)).toBe('https://youtu.be/dQw4w9WgXcQ?t=7');
    }
  });
  it('a live stream gets the plain link and says why', () => {
    const r = link('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5', 4000, true);
    expect(r).toMatchObject({ ok: true, note: 'live', seconds: null, url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(V.message(r)).toContain('live stream');
  });
  it('a video at its start gets the plain link', () => {
    expect(link('https://youtu.be/dQw4w9WgXcQ?t=50', 0.3)).toMatchObject({ ok: true, note: 'start', url: 'https://youtu.be/dQw4w9WgXcQ' });
  });
  it('a page that is not one video is refused', () => {
    for (const u of ['https://www.youtube.com/', 'https://www.youtube.com/playlist?list=PL1', 'https://www.youtube.com/@someone', 'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/watch', 'https://www.youtube.com/shorts/']) {
      expect(link(u, 5)).toMatchObject({ ok: false, reason: 'no-video' });
    }
  });
  it('does not mistake another site for YouTube', () => {
    expect(url('https://notyoutube.com/watch?v=dQw4w9WgXcQ', 9)).toBe('https://notyoutube.com/watch?v=dQw4w9WgXcQ#t=9');
    expect(url('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 9)).toBe('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ#t=9');
  });
});

describe('Twitch', () => {
  it('a VOD gets ?t=1h2m3s, replacing an old time and dropping tracking', () => {
    expect(url('https://www.twitch.tv/videos/123456789', 3723)).toBe('https://www.twitch.tv/videos/123456789?t=1h2m3s');
    expect(url('https://www.twitch.tv/videos/123456789?t=5m&sr=a', 45)).toBe('https://www.twitch.tv/videos/123456789?t=45s');
    expect(url('https://m.twitch.tv/videos/123456789', 600)).toBe('https://www.twitch.tv/videos/123456789?t=10m0s');
  });
  it('the old and player forms point at the same VOD', () => {
    expect(url('https://www.twitch.tv/somechannel/v/987', 61)).toBe('https://www.twitch.tv/videos/987?t=1m1s');
    expect(url('https://player.twitch.tv/?video=v555&parent=x.com', 61)).toBe('https://www.twitch.tv/videos/555?t=1m1s');
  });
  it('a live channel and a clip get the plain link with a reason', () => {
    expect(link('https://www.twitch.tv/somechannel', 800)).toMatchObject({ ok: true, note: 'live', url: 'https://www.twitch.tv/somechannel' });
    expect(link('https://clips.twitch.tv/FunnySlug-abc?filter=x', 8)).toMatchObject({ ok: true, note: 'clip', url: 'https://clips.twitch.tv/FunnySlug-abc' });
    expect(link('https://www.twitch.tv/somechannel/clip/FunnySlug', 8)).toMatchObject({ ok: true, note: 'clip' });
    expect(V.message(link('https://clips.twitch.tv/x', 3))).toContain('clip');
  });
  it('a VOD at its start is the plain VOD link', () => {
    expect(link('https://www.twitch.tv/videos/12', 0)).toMatchObject({ ok: true, note: 'start', url: 'https://www.twitch.tv/videos/12' });
  });
});

describe('Vimeo', () => {
  it('uses #t=<s>s', () => {
    expect(url('https://vimeo.com/123456789', 75)).toBe('https://vimeo.com/123456789#t=75s');
  });
  it('finds the id in channel and group addresses, keeps an unlisted hash, drops the rest', () => {
    expect(url('https://vimeo.com/channels/staffpicks/123456789?foo=1', 5)).toBe('https://vimeo.com/123456789#t=5s');
    expect(url('https://vimeo.com/groups/x/videos/123456789', 5)).toBe('https://vimeo.com/123456789#t=5s');
    expect(url('https://vimeo.com/123456789/abcdef0123', 5)).toBe('https://vimeo.com/123456789/abcdef0123#t=5s');
    expect(url('https://player.vimeo.com/video/123456789?h=abcdef0123&autoplay=1', 5)).toBe('https://vimeo.com/123456789/abcdef0123#t=5s');
    expect(url('https://vimeo.com/123456789#t=3s', 40)).toBe('https://vimeo.com/123456789#t=40s');
  });
  it('a Vimeo page that is not one video is refused', () => {
    expect(link('https://vimeo.com/staff', 5)).toMatchObject({ ok: false, reason: 'no-video' });
    expect(link('https://vimeo.com/', 5)).toMatchObject({ ok: false, reason: 'no-video' });
  });
  it('a live event gets the plain link', () => {
    expect(link('https://vimeo.com/123456789', 5000, true)).toMatchObject({ ok: true, note: 'live', url: 'https://vimeo.com/123456789' });
  });
});

describe('any other page: a #t= media fragment', () => {
  it('adds #t=<s> to a plain address and keeps its query', () => {
    expect(url('https://example.com/lecture.mp4', 90.2)).toBe('https://example.com/lecture.mp4#t=90');
    expect(url('https://example.com/watch?id=7&lang=tr', 12)).toBe('https://example.com/watch?id=7&lang=tr#t=12');
  });
  it('replaces an old t= in the fragment, case-insensitively, and keeps the rest of it', () => {
    expect(url('https://example.com/a.mp4#t=10,20', 33)).toBe('https://example.com/a.mp4#t=33');
    expect(url('https://example.com/a.mp4#T=10', 33)).toBe('https://example.com/a.mp4#t=33');
    expect(url('https://example.com/a.mp4#chapter&t=5', 33)).toBe('https://example.com/a.mp4#chapter&t=33');
    expect(url('https://example.com/a.mp4#track=audio&t=5&x=1', 33)).toBe('https://example.com/a.mp4#track=audio&x=1&t=33');
  });
  it('adds to a heading fragment', () => {
    expect(url('https://example.com/page#section-2', 33)).toBe('https://example.com/page#section-2&t=33');
  });
  it('refuses when the page uses the fragment for its own routes', () => {
    expect(link('https://app.example.com/#/video/3', 33)).toMatchObject({ ok: false, reason: 'route-fragment' });
    expect(link('https://app.example.com/#!/watch', 33)).toMatchObject({ ok: false, reason: 'route-fragment' });
  });
  it('a start or a live video leaves the address as it was, fragment included', () => {
    expect(link('https://example.com/a.mp4#/x', 0)).toMatchObject({ ok: true, note: 'start', url: 'https://example.com/a.mp4#/x' });
    expect(link('https://example.com/live.m3u8', 9000, true)).toMatchObject({ ok: true, note: 'live' });
  });
});

describe('what is refused', () => {
  it('addresses that are not web pages', () => {
    for (const u of ['about:blank', 'file:///C:/v.mp4', 'vex://newtab', 'chrome://x', 'javascript:alert(1)', 'data:text/html,hi', '', 'not a url', undefined]) {
      expect(link(u, 5)).toMatchObject({ ok: false, reason: 'not-a-page' });
    }
  });
  it('a time that is not a number', () => {
    expect(link('https://youtu.be/dQw4w9WgXcQ', NaN)).toMatchObject({ ok: false, reason: 'no-time' });
    expect(link('https://youtu.be/dQw4w9WgXcQ', -3)).toMatchObject({ ok: false, reason: 'no-time' });
    expect(link('https://youtu.be/dQw4w9WgXcQ', undefined)).toMatchObject({ ok: false, reason: 'no-time' });
  });
  it('says what it copied, with the time', () => {
    expect(V.message(link('https://youtu.be/dQw4w9WgXcQ', 3725))).toBe('Copied the link at 1:02:05: https://youtu.be/dQw4w9WgXcQ?t=3725');
    expect(V.message(link('https://youtu.be/dQw4w9WgXcQ', 0))).toBe('Copied the link from the start: https://youtu.be/dQw4w9WgXcQ');
  });
});

describe('reading the page and copying', () => {
  beforeEach(() => {
    window.showToast = vi.fn();
    window.vexGuestUrl = (wv) => wv.url;
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  });
  const frames = (...vals) => vi.fn(async () => ({ all: true, results: vals.map(v => ({ ok: true, value: v })) }));

  it('the reader script picks the playing video first, then the biggest, and reports live', () => {
    const mk = (o) => ({ readyState: 4, currentTime: 0, duration: 100, paused: true, getBoundingClientRect: () => ({ width: o.w, height: o.h }), ...o });
    const small = mk({ w: 10, h: 10, paused: false, currentTime: 11 }), big = mk({ w: 100, h: 100, currentTime: 22 }), live = mk({ w: 1, h: 1, duration: Infinity, currentTime: 5 });
    const read = (list, extra = {}) => new Function('document', 'window', 'location', 'getComputedStyle', 'return ' + V.readScript())({ querySelectorAll: () => list, querySelector: () => extra.badge || null }, { top: null }, { href: 'https://x.test/' }, () => ({ display: 'block' }));
    const w = {}; w.top = w;
    expect(read([big, small]).time).toBe(11);               // playing beats biggest
    expect(read([big, mk({ w: 5, h: 5, currentTime: 3 })]).time).toBe(22);
    expect(read([live]).live).toBe(true);
    expect(read([])).toBe(null);
    expect(read([big], { badge: { offsetParent: {} } }).live).toBe(true);   // YouTube's live badge is showing
  });

  it('pick prefers the top frame', () => {
    expect(V.pick([{ ok: true, value: { top: false, time: 1 } }, { ok: true, value: { top: true, time: 2 } }]).time).toBe(2);
    expect(V.pick([{ ok: false }, { ok: true, value: null }])).toBe(null);
  });

  it('copies a link at the current time and says what it copied', async () => {
    const wv = { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1' };
    window.vexGuestEvalFrames = frames({ top: true, time: 754.3, live: false, href: wv.url });
    const r = await V.copyFromWebview(wv);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ?t=754');
    expect(r.seconds).toBe(754);
    expect(window.showToast).toHaveBeenCalledWith('Copied the link at 12:34: https://youtu.be/dQw4w9WgXcQ?t=754', 'info');
  });

  it('refuses cleanly when there is no video, copying nothing', async () => {
    window.vexGuestEvalFrames = frames(null);
    await expect(V.copyFromWebview({ url: 'https://example.com/' })).rejects.toThrow('There is no video on this page');
    await expect(V.copyFromWebview(null)).rejects.toThrow('There is no page open');
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('refuses a page that is not a web page, and a route fragment, copying nothing', async () => {
    window.vexGuestEvalFrames = frames({ top: true, time: 5, live: false, href: 'about:blank' });
    await expect(V.copyFromWebview({ url: 'about:blank' })).rejects.toThrow(/Only a web page/);
    window.vexGuestEvalFrames = frames({ top: true, time: 5, live: false });
    await expect(V.copyFromWebview({ url: 'https://app.example/#/v/1' })).rejects.toThrow(/for its own navigation/);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('a player in a frame is linked by the frame\'s address, but only for a site it knows', async () => {
    window.vexGuestEvalFrames = frames({ top: false, time: 30, live: false, href: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' });
    await V.copyFromWebview({ url: 'https://blog.example/post' });
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('https://youtu.be/dQw4w9WgXcQ?t=30');
    window.vexGuestEvalFrames = frames({ top: false, time: 30, live: false, href: 'https://cdn.example/player.html' });
    await expect(V.copyFromWebview({ url: 'https://blog.example/post' })).rejects.toThrow(/inside another site/);
  });

  it('a clipboard failure is reported, not swallowed', async () => {
    window.vexGuestEvalFrames = frames({ top: true, time: 9, live: false });
    navigator.clipboard.writeText = vi.fn(async () => { throw new Error('denied'); });
    await expect(V.copyFromWebview({ url: 'https://youtu.be/dQw4w9WgXcQ' })).rejects.toThrow('denied');
  });
});

describe('wiring', () => {
  it('is a command, a key, a video menu item and a late module', () => {
    const fs = require('fs'), path = require('path');
    const rd = (f) => fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/' + f), 'utf8');
    expect(rd('command.js')).toMatch(/id: 'copy-video-time'/);
    expect(rd('shortcuts-registry.js')).toMatch(/'copy-video-time': \{ default: 'Ctrl\+Alt\+Shift\+C'.*cmd: 'copy-video-time'/);
    expect(rd('webview.js')).toContain("label: 'Copy Video Link at This Time'");
    expect(rd('lazy-boot.js')).toContain('js/video-link.js');
  });
});
