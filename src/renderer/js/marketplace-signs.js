// === Red-flag signs on a marketplace listing (T3-098) ===========================
//
// Trading sites such as itemsatis carry the usual scams: a price that is too good, payment
// "to my IBAN" off the site, "message me on WhatsApp", an account made last week. On a
// listing page of a site YOU list here, Vex reads the page's own text on this computer and
// shows a short checklist of five signs before you contact the seller:
//
//   price      the price on the listing is far below the other prices on the same page
//   iban       payment is asked by bank transfer / IBAN with no word of the site's own safe payment
//   off-site   the seller moves the deal to WhatsApp, Telegram, Discord or Instagram
//   new        the seller's account is new, or has no sales or reviews yet
//   hurry      pressure to decide now
//
// It says "signs", never "verdict": a seller with one sign can be honest, and a scammer with
// none can still be a scammer. Nothing is sent anywhere and nothing is stored about the page.
// Quiet by default: the card appears on its own only when at least one sign is seen, never
// on a site that is not on your list, and "Do not show on this site" takes the site off the list.
const VexMarketplaceSigns = {
  KEY: 'vex.marketSigns',            // 'off' turns it off
  HOSTS_KEY: 'vex.marketSigns.hosts', // the sites the person listed (default: itemsatis.com)
  DEFAULT_HOSTS: ['itemsatis.com'],
  MAX_TEXT: 60000,

  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? 'on' : 'off'); if (!on) this.hide(); return !!on; },

  // --- the sites -----------------------------------------------------------------------
  hosts() {
    let raw;
    try { raw = localStorage.getItem(this.HOSTS_KEY); } catch (err) { throw new Error('The list of marketplace sites could not be read: ' + err.message, { cause: err }); }
    if (raw == null) return this.DEFAULT_HOSTS.slice();
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The list of marketplace sites is damaged: ' + err.message, { cause: err }); }
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : this.DEFAULT_HOSTS.slice();
  },
  _clean(host) {
    const s = String(host || '').trim().toLowerCase();
    if (!s) return '';
    try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : 'https://' + s).hostname.replace(/^www\./, ''); } catch { return ''; }
  },
  addHost(host) {
    const h = this._clean(host);
    if (!h || !h.includes('.')) throw new Error('That is not a site name');
    const list = this.hosts().filter(x => x !== h);
    list.push(h);
    localStorage.setItem(this.HOSTS_KEY, JSON.stringify(list.slice(-100)));
    return list;
  },
  removeHost(host) {
    const h = this._clean(host);
    const list = this.hosts().filter(x => x !== h);
    localStorage.setItem(this.HOSTS_KEY, JSON.stringify(list));
    return list;
  },
  listed(url) {
    let h = '';
    try { const u = new URL(String(url)); if (!/^https?:$/.test(u.protocol)) return ''; h = u.hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
    return this.hosts().find(x => h === x || h.endsWith('.' + x)) || '';
  },

  // --- reading prices --------------------------------------------------------------------
  // "1.250,50", "1,250.50", "1250", "12,5" -> a number, or NaN.
  parseNumber(s) {
    let t = String(s || '').replace(/[^\d.,]/g, '');
    if (!t) return NaN;
    const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      const dec = lastDot > lastComma ? '.' : ',';
      t = t.replace(dec === '.' ? /,/g : /\./g, '').replace(dec, '.');
    } else if (lastComma >= 0) {
      t = /,\d{1,2}$/.test(t) && (t.match(/,/g) || []).length === 1 ? t.replace(',', '.') : t.replace(/,/g, '');
    } else if (lastDot >= 0) {
      t = /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t;
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  },
  prices(text) {
    const out = [];
    const re = /(?:(?:₺|TL|TRY|\$|€|£|USD|EUR)\s*(\d[\d.,]*)|(\d[\d.,]*)\s*(?:₺|TL\b|TRY\b|\$|€|£|USD\b|EUR\b))/g;
    let m;
    while ((m = re.exec(text)) && out.length < 400) {
      const n = this.parseNumber(m[1] || m[2]);
      if (n > 0) out.push({ n, at: m.index });
    }
    return out;
  },
  median(list) {
    const a = list.slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    const mid = a.length >> 1;
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  },

  // --- the five signs -------------------------------------------------------------------------
  // → [{ id, label, seen, why }] in a fixed order. `text` is the page's own text.
  analyze(text, now = Date.now()) {
    const t = String(text || '').slice(0, this.MAX_TEXT);
    const lower = t.toLowerCase();
    const signs = [];

    // 1. price far below the page's other prices
    const prices = this.prices(t);
    const lead = prices.find(p => p.at < 3000);
    const rest = lead ? prices.filter(p => p !== lead).map(p => p.n) : [];
    const med = this.median(rest);
    const cheap = !!lead && rest.length >= 4 && med > 0 && lead.n < med * 0.4;
    signs.push({ id: 'price', label: 'Price far below the others on this page', seen: cheap,
      why: cheap ? `The first price on the page (${lead.n}) is under 40% of the middle price of the ${rest.length} others (${Math.round(med)}). A price that low is often bait.` : 'Needs the page to show at least four other prices to compare with.' });

    // 2. bank transfer only
    const iban = /\bTR\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/i.test(t) || /\biban\b|havale|\beft\b|bank transfer|wire transfer/.test(lower);
    const safe = /güvenli ödeme|guvenli odeme|güvenli havale|emanet|escrow|kredi kart|credit card|buyer protection|alıcı koruma|platform(?:un|da| üzerinden)|satın al|sepete ekle|add to cart|buy now/.test(lower);
    signs.push({ id: 'iban', label: 'Asks for a bank transfer (IBAN) and mentions no protected payment', seen: iban && !safe,
      why: iban && !safe ? 'The page talks about IBAN or a bank transfer and nothing about the site\'s own protected payment. A transfer cannot be taken back.' : 'No IBAN request without a protected payment was seen.' });

    // 3. moves the deal off the site
    const off = /wa\.me\/|api\.whatsapp\.com|t\.me\/|discord\.gg\/|(?:whatsapp|telegram|instagram|discord|snap(?:chat)?)\s*[:\-]?\s*(?:\+?\d[\d\s]{6,}|@[\w.]{3,}|[\w.#]{3,})/.test(lower) || /(?:\+90|\b0)\s?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/.test(t);
    signs.push({ id: 'off-site', label: 'Moves the deal to WhatsApp, Telegram, Discord or a phone number', seen: off,
      why: off ? 'The listing gives a way to talk or pay outside the site. Off the site, nobody can help you if the seller disappears.' : 'No contact outside the site was seen.' });

    // 4. new or empty account
    let fresh = /yeni üye|yeni satıcı|new (?:member|seller)|\b0\s*(?:satış|satis|sales|reviews?|değerlendirme|degerlendirme|yorum)\b/.test(lower);
    const joined = /(?:üyelik|üye olma|katılma|kayıt|member since|joined|registered)\s*(?:tarihi)?\s*[:\-]?\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})/i.exec(t);
    if (joined) {
      const when = Date.UTC(Number(joined[3]), Number(joined[2]) - 1, Number(joined[1]));
      if (Number.isFinite(when) && now - when >= 0 && now - when < 30 * 86400000) fresh = true;
    }
    signs.push({ id: 'new', label: 'New account, or no sales or reviews yet', seen: fresh,
      why: fresh ? 'The seller joined recently or has nothing sold yet. Scam accounts are usually fresh.' : 'No sign of a new or empty account was seen.' });

    // 5. pressure
    const hurry = /\bacil\b|hemen (?:öde|yaz|al)|sadece bugün|son \d+ (?:adet|stok)|only today|last one|act now|right now or|hurry|şimdi yaz/.test(lower);
    signs.push({ id: 'hurry', label: 'Pushes you to decide right now', seen: hurry,
      why: hurry ? 'The listing hurries you. Honest sellers can wait for you to check.' : 'No pressure to hurry was seen.' });
    return signs;
  },

  // --- the card -----------------------------------------------------------------------------------
  _card: null,
  hide() { if (this._card) { this._card.remove(); this._card = null; } },

  _style() {
    if (typeof document === 'undefined' || document.getElementById('market-signs-style')) return;
    const st = document.createElement('style');
    st.id = 'market-signs-style';
    st.textContent = `
      #market-signs { position: absolute; right: 12px; top: 10px; z-index: 40; width: min(340px, 90%); padding: 10px 12px; font-size: 12.5px; color: var(--text); background: var(--surface, var(--bg)); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 8px 26px var(--vex-shadow-color, rgba(0,0,0,.3)); }
      #market-signs h3 { margin: 0 0 2px; font-size: 13px; font-weight: 650; }
      #market-signs .ms-sub { color: var(--text-muted); font-size: 11.5px; margin-bottom: 6px; }
      #market-signs ul { list-style: none; margin: 0; padding: 0; }
      #market-signs li { padding: 4px 0; border-top: 1px solid var(--border); }
      #market-signs li.seen .ms-label { font-weight: 650; }
      #market-signs .ms-state { float: right; color: var(--text-muted); font-size: 11.5px; }
      #market-signs li.seen .ms-state { color: var(--vex-danger, #b4232a); font-weight: 650; }
      #market-signs .ms-why { display: block; color: var(--text-muted); font-size: 11.5px; margin-top: 2px; }
      #market-signs .ms-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      #market-signs button { font-size: 12px; color: var(--text); background: none; border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; cursor: pointer; }`;
    document.head.appendChild(st);
  },

  show(signs, host) {
    this.hide();
    this._style();
    const area = document.getElementById('webviews-container') || document.getElementById('content-area');
    if (!area) throw new Error('There is no page area to show the checklist in');
    const seen = signs.filter(s => s.seen).length;
    const card = document.createElement('div');
    card.id = 'market-signs';
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', 'Signs to check before you contact this seller');
    const h = document.createElement('h3'); h.textContent = seen ? seen + (seen === 1 ? ' sign' : ' signs') + ' to check on this listing' : 'No signs seen on this listing';
    const sub = document.createElement('div'); sub.className = 'ms-sub'; sub.textContent = 'Signs, not a verdict. Read from this page on this computer; nothing is sent.';
    const ul = document.createElement('ul');
    for (const s of signs) {
      const li = document.createElement('li');
      if (s.seen) li.className = 'seen';
      const state = document.createElement('span'); state.className = 'ms-state'; state.textContent = s.seen ? 'seen' : 'not seen';
      const label = document.createElement('span'); label.className = 'ms-label'; label.textContent = s.label;
      const why = document.createElement('span'); why.className = 'ms-why'; why.textContent = s.why;
      li.append(state, label, why);
      ul.appendChild(li);
    }
    const btns = document.createElement('div'); btns.className = 'ms-btns';
    const mk = (text, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', () => { Promise.resolve().then(fn).catch(err => window.showToast?.((err && err.message) || String(err), 'error')); }); btns.appendChild(b); };
    mk('Close', () => this.hide());
    mk('Do not show on ' + host, () => { this.removeHost(host); this.hide(); window.showToast?.('Vex will not check listings on ' + host + ' any more. Settings > Safer browsing has the list.'); });
    card.append(h, sub, ul, btns);
    if (getComputedStyle(area).position === 'static') area.style.position = 'relative';
    area.appendChild(card);
    this._card = card;
    return card;
  },

  // Read the page in front and show the checklist. quiet: show only when a sign is seen (the automatic case).
  async check(tab, { quiet = true } = {}) {
    if (!tab || !/^https?:\/\//i.test(String(tab.url || ''))) throw new Error('Open a listing on a marketplace first');
    const host = this.listed(tab.url);
    if (!host) throw new Error('This site is not on your list of marketplace sites (Settings > Safer browsing)');
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tab.id) : null;
    if (!wv) throw new Error('The page is not loaded yet');
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) throw new Error('This is a private, Tor or routed tab, so Vex does not read it.');
    if (typeof PageContext === 'undefined') throw new Error('The page reader is not loaded');
    const ctx = await PageContext.extractPageContext(wv);
    if (!ctx || !ctx.text) throw new Error('This page has no readable text yet.');
    const signs = this.analyze(ctx.text);
    if (quiet && !signs.some(s => s.seen)) return { signs, shown: false };
    this.show(signs, host);
    return { signs, shown: true };
  },

  _timer: null,
  init() {
    if (this._wired || typeof document === 'undefined') return false;
    this._wired = true;
    document.addEventListener('vex:tab-settled', (e) => {
      if (!this.enabled() || typeof TabManager === 'undefined') return;
      const id = e && e.detail && e.detail.tabId;
      const tab = TabManager.tabs.find(t => t.id === id);
      if (!tab || TabManager.activeTabId !== id) return;
      let listed = '';
      try { listed = this.listed(tab.url); } catch (err) { window.VexProblems?.note('Marketplace signs', 'The list of marketplace sites could not be read', err); return; }
      if (!listed) return;
      clearTimeout(this._timer);
      // The listing fills in after the page settles.
      this._timer = setTimeout(() => this.check(tab).catch(err => window.VexProblems?.note('Marketplace signs', 'Could not check this listing', err)), 1500);
    });
    window.addEventListener('vex:tab-activated', () => this.hide());
    return true;
  },
};

if (typeof window !== 'undefined') { window.VexMarketplaceSigns = VexMarketplaceSigns; VexMarketplaceSigns.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMarketplaceSigns };
