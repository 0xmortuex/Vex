// === Price history — what did this cost last time? ===
//
// Price trackers are services: they crawl shops for you and, in exchange, see
// every product you look at. Vex does the part that needs no one else. Shops
// publish their price for search engines as structured data (schema.org
// Product / Offer, or the product:price meta tags); when you open a product
// page, Vex notes that price, on this computer. Come back a week later and
// "Price History" says what it cost each time you looked, and the lowest.
//
// Limits, said plainly: it knows only the prices of pages you opened, from the
// day this was switched on; it knows nothing about shops you did not visit; a
// page that does not publish its price (or builds it only in pictures) is not
// recorded. A price that is not a clean number is skipped, never guessed.
// Private and Tor tabs are never read.

const PriceHistory = {
  KEY: 'vex.priceHistory',
  ENABLED_KEY: 'vex.priceHistory.enabled',
  MAX_PRODUCTS: 200,
  MAX_POINTS: 120,
  SETTLE_MS: 1500,         // shops that build the page in script need a moment

  // Runs in the page. Returns { name, price, currency, canonical } or null.
  READ_SCRIPT: `(() => {
    const out = { canonical: (document.querySelector('link[rel="canonical"]') || {}).href || '' };
    const isProduct = (t) => t === 'Product' || (Array.isArray(t) && t.includes('Product'));
    const offerOf = (o) => {
      if (!o) return null;
      if (Array.isArray(o)) { for (const x of o) { const r = offerOf(x); if (r) return r; } return null; }
      if (typeof o !== 'object') return null;
      const price = o.price != null ? o.price : (o.lowPrice != null ? o.lowPrice : (o.priceSpecification && o.priceSpecification.price));
      const currency = o.priceCurrency || (o.priceSpecification && o.priceSpecification.priceCurrency) || '';
      return price != null ? { price: String(price), currency: String(currency) } : null;
    };
    const walk = (node, depth) => {
      if (!node || depth > 6) return null;
      if (Array.isArray(node)) { for (const x of node) { const r = walk(x, depth + 1); if (r) return r; } return null; }
      if (typeof node !== 'object') return null;
      if (isProduct(node['@type'])) { const off = offerOf(node.offers); if (off) return { name: String(node.name || ''), ...off }; }
      if (node['@graph']) return walk(node['@graph'], depth + 1);
      return null;
    };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(s.textContent); } catch (e) { continue; }
      const r = walk(data, 0);
      if (r) return { ...out, ...r };
    }
    const meta = (p) => (document.querySelector('meta[property="' + p + '"]') || {}).content || '';
    const amount = meta('product:price:amount') || meta('og:price:amount');
    if (amount) return { ...out, name: meta('og:title') || document.title, price: amount, currency: meta('product:price:currency') || meta('og:price:currency') };
    return null;
  })()`,

  enabled() { return localStorage.getItem(this.ENABLED_KEY) !== 'false'; },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); },

  // "1299.00" → 129900. Structured data uses a dot and no thousands
  // separators; anything else is skipped rather than misread.
  toCents(price) {
    const s = String(price == null ? '' : price).trim();
    if (!/^\d{1,9}(\.\d{1,4})?$/.test(s)) return null;
    const cents = Math.round(Number(s) * 100);
    return cents > 0 ? cents : null;
  },

  // The same product under tracking tags is the same product.
  keyOf(url, canonical) {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (canonical) { try { const c = new URL(canonical, u); if (c.origin === u.origin) u = c; } catch { /* keep the page address */ } }
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$|msclkid$|ref$|ref_$|tag$|mc_|_ga$|srsltid$)/i.test(k)) u.searchParams.delete(k);
    return u.href;
  },

  dayKey(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  all() {
    let a;
    try { a = JSON.parse(localStorage.getItem(this.KEY) || '{}'); }
    catch (err) { throw new Error('Your price history could not be read', { cause: err }); }
    return a && typeof a === 'object' && !Array.isArray(a) ? a : {};
  },
  _save(all) { localStorage.setItem(this.KEY, JSON.stringify(all)); },

  // One point per product per day: the latest price seen that day.
  record({ url, canonical, name, price, currency }, now = new Date()) {
    const cents = this.toCents(price);
    const key = this.keyOf(url, canonical);
    if (!cents || !key) return null;
    const cur = /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : '';
    const all = this.all();
    const e = all[key] || { name: '', currency: cur, points: [] };
    // A shop that switches currency (a different country) starts a new line
    // rather than mixing pounds and euros on one chart.
    if (e.currency && cur && e.currency !== cur) { e.points = []; }
    e.name = String(name || e.name || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    e.currency = cur || e.currency;
    const day = this.dayKey(now);
    const last = e.points[e.points.length - 1];
    if (last && last.day === day) last.cents = cents;
    else e.points.push({ day, cents });
    e.points = e.points.slice(-this.MAX_POINTS);
    e.seen = now.getTime();
    all[key] = e;
    // Keep the products looked at most recently.
    const keys = Object.keys(all);
    if (keys.length > this.MAX_PRODUCTS) {
      keys.sort((a, b) => (all[a].seen || 0) - (all[b].seen || 0)).slice(0, keys.length - this.MAX_PRODUCTS).forEach(k => delete all[k]);
    }
    this._save(all);
    return e;
  },

  summary(e) {
    const pts = e.points;
    const low = pts.reduce((m, p) => (p.cents < m.cents ? p : m), pts[0]);
    const high = pts.reduce((m, p) => (p.cents > m.cents ? p : m), pts[0]);
    const now = pts[pts.length - 1];
    return { now, low, high, first: pts[0], isLowest: now.cents <= low.cents, changes: pts.filter((p, i) => i && p.cents !== pts[i - 1].cents).length };
  },

  format(cents, currency) {
    if (currency) return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
    return (cents / 100).toFixed(2);
  },

  // --- reading pages ---------------------------------------------------------------
  attach(webview) {
    const on = (webview && webview._lifecycle) ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn) : (ev, fn) => webview.addEventListener(ev, fn);
    on('did-finish-load', () => {
      if (!this.enabled()) return;
      if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) return;
      const url = window.vexGuestUrl(webview);
      if (!/^https?:\/\//i.test(url)) return;
      setTimeout(() => {
        // Two and a half seconds is long enough for the tab to have been
        // closed, slept or navigated away, and a detached webview throws
        // rather than answering. A page that has gone is not one to read.
        if (window.vexGuestUrl(webview) !== url) return;
        window.vexGuestEval(webview, this.READ_SCRIPT)
          .then(found => { if (found) this.record({ url, ...found }); })
          // Background work on every page load: a failure is logged, not shown
          // as a toast — a page that will not answer is not one we can read.
          .catch(err => console.warn('[PriceHistory] could not read', url, (err && err.message) || err));
      }, this.SETTLE_MS);
    });
  },

  // --- the sheet -------------------------------------------------------------------
  sparkline(points, w = 520, h = 70) {
    if (points.length < 2) return '';
    const vals = points.map(p => p.cents), min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    const xy = points.map((p, i) => [Math.round(i / (points.length - 1) * (w - 8)) + 4, Math.round(h - 6 - (p.cents - min) / span * (h - 12))]);
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Price over time" style="display:block">
      <polyline fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" points="${xy.map(p => p.join(',')).join(' ')}"/>
      ${xy.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--primary)"/>`).join('')}</svg>`;
  },

  open() {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { head, body, close } = window.PageExport._sheet('Price history', 'vex-prices-overlay');
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    head.insertAdjacentHTML('beforeend', `
      <label style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--text)"><input data-enabled type="checkbox" ${this.enabled() ? 'checked' : ''}>Note prices</label>
      <button data-forget type="button" style="${btn}">Forget all</button>`);
    head.querySelector('[data-enabled]').addEventListener('change', (e) => { this.setEnabled(e.target.checked); window.showToast?.(e.target.checked ? 'Vex will note prices on product pages you open' : 'Vex will not note prices any more'); });
    head.querySelector('[data-forget]').addEventListener('click', async () => {
      const ok = await window.vexConfirm({ title: 'Forget every price?', message: 'The history of every product Vex has noted is deleted.', okLabel: 'Forget all', danger: true });
      if (!ok) return;
      localStorage.removeItem(this.KEY);
      draw();
    });

    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    const pageKey = wv ? this.keyOf(wv.getURL()) : null;

    const draw = () => {
      const all = this.all();
      // The page you are on may be stored under its canonical address.
      const hereKey = pageKey && (all[pageKey] ? pageKey : Object.keys(all).find(k => k.split('?')[0] === pageKey.split('?')[0]));
      const here = hereKey ? all[hereKey] : null;
      const others = Object.entries(all).filter(([k]) => k !== hereKey).sort((a, b) => (b[1].seen || 0) - (a[1].seen || 0)).slice(0, 40);
      let html = '';
      if (here) {
        const s = this.summary(here);
        html += `<div style="padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="font-size:13px;font-weight:650;color:var(--text)">${esc(here.name || 'This page')}</div>
          <div style="display:flex;gap:18px;flex-wrap:wrap;margin:8px 0;font-size:12px;color:var(--text-muted)">
            <div>Now <b style="font-size:16px;color:var(--text)">${esc(this.format(s.now.cents, here.currency))}</b></div>
            <div>Lowest seen <b style="color:${s.isLowest ? 'var(--primary)' : 'var(--text)'}">${esc(this.format(s.low.cents, here.currency))}</b> on ${esc(s.low.day)}</div>
            <div>Highest <b style="color:var(--text)">${esc(this.format(s.high.cents, here.currency))}</b></div>
          </div>
          ${this.sparkline(here.points)}
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:6px">${s.isLowest && here.points.length > 1 ? 'This is the lowest price you have seen here. ' : ''}Seen on ${here.points.length} day${here.points.length === 1 ? '' : 's'} since ${esc(s.first.day)}; the price changed ${s.changes} time${s.changes === 1 ? '' : 's'}.</div>
        </div>`;
      } else {
        html += `<div style="padding:14px;font-size:12.5px;color:var(--text-muted);border-bottom:1px solid var(--border)">${pageKey ? 'No price noted for this page. Vex notes the price on product pages that publish it for search engines, from the first time you open them — come back later to see it change.' : 'Open a product page to see its price history here.'}</div>`;
      }
      html += `<div style="padding:10px 14px 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted)">Other products you looked at</div><div data-rows style="padding:0 6px 10px"></div>
        <div style="padding:0 14px 12px;font-size:11px;color:var(--text-muted)">Only prices of pages you opened, noted on this computer, never in private or Tor tabs. Vex does not check shops by itself.</div>`;
      body.innerHTML = html;
      const rows = body.querySelector('[data-rows]');
      if (!others.length) rows.innerHTML = `<div style="padding:8px;font-size:12px;color:var(--text-muted)">None yet.</div>`;
      for (const [url, e] of others) {
        const s = this.summary(e);
        const diff = s.now.cents - s.first.cents;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px';
        row.innerHTML = `
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name || url)}</div>
            <div style="font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })())} · ${e.points.length} day${e.points.length === 1 ? '' : 's'}</div>
          </div>
          <div style="text-align:right;font-size:12.5px;color:var(--text)">${esc(this.format(s.now.cents, e.currency))}
            ${diff ? `<div style="font-size:10.5px;color:${diff < 0 ? 'var(--primary)' : 'var(--danger,#e5534b)'}">${diff < 0 ? 'down' : 'up'} ${esc(this.format(Math.abs(diff), e.currency))}</div>` : ''}</div>
          <button data-open type="button" style="${btn}">Open</button>`;
        row.querySelector('[data-open]').addEventListener('click', () => { TabManager.createTab(url, true); close(); });
        rows.appendChild(row);
      }
    };
    draw();
    return body;
  },
};

if (typeof window !== 'undefined') window.PriceHistory = PriceHistory;
if (typeof module !== 'undefined') module.exports = { PriceHistory };
