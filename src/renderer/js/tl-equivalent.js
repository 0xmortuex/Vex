// === TL equivalent of a price on a page =======================================
//
// A price in dollars or euros on a shop page is hard to feel in lira. Select the
// price and run Ctrl+K › TL equivalent of the selection: a small card says what it
// comes to in lira, at which rate, from which day. It is labelled approximate on
// purpose: it is a reference rate, not what your bank or card will charge.
//
// Where the rate comes from, in order of how it got here:
//   - "Fetch today's rates": one request to the Central Bank of Turkey's daily
//     table (tcmb.gov.tr/kurlar/today.xml) through Vex's own network layer, only
//     when you press the button. It is listed in "what left this computer".
//   - "Set a rate by hand": a number you type, stored with today's date.
// No rate is bundled: a number frozen into the app would be wrong within days and
// would look just as sure of itself. With no rate yet, the card says so and offers
// the two buttons above. A rate older than 3 days is marked as old.
//
// Vex reads only the text you selected (at most 400 characters) and never a form
// field. The conversion uses the bank's "döviz satış" (selling) rate.
//
//   VexTl.parsePrices(text)             pure: [{ amount, currency, raw }] for non-lira prices
//   VexTl.toNumber(str)                 pure: "1.299,90" and "1,299.90" are both 1299.9
//   VexTl.convert(price, rates)         pure: lira

const VexTl = {
  KEY: 'vex.tl.rates',
  PREF: 'vex.tl.enabled',   // 'off' hides the command
  STALE_DAYS: 3,
  MAX_SELECTION: 400,
  SYMBOLS: { '$': 'USD', '€': 'EUR', '£': 'GBP', 'USD': 'USD', 'EUR': 'EUR', 'GBP': 'GBP', 'CHF': 'CHF', 'JPY': 'JPY', '¥': 'JPY', 'CAD': 'CAD', 'AUD': 'AUD', 'SEK': 'SEK', 'NOK': 'NOK', 'DKK': 'DKK' },
  CODES: ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'SAR', 'AED'],

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    if (!on) this.hideCard();
    return !!on;
  },

  // ---- pure ----------------------------------------------------------------------------
  toNumber(str) {
    const s = String(str == null ? '' : str).replace(/[\s ]/g, '');
    if (!/^\d[\d.,]*$/.test(s)) throw new Error('"' + str + '" is not an amount');
    const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    let whole = s, frac = '';
    if (lastSep >= 0) {
      const tail = s.length - lastSep - 1;
      // One or two digits after the last separator are decimals; three are thousands.
      if (tail > 0 && tail <= 2) { whole = s.slice(0, lastSep); frac = s.slice(lastSep + 1); }
    }
    whole = whole.replace(/[.,]/g, '');
    const n = Number(whole + (frac ? '.' + frac : ''));
    if (!Number.isFinite(n)) throw new Error('"' + str + '" is not an amount');
    return n;
  },
  parsePrices(text) {
    const src = String(text == null ? '' : text).slice(0, this.MAX_SELECTION);
    const num = '\\d{1,3}(?:[.,\\s\\u00a0]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';
    const cur = 'USD|EUR|GBP|CHF|JPY|CAD|AUD|SEK|NOK|DKK|\\$|€|£|¥';
    const out = [];
    for (const m of src.matchAll(new RegExp('(' + cur + ')\\s?(' + num + ')', 'g'))) out.push({ sym: m[1], n: m[2], raw: m[0], at: m.index });
    for (const m of src.matchAll(new RegExp('(' + num + ')\\s?(' + cur + ')\\b', 'g'))) out.push({ sym: m[2], n: m[1], raw: m[0], at: m.index });
    const seen = new Set();
    const prices = [];
    for (const o of out.sort((a, b) => a.at - b.at)) {
      let amount;
      try { amount = this.toNumber(o.n); } catch { continue; }
      const key = o.at + ':' + o.raw;
      if (seen.has(key) || !(amount > 0)) continue;
      seen.add(key);
      prices.push({ amount, currency: this.SYMBOLS[o.sym], raw: o.raw.trim() });
    }
    return prices.slice(0, 5);
  },
  convert(price, rates) {
    const r = rates && rates.rates && rates.rates[price.currency];
    if (!r || !(r.selling > 0)) throw new Error('There is no ' + price.currency + ' rate yet');
    return price.amount * r.selling;
  },
  fmtTl(n) { return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n); },
  ageDays(rates, now = Date.now()) {
    const d = new Date(rates.date + 'T00:00');
    return Math.max(0, Math.floor((now - d.getTime()) / 86400000));
  },

  // ---- rates ---------------------------------------------------------------------------
  rates() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return null;
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('Your saved rates could not be read: ' + err.message); }
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v.date || '') || typeof v.rates !== 'object') throw new Error('Your saved rates are in a shape this version does not know');
    return v;
  },
  _save(r) {
    try { localStorage.setItem(this.KEY, JSON.stringify(r)); }
    catch (err) { throw new Error('The rates could not be saved: ' + err.message); }
  },
  setManual(currency, selling, now = new Date()) {
    if (!this.CODES.includes(currency)) throw new Error('Unknown currency: ' + currency);
    const n = this.toNumber(selling);
    if (!(n > 0) || n > 100000) throw new Error('That rate does not look right');
    const cur = this.rates();
    const rates = cur && cur.source === 'manual' ? cur : { date: '', source: 'manual', rates: {} };
    rates.date = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    rates.source = 'manual';
    rates.rates[currency] = { buying: n, selling: n };
    this._save(rates);
    return rates;
  },
  async fetchToday() {
    if (!window.vex || typeof window.vex.fxTcmb !== 'function') throw new Error('Fetching rates is not available here');
    const r = await window.vex.fxTcmb();
    if (!r || !r.rates || !r.rates.USD || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) throw new Error('The bank gave no usable rates');
    this._save({ date: r.date, source: 'TCMB', fetchedAt: r.fetchedAt || Date.now(), rates: r.rates });
    if (typeof VexUsage !== 'undefined') VexUsage.touch('tl-equivalent');
    return r;
  },

  // ---- reading the selection ---------------------------------------------------------------
  async readSelection() {
    if (typeof WebviewManager === 'undefined') throw new Error('Pages are not loaded');
    const wv = WebviewManager.getActiveWebview?.();
    if (!wv || typeof wv.executeJavaScript !== 'function') throw new Error('Open a page first');
    const url = typeof wv.getURL === 'function' ? wv.getURL() : '';
    if (!/^https?:/i.test(url)) throw new Error('Only a web page can be read');
    const r = await Promise.race([
      wv.executeJavaScript('(function(){var a=document.activeElement;if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)){return {blocked:true};}return {blocked:false,text:String(window.getSelection()||"").slice(0,' + this.MAX_SELECTION + ')};})()'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('The page did not answer in time')), 1500)),
    ]);
    if (!r || r.blocked) throw new Error('A text box has the focus. Click on the page, select the price, then run this again.');
    if (!r.text.trim()) throw new Error('Select a price on the page first (drag over it), then run this again');
    return r.text;
  },

  // ---- the card -------------------------------------------------------------------------------
  hideCard() { document.getElementById('vex-tl-card')?.remove(); },
  showCard(prices) {
    this.hideCard();
    let rates = null, readError = '';
    try { rates = this.rates(); } catch (err) { readError = err.message; }
    const card = document.createElement('div');
    card.id = 'vex-tl-card';
    card.setAttribute('role', 'status');
    card.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9000;max-width:min(420px,92vw);padding:12px 14px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:10px;box-shadow:0 10px 30px var(--vex-shadow-color,rgba(0,0,0,0.4));font-size:13px';
    const add = (text, style) => { const d = document.createElement('div'); d.textContent = text; if (style) d.style.cssText = style; card.appendChild(d); return d; };
    if (readError) add(readError, 'color:var(--danger)');
    if (!prices.length) add('No dollar, euro or pound price in what you selected.');
    for (const p of prices) {
      if (!rates) { add(p.raw + ': no rate yet. Fetch today\'s rates, or set one by hand.'); continue; }
      try {
        const tl = this.convert(p, rates);
        add('≈ ' + this.fmtTl(tl), 'font-size:18px;font-weight:700');
        const rate = rates.rates[p.currency].selling;
        add(p.raw + ' at ' + rate.toLocaleString('tr-TR', { maximumFractionDigits: 4 }) + ' TL (' + (rates.source === 'TCMB' ? 'TCMB döviz satış' : 'rate you set') + ', ' + new Date(rates.date + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ')', 'color:var(--text-muted);font-size:12px');
      } catch (err) { add(p.raw + ': ' + err.message + '. Fetch today\'s rates, or set one by hand.'); }
    }
    add('Approximate: a reference rate, not what your card or bank will charge.', 'color:var(--text-muted);font-size:11.5px;margin-top:4px');
    if (rates && this.ageDays(rates) > this.STALE_DAYS) add('This rate is ' + this.ageDays(rates) + ' days old.', 'color:var(--danger);font-size:11.5px');
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px';
    bar.append(
      VexSettingsGroups.button('Fetch today\'s rates', async () => {
        try { await this.fetchToday(); this.showCard(prices); }
        catch (err) { window.showToast?.('Could not fetch the rates: ' + err.message, 'error', 7000); }
      }, { label: 'Fetch today\'s rates from the Central Bank of Turkey' }),
      VexSettingsGroups.button('Set a rate', async () => {
        const cur = (prices[0] && prices[0].currency) || 'USD';
        const v = await window.vexPrompt({ title: 'Set the ' + cur + ' rate', message: 'How many lira is one ' + cur + '? It is saved with today\'s date.', placeholder: '41.25', okLabel: 'Save the rate' });
        if (v == null) return;
        try { this.setManual(cur, v); this.showCard(prices); } catch (err) { window.showToast?.(err.message, 'error'); }
      }, { label: 'Set the rate by hand' }),
      VexSettingsGroups.button('Close', () => this.hideCard(), { label: 'Close the card' }),
    );
    card.appendChild(bar);
    document.body.appendChild(card);
  },

  async run() {
    if (!this.enabled()) { window.showToast?.('TL equivalent is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('tl-equivalent');
    const text = await this.readSelection();
    this.showCard(this.parsePrices(text));
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Select a price in dollars, euros or pounds and run Ctrl+K › TL equivalent of the selection. The rate is the Central Bank of Turkey\'s daily selling rate, fetched only when you press the button, or a rate you type. It is approximate.'));
    el.appendChild(VexSettingsGroups.button('Fetch today\'s rates', async () => {
      try { const r = await this.fetchToday(); window.showToast?.('Rates from ' + r.date + ' saved', 'success'); } catch (err) { window.showToast?.('Could not fetch the rates: ' + err.message, 'error', 7000); }
    }, { primary: true }));
    let r = null;
    try { r = this.rates(); } catch (err) { el.appendChild(VexSettingsGroups.note(err.message)); }
    if (r) el.appendChild(VexSettingsGroups.note('Saved: ' + (r.source === 'TCMB' ? 'TCMB' : 'by hand') + ', ' + r.date + '. USD ' + (r.rates.USD ? r.rates.USD.selling : 'none') + ', EUR ' + (r.rates.EUR ? r.rates.EUR.selling : 'none') + '.'));
    else el.appendChild(VexSettingsGroups.note('No rate saved yet.'));
  },
};

if (typeof window !== 'undefined') {
  window.VexTl = VexTl;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'tl-equivalent', title: 'TL equivalent', keywords: 'tl lira try dollar euro price convert rate tcmb currency', before: 'about', build: (el) => VexTl.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'tl-equivalent', label: 'TL equivalent of the selection', hint: 'Select a dollar, euro or pound price on a page; approximate, with the rate and its date', icon: 'coins', action: () => VexTl.run().catch(err => window.showToast?.(err.message, 'error')) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTl };
