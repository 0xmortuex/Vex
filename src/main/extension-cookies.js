// === chrome.cookies for extensions, through the session's own cookies ===
// Electron has no chrome.cookies. The stand-in answered every get with null
// and every getAll with [] while the cookies were there (found 2026-10-10,
// EX6): a cookie editor showed nothing, a "stay signed in" helper thought it
// was signed out. Main answers now from the extension's session, the way
// Chrome does: only with the "cookies" permission, and only cookies of sites
// the extension has host permission for (a path in a host pattern does not
// narrow it, as in Chrome). One cookie store, "0"; changes are not announced
// (cookies.onChanged never fires here).

const STORE = '0';

function hostPatterns(manifest) {
  const m = manifest || {};
  return [].concat(m.host_permissions || [], m.permissions || [])
    .filter(p => typeof p === 'string' && /[:/*<]/.test(p))
    .map(p => (p === '<all_urls>' ? p : p.replace(/^([^:]+:\/\/[^/]*)\/.*$/, '$1/*')));
}

// Whether the extension may see the cookies of `host`.
function allowsHost(manifest, host, matchPattern) {
  host = String(host || '').replace(/^\./, '');
  if (!host) return false;
  return hostPatterns(manifest).some(p => matchPattern(p, `https://${host}/`) || matchPattern(p, `http://${host}/`));
}

function allowsUrl(manifest, url, matchPattern) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`Invalid url: "${url}".`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Invalid url: "${url}".`);
  return allowsHost(manifest, u.hostname, matchPattern);
}

function toChrome(c) {
  const out = { name: c.name, value: c.value, domain: c.domain, hostOnly: !!c.hostOnly, path: c.path || '/',
    secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: c.sameSite || 'unspecified', session: !!c.session, storeId: STORE };
  if (!c.session && typeof c.expirationDate === 'number') out.expirationDate = c.expirationDate;
  return out;
}

function needStore(details) {
  if (details && details.storeId != null && String(details.storeId) !== STORE) throw new Error(`No cookie store with ID: ${details.storeId}.`);
}

// The four calls, against Electron's session.cookies.
async function cookiesApi(op, args, { manifest, cookies, matchPattern }) {
  const perms = Array.isArray((manifest || {}).permissions) ? manifest.permissions : [];
  if (!perms.includes('cookies')) throw new Error('The "cookies" permission is required');
  const d = (args && args.details) || {};
  switch (op) {
    case 'cookies.getAllCookieStores': return [{ id: STORE, tabIds: [] }];
    case 'cookies.get': {
      needStore(d);
      if (!d.url || typeof d.name !== 'string') throw new Error('cookies.get needs a url and a name');
      if (!allowsUrl(manifest, d.url, matchPattern)) return null;
      const found = await cookies.get({ url: d.url, name: d.name });
      // Of several, the one with the longest path, as Chrome answers.
      found.sort((a, b) => String(b.path || '').length - String(a.path || '').length);
      return found[0] ? toChrome(found[0]) : null;
    }
    case 'cookies.getAll': {
      needStore(d);
      const filter = {};
      for (const k of ['url', 'name', 'domain', 'path', 'secure', 'session']) if (d[k] !== undefined) filter[k] = d[k];
      if (filter.url && !allowsUrl(manifest, filter.url, matchPattern)) return [];
      const found = await cookies.get(filter);
      return found.filter(c => allowsHost(manifest, c.domain, matchPattern)).map(toChrome);
    }
    case 'cookies.set': {
      needStore(d);
      if (!d.url) throw new Error('cookies.set needs a url');
      if (!allowsUrl(manifest, d.url, matchPattern)) throw new Error(`No host permissions for cookies at url: "${d.url}".`);
      const set = { url: d.url };
      for (const k of ['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'expirationDate', 'sameSite']) if (d[k] !== undefined) set[k] = d[k];
      await cookies.set(set);
      const back = await cookies.get({ url: d.url, name: d.name || '' });
      return back[0] ? toChrome(back[0]) : null;
    }
    case 'cookies.remove': {
      needStore(d);
      if (!d.url || typeof d.name !== 'string') throw new Error('cookies.remove needs a url and a name');
      if (!allowsUrl(manifest, d.url, matchPattern)) throw new Error(`No host permissions for cookies at url: "${d.url}".`);
      await cookies.remove(d.url, d.name);
      return { url: d.url, name: d.name, storeId: STORE };
    }
    default: throw new Error('Vex does not know ' + op);
  }
}

module.exports = { cookiesApi, allowsHost, hostPatterns, toChrome, STORE };
