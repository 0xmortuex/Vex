// Wave 4 fold-ins for the safe-by-default web layer (src/main/web-safety*.js,
// src/main/safe-web-extras.js, src/main/extension-audit.js): the Turkey-specific
// brand list, the "why is this site asking" line, downloads that explain
// themselves, the third-party count and the session-binding row.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ws = require('../../src/main/web-safety.js');
const { BRANDS, TR_BRANDS } = require('../../src/main/web-safety-brands.js');
const extras = require('../../src/main/safe-web-extras.js');
const { sessionSites, auditOne } = require('../../src/main/extension-audit.js');

const { analyzeHost, assessPermission, registrable, reasonFor } = ws;

describe('Turkey-specific brand list', () => {
  it('carries the official, bank, cargo and shopping names the task named', () => {
    for (const d of ['turkiye.gov.tr', 'osym.gov.tr', 'meb.gov.tr', 'ptt.gov.tr', 'yurticikargo.com', 'hepsiburada.com', 'trendyol.com', 'ziraatbank.com.tr', 'isbank.com.tr', 'garantibbva.com.tr', 'yapikredi.com.tr', 'akbank.com']) {
      expect(BRANDS, d).toContain(d);
    }
  });
  it('every entry is lower case and its own registrable domain (the .gov.tr and .com.tr suffixes are known)', () => {
    for (const b of TR_BRANDS) {
      expect(b, b).toBe(b.toLowerCase());
      expect(registrable(b), b).toBe(b);
    }
    expect(registrable('e-okul.meb.gov.tr')).toBe('meb.gov.tr');
    expect(registrable('login.turkiye.gov.tr')).toBe('turkiye.gov.tr');
    expect(registrable('www.ziraatbank.com.tr')).toBe('ziraatbank.com.tr');
  });
  it('never flags a real subdomain or the site itself', () => {
    for (const h of ['turkiye.gov.tr', 'giris.turkiye.gov.tr', 'e-okul.meb.gov.tr', 'ais.osym.gov.tr', 'gonderitakip.ptt.gov.tr', 'internetsube.isbank.com.tr', 'www.trendyol.com', 'seller.hepsiburada.com']) {
      expect(analyzeHost(h, { sensitivity: 'strict' }).flagged, h).toBe(false);
    }
  });
  it('flags the copies a phishing page would use', () => {
    const copies = {
      'trendyoI.com': 'lookalike',                               // capital I for l
      'hepsibur4da.com': 'lookalike',                            // digit for a letter
      'z1raatbank.com.tr': 'lookalike',
      'turkiye.gov.tr.giris-yap.xyz': 'subdomain',               // the real name in front of someone else's
      'ziraatbank.com.tr.odeme-kargo.top': 'subdomain',
      'yurticikargo.com.paket-takip.click': 'subdomain',
    };
    for (const [h, kind] of Object.entries(copies)) {
      const r = analyzeHost(h, { sensitivity: 'standard' });
      expect(r.flagged, h).toBe(true);
      expect(r.kind, h).toBe(kind);
    }
  });
  it('does not touch the existing brands or add two names that read the same', () => {
    expect(new Set(BRANDS).size).toBe(BRANDS.length);
    expect(BRANDS).toContain('paypal.com');
  });
});

describe('"why is this site asking"', () => {
  it('gives a plain reason for each sensitive permission', () => {
    for (const p of ['camera', 'microphone', 'media', 'geolocation', 'notifications', 'clipboard-read', 'display-capture', 'midi', 'midiSysex']) {
      const r = assessPermission({ permission: p, origin: 'https://example.org', topOrigin: 'https://example.org', gesture: true }, {});
      expect(r.show, p).toBe(true);
      expect(r.reason.length, p).toBeGreaterThan(20);
    }
  });
  it('says when the request fits the kind of site, and says nothing more otherwise', () => {
    expect(reasonFor('camera', 'meet.google.com')).toMatchObject({ fits: true });
    expect(reasonFor('camera', 'meet.google.com').text).toMatch(/calling site/);
    expect(reasonFor('camera', 'example.org')).toMatchObject({ fits: false });
    expect(reasonFor('geolocation', 'maps.google.com').fits).toBe(true);
    expect(reasonFor('notifications', 'example.org').text).toMatch(/Most sites work fine without/);
    expect(reasonFor('not-a-permission', 'x.org')).toEqual({ text: '', fits: false });
  });
  it('is silent when web safety is off, and for a site the person trusts', () => {
    const q = { permission: 'camera', origin: 'https://example.org', gesture: true };
    expect(assessPermission(q, { sensitivity: 'off' }).reason).toBeUndefined();
    expect(assessPermission(q, { allow: ['example.org'] }).show).toBe(false);
  });
  it('is not a warning: the level stays normal for an honest request', () => {
    const r = assessPermission({ permission: 'microphone', origin: 'https://meet.google.com', topOrigin: 'https://meet.google.com', gesture: true }, {});
    expect(r.level).toBe('normal');
    expect(r.summary).toBe('');
    expect(r.reasonFits).toBe(true);
  });
});

