import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const { parseConnect, handleConnect } = createRequire(import.meta.url)('../../src/main/connect-tunnel.js');
class Socket extends EventEmitter {
  writes = []; destroyed = false;
  write(data) { this.writes.push(Buffer.from(data)); return true; }
  end(data) { if (data) this.write(data); this.destroy(); }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
  pause() {} resume() {} setNoDelay() {} pipe() {}
}
it('parses bracketed IPv6 and rejects malformed ports and request lines', () => {
  expect(parseConnect(Buffer.from('CONNECT [::1]:443 HTTP/1.1\r\nHost: [::1]'))).toEqual({ host: '::1', port: 443 });
  for (const line of ['CONNECT host:0 HTTP/1.1', 'CONNECT host:65536 HTTP/1.1', 'CONNECT host:443junk HTTP/1.1', 'GET / HTTP/1.1', 'CONNECT [::::]:443 HTTP/1.1']) expect(() => parseConnect(Buffer.from(line))).toThrow();
});
it('buffers fragmented headers and forwards coalesced TLS bytes exactly once', async () => {
  const client = new Socket(), up = new Socket();
  handleConnect(client, { resolve: async () => '127.0.0.1', split: () => 2, connect: () => up });
  client.emit('data', Buffer.from('CON'));
  client.emit('data', Buffer.from('NECT example.com:443 HTTP/1.1\r\nHost: example.com\r\n'));
  expect(client.writes).toHaveLength(0);
  client.emit('data', Buffer.concat([Buffer.from('\r\n'), Buffer.from([22,3,1,0,5])]));
  await Promise.resolve();
  up.emit('connect');
  expect(Buffer.concat(up.writes)).toEqual(Buffer.from([22,3,1,0,5]));
  expect(Buffer.concat(client.writes).toString()).toContain('200 Connection Established');
  client.destroy(); expect(up.destroyed).toBe(true);
});
it('times out an incomplete header and does not connect after a disconnect during DNS', async () => {
  const client = new Socket();
  handleConnect(client, { resolve: async () => null, split: () => 0, timeout: 5 });
  await new Promise(r => setTimeout(r, 15));
  expect(client.destroyed).toBe(true);
  const other = new Socket(); let finish; let connected = false;
  handleConnect(other, { resolve: () => new Promise(r => { finish = r; }), split: () => 0, connect: () => { connected = true; return new Socket(); } });
  other.emit('data', Buffer.from('CONNECT example.com:443 HTTP/1.1\r\n\r\n'));
  other.destroy(); finish('127.0.0.1'); await Promise.resolve();
  expect(connected).toBe(false);
});
