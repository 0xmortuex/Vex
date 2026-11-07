'use strict';
// === Content pinning for remote theme files ====================================
//
// "Match Discord to my Vex theme" can load a real Discord theme from the theme maker's own site (GitHub Pages or
// jsDelivr). Until now a theme file that changed upstream was used the moment it changed. This keeps a pin:
//
//   first time a theme is checked   its SHA-256 and a copy of the file are kept (trust on first use: the file was
//                                   the one the maker published when you first switched the theme on)
//   later, same hash                nothing happens
//   later, different hash           NOT applied. The kept copy is applied instead, and the owner is told once per
//                                   upstream change. "Use the new version" (accept) pins the new file.
//
// HONEST LIMITS. Vex fetches the file to hash it, and the Discord page fetches it again by itself, so a server
// that answers the two requests differently is not caught. Only the one CSS file is pinned: files it @imports or
// images it points to are not. A program running as you can rewrite the pin. This catches an upstream change
// (a maker's edit, a hijacked account, a CDN swap), not a determined attacker on this PC. Nothing is deleted:
// accept replaces the pin, and the old copy is simply overwritten by the new approved one.
//
// Pure with injected fs/clock. One file per theme: <dir>/<key>.json.
const crypto = require('crypto');
const nodePath = require('path');
const { atomicWriteSync, readJsonRecoverSync } = require('./file-store');

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_BYTES = 1024 * 1024;
// Only the hosts the theme list uses. A window cannot make main fetch anything else.
const HOST_RE = /^(?:[a-z0-9-]+\.github\.io|cdn\.jsdelivr\.net)$/;

const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

function checkKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw new Error('A theme pin needs a theme id of letters, digits and dashes');
  return key;
}
function checkUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { throw new Error('The theme address is not a web address'); }
  if (u.protocol !== 'https:' || !HOST_RE.test(u.hostname) || u.username || u.password) throw new Error('Theme files are only pinned from github.io and cdn.jsdelivr.net over https');
  return u.href;
}

// fetchText(url) -> Promise<string> (the caller's network function: it must go through the egress ledger).
function createContentPin({ dir, fs = require('fs'), fetchText, now = () => Date.now(), log = console }) {
  if (!dir) throw new Error('createContentPin needs a folder');
  if (typeof fetchText !== 'function') throw new Error('createContentPin needs a fetchText function');
  const fileFor = (key) => nodePath.join(dir, checkKey(key) + '.json');

  function read(key) {
    const r = readJsonRecoverSync(fileFor(key), { fsImpl: fs });
    if (r.source === 'lost') log.error('[ThemePin] the pin for ' + key + ' could not be read and was kept aside (' + r.corruptCopy + '):', r.error && r.error.message);
    const d = r.data;
    if (!d || d.v !== 1 || typeof d.sha256 !== 'string' || typeof d.css !== 'string') return null;
    // The kept copy must be the pinned file: a copy that no longer hashes to the pin is not trusted.
    if (sha256(d.css) !== d.sha256) { log.error('[ThemePin] the kept copy of ' + key + ' does not match its pin, so it is not used'); return null; }
    return d;
  }
  function write(key, rec) { atomicWriteSync(fileFor(key), JSON.stringify(rec), { fsImpl: fs }); }

  async function download(url) {
    const text = await fetchText(url);
    if (typeof text !== 'string' || !text.trim()) throw new Error('The theme file was empty');
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('The theme file is larger than 1 MB, so it is not pinned');
    return text;
  }

  // -> { ok, status: 'pinned'|'same'|'changed', css?, announce? , newSha?, pinnedSha? }
  //    css is what to apply instead of the live link (only when 'changed', or when the live file could not be read
  //    and a kept copy exists). announce is true the first time this upstream hash is seen.
  async function check(key, url) {
    const href = checkUrl(url);
    const pin = read(key);
    let text;
    try { text = await download(href); }
    catch (err) {
      if (pin && pin.url === href) return { ok: false, error: err.message, css: pin.css, pinnedSha: pin.sha256 };
      return { ok: false, error: err.message };
    }
    const hash = sha256(text);
    if (!pin || pin.url !== href) {
      write(key, { v: 1, url: href, sha256: hash, size: Buffer.byteLength(text, 'utf8'), approvedAt: now(), seenSha: hash, css: text });
      return { ok: true, status: 'pinned', pinnedSha: hash };
    }
    if (pin.sha256 === hash) return { ok: true, status: 'same', pinnedSha: hash };
    const announce = pin.seenSha !== hash;
    if (announce) write(key, { ...pin, seenSha: hash });
    return { ok: true, status: 'changed', css: pin.css, announce, newSha: hash, pinnedSha: pin.sha256 };
  }

  // The owner chose "Use the new version": download what is there now and pin it.
  async function accept(key, url) {
    const href = checkUrl(url);
    const text = await download(href);
    const hash = sha256(text);
    write(key, { v: 1, url: href, sha256: hash, size: Buffer.byteLength(text, 'utf8'), approvedAt: now(), seenSha: hash, css: text });
    return { ok: true, status: 'pinned', pinnedSha: hash };
  }

  return { check, accept };
}

module.exports = { createContentPin, sha256, KEY_RE, HOST_RE, MAX_BYTES, checkUrl, checkKey };
