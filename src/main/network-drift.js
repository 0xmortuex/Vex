'use strict';
// === "Did a proxy or a new root certificate appear since the last time?" ==========
//
// OFF until the owner switches it on in Settings (it runs two Windows commands a short while after start-up). When on, it looks at
// two things on Windows, both read-only:
//
//   * the system proxy: the Internet Settings registry key of this Windows user (ProxyEnable, ProxyServer, AutoConfigURL),
//     read with `reg query` and an argument list (no shell string);
//   * the root certificates this Windows user trusts (Cert:\CurrentUser\Root), listed with one fixed PowerShell command.
//
// It keeps only a fingerprint of the proxy setting and the list of certificate thumbprints, and on the next look reports what is
// NEW: a proxy or setup script that appeared or changed, and root certificates that were added (with their subject names, read fresh).
// The first look only records what is there. It never changes a Windows setting, never removes a certificate, never turns a proxy off.
//
// HONEST LIMITS. Someone who can edit the registry or the certificate store as you can also edit Vex's small record file; a change
// that is made and undone between two looks is not seen; the computer-wide certificate store (installed by an administrator) is not looked
// at, only the one of this Windows user. A proxy or a new root can be your school or work, an antivirus, a VPN or a developer tool -
// or someone listening in; Vex cannot tell which, and says so.
//
// The runner is injected: run(file, args, { timeoutMs }) -> Promise<{ stdout }>. Tests never start a process.
const crypto = require('crypto');
const { atomicWriteSync, readJsonRecoverSync } = require('./file-store');

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
// One fixed script, no data in it. Output: "<THUMBPRINT>\t<subject>" per line, UTF-8. It is handed over as -EncodedCommand (base64 of
// UTF-16LE), so no quote in it ever depends on how Windows splits a command line.
const PS_SCRIPT = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-ChildItem Cert:\\CurrentUser\\Root | ForEach-Object { $_.Thumbprint + \"`t\" + $_.Subject }";
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')];
const MAX_CERTS = 2000;
// The words of the rows (each one whole, so each has its own Turkish line in js/i18n-ui.js).
const BODY_PROXY = 'A proxy sees the addresses of the sites you visit, and for sites it can read it sees more. It could be your school or work, an antivirus or a VPN, a developer tool, or someone listening in. Vex cannot tell which, and changed nothing.';
const BODY_PAC = 'A proxy setup script decides where your web traffic goes. It could be your school or work, an antivirus or a VPN, a developer tool, or someone listening in. Vex cannot tell which, and changed nothing.';
const BODY_CERT = 'A root certificate lets whoever holds it vouch for any website to this account on this PC. It could be your school or work, an antivirus or a VPN, a developer tool, or someone listening in. Vex cannot tell which, and changed nothing.';
const BODY_MORE = 'Only the first few are listed here. It could be your school or work, an antivirus or a VPN, a developer tool, or someone listening in. Vex cannot tell which, and changed nothing.';
const MAX_SHOWN = 5;

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const clip = (s, n) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').slice(0, n);

// `reg query` text -> { on, server, pac }.
function parseProxy(stdout) {
  const values = {};
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = /^\s+(ProxyEnable|ProxyServer|AutoConfigURL)\s+(REG_[A-Z_]+)\s*(.*?)\s*$/.exec(line);
    if (m) values[m[1]] = m[3];
  }
  const enabled = /^(0x0*1|1)$/i.test(values.ProxyEnable || '');
  const server = enabled ? clip(values.ProxyServer, 200) : '';
  const pac = clip(values.AutoConfigURL, 300);
  return { on: !!(server || pac), server, pac };
}
// The fingerprint that is kept: whether any proxy is set, and a hash of what it is (the address itself is not kept).
const proxyPrint = (p) => ({ on: p.on, hash: sha(JSON.stringify([p.server, p.pac])) });

