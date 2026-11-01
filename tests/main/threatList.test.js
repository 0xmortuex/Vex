// The list of known dangerous sites (src/main/threat-list.js): parsing a list, the hashed set, parent-domain and exact-address
// matching, what is never blocked, a failed update keeping the last good list, the daily pass, the person's choices and the
// "continue anyway" log. All with a fake list and a fake fetch: nothing here touches the network.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createThreatList, parseLine, TEST_HOST } = require('../../src/main/threat-list');
const { SOURCES, validateSource } = require('../../src/main/threat-list-sources');
const pages = require('../../src/main/threat-pages');

const SRC = [{ id: 'fake', name: 'Fake list', url: 'https://lists.example/fake.txt', format: 'lines', maxBytes: 1 << 20, minEntries: 1, licence: 'MIT', licenceUrl: 'https://lists.example/LICENSE', licenceVerified: '2026-11-01' }];
const LIST = [
  '# a comment', '', 'evil-login.com', 'phish.example.org', 'bad.co.uk',
  'http://compromised.example.net/wp-content/x/login.php?id=7', 'shady.example.com/', 'sites.google.com', 'google.com', 'pages.dev',
  '%20%25**)(redacted@redacted.invalid', 'printer.local', '10.0.0.5', 'localhost.localdomain',
].join('\n');

let dir, now, calls;
const okFetch = (text) => vi.fn(async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => text }; });
const make = (opts = {}) => createThreatList({ dir, fs, path, sources: SRC, now: () => now, log: () => {}, fetch: okFetch(LIST), ...opts });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-threat-test-'));
  now = 1_800_000_000_000;
  calls = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('parseLine', () => {
  it('reads a domain, an address with a path, and a bare site address', () => {
    expect(parseLine('Evil-Login.com')).toEqual({ ns: 'd', text: 'evil-login.com' });
    expect(parseLine('http://a.example.net/x/y.php?id=7')).toEqual({ ns: 'u', text: 'a.example.net/x/y.php?id=7' });
    expect(parseLine('shady.example.com/')).toEqual({ ns: 'd', text: 'shady.example.com' });
  });
  it('skips comments, blanks, junk and bare IP addresses', () => {
    for (const s of ['# x', '', '   ', '%20%25**)(redacted@redacted.invalid', '40.70.42.104?rid=8', 'ftp://x.example.com/a', 'two words.com', 'nodots']) expect(parseLine(s), s).toBe(null);
  });
});

describe('updating and matching', () => {
  it('downloads once through the public fetch with the ledger tag, no cookies, https and a size cap', async () => {
    const t = make();
    const s = await t.update();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://lists.example/fake.txt');
    expect(calls[0].init).toMatchObject({ credentials: 'omit', maxBytes: 1 << 20, egress: { feature: 'Safety list', kind: 'fetch' } });
    expect(s.count).toBeGreaterThan(3);
    expect(s.fetchedAt).toBe(now);
    expect(s.sources[0]).toMatchObject({ id: 'fake', licence: 'MIT' });
  });

  it('matches the name, any parent name, and an exact address; nothing else', async () => {
    const t = make(); await t.update();
    expect(t.check('https://evil-login.com/')).toMatchObject({ kind: 'domain', host: 'evil-login.com' });
    expect(t.check('http://www.evil-login.com/a?b=1')).toMatchObject({ kind: 'domain', matched: 'evil-login.com' });
    expect(t.check('https://a.b.phish.example.org/')).toMatchObject({ kind: 'domain', matched: 'phish.example.org' });
    expect(t.check('https://login.bad.co.uk/')).toMatchObject({ kind: 'domain', matched: 'bad.co.uk' });
    expect(t.check('https://shady.example.com/anything')).toMatchObject({ kind: 'domain' });
    expect(t.check('https://compromised.example.net/wp-content/x/login.php?id=7')).toMatchObject({ kind: 'address' });
    // The same host with another page is not listed: only that exact address is.
    expect(t.check('https://compromised.example.net/')).toBe(null);
    expect(t.check('https://compromised.example.net/wp-content/x/login.php?id=8')).toBe(null);
    // A sibling, a name that merely ends the same way, and a parent of a listed name.
    expect(t.check('https://example.org/')).toBe(null);
    expect(t.check('https://notevil-login.com/')).toBe(null);
    expect(t.check('https://co.uk/')).toBe(null);
    expect(t.check('ftp://evil-login.com/')).toBe(null);
    expect(t.check('not a url')).toBe(null);
  });

  it('never blocks a shared platform or a big brand because the list names it', async () => {
    const t = make(); await t.update();
    for (const u of ['https://sites.google.com/view/x', 'https://docs.google.com/', 'https://www.google.com/', 'https://pages.dev/', 'https://someone.pages.dev/']) expect(t.check(u), u).toBe(null);
  });

  it('never blocks this machine, the local network or a private address, even when the list names them', async () => {
    const t = make({ fetch: okFetch(LIST + '\nlocalhost\nrouter.lan\n192.168.1.1\n127.0.0.1') }); await t.update();
    for (const u of ['http://localhost/', 'http://127.0.0.1:8080/', 'http://192.168.1.1/', 'http://10.0.0.5/', 'http://printer.local/', 'http://router.lan/', 'http://[::1]/', 'http://intranet/', 'http://172.16.4.2/', 'http://x.localhost/']) expect(t.check(u), u).toBe(null);
  });

  it('keeps no names in the saved file and reloads from disk', async () => {
    await make().update();
    const bin = fs.readFileSync(path.join(dir, 'list.bin'));
    expect(bin.toString('latin1')).not.toContain('evil-login');
    const again = make({ fetch: undefined });
    expect(again.status().count).toBeGreaterThan(3);
    expect(again.check('https://evil-login.com/')).toMatchObject({ kind: 'domain' });
    expect(again.status().bytes).toBe(again.status().count * 8);
  });

  it('holds a big list in 8 bytes an entry', async () => {
    const big = Array.from({ length: 60000 }, (_, i) => 'site' + i + '.badsites.example').join('\n');
    const t = make({ fetch: okFetch(big) });
    const s = await t.update();
    expect(s.count).toBe(60000);
    expect(s.bytes).toBe(480000);
    expect(t.check('https://site31337.badsites.example/')).toMatchObject({ kind: 'domain' });
    expect(t.check('https://site60000.badsites.example/')).toBe(null);
  });
});

describe('a failed update', () => {
  it('keeps the last good list, says why, and throws', async () => {
    const good = make(); await good.update();
    const fetch = vi.fn(async () => { throw new Error('offline'); });
    const t = make({ fetch });
    await expect(t.update()).rejects.toThrow('offline');
    expect(t.status().lastError).toBe('offline');
    expect(t.status().count).toBe(good.status().count);
    expect(t.check('https://evil-login.com/')).toMatchObject({ kind: 'domain' });
  });

  it('refuses a server error, an empty file and a list with too few usable entries', async () => {
    await make().update();
    const bad = (res) => make({ fetch: vi.fn(async () => res), sources: [{ ...SRC[0], minEntries: 5 }] });
    await expect(bad({ ok: false, status: 503, text: async () => '' }).update()).rejects.toThrow('503');
    await expect(bad({ ok: true, status: 200, text: async () => '<html>error page</html>' }).update()).rejects.toThrow(/usable entries/);
    await expect(bad({ ok: true, status: 200, text: async () => '' }).update()).rejects.toThrow(/usable entries/);
    expect(make().check('https://evil-login.com/')).toMatchObject({ kind: 'domain' });   // the file on disk is the old one
  });

  it('keeps the old list when the new file cannot be written', async () => {
    const t = make(); await t.update();
    const before = t.status().count;
    const realWrite = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation((f, ...rest) => { if (String(f).includes('list.bin')) throw new Error('disk full'); return realWrite(f, ...rest); });
    const again = make({ fetch: okFetch(LIST + '\nanother.example.com') });
    await expect(again.update()).rejects.toThrow('disk full');
    expect(again.status().count).toBe(before);
  });

  it('says so when the saved list is damaged, and does not block anything from it', () => {
    fs.writeFileSync(path.join(dir, 'list.json'), JSON.stringify({ v: 1, fetchedAt: 1, count: 3, sources: [] }));
    fs.writeFileSync(path.join(dir, 'list.bin'), Buffer.from('not a list'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = make({ log: (m) => console.error(m) });
    expect(t.status().count).toBe(0);
    expect(t.status().lastError).toMatch(/could not be read/);
    expect(t.check('https://evil-login.com/')).toBe(null);
    expect(err).toHaveBeenCalled();
  });
});

describe('the daily pass', () => {
  it('downloads when there is no list, then not again for a day, then again', async () => {
    const fetch = okFetch(LIST);
    const t = make({ fetch });
    expect(await t.maybeUpdate()).toBe(true);
    expect(await t.maybeUpdate()).toBe(false);
    now += 23 * 3600 * 1000;
    expect(await t.maybeUpdate()).toBe(false);
    now += 2 * 3600 * 1000;
    expect(await t.maybeUpdate()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failure within the hour, logs it, and never throws', async () => {
    const fetch = vi.fn(async () => { throw new Error('offline'); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = make({ fetch });
    expect(await t.maybeUpdate()).toBe(false);
    expect(await t.maybeUpdate()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    now += 3700 * 1000;
    await t.maybeUpdate();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the switch or the automatic download is off', async () => {
    const fetch = okFetch(LIST);
    const t = make({ fetch });
    t.setEnabled(false);
    expect(await t.maybeUpdate()).toBe(false);
    t.setEnabled(true); t.setAutoUpdate(false);
    expect(await t.maybeUpdate()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    await t.update();   // Update now still works by hand
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('runs one update at a time', async () => {
    const fetch = okFetch(LIST);
    const t = make({ fetch });
    await Promise.all([t.update(), t.update(), t.maybeUpdate()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('the person\'s choices', () => {
  it('the switch turns the check off and is remembered', async () => {
    const t = make(); await t.update();
    t.setEnabled(false);
    expect(t.check('https://evil-login.com/')).toBe(null);
    expect(make().status().enabled).toBe(false);
    t.setEnabled(true);
    expect(t.check('https://evil-login.com/')).not.toBe(null);
  });

  it('a trusted site (and its subdomains) is not warned about, and can be forgotten', async () => {
    const t = make(); await t.update();
    expect(t.allowHost('evil-login.com')).toBe(true);
    expect(t.check('https://evil-login.com/')).toBe(null);
    expect(t.check('https://www.evil-login.com/')).toBe(null);
    expect(make().status().allow).toEqual(['evil-login.com']);
    t.forgetHost('evil-login.com');
    expect(t.check('https://evil-login.com/')).not.toBe(null);
  });

  it('a private window\'s trust is never written', async () => {
    const t = make(); await t.update();
    expect(t.allowHost('evil-login.com', { persistent: false })).toBe(false);
    expect(t.status().allow).toEqual([]);
  });

  it('refuses something that is not a site name', () => {
    const t = make();
    expect(() => t.allowHost('not a host')).toThrow(/site name/);
    expect(() => t.forgetHost('')).toThrow(/site name/);
  });

  it('"continue anyway" is logged with the site and the time, not the page; a private window\'s stays in memory', () => {
    const t = make();
    t.logContinue('Evil-Login.com', { persistent: true, kind: 'domain' });
    t.logContinue('other.example.org', { persistent: false, kind: 'domain' });
    const log = t.continueLog();
    expect(log.map(e => e.host)).toEqual(['evil-login.com', 'other.example.org']);
    expect(log[0]).toMatchObject({ t: now, kind: 'domain' });
    expect(Object.keys(log[0]).sort()).toEqual(['host', 'kind', 'persistent', 't']);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'continues.json'), 'utf8'));
    expect(onDisk.map(e => e.host)).toEqual(['evil-login.com']);
    expect(make().continueLog().map(e => e.host)).toEqual(['evil-login.com']);
  });
});

describe('the test address', () => {
  it('is always recognised, even with an empty list and with the switch off', () => {
    const t = make();
    t.setEnabled(false);
    expect(t.check('https://' + TEST_HOST + '/')).toMatchObject({ kind: 'test', host: TEST_HOST });
    expect(t.status().testHost).toBe(TEST_HOST);
  });
});

describe('the sources table and the warning page', () => {
  it('every shipped source has an https address, a size cap and a verified licence', () => {
    expect(SOURCES.length).toBeGreaterThan(0);
    for (const s of SOURCES) expect(() => validateSource(s)).not.toThrow();
    expect(() => validateSource({ ...SOURCES[0], licenceVerified: '' })).toThrow(/no verified licence/);
    expect(() => validateSource({ ...SOURCES[0], url: 'http://x.example/l.txt' })).toThrow(/https/);
  });

  it('the page focuses Go back to safety, hides Continue behind a second click, and escapes the host', () => {
    const html = pages.threatPageHtml('https://x.example.com/"><script>', { kind: 'domain', host: 'x.example.com', matched: 'example.com' });
    expect(html).toMatch(/<a class="btn" id="vex-safe" href="https:\/\/vex-threat\.invalid\/back" autofocus>Go back to safety<\/a>/);
    expect(html).toMatch(/<details><summary id="vex-continue-open">Continue anyway<\/summary>/);
    expect(html.indexOf('<details>')).toBeLessThan(html.indexOf('id="vex-continue"'));
    expect(html).not.toContain('<script>');
    expect(html).toContain(pages.continueUrl('https://x.example.com/"><script>').replace(/&/g, '&amp;'));
  });

  it('the test page never links to a real continue address', () => {
    const html = pages.threatPageHtml('https://' + TEST_HOST + '/', { kind: 'test', host: TEST_HOST, matched: TEST_HOST });
    expect(html).not.toContain('vex-threat.invalid/continue');
    expect(html).toContain('href="#tested"');
  });
});
