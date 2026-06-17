import { describe, it, expect } from 'vitest';
import { sniSplit } from '../../src/main-dpi-bypass.js';

// sniSplit must find a TCP split position INSIDE the TLS ClientHello SNI
// hostname, so the server name straddles two segments (defeating SNI DPI).

function buildClientHello(host) {
  const name = Buffer.from(host, 'latin1');
  const N = name.length;
  const sniExt = Buffer.concat([
    Buffer.from([0x00, 0x00]),            // extension type: server_name (0x0000)
    Buffer.from([0x00, N + 5]),           // extension length
    Buffer.from([0x00, N + 3]),           // server_name_list length
    Buffer.from([0x00]),                  // name type: host_name
    Buffer.from([0x00, N]),               // name length
    name,                                 // the hostname
  ]);
  const body = Buffer.concat([
    Buffer.from([0x03, 0x03]),            // client version TLS 1.2
    Buffer.alloc(32, 7),                  // random
    Buffer.from([0x00]),                  // session id length 0
    Buffer.from([0x00, 0x02, 0x13, 0x01]),// cipher suites (len 2 + one suite)
    Buffer.from([0x01, 0x00]),            // compression methods (len 1 + null)
    Buffer.from([(sniExt.length >> 8) & 0xff, sniExt.length & 0xff]), // extensions length
    sniExt,
  ]);
  const hs = Buffer.concat([
    Buffer.from([0x01, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff]), // handshake header
    body,
  ]);
  return Buffer.concat([
    Buffer.from([0x16, 0x03, 0x01, (hs.length >> 8) & 0xff, hs.length & 0xff]), // TLS record header
    hs,
  ]);
}

describe('sniSplit', () => {
  it('splits inside the SNI hostname for a real ClientHello (discord.com)', () => {
    const hello = buildClientHello('discord.com');
    const idx = hello.indexOf(Buffer.from('discord.com', 'latin1'));
    const pos = sniSplit(hello);
    expect(idx).toBeGreaterThan(0);
    // The split must fall strictly inside the hostname bytes.
    expect(pos).toBeGreaterThan(idx);
    expect(pos).toBeLessThan(idx + 'discord.com'.length);
  });

  it('works for a longer hostname too (gateway.discord.gg)', () => {
    const hello = buildClientHello('gateway.discord.gg');
    const idx = hello.indexOf(Buffer.from('gateway.discord.gg', 'latin1'));
    const pos = sniSplit(hello);
    expect(pos).toBeGreaterThan(idx);
    expect(pos).toBeLessThan(idx + 'gateway.discord.gg'.length);
  });

  it('falls back to a small offset for non-TLS / garbage input', () => {
    expect(sniSplit(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeLessThanOrEqual(3);
    expect(sniSplit(Buffer.from([0x47, 0x45, 0x54]))).toBeLessThanOrEqual(3); // "GET"
  });

  it('never throws and returns 0 for empty input', () => {
    expect(sniSplit(Buffer.alloc(0))).toBe(0);
  });
});
