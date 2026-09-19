// === Lighter Discord ===========================================================
//
// The Discord panel's memory is mostly pictures: every animated avatar, emoji
// and sticker is decoded frame by frame and kept, and so are the GIFs people
// post, the GIF picker's previews and the pictures in link previews. With
// "Lighter Discord" on (Settings › Performance), those requests are not made:
// avatars, emoji and pictures still appear, just not moving, and link
// previews show their text without the picture.
//
// It is one more rule inside the ad blocker's request hook for the Discord
// session (main.js wireAdblockerOnSession) — a session can have only one such
// hook, so a second one would have silently replaced the ad blocker.

function isHeavyDiscordMedia(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.toLowerCase();
  // The GIF picker and GIF links.
  if (/(^|\.)tenor\.com$|(^|\.)giphy\.com$/.test(host)) return true;
  // The pictures in link previews (Discord's proxy for other sites' images).
  if (/^images-ext-\d+\.discordapp\.net$/.test(host)) return true;
  if (host === 'cdn.discordapp.com' || host === 'media.discordapp.net') {
    // Animated emoji, avatars and stickers, and posted GIFs.
    if (/\.gif$/i.test(u.pathname)) return true;
    if (u.searchParams.get('animated') === 'true') return true;
  }
  return false;
}

module.exports = { isHeavyDiscordMedia };
