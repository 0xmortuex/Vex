// === Lighter Discord ===========================================================
//
// The Discord panel's memory is mostly pictures: every animated avatar, emoji
// and sticker is decoded frame by frame and kept. With "Lighter Discord" on
// (Settings › Performance), the ANIMATED versions of those decorations are not
// fetched; Discord then falls back to the still picture it also has.
//
// Only decoration. Anything someone posts or links — an image, a GIF, a
// Tenor/Giphy GIF, a link preview's picture — always loads: blocking those
// (as v2.32.36–44 did) left "Image failed to load" where a message's picture
// should be, which reads as Discord being broken.
//
// It is one more rule inside the ad blocker's request hook for the Discord
// session (main.js wireAdblockerOnSession) — a session can have only one such
// hook, so a second one would have silently replaced the ad blocker.

const DECORATION = /^\/(emojis|avatars|guilds\/\d+\/users\/\d+\/avatars|stickers|icons|banners|avatar-decoration-presets|app-icons)\//i;

function isHeavyDiscordMedia(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.toLowerCase();
  if (host !== 'cdn.discordapp.com' && host !== 'media.discordapp.net') return false;
  if (!DECORATION.test(u.pathname)) return false;
  return /\.gif$/i.test(u.pathname) || u.searchParams.get('animated') === 'true';
}

module.exports = { isHeavyDiscordMedia };
