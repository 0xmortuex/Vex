// === Web taming: the pages you read, kept in order ==========================
//
// Six small features that sit on top of what Vex already has (reading mode,
// the page watcher and its diff, the screenshot tool, Notes, highlights):
//
//   ReaderFirst    news-site links open in the reader with a 3-line summary
//   ComparePages   two tabs -> what differs, written by the LOCAL model
//   PriceStock     price / stock watch presets and a history chart
//   PageChangelog  on a revisit, what changed on a docs page since last time
//   TabDedupe      the same page in several tabs -> one, keeping your place
//   HighlightNotes a highlight is also written into a "Highlights" note
//   ShotToNote     a screenshot (or a region of the page) saved as a note
//
// Everything that reads page text for an AI uses the local model only (Ollama);
// without one the feature says so instead of sending the page anywhere.
// Icons are VexIcons, dialogs are Vex's own, nothing here uses emoji.

// ---- shared helpers --------------------------------------------------------
const WebTaming = {
  esc(s) {
    return (typeof window !== 'undefined' && window.escapeHtml) ? window.escapeHtml(String(s == null ? '' : s))
      : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  },
  icon(name, size = 16) {
    return (typeof VexIcons !== 'undefined' && VexIcons.svg) ? VexIcons.svg(name, { size }) : '';
  },
  toast(msg, kind) { try { window.showToast?.(msg, kind); } catch { /* no toast layer */ } },
  hostOf(url) { try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },
  activeTab() {
    return (typeof TabManager !== 'undefined' && TabManager.getActiveTab) ? TabManager.getActiveTab() : null;
  },
  webviewOf(tabId) {
    return (typeof WebviewManager !== 'undefined' && WebviewManager.webviews) ? (WebviewManager.webviews.get(tabId) || null) : null;
  },
  tabById(id) {
    return (typeof TabManager !== 'undefined') ? (TabManager.tabs.find(t => t.id === id) || null) : null;
  },
  // A read of localStorage JSON that never throws and never returns garbage.
  readJson(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || 'null');
      return v && typeof v === 'object' ? v : fallback;
    } catch { return fallback; }
  },
  writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (err) {
      if (typeof VexProblems !== 'undefined') VexProblems.note('Web taming', 'Could not save ' + key, err);
      return false;
    }
  },
  localAiReady() {
    try { return typeof Ollama !== 'undefined' && typeof AIRouter !== 'undefined' && AIRouter.isOllamaAvailable() && !!AIRouter.getModel(); }
    catch { return false; }
  },
  NO_LOCAL_AI: 'This needs a local model (Settings > AI). Nothing was sent anywhere.',
  // One answer from the local model. Throws, in words, when there is none.
  async askLocal(prompt, { maxTokens = 400, timeoutMs = 60000, temperature = 0.2 } = {}) {
    if (!this.localAiReady()) throw new Error(this.NO_LOCAL_AI);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return String(await Ollama.generate(String(AIRouter.getModel()), prompt, { temperature, maxTokens, signal: ctl.signal }) || '').trim();
    } finally { clearTimeout(timer); }
  },
  // A modal in the page, closed by Escape or a click outside. Returns
  // { el, close }. `html` is already escaped by the caller.
  modal(id, html) {
    this.injectStyle();
    document.getElementById(id)?.remove();
    const wrap = document.createElement('div');
    wrap.id = id;
    wrap.className = 'wt-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = '<div class="wt-card">' + html + '</div>';
    document.body.appendChild(wrap);
    const onKey = (e) => {
      if (!wrap.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    wrap.querySelectorAll('[data-wt-close]').forEach(b => b.addEventListener('click', close));
    return { el: wrap, close };
  },
  injectStyle() {
    if (document.getElementById('wt-style')) return;
    const s = document.createElement('style');
    s.id = 'wt-style';
    s.textContent = `
.wt-overlay{position:fixed;inset:0;z-index:100060;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}
.wt-card{width:620px;max-width:94vw;max-height:84vh;overflow:auto;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px var(--vex-shadow-color,rgba(0,0,0,.4));padding:16px 18px;font-size:13px}
.wt-title{margin:0 0 4px;font-size:16px;font-weight:600}
.wt-muted{color:var(--text-muted);font-size:12px}
.wt-row{display:flex;align-items:center;gap:8px;margin:8px 0;flex-wrap:wrap}
.wt-row select,.wt-row input[type=text]{flex:1;min-width:0;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;padding:6px 8px}
.wt-btn{padding:6px 12px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12.5px;display:inline-flex;align-items:center;gap:6px}
.wt-btn:hover{background:var(--vex-hover-fill)}
.wt-btn.wt-primary{background:var(--accent);color:var(--accent-text,#fff);border-color:var(--accent)}
.wt-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.wt-out{margin-top:10px;line-height:1.5}
.wt-site{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)}
.wt-site span{flex:1;overflow:hidden;text-overflow:ellipsis}
.wt-chip{position:fixed;right:18px;bottom:18px;z-index:100040;max-width:360px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 32px var(--vex-shadow-color,rgba(0,0,0,.35));padding:10px 12px;font-size:12.5px}
.wt-chart{width:100%;height:auto;color:var(--text)}
.wt-line{display:flex;gap:8px;padding:2px 0;font-family:var(--font-mono,monospace);font-size:12px}
.wt-region{position:fixed;z-index:100070;cursor:crosshair;background:rgba(0,0,0,.25)}
.wt-region-box{position:absolute;border:2px solid var(--accent);background:rgba(255,255,255,.12)}
`;
    document.head.appendChild(s);
  },
  // Does `host` belong to one of `sites` (the site or a subdomain of it)?
  hostIn(host, sites) {
    return (sites || []).some(s => host === s || host.endsWith('.' + s));
  },
};

// ---- a per-site opt-in list ------------------------------------------------
// { on: bool, sites: [host,...] } in localStorage under `key`.
function wtSiteList(key, suggestions) {
  return {
    key, suggestions,
    state() {
      const v = WebTaming.readJson(key, null);
      return { on: !!(v && v.on), sites: Array.isArray(v && v.sites) ? v.sites.filter(s => typeof s === 'string' && s) : [] };
    },
    _save(s) { return WebTaming.writeJson(key, s); },
    matches(url) {
      const s = this.state();
      const host = WebTaming.hostOf(url);
      return s.on && !!host && WebTaming.hostIn(host, s.sites);
    },
    has(host) { return this.state().sites.includes(host); },
    add(host) {
      const h = String(host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(h)) throw new Error('That is not a site address (like example.com)');
      const s = this.state();
      if (!s.sites.includes(h)) s.sites.push(h);
      s.on = true;
      if (!this._save(s)) throw new Error('Could not save the site list');
      return h;
    },
    remove(host) {
      const s = this.state();
      s.sites = s.sites.filter(x => x !== host);
      if (!this._save(s)) throw new Error('Could not save the site list');
    },
    setOn(on) {
      const s = this.state(); s.on = !!on;
      if (!this._save(s)) throw new Error('Could not save the setting');
    },
  };
}

// The list editor both site-based features use.
function wtSiteDialog({ id, title, intro, list, onChange }) {
  const draw = () => {
    const s = list.state();
    const sugg = list.suggestions.filter(x => !s.sites.includes(x));
    const m = WebTaming.modal(id, `
      <h2 class="wt-title">${WebTaming.esc(title)}</h2>
      <p class="wt-muted">${WebTaming.esc(intro)}</p>
      <label class="wt-row"><input type="checkbox" id="wt-on" ${s.on ? 'checked' : ''}> <span>On</span></label>
      <div id="wt-sites">${s.sites.length ? s.sites.map(h => `<div class="wt-site"><span>${WebTaming.esc(h)}</span><button class="wt-btn" data-rm="${WebTaming.esc(h)}" aria-label="Remove ${WebTaming.esc(h)}">${WebTaming.icon('x', 14)}</button></div>`).join('') : '<div class="wt-muted">No sites yet.</div>'}</div>
      <div class="wt-row"><input type="text" id="wt-new" placeholder="example.com" autocomplete="off" spellcheck="false" aria-label="Site to add"><button class="wt-btn" id="wt-add">Add</button></div>
      ${sugg.length ? `<div class="wt-row" aria-label="Suggestions">${sugg.map(h => `<button class="wt-btn" data-sug="${WebTaming.esc(h)}">${WebTaming.icon('plus', 12)} ${WebTaming.esc(h)}</button>`).join('')}</div>` : ''}
      <div class="wt-actions"><button class="wt-btn wt-primary" data-wt-close>Done</button></div>`);
    const q = (sel) => m.el.querySelector(sel);
    const act = (fn) => { try { fn(); if (onChange) onChange(); m.close(); draw(); } catch (err) { WebTaming.toast((err && err.message) || 'Could not change the list', 'error'); } };
    q('#wt-on').addEventListener('change', (e) => act(() => list.setOn(e.target.checked)));
    q('#wt-add').addEventListener('click', () => act(() => list.add(q('#wt-new').value)));
    q('#wt-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); act(() => list.add(q('#wt-new').value)); } });
    m.el.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => act(() => list.remove(b.dataset.rm))));
    m.el.querySelectorAll('[data-sug]').forEach(b => b.addEventListener('click', () => act(() => list.add(b.dataset.sug))));
  };
  draw();
}

// ---- 1. Reader-first for news ---------------------------------------------
const ReaderFirst = {
  list: wtSiteList('vex.readerFirst', [
    'bbc.com', 'bbc.co.uk', 'theguardian.com', 'reuters.com', 'apnews.com', 'nytimes.com',
    'washingtonpost.com', 'aljazeera.com', 'npr.org', 'cnn.com', 'bloomberg.com', 'theverge.com',
  ]),
  _done: new Map(),     // tabId -> the page we already opened as a reader

  // An article address, not a front page or a section: a path with a long
  // last segment, or a date in it, or at least two segments.
  looksLikeArticle(url) {
    let u;
    try { u = new URL(String(url)); } catch { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    const segs = u.pathname.split('/').filter(Boolean);
    if (!segs.length) return false;
    if (segs.length === 1 && !/[-_]/.test(segs[0]) && !/\d{4,}/.test(segs[0])) return false;
    return true;
  },

  _key(url) { return String(url || '').replace(/#.*$/, ''); },

  async onSettled(tabId) {
    if (!this.list.state().on) return;
    if (typeof ReadingMode === 'undefined' || typeof TabManager === 'undefined') return;
    if (TabManager.activeTabId !== tabId) return;
    const tab = WebTaming.tabById(tabId);
    const wv = WebTaming.webviewOf(tabId);
    if (!tab || !wv || tab.sleeping) return;
    if (window.VexTabPolicy && !window.VexTabPolicy.canShareTab(tab)) return;
    let url = '';
    try { url = wv.getURL(); } catch { return; }
    if (ReadingMode.sourceOf(url) || /^data:/i.test(url)) return;
    if (!this.list.matches(url) || !this.looksLikeArticle(url)) return;
    const key = this._key(url);
    if (this._done.get(tabId) === key) return;      // left the reader on purpose, or already here
    this._done.set(tabId, key);
    let article = null;
    try { article = await ReadingMode.activate({ auto: true, summary: true }); }
    catch (err) { console.warn('[ReaderFirst] could not open the reader:', err && err.message); return; }
    if (!article || !Array.isArray(article.blocks)) return;
    this._summarize(tabId, wv, article);
  },

  async _summarize(tabId, wv, article) {
    const say = async (lines, note) => {
      const js = `(function(){var el=document.getElementById('vr-summary');if(!el)return false;
        var b=el.querySelector('.vr-sum-body');while(b.firstChild)b.removeChild(b.firstChild);
        ${JSON.stringify(lines)}.forEach(function(t){var p=document.createElement('p');p.textContent=t;b.appendChild(p);});
        var n=el.querySelector('.vr-sum-note');n.textContent=${JSON.stringify(note || '')};return true;})()`;
      try { await wv.executeJavaScript(js); } catch (err) { console.warn('[ReaderFirst] could not write the summary:', err && err.message); }
    };
    // The reader is loading; wait for it before writing into it.
    await new Promise((resolve) => {
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(); } };
      try { wv.addEventListener('did-finish-load', fin, { once: true }); } catch { fin(); }
      setTimeout(fin, 4000);
    });
    if (!WebTaming.localAiReady()) { await say([], WebTaming.NO_LOCAL_AI); return; }
    const text = ReadingMode._plain(article.blocks).slice(0, 7000);
    if (text.length < 200) { await say([], 'Too short to summarise.'); return; }
    try {
      const out = await WebTaming.askLocal('Summarise this article in exactly 3 short lines, one plain sentence per line. No bullets, numbering or preamble.\n\n' + text, { maxTokens: 160, timeoutMs: 45000 });
      const lines = out.split(/\r?\n/).map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, 3);
      await say(lines.length ? lines : [], lines.length ? 'Summary written on this computer.' : 'The model returned nothing.');
    } catch (err) {
      await say([], 'Could not summarise: ' + ((err && err.message) || 'unknown error'));
    }
  },

  // From the reader's own "Not for this site" button.
  disableForTab(tabId) {
    const tab = WebTaming.tabById(tabId);
    const wv = WebTaming.webviewOf(tabId);
    let src = '';
    try { src = ReadingMode.sourceOf(wv.getURL()) || (tab && tab.url) || ''; } catch { src = (tab && tab.url) || ''; }
    const host = WebTaming.hostOf(src);
    if (!host) return false;
    const sites = this.list.state().sites.filter(s => host === s || host.endsWith('.' + s));
    try { sites.forEach(s => this.list.remove(s)); } catch (err) { WebTaming.toast(err.message, 'error'); return false; }
    WebTaming.toast('Reader-first is off for ' + host);
    return true;
  },

  // Command: toggle the current site.
  toggleCurrentSite() {
    const t = WebTaming.activeTab();
    const url = (t && ReadingMode.sourceOf(t.url)) || (t && t.url) || '';
    const host = WebTaming.hostOf(url);
    if (!host) { WebTaming.toast('Open a website first', 'error'); return; }
    try {
      const existing = this.list.state().sites.filter(s => host === s || host.endsWith('.' + s));
      if (existing.length) { existing.forEach(s => this.list.remove(s)); WebTaming.toast('Reader-first is off for ' + host); }
      else { this.list.add(host); WebTaming.toast('Links on ' + host + ' will open in the reader'); }
    } catch (err) { WebTaming.toast(err.message, 'error'); }
  },

  manage() {
    wtSiteDialog({
      id: 'wt-readerfirst', title: 'Reader-first sites',
      intro: 'Articles on these sites open in the clean reading view with a 3-line summary written by your local model. Press Esc in the reader to see the page itself.',
      list: this.list,
    });
  },
};

// ---- 2. Compare two pages --------------------------------------------------
const ComparePages = {
  open() {
    if (typeof TabManager === 'undefined') return;
    const tabs = TabManager.tabs.filter(t => /^https?:/i.test(t.url || '') && (!window.VexTabPolicy || window.VexTabPolicy.canShareTab(t)));
    if (tabs.length < 2) { WebTaming.toast('Open two web pages to compare', 'error'); return; }
    const active = WebTaming.activeTab();
    const opts = (sel) => tabs.map(t => `<option value="${WebTaming.esc(t.id)}"${t.id === sel ? ' selected' : ''}>${WebTaming.esc((t.title || t.url).slice(0, 70))}</option>`).join('');
    const a = tabs.find(t => active && t.id === active.id) || tabs[0];
    const b = tabs.find(t => t.id !== a.id);
    const m = WebTaming.modal('wt-compare', `
      <h2 class="wt-title">Compare two pages</h2>
      <p class="wt-muted">Read by your local model on this computer. Nothing is sent to a cloud service.</p>
      <div class="wt-row"><label for="wt-ca">Page A</label><select id="wt-ca">${opts(a.id)}</select></div>
      <div class="wt-row"><label for="wt-cb">Page B</label><select id="wt-cb">${opts(b.id)}</select></div>
      <div class="wt-out" id="wt-cout" aria-live="polite"></div>
      <div class="wt-actions"><button class="wt-btn" data-wt-close>Close</button><button class="wt-btn wt-primary" id="wt-cgo">${WebTaming.icon('scale', 14)} Compare</button></div>`);
    const go = m.el.querySelector('#wt-cgo');
    const out = m.el.querySelector('#wt-cout');
    go.addEventListener('click', async () => {
      const ta = tabs.find(t => t.id === m.el.querySelector('#wt-ca').value);
      const tb = tabs.find(t => t.id === m.el.querySelector('#wt-cb').value);
      if (!ta || !tb || ta.id === tb.id) { out.textContent = 'Pick two different pages.'; return; }
      go.disabled = true;
      out.textContent = 'Reading both pages...';
      try {
        out.innerHTML = await this.run(ta, tb);
      } catch (err) { out.textContent = (err && err.message) || 'Could not compare'; }
      go.disabled = false;
    });
  },

  // -> the answer as safe HTML.
  async run(ta, tb) {
    if (!WebTaming.localAiReady()) throw new Error(WebTaming.NO_LOCAL_AI);
    if (typeof MultiTabContext === 'undefined') throw new Error('Page reading is not available in this build');
    const ctx = await MultiTabContext.extractContextFromTabs([ta, tb], { maxCharsPerTab: 6000 });
    const bad = ctx.find(c => c.sleeping || c.unloaded || c.error);
    if (ctx.length < 2 || bad) throw new Error('One of the pages is asleep or not loaded. Open it, then compare again.');
    const prompt = 'Compare two web pages. Write short markdown with these parts: "Differences" (a bullet list: prices, specs, versions, dates, numbers, wording), "Same" (one line), "In short" (one line).\n'
      + 'Only use what is in the text below; if a value is not there, say so.\n\n'
      + '--- PAGE A: ' + ctx[0].title + ' ---\n' + ctx[0].text + '\n\n--- PAGE B: ' + ctx[1].title + ' ---\n' + ctx[1].text;
    const answer = await WebTaming.askLocal(prompt, { maxTokens: 700, timeoutMs: 90000 });
    if (!answer) throw new Error('The model returned nothing.');
    return (typeof VexMarkdown !== 'undefined' && VexMarkdown.render) ? VexMarkdown.render(answer) : '<pre>' + WebTaming.esc(answer) + '</pre>';
  },
};

// ---- 3. Price and stock ----------------------------------------------------
const PriceStock = {
  // Start a watch from the page in front, using the light preset: every 6
  // hours, no hidden tab, no wake, no AI sentence.
  async start(kind) {
    if (typeof PageWatchUI === 'undefined') { WebTaming.toast('Not available in this build', 'error'); return null; }
    const tab = WebTaming.activeTab();
    if (!tab || !/^https?:/i.test(tab.url || '')) { WebTaming.toast('Open a website first', 'error'); return null; }
    const wv = WebTaming.webviewOf(tab.id);
    let picked = null;
    try { picked = wv ? await wv.executeJavaScript(PageWatchUI.SELECTION_SCRIPT) : null; } catch { picked = null; }
    return PageWatchUI.open({ url: tab.url, title: tab.title || tab.url, partition: tab.partition || null, picked, preset: kind === 'stock' ? 'stock' : 'price' });
  },

  // The history of a price watch as numbers, oldest first.
  points(id) {
    return PageWatch.history(id)
      .map(s => ({ at: s.at, v: PageWatch.firstNumber(s.text), text: String(s.text).slice(0, 80) }))
      .filter(p => p.v != null);
  },

  // The changes AND what each check saw in between, oldest first: a price that held
  // still shows as a flat line with a dot per sample instead of a single point.
  allPoints(id) {
    const byAt = new Map();
    for (const p of this.points(id)) byAt.set(p.at, { at: p.at, v: p.v });
    for (const s of (typeof PageWatch.samples === 'function' ? PageWatch.samples(id) : [])) if (!byAt.has(s.at)) byAt.set(s.at, { at: s.at, v: s.v });
    return [...byAt.values()].sort((a, b) => a.at - b.at);
  },

  chartSvg(points) {
    const W = 560, H = 200, L = 52, R = 14, T = 14, B = 28;
    const vs = points.map(p => p.v);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (lo === hi) { lo -= 1; hi += 1; }
    const t0 = points[0].at, t1 = points[points.length - 1].at;
    const x = (t) => L + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    let d = 'M' + x(points[0].at).toFixed(1) + ' ' + y(points[0].v).toFixed(1);
    for (let i = 1; i < points.length; i++) {
      d += ' H' + x(points[i].at).toFixed(1) + ' V' + y(points[i].v).toFixed(1);   // a price holds until it changes
    }
    d += ' H' + (W - R);
    const dots = points.map(p => `<circle cx="${x(p.at).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.5" fill="var(--accent)"><title>${WebTaming.esc(new Date(p.at).toLocaleString() + ': ' + p.v)}</title></circle>`).join('');
    const fmt = (v) => (Math.round(v * 100) / 100).toString();
    const date = (t) => new Date(t).toLocaleDateString();
    return `<svg class="wt-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price history, from ${fmt(points[0].v)} to ${fmt(points[points.length - 1].v)}">
      <line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" stroke="var(--border)"/><line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="var(--border)"/>
      <text x="${L - 6}" y="${T + 4}" text-anchor="end" font-size="11" fill="currentColor">${fmt(hi)}</text>
      <text x="${L - 6}" y="${H - B}" text-anchor="end" font-size="11" fill="currentColor">${fmt(lo)}</text>
      <text x="${L}" y="${H - 8}" font-size="11" fill="currentColor">${WebTaming.esc(date(t0))}</text>
      <text x="${W - R}" y="${H - 8}" text-anchor="end" font-size="11" fill="currentColor">${WebTaming.esc(date(t1))}</text>
      <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/>${dots}</svg>`;
  },

  show(id) {
    const w = PageWatch.list().find(x => x.id === id);
    if (!w) { WebTaming.toast('That watch is gone', 'error'); return; }
    const hist = PageWatch.history(id);
    let body;
    const pts = this.allPoints(id);
    // A price watch made as "It changes" is a pattern watch whose values are
    // all prices; those chart too. A stock status is words, so it is a list.
    if (w.kind === 'number' || (w.kind === 'regex' && pts.length > 0 && pts.length >= hist.length)) {
      const line = typeof PageWatch.checkLine === 'function' ? PageWatch.checkLine(w) : '';
      if (pts.length < 2) body = `<p class="wt-muted">${pts.length ? 'Only one value has been seen so far (' + WebTaming.esc(String(pts[0].v)) + ')' + (line ? ': ' + WebTaming.esc(line) : '') + '. The chart grows with each check.' : 'Nothing recorded yet.'}</p>`;
      else {
        const first = pts[0].v, last = pts[pts.length - 1].v;
        const lows = Math.min(...pts.map(p => p.v));
        body = this.chartSvg(pts) + `<p class="wt-muted">First ${WebTaming.esc(String(first))}, now ${WebTaming.esc(String(last))}, lowest ${WebTaming.esc(String(lows))}. ${WebTaming.esc(line)}. A dot is a check that saw the value; the line steps when it changes.</p>`;
      }
    } else {
      body = hist.length
        ? hist.map(s => `<div class="wt-line"><span>${WebTaming.esc(new Date(s.at).toLocaleString())}</span><span>${WebTaming.esc(String(s.text).slice(0, 120))}</span></div>`).join('')
        : '<p class="wt-muted">Nothing recorded yet.</p>';
    }
    WebTaming.modal('wt-chart', `<h2 class="wt-title">${WebTaming.esc(w.title)}</h2>${body}
      <div class="wt-actions"><button class="wt-btn wt-primary" data-wt-close>Done</button></div>`);
  },
};

// ---- 4. Page changelog on a revisit ---------------------------------------
const PageChangelog = {
  list: wtSiteList('vex.pageChangelog', [
    'developer.mozilla.org', 'docs.python.org', 'nodejs.org', 'react.dev', 'docs.github.com',
    'learn.microsoft.com', 'electronjs.org', 'typescriptlang.org', 'docs.docker.com',
  ]),
  SNAPS: 'vex.pageChangelogSnaps',
  MAX_PAGES: 40,
  MAX_LINES: 600,
  _timers: new Map(),

  _key(url) { return (typeof DuplicateTabs !== 'undefined' && DuplicateTabs.norm(url)) || String(url).replace(/#.*$/, ''); },

  onSettled(tabId) {
    if (!this.list.state().on) return;
    const tab = WebTaming.tabById(tabId);
    const wv = WebTaming.webviewOf(tabId);
    if (!tab || !wv || tab.sleeping) return;
    if (window.VexTabPolicy && !window.VexTabPolicy.canPersist(tab)) return;   // private / Tor: nothing is kept
    let url = '';
    try { url = wv.getURL(); } catch { return; }
    if (!/^https?:/i.test(url) || !this.list.matches(url)) return;
    clearTimeout(this._timers.get(tabId));
    // Docs render a moment after dom-ready.
    this._timers.set(tabId, setTimeout(() => this.check(tabId, url).catch(err => console.warn('[PageChangelog]', err && err.message)), 2500));
  },

  async check(tabId, url) {
    const wv = WebTaming.webviewOf(tabId);
    if (!wv) return null;
    let now = '';
    try { if (wv.getURL() !== url) return null; now = await wv.executeJavaScript('(document.body&&document.body.innerText||"").slice(0,200000)'); }
    catch { return null; }
    if (typeof PageWatchDiff === 'undefined') throw new Error('Page diff is not available');
    const lines = PageWatchDiff.normalizeText(now).slice(0, this.MAX_LINES);
    if (lines.length < 5) return null;                    // nothing readable
    const snaps = WebTaming.readJson(this.SNAPS, {});
    const key = this._key(url);
    const before = snaps[key];
    snaps[key] = { at: Date.now(), title: (WebTaming.tabById(tabId) || {}).title || url, lines };
    const keys = Object.keys(snaps);
    if (keys.length > this.MAX_PAGES) {
      keys.sort((a, b) => snaps[a].at - snaps[b].at).slice(0, keys.length - this.MAX_PAGES).forEach(k => delete snaps[k]);
    }
    WebTaming.writeJson(this.SNAPS, snaps);
    if (!before || !Array.isArray(before.lines)) return null;
    const d = PageWatchDiff.lineDiff(before.lines, lines);
    if (!d.added.length && !d.removed.length) return null;
    this._offer(tabId, wv, before, d);
    return d;
  },

  _offer(tabId, wv, before, d) {
    document.getElementById('wt-changelog')?.remove();
    WebTaming.injectStyle();
    const chip = document.createElement('div');
    chip.id = 'wt-changelog';
    chip.className = 'wt-chip';
    chip.setAttribute('role', 'status');
    const sum = PageWatchDiff.summarize(d, { maxLines: 0 });
    chip.innerHTML = `<div><strong>${WebTaming.esc(sum.headline)}</strong> since you last looked (${WebTaming.esc(new Date(before.at).toLocaleDateString())})</div>
      <div class="wt-row"><button class="wt-btn wt-primary" data-show>Highlight what changed</button><button class="wt-btn" data-x>Dismiss</button></div>`;
    document.body.appendChild(chip);
    chip.querySelector('[data-x]').addEventListener('click', () => chip.remove());
    chip.querySelector('[data-show]').addEventListener('click', async () => {
      chip.remove();
      const n = await this.highlight(wv, d.added);
      this.details(d, n);
    });
    setTimeout(() => chip.remove(), 30000);
  },

  // The CSS Custom Highlight API: nothing in the page is changed, and a reload
  // clears it. Returns how many places were marked.
  async highlight(wv, added) {
    const js = `(function(lines){
      if(!window.CSS||!CSS.highlights||typeof Highlight!=='function')return -1;
      var st=document.getElementById('vex-changed-style');
      if(!st){st=document.createElement('style');st.id='vex-changed-style';st.textContent='::highlight(vex-changed){background-color:rgba(255,200,40,.55);color:inherit}';document.head.appendChild(st);}
      var set={};lines.forEach(function(l){set[l]=1;});
      var ranges=[];var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);var n;
      while((n=w.nextNode())){
        var p=n.parentNode;if(!p||/^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.nodeName))continue;
        var v=n.nodeValue.replace(/\\s+/g,' ').trim();if(v.length<8)continue;
        var hit=set[v];
        if(!hit){for(var i=0;i<lines.length;i++){if(lines[i].indexOf(v)>=0||(lines[i].length>=12&&v.indexOf(lines[i])>=0)){hit=1;break;}}}
        if(hit){var r=document.createRange();r.selectNodeContents(n);ranges.push(r);}
      }
      CSS.highlights.set('vex-changed',new Highlight(...ranges));
      if(ranges[0]){var e=ranges[0].startContainer.parentElement;if(e&&e.scrollIntoView)e.scrollIntoView({block:'center'});}
      return ranges.length;
    })(${JSON.stringify(added.slice(0, 300))})`;
    try { return Number(await wv.executeJavaScript(js)); } catch { return -1; }
  },

  details(d, marked) {
    const cap = 120;
    const rows = [...d.removed.map(t => ['-', t]), ...d.added.map(t => ['+', t])].slice(0, cap);
    WebTaming.modal('wt-changelog-details', `
      <h2 class="wt-title">What changed on this page</h2>
      <p class="wt-muted">${marked > 0 ? marked + ' place' + (marked === 1 ? '' : 's') + ' highlighted in the page.' : 'The new text could not be highlighted in the page; it is listed here.'}</p>
      ${rows.map(([s, t]) => `<div class="wt-line"><span aria-label="${s === '+' ? 'added' : 'removed'}">${s}</span><span>${WebTaming.esc(t)}</span></div>`).join('')}
      <div class="wt-actions"><button class="wt-btn wt-primary" data-wt-close>Done</button></div>`);
  },

  manage() {
    wtSiteDialog({
      id: 'wt-changelog-sites', title: 'Page changelog sites',
      intro: 'When you come back to a page on one of these sites, Vex says what changed since your last visit and highlights it. Only the text is kept, on this computer; private and Tor tabs are never recorded.',
      list: this.list,
    });
  },
};

// ---- 5. Merge duplicate tabs ----------------------------------------------
const TabDedupe = {
  // Groups of tabs showing the same page in the same container.
  groups(tabs) {
    const map = new Map();
    for (const t of tabs || []) {
      if (!t || !t.url || t.pinned) continue;
      const n = (typeof DuplicateTabs !== 'undefined') ? DuplicateTabs.norm(t.url) : '';
      if (!n) continue;
      const jar = (!t.partition || t.partition === 'persist:main') ? '' : String(t.partition);
      const k = n + '|' + jar;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
    }
    return [...map.values()].filter(g => g.length > 1);
  },

  // Which one stays: the tab in front, else the one scrolled furthest (your
  // place), else the first. `scroll` maps tabId -> scrollY.
  keeper(group, activeId, scroll) {
    const front = group.find(t => t.id === activeId);
    if (front) return front;
    return group.slice().sort((a, b) => (scroll.get(b.id) || 0) - (scroll.get(a.id) || 0))[0];
  },

  async merge() {
    if (typeof TabManager === 'undefined') return 0;
    const groups = this.groups(TabManager.tabs);
    if (!groups.length) { WebTaming.toast('No duplicate tabs in this window'); return 0; }
    const scroll = new Map();
    await Promise.all(groups.flat().map(async (t) => {
      const wv = WebTaming.webviewOf(t.id);
      if (!wv || t.sleeping) return;
      try {
        const y = await Promise.race([wv.executeJavaScript('window.scrollY||0'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))]);
        scroll.set(t.id, Number(y) || 0);
      } catch { /* a page that does not answer keeps no position */ }
    }));
    const toClose = [];
    for (const g of groups) {
      const keep = this.keeper(g, TabManager.activeTabId, scroll);
      g.forEach(t => { if (t.id !== keep.id) toClose.push(t.id); });
    }
    if (!toClose.length) return 0;
    // closeTabsWithUndo puts them back with the toast's Undo.
    TabManager.closeTabsWithUndo(toClose, `Merged ${toClose.length} duplicate tab${toClose.length === 1 ? '' : 's'} into ${groups.length}, keeping your place`);
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:fun-action', { detail: { kind: 'organize' } }));
    return toClose.length;
  },
};

// ---- 6. Highlights also go to Notes ---------------------------------------
const HighlightNotes = {
  KEY: 'vex.highlightsToNotes',
  TITLE: 'Highlights',
  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  toggle() {
    const on = !this.enabled();
    try { localStorage.setItem(this.KEY, on ? 'on' : 'off'); } catch (err) { WebTaming.toast('Could not save that preference', 'error'); return this.enabled(); }
    WebTaming.toast(on ? 'Highlights are also saved to Notes' : 'Highlights are kept on the page only');
    return on;
  },
  // Writes one entry at the top of the "Highlights" note. Returns true if
  // written. Never throws into the highlight flow; failures are toasted.
  add({ text, url, title }) {
    if (!this.enabled() || !text || !url) return false;
    try {
      const notes = WebTaming.readJson('vex.notes', []);
      if (!Array.isArray(notes)) throw new Error('The notes store is damaged');
      let note = notes.find(n => n && n.title === this.TITLE);
      if (!note) {
        const stamp = new Date().toISOString();
        note = { id: (typeof vexId === 'function' ? vexId('note_') : 'note_' + Date.now()), title: this.TITLE, content: '', pinned: false, tags: ['highlights'], sourceUrl: '', sourceTitle: '', createdAt: stamp, updatedAt: stamp };
        notes.unshift(note);
      }
      const clean = String(text).trim().replace(/\n/g, '\n> ');
      const label = String(title || url).replace(/[\[\]]/g, '');
      note.content = `> ${clean}\n\n— [${label}](${url}) · ${new Date().toLocaleString()}\n\n---\n\n` + (note.content || '');
      note.updatedAt = new Date().toISOString();
      if (!WebTaming.writeJson('vex.notes', notes)) throw new Error('Notes could not be saved');
      if (typeof NotesPanel !== 'undefined' && Array.isArray(NotesPanel.notes)) {
        NotesPanel.notes = notes;
        try { NotesPanel.renderList?.(); } catch { /* panel not drawn */ }
      }
      return true;
    } catch (err) {
      WebTaming.toast('Highlighted, but not saved to Notes: ' + ((err && err.message) || ''), 'error');
      return false;
    }
  },
};

// ---- 7. Screenshot to note -------------------------------------------------
const ShotToNote = {
  IMAGES: 'vex.noteShots',
  MAX_IMAGES: 12,
  MAX_EDGE: 1100,

  imageFor(noteId) { const m = WebTaming.readJson(this.IMAGES, {}); return typeof m[noteId] === 'string' ? m[noteId] : ''; },

  async _shrink(dataUrl) {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('The picture could not be read')); img.src = dataUrl; });
    const k = Math.min(1, this.MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('No canvas to draw on');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  },

  async save(dataUrl) {
    const tab = WebTaming.activeTab();
    const url = (tab && tab.url) || '';
    const title = (tab && tab.title) || url || 'Screenshot';
    WebTaming.toast('Saving the screenshot to Notes...');
    let small;
    try { small = await this._shrink(dataUrl); }
    catch (err) { WebTaming.toast('Could not save the screenshot: ' + err.message, 'error'); return null; }
    // The text in the picture, when the OCR engine is there; said plainly
    // when it is not or fails, never silently left out.
    let ocr = '', ocrNote = '';
    try {
      if (typeof DocExtract === 'undefined' || typeof DocExtract._loadOcr !== 'function') ocrNote = 'Text was not read: no OCR engine in this build.';
      else {
        const lib = await DocExtract._loadOcr();
        const { data } = await VexJobs.heavyOrThrow('Screenshot OCR', () => lib.recognize(dataUrl, 'eng'), { kind: 'ocr' });
        ocr = ((data && data.text) || '').trim();
        if (!ocr) ocrNote = 'No readable text was found in the picture.';
      }
    } catch (err) { ocrNote = 'Text could not be read: ' + ((err && err.message) || 'OCR failed'); }

    try {
      const notes = WebTaming.readJson('vex.notes', []);
      if (!Array.isArray(notes)) throw new Error('The notes store is damaged');
      const stamp = new Date().toISOString();
      const id = typeof vexId === 'function' ? vexId('note_') : 'note_' + Date.now();
      const label = String(title).replace(/[\[\]]/g, '');
      const content = '(The picture shows when you preview this note.)\n\n'
        + (url ? `Page: [${label}](${url})\n\n` : '')
        + (ocr ? '**Text in the picture**\n\n> ' + ocr.replace(/\n+/g, '\n> ') + '\n' : ocrNote + '\n');
      notes.unshift({ id, title: 'Screenshot: ' + String(title).slice(0, 60), content, pinned: false, tags: ['screenshot'], sourceUrl: url, sourceTitle: String(title), createdAt: stamp, updatedAt: stamp });
      // Pictures live apart from the note text (they are big and Notes sync
      // carries the text only); pictures of deleted notes are dropped.
      const live = new Set(notes.map(n => n && n.id));
      const imgs = WebTaming.readJson(this.IMAGES, {});
      Object.keys(imgs).forEach(k => { if (!live.has(k)) delete imgs[k]; });
      imgs[id] = small;
      const keys = Object.keys(imgs);
      if (keys.length > this.MAX_IMAGES) keys.slice(0, keys.length - this.MAX_IMAGES).forEach(k => delete imgs[k]);
      if (!WebTaming.writeJson(this.IMAGES, imgs)) throw new Error('There is no room left for the picture');
      if (!WebTaming.writeJson('vex.notes', notes)) throw new Error('Notes could not be saved');
      if (typeof NotesPanel !== 'undefined' && Array.isArray(NotesPanel.notes)) {
        NotesPanel.notes = notes;
        try { NotesPanel.renderList?.(); } catch { /* panel not drawn */ }
      }
      WebTaming.toast(ocr ? 'Screenshot and its text saved to Notes' : 'Screenshot saved to Notes. ' + ocrNote);
      return id;
    } catch (err) {
      WebTaming.toast('Could not save the screenshot: ' + ((err && err.message) || ''), 'error');
      return null;
    }
  },

  // Drag a rectangle over the page; the capture is of that part only.
  async captureRegion() {
    if (typeof WebviewManager === 'undefined' || typeof ScreenshotTool === 'undefined') return;
    const wv = WebviewManager.getActiveWebview();
    if (!wv) { WebTaming.toast('No active tab to capture'); return; }
    WebTaming.injectStyle();
    const r = wv.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.className = 'wt-region';
    layer.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    layer.setAttribute('role', 'application');
    layer.setAttribute('aria-label', 'Drag to choose the part of the page to capture. Escape cancels.');
    const box = document.createElement('div');
    box.className = 'wt-region-box';
    box.hidden = true;
    layer.appendChild(box);
    document.body.appendChild(layer);
    WebTaming.toast('Drag over the part of the page to capture. Esc cancels.');
    const done = (rect) => {
      document.removeEventListener('keydown', onKey, true);
      layer.remove();
      if (rect && rect.width >= 8 && rect.height >= 8) this._grab(wv, rect);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', onKey, true);
    let sx = 0, sy = 0, drag = false;
    const rectOf = (x, y) => ({ x: Math.min(sx, x), y: Math.min(sy, y), width: Math.abs(x - sx), height: Math.abs(y - sy) });
    layer.addEventListener('mousedown', (e) => { drag = true; const b = layer.getBoundingClientRect(); sx = e.clientX - b.left; sy = e.clientY - b.top; box.hidden = false; });
    layer.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const b = layer.getBoundingClientRect();
      const q = rectOf(e.clientX - b.left, e.clientY - b.top);
      box.style.cssText = `left:${q.x}px;top:${q.y}px;width:${q.width}px;height:${q.height}px`;
    });
    layer.addEventListener('mouseup', (e) => {
      if (!drag) return;
      const b = layer.getBoundingClientRect();
      done(rectOf(e.clientX - b.left, e.clientY - b.top));
    });
  },

  async _grab(wv, rect) {
    try {
      const image = await wv.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
      if (!image || image.isEmpty()) { WebTaming.toast('Screenshot failed', 'error'); return; }
      ScreenshotTool.showPreview(image.toDataURL());
    } catch (err) { WebTaming.toast('Screenshot error: ' + ((err && err.message) || ''), 'error'); }
  },
};

// ---- wiring ---------------------------------------------------------------
if (typeof document !== 'undefined') {
  document.addEventListener('vex:tab-settled', (e) => {
    const tabId = e.detail && e.detail.tabId;
    if (tabId == null) return;
    try { ReaderFirst.onSettled(tabId).catch(err => console.warn('[ReaderFirst]', err && err.message)); } catch (err) { console.warn('[ReaderFirst]', err && err.message); }
    try { PageChangelog.onSettled(tabId); } catch (err) { console.warn('[PageChangelog]', err && err.message); }
  });
  document.addEventListener('vex:tab-closed', (e) => {
    const tabId = e.detail && e.detail.tabId;
    ReaderFirst._done.delete(tabId);
    clearTimeout(PageChangelog._timers.get(tabId));
    PageChangelog._timers.delete(tabId);
  });
}

if (typeof window !== 'undefined') {
  Object.assign(window, { WebTaming, ReaderFirst, ComparePages, PriceStock, PageChangelog, TabDedupe, HighlightNotes, ShotToNote });
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebTaming, ReaderFirst, ComparePages, PriceStock, PageChangelog, TabDedupe, HighlightNotes, ShotToNote };
}
