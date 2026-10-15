// Vex companion page: a read-only view of your devices and their tabs for a
// phone browser that has no Vex app. Plain JavaScript, no build step, no
// dependencies. Contract: docs/COMPANION_PROTOCOL.md.
//
// The pairing code is turned into a lookup id (sent to the relay) and a key
// (kept here, in this tab's memory) with PBKDF2 and HKDF. The relay only ever
// holds ciphertext. Nothing is written to storage: close the tab and the
// session is gone.
(function () {
  'use strict';

  var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  var CODE_LENGTH = 12;
  var SALT = 'vex-companion/1';
  var ROUNDS = 100000;

  function normalizeCode(code) {
    return String(code || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  }
  function validCode(code) {
    var c = normalizeCode(code);
    if (c.length !== CODE_LENGTH) return false;
    for (var i = 0; i < c.length; i++) if (ALPHABET.indexOf(c[i]) < 0) return false;
    return true;
  }
  var enc = new TextEncoder();
  function hex(bytes) { return Array.prototype.map.call(new Uint8Array(bytes), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function fromBase64(text) {
    var bin = atob(text), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKeys(code, subtle) {
    subtle = subtle || crypto.subtle;
    if (!validCode(code)) throw new Error('That is not a pairing code');
    var base = await subtle.importKey('raw', enc.encode(normalizeCode(code)), 'PBKDF2', false, ['deriveBits']);
    var master = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(SALT), iterations: ROUNDS }, base, 256);
    var hkdfKey = await subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
    var part = function (info) {
      return subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) }, hkdfKey, 256);
    };
    var lookup = hex(await part('vex-companion lookup'));
    var keyBits = await part('vex-companion key');
    var key = await subtle.importKey('raw', keyBits, { name: 'AES-GCM' }, false, ['decrypt']);
    return { lookup: lookup, key: key };
  }

  async function open(blob, key, subtle) {
    subtle = subtle || crypto.subtle;
    var raw = fromBase64(blob);
    if (raw.length < 28) throw new Error('The snapshot is too short');
    var plain = await subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: enc.encode('vex-companion/1') }, key, raw.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function relayBase(url) {
    var u = new URL(String(url || '').trim());
    var loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw new Error('The relay must be an https address');
    return u.origin + u.pathname.replace(/\/+$/, '');
  }

  async function request(base, path, options) {
    var r = await fetch(base + path, options);
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(data.error || 'The relay answered ' + r.status); e.status = r.status; throw e; }
    return data;
  }

  // Code -> { snapshot, readToken, expiresAt, key, base }. The code works once.
  async function pair(relay, code) {
    var base = relayBase(relay);
    var keys = await deriveKeys(code);
    var res = await request(base, '/companion/v1/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lookup: keys.lookup }) });
    return { base: base, key: keys.key, readToken: res.readToken, expiresAt: res.expiresAt, snapshot: await open(res.blob, keys.key) };
  }
  async function refresh(session) {
    var res = await request(session.base, '/companion/v1/snapshot', { headers: { Authorization: 'Bearer ' + session.readToken } });
    session.expiresAt = res.expiresAt;
    session.snapshot = await open(res.blob, session.key);
    return session.snapshot;
  }

  // ---- Drawing -----------------------------------------------------------------
  function safeHref(url) { try { var u = new URL(String(url)); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch (e) { return null; } }
  function ago(ms, now) {
    if (!ms) return 'never';
    var s = Math.max(0, ((now || Date.now()) - ms) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  function el(doc, tag, className, text) {
    var n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
  function link(doc, tab) {
    var href = safeHref(tab.url);
    if (!href) return null;
    var a = el(doc, 'a', 'tab', tab.title || tab.url);
    a.href = href;
    a.rel = 'noopener noreferrer';
    a.target = '_blank';
    return a;
  }
  // Links are anchors to http(s) addresses, nothing else; there is no way to
  // change anything on the account from this page.
  function render(snapshot, root, now) {
    var doc = root.ownerDocument;
    root.textContent = '';
    var devices = (snapshot && Array.isArray(snapshot.devices)) ? snapshot.devices : [];
    if (!devices.length) root.appendChild(el(doc, 'p', 'empty', 'No devices to show.'));
    devices.forEach(function (d) {
      var section = el(doc, 'section', 'device');
      var head = el(doc, 'header', 'device-head');
      head.appendChild(el(doc, 'span', 'device-name', d.name || 'Unnamed device'));
      head.appendChild(el(doc, 'span', 'device-seen', d.self ? 'this computer' : 'seen ' + ago(d.lastSeen, now)));
      section.appendChild(head);
      var list = el(doc, 'ul', 'tabs');
      (Array.isArray(d.tabs) ? d.tabs : []).forEach(function (tab) {
        var a = link(doc, tab);
        if (!a) return;
        var li = el(doc, 'li');
        li.appendChild(a);
        list.appendChild(li);
      });
      if (!list.children.length) list.appendChild(el(doc, 'li', 'empty', 'No tabs shared.'));
      section.appendChild(list);
      root.appendChild(section);
    });
    var queue = (snapshot && Array.isArray(snapshot.readingQueue)) ? snapshot.readingQueue : [];
    if (queue.length) {
      var s = el(doc, 'section', 'device');
      s.appendChild(el(doc, 'header', 'device-head')).appendChild(el(doc, 'span', 'device-name', 'Reading queue'));
      var ul = el(doc, 'ul', 'tabs');
      queue.forEach(function (i) { var a = link(doc, i); if (a) { var li = el(doc, 'li'); li.appendChild(a); ul.appendChild(li); } });
      s.appendChild(ul);
      root.appendChild(s);
    }
  }

  // ---- The page ------------------------------------------------------------------
  function start(doc) {
    var form = doc.getElementById('pair-form');
    var relayInput = doc.getElementById('relay');
    var codeInput = doc.getElementById('code');
    var status = doc.getElementById('status');
    var out = doc.getElementById('devices');
    var pairing = doc.getElementById('pairing');
    var session = null, timer = null;

    // #r=<relay>&c=<code>: used once, then removed from the address bar.
    var params = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    if (params.get('r')) relayInput.value = params.get('r');
    if (params.get('c')) codeInput.value = params.get('c');
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);

    function say(text, bad) { status.textContent = text; status.className = bad ? 'status bad' : 'status'; }

    async function connect(ev) {
      if (ev) ev.preventDefault();
      say('Connecting…');
      try {
        session = await pair(relayInput.value, codeInput.value);
        codeInput.value = '';
        pairing.hidden = true;
        render(session.snapshot, out);
        say('Updated just now. Read only.');
        timer = setInterval(async function () {
          try { render(await refresh(session), out); say('Updated ' + ago(Date.now()) + '. Read only.'); }
          catch (err) {
            clearInterval(timer);
            session = null;
            pairing.hidden = false;
            say(err.status === 401 ? 'This session ended. Pair again from Vex on your computer.' : 'Could not refresh: ' + err.message, true);
          }
        }, 30000);
      } catch (err) {
        say(err.status === 404 ? 'That code is wrong, already used, or expired. Codes work once, for five minutes.' : err.message, true);
      }
    }
    form.addEventListener('submit', connect);
    if (relayInput.value && codeInput.value) connect();
  }

  var api = { normalizeCode: normalizeCode, validCode: validCode, deriveKeys: deriveKeys, open: open, relayBase: relayBase, pair: pair, refresh: refresh, render: render, safeHref: safeHref, start: start };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('pair-form')) start(document);
})();
