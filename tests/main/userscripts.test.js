import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../../src/main/userscripts.js');
const { createXhr } = require('../../src/main/userscript-xhr.js');
const {
  parseMetadata, scriptMatches, isSensitiveHost, tabAllowed, connectAllowed, createUserscripts, LIMITS, compareVersions,
} = core;

const HEADER = (lines) => '// ==UserScript==\n' + lines.map(l => '// ' + l).join('\n') + '\n// ==/UserScript==\nconsole.log(1);\n';
const BASIC = HEADER(['@name Hello', '@namespace test', '@version 1.2', '@match https://example.com/*', '@grant GM_getValue', '@grant GM_setValue', '@run-at document-start']);

function memoryStore() {
  const files = new Map();
  return {
    files,
    async read(key) { return files.has(key) ? JSON.parse(files.get(key)) : null; },
    async write(key, data) { files.set(key, JSON.stringify(data)); return true; },
  };
}
const quiet = { warn() {}, error() {} };
async function manager(store = memoryStore()) {
  const m = createUserscripts({ store, log: quiet, flushDelayMs: 5 });
  await m.load();
  return { m, store };
}

describe('header parser', () => {
  it('reads every field that matters', () => {
    const r = parseMetadata(HEADER([
      '@name My Script', '@namespace https://x', '@version 2.0.1', '@description does things', '@author me',
      '@match https://*.example.com/a/*', '@include /^https:\\/\\/foo\\.org/', '@exclude https://example.com/no*',
      '@grant GM_xmlhttpRequest', '@grant GM.getValue', '@grant none', '@grant GM_registerMenuCommand',
      '@connect api.example.com', '@connect SELF', '@run-at document-end', '@noframes', '@updateURL https://example.com/s.user.js',
    ]));
    expect(r.ok).toBe(true);
    expect(r.meta.name).toBe('My Script');
    expect(r.meta.matches).toEqual(['https://*.example.com/a/*']);
    expect(r.meta.connects).toEqual(['api.example.com', 'self']);
    expect(r.meta.grants).toEqual(['GM_xmlhttpRequest', 'GM_getValue']);
    expect(r.meta.unsupportedGrants).toEqual(['GM_registerMenuCommand']);
    expect(r.meta.runAt).toBe('document-end');
    expect(r.meta.noframes).toBe(true);
    expect(r.meta.updateURL).toBe('https://example.com/s.user.js');
  });

  it('refuses scripts with no header, no name, a bad @run-at or a bad @connect', () => {
    expect(parseMetadata('console.log(1)').ok).toBe(false);
    expect(parseMetadata(HEADER(['@match https://a.com/*'])).errors.join()).toMatch(/@name/);
    expect(parseMetadata(HEADER(['@name x', '@run-at context-menu'])).ok).toBe(false);
    expect(parseMetadata(HEADER(['@name x', '@connect not a host!'])).ok).toBe(false);
    expect(parseMetadata(HEADER(['@name x', '@match ftp://a.com/*'])).ok).toBe(false);
    expect(parseMetadata('').ok).toBe(false);
  });

  it('bounds header values, the number of lines and the size', () => {
    expect(parseMetadata(HEADER(['@name ' + 'x'.repeat(600)])).ok).toBe(false);
    const many = Array.from({ length: 150 }, (_, i) => '@match https://a' + i + '.com/*');
    const r = parseMetadata(HEADER(['@name x', ...many]));
    expect(r.meta.matches.length).toBe(LIMITS.maxMulti);
    expect(r.warnings.join()).toMatch(/ignored/);
    expect(parseMetadata(BASIC + '//' + 'x'.repeat(LIMITS.maxSourceBytes)).ok).toBe(false);
  });

  it('warns about what it cannot do', () => {
    const r = parseMetadata(HEADER(['@name x', '@require https://cdn/lib.js', '@grant GM_xmlhttpRequest']));
    expect(r.warnings.join('\n')).toMatch(/@require/);
    expect(r.warnings.join('\n')).toMatch(/no @connect/);
  });

  it('compares versions', () => {
    expect(compareVersions('1.10', '1.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9', '1.0')).toBe(-1);
  });
});

function entry(lines, extra = {}) {
  const meta = parseMetadata(HEADER(lines)).meta;
  return { meta, userHosts: [], enabled: true, ...extra };
}

describe('match engine', () => {
  it('handles @match patterns', () => {
    const s = entry(['@name a', '@match https://*.example.com/a/*']);
    expect(scriptMatches(s, 'https://www.example.com/a/b?x=1')).toBe(true);
    expect(scriptMatches(s, 'https://example.com/a/')).toBe(true);
    expect(scriptMatches(s, 'http://www.example.com/a/b')).toBe(false);
    expect(scriptMatches(s, 'https://example.com/b/')).toBe(false);
    expect(scriptMatches(s, 'https://evil-example.com/a/b')).toBe(false);
    expect(scriptMatches(s, 'https://example.com.evil.net/a/b')).toBe(false);
  });
  it('handles <all_urls>, scheme wildcards, @include globs and regexes, and @exclude winning', () => {
    expect(scriptMatches(entry(['@name a', '@match <all_urls>']), 'https://news.org/x')).toBe(true);
    expect(scriptMatches(entry(['@name a', '@match *://news.org/*']), 'http://news.org/x')).toBe(true);
    expect(scriptMatches(entry(['@name a', '@include https://news.org/*']), 'https://NEWS.org/x')).toBe(true);
    expect(scriptMatches(entry(['@name a', '@include /^https:\\/\\/news\\.org\\/\\d+$/']), 'https://news.org/123')).toBe(true);
    expect(scriptMatches(entry(['@name a', '@include /^https:\\/\\/news\\.org\\/\\d+$/']), 'https://news.org/abc')).toBe(false);
    const ex = entry(['@name a', '@match https://news.org/*', '@exclude https://news.org/private*']);
    expect(scriptMatches(ex, 'https://news.org/home')).toBe(true);
    expect(scriptMatches(ex, 'https://news.org/private/x')).toBe(false);
    expect(scriptMatches(entry(['@name a', '@match https://news.org/*', '@exclude-match https://news.org/x/*']), 'https://news.org/x/1')).toBe(false);
  });
  it('never matches a page that is not http(s), and nothing without a pattern', () => {
    const all = entry(['@name a', '@include *']);
    for (const u of ['file:///C:/a.html', 'vex://start', 'chrome-extension://abc/x.html', 'about:blank', 'data:text/html,hi', 'ftp://a.com/x']) expect(scriptMatches(all, u)).toBe(false);
    expect(scriptMatches(entry(['@name a']), 'https://a.com/')).toBe(false);
  });
  it('keeps scripts off sensitive sites unless that host was added by name', () => {
    const s = entry(['@name a', '@match <all_urls>']);
    for (const u of ['https://www.paypal.com/', 'https://mail.google.com/mail', 'https://accounts.google.com/', 'https://login.example.org/', 'https://www.chase.com/', 'https://www.irs.gov/', 'https://secure.bank.example/']) {
      expect(scriptMatches(s, u)).toBe(false);
    }
    expect(scriptMatches(s, 'https://example.org/')).toBe(true);
    const added = entry(['@name a', '@match <all_urls>'], { userHosts: ['paypal.com'] });
    expect(scriptMatches(added, 'https://www.paypal.com/')).toBe(true);
    expect(scriptMatches(added, 'https://www.chase.com/')).toBe(false);
    // A host added by name runs the script even with no @match line at all.
    expect(scriptMatches(entry(['@name a'], { userHosts: ['example.net'] }), 'https://example.net/x')).toBe(true);
    expect(isSensitiveHost('example.org')).toBe(false);
    expect(isSensitiveHost('127.0.0.1')).toBe(false);
  });
});

describe('which tabs may run scripts', () => {
  it('allows the main session and containers only', () => {
    expect(tabAllowed({ partition: 'persist:main' })).toBe(true);
    expect(tabAllowed({ partition: 'persist:container-work' })).toBe(true);
    for (const p of ['persist:route-tor', 'persist:route-proxy', 'persist:discord', 'persist:spotify', 'otr-123', 'otr-burner-1', 'tor-abc', 'private-xyz', '', undefined]) {
      expect(tabAllowed({ partition: p })).toBe(false);
    }
    expect(tabAllowed({ partition: 'persist:main', tor: true })).toBe(false);
    expect(tabAllowed({ partition: 'persist:container-work', routed: true })).toBe(false);
  });
  it('gives a blocked tab no scripts, whatever matches', async () => {
    const { m } = await manager();
    await m.install({ source: BASIC });
    expect(m.matching('https://example.com/x', { eligible: true }).length).toBe(1);
    expect(m.matching('https://example.com/x', { eligible: false })).toEqual([]);
    expect(m.matching('https://example.com/x', { eligible: true, topFrame: false })).toEqual([]);
    expect(m.matching('vex://start', { eligible: true })).toEqual([]);
  });
});

describe('GM bridge permissions', () => {
  const connectScript = (lines, extra = {}) => entry(['@name a', '@grant GM_xmlhttpRequest', ...lines], extra);
  it('allows only declared hosts (and their subdomains)', () => {
    const s = connectScript(['@connect api.example.com', '@connect 127.0.0.1']);
    expect(connectAllowed(s, 'https://api.example.com/x', 'https://page.org/').ok).toBe(true);
    expect(connectAllowed(s, 'https://v2.api.example.com/x', 'https://page.org/').ok).toBe(true);
    expect(connectAllowed(s, 'http://127.0.0.1:8080/x', 'https://page.org/').ok).toBe(true);
    const blocked = connectAllowed(s, 'https://example.com/x', 'https://page.org/');
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/@connect/);
    expect(connectAllowed(s, 'http://localhost:8080/x', 'https://page.org/').ok).toBe(false);
    expect(connectAllowed(s, 'file:///C:/secret', 'https://page.org/').ok).toBe(false);
    expect(connectAllowed(connectScript([]), 'https://api.example.com/', 'https://page.org/').ok).toBe(false);
  });
  it('treats self as the page host', () => {
    const s = connectScript(['@connect self']);
    expect(connectAllowed(s, 'https://cdn.page.org/x', 'https://page.org/a').ok).toBe(true);
    expect(connectAllowed(s, 'https://other.org/x', 'https://page.org/a').ok).toBe(false);
  });
  it('lets "*" through only once the person accepted it, and never to this computer or its network', () => {
    const declared = connectScript(['@connect *']);
    expect(connectAllowed(declared, 'https://anything.org/', 'https://page.org/').ok).toBe(false);
    const accepted = connectScript(['@connect *'], { anyHost: true });
    expect(connectAllowed(accepted, 'https://anything.org/', 'https://page.org/').ok).toBe(true);
    for (const u of ['http://127.0.0.1/', 'http://localhost/', 'http://192.168.1.1/', 'http://10.0.0.5/', 'http://169.254.169.254/', 'http://[::1]/', 'http://printer.local/']) {
      expect(connectAllowed(accepted, u, 'https://page.org/').ok).toBe(false);
    }
  });
  it('requires the grant for every operation', async () => {
    const { m } = await manager();
    const r = await m.install({ source: HEADER(['@name ro', '@match https://a.com/*', '@grant GM_getValue']) });
    const s = m.get(r.id);
    expect(() => m.requireGrant(s, 'getValue')).not.toThrow();
    expect(() => m.requireGrant(s, 'xhr')).toThrow(/GM_xmlhttpRequest/);
    expect(() => m.requireGrant(s, 'clipboard')).toThrow(/GM_setClipboard/);
    expect(() => m.requireGrant(s, 'openTab')).toThrow(/GM_openInTab/);
    expect(() => m.requireGrant(s, 'notification')).toThrow(/GM_notification/);
    await expect(m.setValue(r.id, 'k', 1)).rejects.toThrow(/GM_setValue/);
  });
  it('rate-limits notifications and tabs per script', async () => {
    const { m } = await manager();
    const r = await m.install({ source: BASIC });
    const s = m.get(r.id);
    const ok = Array.from({ length: 6 }, () => m.rate(s, 'notification', 5));
    expect(ok).toEqual([true, true, true, true, true, false]);
  });
});

