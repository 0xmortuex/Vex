# Self-hosting Vex's cloud features

Vex works fully offline with a local [Ollama](https://ollama.com) model and no
account. The two **optional** cloud features — the hosted AI assistant and
cross-device Sync — run on [Cloudflare Workers](https://workers.cloudflare.com)
that **you deploy yourself**. Nothing in the app points at anyone else's backend,
so you never spend someone else's API credits or store your data on their server.

Both are free-tier friendly. You only need what you actually want to use.

---

## 1. AI assistant worker (`vex-ai-worker`)

Proxies AI requests to [OpenRouter](https://openrouter.ai) (Claude). Without it,
AI features fall back to local Ollama.

**You need:** a Cloudflare account, the `wrangler` CLI (`npm i -g wrangler`), and
an OpenRouter API key.

```bash
cd workers/vex-ai-worker

# 1. Create the rate-limit KV namespace and paste the printed id into wrangler.toml
wrangler kv namespace create VEX_AI_KV
#   -> copy the id into the VEX_AI_KV binding in wrangler.toml

# 2. Add your OpenRouter key as a secret (never commit it)
wrangler secret put OPENROUTER_API_KEY

# 3. Deploy
wrangler deploy
```

Wrangler prints a URL like `https://vex-ai.<your-subdomain>.workers.dev`. Put it
in Vex under **Settings → Cloud Services (self-hosted) → AI Worker URL**.

> The worker rate-limits per IP (30/min, 1000/day) so a leaked URL can't drain
> your credits. The limit needs the `VEX_AI_KV` namespace; if you skip step 1 it
> fails open (no limit).

---

## 2. Sync worker (`vex-sync-worker`)

End-to-end-encrypted settings/tabs/history sync across devices. Your data is
encrypted **on-device** with a key that never leaves your machine — the server
only ever stores ciphertext. Without this worker, Sync stays off.

**You need:** a Cloudflare account and `wrangler`. Email delivery (for the login
code) is optional via [Resend](https://resend.com); without it, the code is only
visible in `wrangler tail` logs.

```bash
cd workers/vex-sync-worker

# 1. Create the two KV namespaces, paste each id into wrangler.toml
wrangler kv namespace create VEX_SYNC_KV
wrangler kv namespace create VEX_AUTH_KV
#   -> copy both ids into the matching bindings in wrangler.toml

# 2. (Optional) email delivery for the login code
wrangler secret put RESEND_API_KEY

# 3. Deploy
wrangler deploy
```

Put the printed URL in Vex under **Settings → Cloud Services (self-hosted) →
Sync Worker URL**, then enable Sync in Settings.

> Auth uses a 6-digit email code with a 5-attempt cap and per-IP rate limiting.
> If you don't configure Resend, read the code from `wrangler tail` during login.

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
