// src/main/dev-ports.js — a dev server is started in a terminal and then hunted
// for: which port was it, is it still up? The browser is where you go to look,
// and the one thing that could not tell you.
//
// A local TCP connect and nothing more: no request is sent, so nothing that is
// listening is disturbed by being found.

import { describe, it, expect } from 'vitest';
const { createPortScanner, COMMON, KNOWN } = require('../../src/main/dev-ports.js');

// A fake socket that answers for the ports in `open` and refuses the rest.
function fakeNet(open) {
  const connects = [];
  return {
    connects,
    net: {
      Socket: class {
        constructor() { this.handlers = {}; }
        setTimeout() {}
        once(ev, fn) { this.handlers[ev] = fn; return this; }
        destroy() {}
        connect(port, host) {
          connects.push([port, host]);
          setTimeout(() => (open.includes(port) ? this.handlers.connect?.() : this.handlers.error?.(new Error('ECONNREFUSED'))), 0);
        }
      },
    },
  };
}

describe('finding what is up', () => {
  it('reports the ports that answered, lowest first, with a guess at what they are', async () => {
    const { net } = fakeNet([5173, 3000, 11434]);
    const out = await createPortScanner({ net }).scan();
    expect(out).toEqual([
      { port: 3000, url: 'http://localhost:3000/', guess: 'Next.js, Create React App or Express' },
      { port: 5173, url: 'http://localhost:5173/', guess: 'Vite' },
      { port: 11434, url: 'http://localhost:11434/', guess: 'Ollama' },
    ]);
  });

  it('a port with no known owner is listed without a made-up name', async () => {
    const { net } = fakeNet([7777]);
    expect((await createPortScanner({ net }).scan())[0]).toEqual({ port: 7777, url: 'http://localhost:7777/', guess: '' });
  });

  it('nothing listening is an empty list, not an error', async () => {
    const { net } = fakeNet([]);
    expect(await createPortScanner({ net }).scan()).toEqual([]);
  });

  it('only ever knocks on this machine, and only on the ports it was given', async () => {
    const { net, connects } = fakeNet([]);
    await createPortScanner({ net, ports: [3000, 3000, 8080] }).scan();
    expect(connects.map(c => c[1])).toEqual(['127.0.0.1', '127.0.0.1']);   // deduped
    expect(connects.map(c => c[0]).sort((a, b) => a - b)).toEqual([3000, 8080]);
  });

  it('a socket that never answers is a closed port, not a hang', async () => {
    const net = { Socket: class { setTimeout() {} once(ev, fn) { if (ev === 'timeout') setTimeout(fn, 0); return this; } destroy() {} connect() {} } };
    expect(await createPortScanner({ net, ports: [1234] }).scan()).toEqual([]);
  });

  it('covers the ports a person actually uses', () => {
    for (const p of [3000, 5173, 8080, 8787, 11434]) expect(COMMON).toContain(p);
    expect(KNOWN[8787]).toMatch(/Cloudflare Worker/);
  });
});
