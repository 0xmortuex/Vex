// === Vex Reading Mode ===
//
// Rebuilds the current page as a plain article document and loads it into the
// same tab, remembering the URL it replaced so exiting can put it back.
//
// Everything that crosses from the page into the reading document is UNTRUSTED:
// the title, the headings, the body text. It is extracted as text and rebuilt
// here, never spliced into markup as-is — a page whose <title> was
// `Bread &amp; Butter <script>…</script>` used to land in the reading document
// as live markup.

const ReadingMode = {
  // tabId -> the URL reading mode replaced. Entries are dropped on exit and
  // when the tab goes away, so this cannot grow for the life of the window.
  _originalUrls: new Map(),

  // Tags we are willing to rebuild, and the only attribute we carry over.
  _ALLOWED: new Set(['H1', 'H2', 'H3', 'H4', 'P', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE']),

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  },

  // Turn the extracted block list into markup. Blocks arrive as
  // { tag, text } or { tag: 'IMG', src } — plain data, escaped on the way in.
  _render(blocks) {
    const out = [];
    for (const b of (blocks || [])) {
      if (!b) continue;
      if (b.tag === 'IMG') {
        // Only http(s)/data images, and the URL is attribute-escaped.
        if (!/^(https?:|data:image\/)/i.test(String(b.src || ''))) continue;
        out.push(`<img src="${this._esc(b.src)}" alt="">`);
        continue;
      }
      if (!this._ALLOWED.has(b.tag)) continue;
      const text = String(b.text || '').trim();
      if (!text) continue;
      const tag = b.tag.toLowerCase();
      out.push(`<${tag}>${this._esc(text)}</${tag}>`);
    }
    return out.join('');
  },

  async activate() {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) { window.showToast?.('No active tab'); return; }

    const tabId = TabManager.activeTabId;
    const currentUrl = wv.getURL();

    let article;
    try {
      // Extract STRUCTURE AND TEXT, not markup. innerHTML from the page would
      // carry the page's own scripts and event handlers into the document we
      // build below.
      article = await wv.executeJavaScript(`
        (() => {
          const main = document.querySelector('article') || document.querySelector('[role="main"]') || document.querySelector('main') || document.body;
          const blocks = [];
          for (const el of main.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre,code,img')) {
            if (blocks.length >= 2000) break;
            if (el.tagName === 'IMG') { if (el.currentSrc || el.src) blocks.push({ tag: 'IMG', src: el.currentSrc || el.src }); continue; }
            const text = (el.innerText || el.textContent || '').trim();
            if (text) blocks.push({ tag: el.tagName, text: text.slice(0, 20000) });
          }
          const text = main.innerText || '';
          return {
            title: document.title,
            blocks,
            fallbackText: blocks.length ? '' : text.slice(0, 50000),
            wordCount: text.split(/\\s+/).filter(Boolean).length,
          };
        })()
      `);
    } catch (err) {
      window.showToast?.('Reading mode could not read this page: ' + (err?.message || 'extraction failed'), 'error');
      return;
    }

    const body = this._render(article && article.blocks)
      || (article && article.fallbackText ? `<p>${this._esc(article.fallbackText)}</p>` : '');
    if (!body) {
      window.showToast?.('Reading mode found no article text on this page');
      return;
    }

    this._prune();
    this._originalUrls.set(tabId, currentUrl);
    const readTime = Math.max(1, Math.ceil((article.wordCount || 0) / 250));
    const title = this._esc(article.title || 'Reading mode');

    const readingHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #fafaf7; color: #1a1a1a; font-family: Georgia, 'Times New Roman', serif;
          font-size: 19px; line-height: 1.8; padding: 48px 24px; max-width: 700px; margin: 0 auto; }
        h1 { font-size: 32px; line-height: 1.3; margin-bottom: 12px; font-family: -apple-system, sans-serif; }
        h2 { font-size: 24px; margin: 28px 0 12px; font-family: -apple-system, sans-serif; }
        h3 { font-size: 20px; margin: 20px 0 8px; font-family: -apple-system, sans-serif; }
        p { margin-bottom: 16px; }
        li { margin-bottom: 6px; margin-left: 20px; }
        blockquote { border-left: 3px solid #ccc; padding-left: 16px; color: #555; margin: 16px 0; font-style: italic; }
        pre { background: #f0f0f0; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 14px; margin: 16px 0; white-space: pre-wrap; }
        code { font-family: 'JetBrains Mono', monospace; font-size: 15px; }
        img { max-width: 100%; border-radius: 8px; margin: 12px 0; }
        .meta { color: #888; font-size: 14px; margin-bottom: 32px; font-family: -apple-system, sans-serif; }
        .exit-btn { position: fixed; top: 16px; right: 16px; padding: 8px 16px; background: #333; color: white;
          border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-family: -apple-system, sans-serif; z-index: 100; }
        .exit-btn:hover { background: #555; }
      </style></head><body>
        <button class="exit-btn" onclick="console.log('VEX_CMD:'+JSON.stringify({type:'exit-reading'}))">Exit Reading Mode</button>
        <h1>${title}</h1>
        <div class="meta">${Number(article.wordCount) || 0} words &middot; ~${readTime} min read</div>
        <article>${body}</article>
      </body></html>`;

    wv.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(readingHtml));
    window.showToast?.('Reading mode');
  },

  // Exit reading mode for ONE tab. It used to navigate whatever tab happened to
  // be active, so exiting a background tab's reading mode threw away the page
  // the user was actually looking at.
  exitReadingMode(tabId) {
    this._prune();
    const id = tabId || (typeof TabManager !== 'undefined' ? TabManager.activeTabId : null);
    if (!id) return false;
    const url = this._originalUrls.get(id);
    if (!url) return false;
    const wv = (typeof WebviewManager !== 'undefined' && WebviewManager.webviews)
      ? WebviewManager.webviews.get(id)
      : null;
    if (!wv) return false;          // tab is gone or asleep — keep the URL for when it is back
    this._originalUrls.delete(id);
    wv.loadURL(url);
    return true;
  },

  forgetTab(tabId) { return this._originalUrls.delete(tabId); },

  // Drop entries for tabs that no longer exist. Closing a tab while it is in
  // reading mode left its original URL in the map forever; there is no
  // tab-closed event to hook, so prune whenever we touch the map.
  _prune() {
    if (typeof TabManager === 'undefined' || !Array.isArray(TabManager.tabs)) return;
    const live = new Set(TabManager.tabs.map(t => t.id));
    for (const id of [...this._originalUrls.keys()]) if (!live.has(id)) this._originalUrls.delete(id);
  },
};

if (typeof window !== 'undefined') window.ReadingMode = ReadingMode;
if (typeof module !== 'undefined' && module.exports) module.exports = { ReadingMode };
