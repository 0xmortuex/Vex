// === Find with a regular expression ======================================================================
//
// Ctrl+K "Find With Regular Expression": a small bar over the page in front. The person types a JavaScript regular expression,
// the matches in the page's TEXT are drawn with the same CSS Custom Highlight API colours the whole-word find uses
// (js/whole-word-find.js), counted, and stepped through with Next / Previous. Nothing is stored, nothing leaves the page.
//
// Why a pattern cannot freeze anything (three guards, in this order):
//   1. analyze(): a pattern is refused before it runs when it has a back-reference, more than six open-ended repeats,
//      an open-ended repeat inside an open-ended repeat ((a+)+, (.*)*, (\w+\s?)*), or a repeated group of alternatives that are not
//      plain words with different first letters ((a|a)+, (a|ab)*). Those are the shapes that make a regular expression take
//      exponential or high-polynomial time. The reason is shown in words.
//   2. The page is NOT where the pattern runs. The page only hands over its visible text (at most MAX_TEXT characters in all, an
//      overlong text node is cut at MAX_NODE), and the matching runs in a Web Worker of this window. If it has not answered in
//      TIMEOUT_MS the worker is terminated (Worker.terminate stops even a regular expression stuck in backtracking) and the
//      search fails out loud. So even a pattern the checker did not foresee costs at most TIMEOUT_MS of one background thread
//      and never a frozen page or a frozen Vex.
//   3. At most MAX_MATCHES matches are drawn; an empty match is skipped.
// Limits, said plainly: a match cannot span two text nodes (<b>wo</b>rd is two nodes), text inside a closed shadow root, an iframe or a
// canvas is not seen, and the checker is conservative: it can refuse a harmless pattern like (ab|cd)+ only when the alternatives
// start with the same letter. The flags are i (when Match case is off) and u (Unicode, so Turkish letters work in \p{L}).
const VexRegexFind = {
  MAX_PATTERN: 200,
  MAX_TEXT: 2000000,
  MAX_NODE: 20000,
  MAX_MATCHES: 5000,
  TIMEOUT_MS: 1500,
  MAX_OPEN_REPEATS: 6,
  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },

  // ---- guard 1: the pattern, before it runs. Pure. -> { ok: true } or { ok: false, reason } ------------------------------
  analyze(pattern, flags = 'u') {
    const p = String(pattern == null ? '' : pattern);
    if (!p) return { ok: false, reason: 'Type a pattern first' };
    if (p.length > this.MAX_PATTERN) return { ok: false, reason: 'A pattern is at most ' + this.MAX_PATTERN + ' characters' };
    try { new RegExp(p, flags); } catch (err) { return { ok: false, reason: 'This is not a valid pattern: ' + err.message }; }
    if (/\\[1-9]|\\k</.test(p.replace(/\\\\/g, ''))) return { ok: false, reason: 'Back-references are not allowed: they can make a search take for ever' };
    const open = (q) => q === '*' || q === '+' || /^\{\d+,(\d*)\}$/.test(q) && (q.endsWith(',}') || Number(q.slice(q.indexOf(',') + 1, -1)) > 100);
    const stack = [{ hasOpen: false, alts: [], cur: '', start: 0 }];
    let opens = 0;
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      const top = stack[stack.length - 1];
      if (c === '\\') { top.cur += p.slice(i, i + 2); i++; continue; }
      if (c === '[') {
        let j = i + 1;
        if (p[j] === '^') j++;
        if (p[j] === ']') j++;
        while (j < p.length && p[j] !== ']') j += p[j] === '\\' ? 2 : 1;
        top.cur += p.slice(i, j + 1);
        i = j;
        continue;
      }
      if (c === '(') { stack.push({ hasOpen: false, alts: [], cur: '', start: i }); continue; }
      if (c === '|') { top.alts.push(top.cur); top.cur = ''; continue; }
      let group = null;
      if (c === ')') {
        if (stack.length < 2) return { ok: false, reason: 'This is not a valid pattern: unmatched )' };
        group = stack.pop();
        group.alts.push(group.cur);
      }
      // What follows is a quantifier, if any.
      let q = '';
      const rest = p.slice(i + 1);
      const m = /^(?:[*+?]|\{\d+(?:,\d*)?\})/.exec(rest);
      if (m) q = m[0];
      const parent = stack[stack.length - 1];
      if (group) {
        if (q && open(q)) {
          if (group.hasOpen) return { ok: false, reason: 'A repeat inside a repeat, like (a+)+, can make a search take for ever' };
          if (group.alts.length > 1) {
            const firsts = group.alts.map(a => a.replace(/^\?[:=!]|^\?<[=!]|^\?<\w+>/, ''));
            const plain = firsts.every(a => a.length > 0 && /^[\p{L}\p{N} ]+$/u.test(a));
            const heads = firsts.map(a => a[0] && a[0].toLowerCase());
            if (!plain || new Set(heads).size !== heads.length) return { ok: false, reason: 'A repeated choice like (a|ab)* can make a search take for ever; use plain words that start with different letters' };
          }
          opens++;
          parent.hasOpen = true;
        } else if (group.hasOpen) parent.hasOpen = true;
        parent.cur += '(' + group.cur + ')' + q;
        i += q.length;
        continue;
      }
      if (c === '*' || c === '+' || (c === '{' && /^\{\d+(?:,\d*)?\}/.test(p.slice(i)))) {
        const mm = c === '{' ? /^\{\d+(?:,\d*)?\}/.exec(p.slice(i))[0] : c;
        if (open(mm)) { opens++; top.hasOpen = true; }
        i += mm.length - 1;
        top.cur += mm;
        continue;
      }
      top.cur += c;
    }
    if (stack.length !== 1) return { ok: false, reason: 'This is not a valid pattern: unmatched (' };
    if (opens > this.MAX_OPEN_REPEATS) return { ok: false, reason: 'More than ' + this.MAX_OPEN_REPEATS + ' open-ended repeats (* or +) can make a search take for ever' };
    return { ok: true };
  },

  // ---- guard 2: the matching, in a worker. findMatches is also the body of the worker, so it uses nothing from outside. --------
  // texts: the page's text nodes' strings. -> { hits: [[nodeIndex, start, end], ...], capped }
  findMatches: function (texts, pattern, flags, max) {
    var re = new RegExp(pattern, flags.indexOf('g') < 0 ? flags + 'g' : flags);
    var hits = [], capped = false, m;
    for (var i = 0; i < texts.length && !capped; i++) {
      re.lastIndex = 0;
      while ((m = re.exec(texts[i]))) {
        if (!m[0]) { re.lastIndex++; continue; }
        if (hits.length >= max) { capped = true; break; }
        hits.push([i, m.index, m.index + m[0].length]);
      }
    }
    return { hits: hits, capped: capped };
  },
  _workerSource() {
    return '(' + function (find) {
      self.onmessage = function (e) {
        var d = e.data;
        try { self.postMessage({ ok: true, result: find(d.texts, d.pattern, d.flags, d.max) }); }
        catch (err) { self.postMessage({ ok: false, error: String(err && err.message || err) }); }
      };
    }.toString() + ')(' + this.findMatches.toString() + ')';
  },
  _makeWorker() {
    const url = URL.createObjectURL(new Blob([this._workerSource()], { type: 'text/javascript' }));
    const w = new Worker(url);
    w._vexUrl = url;          // revoked when the worker is stopped
    return w;
  },
  // Runs the matching with a time limit. makeWorker is injectable for tests. Rejects with a plain message on a timeout.
  matchInWorker(texts, pattern, flags, { max = this.MAX_MATCHES, timeoutMs = this.TIMEOUT_MS, makeWorker = () => this._makeWorker(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    return new Promise((resolve, reject) => {
      const worker = makeWorker();
      let done = false;
      const finish = (fn, value) => { if (done) return; done = true; clearTimer(timer); worker.terminate(); if (worker._vexUrl) URL.revokeObjectURL(worker._vexUrl); fn(value); };
      const timer = setTimer(() => finish(reject, new Error('The search took longer than ' + (timeoutMs / 1000) + ' seconds and was stopped. Try a simpler pattern.')), timeoutMs);
      worker.onmessage = (e) => {
        const d = e.data || {};
        if (d.ok) finish(resolve, d.result); else finish(reject, new Error(d.error || 'The search failed'));
      };
      worker.onerror = (e) => finish(reject, new Error('The search failed: ' + ((e && e.message) || 'worker error')));
      worker.postMessage({ texts, pattern, flags, max });
    });
  },

  // ---- the page's side (these run INSIDE the page: they are turned into text, so they use nothing from outside) ------------------
  // collect: the visible text nodes; the nodes stay in window.__vexRX for apply. -> { texts, capped }
  pageCollect: function (a) {
    var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1, OPTION: 1, SELECT: 1 };
    var S = window.__vexRX || (window.__vexRX = { nodes: [], ranges: [], i: -1 });
    var texts = [], nodes = [], total = 0, capped = false;
    var w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentElement;
        if (!p || SKIP[p.tagName] || !n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (typeof p.checkVisibility === 'function' && !p.checkVisibility({ checkVisibilityCSS: true })) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = w.nextNode())) {
      var t = node.nodeValue;
      if (t.length > a.maxNode) { t = t.slice(0, a.maxNode); capped = true; }
      if (total + t.length > a.maxText) { capped = true; break; }
      total += t.length;
      texts.push(t); nodes.push(node);
    }
    S.nodes = nodes; S.ranges = []; S.i = -1;
    return { texts: texts, capped: capped };
  },
  // apply: draws the hits and (op 'find') goes to the first one, or (op 'next' / 'prev') steps. -> { total, active, stale }
  pageApply: function (op, a) {
    var NAME = 'vex-ww', ACTIVE = 'vex-ww-active';
    var S = window.__vexRX || (window.__vexRX = { nodes: [], ranges: [], i: -1 });
    function clear() { if (window.CSS && CSS.highlights) { CSS.highlights.delete(NAME); CSS.highlights.delete(ACTIVE); } }
    if (op === 'clear') { clear(); S.nodes = []; S.ranges = []; S.i = -1; return { total: 0, active: 0, stale: 0 }; }
    if (!window.CSS || !CSS.highlights || !window.Highlight) throw new Error('This page cannot show highlights');
    var stale = 0;
    if (op === 'find') {
      S.ranges = [];
      for (var k = 0; k < a.hits.length; k++) {
        var h = a.hits[k], n = S.nodes[h[0]];
        if (!n || !n.isConnected || n.nodeValue.length < h[2]) { stale++; continue; }
        var r = document.createRange();
        r.setStart(n, h[1]); r.setEnd(n, h[2]);
        S.ranges.push(r);
      }
      S.i = S.ranges.length ? 0 : -1;
    } else if (S.ranges.length) {
      S.i = (S.i + (op === 'prev' ? -1 : 1) + S.ranges.length) % S.ranges.length;
    }
    var total = S.ranges.length;
    if (!total) { clear(); return { total: 0, active: 0, stale: stale }; }
    CSS.highlights.set(NAME, new window.Highlight(...S.ranges));
    CSS.highlights.set(ACTIVE, new window.Highlight(S.ranges[S.i]));
    var el = S.ranges[S.i].startContainer.parentElement;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    return { total: total, active: S.i + 1, stale: stale };
  },
  _script(fn, args) { return '(' + fn.toString() + ')(' + (typeof args[0] === 'string' ? JSON.stringify(args[0]) + ',' + JSON.stringify(args[1] || {}) : JSON.stringify(args[0] || {})) + ')'; },

  flagsFor(matchCase) { return matchCase ? 'u' : 'ui'; },
  countText(r) { return r.total ? r.active + '/' + r.total + (r.capped ? '+' : '') : '0/0'; },

  // The whole search of one page. wv: a webview. -> { total, active, capped, stale }. Throws the reason in words.
  async search(wv, pattern, { matchCase = false, makeWorker } = {}) {
    if (!wv || typeof wv.executeJavaScript !== 'function') throw new Error('There is no page to search');
    const flags = this.flagsFor(matchCase);
    const verdict = this.analyze(pattern, flags);
    if (!verdict.ok) throw new Error(verdict.reason);
    if (typeof VexWholeWordFind === 'undefined') throw new Error('The highlight colours are not available in this window');
    await VexWholeWordFind._styles(wv);
    const got = await wv.executeJavaScript(this._script(this.pageCollect, [{ maxNode: this.MAX_NODE, maxText: this.MAX_TEXT }]));
    const found = await this.matchInWorker(got.texts, pattern, flags, makeWorker ? { makeWorker } : {});
    const shown = await wv.executeJavaScript(this._script(this.pageApply, ['find', { hits: found.hits }]));
    return { ...shown, capped: !!(found.capped || got.capped) };
  },
  async step(wv, forward = true) {
    if (!wv || typeof wv.executeJavaScript !== 'function') throw new Error('There is no page to search');
    return wv.executeJavaScript(this._script(this.pageApply, [forward ? 'next' : 'prev', {}]));
  },
  async clear(wv) {
    if (!wv || typeof wv.executeJavaScript !== 'function') return;
    await wv.executeJavaScript(this._script(this.pageApply, ['clear', {}]));
  },

  // ---- the bar ------------------------------------------------------------------------------------------------------------
  _bar: null,
  open() {
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null;
    if (!wv) { window.showToast?.(this._t('Open a page first')); return null; }
    this.close();
    const T = (s) => this._t(s);
    const el = document.createElement('div');
    el.id = 'vex-regex-find';
    el.setAttribute('role', 'search');
    el.setAttribute('aria-label', T('Find with a regular expression'));
    el.style.cssText = 'position:fixed;top:92px;right:24px;z-index:100060;width:380px;max-width:92vw;padding:10px 12px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,0.4);font-size:12.5px;display:flex;flex-direction:column;gap:8px';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center';
    const input = document.createElement('input');
    input.type = 'text'; input.spellcheck = false;
    input.placeholder = T('Regular expression, for example [0-9]{4}-[0-9]{2}');
    input.setAttribute('aria-label', T('Regular expression'));
    input.style.cssText = 'flex:1;min-width:0;padding:5px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px';
    const count = document.createElement('span');
    count.style.cssText = 'min-width:44px;text-align:right;color:var(--text-muted)';
    count.setAttribute('aria-live', 'polite');
    row.append(input, count);
    const row2 = document.createElement('div');
    row2.style.cssText = 'display:flex;gap:6px;align-items:center';
    const caseLabel = document.createElement('label');
    caseLabel.style.cssText = 'display:flex;gap:4px;align-items:center;margin-right:auto;color:var(--text-muted)';
    const caseBox = document.createElement('input');
    caseBox.type = 'checkbox';
    caseLabel.append(caseBox, document.createTextNode(T('Match case')));
    const msg = document.createElement('div');
    msg.style.cssText = 'color:var(--text-muted);min-height:1em';
    msg.setAttribute('role', 'status');
    const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = T(label); b.style.cssText = 'padding:4px 10px;background:none;color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px'; b.addEventListener('click', fn); return b; };
    const show = (r) => { count.textContent = this.countText(r); msg.textContent = r.stale ? T('The page changed while searching; search again') : ''; };
    const fail = (err) => { count.textContent = ''; msg.textContent = this._t(err.message); };
    const run = () => this.search(wv, input.value, { matchCase: caseBox.checked }).then(show).catch(fail);
    const go = (forward) => this.step(wv, forward).then((r) => show({ ...r, capped: false })).catch(fail);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey && count.textContent) go(false); else run(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    caseBox.addEventListener('change', () => { if (input.value) run(); });
    row2.append(caseLabel, mk('Previous', () => go(false)), mk('Next', () => go(true)), mk('Find', run), mk('Close', () => this.close()));
    el.append(row, row2, msg);
    document.body.appendChild(el);
    if (typeof VexLayer !== 'undefined') VexLayer.track(el, { tier: 'toast', id: 'regex-find', close: () => this.close() });
    this._bar = { el, wv };
    input.focus();
    return el;
  },
  close() {
    const b = this._bar;
    this._bar = null;
    document.getElementById('vex-regex-find')?.remove();
    if (b) this.clear(b.wv).catch((err) => window.VexProblems?.note('Regex find', 'the highlights could not be cleared', err));
  },
};

if (typeof window !== 'undefined') {
  window.VexRegexFind = VexRegexFind;
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'regex-find', label: 'Find With Regular Expression', hint: 'Search the page in front with a pattern such as [0-9]{4}-[0-9]{2}; matches are highlighted and counted', icon: 'search', action: () => { try { VexRegexFind.open(); } catch (err) { window.VexProblems?.note('Regex find', 'the bar did not open', err); window.showToast?.(err.message, 'error'); } } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexRegexFind };
