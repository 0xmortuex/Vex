// @vitest-environment node
//
// The proxy script of the Discord panel while the ByeDPI bypass is on (src/main/discord-pac.js): everything rides the bypass except voice and
// the attachment upload host. The upload host went through it and died at once with net::ERR_SSL_PROTOCOL_ERROR (found in a real run,
// 2026-11-08), because Google rejects the scrambled handshake and the ISP does not block that host anyway.

import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { panelPac, DIRECT_HOSTS } = require('../../src/main/discord-pac.js');

// PAC's shExpMatch(host, shell pattern): '*' is any run of characters, '?' one; nothing else is special.
const shExpMatch = (h, p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$').test(h);
const find = (port) => new Function('shExpMatch', panelPac(port) + '; return FindProxyForURL;')(shExpMatch);
const BYPASS = 'SOCKS5 127.0.0.1:1080';
const UPLOAD = 'discord-attachments-uploads-prd.storage.googleapis.com';

describe('the Discord panel proxy script', () => {
  it('sends the attachment upload host direct (the bypass broke its handshake and every upload failed at once)', () => {
    const f = find(1080);
    expect(f('https://' + UPLOAD + '/abc/pic.png', UPLOAD)).toBe('DIRECT');
    expect(f('https://discord-attachments-uploads-stg.storage.googleapis.com/x', 'discord-attachments-uploads-stg.storage.googleapis.com')).toBe('DIRECT');
  });
  it('keeps voice direct, as before', () => {
    const f = find(1080);
    expect(f('wss://abc.discord.media/', 'abc.discord.media')).toBe('DIRECT');
    expect(f('wss://discord.media/', 'discord.media')).toBe('DIRECT');
  });
  it('keeps everything else on the bypass, the hosts the ISP resets above all', () => {
    const f = find(1080);
    for (const h of ['discord.com', 'cdn.discordapp.com', 'gateway.discord.gg', 'media.discordapp.net', 'example.com']) {
      expect(f('https://' + h + '/', h), h).toBe(BYPASS);
    }
  });
  it('does not let a look-alike name or another bucket ride the direct rule', () => {
    const f = find(1080);
    expect(f('https://' + UPLOAD + '.evil.test/', UPLOAD + '.evil.test')).toBe(BYPASS);
    expect(f('https://some-bucket.storage.googleapis.com/', 'some-bucket.storage.googleapis.com')).toBe(BYPASS);
  });
  it('uses the port it is given, and refuses one that is not a port', () => {
    expect(find(4242)('https://discord.com/', 'discord.com')).toBe('SOCKS5 127.0.0.1:4242');
    for (const bad of [0, -1, 70000, 1.5, NaN, '1080', null, undefined]) expect(() => panelPac(bad), String(bad)).toThrow(/port/);
  });
  it('is real, parseable PAC with no stray text', () => {
    expect(() => new Function('shExpMatch', panelPac(1080) + '; return FindProxyForURL;')).not.toThrow();
    expect(DIRECT_HOSTS).toContain('discord-attachments-uploads-*.storage.googleapis.com');
  });
  it('is what main.js uses for the panel session', () => {
    const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    expect(main).toContain("require('./main/discord-pac').panelPac(port)");
  });
});
