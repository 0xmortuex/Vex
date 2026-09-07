// === Vex Page Context Extraction ===

const PageContext = {
  async extractPageContext(webview) {
    if (!webview) return null;
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) return null;
    try {
      const before = webview.getURL?.();
      const generation = webview._navigationGeneration;
      const result = await webview.executeJavaScript(`
        (() => {
          const clone = document.body.cloneNode(true);
          clone.querySelectorAll('script, style, noscript, iframe, svg').forEach(el => el.remove());
          const main = document.querySelector('article, main, [role="main"], .post, .entry, .content');
          let text;
          if (main) {
            const mc = main.cloneNode(true);
            mc.querySelectorAll('script, style, noscript, iframe, svg').forEach(el => el.remove());
            text = mc.innerText.replace(/\\n{3,}/g, '\\n\\n').trim();
          } else {
            text = clone.innerText.replace(/\\n{3,}/g, '\\n\\n').trim();
          }
          const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0,20).map(h => ({
            level: parseInt(h.tagName[1]), text: h.innerText.trim()
          }));
          return {
            url: location.href,
            title: document.title,
            text: text.substring(0, 30000),
            description: document.querySelector('meta[name="description"]')?.content || '',
            headings,
            language: document.documentElement.lang || 'unknown',
            wordCount: text.split(/\\s+/).length
          };
        })()
      `);
      if (before && (result?.url !== before || webview.getURL?.() !== before)) return null;
      if (generation !== webview._navigationGeneration) return null;
      return result;
    } catch (err) {
      console.error('Page context extraction failed:', err);
      return { url: '', title: '', text: '', description: '', headings: [], language: 'unknown', wordCount: 0 };
    }
  },

  async extractSelectedText(webview) {
    if (!webview) return null;
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) return null;
    try {
      const before = webview.getURL?.(), generation = webview._navigationGeneration;
      const text = await webview.executeJavaScript('window.getSelection().toString()');
      return before === webview.getURL?.() && generation === webview._navigationGeneration ? text || null : null;
    } catch { return null; }
  }
};
