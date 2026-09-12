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

  parse(xml, sourceTitle) {
    const out = [];
    const doc = new DOMParser().parseFromString(String(xml || ''), 'text/xml');
    // DOMParser signals a malformed document with a <parsererror> node rather
    // than throwing, so an unchecked parse silently produced an empty feed.
    if (doc.querySelector('parsererror')) throw new Error('That URL did not return valid XML');
    // RSS 2.0
    doc.querySelectorAll('item').forEach(it => {
      out.push({
        title: it.querySelector('title')?.textContent?.trim() || '(untitled)',
        link: it.querySelector('link')?.textContent?.trim() || '',
        at: Date.parse(it.querySelector('pubDate')?.textContent || '') || 0,
        src: sourceTitle || doc.querySelector('channel > title')?.textContent?.trim() || '',
      });
    });
    // Atom
    doc.querySelectorAll('entry').forEach(it => {
      const linkEl = it.querySelector('link[rel="alternate"]') || it.querySelector('link');
      out.push({
        title: it.querySelector('title')?.textContent?.trim() || '(untitled)',
        link: linkEl?.getAttribute('href') || '',
        at: Date.parse(it.querySelector('updated, published')?.textContent || '') || 0,
        src: sourceTitle || doc.querySelector('feed > title')?.textContent?.trim() || '',
      });
    });
    // Only http(s) targets: a feed is untrusted input and its <link> ends up in
    // a real tab.
    return out.filter(i => this._normalizeUrl(i.link));
  },

  // Fetch every feed, keeping per-feed failures instead of swallowing them —
  // a dead feed used to look exactly like a feed with no new posts.
  async fetchAll() {
    const results = await Promise.all(this.feeds.map(async f => {
      try {
        const xml = await window.vex.rssFetch(f.url);
        // main returns null for a non-200, an oversized body, or a network error.
        if (!xml) return { feed: f, items: [], error: 'could not be reached' };
        return { feed: f, items: this.parse(xml, f.title) };
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
        <button id="feed-add" style="padding:8px 14px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:12.5px">Add</button>
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
      const url = this._normalizeUrl(input.value);
      if (!input.value.trim()) return;
      if (!url) { window.showToast?.('That is not a valid http(s) feed URL', 'error'); return; }
      if (this.feeds.some(f => this._normalizeUrl(f.url) === url)) { window.showToast?.('That feed is already in your list'); return; }
      addButton.disabled = true;
      const previousLabel = addButton.textContent;
      addButton.textContent = 'Checking…';
      try {
        const xml = await window.vex.rssFetch(url);
        if (!xml) { window.showToast?.("Couldn't fetch that feed — the server did not respond with a readable feed", 'error'); return; }
        const items = this.parse(xml);
        if (!items.length) { window.showToast?.('No items found at that URL — is it really an RSS/Atom feed?', 'error'); return; }
        this.feeds.push({ url, title: (items[0] && items[0].src) || url.replace(/^https?:\/\//, '').slice(0, 40) });
        this.save();
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
    items.forEach(it => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:9px 8px;border-radius:8px;cursor:pointer';
      row.addEventListener('mouseenter', () => row.style.background = 'var(--surface)');
      row.addEventListener('mouseleave', () => row.style.background = '');
      const when = it.at ? new Date(it.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      row.innerHTML = `<div style="font-size:12.5px;color:var(--text);line-height:1.4">${esc(it.title)}</div>
        <div style="font-size:10.5px;color:var(--text-muted);margin-top:2px">${esc(it.src)}${when ? ' · ' + when : ''}</div>`;
      row.addEventListener('click', () => { SidebarManager.hideActivePanel?.(); TabManager.createTab(it.link, true); });
      list.appendChild(row);
    });
  },
};

if (typeof window !== 'undefined') window.VexFeeds = VexFeeds;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFeeds };
