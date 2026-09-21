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

// "All of Vex through one route" is saved under one key that stands for every
// browsing session. Restored as if it were a partition it proxied a session
// nothing uses, and every real tab came back direct after a restart.
it('puts one route back on every browsing session, not on a session called __all__', async () => {
  const blocked = [], started = [];
  await restoreRoutes({
    routes: { __all__: { mode: 'tor', custom: null, at: 1 } },
    allPartitions: ['persist:main', 'persist:discord'],
    getSession: (partition) => ({ setProxy: async () => { blocked.push(partition); } }),
    applyRouting: async (partition) => { started.push(partition); },
    report: () => {},
  });
  expect(blocked).toEqual(['', 'persist:main', 'persist:discord']);
  expect(started).toEqual(['', 'persist:main', 'persist:discord']);
});

it('leaves other reserved keys alone', async () => {
  const seen = [];
  await restoreRoutes({
    routes: { __somethingElse: { mode: 'tor' }, 'persist:x': { mode: 'tor' } },
    getSession: () => ({ setProxy: async () => {} }),
    applyRouting: async (p) => { seen.push(p); }, report: () => {},
  });
  expect(seen).toEqual(['persist:x']);
});
