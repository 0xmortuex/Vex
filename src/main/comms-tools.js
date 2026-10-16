// === Community and chat tools: what only the main process may do =============
//
// Two things in this feature set need the main process, and both are kept as
// small and as closed as they can be:
//
//   1. The announcement webhook (T3-050). The owner may paste the address of a
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
//   2. The Vencord bridge file (T3-005). The owner's own Vencord plugin may write
//      a small JSON file (docs/vencord-bridge.md). The owner picks the FOLDER in a
//      system dialog; main remembers that one path and reads exactly one file
//      name from it, never lists the folder, never follows a link, never writes,
//      caps the size, validates the shape and hands the window cleaned data.
//      Vex never reads Discord itself for this: it reads a file the owner's plugin
//      wrote.
//
// createCommsTools() is pure over its arguments so it is tested against a local
// stand-in for the webhook and a temporary folder.
//   secretStore: { read(file, fallback), write(file, value), clear(file) }
//   fetch:       (url, init) -> Response   (main's bounded fetch)
//   pickFolder:  async () -> a folder path or null

const nodeFs = require('fs');
const nodePath = require('path');

const WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/(\d{15,25})\/([A-Za-z0-9_-]{30,120})$/;
const MAX_CONTENT = 2000;
const BRIDGE_FILE = 'vex-bridge.json';
const BRIDGE_SCHEMA = 'vex-bridge/1';
const MAX_BRIDGE_BYTES = 1024 * 1024;
const LIMITS = { mentions: 200, replies: 200, channels: 20, perChannel: 100, text: 2000, name: 100 };
const DISCORD_URL = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(?:@me|\d{5,25})\/\d{5,25}(?:\/\d{5,25})?$/;

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

// ---- the bridge file: cleaned, never trusted ---------------------------------
const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const when = (v) => {
  const n = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

function cleanMessage(m, kind) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const id = clean(m.id, 40);
  const text = clean(m.text, LIMITS.text);
  const ts = when(m.ts);
  if (!id || !text || !ts) return null;
  const out = { id, author: clean(m.author, LIMITS.name), text, ts };
  if (kind !== 'channel') {
    out.channelId = clean(m.channelId, 40);
    out.channelName = clean(m.channelName, LIMITS.name);
    out.guildName = clean(m.guildName, LIMITS.name);
    const url = clean(m.url, 200);
    if (url) { if (!DISCORD_URL.test(url)) return null; out.url = url; }
  }
  return out;
}

// -> { schema, generatedAt, account, mentions, replies, channels, skipped }
// `skipped` counts what was dropped for not fitting the schema, so a damaged file is visible, not silent.
function sanitizeBridge(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The bridge file is not a JSON object');
  if (raw.schema !== BRIDGE_SCHEMA) throw new Error('The bridge file is not "' + BRIDGE_SCHEMA + '" (it says ' + JSON.stringify(clean(raw.schema, 40)) + ')');
  let skipped = 0;
  const list = (v, max, kind) => {
    if (v == null) return [];
    if (!Array.isArray(v)) throw new Error('The bridge file has a "' + kind + '" that is not a list');
    const out = [];
    for (const item of v.slice(0, max)) { const c = cleanMessage(item, kind); if (c) out.push(c); else skipped++; }
    skipped += Math.max(0, v.length - max);
    return out;
  };
  const mentions = list(raw.mentions, LIMITS.mentions, 'mention');
  const replies = list(raw.replies, LIMITS.replies, 'reply');
  const channels = [];
  if (raw.channels != null) {
    if (!Array.isArray(raw.channels)) throw new Error('The bridge file has "channels" that is not a list');
    for (const c of raw.channels.slice(0, LIMITS.channels)) {
      if (!c || typeof c !== 'object' || !clean(c.channelId, 40)) { skipped++; continue; }
      const msgs = [];
      for (const m of (Array.isArray(c.messages) ? c.messages : []).slice(0, LIMITS.perChannel)) { const cm = cleanMessage(m, 'channel'); if (cm) msgs.push(cm); else skipped++; }
      channels.push({ channelId: clean(c.channelId, 40), name: clean(c.name, LIMITS.name), guildName: clean(c.guildName, LIMITS.name), messages: msgs });
    }
    skipped += Math.max(0, raw.channels.length - LIMITS.channels);
  }
  return { schema: BRIDGE_SCHEMA, generatedAt: when(raw.generatedAt), account: clean(raw.account && raw.account.name, LIMITS.name), mentions, replies, channels, skipped };
}

