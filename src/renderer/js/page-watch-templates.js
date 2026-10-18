// === Page watch templates: seats, fares, a wishlist, a sale date, "claim it before it ends" ===
//
// The page watcher (js/page-watch.js) already tells you when a page, a part of it, a price or a
// stock word changes. These are four ready-made starting points for the same dialog, and one
// reminder, for the things people actually watch for:
//
//   seat            "tickets or seats available": the availability words on a booking page
//                   (sold out, seats left, book now ...), checked every hour.
//   fare            "a fare or ticket price falls below my figure": a price watch with "goes below".
//   wishlist-low    "tell me at a new lowest price": a price watch that speaks only when the price is
//                   lower than every price it has seen since you started watching. That is the
//                   lowest THIS WATCH has seen, not a store's price history: Vex does not read price
//                   history sites for you.
//   sale-date       "a sale date appears or changes": the date written next to the words sale, deal,
//                   offer or promo.
//   claim reminder  from any page: "remind me before this ends, with the link to this page".
//
// What none of them does: log in, fill in a form, click, buy, or read a page that needs a login. A
// watch asks the public page from this computer the way a visitor would (the rules in
// js/page-watch.js), and pages in private, Tor, proxy and container tabs are refused there.
const PageWatchTemplates = {
  KEY: 'vex.pageWatchTemplates.enabled',    // '0' = off
  FEATURE: 'page-watch-templates',
  HOUR: 3600000,
  DAY_PARTS: { min: 60000, h: 3600000, d: 86400000 },

  // Patterns are compiled by the watcher (200 characters at most, case-insensitive). The first
  // capture group is what is kept and compared.
  PATTERNS: {
    seat: '\\b(sold out|fully booked|no seats|no tickets|wait ?list|\\d+ (?:seats?|tickets?) (?:left|available)|(?:seats?|tickets?) available|book now|select (?:your )?seats?|on sale now)\\b',
    sale: '\\b(?:sale|deal|offer|promo)\\b[^\\n.]{0,40}?\\b(\\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \\d{1,2})',
  },

  TEMPLATES: {
    seat: { title: 'Watch for seats or tickets', command: 'watch-seats', label: 'Watch This Page for Seats or Tickets', hint: 'Tells you when the availability words on a booking page change (sold out, seats left, book now)', icon: 'eye' },
    fare: { title: 'Watch for a lower fare', command: 'watch-fare', label: 'Watch This Fare for a Lower Price', hint: 'Tells you when the price on this page goes below your figure', icon: 'chart-bar' },
    'wishlist-low': { title: 'Watch for a new lowest price', command: 'watch-wishlist-low', label: 'Wishlist: Tell Me at a New Lowest Price', hint: 'Tells you when this price is lower than any it has had since you started watching', icon: 'heart' },
    'sale-date': { title: 'Watch for a sale date', command: 'watch-sale-date', label: 'Watch This Page for a Sale Date', hint: 'Tells you when a date appears or changes next to the words sale, deal, offer or promo', icon: 'calendar' },
  },

  enabled() { try { return localStorage.getItem(this.KEY) !== '0'; } catch (err) { console.error('[PageWatchTemplates] the switch could not be read:', err.message); return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? '1' : '0'); this._registerCommands(); },
  has(id) { return Object.prototype.hasOwnProperty.call(this.TEMPLATES, id); },

  // Fills the watch dialog (js/page-watch-ui.js open()) for a template. `q` is the dialog's querySelector.
  fill(id, { form, q }) {
    if (!this.has(id)) throw new Error('Unknown watch template: ' + id);
    const t = this.TEMPLATES[id];
    form.querySelector('input[name="pw-what"][value="number"]').checked = true;
    q('#pw-add-title').textContent = t.title;
    q('#pw-ai').checked = false;
    if (id === 'seat' || id === 'sale-date') {
      q('#pw-extract').value = 'custom';
      q('#pw-pattern').value = id === 'seat' ? this.PATTERNS.seat : this.PATTERNS.sale;
      q('#pw-when').value = 'any';
      q('#pw-every').value = String(id === 'seat' ? this.HOUR : 6 * this.HOUR);
    } else {
      q('#pw-extract').value = 'price';
      q('#pw-when').value = id === 'fare' ? 'below' : 'down';
      q('#pw-every').value = String(6 * this.HOUR);
    }
    form.dispatchEvent(new Event('change', { bubbles: true }));
    if (id === 'fare') q('#pw-target').focus({ preventScroll: true });
  },
  // The dialog's answer, adjusted for the template. Throws for a combination that cannot work.
  finish(id, spec) {
    if (!this.has(id)) return spec;
    if (id === 'wishlist-low') {
      if (spec.kind !== 'number') throw new Error('A lowest-price watch needs a price on the page');
      return { ...spec, direction: 'down', alertLow: true };
    }
    if (id === 'fare' && !(spec.kind === 'number' && spec.direction === 'below')) throw new Error('A fare watch needs "goes below" and a figure');
    return spec;
  },

  _activeTab() {
    const tab = typeof TabManager !== 'undefined' && typeof TabManager.getActiveTab === 'function' ? TabManager.getActiveTab() : null;
    if (!tab || !/^https?:/i.test(tab.url || '')) throw new Error('Open a website first');
    return tab;
  },
  start(id) {
    if (!this.has(id)) throw new Error('Unknown watch template: ' + id);
    if (typeof PageWatchUI === 'undefined') throw new Error('Page watching is not available in this build');
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const tab = this._activeTab();
    return PageWatchUI.open({ url: tab.url, title: tab.title || tab.url, partition: tab.partition || null, picked: null, preset: id });
  },

  // ---- "claim it before it ends" -------------------------------------------------------------
  // "2 hours", "1 day", "30 min" -> ms. Throws for anything else.
  parseLead(text) {
    const m = /^\s*(\d{1,3})\s*(min(?:ute)?s?|h(?:ours?)?|d(?:ays?)?)\s*$/i.exec(String(text || ''));
    if (!m) throw new Error('Say how long before, like "2 hours", "1 day" or "30 min"');
    const n = Number(m[1]);
    const unit = /^m/i.test(m[2]) ? this.DAY_PARTS.min : /^h/i.test(m[2]) ? this.DAY_PARTS.h : this.DAY_PARTS.d;
    const ms = n * unit;
    if (!(ms >= 60000) || ms > 30 * 86400000) throw new Error('Choose between a minute and 30 days before');
    return ms;
  },
  // When to remind: `lead` before `endMs`; if that moment has gone but the offer has not ended, in one
  // minute. Throws when the offer is already over.
  planClaim(endMs, leadMs, nowMs = Date.now()) {
    if (!(endMs > nowMs + 60000)) throw new Error('That time has already passed or is under a minute away');
    const at = endMs - leadMs;
    return { at: at > nowMs + 60000 ? at : nowMs + 60000, late: at <= nowMs + 60000 };
  },
  async claimReminder() {
    if (typeof vexPrompt !== 'function') throw new Error('Vex could not ask you, so nothing was set');
    if (typeof VexQuickReminder === 'undefined') throw new Error('Reminders are not available here');
    const tab = this._activeTab();
    // The reminder keeps the page's address. A private or Tor tab's address must not be kept: the watch
    // templates and page reminders (js/page-reminders.js) refuse those tabs the same way.
    if ((tab.partition && tab.partition !== 'persist:main' && !/^persist:container-/.test(tab.partition)) || (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow)) {
      throw new Error('Private and Tor tabs are not saved in a reminder');
    }
    const endText = await vexPrompt({ title: 'Remind me before this ends', label: 'When does the offer end? (tomorrow 18:00, friday 9pm)', value: '', okLabel: 'Next' });
    if (endText == null) return null;
    const end = VexQuickReminder.parseWhen(endText);
    const leadText = await vexPrompt({ title: 'How long before?', label: 'Remind me this long before it ends', value: '2 hours', okLabel: 'Remind me' });
    if (leadText == null) return null;
    const plan = this.planClaim(end.getTime(), this.parseLead(leadText));
    const title = String(tab.title || tab.url).slice(0, 90);
    const made = await VexQuickReminder.create('Claim before it ends: ' + title, new Date(plan.at), { url: tab.url });
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    window.showToast?.(plan.late ? 'It ends soon, so the reminder is in a minute' : 'Reminder set, with a link to this page');
    return made;
  },

  _registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return false;
    const ids = Object.values(this.TEMPLATES).map(t => t.command).concat('claim-reminder');
    CommandBar.commands = CommandBar.commands.filter(c => !ids.includes(c.id));
    if (!this.enabled()) return true;
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    for (const [id, t] of Object.entries(this.TEMPLATES)) {
      CommandBar.commands.push({ id: t.command, label: t.label, hint: t.hint, icon: t.icon, action: () => { try { Promise.resolve(this.start(id)).catch(fail); } catch (err) { fail(err); } } });
    }
    CommandBar.commands.push({ id: 'claim-reminder', label: 'Remind Me Before This Ends', hint: 'From any page: a reminder before an offer, drop or deadline ends, with a link back to this page', icon: 'clock', action: () => this.claimReminder().catch(fail) });
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Ready-made starting points for the page watcher: seats and tickets, a lower fare, a new lowest price for a wishlist item, a sale date, and a reminder before an offer ends. They watch public pages only; nothing is logged into, filled in or bought. A "lowest price" is the lowest this watch has seen since you started it.'));
    const row = document.createElement('label');
    row.className = 'setting-toggle-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = this.enabled();
    cb.addEventListener('change', () => this.setEnabled(cb.checked));
    row.append(cb, document.createTextNode(' Show the watch templates and "Remind Me Before This Ends" in Ctrl+K'));
    el.appendChild(row);
  },
};

if (typeof window !== 'undefined') {
  window.PageWatchTemplates = PageWatchTemplates;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'page-watch-templates', title: 'Watch templates', keywords: 'watch page seats tickets fare price wishlist lowest sale date claim reminder ends', before: 'about', build: (el) => PageWatchTemplates.group(el) });
  }
  PageWatchTemplates._registerCommands();
  document.addEventListener('DOMContentLoaded', () => PageWatchTemplates._registerCommands());
}
if (typeof module !== 'undefined' && module.exports) module.exports = { PageWatchTemplates };
