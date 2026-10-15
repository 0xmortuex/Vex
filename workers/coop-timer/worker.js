// Vex co-op focus timer relay — Cloudflare Worker SOURCE.
//
// What it is: a tiny room clock. People who enter the same 6-character room
// code share one timer. The ONLY things it ever sees or stores are
//   - the room code,
//   - the display name each person chose for that room,
//   - the timer's start / pause / end timestamps and its length,
//   - a per-member secret (stored only as a SHA-256 hash).
// Nothing about browsing, no account, no email, no IP address is stored. It
// writes no logs, and room codes are never printed anywhere.
//
// It is NOT deployed by Vex and Vex ships no address for it. The owner deploys
// it (see README.md) and each user pastes their own relay URL into Settings.
//
// Endpoints (all JSON, all under /v1):
//   POST /v1/room                   {name}             -> create a room
//   POST /v1/room/:code/join        {name}             -> join it
//   GET  /v1/room/:code             (Bearer secret)    -> read state, heartbeat
//   POST /v1/room/:code/start       {minutes?}         -> start the timer
//   POST /v1/room/:code/pause|resume|end|leave
//
// Every request after create/join carries `Authorization: Bearer <secret>`.

export const LIMITS = Object.freeze({
  CODE_LEN: 6,
  CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // no I, O, 0, 1
  NAME_MAX: 24,
  BODY_MAX: 1024,
  MAX_MEMBERS: 8,
  MIN_MINUTES: 1,
  MAX_MINUTES: 120,
  DEFAULT_MINUTES: 25,
  ROOM_TTL_MS: 2 * 60 * 60 * 1000,   // a room is deleted 2 h after its last activity
  MEMBER_LISTED_MS: 90 * 1000,        // shown while seen within 90 s (clients poll every ~5 s)
  MEMBER_DROP_MS: 10 * 60 * 1000,
  ROOM_REQ_PER_MIN: 240,              // all members of one room together
  IP_REQ_PER_MIN: 90,
  IP_CREATE_PER_10MIN: 5,
  IP_MISS_PER_10MIN: 20,              // joins / reads of rooms that do not exist (code guessing)
});

const CODE_RE = new RegExp('^[' + LIMITS.CODE_ALPHABET + ']{' + LIMITS.CODE_LEN + '}$');

// ---- validation (exported for the tests) ---------------------------------------

export function validCode(code) { return typeof code === 'string' && CODE_RE.test(code); }

// Display name: what the person typed, with control and bidi characters
// removed and spaces collapsed. Returns '' when nothing usable is left.
export function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, LIMITS.NAME_MAX).join('').trim();
}

export function cleanMinutes(raw) {
  if (raw == null) return LIMITS.DEFAULT_MINUTES;
  if (!Number.isInteger(raw) || raw < LIMITS.MIN_MINUTES || raw > LIMITS.MAX_MINUTES) return 0;
  return raw;
}

export function makeCode(rand = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  // 32 symbols and 256 values: a byte maps evenly with no modulo bias.
  const bytes = rand(LIMITS.CODE_LEN);
  let out = '';
  for (let i = 0; i < LIMITS.CODE_LEN; i++) out += LIMITS.CODE_ALPHABET[bytes[i] % 32];
  return out;
}

function hex(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
export function randomHex(n) { return hex(crypto.getRandomValues(new Uint8Array(n))); }
export async function sha256hex(text) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)))));
}

// ---- the room's logic: pure, so it is testable without any Durable Object -------

function fail(status, error) { return { ok: false, status, error }; }

export function newRoom(code, now) {
  return { code, members: [], timer: { status: 'idle', durationMs: 0, startedAt: 0, pausedAt: 0 }, touched: now };
}

function prune(room, now) {
  room.members = room.members.filter(m => now - m.seen <= LIMITS.MEMBER_DROP_MS);
}

export function publicState(room, now, meId) {
  const t = room.timer;
  let status = t.status;
  let remainingMs = 0;
  if (status === 'running') {
    remainingMs = Math.max(0, t.startedAt + t.durationMs - now);
    if (remainingMs === 0) status = 'done';
  } else if (status === 'paused') {
    remainingMs = Math.max(0, t.startedAt + t.durationMs - t.pausedAt);
  }
  return {
    code: room.code,
    now,
    members: room.members
      .filter(m => now - m.seen <= LIMITS.MEMBER_LISTED_MS)
      .map(m => ({ id: m.id, name: m.name, you: m.id === meId })),
    timer: {
      status,
      durationMs: t.durationMs,
      startedAt: t.startedAt,
      pausedAt: t.pausedAt,
      endsAt: status === 'running' || status === 'done' ? t.startedAt + t.durationMs : 0,
      remainingMs,
    },
  };
}

// op: { type, name?, minutes?, memberId?, secretHash?, auth? }
// Returns { ok:true, room, secret?, memberId?, destroy? } or { ok:false, status, error }.
export function applyOp(room, op, now) {
  if (!room) return fail(404, 'No such room');
  prune(room, now);
  room.touched = now;

  if (op.type === 'join') {
    const name = cleanName(op.name);
    if (!name) return fail(400, 'A display name is required');
    if (room.members.length >= LIMITS.MAX_MEMBERS) return fail(409, 'This room is full');
    const m = { id: op.memberId, name, auth: op.secretHash, seen: now };
    room.members.push(m);
    return { ok: true, room, memberId: m.id };
  }

  const me = room.members.find(m => m.auth && m.auth === op.auth);
  if (!me) return fail(401, 'Not a member of this room');
  me.seen = now;
  const t = room.timer;

  switch (op.type) {
    case 'state': return { ok: true, room };
    case 'start': {
      const minutes = cleanMinutes(op.minutes);
      if (!minutes) return fail(400, 'Minutes must be a whole number from 1 to 120');
      room.timer = { status: 'running', durationMs: minutes * 60000, startedAt: now, pausedAt: 0 };
      return { ok: true, room };
    }
    case 'pause':
      if (t.status !== 'running' || t.startedAt + t.durationMs <= now) return fail(409, 'The timer is not running');
      t.status = 'paused'; t.pausedAt = now;
      return { ok: true, room };
    case 'resume':
      if (t.status !== 'paused') return fail(409, 'The timer is not paused');
      t.startedAt += now - t.pausedAt; t.status = 'running'; t.pausedAt = 0;
      return { ok: true, room };
    case 'end':
      room.timer = { status: 'idle', durationMs: 0, startedAt: 0, pausedAt: 0 };
      return { ok: true, room };
    case 'leave':
      room.members = room.members.filter(m => m !== me);
      return { ok: true, room, destroy: room.members.length === 0 };
    default: return fail(400, 'Unknown request');
  }
}

// ---- Durable Objects ------------------------------------------------------------

// One object per room code. Holds the room and deletes itself by alarm.
export class CoopRoom {
  constructor(state) { this.state = state; this.room = undefined; this.win = { at: 0, n: 0 }; }

  async fetch(request) {
    const op = await request.json();
    const now = Date.now();
    if (this.room === undefined) this.room = (await this.state.storage.get('room')) || null;

    // One room's total request rate, whoever is asking.
    if (now - this.win.at >= 60000) this.win = { at: now, n: 0 };
    if (++this.win.n > LIMITS.ROOM_REQ_PER_MIN) return reply(fail(429, 'Too many requests for this room'));

    if (op.type === 'create') {
      if (this.room) return reply(fail(409, 'exists'));
      const name = cleanName(op.name);
      if (!name) return reply(fail(400, 'A display name is required'));
      this.room = newRoom(op.code, now);
      const r = applyOp(this.room, { type: 'join', name, memberId: op.memberId, secretHash: op.secretHash }, now);
      await this.persist();
      return reply({ ok: true, state: publicState(r.room, now, r.memberId), memberId: r.memberId });
    }

    const r = applyOp(this.room, op, now);
    if (!r.ok) return reply(r);
    if (r.destroy) { await this.state.storage.deleteAll(); this.room = null; return reply({ ok: true, left: true }); }
    await this.persist();
    const me = r.memberId || (r.room.members.find(m => m.auth === op.auth) || {}).id;
    return reply({ ok: true, state: publicState(r.room, now, me), memberId: r.memberId });
  }

  async persist() {
    await this.state.storage.put('room', this.room);
    await this.state.storage.setAlarm(Date.now() + LIMITS.ROOM_TTL_MS);
  }

  async alarm() {
    await this.state.storage.deleteAll();
    this.room = null;
  }
}

// One object per hashed client address: abuse counters only. The address is
// hashed before it names the object and is never stored.
export class CoopGate {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const { kind } = await request.json();
    const now = Date.now();
    let g = (await this.state.storage.get('g')) || { min: { at: now, n: 0 }, ten: { at: now, c: 0, m: 0 } };
    if (now - g.min.at >= 60000) g.min = { at: now, n: 0 };
    if (now - g.ten.at >= 600000) g.ten = { at: now, c: 0, m: 0 };
    let allowed = ++g.min.n <= LIMITS.IP_REQ_PER_MIN;
    if (kind === 'create') allowed = allowed && ++g.ten.c <= LIMITS.IP_CREATE_PER_10MIN;
    if (kind === 'miss') allowed = allowed && ++g.ten.m <= LIMITS.IP_MISS_PER_10MIN;
    await this.state.storage.put('g', g);
    await this.state.storage.setAlarm(now + 700000);
    return new Response(JSON.stringify({ allowed }), { headers: { 'content-type': 'application/json' } });
  }

  async alarm() { await this.state.storage.deleteAll(); }
}

function reply(r) {
  // The status stays in the body: the public worker reads it back from here.
  return new Response(JSON.stringify(r), { status: r.status || 200, headers: { 'content-type': 'application/json' } });
}

// ---- the public worker ------------------------------------------------------------

function allowedOrigins(env) {
  return String((env && env.ALLOWED_ORIGINS) || '').split(',').map(s => s.trim()).filter(Boolean);
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '600',
    'vary': 'Origin',
  };
}