function createCommsTools({ secretStore, webhookFile, bridgeConfigFile, fs = nodeFs, fetch, pickFolder, confirm, now = () => Date.now() } = {}) {
  if (!secretStore || typeof secretStore.read !== 'function' || typeof secretStore.write !== 'function' || typeof secretStore.clear !== 'function') throw new Error('createCommsTools needs a secret store');
  if (!webhookFile || !bridgeConfigFile) throw new Error('createCommsTools needs its two files');
  if (typeof fetch !== 'function') throw new Error('createCommsTools needs a fetch');
  if (typeof pickFolder !== 'function') throw new Error('createCommsTools needs a folder picker');
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

  // ---- the bridge -----------------------------------------------------------
  function readConfig() {
    let raw;
    try { raw = fs.readFileSync(bridgeConfigFile, 'utf8'); }
    catch (err) { if (err && err.code === 'ENOENT') return null; throw err; }
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved bridge folder is not readable', { cause: err }); }
    return v && typeof v.folder === 'string' && v.folder ? v : null;
  }
  function target() {
    const cfg = readConfig();
    if (!cfg) throw new Error('No bridge folder has been chosen');
    return { cfg, file: nodePath.join(cfg.folder, BRIDGE_FILE) };
  }
  function bridgeStatus() {
    const cfg = readConfig();
    if (!cfg) return { granted: false, folder: '', found: false };
    const file = nodePath.join(cfg.folder, BRIDGE_FILE);
    let st = null;
    try { st = fs.lstatSync(file); } catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    return { granted: true, folder: cfg.folder, found: !!(st && st.isFile()), mtime: st && st.isFile() ? Math.round(st.mtimeMs) : 0, size: st && st.isFile() ? st.size : 0 };
  }
  async function bridgePick() {
    const folder = await pickFolder();
    if (!folder) return { ok: false, canceled: true };
    if (!fs.statSync(folder).isDirectory()) throw new Error('That is not a folder');
    fs.writeFileSync(bridgeConfigFile, JSON.stringify({ v: 1, folder: nodePath.resolve(folder), grantedAt: now() }));
    return { ok: true, ...bridgeStatus() };
  }
  function bridgeForget() {
    try { fs.unlinkSync(bridgeConfigFile); } catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    return { ok: true, granted: false };
  }
  function bridgeRead() {
    const { file } = target();
    let st;
    try { st = fs.lstatSync(file); }
    catch (err) { if (err && err.code === 'ENOENT') throw new Error('The folder has no ' + BRIDGE_FILE + ' yet. Your Vencord plugin writes it; see docs/vencord-bridge.md.', { cause: err }); throw err; }
    if (!st.isFile()) throw new Error(BRIDGE_FILE + ' is a link or a folder, and is not read');
    if (st.size > MAX_BRIDGE_BYTES) throw new Error(BRIDGE_FILE + ' is larger than ' + (MAX_BRIDGE_BYTES / 1024) + ' KB, so it is not read');
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (err) { throw new Error(BRIDGE_FILE + ' is not valid JSON: ' + err.message, { cause: err }); }
    return { ok: true, mtime: Math.round(st.mtimeMs), data: sanitizeBridge(raw) };
  }

  return { webhookStatus, webhookSet, webhookClear, webhookSend, bridgeStatus, bridgePick, bridgeForget, bridgeRead };
}

module.exports = { createCommsTools, sanitizeBridge, buildPayload, checkWebhook, webhookLabel, WEBHOOK_RE, BRIDGE_FILE, BRIDGE_SCHEMA, MAX_CONTENT, MAX_BRIDGE_BYTES, LIMITS };
