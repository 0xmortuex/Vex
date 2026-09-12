// === Vex Phase 12: AI History Indexer ===
// Runs in the background after a page loads. Extracts content, asks the AI
// worker for a short summary + tags, and stores the result alongside the
// history entry so that semantic search can find it later.

const HistoryIndexer = (() => {
  // Cloud AI routing lives in ai-router.js (backed by VexConfig / Settings).
  const AI_WORKER_URL = (typeof window !== 'undefined' && window.VexConfig) ? window.VexConfig.aiWorkerUrl() : '';
  const INDEX_QUEUE = [];
  const QUEUE_MAX = 100;
  let processing = false;
  let dropped = 0;

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
    if (!on) { INDEX_QUEUE.length = 0; dropped = 0; }
    try { localStorage.setItem('vex.aiIndexingEnabled', on ? 'true' : 'false'); } catch {}
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
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) return;
    if (historyEntry.indexed) return;
    if (!shouldIndex(historyEntry.url)) return;

    // Avoid duplicates
    if (INDEX_QUEUE.find(q => q.historyEntry.id === historyEntry.id)) return;
    if (INDEX_QUEUE.length >= QUEUE_MAX) { dropped++; return; }

    INDEX_QUEUE.push({ historyEntry, webview, generation: webview._navigationGeneration });
    if (!processing) processQueue();
  }

  async function processQueue() {
    processing = true;
    while (INDEX_QUEUE.length > 0) {
      const { historyEntry, webview, generation } = INDEX_QUEUE.shift();
      try {
        if (isEnabled() && generation === webview._navigationGeneration && webview.isConnected !== false) await indexEntry(historyEntry, webview);
      } catch (err) {
        console.warn('[HistoryIndexer] Failed to index', historyEntry.url, err);
      }
      // Throttle — 1 indexing per 5 seconds to stay well under worker limits.
      // Only *between* items: sleeping after the last one kept `processing`
      // true for five more seconds, so the next page queued in that window
      // never started a run of its own.
      if (INDEX_QUEUE.length > 0) await new Promise(r => setTimeout(r, 5000));
    }
    processing = false;
  }

  async function indexEntry(historyEntry, webview) {
    if (!webview || (typeof webview.isDestroyed === 'function' && webview.isDestroyed())) return;
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) return;
    const generation = webview._navigationGeneration;

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

    if (generation !== webview._navigationGeneration || webview.isConnected === false) return;
    if (!pageContent || !pageContent.text || pageContent.text.length < 100) return;

    // Verify URL still matches (user may have navigated away)
    if (pageContent.url && historyEntry.url && pageContent.url !== historyEntry.url) {
      // Try a loose origin+path match; skip if totally different
      try {
        const a = new URL(pageContent.url), b = new URL(historyEntry.url);
        if (a.origin !== b.origin || a.pathname !== b.pathname || a.search !== b.search) return;
      } catch { return; }
    }

    let aiResult;
    try {
      // Always route through AIRouter — historyIndex defaults to local so this
      // is where the indexer uses Ollama when available.
      aiResult = await AIRouter.callAI('historyIndex', { pageContext: pageContent });
    } catch (e) { return; }

    if (!isEnabled() || generation !== webview._navigationGeneration || !aiResult || !aiResult.result) return;

    let parsed;
    try {
      const str = String(aiResult.result).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
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
    if (typeof TabManager === 'undefined' || !Array.isArray(TabManager.tabs) || typeof WebviewManager === 'undefined') return 0;
    const unindexed = HistoryPanel.entries.filter(e => !e.indexed);

    // One pass over the open tabs, not one per unindexed entry: history can hold
    // thousands of entries and getURL() is a synchronous IPC round-trip each time.
    const byUrl = new Map();
    for (const tab of TabManager.tabs) {
      try {
        const wv = WebviewManager.webviews.get(tab.id);
        const url = wv && typeof wv.getURL === 'function' ? wv.getURL() : '';
        if (url && !byUrl.has(url)) byUrl.set(url, wv);
      } catch { /* a webview mid-teardown */ }
    }

    let queued = 0;
    for (const entry of unindexed) {
      const wv = byUrl.get(entry.url);
      if (!wv) continue;
      queueForIndexing(entry, wv);
      queued++;
    }
    console.log(`[HistoryIndexer] Queued ${queued}/${unindexed.length} open tabs for re-indexing`);
    return queued;
  }

  function getStats() {
    if (!window.HistoryPanel || !Array.isArray(HistoryPanel.entries)) return { total: 0, indexed: 0, queued: 0, dropped };
    const total = HistoryPanel.entries.length;
    const indexed = HistoryPanel.entries.filter(e => e.indexed).length;
    return { total, indexed, queued: INDEX_QUEUE.length, dropped };
  }

  return { queueForIndexing, reindexOpenTabs, isEnabled, setEnabled, getStats };
})();

window.HistoryIndexer = HistoryIndexer;
