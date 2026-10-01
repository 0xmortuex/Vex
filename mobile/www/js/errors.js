// === Vex Mobile — when a page will not load ===
//
// The WebView's own error page is a grey wall of Chromium English with a
// reload button that does not know what Vex knows: whether you have a saved
// copy of this page, whether the whole phone is offline, whether the address
// was a search that should have gone to the search engine.
//
// So Vex draws its own, in your theme, with the three things actually worth
// offering. Its buttons are vex:// links, because a page cannot call the
// chrome — TabWebView turns those into a `command` event.

const VexErrors = (() => {
  // The messages worth distinguishing. Everything else gets the plain one.
  const REASONS = {
    '-2': ['This site could not be found', 'The address may be wrong, or the site may have moved.'],
    '-6': ['Vex could not reach that site', 'The connection was refused.'],
    '-7': ['That took too long', 'The site did not answer in time.'],
    '-8': ['That took too long', 'The site did not answer in time.'],
    '-1': ['Something went wrong loading that', ''],
    offline: ['You are offline', 'Nothing will load until the phone is back on a network.']
  };

  function escape(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function tokens() {
    const style = getComputedStyle(document.documentElement);
    const read = name => style.getPropertyValue(name).trim() || '';
    return {
      bg: read('--vex-bg-base') || '#faf6ee',
      card: read('--vex-bg-elevated') || '#fff',
      border: read('--vex-border-subtle') || '#e2d9c6',
      text: read('--vex-text-primary') || '#1f1c18',
      muted: read('--vex-text-muted') || '#7a6e54',
      accent: read('--vex-accent') || '#1e3a5f'
    };
  }

  return {
    REASONS,

    // The page itself. Self-contained: it is handed to a WebView that has no
    // access to the chrome's stylesheet, and no network to fetch one.
    html({ url, code, description, hasSaved, offline }) {
      const key = offline ? 'offline' : String(code);
      const [title, detail] = REASONS[key] || ['That page did not load', escape(description || '')];
      const colour = tokens();
      const host = (() => { try { return new URL(url).hostname; } catch { return url || ''; } })();

      return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  :root { color-scheme: ${colour.bg && parseInt(colour.bg.slice(1, 3), 16) < 128 ? 'dark' : 'light'}; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: ${colour.bg}; color: ${colour.text};
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 24px; }
  .card { width: 100%; max-width: 420px; background: ${colour.card}; border: 1px solid ${colour.border};
    border-radius: 16px; padding: 28px 24px; }
  h1 { margin: 0 0 10px; font: 500 22px/1.25 Georgia, serif; }
  p { margin: 0 0 8px; font-size: 15px; line-height: 1.55; color: ${colour.muted}; }
  .host { font-size: 13px; color: ${colour.muted}; word-break: break-all; margin-bottom: 20px; }
  a.button { display: block; text-align: center; text-decoration: none; margin-top: 10px;
    padding: 13px 16px; border-radius: 22px; background: ${colour.accent}; color: #fff; font-size: 15px; }
  a.ghost { background: none; border: 1px solid ${colour.border}; color: ${colour.text}; }
</style></head><body>
  <div class="card">
    <h1>${escape(title)}</h1>
    <p>${escape(detail)}</p>
    <p class="host">${escape(host)}</p>
    <a class="button" href="vex://retry">Try again</a>
    ${hasSaved ? '<a class="button ghost" href="vex://saved">Open the copy Vex saved</a>' : ''}
    <a class="button ghost" href="vex://search?${encodeURIComponent(host)}">Search for it instead</a>
  </div>
</body></html>`;
    },

    // Called when a main-frame load fails. Returns true if it drew a page.
    async show(tab, { code, description }) {
      if (!tab || !tab.pendingUrl && !tab.url) return false;
      const url = tab.pendingUrl || tab.url;
      if (!/^https?:/.test(url)) return false;
      const saved = await VexDB.byIndex('pages', 'url', url);
      const page = this.html({
        url,
        code,
        description,
        hasSaved: saved.length > 0,
        offline: typeof navigator !== 'undefined' && navigator.onLine === false
      });
      await VexBridge.loadHtml(tab.id, page, url);
      VexTabStore.update(tab.id, { errorAt: Date.now(), errorUrl: url });
      return true;
    },

    // The buttons on that page come back as vex:// commands.
    async handle(tab, command, value) {
      if (!tab) return;
      const url = tab.errorUrl || tab.url;
      if (command === 'retry') {
        await VexTabStore.navigate(tab.id, url);
      } else if (command === 'saved') {
        // Save the same page twice and the newest copy is the one you want.
        const saved = (await VexDB.byIndex('pages', 'url', url, 20))
          .sort((a, b) => (b.at || 0) - (a.at || 0));
        if (saved.length) await VexTools.openSaved(saved[0]);
        else VexUI.toast('There is no saved copy of that page');
      } else if (command === 'search') {
        const query = decodeURIComponent(value || '').replace(/^\?/, '');
        await VexTabStore.navigate(tab.id, VexSearch.searchUrl(query || url));
      }
    }
  };
})();

if (typeof window !== 'undefined') window.VexErrors = VexErrors;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexErrors };
