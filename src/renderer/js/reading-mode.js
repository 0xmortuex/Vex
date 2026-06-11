// === Vex Reading Mode ===

const ReadingMode = {
  _originalUrls: new Map(),

  async activate() {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) { window.showToast?.('No active tab'); return; }

    const tabId = TabManager.activeTabId;
    const currentUrl = wv.getURL();

    try {
      // Extract article content via JS injected into webview
      const article = await wv.executeJavaScript(`
        (() => {
          const title = document.title;
          const main = document.querySelector('article') || document.querySelector('[role="main"]') || document.querySelector('main') || document.body;
          // Get text nodes, paragraphs, headings
          const elements = main.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre,code,img');
          let html = '';
          elements.forEach(el => {
            if (el.tagName === 'IMG') {
              html += '<img src="' + el.src + '" style="max-width:100%;border-radius:8px;margin:12px 0">';
            } else {
              html += '<' + el.tagName.toLowerCase() + '>' + el.innerHTML + '</' + el.tagName.toLowerCase() + '>';
            }
          });
          const text = main.innerText || '';
          const wordCount = text.split(/\\s+/).filter(Boolean).length;
          return { title, html: html || '<p>' + text.substring(0, 50000) + '</p>', wordCount };
        })()
      `);

      if (!article || !article.html) {
        window.showToast?.('Reading mode not available for this page');
        return;
      }

      this._originalUrls.set(tabId, currentUrl);
      const readTime = Math.max(1, Math.ceil(article.wordCount / 250));

      const readingHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #fafaf7; color: #1a1a1a; font-family: Georgia, 'Times New Roman', serif;
          font-size: 19px; line-height: 1.8; padding: 48px 24px; max-width: 700px; margin: 0 auto; }
        h1 { font-size: 32px; line-height: 1.3; margin-bottom: 12px; font-family: -apple-system, sans-serif; }
        h2 { font-size: 24px; margin: 28px 0 12px; font-family: -apple-system, sans-serif; }
        h3 { font-size: 20px; margin: 20px 0 8px; font-family: -apple-system, sans-serif; }
        p { margin-bottom: 16px; }
        li { margin-bottom: 6px; margin-left: 20px; }
        blockquote { border-left: 3px solid #ccc; padding-left: 16px; color: #555; margin: 16px 0; font-style: italic; }
        pre { background: #f0f0f0; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 14px; margin: 16px 0; }
        code { font-family: 'JetBrains Mono', monospace; font-size: 15px; }
        img { max-width: 100%; border-radius: 8px; margin: 12px 0; }
        .meta { color: #888; font-size: 14px; margin-bottom: 32px; font-family: -apple-system, sans-serif; }
        .exit-btn { position: fixed; top: 16px; right: 16px; padding: 8px 16px; background: #333; color: white;
          border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-family: -apple-system, sans-serif; z-index: 100; }
        .exit-btn:hover { background: #555; }
      </style></head><body>
        <button class="exit-btn" onclick="console.log('VEX_CMD:'+JSON.stringify({type:'exit-reading'}))">Exit Reading Mode</button>
        <h1>${article.title}</h1>
        <div class="meta">${article.wordCount} words &middot; ~${readTime} min read</div>
        <article>${article.html}</article>
      </body></html>`;

      wv.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(readingHtml));
      window.showToast?.('Reading mode');
    } catch (e) {
      window.showToast?.('Reading mode failed');
    }
  },

  exitReadingMode(tabId) {
    const url = this._originalUrls.get(tabId || TabManager.activeTabId);
    if (url) {
      const wv = WebviewManager.getActiveWebview();
      if (wv) wv.loadURL(url);
      this._originalUrls.delete(tabId || TabManager.activeTabId);
    }
  }
};
