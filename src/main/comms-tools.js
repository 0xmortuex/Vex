// === Community and chat tools: what only the main process may do =============
//
// One thing in this feature set needs the main process, and it is kept as small
// and as closed as it can be:
//
//   The announcement webhook (T3-050). The owner may paste the address of a
//      webhook of HIS OWN Discord server. It is sealed by the operating system
//      (Electron safeStorage, through the same SecretStore the AI and GitHub
//      tokens use) in ONE file in the profile folder and never leaves this
//      module: status() says only whether there is one and a short label, send()
//      posts text and returns a number. It is never in localStorage, in Vex Sync,
//      in a backup, in a log, in the egress ledger (host and sizes only) or in an
//      error message (every message is scrubbed of it). The only method used is
//      POST, to that one address, with a body built HERE from the text: the window
//      shows the same body in its confirm box before it asks main to send.
//      Nothing is ever sent without that confirm (the window asks, main cannot).
//
// The Vencord bridge file and the Discord status channel that used to live here are gone:
// Discord is a plain page in Vex, and Vex reads and writes nothing for a client mod.
// A webhook is the address Discord gives a server owner for posting from outside; it
// has nothing to do with the Discord panel, the owner's account or its token.
//
// createCommsTools() is pure over its arguments so it is tested against a local
// stand-in for the webhook.
//   secretStore: { read(file, fallback), write(file, value), clear(file) }
//   fetch:       (url, init) -> Response   (main's bounded fetch)

const WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/(\d{15,25})\/([A-Za-z0-9_-]{30,120})$/;
const MAX_CONTENT = 2000;

// The exact body a webhook post sends. The window builds the same text for its confirm box
// (js/announce-composer.js payloadText); a test holds the two equal.
function buildPayload(content, allowEveryone) {
  return JSON.stringify({ content, allowed_mentions: { parse: allowEveryone ? ['everyone'] : [] } });
}

function checkWebhook(url) {
  const u = String(url == null ? '' : url).trim();
  if (!WEBHOOK_RE.test(u)) throw new Error('That is not a Discord webhook address (it looks like https://discord.com/api/webhooks/<number>/<secret>)');
  return u;
}

function webhookLabel(url) {
  const m = WEBHOOK_RE.exec(url);
  return m ? 'Discord webhook ending ' + m[1].slice(-4) : 'webhook';
}

function createCommsTools({ secretStore, webhookFile, fetch, confirm, now = () => Date.now() } = {}) {
  if (!secretStore || typeof secretStore.read !== 'function' || typeof secretStore.write !== 'function' || typeof secretStore.clear !== 'function') throw new Error('createCommsTools needs a secret store');
  if (!webhookFile) throw new Error('createCommsTools needs its webhook file');
  if (typeof fetch !== 'function') throw new Error('createCommsTools needs a fetch');
  if (typeof confirm !== 'function') throw new Error('createCommsTools needs a confirm box');

  const scrub = (text, url) => {
    let s = String(text == null ? '' : text);
    if (url) s = s.split(url).join('[webhook]');
    return s.replace(/https:\/\/[^\s"']*\/api\/webhooks\/[^\s"']+/g, '[webhook]');
  };

  async function readWebhook() {
    const rec = await secretStore.read(webhookFile, () => null);
    return rec && typeof rec.url === 'string' && rec.url ? rec.url : '';
  }

  // { has, label, savedAt } - never the address.
  async function webhookStatus() {
    const rec = await secretStore.read(webhookFile, () => null);
    const has = !!(rec && typeof rec.url === 'string' && rec.url);
    return { has, label: has ? webhookLabel(rec.url) : '', savedAt: has ? rec.savedAt || 0 : 0 };
  }
  async function webhookSet(url) {
    const u = checkWebhook(url);
    await secretStore.write(webhookFile, { v: 1, url: u, savedAt: now() });
    return { ok: true, has: true, label: webhookLabel(u) };
  }
  async function webhookClear() {
    await secretStore.clear(webhookFile);
    return { ok: true, has: false };
  }

  // Posts one message to the owner's webhook. The window has already shown the exact body and been
  // told "Send"; there is no way to reach this without it, and nothing here schedules or repeats a post.
  async function webhookSend({ content, allowEveryone = false } = {}) {
    const url = await readWebhook();
    if (!url) throw new Error('There is no webhook saved. Add your own server\'s webhook address first.');
    const text = String(content == null ? '' : content).trim();
    if (!text) throw new Error('There is nothing to post');
    if (text.length > MAX_CONTENT) throw new Error('Discord takes at most ' + MAX_CONTENT + ' characters in one message; this is ' + text.length);
    // A post that pings everyone is confirmed here, by main, so a script in a window cannot answer for the owner.
    // Shown: the host only (the address carries the secret) and the first 200 characters.
    if (allowEveryone) {
      const yes = await confirm({
        title: 'Post to your Discord webhook and ping everyone?',
        message: 'To: ' + new URL(url).host + '\n\n' + text.slice(0, 200) + (text.length > 200 ? '…' : ''),
        okLabel: 'Post',
      });
      if (!yes) throw new Error('The post was cancelled');
    }
    let res;
    try {
      res = await fetch(url, { method: 'POST', redirect: 'error', credentials: 'omit', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Vex' }, body: buildPayload(text, !!allowEveryone), timeoutMs: 15000, maxBytes: 64 * 1024, egress: { feature: 'Announcement composer (your webhook)', kind: 'fetch' } });
    } catch (err) {
      err.message = scrub(err.message, url);
      throw new Error('The webhook could not be reached: ' + err.message, { cause: err });
    }
    if (res.status === 429) throw new Error('Discord says to wait before posting again');
    if (res.status === 404 || res.status === 401) throw new Error('Discord no longer accepts that webhook (it may have been deleted). Remove it and add a new one.');
    if (!(res.status >= 200 && res.status < 300)) throw new Error('Discord answered ' + res.status);
    return { ok: true, status: res.status, sent: text.length };
  }

  return { webhookStatus, webhookSet, webhookClear, webhookSend };
}

module.exports = { createCommsTools, buildPayload, checkWebhook, webhookLabel, WEBHOOK_RE, MAX_CONTENT };
