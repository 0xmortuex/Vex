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
//     "Collect from kept notifications" (not by itself, and only when that is on);
//   - the channels you opted in one by one ("Opt in the channel that is open now"): when you
//     press "Collect from the opted-in channels that are open", the links of the messages
//     already on the screen of such a channel are read (the address of each link, nothing else:
//     no message text, no names, no scrolling, no click). A channel you did not opt in is never read.
// It never opens a chat, scrolls, signs in or runs in the background.
//
// For a link that will expire it offers, and does not do by itself:
//   Open it now (a tab, so the file downloads under your control), Save for later (Read
//   Later), a reminder some time before it runs out, or "Save the file now": after a confirm
//   that names the file, Vex downloads a Discord attachment through its normal download
//   path (the download rules, ask-where and the downloads panel all apply), so the file is
//   on this PC before the address stops working. Nothing is fetched without that click.
const LinkHarvester = {
  KEY: 'vex.linkHarvester',
  MAX_LINKS: 300,
  MAX_AGE_MS: 14 * 24 * 3600000,
  SOON_MS: 24 * 3600000,
  REMIND_BEFORE_MS: 30 * 60000,
  // Hosts whose address carries an expiry.
  CDN: /(^|\.)(cdn\.discordapp\.com|media\.discordapp\.net)$/i,
  MAX_CHANNELS: 20,
  MAX_PAGE_LINKS: 200,
  // A Discord channel address: the server (or @me for direct messages) and the channel.
  CHANNEL_URL: /^https:\/\/([a-z0-9-]+\.)?discord\.com\/channels\/(@me|\d{15,25})\/(\d{15,25})/i,
  // The addresses of the links in the messages on screen. Only the href of each link is returned.
  PAGE_SCRIPT: "(() => { const root = document.querySelector('[data-list-id=\"chat-messages\"]'); if (!root) return { error: 'no-messages' }; const out = []; for (const a of root.querySelectorAll('a[href]')) { if (/^https?:/i.test(a.href)) out.push(a.href); if (out.length >= 200) break; } return { links: out }; })()",

  _now() { return Date.now(); },

  // ---- state -------------------------------------------------------------------------------
  state() {
    const s = CommsStore.record(this.KEY, { on: true, links: [], channels: [] }, 'harvested links');
    return {
      on: s.on !== false,
      links: Array.isArray(s.links) ? s.links.filter(l => l && typeof l.id === 'string' && typeof l.url === 'string') : [],
      channels: Array.isArray(s.channels) ? s.channels.filter(c => c && typeof c.key === 'string' && /^(@me|[0-9]+)\/[0-9]+$/.test(c.key)) : [],
    };
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

  // ---- channels you opted in ----------------------------------------------------------------------
  channels() { return this.state().channels; },
  // 'serverId/channelId' (or '@me/channelId') of a Discord address, or ''.
  channelKeyOf(url) { const m = this.CHANNEL_URL.exec(String(url || '')); return m ? m[2] + '/' + m[3] : ''; },
  optIn(url, label) {
    const key = this.channelKeyOf(url);
    if (!key) throw new Error('Open the Discord channel you want to collect from first (a channel page, not the home or a settings page)');
    const s = this.state();
    if (s.channels.some(c => c.key === key)) throw new Error('That channel is already opted in');
    if (s.channels.length >= this.MAX_CHANNELS) throw new Error('At most ' + this.MAX_CHANNELS + ' channels. Remove one first.');
    const c = { key, label: CommsStore.line(label, 80) || 'Channel ' + key.split('/')[1], addedAt: this._now() };
    s.channels.push(c);
    this._save(s);
    return c;
  },
  optOut(key) {
    const s = this.state();
    const next = s.channels.filter(c => c.key !== key);
    if (next.length === s.channels.length) return false;
    s.channels = next; this._save(s);
    return true;
  },
  _pages() {
    if (typeof DiscordTheme === 'undefined' || typeof DiscordTheme.pages !== 'function') throw new Error('The Discord pages are not available in this window');
    return DiscordTheme.pages();
  },
  // The channel in front in a Discord page, as an opt-in candidate: { url, label } or null.
  openChannel() {
    for (const wv of this._pages()) {
      const url = typeof vexGuestUrl === 'function' ? vexGuestUrl(wv) : '';
      if (this.channelKeyOf(url)) return { url, label: typeof wv.getTitle === 'function' ? String(wv.getTitle() || '') : '' };
    }
    return null;
  },
  // Press-to-collect: the links on screen in every opted-in channel that is open right now.
  // -> { channels: n read, added, seen }
  async harvestOpen() {
    if (!this.enabled()) throw new Error('The link harvester is switched off in Settings');
    CommsStore.needKept('A collected link');
    if (typeof window.vexGuestEval !== 'function') throw new Error('Pages cannot be read in this window');
    const optedIn = new Map(this.channels().map(c => [c.key, c]));
    if (!optedIn.size) throw new Error('No channel is opted in. Open one and press "Opt in the channel that is open now".');
    const done = new Set();
    let added = 0, seen = 0;
    for (const wv of this._pages()) {
      const key = this.channelKeyOf(typeof vexGuestUrl === 'function' ? vexGuestUrl(wv) : '');
      if (!key || !optedIn.has(key) || done.has(key)) continue;
      const r = await window.vexGuestEval(wv, this.PAGE_SCRIPT, false, 5000);
      if (!r || r.error) throw new Error('The messages of ' + optedIn.get(key).label + ' are not on screen yet. Let the channel finish loading and try again.');
      if (!Array.isArray(r.links)) throw new Error('Discord did not give a list of links');
      done.add(key);
      // A link to another Discord channel or message is not a thing to keep.
      const external = r.links.filter(u => typeof u === 'string' && !/^https:\/\/([a-z0-9-]+\.)?discord\.com\/(channels|users)\//i.test(u)).slice(0, this.MAX_PAGE_LINKS);
      const got = this.collect(external.join(' '), { source: 'Discord', channel: optedIn.get(key).label });
      added += got.added; seen += got.seen;
    }
    if (!done.size) throw new Error('None of the channels you opted in is open right now');
    return { channels: done.size, added, seen };
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
  // Save the file behind a Discord attachment address now, before it stops working. After a confirm
  // that names it; the download goes through Vex's normal download path.
  async saveFile(id) {
    const l = this.links().find(x => x.id === id);
    if (!l) throw new Error('That link is gone');
    if (!this.expiryOf(l.url)) throw new Error('Only a Discord attachment address, which has an expiry, can be saved this way');
    if (this.expiryState(l) === 'expired') throw new Error('This address has expired; Discord will refuse it. Ask for the file to be shared again.');
    if (!window.vex || typeof window.vex.downloadsRetry !== 'function') throw new Error('Downloads are not available in this window');
    const name = this.fileName(l.url) || l.host;
    const ok = await window.vexConfirm({
      title: 'Save this file now?',
      message: name + ' from ' + l.host + ' stops working on ' + new Date(l.expiresAt).toLocaleString() + '. Vex will download it now with your normal download settings (the Downloads panel shows it). Nothing else is sent.',
      okLabel: 'Save the file', cancelLabel: 'Not now',
    });
    if (!ok) return false;
    const r = await window.vex.downloadsRetry(l.url);
    if (!r || !r.ok) throw new Error((r && r.error) || 'Vex did not start the download');
    const s = this.state();
    const rec = s.links.find(x => x.id === id);
    if (rec) { rec.fileSaved = true; this._save(s); }
    return true;
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
