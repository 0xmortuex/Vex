// === Shopping comparison clip ===============================================
//
// Four tabs of the same kettle, and no way to see them next to each other.
// "Add This Product to Comparison" reads the product page in front of you —
// the structured data shops publish for search engines (schema.org Product,
// Offer, AggregateRating in JSON-LD), then product meta tags, then the words
// on the page itself — and keeps a row: name, price, rating, link, your notes.
// "Compare Saved Products" puts the rows side by side and exports them as CSV.
//
// Kept on this computer only (localStorage, never synced). Private, Tor and
// routed tabs are refused, as for price history. Nothing is fetched: only the
// page you are on is read, and only when you ask.
//
// A number that is not a clean price or rating is left empty, never guessed:
// a text fallback reads the first currency amount and the first "x out of 5"
// it finds, which is marked "from the page text" so it is checked, not trusted.
const VexShoppingClip = {
  KEY: 'vex.shoppingClips',
  MAX_CLIPS: 60,

  // Runs in the page. Plain data out; the sorting out happens in parse().
  READ_SCRIPT: `(() => {
    const meta = (p) => { const e = document.querySelector('meta[property="' + p + '"],meta[name="' + p + '"],meta[itemprop="' + p + '"]'); return e ? String(e.getAttribute('content') || '').trim() : ''; };
    const ld = [];
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      const t = s.textContent || '';
      if (t.length < 400000 && ld.length < 8) ld.push(t);
    }
    const body = document.body ? (document.body.innerText || '') : '';
    return {
      url: location.href,
      canonical: (document.querySelector('link[rel="canonical"]') || {}).href || '',
      title: document.title || '',
      ld,
      meta: {
        title: meta('og:title'), image: meta('og:image'),
        price: meta('product:price:amount') || meta('og:price:amount'),
        currency: meta('product:price:currency') || meta('og:price:currency'),
        brand: meta('product:brand') || meta('og:brand'),
      },
      text: body.slice(0, 12000),
    };
  })()`,

  // ---- reading what the page published ----
  // "1,299.00", "1.299,00", "39.99", 12 -> cents, or null.
  toCents(v) {
    let s = String(v == null ? '' : v).replace(/[^\d.,]/g, '');
    if (!/\d/.test(s)) return null;
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      const dec = Math.max(lastDot, lastComma);
      s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
    } else if (lastComma >= 0) {
      // "12,50" is a decimal comma; "1,299" is a thousands comma.
      s = /,\d{1,2}$/.test(s) && s.indexOf(',') === lastComma ? s.replace(',', '.') : s.replace(/,/g, '');
    } else if (lastDot >= 0 && s.indexOf('.') !== lastDot) {
      s = s.replace(/\./g, '');
    }
    if (!/^\d{1,9}(\.\d{1,4})?$/.test(s)) return null;
    const cents = Math.round(Number(s) * 100);
    return cents > 0 ? cents : null;
  },

  _types(n) { return [].concat(n && n['@type'] ? n['@type'] : []).map(String); },

  // Every object in the JSON-LD, flattened (arrays, @graph).
  _nodes(data, out = [], depth = 0) {
    if (!data || depth > 6 || out.length > 400) return out;
    if (Array.isArray(data)) { for (const x of data) this._nodes(x, out, depth + 1); return out; }
    if (typeof data !== 'object') return out;
    out.push(data);
    if (data['@graph']) this._nodes(data['@graph'], out, depth + 1);
    return out;
  },

  _offer(o, depth = 0) {
    if (!o || depth > 3) return null;
    if (Array.isArray(o)) { for (const x of o) { const r = this._offer(x, depth + 1); if (r) return r; } return null; }
    if (typeof o !== 'object') return null;
    const spec = o.priceSpecification && typeof o.priceSpecification === 'object' ? o.priceSpecification : {};
    const price = o.price != null ? o.price : (o.lowPrice != null ? o.lowPrice : spec.price);
    const cents = this.toCents(price);
    if (!cents) return null;
    return { cents, currency: String(o.priceCurrency || spec.priceCurrency || '') };
  },

  // payload (READ_SCRIPT) -> { name, cents, currency, rating, ratingCount, brand, image, source } or null
  parse(payload) {
    const p = (payload && typeof payload === 'object') ? payload : {};
    const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
    let found = null;
    for (const raw of (Array.isArray(p.ld) ? p.ld : [])) {
      let data;
      try { data = JSON.parse(raw); } catch { continue; }
      const node = this._nodes(data).find(n => this._types(n).includes('Product'));
      if (!node) continue;
      const off = this._offer(node.offers);
      const ag = node.aggregateRating && typeof node.aggregateRating === 'object' ? node.aggregateRating : null;
      const best = ag ? Number(ag.bestRating) || 5 : 5;
      let rating = ag ? Number(ag.ratingValue) : NaN;
      if (Number.isFinite(rating) && best !== 5 && best > 0) rating = rating / best * 5;
      const brand = node.brand && typeof node.brand === 'object' ? node.brand.name : node.brand;
      const img = [].concat(node.image || [])[0];
      found = {
        name: clean(node.name, 200),
        cents: off ? off.cents : null,
        currency: off ? off.currency : '',
        rating: Number.isFinite(rating) && rating >= 0 && rating <= 5 ? Math.round(rating * 10) / 10 : null,
        ratingCount: ag ? (Number(ag.ratingCount || ag.reviewCount) || null) : null,
        brand: clean(brand, 80),
        image: typeof img === 'string' ? img : (img && img.url) || '',
        source: 'json-ld',
      };
      break;
    }
    const m = p.meta || {};
    if (!found || found.cents == null) {
      const cents = this.toCents(m.price);
      if (cents) {
        found = { name: (found && found.name) || clean(m.title || p.title, 200), cents, currency: String(m.currency || (found && found.currency) || ''),
          rating: found ? found.rating : null, ratingCount: found ? found.ratingCount : null, brand: (found && found.brand) || clean(m.brand, 80), image: (found && found.image) || m.image || '', source: found ? found.source : 'meta' };
      }
    }
    // Last, the page's own words: marked as such.
    const text = String(p.text || '');
    if (!found || found.cents == null || found.rating == null) {
      const price = /(?:^|[^\w])(US\$|\$|£|€|¥|₹|USD|EUR|GBP)\s?(\d[\d.,]{0,11}\d|\d)/.exec(text);
      const star = /(\d(?:[.,]\d)?)\s*(?:out of|\/)\s*5\b/i.exec(text);
      const fromText = {
        cents: price ? this.toCents(price[2]) : null,
        currency: price ? ({ '$': 'USD', 'US$': 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY', '₹': 'INR' }[price[1]] || price[1]) : '',
        rating: star ? Math.round(Number(star[1].replace(',', '.')) * 10) / 10 : null,
      };
      if (fromText.rating != null && !(fromText.rating >= 0 && fromText.rating <= 5)) fromText.rating = null;
      if (fromText.cents || fromText.rating != null) {
        found = found || { name: clean(p.meta && p.meta.title || p.title, 200), cents: null, currency: '', rating: null, ratingCount: null, brand: '', image: '', source: 'text' };
        if (found.cents == null && fromText.cents) { found.cents = fromText.cents; found.currency = found.currency || fromText.currency; found.source = found.source === 'json-ld' ? 'json-ld+text' : 'text'; }
        if (found.rating == null && fromText.rating != null) { found.rating = fromText.rating; if (!/text/.test(found.source)) found.source += '+text'; }
      }
    }
    if (found && !found.name) found.name = clean(m.title || p.title, 200);
    return found && (found.cents != null || found.rating != null || found.name) ? found : null;
  },

  // The same product under tracking tags is the same product.
  keyOf(url, canonical) {
    let u;
    try { u = new URL(String(url || '')); } catch { return null; }
    if (canonical) { try { const c = new URL(canonical, u); if (c.origin === u.origin) u = c; } catch { /* keep the page address */ } }
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$|msclkid$|ref$|ref_$|tag$|mc_|_ga$|srsltid$)/i.test(k)) u.searchParams.delete(k);
    return u.href;
  },

  // ---- the table ----
  all() {
    let a;
    try { a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); }
    catch (err) { throw new Error('Your saved products could not be read', { cause: err }); }
    return Array.isArray(a) ? a.filter(c => c && typeof c === 'object' && typeof c.url === 'string') : [];
  },
  _save(list) { localStorage.setItem(this.KEY, JSON.stringify(list.slice(0, this.MAX_CLIPS))); },

  // The same product again updates the row and keeps your notes.
  add(parsed, url, canonical, now = Date.now()) {
    const key = this.keyOf(url, canonical);
    if (!key || !parsed) throw new Error('There is no product on this page to save');
    if (!/^https?:\/\//i.test(key)) throw new Error('Only web pages can be saved');
    const list = this.all();
    const i = list.findIndex(c => c.url === key);
    const old = i >= 0 ? list.splice(i, 1)[0] : null;
    let host = '';
    try { host = new URL(key).hostname.replace(/^www\./, ''); } catch { host = ''; }
    const row = {
      id: old ? old.id : 'sc_' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      url: key, host, name: parsed.name || host, cents: parsed.cents, currency: /^[A-Za-z]{3}$/.test(parsed.currency || '') ? parsed.currency.toUpperCase() : '',
      rating: parsed.rating, ratingCount: parsed.ratingCount, brand: parsed.brand || '', source: parsed.source,
      notes: old ? old.notes : '', at: now,
    };
    list.unshift(row);
    this._save(list);
    return row;
  },

  setNotes(id, notes) {
    const list = this.all();
    const c = list.find(x => x.id === id);
    if (!c) throw new Error('That product is not in the list any more');
    c.notes = String(notes == null ? '' : notes).slice(0, 500);
    this._save(list);
    return c;
  },

  remove(id) {
    const list = this.all();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    const [gone] = list.splice(i, 1);
    this._save(list);
    return gone;
  },
  clear() { localStorage.removeItem(this.KEY); },

  format(c) {
    if (c.cents == null) return '';
    if (c.currency) { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c.currency }).format(c.cents / 100); } catch { /* an unknown code: plain below */ } }
    return (c.cents / 100).toFixed(2) + (c.currency ? ' ' + c.currency : '');
  },

  // RFC 4180, and a cell that starts with = + - @ is made text so a
  // spreadsheet does not run it as a formula.
  toCsv(list) {
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const head = ['Name', 'Price', 'Currency', 'Rating (of 5)', 'Reviews', 'Store', 'Link', 'Notes', 'Saved'];
    const rows = list.map(c => [c.name, c.cents == null ? '' : (c.cents / 100).toFixed(2), c.currency, c.rating == null ? '' : c.rating,
      c.ratingCount == null ? '' : c.ratingCount, c.host, c.url, c.notes, new Date(c.at).toISOString().slice(0, 10)]);
    return [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  },

  // The cheapest and the best rated, for highlighting.
  best(list) {
    const priced = list.filter(c => c.cents != null);
    const rated = list.filter(c => c.rating != null);
    return {
      price: priced.length > 1 ? Math.min(...priced.map(c => c.cents)) : null,
      rating: rated.length > 1 ? Math.max(...rated.map(c => c.rating)) : null,
    };
  },

  // ---- from the page in front ----
  async clipActive() {
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null;
    if (!wv) throw new Error('Open a product page first');
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) throw new Error('A private or Tor tab is not read, so nothing is saved from it');
    if (typeof WebviewManager.scriptsOffIn === 'function' && WebviewManager.scriptsOffIn(wv)) throw new Error('JavaScript is off for this site, so Vex cannot read the page');
    const payload = await window.vexGuestEval(wv, this.READ_SCRIPT);
    const parsed = this.parse(payload);
    if (!parsed || (parsed.cents == null && parsed.rating == null)) throw new Error('This page does not show a price or a rating Vex can read');
    const row = this.add(parsed, payload.url, payload.canonical);
    return row;
  },

  // ---- the side-by-side sheet ----
  open() {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { head, body, close } = window.PageExport._sheet('Compare products', 'vex-shop-overlay');
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    head.insertAdjacentHTML('beforeend', `
      <button data-csv type="button" style="${btn}">Export CSV</button>
      <button data-clear type="button" style="${btn}">Clear all</button>
      <button data-close type="button" style="${btn}">Close</button>`);
    head.querySelector('[data-close]').addEventListener('click', close);
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const draw = () => {
      let list;
      try { list = this.all(); } catch (err) { body.textContent = err.message; return; }
      if (!list.length) {
        body.innerHTML = '<div style="padding:14px;font-size:12.5px;color:var(--text-muted)">Nothing saved yet. On a product page, press Ctrl+K and choose &ldquo;Add This Product to Comparison&rdquo;.</div>';
        return;
      }
      const best = this.best(list);
      const row = (label, cellFn) => `<tr><th scope="row" style="text-align:left;font-weight:600;color:var(--text-muted);padding:6px 8px;white-space:nowrap;vertical-align:top">${label}</th>${list.map(c => `<td style="padding:6px 8px;vertical-align:top;border-left:1px solid var(--border)">${cellFn(c)}</td>`).join('')}</tr>`;
      body.innerHTML = `<div style="overflow:auto;padding:6px"><table style="border-collapse:collapse;font-size:12.5px;color:var(--text);min-width:100%">
        <thead><tr><th></th>${list.map(c => `<th style="text-align:left;padding:6px 8px;vertical-align:top;border-left:1px solid var(--border);max-width:220px"><div style="font-weight:650">${esc(c.name)}</div><div style="font-size:10.5px;color:var(--text-muted);font-weight:400">${esc(c.host)}</div></th>`).join('')}</tr></thead>
        <tbody>
        ${row('Price', c => { const t = this.format(c); return t ? `<b style="color:${c.cents === best.price ? 'var(--primary)' : 'var(--text)'}">${esc(t)}</b>${c.cents === best.price ? ' <span style="font-size:10.5px;color:var(--text-muted)">lowest</span>' : ''}` : '<span style="color:var(--text-muted)">not shown</span>'; })}
        ${row('Rating', c => c.rating == null ? '<span style="color:var(--text-muted)">not shown</span>' : `<b style="color:${c.rating === best.rating ? 'var(--primary)' : 'var(--text)'}">${esc(c.rating)}</b> / 5${c.ratingCount ? ` <span style="font-size:10.5px;color:var(--text-muted)">${esc(Number(c.ratingCount).toLocaleString())} ratings</span>` : ''}`)}
        ${row('Read from', c => `<span style="font-size:11px;color:var(--text-muted)">${c.source === 'json-ld' ? 'the shop’s product data' : /text/.test(c.source) ? 'the page text — check it' : 'the page’s tags'}</span>`)}
        ${row('Notes', c => `<textarea data-notes="${esc(c.id)}" rows="2" maxlength="500" aria-label="Notes on ${esc(c.name)}" style="width:100%;box-sizing:border-box;font:inherit;font-size:12px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:4px 6px;resize:vertical">${esc(c.notes)}</textarea>`)}
        ${row('', c => `<button data-open="${esc(c.id)}" type="button" style="${btn}">Open</button> <button data-del="${esc(c.id)}" type="button" style="${btn}">Remove</button>`)}
        </tbody></table></div>
        <div style="padding:0 14px 12px;font-size:11px;color:var(--text-muted)">Saved on this computer only, from product pages you chose. The lowest price and the best rating are marked once there are two to compare.</div>`;
      body.querySelectorAll('[data-notes]').forEach(t => t.addEventListener('change', () => { try { this.setNotes(t.dataset.notes, t.value); } catch (err) { fail(err); } }));
      body.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
        const c = list.find(x => x.id === b.dataset.open);
        if (c) { TabManager.createTab(c.url, true); close(); }
      }));
      body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        try {
          const gone = this.remove(b.dataset.del);
          draw();
          if (gone && window.VexUndo) window.VexUndo.offer({ message: 'Removed ' + gone.name, undo: () => { try { const l = this.all(); l.unshift(gone); this._save(l); if (body.isConnected) draw(); } catch (err) { fail(err); } } });
        } catch (err) { fail(err); }
      }));
    };
    head.querySelector('[data-csv]').addEventListener('click', () => {
      try {
        const list = this.all();
        if (!list.length) throw new Error('Nothing to export yet');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + this.toCsv(list)], { type: 'text/csv' }));
        a.download = 'vex-product-comparison-' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch (err) { fail(err); }
    });
    head.querySelector('[data-clear]').addEventListener('click', async () => {
      try {
        const before = this.all();
        if (!before.length) return;
        if (!(await window.vexConfirm({ title: 'Clear the comparison?', message: before.length + ' saved product' + (before.length === 1 ? '' : 's') + ' and your notes on them will be removed.', okLabel: 'Clear', danger: true }))) return;
        this.clear();
        draw();
      } catch (err) { fail(err); }
    });
    draw();
    return body;
  },

  buildSettings(body) {
    const G = window.VexSettingsGroup;
    let n = 0;
    try { n = this.all().length; } catch (err) { body.append(G.note(err.message)); }
    body.append(G.note(n + ' product' + (n === 1 ? '' : 's') + ' saved. Add one from a product page with Ctrl+K › Add This Product to Comparison.'));
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px';
    row.append(
      G.button('Compare saved products', () => { try { this.open(); } catch (err) { window.showToast?.(err.message, 'error'); } }),
      G.button('Clear all', async () => {
        try {
          if (!n) return;
          if (!(await window.vexConfirm({ title: 'Clear the comparison?', message: 'Every saved product and your notes on them will be removed.', okLabel: 'Clear', danger: true }))) return;
          this.clear();
          G.refresh('settings-shopping');
        } catch (err) { window.showToast?.(err.message, 'error'); }
      }, 'danger'));
    body.append(row);
  },

  mount() {
    if (window.VexSettingsGroup) {
      window.VexSettingsGroup.add({ id: 'settings-shopping', title: 'Shopping comparison', info: 'Products you saved from their pages — price, rating, link and your notes — side by side, and as a CSV.', build: (body) => this.buildSettings(body) });
    }
    if (typeof CommandBar !== 'undefined' && CommandBar.commands && !CommandBar.commands.some(c => c.id === 'shop-clip')) {
      CommandBar.commands.push(
        { id: 'shop-clip', label: 'Add This Product to Comparison', hint: 'Saves the product page you are on — price, rating, link — into a small table to compare', icon: 'tag',
          action: async () => {
            try {
              const r = await this.clipActive();
              window.showToast?.('Saved ' + r.name + (r.cents != null ? ' — ' + this.format(r) : ''), 'success', 5000, { action: { label: 'Compare', title: 'Open the comparison', run: () => { try { this.open(); } catch (err) { window.showToast?.(err.message, 'error'); } } } });
            } catch (err) { window.showToast?.(err.message, 'error'); }
          } },
        { id: 'shop-compare', label: 'Compare Saved Products', hint: 'The products you saved, side by side: price, rating, your notes — export as CSV', icon: 'split',
          action: () => { try { this.open(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
      );
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexShoppingClip = VexShoppingClip;
  if (typeof document !== 'undefined' && document.getElementById('command-overlay')) VexShoppingClip.mount();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexShoppingClip };
