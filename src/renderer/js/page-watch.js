// === Tell me when this changes =============================================
//
// Auto-refresh reloads a page on a timer, which is half the job: you still have
// to look at it. The thing people actually want is "tell me when the price
// drops", "when the tickets open", "when the build finishes" — and today that
// means leaving a tab open and remembering to check it.
//
// A watch reloads quietly in the background, compares what came back with what
// was there before, and says so when it is different. What "different" means is
// the user's choice: the whole page, one part of it, or a number in it.
//
// Page Watcher (the second layer): a watch keeps a bounded history of what it
// saw, so a change comes with WHAT changed (lines added and removed, a
// one-sentence summary from the local model when you have one), a part of the
// page that has gone is told apart from a change, a failing page is checked
// less and less often, and a page that has not changed since the last look
// costs one conditional request. The rules for "changed" are in
// js/page-watch-diff.js.
//
// Patch Radar (js/patch-radar.js): `source` says who made a watch ('user', or
// 'radar:patch-notes' for a game's patch notes page).
// A radar module registers its watches through add({ source, ... }) with the
// URL of the vendor's endpoint and a `pattern` (kind 'regex') that pulls the
// version out; the engine, history, backoff, notifications and the panel are
// the ones here. Anything with a source other than 'user' is listed in the
// panel under its own name.
const PageWatch = {
  KEY: 'vex.pageWatches',
  SNAPS_KEY: 'vex.pageWatchSnaps',
  SETTINGS_KEY: 'vex.pageWatchSettings',
  EVERY: [
    { ms: 5 * 60000, label: 'every 5 minutes' },
    { ms: 15 * 60000, label: 'every 15 minutes' },
    { ms: 60 * 60000, label: 'every hour' },
    { ms: 6 * 3600000, label: 'every 6 hours' },
    { ms: 24 * 3600000, label: 'once a day' },
  ],
  // A page is never asked more often than this, however a watch was made.
  MIN_EVERY: 5 * 60000,
  // A page that fails is asked after every * 2^failures, up to this long.
  MAX_BACKOFF: 24 * 3600000,
  DEFAULTS: { enabled: true, maxWatches: 30, maxSnapshots: 20, sensitivity: 'normal', summarize: false },
  LIMIT_CEILING: { maxWatches: 100, maxSnapshots: 50 },
  GONE_MSG: 'The part you watched is gone from this page',
  WAKE_MESSAGE: 'Vex is opening to check the pages you are watching',

  list() { try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  _save(list) {
    try { localStorage.setItem(this.KEY, JSON.stringify(list)); }
    catch (err) { VexProblems?.note('Page watch', 'Could not save the watches', err); return false; }
    // The toolbar badge follows the list.
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:page-watch-list'));
    return true;
  },

  PRIVATE_REFUSED: 'A private window does not keep watches: they would be remembered after it closes',
  _privateWindow() { return typeof window !== 'undefined' && !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow); },

  // Why a page cannot be watched at all, in words, or '' when it can. The
  // dialog asks first, so a refusal comes before a form is filled in.
  refusalFor({ url, partition = null }) {
    if (!this.settings().enabled) return 'Page watching is switched off in Settings';
    if (!/^https?:/i.test(String(url || ''))) return 'Only a web page can be watched';
    if (this._privateWindow()) return this.PRIVATE_REFUSED;
    if (partition && typeof TabManager !== 'undefined' && typeof TabManager.windowMayAsk === 'function' && !TabManager.windowMayAsk(partition)) return this.OWN_SESSION_REFUSED;
    return '';
  },

  // The rules for "changed" (js/page-watch-diff.js), loaded as a page script
  // in the window and required in tests.
  _diff() {
    if (typeof PageWatchDiff !== 'undefined') return PageWatchDiff;
    if (typeof require === 'function') return require('./page-watch-diff.js').PageWatchDiff;
    throw new Error('page-watch-diff.js is not loaded');
  },

  // Settings > Page watcher. A global switch and the limits; what is saved
  // is cleaned, so a hand-edited value cannot make the history unbounded.
  settings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(this.SETTINGS_KEY) || '{}') || {}; } catch { s = {}; }
    const d = this.DEFAULTS, c = this.LIMIT_CEILING;
    const int = (v, def, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : def; };
    return {
      enabled: s.enabled !== false,
      maxWatches: int(s.maxWatches, d.maxWatches, c.maxWatches),
      maxSnapshots: int(s.maxSnapshots, d.maxSnapshots, c.maxSnapshots),
      sensitivity: ['low', 'normal', 'high'].includes(s.sensitivity) ? s.sensitivity : d.sensitivity,
      summarize: s.summarize === true,
    };
  },
  setSettings(patch) {
    const next = { ...this.settings(), ...(patch || {}) };
    if (patch && patch.sensitivity != null && !['low', 'normal', 'high'].includes(patch.sensitivity)) throw new Error('Sensitivity is low, normal or high');
    try { localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(next)); }
    catch (err) { throw new Error('The page watcher settings could not be saved: ' + ((err && err.message) || 'storage is full')); }
    const cleaned = this.settings();
    // A lower limit trims what is kept now, not at the next change.
    const snaps = this._snaps();
    for (const id of Object.keys(snaps)) while (snaps[id].length > cleaned.maxSnapshots) snaps[id].shift();
    this._saveSnaps(snaps);
    return cleaned;
  },

  // The history: { [watchId]: [{ at, text, hash, truncated }] }, oldest first.
  _snaps() {
    try { const o = JSON.parse(localStorage.getItem(this.SNAPS_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
  },
  _saveSnaps(snaps) {
    try { localStorage.setItem(this.SNAPS_KEY, JSON.stringify(snaps)); return true; }
    catch (err) { VexProblems?.note('Page watch', 'Could not save the history of the watched pages', err); return false; }
  },
  history(id) { return (this._snaps()[id] || []).slice(); },

  // What is being compared. A selector narrows it to one part of the page,
  // which is the difference between "the article changed" and "the navigation
  // bar rotated its advert".
  //   kind 'text'   — the words changed at all
  //   kind 'number' — the first number in it went up, down, or past a figure
  //
  // A page on this computer or your home network (a router, a NAS, a dev
  // server: VexPrivateAddress) is watched only when you add the watch
  // yourself (byUser): the AI agent is steered by text it reads, and must not
  // be talked into polling the router. Such a watch is checked straight from
  // this computer (_getLocal), not through the public-only fetch.
  //
  // partition: the session of the tab the page was watched from. A page open
  // in a Tor, private or container tab is refused: a watch is checked from
  // Vex's window, on your real connection — and the check at each look only
  // knows the site rules, not which tab it came from.
  //
  // kind 'regex' keeps whatever `pattern` pulls out of the page (a price, a
  // version, a build number) and speaks when it is a different one; `anchor`
  // is the first words of the part that was picked, so a part that moved on
  // the page can be found again; `render` reads the page as a hidden tab would
  // (for pages built by JavaScript); `wake` asks for Vex to be opened for the
  // check; `summarize` asks the local model for a sentence.
  add({ url, title, selector, anchor = '', kind = 'text', pattern = '', every = 15 * 60000, direction = 'any', target = null, byUser = false, partition = null, render = false, wake = false, summarize = null, source = 'user', raw = false, alertLow = false }) {
    const s = this.settings();
    const refused = this.refusalFor({ url, partition });
    if (refused) throw new Error(refused);
    const local = this.isLocal(url);
    if (local && !byUser) throw new Error(this.LOCAL_REFUSED);
    if (local && render) throw new Error('A page on this computer or your home network is read directly, not through a hidden tab');
    const ms = Number(every) || 15 * 60000;
    if (ms < this.MIN_EVERY) throw new Error('A page is not checked more often than every ' + Math.round(this.MIN_EVERY / 60000) + ' minutes');
    // A bad pattern is refused now, not at the first check.
    const wantsPattern = kind === 'regex' || (kind === 'number' && String(pattern || '').trim());
    if (wantsPattern) this._diff().compile(pattern);
    const list = this.list();
    if (list.length >= s.maxWatches) throw new Error('You are already watching ' + s.maxWatches + ' pages (the limit in Settings). Stop one first.');
    const pat = wantsPattern ? String(pattern) : '';
    if (list.some(w => w.url === url && (w.selector || '') === (selector || '') && (w.pattern || '') === pat)) throw new Error('That is already being watched');
    const watch = {
      id: 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      url: String(url), title: String(title || url), selector: String(selector || '').slice(0, 200),
      anchor: String(anchor || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      kind: kind === 'number' ? 'number' : kind === 'regex' ? 'regex' : 'text',
      pattern: pat,
      direction: ['up', 'down', 'any', 'below', 'above'].includes(direction) ? direction : 'any',
      target: target == null ? null : Number(target),
      every: ms,
      raw: !!raw, render: !!render, wake: !!wake, summarize: summarize == null ? null : !!summarize,
      // A wishlist price: told only when it is lower than every price seen since the watch began.
      ...(alertLow === true && kind === 'number' ? { alertLow: true } : {}),
      source: String(source || 'user').slice(0, 40),
      paused: false,
      addedAt: Date.now(), lastCheckedAt: 0, lastValue: null, lastChangedAt: 0, failures: 0,
      ...(local ? { local: true, byUser: true } : {}),
    };
    list.push(watch);
    if (!this._save(list)) throw new Error('The watch could not be saved');
    if (watch.wake) this.syncWake();
    return watch;
  },

  remove(id) {
    this._save(this.list().filter(w => w.id !== id));
    const snaps = this._snaps();
    if (snaps[id]) { delete snaps[id]; this._saveSnaps(snaps); }
    this.syncWake();
  },

  // Stop checking without forgetting: the history stays, the checks wait.
  setPaused(id, paused) {
    const list = this.list();
    const w = list.find(x => x.id === id);
    if (!w) throw new Error('That watch is gone');
    w.paused = !!paused;
    if (!paused) { w.failures = 0; w.lastCheckedAt = 0; }
    if (!this._save(list)) throw new Error('The watch could not be saved');
    this.syncWake();
    return w;
  },

  // How many watches have a change nobody has looked at (the toolbar badge).
  unseenCount() { return this.list().filter(w => this.isUnseen(w)).length; },

  LOCAL_REFUSED: 'Pages on this computer or your home network are watched only when you add the watch yourself',
  OWN_SESSION_REFUSED: 'This tab goes through Tor, a proxy, a container or a private session, and a watch would check the page from your real connection — so it is not watched',

  // Is this address this computer or the home network (router, NAS,
  // localhost, 192.168.x, .local)?
  isLocal(url) {
    let host;
    try { host = new URL(String(url)).hostname; } catch { return false; }
    const pa = typeof VexPrivateAddress !== 'undefined' ? VexPrivateAddress
      : (typeof require === 'function' ? require('./private-address.js') : null);
    if (!pa) throw new Error('private-address.js is not loaded');
    return pa.isPrivateHost(host);
  },

  // The one line a home-network watch shows: what Vex will do, and from where.
  localNote(watch) {
    return 'Vex will check this device on your network ' + this._everyLabel(watch.every) + ' from this computer';
  },

  // "when it drops under $300", "goes above 50", "goes down", "changes" →
  // what add() needs. Throws, naming what it could not read, rather than
  // guessing a watch the person did not ask for.
  parseWhen(text) {
    const t = String(text || '').toLowerCase().replace(/,/g, '');
    const num = (s) => { const m = /(-?\d+(?:\.\d+)?)/.exec(s); return m ? Number(m[1]) : null; };
    let m;
    if ((m = /\b(drops?|falls?|goes|gets|is)?\s*(under|below|less than|beneath|cheaper than)\s*([^\s]*\d[\d.]*)/.exec(t))) {
      const target = num(m[3]);
      if (target != null) return { kind: 'number', direction: 'below', target };
    }
    if ((m = /\b(rises?|climbs?|goes|gets|is)?\s*(over|above|more than|higher than)\s*([^\s]*\d[\d.]*)/.exec(t))) {
      const target = num(m[3]);
      if (target != null) return { kind: 'number', direction: 'above', target };
    }
    if (/\b(drops?|falls?|goes down|gets cheaper|decreases?|lower)\b/.test(t)) return { kind: 'number', direction: 'down', target: null };
    if (/\b(rises?|goes up|increases?|higher|climbs?)\b/.test(t)) return { kind: 'number', direction: 'up', target: null };
    if (/\b(changes?|updates?|is different|anything new|opens?|is (?:back )?in stock|goes live|is out)\b/.test(t)) return { kind: 'text', direction: 'any', target: null };
    throw new Error('Say what to watch for — "drops under 300", "goes above 50", "goes down", or "changes"');
  },

  // What the agent and Ctrl+K call: watch the page open now for `when`.
  // Ctrl+K passes byUser (the person typed it); the agent does not.
  watchCurrent(when, { url, title, byUser = false } = {}) {
    const rule = this.parseWhen(when);
    let u = url, t = title, partition = null;
    if (!u && typeof TabManager !== 'undefined') {
      const tab = TabManager.tabs.find(x => x.id === TabManager.activeTabId);
      if (tab) { u = tab.url; t = t || tab.title; partition = tab.partition || null; }
    }
    const watch = this.add({ url: u, title: t, ...rule, byUser, partition });
    const first = this.firstLook(watch);
    return { watch, first, said: (t || u) + ' — ' + this.describeRule(rule) + (watch.local ? '. ' + this.localNote(watch) : '') };
  },

  // Every way of adding a watch (Watch This Page, Ctrl+K, the AI, a part of
  // the page) looks at once: the baseline is set now, not at the first timed
  // check, and a page that cannot be read says so while you are still there.
  // checkOne/readValue keep the routing and home-network rules.
  async firstLook(watch) {
    let first;
    try { first = await this.checkOne(watch.id); }
    catch (err) {
      VexProblems?.note('Page watch', 'The first look at ' + watch.url + ' failed', err);
      first = { ok: false, error: (err && err.message) || 'could not be read' };
    }
    if (!first.ok && !first.gone) window.showToast?.('Watching, but the first look failed: ' + first.error, 'error');
    return first;
  },
  describeRule(r) {
    if (r.kind === 'text') return 'tells you when the page changes';
    if (r.alertLow) return 'tells you when its price is the lowest it has been since you started watching';
    if (r.direction === 'below') return 'tells you when its number goes below ' + r.target;
    if (r.direction === 'above') return 'tells you when its number goes above ' + r.target;
    return 'tells you when its number goes ' + (r.direction === 'down' ? 'down' : 'up');
  },

  // The first number in a piece of text, as a person would read it: "£1,299.99"
  // is 1299.99, and "4 of 12 left" is 4.
  firstNumber(text) {
    const m = String(text || '').replace(/[  ]/g, ' ').match(/-?\d[\d,. ]*/);
    if (!m) return null;
    // Thousands separators go; the last dot or comma with 1-2 digits after it
    // is the decimal point.
    let raw = m[0].trim().replace(/\s/g, '');
    const dec = raw.match(/[.,](\d{1,2})$/);
    if (dec) raw = raw.slice(0, dec.index).replace(/[.,]/g, '') + '.' + dec[1];
    else raw = raw.replace(/[.,]/g, '');
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  },

  // ---- What each check saw (T2-074) ---------------------------------------------------------
  // The history keeps the first look and every CHANGE, so a price that never moved had
  // exactly one point however many times it was checked, and looked like a tracker that
  // did not track. Each check is now counted on the watch, and a number or price watch
  // also keeps a short series of what it saw (one sample at most every half hour unless
  // the value moved), so the chart has points and "never changed in N checks" is true.
  SAMPLE_GAP_MS: 30 * 60 * 1000,
  MAX_SAMPLES: 60,
  noteCheck(watch, now, value) {
    watch.checks = (watch.checks || 0) + 1;
    if (watch.kind !== 'number' && watch.kind !== 'regex') return;
    const v = typeof value === 'number' ? value : this.firstNumber(value);
    if (v == null) return;
    if (watch.kind === 'number' && (!Number.isFinite(watch.low) || v < watch.low)) watch.low = v;
    const s = Array.isArray(watch.samples) ? watch.samples : (watch.samples = []);
    const last = s[s.length - 1];
    if (last && last.v === v && now - last.at < this.SAMPLE_GAP_MS) return;
    s.push({ at: now, v });
    while (s.length > this.MAX_SAMPLES) s.shift();
  },
  samples(id) { const w = this.list().find(x => x.id === id); return w && Array.isArray(w.samples) ? w.samples.slice() : []; },
  // "12 checks, never changed" / "12 checks, last change 3 days ago".
  checkLine(w, now = Date.now()) {
    const n = w.checks || 0;
    if (!n) return w.lastCheckedAt ? 'checked before counting began' : 'not checked yet';
    const word = n + ' check' + (n === 1 ? '' : 's');
    if (!w.lastChangedAt) return word + ', never changed';
    const days = Math.floor((now - w.lastChangedAt) / 86400000);
    return word + ', last change ' + (days < 1 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago');
  },

  // Is this worth telling the user about?
  // → { changed, from, to, why } — `why` is the sentence they see.
  judge(watch, value) {
    const before = watch.lastValue;
    if (before == null) return { changed: false, from: null, to: value, why: 'first look' };
    if (watch.kind === 'number') {
      const a = Number(before), b = Number(value);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return { changed: false, from: a, to: b, why: 'no change' };
      const dir = b > a ? 'up' : 'down';
      if (watch.alertLow === true) {
        const low = Number.isFinite(watch.low) ? watch.low : a;
        if (!(b < low)) return { changed: false, from: a, to: b, why: 'not a new low (the lowest seen is ' + low + ')' };
        return { changed: true, from: a, to: b, why: `is ${b}, the lowest since you started watching (it was ${low})` };
      }
      if (watch.direction === 'up' && dir !== 'up') return { changed: false, from: a, to: b, why: 'went down' };
      if (watch.direction === 'down' && dir !== 'down') return { changed: false, from: a, to: b, why: 'went up' };
      if (watch.direction === 'below') {
        if (!(b <= watch.target)) return { changed: false, from: a, to: b, why: 'still above ' + watch.target };
        return { changed: true, from: a, to: b, why: `is ${b}, at or below ${watch.target}` };
      }
      if (watch.direction === 'above') {
        if (!(b >= watch.target)) return { changed: false, from: a, to: b, why: 'still below ' + watch.target };
        return { changed: true, from: a, to: b, why: `is ${b}, at or above ${watch.target}` };
      }
      return { changed: true, from: a, to: b, why: `went ${dir} from ${a} to ${b}` };
    }
    // What a pattern pulled out: a version, a price, a build number. It is
    // a different one or it is not.
    if (watch.kind === 'regex') {
      if (String(before) === String(value)) return { changed: false, from: before, to: value, why: 'no change' };
      return { changed: true, from: before, to: value, why: `is now ${value} (was ${before})` };
    }
    // A watch saved before whole pages were fingerprinted holds plain text:
    // the first look in the new form is a new baseline, not a change.
    if (this._isPageValue(value) !== this._isPageValue(before)) return { changed: false, from: before, to: value, why: 'first look' };
    // "High" sensitivity keeps the clock times and "5 minutes ago".
    const same = this.settings().sensitivity === 'high'
      ? String(before) === String(value)
      : this._steady(before) === this._steady(value);
    return same ? { changed: false, from: before, to: value, why: 'no change' } : { changed: true, from: before, to: value, why: 'changed' };
  },

  // The words of a page without what changes on every load by itself: "5
  // minutes ago", a clock time. A page whose only change was its "updated 3
  // minutes ago" line is not news.
  _steady(text) {
    return String(text == null ? '' : text)
      .replace(/\b(?:\d+|an?|one)\s+(?:sec(?:ond)?s?|min(?:ute)?s?|hours?|hrs?|days?)\s+ago\b/gi, '')
      .replace(/\bjust now\b/gi, '')
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?(?=\W|$)/gi, '')
      .replace(/\s+/g, ' ').trim();
  },

  // What a whole-page watch keeps: the page's opening words (Ctrl+K "Watched
  // Pages (what changed)" shows them) and a fingerprint of ALL its words.
  // Only the first 4000 characters used to be kept and compared, so a change
  // further down — "In stock" at the bottom of a long product page — was
  // never seen. The fingerprint is of the steady text, so "5 minutes ago"
  // and clock times still do not count.
  PAGE_MARK: ' ⁣#',
  _pageValue(text, steadyOn = true) {
    const steady = steadyOn ? this._steady(text) : String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    let h = 0x811c9dc5, g = 0x01000193;
    for (let i = 0; i < steady.length; i++) {
      const c = steady.charCodeAt(i);
      h = Math.imul(h ^ c, 0x01000193);
      g = Math.imul(g ^ c, 0x5bd1e995);
    }
    return steady.slice(0, 200) + this.PAGE_MARK + (h >>> 0).toString(16) + (g >>> 0).toString(16) + '-' + steady.length;
  },
  _isPageValue(v) { return typeof v === 'string' && v.includes(this.PAGE_MARK); },

  // Read the watched value out of a page, without disturbing the user's tabs:
  // the page is fetched, not opened (unless the watch asks for a hidden tab).
  // → { value, text, lines, etag, lastModified } or { notModified: true }.
  //
  // Privacy, as before: the check goes out from Vex's own window, direct. A
  // site that is routed (Tor, a proxy, a container) is refused, never checked
  // from the real address (found 2026-09-30). Nothing is ever typed into a
  // page and no login is made: the plain read carries no cookies at all (api:
  // request publicOnly), and the hidden-tab read is one load of the address
  // with no clicks, in the session of the main window.
  async readPage(watch) {
    if (typeof AgentTools === 'undefined') throw new Error('Page reading is not available');
    if (typeof TabManager !== 'undefined' && !TabManager.mayAskSiteForIcon(watch.url)) throw new Error('This site goes through Tor, a proxy or a container, and a watch would check it from your real connection — so it is not checked');
    const D = this._diff();
    let text = '', raw = null, etag = null, lastModified = null;
    // A page that did not change since the last look says so in one short
    // reply, when it can: ETag / Last-Modified (RFC 9110, conditional GET).
    const cond = {};
    if (!watch.render && watch.lastValue != null) {
      if (watch.etag) cond['If-None-Match'] = watch.etag;
      if (watch.lastModified) cond['If-Modified-Since'] = watch.lastModified;
    }
    const conditional = Object.keys(cond).length ? cond : null;
    if (watch.render) {
      const r = await this._render(watch);
      if (watch.selector && !r.found) throw this._gone(watch);
      text = String(r.text || '');
    } else if (this.isLocal(watch.url)) {
      // Only a watch the user added on a home-network address (add) is read
      // from here; anything else, a hand-edited list included, is refused.
      if (!(watch.local === true && watch.byUser === true)) throw new Error(this.LOCAL_REFUSED);
      raw = await this._getLocal(watch.url);
      const body = String(raw.body || '');
      const type = String((raw.headers && (raw.headers['content-type'] || raw.headers['Content-Type'])) || '').toLowerCase();
      const html = /html|xml/.test(type) || /^\s*</.test(body);
      text = watch.selector ? this._partOf(body, watch) : (watch.raw ? body : (html ? AgentTools.htmlToText(body).text : body));
    } else if (watch.raw && !watch.selector) {
      // A feed (a radar watch): the markup itself, because the pattern looks
      // for its tags and the readable-text reader would strip them.
      const rr = await AgentTools._get(watch.url, conditional);
      if (rr.status === 304) return { notModified: true };
      const h = rr.headers || {};
      etag = h.etag || h.ETag || null; lastModified = h['last-modified'] || h['Last-Modified'] || null;
      text = String(rr.body || '');
    } else if (!watch.selector) {
      const r = await AgentTools.readUrl(watch.url, { maxText: Infinity, headers: conditional });
      if (r.notModified) return { notModified: true };
      text = String(r.text || '');
      etag = r.etag || null; lastModified = r.lastModified || null;
    } else {
      // A part of the page needs the real document, so this path reads the
      // page's markup rather than the readable text.
      raw = await AgentTools._get(watch.url, conditional);
      if (raw.status === 304) return { notModified: true };
      const h = raw.headers || {};
      etag = h.etag || h.ETag || null; lastModified = h['last-modified'] || h['Last-Modified'] || null;
      text = this._partOf(String(raw.body || ''), watch);
    }
    const steady = this.settings().sensitivity !== 'high';
    const lines = D.normalizeText(text, { steady });
    const norm = lines.join('\n');
    let value;
    if (watch.kind === 'number') value = this.firstNumber(watch.pattern ? D.extract(text, watch.pattern) : text);
    else if (watch.kind === 'regex') value = D.extract(text, watch.pattern);
    else value = watch.selector ? norm.slice(0, 4000) : this._pageValue(norm, steady);
    return { value, text: norm, lines, etag, lastModified };
  },

  // Kept for the callers (and tests) that only want the value.
  async readValue(watch) {
    const r = await this.readPage(watch);
    return r.notModified ? watch.lastValue : r.value;
  },

  // The picked part of a page's markup, as lines of text. The selector is
  // tried first; when it no longer matches, the part is looked for by the
  // first words that were picked (a page that was re-laid-out). Neither: the
  // part is gone — that is not a change, and it is said as such.
  _partOf(html, watch) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    let el = null;
    try { el = doc.querySelector(watch.selector); }
    catch { throw new Error('"' + watch.selector + '" is not a valid selector'); }
    if (!el && watch.anchor) el = this._findByAnchor(doc, watch.anchor);
    if (!el) throw this._gone(watch);
    el.querySelectorAll('script, style, noscript, template').forEach(n => n.remove());
    el.querySelectorAll('p, br, li, h1, h2, h3, h4, h5, h6, tr, div, section, article, blockquote, pre').forEach(n => n.after(doc.createTextNode('\n')));
    return el.textContent || '';
  },
  // The smallest element whose words contain the anchor.
  _findByAnchor(doc, anchor) {
    const want = String(anchor || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (want.length < 6) return null;
    let best = null, bestLen = Infinity;
    for (const n of doc.body ? doc.body.querySelectorAll('*') : []) {
      if (/^(?:script|style|noscript|template)$/i.test(n.tagName)) continue;
      const t = (n.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (t.length < bestLen && t.includes(want)) { best = n; bestLen = t.length; }
    }
    return best;
  },
  _gone(watch) {
    const e = new Error(this.GONE_MSG + ' (nothing matches "' + watch.selector + '" any more)');
    e.code = 'gone';
    return e;
  },

  // The page as a hidden tab would show it (main/page-render.js): for pages
  // that build themselves with JavaScript. One load, no interaction, bounded.
  async _render(watch) {
    if (!window.vex || typeof window.vex.pageWatchRender !== 'function') throw new Error('Reading a page through a hidden tab is not available in this build');
    const r = await window.vex.pageWatchRender({ url: watch.url, selector: watch.selector || '', anchor: watch.anchor || '' });
    if (!r || !r.ok) throw new Error((r && r.error) || 'The hidden tab could not read the page');
    return r;
  },

  // A home-network page, fetched by main from this computer (api:request
  // without publicOnly, which refuses private addresses on every hop).
  async _getLocal(url) {
    if (!window.vex || typeof window.vex.apiRequest !== 'function') throw new Error('Web access is not available in this build');
    const r = await window.vex.apiRequest({ url, headers: { 'User-Agent': AgentTools.UA, 'Accept-Language': 'en-US,en;q=0.9' } });
    if (!r || !r.ok) throw new Error((r && r.error) || 'The request failed');
    if (r.status >= 400) throw new Error('HTTP ' + r.status + ' from ' + new URL(url).hostname);
    return r;
  },

  // One check of one watch. Two checks of the same watch at the same moment
  // (the first look and the timer) are one check, so a change is never
  // announced twice.
  _inflight: new Map(),
  checkOne(id, now = Date.now()) {
    if (this._inflight.has(id)) return this._inflight.get(id);
    const p = this._checkOne(id, now).finally(() => this._inflight.delete(id));
    this._inflight.set(id, p);
    return p;
  },

  async _checkOne(id, now) {
    const before = this.list().find(w => w.id === id);
    if (!before) throw new Error('That watch is gone');
    const D = this._diff();
    let page = null, readErr = null;
    try { page = await this.readPage(before); }
    catch (err) { readErr = err; }
    // The list is read again after the fetch: a watch added or stopped while
    // the page was being read must not be undone by saving an old copy.
    const list = this.list();
    const watch = list.find(w => w.id === id);
    if (!watch) return { ok: false, gone: true, error: 'That watch was stopped' };
    if (readErr) {
      const err = readErr;
      // A page that fails once is a blip; one that fails five times running is
      // gone, and a watch that cannot be checked must say so rather than sit
      // there looking healthy. Each failure also makes the next check later
      // (effectiveEvery).
      watch.failures = (watch.failures || 0) + 1;
      watch.lastCheckedAt = now;
      watch.lastError = (err && err.message) || 'could not be read';
      let partGone = false;
      if (err && err.code === 'gone') {
        // The part you watched is not there any more: said once, plainly,
        // and not as if the page had changed.
        partGone = true;
        watch.partGone = true;
        if (!watch.goneTold) {
          watch.goneTold = true;
          window.showToast?.('"' + watch.title + '": ' + this.GONE_MSG, 'error', 8000);
          try { window.vex?.notify?.('Vex — a watched page', '"' + watch.title + '": ' + this.GONE_MSG); } catch {}
        }
      } else if (watch.failures === 5) {
        window.showToast?.('Cannot check "' + watch.title + '" — ' + watch.lastError, 'error');
        VexProblems?.note('Page watch', 'Gave up checking ' + watch.url, err);
      }
      this._save(list);
      return { ok: false, error: watch.lastError, ...(partGone ? { partGone: true } : {}) };
    }
    watch.failures = 0;
    watch.partGone = false;
    watch.goneTold = false;
    if (page.notModified) {
      watch.lastCheckedAt = now;
      watch.lastError = null;
      this.noteCheck(watch, now, watch.lastValue);
      this._save(list);
      return { ok: true, changed: false, from: watch.lastValue, to: watch.lastValue, why: 'not modified' };
    }
    const value = page.value;
    if (watch.kind === 'number' && value == null) {
      watch.lastCheckedAt = now;
      this._save(list);
      return { ok: false, error: 'no number found on that page' };
    }
    if (watch.kind === 'regex' && value == null) {
      watch.lastCheckedAt = now;
      watch.lastError = 'the pattern was not found on that page';
      this._save(list);
      return { ok: false, error: watch.lastError };
    }
    let verdict = this.judge(watch, value);
    const settings = this.settings();
    const snaps = this._snaps();
    const prev = (snaps[id] || []).slice(-1)[0] || null;
    let diff = null, minor = false;
    // A text watch says WHAT changed, and a difference below the chosen
    // sensitivity is not told (and not forgotten: the baseline stays, so a
    // few small changes add up to one that is).
    if (verdict.changed && watch.kind === 'text' && prev) {
      const cap = D.LIMITS.snapChars;
      const cur = page.text.length > cap ? page.text.slice(0, cap).split('\n') : page.lines;
      const ch = D.change(prev.text.split('\n'), cur, { sensitivity: settings.sensitivity });
      if (!ch.significant) {
        minor = true;
        verdict = { changed: false, from: verdict.from, to: verdict.to, why: 'minor change' };
      } else {
        diff = { added: ch.added, removed: ch.removed };
        verdict.summary = D.summarize(diff).text;
      }
    }
    watch.lastCheckedAt = now;
    watch.lastError = null;
    this.noteCheck(watch, now, value);
    if (page.etag) watch.etag = page.etag; else if (!watch.render) delete watch.etag;
    if (page.lastModified) watch.lastModified = page.lastModified; else if (!watch.render) delete watch.lastModified;
    if (verdict.changed) watch.lastChangedAt = now;
    if (!minor) watch.lastValue = value;
    // The history: the first look and every change, not every check.
    if (!minor && (verdict.changed || verdict.why === 'first look' || !prev)) {
      const text = watch.kind === 'text' ? page.text : String(value);
      D.pushSnapshot(snaps, id, { at: now, text, hash: D.fingerprint([text]) }, { ...D.LIMITS, perWatch: settings.maxSnapshots });
      this._saveSnaps(snaps);
    }
    // Never twice for the same new value.
    let announce = verdict.changed;
    if (announce) {
      const token = String(verdict.to);
      if (watch.lastAnnounced === token) announce = false;
      else watch.lastAnnounced = token;
    }
    this._save(list);
    if (announce) {
      // A condition in the person's words (js/ai-judgement.js): a change that does not meet it is held
      // back and listed (with an Undo); one that does is announced with the evidence. Never the other way:
      // when the local model cannot be asked, review() says notify.
      if (typeof WatchJudgement !== 'undefined' && WatchJudgement.applies(watch)) {
        const review = await WatchJudgement.review(watch, verdict, diff);
        if (!review.notify) return { ok: true, ...verdict, held: true, ...(diff ? { diff } : {}) };
        if (review.judged) verdict.judged = review.judged;
      }
      const wantAi = watch.summarize == null ? settings.summarize : watch.summarize;
      if (wantAi && diff) {
        const sentence = await this.aiSentence(watch, diff);
        if (sentence) {
          verdict.sentence = sentence;
          const again = this.list();
          const w2 = again.find(x => x.id === id);
          if (w2) { w2.lastSummary = sentence; this._save(again); }
        }
      }
      this.announce(watch, verdict);
    }
    return { ok: true, ...verdict, ...(diff ? { diff } : {}) };
  },

  // One sentence from the LOCAL model about what changed — and only the local
  // one: a diff of a page you watch is not sent anywhere. No local model set
  // up, no sentence, and the plain summary is told as it is.
  async aiSentence(watch, diff) {
    if (typeof Ollama === 'undefined' || typeof AIRouter === 'undefined') return '';
    let model = '';
    try { model = AIRouter.isOllamaAvailable() ? String(AIRouter.getModel() || '') : ''; } catch { model = ''; }
    if (!model) return '';
    // What changed and whether it matters: js/page-watch-explain.js.
    try {
      const E = typeof PageWatchExplain !== 'undefined' ? PageWatchExplain : require('./page-watch-explain.js').PageWatchExplain;
      return await E.explain(watch, diff, { generate: (m, p, o) => Ollama.generate(m, p, o), model });
    } catch (err) {
      VexProblems?.note('Page watch', 'The local model could not summarise a change to ' + watch.url, err);
      return '';
    }
  },

  announce(watch, verdict) {
    // A game's patch notes page speaks for itself, and waits while the game runs.
    if (typeof watch.source === 'string' && watch.source.startsWith('radar:') && typeof PatchRadar !== 'undefined') {
      PatchRadar.announce(watch, verdict);
      document.dispatchEvent(new CustomEvent('vex:page-watch', { detail: { watch, verdict } }));
      return;
    }
    // A page on the announcement desk is told by the desk (js/announce-desk.js): once, on its result words.
    if (watch.source === 'announce-desk' && typeof AnnounceDesk !== 'undefined') {
      AnnounceDesk.announce(watch, verdict);
      document.dispatchEvent(new CustomEvent('vex:page-watch', { detail: { watch, verdict } }));
      return;
    }
    // A page on the appointment slot watcher (js/slot-watcher.js) is told only when an open-slot word shows up.
    if (watch.source === 'slot-watcher' && typeof VexSlotWatcher !== 'undefined') {
      VexSlotWatcher.announce(watch, verdict);
      document.dispatchEvent(new CustomEvent('vex:page-watch', { detail: { watch, verdict } }));
      return;
    }
    let what;
    if (watch.kind === 'number' || watch.kind === 'regex') what = `${watch.title} ${verdict.why}`;
    else what = `${watch.title} changed` + (verdict.sentence ? ' — ' + verdict.sentence : '');
    if (verdict.judged) what += ' (matters: ' + verdict.judged.why + (verdict.judged.evidence ? '; "' + verdict.judged.evidence + '"' : '') + ')';
    const body = verdict.summary && !verdict.sentence ? what + '\n' + verdict.summary : what;
    const show = () => {
      window.showToast?.(what, 'info', 8000);
      // A desktop notification as well: the point of a watch is that you are not
      // looking at Vex (js/notify goes through the main process).
      try { window.vex?.notify?.('Vex — a page changed', body); } catch {}
    };
    // One alert per change, waiting for the next digest unless the person asked for it at once
    // (js/watch-alerts.js; off = the lines above, as before).
    if (typeof WatchAlerts === 'undefined' || !WatchAlerts.route({ source: 'page-watch', entity: watch.url, title: what, body: verdict.summary || '', url: watch.url, show })) show();
    document.dispatchEvent(new CustomEvent('vex:page-watch', { detail: { watch, verdict } }));
  },

  // How long to wait before a watch is asked again: its own pace, doubled for
  // each failure after the first, never past a day. A page that is down is
  // not hammered.
  effectiveEvery(w) {
    const n = Math.max(0, (w.failures || 0) - 1);
    return Math.max(w.every, Math.min(this.MAX_BACKOFF, w.every * Math.pow(2, Math.min(n, 8))));
  },

  // Whatever is due, one at a time so a dozen watches do not all fetch at once.
  async checkDue(now = Date.now()) {
    if (!this.settings().enabled) return [];
    const due = this.list().filter(w => !w.paused && now - (w.lastCheckedAt || 0) >= this.effectiveEvery(w));
    const out = [];
    for (const w of due) {
      try { out.push({ id: w.id, ...(await this.checkOne(w.id, now)) }); }
      catch (err) { VexProblems?.note('Page watch', 'A check failed', err); }
    }
    return out;
  },

  // Vex wakes for a watch the way it wakes for an alarm: one daily reminder
  // (main/reminders.js keeps a Windows task for it) that opens Vex, which
  // then checks whatever is due. One reminder serves every watch that asked;
  // it goes when the last of them is paused or stopped.
  // One at a time: two watches added together must not each make one.
  syncWake() {
    this._wakeP = (this._wakeP || Promise.resolve()).then(() => this._syncWake()).catch((err) => {
      VexProblems?.note('Page watch', 'Could not set up (or remove) the daily wake-up for watched pages', err);
      window.showToast?.('The wake-up for watched pages could not be set: ' + ((err && err.message) || 'unknown error'), 'error');
      return null;
    });
    return this._wakeP;
  },
  async _syncWake() {
    const b = window.vex && window.vex.reminders;
    if (!b || typeof b.list !== 'function') return null;
    const want = this.settings().enabled && this.list().some(w => w.wake && !w.paused);
    const mine = (await b.list()).filter(r => r.message === this.WAKE_MESSAGE);
    if (want && !mine.length) {
      const d = new Date();
      d.setHours(8, 0, 0, 0);
      if (d.getTime() - Date.now() < 5 * 60000) d.setDate(d.getDate() + 1);
      return b.create(this.WAKE_MESSAGE, d.getTime(), { repeat: 'daily' });
    }
    if (!want) for (const r of mine) await b.delete(r.id);
    return null;
  },

  // "Watch This Page" in Ctrl+K: the whole page, any change, the default pace.
  // The first look sets the baseline.
  async watchPage(url, title, { partition = null } = {}) {
    let watch;
    try { watch = this.add({ url, title: title || url, byUser: true, partition }); }
    catch (err) { window.showToast?.((err && err.message) || 'Could not watch it', 'error'); return null; }
    window.showToast?.('Watching — Vex will say when it changes' + (watch.local ? '. ' + this.localNote(watch) : ''));
    await this.firstLook(watch);
    return watch;
  },

  // A change you have looked at is no longer news in the list.
  isUnseen(w) { return !!(w.lastChangedAt && w.lastChangedAt > (w.seenAt || 0)); },
  markSeen(id) {
    const list = this.list();
    const w = list.find(x => x.id === id);
    if (!w) return;
    w.seenAt = Date.now();
    this._save(list);
  },

  // Vex used to have two watchers: this one, and an older "Watch This Page"
  // (PageMonitor, 'vex.watches') that kept its own list, fetched pages around
  // Tor/proxy/container routing and compared the raw markup, so adverts and
  // timestamps read as changes. Its watches move here once; the old key goes.
  LEGACY_KEY: 'vex.watches',
  migrateLegacy() {
    const raw = localStorage.getItem(this.LEGACY_KEY);
    if (raw == null) return 0;
    let old;
    try { old = JSON.parse(raw); }
    catch (err) { VexProblems?.note('Page watch', 'The old watched pages could not be read, so they were left as they are', err); return 0; }
    const list = this.list();
    let moved = 0;
    for (const w of Array.isArray(old) ? old : []) {
      if (!w || !/^https?:/i.test(String(w.url || ''))) continue;
      if (list.some(x => x.url === w.url && !(x.selector || ''))) continue;
      list.push({
        id: 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        url: String(w.url), title: String(w.title || w.url), selector: '',
        kind: 'text', direction: 'any', target: null,
        every: Math.max(5, Number(w.intervalMin) || 30) * 60000,
        addedAt: Date.now(), lastCheckedAt: 0, lastValue: null,
        lastChangedAt: w.changed ? (Number(w.changedAt) || Date.now()) : 0, failures: 0,
        // The old list only ever held watches the user added in Ctrl+K: one
        // on the router or a NAS stays checkable from this computer (add).
        ...(this.isLocal(w.url) ? { local: true, byUser: true } : {}),
      });
      moved++;
    }
    if (!this._save(list)) throw new Error('The old watched pages could not be moved');
    localStorage.removeItem(this.LEGACY_KEY);
    return moved;
  },

  _everyLabel(ms) {
    const known = this.EVERY.find(e => e.ms === ms);
    if (known) return known.label;
    const min = Math.round(ms / 60000);
    return min < 120 ? 'every ' + min + ' minutes' : 'every ' + Math.round(min / 60) + ' hours';
  },

  // "Watched pages": every watch, what it last saw, when it last changed, and
  // what you can do with it: open the page, see what changed, pause, stop.
  // GitHub runs and releases (js/github-watch.js) are listed at the end.
  showManager() {
    const esc = (s) => window.escapeHtml(s);
    document.getElementById('vex-watches')?.remove();
    const list = this.list();
    const m = document.createElement('div');
    m.id = 'vex-watches';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-labelledby', 'vex-watches-title');
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    const ago = (t) => {
      if (!t) return 'never';
      const min = Math.max(0, Math.round((Date.now() - t) / 60000));
      if (min < 1) return 'just now';
      if (min < 60) return min + ' min ago';
      if (min < 2880) return Math.round(min / 60) + ' h ago';
      return new Date(t).toLocaleDateString();
    };
    const btn = 'padding:5px 10px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px';
    const rows = list.length ? list.map(w => {
      let host = w.url; try { host = new URL(w.url).hostname.replace(/^www\./, ''); } catch { /* shown as given */ }
      const when = w.lastCheckedAt ? new Date(w.lastCheckedAt).toLocaleString() : 'not yet';
      const fresh = this.isUnseen(w);
      const what = (w.selector ? ' · ' + w.selector : '') + (w.kind === 'regex' ? ' · ' + (w.pattern || 'pattern') : '');
      const state = w.paused ? 'Paused' : (w.partGone ? this.GONE_MSG : (w.lastError || ''));
      const hist = this.history(w.id).length;
      const dot = w.paused ? 'var(--text-muted)' : (w.partGone || w.lastError ? 'var(--danger,#e5484d)' : (fresh ? '#22c55e' : 'var(--text-muted)'));
      return `<div data-id="${esc(w.id)}" style="display:flex;align-items:center;gap:10px;padding:9px 8px;border-bottom:1px solid var(--border)">
        <span style="width:8px;height:8px;border-radius:50%;background:${dot};flex:none"></span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(w.title)}${fresh ? ' <span style="color:var(--success);font-size:11px">changed</span>' : ''}${w.paused ? ' <span style="color:var(--text-muted);font-size:11px">paused</span>' : ''}</div>
          <div style="font-size:11px;color:var(--text-muted)">${esc(host + what)} · ${esc(this._everyLabel(w.every))}${w.wake ? ' · wakes Vex' : ''}${w.render ? ' · hidden tab' : ''} · checked ${esc(when)}${w.lastChangedAt ? ' · changed ' + esc(ago(w.lastChangedAt)) : ''}${(w.kind === 'number' || w.kind === 'regex') ? ' · ' + esc(this.checkLine(w)) : ''}${state ? ' · ' + esc(state) : ''}${w.source && w.source !== 'user' ? ' · from ' + esc(w.source) : ''}</div>
          ${w.lastSummary ? `<div style="font-size:11.5px;color:var(--text)">${esc(w.lastSummary)}</div>` : ''}
          ${w.local ? `<div class="pw-local-note" style="font-size:11px;color:var(--text-muted)">${esc(this.localNote(w))}</div>` : ''}
        </div>
        ${hist > 1 && typeof PageWatchUI !== 'undefined' ? `<button data-diff style="${btn}">What changed</button>` : ''}
        ${(w.kind === 'number' || w.kind === 'regex') && hist > 0 && typeof PriceStock !== 'undefined' ? `<button data-chart style="${btn}">History</button>` : ''}
        <button data-open style="${btn}">Open</button>
        <button data-pause style="${btn}">${w.paused ? 'Resume' : 'Pause'}</button>
        <button data-x title="Stop watching" aria-label="Stop watching ${esc(w.title)}" style="width:26px;height:26px;border:none;background:none;color:var(--text-muted);cursor:pointer;line-height:0">${window.VexIcons ? VexIcons.svg('x', { size: 14 }) : 'Stop'}</button>
      </div>`;
    }).join('') : '<div style="color:var(--text-muted);font-size:12.5px;padding:14px 8px">Not watching any pages. Right-click a page and choose “Watch this page for changes”, or press Ctrl+K and type “watch”.</div>';
    let github = '';
    if (typeof GitHubWatch !== 'undefined' && typeof GitHubWatch.list === 'function') {
      const gh = GitHubWatch.list();
      if (gh.length) github = '<div style="font-size:11.5px;color:var(--text-muted);padding:10px 8px 2px">GitHub</div>' + gh.map(g => `<div data-gh="${esc(g.id)}" style="display:flex;align-items:center;gap:10px;padding:7px 8px;border-bottom:1px solid var(--border)"><div style="flex:1;min-width:0;font-size:13px;color:var(--text)">${esc(GitHubWatch.describe(g))}</div><button data-ghx aria-label="Stop watching ${esc(GitHubWatch.describe(g))}" title="Stop watching" style="width:26px;height:26px;border:none;background:none;color:var(--text-muted);cursor:pointer;line-height:0">${window.VexIcons ? VexIcons.svg('x', { size: 14 }) : 'Stop'}</button></div>`).join('');
    }
    const s = this.settings();
    m.innerHTML = `<div style="width:680px;max-width:94vw;max-height:80vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">
        <div style="padding:16px 18px 10px;display:flex;align-items:center;gap:10px"><strong id="vex-watches-title" style="font-size:16px;color:var(--text)">Watched pages</strong><span style="flex:1"></span>${s.enabled ? '' : '<span style="color:var(--text-muted);font-size:12px">Switched off in Settings</span>'}<button id="wt-close" style="padding:7px 16px;background:var(--primary);color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600">Done</button></div>
        <div style="overflow-y:auto;padding:0 18px 16px">${rows}${github}</div>
      </div>`;
    document.body.appendChild(m);
    // Escape closes it the way Done does. Capture phase, so nothing underneath
    // takes the same key; an Escape meant for a Vex dialog on top is left to it.
    const onKey = (e) => {
      if (!m.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay, #pw-diff')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); };
    document.addEventListener('keydown', onKey, true);
    m.querySelector('#wt-close').addEventListener('click', close);
    m.querySelector('#wt-close').focus({ preventScroll: true });
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    const reopen = () => { close(); this.showManager(); };
    m.querySelectorAll('[data-id]').forEach(row => {
      const w = list.find(x => x.id === row.dataset.id);
      row.querySelector('[data-open]').addEventListener('click', () => { this.markSeen(w.id); TabManager.createTab(w.url, true); close(); });
      row.querySelector('[data-chart]')?.addEventListener('click', () => PriceStock.show(w.id));
      row.querySelector('[data-diff]')?.addEventListener('click', () => PageWatchUI.showDiff(w.id));
      row.querySelector('[data-pause]').addEventListener('click', () => {
        try { this.setPaused(w.id, !w.paused); } catch (err) { window.showToast?.((err && err.message) || 'Could not change it', 'error'); return; }
        reopen();
      });
      row.querySelector('[data-x]').addEventListener('click', async () => {
        // A watch with a history of changes is not dropped by a stray click.
        if (this.history(w.id).length > 1 && typeof vexConfirm === 'function') {
          const ok = await vexConfirm({ title: 'Stop watching?', message: '“' + w.title + '” and what Vex kept of it will be removed.', okLabel: 'Stop watching', cancelLabel: 'Keep it' });
          if (!ok) return;
        }
        this.remove(w.id); reopen();
      });
    });
    m.querySelectorAll('[data-gh]').forEach(row => {
      row.querySelector('[data-ghx]').addEventListener('click', () => { GitHubWatch.remove(row.dataset.gh); reopen(); });
    });
  },

  start() {
    if (this._timer) return;
    // A private window keeps nothing: it does not run anybody's watches.
    if (this._privateWindow()) return;
    try { this.migrateLegacy(); }
    catch (err) { window.showToast?.((err && err.message) || 'The old watched pages could not be moved', 'error'); }
    // The first look sets the baseline; nothing is announced from it.
    // On battery (js/battery-mode.js) this first sweep is put off with the rest.
    setTimeout(() => {
      if (typeof BatteryMode !== 'undefined' && BatteryMode.defer('page-watch-first', () => this.checkDue())) return;
      this.checkDue();
    }, 20000);
    this._timer = VexJobs.every('Page watches', 60000, () => this.checkDue(), { when: 'background', deferOnBattery: true });
  },
};

if (typeof window !== 'undefined') window.PageWatch = PageWatch;
if (typeof module !== 'undefined' && module.exports) module.exports = { PageWatch };
