// @vitest-environment jsdom
//
// Crawl a site: the same site only, robots.txt obeyed, and every problem
// reported with the page that links to it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/page-export.js');
const { SiteCrawler } = require('../../src/renderer/js/site-crawler.js');

// A tiny website: path → { status, html } (or a function of the request).
function site(pages, { robots = { status: 404 }, origin = 'https://shop.test' } = {}) {
  const asked = [];
  const fetch = vi.fn(async (url, accept) => {
    asked.push(url);
    const u = new URL(url);
    if (u.pathname === '/robots.txt') return robots.error ? { ok: false, error: robots.error } : { ok: true, status: robots.status, text: robots.text || '', finalUrl: url, redirects: [], ms: 5 };
    if (u.origin !== origin) throw new Error('crawled off the site: ' + url);
    const raw = pages[u.pathname + u.search];
    const p = typeof raw === 'string' ? { html: raw } : raw;
    if (!p) return { ok: true, status: 404, text: '<title>Not found</title>', finalUrl: url, redirects: [], ms: 5 };
    if (p.error) return { ok: false, error: p.error };
    return { ok: true, status: p.status || 200, text: p.html == null ? null : p.html, finalUrl: p.finalUrl || url, redirects: p.redirects || [], ms: p.ms || 10, xRobots: p.xRobots || '' };
  });
  return { fetch, asked };
}
const page = (title, links = [], extra = '') => `<html><head><title>${title}</title>${extra}</head><body><h1>${title}</h1>${links.map(l => `<a href="${l}">x</a>`).join('')}</body></html>`;
const withDesc = (title, links) => page(title, links, `<meta name="description" content="About ${title}">`);

describe('robots.txt', () => {
  it('uses the group for everyone, or one naming Vex', () => {
    const txt = 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\nAllow: /admin/help\nCrawl-delay: 2\n';
    const r = SiteCrawler.parseRobots(txt);
    expect(r.delay).toBe(2);
    expect(SiteCrawler.allowedBy(r, '/')).toBe(true);
    expect(SiteCrawler.allowedBy(r, '/admin/users')).toBe(false);
    expect(SiteCrawler.allowedBy(r, '/admin/help/faq')).toBe(true);            // the longer Allow wins
    const own = SiteCrawler.parseRobots(txt + '\nUser-agent: vex\nDisallow: /private\n');
    expect(SiteCrawler.allowedBy(own, '/admin')).toBe(true);
    expect(SiteCrawler.allowedBy(own, '/private/x')).toBe(false);
  });

  it('understands * and a closing $', () => {
    const r = SiteCrawler.parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /search?q=*\n');
    expect(SiteCrawler.allowedBy(r, '/files/a.pdf')).toBe(false);
    expect(SiteCrawler.allowedBy(r, '/files/a.pdf?download=1')).toBe(true);
    expect(SiteCrawler.allowedBy(r, '/search?q=shoes')).toBe(false);
    expect(SiteCrawler.allowedBy(r, '/search')).toBe(true);
  });

  it('an empty Disallow allows everything, and groups can share rules', () => {
    expect(SiteCrawler.allowedBy(SiteCrawler.parseRobots('User-agent: *\nDisallow:\n'), '/anything')).toBe(true);
    const r = SiteCrawler.parseRobots('User-agent: a\nUser-agent: *\nDisallow: /x\n');
    expect(SiteCrawler.allowedBy(r, '/x')).toBe(false);
  });
});

describe('reading a page', () => {
  it('finds its title, description, headings and links', () => {
    const info = SiteCrawler.extract(`<title> Shoes  &amp; boots </title><meta name="Description" content="All of them">
      <meta name="robots" content="noindex"><h1>a</h1><h1>b</h1>
      <a href="/a#top">1</a><a href="/a">dupe</a><a href="mailto:x@y.z">m</a><a href="b" rel="nofollow">n</a><a href="https://other.test/">o</a>`, 'https://shop.test/dir/');
    expect(info).toMatchObject({ title: 'Shoes & boots', description: 'All of them', h1: 2, noindex: true, nofollow: false });
    expect(info.links).toEqual(['https://shop.test/a', 'https://other.test/']);
  });

  it('resolves links against <base>', () => {
    expect(SiteCrawler.extract('<base href="/en/"><a href="x">1</a>', 'https://shop.test/').links).toEqual(['https://shop.test/en/x']);
  });
});

