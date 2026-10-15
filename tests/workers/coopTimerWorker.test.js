// The co-op timer relay (workers/coop-timer/worker.js), run in memory.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeEnv } from '../helpers/coopRelay.js';
import {
  handle, LIMITS, cleanName, cleanMinutes, validCode, makeCode, applyOp, newRoom, publicState,
} from '../../workers/coop-timer/worker.js';

const J = { 'content-type': 'application/json' };
let env;
beforeEach(async () => { env = await makeEnv(); });

const call = (method, path, { body, secret, origin, ip, type } = {}) => handle(new Request('http://relay.test' + path, {
  method,
  headers: {
    ...(body !== undefined ? { ...J, ...(type ? { 'content-type': type } : {}) } : {}),
    ...(secret ? { Authorization: 'Bearer ' + secret } : {}),
    ...(origin ? { Origin: origin } : {}),
    'CF-Connecting-IP': ip || '10.0.0.1',
  },
  body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
}), env);
const json = async (r) => ({ status: r.status, ...(await r.json()) });

describe('validation helpers', () => {
  it('only accepts 6-character codes from the unambiguous alphabet', () => {
    expect(validCode('ABC234')).toBe(true);
    for (const bad of ['abc234', 'ABC23', 'ABC2345', 'ABO234', 'AB1234', '', null, 5]) expect(validCode(bad)).toBe(false);
  });
  it('makes valid codes', () => {
    for (let i = 0; i < 50; i++) expect(validCode(makeCode())).toBe(true);
  });
  it('cleans names', () => {
    expect(cleanName('  Sam\u0000  Jones‮ ')).toBe('Sam Jones');
    expect(cleanName('x'.repeat(100)).length).toBe(LIMITS.NAME_MAX);
    expect(cleanName('​\u0007')).toBe('');
    expect(cleanName(42)).toBe('');
  });
  it('minutes: default 25, whole numbers 1-120 only', () => {
    expect(cleanMinutes(undefined)).toBe(25);
    expect(cleanMinutes(50)).toBe(50);
    for (const bad of [0, -1, 121, 1.5, '25', NaN]) expect(cleanMinutes(bad)).toBe(0);
  });
});

describe('room logic', () => {
  const T = 1_000_000;
  function room() {
    const r = newRoom('ABC234', T);
    applyOp(r, { type: 'join', name: 'A', memberId: 'aaaa0001', secretHash: 'h1' }, T);
    return r;
  }
  it('start, pause, resume keep the right remaining time', () => {
    const r = room();
    applyOp(r, { type: 'start', auth: 'h1', minutes: 25 }, T);
    expect(publicState(r, T + 60000).timer.remainingMs).toBe(24 * 60000);
    applyOp(r, { type: 'pause', auth: 'h1' }, T + 60000);
    expect(publicState(r, T + 600000).timer.remainingMs).toBe(24 * 60000);
    applyOp(r, { type: 'resume', auth: 'h1' }, T + 600000);
    const s = publicState(r, T + 660000);
    expect(s.timer.status).toBe('running');
    expect(s.timer.remainingMs).toBe(23 * 60000);
  });
  it('reports done when the time is up', () => {
    const r = room();
    applyOp(r, { type: 'start', auth: 'h1', minutes: 1 }, T);
    expect(publicState(r, T + 60001).timer.status).toBe('done');
  });
  it('refuses a stranger, a full room and a missing room', () => {
    const r = room();
    expect(applyOp(r, { type: 'start', auth: 'nope' }, T).status).toBe(401);
    for (let i = 0; i < LIMITS.MAX_MEMBERS - 1; i++) applyOp(r, { type: 'join', name: 'P' + i, memberId: 'm' + i, secretHash: 'x' + i }, T);
    expect(applyOp(r, { type: 'join', name: 'Late', memberId: 'zz', secretHash: 'zz' }, T).status).toBe(409);
    expect(applyOp(null, { type: 'state' }, T).status).toBe(404);
  });
  it('never exposes the member secret hash', () => {
    const s = JSON.stringify(publicState(room(), T, 'aaaa0001'));
    expect(s).not.toContain('h1');
    expect(s).not.toContain('auth');
  });
  it('drops members that have been gone a long time', () => {
    const r = room();
    applyOp(r, { type: 'join', name: 'B', memberId: 'bbbb0002', secretHash: 'h2' }, T);
    applyOp(r, { type: 'state', auth: 'h2' }, T + LIMITS.MEMBER_DROP_MS - 1);
    applyOp(r, { type: 'state', auth: 'h2' }, T + LIMITS.MEMBER_DROP_MS + 5);
    expect(r.members.map(m => m.name)).toEqual(['B']);
  });
});

