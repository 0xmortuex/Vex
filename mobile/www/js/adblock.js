// === Vex Mobile — blocking ===
//
// The desktop app runs @ghostery/adblocker-electron in the main process. That
// package needs Electron's webRequest API, which Android has no equivalent of,
// so the blocker moved into the native layer: VexBlock matches every request
// inside WebViewClient.shouldInterceptRequest (see BlockEngine.java) and this
// module owns the list — where the rules come from, when they refresh, and
// which sites you have switched it off for.
//
// Rule format handed to native is a parsed subset of EasyList:
//   { block: [...], allow: [...], hide: { "host": ["selector", ...] } }
// Network rules are matched as substrings with optional ||domain anchors and
// $third-party / $domain= options; cosmetic rules are injected as CSS by the
// native layer once the document starts.

const VexBlock = (() => {
  const DEFAULT_LISTS = [
    { id: 'easylist', name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt', on: true },
    { id: 'easyprivacy', name: 'EasyPrivacy', url: 'https://easylist.to/easylist/easyprivacy.txt', on: true },
    { id: 'annoyances', name: 'Cookie notices', url: 'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt', on: false }
  ];
  const REFRESH_MS = 1000 * 60 * 60 * 24 * 3;   // three days, like the desktop lists

  // A small built-in list so a fresh install blocks the loudest trackers even
  // before the first refresh finishes (or on a device that is offline).
  const SEED = [
    '||doubleclick.net^', '||googlesyndication.com^', '||googletagmanager.com^',
    '||google-analytics.com^', '||googleadservices.com^', '||adservice.google.com^',
    '||scorecardresearch.com^', '||adnxs.com^', '||criteo.com^', '||taboola.com^',
    '||outbrain.com^', '||amazon-adsystem.com^', '||facebook.net/en_US/fbevents.js',
    '||connect.facebook.net^', '||hotjar.com^', '||mixpanel.com^', '||segment.io^',
    '||branch.io^', '||appsflyer.com^', '||adjust.com^', '||moatads.com^',
    '||quantserve.com^', '||sentry-cdn.com^', '||bugsnag.com^', '||fullstory.com^'
  ];

  /**
   * A list's text. The chrome asks first; a list server that sends no CORS
   * header refuses the chrome's own origin, so native fetches it instead —
   * otherwise that list silently never arrived and only the seed blocked.
   */
  async function download(url) {
    try {
      const response = await fetch(url, { cache: 'no-cache' });
      if (response.ok) return await response.text();
    } catch { /* refused cross-origin, most likely: native next */ }
    const answer = await VexBridge.fetchText(url, { purpose: 'list' });
    if (!answer || !answer.ok || !answer.body) throw new Error('could not fetch ' + url);
    return answer.body;
  }

  function parse(text) {
    const block = [], allow = [], hide = {};
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;
      // Cosmetic: example.com##.ad-slot  /  ##.ad-slot (generic)
      const cosmetic = line.match(/^([^#]*)##([^#].*)$/);
      if (cosmetic) {
        const hosts = cosmetic[1] ? cosmetic[1].split(',') : ['*'];
        for (const host of hosts) {
          const key = host.trim() || '*';
          if (key.startsWith('~')) continue;            // exception hosts: not supported yet
          (hide[key] = hide[key] || []).push(cosmetic[2].trim());
        }
        continue;
      }
      if (line.includes('#@#') || line.includes('#?#') || line.includes('#$#')) continue;  // unsupported cosmetic forms
      if (line.startsWith('@@')) allow.push(line.slice(2));
      else block.push(line);
    }
    return { block, allow, hide };
  }

  return {
    DEFAULT_LISTS,

    enabled() { return VexStore.get('vex.blockEnabled', true) !== false; },

    async setEnabled(on) {
      await VexStore.set('vex.blockEnabled', !!on);
      await VexBridge.setBlocking(!!on);
    },

    allowedSites() { return VexStore.get('vex.blockAllowed', []); },

    siteAllowed(host) { return this.allowedSites().includes(host); },

    async setSiteAllowed(host, allowed) {
      if (!host) return;
      const list = new Set(this.allowedSites());
      if (allowed) list.add(host); else list.delete(host);
      await VexStore.set('vex.blockAllowed', [...list]);
      await VexBridge.setSiteAllowed(host, allowed);
    },

    // Hand native whatever rules we have right now (cached or seed), then
    // refresh from the network in the background if the cache is stale.
    //
    // The cache is in IndexedDB, not in a preference. EasyList and EasyPrivacy
    // parsed come to several megabytes, and a preference is a settings file that
    // is read and parsed in full at every launch — which is what this used to do
    // before the first page could be drawn.
    async apply() {
      const row = await VexDB.get('blobs', 'blockRules').catch(() => null);
      const cached = row && row.rules;
      const rules = cached && cached.block && cached.block.length ? cached : parse(SEED.join('\n'));
      await VexBridge.loadRules(rules);
      await VexBridge.setBlocking(this.enabled());
      for (const host of this.allowedSites()) await VexBridge.setSiteAllowed(host, true);
      const fetchedAt = VexStore.get('vex.blockRulesAt', 0);
      if (Date.now() - fetchedAt > REFRESH_MS) this.refresh().catch(() => {});
      return rules;
    },

    // Download every enabled list and re-hand the merged result to native.
    async refresh() {
      const lists = VexStore.get('vex.blockLists', DEFAULT_LISTS);
      const merged = { block: [], allow: [], hide: {} };
      let got = 0;
      for (const list of lists) {
        if (!list.on) continue;
        try {
          const parsed = parse(await download(list.url));
          merged.block.push(...parsed.block);
          merged.allow.push(...parsed.allow);
          for (const [host, selectors] of Object.entries(parsed.hide)) {
            (merged.hide[host] = merged.hide[host] || []).push(...selectors);
          }
          got++;
        } catch (err) { console.warn('[block] list failed', list.id, err); }
      }
      if (!got) return null;
      merged.block.push(...SEED);
      await VexDB.put('blobs', { name: 'blockRules', at: Date.now(), rules: merged });
      // Small enough to stay a preference, and the privacy panel draws it
      // without waiting for a database read.
      await VexStore.set('vex.blockRulesAt', Date.now());
      await VexBridge.loadRules(merged);
      return merged;
    },

    parse,

    // Which sites cost you the most requests. Kept small and local: a count
    // per host, the top of which the privacy screen shows back to you.
    async count(host, amount) {
      if (!host || !amount) return;
      const counts = VexStore.get('vex.blockedByHost', {});
      counts[host] = (counts[host] || 0) + amount;
      // Keep the map from growing without end — the tail is noise anyway.
      const entries = Object.entries(counts);
      if (entries.length > 400) {
        const trimmed = entries.sort((a, b) => b[1] - a[1]).slice(0, 200);
        await VexStore.set('vex.blockedByHost', Object.fromEntries(trimmed));
        return;
      }
      await VexStore.set('vex.blockedByHost', counts);
    },

    worstSites(limit = 10) {
      return Object.entries(VexStore.get('vex.blockedByHost', {}))
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([host, count]) => ({ host, count }));
    }
  };
})();

if (typeof window !== 'undefined') window.VexBlock = VexBlock;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBlock };
