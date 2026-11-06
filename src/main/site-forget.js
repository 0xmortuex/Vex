// === Forget a site when I close it =============================================
//
// A per-site rule ('forget', src/main/site-rules.js). For a site that has it:
//
//   - when the LAST tab of the site is closed (the window says so: js/forget-site.js), its cookies and stored data are cleared
//     with the same code as "Clear this site's data" (src/main/site-data.js: the site's origin storage, then every cookie that
//     would be sent to it), in the session the tab was in;
//   - when Vex quits, the same for every site with the rule, in the ordinary sessions: every cookie of such a site (a subdomain
//     that set one included) and the storage of its origins.
//
// This signs you out of the site each time; that is the whole point and the label says so. It never touches:
//   - a site Vex needs signed in for video, music or chat (netflix.com, spotify.com, discord.com ... SiteRules.FORGET_PROTECTED): the
//     rule cannot even be saved for them;
//   - a session that belongs to a panel (persist:discord, persist:spotify, persist:netflix, persist:whatsapp, persist:claude,
//     persist:roblox) or to a private, burner or Tor tab: only persist:main and the containers are ever swept.
//
// A tab of the same site that is still open (in this window or any other window's built page) stops it: the tabs stay as they
// are until the last one is closed. A tab put to sleep in another window is not a page and is not counted.
const SiteRules = require('./site-rules');
const { clearSiteData } = require('./site-data');

// The sessions that are swept: the main one and the containers. Not a panel's, not a private or Tor tab's.
const partitionAllowed = (partition) => partition === 'persist:main' || /^persist:container-[A-Za-z0-9_-]+$/.test(String(partition || ''));

const bare = (h) => String(h || '').replace(/^www\./, '').toLowerCase();
const webUrl = (url) => { try { const u = new URL(String(url)); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; } };

// The addresses to clear for the sites with the rule, given the cookies the session holds: the site's own two forms, and the
// host of every cookie that belongs to it (a subdomain that set one). -> [href]
function quitTargets(rules, cookies) {
  const out = new Set();
  const keys = Object.entries(rules || {}).filter(([k, r]) => r && r.forget === true && !SiteRules.forgetProtected(k)).map(([k]) => bare(k));
  for (const key of keys) {
    out.add('https://' + key + '/');
    // A name has a www. form; an address (127.0.0.1) and a bare name (localhost) do not.
    if (key.includes('.') && !/^[\d.]+$/.test(key)) out.add('https://www.' + key + '/');
  }
  for (const c of cookies || []) {
    const dom = bare(String(c && c.domain || '').replace(/^\./, ''));
    if (!dom) continue;
    if (keys.some(k => dom === k || dom.endsWith('.' + k))) out.add('https://' + dom + '/');
  }
  return [...out];
}

// deps: getRules() -> the saved site rules; sessionFor(partition) -> an Electron session; openPages(partition) -> [{ id, url }] of
// the pages built in that session now; quitPartitions() -> the partitions to sweep at quit; log: console-like; clear: for tests.
function createSiteForget(deps) {
  const log = deps.log || console;
  const clear = deps.clear || clearSiteData;

  // The last tab of a site closed. -> { ok, skipped?, cleared? } or { ok: false, error }.
  async function afterTabClosed({ url, partition, exceptPageId }) {
    const u = webUrl(url);
    if (!u) return { ok: false, error: 'Only a website can be forgotten' };
    if (!partitionAllowed(partition)) return { ok: true, skipped: 'session' };
    const rules = deps.getRules();
    if (!SiteRules.forgets(rules, u.href)) return { ok: true, skipped: 'rule' };
    const key = SiteRules.ruleKeyFor(rules, u.href);
    const stillOpen = (deps.openPages(partition) || []).some((p) => {
      if (p.id === exceptPageId) return false;
      const other = webUrl(p.url);
      return !!other && SiteRules.ruleKeyFor(rules, other.href) === key;
    });
    if (stillOpen) return { ok: true, skipped: 'open' };
    const r = await clear(deps.sessionFor(partition), u.href);
    if (!r.ok) log.error('[SiteForget] could not forget ' + u.hostname + ':', r.error);
    return r.ok ? { ok: true, cleared: true, host: bare(u.hostname) } : { ok: false, error: r.error };
  }

  // Vex is quitting. -> { cleared: n, errors: [text] }; every error is reported, none stops the rest.
  async function onQuit() {
    const rules = deps.getRules();
    const result = { cleared: 0, errors: [] };
    if (!Object.values(rules || {}).some(r => r && r.forget === true)) return result;
    for (const partition of deps.quitPartitions()) {
      if (!partitionAllowed(partition)) continue;
      const ses = deps.sessionFor(partition);
      let cookies = [];
      try { cookies = await ses.cookies.get({}); }
      catch (err) { result.errors.push(partition + ': cookies could not be listed (' + err.message + ')'); }
      for (const href of quitTargets(rules, cookies)) {
        const r = await clear(ses, href);
        if (r.ok) result.cleared += 1; else result.errors.push(partition + ' ' + href + ': ' + r.error);
      }
      // What was removed has to reach the disk before the process ends.
      try { await ses.flushStorageData(); }
      catch (err) { result.errors.push(partition + ': could not save the change (' + err.message + ')'); }
    }
    for (const e of result.errors) log.error('[SiteForget] at quit:', e);
    return result;
  }

  return { afterTabClosed, onQuit };
}

module.exports = { createSiteForget, quitTargets, partitionAllowed };
