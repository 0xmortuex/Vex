// Install saved proxy boundaries before any restored page can issue a request.
// @ts-check

// The key under which "all of Vex through one route" is saved. It is not a
// partition name: it stands for every browsing session at once, so restoring
// it means applying that one route to all of them. Restored as though it were
// a partition, it would proxy a session nothing uses and quietly leave every
// real tab direct after a restart.
const ALL_ROUTE_KEY = '__all__';

// The proxy a session is given when it must load nothing: nothing listens on
// port 9, so every request fails rather than going direct.
const REFUSED_PROXY = { proxyRules: 'socks5://127.0.0.1:9', proxyBypassRules: '<-loopback>' };

/**
 * Whether a partition is a site route's session (js/site-routes.js,
 * partitionFor): persist:route-tor, or persist:route-proxy-<slug>.
 * @param {unknown} partition
 */
function isSiteRoutePartition(partition) {
  return typeof partition === 'string' && /^persist:route-(?:tor|proxy-[a-z0-9]+)$/.test(partition);
}

/**
 * The saved site routes no rule uses any more. A removed or replaced rule
 * left its route saved, so Tor never stopped and started again on every
 * launch (found 2026-09-30). The window says which partitions its rules use;
 * every other saved site route is stale. Other saved routes (a container, the
 * default session, all of Vex) are not the window's rules and are kept.
 * @param {Record<string, unknown>} routes
 * @param {string[]} used
 */
function staleSiteRoutes(routes, used) {
  const keep = new Set(used);
  return Object.keys(routes).filter(key => isSiteRoutePartition(key) && !keep.has(key));
}

const PROXY_HINT ='A proxy address looks like socks5://127.0.0.1:1080 or http://host:port';

/**
 * One proxy, as scheme://host:port, or an error that says what one looks
 * like. The old check was a loose pattern in the renderer only:
 * socks5://hello, http://; and socks5://127.0.0.1:99999 all reported "Now
 * using your proxy", and socks5://x:1080,direct:// quietly went direct when
 * the proxy failed — Chromium reads "," as a fallback list and ";" as
 * per-scheme rules (found 2026-09-29).
 * @param {unknown} text
 * @returns {string}
 */
function proxyAddress(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw || /[,;\s]/.test(raw)) throw new Error(PROXY_HINT);
  let url;
  try { url = new URL(raw); } catch { throw new Error(PROXY_HINT); }
  const scheme = url.protocol.replace(/:$/, '').toLowerCase();
  if (!['http', 'https', 'socks4', 'socks5'].includes(scheme)) throw new Error(PROXY_HINT);
  if (!url.hostname || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) throw new Error(PROXY_HINT);
  // The port has to be written out: URL drops a scheme's default one
  // (http://h:80 has port ''), so it is read from the text itself.
  const m = /:(\d{1,5})\/?$/.exec(raw);
  const port = m ? Number(m[1]) : 0;
  if (!(port >= 1 && port <= 65535)) throw new Error(PROXY_HINT);
  return `${scheme}://${url.hostname}:${port}`;
}

/**
 * @param {{routes: Record<string, unknown>,
 * getSession: (partition: string) => {setProxy: (rules: {proxyRules: string, proxyBypassRules: string}) => Promise<void>},
 * applyRouting: (partition: string, mode: string, custom?: string) => Promise<unknown>,
 * report: (error: Error) => void,
 * allPartitions?: string[]}} options
 */
async function restoreRoutes({ routes, getSession, applyRouting, report, allPartitions = [] }) {
  // One session's saved route, put back. A Tor route installs a refused
  // loopback proxy first: failure to launch Tor must leave that boundary in
  // place rather than fall back to a direct connection.
  /** @param {string} partition @param {any} config */
  async function restoreOne(partition, config) {
    if (config.mode === 'tor') {
      await getSession(partition).setProxy({ proxyRules: 'socks5://127.0.0.1:9', proxyBypassRules: '<-loopback>' });
      // A site route's Tor is started by the window, and only for a rule it
      // still has (SiteRoutes.armAll). Started here, a route whose rule was
      // removed started Tor on every launch (found 2026-09-30).
      if (isSiteRoutePartition(partition)) return;
      void applyRouting(partition, 'tor').catch(report);
    } else if (config.mode === 'proxy') {
      if (!('custom' in config) || typeof config.custom !== 'string' || !config.custom.trim()) throw new Error('Invalid saved proxy configuration');
      // A proxy saved before the address was checked properly may no longer
      // pass. Throwing here would stop Vex opening at all, and going direct
      // would expose what the person meant to hide — so, like Tor above, the
      // session gets a proxy that refuses everything, and it is said.
      let address;
      try { address = proxyAddress(config.custom); }
      catch (err) {
        await getSession(partition).setProxy({ proxyRules: 'socks5://127.0.0.1:9', proxyBypassRules: '<-loopback>' });
        report(new Error(`The saved proxy "${config.custom}" is not a proxy address, so ${partition || 'the default session'} loads nothing until it is changed — ${err instanceof Error ? err.message : String(err)}`));
        return;
      }
      await applyRouting(partition, 'proxy', address);
    }
  }

  for (const [key, config] of Object.entries(routes)) {
    if (!config || typeof config !== 'object' || !('mode' in config)) continue;
    if (key === ALL_ROUTE_KEY) {
      for (const partition of ['', ...allPartitions]) await restoreOne(partition, config);
      continue;
    }
    if (key.startsWith('__')) continue;   // reserved; never a partition
    // A temporary session (a burner identity, an off-the-record tab) is gone
    // once Vex closes. Restoring its Tor route started Tor on every launch
    // for a session nothing can use again (found 2026-09-29).
    if (key !== 'default' && !key.startsWith('persist:')) continue;
    await restoreOne(key === 'default' ? '' : key, config);
  }
}
/**
 * Whether a tab opened from a page in this session has to stay in it: Tor,
 * off-the-record (burner), a private window, a container, a routed site. A
 * link opened in a new tab from a Tor tab used to land in persist:main and
 * show the real address (found 2026-09-29). The app sessions (Discord,
 * Spotify…) and persist:main open links in the ordinary session, as before.
 * @param {unknown} partition
 */
function keepsOpenerSession(partition) {
  return typeof partition === 'string' && /^(tor-|otr-|private:|persist:container-|persist:route-)/.test(partition);
}

/**
 * Mark a session as going through Tor, through a proxy, or direct, and set
 * WebRTC to match on every page already open in it; web-contents-created
 * reads the marks for the pages opened later. A burner or container routed
 * through Tor had the proxy but not the mark, so WebRTC handed sites the real
 * address (found 2026-09-29); a session routed through an ordinary proxy (a
 * site route, a container, a burner) did the same (found 2026-09-30).
 * @param {any} ses
 * @param {'tor'|'proxy'|'direct'} route
 * @param {any[]} allContents
 */
function markRoutedSession(ses, route, allContents) {
  if (!['tor', 'proxy', 'direct'].includes(route)) throw new Error(`Unknown route "${route}"`);
  ses.__vexTor = route === 'tor';
  ses.__vexRouted = route !== 'direct';
  const policy = ses.__vexRouted ? 'disable_non_proxied_udp' : 'default';
  for (const contents of allContents) {
    if (contents.isDestroyed() || contents.session !== ses) continue;
    contents.setWebRTCIPHandlingPolicy(policy);
  }
}

/**
 * Whether anything still needs the Tor Vex started: a page (tab, popup,
 * burner, container or site-route tab) in a session going through Tor, or a
 * saved Tor route, which Vex puts back on the next start anyway. Tor used to
 * keep running after the last Tor tab closed, with nothing to say so
 * (found 2026-09-30).
 * @param {any[]} allContents
 * @param {Record<string, unknown>} routes
 */
function torInUse(allContents, routes) {
  if (allContents.some(contents => !contents.isDestroyed() && contents.session && contents.session.__vexTor)) return true;
  return Object.values(routes).some(config => !!config && typeof config === 'object' && /** @type {any} */ (config).mode === 'tor');
}

module.exports = { restoreRoutes, proxyAddress, ALL_ROUTE_KEY, REFUSED_PROXY, isSiteRoutePartition, staleSiteRoutes, keepsOpenerSession, markRoutedSession, torInUse };
