# Vex Cloudflare Workers

Two optional, self-hosted backends for Vex. Deploy your own — Vex never points
at anyone else's. Full instructions: [`../SELF_HOSTING.md`](../SELF_HOSTING.md).

- **`vex-ai-worker/`** — proxies the AI assistant to OpenRouter (Claude). Without
  it, AI falls back to local Ollama. Per-IP rate limited so a leaked URL can't
  drain your credits.
- **`vex-sync-worker/`** — end-to-end-encrypted settings/tabs/history sync. The
  server only ever stores ciphertext; the encryption key never leaves the device.
  Email-code auth with a 5-attempt cap and per-IP rate limiting.

Both `wrangler.toml` files ship with placeholder KV namespace ids — create your
own with `wrangler kv namespace create <NAME>` and paste them in before deploying.
Secrets (`OPENROUTER_API_KEY`, `RESEND_API_KEY`) are set with `wrangler secret put`
and never committed.
