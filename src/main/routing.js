// Install saved proxy boundaries before any restored page can issue a request.
// @ts-check

// The key under which "all of Vex through one route" is saved. It is not a
// partition name: it stands for every browsing session at once, so restoring
// it means applying that one route to all of them. Restored as though it were
// a partition, it would proxy a session nothing uses and quietly leave every
// real tab direct after a restart.
const ALL_ROUTE_KEY = '__all__';

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
      void applyRouting(partition, 'tor').catch(report);
    } else if (config.mode === 'proxy') {
      if (!('custom' in config) || typeof config.custom !== 'string' || !config.custom.trim()) throw new Error('Invalid saved proxy configuration');
      await applyRouting(partition, 'proxy', config.custom);
    }
  }

  for (const [key, config] of Object.entries(routes)) {
    if (!config || typeof config !== 'object' || !('mode' in config)) continue;
    if (key === ALL_ROUTE_KEY) {
      for (const partition of ['', ...allPartitions]) await restoreOne(partition, config);
      continue;
    }
    if (key.startsWith('__')) continue;   // reserved; never a partition
    await restoreOne(key === 'default' ? '' : key, config);
  }
}
module.exports = { restoreRoutes, ALL_ROUTE_KEY };
