// Reading "is this channel live" out of a public page. Getting it wrong in
// one direction is a notification about a stream that is not happening; in
// the other it is silence. And a page that could not be fetched must not read
// as "not live", or the next check would announce the same stream again.
import { describe, it, expect, vi } from 'vitest';
const { check, twitchStatus, youtubeStatus, checkUrl, url } = require('../../src/main/live-channels.js');

const twitchPage = (live, desc) => `<html><head>
  <script type="application/ld+json">[{"@type":"VideoObject","publication":{"isLiveBroadcast":${live}}}]</script>
  <meta property="og:description" content="${desc}">
</head></html>`;
const ytPage = (live, title) => `<html><head><title>${title} - YouTube</title></head>
  <body><script>var d = {"isLiveNow":${live},"videoId":"abc"};</script></body></html>`;

describe('Twitch', () => {
  it('live, with the stream\u2019s own title and how many are watching', () => {
    const out = twitchStatus(twitchPage(true, 'lofi hip hop radio | Streaming Music for 227 viewers.'));
    expect(out).toMatchObject({ live: true, title: 'lofi hip hop radio', viewers: 227 });
  });

  it('not live is not live, whatever the page says about the channel', () => {
    expect(twitchStatus(twitchPage(false, 'shroud streams live on Twitch! Check out their videos.')))
      .toMatchObject({ live: false, title: '' });
  });

  it('a channel that does not exist is not live', () => {
    expect(twitchStatus('', 404)).toMatchObject({ live: false, gone: true });
  });

  it('the escaped characters in a title come back as characters', () => {
    expect(twitchStatus(twitchPage(true, 'Bob &amp; Alice&#39;s stream | Streaming Just Chatting for 5 viewers.')).title)
      .toBe("Bob & Alice's stream");
  });
});

describe('YouTube', () => {
  it('live, with the stream title, minus the site name', () => {
    expect(youtubeStatus(ytPage(true, 'Live from the ISS'))).toEqual({ live: true, title: 'Live from the ISS' });
  });

  it('a channel with nothing on answers 404 at its live address', () => {
    expect(youtubeStatus('<html><head><title>404 Not Found</title></head></html>')).toEqual({ live: false, title: '' });
    expect(youtubeStatus('', 404)).toEqual({ live: false, title: '' });
  });

  it('a page without the live marker is not live', () => {
    expect(youtubeStatus(ytPage(false, 'Some channel'))).toMatchObject({ live: false });
  });
});

describe('asking about a list', () => {
  it('asks each channel at the right address', async () => {
    const asked = [];
    const fetchPage = vi.fn(async (target) => { asked.push(target); return { ok: true, status: 200, text: twitchPage(false, '') }; });
    await check([{ kind: 'twitch', name: 'someone' }, { kind: 'youtube', name: '@NASA' }], fetchPage);
    expect(asked).toEqual(['https://www.twitch.tv/someone', 'https://www.youtube.com/@NASA/live']);
  });

  it('a channel that could not be asked about is unknown, not off', async () => {
    const fetchPage = vi.fn(async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); });
    const [out] = await check([{ kind: 'twitch', name: 'someone' }], fetchPage);
    expect(out.live).toBe(null);
    expect(out.error).toMatch(/ERR_NAME_NOT_RESOLVED/);
  });

  it('never asks about more channels than a person would follow', async () => {
    const fetchPage = vi.fn(async () => ({ ok: true, status: 200, text: '' }));
    const many = Array.from({ length: 80 }, (_, i) => ({ kind: 'twitch', name: 'c' + i }));
    expect(await check(many, fetchPage)).toHaveLength(30);
  });

  it('a channel links to where you would watch it', () => {
    expect(url({ kind: 'twitch', name: 'someone' })).toBe('https://www.twitch.tv/someone');
    expect(url({ kind: 'youtube', name: '@NASA' })).toBe('https://www.youtube.com/@NASA');
    expect(checkUrl({ kind: 'youtube', name: 'NASA' })).toBe('https://www.youtube.com/@NASA/live');
  });
});
