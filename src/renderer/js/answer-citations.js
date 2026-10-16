// === Show-me-where citations (T2-023) ===========================================
//
// The knowledge-base answer already numbers its sources ([1], [2]). A number is
// a claim by the model, not proof. This adds the proof step, in code:
//
//   - the model is asked, for each source it cites, to COPY the exact words from
//     that source that support the claim ("quotes");
//   - code checks each quote against the text of that source (same words, white
//     space and quote marks aside). A quote that is not there is not trusted;
//   - each sentence of the answer becomes a claim: SUPPORTED when it cites a
//     source whose verified quote also shares real words (numbers, names) with
//     the sentence; otherwise greyed, with the reason (no source named, quote
//     not found in the source, quote does not match the sentence);
//   - a supported claim gets a chip. Pressing it goes to that page (the one you
//     are on, an open tab, or a new tab) and highlights the passage with the
//     browser's own find, which scrolls to it. Nothing on the page is changed.
//
// What this proves: the quoted words exist in the source. It cannot prove the
// sentence means what the quote means; the overlap test only removes nonsense.
// The wording in the panel says so.
//
// Pure functions (norm, claims, verify, snippet) have no DOM and are tested
// directly (tests/renderer/answerCitations.test.js).

const VexAnswerCitations = {
  FEATURE: 'answer-citations',
  KEY_ENABLED: 'vex.answerCitations.enabled',
  MIN_QUOTE: 12,        // characters; a shorter "quote" proves nothing
  MIN_SHARED: 1,        // meaningful words a claim and its quote must share

  enabled() { try { return localStorage.getItem(this.KEY_ENABLED) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.KEY_ENABLED, on ? 'on' : 'off'); }
    catch (err) { throw new Error('The setting could not be saved: ' + err.message, { cause: err }); }
  },

  // White space, quote marks, dashes and case made alike, so a quote copied from
  // a page with curly quotes still matches. NOT stemmed, NOT fuzzy.
  norm(s) {
    return String(s == null ? '' : s)
      .replace(/[‘’‛′]/g, "'").replace(/[“”‟″]/g, '"')
      .replace(/[‐-―−]/g, '-').replace(/ /g, ' ')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  },

  // Is `quote` really in `text`? -> offset in the normalised text, or -1.
  find(text, quote) {
    const q = this.norm(quote);
    if (q.length < this.MIN_QUOTE) return -1;
    return this.norm(text).indexOf(q);
  },

  // The sentences of an answer, with the source numbers each one names.
  claims(answer) {
    const text = String(answer == null ? '' : answer).replace(/\r/g, '').trim();
    if (!text) return [];
    // Split after . ! ? (and a closing [n] cluster), keeping the markers on their sentence.
    const parts = text.split(/(?<=[.!?…](?:\s*\[\d{1,2}\])*)\s+|\n+/).map(s => s.trim()).filter(Boolean);
    return parts.map(t => {
      const cites = [];
      for (const m of t.matchAll(/\[(\d{1,2})\]/g)) { const n = Number(m[1]); if (!cites.includes(n)) cites.push(n); }
      return { text: t, cites };
    });
  },

  _words(s) {
    return new Set((this.norm(s).match(/[\p{L}\p{N}]{4,}|\d+/gu) || []).filter(w => !this.STOP.has(w)));
  },
  STOP: new Set(['this', 'that', 'with', 'from', 'have', 'been', 'were', 'will', 'there', 'their', 'which', 'about', 'would', 'could', 'should', 'into', 'than', 'then', 'them', 'they', 'what', 'when', 'where', 'also', 'only', 'does', 'your']),

  // The words an answer's sentence and a quote have in common (numbers count).
  shared(sentence, quote) {
    const a = this._words(sentence.replace(/\[\d{1,2}\]/g, ' ')), b = this._words(quote);
    let n = 0;
    for (const w of a) if (b.has(w)) n++;
    return n;
  },

  /**
   * answer: the model's text; quotes: [{ n, quote }]; sources: [{ n, passage|text }].
   * -> [{ text, cites, status: 'supported' | 'unsupported', reason, n, quote }]
   */
  verify(answer, quotes, sources) {
    const byN = new Map();
    for (const s of Array.isArray(sources) ? sources : []) byN.set(Number(s.n), String(s.passage != null ? s.passage : (s.text || '')));
    const qs = (Array.isArray(quotes) ? quotes : []).filter(q => q && Number.isFinite(Number(q.n)) && typeof q.quote === 'string');
    return this.claims(answer).map(c => {
      if (!c.cites.length) return { ...c, status: 'unsupported', reason: 'It names no source.' };
      let reason = 'The model gave no quote for the source it named.';
      for (const n of c.cites) {
        if (!byN.has(n)) { reason = 'It names source [' + n + '], which does not exist.'; continue; }
        const mine = qs.filter(q => Number(q.n) === n);
        for (const q of mine) {
          if (this.find(byN.get(n), q.quote) < 0) { reason = 'The quote it gave for [' + n + '] is not in that source.'; continue; }
          if (this.shared(c.text, q.quote) < this.MIN_SHARED) { reason = 'The quote it gave for [' + n + '] has nothing in common with this sentence.'; continue; }
          return { ...c, status: 'supported', reason: '', n, quote: q.quote.trim() };
        }
      }
      return { ...c, status: 'unsupported', reason };
    });
  },

  // The quotes out of a model reply: {"reply": "...", "quotes":[{n, quote}]}. [] when absent.
  parseQuotes(result) {
    let o = result;
    if (typeof o === 'string') {
      const raw = o.trim();
      if (!raw.startsWith('{')) return [];
      try { o = JSON.parse(raw); } catch { return []; }   // vex-allow-empty-catch: plain text, no quotes to read
    }
    if (!o || typeof o !== 'object' || !Array.isArray(o.quotes)) return [];
    return o.quotes
      .filter(q => q && typeof q.quote === 'string' && Number.isFinite(Number(q.n)))
      .slice(0, 40)
      .map(q => ({ n: Number(q.n), quote: q.quote.slice(0, 600) }));
  },

  // A line for the browser's find: one line, not too long, no odd edges.
  snippet(quote) {
    const one = String(quote || '').replace(/\s+/g, ' ').trim();
    if (one.length <= 80) return one;
    const cut = one.slice(0, 80);
    return cut.slice(0, Math.max(40, cut.lastIndexOf(' '))).trim();
  },

  summaryLine(claims) {
    const ok = claims.filter(c => c.status === 'supported').length;
    if (!claims.length) return '';
    return ok + ' of ' + claims.length + ' statement' + (claims.length === 1 ? '' : 's') + ' point to words that really are in the source. Grey ones do not, so check them yourself. A match shows the words exist, not that the statement reads them correctly.';
  },

  // ---- going to the passage (needs the app) -------------------------------------------------
  _key(url) { try { const u = new URL(String(url)); return u.origin + u.pathname.replace(/\/+$/, ''); } catch { return ''; } },

  _highlight(wv, quote) {
    const text = this.snippet(quote);
    if (!text) throw new Error('There is no passage to find.');
    wv.findInPage(text);
    // The highlight is the browser's own find mark; it clears itself.
    setTimeout(() => { try { wv.stopFindInPage('clearSelection'); } catch (err) { VexProblems?.note('Citations', 'Could not clear the highlight', err); } }, 12000);
  },

  /** Opens (or switches to) the source and highlights the quote. Returns what it did. */
  async showWhere(source, quote) {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') throw new Error('The page view is not available here.');
    if (!source || !source.url || !/^https?:/i.test(source.url)) throw new Error('This source is not a web page, so there is nothing to scroll to. Its passage: "' + this.snippet(quote) + '"');
    const key = this._key(source.url);
    const active = WebviewManager.getActiveWebview();
    if (active && this._key(active.getURL && active.getURL()) === key) { this._highlight(active, quote); return 'highlighted'; }
    const open = TabManager.tabs.find(t => t && this._key(t.url) === key);
    if (open) {
      TabManager.switchTab(open.id);
      const wv = WebviewManager.getActiveWebview();
      if (!wv) throw new Error('The tab could not be shown.');
      this._highlight(wv, quote);
      return 'highlighted';
    }
    TabManager.createTab(source.url, true);
    const wv = WebviewManager.getActiveWebview();
    if (!wv) throw new Error('The new tab could not be shown.');
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => { wv.removeEventListener('did-finish-load', done); reject(new Error('The page did not finish loading. Its passage: "' + this.snippet(quote) + '"')); }, 25000);
      const done = () => { clearTimeout(t); wv.removeEventListener('did-finish-load', done); resolve(); };
      wv.addEventListener('did-finish-load', done);
    });
    // A page that rebuilds itself after load needs a moment before its text can be found.
    await new Promise(r => setTimeout(r, 600));
    this._highlight(wv, quote);
    return 'opened';
  },

  // ---- drawing an answer with its chips ---------------------------------------------------------
  /** Puts the claims into `host`: supported ones with a "Show me where" chip, the rest greyed with the reason. */
  render(host, claims, sources, { onError } = {}) {
    host.textContent = '';
    for (const c of claims) {
      const line = document.createElement('div');
      line.style.cssText = 'margin:4px 0';
      const t = document.createElement('span');
      t.textContent = c.text + ' ';
      if (c.status !== 'supported') { t.style.opacity = '.55'; t.title = c.reason; line.setAttribute('data-citation', 'unsupported'); }
      else line.setAttribute('data-citation', 'supported');
      line.appendChild(t);
      if (c.status === 'supported') {
        const src = (sources || []).find(s => Number(s.n) === c.n);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'vexsr-x';
        chip.textContent = 'Show me where [' + c.n + ']';
        chip.setAttribute('aria-label', 'Show me where in source ' + c.n + ': ' + this.snippet(c.quote));
        chip.addEventListener('click', async () => {
          chip.disabled = true;
          try { await this.showWhere(src, c.quote); }
          catch (err) { if (onError) onError(err); else window.showToast?.(err.message, 'error'); }
          chip.disabled = false;
        });
        line.appendChild(chip);
      } else {
        const why = document.createElement('span');
        why.className = 'vexsr-mode';
        why.textContent = '(' + c.reason + ')';
        line.appendChild(why);
      }
      host.appendChild(line);
    }
  },
};

if (typeof window !== 'undefined') window.VexAnswerCitations = VexAnswerCitations;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexAnswerCitations };
