# Vex co-op focus timer relay

A very small Cloudflare Worker that lets two or more people run one shared
focus timer by typing the same 6-character room code.

**You deploy this yourself.** Vex does not ship an address for it, never
contacts one on its own, and the feature is switched off until a person pastes
a relay URL into Settings > Co-op focus timer. Nothing in this folder has been
deployed or called by the Vex project.

## What it can see

Only this, per room:

| Data | Why |
| --- | --- |
| room code (6 characters) | to find the room |
| display name each person typed for that room | to show who is in it |
| start / pause / end timestamps and the length in minutes | the shared clock |
| a per-member secret, kept only as a SHA-256 hash | so only members can pause or leave |

It never receives URLs, tab titles, history, account names, or anything about
browsing. There are no accounts. A room is deleted two hours after its last
activity, or as soon as the last member leaves. Request logging is off
(`[observability] enabled = false`) and the code never prints room codes.

## Abuse limits

- Codes are 6 characters from a 32-symbol alphabet (no 0/O/1/I), made with the
  Workers CSPRNG.
- At most 8 people per room; names up to 24 characters, control characters
  stripped; timer 1 to 120 minutes.
- Per client address (hashed with SHA-256 before it names a counter, never
  stored in clear): 90 requests a minute, 5 room creations and 20 requests for
  rooms that do not exist per 10 minutes (this is what stops code guessing).
- Per room: 240 requests a minute in total.
- Bodies over 1 KB are refused; only `application/json`.
- CORS: a browser request whose `Origin` is not in `ALLOWED_ORIGINS` gets a
  bare 403. The default is `"null"`, which is the origin Vex's local window
  sends.

## Deploy

```
cd workers/coop-timer
# edit wrangler.toml: set name to your own worker name
npx wrangler deploy
```

Durable Objects need a Cloudflare plan that includes them (the free plan
supports the SQLite-backed kind used here). Then copy the worker's
`https://<name>.<account>.workers.dev` address into Vex: Settings > Co-op focus
timer > Relay URL.

## API

All bodies are JSON. After create/join, send `Authorization: Bearer <secret>`.

- `POST /v1/room` `{ "name": "Sam" }` returns `{ code, secret, memberId, state }`
- `POST /v1/room/:code/join` `{ "name": "Alex" }` returns `{ code, secret, memberId, state }`
- `GET /v1/room/:code` returns `{ state }` and counts as a heartbeat
- `POST /v1/room/:code/start` `{ "minutes": 25 }`, then `/pause`, `/resume`, `/end`, `/leave`

`state` is `{ code, now, members: [{ id, name, you }], timer: { status, durationMs, startedAt, pausedAt, endsAt, remainingMs } }`
with `status` one of `idle`, `running`, `paused`, `done`. `now` is the server's
clock; clients use it to correct for their own clock being off.

## Tests

`npx vitest run tests/workers/coopTimerWorker.test.js` from the repository
root. The tests run the worker in memory with fake Durable Object storage; no
network is involved.
