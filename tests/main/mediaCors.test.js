// @vitest-environment node
//
// SE7: Vex added "Access-Control-Allow-Origin: *" to every media response
// (for the Master Volume boost), so any page could read audio and video
// bytes from this computer or the local network. Now only for a server on
// the internet.
import { describe, it, expect } from 'vitest';
const fs = require('fs'), path = require('path');
const { isPrivateNetworkUrl, addMediaCorsHeaders } = require('../../src/main/media-cors.js');
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

const media = (url) => ({ url, resourceType: 'media' });

describe('media CORS header', () => {
  it.each([
    'http://localhost:18081/tone.wav', 'http://127.0.0.1/a.mp4', 'http://127.1.2.3/a', 'http://0.0.0.0/a',
    'http://10.0.0.5/cam.mjpg', 'http://172.16.3.4/a', 'http://172.31.255.1/a', 'http://192.168.1.1/a',
    'http://169.254.10.10/a', 'http://100.64.0.1/a', 'http://[::1]/a', 'http://[fd12:3456::1]/a', 'http://[fe80::1]/a',
    'http://[::ffff:192.168.0.2]/a', 'http://[::ffff:127.0.0.1]/a', 'http://nas/a.mp3', 'http://nas.local/a.mp3',
    'http://router.lan/a', 'http://media.home.arpa/a', 'http://app.localhost/a', 'http://2130706433/a',
    'file:///C:/a.mp3', 'not a url',
  ])('is not added for %s', (url) => {
    expect(isPrivateNetworkUrl(url)).toBe(true);
    const h = {};
    expect(addMediaCorsHeaders(media(url), h)).toBe(false);
    expect(h).toEqual({});
  });
  it.each(['https://cdn.example.com/a.mp4', 'http://8.8.8.8/a.mp3', 'http://172.32.0.1/a', 'https://[2001:db8::1]/a', 'http://media.vexaudit.test/tone.wav'])(
    'is added for a server on the internet: %s', (url) => {
      expect(isPrivateNetworkUrl(url)).toBe(false);
      const h = {};
      expect(addMediaCorsHeaders(media(url), h)).toBe(true);
      expect(h['Access-Control-Allow-Origin']).toEqual(['*']);
    });
  it('never for anything but media, and never over the server’s own header', () => {
    const h = {};
    expect(addMediaCorsHeaders({ url: 'https://cdn.example.com/a.js', resourceType: 'script' }, h)).toBe(false);
    const own = { 'access-control-allow-origin': ['https://site.example'] };
    expect(addMediaCorsHeaders(media('https://cdn.example.com/a.mp4'), own)).toBe(false);
    expect(own).toEqual({ 'access-control-allow-origin': ['https://site.example'] });
  });
  it('main.js uses this one, not its own copy', () => {
    expect(main).toMatch(/addMediaCorsHeaders: _addMediaCorsHeaders \} = require\('\.\/main\/media-cors'\)/);
    expect(main).not.toMatch(/function _addMediaCorsHeaders/);
  });
});
