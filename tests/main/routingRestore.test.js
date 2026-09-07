import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { restoreRoutes } = createRequire(import.meta.url)('../../src/main/routing.js');

it('blocks a saved Tor session before attempting startup and stays blocked on failure', async () => {
  const events = [], report = vi.fn();
  const setProxy = vi.fn(async rules => { events.push('blocked'); expect(rules.proxyBypassRules).toBe('<-loopback>'); });
  await restoreRoutes({ routes: { 'persist:private-route': { mode: 'tor' }, __vexPreferenceStore: 1 },
    getSession: () => ({ setProxy }), report,
    applyRouting: async () => { events.push('starting'); throw new Error('Unavailable'); },
  });
  expect(events).toEqual(['blocked', 'starting']);
  expect(setProxy).toHaveBeenCalledTimes(1);
  expect(setProxy.mock.calls[0][0].proxyRules).toBe('socks5://127.0.0.1:9');
  expect(report).toHaveBeenCalledOnce();
});

it('waits for a saved custom proxy before allowing window startup', async () => {
  let release;
  const applyRouting = vi.fn(() => new Promise(resolve => { release = resolve; }));
  let ready = false;
  const result = restoreRoutes({ routes: { default: { mode: 'proxy', custom: 'socks5://localhost:1234' } }, applyRouting }).then(() => { ready = true; });
  await Promise.resolve();
  expect(ready).toBe(false);
  expect(applyRouting).toHaveBeenCalledWith('', 'proxy', 'socks5://localhost:1234');
  release(); await result;
  expect(ready).toBe(true);
});
