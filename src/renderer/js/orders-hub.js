// === Orders hub: your parcels in one list ====================================
//
// T2-073. You add a parcel (the carrier, the tracking number, what it is). Vex
// keeps the list on this computer, opens the CARRIER'S OWN public tracking page
// in a tab when you press Track (the number is also copied, for pages that ask
// for it), and sets reminders you ask for: a pick-up-point hold deadline, and
// "my refund should have arrived by".
//
// What it does not do: no signing in to a carrier or a shop, no reading the
// tracking page for you, no background requests. Status ("delivered") is what
// YOU mark. The link patterns below are the carriers' public query pages as of
// writing; if one changes, "Other carrier" takes any tracking link you paste.
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
    other: { label: 'Other carrier (paste its link)', url: null },
  },

  enabled() { return VexLifeKit.flag(this.ON_KEY, true); },
  setEnabled(on) { VexLifeKit.setFlag(this.ON_KEY, !!on); },

  // A suggestion only: an international-postal number ending TR is PTT's. Nothing else is guessed.
  guessCarrier(number) { return /^[A-Z]{2}\d{9}TR$/i.test(String(number).trim()) ? 'ptt' : ''; },

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
    const carrier = this.CARRIERS[input.carrier] ? input.carrier : '';
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
      id: input.id || VexLifeKit.uid('or'), carrier, number, link, label,
      added: input.added || Date.now(), status: input.status === 'delivered' ? 'delivered' : 'open',
      holdDay: day(input.holdDay), refundDay: day(input.refundDay), remindIds: Array.isArray(input.remindIds) ? input.remindIds : [],
    };
  },

  all() { const d = VexLifeKit.read(this.KEY, null); return d && Array.isArray(d.orders) ? d.orders : []; },
  _save(orders) { VexLifeKit.write(this.KEY, { v: 1, orders }); },

  async add(input, now = Date.now()) {
    if (!this.enabled()) throw new Error('The orders hub is switched off');
    const orders = this.all();
    if (orders.length >= this.MAX) throw new Error('The hub holds ' + this.MAX + ' orders; delete some');
    const o = this.clean(input);
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
    let err = null;
    try { await this._clearReminders(o); } catch (e) { err = e; }
    this._save(orders);
    if (err) throw err;
    return o;
  },
  async remove(id) {
    const orders = this.all();
    const o = orders.find(x => x.id === id);
    if (!o) return;
    this._save(orders.filter(x => x.id !== id));
    await this._clearReminders(o);
  },

  track(order) {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    const url = this.trackUrl(order);
    if (navigator.clipboard && order.number) navigator.clipboard.writeText(order.number).catch(err => window.VexProblems?.note('Orders hub', 'Could not copy the tracking number', err));
    TabManager.createTab(url, true);
    return url;
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
        { name: 'carrier', label: 'Carrier', type: 'select', options: Object.entries(this.CARRIERS).map(([k, c]) => [k, c.label]), value: 'ptt' },
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
          o.status === 'delivered' ? 'Delivered' : 'Open for ' + o.ageDays + ' day' + VexPlural.s(o.ageDays) + (o.old ? '. Longer than expected? Check it or contact the shop.' : '')];
        if (o.holdDay) lines.push('Held until ' + o.holdDay);
        if (o.refundDay) lines.push('Refund expected by ' + o.refundDay);
        const buttons = [];
        if (o.status === 'open') {
          buttons.push(VexSettingsGroups.button('Track', () => { try { this.track(o); } catch (err) { window.showToast?.(err.message, 'error'); } }));
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
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'orders-hub', title: 'Orders', keywords: 'orders cargo parcel tracking ptt yurtici mng aras kargo refund pick-up', before: 'about',
      build: (el) => {
        el.appendChild(VexSettingsGroups.note('A list of your parcels. Track opens the carrier’s own page in a tab; reminders for a hold deadline and an expected refund. No sign-in, no scraping.'));
        el.appendChild(VexSettingsGroups.button('Open the orders', () => OrdersHub.open(), { primary: true }));
      },
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'orders-hub', label: 'Orders and parcels', hint: 'Your parcels, tracking pages and reminders', icon: 'box', action: () => { if (OrdersHub.enabled()) OrdersHub.open(); else window.showToast?.('The orders hub is switched off'); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { OrdersHub };