function out(status, body, origin) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (origin) Object.assign(headers, corsHeaders(origin));
  return new Response(JSON.stringify(body), { status, headers });
}

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (!/^application\/json\b/i.test(type)) throw Object.assign(new Error('JSON body required'), { status: 415 });
  const text = await request.text();
  if (text.length > LIMITS.BODY_MAX) throw Object.assign(new Error('Request too large'), { status: 413 });
  let v;
  try { v = text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  return v;
}

async function ask(ns, name, payload) {
  const stub = ns.get(ns.idFromName(name));
  const res = await stub.fetch('https://do/', { method: 'POST', body: JSON.stringify(payload) });
  return res.json();
}

export async function handle(request, env) {
  const origin = request.headers.get('Origin');
  if (origin) {
    // A browser page that is not on the list gets nothing, not even an error
    // it could read.
    if (!allowedOrigins(env).includes(origin)) return new Response(null, { status: 403 });
  }
  const o = origin || '';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: o ? corsHeaders(o) : {} });

  if (!env || !env.COOP_ROOMS || !env.COOP_GATE) return out(503, { ok: false, error: 'The relay is not set up (Durable Object bindings missing)' }, o);

  const url = new URL(request.url);
  const m = /^\/v1\/room(?:\/([A-Z0-9]{6})(?:\/(join|start|pause|resume|end|leave))?)?\/?$/.exec(url.pathname);
  if (!m) return out(404, { ok: false, error: 'Not found' }, o);
  const code = m[1] || '';
  const action = m[2] || '';

  try {
    // Address -> hash -> counter object. Never stored, never logged.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const gateName = (await sha256hex('coop-gate:' + ip)).slice(0, 32);
    const gate = (kind) => ask(env.COOP_GATE, gateName, { kind });

    const isCreate = request.method === 'POST' && !code;
    if (!(await gate(isCreate ? 'create' : 'req')).allowed) return out(429, { ok: false, error: 'Too many requests, slow down' }, o);

    if (code && !validCode(code)) return out(400, { ok: false, error: 'Invalid room code' }, o);
    const bearer = /^Bearer ([0-9a-f]{32})$/.exec(request.headers.get('Authorization') || '');

    // --- create ---
    if (isCreate) {
      const body = await readBody(request);
      const name = cleanName(body.name);
      if (!name) return out(400, { ok: false, error: 'A display name is required' }, o);
      const secret = randomHex(16);
      const secretHash = await sha256hex(secret);
      for (let i = 0; i < 4; i++) {
        const c = makeCode();
        const r = await ask(env.COOP_ROOMS, c, { type: 'create', code: c, name, memberId: randomHex(4), secretHash });
        if (r.ok) return out(200, { ok: true, code: c, secret, memberId: r.memberId, state: r.state }, o);
        if (r.error !== 'exists') return out(r.status || 500, { ok: false, error: r.error }, o);
      }
      return out(503, { ok: false, error: 'Could not make a room, try again' }, o);
    }

    if (!code) return out(405, { ok: false, error: 'Method not allowed' }, o);

    // --- join ---
    if (request.method === 'POST' && action === 'join') {
      const body = await readBody(request);
      const name = cleanName(body.name);
      if (!name) return out(400, { ok: false, error: 'A display name is required' }, o);
      const secret = randomHex(16);
      const r = await ask(env.COOP_ROOMS, code, { type: 'join', name, memberId: randomHex(4), secretHash: await sha256hex(secret) });
      if (!r.ok) {
        if (r.status === 404 && !(await gate('miss')).allowed) return out(429, { ok: false, error: 'Too many requests, slow down' }, o);
        return out(r.status || 500, { ok: false, error: r.error }, o);
      }
      return out(200, { ok: true, code, secret, memberId: r.memberId, state: r.state }, o);
    }

    // --- everything else needs the member's secret ---
    if (!bearer) return out(401, { ok: false, error: 'Not a member of this room' }, o);
    const auth = await sha256hex(bearer[1]);
    let type;
    if (request.method === 'GET' && !action) type = 'state';
    else if (request.method === 'POST' && ['start', 'pause', 'resume', 'end', 'leave'].includes(action)) type = action;
    else return out(405, { ok: false, error: 'Method not allowed' }, o);

    const payload = { type, auth };
    if (type === 'start') {
      const body = await readBody(request);
      if (body.minutes !== undefined && cleanMinutes(body.minutes) === 0) return out(400, { ok: false, error: 'Minutes must be a whole number from 1 to 120' }, o);
      payload.minutes = body.minutes;
    }
    const r = await ask(env.COOP_ROOMS, code, payload);
    if (!r.ok) {
      if (r.status === 404 && !(await gate('miss')).allowed) return out(429, { ok: false, error: 'Too many requests, slow down' }, o);
      return out(r.status || 500, { ok: false, error: r.error }, o);
    }
    return out(200, r, o);
  } catch (err) {
    // The message is the validation text above; anything else is generic.
    const status = err && err.status ? err.status : 500;
    return out(status, { ok: false, error: err && err.status ? err.message : 'Relay error' }, o);
  }
}

export default { fetch: handle };
