# Vex Cloudflare Workers

Two optional, self-hosted backends for Vex. Deploy your own — Vex never points
at anyone else's. **Setup, secrets and email delivery:
[`../SELF_HOSTING.md`](../SELF_HOSTING.md)** (the single source for the steps).

- **`vex-ai-worker/`** (deploys as `vex-ai`) — proxies the AI assistant to
  OpenRouter (Claude). Without it, AI falls back to local Ollama. Every request
  needs a client token (`VEX_CLIENT_TOKENS`); the daily quota and rate limit are
  counted per client token, so a leaked URL alone can't drain your credits.
- **`vex-sync-worker/`** (deploys as `vex-sync`) — end-to-end-encrypted
  settings/tabs/history sync. The server only ever stores ciphertext; the
  encryption key never leaves the device. Email-code auth with a 5-attempt cap
  and per-email and per-IP rate limiting. Each account lives in its own Durable
  Object (`VEX_ACCOUNTS`); one global object (`VEX_STATE`) keeps only login
  codes, rate limits and which account a session token belongs to. Upgrading
  from v2.37.0 or earlier copies each account on its first request — see
  SELF_HOSTING.md, "Upgrading from v2.37.0 or earlier".

The KV namespace ids in both `wrangler.toml` files are the author's real
namespaces, not placeholders: remove the `kv_namespaces` block for a fresh
deployment (SELF_HOSTING.md says when to keep it). Secrets are set with
`wrangler secret put` and never committed:

| Worker | Secret | Required |
|---|---|---|
| vex-ai | `OPENROUTER_API_KEY` | yes |
| vex-ai | `VEX_CLIENT_TOKENS` | yes |
| vex-sync | `EMAIL_HASH_SECRET` (32+ random characters; never change it) | yes — every request returns 503 without it |
| vex-sync | `RESEND_API_KEY` | yes, for login codes |
| vex-sync | `RESEND_FROM` (a sender on a domain verified in Resend) | to email anyone but the Resend account's own address |
