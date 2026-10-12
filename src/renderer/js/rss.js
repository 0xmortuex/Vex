// === Vex Feeds — minimal RSS/Atom reader panel ===
//
// Feeds (URLs) stored in 'vex.feeds'; items fetched through the main process
// ('rss:fetch' IPC — renderer fetch would be CORS-blocked) and parsed with
// DOMParser. Algorithm-free: newest first across all your feeds.

const VexFeeds = {
  KEY: 'vex.feeds',
  feeds: [],
  _renderToken: 0,
  init() {
    try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); this.feeds = Array.isArray(a) ? a : []; } catch { this.feeds = []; }
    // Older builds stored bare strings and allowed the same URL twice.
    this.feeds = this._dedupe(this.feeds.map(f => (typeof f === 'string' ? { url: f, title: '' } : f)).filter(f => f && typeof f.url === 'string'));
  },
  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.feeds)); }
    catch (err) { console.error('[Feeds] could not save the feed list:', err.message); window.showToast?.('Could not save your feed list', 'error'); }
  },

  _dedupe(list) {
    const seen = new Set();
    return list.filter(f => { const k = this._normalizeUrl(f.url); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  },

  // Accepts "example.com/feed" as well as a full URL. Returns null for anything
  // that is not http(s) — "javascript:alert(1)" used to be turned into
  // "https://javascript:alert(1)" and handed straight to the fetcher.
  _normalizeUrl(input) {
    let raw = String(input || '').trim();
    if (!raw) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw;
    let parsed;
    try { parsed = new URL(raw); } catch { return null; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;
    return parsed.href;
  },

  // `base` is the feed's own URL. A relative item link ("/posts/1") is read
  // against it; it used to become "https://posts/1" (found 2026-09-29).
  parse(xml, sourceTitle, base) {
    const out = [];
    const abs = (href) => { if (!href || !base) return href; try { return new URL(href, base).href; } catch { return href; } };
    const doc = new DOMParser().parseFromString(String(xml || ''), 'text/xml');
    // DOMParser signals a malformed document with a <parsererror> node rather
    // than throwing, so an unchecked parse silently produced an empty feed.
    if (doc.querySelector('parsererror')) throw new Error('That URL did not return valid XML');
    // RSS 2.0
    doc.querySelectorAll('item').forEach(it => {
      out.push({
        title: it.querySelector('title')?.textContent?.trim() || '(untitled)',
        link: abs(it.querySelector('link')?.textContent?.trim() || ''),
        at: Date.parse(it.querySelector('pubDate')?.textContent || '') || 0,
        src: sourceTitle || doc.querySelector('channel > title')?.textContent?.trim() || '',
      });
    });
    // Atom
    doc.querySelectorAll('entry').forEach(it => {
      // Atom: rel="alternate" is the article; a link with no rel means the
      // same. Only then the first link of any kind ("replies" is the comments).
      const links = [...it.querySelectorAll('link')];
      const linkEl = links.find(l => l.getAttribute('rel') === 'alternate') || links.find(l => !l.hasAttribute('rel')) || links[0];
      out.push({
        title: it.querySelector('title')?.textContent?.trim() || '(untitled)',
        link: abs(linkEl?.getAttribute('href') || ''),
        at: Date.parse(it.querySelector('updated, published')?.textContent || '') || 0,
        src: sourceTitle || doc.querySelector('feed > title')?.textContent?.trim() || '',
      });
    });
    // Only http(s) targets: a feed is untrusted input and its <link> ends up in
    // a real tab.
    return out.filter(i => this._normalizeUrl(i.link));
  },

  // --- Read / unread ---
  // The links of items you have opened (or marked read), newest last, capped.
  READ_KEY: 'vex.feedsRead',
  READ_MAX: 3000,
  _readSet() {
    let a;
    try { a = JSON.parse(localStorage.getItem(this.READ_KEY) || '[]'); }
    catch (err) { console.error('[Feeds] the read list could not be read:', err.message); a = []; }
    return new Set(Array.isArray(a) ? a.filter(x => typeof x === 'string') : []);
  },
  isRead(link) { return this._readSet().has(link); },
  markRead(links) {
    const set = this._readSet();
    for (const l of [].concat(links)) if (typeof l === 'string' && l) { set.delete(l); set.add(l); }
    const list = [...set].slice(-this.READ_MAX);
    try { localStorage.setItem(this.READ_KEY, JSON.stringify(list)); }
    catch (err) { console.error('[Feeds] could not save what was read:', err.message); window.showToast?.('Could not remember what you read', 'error'); }
  },

  // --- Subscribing ---
  // Checks the address really is a feed before keeping it. → { ok, feed } or
  // { ok: false, error } in words the person can act on.
  // partition: the session of the tab the feed was found in (Ctrl+K), so a
  // page open in a Tor, private or container tab is not read directly either.
  async subscribe(input, { partition = null } = {}) {
    const url = this._normalizeUrl(input);
    if (!url) return { ok: false, error: 'That is not a valid http(s) feed URL' };
    if (this.feeds.some(f => this._normalizeUrl(f.url) === url)) return { ok: false, error: 'That feed is already in your list' };
    // Feeds are fetched by Vex directly; a site sent through Tor, a proxy or a
    // container would see your real address (as page watches, page-watch.js).
    if (typeof TabManager !== 'undefined' && typeof TabManager.mayAskSiteForIcon === 'function' && !TabManager.mayAskSiteForIcon(url, { partition })) {
      return { ok: false, error: 'This site goes through Tor, a proxy or a container, and its feed would be read from your real connection — so it was not added' };
    }
    const xml = await window.vex.rssFetch(url);
    if (!xml) return { ok: false, error: "Couldn't fetch that feed — the server did not respond with a readable feed" };
    let items;
    try { items = this.parse(xml, '', url); } catch (err) { return { ok: false, error: "Couldn't add that feed: " + err.message }; }
    if (!items.length) return { ok: false, error: 'No items found at that URL — is it really an RSS/Atom feed?' };
    const feed = { url, title: (items[0] && items[0].src) || url.replace(/^https?:\/\//, '').slice(0, 40) };
    this.feeds.push(feed);
    this.save();
    return { ok: true, feed };
  },

  // The feeds a page names in its <head> (<link rel="alternate"
  // type="application/rss+xml|atom+xml">), as absolute http(s) addresses.
  async discover(webview) {
    if (!webview) throw new Error('No page is open');
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) throw new Error('Vex does not read this private page');
    const js = `(function(){var out=[];document.querySelectorAll('link[rel~="alternate" i][href]').forEach(function(l){
      var t=(l.getAttribute('type')||'').toLowerCase();
      if(t==='application/rss+xml'||t==='application/atom+xml')out.push({url:l.href,title:l.getAttribute('title')||''});
    });return JSON.stringify(out.slice(0,20));})()`;
    const raw = await webview.executeJavaScript(js);
    const seen = new Set();
    return JSON.parse(raw || '[]').map(f => ({ url: this._normalizeUrl(f.url), title: String(f.title || '').slice(0, 120) }))
      .filter(f => f.url && /^https?:/i.test(f.url) && !seen.has(f.url) && seen.add(f.url));
  },

  // Ctrl+K "Subscribe to this page's feed".
  async subscribeToPage() {
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null;
    let found;
    try { found = await this.discover(wv); }
    catch (err) { window.showToast?.((err && err.message) || 'Could not look for a feed on this page', 'error'); return null; }
    if (!found.length) { window.showToast?.('This page does not name a feed', 'error'); return null; }
    let pick = found[0];
    if (found.length > 1) {
      const answer = await vexPrompt({
        title: 'Which feed?',
        message: found.map((f, i) => (i + 1) + '. ' + (f.title || f.url)).join('\n'),
        value: '1', okLabel: 'Subscribe',
      });
      if (answer == null) return null;
      pick = found[parseInt(answer, 10) - 1];
      if (!pick) { window.showToast?.('Choose a number from 1 to ' + found.length, 'error'); return null; }
    }
    const tab = typeof TabManager !== 'undefined' && typeof TabManager.getActiveTab === 'function' ? TabManager.getActiveTab() : null;
    const r = await this.subscribe(pick.url, { partition: (tab && tab.partition) || null });
    if (!r.ok) { window.showToast?.(r.error, 'error'); return null; }
    window.showToast?.('Subscribed to ' + (r.feed.title || r.feed.url) + ' — it is in the Feeds panel');
    return r.feed;
  },

  // Fetch every feed, keeping per-feed failures instead of swallowing them —
  // a dead feed used to look exactly like a feed with no new posts.
  async fetchAll() {
    const results = await Promise.all(this.feeds.map(async f => {
      // A site given a Tor, proxy or container rule after it was subscribed
      // to: its feed is not read from your real connection either.
      if (typeof TabManager !== 'undefined' && typeof TabManager.mayAskSiteForIcon === 'function' && !TabManager.mayAskSiteForIcon(f.url)) {
        return { feed: f, items: [], error: 'not read — the site goes through Tor, a proxy or a container' };
      }
      try {
        const xml = await window.vex.rssFetch(f.url);
        // main returns null for a non-200, an oversized body, or a network error.
        if (!xml) return { feed: f, items: [], error: 'could not be reached' };
        return { feed: f, items: this.parse(xml, f.title, f.url) };
      } catch (err) {
        return { feed: f, items: [], error: err.message || 'failed' };
      }
    }));
    const items = results.flatMap(r => r.items).sort((a, b) => b.at - a.at).slice(0, 120);
    return { items, errors: results.filter(r => r.error).map(r => ({ url: r.feed.url, title: r.feed.title || r.feed.url, error: r.error })) };
  },

  async renderPanel(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(s);
    // Every repaint invalidates the one before it. Removing a feed chip re-enters
    // renderPanel while the previous call is still awaiting its fetch, and the
    // stale call then overwrote the fresh list with the old one.
    const token = ++this._renderToken;
    container.innerHTML = `
      <div class="panel-header"><h2>Feeds</h2></div>
      <div style="padding:0 16px 10px;display:flex;gap:6px">
        <input id="feed-url" type="text" placeholder="Add feed URL (RSS/Atom)…" style="flex:1;min-width:0;padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12.5px;outline:none;font-family:'Outfit',sans-serif">
        <button id="feed-add" style="padding:8px 14px;background:var(--primary);color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:12.5px">Add</button>
        <button id="feed-refresh" title="Refresh all feeds" aria-label="Refresh all feeds" style="display:inline-flex;align-items:center;justify-content:center;padding:8px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
      </div>
      <div id="feed-srcs" style="padding:0 16px 8px;display:flex;gap:6px;flex-wrap:wrap"></div>
      <div id="feed-errors" style="padding:0 16px 8px"></div>
      <div id="feed-list" style="padding:0 10px 20px;overflow-y:auto;max-height:calc(100vh - 210px)">
        <div style="text-align:center;color:var(--text-muted);font-size:12.5px;padding:24px">${this.feeds.length ? 'Loading…' : 'Add a feed URL above (e.g. a blog /feed or /rss.xml).'}</div>
      </div>`;
    const srcs = container.querySelector('#feed-srcs');
    this.feeds.forEach(f => {
      const chip = document.createElement('span');
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:var(--bg);border:1px solid var(--border);font-size:11px;color:var(--text-muted)';
      const label = document.createElement('span');
      label.textContent = f.title || f.url;
      label.title = f.url;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove feed ' + (f.title || f.url));
      remove.style.cssText = 'display:inline-flex;border:none;background:none;color:var(--text-muted);cursor:pointer;padding:0';
      remove.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      remove.addEventListener('click', () => {
        this.feeds = this.feeds.filter(x => x.url !== f.url); this.save(); this.renderPanel(container);
      });
      chip.append(label, remove);
      srcs.appendChild(chip);
    });

    const addButton = container.querySelector('#feed-add');
    const input = container.querySelector('#feed-url');
    const addFeed = async () => {
      if (!input.value.trim()) return;
      addButton.disabled = true;
      const previousLabel = addButton.textContent;
      addButton.textContent = 'Checking…';
      try {
        const r = await this.subscribe(input.value);
        if (!r.ok) { window.showToast?.(r.error, 'error'); return; }
        this.renderPanel(container);
      } catch (err) {
        window.showToast?.("Couldn't add that feed: " + err.message, 'error');
      } finally {
        addButton.disabled = false;
        addButton.textContent = previousLabel;
      }
    };
    addButton.addEventListener('click', addFeed);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addFeed(); });
    container.querySelector('#feed-refresh').addEventListener('click', () => this.renderPanel(container));

    if (!this.feeds.length) return;
    const { items, errors } = await this.fetchAll();
    if (token !== this._renderToken || !container.isConnected) return;   // a newer repaint owns the panel now

    const errorsEl = container.querySelector('#feed-errors');
    if (errorsEl && errors.length) {
      errorsEl.innerHTML = `<div style="font-size:11px;color:var(--danger,#e5556a);background:color-mix(in srgb,var(--danger,#e5556a) 10%,transparent);border:1px solid color-mix(in srgb,var(--danger,#e5556a) 28%,transparent);border-radius:8px;padding:6px 9px;line-height:1.5">
        ${errors.map(e => `${esc(e.title)} — ${esc(e.error)}`).join('<br>')}</div>`;
    }

    const list = container.querySelector('#feed-list');
    if (!list) return;
    list.innerHTML = items.length ? '' : (window.VexUI ? VexUI.emptyState('rss', 'No items', 'New posts from your feeds will appear here') : '<div style="text-align:center;color:var(--text-muted);font-size:12.5px;padding:24px">No items.</div>');
    // Unread posts stand out (a dot, full weight); opening one marks it read.
    const read = this._readSet();
    const unread = items.filter(it => !read.has(it.link));
    if (items.length) {
      const status = document.createElement('div');
      status.id = 'feed-status';
      status.style.cssText = 'display:flex;align-items:center;gap:8px;padding:0 8px 6px;font-size:11px;color:var(--text-muted)';
      const count = document.createElement('span');
      count.textContent = unread.length ? unread.length + ' unread' : 'All read';
      status.appendChild(count);
      if (unread.length) {
        const all = document.createElement('button');
        all.type = 'button';
        all.id = 'feed-mark-all';
        all.textContent = 'Mark all read';
        all.style.cssText = 'margin-left:auto;border:none;background:none;color:var(--primary);cursor:pointer;font-size:11px;padding:0';
        all.addEventListener('click', () => { this.markRead(unread.map(it => it.link)); this.renderPanel(container); });
        status.appendChild(all);
      }
      list.appendChild(status);
    }
    items.forEach(it => {
      const isRead = read.has(it.link);
      const row = document.createElement('div');
      row.className = 'feed-item' + (isRead ? ' read' : ' unread');
      row.style.cssText = 'padding:9px 8px;border-radius:8px;cursor:pointer;display:flex;gap:8px;align-items:flex-start';
      row.addEventListener('mouseenter', () => row.style.background = 'var(--surface)');
      row.addEventListener('mouseleave', () => row.style.background = '');
      const when = it.at ? new Date(it.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      row.innerHTML = `<span aria-hidden="true" style="flex:none;width:6px;height:6px;margin-top:6px;border-radius:50%;background:${isRead ? 'transparent' : 'var(--primary)'}"></span>
        <div style="flex:1;min-width:0"><div style="font-size:12.5px;color:${isRead ? 'var(--text-muted)' : 'var(--text)'};font-weight:${isRead ? 400 : 600};line-height:1.4">${esc(it.title)}</div>
        <div style="font-size:10.5px;color:var(--text-muted);margin-top:2px">${esc(it.src)}${when ? ' · ' + when : ''}</div></div>`;
      if (!isRead) row.setAttribute('aria-label', 'Unread: ' + it.title);
      row.addEventListener('click', () => { this.markRead(it.link); SidebarManager.hideActivePanel?.(); TabManager.createTab(it.link, true); });
      list.appendChild(row);
    });
  },
};

if (typeof window !== 'undefined') window.VexFeeds = VexFeeds;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFeeds };
