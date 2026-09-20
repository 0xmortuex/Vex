// === Who is live right now =================================================
//
// Twitch and YouTube both say whether a channel is live on the channel's own
// public page — Twitch in the structured data every search engine reads,
// YouTube on its /live address. No account, no API key, no token to expire:
// the same page anyone can open, read for one fact.
//
// One fact is all that is taken: live or not, and what the stream is called.
// Nothing is sent, nothing is logged in, and a channel that is not live is not
// asked about again for a while.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

const clean = (s) => String(s || '')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

const name = (channel) => String((channel && channel.name) || '').trim().replace(/^@/, '');

function url(channel) {
  const n = encodeURIComponent(name(channel));
  return channel.kind === 'twitch' ? 'https://www.twitch.tv/' + n : 'https://www.youtube.com/@' + n;
}

// The page to ask. YouTube answers "is this channel live" only at /live.
function checkUrl(channel) {
  const n = encodeURIComponent(name(channel));
  return channel.kind === 'twitch' ? 'https://www.twitch.tv/' + n : 'https://www.youtube.com/@' + n + '/live';
}

// Twitch puts the answer in the structured data it publishes for search
// engines: isLiveBroadcast, and a description carrying the stream's title.
function twitchStatus(html, status = 200) {
  const page = String(html || '');
  if (status === 404) return { live: false, title: '', gone: true };
  const live = /"isLiveBroadcast"\s*:\s*true/.test(page);
  const description = clean((page.match(/<meta property="og:description" content="([^"]*)"/) || [])[1]);
  // The description reads "<stream title> | Streaming <category> for 227 viewers."
  const title = live ? clean(description.split('|')[0]) : '';
  const viewers = Number(((description.match(/for ([\d,]+) viewers/) || [])[1] || '').replace(/,/g, '')) || null;
  return { live, title, viewers };
}

// YouTube's /live address is the stream when there is one, and a 404 when
// there is not.
function youtubeStatus(html, status = 200) {
  const page = String(html || '');
  if (status === 404) return { live: false, title: '' };
  const live = /"isLiveNow"\s*:\s*true/.test(page);
  const title = clean((page.match(/<title>([^<]*)<\/title>/) || [])[1]).replace(/\s*-\s*YouTube$/, '');
  if (/^404/.test(title)) return { live: false, title: '' };
  return { live, title: live ? title : '' };
}

function statusFrom(channel, html, status) {
  const out = channel.kind === 'twitch' ? twitchStatus(html, status) : youtubeStatus(html, status);
  return { kind: channel.kind, name: name(channel), url: url(channel), ...out };
}

// fetchPage: (url, { headers }) → { ok, status, text }. Injected so this is
// testable, and so the main process keeps its one bounded fetch.
async function check(channels, fetchPage) {
  const list = (Array.isArray(channels) ? channels : []).slice(0, 30);
  return Promise.all(list.map(async (channel) => {
    try {
      const res = await fetchPage(checkUrl(channel), { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
      return statusFrom(channel, res && res.text, res && res.status);
    } catch (err) {
      // A channel that could not be asked about is not "not live" — saying so
      // would quietly stop telling the user about it.
      return { kind: channel.kind, name: name(channel), url: url(channel), live: null, error: err.message };
    }
  }));
}

module.exports = { check, statusFrom, twitchStatus, youtubeStatus, url, checkUrl, UA };
