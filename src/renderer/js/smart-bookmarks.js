// === Bookmarks that stay alive ==============================================
//
// A bookmark is a promise that a page will be there. This keeps the promise
// honest: for the bookmarks you choose, Vex keeps a snapshot of the page's
// text and, now and then, looks again to say one of
//
//   still the same   the page says what it said
//   changed          lines were added or removed (the same rules as Page
//                    Watcher: clock times, "5 minutes ago" and cookie banners
//                    do not count)
//   dead             the page is gone (404 / 410, or unreachable three times)
//
// A changed or dead page keeps its snapshot, and the snapshot can always be
// read, copied or searched for in the Wayback Machine.
//
// What it will not do:
//   * look at a page you have not switched on (it is per bookmark, and the
//     whole thing is off until you turn it on in Settings)
//   * look more than once per interval per page (6 hours at the quickest), more
//     than three pages per round, or two pages of one site in a round
//   * look in the background while a game runs, or at all when the bookmark came
//     from a Tor, proxy or private session
// The check is a plain GET from Vex's window, the same read Read Later uses.
const SmartBookmarks = {
  KEY: 'vex.smartBookmarks',          // { [bookmarkId]: state }
  SNAP_KEY: 'vex.smartBookmarks.snaps', // { [bookmarkId]: [{ at, text, hash }] }
  PREFS_KEY: 'vex.smartBookmarks.prefs',
  MAX_PER_ROUND: 3,
  INTERVALS: { 6: '6 hours', 24: 'a day', 168: 'a week' },
  DEAD_AFTER: 3,
  SNAP: { perWatch: 3, snapChars: 30000, totalChars: 600000, lineChars: 400 },

  // ---- prefs ----------------------------------------------------------------
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.PREFS_KEY) || 'null'); } catch { raw = null; }
    const hours = raw && Object.keys(this.INTERVALS).map(Number).includes(raw.hours) ? raw.hours : 24;
    return { enabled: !!(raw && raw.enabled === true), hours };
  },
  setPrefs(patch) {
    const next = { ...this.prefs(), ...patch };
    if (!Object.keys(this.INTERVALS).map(Number).includes(next.hours)) throw new Error('Pick 6 hours, a day or a week');
    localStorage.setItem(this.PREFS_KEY, JSON.stringify({ enabled: !!next.enabled, hours: next.hours }));
    return next;
  },
  isEnabled() { return this.prefs().enabled; },

  // js/page-watch-diff.js: loaded before this file in Vex; required in tests.
  _diff() { return (typeof PageWatchDiff !== 'undefined' && PageWatchDiff) || require('./page-watch-diff.js').PageWatchDiff; },

  // ---- state ----------------------------------------------------------------
  _read(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : fallback; } catch { return fallback; }
  },
  states() { return this._read(this.KEY, {}); },
  snaps() { return this._read(this.SNAP_KEY, {}); },
  _write(key, v) { localStorage.setItem(key, JSON.stringify(v)); },
  stateOf(id) { return this.states()[id] || null; },
  snapshotsOf(id) { return (this.snaps()[id] || []).slice(); },

  // Can this bookmark be looked at from here at all?
  eligible(b) {
    if (!b || !b.url) return { ok: false, why: 'It has no address' };
    if (!/^https:\/\//i.test(b.url) && !/^http:\/\//i.test(b.url)) return { ok: false, why: 'Only web pages can be kept alive' };
    if (b.ownSession || b.private || b.tor) return { ok: false, why: 'It was saved from a private, Tor or routed session, so Vex will not look at it from here' };
    try { if (/\.onion$/i.test(new URL(b.url).hostname)) return { ok: false, why: 'Onion addresses are not looked at from here' }; } catch { return { ok: false, why: 'Not a valid address' }; }
    if (typeof AgentTools !== 'undefined' && AgentTools.isPrivateHost) {
      try { if (AgentTools.isPrivateHost(new URL(b.url).hostname)) return { ok: false, why: 'Pages on this PC or your network are not looked at' }; } catch { /* handled above */ }
    }
    if (typeof TabManager !== 'undefined' && typeof TabManager.mayAskSiteForIcon === 'function' && !TabManager.mayAskSiteForIcon(b.url, { partition: b.partition })) {
      return { ok: false, why: 'A site rule routes this site privately, so Vex will not look at it directly' };
    }
    return { ok: true };
  },

  // ---- decisions (pure) -----------------------------------------------------
  // What an error from a read means for the page.
  classifyError(err) {
    const m = String((err && err.message) || err || '');
    if (/\bHTTP (404|410)\b/.test(m)) return 'gone';
    if (/\bHTTP (401|403|429)\b/.test(m)) return 'blocked';      // it is there, it will not say
    if (/is a .*not a page/i.test(m)) return 'blocked';           // a file, not a page
    return 'unreachable';
  },

  // Which bookmarks are due, oldest-looked-at first, at most `max`, one per site.
  due(states, bookmarks, { now = Date.now(), hours = 24, max = this.MAX_PER_ROUND, gaming = false } = {}) {
    if (gaming) return [];
    const every = hours * 3600000;
    const byId = new Map((bookmarks || []).map(b => [b.id, b]));
    const cand = [];
    for (const [id, s] of Object.entries(states || {})) {
      const b = byId.get(id);
      if (!b || !s || s.on === false) continue;
      if (now - (s.lastCheckedAt || 0) < every) continue;
      cand.push({ b, last: s.lastCheckedAt || 0 });
    }
    cand.sort((a, c) => a.last - c.last);
    const hosts = new Set();
    const out = [];
    for (const { b } of cand) {
      let host = '';
      try { host = new URL(b.url).hostname; } catch { continue; }
      if (hosts.has(host)) continue;
      hosts.add(host);
      out.push(b);
      if (out.length >= max) break;
    }
    return out;
  },

  // Given the previous snapshot lines, the new page's lines and the page's
  // state, the next state. `outcome` is { lines } or { error }.
  decide(prev, outcome, { now = Date.now(), sensitivity = 'normal' } = {}) {
    const s = { ...(prev || {}) };
    s.lastCheckedAt = now;
    if (outcome.error) {
      const kind = this.classifyError(outcome.error);
      s.error = String((outcome.error && outcome.error.message) || outcome.error).slice(0, 200);
      if (kind === 'gone') { s.status = 'dead'; s.failures = this.DEAD_AFTER; s.deadSince = s.deadSince || now; }
      else if (kind === 'blocked') { s.status = s.status && s.status !== 'new' ? s.status : 'unchecked'; }
      else {
        s.failures = (s.failures || 0) + 1;
        if (s.failures >= this.DEAD_AFTER) { s.status = 'dead'; s.deadSince = s.deadSince || now; }
      }
      return { state: s, snapshot: null };
    }
    s.error = null; s.failures = 0; delete s.deadSince;
    const lines = outcome.lines;
    const hash = this._diff().fingerprint(lines);
    const text = lines.join('\n');
    if (!prev || !prev.hash) {
      s.status = 'same'; s.hash = hash; s.since = now; s.changeSummary = null;
      return { state: s, snapshot: { at: now, text, hash } };
    }
    if (prev.hash === hash) {
      // It is the same page again: a dead mark is lifted, a pending "changed"
      // stays until the person has seen it.
      if (prev.status === 'dead' || prev.status === 'unchecked') s.status = prev.changedAt ? 'changed' : 'same';
      return { state: s, snapshot: null };
    }
    const before = outcome.before || [];
    const c = this._diff().change(before, lines, { sensitivity });
    if (!c.significant) {
      // Differences too small to report: the baseline moves quietly.
      s.hash = hash;
      if (prev.status === 'dead') s.status = 'same';
      return { state: s, snapshot: { at: now, text, hash } };
    }
    s.status = 'changed'; s.hash = hash; s.changedAt = now;
    s.changeSummary = this._diff().summarize(c, { maxLines: 6 }).text;
    return { state: s, snapshot: { at: now, text, hash } };
  },

  // ---- operations -----------------------------------------------------------
  statusWords(s) {
    if (!s) return 'Not kept alive';
    return { same: 'Still the same', changed: 'Changed', dead: 'Dead', new: 'Not checked yet', unchecked: 'Cannot be checked' }[s.status] || 'Not checked yet';
  },

  list() {
    const marks = typeof Bookmarks !== 'undefined' && Array.isArray(Bookmarks.items) ? Bookmarks.items : this._read('vex.bookmarks', []);
    const states = this.states();
    return (Array.isArray(marks) ? marks : []).filter(b => states[b.id]).map(b => ({ bookmark: b, state: states[b.id] }));
  },

  _bookmark(id) {
    const marks = typeof Bookmarks !== 'undefined' && Array.isArray(Bookmarks.items) ? Bookmarks.items : [];
    return marks.find(b => b.id === id) || null;
  },

  // Switch a bookmark on. The first look is made now, because you asked.
  async keepAlive(id) {
    const b = this._bookmark(id);
    if (!b) throw new Error('That bookmark is not in your list');
    const e = this.eligible(b);
    if (!e.ok) throw new Error(e.why);
    const states = this.states();
    states[id] = { ...(states[id] || {}), on: true, status: (states[id] && states[id].status) || 'new', failures: 0, addedAt: Date.now() };
    this._write(this.KEY, states);
    return this.checkOne(id, { force: true });
  },

  stopKeeping(id, { forget = false } = {}) {
    const states = this.states();
    delete states[id];
    this._write(this.KEY, states);
    if (forget) { const sn = this.snaps(); delete sn[id]; this._write(this.SNAP_KEY, sn); }
  },

  // "Seen it": the changed mark goes, the snapshot stays as the baseline.
  markSeen(id) {
    const states = this.states();
    if (!states[id]) return;
    if (states[id].status === 'changed') states[id].status = 'same';
    states[id].changeSummary = null;
    this._write(this.KEY, states);
  },

  async _read_page(url) {
    if (typeof AgentTools === 'undefined') throw new Error('Reading pages is not available in this window');
    const r = await AgentTools.readUrl(url, { maxText: Infinity });
    return this._diff().normalizeText(String(r.text || ''), { steady: true });
  },

  _gaming() {
    return (typeof GameMode !== 'undefined' && !!GameMode.gaming) || (typeof GameSession !== 'undefined' && !!GameSession.active);
  },

  async checkOne(id, { force = false } = {}) {
    if (!force && this._gaming()) throw new Error('Not while a game is running');
    const b = this._bookmark(id);
    const states = this.states();
    const prev = states[id];
    if (!b || !prev) throw new Error('That bookmark is not being kept alive');
    const e = this.eligible(b);
    if (!e.ok) throw new Error(e.why);
    const snaps = this.snaps();
    const last = (snaps[id] || [])[(snaps[id] || []).length - 1];
    const before = last ? this._diff().normalizeText(last.text, { steady: true }) : [];
    let outcome;
    try { outcome = { lines: await this._read_page(b.url), before }; }
    catch (err) { outcome = { error: err }; }
    if (!outcome.error && !outcome.lines.length) outcome = { error: new Error('The page had no readable text') };
    const { state, snapshot } = this.decide(prev, outcome);
    const fresh = this.states();
    fresh[id] = state;
    this._write(this.KEY, fresh);
    if (snapshot) {
      const store = this.snaps();
      this._diff().pushSnapshot(store, id, snapshot, this.SNAP);
      this._write(this.SNAP_KEY, store);
    }
    if (state.status === 'changed' && prev.status !== 'changed') this._tell('Changed: ' + (b.title || b.url));
    else if (state.status === 'dead' && prev.status !== 'dead') this._tell('Gone: ' + (b.title || b.url) + ' — its snapshot is kept');
    return state;
  },

  _tell(text) {
    window.showToast?.(text, 'info', 8000);
    try { document.dispatchEvent(new CustomEvent('vex:smart-bookmark', { detail: { text } })); } catch { /* no document */ }
  },

  // One round: what is due, a few at a time. Quiet when nothing is.
  async sweep(now = Date.now()) {
    const p = this.prefs();
    if (!p.enabled || this._gaming()) return [];
    if (typeof window !== 'undefined' && window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return [];
    const marks = typeof Bookmarks !== 'undefined' && Array.isArray(Bookmarks.items) ? Bookmarks.items : [];
    const due = this.due(this.states(), marks, { now, hours: p.hours, gaming: false });
    const out = [];
    for (const b of due) {
      if (this._gaming()) break;
      try { out.push({ id: b.id, state: await this.checkOne(b.id) }); }
      catch (err) { window.VexProblems?.note('Living bookmarks', 'A check failed', err); }
    }
    return out;
  },

  start() {
    if (this._job || typeof VexJobs === 'undefined') return;
    // Every 30 minutes the round asks what is due; most rounds do nothing.
    this._job = VexJobs.every('Living bookmarks', 30 * 60 * 1000, () => this.sweep(), { when: 'background', deferOnBattery: true });
  },

  // ---- the window -----------------------------------------------------------
  async open() {
    document.querySelector('.vex-livemarks-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-livemarks-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.4);display:grid;place-items:start center;padding-top:8vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Living bookmarks"
           style="width:min(640px,94vw);max-height:78vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1;font-size:13.5px;font-weight:650;color:var(--text)">Living bookmarks</div>
          <button data-close type="button" aria-label="Close" style="width:26px;height:26px;border:none;background:none;color:var(--text-muted);cursor:pointer;border-radius:6px">${VexIcons.svg('x', { size: 14 })}</button>
        </div>
        <div data-note style="padding:8px 14px;font-size:11.5px;color:var(--text-muted);border-bottom:1px solid var(--border)"></div>
        <div data-list style="overflow-y:auto;padding:6px;flex:1"></div>
      </div>`;
    const listEl = overlay.querySelector('[data-list]');
    const noteEl = overlay.querySelector('[data-note]');
    const btn = (label, fn, title) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; if (title) b.title = title;
      b.style.cssText = 'font-size:11px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;cursor:pointer';
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
      return b;
    };
    const dot = (status) => {
      const c = { same: 'var(--success,#3fb950)', changed: 'var(--warning,#d29922)', dead: 'var(--danger,#f85149)' }[status] || 'var(--text-muted)';
      return `<span aria-hidden="true" style="width:8px;height:8px;border-radius:50%;background:${c};flex:none"></span>`;
    };
    const draw = () => {
      const p = this.prefs();
      noteEl.textContent = p.enabled
        ? 'Looks again about every ' + this.INTERVALS[p.hours] + ', a few at a time, never while a game runs. Change it in Settings.'
        : 'Background checks are off (Settings › Living bookmarks). You can still check a page by hand with the button on its row.';
      listEl.textContent = '';
      const items = this.list();
      if (!items.length) {
        listEl.innerHTML = '<div style="padding:22px;text-align:center;font-size:12.5px;color:var(--text-muted)">No bookmark is kept alive yet. Open a bookmarked page and use Ctrl+K › "Keep this bookmark alive".</div>';
        return;
      }
      const order = { changed: 0, dead: 1, same: 2 };
      items.sort((a, b) => (order[a.state.status] ?? 3) - (order[b.state.status] ?? 3));
      for (const { bookmark: b, state: s } of items) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:8px;border-radius:8px';
        const when = s.lastCheckedAt ? 'checked ' + new Date(s.lastCheckedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'not checked yet';
        row.innerHTML = `${dot(s.status)}<div style="flex:1;min-width:0">
          <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.title || b.url)}</div>
          <div style="font-size:10.5px;color:var(--text-muted)">${esc(this.statusWords(s))} · ${esc(when)}${s.error && s.status !== 'same' ? ' · ' + esc(s.error) : ''}</div></div>`;
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end';
        actions.appendChild(btn('Open', () => { overlay.remove(); TabManager.createTab(b.url, true); }));
        if (this.snapshotsOf(b.id).length) actions.appendChild(btn('Saved text', () => this.showSnapshot(b.id)));
        actions.appendChild(btn('Check now', async (el) => {
          el.disabled = true; el.textContent = 'Checking…';
          try { await this.checkOne(b.id, { force: true }); } catch (err) { window.showToast?.(err.message, 'error'); }
          draw();
        }));
        if (s.status === 'dead') actions.appendChild(btn('Wayback', () => TabManager.createTab('https://web.archive.org/web/2/' + b.url, true), 'Look for an older copy at the Internet Archive'));
        actions.appendChild(btn('Stop', async () => {
          const ok = await window.vexConfirm({ title: 'Stop keeping this alive?', message: 'The bookmark stays. Do you also want its saved text removed?', okLabel: 'Stop and remove text', cancelLabel: 'Keep as is' });
          this.stopKeeping(b.id, { forget: !!ok });
          draw();
        }));
        row.appendChild(actions);
        listEl.appendChild(row);
      }
    };
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.vex-livemarks-snap')) { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-close]').addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    if (typeof VexLayer !== 'undefined') VexLayer.track(overlay, { tier: 'dialog', id: 'smart-bookmarks-2' });
    draw();
    return overlay;
  },

  showSnapshot(id) {
    const b = this._bookmark(id);
    const list = this.snapshotsOf(id);
    if (!list.length) throw new Error('No text was saved for this bookmark');
    const s = this.stateOf(id) || {};
    const esc = (x) => window.escapeHtml(String(x == null ? '' : x));
    const latest = list[list.length - 1];
    const box = document.createElement('div');
    box.className = 'vex-livemarks-snap';
    box.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.5);display:grid;place-items:center';
    box.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Saved text" style="width:min(720px,94vw);max-height:80vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;overflow:hidden">
      <div style="padding:12px 14px;border-bottom:1px solid var(--border)">
        <div style="font-size:13.5px;font-weight:650;color:var(--text)">${esc(b ? (b.title || b.url) : 'Saved text')}</div>
        <div style="font-size:11px;color:var(--text-muted)">${esc(this.statusWords(s))} · text saved ${esc(new Date(latest.at).toLocaleString())}</div>
      </div>
      ${s.changeSummary ? `<pre style="margin:0;padding:10px 14px;font-size:11.5px;white-space:pre-wrap;border-bottom:1px solid var(--border);color:var(--text)">${esc(s.changeSummary)}</pre>` : ''}
      <pre data-text style="margin:0;padding:12px 14px;overflow:auto;flex:1;font-size:12px;white-space:pre-wrap;color:var(--text)"></pre>
      <div style="display:flex;gap:8px;justify-content:flex-end;padding:10px 14px;border-top:1px solid var(--border)">
        <button data-copy type="button" class="btn-secondary">Copy text</button>
        ${s.status === 'changed' ? '<button data-seen type="button" class="btn-secondary">I have seen the change</button>' : ''}
        <button data-close type="button" class="btn-secondary">Close</button>
      </div></div>`;
    box.querySelector('[data-text]').textContent = latest.text + (latest.truncated ? '\n\n… (the saved text was cut at 30,000 characters)' : '');
    const close = () => { box.remove(); };
    box.querySelector('[data-close]').addEventListener('click', close);
    box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
    box.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(latest.text); window.showToast?.('Copied'); }
      catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); }
    });
    const seen = box.querySelector('[data-seen]');
    if (seen) seen.addEventListener('click', () => { this.markSeen(id); close(); });
    document.body.appendChild(box);
    if (typeof VexLayer !== 'undefined') VexLayer.track(box, { tier: 'dialog', id: 'smart-bookmarks' });
    return box;
  },

  // Ctrl+K › "Keep this bookmark alive": the bookmark of the page in front.
  async keepActive() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (!tab || !/^https?:/i.test(tab.url || '')) throw new Error('Open the bookmarked page first');
    const marks = typeof Bookmarks !== 'undefined' && Array.isArray(Bookmarks.items) ? Bookmarks.items : [];
    const b = marks.find(m => m.url === tab.url);
    if (!b) throw new Error('This page is not bookmarked yet — bookmark it with the star, then try again');
    const s = await this.keepAlive(b.id);
    if (!this.isEnabled()) window.showToast?.('Text saved. Background checks are off: switch them on in Settings › Living bookmarks.', 'info', 8000);
    else window.showToast?.('Keeping it alive — ' + this.statusWords(s).toLowerCase());
    return s;
  },

  section: {
    id: 'living-bookmarks',
    title: 'Bookmarks that changed',
    isEnabled() { return SmartBookmarks.isEnabled(); },
    async build() {
      const hits = SmartBookmarks.list().filter(x => x.state.status === 'changed' || x.state.status === 'dead');
      if (!hits.length) return null;
      return {
        id: 'living-bookmarks', title: 'Bookmarks that changed',
        items: hits.slice(0, 5).map(x => ({ text: (x.state.status === 'dead' ? 'Gone: ' : 'Changed: ') + (x.bookmark.title || x.bookmark.url), cmd: { type: 'command', id: 'living-bookmarks' } })),
      };
    },
  },
};

if (typeof window !== 'undefined') window.SmartBookmarks = SmartBookmarks;
if (typeof module !== 'undefined' && module.exports) module.exports = { SmartBookmarks };
