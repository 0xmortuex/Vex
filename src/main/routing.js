// Install saved proxy boundaries before any restored page can issue a request.
// @ts-check
/**
 * @param {{routes: Record<string, unknown>,
 * getSession: (partition: string) => {setProxy: (rules: {proxyRules: string, proxyBypassRules: string}) => Promise<void>},
 * applyRouting: (partition: string, mode: string, custom?: string) => Promise<unknown>,
 * report: (error: Error) => void}} options
 */
async function restoreRoutes({ routes, getSession, applyRouting, report }) {
  for (const [key, config] of Object.entries(routes)) {
    if (!config || typeof config !== 'object') continue;
    const partition = key === 'default' ? '' : key;
    if ('mode' in config && config.mode === 'tor') {
      await getSession(partition).setProxy({ proxyRules: 'socks5://127.0.0.1:9', proxyBypassRules: '<-loopback>' });
      // A refused loopback connection keeps this session offline until Tor is
      // available. Failure to launch Tor must leave that boundary installed.
      void applyRouting(partition, 'tor').catch(report);
    } else if ('mode' in config && config.mode === 'proxy') {
      if (!('custom' in config) || typeof config.custom !== 'string' || !config.custom.trim()) throw new Error('Invalid saved proxy configuration');
      await applyRouting(partition, 'proxy', config.custom);
    }
  }
}
module.exports = { restoreRoutes };
