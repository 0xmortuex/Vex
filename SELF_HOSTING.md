# Self-hosting Vex's cloud features

Vex works fully offline with a local [Ollama](https://ollama.com) model and no
account. The two **optional** cloud features — the hosted AI assistant and
cross-device Sync — run on [Cloudflare Workers](https://workers.cloudflare.com)
that **you deploy yourself**. Nothing in the app points at anyone else's backend,
so you never spend someone else's API credits or store your data on their server.

Both workers require the `VEX_STATE` Durable Object binding and SQLite migration
in their checked-in Wrangler configuration. Provider usage and model requests
may incur charges; this repository does not establish a deployment cost ceiling.

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

# 2. Add your OpenRouter key as a secret (never commit it)
wrangler secret put OPENROUTER_API_KEY

# Add a JSON object mapping client names to random access tokens.
# Example shape: {"desktop":"<random token of at least 24 characters>"}
wrangler secret put VEX_CLIENT_TOKENS

# 3. Deploy
wrangler deploy
```

Wrangler prints a URL like `https://vex-ai.<your-subdomain>.workers.dev`. Put it
in Vex under **Settings → Cloud Services (self-hosted) → AI Worker URL**.
Save the matching token in **AI access token**. The desktop stores this token
using OS encryption and attaches it to cloud requests in the main process.

The worker requires a valid bearer token. Quotas use durable storage and fail
closed when unavailable. `DAILY_REQUEST_LIMIT` defaults to 200 per client name
and accepts an integer from 1 through 1000; per-IP limits also apply. Request
counts limit usage but do not guarantee a monetary cap. Tokens with the same
client name share its quota; never embed the OpenRouter key in the desktop app.

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

# 2. Configure production email delivery
wrangler secret put RESEND_API_KEY
# Set your provider-authorized sender, e.g. Vex Sync <sync@your-domain.example>
wrangler secret put RESEND_FROM

# 3. Deploy
wrangler deploy
```

Put the printed URL in Vex under **Settings → Cloud Services (self-hosted) →
Sync Worker URL**, then enable Sync in Settings.

Auth uses a six-digit email code with a five-attempt cap and rate limiting.
`RESEND_FROM` defaults to the provider's onboarding sender; configure an
authorized sender for your deployment and test delivery to intended recipients.
Only local development requests with `DEVELOPMENT_MODE=true` may return a
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
