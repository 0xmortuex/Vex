// === Vex Phase 12: AI History Indexer ===
// Runs in the background after a page loads. Extracts content, asks the AI
// worker for a short summary + tags, and stores the result alongside the
// history entry so that semantic search can find it later.

const HistoryIndexer = (() => {
  const AI_WORKER_URL = 'https://vex-ai.mortuexhavoc.workers.dev';
  const INDEX_QUEUE = [];
  let processing = false;
  let enabled = true;

  // Don't index these
  const SKIP_DOMAIN_FRAGMENTS = ['google.com/search', 'bing.com/search', 'duckduckgo.com', 'yandex.com/search'];
  const SKIP_SCHEMES = ['file:', 'vex:', 'about:', 'chrome:', 'data:', 'devtools:'];

  function isEnabled() {
    try {
      const v = localStorage.getItem('vex.aiIndexingEnabled');
      if (v === null) return true; // default on
      return v === 'true';
    } catch { return true; }
  }

  function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem('vex.aiIndexingEnabled', enabled ? 'true' : 'false'); } catch {}
  }

  function shouldIndex(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      if (SKIP_SCHEMES.includes(u.protocol)) return false;
      if (SKIP_DOMAIN_FRAGMENTS.some(d => url.includes(d))) return false;
      return true;
    } catch {
      return false;
    }
  }

  function queueForIndexing(historyEntry, webview) {
    if (!isEnabled()) return;
    if (!historyEntry || !webview) return;
    if (historyEntry.indexed) return;
    if (!shouldIndex(historyEntry.url)) return;

    // Avoid duplicates
    if (INDEX_QUEUE.find(q => q.historyEntry.id === historyEntry.id)) return;

    INDEX_QUEUE.push({ historyEntry, webview });
    if (!processing) processQueue();
  }

  async function processQueue() {
    processing = true;
    while (INDEX_QUEUE.length > 0) {
      const { historyEntry, webview } = INDEX_QUEUE.shift();
      try {
        await indexEntry(historyEntry, webview);
      } catch (err) {
        console.warn('[HistoryIndexer] Failed to index', historyEntry.url, err);
      }
      // Throttle — 1 indexing per 5 seconds to stay well under worker limits
      await new Promise(r => setTimeout(r, 5000));
    }
    processing = false;
  }

  async function indexEntry(historyEntry, webview) {
    if (!webview || (typeof webview.isDestroyed === 'function' && webview.isDestroyed())) return;

    let pageContent;
    try {
      pageContent = await webview.executeJavaScript(`
        (() => {
          const main = document.querySelector('article, main, [role="main"]') || document.body;
          const clone = main.cloneNode(true);
          clone.querySelectorAll('script, style, nav, footer, aside, noscript').forEach(el => el.remove());
          return {
            url: location.href,
            title: document.title,
            text: (clone.innerText || '').substring(0, 8000).trim()
          };
        })()
      `);
    } catch {
      return; // Can't read (cross-origin, devtools, etc.)
    }

    if (!pageContent || !pageContent.text || pageContent.text.length < 100) return;

    // Verify URL still matches (user may have navigated away)
    if (pageContent.url && historyEntry.url && pageContent.url !== historyEntry.url) {
      // Try a loose origin+path match; skip if totally different
      try {
        const a = new URL(pageContent.url), b = new URL(historyEntry.url);
        if (a.origin !== b.origin) return;
      } catch { return; }
    }

    let response;
    try {
      response = await fetch(AI_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'summarize-for-history',
          pageContext: pageContent
        })
      });
    } catch (e) {
      return;
    }

    if (!response.ok) return;

    const data = await response.json();
    if (!data.result) return;

    let parsed;
    try {
      const str = String(data.result).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      parsed = JSON.parse(str);
    } catch {
      return;
    }

    // Write back to HistoryPanel.entries (the authoritative array)
    if (window.HistoryPanel && Array.isArray(HistoryPanel.entries)) {
      const entry = HistoryPanel.entries.find(e => e.id === historyEntry.id);
      if (entry) {
        entry.summary = parsed.summary || '';
        entry.tags = Array.isArray(parsed.tags) ? parsed.tags : [];
        entry.contentType = parsed.contentType || 'other';
        entry.indexed = true;
        entry.indexedAt = new Date().toISOString();
        HistoryPanel.save();
      }
    }
  }

  function reindexOpenTabs() {
    if (!window.HistoryPanel || !Array.isArray(HistoryPanel.entries)) return 0;
    const unindexed = HistoryPanel.entries.filter(e => !e.indexed);
    if (!window.TabManager || !Array.isArray(TabManager.tabs)) return 0;

    let queued = 0;
    for (const entry of unindexed) {
      const tab = TabManager.tabs.find(t => {
        try {
          const wv = t.webview;
          return wv && typeof wv.getURL === 'function' && wv.getURL() === entry.url;
        } catch { return false; }
      });
      if (tab && tab.webview) {
        queueForIndexing(entry, tab.webview);
        queued++;
      }
    }
    console.log(`[HistoryIndexer] Queued ${queued}/${unindexed.length} open tabs for re-indexing`);
    return queued;
  }

  function getStats() {
    if (!window.HistoryPanel || !Array.isArray(HistoryPanel.entries)) return { total: 0, indexed: 0, queued: 0 };
    const total = HistoryPanel.entries.length;
    const indexed = HistoryPanel.entries.filter(e => e.indexed).length;
    return { total, indexed, queued: INDEX_QUEUE.length };
  }

  return { queueForIndexing, reindexOpenTabs, isEnabled, setEnabled, getStats };
})();

window.HistoryIndexer = HistoryIndexer;
