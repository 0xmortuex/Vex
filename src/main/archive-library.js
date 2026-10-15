'use strict';
// === Archive library — pages you chose to keep, on this PC ================
//
// "Archive this page" writes one self-contained copy (MHTML) and its text into
// a folder Vex manages under the user data folder — never Downloads — and
// lists it with title, address, time and size. Nothing here saves by itself:
// every copy is one the person asked for, and nothing is ever deleted unless
// they say so (a full library only suggests the oldest copies).
//
// Searching reuses Recall's engine (recall-index.js: tokenizing, stemming,
// ranking, snippets) on a separate instance, because what is in it is a
// different set of pages (the ones you kept, not the ones you read), held in
// its own folder and never sent anywhere.
//
// What is refused, whoever asks: a page in a private, Tor, routed or container
// tab, a page that looks like a sign-in, a bank, a payment, mail or health
// page, and an address that carries a password or token.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RecallIndex } = require('./recall-index');

const MB = 1024 * 1024;
const LIMITS = Object.freeze({ perPageBytes: 50 * MB, totalBytes: 500 * MB, maxTextChars: 100000 });
const ID_RE = /^[a-f0-9]{16}$/;

class ArchiveRefused extends Error {
  constructor(code, message, extra) {
    super(message);
    this.name = 'ArchiveRefused';
    this.code = code;
    if (extra) Object.assign(this, extra);
  }
}

// ---- what is never archived ----------------------------------------------
const SENSITIVE_HOST = [
  /bank/i, /(^|\.)(paypal|stripe|venmo|wise|revolut|klarna|chase|wellsfargo|citi|capitalone|schwab|fidelity|vanguard|hsbc|barclays|coinbase|binance|kraken)\./i,
  /(mychart|myhealth|patient|healthcare|medical|clinic|hospital|pharmacy)/i,
  /^(mail|webmail|inbox|outlook|accounts|login|signin|sso|auth|secure|my|id)\./i,
  /(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|mail\.yahoo\.com|proton\.me|protonmail\.com)$/i,
];
const SENSITIVE_PATH = /\/(log-?in|sign-?in|sign-?on|sign-?up|register|account|my-?account|checkout|cart|payment|billing|password|reset|verify|oauth|2fa|mfa|admin|inbox)(\/|$|\?|#)/i;
const SENSITIVE_QUERY = /(^|[?&])(password|passwd|pwd|token|access_token|id_token|session|sessionid|sid|code|otp|secret|api_?key|auth)=/i;

// -> a plain-English reason this address must not be archived, or null.
function sensitiveReason(url) {
  let u;
  try { u = new URL(String(url)); } catch { return 'That is not a web address'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Only a web page can be archived';
  if (u.username || u.password) return 'An address with a password in it is never archived';
  const host = u.hostname.toLowerCase();
  if (SENSITIVE_HOST.some(re => re.test(host))) return 'This looks like a sign-in, banking, payment, mail or health site, so it is never archived';
  if (SENSITIVE_PATH.test(u.pathname)) return 'This looks like a sign-in, account or payment page, so it is never archived';
  if (SENSITIVE_QUERY.test(u.search)) return 'This address carries a token or code, so it is never archived';
  return null;
}

// -> a reason the tab it is in must not be archived, or null. Only the main
// browsing session counts: private windows, Tor and routed tabs and containers
// are what the person chose to keep traceless (as Recall treats them).
function tabRefusal(partition) {
  if (partition === 'persist:main') return null;
  return 'Private, Tor, routed and container tabs are never archived';
}

const mb = (n) => (n / MB).toFixed(n >= 10 * MB ? 0 : 1);

function isEntry(e) {
  return !!e && typeof e === 'object' && ID_RE.test(e.id) && typeof e.url === 'string' && /^https?:/i.test(e.url)
    && typeof e.title === 'string' && Number.isFinite(e.at) && Number.isFinite(e.bytes) && e.bytes >= 0;
}

function createArchiveLibrary({ dir, limits = {}, now = Date.now } = {}) {
  if (!dir || typeof dir !== 'string') throw new Error('The archive library needs a folder');
  const cap = { ...LIMITS, ...limits };
  const manifestFile = path.join(dir, 'index.json');
  let entries = null;            // newest first
  let index = null;              // RecallIndex over the texts, built on first search
  let writes = Promise.resolve();

  async function load() {
    if (entries) return entries;
    let raw;
    try { raw = await fs.promises.readFile(manifestFile, 'utf8'); }
    catch (err) {
      if (err.code === 'ENOENT') { entries = []; return entries; }
      throw new Error('The archive library list could not be read: ' + err.message, { cause: err });
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (err) { throw new Error('The archive library list is damaged (' + err.message + '); it was left as it is', { cause: err }); }
    if (!Array.isArray(parsed)) throw new Error('The archive library list is damaged; it was left as it is');
    entries = parsed.filter(isEntry).sort((a, b) => b.at - a.at);
    return entries;
  }

  function persist() {
    const bytes = JSON.stringify(entries);
    writes = writes.catch(() => {}).then(async () => {
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = manifestFile + '.tmp';
      await fs.promises.writeFile(tmp, bytes);
      await fs.promises.rename(tmp, manifestFile);
    });
    return writes;
  }

  const total = () => entries.reduce((n, e) => n + e.bytes, 0);
  const pub = (e) => ({ id: e.id, url: e.url, title: e.title, at: e.at, bytes: e.bytes, host: hostOf(e.url) });
  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
  const fileOf = (id) => path.join(dir, id + '.mhtml');
  const textOf = (id) => path.join(dir, id + '.txt');

  async function rmFile(file) {
    try { await fs.promises.unlink(file); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }

  // The oldest copies that, taken together, free `need` bytes. Only a
  // suggestion: nothing is removed until the person says which to remove.
  function oldestToFree(need, exceptId) {
    const out = [];
    let freed = 0;
    for (const e of [...entries].reverse()) {
      if (e.id === exceptId) continue;
      out.push(pub(e));
      freed += e.bytes;
      if (freed >= need) break;
    }
    return { entries: out, bytes: freed };
  }

  // write(tmpPath): an async function that puts the page's MHTML at tmpPath.
  async function save({ url, title, text, write }) {
    const reason = sensitiveReason(url);
    if (reason) throw new ArchiveRefused('sensitive', reason);
    if (typeof write !== 'function') throw new Error('Nothing was given to write the copy with');
    await load();
    await fs.promises.mkdir(dir, { recursive: true });
    const id = crypto.randomBytes(8).toString('hex');
    const part = path.join(dir, id + '.part');
    let size;
    try {
      await write(part);
      size = (await fs.promises.stat(part)).size;
    } catch (err) {
      await rmFile(part);
      throw err;
    }
    const body = String(text || '').slice(0, cap.maxTextChars);
    const textBytes = Buffer.byteLength(body);
    if (size > cap.perPageBytes) {
      await rmFile(part);
      throw new ArchiveRefused('too-big', 'This page is ' + mb(size) + ' MB and one copy can be at most ' + mb(cap.perPageBytes) + ' MB, so it was not kept.', { bytes: size, limit: cap.perPageBytes });
    }
    const prior = entries.find(e => e.url === url);
    const projected = total() - (prior ? prior.bytes : 0) + size + textBytes;
    if (projected > cap.totalBytes) {
      await rmFile(part);
      const over = projected - cap.totalBytes;
      const suggest = oldestToFree(over, prior && prior.id);
      throw new ArchiveRefused('library-full', 'The library is full (' + mb(total()) + ' of ' + mb(cap.totalBytes) + ' MB). Removing the ' + suggest.entries.length
        + ' oldest cop' + (suggest.entries.length === 1 ? 'y' : 'ies') + ' would make room. Nothing is removed unless you choose to.', { suggest: suggest.entries, over });
    }
    await fs.promises.rename(part, fileOf(id));
    await fs.promises.writeFile(textOf(id), body);
    const entry = { id, url, title: String(title || url).slice(0, 300), at: now(), bytes: size + textBytes };
    entries = [entry, ...entries.filter(e => e !== prior)];
    try { await persist(); }
    catch (err) {
      entries = entries.filter(e => e !== entry);
      if (prior) entries.push(prior);
      await rmFile(fileOf(id)); await rmFile(textOf(id));
      throw new Error('The copy could not be recorded: ' + err.message, { cause: err });
    }
    if (prior) { await rmFile(fileOf(prior.id)); await rmFile(textOf(prior.id)); }
    if (index) index.put({ url, title: entry.title, text: body, at: entry.at });
    return pub(entry);
  }

  async function list() { await load(); return entries.map(pub); }
  async function find(url) { await load(); const e = entries.find(x => x.url === url); return e ? pub(e) : null; }
  async function stats() {
    await load();
    return { count: entries.length, bytes: total(), maxBytes: cap.totalBytes, maxPageBytes: cap.perPageBytes };
  }

  async function ensureIndex() {
    if (index) return index;
    const idx = new RecallIndex([], { maxRecords: 5000, maxTextChars: cap.maxTextChars, maxBytes: 64 * MB });
    for (const e of [...entries].reverse()) {
      let text = '';
      try { text = await fs.promises.readFile(textOf(e.id), 'utf8'); }
      catch (err) { if (err.code !== 'ENOENT') throw err; }
      idx.put({ url: e.url, title: e.title, text, at: e.at });
    }
    index = idx;
    return index;
  }

  // An empty query lists everything, newest first. A query matches the title
  // and the saved text (Recall's ranking).
  async function search(query, opts = {}) {
    await load();
    const q = String(query || '').trim();
    if (!q) {
      const all = entries.map(e => ({ ...pub(e), snippet: [] }));
      return { total: all.length, hits: all.slice(0, opts.limit || 200), terms: [] };
    }
    const idx = await ensureIndex();
    const r = idx.search(q, { limit: opts.limit || 100, sort: opts.sort });
    const byUrl = new Map(entries.map(e => [e.url, e]));
    const hits = r.hits.filter(h => byUrl.has(h.url)).map(h => ({ ...pub(byUrl.get(h.url)), snippet: h.snippet }));
    return { total: hits.length, hits, terms: r.terms };
  }

  async function copyPath(id) {
    await load();
    if (!ID_RE.test(String(id))) throw new Error('That is not a saved copy');
    const e = entries.find(x => x.id === id);
    if (!e) throw new Error('That copy is not in the library any more');
    const file = fileOf(id);
    try { await fs.promises.access(file); }
    catch { throw new Error('The saved file for "' + e.title + '" is missing from the library folder'); }
    return { file, entry: pub(e) };
  }

  async function remove(id) {
    await load();
    const e = entries.find(x => x.id === id);
    if (!e) throw new Error('That copy is not in the library');
    await rmFile(fileOf(id));
    await rmFile(textOf(id));
    entries = entries.filter(x => x !== e);
    await persist();
    if (index) index.forget({ url: e.url });
    return true;
  }

  async function exportTo(id, dest) {
    const { file } = await copyPath(id);
    await fs.promises.copyFile(file, dest);
    return dest;
  }

  return { save, list, find, stats, search, copyPath, remove, exportTo, flush: () => writes, limits: cap };
}

module.exports = { createArchiveLibrary, sensitiveReason, tabRefusal, ArchiveRefused, LIMITS };
