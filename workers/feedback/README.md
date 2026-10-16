# Vex version-review relay

A very small Cloudflare Worker (with one Workers KV namespace) that collects the
optional version reviews Vex can send: the person rates the version they ran,
ticks a few tags and may write a comment.

**You deploy this yourself.** Vex does not ship an address for it, never
contacts one on its own, and sending is off until a person pastes a relay URL
into Settings > Version review, turns "Send my reviews" on and agrees to a
dialog that lists what is sent. Nothing in this folder has been deployed or
called by the Vex project.

## What it can see

Per review, only this:

| Data | Why |
| --- | --- |
| a random 32-character install id | so one install counts once per version; made on the person's computer, they can reset it |
| the Vex version | what was reviewed |
| 1 to 5 for up to 7 categories (speed, stability, design, features, ai, privacy, games) | the ratings |
| up to 6 tags from a fixed list | what they experienced |
| a comment, 500 characters at most | optional |
| the day it arrived (no time) | stamped by the relay |

It never receives URLs, tab titles, history, account names, hardware ids or other
settings. Unknown fields make the review be refused. Request logging is off
(`[observability] enabled = false`) and the code prints nothing.

## Endpoints

- `POST /v1/review` body as above, `application/json`, 2 KB at most. A second review
  from the same install id for the same version replaces the first.
- `GET /v1/summary` per version: the number of reviews and the average per category.
  **No comments.** Anyone can read it only if you set `PUBLIC_SUMMARY = "true"`;
  otherwise it needs the admin token too.
- `GET /v1/reviews?version=2.40.0` the reviews of that version **with comments**
  (never the install id). Needs `Authorization: Bearer <ADMIN_TOKEN>`. With no
  `ADMIN_TOKEN` secret set it is closed for everyone.

## Abuse limits

- Per sender address (SHA-256 with a salt and the hour or minute, so it cannot be
  followed over time, and never stored in clear): 60 requests a minute and
  10 reviews an hour. KV counters expire by themselves.
- Bodies over 2 KB are refused; only `application/json`; strict schema (see
  `validateReview` in `worker.js`).
- CORS: a browser request whose `Origin` is not in `ALLOWED_ORIGINS` gets a bare 403.
- Reviews are kept 365 days (KV expiry). At most 200 versions are stored.
- Averages are updated on write. KV is eventually consistent, so two reviews
  arriving in the same moment for the same version can, rarely, leave an average a
  little off; this is a feedback box, not an accounting system.

## Deploy (when you decide to)

1. `wrangler kv namespace create REVIEWS`, then put the id in `wrangler.toml`.
2. Change `name` in `wrangler.toml`.
3. `wrangler secret put ADMIN_TOKEN` (long random text). Optionally `wrangler secret put IP_SALT`.
4. `wrangler deploy`.
5. Read the comments:
   `curl -H "Authorization: Bearer <ADMIN_TOKEN>" "https://<your-worker>/v1/reviews?version=2.40.0"`

## Tests

`tests/workers/feedbackWorker.test.js` runs the worker code in memory against a fake KV
(`tests/helpers/fakeKv.js`). No network, no deployment.
