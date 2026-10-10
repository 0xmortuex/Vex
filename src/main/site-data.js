// === Clear one site's data, and say whether it worked ======================
//
// "Clear this site's data" removes the site's stored data (local storage,
// IndexedDB, service workers, caches) and every cookie that would be sent to
// its address. It used to swallow every failure and answer ok, and answered ok
// as well when the address could not be read and nothing was cleared at all
// (audit B21, 2026-10-10). Now any part that fails is named in the answer.
const STORAGES = ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql', 'shadercache'];

// -> { ok: true, cookies } or { ok: false, error }
async function clearSiteData(ses, url) {
  let u;
  try { u = new URL(String(url || '')); }
  catch { return { ok: false, error: 'The page\'s address could not be read, so nothing was cleared' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'Only a website\'s data can be cleared, not a ' + u.protocol.replace(/:$/, '') + ' page\'s' };
  }
  const failed = [];
  try { await ses.clearStorageData({ origin: u.origin, storages: STORAGES }); }
  catch (err) { failed.push('its stored data (' + err.message + ')'); }
  // Every cookie that would be sent to this address (host and parent domains).
  let cookies = [];
  try { cookies = await ses.cookies.get({ url: u.href }); }
  catch (err) { failed.push('its cookies (' + err.message + ')'); }
  let kept = 0, why = '';
  for (const c of cookies) {
    const dom = String(c.domain || '').replace(/^\./, '');
    try {
      if (!dom) throw new Error('a cookie has no domain');
      await ses.cookies.remove(`http${c.secure ? 's' : ''}://${dom}${c.path || '/'}`, c.name);
    } catch (err) { kept += 1; why = err.message; }
  }
  if (kept) failed.push(kept + ' of ' + cookies.length + ' cookies (' + why + ')');
  if (failed.length) return { ok: false, error: 'Not everything was cleared: ' + failed.join('; ') };
  return { ok: true, cookies: cookies.length };
}

module.exports = { clearSiteData, STORAGES };
