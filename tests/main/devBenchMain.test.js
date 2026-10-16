// Developer bench, main side: failed-request log, response overrides, log tailer, package intel.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequestLog, redactUrl } = require('../../src/main/request-log');
const { createOverrides, globToRegex, isSensitiveOrigin } = require('../../src/main/response-overrides');
const { createLogTail, checkSocketUrl } = require('../../src/main/log-tail');
const { createPkgIntel, parsePackagePage, judge } = require('../../src/main/pkg-intel');

describe('redactUrl / request log', () => {
  it('removes credentials, fragments, secret query values and token-like path parts', () => {
    const out = redactUrl('https://user:pw@api.example.com/v1/' + 'a1'.repeat(20) + '/x?token=abc&page=2&sig=zzz&q=hello#frag');
    expect(out).toBe('https://api.example.com/v1/[redacted]/x?token=[redacted]&page=2&sig=[redacted]&q=hello');
  });
  it('hides a value that looks like a token even under an innocent name', () => {
    expect(redactUrl('https://a.test/p?x=' + 'Ab3'.repeat(10))).toContain('x=[redacted]');
  });
  it('does not show non-web addresses', () => {
    expect(redactUrl('data:text/plain,secret')).toBe('data://[not shown]');
  });
  it('keeps only failures, ignores aborts, and starts over on a new main-frame request', () => {
    const log = createRequestLog({ max: 3 });
    expect(log.record({ webContentsId: 1, url: 'https://a.test/ok', statusCode: 200 })).toBe(false);
    expect(log.record({ webContentsId: 1, url: 'https://a.test/x', statusCode: 404, method: 'get', resourceType: 'xhr' })).toBe(true);
    expect(log.record({ webContentsId: 1, url: 'https://a.test/y', error: 'net::ERR_ABORTED' })).toBe(false);
    expect(log.record({ webContentsId: 1, url: 'https://a.test/z', error: 'net::ERR_CONNECTION_REFUSED' })).toBe(true);
    expect(log.list(1).map(r => [r.method, r.status, r.error])).toEqual([['GET', 404, ''], ['GET', null, 'net::ERR_CONNECTION_REFUSED']]);
    log.record({ webContentsId: 1, url: 'https://b.test/', statusCode: 500, resourceType: 'mainFrame' });
    expect(log.list(1)).toHaveLength(1);
    for (let i = 0; i < 5; i++) log.record({ webContentsId: 2, url: 'https://a.test/' + i, statusCode: 500 });
    expect(log.list(2)).toHaveLength(3);
  });
});

const make = (stored, extra = {}) => {
  const saved = [];
  const ov = createOverrides({ load: () => stored || null, save: (d) => saved.push(d), readFile: extra.readFile || { stat: () => ({ size: 3, mtimeMs: 1 }), read: () => Buffer.from('abc') }, pageUrlOf: () => extra.page || 'http://localhost:3000/app' });
  return { ov, saved };
};
const cfg = (rules) => ({ origins: ['http://localhost:3000'], rules });
const body = { id: 'b1', kind: 'body', origin: 'http://localhost:3000', pattern: 'http://localhost:3000/api/*', inline: '{"a":1}' };

describe('response overrides', () => {
  it('are off until switched on, and answer only a listed origin', () => {
    const { ov } = make();
    ov.set(cfg([body]));
    const d = { url: 'http://localhost:3000/api/users', resourceType: 'xhr', webContentsId: 5 };
    expect(ov.answer({}, d)).toBeNull();
    ov.setActive(true);
    const r = ov.answer({}, d);
    expect(r.redirectURL).toBe('data:application/json;base64,' + Buffer.from('{"a":1}').toString('base64'));
    expect(ov.answer({}, { ...d, url: 'http://localhost:3000/other' })).toBeNull();
  });
  it('never acts for a page whose origin is not listed, in private or Tor sessions', () => {
    const { ov } = make(null, { page: 'http://localhost:4000/' });
    ov.set(cfg([body])); ov.setActive(true);
    const d = { url: 'http://localhost:3000/api/x', resourceType: 'xhr', webContentsId: 5 };
    expect(ov.answer({}, d)).toBeNull();
    const same = make(); same.ov.set(cfg([body])); same.ov.setActive(true);
    expect(same.ov.answer({ __vexEphemeral: true }, d)).toBeNull();
    expect(same.ov.answer({ __vexTor: true }, d)).toBeNull();
  });
  it('refuses bank, payment, password and sign-in origins, cookies, and unpicked files', () => {
    const { ov } = make();
    expect(isSensitiveOrigin('https://www.paypal.com')).toBe(true);
    expect(isSensitiveOrigin('http://localhost:3000')).toBe(false);
    expect(() => ov.set({ origins: ['https://mybank.example'], rules: [] })).toThrow(/never touches/);
    expect(() => ov.set(cfg([{ id: 'h', kind: 'reqHeader', origin: 'http://localhost:3000', pattern: 'http://localhost:3000/*', name: 'Cookie', value: 'a=b' }]))).toThrow(/cannot be changed/);
    expect(() => ov.set(cfg([{ ...body, id: 'f', inline: undefined, file: 'C:\\secret.txt' }]))).toThrow(/file picker/);
    ov.grantFile('C:\\ok.json');
    expect(() => ov.set(cfg([{ ...body, id: 'f', inline: undefined, file: 'C:\\ok.json' }]))).not.toThrow();
  });
  it('sets and removes headers only for matching requests', () => {
    const { ov } = make();
    ov.set(cfg([
      { id: 'a', kind: 'reqHeader', origin: 'http://localhost:3000', pattern: 'http://localhost:3000/*', name: 'X-Test', value: '1', op: 'set' },
      { id: 'b', kind: 'resHeader', origin: 'http://localhost:3000', pattern: 'http://localhost:3000/*', name: 'content-security-policy', op: 'remove' },
      { id: 'c', kind: 'resHeader', origin: 'http://localhost:3000', pattern: 'http://localhost:3000/*', name: 'Access-Control-Allow-Origin', value: '*', op: 'set' },
    ]));
    ov.setActive(true);
    const d = { url: 'http://localhost:3000/a', resourceType: 'xhr', webContentsId: 5 };
    const req = {}; expect(ov.requestHeaders({}, d, req)).toBe(true); expect(req).toEqual({ 'X-Test': '1' });
    const res = { 'Content-Security-Policy': ['default-src none'] }; ov.responseHeaders({}, d, res);
    expect(res).toEqual({ 'Access-Control-Allow-Origin': ['*'] });
  });
  it('reports state for the banner and reads a damaged file as an error, not an empty list', () => {
    const { ov } = make(); ov.set(cfg([body]));
    expect(ov.state('http://localhost:3000/x')).toMatchObject({ active: false, listed: true, rules: 1 });
    expect(() => createOverrides({ load: () => ({ origins: ['ftp://x'], rules: [] }), save() {}, readFile: {} })).toThrow(/could not be read/);
  });
  it('globs match whole addresses', () => {
    expect(globToRegex('http://a.test/api/*').test('http://a.test/api/x/y')).toBe(true);
    expect(globToRegex('http://a.test/api/*').test('http://a.test/apix')).toBe(false);
  });
});

