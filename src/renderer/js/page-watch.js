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
const PageWatch = {
  KEY: 'vex.pageWatches',
  EVERY: [
    { ms: 5 * 60000, label: 'every 5 minutes' },
    { ms: 15 * 60000, label: 'every 15 minutes' },
    { ms: 60 * 60000, label: 'every hour' },
    { ms: 6 * 3600000, label: 'every 6 hours' },
    { ms: 24 * 3600000, label: 'once a day' },
  ],

  list() { try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  _save(list) {
    try { localStorage.setItem(this.KEY, JSON.stringify(list)); return true; }
    catch (err) { VexProblems?.note('Page watch', 'Could not save the watches', err); return false; }
  },

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
  add({ url, title, selector, kind = 'text', every = 15 * 60000, direction = 'any', target = null, byUser = false, partition = null }) {
    if (!/^https?:/i.test(String(url || ''))) throw new Error('Only a web page can be watched');
    if (partition && typeof TabManager !== 'undefined' && typeof TabManager.windowMayAsk === 'function' && !TabManager.windowMayAsk(partition)) throw new Error(this.OWN_SESSION_REFUSED);
    const local = this.isLocal(url);
    if (local && !byUser) throw new Error(this.LOCAL_REFUSED);
    const list = this.list();
    if (list.some(w => w.url === url && (w.selector || '') === (selector || ''))) throw new Error('That is already being watched');
    const watch = {
      id: 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      url: String(url), title: String(title || url), selector: String(selector || '').slice(0, 200),
      kind: kind === 'number' ? 'number' : 'text',
      direction: ['up', 'down', 'any', 'below', 'above'].includes(direction) ? direction : 'any',
      target: target == null ? null : Number(target),
      every: Number(every) || 15 * 60000,
      addedAt: Date.now(), lastCheckedAt: 0, lastValue: null, lastChangedAt: 0, failures: 0,
      ...(local ? { local: true, byUser: true } : {}),
    };
    list.push(watch);
    if (!this._save(list)) throw new Error('The watch could not be saved');
    return watch;
  },

  remove(id) { this._save(this.list().filter(w => w.id !== id)); },

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

  // Is this worth telling the user about?
  // → { changed, from, to, why } — `why` is the sentence they see.
  judge(watch, value) {
    const before = watch.lastValue;
    if (before == null) return { changed: false, from: null, to: value, why: 'first look' };
    if (watch.kind === 'number') {
      const a = Number(before), b = Number(value);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return { changed: false, from: a, to: b, why: 'no change' };
      const dir = b > a ? 'up' : 'down';
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
    // A watch saved before whole pages were fingerprinted holds plain text:
    // the first look in the new form is a new baseline, not a change.
    if (this._isPageValue(value) !== this._isPageValue(before)) return { changed: false, from: before, to: value, why: 'first look' };
    const same = this._steady(before) === this._steady(value);
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
  _pageValue(text) {
    const steady = this._steady(text);
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
  // the page is fetched, not opened.
  async readValue(watch) {
    if (typeof AgentTools === 'undefined') throw new Error('Page reading is not available');
    // The check is fetched from Vex's window, which goes out directly; a site
    // you route through Tor, a proxy or a container would see your real
    // address (found 2026-09-30).
    if (typeof TabManager !== 'undefined' && !TabManager.mayAskSiteForIcon(watch.url)) throw new Error('This site goes through Tor, a proxy or a container, and a watch would check it from your real connection — so it is not checked');
    let text, raw = null;
    if (this.isLocal(watch.url)) {
      // Only a watch the user added on a home-network address (add) is read
      // from here; anything else, a hand-edited list included, is refused.
      if (!(watch.local === true && watch.byUser === true)) throw new Error(this.LOCAL_REFUSED);
      raw = await this._getLocal(watch.url);
      const body = String(raw.body || '');
      const type = String((raw.headers && (raw.headers['content-type'] || raw.headers['Content-Type'])) || '').toLowerCase();
      text = /html|xml/.test(type) || /^\s*</.test(body) ? AgentTools.htmlToText(body).text : body;
    } else {
      text = String((await AgentTools.readUrl(watch.url, { maxText: Infinity })).text || '');
    }
    if (watch.selector) {
      // A selector needs the real document, so this path uses the page's
      // markup rather than the readable text.
      raw = raw || await AgentTools._get(watch.url);
      const doc = new DOMParser().parseFromString(String(raw.body || ''), 'text/html');
      const el = doc.querySelector(watch.selector);
      if (!el) throw new Error('Nothing on that page matches "' + watch.selector + '" any more');
      text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    }
    if (watch.kind === 'number') return this.firstNumber(text);
    return watch.selector ? text.slice(0, 4000) : this._pageValue(text);
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

  async checkOne(id, now = Date.now()) {
    const before = this.list().find(w => w.id === id);
    if (!before) throw new Error('That watch is gone');
    let value, readErr = null;
    try { value = await this.readValue(before); }
    catch (err) { readErr = err; }
    // The list is read again after the fetch: a watch added or stopped while
    // the page was being read must not be undone by saving an old copy.
    const list = this.list();
    const watch = list.find(w => w.id === id);
    if (!watch) return { ok: false, gone: true, error: 'That watch was stopped' };
    if (!readErr) watch.failures = 0;
    else {
      const err = readErr;
      // A page that fails once is a blip; one that fails five times running is
      // gone, and a watch that cannot be checked must say so rather than sit
      // there looking healthy.
      watch.failures = (watch.failures || 0) + 1;
      watch.lastCheckedAt = now;
      watch.lastError = (err && err.message) || 'could not be read';
      this._save(list);
      if (watch.failures === 5) {
        window.showToast?.('Cannot check "' + watch.title + '" — ' + watch.lastError, 'error');
        VexProblems?.note('Page watch', 'Gave up checking ' + watch.url, err);
      }
      return { ok: false, error: watch.lastError };
    }
    if (watch.kind === 'number' && value == null) {
      watch.lastCheckedAt = now;
      this._save(list);
      return { ok: false, error: 'no number found on that page' };
    }
    const verdict = this.judge(watch, value);
    watch.lastCheckedAt = now;
    watch.lastError = null;
    if (verdict.changed) watch.lastChangedAt = now;
    watch.lastValue = value;
    this._save(list);
    if (verdict.changed) this.announce(watch, verdict);
    return { ok: true, ...verdict };
  },

  announce(watch, verdict) {
    const what = watch.kind === 'number' ? `${watch.title} ${verdict.why}` : `${watch.title} changed`;
    window.showToast?.(what, 'info', 8000);
    // A desktop notification as well: the point of a watch is that you are not
    // looking at Vex (js/notify goes through the main process).
    try { window.vex?.notify?.('Vex — a page changed', what); } catch {}
    document.dispatchEvent(new CustomEvent('vex:page-watch', { detail: { watch, verdict } }));
  },

  // Whatever is due, one at a time so a dozen watches do not all fetch at once.
  async checkDue(now = Date.now()) {
    const due = this.list().filter(w => now - (w.lastCheckedAt || 0) >= w.every);
    const out = [];
    for (const w of due) {
      try { out.push({ id: w.id, ...(await this.checkOne(w.id, now)) }); }
      catch (err) { VexProblems?.note('Page watch', 'A check failed', err); }
    }
    return out;
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

  // "Watched Pages": every watch, what it last saw, Open and Stop watching.
  showManager() {
    const esc = (s) => window.escapeHtml(s);
    document.getElementById('vex-watches')?.remove();
    const list = this.list();
    const m = document.createElement('div');
    m.id = 'vex-watches';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    const rows = list.length ? list.map(w => {
      let host = w.url; try { host = new URL(w.url).hostname.replace(/^www\./, ''); } catch {}
      const when = w.lastCheckedAt ? new Date(w.lastCheckedAt).toLocaleString() : 'not yet';
      const fresh = this.isUnseen(w);
      const what = w.selector ? ' · ' + w.selector : '';
      return `<div data-id="${esc(w.id)}" style="display:flex;align-items:center;gap:10px;padding:9px 8px;border-bottom:1px solid var(--border)">
        <span style="width:8px;height:8px;border-radius:50%;background:${fresh ? '#22c55e' : 'var(--text-muted)'};flex:none"></span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(w.title)}${fresh ? ' <span style="color:var(--success);font-size:11px">changed</span>' : ''}</div>
          <div style="font-size:11px;color:var(--text-muted)">${esc(host + what)} · ${esc(this._everyLabel(w.every))} · checked ${esc(when)}${w.lastError ? ' · ' + esc(w.lastError) : ''}</div>
          ${w.local ? `<div class="pw-local-note" style="font-size:11px;color:var(--text-muted)">${esc(this.localNote(w))}</div>` : ''}
        </div>
        <button data-open style="padding:5px 10px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px">Open</button>
        <button data-x title="Stop watching" aria-label="Stop watching" style="width:26px;height:26px;border:none;background:none;color:var(--text-muted);cursor:pointer;line-height:0">${window.VexIcons ? VexIcons.svg('x', { size: 14 }) : 'Stop'}</button>
      </div>`;
    }).join('') : '<div style="color:var(--text-muted);font-size:12.5px;padding:14px 8px">Not watching any pages. Ctrl+K → “Watch This Page”.</div>';
    m.innerHTML = `<div style="width:520px;max-width:94vw;max-height:80vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">
        <div style="padding:16px 18px 10px;display:flex;align-items:center;gap:10px"><strong style="font-size:16px;color:var(--text)">Watched pages</strong><span style="flex:1"></span><button id="wt-close" style="padding:7px 16px;background:var(--primary);color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600">Done</button></div>
        <div style="overflow-y:auto;padding:0 18px 16px">${rows}</div>
      </div>`;
    document.body.appendChild(m);
    // Escape closes it the way Done does. Capture phase, so nothing underneath
    // takes the same key; an Escape meant for a Vex dialog on top is left to it.
    const onKey = (e) => {
      if (!m.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); };
    document.addEventListener('keydown', onKey, true);
    m.querySelector('#wt-close').addEventListener('click', close);
    m.querySelector('#wt-close').focus({ preventScroll: true });
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    m.querySelectorAll('[data-id]').forEach(row => {
      const w = list.find(x => x.id === row.dataset.id);
      row.querySelector('[data-open]').addEventListener('click', () => { this.markSeen(w.id); TabManager.createTab(w.url, true); close(); });
      row.querySelector('[data-x]').addEventListener('click', () => { this.remove(w.id); close(); this.showManager(); });
    });
  },

  start() {
    if (this._timer) return;
    try { this.migrateLegacy(); }
    catch (err) { window.showToast?.((err && err.message) || 'The old watched pages could not be moved', 'error'); }
    // The first look sets the baseline; nothing is announced from it.
    setTimeout(() => this.checkDue(), 20000);
    this._timer = VexJobs.every('Page watches', 60000, () => this.checkDue(), { when: 'background' });
  },
};

if (typeof window !== 'undefined') window.PageWatch = PageWatch;
if (typeof module !== 'undefined' && module.exports) module.exports = { PageWatch };
