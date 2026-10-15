# Vex Companion relay

A short-lived mailbox between a desktop Vex and a phone browser that has no
Vex app. It holds one sealed snapshot of the Devices view per pairing. The
contract is `docs/COMPANION_PROTOCOL.md`; the page that talks to it is
`companion/`.

**This repo does not deploy it.** Nothing in Vex calls a relay until you
deploy one and put its address in Settings › Vex Sync › Pair a phone browser.
It is separate from the sync worker (`workers/vex-sync-worker`) on purpose:
that worker holds your account and needs no extra public, unauthenticated
endpoints; this one knows no account at all.

## Deploy

```
cd workers/companion
npx wrangler kv namespace create COMPANION_KV     # paste the id into wrangler.toml
npx wrangler deploy
```

No secrets are needed.

## What it keeps

- one record per pairing: the sealed snapshot (ciphertext; the key is derived
  from the pairing code on the desktop and in the phone's browser, and never
  reaches the relay), a SHA-256 of the publish token, a SHA-256 of the read
  token, and times;
- a rate-limit counter per action and client, keyed by a hash of the address
  with a salt that changes every 15 minutes, expiring after 15 minutes.

Everything expires: a code can be redeemed for 5 minutes, once; a read session
lasts the `readTtl` the desktop asked for (5 minutes to 24 hours, default 1
hour). There is no log line anywhere in `worker.js`, and `wrangler.toml` turns
Workers logs and traces off.

## Limits

| What | Limit |
|---|---|
| open a pairing | 10 per client per 15 minutes |
| redeem a code | 20 per client per 15 minutes |
| publish or revoke | 240 per client per 15 minutes |
| read the snapshot | 600 per client per 15 minutes |
| request body | 128 KiB; sealed snapshot 96 KiB |

Counters live in KV, which is not atomic: a burst can overshoot a limit a
little. They are a brake, not an account system. For a hard limit add a
Cloudflare rate-limiting rule in front of the route.

## Test it locally

The tests run the handler against an in-memory KV and a plain Node HTTP
server (`tests/workers/companionRelay.test.js`); no Cloudflare account and no
network are involved.
