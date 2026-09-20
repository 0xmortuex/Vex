// "Is it me or the server?" — the point of the check is the sentence at the
// top, so that sentence has to be right: your line when the baseline is slow,
// the service when it is not.
import { describe, it, expect, vi } from 'vitest';
const { check, verdict, time, tcpConnect } = require('../../src/main/latency.js');

const r = (id, ms, baseline = false) => ({ id, name: id, host: id, baseline, ms, error: ms == null ? 'no' : null });

describe('what the numbers mean', () => {
  it('everything fine', () => {
    expect(verdict([r('cloudflare', 20, true), r('discord', 40), r('steam', 60)]))
      .toMatch(/Your connection is fine \(20 ms\), and so is every service/);
  });

  it('your own line is the slow part', () => {
    expect(verdict([r('cloudflare', 400, true), r('discord', 420)])).toMatch(/Your own connection is slow/);
  });

  it('one service is behind, and it is named', () => {
    const out = verdict([r('cloudflare', 20, true), r('discord', 400), r('steam', 45)]);
    expect(out).toMatch(/it is them/);
    expect(out).toContain('discord at 400 ms');
    expect(out).not.toContain('steam');
  });

  it('a service that did not answer at all is named too', () => {
    expect(verdict([r('cloudflare', 20, true), r('discord', null)])).toContain('discord did not answer');
  });

  it('nothing answered means the connection, not a service', () => {
    expect(verdict([r('cloudflare', null, true), r('discord', null)])).toMatch(/Nothing answered at all/);
  });

  it('far away is not the same as slow', () => {
    // A baseline host answers from the nearest city; a game server does not.
    expect(verdict([r('cloudflare', 10, true), r('riot', 160)])).toMatch(/so is every service/);
    expect(verdict([r('cloudflare', 10, true), r('riot', 300)])).toMatch(/it is them/);
    // With a slower line of your own, a service has to be slower still.
    expect(verdict([r('cloudflare', 100, true), r('riot', 300)])).toMatch(/so is every service/);
    expect(verdict([r('cloudflare', 100, true), r('riot', 500)])).toMatch(/it is them/);
  });
});

describe('timing one host', () => {
  it('measures how long the connection took', async () => {
    let clock = 1000;
    const now = () => clock;
    const connect = (_h, _p, done) => { clock += 42; done(null); };
    const out = await time({ id: 'x', name: 'X', host: 'x', port: 443 }, connect, now);
    expect(out.ms).toBe(42);
    expect(out.error).toBe(null);
  });

  it('a host that refuses or times out has no number, and says why', async () => {
    const connect = (_h, _p, done) => done(new Error('No answer in 3 s'));
    const out = await time({ id: 'x', name: 'X', host: 'x', port: 443 }, connect);
    expect(out.ms).toBe(null);
    expect(out.error).toBe('No answer in 3 s');
  });

  it('a connection that answers twice is still one result', async () => {
    const connect = (_h, _p, done) => { done(null); done(new Error('late error')); };
    const out = await time({ id: 'x', name: 'X', host: 'x', port: 443 }, connect);
    expect(out.error).toBe(null);
  });
});

describe('the whole check', () => {
  it('asks every target and hands back both the rows and the sentence', async () => {
    const asked = [];
    const connect = (host, _p, done) => { asked.push(host); done(null); };
    const out = await check(connect, [
      { id: 'base', name: 'Base', host: 'b', port: 443, baseline: true },
      { id: 'svc', name: 'Svc', host: 's', port: 443 },
    ]);
    expect(asked.sort()).toEqual(['b', 's']);
    expect(out.results).toHaveLength(2);
    expect(typeof out.verdict).toBe('string');
  });
});

describe('the real socket', () => {
  it('always closes the socket, whether it answered or failed', () => {
    const handlers = {};
    const socket = {
      setTimeout: vi.fn(),
      once: (ev, fn) => { handlers[ev] = fn; },
      destroy: vi.fn(),
    };
    const done = vi.fn();
    tcpConnect({ connect: () => socket })('h', 443, done);
    handlers.connect();
    expect(socket.destroy).toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(null);

    socket.destroy.mockClear();
    tcpConnect({ connect: () => socket })('h', 443, done);
    handlers.error(new Error('refused'));
    expect(socket.destroy).toHaveBeenCalled();
  });
});