describe('downloads that explain themselves', () => {
  it('names the host, the real kind, the size and what to open it with', () => {
    const d = extras.describeDownload({ url: 'https://files.example.org/a/report.pdf', pageUrl: 'https://example.org/page', fileName: 'report.pdf', mime: 'application/pdf', receivedBytes: 1536 * 1024 });
    expect(d.host).toBe('files.example.org');
    expect(d.kind).toBe('document');
    expect(d.size).toBe('1.5 MB');
    expect(d.openWith).toMatch(/PDF/);
    expect(d.mismatch).toBe('');
    expect(d.lines[0]).toBe('report.pdf is a PDF document, 1.5 MB, from files.example.org.');
    expect(d.lines.join('\n')).not.toMatch(/You were on/);   // the same site: nothing extra to say
  });
  it('says when the file came from another site than the page', () => {
    const d = extras.describeDownload({ url: 'https://cdn.other.net/x.zip', pageUrl: 'https://example.org/', fileName: 'x.zip', mime: 'application/zip', totalBytes: 2048 });
    expect(d.lines.join('\n')).toMatch(/You were on example\.org, but the file came from cdn\.other\.net/);
    expect(d.care).toMatch(/Look inside/);
  });
  it('warns that a program runs the moment it is opened, and a script should be read first', () => {
    expect(extras.describeDownload({ url: 'https://x.org/a.exe', fileName: 'a.exe' }).care).toMatch(/publisher/);
    expect(extras.describeDownload({ url: 'https://x.org/a.ps1', fileName: 'a.ps1' }).care).toMatch(/read it first/);
  });
  it('catches a server that calls a program a picture, and a "picture" that is a program', () => {
    expect(extras.describeDownload({ url: 'https://x.org/cat.jpg', fileName: 'cat.jpg', mime: 'application/x-msdownload' }).mismatch).toMatch(/says this is a program/);
    expect(extras.describeDownload({ url: 'https://x.org/cat.png', fileName: 'cat.png', mime: 'application/pdf' }).mismatch).toMatch(/does not fit/);
    expect(extras.describeDownload({ url: 'https://x.org/cat.png', fileName: 'cat.png', mime: 'application/octet-stream' }).mismatch).toBe('');
  });
  it('copes with a blob address and no ending', () => {
    const d = extras.describeDownload({ url: 'blob:https://x.org/1234', fileName: 'download' });
    expect(d.host).toBe('');
    expect(d.type).toBe('a file with no ending');
  });
  it('hashes a finished file on this computer, and refuses a folder or a file over the cap', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-hash-'));
    try {
      const f = path.join(dir, 'a.bin');
      fs.writeFileSync(f, 'hello vex');
      const h = await extras.hashFile(f);
      expect(h.sha256).toBe(crypto.createHash('sha256').update('hello vex').digest('hex'));
      expect(h.bytes).toBe(9);
      expect(await extras.hashFile(f, { maxBytes: 4 })).toMatchObject({ skipped: expect.stringMatching(/did not read/) });
      await expect(extras.hashFile(dir)).rejects.toThrow(/not a file/);
      await expect(extras.hashFile(path.join(dir, 'missing'))).rejects.toThrow();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('third-party storage count', () => {
  const cookies = [
    { domain: '.example.org', name: 'sid', value: 'SECRET' },
    { domain: '.tracker.net', name: 'a' }, { domain: 'ads.tracker.net', name: 'b' },
    { domain: '.cdn.other.com', name: 'c' },
    { domain: '.unrelated.io', name: 'd' },
  ];
  it('counts the sites the page talked to that keep cookies, never the page itself', () => {
    const r = extras.thirdPartyCounts({ cookies, contacted: ['example.org', 'www.example.org', 'static.tracker.net', 'ads.tracker.net', 'cdn.other.com', 'quiet.example.net'], site: 'www.example.org' });
    expect(r.contacted).toBe(3);          // tracker.net, other.com, example.net
    expect(r.withCookies).toBe(2);
    expect(r.cookies).toBe(3);
    expect(r.domains[0]).toEqual({ domain: 'tracker.net', cookies: 2 });
  });
  it('reports only domains and counts, never a name or a value', () => {
    const r = extras.thirdPartyCounts({ cookies, contacted: ['tracker.net'], site: 'example.org' });
    expect(JSON.stringify(r)).not.toMatch(/SECRET|sid/);
  });
  it('is empty for a page that loads nothing else', () => {
    expect(extras.thirdPartyCounts({ cookies, contacted: [], site: 'example.org' })).toEqual({ contacted: 0, withCookies: 0, cookies: 0, domains: [] });
  });
});

describe('session-binding row in the extension audit', () => {
  it('lists an extension that names discord.com or roblox.com', () => {
    const r = sessionSites({ host_permissions: ['https://*.discord.com/*', 'https://www.roblox.com/*'], permissions: ['cookies'] });
    expect(r.map(x => x.site)).toEqual(['Discord', 'Roblox']);
    expect(r[0].how).toBe('named');
    expect(r[0].says).toMatch(/cookies, which include the sign-in/);
  });
  it('lists a content-script match too, and the v2 permissions list', () => {
    expect(sessionSites({ content_scripts: [{ matches: ['https://discord.com/channels/*'] }] }).map(x => x.site)).toEqual(['Discord']);
    expect(sessionSites({ permissions: ['https://*.roblox.com/*'] }).map(x => x.site)).toEqual(['Roblox']);
  });
  it('an all-pages extension is listed only when it can also read cookies', () => {
    expect(sessionSites({ host_permissions: ['<all_urls>'] })).toEqual([]);
    const r = sessionSites({ host_permissions: ['<all_urls>'], permissions: ['cookies'] });
    expect(r.map(x => x.how)).toEqual(['all', 'all']);
  });
  it('does not match a lookalike name, and ignores an unrelated list', () => {
    expect(sessionSites({ host_permissions: ['https://notdiscord.com/*', 'https://discord.com.evil.example/*', 'https://example.org/*'] })).toEqual([]);
    expect(sessionSites({})).toEqual([]);
  });
  it('raises the extension up the list', () => {
    const plain = auditOne({ manifest: { host_permissions: ['https://example.org/*'] } });
    const bound = auditOne({ manifest: { host_permissions: ['https://discord.com/*'] } });
    expect(bound.sessions).toHaveLength(1);
    expect(plain.sessions).toEqual([]);
    expect(bound.weight).toBeGreaterThan(plain.weight);
  });
});
