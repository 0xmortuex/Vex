// === Chat link harvester and expiring-link rescuer (T3-060) =======================
//
// Links go by in chat and are gone by the evening. This collects the web
// addresses out of text YOU hand it, shows them by conversation with the duplicates
// folded together, and notices the ones that will stop working: a Discord attachment
// address carries an expiry (?ex=...) after which it returns an error.
//
// Where text comes from, and nothing else:
//   - text you select on a page and send with the right-click item "Collect the links in this";
//   - text you paste into the harvester;
//   - the panel notifications Vex already keeps (js/panel-capture.js), only when you press
//     "Collect from kept notifications" (not by itself, and only when that is on).
// It never opens a chat, reads a channel, scrolls, signs in or runs in the background.
//
// For a link that will expire it offers, and does not do by itself:
//   Open it now (a tab, so the file downloads under your control), Save for later (Read
//   Later), or a reminder some time before it runs out. Nothing is fetched by this module.
const LinkHarvester = {
  KEY: 'vex.linkHarvester',
  MAX_LINKS: 300,
  MAX_AGE_MS: 14 * 24 * 3600000,
  SOON_MS: 24 * 3600000,
  REMIND_BEFORE_MS: 30 * 60000,
  // Hosts whose address carries an expiry.
  CDN: /(^|\.)(cdn\.discordapp\.com|media\.discordapp\.net)$/i,

  _now() { return Date.now(); },

  // ---- state -------------------------------------------------------------------------------
  state() {
    const s = CommsStore.record(this.KEY, { on: true, links: [] }, 'harvested links');
    return { on: s.on !== false, links: Array.isArray(s.links) ? s.links.filter(l => l && typeof l.id === 'string' && typeof l.url === 'string') : [] };
  },
  _save(s) { CommsStore.write(this.KEY, s); CommsStore.emit('vex:link-harvester'); },
  enabled() { return this.state().on; },
  setEnabled(on) { const s = this.state(); s.on = !!on; this._save(s); },

  // ---- pure: expiry ------------------------------------------------------------------------------
  // The moment a Discord attachment address stops working, in ms, or 0 when it has none.
  // ex is the expiry as hexadecimal seconds since 1970.
  expiryOf(url) {
    let u;
    try { u = new URL(url); } catch { return 0; }
    if (!this.CDN.test(u.hostname)) return 0;
    const ex = u.searchParams.get('ex');
    if (!ex || !/^[0-9a-f]{1,12}$/i.test(ex)) return 0;
    const sec = parseInt(ex, 16);
    return Number.isFinite(sec) && sec > 1e9 && sec < 4e9 ? sec * 1000 : 0;
  },
  // 'none' | 'expired' | 'soon' (within a day) | 'later'
  expiryState(l, now = this._now()) {
    if (!l.expiresAt) return 'none';
    if (l.expiresAt <= now) return 'expired';
    return l.expiresAt - now <= this.SOON_MS ? 'soon' : 'later';
  },
  // An address without the parts that only identify the moment it was shared.
  keyOf(url) {
    try {
      const u = new URL(url);
      if (this.CDN.test(u.hostname)) return u.origin + u.pathname;
      u.hash = '';
      for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
      return u.href;
    } catch { return String(url); }
  },
  hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  fileName(url) { try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { return ''; } },

  // ---- collecting ------------------------------------------------------------------------------------
  // Text -> the links found, added. -> { added: n, seen: n (already known), found: n }
  collect(text, { source = 'Pasted', channel = '' } = {}) {
    if (!this.enabled()) throw new Error('The link harvester is switched off in Settings');
    CommsStore.needKept('A collected link');
    const urls = CommsStore.links(text, 60);
    const s = this.state();
    const now = this._now();
    const known = new Set(s.links.map(l => this.keyOf(l.url)));
    let added = 0, seen = 0;
    for (const url of urls) {
      const key = this.keyOf(url);
      if (known.has(key)) {
        seen++;
        // The same attachment shared again with a later expiry: keep the newer address.
        const old = s.links.find(l => this.keyOf(l.url) === key);
        const ex = this.expiryOf(url);
        if (old && ex && ex > (old.expiresAt || 0)) { old.url = url; old.expiresAt = ex; }
        continue;
      }
      known.add(key);
      s.links.unshift({ id: CommsStore.id('lh'), url, host: this.hostOf(url), source: CommsStore.line(source, 30), channel: CommsStore.line(channel, 80) || CommsStore.line(source, 30), ts: now, expiresAt: this.expiryOf(url), saved: false });
      added++;
    }
    s.links = s.links.filter(l => now - l.ts < this.MAX_AGE_MS).slice(0, this.MAX_LINKS);
    if (added || seen) this._save(s);
    return { added, seen, found: urls.length };
  },

  // The kept panel notifications, on request. The conversation is the notification's title.
  collectFromNotifications() {
    if (typeof PanelCapture === 'undefined') throw new Error('Kept notifications are not loaded');
    if (!PanelCapture.enabled()) throw new Error('Notifications from panels are off, so nothing is kept to collect from');
    let added = 0, seen = 0, scanned = 0;
    for (const n of PanelCapture.list({ includeMuted: true })) {
      scanned++;
      const r = this.collect(n.title + ' ' + n.body, { source: PanelCapture.label(n.source), channel: n.title });
      added += r.added; seen += r.seen;
    }
    return { added, seen, scanned };
  },

  links() { return this.state().links; },
  // Grouped by conversation, newest group first. -> [{ channel, source, links: [...] }]
  byChannel({ sinceMs = 0 } = {}) {
    const groups = new Map();
    for (const l of this.links()) {
      if (l.ts < sinceMs) continue;
      const g = groups.get(l.channel) || { channel: l.channel, source: l.source, links: [], last: 0 };
      g.links.push(l); g.last = Math.max(g.last, l.ts);
      groups.set(l.channel, g);
    }
    return Array.from(groups.values()).sort((a, b) => b.last - a.last);
  },
  startOfToday(now = this._now()) { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); },
  expiring(now = this._now()) { return this.links().filter(l => { const st = this.expiryState(l, now); return st === 'soon' || st === 'expired'; }).sort((a, b) => a.expiresAt - b.expiresAt); },
  remove(id) {
    const s = this.state();
    const next = s.links.filter(l => l.id !== id);
    if (next.length === s.links.length) return false;
    s.links = next; this._save(s);
    return true;
  },
  clear() { const s = this.state(); const n = s.links.length; s.links = []; this._save(s); return n; },

  // ---- rescuing (each is the person's click) --------------------------------------------------------------------
  open(id) {
    const l = this.links().find(x => x.id === id);
    if (!l) throw new Error('That link is gone');
    if (this.expiryState(l) === 'expired') throw new Error('This address has expired; Discord will refuse it. Ask for the file to be shared again.');
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    TabManager.createTab(l.url, true);
  },
  saveForLater(id) {
    const l = this.links().find(x => x.id === id);
    if (!l) throw new Error('That link is gone');
    if (typeof ReadLater === 'undefined' || typeof ReadLater.add !== 'function') throw new Error('Read Later is not loaded');
    if (this.expiryState(l) === 'expired') throw new Error('This address has expired, so saving it would save an error page');
    ReadLater.add(l.url, this.fileName(l.url) || l.host);
    const s = this.state();
    const rec = s.links.find(x => x.id === id);
    if (rec) { rec.saved = true; this._save(s); }
  },
  async remind(id) {
    const l = this.links().find(x => x.id === id);
    if (!l) throw new Error('That link is gone');
    if (!l.expiresAt) throw new Error('This link has no expiry to remind you about');
    const at = new Date(l.expiresAt - this.REMIND_BEFORE_MS);
    if (at.getTime() <= this._now()) throw new Error('It runs out in less than ' + Math.round(this.REMIND_BEFORE_MS / 60000) + ' minutes: open it now');
    if (typeof VexQuickReminder === 'undefined') throw new Error('Reminders are not loaded');
    return VexQuickReminder.create('A shared file link runs out soon: ' + (this.fileName(l.url) || l.host) + ' (' + l.channel + ')', at, { url: l.url });
  },
};

if (typeof window !== 'undefined') window.LinkHarvester = LinkHarvester;
if (typeof module !== 'undefined' && module.exports) module.exports = { LinkHarvester };
