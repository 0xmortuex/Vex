// === Vex Feeds — minimal RSS/Atom reader panel ===
//
// Feeds (URLs) stored in 'vex.feeds'; items fetched through the main process
// ('rss:fetch' IPC — renderer fetch would be CORS-blocked) and parsed with
// DOMParser. Algorithm-free: newest first across all your feeds.

const VexFeeds = {
  KEY: 'vex.feeds',
  feeds: [],
  init() {
    try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); this.feeds = Array.isArray(a) ? a : []; } catch { this.feeds = []; }
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.feeds)); } catch {} },

  parse(xml, sourceTitle) {
    const out = [];
    try {
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
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
    } catch {}
    return out.filter(i => i.link);
  },

  async fetchAll() {
    const results = await Promise.all(this.feeds.map(async f => {
      try {
        const xml = await window.vex.rssFetch(f.url);
        return xml ? this.parse(xml, f.title) : [];
      } catch { return []; }
    }));
    return results.flat().sort((a, b) => b.at - a.at).slice(0, 120);
  },

  async renderPanel(container) {
    if (!container) return;
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    container.innerHTML = `
      <div class="panel-header"><h2>Feeds</h2></div>
      <div style="padding:0 16px 10px;display:flex;gap:6px">
        <input id="feed-url" type="text" placeholder="Add feed URL (RSS/Atom)…" style="flex:1;min-width:0;padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12.5px;outline:none;font-family:'Outfit',sans-serif">
        <button id="feed-add" style="padding:8px 14px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:12.5px">Add</button>
      </div>
      <div id="feed-srcs" style="padding:0 16px 8px;display:flex;gap:6px;flex-wrap:wrap"></div>
      <div id="feed-list" style="padding:0 10px 20px;overflow-y:auto;max-height:calc(100vh - 210px)">
        <div style="text-align:center;color:var(--text-muted);font-size:12.5px;padding:24px">${this.feeds.length ? 'Loading…' : 'Add a feed URL above (e.g. a blog /feed or /rss.xml).'}</div>
      </div>`;
    const srcs = container.querySelector('#feed-srcs');
    this.feeds.forEach(f => {
      const chip = document.createElement('span');
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:var(--bg);border:1px solid var(--border);font-size:11px;color:var(--text-muted)';
      chip.innerHTML = `${esc(f.title || f.url)} <button style="border:none;background:none;color:var(--text-muted);cursor:pointer;padding:0;font-size:11px">✕</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        this.feeds = this.feeds.filter(x => x.url !== f.url); this.save(); this.renderPanel(container);
      });
      srcs.appendChild(chip);
    });
    container.querySelector('#feed-add').addEventListener('click', async () => {
      let u = container.querySelector('#feed-url').value.trim();
      if (!u) return;
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      let title = '';
      try { const xml = await window.vex.rssFetch(u); const items = this.parse(xml); title = (items[0] && items[0].src) || ''; if (!items.length) { window.showToast?.('No items found at that URL'); return; } } catch { window.showToast?.('Could not fetch that feed'); return; }
      this.feeds.push({ url: u, title: title || u.replace(/^https?:\/\//, '').slice(0, 40) });
      this.save(); this.renderPanel(container);
    });
    if (!this.feeds.length) return;
    const items = await this.fetchAll();
    const list = container.querySelector('#feed-list');
    list.innerHTML = items.length ? '' : '<div style="text-align:center;color:var(--text-muted);font-size:12.5px;padding:24px">No items.</div>';
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