describe('log tailer', () => {
  it('follows a file read-only from its end, picks up appended text and a truncation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vexlog-'));
    const file = path.join(dir, 'a.log');
    fs.writeFileSync(file, 'one\ntwo\n');
    const t = createLogTail({ fs });
    const g = t.grantFile(file);
    let r = t.poll(g.id, 0);
    expect(r.text).toBe('one\ntwo\n');
    fs.appendFileSync(file, 'three\n');
    r = t.poll(g.id, r.position);
    expect(r.text).toBe('three\n');
    fs.writeFileSync(file, 'x\n');
    r = t.poll(g.id, r.position);
    expect(r.text).toContain('truncated');
    expect(r.text).toContain('x\n');
    expect(t.close(g.id)).toBe(true);
    expect(() => t.poll(g.id, 0)).toThrow(/not being followed/);
    fs.rmSync(dir, { recursive: true });
  });
  it('keeps at most 2 MB and four logs at once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vexlog-'));
    const file = path.join(dir, 'big.log');
    fs.writeFileSync(file, '');
    const t = createLogTail({ fs });
    const g = t.grantFile(file);
    for (let i = 0; i < 12; i++) { fs.appendFileSync(file, 'x'.repeat(200 * 1024)); t.poll(g.id, 0); }
    const r = t.poll(g.id, 0);
    expect(r.text.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    for (let i = 0; i < 3; i++) t.grantFile(file);
    expect(() => t.grantFile(file)).toThrow(/At most 4/);
    fs.rmSync(dir, { recursive: true });
  });
  it('only accepts ws:// on this computer, and only receives', () => {
    expect(checkSocketUrl('ws://localhost:9000/log')).toBe('ws://localhost:9000/log');
    for (const bad of ['wss://localhost/', 'ws://example.com/', 'ws://192.168.0.5:1/', 'http://localhost/', 'ws://u:p@localhost/']) expect(() => checkSocketUrl(bad), bad).toThrow();
    const sockets = [];
    class FakeWs { constructor(u) { this.url = u; this.sent = []; sockets.push(this); } send(x) { this.sent.push(x); } close() { this.onclose && this.onclose(); } }
    const t = createLogTail({ fs, WebSocketImpl: FakeWs });
    const g = t.grantSocket('ws://127.0.0.1:7000');
    sockets[0].onopen(); sockets[0].onmessage({ data: 'hello' });
    expect(t.poll(g.id, 0).text).toContain('hello\n');
    expect(sockets[0].sent).toEqual([]);
  });
});

describe('package intel', () => {
  it('reads the package from the page address', () => {
    expect(parsePackagePage('https://www.npmjs.com/package/@scope/name')).toEqual({ eco: 'npm', name: '@scope/name' });
    expect(parsePackagePage('https://pypi.org/project/requests/')).toEqual({ eco: 'pypi', name: 'requests' });
    expect(parsePackagePage('https://crates.io/crates/serde')).toEqual({ eco: 'crates', name: 'serde' });
    expect(parsePackagePage('https://evil.test/package/x')).toBeNull();
    expect(parsePackagePage('http://www.npmjs.com/package/x')).toBeNull();
  });
  it('judges deprecation, advisories, age and missing licence', () => {
    expect(judge({ deprecated: 'use y', advisories: [], license: 'MIT' }).level).toBe('warning');
    expect(judge({ advisories: [{ severity: 'high' }], license: 'MIT' }).level).toBe('warning');
    expect(judge({ advisories: [], license: '', ageDays: 10 }).level).toBe('caution');
    expect(judge({ advisories: [], license: 'MIT', ageDays: 900 }).level).toBe('caution');
    expect(judge({ advisories: [], license: 'MIT', ageDays: 10 }).level).toBe('ok');
  });
  it('builds an npm result from the registry answers and notes what failed', async () => {
    const now = Date.parse('2026-10-16T00:00:00Z');
    const urls = [];
    const intel = createPkgIntel({
      now: () => now,
      getJson: async (u) => {
        urls.push(u);
        if (u.endsWith('/latest')) return { version: '1.2.3', license: 'MIT', description: 'd' };
        if (u.includes('-/v1/search')) return { objects: [{ package: { name: 'left-pad', date: '2026-09-16T00:00:00Z' } }] };
        throw new Error('the registry answered 500');
      },
      postJson: async () => ({ 'left-pad': [{ id: 1, title: 'bad', severity: 'moderate', url: 'u' }] }),
    });
    const info = await intel.lookup('npm', 'left-pad');
    expect(info).toMatchObject({ version: '1.2.3', license: 'MIT', ageDays: 30, addCommand: 'pnpm add left-pad', advisoriesChecked: true });
    expect(info.downloadsWeek).toBeNull();
    expect(info.notes.join(' ')).toContain('downloads');
    expect(info.safety.level).toBe('caution');
    await intel.lookup('npm', 'left-pad');
    expect(urls.length).toBe(3);   // second call came from the cache
    await expect(intel.lookup('npm', '../x')).rejects.toThrow(/not a package name/);
  });
});
