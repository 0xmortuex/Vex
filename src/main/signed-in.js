// === What am I signed in to, and the "my session leaked" kill switch (T2-087, T2-088) ===
//
// T2-087  A read-only list of the sites that look signed in: for each site, which
//         container holds a sign-in cookie, whether it ends when Vex closes or on a
//         date, and whether a login is saved in the vault. Only metadata is read:
//         cookie NAMES, the session flag and the expiry date; never a cookie value
//         and never a saved password. Chromium keeps no "last used" time for a
//         cookie, so there is none here; the expiry is shown instead.
// T2-088  One action per site: remove its cookies and stored data in every container,
//         then open that site's own page for "sign out of all devices" and "change
//         password". It cannot sign you out of the other devices itself: only the
//         site can end a session on its server, which is why the next step is a guided
//         visit to the site. Because it removes cookies, "Why was I signed out?"
//         (src/main/signout-why.js) is told, so a later sign-in loss is explained as
//         "you used the kill switch" and not as a mystery.
//
// The cookie rules (what counts as a sign-in cookie) are the ones "Why was I signed
// out?" already uses, so the two features agree.
'use strict';

const { looksLikeSignIn, baseDomain } = require('./signout-why');
const { STORAGES } = require('./site-data');

const MAX_SITES = 150;
const MAX_NAMES = 8;

// Where a site keeps its own "sign out everywhere" and password pages. Every link is the
// site's own https page, written from what those sites documented and NOT checked live:
// a page a site has moved shows the site's own login or 404, and the steps text still
// applies. Vex guesses no address for a site that is not listed: it gets its home page
// and the general steps. `hosts`: the other registrable domains the same account uses.
const SITE_LINKS = {
  'google.com': { name: 'Google', hosts: ['youtube.com', 'gmail.com'], where: 'https://myaccount.google.com/device-activity', password: 'https://myaccount.google.com/signinoptions/password', steps: 'Under "Your devices" pick each device you do not recognise and choose Sign out.' },
  'microsoft.com': { name: 'Microsoft', hosts: ['live.com', 'outlook.com', 'office.com', 'microsoftonline.com'], where: 'https://account.microsoft.com/devices', password: 'https://account.microsoft.com/security', steps: 'Open Security, then "Sign in activity", and use "Sign out everywhere" if it is offered.' },
  'github.com': { name: 'GitHub', hosts: [], where: 'https://github.com/settings/sessions', password: 'https://github.com/settings/security', steps: 'Revoke every session you do not recognise. Then open Applications and revoke tokens you did not make.' },
  'discord.com': { name: 'Discord', hosts: ['discordapp.com'], where: 'https://discord.com/channels/@me', password: 'https://discord.com/channels/@me', steps: 'Open User Settings, then Devices, and choose "Log out all known devices". Changing the password also ends every session.' },
  'roblox.com': { name: 'Roblox', hosts: [], where: 'https://www.roblox.com/my/account#!/security', password: 'https://www.roblox.com/my/account#!/security', steps: 'On the Security tab use "Log out of all other sessions", then change the password and check 2-step verification.' },
  'amazon.com': { name: 'Amazon', hosts: [], where: 'https://www.amazon.com/gp/css/homepage.html', password: 'https://www.amazon.com/gp/css/homepage.html', steps: 'Open "Login & security", then "Sign out of all devices" or change the password.' },
  'amazon.com.tr': { name: 'Amazon Turkey', hosts: [], where: 'https://www.amazon.com.tr/gp/css/homepage.html', password: 'https://www.amazon.com.tr/gp/css/homepage.html', steps: 'Open "Giris ve guvenlik" (Login & security) and change the password; that ends other sessions.' },
  'facebook.com': { name: 'Facebook', hosts: ['instagram.com'], where: 'https://www.facebook.com/settings?tab=security', password: 'https://www.facebook.com/settings?tab=security', steps: 'Open "Where you\'re logged in" and log out of every session you do not recognise.' },
  'instagram.com': { name: 'Instagram', hosts: [], where: 'https://accountscenter.instagram.com/password_and_security/', password: 'https://accountscenter.instagram.com/password_and_security/', steps: 'Open "Where you\'re logged in" and log out of the sessions you do not recognise.' },
  'x.com': { name: 'X', hosts: ['twitter.com'], where: 'https://x.com/settings/sessions', password: 'https://x.com/settings/password', steps: 'Use "Log out of all other sessions", then review connected apps.' },
  'apple.com': { name: 'Apple', hosts: ['icloud.com'], where: 'https://appleid.apple.com/', password: 'https://appleid.apple.com/', steps: 'Sign in, open Devices, and remove any device you do not recognise.' },
  'paypal.com': { name: 'PayPal', hosts: [], where: 'https://www.paypal.com/myaccount/settings/', password: 'https://www.paypal.com/myaccount/settings/', steps: 'Open Security and check recent activity and connected apps. Change the password.' },
  'spotify.com': { name: 'Spotify', hosts: [], where: 'https://www.spotify.com/account/overview/', password: 'https://www.spotify.com/account/change-password/', steps: 'At the bottom of Account overview choose "Sign out everywhere".' },
  'netflix.com': { name: 'Netflix', hosts: [], where: 'https://www.netflix.com/account', password: 'https://www.netflix.com/password', steps: 'Under Security choose "Sign out of all devices".' },
  'reddit.com': { name: 'Reddit', hosts: [], where: 'https://www.reddit.com/settings/account', password: 'https://www.reddit.com/settings/account', steps: 'Change the password; Reddit then asks to log out of all sessions.' },
  'steampowered.com': { name: 'Steam', hosts: ['steamcommunity.com'], where: 'https://store.steampowered.com/account/', password: 'https://store.steampowered.com/account/', steps: 'Open Steam Guard and choose "Deauthorize all other devices", then change the password.' },
  'epicgames.com': { name: 'Epic Games', hosts: [], where: 'https://www.epicgames.com/account/password', password: 'https://www.epicgames.com/account/password', steps: 'Change the password and tick "Sign out of all devices".' },
  'linkedin.com': { name: 'LinkedIn', hosts: [], where: 'https://www.linkedin.com/mypreferences/d/where-you-re-signed-in', password: 'https://www.linkedin.com/psettings/change-password', steps: 'Use "Sign out of all sessions".' },
  'dropbox.com': { name: 'Dropbox', hosts: [], where: 'https://www.dropbox.com/account/security', password: 'https://www.dropbox.com/account/security', steps: 'Under Web browsers and Devices, unlink what you do not recognise.' },
  'twitch.tv': { name: 'Twitch', hosts: [], where: 'https://www.twitch.tv/settings/security', password: 'https://www.twitch.tv/settings/security', steps: 'Use "Sign out everywhere" in Security and privacy, then change the password.' },
  'cloudflare.com': { name: 'Cloudflare', hosts: [], where: 'https://dash.cloudflare.com/profile/authentication', password: 'https://dash.cloudflare.com/profile/authentication', steps: 'Review active sessions and API tokens, and revoke what you do not recognise.' },
};

const BY_DOMAIN = new Map();
for (const [domain, info] of Object.entries(SITE_LINKS)) {
  BY_DOMAIN.set(domain, domain);
  for (const h of info.hosts) BY_DOMAIN.set(h, domain);
}

const GENERAL_STEPS = 'Open the site, find Account or Security settings, and look for "sign out of all devices" or "active sessions". Then change the password.';

// -> { known, name, where, password, steps }. Every address is the site's own https page.
function linksFor(domain) {
  const d = baseDomain(domain);
  if (!d) throw new Error('That is not a site');
  const key = BY_DOMAIN.get(d);
  if (key) {
    const s = SITE_LINKS[key];
    return { known: true, name: s.name, where: s.where, password: s.password, steps: s.steps };
  }
  return { known: false, name: d, where: 'https://' + d + '/', password: 'https://' + d + '/', steps: GENERAL_STEPS };
}

function containerLabel(partition) {
  if (partition === 'persist:main') return 'Main';
  const m = /^persist:container-(.+)$/.exec(partition);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' container' : partition;
}

// cookiesByPartition: { 'persist:main': [cookie, ...], ... } (Electron cookie objects);
// vaultHosts: the hosts that have a saved login (no passwords). -> sites, newest expiry first.
function collect(cookiesByPartition, vaultHosts, now = Date.now()) {
  const sites = new Map();
  const site = (domain) => {
    if (!sites.has(domain)) sites.set(domain, { domain, containers: [], saved: 0, links: null });
    return sites.get(domain);
  };
  for (const [partition, cookies] of Object.entries(cookiesByPartition || {})) {
    for (const c of Array.isArray(cookies) ? cookies : []) {
      if (!looksLikeSignIn(c) || typeof c.domain !== 'string') continue;
      const domain = baseDomain(c.domain);
      if (!domain) continue;
      const s = site(domain);
      let box = s.containers.find(x => x.partition === partition);
      if (!box) { box = { partition, label: containerLabel(partition), names: [], sessionOnly: true, expires: 0 }; s.containers.push(box); }
      const ends = Number.isFinite(c.expirationDate) && !c.session ? Math.round(c.expirationDate * 1000) : 0;
      if (ends && ends < now) continue;          // already over: it is not a sign-in any more
      if (box.names.length < MAX_NAMES && !box.names.includes(c.name)) box.names.push(c.name);
      if (ends) { box.sessionOnly = false; box.expires = Math.max(box.expires, ends); }
    }
  }
  const saved = new Map();
  for (const h of Array.isArray(vaultHosts) ? vaultHosts : []) {
    const d = baseDomain(h);
    if (d) saved.set(d, (saved.get(d) || 0) + 1);
  }
  for (const [d, n] of saved) if (sites.has(d)) sites.get(d).saved = n;
  const out = [];
  for (const s of sites.values()) {
    s.containers = s.containers.filter(b => b.names.length);
    if (!s.containers.length) continue;
    s.links = linksFor(s.domain);
    s.sessionOnly = s.containers.every(b => b.sessionOnly);
    s.expires = s.containers.reduce((m, b) => Math.max(m, b.expires), 0);
    out.push(s);
  }
  out.sort((a, b) => (b.containers.length - a.containers.length) || (a.domain < b.domain ? -1 : 1));
  return { sites: out.slice(0, MAX_SITES), more: Math.max(0, out.length - MAX_SITES), savedWithoutSession: [...saved.keys()].filter(d => !sites.has(d)).length };
}

function cookieUrl(c) {
  const dom = String(c.domain || '').replace(/^\./, '');
  if (!dom) throw new Error('a cookie has no domain');
  return `http${c.secure ? 's' : ''}://${dom}${c.path || '/'}`;
}

// Removes every cookie of the site (its host and subdomains) and its stored data from each
// session. Nothing is swallowed: a part that fails is named in the answer.
async function clearEverywhere(sessionsByPartition, domain) {
  const d = baseDomain(domain);
  if (!d || !d.includes('.')) throw new Error('That is not a site: ' + String(domain));
  const per = [];
  for (const [partition, ses] of Object.entries(sessionsByPartition || {})) {
    const row = { partition, label: containerLabel(partition), cookies: 0, errors: [] };
    let all;
    try { all = await ses.cookies.get({}); }
    catch (err) { row.errors.push('cookies could not be read (' + err.message + ')'); per.push(row); continue; }
    const mine = all.filter(c => baseDomain(c.domain) === d);
    const origins = new Set(['https://' + d, 'https://www.' + d]);
    for (const c of mine) origins.add('https://' + String(c.domain).replace(/^\./, ''));
    for (const c of mine) {
      try { await ses.cookies.remove(cookieUrl(c), c.name); row.cookies += 1; }
      catch (err) { row.errors.push('cookie ' + c.name + ' (' + err.message + ')'); }
    }
    for (const origin of origins) {
      try { await ses.clearStorageData({ origin, storages: STORAGES }); }
      catch (err) { row.errors.push('stored data of ' + origin + ' (' + err.message + ')'); }
    }
    per.push(row);
  }
  const errors = per.flatMap(r => r.errors.map(e => r.label + ': ' + e));
  return { ok: errors.length === 0, domain: d, total: per.reduce((n, r) => n + r.cookies, 0), containers: per, errors };
}

function registerSignedIn({ ipcMain, sessions, vaultHosts, noteAction, isLocked = () => false, now = () => Date.now() }) {
  const guard = () => { if (isLocked()) throw new Error('Vex is locked'); };
  ipcMain.handle('hygiene:signed-in', async () => {
    guard();
    const by = {};
    for (const [partition, ses] of Object.entries(sessions())) by[partition] = await ses.cookies.get({});
    let vault = { ok: true, error: '' }, hosts = [];
    try { hosts = vaultHosts(); } catch (err) { vault = { ok: false, error: err.message }; }
    return { ...collect(by, hosts, now()), vault, at: now() };
  });
  ipcMain.handle('hygiene:kill-site', async (_e, domain) => {
    guard();
    const d = baseDomain(domain);
    noteAction('kill-switch', [d]);
    const result = await clearEverywhere(sessions(), d);
    return { ...result, links: linksFor(d) };
  });
  ipcMain.handle('hygiene:site-links', (_e, domain) => { guard(); return linksFor(domain); });
}

module.exports = { collect, clearEverywhere, linksFor, registerSignedIn, SITE_LINKS, GENERAL_STEPS, containerLabel };
