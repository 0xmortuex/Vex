// === Parcels — where is it? ===
//
// Paste a tracking number; Vex says whose it is and opens that carrier's own
// tracking page. Keep the ones you are waiting for in a list, with a word
// about what is in each, so "which of these is the shoes" is answered.
//
// WHAT THIS IS NOT: live status. Every carrier's tracking API needs a
// business account and a key, and the services that aggregate them are paid
// and would see every parcel you get. So Vex does not fetch anything — it
// recognises the number and opens the carrier's page, where the status is.
// Nothing leaves Vex until you press Track.
//
// Recognising: formats with a check digit (UPS "1Z…", the international
// postal format "AB123456789GB") are checked, so a random string is not taken
// for a parcel. All-digit numbers are ambiguous — a FedEx number looks like
// any other twelve digits — so those are offered as "probably", and the
// carrier can be changed.

const Parcels = {
  KEY: 'vex.parcels',
  MAX: 100,

  CARRIERS: {
    ups:       { name: 'UPS',        url: (n) => 'https://www.ups.com/track?tracknum=' + n },
    usps:      { name: 'USPS',       url: (n) => 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + n },
    fedex:     { name: 'FedEx',      url: (n) => 'https://www.fedex.com/fedextrack/?trknbr=' + n },
    dhl:       { name: 'DHL',        url: (n) => 'https://www.dhl.com/global-en/home/tracking/tracking-express.html?tracking-id=' + n },
    royalmail: { name: 'Royal Mail', url: (n) => 'https://www.royalmail.com/track-your-item#/tracking-results/' + n },
    amazon:    { name: 'Amazon',     url: (n) => 'https://track.amazon.com/tracking/' + n },
    canadapost:{ name: 'Canada Post', url: (n) => 'https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=' + n },
    auspost:   { name: 'Australia Post', url: (n) => 'https://auspost.com.au/mypost/track/details/' + n },
    // A national post the list above does not cover: the independent 17TRACK
    // page, named as such, because it is a third party.
    track17:   { name: '17TRACK (independent)', url: (n) => 'https://t.17track.net/en#nums=' + n },
  },

  // Universal Postal Union S10: two letters, eight digits, a check digit, and
  // the country that sent it.
  s10Valid(num) {
    const m = /^[A-Z]{2}(\d{8})(\d)[A-Z]{2}$/.exec(num);
    if (!m) return false;
    const w = [8, 6, 4, 2, 3, 5, 9, 7];
    const sum = m[1].split('').reduce((s, d, i) => s + Number(d) * w[i], 0);
    let check = 11 - (sum % 11);
    if (check === 10) check = 0;
    else if (check === 11) check = 5;
    return check === Number(m[2]);
  },

  // UPS 1Z: the 15 characters after "1Z" and before the check digit, letters
  // mapped to digits, odd positions plus twice the even ones, mod 10.
  upsValid(num) {
    const m = /^1Z([0-9A-Z]{15})(\d)$/.exec(num);
    if (!m) return false;
    const val = (c) => (/\d/.test(c) ? Number(c) : (c.charCodeAt(0) - 63) % 10);
    let sum = 0;
    m[1].split('').forEach((c, i) => { sum += (i % 2 ? 2 : 1) * val(c); });
    return ((10 - (sum % 10)) % 10) === Number(m[2]);
  },

  // → { number, carrier, sure } or null. `sure` is false when the format is
  // shared by several carriers or has no check digit to confirm it.
  identify(text) {
    const n = String(text == null ? '' : text).toUpperCase().replace(/[\s-]/g, '');
    if (!n) return null;
    if (/^1Z[0-9A-Z]{16}$/.test(n)) return { number: n, carrier: 'ups', sure: this.upsValid(n) };
    if (/^TBA\d{12}$/.test(n)) return { number: n, carrier: 'amazon', sure: true };
    if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(n)) {
      if (!this.s10Valid(n)) return null;
      const country = n.slice(-2);
      const carrier = { US: 'usps', GB: 'royalmail', CA: 'canadapost', AU: 'auspost' }[country] || 'track17';
      return { number: n, carrier, sure: true };
    }
    if (/^9[1-5]\d{18,20}$/.test(n)) return { number: n, carrier: 'usps', sure: true };
    if (/^JJD\d{18}$|^JVGL\d{16}$/.test(n)) return { number: n, carrier: 'dhl', sure: true };
    if (/^\d{12}$|^\d{15}$/.test(n)) return { number: n, carrier: 'fedex', sure: false };
    if (/^\d{10}$/.test(n)) return { number: n, carrier: 'dhl', sure: false };
    return null;
  },

  trackUrl(p) {
    const c = this.CARRIERS[p.carrier];
    if (!c) throw new Error('No tracking page for ' + p.carrier);
    return c.url(encodeURIComponent(p.number));
  },

  // --- the list ------------------------------------------------------------------
  list() {
    let a;
    try { a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); }
    catch (err) { throw new Error('Your parcels could not be read', { cause: err }); }
    return Array.isArray(a) ? a.filter(p => p && typeof p.number === 'string' && this.CARRIERS[p.carrier]) : [];
  },
  _save(items) { localStorage.setItem(this.KEY, JSON.stringify(items)); },

  add(number, { label = '', carrier } = {}) {
    const found = this.identify(number);
    if (!found && !carrier) throw new Error('That does not look like a tracking number Vex knows — pick the carrier to add it anyway');
    const num = found ? found.number : String(number).toUpperCase().replace(/[\s-]/g, '');
    if (!/^[0-9A-Z]{6,40}$/.test(num)) throw new Error('A tracking number is letters and digits only');
    const c = carrier || found.carrier;
    if (!this.CARRIERS[c]) throw new Error('Not a carrier Vex knows: ' + c);
    const items = this.list();
    if (items.some(p => p.number === num)) throw new Error(num + ' is already in your list');
    if (items.length >= this.MAX) throw new Error('That is ' + this.MAX + ' parcels — remove some that have arrived');
    const p = { number: num, carrier: c, label: String(label || '').replace(/\s+/g, ' ').trim().slice(0, 80), added: Date.now() };
    items.unshift(p);
    this._save(items);
    return p;
  },

  remove(number) {
    const items = this.list();
    const i = items.findIndex(p => p.number === number);
    if (i < 0) throw new Error('That parcel is gone');
    items.splice(i, 1);
    this._save(items);
  },

  track(p) { TabManager.createTab(this.trackUrl(p), true); },

  // --- the sheet -------------------------------------------------------------------
  open() {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { body, close } = window.PageExport._sheet('Parcels', 'vex-parcels-overlay');
    const field = 'font:inherit;font-size:13px;padding:7px 9px;border-radius:7px;border:1px solid var(--border);background:var(--surface);color:var(--text)';
    const small = 'font-size:11px;background:none;border:1px solid var(--border);border-radius:6px;padding:2px 8px;cursor:pointer;color:var(--text)';
    const carrierOptions = (sel) => Object.entries(this.CARRIERS).map(([id, c]) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

    const draw = () => {
      const items = this.list();
      body.innerHTML = `
        <form data-add style="display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border)">
          <input data-number type="text" placeholder="Tracking number" aria-label="Tracking number" autocomplete="off" spellcheck="false" style="${field};flex:1;min-width:170px;font-family:ui-monospace,monospace">
          <input data-label type="text" maxlength="80" placeholder="What is it? (optional)" aria-label="What is in it" style="${field};flex:1;min-width:120px">
          <select data-carrier aria-label="Carrier" style="${field}"><option value="">Carrier: detect</option>${carrierOptions('')}</select>
          <button type="submit" style="font:inherit;font-size:12px;padding:6px 12px;border-radius:7px;border:none;background:var(--primary);color:#fff;cursor:pointer">Add</button>
          <div data-hint style="flex-basis:100%;font-size:11px;color:var(--text-muted);min-height:14px"></div>
        </form>
        <div data-rows style="padding:4px 6px 8px">${items.length ? '' : `<div style="padding:22px 12px;text-align:center;font-size:12.5px;color:var(--text-muted)">No parcels yet. Paste a tracking number above.</div>`}</div>
        <div style="padding:8px 14px 12px;font-size:11px;color:var(--text-muted)">Track opens the carrier's own page, where the status is. Vex does not look parcels up itself — that needs an account with each carrier — so nothing is sent anywhere until you press Track.</div>`;

      const num = body.querySelector('[data-number]');
      const hint = body.querySelector('[data-hint]');
      num.addEventListener('input', () => {
        const f = this.identify(num.value);
        hint.textContent = !num.value.trim() ? '' : f ? (f.sure ? 'Looks like ' : 'Probably ') + this.CARRIERS[f.carrier].name + (f.sure ? '' : ' — the format is shared, so pick the carrier if it is not') : 'Not a format Vex recognises — pick the carrier to add it anyway';
      });

      const rows = body.querySelector('[data-rows]');
      for (const p of items) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px';
        row.innerHTML = `
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;color:var(--text)">${esc(p.label || this.CARRIERS[p.carrier].name + ' parcel')}</div>
            <div style="font-size:11px;color:var(--text-muted);font-family:ui-monospace,monospace;overflow-wrap:anywhere">${esc(p.number)} · ${esc(this.CARRIERS[p.carrier].name)}</div>
          </div>
          <button data-track type="button" style="${small}">Track</button>
          <button data-copy type="button" style="${small}">Copy</button>
          <button data-remove type="button" title="It arrived — remove it" aria-label="Remove ${esc(p.number)}" style="display:inline-flex;background:none;border:none;cursor:pointer;color:var(--text-muted);padding:3px">${VexIcons.svg('trash', { size: 13 })}</button>`;
        row.querySelector('[data-track]').addEventListener('click', () => { this.track(p); close(); });
        row.querySelector('[data-copy]').addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(p.number); window.showToast?.('Tracking number copied'); }
          catch (err) { window.showToast?.('Could not copy that: ' + ((err && err.message) || 'clipboard refused'), 'error'); }
        });
        row.querySelector('[data-remove]').addEventListener('click', () => { this.remove(p.number); draw(); });
        rows.appendChild(row);
      }

      body.querySelector('[data-add]').addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          this.add(num.value, { label: body.querySelector('[data-label]').value, carrier: body.querySelector('[data-carrier]').value || undefined });
          draw();
          body.querySelector('[data-number]').focus();
        } catch (err) { window.showToast?.(err.message, 'error'); }
      });
    };
    draw();
    return body;
  },
};

if (typeof window !== 'undefined') window.Parcels = Parcels;
if (typeof module !== 'undefined') module.exports = { Parcels };
