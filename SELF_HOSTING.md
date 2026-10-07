# Self-hosting Vex's cloud features

Vex works fully offline with a local [Ollama](https://ollama.com) model and no
account. The two **optional** cloud features — the hosted AI assistant and
cross-device Sync — run on [Cloudflare Workers](https://workers.cloudflare.com)
that **you deploy yourself**. Nothing in the app points at anyone else's backend,
so you never spend someone else's API credits or store your data on their server.

Both workers require the `VEX_STATE` Durable Object binding and SQLite migration
in their checked-in Wrangler configuration. Provider usage and model requests
may incur charges; this repository does not establish a deployment cost ceiling.

**Names.** The folders are `vex-ai-worker` and `vex-sync-worker`; the Workers they
deploy are named `vex-ai` and `vex-sync` (the `name` in each `wrangler.toml`) —
those are the names the Cloudflare dashboard and `wrangler tail` use.

**The KV ids in the checked-in `wrangler.toml` files are the author's own
namespaces, not placeholders.** They are useless without the author's Cloudflare
account (they are not secrets), but a deployment on your account cannot bind
them: remove the `kv_namespaces` block for a fresh deployment, as below.

**Order on a brand-new account: deploy first, then add the secrets.** Before the
Worker exists, `wrangler secret put` stops to ask whether to create it, and a
piped value (as in the `EMAIL_HASH_SECRET` line below) cannot answer that
question. A deployed Worker without its secrets answers every request with
HTTP 503, so nothing is exposed in between. Secrets take effect as soon as they
are set — no second deploy is needed.

---

## 1. AI assistant worker (`vex-ai-worker`)

Proxies AI requests to [OpenRouter](https://openrouter.ai) (Claude). Without it,
AI features fall back to local Ollama.

**You need:** a Cloudflare account, the `wrangler` CLI (`npm i -g wrangler`), and
an OpenRouter API key.

```bash
cd workers/vex-ai-worker

# 1. Remove the unused legacy kv_namespaces block for a fresh deployment.
# Keep the durable_objects and migrations sections.

# 2. Deploy (it answers 503 until the secrets below exist)
wrangler deploy

# 3. Add your OpenRouter key as a secret (never commit it)
wrangler secret put OPENROUTER_API_KEY

# 4. Make an access token for each client (a desktop, a laptop...):
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# then store them as a JSON object mapping a client name to its token, e.g.
#   {"desktop":"<token 1>","laptop":"<token 2>"}
# (each token at least 24 characters)
wrangler secret put VEX_CLIENT_TOKENS
```

Wrangler prints a URL like `https://vex-ai.<your-subdomain>.workers.dev`. Put it
in Vex under **Settings → Cloud Services (self-hosted) → AI Worker URL**.
Save the matching token in **AI access token**. The desktop stores this token
using OS encryption and attaches it to cloud requests in the main process.

The worker requires a valid bearer token. Quotas use durable storage and fail
closed when unavailable. `DAILY_REQUEST_LIMIT` defaults to 200 per client name
and accepts an integer from 1 through 1000; set it as a plain variable in
`wrangler.toml`:

```toml
[vars]
DAILY_REQUEST_LIMIT = "100"
```

The daily quota and the per-minute rate limit are counted per client name (per
token), not per IP address: every device using the same token shares them.
Request counts limit usage but do not guarantee a monetary cap. Never embed the
OpenRouter key in the desktop app.

---

## 2. Sync worker (`vex-sync-worker`)

End-to-end-encrypted settings/tabs/history sync across devices. Your data is
encrypted **on-device**. The server stores encrypted sync documents and tab
handoffs, together with authentication, device, revision, and timing metadata.
Keep your recovery code safe: enrolling another device in an existing account
requires that key. Without this worker, Sync stays off.

**You need:** a Cloudflare account, `wrangler`, and production email delivery via
[Resend](https://resend.com). Without email configuration, production login
returns HTTP 503. Login codes are not exposed in production responses or logs.

```bash
cd workers/vex-sync-worker

# 1. For a fresh deployment, remove the legacy kv_namespaces block.
# For an upgrade, retain your existing VEX_SYNC_KV and VEX_AUTH_KV IDs.
# In both cases keep the durable_objects and migrations sections.

# 2. Deploy (on a new account, before the secrets — see the note at the top).
# Until EMAIL_HASH_SECRET is set, every sync request returns 503.
wrangler deploy

# 3. The key accounts are stored under (an HMAC of the email address).
# Required. Never change it afterwards — a new value loses every account.
# Accounts made before this secret existed move to it the next time they
# sign in.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | wrangler secret put EMAIL_HASH_SECRET

# 4. Configure email delivery (see "Who can receive login codes" below)
wrangler secret put RESEND_API_KEY
# A sender on a domain you verified in Resend, e.g. Vex Sync <sync@your-domain.example>
wrangler secret put RESEND_FROM
```

### Who can receive login codes

Without `RESEND_FROM`, the worker sends from Resend's shared test sender
`onboarding@resend.dev`. **Resend delivers mail from that sender only to the
email address that owns the Resend account.** Signing in with any other address
fails ("Could not deliver verification email", HTTP 502). To send codes to
anyone else:

1. Add and verify your own domain in Resend (Domains → Add domain, then the DNS
   records it lists).
2. Set `RESEND_FROM` to an address on that domain, e.g.
   `Vex Sync <sync@your-domain.example>`.

Check delivery after setting it up: run `wrangler tail vex-sync` in one window
and request a code from Vex in another. "Email delivery is not configured"
(HTTP 503) means `RESEND_API_KEY` is not set; HTTP 502 means Resend refused
the request — the tail and the Resend dashboard's log say why (most often an
unverified sender domain).

Put the printed URL in Vex under **Settings → Cloud Services (self-hosted) →
Sync Worker URL**, then enable Sync in Settings.

Auth uses a six-digit email code with a five-attempt cap and rate limiting
(per email address and per IP). Only local development requests with `DEVELOPMENT_MODE=true` may return a
`devCode` without email. Do not rely on this path for a deployed service.

On upgrade, durable storage imports legacy sync records and eligible sessions
when read. Old login codes are not imported: request a new code. Preserve the
legacy namespaces until migration is verified. The desktop writes versioned
encrypted records with revisions, tombstones, and retained conflict variants.
An outdated push receives HTTP 409; pull and merge before retrying. A failed
decryption blocks uploads until a successful pull, preventing a wrong local key
from overwriting cloud data. Back up local data and recovery codes before an
upgrade; deployed multi-device migration has not yet been integration-tested.

---

## 3. Optional: local sidebar config

`sidebar-config.json` (in your Vex `userData` folder — Windows:
`%APPDATA%\Vex\sidebar-config.json`) holds personal, never-committed values:

- `aiNewsUrl` — adds an "AI News" tool pointing at a URL you choose.
- `queueUrl` / `queueSecret` — enables the Queue panel against a self-hosted
  task-queue Worker.

Copy `sidebar-config.example.json` as a starting point. It's gitignored.

---

## What ships with no configuration

| Feature              | Unconfigured behavior                          |
|----------------------|------------------------------------------------|
| AI assistant         | Local Ollama only; cloud shows a setup hint    |
| Sync                 | Off until a Sync Worker URL is set             |
| GitHub panel/widget  | Shows a "set your username in Settings" hint   |
| Start-page greeting  | Neutral (no name) until you set a display name |
| Tools bar / My Tools | Empty; add your own                            |
