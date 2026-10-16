// === Credential-entry interlock: is this the site your login belongs to? (T2-089) ===========
//
// When a password field takes focus on a page, js/credential-interlock.js asks here
// whether the page's address is somewhere that password should be typed:
//
//   ok     a login is saved for this site, or the site is one the person uses a lot,
//          or it is a well-known brand's own address: nothing is said;
//   warn   the address is made to read like a saved login's site or a brand
//          (paypa1.com, roblox.com.login-check.xyz, a name with letters from two
//          alphabets) - and says which one it is pretending to be.
//
// It never blocks: it answers, and the window shows a warning the person can step
// past with an explicit Continue. The check is the lookalike detector of Web safety
// (src/main/web-safety.js) with the saved logins' sites added as the names to guard,
// plus one rule of its own: an address that contains a saved site's whole name in front of
// another suffix ("roblox.com.verify-account.xyz"). A password-free list of hosts goes
// in; nothing is looked up on the internet.
'use strict';

const ws = require('./web-safety');

function hostOf(value) {
  const s = String(value || '').trim();
  if (!s) throw new Error('There is no address to check');
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s).hostname; }
  catch { throw new Error('That is not an address: ' + s.slice(0, 80)); }
}

// ctx: { savedHosts: [host...], topHosts: [...], allow: [...] }
function check(address, ctx = {}) {
  const host = hostOf(address);
  const bare = ws.bareHost(host);
  const reg = ws.registrable(bare);
  const saved = [...new Set((ctx.savedHosts || []).map(h => ws.registrable(ws.bareHost(h))).filter(Boolean))];
  const none = { verdict: 'ok', host: bare, reason: '', resembles: null, kind: null, line: '' };
  if (!reg || ws.isIpLiteral(bare)) {
    // A bare number address asking for a password is the clearest case there is, unless it is this computer.
    if (ws.isIpLiteral(bare) && !/^(127\.|10\.|192\.168\.|169\.254\.)/.test(bare)) {
      return { verdict: 'warn', host: bare, reason: 'ip-host', resembles: null, kind: 'ip-host', line: 'This page is a bare number address (' + bare + '), not a named site. Real sites that ask for a password have a name.' };
    }
    return none;
  }
  if (saved.includes(reg)) return { ...none, reason: 'saved' };
  const embeds = saved.find(s => bare.length > s.length && bare.includes(s + '.') && !bare.endsWith('.' + s) && bare !== s);
  if (embeds) {
    return { verdict: 'warn', host: bare, reason: 'embeds-saved', resembles: embeds, kind: 'embeds-saved', line: 'The address starts with "' + embeds + '" but belongs to ' + reg + '. Your saved login for ' + embeds + ' would not be offered here.' };
  }
  const r = ws.analyzeHost(bare, { sensitivity: 'strict', topHosts: [...(ctx.topHosts || []), ...saved], allow: ctx.allow || [] });
  if (r.flagged) return { verdict: 'warn', host: bare, reason: r.kind, resembles: r.resembles || null, kind: r.kind, line: r.line };
  return none;
}

function registerCredentialGuard({ ipcMain, savedHosts, topHosts, allow, isLocked = () => false }) {
  ipcMain.handle('credguard:check', (_e, address) => {
    if (isLocked()) throw new Error('Vex is locked');
    let hosts = [];
    // A locked or unreadable vault is said, not hidden: the check still runs against brands and history.
    let vault = { ok: true, error: '' };
    try { hosts = savedHosts(); } catch (err) { vault = { ok: false, error: err.message }; }
    return { ...check(address, { savedHosts: hosts, topHosts: topHosts(), allow: allow() }), vault };
  });
}

module.exports = { check, hostOf, registerCredentialGuard };
