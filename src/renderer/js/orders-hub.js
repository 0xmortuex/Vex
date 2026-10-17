// === Orders hub: your parcels in one list ====================================
//
// T2-073. You add a parcel (the carrier, the tracking number, what it is). Vex
// keeps the list on this computer, opens the CARRIER'S OWN public tracking page
// in a tab when you press Track (the number is also copied, for pages that ask
// for it), and sets reminders you ask for: a pick-up-point hold deadline, and
// "my refund should have arrived by".
//
// What it does not do: no signing in to a carrier or a shop. Status ("delivered")
// is what YOU mark. The link patterns below are the carriers' public query pages as of
// writing; if one changes, "Other carrier" takes any tracking link you paste.
//
// Beyond that (T2-073):
//   * "Detect from the number" tells UPS (1Z...), USPS, PTT (...TR), DHL Express (10 digits) and
//     FedEx (12 or 15 digits) apart. Digits alone are ambiguous, so the carrier it picked is shown
//     on the order and it never guesses a carrier it has no pattern for.
//   * A number that is only digits can belong to several carriers (a 10-digit one is DHL Express, but
//     also what other carriers print), so "Detect from the number" does not pick one for it: it asks you
//     to choose, and remembers the answer for numbers of the same length and start, so the next one
//     is detected. A number with letters in it (UPS 1Z, PTT ...TR, USPS ...US) is still detected at once.
//   * "Watch" hands the carrier's public page to Page watch (js/page-watch.js), which asks it on its
//     own slow schedule and tells you when it changes. Only when you press Watch; Page watch's own
//     rules (no private tabs, no sign-in pages) apply. It never reads the page into the order.
//   * Each order keeps a short timeline: added, tracked, watched, the page changed, delivered.
//   * The Morning Brief gets one section: pick-ups that are held, parcels open longer than expected,
//     and the rest.
const OrdersHub = {
  KEY: 'vex.orders',
  ON_KEY: 'vex.orders.enabled',
  MAX: 200,
  OLD_DAYS: 14,
  CARRIERS: {
    ptt: { label: 'PTT Kargo', url: (n) => 'https://gonderitakip.ptt.gov.tr/Track/Verify?q=' + encodeURIComponent(n) },
    yurtici: { label: 'Yurtici Kargo', url: (n) => 'https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=' + encodeURIComponent(n) },
    mng: { label: 'MNG Kargo', url: (n) => 'https://www.mngkargo.com.tr/gonderitakip?q=' + encodeURIComponent(n) },
    aras: { label: 'Aras Kargo', url: (n) => 'https://kargotakip.araskargo.com.tr/mainpage.aspx?code=' + encodeURIComponent(n) },
    ups: { label: 'UPS', url: (n) => 'https://www.ups.com/track?tracknum=' + encodeURIComponent(n) },
    fedex: { label: 'FedEx', url: (n) => 'https://www.fedex.com/fedextrack/?trknbr=' + encodeURIComponent(n) },
    dhl: { label: 'DHL Express', url: (n) => 'https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=' + encodeURIComponent(n) },
    usps: { label: 'USPS', url: (n) => 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + encodeURIComponent(n) },
    other: { label: 'Other carrier (paste its link)', url: null },
  },
  MAX_EVENTS: 30,
  MEMORY_KEY: 'vex.orders.carrierMemory',      // { 'length:first three digits': carrier id }

  enabled() { return VexLifeKit.flag(this.ON_KEY, true); },
  setEnabled(on) { VexLifeKit.setFlag(this.ON_KEY, !!on); },

  // A suggestion from the shape of the number, or '' when no carrier's pattern fits. The patterns are
  // the carriers' published formats; a bare run of digits is ambiguous, so only the lengths DHL Express
  // (10) and FedEx (12, 15) use are named, and the carrier chosen is shown on the order.
  guessCarrier(number) {
    const n = String(number == null ? '' : number).trim().replace(/\s+/g, '').toUpperCase();
    if (/^1Z[0-9A-Z]{16}$/.test(n)) return 'ups';
    if (/^[A-Z]{2}\d{9}TR$/.test(n)) return 'ptt';
    if (/^(?:9[2-5]\d{18,20}|[A-Z]{2}\d{9}US)$/.test(n)) return 'usps';
    if (/^(?:\d{10}|JJD\d{10,})$/.test(n)) return 'dhl';
    if (/^(?:\d{12}|\d{15})$/.test(n)) return 'fedex';
    return '';
  },

  // ---- digit-only numbers: ask once, remember --------------------------------------------------
  digitsOnly(number) { return /^\d+$/.test(String(number == null ? '' : number).replace(/\s+/g, '')); },
  memoryKey(number) { const n = String(number).replace(/\s+/g, ''); return n.length + ':' + n.slice(0, 3); },
  _memory() {
    const raw = localStorage.getItem(this.MEMORY_KEY);
    if (raw == null) return {};
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The remembered carriers are not readable: ' + err.message, { cause: err }); }
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  },
  // The carrier chosen earlier for a number that looks like this one, or ''.
  remembered(number) {
    const c = this._memory()[this.memoryKey(number)];
    return typeof c === 'string' && this.CARRIERS[c] && c !== 'other' ? c : '';
  },
  remember(number, carrier) {
    if (!this.CARRIERS[carrier] || carrier === 'other') throw new Error('Unknown carrier');
    if (!this.digitsOnly(number)) return false;
    const m = this._memory();
    const keys = Object.keys(m);
    if (keys.length >= 100 && !(this.memoryKey(number) in m)) delete m[keys[0]];
    m[this.memoryKey(number)] = carrier;
    localStorage.setItem(this.MEMORY_KEY, JSON.stringify(m));
    return true;
  },
  // Forget what was remembered (Settings, Orders).
  forgetCarriers() { localStorage.removeItem(this.MEMORY_KEY); },

  // The page to open for an order. Throws for an "other" order with no usable link.
  trackUrl(order) {
    const c = this.CARRIERS[order.carrier];
    if (!c) throw new Error('Unknown carrier');
    if (c.url) return c.url(order.number);
    const u = new URL(order.link);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('The tracking link must be http or https');
    return u.href;
  },

  clean(input) {
    let carrier = this.CARRIERS[input.carrier] ? input.carrier : '';
    let carrierBy = 'chosen';
    if (input.carrier === 'auto') {
      if (this.digitsOnly(input.number)) {
        carrier = this.remembered(input.number);
        if (!carrier) {
          const usual = this.guessCarrier(input.number);
          throw new Error('That number is only digits, so more than one carrier could own it. Choose the carrier from the list' + (usual ? ' (' + this.CARRIERS[usual].label + ' is the usual one for this length)' : '') + '. Vex asks once and remembers your answer for numbers that look the same.');
        }
        carrierBy = 'remembered';
      } else {
        carrier = this.guessCarrier(input.number);
        if (!carrier) throw new Error('The number does not match one carrier’s format; choose the carrier');
        carrierBy = 'detected';
      }
    }
    if (!carrier) throw new Error('Choose a carrier');
    const number = String(input.number || '').trim();
    if (carrier !== 'other') {
      if (!/^[A-Za-z0-9-]{6,40}$/.test(number)) throw new Error('A tracking number is 6 to 40 letters and digits');
    } else if (number.length > 40) throw new Error('The tracking number is up to 40 characters');
    let link = String(input.link || '').trim();
    if (carrier === 'other') {
      if (!link) throw new Error('Paste the carrier’s tracking link');
      let u;
      try { u = new URL(link); } catch (err) { throw new Error('That tracking link is not an address', { cause: err }); }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('The tracking link must be http or https');
      link = u.href;
    } else link = '';
    const label = String(input.label || '').trim();
    if (!label) throw new Error('Say what it is');
    if (label.length > 100) throw new Error('The description is up to 100 characters');
    const day = (v, name) => { const s = String(v || '').trim(); return s ? VexLifeKit.dayString(VexLifeKit.parseDay(s)) : ''; };
    return {
      id: input.id || VexLifeKit.uid('or'), carrier, carrierBy: input.carrierBy || carrierBy, number, link, label,
      added: input.added || Date.now(), status: input.status === 'delivered' ? 'delivered' : 'open',
      holdDay: day(input.holdDay), refundDay: day(input.refundDay), remindIds: Array.isArray(input.remindIds) ? input.remindIds : [],
      watchId: typeof input.watchId === 'string' ? input.watchId : '',
      events: Array.isArray(input.events) ? input.events.filter(e => e && typeof e.text === 'string').slice(-this.MAX_EVENTS) : [],
    };
  },

  // ---- the timeline ----------------------------------------------------------------------------
  _event(o, text, at = Date.now()) {
    o.events = [...(o.events || []), { at, text: String(text).slice(0, 120) }].slice(-this.MAX_EVENTS);
  },
  // Writes an event onto one stored order. Throws when the order is gone.
  noteEvent(id, text, at = Date.now()) {
    const orders = this.all();
    const o = orders.find(x => x.id === id);
    if (!o) throw new Error('That order is gone');
    this._event(o, text, at);
    this._save(orders);
    return o;
  },

  // ---- watching the carrier's page (Page watch) ----------------------------------------------------
  watchable(o) {
    try { return o.status === 'open' && !!this.trackUrl(o); } catch { return false; }
  },
  watch(id) {
    if (typeof PageWatch === 'undefined') throw new Error('Page watch is not loaded');
    const orders = this.all();
    const o = orders.find(x => x.id === id);
    if (!o) throw new Error('That order is gone');
    if (o.watchId && PageWatch.list().some(w => w.id === o.watchId)) throw new Error('That page is already being watched');
    const w = PageWatch.add({ url: this.trackUrl(o), title: o.label + ' (' + this.CARRIERS[o.carrier].label + ')', every: 60 * 60000, source: 'orders-hub', byUser: true });
    o.watchId = w.id;
    this._event(o, 'Started watching the carrier page');
    this._save(orders);
    return w;
  },
  unwatch(id) {
    const orders = this.all();
    const o = orders.find(x => x.id === id);
    if (!o) throw new Error('That order is gone');
    if (o.watchId && typeof PageWatch !== 'undefined') PageWatch.remove(o.watchId);
    o.watchId = '';
    this._event(o, 'Stopped watching the carrier page');
    this._save(orders);
  },
  // Page watch said a page changed: if it is one of ours, it goes on that order's timeline.
  onPageWatch(detail) {
    const w = detail && detail.watch;
    if (!w || w.source !== 'orders-hub') return false;
    const orders = this.all();
    const o = orders.find(x => x.watchId === w.id);
    if (!o) return false;
    this._event(o, 'The carrier page changed');
    this._save(orders);
    return true;
  },

  all() { const d = VexLifeKit.read(this.KEY, null); return d && Array.isArray(d.orders) ? d.orders : []; },
  _save(orders) { VexLifeKit.write(this.KEY, { v: 1, orders }); },

  async add(input, now = Date.now()) {
    if (!this.enabled()) throw new Error('The orders hub is switched off');
    const orders = this.all();
    if (orders.length >= this.MAX) throw new Error('The hub holds ' + this.MAX + ' orders; delete some');
    const o = this.clean(input);
    // A digit-only number the person assigned to a carrier teaches the next one that looks the same.
    if (o.carrierBy === 'chosen' && o.carrier !== 'other') this.remember(o.number, o.carrier);
    const failed = [];
    if (o.holdDay) {
      // The day before, so there is still a day to fetch it.
      const dayMs = VexLifeKit.addDays(VexLifeKit.parseDay(o.holdDay), -1);
      try { const r = await VexLifeKit.remind('Pick up "' + o.label + '" by ' + o.holdDay + '. It is held until then.', dayMs, { now }); if (r.id) o.remindIds.push(r.id); }
      catch (err) { failed.push('Hold deadline: ' + err.message); }
    }
    if (o.refundDay) {
      try { const r = await VexLifeKit.remind('Has the refund for "' + o.label + '" arrived? You expected it by ' + o.refundDay + '.', VexLifeKit.parseDay(o.refundDay), { now }); if (r.id) o.remindIds.push(r.id); }
      catch (err) { failed.push('Refund reminder: ' + err.message); }
    }
    this._event(o, 'Added (' + this.CARRIERS[o.carrier].label + (o.carrierBy === 'remembered' ? ', the carrier you chose for a number like it' : '') + ')', now);
    if (o.holdDay) this._event(o, 'Held at a pick-up point until ' + o.holdDay, now);
    orders.push(o);
    this._save(orders);
    return { order: o, failed };
  },
  async _clearReminders(o) {
    const errs = [];
    for (const rid of o.remindIds || []) { try { await VexLifeKit.unremind(rid); } catch (err) { errs.push(err.message); } }
    o.remindIds = [];
    if (errs.length) throw new Error(errs.length + ' reminder(s) could not be deleted: ' + errs[0]);
  },
  async markDelivered(id) {
    const orders = this.all();
    const o = orders.find(x => x.id === id);
    if (!o) throw new Error('That order is gone');
    o.status = 'delivered';
    this._event(o, 'Marked delivered');
    let err = null;
    try { await this._clearReminders(o); } catch (e) { err = e; }
    // A delivered parcel needs no more watching of its page.
    if (o.watchId) {
      try { if (typeof PageWatch !== 'undefined') PageWatch.remove(o.watchId); o.watchId = ''; }
      catch (e) { err = err || e; }
    }
    this._save(orders);
    if (err) throw err;
    return o;
  },
  async remove(id) {
    const orders = this.all();
    const o = orders.find(x => x.id === id);
    if (!o) return;
    this._save(orders.filter(x => x.id !== id));
    if (o.watchId && typeof PageWatch !== 'undefined') PageWatch.remove(o.watchId);
    await this._clearReminders(o);
  },

  track(order) {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    const url = this.trackUrl(order);
    if (navigator.clipboard && order.number) navigator.clipboard.writeText(order.number).catch(err => window.VexProblems?.note('Orders hub', 'Could not copy the tracking number', err));
    TabManager.createTab(url, true);
    this.noteEvent(order.id, 'Opened the carrier page');
    return url;
  },

  // ---- the Morning Brief ------------------------------------------------------------------------------
  // -> { hold: [...], late: [...], rest: [...] } for the open orders: a pick-up deadline within two days, parcels
  // open longer than expected, everything else in transit.
  groups(now = Date.now()) {
    const open = this.list(now).filter(o => o.status === 'open');
    const soon = (o) => { if (!o.holdDay) return false; const d = VexLifeKit.parseDay(o.holdDay); return d >= now - 86400000 && d - now <= 2 * 86400000; };
    const hold = open.filter(soon);
    const late = open.filter(o => !hold.includes(o) && o.old);
    const rest = open.filter(o => !hold.includes(o) && !late.includes(o));
    return { hold, late, rest };
  },
  briefModule() {
    return {
      id: 'orders-hub', title: 'Parcels', icon: 'box',
      isEnabled: () => this.enabled(),
      build: async () => {
        const g = this.groups();
        const n = g.hold.length + g.late.length + g.rest.length;
        if (!n) return null;
        const line = (o, detail) => ({ text: o.label, detail: detail + ' (' + this.CARRIERS[o.carrier].label + ')', url: '' });
        const lines = [
          ...g.hold.map(o => line(o, 'Held until ' + o.holdDay + ', fetch it')),
          ...g.late.map(o => line(o, 'Open ' + o.ageDays + ' days, longer than expected')),
          ...g.rest.map(o => line(o, 'On its way')),
        ];
        const parts = [];
        if (g.hold.length) parts.push(g.hold.length + ' to pick up');
        if (g.late.length) parts.push(g.late.length + ' late');
        if (g.rest.length) parts.push(g.rest.length + ' on the way');
        return { summary: parts.join(', ') + '.', lines: lines.slice(0, 6) };
      },
    };
  },

  // Open orders first, oldest first; delivered after. `old` = open for OLD_DAYS or more.
  list(now = Date.now()) {
    return this.all().map(o => ({ ...o, ageDays: Math.floor((now - o.added) / 86400000), old: o.status === 'open' && now - o.added >= this.OLD_DAYS * 86400000 }))
      .sort((a, b) => (a.status === b.status ? a.added - b.added : (a.status === 'open' ? -1 : 1)));
  },
  snapshot(now = Date.now()) { const open = this.list(now).filter(o => o.status === 'open'); return { open: open.length, old: open.filter(o => o.old).length, items: open.slice(0, 5) }; },

  async edit() {
    const v = await VexLifeKit.form({
      id: 'vex-order-form', title: 'Add a parcel', sub: 'Kept on this computer. Vex opens the carrier’s own page; it does not sign in anywhere.',
      fields: [
        { name: 'label', label: 'What is it', required: true, placeholder: 'Headphones from the shop' },
        { name: 'carrier', label: 'Carrier', type: 'select', options: [['auto', 'Detect from the number'], ...Object.entries(this.CARRIERS).map(([k, c]) => [k, c.label])], value: 'auto' },
        { name: 'number', label: 'Tracking number', placeholder: 'RR123456789TR' },
        { name: 'link', label: 'Tracking link (only for "Other carrier")', placeholder: 'https://' },
        { name: 'holdDay', label: 'Held at a pick-up point until (year-month-day)', placeholder: 'optional' },
        { name: 'refundDay', label: 'Refund expected by (year-month-day)', placeholder: 'optional' },
      ],
      validate: (vals) => this.clean(vals),
    });
    return v ? this.add(v) : null;
  },
  open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('orders-hub');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-orders', title: 'Orders', sub: 'Your parcels. Status is what you mark; Vex does not read tracking pages.' });
    const draw = () => {
      body.textContent = '';
      const bar = document.createElement('div');
      bar.style.cssText = 'margin-bottom:10px';
      bar.appendChild(VexSettingsGroups.button('Add a parcel', async () => {
        try { const r = await this.edit(); if (r && r.failed.length) window.showToast?.(r.failed[0], 'error'); draw(); } catch (err) { window.showToast?.(err.message, 'error'); }
      }, { primary: true }));
      body.appendChild(bar);
      const rows = this.list();
      if (!rows.length) body.appendChild(VexSettingsGroups.note('No parcels yet.'));
      for (const o of rows) {
        const lines = [o.label + ' (' + this.CARRIERS[o.carrier].label + (o.number ? ', ' + o.number : '') + ')',
          o.status === 'delivered' ? 'Delivered' : 'Open for ' + o.ageDays + ' day' + (o.ageDays === 1 ? '' : 's') + (o.old ? '. Longer than expected? Check it or contact the shop.' : '')];
        if (o.holdDay) lines.push('Held until ' + o.holdDay);
        if (o.refundDay) lines.push('Refund expected by ' + o.refundDay);
        // The last few things that happened to it.
        for (const e of (o.events || []).slice(-4).reverse()) lines.push(new Date(e.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ': ' + e.text);
        const buttons = [];
        if (o.status === 'open') {
          buttons.push(VexSettingsGroups.button('Track', () => { try { this.track(o); } catch (err) { window.showToast?.(err.message, 'error'); } draw(); }));
          if (this.watchable(o)) {
            buttons.push(VexSettingsGroups.button(o.watchId ? 'Stop watching' : 'Watch the page', () => {
              try { if (o.watchId) this.unwatch(o.id); else { this.watch(o.id); window.showToast?.('Page watch will tell you when the carrier page changes'); } } catch (err) { window.showToast?.(err.message, 'error'); }
              draw();
            }));
          }
          buttons.push(VexSettingsGroups.button('Delivered', async () => { try { await this.markDelivered(o.id); } catch (err) { window.showToast?.(err.message, 'error'); } draw(); }));
        }
        buttons.push(VexSettingsGroups.button('Delete', async () => {
          if (!await window.vexConfirm({ title: 'Delete this parcel?', message: o.label, okLabel: 'Delete', danger: true })) return;
          try { await this.remove(o.id); } catch (err) { window.showToast?.(err.message, 'error'); }
          draw();
        }, { danger: true }));
        body.appendChild(VexLifeKit.row(lines, buttons));
      }
    };
    draw();
  },
};

if (typeof window !== 'undefined') {
  window.OrdersHub = OrdersHub;
  window.VexBriefModules = window.VexBriefModules || [];
  window.VexBriefModules.push(OrdersHub.briefModule());
  document.addEventListener('vex:page-watch', (e) => {
    try { OrdersHub.onPageWatch(e.detail); } catch (err) { window.VexProblems?.note('Orders hub', 'Could not note a change of the carrier page', err); }
  });
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'orders-hub', title: 'Orders', keywords: 'orders cargo parcel tracking ptt yurtici mng aras kargo refund pick-up', before: 'about',
      build: (el) => {
        el.appendChild(VexSettingsGroups.note('A list of your parcels. Track opens the carrier’s own page in a tab; reminders for a hold deadline and an expected refund. No sign-in, no scraping.'));
        el.appendChild(VexSettingsGroups.button('Open the orders', () => OrdersHub.open(), { primary: true }));
        el.appendChild(VexSettingsGroups.button('Forget the carriers I chose for digit-only numbers', () => { try { OrdersHub.forgetCarriers(); window.showToast?.('Vex will ask again for a number that is only digits'); } catch (err) { window.showToast?.(err.message, 'error'); } }));
      },
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'orders-hub', label: 'Orders and parcels', hint: 'Your parcels, tracking pages and reminders', icon: 'box', action: () => { if (OrdersHub.enabled()) OrdersHub.open(); else window.showToast?.('The orders hub is switched off'); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { OrdersHub };
