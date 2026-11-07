// @vitest-environment node
//
// "Where does this link go?" for one link (src/main/link-check.js guard + main.js wiring). Redirects are followed by hand,
// every hop passes the public-address guard, and the request is listed in the egress ledger as "Short link preview".
// The real net.request 'redirect' behaviour was measured for the captive-portal check and the link checker already; nothing
// new about Electron is assumed here.
import { describe, it, expect, vi } from 'vitest';
const fs = require('fs'), path = require('path');
const { createLinkCheck, createPublicGuard } = require('../../src/main/link-check.js');
const PA = require('../../src/renderer/js/private-address.js');
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

// A fake network: url -> { to?: next url (a 301), status? }.
function net(table) {
  const asked = [];
  const fetchIn = vi.fn(async (url, init) => {
    asked.push(init.method + ' ' + url);
    const e = table[url] || { status: 200 };
    const headers = { get: (h) => (h === 'location' && e.to ? e.to : null) };
    return { status: e.to ? 301 : (e.status || 200), url, headers, body: null };
  });
  return { fetchIn, asked };
}
const guardWith = (hosts) => createPublicGuard({ resolveHost: async (h) => ({ endpoints: (hosts[h] || []).map(address => ({ address })) }), ...PA });

describe('the public-address guard', () => {
  it('lets a public name through and refuses this machine, the local network and odd schemes', async () => {
    const g = guardWith({ 'bit.ly': ['67.199.248.10'], 'sneaky.example': ['192.168.1.1'], 'nowhere.example': [] });
    await expect(g('https://bit.ly/x')).resolves.toBeUndefined();
    await expect(g('http://localhost:8080/')).rejects.toThrow(/local network/);
    await expect(g('http://192.168.1.1/')).rejects.toThrow(/local network/);
    await expect(g('http://[::1]/')).rejects.toThrow(/local network/);
    await expect(g('http://router/')).rejects.toThrow(/local network/);
    await expect(g('https://sneaky.example/')).rejects.toThrow(/local network/);
    await expect(g('https://nowhere.example/')).rejects.toThrow(/Could not find/);
    await expect(g('file:///c:/x')).rejects.toThrow(/web addresses/);
    await expect(g('https://93.184.216.34/')).resolves.toBeUndefined();
  });
  it('needs a resolver', () => {
    expect(() => createPublicGuard({ ...PA })).toThrow(/resolveHost/);
  });
});

describe('following one link', () => {
  it('walks the redirects by hand with HEAD, ends on the real address, and reads no body', async () => {
    const { fetchIn, asked } = net({ 'https://bit.ly/x': { to: 'https://t.co/y' }, 'https://t.co/y': { to: 'https://example.org/final?utm_source=mail' } });
    const lc = createLinkCheck({ fetchIn, guard: guardWith({ 'bit.ly': ['1.1.1.1'], 't.co': ['2.2.2.2'], 'example.org': ['3.3.3.3'] }) });
    const r = await lc.one('https://bit.ly/x');
    expect(asked).toEqual(['HEAD https://bit.ly/x', 'HEAD https://t.co/y', 'HEAD https://example.org/final?utm_source=mail']);
    expect(r).toMatchObject({ status: 200, verdict: 'ok', redirected: true, finalUrl: 'https://example.org/final?utm_source=mail' });
  });
  it('stops at a hop that points at the local network and says why, without asking it', async () => {
    const { fetchIn, asked } = net({ 'https://bit.ly/x': { to: 'http://192.168.0.1/reboot' } });
    const lc = createLinkCheck({ fetchIn, guard: guardWith({ 'bit.ly': ['1.1.1.1'] }) });
    const r = await lc.one('https://bit.ly/x');
    expect(asked).toEqual(['HEAD https://bit.ly/x']);
    expect(r.verdict).toBe('broken');
    expect(r.error).toMatch(/local network/);
  });
  it('gives up after 8 redirects', async () => {
    const table = {};
    for (let i = 0; i < 20; i++) table['https://loop.example/' + i] = { to: 'https://loop.example/' + (i + 1) };
    const { fetchIn } = net(table);
    const lc = createLinkCheck({ fetchIn, guard: guardWith({ 'loop.example': ['4.4.4.4'] }) });
    const r = await lc.one('https://loop.example/0');
    expect(r.error).toMatch(/too many redirects/);
  });
  it('without a guard (the bulk page checker) nothing changes', async () => {
    const { fetchIn, asked } = net({});
    await createLinkCheck({ fetchIn }).one('http://localhost:3000/');
    expect(asked).toEqual(['HEAD http://localhost:3000/']);
  });
});

describe('wiring', () => {
  it('main follows one link through the ledger, with the guard, and the channel is private-window-proof', () => {
    expect(main).toMatch(/feature: 'Short link preview', kind: 'fetch'/);
    expect(main).toMatch(/guard: _linkCheckMod\.createPublicGuard\(/);
    expect(main).toMatch(/ipcMain\.handle\('links:follow-one'/);
    expect(main).toMatch(/feature: 'Link checker', kind: 'fetch'/);
    expect(fs.readFileSync(path.join(__dirname, '../../src/main/ipc-policy.js'), 'utf8')).toContain('links:follow-one');
    expect(fs.readFileSync(path.join(__dirname, '../../src/main/ipc-schemas.js'), 'utf8')).toContain("define('links:follow-one'");
    expect(fs.readFileSync(path.join(__dirname, '../../src/preload.js'), 'utf8')).toContain("invoke('links:follow-one'");
  });
});