describe('http surface', () => {
  async function create(name = 'Sam', opts = {}) {
    return json(await call('POST', '/v1/room', { body: { name }, ...opts }));
  }

  it('creates a room and lets a second person join and share the timer', async () => {
    const a = await create('Sam');
    expect(a.status).toBe(200);
    expect(validCode(a.code)).toBe(true);
    const b = await json(await call('POST', `/v1/room/${a.code}/join`, { body: { name: 'Alex' } }));
    expect(b.status).toBe(200);
    expect(b.state.members.map(m => m.name)).toEqual(['Sam', 'Alex']);

    const started = await json(await call('POST', `/v1/room/${a.code}/start`, { body: { minutes: 25 }, secret: a.secret }));
    expect(started.state.timer.status).toBe('running');
    expect(started.state.timer.durationMs).toBe(25 * 60000);

    const seenByB = await json(await call('GET', `/v1/room/${a.code}`, { secret: b.secret }));
    expect(seenByB.state.timer.status).toBe('running');
    expect(seenByB.state.members.find(m => m.you).name).toBe('Alex');

    const paused = await json(await call('POST', `/v1/room/${a.code}/pause`, { body: {}, secret: b.secret }));
    expect(paused.state.timer.status).toBe('paused');
    const ended = await json(await call('POST', `/v1/room/${a.code}/end`, { body: {}, secret: a.secret }));
    expect(ended.state.timer.status).toBe('idle');
  });

  it('removes the room when the last member leaves', async () => {
    const a = await create('Sam');
    const left = await json(await call('POST', `/v1/room/${a.code}/leave`, { body: {}, secret: a.secret }));
    expect(left.left).toBe(true);
    const again = await json(await call('GET', `/v1/room/${a.code}`, { secret: a.secret }));
    expect(again.status).toBe(404);
  });

  it('validates input', async () => {
    expect((await create('')).status).toBe(400);
    expect((await json(await call('POST', '/v1/room', { body: '{not json' }))).status).toBe(400);
    expect((await json(await call('POST', '/v1/room', { body: { name: 'A' }, type: 'text/plain' }))).status).toBe(415);
    expect((await json(await call('POST', '/v1/room', { body: { name: 'A'.repeat(2000) } }))).status).toBe(413);
    expect((await json(await call('GET', '/v1/room/abc'))).status).toBe(404);
    expect((await json(await call('GET', '/v1/room/ABO001', { secret: 'a'.repeat(32) }))).status).toBe(400);
    const a = await create('Sam');
    expect((await json(await call('POST', `/v1/room/${a.code}/start`, { body: { minutes: 9999 }, secret: a.secret }))).status).toBe(400);
    expect((await json(await call('GET', `/v1/room/${a.code}`))).status).toBe(401);
    expect((await json(await call('GET', `/v1/room/${a.code}`, { secret: 'f'.repeat(32) }))).status).toBe(401);
  });

  it('applies the CORS allowlist', async () => {
    const ok = await call('POST', '/v1/room', { body: { name: 'A' }, origin: 'null' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('null');
    const bad = await call('POST', '/v1/room', { body: { name: 'A' }, origin: 'https://evil.example' });
    expect(bad.status).toBe(403);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await call('OPTIONS', '/v1/room', { origin: 'null' });
    expect(pre.status).toBe(204);
    const badPre = await call('OPTIONS', '/v1/room', { origin: 'https://evil.example' });
    expect(badPre.status).toBe(403);
  });

  it('refuses to run without its bindings', async () => {
    env = {};
    expect((await json(await call('POST', '/v1/room', { body: { name: 'A' } }))).status).toBe(503);
  });

  it('limits room creation per address, and a different address is unaffected', async () => {
    for (let i = 0; i < LIMITS.IP_CREATE_PER_10MIN; i++) expect((await create('S', { ip: '1.1.1.1' })).status).toBe(200);
    expect((await create('S', { ip: '1.1.1.1' })).status).toBe(429);
    expect((await create('S', { ip: '2.2.2.2' })).status).toBe(200);
  });

  it('limits guessing of room codes', async () => {
    let last = 0;
    for (let i = 0; i < LIMITS.IP_MISS_PER_10MIN + 1; i++) {
      last = (await json(await call('POST', '/v1/room/' + makeCode() + '/join', { body: { name: 'G' }, ip: '3.3.3.3' }))).status;
    }
    expect(last).toBe(429);
  });

  it('stores no client address and prints nothing', async () => {
    const logs = [];
    const orig = [console.log, console.info, console.warn, console.error];
    console.log = console.info = console.warn = console.error = (...a) => logs.push(a);
    try { await create('Sam', { ip: '9.8.7.6' }); } finally { [console.log, console.info, console.warn, console.error] = orig; }
    expect(logs).toEqual([]);
    const dump = JSON.stringify([...env.COOP_ROOMS.objs.values(), ...env.COOP_GATE.objs.values()].map(o => o.state.storage._map ? [...o.state.storage._map] : []));
    expect(dump).not.toContain('9.8.7.6');
  });
});
