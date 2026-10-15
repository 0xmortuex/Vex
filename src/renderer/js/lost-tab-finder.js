// === Lost-tab finder =========================================================
//
// "That page about DPI I read last week." One box that understands the time
// phrase, drops the filler words and searches two things Vex keeps locally:
//
//   Recall    the saved text of pages you read (src/main/recall-index.js), by
//             words and, when you picked an embedding model in Settings >
//             Recall, by meaning (a model on this PC; main refuses any other
//             address)
//   History   titles and addresses of what you visited
//
// Nothing here calls a cloud model or a server: this does not use Recall's
// "smart search", which asks the AI router to widen the query. Private and Tor
// tabs never reach history or Recall; addresses of .onion sites, hosts you
// excluded from Recall, and anything marked private are left out again here.
const LostTabFinder = {
  FILLER: new Set(['that', 'the', 'a', 'an', 'page', 'pages', 'article', 'site', 'website', 'tab', 'tabs', 'thing', 'about', 'on', 'of', 'i', 'read', 'saw', 'was', 'were', 'visited', 'opened', 'looking', 'at', 'from', 'with', 'had', 'my', 'it', 'one', 'where', 'there', 'some', 'something', 'found']),
  DAY: 24 * 3600 * 1000,

  // "that page about X last week" -> { terms: ['x'], since, until, label }.
  parse(text, now = Date.now()) {
    let s = String(text == null ? '' : text).toLowerCase().replace(/[^\p{L}\p{N}\s:'-]/gu, ' ').replace(/\s+/g, ' ').trim();
    const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const today = startOfDay(now);
    let since = 0, until = 0, label = '';
    const cut = (re) => { const m = re.exec(s); if (m) s = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(); return m; };
    let m;
    if ((m = cut(/\b(\d{1,3}) (day|days|week|weeks|month|months) ago\b/))) {
      const n = Number(m[1]);
      const unit = m[2].startsWith('day') ? 1 : m[2].startsWith('week') ? 7 : 30;
      const slack = unit === 1 ? 1 : Math.round(unit / 2);
      since = today - (n * unit + slack) * this.DAY;
      until = today - (n * unit - slack) * this.DAY + this.DAY;
      label = m[0];
    } else if (cut(/\bday before yesterday\b/)) {
      since = today - 2 * this.DAY; until = today - this.DAY; label = 'the day before yesterday';
    } else if (cut(/\b(last night|yesterday)\b/)) {
      since = today - this.DAY; until = today; label = 'yesterday';
    } else if (cut(/\b(today|this morning|earlier)\b/)) {
      since = today; label = 'today';
    } else if (cut(/\bthis week\b/)) {
      since = today - ((new Date(now).getDay() + 6) % 7) * this.DAY; label = 'this week';
    } else if (cut(/\b(last week|past week|a week ago|few days ago|the other day|recently)\b/)) {
      since = today - 14 * this.DAY; label = 'the last two weeks';
    } else if (cut(/\b(last month|a month ago|past month)\b/)) {
      since = today - 62 * this.DAY; until = today - 20 * this.DAY; label = 'about last month';
    }
    const terms = s.split(' ').filter(w => w && !this.FILLER.has(w) && (w.length > 1 || /\d/.test(w)));
    return { terms, since, until, label };
  },

  _host(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },

  // May this address ever be shown here?
  allowed(url, entry) {
    if (!/^https?:\/\//i.test(String(url || ''))) return false;
    if (entry && (entry.private || entry.incognito || entry.tor || entry.ephemeral || entry.ownSession)) return false;
    const host = this._host(url);
    if (!host || host.endsWith('.onion')) return false;
    try { if (typeof Recall !== 'undefined' && Recall.isExcluded(url)) return false; } catch { /* no recall: nothing excluded there */ }
    return true;
  },

  _when(e) { const t = new Date(e.visitedAt || e.time || e.at || 0).getTime(); return Number.isFinite(t) ? t : 0; },

  // History entries matching every term (title or address), best first.
  searchHistory(parsed, entries) {
    const out = [];
    for (const e of entries || []) {
      if (!e || !this.allowed(e.url, e)) continue;
      const at = this._when(e);
      if (parsed.since && at && at < parsed.since) continue;
      if (parsed.until && at && at > parsed.until) continue;
      const hay = ((e.title || '') + ' ' + e.url).toLowerCase();
      if (parsed.terms.length && !parsed.terms.every(t => hay.includes(t))) continue;
      const inTitle = e.title && parsed.terms.every(t => String(e.title).toLowerCase().includes(t));
      out.push({ url: e.url, title: e.title || e.url, at, from: 'history', score: 1 + (inTitle ? 1 : 0) });
    }
    return out.sort((a, b) => b.score - a.score || b.at - a.at);
  },

  // Recall hits, filtered the same way.
  _fromRecall(res, parsed) {
    return ((res && res.hits) || [])
      .filter(h => this.allowed(h.url, h) && (!parsed.since || !h.at || h.at >= parsed.since) && (!parsed.until || !h.at || h.at <= parsed.until))
      .map((h, i) => ({
        url: h.url, title: h.title || h.url, at: h.at || 0, from: 'recall', byMeaning: !!h.byMeaning,
        snippet: h.snippet ? (Array.isArray(h.snippet) ? h.snippet.map(p => (p && p.t) || (typeof p === 'string' ? p : '')).join('') : String(h.snippet)) : '',
        score: 3 - Math.min(i, 20) / 10,
      }));
  },

  // Merge by address: a page found by both keeps the Recall snippet.
  merge(...lists) {
    const by = new Map();
    for (const list of lists) {
      for (const r of list) {
        const cur = by.get(r.url);
        if (!cur) by.set(r.url, { ...r });
        else { cur.score += r.score; cur.snippet = cur.snippet || r.snippet; cur.at = Math.max(cur.at, r.at); cur.from = 'both'; }
      }
    }
    return [...by.values()].sort((a, b) => b.score - a.score || b.at - a.at);
  },

  async find(text, { now = Date.now(), limit = 20 } = {}) {
    const parsed = this.parse(text, now);
    if (!parsed.terms.length) throw new Error('Say what the page was about, for example "the page about DPI last week"');
    const query = parsed.terms.join(' ');
    const history = (typeof HistoryPanel !== 'undefined' && typeof HistoryPanel.list === 'function') ? this.searchHistory(parsed, HistoryPanel.list()) : [];
    let recall = [];
    let note = '';
    if (typeof Recall !== 'undefined' && Recall.enabled()) {
      const opts = { since: parsed.since || undefined, limit: 40 };
      const res = (typeof Recall.meaningOn === 'function' && Recall.meaningOn())
        ? await Recall.searchByMeaning(query, opts)
        : await Recall.search(query, opts);
      recall = this._fromRecall(res, parsed);
      if (res && res.meaningError) note = res.meaningError;
    } else note = 'Recall is off, so only history titles were searched.';
    return { parsed, results: this.merge(recall, history).slice(0, limit), note };
  },

  when(ms) { return ms ? new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; },

  async open(initial = '') {
    document.querySelector('.vex-finder-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-finder-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.4);display:grid;place-items:start center;padding-top:8vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Find a page" style="width:min(640px,94vw);max-height:76vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <form data-form style="padding:12px 14px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">
          ${VexIcons.svg('search', { size: 14 })}
          <input data-q type="text" class="set-input" style="flex:1" placeholder="That page about... last week" aria-label="What was the page about" value="${esc(initial)}">
          <button type="submit" class="btn-primary">Find</button>
          <button type="button" class="btn-secondary" data-close aria-label="Close">${VexIcons.svg('x', { size: 12 })}</button>
        </form>
        <div data-note style="padding:6px 14px;font-size:11px;color:var(--text-muted)">Searches your history and the text of pages you read, on this PC. Private and Tor tabs are never included.</div>
        <div data-body style="overflow-y:auto;padding:6px;flex:1"></div>
      </div>`;
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    overlay.querySelector('[data-close]').addEventListener('click', close);
    const q = overlay.querySelector('[data-q]');
    const body = overlay.querySelector('[data-body]');
    const note = overlay.querySelector('[data-note]');
    const run = async () => {
      body.textContent = '';
      note.textContent = 'Searching...';
      let out;
      try { out = await this.find(q.value); }
      catch (err) { note.textContent = err.message; return; }
      if (!overlay.isConnected) return;
      note.textContent = (out.results.length ? out.results.length + ' found' : 'Nothing found') + (out.parsed.label ? ' for ' + out.parsed.label : '') + (out.note ? '. ' + out.note : '.');
      body.innerHTML = out.results.map((r, i) => `
        <div data-i="${i}" style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:8px">
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.title)}</div>
            <div style="font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(this._host(r.url))}${r.at ? ' · ' + esc(this.when(r.at)) : ''}${r.byMeaning ? ' · matched by meaning' : ''}${r.snippet ? ' · ' + esc(r.snippet.slice(0, 120)) : ''}</div>
          </div>
          <button type="button" class="btn-secondary" data-act="open">Open</button>
          <button type="button" class="btn-secondary" data-act="snooze" aria-label="Snooze">${VexIcons.svg('clock', { size: 12 })}</button>
        </div>`).join('');
      body.querySelectorAll('[data-i]').forEach((row) => {
        const r = out.results[Number(row.dataset.i)];
        row.querySelector('[data-act="open"]').addEventListener('click', () => { close(); TabManager.createTab(r.url, true); });
        row.querySelector('[data-act="snooze"]').addEventListener('click', async () => {
          try {
            const at = await VexSnooze.ask('Snooze this page until when?');
            if (at == null) return;
            VexSnooze.snoozeLink('page', { title: r.title, url: r.url }, at);
            window.showToast?.('Snoozed, it will be in your next brief');
          } catch (err) { window.showToast?.(err.message, 'error'); }
        });
      });
    };
    overlay.querySelector('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); run(); });
    q.focus();
    if (initial) await run();
    return overlay;
  },
};

if (typeof window !== 'undefined') window.LostTabFinder = LostTabFinder;
if (typeof module !== 'undefined' && module.exports) module.exports = { LostTabFinder };
