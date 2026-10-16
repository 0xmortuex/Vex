// Wave 2 integration: the password-field interlock (credential-guard.js) and the Web safety
// lookalike warning (web-safety.js) are one detector: an address one flags, the other flags
// the same way, with the same allowed-sites list and the same most-used-sites list.
import { describe, it, expect } from 'vitest';

const ws = require('../../src/main/web-safety.js');
const cg = require('../../src/main/credential-guard.js');

const TOP = ['paypal.com', 'roblox.com', 'github.com'];
const HOSTS = ['paypa1.com', 'paypal.com', 'rnicrosoft.com', 'githab.com', 'example.org', 'xn--pypal-4ve.com'];

describe('one lookalike detector', () => {
  it.each(HOSTS)('%s: the interlock flags exactly what Web safety (strict) flags', (host) => {
    const a = ws.analyzeHost(host, { sensitivity: 'strict', topHosts: TOP, allow: [] });
    const b = cg.check('https://' + host + '/login', { savedHosts: [], topHosts: TOP, allow: [] });
    expect(b.verdict === 'warn').toBe(!!a.flagged);
    if (a.flagged) expect(b.reason).toBe(a.kind);
  });

  it('the allowed-sites list of Web safety silences the interlock too', () => {
    expect(cg.check('https://paypa1.com/', { topHosts: TOP, allow: [] }).verdict).toBe('warn');
    expect(cg.check('https://paypa1.com/', { topHosts: TOP, allow: ['paypa1.com'] }).verdict).toBe('ok');
  });

  it('a saved login adds its site to the names the detector guards', () => {
    expect(cg.check('https://examp1e.org/', { savedHosts: ['example.org'], topHosts: [], allow: [] }).verdict).toBe('warn');
  });
});
