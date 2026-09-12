// === Vex Recall ("memex"): full-text search of everything you've read ===
//
// As you browse, the readable text of each page is indexed locally (capped,
// stored by the main process in userData/recall.json via the recall:* IPC).
// The Recall panel then lets you find any page you've ever read by its CONTENT,
// not just its title or URL — "that paragraph about DPI throttling".
//
// Never indexed: private windows, Tor/identity tabs and any other ephemeral or
// container partition, file:// and vex:// pages, the start page, and any host
// the user has added to the exclusion list.
//
// Ranking, stemming and snippeting live in src/main/recall-index.js; this file
// is the extraction rules plus the panel.

const Recall = {
  ENABLED_KEY: 'vex.recall.enabled',
  EXCLUDE_KEY: 'vex.recall.excluded',
  MIN_TEXT: 80,
  MAX_TEXT: 16000,
  PAGE_SIZE: 30,
  _seq: 0,

  enabled() { try { return localStorage.getItem(this.ENABLED_KEY) !== 'false'; } catch { return true; } },
  setEnabled(v) { try { localStorage.setItem(this.ENABLED_KEY, v ? 'true' : 'false'); } catch {} },

  // Hosts the user asked Recall to stay out of. Stored locally; subdomains of a
  // listed host are excluded too, so "example.com" also covers "news.example.com".
  excluded() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.EXCLUDE_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(h => typeof h === 'string' && h).map(h => h.toLowerCase()) : [];
    } catch { return []; }
  },
  setExcluded(list) {
    const clean = [...new Set((list || []).map(h => String(h).trim().toLowerCase()).filter(Boolean))].sort();
    try { localStorage.setItem(this.EXCLUDE_KEY, JSON.stringify(clean)); } catch {}
    return clean;
  },
  hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },
  isExcluded(url) {
    const host = this.hostOf(url);
    if (!host) return false;
    return this.excluded().some(h => host === h || host.endsWith('.' + h));
  },
  async excludeHost(host) {
    const clean = String(host || '').trim().toLowerCase().replace(/^www\./, '');
    if (!clean) return 0;
    this.setExcluded(this.excluded().concat(clean));
    // Excluding a site should also remove what is already remembered about it,
    // otherwise "never index this" leaves the old pages searchable forever.
    try { return (await window.vex?.recallForget?.({ host: clean }))?.removed || 0; } catch { return 0; }
  },
  unexcludeHost(host) {
    const clean = String(host || '').trim().toLowerCase();
    return this.setExcluded(this.excluded().filter(h => h !== clean));
  },

  // Pull the page's readable text and hand it to the main-process index.
  async indexPage(webview, url, title) {
    if (!this.enabled() || !url || !window.vex?.recallIndex) return;
    if (!webview || (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview))) return;
    if (!/^https?:/i.test(url)) return;
    if (typeof isStartPage === 'function' && isStartPage(url)) return;
    if (this.isExcluded(url)) return;
    // Skip ephemeral / container-isolated tabs: don't index what the user chose
    // to keep traceless.
    const partition = webview.getAttribute?.('partition');
    if (partition && partition !== 'persist:main') return;
    const generation = webview._navigationGeneration;
    if (webview.getURL?.() !== url) return;
    let page = null;
    try {
      page = await webview.executeJavaScript(this._extractor(url, this.MAX_TEXT));
    } catch { return; }
    if (!this.enabled() || webview.getURL?.() !== url || webview._navigationGeneration !== generation) return;
    if (!page || !page.text || page.text.length < this.MIN_TEXT) return;
    try {
      await window.vex.recallIndex({ url, title: page.title || title || url, text: page.text });
    } catch { /* index full / IPC rejected — nothing the user can act on */ }
  },

  // Built as a string because it runs inside the guest page, not here. Chrome,
  // navigation and boilerplate are stripped so the index holds the article
  // rather than every site's menu; the description and headings are prepended
  // because they are what people actually remember a page by.
  _extractor(url, max) {
    return `(function(){try{
      if(location.href!==${JSON.stringify(url)})return null;
      var root=document.querySelector('article,main,[role=main]')||document.body;
      if(!root)return null;
      var clone=root.cloneNode(true);
      clone.querySelectorAll('script,style,noscript,template,svg,nav,footer,aside,form,iframe,[aria-hidden=true],[hidden]').forEach(function(el){el.remove()});
      var lead=[];
      var d=document.querySelector('meta[name=description],meta[property="og:description"]');
      if(d&&d.content)lead.push(d.content);
      Array.prototype.slice.call(document.querySelectorAll('h1,h2'),0,8).forEach(function(h){var t=(h.innerText||'').trim();if(t)lead.push(t)});
      var body=(clone.innerText||'');
      var text=(lead.join('. ')+'. '+body).replace(/\\s+/g,' ').trim().substring(0,${max});
      return {title:(document.title||'').substring(0,300),text:text};
    }catch(e){return null}})();`;
  },

  // --- search -------------------------------------------------------------

  async search(q, opts) {
    const blank = { total: 0, hits: [], terms: [], took: 0 };
    if (!window.vex?.recallSearch) return blank;
    try {
      const res = await window.vex.recallSearch(String(q || '').slice(0, 512), opts || {});
      if (!res || !Array.isArray(res.hits)) return blank;
      return res;
    } catch { return blank; }
  },

  async stats() {
    try { return (await window.vex?.recallStats?.()) || { pages: 0, bytes: 0, oldest: 0, newest: 0, hosts: [] }; }
    catch { return { pages: 0, bytes: 0, oldest: 0, newest: 0, hosts: [] }; }
  },

  // "Search by meaning" without an embedding model: ask the wired AI to expand
  // the query into related terms/synonyms, run each through the same full-text
  // index, then merge + rank (original-query hits weighted highest, then by how
  // often a page surfaces across the expansions). No new dependency, works with
  // whatever AI backend the user has (cloud or local Ollama/WebLLM).
  async searchSmart(q, opts) {
    const base = await this.search(q, opts);
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callAI !== 'function') return base;
    let terms = [];
    try {
      const res = await AIRouter.callAI('chat', { message:
        `I'm searching the full text of pages I've already read for: "${q}".\n` +
        `List up to 6 alternative search queries — synonyms, related concepts, and specific terms — that would surface relevant pages. Return ONLY the queries, one per line, no numbering or commentary.` });
      const out = String((res && (res.result || res.text || res.message)) || '');
      terms = out.split('\n').map(s => s.replace(/^[-*\d.)\s]+/, '').trim())
        .filter(s => s && s.length <= 60 && s.toLowerCase() !== q.toLowerCase()).slice(0, 6);
    } catch { return base; }
    if (!terms.length) return base;

    const seen = new Map(); // url -> { hit, score }
    const add = (hit, score) => {
      if (!hit || !hit.url) return;
      const cur = seen.get(hit.url);
      if (cur) { cur.score += score; if (!cur.hit.snippet?.length && hit.snippet?.length) cur.hit.snippet = hit.snippet; }
      else seen.set(hit.url, { hit, score });
    };
    base.hits.forEach((h, i) => add(h, 100 - Math.min(i, 50)));
    const lists = await Promise.all(terms.map(t => this.search(t, opts)));
    lists.forEach(list => list.hits.forEach((h, i) => add(h, 10 - Math.min(i, 9))));
    const hits = [...seen.values()].sort((a, b) => b.score - a.score).map(v => v.hit);
    return { total: hits.length, hits, terms: base.terms, took: base.took, expanded: terms };
  },

  // --- panel --------------------------------------------------------------

  ICONS: {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    forget: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    block: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/><path d="M18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
  },

  WHEN_RANGES: [
    { id: 'any', label: 'Any time', ms: 0 },
    { id: 'day', label: 'Past 24 hours', ms: 86400e3 },
    { id: 'week', label: 'Past 7 days', ms: 7 * 86400e3 },
    { id: 'month', label: 'Past 30 days', ms: 30 * 86400e3 },
    { id: 'year', label: 'Past year', ms: 365 * 86400e3 },
  ],

  relativeTime(ms) {
    if (!ms) return '';
    const diff = Date.now() - ms;
    if (diff < 60e3) return 'just now';
    if (diff < 3600e3) return Math.round(diff / 60e3) + ' min ago';
    if (diff < 86400e3) return Math.round(diff / 3600e3) + ' h ago';
    if (diff < 7 * 86400e3) return Math.round(diff / 86400e3) + ' d ago';
    return new Date(ms).toLocaleDateString();
  },

  formatBytes(n) {
    if (!n) return '0 KB';
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  },

  // Turn the engine's [text, isMatch] pairs into escaped HTML with <mark>.
  // The parts arrive pre-split precisely so the highlight never has to run a
  // regex over already-escaped HTML.
  snippetHtml(parts) {
    const esc = window.escapeHtml;
    if (!Array.isArray(parts) || !parts.length) return '';
    return parts.map(p => (Array.isArray(p) && p[1]) ? '<mark>' + esc(p[0]) + '</mark>' : esc(Array.isArray(p) ? p[0] : p)).join('');
  },

  renderPanel(container) {
    if (!container) return;
    const esc = window.escapeHtml;
    const I = this.ICONS;
    container.innerHTML = `<div class="panel-header recall-head">
        <h2>Recall</h2>
        <p id="recall-stat" class="recall-stat">Checking the index…</p>
      </div>
      <div class="recall-tools">
        <div class="recall-field">
          <span class="recall-field-icon">${I.search}</span>
          <input id="recall-q" type="search" placeholder="Search everything you've read…" spellcheck="false"
            autocomplete="off" aria-label="Search indexed pages" aria-describedby="recall-hint">
          <button id="recall-wipe" class="recall-icon-btn" type="button" title="Clear search" aria-label="Clear search" hidden>${I.close}</button>
        </div>
        <div class="recall-filters">
          <select id="recall-when" aria-label="Time range">${this.WHEN_RANGES.map(r => `<option value="${r.id}">${esc(r.label)}</option>`).join('')}</select>
          <select id="recall-site" aria-label="Site"><option value="">All sites</option></select>
          <select id="recall-sort" aria-label="Sort">
            <option value="relevance">Best match</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
        <label class="recall-smart">
          <input type="checkbox" id="recall-smart">
          <span class="recall-smart-icon">${I.sparkle}</span>
          <span>Smart search <span class="recall-dim">— find by meaning (AI expands your query, runs on Enter)</span></span>
        </label>
        <p id="recall-hint" class="recall-hint">Tips: <code>"exact phrase"</code> · <code>-exclude</code> · <code>site:example.com</code> · <code>after:7d</code></p>
      </div>
      <div id="recall-results" class="recall-results" role="listbox" aria-label="Recall results"></div>`;

    const input = container.querySelector('#recall-q');
    const wipe = container.querySelector('#recall-wipe');
    const smartChk = container.querySelector('#recall-smart');
    const whenSel = container.querySelector('#recall-when');
    const siteSel = container.querySelector('#recall-site');
    const sortSel = container.querySelector('#recall-sort');
    const statEl = container.querySelector('#recall-stat');
    const out = container.querySelector('#recall-results');

    const state = { hits: [], total: 0, offset: 0, cursor: -1, query: '', busy: false };
    let timer = null;

    const refreshStats = async () => {
      const s = await this.stats();
      if (!container.isConnected) return;
      if (s.private) { statEl.textContent = 'Recall is off in private windows.'; return; }
      if (!s.pages) {
        statEl.textContent = this.enabled()
          ? 'Nothing indexed yet — pages you read get added as you browse.'
          : 'Indexing is off. Turn it on in Settings › Recall.';
      } else {
        statEl.textContent = `${s.pages.toLocaleString()} page${s.pages === 1 ? '' : 's'} indexed · ` +
          `${this.formatBytes(s.bytes)} · newest ${this.relativeTime(s.newest)}`;
      }
      const keep = siteSel.value;
      siteSel.innerHTML = '<option value="">All sites</option>' +
        (s.hosts || []).map(h => `<option value="${esc(h.host)}">${esc(h.host)} (${h.count})</option>`).join('');
      if (keep) siteSel.value = keep;
    };

    const options = () => {
      const range = this.WHEN_RANGES.find(r => r.id === whenSel.value) || this.WHEN_RANGES[0];
      return {
        limit: this.PAGE_SIZE,
        offset: state.offset,
        sort: sortSel.value,
        since: range.ms ? Date.now() - range.ms : 0,
        site: siteSel.value || undefined,
      };
    };

    const setCursor = (i) => {
      const rows = out.querySelectorAll('.recall-hit');
      if (!rows.length) { state.cursor = -1; return; }
      state.cursor = Math.max(0, Math.min(rows.length - 1, i));
      rows.forEach((r, n) => r.classList.toggle('is-active', n === state.cursor));
      const row = rows[state.cursor];
      if (row) row.scrollIntoView({ block: 'nearest' });
    };

    const open = (url, background) => {
      if (!url || typeof TabManager === 'undefined') return;
      if (!background) SidebarManager.hideActivePanel?.();
      TabManager.createTab(url, !background);
    };

    const rowFor = (h) => {
      const row = document.createElement('div');
      row.className = 'recall-hit';
      row.setAttribute('role', 'option');
      row.dataset.url = h.url;
      row.dataset.host = h.host || this.hostOf(h.url);
      const host = row.dataset.host;
      const snippet = this.snippetHtml(h.snippet);
      row.innerHTML = `
        <div class="recall-hit-top">
          <img class="recall-hit-icon" src="${host ? `https://${encodeURIComponent(host)}/favicon.ico` : ''}"
            alt="" width="15" height="15" loading="lazy" data-image-fallback="hide">
          <span class="recall-hit-title">${esc(h.title || h.url)}</span>
          <span class="recall-hit-when" title="${esc(h.at ? new Date(h.at).toLocaleString() : '')}">${esc(this.relativeTime(h.at))}</span>
        </div>
        ${snippet ? `<div class="recall-hit-snippet">${snippet}</div>` : ''}
        <div class="recall-hit-foot">
          <span class="recall-hit-host">${esc(host || h.url)}</span>
          ${h.visits > 1 ? `<span class="recall-hit-visits">${h.visits} visits</span>` : ''}
          <span class="recall-hit-acts">
            <button type="button" class="recall-icon-btn" data-act="copy" title="Copy link" aria-label="Copy link">${I.copy}</button>
            <button type="button" class="recall-icon-btn" data-act="forget" title="Forget this page" aria-label="Forget this page">${I.forget}</button>
            <button type="button" class="recall-icon-btn" data-act="block" title="Never index ${esc(host)}" aria-label="Never index this site">${I.block}</button>
          </span>
        </div>`;
      return row;
    };

    out.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      const row = e.target.closest('.recall-hit');
      if (!row) return;
      if (!btn) { open(row.dataset.url, e.ctrlKey || e.metaKey || e.shiftKey); return; }
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'copy') {
        try { await navigator.clipboard.writeText(row.dataset.url); window.showToast?.('Link copied'); } catch {}
      } else if (act === 'forget') {
        try { await window.vex?.recallForget?.({ url: row.dataset.url }); } catch {}
        row.remove();
        state.total = Math.max(0, state.total - 1);
        window.showToast?.('Forgotten');
        refreshStats();
      } else if (act === 'block') {
        const host = row.dataset.host;
        const ok = typeof vexConfirm === 'function'
          ? await vexConfirm({ title: 'Never index ' + host, message: 'Recall will stop indexing ' + host + ' and forget the pages it already holds from it.', okLabel: 'Exclude site', danger: true })
          : true;
        if (!ok) return;
        const removed = await this.excludeHost(host);
        window.showToast?.(`${host} excluded${removed ? ` · ${removed} page${removed === 1 ? '' : 's'} forgotten` : ''}`);
        run(false);
        refreshStats();
      }
    });
    out.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      const row = e.target.closest('.recall-hit');
      if (row) { e.preventDefault(); open(row.dataset.url, true); }
    });

    const render = (append) => {
      if (!append) { out.innerHTML = ''; state.cursor = -1; }
      out.querySelector('.recall-more')?.remove();
      out.querySelector('.recall-count')?.remove();
      const frag = document.createDocumentFragment();
      for (const h of state.hits.slice(append ? out.querySelectorAll('.recall-hit').length : 0)) frag.appendChild(rowFor(h));
      out.appendChild(frag);
      const shown = out.querySelectorAll('.recall-hit').length;
      const count = document.createElement('div');
      count.className = 'recall-count';
      count.textContent = shown >= state.total
        ? `${state.total} match${state.total === 1 ? '' : 'es'}`
        : `Showing ${shown} of ${state.total} matches`;
      out.appendChild(count);
      if (shown < state.total) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'recall-more';
        more.textContent = 'Show more';
        more.addEventListener('click', () => { state.offset = shown; run(false, true); });
        out.appendChild(more);
      }
    };

    const run = async (smart, append) => {
      const q = input.value.trim();
      wipe.hidden = !q;
      if (!append) state.offset = 0;
      state.query = q;
      if (!q && !siteSel.value) {
        out.innerHTML = '<div class="recall-idle">Type to search your reading history.</div>';
        state.hits = []; state.total = 0;
        return;
      }
      const seq = ++this._seq;
      if (!append) out.innerHTML = `<div class="recall-idle">${smart ? 'Thinking…' : 'Searching…'}</div>`;
      const res = smart ? await this.searchSmart(q, options()) : await this.search(q, options());
      // A slower earlier keystroke must never overwrite a newer result.
      if (seq !== this._seq || !container.isConnected) return;
      if (res.private) { out.innerHTML = '<div class="recall-idle">Recall is unavailable in private windows.</div>'; return; }
      state.total = res.total;
      state.hits = append ? state.hits.concat(res.hits) : res.hits;
      if (!state.hits.length) {
        out.innerHTML = window.VexUI
          ? VexUI.emptyState('search', 'No pages matched ' + (q ? '“' + q + '”' : 'those filters'),
            'Try fewer words, widen the time range, or turn on Smart search')
          : '<div class="recall-idle">No pages matched.</div>';
        return;
      }
      render(append);
      if (!append) setCursor(0);
    };

    input.addEventListener('input', () => {
      wipe.hidden = !input.value;
      clearTimeout(timer);
      if (smartChk.checked) return;
      timer = setTimeout(() => run(false), 160);
    });
    // Keyboard flow: type, arrow through results, Enter to open the highlighted
    // one (Ctrl/Shift+Enter opens it in the background). Smart search keeps
    // Enter as 'run the AI query', since it cannot run per keystroke.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(state.cursor + 1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(state.cursor - 1); return; }
      if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); input.value = ''; run(false); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(timer);
      const row = out.querySelectorAll('.recall-hit')[state.cursor];
      if (!smartChk.checked && row) open(row.dataset.url, e.ctrlKey || e.metaKey || e.shiftKey);
      else run(smartChk.checked);
    });
    wipe.addEventListener('click', () => { input.value = ''; wipe.hidden = true; input.focus(); run(false); });
    smartChk.addEventListener('change', () => { if (input.value.trim()) run(smartChk.checked); });
    for (const sel of [whenSel, siteSel, sortSel]) sel.addEventListener('change', () => run(false));

    out.innerHTML = '<div class="recall-idle">Type to search your reading history.</div>';
    refreshStats();
    setTimeout(() => input.focus(), 40);
  },

  // --- settings -----------------------------------------------------------

  renderSettings(container) {
    if (!container) return;
    const esc = window.escapeHtml;
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:8px">Index the full text of pages you read so you can find them later by content. Stored locally only (userData/recall.json) — never uploaded. Private, Tor and identity tabs are never indexed.</p>
      <div class="setting-toggle-row"><span>Index pages for full-text recall</span><label class="toggle"><input type="checkbox" id="recall-enabled" ${this.enabled() ? 'checked' : ''}><span class="toggle-slider"></span></label></div>
      <p class="setting-info muted recall-settings-stat" id="recall-settings-stat">Checking the index…</p>
      <div class="recall-settings-excluded" id="recall-excluded"></div>
      <div class="recall-settings-actions">
        <button id="recall-reindex" class="btn-secondary" type="button">Re-index open tabs</button>
        <button id="recall-clear" class="recall-danger" type="button">Clear recall index</button>
      </div>`;

    const statEl = container.querySelector('#recall-settings-stat');
    const excludedEl = container.querySelector('#recall-excluded');

    const paint = async () => {
      const s = await this.stats();
      if (!container.isConnected) return;
      statEl.textContent = s.pages
        ? `${s.pages.toLocaleString()} page${s.pages === 1 ? '' : 's'} · ${this.formatBytes(s.bytes)} of text · ` +
          `oldest ${this.relativeTime(s.oldest)}, newest ${this.relativeTime(s.newest)} · ` +
          `capacity ${s.maxPages ? s.maxPages.toLocaleString() + ' pages' : ''}${s.maxBytes ? ' / ' + this.formatBytes(s.maxBytes) : ''}`
        : 'Nothing indexed yet.';
      const list = this.excluded();
      excludedEl.innerHTML = list.length
        ? '<div class="recall-excluded-title">Never indexed</div>' + list.map(h =>
          `<span class="recall-chip">${esc(h)}<button type="button" data-host="${esc(h)}" title="Index ${esc(h)} again" aria-label="Stop excluding ${esc(h)}">${this.ICONS.close}</button></span>`).join('')
        : '';
    };

    excludedEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-host]');
      if (!btn) return;
      this.unexcludeHost(btn.dataset.host);
      window.showToast?.(btn.dataset.host + ' will be indexed again');
      paint();
    });

    container.querySelector('#recall-enabled').addEventListener('change', (e) => {
      this.setEnabled(e.target.checked);
      window.showToast?.(e.target.checked ? 'Recall on' : 'Recall off');
    });

    container.querySelector('#recall-reindex').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const done = await this.reindexOpenTabs();
      btn.disabled = false;
      window.showToast?.(done ? `Re-indexed ${done} tab${done === 1 ? '' : 's'}` : 'No open tabs to index');
      paint();
    });

    container.querySelector('#recall-clear').addEventListener('click', async () => {
      const ok = typeof vexConfirm === 'function'
        ? await vexConfirm({ title: 'Clear recall index', message: 'Forget the full text of every page Recall has indexed? Your history and bookmarks are not affected. This cannot be undone.', okLabel: 'Clear index', danger: true })
        : true;
      if (!ok) return;
      try { await window.vex?.recallClear?.(); window.showToast?.('Recall index cleared'); } catch {}
      paint();
    });

    paint();
  },

  // Re-read every open, indexable tab. The useful escape hatch when indexing
  // was off, a site was un-excluded, or a page was still loading when Recall
  // first looked at it.
  async reindexOpenTabs() {
    if (typeof TabManager === 'undefined' || typeof WebviewManager === 'undefined') return 0;
    let done = 0;
    for (const tab of TabManager.tabs || []) {
      const webview = WebviewManager.webviews?.get(tab.id);
      if (!webview) continue;
      let url = '';
      try { url = webview.getURL?.() || ''; } catch { continue; }
      if (!/^https?:/i.test(url)) continue;
      await this.indexPage(webview, url, tab.title);
      done++;
    }
    return done;
  },
};

if (typeof window !== 'undefined') window.Recall = Recall;
if (typeof module !== 'undefined' && module.exports) module.exports = { Recall };
