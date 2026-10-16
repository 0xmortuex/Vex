// === Was this link clicked inside a chat? (T3-100, T3-102) ===================
//
// A link in Discord, WhatsApp Web, Messenger, Telegram Web, Slack, Teams or
// Roblox's chat was put there by another person, and that is where most "free
// Robux", fake giveaway and QR-code scams arrive. Main sees the page a link was
// clicked in (the opener) and the link; this says whether the opener is one of
// those chats, from the opener's ADDRESS only. No page text is read.
//
// A link back to the chat's own site (a Discord invite inside Discord, a Roblox
// page inside Roblox) is not a chat link: it goes nowhere new.
const FAMILIES = [
  { label: 'Discord', hosts: ['discord.com', 'discordapp.com', 'discordapp.net', 'discord.gg', 'discord.media'] },
  { label: 'WhatsApp Web', hosts: ['whatsapp.com', 'whatsapp.net', 'wa.me'], openers: ['web.whatsapp.com'] },
  { label: 'Messenger', hosts: ['messenger.com'] },
  { label: 'Telegram Web', hosts: ['telegram.org', 't.me', 'telegram.me'], openers: ['web.telegram.org', 'webk.telegram.org', 'webz.telegram.org'] },
  { label: 'Slack', hosts: ['slack.com'], openers: ['app.slack.com'] },
  { label: 'Microsoft Teams', hosts: ['teams.microsoft.com', 'teams.live.com'] },
  { label: 'Roblox', hosts: ['roblox.com', 'rbxcdn.com', 'roblox.qq.com'] },
];

const hostOf = (url) => { try { const u = new URL(String(url)); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : ''; } catch { return ''; } };
const under = (host, domain) => host === domain || host.endsWith('.' + domain);

// → the chat's name ("Discord"), or '' when the opener is not a chat.
function chatOf(openerUrl) {
  const h = hostOf(openerUrl);
  if (!h) return '';
  for (const f of FAMILIES) {
    const list = f.openers || f.hosts;
    if (list.some(d => under(h, d))) return f.label;
  }
  return '';
}

// → the chat's name when `targetUrl`, opened from `openerUrl`, is a link that came out of a chat
// to somewhere else; '' otherwise (not a chat, not a web link, or a link within the chat's own site).
function chatLinkFrom(openerUrl, targetUrl) {
  const label = chatOf(openerUrl);
  if (!label) return '';
  const target = hostOf(targetUrl);
  if (!target) return '';
  const family = FAMILIES.find(f => f.label === label);
  if (family.hosts.some(d => under(target, d))) return '';
  return label;
}

module.exports = { chatOf, chatLinkFrom, FAMILIES };