describe('storage bounds', () => {
  it('bounds name, size, count and total', async () => {
    const { m } = await manager();
    const { id } = await m.install({ source: BASIC });
    await m.setValue(id, 'a', { x: 1 });
    await expect(m.setValue(id, '', 1)).rejects.toThrow();
    await expect(m.setValue(id, 'k'.repeat(LIMITS.maxKeyLength + 1), 1)).rejects.toThrow();
    await expect(m.setValue(id, '__proto__', 1)).rejects.toThrow(/not allowed/);
    await expect(m.setValue(id, 'big', 'x'.repeat(LIMITS.maxValueBytes))).rejects.toThrow(/KB/);
    const circular = {}; circular.self = circular;
    await expect(m.setValue(id, 'c', circular)).rejects.toThrow(/plain data/);
    for (let i = 1; i < LIMITS.maxValueKeys; i++) await m.setValue(id, 'k' + i, i);
    await expect(m.setValue(id, 'one-too-many', 1)).rejects.toThrow(/at most/);
    await m.setValue(id, 'a', 'replaced'); // replacing an existing key is still fine
  });
  it('bounds the total', async () => {
    const { m } = await manager();
    const { id } = await m.install({ source: BASIC });
    const chunk = 'y'.repeat(LIMITS.maxValueBytes - 100);
    let wrote = 0;
    await expect((async () => { for (let i = 0; i < 20; i++) { await m.setValue(id, 'c' + i, chunk); wrote++; } })()).rejects.toThrow(/used its/);
    expect(wrote).toBeLessThan(10);
  });
  it('persists values and drops anything out of bounds when a file is read back', async () => {
    const { m, store } = await manager();
    const { id } = await m.install({ source: BASIC });
    await m.setValue(id, 'keep', 5);
    await m.flush();
    const saved = JSON.parse(store.files.get('userscripts'));
    saved.scripts[0].values['x'.repeat(500)] = 1;
    saved.scripts[0].values.huge = 'z'.repeat(LIMITS.maxValueBytes * 2);
    saved.scripts[0].userHosts = ['ok.example', '../../etc', '*'];
    saved.scripts.push({ id: 'us-0000000000000000', source: 'not a script' });
    store.files.set('userscripts', JSON.stringify(saved));
    const again = createUserscripts({ store, log: quiet });
    await again.load();
    const s = again.get(id);
    expect(s.values).toEqual({ keep: 5 });
    expect(s.userHosts).toEqual(['ok.example']);
    expect(again.list().scripts.length).toBe(1);
  });
});