describe('the crawl', () => {
  it('follows links on the same site only, once each', async () => {
    const s = site({
      '/': withDesc('Home', ['/a', '/b', 'https://elsewhere.test/', '/a#x']),
      '/a': withDesc('A', ['/', '/b']),
      '/b': withDesc('B', []),
    });
    const run = await SiteCrawler.crawl('https://shop.test/', { fetch: s.fetch });
    expect(run.results.map(r => r.url).sort()).toEqual(['https://shop.test/', 'https://shop.test/a', 'https://shop.test/b']);
    expect(s.asked.filter(u => u === 'https://shop.test/a')).toHaveLength(1);
    expect(s.asked.some(u => u.includes('elsewhere'))).toBe(false);
  });

  it('reports a broken page with the pages that link to it', async () => {
    const s = site({ '/': withDesc('Home', ['/gone', '/a']), '/a': withDesc('A', ['/gone']) });
    const run = await SiteCrawler.crawl('https://shop.test/', { fetch: s.fetch });
    const broken = SiteCrawler.findings(run.results).find(f => f.id === 'broken').items;
    expect(broken.map(b => b.url)).toEqual(['https://shop.test/gone']);
    expect(broken[0].linkedFrom.sort()).toEqual(['https://shop.test/', 'https://shop.test/a']);
    expect(SiteCrawler.report(run)).toMatch(/linked from: https:\/\/shop\.test\//);
  });

  it('does not fetch what robots.txt forbids, and says how many it skipped', async () => {
    const s = site({ '/': withDesc('Home', ['/admin/x', '/a']), '/a': withDesc('A') }, { robots: { status: 200, text: 'User-agent: *\nDisallow: /admin' } });
    const run = await SiteCrawler.crawl('https://shop.test/', { fetch: s.fetch });
    expect(s.asked).not.toContain('https://shop.test/admin/x');
    expect(run.blockedByRobots).toBe(1);
  });

  it('will not crawl a site whose robots.txt it could not get', async () => {
    await expect(SiteCrawler.crawl('https://shop.test/', { fetch: site({}, { robots: { status: 503 } }).fetch })).rejects.toThrow(/failed to serve its robots\.txt/);
    await expect(SiteCrawler.crawl('https://shop.test/', { fetch: site({}, { robots: { error: 'timeout' } }).fetch })).rejects.toThrow(/did not answer/);
  });

  it('a Crawl-delay means one page at a time, with the wait', async () => {
    let inFlight = 0, most = 0;
    const s = site({ '/': withDesc('Home', ['/a', '/b', '/c']), '/a': withDesc('A'), '/b': withDesc('B'), '/c': withDesc('C') }, { robots: { status: 200, text: 'User-agent: *\nCrawl-delay: 1' } });
    const fetch = async (u, a) => { inFlight++; most = Math.max(most, inFlight); try { return await s.fetch(u, a); } finally { inFlight--; } };
    const sleep = vi.fn(async () => {});
    const run = await SiteCrawler.crawl('https://shop.test/', { fetch, sleep });
    expect(most).toBe(1);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(run.delay).toBe(1);
  });

  it('stops at the page limit and counts what it did not reach', async () => {
    const links = Array.from({ length: 30 }, (_, i) => '/p' + i);
    const pages = { '/': withDesc('Home', links) };
    links.forEach(l => { pages[l] = withDesc(l, ['/']); });
    const run = await SiteCrawler.crawl('https://shop.test/', { fetch: site(pages).fetch, maxPages: 10 });
    expect(run.results.filter(r => !r.robots)).toHaveLength(10);
    expect(run.capped).toBe(21);
  });

  it('stops when asked', async () => {
    let n = 0;
    const links = Array.from({ length: 20 }, (_, i) => '/p' + i);
    const pages = { '/': withDesc('Home', links) };
    links.forEach(l => { pages[l] = withDesc(l); });
    const s = site(pages);
    const run = await SiteCrawler.crawl('https://shop.test/', { fetch: async (u, a) => { n++; return s.fetch(u, a); }, stopped: () => n > 6, concurrency: 1 });
    expect(run.stopped).toBe(true);
    expect(n).toBeLessThan(10);
  });

  it('does not follow links on a page marked nofollow, or a redirect off the site', async () => {
    const s = site({
      '/': withDesc('Home', ['/nf', '/out']),
      '/nf': page('NF', ['/secret'], '<meta name="robots" content="nofollow">'),
      '/out': { html: withDesc('Out', ['/never']), finalUrl: 'https://elsewhere.test/', redirects: [{ status: 301, url: 'https://elsewhere.test/' }] },
    });
    const run = await SiteCrawler.crawl('https://shop.test/', { fetch: s.fetch });
    expect(s.asked).not.toContain('https://shop.test/secret');
    expect(s.asked).not.toContain('https://shop.test/never');
    expect(run.results.find(r => r.url === 'https://shop.test/out').leftSite).toBe(true);
  });
});

describe('what it found', () => {
  it('titles, descriptions, noindex, slow pages, redirects and server errors', async () => {
    const s = site({
      '/': withDesc('Home', ['/a', '/b', '/c', '/d', '/e', '/f']),
      '/a': withDesc('Same', []),
      '/b': page('Same', []),                                         // no description, duplicate title
      '/c': page('', []),                                             // no title
      '/d': { html: withDesc('D', []), xRobots: 'noindex' },
      '/e': { status: 500, html: '<p>oops</p>' },
      '/f': { html: withDesc('F', []), ms: 4500, redirects: [{ status: 301, url: 'https://shop.test/f/' }], finalUrl: 'https://shop.test/f/' },
    });
    const run = await SiteCrawler.crawl('https://shop.test/', { fetch: s.fetch });
    const f = Object.fromEntries(SiteCrawler.findings(run.results).map(x => [x.id, x.items.map(i => new URL(i.url).pathname)]));
    expect(f.dupetitle.sort()).toEqual(['/a', '/b']);
    expect(f.nodesc.sort()).toEqual(['/b', '/c']);
    expect(f.notitle).toEqual(['/c']);
    expect(f.noindex).toEqual(['/d']);
    expect(f.error).toEqual(['/e']);
    expect(f.slow).toEqual(['/f']);
    expect(f.redirect).toEqual(['/f']);
    expect(f.broken).toEqual([]);
  });
});

describe('the sheet', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.showToast = vi.fn();
    window.VexTabPolicy = { canReadWebview: () => true };
  });

  it('crawls from the page you are on and shows what to fix', async () => {
    const s = site({ '/': withDesc('Home', ['/gone']) });
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'https://shop.test/' }) };
    window.vex = { crawlFetch: s.fetch };
    await SiteCrawler.run();
    const o = document.querySelector('.vex-crawl-overlay');
    expect(o.textContent).toContain('2 pages checked');
    expect(o.textContent).toMatch(/Broken · 1/);
    expect(o.textContent).toContain('Linked from /');
  });

  it('refuses a private tab and a page that is not a website', async () => {
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'https://shop.test/' }) };
    window.VexTabPolicy = { canReadWebview: () => false };
    await expect(SiteCrawler.run()).rejects.toThrow(/private tab/);
    window.VexTabPolicy = { canReadWebview: () => true };
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'file:///C:/x.html' }) };
    await expect(SiteCrawler.run()).rejects.toThrow(/Open a page on the website/);
  });
});
