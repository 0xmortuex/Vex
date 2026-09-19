// === Crawl this site =========================================================
//
// "Check This Page's Links" answers for one page. A site owner's question is
// bigger: across my whole site, what is broken, and where is it linked from?
// Which pages have no title, or the same title as another page, or no
// description for search results? Which are hidden from search by accident?
//
// Starting from the page you are on, Vex follows links within the same site,
// page by page, and answers that — in words, with the page that links to each
// broken one, because a dead address is only fixable where it is linked.
//
// Politely:
//   - the same site only; links elsewhere are not followed,
//   - robots.txt is obeyed, including a Crawl-delay,
//   - a few pages at a time, and at most MAX_PAGES,
//   - from an empty session (src/main/page-fetch.js): no cookies, no logins,
//   - HTML is read; anything else is only asked for its status,
//   - and it stops the moment you press Stop or close the sheet.
//
// Pages are parsed with the browser's own HTML parser, not patterns.

const SiteCrawler = {
  MAX_PAGES: 200,
  CONCURRENCY: 4,
  SLOW_MS: 3000,
  MAX_DELAY_S: 10,
  MAX_REFERRERS: 5,

  // --- robots.txt --------------------------------------------------------------
  // The group for us: one naming "vex" if there is one, otherwise "*".
  parseRobots(text) {
    const groups = [];
    let cur = null, lastWasAgent = false;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, '').trim();
      const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1].toLowerCase(), val = m[2].trim();
      if (key === 'user-agent') {
        if (!lastWasAgent) { cur = { agents: [], rules: [], delay: null }; groups.push(cur); }
        cur.agents.push(val.toLowerCase());
        lastWasAgent = true;
        continue;
      }
      lastWasAgent = false;
      if (!cur) continue;
      if (key === 'allow' || key === 'disallow') cur.rules.push({ allow: key === 'allow', path: val });
      else if (key === 'crawl-delay') { const n = Number(val); if (Number.isFinite(n) && n >= 0) cur.delay = n; }
    }
    const pick = groups.find(g => g.agents.includes('vex')) || groups.find(g => g.agents.includes('*'));
    return pick ? { rules: pick.rules.filter(r => r.path || !r.allow), delay: pick.delay } : { rules: [], delay: null };
  },

  // Longest matching rule wins; on a tie, Allow. An empty Disallow allows all.
  allowedBy(robots, pathAndQuery) {
    let best = null;
    for (const r of (robots && robots.rules) || []) {
      if (!r.path) continue;                               // "Disallow:" with nothing = allow everything
      // * is any run of characters; a $ at the very end anchors the end.
      const anchored = r.path.endsWith('$');
      const body = (anchored ? r.path.slice(0, -1) : r.path).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      const re = new RegExp('^' + body + (anchored ? '$' : ''));
      if (!re.test(pathAndQuery)) continue;
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
    }
    return !best || best.allow;
  },

  // --- one page ------------------------------------------------------------------
  bare(u) { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return null; } },

  extract(html, pageUrl) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    let base = pageUrl;
    const baseEl = doc.querySelector('base[href]');
    if (baseEl) { try { base = new URL(baseEl.getAttribute('href'), pageUrl).href; } catch { /* keep the page's own */ } }
    const robots = (doc.querySelector('meta[name="robots" i]')?.getAttribute('content') || '').toLowerCase();
    const links = [];
    const seen = new Set();
    for (const a of doc.querySelectorAll('a[href]')) {
      if (/\bnofollow\b/i.test(a.getAttribute('rel') || '')) continue;
      let u;
      try { u = new URL(a.getAttribute('href'), base); } catch { continue; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      u.hash = '';
      if (!seen.has(u.href)) { seen.add(u.href); links.push(u.href); }
    }
    return {
      title: (doc.querySelector('title')?.textContent || '').replace(/\s+/g, ' ').trim(),
      description: (doc.querySelector('meta[name="description" i]')?.getAttribute('content') || '').trim(),
      h1: doc.querySelectorAll('h1').length,
      canonical: doc.querySelector('link[rel="canonical" i]')?.getAttribute('href') || '',
      noindex: /\bnoindex\b|\bnone\b/.test(robots),
      nofollow: /\bnofollow\b|\bnone\b/.test(robots),
      links,
    };
  },

  // --- the crawl -----------------------------------------------------------------
  // fetch(url, accept) → { ok, status, finalUrl, redirects, ms, contentType, text, xRobots } | { ok:false, error }
  async crawl(startUrl, { fetch, maxPages = this.MAX_PAGES, concurrency = this.CONCURRENCY, onProgress, stopped = () => false, sleep = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
    if (typeof fetch !== 'function') throw new Error('Nothing to fetch pages with');
    const start = new URL(startUrl);
    if (start.protocol !== 'http:' && start.protocol !== 'https:') throw new Error('Only a website can be crawled — open a page on it first');
    const origin = start.origin;

    let robots = { rules: [], delay: null };
    // RFC 9309: no robots.txt (4xx) means everything is allowed; one the site
    // failed to serve (5xx, or no answer) means stay out until it can.
    const rt = await fetch(origin + '/robots.txt', 'text/plain');
    if (!rt || !rt.ok) throw new Error('The site did not answer for its robots.txt (' + ((rt && rt.error) || 'no answer') + '), so it is not crawled');
    if (rt.status >= 500) throw new Error('The site failed to serve its robots.txt (' + rt.status + '), so it is not crawled until it can');
    if (rt.status >= 200 && rt.status < 300 && typeof rt.text === 'string') robots = this.parseRobots(rt.text);
    const delayMs = robots.delay ? Math.min(robots.delay, this.MAX_DELAY_S) * 1000 : 0;
    const workers = delayMs ? 1 : concurrency;              // a Crawl-delay means one at a time

    const pages = new Map();                                // url → result
    const referrers = new Map();                            // url → pages that link to it
    const queue = [];
    let blockedByRobots = 0;
    const capped = new Set();
    const consider = (url, from) => {
      const u = this.bare(url);
      if (!u || new URL(u).origin !== origin) return;
      if (from) { const r = referrers.get(u) || []; if (r.length < this.MAX_REFERRERS && !r.includes(from)) r.push(from); referrers.set(u, r); }
      if (pages.has(u) || queue.includes(u)) return;
      const p = new URL(u);
      if (!this.allowedBy(robots, p.pathname + p.search)) { pages.set(u, { url: u, robots: true }); blockedByRobots++; return; }
      if (pages.size - blockedByRobots + queue.length >= maxPages) { capped.add(u); return; }
      queue.push(u);
    };
    consider(start.href, null);

    const one = async (url) => {
      const res = { url };
      pages.set(url, res);
      const r = await fetch(url, 'text/html');
      if (!r || !r.ok) { res.error = (r && r.error) || 'failed'; return; }
      Object.assign(res, { status: r.status, finalUrl: r.finalUrl, redirects: r.redirects || [], ms: r.ms, html: typeof r.text === 'string' });
      const xNoindex = /\bnoindex\b|\bnone\b/i.test(r.xRobots || '');
      if (typeof r.text !== 'string' || r.status < 200 || r.status >= 300) { res.noindex = xNoindex; return; }
      // A redirect off the site: note where it went, follow nothing from it.
      const landed = this.bare(r.finalUrl || url);
      if (landed && new URL(landed).origin !== origin) { res.leftSite = true; return; }
      const info = this.extract(r.text, r.finalUrl || url);
      Object.assign(res, { title: info.title, description: info.description, h1: info.h1, noindex: info.noindex || xNoindex });
      if (!info.nofollow) for (const l of info.links) consider(l, url);
    };

    let active = 0;
    await new Promise((resolve) => {
      const pump = () => {
        if (stopped()) { if (!active) resolve(); return; }
        while (active < workers && queue.length && !stopped()) {
          const url = queue.shift();
          active++;
          one(url).catch(err => { const p = pages.get(url); if (p) p.error = (err && err.message) || 'failed'; })
            .then(() => (delayMs ? sleep(delayMs) : null))
            .then(() => {
              active--;
              if (onProgress) onProgress({ done: [...pages.values()].filter(p => !p.robots && (p.status || p.error)).length, queued: queue.length, max: maxPages });
              pump();
            });
        }
        if (!active && (!queue.length || stopped())) resolve();
      };
      pump();
    });

    const results = [...pages.values()].map(p => ({ ...p, linkedFrom: referrers.get(p.url) || [] }));
    return { origin, results, blockedByRobots, capped: capped.size, stopped: stopped(), delay: robots.delay };
  },

  // --- what it found ------------------------------------------------------------
  // In the order a site owner would fix them.
  findings(results) {
    const fetched = results.filter(r => !r.robots);
    const pagesOk = fetched.filter(r => r.html && r.status >= 200 && r.status < 300 && !r.leftSite);
    const byTitle = new Map();
    for (const p of pagesOk) if (p.title) { const k = p.title.toLowerCase(); byTitle.set(k, [...(byTitle.get(k) || []), p]); }
    const dupes = [...byTitle.values()].filter(g => g.length > 1);
    return [
      { id: 'broken', label: 'Broken', why: 'Gone, or the site did not answer — fix the pages that link here', items: fetched.filter(r => r.status === 404 || r.status === 410 || (r.error && !/timeout/i.test(r.error))) },
      { id: 'error', label: 'Server errors', why: 'The site failed while answering', items: fetched.filter(r => r.status >= 500) },
      { id: 'blocked', label: 'Would not answer a stranger', why: 'Needs sign-in, or a bot wall — not necessarily broken', items: fetched.filter(r => [401, 403, 429].includes(r.status)) },
      { id: 'slow', label: 'Slow', why: 'Took over ' + (this.SLOW_MS / 1000) + ' seconds, or never answered', items: fetched.filter(r => (r.error && /timeout/i.test(r.error)) || r.ms > this.SLOW_MS) },
      { id: 'noindex', label: 'Hidden from search', why: 'Asks search engines not to list it — check that is on purpose', items: fetched.filter(r => r.noindex) },
      { id: 'notitle', label: 'No title', why: 'Search results and tabs show the address instead', items: pagesOk.filter(p => !p.title) },
      { id: 'dupetitle', label: 'Same title as another page', why: 'Search results cannot tell them apart', items: dupes.flat(), groups: dupes },
      { id: 'nodesc', label: 'No description', why: 'Search engines make one up from the page', items: pagesOk.filter(p => !p.description) },
      { id: 'redirect', label: 'Linked through a redirect', why: 'Works, but the links could point straight at the final address', items: fetched.filter(r => r.redirects && r.redirects.length && r.status >= 200 && r.status < 400) },
    ];
  },

  report(run) {
    const lines = ['Site crawl: ' + run.origin, run.results.filter(r => !r.robots).length + ' pages checked' + (run.capped ? ', ' + run.capped + ' more not reached (limit ' + this.MAX_PAGES + ')' : '') + (run.blockedByRobots ? ', ' + run.blockedByRobots + ' skipped by robots.txt' : '') + (run.stopped ? ' (stopped early)' : ''), ''];
    for (const f of this.findings(run.results)) {
      if (!f.items.length) continue;
      lines.push(f.label + ' (' + f.items.length + ') — ' + f.why);
      for (const r of f.items) {
        lines.push('  ' + (r.status || r.error || '') + '  ' + r.url + (r.title && f.id === 'dupetitle' ? '  "' + r.title + '"' : '') + (r.redirects && r.redirects.length && f.id === 'redirect' ? '  -> ' + r.finalUrl : ''));
        if (f.id === 'broken' && r.linkedFrom.length) lines.push('      linked from: ' + r.linkedFrom.join(', '));
      }
      lines.push('');
    }
    return lines.join('\n').trim();
  },

  // --- the sheet -----------------------------------------------------------------
  async run() {
    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    if (!wv) throw new Error('No page is open');
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) throw new Error('A site is not crawled from a private tab — it would contact the site from your real connection');
    const startUrl = wv.getURL();
    if (!/^https?:\/\//i.test(startUrl || '')) throw new Error('Open a page on the website you want to crawl first');

    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { overlay, head, body, close } = window.PageExport._sheet('Crawl ' + new URL(startUrl).host, 'vex-crawl-overlay');
    let stop = false;
    head.insertAdjacentHTML('beforeend', `<button data-stop type="button" style="font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer">Stop</button>`);
    const stopBtn = head.querySelector('[data-stop]');
    stopBtn.addEventListener('click', () => { stop = true; stopBtn.disabled = true; stopBtn.textContent = 'Stopping…'; });
    body.innerHTML = `<div data-progress style="padding:26px 16px;text-align:center;font-size:12.5px;color:var(--text-muted)">Reading robots.txt…</div>`;

    const run = await this.crawl(startUrl, {
      fetch: (url, accept) => window.vex.crawlFetch(url, accept),
      stopped: () => stop || !overlay.isConnected,
      onProgress: ({ done, queued, max }) => {
        const el = body.querySelector('[data-progress]');
        if (el) el.textContent = `Checked ${done} page${done === 1 ? '' : 's'} of this site, ${queued} waiting (up to ${max}) — from an empty session, a few at a time…`;
      },
    });
    if (!overlay.isConnected) return null;                  // closed while crawling
    stopBtn.remove();
    this._render({ run, head, body, close, esc });
    return run;
  },

  _render({ run, head, body, close, esc }) {
    head.insertAdjacentHTML('beforeend', `<button data-copy type="button" style="font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer">Copy report</button>`);
    head.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(this.report(run)); window.showToast?.('Crawl report copied'); }
      catch (err) { window.showToast?.('Could not copy that: ' + ((err && err.message) || 'clipboard refused'), 'error'); }
    });
    const checked = run.results.filter(r => !r.robots).length;
    const found = this.findings(run.results).filter(f => f.items.length);
    const open = (url) => { TabManager.createTab(url, true); close(); };
    body.innerHTML = `
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted)">
        ${checked} page${checked === 1 ? '' : 's'} checked${run.stopped ? ' before you stopped it' : ''}${run.capped ? ` · ${run.capped} more not reached (the limit is ${this.MAX_PAGES})` : ''}${run.blockedByRobots ? ` · ${run.blockedByRobots} skipped because robots.txt asks` : ''}${run.delay ? ` · one at a time, as robots.txt asks` : ''}
      </div>
      <div data-rows style="padding:6px 6px 10px">${found.length ? '' : `<div style="padding:22px 12px;text-align:center;font-size:12.5px;color:var(--text-muted)">Nothing to fix on the pages checked.</div>`}</div>`;
    const list = body.querySelector('[data-rows]');
    for (const f of found) {
      const bad = f.id === 'broken' || f.id === 'error';
      list.insertAdjacentHTML('beforeend', `<div style="padding:10px 8px 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${bad ? 'var(--danger,#e5534b)' : 'var(--text-muted)'}">${esc(f.label)} · ${f.items.length} <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-muted)">${esc(f.why)}</span></div>`);
      for (const r of f.items.slice(0, 100)) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:5px 8px;border-radius:8px';
        const path = (() => { try { const u = new URL(r.url); return u.pathname + u.search; } catch { return r.url; } })();
        const extra = f.id === 'broken' && r.linkedFrom.length ? 'Linked from ' + r.linkedFrom.map(u => { try { return new URL(u).pathname; } catch { return u; } }).join(', ')
          : f.id === 'dupetitle' ? '“' + r.title + '”'
          : f.id === 'redirect' ? 'Ends at ' + r.finalUrl
          : f.id === 'slow' && r.ms ? (r.ms / 1000).toFixed(1) + ' s'
          : r.error || '';
        row.innerHTML = `
          <code style="flex:0 0 auto;min-width:44px;text-align:center;font-size:11px;padding:1px 5px;border-radius:5px;border:1px solid var(--border);color:${bad ? 'var(--danger,#e5534b)' : 'var(--text-muted)'}">${esc(r.status || 'failed')}</code>
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;color:var(--text);overflow-wrap:anywhere">${esc(path)}</div>
            ${extra ? `<div style="font-size:10.5px;color:var(--text-muted);overflow-wrap:anywhere">${esc(extra)}</div>` : ''}
          </div>
          <button data-open type="button" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;cursor:pointer;color:var(--text)">Open</button>
          ${f.id === 'broken' && r.linkedFrom.length ? `<button data-from type="button" title="Open the page that links here" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;cursor:pointer;color:var(--text)">Open linking page</button>` : ''}`;
        row.querySelector('[data-open]').addEventListener('click', () => open(r.url));
        row.querySelector('[data-from]')?.addEventListener('click', () => open(r.linkedFrom[0]));
        list.appendChild(row);
      }
      if (f.items.length > 100) list.insertAdjacentHTML('beforeend', `<div style="padding:4px 8px;font-size:11px;color:var(--text-muted)">…and ${f.items.length - 100} more — Copy report has them all.</div>`);
    }
  },
};

if (typeof window !== 'undefined') window.SiteCrawler = SiteCrawler;
if (typeof module !== 'undefined') module.exports = { SiteCrawler };
