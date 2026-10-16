import { describe, it, expect, vi } from 'vitest';
const { createBypassProbe, classify, checkUrl, labelOf } = require('../../src/main/bypass-probe.js');

const ok = { ok: true, ms: 40, status: 200 };
const bad = { ok: false, ms: 6000, error: 'ERR_CONNECTION_RESET' };

describe('classify', () => {
  it('names the broken side in each of the four cases', () => {
    expect(classify({ direct: ok, bypassed: ok }).verdict).toBe('up');
    expect(classify({ direct: bad, bypassed: ok }).verdict).toBe('bypass-carries');
    expect(classify({ direct: ok, bypassed: bad }).verdict).toBe('bypass-broken');
    expect(classify({ direct: bad, bypassed: bad }).verdict).toBe('down');
  });
  it('without a bypass says so and does not blame one', () => {
    expect(classify({ direct: ok, bypassed: null }).verdict).toBe('up');
    const r = classify({ direct: bad, bypassed: null });
    expect(r.verdict).toBe('down-no-bypass');
    expect(r.text).toMatch(/no bypass is on/);
  });
  it('needs the direct result', () => { expect(() => classify({})).toThrow(/direct/); });
});

describe('checkUrl', () => {
  it('accepts an https site and drops credentials and the fragment', () => {
    expect(checkUrl('https://user:pw@discord.com/app#x')).toBe('https://discord.com/app');
  });
  it('refuses http, this computer, the home network and nonsense', () => {
    for (const u of ['http://discord.com/', 'https://localhost/', 'https://127.0.0.1/', 'https://192.168.1.1/', 'https://printer.local/', 'https://intranet/', 'file:///c:/x', 'nonsense']) {
      expect(() => checkUrl(u)).toThrow();
    }
  });
});

describe('probe', () => {
  it('tries the bypass only when one is on, with the rules for that host', async () => {
    const request = vi.fn(async (url, route) => (route.kind === 'direct' ? bad : ok));
    const rules = vi.fn((host) => (host === 'discord.com' ? 'socks5://127.0.0.1:1080' : null));
    const p = createBypassProbe({ request, rules });
    const a = await p.probe('https://discord.com/app');
    expect(a).toMatchObject({ host: 'discord.com', verdict: 'bypass-carries', bypassLabel: 'ByeDPI (strong)' });
    expect(request.mock.calls.map(c => c[1].kind)).toEqual(['direct', 'bypass']);
    const b = await p.probe('https://example.com/');
    expect(b.bypassed).toBe(null);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('needs its two functions', () => { expect(() => createBypassProbe({})).toThrow(/needs/); });
  it('labels the rules without showing the address', () => {
    expect(labelOf('https=127.0.0.1:9;http=127.0.0.1:9')).toBe('the built-in light bypass');
    expect(labelOf('proxy.example:8080')).toBe('your proxy');
  });
});

describe('it never starts or stops anything', () => {
  it('the module does not touch a process, a bypass or winws', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/main/bypass-probe.js'), 'utf8')
      .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    expect(src).not.toMatch(/child_process|spawn|exec\(|taskkill|setProxy|byedpi\./i);
  });
  it('has a schema, a preload entry, is for the own window only and closed in a private window', () => {
    const fs = require('fs'), path = require('path');
    const read = (p) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
    expect(read('src/main/ipc-schemas.js')).toMatch(/define\('bypass:probe'/);
    expect(read('src/preload.js')).toMatch(/invoke\('bypass:probe'/);
    expect(require('../../src/main/ipc-policy.js').UI_ONLY_CHANNELS.has('bypass:probe')).toBe(true);
    const PD = eval(read('src/main/ipc-policy.js').match(/const PRIVATE_DISABLED = (\/.*\/);/)[1]); // eslint-disable-line no-eval
    expect(PD.test('bypass:probe')).toBe(true);
  });
});
