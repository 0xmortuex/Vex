# Deploying the three optional relays (owner steps)

Vex ships the source of three small Cloudflare Workers. None of them is deployed by this repository, Vex never contacts
one until a person pastes its address into Settings, and each is off until then. Nothing below has been run against
Cloudflare: the repo's tests drive each worker in memory (fake KV / fake Durable Object storage), with no network.

You need a Cloudflare account and `npx wrangler login` once. Nothing here needs a secret in a file; secrets go through
`wrangler secret put`. Run every command from the repository root.

| Relay | Folder | Storage | Secrets | Vex setting |
|---|---|---|---|---|
| Co-op focus timer | `workers/coop-timer` | 2 Durable Objects (SQLite) | none | Settings > Co-op focus timer > Relay URL |
| Companion (phone browser) | `workers/companion` | 1 KV namespace | none | Settings > Vex Sync > Pair a phone browser |
| Version-review feedback | `workers/feedback` | 1 KV namespace | `ADMIN_TOKEN` (needed to read), `IP_SALT` (optional) | Settings > Version review > Relay URL |

## 1. Co-op focus timer

1. Edit `workers/coop-timer/wrangler.toml`: set `name` to your own worker name. Leave `ALLOWED_ORIGINS = "null"` (the origin
   Vex's local window sends) unless you host your own page.
2. `cd workers/coop-timer` then `npx wrangler deploy`. Durable Objects need a plan that includes them; the free plan's
   SQLite-backed kind is what the migration (`v1`, `CoopRoom`, `CoopGate`) uses.
3. Paste `https://<name>.<account>.workers.dev` into Vex.

Limits are in the worker (8 members a room, 24-character names, 1 to 120 minutes, per-address and per-room request caps,
1 KB bodies); a room is deleted 2 hours after its last activity.

## 2. Companion relay

1. `cd workers/companion`
2. `npx wrangler kv namespace create COMPANION_KV` and paste the printed id over `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` in
   `wrangler.toml` (the worker answers 503 until the binding exists).
3. Change `name` if you do not want `vex-companion`, then `npx wrangler deploy`.
4. Paste the address into Vex and start a pairing. The phone page is `companion/` in this repository (static).

The relay stores ciphertext only (the key never reaches it) and keeps no log line; `wrangler.toml` turns logs and traces off.
Counters live in KV, which is not atomic, so add a Cloudflare rate-limiting rule in front of the route if you need a hard cap.

## 3. Feedback (version review) relay

1. `cd workers/feedback`
2. `npx wrangler kv namespace create REVIEWS` and paste the id into `wrangler.toml`; change `name`.
3. `npx wrangler secret put ADMIN_TOKEN` (long random text). Without it `GET /v1/reviews` stays closed for everyone.
   Optional: `npx wrangler secret put IP_SALT`.
4. Decide `PUBLIC_SUMMARY` in `wrangler.toml` (`"true"` lets anyone read the averages; comments are never public).
5. `npx wrangler deploy`, then paste the address into Vex and turn "Send my reviews" on.
6. Read the comments: `curl -H "Authorization: Bearer <ADMIN_TOKEN>" "https://<your-worker>/v1/reviews?version=<x.y.z>"`.

## Tests (no network)

```
npx vitest run tests/workers/coopTimerWorker.test.js tests/workers/companionRelay.test.js tests/workers/feedbackWorker.test.js tests/main/companion.test.js --maxWorkers=1
```

`companionRelay.test.js` covers the companion handler's input validation (lookup, hash, blob size, JSON shape, body size),
the one-time code and its expiry, authorisation of publish and revoke, the read session, the rate limits and the "no
console call, no real KV id" promises of the source.

## What is not verified

Actual deployment, Durable Object migration on a real account, real rate-limit behaviour under concurrent KV writes, and
`wrangler.toml` acceptance by the current wrangler (no `wrangler deploy` or `--dry-run` was run).