// PowerShell output -> [{ thumbprint, subject }], sorted by thumbprint.
function parseCerts(stdout) {
  const out = [];
  for (const line of String(stdout || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = /^([0-9A-Fa-f]{40})\t(.*)$/.exec(line);
    if (m) out.push({ thumbprint: m[1].toUpperCase(), subject: clip(m[2], 160) });
    if (out.length >= MAX_CERTS) break;
  }
  return out.sort((a, b) => (a.thumbprint < b.thumbprint ? -1 : a.thumbprint > b.thumbprint ? 1 : 0));
}

function hostOf(url) { try { return new URL(String(url)).host || clip(url, 80); } catch { return clip(url, 80); } }

function createNetworkDrift({ file, fs = require('fs'), run, platform = process.platform, now = () => Date.now(), log = console }) {
  if (!file || typeof run !== 'function') throw new Error('createNetworkDrift needs a record file and a runner');
  let state = null;   // { v:1, enabled, proxy:{on,hash}|null, certs:[thumbprints]|null, at }
  const supported = platform === 'win32';

  function load() {
    if (state) return state;
    state = { v: 1, enabled: false, proxy: null, certs: null, at: 0 };
    const r = readJsonRecoverSync(file, { fsImpl: fs });
    if (r.source === 'lost') log.error('[NetworkDrift] the record could not be read and was kept aside (' + r.corruptCopy + '); the next look only records:', r.error && r.error.message);
    const d = r.data;
    if (d && d.v === 1) {
      state.enabled = d.enabled === true;
      if (d.proxy && typeof d.proxy.on === 'boolean' && typeof d.proxy.hash === 'string') state.proxy = { on: d.proxy.on, hash: d.proxy.hash };
      if (Array.isArray(d.certs) && d.certs.every(t => typeof t === 'string')) state.certs = d.certs.slice(0, MAX_CERTS);
      state.at = Number(d.at) || 0;
    }
    return state;
  }
  const save = () => atomicWriteSync(file, JSON.stringify(load()), { fsImpl: fs });

  function get() {
    const s = load();
    return { supported, enabled: supported && s.enabled, lastCheckedAt: s.at, knownCerts: s.certs ? s.certs.length : 0, hadBaseline: !!(s.certs && s.proxy) };
  }
  function setEnabled(on) {
    if (typeof on !== 'boolean') throw new Error('Switch it on or off with true or false');
    if (on && !supported) throw new Error('This check is for Windows only');
    const s = load();
    s.enabled = on;
    save();
    return get();
  }

  // Looks now, compares with the kept record, keeps the new record.
  //  -> { baseline, proxy:{ status:'same'|'appeared'|'changed'|'removed'|'first', server, pac }, certs:{ added:[{thumbprint,subject}], count } }
  // Throws (and keeps the old record) when a command fails, so a failed look can never look like "nothing changed".
  async function check() {
    if (!supported) throw new Error('This check is for Windows only');
    const s = load();
    const reg = await run('reg', ['query', REG_KEY], { timeoutMs: 10000 });
    const proxy = parseProxy(reg && reg.stdout);
    const ps = await run('powershell.exe', PS_ARGS, { timeoutMs: 20000 });
    const certs = parseCerts(ps && ps.stdout);
    if (!certs.length) throw new Error('The certificate list came back empty, so nothing was compared');
    const print = proxyPrint(proxy);
    const thumbs = certs.map(c => c.thumbprint);
    const result = { baseline: !(s.certs && s.proxy), proxy: { status: 'first', server: proxy.server, pac: proxy.pac }, certs: { added: [], count: certs.length } };
    if (!result.baseline) {
      const was = s.proxy;
      result.proxy.status = was.hash === print.hash ? 'same' : (!was.on && print.on ? 'appeared' : (was.on && !print.on ? 'removed' : 'changed'));
      const known = new Set(s.certs);
      result.certs.added = certs.filter(c => !known.has(c.thumbprint));
    }
    s.proxy = print;
    s.certs = thumbs;
    s.at = now();
    save();
    return result;
  }

  // The Attention Inbox rows for a result (the words; nothing here decides anything). Titles that carry a name use "{1}" templates.
  function notesFor(result) {
    const out = [];
    if (result.proxy.status === 'appeared' || result.proxy.status === 'changed') {
      const label = 'Network changes';
      if (result.proxy.server) {
        out.push({ feature: 'network-drift', id: 'proxy', label, title: (result.proxy.status === 'appeared' ? 'Windows now uses the proxy “{1}”' : 'The Windows proxy changed to “{1}”').replace('{1}', clip(result.proxy.server, 80)), body: BODY_PROXY });
      } else {
        out.push({ feature: 'network-drift', id: 'proxy', label, title: (result.proxy.status === 'appeared' ? 'Windows now uses a proxy setup script from “{1}”' : 'The Windows proxy setup script changed to one from “{1}”').replace('{1}', hostOf(result.proxy.pac)), body: BODY_PAC });
      }
    }
    const shown = result.certs.added.slice(0, MAX_SHOWN);
    for (const c of shown) {
      out.push({ feature: 'network-drift', id: 'cert:' + c.thumbprint.slice(0, 16), label: 'Network changes', title: 'A new root certificate was added: “{1}”'.replace('{1}', clip(c.subject || c.thumbprint, 100)), body: BODY_CERT });
    }
    if (result.certs.added.length > shown.length) {
      out.push({ feature: 'network-drift', id: 'cert:more', label: 'Network changes', title: 'More new root certificates were added', body: BODY_MORE });
    }
    return out;
  }

  return { get, setEnabled, check, notesFor, supported };
}

module.exports = { BODY_PROXY, BODY_PAC, BODY_CERT, BODY_MORE, createNetworkDrift, parseProxy, parseCerts, proxyPrint, REG_KEY, PS_SCRIPT, PS_ARGS, MAX_SHOWN };
