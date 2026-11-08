// The proxy script (PAC) of the Discord PANEL's session while the ByeDPI desync bypass is on.
//
// The panel sends everything through ByeDPI's SOCKS proxy, because Discord's own hosts (discord.com, discordapp.com, discord.gg ...) are the ones
// the ISP resets. Two kinds of host must NOT ride it:
//   * voice, *.discord.media: ByeDPI is TCP-only and its TLS-record splitting mangles Discord's long-lived voice gateway WebSocket;
//   * the attachment upload host, discord-attachments-uploads-*.storage.googleapis.com: a Google server the ISP does NOT block (measured
//     2026-11-08: a direct connection answers normally), and Google rejects the scrambled handshake, so every upload died at once with
//     net::ERR_SSL_PROTOCOL_ERROR (its OPTIONS pre-flight with net::ERR_FAILED) and Discord showed "Request timed out" after its retries.
// Everything else stays on the bypass, as before.
'use strict';

// PAC shExpMatch patterns that go DIRECT.
const DIRECT_HOSTS = Object.freeze([
  'discord.media',
  '*.discord.media',
  'discord-attachments-uploads-*.storage.googleapis.com',
]);

function panelPac(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('discord-pac: the bypass port must be a whole number from 1 to 65535');
  const direct = DIRECT_HOSTS.map(p => "shExpMatch(h,'" + p + "')").join('||');
  return 'function FindProxyForURL(u,h){if(' + direct + ")return 'DIRECT';return 'SOCKS5 127.0.0.1:" + port + "';}";
}

module.exports = { panelPac, DIRECT_HOSTS };