describe('the manager', () => {
  it('previews, installs, updates in place (keeping values) and refuses past the limit', async () => {
    const { m } = await manager();
    const p = m.preview(BASIC);
    expect(p.ok).toBe(true);
    expect(p.lines.join('\n')).toMatch(/Runs on: https:\/\/example\.com\/\*/);
    expect(p.lines.join('\n')).toMatch(/Permissions: GM_getValue, GM_setValue/);
    const { id } = await m.install({ source: BASIC });
    await m.setValue(id, 'n', 7);
    const newer = BASIC.replace('@version 1.2', '@version 1.3').replace('@grant GM_setValue', '@grant GM_setValue\n// @grant GM_xmlhttpRequest');
    const pv = m.preview(newer);
    expect(pv.replaces.id).toBe(id);
    expect(pv.lines.join('\n')).toMatch(/CHANGED since your copy: new permission GM_xmlhttpRequest/);
    const u = await m.install({ source: newer });
    expect(u).toMatchObject({ id, replaced: true });
    expect(m.get(id).values).toEqual({ n: 7 });
    expect(m.list().scripts.length).toBe(1);
    for (let i = 1; i < LIMITS.maxScripts; i++) await m.install({ source: HEADER(['@name s' + i, '@match https://a.com/*']) });
    await expect(m.install({ source: HEADER(['@name overflow', '@match https://a.com/*']) })).rejects.toThrow(/100/);
  });
  it('an update never keeps a "contact any site" approval that was not given again', async () => {
    const { m } = await manager();
    const src = HEADER(['@name wide', '@match https://a.com/*', '@grant GM_xmlhttpRequest', '@connect *']);
    expect(m.preview(src).wantsAnyHost).toBe(true);
    const { id } = await m.install({ source: src, anyHost: true });
    expect(m.get(id).anyHost).toBe(true);
    await m.install({ source: src.replace('console.log(1)', 'console.log(2)'), anyHost: false, replaceId: id });
    expect(m.get(id).anyHost).toBe(false);
  });
  it('does not grant "any site" to a script that never asked for it', async () => {
    const { m } = await manager();
    const { id } = await m.install({ source: BASIC, anyHost: true });
    expect(m.get(id).anyHost).toBe(false);
  });
  it('the kill switch and a per-script switch stop matching at once', async () => {
    const { m } = await manager();
    const { id } = await m.install({ source: BASIC });
    const hit = () => m.matching('https://example.com/', { eligible: true }).length;
    expect(hit()).toBe(1);
    await m.setEnabled(id, false);
    expect(hit()).toBe(0);
    await m.setEnabled(id, true);
    expect(hit()).toBe(1);
    await m.setGlobalEnabled(false);
    expect(m.globalEnabled).toBe(false);
    expect(hit()).toBe(0);
    await m.setGlobalEnabled(true);
    expect(hit()).toBe(1);
  });
  it('adds only well-formed sites, and removes a script with its values', async () => {
    const { m } = await manager();
    const { id } = await m.install({ source: BASIC });
    expect(await m.setUserHosts(id, ['https://www.Example.net/path', 'a.example.org'])).toEqual(['example.net', 'a.example.org']);
    await expect(m.setUserHosts(id, ['*'])).rejects.toThrow();
    await expect(m.setUserHosts(id, ['localhost'])).rejects.toThrow();
    await m.remove(id);
    expect(m.list().scripts).toEqual([]);
    await expect(m.remove(id)).rejects.toThrow(/not installed/);
  });
  it('a script that is not exactly as it was comes back switched off after a restore', async () => {
    const { m, store } = await manager();
    const { id } = await m.install({ source: BASIC });
    const other = await m.install({ source: HEADER(['@name two', '@match https://b.com/*']) });
    const saved = JSON.parse(store.files.get('userscripts'));
    saved.scripts.find(s => s.id === other.id).source = HEADER(['@name two', '@match https://b.com/*']) + '\nfetch("https://evil/")';
    saved.scripts.push({ id: 'us-aaaaaaaaaaaaaaaa', source: HEADER(['@name brought in', '@match https://c.com/*']), enabled: true });
    store.files.set('userscripts', JSON.stringify(saved));
    await m.reload({ trusted: false });
    const byName = Object.fromEntries(m.list().scripts.map(s => [s.name, s.enabled]));
    expect(byName).toEqual({ Hello: true, two: false, 'brought in': false });
    expect(m.get(id).enabled).toBe(true);
  });
});

// A stand-in for electron's net.request over node's http, with the events
// createXhr uses: response, redirect (manual), error.
function shimNet(seen) {
  return {
    request({ url, method, redirect }) {
      const listeners = {};
      const headers = {};
      const chunks = [];
      let u = url;
      let aborted = false;
      const emit = (n, ...a) => (listeners[n] || []).forEach(f => f(...a));
      const go = () => {
        const r = http.request(u, { method, headers }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirect === 'manual') {
            res.resume();
            if (aborted) return;
            u = new URL(res.headers.location, u).href;
            emit('redirect', res.statusCode, method, u);
            return;
          }
          emit('response', { statusCode: res.statusCode, statusMessage: res.statusMessage, headers: res.headers, on: (n, f) => res.on(n, f) });
        });
        r.on('error', (e) => emit('error', e));
        if (chunks.length) r.write(Buffer.concat(chunks));
        r.end();
      };
      return {
        on(n, f) { (listeners[n] ||= []).push(f); },
        setHeader(k, v) { headers[k] = v; seen.headers = headers; },
        write(c) { chunks.push(c); },
        end() { go(); },
        abort() { aborted = true; },
        followRedirect() { go(); },
      };
    },
  };
}

describe('GM_xmlhttpRequest transport', () => {
  let server;
  afterEach(() => new Promise(r => (server ? server.close(r) : r())));
  async function start() {
    const hits = [];
    server = http.createServer((req, res) => {
      hits.push(req.url);
      if (req.url === '/redirect-out') { res.writeHead(302, { Location: 'http://localhost:' + server.address().port + '/secret' }); res.end(); return; }
      if (req.url === '/redirect-in') { res.writeHead(302, { Location: '/ok' }); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Seen-Cookie': String(req.headers.cookie || '') });
      res.end('hello ' + req.url);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return { port: server.address().port, hits };
  }
  const script = (port) => entry(['@name x', '@grant GM_xmlhttpRequest', '@connect 127.0.0.1'], {});

  it('fetches an allowed host, drops forbidden headers and follows allowed redirects', async () => {
    const { port } = await start();
    const seen = {};
    const x = createXhr({ net: shimNet(seen), getSession: () => ({}), limits: LIMITS });
    const s = script(port);
    const allow = (u) => connectAllowed(s, u, 'https://page.org/');
    const r = await x.start({ url: `http://127.0.0.1:${port}/redirect-in`, headers: { Cookie: 'a=b', 'X-Mine': '1', Origin: 'https://evil' }, allow }).promise;
    expect(r.status).toBe(200);
    expect(r.responseText).toBe('hello /ok');
    expect(r.finalUrl).toBe(`http://127.0.0.1:${port}/ok`);
    expect(seen.headers['X-Mine']).toBe('1');
    expect(seen.headers.Cookie).toBeUndefined();
    expect(seen.headers.Origin).toBeUndefined();
  });

  it('refuses a host that is not in @connect, before any request, and a redirect to one', async () => {
    const { port, hits } = await start();
    const x = createXhr({ net: shimNet({}), getSession: () => ({}), limits: LIMITS });
    const s = script(port);
    const allow = (u) => connectAllowed(s, u, 'https://page.org/');
    await expect(x.start({ url: `http://localhost:${port}/direct`, allow }).promise).rejects.toThrow(/not in this script/);
    expect(hits).toEqual([]);
    await expect(x.start({ url: `http://127.0.0.1:${port}/redirect-out`, allow }).promise).rejects.toThrow(/may not contact/);
    expect(hits).toEqual(['/redirect-out']);
  });

  it('refuses a body or a method it does not allow', async () => {
    const x = createXhr({ net: shimNet({}), getSession: () => ({}), limits: LIMITS });
    const allow = () => ({ ok: true });
    await expect(x.start({ url: 'http://127.0.0.1:1/', method: 'TRACE', allow }).promise).rejects.toThrow(/Method/);
    await expect(x.start({ url: 'http://127.0.0.1:1/', method: 'POST', body: 'x'.repeat(LIMITS.maxXhrBody + 1), allow }).promise).rejects.toThrow(/larger/);
  });
});
