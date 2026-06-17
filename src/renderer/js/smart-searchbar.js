// === Vex: Smart Searchbar (local suggestions for the address bar) ===
// As the user types in #url-input, show a dropdown of suggestions sourced
// ENTIRELY from local data — open tabs (TabManager.tabs), browsing history
// (localStorage 'vex.history'), and bookmarks (localStorage 'vex.shortcuts',
// the start-page tiles). No network calls, no favicon fetches — letter chips
// only, so the dropdown is instant.
//
// Keyboard is routed through handleKeydown(e), which app.js calls at the TOP
// of its existing #url-input keydown handler. handleKeydown returns true only
// when it consumed the key (arrow nav, Enter-on-highlight, Esc-while-open);
// when it returns false, app.js runs its normal logic unchanged — so typed
// Enter with no highlighted suggestion navigates exactly as before.
//
// Pure ranking helpers (_normalizeUrl, _scoreMatch, rankSuggestions) are
// hoisted to module scope (mirrors tab-grouper.js's _domain/_similarity) so
// they're unit-testable under vitest without any DOM or storage.
//
// Google Suggest web predictions (a NETWORK source) are fetched in the MAIN
// process (Google Suggest sends no CORS header, so a webSecurity:true renderer
// fetch is blocked) and reach this module via window.vex.webSuggest(q). The raw
// response is parsed by parseGoogleSuggest below.

// Parse a Google Suggest response into a flat string[] of predictions.
// Response shape: ["query", ["sugg1","sugg2",...], ...]. Anything malformed,
// empty, non-array, or an HTML error page yields []. CANONICAL COPY — a byte-
// identical inline copy lives in src/main.js (the web-suggest IPC handler);
// the two MUST stay in sync. This copy is the one pinned by the unit tests.
function parseGoogleSuggest(raw) {
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && Array.isArray(arr[1])) {
      return arr[1].filter(s => typeof s === 'string');
    }
  } catch {}
  return [];
}

// Collapse a URL to a comparable key: drop protocol, leading www., trailing
// slashes, lowercase. Used for dedup and for prefix matching against the host.
function _normalizeUrl(url) {
  let u = (url == null ? '' : String(url)).trim().toLowerCase();
  u = u.replace(/^[a-z]+:\/\//, '');   // strip protocol (http://, https://, etc.)
  u = u.replace(/^www\./, '');
  u = u.replace(/\/+$/, '');             // strip trailing slash(es)
  return u;
}

// Score how well `item` matches `query`. Higher = better. 0 = no match.
// Ordering intent: exact prefix (host then title) > word-boundary prefix >
// plain substring. Case-insensitive throughout.
function _scoreMatch(query, item) {
  const q = (query == null ? '' : String(query)).trim().toLowerCase();
  if (!q) return 0;
  const title = (item && item.title ? String(item.title) : '').toLowerCase();
  const bareUrl = _normalizeUrl(item && item.url);

  let score = 0;
  // Exact prefix on the bare host/url, then on the title.
  if (bareUrl.startsWith(q)) score = Math.max(score, 100);
  if (title.startsWith(q)) score = Math.max(score, 95);
  // Word-boundary prefix inside the title (e.g. "cal" → "Google Calendar").
  if (score < 95) {
    const titleWords = title.split(/\s+/).filter(Boolean);
    if (titleWords.some(w => w.startsWith(q))) score = Math.max(score, 80);
  }
  // Word-boundary prefix inside url path segments (split on / . - _ ? = &).
  if (score < 80) {
    const urlWords = bareUrl.split(/[/.\-_?=&]+/).filter(Boolean);
    if (urlWords.some(w => w.startsWith(q))) score = Math.max(score, 75);
  }
  // Fallback: plain substring anywhere in title or url.
  if (score === 0 && (title.includes(q) || bareUrl.includes(q))) score = 40;
  return score;
}

// Rank + dedup + cap. `items` are normalized { url, title, kind } objects.
// Returns up to `cap` items (no scores) in best-first order.
function rankSuggestions(query, items, cap = 8) {
  const q = (query == null ? '' : String(query)).trim();
  if (!q || !Array.isArray(items)) return [];

  // kind precedence on score ties: an open tab beats history beats bookmark.
  const kindRank = { tab: 3, history: 2, bookmark: 1 };

  const byUrl = new Map();
  for (const it of items) {
    if (!it || !it.url) continue;
    const s = _scoreMatch(q, it);
    if (s <= 0) continue;
    const key = _normalizeUrl(it.url);
    const prev = byUrl.get(key);
    const better = !prev
      || s > prev.score
      || (s === prev.score && (kindRank[it.kind] || 0) > (kindRank[prev.item.kind] || 0));
    if (better) byUrl.set(key, { item: it, score: s });
  }

  const ranked = [...byUrl.values()];
  ranked.sort((a, b) =>
    b.score - a.score ||
    (kindRank[b.item.kind] || 0) - (kindRank[a.item.kind] || 0)
  );
  return ranked.slice(0, Math.max(0, cap)).map(e => e.item);
}

const SmartSearchbar = (() => {
  const DEBOUNCE_MS = 35;           // local sources (instant); tiny coalesce only
  const WEB_DEBOUNCE_MS = 45;       // network debounce for Google Suggest (was 150)
  const MAX_RESULTS = 8;            // local cap
  const MAX_WEB_RESULTS = 8;        // web cap

  // Renderer-side LRU cache of query → predictions. A backspace or re-typed
  // query is served INSTANTLY with no IPC/network round-trip — the single
  // biggest perceived-speed win (predictions barely change minute-to-minute).
  const _webCache = new Map();
  const WEB_CACHE_MAX = 250;
  function _cacheGet(q) { const v = _webCache.get(q); if (v) { _webCache.delete(q); _webCache.set(q, v); } return v; }
  function _cacheSet(q, list) { _webCache.set(q, list); if (_webCache.size > WEB_CACHE_MAX) _webCache.delete(_webCache.keys().next().value); }

  let _input = null;
  let _box = null;
  let _onSubmit = null;
  let _debounceTimer = null;
  let _webTimer = null;
  let _localResults = [];           // ranked local items {url,title,kind}
  let _webResults = [];             // web items {query,title,kind:'web'}
  let _results = [];                // combined render/keyboard list
  let _selectedIndex = -1;
  let _open = false;
  // Monotonic id so out-of-order web responses are ignored: each web fetch
  // bumps _webSeq; a response is only applied if it carries the latest id.
  let _webSeq = 0;
  let _lastQuery = '';

  function _esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function _displayUrl(url) {
    const n = _normalizeUrl(url);
    return n || (url == null ? '' : String(url));
  }

  // Collect all local sources into a flat normalized list.
  function _gather() {
    const out = [];
    // 1) Open tabs (skip start pages — they aren't navigable targets).
    try {
      if (typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs)) {
        for (const t of TabManager.tabs) {
          if (!t || !t.url) continue;
          if (typeof isStartPage === 'function' && isStartPage(t.url)) continue;
          out.push({ url: t.url, title: t.title || t.url, kind: 'tab' });
        }
      }
    } catch {}
    // 2) Browsing history (newest-first array of { url, title, time }).
    try {
      const hist = JSON.parse(localStorage.getItem('vex.history') || '[]');
      if (Array.isArray(hist)) {
        for (const h of hist) {
          if (h && h.url) out.push({ url: h.url, title: h.title || h.url, kind: 'history' });
        }
      }
    } catch {}
    // 3) Bookmarks = start-page shortcuts ({ name, url }).
    try {
      const sc = JSON.parse(localStorage.getItem('vex.shortcuts') || 'null');
      if (Array.isArray(sc)) {
        for (const s of sc) {
          if (s && s.url) out.push({ url: s.url, title: s.name || s.url, kind: 'bookmark' });
        }
      }
    } catch {}
    return out;
  }

  function _ensureBox() {
    if (_box) return _box;
    _box = document.createElement('div');
    _box.id = 'searchbar-suggestions';
    _box.className = 'hidden';
    // Anchor under the url bar. #url-bar-wrapper is position-relative via CSS.
    const wrapper = document.getElementById('url-bar-wrapper') || _input.parentElement;
    wrapper.appendChild(_box);
    return _box;
  }

  function _kindLabel(kind) {
    return kind === 'tab' ? 'Open tab'
      : kind === 'bookmark' ? 'Bookmark'
      : kind === 'web' ? 'Search'
      : 'History';
  }

  // Build the combined keyboard/render list: locals first, then web below.
  function _composeResults() {
    _results = [..._localResults, ..._webResults];
  }

  function _render() {
    _composeResults();
    if (!_results.length) { _close(); return; }
    const box = _ensureBox();
    box.innerHTML = '';
    const firstWebIdx = _localResults.length;
    _results.forEach((r, i) => {
      // Visual divider/label before the first web row (only if locals exist).
      if (i === firstWebIdx && _localResults.length && _webResults.length) {
        const label = document.createElement('div');
        label.className = 'sb-section-label';
        label.textContent = 'Web search';
        box.appendChild(label);
      }
      const isWeb = r.kind === 'web';
      const text = isWeb ? r.query : (r.title || r.url);
      const sub = isWeb ? 'Google Suggest' : _displayUrl(r.url);
      const row = document.createElement('div');
      row.className = 'sb-suggestion' + (i === _selectedIndex ? ' selected' : '');
      row.dataset.index = String(i);
      const letter = isWeb ? '\u2315' : ((text || '?').trim().charAt(0) || '?').toUpperCase();
      row.innerHTML =
        `<div class="sb-chip">${_esc(letter)}</div>` +
        `<div class="sb-text">` +
          `<div class="sb-title">${_esc(text)}</div>` +
          `<div class="sb-url">${_esc(sub)}</div>` +
        `</div>` +
        `<div class="sb-kind">${_esc(_kindLabel(r.kind))}</div>`;
      // IMPORTANT: mousedown + preventDefault keeps focus in the input, so the
      // input never blurs during the click. That means the existing paste-fix
      // blur handler does NOT fire mid-click and the selection always registers
      // before any close-on-blur could hide the row.
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        _select(i);
      });
      box.appendChild(row);
    });
    box.classList.remove('hidden');
    _open = true;
  }

  function _refreshSelection() {
    if (!_box) return;
    const rows = _box.querySelectorAll('.sb-suggestion');
    rows.forEach((el, i) => el.classList.toggle('selected', i === _selectedIndex));
    const sel = rows[_selectedIndex];
    if (sel && typeof sel.scrollIntoView === 'function') sel.scrollIntoView({ block: 'nearest' });
  }

  function _close() {
    _open = false;
    _selectedIndex = -1;
    if (_box) {
      _box.classList.add('hidden');
      _box.innerHTML = '';
    }
  }

  function _select(i) {
    const r = _results[i];
    if (!r) return;
    _close();
    if (r.kind === 'web') {
      // A web suggestion is a QUERY, not a URL. Route through the existing
      // submit path so the user's configured search engine resolves it.
      _input.value = r.query;
      if (typeof _onSubmit === 'function') _onSubmit(r.query, false);
      return;
    }
    // Local URL item — navigate directly (already has a scheme).
    _input.value = r.url;
    if (typeof _onSubmit === 'function') _onSubmit(r.url, false);
  }

  // Fetch Google Suggest via the main process (window.vex.webSuggest). Debounced
  // separately from locals, fail-silent, and guarded against out-of-order
  // responses with a monotonic sequence id.
  function _applyWeb(q, arr) {
    _webResults = arr.slice(0, MAX_WEB_RESULTS)
      .filter(s => typeof s === 'string' && s.trim())
      .map(s => ({ query: s, kind: 'web' }));
    if ((_input.value || '').trim() === q) _render();
  }

  function _fetchWeb(q) {
    clearTimeout(_webTimer);
    if (!q) { _webResults = []; return; }
    // Instant cache hit — no debounce, no IPC, no network.
    const cached = _cacheGet(q);
    if (cached) { _webSeq++; _applyWeb(q, cached); return; }
    const bridge = (typeof window !== 'undefined' && window.vex && typeof window.vex.webSuggest === 'function')
      ? window.vex.webSuggest : null;
    if (!bridge) { _webResults = []; return; }
    const seq = ++_webSeq;
    _webTimer = setTimeout(() => {
      Promise.resolve(bridge(q)).then((list) => {
        const arr = Array.isArray(list) ? list : [];
        _cacheSet(q, arr); // cache regardless of staleness — value is query-keyed
        // Ignore stale responses (a newer keystroke already fired) and any
        // response whose query no longer matches what's in the box.
        if (seq !== _webSeq) return;
        if ((_input.value || '').trim() !== q) return;
        _applyWeb(q, arr);
      }).catch(() => { /* fail-silent: keep locals */ });
    }, WEB_DEBOUNCE_MS);
  }

  function _onInput() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      const q = (_input.value || '').trim();
      if (q !== _lastQuery) _webResults = []; // drop stale web rows from prior query
      _lastQuery = q;
      if (!q) { _webResults = []; _localResults = []; _close(); return; }
      // Locals render INSTANTLY — never wait on the network.
      _localResults = rankSuggestions(q, _gather(), MAX_RESULTS);
      _selectedIndex = -1; // nothing pre-highlighted → typed Enter still works
      _render();
      // Web predictions come in asynchronously and append below.
      _fetchWeb(q);
    }, DEBOUNCE_MS);
  }

  // Returns true ONLY when the key was consumed. app.js calls this first and
  // returns early on true; on false it runs its normal Enter/Escape logic.
  function handleKeydown(e) {
    // When the dropdown is closed there is nothing to consume — let every key
    // (including ArrowUp/Down caret movement and typed Enter) behave normally.
    if (!_open || !_results.length) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _selectedIndex = (_selectedIndex + 1) % _results.length;
      _refreshSelection();
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      _selectedIndex = (_selectedIndex - 1 + _results.length) % _results.length;
      _refreshSelection();
      return true;
    }
    if (e.key === 'Enter') {
      // Only consume Enter when a suggestion is actually highlighted. With no
      // highlight we return false so app.js navigates the typed text as before.
      if (_selectedIndex >= 0) {
        e.preventDefault();
        _select(_selectedIndex);
        return true;
      }
      return false;
    }
    if (e.key === 'Escape') {
      // Close the dropdown but DON'T blur — swallow Esc so app.js's Esc (which
      // blurs + re-syncs) doesn't also fire on the same keypress.
      e.preventDefault();
      _close();
      return true;
    }
    return false;
  }

  function init(inputEl, opts = {}) {
    if (!inputEl) return;
    _input = inputEl;
    _onSubmit = typeof opts.onSubmit === 'function' ? opts.onSubmit : null;
    _ensureBox();
    _input.addEventListener('input', _onInput);
    // Genuine focus-loss closes the dropdown. Row clicks use mousedown+
    // preventDefault so they never trigger this.
    _input.addEventListener('blur', () => _close());
  }

  return { init, handleKeydown, close: _close, _gather };
})();

if (typeof window !== 'undefined') window.SmartSearchbar = SmartSearchbar;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SmartSearchbar, rankSuggestions, _normalizeUrl, _scoreMatch, parseGoogleSuggest };
}
